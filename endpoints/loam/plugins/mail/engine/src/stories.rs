//! The story commands (the specification's section 8 and 11):
//!
//! - `mail-story-list` gives the stories, the one changed by the latest mail
//!   first, paged by cursor.
//! - `mail-story-open` gives one story's card (its counts, its most common
//!   kinds of mail) and its messages, newest first: all of them, its
//!   exceptions alone, or one kind's.
//! - `mail-story-changes` gives each story that changed after a cursor,
//!   with a new cursor. The caller keeps its cursor; the engine stores none.
//!
//! Stories are made from the screening classes, so they are read only when
//! screening is ready, and fail with `SCREENING_NOT_READY` until then. A
//! story's title, list and sender came from its mail and sit in parts
//! labelled `"trust": "content"`; a cursor holds dates, ids and a change's
//! number, never an address.

use std::sync::Arc;

use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult, JsonSchemaType,
    failure, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::commands::store_failure;
use crate::engine::Engine;
use crate::read::{
    LIST_BUDGET, MOST_BUDGET, budget, content, cursor, fit, limit, message_item, parameter,
    read_exposure, required,
};
use crate::screening::not_ready;
use crate::store::{
    KINDS_SHOWN, KindRow, MessageId, Store, StoreError, StoryMessage, StoryMessages, StoryRow,
    sender_id,
};

/// The size of a value written as JSON.
fn size(value: &Value) -> usize {
    serde_json::to_string(value).map_or(usize::MAX, |text| text.len())
}

/// A template key as results write it: 32 hexadecimal digits.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// A kind as a caller names it, or `None` when it is not 32 hexadecimal
/// digits.
fn unhex(text: &str) -> Option<Vec<u8>> {
    if text.len() != 32 || !text.is_ascii() {
        return None;
    }
    (0..32)
        .step_by(2)
        .map(|at| u8::from_str_radix(&text[at..at + 2], 16).ok())
        .collect()
}

/// No story has the id named.
fn story_not_found() -> CommandError {
    CommandError::new("STORY_NOT_FOUND", "no story has that id")
        .with_suggestion(
            "Run `loam-mail mail-story-list` to see the stories. A stream is a story from its fifth message, and one whose mail is screened in or moved away stops being one.",
        )
}

fn invalid(message: &str, suggestion: &str) -> Box<CommandError> {
    Box::new(CommandError::new("INVALID_INPUT", message).with_suggestion(suggestion))
}

/// Reads the store once screening is ready, or fails as screening does.
fn when_ready<T>(
    engine: &Engine,
    read: impl FnOnce(&Store) -> Result<T, StoreError>,
) -> Result<T, Box<CommandError>> {
    engine
        .with_store(|store| {
            let readiness = store.screening_readiness()?;
            if !readiness.ready() {
                return Ok(Err(readiness));
            }
            read(store).map(Ok)
        })
        .map_err(|error| Box::new(store_failure(&error)))?
        .map_err(|readiness| Box::new(not_ready(readiness)))
}

/// A story as the commands give it: what the engine counted, and what came
/// from its mail in a content part.
fn story_json(row: &StoryRow) -> Value {
    let by_list = !row.list_id.is_empty();
    json!({
        "story": row.id,
        "kind": row.kind,
        // What its stream is: a list, or a sender with no list.
        "by": if by_list { "list" } else { "sender" },
        "messages": row.messages,
        "exceptions": row.exceptions,
        "kinds": row.kinds,
        "firstDate": row.first_date,
        "lastDate": row.last_date,
        // Its sender, or for a list the sender of its newest message.
        "sender": sender_id(&row.sender_address),
        "content": content(json!({
            "title": row.title,
            "listId": by_list.then_some(&row.list_id),
            "senderAddress": row.sender_address,
        })),
    })
}

fn kind_json(kind: &KindRow) -> Value {
    json!({
        "kind": hex(&kind.key),
        "messages": kind.messages,
        "newest": kind.newest.0,
        "content": content(json!({ "subject": kind.subject })),
    })
}

struct StoryList {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for StoryList {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let read = || -> Result<Value, Box<CommandError>> {
            let limit = limit(&input, 50, 200)?;
            let before = cursor(&input)?;
            let rows = when_ready(&self.engine, |store| store.stories(before, limit + 1))?;
            let more = rows.len() > limit as usize;
            let items: Vec<Value> = rows.iter().take(limit as usize).map(story_json).collect();
            let (kept, cut) = fit(items, budget(&context, LIST_BUDGET));
            let next = (more || cut)
                .then(|| kept.last())
                .flatten()
                .map(|last| format!("{}.{}", last["lastDate"], last["story"]));
            Ok(json!({ "stories": kept, "nextCursor": next }))
        };
        match read() {
            Ok(result) => success(result),
            Err(error) => failure(*error),
        }
    }
}

/// `mail-story-list`: the stories, the one whose latest message is newest
/// first, paged by cursor (the specification's section 8).
#[must_use]
pub fn story_list(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-story-list",
        "List the stories: the bulk mail of each list, or each sender with no list, newest first",
        vec![
            parameter(
                "cursor",
                JsonSchemaType::String,
                "Where the page before ended",
                false,
            ),
            parameter(
                "limit",
                JsonSchemaType::Integer,
                "At most this many stories (1 to 200)",
                false,
            ),
        ],
        StoryList { engine },
    )
    .with_output_budget(LIST_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}

/// Which of a story's messages a call asks for.
fn which(input: &Value) -> Result<StoryMessages, Box<CommandError>> {
    let exceptions = match input.get("exceptions") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(asked)) => *asked,
        Some(_) => {
            return Err(invalid(
                "`exceptions` is not true or false",
                "Pass true for the exceptions alone, or leave it out.",
            ));
        }
    };
    let kind = match input.get("kind") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => Some(unhex(text).ok_or_else(|| {
            invalid(
                "`kind` is not a kind this engine gave",
                "Pass a `kind` from the story's `kindsShown`, 32 hexadecimal digits.",
            )
        })?),
        Some(_) => {
            return Err(invalid(
                "`kind` is not a kind this engine gave",
                "Pass a `kind` from the story's `kindsShown`, 32 hexadecimal digits.",
            ));
        }
    };
    match (exceptions, kind) {
        (true, Some(_)) => Err(invalid(
            "`exceptions` and `kind` were both given",
            "Ask for the exceptions or for one kind, not both.",
        )),
        (true, None) => Ok(StoryMessages::Exceptions),
        (false, Some(kind)) => Ok(StoryMessages::Kind(kind)),
        (false, None) => Ok(StoryMessages::Every),
    }
}

/// What `mail-story-open` reads in one go.
struct Opened {
    story: StoryRow,
    kinds: Vec<KindRow>,
    messages: Vec<StoryMessage>,
}

struct StoryOpen {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for StoryOpen {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let read = || -> Result<Value, Box<CommandError>> {
            let id = required(&input, "story")?;
            let which = which(&input)?;
            let limit = limit(&input, 50, 200)?;
            let before = cursor(&input)?.map(|(date, message)| (date, MessageId(message)));
            let engine = &self.engine;
            let opened = when_ready(engine, |store| {
                let Some(story) = store.story(id)? else {
                    return Ok(None);
                };
                Ok(Some(Opened {
                    story,
                    kinds: store.story_kinds(id, KINDS_SHOWN)?,
                    messages: store.story_messages(id, &which, before, limit + 1)?,
                }))
            })?
            .ok_or_else(|| Box::new(story_not_found()))?;
            let budget = budget(&context, LIST_BUDGET);
            let story = story_json(&opened.story);
            // The card's kinds take at most a quarter of the room; the
            // messages the rest.
            let (kinds, _) = fit(
                opened.kinds.iter().map(kind_json).collect(),
                budget / 4 + 1024,
            );
            let room = budget.saturating_sub(size(&story) + size(&json!(kinds)));
            let more = opened.messages.len() > limit as usize;
            let mut items = Vec::new();
            for member in opened.messages.iter().take(limit as usize) {
                let mut item = message_item(engine, &member.listed)
                    .map_err(|error| Box::new(store_failure(&error)))?;
                item["class"] = json!("bulk");
                item["sender"] = json!(sender_id(&member.listed.sender_address));
                item["exception"] = json!(member.exception);
                item["kind"] = json!(member.kind.as_deref().map(hex));
                items.push(item);
            }
            let (kept, cut) = fit(items, room);
            let next = (more || cut)
                .then(|| kept.last())
                .flatten()
                .map(|last| format!("{}.{}", last["date"], last["message"]));
            let only = match &which {
                StoryMessages::Every => json!("every"),
                StoryMessages::Exceptions => json!("exceptions"),
                StoryMessages::Kind(kind) => json!({ "kind": hex(kind) }),
            };
            Ok(json!({
                "story": story,
                // Its most common kinds of mail, each with a count; `kinds`
                // above counts them all.
                "kindsShown": kinds,
                "only": only,
                "messages": kept,
                "nextCursor": next,
            }))
        };
        match read() {
            Ok(result) => success(result),
            Err(error) => failure(*error),
        }
    }
}

/// `mail-story-open`: one story's card and its messages, newest first, paged
/// by cursor: all of them, its exceptions, or one kind's (the
/// specification's section 8).
#[must_use]
pub fn story_open(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-story-open",
        "Open a story: its counts, its kinds of mail and its messages, newest first",
        vec![
            parameter("story", JsonSchemaType::Integer, "The story's id", true),
            parameter(
                "exceptions",
                JsonSchemaType::Boolean,
                "Only the messages whose body is not shaped like the story's usual ones",
                false,
            ),
            parameter(
                "kind",
                JsonSchemaType::String,
                "Only the messages of one kind, from the story's `kindsShown`",
                false,
            ),
            parameter(
                "cursor",
                JsonSchemaType::String,
                "Where the page before ended",
                false,
            ),
            parameter(
                "limit",
                JsonSchemaType::Integer,
                "At most this many messages (1 to 200)",
                false,
            ),
        ],
        StoryOpen { engine },
    )
    .with_output_budget(LIST_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}

struct StoryChangesCommand {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for StoryChangesCommand {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let read = || -> Result<Value, Box<CommandError>> {
            let after = match input.get("cursor") {
                None | Some(Value::Null) => 0,
                Some(Value::String(text)) => text.parse::<u64>().map_err(|_| {
                    invalid(
                        "`cursor` is not one this command gave",
                        "Pass the `nextCursor` of the result before, or none to start.",
                    )
                })?,
                Some(_) => {
                    return Err(invalid(
                        "`cursor` is not one this command gave",
                        "Pass the `nextCursor` of the result before, or none to start.",
                    ));
                }
            };
            let limit = limit(&input, 100, 500)?;
            let (changes, rows) = when_ready(&self.engine, |store| {
                let changes = store.story_changes(after, limit + 1)?;
                let mut rows = Vec::with_capacity(changes.changed.len());
                for (story, _) in changes.changed.iter().take(limit as usize) {
                    rows.push(store.story(*story)?);
                }
                Ok((changes, rows))
            })?;
            let more = changes.changed.len() > limit as usize;
            let items: Vec<Value> = changes
                .changed
                .iter()
                .zip(&rows)
                .map(|((story, _), row)| match row {
                    Some(row) => {
                        let mut item = story_json(row);
                        item["state"] = json!("current");
                        item
                    }
                    None => json!({ "story": story, "state": "gone" }),
                })
                .collect();
            let (kept, cut) = fit(items, budget(&context, LIST_BUDGET));
            // Read on from the last change given, or from the latest of all
            // once every one is given.
            let next = if more || cut {
                changes.changed[kept.len().saturating_sub(1)].1
            } else {
                changes.last
            };
            Ok(json!({
                "changes": kept,
                // Every story was made again since the cursor (a rebuild),
                // or the cursor is not this store's: read `mail-story-list`
                // again rather than trust what was kept.
                "reset": changes.reset,
                "more": more || cut,
                "nextCursor": next.to_string(),
            }))
        };
        match read() {
            Ok(result) => success(result),
            Err(error) => failure(*error),
        }
    }
}

/// `mail-story-changes`: each story that changed after a cursor, once, with
/// what it is now or that it is gone, and a new cursor (the specification's
/// section 8).
#[must_use]
pub fn story_changes(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-story-changes",
        "List the stories that changed since a cursor, each once, with a new cursor",
        vec![
            parameter(
                "cursor",
                JsonSchemaType::String,
                "The `nextCursor` of the call before; none for every change",
                false,
            ),
            parameter(
                "limit",
                JsonSchemaType::Integer,
                "At most this many stories (1 to 500)",
                false,
            ),
        ],
        StoryChangesCommand { engine },
    )
    .with_output_budget(LIST_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}

#[cfg(test)]
mod tests {
    use super::{hex, unhex};

    #[test]
    fn a_kind_is_written_and_read_as_32_hexadecimal_digits() {
        let key: Vec<u8> = (0..16).map(|byte| byte * 17).collect();
        assert_eq!(unhex(&hex(&key)), Some(key));
        assert_eq!(unhex("00"), None);
        assert_eq!(unhex(&"g".repeat(32)), None);
        assert_eq!(unhex(&"é".repeat(16)), None);
    }
}
