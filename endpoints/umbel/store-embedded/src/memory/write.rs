//! `write` (phase 3 section 5.2): roll-forward and the purge before the write in transactions of
//! their own, then one `BEGIN IMMEDIATE` transaction, all or nothing: replay, erased prefixes,
//! entries, quota. Each created record gets its own key; the keys are committed to the key file
//! before the memory transaction commits, so no live row ever lacks a key (section 5.4).

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use umbel_store::memory::{
    EntryReceipt, EntryState, HOUR_MS, Invalidation, InvalidationReason, MemoryChangeKind,
    MemoryReceipt, MemoryWrite, PURGE_BEFORE_WRITE, Quota, QuotaLimit, WriteRefusal,
    capture_key_under, format_instant,
};
use umbel_store::{Authority, ContentHash, MemoryBatch, Millis, Rev, StoreError};

use super::SqliteMemoryStore;
use super::keys::{self, KeyEntry};
use super::points;
use super::read::usage;
use super::rows::{
    ChangeRow, FullVersion, access_text, body_plain, class_text, flag_texts, insert_change,
    insert_version, record_row, sensitivity_text,
};
use super::seal::{Part, RecordKey, Seal};
use crate::error::{Fail, to_i64};

impl SqliteMemoryStore {
    pub(super) fn do_write(&self, batch: MemoryBatch) -> Result<MemoryReceipt, StoreError> {
        let (owner, authority, hashes) = batch.check(&self.space)?;
        self.pool.write(|_| Ok(()))?;
        // First, outside the write's transaction: finish any forget or purge a crash or a busy
        // checkpoint left unsettled.
        self.roll_forward()?;
        // Then, outside the write's transaction: purge at most 16 records past their purge
        // date, committed on their own, whatever the write answers. A `Busy` is left for the
        // next writer.
        match self.purge_committed(batch.at, batch.retention, PURGE_BEFORE_WRITE) {
            Ok(_) | Err(StoreError::Busy) => {}
            Err(other) => return Err(other),
        }
        self.pool.write(|conn| {
            self.pool.keys(|kc| {
                let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let mut fresh = Vec::new();
                let receipt = apply(
                    &tx,
                    kc,
                    &self.space,
                    &batch,
                    &owner,
                    authority,
                    &hashes,
                    &mut fresh,
                )?;
                // Keys first, then memory: a crash between the two commits leaves orphan keys,
                // which are harmless, and never a live row without its key.
                if !fresh.is_empty() {
                    keys::insert(kc, &fresh)?;
                    points::crash("write-keys");
                }
                tx.commit()?;
                Ok(receipt)
            })
        })
    }
}

/// The write's transaction body. Each created record's new key is pushed to `fresh`.
#[allow(clippy::too_many_arguments)]
fn apply(
    tx: &Connection,
    kc: &Connection,
    space: &str,
    batch: &MemoryBatch,
    owner: &str,
    authority: Authority,
    hashes: &[ContentHash],
    fresh: &mut Vec<(String, RecordKey)>,
) -> Result<MemoryReceipt, Fail> {
    // (1) A used (owner, authority, key) replays its first receipt and writes nothing.
    if let Some(key) = &batch.idempotency {
        let stored: Option<String> = tx
            .query_row(
                "SELECT receipt FROM idempotency WHERE owner = ?1 AND authority = ?2 AND key = ?3",
                params![owner, authority.as_str(), key],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(stored) = stored {
            let mut receipt = receipt_from_json(&stored)?;
            receipt.replayed = true;
            return Ok(receipt);
        }
    }
    // (2) A capture key under one of the owner's erased prefixes writes nothing.
    if let Some(key) = &batch.capture_key {
        let mut stmt = tx.prepare("SELECT key_prefix FROM capture_erasures WHERE owner = ?1")?;
        let prefixes = stmt.query_map([owner], |r| r.get::<_, String>(0))?;
        for prefix in prefixes {
            if capture_key_under(&prefix?, key) {
                return Ok(MemoryReceipt {
                    entries: Vec::new(),
                    superseded: Vec::new(),
                    from_rev: None,
                    to_rev: None,
                    replayed: false,
                    refused: Some(WriteRefusal::Erased),
                });
            }
        }
    }
    let first_rev = super::rows::next_rev(tx)?;
    let mut entries = Vec::with_capacity(batch.entries.len());
    let mut superseded = Vec::new();
    for (entry, hash) in batch.entries.iter().zip(hashes) {
        if let Some(observed) = observe(tx, kc, batch, entry, hash, owner, authority)? {
            entries.push(observed);
            continue;
        }
        let key = RecordKey::generate()?;
        entries.push(create(tx, space, batch, entry, hash, owner, &key)?);
        fresh.push((entry.id.clone(), key));
        for target in &entry.supersedes {
            supersede(tx, kc, space, batch.at, entry, target, owner)?;
            superseded.push(target.clone());
        }
    }
    // (3) The quota, inside the transaction, over the state the batch leaves.
    check_quota(tx, batch, owner, first_rev)?;
    let last_rev = super::rows::next_rev(tx)? - 1;
    let taken = last_rev >= first_rev;
    let receipt = MemoryReceipt {
        entries,
        superseded,
        from_rev: taken.then_some(first_rev),
        to_rev: taken.then_some(last_rev),
        replayed: false,
        refused: None,
    };
    if let Some(key) = &batch.idempotency {
        tx.execute(
            "INSERT INTO idempotency (owner, authority, key, rev, at, receipt) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                owner,
                authority.as_str(),
                key,
                to_i64(receipt.to_rev.unwrap_or(0))?,
                batch.at,
                receipt_to_json(&receipt),
            ],
        )?;
    }
    Ok(receipt)
}

/// A live record with the same owner, project, class, content hash, authority and access set
/// takes an observation, and is renewed if the entry says so (section 8.2). A row with a destroyed
/// marker is not live.
fn observe(
    tx: &Connection,
    kc: &Connection,
    batch: &MemoryBatch,
    entry: &MemoryWrite,
    hash: &ContentHash,
    owner: &str,
    authority: Authority,
) -> Result<Option<EntryReceipt>, Fail> {
    let at = batch.at;
    let candidates: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT r.id FROM records r \
             JOIN versions v ON v.id = r.id AND v.recorded_until IS NULL \
             JOIN record_derived d ON d.id = r.id \
             WHERE r.owner = ?1 AND r.project IS ?2 AND r.class = ?3 AND d.content_hash = ?4 \
             AND v.authority = ?5 AND r.access = ?6 AND r.expires > ?7 \
             AND v.inv_reason IS NULL AND (v.valid_until IS NULL OR v.valid_until > ?7) \
             ORDER BY r.rowid",
        )?;
        let found = stmt.query_map(
            params![
                owner,
                entry.scope.project,
                class_text(entry.class),
                hash.as_str(),
                authority.as_str(),
                access_text(&entry.access),
                at,
            ],
            |r| r.get(0),
        )?;
        found.collect::<Result<_, _>>()?
    };
    let found = if candidates.is_empty() {
        None
    } else {
        let refs: Vec<&str> = candidates.iter().map(String::as_str).collect();
        let keys = keys::lookup(kc, &refs)?;
        candidates
            .into_iter()
            .find(|id| !matches!(keys.entry(id), Some(KeyEntry::Destroyed { .. })))
    };
    let Some(id) = found else { return Ok(None) };
    let rec = record_row(tx, &id)?
        .ok_or_else(|| StoreError::Corrupt("the observed record vanished".to_owned()))?;
    tx.execute(
        "INSERT INTO observations (id, session, at) VALUES (?1, ?2, ?3)",
        params![id, entry.scope.session, at],
    )?;
    let mut expires = rec.expires;
    if let Some(renew) = entry.renew {
        let first: Millis = tx.query_row(
            "SELECT recorded_at FROM versions WHERE id = ?1 AND record_version = 1",
            [&id],
            |r| r.get(0),
        )?;
        let until = at
            .saturating_add(renew.ttl_ms)
            .min(first.saturating_add(renew.max_ttl_ms));
        expires = expires.max(until);
        tx.execute(
            "UPDATE records SET expires = ?1 WHERE rowid = ?2",
            params![expires, rec.rowid],
        )?;
    }
    let version: u32 = tx.query_row(
        "SELECT record_version FROM versions WHERE id = ?1 AND recorded_until IS NULL",
        [&id],
        |r| r.get(0),
    )?;
    insert_change(
        tx,
        &ChangeRow {
            kind: MemoryChangeKind::Observed,
            id: &id,
            record_version: version,
            trace_id: entry.envelope.trace_id.as_deref(),
            at,
            owner,
            agent: entry.scope.agent_id(),
            bytes: 0,
            access: &rec.access,
        },
    )?;
    Ok(Some(EntryReceipt {
        id,
        record_version: version,
        state: EntryState::Observed,
        expires_at: expires,
    }))
}

/// Insert a new record, version 1, its access rows, derived row, first observation and index
/// row, and its `Created` change.
fn create(
    tx: &Connection,
    space: &str,
    batch: &MemoryBatch,
    entry: &MemoryWrite,
    hash: &ContentHash,
    owner: &str,
    key: &RecordKey,
) -> Result<EntryReceipt, Fail> {
    let used: bool = tx.query_row(
        "SELECT EXISTS (SELECT 1 FROM changes WHERE id = ?1) \
         OR EXISTS (SELECT 1 FROM records WHERE id = ?1) \
         OR EXISTS (SELECT 1 FROM tombstones WHERE id = ?1)",
        [&entry.id],
        |r| r.get(0),
    )?;
    if used {
        return Err(StoreError::invalid(format!(
            "memory write: id {} is already used; there is no update path",
            entry.id
        ))
        .into());
    }
    let body = body_plain(&entry.subject, &entry.text, &entry.tags, hash);
    let sealed = Seal {
        space,
        id: &entry.id,
        owner,
        part: Part::Body,
    }
    .seal(key, &body)?;
    let tags_text = entry.tags.join(" ");
    // The backend's own count: the sealed body plus the index's plaintext copy.
    let bytes = sealed.len() + entry.subject.len() + tags_text.len() + entry.text.len();
    let bytes = u64::try_from(bytes).unwrap_or(u64::MAX);
    let rev = super::rows::next_rev(tx)?;
    let agent = entry
        .scope
        .agent
        .as_ref()
        .map(|a| serde_json::to_string(a).unwrap_or_default());
    tx.execute(
        "INSERT INTO records (id, class, owner, project, agent_id, agent, session, capture_key, \
         flags, flagged, expires, created_rev, stored_bytes, indexed, sensitivity, access, \
         supersedes, sealed) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 1, ?14, ?15, ?16, ?17)",
        params![
            entry.id,
            class_text(entry.class),
            owner,
            entry.scope.project,
            entry.scope.agent_id(),
            agent,
            entry.scope.session,
            batch.capture_key,
            flag_texts(&entry.flags),
            i64::from(!entry.flags.is_empty()),
            entry.expires_at,
            to_i64(rev)?,
            to_i64(bytes)?,
            sensitivity_text(entry.sensitivity)?,
            access_text(&entry.access),
            json!(entry.supersedes).to_string(),
            sealed,
        ],
    )?;
    let rowid = tx.last_insert_rowid();
    insert_version(
        tx,
        space,
        owner,
        &entry.id,
        key,
        &FullVersion {
            number: 1,
            valid_from: entry.valid_from,
            valid_until: entry.valid_until,
            recorded_at: batch.at,
            recorded_until: None,
            invalidation: None,
            superseded_by: None,
            envelope: entry.envelope.clone(),
        },
    )?;
    for token in entry.access.tokens() {
        tx.execute(
            "INSERT INTO record_access (id, token) VALUES (?1, ?2)",
            params![entry.id, token],
        )?;
    }
    tx.execute(
        "INSERT INTO record_derived (id, content_hash, tags) VALUES (?1, ?2, ?3)",
        params![entry.id, hash.as_str(), json!(entry.tags).to_string()],
    )?;
    tx.execute(
        "INSERT INTO observations (id, session, at) VALUES (?1, ?2, ?3)",
        params![entry.id, entry.scope.session, batch.at],
    )?;
    tx.execute(
        "INSERT INTO records_fts (rowid, subject, tags, text) VALUES (?1, ?2, ?3, ?4)",
        params![rowid, entry.subject, tags_text, entry.text],
    )?;
    insert_change(
        tx,
        &ChangeRow {
            kind: MemoryChangeKind::Created,
            id: &entry.id,
            record_version: 1,
            trace_id: entry.envelope.trace_id.as_deref(),
            at: batch.at,
            owner,
            agent: entry.scope.agent_id(),
            bytes,
            access: &entry.access,
        },
    )?;
    Ok(EntryReceipt {
        id: entry.id.clone(),
        record_version: 1,
        state: EntryState::Created,
        expires_at: entry.expires_at,
    })
}

/// Close a target's current version and insert the next with `supersededBy`, reason `other` and
/// `validUntil = max(new.validFrom, target.validFrom + 1 ms)` (section 4.1).
fn supersede(
    tx: &Connection,
    kc: &Connection,
    space: &str,
    at: Millis,
    entry: &MemoryWrite,
    target: &str,
    owner: &str,
) -> Result<(), Fail> {
    let rec = record_row(tx, target)?.ok_or(StoreError::NotFound)?;
    let keys = keys::lookup(kc, &[target])?;
    let key = keys.require(target)?;
    let current = rec.current(tx, space, key)?;
    let recorded = at.max(current.recorded_at);
    let until = entry.valid_from.max(current.valid_from.saturating_add(1));
    let trace = entry.envelope.trace_id.clone();
    let next = close(
        tx,
        space,
        &rec.owner,
        target,
        key,
        &current,
        recorded,
        trace,
        |v| {
            v.valid_until = Some(until);
            v.superseded_by = Some(entry.id.clone());
            v.invalidation = Some(Invalidation {
                at: recorded,
                by: owner.to_owned(),
                reason: InvalidationReason::Other,
                note: None,
            });
        },
    )?;
    insert_change(
        tx,
        &ChangeRow {
            kind: MemoryChangeKind::Invalidated,
            id: target,
            record_version: next,
            trace_id: entry.envelope.trace_id.as_deref(),
            at: recorded,
            owner: &rec.owner,
            agent: rec.agent.as_ref().and_then(|a| a.id.as_deref()),
            bytes: 0,
            access: &rec.access,
        },
    )?;
    Ok(())
}

/// Close `current` at `recorded` and insert the next version, a copy edited by `edit`, with the
/// call's trace id and clock in its envelope. Returns the new version's number. A write never
/// changes a version's content; it only closes `recorded_until`.
#[allow(clippy::too_many_arguments)]
pub(super) fn close(
    tx: &Connection,
    space: &str,
    owner: &str,
    id: &str,
    key: &RecordKey,
    current: &FullVersion,
    recorded: Millis,
    trace: Option<String>,
    edit: impl FnOnce(&mut FullVersion),
) -> Result<u32, Fail> {
    tx.execute(
        "UPDATE versions SET recorded_until = ?1 WHERE id = ?2 AND record_version = ?3",
        params![recorded, id, current.number],
    )?;
    let mut next = current.clone();
    next.number += 1;
    next.recorded_at = recorded;
    next.recorded_until = None;
    next.envelope.trace_id = trace;
    next.envelope.observed_at = format_instant(recorded);
    edit(&mut next);
    next.envelope.valid_until = next.valid_until.map(format_instant);
    insert_version(tx, space, owner, id, key, &next)?;
    Ok(next.number)
}

/// Section 8.11's limits over the state the batch leaves, so a write that would pass a limit
/// writes nothing.
fn check_quota(
    tx: &Connection,
    batch: &MemoryBatch,
    owner: &str,
    first_rev: Rev,
) -> Result<(), Fail> {
    let q: Quota = batch.quota;
    let agent = batch.entries[0].scope.agent_id();
    let since = batch.at - HOUR_MS + 1;
    let now = usage(tx, owner, agent, since)?;
    let exceeded = |limit: QuotaLimit, retry_after_ms: Option<u64>| -> Fail {
        StoreError::QuotaExceeded {
            limit,
            retry_after_ms,
        }
        .into()
    };
    if now.stored_records > q.stored_records {
        return Err(exceeded(QuotaLimit::StoredRecords, None));
    }
    if now.stored_bytes > q.stored_bytes {
        return Err(exceeded(QuotaLimit::StoredBytes, None));
    }
    if now.writes <= q.writes_per_hour && now.bytes <= q.bytes_per_hour {
        return Ok(());
    }
    // A rate: retry when the oldest write already in the window leaves it.
    let oldest: Option<Millis> = tx.query_row(
        "SELECT MIN(at) FROM changes WHERE owner = ?1 AND agent IS ?2 AND at >= ?3 \
         AND kind IN ('created', 'observed') AND rev < ?4",
        params![owner, agent, since, to_i64(first_rev)?],
        |r| r.get(0),
    )?;
    let retry = oldest.map_or(1, |o| (o + HOUR_MS - batch.at).max(1));
    let retry = Some(u64::try_from(retry).unwrap_or(1));
    if now.writes > q.writes_per_hour {
        Err(exceeded(QuotaLimit::WritesPerHour, retry))
    } else {
        Err(exceeded(QuotaLimit::BytesPerHour, retry))
    }
}

fn receipt_to_json(receipt: &MemoryReceipt) -> String {
    json!({
        "entries": receipt.entries.iter().map(|e| json!({
            "id": e.id,
            "recordVersion": e.record_version,
            "state": match e.state { EntryState::Created => "created", EntryState::Observed => "observed" },
            "expiresAt": e.expires_at,
        })).collect::<Vec<_>>(),
        "superseded": receipt.superseded,
        "fromRev": receipt.from_rev,
        "toRev": receipt.to_rev,
    })
    .to_string()
}

fn receipt_from_json(text: &str) -> Result<MemoryReceipt, Fail> {
    let corrupt =
        || -> Fail { StoreError::Corrupt("a stored receipt is unreadable".to_owned()).into() };
    let value: Value = serde_json::from_str(text).map_err(|_| corrupt())?;
    let rev = |key: &str| -> Result<Option<Rev>, Fail> {
        match &value[key] {
            Value::Null => Ok(None),
            v => v.as_u64().map(Some).ok_or_else(corrupt),
        }
    };
    let entries = value["entries"]
        .as_array()
        .ok_or_else(corrupt)?
        .iter()
        .map(|e| {
            Ok(EntryReceipt {
                id: e["id"].as_str().ok_or_else(corrupt)?.to_owned(),
                record_version: e["recordVersion"]
                    .as_u64()
                    .and_then(|n| u32::try_from(n).ok())
                    .ok_or_else(corrupt)?,
                state: match e["state"].as_str() {
                    Some("created") => EntryState::Created,
                    Some("observed") => EntryState::Observed,
                    _ => return Err(corrupt()),
                },
                expires_at: e["expiresAt"].as_i64().ok_or_else(corrupt)?,
            })
        })
        .collect::<Result<Vec<_>, Fail>>()?;
    let superseded = value["superseded"]
        .as_array()
        .ok_or_else(corrupt)?
        .iter()
        .map(|s| s.as_str().map(str::to_owned).ok_or_else(corrupt))
        .collect::<Result<Vec<_>, Fail>>()?;
    Ok(MemoryReceipt {
        entries,
        superseded,
        from_rev: rev("fromRev")?,
        to_rev: rev("toRev")?,
        replayed: false,
        refused: None,
    })
}
