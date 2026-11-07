//! The token canary (`spec/authorization.md`, M2 and M5): every log line of every layer, the
//! SDK's included at `TRACE`, is captured while tokens are accepted and refused, and neither a
//! token, any part of one, nor a claim value appears. The refusals' rule codes and the issuer's
//! alias do. Its own test binary, so that the capturing subscriber is the process's only one.
#![cfg(feature = "server-auth")]

mod common;

use std::io::Write;
use std::sync::{Arc, Mutex};

use afd::server::McpServer;
use afd::{
    success, CommandContext, CommandDefinition, CommandHandler, CommandRegistry, CommandResult,
};
use async_trait::async_trait;
use common::auth::*;
use serde_json::{json, Value};

#[derive(Clone, Default)]
struct Capture(Arc<Mutex<Vec<u8>>>);

impl Write for Capture {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Answers without echoing anything of its context, so that only AFD and the SDK could leak.
struct Quiet;

#[async_trait]
impl CommandHandler for Quiet {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        success(json!({ "verified": context.credentials.is_some() }))
    }
}

#[tokio::test]
async fn the_token_and_claim_values_never_reach_the_logs() {
    let capture = Capture::default();
    let writer = capture.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_ansi(false)
        .with_writer(move || writer.clone())
        .finish();
    tracing::subscriber::set_global_default(subscriber).unwrap();

    let registry = Arc::new(CommandRegistry::new());
    for (name, scopes) in [("info-ping", vec![]), ("todo-create", vec!["todo:write"])] {
        let mut command =
            CommandDefinition::new(name, "A command", vec![], Quiet).with_scopes(scopes);
        command.expose.mcp = true;
        registry.register(command).unwrap();
    }
    let server = McpServer::new(registry, "todo", "1.0.0")
        .with_authorization(authorization().with_required_scopes(["todo:read"]).unwrap());
    let mut claims = claims();
    claims["sub"] = json!("canary-subject-7f3a");
    claims["client_id"] = json!("canary-client-9b2c");
    claims["jti"] = json!("canary-jti-5e1d");
    claims["scope"] = json!("todo:read canary:scope");
    let token = sign(&header("ES256", "ec256"), &claims, ec256());
    let call = |name: &str| json!({ "name": name, "arguments": {} });

    // Accepted; refused for a scope; refused as expired; a forged signature; no token.
    let accepted = send(&server, post("tools/call", call("info-ping"), Some(&token))).await;
    assert_eq!(accepted.status, 200, "{}", accepted.text);
    assert_eq!(
        common::command_result(&accepted.body)["data"]["verified"],
        true
    );
    let forbidden = send(
        &server,
        post("tools/call", call("todo-create"), Some(&token)),
    )
    .await;
    assert_eq!(forbidden.status, 403);
    let mut expired = claims.clone();
    expired["iat"] = json!(NOW - 7200);
    expired["exp"] = json!(NOW - 3600);
    let expired = sign(&header("ES256", "ec256"), &expired, ec256());
    let refused = send(&server, post("tools/list", json!({}), Some(&expired))).await;
    assert_eq!(refused.status, 401);
    let forged = sign(&header("RS256", "rsa"), &claims, rsa_other());
    let refused = send(&server, post("tools/list", json!({}), Some(&forged))).await;
    assert_eq!(refused.status, 401);
    let refused = send(&server, post("tools/list", json!({}), None)).await;
    assert_eq!(refused.status, 401);

    let logs = String::from_utf8(capture.0.lock().unwrap().clone()).unwrap();
    // The capture works: the SDK's own trace lines and AFD's refusals are there.
    assert!(logs.contains("rmcp::service"), "{logs}");
    assert!(logs.contains("rule=\"expired\" issuer=\"auth\""), "{logs}");
    assert!(
        logs.contains("rule=\"signature\" issuer=\"auth\""),
        "{logs}"
    );
    assert!(logs.contains("rule=\"no-token\""), "{logs}");
    for secret in [
        "canary-subject-7f3a",
        "canary-client-9b2c",
        "canary-jti-5e1d",
        "canary:scope",
        ISSUER,
    ] {
        assert!(!logs.contains(secret), "{secret} reached the logs:\n{logs}");
    }
    for token in [&token, &expired, &forged] {
        for part in token.split('.') {
            assert!(
                !logs.contains(part),
                "a token part reached the logs:\n{logs}"
            );
        }
    }
}
