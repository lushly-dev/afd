//! Selections (the specification's 9.1): a query resolved once and frozen,
//! so that a change acts on exactly the mail that was counted, and on
//! nothing that arrived or came to match after.
//!
//! What is frozen is each message in each mailbox that shows it, as the
//! provider names it there: the mailbox, its generation and the message's id
//! in it. Two copies of one message in a mailbox are two items, one message.
//! A query that names a mailbox holds the items in that mailbox; one that
//! does not holds the items outside junk and trash, as the lists by class do
//! (7.2), so that a sender's mail is not pulled out of the trash by a change
//! meant for the rest of it. A selection of a whole mailbox and nothing else
//! also holds the messages that mailbox lists and the provider never
//! returned (5.4), counted apart.
//!
//! A selection can be acted on for an hour. Each caller may hold a few at
//! once, so that mail that steers an agent cannot fill the disk with them.

use std::collections::HashSet;

use rusqlite::{OptionalExtension, params};

use super::read::{LISTED, listed};
use super::{
    AccountId, Class, MailboxId, MessageListed, Proposer, Store, StoreError,
    UNRETURNED_AFTER_TRIES, count,
};

/// How long a selection can be acted on, in milliseconds.
pub const SELECTION_LIFETIME: i64 = 60 * 60 * 1000;

/// How many selections one caller may hold at once.
pub const MOST_SELECTIONS: u32 = 10;

/// What a selection selects. Each field given narrows it; at least one is.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SelectionQuery {
    /// One account's mail.
    pub account: Option<AccountId>,
    /// One mailbox's mail; junk and trash are left out unless it is one.
    pub mailbox: Option<MailboxId>,
    /// One sender's mail, by its address in lower case.
    pub sender: Option<String>,
    /// One story's mail.
    pub story: Option<i64>,
    /// One screening class's mail.
    pub class: Option<Class>,
    /// Mail listed under this date or later, in milliseconds.
    pub after: Option<i64>,
    /// Mail listed under a date before this one, in milliseconds.
    pub before: Option<i64>,
    /// Unread mail only, or read mail only: per mailbox, as its flags say.
    pub unread: Option<bool>,
    /// Mail whose subject or visible text holds every word of this search.
    pub text: Option<String>,
}

impl SelectionQuery {
    /// Whether it names nothing, which would select everything.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// Whether it names a whole mailbox and nothing else, an account that
    /// may hold it apart.
    #[must_use]
    pub fn whole_mailbox(&self) -> Option<MailboxId> {
        let only = Self {
            account: self.account,
            mailbox: self.mailbox,
            ..Self::default()
        };
        (*self == only).then_some(self.mailbox).flatten()
    }
}

/// A selection as the store keeps it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectionRow {
    /// Its id.
    pub id: i64,
    /// The query as the caller gave it, as JSON. Its search text is the
    /// caller's.
    pub query: String,
    /// Who made it.
    pub creator: Proposer,
    /// When, in milliseconds.
    pub created_at: i64,
    /// Until when it can be acted on.
    pub expires_at: i64,
    /// How many messages it holds.
    pub messages: u64,
    /// How many threads those are in.
    pub threads: u64,
    /// How many messages a mailbox lists that the provider never returned.
    pub unreturned: u64,
}

impl SelectionRow {
    /// Everything a change would act on: its messages and the unreturned
    /// ones. A change states it as `expectedCount`.
    #[must_use]
    pub fn count(&self) -> u64 {
        self.messages + self.unreturned
    }
}

/// What making a selection came to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selected {
    /// It was made.
    Made(SelectionRow),
    /// The caller holds this many already.
    TooMany(u32),
    /// Its search text cannot be read as a search: a selection never
    /// searches for less than it was given.
    Unreadable,
}

/// One thing a selection froze: a message in a mailbox, as the provider
/// names it there.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct SelectionItem {
    /// The mailbox.
    pub mailbox: i64,
    /// The mailbox's generation the id belongs to.
    pub validity: String,
    /// The message's id in the mailbox.
    pub provider_id: String,
    /// The message; `None` for one the provider never returned.
    pub message: Option<i64>,
}

const SELECTION_COLUMNS: &str = "id, query, creator_kind, creator_id, created_at, expires_at,
    messages, threads, unreturned";

fn selection_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SelectionRow> {
    Ok(SelectionRow {
        id: row.get(0)?,
        query: row.get(1)?,
        creator: Proposer {
            kind: row.get(2)?,
            id: row.get(3)?,
        },
        created_at: row.get(4)?,
        expires_at: row.get(5)?,
        messages: count(row.get(6)?),
        threads: count(row.get(7)?),
        unreturned: count(row.get(8)?),
    })
}

/// The statement that finds a query's places, with its parameters. Each
/// condition is a fixed piece of text; only the parameters carry values.
fn places_sql(query: &SelectionQuery) -> (String, Vec<rusqlite::types::Value>) {
    use rusqlite::types::Value;
    let mut sql = String::from(
        "SELECT observation.mailbox_id, observation.validity, observation.provider_id,
                observation.message_id
         FROM observation
         JOIN mailbox ON mailbox.id = observation.mailbox_id
         LEFT JOIN envelope ON envelope.message_id = observation.message_id
         WHERE observation.ended_at IS NULL AND mailbox.gone_at IS NULL
           AND observation.validity = mailbox.validity",
    );
    let mut values: Vec<Value> = Vec::new();
    let mut add = |condition: &str, value: Value, sql: &mut String| {
        values.push(value);
        sql.push_str(&condition.replace("?#", &format!("?{}", values.len())));
    };
    match query.mailbox {
        Some(mailbox) => add(" AND mailbox.id = ?#", Value::Integer(mailbox.0), &mut sql),
        None => sql.push_str(" AND mailbox.role NOT IN ('junk', 'trash')"),
    }
    if let Some(account) = query.account {
        add(
            " AND mailbox.account_id = ?#",
            Value::Integer(account.0),
            &mut sql,
        );
    }
    if let Some(sender) = &query.sender {
        add(
            " AND envelope.sender_address = ?#",
            Value::Text(sender.clone()),
            &mut sql,
        );
    }
    if let Some(class) = query.class {
        add(
            " AND EXISTS (SELECT 1 FROM screening
                          WHERE screening.message_id = observation.message_id
                            AND screening.class = ?#)",
            Value::Text(class.as_str().to_string()),
            &mut sql,
        );
    }
    if let Some(story) = query.story {
        add(
            // What the story's list shows: a burst's members are its
            // unknown and bulk first contacts, never a known sender's;
            // a proposed story holds its stored `yes` members while active.
            " AND (EXISTS (SELECT 1 FROM story_member
                           WHERE story_member.message_id = observation.message_id
                             AND story_member.story_id = ?#)
                   OR EXISTS (SELECT 1 FROM proposed_story_member
                              JOIN proposed_story
                                ON proposed_story.id = proposed_story_member.story_id
                              WHERE proposed_story_member.message_id = observation.message_id
                                AND proposed_story_member.story_id = ?#
                                AND proposed_story.state = 'proposed'))",
            Value::Integer(story),
            &mut sql,
        );
    }
    if let Some(after) = query.after {
        add(" AND envelope.date >= ?#", Value::Integer(after), &mut sql);
    }
    if let Some(before) = query.before {
        add(" AND envelope.date < ?#", Value::Integer(before), &mut sql);
    }
    if let Some(unread) = query.unread {
        let condition = if unread {
            " AND instr(observation.flags, ?#) = 0"
        } else {
            " AND instr(observation.flags, ?#) > 0"
        };
        add(
            condition,
            Value::Text(super::derived::SEEN_IN_FLAGS.to_string()),
            &mut sql,
        );
    }
    (sql, values)
}

impl Store {
    /// Resolves `query` once and freezes what it finds, for `creator`,
    /// unless they hold [`MOST_SELECTIONS`] already. `written` is the query
    /// as the caller gave it, kept with the selection. Selections that
    /// expired are removed first.
    ///
    /// # Errors
    /// [`StoreError::IndexStale`] when the query searches text and the index
    /// is older than the tables; when the database refuses.
    pub fn select(
        &mut self,
        query: &SelectionQuery,
        written: &str,
        creator: &Proposer,
        now: i64,
    ) -> Result<Selected, StoreError> {
        let matching: Option<HashSet<i64>> = match &query.text {
            Some(text) => {
                self.ensure_index()?;
                self.commit_index()?;
                let Some(index) = self.index.as_ref() else {
                    return Err(StoreError::IndexStale);
                };
                let Some(found) = index.matching(text)? else {
                    return Ok(Selected::Unreadable);
                };
                Some(found.into_iter().collect())
            }
            None => None,
        };
        let transaction = self.connection.transaction()?;
        transaction.execute("DELETE FROM selection WHERE expires_at <= ?1", [now])?;
        let held: i64 = transaction.query_row(
            "SELECT count(*) FROM selection WHERE creator_kind = ?1 AND creator_id IS ?2",
            params![creator.kind, creator.id],
            |row| row.get(0),
        )?;
        if held >= i64::from(MOST_SELECTIONS) {
            transaction.commit()?;
            return Ok(Selected::TooMany(MOST_SELECTIONS));
        }
        transaction.execute(
            "INSERT INTO selection (query, creator_kind, creator_id, created_at, expires_at,
                                    messages, threads, unreturned)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, 0)",
            params![
                written,
                creator.kind,
                creator.id,
                now,
                now + SELECTION_LIFETIME
            ],
        )?;
        let id = transaction.last_insert_rowid();
        {
            let (sql, values) = places_sql(query);
            let mut find = transaction.prepare(&sql)?;
            let mut keep = transaction.prepare(
                "INSERT INTO selection_item
                     (selection_id, mailbox_id, validity, provider_id, message_id)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            let mut rows = find.query(rusqlite::params_from_iter(values))?;
            while let Some(row) = rows.next()? {
                let message: i64 = row.get(3)?;
                if matching
                    .as_ref()
                    .is_some_and(|matching| !matching.contains(&message))
                {
                    continue;
                }
                let mailbox: i64 = row.get(0)?;
                let validity: String = row.get(1)?;
                let provider_id: String = row.get(2)?;
                keep.execute(params![id, mailbox, validity, provider_id, message])?;
            }
        }
        if let Some(mailbox) = query.whole_mailbox() {
            transaction.execute(
                "INSERT INTO selection_item
                     (selection_id, mailbox_id, validity, provider_id, message_id)
                 SELECT ?1, unreturned.mailbox_id, unreturned.validity, unreturned.provider_id,
                        NULL
                 FROM unreturned JOIN mailbox ON mailbox.id = unreturned.mailbox_id
                 WHERE unreturned.mailbox_id = ?2 AND unreturned.validity = mailbox.validity
                   AND unreturned.tries >= ?3 AND mailbox.gone_at IS NULL
                   AND mailbox.account_id = coalesce(?4, mailbox.account_id)
                   AND NOT EXISTS (SELECT 1 FROM selection_item AS held
                                   WHERE held.selection_id = ?1
                                     AND held.mailbox_id = unreturned.mailbox_id
                                     AND held.validity = unreturned.validity
                                     AND held.provider_id = unreturned.provider_id)",
                params![
                    id,
                    mailbox.0,
                    UNRETURNED_AFTER_TRIES,
                    query.account.map(|account| account.0)
                ],
            )?;
        }
        // A message with no envelope yet is a thread of its own.
        transaction.execute(
            "UPDATE selection SET
                 messages = (SELECT count(DISTINCT message_id) FROM selection_item
                             WHERE selection_id = ?1),
                 threads = (SELECT count(DISTINCT coalesce(envelope.thread_id,
                                                           -selection_item.message_id))
                            FROM selection_item
                            LEFT JOIN envelope
                                ON envelope.message_id = selection_item.message_id
                            WHERE selection_item.selection_id = ?1
                              AND selection_item.message_id IS NOT NULL),
                 unreturned = (SELECT count(*) FROM selection_item
                               WHERE selection_id = ?1 AND message_id IS NULL)
             WHERE id = ?1",
            [id],
        )?;
        let row = transaction.query_row(
            &format!("SELECT {SELECTION_COLUMNS} FROM selection WHERE id = ?1"),
            [id],
            selection_row,
        )?;
        transaction.commit()?;
        Ok(Selected::Made(row))
    }

    /// Selection `id`, if it is still kept: expired ones are kept until the
    /// next is made.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn selection(&self, id: i64) -> Result<Option<SelectionRow>, StoreError> {
        Ok(self
            .connection
            .query_row(
                &format!("SELECT {SELECTION_COLUMNS} FROM selection WHERE id = ?1"),
                [id],
                selection_row,
            )
            .optional()?)
    }

    /// The newest of selection `id`'s messages, at most `limit`, each once.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn selection_sample(&self, id: i64, limit: u32) -> Result<Vec<MessageListed>, StoreError> {
        let mut statement = self.connection.prepare_cached(&format!(
            "SELECT {LISTED} FROM envelope JOIN message ON message.id = envelope.message_id
             WHERE envelope.message_id IN (SELECT message_id FROM selection_item
                                           WHERE selection_id = ?1)
             ORDER BY envelope.date DESC, envelope.message_id DESC LIMIT ?2"
        ))?;
        let rows = statement.query_map(params![id, limit], listed)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// What selection `id` froze, in order.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn selection_items(&self, id: i64) -> Result<Vec<SelectionItem>, StoreError> {
        let mut statement = self.connection.prepare_cached(
            "SELECT mailbox_id, validity, provider_id, message_id FROM selection_item
             WHERE selection_id = ?1 ORDER BY mailbox_id, validity, provider_id",
        )?;
        let rows = statement.query_map([id], |row| {
            Ok(SelectionItem {
                mailbox: row.get(0)?,
                validity: row.get(1)?,
                provider_id: row.get(2)?,
                message: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }
}
