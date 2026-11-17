//! Bursts (the specification's 7.4): many messages in a short time from
//! senders never seen before, found for each account.
//!
//! - **A first contact** is a message from a sender whose first message
//!   the provider received less than 24 hours before it, and who was new to
//!   the person when it came: they had not written to it, or screened it in,
//!   before. It counts in each account whose mailboxes have shown it, junk
//!   and trash included, and mail deleted since: a flood the provider filed
//!   away, or the person threw away, was still a flood. It is **kept** when a
//!   mailbox of the account other than junk and trash has shown it.
//! - **A burst** is found where an account's first contacts in any 24 hours
//!   (a window that starts at one of them) are at least [`LEAST`], come from
//!   at least [`SENDERS_LEAST`] senders, and are at least [`TIMES`] times
//!   the median of its daily first contacts over the [`MEDIAN_DAYS`] days
//!   before. Windows that overlap are one burst, which holds every first
//!   contact in them, whatever its class. A few new senders' busy first
//!   day, such as a service the person has just joined, is no burst:
//!   blocking them is enough.
//! - **Days with no history are not quiet days.** Providers empty junk and
//!   trash, so a window is judged twice, and is a burst when either holds:
//!   on all its first contacts and their senders, against a median over the
//!   days from when every junk and trash mailbox's history starts (the
//!   latest of the account's earliest first contact and, for each junk and
//!   trash mailbox it had when first listed whole, the earlier of when the
//!   engine first listed it and its earliest first contact); and
//!   on its kept ones and their senders, against a median of kept ones over
//!   the days from the account's earliest kept one. A median needs
//!   [`COVERED_LEAST`] covered days before the window: a flood in an
//!   account's first month of history is no burst.
//! - **An account's bursts are found once it has been listed whole**: every
//!   mailbox it had then listed at least once. Not before, since sync
//!   fetches newest first and until then each sender's oldest message so far
//!   looks like its first; and not while a rebuild runs. First contacts and
//!   daily counts are kept meanwhile; the bursts are found when the last
//!   mailbox is first listed, or when a rebuild ends. A mailbox that
//!   appears later does not hold them back. `mail-status` names the accounts
//!   that wait.
//! - A burst's messages that are `unknown` or `bulk` and listed form its
//!   story ([`super::stories`]), in place of a queue entry or a stream story
//!   each; a `known` sender's mail is never in one.
//!
//! The thresholds are data, set here. [`RULE`] names the rule they make: a
//! store whose bursts another rule found finds them again when opened.
//!
//! Everything here is derived, so a rebuild gives the same rows. First
//! contacts are computed again for each sender a batch touches, and written
//! only where they changed; each account's counts for each day are counted
//! again for the days that changed. Each listed account a batch touched (a
//! first contact changed, or its junk or trash started or stopped showing
//! one) has its bursts found again from all its first contacts, which
//! an account holds thousands of, not hundreds of thousands; only the bursts
//! that changed are written. A mailbox that changes role, or turns sent,
//! has its accounts' first contacts made again. A burst's id is its
//! story's, made from its account and its first message's time: a burst
//! that grows back in time takes a new one, and the next rebuild drops the
//! old.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use rusqlite::{Connection, OptionalExtension, Transaction, params};

use super::{Kept, Store, StoreError, count};

/// A burst holds at least this many first contacts in a window.
pub const LEAST: i64 = 30;

/// A burst's window holds first contacts from at least this many senders.
pub const SENDERS_LEAST: i64 = 10;

/// A burst's window holds at least this many times the median day before.
pub const TIMES: i64 = 10;

/// The length of a burst's window, and how near a sender's first message a
/// first contact is, in milliseconds.
pub const WINDOW: i64 = 24 * 60 * 60 * 1000;

/// How many days before a window its median is taken over.
pub const MEDIAN_DAYS: i64 = 90;

/// How many of those days the history must cover for a window to be a
/// burst.
pub const COVERED_LEAST: i64 = 30;

/// A day, in milliseconds.
const DAY: i64 = 24 * 60 * 60 * 1000;

/// An hour, in milliseconds: the margin around a burst that the known
/// senders who wrote during it are read with.
const HOUR: i64 = 60 * 60 * 1000;

/// The rule that finds bursts. Raise it whenever what makes a burst
/// changes, a threshold above included.
///
/// The store refuses a build of an earlier schema, not of an earlier rule:
/// such a build that opens it finds the bursts of each account a batch
/// touches by its own rule, until a batch of this one touches the account
/// again. Raise it with a migration, which earlier builds refuse, once
/// builds of the earlier rule are in use. Rule 1, on messages alone, never
/// left its branch; rule 2 started a junk or trash mailbox's history at the
/// earliest first contact seen there alone, and rule 3, with migration 11,
/// at when the engine first listed it too.
pub(super) const RULE: i64 = 3;

/// The `engine_state` key that holds the [`RULE`] a store's bursts were
/// found by.
const RULE_KEY: &str = "burst-rule";

/// The `engine_state` key that marks a store whose mail was held before
/// bursts existed: they are found when it is next opened.
const FILL: &str = "burst-fill";

/// Whether the sender (a row of `sender`) of a message of `envelope` was
/// new to the person when the message came: they had not written to it,
/// nor screened it in, before. A sender they knew is no stranger, even one
/// they block later.
const NEW_WHEN_IT_CAME: &str = "(sender.first_written IS NULL
          OR sender.first_written > envelope.received)
     AND NOT EXISTS (SELECT 1 FROM sender_decision
                     WHERE sender_decision.address = sender.address
                       AND sender_decision.first_in_at < envelope.received)";

/// The first contacts the messages of `filter` give, each with whether a
/// mailbox other than junk and trash of its account has shown it.
fn contacts_sql(filter: &str) -> String {
    format!(
        "SELECT mailbox.account_id, envelope.message_id, envelope.sender_address,
                envelope.received, max(mailbox.role NOT IN ('junk', 'trash'))
         FROM sender
         JOIN envelope ON envelope.sender_address = sender.address
                      AND envelope.received < sender.first_received + {WINDOW}
         JOIN observation ON observation.message_id = envelope.message_id
         JOIN mailbox ON mailbox.id = observation.mailbox_id
         WHERE ({filter}) AND {NEW_WHEN_IT_CAME}
         GROUP BY mailbox.account_id, envelope.message_id"
    )
}

/// A sender's first contacts as they should be.
fn desired_sql() -> String {
    contacts_sql("sender.address = ?1")
}

/// A sender's first contacts as they are.
const CURRENT: &str = "SELECT account_id, message_id, sender_address, received, kept
     FROM first_contact WHERE sender_address = ?1";

/// An account's first contacts on one day, and how many are kept.
const ON_DAY: &str = "SELECT count(*), coalesce(sum(kept), 0) FROM first_contact
     WHERE account_id = ?1 AND received >= ?2 AND received < ?3";

/// An account's first contacts, in order.
const ALL: &str = "SELECT received, message_id, kept, sender_address FROM first_contact
     WHERE account_id = ?1 ORDER BY received, message_id";

/// An account's daily counts.
const DAYS: &str = "SELECT day, messages, kept FROM contact_day WHERE account_id = ?1";

/// An account's bursts and their messages.
const HELD: &str = "SELECT burst.id, burst.first, burst.last, burst_message.message_id
     FROM burst JOIN burst_message ON burst_message.burst_id = burst.id
     WHERE burst.account_id = ?1";

/// Where an account's history of all its first contacts starts: its
/// earliest, or later where a junk or trash mailbox's history starts. That
/// is, for a mailbox the account had when it was first listed whole, the
/// earlier of when the engine first listed it, since it has seen all that
/// came there since, and the earliest first contact it has seen there. A
/// mailbox that appeared later held nothing before it did, and sets none.
const COVERED_FROM: &str = "SELECT max(earliest) FROM (
         SELECT min(received) AS earliest FROM first_contact WHERE account_id = ?1
         UNION ALL
         SELECT min(mailbox.first_listed_at, coalesce(seen.earliest, mailbox.first_listed_at))
         FROM mailbox
         JOIN account ON account.id = mailbox.account_id
         LEFT JOIN (SELECT observation.mailbox_id AS id,
                           min(first_contact.received) AS earliest
                    FROM first_contact
                    CROSS JOIN observation ON observation.message_id = first_contact.message_id
                    WHERE first_contact.account_id = ?1
                    GROUP BY observation.mailbox_id) AS seen ON seen.id = mailbox.id
         WHERE mailbox.account_id = ?1 AND mailbox.role IN ('junk', 'trash')
           AND mailbox.first_listed_at <= account.listed_at)";

/// Where an account's history of its kept first contacts starts.
const KEPT_FROM: &str =
    "SELECT min(received) FROM first_contact WHERE account_id = ?1 AND kept = 1";

/// Whether every mailbox of an account still there has been listed once.
const ALL_LISTED: &str = "SELECT NOT EXISTS (SELECT 1 FROM mailbox
     WHERE account_id = ?1 AND gone_at IS NULL AND first_listed_at IS NULL)";

/// The accounts never listed whole yet.
const WAITING: &str = "SELECT id FROM account WHERE listed_at IS NULL ORDER BY id";

/// The accounts in whose junk or trash a first contact of theirs was shown:
/// where those mailboxes' histories start may have moved. Whether it is kept
/// comes through its sender.
const ACCOUNTS_OF: &str = "SELECT DISTINCT mailbox.account_id FROM observation
     JOIN mailbox ON mailbox.id = observation.mailbox_id
     JOIN first_contact ON first_contact.account_id = mailbox.account_id
                       AND first_contact.message_id = observation.message_id
     WHERE observation.message_id = ?1 AND mailbox.role IN ('junk', 'trash')";

/// The senders of messages of `temp.contact_target` within their first
/// day, and of those that were first contacts.
fn first_day_sql() -> String {
    format!(
        "SELECT envelope.sender_address FROM temp.contact_target
         CROSS JOIN envelope ON envelope.message_id = contact_target.message_id
         CROSS JOIN sender ON sender.address = envelope.sender_address
         WHERE envelope.received < sender.first_received + {WINDOW}
         UNION
         SELECT first_contact.sender_address FROM temp.contact_target
         CROSS JOIN first_contact ON first_contact.message_id = contact_target.message_id"
    )
}

/// The senders whose first contacts `messages` may change: the senders of
/// those within their sender's first day, and of those that were first
/// contacts. A message past its sender's first day changes none.
pub(super) fn first_day_senders(
    transaction: &Transaction<'_>,
    messages: &BTreeSet<i64>,
) -> Result<BTreeSet<String>, StoreError> {
    if messages.is_empty() {
        return Ok(BTreeSet::new());
    }
    transaction.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS contact_target (message_id INTEGER PRIMARY KEY);
         DELETE FROM temp.contact_target;",
    )?;
    {
        let mut insert =
            transaction.prepare_cached("INSERT OR IGNORE INTO temp.contact_target VALUES (?1)")?;
        for message in messages {
            insert.execute([message])?;
        }
    }
    Ok(transaction
        .prepare_cached(&first_day_sql())?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?)
}

/// The day a time falls in.
fn day_of(at: i64) -> i64 {
    at.div_euclid(DAY)
}

/// A first contact: its account, message, sender, when the provider
/// received it, and whether it is kept.
type Contact = (i64, i64, String, i64, bool);

/// Whether an account's bursts can be found: it was listed whole once,
/// every mailbox it had then listed at least once. Marks it so the first
/// time; a mailbox that appears later does not hold it back.
fn listed(transaction: &Transaction<'_>, account: i64) -> Result<bool, StoreError> {
    let marked: Option<Option<i64>> = transaction
        .one(
            "SELECT listed_at FROM account WHERE id = ?1",
            [account],
            |row| row.get(0),
        )
        .optional()?;
    match marked {
        Some(Some(_)) => Ok(true),
        // An account removed: what is left of it is found as it is.
        None => Ok(transaction.one(ALL_LISTED, [account], |row| row.get(0))?),
        Some(None) => {
            // Whole once every mailbox it has was listed, and one was: an
            // account with none, or whose mailboxes all went unlisted, waits.
            let whole: bool = transaction.one(ALL_LISTED, [account], |row| row.get(0))?
                && transaction.one(
                    "SELECT EXISTS (SELECT 1 FROM mailbox
                         WHERE account_id = ?1 AND first_listed_at IS NOT NULL)",
                    [account],
                    |row| row.get(0),
                )?;
            if whole {
                transaction.run(
                    "UPDATE account SET listed_at = coalesce(
                         (SELECT max(first_listed_at) FROM mailbox WHERE account_id = ?1), 0)
                     WHERE id = ?1",
                    [account],
                )?;
            }
            Ok(whole)
        }
    }
}

fn rebuilding(transaction: &Transaction<'_>) -> Result<bool, StoreError> {
    Ok(super::derived::rebuild_cursor(transaction)?.is_some())
}

/// Counts an account's first contacts on `day` again.
fn count_day(transaction: &Transaction<'_>, account: i64, day: i64) -> Result<(), StoreError> {
    let (messages, kept): (i64, i64) = transaction.one(
        ON_DAY,
        params![account, day * DAY, (day + 1) * DAY],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if messages == 0 {
        transaction.run(
            "DELETE FROM contact_day WHERE account_id = ?1 AND day = ?2",
            params![account, day],
        )?;
    } else {
        transaction.run(
            "INSERT INTO contact_day (account_id, day, messages, kept) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (account_id, day) DO UPDATE SET
                 messages = excluded.messages, kept = excluded.kept",
            params![account, day, messages, kept],
        )?;
    }
    Ok(())
}

/// Computes again the first contacts of `senders`, and the daily counts of
/// the days that changed; then the bursts of each listed account whose
/// first contacts changed or whose mailboxes started or stopped showing one
/// of `shown`. Returns the messages whose bursts changed, whose stories are
/// computed again.
pub(super) fn settle(
    transaction: &Transaction<'_>,
    senders: &BTreeSet<String>,
    shown: &BTreeSet<i64>,
) -> Result<BTreeSet<i64>, StoreError> {
    let mut days: BTreeSet<(i64, i64)> = BTreeSet::new();
    {
        let mut desired_statement = transaction.prepare_cached(&desired_sql())?;
        let mut current_statement = transaction.prepare_cached(CURRENT)?;
        let read = |row: &rusqlite::Row<'_>| -> rusqlite::Result<Contact> {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        };
        for sender in senders {
            let desired: BTreeSet<Contact> = desired_statement
                .query_map([sender], read)?
                .collect::<Result<_, _>>()?;
            let current: BTreeSet<Contact> = current_statement
                .query_map([sender], read)?
                .collect::<Result<_, _>>()?;
            for (account, message, _, received, _) in current.difference(&desired) {
                transaction.run(
                    "DELETE FROM first_contact WHERE account_id = ?1 AND message_id = ?2",
                    params![account, message],
                )?;
                days.insert((*account, day_of(*received)));
            }
            for (account, message, address, received, kept) in desired.difference(&current) {
                transaction.run(
                    "INSERT INTO first_contact (account_id, message_id, sender_address, received,
                                                kept)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT (account_id, message_id) DO UPDATE SET
                         sender_address = excluded.sender_address, received = excluded.received,
                         kept = excluded.kept",
                    params![account, message, address, received, kept],
                )?;
                days.insert((*account, day_of(*received)));
            }
        }
    }
    for (account, day) in &days {
        count_day(transaction, *account, *day)?;
    }
    // A rebuild finds every account's bursts when it ends.
    if rebuilding(transaction)? {
        return Ok(BTreeSet::new());
    }
    let mut accounts: BTreeSet<i64> = days.iter().map(|(account, _)| *account).collect();
    {
        let mut accounts_of = transaction.prepare_cached(ACCOUNTS_OF)?;
        for message in shown {
            for account in accounts_of.query_map([message], |row| row.get::<_, i64>(0))? {
                accounts.insert(account?);
            }
        }
    }
    let mut changed = BTreeSet::new();
    for account in accounts {
        changed.extend(find(transaction, account)?);
    }
    Ok(changed)
}

/// The medians of an account's daily first contacts over the covered days
/// before each day, worked out once a day.
struct Medians<'a> {
    counts: &'a BTreeMap<i64, i64>,
    /// The first day the history covers.
    covered_from: i64,
    known: BTreeMap<i64, Option<f64>>,
}

impl<'a> Medians<'a> {
    fn new(counts: &'a BTreeMap<i64, i64>, covered_from: i64) -> Self {
        Self {
            counts,
            covered_from,
            known: BTreeMap::new(),
        }
    }

    /// The median over the covered days of the [`MEDIAN_DAYS`] before `day`,
    /// days with no first contact counted as nothing; `None` when fewer
    /// than [`COVERED_LEAST`] of them are covered.
    fn of(&mut self, day: i64) -> Option<f64> {
        let (counts, covered_from) = (self.counts, self.covered_from);
        *self.known.entry(day).or_insert_with(|| {
            let mut days: Vec<i64> = ((day - MEDIAN_DAYS).max(covered_from)..day)
                .map(|before| counts.get(&before).copied().unwrap_or(0))
                .collect();
            if i64::try_from(days.len()).unwrap_or(0) < COVERED_LEAST.min(MEDIAN_DAYS) {
                return None;
            }
            days.sort_unstable();
            let middle = days.len() / 2;
            Some(if days.len().is_multiple_of(2) {
                (days[middle - 1] + days[middle]) as f64 / 2.0
            } else {
                days[middle] as f64
            })
        })
    }

    /// Whether `held` first contacts from `senders` senders, in a window
    /// that starts on `day`, pass the burst's thresholds.
    fn passes(&mut self, held: i64, senders: i64, day: i64) -> bool {
        held >= LEAST
            && senders >= SENDERS_LEAST
            && self
                .of(day)
                .is_some_and(|median| held as f64 >= TIMES as f64 * median)
    }
}

/// An account's first contact as a burst is found from: when the provider
/// received it, the message, whether it is kept, and its sender, numbered.
type Timed = (i64, i64, bool, usize);

/// The first contacts in a window and how many senders they come from,
/// counted as the window moves.
#[derive(Default)]
struct Window {
    of_sender: Vec<i64>,
    senders: i64,
}

impl Window {
    fn add(&mut self, sender: usize) {
        if self.of_sender.len() <= sender {
            self.of_sender.resize(sender + 1, 0);
        }
        self.of_sender[sender] += 1;
        if self.of_sender[sender] == 1 {
            self.senders += 1;
        }
    }

    fn remove(&mut self, sender: usize) {
        self.of_sender[sender] -= 1;
        if self.of_sender[sender] == 0 {
            self.senders -= 1;
        }
    }
}

/// The bursts in an account's first contacts, in order: each its first and
/// last time and its messages. `all` and `kept` judge a window's first
/// contacts and its kept ones.
fn bursts_in(
    contacts: &[Timed],
    all: &mut Medians<'_>,
    kept: &mut Medians<'_>,
) -> Vec<(i64, i64, Vec<i64>)> {
    // How many kept first contacts come before each one.
    let mut kept_before = Vec::with_capacity(contacts.len() + 1);
    kept_before.push(0_i64);
    for (_, _, is_kept, _) in contacts {
        kept_before.push(kept_before.last().copied().unwrap_or(0) + i64::from(*is_kept));
    }
    // The senders of the window's first contacts, and of its kept ones.
    let (mut senders, mut kept_senders) = (Window::default(), Window::default());
    let mut found: Vec<(usize, usize)> = Vec::new();
    let mut end = 0;
    for start in 0..contacts.len() {
        if start > 0 {
            let (_, _, was_kept, sender) = contacts[start - 1];
            senders.remove(sender);
            if was_kept {
                kept_senders.remove(sender);
            }
        }
        // A window always holds the first contact it starts at.
        while end < contacts.len() && contacts[end].0 < contacts[start].0 + WINDOW {
            let (_, _, is_kept, sender) = contacts[end];
            senders.add(sender);
            if is_kept {
                kept_senders.add(sender);
            }
            end += 1;
        }
        let held = i64::try_from(end - start).unwrap_or(i64::MAX);
        let held_kept = kept_before[end] - kept_before[start];
        let day = day_of(contacts[start].0);
        if !all.passes(held, senders.senders, day)
            && !kept.passes(held_kept, kept_senders.senders, day)
        {
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
                    .map(|(_, message, _, _)| *message)
                    .collect(),
            )
        })
        .collect()
}

/// A burst as found: its first and last time and its messages.
type Found = (i64, i64, BTreeSet<i64>);

/// Finds an account's bursts again from all its first contacts, none when
/// a mailbox of it has not been listed yet or a rebuild runs, and writes
/// those that changed. Returns the messages whose bursts changed.
fn find(transaction: &Transaction<'_>, account: i64) -> Result<BTreeSet<i64>, StoreError> {
    let mut new: BTreeMap<i64, Found> = BTreeMap::new();
    if listed(transaction, account)? && !rebuilding(transaction)? {
        let mut numbered: HashMap<String, usize> = HashMap::new();
        let mut contacts: Vec<Timed> = Vec::new();
        {
            let mut statement = transaction.prepare_cached(ALL)?;
            let rows = statement.query_map([account], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, bool>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?;
            for row in rows {
                let (received, message, kept, sender) = row?;
                let next = numbered.len();
                let sender = *numbered.entry(sender).or_insert(next);
                contacts.push((received, message, kept, sender));
            }
        }
        let mut all_counts = BTreeMap::new();
        let mut kept_counts = BTreeMap::new();
        {
            let mut statement = transaction.prepare_cached(DAYS)?;
            let rows = statement.query_map([account], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })?;
            for row in rows {
                let (day, messages, kept) = row?;
                all_counts.insert(day, messages);
                kept_counts.insert(day, kept);
            }
        }
        let covered_from: Option<i64> =
            transaction.one(COVERED_FROM, [account], |row| row.get(0))?;
        let kept_from: Option<i64> = transaction.one(KEPT_FROM, [account], |row| row.get(0))?;
        let mut all = Medians::new(&all_counts, covered_from.map_or(i64::MAX, day_of));
        let mut kept = Medians::new(&kept_counts, kept_from.map_or(i64::MAX, day_of));
        for (first, last, messages) in bursts_in(&contacts, &mut all, &mut kept) {
            let key = format!("burst {account} {first}");
            transaction.run("INSERT OR IGNORE INTO stream (key) VALUES (?1)", [&key])?;
            let id: i64 =
                transaction.one("SELECT id FROM stream WHERE key = ?1", [&key], |row| {
                    row.get(0)
                })?;
            new.insert(id, (first, last, messages.into_iter().collect()));
        }
    }
    let mut old: BTreeMap<i64, Found> = BTreeMap::new();
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
    let mut changed = BTreeSet::new();
    for (id, (_, _, messages)) in &old {
        if !new.contains_key(id) {
            transaction.run("DELETE FROM burst_message WHERE burst_id = ?1", [id])?;
            transaction.run("DELETE FROM burst WHERE id = ?1", [id])?;
            changed.extend(messages);
        }
    }
    for (id, (first, last, messages)) in &new {
        let was = old.get(id);
        if was.is_some_and(|(f, l, m)| (f, l, m) == (first, last, messages)) {
            continue;
        }
        transaction.run(
            "INSERT INTO burst (id, account_id, first, last, messages) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (id) DO UPDATE SET first = excluded.first, last = excluded.last,
                 messages = excluded.messages",
            params![
                id,
                account,
                first,
                last,
                i64::try_from(messages.len()).unwrap_or(i64::MAX)
            ],
        )?;
        let held = was.map(|(_, _, held)| held.clone()).unwrap_or_default();
        for message in held.difference(messages) {
            transaction.run(
                "DELETE FROM burst_message WHERE burst_id = ?1 AND message_id = ?2",
                params![id, message],
            )?;
            changed.insert(*message);
        }
        for message in messages.difference(&held) {
            transaction.run(
                "INSERT INTO burst_message (burst_id, message_id) VALUES (?1, ?2)",
                params![id, message],
            )?;
            changed.insert(*message);
        }
    }
    Ok(changed)
}

/// Finds the bursts again of every account that has first contacts or
/// bursts. Returns the messages whose bursts changed.
pub(super) fn find_all(transaction: &Transaction<'_>) -> Result<BTreeSet<i64>, StoreError> {
    let accounts: Vec<i64> = transaction
        .prepare("SELECT account_id FROM contact_day UNION SELECT account_id FROM burst")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    let mut changed = BTreeSet::new();
    for account in accounts {
        changed.extend(find(transaction, account)?);
    }
    Ok(changed)
}

/// After a mailbox of an account appeared, came back, went, or was listed
/// for the first time: its bursts may now be found, or wait. Returns the
/// messages whose bursts changed.
pub(super) fn listing_changed(
    transaction: &Transaction<'_>,
    account: i64,
) -> Result<BTreeSet<i64>, StoreError> {
    find(transaction, account)
}

/// Makes an account's first contacts and daily counts again from nothing,
/// or every account's with `None`, and finds its bursts: after a mailbox
/// changed role, and from nothing. Returns the messages whose bursts
/// changed.
pub(super) fn recompose(
    transaction: &Transaction<'_>,
    account: Option<i64>,
) -> Result<BTreeSet<i64>, StoreError> {
    let (only, bound) = match account {
        Some(account) => ("mailbox.account_id = ?1", account),
        None => ("?1 IS NOT NULL", 0),
    };
    let (rows, days) = match account {
        Some(_) => ("account_id = ?1", "account_id = ?1"),
        None => ("?1 IS NOT NULL", "?1 IS NOT NULL"),
    };
    transaction.execute(&format!("DELETE FROM first_contact WHERE {rows}"), [bound])?;
    transaction.execute(&format!("DELETE FROM contact_day WHERE {days}"), [bound])?;
    transaction.execute(
        &format!(
            "INSERT INTO first_contact (account_id, message_id, sender_address, received, kept)
             {}",
            contacts_sql(only)
        ),
        [bound],
    )?;
    transaction.execute(
        &format!(
            "INSERT INTO contact_day (account_id, day, messages, kept)
             SELECT account_id, received / {DAY} - (received % {DAY} < 0), count(*), sum(kept)
             FROM first_contact WHERE {rows} GROUP BY 1, 2"
        ),
        [bound],
    )?;
    match account {
        Some(account) => find(transaction, account),
        None => find_all(transaction),
    }
}

/// Finds every first contact and every burst from nothing: what a store
/// that held mail before bursts existed is given once, and what the tests
/// compare the rows a batch at a time gave with.
pub(super) fn compose_all(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    transaction.execute_batch("DELETE FROM burst_message; DELETE FROM burst;")?;
    recompose(transaction, None)?;
    Ok(())
}

/// Finds the bursts of the mail a store held before they existed, once,
/// when the store is opened after migration 10: each sender's row again
/// first, for when the person first wrote to it (which notes a change of
/// every sender, once), then the bursts, then the stories, which they
/// change.
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
    super::senders::settle_every_sender(&transaction, super::wall_clock())?;
    compose_all(&transaction)?;
    super::stories::compose_all(&transaction, super::wall_clock())?;
    transaction.execute("DELETE FROM engine_state WHERE key = ?1", [FILL])?;
    note_rule(&transaction)?;
    transaction.commit()?;
    Ok(())
}

/// Finds every account's bursts again, and the stories they change, when
/// the store's were found by another [`RULE`] than this one. A rebuild
/// that runs finds them by this one when it ends.
pub(super) fn find_if_rule_changed(connection: &mut Connection) -> Result<(), StoreError> {
    let found_by: Option<i64> = connection
        .query_row(
            "SELECT value FROM engine_state WHERE key = ?1",
            [RULE_KEY],
            |row| row.get(0),
        )
        .optional()?;
    if found_by == Some(RULE) {
        return Ok(());
    }
    let transaction = connection.transaction()?;
    if !rebuilding(&transaction)? {
        let changed = find_all(&transaction)?;
        super::stories::settle(&transaction, &changed, super::wall_clock())?;
    }
    note_rule(&transaction)?;
    transaction.commit()?;
    Ok(())
}

/// Notes that the store's bursts are found by this [`RULE`].
fn note_rule(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    transaction.run(
        "INSERT INTO engine_state (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params![RULE_KEY, RULE],
    )?;
    Ok(())
}

/// What a rebuild throws away of bursts: it finds them again a batch at a
/// time, and every account's bursts when it ends.
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
        ("first day", first_day_sql()),
        ("current", CURRENT.to_string()),
        ("on day", ON_DAY.to_string()),
        ("days", DAYS.to_string()),
        ("all", ALL.to_string()),
        ("held", HELD.to_string()),
        ("covered from", COVERED_FROM.to_string()),
        ("kept from", KEPT_FROM.to_string()),
        ("listed", ALL_LISTED.to_string()),
        ("accounts of", ACCOUNTS_OF.to_string()),
        ("known during", known_during_sql()),
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
    /// When the provider received its first first contact.
    pub first: i64,
    /// When the provider received its last first contact.
    pub last: i64,
    /// Its first contacts, whatever their class.
    pub messages: u64,
}

/// The `known` senders whose mail an account's lists show, received
/// within an hour of a burst: those a flood may have been sent to hide
/// (7.4). Read from the known mail dated within a day of it, whose received
/// time is then compared: a known message whose Date header is more than a
/// day off its received time is not read.
fn known_during_sql() -> String {
    format!(
        "SELECT DISTINCT screening.sender_address FROM screening
         JOIN envelope ON envelope.message_id = screening.message_id
         WHERE screening.class = 'known' AND screening.listed = 1
           AND screening.date >= ?2 - {DAY} AND screening.date <= ?3 + {DAY}
           AND envelope.received >= ?2 - {HOUR} AND envelope.received <= ?3 + {HOUR}
           AND EXISTS (SELECT 1 FROM observation
                       JOIN mailbox ON mailbox.id = observation.mailbox_id
                       WHERE observation.message_id = screening.message_id
                         AND mailbox.account_id = ?1)
         ORDER BY screening.sender_address"
    )
}

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

    /// The accounts whose bursts wait for a mailbox to be listed once.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn accounts_waiting_for_bursts(&self) -> Result<Vec<i64>, StoreError> {
        Ok(self
            .connection
            .prepare_cached(WAITING)?
            .query_map([], |row| row.get(0))?
            .collect::<Result<_, _>>()?)
    }

    /// The addresses of the `known` senders whose mail the burst's account
    /// shows, dated within it.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn known_during(&self, burst: &BurstRow) -> Result<Vec<String>, StoreError> {
        Ok(self
            .connection
            .prepare_cached(&known_during_sql())?
            .query_map(params![burst.account, burst.first, burst.last], |row| {
                row.get(0)
            })?
            .collect::<Result<_, _>>()?)
    }
}

/// [`bursts_in`] against counting every window from nothing, on random
/// first contacts: ties, few senders and many, kept and not, and busy days.
#[cfg(test)]
#[test]
fn bursts_in_gives_what_counting_each_window_whole_gives() {
    let mut state = 0x2545_f491_4f6c_dd1d_u64;
    let mut below = |n: u64| {
        state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (state >> 33) % n.max(1)
    };
    let start = 20_000 * DAY;
    let mut found = 0;
    for _ in 0..2_000 {
        let n = below(160);
        let senders = 1 + below(30);
        // Times ten minutes apart at the finest, so that some tie.
        let mut contacts: Vec<Timed> = (0..n)
            .map(|i| {
                let at = start + i64::try_from(below(6 * 24 * 6)).unwrap_or(0) * 600_000;
                let sender = usize::try_from(below(senders)).unwrap_or(0);
                (at, i64::try_from(i).unwrap_or(0), below(3) != 0, sender)
            })
            .collect();
        contacts.sort_unstable();
        // A median of none, or of a few a day.
        let busy = |median: i64| -> BTreeMap<i64, i64> {
            (day_of(start) - 200..day_of(start) + 10)
                .map(|day| (day, median))
                .collect()
        };
        let (all_median, kept_median) = (
            i64::try_from(below(4)).unwrap_or(0),
            i64::try_from(below(4)).unwrap_or(0),
        );
        let (all_counts, kept_counts) = (busy(all_median), busy(kept_median));
        let covered_from = day_of(start) - 200;
        let got = bursts_in(
            &contacts,
            &mut Medians::new(&all_counts, covered_from),
            &mut Medians::new(&kept_counts, covered_from),
        );
        // Each window counted whole.
        let passes = |held: usize, senders: usize, median: i64| {
            let (held, senders) = (
                i64::try_from(held).unwrap_or(0),
                i64::try_from(senders).unwrap_or(0),
            );
            held >= LEAST && senders >= SENDERS_LEAST && held >= TIMES * median
        };
        let mut want: Vec<(usize, usize)> = Vec::new();
        for first in 0..contacts.len() {
            let window: Vec<&Timed> = contacts[first..]
                .iter()
                .take_while(|contact| contact.0 < contacts[first].0 + WINDOW)
                .collect();
            let all_senders: BTreeSet<usize> = window.iter().map(|contact| contact.3).collect();
            let kept: Vec<&&Timed> = window.iter().filter(|contact| contact.2).collect();
            let kept_senders: BTreeSet<usize> = kept.iter().map(|contact| contact.3).collect();
            if !passes(window.len(), all_senders.len(), all_median)
                && !passes(kept.len(), kept_senders.len(), kept_median)
            {
                continue;
            }
            let end = first + window.len();
            match want.last_mut() {
                Some(last) if first < last.1 => last.1 = last.1.max(end),
                _ => want.push((first, end)),
            }
        }
        let want: Vec<(i64, i64, Vec<i64>)> = want
            .into_iter()
            .map(|(first, end)| {
                (
                    contacts[first].0,
                    contacts[end - 1].0,
                    contacts[first..end]
                        .iter()
                        .map(|contact| contact.1)
                        .collect(),
                )
            })
            .collect();
        found += want.len();
        assert_eq!(got, want);
    }
    // The random cases hold bursts, not only windows that fail.
    assert!(found > 100, "{found} bursts");
}
