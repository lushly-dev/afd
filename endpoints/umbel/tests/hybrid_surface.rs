//! The hybrid tool strategy on the sealed host (specification section 10; AFD's
//! `spec/tool-strategies.md` H1 to H8): the first-class tools, `afd-help`, discovery, the meta
//! tools, and the configuration that decides the set.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::server::ToolStrategy;
use serde_json::{Value, json};
use support::mcp::{Client, LANES};
use support::*;
use umbel::HostBuilder;

fn names(value: &Value) -> Vec<String> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|name| name.as_str().unwrap().to_owned())
        .collect()
}

// server_hybrid.rs: first-class tools equal the individual strategy's tools
#[tokio::test]
async fn each_first_class_tool_equals_the_individual_tool_of_the_same_registry() {
    let dir = minimal();
    let host = host(dir.path());
    let hybrid = host.mcp_server().tools();
    let individual = host
        .mcp_server()
        .with_tool_strategy(ToolStrategy::Individual)
        .tools();
    for name in host.first_class_tools() {
        let first_class = hybrid.iter().find(|tool| tool["name"] == *name).unwrap();
        let single = individual
            .iter()
            .find(|tool| tool["name"] == *name)
            .unwrap();
        assert_eq!(first_class, single, "{name}");
        assert!(
            first_class["outputSchema"].is_object(),
            "{name} has outputSchema"
        );
        assert!(
            first_class["inputSchema"].is_object(),
            "{name} has inputSchema"
        );
    }
}

#[tokio::test]
async fn the_first_class_tools_are_workspace_show_then_event_list() {
    let dir = minimal();
    let host = host(dir.path());
    assert_eq!(host.first_class_tools(), ["workspace-show", "event-list"]);
}

// server_hybrid.rs: afd-help reports the strategy and the first-class set
#[tokio::test]
async fn afd_help_reports_the_strategy_and_the_first_class_tools_on_every_lane() {
    let dir = minimal();
    let host = host(dir.path());
    for mut client in Client::lanes(&host).await {
        let label = client.label();
        let result = client
            .afd_call("afd-help", json!({ "format": "brief" }))
            .await;
        assert_eq!(result["success"], true, "{label}: {result}");
        assert_eq!(
            result["data"]["toolStrategy"], "hybrid",
            "{label}: {result}"
        );
        assert_eq!(
            names(&result["data"]["firstClassTools"]),
            host.first_class_tools(),
            "{label}"
        );
    }
}

#[tokio::test]
async fn afd_discover_lists_every_mcp_exposed_command_and_not_cli_only_ones() {
    let dir = minimal();
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(with_exposure(
            fixture("fixture-cli-only", |_, _| afd::success(json!({}))),
            false,
            false,
            true,
        ))
        .register(with_exposure(
            fixture("fixture-agent", |_, _| afd::success(json!({}))),
            true,
            true,
            false,
        ))
        .seal()
        .unwrap();
    for mut client in Client::lanes(&host).await {
        let label = client.label();
        let result = client.call("afd-discover", json!({ "limit": 200 })).await;
        assert_eq!(result["success"], true, "{label}: {result}");
        let listed: Vec<String> = result["data"]["commands"]
            .as_array()
            .unwrap_or_else(|| panic!("{label}: {result}"))
            .iter()
            .map(|command| command["name"].as_str().unwrap().to_owned())
            .collect();
        let expected = [
            "workspace-show",
            "space-list",
            "workspace-doctor",
            "afd-help",
            "afd-docs",
            "afd-schema",
            "event-list",
            "event-ack",
            "fixture-agent",
        ];
        for name in expected {
            assert!(
                listed.iter().any(|listed| listed == name),
                "{label}: {name} in {listed:?}"
            );
        }
        for hidden in ["fixture-cli-only", "event-rebuild"] {
            assert!(
                !listed.iter().any(|listed| listed == hidden),
                "{label}: {hidden}"
            );
        }
    }
}

#[tokio::test]
async fn afd_call_runs_workspace_doctor_and_space_list_and_afd_batch_runs_two_reads() {
    let dir = minimal();
    let host = host(dir.path());
    for mut client in Client::lanes(&host).await {
        let label = client.label();
        let doctor = client.afd_call("workspace-doctor", json!({})).await;
        assert_eq!(doctor["success"], true, "{label}: {doctor}");
        assert_eq!(doctor["data"]["healthy"], true, "{label}");
        let spaces = client.afd_call("space-list", json!({})).await;
        assert_eq!(spaces["success"], true, "{label}: {spaces}");
        assert_eq!(spaces["data"]["spaces"][0]["id"], "main");

        let batch = client
            .call(
                "afd-batch",
                json!({ "commands": [
                    { "command": "workspace-show", "input": {} },
                    { "command": "space-list", "input": {} },
                ] }),
            )
            .await;
        assert_eq!(batch["success"], true, "{label}: {batch}");
        let results = batch["results"]
            .as_array()
            .unwrap_or_else(|| panic!("{label}: {batch}"));
        assert_eq!(results.len(), 2, "{label}");
        for item in results {
            assert_eq!(item["result"]["success"], true, "{label}: {item}");
        }
    }
}

#[tokio::test]
async fn a_cli_only_command_cannot_be_called_through_afd_call() {
    let dir = minimal();
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(with_exposure(
            fixture("fixture-cli-only", |_, _| afd::success(json!({}))),
            false,
            false,
            true,
        ))
        .seal()
        .unwrap();
    for mut client in Client::lanes(&host).await {
        let result = client.afd_call("fixture-cli-only", json!({})).await;
        assert_eq!(
            result["error"]["code"],
            "COMMAND_NOT_FOUND",
            "{}",
            client.label()
        );
    }
}

#[tokio::test]
async fn every_lane_lists_the_same_tools() {
    let dir = minimal();
    let host = host(dir.path());
    for mut client in Client::lanes(&host).await {
        assert_eq!(
            client.tool_names().await,
            default_tools(&host),
            "{}",
            client.label()
        );
    }
    assert_eq!(LANES.len(), 4);
}

mod configuration {
    use super::*;

    fn open_error(config: &str) -> umbel::HostError {
        let dir = workspace(config);
        HostBuilder::open(dir.path()).err().expect("open fails")
    }

    fn seal_error(config: &str) -> umbel::HostError {
        let dir = workspace(config);
        HostBuilder::open(dir.path())
            .unwrap()
            .seal()
            .err()
            .expect("seal fails")
    }

    #[test]
    fn zero_or_nine_names_fail_open_naming_the_key() {
        let error = open_error("config_version = 1\n\n[mcp]\nfirst_class_tools = []\n");
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
        assert!(
            error.message().contains("mcp.first_class_tools"),
            "{}",
            error.message()
        );

        let nine: Vec<String> = (1..=9).map(|n| format!("\"fixture-tool-{n}\"")).collect();
        let error = open_error(&format!(
            "config_version = 1\n\n[mcp]\nfirst_class_tools = [{}]\n",
            nine.join(", ")
        ));
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
        assert!(
            error.message().contains("mcp.first_class_tools"),
            "{}",
            error.message()
        );
    }

    #[test]
    fn an_unknown_name_fails_seal_with_the_servers_message() {
        let error =
            seal_error("config_version = 1\n\n[mcp]\nfirst_class_tools = [\"no-such-command\"]\n");
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
        assert!(
            error.message().contains("mcp.first_class_tools"),
            "{}",
            error.message()
        );
        assert!(
            error.message().contains("no-such-command"),
            "{}",
            error.message()
        );
    }

    #[test]
    fn a_cli_only_name_fails_seal() {
        let dir =
            workspace("config_version = 1\n\n[mcp]\nfirst_class_tools = [\"fixture-cli-only\"]\n");
        let error = HostBuilder::open(dir.path())
            .unwrap()
            .register(with_exposure(
                fixture("fixture-cli-only", |_, _| afd::success(json!({}))),
                false,
                false,
                true,
            ))
            .seal()
            .err()
            .expect("seal fails");
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
        assert!(
            error.message().contains("fixture-cli-only"),
            "{}",
            error.message()
        );
    }

    #[tokio::test]
    async fn an_explicit_set_wins_and_lists_in_its_order() {
        let dir = workspace(
            "config_version = 1\n\n[mcp]\nfirst_class_tools = [\"space-list\", \"workspace-show\"]\n",
        );
        let host = host(dir.path());
        assert_eq!(host.first_class_tools(), ["space-list", "workspace-show"]);
        let mut client = Client::connect(
            &host,
            support::mcp::Transport::Stdio,
            support::mcp::Era::Modern,
        )
        .await;
        assert_eq!(
            client.tool_names().await,
            [
                "afd-discover",
                "afd-detail",
                "afd-call",
                "afd-batch",
                "afd-pipe",
                "space-list",
                "workspace-show"
            ]
        );
    }

    #[tokio::test]
    async fn a_plugin_style_command_can_be_first_class() {
        let dir = workspace(
            "config_version = 1\n\n[mcp]\nfirst_class_tools = [\"workspace-show\", \"fixture-hot\"]\n",
        );
        let host = HostBuilder::open(dir.path())
            .unwrap()
            .register(fixture("fixture-hot", |_, _| {
                afd::success(json!({ "hot": true }))
            }))
            .seal()
            .unwrap();
        let mut client = Client::connect(
            &host,
            support::mcp::Transport::Http,
            support::mcp::Era::Modern,
        )
        .await;
        let result = client.call("fixture-hot", json!({})).await;
        assert_eq!(result["data"]["hot"], true);
    }

    #[tokio::test]
    async fn instructions_are_afds_default_unless_configured() {
        let dir = minimal();
        let host = host(dir.path());
        let http = support::mcp::Http::new(&host);
        let default = http.modern("server/discover", json!({})).await;
        assert!(
            default["result"]["instructions"]
                .as_str()
                .unwrap()
                .contains("afd-discover")
        );

        let dir =
            workspace("config_version = 1\n\n[mcp]\ninstructions = \"Use Umbel carefully.\"\n");
        let host = support::host(dir.path());
        let configured = support::mcp::Http::new(&host)
            .modern("server/discover", json!({}))
            .await;
        assert_eq!(configured["result"]["instructions"], "Use Umbel carefully.");
    }
}
