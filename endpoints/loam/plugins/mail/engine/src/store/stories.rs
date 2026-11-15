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
//! Every row is derived like a class: never adjusted, computed again for
//! what each batch changed, so a rebuild gives the same rows. A story
//! depends on its members' screening rows and envelopes, so the messages
//! whose class or place in the lists changed, and those derived again, have
//! their membership computed again; the stories a member left, joined or
//! changed in have their counts, exceptions and rows computed again, and
//! each one that changed is noted in `change` for `mail-story-changes`.
//!
//! A story's id is its stream's, from `stream`, which is not derived: an id
//! once given to a list or a sender is kept, so a rebuild gives the story
//! the same one and no two streams share one.

use std::collections::{BTreeMap, BTreeSet, HashMap};

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
         RETURNING message_id, story_id, body_shape, template_key"
    )
}

/// What the messages of `temp.story_target` were in before.
const BEFORE: &str = "SELECT message_id, story_id, body_shape, template_key FROM story_member
     WHERE message_id IN (SELECT message_id FROM temp.story_target)";

/// The messages of `temp.story_target` that are no longer bulk mail a
/// mailbox other than junk and trash shows.
const REMOVE: &str = "DELETE FROM story_member
     WHERE message_id IN (SELECT message_id FROM temp.story_target)
       AND NOT EXISTS (SELECT 1 FROM screening
                       WHERE screening.message_id = story_member.message_id
                         AND screening.class = 'bulk' AND screening.listed = 1)
     RETURNING message_id, story_id, body_shape, template_key";

/// The stories whose newest member is in `temp.story_target`, whose title
/// it gives: a message derived again may bring another name.
const NEWEST_IN_TARGET: &str = "SELECT DISTINCT story_member.story_id FROM temp.story_target
     CROSS JOIN story_member ON story_member.message_id = story_target.message_id
     WHERE story_member.message_id =
         (SELECT newest.message_id FROM story_member AS newest
          WHERE newest.story_id = story_member.story_id
          ORDER BY newest.date DESC, newest.message_id DESC LIMIT 1)";

/// Whether a member of `story_member` is an exception: it has a body
/// shape, its story has a usual one, and its own is not.
fn exception_expression() -> String {
    format!(
        "(story_member.body_shape IS NOT NULL
          AND EXISTS (SELECT 1 FROM story_shape AS usual
                      WHERE usual.story_id = story_member.story_id
                        AND usual.messages >= {USUAL_SHAPE})
          AND NOT EXISTS (SELECT 1 FROM story_shape AS own
                          WHERE own.story_id = story_member.story_id
                            AND own.shape = story_member.body_shape
                            AND own.messages >= {USUAL_SHAPE}))"
    )
}

/// What [`except_sql`] selects by: the messages a batch changed, a story's
/// members with one shape, or every member of a story with a shape (one
/// without is never an exception).
const EXCEPT_TARGET: &str = "story_member.message_id IN (SELECT message_id FROM temp.story_target)";
const EXCEPT_SHAPE: &str = "story_member.story_id = ?1 AND story_member.body_shape = ?2";
const EXCEPT_STORY: &str = "story_member.story_id = ?1 AND story_member.body_shape IS NOT NULL";

/// The statement that computes `exception` again for the members `filter`
/// selects.
fn except_sql(filter: &str) -> String {
    let exception = exception_expression();
    format!(
        "UPDATE story_member SET exception = {exception}
         WHERE ({filter}) AND exception <> {exception}"
    )
}

/// Whether a story has a usual shape, from the index of its shapes by
/// count.
fn has_usual_sql() -> String {
    format!(
        "SELECT EXISTS (SELECT 1 FROM story_shape
         WHERE story_id = ?1 AND messages >= {USUAL_SHAPE})"
    )
}

/// A story's members, their first and last dates.
const SPAN: &str = "SELECT count(*), min(date), max(date) FROM story_member WHERE story_id = ?1";

/// A story's exceptions.
const EXCEPTIONS: &str = "SELECT count(*) FROM story_member WHERE story_id = ?1 AND exception = 1";

/// A story's newest member, which names it.
const NEWEST: &str = "SELECT envelope.list_id, envelope.sender_address, envelope.sender_name
     FROM story_member JOIN envelope ON envelope.message_id = story_member.message_id
     WHERE story_member.story_id = ?1
     ORDER BY story_member.date DESC, story_member.message_id DESC LIMIT 1";

/// How many of a story's members have a shape, and a template key.
const SHAPE_COUNT: &str =
    "SELECT count(*) FROM story_member WHERE story_id = ?1 AND body_shape = ?2";
const KIND_COUNT: &str =
    "SELECT count(*) FROM story_member WHERE story_id = ?1 AND template_key = ?2";

/// A member's story, shape and template key.
type Membership = (i64, Option<Vec<u8>>, Option<Vec<u8>>);

/// What a batch changed of stories.
#[derive(Debug, Default)]
struct Touched {
    /// Stories whose row is computed again: those a member left, joined or
    /// changed in, and those whose newest member was derived again.
    stories: BTreeSet<i64>,
    /// Stories a member left, joined or changed in.
    moved: BTreeSet<i64>,
    /// Shapes and template keys whose count in a story changed.
    shapes: BTreeSet<(i64, Vec<u8>)>,
    kinds: BTreeSet<(i64, Vec<u8>)>,
}

impl Touched {
    /// Notes a membership a member had or has now.
    fn note(&mut self, (story, shape, kind): Membership) {
        self.stories.insert(story);
        self.moved.insert(story);
        if let Some(shape) = shape {
            self.shapes.insert((story, shape));
        }
        if let Some(kind) = kind {
            self.kinds.insert((story, kind));
        }
    }
}

/// The rows `sql` returns: a message, then its membership.
fn memberships(
    transaction: &Transaction<'_>,
    sql: &str,
) -> Result<Vec<(i64, Membership)>, StoreError> {
    let mut statement = transaction.prepare_cached(sql)?;
    let rows = statement.query_map([], |row| {
        Ok((row.get(0)?, (row.get(1)?, row.get(2)?, row.get(3)?)))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
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

/// Counts again one shape or template key of a story in `table`, and
/// returns how many held it before and after.
fn recount(
    transaction: &Transaction<'_>,
    table: &str,
    column: &str,
    counted: &str,
    story: i64,
    value: &[u8],
) -> Result<(i64, i64), StoreError> {
    let before: i64 = transaction
        .one(
            &format!("SELECT messages FROM {table} WHERE story_id = ?1 AND {column} = ?2"),
            params![story, value],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(0);
    let after: i64 = transaction.one(counted, params![story, value], |row| row.get(0))?;
    if after == 0 {
        transaction.run(
            &format!("DELETE FROM {table} WHERE story_id = ?1 AND {column} = ?2"),
            params![story, value],
        )?;
    } else if after != before {
        transaction.run(
            &format!(
                "INSERT INTO {table} (story_id, {column}, messages) VALUES (?1, ?2, ?3)
                 ON CONFLICT (story_id, {column}) DO UPDATE SET messages = excluded.messages"
            ),
            params![story, value, after],
        )?;
    }
    Ok((before, after))
}

/// Computes a story's row again from its members. Returns whether the row
/// changed (made, altered or removed) and whether there is one now.
fn compute_story(transaction: &Transaction<'_>, story: i64) -> Result<(bool, bool), StoreError> {
    let (messages, first, last): (i64, Option<i64>, Option<i64>) =
        transaction.one(SPAN, [story], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
    if messages < LEAST_MESSAGES {
        let removed = transaction.run("DELETE FROM story WHERE id = ?1", [story])?;
        return Ok((removed > 0, false));
    }
    let exceptions: i64 = transaction.one(EXCEPTIONS, [story], |row| row.get(0))?;
    let kinds: i64 = transaction.one(
        "SELECT count(*) FROM story_kind WHERE story_id = ?1",
        [story],
        |row| row.get(0),
    )?;
    let (list_id, address, name): (String, String, String) =
        transaction.one(NEWEST, [story], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
    let title = if !list_id.is_empty() {
        list_id.clone()
    } else if !name.trim().is_empty() {
        name
    } else {
        address.clone()
    };
    let written = transaction.run(
        "INSERT INTO story (id, kind, list_id, sender_address, title, messages, exceptions, kinds,
                            first_date, last_date)
         VALUES (?1, 'stream', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (id) DO UPDATE SET
             list_id = excluded.list_id, sender_address = excluded.sender_address,
             title = excluded.title, messages = excluded.messages,
             exceptions = excluded.exceptions, kinds = excluded.kinds,
             first_date = excluded.first_date, last_date = excluded.last_date
         WHERE story.list_id <> excluded.list_id OR story.sender_address <> excluded.sender_address
            OR story.title <> excluded.title OR story.messages <> excluded.messages
            OR story.exceptions <> excluded.exceptions OR story.kinds <> excluded.kinds
            OR story.first_date <> excluded.first_date OR story.last_date <> excluded.last_date",
        params![
            story,
            list_id,
            address,
            title,
            messages,
            exceptions,
            kinds,
            first.unwrap_or(0),
            last.unwrap_or(0)
        ],
    )?;
    Ok((written > 0, true))
}

/// Computes again the membership of `messages`, then the counts,
/// exceptions and rows of every story a member left, joined or changed in,
/// and notes each story that changed.
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
    // target is as it was.
    let mut touched = Touched::default();
    for (message, membership) in removed.into_iter().chain(written) {
        if let Some(was_in) = before.get(&message) {
            touched.note(was_in.clone());
        }
        touched.note(membership);
    }
    {
        let mut statement = transaction.prepare_cached(NEWEST_IN_TARGET)?;
        let newest = statement.query_map([], |row| row.get::<_, i64>(0))?;
        for story in newest {
            touched.stories.insert(story?);
        }
    }
    if touched.stories.is_empty() {
        return Ok(());
    }
    let has_usual = has_usual_sql();
    let mut usual_before = BTreeMap::new();
    for story in &touched.moved {
        let usual: bool = transaction.one(&has_usual, [story], |row| row.get(0))?;
        usual_before.insert(*story, usual);
    }
    let mut turned = Vec::new();
    for (story, shape) in &touched.shapes {
        let (before, after) = recount(
            transaction,
            "story_shape",
            "shape",
            SHAPE_COUNT,
            *story,
            shape,
        )?;
        if (before >= USUAL_SHAPE) != (after >= USUAL_SHAPE) {
            turned.push((*story, shape.as_slice()));
        }
    }
    for (story, kind) in &touched.kinds {
        recount(
            transaction,
            "story_kind",
            "template_key",
            KIND_COUNT,
            *story,
            kind,
        )?;
    }
    // A story that gained its first usual shape, or lost its last, has
    // every shaped member's exception computed again; a shape that became
    // usual, or stopped being, has its members'; and the messages changed
    // have theirs.
    let (by_story, by_shape) = (except_sql(EXCEPT_STORY), except_sql(EXCEPT_SHAPE));
    let mut flipped = BTreeSet::new();
    for (story, before) in &usual_before {
        let after: bool = transaction.one(&has_usual, [story], |row| row.get(0))?;
        if after != *before {
            flipped.insert(*story);
            transaction.run(&by_story, [story])?;
        }
    }
    for (story, shape) in turned {
        if !flipped.contains(&story) {
            transaction.run(&by_shape, params![story, shape])?;
        }
    }
    transaction.run(&except_sql(EXCEPT_TARGET), [])?;
    for story in &touched.stories {
        let (changed, exists) = compute_story(transaction, *story)?;
        if changed || (exists && touched.moved.contains(story)) {
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
    let exception = exception_expression();
    let streams = new_streams_sql(EVERY_MEMBER);
    transaction.execute_batch(&format!(
        "DELETE FROM story_member;
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
             WHERE template_key IS NOT NULL GROUP BY story_id, template_key;
         UPDATE story_member SET exception = {exception} WHERE exception <> {exception};"
    ))?;
    let stories: Vec<i64> = {
        let mut statement = transaction.prepare(&format!(
            "SELECT id FROM story
             UNION
             SELECT story_id FROM story_member GROUP BY story_id
             HAVING count(*) >= {LEAST_MESSAGES}"
        ))?;
        statement
            .query_map([], |row| row.get(0))?
            .collect::<Result<_, _>>()?
    };
    for story in stories {
        if compute_story(transaction, story)?.0 {
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
        ("exceptions of a story", except_sql(EXCEPT_STORY)),
        ("has usual", has_usual_sql()),
        ("span", SPAN.to_string()),
        ("exceptions", EXCEPTIONS.to_string()),
        ("newest", NEWEST.to_string()),
        ("shape count", SHAPE_COUNT.to_string()),
        ("kind count", KIND_COUNT.to_string()),
        ("story list", STORY_LIST.to_string()),
        ("story kinds", KINDS.to_string()),
        ("kind newest", KIND_NEWEST.to_string()),
        ("story messages", story_messages_sql(Only::Every)),
        ("story exceptions", story_messages_sql(Only::Exceptions)),
        ("story kind", story_messages_sql(Only::Kind)),
        ("story changes", CHANGES.to_string()),
        ("stories of", STORY_OF.to_string()),
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

/// The stories, newest first.
const STORY_LIST: &str = "SELECT id, kind, list_id, sender_address, title, messages, exceptions,
     kinds, first_date, last_date FROM story
     WHERE (last_date, id) < (?1, ?2) ORDER BY last_date DESC, id DESC LIMIT ?3";

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

/// The newest message of one kind in a story.
const KIND_NEWEST: &str = "SELECT story_member.message_id, envelope.subject FROM story_member
     JOIN envelope ON envelope.message_id = story_member.message_id
     WHERE story_member.story_id = ?1 AND story_member.template_key = ?2
     ORDER BY story_member.date DESC, story_member.message_id DESC LIMIT 1";

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
const STORY_OF: &str = "SELECT story_member.story_id FROM story_member
     JOIN story ON story.id = story_member.story_id
     WHERE story_member.message_id = ?1";

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
        let mut statement = self.connection.prepare_cached(STORY_LIST)?;
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
            .prepare_cached(&format!("SELECT {STORY_COLUMNS} FROM story WHERE id = ?1"))?
            .query_row([id], story_row)
            .optional()?)
    }

    /// How many stories there are.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn story_count(&self) -> Result<u64, StoreError> {
        let stories: i64 = self
            .connection
            .query_row("SELECT count(*) FROM story", [], |row| row.get(0))?;
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
        let mut newest = self.connection.prepare_cached(KIND_NEWEST)?;
        let mut rows = Vec::with_capacity(kinds.len());
        for (key, messages) in kinds {
            let (message, subject): (i64, String) =
                newest.query_row(params![story, key], |row| Ok((row.get(0)?, row.get(1)?)))?;
            rows.push(KindRow {
                key,
                messages: count(messages),
                newest: MessageId(message),
                subject,
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
        let mut statement = self.connection.prepare_cached(STORY_OF)?;
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
