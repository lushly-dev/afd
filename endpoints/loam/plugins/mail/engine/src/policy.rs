//! The person's policy (the specification's 9.4): `mail-policy-show` reads
//! it, and `mail-policy-set`, a person's command held for their approval,
//! changes it. The engine applies it to every caller itself, because Loam's
//! autonomy policy reaches only Loam's copilot: the change commands read it
//! ([`crate::changes`]).

use std::sync::Arc;

use afd::{
    ApprovalDecision, ApprovalPolicy, CommandContext, CommandDefinition, CommandError,
    CommandHandler, CommandResult, JsonSchemaType, failure, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::commands::{command_line_only, store_failure};
use crate::engine::Engine;
use crate::read::{integer, parameter, read_exposure};
use crate::store::{
    AccountId, AccountPolicyOverrides, AccountPolicyRow, MOST_PER_DAY, MOST_PROPOSALS,
    MOST_SELECTIONS, PROPOSAL_LIFETIME, Policy, PolicyRow, SELECTION_LIFETIME, StoreError,
};

/// The name of the command that changes the policy.
pub const SET: &str = "mail-policy-set";

/// The inputs `mail-policy-set` takes, as the policy's fields.
const LIMITS: &[&str] = &["changePerCall", "trashPerCall", "trashPerDay", "askAbove"];

/// The policy against which no field the input leaves out makes another
/// one fail: each limit a call and the count to ask above at 0, and the
/// day's trash at its most. Input [`changed`] refuses from it, it refuses
/// from any policy.
const LENIENT: Policy = Policy {
    change_per_call: 0,
    trash_per_call: 0,
    trash_per_day: MOST_PER_DAY,
    ask_above: 0,
};

/// Builds the `mail-policy-show` target query for CLI `askAbove` checks.
#[must_use]
pub fn target_input(name: &str, input: &Value) -> Value {
    if matches!(name, crate::operations::RESUME | crate::operations::UNDO)
        && let Some(id) = crate::operations::operation_input(input)
    {
        return json!({ "operation": id });
    }
    if let Some(selection) = input.get("selection").and_then(Value::as_i64) {
        return json!({ "selection": selection });
    }
    if let Some(messages) = input.get("messages").filter(|v| v.is_array()) {
        return json!({ "messages": messages });
    }
    json!({})
}

/// A policy as a result gives it.
#[must_use]
pub fn policy_json(policy: &Policy) -> Value {
    json!({
        // What an agent or a script may change with nobody present.
        "changePerCall": policy.change_per_call,
        "trashPerCall": policy.trash_per_call,
        "trashPerDay": policy.trash_per_day,
        // Above this many, the command line asks the person before a change
        // of theirs.
        "askAbove": policy.ask_above,
    })
}

fn account_input(input: &Value) -> Result<Option<AccountId>, Box<CommandError>> {
    let Some(id) = integer(input, "account")? else {
        return Ok(None);
    };
    if id <= 0 {
        return Err(Box::new(
            CommandError::new("INVALID_INPUT", "`account` must be a positive account id")
                .with_suggestion("Run `loam-mail mail-account-list` to see the accounts."),
        ));
    }
    Ok(Some(AccountId(id)))
}

fn reset_input(input: &Value) -> Result<bool, Box<CommandError>> {
    match input.get("reset") {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(flag)) => Ok(*flag),
        Some(_) => Err(Box::new(
            CommandError::new("INVALID_INPUT", "`reset` is true or false")
                .with_suggestion("Pass `reset: true` with `account` to restore default limits."),
        )),
    }
}

fn account_not_found(account: AccountId) -> CommandError {
    CommandError::new(
        "ACCOUNT_NOT_FOUND",
        format!("there is no account {}", account.0),
    )
    .with_suggestion("Run `loam-mail mail-account-list` to see the accounts.")
}

/// Parses limit fields named in `input` into partial overrides.
fn parse_overrides(input: &Value) -> Result<(AccountPolicyOverrides, bool), Box<CommandError>> {
    let mut overrides = AccountPolicyOverrides::default();
    let mut named = false;
    for field in LIMITS {
        let Some(value) = integer(input, field)? else {
            continue;
        };
        named = true;
        let value = u32::try_from(value).map_err(|_| {
            Box::new(
                CommandError::new("INVALID_INPUT", format!("`{field}` is not a count"))
                    .with_suggestion("Give a whole number, 0 or more."),
            )
        })?;
        match *field {
            "changePerCall" => overrides.change_per_call = Some(value),
            "trashPerCall" => overrides.trash_per_call = Some(value),
            "trashPerDay" => overrides.trash_per_day = Some(value),
            _ => overrides.ask_above = Some(value),
        }
    }
    Ok((overrides, named))
}

/// The policy `input` would make of `current`, or why it cannot.
fn changed(current: &Policy, input: &Value) -> Result<Policy, Box<CommandError>> {
    let (overrides, named) = parse_overrides(input)?;
    if !named {
        return Err(Box::new(
            CommandError::new("INVALID_INPUT", "no limit of the policy is named")
                .with_suggestion(format!("Name one or more of: {}.", LIMITS.join(", "))),
        ));
    }
    let policy = Policy {
        change_per_call: overrides.change_per_call.unwrap_or(current.change_per_call),
        trash_per_call: overrides.trash_per_call.unwrap_or(current.trash_per_call),
        trash_per_day: overrides.trash_per_day.unwrap_or(current.trash_per_day),
        ask_above: overrides.ask_above.unwrap_or(current.ask_above),
    };
    if let Some(fault) = policy.fault() {
        return Err(Box::new(
            CommandError::new(
                "INVALID_INPUT",
                format!("the policy cannot be kept: {fault}"),
            )
            .with_suggestion("Run `loam-mail mail-policy-show` to see the limits."),
        ));
    }
    Ok(policy)
}

/// Validates input shape for `mail-policy-set` against `LENIENT` (used by the
/// approval predicate so invalid inputs fail without prompting).
fn validate_set_shape(input: &Value) -> Result<(), Box<CommandError>> {
    let account = account_input(input)?;
    let reset = reset_input(input)?;
    if reset {
        if account.is_none() {
            return Err(Box::new(
                CommandError::new("INVALID_INPUT", "`reset` requires `account`").with_suggestion(
                    "Pass `account` with `reset: true` to clear per-account overrides.",
                ),
            ));
        }
        let (_, named) = parse_overrides(input)?;
        if named {
            return Err(Box::new(
                CommandError::new(
                    "INVALID_INPUT",
                    "`reset` cannot be combined with limit fields",
                )
                .with_suggestion(
                    "Pass `reset: true` alone to restore default limits for the account.",
                ),
            ));
        }
        return Ok(());
    }
    changed(&LENIENT, input).map(|_| ())
}

fn merge_overrides(
    existing: AccountPolicyOverrides,
    incoming: AccountPolicyOverrides,
) -> AccountPolicyOverrides {
    AccountPolicyOverrides {
        change_per_call: incoming.change_per_call.or(existing.change_per_call),
        trash_per_call: incoming.trash_per_call.or(existing.trash_per_call),
        trash_per_day: incoming.trash_per_day.or(existing.trash_per_day),
        ask_above: incoming.ask_above.or(existing.ask_above),
    }
}

enum ResolvedSet {
    Default {
        policy: Policy,
    },
    AccountReset {
        account: AccountId,
        current: PolicyRow,
    },
    AccountSet {
        account: AccountId,
        merged: AccountPolicyOverrides,
        policy: Policy,
    },
}

/// Validates and resolves `mail-policy-set` against the store's current state:
/// merges raw per-account overrides before checking `Policy::fault` on the
/// unclamped resolution so validation, approval, persistence and response agree.
fn resolve_set(
    store: &crate::store::Store,
    input: &Value,
) -> Result<Result<ResolvedSet, Box<CommandError>>, StoreError> {
    let account = match account_input(input) {
        Ok(account) => account,
        Err(error) => return Ok(Err(error)),
    };
    let reset = match reset_input(input) {
        Ok(reset) => reset,
        Err(error) => return Ok(Err(error)),
    };
    if let Err(error) = validate_set_shape(input) {
        return Ok(Err(error));
    }
    let current = store.policy()?;
    if let Some(id) = account {
        if !store.accounts()?.iter().any(|acc| acc.id == id) {
            return Ok(Err(Box::new(account_not_found(id))));
        }
        if reset {
            return Ok(Ok(ResolvedSet::AccountReset {
                account: id,
                current,
            }));
        }
        let existing = store
            .account_policy(id)?
            .map(|row| row.overrides)
            .unwrap_or_default();
        let (incoming, _) = match parse_overrides(input) {
            Ok(parsed) => parsed,
            Err(error) => return Ok(Err(error)),
        };
        let merged = merge_overrides(existing, incoming);
        let policy = merged.resolve_unclamped(current.policy);
        if let Some(fault) = policy.fault() {
            return Ok(Err(Box::new(
                CommandError::new(
                    "INVALID_INPUT",
                    format!("the policy cannot be kept: {fault}"),
                )
                .with_suggestion("Run `loam-mail mail-policy-show` to see the limits."),
            )));
        }
        return Ok(Ok(ResolvedSet::AccountSet {
            account: id,
            merged,
            policy,
        }));
    }
    let policy = match changed(&current.policy, input) {
        Ok(policy) => policy,
        Err(error) => return Ok(Err(error)),
    };
    Ok(Ok(ResolvedSet::Default { policy }))
}

fn overrides_json(overrides: &AccountPolicyOverrides) -> Value {
    let mut map = serde_json::Map::new();
    if let Some(v) = overrides.change_per_call {
        map.insert("changePerCall".to_string(), json!(v));
    }
    if let Some(v) = overrides.trash_per_call {
        map.insert("trashPerCall".to_string(), json!(v));
    }
    if let Some(v) = overrides.trash_per_day {
        map.insert("trashPerDay".to_string(), json!(v));
    }
    if let Some(v) = overrides.ask_above {
        map.insert("askAbove".to_string(), json!(v));
    }
    Value::Object(map)
}

fn account_row_json(row: &AccountPolicyRow, base: Policy) -> Value {
    let resolved = row.overrides.resolve(base);
    let mut value = policy_json(&resolved);
    value["setAt"] = json!(row.set_at);
    json!({
        "account": row.account.0,
        "policy": value,
        "overrides": overrides_json(&row.overrides),
        "setAt": row.set_at,
    })
}

/// What the person is asked to approve for `mail-policy-set`: the policy
/// as it would be, in numbers alone.
#[must_use]
pub fn approval_summary(engine: &Engine, input: &Value) -> Option<String> {
    let resolved = engine.with_store(|store| resolve_set(store, input)).ok()?;
    Some(match resolved {
        Ok(ResolvedSet::Default { policy }) => format!(
            "Set the policy: an agent or a script may archive, label and mark up to {} messages a call, and trash up to {} a call and {} a day; above {} messages, the command line asks before a change of the person's",
            policy.change_per_call, policy.trash_per_call, policy.trash_per_day, policy.ask_above
        ),
        Ok(ResolvedSet::AccountReset { account, current }) => {
            let policy = current.policy;
            format!(
                "Reset the policy for account {} to the default policy: an agent or a script may archive, label and mark up to {} messages a call, and trash up to {} a call and {} a day; above {} messages, the command line asks before a change of the person's",
                account.0,
                policy.change_per_call,
                policy.trash_per_call,
                policy.trash_per_day,
                policy.ask_above
            )
        }
        Ok(ResolvedSet::AccountSet {
            account, policy, ..
        }) => format!(
            "Set the policy for account {}: an agent or a script may archive, label and mark up to {} messages a call, and trash up to {} a call and {} a day; above {} messages, the command line asks before a change of the person's",
            account.0,
            policy.change_per_call,
            policy.trash_per_call,
            policy.trash_per_day,
            policy.ask_above
        ),
        Err(why) => match account_input(input).ok().flatten() {
            Some(id) => format!(
                "Set the policy for account {}, which cannot be set as given ({}): nothing will change",
                id.0, why.code
            ),
            None => format!(
                "Set the policy, which cannot be set as given ({}): nothing will change",
                why.code
            ),
        },
    })
}

fn row_json(row: &PolicyRow) -> Value {
    let mut value = policy_json(&row.policy);
    value["setAt"] = json!(row.set_at);
    value
}

enum ShowTarget {
    All,
    Account(AccountId),
    Selection(i64),
    Messages(Vec<i64>),
    Operation(i64),
}

fn show_target(input: &Value) -> Result<ShowTarget, Box<CommandError>> {
    let account = account_input(input)?;
    let selection = integer(input, "selection")?;
    let operation = integer(input, "operation")?;
    let messages = match input.get("messages") {
        None | Some(Value::Null) => None,
        Some(Value::Array(items)) => {
            let mut ids = Vec::with_capacity(items.len());
            for item in items {
                let Some(id) = item.as_i64() else {
                    return Err(Box::new(
                        CommandError::new("INVALID_INPUT", "`messages` holds message ids")
                            .with_suggestion("Pass message ids as whole numbers."),
                    ));
                };
                ids.push(id);
            }
            Some(ids)
        }
        Some(_) => {
            return Err(Box::new(
                CommandError::new("INVALID_INPUT", "`messages` is a list of message ids")
                    .with_suggestion("Pass message ids as a list of whole numbers."),
            ));
        }
    };
    let count = usize::from(account.is_some())
        + usize::from(selection.is_some())
        + usize::from(messages.is_some())
        + usize::from(operation.is_some());
    if count > 1 {
        return Err(Box::new(
            CommandError::new(
                "INVALID_INPUT",
                "name at most one of `account`, `selection`, `messages`, or `operation`",
            )
            .with_suggestion("Pass one target at a time to `mail-policy-show`."),
        ));
    }
    Ok(if let Some(id) = account {
        ShowTarget::Account(id)
    } else if let Some(id) = selection {
        ShowTarget::Selection(id)
    } else if let Some(ids) = messages {
        ShowTarget::Messages(ids)
    } else if let Some(id) = operation {
        ShowTarget::Operation(id)
    } else {
        ShowTarget::All
    })
}

fn strictest_policy(policies: &[Policy], fallback: Policy) -> Policy {
    policies
        .iter()
        .copied()
        .reduce(|a, b| Policy {
            change_per_call: a.change_per_call.min(b.change_per_call),
            trash_per_call: a.trash_per_call.min(b.trash_per_call),
            trash_per_day: a.trash_per_day.min(b.trash_per_day),
            ask_above: a.ask_above.min(b.ask_above),
        })
        .unwrap_or(fallback)
}

struct Show {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Show {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        let target = match show_target(&input) {
            Ok(target) => target,
            Err(error) => return failure(*error),
        };
        let shown = self.engine.with_store(|store| {
            let row = store.policy()?;
            match target {
                ShowTarget::Account(id) => {
                    if !store.accounts()?.iter().any(|acc| acc.id == id) {
                        return Ok(Err(account_not_found(id)));
                    }
                    let override_row = store.account_policy(id)?;
                    let resolved =
                        override_row.map_or(row.policy, |ov| ov.overrides.resolve(row.policy));
                    let mut effective = policy_json(&resolved);
                    effective["setAt"] = json!(override_row.map(|ov| ov.set_at).or(row.set_at));
                    Ok(Ok(json!({
                        "account": id.0,
                        "policy": effective,
                        "overrides": override_row
                            .map(|ov| overrides_json(&ov.overrides))
                            .unwrap_or_else(|| json!({})),
                        "appliesTo": ["agent", "script"],
                        "default": policy_json(&Policy::DEFAULT),
                        "selections": {
                            "perCaller": MOST_SELECTIONS,
                            "lifetime": SELECTION_LIFETIME,
                        },
                        "proposals": {
                            "perCaller": MOST_PROPOSALS,
                            "lifetime": PROPOSAL_LIFETIME,
                        },
                    })))
                }
                ShowTarget::Selection(id) => {
                    let affected = store.selection_accounts(id)?;
                    let policies: Vec<Policy> = affected
                        .iter()
                        .map(|&acc| Ok(store.effective_policy(Some(acc))?.0))
                        .collect::<Result<_, StoreError>>()?;
                    let effective = strictest_policy(&policies, row.policy);
                    Ok(Ok(json!({
                        "policy": policy_json(&effective),
                        "accounts": affected.iter().map(|a| a.0).collect::<Vec<_>>(),
                        "appliesTo": ["agent", "script"],
                        "default": policy_json(&Policy::DEFAULT),
                    })))
                }
                ShowTarget::Messages(ids) => {
                    let affected = store.shown_message_accounts(&ids)?;
                    let policies: Vec<Policy> = affected
                        .iter()
                        .map(|&acc| Ok(store.effective_policy(Some(acc))?.0))
                        .collect::<Result<_, StoreError>>()?;
                    let effective = strictest_policy(&policies, row.policy);
                    Ok(Ok(json!({
                        "policy": policy_json(&effective),
                        "accounts": affected.iter().map(|a| a.0).collect::<Vec<_>>(),
                        "appliesTo": ["agent", "script"],
                        "default": policy_json(&Policy::DEFAULT),
                    })))
                }
                ShowTarget::Operation(id) => {
                    let affected = store.operation_all_accounts(id)?;
                    let policies: Vec<Policy> = affected
                        .iter()
                        .map(|&acc| Ok(store.effective_policy(Some(acc))?.0))
                        .collect::<Result<_, StoreError>>()?;
                    let effective = strictest_policy(&policies, row.policy);
                    Ok(Ok(json!({
                        "policy": policy_json(&effective),
                        "accounts": affected.iter().map(|a| a.0).collect::<Vec<_>>(),
                        "appliesTo": ["agent", "script"],
                        "default": policy_json(&Policy::DEFAULT),
                    })))
                }
                ShowTarget::All => {
                    let accounts: Vec<Value> = store
                        .account_policies()?
                        .iter()
                        .map(|ov| account_row_json(ov, row.policy))
                        .collect();
                    Ok(Ok(json!({
                        "policy": row_json(&row),
                        "accounts": accounts,
                        // The limits apply to these callers; the person's own
                        // changes have none.
                        "appliesTo": ["agent", "script"],
                        "default": policy_json(&Policy::DEFAULT),
                        // What any caller may hold of the engine's own data.
                        "selections": {
                            "perCaller": MOST_SELECTIONS,
                            "lifetime": SELECTION_LIFETIME,
                        },
                        // Over a limit, a change is a proposal that waits for the
                        // person: this many a caller, for this long (M28).
                        "proposals": {
                            "perCaller": MOST_PROPOSALS,
                            "lifetime": PROPOSAL_LIFETIME,
                        },
                    })))
                }
            }
        });
        match shown {
            Ok(Ok(value)) => success(value),
            Ok(Err(error)) => failure(error),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-policy-show`: what an agent or a script may change in the mailbox
/// with nobody present.
#[must_use]
pub fn show(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-policy-show",
        "Show what an agent or a script may change in the mailbox with nobody present",
        vec![
            parameter(
                "account",
                JsonSchemaType::Integer,
                "Optional account id to show the effective policy for that account",
                false,
            ),
            parameter(
                "selection",
                JsonSchemaType::Integer,
                "Optional selection id to show the strictest effective policy across its accounts",
                false,
            ),
            parameter(
                "messages",
                JsonSchemaType::Array,
                "Optional message ids to show the strictest effective policy across their accounts",
                false,
            ),
            parameter(
                "operation",
                JsonSchemaType::Integer,
                "Optional operation id to show the strictest effective policy across its accounts",
                false,
            ),
        ],
        Show { engine },
    )
    .with_expose(read_exposure())
}

struct Set {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Set {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let now = context.clock().now();
        let done = self.engine.with_store(|store| {
            let resolved = match resolve_set(store, &input)? {
                Ok(resolved) => resolved,
                Err(error) => return Ok(Err(error)),
            };
            match resolved {
                ResolvedSet::AccountReset { account, current } => {
                    let before = store.clear_account_policy(account, now)?;
                    Ok(Ok(json!({
                        "account": account.0,
                        "reset": true,
                        "policy": row_json(&current),
                        "overrides": {},
                        "previous": policy_json(&before),
                    })))
                }
                ResolvedSet::AccountSet {
                    account,
                    merged,
                    policy,
                } => {
                    let before = store.set_account_policy(account, merged, now)?;
                    let mut after_json = policy_json(&policy);
                    after_json["setAt"] = json!(now);
                    Ok(Ok(json!({
                        "account": account.0,
                        "policy": after_json,
                        "overrides": overrides_json(&merged),
                        "previous": policy_json(&before),
                    })))
                }
                ResolvedSet::Default { policy } => {
                    let before = store.set_policy(&policy, now)?;
                    let after = store.policy()?;
                    Ok(Ok(json!({
                        "policy": row_json(&after),
                        // Setting this again undoes the change.
                        "previous": policy_json(&before.policy),
                    })))
                }
            }
        });
        match done {
            Ok(Ok(value)) => success(value),
            Ok(Err(error)) => failure(*error),
            Err(StoreError::NotFound("account")) => failure(account_not_found(
                account_input(&input).ok().flatten().unwrap_or(AccountId(0)),
            )),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-policy-set`: changes what an agent or a script may do with nobody
/// present. A person's command, held for their approval, whose summary
/// gives the policy as it would be; a policy that cannot be set is refused
/// without asking.
#[must_use]
pub fn set(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        SET,
        "Change what an agent or a script may change in the mailbox with nobody present",
        vec![
            parameter(
                "account",
                JsonSchemaType::Integer,
                "Optional account id to set limits for that account alone; omit for the default policy",
                false,
            ),
            parameter(
                "reset",
                JsonSchemaType::Boolean,
                "true with `account` to clear that account's overrides and fall back to the default policy",
                false,
            ),
            parameter(
                "changePerCall",
                JsonSchemaType::Integer,
                "How many messages an agent or a script may archive, label or mark in one call (at most 1000)",
                false,
            ),
            parameter(
                "trashPerCall",
                JsonSchemaType::Integer,
                "How many it may trash in one call (at most 1000, and not more than a day's)",
                false,
            ),
            parameter(
                "trashPerDay",
                JsonSchemaType::Integer,
                "How many each caller may trash in any 24 hours (at most 10000)",
                false,
            ),
            parameter(
                "askAbove",
                JsonSchemaType::Integer,
                "Above this many messages, the command line asks before a change of the person's",
                false,
            ),
        ],
        Set { engine },
    )
    .as_mutation()
    .with_confirm_prompt("Change the policy")
    .with_approval(ApprovalPolicy::when(|input, _context| {
        // Input that no policy could take is refused by the command without
        // asking the person to approve nothing. It is judged against the
        // most lenient policy, not the stored one, which the person could
        // change before the command reads it: every other call is held.
        if validate_set_shape(input).is_err() {
            ApprovalDecision::NotRequired
        } else {
            ApprovalDecision::Required
        }
    }))
    .with_expose(command_line_only())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use crate::store::{MOST_ASK_ABOVE, MOST_PER_CALL};

    /// Input refused against the lenient policy is refused against every
    /// policy, so a call the approval does not hold can never change one.
    #[test]
    fn what_the_lenient_policy_refuses_every_policy_refuses() {
        let edges = |most: u32| {
            vec![
                None,
                Some(json!(0)),
                Some(json!(1)),
                Some(json!(most)),
                Some(json!(most + 1)),
                Some(json!(-1)),
            ]
        };
        let fields = [
            ("changePerCall", edges(MOST_PER_CALL)),
            ("trashPerCall", edges(MOST_PER_CALL)),
            ("trashPerDay", edges(MOST_PER_DAY)),
            ("askAbove", edges(MOST_ASK_ABOVE)),
        ];
        let stored = [
            Policy::DEFAULT,
            Policy {
                change_per_call: 0,
                trash_per_call: 0,
                trash_per_day: 0,
                ask_above: 0,
            },
            Policy {
                change_per_call: MOST_PER_CALL,
                trash_per_call: MOST_PER_CALL,
                trash_per_day: MOST_PER_DAY,
                ask_above: MOST_ASK_ABOVE,
            },
            Policy {
                trash_per_call: 7,
                trash_per_day: 7,
                ..Policy::DEFAULT
            },
        ];
        let mut inputs = vec![serde_json::Map::new()];
        for (name, values) in &fields {
            inputs = inputs
                .iter()
                .flat_map(|input| {
                    values.iter().map(move |value| {
                        let mut input = input.clone();
                        if let Some(value) = value {
                            input.insert((*name).to_string(), value.clone());
                        }
                        input
                    })
                })
                .collect();
        }
        assert_eq!(inputs.len(), 6usize.pow(4));
        for input in inputs {
            let input = Value::Object(input);
            if changed(&LENIENT, &input).is_ok() {
                continue;
            }
            for policy in &stored {
                assert!(
                    changed(policy, &input).is_err(),
                    "{input} is refused unheld yet {policy:?} takes it"
                );
            }
        }
    }
}
