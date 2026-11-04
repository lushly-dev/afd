//! Forgotten evidence in the curator's own records (phase 4 specification, section 9.1; step 1's
//! amendment 12; D103). When the memory changes feed shows a record `Erased`, every candidate
//! record citing it keeps no content hash, subject key, reason or sources and becomes `erased`,
//! never drafted again, and every consent citing it keeps no sources. Each rewritten record's
//! earlier hashes are forgotten in the change log (as the knowledge plugin's redaction does,
//! step 3b's amendment 13), and a reporting checkpoint truncates the write-ahead log, so the
//! source's hash is gone from the document store's bytes. The drafts themselves are redacted by
//! the knowledge plugin through the batch's `erased` notice.

use std::collections::BTreeSet;

use serde_json::Value;
use umbel_sdk::{Cx, HostError, Outcome, WalCheckpoint};
use umbel_store::Sensitivity;

use crate::evaluate::Status;
use crate::fail;
use crate::records::{self, CANDIDATE, CONSENT, Stored};
use crate::settings::Call;

/// Whether a consent body cites one of `erased`.
fn cites(body: &Value, erased: &BTreeSet<String>) -> bool {
    body.get("sources")
        .and_then(Value::as_array)
        .is_some_and(|sources| {
            sources.iter().any(|source| {
                source
                    .get("id")
                    .and_then(Value::as_str)
                    .is_some_and(|id| erased.contains(id))
            })
        })
}

fn forget_history(cx: &Cx, space: &str, kind: &str, id: &str) -> Result<(), Outcome> {
    match cx.record_forget_history(space, kind, id) {
        Ok(_) | Err(HostError::NotFound(_)) => Ok(()),
        Err(error) => Err(fail::host(&error)),
    }
}

/// Erase what the caller's records keep of `erased`, updating `stored` in place. Returns how many
/// records were rewritten.
///
/// # Errors
/// The store's failures; `CURATOR_CONFLICT` (retryable) when a record changed meanwhile.
pub(crate) fn apply(
    cx: &Cx,
    call: &Call,
    stored: &mut [Stored],
    erased: &BTreeSet<String>,
) -> Result<usize, Outcome> {
    if erased.is_empty() {
        return Ok(0);
    }
    let (space, principal) = (call.space.as_str(), call.principal.as_str());
    let mut rewritten = 0;
    for candidate in stored.iter_mut() {
        if candidate.status == Status::Erased
            || !candidate.sources.iter().any(|s| erased.contains(&s.id))
        {
            continue;
        }
        let body = records::erased_body(candidate, space, principal, call.now);
        records::put(
            cx,
            space,
            call.now,
            (CANDIDATE, &candidate.id),
            body,
            (candidate.access.clone(), candidate.sensitivity),
            records::expect(candidate.record_hash.as_ref()),
        )?;
        forget_history(cx, space, CANDIDATE, &candidate.id)?;
        candidate.status = Status::Erased;
        candidate.content_hash = None;
        candidate.sources.clear();
        candidate.reason = None;
        candidate.quiet_until = None;
        candidate.record_hash = None;
        rewritten += 1;
    }
    for record in records::list(cx, space, CONSENT)? {
        if record.body.get("principal").and_then(Value::as_str) != Some(principal)
            || record.body.get("space").and_then(Value::as_str) != Some(space)
            || !cites(&record.body, erased)
        {
            continue;
        }
        let body = records::consent_erased_body(&record.body, space, principal);
        records::put(
            cx,
            space,
            call.now,
            (CONSENT, &record.id),
            body,
            (records::own(principal), Sensitivity::Internal),
            records::expect(Some(&record.content_hash)),
        )?;
        forget_history(cx, space, CONSENT, &record.id)?;
        rewritten += 1;
    }
    Ok(rewritten)
}

/// The reporting checkpoint after a rewrite that removed hashes: `clean`, or `pending` when a
/// reader holds the write-ahead log (an error reads as `pending`, so nothing claims to be gone
/// that may not be).
pub(crate) fn checkpoint(cx: &Cx, space: &str) -> &'static str {
    match cx.truncate_wal(space) {
        Ok(WalCheckpoint::Clean) => "clean",
        Ok(WalCheckpoint::Pending) | Err(_) => "pending",
    }
}
