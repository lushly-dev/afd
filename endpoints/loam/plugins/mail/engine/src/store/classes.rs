//! Screening classes (the specification's 7.2): every inbound message gets
//! one, by the first rule that matches.
//!
//! | | Class | Rule |
//! | --- | --- | --- |
//! | 1 | `blocked` | The person screened the sender out |
//! | 2 | `known` | The person screened the sender in, or has written to it |
//! | 3 | `bulk` | A list or bulk header, or a template seen at least five times |
//! | 4 | `unknown` | Everything else |
//!
//! A message is inbound when its sender is not one of the person's own
//! addresses (7.1, and those the person adds by hand). A class is derived
//! like a thread: never adjusted, computed again from what it depends on for
//! each batch that changes it, so a rebuild gives the same rows. It depends
//! on four things, and each batch notes which changed:
//!
//! - the message's own row (its sender, its headers, its template key): the
//!   messages the batch derived;
//! - its sender's row, only through whether the sender is the person's and
//!   whether the person has written to it: the senders for which that turned;
//! - its template's count, only through whether it reached five: the
//!   templates for which that turned;
//! - the person's decision on its sender, which a decision command notes.
//!
//! A sender that turns, or a template that does, has every one of its
//! messages classed again; anything else changes only the messages the batch
//! derived. So a batch that adds mail to the sender of 272 221 messages does
//! not touch that sender's other messages.

use std::collections::{BTreeSet, HashSet};

use rusqlite::{Connection, OptionalExtension, Transaction, params};

use super::screening::RECURRING;
use super::senders::BULK;
use super::{Kept, Store, StoreError, count};

/// The `engine_state` key that marks a store whose mail was held before
/// classes existed: they are filled when it is next opened.
const FILL: &str = "screening-fill";

/// What a batch changed that classes depend on.
#[derive(Debug, Default)]
pub(super) struct Reclassify<'a> {
    /// Messages derived again.
    pub(super) messages: Option<&'a BTreeSet<i64>>,
    /// Template keys whose count may have changed.
    pub(super) templates: Option<&'a BTreeSet<Vec<u8>>>,
    /// Addresses whose messages are classed again whole: a sender that
    /// turned, or one the person decided on.
    pub(super) senders: Option<&'a BTreeSet<String>>,
    /// Messages a mailbox started or stopped showing, whose `listed` is
    /// computed again.
    pub(super) shown: Option<&'a BTreeSet<i64>>,
}

/// Whether a mailbox other than junk and trash shows the message whose id
/// is `message` now: what the lists by class show, the census's scope and
/// where a person reads mail.
fn shown_expression(message: &str) -> String {
    format!(
        "EXISTS (SELECT 1 FROM observation
                 JOIN mailbox ON mailbox.id = observation.mailbox_id
                 WHERE observation.message_id = {message} AND observation.ended_at IS NULL
                   AND mailbox.role NOT IN ('junk', 'trash'))"
    )
}

/// A message's class, from its row, its sender's, its template's and the
/// person's decision. Reads `envelope` joined as in [`classify`].
fn class_expression() -> String {
    format!(
        "CASE WHEN decided.decision = 'out' THEN 'blocked'
              WHEN decided.decision = 'in' OR coalesce(sender.written, 0) > 0 THEN 'known'
              WHEN {BULK} OR coalesce(template.messages, 0) >= {RECURRING} THEN 'bulk'
              ELSE 'unknown' END"
    )
}

/// The statements that class again the messages `filter` selects from
/// `envelope`: each inbound one gets its row, and one from the person's own
/// address loses any.
fn classify_sql(filter: &str) -> [String; 2] {
    let class = class_expression();
    let listed = shown_expression("envelope.message_id");
    [
        format!(
            "INSERT INTO screening (message_id, class, date, sender_address, listed)
             SELECT envelope.message_id, {class}, envelope.date, envelope.sender_address, {listed}
             FROM envelope
             LEFT JOIN sender ON sender.address = envelope.sender_address
             LEFT JOIN sender_decision AS decided ON decided.address = envelope.sender_address
             LEFT JOIN template ON template.key = envelope.template_key
             WHERE ({filter})
               AND envelope.sender_address NOT IN (SELECT address FROM temp.screening_own)
             ON CONFLICT (message_id) DO UPDATE SET
                 class = excluded.class, date = excluded.date,
                 sender_address = excluded.sender_address, listed = excluded.listed
             WHERE screening.class <> excluded.class OR screening.date <> excluded.date
                OR screening.sender_address <> excluded.sender_address
                OR screening.listed <> excluded.listed
             RETURNING message_id"
        ),
        format!(
            "DELETE FROM screening WHERE message_id IN (
                 SELECT envelope.message_id FROM envelope
                 WHERE ({filter})
                   AND envelope.sender_address IN (SELECT address FROM temp.screening_own))
             RETURNING message_id"
        ),
    ]
}

/// What [`classify`] selects by: a sender, a template, or the messages a
/// batch derived.
const BY_SENDER: &str = "envelope.sender_address = ?1";
const BY_TEMPLATE: &str = "envelope.template_key = ?1";
const BY_TARGET: &str = "envelope.message_id IN (SELECT message_id FROM temp.screening_target)";

/// What [`relist_sql`] selects by: the messages a batch showed or stopped
/// showing, or every message a mailbox has shown.
const SHOWN_TARGET: &str = "message_id IN (SELECT message_id FROM temp.screening_target)";
const SHOWN_MAILBOX: &str =
    "message_id IN (SELECT message_id FROM observation WHERE mailbox_id = ?1)";

/// The statement that computes `listed` again for the rows `filter` selects,
/// and returns those it changed.
fn relist_sql(filter: &str) -> String {
    let listed = shown_expression("screening.message_id");
    format!(
        "UPDATE screening SET listed = {listed}
         WHERE ({filter}) AND listed IS NOT {listed}
         RETURNING message_id"
    )
}

/// Runs a statement that returns the ids of the rows it changed, adding
/// them to `changed` when it is given. Returns how many there were.
fn changing(
    transaction: &Transaction<'_>,
    sql: &str,
    bound: impl rusqlite::Params,
    mut changed: Option<&mut BTreeSet<i64>>,
) -> Result<u64, StoreError> {
    let mut statement = transaction.prepare_cached(sql)?;
    let mut rows = statement.query(bound)?;
    let mut n = 0_u64;
    while let Some(row) = rows.next()? {
        n += 1;
        if let Some(changed) = changed.as_deref_mut() {
            changed.insert(row.get(0)?);
        }
    }
    Ok(n)
}

/// Fills `temp.screening_target` with `messages`.
fn load_target(transaction: &Transaction<'_>, messages: &BTreeSet<i64>) -> Result<(), StoreError> {
    transaction.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS screening_target (message_id INTEGER PRIMARY KEY);
         DELETE FROM temp.screening_target;",
    )?;
    let mut insert =
        transaction.prepare_cached("INSERT OR IGNORE INTO temp.screening_target VALUES (?1)")?;
    for message in messages {
        insert.execute([message])?;
    }
    Ok(())
}

/// Computes `listed` again for every message `mailbox` has shown: after
/// the mailbox closed its observations (a new generation, or gone), or
/// became junk or trash, or stopped being one. The stories of the messages
/// that changed are computed again.
pub(super) fn relist_mailbox(
    transaction: &Transaction<'_>,
    mailbox: i64,
    now: i64,
) -> Result<(), StoreError> {
    let mut changed = BTreeSet::new();
    changing(
        transaction,
        &relist_sql(SHOWN_MAILBOX),
        [mailbox],
        Some(&mut changed),
    )?;
    super::stories::settle(transaction, &changed, now)
}

/// Classes again the messages `filter` selects, binding `bound`, adding
/// those whose row changed to `changed` when it is given. Returns how many
/// rows changed. Needs `temp.screening_own` filled ([`load_own`]).
fn classify(
    transaction: &Transaction<'_>,
    filter: &str,
    bound: impl rusqlite::Params + Copy,
    mut changed: Option<&mut BTreeSet<i64>>,
) -> Result<u64, StoreError> {
    let [write, remove] = classify_sql(filter);
    let written = changing(transaction, &write, bound, changed.as_deref_mut())?;
    let removed = changing(transaction, &remove, bound, changed)?;
    Ok(written + removed)
}

/// The queries screening runs, by name, for the test of their plans.
#[cfg(test)]
pub(super) fn every_query() -> Vec<(&'static str, String)> {
    let [by_sender, by_sender_remove] = classify_sql(BY_SENDER);
    let [by_template, by_template_remove] = classify_sql(BY_TEMPLATE);
    let [by_target, by_target_remove] = classify_sql(BY_TARGET);
    vec![
        ("by sender", by_sender),
        ("by sender, removed", by_sender_remove),
        ("by template", by_template),
        ("by template, removed", by_template_remove),
        ("by target", by_target),
        ("by target, removed", by_target_remove),
        ("recount", RECOUNT.to_string()),
        ("class counts", CLASS_COUNTS.to_string()),
        ("queue", QUEUE.to_string()),
        ("relist target", relist_sql(SHOWN_TARGET)),
        ("relist mailbox", relist_sql(SHOWN_MAILBOX)),
        ("class list", super::read::class_list_sql()),
        ("waiting senders", super::senders::senders_sql()),
        ("would change", super::decisions::WOULD_CHANGE.to_string()),
        ("blocked since", super::decisions::blocked_sql()),
    ]
}

/// Puts the person's own addresses where [`classify`] reads them.
fn load_own(transaction: &Transaction<'_>, own: &HashSet<String>) -> Result<(), StoreError> {
    transaction.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS screening_own (address TEXT PRIMARY KEY) WITHOUT ROWID;
         DELETE FROM temp.screening_own;",
    )?;
    let mut insert =
        transaction.prepare_cached("INSERT OR IGNORE INTO temp.screening_own VALUES (?1)")?;
    for address in own {
        insert.execute([address])?;
    }
    Ok(())
}

/// How many messages hold a template key.
const RECOUNT: &str = "SELECT count(*) FROM envelope WHERE template_key = ?1";

/// How many of a sender's messages are in each class.
const CLASS_COUNTS: &str =
    "SELECT class, count(*) FROM screening WHERE sender_address = ?1 GROUP BY class";

/// The queue's messages and senders.
const QUEUE: &str = "SELECT count(*), count(DISTINCT sender_address) FROM screening
     WHERE class = 'unknown' AND listed = 1";

/// Counts again each template in `keys`, and returns those that reached
/// [`RECURRING`] or fell below it.
fn recount(
    transaction: &Transaction<'_>,
    keys: &BTreeSet<Vec<u8>>,
) -> Result<BTreeSet<Vec<u8>>, StoreError> {
    let mut turned = BTreeSet::new();
    for key in keys {
        let before: i64 = transaction
            .one(
                "SELECT messages FROM template WHERE key = ?1",
                [key.as_slice()],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(0);
        let after: i64 = transaction.one(RECOUNT, [key.as_slice()], |row| row.get(0))?;
        if after == 0 {
            transaction.run("DELETE FROM template WHERE key = ?1", [key.as_slice()])?;
        } else {
            transaction.run(
                "INSERT INTO template (key, messages) VALUES (?1, ?2)
                 ON CONFLICT (key) DO UPDATE SET messages = excluded.messages",
                params![key.as_slice(), after],
            )?;
        }
        if (before >= RECURRING) != (after >= RECURRING) {
            turned.insert(key.clone());
        }
    }
    Ok(turned)
}

/// Classes again what `changed` names: the templates counted again first,
/// then every message of a sender or a template that turned, and the
/// messages derived. Then the stories of every message whose class or place
/// in the lists changed, or that was derived, are computed again
/// ([`super::stories`]). Returns how many class rows changed.
pub(super) fn settle(
    transaction: &Transaction<'_>,
    changed: &Reclassify<'_>,
    now: i64,
) -> Result<u64, StoreError> {
    let empty_messages = BTreeSet::new();
    let empty_templates = BTreeSet::new();
    let empty_senders = BTreeSet::new();
    let messages = changed.messages.unwrap_or(&empty_messages);
    let templates = changed.templates.unwrap_or(&empty_templates);
    let senders = changed.senders.unwrap_or(&empty_senders);
    let shown = changed.shown.unwrap_or(&empty_messages);
    if messages.is_empty() && templates.is_empty() && senders.is_empty() && shown.is_empty() {
        return Ok(0);
    }
    let turned = recount(transaction, templates)?;
    load_own(transaction, &super::senders::own_addresses(transaction)?)?;
    // The messages whose stories are computed again: those derived, those
    // shown or no longer shown somewhere, and any other whose class changed.
    let mut storied: BTreeSet<i64> = messages.union(shown).copied().collect();
    let mut rows = 0;
    for address in senders {
        rows += classify(transaction, BY_SENDER, [address], Some(&mut storied))?;
    }
    for key in &turned {
        rows += classify(
            transaction,
            BY_TEMPLATE,
            [key.as_slice()],
            Some(&mut storied),
        )?;
    }
    if !messages.is_empty() {
        load_target(transaction, messages)?;
        rows += classify(transaction, BY_TARGET, [], None)?;
    }
    // Where a message is shown changes only whether it is listed.
    if !shown.is_empty() {
        load_target(transaction, shown)?;
        changing(transaction, &relist_sql(SHOWN_TARGET), [], None)?;
    }
    super::stories::settle(transaction, &storied, now)?;
    Ok(rows)
}

/// Counts every template and classes every message from nothing: what a
/// store that held mail before classes existed is given once, and what the
/// tests compare the rows a batch at a time gave with.
pub(super) fn classify_all(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    transaction.execute_batch(
        "DELETE FROM screening;
         DELETE FROM template;
         INSERT INTO template (key, messages)
             SELECT template_key, count(*) FROM envelope WHERE template_key IS NOT NULL
             GROUP BY template_key;",
    )?;
    load_own(transaction, &super::senders::own_addresses(transaction)?)?;
    classify(transaction, "1", [], None)?;
    Ok(())
}

/// Fills templates and classes for the mail a store held before they
/// existed, once, when the store is opened after migration 8.
pub(super) fn fill_if_marked(connection: &mut Connection) -> Result<(), StoreError> {
    let marked: bool = connection.query_row(
        "SELECT EXISTS (SELECT 1 FROM engine_state WHERE key = ?1)",
        [FILL],
        |row| row.get(0),
    )?;
    if !marked {
        return Ok(());
    }
    let transaction = connection.transaction()?;
    classify_all(&transaction)?;
    transaction.execute("DELETE FROM engine_state WHERE key = ?1", [FILL])?;
    transaction.commit()?;
    Ok(())
}

/// What a rebuild throws away of screening's derived rows: it derives them
/// again a batch at a time.
pub(super) const CLEAR: &str = "DELETE FROM screening;
     DELETE FROM template;
     DELETE FROM engine_state WHERE key = 'screening-fill';";

/// A screening class.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Class {
    /// The person screened the sender out.
    Blocked,
    /// The person screened the sender in, or has written to it.
    Known,
    /// A list or bulk header, or a recurring template.
    Bulk,
    /// Everything else: the queue to be screened.
    Unknown,
}

impl Class {
    /// Every class, in the order of the rules.
    pub const ALL: [Self; 4] = [Self::Blocked, Self::Known, Self::Bulk, Self::Unknown];

    /// The class as the store and results write it.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Blocked => "blocked",
            Self::Known => "known",
            Self::Bulk => "bulk",
            Self::Unknown => "unknown",
        }
    }

    /// The class written `text`, if it is one.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|class| class.as_str() == text)
    }
}

/// How many of a sender's held messages are in each class.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ClassCounts {
    /// `blocked`.
    pub blocked: u64,
    /// `known`.
    pub known: u64,
    /// `bulk`.
    pub bulk: u64,
    /// `unknown`.
    pub unknown: u64,
}

/// Whether screening can be read: every message is derived by the current
/// derivation and no rebuild is under way (the specification's 7.1). Until
/// then a sender's row counts only the messages derived again, so a class
/// read from it could be wrong.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Readiness {
    /// Messages an older derivation read, waiting to be read again.
    pub stale: u64,
    /// Whether a rebuild is under way.
    pub rebuilding: bool,
}

impl Readiness {
    /// Whether nothing waits.
    #[must_use]
    pub fn ready(self) -> bool {
        self.stale == 0 && !self.rebuilding
    }
}

impl Store {
    /// Whether screening can be read, and if not, what it waits for.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn screening_readiness(&self) -> Result<Readiness, StoreError> {
        Ok(Readiness {
            stale: self.stale_count()?,
            rebuilding: self.rebuilding()?,
        })
    }

    /// How many of `address`'s held messages are in each class.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn class_counts(&self, address: &str) -> Result<ClassCounts, StoreError> {
        let mut statement = self.connection.prepare_cached(CLASS_COUNTS)?;
        let mut counts = ClassCounts::default();
        let rows = statement.query_map([address], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        for row in rows {
            let (class, n) = row?;
            let n = count(n);
            match Class::parse(&class) {
                Some(Class::Blocked) => counts.blocked = n,
                Some(Class::Known) => counts.known = n,
                Some(Class::Bulk) => counts.bulk = n,
                Some(Class::Unknown) | None => counts.unknown = n,
            }
        }
        Ok(counts)
    }

    /// The queue to be screened: how many `unknown` messages a mailbox
    /// other than junk and trash shows, and from how many senders.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn queue_counts(&self) -> Result<(u64, u64), StoreError> {
        let (messages, senders): (i64, i64) = self
            .connection
            .query_row(QUEUE, [], |row| Ok((row.get(0)?, row.get(1)?)))?;
        Ok((count(messages), count(senders)))
    }

    /// Counts every template, classes every message and makes every story
    /// from nothing, as a store that held mail before classes existed is
    /// given once.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn classify_everything(&mut self) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        classify_all(&transaction)?;
        super::stories::compose_all(&transaction, super::wall_clock())?;
        transaction.commit()?;
        Ok(())
    }
}
