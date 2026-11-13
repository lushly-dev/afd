//! The store: the log on disk and the SQLite tables over it (the
//! specification's section 4).
//!
//! This file is the part that is not derived from the log: accounts and
//! mailboxes, each message's identity and which of its bytes are held, and
//! the record of what a provider showed. What is derived (a message's fields,
//! its thread, where a thread shows, the search index) is in `derived`, and
//! is written in the same transaction as the bytes it is read from.

mod derived;
mod parts;
mod read;
mod remove;
mod schema;
mod sync;
mod tokens;

pub use derived::{Found, Opened, RebuildProgress, ThreadId, ThreadListed};
pub use read::{Evidence, LinkRow, MessageListed, PartRow, Shown};
pub use remove::{RemovalPreview, Removed};
pub use sync::{
    AccountRow, BodyWanted, MailboxRow, MailboxStatus, REFETCH_TRIES, Refetch, Refetched, Tried,
};
pub use tokens::TokenRow;

use std::fmt;

use rusqlite::{Connection, OptionalExtension, Transaction, params};

use crate::derive;
use crate::home::{Home, HomeError, HomeLock};
use crate::index::{Index, IndexError};
use crate::log::{BlobId, Log, LogError};

/// Why the store could not be opened, read or written.
#[derive(Debug)]
pub enum StoreError {
    /// Another process owns the store (`STORE_IN_USE`).
    InUse,
    /// The store was written by a newer program (`STORE_NEWER`).
    Newer {
        /// The schema version found in the store.
        found: u32,
        /// The newest version this program knows.
        supported: u32,
    },
    /// The mailbox's provider ids belong to another generation than the one
    /// given: the caller must call [`Store::set_validity`] first.
    ValidityMismatch,
    /// A row the caller named does not exist.
    NotFound(&'static str),
    /// A part's place in its message is not numbers joined by dots.
    BadPlace,
    /// Other bytes are already held for that part of the message.
    Conflict,
    /// The data directory refused.
    Home(HomeError),
    /// The log refused.
    Log(LogError),
    /// The search index refused.
    Index(IndexError),
    /// The search index is older than the tables, or gone: it was removed or
    /// restored from elsewhere. `mail-rebuild` makes it again.
    IndexStale,
    /// SQLite refused.
    Sqlite(rusqlite::Error),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InUse => write!(f, "another process owns the store"),
            Self::Newer { found, supported } => write!(
                f,
                "the store is at schema version {found} and this program knows up to {supported}"
            ),
            Self::ValidityMismatch => {
                write!(
                    f,
                    "the mailbox's ids belong to another generation than the one given"
                )
            }
            Self::NotFound(what) => write!(f, "the {what} does not exist"),
            Self::BadPlace => write!(f, "a part's place is numbers joined by dots"),
            Self::Conflict => write!(f, "other bytes are already held for that part"),
            Self::Home(error) => error.fmt(f),
            Self::Log(error) => error.fmt(f),
            Self::Index(error) => error.fmt(f),
            Self::IndexStale => write!(
                f,
                "the search index is older than the store; run `mail-rebuild`"
            ),
            Self::Sqlite(error) => write!(f, "the store's database refused: {error}"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<HomeError> for StoreError {
    fn from(error: HomeError) -> Self {
        match error {
            HomeError::InUse => Self::InUse,
            other => Self::Home(other),
        }
    }
}

impl From<LogError> for StoreError {
    fn from(error: LogError) -> Self {
        Self::Log(error)
    }
}

impl From<IndexError> for StoreError {
    fn from(error: IndexError) -> Self {
        Self::Index(error)
    }
}

impl From<rusqlite::Error> for StoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

/// An account's row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct AccountId(pub i64);

/// A mailbox's row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct MailboxId(pub i64);

/// A message's row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct MessageId(pub i64);

/// What a mailbox is for (the specification's section 5.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// Where new mail arrives.
    Inbox,
    /// What the person sent.
    Sent,
    /// What was deleted.
    Trash,
    /// What the provider judged to be junk.
    Junk,
    /// What was archived.
    Archive,
    /// Every message of the account (Gmail's "All Mail").
    All,
    /// A mailbox with no special use.
    None,
}

impl Role {
    /// The role as the store writes it.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Inbox => "inbox",
            Self::Sent => "sent",
            Self::Trash => "trash",
            Self::Junk => "junk",
            Self::Archive => "archive",
            Self::All => "all",
            Self::None => "none",
        }
    }

    /// Junk and trash are header-only: their bodies are fetched only when
    /// someone opens a message (the specification's section 5.3).
    #[must_use]
    pub fn header_only(self) -> bool {
        matches!(self, Self::Junk | Self::Trash)
    }
}

/// A mailbox as a provider lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MailboxSeen<'a> {
    /// The provider's own name for it: an IMAP mailbox name, a Gmail label id.
    pub provider_key: &'a str,
    /// The name to show.
    pub name: &'a str,
    /// What it is for.
    pub role: Role,
}

/// One message's headers as a provider returned them for a mailbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeaderSeen {
    /// The provider's id for the message in this mailbox: an IMAP UID, a Gmail id.
    pub provider_id: String,
    /// The provider's thread id, where it has one.
    pub provider_thread: Option<String>,
    /// The size the provider reports for the whole message.
    pub reported_size: u64,
    /// When the provider received the message, in milliseconds since the epoch.
    pub internal_date: Option<i64>,
    /// The flags or labels seen.
    pub flags: Vec<String>,
    /// The header block, exactly as returned.
    pub header_block: Vec<u8>,
}

/// Which bytes of a message a [`PartSeen`] holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Place<'a> {
    /// The whole message, exactly as returned.
    Whole,
    /// A text part of a message fetched in parts (the specification's M20),
    /// at this place in the message, such as `1.2`.
    Text(&'a str),
    /// An attachment, at this place in the message.
    Attachment(&'a str),
}

impl<'a> Place<'a> {
    /// A part's place is numbers joined by dots, so that it can never be
    /// mistaken for `header` or `whole`.
    fn is_valid(self) -> bool {
        match self {
            Self::Whole => true,
            Self::Text(place) | Self::Attachment(place) => place
                .split('.')
                .all(|number| !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit())),
        }
    }

    /// The `part` and `kind` columns.
    fn columns(self) -> (&'a str, &'static str) {
        match self {
            Self::Whole => ("whole", "whole"),
            Self::Text(place) => (place, "text"),
            Self::Attachment(place) => (place, "attachment"),
        }
    }
}

/// Bytes fetched for a message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PartSeen<'a> {
    /// The message they belong to.
    pub message: MessageId,
    /// Which of its bytes they are.
    pub place: Place<'a>,
    /// The bytes, exactly as returned.
    pub bytes: &'a [u8],
}

/// What recording a batch of headers did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BatchOutcome {
    /// Messages the store had not held before.
    pub new_messages: u64,
    /// Messages newly seen in this mailbox.
    pub added: u64,
    /// Messages whose flags, labels or thread changed.
    pub changed: u64,
    /// Messages seen again as they were.
    pub unchanged: u64,
}

/// A mailbox's counts (the specification's section 5.7).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MailboxCounts {
    /// Messages the mailbox currently shows whose headers are held.
    pub headers_held: u64,
    /// Of those, the ones held whole, or in parts (M20).
    pub bodies_held: u64,
    /// Listed messages that have not arrived and are still tried each pass.
    pub awaited: u64,
    /// Listed messages that did not arrive in [`UNRETURNED_AFTER_TRIES`]
    /// tries: they no longer hold the mailbox back from "synced".
    pub unreturned: u64,
}

/// How many tries make a listed message unreturned (the specification's
/// section 5.4). Sync decides what counts as a try: a pass, at least an hour
/// after the last.
pub const UNRETURNED_AFTER_TRIES: u32 = 3;

/// The longest header block or message the store will read back from the log.
/// A provider's largest message is far below it.
pub const READ_LIMIT: u64 = 256 * 1024 * 1024;

/// The open store. One process at a time holds it.
#[derive(Debug)]
pub struct Store {
    connection: Connection,
    log: Log,
    /// The search index, opened when it is first needed.
    index: Option<Index>,
    index_directory: std::path::PathBuf,
    _lock: HomeLock,
}

impl Store {
    /// Takes the data directory's lock, opens the database and the log, and
    /// brings the schema up to date.
    ///
    /// # Errors
    /// [`StoreError::InUse`] when another process owns the store, and
    /// [`StoreError::Newer`] when a newer program wrote it.
    pub fn open(home: &Home) -> Result<Self, StoreError> {
        Self::open_with(home, schema::MIGRATIONS)
    }

    /// [`Store::open`] with the migrations given, for the migration tests.
    fn open_with(home: &Home, migrations: &[&str]) -> Result<Self, StoreError> {
        let lock = home.lock()?;
        let log = Log::open(home.blobs())?;
        let mut connection = Connection::open(home.database())?;
        restrict_to_owner(&home.database())?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        // Every statement of a batch is prepared once and kept.
        connection.set_prepared_statement_cache_capacity(128);
        schema::migrate(&mut connection, migrations)?;
        // The write-ahead log and its index take the database file's mode
        // when SQLite creates them; this covers ones left from before.
        restrict_to_owner(&home.database().with_extension("sqlite3-wal"))?;
        restrict_to_owner(&home.database().with_extension("sqlite3-shm"))?;
        Ok(Self {
            connection,
            log,
            index: None,
            index_directory: home.index(),
            _lock: lock,
        })
    }

    /// The schema's version: the number of migrations applied.
    ///
    /// # Errors
    /// When the database cannot be read.
    pub fn schema_version(&self) -> Result<u32, StoreError> {
        Ok(self
            .connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))?)
    }

    /// The log.
    #[must_use]
    pub fn log(&self) -> &Log {
        &self.log
    }

    /// Adds an account, or returns the one already there for this provider
    /// and address.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn add_account(
        &mut self,
        provider: &str,
        address: &str,
        now: i64,
    ) -> Result<AccountId, StoreError> {
        self.connection.execute(
            "INSERT INTO account (provider, address, created_at) VALUES (?1, ?2, ?3)
             ON CONFLICT (provider, address) DO NOTHING",
            params![provider, address, now],
        )?;
        Ok(AccountId(self.connection.query_row(
            "SELECT id FROM account WHERE provider = ?1 AND address = ?2",
            params![provider, address],
            |row| row.get(0),
        )?))
    }

    /// Records a mailbox as the provider lists it: a new row, or the name and
    /// role of the one already there. Its cursor and its generation are kept.
    ///
    /// # Errors
    /// When the account does not exist or the database refuses.
    pub fn upsert_mailbox(
        &mut self,
        account: AccountId,
        seen: &MailboxSeen<'_>,
    ) -> Result<MailboxId, StoreError> {
        self.connection.execute(
            "INSERT INTO mailbox (account_id, provider_key, name, role, header_only)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (account_id, provider_key) DO UPDATE
             SET name = excluded.name, role = excluded.role, header_only = excluded.header_only,
                 gone_at = NULL",
            params![
                account.0,
                seen.provider_key,
                seen.name,
                seen.role.as_str(),
                seen.role.header_only()
            ],
        )?;
        Ok(MailboxId(self.connection.query_row(
            "SELECT id FROM mailbox WHERE account_id = ?1 AND provider_key = ?2",
            params![account.0, seen.provider_key],
            |row| row.get(0),
        )?))
    }

    /// The generation a mailbox's provider ids belong to, and its cursor.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] when the mailbox does not exist.
    pub fn mailbox_position(
        &self,
        mailbox: MailboxId,
    ) -> Result<(String, Option<String>), StoreError> {
        self.connection
            .query_row(
                "SELECT validity, cursor FROM mailbox WHERE id = ?1",
                [mailbox.0],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or(StoreError::NotFound("mailbox"))
    }

    /// Says which generation the mailbox's provider ids now belong to. When
    /// it differs from the one stored, every observation of the mailbox is
    /// closed, its cursor and its unreturned messages are forgotten, and the
    /// mailbox must be listed again; the messages stay and are matched by
    /// their identity (the specification's sections 4.2 and 5.2). Returns
    /// whether the generation changed.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] when the mailbox does not exist.
    pub fn set_validity(
        &mut self,
        mailbox: MailboxId,
        validity: &str,
        now: i64,
    ) -> Result<bool, StoreError> {
        let transaction = self.connection.transaction()?;
        let stored: String = transaction
            .one(
                "SELECT validity FROM mailbox WHERE id = ?1",
                [mailbox.0],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound("mailbox"))?;
        if stored == validity {
            return Ok(false);
        }
        let closed = transaction.run(
            "UPDATE observation SET ended_at = ?2, ended_by = 'closed'
             WHERE mailbox_id = ?1 AND ended_at IS NULL",
            params![mailbox.0, now],
        )?;
        if closed > 0 {
            // One row for the mailbox: a view of it reads it again in full.
            note_change(&transaction, now, "mailbox-closed", mailbox.0)?;
        }
        transaction.run("DELETE FROM unreturned WHERE mailbox_id = ?1", [mailbox.0])?;
        // The mailbox shows nothing until it is listed again.
        transaction.run(
            "DELETE FROM thread_place WHERE mailbox_id = ?1",
            [mailbox.0],
        )?;
        transaction.run(
            "UPDATE mailbox SET validity = ?2, cursor = NULL WHERE id = ?1",
            params![mailbox.0, validity],
        )?;
        transaction.commit()?;
        Ok(true)
    }

    /// Stores where sync resumes for a mailbox, and when the pass ended.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] when the mailbox does not exist.
    pub fn set_cursor(
        &mut self,
        mailbox: MailboxId,
        cursor: Option<&str>,
        now: i64,
    ) -> Result<(), StoreError> {
        let changed = self.connection.execute(
            "UPDATE mailbox SET cursor = ?2, last_pass_at = ?3, last_error = NULL WHERE id = ?1",
            params![mailbox.0, cursor, now],
        )?;
        if changed == 0 {
            Err(StoreError::NotFound("mailbox"))
        } else {
            Ok(())
        }
    }

    /// Records why a mailbox's last pass failed, in the engine's own words:
    /// never text from a message or from the provider.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] when the mailbox does not exist.
    pub fn set_error(&mut self, mailbox: MailboxId, error: &str) -> Result<(), StoreError> {
        let changed = self.connection.execute(
            "UPDATE mailbox SET last_error = ?2 WHERE id = ?1",
            params![mailbox.0, error],
        )?;
        if changed == 0 {
            Err(StoreError::NotFound("mailbox"))
        } else {
            Ok(())
        }
    }

    /// Records a batch of headers a provider returned for a mailbox, all or
    /// none: each header block goes to the log, each message is found by its
    /// identity or created, and what the mailbox now shows is recorded. A
    /// message that had been listed and not returned leaves that list. What
    /// the headers say (the sender, the subject, the thread) is derived in the
    /// same transaction.
    ///
    /// # Errors
    /// [`StoreError::ValidityMismatch`] when `validity` is not the mailbox's
    /// generation.
    pub fn record_headers(
        &mut self,
        mailbox: MailboxId,
        validity: &str,
        batch: &[HeaderSeen],
        now: i64,
    ) -> Result<BatchOutcome, StoreError> {
        // The log first: a file with no row is harmless, a row with no file is not.
        let blocks: Vec<&[u8]> = batch
            .iter()
            .map(|seen| seen.header_block.as_slice())
            .collect();
        let blobs = self.log.put_all(&blocks)?;
        // On the disk before any row says they are held.
        self.log.make_durable(&blobs)?;
        self.ensure_index()?;
        let transaction = self.connection.transaction()?;
        check_validity(&transaction, mailbox, validity)?;
        let mut outcome = BatchOutcome::default();
        let mut touched = derived::Touched::new(derived::rebuild_cursor(&transaction)?);
        for (seen, blob) in batch.iter().zip(blobs) {
            record_header(
                &transaction,
                mailbox,
                validity,
                seen,
                blob,
                now,
                &mut outcome,
                &mut touched,
            )?;
        }
        derived::settle(&transaction, &touched, now)?;
        transaction.commit()?;
        self.index_documents(&touched.documents)?;
        Ok(outcome)
    }

    /// Records bytes fetched for messages, all or none: the whole of a
    /// message, a text part, or an attachment someone opened. The files are
    /// on the disk before any row says they are held. A message that arrives
    /// whole, or a message held in parts that gains one, has its snippet, its
    /// parts and its text derived in the same transaction.
    ///
    /// A part already held with the same bytes is left as it is. One held
    /// with other bytes is refused: a message's identity fixes its bytes, so
    /// a difference is something to look at, not to overwrite.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] when a message does not exist,
    /// [`StoreError::BadPlace`] when a part's place is not digits and dots,
    /// and [`StoreError::Conflict`] when other bytes are held there.
    pub fn record_parts(
        &mut self,
        parts: &[PartSeen<'_>],
        now: i64,
    ) -> Result<Vec<BlobId>, StoreError> {
        for part in parts {
            if !part.place.is_valid() {
                return Err(StoreError::BadPlace);
            }
        }
        // A message held in parts that gains one is read before the
        // transaction opens, with the part in its place.
        let mut gaining = self.bodies_gaining(parts)?;
        let bytes: Vec<&[u8]> = parts.iter().map(|part| part.bytes).collect();
        let blobs = self.log.put_all(&bytes)?;
        self.log.make_durable(&blobs)?;
        self.ensure_index()?;
        let transaction = self.connection.transaction()?;
        let mut touched = derived::Touched::new(derived::rebuild_cursor(&transaction)?);
        let mut gained = Vec::new();
        for (part, blob) in parts.iter().zip(&blobs) {
            let exists: Option<i64> = transaction
                .one(
                    "SELECT id FROM message WHERE id = ?1",
                    [part.message.0],
                    |row| row.get(0),
                )
                .optional()?;
            if exists.is_none() {
                return Err(StoreError::NotFound("message"));
            }
            let (place, kind) = part.place.columns();
            let held: Option<Vec<u8>> = transaction
                .one(
                    "SELECT blob FROM held WHERE message_id = ?1 AND part = ?2",
                    params![part.message.0, place],
                    |row| row.get(0),
                )
                .optional()?;
            match held {
                Some(other) if other != blob.as_bytes() => return Err(StoreError::Conflict),
                Some(_) => {}
                None => {
                    transaction.run(
                        "INSERT INTO held (message_id, part, kind, blob, size)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![
                            part.message.0,
                            place,
                            kind,
                            blob.as_bytes().as_slice(),
                            size_of(part.bytes)
                        ],
                    )?;
                    if part.place == Place::Whole {
                        transaction.run(
                            "DELETE FROM body_missing WHERE message_id = ?1",
                            [part.message.0],
                        )?;
                    }
                    if part.place == Place::Whole && !touched.awaits_rebuild(part.message.0) {
                        derived::derive_body(
                            &transaction,
                            part.message.0,
                            derive::body_fields(part.bytes),
                            &mut touched,
                        )?;
                    } else if part.place != Place::Whole {
                        gained.push(part.message.0);
                    }
                }
            }
        }
        for message in gained {
            if let Some(body) = gaining.remove(&message)
                && !touched.awaits_rebuild(message)
            {
                derived::derive_body(&transaction, message, body, &mut touched)?;
            }
        }
        derived::settle(&transaction, &touched, now)?;
        transaction.commit()?;
        self.index_documents(&touched.documents)?;
        Ok(blobs)
    }

    /// Counts a try for each listed message that did not arrive (the
    /// specification's section 5.4).
    ///
    /// # Errors
    /// [`StoreError::ValidityMismatch`] when `validity` is not the mailbox's
    /// generation.
    pub fn record_not_returned(
        &mut self,
        mailbox: MailboxId,
        validity: &str,
        provider_ids: &[&str],
        now: i64,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        check_validity(&transaction, mailbox, validity)?;
        for provider_id in provider_ids {
            transaction.run(
                "INSERT INTO unreturned
                     (mailbox_id, validity, provider_id, tries, first_tried_at, last_tried_at)
                 VALUES (?1, ?2, ?3, 1, ?4, ?4)
                 ON CONFLICT (mailbox_id, validity, provider_id) DO UPDATE
                 SET tries = tries + 1, last_tried_at = excluded.last_tried_at",
                params![mailbox.0, validity, provider_id, now],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    /// Records that messages are no longer in the mailbox's listing: their
    /// observations are ended as removed, and a listed message that never
    /// arrived leaves that list. Returns how many observations ended.
    ///
    /// # Errors
    /// [`StoreError::ValidityMismatch`] when `validity` is not the mailbox's
    /// generation.
    pub fn record_removed(
        &mut self,
        mailbox: MailboxId,
        validity: &str,
        provider_ids: &[&str],
        now: i64,
    ) -> Result<u64, StoreError> {
        let transaction = self.connection.transaction()?;
        check_validity(&transaction, mailbox, validity)?;
        let mut ended = 0;
        let mut touched = derived::Touched::new(derived::rebuild_cursor(&transaction)?);
        for provider_id in provider_ids {
            let observation: Option<(i64, i64)> = transaction
                .one(
                    "UPDATE observation SET ended_at = ?4, ended_by = 'removed'
                     WHERE mailbox_id = ?1 AND validity = ?2 AND provider_id = ?3
                       AND ended_at IS NULL
                     RETURNING id, message_id",
                    params![mailbox.0, validity, provider_id, now],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            if let Some((observation, message)) = observation {
                ended += 1;
                note_change(&transaction, now, "observation-ended", observation)?;
                derived::touch_place(&transaction, mailbox.0, message, &mut touched)?;
            }
            transaction.run(
                "DELETE FROM unreturned
                 WHERE mailbox_id = ?1 AND validity = ?2 AND provider_id = ?3",
                params![mailbox.0, validity, provider_id],
            )?;
        }
        derived::settle(&transaction, &touched, now)?;
        transaction.commit()?;
        Ok(ended)
    }

    /// The message with this identity, if the store has it.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn find_message(
        &self,
        header_block: &[u8],
        reported_size: u64,
    ) -> Result<Option<MessageId>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT id FROM message WHERE header_hash = ?1 AND reported_size = ?2",
                params![
                    BlobId::of(header_block).as_bytes().as_slice(),
                    sql_size(reported_size)
                ],
                |row| row.get(0),
            )
            .optional()?
            .map(MessageId))
    }

    /// The bytes held for one part of a message, checked against the log:
    /// `header`, `whole`, or a part's place.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] when that part is not held.
    pub fn read_part(&self, message: MessageId, place: &str) -> Result<Vec<u8>, StoreError> {
        let blob: Vec<u8> = self
            .connection
            .query_row(
                "SELECT blob FROM held WHERE message_id = ?1 AND part = ?2",
                params![message.0, place],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound("part"))?;
        let id = BlobId::from_bytes(&blob).ok_or(StoreError::NotFound("part"))?;
        match self.log.get(id, READ_LIMIT) {
            Ok(bytes) => Ok(bytes),
            Err(error @ (LogError::Corrupt(_) | LogError::NotHeld(_))) => {
                // Sync fetches it again, and storing the bytes repairs it.
                self.note_damaged(message, place, wall_clock())?;
                Err(error.into())
            }
            Err(error) => Err(error.into()),
        }
    }

    /// A mailbox's counts.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn mailbox_counts(&self, mailbox: MailboxId) -> Result<MailboxCounts, StoreError> {
        let (headers_held, bodies_held) = self.connection.query_row(
            "SELECT count(*),
                    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM held
                                                   WHERE held.message_id = observation.message_id
                                                     AND part = 'whole')
                                        OR EXISTS (SELECT 1 FROM structure
                                                   WHERE structure.message_id =
                                                         observation.message_id))
             FROM observation WHERE mailbox_id = ?1 AND ended_at IS NULL",
            [mailbox.0],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )?;
        let (awaited, unreturned) = self.connection.query_row(
            "SELECT count(*) FILTER (WHERE tries < ?2), count(*) FILTER (WHERE tries >= ?2)
             FROM unreturned WHERE mailbox_id = ?1",
            params![mailbox.0, UNRETURNED_AFTER_TRIES],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )?;
        Ok(MailboxCounts {
            headers_held: count(headers_held),
            bodies_held: count(bodies_held),
            awaited: count(awaited),
            unreturned: count(unreturned),
        })
    }

    /// The sequence number of the latest change, or 0 when there is none.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn last_change(&self) -> Result<u64, StoreError> {
        let seq: i64 =
            self.connection
                .query_row("SELECT coalesce(max(seq), 0) FROM change", [], |row| {
                    row.get(0)
                })?;
        Ok(count(seq))
    }
}

/// Statements that run once for each message of a batch are prepared once
/// and kept, which `Connection::execute` and `query_row` do not do.
pub(super) trait Kept {
    /// Runs a statement that returns no row.
    fn run(&self, sql: &str, params: impl rusqlite::Params) -> rusqlite::Result<usize>;
    /// Reads the one row a statement returns.
    fn one<T>(
        &self,
        sql: &str,
        params: impl rusqlite::Params,
        read: impl FnOnce(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
    ) -> rusqlite::Result<T>;
}

impl Kept for Connection {
    fn run(&self, sql: &str, params: impl rusqlite::Params) -> rusqlite::Result<usize> {
        self.prepare_cached(sql)?.execute(params)
    }

    fn one<T>(
        &self,
        sql: &str,
        params: impl rusqlite::Params,
        read: impl FnOnce(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
    ) -> rusqlite::Result<T> {
        self.prepare_cached(sql)?.query_row(params, read)
    }
}

/// Fails unless `validity` is the mailbox's generation.
fn check_validity(
    transaction: &Transaction<'_>,
    mailbox: MailboxId,
    validity: &str,
) -> Result<(), StoreError> {
    let stored: String = transaction
        .one(
            "SELECT validity FROM mailbox WHERE id = ?1",
            [mailbox.0],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(StoreError::NotFound("mailbox"))?;
    if stored == validity {
        Ok(())
    } else {
        Err(StoreError::ValidityMismatch)
    }
}

/// Records one header of a batch inside the batch's transaction.
#[expect(
    clippy::too_many_arguments,
    reason = "one call site; a struct would only rename the batch"
)]
fn record_header(
    transaction: &Transaction<'_>,
    mailbox: MailboxId,
    validity: &str,
    seen: &HeaderSeen,
    blob: BlobId,
    now: i64,
    outcome: &mut BatchOutcome,
    touched: &mut derived::Touched,
) -> Result<(), StoreError> {
    let hash = blob.as_bytes().as_slice();
    let created = transaction.run(
        "INSERT INTO message (header_hash, reported_size, first_seen_at, received_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (header_hash, reported_size) DO NOTHING",
        params![hash, sql_size(seen.reported_size), now, seen.internal_date],
    )?;
    let message: i64 = transaction.one(
        "SELECT id FROM message WHERE header_hash = ?1 AND reported_size = ?2",
        params![hash, sql_size(seen.reported_size)],
        |row| row.get(0),
    )?;
    if created > 0 {
        outcome.new_messages += 1;
        transaction.run(
            "INSERT INTO held (message_id, part, kind, blob, size)
             VALUES (?1, 'header', 'header', ?2, ?3)",
            params![message, hash, size_of(&seen.header_block)],
        )?;
        if !touched.awaits_rebuild(message) {
            derived::derive_header(
                transaction,
                message,
                &derive::header_fields(&seen.header_block),
                touched,
            )?;
        }
    }

    let flags = flags_json(&seen.flags);
    let current: Option<(i64, i64, String, Option<String>)> = transaction
        .one(
            "SELECT id, message_id, flags, provider_thread FROM observation
             WHERE mailbox_id = ?1 AND validity = ?2 AND provider_id = ?3 AND ended_at IS NULL",
            params![mailbox.0, validity, seen.provider_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    match current {
        Some((_, same, ref had, ref thread))
            if same == message && *had == flags && *thread == seen.provider_thread =>
        {
            outcome.unchanged += 1;
        }
        Some((previous, shown, ..)) => {
            transaction.run(
                "UPDATE observation SET ended_at = ?2, ended_by = 'superseded' WHERE id = ?1",
                params![previous, now],
            )?;
            observe(transaction, mailbox, validity, seen, message, &flags, now)?;
            outcome.changed += 1;
            // The provider's id may now name another message, and the flags
            // decide what is unread.
            if shown != message {
                derived::touch_place(transaction, mailbox.0, shown, touched)?;
            }
            derived::touch_place(transaction, mailbox.0, message, touched)?;
        }
        None => {
            observe(transaction, mailbox, validity, seen, message, &flags, now)?;
            outcome.added += 1;
            derived::touch_place(transaction, mailbox.0, message, touched)?;
        }
    }
    transaction.run(
        "DELETE FROM unreturned WHERE mailbox_id = ?1 AND validity = ?2 AND provider_id = ?3",
        params![mailbox.0, validity, seen.provider_id],
    )?;
    Ok(())
}

/// Writes a new current observation and the change that announces it.
fn observe(
    transaction: &Transaction<'_>,
    mailbox: MailboxId,
    validity: &str,
    seen: &HeaderSeen,
    message: i64,
    flags: &str,
    now: i64,
) -> Result<(), StoreError> {
    transaction.run(
        "INSERT INTO observation
             (message_id, mailbox_id, validity, provider_id, provider_thread, flags,
              internal_date, seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            message,
            mailbox.0,
            validity,
            seen.provider_id,
            seen.provider_thread,
            flags,
            seen.internal_date,
            now
        ],
    )?;
    note_change(
        transaction,
        now,
        "observation",
        transaction.last_insert_rowid(),
    )
}

/// Appends a row to the change table.
pub(super) fn note_change(
    transaction: &Transaction<'_>,
    now: i64,
    kind: &str,
    subject: i64,
) -> Result<(), StoreError> {
    transaction.run(
        "INSERT INTO change (at, kind, subject) VALUES (?1, ?2, ?3)",
        params![now, kind, subject],
    )?;
    Ok(())
}

/// The flags as the store compares and keeps them: sorted, each once, as a
/// JSON array.
fn flags_json(flags: &[String]) -> String {
    let mut sorted: Vec<&str> = flags.iter().map(String::as_str).collect();
    sorted.sort_unstable();
    sorted.dedup();
    let quoted: Vec<String> = sorted.iter().map(|flag| json_string(flag)).collect();
    format!("[{}]", quoted.join(","))
}

/// One JSON string.
fn json_string(text: &str) -> String {
    let mut quoted = String::with_capacity(text.len() + 2);
    quoted.push('"');
    for character in text.chars() {
        match character {
            '"' => quoted.push_str("\\\""),
            '\\' => quoted.push_str("\\\\"),
            control if u32::from(control) < 0x20 => {
                quoted.push_str(&format!("\\u{:04x}", u32::from(control)));
            }
            other => quoted.push(other),
        }
    }
    quoted.push('"');
    quoted
}

/// The time now in milliseconds, for a record that is only informative.
fn wall_clock() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

/// A size as SQLite holds it. No message is 8 EiB long; one that claims to be is clamped.
fn sql_size(size: u64) -> i64 {
    i64::try_from(size).unwrap_or(i64::MAX)
}

/// The length of `bytes` as SQLite holds it.
fn size_of(bytes: &[u8]) -> i64 {
    i64::try_from(bytes.len()).unwrap_or(i64::MAX)
}

/// A count SQLite returned, which is never negative.
fn count(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}

/// Makes a file readable and writable by its owner alone, if it exists.
/// SQLite creates its files with the process's default mode, inside a
/// directory only the owner can enter.
fn restrict_to_owner(path: &std::path::Path) -> Result<(), StoreError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        match std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(StoreError::Home(HomeError::Io(error))),
        }
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[cfg(test)]
mod derived_tests;
#[cfg(test)]
mod tests;
