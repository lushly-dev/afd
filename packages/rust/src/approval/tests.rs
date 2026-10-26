//! The approval gate: policies, the middleware and its token.

use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use super::token::{base64url_decode, base64url_encode, canonical_json, hmac_sha256, js_number};
use super::*;
use crate::{
    error_codes, fixed_clock, success, Actor, ActorKind, CommandDefinition, CommandHandler,
    CommandParameter, CommandRegistry, CommandResult, ManualClock,
};

const SECRET: &str = "test-approval-secret-0123456789abcdef";
const OTHER_SECRET: &str = "another-approval-secret-0123456789abcdef";
/// 2026-10-26T12:00:00.000Z
const START: i64 = 1_793_016_000_000;

/// Issued by TypeScript's `createApprovalMiddleware` with [`SECRET`] at [`START`] for
/// `todo-delete`, [`ts_input`] and [`agent`] (label `x`).
const TS_TOKEN: &str = "afdap1.eyJjIjoidG9kby1kZWxldGUiLCJpIjoiUm9CLWw1UHdtNkNkVnExQzNST3N5bG5WZmRwLTg2QmxKLVkycVpwQWlVSSIsImEiOiJpeUNTdElYTjUxQV9ndC1CZ1VRZFZyUy10ZU54YU5ER1Z5ZW1fX3VmczVFIiwiaWF0IjoxNzkzMDE2MDAwMDAwLCJleHAiOjE3OTMwMTYzMDAwMDAsIm4iOiJodWo0YTQtbmZkOXVZRmZ6Z0R1dFFBIn0.A2P1Bt8puCGai9lqYVR-5nemw3nKo4Fhjt42zSBGrKU";
/// The same, for `todo-delete` with `{ "id": 1 }` and no actor.
const TS_TOKEN_NO_ACTOR: &str = "afdap1.eyJjIjoidG9kby1kZWxldGUiLCJpIjoicUVsNlc3ZWYycWd0TjhUQ2o4b3JQQ0NtRkdfUGJ2WmI2UkM1MVFOcGZLVSIsImEiOiJvUHJDMDZTUkl6ZEtPNlUxR3F4T0pqbmEtT3pRc251SjVkOUpibUtFQS1jIiwiaWF0IjoxNzkzMDE2MDAwMDAwLCJleHAiOjE3OTMwMTYzMDAwMDAsIm4iOiJrOVlpXzc2MElqNERPYWFZam9GT1N3In0.jiR4ZS8yLRc1Ok2P9jTpc5T3wt4ev4qCl1O9Zv2LDDs";

fn ts_input() -> Value {
    json!({ "id": 42, "hard": false, "note": "é\u{2028}\u{1}\"\\", "tags": ["a", { "z": 1.5, "b": 1e21 }] })
}

fn agent() -> Actor {
    Actor::new(ActorKind::Agent)
        .with_id("advisor")
        .with_on_behalf_of("user-1")
}

struct Counting(Arc<AtomicUsize>);

#[async_trait]
impl CommandHandler for Counting {
    async fn execute(&self, input: Value, _: CommandContext) -> CommandResult<Value> {
        self.0.fetch_add(1, Ordering::SeqCst);
        success(input)
    }
}

struct Harness {
    registry: CommandRegistry,
    clock: ManualClock,
    handled: Arc<AtomicUsize>,
}

impl Harness {
    async fn call(
        &self,
        name: &str,
        input: Value,
        context: CommandContext,
    ) -> CommandResult<Value> {
        self.registry.execute(name, input, Some(context)).await
    }

    /// Call as [`agent`], with `token` as the approval evidence when given.
    async fn agent_call(
        &self,
        name: &str,
        input: Value,
        token: Option<&str>,
    ) -> CommandResult<Value> {
        let mut context = CommandContext::new().with_actor(agent());
        if let Some(token) = token {
            context = context.with_approval(token);
        }
        self.call(name, input, context).await
    }

    fn handled(&self) -> usize {
        self.handled.load(Ordering::SeqCst)
    }
}

/// A registry with a gated `todo-delete` and `todo-purge` and an ungated `todo-list`.
fn setup_with(
    policy: ApprovalPolicy,
    configure: impl FnOnce(ApprovalMiddlewareOptions) -> ApprovalMiddlewareOptions,
) -> Harness {
    setup_signed(SECRET, policy, configure)
}

/// [`setup_with`], signing with `secret`.
fn setup_signed(
    secret: &str,
    policy: ApprovalPolicy,
    configure: impl FnOnce(ApprovalMiddlewareOptions) -> ApprovalMiddlewareOptions,
) -> Harness {
    let handled = Arc::new(AtomicUsize::new(0));
    let clock = fixed_clock(START);
    let registry = CommandRegistry::new();
    let delete = CommandDefinition::new(
        "todo-delete",
        "Delete a todo permanently",
        vec![
            CommandParameter::required_number("id", "Todo ID"),
            CommandParameter::required_boolean("hard", "Hard delete").with_default(json!(false)),
        ],
        Counting(Arc::clone(&handled)),
    )
    .as_mutation()
    .with_destructive(true)
    .with_approval(policy);
    let purge = CommandDefinition::new(
        "todo-purge",
        "Purge todos",
        vec![CommandParameter::required_number("id", "Todo ID")],
        Counting(Arc::clone(&handled)),
    )
    .with_approval(ApprovalPolicy::Required);
    let list = CommandDefinition::new(
        "todo-list",
        "List todos",
        vec![],
        Counting(Arc::clone(&handled)),
    );
    for command in [delete, purge, list] {
        registry.register(command).unwrap();
    }
    let options = configure(
        ApprovalMiddlewareOptions::new(secret, registry.list()).with_clock(clock.clone()),
    );
    registry.add_middleware(create_approval_middleware(options).unwrap());
    Harness {
        registry,
        clock,
        handled,
    }
}

fn setup() -> Harness {
    setup_with(ApprovalPolicy::Required, |options| options)
}

fn details(result: &CommandResult<Value>) -> serde_json::Map<String, Value> {
    assert!(!result.success, "expected a failure, got {result:?}");
    let error = result.error.as_ref().unwrap();
    assert_eq!(error.code, error_codes::APPROVAL_REQUIRED, "{error:?}");
    assert_eq!(error.retryable, Some(false));
    error
        .details
        .clone()
        .unwrap()
        .into_iter()
        .collect::<serde_json::Map<_, _>>()
}

fn token_of(result: &CommandResult<Value>) -> String {
    details(result)["approvalToken"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn reason(result: &CommandResult<Value>) -> Option<String> {
    details(result)
        .get("reason")
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn payload_of(token: &str) -> Value {
    let payload = token.split('.').nth(1).unwrap();
    serde_json::from_slice(&base64url_decode(payload).unwrap()).unwrap()
}

/// Rewrite payload fields of a token without re-signing it.
fn tamper(token: &str, change: Value) -> String {
    let parts: Vec<&str> = token.split('.').collect();
    let mut payload = payload_of(token);
    for (key, value) in change.as_object().unwrap() {
        payload[key] = value.clone();
    }
    let encoded = base64url_encode(serde_json::to_string(&payload).unwrap().as_bytes());
    format!("{}.{encoded}.{}", parts[0], parts[2])
}

/// A token whose payload is `payload`, signed with [`SECRET`].
fn signed(payload: &str) -> String {
    let signing_input = format!("afdap1.{}", base64url_encode(payload.as_bytes()));
    let mac = base64url_encode(&hmac_sha256(SECRET.as_bytes(), signing_input.as_bytes()));
    format!("{signing_input}.{mac}")
}

// ─── Policies and reporting ───────────────────────────────────────────────────

#[tokio::test]
async fn runs_commands_with_no_policy_or_a_not_required_policy() {
    let harness = setup_with(ApprovalPolicy::NotRequired, |options| options);
    assert!(
        harness
            .agent_call("todo-list", json!({}), None)
            .await
            .success
    );
    assert!(
        harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await
            .success
    );
    assert_eq!(harness.handled(), 2);
}

#[tokio::test]
async fn holds_a_required_command_before_the_handler() {
    let harness = setup();
    let held = harness
        .agent_call("todo-delete", json!({ "id": 1 }), None)
        .await;
    let details = details(&held);
    assert_eq!(details["expiresAt"], "2026-10-26T12:05:00.000Z");
    assert_eq!(details["summary"], "Run todo-delete");
    assert!(details.get("reason").is_none());
    assert!(details["approvalToken"]
        .as_str()
        .unwrap()
        .starts_with("afdap1."));
    let error = held.error.unwrap();
    assert_eq!(error.message, "todo-delete needs approval before it runs");
    assert!(error
        .suggestion
        .unwrap()
        .ends_with("The token expires at 2026-10-26T12:05:00.000Z and works once."));
    assert_eq!(harness.handled(), 0);
}

#[tokio::test]
async fn runs_the_command_when_retried_with_the_token() {
    let harness = setup();
    let token = token_of(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    let result = harness
        .agent_call("todo-delete", json!({ "id": 1 }), Some(&token))
        .await;
    assert!(result.success, "{result:?}");
    assert_eq!(harness.handled(), 1);
}

#[tokio::test]
async fn binds_the_validated_input_so_defaults_and_key_order_do_not_matter() {
    let harness = setup();
    let token = token_of(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    let result = harness
        .agent_call(
            "todo-delete",
            json!({ "hard": false, "id": 1 }),
            Some(&token),
        )
        .await;
    assert!(result.success, "{result:?}");
}

#[tokio::test]
async fn evaluates_a_function_policy_against_the_input_and_context() {
    let policy = ApprovalPolicy::when(|input, context| {
        let human = context
            .actor
            .as_ref()
            .is_some_and(|actor| actor.kind == ActorKind::Human);
        if human || input["id"] == 0 {
            ApprovalDecision::NotRequired
        } else {
            ApprovalDecision::Required
        }
    });
    let harness = setup_with(policy, |options| options);
    details(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    assert!(
        harness
            .agent_call("todo-delete", json!({ "id": 0 }), None)
            .await
            .success
    );
    let human = CommandContext::new().with_actor(Actor::new(ActorKind::Human));
    assert!(
        harness
            .call("todo-delete", json!({ "id": 1 }), human)
            .await
            .success
    );
}

#[tokio::test]
async fn awaits_an_async_policy() {
    let policy = ApprovalPolicy::when_async(|input, _| {
        let id = input["id"].as_i64();
        Box::pin(async move {
            tokio::task::yield_now().await;
            if id == Some(0) {
                ApprovalDecision::NotRequired
            } else {
                ApprovalDecision::Required
            }
        })
    });
    let harness = setup_with(policy, |options| options);
    details(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    assert!(
        harness
            .agent_call("todo-delete", json!({ "id": 0 }), None)
            .await
            .success
    );
}

#[tokio::test]
async fn fails_closed_when_a_policy_panics_the_handler_does_not_run() {
    let harness = setup_with(
        ApprovalPolicy::when(|_, _| panic!("policy store unavailable")),
        |options| options,
    );
    let result = harness
        .agent_call("todo-delete", json!({ "id": 1 }), None)
        .await;
    assert_eq!(
        result.error.unwrap().code,
        error_codes::COMMAND_EXECUTION_ERROR
    );
    assert_eq!(harness.handled(), 0);
}

#[test]
fn reports_the_policy_mode() {
    assert_eq!(approval_mode(None), None);
    assert_eq!(
        approval_mode(Some(&ApprovalPolicy::Required)),
        Some(ApprovalMode::Required)
    );
    assert_eq!(
        approval_mode(Some(&ApprovalDecision::NotRequired.into())),
        Some(ApprovalMode::NotRequired)
    );
    let conditional = ApprovalPolicy::when(|_, _| ApprovalDecision::Required);
    assert_eq!(
        approval_mode(Some(&conditional)),
        Some(ApprovalMode::Conditional)
    );
    assert_eq!(json!(ApprovalMode::Conditional), "conditional");
    assert_eq!(json!(ApprovalDecision::NotRequired), "not-required");
    assert_eq!(format!("{conditional:?}"), "Conditional(..)");
}

#[tokio::test]
async fn reports_the_policy_in_tool_meta_afd_help_and_afd_docs() {
    let harness = setup();
    let registry = Arc::new(harness.registry);
    assert_eq!(
        registry.get_tool("todo-delete").unwrap()["_meta"],
        json!({ "approval": "required" })
    );
    assert!(registry
        .get_tool("todo-list")
        .unwrap()
        .get("_meta")
        .is_none());

    crate::register_bootstrap_commands(&registry).unwrap();
    let help = registry
        .execute("afd-help", json!({ "format": "full" }), None)
        .await;
    let commands = help.data.unwrap()["commands"].clone();
    let delete = commands
        .as_array()
        .unwrap()
        .iter()
        .find(|command| command["name"] == "todo-delete")
        .unwrap()
        .clone();
    assert_eq!(delete["approval"], "required");
    let docs = registry
        .execute("afd-docs", json!({ "command": "todo-delete" }), None)
        .await;
    assert!(docs.data.unwrap()["markdown"]
        .as_str()
        .unwrap()
        .contains("**Approval:** required"),);
}

// ─── Rejected tokens ──────────────────────────────────────────────────────────

#[tokio::test]
async fn rejects_a_token_whose_payload_was_changed() {
    let harness = setup();
    let token = token_of(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    let changed = tamper(&token, json!({ "exp": START + 86_400_000 }));
    let held = harness
        .agent_call("todo-delete", json!({ "id": 1 }), Some(&changed))
        .await;
    assert_eq!(reason(&held).as_deref(), Some("invalid-signature"));
    // The held result carries a fresh token.
    assert_ne!(token_of(&held), token);
    assert_eq!(harness.handled(), 0);
}

#[tokio::test]
async fn rejects_another_spelling_of_a_valid_signature() {
    let harness = setup();
    let token = token_of(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    // The MAC's last character carries two padding bits; flipping them decodes leniently to
    // the same bytes, and with padding appended likewise.
    let last = token.chars().last().unwrap();
    let index = BASE64URL_ALPHABET.find(last).unwrap();
    let flipped = BASE64URL_ALPHABET.chars().nth(index ^ 1).unwrap();
    let respelled = [
        format!("{}{flipped}", &token[..token.len() - 1]),
        format!("{token}="),
    ];
    for spelling in respelled {
        let held = harness
            .agent_call("todo-delete", json!({ "id": 1 }), Some(&spelling))
            .await;
        assert_eq!(
            reason(&held).as_deref(),
            Some("invalid-signature"),
            "{spelling}"
        );
    }
    assert_eq!(harness.handled(), 0);
}

const BASE64URL_ALPHABET: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

#[tokio::test]
async fn rejects_a_token_whose_signature_was_changed() {
    let harness = setup();
    let token = token_of(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    let (signing_input, mac) = token.rsplit_once('.').unwrap();
    let first = if mac.starts_with('A') { 'B' } else { 'A' };
    let changed = format!("{signing_input}.{first}{}", &mac[1..]);
    let held = harness
        .agent_call("todo-delete", json!({ "id": 1 }), Some(&changed))
        .await;
    assert_eq!(reason(&held).as_deref(), Some("invalid-signature"));
}

#[tokio::test]
async fn rejects_a_token_signed_with_another_secret() {
    let harness = setup();
    let other = setup_signed(OTHER_SECRET, ApprovalPolicy::Required, |options| options);
    let token = token_of(
        &other
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    let held = harness
        .agent_call("todo-delete", json!({ "id": 1 }), Some(&token))
        .await;
    assert_eq!(reason(&held).as_deref(), Some("invalid-signature"));
}

#[tokio::test]
async fn rejects_an_expired_token_by_the_middleware_clock() {
    let harness = setup();
    let token = token_of(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    harness.clock.advance(5 * 60_000);
    let held = harness
        .agent_call("todo-delete", json!({ "id": 1 }), Some(&token))
        .await;
    assert_eq!(reason(&held).as_deref(), Some("expired"));
    assert_eq!(details(&held)["expiresAt"], "2026-10-26T12:10:00.000Z");
    assert_eq!(harness.handled(), 0);
}

#[tokio::test]
async fn accepts_a_token_until_the_last_millisecond() {
    let harness = setup();
    let token = token_of(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    harness.clock.advance(5 * 60_000 - 1);
    assert!(
        harness
            .agent_call("todo-delete", json!({ "id": 1 }), Some(&token))
            .await
            .success
    );
}

#[tokio::test]
async fn rejects_a_token_for_another_command() {
    let harness = setup();
    let token = token_of(
        &harness
            .agent_call("todo-purge", json!({ "id": 1 }), None)
            .await,
    );
    let held = harness
        .agent_call("todo-delete", json!({ "id": 1 }), Some(&token))
        .await;
    assert_eq!(reason(&held).as_deref(), Some("command-mismatch"));
}

#[tokio::test]
async fn rejects_a_token_for_another_input() {
    let harness = setup();
    let token = token_of(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    let held = harness
        .agent_call("todo-delete", json!({ "id": 2 }), Some(&token))
        .await;
    assert_eq!(reason(&held).as_deref(), Some("input-mismatch"));
    // A default the caller overrides is part of the validated input.
    let harder = harness
        .agent_call(
            "todo-delete",
            json!({ "id": 1, "hard": true }),
            Some(&token),
        )
        .await;
    assert_eq!(reason(&harder).as_deref(), Some("input-mismatch"));
    assert_eq!(harness.handled(), 0);
}

#[tokio::test]
async fn rejects_a_token_for_another_actor() {
    let harness = setup();
    let token = token_of(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    let others = [
        agent().with_id("someone-else"),
        Actor {
            kind: ActorKind::Service,
            ..agent()
        },
        agent().with_on_behalf_of("user-2"),
        Actor {
            on_behalf_of: None,
            ..agent()
        },
    ];
    for actor in others {
        let context = CommandContext::new()
            .with_actor(actor.clone())
            .with_approval(&token);
        let held = harness
            .call("todo-delete", json!({ "id": 1 }), context)
            .await;
        assert_eq!(
            reason(&held).as_deref(),
            Some("actor-mismatch"),
            "{actor:?}"
        );
    }
    let anonymous = CommandContext::new().with_approval(&token);
    let held = harness
        .call("todo-delete", json!({ "id": 1 }), anonymous)
        .await;
    assert_eq!(reason(&held).as_deref(), Some("actor-mismatch"));
    assert_eq!(harness.handled(), 0);
}

#[tokio::test]
async fn rejects_a_token_issued_with_no_actor_presented_by_one() {
    let harness = setup();
    let held = harness
        .call("todo-delete", json!({ "id": 1 }), CommandContext::new())
        .await;
    let token = token_of(&held);
    let presented = harness
        .agent_call("todo-delete", json!({ "id": 1 }), Some(&token))
        .await;
    assert_eq!(reason(&presented).as_deref(), Some("actor-mismatch"));
    let anonymous = CommandContext::new().with_approval(&token);
    assert!(
        harness
            .call("todo-delete", json!({ "id": 1 }), anonymous)
            .await
            .success
    );
}

#[tokio::test]
async fn ignores_the_actor_label_which_is_display_text() {
    let harness = setup();
    let token = token_of(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    let context = CommandContext::new()
        .with_actor(agent().with_label("Claude (advisor)"))
        .with_approval(&token);
    assert!(
        harness
            .call("todo-delete", json!({ "id": 1 }), context)
            .await
            .success
    );
}

#[tokio::test]
async fn rejects_a_reused_single_use_token() {
    let harness = setup();
    let token = token_of(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    assert!(
        harness
            .agent_call("todo-delete", json!({ "id": 1 }), Some(&token))
            .await
            .success
    );
    let replay = harness
        .agent_call("todo-delete", json!({ "id": 1 }), Some(&token))
        .await;
    assert_eq!(reason(&replay).as_deref(), Some("already-used"));
    assert!(replay
        .error
        .unwrap()
        .suggestion
        .unwrap()
        .starts_with("The approval token was not accepted (already-used). "));
    assert_eq!(harness.handled(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn runs_only_one_of_two_concurrent_calls_with_one_single_use_token() {
    let harness = setup();
    let token = token_of(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    let (first, second) = tokio::join!(
        harness.agent_call("todo-delete", json!({ "id": 1 }), Some(&token)),
        harness.agent_call("todo-delete", json!({ "id": 1 }), Some(&token)),
    );
    assert_eq!(
        [first.success, second.success]
            .iter()
            .filter(|ok| **ok)
            .count(),
        1
    );
    assert_eq!(harness.handled(), 1);
}

#[tokio::test]
async fn rejects_malformed_evidence() {
    let harness = setup();
    let token = token_of(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    let parts: Vec<&str> = token.split('.').collect();
    let malformed = [
        String::new(),
        "afdap1".to_owned(),
        format!("afdap2.{}.{}", parts[1], parts[2]),
        format!("{token}.extra"),
        format!("afdap1.{}", parts[1]),
        format!("{token}{}", "A".repeat(1024)),
    ];
    for evidence in malformed {
        let held = harness
            .agent_call("todo-delete", json!({ "id": 1 }), Some(&evidence))
            .await;
        assert_eq!(reason(&held).as_deref(), Some("malformed"), "{evidence}");
    }
    assert_eq!(harness.handled(), 0);
}

#[tokio::test]
async fn rejects_a_validly_signed_payload_that_is_not_a_token() {
    let harness = setup();
    let not_tokens = [
        "[]",
        "null",
        "not json",
        r#"{"c":"todo-delete","i":"x","a":"y","iat":1,"n":"z"}"#,
        r#"{"c":"todo-delete","i":"x","a":"y","iat":"1","exp":9e15,"n":"z"}"#,
        r#"{"c":1,"i":"x","a":"y","iat":1,"exp":9e15,"n":"z"}"#,
    ];
    for payload in not_tokens {
        let evidence = signed(payload);
        let held = harness
            .agent_call("todo-delete", json!({ "id": 1 }), Some(&evidence))
            .await;
        assert_eq!(reason(&held).as_deref(), Some("malformed"), "{payload}");
    }
}

#[tokio::test]
async fn rejects_signed_digests_that_are_not_base64url() {
    let harness = setup();
    let payload = format!(
        r#"{{"c":"todo-delete","i":"not base64!","a":"x","iat":{START},"exp":{},"n":"z"}}"#,
        START + 60_000
    );
    let held = harness
        .agent_call("todo-delete", json!({ "id": 1 }), Some(&signed(&payload)))
        .await;
    assert_eq!(reason(&held).as_deref(), Some("input-mismatch"));
}

#[tokio::test]
async fn fails_an_input_it_cannot_bind_without_running_the_handler() {
    let harness = setup_with(ApprovalPolicy::Required, |options| options);
    // 2^53 + 1 reads as 2^53 in TypeScript, so it cannot be bound unambiguously.
    let result = harness
        .agent_call(
            "todo-delete",
            json!({ "id": 9_007_199_254_740_993_u64 }),
            None,
        )
        .await;
    assert_eq!(
        result.error.unwrap().code,
        error_codes::COMMAND_EXECUTION_ERROR
    );
    assert_eq!(harness.handled(), 0);
}

// ─── Options ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn within_ttl_lets_a_token_run_the_same_call_again_until_it_expires() {
    let harness = setup_with(ApprovalPolicy::Required, |options| {
        options.with_replay(ApprovalReplay::WithinTtl)
    });
    let held = harness
        .agent_call("todo-delete", json!({ "id": 1 }), None)
        .await;
    assert!(held
        .error
        .as_ref()
        .unwrap()
        .suggestion
        .as_ref()
        .unwrap()
        .ends_with("The token expires at 2026-10-26T12:05:00.000Z."));
    let token = token_of(&held);
    for _ in 0..2 {
        assert!(
            harness
                .agent_call("todo-delete", json!({ "id": 1 }), Some(&token))
                .await
                .success
        );
    }
    harness.clock.advance(5 * 60_000);
    let expired = harness
        .agent_call("todo-delete", json!({ "id": 1 }), Some(&token))
        .await;
    assert_eq!(reason(&expired).as_deref(), Some("expired"));
    assert_eq!(harness.handled(), 2);
}

/// A nonce store that answers `answer` and records what it was asked.
struct Store {
    answer: Option<bool>,
    seen: Mutex<HashSet<String>>,
    asked: Mutex<Vec<(String, i64)>>,
}

#[async_trait]
impl ApprovalNonceStore for Store {
    async fn consume(&self, nonce: &str, expires_at: i64) -> bool {
        self.asked
            .lock()
            .unwrap()
            .push((nonce.to_owned(), expires_at));
        match self.answer {
            Some(answer) => answer,
            None => self.seen.lock().unwrap().insert(nonce.to_owned()),
        }
    }
}

#[async_trait]
impl ApprovalNonceStore for Arc<Store> {
    async fn consume(&self, nonce: &str, expires_at: i64) -> bool {
        self.as_ref().consume(nonce, expires_at).await
    }
}

fn store(answer: Option<bool>) -> Arc<Store> {
    Arc::new(Store {
        answer,
        seen: Mutex::default(),
        asked: Mutex::default(),
    })
}

#[tokio::test]
async fn treats_false_from_a_supplied_store_as_used() {
    let harness = setup_with(ApprovalPolicy::Required, |options| {
        options.with_nonce_store(store(Some(false)))
    });
    let token = token_of(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    let held = harness
        .agent_call("todo-delete", json!({ "id": 1 }), Some(&token))
        .await;
    assert_eq!(reason(&held).as_deref(), Some("already-used"));
    assert_eq!(harness.handled(), 0);
}

#[tokio::test]
async fn records_nonces_in_a_supplied_store() {
    let shared = store(None);
    let harness = setup_with(ApprovalPolicy::Required, |options| {
        options.with_nonce_store(Arc::clone(&shared))
    });
    // A second middleware instance sharing the store: a token works once across both.
    let other = setup_with(ApprovalPolicy::Required, |options| {
        options.with_nonce_store(Arc::clone(&shared))
    });
    let token = token_of(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    assert!(
        harness
            .agent_call("todo-delete", json!({ "id": 1 }), Some(&token))
            .await
            .success
    );
    let replay = other
        .agent_call("todo-delete", json!({ "id": 1 }), Some(&token))
        .await;
    assert_eq!(reason(&replay).as_deref(), Some("already-used"));
    let asked = shared.asked.lock().unwrap().clone();
    let nonce = payload_of(&token)["n"].as_str().unwrap().to_owned();
    assert_eq!(
        asked,
        vec![(nonce.clone(), START + 300_000), (nonce, START + 300_000)]
    );
}

#[tokio::test]
async fn uses_summarize_then_the_confirm_prompt_for_the_summary() {
    let handled = Arc::new(AtomicUsize::new(0));
    let registry = CommandRegistry::new();
    for (name, prompt) in [
        ("todo-delete", Some("Delete this todo?")),
        ("todo-purge", None),
    ] {
        let id = vec![CommandParameter::required_number("id", "Todo ID")];
        let mut command = CommandDefinition::new(name, "Gated", id, Counting(Arc::clone(&handled)))
            .with_approval(ApprovalPolicy::Required);
        if let Some(prompt) = prompt {
            command = command.with_confirm_prompt(prompt);
        }
        registry.register(command).unwrap();
    }
    let summarized = |summarize: bool| {
        let options = ApprovalMiddlewareOptions::new(SECRET, registry.list());
        if summarize {
            options.with_summarize(|name, input, _| {
                (name == "todo-delete").then(|| format!("Delete todo {} (permanent)", input["id"]))
            })
        } else {
            options
        }
    };

    registry.add_middleware(create_approval_middleware(summarized(true)).unwrap());
    let held = registry
        .execute("todo-delete", json!({ "id": 42 }), None)
        .await;
    assert_eq!(details(&held)["summary"], "Delete todo 42 (permanent)");
    assert!(held
        .error
        .unwrap()
        .suggestion
        .unwrap()
        .starts_with("Ask the user to approve \"Delete todo 42 (permanent)\"; "));
    // summarize returned None: the confirm prompt, else `Run <command>`.
    let held = registry
        .execute("todo-purge", json!({ "id": 1 }), None)
        .await;
    assert_eq!(details(&held)["summary"], "Run todo-purge");

    // Without summarize, the confirm prompt. Called directly, outside the registry.
    let gate = create_approval_middleware(summarized(false)).unwrap();
    let next: crate::MiddlewareNext = Arc::new(|| Box::pin(async { success(json!(null)) }));
    let held = gate(
        "todo-delete".into(),
        json!({}),
        CommandContext::new(),
        Arc::clone(&next),
    )
    .await;
    assert_eq!(details(&held)["summary"], "Delete this todo?");
}

#[tokio::test]
async fn falls_back_to_the_default_summary_for_an_empty_one() {
    let harness = setup_with(ApprovalPolicy::Required, |options| {
        options.with_summarize(|_, _, _| Some(String::new()))
    });
    let held = harness
        .agent_call("todo-delete", json!({ "id": 1 }), None)
        .await;
    assert_eq!(details(&held)["summary"], "Run todo-delete");
}

#[tokio::test]
async fn can_leave_the_token_out_and_hand_it_to_on_approval_required() {
    let requests = Arc::new(Mutex::new(Vec::<ApprovalRequest>::new()));
    let sink = Arc::clone(&requests);
    let harness = setup_with(ApprovalPolicy::Required, move |options| {
        options
            .with_include_token(false)
            .with_on_approval_required(move |request| {
                sink.lock().unwrap().push(request);
                Box::pin(async {})
            })
    });
    let held = harness
        .agent_call("todo-delete", json!({ "id": 1 }), None)
        .await;
    let details = details(&held);
    assert!(details.get("approvalToken").is_none());
    assert!(held
        .error
        .unwrap()
        .suggestion
        .unwrap()
        .ends_with("the application retries the same call once it has recorded the approval."));
    let request = requests.lock().unwrap()[0].clone();
    assert_eq!(request.command, "todo-delete");
    assert_eq!(request.input, json!({ "id": 1, "hard": false }));
    assert_eq!(request.actor, Some(agent()));
    assert_eq!(request.expires_at, "2026-10-26T12:05:00.000Z");
    assert_eq!(request.summary, "Run todo-delete");
    assert_eq!(request.rejected, None);
    let result = harness
        .agent_call(
            "todo-delete",
            json!({ "id": 1 }),
            Some(&request.approval_token),
        )
        .await;
    assert!(result.success);
}

#[tokio::test]
async fn passes_the_rejection_to_on_approval_required() {
    let requests = Arc::new(Mutex::new(Vec::<ApprovalRequest>::new()));
    let sink = Arc::clone(&requests);
    let harness = setup_with(ApprovalPolicy::Required, move |options| {
        options.with_on_approval_required(move |request| {
            sink.lock().unwrap().push(request);
            Box::pin(async {})
        })
    });
    harness
        .agent_call("todo-delete", json!({ "id": 1 }), Some("garbage"))
        .await;
    assert_eq!(
        requests.lock().unwrap()[0].rejected,
        Some(ApprovalRejection::Malformed)
    );
}

#[tokio::test]
async fn verifies_tokens_signed_with_any_rotated_key_and_signs_with_the_first() {
    let old = setup_signed(OTHER_SECRET, ApprovalPolicy::Required, |options| options);
    let old_token = token_of(
        &old.agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    let rotated = setup_with(ApprovalPolicy::Required, |options| {
        options.with_previous_secret(OTHER_SECRET)
    });
    assert!(
        rotated
            .agent_call("todo-delete", json!({ "id": 1 }), Some(&old_token))
            .await
            .success
    );
    let new_token = token_of(
        &rotated
            .agent_call("todo-delete", json!({ "id": 2 }), None)
            .await,
    );
    let current = setup();
    assert!(
        current
            .agent_call("todo-delete", json!({ "id": 2 }), Some(&new_token))
            .await
            .success
    );
}

#[tokio::test]
async fn accepts_a_byte_secret() {
    let bytes = [7u8; 32];
    let handled = Arc::new(AtomicUsize::new(0));
    let registry = CommandRegistry::new();
    registry
        .register(
            CommandDefinition::new(
                "todo-delete",
                "Gated",
                vec![],
                Counting(Arc::clone(&handled)),
            )
            .with_approval(ApprovalPolicy::Required),
        )
        .unwrap();
    let options = ApprovalMiddlewareOptions::new(bytes, registry.list());
    registry.add_middleware(create_approval_middleware(options).unwrap());
    let held = registry.execute("todo-delete", json!({}), None).await;
    let context = CommandContext::new().with_approval(token_of(&held));
    assert!(
        registry
            .execute("todo-delete", json!({}), Some(context))
            .await
            .success
    );
}

#[tokio::test]
async fn never_takes_security_time_from_the_context_clock() {
    let harness = setup();
    let token = token_of(
        &harness
            .agent_call("todo-delete", json!({ "id": 1 }), None)
            .await,
    );
    harness.clock.advance(10 * 60_000);
    // A caller-supplied clock back at the issue time does not revive the token.
    let context = CommandContext::new()
        .with_actor(agent())
        .with_clock(fixed_clock(START))
        .with_approval(&token);
    let held = harness
        .call("todo-delete", json!({ "id": 1 }), context)
        .await;
    assert_eq!(reason(&held).as_deref(), Some("expired"));
}

#[tokio::test]
async fn never_holds_a_command_that_is_not_in_its_list() {
    let handled = Arc::new(AtomicUsize::new(0));
    let registry = CommandRegistry::new();
    let options = ApprovalMiddlewareOptions::new(SECRET, Vec::<CommandDefinition>::new());
    registry
        .register(
            CommandDefinition::new(
                "todo-delete",
                "Gated",
                vec![],
                Counting(Arc::clone(&handled)),
            )
            .with_approval(ApprovalPolicy::Required),
        )
        .unwrap();
    registry.add_middleware(create_approval_middleware(options).unwrap());
    assert!(
        registry
            .execute("todo-delete", json!({}), None)
            .await
            .success
    );
}

#[test]
fn requires_a_secret_of_at_least_32_bytes() {
    let none = Vec::<CommandDefinition>::new;
    let Err(error) = create_approval_middleware(ApprovalMiddlewareOptions::new("", none())) else {
        panic!("an empty secret was accepted");
    };
    assert_eq!(error, "Approval secret must be at least 32 bytes");
    assert!(create_approval_middleware(ApprovalMiddlewareOptions::new([0u8; 31], none())).is_err());
    assert!(create_approval_middleware(
        ApprovalMiddlewareOptions::new(SECRET, none()).with_previous_secret("short")
    )
    .is_err());
    assert!(create_approval_middleware(ApprovalMiddlewareOptions::new([0u8; 32], none())).is_ok());
}

#[test]
fn rejects_a_ttl_that_is_zero_or_exceeds_24_hours() {
    let none = Vec::<CommandDefinition>::new;
    for ttl in [0, 24 * 60 * 60_000 + 1] {
        let options = ApprovalMiddlewareOptions::new(SECRET, none()).with_ttl_ms(ttl);
        assert!(create_approval_middleware(options).is_err(), "{ttl}");
    }
    let options = ApprovalMiddlewareOptions::new(SECRET, none()).with_ttl_ms(24 * 60 * 60_000);
    assert!(create_approval_middleware(options).is_ok());
}

#[test]
fn never_prints_the_secret() {
    let options = ApprovalMiddlewareOptions::new(SECRET, Vec::<CommandDefinition>::new());
    assert!(!format!("{options:?}").contains(SECRET));
}

// ─── Cross-language tokens ────────────────────────────────────────────────────

/// The approval middleware alone, over a handler that counts its calls.
struct Direct {
    gate: crate::CommandMiddleware,
    handled: Arc<AtomicUsize>,
}

impl Direct {
    fn new() -> Self {
        let handled = Arc::new(AtomicUsize::new(0));
        let command = CommandDefinition::new(
            "todo-delete",
            "Gated",
            vec![],
            Counting(Arc::clone(&handled)),
        )
        .with_approval(ApprovalPolicy::Required);
        let options =
            ApprovalMiddlewareOptions::new(SECRET, [command]).with_clock(fixed_clock(START));
        Self {
            gate: create_approval_middleware(options).unwrap(),
            handled,
        }
    }

    async fn call(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let handled = Arc::clone(&self.handled);
        let next: crate::MiddlewareNext = Arc::new(move || {
            handled.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { success(json!(null)) })
        });
        (self.gate)("todo-delete".into(), input, context, next).await
    }
}

#[tokio::test]
async fn verifies_a_token_issued_by_typescript() {
    let direct = Direct::new();
    let context = CommandContext::new()
        .with_actor(agent().with_label("x"))
        .with_approval(TS_TOKEN);
    let result = direct.call(ts_input(), context).await;
    assert!(result.success, "{result:?}");

    let anonymous = CommandContext::new().with_approval(TS_TOKEN_NO_ACTOR);
    let result = direct.call(json!({ "id": 1 }), anonymous).await;
    assert!(result.success, "{result:?}");
    assert_eq!(direct.handled.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn issues_the_same_digests_and_layout_as_typescript() {
    let direct = Direct::new();
    let held = direct
        .call(ts_input(), CommandContext::new().with_actor(agent()))
        .await;
    let token = token_of(&held);
    let (ours, theirs) = (payload_of(&token), payload_of(TS_TOKEN));
    for field in ["c", "i", "a", "iat", "exp"] {
        assert_eq!(ours[field], theirs[field], "{field}");
    }
    // The payload's key order and spelling, as `JSON.stringify` writes it.
    let payload = base64url_decode(token.split('.').nth(1).unwrap()).unwrap();
    let nonce = ours["n"].as_str().unwrap();
    assert_eq!(nonce.len(), 22);
    assert_eq!(
        String::from_utf8(payload).unwrap(),
        format!(
            r#"{{"c":"todo-delete","i":{},"a":{},"iat":1793016000000,"exp":1793016300000,"n":"{nonce}"}}"#,
            theirs["i"], theirs["a"]
        )
    );
}

#[test]
fn writes_numbers_as_javascript_does() {
    // From `canonicalJson` in TypeScript.
    let cases: [(f64, &str); 18] = [
        (0.0, "0"),
        (-0.0, "0"),
        (1.0, "1"),
        (-1.0, "-1"),
        (1.5, "1.5"),
        (0.1, "0.1"),
        (1e21, "1e+21"),
        (1e20, "100000000000000000000"),
        (123_456_789_012_345_680_000.0, "123456789012345680000"),
        (1e-7, "1e-7"),
        (1.5e-7, "1.5e-7"),
        (0.000_001, "0.000001"),
        (5e-324, "5e-324"),
        (1.797_693_134_862_315_7e308, "1.7976931348623157e+308"),
        (-2.5e-10, "-2.5e-10"),
        (1.0 / 3.0, "0.3333333333333333"),
        (100.0, "100"),
        (1e300, "1e+300"),
    ];
    for (value, expected) in cases {
        assert_eq!(js_number(value), expected, "{value}");
        assert_eq!(canonical_json(&json!(value)).unwrap(), expected, "{value}");
    }
    // Exact ties between two shortest spellings go to the even digit, as ECMAScript requires.
    for (text, expected) in [
        ("662936471232937.25", "662936471232937.2"),
        ("1658206780088562.25", "1658206780088562.2"),
    ] {
        assert_eq!(js_number(text.parse().unwrap()), expected, "{text}");
    }
    assert_eq!(
        canonical_json(&json!(9_007_199_254_740_992_u64)).unwrap(),
        "9007199254740992"
    );
    assert_eq!(
        canonical_json(&json!(1_u64 << 60)).unwrap(),
        "1152921504606847000"
    );
    assert_eq!(
        canonical_json(&json!(-(1_i64 << 60))).unwrap(),
        "-1152921504606847000"
    );
    assert_eq!(
        canonical_json(&json!(i64::MIN)).unwrap(),
        "-9223372036854776000"
    );
    assert!(canonical_json(&json!(9_007_199_254_740_993_u64)).is_err());
    assert!(canonical_json(&json!(u64::MAX)).is_err());
    assert!(canonical_json(&json!([{ "a": i64::MAX }])).is_err());
}

#[test]
fn parses_floats_as_javascript_does() {
    // serde_json's default float parsing reads these as the neighbouring double.
    for text in ["985.6906946328695", "47960.756426982596"] {
        let value: Value = serde_json::from_str(text).unwrap();
        assert_eq!(canonical_json(&value).unwrap(), text);
    }
}

#[test]
fn never_prints_approval_evidence() {
    let context = CommandContext::new().with_approval("afdap1.secret.mac");
    let printed = format!("{context:?}");
    assert!(!printed.contains("afdap1"), "{printed}");
    assert!(printed.contains("[redacted]"));
}

#[test]
fn sorts_object_keys_by_utf16_code_units_at_every_depth() {
    let value = json!({ "\u{1F600}": 1, "\u{FFFF}": 2, "b": 3, "B": 4, "10": 5, "9": 6 });
    assert_eq!(
        canonical_json(&value).unwrap(),
        "{\"10\":5,\"9\":6,\"B\":4,\"b\":3,\"\u{1F600}\":1,\"\u{FFFF}\":2}"
    );
    let nested = json!({ "z": [{ "b": null, "a": true }], "a": "\u{1}\n\"" });
    assert_eq!(
        canonical_json(&nested).unwrap(),
        r#"{"a":"\u0001\n\"","z":[{"a":true,"b":null}]}"#
    );
}

#[test]
fn base64url_round_trips_and_accepts_one_spelling() {
    for length in 0..40 {
        let bytes: Vec<u8> = (0..length).map(|i| (i * 37 + 11) as u8).collect();
        let encoded = base64url_encode(&bytes);
        assert!(!encoded.contains('='));
        assert_eq!(base64url_decode(&encoded), Some(bytes));
    }
    assert_eq!(base64url_encode(b"\xfb\xff"), "-_8");
    assert_eq!(base64url_decode("-_8"), Some(b"\xfb\xff".to_vec()));
    // Non-zero padding bits, padding, a dangling character, the standard alphabet.
    for spelling in ["-_9", "-_8=", "A", "+/8", "ab c"] {
        assert_eq!(base64url_decode(spelling), None, "{spelling}");
    }
}
