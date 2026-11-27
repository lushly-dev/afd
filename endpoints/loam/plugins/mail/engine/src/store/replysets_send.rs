//! Send lifecycle and crash-recovery store methods for reply sets (step E3/F3;
//! engine.spec.md section 10.3, plugin.spec.md sections 7 and 9).
//!
//! Split out of `store/replysets.rs` so each store module stays focused and
//! well within the file-size limit.

use rusqlite::{Connection, OptionalExtension, params};

use super::replysets::{
    ReplySendState, ReplySetDetail, ReplySetSendRefusal, ReplySetState, load_replyset_on,
};
use super::{AccountId, AccountRow, Proposer, Store, StoreError};

impl Store {
    /// Settles any reply set left in `sending` from a previous process that
    /// ended unexpectedly: any reply that was mid-SMTP becomes `unknown` (and
    /// its set `unknown`), while sets interrupted between replies or after the
    /// last acceptance recover cleanly to `sent`, `partial`, or `open`.
    pub(super) fn mark_interrupted_replysets(
        connection: &Connection,
        now: i64,
    ) -> Result<(), StoreError> {
        let set_ids: Vec<i64> = {
            let mut stmt = connection.prepare("SELECT id FROM replyset WHERE state = 'sending'")?;
            stmt.query_map([], |row| row.get(0))?
                .collect::<Result<_, _>>()?
        };
        for set_id in set_ids {
            settle_sending_replyset_on(connection, set_id, now)?;
        }
        // Defensive sweep for any orphaned sending reply outside a sending parent.
        connection.execute(
            "UPDATE replyset_reply SET send_state = 'unknown', updated_at = ?1
             WHERE send_state = 'sending'",
            [now],
        )?;
        Ok(())
    }

    /// Atomically verifies `set_id` is sendable at `expected_revision` and
    /// every reply has non-empty text, then transitions `replyset.state` to
    /// `'sending'`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn begin_replyset_send(
        &mut self,
        set_id: i64,
        expected_revision: i64,
    ) -> Result<Result<(ReplySetDetail, AccountRow), ReplySetSendRefusal>, StoreError> {
        let transaction = self.connection.transaction()?;
        let Some(mut detail) = load_replyset_on(&transaction, set_id)? else {
            return Ok(Err(ReplySetSendRefusal::NotFound));
        };
        match detail.set.state {
            ReplySetState::Sending => return Ok(Err(ReplySetSendRefusal::Sending)),
            ReplySetState::Sent => return Ok(Err(ReplySetSendRefusal::Sent)),
            ReplySetState::Unknown => return Ok(Err(ReplySetSendRefusal::Unknown)),
            ReplySetState::Open | ReplySetState::Partial => {}
        }
        if detail.set.revision != expected_revision {
            return Ok(Err(ReplySetSendRefusal::Changed {
                revision: detail.set.revision,
            }));
        }
        if detail
            .replies
            .iter()
            .any(|r| r.send_state == ReplySendState::Unknown)
        {
            return Ok(Err(ReplySetSendRefusal::Unknown));
        }
        let missing = detail
            .replies
            .iter()
            .filter(|r| r.text.as_deref().is_none_or(|t| t.trim().is_empty()))
            .count();
        if missing > 0 {
            return Ok(Err(ReplySetSendRefusal::Incomplete { missing }));
        }
        let pending = detail
            .replies
            .iter()
            .filter(|r| r.send_state.will_send())
            .count();
        if pending == 0 {
            return Ok(Err(ReplySetSendRefusal::NothingToSend));
        }
        let account: Option<AccountRow> = transaction
            .query_row(
                "SELECT id, provider, address FROM account WHERE id = ?1",
                [detail.set.account.0],
                |row| {
                    Ok(AccountRow {
                        id: AccountId(row.get(0)?),
                        provider: row.get(1)?,
                        address: row.get(2)?,
                    })
                },
            )
            .optional()?;
        let Some(account) = account else {
            return Ok(Err(ReplySetSendRefusal::AccountNotFound));
        };
        let changed = transaction.execute(
            "UPDATE replyset SET state = 'sending'
             WHERE id = ?1 AND revision = ?2 AND state IN ('open', 'partial')",
            params![set_id, expected_revision],
        )?;
        if changed != 1 {
            return Ok(Err(ReplySetSendRefusal::Changed {
                revision: detail.set.revision,
            }));
        }
        transaction.commit()?;
        detail.set.state = ReplySetState::Sending;
        Ok(Ok((detail, account)))
    }

    /// Marks one reply of a sending reply set as `'sending'` and inserts its
    /// `outbound` row (`kind = 'replyset'`).
    ///
    /// # Errors
    /// When the database refuses.
    #[allow(clippy::too_many_arguments)]
    pub fn begin_replyset_reply_send(
        &mut self,
        set_id: i64,
        reply_id: i64,
        account: AccountId,
        approved_revision: i64,
        message_id: &str,
        sender: &Proposer,
        now: i64,
    ) -> Result<i64, StoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO outbound
                 (account_id, draft_id, draft_revision, kind, message_id, recipients, state,
                  sent_copy, sender_kind, sender_id, started_at)
             VALUES (?1, NULL, ?2, 'replyset', ?3, 1, 'sending', 0, ?4, ?5, ?6)",
            params![
                account.0,
                approved_revision,
                message_id,
                sender.kind,
                sender.id,
                now,
            ],
        )?;
        let outbound_id = transaction.last_insert_rowid();
        let changed = transaction.execute(
            "UPDATE replyset_reply SET send_state = 'sending', outbound_id = ?2, updated_at = ?3
             WHERE id = ?1 AND replyset_id = ?4 AND send_state IN ('none', 'failed')",
            params![reply_id, outbound_id, now, set_id],
        )?;
        if changed != 1 {
            return Err(StoreError::NotFound("replyset_reply"));
        }
        transaction.commit()?;
        Ok(outbound_id)
    }

    /// Marks one reply and its `outbound` row as `'sent'`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn finish_replyset_reply_sent(
        &mut self,
        outbound_id: i64,
        reply_id: i64,
        now: i64,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        let out_changed = transaction.execute(
            "UPDATE outbound SET state = 'sent', finished_at = ?2
             WHERE id = ?1 AND state = 'sending'",
            params![outbound_id, now],
        )?;
        let reply_changed = transaction.execute(
            "UPDATE replyset_reply SET send_state = 'sent', updated_at = ?2
             WHERE id = ?1 AND send_state = 'sending'",
            params![reply_id, now],
        )?;
        if out_changed != 1 || reply_changed != 1 {
            return Err(StoreError::NotFound("outbound"));
        }
        transaction.commit()?;
        Ok(())
    }

    /// Marks one reply and its `outbound` row as `'failed'` (definitely not sent).
    ///
    /// # Errors
    /// When the database refuses.
    pub fn finish_replyset_reply_failed(
        &mut self,
        outbound_id: i64,
        reply_id: i64,
        error: &str,
        now: i64,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        let out_changed = transaction.execute(
            "UPDATE outbound SET state = 'failed', finished_at = ?2, error = ?3
             WHERE id = ?1 AND state = 'sending'",
            params![outbound_id, now, error],
        )?;
        let reply_changed = transaction.execute(
            "UPDATE replyset_reply SET send_state = 'failed', updated_at = ?2
             WHERE id = ?1 AND send_state = 'sending'",
            params![reply_id, now],
        )?;
        if out_changed != 1 || reply_changed != 1 {
            return Err(StoreError::NotFound("outbound"));
        }
        transaction.commit()?;
        Ok(())
    }

    /// Marks one reply, its `outbound` row, and its parent reply set as
    /// `'unknown'` (never retried), raising the set's revision.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn finish_replyset_reply_unknown(
        &mut self,
        outbound_id: i64,
        reply_id: i64,
        set_id: i64,
        error: &str,
        now: i64,
    ) -> Result<i64, StoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "UPDATE outbound SET state = 'unknown', finished_at = ?2, error = ?3
             WHERE id = ?1 AND state = 'sending'",
            params![outbound_id, now, error],
        )?;
        transaction.execute(
            "UPDATE replyset_reply SET send_state = 'unknown', updated_at = ?2
             WHERE id = ?1 AND send_state = 'sending'",
            params![reply_id, now],
        )?;
        transaction.execute(
            "UPDATE replyset SET state = 'unknown', revision = revision + 1, updated_at = ?2
             WHERE id = ?1 AND state = 'sending'",
            params![set_id, now],
        )?;
        let revision: i64 = transaction
            .query_row(
                "SELECT revision FROM replyset WHERE id = ?1",
                [set_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound("replyset"))?;
        transaction.commit()?;
        Ok(revision)
    }

    /// Finalizes `replyset.state` out of `'sending'`, optionally raising
    /// `revision`, and returns the resulting revision.
    ///
    /// When `raise_revision` is `false` (used only when restoring `'open'`
    /// before any reply row was mutated), `updated_at` is also left unchanged
    /// so the rendered preview remains identical under the same revision.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn finish_replyset_send(
        &mut self,
        set_id: i64,
        final_state: ReplySetState,
        raise_revision: bool,
        now: i64,
    ) -> Result<i64, StoreError> {
        let transaction = self.connection.transaction()?;
        if raise_revision {
            transaction.execute(
                "UPDATE replyset SET state = ?2, revision = revision + 1, updated_at = ?3
                 WHERE id = ?1 AND state = 'sending'",
                params![set_id, final_state.as_str(), now],
            )?;
        } else {
            transaction.execute(
                "UPDATE replyset SET state = ?2
                 WHERE id = ?1 AND state = 'sending'",
                params![set_id, final_state.as_str()],
            )?;
        }
        let revision: i64 = transaction
            .query_row(
                "SELECT revision FROM replyset WHERE id = ?1",
                [set_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound("replyset"))?;
        transaction.commit()?;
        Ok(revision)
    }

    /// Settles a reply set whose future was dropped mid-batch: marks any
    /// in-flight reply + outbound as `'unknown'`, or transitions the set cleanly
    /// to `'sent'`, `'partial'`, or `'open'` based on its replies' states.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn settle_interrupted_replyset(&mut self, set_id: i64, now: i64) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        settle_sending_replyset_on(&transaction, set_id, now)?;
        transaction.commit()?;
        Ok(())
    }
}

/// Shared settlement logic for both in-process drop recovery and store reopen:
/// marks any reply still in `'sending'` (and its `'sending'` outbound row) as
/// `'unknown'` and sets the parent `'unknown'`, or otherwise derives the parent
/// state from the persisted child reply states (`'unknown'`, `'sent'`,
/// `'partial'`, or `'open'`).
fn settle_sending_replyset_on(
    connection: &Connection,
    set_id: i64,
    now: i64,
) -> Result<(), StoreError> {
    let why =
        "the send was interrupted before its outcome was recorded; whether it went is not known";
    let in_flight: Vec<(i64, Option<i64>)> = {
        let mut stmt = connection.prepare(
            "SELECT id, outbound_id FROM replyset_reply
             WHERE replyset_id = ?1 AND send_state = 'sending'",
        )?;
        stmt.query_map([set_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?
    };
    if !in_flight.is_empty() {
        for (reply_id, outbound_id) in in_flight {
            if let Some(outbound_id) = outbound_id {
                connection.execute(
                    "UPDATE outbound SET state = 'unknown', finished_at = ?2, error = ?3
                     WHERE id = ?1 AND state = 'sending'",
                    params![outbound_id, now, why],
                )?;
            }
            connection.execute(
                "UPDATE replyset_reply SET send_state = 'unknown', updated_at = ?2
                 WHERE id = ?1",
                params![reply_id, now],
            )?;
        }
        connection.execute(
            "UPDATE replyset SET state = 'unknown', revision = revision + 1, updated_at = ?2
             WHERE id = ?1 AND state = 'sending'",
            params![set_id, now],
        )?;
        return Ok(());
    }
    let (total, sent, failed, unknown): (i64, i64, i64, i64) = connection.query_row(
        "SELECT count(*),
                coalesce(sum(CASE WHEN send_state = 'sent' THEN 1 ELSE 0 END), 0),
                coalesce(sum(CASE WHEN send_state = 'failed' THEN 1 ELSE 0 END), 0),
                coalesce(sum(CASE WHEN send_state = 'unknown' THEN 1 ELSE 0 END), 0)
         FROM replyset_reply WHERE replyset_id = ?1",
        [set_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    let (state, bump) = if unknown > 0 {
        ("unknown", true)
    } else if sent == total && total > 0 {
        ("sent", true)
    } else if sent > 0 {
        ("partial", true)
    } else if failed > 0 {
        ("open", true)
    } else {
        ("open", false)
    };
    if bump {
        connection.execute(
            "UPDATE replyset SET state = ?2, revision = revision + 1, updated_at = ?3
             WHERE id = ?1 AND state = 'sending'",
            params![set_id, state, now],
        )?;
    } else {
        connection.execute(
            "UPDATE replyset SET state = ?2
             WHERE id = ?1 AND state = 'sending'",
            params![set_id, state],
        )?;
    }
    Ok(())
}
