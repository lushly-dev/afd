//! Verifying a listed drafter's claims (phase 4 specification, section 3.2; owner decision 10,
//! D91) and approve's re-checks of a draft (section 8.2; owner decision 6, D102).
//!
//! **Listing a drafter is not trusting it.** The host attests who drafted (`plugin`, `instance`,
//! `pipeline`, `run`); every other claim is checked here before the proposal is stored: each
//! memory source against the memory store, read under the batch caller's reader filter at the
//! call's `now`, and the content, rationale, ids and key against `umbel_okf::draft`. The first
//! check that fails refuses the item with `PROPOSAL_DRAFT_MISMATCH`, `details.check` naming it.
//! A claim this instance cannot verify (memory without the `memory` grant; content that is not
//! the fixed rendering of memory records on a create) is `PROPOSAL_DRAFT_UNVERIFIABLE`.
//!
//! What cannot be verified is stated in section 3.2 and left to the preview's labels: a
//! promotion's terminal consent (bounded: the caller must own every widened source), the settling
//! policy, `generated.at`'s exact value (bounded), and sessions as labels (bounded by the store's
//! counts).

use std::collections::BTreeSet;

use serde_json::Value;
use umbel_okf::draft::{self, Draft, Rationale};
use umbel_sdk::{Outcome, PipelineAttestation};
use umbel_store::{DerivedFrom, MemoryRecord};

use super::common::{Caller, Target};
use super::model::{Drafter, MODE_SCHEDULED, Op, Proposal};
use super::propose::{self, Submission, unavailable};
use super::sources::{
    self, CLAIM_MEMORY, Entry, Read, Sources, Unread, gone, mismatch, mismatch_at_approve, rank,
    unverifiable,
};

/// An open proposal in a conflict set, as the conflict-set check compares it.
#[derive(Debug, Clone)]
pub(crate) struct Member {
    /// Its document.
    pub(crate) doc: String,
    /// `subject_key` of its title (the subject its sources share), when it has one.
    pub(crate) subject_key: Option<String>,
    /// The content hashes of the memory records it cites.
    pub(crate) hashes: Vec<String>,
}

impl Member {
    pub(crate) fn of(proposal: &Proposal) -> Self {
        let subject_key = proposal
            .change
            .content
            .as_deref()
            .and_then(|content| umbel_okf::frontmatter::split(content.as_bytes()).ok())
            .and_then(|parts| parts.fields)
            .and_then(|fields| {
                fields
                    .get("title")
                    .and_then(Value::as_str)
                    .map(draft::subject_key)
            });
        let hashes = proposal
            .evidence
            .iter()
            .filter(|entry| entry.get("kind").and_then(Value::as_str) == Some("memory"))
            .filter_map(|entry| entry.get("contentHash").and_then(Value::as_str))
            .map(str::to_owned)
            .collect();
        Self {
            doc: proposal.change.doc.clone(),
            subject_key,
            hashes,
        }
    }
}

/// What one drafted item is checked with.
pub(crate) struct Draftable<'x, 'c, 'a> {
    pub(crate) caller: &'c Caller<'a>,
    pub(crate) attestation: &'x PipelineAttestation,
    /// The batch's sources, each read once.
    pub(crate) sources: &'x Sources<'c, 'a>,
    /// The drafter: attested fields and claimed `mode`, `candidate` and `promotedBy`.
    pub(crate) drafter: &'x Drafter,
    pub(crate) conflict_set: Option<&'x str>,
    pub(crate) derived_from: Option<&'x [DerivedFrom]>,
    /// The open proposals already in the claimed conflict set.
    pub(crate) members: &'x [Member],
}

/// One source: the entry the drafter wrote and the record the store holds.
struct Source {
    entry: Entry,
    id: String,
    record: std::rc::Rc<MemoryRecord>,
}

/// Section 3.2's checks of `submission` drafted as `item` says.
///
/// # Errors
/// `PROPOSAL_DRAFT_MISMATCH` naming the first check that fails; `PROPOSAL_DRAFT_UNVERIFIABLE`
/// for a claim this instance cannot verify; `PROPOSAL_INVALID` for a memory entry not in section
/// 2.1's shape; `PROPOSAL_APPLY_UNAVAILABLE` when the target collection cannot be learned; the
/// store's failures.
pub(crate) fn verify(item: &Draftable<'_, '_, '_>, submission: &Submission) -> Result<(), Outcome> {
    // A pipeline run's own trace is its `run`; any other label would be free text that outlives a
    // redaction in the proposer's `run` and the envelope's `session`.
    if submission
        .run
        .as_deref()
        .is_some_and(|run| run != item.attestation.run)
    {
        return Err(mismatch("run"));
    }
    let cites_memory = submission
        .evidence
        .iter()
        .any(|entry| entry.get("kind").and_then(Value::as_str) == Some("memory"));
    if !cites_memory {
        return memory_free(item, submission);
    }
    if submission.change.op != Op::Create {
        // Memory is drafted only as section 4.5's fixed rendering of a new document.
        return Err(unverifiable(CLAIM_MEMORY));
    }
    let sources = read_sources(item, submission)?;
    let first = &sources[0].record;
    check_fields(submission, &sources)?;

    // The content, against the fixed rendering at the instant it carries.
    let content = submission.change.content.as_deref().unwrap_or_default();
    let Some(settled) = draft::settled_at(content) else {
        return Err(mismatch("content"));
    };
    if sources.iter().any(|s| settled < s.record.recorded_at) || settled > item.caller.now_ms {
        return Err(mismatch("generated-at"));
    }
    let union = |field: fn(&MemoryRecord) -> Vec<String>| -> Vec<String> {
        sources.iter().flat_map(|s| field(&s.record)).collect()
    };
    let rendered = draft::render(&Draft {
        class: first.class,
        subject: &first.subject,
        text: &first.text,
        tags: union(|r| r.tags.clone()),
        constraints: union(|r| r.provenance.constraints.clone().unwrap_or_default()),
        plugin: &item.attestation.plugin,
        instance: &item.attestation.instance,
        settled_at: settled,
    });
    if rendered != content {
        return Err(mismatch("content"));
    }
    check_rationale(submission, &sources, settled)?;
    check_ids(item, submission, &sources)?;
    check_widening(item, submission, &sources)
}

/// A draft citing no memory record: what it may claim is only what this plugin computes, a
/// `scheduled` mode that widens nobody (step 3b, amendment 1).
fn memory_free(item: &Draftable<'_, '_, '_>, submission: &Submission) -> Result<(), Outcome> {
    let drafter = item.drafter;
    if item.derived_from.is_some() {
        Err(mismatch("derived-from"))
    } else if drafter.candidate.is_some() {
        Err(mismatch("candidate"))
    } else if drafter.mode != MODE_SCHEDULED {
        Err(mismatch("mode"))
    } else if drafter.promoted_by.is_some() {
        Err(mismatch("promoted-by"))
    } else if item.conflict_set.is_some() {
        Err(mismatch("conflict-set"))
    } else if matches!(submission.change.op, Op::Create | Op::Update) {
        // Content that renders no memory record has nothing to be compared with.
        Err(unverifiable("content"))
    } else {
        Ok(())
    }
}

fn invalid_entry() -> Outcome {
    failure_invalid(
        "a memory evidence entry has exactly section 2.1's fields, its ref mem-<24 hex>@<version>",
    )
}

fn failure_invalid(why: &str) -> Outcome {
    umbel_sdk::failure(
        "PROPOSAL_INVALID",
        &format!("the proposal was refused: {why}"),
        "Fix the draft; knowledge-propose-batch's input schema and the proposal record's schema list every field.",
    )
}

/// The evidence entries, `derivedFrom`, and each source read once: live, at its version and hash.
fn read_sources(
    item: &Draftable<'_, '_, '_>,
    submission: &Submission,
) -> Result<Vec<Source>, Outcome> {
    // A memory draft cites memory only: any other entry's ref is free text that outlives a
    // redaction.
    if submission
        .evidence
        .iter()
        .any(|entry| entry.get("kind").and_then(Value::as_str) != Some("memory"))
    {
        return Err(mismatch("evidence"));
    }
    let mut parsed = Vec::with_capacity(submission.evidence.len());
    for value in &submission.evidence {
        parsed.push(Entry::parse(value).ok_or_else(invalid_entry)?);
    }
    let ids: BTreeSet<&str> = parsed.iter().map(|(_, id, _)| id.as_str()).collect();
    if ids.len() != parsed.len() || parsed.len() > draft::MAX_SOURCES {
        return Err(mismatch("group"));
    }
    // `derivedFrom` names each source once, as a memory record, with the entry's hash.
    let Some(derived) = item.derived_from else {
        return Err(mismatch("derived-from"));
    };
    let named: BTreeSet<&str> = derived.iter().map(|d| d.id.as_str()).collect();
    if derived.len() != parsed.len() || named != ids || derived.iter().any(|d| d.kind != "memory") {
        return Err(mismatch("derived-from"));
    }
    let mut sources = Vec::with_capacity(parsed.len());
    for (entry, id, version) in parsed {
        let record = match item.sources.read(&id) {
            Ok(Read::Record(record)) => record,
            Ok(Read::Missing) => return Err(mismatch("source-missing")),
            Ok(Read::NotLive) => return Err(mismatch("source-not-live")),
            Err(Unread::Withheld) => return Err(unverifiable(CLAIM_MEMORY)),
            Err(Unread::Failed(outcome)) => return Err(outcome),
        };
        if let Some(check) = sources::unusable(&record, item.caller.now_ms) {
            return Err(mismatch(check));
        }
        if record.record_version != version {
            return Err(mismatch("source-version"));
        }
        let hash = record.content_hash.as_str();
        let derived_hash = derived
            .iter()
            .find(|d| d.id == id)
            .map(|d| d.content_hash.as_str());
        if entry.content_hash != hash || derived_hash != Some(hash) {
            return Err(mismatch("source-hash"));
        }
        sources.push(Source { entry, id, record });
    }
    Ok(sources)
}

/// One group, the copied fields, the confidence, the counts and the excerpts.
fn check_fields(submission: &Submission, sources: &[Source]) -> Result<(), Outcome> {
    let first = &sources[0].record;
    if sources
        .iter()
        .any(|s| s.record.content_hash != first.content_hash || s.record.class != first.class)
    {
        return Err(mismatch("group"));
    }
    for source in sources {
        if let Some(check) = source.entry.copied_mismatch(&source.record) {
            return Err(mismatch(check));
        }
    }
    let highest = sources
        .iter()
        .filter_map(|s| s.record.provenance.confidence)
        .reduce(f64::max);
    if submission.confidence != highest {
        return Err(mismatch("confidence"));
    }
    let principals = principals(sources);
    if sources.iter().any(|s| {
        s.entry.observations.sessions > s.record.observations.sessions
            || s.entry.observations.principals != principals
    }) {
        return Err(mismatch("counts"));
    }
    if sources.iter().any(|s| {
        s.entry
            .excerpt
            .as_ref()
            .is_some_and(|excerpt| *excerpt != draft::excerpt(&s.record.text))
    }) {
        return Err(mismatch("excerpt"));
    }
    Ok(())
}

/// The distinct principals among the sources.
fn principals(sources: &[Source]) -> u64 {
    let distinct: BTreeSet<&str> = sources
        .iter()
        .map(|s| s.record.scope.principal.as_str())
        .collect();
    distinct.len() as u64
}

/// The rationale is the fixed text, of the group's class, an authority no higher than its
/// sources', the settling instant the content carries, and counts within the store's.
fn check_rationale(
    submission: &Submission,
    sources: &[Source],
    settled: i64,
) -> Result<(), Outcome> {
    let Some(rationale) = Rationale::parse(&submission.rationale) else {
        return Err(mismatch("rationale"));
    };
    // `Authority` orders `person` first, so the highest is the least.
    let highest = sources.iter().filter_map(|s| s.record.authority()).min();
    if rationale.class != sources[0].record.class
        || rationale.settled_at != settled
        || highest.is_none_or(|highest| rationale.authority < highest)
    {
        return Err(mismatch("rationale"));
    }
    let sessions: u64 = sources.iter().map(|s| s.record.observations.sessions).sum();
    if rationale.sessions > sessions || rationale.principals > principals(sources) {
        return Err(mismatch("counts"));
    }
    Ok(())
}

/// The candidate, the idempotency key, the conflict set's form, the document id and the conflict
/// set's consistency with its open members.
fn check_ids(
    item: &Draftable<'_, '_, '_>,
    submission: &Submission,
    sources: &[Source],
) -> Result<(), Outcome> {
    let lowest = sources
        .iter()
        .map(|s| s.id.as_str())
        .min()
        .unwrap_or_default();
    let candidate = draft::candidate_id(&item.caller.space, &item.caller.principal, lowest);
    if item.drafter.candidate.as_deref() != Some(candidate.as_str()) {
        return Err(mismatch("candidate"));
    }
    if !draft::is_idempotency_key(&submission.key, &item.attestation.instance, &candidate) {
        return Err(mismatch("key"));
    }
    if item
        .conflict_set
        .is_some_and(|set| !draft::is_conflict_set_id(set))
    {
        return Err(mismatch("conflict-set"));
    }
    let doc = &submission.change.doc;
    let id = item.conflict_set.unwrap_or(&candidate);
    let in_collection = doc
        .split_once('/')
        .is_some_and(|(collection, path)| !collection.is_empty() && path.ends_with(id));
    if !in_collection {
        return Err(mismatch("document"));
    }
    if item.conflict_set.is_some() {
        let first = &sources[0].record;
        let key = draft::subject_key(&first.subject);
        let hash = first.content_hash.as_str();
        if item.members.iter().any(|member| {
            member.doc != *doc
                || member.subject_key.as_deref() != Some(key.as_str())
                || member.hashes.iter().any(|h| h == hash)
        }) {
            return Err(mismatch("conflict-set"));
        }
    }
    Ok(())
}

/// Section 5.1 against the target collection: never more sensitive; widening only as a
/// promotion of the caller's own records, `promotedBy` the caller.
fn check_widening(
    item: &Draftable<'_, '_, '_>,
    submission: &Submission,
    sources: &[Source],
) -> Result<(), Outcome> {
    let (collection, _) = submission.change.doc.split_once('/').unwrap_or_default();
    let Some(info) = propose::collection_info(item.caller.cx, &item.caller.space, collection)
    else {
        return Err(unavailable());
    };
    let target = Target::of_collection(&info);
    if sources
        .iter()
        .any(|s| rank(s.record.sensitivity) > rank(target.sensitivity))
    {
        return Err(mismatch("sensitivity"));
    }
    let wider = target.access.iter().any(|token| {
        sources
            .iter()
            .any(|s| !s.record.access.tokens().contains(token))
    });
    let drafter = item.drafter;
    let promoted = drafter.widens();
    match (wider, promoted) {
        (false, true) | (true, false) => Err(mismatch("mode")),
        (false, false) if drafter.promoted_by.is_some() => Err(mismatch("promoted-by")),
        (false, false) => Ok(()),
        (true, true) => {
            let caller = item.caller.principal.as_str();
            let owns_all = sources.iter().all(|s| s.record.scope.principal == caller);
            if owns_all && drafter.promoted_by.as_deref() == Some(caller) {
                Ok(())
            } else {
                Err(mismatch("promoted-by"))
            }
        }
    }
}

/// Approve's re-checks of a drafted proposal (section 8.2) under the approver's reader filter,
/// and its authors: every source record's principal, read from the store, and `promotedBy`.
///
/// # Errors
/// `PROPOSAL_ACCESS_WIDENED` when the target is now wider or less sensitive than 5.1 allows;
/// `PROPOSAL_SOURCE_GONE` for a source no longer readable, live and at its version;
/// `PROPOSAL_DRAFT_MISMATCH` for a copied field no longer the record's;
/// `PROPOSAL_DRAFT_UNVERIFIABLE` when the `memory` grant is withheld.
pub(crate) fn recheck(
    caller: &Caller<'_>,
    proposal: &Proposal,
) -> Result<BTreeSet<String>, Outcome> {
    let mut authors = BTreeSet::new();
    let Some(drafter) = &proposal.drafter else {
        return Ok(authors);
    };
    if let Some(by) = &drafter.promoted_by {
        authors.insert(by.clone());
    }
    let mut entries = Vec::new();
    for value in &proposal.evidence {
        if value.get("kind").and_then(Value::as_str) != Some("memory") {
            continue;
        }
        let Some(parsed) = Entry::parse(value) else {
            return Err(mismatch_at_approve("evidence"));
        };
        entries.push(parsed);
    }
    if entries.is_empty() {
        return Ok(authors);
    }

    // The target's current readers and sensitivity against what the draft copied (5.1).
    let target = current_target(caller, proposal)?;
    let allowed: Vec<Vec<String>> = if drafter.widens() {
        // A promotion widened the owner's records to the readers the target had when it was
        // submitted, and to no others since.
        vec![
            proposal
                .provenance
                .get("access")
                .and_then(Value::as_array)
                .map(|tokens| {
                    tokens
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
        ]
    } else {
        entries
            .iter()
            .map(|(entry, _, _)| entry.access_tokens())
            .collect()
    };
    let widened = target
        .access
        .iter()
        .any(|token| allowed.iter().any(|set| !set.contains(token)));
    let more_sensitive = entries.iter().any(|(entry, _, _)| {
        entry
            .sensitivity()
            .is_none_or(|s| rank(s) > rank(target.sensitivity))
    });
    if widened || more_sensitive {
        return Err(umbel_sdk::failure(
            "PROPOSAL_ACCESS_WIDENED",
            "the document would now be readable by more people, or is less sensitive, than the memory records this draft cites allow; nothing is applied",
            "Reject the proposal, or restore the target collection's access and sensitivity; the drafter's next run drafts again under the rule.",
        ));
    }

    // Each source still readable, live, at its version, and as the draft copied it.
    let sources = Sources::new(caller);
    for (entry, id, version) in &entries {
        let record = match sources.read(id) {
            Ok(Read::Record(record)) => record,
            Ok(Read::Missing | Read::NotLive) => return Err(gone()),
            Err(Unread::Withheld) => return Err(unverifiable(CLAIM_MEMORY)),
            Err(Unread::Failed(outcome)) => return Err(outcome),
        };
        if sources::unusable(&record, caller.now_ms).is_some()
            || record.record_version != *version
            || record.content_hash.as_str() != entry.content_hash
        {
            return Err(gone());
        }
        if let Some(check) = entry.copied_mismatch(&record) {
            return Err(mismatch_at_approve(check));
        }
        authors.insert(record.scope.principal.clone());
    }
    Ok(authors)
}

/// The target's resolved access set and sensitivity now: the collection's for a create, the
/// document's otherwise.
fn current_target(caller: &Caller<'_>, proposal: &Proposal) -> Result<Target, Outcome> {
    if proposal.change.op == Op::Create {
        let (collection, _) = proposal.split_doc().unwrap_or_default();
        let info = propose::collection_info(caller.cx, &caller.space, collection)
            .ok_or_else(unavailable)?;
        return Ok(Target::of_collection(&info));
    }
    let document = caller
        .cx
        .doc_get(&caller.space, &proposal.change.doc)
        .map_err(|error| crate::fail::host(&error))?
        .ok_or_else(super::common::not_found)?;
    Ok(Target {
        access: document.write.access.tokens().to_vec(),
        sensitivity: document.write.sensitivity,
    })
}
