//! Per-command output budgets (`spec/output-budgets.md`): a command **declares** a budget, a
//! caller **asks** for a smaller or larger one per call, the handler **fits** its result to the
//! effective budget, and [`CommandRegistry::execute`](crate::CommandRegistry::execute)
//! **checks** the result afterwards. An over-budget read becomes a failure that tells the agent
//! how to narrow its request; an over-budget mutation keeps its result, with a warning, because
//! the work is done. Nothing truncates structured output.
//!
//! - **Declare** with [`CommandDefinition::with_output_budget`](crate::CommandDefinition::with_output_budget).
//!   The declaration is checked when the command is registered.
//! - **Ask** with [`CommandContext::with_output_budget_ask`] in process, or over MCP with
//!   `_meta["dev.afd/outputBudget"] = { "maxBytes": n }` (or the meta-tools' `meta` argument).
//!   The ask is validated after the input and the declared context fields, and before the
//!   middleware and the handler run; an invalid ask fails the call with `VALIDATION_ERROR`.
//! - **Fit** the result to [`CommandContext::output_budget`]: fewer items, shorter excerpts, a
//!   smaller window with a way to read on. Never cut a JSON value in the middle.
//! - The **check** is the innermost link of the middleware chain: after the handler, before
//!   `metadata` is stamped, so middleware and the journal see the checked result. It measures
//!   the UTF-8 length of the result's canonical JSON with `metadata` left out, and only checks
//!   successful results. A streamed command's chunks are not checked.
//!
//! ```rust
//! use afd::{success, CommandDefinition, CommandRegistry, CommandContext, CommandHandler};
//! use async_trait::async_trait;
//! use serde_json::{json, Value};
//!
//! struct Search;
//!
//! #[async_trait]
//! impl CommandHandler for Search {
//!     async fn execute(&self, _input: Value, context: CommandContext) -> afd::CommandResult<Value> {
//!         // Fit the result to the effective budget (here: 64 bytes by default).
//!         let _budget = context.output_budget();
//!         success(json!({ "hits": [] }))
//!     }
//! }
//!
//! let registry = CommandRegistry::new();
//! registry
//!     .register(
//!         CommandDefinition::new("doc-search", "Search documents", vec![], Search)
//!             .with_output_budget(64, 4096),
//!     )
//!     .unwrap();
//! ```

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::commands::{CommandContext, CommandDefinition};
use crate::errors::{error_codes, CommandError};
use crate::metadata::{Warning, WarningSeverity};
use crate::result::{failure, CommandResult, ResultMetadata};

/// The `_meta` key of an output budget. It carries three shapes in three places: the declaration
/// on a tool's `_meta` (`{ defaultBytes, maxBytes }`), the ask on a call's `_meta`
/// (`{ maxBytes }`), and the report in a result's `metadata` (`{ limitBytes, usedBytes }`).
pub const AFD_OUTPUT_BUDGET_META_KEY: &str = "dev.afd/outputBudget";

/// The largest integer a JavaScript number holds exactly: the largest budget.
pub const MAX_OUTPUT_BUDGET_BYTES: u64 = 9_007_199_254_740_991;

/// A command's declared output budget: the bytes a result may use by default and at most.
///
/// Both are integers from 1 to 9007199254740991 with `default_bytes <= max_bytes`; the registry
/// refuses a command whose declaration is not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutputBudget {
    /// The effective budget of a call that asks for none.
    pub default_bytes: u64,
    /// The most a call may ask for; a larger ask is clamped to it.
    pub max_bytes: u64,
}

impl OutputBudget {
    /// A declaration. It is checked when the command is registered
    /// ([`CommandRegistry::register`](crate::CommandRegistry::register)).
    pub const fn new(default_bytes: u64, max_bytes: u64) -> Self {
        Self {
            default_bytes,
            max_bytes,
        }
    }

    /// A declaration from its JSON form `{ "defaultBytes": d, "maxBytes": m }`, checked.
    ///
    /// # Errors
    /// A message naming the field for anything but an object with exactly those two members,
    /// each an integer from 1 to 9007199254740991, `defaultBytes` not above `maxBytes`.
    pub fn from_value(value: &Value) -> Result<Self, String> {
        let Value::Object(members) = value else {
            return Err("outputBudget must be an object { defaultBytes, maxBytes }".to_owned());
        };
        if let Some(extra) = members
            .keys()
            .find(|key| !matches!(key.as_str(), "defaultBytes" | "maxBytes"))
        {
            return Err(format!(
                "outputBudget has an unknown member '{extra}'; it takes only defaultBytes and maxBytes"
            ));
        }
        let member = |name: &str| {
            members.get(name).and_then(positive_integer).ok_or_else(|| {
                format!(
                    "outputBudget.{name} must be an integer from 1 to {MAX_OUTPUT_BUDGET_BYTES}"
                )
            })
        };
        let budget = Self::new(member("defaultBytes")?, member("maxBytes")?);
        budget.check()?;
        Ok(budget)
    }

    /// Check the bounds.
    ///
    /// # Errors
    /// A message naming the field.
    pub fn check(&self) -> Result<(), String> {
        for (name, bytes) in [
            ("defaultBytes", self.default_bytes),
            ("maxBytes", self.max_bytes),
        ] {
            if !(1..=MAX_OUTPUT_BUDGET_BYTES).contains(&bytes) {
                return Err(format!(
                    "outputBudget.{name} must be an integer from 1 to {MAX_OUTPUT_BUDGET_BYTES}, not {bytes}"
                ));
            }
        }
        if self.default_bytes > self.max_bytes {
            return Err(format!(
                "outputBudget.defaultBytes ({}) must not be above outputBudget.maxBytes ({})",
                self.default_bytes, self.max_bytes
            ));
        }
        Ok(())
    }

    /// The effective budget of a call with `ask` (B3): `min(ask, max_bytes)`, or `default_bytes`
    /// without one.
    pub fn effective(&self, ask: Option<u64>) -> u64 {
        ask.map_or(self.default_bytes, |ask| ask.min(self.max_bytes))
    }
}

/// An integer from 1 to [`MAX_OUTPUT_BUDGET_BYTES`] as JavaScript reads one: `100` and `100.0`.
fn positive_integer(value: &Value) -> Option<u64> {
    let bytes = match value.as_u64() {
        Some(bytes) => bytes,
        None => {
            let float = value.as_f64().filter(|float| float.fract() == 0.0)?;
            if !(1.0..=MAX_OUTPUT_BUDGET_BYTES as f64).contains(&float) {
                return None;
            }
            float as u64
        }
    };
    (1..=MAX_OUTPUT_BUDGET_BYTES)
        .contains(&bytes)
        .then_some(bytes)
}

/// `{ "maxBytes": max_bytes }`, the ask in its `_meta` form.
pub(crate) fn ask_value(max_bytes: u64) -> Value {
    json!({ "maxBytes": max_bytes })
}

/// The `maxBytes` of an ask in its `_meta` form: an object with that one member, an integer from
/// 1 to 2^53 − 1. `None` for anything else.
fn parse_ask(value: &Value) -> Option<u64> {
    let Value::Object(members) = value else {
        return None;
    };
    if members.len() != 1 {
        return None;
    }
    members.get("maxBytes").and_then(positive_integer)
}

/// The `VALIDATION_ERROR` of an invalid ask (B2).
fn ask_failure() -> Box<CommandError> {
    Box::new(
        CommandError::new(
            error_codes::VALIDATION_ERROR,
            "The output budget ask is not valid",
        )
        .with_suggestion(format!(
            "Send _meta[\"{AFD_OUTPUT_BUDGET_META_KEY}\"] = {{ \"maxBytes\": <positive integer> }}, or leave it out"
        ))
        .with_retryable(false)
        .with_details(HashMap::from([
            ("field".to_owned(), json!("outputBudget")),
            ("meta".to_owned(), json!(AFD_OUTPUT_BUDGET_META_KEY)),
        ])),
    )
}

/// Validate the call's ask and set the effective budget on `context` (B2, B3, B4): the ask is
/// checked whether or not the command declares a budget, and then ignored when it does not.
///
/// # Errors
/// A `VALIDATION_ERROR` for an invalid ask.
pub(crate) fn apply_output_budget(
    command: &CommandDefinition,
    context: &mut CommandContext,
) -> Result<(), Box<CommandError>> {
    let ask = match context
        .output_budget_ask
        .as_ref()
        .filter(|value| !value.is_null())
    {
        Some(value) => Some(parse_ask(value).ok_or_else(ask_failure)?),
        None => None,
    };
    context.output_budget = command
        .output_budget
        .map(|declaration| declaration.effective(ask));
    Ok(())
}

/// The UTF-8 length of `result`'s canonical JSON without its `metadata` (B5, step 2).
fn measured_size(result: &CommandResult<Value>) -> Option<u64> {
    let mut value = serde_json::to_value(result).ok()?;
    value.as_object_mut()?.remove("metadata");
    Some(crate::canonical::nearest(&value).len() as u64)
}

/// The check after the handler (B5, B6): what the engine does with `result` under the effective
/// budget `limit` of `command`.
pub(crate) fn check_result(
    command: &CommandDefinition,
    limit: u64,
    mut result: CommandResult<Value>,
) -> CommandResult<Value> {
    // A handler's own failure is never replaced: its error is what the agent needs.
    let Some(declaration) = command.output_budget.filter(|_| result.success) else {
        return result;
    };
    let Some(used) = measured_size(&result) else {
        return result;
    };
    if used > limit && !command.mutation {
        return failure(over_budget_error(limit, used, declaration.max_bytes));
    }
    if used > limit {
        let warning = Warning::new(
            error_codes::OUTPUT_BUDGET_EXCEEDED,
            format!(
                "The result is {used} bytes, over this call's output budget of {limit} bytes; the change was made"
            ),
        )
        .with_severity(WarningSeverity::Caution)
        .with_details(HashMap::from([
            ("limitBytes".to_owned(), json!(limit)),
            ("actualBytes".to_owned(), json!(used)),
        ]));
        result.warnings.get_or_insert_with(Vec::new).push(warning);
    }
    let report = json!({ "limitBytes": limit, "usedBytes": used });
    result
        .metadata
        .get_or_insert_with(ResultMetadata::new)
        .extra
        .insert(AFD_OUTPUT_BUDGET_META_KEY.to_owned(), report);
    result
}

/// The failure that replaces an over-budget read (B5, rule 4).
fn over_budget_error(limit: u64, actual: u64, max: u64) -> CommandError {
    let suggestion = if limit < max {
        format!(
            "Narrow the request (fewer results, a smaller window or a filter), or ask for up to {max} bytes with _meta[\"{AFD_OUTPUT_BUDGET_META_KEY}\"] = {{ \"maxBytes\": {max} }}."
        )
    } else {
        format!(
            "Narrow the request (fewer results, a smaller window or a filter); {max} bytes is this command's largest output budget."
        )
    };
    CommandError::new(
        error_codes::OUTPUT_BUDGET_EXCEEDED,
        format!("The result is {actual} bytes, over this call's output budget of {limit} bytes"),
    )
    .with_suggestion(suggestion)
    .with_retryable(false)
    .with_details(HashMap::from([
        ("limitBytes".to_owned(), json!(limit)),
        ("actualBytes".to_owned(), json!(actual)),
        ("maxBytes".to_owned(), json!(max)),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_clamps_the_ask_to_the_declaration() {
        let budget = OutputBudget::new(64, 128);
        assert_eq!(budget.effective(None), 64);
        assert_eq!(budget.effective(Some(10)), 10);
        assert_eq!(budget.effective(Some(1000)), 128);
    }

    #[test]
    fn integral_floats_count_as_integers() {
        assert_eq!(positive_integer(&json!(100.0)), Some(100));
        assert_eq!(positive_integer(&json!(10.5)), None);
        assert_eq!(positive_integer(&json!(0)), None);
        assert_eq!(positive_integer(&json!(-5)), None);
        assert_eq!(positive_integer(&json!("100")), None);
        assert_eq!(positive_integer(&json!(9_007_199_254_740_992u64)), None);
        assert_eq!(
            positive_integer(&json!(9_007_199_254_740_991u64)),
            Some(MAX_OUTPUT_BUDGET_BYTES)
        );
    }

    #[test]
    fn declarations_name_the_field() {
        let error =
            OutputBudget::from_value(&json!({"defaultBytes": 65, "maxBytes": 64})).unwrap_err();
        assert!(error.contains("defaultBytes"), "{error}");
        let error = OutputBudget::from_value(&json!({"defaultBytes": 1})).unwrap_err();
        assert!(error.contains("maxBytes"), "{error}");
        let error = OutputBudget::new(0, 4).check().unwrap_err();
        assert!(error.contains("defaultBytes"), "{error}");
        let error = OutputBudget::new(1, MAX_OUTPUT_BUDGET_BYTES + 1)
            .check()
            .unwrap_err();
        assert!(error.contains("maxBytes"), "{error}");
    }
}
