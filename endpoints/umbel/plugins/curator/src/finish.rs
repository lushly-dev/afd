//! `curator-finish` (phase 4 specification, sections 3.1, 7.1 to 7.3 and 11.1): the last step of
//! `curator-run`. It records what the batch did with each draft and withdrawal, applies the
//! feedback the knowledge feed returned, writes the run's report and returns it, and releases the
//! caller's lock **only if it is this run's**; otherwise it records its report and leaves the state.
//!
//! - **Drafts.** A stored or found open proposal makes its candidate (or review) `drafted`, with
//!   the proposal id the batch answered. A refusal is reported by code; one that may hide a stored
//!   proposal under the key (`PROPOSAL_KEY_REUSED`, `PROPOSAL_DRAFT_MISMATCH`) moves the draft
//!   number on, so the next run withdraws that proposal and drafts under a new key. A review the
//!   batch refuses waits `every_hours`.
//! - **Withdrawals.** A withdrawn (or never stored, or already decided) proposal is no longer the
//!   record's; the candidate is evaluated afresh by the next run.
//! - **Feedback** (7.1). A rejection marks the candidate `rejected`, keeps the approver's reason in
//!   the caller's own record (never shown, dropped on erase), and quiets it for `quiet_days`; an
//!   apply marks it `applied` with `promotedTo`, never drafted again. A review is quieted or closed
//!   alike.
//! - **The report** (7.2) holds ids and counts only, so the pipeline's answer, cron mail and CI
//!   logs hold no memory text; it carries the batch's `checkpoint` (the warning
//!   `PROPOSAL_REDACTION_PENDING` reaches the run's answer only there).

use std::collections::BTreeSet;

use serde_json::{Map, Value, json};
use umbel_sdk::{Cx, Outcome, failure, success};
use umbel_store::Sensitivity;
use umbel_store::memory::{Millis, format_instant};

use crate::evaluate::Status;
use crate::records::{self, CANDIDATE, REVIEW, RUN, VERSION};
use crate::review::{self, ReviewStatus};
use crate::run::{self, Bookkeeping, Subject};
use crate::settings::Call;
use crate::state::{self, State};

pub(crate) fn run(input: &Value, cx: &Cx) -> Outcome {
    match finish(input, cx) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

fn invalid(what: &str) -> Outcome {
    failure(
        "CURATOR_INVALID",
        &format!("curator-finish was given what curator-plan and the batch did not write: {what}"),
        "Run curator-run again; its steps pass these values themselves.",
    )
}

/// The proposal states in which a draft is still open.
fn is_open(state: Option<&str>) -> bool {
    matches!(state, Some("pending" | "approved"))
}

/// A record body's fields to change, applied to the caller's record `kind`/`id` with
/// compare-and-set. An absent or foreign record is left alone.
fn update(
    cx: &Cx,
    call: &Call,
    (kind, id): (&str, &str),
    edit: impl FnOnce(&mut Map<String, Value>) -> bool,
) -> Result<(), Outcome> {
    let Some(record) = records::get(cx, &call.space, &call.principal, kind, id)? else {
        return Ok(());
    };
    let Value::Object(mut body) = record.body.clone() else {
        return Ok(());
    };
    if body.get("status").and_then(Value::as_str) == Some(Status::Erased.as_str()) {
        // Nothing of an erased candidate is written again.
        return Ok(());
    }
    if !edit(&mut body) {
        return Ok(());
    }
    let sensitivity: Sensitivity = body
        .get("sensitivity")
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or(Sensitivity::Internal);
    let access = record.envelope.access.clone();
    records::put(
        cx,
        &call.space,
        call.now,
        (kind, id),
        Value::Object(body),
        (access, sensitivity),
        records::expect(Some(&record.content_hash)),
    )
}

fn set(body: &mut Map<String, Value>, key: &str, value: Value) {
    body.insert(key.to_owned(), value);
}

/// A candidate's record after its draft is no longer open: evaluated afresh by the next run.
fn reopen(body: &mut Map<String, Value>) {
    set(body, "status", json!(Status::Settling.as_str()));
    set(body, "proposal", Value::Null);
    set(body, "reason", Value::Null);
}

/// What the report counts as this run's.
#[derive(Default)]
struct Tally {
    drafted: u64,
    reverify: u64,
    deprecate: u64,
    rejected: u64,
    applied: u64,
    withdrawn: u64,
    refused: Vec<Value>,
    proposals: Vec<String>,
}

fn error_code(result: &Value) -> (String, Option<String>) {
    let error = &result["error"];
    (
        error["code"].as_str().unwrap_or("UNKNOWN").to_owned(),
        error["details"]["check"].as_str().map(str::to_owned),
    )
}

fn finish(input: &Value, cx: &Cx) -> Result<Outcome, Outcome> {
    let attestation = run::attested(cx)?;
    if input.get("run").and_then(Value::as_str) != Some(attestation.run.as_str()) {
        return Err(invalid("run is not this run's trace id"));
    }
    let call = Call::open(cx)?;
    let kept = input
        .get("plan")
        .and_then(Bookkeeping::parse)
        .ok_or_else(|| invalid("plan"))?;
    let list = |key: &str| -> Result<Vec<Value>, Outcome> {
        input
            .get(key)
            .and_then(Value::as_array)
            .cloned()
            .ok_or_else(|| invalid(key))
    };
    let results = list("results")?;
    let withdrawals = list("withdrawals")?;
    if results.len() != kept.drafts.len() || withdrawals.len() != kept.withdrawals.len() {
        return Err(invalid("the batch's results do not match the plan"));
    }
    let feed = input.get("feed").ok_or_else(|| invalid("feed"))?;
    let decisions = feed
        .get("decisions")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| invalid("feed.decisions"))?;
    let feed_next = feed
        .get("next")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid("feed.next"))?;
    let (space, principal, now) = (call.space.clone(), call.principal.clone(), call.now);
    let settle = &call.settle;
    let mut tally = Tally::default();

    // The drafts, in the batch's order.
    for (planned, result) in kept.drafts.iter().zip(&results) {
        let kind = match planned.subject {
            Subject::Candidate => CANDIDATE,
            Subject::Review => REVIEW,
        };
        if result["ok"] == true {
            let proposal = result["proposal"]["id"]
                .as_str()
                .unwrap_or(&planned.proposal);
            let open = is_open(result["proposal"]["state"].as_str());
            if open {
                match (planned.subject, planned.op.as_deref()) {
                    (Subject::Candidate, _) => tally.drafted += 1,
                    (Subject::Review, Some("deprecate")) => tally.deprecate += 1,
                    (Subject::Review, _) => tally.reverify += 1,
                }
                if tally.proposals.len() < 50 && !tally.proposals.iter().any(|p| p == proposal) {
                    tally.proposals.push(proposal.to_owned());
                }
            }
            let proposal = proposal.to_owned();
            update(cx, &call, (kind, &planned.id), |body| {
                if open {
                    set(body, "status", json!("drafted"));
                    set(body, "proposal", json!(proposal));
                } else if planned.subject == Subject::Candidate {
                    // Found decided or withdrawn under its key: the feed says which.
                    reopen(body);
                } else {
                    set(body, "status", json!(ReviewStatus::Withdrawn.as_str()));
                    set(body, "proposal", Value::Null);
                }
                true
            })?;
        } else {
            let (code, check) = error_code(result);
            let mut refused = json!({ "code": code });
            match planned.subject {
                Subject::Candidate => refused["candidate"] = json!(planned.id),
                Subject::Review => {}
            }
            if let Some(check) = &check {
                refused["check"] = json!(check);
            }
            let hides_a_proposal = matches!(
                code.as_str(),
                "PROPOSAL_KEY_REUSED" | "PROPOSAL_DRAFT_MISMATCH"
            );
            let key = planned.key;
            update(cx, &call, (kind, &planned.id), |body| {
                if let Some(doc) = body.get("doc").cloned() {
                    refused["doc"] = doc;
                }
                if hides_a_proposal {
                    // The next run withdraws what the key may hold, then drafts under a new one.
                    set(body, "drafts", json!(key + 2));
                }
                if planned.subject == Subject::Review {
                    set(body, "status", json!(ReviewStatus::Refused.as_str()));
                    set(
                        body,
                        "quietUntil",
                        json!(format_instant(
                            now.saturating_add(review::refused_quiet(settle))
                        )),
                    );
                    if !hides_a_proposal {
                        set(body, "proposal", Value::Null);
                    }
                }
                true
            })?;
            tally.refused.push(refused);
        }
    }

    // The withdrawals, in the batch's order.
    for (planned, result) in kept.withdrawals.iter().zip(&withdrawals) {
        let gone = if result["ok"] == true {
            tally.withdrawn += u64::from(result["withdrawn"] == true);
            true
        } else {
            // Never stored, or decided meanwhile (the feed has the decision): not open either way.
            matches!(
                error_code(result).0.as_str(),
                "PROPOSAL_NOT_FOUND" | "PROPOSAL_STATE_INVALID"
            )
        };
        if !gone {
            continue;
        }
        let kind = match planned.subject {
            Subject::Candidate => CANDIDATE,
            Subject::Review => REVIEW,
        };
        let proposal = planned.proposal.clone();
        update(cx, &call, (kind, &planned.id), |body| {
            if body.get("proposal").and_then(Value::as_str) != Some(proposal.as_str()) {
                return false;
            }
            match planned.subject {
                Subject::Candidate => reopen(body),
                Subject::Review => {
                    set(body, "status", json!(ReviewStatus::Withdrawn.as_str()));
                    set(body, "proposal", Value::Null);
                }
            }
            true
        })?;
    }
    if let Some(erased) = input.get("erased").filter(|e| e.is_object()) {
        tally.withdrawn += erased["withdrawn"].as_array().map_or(0, Vec::len) as u64;
    }

    // The feed's decisions on this caller's drafts.
    let quiet = settle.quiet();
    for decision in &decisions {
        let Some(proposal) = decision["proposal"].as_str() else {
            continue;
        };
        let state = decision["state"].as_str().unwrap_or_default();
        let (kind, id) = match decision["candidate"].as_str() {
            Some(candidate) => (CANDIDATE, candidate.to_owned()),
            None => match decision["doc"].as_str() {
                Some(doc) => (REVIEW, review::review_id(&space, &principal, doc)),
                None => continue,
            },
        };
        let rejected = state == "rejected";
        if !rejected && state != "applied" {
            continue;
        }
        if rejected {
            tally.rejected += 1;
        } else {
            tally.applied += 1;
        }
        let reason = decision["reason"].as_str().map(str::to_owned);
        let doc = decision["doc"].clone();
        update(cx, &call, (kind, &id), |body| {
            let mine = body.get("proposal").and_then(Value::as_str);
            if mine.is_some_and(|p| p != proposal) {
                // A later draft of the same candidate is the record's now.
                return false;
            }
            set(body, "proposal", Value::Null);
            if rejected {
                set(body, "status", json!("rejected"));
                set(
                    body,
                    "quietUntil",
                    json!(format_instant(now.saturating_add(quiet))),
                );
                if kind == CANDIDATE {
                    // The approver's reason, the caller's to read in their own record only; a
                    // redacted rejection keeps none.
                    set(
                        body,
                        "reason",
                        json!(reason.clone().unwrap_or_else(|| "rejected".to_owned())),
                    );
                }
            } else {
                set(body, "status", json!("applied"));
                set(body, "quietUntil", Value::Null);
                if kind == CANDIDATE {
                    set(body, "promotedTo", doc.clone());
                    set(body, "reason", Value::Null);
                }
            }
            true
        })?;
    }

    // The batch's checkpoint, and plan's own after it erased curator records: pending if either is.
    let checkpoint = [
        kept.checkpoint,
        match input.get("checkpoint").and_then(Value::as_str) {
            Some("clean") => Some("clean"),
            Some("pending") => Some("pending"),
            _ => None,
        },
    ]
    .into_iter()
    .flatten()
    .max_by_key(|state| *state == "pending");
    let report = report(&call, &attestation.run, &kept, &tally, checkpoint, settle);

    // The run record, then the state if the lock is still this run's.
    let run_id = state::run_id(&attestation.run);
    records::put(
        cx,
        &space,
        now,
        (RUN, &run_id),
        json!({
            "version": VERSION,
            "kind": RUN,
            "id": run_id,
            "space": space,
            "principal": principal,
            "access": records::own(&principal),
            "startedAt": format_instant(kept.started_at),
            "finishedAt": format_instant(now),
            "report": report,
        }),
        (records::own(&principal), Sensitivity::Internal),
        umbel_store::Expect::Any,
    )?;
    let released = state::release(
        cx,
        &space,
        &principal,
        &attestation.run,
        now,
        State {
            feed_after: feed_next,
            cursors: kept.cursors.clone(),
            last_run: Some(run_id),
            lock: None,
        },
    )?;

    let mut outcome = success(report.clone()).with_reasoning(&format!(
        "Drafted {}, re-verify {}, deprecate {}; withdrew {}; {} rejected and {} applied since the last run; {} refused.",
        tally.drafted,
        tally.reverify,
        tally.deprecate,
        tally.withdrawn,
        tally.rejected,
        tally.applied,
        tally.refused.len()
    ));
    if !released {
        outcome = outcome.with_warning(
            "CURATOR_LOCK_TAKEN_OVER",
            "another run took this run's lock over after it expired; this run recorded its report and left the cursors to that run",
        );
    }
    if checkpoint == Some("pending") {
        outcome = outcome.with_warning(
            "PROPOSAL_REDACTION_PENDING",
            "redacted text is gone from the proposals, but a reader holds the store's write-ahead log, which keeps the earlier bytes until a later checkpoint; run store-check once no reader holds the store",
        );
    }
    let skipped = report["skipped"].as_array().map_or(0, Vec::len);
    if skipped > 0 {
        let mut by_reason: Map<String, Value> = Map::new();
        for entry in report["skipped"].as_array().into_iter().flatten() {
            let reason = entry["reason"].as_str().unwrap_or_default().to_owned();
            let n = by_reason.get(&reason).and_then(Value::as_u64).unwrap_or(0);
            by_reason.insert(reason, json!(n + 1));
        }
        outcome = outcome.with_warning_details(
            "CURATOR_CANDIDATES_SKIPPED",
            "the run skipped candidates; the report's skipped list names each by id and reason",
            Value::Object(by_reason),
        );
    }
    Ok(outcome)
}

/// The run report (`curator-report.v1.json`).
fn report(
    call: &Call,
    run: &str,
    kept: &Bookkeeping,
    tally: &Tally,
    checkpoint: Option<&str>,
    settle: &crate::pack::Settle,
) -> Value {
    let counted = &kept.counted;
    let overdue_after: Millis = call
        .now
        .saturating_add(2 * Millis::from(settle.every_hours) * umbel_store::memory::HOUR_MS);
    let mut seen = BTreeSet::new();
    let inconsistencies: Vec<Value> = counted
        .inconsistencies
        .iter()
        .filter(|entry| seen.insert(entry.to_string()))
        .cloned()
        .collect();
    json!({
        "version": VERSION,
        "space": call.space,
        "principal": call.principal,
        "run": run,
        "at": format_instant(call.now),
        "counts": {
            "read": counted.read,
            "settled": counted.settled,
            "candidates": counted.candidates,
            "drafted": tally.drafted,
            "needsPromotion": counted.needs_promotion,
            "skipped": counted.skipped.len(),
            "rejected": tally.rejected,
            "applied": tally.applied,
            "withdrawn": tally.withdrawn,
            "reverify": tally.reverify,
            "deprecate": tally.deprecate,
            "refused": tally.refused.len(),
            "remaining": counted.remaining,
        },
        "skipped": counted.skipped,
        "inconsistencies": inconsistencies,
        "refused": tally.refused,
        "proposals": tally.proposals,
        "checkpoint": checkpoint,
        "next": { "overdueAfter": format_instant(overdue_after) },
    })
}
