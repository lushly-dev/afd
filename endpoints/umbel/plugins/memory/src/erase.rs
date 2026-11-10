//! `memory-erase` and `memory-erase-preview` (phase 5 specification, section 8.4; D85, D118,
//! owner decision 9): a listed eraser, verified on the person page, removes another principal's
//! records, blind, on phase 3's forget path.
//!
//! - **The dry run** (`dryRun = true`, required first) answers only a count and the `plan`, the
//!   SHA-256 of the sorted ids and versions the erase would reach.
//! - **The erase** presents that plan; the host erases only when the target's records still have
//!   it (`MEMORY_ERASE_PLAN_STALE` otherwise). With `erase_approvals = 2` the first eraser's erase
//!   only writes an erase request (`awaiting-second-eraser`), and a second eraser, another person
//!   through equivalents, approves it with `request` inside `erase_approval_window_s`.
//! - **Counts only.** No answer, message, journal entry or event names a record's id or holds its
//!   text. The event goes to the erased principal's own stream (access `principal:<erased>`), and
//!   the host adds to it every eraser who acted.
//!
//! The host checks everything that grants: the person decision for this call, `erasers`, the
//! target, the plan and the two-person rule; this module checks shapes and words the answer.
//! `memory-erase-preview` renders what the person confirms on the page; run by the host as the
//! caller before it asks (`CallContext::person_check`), it makes the erase's own checks first.

use serde::Deserialize;
use serde_json::{Value, json};
use umbel_sdk::{Cx, EraseAnswer, EraseCall, HostError, Outcome, failure, success};
use umbel_store::memory::{WalState, format_instant};

use crate::fail;

/// What every erase answer says of what remains (sections 8.4 and 13.2, D85).
pub(crate) const RESIDUE: &str = "An erase destroys each record's key and removes its text and index from Umbel's live state, as a forget does; store-backup copies can no longer open them. It does not reach file-level or machine-backup copies taken earlier, what a caller already received, harness transcripts or exported files. The journal and events keep the erase's kept input (the space, the principal, the ids named, the plan and the request), its erasers, the count and the time, and the erased records' ids in the store's change log, never their text.";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    #[serde(default)]
    #[allow(dead_code)]
    space: Option<String>,
    principal: String,
    #[serde(default)]
    ids: Option<Vec<String>>,
    dry_run: bool,
    #[serde(default)]
    plan: Option<String>,
    #[serde(default)]
    request: Option<String>,
}

impl Input {
    fn call(&self) -> EraseCall {
        let mut ids = self.ids.clone();
        if let Some(ids) = &mut ids {
            ids.sort();
        }
        EraseCall {
            principal: self.principal.clone(),
            ids,
            dry_run: self.dry_run,
            plan: self.plan.clone(),
            request: self.request.clone(),
        }
    }
}

fn parse(input: &Value, command: &str) -> Result<Input, Outcome> {
    serde_json::from_value(input.clone())
        .map_err(|_| fail::invalid(&format!("the input does not match {command}'s schema")))
}

/// A host refusal, with `details.request` for the two codes that name one (section 10.5).
fn refused(error: &HostError, request: Option<&str>) -> Outcome {
    let outcome = fail::host(error).with_retryable(false);
    let names_request = matches!(
        error,
        HostError::Invalid(text) | HostError::NotGranted(text)
            if text.starts_with("MEMORY_ERASE_SECOND_ERASER_REQUIRED")
                || text.starts_with("MEMORY_ERASE_REQUEST_EXPIRED")
    );
    match request {
        Some(request) if names_request => outcome.with_error_details(json!({ "request": request })),
        _ => outcome,
    }
}

pub(crate) fn run(input: &Value, cx: &Cx) -> Outcome {
    let input = match parse(input, "memory-erase") {
        Ok(input) => input,
        Err(outcome) => return outcome,
    };
    let Some(space) = cx.call().space.clone() else {
        return fail::no_space();
    };
    let answer = match cx.memory_erase(&space, input.call()) {
        Ok(answer) => answer,
        Err(error) => return refused(&error, input.request.as_deref()),
    };
    match answer {
        EraseAnswer::Planned { count, plan } => success(json!({
            "dryRun": true,
            "count": count,
            "plan": plan,
        }))
        .with_reasoning(&format!(
            "Counted the records an erase of {} in {space} would reach; nothing was erased.",
            input.principal
        ))
        .with_suggestion(
            "Run memory-erase again with dryRun = false and this plan to erase them; the person page shows the count before anyone approves.",
        ),
        EraseAnswer::Awaiting {
            request,
            expires_at,
        } => success(json!({
            "dryRun": false,
            "status": "awaiting-second-eraser",
            "request": request,
            "expiresAt": format_instant(expires_at),
        }))
        .with_reasoning("Recorded the first eraser's approval; nothing is erased until a second eraser approves.")
        .with_suggestion(
            "Ask another eraser, a different person, to run the dry run and then memory-erase with the same principal, plan and this request before it expires.",
        ),
        EraseAnswer::Erased {
            erased,
            wal,
            erasers,
            ..
        } => {
            erased_outcome(&cx.call().trace_id, &input.principal, erased, wal, erasers.len())
        }
    }
}

fn erased_outcome(
    trace: &str,
    principal: &str,
    erased: u64,
    wal: WalState,
    erasers: usize,
) -> Outcome {
    let wal_text = match wal {
        WalState::Clean => "clean",
        WalState::Pending => "pending",
    };
    let mut outcome = success(json!({
        "dryRun": false,
        "status": "erased",
        "erased": erased,
        "erasers": erasers,
        "wal": wal_text,
    }))
    .with_suggestion(RESIDUE);
    if wal == WalState::Pending {
        outcome = outcome.with_warning(
            "MEMORY_ERASURE_PENDING",
            "the keys are destroyed and the text cannot be opened, but the index and the write-ahead log still wait to be rewritten; run store-check, which finishes it",
        );
    }
    if erased > 0 {
        // The erased principal's notice: their own stream alone, never the erasers'. The host
        // adds every eraser who acted, the count, the request and the plan.
        outcome = outcome
            .with_metadata(
                "dev.umbel/record",
                json!({ "kind": "memory-erase-notice", "id": trace }),
            )
            .with_metadata(
                "dev.umbel/provenance",
                json!({
                    "session": null,
                    "access": [format!("principal:{principal}")],
                    "sensitivity": "internal",
                }),
            );
    }
    outcome
}

/// `memory-erase-preview`: what the person confirms, from the decision's kept properties alone.
pub(crate) fn preview(input: &Value, cx: &Cx) -> Outcome {
    let input = match parse(input, "memory-erase-preview") {
        Ok(input) => input,
        Err(outcome) => return outcome,
    };
    let call = cx.call();
    if let Some(check) = &call.person_check
        && check.command != "memory-erase"
    {
        return failure(
            "MEMORY_ERASE_NOT_ALLOWED",
            "this preview is memory-erase's alone",
            "Erase with memory-erase.",
        );
    }
    let Some(space) = call.space.clone() else {
        return fail::no_space();
    };
    let shown = match cx.memory_erase_preview(&space, input.call()) {
        Ok(shown) => shown,
        Err(error) => return refused(&error, input.request.as_deref()),
    };
    let reach = match &input.ids {
        Some(ids) => format!("only the {} records named by id", ids.len()),
        None => "every record they own, whoever may read it".to_owned(),
    };
    let mut text = String::new();
    if input.dry_run {
        text.push_str(&format!(
            "A dry run of erasing the memory records of {} in space {space} ({reach}).\n",
            input.principal
        ));
        text.push_str(
            "It counts the records and computes the plan an erase must present. Nothing is erased.\n",
        );
    } else {
        let count = shown.count.unwrap_or(0);
        text.push_str(&format!(
            "Erase {count} memory record{} of {} in space {space} ({reach}).\n",
            if count == 1 { "" } else { "s" },
            input.principal
        ));
        text.push_str(&format!(
            "  plan: {}\n",
            input.plan.as_deref().unwrap_or_default()
        ));
        text.push_str(
            "  The plan names these records as they are now; if any changes before the erase runs, nothing is erased.\n",
        );
        match (&input.request, &shown.request) {
            (Some(request), Some((first, expires))) => text.push_str(&format!(
                "  You approve erase request {request} of {first}, as the second eraser; it expires {}.\n",
                format_instant(*expires)
            )),
            _ if shown.approvals >= 2 => text.push_str(
                "  This workspace needs two erasers: your approval records an erase request, and nothing is erased until another eraser approves it.\n",
            ),
            _ => {}
        }
        text.push_str(
            "This cannot be undone: each record's key is destroyed and its text removed. The erased principal is told who erased, how many records and when.\n",
        );
    }
    success(json!({ "preview": text }))
}
