//! Drafts, outbound sends and snoozed threads (the specification's 9.5 and
//! section 11). None is derived: all survive a rebuild.
//!
//! A draft is the engine's own record: its account, the message it answers,
//! its recipients, subject and body, and who wrote each part. Its revision
//! rises with every change to it, a discard and a restore included, so that
//! what a person previews before a send is what the send names. A discarded
//! draft is held for 30 days and can be restored (M29); after that it goes.
//!
//! A send is recorded in `outbound` before it is attempted and updated after.
//! A send whose connection ends after handover stays `unknown` and is never
//! retried; `mail-status` reports it so the person decides.
//!
//! A thread is snoozed by its lowest message, which is its id and which a
//! rebuild keeps as its id. Mail that arrives in the thread after it was
//! snoozed ends the snooze, as it does in most mail programs: a message
//! whose id is above the highest id when the snooze was set, which tells
//! apart two events in one millisecond. A pass of sync removes a snooze so
//! ended, so that the reply's leaving later does not bring it back.

use std::collections::{HashMap, HashSet, VecDeque};

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

use super::senders::own_addresses;
use super::{AccountId, AccountRow, MailboxRow, MessageId, Role, Store, StoreError};
use crate::log::{BlobId, Log};
use crate::provider::smtp::clean_message_id;
use crate::store::Proposer;

/// Normalizes an address's domain to ASCII lowercase while preserving the
/// local-part's exact case (RFC 5321).
#[must_use]
pub fn normalize_domain(address: &str) -> String {
    match address.split_once('@') {
        Some((local, domain)) => format!("{local}@{}", domain.to_ascii_lowercase()),
        None => address.to_string(),
    }
}

/// How long a discarded draft is held before it goes: 30 days (M29).
pub const DISCARD_LIFETIME: i64 = 30 * 24 * 60 * 60 * 1000;

/// Where a draft stands with respect to sending.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum SendState {
    /// Not sent yet.
    #[default]
    None,
    /// Currently being handed to the provider.
    Sending,
    /// Accepted by the provider.
    Sent,
    /// Handed over and the outcome was lost; never retried.
    Unknown,
}

impl SendState {
    /// As stored in SQLite.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Sending => "sending",
            Self::Sent => "sent",
            Self::Unknown => "unknown",
        }
    }

    fn parse(text: &str) -> Self {
        match text {
            "sending" => Self::Sending,
            "sent" => Self::Sent,
            "unknown" => Self::Unknown,
            _ => Self::None,
        }
    }
}

/// Why a recipient on a draft is allowed or requires confirmation (the
/// specification's 9.5 and step F's 8.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecipientBasis {
    /// One of the person's own addresses.
    Own,
    /// A participant of the thread being answered.
    Thread,
    /// An address the person has written to before.
    WrittenTo,
    /// None of the above: must be typed at the terminal for this send.
    New,
}

impl RecipientBasis {
    /// As returned in JSON results.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Own => "own",
            Self::Thread => "thread",
            Self::WrittenTo => "written-to",
            Self::New => "new",
        }
    }
}

/// The basis of each recipient on a draft, parallel to `to`, `cc` and `bcc`,
/// plus whether the answered message's `Reply-To` differs from its sender.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RecipientBases {
    /// Basis for each `to` recipient.
    pub to: Vec<RecipientBasis>,
    /// Basis for each `cc` recipient.
    pub cc: Vec<RecipientBasis>,
    /// Basis for each `bcc` recipient.
    pub bcc: Vec<RecipientBasis>,
    /// Whether the message the draft answers has a `Reply-To` that differs
    /// from its sender (flagged in the preview; never silently trusted).
    pub reply_to_differs: bool,
}

/// A draft's recipients, each list of addresses in the order given.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Recipients {
    /// To.
    pub to: Vec<String>,
    /// Cc.
    pub cc: Vec<String>,
    /// Bcc.
    pub bcc: Vec<String>,
}

impl Recipients {
    /// How many there are in all.
    #[must_use]
    pub fn count(&self) -> usize {
        self.to.len() + self.cc.len() + self.bcc.len()
    }

    /// Every recipient address across `to`, `cc` and `bcc`, deduplicated by
    /// exact local-part and case-insensitive domain in order.
    #[must_use]
    pub fn envelope_all(&self) -> Vec<String> {
        let mut seen = HashSet::new();
        let mut all = Vec::with_capacity(self.count());
        for address in self.to.iter().chain(&self.cc).chain(&self.bcc) {
            if seen.insert(normalize_domain(address)) {
                all.push(address.clone());
            }
        }
        all
    }
}

/// Who wrote each part of a draft.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Authors {
    /// Who wrote the recipients.
    pub recipients: Proposer,
    /// Who wrote the subject.
    pub subject: Proposer,
    /// Who wrote the body.
    pub body: Proposer,
}

/// A draft as the store keeps it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftRow {
    /// Its id.
    pub id: i64,
    /// The account it is sent from.
    pub account: AccountId,
    /// The message it answers.
    pub answers: Option<i64>,
    /// Its recipients.
    pub recipients: Recipients,
    /// Its subject.
    pub subject: String,
    /// Its body, as plain text.
    pub body: String,
    /// Who wrote each part.
    pub authors: Authors,
    /// Its revision, which every change raises.
    pub revision: i64,
    /// Who made it.
    pub creator: Proposer,
    /// When it was made, in milliseconds.
    pub created_at: i64,
    /// When it last changed.
    pub updated_at: i64,
    /// When it was discarded, if it was.
    pub discarded_at: Option<i64>,
    /// Its sending state.
    pub send_state: SendState,
}

impl DraftRow {
    /// Its human-readable state: `open`, `discarded`, `sending`, `sent` or
    /// `unknown`.
    #[must_use]
    pub fn state(&self) -> &'static str {
        if self.discarded_at.is_some() {
            return "discarded";
        }
        match self.send_state {
            SendState::None => "open",
            SendState::Sending => "sending",
            SendState::Sent => "sent",
            SendState::Unknown => "unknown",
        }
    }
}

/// A draft to make.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewDraft {
    /// The account it is sent from.
    pub account: AccountId,
    /// The message it answers.
    pub answers: Option<i64>,
    /// Its recipients.
    pub recipients: Recipients,
    /// Its subject.
    pub subject: String,
    /// Its body.
    pub body: String,
}

/// The parts of a draft a change sets; a part left `None` stays.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DraftChange {
    /// New recipients, all three lists.
    pub recipients: Option<Recipients>,
    /// A new subject.
    pub subject: Option<String>,
    /// A new body.
    pub body: Option<String>,
}

/// Why a change to a draft was not made.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DraftRefusal {
    /// No draft has that id, or a discarded one went after its 30 days.
    NotFound,
    /// Its revision is not the one named: it changed since it was read.
    Changed {
        /// Its revision now.
        revision: i64,
    },
    /// It is discarded, and is restored before it is changed.
    Discarded,
    /// It is not discarded, so there is nothing to restore.
    NotDiscarded,
    /// It is currently being sent.
    Sending,
    /// It has already been sent.
    Sent,
    /// Its previous send had an unknown outcome.
    Unknown,
}

/// Why a draft send was refused before anything reached the provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendRefusal {
    /// No draft has that id.
    NotFound,
    /// The draft is discarded.
    Discarded,
    /// The draft is currently being sent.
    Sending,
    /// The draft has already been sent.
    Sent,
    /// A previous send of this draft had an unknown outcome and is never retried.
    Unknown,
    /// The draft's revision changed since its preview was read (`PREVIEW_CHANGED`).
    Changed {
        /// Its revision now.
        revision: i64,
    },
    /// The draft has no recipients.
    NoRecipients,
    /// One or more recipients are not allowed by the recipient rule.
    RecipientNotAllowed {
        /// How many recipients are not allowed.
        count: usize,
    },
    /// The account no longer exists.
    AccountNotFound,
}

/// State of an outbound send record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutboundState {
    /// In flight.
    Sending,
    /// Accepted by the provider.
    Sent,
    /// Definitely not sent.
    Failed,
    /// Connection dropped after handover; never retried.
    Unknown,
}

impl OutboundState {
    /// As stored in SQLite and shown in JSON.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sending => "sending",
            Self::Sent => "sent",
            Self::Failed => "failed",
            Self::Unknown => "unknown",
        }
    }

    fn parse(text: &str) -> Self {
        match text {
            "sending" => Self::Sending,
            "sent" => Self::Sent,
            "failed" => Self::Failed,
            _ => Self::Unknown,
        }
    }
}

/// One row of `outbound`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboundRow {
    /// Its id.
    pub id: i64,
    /// The account that sent it.
    pub account: AccountId,
    /// The draft it came from, if any.
    pub draft: Option<i64>,
    /// The draft revision approved for this attempt, if any.
    pub draft_revision: Option<i64>,
    /// `draft`, `replyset` or `unsubscribe`.
    pub kind: String,
    /// The generated RFC 5322 Message-ID, without angle brackets.
    pub message_id: String,
    /// How many recipients it targeted.
    pub recipients: u64,
    /// Current state.
    pub state: OutboundState,
    /// Whether a copy was appended to the sent mailbox.
    pub sent_copy: bool,
    /// Who ran the send.
    pub sender: Proposer,
    /// When the send started.
    pub started_at: i64,
    /// When the send ended, if it has.
    pub finished_at: Option<i64>,
    /// Engine's own words when failed or unknown.
    pub error: Option<String>,
}

fn proposer_json(proposer: &Proposer) -> Value {
    json!({ "kind": proposer.kind, "id": proposer.id })
}

fn proposer_from(value: &Value) -> Proposer {
    Proposer {
        kind: value["kind"].as_str().unwrap_or("unknown").to_string(),
        id: value["id"].as_str().map(ToString::to_string),
    }
}

fn authors_json(authors: &Authors) -> String {
    json!({
        "recipients": proposer_json(&authors.recipients),
        "subject": proposer_json(&authors.subject),
        "body": proposer_json(&authors.body),
    })
    .to_string()
}

fn addresses(text: &str) -> Vec<String> {
    serde_json::from_str(text).unwrap_or_default()
}

const DRAFT_COLUMNS: &str = "id, account_id, answers_message_id, to_addresses, cc_addresses,
    bcc_addresses, subject, body, authors, revision, creator_kind, creator_id, created_at,
    updated_at, discarded_at, send_state";

fn draft_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DraftRow> {
    let authors: Value = serde_json::from_str(&row.get::<_, String>(8)?).unwrap_or(Value::Null);
    let send_state: String = row.get(15)?;
    Ok(DraftRow {
        id: row.get(0)?,
        account: AccountId(row.get(1)?),
        answers: row.get(2)?,
        recipients: Recipients {
            to: addresses(&row.get::<_, String>(3)?),
            cc: addresses(&row.get::<_, String>(4)?),
            bcc: addresses(&row.get::<_, String>(5)?),
        },
        subject: row.get(6)?,
        body: row.get(7)?,
        authors: Authors {
            recipients: proposer_from(&authors["recipients"]),
            subject: proposer_from(&authors["subject"]),
            body: proposer_from(&authors["body"]),
        },
        revision: row.get(9)?,
        creator: Proposer {
            kind: row.get(10)?,
            id: row.get(11)?,
        },
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        discarded_at: row.get(14)?,
        send_state: SendState::parse(&send_state),
    })
}

fn outbound_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<OutboundRow> {
    let recipients: i64 = row.get(6)?;
    let state: String = row.get(7)?;
    let sent_copy: i64 = row.get(8)?;
    Ok(OutboundRow {
        id: row.get(0)?,
        account: AccountId(row.get(1)?),
        draft: row.get(2)?,
        draft_revision: row.get(3)?,
        kind: row.get(4)?,
        message_id: row.get(5)?,
        recipients: u64::try_from(recipients).unwrap_or(0),
        state: OutboundState::parse(&state),
        sent_copy: sent_copy != 0,
        sender: Proposer {
            kind: row.get(9)?,
            id: row.get(10)?,
        },
        started_at: row.get(11)?,
        finished_at: row.get(12)?,
        error: row.get(13)?,
    })
}

/// Computes the recipient basis for every recipient of `draft` on `connection`.
fn compute_recipient_bases(
    connection: &Connection,
    log: &Log,
    draft: &DraftRow,
) -> Result<RecipientBases, StoreError> {
    let own = own_addresses(connection)?;
    let (thread_participants, reply_to_differs) = match draft.answers {
        Some(message_id) => thread_participants_for(connection, log, draft.account, message_id)?,
        None => (HashSet::new(), false),
    };
    let mut written_stmt =
        connection.prepare_cached("SELECT written > 0 FROM sender WHERE address = ?1")?;
    let mut classify = |list: &[String]| -> Result<Vec<RecipientBasis>, StoreError> {
        let mut bases = Vec::with_capacity(list.len());
        for addr in list {
            let lower = addr.to_lowercase();
            let basis = if own.contains(&lower) {
                RecipientBasis::Own
            } else if thread_participants.contains(&lower) {
                RecipientBasis::Thread
            } else {
                let written: bool = written_stmt
                    .query_row([&lower], |row| row.get(0))
                    .optional()?
                    .unwrap_or(false);
                if written {
                    RecipientBasis::WrittenTo
                } else {
                    RecipientBasis::New
                }
            };
            bases.push(basis);
        }
        Ok(bases)
    };
    Ok(RecipientBases {
        to: classify(&draft.recipients.to)?,
        cc: classify(&draft.recipients.cc)?,
        bcc: classify(&draft.recipients.bcc)?,
        reply_to_differs,
    })
}

/// Maximum number of visible messages in a thread walked for `thread`
/// recipient authorization; larger threads fall back to the answered message
/// alone so work stays bounded and fail-closed.
const MAX_THREAD_WALK: usize = 500;
/// Maximum header block size read when checking thread links (1 MiB, §6.4).
const HEADER_READ_LIMIT: u64 = 1024 * 1024;

/// Every participant address in the thread of `message_id` (`From`,
/// `Resent-From`, and `To`/`Cc`/`Bcc` of messages reachable from `message_id`
/// solely through messages currently shown in `account` outside junk and
/// trash — never `Reply-To`, which is flagged separately when it differs).
///
/// If `message_id` itself is shown only in junk or trash, no address receives
/// `thread` eligibility. Walking links only across non-junk/trash messages
/// also prevents a spam message carrying forged `References` from bridging
/// two unrelated threads into one eligible set.
fn thread_participants_for(
    connection: &Connection,
    log: &Log,
    account: AccountId,
    message_id: i64,
) -> Result<(HashSet<String>, bool), StoreError> {
    let answered: Option<(i64, i64)> = connection
        .query_row(
            "SELECT thread_id, reply_to_differs FROM envelope WHERE message_id = ?1",
            [message_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((thread_id, reply_to_differs)) = answered else {
        return Ok((HashSet::new(), false));
    };
    let answered_visible: bool = connection.query_row(
        "SELECT EXISTS (
                 SELECT 1 FROM observation
                 JOIN mailbox ON mailbox.id = observation.mailbox_id
                 WHERE observation.message_id = ?1
                   AND observation.ended_at IS NULL
                   AND mailbox.account_id = ?2
                   AND mailbox.role NOT IN ('junk', 'trash')
             )",
        params![message_id, account.0],
        |row| row.get(0),
    )?;
    if !answered_visible {
        return Ok((HashSet::new(), reply_to_differs != 0));
    }
    let mut visible_stmt = connection.prepare_cached(
        "SELECT envelope.message_id FROM envelope
         WHERE envelope.thread_id = ?1
           AND EXISTS (
               SELECT 1 FROM observation
               JOIN mailbox ON mailbox.id = observation.mailbox_id
               WHERE observation.message_id = envelope.message_id
                 AND observation.ended_at IS NULL
                 AND mailbox.account_id = ?2
                 AND mailbox.role NOT IN ('junk', 'trash')
           )
         LIMIT ?3",
    )?;
    let candidates: Vec<i64> = visible_stmt
        .query_map(
            params![thread_id, account.0, (MAX_THREAD_WALK + 1) as i64],
            |row| row.get(0),
        )?
        .collect::<Result<_, _>>()?;

    let connected: Vec<i64> = if candidates.len() <= 1 || candidates.len() > MAX_THREAD_WALK {
        vec![message_id]
    } else {
        connected_visible_messages(connection, log, &candidates, message_id)?
    };

    let mut env_stmt = connection
        .prepare_cached("SELECT sender_address, resent_from FROM envelope WHERE message_id = ?1")?;
    let mut rcpt_stmt =
        connection.prepare_cached("SELECT address FROM recipient WHERE message_id = ?1")?;
    let mut participants = HashSet::new();
    for id in connected {
        if let Some((sender, resent)) = env_stmt
            .query_row([id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .optional()?
        {
            if !sender.is_empty() {
                participants.insert(sender.to_lowercase());
            }
            if !resent.is_empty() {
                participants.insert(resent.to_lowercase());
            }
        }
        let rows = rcpt_stmt.query_map([id], |row| row.get::<_, String>(0))?;
        for address in rows {
            participants.insert(address?.to_lowercase());
        }
    }
    Ok((participants, reply_to_differs != 0))
}

/// Computes the connected component of `candidates` reachable from `start`
/// through `Message-ID`, `In-Reply-To` and `References` headers of the
/// `candidates` themselves (excluding any junk/trash bridge messages).
fn connected_visible_messages(
    connection: &Connection,
    log: &Log,
    candidates: &[i64],
    start: i64,
) -> Result<Vec<i64>, StoreError> {
    let mut blob_stmt = connection
        .prepare_cached("SELECT blob FROM held WHERE message_id = ?1 AND part = 'header'")?;
    let mut keys_of: HashMap<i64, Vec<String>> = HashMap::with_capacity(candidates.len());
    let mut by_key: HashMap<String, Vec<i64>> = HashMap::new();
    for &id in candidates {
        let Some(blob) = blob_stmt
            .query_row([id], |row| row.get::<_, Vec<u8>>(0))
            .optional()?
        else {
            continue;
        };
        let Some(blob_id) = BlobId::from_bytes(&blob) else {
            continue;
        };
        let Ok(raw) = log.get(blob_id, HEADER_READ_LIMIT) else {
            continue;
        };
        let Some(parsed) = mail_parser::MessageParser::new().parse_headers(&raw) else {
            continue;
        };
        let mut keys = Vec::new();
        if let Some(mid) = parsed.message_id().and_then(clean_message_id) {
            keys.push(mid);
        }
        if let Some(list) = parsed.in_reply_to() {
            for item in list.iter().take(200) {
                if let Some(mid) = clean_message_id(item) {
                    keys.push(mid);
                }
            }
        }
        if let Some(list) = parsed.references() {
            let skip = list.len().saturating_sub(200);
            for item in list.iter().skip(skip) {
                if let Some(mid) = clean_message_id(item) {
                    keys.push(mid);
                }
            }
        }
        for key in &keys {
            by_key.entry(key.clone()).or_default().push(id);
        }
        keys_of.insert(id, keys);
    }

    let mut visited: HashSet<i64> = HashSet::new();
    let mut queue: VecDeque<i64> = VecDeque::new();
    visited.insert(start);
    queue.push_back(start);
    while let Some(current) = queue.pop_front() {
        if let Some(keys) = keys_of.get(&current) {
            for key in keys {
                if let Some(neighbors) = by_key.get(key) {
                    for &neighbor in neighbors {
                        if visited.insert(neighbor) {
                            queue.push_back(neighbor);
                        }
                    }
                }
            }
        }
    }
    Ok(visited.into_iter().collect())
}

/// Threading headers read from the message a draft answers.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReplyHeaders {
    /// The answered message's `Message-ID` (without angle brackets).
    pub in_reply_to: Option<String>,
    /// The `References` chain (without angle brackets, capped at 20 ids).
    pub references: Vec<String>,
}

impl Store {
    /// Moves any outbound send left in `sending` from a process that ended
    /// unexpectedly to `unknown`, and its draft with it, so it is never
    /// retried (the specification's 9.5).
    pub(super) fn mark_interrupted_outbound(
        connection: &Connection,
        now: i64,
    ) -> Result<(), StoreError> {
        let why = "the engine stopped while sending; whether the message went is not known";
        connection.execute(
            "UPDATE draft SET send_state = 'unknown', revision = revision + 1, updated_at = ?1
             WHERE send_state = 'sending'",
            [now],
        )?;
        connection.execute(
            "UPDATE outbound SET state = 'unknown', finished_at = ?1, error = ?2
             WHERE state = 'sending'",
            params![now, why],
        )?;
        Ok(())
    }

    /// Removes the drafts discarded more than 30 days before `now`. Called
    /// whenever a command reads or changes drafts.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn purge_drafts(&self, now: i64) -> Result<u64, StoreError> {
        let removed = self.connection.execute(
            "DELETE FROM draft WHERE discarded_at IS NOT NULL AND discarded_at <= ?1",
            [now - DISCARD_LIFETIME],
        )?;
        Ok(removed as u64)
    }

    /// Makes a draft written wholly by `creator`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn create_draft(
        &self,
        draft: &NewDraft,
        creator: &Proposer,
        now: i64,
    ) -> Result<DraftRow, StoreError> {
        let authors = Authors {
            recipients: creator.clone(),
            subject: creator.clone(),
            body: creator.clone(),
        };
        self.connection.execute(
            "INSERT INTO draft (account_id, answers_message_id, to_addresses, cc_addresses,
                 bcc_addresses, subject, body, authors, revision, creator_kind, creator_id,
                 created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10, ?11, ?11)",
            params![
                draft.account.0,
                draft.answers,
                json!(draft.recipients.to).to_string(),
                json!(draft.recipients.cc).to_string(),
                json!(draft.recipients.bcc).to_string(),
                draft.subject,
                draft.body,
                authors_json(&authors),
                creator.kind,
                creator.id,
                now,
            ],
        )?;
        let id = self.connection.last_insert_rowid();
        self.draft(id)?.ok_or(StoreError::NotFound("draft"))
    }

    /// Draft `id`, in any state.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn draft(&self, id: i64) -> Result<Option<DraftRow>, StoreError> {
        Ok(self
            .connection
            .query_row(
                &format!("SELECT {DRAFT_COLUMNS} FROM draft WHERE id = ?1"),
                [id],
                draft_row,
            )
            .optional()?)
    }

    /// The drafts: active unsent ones (`discarded = false`), or discarded ones
    /// (`discarded = true`), the most recently changed first, after `before`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn drafts(
        &self,
        discarded: bool,
        before: Option<(i64, i64)>,
        limit: u32,
    ) -> Result<Vec<DraftRow>, StoreError> {
        let (date, id) = before.unwrap_or((i64::MAX, i64::MAX));
        let sql = if discarded {
            format!(
                "SELECT {DRAFT_COLUMNS} FROM draft
                 WHERE discarded_at IS NOT NULL AND (updated_at, id) < (?1, ?2)
                 ORDER BY updated_at DESC, id DESC LIMIT ?3"
            )
        } else {
            format!(
                "SELECT {DRAFT_COLUMNS} FROM draft
                 WHERE discarded_at IS NULL AND send_state = 'none'
                   AND (updated_at, id) < (?1, ?2)
                 ORDER BY updated_at DESC, id DESC LIMIT ?3"
            )
        };
        let mut statement = self.connection.prepare_cached(&sql)?;
        let rows = statement.query_map(params![date, id, limit], draft_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Changes the parts of draft `id` that `change` sets, if its revision
    /// is still `revision`: each part set is then `author`'s, and the
    /// revision rises by one.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn update_draft(
        &self,
        id: i64,
        revision: i64,
        change: &DraftChange,
        author: &Proposer,
        now: i64,
    ) -> Result<Result<DraftRow, DraftRefusal>, StoreError> {
        let Some(mut row) = self.draft(id)? else {
            return Ok(Err(DraftRefusal::NotFound));
        };
        if row.discarded_at.is_some() {
            return Ok(Err(DraftRefusal::Discarded));
        }
        match row.send_state {
            SendState::Sending => return Ok(Err(DraftRefusal::Sending)),
            SendState::Sent => return Ok(Err(DraftRefusal::Sent)),
            SendState::Unknown => return Ok(Err(DraftRefusal::Unknown)),
            SendState::None => {}
        }
        if row.revision != revision {
            return Ok(Err(DraftRefusal::Changed {
                revision: row.revision,
            }));
        }
        if let Some(recipients) = &change.recipients {
            row.recipients = recipients.clone();
            row.authors.recipients = author.clone();
        }
        if let Some(subject) = &change.subject {
            row.subject.clone_from(subject);
            row.authors.subject = author.clone();
        }
        if let Some(body) = &change.body {
            row.body.clone_from(body);
            row.authors.body = author.clone();
        }
        // The revision and state are checked again in the statement, so two
        // callers that read the same revision cannot both change it.
        let changed = self.connection.execute(
            "UPDATE draft SET to_addresses = ?3, cc_addresses = ?4, bcc_addresses = ?5,
                 subject = ?6, body = ?7, authors = ?8, revision = revision + 1, updated_at = ?9
             WHERE id = ?1 AND revision = ?2 AND discarded_at IS NULL AND send_state = 'none'",
            params![
                id,
                revision,
                json!(row.recipients.to).to_string(),
                json!(row.recipients.cc).to_string(),
                json!(row.recipients.bcc).to_string(),
                row.subject,
                row.body,
                authors_json(&row.authors),
                now,
            ],
        )?;
        self.after_change(id, changed)
    }

    /// Discards draft `id` (`discard`) or restores it, raising its revision.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn set_draft_discarded(
        &self,
        id: i64,
        discard: bool,
        now: i64,
    ) -> Result<Result<DraftRow, DraftRefusal>, StoreError> {
        let Some(row) = self.draft(id)? else {
            return Ok(Err(DraftRefusal::NotFound));
        };
        match row.send_state {
            SendState::Sending => return Ok(Err(DraftRefusal::Sending)),
            SendState::Sent => return Ok(Err(DraftRefusal::Sent)),
            SendState::Unknown => return Ok(Err(DraftRefusal::Unknown)),
            SendState::None => {}
        }
        match (discard, row.discarded_at.is_some()) {
            (true, true) => return Ok(Err(DraftRefusal::Discarded)),
            (false, false) => return Ok(Err(DraftRefusal::NotDiscarded)),
            _ => {}
        }
        let changed = self.connection.execute(
            "UPDATE draft SET discarded_at = ?3, revision = revision + 1, updated_at = ?4
             WHERE id = ?1 AND revision = ?2 AND send_state = 'none'",
            params![id, row.revision, discard.then_some(now), now],
        )?;
        self.after_change(id, changed)
    }

    fn after_change(
        &self,
        id: i64,
        changed: usize,
    ) -> Result<Result<DraftRow, DraftRefusal>, StoreError> {
        let row = self.draft(id)?;
        Ok(match (changed, row) {
            (1, Some(row)) => Ok(row),
            (_, Some(row)) if row.discarded_at.is_some() => Err(DraftRefusal::Discarded),
            (_, Some(row)) if row.send_state == SendState::Sending => Err(DraftRefusal::Sending),
            (_, Some(row)) if row.send_state == SendState::Sent => Err(DraftRefusal::Sent),
            (_, Some(row)) if row.send_state == SendState::Unknown => Err(DraftRefusal::Unknown),
            (_, Some(row)) => Err(DraftRefusal::Changed {
                revision: row.revision,
            }),
            (_, None) => Err(DraftRefusal::NotFound),
        })
    }

    /// The basis of each recipient on `draft`, and whether the answered
    /// message has a differing `Reply-To`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn recipient_bases(&self, draft: &DraftRow) -> Result<RecipientBases, StoreError> {
        compute_recipient_bases(&self.connection, &self.log, draft)
    }

    /// Reads the `Message-ID` and `References` of an answered message from its
    /// held header block, sanitized for outgoing headers.
    ///
    /// # Errors
    /// When the database or log refuses.
    pub fn reply_headers(&self, message_id: i64) -> Result<Option<ReplyHeaders>, StoreError> {
        let raw = match self.read_part(MessageId(message_id), "header") {
            Ok(bytes) => bytes,
            Err(StoreError::NotFound(_)) => return Ok(None),
            Err(error) => return Err(error),
        };
        let Some(parsed) = mail_parser::MessageParser::new().parse_headers(&raw) else {
            return Ok(None);
        };
        let in_reply_to = parsed.message_id().and_then(clean_message_id);
        let mut references: Vec<String> = parsed
            .references()
            .map(|list| list.iter().filter_map(clean_message_id).collect())
            .unwrap_or_default();
        if let Some(reply) = &in_reply_to
            && !references.iter().any(|existing| existing == reply)
        {
            references.push(reply.clone());
        }
        // Keep the root and most recent references when a thread is very long.
        if references.len() > 20 {
            let tail_start = references.len() - 19;
            let mut trimmed = Vec::with_capacity(20);
            trimmed.push(references[0].clone());
            trimmed.extend_from_slice(&references[tail_start..]);
            references = trimmed;
        }
        Ok(Some(ReplyHeaders {
            in_reply_to,
            references,
        }))
    }

    /// The non-gone sent mailbox of `account`, if the account has one.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn sent_mailbox(&self, account: AccountId) -> Result<Option<MailboxRow>, StoreError> {
        Ok(self
            .mailboxes(account)?
            .into_iter()
            .find(|mailbox| !mailbox.gone && mailbox.role == Role::Sent))
    }

    /// Atomically verifies draft `draft_id` at `expected_revision` and every
    /// recipient against the recipient rule (plus `typed_recipients`, already
    /// lowercased), marks the draft `sending`, and inserts a `sending` row in
    /// `outbound`. Nothing can change between the checks and marking the send.
    ///
    /// # Errors
    /// When the database refuses.
    #[allow(clippy::too_many_arguments)]
    pub fn begin_draft_send(
        &mut self,
        draft_id: i64,
        expected_revision: i64,
        typed_recipients: &HashSet<String>,
        message_id: &str,
        sender: &Proposer,
        now: i64,
    ) -> Result<Result<(DraftRow, AccountRow, i64), SendRefusal>, StoreError> {
        let transaction = self.connection.transaction()?;
        let row: Option<DraftRow> = transaction
            .query_row(
                &format!("SELECT {DRAFT_COLUMNS} FROM draft WHERE id = ?1"),
                [draft_id],
                draft_row,
            )
            .optional()?;
        let Some(mut row) = row else {
            return Ok(Err(SendRefusal::NotFound));
        };
        if row.discarded_at.is_some() {
            return Ok(Err(SendRefusal::Discarded));
        }
        match row.send_state {
            SendState::Sending => return Ok(Err(SendRefusal::Sending)),
            SendState::Sent => return Ok(Err(SendRefusal::Sent)),
            SendState::Unknown => return Ok(Err(SendRefusal::Unknown)),
            SendState::None => {}
        }
        if row.revision != expected_revision {
            return Ok(Err(SendRefusal::Changed {
                revision: row.revision,
            }));
        }
        let envelope_count = row.recipients.envelope_all().len();
        if envelope_count == 0 {
            return Ok(Err(SendRefusal::NoRecipients));
        }
        let account: Option<AccountRow> = transaction
            .query_row(
                "SELECT id, provider, address FROM account WHERE id = ?1",
                [row.account.0],
                |r| {
                    Ok(AccountRow {
                        id: AccountId(r.get(0)?),
                        provider: r.get(1)?,
                        address: r.get(2)?,
                    })
                },
            )
            .optional()?;
        let Some(account) = account else {
            return Ok(Err(SendRefusal::AccountNotFound));
        };
        let bases = compute_recipient_bases(&transaction, &self.log, &row)?;
        let mut disallowed = 0usize;
        for (addr, basis) in row
            .recipients
            .to
            .iter()
            .zip(&bases.to)
            .chain(row.recipients.cc.iter().zip(&bases.cc))
            .chain(row.recipients.bcc.iter().zip(&bases.bcc))
        {
            if *basis == RecipientBasis::New && !typed_recipients.contains(&normalize_domain(addr))
            {
                disallowed += 1;
            }
        }
        if disallowed > 0 {
            return Ok(Err(SendRefusal::RecipientNotAllowed { count: disallowed }));
        }
        let updated = transaction.execute(
            "UPDATE draft SET send_state = 'sending'
             WHERE id = ?1 AND revision = ?2 AND discarded_at IS NULL AND send_state = 'none'",
            params![draft_id, expected_revision],
        )?;
        if updated != 1 {
            let current: Option<DraftRow> = transaction
                .query_row(
                    &format!("SELECT {DRAFT_COLUMNS} FROM draft WHERE id = ?1"),
                    [draft_id],
                    draft_row,
                )
                .optional()?;
            let refusal = match current {
                None => SendRefusal::NotFound,
                Some(cur) if cur.discarded_at.is_some() => SendRefusal::Discarded,
                Some(cur) if cur.send_state == SendState::Sending => SendRefusal::Sending,
                Some(cur) if cur.send_state == SendState::Sent => SendRefusal::Sent,
                Some(cur) if cur.send_state == SendState::Unknown => SendRefusal::Unknown,
                Some(cur) => SendRefusal::Changed {
                    revision: cur.revision,
                },
            };
            return Ok(Err(refusal));
        }
        transaction.execute(
            "INSERT INTO outbound
                 (account_id, draft_id, draft_revision, kind, message_id, recipients, state,
                  sent_copy, sender_kind, sender_id, started_at)
             VALUES (?1, ?2, ?3, 'draft', ?4, ?5, 'sending', 0, ?6, ?7, ?8)",
            params![
                account.id.0,
                draft_id,
                expected_revision,
                message_id,
                i64::try_from(envelope_count).unwrap_or(i64::MAX),
                sender.kind,
                sender.id,
                now,
            ],
        )?;
        let outbound_id = transaction.last_insert_rowid();
        transaction.commit()?;
        row.send_state = SendState::Sending;
        Ok(Ok((row, account, outbound_id)))
    }

    /// Marks `outbound_id` and `draft_id` as `sent`, raising the draft's
    /// revision, and returns the new revision.
    ///
    /// # Errors
    /// When the database refuses or the expected rows no longer exist.
    pub fn finish_draft_send_sent(
        &mut self,
        outbound_id: i64,
        draft_id: i64,
        now: i64,
    ) -> Result<i64, StoreError> {
        let transaction = self.connection.transaction()?;
        let out_changed = transaction.execute(
            "UPDATE outbound SET state = 'sent', finished_at = ?2
             WHERE id = ?1 AND state = 'sending'",
            params![outbound_id, now],
        )?;
        let draft_changed = transaction.execute(
            "UPDATE draft SET send_state = 'sent', revision = revision + 1, updated_at = ?2
             WHERE id = ?1 AND send_state = 'sending'",
            params![draft_id, now],
        )?;
        if out_changed != 1 || draft_changed != 1 {
            return Err(StoreError::NotFound("outbound"));
        }
        let revision: i64 = transaction
            .query_row(
                "SELECT revision FROM draft WHERE id = ?1",
                [draft_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound("draft"))?;
        transaction.commit()?;
        Ok(revision)
    }

    /// Marks `outbound_id` as `failed` and returns `draft_id` to `open`
    /// (`send_state = 'none'`) so the person can try again after fixing the
    /// cause.
    ///
    /// # Errors
    /// When the database refuses or the expected rows no longer exist.
    pub fn finish_draft_send_failed(
        &mut self,
        outbound_id: i64,
        draft_id: i64,
        error: &str,
        now: i64,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        let out_changed = transaction.execute(
            "UPDATE outbound SET state = 'failed', finished_at = ?2, error = ?3
             WHERE id = ?1 AND state = 'sending'",
            params![outbound_id, now, error],
        )?;
        let draft_changed = transaction.execute(
            "UPDATE draft SET send_state = 'none' WHERE id = ?1 AND send_state = 'sending'",
            [draft_id],
        )?;
        if out_changed != 1 || draft_changed != 1 {
            return Err(StoreError::NotFound("outbound"));
        }
        transaction.commit()?;
        Ok(())
    }

    /// Marks `outbound_id` and `draft_id` as `unknown` (never retried),
    /// raising the draft's revision, and returns the new revision.
    ///
    /// # Errors
    /// When the database refuses or the expected rows no longer exist.
    pub fn finish_draft_send_unknown(
        &mut self,
        outbound_id: i64,
        draft_id: i64,
        error: &str,
        now: i64,
    ) -> Result<i64, StoreError> {
        let transaction = self.connection.transaction()?;
        let out_changed = transaction.execute(
            "UPDATE outbound SET state = 'unknown', finished_at = ?2, error = ?3
             WHERE id = ?1 AND state = 'sending'",
            params![outbound_id, now, error],
        )?;
        let draft_changed = transaction.execute(
            "UPDATE draft SET send_state = 'unknown', revision = revision + 1, updated_at = ?2
             WHERE id = ?1 AND send_state = 'sending'",
            params![draft_id, now],
        )?;
        if out_changed != 1 || draft_changed != 1 {
            return Err(StoreError::NotFound("outbound"));
        }
        let revision: i64 = transaction
            .query_row(
                "SELECT revision FROM draft WHERE id = ?1",
                [draft_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound("draft"))?;
        transaction.commit()?;
        Ok(revision)
    }

    /// Whether any outbound send is currently in flight for `account`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn has_sending_outbound(&self, account: AccountId) -> Result<bool, StoreError> {
        let sending: bool = self.connection.query_row(
            "SELECT EXISTS (SELECT 1 FROM outbound WHERE account_id = ?1 AND state = 'sending')",
            [account.0],
            |row| row.get(0),
        )?;
        Ok(sending)
    }

    /// How many outbound sends across all accounts are currently in flight.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn sending_outbound_count(&self) -> Result<u64, StoreError> {
        let total: i64 = self.connection.query_row(
            "SELECT count(*) FROM outbound WHERE state = 'sending'",
            [],
            |row| row.get(0),
        )?;
        Ok(u64::try_from(total).unwrap_or(0))
    }

    /// Records that the sent copy for `outbound_id` was appended to the sent
    /// mailbox.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn mark_outbound_sent_copy(&self, outbound_id: i64) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE outbound SET sent_copy = 1 WHERE id = ?1",
            [outbound_id],
        )?;
        Ok(())
    }

    /// One outbound record by id.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn outbound(&self, id: i64) -> Result<Option<OutboundRow>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT id, account_id, draft_id, draft_revision, kind, message_id, recipients,
                        state, sent_copy, sender_kind, sender_id, started_at, finished_at, error
                 FROM outbound WHERE id = ?1",
                [id],
                outbound_row,
            )
            .optional()?)
    }

    /// Count of sends whose outcome is unknown and the newest `limit` of them,
    /// for `mail-status` (the specification's 9.5 and section 11).
    ///
    /// # Errors
    /// When the database refuses.
    pub fn unknown_outbound(&self, limit: u32) -> Result<(u64, Vec<OutboundRow>), StoreError> {
        let total: i64 = self.connection.query_row(
            "SELECT count(*) FROM outbound WHERE state = 'unknown'",
            [],
            |row| row.get(0),
        )?;
        let mut statement = self.connection.prepare_cached(
            "SELECT id, account_id, draft_id, draft_revision, kind, message_id, recipients,
                    state, sent_copy, sender_kind, sender_id, started_at, finished_at, error
             FROM outbound WHERE state = 'unknown'
             ORDER BY started_at DESC, id DESC LIMIT ?1",
        )?;
        let rows = statement.query_map([limit], outbound_row)?;
        Ok((
            u64::try_from(total).unwrap_or(0),
            rows.collect::<Result<_, _>>()?,
        ))
    }

    /// The accounts whose mailboxes show message `message` now.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn accounts_showing(&self, message: i64) -> Result<Vec<AccountId>, StoreError> {
        let mut statement = self.connection.prepare_cached(
            "SELECT DISTINCT mailbox.account_id FROM observation
             JOIN mailbox ON mailbox.id = observation.mailbox_id
             WHERE observation.message_id = ?1 AND observation.ended_at IS NULL
             ORDER BY 1",
        )?;
        let rows = statement.query_map([message], |row| Ok(AccountId(row.get(0)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// When thread `thread` is snoozed until, if a snooze holds it at `now`:
    /// one set on any of its messages, still in the future, and with no mail
    /// arrived in the thread since it was set.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn snoozed_until(&self, thread: i64, now: i64) -> Result<Option<i64>, StoreError> {
        Ok(self
            .connection
            .query_row(
                &format!("SELECT max(snooze.until) FROM snooze {SNOOZE_HOLDS}"),
                params![thread, now],
                |row| row.get(0),
            )
            .optional()?
            .flatten())
    }

    /// Snoozes thread `thread` until `until`, or ends its snooze when `until`
    /// is `None`; returns when it was snoozed until before, if it was.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn snooze_thread(
        &mut self,
        thread: i64,
        until: Option<i64>,
        creator: &Proposer,
        now: i64,
    ) -> Result<Option<i64>, StoreError> {
        let before = self.snoozed_until(thread, now)?;
        let transaction = self.connection.transaction()?;
        let mark: i64 =
            transaction.query_row("SELECT coalesce(max(id), 0) FROM message", [], |row| {
                row.get(0)
            })?;
        transaction.execute(
            "DELETE FROM snooze WHERE message_id IN
                 (SELECT message_id FROM envelope WHERE thread_id = ?1)",
            [thread],
        )?;
        if let Some(until) = until {
            transaction.execute(
                "INSERT INTO snooze (message_id, until, set_at, mark, creator_kind, creator_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![thread, until, now, mark, creator.kind, creator.id],
            )?;
        }
        transaction.commit()?;
        Ok(before)
    }

    /// Removes the snoozes that mail which arrived in their threads ended, so
    /// that they stay ended; how many. A pass of sync calls it.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn wake_snoozes(&self) -> Result<u64, StoreError> {
        let woken = self.connection.execute(
            "DELETE FROM snooze WHERE EXISTS (
                 SELECT 1 FROM envelope AS snoozed JOIN envelope AS arrived
                     ON arrived.thread_id = snoozed.thread_id
                 WHERE snoozed.message_id = snooze.message_id
                   AND arrived.message_id > snooze.mark)",
            [],
        )?;
        Ok(woken as u64)
    }
}

/// The snoozes that hold thread `?1` at `?2`, after `FROM snooze`.
pub(super) const SNOOZE_HOLDS: &str = "
    JOIN envelope AS snoozed ON snoozed.message_id = snooze.message_id
    WHERE snoozed.thread_id = ?1 AND snooze.until > ?2
      AND NOT EXISTS (
          SELECT 1 FROM envelope AS arrived
          WHERE arrived.thread_id = ?1 AND arrived.message_id > snooze.mark)";
