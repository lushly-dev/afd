//! The commands that change mail at the provider (the specification's 9.1,
//! 9.2 and 9.4): `mail-archive`, `mail-label`, `mail-mark` and `mail-trash`.
//!
//! Each takes a selection with its exact count, or at most 200 message ids,
//! and makes an operation of it ([`crate::operate`]). An agent's or a
//! script's change within the person's policy runs; one over it changes
//! nothing at the provider and is made a proposal (M28), which waits for the
//! person's approval ([`crate::operations`]). The person's own change has no
//! limit: one larger than a call can finish runs as the server's work when a
//! server runs, and to its end at the terminal otherwise.
//!
//! - **Archive** takes mail out of the inbox: each copy the inbox shows moves
//!   to the account's archive mailbox, as Gmail's archive removes the inbox
//!   label. Copies elsewhere are left, and reported as unchanged.
//! - **Trash** moves each copy to the account's trash; one there already is
//!   unchanged. Mail is never deleted for good: the provider empties its
//!   trash.
//! - **Label** moves or copies each copy to a mailbox of the same account.
//! - A move leaves the copies in the person's sent mailbox, and in Gmail's
//!   All Mail, unless the selection named that mailbox.
//! - **Mark** sets or clears the read and flagged flags.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandParameter,
    CommandResult, JsonSchema, JsonSchemaType, failure, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::commands::store_failure;
use crate::engine::Engine;
use crate::operate::{Ran, Until, operation_now, run};
use crate::read::{integer, parameter, read_exposure};
use crate::screening::proposer_of;
use crate::store::{
    AccountId, Action, Kind, MOST_PROPOSALS, MailboxRow, NewItem, NewOperation, Proposer, Role,
    SelectionItem, Step, Store, StoreError,
};

/// The most message ids a change takes; more go through a selection (9.1).
pub const MOST_IDS: usize = 200;

/// A day, in milliseconds: the trash limit's window (9.4).
const DAY: i64 = 24 * 60 * 60 * 1000;

/// The four commands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Which {
    Archive,
    Label,
    Mark,
    Trash,
}

impl Which {
    fn name(self) -> &'static str {
        match self {
            Self::Archive => "mail-archive",
            Self::Label => "mail-label",
            Self::Mark => "mail-mark",
            Self::Trash => "mail-trash",
        }
    }
}

fn invalid(message: impl Into<String>, suggestion: &str) -> Box<CommandError> {
    Box::new(CommandError::new("INVALID_INPUT", message).with_suggestion(suggestion))
}

/// What a change acts on, as its input names it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Set {
    /// A selection, and the count the caller states for it.
    Selection { id: i64, expected: i64 },
    /// Message ids.
    Messages(Vec<i64>),
}

impl Set {
    fn asked(&self) -> Value {
        match self {
            Self::Selection { id, expected } => {
                json!({ "selection": id, "expectedCount": expected })
            }
            Self::Messages(ids) => json!({ "messages": ids }),
        }
    }
}

fn set_input(input: &Value) -> Result<Set, Box<CommandError>> {
    let selection = integer(input, "selection")?;
    let expected = integer(input, "expectedCount")?;
    let messages = match input.get("messages") {
        None | Some(Value::Null) => None,
        Some(Value::Array(items)) => {
            let mut ids = Vec::with_capacity(items.len());
            for item in items {
                ids.push(item.as_i64().ok_or_else(|| {
                    invalid(
                        "`messages` holds message ids",
                        "Pass the ids a list gave, as whole numbers.",
                    )
                })?);
            }
            Some(ids)
        }
        Some(_) => {
            return Err(invalid(
                "`messages` is a list of message ids",
                "Pass the ids a list gave, as a list of whole numbers.",
            ));
        }
    };
    match (selection, messages) {
        (Some(id), None) => {
            let expected = expected.ok_or_else(|| {
                invalid(
                    "a change to a selection states its count as `expectedCount`",
                    "Pass the `count` mail-selection-create gave as `expectedCount`.",
                )
            })?;
            Ok(Set::Selection { id, expected })
        }
        (None, Some(mut ids)) => {
            ids.sort_unstable();
            ids.dedup();
            if ids.is_empty() || ids.len() > MOST_IDS {
                return Err(invalid(
                    "`messages` holds 1 to 200 message ids",
                    "Make a selection with mail-selection-create for more.",
                ));
            }
            if expected.is_some() {
                return Err(invalid(
                    "`expectedCount` goes with a selection",
                    "Leave it out with `messages`.",
                ));
            }
            Ok(Set::Messages(ids))
        }
        _ => Err(invalid(
            "a change names a selection or messages, not both or neither",
            "Pass `selection` and `expectedCount`, or `messages`.",
        )),
    }
}

/// The items a change acts on, the count it was made with, and the query of
/// the selection they came from.
type Resolved = (Vec<SelectionItem>, u64, Option<String>);

/// What a change does to each item, the limit it counts against, and the
/// items.
type Planned = (Action, Kind, Vec<NewItem>);

/// The items `set` names and the count it states, or why it names none.
fn resolve(
    store: &Store,
    set: &Set,
    now: i64,
) -> Result<Result<Resolved, CommandError>, StoreError> {
    match set {
        Set::Selection { id, expected } => {
            let Some(row) = store.selection(*id)?.filter(|row| row.expires_at > now) else {
                return Ok(Err(CommandError::new(
                    "SELECTION_MISMATCH",
                    "the selection has expired, or there is none with that id",
                )
                .with_suggestion(
                    "Make it again with mail-selection-create; a selection lasts an hour.",
                )));
            };
            if i64::try_from(row.count()).ok() != Some(*expected) {
                return Ok(Err(CommandError::new(
                    "SELECTION_MISMATCH",
                    format!(
                        "the selection holds {} messages, not the {expected} stated",
                        row.count()
                    ),
                )
                .with_suggestion(
                    "State the `count` mail-selection-create gave; nothing was changed.",
                )));
            }
            Ok(Ok((
                store.selection_items(*id)?,
                row.count(),
                Some(row.query),
            )))
        }
        Set::Messages(ids) => {
            let items = store.shown_items(ids)?;
            for id in ids {
                if !items.iter().any(|item| item.message == Some(*id)) {
                    return Ok(Err(CommandError::new(
                        "MESSAGE_NOT_FOUND",
                        format!("message {id} is in no mailbox outside junk and trash, or there is none with that id"),
                    )
                    .with_suggestion(
                        "Use ids a list gave; for mail in junk or trash, make a selection that names the mailbox.",
                    )));
                }
            }
            Ok(Ok((items, ids.len() as u64, None)))
        }
    }
}

/// Each mailbox by its id, with its account.
fn mailboxes(store: &Store) -> Result<Vec<(AccountId, MailboxRow)>, StoreError> {
    let mut all = Vec::new();
    for account in store.accounts()? {
        for mailbox in store.mailboxes(account.id)? {
            all.push((account.id, mailbox));
        }
    }
    Ok(all)
}

/// The account's mailbox of `role` that the provider still lists.
fn of_role(all: &[(AccountId, MailboxRow)], account: AccountId, role: Role) -> Option<&MailboxRow> {
    all.iter()
        .find(|(owner, mailbox)| *owner == account && mailbox.role == role && !mailbox.gone)
        .map(|(_, mailbox)| mailbox)
}

/// What the command does with each item, from its input.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Asked {
    Archive,
    Trash,
    Label {
        mailbox: i64,
        copy: bool,
    },
    Mark {
        flags: serde_json::Map<String, Value>,
    },
}

fn asked_input(which: Which, input: &Value) -> Result<Asked, Box<CommandError>> {
    match which {
        Which::Archive => Ok(Asked::Archive),
        Which::Trash => Ok(Asked::Trash),
        Which::Label => {
            let mailbox = integer(input, "mailbox")?.ok_or_else(|| {
                invalid(
                    "`mailbox` is required",
                    "Pass the id of the mailbox to move or copy to; mail-status lists them.",
                )
            })?;
            let copy = match input.get("copy") {
                None | Some(Value::Null) => false,
                Some(value) => value.as_bool().ok_or_else(|| {
                    invalid(
                        "`copy` is true or false",
                        "Pass true to copy, false to move.",
                    )
                })?,
            };
            Ok(Asked::Label { mailbox, copy })
        }
        Which::Mark => {
            let mut flags = serde_json::Map::new();
            for (field, flag) in [("read", "\\Seen"), ("flagged", "\\Flagged")] {
                match input.get(field) {
                    None | Some(Value::Null) => {}
                    Some(value) => {
                        let on = value.as_bool().ok_or_else(|| {
                            invalid(
                                format!("`{field}` is true or false"),
                                "Pass true to set it, false to clear it.",
                            )
                        })?;
                        flags.insert(flag.to_string(), json!(on));
                    }
                }
            }
            if flags.is_empty() {
                return Err(invalid(
                    "a mark names `read`, `flagged` or both",
                    "Pass `read` or `flagged`, true or false.",
                ));
            }
            Ok(Asked::Mark { flags })
        }
    }
}

/// The operation `asked` makes of `items`: what it does, the limit it
/// counts against, and each item's place and target.
fn plan(
    all: &[(AccountId, MailboxRow)],
    asked: &Asked,
    items: Vec<SelectionItem>,
    named: Option<i64>,
) -> Result<Planned, Box<CommandError>> {
    // A move leaves the person's sent mail, and Gmail's All Mail, where it
    // is unless the selection named that mailbox: a change meant for mail
    // received does not take the person's own copies with it.
    let kept_out =
        |row: &MailboxRow| matches!(row.role, Role::Sent | Role::All) && named != Some(row.id.0);
    let account_of = |mailbox: i64| {
        all.iter()
            .find(|(_, row)| row.id.0 == mailbox)
            .map(|(account, row)| (*account, row))
    };
    let item =
        |place: &SelectionItem, to: Option<i64>, step: Step, flags: Option<String>| NewItem {
            mailbox: place.mailbox,
            validity: place.validity.clone(),
            provider_id: place.provider_id.clone(),
            message: place.message,
            to_mailbox: to,
            to_validity: None,
            to_provider_id: None,
            flags_wanted: flags,
            step,
        };
    let mut planned = Vec::with_capacity(items.len());
    match asked {
        Asked::Archive | Asked::Trash => {
            let (from, to_role) = if *asked == Asked::Archive {
                (Some(Role::Inbox), Role::Archive)
            } else {
                (None, Role::Trash)
            };
            for place in &items {
                let Some((account, row)) = account_of(place.mailbox) else {
                    planned.push(item(place, None, Step::Missing, None));
                    continue;
                };
                let moves = match from {
                    Some(role) => row.role == role,
                    None => row.role != to_role && !kept_out(row),
                };
                if !moves {
                    planned.push(item(place, None, Step::Unchanged, None));
                    continue;
                }
                let Some(target) = of_role(all, account, to_role) else {
                    return Err(Box::new(CommandError::new(
                        "MAILBOX_NOT_FOUND",
                        format!(
                            "account {} has no {} mailbox to move mail to",
                            account.0,
                            to_role.as_str()
                        ),
                    )
                    .with_suggestion(
                        "Run `loam-mail mail-sync` so the engine lists the account's mailboxes, or use mail-label with a mailbox of your choosing.",
                    )));
                };
                planned.push(item(place, Some(target.id.0), Step::Waiting, None));
            }
            let kind = if *asked == Asked::Trash {
                Kind::Trash
            } else {
                Kind::Change
            };
            Ok((Action::Move, kind, planned))
        }
        Asked::Label { mailbox, copy } => {
            let Some((account, target)) = account_of(*mailbox).filter(|(_, row)| !row.gone) else {
                return Err(Box::new(
                    CommandError::new(
                        "MAILBOX_NOT_FOUND",
                        "no mailbox the provider still lists has that id",
                    )
                    .with_suggestion("Run `loam-mail mail-status` to see the mailboxes' ids."),
                ));
            };
            if target.role == Role::Sent {
                return Err(invalid(
                    "mail cannot be filed into the sent mailbox",
                    "The engine treats mail in the sent mailbox as mail you sent; choose another mailbox.",
                ));
            }
            for place in &items {
                match account_of(place.mailbox) {
                    Some((owner, _)) if owner != account => {
                        return Err(invalid(
                            "the mail named is in another account than the mailbox",
                            "Name a mailbox of the account the mail is in, or select one account's mail.",
                        ));
                    }
                    _ => {}
                }
                let left = !copy && account_of(place.mailbox).is_some_and(|(_, row)| kept_out(row));
                let step = if place.mailbox == *mailbox || left {
                    Step::Unchanged
                } else {
                    Step::Waiting
                };
                planned.push(item(place, Some(target.id.0), step, None));
            }
            let action = if *copy { Action::Copy } else { Action::Move };
            // A move into the trash is trash, by whichever command, and so is
            // one into junk, which the provider may empty too.
            let kind = if !copy && matches!(target.role, Role::Trash | Role::Junk) {
                Kind::Trash
            } else {
                Kind::Change
            };
            Ok((action, kind, planned))
        }
        Asked::Mark { flags } => {
            let wanted = Value::Object(flags.clone()).to_string();
            for place in &items {
                planned.push(item(place, None, Step::Waiting, Some(wanted.clone())));
            }
            Ok((Action::Flags, Kind::Change, planned))
        }
    }
}

/// Refusal when an agent or a script tries to change, resume, or undo mail
/// across more than one account in a single call (plugin.spec.md section 10, M36).
pub(crate) fn spans_accounts() -> CommandError {
    CommandError::new(
        "SELECTION_SPANS_ACCOUNTS",
        "an agent or a script cannot change mail in more than one account in one call",
    )
    .with_suggestion("Make one selection per account.")
    .with_retryable(false)
}

/// Distinct accounts represented by `mailbox_ids`, mapped through `all`.
pub(crate) fn accounts_for_mailboxes(
    all: &[(AccountId, MailboxRow)],
    mailbox_ids: impl IntoIterator<Item = i64>,
) -> Vec<AccountId> {
    let mut accounts: Vec<AccountId> = mailbox_ids
        .into_iter()
        .filter_map(|id| {
            all.iter()
                .find(|(_, row)| row.id.0 == id)
                .map(|(account, _)| *account)
        })
        .collect();
    accounts.sort_by_key(|account| account.0);
    accounts.dedup();
    accounts
}

/// Why an agent's or a script's change of `messages` messages, of `kind`,
/// is beyond the person's policy, in the engine's words, or `None`.
/// `charged` counts it against the caller's day, for a change it makes now.
pub(crate) fn beyond_policy(
    store: &Store,
    creator: &Proposer,
    account: Option<AccountId>,
    kind: Kind,
    messages: u64,
    charged: bool,
    now: i64,
) -> Result<Option<String>, StoreError> {
    if creator.kind == "human" {
        return Ok(None);
    }
    let (policy, _) = store.effective_policy(account)?;
    let per_call = match kind {
        Kind::Change => policy.change_per_call,
        Kind::Trash => policy.trash_per_call,
    };
    if messages > u64::from(per_call) {
        let what = match kind {
            Kind::Change => "archive, label or mark",
            Kind::Trash => "move to the trash or junk",
        };
        return Ok(Some(format!(
            "this change is {messages} messages, more than the {per_call} an agent or a script may {what} in a call"
        )));
    }
    if kind == Kind::Trash && charged {
        let trashed = match account {
            Some(acc) => store.trashed_since_in_account(creator, acc, now - DAY)?,
            None => store.trashed_since(creator, now - DAY)?,
        };
        if trashed + messages > u64::from(policy.trash_per_day) {
            return Ok(Some(format!(
                "this caller has moved {trashed} messages to the trash in the last day, and {messages} more is over the {} a day it may",
                policy.trash_per_day
            )));
        }
    }
    Ok(None)
}

/// Whether `proposer` may make another proposal: `None`, or the failure
/// when it has as many waiting as it may (9.4), so that mail that steers an
/// agent cannot bury the person in requests. Proposals past their time are
/// ended first.
pub(crate) fn proposal_room(
    store: &mut Store,
    proposer: &Proposer,
    now: i64,
) -> Result<Option<CommandError>, StoreError> {
    store.expire_proposals(now)?;
    let waiting = store.proposals_waiting(proposer)?;
    if waiting < u64::from(MOST_PROPOSALS) {
        return Ok(None);
    }
    Ok(Some(
        CommandError::new(
            "POLICY_LIMIT",
            format!(
                "this caller has {waiting} proposals waiting for the person already, the most it may"
            ),
        )
        .with_suggestion(
            "Nothing was changed or proposed. Wait for the person to approve or dismiss one, or dismiss your own with mail-operation-dismiss.",
        ),
    ))
}

/// The result of a proposal: the operation, waiting in the state
/// `proposed`, and why it waits, in the engine's words.
pub(crate) fn proposed(engine: &Engine, id: i64, why: &str) -> CommandResult<Value> {
    match operation_now(engine, id) {
        Ok(mut value) => {
            value["proposal"]["why"] = json!(why);
            value["proposal"]["next"] = json!(
                "Nothing was changed. The person approves it at the terminal with mail-operation-approve, or dismisses it; mail-operation-dismiss withdraws it."
            );
            success(value)
        }
        Err(error) => failure(*error),
    }
}

/// Runs operation `id`, made with `messages` messages, for the call
/// `context`: inside the call when it can finish there, and otherwise as
/// the server's work. Its row and counts are the result.
pub(crate) async fn carry_out(
    engine: &Arc<Engine>,
    id: i64,
    messages: u64,
    context: &CommandContext,
) -> CommandResult<Value> {
    let work = engine.work();
    let serving = work.serving();
    if serving && messages > engine.change_options().inline_most {
        work.ask_operation(id);
        return result(engine, id);
    }
    let person = proposer_of(context).kind == "human";
    let interrupt =
        (!serving && person && engine.interrupts()).then(|| Arc::new(AtomicBool::new(false)));
    let listener = interrupt.as_ref().map(|flag| {
        let flag = Arc::clone(flag);
        let stopped = crate::cli::stopped();
        tokio::spawn(async move {
            stopped.await;
            flag.store(true, Ordering::SeqCst);
        })
    });
    // On a server, a call must return within its time: what is left goes
    // on as the server's work, with time to spare for the reply.
    let deadline = serving
        .then_some(context.timeout_ms)
        .flatten()
        .and_then(|ms| Instant::now().checked_add(Duration::from_millis(ms.saturating_mul(3) / 4)));
    let until = Until {
        deadline,
        batches: None,
        interrupt,
    };
    let ran = run(engine, id, context.clock(), &until).await;
    if let Some(listener) = listener {
        listener.abort();
    }
    match ran {
        // The run asked the server's work to carry it on.
        Ok(Ran::GaveBack) => result(engine, id),
        Ok(Ran::Ended) => result(engine, id),
        Err(error) => failure(*error),
    }
}

fn result(engine: &Engine, id: i64) -> CommandResult<Value> {
    match operation_now(engine, id) {
        Ok(value) => success(value),
        Err(error) => failure(*error),
    }
}

struct Change {
    engine: Arc<Engine>,
    which: Which,
}

#[async_trait]
impl CommandHandler for Change {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let set = match set_input(&input) {
            Ok(set) => set,
            Err(error) => return failure(*error),
        };
        let asked = match asked_input(self.which, &input) {
            Ok(asked) => asked,
            Err(error) => return failure(*error),
        };
        let mut asked_json = set.asked();
        match &asked {
            Asked::Label { mailbox, copy } => {
                asked_json["mailbox"] = json!(mailbox);
                asked_json["copy"] = json!(copy);
            }
            Asked::Mark { flags } => {
                for (flag, field) in [("\\Seen", "read"), ("\\Flagged", "flagged")] {
                    if let Some(on) = flags.get(flag) {
                        asked_json[field] = on.clone();
                    }
                }
            }
            Asked::Archive | Asked::Trash => {}
        }
        let creator = proposer_of(&context);
        let now = context.clock().now();
        let which = self.which;
        let made = self.engine.with_store(|store| {
            let (items, messages, query) = match resolve(store, &set, now)? {
                Ok(resolved) => resolved,
                Err(error) => return Ok(Err(error)),
            };
            let all = mailboxes(store)?;
            // M36: an agent or a script never changes mail across more than one
            // account in one call, whether or not any account is guarded.
            let accounts = accounts_for_mailboxes(&all, items.iter().map(|item| item.mailbox));
            if creator.kind != "human" && accounts.len() > 1 {
                return Ok(Err(spans_accounts()));
            }
            let single_account = (accounts.len() == 1).then(|| accounts[0]);
            // The mailbox the selection named, if it named one.
            let named = query
                .as_deref()
                .and_then(|query| serde_json::from_str::<Value>(query).ok())
                .and_then(|query| query.get("mailbox").and_then(Value::as_i64));
            let (action, kind, items) = match plan(&all, &asked, items, named) {
                Ok(planned) => planned,
                Err(error) => return Ok(Err(*error)),
            };
            // Over the policy, it is a proposal: nothing is asked of the
            // provider until the person approves it (M28).
            let over = beyond_policy(store, &creator, single_account, kind, messages, true, now)?;
            if over.is_some()
                && let Some(error) = proposal_room(store, &creator, now)?
            {
                return Ok(Err(error));
            }
            let row = store.create_operation(
                &NewOperation {
                    command: which.name().to_string(),
                    action,
                    kind,
                    asked: asked_json.to_string(),
                    undo_of: None,
                    selection: match set {
                        Set::Selection { id, .. } => Some(id),
                        Set::Messages(_) => None,
                    },
                    query,
                    creator: creator.clone(),
                    messages,
                    items,
                    proposed: over.is_some(),
                },
                now,
            )?;
            Ok(Ok((row.id, messages, over)))
        });
        let (id, messages, over) = match made {
            Ok(Ok(made)) => made,
            Ok(Err(error)) => return failure(error),
            Err(error) => return failure(store_failure(&error)),
        };
        if let Some(why) = over {
            return proposed(&self.engine, id, &why);
        }
        carry_out(&self.engine, id, messages, &context).await
    }
}

fn set_parameters() -> Vec<CommandParameter> {
    vec![
        parameter(
            "selection",
            JsonSchemaType::Integer,
            "A selection's id, from mail-selection-create",
            false,
        ),
        parameter(
            "expectedCount",
            JsonSchemaType::Integer,
            "The selection's `count`, exactly: otherwise nothing changes",
            false,
        ),
        CommandParameter {
            schema: Some(JsonSchema {
                schema_type: Some(JsonSchemaType::Array),
                items: Some(Box::new(JsonSchema {
                    schema_type: Some(JsonSchemaType::Integer),
                    ..JsonSchema::default()
                })),
                ..JsonSchema::default()
            }),
            ..parameter(
                "messages",
                JsonSchemaType::Array,
                "Up to 200 message ids, in place of a selection",
                false,
            )
        },
    ]
}

fn definition(
    engine: Arc<Engine>,
    which: Which,
    description: &str,
    extra: Vec<CommandParameter>,
) -> CommandDefinition {
    let mut parameters = set_parameters();
    parameters.extend(extra);
    CommandDefinition::new(
        which.name(),
        description,
        parameters,
        Change { engine, which },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

/// `mail-archive`: takes mail out of the inbox, into the account's archive.
#[must_use]
pub fn archive(engine: Arc<Engine>) -> CommandDefinition {
    definition(
        engine,
        Which::Archive,
        "Archive mail: move what the inbox shows to the account's archive mailbox; undoable",
        Vec::new(),
    )
}

/// `mail-trash`: moves mail to the account's trash.
#[must_use]
pub fn trash(engine: Arc<Engine>) -> CommandDefinition {
    definition(
        engine,
        Which::Trash,
        "Move mail to the account's trash; undoable while the provider keeps it",
        Vec::new(),
    )
}

/// `mail-label`: moves or copies mail to a mailbox.
#[must_use]
pub fn label(engine: Arc<Engine>) -> CommandDefinition {
    definition(
        engine,
        Which::Label,
        "Move or copy mail to a mailbox of its account; undoable",
        vec![
            parameter(
                "mailbox",
                JsonSchemaType::Integer,
                "The mailbox to move or copy to, by id",
                true,
            ),
            parameter(
                "copy",
                JsonSchemaType::Boolean,
                "true to copy and leave the mail where it is; false, the default, to move it",
                false,
            ),
        ],
    )
}

/// `mail-mark`: sets or clears the read and flagged flags.
#[must_use]
pub fn mark(engine: Arc<Engine>) -> CommandDefinition {
    definition(
        engine,
        Which::Mark,
        "Mark mail read or unread, flagged or not; undoable",
        vec![
            parameter(
                "read",
                JsonSchemaType::Boolean,
                "true to mark read, false to mark unread",
                false,
            ),
            parameter(
                "flagged",
                JsonSchemaType::Boolean,
                "true to flag, false to clear the flag",
                false,
            ),
        ],
    )
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn a_change_names_a_selection_with_its_count_or_a_few_ids() {
        assert_eq!(
            set_input(&json!({ "selection": 4, "expectedCount": 12 })).unwrap(),
            Set::Selection {
                id: 4,
                expected: 12
            }
        );
        assert_eq!(
            set_input(&json!({ "messages": [3, 1, 3] })).unwrap(),
            Set::Messages(vec![1, 3])
        );
        for refused in [
            json!({}),
            json!({ "selection": 4 }),
            json!({ "selection": 4, "expectedCount": 1, "messages": [1] }),
            json!({ "messages": [] }),
            json!({ "messages": (0..201).collect::<Vec<i64>>() }),
            json!({ "messages": [1], "expectedCount": 1 }),
            json!({ "messages": ["1"] }),
        ] {
            assert_eq!(
                set_input(&refused).unwrap_err().code,
                "INVALID_INPUT",
                "{refused}"
            );
        }
    }

    #[test]
    fn a_mark_names_a_flag() {
        assert!(asked_input(Which::Mark, &json!({})).is_err());
        let Asked::Mark { flags } = asked_input(Which::Mark, &json!({ "read": true })).unwrap()
        else {
            panic!("a mark");
        };
        assert_eq!(Value::Object(flags), json!({ "\\Seen": true }));
    }
}
