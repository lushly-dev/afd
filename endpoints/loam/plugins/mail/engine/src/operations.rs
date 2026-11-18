//! What a caller does with an operation once it is made (the
//! specification's 9.1, 9.3 and 9.4): `mail-operation-list` and `-show`
//! read them; `-resume` carries on a stopped one with its frozen set, never
//! resolving its query again; `-cancel` stops one after the batch in hand;
//! `-undo` puts back what one changed, from the places and states it
//! recorded, as an operation of its own; and `-approve` and `-dismiss`
//! decide a proposal.
//!
//! An agent's or a script's resume or undo is under the person's policy by
//! its size, as a change is: over it, it is a proposal (M28). Anyone may
//! cancel. A proposal runs only when the person approves it at the terminal,
//! after its preview: the command, the proposer, the query, and the counts
//! by account, mailbox and class, with a line of its own for mail from
//! senders the person knows. The person or its proposer may dismiss it.
//! Results hold ids, counts and the engine's words, and text from mail only
//! in parts labelled as content.

use std::sync::Arc;

use afd::{
    ApprovalPolicy, CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult,
    JsonSchemaType, failure, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::changes::{beyond_policy, carry_out, proposal_room, proposed};
use crate::commands::{command_line_only, store_failure};
use crate::engine::Engine;
use crate::operate::operation_json;
use crate::read::{integer, limit, parameter, read_exposure, required};
use crate::screening::{not_ready, person_at_terminal, proposer_of};
use crate::store::{
    Action, Kind, NewItem, NewOperation, OperationItem, OperationRow, OperationState, PlacesIn,
    Proposer, Role, Step, Store, StoreError, TokenRow,
};

/// The name of the command that undoes an operation.
pub const UNDO: &str = "mail-operation-undo";

/// The name of the command that resumes one.
pub const RESUME: &str = "mail-operation-resume";

/// The name of the command that approves a proposal.
pub const APPROVE: &str = "mail-operation-approve";

fn not_found(id: i64) -> CommandError {
    CommandError::new("OPERATION_NOT_FOUND", format!("there is no operation {id}"))
        .with_suggestion("Run `loam-mail mail-operation-list` to see the operations.")
}

/// A list's cursor: an id, or for the proposals, when the last was proposed
/// and its id.
fn parse_list_cursor(text: &str, proposed: bool) -> Option<(i64, i64)> {
    if proposed {
        let (at, id) = text.split_once(':')?;
        Some((at.parse().ok()?, id.parse().ok()?))
    } else {
        Some((0, text.parse().ok()?))
    }
}

fn bad_cursor() -> CommandError {
    CommandError::new("INVALID_INPUT", "`cursor` is not one this command gave").with_suggestion(
        "Pass the `nextCursor` of the result before, with the same `proposed`, or none.",
    )
}

/// No proposal has the id named (12.3).
fn no_proposal(id: i64) -> CommandError {
    CommandError::new("PROPOSAL_NOT_OPEN", format!("there is no operation {id}")).with_suggestion(
        "Run `loam-mail mail-operation-list` with `proposed` to see the proposals waiting.",
    )
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
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        // An operation's id; for the proposals, when it was proposed and its
        // id, since a resume proposed keeps an older id.
        let cursor = match input.get("cursor") {
            None | Some(Value::Null) => None,
            Some(value) => match value.as_str() {
                Some(text) => Some(text.to_string()),
                None => return failure(bad_cursor()),
            },
        };
        let limit = match limit(&input, 20, 100) {
            Ok(limit) => limit,
            Err(error) => return failure(*error),
        };
        let only_proposed = match input.get("proposed") {
            None | Some(Value::Null) => false,
            Some(value) => match value.as_bool() {
                Some(proposed) => proposed,
                None => {
                    return failure(
                        CommandError::new("INVALID_INPUT", "`proposed` is true or false")
                            .with_suggestion("Pass true to list only the proposals waiting."),
                    );
                }
            },
        };
        let before = match &cursor {
            None => None,
            Some(text) => match parse_list_cursor(text, only_proposed) {
                Some(before) => Some(before),
                None => return failure(bad_cursor()),
            },
        };
        let now = context.clock().now();
        let listed = self.engine.with_store(|store| {
            store.expire_proposals(now)?;
            let rows = if only_proposed {
                store.proposals(before, limit + 1)?
            } else {
                store.operations(before.map(|(_, id)| id), limit + 1)?
            };
            let tokens = store.tokens()?;
            let mut listed = Vec::with_capacity(rows.len());
            for row in &rows {
                let counts = store.operation_counts(row.id)?;
                let cursor = match (&row.proposal, only_proposed) {
                    (Some(proposal), true) => format!("{}:{}", proposal.proposed_at, row.id),
                    _ => row.id.to_string(),
                };
                listed.push((cursor, operation_json(row, &counts, &tokens)));
            }
            Ok(listed)
        });
        let mut listed = match listed {
            Ok(listed) => listed,
            Err(error) => return failure(store_failure(&error)),
        };
        let next = (listed.len() > limit as usize).then(|| {
            listed.truncate(limit as usize);
            listed.last().map(|(cursor, _)| cursor.clone())
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
            parameter(
                "proposed",
                JsonSchemaType::Boolean,
                "true to list only the proposals that wait for the person, the most recently proposed first",
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
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
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
        let now = context.clock().now();
        let shown = self.engine.with_store(|store| {
            store.expire_proposals(now)?;
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
            let mut value = operation_json(&row, &counts, &tokens);
            if row.state == OperationState::Proposed {
                value["preview"] = preview_json(store, &row, now)?;
            }
            Ok(Ok((value, items)))
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
        "Show one change to mail: its state, its counts and the step each message reached; for a proposal, what the person reads before approving it",
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
            store.expire_proposals(now)?;
            let row = match named(store, id)? {
                Ok(row) => row,
                Err(error) => return Ok(Err(error)),
            };
            if row.state == OperationState::Running {
                return Ok(Err(busy(id)));
            }
            if let Some(error) = proposal_state(&row) {
                return Ok(Err(error));
            }
            if let Some(undo) = store.undo_proposed(id)? {
                return Ok(Err(undo_waits(id, undo)));
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
            // it was made. Over the policy, carrying it on is a proposal.
            if let Some(why) = beyond_policy(store, &creator, row.kind, counts.waiting, false, now)?
            {
                if let Some(error) = proposal_room(store, &creator, now)? {
                    return Ok(Err(error));
                }
                store.propose_resume(id, &creator, now)?;
                return Ok(Ok(Err(why)));
            }
            store.set_operation_state(id, OperationState::Running, None, now)?;
            Ok(Ok(Ok(counts.waiting)))
        });
        let waiting = match resumed {
            Ok(Ok(Ok(waiting))) => waiting,
            Ok(Ok(Err(why))) => return proposed(&self.engine, id, &why),
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
            store.expire_proposals(now)?;
            let row = match named(store, id)? {
                Ok(row) => row,
                Err(error) => return Ok(Err(error)),
            };
            if row.state == OperationState::Running {
                return Ok(Err(running(id)));
            }
            if let Some(error) = proposal_state(&row) {
                return Ok(Err(error));
            }
            if let Some(undo) = store.undo_proposed(id)? {
                return Ok(Err(undo_waits(id, undo)));
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
            // Over the policy, the undo is a proposal.
            let over = beyond_policy(store, &creator, kind, messages, true, now)?;
            if over.is_some()
                && let Some(error) = proposal_room(store, &creator, now)?
            {
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
                    proposed: over.is_some(),
                },
                now,
            )?;
            Ok(Ok((undo.id, messages, over)))
        });
        let (undo, messages, over) = match made {
            Ok(Ok(made)) => made,
            Ok(Err(error)) => return failure(error),
            Err(error) => return failure(store_failure(&error)),
        };
        if let Some(why) = over {
            return proposed(&self.engine, undo, &why);
        }
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

/// Why an operation in a proposal's state cannot be resumed or undone, or
/// `None` for one in any other.
fn proposal_state(row: &OperationRow) -> Option<CommandError> {
    let id = row.id;
    match row.state {
        OperationState::Proposed => Some(
            CommandError::new(
                "INVALID_INPUT",
                format!("operation {id} is a proposal that waits for the person's approval"),
            )
            .with_suggestion(
                "The person approves it with mail-operation-approve at the terminal; mail-operation-dismiss withdraws it.",
            ),
        ),
        OperationState::Dismissed | OperationState::Expired => Some(
            CommandError::new(
                "INVALID_INPUT",
                format!(
                    "operation {id} was a proposal that was {} and changed nothing",
                    row.state.as_str()
                ),
            )
            .with_suggestion("Make the change again, if it is still wanted."),
        ),
        OperationState::Running | OperationState::Stopped | OperationState::Done => None,
    }
}

/// An undo of operation `id` waits for the person.
fn undo_waits(id: i64, undo: i64) -> CommandError {
    CommandError::new(
        "INVALID_INPUT",
        format!("an undo of operation {id}, operation {undo}, waits for the person's approval"),
    )
    .with_suggestion(format!(
        "The person approves or dismisses operation {undo} first, with mail-operation-approve or mail-operation-dismiss."
    ))
}

/// The proposal named is not open.
fn not_open(row: &OperationRow) -> CommandError {
    let id = row.id;
    let words = match row.state {
        OperationState::Dismissed | OperationState::Expired => {
            format!(
                "operation {id} was a proposal, and was {}",
                row.state.as_str()
            )
        }
        state => format!(
            "operation {id} is not a proposal waiting for the person: it is {}",
            state.as_str()
        ),
    };
    CommandError::new("PROPOSAL_NOT_OPEN", words).with_suggestion(
        "Run `loam-mail mail-operation-list` with `proposed` to see the proposals waiting.",
    )
}

/// Whether proposal `row` can be approved now: it is open, the operation an
/// undo would undo is still as it was, and screening can be read for the
/// preview's classes.
fn approvable(
    store: &Store,
    row: &OperationRow,
    now: i64,
) -> Result<Option<CommandError>, StoreError> {
    let open = row.state == OperationState::Proposed
        && row
            .proposal
            .as_ref()
            .is_some_and(|proposal| proposal.expires_at > now);
    if !open {
        return Ok(Some(not_open(row)));
    }
    if let Some(original) = row.undo_of {
        let Some(original) = store.operation(original)? else {
            return Ok(Some(not_found(original)));
        };
        if original.state == OperationState::Running {
            return Ok(Some(running(original.id)));
        }
        if let Some(undo) = original.undone_by {
            return Ok(Some(
                CommandError::new(
                    "INVALID_INPUT",
                    format!(
                        "operation {} was undone already, by operation {undo}",
                        original.id
                    ),
                )
                .with_suggestion("Dismiss this proposal with mail-operation-dismiss."),
            ));
        }
    }
    let readiness = store.screening_readiness()?;
    if !readiness.ready() {
        return Ok(Some(not_ready(readiness)));
    }
    Ok(None)
}

/// A mailbox and its places, as a preview gives it; its name is the
/// provider's text, labelled as content (12.1).
fn places_json(places: &PlacesIn) -> Value {
    json!({
        "mailbox": places.mailbox,
        "account": places.account,
        "provider": places.provider,
        "role": places.role.as_str(),
        "name": { "trust": "content", "text": places.name },
        "places": places.places,
    })
}

/// What the person reads before approving proposal `row` (9.4): where its
/// messages are and go, by account and by mailbox, their classes, and how
/// many come from senders the person knows. The query, which the proposer
/// wrote and mail may have steered, is in the operation's own `query`.
fn preview_json(store: &Store, row: &OperationRow, now: i64) -> Result<Value, StoreError> {
    let preview = store.proposal_preview(row.id)?;
    let refused = approvable(store, row, now)?;
    let mut accounts: Vec<(i64, String, u64)> = Vec::new();
    for places in &preview.mailboxes {
        match accounts
            .iter_mut()
            .find(|(account, _, _)| *account == places.account)
        {
            Some((_, _, n)) => *n += places.places,
            None => accounts.push((places.account, places.provider.clone(), places.places)),
        }
    }
    let classes: serde_json::Map<String, Value> = preview
        .classes
        .iter()
        .map(|(class, n)| (class.clone(), json!(n)))
        .collect();
    Ok(json!({
        "approvable": refused.is_none(),
        // Why it cannot be approved now, in the engine's words.
        "refused": refused.map(|error| json!({ "code": error.code, "message": error.message })),
        "byAccount": accounts
            .iter()
            .map(|(account, provider, places)| {
                json!({ "account": account, "provider": provider, "places": places })
            })
            .collect::<Vec<_>>(),
        "byMailbox": preview.mailboxes.iter().map(places_json).collect::<Vec<_>>(),
        "destinations": preview.destinations.iter().map(places_json).collect::<Vec<_>>(),
        // Messages, each once, by screening class; `own` is the person's own
        // mail, which has none.
        "byClass": classes,
        "knownSenders": {
            "messages": preview.known_messages,
            "senders": preview.known_senders,
        },
        "unreturned": preview.unreturned,
    }))
}

/// Who proposed something, in the engine's words for a summary: a token's
/// name is the person's own, typed at the terminal (3.5).
fn proposer_words(proposer: &Proposer, tokens: &[TokenRow]) -> String {
    match (proposer.kind.as_str(), proposer.id.as_deref()) {
        ("agent", Some(id)) => match tokens.iter().find(|token| token.id == id) {
            Some(token) => format!("the agent with the token \"{}\" ({id})", token.name),
            None => format!("the agent with the token {id}"),
        },
        ("agent", None) => "the agent on standard input".to_string(),
        ("script", _) => "a script at the command line".to_string(),
        (kind, _) => format!("a caller of kind {kind}"),
    }
}

/// What proposal `row` does, in counts: what the person approves.
fn proposal_words(row: &OperationRow, waiting: u64) -> String {
    let id = row.id;
    if row.started_at.is_some() {
        return format!(
            "carry on operation {id}, {}: {waiting} places left",
            row.command
        );
    }
    let n = row.messages;
    let asked: Value = serde_json::from_str(&row.asked).unwrap_or(Value::Null);
    match row.command.as_str() {
        "mail-archive" => format!("archive {n} messages"),
        "mail-trash" => format!("move {n} messages to the trash"),
        "mail-label" => {
            let verb = if asked["copy"] == Value::Bool(true) {
                "copy"
            } else {
                "move"
            };
            format!("{verb} {n} messages to mailbox {}", asked["mailbox"])
        }
        "mail-mark" => {
            let mut how = Vec::new();
            match asked.get("read").and_then(Value::as_bool) {
                Some(true) => how.push("read"),
                Some(false) => how.push("unread"),
                None => {}
            }
            match asked.get("flagged").and_then(Value::as_bool) {
                Some(true) => how.push("flagged"),
                Some(false) => how.push("not flagged"),
                None => {}
            }
            format!("mark {n} messages {}", how.join(" and "))
        }
        UNDO => format!(
            "undo operation {}: put back {n} places it changed",
            row.undo_of.unwrap_or_default()
        ),
        other => format!("{other} on {n} messages"),
    }
}

/// What the person is asked to approve for `mail-operation-approve`: what
/// the proposal does and who proposed it, in counts and the engine's words
/// alone; the detail is in the preview (3.5). One that cannot be approved
/// now says so: the command refuses it even if approved.
#[must_use]
pub fn approval_summary(engine: &Engine, input: &Value, now: i64) -> Option<String> {
    let id = integer(input, "operation").ok()??;
    engine
        .with_store(|store| {
            store.expire_proposals(now)?;
            let Some(row) = store.operation(id)? else {
                return Ok(Some(format!(
                    "Approve operation {id}, which is not there: nothing will change"
                )));
            };
            if let Some(why) = approvable(store, &row, now)? {
                return Ok(Some(format!(
                    "Approve operation {id}, which cannot be approved now ({}): nothing will change",
                    why.code
                )));
            }
            let counts = store.operation_counts(id)?;
            let tokens = store.tokens()?;
            let by = row.proposal.as_ref().map_or_else(
                || "an unknown caller".to_string(),
                |proposal| proposer_words(&proposal.proposer, &tokens),
            );
            Ok(Some(format!(
                "Approve operation {id}: {}, proposed by {by}",
                proposal_words(&row, counts.waiting)
            )))
        })
        .ok()?
}

struct Approve {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Approve {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let id = match required(&input, "operation") {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        if self.engine.operation_busy(id) {
            return failure(busy(id));
        }
        let now = context.clock().now();
        let approved = self.engine.with_store(|store| {
            store.expire_proposals(now)?;
            let Some(row) = store.operation(id)? else {
                return Ok(Err(no_proposal(id)));
            };
            if let Some(error) = approvable(store, &row, now)? {
                return Ok(Err(error));
            }
            // From here it runs as the person's: no limit applies, and it
            // counts against no caller's day.
            if !store.approve_proposal(id, now)? {
                return Ok(Err(not_open(&row)));
            }
            Ok(Ok(store.operation_counts(id)?.waiting))
        });
        let waiting = match approved {
            Ok(Ok(waiting)) => waiting,
            Ok(Err(error)) => return failure(error),
            Err(error) => return failure(store_failure(&error)),
        };
        carry_out(&self.engine, id, waiting, &context).await
    }
}

/// `mail-operation-approve`: runs a proposal as the person's (M28). A
/// person's command, held for their approval; the command line shows the
/// preview, `mail-operation-show` with the operation, before it asks. The
/// approval is bound to the operation's id, and its set is frozen, so what
/// runs is what was shown.
#[must_use]
pub fn approve(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        APPROVE,
        "Approve a change to mail an agent or a script proposed, and run it",
        vec![parameter(
            "operation",
            JsonSchemaType::Integer,
            "The proposal's operation id",
            true,
        )],
        Approve { engine },
    )
    .as_mutation()
    .with_confirm_prompt("Approve the proposal and make the change it names")
    // Every call is held; what cannot be approved is refused after it. The
    // command line reads the preview first and asks nothing of a proposal
    // that cannot be approved.
    .with_approval(ApprovalPolicy::Required)
    .with_expose(command_line_only())
}

struct Dismiss {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Dismiss {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let id = match required(&input, "operation") {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        // The person dismisses any at the command line; a caller its own.
        let person = person_at_terminal(&context);
        let caller = proposer_of(&context);
        let now = context.clock().now();
        let dismissed = self.engine.with_store(|store| {
            store.expire_proposals(now)?;
            let Some(row) = store.operation(id)? else {
                return Ok(Err(no_proposal(id)));
            };
            if row.state != OperationState::Proposed {
                return Ok(Err(not_open(&row)));
            }
            let theirs = row
                .proposal
                .as_ref()
                .is_some_and(|proposal| proposal.proposer == caller);
            if !person && !theirs {
                return Ok(Err(CommandError::new(
                    "FORBIDDEN",
                    "only the person, or the caller that proposed it, may dismiss a proposal",
                )
                .with_suggestion("Dismiss only your own proposals.")));
            }
            if store.dismiss_proposal(id, now)?.is_none() {
                return Ok(Err(not_open(&row)));
            }
            let row = store.operation(id)?.unwrap_or(row);
            let counts = store.operation_counts(id)?;
            let tokens = store.tokens()?;
            Ok(Ok(operation_json(&row, &counts, &tokens)))
        });
        match dismissed {
            Ok(Ok(value)) => success(value),
            Ok(Err(error)) => failure(error),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-operation-dismiss`: discards a proposal: the person's, or its
/// proposer's own. A change that never ran is dropped with its frozen set;
/// a stopped operation proposed to be carried on is stopped again.
#[must_use]
pub fn dismiss(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-operation-dismiss",
        "Dismiss a proposed change to mail: the person's, or its proposer's own",
        vec![parameter(
            "operation",
            JsonSchemaType::Integer,
            "The proposal's operation id",
            true,
        )],
        Dismiss { engine },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

/// Whether `input` names an operation, for the command line's question.
#[must_use]
pub fn operation_input(input: &Value) -> Option<i64> {
    integer(input, "operation").ok().flatten()
}
