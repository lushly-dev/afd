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
//! their membership computed again; the stories they were in or are in have
//! their counts, exceptions and rows computed again, and each one that
//! changed is noted in `change` for `mail-story-changes`.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use rusqlite::functions::FunctionFlags;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use sha2::{Digest, Sha256};

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

/// The stream a message of `envelope` belongs to: its list, or else its
/// sender. As step C1 grouped it.
const STREAM: &str = "CASE WHEN envelope.list_id <> '' THEN 'list ' || envelope.list_id
     ELSE 'sender ' || envelope.sender_address END";

/// The id of the story of the stream written `stream` ([`STREAM`]): made
/// from it, so a rebuild gives the same one, and small enough for any JSON
/// reader to hold exactly.
#[must_use]
pub fn stream_story_id(stream: &str) -> i64 {
    let mut hasher = Sha256::new();
    hasher.update(b"stream\0");
    hasher.update(stream.as_bytes());
    let digest = hasher.finalize();
    let mut first = [0_u8; 8];
    first.copy_from_slice(&digest[..8]);
    i64::try_from(u64::from_be_bytes(first) >> 12).unwrap_or(0)
}

/// The id of the story of a list.
#[must_use]
pub fn list_story_id(list_id: &str) -> i64 {
    stream_story_id(&format!("list {list_id}"))
}

/// The id of the story of a sender with no list.
#[must_use]
pub fn sender_story_id(address: &str) -> i64 {
    stream_story_id(&format!("sender {address}"))
}

/// Lets SQL make a story's id from its stream, as [`stream_story_id`]
/// does.
pub(super) fn register(connection: &Connection) -> Result<(), StoreError> {
    connection.create_scalar_function(
        "stream_story",
        1,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |context| {
            let stream: String = context.get(0)?;
            Ok(stream_story_id(&stream))
        },
    )?;
    Ok(())
}

/// The membership of each message of `temp.story_target`, as it should be.
fn member_sql() -> String {
    format!(
        "INSERT INTO story_member (message_id, story_id, date, template_key, body_shape, exception)
         SELECT envelope.message_id, stream_story({STREAM}), envelope.date,
                envelope.template_key, envelope.body_shape, 0
         FROM temp.story_target
         CROSS JOIN screening ON screening.message_id = story_target.message_id
         CROSS JOIN envelope ON envelope.message_id = story_target.message_id
         WHERE screening.class = 'bulk' AND screening.listed = 1
         ON CONFLICT (message_id) DO UPDATE SET
             story_id = excluded.story_id, date = excluded.date,
             template_key = excluded.template_key, body_shape = excluded.body_shape
         WHERE story_member.story_id <> excluded.story_id OR story_member.date <> excluded.date
            OR story_member.template_key IS NOT excluded.template_key
            OR story_member.body_shape IS NOT excluded.body_shape
         RETURNING story_id, body_shape, template_key"
    )
}

/// What the messages of `temp.story_target` were in before.
const BEFORE: &str = "SELECT DISTINCT story_id, body_shape, template_key FROM story_member
     WHERE message_id IN (SELECT message_id FROM temp.story_target)";

/// The messages of `temp.story_target` that are no longer bulk mail a
/// mailbox other than junk and trash shows.
const REMOVE: &str = "DELETE FROM story_member
     WHERE message_id IN (SELECT message_id FROM temp.story_target)
       AND NOT EXISTS (SELECT 1 FROM screening
                       WHERE screening.message_id = story_member.message_id
                         AND screening.class = 'bulk' AND screening.listed = 1)
     RETURNING story_id, body_shape, template_key";

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
/// members with one shape, or every member of a story.
const EXCEPT_TARGET: &str = "story_member.message_id IN (SELECT message_id FROM temp.story_target)";
const EXCEPT_SHAPE: &str = "story_member.story_id = ?1 AND story_member.body_shape = ?2";
const EXCEPT_STORY: &str = "story_member.story_id = ?1";

/// The statement that computes `exception` again for the members `filter`
/// selects.
fn except_sql(filter: &str) -> String {
    let exception = exception_expression();
    format!(
        "UPDATE story_member SET exception = {exception}
         WHERE ({filter}) AND exception <> {exception}"
    )
}

/// Whether a story has a usual shape, from the partial index of those.
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

/// What a batch changed of stories.
#[derive(Debug, Default)]
struct Touched {
    /// Stories a message was in or is in.
    stories: BTreeSet<i64>,
    /// Stories a member joined, left, or changed in.
    moved: BTreeSet<i64>,
    /// Shapes and template keys whose count in a story may have changed.
    shapes: BTreeSet<(i64, Vec<u8>)>,
    kinds: BTreeSet<(i64, Vec<u8>)>,
}

impl Touched {
    /// Notes the rows `sql` returns: a story, a shape and a template key.
    fn read(
        &mut self,
        transaction: &Transaction<'_>,
        sql: &str,
        moved: bool,
    ) -> Result<(), StoreError> {
        let mut statement = transaction.prepare_cached(sql)?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let story: i64 = row.get(0)?;
            let shape: Option<Vec<u8>> = row.get(1)?;
            let kind: Option<Vec<u8>> = row.get(2)?;
            self.stories.insert(story);
            if moved {
                self.moved.insert(story);
            }
            if let Some(shape) = shape {
                self.shapes.insert((story, shape));
            }
            if let Some(kind) = kind {
                self.kinds.insert((story, kind));
            }
        }
        Ok(())
    }
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
/// exceptions and rows of every story they were in or are in, and notes
/// each story that changed.
pub(super) fn settle(
    transaction: &Transaction<'_>,
    messages: &BTreeSet<i64>,
    now: i64,
) -> Result<(), StoreError> {
    if messages.is_empty() {
        return Ok(());
    }
    load_target(transaction, messages)?;
    let mut touched = Touched::default();
    touched.read(transaction, BEFORE, false)?;
    touched.read(transaction, REMOVE, true)?;
    touched.read(transaction, &member_sql(), true)?;
    if touched.stories.is_empty() {
        return Ok(());
    }
    let mut usual_before = BTreeMap::new();
    for story in &touched.stories {
        let usual: bool = transaction.one(&has_usual_sql(), [story], |row| row.get(0))?;
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
    // every member's exception computed again; a shape that became usual,
    // or stopped being, has its members'; and the messages changed have
    // theirs.
    let mut flipped = BTreeSet::new();
    for (story, before) in &usual_before {
        let after: bool = transaction.one(&has_usual_sql(), [story], |row| row.get(0))?;
        if after != *before {
            flipped.insert(*story);
            transaction.run(&except_sql(EXCEPT_STORY), [story])?;
        }
    }
    for (story, shape) in turned {
        if !flipped.contains(&story) {
            transaction.run(&except_sql(EXCEPT_SHAPE), params![story, shape])?;
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
    transaction.execute_batch(&format!(
        "DELETE FROM story_member;
         DELETE FROM story_shape;
         DELETE FROM story_kind;
         INSERT INTO story_member (message_id, story_id, date, template_key, body_shape, exception)
             SELECT envelope.message_id, stream_story({STREAM}), envelope.date,
                    envelope.template_key, envelope.body_shape, 0
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
/// a time.
pub(super) const CLEAR: &str = "DELETE FROM story;
     DELETE FROM story_member;
     DELETE FROM story_shape;
     DELETE FROM story_kind;
     DELETE FROM engine_state WHERE key = 'story-fill';";

/// The queries stories run, by name, for the test of their plans.
#[cfg(test)]
pub(super) fn every_query() -> Vec<(&'static str, String)> {
    vec![
        ("members before", BEFORE.to_string()),
        ("members removed", REMOVE.to_string()),
        ("members", member_sql()),
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

/// What changed in stories after a cursor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoryChanges {
    /// Each story that changed, with the sequence number of its latest
    /// change, in that order.
    pub changed: Vec<(i64, u64)>,
    /// Whether every story was derived again from nothing since (a
    /// rebuild), or the cursor is later than any change this store has
    /// noted: either way the caller's stories may be gone unnoted.
    pub reset: bool,
    /// The latest change of all.
    pub last: u64,
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

    /// The stories that changed after the change numbered `after`, each
    /// once: at most `limit`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn story_changes(&self, after: u64, limit: u32) -> Result<StoryChanges, StoreError> {
        let after = i64::try_from(after).unwrap_or(i64::MAX);
        let changed: Vec<(i64, u64)> = {
            let mut statement = self.connection.prepare_cached(CHANGES)?;
            statement
                .query_map(params![after, limit], |row| {
                    Ok((row.get(0)?, count(row.get(1)?)))
                })?
                .collect::<Result<_, _>>()?
        };
        let rebuilt: bool = self.connection.query_row(
            "SELECT EXISTS (SELECT 1 FROM change WHERE kind = 'rebuilt' AND seq > ?1)",
            [after],
            |row| row.get(0),
        )?;
        let last = self.last_change()?;
        Ok(StoryChanges {
            changed,
            // A caller with no cursor has nothing to throw away.
            reset: after > 0 && (rebuilt || count(after) > last),
            last,
        })
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
