//! `memory-forget` (sections 7.2 to 7.4 and 8.7): erase the caller's own records by `ids`, or by
//! one selector (`session`, `project`, `before`), which needs authority `person`. The host checks
//! the authority of each record first (6.3) and the store erases only the caller's records, by
//! 5.4's order: the key destroyed, the rows removed, a tombstone and the erased capture prefix.

use serde::Deserialize;
use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, success};
use umbel_store::ForgetSelector;
use umbel_store::memory::{ForgetReceipt, MAX_FORGET_IDS, WalState, check_memory_id};

use crate::fail;
use crate::pipeline::{self, Call};

/// The limits of section 5.4, said with every forget.
pub(crate) const LIMITS: &str = "A forget destroys the record's key and removes its text and index from Umbel's live state; its store-backup copies can no longer open it. It does not reach file-level or machine-backup copies of memory.sqlite3 or memory.keys taken earlier, what a caller already received, harness transcripts, exported files or text copied into other commands. The journal and events keep the record's id, owner, time, project and session labels, never its text. Remove the source too, or a later import or capture can bring the text back.";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    #[serde(default)]
    #[allow(dead_code)]
    space: Option<String>,
    ids: Option<Vec<String>>,
    session: Option<String>,
    project: Option<String>,
    before: Option<String>,
}

pub(crate) fn run(input: &Value, cx: &Cx) -> Outcome {
    match forget(input, cx) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

fn selector(input: Input, call: &Call) -> Result<ForgetSelector, Outcome> {
    let given = [
        input.ids.is_some(),
        input.session.is_some(),
        input.project.is_some(),
        input.before.is_some(),
    ];
    if given.iter().filter(|g| **g).count() != 1 {
        return Err(fail::invalid(
            "name exactly one of ids, session, project or before",
        ));
    }
    if let Some(ids) = input.ids {
        if ids.is_empty() || ids.len() > MAX_FORGET_IDS {
            return Err(fail::invalid("ids names 1 to 100 records"));
        }
        if ids.iter().any(|id| check_memory_id(id).is_err()) {
            return Err(fail::invalid(
                "ids holds memory ids: mem- and 24 lowercase hex digits",
            ));
        }
        let mut unique = ids;
        unique.sort();
        unique.dedup();
        return Ok(ForgetSelector::Ids(unique));
    }
    if let Some(session) = input.session {
        call.check_label("session", &session)?;
        return Ok(ForgetSelector::Session(session));
    }
    if let Some(project) = input.project {
        call.check_label("project", &project)?;
        return Ok(ForgetSelector::Project(project));
    }
    let before = input.before.unwrap_or_default();
    Ok(ForgetSelector::Before(pipeline::parse_time(
        "before", &before,
    )?))
}

/// The last revision of the call's own erasure: its `Erased` changes carry its trace id, and each
/// was of the caller's own record, so the caller reads every one.
fn last_rev(cx: &Cx, space: &str, trace: &str) -> Option<u64> {
    let mut after = 0;
    let mut last = None;
    loop {
        let page = cx.memory_changes(space, after, 1000, Some(trace)).ok()?;
        let Some(change) = page.last() else {
            return last;
        };
        after = change.rev;
        last = Some(change.rev);
        if page.len() < 1000 {
            return last;
        }
    }
}

fn forget(input: &Value, cx: &Cx) -> Result<Outcome, Outcome> {
    let input: Input = serde_json::from_value(input.clone())
        .map_err(|_| fail::invalid("the input does not match memory-forget's schema"))?;
    let call = Call::open(cx)?;
    let selector = selector(input, &call)?;
    let asked = match &selector {
        ForgetSelector::Ids(ids) => ids.clone(),
        _ => Vec::new(),
    };
    let receipt = match cx.memory_forget(&call.space, selector) {
        Ok(receipt) => receipt,
        // Nothing was ever written: every id is as absent as any other.
        Err(HostError::NotProvisioned) => ForgetReceipt {
            erased: 0,
            ids: Vec::new(),
            not_found: asked,
            wal: WalState::Clean,
        },
        Err(error) => return Err(fail::host(&error)),
    };
    let wal = match receipt.wal {
        WalState::Clean => "clean",
        WalState::Pending => "pending",
    };
    let mut outcome = success(json!({
        "erased": receipt.erased,
        "ids": receipt.ids,
        "notFound": receipt.not_found,
        "wal": wal,
    }))
    .with_suggestion(LIMITS);
    if receipt.wal == WalState::Pending {
        outcome = outcome.with_warning(
            "MEMORY_ERASURE_PENDING",
            "the keys are destroyed and the text cannot be opened, but the index and the write-ahead log still wait to be rewritten; run store-check, which finishes it",
        );
    }
    if receipt.erased > 0 {
        let mut record = json!({ "kind": "memory-erasure", "id": call.trace });
        if let Some(rev) = last_rev(cx, &call.space, &call.trace) {
            record["version"] = json!(rev);
        }
        outcome = outcome
            .with_metadata("dev.umbel/record", record)
            .with_metadata(
                "dev.umbel/provenance",
                json!({
                    "session": null,
                    "access": [format!("principal:{}", call.principal)],
                    "sensitivity": "internal",
                }),
            );
    }
    Ok(outcome)
}
