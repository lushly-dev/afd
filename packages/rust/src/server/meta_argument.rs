//! The `meta` argument of the meta-tools (`spec/command-metadata.md`, "Decisions on the tool
//! surface (#466)"; `spec/context-fields.md`, "Clients that cannot set `_meta`").
//!
//! `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover` and `afd-detail` take an optional `meta`
//! object for clients that cannot set `_meta`. Its keys are `dev.afd/context` and the declared
//! context fields' `_meta` keys, applied as if the request had sent them in `_meta`, before
//! anything reads `_meta`. Other keys are dropped, as undeclared `_meta` keys are. A key sent
//! both ways must agree, or the call fails with `VALIDATION_ERROR`. TypeScript's
//! `liftMetaArgument` does the same.

use std::collections::HashMap;

use serde_json::{json, Map, Value};

use crate::context_fields::ContextField;
use crate::contexts::AFD_CONTEXT_META_KEY;
use crate::{error_codes, CommandError, AFD_META_TOOL_NAMES};

/// The keys a `meta` argument may carry on a server with these declared fields:
/// `dev.afd/context`, then each field's `_meta` key.
pub(crate) fn meta_argument_keys(fields: &[ContextField]) -> Vec<String> {
    std::iter::once(AFD_CONTEXT_META_KEY.to_owned())
        .chain(fields.iter().map(|field| field.meta.clone()))
        .collect()
}

/// A meta-tool call's arguments without `meta`, and the request's `_meta` with the argument's
/// allowed keys added.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Lifted {
    pub(crate) args: Option<Map<String, Value>>,
    pub(crate) meta: Map<String, Value>,
}

/// Move a meta-tool's `meta` argument into the request's `_meta` values.
///
/// `None` when nothing changes: a call to another tool, or a meta-tool call without `meta`.
/// A `meta` of `null` is removed and has no other effect, and so is a `null` value under one of
/// its keys.
///
/// # Errors
/// `VALIDATION_ERROR` when `meta` is not an object, or when one of its keys is also in `_meta`
/// with a different value.
pub(crate) fn lift_meta_argument(
    tool: &str,
    args: Option<&Map<String, Value>>,
    meta: &Map<String, Value>,
    keys: &[String],
) -> Result<Option<Lifted>, Box<CommandError>> {
    let Some(args) = args.filter(|args| args.contains_key("meta")) else {
        return Ok(None);
    };
    if !AFD_META_TOOL_NAMES.contains(&tool) {
        return Ok(None);
    }
    let mut rest = args.clone();
    let argument = rest.remove("meta").unwrap_or(Value::Null);
    let mut merged = meta.clone();
    match argument {
        Value::Null => {}
        Value::Object(argument) => {
            for (key, value) in argument {
                if value.is_null() || !keys.contains(&key) {
                    continue;
                }
                if let Some(sent) = meta.get(&key).filter(|sent| !sent.is_null()) {
                    if *sent != value {
                        return Err(Box::new(disagreement(tool, &key)));
                    }
                }
                merged.insert(key, value);
            }
        }
        _ => return Err(Box::new(not_an_object(tool, keys))),
    }
    Ok(Some(Lifted {
        args: Some(rest),
        meta: merged,
    }))
}

fn not_an_object(tool: &str, keys: &[String]) -> CommandError {
    CommandError::new(
        error_codes::VALIDATION_ERROR,
        format!("The meta argument of {tool} must be an object"),
    )
    .with_suggestion(format!(
        "Send meta as an object whose keys are _meta keys: {}",
        keys.join(", ")
    ))
    .with_details(HashMap::from([("argument".to_owned(), json!("meta"))]))
}

fn disagreement(tool: &str, key: &str) -> CommandError {
    CommandError::new(
        error_codes::VALIDATION_ERROR,
        format!("_meta[\"{key}\"] and the meta argument of {tool} disagree"),
    )
    .with_suggestion(format!(
        "Send {key} in _meta or in the meta argument, or the same value in both"
    ))
    .with_details(HashMap::from([("meta".to_owned(), json!(key))]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn object(value: Value) -> Map<String, Value> {
        match value {
            Value::Object(map) => map,
            _ => panic!("not an object"),
        }
    }

    fn keys() -> Vec<String> {
        vec![
            AFD_CONTEXT_META_KEY.to_owned(),
            "app.example/tenant".to_owned(),
        ]
    }

    #[test]
    fn keys_are_the_context_key_and_the_declared_fields() {
        let field = ContextField::new("tenantId", "app.example/tenant", json!({"type": "string"}));
        assert_eq!(
            meta_argument_keys(&[field]),
            vec![
                "dev.afd/context".to_owned(),
                "app.example/tenant".to_owned()
            ]
        );
    }

    #[test]
    fn other_tools_and_calls_without_meta_are_unchanged() {
        let args = object(json!({"meta": {"app.example/tenant": "t1"}, "x": 1}));
        let lifted = lift_meta_argument("todo-create", Some(&args), &Map::new(), &keys());
        assert_eq!(lifted.unwrap(), None);
        let args = object(json!({"command": "todo-list"}));
        let lifted = lift_meta_argument("afd-call", Some(&args), &Map::new(), &keys());
        assert_eq!(lifted.unwrap(), None);
        let lifted = lift_meta_argument("afd-call", None, &Map::new(), &keys());
        assert_eq!(lifted.unwrap(), None);
    }

    #[test]
    fn null_meta_is_removed_without_effect() {
        let args = object(json!({"command": "todo-list", "meta": null}));
        let sent = object(json!({"other": 1}));
        let lifted = lift_meta_argument("afd-call", Some(&args), &sent, &keys())
            .unwrap()
            .unwrap();
        assert_eq!(lifted.args, Some(object(json!({"command": "todo-list"}))));
        assert_eq!(lifted.meta, sent);
    }

    #[test]
    fn allowed_keys_are_merged_and_others_dropped() {
        let args = object(json!({
            "commands": [],
            "meta": {
                "app.example/tenant": "t1",
                "dev.afd/context": "ops",
                "dev.afd/confirm": true,
                "app.example/other": "x",
                "app.example/ignored": null,
            },
        }));
        let sent = object(json!({"progressToken": 1}));
        let lifted = lift_meta_argument("afd-batch", Some(&args), &sent, &keys())
            .unwrap()
            .unwrap();
        assert_eq!(lifted.args, Some(object(json!({"commands": []}))));
        assert_eq!(
            lifted.meta,
            object(json!({
                "progressToken": 1,
                "app.example/tenant": "t1",
                "dev.afd/context": "ops",
            }))
        );
    }

    #[test]
    fn an_agreeing_duplicate_is_accepted() {
        let args = object(json!({"meta": {"app.example/tenant": {"a": 1, "b": [1, 2]}}}));
        let sent = object(json!({"app.example/tenant": {"b": [1, 2], "a": 1}}));
        let lifted = lift_meta_argument("afd-discover", Some(&args), &sent, &keys())
            .unwrap()
            .unwrap();
        assert_eq!(lifted.meta, sent);
        assert_eq!(lifted.args, Some(Map::new()));
    }

    #[test]
    fn a_disagreement_fails() {
        let args = object(json!({"command": "x", "meta": {"app.example/tenant": "t2"}}));
        let sent = object(json!({"app.example/tenant": "t1"}));
        let error = lift_meta_argument("afd-call", Some(&args), &sent, &keys()).unwrap_err();
        assert_eq!(error.code, "VALIDATION_ERROR");
        assert_eq!(
            error.message,
            "_meta[\"app.example/tenant\"] and the meta argument of afd-call disagree"
        );
        assert_eq!(
            error
                .details
                .as_ref()
                .and_then(|details| details.get("meta")),
            Some(&json!("app.example/tenant"))
        );
        assert!(error.suggestion.is_some());
    }

    #[test]
    fn a_non_object_meta_fails() {
        for meta in [json!("t1"), json!([1]), json!(3), json!(true)] {
            let args = object(json!({"command": "x", "meta": meta}));
            let error =
                lift_meta_argument("afd-detail", Some(&args), &Map::new(), &keys()).unwrap_err();
            assert_eq!(error.code, "VALIDATION_ERROR");
            assert_eq!(
                error.message,
                "The meta argument of afd-detail must be an object"
            );
            assert_eq!(
                error
                    .details
                    .as_ref()
                    .and_then(|details| details.get("argument")),
                Some(&json!("meta"))
            );
            assert!(error.suggestion.is_some());
        }
    }
}
