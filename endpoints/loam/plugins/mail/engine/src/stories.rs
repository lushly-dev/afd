//! The story commands (the specification's section 8 and 11):
//!
//! - `mail-story-list` gives the stories, the one changed by the latest mail
//!   first, paged by cursor.
//! - `mail-story-open` gives one story's card (its counts, its most common
//!   kinds of mail) and its messages, newest first: all of them, its
//!   exceptions alone, or one kind's.
//! - `mail-story-changes` gives each story that changed after a cursor,
//!   with a new cursor. The caller keeps its cursor; the engine stores none.
//!   With no cursor it gives none and the cursor of now: a caller starts
//!   there, then reads `mail-story-list`, and follows the changes after.
//!
//! Stories are made from the screening classes, so they are read only when
//! screening is ready, and fail with `SCREENING_NOT_READY` until then. A
//! story's title, list and sender came from its mail and sit in parts
//! labelled `"trust": "content"`; a cursor holds dates, ids and a change's
//! number, never an address.

use std::collections::HashSet;
use std::sync::Arc;

use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandParameter,
    CommandResult, JsonSchema, JsonSchemaType, failure, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::commands::store_failure;
use crate::derive;
use crate::engine::Engine;
use crate::read::{
    LIST_BUDGET, MOST_BUDGET, budget, content, cursor, fit, limit, message_item, parameter,
    read_exposure, required,
};
use crate::records::verify_passages;
use crate::screening::{not_ready, person_at_terminal, proposer_json, proposer_of};
use crate::store::{
    BurstRow, Class, DismissStoryOutcome, KINDS_SHOWN, KindRow, MAX_PROPOSED_STORIES_PER_PROPOSER,
    MessageId, ProposedStoryKind, ProposedStoryMemberInput, ProposedStoryResult, Store, StoreError,
    StoryCursor, StoryMessage, StoryMessages, StoryRow, TokenRow, sender_id,
};

/// The name of the command that proposes a situation or cohort story.
pub const PROPOSE: &str = "mail-story-propose";

/// The name of the command that dismisses a proposed story.
pub const DISMISS: &str = "mail-story-dismiss";

/// Maximum title length (in Unicode scalar values) for a proposed story.
const MAX_TITLE_CHARS: usize = 200;

/// Maximum memberships evaluated in a single `mail-story-propose` call.
const MAX_MEMBERS: usize = 200;

/// Maximum characters in one membership's verbatim passage.
const MAX_PASSAGE_CHARS: usize = 1_000;

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

/// A story with, when it is a burst, the burst and the addresses of the
/// `known` senders that wrote during it.
struct Shown {
    row: StoryRow,
    burst: Option<(BurstRow, Vec<String>)>,
}

/// What a story's result needs from the store.
fn shown(store: &Store, row: StoryRow) -> Result<Shown, StoreError> {
    let burst = match store.burst(row.id)? {
        Some(burst) => {
            let known = store.known_during(&burst)?;
            Some((burst, known))
        }
        None => None,
    };
    Ok(Shown { row, burst })
}

/// A burst as a result gives it: when, how many first contacts, and its
/// flag, which names the `known` senders that wrote during it, since a
/// flood can be sent to hide one (the specification's 7.4).
pub(crate) fn burst_json(burst: &BurstRow, known: &[String]) -> Value {
    json!({
        "account": burst.account,
        "first": burst.first,
        "last": burst.last,
        "firstContacts": burst.messages,
        "knownDuring": known.iter().map(|address| sender_id(address)).collect::<Vec<_>>(),
        "content": content(json!({ "knownDuring": known })),
    })
}

/// A story as the commands give it: what the engine counted, and what came
/// from its mail in a content part.
fn story_json(shown: &Shown, tokens: &[TokenRow]) -> Value {
    let row = &shown.row;
    if let Some(proposed) = &row.proposed {
        return json!({
            "story": row.id,
            "kind": row.kind,
            "by": "proposed",
            "proposed": true,
            "proposer": proposer_json(&proposed.proposer, tokens),
            "proposedAt": proposed.proposed_at,
            "messages": row.messages,
            "exceptions": row.exceptions,
            "kinds": row.kinds,
            "firstDate": row.first_date,
            "lastDate": row.last_date,
            "content": content(json!({ "title": row.title })),
        });
    }
    if let Some((burst, known)) = &shown.burst {
        return json!({
            "story": row.id,
            "kind": row.kind,
            "by": "burst",
            "messages": row.messages,
            "exceptions": row.exceptions,
            "kinds": row.kinds,
            "firstDate": row.first_date,
            "lastDate": row.last_date,
            "burst": burst_json(burst, known),
            "content": content(json!({ "title": row.title })),
        });
    }
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
            let (rows, tokens) = when_ready(&self.engine, |store| {
                let rows = store
                    .stories(before, limit + 1)?
                    .into_iter()
                    .map(|row| shown(store, row))
                    .collect::<Result<Vec<_>, _>>()?;
                let tokens = store.tokens()?;
                Ok((rows, tokens))
            })?;
            let more = rows.len() > limit as usize;
            let items: Vec<Value> = rows
                .iter()
                .take(limit as usize)
                .map(|row| story_json(row, &tokens))
                .collect();
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
    story: Shown,
    kinds: Vec<KindRow>,
    messages: Vec<StoryMessage>,
    /// The members' classes: `bulk`, and `unknown` in a burst (or any class in a proposed story).
    classes: std::collections::HashMap<MessageId, Class>,
    tokens: Vec<TokenRow>,
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
                let is_proposed = story.proposed.is_some();
                let messages = store.story_messages(id, &which, before, limit + 1)?;
                let ids: Vec<MessageId> = messages.iter().map(|item| item.listed.message).collect();
                let kinds = if is_proposed {
                    Vec::new()
                } else {
                    store.story_kinds(id, KINDS_SHOWN)?
                };
                Ok(Some(Opened {
                    story: shown(store, story)?,
                    kinds,
                    classes: store.classes_of(&ids)?,
                    messages,
                    tokens: store.tokens()?,
                }))
            })?
            .ok_or_else(|| Box::new(story_not_found()))?;
            let budget = budget(&context, LIST_BUDGET);
            let story = story_json(&opened.story, &opened.tokens);
            // The card's kinds take at most a quarter of the room; the
            // messages the rest.
            let (kinds, kinds_cut) = fit(
                opened.kinds.iter().map(kind_json).collect(),
                budget / 4 + 1024,
            );
            let room = budget.saturating_sub(size(&story) + size(&json!(kinds)));
            let more = opened.messages.len() > limit as usize;
            let mut items = Vec::new();
            for member in opened.messages.iter().take(limit as usize) {
                let mut item = message_item(engine, &member.listed)
                    .map_err(|error| Box::new(store_failure(&error)))?;
                item["class"] = json!(
                    opened
                        .classes
                        .get(&member.listed.message)
                        .map_or("own", |class| class.as_str())
                );
                item["sender"] = json!(sender_id(&member.listed.sender_address));
                item["exception"] = json!(member.exception);
                item["kind"] = json!(member.kind.as_deref().map(hex));
                if let Some(passage) = &member.passage
                    && let Some(content_obj) =
                        item.get_mut("content").and_then(Value::as_object_mut)
                {
                    content_obj.insert("passage".to_string(), json!(passage));
                }
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
                // Its most common kinds of mail, each with a count, up to
                // ten; `kinds` above counts them all, and `kindsCut` says
                // the budget left some of the ten out.
                "kindsShown": kinds,
                "kindsCut": kinds_cut,
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
            let after = changes_cursor(&input)?;
            let limit = limit(&input, 100, 500)?;
            let (changes, rows, tokens) = when_ready(&self.engine, |store| {
                let changes = store.story_changes(after, limit + 1)?;
                let mut rows = Vec::with_capacity(changes.changed.len());
                for (story, _) in changes.changed.iter().take(limit as usize) {
                    rows.push(match store.story(*story)? {
                        Some(row) => Some(shown(store, row)?),
                        None => None,
                    });
                }
                let tokens = store.tokens()?;
                Ok((changes, rows, tokens))
            })?;
            let more = changes.changed.len() > limit as usize;
            let items: Vec<Value> = changes
                .changed
                .iter()
                .zip(&rows)
                .map(|((story, _), row)| match row {
                    Some(row) => {
                        let mut item = story_json(row, &tokens);
                        item["state"] = json!("current");
                        item
                    }
                    None => json!({ "story": story, "state": "gone" }),
                })
                .collect();
            let (kept, cut) = fit(items, budget(&context, LIST_BUDGET));
            // Read on from the last change given, or from now once every one
            // is given.
            let next = if more || cut {
                changes.changed[kept.len().saturating_sub(1)].1
            } else {
                changes.now
            };
            Ok(json!({
                "changes": kept,
                // Every story was made again since the cursor (a rebuild),
                // or the cursor is not this store's: read `mail-story-list`
                // again rather than trust what was kept, and follow on from
                // `nextCursor`.
                "reset": changes.reset,
                "more": more || cut,
                "nextCursor": format!("{}.{}", next.epoch, next.seq),
            }))
        };
        match read() {
            Ok(result) => success(result),
            Err(error) => failure(*error),
        }
    }
}

/// A cursor of `mail-story-changes`: the stories' epoch and a change's
/// number, as `nextCursor` wrote them.
fn changes_cursor(input: &Value) -> Result<Option<StoryCursor>, Box<CommandError>> {
    let wrong = || {
        invalid(
            "`cursor` is not one this command gave",
            "Pass the `nextCursor` of the result before, or none to start from now.",
        )
    };
    match input.get("cursor") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => {
            let (epoch, seq) = text.split_once('.').ok_or_else(wrong)?;
            Ok(Some(StoryCursor {
                epoch: epoch.parse().map_err(|_| wrong())?,
                seq: seq.parse().map_err(|_| wrong())?,
            }))
        }
        Some(_) => Err(wrong()),
    }
}

/// `mail-story-changes`: each story that changed after a cursor, once, with
/// what it is now or that it is gone, and a new cursor (the specification's
/// section 8). With no cursor, the cursor of now.
#[must_use]
pub fn story_changes(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-story-changes",
        "List the stories that changed since a cursor, each once, with a new cursor",
        vec![
            parameter(
                "cursor",
                JsonSchemaType::String,
                "The `nextCursor` of the call before; none to start from now",
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

// ─── Proposed stories (step E2; engine.spec.md section 10.2) ──────────────────

/// Caller's membership verdict in `mail-story-propose`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MembershipAnswer {
    Yes,
    No,
    Unsure,
}

impl MembershipAnswer {
    fn parse(text: &str) -> Option<Self> {
        match text {
            "yes" => Some(Self::Yes),
            "no" => Some(Self::No),
            "unsure" => Some(Self::Unsure),
            _ => None,
        }
    }
}

struct ParsedMember {
    message: MessageId,
    answer: MembershipAnswer,
    passage: String,
}

fn message_not_found() -> CommandError {
    CommandError::new("MESSAGE_NOT_FOUND", "no message has that id")
        .with_suggestion(
            "Use message ids returned by mail-message-list, mail-thread-open or mail-search.",
        )
        .with_retryable(false)
}

fn not_held() -> CommandError {
    CommandError::new(
        "NOT_HELD",
        "the message's body is not held yet, so its passages cannot be verified",
    )
    .with_suggestion("Run `mail-message-open` or `mail-sync` to fetch the message body first.")
    .with_retryable(true)
}

fn parse_proposed_kind(input: &Value) -> Result<ProposedStoryKind, Box<CommandError>> {
    match input.get("kind").and_then(Value::as_str) {
        Some(text) => ProposedStoryKind::parse(text).ok_or_else(|| {
            invalid(
                "`kind` must be `situation` or `cohort`",
                "Pass `kind` as `situation` or `cohort`.",
            )
        }),
        None => Err(invalid(
            "`kind` is required",
            "Pass `kind` as `situation` or `cohort`.",
        )),
    }
}

fn parse_proposed_title(input: &Value) -> Result<String, Box<CommandError>> {
    let Some(raw) = input.get("title").and_then(Value::as_str) else {
        return Err(invalid(
            "`title` is required",
            "Pass a short visible title for the proposed story.",
        ));
    };
    let title = raw.trim();
    if title.is_empty()
        || title
            .chars()
            .all(|c| c.is_whitespace() || matches!(c, '\u{200D}' | '\u{FE0F}'))
    {
        return Err(invalid(
            "`title` must contain visible text",
            "Pass a non-empty visible title for the proposed story.",
        ));
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(invalid(
            "`title` is longer than 200 characters",
            "Shorten `title` to at most 200 characters.",
        ));
    }
    if title.chars().any(|c| {
        c.is_control()
            || matches!(c, '\u{2028}' | '\u{2029}')
            || (crate::html::invisible(c) && !matches!(c, '\u{200D}' | '\u{FE0F}'))
    }) {
        return Err(invalid(
            "`title` contains forbidden control or invisible formatting characters",
            "Use plain visible text in `title`.",
        ));
    }
    Ok(title.to_string())
}

fn parse_proposed_members(input: &Value) -> Result<Vec<ParsedMember>, Box<CommandError>> {
    let Some(Value::Array(items)) = input.get("members") else {
        return Err(invalid(
            "`members` must be a non-empty list of memberships",
            "Pass 1 to 200 objects with `{ message, answer, passage }`.",
        ));
    };
    if items.is_empty() || items.len() > MAX_MEMBERS {
        return Err(invalid(
            "`members` must hold between 1 and 200 entries",
            "Pass 1 to 200 membership objects, at least one answered `yes`.",
        ));
    }
    let mut seen = HashSet::with_capacity(items.len());
    let mut parsed = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let Some(object) = item.as_object() else {
            return Err(Box::new(
                CommandError::new(
                    "INVALID_INPUT",
                    format!("`members[{index}]` must be an object"),
                )
                .with_suggestion("Pass each member as `{ message, answer, passage }`."),
            ));
        };
        let Some(msg_id) = object.get("message").and_then(Value::as_i64) else {
            return Err(Box::new(
                CommandError::new(
                    "INVALID_INPUT",
                    format!("`members[{index}].message` must be a message id"),
                )
                .with_suggestion("Pass a whole number message id."),
            ));
        };
        if !seen.insert(msg_id) {
            return Err(Box::new(
                CommandError::new(
                    "INVALID_INPUT",
                    format!("`members[{index}].message` duplicates an earlier message id"),
                )
                .with_suggestion("List each message at most once in `members`."),
            ));
        }
        let Some(answer_text) = object.get("answer").and_then(Value::as_str) else {
            return Err(Box::new(
                CommandError::new(
                    "INVALID_INPUT",
                    format!("`members[{index}].answer` must be `yes`, `no` or `unsure`"),
                )
                .with_suggestion("Pass `answer` as `yes`, `no` or `unsure`."),
            ));
        };
        let Some(answer) = MembershipAnswer::parse(answer_text) else {
            return Err(Box::new(
                CommandError::new(
                    "INVALID_INPUT",
                    format!("`members[{index}].answer` must be `yes`, `no` or `unsure`"),
                )
                .with_suggestion("Pass `answer` as `yes`, `no` or `unsure`."),
            ));
        };
        let Some(passage) = object.get("passage").and_then(Value::as_str) else {
            return Err(Box::new(
                CommandError::new(
                    "INVALID_INPUT",
                    format!("`members[{index}].passage` must be a verbatim quote string"),
                )
                .with_suggestion(
                    "Quote a non-empty substring from the message's visible text or subject.",
                ),
            ));
        };
        if passage.trim().is_empty() {
            return Err(Box::new(
                CommandError::new(
                    "INVALID_INPUT",
                    format!("`members[{index}].passage` must contain visible text"),
                )
                .with_suggestion(
                    "Quote a non-empty substring from the message's visible text or subject.",
                ),
            ));
        }
        if passage.chars().count() > MAX_PASSAGE_CHARS {
            return Err(Box::new(
                CommandError::new(
                    "INVALID_INPUT",
                    format!(
                        "`members[{index}].passage` is longer than {MAX_PASSAGE_CHARS} characters"
                    ),
                )
                .with_suggestion("Shorten each passage to at most 1000 characters."),
            ));
        }
        parsed.push(ParsedMember {
            message: MessageId(msg_id),
            answer,
            passage: passage.to_string(),
        });
    }
    if !parsed.iter().any(|m| m.answer == MembershipAnswer::Yes) {
        return Err(invalid(
            "a proposed story needs at least one membership answered `yes`",
            "Include at least one member with `answer: \"yes\"`.",
        ));
    }
    Ok(parsed)
}

struct StoryPropose {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for StoryPropose {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let kind = match parse_proposed_kind(&input) {
            Ok(kind) => kind,
            Err(error) => return failure(*error),
        };
        let title = match parse_proposed_title(&input) {
            Ok(title) => title,
            Err(error) => return failure(*error),
        };
        let members = match parse_proposed_members(&input) {
            Ok(members) => members,
            Err(error) => return failure(*error),
        };
        let considered = members.len();
        let proposer = proposer_of(&context);
        let now = context.clock().now();

        let done = self.engine.with_store(|store| {
            let mut yes_members = Vec::new();
            for (index, member) in members.iter().enumerate() {
                let Some(listed) = store.message_listed(member.message)? else {
                    return Ok(Err(Box::new(message_not_found())));
                };
                if store.shown_items(&[member.message.0])?.is_empty() {
                    return Ok(Err(Box::new(message_not_found())));
                }
                if !listed.held_whole && !listed.held_in_parts {
                    return Ok(Err(Box::new(not_held())));
                }
                let Some(whole) = store.body_bytes(member.message)? else {
                    return Ok(Err(Box::new(not_held())));
                };
                let reading = derive::reading(&whole);
                if verify_passages(
                    std::slice::from_ref(&member.passage),
                    &reading.visible,
                    &listed.subject,
                )
                .is_err()
                {
                    return Ok(Err(Box::new(
                        CommandError::new(
                            "PASSAGE_NOT_FOUND",
                            format!(
                                "`members[{index}].passage` was not found verbatim in the message's visible text or subject"
                            ),
                        )
                        .with_suggestion(
                            "Copy a verbatim substring from mail-message-open's visible text or subject; hidden text cannot ground a proposed story.",
                        )
                        .with_retryable(false),
                    )));
                }
                if member.answer == MembershipAnswer::Yes {
                    yes_members.push(ProposedStoryMemberInput {
                        message: member.message,
                        passage: member.passage.clone(),
                        date: listed.date,
                    });
                }
            }

            let stored = store.propose_story(
                kind,
                &title,
                &proposer,
                &yes_members,
                MAX_PROPOSED_STORIES_PER_PROPOSER,
                now,
            )?;
            match stored {
                ProposedStoryResult::Stored(row) => {
                    let tokens = store.tokens()?;
                    let stored_count = row.messages;
                    let mut out = story_json(
                        &Shown {
                            row: row.into_story_row(),
                            burst: None,
                        },
                        &tokens,
                    );
                    out["considered"] = json!(considered);
                    out["stored"] = json!(stored_count);
                    Ok(Ok(out))
                }
                ProposedStoryResult::TooMany(most) => Ok(Err(Box::new(
                    CommandError::new(
                        "POLICY_LIMIT",
                        format!(
                            "this caller has {most} active proposed stories already, the most it may hold"
                        ),
                    )
                    .with_suggestion(
                        "Dismiss unneeded proposed stories with `mail-story-dismiss`.",
                    )
                    .with_retryable(false),
                ))),
            }
        });

        match done {
            Ok(Ok(value)) => success(value),
            Ok(Err(error)) => failure(*error),
            Err(StoreError::NotFound("message")) => failure(message_not_found()),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-story-propose`: proposes a `situation` or `cohort` story grounded in
/// verified verbatim passages; each membership carries `yes`, `no` or `unsure`,
/// and only `yes` memberships are stored (engine.spec.md section 10.2).
#[must_use]
pub fn story_propose(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        PROPOSE,
        "Propose a situation or cohort story grounded in verified visible passages; only `yes` memberships are stored",
        vec![
            CommandParameter {
                name: "kind".to_string(),
                param_type: JsonSchemaType::String,
                description: "Story kind: `situation` or `cohort`".to_string(),
                required: true,
                default: None,
                enum_values: Some(
                    ProposedStoryKind::ALL
                        .iter()
                        .map(|kind| json!(kind.as_str()))
                        .collect(),
                ),
                schema: None,
            },
            parameter(
                "title",
                JsonSchemaType::String,
                "Short visible title for the proposed story (up to 200 characters)",
                true,
            ),
            CommandParameter {
                schema: Some(JsonSchema {
                    schema_type: Some(JsonSchemaType::Array),
                    items: Some(Box::new(JsonSchema {
                        schema_type: Some(JsonSchemaType::Object),
                        ..JsonSchema::default()
                    })),
                    ..JsonSchema::default()
                }),
                ..parameter(
                    "members",
                    JsonSchemaType::Array,
                    "1 to 200 membership objects `{ message, answer: \"yes\"|\"no\"|\"unsure\", passage }`; all passages are verified, only `yes` is stored",
                    true,
                )
            },
        ],
        StoryPropose { engine },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

struct StoryDismiss {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for StoryDismiss {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let id = match required(&input, "story") {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        let person = person_at_terminal(&context);
        let caller = proposer_of(&context);
        let now = context.clock().now();

        let done = self.engine.with_store(|store| {
            let Some(existing) = store.proposed_story(id)? else {
                return Ok(match store.story(id)? {
                    Some(_) => Err(Box::new(
                        CommandError::new(
                            "INVALID_INPUT",
                            format!("story {id} is not a proposed story"),
                        )
                        .with_suggestion(
                            "Only proposed `situation` and `cohort` stories can be dismissed.",
                        )
                        .with_retryable(false),
                    )),
                    None => Err(Box::new(story_not_found())),
                });
            };
            if !person && existing.proposer != caller {
                return Ok(Err(Box::new(
                    CommandError::new(
                        "FORBIDDEN",
                        "only the person at the terminal or the story's proposer may dismiss it",
                    )
                    .with_suggestion(
                        "Ask the person to dismiss the story at the terminal, or dismiss only stories you proposed.",
                    )
                    .with_retryable(false),
                )));
            }
            match store.dismiss_proposed_story(id, now)? {
                DismissStoryOutcome::Dismissed(row) => {
                    let tokens = store.tokens()?;
                    Ok(Ok(json!({
                        "story": row.id,
                        "kind": row.kind.as_str(),
                        "state": row.state.as_str(),
                        "dismissedAt": row.ended_at,
                        "proposer": proposer_json(&row.proposer, &tokens),
                    })))
                }
                DismissStoryOutcome::AlreadyDismissed => Ok(Err(Box::new(
                    CommandError::new(
                        "INVALID_INPUT",
                        format!("story {id} is already dismissed"),
                    )
                    .with_suggestion("Run `loam-mail mail-story-list` to see active stories.")
                    .with_retryable(false),
                ))),
                DismissStoryOutcome::NotProposedStory => Ok(Err(Box::new(
                    CommandError::new(
                        "INVALID_INPUT",
                        format!("story {id} is not a proposed story"),
                    )
                    .with_suggestion(
                        "Only proposed `situation` and `cohort` stories can be dismissed.",
                    )
                    .with_retryable(false),
                ))),
                DismissStoryOutcome::NotFound => Ok(Err(Box::new(story_not_found()))),
            }
        });

        match done {
            Ok(Ok(value)) => success(value),
            Ok(Err(error)) => failure(*error),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-story-dismiss`: dismisses a proposed story (person at terminal or its
/// proposer; non-destructive per M29).
#[must_use]
pub fn story_dismiss(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        DISMISS,
        "Dismiss a proposed situation or cohort story (person or its proposer)",
        vec![parameter(
            "story",
            JsonSchemaType::Integer,
            "The proposed story's id",
            true,
        )],
        StoryDismiss { engine },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

/// Parses optional `messages` input for `mail-replyset-create` (1..=limit unique positive ids).
///
/// # Errors
/// When `messages` is malformed, empty, over `limit`, or contains duplicates.
pub fn parse_replyset_messages(
    input: &Value,
    limit: usize,
) -> Result<Option<Vec<i64>>, Box<CommandError>> {
    let raw = match input.get("messages") {
        None | Some(Value::Null) => return Ok(None),
        Some(value) => value,
    };
    let Some(items) = raw.as_array() else {
        return Err(Box::new(
            CommandError::new(
                "INVALID_INPUT",
                "`messages` must be a non-empty list of message ids",
            )
            .with_suggestion(format!("Pass 1 to {limit} source message ids to reply to.")),
        ));
    };
    if items.is_empty() || items.len() > limit {
        return Err(Box::new(
            CommandError::new(
                "INVALID_INPUT",
                format!("a reply set holds between 1 and {limit} messages"),
            )
            .with_suggestion(format!("Pass 1 to {limit} source message ids.")),
        ));
    }
    let mut seen = HashSet::with_capacity(items.len());
    let mut out = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let Some(id) = item.as_i64().filter(|&id| id > 0) else {
            return Err(Box::new(
                CommandError::new(
                    "INVALID_INPUT",
                    format!("`messages[{index}]` must be a positive message id"),
                )
                .with_suggestion("Pass each message id as a positive integer."),
            ));
        };
        if !seen.insert(id) {
            return Err(Box::new(
                CommandError::new(
                    "INVALID_INPUT",
                    format!("`messages` lists message {id} more than once"),
                )
                .with_suggestion("Include each source message at most once in a reply set."),
            ));
        }
        out.push(id);
    }
    Ok(Some(out))
}

/// Resolves a story's message ids for `mail-replyset-create { story }` when
/// explicit `messages` are omitted.
///
/// # Errors
/// When the store fails.
pub fn replyset_story_messages(
    store: &Store,
    story_id: i64,
    limit: usize,
) -> Result<Result<Vec<i64>, Box<CommandError>>, StoreError> {
    if store.story(story_id)?.is_none() {
        return Ok(Err(Box::new(
            CommandError::new("STORY_NOT_FOUND", format!("there is no story {story_id}"))
                .with_suggestion("Run `loam-mail mail-story-list` to see the stories."),
        )));
    }
    let rows = store.story_messages(story_id, &StoryMessages::Every, None, (limit + 1) as u32)?;
    if rows.is_empty() || rows.len() > limit {
        return Ok(Err(Box::new(
            CommandError::new(
                "INVALID_INPUT",
                format!(
                    "story {story_id} holds {} messages; a reply set holds between 1 and {limit} messages",
                    rows.len()
                ),
            )
            .with_suggestion(format!(
                "Pass 1 to {limit} source message ids in `messages`."
            )),
        )));
    }
    Ok(Ok(rows.into_iter().map(|m| m.listed.message.0).collect()))
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
