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

#[path = "draft_bases.rs"]
mod bases;

pub use bases::{RecipientBases, RecipientBasis};
pub(super) use bases::{backfill_recipient_bases, refresh_draft_bases_after_account_remove};
use bases::{compute_recipient_bases, recipient_bases_from_json, recipient_bases_json};

use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

use super::{AccountId, AccountRow, MailboxRow, MessageId, Role, Store, StoreError};
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
    /// Fixed recipient bases stored when the draft was created or its
    /// recipients were last replaced (step F2b; `None` on pre-migration-23 rows).
    pub recipient_bases: Option<RecipientBases>,
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
    /// The rendered preview would exceed the whole-preview caps (`PREVIEW_TOO_LARGE`).
    PreviewTooLarge,
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
    updated_at, discarded_at, send_state, recipient_bases";

fn draft_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DraftRow> {
    let authors: Value = serde_json::from_str(&row.get::<_, String>(8)?).unwrap_or(Value::Null);
    let send_state: String = row.get(15)?;
    let recipients = Recipients {
        to: addresses(&row.get::<_, String>(3)?),
        cc: addresses(&row.get::<_, String>(4)?),
        bcc: addresses(&row.get::<_, String>(5)?),
    };
    let raw_bases: Option<String> = row.get(16)?;
    let recipient_bases = raw_bases
        .as_deref()
        .and_then(|text| recipient_bases_from_json(text, &recipients));
    Ok(DraftRow {
        id: row.get(0)?,
        account: AccountId(row.get(1)?),
        answers: row.get(2)?,
        recipients,
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
        recipient_bases,
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

    /// Makes a draft written wholly by `creator`, computing and storing its
    /// fixed recipient bases inside the transaction and checking
    /// `check_preview` before committing (plugin.spec.md, sections 6, 7 and 8.2).
    ///
    /// # Errors
    /// When the database refuses.
    pub fn create_draft(
        &mut self,
        draft: &NewDraft,
        creator: &Proposer,
        now: i64,
        check_preview: impl FnOnce(&DraftRow, &RecipientBases) -> bool,
    ) -> Result<Result<DraftRow, DraftRefusal>, StoreError> {
        let authors = Authors {
            recipients: creator.clone(),
            subject: creator.clone(),
            body: creator.clone(),
        };
        let transaction = self.connection.transaction()?;
        let preview_row = DraftRow {
            id: 0,
            account: draft.account,
            answers: draft.answers,
            recipients: draft.recipients.clone(),
            subject: draft.subject.clone(),
            body: draft.body.clone(),
            authors: authors.clone(),
            revision: 1,
            creator: creator.clone(),
            created_at: now,
            updated_at: now,
            discarded_at: None,
            send_state: SendState::None,
            recipient_bases: None,
        };
        let bases = compute_recipient_bases(&transaction, &self.log, &preview_row)?;
        let bases_json = recipient_bases_json(&bases);
        transaction.execute(
            "INSERT INTO draft (account_id, answers_message_id, to_addresses, cc_addresses,
                 bcc_addresses, subject, body, authors, revision, creator_kind, creator_id,
                 created_at, updated_at, recipient_bases)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10, ?11, ?11, ?12)",
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
                bases_json,
            ],
        )?;
        let id = transaction.last_insert_rowid();
        let row: DraftRow = transaction
            .query_row(
                &format!("SELECT {DRAFT_COLUMNS} FROM draft WHERE id = ?1"),
                [id],
                draft_row,
            )
            .optional()?
            .ok_or(StoreError::NotFound("draft"))?;
        if !check_preview(&row, &bases) {
            // Dropping the uncommitted transaction leaves nothing stored.
            return Ok(Err(DraftRefusal::PreviewTooLarge));
        }
        transaction.commit()?;
        Ok(Ok(row))
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
    /// revision rises by one. Recomputes fixed `recipient_bases` only when
    /// `recipients` change (or were absent on a pre-migration-23 row), and
    /// checks `check_preview` before committing (plugin.spec.md, sections 6, 7
    /// and 8.2).
    ///
    /// # Errors
    /// When the database refuses.
    pub fn update_draft(
        &mut self,
        id: i64,
        revision: i64,
        change: &DraftChange,
        author: &Proposer,
        now: i64,
        check_preview: impl FnOnce(&DraftRow, &RecipientBases) -> bool,
    ) -> Result<Result<DraftRow, DraftRefusal>, StoreError> {
        let transaction = self.connection.transaction()?;
        let row: Option<DraftRow> = transaction
            .query_row(
                &format!("SELECT {DRAFT_COLUMNS} FROM draft WHERE id = ?1"),
                [id],
                draft_row,
            )
            .optional()?;
        let Some(mut row) = row else {
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
        let old_recipients = row.recipients.clone();
        let old_bases = row.recipient_bases.clone();
        let recipients_changed = change.recipients.is_some();
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
        let bases = if recipients_changed {
            let fresh = compute_recipient_bases(&transaction, &self.log, &row)?;
            if let Some(prev) = &old_bases {
                // Preserve each retained recipient's fixed basis; classify only newly added ones.
                let mut prior: std::collections::HashMap<String, RecipientBasis> =
                    std::collections::HashMap::new();
                for (addr, basis) in old_recipients
                    .to
                    .iter()
                    .zip(&prev.to)
                    .chain(old_recipients.cc.iter().zip(&prev.cc))
                    .chain(old_recipients.bcc.iter().zip(&prev.bcc))
                {
                    prior.entry(addr.to_lowercase()).or_insert(*basis);
                }
                let merge =
                    |addrs: &[String], computed: &[RecipientBasis]| -> Vec<RecipientBasis> {
                        addrs
                            .iter()
                            .zip(computed)
                            .map(|(addr, basis)| {
                                prior.get(&addr.to_lowercase()).copied().unwrap_or(*basis)
                            })
                            .collect()
                    };
                RecipientBases {
                    to: merge(&row.recipients.to, &fresh.to),
                    cc: merge(&row.recipients.cc, &fresh.cc),
                    bcc: merge(&row.recipients.bcc, &fresh.bcc),
                    reply_to_differs: prev.reply_to_differs,
                }
            } else {
                fresh
            }
        } else if let Some(prev) = old_bases {
            prev
        } else {
            compute_recipient_bases(&transaction, &self.log, &row)?
        };
        let bases_json = recipient_bases_json(&bases);
        // The revision and state are checked again in the statement, so two
        // callers that read the same revision cannot both change it.
        let changed = transaction.execute(
            "UPDATE draft SET to_addresses = ?3, cc_addresses = ?4, bcc_addresses = ?5,
                 subject = ?6, body = ?7, authors = ?8, revision = revision + 1, updated_at = ?9,
                 recipient_bases = ?10
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
                bases_json,
            ],
        )?;
        let updated: Option<DraftRow> = transaction
            .query_row(
                &format!("SELECT {DRAFT_COLUMNS} FROM draft WHERE id = ?1"),
                [id],
                draft_row,
            )
            .optional()?;
        match (changed, updated) {
            (1, Some(updated_row)) => {
                if !check_preview(&updated_row, &bases) {
                    return Ok(Err(DraftRefusal::PreviewTooLarge));
                }
                transaction.commit()?;
                Ok(Ok(updated_row))
            }
            (_, Some(cur)) if cur.discarded_at.is_some() => Ok(Err(DraftRefusal::Discarded)),
            (_, Some(cur)) if cur.send_state == SendState::Sending => {
                Ok(Err(DraftRefusal::Sending))
            }
            (_, Some(cur)) if cur.send_state == SendState::Sent => Ok(Err(DraftRefusal::Sent)),
            (_, Some(cur)) if cur.send_state == SendState::Unknown => {
                Ok(Err(DraftRefusal::Unknown))
            }
            (_, Some(cur)) => Ok(Err(DraftRefusal::Changed {
                revision: cur.revision,
            })),
            (_, None) => Ok(Err(DraftRefusal::NotFound)),
        }
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
    /// message has a differing `Reply-To`. Returns the fixed bases stored with
    /// the draft when present, falling back to dynamic computation only for
    /// pre-migration-23 rows.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn recipient_bases(&self, draft: &DraftRow) -> Result<RecipientBases, StoreError> {
        if let Some(stored) = &draft.recipient_bases {
            return Ok(stored.clone());
        }
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
    /// lowercased; or allowing `new` recipients when `allow_new_recipients` is
    /// true for an approver-released send per Q2 (a)), marks the draft
    /// `sending`, and inserts a `sending` row in `outbound`. Nothing can change
    /// between the checks and marking the send.
    ///
    /// # Errors
    /// When the database refuses.
    #[allow(clippy::too_many_arguments)]
    pub fn begin_draft_send(
        &mut self,
        draft_id: i64,
        expected_revision: i64,
        typed_recipients: &HashSet<String>,
        allow_new_recipients: bool,
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
        if !allow_new_recipients {
            let bases = match &row.recipient_bases {
                Some(stored) => stored.clone(),
                None => compute_recipient_bases(&transaction, &self.log, &row)?,
            };
            let mut disallowed = 0usize;
            for (addr, basis) in row
                .recipients
                .to
                .iter()
                .zip(&bases.to)
                .chain(row.recipients.cc.iter().zip(&bases.cc))
                .chain(row.recipients.bcc.iter().zip(&bases.bcc))
            {
                if *basis == RecipientBasis::New
                    && !typed_recipients.contains(&normalize_domain(addr))
                {
                    disallowed += 1;
                }
            }
            if disallowed > 0 {
                return Ok(Err(SendRefusal::RecipientNotAllowed { count: disallowed }));
            }
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
            "SELECT EXISTS (SELECT 1 FROM outbound WHERE account_id = ?1 AND state = 'sending')
                 OR EXISTS (SELECT 1 FROM replyset WHERE account_id = ?1 AND state = 'sending')",
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

    /// Whether message `message` exists in the store.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn message_exists(&self, message: MessageId) -> Result<bool, StoreError> {
        Ok(self
            .connection
            .query_row("SELECT 1 FROM message WHERE id = ?1", [message.0], |_| {
                Ok(())
            })
            .optional()?
            .is_some())
    }

    /// Accounts associated with `message`: those currently showing it in a
    /// non-gone mailbox, falling back to any account whose mailbox ever
    /// observed it.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn message_accounts(&self, message: MessageId) -> Result<Vec<AccountRow>, StoreError> {
        let mut current_stmt = self.connection.prepare_cached(
            "SELECT DISTINCT account.id, account.provider, account.address
             FROM observation
             JOIN mailbox ON mailbox.id = observation.mailbox_id
             JOIN account ON account.id = mailbox.account_id
             WHERE observation.message_id = ?1
               AND observation.ended_at IS NULL
               AND mailbox.gone_at IS NULL
             ORDER BY account.id",
        )?;
        let current: Vec<AccountRow> = current_stmt
            .query_map([message.0], |row| {
                Ok(AccountRow {
                    id: AccountId(row.get(0)?),
                    provider: row.get(1)?,
                    address: row.get(2)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        if !current.is_empty() {
            return Ok(current);
        }
        let mut historical_stmt = self.connection.prepare_cached(
            "SELECT DISTINCT account.id, account.provider, account.address
             FROM observation
             JOIN mailbox ON mailbox.id = observation.mailbox_id
             JOIN account ON account.id = mailbox.account_id
             WHERE observation.message_id = ?1
             ORDER BY account.id",
        )?;
        let rows = historical_stmt.query_map([message.0], |row| {
            Ok(AccountRow {
                id: AccountId(row.get(0)?),
                provider: row.get(1)?,
                address: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Records the start of an unsubscribe attempt in `outbound`
    /// (`kind = 'unsubscribe'`, `state = 'sending'`) before contacting the
    /// remote endpoint or SMTP server.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn begin_unsubscribe(
        &mut self,
        account: AccountId,
        message_id: &str,
        sender: &Proposer,
        now: i64,
    ) -> Result<i64, StoreError> {
        self.connection.execute(
            "INSERT INTO outbound
                 (account_id, draft_id, draft_revision, kind, message_id, recipients, state,
                  sent_copy, sender_kind, sender_id, started_at)
             VALUES (?1, NULL, NULL, 'unsubscribe', ?2, 1, 'sending', 0, ?3, ?4, ?5)",
            params![account.0, message_id, sender.kind, sender.id, now],
        )?;
        Ok(self.connection.last_insert_rowid())
    }

    /// Updates an in-flight unsubscribe `outbound` row to its final `state`.
    ///
    /// # Errors
    /// When the database refuses or the row is no longer in `sending`.
    pub fn finish_unsubscribe(
        &mut self,
        outbound_id: i64,
        state: OutboundState,
        error: Option<&str>,
        now: i64,
    ) -> Result<(), StoreError> {
        let changed = self.connection.execute(
            "UPDATE outbound SET state = ?2, finished_at = ?3, error = ?4
             WHERE id = ?1 AND state = 'sending'",
            params![outbound_id, state.as_str(), now, error],
        )?;
        if changed != 1 {
            return Err(StoreError::NotFound("outbound"));
        }
        Ok(())
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
