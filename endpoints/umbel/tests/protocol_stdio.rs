//! The Rust server's protocol criteria over stdio-shaped JSON-RPC (specification section 10),
//! against a sealed Umbel host with zero plugins, in both MCP eras: the same list, the
//! first-class calls and an unknown tool. The driver serves `Host::mcp_server()` over an
//! in-memory pipe; the real `serve_stdio` path is covered by `process.rs`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::json;
use support::mcp::{Client, Era, Transport};
use support::*;
use umbel::HostBuilder;

const ERAS: [Era; 2] = [Era::Modern, Era::Legacy];

// server_hybrid.rs: the_lists_and_ttls_match_the_shared_cases
#[tokio::test]
async fn both_eras_list_the_meta_tools_then_the_first_class_tools() {
    let dir = minimal();
    let host = host(dir.path());
    for era in ERAS {
        let mut client = Client::connect(&host, Transport::Stdio, era).await;
        assert_eq!(client.tool_names().await, default_tools(&host), "{era:?}");
    }
}

#[tokio::test]
async fn the_modern_list_carries_its_ttl_and_scope() {
    let dir = minimal();
    let host = host(dir.path());
    let mut client = Client::connect(&host, Transport::Stdio, Era::Modern).await;
    let response = client.request("tools/list", json!({})).await;
    assert_eq!(response["result"]["resultType"], "complete");
    assert_eq!(response["result"]["ttlMs"], 300_000);
    assert_eq!(response["result"]["cacheScope"], "public");
}

#[tokio::test]
async fn the_legacy_initialize_names_umbel() {
    let dir = minimal();
    let host = host(dir.path());
    // `connect_modern` has not opened the connection, so the test sends `initialize` itself.
    let mut raw = support::mcp::Stdio::connect_modern(&host);
    let initialize = raw
        .request(
            "initialize",
            json!({
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": { "name": "test", "version": "0" },
            }),
        )
        .await;
    assert_eq!(initialize["result"]["protocolVersion"], "2025-11-25");
    assert_eq!(initialize["result"]["serverInfo"]["name"], "umbel");
    assert_eq!(
        initialize["result"]["serverInfo"]["version"],
        env!("CARGO_PKG_VERSION")
    );
}

// server_hybrid.rs: the_calls_match_the_shared_cases
#[tokio::test]
async fn workspace_show_runs_in_both_eras_with_structured_content() {
    let dir = workspace("config_version = 1\nname = \"stdio-team\"\n");
    let host = host(dir.path());
    for era in ERAS {
        let mut client = Client::connect(&host, Transport::Stdio, era).await;
        let result = client.call("workspace-show", json!({})).await;
        assert_eq!(result["success"], true, "{era:?}: {result}");
        assert_eq!(result["data"]["name"], "stdio-team");
        assert_eq!(result["data"]["defaultSpace"], "main");
        assert_eq!(result["data"]["host"]["name"], "umbel");
    }
}

#[tokio::test]
async fn event_list_runs_in_both_eras() {
    let dir = minimal();
    let host = host(dir.path());
    for era in ERAS {
        let mut client = Client::connect(&host, Transport::Stdio, era).await;
        let result = client.call("event-list", json!({})).await;
        assert_eq!(result["success"], true, "{era:?}: {result}");
        assert_eq!(result["data"]["space"], "main");
        assert_eq!(result["data"]["cursor"], "v0:main:0");
        assert_eq!(result["data"]["events"], json!([]));
    }
}

#[tokio::test]
async fn an_unknown_tool_is_a_failed_command_result_in_both_eras() {
    let dir = minimal();
    let host = host(dir.path());
    for era in ERAS {
        let mut client = Client::connect(&host, Transport::Stdio, era).await;
        let response = client.call_raw("no-such-tool", json!({})).await;
        assert_eq!(response["result"]["isError"], true, "{era:?}");
        let result = support::mcp::command_result(&response);
        assert_eq!(result["error"]["code"], "COMMAND_NOT_FOUND");
        assert!(
            result["error"]["suggestion"]
                .as_str()
                .unwrap()
                .ends_with("Use afd-discover to list all commands.")
        );
    }
}

#[tokio::test]
async fn the_stdio_actor_is_the_configured_local_principal() {
    let dir = workspace(
        "config_version = 1\n\n[principal]\nlocal_id = \"ada-laptop\"\non_behalf_of = \"ada\"\n",
    );
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(fixture("fixture-whoami", |_, context| {
            afd::success(json!({ "actor": context.actor }))
        }))
        .seal()
        .unwrap();
    for era in ERAS {
        let mut client = Client::connect(&host, Transport::Stdio, era).await;
        let result = client.afd_call("fixture-whoami", json!({})).await;
        assert_eq!(
            result["data"]["actor"],
            json!({ "kind": "agent", "id": "ada-laptop", "onBehalfOf": "ada" }),
            "{era:?}"
        );
    }
}
