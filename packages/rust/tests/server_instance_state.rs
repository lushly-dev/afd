//! Tests for `McpServer::with_instances` (`ServerInstances::Single | Multiple`)
//! and per-process confirmation key / approval nonce store checks (#2242).

#![cfg(feature = "server")]

use std::sync::Arc;

#[cfg(feature = "approval")]
use std::collections::HashSet;
#[cfg(feature = "approval")]
use std::sync::Mutex;

use afd::approval::ApprovalPolicy;
#[cfg(feature = "approval")]
use afd::approval::{
    create_approval_middleware, ApprovalMiddlewareOptions, ApprovalNonceStore, ApprovalRelay,
    ApprovalReplay,
};
#[cfg(feature = "approval")]
use afd::middleware::compose_middleware;
use afd::server::{ConfirmationMode, HttpOptions, McpServer, ServerInstances};
#[cfg(feature = "approval")]
use afd::server::{HumanRelay, RelayCall, RelayOutcome, RelayPrompt};
use afd::{
    success, CommandContext, CommandDefinition, CommandHandler, CommandRegistry, CommandResult,
    ExposeOptions,
};
#[cfg(feature = "approval")]
use afd::{CommandError, CommandMiddleware};
use async_trait::async_trait;
use serde_json::{json, Value};

#[cfg(feature = "approval")]
const SECRET: &[u8] = b"test-approval-secret-0123456789abcdef";
const KEY: &[u8] = b"test-confirmation-key-0123456789abcdef";

struct ClearHandler;

#[async_trait]
impl CommandHandler for ClearHandler {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(json!({ "cleared": true }))
    }
}

#[cfg(feature = "approval")]
#[derive(Default)]
struct SharedNonceStore {
    spent: Mutex<HashSet<String>>,
}

#[cfg(feature = "approval")]
#[async_trait]
impl ApprovalNonceStore for SharedNonceStore {
    async fn consume(&self, nonce: &str, _expires_at: i64) -> bool {
        self.spent.lock().unwrap().insert(nonce.to_owned())
    }
}

#[cfg(feature = "approval")]
struct DummyRelay;

#[cfg(feature = "approval")]
#[async_trait]
impl HumanRelay for DummyRelay {
    async fn begin(&self, _call: &RelayCall) -> Result<RelayPrompt, CommandError> {
        Ok(RelayPrompt::new(
            "https://example.test/approve/1",
            "Approve action",
            "state-1",
        ))
    }

    async fn resume(&self, _state: &str, _call: &RelayCall) -> RelayOutcome {
        RelayOutcome::Pending(RelayPrompt::new(
            "https://example.test/approve/1",
            "Approve action",
            "state-1",
        ))
    }
}

#[cfg(feature = "approval")]
fn pass_through() -> CommandMiddleware {
    Arc::new(|_name, _input, context, next| next(context))
}

fn registry_with_clear() -> Arc<CommandRegistry> {
    let registry = Arc::new(CommandRegistry::new());
    registry
        .register(
            CommandDefinition::new("todo-clear", "Delete every todo", vec![], ClearHandler)
                .as_mutation()
                .with_confirm_prompt("Delete every todo?")
                .with_approval(ApprovalPolicy::NotRequired)
                .with_expose(ExposeOptions::new().with_mcp(true)),
        )
        .unwrap();
    registry
}

#[test]
fn confirmation_key_length_boundary_is_validated_including_under_single() {
    let reg = registry_with_clear();
    assert!(McpServer::new(Arc::clone(&reg), "todo", "1.0.0")
        .with_instances(ServerInstances::Single)
        .with_confirmations_key(ConfirmationMode::Enforce, vec![b'k'; 31])
        .is_err());
    assert!(McpServer::new(Arc::clone(&reg), "todo", "1.0.0")
        .with_instances(ServerInstances::Single)
        .with_confirmation_key(vec![b'k'; 31])
        .is_err());
    assert!(McpServer::new(Arc::clone(&reg), "todo", "1.0.0")
        .with_confirmation_key(vec![b'k'; 32])
        .is_ok());
}

#[test]
fn multiple_refuses_confirmations_without_shared_key() {
    let reg = registry_with_clear();
    let err = McpServer::new(Arc::clone(&reg), "todo", "1.0.0")
        .with_instances(ServerInstances::Multiple)
        .with_confirmations(ConfirmationMode::Enforce)
        .try_streamable_http_service(HttpOptions::default())
        .err()
        .expect("should refuse confirmations without shared key");
    assert!(
        err.contains("ServerInstances::Multiple needs confirmation key"),
        "unexpected error: {err}"
    );

    // Setting the key with either builder satisfies the check, in either order.
    McpServer::new(Arc::clone(&reg), "todo", "1.0.0")
        .with_instances(ServerInstances::Multiple)
        .with_confirmations_key(ConfirmationMode::Enforce, KEY.to_vec())
        .unwrap()
        .try_streamable_http_service(HttpOptions::default())
        .unwrap();

    McpServer::new(Arc::clone(&reg), "todo", "1.0.0")
        .with_instances(ServerInstances::Multiple)
        .with_confirmation_key(KEY.to_vec())
        .unwrap()
        .with_confirmations(ConfirmationMode::RequireHuman)
        .try_streamable_http_service(HttpOptions::default())
        .unwrap();
}

#[test]
#[should_panic(expected = "ServerInstances::Multiple needs confirmation key")]
fn streamable_http_service_panics_on_multiple_violation() {
    let reg = registry_with_clear();
    let _ = McpServer::new(reg, "todo", "1.0.0")
        .with_instances(ServerInstances::Multiple)
        .with_confirmations(ConfirmationMode::Enforce)
        .streamable_http_service(HttpOptions::default());
}

#[test]
fn multiple_needs_nothing_when_no_per_process_default_is_in_use() {
    let reg = registry_with_clear();
    McpServer::new(reg, "todo", "1.0.0")
        .with_instances(ServerInstances::Multiple)
        .try_streamable_http_service(HttpOptions::default())
        .unwrap();
}

#[test]
fn single_allows_per_process_confirmation_key() {
    let reg = registry_with_clear();
    McpServer::new(reg, "todo", "1.0.0")
        .with_instances(ServerInstances::Single)
        .with_confirmations(ConfirmationMode::Enforce)
        .try_streamable_http_service(HttpOptions::default())
        .unwrap();
}

#[tokio::test]
async fn serve_stdio_refuses_multiple_with_per_process_defaults() {
    let reg = registry_with_clear();
    let err = McpServer::new(reg, "todo", "1.0.0")
        .with_instances(ServerInstances::Multiple)
        .with_confirmations(ConfirmationMode::Enforce)
        .serve_stdio()
        .await
        .unwrap_err();
    assert!(
        err.contains("ServerInstances::Multiple needs confirmation key"),
        "unexpected error: {err}"
    );
}

#[cfg(feature = "approval")]
#[test]
fn multiple_refuses_single_use_approval_without_nonce_store() {
    let reg = registry_with_clear();
    reg.add_middleware(
        create_approval_middleware(ApprovalMiddlewareOptions::from_secret(SECRET)).unwrap(),
    );
    let err = McpServer::new(Arc::clone(&reg), "todo", "1.0.0")
        .with_instances(ServerInstances::Multiple)
        .validate()
        .unwrap_err();
    assert!(err.contains("nonce_store"), "unexpected error: {err}");

    let shared_reg = registry_with_clear();
    shared_reg.add_middleware(
        create_approval_middleware(
            ApprovalMiddlewareOptions::from_secret(SECRET)
                .with_nonce_store(SharedNonceStore::default()),
        )
        .unwrap(),
    );
    McpServer::new(shared_reg, "todo", "1.0.0")
        .with_instances(ServerInstances::Multiple)
        .validate()
        .unwrap();

    // WithinTtl keeps no single-use token nonces.
    let ttl_reg = registry_with_clear();
    ttl_reg.add_middleware(
        create_approval_middleware(
            ApprovalMiddlewareOptions::from_secret(SECRET).with_replay(ApprovalReplay::WithinTtl),
        )
        .unwrap(),
    );
    McpServer::new(ttl_reg, "todo", "1.0.0")
        .with_instances(ServerInstances::Multiple)
        .validate()
        .unwrap();
}

#[cfg(feature = "approval")]
#[test]
fn multiple_refuses_human_relay_with_within_ttl_without_nonce_store() {
    let reg = registry_with_clear();
    reg.add_middleware(
        create_approval_middleware(
            ApprovalMiddlewareOptions::from_secret(SECRET).with_replay(ApprovalReplay::WithinTtl),
        )
        .unwrap(),
    );
    let err = McpServer::new(Arc::clone(&reg), "todo", "1.0.0")
        .with_human_relay(DummyRelay)
        .with_instances(ServerInstances::Multiple)
        .validate()
        .unwrap_err();
    assert!(
        err.contains("nonce_store") && err.contains("HumanRelay"),
        "unexpected error: {err}"
    );
}

#[cfg(feature = "approval")]
#[test]
fn multiple_refuses_approval_relay_without_shared_key() {
    let reg = registry_with_clear();
    reg.add_middleware(
        create_approval_middleware(
            ApprovalMiddlewareOptions::from_secret(SECRET)
                .with_nonce_store(SharedNonceStore::default())
                .with_relay(ApprovalRelay::McpElicitation),
        )
        .unwrap(),
    );
    let err = McpServer::new(Arc::clone(&reg), "todo", "1.0.0")
        .with_instances(ServerInstances::Multiple)
        .validate()
        .unwrap_err();
    assert!(
        err.contains("needs confirmation key"),
        "unexpected error: {err}"
    );

    McpServer::new(Arc::clone(&reg), "todo", "1.0.0")
        .with_instances(ServerInstances::Multiple)
        .with_confirmations_key(ConfirmationMode::Off, KEY.to_vec())
        .unwrap()
        .validate()
        .unwrap();
}

#[cfg(feature = "approval")]
#[test]
fn multiple_names_both_defaults_when_both_are_missing() {
    let reg = registry_with_clear();
    reg.add_middleware(
        create_approval_middleware(ApprovalMiddlewareOptions::from_secret(SECRET)).unwrap(),
    );
    let err = McpServer::new(reg, "todo", "1.0.0")
        .with_instances(ServerInstances::Multiple)
        .with_confirmations(ConfirmationMode::RequireHuman)
        .validate()
        .unwrap_err();
    assert!(
        err.contains("confirmation key")
            && err.contains("and the approval middleware's nonce_store")
            && err.contains("Pass the same"),
        "unexpected error: {err}"
    );
}

#[cfg(feature = "approval")]
#[test]
fn multiple_sees_approval_middleware_inside_nested_compose_middleware() {
    let reg = registry_with_clear();
    let composed = compose_middleware(vec![
        pass_through(),
        create_approval_middleware(ApprovalMiddlewareOptions::from_secret(SECRET)).unwrap(),
    ]);
    reg.add_middleware(composed);
    let err = McpServer::new(reg, "todo", "1.0.0")
        .with_instances(ServerInstances::Multiple)
        .validate()
        .unwrap_err();
    assert!(err.contains("nonce_store"), "unexpected error: {err}");

    let nested_reg = registry_with_clear();
    let nested = compose_middleware(vec![
        compose_middleware(vec![create_approval_middleware(
            ApprovalMiddlewareOptions::from_secret(SECRET)
                .with_nonce_store(SharedNonceStore::default())
                .with_relay(ApprovalRelay::McpElicitation),
        )
        .unwrap()]),
        pass_through(),
    ]);
    nested_reg.add_middleware(nested);
    let err = McpServer::new(Arc::clone(&nested_reg), "todo", "1.0.0")
        .with_instances(ServerInstances::Multiple)
        .validate()
        .unwrap_err();
    assert!(
        err.contains("needs confirmation key"),
        "unexpected error: {err}"
    );
    McpServer::new(nested_reg, "todo", "1.0.0")
        .with_instances(ServerInstances::Multiple)
        .with_confirmation_key(KEY.to_vec())
        .unwrap()
        .validate()
        .unwrap();

    let passthrough_reg = registry_with_clear();
    passthrough_reg.add_middleware(compose_middleware(vec![pass_through()]));
    McpServer::new(passthrough_reg, "todo", "1.0.0")
        .with_instances(ServerInstances::Multiple)
        .validate()
        .unwrap();
}

#[cfg(feature = "approval")]
#[test]
fn multiple_sees_middleware_added_after_server_construction() {
    let reg = registry_with_clear();
    let server =
        McpServer::new(Arc::clone(&reg), "todo", "1.0.0").with_instances(ServerInstances::Multiple);
    assert!(server.validate().is_ok());

    reg.add_middleware(
        create_approval_middleware(ApprovalMiddlewareOptions::from_secret(SECRET)).unwrap(),
    );
    let err = server.validate().unwrap_err();
    assert!(err.contains("nonce_store"), "unexpected error: {err}");
}

#[cfg(feature = "approval")]
#[tokio::test]
async fn two_instances_sharing_a_nonce_store_spend_single_use_token_once() {
    #[derive(Clone)]
    struct ArcStore(Arc<SharedNonceStore>);

    #[async_trait]
    impl ApprovalNonceStore for ArcStore {
        async fn consume(&self, nonce: &str, expires_at: i64) -> bool {
            self.0.consume(nonce, expires_at).await
        }
    }

    let shared = Arc::new(SharedNonceStore::default());
    let make_instance = || {
        let reg = Arc::new(CommandRegistry::new());
        reg.register(
            CommandDefinition::new("todo-clear", "Delete every todo", vec![], ClearHandler)
                .as_mutation()
                .with_approval(ApprovalPolicy::Required)
                .with_expose(ExposeOptions::new().with_mcp(true)),
        )
        .unwrap();
        reg.add_middleware(
            create_approval_middleware(
                ApprovalMiddlewareOptions::from_secret(SECRET)
                    .with_nonce_store(ArcStore(Arc::clone(&shared))),
            )
            .unwrap(),
        );
        let server = McpServer::new(Arc::clone(&reg), "todo", "1.0.0")
            .with_instances(ServerInstances::Multiple)
            .with_confirmation_key(KEY.to_vec())
            .unwrap();
        server.validate().unwrap();
        reg
    };

    let instance_a = make_instance();
    let instance_b = make_instance();

    let held = instance_a.execute("todo-clear", json!({}), None).await;
    assert!(!held.success);
    let token = held.error.unwrap().details.unwrap()["approvalToken"]
        .as_str()
        .unwrap()
        .to_owned();

    // First spend succeeds on instance B.
    let approved = instance_b
        .execute(
            "todo-clear",
            json!({}),
            Some(CommandContext::new().with_approval(token.clone())),
        )
        .await;
    assert!(approved.success, "first spend on instance B should succeed");

    // Replaying the same token on instance A is rejected as already-used.
    let replay = instance_a
        .execute(
            "todo-clear",
            json!({}),
            Some(CommandContext::new().with_approval(token)),
        )
        .await;
    assert!(!replay.success);
    let err = replay.error.unwrap();
    assert_eq!(err.code, "APPROVAL_REQUIRED");
    assert_eq!(err.details.unwrap()["reason"], json!("already-used"));
}

#[cfg(feature = "approval")]
#[tokio::test]
async fn multiple_refuses_mid_request_per_process_middleware_even_when_hook_returns_fresh_context()
{
    use bytes::Bytes;
    use http::{Method, Request};
    use http_body_util::{BodyExt, Full};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tower::ServiceExt;

    struct CountingHandler(Arc<AtomicUsize>);

    #[async_trait]
    impl CommandHandler for CountingHandler {
        async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
            self.0.fetch_add(1, Ordering::SeqCst);
            success(json!({ "ok": true }))
        }
    }

    let runs = Arc::new(AtomicUsize::new(0));
    let reg = Arc::new(CommandRegistry::new());
    reg.register(
        CommandDefinition::new(
            "todo-clear",
            "Delete every todo",
            vec![],
            CountingHandler(Arc::clone(&runs)),
        )
        .as_mutation()
        .with_approval(ApprovalPolicy::NotRequired)
        .with_expose(ExposeOptions::new().with_mcp(true)),
    )
    .unwrap();

    let reg_for_hook = Arc::clone(&reg);
    let server = McpServer::new(Arc::clone(&reg), "todo", "1.0.0")
        .with_tool_strategy(afd::server::ToolStrategy::Individual)
        .with_instances(ServerInstances::Multiple)
        .with_context_hook(move |_req, _base| {
            let reg = Arc::clone(&reg_for_hook);
            async move {
                // Simulate a per-process approval middleware added concurrently after call_tool
                // validation, AND return a brand-new CommandContext::new() from the hook.
                reg.add_middleware(
                    create_approval_middleware(ApprovalMiddlewareOptions::from_secret(SECRET))
                        .unwrap(),
                );
                Ok(CommandContext::new())
            }
        });

    let service = server
        .try_streamable_http_service(HttpOptions::default())
        .unwrap();

    let body = serde_json::to_vec(&json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "todo-clear",
            "arguments": {},
            "_meta": {
                "io.modelcontextprotocol/protocolVersion": afd::server::MODERN_PROTOCOL_VERSION,
                "io.modelcontextprotocol/clientCapabilities": {},
                "io.modelcontextprotocol/clientInfo": { "name": "test", "version": "0" }
            }
        }
    }))
    .unwrap();

    let req = Request::builder()
        .method(Method::POST)
        .uri("/mcp")
        .header("host", "127.0.0.1")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", afd::server::MODERN_PROTOCOL_VERSION)
        .header("mcp-method", "tools/call")
        .header("mcp-name", "todo-clear")
        .body(Full::new(Bytes::from(body)))
        .unwrap();

    let resp = service.oneshot(req).await.unwrap();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(bytes.to_vec()).unwrap();
    let payload: Value = serde_json::from_str(
        text.lines()
            .find_map(|line| line.strip_prefix("data: "))
            .unwrap_or(&text),
    )
    .unwrap();

    assert_eq!(
        runs.load(Ordering::SeqCst),
        0,
        "handler must not run when per-process approval middleware was added mid-request"
    );
    let structured = &payload["result"]["structuredContent"];
    assert_eq!(structured["success"], json!(false));
    assert_eq!(structured["error"]["code"], json!("INTERNAL_ERROR"));
    assert_eq!(structured["error"]["retryable"], json!(false));
    let suggestion = structured["error"]["suggestion"]
        .as_str()
        .expect("operator suggestion");
    assert!(suggestion.contains("nonce_store"));
    assert!(!suggestion.to_ascii_lowercase().contains("try again"));
}

#[cfg(feature = "server-auth")]
#[test]
fn authorized_http_service_refuses_multiple_without_shared_key() {
    use afd::server::auth::{
        AuthRefusal, Authorization, Credentials, ProtectedResource, RuleCode, TokenVerifier,
    };

    struct RejectAll;
    #[async_trait]
    impl TokenVerifier for RejectAll {
        async fn verify(
            &self,
            _token: &str,
            _request: &http::request::Parts,
        ) -> Result<Credentials, AuthRefusal> {
            Err(AuthRefusal::new(RuleCode::TokenMalformed))
        }
    }

    let reg = registry_with_clear();
    let resource =
        ProtectedResource::new("https://example.test/mcp", ["https://issuer.example.test"])
            .unwrap();
    let auth = Authorization::new(resource, RejectAll).unwrap();
    let Err(err) = McpServer::new(reg, "todo", "1.0.0")
        .with_authorization(auth)
        .with_instances(ServerInstances::Multiple)
        .with_confirmations(ConfirmationMode::Enforce)
        .authorized_http_service(HttpOptions::default())
    else {
        panic!("authorized_http_service must refuse Multiple without shared key");
    };
    assert!(
        err.contains("ServerInstances::Multiple needs confirmation key"),
        "unexpected error: {err}"
    );
}
