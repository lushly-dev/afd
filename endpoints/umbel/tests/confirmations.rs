//! Confirmations over MCP and through the CLI projection (specification sections 4 and 10; AFD's
//! `server_confirmations.rs`). The `requestState` is signed with `state/keys/confirmation.key`,
//! which every host process of a workspace shares.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use support::mcp::{Client, Http, Transport, command_result, modern_meta};
use support::*;
use umbel::{Host, HostBuilder};

fn confirming(dir: &Path, runs: &Arc<AtomicUsize>) -> Host {
    HostBuilder::open(dir)
        .unwrap()
        .register(needs_confirmation("fixture-clear", Arc::clone(runs)))
        .seal()
        .unwrap()
}

const FIRST_CLASS: &str = "\n[mcp]\nfirst_class_tools = [\"workspace-show\", \"fixture-clear\"]\n";

#[tokio::test]
async fn over_mcp_a_confirmation_is_refused_without_acknowledgement_and_runs_with_it() {
    let dir = workspace(&format!("config_version = 1\n{FIRST_CLASS}"));
    let runs = Arc::new(AtomicUsize::new(0));
    let host = confirming(dir.path(), &runs);
    let mut expected = 0;
    for mut client in Client::lanes(&host).await {
        let label = client.label();
        let refused = client.call("fixture-clear", json!({})).await;
        assert_eq!(
            refused["error"]["code"], "CONFIRMATION_REQUIRED",
            "{label}: {refused}"
        );
        assert_eq!(runs.load(Ordering::SeqCst), expected, "{label}");

        let ran = client
            .call("fixture-clear", json!({ "confirm": true }))
            .await;
        assert_eq!(ran["success"], true, "{label}: {ran}");
        expected += 1;
        assert_eq!(runs.load(Ordering::SeqCst), expected, "{label}");

        // Through afd-call the acknowledgement is an argument of the meta-tool itself.
        let refused = client.afd_call("fixture-clear", json!({})).await;
        assert_eq!(
            refused["error"]["code"], "CONFIRMATION_REQUIRED",
            "{label}: {refused}"
        );
        let ran = client
            .call(
                "afd-call",
                json!({ "command": "fixture-clear", "input": {}, "confirm": true }),
            )
            .await;
        assert_eq!(ran["success"], true, "{label}: {ran}");
        expected += 1;
        assert_eq!(runs.load(Ordering::SeqCst), expected, "{label}");
    }
}

#[tokio::test]
async fn the_first_class_tool_advertises_confirm_under_enforce() {
    let dir = workspace(&format!("config_version = 1\n{FIRST_CLASS}"));
    let runs = Arc::new(AtomicUsize::new(0));
    let host = confirming(dir.path(), &runs);
    let tools = host.mcp_server().tools();
    let clear = tools
        .iter()
        .find(|tool| tool["name"] == "fixture-clear")
        .unwrap();
    assert!(
        clear["inputSchema"]["properties"]["confirm"].is_object(),
        "{clear}"
    );
}

#[tokio::test]
async fn require_human_over_mcp_refuses_the_acknowledgement() {
    let dir = workspace(&format!(
        "config_version = 1\n{FIRST_CLASS}confirmations = \"require-human\"\n"
    ));
    let runs = Arc::new(AtomicUsize::new(0));
    let host = confirming(dir.path(), &runs);
    for mut client in Client::lanes(&host).await {
        let label = client.label();
        let refused = client
            .call(
                "afd-call",
                json!({ "command": "fixture-clear", "input": {}, "confirm": true }),
            )
            .await;
        assert_eq!(
            refused["error"]["code"], "CONFIRMATION_REQUIRED",
            "{label}: {refused}"
        );
        let refused = client
            .call("fixture-clear", json!({ "confirm": true }))
            .await;
        assert_eq!(
            refused["error"]["code"], "CONFIRMATION_REQUIRED",
            "{label}: {refused}"
        );
    }
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn off_gates_nothing_over_mcp() {
    let dir = workspace("config_version = 1\n\n[mcp]\nconfirmations = \"off\"\n");
    let runs = Arc::new(AtomicUsize::new(0));
    let host = confirming(dir.path(), &runs);
    let mut client = Client::connect(&host, Transport::Http, support::mcp::Era::Modern).await;
    let ran = client.afd_call("fixture-clear", json!({})).await;
    assert_eq!(ran["success"], true, "{ran}");
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

/// A modern `tools/call` whose client can elicit, with the answer and state of an earlier round.
async fn elicited(http: &Http, tool: &str, arguments: Value, extra: Value) -> Value {
    let mut meta = modern_meta();
    meta["io.modelcontextprotocol/clientCapabilities"] = json!({ "elicitation": {} });
    let mut params = json!({ "name": tool, "arguments": arguments, "_meta": meta });
    if let Value::Object(extra) = extra {
        for (key, value) in extra {
            params[key] = value;
        }
    }
    let reply = http.modern_reply("tools/call", params, &[]).await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    reply.json()
}

fn accept() -> Value {
    json!({ "confirm": { "action": "accept", "content": { "confirm": true } } })
}

#[tokio::test]
async fn a_request_state_issued_by_one_host_is_accepted_by_a_second_on_the_same_workspace() {
    let dir = workspace(&format!("config_version = 1\n{FIRST_CLASS}"));
    let runs = Arc::new(AtomicUsize::new(0));
    let first = confirming(dir.path(), &runs);
    let asked = elicited(&Http::new(&first), "fixture-clear", json!({}), json!({})).await;
    assert_eq!(asked["result"]["resultType"], "input_required", "{asked}");
    let state = asked["result"]["requestState"].as_str().unwrap().to_owned();
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    // A second host process on the same workspace shares the key.
    let second = confirming(dir.path(), &runs);
    let ran = elicited(
        &Http::new(&second),
        "fixture-clear",
        json!({}),
        json!({ "inputResponses": accept(), "requestState": state }),
    )
    .await;
    assert_eq!(command_result(&ran)["success"], true, "{ran}");
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_request_state_survives_a_restart() {
    let dir = workspace(&format!("config_version = 1\n{FIRST_CLASS}"));
    let runs = Arc::new(AtomicUsize::new(0));
    let state = {
        let host = confirming(dir.path(), &runs);
        let asked = elicited(&Http::new(&host), "fixture-clear", json!({}), json!({})).await;
        asked["result"]["requestState"].as_str().unwrap().to_owned()
    };
    // The first host is gone.
    let restarted = confirming(dir.path(), &runs);
    let ran = elicited(
        &Http::new(&restarted),
        "fixture-clear",
        json!({}),
        json!({ "inputResponses": accept(), "requestState": state }),
    )
    .await;
    assert_eq!(command_result(&ran)["success"], true, "{ran}");
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_request_state_from_another_workspace_is_not_accepted() {
    let runs = Arc::new(AtomicUsize::new(0));
    let one = workspace(&format!("config_version = 1\n{FIRST_CLASS}"));
    let two = workspace(&format!("config_version = 1\n{FIRST_CLASS}"));
    let host_one = confirming(one.path(), &runs);
    let asked = elicited(&Http::new(&host_one), "fixture-clear", json!({}), json!({})).await;
    let state = asked["result"]["requestState"].as_str().unwrap().to_owned();
    let host_two = confirming(two.path(), &runs);
    let again = elicited(
        &Http::new(&host_two),
        "fixture-clear",
        json!({}),
        json!({ "inputResponses": accept(), "requestState": state }),
    )
    .await;
    assert_eq!(again["result"]["resultType"], "input_required", "{again}");
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

mod cli {
    use super::*;

    #[tokio::test]
    async fn with_no_terminal_it_needs_yes_and_with_yes_it_runs() {
        let dir = minimal();
        let runs = Arc::new(AtomicUsize::new(0));
        let configure = |runs: Arc<AtomicUsize>| {
            move |builder: HostBuilder| builder.register(needs_confirmation("fixture-clear", runs))
        };
        let refused = cli_with(
            dir.path(),
            &["call", "fixture-clear"],
            Scripted::no_terminal(),
            configure(Arc::clone(&runs)),
        )
        .await;
        assert_eq!(refused.code, 1);
        assert_eq!(refused.error_code(), "CONFIRMATION_REQUIRED");
        assert!(
            refused.json()["error"]["suggestion"]
                .as_str()
                .unwrap()
                .contains("--yes")
        );
        assert_eq!(runs.load(Ordering::SeqCst), 0);

        let ran = cli_with(
            dir.path(),
            &["call", "fixture-clear", "--yes"],
            Scripted::no_terminal(),
            configure(Arc::clone(&runs)),
        )
        .await;
        assert_eq!(ran.code, 0, "{}", ran.stdout);
        assert_eq!(runs.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn under_require_human_yes_is_refused_and_only_a_terminal_answer_counts() {
        let dir = workspace("config_version = 1\n\n[mcp]\nconfirmations = \"require-human\"\n");
        let runs = Arc::new(AtomicUsize::new(0));
        let configure = |runs: Arc<AtomicUsize>| {
            move |builder: HostBuilder| builder.register(needs_confirmation("fixture-clear", runs))
        };
        let refused = cli_with(
            dir.path(),
            &["call", "fixture-clear", "--yes"],
            Scripted::no_terminal(),
            configure(Arc::clone(&runs)),
        )
        .await;
        assert_eq!(refused.code, 1);
        assert_eq!(refused.error_code(), "CONFIRMATION_REQUIRED");
        assert_eq!(runs.load(Ordering::SeqCst), 0);

        let console = Scripted::new(true, true);
        let ran = cli_with(
            dir.path(),
            &["call", "fixture-clear"],
            console.clone(),
            configure(Arc::clone(&runs)),
        )
        .await;
        assert_eq!(ran.code, 0, "{}", ran.stdout);
        assert_eq!(console.asked().len(), 1);
        assert_eq!(runs.load(Ordering::SeqCst), 1);

        let declined = cli_with(
            dir.path(),
            &["call", "fixture-clear"],
            Scripted::new(true, false),
            configure(Arc::clone(&runs)),
        )
        .await;
        assert_eq!(declined.error_code(), "CONFIRMATION_DECLINED");
        assert_eq!(runs.load(Ordering::SeqCst), 1);
    }
}
