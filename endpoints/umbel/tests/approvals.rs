//! Approvals over MCP and through the CLI projection's client (specification sections 4 and 10;
//! AFD's `server_approval.rs`). Approval tokens never travel over MCP: the middleware is
//! installed with `with_include_token(false)`, and the MCP approval relay is phase 4.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{DirectApprovalHook, DirectApprovalRequest};
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use support::mcp::Client;
use support::*;
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
