//! `memory-status` (section 8.8): counts by class and state over what the caller can read, the
//! caller's usage against its quota, the key file's state, and how many of the caller's records
//! the default push admits, so an empty bundle explains itself. It holds no text.

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, LeftOutQuery, Outcome, success};
use umbel_store::memory::{ClassCounts, HOUR_MS, KeyFileState, LeftOut, ProjectMatch};
use umbel_store::{AsOf, Authority, MemoryClass, Millis, PushFilter, ScopeQuery};

use crate::fail;
use crate::pipeline::effective_principal;
use crate::policy::Policy;

/// The host's ceilings on the quota (section 8.11), which `memory-status` reports the pack under.
const MAX_WRITES_PER_HOUR: u64 = 100_000;
const MAX_STORED_BYTES: u64 = 32 * 1024 * 1024 * 1024;

pub(crate) fn run(_input: &Value, cx: &Cx) -> Outcome {
    match status(cx) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

/// `Ok(None)` while nothing has been written.
fn provisioned<T>(result: Result<T, HostError>) -> Result<Option<T>, Outcome> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(HostError::NotProvisioned) => Ok(None),
        Err(error) => Err(fail::host(&error)),
    }
}

fn class_json(counts: &ClassCounts) -> Value {
    json!({
        "live": counts.live,
        "flagged": counts.flagged,
        "notYetValid": counts.not_yet_valid,
        "invalidated": counts.invalidated,
        "expired": counts.expired,
        "expiringSoon": counts.expiring_soon,
    })
}

fn not_admitted(left: &LeftOut) -> u64 {
    left.by_class.values().map(|c| c.authority).sum()
}

/// The caller's own current, unflagged records the default push admits (section 9.3:
/// `push_authorities = ["person"]`): those the push leaves out with an empty list, less those it
/// leaves out with the default one. Memory reads no other plugin's configuration (D78), so a
/// deployer's widened `push_authorities` is not counted (step 5, amendment 5).
fn pushable(cx: &Cx, space: &str, me: &str, now: Millis) -> Result<Option<u64>, Outcome> {
    let query = |own: Vec<Authority>| LeftOutQuery {
        scope: ScopeQuery {
            project: ProjectMatch::Any,
            principal: Some(me.to_owned()),
            equivalents: Vec::new(),
            agent: None,
            session: None,
        },
        classes: Vec::new(),
        push: PushFilter {
            caller: me.to_owned(),
            own,
            foreign: Vec::new(),
            unset_project: vec![Authority::Person],
        },
        as_of: AsOf::at(now),
        now,
    };
    let Some(all) = provisioned(cx.memory_left_out(space, &query(Vec::new())))? else {
        return Ok(None);
    };
    let Some(rest) = provisioned(cx.memory_left_out(space, &query(vec![Authority::Person])))?
    else {
        return Ok(None);
    };
    Ok(Some(not_admitted(&all).saturating_sub(not_admitted(&rest))))
}

fn status(cx: &Cx) -> Result<Outcome, Outcome> {
    let space = cx.call().space.clone().ok_or_else(fail::no_space)?;
    let now = cx.now_ms().map_err(|error| fail::host(&error))?;
    let policy = Policy::load(cx)?;
    let quota = policy.quota();
    let counts = provisioned(cx.memory_counts(&space, now, policy.expiring_soon_ms()))?;
    let me = effective_principal(cx.call());
    let usage = match &me {
        Some(_) => provisioned(cx.memory_usage(&space, now.saturating_sub(HOUR_MS)))?,
        None => None,
    };
    let key_file = provisioned(cx.memory_key_file(&space))?.map(|state| match state {
        KeyFileState::Present => "present",
        KeyFileState::Missing => "missing",
        KeyFileState::Mismatch => "mismatch",
    });
    let pushable = match &me {
        Some(me) => pushable(cx, &space, me, now)?,
        None => None,
    };
    let by_class: serde_json::Map<String, Value> = MemoryClass::ALL
        .into_iter()
        .map(|class| {
            let c = counts
                .as_ref()
                .and_then(|counts| counts.by_class.get(&class).copied())
                .unwrap_or_default();
            (class.as_str().to_owned(), class_json(&c))
        })
        .collect();
    let usage_json = usage.map(|u| {
        json!({
            "window": "1h",
            "writes": { "used": u.writes, "limit": quota.writes_per_hour.min(MAX_WRITES_PER_HOUR) },
            "bytes": { "used": u.bytes, "limit": quota.bytes_per_hour },
            "storedRecords": { "used": u.stored_records, "limit": quota.stored_records },
            "storedBytes": { "used": u.stored_bytes, "limit": quota.stored_bytes.min(MAX_STORED_BYTES) },
        })
    });
    let data = json!({
        "space": space,
        "provisioned": counts.is_some(),
        "counts": {
            "byClass": by_class,
            "total": counts.as_ref().map_or(0, |c| c.total()),
            "unreadable": counts.as_ref().map_or(0, |c| c.unreadable),
        },
        "expiringSoonDays": policy.expiring_soon_days,
        "usage": usage_json,
        "quotaScope": "Rates are per principal and agent, stored limits per principal. Until agents are verified (phase 5) every stdio caller is one agent, so in practice the quota is the workspace principal's.",
        "keyFile": key_file,
        "pushable": pushable.unwrap_or(0),
        "pushRule": "the default push: your own records with authority person; a deployer's push_authorities is not read here",
    });
    let mut outcome = success(data);
    if key_file.is_some_and(|state| state != "present") {
        let code = if key_file == Some("missing") {
            "MEMORY_KEYS_MISSING"
        } else {
            "MEMORY_KEYS_MISMATCH"
        };
        outcome = outcome.with_warning(
            code,
            "the memory key file is not this database's: no record opens until it is restored; run umbel doctor",
        );
    }
    if counts.as_ref().is_some_and(|c| c.unreadable > 0) {
        outcome = outcome.with_warning(
            "MEMORY_UNREADABLE",
            "some readable records do not open or are not indexed; run store-check",
        );
    }
    Ok(outcome)
}
