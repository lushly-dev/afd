//! Reply sets (steps E3 and F3; the specification's 10.3, section 11, M18
//! amended and M29; plugin.spec.md sections 6, 7 and 9): `mail-replyset-create`,
//! `mail-replyset-update`, `mail-replyset-next`, `mail-replyset-submit`,
//! `mail-replyset-show`, `mail-replyset-preview` (the send's confirmation
//! preview, D175) and `mail-replyset-send`.
//!
//! Each reply's recipient is derived by the engine from its source message's
//! `From` header at creation and stored with the reply so callers cannot set
//! recipients and re-deriving a message cannot change them. `mail-replyset-next`
//! is a pure read that hands out one reply's own source message visible text
//! and linked answers as a `dev.loam/unit` with a stateless single-use claim;
//! `mail-replyset-submit` records the composed reply against that claim.
//! `mail-replyset-send` is destructive and held for approval at the terminal or
//! through an approver over MCP, bound to the previewed `revision`.

#[path = "replysets_preview.rs"]
mod preview;
#[path = "replysets_send.rs"]
mod send;
#[path = "replysets_units.rs"]
mod units;

pub use preview::{
    HEAD_VALUES, REPLY_VALUES, SHELL_MAX_BYTES, SHELL_REPLIES, SHELL_VALUES_MAX, preview,
};
pub use send::{approval_summary, pre_approval_check, send};
pub use units::{INSTRUCTIONS_VERSION, UNIT_INSTRUCTIONS, next, submit};

use std::collections::HashSet;
use std::sync::Arc;

use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandInterface,
    CommandResult, JsonSchemaType, failure, input_digest, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::commands::store_failure;
use crate::derive;
use crate::engine::Engine;
use crate::provider::ProviderError;
use crate::read::{
    MOST_BUDGET, budget, content, fits, integer, parameter, read_exposure, required,
};
use crate::screening::proposer_of;
use crate::store::{
    AccountId, AccountRow, AnswerUpdate, MessageId, NewQuestion, NewReplySet, Proposer, ReplyEdit,
    ReplyRow, ReplySendState, ReplySetChange, ReplySetDetail, ReplySetRefusal, ReplySetSendRefusal,
    ReplySetState, ReplySource, SourceRefusal, Store, StoreError,
};

/// Command name for creating a reply set.
pub const CREATE: &str = "mail-replyset-create";
/// Command name for updating a reply set (answers, shared text, reply edits).
pub const UPDATE: &str = "mail-replyset-update";
/// Command name for pulling the next isolated reply unit (pure read).
pub const NEXT: &str = "mail-replyset-next";
/// Command name for submitting composed text against an open unit and claim.
pub const SUBMIT: &str = "mail-replyset-submit";
/// Command name for previewing a reply set whole.
pub const SHOW: &str = "mail-replyset-show";
/// Command name for the send's confirmation preview (D175).
pub const PREVIEW: &str = "mail-replyset-preview";
/// Command name for sending a reply set after preview and approval.
pub const SEND: &str = "mail-replyset-send";

/// Reply-set mutation commands whose results hold content stripped from the
/// journal (the specification's 13.1).
pub const RESULTS_WITH_TEXT: &[&str] = &[CREATE, UPDATE];

/// Maximum number of replies in one reply set (plugin.spec.md M39).
pub const MOST_REPLIES: usize = 50;
/// Maximum number of cohort questions in one reply set.
pub const MOST_QUESTIONS: usize = 50;
/// Maximum character length of one reply's text or the set's shared text
/// (plugin.spec.md 9.2).
pub const MOST_TEXT_CHARS: usize = 32_768;
/// Maximum character length of one question or answer.
pub const MOST_QA_CHARS: usize = 4_096;
/// Maximum character window of source message text handed out in one unit.
pub(super) const UNIT_TEXT_LIMIT: usize = 32_768;
/// Default and maximum output budget for `mail-replyset-show` and
/// `mail-replyset-preview` (plugin.spec.md 6).
const SHOW_BUDGET: u64 = MOST_BUDGET;
/// Maximum MCP wire size for a rendered preview (3.5 MiB, leaving 0.5 MiB under
/// the 4 MiB server/desktop reply limit; plugin.spec.md 6).
pub const MAX_PREVIEW_MCP_BYTES: usize = 3_670_016;

pub(super) fn invalid(
    message: impl Into<String>,
    suggestion: impl Into<String>,
) -> Box<CommandError> {
    Box::new(CommandError::new("INVALID_INPUT", message).with_suggestion(suggestion))
}

pub(super) fn replyset_not_found(id: i64) -> CommandError {
    CommandError::new(
        "REPLYSET_NOT_FOUND",
        format!("no reply set has the id {id}"),
    )
    .with_suggestion("Check the reply set id returned by mail-replyset-create.")
    .with_retryable(false)
}

pub(super) fn preview_changed(revision: i64) -> CommandError {
    CommandError::new(
        "PREVIEW_CHANGED",
        format!(
            "The reply set changed since its preview was read (now at revision {revision}). Nothing was sent."
        ),
    )
    .with_suggestion(
        "Read it again with mail-replyset-preview or mail-replyset-show and ask the person again.",
    )
    .with_retryable(false)
}

pub(super) fn preview_too_large() -> CommandError {
    CommandError::new(
        "PREVIEW_TOO_LARGE",
        "the reply set's preview exceeds what one call can show whole",
    )
    .with_suggestion("Shorten the reply texts or split the replies into smaller reply sets.")
    .with_retryable(false)
}

pub(super) fn replyset_incomplete(id: i64, missing: usize) -> CommandError {
    let phrase = if missing == 1 {
        "1 reply has no text".to_string()
    } else {
        format!("{missing} replies have no text")
    };
    CommandError::new(
        "REPLYSET_INCOMPLETE",
        format!("reply set {id} is not complete: {phrase}"),
    )
    .with_suggestion(
        "Write every reply with mail-replyset-next and mail-replyset-submit, or mail-replyset-update, before sending.",
    )
    .with_retryable(false)
}

fn not_held(message_id: i64) -> CommandError {
    CommandError::new(
        "NOT_HELD",
        format!("message {message_id}'s body is not held in the log yet"),
    )
    .with_suggestion(
        "Open the message with mail-message-open or wait for mail-sync to fetch its body, then call mail-replyset-next again.",
    )
    .with_retryable(true)
}

/// Whether a rendered `mail-replyset-show` preview fits both the registry
/// output budget and the 3.5 MiB MCP reply cap (plugin.spec.md 6).
pub(super) fn preview_fits(preview: &Value) -> bool {
    if !fits(preview, SHOW_BUDGET as usize) {
        return false;
    }
    let result = success(preview.clone());
    crate::reply_size(&result, Some(CommandInterface::Mcp)) <= MAX_PREVIEW_MCP_BYTES
}

/// Checks that both the current preview AND its worst-case post-partial-send
/// expansion (longer state strings, max-width revision/timestamp/outbound IDs)
/// fit under the whole-preview caps, so a partial failure can never push an
/// accepted set past `PREVIEW_TOO_LARGE` when previewing the remaining send.
pub(super) fn preview_fits_with_send_headroom(
    detail: &ReplySetDetail,
    account: Option<&AccountRow>,
) -> bool {
    if !preview_fits(&replyset_json(detail, account)) {
        return false;
    }
    let mut worst_case = detail.clone();
    worst_case.set.state = ReplySetState::Partial;
    worst_case.set.revision = i64::MAX;
    worst_case.set.updated_at = i64::MAX;
    for reply in &mut worst_case.replies {
        reply.send_state = ReplySendState::Unknown;
        reply.outbound = Some(i64::MAX);
        reply.updated_at = i64::MAX;
    }
    preview_fits(&replyset_json(&worst_case, account))
}

pub(super) fn validate_text(
    raw: &Value,
    name: &str,
    allow_empty: bool,
    max_chars: usize,
) -> Result<String, Box<CommandError>> {
    let Some(text) = raw.as_str() else {
        return Err(invalid(
            format!("`{name}` must be a string"),
            format!("Pass `{name}` as plain text."),
        ));
    };
    if text.contains('\0') {
        return Err(invalid(
            format!("`{name}` contains a NUL byte"),
            format!("Remove NUL bytes from `{name}`."),
        ));
    }
    let chars = text.chars().count();
    if !allow_empty && text.trim().is_empty() {
        return Err(invalid(
            format!("`{name}` must not be empty"),
            format!("Provide visible text for `{name}`."),
        ));
    }
    if chars > max_chars {
        return Err(invalid(
            format!("`{name}` is longer than {max_chars} characters"),
            format!("Shorten `{name}` to at most {max_chars} characters."),
        ));
    }
    Ok(text.to_string())
}

pub(super) fn refusal(id: i64, why: ReplySetRefusal) -> CommandError {
    match why {
        ReplySetRefusal::NotFound => replyset_not_found(id),
        ReplySetRefusal::Changed { revision } => CommandError::new(
            "REPLYSET_CHANGED",
            format!("reply set {id} changed since it was read: it is at revision {revision}"),
        )
        .with_suggestion(
            "Read it again with mail-replyset-show, and make the change from its revision.",
        )
        .with_retryable(false),
        ReplySetRefusal::Sending => CommandError::new(
            "WORK_RUNNING",
            format!("reply set {id} is being sent right now"),
        )
        .with_suggestion("Wait for the send to finish, then inspect it with mail-replyset-show.")
        .with_retryable(true),
        ReplySetRefusal::Sent => CommandError::new(
            "INVALID_INPUT",
            format!("reply set {id} has already been sent"),
        )
        .with_suggestion("Create a new reply set with mail-replyset-create."),
        ReplySetRefusal::Unknown => CommandError::new(
            "SEND_OUTCOME_UNKNOWN",
            format!("a send of reply set {id} ended with an unknown outcome"),
        )
        .with_suggestion(
            "Check your Sent mailbox and mail-status before deciding whether to create a new reply set.",
        )
        .with_retryable(false),
        ReplySetRefusal::QuestionNotFound(q_id) => CommandError::new(
            "INVALID_INPUT",
            format!("reply set {id} has no question with id {q_id}"),
        )
        .with_suggestion("Inspect the reply set's questions with mail-replyset-show."),
        ReplySetRefusal::ReplyNotFound(r_id) => CommandError::new(
            "INVALID_INPUT",
            format!("reply set {id} has no reply with id {r_id}"),
        )
        .with_suggestion("Inspect the reply set's replies with mail-replyset-show."),
        ReplySetRefusal::ReplyLocked(r_id) => CommandError::new(
            "INVALID_INPUT",
            format!("reply {r_id} of reply set {id} has already been sent or has an unknown outcome"),
        )
        .with_suggestion("Only unsent replies can be edited."),
        ReplySetRefusal::UnitNotOpen => CommandError::new(
            "UNIT_NOT_OPEN",
            format!("reply set {id}'s unit is no longer open for submission"),
        )
        .with_suggestion(
            "Call `mail-replyset-next` again: the reply was answered, edited, or its inputs changed since this unit was handed out.",
        )
        .with_retryable(false),
        ReplySetRefusal::PreviewTooLarge => preview_too_large(),
    }
}

pub(super) fn send_refusal(id: i64, why: ReplySetSendRefusal) -> CommandError {
    match why {
        ReplySetSendRefusal::NotFound => replyset_not_found(id),
        ReplySetSendRefusal::Sending => CommandError::new(
            "WORK_RUNNING",
            format!("reply set {id} is already being sent"),
        )
        .with_suggestion("Wait for the send to finish, then check mail-replyset-show.")
        .with_retryable(true),
        ReplySetSendRefusal::Sent | ReplySetSendRefusal::NothingToSend => CommandError::new(
            "INVALID_INPUT",
            format!("reply set {id} has already been sent"),
        )
        .with_suggestion("Create a new reply set with mail-replyset-create."),
        ReplySetSendRefusal::Unknown => CommandError::new(
            "SEND_OUTCOME_UNKNOWN",
            format!(
                "a previous send of reply set {id} ended with an unknown outcome and is never retried"
            ),
        )
        .with_suggestion(
            "Check your Sent mailbox and mail-status before deciding how to proceed.",
        )
        .with_retryable(false),
        ReplySetSendRefusal::Changed { revision } => preview_changed(revision),
        ReplySetSendRefusal::Incomplete { missing } => replyset_incomplete(id, missing),
        ReplySetSendRefusal::AccountNotFound => CommandError::new(
            "ACCOUNT_NOT_FOUND",
            "the reply set's account no longer exists",
        )
        .with_suggestion("Run `loam-mail mail-account-list` to see the accounts."),
    }
}

fn source_refusal(why: SourceRefusal) -> CommandError {
    match why {
        SourceRefusal::AccountNotFound => {
            CommandError::new("ACCOUNT_NOT_FOUND", "no account has that id")
                .with_suggestion("Run `loam-mail mail-account-list` to see the accounts.")
        }
        SourceRefusal::AmbiguousAccount => CommandError::new(
            "INVALID_INPUT",
            "more than one account shows these messages; pass `account`",
        )
        .with_suggestion("Name the account to send from with `account`."),
        SourceRefusal::MessageNotFound(msg) => {
            CommandError::new("MESSAGE_NOT_FOUND", format!("no message has the id {msg}"))
                .with_suggestion(
                    "Pass message ids returned by mail-thread-open or mail-message-list.",
                )
        }
        SourceRefusal::MessageNotVisible(msg) => CommandError::new(
            "INVALID_INPUT",
            format!("message {msg} is not shown in the sending account outside junk and trash"),
        )
        .with_suggestion(
            "Choose source messages currently shown outside junk and trash in the sending account.",
        ),
        SourceRefusal::InvalidSender(msg) => CommandError::new(
            "INVALID_INPUT",
            format!("message {msg} does not have a usable plain sender address to reply to"),
        )
        .with_suggestion("Remove that message from the reply set."),
        SourceRefusal::OwnSender(msg) => CommandError::new(
            "INVALID_INPUT",
            format!("message {msg} was sent from one of your own addresses"),
        )
        .with_suggestion("Create reply sets only from inbound messages sent by others."),
        SourceRefusal::StoryNotFound(story) => {
            CommandError::new("STORY_NOT_FOUND", format!("no story has the id {story}"))
                .with_suggestion("Run `loam-mail mail-story-list` to see the stories.")
        }
    }
}

pub(super) fn send_provider_failure(error: &ProviderError) -> CommandError {
    match error {
        ProviderError::SignIn => CommandError::new("SIGN_IN_REQUIRED", error.to_string())
            .with_suggestion("Sign in to the account again."),
        ProviderError::Keychain => CommandError::new("SIGN_IN_REQUIRED", error.to_string())
            .with_suggestion("Unlock the keychain, then try again."),
        ProviderError::NoCredential => CommandError::new("SIGN_IN_REQUIRED", error.to_string())
            .with_suggestion("Store the account's sign-in, then try again."),
        ProviderError::Limit(_) => CommandError::new("PROVIDER_LIMIT", error.to_string())
            .with_suggestion("Wait a while before re-previewing and sending any remaining replies.")
            .with_retryable(true),
        ProviderError::Refused(_) => CommandError::new("PROVIDER_REFUSED", error.to_string())
            .with_suggestion(
                "The provider refused the send permanently. Inspect mail-replyset-show before trying again.",
            )
            .with_retryable(false),
        ProviderError::TooDeep => CommandError::new("PROVIDER_UNAVAILABLE", error.to_string())
            .with_suggestion("The provider's reply could not be read.")
            .with_retryable(false),
        ProviderError::Unavailable(_) | ProviderError::Protocol(_) => {
            CommandError::new("PROVIDER_UNAVAILABLE", error.to_string())
                .with_suggestion(
                    "Check the network and inspect mail-replyset-show before trying again.",
                )
                .with_retryable(true)
        }
    }
}

fn proposer_with_name_json(proposer: &Proposer, name: Option<&str>) -> Value {
    json!({ "kind": proposer.kind, "token": proposer.id, "name": name })
}

/// Deterministic canonical JSON representation of a reply set for
/// `mail-replyset-show`, `create`, and `update` (plugin.spec.md 6 & 9.4).
///
/// Every value derived from mail or written by callers sits inside a part
/// labelled `"trust": "content"`. Holds no reading-time timestamp and no live
/// token lookup so two reads of an unchanged set are byte-equal in canonical
/// JSON even after a token is revoked.
pub(super) fn replyset_json(detail: &ReplySetDetail, account: Option<&AccountRow>) -> Value {
    let shared = &detail.set.shared_text;
    let ready_replies = detail
        .replies
        .iter()
        .filter(|r| r.text.as_deref().is_some_and(|t| !t.trim().is_empty()))
        .count();
    let sent_replies = detail
        .replies
        .iter()
        .filter(|r| r.send_state == ReplySendState::Sent)
        .count();
    let differs_count = detail
        .replies
        .iter()
        .filter(|r| r.differs_from(shared))
        .count();
    let questions_json: Vec<Value> = detail
        .questions
        .iter()
        .map(|q| {
            json!({
                "id": q.id,
                "revision": q.revision,
                "individual": q.reply_ids.len() == 1,
                "messages": q.message_ids,
                "replies": q.reply_ids,
                "question": q.question,
                "answer": q.answer,
                "answeredBy": q
                    .answered_by
                    .as_ref()
                    .map(|p| proposer_with_name_json(p, q.answered_by_name.as_deref())),
            })
        })
        .collect();
    let replies_json: Vec<Value> = detail
        .replies
        .iter()
        .map(|r| reply_item_json(r, shared))
        .collect();
    json!({
        "replyset": {
            "id": detail.set.id,
            "revision": detail.set.revision,
            "state": detail.set.state.as_str(),
            "account": {
                "id": detail.set.account.0,
                "provider": account.map(|a| a.provider.as_str()),
                "address": account.map(|a| a.address.as_str()),
            },
            "story": detail.set.story,
            "createdAt": detail.set.created_at,
            "updatedAt": detail.set.updated_at,
            "creator": proposer_with_name_json(&detail.set.creator, detail.set.creator_name.as_deref()),
            "totalReplies": detail.replies.len(),
            "readyReplies": ready_replies,
            "sentReplies": sent_replies,
            "differsCount": differs_count,
            "content": content(json!({
                "sharedText": shared,
                "questions": questions_json,
            })),
            "replies": replies_json,
        }
    })
}

fn reply_item_json(reply: &ReplyRow, shared_text: &str) -> Value {
    let mut inputs = serde_json::Map::with_capacity(4);
    inputs.insert("message".to_string(), json!(reply.message));
    inputs.insert(
        "sourceTextDigest".to_string(),
        json!(reply.source_text_digest.as_deref()),
    );
    inputs.insert("answers".to_string(), json!(reply.answers_snapshot));
    if let Some(version) = reply.instructions_version.as_deref() {
        inputs.insert("instructionsVersion".to_string(), json!(version));
    }
    json!({
        "reply": reply.id,
        "message": reply.message,
        "state": reply.send_state.display_str(),
        "differs": reply.differs_from(shared_text),
        "replyToDiffers": reply.reply_to_differs,
        "source": reply.source.map(ReplySource::as_str),
        "unit": reply.source_unit.as_deref(),
        "generation": reply.generation,
        "author": reply
            .author
            .as_ref()
            .map(|p| proposer_with_name_json(p, reply.author_name.as_deref())),
        "submissions": reply.submissions,
        "edits": reply.edits,
        "outbound": reply.outbound,
        "inputs": Value::Object(inputs),
        "content": content(json!({
            "recipient": {
                "address": reply.recipient_address,
                "name": reply.recipient_name,
            },
            "subject": reply.subject,
            "text": reply.text,
        })),
    })
}

pub(super) fn read_source_visible(
    store: &Store,
    message_id: i64,
) -> Result<Result<(String, String), Box<CommandError>>, StoreError> {
    let msg = MessageId(message_id);
    let Some(listed) = store.message_listed(msg)? else {
        return Ok(Err(Box::new(
            CommandError::new(
                "MESSAGE_NOT_FOUND",
                format!("no message has the id {message_id}"),
            )
            .with_suggestion("Inspect the reply set with mail-replyset-show."),
        )));
    };
    if !listed.held_whole && !listed.held_in_parts {
        return Ok(Err(Box::new(not_held(message_id))));
    }
    let Some(whole) = store.body_bytes_readonly(msg)? else {
        return Ok(Err(Box::new(not_held(message_id))));
    };
    let reading = derive::reading(&whole);
    Ok(Ok((listed.subject, reading.visible)))
}

pub(crate) fn source_digest(subject: &str, text: &str) -> String {
    let payload = json!({ "subject": subject, "text": text });
    input_digest(&payload).unwrap_or_default()
}

pub(super) fn take_chars(text: &str, limit: usize) -> (&str, bool) {
    match text.char_indices().nth(limit) {
        Some((byte_idx, _)) => (&text[..byte_idx], false),
        None => (text, true),
    }
}

fn parse_messages(input: &Value) -> Result<Option<Vec<i64>>, Box<CommandError>> {
    crate::stories::parse_replyset_messages(input, MOST_REPLIES)
}

fn parse_questions(
    input: &Value,
    valid_messages: &HashSet<i64>,
) -> Result<Vec<NewQuestion>, Box<CommandError>> {
    let Some(raw) = input.get("questions").filter(|v| !v.is_null()) else {
        return Ok(Vec::new());
    };
    let Some(items) = raw.as_array() else {
        return Err(invalid(
            "`questions` must be a list of question objects",
            "Pass `questions` as a list of { question, messages, answer? } objects.",
        ));
    };
    if items.len() > MOST_QUESTIONS {
        return Err(invalid(
            format!("a reply set holds at most {MOST_QUESTIONS} questions"),
            format!("Group into at most {MOST_QUESTIONS} distinct questions."),
        ));
    }
    let mut out = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let Some(obj) = item.as_object() else {
            return Err(invalid(
                format!("`questions[{index}]` must be an object"),
                "Each question must be { question, messages, answer? }.",
            ));
        };
        let question = match obj.get("question") {
            Some(v) => validate_text(
                v,
                &format!("questions[{index}].question"),
                false,
                MOST_QA_CHARS,
            )?,
            None => {
                return Err(invalid(
                    format!("`questions[{index}].question` is required"),
                    "Provide a non-empty question string.",
                ));
            }
        };
        let answer = match obj.get("answer") {
            None | Some(Value::Null) => None,
            Some(v) => Some(validate_text(
                v,
                &format!("questions[{index}].answer"),
                false,
                MOST_QA_CHARS,
            )?),
        };
        let Some(q_msgs) = obj.get("messages").and_then(Value::as_array) else {
            return Err(invalid(
                format!("`questions[{index}].messages` must be a non-empty list of message ids"),
                "List the message ids from this reply set that ask this question.",
            ));
        };
        if q_msgs.is_empty() {
            return Err(invalid(
                format!("`questions[{index}].messages` must not be empty"),
                "Name at least one message id from this reply set.",
            ));
        }
        let mut linked = Vec::with_capacity(q_msgs.len());
        let mut seen = HashSet::with_capacity(q_msgs.len());
        for (m_idx, m_val) in q_msgs.iter().enumerate() {
            let Some(m_id) = m_val.as_i64() else {
                return Err(invalid(
                    format!("`questions[{index}].messages[{m_idx}]` must be a message id"),
                    "Pass each message id as an integer.",
                ));
            };
            if !valid_messages.contains(&m_id) {
                return Err(invalid(
                    format!(
                        "`questions[{index}].messages[{m_idx}]` ({m_id}) is not in this reply set's `messages`"
                    ),
                    "Every question must reference only messages included in `messages`.",
                ));
            }
            if seen.insert(m_id) {
                linked.push(m_id);
            }
        }
        out.push(NewQuestion {
            question,
            answer,
            messages: linked,
        });
    }
    Ok(out)
}

struct Create {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Create {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let now = context.clock().now();
        let creator = proposer_of(&context);
        let parsed = (|| -> Result<_, Box<CommandError>> {
            let account = integer(&input, "account")?.map(AccountId);
            let story = integer(&input, "story")?;
            let messages = parse_messages(&input)?;
            if messages.is_none() && story.is_none() {
                return Err(invalid(
                    "`messages` or `story` is required",
                    "Pass 1 to 50 source message ids in `messages`, or name a `story`.",
                ));
            }
            let shared_text = match input.get("sharedText") {
                None | Some(Value::Null) => String::new(),
                Some(v) => validate_text(v, "sharedText", true, MOST_TEXT_CHARS)?,
            };
            Ok((account, story, messages, shared_text))
        })();
        let (account, story, explicit_messages, shared_text) = match parsed {
            Ok(parsed) => parsed,
            Err(error) => return failure(*error),
        };

        let created = self.engine.with_store(|store| {
            let messages = match explicit_messages {
                Some(messages) => messages,
                None => match crate::stories::replyset_story_messages(
                    store,
                    story.unwrap_or_default(),
                    MOST_REPLIES,
                )? {
                    Ok(messages) => messages,
                    Err(error) => return Ok(Err(error)),
                },
            };
            let valid_set: HashSet<i64> = messages.iter().copied().collect();
            let questions = match parse_questions(&input, &valid_set) {
                Ok(questions) => questions,
                Err(error) => return Ok(Err(error)),
            };
            let (account_id, sources) =
                match store.resolve_replyset_sources(account, story, &messages)? {
                    Ok(resolved) => resolved,
                    Err(why) => return Ok(Err(Box::new(source_refusal(why)))),
                };
            let accounts = store.accounts()?;
            let account_row = accounts.into_iter().find(|a| a.id == account_id);
            let new = NewReplySet {
                account: account_id,
                story,
                shared_text,
                sources,
                questions,
            };
            let made = store.create_replyset(&new, &creator, now, |detail| {
                preview_fits_with_send_headroom(detail, account_row.as_ref())
            })?;
            match made {
                Ok(detail) => Ok(Ok(replyset_json(&detail, account_row.as_ref()))),
                Err(why) => Ok(Err(Box::new(refusal(0, why)))),
            }
        });

        match created {
            Ok(Ok(value)) => success(value),
            Ok(Err(error)) => failure(*error),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-replyset-create`: creates a reply set for a cohort of source messages.
/// Each reply's recipient is derived from its source message by the engine and
/// cannot be set by any caller (section 10.3).
#[must_use]
pub fn create(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        CREATE,
        "Create a reply set from source messages; the engine derives each reply's recipient from its source message",
        vec![
            parameter(
                "messages",
                JsonSchemaType::Array,
                "Source message ids to reply to (1 to 50); optional when `story` is given",
                false,
            ),
            parameter(
                "account",
                JsonSchemaType::Integer,
                "Sending account id; inferred when all messages belong to one account",
                false,
            ),
            parameter(
                "story",
                JsonSchemaType::Integer,
                "Optional cohort story id this reply set answers",
                false,
            ),
            parameter(
                "sharedText",
                JsonSchemaType::String,
                "Optional shared baseline reply text used to flag per-reply differences",
                false,
            ),
            parameter(
                "questions",
                JsonSchemaType::Array,
                "Optional cohort questions: [{ question, messages, answer? }]",
                false,
            ),
        ],
        Create { engine },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

struct Update {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Update {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let now = context.clock().now();
        let editor = proposer_of(&context);
        let parsed = (|| -> Result<(i64, i64, ReplySetChange), Box<CommandError>> {
            let id = required(&input, "replyset")?;
            let revision = integer(&input, "revision")?.ok_or_else(|| {
                invalid(
                    "`revision` is required",
                    "Pass the revision mail-replyset-show gave, so a change made since is not overwritten.",
                )
            })?;
            let shared_text = match input.get("sharedText") {
                None | Some(Value::Null) => None,
                Some(v) => Some(validate_text(v, "sharedText", true, MOST_TEXT_CHARS)?),
            };
            let mut answers = Vec::new();
            if let Some(raw_answers) = input.get("answers").filter(|v| !v.is_null()) {
                let Some(items) = raw_answers.as_array() else {
                    return Err(invalid(
                        "`answers` must be a list of { question, answer } objects",
                        "Pass `answers` as an array.",
                    ));
                };
                if items.len() > MOST_QUESTIONS {
                    return Err(invalid(
                        format!("at most {MOST_QUESTIONS} answers may be updated at once"),
                        "Update existing questions of the reply set.",
                    ));
                }
                let mut seen_q = HashSet::with_capacity(items.len());
                for (index, item) in items.iter().enumerate() {
                    let Some(obj) = item.as_object() else {
                        return Err(invalid(
                            format!("`answers[{index}]` must be an object"),
                            "Each item must be { question, answer }.",
                        ));
                    };
                    let Some(q_id) = obj.get("question").and_then(Value::as_i64) else {
                        return Err(invalid(
                            format!("`answers[{index}].question` must be a question id"),
                            "Pass the question id returned by mail-replyset-show.",
                        ));
                    };
                    if !seen_q.insert(q_id) {
                        return Err(invalid(
                            format!("`answers` names question {q_id} more than once"),
                            "Give one answer per question id.",
                        ));
                    }
                    let answer = match obj.get("answer") {
                        Some(v) => validate_text(
                            v,
                            &format!("answers[{index}].answer"),
                            false,
                            MOST_QA_CHARS,
                        )?,
                        None => {
                            return Err(invalid(
                                format!("`answers[{index}].answer` is required"),
                                "Provide a non-empty answer string.",
                            ));
                        }
                    };
                    answers.push(AnswerUpdate {
                        question: q_id,
                        answer,
                    });
                }
            }
            let reply_id = integer(&input, "reply")?;
            let raw_text = input.get("text").filter(|v| !v.is_null());
            let edit = match (reply_id, raw_text) {
                (None, None) => None,
                (Some(_), None) | (None, Some(_)) => {
                    return Err(invalid(
                        "`reply` and `text` must be passed together to edit a reply",
                        "Pass both `reply` (its id) and `text` (its replacement plain text).",
                    ));
                }
                (Some(reply), Some(v)) => {
                    let text = validate_text(v, "text", false, MOST_TEXT_CHARS)?;
                    let text_digest = input_digest(&json!(text)).unwrap_or_default();
                    Some(ReplyEdit {
                        reply,
                        text,
                        text_digest,
                    })
                }
            };
            let change = ReplySetChange {
                shared_text,
                answers,
                edit,
            };
            if change == ReplySetChange::default() {
                return Err(invalid(
                    "nothing to change is named",
                    "Name one or more of: sharedText, answers, or reply with text.",
                ));
            }
            Ok((id, revision, change))
        })();
        let (id, revision, change) = match parsed {
            Ok(parsed) => parsed,
            Err(error) => return failure(*error),
        };

        let updated = self.engine.with_store(|store| {
            let accounts = store.accounts()?;
            let changed = store.update_replyset(id, revision, &change, &editor, now, |detail| {
                let account_row = accounts.iter().find(|a| a.id == detail.set.account);
                preview_fits_with_send_headroom(detail, account_row)
            })?;
            match changed {
                Ok(detail) => {
                    let account_row = accounts.iter().find(|a| a.id == detail.set.account);
                    Ok(Ok(replyset_json(&detail, account_row)))
                }
                Err(why) => Ok(Err(Box::new(refusal(id, why)))),
            }
        });

        match updated {
            Ok(Ok(value)) => success(value),
            Ok(Err(error)) => failure(*error),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-replyset-update`: records answers, updates shared text, or edits a
/// reply's text from the revision read (`REPLYSET_CHANGED` on mismatch).
#[must_use]
pub fn update(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        UPDATE,
        "Update a reply set's shared text, question answers, or one reply's text from a known revision",
        vec![
            parameter("replyset", JsonSchemaType::Integer, "The reply set, by id", true),
            parameter(
                "revision",
                JsonSchemaType::Integer,
                "The revision the change is made from, as mail-replyset-show gave it",
                true,
            ),
            parameter(
                "sharedText",
                JsonSchemaType::String,
                "Replacement shared baseline reply text",
                false,
            ),
            parameter(
                "answers",
                JsonSchemaType::Array,
                "Answers to questions: [{ question, answer }]",
                false,
            ),
            parameter(
                "reply",
                JsonSchemaType::Integer,
                "Reply id to edit (paired with `text`)",
                false,
            ),
            parameter(
                "text",
                JsonSchemaType::String,
                "Replacement reply body text (paired with `reply`; 1 to 32,768 characters)",
                false,
            ),
        ],
        Update { engine },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

struct Show {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Show {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let id = match required(&input, "replyset") {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        let expected_revision = match integer(&input, "revision") {
            Ok(rev) => rev,
            Err(error) => return failure(*error),
        };
        let loaded = self.engine.with_store(|store| {
            let Some(detail) = store.replyset(id)? else {
                return Ok(None);
            };
            let accounts = store.accounts()?;
            let account = accounts.into_iter().find(|a| a.id == detail.set.account);
            Ok(Some((detail, account)))
        });
        let (detail, account) = match loaded {
            Ok(Some(loaded)) => loaded,
            Ok(None) => return failure(replyset_not_found(id)),
            Err(error) => return failure(store_failure(&error)),
        };
        if let Some(expected) = expected_revision
            && expected != detail.set.revision
        {
            return failure(preview_changed(detail.set.revision));
        }
        let result = replyset_json(&detail, account.as_ref());
        let limit = budget(&context, SHOW_BUDGET);
        if !fits(&result, limit) || !preview_fits(&result) {
            return failure(preview_too_large());
        }
        success(result)
    }
}

/// `mail-replyset-show`: shows a reply set whole — its shared text, every
/// recipient derived from its source message, and every reply marked with
/// whether its text differs from the shared text. It is the preview of
/// `mail-replyset-send` (section 10.3, plugin.spec.md 6 & 7).
#[must_use]
pub fn show(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        SHOW,
        "Show a reply set whole: shared text, every recipient, per-reply text and differences",
        vec![
            parameter(
                "replyset",
                JsonSchemaType::Integer,
                "The reply set, by id",
                true,
            ),
            parameter(
                "revision",
                JsonSchemaType::Integer,
                "Optional revision to verify against the current reply set",
                false,
            ),
        ],
        Show { engine },
    )
    .with_output_budget(SHOW_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}
