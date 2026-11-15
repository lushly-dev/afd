//! Screening's commands (the specification's 7.2, 7.3 and 11): the person's
//! decisions on senders, agents' suggestions of them, and the mail of each
//! class.
//!
//! - `mail-sender-screen` records the person's decision: in, out, that the
//!   address is theirs, or none. A person's command, at a terminal alone (a
//!   script is refused `PERSON_REQUIRED`), with no prompt: it is local, and
//!   undone by screening again with the `previous` it returns.
//! - `mail-sender-suggest` stores an agent's suggestion of in or out. It
//!   changes no class.
//! - `mail-sender-accept` makes a suggestion the person's decision. A
//!   person's command, held for approval, because the idea was not theirs.
//! - `mail-sender-dismiss` drops a suggestion: any, for the person at a
//!   terminal, or a caller's own.
//! - `mail-message-list` gives the mail of one class, newest first: `known`
//!   is the inbox, `unknown` the queue to be screened.
//!
//! A class is read only once no message waits to be derived again and no
//! rebuild is under way: until then a sender's row counts only some of its
//! messages, so a class could be wrong, and screening fails with
//! `SCREENING_NOT_READY`, which can be retried. A decision is recorded
//! whenever it is made.

use std::sync::Arc;

use afd::{
    ApprovalDecision, ApprovalPolicy, CommandContext, CommandDefinition, CommandError,
    CommandHandler, CommandInterface, CommandParameter, CommandResult, JsonSchemaType, failure,
    success,
};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::commands::{command_line_only, store_failure};
use crate::engine::Engine;
use crate::read::{
    LIST_BUDGET, MOST_BUDGET, budget, cursor, fit, integer, limit, parameter, read_exposure,
    required,
};
use crate::store::{
    Class, Decided, Decision, MessageId, Proposer, Readiness, Store, StoreError, Suggested,
    SuggestionRow, SuggestionState, TokenRow, sender_id,
};

/// How many suggestions one caller may have waiting (the specification's
/// 7.3).
pub const MOST_WAITING: u32 = 20;

/// The longest address the person may type (RFC 5321's path limit).
const MOST_ADDRESS: usize = 254;

/// How many of the latest blocks `mail-status` names.
const BLOCKED_SHOWN: u32 = 20;

/// Whether the caller is the person at a terminal: the command line, with
/// a terminal on standard input. A script at the command line is not.
fn person_at_terminal(context: &CommandContext) -> bool {
    context.interface == Some(CommandInterface::Cli)
        && context
            .actor
            .as_ref()
            .is_some_and(|actor| actor.kind == afd::ActorKind::Human)
}

/// The name of the command that accepts a suggestion.
pub const ACCEPT: &str = "mail-sender-accept";

/// The failure of a read of classes while they could be wrong.
#[must_use]
pub fn not_ready(readiness: Readiness) -> CommandError {
    let message = if readiness.rebuilding {
        "a rebuild is under way, and screening waits for it to finish".to_string()
    } else {
        format!(
            "{} messages wait to be derived again, and screening waits for them: until then a sender's history counts only some of its mail",
            readiness.stale
        )
    };
    CommandError::new("SCREENING_NOT_READY", message)
        .with_suggestion(
            "Try again once `loam-mail mail-status` shows `screening.ready`: a running server derives them in the background, and each `loam-mail mail-sync` does for a while.",
        )
        .with_retryable(true)
}

/// No sender has the id named.
#[must_use]
pub fn sender_not_found() -> CommandError {
    CommandError::new("SENDER_NOT_FOUND", "no sender has that id")
        .with_suggestion("Run `loam-mail mail-sender-list` to see the senders.")
}

/// No suggestion has the id named.
#[must_use]
pub fn suggestion_not_found() -> CommandError {
    CommandError::new("PROPOSAL_NOT_OPEN", "no suggestion has that id")
        .with_suggestion("Run `loam-mail mail-sender-list` with `suggested` to see the senders with suggestions waiting.")
}

fn not_open(row: &SuggestionRow) -> CommandError {
    CommandError::new(
        "PROPOSAL_NOT_OPEN",
        format!("suggestion {} was {} already", row.id, row.state.as_str()),
    )
    .with_suggestion("Run `loam-mail mail-sender-show` with its sender to see what is waiting.")
}

/// Who calls, as a suggestion records its proposer: the actor's kind and
/// id; over MCP with no actor (stdio's one caller), an agent with no id.
#[must_use]
pub fn proposer_of(context: &CommandContext) -> Proposer {
    match &context.actor {
        Some(actor) => Proposer {
            kind: actor.kind.as_str().to_string(),
            id: actor.id.clone(),
        },
        // Over stdio the one caller is an agent; elsewhere a caller with no
        // actor is named by where it came from.
        None => Proposer {
            kind: match context.interface {
                Some(CommandInterface::Mcp) => "agent".to_string(),
                Some(interface) => format!("{interface:?}").to_lowercase(),
                None => "unknown".to_string(),
            },
            id: None,
        },
    }
}

/// A proposer as a result gives it, with the token's name, the person's
/// own words, when it came with one.
#[must_use]
pub fn proposer_json(proposer: &Proposer, tokens: &[TokenRow]) -> Value {
    let name = proposer.id.as_ref().and_then(|id| {
        tokens
            .iter()
            .find(|token| &token.id == id)
            .map(|token| token.name.clone())
    });
    json!({ "kind": proposer.kind, "token": proposer.id, "name": name })
}

/// A suggestion as a result gives it.
#[must_use]
pub fn suggestion_json(row: &SuggestionRow, tokens: &[TokenRow]) -> Value {
    json!({
        "suggestion": row.id,
        "sender": row.sender,
        "decision": row.decision.as_str(),
        "proposer": proposer_json(&row.proposer, tokens),
        "createdAt": row.created_at,
        "state": row.state.as_str(),
        "closedAt": row.closed_at,
    })
}

/// An address the person typed, checked and in lower case as the
/// derivation writes a sender's.
fn typed_address(text: &str) -> Result<String, Box<CommandError>> {
    let address = text.trim();
    let plausible = address.len() <= MOST_ADDRESS
        && address
            .split_once('@')
            .is_some_and(|(local, domain)| !local.is_empty() && domain.contains('.'))
        && !address.chars().any(|c| c.is_whitespace() || c.is_control());
    if !plausible {
        return Err(Box::new(
            CommandError::new("INVALID_INPUT", "`address` is not an email address")
                .with_suggestion("Give the address as it is written, such as name@example.com."),
        ));
    }
    Ok(address.to_lowercase())
}

/// The decision a command's input names: `None` for `undecided`.
fn decision_input(input: &Value, allowed: &[&str]) -> Result<Option<Decision>, Box<CommandError>> {
    let text = input
        .get("decision")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !allowed.contains(&text) {
        return Err(Box::new(
            CommandError::new("INVALID_INPUT", "`decision` is not one this command takes")
                .with_suggestion(format!("Use one of: {}.", allowed.join(", "))),
        ));
    }
    Ok(Decision::parse(text))
}

/// The address a command's input names: by `address`, typed by the person,
/// or by `sender`, a sender's id, or the id of an address the person said
/// is theirs.
fn address_input(
    store: &Store,
    input: &Value,
) -> Result<Result<String, Box<CommandError>>, StoreError> {
    let typed = input.get("address").and_then(Value::as_str);
    let id = match integer(input, "sender") {
        Ok(id) => id,
        Err(error) => return Ok(Err(error)),
    };
    match (typed, id) {
        (Some(typed), None) => Ok(typed_address(typed)),
        (None, Some(id)) => {
            if let Some(row) = store.sender(id)? {
                return Ok(Ok(row.address));
            }
            Ok(store
                .decision_by_sender(id)?
                .map(|row| row.address)
                .ok_or_else(|| Box::new(sender_not_found())))
        }
        (typed, _) => Ok(Err(Box::new(
            CommandError::new(
                "INVALID_INPUT",
                if typed.is_some() {
                    "give either `sender` or `address`, not both"
                } else {
                    "give `sender` or `address`"
                },
            )
            .with_suggestion("Pass a sender's id from mail-sender-list, or type an address."),
        ))),
    }
}

fn decided_json(address: &str, decision: Option<Decision>, decided: &Decided) -> Value {
    json!({
        "sender": sender_id(address),
        "decision": decision.map_or("undecided", Decision::as_str),
        "previous": decided.previous.map_or("undecided", Decision::as_str),
        "changed": decided.changed,
    })
}

struct Screen {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Screen {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        // A decision is the person's alone: a script at the command line,
        // such as an agent's shell, is refused, as every person's command is.
        if !person_at_terminal(&context) {
            return failure(
                CommandError::new(
                    "PERSON_REQUIRED",
                    "`mail-sender-screen` is a person's command, and there is no terminal to ask",
                )
                .with_suggestion(
                    "Run it at a terminal. An agent can suggest a decision with mail-sender-suggest.",
                ),
            );
        }
        let decision = match decision_input(&input, &["in", "out", "mine", "undecided"]) {
            Ok(decision) => decision,
            Err(error) => return failure(*error),
        };
        let now = context.clock().now();
        let done = self.engine.with_store(|store| {
            let address = match address_input(store, &input)? {
                Ok(address) => address,
                Err(error) => return Ok(Err(error)),
            };
            // The person's own address by their account or their sent mail
            // is never a sender to screen in or out.
            if matches!(decision, Some(Decision::In | Decision::Out))
                && store.is_own_by_mail(&address)?
            {
                return Ok(Err(Box::new(
                    CommandError::new(
                        "INVALID_INPUT",
                        "that address is the person's own: an account's, or one their sent mail comes from",
                    )
                    .with_suggestion("Screen a stranger's address; your own mail is never screened."),
                )));
            }
            let decided = store.decide(&address, decision, now)?;
            Ok(Ok(decided_json(&address, decision, &decided)))
        });
        match done {
            Ok(Ok(result)) => success(result),
            Ok(Err(error)) => failure(*error),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-sender-screen`: the person's decision on a sender (the
/// specification's 7.3). A person's command with no prompt: local, and
/// undone by screening again with the `previous` it returns.
#[must_use]
pub fn screen(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-sender-screen",
        "Screen a sender in or out, say an address is yours, or take a decision back",
        vec![
            parameter(
                "sender",
                JsonSchemaType::Integer,
                "The sender, by id",
                false,
            ),
            parameter(
                "address",
                JsonSchemaType::String,
                "Instead of a sender: an address typed in full, such as one of yours",
                false,
            ),
            CommandParameter {
                name: "decision".to_string(),
                param_type: JsonSchemaType::String,
                description: "in (its mail is known), out (blocked), mine (the address is yours), or undecided".to_string(),
                required: true,
                default: None,
                enum_values: Some(
                    ["in", "out", "mine", "undecided"]
                        .iter()
                        .map(|decision| json!(decision))
                        .collect(),
                ),
                schema: None,
            },
        ],
        Screen { engine },
    )
    .as_mutation()
    .with_expose(command_line_only())
}

struct Suggest {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Suggest {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        // With `in` and `out` alone, a decision is always named.
        let decision = match decision_input(&input, &["in", "out"]) {
            Ok(Some(decision)) => decision,
            Ok(None) => return failure(decision_required()),
            Err(error) => return failure(*error),
        };
        let sender = match required(&input, "sender") {
            Ok(sender) => sender,
            Err(error) => return failure(*error),
        };
        let proposer = proposer_of(&context);
        let now = context.clock().now();
        let done = self.engine.with_store(|store| {
            let Some(row) = store.sender(sender)? else {
                return Ok(None);
            };
            store
                .suggest(&row.address, decision, &proposer, MOST_WAITING, now)
                .map(Some)
        });
        match done {
            Ok(Some(Suggested::Stored(id))) => success(json!({
                "suggestion": id,
                "sender": sender,
                "decision": decision.as_str(),
                "state": SuggestionState::Open.as_str(),
            })),
            Ok(Some(Suggested::TooMany(most))) => failure(
                CommandError::new(
                    "POLICY_LIMIT",
                    format!("this caller has {most} suggestions waiting already, the most it may"),
                )
                .with_suggestion(
                    "Wait for the person to accept or dismiss some, or dismiss your own with mail-sender-dismiss.",
                ),
            ),
            Ok(None) => failure(sender_not_found()),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

fn decision_required() -> CommandError {
    CommandError::new("INVALID_INPUT", "`decision` is required").with_suggestion("Use in or out.")
}

/// `mail-sender-suggest`: an agent's suggestion to screen a sender in or
/// out. It changes no class until the person accepts it.
#[must_use]
pub fn suggest(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-sender-suggest",
        "Suggest that the person screen a sender in or out; changes nothing until they accept",
        vec![
            parameter("sender", JsonSchemaType::Integer, "The sender, by id", true),
            CommandParameter {
                name: "decision".to_string(),
                param_type: JsonSchemaType::String,
                description: "in (its mail would be known) or out (blocked)".to_string(),
                required: true,
                default: None,
                enum_values: Some(vec![json!("in"), json!("out")]),
                schema: None,
            },
        ],
        Suggest { engine },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

/// Whether suggestion `id` can be accepted now: it is open, screening can
/// be read for its preview, and its address is still a stranger's.
fn acceptable(store: &Store, id: i64) -> Result<Result<SuggestionRow, CommandError>, StoreError> {
    let Some(row) = store.suggestion(id)? else {
        return Ok(Err(suggestion_not_found()));
    };
    if row.state != SuggestionState::Open {
        return Ok(Err(not_open(&row)));
    }
    let readiness = store.screening_readiness()?;
    if !readiness.ready() {
        return Ok(Err(not_ready(readiness)));
    }
    if store.is_own(&row.address)? {
        return Ok(Err(CommandError::new(
            "SENDER_NOT_FOUND",
            "the suggestion's address has become one of the person's own",
        )
        .with_suggestion("Dismiss the suggestion with mail-sender-dismiss.")));
    }
    Ok(Ok(row))
}

/// What the person is asked to approve for `mail-sender-accept`: the
/// suggestion, what it does and how many held messages change class, and no
/// address, which came from mail (the specification's 7.3). `None` when it
/// cannot be accepted now: the command refuses it without asking.
#[must_use]
pub fn approval_summary(engine: &Engine, input: &Value) -> Option<String> {
    let id = integer(input, "suggestion").ok()??;
    engine
        .with_store(|store| {
            let Ok(row) = acceptable(store, id)? else {
                return Ok(None);
            };
            let changes = store.would_change(&row.address, row.decision)?;
            let what = match row.decision {
                Decision::Out => "block 1 sender",
                Decision::In | Decision::Mine => "screen 1 sender in, so its mail is known",
            };
            let held = if changes == 1 {
                "message changes"
            } else {
                "messages change"
            };
            Ok(Some(format!(
                "Accept suggestion {id}: {what}; {changes} held {held} class"
            )))
        })
        .ok()?
}

struct Accept {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Accept {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let id = match required(&input, "suggestion") {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        let now = context.clock().now();
        let done = self.engine.with_store(|store| {
            if let Err(error) = acceptable(store, id)? {
                return Ok(Err(error));
            }
            // It became acceptable after the approval policy found it was
            // not, so the person was never asked: ask now.
            if context.approval.is_none() {
                return Ok(Err(CommandError::new(
                    afd::error_codes::CONFLICT,
                    format!("suggestion {id} became one the person can accept while the command ran, and they were not asked"),
                )
                .with_suggestion("Run `loam-mail mail-sender-accept` again at a terminal; it asks for approval.")
                .with_retryable(true)));
            }
            Ok(Ok(store.accept(id, now)?))
        });
        match done {
            Ok(Ok(Some((row, decided)))) => {
                let mut result = decided_json(&row.address, Some(row.decision), &decided);
                result["suggestion"] = json!(id);
                success(result)
            }
            // Another call closed it between the check and the accept.
            Ok(Ok(None)) => failure(
                CommandError::new(
                    "PROPOSAL_NOT_OPEN",
                    format!("suggestion {id} was closed while the command ran"),
                )
                .with_suggestion(
                    "Run `loam-mail mail-sender-show` with its sender to see what is waiting.",
                ),
            ),
            Ok(Err(error)) => failure(error),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-sender-accept`: makes an agent's suggestion the person's decision.
/// A person's command, held for their approval (M28); the command line
/// shows the preview, `mail-sender-show` with the suggestion, before it
/// asks.
#[must_use]
pub fn accept(engine: Arc<Engine>) -> CommandDefinition {
    let policy_engine = Arc::clone(&engine);
    CommandDefinition::new(
        ACCEPT,
        "Accept an agent's suggestion to screen a sender in or out",
        vec![parameter(
            "suggestion",
            JsonSchemaType::Integer,
            "The suggestion, by id",
            true,
        )],
        Accept { engine },
    )
    .as_mutation()
    .with_confirm_prompt("Accept the suggestion and screen the sender as it says")
    // A suggestion that cannot be accepted now is refused by the handler
    // without asking the person about it.
    .with_approval(ApprovalPolicy::when(move |input, _context| {
        let open = integer(input, "suggestion")
            .ok()
            .flatten()
            .and_then(|id| {
                policy_engine
                    .with_store(|store| Ok(acceptable(store, id)?.is_ok()))
                    .ok()
            })
            .unwrap_or(false);
        if open {
            ApprovalDecision::Required
        } else {
            ApprovalDecision::NotRequired
        }
    }))
    .with_expose(command_line_only())
}

struct Dismiss {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Dismiss {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let id = match required(&input, "suggestion") {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        // The person dismisses any at the command line; an agent its own.
        let person = person_at_terminal(&context);
        let caller = proposer_of(&context);
        let now = context.clock().now();
        let done = self.engine.with_store(|store| {
            let Some(row) = store.suggestion(id)? else {
                return Ok(Err(suggestion_not_found()));
            };
            if !person && row.proposer != caller {
                return Ok(Err(CommandError::new(
                    "FORBIDDEN",
                    "only the person, or the caller that proposed it, may dismiss a suggestion",
                )
                .with_suggestion("Dismiss only your own suggestions.")));
            }
            if !store.dismiss(id, now)? {
                return Ok(Err(not_open(&row)));
            }
            Ok(Ok(json!({
                "suggestion": id,
                "sender": row.sender,
                "state": SuggestionState::Dismissed.as_str(),
            })))
        });
        match done {
            Ok(Ok(result)) => success(result),
            Ok(Err(error)) => failure(error),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-sender-dismiss`: drops a suggestion. Any, for the person at a
/// terminal; otherwise the caller's own alone.
#[must_use]
pub fn dismiss(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-sender-dismiss",
        "Dismiss a suggestion: the person's, or its proposer's own",
        vec![parameter(
            "suggestion",
            JsonSchemaType::Integer,
            "The suggestion, by id",
            true,
        )],
        Dismiss { engine },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

struct MessageList {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for MessageList {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let read = || -> Result<Value, Box<CommandError>> {
            let class = input
                .get("class")
                .and_then(Value::as_str)
                .and_then(Class::parse)
                .ok_or_else(|| {
                    Box::new(
                        CommandError::new("INVALID_INPUT", "`class` is not a screening class")
                            .with_suggestion("Use known, unknown, bulk or blocked."),
                    )
                })?;
            let limit = limit(&input, 50, 200)?;
            let before = cursor(&input)?.map(|(date, message)| (date, MessageId(message)));
            let engine = &self.engine;
            let messages = engine
                .with_store(|store| {
                    let readiness = store.screening_readiness()?;
                    if !readiness.ready() {
                        return Ok(Err(readiness));
                    }
                    store.class_messages(class, before, limit + 1).map(Ok)
                })
                .map_err(|error| Box::new(store_failure(&error)))?
                .map_err(|readiness| Box::new(not_ready(readiness)))?;
            let more = messages.len() > limit as usize;
            let mut items = Vec::new();
            for listed in messages.iter().take(limit as usize) {
                let mut item = crate::read::message_item(engine, listed)
                    .map_err(|error| Box::new(store_failure(&error)))?;
                item["class"] = json!(class.as_str());
                item["sender"] = json!(sender_id(&listed.sender_address));
                items.push(item);
            }
            let (kept, cut) = fit(items, budget(&context, LIST_BUDGET));
            let next = (more || cut)
                .then(|| kept.last())
                .flatten()
                .map(|last| format!("{}.{}", last["date"], last["message"]));
            Ok(json!({ "class": class.as_str(), "messages": kept, "nextCursor": next }))
        };
        match read() {
            Ok(result) => success(result),
            Err(error) => failure(*error),
        }
    }
}

/// `mail-message-list`: the mail of one screening class that a mailbox
/// other than junk and trash shows, newest first, paged by cursor. `known`
/// is the inbox and `unknown` the queue to be screened; `blocked` is shown
/// only when asked for (the specification's 7.2).
#[must_use]
pub fn message_list(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-message-list",
        "List the messages of one screening class, newest first: known is the inbox, unknown the queue",
        vec![
            CommandParameter {
                name: "class".to_string(),
                param_type: JsonSchemaType::String,
                description: "known, unknown, bulk or blocked".to_string(),
                required: true,
                default: None,
                enum_values: Some(Class::ALL.iter().map(|class| json!(class.as_str())).collect()),
                schema: None,
            },
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
        MessageList { engine },
    )
    .with_output_budget(LIST_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}

/// What `mail-status` says of screening: whether it can be read, the queue,
/// the suggestions waiting, and the senders blocked in the last 30 days and
/// by whom, so that a wrong block is seen (the specification's 7.3).
///
/// # Errors
/// When the database refuses.
pub fn status_json(store: &Store, now: i64) -> Result<Value, StoreError> {
    const THIRTY_DAYS: i64 = 30 * 24 * 60 * 60 * 1000;
    let readiness = store.screening_readiness()?;
    let ready = readiness.ready();
    let queue = if ready {
        let (messages, senders) = store.queue_counts()?;
        json!({ "messages": messages, "senders": senders })
    } else {
        Value::Null
    };
    let tokens = store.tokens()?;
    let (blocked, blocked_total) =
        store.blocked_since(now.saturating_sub(THIRTY_DAYS), BLOCKED_SHOWN)?;
    let blocked: Vec<Value> = blocked
        .iter()
        .map(|(decision, suggestion)| {
            let by = match suggestion {
                Some(suggestion) => json!({
                    "kind": "suggestion",
                    "suggestion": suggestion.id,
                    "proposer": proposer_json(&suggestion.proposer, &tokens),
                }),
                None => json!({ "kind": "person" }),
            };
            json!({
                "sender": decision.sender,
                "blockedAt": decision.decided_at,
                "by": by,
                "content": crate::read::content(json!({ "address": decision.address })),
            })
        })
        .collect();
    Ok(json!({
        "ready": ready,
        "rebuilding": readiness.rebuilding,
        "queue": queue,
        "suggestionsWaiting": store.open_suggestion_count()?,
        "blockedLately": blocked,
        // Every block of the 30 days, of which `blockedLately` is the latest;
        // `mail-sender-list` with `decision` gives them all.
        "blockedLatelyTotal": blocked_total,
    }))
}
