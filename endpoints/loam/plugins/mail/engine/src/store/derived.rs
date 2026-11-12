//! What is derived from the log: a message's fields, its thread, where each
//! thread shows, and the search index (the specification's sections 4.1 and
//! 4.3).
//!
//! Every row here can be thrown away and made again from the log and the
//! tables that are not derived; [`Store::rebuild`] does exactly that. Two
//! rules make a rebuild give the same rows as the writes that came before it:
//!
//! - A thread's id is the lowest id of its messages, whatever order they
//!   arrived in.
//! - A thread's row and a thread's place in a mailbox are never adjusted.
//!   Each is computed again from the messages, once for each batch that
//!   touched it.

use std::collections::BTreeSet;

use rusqlite::{Connection, OptionalExtension, Transaction, params};

use super::{Kept, MailboxId, MessageId, Store, StoreError, count, note_change};
use crate::derive::{self, BodyFields, HeaderFields, PARSER_VERSION};
use crate::index::{Document, Index};
use crate::log::LogError;

/// The `engine_state` key of a rebuild under way: the highest message id it
/// has derived.
const REBUILD: &str = "rebuild";
/// The `engine_state` key of the highest `index_pending.seq` the index is
/// known to hold on the disk.
const INDEX_COMMITTED: &str = "index-committed";
/// The index is committed once this many documents wait.
const COMMIT_EVERY: usize = 5_000;
/// The most messages one search returns, whatever the caller asks for.
const SEARCH_LIMIT: u32 = 1_000;
/// How many messages a rebuild derives in one transaction.
const REBUILD_BATCH: i64 = 200;
/// A Date header this far after the message was first seen is not believed.
const DATE_SLACK_MS: i64 = 24 * 60 * 60 * 1000;

/// A thread's row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ThreadId(pub i64);

/// A thread as a list of a mailbox shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadListed {
    /// The thread.
    pub thread: ThreadId,
    /// The date of its newest message in this mailbox, in milliseconds.
    pub last_date: i64,
    /// How many of its messages this mailbox shows.
    pub shown: u64,
    /// How many of those are unread.
    pub unread: u64,
    /// How many messages it has in all.
    pub messages: u64,
    /// How many attachments its messages have.
    pub attachments: u64,
    /// The subject of its oldest message.
    pub subject: String,
    /// The snippet of its newest message.
    pub snippet: String,
    /// The sender of its newest message: the name, or the address.
    pub last_sender: String,
}

/// A message a search found, with its thread.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    /// The message.
    pub message: MessageId,
    /// Its thread.
    pub thread: ThreadId,
    /// The date it is listed under, in milliseconds.
    pub date: i64,
    /// The thread's subject.
    pub subject: String,
    /// The message's snippet.
    pub snippet: String,
    /// The message's sender: the name, or the address.
    pub sender: String,
}

/// A message read back from the log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Opened {
    /// What its headers say.
    pub header: HeaderFields,
    /// What its body says; `None` when only its headers are held.
    pub body: Option<BodyFields>,
}

/// How far a rebuild has come.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RebuildProgress {
    /// The highest message id derived.
    pub done: u64,
    /// The highest message id there is.
    pub total: u64,
    /// Whether the rebuild is over.
    pub finished: bool,
}

/// What a batch changed, so that each thread and each place is computed
/// again once, and each document reaches the index once.
#[derive(Debug)]
pub(super) struct Touched {
    /// A rebuild under way has derived messages up to this id.
    rebuild_cursor: Option<i64>,
    threads: BTreeSet<i64>,
    places: BTreeSet<(i64, i64)>,
    pub(super) documents: Vec<Document>,
}

impl Touched {
    pub(super) fn new(rebuild_cursor: Option<i64>) -> Self {
        Self {
            rebuild_cursor,
            threads: BTreeSet::new(),
            places: BTreeSet::new(),
            documents: Vec::new(),
        }
    }

    /// Whether `message` is left for the rebuild under way to derive: it has
    /// not reached it yet, and will.
    pub(super) fn awaits_rebuild(&self, message: i64) -> bool {
        self.rebuild_cursor.is_some_and(|cursor| message > cursor)
    }
}

fn state(connection: &Connection, key: &str) -> Result<Option<i64>, StoreError> {
    Ok(connection
        .query_row(
            "SELECT value FROM engine_state WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()?)
}

fn set_state(connection: &Connection, key: &str, value: i64) -> Result<(), StoreError> {
    connection.execute(
        "INSERT INTO engine_state (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// How far a rebuild under way has come, if one is.
pub(super) fn rebuild_cursor(connection: &Connection) -> Result<Option<i64>, StoreError> {
    state(connection, REBUILD)
}

/// Derives what a message's headers say: its row, its thread, and its
/// document for the index.
pub(super) fn derive_header(
    transaction: &Transaction<'_>,
    message: i64,
    header: &HeaderFields,
    touched: &mut Touched,
) -> Result<(), StoreError> {
    let (first_seen, received): (i64, Option<i64>) = transaction.one(
        "SELECT first_seen_at, received_at FROM message WHERE id = ?1",
        [message],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    // A sender writes the Date header, and can write one in the future to
    // stay on top of a list.
    let date = match header.sent_at {
        Some(sent) if sent <= first_seen.saturating_add(DATE_SLACK_MS) => sent,
        _ => received.unwrap_or(first_seen),
    };

    // The message joins every thread that it names or that names it (5.6).
    // When that is more than one, they were one thread all along.
    let mut found: BTreeSet<i64> = BTreeSet::new();
    let had: Option<i64> = transaction
        .one(
            "SELECT thread_id FROM envelope WHERE message_id = ?1",
            [message],
            |row| row.get(0),
        )
        .optional()?;
    found.extend(had);
    for key in &header.keys {
        let named: Option<i64> = transaction
            .one(
                "SELECT thread_id FROM thread_key WHERE key = ?1",
                [key.as_slice()],
                |row| row.get(0),
            )
            .optional()?;
        found.extend(named);
    }
    // A thread's id is the lowest id of its messages, this one included.
    let thread = found
        .first()
        .copied()
        .map_or(message, |lowest| lowest.min(message));
    for loser in found.iter().copied().filter(|other| *other != thread) {
        merge(transaction, loser, thread, touched)?;
    }
    for key in &header.keys {
        transaction.run(
            "INSERT INTO thread_key (key, thread_id) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET thread_id = excluded.thread_id",
            params![key.as_slice(), thread],
        )?;
    }

    transaction.run(
        "INSERT INTO envelope
             (message_id, parser, thread_id, date, sent_at, sender_address, sender_name,
              subject, unparsed)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (message_id) DO UPDATE SET
             parser = excluded.parser, thread_id = excluded.thread_id, date = excluded.date,
             sent_at = excluded.sent_at, sender_address = excluded.sender_address,
             sender_name = excluded.sender_name, subject = excluded.subject,
             unparsed = excluded.unparsed",
        params![
            message,
            PARSER_VERSION,
            thread,
            date,
            header.sent_at,
            header.sender_address,
            header.sender_name,
            header.subject,
            header.unparsed
        ],
    )?;
    touched.threads.insert(thread);
    let mut shown = transaction.prepare_cached(
        "SELECT DISTINCT mailbox_id FROM observation WHERE message_id = ?1 AND ended_at IS NULL",
    )?;
    let mailboxes = shown.query_map([message], |row| row.get::<_, i64>(0))?;
    for mailbox in mailboxes {
        touched.places.insert((mailbox?, thread));
    }
    enqueue(
        transaction,
        Document {
            seq: 0,
            message,
            date,
            sender: header.sender_address.clone(),
            subject: header.subject.clone(),
            text: String::new(),
        },
        touched,
    )
}

/// Derives what a message's body says, once it is held whole: its snippet,
/// its parts, and its text for the index. A message with no row yet is left
/// alone: a rebuild is under way and will reach it.
pub(super) fn derive_body(
    transaction: &Transaction<'_>,
    message: i64,
    body: BodyFields,
    touched: &mut Touched,
) -> Result<(), StoreError> {
    let row: Option<(i64, i64, String, String)> = transaction
        .one(
            "SELECT thread_id, date, sender_address, subject FROM envelope WHERE message_id = ?1",
            [message],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let Some((thread, date, sender, subject)) = row else {
        return Ok(());
    };
    transaction.run(
        "UPDATE envelope SET snippet = ?2, attachments = ?3, unparsed = coalesce(?4, unparsed)
         WHERE message_id = ?1",
        params![message, body.snippet, body.attachments, body.unparsed],
    )?;
    transaction.run("DELETE FROM part WHERE message_id = ?1", [message])?;
    {
        let mut insert = transaction.prepare_cached(
            "INSERT INTO part (message_id, place, content_type, name, size, attachment)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT (message_id, place) DO NOTHING",
        )?;
        for part in &body.parts {
            insert.execute(params![
                message,
                part.place,
                part.content_type,
                part.name,
                i64::try_from(part.size).unwrap_or(i64::MAX),
                part.attachment
            ])?;
        }
    }
    touched.threads.insert(thread);
    // The headers' document, when this batch made one, gains the text.
    if let Some(document) = touched
        .documents
        .iter_mut()
        .rev()
        .find(|document| document.message == message)
    {
        document.text = body.text;
        return Ok(());
    }
    enqueue(
        transaction,
        Document {
            seq: 0,
            message,
            date,
            sender,
            subject,
            text: body.text,
        },
        touched,
    )
}

/// Notes that the index lacks `document`, and keeps it for after the commit.
fn enqueue(
    transaction: &Transaction<'_>,
    mut document: Document,
    touched: &mut Touched,
) -> Result<(), StoreError> {
    transaction.run(
        "INSERT INTO index_pending (message_id) VALUES (?1)",
        [document.message],
    )?;
    document.seq = count(transaction.last_insert_rowid());
    touched.documents.push(document);
    Ok(())
}

/// Makes `loser`'s messages part of `winner`.
fn merge(
    transaction: &Transaction<'_>,
    loser: i64,
    winner: i64,
    touched: &mut Touched,
) -> Result<(), StoreError> {
    transaction.run(
        "UPDATE envelope SET thread_id = ?2 WHERE thread_id = ?1",
        params![loser, winner],
    )?;
    transaction.run(
        "UPDATE thread_key SET thread_id = ?2 WHERE thread_id = ?1",
        params![loser, winner],
    )?;
    {
        let mut places = transaction
            .prepare_cached("SELECT mailbox_id FROM thread_place WHERE thread_id = ?1")?;
        let mailboxes = places.query_map([loser], |row| row.get::<_, i64>(0))?;
        for mailbox in mailboxes {
            let mailbox = mailbox?;
            touched.places.insert((mailbox, loser));
            touched.places.insert((mailbox, winner));
        }
    }
    // A place this batch touched has no row yet for the query above to find.
    let unsettled: Vec<i64> = touched
        .places
        .iter()
        .filter(|(_, thread)| *thread == loser)
        .map(|(mailbox, _)| *mailbox)
        .collect();
    for mailbox in unsettled {
        touched.places.insert((mailbox, winner));
    }
    touched.threads.insert(loser);
    touched.threads.insert(winner);
    Ok(())
}

/// Notes that what `mailbox` shows of `message`'s thread changed. A message
/// with no row yet has no thread: a rebuild will reach it.
pub(super) fn touch_place(
    transaction: &Transaction<'_>,
    mailbox: i64,
    message: i64,
    touched: &mut Touched,
) -> Result<(), StoreError> {
    let thread: Option<i64> = transaction
        .one(
            "SELECT thread_id FROM envelope WHERE message_id = ?1",
            [message],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(thread) = thread {
        touched.places.insert((mailbox, thread));
    }
    Ok(())
}

/// Computes again every thread and every place the batch touched, and says
/// which threads changed.
pub(super) fn settle(
    transaction: &Transaction<'_>,
    touched: &Touched,
    now: i64,
) -> Result<(), StoreError> {
    for thread in &touched.threads {
        compute_thread(transaction, *thread)?;
        note_change(transaction, now, "thread", *thread)?;
    }
    for (mailbox, thread) in &touched.places {
        compute_place(transaction, *mailbox, *thread)?;
    }
    Ok(())
}

fn compute_thread(transaction: &Transaction<'_>, thread: i64) -> Result<(), StoreError> {
    let (messages, last_date, attachments): (i64, Option<i64>, Option<i64>) = transaction.one(
        "SELECT count(*), max(date), sum(attachments) FROM envelope WHERE thread_id = ?1",
        [thread],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let Some(last_date) = last_date else {
        transaction.run("DELETE FROM thread WHERE id = ?1", [thread])?;
        return Ok(());
    };
    let subject: String = transaction.one(
        "SELECT subject FROM envelope WHERE thread_id = ?1 ORDER BY date, message_id LIMIT 1",
        [thread],
        |row| row.get(0),
    )?;
    let (last_message, snippet, last_sender): (i64, String, String) = transaction.one(
        "SELECT message_id, snippet,
                CASE WHEN sender_name = '' THEN sender_address ELSE sender_name END
         FROM envelope WHERE thread_id = ?1 ORDER BY date DESC, message_id DESC LIMIT 1",
        [thread],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    transaction.run(
        "INSERT INTO thread
             (id, last_date, messages, attachments, last_message, subject, snippet, last_sender)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT (id) DO UPDATE SET
             last_date = excluded.last_date, messages = excluded.messages,
             attachments = excluded.attachments, last_message = excluded.last_message,
             subject = excluded.subject, snippet = excluded.snippet,
             last_sender = excluded.last_sender",
        params![
            thread,
            last_date,
            messages,
            attachments.unwrap_or(0),
            last_message,
            subject,
            snippet,
            last_sender
        ],
    )?;
    Ok(())
}

/// `\Seen` as the store writes it inside an observation's flags: a JSON
/// string, so its backslash is escaped.
pub(super) const SEEN_IN_FLAGS: &str = "\"\\\\Seen\"";

fn compute_place(
    transaction: &Transaction<'_>,
    mailbox: i64,
    thread: i64,
) -> Result<(), StoreError> {
    // A message is unread when no current observation of it in this mailbox
    // carries `\Seen`.
    let (messages, last_date, unread): (i64, Option<i64>, i64) = transaction.one(
        "SELECT count(*), max(envelope.date),
                count(*) FILTER (WHERE NOT EXISTS (
                    SELECT 1 FROM observation
                    WHERE observation.message_id = envelope.message_id
                      AND observation.mailbox_id = ?1 AND observation.ended_at IS NULL
                      AND instr(observation.flags, ?3) > 0))
         FROM envelope
         WHERE envelope.thread_id = ?2
           AND EXISTS (SELECT 1 FROM observation
                       WHERE observation.message_id = envelope.message_id
                         AND observation.mailbox_id = ?1 AND observation.ended_at IS NULL)",
        params![mailbox, thread, SEEN_IN_FLAGS],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    match last_date {
        None => {
            transaction.run(
                "DELETE FROM thread_place WHERE mailbox_id = ?1 AND thread_id = ?2",
                params![mailbox, thread],
            )?;
        }
        Some(last_date) => {
            transaction.run(
                "INSERT INTO thread_place (mailbox_id, thread_id, last_date, messages, unread)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT (mailbox_id, thread_id) DO UPDATE SET
                     last_date = excluded.last_date, messages = excluded.messages,
                     unread = excluded.unread",
                params![mailbox, thread, last_date, messages, unread],
            )?;
        }
    }
    Ok(())
}

/// Whether a read failed because the bytes are gone or damaged, which trying
/// again will not change. A file system that refuses for the moment is not
/// this: the caller stops and tries later.
fn unreadable(error: &StoreError) -> bool {
    matches!(
        error,
        StoreError::NotFound(_)
            | StoreError::Log(LogError::NotHeld(_) | LogError::Corrupt(_) | LogError::TooLong(_))
    )
}

impl Store {
    /// Opens the search index if it is not open, and gives it the documents
    /// a stop left it without. Called before a transaction that will ask for
    /// new documents, so that those are never mistaken for ones a stop lost.
    ///
    /// # Errors
    /// [`StoreError::IndexStale`] when the index is older than the tables.
    pub(super) fn ensure_index(&mut self) -> Result<(), StoreError> {
        if self.index.is_some() {
            return Ok(());
        }
        let index = Index::open(&self.index_directory)?;
        let committed = i64::try_from(index.committed()?).unwrap_or(i64::MAX);
        let recorded = state(&self.connection, INDEX_COMMITTED)?.unwrap_or(0);
        if committed < recorded {
            return Err(StoreError::IndexStale);
        }
        self.connection
            .execute("DELETE FROM index_pending WHERE seq <= ?1", [committed])?;
        set_state(&self.connection, INDEX_COMMITTED, committed)?;
        // The index is flushed harder than the database. After a power
        // failure, or a database restored from an older copy, the index can
        // be ahead; a note numbered at or under what it holds would be
        // removed as if its document were there. So notes start above it.
        self.connection.execute(
            "INSERT INTO sqlite_sequence (name, seq)
             SELECT 'index_pending', ?1
             WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'index_pending')",
            [committed],
        )?;
        self.connection.execute(
            "UPDATE sqlite_sequence SET seq = max(seq, ?1) WHERE name = 'index_pending'",
            [committed],
        )?;
        self.index = Some(index);

        // What is still pending was asked for and never reached the disk.
        let pending: Vec<(i64, i64)> = {
            let mut statement = self.connection.prepare(
                "SELECT max(seq), message_id FROM index_pending GROUP BY message_id ORDER BY 1",
            )?;
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect::<Result<_, _>>()?
        };
        let mut documents = Vec::with_capacity(pending.len());
        for (seq, message) in pending {
            if let Some(mut document) = self.document_of(message)? {
                document.seq = count(seq);
                documents.push(document);
            }
        }
        self.index_documents(&documents)?;
        self.commit_index()
    }

    /// The document of a message, made again from its row and its bytes.
    fn document_of(&self, message: i64) -> Result<Option<Document>, StoreError> {
        let row: Option<(i64, String, String)> = self
            .connection
            .query_row(
                "SELECT date, sender_address, subject FROM envelope WHERE message_id = ?1",
                [message],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let Some((date, sender, subject)) = row else {
            return Ok(None);
        };
        // A body that is not held, or is damaged, leaves the subject
        // searchable. A file system that refuses for the moment does not: the
        // note stays, and the document is made when it can be read.
        let text = match self.read_part(MessageId(message), "whole") {
            Ok(whole) => derive::body_fields(&whole).text,
            Err(error) if unreadable(&error) => String::new(),
            Err(error) => return Err(error),
        };
        Ok(Some(Document {
            seq: 0,
            message,
            date,
            sender,
            subject,
            text,
        }))
    }

    /// Hands documents to the index, after the transaction that asked for
    /// them has committed.
    pub(super) fn index_documents(&mut self, documents: &[Document]) -> Result<(), StoreError> {
        if documents.is_empty() {
            return Ok(());
        }
        let Some(index) = self.index.as_mut() else {
            // `ensure_index` runs before every transaction that derives.
            return Err(StoreError::IndexStale);
        };
        for document in documents {
            if let Err(error) = index.replace(document) {
                return Err(self.index_failed(error));
            }
        }
        if index.uncommitted() >= COMMIT_EVERY {
            self.commit_index()?;
        }
        Ok(())
    }

    /// Closes the index after it refused. What it had not committed is
    /// still in `index_pending`, so the next use opens it again and gives it
    /// those documents; nothing is marked as indexed that is not.
    fn index_failed(&mut self, error: crate::index::IndexError) -> StoreError {
        self.index = None;
        StoreError::Index(error)
    }

    /// Writes the index's waiting documents to the disk, which also makes
    /// them searchable.
    ///
    /// # Errors
    /// When the index or the database refuses.
    pub fn commit_index(&mut self) -> Result<(), StoreError> {
        let Some(index) = self.index.as_mut() else {
            return Ok(());
        };
        match index.commit() {
            Ok(Some(highest)) => {
                let highest = i64::try_from(highest).unwrap_or(i64::MAX);
                self.connection
                    .execute("DELETE FROM index_pending WHERE seq <= ?1", [highest])?;
                set_state(&self.connection, INDEX_COMMITTED, highest)
            }
            Ok(None) => Ok(()),
            Err(error) => Err(self.index_failed(error)),
        }
    }

    /// Waits for the index to finish merging its files, and folds SQLite's
    /// write-ahead log into the database, so that the data directory is the
    /// size it settles at. For a clean stop and for measuring.
    ///
    /// # Errors
    /// When the index or the database refuses.
    pub fn settle_files(&mut self) -> Result<(), StoreError> {
        self.commit_index()?;
        if let Some(index) = self.index.as_mut() {
            index.settle()?;
        }
        self.connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        Ok(())
    }

    /// The threads a mailbox shows, newest first: at most `limit`, starting
    /// after `before` (the `last_date` and thread of the last row of the page
    /// before), or from the newest.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn list_threads(
        &self,
        mailbox: MailboxId,
        before: Option<(i64, ThreadId)>,
        limit: u32,
    ) -> Result<Vec<ThreadListed>, StoreError> {
        let (date, thread) = before.map_or((i64::MAX, i64::MAX), |(date, thread)| (date, thread.0));
        let mut statement = self.connection.prepare_cached(
            "SELECT thread_place.thread_id, thread_place.last_date, thread_place.messages,
                    thread.messages, thread.attachments, thread.subject, thread.snippet,
                    thread.last_sender, thread_place.unread
             FROM thread_place JOIN thread ON thread.id = thread_place.thread_id
             WHERE thread_place.mailbox_id = ?1
               AND (thread_place.last_date, thread_place.thread_id) < (?2, ?3)
             ORDER BY thread_place.last_date DESC, thread_place.thread_id DESC
             LIMIT ?4",
        )?;
        let rows = statement.query_map(params![mailbox.0, date, thread, limit], |row| {
            Ok(ThreadListed {
                thread: ThreadId(row.get(0)?),
                last_date: row.get(1)?,
                shown: count(row.get(2)?),
                messages: count(row.get(3)?),
                attachments: count(row.get(4)?),
                subject: row.get(5)?,
                snippet: row.get(6)?,
                last_sender: row.get(7)?,
                unread: count(row.get(8)?),
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// The messages that best match `query`, best first, each with its
    /// thread: at most `limit`, and never more than 1 000. Everything
    /// recorded so far is searched.
    ///
    /// # Errors
    /// [`StoreError::IndexStale`] when the index is older than the tables.
    pub fn search(&mut self, query: &str, limit: u32) -> Result<Vec<Found>, StoreError> {
        self.ensure_index()?;
        self.commit_index()?;
        let Some(index) = self.index.as_ref() else {
            return Err(StoreError::IndexStale);
        };
        let messages = index.search(query, limit.min(SEARCH_LIMIT) as usize)?;
        let mut statement = self.connection.prepare_cached(
            "SELECT envelope.thread_id, envelope.date, thread.subject, envelope.snippet,
                    CASE WHEN envelope.sender_name = '' THEN envelope.sender_address
                         ELSE envelope.sender_name END
             FROM envelope JOIN thread ON thread.id = envelope.thread_id
             WHERE envelope.message_id = ?1",
        )?;
        let mut found = Vec::with_capacity(messages.len());
        for message in messages {
            let row = statement
                .query_row([message], |row| {
                    Ok(Found {
                        message: MessageId(message),
                        thread: ThreadId(row.get(0)?),
                        date: row.get(1)?,
                        subject: row.get(2)?,
                        snippet: row.get(3)?,
                        sender: row.get(4)?,
                    })
                })
                .optional()?;
            // A document whose row is gone belongs to a rebuild under way.
            found.extend(row);
        }
        Ok(found)
    }

    /// Reads a message back from the log and parses it: the whole message
    /// when it is held, else its headers.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] when not even the headers are held.
    pub fn open_message(&self, message: MessageId) -> Result<Opened, StoreError> {
        let header = derive::header_fields(&self.read_part(message, "header")?);
        let body = match self.read_part(message, "whole") {
            Ok(whole) => Some(derive::body_fields(&whole)),
            Err(StoreError::NotFound(_)) => None,
            Err(other) => return Err(other),
        };
        Ok(Opened { header, body })
    }

    /// How many threads there are.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn thread_count(&self) -> Result<u64, StoreError> {
        let threads: i64 = self
            .connection
            .query_row("SELECT count(*) FROM thread", [], |row| row.get(0))?;
        Ok(count(threads))
    }

    /// Whether a rebuild was started and has not finished.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn rebuilding(&self) -> Result<bool, StoreError> {
        Ok(rebuild_cursor(&self.connection)?.is_some())
    }

    /// Recomputes every derived table and the index from the log and the
    /// tables that are not derived (the specification's section 4.3), calling
    /// `progress` after each batch. A rebuild that was stopped is carried on
    /// from where it stopped.
    ///
    /// # Errors
    /// When the database, the index or the log's directory refuses. A
    /// message whose bytes cannot be read back is given an empty row that
    /// says so; it does not stop the rebuild.
    pub fn rebuild(
        &mut self,
        now: i64,
        mut progress: impl FnMut(RebuildProgress),
    ) -> Result<RebuildProgress, StoreError> {
        if !self.rebuilding()? {
            self.rebuild_begin()?;
        }
        loop {
            let step = self.rebuild_step(now)?;
            progress(step);
            if step.finished {
                return Ok(step);
            }
        }
    }

    /// Throws away everything derived and marks a rebuild as under way.
    ///
    /// # Errors
    /// When the index's directory cannot be removed or the database refuses.
    pub fn rebuild_begin(&mut self) -> Result<(), StoreError> {
        // The index first. A stop after this leaves an index older than the
        // tables, which is reported, and never tables that claim documents
        // the index lacks.
        if let Some(index) = self.index.take() {
            index.close()?;
        }
        Index::remove(&self.index_directory)?;
        let transaction = self.connection.transaction()?;
        transaction.execute_batch(
            "DELETE FROM part;
             DELETE FROM thread_place;
             DELETE FROM thread;
             DELETE FROM thread_key;
             DELETE FROM envelope;
             DELETE FROM index_pending;",
        )?;
        set_state(&transaction, REBUILD, 0)?;
        set_state(&transaction, INDEX_COMMITTED, 0)?;
        transaction.commit()?;
        Ok(())
    }

    /// What a message's bytes in the log say: its headers, and its body when
    /// it is held whole. Bytes that are gone or damaged give fields that say
    /// so; a file system that refuses for the moment is an error.
    fn read_derivation(
        &self,
        message: i64,
    ) -> Result<(HeaderFields, Option<BodyFields>), StoreError> {
        let header = match self.read_part(MessageId(message), "header") {
            Ok(block) => derive::header_fields(&block),
            Err(error) if unreadable(&error) => HeaderFields {
                unparsed: Some("the headers could not be read from the log"),
                ..HeaderFields::default()
            },
            Err(error) => return Err(error),
        };
        let body = match self.read_part(MessageId(message), "whole") {
            Ok(whole) => Some(derive::body_fields(&whole)),
            Err(StoreError::NotFound(_)) => None,
            Err(error) if unreadable(&error) => Some(BodyFields {
                unparsed: Some("the body could not be read from the log"),
                ..BodyFields::default()
            }),
            Err(error) => return Err(error),
        };
        Ok((header, body))
    }

    /// Derives a message again from its bytes, as a rebuild would: after a
    /// damaged file is repaired, what was derived while it could not be read
    /// is replaced. A message a rebuild under way has not reached is left to
    /// it.
    ///
    /// # Errors
    /// When the log, the database or the index refuses.
    pub(super) fn rederive(&mut self, message: i64, now: i64) -> Result<(), StoreError> {
        let (header, body) = self.read_derivation(message)?;
        self.ensure_index()?;
        let transaction = self.connection.transaction()?;
        let mut touched = Touched::new(rebuild_cursor(&transaction)?);
        if touched.awaits_rebuild(message) {
            return Ok(());
        }
        derive_header(&transaction, message, &header, &mut touched)?;
        if let Some(body) = body {
            derive_body(&transaction, message, body, &mut touched)?;
        }
        settle(&transaction, &touched, now)?;
        transaction.commit()?;
        self.index_documents(&touched.documents)?;
        Ok(())
    }

    /// Derives the next batch of a rebuild under way.
    ///
    /// # Errors
    /// When the database or the index refuses.
    pub fn rebuild_step(&mut self, now: i64) -> Result<RebuildProgress, StoreError> {
        let total: i64 =
            self.connection
                .query_row("SELECT coalesce(max(id), 0) FROM message", [], |row| {
                    row.get(0)
                })?;
        let Some(cursor) = rebuild_cursor(&self.connection)? else {
            return Ok(RebuildProgress {
                done: count(total),
                total: count(total),
                finished: true,
            });
        };
        self.ensure_index()?;
        let messages: Vec<i64> = {
            let mut statement = self
                .connection
                .prepare_cached("SELECT id FROM message WHERE id > ?1 ORDER BY id LIMIT ?2")?;
            statement
                .query_map(params![cursor, REBUILD_BATCH], |row| row.get(0))?
                .collect::<Result<_, _>>()?
        };
        let Some(last) = messages.last().copied() else {
            self.commit_index()?;
            let transaction = self.connection.transaction()?;
            transaction.execute("DELETE FROM engine_state WHERE key = ?1", [REBUILD])?;
            note_change(&transaction, now, "rebuilt", 0)?;
            transaction.commit()?;
            return Ok(RebuildProgress {
                done: count(total),
                total: count(total),
                finished: true,
            });
        };

        // The bytes are read and parsed before the transaction opens.
        let mut derived = Vec::with_capacity(messages.len());
        for message in &messages {
            let (header, body) = self.read_derivation(*message)?;
            derived.push((*message, header, body));
        }

        let transaction = self.connection.transaction()?;
        // Nothing awaits this rebuild inside its own batch.
        let mut touched = Touched::new(None);
        for (message, header, body) in derived {
            derive_header(&transaction, message, &header, &mut touched)?;
            if let Some(body) = body {
                derive_body(&transaction, message, body, &mut touched)?;
            }
        }
        settle(&transaction, &touched, now)?;
        set_state(&transaction, REBUILD, last)?;
        transaction.commit()?;
        self.index_documents(&touched.documents)?;
        Ok(RebuildProgress {
            done: count(last),
            total: count(total),
            finished: false,
        })
    }
}
