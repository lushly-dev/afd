//! `curator-plan` (phase 4 specification, sections 3.1, 4.6, 6, 7.3, 9.1 and 11.1): the first step
//! of `curator-run`. It takes the caller's lock, erases what the caller's records keep of erased
//! memory, re-checks every draft that may be open, reads memory and documents under the caller's
//! reader filter, and returns the batch for `knowledge-propose-batch`: drafts, withdrawals and the
//! `erased` notice, with content-free bookkeeping for `curator-finish`.
//!
//! - **Only inside the run** ([`crate::run::attested`]).
//! - **Order and caps** (4.6): candidates in id order, then reviews in document id order, at most
//!   `max_proposals` drafts, `reverify.max_per_run` reviews, 400 distinct cited memory records and
//!   50 withdrawals (the batch's caps); what the caps leave is `remaining`.
//! - **Recovery** (7.3): before it returns, a draft is recorded with its key's draft number and
//!   the proposal id the knowledge plugin derives from it, so a run that stopped after the batch
//!   is completed by the next (the same draft, the same key, the stored proposal back), and a run
//!   whose candidate changed meanwhile withdraws the stale proposal before drafting again.
//! - **No memory text leaves it but to the batch.** Its output holds the drafts (memory text, in a
//!   digest-journaled step) and, apart from them, ids and counts only.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};
use umbel_sdk::{Cx, Outcome, success};
use umbel_store::memory::format_instant;
use umbel_store::{ContentHash, MemoryRecord, canonical_json};

use crate::changes;
use crate::draft::{self, Drafter};
use crate::erase;
use crate::evaluate::{self, Candidate, Inputs, Status};
use crate::fail;
use crate::read;
use crate::recheck;
use crate::records::{self, CANDIDATE, Kept, Stored};
use crate::review::{self, Finding, Op, Review, ReviewStatus};
use crate::run::{self, Bookkeeping, Counted, Planned, Subject, Withdrawal};
use crate::settings::Call;
use crate::state;

/// The batch's caps (`knowledge-propose-batch`).
const MAX_ITEMS: usize = 50;
const MAX_CITED: usize = 400;

pub(crate) fn run(input: &Value, cx: &Cx) -> Outcome {
    match plan(input, cx) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

/// The batch being built, with its caps.
struct Batch {
    items: Vec<Value>,
    drafts: Vec<Planned>,
    withdraw: Vec<Value>,
    withdrawals: Vec<Withdrawal>,
    cited: BTreeSet<String>,
    deferred: u64,
}

impl Batch {
    fn new() -> Self {
        Self {
            items: Vec::new(),
            drafts: Vec::new(),
            withdraw: Vec::new(),
            withdrawals: Vec::new(),
            cited: BTreeSet::new(),
            deferred: 0,
        }
    }

    /// Ask for `withdrawal` unless the batch's cap is reached (then it waits for a later run).
    fn withdraw(&mut self, withdrawal: Withdrawal) {
        if self.withdrawals.len() >= MAX_ITEMS {
            self.deferred += 1;
            return;
        }
        self.withdraw
            .push(json!({ "proposal": withdrawal.proposal, "reason": withdrawal.reason }));
        self.withdrawals.push(withdrawal);
    }

    /// Whether a draft citing `sources` fits, under `most` drafts.
    fn fits(&self, sources: &[MemoryRecord], most: usize) -> bool {
        let added = sources
            .iter()
            .filter(|s| !self.cited.contains(&s.id))
            .count();
        self.items.len() < most.min(MAX_ITEMS) && self.cited.len() + added <= MAX_CITED
    }
}

/// Whether `id` is withdrawn in this batch.
fn withdrawing(batch: &Batch, id: &str) -> bool {
    batch.withdrawals.iter().any(|w| w.id == id)
}

fn plan(_input: &Value, cx: &Cx) -> Result<Outcome, Outcome> {
    let attestation = run::attested(cx)?;
    let call = Call::open(cx)?;
    let actor = run::actor(cx.call());
    let drafter = Drafter {
        plugin: &attestation.plugin,
        instance: &attestation.instance,
    };
    let (space, principal, now) = (call.space.as_str(), call.principal.as_str(), call.now);
    let before = state::take(cx, space, principal, &attestation.run, now)?;

    // Erased memory first: the curator's records keep nothing of it, and the batch's notice has
    // the knowledge plugin redact every draft that cites it.
    let memory_changes = changes::read(cx, space, before.cursors.memory_after)?;
    let mut stored = records::stored(cx, space, principal)?;
    let erased_records = erase::apply(cx, &call, &mut stored, &memory_changes.erased)?;
    let checkpoint = (erased_records > 0).then(|| erase::checkpoint(cx, space));
    let consents = records::consents(cx, space, principal)?;

    // The re-check reads every source of every draft that may be open, at `now`.
    let mut batch = Batch::new();
    let mut current: BTreeMap<String, Option<MemoryRecord>> = BTreeMap::new();
    let applied_sets = recheck::applied_sets(&stored);
    for s in &stored {
        let Some(proposal) = s.open_draft() else {
            continue;
        };
        for source in &s.sources {
            if !current.contains_key(&source.id) {
                current.insert(source.id.clone(), read::get(cx, space, &source.id, now)?);
            }
        }
        let reason = if !recheck::stands(&s.sources, &current, now) {
            Some("source-changed")
        } else if s.status == Status::Drafted
            && s.conflict_set
                .as_ref()
                .is_some_and(|set| applied_sets.contains(set))
        {
            Some("superseded-alternative")
        } else if s.status == Status::Ready
            && s.drafts
                .checked_sub(1)
                .map(|n| proposal_for(space, &actor, drafter.instance, &s.id, n))
                .as_deref()
                != Some(proposal)
        {
            // Recorded as about to be submitted under a key this run would not render again.
            Some("source-changed")
        } else {
            None
        };
        if let Some(reason) = reason {
            batch.withdraw(Withdrawal {
                subject: Subject::Candidate,
                id: s.id.clone(),
                proposal: proposal.to_owned(),
                reason,
            });
        }
    }

    // What the caller can read now, from where the last run's scan stopped.
    let memory = read::scan(
        cx,
        space,
        now,
        &call.settle,
        before.cursors.scan_after.clone(),
    )?;
    let by_id: BTreeMap<&str, &Stored> = stored.iter().map(|s| (s.id.as_str(), s)).collect();
    let evaluation = evaluate::evaluate(
        Inputs {
            space,
            principal,
            now,
            settle: &call.settle,
            target: &call.target,
            records: memory.records.clone(),
            stored: &stored,
            consents: &consents,
        },
        |doc| {
            cx.doc_get(space, doc)
                .map(|found| found.is_some())
                .map_err(|error| fail::host(&error))
        },
    )?;

    // A draft recorded as about to be submitted whose candidate no longer renders the same, or has
    // no live group, is withdrawn before anything is drafted again.
    let live: BTreeMap<&str, &Candidate> = evaluation
        .candidates
        .iter()
        .map(|c| (c.id.as_str(), c))
        .collect();
    for s in &stored {
        if s.status != Status::Ready || withdrawing(&batch, &s.id) {
            continue;
        }
        let Some(proposal) = s.open_draft() else {
            continue;
        };
        let same = live.get(s.id.as_str()).is_some_and(|candidate| {
            candidate.status == Status::Ready && recheck::renders_as_recorded(s, candidate)
        });
        if !same {
            batch.withdraw(Withdrawal {
                subject: Subject::Candidate,
                id: s.id.clone(),
                proposal: proposal.to_owned(),
                reason: "source-changed",
            });
        }
    }

    // Candidates in id order, up to the caps.
    let most = usize::try_from(call.settle.max_proposals).unwrap_or(MAX_ITEMS);
    let mut counted = Counted {
        read: memory.records.len() as u64,
        ..Counted::default()
    };
    let mut writes: Vec<(Candidate, Kept)> = Vec::new();
    for candidate in &evaluation.candidates {
        let kept = by_id.get(candidate.id.as_str()).copied();
        counted.candidates += 1;
        if candidate.snapshot.is_some() {
            counted.settled += 1;
        }
        match candidate.status {
            Status::NeedsPromotion => counted.needs_promotion += 1,
            Status::Skipped => {
                let reason = candidate.reason.map_or("", |r| r.as_str());
                counted
                    .skipped
                    .push(json!({ "candidate": candidate.id, "reason": reason }));
                if reason == "target-exists" {
                    counted.inconsistencies.push(json!({
                        "kind": "target-exists", "doc": candidate.doc, "candidate": candidate.id,
                    }));
                }
            }
            _ => {}
        }
        if candidate.conflict_set.is_some()
            && kept.is_some_and(|s| s.status == Status::Drafted && s.conflict_set.is_none())
        {
            counted.inconsistencies.push(json!({
                "kind": "conflict-after-draft", "candidate": candidate.id,
            }));
        }
        if withdrawing(&batch, &candidate.id) {
            // Withdrawn this run, so not drafted again until the withdrawal is recorded.
            continue;
        }
        let open = kept.and_then(Stored::open_draft).is_some();
        let first_seen_at = kept.and_then(|s| s.first_seen_at).unwrap_or(now);
        let mut record = candidate.clone();
        let mut kept_fields = Kept {
            first_seen_at,
            proposal: kept.and_then(|s| s.proposal.clone()),
            rejected: kept
                .filter(|s| s.status == Status::Rejected)
                .and_then(|s| s.reason.clone()),
        };
        if candidate.status == Status::Ready && candidate.mode.is_some() {
            if batch.fits(&candidate.sources, most) {
                // The same draft again (a run that stopped after its batch), else a new key.
                let resubmit = kept.filter(|s| s.status == Status::Ready && s.proposal.is_some());
                let key = match resubmit {
                    Some(s) => s.drafts.saturating_sub(1),
                    None => candidate.drafts,
                };
                record.drafts = key;
                let Some(item) = draft::item(&record, drafter) else {
                    continue;
                };
                let proposal = proposal_for(space, &actor, drafter.instance, &candidate.id, key);
                batch
                    .cited
                    .extend(candidate.sources.iter().map(|s| s.id.clone()));
                batch.items.push(item);
                batch.drafts.push(Planned {
                    subject: Subject::Candidate,
                    id: candidate.id.clone(),
                    proposal: proposal.clone(),
                    key,
                    op: None,
                });
                record.drafts = key + 1;
                kept_fields.proposal = Some(proposal);
            } else {
                batch.deferred += 1;
            }
        }
        // A draft that may be open keeps its record until it is decided, withdrawn or submitted
        // again, so its proposal is never lost from the caller's records; a rejection keeps its
        // record while it is quiet, whatever the live status (a confirmation re-settling it), so
        // the same content is not drafted again before `quietUntil` (section 7.1).
        let quiet = kept.is_some_and(|s| {
            s.status == Status::Rejected && s.quiet_until.is_some_and(|until| until > now)
        });
        if (open && record.drafts == candidate.drafts) || quiet {
            continue;
        }
        writes.push((record, kept_fields));
    }

    // Reviews: the open ones re-checked against their documents, then the documents due.
    let reviews = review::stored(cx, space, principal)?;
    let collections = cx
        .readable_collections(space)
        .map_err(|error| fail::host(&error))?;
    let markdown: Vec<String> = collections
        .iter()
        .filter(|c| c.kind == "markdown")
        .map(|c| c.id.clone())
        .collect();
    let all: Vec<String> = collections.iter().map(|c| c.id.clone()).collect();
    let mut review_writes: Vec<Review> = Vec::new();
    for review in reviews.values() {
        let Some(proposal) = review.open_draft() else {
            continue;
        };
        let now_hash = review::document(cx, space, &review.doc)?.map(|d| d.write.content_hash);
        let stale = now_hash
            .as_ref()
            .is_none_or(|h| h.as_str() != review.base_hash)
            || (review.status == ReviewStatus::Ready
                && review
                    .drafts
                    .checked_sub(1)
                    .map(|n| review_proposal_for(space, &actor, drafter.instance, &review.id, n))
                    .as_deref()
                    != Some(proposal));
        if stale {
            batch.withdraw(Withdrawal {
                subject: Subject::Review,
                id: review.id.clone(),
                proposal: proposal.to_owned(),
                reason: "source-changed",
            });
        }
    }
    let scanned = review::scan(
        cx,
        space,
        now,
        &call.settle,
        before.cursors.review_after.as_deref(),
        (&markdown, &all),
    )?;
    let most_reviews = usize::try_from(call.settle.reverify.max_per_run).unwrap_or(MAX_ITEMS);
    let mut reviewed = 0usize;
    for document in &scanned.documents {
        let facts = &document.facts;
        match &document.finding {
            Finding::Nothing => continue,
            Finding::CheckFailed(failed) => {
                for check in failed {
                    counted.inconsistencies.push(json!({
                        "kind": "check-failed", "doc": facts.id, "check": check,
                    }));
                }
                continue;
            }
            Finding::SuccessorMissing => {
                counted
                    .inconsistencies
                    .push(json!({ "kind": "successor-missing", "doc": facts.id }));
                continue;
            }
            Finding::Verify | Finding::Deprecate(_) => {}
        }
        let op = if matches!(document.finding, Finding::Verify) {
            Op::Verify
        } else {
            Op::Deprecate
        };
        let id = review::review_id(space, principal, &facts.id);
        let existing = reviews.get(&facts.id);
        if existing.is_some_and(|r| withdrawing(&batch, &r.id)) {
            continue;
        }
        let same_base = existing.is_some_and(|r| r.base_hash == facts.hash && r.op == op);
        let quiet =
            existing.is_some_and(|r| same_base && r.quiet_until.is_some_and(|until| until > now));
        let resubmit = existing.filter(|r| same_base && r.status == ReviewStatus::Ready);
        let skip = existing.is_some_and(|r| {
            same_base && (r.status == ReviewStatus::Drafted || r.status == ReviewStatus::Applied)
        });
        if quiet || skip {
            continue;
        }
        if reviewed >= most_reviews || !batch.fits(&[], most) {
            batch.deferred += 1;
            continue;
        }
        let (key, at) = match resubmit {
            Some(r) => (r.drafts.saturating_sub(1), r.at),
            None => (existing.map_or(0, |r| r.drafts), now),
        };
        let mut next = Review {
            id: id.clone(),
            doc: facts.id.clone(),
            op,
            base_hash: facts.hash.clone(),
            status: ReviewStatus::Ready,
            drafts: key + 1,
            proposal: None,
            at,
            quiet_until: None,
            record_hash: existing.and_then(|r| r.record_hash.clone()),
        };
        let Some(item) = review::item(
            &next,
            facts,
            &document.finding,
            drafter.instance,
            &call.settle,
            key,
        ) else {
            continue;
        };
        let proposal = review_proposal_for(space, &actor, drafter.instance, &id, key);
        next.proposal = Some(proposal.clone());
        batch.items.push(item);
        batch.drafts.push(Planned {
            subject: Subject::Review,
            id,
            proposal,
            key,
            op: Some(op.as_str().to_owned()),
        });
        review_writes.push(next);
        reviewed += 1;
    }

    // Record what this run drafts before the batch submits it, and every candidate whose record
    // changed; a record being withdrawn this run is left as it is until the withdrawal is known.
    for (candidate, kept) in &writes {
        let body = records::candidate_record(candidate, space, principal, kept);
        let stored = by_id.get(candidate.id.as_str()).copied();
        let hash = ContentHash::of(canonical_json(&body).as_bytes());
        if stored.and_then(|s| s.record_hash.as_ref()) == Some(&hash) {
            continue;
        }
        records::put(
            cx,
            space,
            now,
            (CANDIDATE, &candidate.id),
            body,
            (candidate.access.clone(), candidate.sensitivity),
            records::expect(stored.and_then(|s| s.record_hash.as_ref())),
        )?;
    }
    for review in &review_writes {
        review.save(cx, space, principal, now)?;
    }

    counted.remaining = batch.deferred + remaining_records(cx, space, now, &memory);
    let bookkeeping = Bookkeeping {
        drafts: batch.drafts,
        withdrawals: batch.withdrawals,
        cursors: state::Cursors {
            memory_after: memory_changes.next,
            scan_after: memory.next.clone(),
            review_after: scanned.next.clone(),
        },
        counted,
        checkpoint,
        started_at: now,
    };
    let erased: Vec<&String> = memory_changes.erased.iter().collect();
    Ok(success(json!({
        "space": space,
        "run": attestation.run,
        "submit": batch.items,
        "withdraw": batch.withdraw,
        "erased": erased,
        "feedAfter": before.feed_after,
        "plan": bookkeeping.to_value(),
    }))
    .with_metadata("dev.umbel/trust", json!("content"))
    .with_reasoning(&format!(
        "Planned {} draft(s) and {} withdrawal(s) at {}; {} erased record(s) noticed.",
        bookkeeping.drafts.len(),
        bookkeeping.withdrawals.len(),
        format_instant(now),
        erased.len(),
    )))
}

/// The proposal id the knowledge plugin assigns a candidate's draft number `n`.
fn proposal_for(space: &str, actor: &str, instance: &str, candidate: &str, n: u32) -> String {
    umbel_okf::draft::proposal_id(
        space,
        actor,
        &umbel_okf::draft::idempotency_key(instance, candidate, n),
    )
}

/// The proposal id the knowledge plugin assigns a review's draft number `n`.
fn review_proposal_for(space: &str, actor: &str, instance: &str, review: &str, n: u32) -> String {
    umbel_okf::draft::proposal_id(space, actor, &format!("{instance}/{review}/{n}"))
}

/// The readable records the rotating scan did not reach this run: an upper bound from the store's
/// counts of live semantic and procedural records, `0` when the scan reached every one.
fn remaining_records(cx: &Cx, space: &str, now: i64, memory: &read::Read) -> u64 {
    if !memory.more {
        return 0;
    }
    let Ok(counts) = cx.memory_counts(space, now, 0) else {
        return 0;
    };
    let live: u64 = counts
        .by_class
        .iter()
        .filter(|(class, _)| {
            matches!(
                class,
                umbel_store::MemoryClass::Semantic | umbel_store::MemoryClass::Procedural
            )
        })
        .map(|(_, c)| c.live)
        .sum();
    live.saturating_sub(memory.listed)
}
