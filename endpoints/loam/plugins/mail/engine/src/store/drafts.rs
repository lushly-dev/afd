//! Drafts and snoozed threads (the specification's 9.5 and section 11).
//! Neither is derived: both survive a rebuild.
//!
//! A draft is the engine's own record: its account, the message it answers,
//! its recipients, subject and body, and who wrote each part. Its revision
//! rises with every change to it, a discard and a restore included, so that
//! what a person previews before a send is what the send names. A discarded
//! draft is held for 30 days and can be restored (M29); after that it goes.
//!
//! A thread is snoozed by its lowest message, which is its id and which a
//! rebuild keeps as its id. Mail that arrives in the thread after it was
//! snoozed ends the snooze, as it does in most mail programs: a message
//! whose id is above the highest id when the snooze was set, which tells
//! apart two events in one millisecond. A pass of sync removes a snooze so
//! ended, so that the reply's leaving later does not bring it back.

use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};

use super::{AccountId, Store, StoreError};
use crate::store::Proposer;

/// How long a discarded draft is held before it goes: 30 days (M29).
pub const DISCARD_LIFETIME: i64 = 30 * 24 * 60 * 60 * 1000;

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
    updated_at, discarded_at";

fn draft_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DraftRow> {
    let authors: Value = serde_json::from_str(&row.get::<_, String>(8)?).unwrap_or(Value::Null);
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
    })
}

impl Store {
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

    /// Draft `id`, discarded or not.
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

    /// The drafts, discarded ones or the others, the most recently changed
    /// first: at most `limit`, after `before` (the `updated_at` and id of the
    /// last of the page before).
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
        let mut statement = self.connection.prepare_cached(&format!(
            "SELECT {DRAFT_COLUMNS} FROM draft
             WHERE (discarded_at IS NOT NULL) = ?1 AND (updated_at, id) < (?2, ?3)
             ORDER BY updated_at DESC, id DESC LIMIT ?4"
        ))?;
        let rows = statement.query_map(params![discarded, date, id, limit], draft_row)?;
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
        // The revision is checked again in the statement, so two callers
        // that read the same revision cannot both change it.
        let changed = self.connection.execute(
            "UPDATE draft SET to_addresses = ?3, cc_addresses = ?4, bcc_addresses = ?5,
                 subject = ?6, body = ?7, authors = ?8, revision = revision + 1, updated_at = ?9
             WHERE id = ?1 AND revision = ?2 AND discarded_at IS NULL",
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
        match (discard, row.discarded_at.is_some()) {
            (true, true) => return Ok(Err(DraftRefusal::Discarded)),
            (false, false) => return Ok(Err(DraftRefusal::NotDiscarded)),
            _ => {}
        }
        let changed = self.connection.execute(
            "UPDATE draft SET discarded_at = ?3, revision = revision + 1, updated_at = ?4
             WHERE id = ?1 AND revision = ?2",
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
            (_, Some(row)) => Err(DraftRefusal::Changed {
                revision: row.revision,
            }),
            (_, None) => Err(DraftRefusal::NotFound),
        })
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
