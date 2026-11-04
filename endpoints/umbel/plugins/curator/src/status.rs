//! `curator-status` (phase 4 specification, sections 7.2, 7.3 and 9.2): the caller's last run
//! report, whether runs are `overdue` (none, or the last older than twice `every_hours`), whether
//! the caller's lock is held, the candidates the caller may promote, and the memory records whose
//! owner, the caller, may close with `memory-invalidate` (reason `outdated`) now that a person
//! applied them as knowledge. The curator never writes memory itself (owner decision 8).
//!
//! Plugins have no doctor API (`doctor.rs`), so `overdue` is reported here only. Everything is the
//! caller's own: their records, read under their reader filter, as ids and counts, never text.

use serde_json::{Value, json};
use umbel_sdk::{Cx, Outcome, success};
use umbel_store::memory::{HOUR_MS, Millis, format_instant, parse_instant};

use crate::candidates::{Found, find};
use crate::evaluate::{Mode, Status};
use crate::read;
use crate::records::{self, RUN};
use crate::settings::Call;
use crate::state;

/// The most invalidatable records listed.
const MAX_LISTED: usize = 500;

pub(crate) fn run(_input: &Value, cx: &Cx) -> Outcome {
    match status(cx) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

fn status(cx: &Cx) -> Result<Outcome, Outcome> {
    let call = Call::open(cx)?;
    let (space, principal, now) = (call.space.as_str(), call.principal.as_str(), call.now);
    let (state, _) = state::load(cx, space, principal)?;
    let last = match &state.last_run {
        Some(id) => records::get(cx, space, principal, RUN, id)?,
        None => None,
    };
    let report = last.as_ref().map(|record| record.body["report"].clone());
    let finished: Option<Millis> = last
        .as_ref()
        .and_then(|record| record.body["finishedAt"].as_str())
        .and_then(|at| parse_instant(at).ok());
    let overdue_after =
        finished.map(|at| at.saturating_add(2 * Millis::from(call.settle.every_hours) * HOUR_MS));
    let overdue = overdue_after.is_none_or(|after| now > after);

    let Found { evaluation, .. } = find(cx, &call)?;
    let promotable: Vec<Value> = evaluation
        .candidates
        .iter()
        .filter(|c| {
            c.status == Status::NeedsPromotion && c.own && c.source_count == c.sources.len()
        })
        .map(|c| json!({ "candidate": c.id, "sources": c.sources.len(), "doc": c.doc }))
        .collect();
    let promoted: Vec<&str> = evaluation
        .candidates
        .iter()
        .filter(|c| matches!(c.mode, Some(Mode::Promoted { .. })))
        .map(|c| c.id.as_str())
        .collect();

    // After an apply, the caller's own sources that still stand may be closed by their owner.
    let mut invalidatable = Vec::new();
    for stored in records::stored(cx, space, principal)? {
        if stored.status != Status::Applied {
            continue;
        }
        for source in &stored.sources {
            if invalidatable.len() >= MAX_LISTED {
                break;
            }
            if let Some(record) = read::get(cx, space, &source.id, now)?
                && record.scope.principal == principal
            {
                invalidatable.push(json!({
                    "memory": record.id,
                    "candidate": stored.id,
                    "doc": stored.promoted_to,
                }));
            }
        }
    }

    Ok(success(json!({
        "space": space,
        "principal": principal,
        "at": format_instant(now),
        "lastRun": report,
        "overdue": overdue,
        "overdueAfter": overdue_after.map(format_instant),
        "locked": state
            .lock
            .as_ref()
            .filter(|lock| lock.until > now)
            .map(|lock| json!({ "until": format_instant(lock.until) })),
        "promotable": promotable,
        "promoted": promoted,
        "invalidatable": invalidatable,
    }))
    .with_reasoning(if overdue {
        "No curator run of yours finished within twice every_hours: schedule curator-run (cron, CI or a session hook)."
    } else {
        "Your last curator run finished within twice every_hours."
    }))
}
