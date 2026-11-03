//! `invalidate` and `confirm` (phase 3 sections 4.1 and 8.7): each closes the current version and
//! inserts the next in one `BEGIN IMMEDIATE` transaction.

use rusqlite::{Connection, TransactionBehavior};
use umbel_store::memory::{
    Confirm, Invalidate, Invalidation, MemoryChangeKind, MemoryVersionMeta,
    content_hash_prefix_matches, format_instant, refuse_derivation,
};
use umbel_store::{Authority, Confirmation, ReaderFilter, StoreError};

use super::SqliteMemoryStore;
use super::keys;
use super::rows::{ChangeRow, RecordRow, insert_change, record_row};
use super::write::close;
use crate::error::Fail;

/// The record `id` if `reader` may read it, else `NotFound`, as for an absent one.
fn changeable(conn: &Connection, id: &str, reader: &ReaderFilter) -> Result<RecordRow, Fail> {
    match record_row(conn, id)? {
        Some(rec) if reader.admits(&rec.access) => Ok(rec),
        _ => Err(StoreError::NotFound.into()),
    }
}

fn agent_of(rec: &RecordRow) -> Option<&str> {
    rec.agent.as_ref().and_then(|a| a.id.as_deref())
}

impl SqliteMemoryStore {
    pub(super) fn do_invalidate(
        &self,
        req: Invalidate,
        reader: &ReaderFilter,
    ) -> Result<MemoryVersionMeta, StoreError> {
        refuse_derivation(reader)?;
        req.check()?;
        self.pool.read(|_| Ok(()))?;
        self.roll_forward()?;
        self.pool.write(|conn| {
            self.pool.keys(|kc| {
                let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let rec = changeable(&tx, &req.id, reader)?;
                let keys = keys::lookup(kc, &[&rec.id])?;
                let key = keys.require(&rec.id)?;
                let current = rec.current(&tx, &self.space, key)?;
                if req.expect_version.is_some_and(|v| v != current.number) {
                    return Err(StoreError::Conflict {
                        current: Some(current.number.to_string()),
                    }
                    .into());
                }
                if req.valid_until <= current.valid_from || req.valid_until > req.at {
                    return Err(StoreError::invalid(
                        "an invalidation's validUntil must follow validFrom and not pass now",
                    )
                    .into());
                }
                let recorded = req.at.max(current.recorded_at);
                let invalidation = Invalidation {
                    at: recorded,
                    by: req.by.clone(),
                    reason: req.reason,
                    note: req.note.clone(),
                };
                let number = close(
                    &tx,
                    &self.space,
                    &rec.owner,
                    &rec.id,
                    key,
                    &current,
                    recorded,
                    req.trace_id.clone(),
                    |v| {
                        v.valid_until = Some(req.valid_until);
                        v.invalidation = Some(invalidation);
                    },
                )?;
                let rev = insert_change(
                    &tx,
                    &ChangeRow {
                        kind: MemoryChangeKind::Invalidated,
                        id: &rec.id,
                        record_version: number,
                        trace_id: req.trace_id.as_deref(),
                        at: recorded,
                        owner: &rec.owner,
                        agent: agent_of(&rec),
                        bytes: 0,
                        access: &rec.access,
                    },
                )?;
                tx.commit()?;
                Ok(MemoryVersionMeta {
                    id: rec.id.clone(),
                    record_version: number,
                    valid_until: Some(req.valid_until),
                    recorded_at: recorded,
                    rev,
                })
            })
        })
    }

    pub(super) fn do_confirm(
        &self,
        req: Confirm,
        reader: &ReaderFilter,
    ) -> Result<MemoryVersionMeta, StoreError> {
        refuse_derivation(reader)?;
        self.pool.read(|_| Ok(()))?;
        self.roll_forward()?;
        self.pool.write(|conn| {
            self.pool.keys(|kc| {
                let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let rec = changeable(&tx, &req.id, reader)?;
                let keys = keys::lookup(kc, &[&rec.id])?;
                let key = keys.require(&rec.id)?;
                let current = rec.current(&tx, &self.space, key)?;
                let prior = current.authority()?;
                if rec.owner != req.by {
                    return Err(StoreError::invalid(
                        "memory-confirm: a person confirms only their own records",
                    )
                    .into());
                }
                if !rec.flags.is_empty()
                    || matches!(prior, Authority::Transcript | Authority::Person)
                {
                    return Err(StoreError::invalid(
                        "memory-confirm: flagged, transcript and person records are not confirmed",
                    )
                    .into());
                }
                let body = rec.body(&self.space, key)?;
                if !content_hash_prefix_matches(&body.content_hash, &req.content_hash) {
                    return Err(StoreError::Conflict { current: None }.into());
                }
                let recorded = req.at.max(current.recorded_at);
                let number = close(
                    &tx,
                    &self.space,
                    &rec.owner,
                    &rec.id,
                    key,
                    &current,
                    recorded,
                    req.trace_id.clone(),
                    |v| {
                        v.envelope.authority = Some(Authority::Person.as_str().to_owned());
                        v.envelope.confirmation = Some(Confirmation {
                            by: req.by.clone(),
                            at: format_instant(recorded),
                            prior_authority: prior,
                        });
                    },
                )?;
                let rev = insert_change(
                    &tx,
                    &ChangeRow {
                        kind: MemoryChangeKind::Confirmed,
                        id: &rec.id,
                        record_version: number,
                        trace_id: req.trace_id.as_deref(),
                        at: recorded,
                        owner: &rec.owner,
                        agent: agent_of(&rec),
                        bytes: 0,
                        access: &rec.access,
                    },
                )?;
                tx.commit()?;
                Ok(MemoryVersionMeta {
                    id: rec.id.clone(),
                    record_version: number,
                    valid_until: current.valid_until,
                    recorded_at: recorded,
                    rev,
                })
            })
        })
    }
}
