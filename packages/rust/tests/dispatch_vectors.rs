//! Single-command dispatch-order vectors (`spec/dispatch.md`, `spec/vectors/dispatch.json`).
//!
//! Runs every registry case through `CommandRegistry::execute` and, when the `server` feature is
//! enabled, every MCP case through `McpServer::with_confirmations`. Known Rust gaps declared in
//! `spec/vectors/dispatch.json`'s `gaps.rust` (`stamping`, `hooks`) are
//! verified present and skipped until their tracking issues close.

#[cfg(feature = "server")]
mod common;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use afd::context_fields::ContextField;
#[cfg(feature = "approval")]
use afd::{create_approval_middleware, ApprovalMiddlewareOptions};
use afd::{
    register_context_commands, success, Actor, ActorKind, ApprovalDecision, CommandContext,
    CommandDefinition, CommandHandler, CommandInterface, CommandMiddleware, CommandRegistry,
    CommandResult, ContextConfig, ExposeOptions,
};
use async_trait::async_trait;
use serde_json::{json, Value};

fn vectors() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/vectors/dispatch.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    serde_json::from_str(&text).expect("valid dispatch.json")
}

struct ScriptedHandler {
    behavior: String,
    hooks: Arc<Mutex<Vec<String>>>,
}

#[async_trait]
impl CommandHandler for ScriptedHandler {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        self.hooks.lock().unwrap().push("handler".to_string());
        if self.behavior == "throw" {
            panic!("sensitive handler crash at /srv/secret");
        }
        success(input)
    }
}

fn interface_from(name: &str) -> CommandInterface {
    serde_json::from_value(json!(name)).unwrap_or_else(|error| panic!("interface {name}: {error}"))
}

fn actor_kind_from(name: &str) -> ActorKind {
    serde_json::from_value(json!(name)).unwrap_or_else(|error| panic!("actorKind {name}: {error}"))
}

fn build_registry(
    vectors: &Value,
    case: &Value,
    hooks: Arc<Mutex<Vec<String>>>,
) -> CommandRegistry {
    let surface = case["surface"].as_str().unwrap();
    let registry = CommandRegistry::new();
    for cmd in vectors["setup"]["commands"].as_array().unwrap() {
        let name = cmd["name"].as_str().unwrap();
        let description = cmd["description"].as_str().unwrap();
        let version = cmd["version"].as_str().unwrap();
        let expose: ExposeOptions = serde_json::from_value(cmd["expose"].clone()).unwrap();
        let mut def = CommandDefinition::new(
            name,
            description,
            vec![],
            ScriptedHandler {
                behavior: cmd["behavior"].as_str().unwrap().to_string(),
                hooks: Arc::clone(&hooks),
            },
        )
        .with_version(version)
        .with_expose(expose);
        if let Some(contexts) = cmd.get("contexts").and_then(Value::as_array) {
            def = def.with_contexts(
                contexts
                    .iter()
                    .map(|value| value.as_str().unwrap().to_string())
                    .collect::<Vec<_>>(),
            );
        }
        if let Some(prompt) = cmd.get("confirmPrompt").and_then(Value::as_str) {
            def = def.with_confirm_prompt(prompt);
        }
        if let Some("required") = cmd.get("approval").and_then(Value::as_str) {
            def = def.with_approval(ApprovalDecision::Required);
        }
        registry
            .register_with_schema(def, cmd["input"].clone())
            .unwrap();
    }

    // `setup.contextCommands: "plain"` (registry surface only): the context commands as plain
    // commands, with no tool surface and no bootstrap or help commands.
    if surface == "registry" && vectors["setup"]["contextCommands"] == json!("plain") {
        let contexts = vectors["setup"]["contexts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|name| ContextConfig::new(name.as_str().unwrap()))
            .collect();
        register_context_commands(&registry, contexts).unwrap();
    }

    if case.get("withContextFields").and_then(Value::as_bool) == Some(true) {
        let fields: Vec<ContextField> = vectors["setup"]["contextFields"]
            .as_array()
            .unwrap()
            .iter()
            .map(|field| {
                let mut cf = ContextField::new(
                    field["name"].as_str().unwrap(),
                    field["meta"].as_str().unwrap(),
                    field["schema"].clone(),
                );
                if field.get("required").and_then(Value::as_bool) == Some(true) {
                    cf = cf.with_required(true);
                }
                cf
            })
            .collect();
        registry.set_context_fields(fields).unwrap();
    }

    if case.get("middleware").and_then(Value::as_str) == Some("throw") {
        let h = Arc::clone(&hooks);
        let mw: CommandMiddleware = Arc::new(move |_, _, _, _| {
            let h = Arc::clone(&h);
            Box::pin(async move {
                h.lock().unwrap().push("mw1:before".to_string());
                panic!("sensitive middleware crash at /srv/secret");
            })
        });
        registry.add_middleware(mw);
    } else {
        let h1 = Arc::clone(&hooks);
        let mw1: CommandMiddleware = Arc::new(move |_name, _, context, next| {
            let h1 = Arc::clone(&h1);
            Box::pin(async move {
                h1.lock().unwrap().push("mw1:before".to_string());
                let res = next(context).await;
                h1.lock().unwrap().push("mw1:after".to_string());
                res
            })
        });
        let h2 = Arc::clone(&hooks);
        let mw2: CommandMiddleware = Arc::new(move |_name, _, context, next| {
            let h2 = Arc::clone(&h2);
            Box::pin(async move {
                h2.lock().unwrap().push("mw2:before".to_string());
                let res = next(context).await;
                h2.lock().unwrap().push("mw2:after".to_string());
                res
            })
        });
        registry.add_middleware(mw1);
        #[cfg(feature = "approval")]
        if case.get("withApprovalMiddleware").and_then(Value::as_bool) == Some(true) {
            let approval = create_approval_middleware(ApprovalMiddlewareOptions::new(
                "dispatch-vector-test-secret-key-32b",
                registry.list(),
            ))
            .expect("approval middleware");
            registry.add_middleware(approval);
        }
        registry.add_middleware(mw2);
    }

    registry
}

#[test]
fn rust_gaps_are_documented() {
    let vectors = vectors();
    let gaps = vectors["gaps"]["rust"].as_object().expect("gaps.rust");
    assert_eq!(
        gaps.get("stamping").and_then(Value::as_str),
        Some("https://github.com/lushly-dev/afd/issues/546")
    );
    assert_eq!(
        gaps.get("hooks").and_then(Value::as_str),
        Some("https://github.com/lushly-dev/afd/issues/546")
    );
}

#[tokio::test]
async fn registry_dispatch_vectors() {
    let vectors = vectors();
    let gaps = vectors["gaps"]["rust"].as_object().expect("gaps.rust");
    let mut executed = 0;

    for case in vectors["cases"].as_array().unwrap() {
        if case["surface"].as_str() != Some("registry") {
            continue;
        }
        let id = case["id"].as_str().unwrap();
        if let Some(gap) = case.get("gap").and_then(Value::as_str) {
            if gaps.contains_key(gap) {
                continue;
            }
        }
        #[cfg(not(feature = "approval"))]
        if case.get("withApprovalMiddleware").and_then(Value::as_bool) == Some(true) {
            continue;
        }

        let hooks = Arc::new(Mutex::new(Vec::<String>::new()));
        let registry = build_registry(&vectors, case, Arc::clone(&hooks));
        let call = &case["call"];
        let mut context = CommandContext::new();
        if let Some(iface) = call.get("interface").and_then(Value::as_str) {
            context = context.with_interface(interface_from(iface));
        }
        if let Some(active) = call.get("activeContext").and_then(Value::as_str) {
            context = context.with_active_context(active);
        }
        if let Some(trace_id) = call.get("traceId").and_then(Value::as_str) {
            context = context.with_trace_id(trace_id);
        }
        if let Some(kind) = call.get("actorKind").and_then(Value::as_str) {
            context = context.with_actor(Actor::new(actor_kind_from(kind)));
        }
        if let Some(fields) = call.get("contextFields").and_then(Value::as_object) {
            for (k, v) in fields {
                context = context.with_extra(k, v.clone());
            }
        }

        let result = registry
            .execute(
                call["command"].as_str().unwrap(),
                call["input"].clone(),
                Some(context),
            )
            .await;

        let expected = &case["expect"];
        assert_eq!(
            result.success,
            expected["success"].as_bool().unwrap(),
            "{id}"
        );
        if let Some(code) = expected.get("code").and_then(Value::as_str) {
            assert_eq!(result.error.as_ref().expect(id).code, code, "{id}");
        }
        if let Some(retryable) = expected.get("retryable").and_then(Value::as_bool) {
            assert_eq!(
                result.error.as_ref().expect(id).retryable,
                Some(retryable),
                "{id}"
            );
        }
        if let Some(message) = expected.get("message").and_then(Value::as_str) {
            assert_eq!(result.error.as_ref().expect(id).message, message, "{id}");
        }
        // `null` is no recovery (`spec/recovery.md`, "Engine errors").
        if let Some(recovery) = expected.get("recovery") {
            assert_eq!(
                serde_json::to_value(&result.error.as_ref().expect(id).recovery).unwrap(),
                *recovery,
                "{id}"
            );
        }
        if let Some(data) = expected.get("data") {
            assert_eq!(result.data.as_ref(), Some(data), "{id}");
        }
        let expected_hooks: Vec<String> = expected["hooks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap().to_string())
            .collect();
        assert_eq!(*hooks.lock().unwrap(), expected_hooks, "{id}");

        // Rust stamps actorKind today; executionTimeMs/commandVersion/traceId are tracked in #546.
        if let Some(stamped) = expected.get("stamped").and_then(Value::as_array) {
            if stamped.iter().any(|item| item == "actorKind") {
                if let Some(kind) = call.get("actorKind").and_then(Value::as_str) {
                    assert_eq!(
                        result.metadata.as_ref().and_then(|m| m.actor_kind),
                        Some(actor_kind_from(kind)),
                        "{id} actorKind"
                    );
                }
            }
        }
        executed += 1;
    }

    assert!(
        executed >= 12,
        "expected at least 12 registry cases to run, ran {executed}"
    );
}

#[cfg(feature = "server")]
#[tokio::test]
async fn mcp_dispatch_vectors() {
    use afd::server::{ConfirmationMode, McpServer};
    use common::modern_post;

    let vectors = vectors();
    let mut executed = 0;

    for case in vectors["cases"].as_array().unwrap() {
        if case["surface"].as_str() != Some("mcp") {
            continue;
        }
        let id = case["id"].as_str().unwrap();
        let hooks = Arc::new(Mutex::new(Vec::<String>::new()));
        let registry = build_registry(&vectors, case, Arc::clone(&hooks));
        let server = McpServer::new(Arc::new(registry), "dispatch-vectors", "1.0.0")
            .with_confirmations(ConfirmationMode::Enforce);

        let call = &case["call"];
        let mut args = json!({
            "command": call["command"],
            "input": call["input"],
        });
        if let Some(confirm) = call.get("confirm") {
            args["confirm"] = confirm.clone();
        }
        let response = modern_post(
            &server,
            "tools/call",
            json!({ "name": "afd-call", "arguments": args }),
            &[],
        )
        .await;
        let text = response["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or_else(|| panic!("{id}: missing text content in {response}"));
        let result: Value = serde_json::from_str(text).expect("JSON CommandResult");

        let expected = &case["expect"];
        assert_eq!(result["success"], expected["success"], "{id}");
        if let Some(code) = expected.get("code") {
            assert_eq!(result["error"]["code"], *code, "{id}");
        }
        if let Some(retryable) = expected.get("retryable") {
            assert_eq!(result["error"]["retryable"], *retryable, "{id}");
        }
        // `null` is no recovery: the error carries no `recovery` member.
        if let Some(recovery) = expected.get("recovery") {
            assert_eq!(result["error"]["recovery"], *recovery, "{id}");
            if recovery.is_null() {
                assert!(result["error"].get("recovery").is_none(), "{id}");
            }
        }
        if let Some(data) = expected.get("data") {
            assert_eq!(result["data"], *data, "{id}");
        }
        let expected_hooks: Vec<String> = expected["hooks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap().to_string())
            .collect();
        assert_eq!(*hooks.lock().unwrap(), expected_hooks, "{id}");
        executed += 1;
    }

    assert!(
        executed >= 3,
        "expected at least 3 MCP dispatch cases, ran {executed}"
    );
}
