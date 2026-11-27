//! The language-neutral vectors in `spec/vectors/human-relay.json`: the relay's pending list
//! (`spec/command-metadata.md`, "The pending list"). Each `pending` case is answered over MCP
//! 2026-07-28 HTTP, from a client without URL-mode elicitation, with exactly its `error`; each
//! `invalid` case is an internal error.
#![cfg(all(feature = "server", feature = "approval"))]

mod common;

use std::sync::Arc;
use std::sync::Mutex;

use afd::server::{
    HumanRelay, McpServer, PendingListOutcome, RelayCall, RelayOutcome, RelayPending, RelayPrompt,
};
use afd::{
    success, CommandConfirmationMode, CommandContext, CommandDefinition, CommandError,
    CommandHandler, CommandParameter, CommandRegistry, CommandResult,
};
use async_trait::async_trait;
use common::{command_result, http_post};
use serde_json::{json, Value};

/// A relay whose pending list names the address it is given.
#[derive(Clone, Default)]
struct Listing(Arc<Mutex<Option<RelayPending>>>);

#[async_trait]
impl HumanRelay for Listing {
    async fn begin(&self, _call: &RelayCall) -> Result<RelayPrompt, CommandError> {
        Err(CommandError::new("UNEXPECTED", "begin is never asked here"))
    }

    async fn resume(&self, _state: &str, _call: &RelayCall) -> RelayOutcome {
        RelayOutcome::Invalid
    }

    async fn pending_list(
        &self,
        _call: &RelayCall,
    ) -> Option<Result<PendingListOutcome, CommandError>> {
        let pending = self.0.lock().unwrap().clone()?;
        Some(Ok(PendingListOutcome::Pending(pending)))
    }
}

struct Never;

#[async_trait]
impl CommandHandler for Never {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(json!({ "ran": true }))
    }
}

fn vectors() -> Value {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../spec/vectors/human-relay.json");
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap()
}

fn server(command: &str, relay: Listing) -> McpServer {
    let registry = Arc::new(CommandRegistry::new());
    let mut definition = CommandDefinition::new(
        command,
        "A command only the host confirms",
        vec![CommandParameter::optional_string("id", "An id")],
        Never,
    )
    .as_mutation()
    .with_confirmation_mode(CommandConfirmationMode::HostVerified);
    definition.expose.mcp = true;
    registry.register(definition).unwrap();
    McpServer::new(registry, "vectors", "1.0.0").with_human_relay(relay)
}

async fn call(server: &McpServer, command: &str) -> Value {
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": command,
            "arguments": {},
            "_meta": {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": { "elicitation": { "form": {} } },
            },
        },
    });
    let (status, response) = http_post(
        server,
        body,
        &[
            ("mcp-protocol-version", "2026-07-28"),
            ("mcp-method", "tools/call"),
            ("mcp-name", command),
        ],
    )
    .await;
    assert_eq!(status, 200, "{response}");
    response
}

fn address(case: &Value) -> RelayPending {
    let relay = &case["relay"];
    RelayPending::new(
        relay["decision"].as_str().unwrap(),
        relay["url"].as_str().unwrap(),
        relay["list"].as_str().unwrap(),
    )
}

#[tokio::test]
async fn rust_is_not_a_gap() {
    assert!(vectors()["gaps"].get("rust").is_none());
}

#[tokio::test]
async fn each_pending_case_is_refused_with_exactly_its_error() {
    for case in vectors()["pending"].as_array().unwrap() {
        let command = case["command"].as_str().unwrap();
        let relay = Listing::default();
        *relay.0.lock().unwrap() = Some(address(case));
        let server = server(command, relay);
        let refused = command_result(&call(&server, command).await);
        assert_eq!(refused["success"], false, "{}", case["name"]);
        assert_eq!(refused["error"], case["error"], "{}", case["name"]);
    }
}

#[tokio::test]
async fn each_invalid_case_is_an_internal_error() {
    for case in vectors()["invalid"].as_array().unwrap() {
        let relay = Listing::default();
        *relay.0.lock().unwrap() = Some(address(case));
        let server = server("memory-erase", relay);
        let response = call(&server, "memory-erase").await;
        assert_eq!(
            response["error"]["code"], -32603,
            "{}: {response}",
            case["name"]
        );
    }
}
