//! Approvals over MCP and through the CLI projection's client (specification sections 4 and 10;
//! AFD's `server_approval.rs`). Approval tokens never travel over MCP: the middleware is
//! installed with `with_include_token(false)`, and the MCP approval relay is phase 4.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{
    Actor, ActorKind, ApprovalDecision, ApprovalPolicy, DirectApprovalHook, DirectApprovalRequest,
};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use support::mcp::Client;
use support::*;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use umbel::{Host, HostBuilder};

fn gated(dir: &std::path::Path, runs: &Arc<AtomicUsize>) -> Host {
    HostBuilder::open(dir)
        .unwrap()
        .register(needs_approval("fixture-gated", Arc::clone(runs)))
        .seal()
        .unwrap()
}

#[tokio::test]
async fn over_mcp_in_both_eras_the_hold_carries_no_token_and_nothing_runs() {
    let dir = minimal();
    let runs = Arc::new(AtomicUsize::new(0));
    let host = gated(dir.path(), &runs);
    for mut client in Client::lanes(&host).await {
        let label = client.label();
        let held = client.afd_call("fixture-gated", json!({})).await;
        assert_eq!(held["success"], false, "{label}");
        assert_eq!(
            held["error"]["code"], "APPROVAL_REQUIRED",
            "{label}: {held}"
        );
        assert!(
            held["error"]["details"]["approvalToken"].is_null(),
            "{label}: {held}"
        );
        assert!(
            !held.to_string().contains("approvalToken"),
            "{label}: {held}"
        );
        assert!(held["error"]["suggestion"].is_string(), "{label}");

        // afd-batch holds the same way.
        let batch = client
            .call(
                "afd-batch",
                json!({ "commands": [{ "command": "fixture-gated", "input": {} }] }),
            )
            .await;
        let item = &batch["results"][0]["result"];
        assert_eq!(
            item["error"]["code"], "APPROVAL_REQUIRED",
            "{label}: {batch}"
        );
        assert!(
            !batch.to_string().contains("approvalToken"),
            "{label}: {batch}"
        );
    }
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_first_class_gated_tool_holds_over_mcp_and_evidence_in_the_request_is_none() {
    let dir = workspace(
        "config_version = 1\n\n[mcp]\nfirst_class_tools = [\"workspace-show\", \"fixture-gated\"]\n",
    );
    let runs = Arc::new(AtomicUsize::new(0));
    let host = gated(dir.path(), &runs);
    for mut client in Client::lanes(&host).await {
        let label = client.label();
        let held = client.call("fixture-gated", json!({})).await;
        assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED", "{label}");
        assert!(
            !held.to_string().contains("approvalToken"),
            "{label}: {held}"
        );
        // Evidence smuggled into the arguments or the request is no evidence.
        let smuggled = client
            .call(
                "fixture-gated",
                json!({ "approval": "x", "approvalToken": "x" }),
            )
            .await;
        assert!(smuggled["success"] == false, "{label}: {smuggled}");
    }
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

fn hook(answer: bool, asked: Arc<Mutex<Vec<String>>>) -> DirectApprovalHook {
    Arc::new(move |request: DirectApprovalRequest| {
        let asked = Arc::clone(&asked);
        Box::pin(async move {
            asked.lock().unwrap().push(request.command);
            Ok(answer)
        })
    })
}

#[tokio::test]
async fn through_cli_client_an_approving_hook_runs_it_exactly_once() {
    let dir = minimal();
    let runs = Arc::new(AtomicUsize::new(0));
    let host = gated(dir.path(), &runs);
    let asked = Arc::new(Mutex::new(Vec::new()));
    let client = host
        .cli_client()
        .with_on_approval_needed(hook(true, Arc::clone(&asked)));
    let result = client
        .call(
            "fixture-gated",
            json!({}),
            Some(host.context(afd::Actor::new(afd::ActorKind::Human).with_id("ada"))),
        )
        .await;
    assert!(result.success, "{result:?}");
    assert_eq!(runs.load(Ordering::SeqCst), 1);
    assert_eq!(*asked.lock().unwrap(), ["fixture-gated"]);
}

#[tokio::test]
async fn through_cli_client_a_declining_hook_does_not_run_it() {
    let dir = minimal();
    let runs = Arc::new(AtomicUsize::new(0));
    let host = gated(dir.path(), &runs);
    let asked = Arc::new(Mutex::new(Vec::new()));
    let client = host
        .cli_client()
        .with_on_approval_needed(hook(false, Arc::clone(&asked)));
    let result = client
        .call(
            "fixture-gated",
            json!({}),
            Some(host.context(afd::Actor::new(afd::ActorKind::Human).with_id("ada"))),
        )
        .await;
    assert!(!result.success);
    assert_eq!(result.error.as_ref().unwrap().code, "APPROVAL_REQUIRED");
    assert!(
        !serde_json::to_string(&result)
            .unwrap()
            .contains("approvalToken"),
        "{result:?}"
    );
    assert_eq!(runs.load(Ordering::SeqCst), 0);
    assert_eq!(asked.lock().unwrap().len(), 1);
}

fn non_human_gated(name: &str, runs: Arc<AtomicUsize>) -> afd::CommandDefinition {
    fixture(name, move |_, _| {
        runs.fetch_add(1, Ordering::SeqCst);
        afd::success(json!({ "ran": true }))
    })
    .with_confirm_prompt("Really clear everything?")
    .with_approval(ApprovalPolicy::when(|_, context| {
        match context.actor.as_ref().map(|a| a.kind) {
            Some(ActorKind::Human) => ApprovalDecision::NotRequired,
            _ => ApprovalDecision::Required,
        }
    }))
}

#[tokio::test]
async fn non_human_approval_holds_over_mcp_even_with_confirm_and_runs_for_human_callers() {
    let dir = minimal();
    let runs = Arc::new(AtomicUsize::new(0));
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(non_human_gated("fixture-clear", Arc::clone(&runs)))
        .seal()
        .unwrap();

    for mut client in Client::lanes(&host).await {
        let label = client.label();
        // Without `confirm: true`, default `mcp.confirmations = "enforce"` stops the call first.
        let unconfirmed = client.afd_call("fixture-clear", json!({})).await;
        assert_eq!(unconfirmed["success"], false, "{label}: {unconfirmed}");
        assert_eq!(
            unconfirmed["error"]["code"], "CONFIRMATION_REQUIRED",
            "{label}: {unconfirmed}"
        );

        // Passing `confirm: true` clears confirmation, then hits the non-human approval gate.
        let held = client
            .call(
                "afd-call",
                json!({ "command": "fixture-clear", "input": {}, "confirm": true }),
            )
            .await;
        assert_eq!(held["success"], false, "{label}: {held}");
        assert_eq!(
            held["error"]["code"], "APPROVAL_REQUIRED",
            "{label}: {held}"
        );
        assert!(
            !held.to_string().contains("approvalToken"),
            "{label}: {held}"
        );
        let batch = client
            .call(
                "afd-batch",
                json!({
                    "commands": [{ "command": "fixture-clear", "input": {} }],
                    "confirm": ["fixture-clear"],
                }),
            )
            .await;
        assert_eq!(
            batch["results"][0]["result"]["error"]["code"], "APPROVAL_REQUIRED",
            "{label}: {batch}"
        );
    }
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    // Through the CLI client, a direct human caller runs without any approval hook.
    let result = host
        .cli_client()
        .call(
            "fixture-clear",
            json!({ "confirm": true }),
            Some(host.context(Actor::new(ActorKind::Human).with_id("ada"))),
        )
        .await;
    assert!(result.success, "{result:?}");
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn mcp_approvals_off_disables_only_mcp_approvals_and_keeps_cli_enforced() {
    let dir = workspace("config_version = 7\n\n[mcp]\napprovals = \"off\"\n");
    let runs = Arc::new(AtomicUsize::new(0));
    let host_verified_runs = Arc::new(AtomicUsize::new(0));
    let mut host_verified = needs_approval("fixture-verified", Arc::clone(&host_verified_runs));
    host_verified.confirmation_mode = Some(afd::CommandConfirmationMode::HostVerified);
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(needs_approval("fixture-gated", Arc::clone(&runs)))
        .register(host_verified)
        .seal()
        .unwrap();

    // Over MCP, `mcp.approvals = "off"` lets the ordinary command run...
    let mut client = Client::connect(
        &host,
        umbel::testkit::mcp::Transport::Http,
        umbel::testkit::Era::Modern,
    )
    .await;
    let ok = client.afd_call("fixture-gated", json!({})).await;
    assert_eq!(ok["success"], true, "{ok}");
    assert_eq!(runs.load(Ordering::SeqCst), 1);

    // ...but never relaxes a host-verified command's confirmation or approval policy (checked both
    // over MCP and directly at the registry with `CommandInterface::Mcp`).
    let verified_mcp = client.afd_call("fixture-verified", json!({})).await;
    assert_eq!(verified_mcp["success"], false, "{verified_mcp}");
    assert_eq!(
        verified_mcp["error"]["code"], "CONFIRMATION_REQUIRED",
        "{verified_mcp}"
    );
    let mut mcp_ctx = host.context(Actor::new(ActorKind::Agent).with_id("a1"));
    mcp_ctx.interface = Some(afd::CommandInterface::Mcp);
    let verified_held = host
        .registry()
        .execute("fixture-verified", json!({}), Some(mcp_ctx))
        .await;
    assert!(!verified_held.success, "{verified_held:?}");
    assert_eq!(verified_held.error.unwrap().code, "APPROVAL_REQUIRED");
    assert_eq!(host_verified_runs.load(Ordering::SeqCst), 0);

    // Outside MCP (CLI, library with `interface = None`, and DirectClient/Agent), approval stays
    // enforced.
    let cli_held = host
        .cli_client()
        .call(
            "fixture-gated",
            json!({}),
            Some(host.context(Actor::new(ActorKind::Human).with_id("ada"))),
        )
        .await;
    assert!(!cli_held.success, "{cli_held:?}");
    assert_eq!(cli_held.error.unwrap().code, "APPROVAL_REQUIRED");

    let lib_held = host
        .registry()
        .execute(
            "fixture-gated",
            json!({}),
            Some(host.context(Actor::new(ActorKind::Human).with_id("ada"))),
        )
        .await;
    assert!(!lib_held.success, "{lib_held:?}");
    assert_eq!(lib_held.error.unwrap().code, "APPROVAL_REQUIRED");

    let direct_held = afd::DirectClient::new(host.registry())
        .call(
            "fixture-gated",
            json!({}),
            Some(host.context(Actor::new(ActorKind::Agent).with_id("a1"))),
        )
        .await;
    assert!(!direct_held.success, "{direct_held:?}");
    assert_eq!(direct_held.error.unwrap().code, "APPROVAL_REQUIRED");
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

async fn send_line(writer: &mut tokio::io::DuplexStream, msg: Value) {
    writer
        .write_all(format!("{msg}\n").as_bytes())
        .await
        .unwrap();
}

async fn stdio_elicit_call(host: &Host, action: &str, command: &str) -> (Value, bool) {
    use rmcp::ServiceExt;
    #[cfg(feature = "auth")]
    let server = host.mcp_server().with_trusted_transport();
    #[cfg(not(feature = "auth"))]
    let server = host.mcp_server();
    let (mut client_writer, server_reader) = tokio::io::duplex(1 << 20);
    let (server_writer, client_reader) = tokio::io::duplex(1 << 20);
    tokio::spawn(async move {
        let Ok(running) = server.serve((server_reader, server_writer)).await else {
            return;
        };
        let _ = running.waiting().await;
    });
    let mut reader = BufReader::new(client_reader);

    // Initialize with form elicitation capability.
    send_line(
        &mut client_writer,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-11-25",
                "capabilities": { "elicitation": { "form": {} } },
                "clientInfo": { "name": "test-elicit", "version": "0" },
            }
        }),
    )
    .await;
    let mut line = String::new();
    reader.read_line(&mut line).await.unwrap();
    send_line(
        &mut client_writer,
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
    )
    .await;

    // Call the gated command via afd-call.
    send_line(
        &mut client_writer,
        json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "afd-call",
                "arguments": { "command": command, "input": {} },
            }
        }),
    )
    .await;

    let mut elicited = false;
    loop {
        let mut raw = String::new();
        let n = reader.read_line(&mut raw).await.unwrap();
        assert!(n > 0, "server closed connection");
        let msg: Value = serde_json::from_str(&raw).unwrap();
        if msg.get("method").and_then(Value::as_str) == Some("elicitation/create") {
            elicited = true;
            let req_id = msg["id"].clone();
            let result = if action == "accept" {
                json!({ "action": "accept", "content": { "approve": true } })
            } else {
                json!({ "action": action })
            };
            send_line(
                &mut client_writer,
                json!({ "jsonrpc": "2.0", "id": req_id, "result": result }),
            )
            .await;
            continue;
        }
        if msg["id"] == 2 {
            let text = msg["result"]["content"][0]["text"].as_str().unwrap();
            return (serde_json::from_str(text).unwrap(), elicited);
        }
    }
}

#[tokio::test]
async fn mcp_approvals_elicitation_relays_over_stdio_and_holds_without_capability() {
    let dir = workspace(
        "config_version = 7\n\n[mcp]\nconfirmations = \"off\"\napprovals = \"mcp-elicitation\"\n",
    );
    let runs = Arc::new(AtomicUsize::new(0));
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(non_human_gated("fixture-clear", Arc::clone(&runs)))
        .seal()
        .unwrap();

    // A client without elicitation capability gets APPROVAL_REQUIRED with no token.
    let mut plain = Client::connect(
        &host,
        umbel::testkit::mcp::Transport::Stdio,
        umbel::testkit::Era::Legacy,
    )
    .await;
    let held = plain.afd_call("fixture-clear", json!({})).await;
    assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED", "{held}");
    assert!(!held.to_string().contains("approvalToken"), "{held}");
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    // A client that declines elicitation gets APPROVAL_REQUIRED with reason = "declined".
    let (declined, elicited) = stdio_elicit_call(&host, "decline", "fixture-clear").await;
    assert!(elicited, "expected elicitation/create request");
    assert_eq!(declined["success"], false, "{declined}");
    assert_eq!(declined["error"]["code"], "APPROVAL_REQUIRED", "{declined}");
    assert_eq!(
        declined["error"]["details"]["reason"], "declined",
        "{declined}"
    );
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    // A client that accepts elicitation runs the command once.
    let (accepted, elicited) = stdio_elicit_call(&host, "accept", "fixture-clear").await;
    assert!(elicited, "expected elicitation/create request");
    assert_eq!(accepted["success"], true, "{accepted}");
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}
