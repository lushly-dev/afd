//! What a caller does with an operation once it is made (the
//! specification's 9.1 and 9.3): `mail-operation-list` and `-show` read
//! them; `-resume` carries on a stopped one with its frozen set, never
//! resolving its query again; `-cancel` stops one after the batch in hand;
//! and `-undo` puts back what one changed, from the places and states it
//! recorded, as an operation of its own.
//!
//! An agent's or a script's resume or undo is under the person's policy by
//! its size, as a change is; anyone may cancel. Results hold ids, counts and
//! the engine's words: no text from mail.

use std::sync::Arc;

use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult, JsonSchemaType,
    failure, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::changes::{beyond_policy, carry_out};
use crate::commands::store_failure;
use crate::engine::Engine;
use crate::operate::operation_json;
use crate::read::{integer, limit, parameter, read_exposure, required};
use crate::screening::proposer_of;
use crate::store::{
    Action, Kind, NewItem, NewOperation, OperationItem, OperationRow, OperationState, Role, Step,
    Store, StoreError,
};

/// The name of the command that undoes an operation.
pub const UNDO: &str = "mail-operation-undo";

/// The name of the command that resumes one.
pub const RESUME: &str = "mail-operation-resume";

fn not_found(id: i64) -> CommandError {
    CommandError::new("OPERATION_NOT_FOUND", format!("there is no operation {id}"))
        .with_suggestion("Run `loam-mail mail-operation-list` to see the operations.")
}

/// Operation `id`, or its failure.
fn named(store: &Store, id: i64) -> Result<Result<OperationRow, CommandError>, StoreError> {
    Ok(store.operation(id)?.ok_or_else(|| not_found(id)))
}

struct List {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for List {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        let before = match input.get("cursor") {
            None | Some(Value::Null) => None,
            Some(value) => match value.as_str().and_then(|text| text.parse::<i64>().ok()) {
                Some(id) => Some(id),
                None => {
                    return failure(
                        CommandError::new("INVALID_INPUT", "`cursor` is not one this command gave")
                            .with_suggestion(
                                "Pass the `nextCursor` of the result before, or none.",
                            ),
                    );
                }
            },
        };
        let limit = match limit(&input, 20, 100) {
            Ok(limit) => limit,
            Err(error) => return failure(*error),
        };
        let listed = self.engine.with_store(|store| {
            let rows = store.operations(before, limit + 1)?;
            let tokens = store.tokens()?;
            let mut listed = Vec::with_capacity(rows.len());
            for row in &rows {
                let counts = store.operation_counts(row.id)?;
                listed.push((row.id, operation_json(row, &counts, &tokens)));
            }
            Ok(listed)
        });
        let mut listed = match listed {
            Ok(listed) => listed,
            Err(error) => return failure(store_failure(&error)),
        };
        let next = (listed.len() > limit as usize).then(|| {
            listed.truncate(limit as usize);
            listed.last().map(|(id, _)| id.to_string())
        });
        success(json!({
            "operations": listed.into_iter().map(|(_, value)| value).collect::<Vec<_>>(),
            "nextCursor": next.flatten(),
        }))
    }
}

/// `mail-operation-list`: the operations, newest first.
#[must_use]
pub fn list(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-operation-list",
        "List the changes made to mail at the provider, newest first, with their counts",
        vec![
            parameter(
                "cursor",
                JsonSchemaType::String,
                "The `nextCursor` of the page before",
                false,
            ),
            parameter(
                "limit",
                JsonSchemaType::Integer,
                "How many to list, 1 to 100; 20 by default",
                false,
            ),
        ],
        List { engine },
    )
    .with_expose(read_exposure())
}

/// An item as `mail-operation-show` gives it: ids and its step.
fn item_json(item: &OperationItem) -> Value {
    json!({
        "message": item.message,
        "mailbox": item.mailbox,
        "toMailbox": item.to_mailbox,
        "step": item.step.as_str(),
    })
}

/// A cursor over items: the place of the last one given.
fn item_cursor(item: &OperationItem) -> String {
    format!("{}:{}:{}", item.mailbox, item.validity, item.provider_id)
}

fn parse_item_cursor(text: &str) -> Option<(i64, String, String)> {
    let mut parts = text.splitn(3, ':');
    let mailbox = parts.next()?.parse().ok()?;
    let validity = parts.next()?.to_string();
    let provider_id = parts.next()?.to_string();
    Some((mailbox, validity, provider_id))
}

struct Show {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Show {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        let id = match required(&input, "operation") {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        let after = match input.get("cursor") {
            None | Some(Value::Null) => None,
            Some(value) => match value.as_str().and_then(parse_item_cursor) {
                Some(after) => Some(after),
                None => {
                    return failure(
                        CommandError::new("INVALID_INPUT", "`cursor` is not one this command gave")
                            .with_suggestion(
                                "Pass the `nextCursor` of the result before, or none.",
                            ),
                    );
                }
            },
        };
        let limit = match limit(&input, 50, 500) {
            Ok(limit) => limit,
            Err(error) => return failure(*error),
        };
        let shown = self.engine.with_store(|store| {
            let row = match named(store, id)? {
                Ok(row) => row,
                Err(error) => return Ok(Err(error)),
            };
            let counts = store.operation_counts(id)?;
            let tokens = store.tokens()?;
            let items = store.operation_items(
                id,
                after.as_ref().map(|(mailbox, validity, provider_id)| {
                    (*mailbox, validity.as_str(), provider_id.as_str())
                }),
                limit + 1,
            )?;
            Ok(Ok((operation_json(&row, &counts, &tokens), items)))
        });
        let (mut value, mut items) = match shown {
            Ok(Ok(shown)) => shown,
            Ok(Err(error)) => return failure(error),
            Err(error) => return failure(store_failure(&error)),
        };
        let next = (items.len() > limit as usize).then(|| {
            items.truncate(limit as usize);
            items.last().map(item_cursor)
        });
        value["items"] = json!(items.iter().map(item_json).collect::<Vec<_>>());
        value["nextCursor"] = json!(next.flatten());
        success(value)
    }
}

/// `mail-operation-show`: one operation, its counts, and a page of what it
/// did to each message.
#[must_use]
pub fn show(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-operation-show",
        "Show one change to mail: its state, its counts and the step each message reached",
        vec![
            parameter(
                "operation",
                JsonSchemaType::Integer,
                "The operation's id",
                true,
            ),
            parameter(
                "cursor",
                JsonSchemaType::String,
                "The `nextCursor` of the page of items before",
                false,
            ),
            parameter(
                "limit",
                JsonSchemaType::Integer,
                "How many items to give, 1 to 500; 50 by default",
                false,
            ),
        ],
        Show { engine },
    )
    .with_expose(read_exposure())
}

struct Resume {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Resume {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let id = match required(&input, "operation") {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        if self.engine.operation_busy(id) {
            return failure(busy(id));
        }
        let creator = proposer_of(&context);
        let now = context.clock().now();
        let resumed = self.engine.with_store(|store| {
            let row = match named(store, id)? {
                Ok(row) => row,
                Err(error) => return Ok(Err(error)),
            };
            if row.state == OperationState::Running {
                return Ok(Err(busy(id)));
            }
            if let Some(undo) = row.undone_by {
                return Ok(Err(CommandError::new(
                    "INVALID_INPUT",
                    format!("operation {id} was undone by operation {undo}, and is not carried on"),
                )
                .with_suggestion("Make the change again, if it is still wanted.")));
            }
            let counts = store.operation_counts(id)?;
            if row.state == OperationState::Done || counts.waiting == 0 {
                return Ok(Err(CommandError::new(
                    "INVALID_INPUT",
                    format!("operation {id} is done: nothing is left to carry on"),
                )
                .with_suggestion(
                    "Run `loam-mail mail-operation-show` to see what it did.",
                )));
            }
            // An operation the caller made was counted against its day when
            // it was made.
            if let Some(error) =
                beyond_policy(store, &creator, row.kind, counts.waiting, false, now)?
            {
                return Ok(Err(error));
            }
            store.set_operation_state(id, OperationState::Running, None, now)?;
            Ok(Ok(counts.waiting))
        });
        let waiting = match resumed {
            Ok(Ok(waiting)) => waiting,
            Ok(Err(error)) => return failure(error),
            Err(error) => return failure(store_failure(&error)),
        };
        carry_out(&self.engine, id, waiting, &context).await
    }
}

/// An operation that runs, which an undo waits for.
fn running(id: i64) -> CommandError {
    CommandError::new("WORK_RUNNING", format!("operation {id} runs now"))
        .with_suggestion(
            "Stop it with mail-operation-cancel and wait for the batch in hand, then undo what it did.",
        )
        .with_retryable(true)
}

fn busy(id: i64) -> CommandError {
    CommandError::new("WORK_RUNNING", format!("operation {id} runs already"))
        .with_suggestion("Wait for it: `mail-operation-show` reports how far it has come.")
        .with_retryable(true)
}

/// `mail-operation-resume`: carries on a stopped operation from the step
/// each message reached.
#[must_use]
pub fn resume(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        RESUME,
        "Carry on a stopped change to mail from where each message reached, with the same messages",
        vec![parameter(
            "operation",
            JsonSchemaType::Integer,
            "The operation's id",
            true,
        )],
        Resume { engine },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

struct Cancel {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Cancel {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        let id = match required(&input, "operation") {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        let cancelled = self.engine.with_store(|store| {
            let row = match named(store, id)? {
                Ok(row) => row,
                Err(error) => return Ok(Err(error)),
            };
            let asked = store.ask_operation_stop(id)?;
            let counts = store.operation_counts(id)?;
            let tokens = store.tokens()?;
            let row = store.operation(id)?.unwrap_or(row);
            let mut value = operation_json(&row, &counts, &tokens);
            // Whether it was running: it stops after the batch in hand.
            value["stopping"] = json!(asked);
            Ok(Ok(value))
        });
        match cancelled {
            Ok(Ok(value)) => success(value),
            Ok(Err(error)) => failure(error),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-operation-cancel`: stops an operation after the batch in hand.
#[must_use]
pub fn cancel(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-operation-cancel",
        "Stop a change to mail after the batch in hand; it can be resumed or undone",
        vec![parameter(
            "operation",
            JsonSchemaType::Integer,
            "The operation's id",
            true,
        )],
        Cancel { engine },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

/// What undoing `row` does to each message it changed: the inverse of its
/// action, from the places and states it recorded.
fn inverse(row: &OperationRow, done: &[OperationItem]) -> (Action, Vec<NewItem>) {
    let action = match row.action {
        Action::Move => Action::Move,
        Action::Copy => Action::Remove,
        Action::Remove => Action::Copy,
        Action::Flags => Action::Flags,
    };
    let mut items = Vec::with_capacity(done.len());
    for item in done {
        let undo = match row.action {
            // From where it went, back to where it was. For a removed copy,
            // from the message it was copied from, into the mailbox the copy
            // was in. For a copy, the copy goes while its original stays.
            Action::Move | Action::Remove => {
                let (Some(to), Some(validity), Some(provider_id)) = (
                    item.to_mailbox,
                    item.to_validity.clone(),
                    item.to_provider_id.clone(),
                ) else {
                    continue;
                };
                NewItem {
                    mailbox: to,
                    validity,
                    provider_id,
                    message: item.message,
                    to_mailbox: Some(item.mailbox),
                    to_validity: None,
                    to_provider_id: None,
                    flags_wanted: None,
                    step: Step::Waiting,
                }
            }
            Action::Copy => {
                let (Some(to), Some(validity), Some(provider_id)) = (
                    item.to_mailbox,
                    item.to_validity.clone(),
                    item.to_provider_id.clone(),
                ) else {
                    continue;
                };
                NewItem {
                    mailbox: to,
                    validity,
                    provider_id,
                    message: item.message,
                    to_mailbox: Some(item.mailbox),
                    to_validity: Some(item.validity.clone()),
                    to_provider_id: Some(item.provider_id.clone()),
                    flags_wanted: None,
                    step: Step::Waiting,
                }
            }
            Action::Flags => {
                let (Some(before), Some(wanted)) = (&item.flags_before, &item.flags_wanted) else {
                    continue;
                };
                let wanted: serde_json::Map<String, Value> =
                    serde_json::from_str(wanted).unwrap_or_default();
                let back: serde_json::Map<String, Value> = wanted
                    .keys()
                    .map(|flag| (flag.clone(), json!(before.contains(flag))))
                    .collect();
                NewItem {
                    mailbox: item.mailbox,
                    validity: item.validity.clone(),
                    provider_id: item.provider_id.clone(),
                    message: item.message,
                    to_mailbox: None,
                    to_validity: None,
                    to_provider_id: None,
                    flags_wanted: Some(Value::Object(back).to_string()),
                    step: Step::Waiting,
                }
            }
        };
        items.push(undo);
    }
    (action, items)
}

struct Undo {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Undo {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let id = match required(&input, "operation") {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        if self.engine.operation_busy(id) {
            return failure(running(id));
        }
        let creator = proposer_of(&context);
        let now = context.clock().now();
        let made = self.engine.with_store(|store| {
            let row = match named(store, id)? {
                Ok(row) => row,
                Err(error) => return Ok(Err(error)),
            };
            if row.state == OperationState::Running {
                return Ok(Err(running(id)));
            }
            if let Some(undo) = row.undone_by {
                return Ok(Err(CommandError::new(
                    "INVALID_INPUT",
                    format!("operation {id} was undone already, by operation {undo}"),
                )
                .with_suggestion(
                    "Resume that undo if it stopped, or undo it to make the change again.",
                )));
            }
            // A message part-way through a step (copied and its original not
            // yet removed, or flagged to be) is finished first: undone from
            // there, an original flagged to be deleted would stay so, and
            // another client could remove it for good.
            let counts = store.operation_counts(id)?;
            if counts.midway > 0 {
                return Ok(Err(CommandError::new(
                    "INVALID_INPUT",
                    format!(
                        "operation {id} stopped with {} places part-way through a step; they are finished before it is undone",
                        counts.midway
                    ),
                )
                .with_suggestion(
                    "Resume it with mail-operation-resume until those places are finished (mail-operation-cancel stops it after the batch in hand), then undo it.",
                )));
            }
            let done = store.operation_done_items(id)?;
            let (action, items) = inverse(&row, &done);
            let messages = items.len() as u64;
            // An undo that moves mail into the trash, or junk, counts as
            // trash.
            let trash_boxes: Vec<i64> = {
                let mut boxes = Vec::new();
                for account in store.accounts()? {
                    for mailbox in store.mailboxes(account.id)? {
                        if matches!(mailbox.role, Role::Trash | Role::Junk) {
                            boxes.push(mailbox.id.0);
                        }
                    }
                }
                boxes
            };
            let kind = if action == Action::Move
                && items
                    .iter()
                    .any(|item| item.to_mailbox.is_some_and(|to| trash_boxes.contains(&to)))
            {
                Kind::Trash
            } else {
                Kind::Change
            };
            if let Some(error) = beyond_policy(store, &creator, kind, messages, true, now)? {
                return Ok(Err(error));
            }
            let undo = store.create_operation(
                &NewOperation {
                    command: UNDO.to_string(),
                    action,
                    kind,
                    asked: json!({ "operation": id }).to_string(),
                    undo_of: Some(id),
                    selection: None,
                    query: None,
                    creator: creator.clone(),
                    messages,
                    items,
                },
                now,
            )?;
            Ok(Ok((undo.id, messages)))
        });
        let (undo, messages) = match made {
            Ok(Ok(made)) => made,
            Ok(Err(error)) => return failure(error),
            Err(error) => return failure(store_failure(&error)),
        };
        carry_out(&self.engine, undo, messages, &context).await
    }
}

/// `mail-operation-undo`: puts back what an operation changed, as an
/// operation of its own.
#[must_use]
pub fn undo(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        UNDO,
        "Undo a change to mail: put each message it changed back where and as it was",
        vec![parameter(
            "operation",
            JsonSchemaType::Integer,
            "The operation's id",
            true,
        )],
        Undo { engine },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

/// Whether `input` names an operation, for the command line's question.
#[must_use]
pub fn operation_input(input: &Value) -> Option<i64> {
    integer(input, "operation").ok().flatten()
}
