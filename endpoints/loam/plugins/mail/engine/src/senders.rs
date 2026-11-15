//! The sender commands (the specification's sections 7.1, 7.3 and 11):
//! `mail-sender-list` and `mail-sender-show`.
//!
//! A sender's address, its name, its domain and its lists came from messages,
//! so they sit in a part labelled `"trust": "content"`; outside it a result
//! holds the engine's own counts, dates, ids, classes and decisions (12.1).

use std::sync::Arc;

use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandParameter,
    CommandResult, JsonSchemaType, failure, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::commands::store_failure;
use crate::engine::Engine;
use crate::read::{
    LIST_BUDGET, MOST_BUDGET, OPEN_BUDGET, budget, content, cursor, fit, integer, limit, parameter,
    read_exposure,
};
use crate::screening::{not_ready, proposer_json, suggestion_json};
use crate::store::{
    ClassCounts, Decision, DecisionRow, Readiness, SenderQuery, SenderRow, Store, StoreError,
    SuggestionRow, sender_id,
};

/// How many of a sender's lists `mail-sender-show` names.
const LISTS_SHOWN: u32 = 10;

/// A sender's counts and dates, with what came from its messages in a
/// content part.
fn sender_item(sender: &SenderRow) -> Value {
    json!({
        "sender": sender.id,
        "messages": sender.messages,
        "bulk": sender.bulk,
        "firstReceived": sender.first_received,
        "lastReceived": sender.last_received,
        "written": sender.written,
        "lastWritten": sender.last_written,
        "answered": sender.answered,
        "recent": sender.recent,
        "decision": sender.decision.map(|decision| decision.as_str()),
        "content": content(json!({
            "address": sender.address,
            "name": sender.name,
            "domain": sender.domain,
        })),
    })
}

/// An optional boolean input.
fn flag(input: &Value, name: &str) -> bool {
    // The registry has checked each input's type against the schema.
    input.get(name).and_then(Value::as_bool).unwrap_or(false)
}

struct SenderList {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for SenderList {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let read = || -> Result<Value, Box<CommandError>> {
            let limit = limit(&input, 50, 200)?;
            let domain = input
                .get("domain")
                .and_then(Value::as_str)
                .map(|domain| domain.trim().to_lowercase());
            let query = SenderQuery {
                domain: domain.as_deref(),
                written_to: flag(&input, "writtenTo"),
                waiting: flag(&input, "waiting"),
                suggested: flag(&input, "suggested"),
                decision: input
                    .get("decision")
                    .and_then(Value::as_str)
                    .and_then(Decision::parse),
                before: cursor(&input)?,
                limit: limit + 1,
            };
            let senders = self
                .engine
                .with_store(|store| {
                    // Which mail waits to be screened is read from classes.
                    if query.waiting {
                        let readiness = store.screening_readiness()?;
                        if !readiness.ready() {
                            return Ok(Err(readiness));
                        }
                    }
                    store.senders(&query).map(Ok)
                })
                .map_err(|error| Box::new(store_failure(&error)))?
                .map_err(|readiness| Box::new(not_ready(readiness)))?;
            let more = senders.len() > limit as usize;
            let items: Vec<Value> = senders
                .iter()
                .take(limit as usize)
                .map(sender_item)
                .collect();
            let (kept, cut) = fit(items, budget(&context, LIST_BUDGET));
            let next = (more || cut)
                .then(|| kept.last())
                .flatten()
                .map(|last| format!("{}.{}", last["recent"], last["sender"]));
            Ok(json!({ "senders": kept, "nextCursor": next }))
        };
        match read() {
            Ok(result) => success(result),
            Err(error) => failure(*error),
        }
    }
}

/// `mail-sender-list`: the senders, the most recent first, paged by cursor.
#[must_use]
pub fn list(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-sender-list",
        "List the senders, most recent first, with their history with the person",
        vec![
            parameter(
                "domain",
                JsonSchemaType::String,
                "Only senders of this registrable domain",
                false,
            ),
            parameter(
                "writtenTo",
                JsonSchemaType::Boolean,
                "Only senders the person has written to",
                false,
            ),
            parameter(
                "waiting",
                JsonSchemaType::Boolean,
                "Only senders whose mail waits to be screened (class unknown)",
                false,
            ),
            parameter(
                "suggested",
                JsonSchemaType::Boolean,
                "Only senders with an agent's suggestion waiting for the person",
                false,
            ),
            CommandParameter {
                name: "decision".to_string(),
                param_type: JsonSchemaType::String,
                description: "Only senders the person screened so: in or out".to_string(),
                required: false,
                default: None,
                enum_values: Some(vec![json!("in"), json!("out")]),
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
                "At most this many senders (1 to 200)",
                false,
            ),
        ],
        SenderList { engine },
    )
    .with_output_budget(LIST_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}

/// What `mail-sender-show` reads for one sender.
struct Shown {
    /// The address: the sender row's, or a decision's for an address the
    /// person said is theirs, which has no row.
    address: String,
    id: i64,
    row: Option<SenderRow>,
    decision: Option<DecisionRow>,
    places: Vec<crate::store::SenderPlace>,
    lists: Vec<(String, u64)>,
    readiness: Readiness,
    classes: ClassCounts,
    suggestions: Vec<SuggestionRow>,
    /// The suggestion asked about, with how many held messages accepting it
    /// would change, and why it cannot be accepted now, if it cannot.
    preview: Option<(SuggestionRow, u64, Option<String>)>,
    tokens: Vec<crate::store::TokenRow>,
}

/// Reads one sender, by its id or by a suggestion about it. `None` when
/// there is no such sender or suggestion.
fn read_shown(
    store: &Store,
    sender: Option<i64>,
    suggestion: Option<i64>,
) -> Result<Option<Shown>, StoreError> {
    let asked = match suggestion {
        Some(id) => match store.suggestion(id)? {
            Some(row) => Some(row),
            None => return Ok(None),
        },
        None => None,
    };
    // A suggestion is about an address: the preview shows that address,
    // whatever other address shares its sender id.
    let (address, row) = match &asked {
        Some(asked) => {
            let row = store
                .sender(asked.sender)?
                .filter(|row| row.address == asked.address);
            (asked.address.clone(), row)
        }
        None => {
            let id = sender.unwrap_or_default();
            match store.sender(id)? {
                Some(row) => (row.address.clone(), Some(row)),
                None => match store.decision_by_sender(id)? {
                    Some(decision) => (decision.address, None),
                    None => return Ok(None),
                },
            }
        }
    };
    let readiness = store.screening_readiness()?;
    let preview = match asked {
        Some(asked) => {
            let changes = store.would_change(&address, asked.decision)?;
            let refusal = crate::screening::acceptable(store, asked.id)?
                .err()
                .map(|error| error.code);
            Some((asked, changes, refusal))
        }
        None => None,
    };
    Ok(Some(Shown {
        id: sender_id(&address),
        decision: store.decision(&address)?,
        places: store.sender_places(&address)?,
        lists: store.sender_lists(&address, LISTS_SHOWN)?,
        classes: store.class_counts(&address)?,
        suggestions: store.open_suggestions(&address)?,
        tokens: store.tokens()?,
        readiness,
        preview,
        row,
        address,
    }))
}

fn classes_json(classes: &ClassCounts) -> Value {
    json!({
        "blocked": classes.blocked,
        "known": classes.known,
        "bulk": classes.bulk,
        "unknown": classes.unknown,
    })
}

/// The decision as a result gives it: what, when, and from which
/// suggestion.
fn decision_json(decision: Option<&DecisionRow>) -> Value {
    decision.map_or(Value::Null, |decision| {
        json!({
            "decision": decision.decision.as_str(),
            "decidedAt": decision.decided_at,
            "suggestion": decision.suggestion,
        })
    })
}

fn shown_json(shown: &Shown) -> Value {
    let ready = shown.readiness.ready();
    let mut item = match &shown.row {
        Some(row) => sender_item(row),
        // An address the person said is theirs has no sender row.
        None => json!({
            "sender": shown.id,
            "content": content(json!({ "address": shown.address })),
        }),
    };
    item["decision"] = decision_json(shown.decision.as_ref());
    item["mailboxes"] = shown
        .places
        .iter()
        .map(|place| json!({ "mailbox": place.mailbox.0, "messages": place.messages }))
        .collect();
    item["content"]["lists"] = shown
        .lists
        .iter()
        .map(|(list, messages)| json!({ "list": list, "messages": messages }))
        .collect();
    item["screening"] = json!({
        "ready": ready,
        "stale": shown.readiness.stale,
        "rebuilding": shown.readiness.rebuilding,
    });
    // A class read while messages wait to be derived again could be wrong.
    item["classes"] = if ready {
        classes_json(&shown.classes)
    } else {
        Value::Null
    };
    item["suggestions"] = shown
        .suggestions
        .iter()
        .map(|suggestion| suggestion_json(suggestion, &shown.tokens))
        .collect();
    if let Some((asked, changes, refusal)) = &shown.preview {
        item["preview"] = json!({
            // Whether accepting it now would go ahead, and if not, the code
            // mail-sender-accept would refuse it with.
            "acceptable": refusal.is_none(),
            "refusal": refusal,
            "suggestion": suggestion_json(asked, &shown.tokens),
            "decision": asked.decision.as_str(),
            "proposer": proposer_json(&asked.proposer, &shown.tokens),
            "changes": ready.then_some(*changes),
            "writtenTo": shown.row.as_ref().is_some_and(|row| row.written > 0),
            "written": shown.row.as_ref().map_or(0, |row| row.written),
        });
    }
    item
}

struct SenderShow {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for SenderShow {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let read = || -> Result<Value, Box<CommandError>> {
            let sender = integer(&input, "sender")?;
            let suggestion = integer(&input, "suggestion")?;
            if sender.is_some() == suggestion.is_some() {
                return Err(Box::new(
                    CommandError::new(
                        "INVALID_INPUT",
                        if sender.is_some() {
                            "give either `sender` or `suggestion`, not both"
                        } else {
                            "give `sender` or `suggestion`"
                        },
                    )
                    .with_suggestion(
                        "Pass a sender's id from mail-sender-list, or a suggestion's id to preview accepting it.",
                    ),
                ));
            }
            let shown = self
                .engine
                .with_store(|store| read_shown(store, sender, suggestion))
                .map_err(|error| Box::new(store_failure(&error)))?;
            let Some(shown) = shown else {
                return Err(Box::new(if suggestion.is_some() {
                    crate::screening::suggestion_not_found()
                } else {
                    crate::screening::sender_not_found()
                }));
            };
            let shown = shown_json(&shown);
            let room = budget(&context, OPEN_BUDGET);
            if crate::read::fits(&shown, room) {
                Ok(shown)
            } else {
                Err(Box::new(crate::read::too_small(room)))
            }
        };
        match read() {
            Ok(result) => success(result),
            Err(error) => failure(*error),
        }
    }
}

/// `mail-sender-show`: one sender's history with the person, where its
/// messages are, the lists they came through, how many are in each class,
/// the person's decision and the suggestions waiting. With a suggestion's
/// id it is the preview of accepting it (the specification's 7.3).
#[must_use]
pub fn show(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-sender-show",
        "Show a sender's history with the person, its classes and decision, or preview a suggestion",
        vec![
            parameter(
                "sender",
                JsonSchemaType::Integer,
                "The sender, by id",
                false,
            ),
            parameter(
                "suggestion",
                JsonSchemaType::Integer,
                "Instead of a sender: a suggestion, to preview accepting it",
                false,
            ),
        ],
        SenderShow { engine },
    )
    .with_output_budget(OPEN_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}
