//! App-to-app calls and the `apps` exposure flag against `spec/vectors/app-calls.json`
//! (`spec/app-calls.md`; Loam phase 5, step 0b), through actual
//! registry dispatch. The caller is a host's context field, `extra["caller"]`, as Loam's `caller`.

use std::collections::HashMap;
use std::path::PathBuf;

use afd::{
    error_codes, success, BatchCommand, BatchRequest, CommandContext, CommandDefinition,
    CommandHandler, CommandInterface, CommandRegistry, CommandResult, ExposeOptions,
};
use async_trait::async_trait;
use serde_json::{json, Value};

struct Tally(String);

#[async_trait]
impl CommandHandler for Tally {
    async fn execute(&self, input: Value, _: CommandContext) -> CommandResult<Value> {
        success(json!({ "command": self.0, "by": input.get("by").cloned().unwrap_or(json!(1)) }))
    }
}

fn vectors() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/vectors/app-calls.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn interface(name: &str) -> CommandInterface {
    serde_json::from_value(json!(name)).unwrap_or_else(|error| panic!("{name}: {error}"))
}

fn registry(vectors: &Value, grant: &str) -> CommandRegistry {
    let registry = CommandRegistry::new();
    for command in vectors["registry"]["commands"].as_array().unwrap() {
        let name = command["name"].as_str().unwrap();
        let expose: ExposeOptions = serde_json::from_value(command["expose"].clone()).unwrap();
        let definition = CommandDefinition::new(
            name,
            format!("The fixture command {name}"),
            vec![],
            Tally(name.to_string()),
        )
        .with_expose(expose);
        registry
            .register_with_schema(definition, vectors["registry"]["input"].clone())
            .unwrap();
    }
    let grants: HashMap<String, Vec<String>> =
        serde_json::from_value(vectors["registry"]["grants"].clone()).unwrap();
    match grant {
        "none" => {}
        "throws" => registry.set_call_grant(|_, _| panic!("the grant store is unreachable")),
        "grants" => registry.set_call_grant(move |command, context| {
            context
                .extra
                .get("caller")
                .and_then(Value::as_str)
                .and_then(|caller| grants.get(caller))
                .is_some_and(|names| names.iter().any(|name| name == command))
        }),
        other => panic!("unknown grant {other}"),
    }
    registry
}

fn context(interface_name: Option<&str>, caller: Option<&str>) -> CommandContext {
    let mut context = CommandContext::new();
    if let Some(name) = interface_name {
        context = context.with_interface(interface(name));
    }
    if let Some(caller) = caller {
        context = context.with_extra("caller", json!(caller));
    }
    context
}

fn check(label: &str, result: &CommandResult<Value>, expected: &Value, refusal: &Value) {
    let actual = serde_json::to_value(result).unwrap();
    if expected["refused"] == json!(true) {
        assert_eq!(actual["success"], json!(false), "{label}");
        assert_eq!(actual["error"], *refusal, "{label}");
        assert!(actual.get("data").is_none(), "{label}");
    } else if let Some(code) = expected.get("code") {
        assert_eq!(actual["success"], json!(false), "{label}");
        assert_eq!(actual["error"]["code"], *code, "{label}");
    } else {
        assert_eq!(actual["success"], json!(true), "{label}: {actual}");
        assert_eq!(actual["data"], expected["data"], "{label}");
    }
}

#[test]
fn the_refusal_is_the_catalog_code_and_there_are_no_language_gaps() {
    let vectors = vectors();
    assert_eq!(vectors["refusal"]["code"], error_codes::CALL_NOT_GRANTED);
    assert!(vectors["gaps"].as_object().unwrap().is_empty());
    assert!(!ExposeOptions::default().apps);
}

#[test]
fn the_default_serializes_as_before_and_apps_round_trips() {
    // Core manifest version 1 refuses an `apps` key even when false, so the default leaves it out.
    assert_eq!(
        serde_json::to_value(ExposeOptions::default()).unwrap(),
        json!({ "palette": true, "mcp": false, "agent": true, "cli": false })
    );
    let apps = ExposeOptions::default().with_apps(true);
    let value = serde_json::to_value(&apps).unwrap();
    assert_eq!(value["apps"], json!(true));
    assert_eq!(
        serde_json::from_value::<ExposeOptions>(value).unwrap(),
        apps
    );
}

#[test]
fn exposure() {
    let vectors = vectors();
    for case in vectors["exposure"].as_array().unwrap() {
        let label = case["description"].as_str().unwrap();
        let expose: ExposeOptions = if case["expose"].is_null() {
            ExposeOptions::default()
        } else {
            serde_json::from_value(case["expose"].clone()).unwrap()
        };
        for (surface, exposed) in case["exposed"].as_object().unwrap() {
            assert_eq!(
                expose.is_exposed_to(interface(surface)),
                exposed.as_bool().unwrap(),
                "{label}: {surface}"
            );
        }
    }
}

#[tokio::test]
async fn calls() {
    let vectors = vectors();
    let mut checked = 0;
    for case in vectors["calls"].as_array().unwrap() {
        let label = case["description"].as_str().unwrap();
        let call = &case["call"];
        let registry = registry(&vectors, case["grant"].as_str().unwrap());
        let result = registry
            .execute(
                call["name"].as_str().unwrap(),
                call["input"].clone(),
                Some(context(call["interface"].as_str(), call["caller"].as_str())),
            )
            .await;
        check(label, &result, &case["expect"], &vectors["refusal"]);
        checked += 1;
    }
    assert!(checked > 0);
}

#[tokio::test]
async fn batches() {
    let vectors = vectors();
    for case in vectors["batches"].as_array().unwrap() {
        let label = case["description"].as_str().unwrap();
        let registry = registry(&vectors, case["grant"].as_str().unwrap());
        let commands = case["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| BatchCommand::new(item["command"].as_str().unwrap(), item["input"].clone()))
            .collect();
        let mut request = BatchRequest::new(commands);
        if let Some(extra) = case.get("requestContext") {
            request.context = Some(serde_json::from_value(extra.clone()).unwrap());
        }
        let result = registry
            .execute_batch_with_context(
                request,
                context(case["interface"].as_str(), case["caller"].as_str()),
            )
            .await;
        let expected = case["expect"].as_array().unwrap();
        assert_eq!(result.results.len(), expected.len(), "{label}");
        for (index, (entry, expected)) in result.results.iter().zip(expected).enumerate() {
            check(
                &format!("{label}[{index}]"),
                &entry.result,
                expected,
                &vectors["refusal"],
            );
        }
    }
}

#[tokio::test]
async fn the_refusal_comes_before_the_middleware() {
    use std::sync::{Arc, Mutex};
    let vectors = vectors();
    let registry = registry(&vectors, "grants");
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let recorded = Arc::clone(&seen);
    registry.add_middleware(Arc::new(move |name, _input, context, next| {
        recorded.lock().unwrap().push(format!(
            "{name} {}",
            context.interface.map_or("none", CommandInterface::as_str)
        ));
        Box::pin(async move { next(context).await })
    }));
    for caller in ["checklist", "hello"] {
        registry
            .execute(
                "tally-get",
                json!({}),
                Some(context(Some("apps"), Some(caller))),
            )
            .await;
    }
    assert_eq!(*seen.lock().unwrap(), ["tally-get apps"]);
}
