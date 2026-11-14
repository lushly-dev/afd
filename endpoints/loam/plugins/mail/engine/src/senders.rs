//! The sender commands (the specification's sections 7.1 and 11):
//! `mail-sender-list` and `mail-sender-show`.
//!
//! A sender's address, its name, its domain and its lists came from messages,
//! so they sit in a part labelled `"trust": "content"`; outside it a result
//! holds the engine's own counts, dates and ids (12.1).

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
    LIST_BUDGET, MOST_BUDGET, OPEN_BUDGET, budget, content, cursor, fit, limit, parameter,
    read_exposure, required,
};
use crate::store::{SenderQuery, SenderRow};

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
        "content": content(json!({
            "address": sender.address,
            "name": sender.name,
            "domain": sender.domain,
        })),
    })
}

struct SenderList {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for SenderList {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let read = || -> Result<Value, Box<CommandError>> {
            let limit = limit(&input, 50, 200)?;
            // The registry has checked each input's type against the schema.
            let domain = input
                .get("domain")
                .and_then(Value::as_str)
                .map(|domain| domain.trim().to_lowercase());
            let query = SenderQuery {
                domain: domain.as_deref(),
                written_to: input
                    .get("writtenTo")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                before: cursor(&input)?,
                limit: limit + 1,
            };
            let senders = self
                .engine
                .with_store(|store| store.senders(&query))
                .map_err(|error| Box::new(store_failure(&error)))?;
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

struct SenderShow {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for SenderShow {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let read = || -> Result<Value, Box<CommandError>> {
            let id = required(&input, "sender")?;
            let found = self
                .engine
                .with_store(|store| {
                    let Some(sender) = store.sender(id)? else {
                        return Ok(None);
                    };
                    let places = store.sender_places(&sender.address)?;
                    let lists = store.sender_lists(&sender.address, LISTS_SHOWN)?;
                    Ok(Some((sender, places, lists)))
                })
                .map_err(|error| Box::new(store_failure(&error)))?;
            let Some((sender, places, lists)) = found else {
                return Err(Box::new(
                    CommandError::new("SENDER_NOT_FOUND", "no sender has that id")
                        .with_suggestion("Run `loam-mail mail-sender-list` to see the senders."),
                ));
            };
            let mut shown = sender_item(&sender);
            shown["mailboxes"] = places
                .iter()
                .map(|place| json!({ "mailbox": place.mailbox.0, "messages": place.messages }))
                .collect();
            shown["content"]["lists"] = lists
                .iter()
                .map(|(list, messages)| json!({ "list": list, "messages": messages }))
                .collect();
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
/// messages are, and the lists they came through.
#[must_use]
pub fn show(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-sender-show",
        "Show a sender's history with the person, where its messages are and its lists",
        vec![parameter(
            "sender",
            JsonSchemaType::Integer,
            "The sender, by id",
            true,
        )],
        SenderShow { engine },
    )
    .with_output_budget(OPEN_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}
