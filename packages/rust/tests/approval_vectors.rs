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
    ApprovalMiddlewareOptions, ApprovalPolicy, ApprovalRelay, ApprovalReplay, CommandContext,
    CommandDefinition, CommandHandler, CommandInterface, CommandMiddleware, CommandResult,
    MiddlewareNext,
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
    if let Some(include_token) = case.get("includeToken").and_then(Value::as_bool) {
        options = options.with_include_token(include_token);
    }
    if case.get("relay").and_then(Value::as_str) == Some("mcp-elicitation") {
        options = options.with_relay(ApprovalRelay::McpElicitation);
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
    interface: Option<&str>,
) -> CommandResult<Value> {
    let mut context = CommandContext::new();
    if let Some(name) = actor.as_str() {
        let actor: Actor = serde_json::from_value(vectors["actors"][name].clone()).unwrap();
        context = context.with_actor(actor);
    }
    if let Some(token) = token {
        context = context.with_approval(token);
    }
    if let Some(interface) = interface {
        let iface: CommandInterface = serde_json::from_value(json!(interface)).unwrap();
        context = context.with_interface(iface);
    }
    let next: MiddlewareNext = Arc::new(|_context| Box::pin(async { success(json!("ran")) }));
    middleware(
        command.as_str().unwrap().to_owned(),
        Arc::new(input.clone()),
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
            None,
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
                None,
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

#[tokio::test]
async fn token_delivery_follows_rule_6_as_the_vectors_expect() {
    let vectors = load_vectors();
    let mut failures = Vec::new();
    for case in vectors["tokenDelivery"].as_array().unwrap() {
        let middleware = gate(&vectors, case);
        let result = call(
            &vectors,
            &middleware,
            &case["command"],
            &case["input"],
            &case["actor"],
            None,
            case["interface"].as_str(),
        )
        .await;
        let error = result.error.as_ref().expect("held call fails");
        assert_eq!(error.code, "APPROVAL_REQUIRED");
        let details = error.details.as_ref().expect("held error carries details");
        let expected = case["expectedHasToken"].as_bool().unwrap();
        if expected {
            if !details.get("approvalToken").is_some_and(Value::is_string) {
                failures.push(format!(
                    "{}: expected string approvalToken, got {:?}",
                    case["description"],
                    details.get("approvalToken")
                ));
            }
        } else if details.contains_key("approvalToken") {
            failures.push(format!(
                "{}: expected approvalToken key to be absent, got {:?}",
                case["description"],
                details.get("approvalToken")
            ));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

/// Each binding's `inputDigest` and `approvalId` (`spec/command-metadata.md`, "The approval
/// summary"): what `input_digest` and `approval_id` compute, and what the summary of the call its
/// token admits carries. And each `approvalIds` entry's id, from its single-use key.
#[tokio::test]
async fn summaries_carry_each_bindings_input_digest_and_approval_id() {
    let vectors = load_vectors();
    let mut failures = Vec::new();
    for binding in vectors["bindings"].as_array().unwrap() {
        let description = binding["description"].as_str().unwrap();
        let digest = afd::input_digest(&binding["input"]).unwrap();
        if digest != binding["inputDigest"] {
            failures.push(format!("{description}: input_digest {digest}"));
        }
        let id = afd::approval_id(binding["nonce"].as_str().unwrap());
        if id != binding["approvalId"] {
            failures.push(format!("{description}: approval_id {id}"));
        }

        let seen: Arc<std::sync::Mutex<Vec<afd::ApprovalSummary>>> = Arc::default();
        let noted = Arc::clone(&seen);
        let commands: Vec<CommandDefinition> = vectors["commands"]
            .as_array()
            .unwrap()
            .iter()
            .map(|name| {
                let name = name.as_str().unwrap();
                CommandDefinition::new(name, name, vec![], Ran)
                    .with_approval(ApprovalPolicy::Required)
            })
            .collect();
        let options = ApprovalMiddlewareOptions::new(
            vectors["secrets"]["current"].as_str().unwrap(),
            &commands,
        )
        .with_clock(fixed_clock(vectors["now"].as_i64().unwrap()))
        .with_on_approval_accepted(move |summary, _dispatch_id| {
            noted.lock().unwrap().push(summary);
            Box::pin(async { Ok(()) })
        });
        let middleware = create_approval_middleware(options).unwrap();
        let accepted = call(
            &vectors,
            &middleware,
            &binding["command"],
            &binding["input"],
            &binding["actor"],
            binding["token"].as_str(),
            None,
        )
        .await;
        if outcome(&accepted) != "accepted" {
            failures.push(format!("{description}: {}", outcome(&accepted)));
            continue;
        }
        let summaries = seen.lock().unwrap().clone();
        let [summary] = &summaries[..] else {
            failures.push(format!("{description}: {} summaries", summaries.len()));
            continue;
        };
        let summary = serde_json::to_value(summary).unwrap();
        for member in ["inputDigest", "approvalId", "command"] {
            if summary[member] != binding[member] {
                failures.push(format!(
                    "{description}: summary {member} {}",
                    summary[member]
                ));
            }
        }
    }
    for entry in vectors["approvalIds"].as_array().unwrap() {
        let id = afd::approval_id(entry["singleUseKey"].as_str().unwrap());
        if id != entry["approvalId"] {
            failures.push(format!("{}: approval_id {id}", entry["description"]));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}
