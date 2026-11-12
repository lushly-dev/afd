//! The read commands (the specification's section 11): `mail-thread-list`,
//! `mail-thread-open`, `mail-message-open`, `mail-attachment-open` and
//! `mail-search`.
//!
//! Every value that came from a message (a subject, a name, an address as
//! written, a snippet, text, a link, a file's name) sits in a part labelled
//! `"trust": "content"`, Umbel's label (its D67); outside those parts a
//! result holds only what the engine vouches for: ids, counts, dates it
//! observed, flags and classes (12.1). Each command declares an output budget
//! and fits its result to it: fewer items with a cursor to read on, or a
//! shorter window of text with where to start the next.

use std::sync::Arc;

use afd::{
    ActorKind, CommandContext, CommandDefinition, CommandError, CommandHandler, CommandInterface,
    CommandParameter, CommandResult, ExposeOptions, JsonSchemaType, failure, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::commands::{provider_failure, store_failure};
use crate::derive;
use crate::engine::Engine;
use crate::fetch::{FetchError, fetch_body, fetch_part};
use crate::store::{MailboxId, MessageId, MessageListed, StoreError, ThreadId};

/// The room a result's own fields need beside its items, in bytes.
const ROOM: usize = 1024;

/// A content part: what came from a message, labelled as such.
fn content(mut value: Value) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.insert("trust".to_string(), json!("content"));
    }
    value
}

/// The size of a value written as JSON.
fn size(value: &Value) -> usize {
    serde_json::to_string(value).map_or(usize::MAX, |text| text.len())
}

/// What the registry's budget check measures of a successful result:
/// `data` inside the result's wrapper, without its metadata.
fn measured(data: &Value) -> usize {
    let result: CommandResult<Value> = success(data.clone());
    let Ok(mut whole) = serde_json::to_value(&result) else {
        return usize::MAX;
    };
    if let Some(object) = whole.as_object_mut() {
        object.remove("metadata");
    }
    size(&whole)
}

/// Bytes kept free beside a measured result, for how the registry's
/// canonical form may write it differently.
const SLACK: usize = 64;

/// The failure of a result that cannot be made to fit the call's budget.
fn too_small(budget: usize) -> CommandError {
    CommandError::new(
        afd::error_codes::OUTPUT_BUDGET_EXCEEDED,
        format!("the result does not fit this call's output budget of {budget} bytes"),
    )
    .with_suggestion(if (budget as u64) < MOST_BUDGET {
        format!(
            "Ask for a larger output budget, up to {MOST_BUDGET} bytes, with _meta[\"dev.afd/outputBudget\"] = {{ \"maxBytes\": {MOST_BUDGET} }}."
        )
    } else {
        "This is the command's largest budget; open the message's files on their own with `mail-attachment-open`.".to_string()
    })
}

/// The effective budget, in bytes.
fn budget(context: &CommandContext, default: u64) -> usize {
    usize::try_from(context.output_budget().unwrap_or(default)).unwrap_or(usize::MAX)
}

/// An optional integer input.
fn integer(input: &Value, name: &str) -> Result<Option<i64>, Box<CommandError>> {
    match input.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value.as_i64().map(Some).ok_or_else(|| {
            Box::new(
                CommandError::new("INVALID_INPUT", format!("`{name}` is a whole number"))
                    .with_suggestion(format!("Pass `{name}` as a whole number.")),
            )
        }),
    }
}

/// A required integer input.
fn required(input: &Value, name: &str) -> Result<i64, Box<CommandError>> {
    integer(input, name)?.ok_or_else(|| {
        Box::new(
            CommandError::new("INVALID_INPUT", format!("`{name}` is required"))
                .with_suggestion(format!("Pass `{name}`, an id a list gave.")),
        )
    })
}

/// How many items a list may hold: `limit`, from 1 to `most`.
fn limit(input: &Value, default: u32, most: u32) -> Result<u32, Box<CommandError>> {
    Ok(match integer(input, "limit")? {
        None => default,
        Some(asked) => u32::try_from(asked.clamp(1, i64::from(most))).unwrap_or(default),
    })
}

/// A cursor: the date and id of the last item of the page before.
fn cursor(input: &Value) -> Result<Option<(i64, i64)>, Box<CommandError>> {
    let Some(text) = input.get("cursor").and_then(Value::as_str) else {
        return Ok(None);
    };
    text.split_once('.')
        .and_then(|(date, id)| Some((date.parse().ok()?, id.parse().ok()?)))
        .map(Some)
        .ok_or_else(|| {
            Box::new(
                CommandError::new("INVALID_INPUT", "`cursor` is not one this command gave")
                    .with_suggestion("Pass the `nextCursor` of the result before, or none."),
            )
        })
}

/// A start within a text or a file: `from`, never below 0.
fn start(input: &Value) -> Result<usize, Box<CommandError>> {
    Ok(usize::try_from(integer(input, "from")?.unwrap_or(0).max(0)).unwrap_or(usize::MAX))
}

/// A message that does not exist.
fn message_not_found() -> CommandError {
    CommandError::new("MESSAGE_NOT_FOUND", "no message has that id")
        .with_suggestion("Run `loam-mail mail-thread-open` to see a thread's messages.")
}

/// Items fitted to a budget: as many as fit, in order, and whether any
/// were left out.
fn fit(items: Vec<Value>, budget: usize) -> (Vec<Value>, bool) {
    let mut used = ROOM;
    let mut kept = Vec::with_capacity(items.len());
    let total = items.len();
    for item in items {
        let item_size = size(&item) + 1;
        if used + item_size > budget && !kept.is_empty() {
            break;
        }
        used += item_size;
        kept.push(item);
    }
    let cut = kept.len() < total;
    (kept, cut)
}

fn parameter(
    name: &str,
    kind: JsonSchemaType,
    description: &str,
    required: bool,
) -> CommandParameter {
    CommandParameter {
        name: name.to_string(),
        param_type: kind,
        description: description.to_string(),
        required,
        default: None,
        enum_values: None,
        schema: None,
    }
}

/// Exposed to the command line and to MCP (the specification's section 11).
fn read_exposure() -> ExposeOptions {
    ExposeOptions::new().with_cli(true).with_mcp(true)
}

/// A message's evidence, as the engine vouches for it. Authentication
/// results are given only when the account's own provider wrote them.
fn evidence(engine: &Engine, listed: &MessageListed) -> Result<Value, StoreError> {
    let provider = engine.with_store(|store| {
        Ok(store
            .where_shown(listed.message)?
            .first()
            .map(|shown| shown.provider.clone()))
    })?;
    let evidence = &listed.evidence;
    let trusted = provider.is_some_and(|provider| {
        !evidence.auth_server.is_empty()
            && derive::trusted_authentication(&provider, &evidence.auth_server)
    });
    let authentication = trusted.then(|| {
        json!({
            "spf": evidence.auth[0],
            "dkim": evidence.auth[1],
            "dmarc": evidence.auth[2],
        })
    });
    Ok(json!({
        "list": evidence.list,
        "unsubscribe": match evidence.unsubscribe {
            2 => "one-click",
            1 => "header",
            _ => "none",
        },
        "bulk": evidence.bulk,
        "replyToDiffers": evidence.reply_to_differs,
        "authentication": authentication,
        "hiddenChars": evidence.hidden_chars,
        "links": evidence.links,
        "mismatchedLinks": evidence.mismatched_links,
        "filesDiffering": evidence.files_differing,
    }))
}

/// A message as a list shows it.
fn message_item(engine: &Engine, listed: &MessageListed) -> Result<Value, StoreError> {
    Ok(json!({
        "message": listed.message.0,
        "thread": listed.thread.0,
        "date": listed.date,
        "size": listed.size,
        "heldWhole": listed.held_whole,
        "heldInParts": listed.held_in_parts,
        "attachments": listed.attachments,
        "unparsed": listed.unparsed,
        "evidence": evidence(engine, listed)?,
        "content": content(json!({
            "sender": { "name": listed.sender_name, "address": listed.sender_address },
            "subject": listed.subject,
            "snippet": listed.snippet,
        })),
    }))
}

struct ThreadList {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for ThreadList {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let read = || -> Result<Value, Box<CommandError>> {
            let mailbox = MailboxId(required(&input, "mailbox")?);
            let limit = limit(&input, 50, 200)?;
            let before = cursor(&input)?.map(|(date, thread)| (date, ThreadId(thread)));
            let engine = &self.engine;
            let threads = engine
                .with_store(|store| {
                    if !store.mailbox_exists(mailbox)? {
                        return Ok(None);
                    }
                    store.list_threads(mailbox, before, limit + 1).map(Some)
                })
                .map_err(|error| Box::new(store_failure(&error)))?
                .ok_or_else(|| {
                    Box::new(
                        CommandError::new("MAILBOX_NOT_FOUND", "no mailbox has that id")
                            .with_suggestion("Run `loam-mail mail-status` to see the mailboxes."),
                    )
                })?;
            let more = threads.len() > limit as usize;
            let items: Vec<Value> = threads
                .iter()
                .take(limit as usize)
                .map(|thread| {
                    json!({
                        "thread": thread.thread.0,
                        "lastDate": thread.last_date,
                        "shown": thread.shown,
                        "unread": thread.unread,
                        "messages": thread.messages,
                        "attachments": thread.attachments,
                        "content": content(json!({
                            "subject": thread.subject,
                            "snippet": thread.snippet,
                            "lastSender": thread.last_sender,
                        })),
                    })
                })
                .collect();
            let (kept, cut) = fit(items, budget(&context, LIST_BUDGET));
            let next = (more || cut)
                .then(|| kept.last())
                .flatten()
                .map(|last| format!("{}.{}", last["lastDate"], last["thread"]));
            Ok(json!({ "mailbox": mailbox.0, "threads": kept, "nextCursor": next }))
        };
        match read() {
            Ok(result) => success(result),
            Err(error) => failure(*error),
        }
    }
}

const LIST_BUDGET: u64 = 32 * 1024;
const OPEN_BUDGET: u64 = 64 * 1024;
const MOST_BUDGET: u64 = 4 * 1024 * 1024;

/// `mail-thread-list`: a mailbox's threads, newest first, paged by cursor.
#[must_use]
pub fn thread_list(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-thread-list",
        "List a mailbox's threads, newest first",
        vec![
            parameter(
                "mailbox",
                JsonSchemaType::Integer,
                "The mailbox, by id",
                true,
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
                "At most this many threads (1 to 200)",
                false,
            ),
        ],
        ThreadList { engine },
    )
    .with_output_budget(LIST_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}

struct ThreadOpen {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for ThreadOpen {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let read = || -> Result<Value, Box<CommandError>> {
            let thread = ThreadId(required(&input, "thread")?);
            let limit = limit(&input, 50, 200)?;
            let after = cursor(&input)?.map(|(date, message)| (date, MessageId(message)));
            let engine = &self.engine;
            let messages = engine
                .with_store(|store| {
                    if !store.thread_exists(thread)? {
                        return Ok(None);
                    }
                    store.thread_messages(thread, after, limit + 1).map(Some)
                })
                .map_err(|error| Box::new(store_failure(&error)))?
                .ok_or_else(|| {
                    Box::new(
                        CommandError::new("THREAD_NOT_FOUND", "no thread has that id")
                            .with_suggestion(
                                "Run `loam-mail mail-thread-list` to see a mailbox's threads.",
                            ),
                    )
                })?;
            let more = messages.len() > limit as usize;
            let mut items = Vec::new();
            for listed in messages.iter().take(limit as usize) {
                items.push(
                    message_item(engine, listed)
                        .map_err(|error| Box::new(store_failure(&error)))?,
                );
            }
            let (kept, cut) = fit(items, budget(&context, OPEN_BUDGET));
            let next = (more || cut)
                .then(|| kept.last())
                .flatten()
                .map(|last| format!("{}.{}", last["date"], last["message"]));
            Ok(json!({ "thread": thread.0, "messages": kept, "nextCursor": next }))
        };
        match read() {
            Ok(result) => success(result),
            Err(error) => failure(*error),
        }
    }
}

/// `mail-thread-open`: a thread's messages, oldest first, paged by cursor.
#[must_use]
pub fn thread_open(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-thread-open",
        "Show a thread's messages, oldest first",
        vec![
            parameter("thread", JsonSchemaType::Integer, "The thread, by id", true),
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
        ThreadOpen { engine },
    )
    .with_output_budget(OPEN_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}

/// Whether the caller is a person at a terminal, to whom the raw HTML and
/// the hidden text may be shown: not a script, and not an agent, which
/// reaches the engine through a script or MCP.
fn person_at_terminal(context: &CommandContext) -> bool {
    context.interface == Some(CommandInterface::Cli)
        && context
            .actor
            .as_ref()
            .is_some_and(|actor| actor.kind == ActorKind::Human)
}

/// Whether the caller came through the command line, a person or a script:
/// it gets a file it can open, not bytes in its result.
fn at_the_command_line(context: &CommandContext) -> bool {
    context.interface == Some(CommandInterface::Cli)
}

/// The most links a message's result lists.
const LINKS_SHOWN: usize = 100;

/// The least room worth a window of text, in bytes.
const LEAST_WINDOW: usize = 256;

/// What `mail-message-open` gathers before it fits a result.
struct Opened {
    head: Value,
    body: Value,
    links: Vec<Value>,
    links_shown: usize,
    html: Option<(String, Vec<String>)>,
    hidden: Option<String>,
    left_out: Vec<&'static str>,
}

impl Opened {
    /// The result, with `window` as its text.
    fn result(&self, window: &str, from: usize, total: usize, next: Option<usize>) -> Value {
        let mut content_part = content(self.body.clone());
        content_part["links"] = json!(&self.links[..self.links_shown.min(self.links.len())]);
        if let Some((html, remote)) = &self.html {
            content_part["html"] = json!(html);
            content_part["remote"] = json!(remote);
        }
        if let Some(hidden) = &self.hidden {
            content_part["hidden"] = json!(hidden);
        }
        content_part["text"] = json!(window);
        let mut result = self.head.clone();
        result["linksShown"] = json!(self.links_shown.min(self.links.len()));
        result["leftOut"] = json!(self.left_out);
        result["textFrom"] = json!(from);
        result["textLength"] = json!(total);
        result["nextFrom"] = json!(next);
        result["content"] = content_part;
        result
    }

    /// Leaves out the next thing that can go, largest first: the HTML, the
    /// hidden text, then half the links. `false` when nothing is left to
    /// leave out.
    fn shrink(&mut self) -> bool {
        if self.html.take().is_some() {
            self.left_out.push("html");
        } else if self.hidden.take().is_some() {
            self.left_out.push("hidden");
        } else if self.links_shown > 0 {
            self.links_shown /= 2;
        } else {
            return false;
        }
        true
    }
}

/// A part read from the log, or `None` when it is not held.
fn held_part(
    store: &crate::store::Store,
    message: MessageId,
    part: &str,
) -> Result<Option<Vec<u8>>, StoreError> {
    match store.read_part(message, part) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(StoreError::NotFound(_)) => Ok(None),
        Err(error) => Err(error),
    }
}

struct MessageOpen {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for MessageOpen {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let message = match required(&input, "message") {
            Ok(message) => MessageId(message),
            Err(error) => return failure(*error),
        };
        let flag = |name: &str| input.get(name).and_then(Value::as_bool);
        let wants_html = flag("html").unwrap_or(false);
        let wants_hidden = flag("hidden").unwrap_or(false);
        if (wants_html || wants_hidden) && !person_at_terminal(&context) {
            return failure(
                CommandError::new(
                    "INVALID_INPUT",
                    "the HTML and the hidden text are shown to a person at a terminal",
                )
                .with_suggestion("Read the message's visible text, which every caller gets."),
            );
        }
        let from = match start(&input) {
            Ok(from) => from,
            Err(error) => return failure(*error),
        };
        let engine = &self.engine;
        let listed = match engine.with_store(|store| store.message_listed(message)) {
            Ok(Some(listed)) => listed,
            Ok(None) => return failure(message_not_found()),
            Err(error) => return failure(store_failure(&error)),
        };
        // A message someone opens is fetched at once (5.3).
        let mut body_note = None;
        if !listed.held_whole && !listed.held_in_parts && flag("fetch").unwrap_or(true) {
            match fetch_body(engine, message, context.clock().now()).await {
                Ok(_) => {}
                Err(FetchError::Store(error)) => return failure(store_failure(&error)),
                Err(error) => body_note = Some(error.to_string()),
            }
        }
        let opened = engine.with_store(|store| {
            let listed = store
                .message_listed(message)?
                .ok_or(StoreError::NotFound("message"))?;
            let header = held_part(store, message, "header")?;
            // The whole message, or the one written from its parts held.
            let whole = store.body_bytes(message)?;
            Ok((
                listed,
                header,
                whole,
                store.message_links(message)?,
                store.message_parts(message)?,
                store.where_shown(message)?,
            ))
        });
        let (listed, header, whole, links, parts, shown) = match opened {
            Ok(opened) => opened,
            Err(error) => return failure(store_failure(&error)),
        };
        let recipients = header
            .as_deref()
            .map(derive::recipients)
            .unwrap_or_default();
        let reading = whole.as_deref().map(derive::reading);
        let evidence = match evidence(engine, &listed) {
            Ok(evidence) => evidence,
            Err(error) => return failure(store_failure(&error)),
        };
        let people = |list: &[(String, String)]| -> Value {
            list.iter()
                .map(|(address, name)| json!({ "address": address, "name": name }))
                .collect()
        };
        // What the HTML would load is counted for every caller; the
        // addresses and the HTML itself go to a person who asks.
        let cleaned = reading
            .as_ref()
            .and_then(|reading| reading.html.as_deref())
            .map(crate::html::clean);
        let remote_count = cleaned.as_ref().map_or(0, |cleaned| cleaned.remote.len());
        let links: Vec<Value> = links
            .iter()
            .take(LINKS_SHOWN)
            .map(|link| {
                json!({
                    "target": link.target,
                    "targetHost": link.target_host,
                    "textHost": link.text_host,
                    "mismatched": link.mismatched,
                })
            })
            .collect();
        let mut opened = Opened {
            head: json!({
                "message": message.0,
                "thread": listed.thread.0,
                "date": listed.date,
                "size": listed.size,
                "heldWhole": listed.held_whole,
                "heldInParts": listed.held_in_parts,
                "bodyNotFetched": body_note,
                "unparsed": listed.unparsed,
                "mailboxes": shown.iter().map(|shown| json!({
                    "mailbox": shown.mailbox.0,
                    "role": shown.role.as_str(),
                    "seen": shown.flags.contains("\\\\Seen"),
                })).collect::<Vec<_>>(),
                "evidence": evidence,
                "remoteReferences": remote_count,
            }),
            body: json!({
                "sender": { "name": listed.sender_name, "address": listed.sender_address },
                "to": people(&recipients.to),
                "cc": people(&recipients.cc),
                "replyTo": people(&recipients.reply_to),
                "subject": listed.subject,
                "files": parts.iter().filter(|part| part.attachment || !part.name.is_empty()).map(|part| json!({
                    "place": part.place,
                    "name": part.name,
                    "type": part.content_type,
                    "size": part.size,
                    "detected": part.detected,
                    "typeDiffers": part.type_differs,
                })).collect::<Vec<_>>(),
            }),
            links_shown: links.len(),
            links,
            html: cleaned
                .filter(|_| wants_html)
                .map(|cleaned| (cleaned.html, cleaned.remote)),
            hidden: reading
                .as_ref()
                .filter(|_| wants_hidden)
                .map(|reading| reading.hidden.clone()),
            left_out: Vec::new(),
        };
        // The text gets what room is left, from `from`, in characters. The
        // rest of the result is measured as the budget measures it, with the
        // largest numbers it can hold, and made smaller until a window fits.
        let text = reading.map(|reading| reading.visible).unwrap_or_default();
        let total = text.chars().count();
        let from = from.min(total);
        let rest: String = text.chars().skip(from).collect();
        let budget = budget(&context, OPEN_BUDGET);
        let need = if rest.is_empty() { 0 } else { LEAST_WINDOW };
        let fixed = loop {
            let fixed = measured(&opened.result("", from, total, Some(total))) + SLACK;
            if fixed + need <= budget {
                break fixed;
            }
            if !opened.shrink() {
                return failure(too_small(budget));
            }
        };
        // `fit_text` counts the quotes the empty text was measured with.
        let window = fit_text(&rest, budget - fixed + 2);
        let shown_chars = window.chars().count();
        if shown_chars == 0 && !rest.is_empty() {
            return failure(too_small(budget));
        }
        let next = (from + shown_chars < total).then_some(from + shown_chars);
        success(opened.result(&window, from, total, next))
    }
}

/// The start of `text` that fits in `bytes` once written as JSON.
fn fit_text(text: &str, bytes: usize) -> String {
    let mut kept = String::new();
    let mut used = 2;
    for character in text.chars() {
        let cost = match character {
            '"' | '\\' | '\n' | '\r' | '\t' | '\u{8}' | '\u{c}' => 2,
            c if (c as u32) < 0x20 => 6,
            c => c.len_utf8(),
        };
        if used + cost > bytes {
            break;
        }
        used += cost;
        kept.push(character);
    }
    kept
}

/// `mail-message-open`: one message, fetched first if its body is not held,
/// with its evidence and a window of its visible text.
#[must_use]
pub fn message_open(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-message-open",
        "Show a message: who it is from and to, its evidence and its text",
        vec![
            parameter(
                "message",
                JsonSchemaType::Integer,
                "The message, by id",
                true,
            ),
            parameter(
                "from",
                JsonSchemaType::Integer,
                "Where the text window starts, in characters",
                false,
            ),
            parameter(
                "fetch",
                JsonSchemaType::Boolean,
                "Fetch the body if it is not held (default true)",
                false,
            ),
            parameter(
                "html",
                JsonSchemaType::Boolean,
                "At the command line: the cleaned HTML too",
                false,
            ),
            parameter(
                "hidden",
                JsonSchemaType::Boolean,
                "At the command line: the hidden text too",
                false,
            ),
        ],
        MessageOpen { engine },
    )
    .with_output_budget(OPEN_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}

struct AttachmentOpen {
    engine: Arc<Engine>,
}

/// A fetch that failed, as `mail-attachment-open`'s failure.
fn fetch_failure(error: &FetchError) -> CommandError {
    match error {
        FetchError::Store(error) => store_failure(error),
        FetchError::Provider(error) => provider_failure(error),
        FetchError::NotReturned => CommandError::new("NOT_HELD", error.to_string())
            .with_suggestion("Try again later; the provider may return it then.")
            .with_retryable(true),
        FetchError::NoConnector => CommandError::new("NOT_HELD", error.to_string())
            .with_suggestion("Use a build of loam-mail that reaches providers."),
        FetchError::Conflict => CommandError::new("NOT_HELD", error.to_string())
            .with_suggestion("Run `loam-mail mail-status`; the message's bytes need a look."),
        FetchError::NotShown | FetchError::Moved => {
            CommandError::new("NOT_HELD", error.to_string())
                .with_suggestion("Sync the account, then open the file again.")
        }
    }
}

#[async_trait]
impl CommandHandler for AttachmentOpen {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let message = match required(&input, "message") {
            Ok(message) => MessageId(message),
            Err(error) => return failure(*error),
        };
        let Some(place) = input
            .get("place")
            .and_then(Value::as_str)
            .map(str::to_string)
        else {
            return failure(
                CommandError::new("INVALID_INPUT", "`place` is required")
                    .with_suggestion("Pass a file's `place`, as `mail-message-open` lists it."),
            );
        };
        let from = match start(&input) {
            Ok(from) => from,
            Err(error) => return failure(*error),
        };
        let engine = &self.engine;
        let listed = match engine.with_store(|store| store.message_listed(message)) {
            Ok(Some(listed)) => listed,
            Ok(None) => return failure(message_not_found()),
            Err(error) => return failure(store_failure(&error)),
        };
        let now = context.clock().now();
        if !listed.held_whole
            && !listed.held_in_parts
            && let Err(error) = fetch_body(engine, message, now).await
        {
            return failure(fetch_failure(&error));
        }
        let part_missing = || {
            CommandError::new("PART_NOT_FOUND", "the message has no file at that place")
                .with_suggestion(
                    "Run `loam-mail mail-message-open` to see its files and their places.",
                )
        };
        let part = match engine.with_store(|store| store.message_parts(message)) {
            Ok(parts) => parts.into_iter().find(|part| part.place == place),
            Err(error) => return failure(store_failure(&error)),
        };
        let Some(part) = part else {
            return failure(part_missing());
        };
        // A file of a message held in parts is fetched when it is opened
        // (M20).
        if let Err(error) = fetch_part(engine, message, &place, now).await {
            return failure(fetch_failure(&error));
        }
        // What is read is as `mail-message-open` lists it, after the fetch:
        // its type as its bytes show it, once they are held.
        let found = engine.with_store(|store| {
            let part = store
                .message_parts(message)?
                .into_iter()
                .find(|part| part.place == place);
            Ok((part, store.body_bytes(message)?))
        });
        let (part, whole) = match found {
            Ok((Some(found), whole)) => (found, whole),
            Ok((None, _)) => (part, None),
            Err(error) => return failure(store_failure(&error)),
        };
        let Some(bytes) = whole.and_then(|whole| derive::part_content(&whole, &place)) else {
            return failure(part_missing());
        };
        let total = bytes.len();
        let mut about = json!({
            "message": message.0,
            "place": place,
            "size": total,
            "detected": part.detected,
            "typeDiffers": part.type_differs,
            "content": content(json!({ "name": part.name, "type": part.content_type })),
        });
        if at_the_command_line(&context) {
            // A file in the data directory, private to the user, named by
            // the engine: the message's id, the part's place and an ending
            // for what its bytes show. Nothing the message wrote names it.
            let Some(home) = engine.home() else {
                return failure(store_failure(&StoreError::Home(
                    crate::home::HomeError::Unknown,
                )));
            };
            let attachments = home.root().join("attachments");
            let directory = attachments.join(message.0.to_string());
            let mut name = place.replace('.', "_");
            if let Some(ending) = derive::ending(&part.detected) {
                name = format!("{name}.{ending}");
            }
            let path = directory.join(name);
            if let Err(error) = write_private(&[&attachments, &directory], &path, &bytes) {
                return failure(store_failure(&StoreError::Home(
                    crate::home::HomeError::Io(error),
                )));
            }
            about["path"] = json!(path.display().to_string());
            return success(about);
        }
        // Anyone else gets the bytes, labelled as content, a window of them
        // at a time within the budget: whole groups of three bytes, which
        // base64 writes as four.
        let from = from.min(total);
        about["bytesFrom"] = json!(from);
        about["nextFrom"] = json!(total);
        about["content"]["bytes"] = json!("");
        let budget = budget(&context, ATTACHMENT_BUDGET);
        let room = budget.saturating_sub(measured(&about) + SLACK);
        let take = (room / 4 * 3).min(total - from);
        if take == 0 && from < total {
            return failure(too_small(budget));
        }
        about["content"]["bytes"] = json!(base64(&bytes[from..from + take]));
        about["nextFrom"] = json!((from + take < total).then_some(from + take));
        success(about)
    }
}

/// Writes `bytes` to `path` with the file and each of `directories` private
/// to the user.
fn write_private(
    directories: &[&std::path::Path],
    path: &std::path::Path,
    bytes: &[u8],
) -> std::io::Result<()> {
    for directory in directories {
        std::fs::create_dir_all(directory)?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        for directory in directories {
            std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))?;
        }
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        std::io::Write::write_all(&mut file, bytes)?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, bytes)
    }
}

/// Standard base64, padded.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for (index, shift) in [18, 12, 6, 0].into_iter().enumerate() {
            if index <= chunk.len() {
                out.push(char::from(ALPHABET[((n >> shift) & 63) as usize]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// The budget of `mail-attachment-open` when none is asked for.
const ATTACHMENT_BUDGET: u64 = 1024 * 1024;

/// `mail-attachment-open`: one of a message's files. The command line gets
/// a file in the data directory; another caller gets its bytes, labelled as
/// content, a window at a time within the budget.
#[must_use]
pub fn attachment_open(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-attachment-open",
        "Open one of a message's files",
        vec![
            parameter(
                "message",
                JsonSchemaType::Integer,
                "The message, by id",
                true,
            ),
            parameter(
                "place",
                JsonSchemaType::String,
                "The file's place, as the message lists it",
                true,
            ),
            parameter(
                "from",
                JsonSchemaType::Integer,
                "Where the window of bytes starts",
                false,
            ),
        ],
        AttachmentOpen { engine },
    )
    .with_output_budget(ATTACHMENT_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}

struct Search {
    engine: Arc<Engine>,
}

/// The most hits a search reads, over all its pages.
const SEARCH_MOST: usize = 1000;

#[async_trait]
impl CommandHandler for Search {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let Some(query) = input
            .get("query")
            .and_then(Value::as_str)
            .map(str::to_string)
        else {
            return failure(
                CommandError::new("INVALID_INPUT", "`query` is required")
                    .with_suggestion("Pass `query`, the words to look for."),
            );
        };
        let limit = match limit(&input, 50, 200) {
            Ok(limit) => limit as usize,
            Err(error) => return failure(*error),
        };
        // The cursor is how many hits the pages before held.
        let skip = match input.get("cursor").and_then(Value::as_str) {
            None => 0,
            Some(text) => match text.parse::<usize>() {
                Ok(skip) if skip < SEARCH_MOST => skip,
                _ => {
                    return failure(
                        CommandError::new("INVALID_INPUT", "`cursor` is not one this command gave")
                            .with_suggestion(
                                "Pass the `nextCursor` of the result before, or none.",
                            ),
                    );
                }
            },
        };
        let wanted = u32::try_from((skip + limit + 1).min(SEARCH_MOST)).unwrap_or(u32::MAX);
        let found = match self.engine.with_store(|store| store.search(&query, wanted)) {
            Ok(found) => found,
            Err(error) => return failure(store_failure(&error)),
        };
        let more = found.len() > skip + limit;
        let items: Vec<Value> = found
            .iter()
            .skip(skip)
            .take(limit)
            .map(|hit| {
                json!({
                    "message": hit.message.0,
                    "thread": hit.thread.0,
                    "date": hit.date,
                    "content": content(json!({
                        "subject": hit.subject,
                        "snippet": hit.snippet,
                        "sender": hit.sender,
                    })),
                })
            })
            .collect();
        let (kept, cut) = fit(items, budget(&context, LIST_BUDGET));
        let next = skip + kept.len();
        let next = ((more || cut) && next < SEARCH_MOST).then(|| next.to_string());
        success(json!({ "hits": kept, "nextCursor": next }))
    }
}

/// `mail-search`: the messages that best match a query, best first, paged
/// by cursor up to the first 1 000.
#[must_use]
pub fn search(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-search",
        "Search the mail's subjects and visible text",
        vec![
            parameter("query", JsonSchemaType::String, "What to look for", true),
            parameter(
                "cursor",
                JsonSchemaType::String,
                "Where the page before ended; each page searches again, so mail that arrives between pages can move a hit",
                false,
            ),
            parameter(
                "limit",
                JsonSchemaType::Integer,
                "At most this many messages (1 to 200)",
                false,
            ),
        ],
        Search { engine },
    )
    .with_output_budget(LIST_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_is_standard() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"%PDF-1.7"), "JVBERi0xLjc=");
    }

    #[test]
    fn text_is_fitted_without_cutting_a_character() {
        assert_eq!(fit_text("héllo", 5), "hé");
        assert_eq!(fit_text("a\"b", 5), "a\"");
    }
}
