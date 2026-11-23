//! Reply sets (step E3; the specification's 10.3, section 11, M18 and M29;
//! plugin.spec.md sections 6, 7 and 9): `mail-replyset-create`,
//! `mail-replyset-update`, `mail-replyset-next`, `mail-replyset-show` and
//! `mail-replyset-send`.
//!
//! Each reply's recipient is derived by the engine from its source message's
//! `From` header at creation and stored with the reply so callers cannot set
//! recipients and re-deriving a message cannot change them. `mail-replyset-next`
//! hands out only one reply's own source message visible text and linked
//! answers, never another recipient's. `mail-replyset-send` is a person's
//! command, destructive and held for approval, bound to the previewed
//! `revision`.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use afd::{
    ActorKind, ApprovalPolicy, CommandContext, CommandDefinition, CommandError, CommandHandler,
    CommandInterface, CommandResult, JsonSchemaType, Warning, failure, input_digest, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::commands::{command_line_only, store_failure};
use crate::derive;
use crate::engine::Engine;
use crate::provider::smtp::{OutgoingMessage, SendOutcome, build_message, new_message_id};
use crate::provider::{Provider, ProviderError};
use crate::read::{
    MOST_BUDGET, OPEN_BUDGET, budget, content, fits, integer, parameter, read_exposure, required,
    too_small,
};
use crate::screening::proposer_of;
use crate::store::{
    AccountId, AccountRow, AnswerRef, AnswerUpdate, MessageId, NewQuestion, NewReplySet, Proposer,
    ReplyEdit, ReplyRow, ReplySendState, ReplySetChange, ReplySetDetail, ReplySetRefusal,
    ReplySetSendRefusal, ReplySetState, ReplySource, ReplySubmission, SourceRefusal, Store,
    StoreError,
};

/// Command name for creating a reply set.
pub const CREATE: &str = "mail-replyset-create";
/// Command name for updating a reply set (answers, shared text, reply edits).
pub const UPDATE: &str = "mail-replyset-update";
/// Command name for pulling the next isolated unit or submitting a reply.
pub const NEXT: &str = "mail-replyset-next";
/// Command name for previewing a reply set whole.
pub const SHOW: &str = "mail-replyset-show";
/// Command name for sending a reply set at the terminal.
pub const SEND: &str = "mail-replyset-send";

/// Reply-set mutation commands whose results hold content stripped from the
/// journal (the specification's 13.1).
pub const RESULTS_WITH_TEXT: &[&str] = &[CREATE, UPDATE, NEXT];

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
const UNIT_TEXT_LIMIT: usize = 32_768;
/// Default and maximum output budget for `mail-replyset-show` (plugin.spec.md 6).
const SHOW_BUDGET: u64 = MOST_BUDGET;
/// Maximum MCP wire size for a rendered preview (3.5 MiB, leaving 0.5 MiB under
/// the 4 MiB server/desktop reply limit; plugin.spec.md 6).
pub const MAX_PREVIEW_MCP_BYTES: usize = 3_670_016;
/// Bounded timeout for each best-effort IMAP `APPEND` of a sent reply copy.
const SENT_COPY_TIMEOUT: Duration = Duration::from_secs(10);

fn invalid(message: impl Into<String>, suggestion: impl Into<String>) -> Box<CommandError> {
    Box::new(CommandError::new("INVALID_INPUT", message).with_suggestion(suggestion))
}

fn replyset_not_found(id: i64) -> CommandError {
    CommandError::new(
        "REPLYSET_NOT_FOUND",
        format!("no reply set has the id {id}"),
    )
    .with_suggestion("Check the reply set id returned by mail-replyset-create.")
    .with_retryable(false)
}

fn preview_changed(revision: i64) -> CommandError {
    CommandError::new(
        "PREVIEW_CHANGED",
        format!(
            "The reply set changed since its preview was read (now at revision {revision}). Nothing was sent."
        ),
    )
    .with_suggestion("Read it again with mail-replyset-show and ask the person again.")
    .with_retryable(false)
}

fn preview_too_large() -> CommandError {
    CommandError::new(
        "PREVIEW_TOO_LARGE",
        "the reply set's preview exceeds what one call can show whole",
    )
    .with_suggestion("Shorten the reply texts or split the replies into smaller reply sets.")
    .with_retryable(false)
}

fn replyset_incomplete(id: i64, missing: usize) -> CommandError {
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
        "Write every reply with mail-replyset-next or mail-replyset-update before sending.",
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
fn preview_fits(preview: &Value) -> bool {
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
fn preview_fits_with_send_headroom(detail: &ReplySetDetail, account: Option<&AccountRow>) -> bool {
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

fn validate_text(
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

fn refusal(id: i64, why: ReplySetRefusal) -> CommandError {
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

fn send_refusal(id: i64, why: ReplySetSendRefusal) -> CommandError {
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

fn send_provider_failure(error: &ProviderError) -> CommandError {
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
fn replyset_json(detail: &ReplySetDetail, account: Option<&AccountRow>) -> Value {
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
        "inputs": {
            "message": reply.message,
            "sourceTextDigest": reply.source_text_digest.as_deref(),
            "answers": reply.answers_snapshot,
        },
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

fn read_source_visible(
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
    let Some(whole) = store.body_bytes(msg)? else {
        return Ok(Err(Box::new(not_held(message_id))));
    };
    let reading = derive::reading(&whole);
    Ok(Ok((listed.subject, reading.visible)))
}

fn source_digest(subject: &str, text: &str) -> String {
    let payload = json!({ "subject": subject, "text": text });
    input_digest(&payload).unwrap_or_default()
}

fn take_chars(text: &str, limit: usize) -> (&str, bool) {
    match text.char_indices().nth(limit) {
        Some((byte_idx, _)) => (&text[..byte_idx], false),
        None => (text, true),
    }
}

fn parse_messages(input: &Value) -> Result<Vec<i64>, Box<CommandError>> {
    let Some(items) = input.get("messages").and_then(Value::as_array) else {
        return Err(invalid(
            "`messages` must be a non-empty list of message ids",
            "Pass 1 to 50 source message ids to reply to.",
        ));
    };
    if items.is_empty() || items.len() > MOST_REPLIES {
        return Err(invalid(
            format!("a reply set holds between 1 and {MOST_REPLIES} messages"),
            format!("Pass 1 to {MOST_REPLIES} source message ids."),
        ));
    }
    let mut seen = HashSet::with_capacity(items.len());
    let mut out = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let Some(id) = item.as_i64().filter(|&id| id > 0) else {
            return Err(invalid(
                format!("`messages[{index}]` must be a positive message id"),
                "Pass each message id as a positive integer.",
            ));
        };
        if !seen.insert(id) {
            return Err(invalid(
                format!("`messages` lists message {id} more than once"),
                "Include each source message at most once in a reply set.",
            ));
        }
        out.push(id);
    }
    Ok(out)
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
        let parsed = (|| -> Result<(Option<AccountId>, Option<i64>, Vec<i64>, String, Vec<NewQuestion>), Box<CommandError>> {
            let account = integer(&input, "account")?.map(AccountId);
            let story = integer(&input, "story")?;
            let messages = parse_messages(&input)?;
            let shared_text = match input.get("sharedText") {
                None | Some(Value::Null) => String::new(),
                Some(v) => validate_text(v, "sharedText", true, MOST_TEXT_CHARS)?,
            };
            let valid_set: HashSet<i64> = messages.iter().copied().collect();
            let questions = parse_questions(&input, &valid_set)?;
            Ok((account, story, messages, shared_text, questions))
        })();
        let (account, story, messages, shared_text, questions) = match parsed {
            Ok(parsed) => parsed,
            Err(error) => return failure(*error),
        };

        let created = self.engine.with_store(|store| {
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
                "Source message ids to reply to (1 to 50)",
                true,
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

struct Next {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Next {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let now = context.clock().now();
        let caller = proposer_of(&context);
        let parsed =
            (|| -> Result<(i64, Option<(i64, String, Option<String>)>), Box<CommandError>> {
                let set_id = required(&input, "replyset")?;
                let reply_id = integer(&input, "reply")?;
                let raw_text = input.get("text").filter(|v| !v.is_null());
                let unit = match input.get("unit").filter(|v| !v.is_null()) {
                    None => None,
                    Some(v) => Some(validate_text(v, "unit", false, 128)?),
                };
                let submit = match (reply_id, raw_text) {
                    (None, None) => {
                        if unit.is_some() {
                            return Err(invalid(
                                "`unit` may only be passed when submitting `reply` and `text`",
                                "Pass `reply`, `text`, and `unit` together when submitting a reply.",
                            ));
                        }
                        None
                    }
                    (Some(_), None) | (None, Some(_)) => {
                        return Err(invalid(
                            "`reply` and `text` must be passed together when submitting a reply",
                            "Omit both to fetch the next unwritten reply, or pass both to submit text.",
                        ));
                    }
                    (Some(reply), Some(v)) => {
                        let text = validate_text(v, "text", false, MOST_TEXT_CHARS)?;
                        Some((reply, text, unit))
                    }
                };
                Ok((set_id, submit))
            })();
        let (set_id, submit) = match parsed {
            Ok(parsed) => parsed,
            Err(error) => return failure(*error),
        };

        if let Some((reply_id, text, unit)) = submit {
            let text_digest = input_digest(&json!(text)).unwrap_or_default();
            let submission = ReplySubmission {
                text,
                text_digest,
                unit,
            };
            let submitted = self.engine.with_store(|store| {
                let accounts = store.accounts()?;
                let result = store.submit_replyset_reply(
                    set_id,
                    reply_id,
                    &submission,
                    &caller,
                    now,
                    |detail| {
                        let account_row = accounts.iter().find(|a| a.id == detail.set.account);
                        preview_fits_with_send_headroom(detail, account_row)
                    },
                )?;
                match result {
                    Ok((detail, updated_reply)) => {
                        let done = detail.replies.iter().all(|r| r.text.is_some());
                        Ok(Ok(json!({
                            "replyset": detail.set.id,
                            "revision": detail.set.revision,
                            "done": done,
                            "reply": {
                                "reply": updated_reply.id,
                                "source": updated_reply.source.map(ReplySource::as_str),
                                "unit": updated_reply.source_unit.as_deref(),
                                "differs": updated_reply.differs_from(&detail.set.shared_text),
                                "inputs": {
                                    "message": updated_reply.message,
                                    "sourceTextDigest": updated_reply.source_text_digest.as_deref(),
                                    "answers": updated_reply.answers_snapshot,
                                },
                            },
                        })))
                    }
                    Err(why) => Ok(Err(Box::new(refusal(set_id, why)))),
                }
            });
            return match submitted {
                Ok(Ok(value)) => success(value),
                Ok(Err(error)) => failure(*error),
                Err(error) => failure(store_failure(&error)),
            };
        }

        // Hand out the next reply that has no text yet, holding ONLY that
        // reply's own source message visible text and linked answers.
        let limit = budget(&context, OPEN_BUDGET);
        let handed = self.engine.with_store(|store| {
            let Some(detail) = store.replyset(set_id)? else {
                return Ok(Err(Box::new(replyset_not_found(set_id))));
            };
            let Some(next_reply) = detail.replies.iter().find(|r| r.text.is_none()) else {
                return Ok(Ok(json!({
                    "replyset": detail.set.id,
                    "revision": detail.set.revision,
                    "done": true,
                })));
            };
            let Some(msg_id) = next_reply.message else {
                return Ok(Err(Box::new(
                    CommandError::new(
                        "MESSAGE_NOT_FOUND",
                        "the reply's source message is no longer in the store",
                    )
                    .with_suggestion("Inspect the reply set with mail-replyset-show."),
                )));
            };
            let (subject, visible) = match read_source_visible(store, msg_id)? {
                Ok(pair) => pair,
                Err(error) => return Ok(Err(error)),
            };
            let linked_questions: Vec<_> = detail
                .questions
                .iter()
                .filter(|q| q.reply_ids.contains(&next_reply.id))
                .collect();
            let answer_refs: Vec<AnswerRef> = linked_questions
                .iter()
                .map(|q| AnswerRef {
                    question: q.id,
                    revision: q.revision,
                })
                .collect();
            let answers_json =
                serde_json::to_string(&answer_refs).unwrap_or_else(|_| "[]".to_string());
            let answers_content: Vec<Value> = linked_questions
                .iter()
                .map(|q| {
                    json!({
                        "question": q.question,
                        "answer": q.answer,
                        "individual": q.reply_ids.len() == 1,
                    })
                })
                .collect();
            let unit_id = next_reply.current_unit_id();

            let build_unit = |chars: usize| -> (Value, String) {
                let (slice, complete) = take_chars(&visible, chars);
                let digest = source_digest(&subject, slice);
                let payload = json!({
                    "replyset": detail.set.id,
                    "revision": detail.set.revision,
                    "done": false,
                    "reply": next_reply.id,
                    "message": msg_id,
                    "unit": unit_id,
                    "replyToDiffers": next_reply.reply_to_differs,
                    "textComplete": complete,
                    "inputs": {
                        "message": msg_id,
                        "sourceTextDigest": digest,
                        "answers": answer_refs,
                    },
                    "content": content(json!({
                        "recipient": {
                            "address": next_reply.recipient_address,
                            "name": next_reply.recipient_name,
                        },
                        "message": {
                            "subject": subject,
                            "text": slice,
                        },
                        "answers": answers_content,
                    })),
                });
                (payload, digest)
            };

            let max_chars = visible.chars().count().min(UNIT_TEXT_LIMIT);
            let (full, full_digest) = build_unit(max_chars);
            let (chosen, chosen_digest) = if fits(&full, limit) {
                (full, full_digest)
            } else {
                // Binary-search the longest visible text prefix that fits the budget.
                let mut lo = 0usize;
                let mut hi = max_chars;
                while lo < hi {
                    let mid = lo + (hi - lo).div_ceil(2);
                    if fits(&build_unit(mid).0, limit) {
                        lo = mid;
                    } else {
                        hi = mid - 1;
                    }
                }
                if lo == 0 && !visible.is_empty() {
                    return Ok(Err(Box::new(too_small(limit))));
                }
                let (fitted, fitted_digest) = build_unit(lo);
                if !fits(&fitted, limit) {
                    return Ok(Err(Box::new(too_small(limit))));
                }
                (fitted, fitted_digest)
            };

            // Record the exact handed-out unit, source digest, and answer
            // snapshot so submission attests only to what the composer saw.
            store.record_replyset_handout(
                set_id,
                next_reply.id,
                next_reply.generation,
                &unit_id,
                &chosen_digest,
                &answers_json,
            )?;
            Ok(Ok(chosen))
        });

        match handed {
            Ok(Ok(value)) => success(value),
            Ok(Err(error)) => failure(*error),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-replyset-next`: hands out the next unwritten reply with only its own
/// source message visible text and linked answers, or records submitted text
/// for a reply (section 10.3).
#[must_use]
pub fn next(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        NEXT,
        "Get the next unwritten reply unit with only its own source message and answers, or submit composed text for a reply",
        vec![
            parameter("replyset", JsonSchemaType::Integer, "The reply set, by id", true),
            parameter(
                "reply",
                JsonSchemaType::Integer,
                "Reply id to submit text for (paired with `text`)",
                false,
            ),
            parameter(
                "text",
                JsonSchemaType::String,
                "Composed reply body text (paired with `reply`; 1 to 32,768 characters)",
                false,
            ),
            parameter(
                "unit",
                JsonSchemaType::String,
                "Optional unit id from mail-replyset-next; verified against the reply's open unit on submit",
                false,
            ),
        ],
        Next { engine },
    )
    .as_mutation()
    .with_output_budget(OPEN_BUDGET, MOST_BUDGET)
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

/// Checks `mail-replyset-send` inputs, state, revision, and completeness
/// before the approval middleware holds the call, so a missing, incomplete, or
/// stale reply set never issues an approval token (plugin.spec.md 7).
#[must_use]
pub fn pre_approval_check(engine: &Engine, input: &Value) -> Option<CommandError> {
    let id = match required(input, "replyset") {
        Ok(id) => id,
        Err(error) => return Some(*error),
    };
    let expected_revision = match integer(input, "revision") {
        Ok(Some(rev)) => rev,
        Ok(None) => {
            return Some(*invalid(
                "`revision` is required",
                "Pass the revision mail-replyset-show gave, so only what was previewed is sent.",
            ));
        }
        Err(error) => return Some(*error),
    };
    let detail = match engine.with_store(|store| store.replyset(id)) {
        Ok(Some(detail)) => detail,
        Ok(None) => return Some(replyset_not_found(id)),
        Err(error) => return Some(store_failure(&error)),
    };
    match detail.set.state {
        ReplySetState::Sending => return Some(send_refusal(id, ReplySetSendRefusal::Sending)),
        ReplySetState::Sent => return Some(send_refusal(id, ReplySetSendRefusal::Sent)),
        ReplySetState::Unknown => return Some(send_refusal(id, ReplySetSendRefusal::Unknown)),
        ReplySetState::Open | ReplySetState::Partial => {}
    }
    if detail.set.revision != expected_revision {
        return Some(preview_changed(detail.set.revision));
    }
    if detail
        .replies
        .iter()
        .any(|r| r.send_state == ReplySendState::Unknown)
    {
        return Some(send_refusal(id, ReplySetSendRefusal::Unknown));
    }
    let missing = detail
        .replies
        .iter()
        .filter(|r| r.text.as_deref().is_none_or(|t| t.trim().is_empty()))
        .count();
    if missing > 0 {
        return Some(replyset_incomplete(id, missing));
    }
    let pending = detail
        .replies
        .iter()
        .filter(|r| matches!(r.send_state, ReplySendState::None | ReplySendState::Failed))
        .count();
    if pending == 0 {
        return Some(send_refusal(id, ReplySetSendRefusal::NothingToSend));
    }
    None
}

/// Content-free approval summary for `mail-replyset-send` (the specification's
/// 3.5, 12.1 and plugin.spec.md 5.2): never includes any recipient address,
/// display name, subject, or body text.
#[must_use]
pub fn approval_summary(engine: &Engine, input: &Value) -> Option<String> {
    let id = input.get("replyset")?.as_i64()?;
    let detail = engine.with_store(|store| store.replyset(id)).ok()??;
    if !matches!(
        detail.set.state,
        ReplySetState::Open | ReplySetState::Partial
    ) {
        return None;
    }
    let pending = detail
        .replies
        .iter()
        .filter(|r| matches!(r.send_state, ReplySendState::None | ReplySendState::Failed))
        .count();
    if pending == 0 {
        return None;
    }
    let noun = if pending == 1 { "reply" } else { "replies" };
    if detail.set.state == ReplySetState::Partial {
        Some(format!(
            "Send reply set {id} from account {}: {pending} remaining {noun}",
            detail.set.account.0
        ))
    } else {
        Some(format!(
            "Send reply set {id} from account {}: {pending} {noun}",
            detail.set.account.0
        ))
    }
}

/// Drop guard ensuring an interrupted reply-set send never leaves `replyset`,
/// `replyset_reply`, or `outbound` stranded in `'sending'`.
struct InFlightReplySet {
    engine: Arc<Engine>,
    set_id: i64,
    armed: bool,
}

impl InFlightReplySet {
    fn arm(engine: Arc<Engine>, set_id: i64) -> Self {
        Self {
            engine,
            set_id,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for InFlightReplySet {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX));
        let _ = self
            .engine
            .with_store(|store| store.settle_interrupted_replyset(self.set_id, now));
    }
}

struct SendReplySet {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for SendReplySet {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let is_terminal_human = context.interface == Some(CommandInterface::Cli)
            && context
                .actor
                .as_ref()
                .is_some_and(|actor| actor.kind == ActorKind::Human);
        if !is_terminal_human {
            return failure(
                CommandError::new(
                    "PERSON_REQUIRED",
                    "`mail-replyset-send` is a person's command and must be run at a terminal",
                )
                .with_suggestion("Run `loam-mail mail-replyset-send` at a terminal."),
            );
        }
        let sender_proposer = proposer_of(&context);
        let parsed = (|| -> Result<(i64, i64), Box<CommandError>> {
            let id = required(&input, "replyset")?;
            let revision = integer(&input, "revision")?.ok_or_else(|| {
                invalid(
                    "`revision` is required",
                    "Pass the revision mail-replyset-show gave, so only what was previewed is sent.",
                )
            })?;
            Ok((id, revision))
        })();
        let (set_id, expected_revision) = match parsed {
            Ok(parsed) => parsed,
            Err(error) => return failure(*error),
        };

        let Some(mail_sender) = self.engine.sender().cloned() else {
            return failure(
                CommandError::new(
                    "PROVIDER_UNAVAILABLE",
                    "this build of the engine cannot send mail",
                )
                .with_suggestion("Configure an SMTP sender for the engine."),
            );
        };

        let begun = self
            .engine
            .with_store(|store| store.begin_replyset_send(set_id, expected_revision));
        let (detail, account) = match begun {
            Ok(Ok(begun)) => begun,
            Ok(Err(why)) => return failure(send_refusal(set_id, why)),
            Err(error) => return failure(store_failure(&error)),
        };
        let mut guard = InFlightReplySet::arm(Arc::clone(&self.engine), set_id);

        let already_sent = detail
            .replies
            .iter()
            .filter(|r| r.send_state == ReplySendState::Sent)
            .count();
        let pending: Vec<ReplyRow> = detail
            .replies
            .iter()
            .filter(|r| matches!(r.send_state, ReplySendState::None | ReplySendState::Failed))
            .cloned()
            .collect();
        let total_replies = detail.replies.len();

        let mut sent_this_run = 0usize;
        let mut sent_copies = 0usize;
        let mut sent_copy_failed = false;
        let mut outcomes: Vec<Value> = Vec::with_capacity(pending.len());
        let mut sent_copy_session = SentCopySession::new(&self.engine, &account);

        for reply in &pending {
            let body = reply.text.as_deref().unwrap_or_default();
            let now = context.clock().now();
            let message_id = match new_message_id(&account.address) {
                Ok(mid) => mid,
                Err(why) => {
                    sent_copy_session.close().await;
                    let any_sent = already_sent + sent_this_run > 0;
                    let next_state = if any_sent {
                        ReplySetState::Partial
                    } else {
                        ReplySetState::Open
                    };
                    if self
                        .engine
                        .with_store(|store| {
                            store.finish_replyset_send(set_id, next_state, any_sent, now)
                        })
                        .is_ok()
                    {
                        guard.disarm();
                    }
                    return failure(
                        CommandError::new("STORE_FAILED", why)
                            .with_suggestion("Check the operating system's random source."),
                    );
                }
            };

            let outbound_id = match self.engine.with_store(|store| {
                store.begin_replyset_reply_send(
                    set_id,
                    reply.id,
                    account.id,
                    expected_revision,
                    &message_id,
                    &sender_proposer,
                    now,
                )
            }) {
                Ok(id) => id,
                Err(error) => {
                    sent_copy_session.close().await;
                    let any_sent = already_sent + sent_this_run > 0;
                    let next_state = if any_sent {
                        ReplySetState::Partial
                    } else {
                        ReplySetState::Open
                    };
                    if self
                        .engine
                        .with_store(|store| {
                            store.finish_replyset_send(set_id, next_state, any_sent, now)
                        })
                        .is_ok()
                    {
                        guard.disarm();
                    }
                    return failure(store_failure(&error));
                }
            };

            let reply_headers = match reply.message {
                Some(src_id) => self
                    .engine
                    .with_store(|store| store.reply_headers(src_id))
                    .ok()
                    .flatten()
                    .unwrap_or_default(),
                None => crate::store::ReplyHeaders::default(),
            };
            let to = vec![reply.recipient_address.clone()];
            let wire_bytes = build_message(&OutgoingMessage {
                from: &account.address,
                to: &to,
                cc: &[],
                bcc: &[],
                subject: &reply.subject,
                body,
                date_ms: now,
                message_id: &message_id,
                in_reply_to: reply_headers.in_reply_to.as_deref(),
                references: &reply_headers.references,
                include_bcc: false,
            });

            let outcome = mail_sender
                .send(&account, &account.address, &to, &wire_bytes)
                .await;
            let finished_at = context.clock().now();

            match outcome {
                SendOutcome::Sent => {
                    if let Err(error) = self.engine.with_store(|store| {
                        store.finish_replyset_reply_sent(outbound_id, reply.id, finished_at)
                    }) {
                        sent_copy_session.close().await;
                        // Stop immediately: do not hand over further replies
                        // when the accepted send cannot be recorded locally.
                        // Keep `guard` armed so drop attempts settlement and
                        // marks the unrecorded reply unknown rather than
                        // leaving it stranded in `sending`.
                        let total_sent = already_sent + sent_this_run;
                        let remaining = total_replies.saturating_sub(total_sent);
                        return failure(
                            CommandError::new(
                                "OUTBOUND_RECORD_FAILED",
                                format!(
                                    "reply {} was accepted by the provider, but the local send record could not be saved: {error}",
                                    reply.id
                                ),
                            )
                            .with_retryable(false)
                            .with_details(HashMap::from([
                                ("replyset".to_string(), json!(set_id)),
                                ("reply".to_string(), json!(reply.id)),
                                ("outbound".to_string(), json!(outbound_id)),
                                ("sent".to_string(), json!(total_sent)),
                                ("remaining".to_string(), json!(remaining)),
                                ("recordSaved".to_string(), json!(false)),
                            ]))
                            .with_suggestion(
                                "Check your Sent mailbox and mail-status before deciding how to proceed; remaining replies were not sent.",
                            ),
                        );
                    }
                    sent_this_run += 1;
                    let sent_copy = sent_copy_session.append(&wire_bytes).await;
                    if sent_copy {
                        let _ = self
                            .engine
                            .with_store(|store| store.mark_outbound_sent_copy(outbound_id));
                        sent_copies += 1;
                    } else {
                        sent_copy_failed = true;
                    }
                    outcomes.push(json!({
                        "reply": reply.id,
                        "outbound": outbound_id,
                        "state": "sent",
                        "sentCopy": sent_copy,
                        "recordSaved": true,
                    }));
                }
                SendOutcome::Failed(error) => {
                    sent_copy_session.close().await;
                    let why = error.to_string();
                    if let Err(store_err) = self.engine.with_store(|store| {
                        store.finish_replyset_reply_failed(outbound_id, reply.id, &why, finished_at)
                    }) {
                        return failure(store_failure(&store_err));
                    }
                    let total_sent = already_sent + sent_this_run;
                    let next_state = if total_sent > 0 {
                        ReplySetState::Partial
                    } else {
                        ReplySetState::Open
                    };
                    // Always raise revision: this reply's `state`, `outbound`,
                    // and `updatedAt` in `mail-replyset-show` changed.
                    let new_revision = match self.engine.with_store(|store| {
                        store.finish_replyset_send(set_id, next_state, true, finished_at)
                    }) {
                        Ok(rev) => rev,
                        Err(store_err) => return failure(store_failure(&store_err)),
                    };
                    guard.disarm();
                    let remaining = total_replies.saturating_sub(total_sent);
                    let mut cmd_err = send_provider_failure(&error);
                    cmd_err = cmd_err.with_details(HashMap::from([
                        ("replyset".to_string(), json!(set_id)),
                        ("revision".to_string(), json!(new_revision)),
                        ("state".to_string(), json!(next_state.as_str())),
                        ("failedReply".to_string(), json!(reply.id)),
                        ("outbound".to_string(), json!(outbound_id)),
                        ("sent".to_string(), json!(total_sent)),
                        ("remaining".to_string(), json!(remaining)),
                    ]));
                    return failure(cmd_err);
                }
                SendOutcome::Unknown(why) => {
                    sent_copy_session.close().await;
                    let saved = self.engine.with_store(|store| {
                        store.finish_replyset_reply_unknown(
                            outbound_id,
                            reply.id,
                            set_id,
                            why,
                            finished_at,
                        )
                    });
                    if saved.is_ok() {
                        guard.disarm();
                    }
                    let (new_revision, record_saved) = match saved {
                        Ok(rev) => (json!(rev), true),
                        Err(_) => (Value::Null, false),
                    };
                    let total_sent = already_sent + sent_this_run;
                    let remaining = total_replies.saturating_sub(total_sent + 1);
                    return failure(
                        CommandError::new("SEND_OUTCOME_UNKNOWN", why)
                            .with_retryable(false)
                            .with_details(HashMap::from([
                                ("replyset".to_string(), json!(set_id)),
                                ("revision".to_string(), new_revision),
                                ("reply".to_string(), json!(reply.id)),
                                ("outbound".to_string(), json!(outbound_id)),
                                ("sent".to_string(), json!(total_sent)),
                                ("remaining".to_string(), json!(remaining)),
                                ("recordSaved".to_string(), json!(record_saved)),
                            ]))
                            .with_suggestion(
                                "Check your Sent mailbox and mail-status before deciding how to proceed; this send is never retried.",
                            ),
                    );
                }
            }
        }

        sent_copy_session.close().await;
        let finished_at = context.clock().now();
        let saved = self.engine.with_store(|store| {
            store.finish_replyset_send(set_id, ReplySetState::Sent, true, finished_at)
        });
        let (new_revision, set_saved) = match saved {
            Ok(rev) => {
                guard.disarm();
                (Some(rev), true)
            }
            Err(_) => (None, false),
        };

        let mut result = success(json!({
            "replyset": set_id,
            "revision": new_revision,
            "account": account.id.0,
            "state": "sent",
            "sent": sent_this_run,
            "total": total_replies,
            "sentCopies": sent_copies,
            "recordSaved": set_saved,
            "replies": outcomes,
        }));
        let mut warnings = Vec::new();
        if !set_saved {
            warnings.push(Warning::new(
                "OUTBOUND_RECORD_FAILED",
                "all replies were accepted by the provider, but the local send record could not be fully updated",
            ));
        }
        if sent_copy_failed {
            warnings.push(Warning::new(
                "SENT_COPY_FAILED",
                "one or more replies were sent, but their copies could not be placed in the sent mailbox",
            ));
        }
        if !warnings.is_empty() {
            result.warnings = Some(warnings);
        }
        result
    }
}

/// Reuses a single best-effort IMAP connection across a reply-set batch to
/// append `\Seen` Sent copies without reconnecting per reply.
struct SentCopySession<'a> {
    engine: &'a Engine,
    account: &'a AccountRow,
    sent_mailbox_key: Option<String>,
    provider: Option<Box<dyn Provider>>,
}

impl<'a> SentCopySession<'a> {
    fn new(engine: &'a Engine, account: &'a AccountRow) -> Self {
        let sent_mailbox_key = engine
            .with_store(|store| store.sent_mailbox(account.id))
            .ok()
            .flatten()
            .map(|m| m.provider_key);
        Self {
            engine,
            account,
            sent_mailbox_key,
            provider: None,
        }
    }

    async fn append(&mut self, message_bytes: &[u8]) -> bool {
        let (Some(connector), Some(mailbox_key)) = (
            self.engine.connector().cloned(),
            self.sent_mailbox_key.as_deref(),
        ) else {
            return false;
        };
        let work = async {
            if self.provider.is_none() {
                match connector.connect(self.account).await {
                    Ok(provider) => self.provider = Some(provider),
                    Err(_) => return false,
                }
            }
            if let Some(provider) = self.provider.as_mut()
                && provider
                    .append(mailbox_key, &["\\Seen"], message_bytes)
                    .await
                    .is_ok()
            {
                return true;
            }
            // Drop a broken session so the next reply can reconnect cleanly.
            if let Some(mut provider) = self.provider.take() {
                provider.close().await;
            }
            false
        };
        match tokio::time::timeout(SENT_COPY_TIMEOUT, work).await {
            Ok(ok) => ok,
            Err(_) => {
                self.provider = None;
                false
            }
        }
    }

    async fn close(&mut self) {
        if let Some(mut provider) = self.provider.take() {
            let _ = tokio::time::timeout(SENT_COPY_TIMEOUT, provider.close()).await;
        }
    }
}

/// `mail-replyset-send`: sends every unsent reply in a reviewed reply set at
/// the terminal after preview and approval (section 10.3, M18 and M29).
#[must_use]
pub fn send(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        SEND,
        "Send a reviewed reply set; only a person can run it, after previewing the revision named",
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
                "The revision previewed with mail-replyset-show",
                true,
            ),
        ],
        SendReplySet { engine },
    )
    .as_mutation()
    .with_destructive(true)
    .with_confirm_prompt("Send this reply set")
    .with_approval(ApprovalPolicy::Required)
    .with_expose(command_line_only())
}
