//! The language-neutral vectors in `spec/vectors/approval-tokens.json`.
//!
//! `spec/vectors/generate-approval-tokens.mjs` builds them from the documented token format, with
//! canonical JSON from the TypeScript reference, so a Rust token verifies in every other language
//! and theirs verify here (`spec/command-metadata.md`, "Approvals"; `spec/vectors/README.md`).
#![cfg(feature = "approval")]

use std::path::PathBuf;
use std::sync::Arc;

use afd::{
    canonical_json, create_approval_middleware, fixed_clock, success, Actor,
    ApprovalMiddlewareOptions, ApprovalPolicy, ApprovalReplay, CommandContext, CommandDefinition,
    CommandHandler, CommandMiddleware, CommandResult, MiddlewareNext,
};
use async_trait::async_trait;
use serde_json::{json, Value};

fn load_vectors() -> Value {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/vectors/approval-tokens.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("{} is not valid JSON: {error}", path.display()))
}

struct Ran;

#[async_trait]
impl CommandHandler for Ran {
    async fn execute(&self, _: Value, _: CommandContext) -> CommandResult<Value> {
        success(json!("ran"))
    }
}

/// One middleware, as a case configures it: `secrets` (the first signs), `now` and `replay`.
fn gate(vectors: &Value, case: &Value) -> CommandMiddleware {
    let names: Vec<String> = case["secrets"]
        .as_array()
        .map(|names| {
            names
                .iter()
                .map(|name| name.as_str().unwrap().to_owned())
                .collect()
        })
        .unwrap_or_else(|| vec!["current".to_owned()]);
    let secret = |name: &str| vectors["secrets"][name].as_str().unwrap().to_owned();
    let commands: Vec<CommandDefinition> = vectors["commands"]
        .as_array()
        .unwrap()
        .iter()
        .map(|name| {
            let name = name.as_str().unwrap();
            CommandDefinition::new(name, name, vec![], Ran).with_approval(ApprovalPolicy::Required)
        })
        .collect();
    let now = case["now"]
        .as_i64()
        .unwrap_or_else(|| vectors["now"].as_i64().unwrap());
    let mut options =
        ApprovalMiddlewareOptions::new(secret(&names[0]), &commands).with_clock(fixed_clock(now));
    for name in &names[1..] {
        options = options.with_previous_secret(secret(name));
    }
    if case["replay"] == "within-ttl" {
        options = options.with_replay(ApprovalReplay::WithinTtl);
    }
    create_approval_middleware(options).unwrap()
}

async fn call(
    vectors: &Value,
    middleware: &CommandMiddleware,
    command: &Value,
    input: &Value,
    actor: &Value,
    token: Option<&str>,
) -> CommandResult<Value> {
    let mut context = CommandContext::new();
    if let Some(name) = actor.as_str() {
        let actor: Actor = serde_json::from_value(vectors["actors"][name].clone()).unwrap();
        context = context.with_actor(actor);
    }
    if let Some(token) = token {
        context = context.with_approval(token);
    }
    let next: MiddlewareNext = Arc::new(|| Box::pin(async { success(json!("ran")) }));
    middleware(
        command.as_str().unwrap().to_owned(),
        input.clone(),
        context,
        next,
    )
    .await
}

fn outcome(result: &CommandResult<Value>) -> String {
    if result.success {
        return "accepted".to_owned();
    }
    let error = result.error.as_ref().unwrap();
    assert_eq!(error.code, "APPROVAL_REQUIRED", "{error:?}");
    error
        .details
        .as_ref()
        .and_then(|details| details.get("reason"))
        .and_then(Value::as_str)
        .unwrap_or("held")
        .to_owned()
}

/// Unpadded base64url, as the token uses it.
fn base64url_decode(text: &str) -> Vec<u8> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut bits = 0u32;
    let mut count = 0;
    let mut out = Vec::new();
    for byte in text.bytes() {
        let value = ALPHABET.iter().position(|&c| c == byte).unwrap() as u32;
        bits = (bits << 6) | value;
        count += 6;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
            bits &= (1 << count) - 1;
        }
    }
    out
}

fn payload_of(token: &str) -> String {
    String::from_utf8(base64url_decode(token.split('.').nth(1).unwrap())).unwrap()
}

#[tokio::test]
async fn bindings_canonicalize_issue_and_verify_as_the_vectors_do() {
    let vectors = load_vectors();
    let mut failures = Vec::new();
    for binding in vectors["bindings"].as_array().unwrap() {
        let description = binding["description"].as_str().unwrap();
        let canonical = canonical_json(&binding["input"]).unwrap();
        if canonical != binding["canonicalInput"] {
            failures.push(format!("{description}: canonical JSON {canonical}"));
        }

        let middleware = gate(&vectors, &Value::Null);
        let held = call(
            &vectors,
            &middleware,
            &binding["command"],
            &binding["input"],
            &binding["actor"],
            None,
        )
        .await;
        let token = held.error.as_ref().unwrap().details.as_ref().unwrap()["approvalToken"]
            .as_str()
            .unwrap()
            .to_owned();
        let payload = payload_of(&token);
        let nonce = serde_json::from_str::<Value>(&payload).unwrap()["n"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(base64url_decode(&nonce).len(), 16, "{description}");
        let expected = binding["payload"]
            .as_str()
            .unwrap()
            .replace(binding["nonce"].as_str().unwrap(), &nonce);
        if payload != expected {
            failures.push(format!("{description}: issued {payload}"));
        }

        let accepted = call(
            &vectors,
            &middleware,
            &binding["command"],
            &binding["input"],
            &binding["actor"],
            binding["token"].as_str(),
        )
        .await;
        if outcome(&accepted) != "accepted" {
            failures.push(format!("{description}: {}", outcome(&accepted)));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

#[tokio::test]
async fn tokens_verify_as_the_vectors_expect() {
    let vectors = load_vectors();
    let mut failures = Vec::new();
    for case in vectors["verify"].as_array().unwrap() {
        let middleware = gate(&vectors, case);
        let mut outcomes = Vec::new();
        for _ in case["expected"].as_array().unwrap() {
            let result = call(
                &vectors,
                &middleware,
                &case["command"],
                &case["input"],
                &case["actor"],
                case["token"].as_str(),
            )
            .await;
            outcomes.push(Value::from(outcome(&result)));
        }
        if Value::from(outcomes.clone()) != case["expected"] {
            failures.push(format!("{}: {outcomes:?}", case["description"]));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}
