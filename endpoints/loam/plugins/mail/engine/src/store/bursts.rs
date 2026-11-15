//! Bursts (the specification's 7.4): many messages in a short time from
//! senders never seen before, found for each account.
//!
//! - **A first contact** is a message from a sender whose first message
//!   the provider received at most 24 hours before it, and who is new to
//!   the person: not one they have written to or screened in. It counts in each
//!   account whose mailboxes have shown it, junk and trash included, and
//!   mail deleted since: a flood the provider filed away, or the person
//!   threw away, was still a flood.
//! - **A burst** is found where an account's first contacts in any 24 hours
//!   (a window that starts at one of them) are at least [`LEAST`] and at
//!   least [`TIMES`] times the median of its daily first contacts over the
//!   [`MEDIAN_DAYS`] days before. Windows that overlap are one burst, which
//!   holds every first contact in them, whatever its class.
//! - A burst's messages that are `unknown` or `bulk` and listed form its
//!   story ([`super::stories`]), in place of a queue entry or a stream story
//!   each; a `known` sender's mail is never in one.
//!
//! The thresholds are data, set here; step C3 tried them on the owner's
//! iCloud mail of 2024 and 2025, where they find nothing.
//!
//! Everything here is derived, so a rebuild gives the same rows. First
//! contacts are computed again for each sender a batch touches, and written
//! only where they changed; each account's count for each day is counted
//! again for the days that changed. An account's bursts are found again
//! from all its first contacts only when a changed day could start or end
//! one: when two days in a row near it hold [`LEAST`] or more, or a burst
//! already lies there. Otherwise nothing is read.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{Connection, OptionalExtension, Transaction, params};

use super::{Kept, Store, StoreError, count};

/// A burst holds at least this many first contacts in a window.
pub const LEAST: i64 = 30;

/// A burst's window holds at least this many times the median day before.
pub const TIMES: i64 = 10;

/// The length of a burst's window, and how near a sender's first message a
/// first contact is, in milliseconds.
pub const WINDOW: i64 = 24 * 60 * 60 * 1000;

/// How many days before a window its median is taken over.
pub const MEDIAN_DAYS: i64 = 90;

/// A day, in milliseconds.
const DAY: i64 = 24 * 60 * 60 * 1000;

/// The `engine_state` key that marks a store whose mail was held before
/// bursts existed: they are found when it is next opened.
const FILL: &str = "burst-fill";

/// Whether `sender` (a row of `sender`) is new to the person: they have not
/// written to it or screened it in. A sender they know is not a stranger on
/// its first message.
const NEW_TO_THE_PERSON: &str = "sender.written = 0
     AND NOT EXISTS (SELECT 1 FROM sender_decision
                     WHERE sender_decision.address = sender.address
                       AND sender_decision.decision = 'in')";

/// A sender's first contacts as they should be: each of its messages the
/// provider received within a day of its first, in each account that has
/// shown it, while the sender is new to the person.
fn desired_sql() -> String {
    format!(
        "SELECT DISTINCT mailbox.account_id, envelope.message_id, envelope.received
         FROM sender
         JOIN envelope ON envelope.sender_address = sender.address
                      AND envelope.received < sender.first_received + 86400000
         JOIN observation ON observation.message_id = envelope.message_id
         JOIN mailbox ON mailbox.id = observation.mailbox_id
         WHERE sender.address = ?1 AND {NEW_TO_THE_PERSON}"
    )
}

/// A sender's first contacts as they are.
const CURRENT: &str = "SELECT account_id, message_id, received FROM first_contact
     WHERE sender_address = ?1";

/// An account's first contacts on one day.
const ON_DAY: &str = "SELECT count(*) FROM first_contact
     WHERE account_id = ?1 AND received >= ?2 AND received < ?3";

/// An account's daily counts in a range of days.
const DAYS: &str = "SELECT day, messages FROM contact_day
     WHERE account_id = ?1 AND day >= ?2 AND day <= ?3";

/// Whether a burst of an account lies in a range of time.
const BURST_NEAR: &str = "SELECT EXISTS (SELECT 1 FROM burst
     WHERE account_id = ?1 AND last >= ?2 AND first < ?3)";

/// An account's first contacts, in order.
const ALL: &str = "SELECT received, message_id FROM first_contact
     WHERE account_id = ?1 ORDER BY received, message_id";

/// An account's bursts and their messages.
const HELD: &str = "SELECT burst.id, burst.first, burst.last, burst_message.message_id
     FROM burst JOIN burst_message ON burst_message.burst_id = burst.id
     WHERE burst.account_id = ?1";

/// The day a time falls in.
fn day_of(at: i64) -> i64 {
    at.div_euclid(DAY)
}

/// A first contact: its account, message and when the provider received it.
type Contact = (i64, i64, i64);

/// Computes again the first contacts of `senders`, the daily counts of the
/// days that changed, and the bursts those could change. Returns the
/// messages whose bursts changed, whose stories are computed again.
pub(super) fn settle(
    transaction: &Transaction<'_>,
    senders: &BTreeSet<String>,
) -> Result<BTreeSet<i64>, StoreError> {
    let mut days: BTreeSet<(i64, i64)> = BTreeSet::new();
    {
        let mut desired_statement = transaction.prepare_cached(&desired_sql())?;
        let mut current_statement = transaction.prepare_cached(CURRENT)?;
        let read = |row: &rusqlite::Row<'_>| -> rusqlite::Result<Contact> {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        };
        for sender in senders {
            let desired: BTreeSet<Contact> = desired_statement
                .query_map([sender], read)?
                .collect::<Result<_, _>>()?;
            let current: BTreeSet<Contact> = current_statement
                .query_map([sender], read)?
                .collect::<Result<_, _>>()?;
            for (account, message, received) in current.difference(&desired) {
                transaction.run(
                    "DELETE FROM first_contact WHERE account_id = ?1 AND message_id = ?2",
                    params![account, message],
                )?;
                days.insert((*account, day_of(*received)));
            }
            for (account, message, received) in desired.difference(&current) {
                transaction.run(
                    "INSERT INTO first_contact (account_id, message_id, sender_address, received)
                     VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT (account_id, message_id) DO UPDATE SET
                         sender_address = excluded.sender_address, received = excluded.received",
                    params![account, message, sender, received],
                )?;
                days.insert((*account, day_of(*received)));
            }
        }
    }
    if days.is_empty() {
        return Ok(BTreeSet::new());
    }
    for (account, day) in &days {
        let messages: i64 = transaction.one(
            ON_DAY,
            params![account, day * DAY, (day + 1) * DAY],
            |row| row.get(0),
        )?;
        if messages == 0 {
            transaction.run(
                "DELETE FROM contact_day WHERE account_id = ?1 AND day = ?2",
                params![account, day],
            )?;
        } else {
            transaction.run(
                "INSERT INTO contact_day (account_id, day, messages) VALUES (?1, ?2, ?3)
                 ON CONFLICT (account_id, day) DO UPDATE SET messages = excluded.messages",
                params![account, day, messages],
            )?;
        }
    }
    // A changed day changes the windows that start the day before it or on
    // it, and the medians of the windows that start in the days after it.
    let mut ranges: BTreeMap<i64, (i64, i64)> = BTreeMap::new();
    for (account, day) in &days {
        let range = ranges.entry(*account).or_insert((*day, *day));
        range.0 = range.0.min(*day);
        range.1 = range.1.max(*day);
    }
    let mut changed = BTreeSet::new();
    for (account, (low, high)) in ranges {
        let (from, to) = (low - 1, high + MEDIAN_DAYS);
        if could_hold_a_burst(transaction, account, from, to + 1)?
            || transaction.one(
                BURST_NEAR,
                params![account, from * DAY, (to + 2) * DAY],
                |row| row.get::<_, bool>(0),
            )?
        {
            changed.extend(find(transaction, account)?);
        }
    }
    Ok(changed)
}

/// Whether two days in a row from `from` to `to` hold [`LEAST`] first
/// contacts or more: a window of a day spans two at most.
fn could_hold_a_burst(
    transaction: &Transaction<'_>,
    account: i64,
    from: i64,
    to: i64,
) -> Result<bool, StoreError> {
    let counts: BTreeMap<i64, i64> = transaction
        .prepare_cached(DAYS)?
        .query_map(params![account, from, to], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
        .collect::<Result<_, _>>()?;
    Ok(counts.iter().any(|(day, messages)| {
        messages + counts.get(&(day + 1)).copied().unwrap_or(0) >= LEAST
            || messages + counts.get(&(day - 1)).copied().unwrap_or(0) >= LEAST
    }))
}

/// The median of an account's daily first contacts over the
/// [`MEDIAN_DAYS`] days before `day`, days with none counted as nothing.
fn median_before(counts: &BTreeMap<i64, i64>, day: i64) -> f64 {
    let mut days: Vec<i64> = (day - MEDIAN_DAYS..day)
        .map(|before| counts.get(&before).copied().unwrap_or(0))
        .collect();
    days.sort_unstable();
    let middle = days.len() / 2;
    if days.len().is_multiple_of(2) {
        (days[middle - 1] + days[middle]) as f64 / 2.0
    } else {
        days[middle] as f64
    }
}

/// The bursts in an account's first contacts, in order: each its first and
/// last time and its messages.
fn bursts_in(contacts: &[(i64, i64)], counts: &BTreeMap<i64, i64>) -> Vec<(i64, i64, Vec<i64>)> {
    let mut found: Vec<(usize, usize)> = Vec::new();
    let mut end = 0;
    for start in 0..contacts.len() {
        end = end.max(start);
        while end < contacts.len() && contacts[end].0 < contacts[start].0 + WINDOW {
            end += 1;
        }
        let held = i64::try_from(end - start).unwrap_or(i64::MAX);
        if held < LEAST {
            continue;
        }
        if (held as f64) < TIMES as f64 * median_before(counts, day_of(contacts[start].0)) {
            continue;
        }
        match found.last_mut() {
            // Windows that overlap are one burst.
            Some(last) if start < last.1 => last.1 = last.1.max(end),
            _ => found.push((start, end)),
        }
    }
    found
        .into_iter()
        .map(|(start, end)| {
            (
                contacts[start].0,
                contacts[end - 1].0,
                contacts[start..end]
                    .iter()
                    .map(|(_, message)| *message)
                    .collect(),
            )
        })
        .collect()
}

/// Finds an account's bursts again from all its first contacts, and writes
/// them where they changed. Returns the messages whose bursts changed.
fn find(transaction: &Transaction<'_>, account: i64) -> Result<BTreeSet<i64>, StoreError> {
    let contacts: Vec<(i64, i64)> = transaction
        .prepare_cached(ALL)?
        .query_map([account], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<_, _>>()?;
    let counts: BTreeMap<i64, i64> = transaction
        .prepare_cached(DAYS)?
        .query_map(params![account, i64::MIN, i64::MAX], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
        .collect::<Result<_, _>>()?;
    let mut new: BTreeMap<i64, (i64, i64, BTreeSet<i64>)> = BTreeMap::new();
    for (first, last, messages) in bursts_in(&contacts, &counts) {
        let key = format!("burst {account} {first}");
        transaction.run("INSERT OR IGNORE INTO stream (key) VALUES (?1)", [&key])?;
        let id: i64 = transaction.one("SELECT id FROM stream WHERE key = ?1", [&key], |row| {
            row.get(0)
        })?;
        new.insert(id, (first, last, messages.into_iter().collect()));
    }
    let mut old: BTreeMap<i64, (i64, i64, BTreeSet<i64>)> = BTreeMap::new();
    {
        let mut statement = transaction.prepare_cached(HELD)?;
        let rows = statement.query_map([account], |row| {
            Ok((row.get::<_, i64>(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?;
        for row in rows {
            let (id, first, last, message) = row?;
            old.entry(id)
                .or_insert_with(|| (first, last, BTreeSet::new()))
                .2
                .insert(message);
        }
    }
    if old == new {
        return Ok(BTreeSet::new());
    }
    let membership = |bursts: &BTreeMap<i64, (i64, i64, BTreeSet<i64>)>| {
        bursts
            .iter()
            .flat_map(|(id, (_, _, messages))| messages.iter().map(move |message| (*message, *id)))
            .collect::<BTreeMap<i64, i64>>()
    };
    let (was, is) = (membership(&old), membership(&new));
    let changed: BTreeSet<i64> = was
        .keys()
        .chain(is.keys())
        .filter(|message| was.get(message) != is.get(message))
        .copied()
        .collect();
    for id in old.keys() {
        transaction.run("DELETE FROM burst_message WHERE burst_id = ?1", [id])?;
        transaction.run("DELETE FROM burst WHERE id = ?1", [id])?;
    }
    for (id, (first, last, messages)) in &new {
        transaction.run(
            "INSERT INTO burst (id, account_id, first, last, messages) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id,
                account,
                first,
                last,
                i64::try_from(messages.len()).unwrap_or(i64::MAX)
            ],
        )?;
        for message in messages {
            transaction.run(
                "INSERT INTO burst_message (burst_id, message_id) VALUES (?1, ?2)",
                params![id, message],
            )?;
        }
    }
    Ok(changed)
}

/// Finds every first contact and every burst from nothing: what a store
/// that held mail before bursts existed is given once, and what the tests
/// compare the rows a batch at a time gave with.
pub(super) fn compose_all(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    transaction.execute_batch(&format!(
        "DELETE FROM burst_message;
         DELETE FROM burst;
         DELETE FROM contact_day;
         DELETE FROM first_contact;
         INSERT INTO first_contact (account_id, message_id, sender_address, received)
             SELECT DISTINCT mailbox.account_id, envelope.message_id, envelope.sender_address,
                    envelope.received
             FROM sender
             JOIN envelope ON envelope.sender_address = sender.address
                          AND envelope.received < sender.first_received + 86400000
             JOIN observation ON observation.message_id = envelope.message_id
             JOIN mailbox ON mailbox.id = observation.mailbox_id
             WHERE {NEW_TO_THE_PERSON};
         INSERT INTO contact_day (account_id, day, messages)
             SELECT account_id, received / 86400000 - (received % 86400000 < 0), count(*)
             FROM first_contact GROUP BY 1, 2;"
    ))?;
    let accounts: Vec<i64> = transaction
        .prepare("SELECT DISTINCT account_id FROM contact_day")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    for account in accounts {
        if could_hold_a_burst(transaction, account, i64::MIN / DAY, i64::MAX / DAY)? {
            find(transaction, account)?;
        }
    }
    Ok(())
}

/// Finds the bursts of the mail a store held before they existed, once,
/// when the store is opened after migration 10, and gives its stories again
/// from them.
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
    compose_all(&transaction)?;
    super::stories::compose_all(&transaction, super::wall_clock())?;
    transaction.execute("DELETE FROM engine_state WHERE key = ?1", [FILL])?;
    transaction.commit()?;
    Ok(())
}

/// What a rebuild throws away of bursts: it finds them again a batch at a
/// time.
pub(super) const CLEAR: &str = "DELETE FROM burst_message;
     DELETE FROM burst;
     DELETE FROM contact_day;
     DELETE FROM first_contact;
     DELETE FROM engine_state WHERE key = 'burst-fill';";

/// The queries bursts run, by name, for the test of their plans.
#[cfg(test)]
pub(super) fn every_query() -> Vec<(&'static str, String)> {
    vec![
        ("desired", desired_sql()),
        ("current", CURRENT.to_string()),
        ("on day", ON_DAY.to_string()),
        ("days", DAYS.to_string()),
        ("burst near", BURST_NEAR.to_string()),
        ("all", ALL.to_string()),
        ("held", HELD.to_string()),
        ("known during", KNOWN_DURING.to_string()),
        ("latest", LATEST.to_string()),
    ]
}

/// A burst as `mail-status` and a story's card give it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BurstRow {
    /// Its id, which is its story's.
    pub id: i64,
    /// The account it was found in.
    pub account: i64,
    /// When the provider received its first and last first contact.
    pub first: i64,
    /// When the provider received its last first contact.
    pub last: i64,
    /// Its first contacts, whatever their class.
    pub messages: u64,
}

/// The `known` senders an account's lists show mail from, dated within a
/// burst: those a flood may have been sent to hide (7.4).
const KNOWN_DURING: &str = "SELECT DISTINCT screening.sender_address FROM screening
     WHERE screening.class = 'known' AND screening.listed = 1
       AND screening.date >= ?2 AND screening.date <= ?3
       AND EXISTS (SELECT 1 FROM observation JOIN mailbox ON mailbox.id = observation.mailbox_id
                   WHERE observation.message_id = screening.message_id
                     AND mailbox.account_id = ?1)
     ORDER BY screening.sender_address";

/// The bursts that ended at or after a time, the latest first.
const LATEST: &str = "SELECT id, account_id, first, last, messages FROM burst
     WHERE last >= ?1 ORDER BY last DESC, id DESC LIMIT ?2";

impl Store {
    /// The bursts whose last first contact came at or after `since`, the
    /// latest first: at most `limit`, and how many there are in all.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn bursts_since(&self, since: i64, limit: u32) -> Result<(Vec<BurstRow>, u64), StoreError> {
        let rows: Vec<BurstRow> = self
            .connection
            .prepare_cached(LATEST)?
            .query_map(params![since, limit], |row| {
                Ok(BurstRow {
                    id: row.get(0)?,
                    account: row.get(1)?,
                    first: row.get(2)?,
                    last: row.get(3)?,
                    messages: count(row.get(4)?),
                })
            })?
            .collect::<Result<_, _>>()?;
        let total: i64 = self.connection.query_row(
            "SELECT count(*) FROM burst WHERE last >= ?1",
            [since],
            |row| row.get(0),
        )?;
        Ok((rows, count(total)))
    }

    /// The burst a story is, or `None` when it is not one.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn burst(&self, id: i64) -> Result<Option<BurstRow>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT id, account_id, first, last, messages FROM burst WHERE id = ?1",
                [id],
                |row| {
                    Ok(BurstRow {
                        id: row.get(0)?,
                        account: row.get(1)?,
                        first: row.get(2)?,
                        last: row.get(3)?,
                        messages: count(row.get(4)?),
                    })
                },
            )
            .optional()?)
    }

    /// The addresses of the `known` senders whose mail the burst's account
    /// shows, dated within it.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn known_during(&self, burst: &BurstRow) -> Result<Vec<String>, StoreError> {
        Ok(self
            .connection
            .prepare_cached(KNOWN_DURING)?
            .query_map(params![burst.account, burst.first, burst.last], |row| {
                row.get(0)
            })?
            .collect::<Result<_, _>>()?)
    }
}
