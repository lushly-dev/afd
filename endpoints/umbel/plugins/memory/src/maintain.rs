//! `memory-sweep` and `memory-reindex` (section 8.8, D89), command line only and journaled plain:
//! neither carries text.
//!
//! - A sweep purges at most `limit` records past their purge date by the `policy` pack's
//!   `purge_after_days`, removes idempotency receipts past 90 days and checkpoints. It leaves
//!   orphan keys alone.
//! - A reindex rebuilds the lexical lane and counts orphan keys; it removes them only with
//!   `removeOrphans = true`.

use serde::Deserialize;
use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, success};
use umbel_store::memory::{MAX_SWEEP_LIMIT, ReindexReceipt, SweepReceipt};

use crate::fail;
use crate::policy::Policy;

const DEFAULT_SWEEP_LIMIT: u32 = 1000;

/// What `memory-reindex` says when it found orphans and kept them (D89).
pub(crate) const ORPHANS_KEPT: &str = "Orphan keys were counted and kept. Pass removeOrphans = true only on the database you mean to keep: on a restored older copy, the orphans are the keys of records written after it, and removing them makes those records unreadable if the newer database is put back.";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SweepInput {
    #[serde(default)]
    #[allow(dead_code)]
    space: Option<String>,
    limit: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReindexInput {
    #[serde(default)]
    #[allow(dead_code)]
    space: Option<String>,
    #[serde(default)]
    remove_orphans: bool,
}

pub(crate) fn sweep(input: &Value, cx: &Cx) -> Outcome {
    match run_sweep(input, cx) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

pub(crate) fn reindex(input: &Value, cx: &Cx) -> Outcome {
    match run_reindex(input, cx) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

fn run_sweep(input: &Value, cx: &Cx) -> Result<Outcome, Outcome> {
    let input: SweepInput = serde_json::from_value(input.clone())
        .map_err(|_| fail::invalid("the input does not match memory-sweep's schema"))?;
    let limit = input.limit.unwrap_or(DEFAULT_SWEEP_LIMIT);
    if limit == 0 || limit > MAX_SWEEP_LIMIT {
        return Err(fail::invalid("limit is from 1 to 10000"));
    }
    let space = cx.call().space.clone().ok_or_else(fail::no_space)?;
    let policy = Policy::load(cx)?;
    let receipt = match cx.memory_sweep(&space, limit, policy.retention()) {
        Ok(receipt) => receipt,
        Err(HostError::NotProvisioned) => SweepReceipt {
            purged: 0,
            remaining: 0,
        },
        Err(error) => return Err(fail::host(&error)),
    };
    let mut outcome = success(json!({
        "purged": receipt.purged,
        "remaining": receipt.remaining,
    }));
    if receipt.remaining > 0 {
        outcome = outcome
            .with_suggestion("Run memory-sweep again: more records are past their purge date.");
    }
    if receipt.purged > 0 {
        // Counts only: the sweep purges records of every owner, and its event lists none. The
        // store's revisions of other owners' purges are not the caller's to read, so the event's
        // range is in its `changes` alone (amendment 2 of step 6).
        outcome = outcome
            .with_metadata(
                "dev.umbel/record",
                json!({ "kind": "memory-sweep", "id": space }),
            )
            .with_metadata(
                "dev.umbel/provenance",
                json!({ "session": null, "access": ["space"], "sensitivity": "internal" }),
            );
    }
    Ok(outcome)
}

fn run_reindex(input: &Value, cx: &Cx) -> Result<Outcome, Outcome> {
    let input: ReindexInput = serde_json::from_value(input.clone())
        .map_err(|_| fail::invalid("the input does not match memory-reindex's schema"))?;
    let space = cx.call().space.clone().ok_or_else(fail::no_space)?;
    let receipt = match cx.memory_reindex(&space, input.remove_orphans) {
        Ok(receipt) => receipt,
        Err(HostError::NotProvisioned) => ReindexReceipt {
            reindexed: 0,
            unreadable: 0,
            orphans: 0,
            orphans_removed: 0,
        },
        Err(error) => return Err(fail::host(&error)),
    };
    let mut outcome = success(json!({
        "reindexed": receipt.reindexed,
        "unreadable": receipt.unreadable,
        "orphans": receipt.orphans,
        "orphansRemoved": receipt.orphans_removed,
    }));
    if receipt.orphans > receipt.orphans_removed {
        outcome = outcome.with_suggestion(ORPHANS_KEPT);
    }
    if receipt.unreadable > 0 {
        outcome = outcome.with_warning_details(
            "MEMORY_UNREADABLE",
            &format!(
                "{} records did not open and were left out of the index; run store-check",
                receipt.unreadable
            ),
            json!({ "count": receipt.unreadable }),
        );
    }
    Ok(outcome)
}
