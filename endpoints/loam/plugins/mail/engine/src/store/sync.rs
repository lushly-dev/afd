//! What sync reads from the store and records in it beyond a batch of
//! headers or bytes (the specification's sections 5.2 to 5.7): the accounts
//! and mailboxes to sync, what a mailbox already shows, which listed messages
//! did not arrive, which bodies are still wanted, flags that changed, a
//! mailbox the provider stopped listing, and files a read found damaged.

use std::collections::{HashMap, HashSet};

use rusqlite::{OptionalExtension, params};

use super::{
    AccountId, Kept, MailboxCounts, MailboxId, MessageId, Role, Store, StoreError,
    UNRETURNED_AFTER_TRIES, check_validity, count, derived, flags_json, note_change, sql_size,
};
use crate::log::BlobId;
use crate::provider::FlagsSeen;

/// An account's row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountRow {
    /// Its id.
    pub id: AccountId,
    /// Its provider: `icloud`, `gmail`.
    pub provider: String,
    /// The address it signs in with.
    pub address: String,
}

/// A mailbox's row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MailboxRow {
    /// Its id.
    pub id: MailboxId,
    /// The provider's own name for it.
    pub provider_key: String,
    /// The name to show.
    pub name: String,
    /// What it is for.
    pub role: Role,
    /// Whether its bodies wait until someone opens a message.
    pub header_only: bool,
    /// The generation its provider ids belong to.
    pub validity: String,
    /// Where sync resumes; `None` until it was listed in full.
    pub cursor: Option<String>,
    /// How many ids its last listing named.
    pub listed: Option<u64>,
    /// When its last pass ended.
    pub last_pass_at: Option<i64>,
    /// Why its last pass failed, in the engine's words.
    pub last_error: Option<String>,
    /// Whether the provider has stopped listing it.
    pub gone: bool,
}

/// A listed message that has not arrived, and its tries so far.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tried {
    /// How many tries were counted.
    pub tries: u32,
    /// When the last counted try was.
    pub last_tried_at: i64,
}

/// A message whose bytes sync is to fetch whole.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BodyWanted {
    /// The provider's id for it in the mailbox.
    pub provider_id: String,
    /// The message.
    pub message: MessageId,
    /// The size the provider reports.
    pub size: u64,
}

/// A file a read found damaged or missing, and where to fetch it again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refetch {
    /// The message.
    pub message: MessageId,
    /// `header` or `whole`.
    pub part: String,
    /// The provider's id for the message in the mailbox asked about.
    pub provider_id: String,
}

/// What fetching a damaged file again did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refetched {
    /// The bytes matched what was held, and the file is whole again.
    Repaired,
    /// The provider returned other bytes; nothing was changed.
    Differs,
}

/// A mailbox's state for `mail-status` (the specification's section 5.7).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MailboxStatus {
    /// The counts the store keeps.
    pub counts: MailboxCounts,
    /// Messages the engine means to hold whole and does not yet, apart from
    /// those whose bodies the provider has not returned in three tries.
    pub bodies_wanted: u64,
    /// Messages whose bodies the provider has not returned in three tries:
    /// they no longer hold the mailbox back from "synced".
    pub bodies_unreturned: u64,
}

/// After this many fetches that return other bytes, a damaged file is left
/// for a person to look at.
pub const REFETCH_TRIES: u32 = 3;

/// A try for a body the provider did not return counts at most once an hour.
const BODY_TRY_SPACING_MS: i64 = 60 * 60 * 1000;

/// A body given up on is asked for again weekly.
const BODY_RETRY_MS: i64 = 7 * 24 * 60 * 60 * 1000;

impl Role {
    /// The role the store wrote.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "inbox" => Self::Inbox,
            "sent" => Self::Sent,
            "trash" => Self::Trash,
            "junk" => Self::Junk,
            "archive" => Self::Archive,
            "all" => Self::All,
            "none" => Self::None,
            _ => return None,
        })
    }
}

impl Store {
    /// Every account, oldest first.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn accounts(&self) -> Result<Vec<AccountRow>, StoreError> {
        let mut statement = self
            .connection
            .prepare_cached("SELECT id, provider, address FROM account ORDER BY id")?;
        let rows = statement.query_map([], |row| {
            Ok(AccountRow {
                id: AccountId(row.get(0)?),
                provider: row.get(1)?,
                address: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// An account's mailboxes, oldest first.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn mailboxes(&self, account: AccountId) -> Result<Vec<MailboxRow>, StoreError> {
        let mut statement = self.connection.prepare_cached(
            "SELECT id, provider_key, name, role, header_only, validity, cursor, listed,
                    last_pass_at, last_error, gone_at
             FROM mailbox WHERE account_id = ?1 ORDER BY id",
        )?;
        let rows = statement.query_map([account.0], |row| {
            let role: String = row.get(3)?;
            Ok(MailboxRow {
                id: MailboxId(row.get(0)?),
                provider_key: row.get(1)?,
                name: row.get(2)?,
                role: Role::parse(&role).unwrap_or(Role::None),
                header_only: row.get(4)?,
                validity: row.get(5)?,
                cursor: row.get(6)?,
                listed: row.get::<_, Option<i64>>(7)?.map(count),
                last_pass_at: row.get(8)?,
                last_error: row.get(9)?,
                gone: row.get::<_, Option<i64>>(10)?.is_some(),
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Records that the provider no longer lists a mailbox: its
    /// observations are closed and it shows nothing. If it comes back, it is
    /// listed again in full and its messages are matched by their identity.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] when the mailbox does not exist.
    pub fn retire_mailbox(&mut self, mailbox: MailboxId, now: i64) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        let changed = transaction.run(
            "UPDATE mailbox SET gone_at = ?2, cursor = NULL, listed = NULL
             WHERE id = ?1 AND gone_at IS NULL",
            params![mailbox.0, now],
        )?;
        if changed == 0 {
            let exists: Option<i64> = transaction
                .one("SELECT id FROM mailbox WHERE id = ?1", [mailbox.0], |row| {
                    row.get(0)
                })
                .optional()?;
            return match exists {
                Some(_) => Ok(()),
                None => Err(StoreError::NotFound("mailbox")),
            };
        }
        let closed = transaction.run(
            "UPDATE observation SET ended_at = ?2, ended_by = 'closed'
             WHERE mailbox_id = ?1 AND ended_at IS NULL",
            params![mailbox.0, now],
        )?;
        if closed > 0 {
            note_change(&transaction, now, "mailbox-closed", mailbox.0)?;
        }
        transaction.run("DELETE FROM unreturned WHERE mailbox_id = ?1", [mailbox.0])?;
        transaction.run(
            "DELETE FROM thread_place WHERE mailbox_id = ?1",
            [mailbox.0],
        )?;
        transaction.commit()?;
        Ok(())
    }

    /// The provider ids the mailbox currently shows in this generation.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn shown_ids(
        &self,
        mailbox: MailboxId,
        validity: &str,
    ) -> Result<HashSet<String>, StoreError> {
        let mut statement = self.connection.prepare_cached(
            "SELECT provider_id FROM observation
             WHERE mailbox_id = ?1 AND validity = ?2 AND ended_at IS NULL",
        )?;
        let rows = statement.query_map(params![mailbox.0, validity], |row| row.get(0))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// The mailbox's listed messages that have not arrived, with their tries.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn unreturned_tries(
        &self,
        mailbox: MailboxId,
        validity: &str,
    ) -> Result<HashMap<String, Tried>, StoreError> {
        let mut statement = self.connection.prepare_cached(
            "SELECT provider_id, tries, last_tried_at FROM unreturned
             WHERE mailbox_id = ?1 AND validity = ?2",
        )?;
        let rows = statement.query_map(params![mailbox.0, validity], |row| {
            Ok((
                row.get::<_, String>(0)?,
                Tried {
                    tries: row.get(1)?,
                    last_tried_at: row.get(2)?,
                },
            ))
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Records how many ids the mailbox's listing named.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] when the mailbox does not exist.
    pub fn set_listed(&mut self, mailbox: MailboxId, listed: u64) -> Result<(), StoreError> {
        let changed = self.connection.execute(
            "UPDATE mailbox SET listed = ?2 WHERE id = ?1",
            params![mailbox.0, sql_size(listed)],
        )?;
        if changed == 0 {
            Err(StoreError::NotFound("mailbox"))
        } else {
            Ok(())
        }
    }

    /// Records the flags or labels messages now carry in a mailbox, all or
    /// none. A message whose flags differ gets a new observation in place of
    /// its current one; one the mailbox does not show is left alone, since
    /// its headers have not been recorded. Returns how many changed.
    ///
    /// # Errors
    /// [`StoreError::ValidityMismatch`] when `validity` is not the mailbox's
    /// generation.
    pub fn record_flags(
        &mut self,
        mailbox: MailboxId,
        validity: &str,
        seen: &[FlagsSeen],
        now: i64,
    ) -> Result<u64, StoreError> {
        let transaction = self.connection.transaction()?;
        check_validity(&transaction, mailbox, validity)?;
        let mut touched = derived::Touched::new(derived::rebuild_cursor(&transaction)?);
        let mut changed = 0;
        for message in seen {
            let flags = flags_json(&message.flags);
            let current: Option<(i64, i64, String)> = transaction
                .one(
                    "SELECT id, message_id, flags FROM observation
                     WHERE mailbox_id = ?1 AND validity = ?2 AND provider_id = ?3
                       AND ended_at IS NULL",
                    params![mailbox.0, validity, message.provider_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;
            let Some((observation, shown, had)) = current else {
                continue;
            };
            if had == flags {
                continue;
            }
            transaction.run(
                "UPDATE observation SET ended_at = ?2, ended_by = 'superseded' WHERE id = ?1",
                params![observation, now],
            )?;
            transaction.run(
                "INSERT INTO observation
                     (message_id, mailbox_id, validity, provider_id, provider_thread, flags,
                      internal_date, seen_at)
                 SELECT message_id, mailbox_id, validity, provider_id, provider_thread, ?2,
                        internal_date, ?3
                 FROM observation WHERE id = ?1",
                params![observation, flags, now],
            )?;
            note_change(
                &transaction,
                now,
                "observation",
                transaction.last_insert_rowid(),
            )?;
            derived::touch_place(&transaction, mailbox.0, shown, &mut touched)?;
            changed += 1;
        }
        derived::settle(&transaction, &touched, now)?;
        transaction.commit()?;
        Ok(changed)
    }

    /// Every message the mailbox shows that is `max_size` bytes or less and
    /// not held whole, newest first: apart from one whose body the provider
    /// did not return within the last hour, or, after three tries, within
    /// the last week.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn bodies_wanted(
        &self,
        mailbox: MailboxId,
        validity: &str,
        max_size: u64,
        now: i64,
    ) -> Result<Vec<BodyWanted>, StoreError> {
        let mut statement = self.connection.prepare_cached(
            "SELECT observation.provider_id, observation.message_id, message.reported_size
             FROM observation JOIN message ON message.id = observation.message_id
             WHERE observation.mailbox_id = ?1 AND observation.validity = ?2
               AND observation.ended_at IS NULL AND message.reported_size <= ?3
               AND NOT EXISTS (SELECT 1 FROM held
                               WHERE held.message_id = observation.message_id
                                 AND held.part = 'whole')
               AND NOT EXISTS (SELECT 1 FROM body_missing
                               WHERE body_missing.message_id = observation.message_id
                                 AND body_missing.last_tried_at >
                                     ?4 - CASE WHEN body_missing.tries < ?5 THEN ?6 ELSE ?7 END)
             ORDER BY coalesce(observation.internal_date, message.first_seen_at) DESC,
                      observation.id DESC",
        )?;
        let parameters = params![
            mailbox.0,
            validity,
            sql_size(max_size),
            now,
            UNRETURNED_AFTER_TRIES,
            BODY_TRY_SPACING_MS,
            BODY_RETRY_MS
        ];
        let rows = statement.query_map(parameters, |row| {
            Ok(BodyWanted {
                provider_id: row.get(0)?,
                message: MessageId(row.get(1)?),
                size: count(row.get(2)?),
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Counts a try for each message whose body the provider did not return
    /// when asked: at most one an hour, as for headers (5.4).
    ///
    /// # Errors
    /// When the database refuses.
    pub fn record_bodies_not_returned(
        &mut self,
        messages: &[MessageId],
        now: i64,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        for message in messages {
            transaction.run(
                "INSERT INTO body_missing (message_id, tries, last_tried_at) VALUES (?1, 1, ?2)
                 ON CONFLICT (message_id) DO UPDATE
                 SET tries = tries + 1, last_tried_at = excluded.last_tried_at
                 WHERE excluded.last_tried_at - body_missing.last_tried_at >= ?3",
                params![message.0, now, BODY_TRY_SPACING_MS],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    /// Notes that a read found a message's file damaged or missing, so that
    /// sync fetches it again.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn note_damaged(&self, message: MessageId, part: &str, now: i64) -> Result<(), StoreError> {
        if part != "header" && part != "whole" {
            return Ok(());
        }
        self.connection.execute(
            "INSERT INTO refetch (message_id, part, noted_at) VALUES (?1, ?2, ?3)
             ON CONFLICT (message_id, part) DO NOTHING",
            params![message.0, part, now],
        )?;
        Ok(())
    }

    /// The damaged files sync can fetch again from this mailbox.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn refetch_wanted(
        &self,
        mailbox: MailboxId,
        validity: &str,
    ) -> Result<Vec<Refetch>, StoreError> {
        let mut statement = self.connection.prepare_cached(
            "SELECT refetch.message_id, refetch.part, min(observation.provider_id)
             FROM refetch JOIN observation ON observation.message_id = refetch.message_id
             WHERE observation.mailbox_id = ?1 AND observation.validity = ?2
               AND observation.ended_at IS NULL AND refetch.tries < ?3
             GROUP BY refetch.message_id, refetch.part
             ORDER BY refetch.message_id",
        )?;
        let rows = statement.query_map(params![mailbox.0, validity, REFETCH_TRIES], |row| {
            Ok(Refetch {
                message: MessageId(row.get(0)?),
                part: row.get(1)?,
                provider_id: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Stores bytes fetched again for a damaged file. When they are the bytes
    /// held, storing them repairs the file and the note is removed; when
    /// they are not, nothing is held differently and the try is counted.
    ///
    /// # Errors
    /// When the log or the database refuses.
    pub fn record_refetched(
        &mut self,
        message: MessageId,
        part: &str,
        bytes: &[u8],
        now: i64,
    ) -> Result<Refetched, StoreError> {
        let held: Option<Vec<u8>> = self
            .connection
            .query_row(
                "SELECT blob FROM held WHERE message_id = ?1 AND part = ?2",
                params![message.0, part],
                |row| row.get(0),
            )
            .optional()?;
        let same = held.is_some_and(|held| held == BlobId::of(bytes).as_bytes());
        if !same {
            self.connection.execute(
                "UPDATE refetch SET tries = tries + 1 WHERE message_id = ?1 AND part = ?2",
                params![message.0, part],
            )?;
            return Ok(Refetched::Differs);
        }
        // Storing bytes already held reads the file there, sets a damaged
        // one aside, and writes it afresh (the specification's section 4.1).
        let blob = self.log.put(bytes)?;
        self.log.make_durable(&[blob])?;
        // What was derived while the file could not be read is replaced; the
        // note goes only once that is done, so a failure leaves it for the
        // next pass.
        self.rederive(message.0, now)?;
        self.connection.execute(
            "DELETE FROM refetch WHERE message_id = ?1 AND part = ?2",
            params![message.0, part],
        )?;
        Ok(Refetched::Repaired)
    }

    /// A mailbox's state for `mail-status`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn mailbox_status(
        &self,
        mailbox: MailboxId,
        max_size: u64,
    ) -> Result<MailboxStatus, StoreError> {
        let counts = self.mailbox_counts(mailbox)?;
        let (bodies_wanted, bodies_unreturned): (i64, i64) = self.connection.query_row(
            "SELECT count(*) FILTER (WHERE coalesce(body_missing.tries, 0) < ?3),
                    count(*) FILTER (WHERE body_missing.tries >= ?3)
             FROM observation JOIN message ON message.id = observation.message_id
             LEFT JOIN body_missing ON body_missing.message_id = observation.message_id
             WHERE observation.mailbox_id = ?1 AND observation.ended_at IS NULL
               AND message.reported_size <= ?2
               AND NOT EXISTS (SELECT 1 FROM held
                               WHERE held.message_id = observation.message_id
                                 AND held.part = 'whole')",
            params![mailbox.0, sql_size(max_size), UNRETURNED_AFTER_TRIES],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        Ok(MailboxStatus {
            counts,
            bodies_wanted: count(bodies_wanted),
            bodies_unreturned: count(bodies_unreturned),
        })
    }
}
