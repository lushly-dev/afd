//! The person's policy (the specification's 9.4): `mail-policy-show` reads
//! it, and `mail-policy-set`, a person's command held for their approval,
//! changes it. The engine applies it to every caller itself, because Loam's
//! autonomy policy reaches only Loam's copilot; the change commands that
//! read it arrive with the rest of step D1.

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
use crate::store::{MOST_PER_DAY, MOST_SELECTIONS, Policy, PolicyRow, SELECTION_LIFETIME};

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

/// The policy `input` would make of `current`, or why it cannot.
fn changed(current: &Policy, input: &Value) -> Result<Policy, Box<CommandError>> {
    let mut policy = *current;
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
            "changePerCall" => policy.change_per_call = value,
            "trashPerCall" => policy.trash_per_call = value,
            "trashPerDay" => policy.trash_per_day = value,
            _ => policy.ask_above = value,
        }
    }
    if !named {
        return Err(Box::new(
            CommandError::new("INVALID_INPUT", "no limit of the policy is named")
                .with_suggestion(format!("Name one or more of: {}.", LIMITS.join(", "))),
        ));
    }
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

/// What the person is asked to approve for `mail-policy-set`: the policy
/// as it would be, in numbers alone.
#[must_use]
pub fn approval_summary(engine: &Engine, input: &Value) -> Option<String> {
    let current = engine.with_store(|store| store.policy()).ok()?;
    Some(match changed(&current.policy, input) {
        Ok(policy) => format!(
            "Set the policy: an agent or a script may archive, label and mark up to {} messages a call, and trash up to {} a call and {} a day; above {} messages, the command line asks before a change of the person's",
            policy.change_per_call, policy.trash_per_call, policy.trash_per_day, policy.ask_above
        ),
        Err(why) => format!(
            "Set the policy, which cannot be set as given ({}): nothing will change",
            why.code
        ),
    })
}

fn row_json(row: &PolicyRow) -> Value {
    let mut value = policy_json(&row.policy);
    value["setAt"] = json!(row.set_at);
    value
}

struct Show {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Show {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        match self.engine.with_store(|store| store.policy()) {
            Ok(row) => success(json!({
                "policy": row_json(&row),
                // The limits apply to these callers; the person's own
                // changes have none.
                "appliesTo": ["agent", "script"],
                "default": policy_json(&Policy::DEFAULT),
                // What any caller may hold of the engine's own data.
                "selections": {
                    "perCaller": MOST_SELECTIONS,
                    "lifetime": SELECTION_LIFETIME,
                },
            })),
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
        vec![],
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
            let current = store.policy()?;
            let policy = match changed(&current.policy, &input) {
                Ok(policy) => policy,
                Err(error) => return Ok(Err(error)),
            };
            let before = store.set_policy(&policy, now)?;
            Ok(Ok((before, store.policy()?)))
        });
        match done {
            Ok(Ok((before, after))) => success(json!({
                "policy": row_json(&after),
                // Setting this again undoes the change.
                "previous": policy_json(&before.policy),
            })),
            Ok(Err(error)) => failure(*error),
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
        if changed(&LENIENT, input).is_err() {
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
