//! Stream stories (the specification's section 8): the `bulk` mail a
//! mailbox other than junk and trash shows, one story for each list, or for
//! each sender where there is no list, from its fifth message.
//!
//! A story is a view: its messages are still in every list they were in.
//! Its template keys and body shapes do not split it. They mark what is not
//! routine in it:
//!
//! - **Its kinds** are its template keys, each with how many of its
//!   messages hold it, so a sender that sends receipts, offers and alerts
//!   from one address does not hide one in a single total.
//! - **Its exceptions** are the messages whose body shape is not one of its
//!   usual ones: a shape at least five of its messages have. A story with
//!   no usual shape has no exceptions, since nothing in it is routine to
//!   differ from, and a message whose body is not held yet has no shape.
//!
//! Every row is derived, so a rebuild gives the same rows. A story depends
//! on its members' screening rows and envelopes, so the messages whose class
//! or place in the lists changed, and those derived again, have their
//! membership computed again, and each story a member left, joined or
//! changed in is noted in `change` for `mail-story-changes`.
//!
//! Unlike a class or a sender's row, a story's counts are kept by what each
//! batch changed rather than counted again: a story of a large folder holds
//! hundreds of thousands of messages, too many to count for each batch. The
//! tests compare them with making every story from nothing after each change
//! and across a rebuild; and a count that a batch would take below nothing,
//! or a row whose members are not what it says, is a story counted wrong,
//! which is counted again whole from its members, and counted in
//! `engine_state` so that `mail-status` shows it, rather than left to stop
//! sync.
//!
//! A story's id is its stream's, from `stream`, which is not derived: an id
//! once given to a list or a sender is kept, so a rebuild gives the story
//! the same one and no two streams share one.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, Transaction, params};

use super::read::{LISTED, listed};
use super::{Kept, MessageId, MessageListed, Store, StoreError, count, note_change};

/// A stream is a story from this many messages.
pub const LEAST_MESSAGES: i64 = 5;

/// A body shape is one of a story's usual ones from this many messages.
pub const USUAL_SHAPE: i64 = 5;

/// How many of a story's kinds its card names, the most common first.
pub const KINDS_SHOWN: u32 = 10;

/// The `engine_state` key that marks a store whose mail was held before
/// stories existed: they are filled when it is next opened.
const FILL: &str = "story-fill";

/// The `engine_state` key of how many times a batch found a story counted
/// wrong and counted it again whole ([`count_story`]): a bug if ever above
/// nothing, shown by `mail-status`.
const RECOUNTS: &str = "story-recounts";

/// The `engine_state` key of the stories' epoch: a number that grows by a
/// random step whenever every story is thrown away (a rebuild), which a
/// cursor of `mail-story-changes` carries, so a cursor from before is told
/// to read the stories again, as one from another store most likely is.
const EPOCH: &str = "story-epoch";

/// The stream a message of `envelope` belongs to: its list, or else its
/// sender. As step C1 grouped it.
const STREAM: &str = "CASE WHEN envelope.list_id <> '' THEN 'list ' || envelope.list_id
     ELSE 'sender ' || envelope.sender_address END";

/// The bulk messages of `temp.story_target` that a mailbox other than junk
/// and trash shows, with their envelopes.
const TARGET_MEMBERS: &str = "FROM temp.story_target
     CROSS JOIN screening ON screening.message_id = story_target.message_id
     CROSS JOIN envelope ON envelope.message_id = story_target.message_id
     WHERE screening.class = 'bulk' AND screening.listed = 1";

/// Gives each new stream of `members` (rows of `envelope`) its id. Only a
/// key not there yet is inserted: an insert ignored would still use up an
/// id.
fn new_streams_sql(members: &str) -> String {
    format!(
        "INSERT INTO stream (key)
         SELECT DISTINCT member_stream FROM (SELECT {STREAM} AS member_stream {members})
         WHERE NOT EXISTS (SELECT 1 FROM stream WHERE stream.key = member_stream)"
    )
}

/// Gives each new stream of the target's members its id.
fn streams_sql() -> String {
    new_streams_sql(TARGET_MEMBERS)
}

/// The bulk messages a mailbox other than junk and trash shows, all of
/// them, as [`compose_all`] reads them.
const EVERY_MEMBER: &str =
    "FROM screening JOIN envelope ON envelope.message_id = screening.message_id
     WHERE screening.class = 'bulk' AND screening.listed = 1";

/// The membership of each message of `temp.story_target`, as it should be;
/// returns each member made or changed.
fn member_sql() -> String {
    format!(
        "INSERT INTO story_member (message_id, story_id, date, template_key, body_shape, exception)
         SELECT envelope.message_id, (SELECT id FROM stream WHERE stream.key = {STREAM}),
                envelope.date, envelope.template_key, envelope.body_shape, 0
         {TARGET_MEMBERS}
         ON CONFLICT (message_id) DO UPDATE SET
             story_id = excluded.story_id, date = excluded.date,
             template_key = excluded.template_key, body_shape = excluded.body_shape
         WHERE story_member.story_id <> excluded.story_id OR story_member.date <> excluded.date
            OR story_member.template_key IS NOT excluded.template_key
            OR story_member.body_shape IS NOT excluded.body_shape
         RETURNING message_id, story_id, body_shape, template_key, 0"
    )
}

/// What the messages of `temp.story_target` were in before.
const BEFORE: &str = "SELECT message_id, story_id, body_shape, template_key, exception
     FROM story_member WHERE message_id IN (SELECT message_id FROM temp.story_target)";

/// The messages of `temp.story_target` that are no longer bulk mail a
/// mailbox other than junk and trash shows.
const REMOVE: &str = "DELETE FROM story_member
     WHERE message_id IN (SELECT message_id FROM temp.story_target)
       AND NOT EXISTS (SELECT 1 FROM screening
                       WHERE screening.message_id = story_member.message_id
                         AND screening.class = 'bulk' AND screening.listed = 1)
     RETURNING message_id, story_id, body_shape, template_key, exception";

/// The stories whose newest member is in `temp.story_target`, whose title
/// it gives: a message derived again may bring another name.
const NEWEST_IN_TARGET: &str = "SELECT DISTINCT story_member.story_id FROM temp.story_target
     CROSS JOIN story_member ON story_member.message_id = story_target.message_id
     WHERE story_member.message_id =
         (SELECT newest.message_id FROM story_member AS newest
          WHERE newest.story_id = story_member.story_id
          ORDER BY newest.date DESC, newest.message_id DESC LIMIT 1)";

/// Whether a member of `story_member` is an exception: it has a body
/// shape, its story has a usual one (its row counts them), and its own is
/// not.
fn exception_expression() -> String {
    format!(
        "(story_member.body_shape IS NOT NULL
          AND coalesce((SELECT usual FROM story WHERE story.id = story_member.story_id), 0) > 0
          AND NOT EXISTS (SELECT 1 FROM story_shape AS own
                          WHERE own.story_id = story_member.story_id
                            AND own.shape = story_member.body_shape
                            AND own.messages >= {USUAL_SHAPE}))"
    )
}

/// What [`except_sql`] selects by: the messages a batch changed; a story's
/// members with one shape, all of them when the shape stopped being usual
/// and its exceptions alone when it became usual; or a story's members with
/// a shape, all when it gained its first usual shape and its exceptions
/// alone when it lost its last (one without a shape is never an exception).
/// The exceptions are read from their own index, the rest from the story's
/// range of the index by date, which holds each member's shape.
const EXCEPT_TARGET: &str = "story_member.message_id IN (SELECT message_id FROM temp.story_target)";
const EXCEPT_SHAPE: &str = "story_member.story_id = ?1 AND story_member.body_shape = ?2";
const EXCEPT_SHAPE_USUAL: &str =
    "story_member.story_id = ?1 AND story_member.exception = 1 AND story_member.body_shape = ?2";
const EXCEPT_STORY: &str = "story_member.story_id = ?1 AND story_member.body_shape IS NOT NULL";
const EXCEPT_STORY_NONE: &str = "story_member.story_id = ?1 AND story_member.exception = 1";

/// The statement that computes `exception` again for the members `filter`
/// selects, and returns each member it changed.
fn except_sql(filter: &str) -> String {
    let exception = exception_expression();
    format!(
        "UPDATE story_member SET exception = {exception}
         WHERE ({filter}) AND exception <> {exception}
         RETURNING message_id, story_id, exception"
    )
}

/// Sets a stream's count of usual shapes before its exceptions are
/// computed, making a row to be filled in later when it has none.
const SET_USUAL: &str = "INSERT INTO story (id, kind, list_id, sender_address, title, messages,
                        exceptions, kinds, usual, first_date, last_date)
     VALUES (?1, 'stream', '', '', '', 1, 0, 0, ?2, 0, 0)
     ON CONFLICT (id) DO UPDATE SET usual = excluded.usual";

/// A story's first and last dates, each read from one end of an index.
const FIRST: &str = "SELECT min(date) FROM story_member WHERE story_id = ?1";
const LAST: &str = "SELECT max(date) FROM story_member WHERE story_id = ?1";

/// A story's newest member, which names it.
const NEWEST: &str = "SELECT envelope.list_id, envelope.sender_address, envelope.sender_name
     FROM story_member JOIN envelope ON envelope.message_id = story_member.message_id
     WHERE story_member.story_id = ?1
     ORDER BY story_member.date DESC, story_member.message_id DESC LIMIT 1";

/// A member's story and whether it is an exception.
const MEMBER: &str = "SELECT story_id, exception FROM story_member WHERE message_id = ?1";

/// A member's story, shape, template key and whether it is an exception.
type Membership = (i64, Option<Vec<u8>>, Option<Vec<u8>>, bool);

/// The rows `sql` returns: a message, then its membership. The upsert
/// returns no exception, which its member has none of until computed.
fn memberships(
    transaction: &Transaction<'_>,
    sql: &str,
) -> Result<Vec<(i64, Membership)>, StoreError> {
    let mut statement = transaction.prepare_cached(sql)?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get(0)?,
            (row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?),
        ))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// What a batch changed of stories: how many members each story, each of
/// its shapes and each of its template keys gained or lost, and how many
/// exceptions each story gained or lost.
#[derive(Debug, Default)]
struct Deltas {
    /// Stories whose row is written again: those a member left, joined or
    /// changed in, and those whose newest member was derived again.
    stories: BTreeSet<i64>,
    /// Stories a member left, joined or changed in.
    moved: BTreeSet<i64>,
    messages: BTreeMap<i64, i64>,
    exceptions: BTreeMap<i64, i64>,
    kinds: BTreeMap<i64, i64>,
    shapes: BTreeMap<(i64, Vec<u8>), i64>,
    templates: BTreeMap<(i64, Vec<u8>), i64>,
}

impl Deltas {
    /// Counts a member out of (`by` -1) or into (`by` 1) a membership.
    fn count(&mut self, (story, shape, kind, exception): &Membership, by: i64) {
        self.stories.insert(*story);
        self.moved.insert(*story);
        *self.messages.entry(*story).or_default() += by;
        if *exception {
            *self.exceptions.entry(*story).or_default() += by;
        }
        if let Some(shape) = shape {
            *self.shapes.entry((*story, shape.clone())).or_default() += by;
        }
        if let Some(kind) = kind {
            *self.templates.entry((*story, kind.clone())).or_default() += by;
        }
    }
}

/// Runs a statement of [`except_sql`], adding each member it changed, with
/// its story and its exception now, to `out`.
fn flips(
    transaction: &Transaction<'_>,
    sql: &str,
    bound: impl rusqlite::Params,
    out: &mut Vec<(i64, i64, bool)>,
) -> Result<(), StoreError> {
    let mut statement = transaction.prepare_cached(sql)?;
    let rows = statement.query_map(bound, |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
    for row in rows {
        out.push(row?);
    }
    Ok(())
}

/// Fills `temp.story_target` with `messages`.
fn load_target(transaction: &Transaction<'_>, messages: &BTreeSet<i64>) -> Result<(), StoreError> {
    transaction.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS story_target (message_id INTEGER PRIMARY KEY);
         DELETE FROM temp.story_target;",
    )?;
    let mut insert =
        transaction.prepare_cached("INSERT OR IGNORE INTO temp.story_target VALUES (?1)")?;
    for message in messages {
        insert.execute([message])?;
    }
    Ok(())
}

/// Adds `by` to one shape's or template key's count in a story in
/// `table`, in one statement, and returns the count before and after. A
/// count that reaches nothing is removed. The row a count that falls is
/// in exists already; the value inserted is kept within the table's check,
/// which SQLite reads before it finds the row.
fn add_count(
    transaction: &Transaction<'_>,
    table: &str,
    column: &str,
    (story, value): &(i64, Vec<u8>),
    by: i64,
) -> Result<(i64, i64), StoreError> {
    let after: i64 = transaction.one(
        &format!(
            "INSERT INTO {table} (story_id, {column}, messages) VALUES (?1, ?2, max(?3, 0))
             ON CONFLICT (story_id, {column}) DO UPDATE SET messages = messages + ?3
             RETURNING messages"
        ),
        params![story, value, by],
        |row| row.get(0),
    )?;
    if after <= 0 {
        transaction.run(
            &format!("DELETE FROM {table} WHERE story_id = ?1 AND {column} = ?2"),
            params![story, value],
        )?;
    }
    Ok((after - by, after))
}

/// A stream's row: its list, sender, title, counts and dates.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Row {
    list_id: String,
    sender_address: String,
    title: String,
    messages: i64,
    exceptions: i64,
    kinds: i64,
    /// Its shapes that are usual: held by at least five of its messages.
    usual: i64,
    first_date: i64,
    last_date: i64,
}

/// What [`row_with`] counts of a stream: its messages, exceptions, kinds
/// and usual shapes.
#[derive(Debug, Clone, Copy, Default)]
struct Counts {
    messages: i64,
    exceptions: i64,
    kinds: i64,
    usual: i64,
}

impl Row {
    fn is_story(&self) -> bool {
        self.messages >= LEAST_MESSAGES
    }
}

/// A stream's row as it is stored, if it has one.
fn stored_row(transaction: &Transaction<'_>, story: i64) -> Result<Option<Row>, StoreError> {
    Ok(transaction
        .one(
            "SELECT list_id, sender_address, title, messages, exceptions, kinds, usual,
                    first_date, last_date
             FROM story WHERE id = ?1",
            [story],
            |row| {
                Ok(Row {
                    list_id: row.get(0)?,
                    sender_address: row.get(1)?,
                    title: row.get(2)?,
                    messages: row.get(3)?,
                    exceptions: row.get(4)?,
                    kinds: row.get(5)?,
                    usual: row.get(6)?,
                    first_date: row.get(7)?,
                    last_date: row.get(8)?,
                })
            },
        )
        .optional()?)
}

/// A stream's row with the counts given: its dates read from the ends of
/// its index, and its title from its newest member.
fn row_with(
    transaction: &Transaction<'_>,
    story: i64,
    counts: Counts,
) -> Result<Option<Row>, StoreError> {
    let first: Option<i64> = transaction.one(FIRST, [story], |row| row.get(0))?;
    let last: Option<i64> = transaction.one(LAST, [story], |row| row.get(0))?;
    let Some((list_id, address, name)) = transaction
        .one(NEWEST, [story], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .optional()?
    else {
        return Ok(None);
    };
    let title = if !list_id.is_empty() {
        list_id.clone()
    } else if !name.trim().is_empty() {
        name
    } else {
        address.clone()
    };
    Ok(Some(Row {
        list_id,
        sender_address: address,
        title,
        messages: counts.messages,
        exceptions: counts.exceptions,
        kinds: counts.kinds,
        usual: counts.usual,
        first_date: first.unwrap_or(0),
        last_date: last.unwrap_or(0),
    }))
}

/// Writes a stream's row, or removes it when it has no members. Returns
/// whether a story changed: one that is a story, was one, or both, and
/// whose row is not what it was.
fn write_row(
    transaction: &Transaction<'_>,
    story: i64,
    old: Option<&Row>,
    new: Option<&Row>,
) -> Result<bool, StoreError> {
    match new {
        // A row made only to hold the count of usual shapes goes too.
        None => {
            transaction.run("DELETE FROM story WHERE id = ?1", [story])?;
            if old.is_none() {
                return Ok(false);
            }
        }
        Some(_) if old == new => return Ok(false),
        Some(row) => {
            transaction.run(
                "INSERT INTO story (id, kind, list_id, sender_address, title, messages, exceptions,
                                    kinds, usual, first_date, last_date)
                 VALUES (?1, 'stream', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT (id) DO UPDATE SET
                     list_id = excluded.list_id, sender_address = excluded.sender_address,
                     title = excluded.title, messages = excluded.messages,
                     exceptions = excluded.exceptions, kinds = excluded.kinds,
                     usual = excluded.usual, first_date = excluded.first_date,
                     last_date = excluded.last_date",
                params![
                    story,
                    row.list_id,
                    row.sender_address,
                    row.title,
                    row.messages,
                    row.exceptions,
                    row.kinds,
                    row.usual,
                    row.first_date,
                    row.last_date
                ],
            )?;
        }
    }
    Ok(old.is_some_and(Row::is_story) || new.is_some_and(Row::is_story))
}

/// Counts a story again whole from its members, as [`compose_all`] does for
/// every story: its shapes and template keys, its usual shapes, each
/// member's exception, and its row. What a batch does when it finds the
/// story counted wrong; each time is counted in `engine_state`. Returns the
/// row, or none when the stream has no members.
fn count_story(transaction: &Transaction<'_>, story: i64) -> Result<Option<Row>, StoreError> {
    transaction.run(
        "UPDATE engine_state SET value = value + 1 WHERE key = ?1",
        [RECOUNTS],
    )?;
    transaction.run(
        "INSERT OR IGNORE INTO engine_state (key, value) VALUES (?1, 1)",
        [RECOUNTS],
    )?;
    for (table, column, member) in [
        ("story_shape", "shape", "body_shape"),
        ("story_kind", "template_key", "template_key"),
    ] {
        transaction.run(&format!("DELETE FROM {table} WHERE story_id = ?1"), [story])?;
        transaction.run(
            &format!(
                "INSERT INTO {table} (story_id, {column}, messages)
                 SELECT story_id, {member}, count(*) FROM story_member
                 WHERE story_id = ?1 AND {member} IS NOT NULL GROUP BY {member}"
            ),
            [story],
        )?;
    }
    let one = |sql: &str| -> Result<i64, StoreError> {
        Ok(transaction.one(sql, [story], |row| row.get(0))?)
    };
    let messages = one("SELECT count(*) FROM story_member WHERE story_id = ?1")?;
    if messages == 0 {
        transaction.run("DELETE FROM story WHERE id = ?1", [story])?;
        return Ok(None);
    }
    let usual = one(&format!(
        "SELECT count(*) FROM story_shape WHERE story_id = ?1 AND messages >= {USUAL_SHAPE}"
    ))?;
    transaction.run(SET_USUAL, params![story, usual])?;
    transaction.run(&except_whole_sql(), [story])?;
    let counts = Counts {
        messages,
        exceptions: one("SELECT count(*) FROM story_member WHERE story_id = ?1 AND exception = 1")?,
        kinds: one("SELECT count(*) FROM story_kind WHERE story_id = ?1")?,
        usual,
    };
    let row = row_with(transaction, story, counts)?;
    write_row(transaction, story, None, row.as_ref())?;
    Ok(row)
}

/// The statement that computes `exception` again for every member of a
/// story, as [`count_story`] needs.
fn except_whole_sql() -> String {
    let exception = exception_expression();
    format!(
        "UPDATE story_member SET exception = {exception}
         WHERE story_member.story_id = ?1 AND exception <> {exception}"
    )
}

/// Computes again the membership of `messages`, then the counts,
/// exceptions and rows of every story a member left, joined or changed in,
/// and notes each story that changed.
///
/// A story's counts are kept by what each batch changed, not counted again:
/// a story of a large folder holds hundreds of thousands of messages, and
/// counting them for each batch halved the import rate. The tests compare
/// them, after each change, with making every story from nothing.
pub(super) fn settle(
    transaction: &Transaction<'_>,
    messages: &BTreeSet<i64>,
    now: i64,
) -> Result<(), StoreError> {
    if messages.is_empty() {
        return Ok(());
    }
    load_target(transaction, messages)?;
    let before: HashMap<i64, Membership> = memberships(transaction, BEFORE)?.into_iter().collect();
    let removed = memberships(transaction, REMOVE)?;
    transaction.run(&streams_sql(), [])?;
    let written = memberships(transaction, &member_sql())?;
    // Only the members that left, joined or changed count: the rest of the
    // target is as it was. A written member is counted into its story once
    // its exception is known, below.
    let mut deltas = Deltas::default();
    let mut moved: HashSet<i64> = HashSet::new();
    for (message, was_in) in &removed {
        moved.insert(*message);
        deltas.count(was_in, -1);
    }
    for (message, now_in) in &written {
        moved.insert(*message);
        if let Some(was_in) = before.get(message) {
            deltas.count(was_in, -1);
        }
        deltas.count(&(now_in.0, now_in.1.clone(), now_in.2.clone(), false), 1);
    }
    {
        let mut statement = transaction.prepare_cached(NEWEST_IN_TARGET)?;
        let newest = statement.query_map([], |row| row.get::<_, i64>(0))?;
        for story in newest {
            deltas.stories.insert(story?);
        }
    }
    if deltas.stories.is_empty() {
        return Ok(());
    }
    // Every row as it was, before anything of this batch is written.
    let mut old_rows = BTreeMap::new();
    for story in &deltas.stories {
        old_rows.insert(*story, stored_row(transaction, *story)?);
    }
    let usual_of = |story: &i64| {
        old_rows
            .get(story)
            .and_then(Option::as_ref)
            .map_or(0, |row: &Row| row.usual)
    };
    let mut usual: BTreeMap<i64, i64> = BTreeMap::new();
    let mut turned = Vec::new();
    // Stories counted wrong, which are counted again whole below.
    let mut drifted = BTreeSet::new();
    for (pair, by) in &deltas.shapes {
        if *by == 0 {
            continue;
        }
        let (before, after) = add_count(transaction, "story_shape", "shape", pair, *by)?;
        if after < 0 {
            drifted.insert(pair.0);
        }
        if (before >= USUAL_SHAPE) != (after >= USUAL_SHAPE) {
            turned.push((pair, after >= USUAL_SHAPE));
            *usual.entry(pair.0).or_insert_with(|| usual_of(&pair.0)) +=
                if after >= USUAL_SHAPE { 1 } else { -1 };
        }
    }
    // The exceptions below read each story's count of usual shapes.
    for (story, count) in &usual {
        transaction.run(SET_USUAL, params![story, count])?;
    }
    let mut kinds = BTreeMap::new();
    for (pair, by) in &deltas.templates {
        if *by == 0 {
            continue;
        }
        let (before, after) = add_count(transaction, "story_kind", "template_key", pair, *by)?;
        if after < 0 {
            drifted.insert(pair.0);
        }
        *kinds.entry(pair.0).or_insert(0) += i64::from(after > 0) - i64::from(before > 0);
    }
    deltas.kinds = kinds;
    // A story that gained its first usual shape, or lost its last, has
    // every shaped member's exception computed again; a shape that became
    // usual, or stopped being, has its members'; and the messages changed
    // have theirs. A member that moved is counted below, from where it is
    // now; any other whose exception turned counts here.
    let mut flipped_exceptions = Vec::new();
    let mut flipped = BTreeSet::new();
    for (story, after) in &usual {
        if (*after > 0) != (usual_of(story) > 0) {
            flipped.insert(*story);
            let filter = if *after > 0 {
                EXCEPT_STORY
            } else {
                EXCEPT_STORY_NONE
            };
            flips(
                transaction,
                &except_sql(filter),
                [story],
                &mut flipped_exceptions,
            )?;
        }
    }
    for ((story, shape), became_usual) in turned {
        if !flipped.contains(story) {
            let filter = if became_usual {
                EXCEPT_SHAPE_USUAL
            } else {
                EXCEPT_SHAPE
            };
            flips(
                transaction,
                &except_sql(filter),
                params![story, shape],
                &mut flipped_exceptions,
            )?;
        }
    }
    flips(
        transaction,
        &except_sql(EXCEPT_TARGET),
        [],
        &mut flipped_exceptions,
    )?;
    for (message, story, exception) in flipped_exceptions {
        if !moved.contains(&message) {
            *deltas.exceptions.entry(story).or_default() += if exception { 1 } else { -1 };
        }
    }
    {
        let mut member = transaction.prepare_cached(MEMBER)?;
        for (message, _) in &written {
            let (story, exception): (i64, bool) =
                member.query_row([message], |row| Ok((row.get(0)?, row.get(1)?)))?;
            if exception {
                *deltas.exceptions.entry(story).or_default() += 1;
            }
        }
    }
    for story in &deltas.stories {
        let old = old_rows.get(story).and_then(Option::as_ref);
        let was = old.map_or(Counts::default(), |row| Counts {
            messages: row.messages,
            exceptions: row.exceptions,
            kinds: row.kinds,
            usual: row.usual,
        });
        let delta = |map: &BTreeMap<i64, i64>| map.get(story).copied().unwrap_or(0);
        let counts = Counts {
            messages: was.messages + delta(&deltas.messages),
            exceptions: was.exceptions + delta(&deltas.exceptions),
            kinds: was.kinds + delta(&deltas.kinds),
            usual: usual.get(story).copied().unwrap_or(was.usual),
        };
        let counted_wrong = drifted.contains(story)
            || counts.messages < 0
            || counts.exceptions < 0
            || counts.kinds < 0
            || counts.usual < 0
            || counts.exceptions > counts.messages;
        let new = if counted_wrong {
            None
        } else if counts.messages > 0 {
            // A row that counts members its story has none of is wrong.
            match row_with(transaction, *story, counts)? {
                Some(row) => Some(row),
                None => {
                    drifted.insert(*story);
                    None
                }
            }
        } else {
            let members: bool = transaction.one(
                "SELECT EXISTS (SELECT 1 FROM story_member WHERE story_id = ?1)",
                [story],
                |row| row.get(0),
            )?;
            if members {
                drifted.insert(*story);
            }
            None
        };
        if counted_wrong || drifted.contains(story) {
            let new = count_story(transaction, *story)?;
            if old != new.as_ref() || deltas.moved.contains(story) {
                note_change(transaction, now, "story", *story)?;
            }
            continue;
        }
        let changed = write_row(transaction, *story, old, new.as_ref())?;
        let is_story = new.as_ref().is_some_and(Row::is_story);
        if changed || (is_story && deltas.moved.contains(story)) {
            note_change(transaction, now, "story", *story)?;
        }
    }
    Ok(())
}

/// Makes every story from nothing, from the classes as they are: what a
/// store that held mail before stories existed is given once, and what the
/// tests compare the rows a batch at a time gave with. Notes each story
/// whose row this changed.
pub(super) fn compose_all(transaction: &Transaction<'_>, now: i64) -> Result<(), StoreError> {
    let old_rows: BTreeMap<i64, Row> = {
        let ids: Vec<i64> = transaction
            .prepare("SELECT id FROM story")?
            .query_map([], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        let mut rows = BTreeMap::new();
        for id in ids {
            if let Some(row) = stored_row(transaction, id)? {
                rows.insert(id, row);
            }
        }
        rows
    };
    let streams = new_streams_sql(EVERY_MEMBER);
    transaction.execute_batch(&format!(
        "DELETE FROM story;
         DELETE FROM story_member;
         DELETE FROM story_shape;
         DELETE FROM story_kind;
         {streams};
         INSERT INTO story_member (message_id, story_id, date, template_key, body_shape, exception)
             SELECT envelope.message_id, (SELECT id FROM stream WHERE stream.key = {STREAM}),
                    envelope.date, envelope.template_key, envelope.body_shape, 0
             FROM screening JOIN envelope ON envelope.message_id = screening.message_id
             WHERE screening.class = 'bulk' AND screening.listed = 1;
         INSERT INTO story_shape (story_id, shape, messages)
             SELECT story_id, body_shape, count(*) FROM story_member
             WHERE body_shape IS NOT NULL GROUP BY story_id, body_shape;
         INSERT INTO story_kind (story_id, template_key, messages)
             SELECT story_id, template_key, count(*) FROM story_member
             WHERE template_key IS NOT NULL GROUP BY story_id, template_key;"
    ))?;
    // Every stream's rows with its usual shapes, then its exceptions, which
    // read them.
    let counted: BTreeMap<i64, Counts> = {
        let mut statement = transaction.prepare(&format!(
            "SELECT story_id, count(*),
                    (SELECT count(*) FROM story_kind WHERE story_kind.story_id = story_member.story_id),
                    (SELECT count(*) FROM story_shape
                     WHERE story_shape.story_id = story_member.story_id
                       AND story_shape.messages >= {USUAL_SHAPE})
             FROM story_member GROUP BY story_id"
        ))?;
        statement
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    Counts {
                        messages: row.get(1)?,
                        exceptions: 0,
                        kinds: row.get(2)?,
                        usual: row.get(3)?,
                    },
                ))
            })?
            .collect::<Result<_, _>>()?
    };
    let mut rows = BTreeMap::new();
    for (story, counts) in &counted {
        if let Some(row) = row_with(transaction, *story, *counts)? {
            write_row(transaction, *story, None, Some(&row))?;
            rows.insert(*story, row);
        }
    }
    let exception = exception_expression();
    transaction.execute(
        &format!("UPDATE story_member SET exception = {exception} WHERE exception <> {exception}"),
        [],
    )?;
    let exceptions: Vec<(i64, i64)> = transaction
        .prepare(
            "SELECT story_id, count(*) FROM story_member WHERE exception = 1 GROUP BY story_id",
        )?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (story, count) in exceptions {
        transaction.run(
            "UPDATE story SET exceptions = ?2 WHERE id = ?1",
            params![story, count],
        )?;
        if let Some(row) = rows.get_mut(&story) {
            row.exceptions = count;
        }
    }
    let ids: BTreeSet<i64> = old_rows.keys().chain(rows.keys()).copied().collect();
    for story in ids {
        let (old, new) = (old_rows.get(&story), rows.get(&story));
        if old != new && (old.is_some_and(Row::is_story) || new.is_some_and(Row::is_story)) {
            note_change(transaction, now, "story", story)?;
        }
    }
    Ok(())
}

/// Fills stories for the mail a store held before they existed, once, when
/// the store is opened after migration 9.
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
    compose_all(&transaction, super::wall_clock())?;
    transaction.execute("DELETE FROM engine_state WHERE key = ?1", [FILL])?;
    transaction.commit()?;
    Ok(())
}

/// What a rebuild throws away of stories: it derives them again a batch at
/// a time. The streams keep their ids; the epoch is made again, so every
/// cursor of `mail-story-changes` from before is told to read the stories
/// again.
pub(super) const CLEAR: &str = "DELETE FROM story;
     DELETE FROM story_member;
     DELETE FROM story_shape;
     DELETE FROM story_kind;
     DELETE FROM engine_state WHERE key = 'story-fill';
     INSERT OR REPLACE INTO engine_state (key, value)
         VALUES ('story-epoch',
                 coalesce((SELECT value FROM engine_state WHERE key = 'story-epoch'), 0)
                     + 1 + abs(random() % 1000000));";

/// Drops the streams no held message belongs to any longer, when a rebuild
/// finishes: those of mail that is gone, such as a removed account's, whose
/// lists and addresses are not kept. A stream whose mail is held but in no
/// story now (screened in, or only in junk) keeps its id, so its story has
/// the same one if it comes back.
pub(super) fn prune_sql() -> String {
    format!("DELETE FROM stream WHERE key NOT IN (SELECT {STREAM} FROM envelope)")
}

/// The queries stories run, by name, for the test of their plans.
#[cfg(test)]
pub(super) fn every_query() -> Vec<(&'static str, String)> {
    vec![
        ("members before", BEFORE.to_string()),
        ("members removed", REMOVE.to_string()),
        ("streams", streams_sql()),
        ("members", member_sql()),
        ("newest in target", NEWEST_IN_TARGET.to_string()),
        ("prune", prune_sql()),
        ("stream", STREAM_ID.to_string()),
        ("exceptions of the target", except_sql(EXCEPT_TARGET)),
        ("exceptions of a shape", except_sql(EXCEPT_SHAPE)),
        (
            "exceptions of a shape now usual",
            except_sql(EXCEPT_SHAPE_USUAL),
        ),
        ("exceptions of a story", except_sql(EXCEPT_STORY)),
        (
            "exceptions of a story with none usual",
            except_sql(EXCEPT_STORY_NONE),
        ),
        ("set usual", SET_USUAL.to_string()),
        ("first", FIRST.to_string()),
        ("last", LAST.to_string()),
        ("member", MEMBER.to_string()),
        ("newest", NEWEST.to_string()),
        ("story list", story_list_sql()),
        ("story kinds", KINDS.to_string()),
        ("kinds walk", KINDS_WALK.to_string()),
        ("count again", except_whole_sql()),
        ("story messages", story_messages_sql(Only::Every)),
        ("story exceptions", story_messages_sql(Only::Exceptions)),
        ("story kind", story_messages_sql(Only::Kind)),
        ("story changes", CHANGES.to_string()),
        ("stories of", story_of_sql()),
    ]
}

/// A story as a list shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoryRow {
    /// Its id.
    pub id: i64,
    /// What made it: `stream`.
    pub kind: String,
    /// The list it is of, or empty for a story of a sender.
    pub list_id: String,
    /// Its sender, or for a list the sender of its newest message.
    pub sender_address: String,
    /// Its title: the list's id, or the name on its newest message, or
    /// else the sender's address.
    pub title: String,
    /// Its messages.
    pub messages: u64,
    /// Those whose body shape is not one of its usual ones.
    pub exceptions: u64,
    /// Its template keys.
    pub kinds: u64,
    /// The dates of its first and last messages, in milliseconds.
    pub first_date: i64,
    /// The date of its last message: when it last changed by mail arriving.
    pub last_date: i64,
}

/// The columns a [`StoryRow`] is read from.
const STORY_COLUMNS: &str = "id, kind, list_id, sender_address, title, messages, exceptions,
     kinds, first_date, last_date";

fn story_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoryRow> {
    Ok(StoryRow {
        id: row.get(0)?,
        kind: row.get(1)?,
        list_id: row.get(2)?,
        sender_address: row.get(3)?,
        title: row.get(4)?,
        messages: count(row.get(5)?),
        exceptions: count(row.get(6)?),
        kinds: count(row.get(7)?),
        first_date: row.get(8)?,
        last_date: row.get(9)?,
    })
}

/// The stories, newest first, from the index of the streams that are
/// stories.
fn story_list_sql() -> String {
    format!(
        "SELECT {STORY_COLUMNS} FROM story
         WHERE messages >= {LEAST_MESSAGES} AND (last_date, id) < (?1, ?2)
         ORDER BY last_date DESC, id DESC LIMIT ?3"
    )
}

/// One kind of mail in a story.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KindRow {
    /// Its template key.
    pub key: Vec<u8>,
    /// How many of the story's messages hold it.
    pub messages: u64,
    /// The newest of them.
    pub newest: MessageId,
    /// That message's subject, as its header wrote it.
    pub subject: String,
}

/// A story's kinds, the most common first.
const KINDS: &str = "SELECT template_key, messages FROM story_kind WHERE story_id = ?1
     ORDER BY messages DESC, template_key LIMIT ?2";

/// A story's members with a kind, newest first, from its index by date.
const KINDS_WALK: &str = "SELECT message_id, template_key FROM story_member
     WHERE story_id = ?1 AND template_key IS NOT NULL
     ORDER BY date DESC, message_id DESC";

/// Which of a story's messages to list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoryMessages {
    /// All of them.
    Every,
    /// Its exceptions alone.
    Exceptions,
    /// Those of one kind: a template key.
    Kind(Vec<u8>),
}

/// Which statement lists a story's messages.
#[derive(Debug, Clone, Copy)]
enum Only {
    Every,
    Exceptions,
    Kind,
}

/// A story's messages, newest first, from the index that fits the filter.
fn story_messages_sql(only: Only) -> String {
    let filter = match only {
        Only::Every => "",
        Only::Exceptions => "AND story_member.exception = 1",
        Only::Kind => "AND story_member.template_key = ?5",
    };
    format!(
        "SELECT {LISTED}, story_member.exception, story_member.template_key
         FROM story_member
         JOIN envelope ON envelope.message_id = story_member.message_id
         JOIN message ON message.id = story_member.message_id
         WHERE story_member.story_id = ?1 {filter}
           AND (story_member.date, story_member.message_id) < (?2, ?3)
         ORDER BY story_member.date DESC, story_member.message_id DESC LIMIT ?4"
    )
}

/// A message of a story, as its list shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoryMessage {
    /// The message as any list shows it.
    pub listed: MessageListed,
    /// Whether its body shape is not one of its story's usual ones.
    pub exception: bool,
    /// Its template key: its kind.
    pub kind: Option<Vec<u8>>,
}

/// The stories changed after a change's sequence number: each one once,
/// at its latest change, in the order of those.
const CHANGES: &str = "SELECT subject, max(seq) AS last FROM change
     WHERE kind = 'story' AND seq > ?1 GROUP BY subject ORDER BY last LIMIT ?2";

/// The story a message is in, if it is in one.
fn story_of_sql() -> String {
    format!(
        "SELECT story_member.story_id FROM story_member
         JOIN story ON story.id = story_member.story_id AND story.messages >= {LEAST_MESSAGES}
         WHERE story_member.message_id = ?1"
    )
}

/// The id a stream's story has.
const STREAM_ID: &str = "SELECT id FROM stream WHERE key = ?1";

/// Where a caller of `mail-story-changes` read up to: the stories' epoch
/// and a change's number.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoryCursor {
    /// The epoch the change belongs to.
    pub epoch: i64,
    /// The change's number.
    pub seq: u64,
}

/// What changed in stories after a cursor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoryChanges {
    /// Each story that changed, with the cursor of its latest change, in
    /// the order of those. Empty with no cursor, and on a reset.
    pub changed: Vec<(i64, StoryCursor)>,
    /// Whether the cursor is of another epoch (every story was made again
    /// since, by a rebuild) or names a change this store never noted (it is
    /// another store's): the caller's stories may be gone unnoted, so it
    /// reads them again.
    pub reset: bool,
    /// The cursor of the latest change of all.
    pub now: StoryCursor,
}

impl Store {
    /// How many times a batch found a story counted wrong and counted it
    /// again whole: nothing, unless the engine has a bug.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn story_recounts(&self) -> Result<u64, StoreError> {
        let recounts: Option<i64> = self
            .connection
            .query_row(
                "SELECT value FROM engine_state WHERE key = ?1",
                [RECOUNTS],
                |row| row.get(0),
            )
            .optional()?;
        Ok(count(recounts.unwrap_or(0)))
    }

    /// Computes again the stories of `messages`, in a transaction of its
    /// own, as a batch that derived them would.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn recompute_stories(
        &mut self,
        messages: &[MessageId],
        now: i64,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        settle(
            &transaction,
            &messages.iter().map(|message| message.0).collect(),
            now,
        )?;
        transaction.commit()?;
        Ok(())
    }

    /// The stories, newest first: at most `limit`, starting before `before`
    /// (the last date and id of the last story of the page before).
    ///
    /// # Errors
    /// When the database refuses.
    pub fn stories(
        &self,
        before: Option<(i64, i64)>,
        limit: u32,
    ) -> Result<Vec<StoryRow>, StoreError> {
        let (date, id) = before.unwrap_or((i64::MAX, i64::MAX));
        let mut statement = self.connection.prepare_cached(&story_list_sql())?;
        let rows = statement.query_map(params![date, id, limit], story_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// One story, or `None` when there is no such story.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn story(&self, id: i64) -> Result<Option<StoryRow>, StoreError> {
        Ok(self
            .connection
            .prepare_cached(&format!(
                "SELECT {STORY_COLUMNS} FROM story WHERE id = ?1 AND messages >= {LEAST_MESSAGES}"
            ))?
            .query_row([id], story_row)
            .optional()?)
    }

    /// How many stories there are.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn story_count(&self) -> Result<u64, StoreError> {
        let stories: i64 = self.connection.query_row(
            &format!("SELECT count(*) FROM story WHERE messages >= {LEAST_MESSAGES}"),
            [],
            |row| row.get(0),
        )?;
        Ok(count(stories))
    }

    /// A story's kinds of mail, the most common first: at most `limit`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn story_kinds(&self, story: i64, limit: u32) -> Result<Vec<KindRow>, StoreError> {
        let kinds: Vec<(Vec<u8>, i64)> = {
            let mut statement = self.connection.prepare_cached(KINDS)?;
            statement
                .query_map(params![story, limit], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect::<Result<_, _>>()?
        };
        // Each kind's newest message, found in one walk of the story from its
        // newest, which stops once every kind is found.
        let mut wanted: HashMap<Vec<u8>, Option<i64>> =
            kinds.iter().map(|(key, _)| (key.clone(), None)).collect();
        let mut left = wanted.len();
        if left > 0 {
            let mut walk = self.connection.prepare_cached(KINDS_WALK)?;
            let mut members = walk.query([story])?;
            while let Some(row) = members.next()? {
                let key: Vec<u8> = row.get(1)?;
                if let Some(slot @ None) = wanted.get_mut(&key) {
                    *slot = Some(row.get(0)?);
                    left -= 1;
                    if left == 0 {
                        break;
                    }
                }
            }
        }
        let mut subject = self
            .connection
            .prepare_cached("SELECT subject FROM envelope WHERE message_id = ?1")?;
        let mut rows = Vec::with_capacity(kinds.len());
        for (key, messages) in kinds {
            let Some(Some(message)) = wanted.get(&key).copied() else {
                continue;
            };
            rows.push(KindRow {
                key,
                messages: count(messages),
                newest: MessageId(message),
                subject: subject.query_row([message], |row| row.get(0))?,
            });
        }
        Ok(rows)
    }

    /// A story's messages, newest first: those `which` names, at most
    /// `limit`, starting before `before` (the date and id of the last
    /// message of the page before).
    ///
    /// # Errors
    /// When the database refuses.
    pub fn story_messages(
        &self,
        story: i64,
        which: &StoryMessages,
        before: Option<(i64, MessageId)>,
        limit: u32,
    ) -> Result<Vec<StoryMessage>, StoreError> {
        let (date, message) =
            before.map_or((i64::MAX, i64::MAX), |(date, message)| (date, message.0));
        let read = |row: &rusqlite::Row<'_>| -> rusqlite::Result<StoryMessage> {
            Ok(StoryMessage {
                listed: listed(row)?,
                exception: row.get(25)?,
                kind: row.get(26)?,
            })
        };
        let rows: Vec<StoryMessage> = match which {
            StoryMessages::Every => self
                .connection
                .prepare_cached(&story_messages_sql(Only::Every))?
                .query_map(params![story, date, message, limit], read)?
                .collect::<Result<_, _>>()?,
            StoryMessages::Exceptions => self
                .connection
                .prepare_cached(&story_messages_sql(Only::Exceptions))?
                .query_map(params![story, date, message, limit], read)?
                .collect::<Result<_, _>>()?,
            StoryMessages::Kind(key) => self
                .connection
                .prepare_cached(&story_messages_sql(Only::Kind))?
                .query_map(params![story, date, message, limit, key], read)?
                .collect::<Result<_, _>>()?,
        };
        Ok(rows)
    }

    /// The stories that changed after `after`, each once: at most `limit`.
    /// With no cursor, none, and the cursor of now: a caller starts there,
    /// then reads the stories.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn story_changes(
        &self,
        after: Option<StoryCursor>,
        limit: u32,
    ) -> Result<StoryChanges, StoreError> {
        let epoch: i64 = self
            .connection
            .query_row(
                "SELECT value FROM engine_state WHERE key = ?1",
                [EPOCH],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(0);
        let now = StoryCursor {
            epoch,
            seq: self.last_change()?,
        };
        let Some(after) = after else {
            return Ok(StoryChanges {
                changed: Vec::new(),
                reset: false,
                now,
            });
        };
        if after.epoch != epoch || after.seq > now.seq {
            return Ok(StoryChanges {
                changed: Vec::new(),
                reset: true,
                now,
            });
        }
        let changed = {
            let mut statement = self.connection.prepare_cached(CHANGES)?;
            statement
                .query_map(
                    params![i64::try_from(after.seq).unwrap_or(i64::MAX), limit],
                    |row| {
                        Ok((
                            row.get(0)?,
                            StoryCursor {
                                epoch,
                                seq: count(row.get(1)?),
                            },
                        ))
                    },
                )?
                .collect::<Result<_, _>>()?
        };
        Ok(StoryChanges {
            changed,
            reset: false,
            now,
        })
    }

    /// The id of the story of a list, once any of its mail made one.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn list_story(&self, list_id: &str) -> Result<Option<i64>, StoreError> {
        self.stream_id(&format!("list {list_id}"))
    }

    /// The id of the story of a sender with no list, once any of its mail
    /// made one.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn sender_story(&self, address: &str) -> Result<Option<i64>, StoreError> {
        self.stream_id(&format!("sender {address}"))
    }

    fn stream_id(&self, key: &str) -> Result<Option<i64>, StoreError> {
        Ok(self
            .connection
            .prepare_cached(STREAM_ID)?
            .query_row([key], |row| row.get(0))
            .optional()?)
    }

    /// The story each of `messages` is in, for those in one.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn stories_of(
        &self,
        messages: &[MessageId],
    ) -> Result<HashMap<MessageId, i64>, StoreError> {
        let mut statement = self.connection.prepare_cached(&story_of_sql())?;
        let mut stories = HashMap::new();
        for message in messages {
            let story: Option<i64> = statement
                .query_row([message.0], |row| row.get(0))
                .optional()?;
            if let Some(story) = story {
                stories.insert(*message, story);
            }
        }
        Ok(stories)
    }
}
