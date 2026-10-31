//! The hybrid tool strategy (`spec/tool-strategies.md`, H1 to H8): every case of the shared
//! `spec/tool-strategies.json` over Streamable HTTP and a stdio-shaped connection, in both MCP
//! eras, plus the checks the cases cannot express (tools equal the individual strategy's, the
//! context hook, confirmations, the panic guard and `afd-help`).
#![cfg(feature = "server")]

mod common;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use afd::server::{
    ConfirmationMode, ContextHookRequest, HttpOptions, McpServer, ToolStrategy,
    MAX_FIRST_CLASS_TOOLS,
};
use afd::{
    register_bootstrap_commands, success, CommandContext, CommandDefinition, CommandError,
    CommandHandler, CommandRegistry, CommandResult, ContextConfig, ExposeOptions, JsonSchema,
    JsonSchemaType,
};
use async_trait::async_trait;
use common::{command_result, modern_post, modern_post_with_meta, Stdio};
use rmcp::ServerHandler;
use serde_json::{json, Value};

/// Succeeds with its input as data (the shared cases' only handler).
struct Echo(Arc<AtomicUsize>);

#[async_trait]
impl CommandHandler for Echo {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        self.0.fetch_add(1, Ordering::SeqCst);
        success(input)
    }
}

struct Boom;

#[async_trait]
impl CommandHandler for Boom {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        panic!("first-class handler failed");
    }
}

fn cases() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/tool-strategies.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("spec/tool-strategies.json"))
        .expect("valid JSON")
}

fn strategy(name: &str) -> ToolStrategy {
    match name {
        "individual" => ToolStrategy::Individual,
        "grouped" => ToolStrategy::Grouped,
        "lazy" => ToolStrategy::Lazy,
        "hybrid" => ToolStrategy::Hybrid,
        other => panic!("unknown strategy {other}"),
    }
}

fn names(value: &Value) -> Vec<String> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|name| name.as_str().unwrap().to_owned())
        .collect()
}

fn registry_of(cases: &Value, runs: &Arc<AtomicUsize>) -> Arc<CommandRegistry> {
    let registry = CommandRegistry::new();
    for command in cases["commands"].as_array().unwrap() {
        let mut definition = CommandDefinition::new(
            command["name"].as_str().unwrap(),
            command["description"].as_str().unwrap(),
            vec![],
            Echo(Arc::clone(runs)),
        )
        .with_expose(ExposeOptions::new().with_mcp(command["expose"]["mcp"] == true));
        if command["mutation"] == true {
            definition = definition.as_mutation();
        }
        if let Some(destructive) = command["destructive"].as_bool() {
            definition = definition.with_destructive(destructive);
        }
        if let Some(prompt) = command["confirmPrompt"].as_str() {
            definition = definition.with_confirm_prompt(prompt);
        }
        if let Some(contexts) = command.get("contexts") {
            definition = definition.with_contexts(names(contexts));
        }
        registry.register(definition).unwrap();
    }
    Arc::new(registry)
}

fn context_configs(cases: &Value) -> Vec<ContextConfig> {
    cases["contexts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|context| {
            ContextConfig::new(context["name"].as_str().unwrap())
                .with_description(context["description"].as_str().unwrap())
        })
        .collect()
}

/// The server a case's `config` describes, before any check: the checks are the tests'.
fn build(cases: &Value, config: &Value, runs: &Arc<AtomicUsize>) -> McpServer {
    let registry = registry_of(cases, runs);
    if config["bootstrap"] == true {
        register_bootstrap_commands(&registry).unwrap();
    }
    let mut server = McpServer::new(registry, "strategies", "1.0.0")
        .with_tool_strategy(strategy(config["toolStrategy"].as_str().unwrap()));
    if config["contexts"] == true {
        server = server.with_contexts(context_configs(cases)).unwrap();
    }
    if let Some(entries) = config.get("firstClassTools") {
        server = server.with_first_class_tools(names(entries));
    }
    if config["confirmations"] == "enforce" {
        server = server.with_confirmations(ConfirmationMode::Enforce);
    }
    if let Some(ttl) = config["toolsListTtlMs"].as_u64() {
        server = server.with_tools_list_ttl_ms(ttl);
    }
    server
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Lane {
    HttpModern,
    StdioModern,
    HttpLegacy,
    StdioLegacy,
}

const LANES: [Lane; 4] = [
    Lane::HttpModern,
    Lane::StdioModern,
    Lane::HttpLegacy,
    Lane::StdioLegacy,
];

/// A client of one server on one lane. A modern request names its context in `_meta`; a 2025
/// stdio connection enters it; a 2025 request over stateless HTTP has no session, so it cannot.
struct Client {
    lane: Lane,
    server: McpServer,
    stdio: Option<Stdio>,
}

impl Client {
    async fn connect(server: McpServer, lane: Lane) -> Self {
        let stdio = match lane {
            Lane::StdioModern => Some(Stdio::connect_modern(server.clone())),
            Lane::StdioLegacy => Some(Stdio::connect(server.clone()).await),
            Lane::HttpModern | Lane::HttpLegacy => None,
        };
        Self {
            lane,
            server,
            stdio,
        }
    }

    async fn raw(&mut self, method: &str, params: Value, context: Option<&str>) -> Value {
        let mut params = params;
        match self.lane {
            Lane::HttpModern | Lane::StdioModern => {
                params["_meta"] = json!({
                    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                    "io.modelcontextprotocol/clientCapabilities": {},
                });
                if let Some(context) = context {
                    params["_meta"]["dev.afd/context"] = json!(context);
                }
            }
            Lane::HttpLegacy | Lane::StdioLegacy => {}
        }
        match &mut self.stdio {
            Some(stdio) => stdio.request(method, params).await,
            None if self.lane == Lane::HttpModern => {
                let (params, meta) = split_meta(params);
                modern_post_with_meta(&self.server, method, params, meta, &[]).await
            }
            None => {
                let name = params["name"].as_str().map(str::to_owned);
                let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
                let mut headers = vec![("mcp-protocol-version", "2025-11-25")];
                if let Some(name) = name.as_deref() {
                    headers.push(("mcp-name", name));
                }
                let (_, response) = common::http_post(&self.server, body, &headers).await;
                response
            }
        }
    }

    /// Whether this lane can address `context`.
    fn can_reach(&self, context: Option<&str>) -> bool {
        context.is_none() || self.lane != Lane::HttpLegacy
    }

    /// Run `request` with `context` active, or `None` where the lane cannot.
    async fn in_context(
        &mut self,
        method: &str,
        params: Value,
        context: Option<&str>,
    ) -> Option<Value> {
        if !self.can_reach(context) {
            return None;
        }
        if self.lane == Lane::StdioLegacy {
            if let Some(context) = context {
                let entered = self
                    .raw(
                        "tools/call",
                        json!({ "name": "afd-context-enter", "arguments": { "context": context } }),
                        None,
                    )
                    .await;
                assert_eq!(command_result(&entered)["success"], true, "{entered}");
            }
            let response = self.raw(method, params, None).await;
            if context.is_some() {
                self.raw(
                    "tools/call",
                    json!({ "name": "afd-context-exit", "arguments": {} }),
                    None,
                )
                .await;
            }
            return Some(response);
        }
        Some(self.raw(method, params, context).await)
    }
}

/// `params` without its `_meta`, and the `_meta` keys `modern_post_with_meta` adds itself left out.
fn split_meta(mut params: Value) -> (Value, Value) {
    let meta = params
        .as_object_mut()
        .and_then(|object| object.remove("_meta"))
        .unwrap_or_else(|| json!({}));
    (params, meta)
}

fn tool_names(response: &Value) -> Vec<String> {
    response["result"]["tools"]
        .as_array()
        .unwrap_or_else(|| panic!("no tools: {response}"))
        .iter()
        .map(|tool| tool["name"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn the_lists_and_ttls_match_the_shared_cases() {
    let cases = cases();
    for case in cases["servers"].as_array().unwrap() {
        for lane in LANES {
            let runs = Arc::new(AtomicUsize::new(0));
            let mut client = Client::connect(build(&cases, &case["config"], &runs), lane).await;
            for list in case["lists"].as_array().unwrap() {
                let context = list["context"].as_str();
                let Some(response) = client.in_context("tools/list", json!({}), context).await
                else {
                    continue;
                };
                let id = &case["id"];
                assert_eq!(
                    tool_names(&response),
                    names(&list["tools"]),
                    "{id} {lane:?} in {context:?}"
                );
                if lane == Lane::HttpModern || lane == Lane::StdioModern {
                    assert_eq!(
                        response["result"]["ttlMs"], case["ttlMs"],
                        "{id} {lane:?} in {context:?}"
                    );
                    assert_eq!(response["result"]["cacheScope"], "public");
                }
            }
        }
    }
}

#[tokio::test]
async fn the_calls_match_the_shared_cases() {
    let cases = cases();
    for case in cases["servers"].as_array().unwrap() {
        for lane in LANES {
            let runs = Arc::new(AtomicUsize::new(0));
            let mut client = Client::connect(build(&cases, &case["config"], &runs), lane).await;
            for call in case["calls"].as_array().unwrap() {
                let context = call["context"].as_str();
                let arguments = call.get("arguments").cloned().unwrap_or_else(|| json!({}));
                let params = json!({ "name": call["tool"], "arguments": arguments });
                let Some(response) = client.in_context("tools/call", params, context).await else {
                    continue;
                };
                let result = command_result(&response);
                let expected = &call["expected"];
                let label = format!("{} {lane:?} {call}", case["id"]);
                assert_eq!(
                    result["success"], expected["success"],
                    "{label}: {response}"
                );
                if let Some(code) = expected.get("code") {
                    assert_eq!(result["error"]["code"], *code, "{label}: {response}");
                }
                assert_eq!(
                    response["result"]["structuredContent"], result,
                    "{label}: structuredContent equals the text"
                );
            }
        }
    }
}

#[tokio::test]
async fn construction_failures_match_the_shared_cases() {
    let cases = cases();
    for failure in cases["constructionFailures"].as_array().unwrap() {
        let runs = Arc::new(AtomicUsize::new(0));
        let server = build(&cases, &failure["config"], &runs);
        let id = &failure["id"];
        let error = server.validate().expect_err(&format!("{id} must fail"));
        if let Some(entry) = failure["entry"].as_str() {
            assert!(error.contains(&format!("'{entry}'")), "{id}: {error}");
        }

        // Every way of starting the server refuses it with the same message.
        let refused = server
            .try_streamable_http_service(HttpOptions::default())
            .err()
            .unwrap_or_else(|| panic!("{id}: the HTTP service started"));
        assert_eq!(refused, error, "{id}");
        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            server.streamable_http_service(HttpOptions::default())
        }));
        assert!(
            panicked.is_err(),
            "{id}: streamable_http_service must panic"
        );
        assert_eq!(
            server.clone().serve_stdio().await.unwrap_err(),
            error,
            "{id}"
        );

        // Over any other transport it answers no request.
        let mut stdio = Stdio::connect(server.clone()).await;
        for method in ["tools/list", "tools/call"] {
            let params = if method == "tools/call" {
                json!({ "name": "note-list", "arguments": {} })
            } else {
                json!({})
            };
            let response = stdio.request(method, params).await;
            assert_eq!(
                response["error"]["code"], -32603,
                "{id} {method}: {response}"
            );
            assert!(
                response["error"]["message"]
                    .as_str()
                    .unwrap()
                    .contains(&error),
                "{id} {method}: {response}"
            );
            assert!(response["result"].is_null(), "{id} {method}: {response}");
        }
    }
}

#[test]
fn entries_are_checked_in_order_so_the_first_over_the_cap_is_named() {
    let cases = cases();
    let runs = Arc::new(AtomicUsize::new(0));
    let config = json!({ "toolStrategy": "hybrid", "contexts": false, "bootstrap": true });
    let nine = [
        "note-list",
        "note-get",
        "note-add",
        "note-update",
        "note-delete",
        "tag-list",
        "tag-add",
        "tag-remove",
        "admin-reset",
        "note-archive",
    ];
    let server = build(&cases, &config, &runs).with_first_class_tools(nine);
    // The cap comes before the later entries' own faults.
    let error = server.validate().unwrap_err();
    assert!(error.contains("'admin-reset'"), "{error}");
    assert!(
        error.contains(&MAX_FIRST_CLASS_TOOLS.to_string()),
        "{error}"
    );
}

#[test]
fn a_command_registered_after_the_set_is_still_checked_at_the_start() {
    let cases = cases();
    let runs = Arc::new(AtomicUsize::new(0));
    let registry = CommandRegistry::new();
    let server = McpServer::new(Arc::new(registry), "late", "1.0.0")
        .with_tool_strategy(ToolStrategy::Hybrid)
        .with_first_class_tools(["note-list"]);
    assert!(server.validate().unwrap_err().contains("'note-list'"));
    let late = registry_of(&cases, &runs);
    let server = McpServer::new(Arc::clone(&late), "late", "1.0.0")
        .with_first_class_tools(["note-list"])
        .with_tool_strategy(ToolStrategy::Hybrid);
    // The builder order does not matter, and a command may follow the server.
    server.validate().unwrap();
}

/// The list of `case`'s server under another strategy, same registry configuration.
fn tools_under(cases: &Value, case: &Value, strategy: ToolStrategy) -> Vec<Value> {
    let mut config = case["config"].clone();
    config["toolStrategy"] = json!(strategy.as_str());
    config.as_object_mut().unwrap().remove("firstClassTools");
    build(cases, &config, &Arc::new(AtomicUsize::new(0))).tools()
}

fn tool(tools: &[Value], name: &str) -> Value {
    tools
        .iter()
        .find(|tool| tool["name"] == name)
        .unwrap_or_else(|| panic!("no tool {name}"))
        .clone()
}

#[test]
fn every_tool_equals_the_one_the_other_strategies_list() {
    let cases = cases();
    for case in cases["servers"].as_array().unwrap() {
        let runs = Arc::new(AtomicUsize::new(0));
        let hybrid = build(&cases, &case["config"], &runs).tools();
        let individual = tools_under(&cases, case, ToolStrategy::Individual);
        let lazy = tools_under(&cases, case, ToolStrategy::Lazy);
        for listed in &hybrid {
            let name = listed["name"].as_str().unwrap();
            let expected = if cases["metaTools"]
                .as_array()
                .unwrap()
                .contains(&json!(name))
            {
                tool(&lazy, name)
            } else {
                tool(&individual, name)
            };
            assert_eq!(*listed, expected, "{} {name}", case["id"]);
        }
    }
}

#[test]
fn a_first_class_tool_carries_confirm_and_output_schema_like_an_individual_tool() {
    let registry = CommandRegistry::new();
    let runs = Arc::new(AtomicUsize::new(0));
    registry
        .register(
            CommandDefinition::new("note-delete", "Delete", vec![], Echo(runs))
                .as_mutation()
                .with_confirm_prompt("Delete this note?")
                .with_returns(JsonSchema {
                    schema_type: Some(JsonSchemaType::Object),
                    ..JsonSchema::default()
                })
                .with_expose(ExposeOptions::new().with_mcp(true)),
        )
        .unwrap();
    let registry = Arc::new(registry);
    let hybrid = McpServer::new(Arc::clone(&registry), "x", "1")
        .with_confirmations(ConfirmationMode::Enforce)
        .with_tool_strategy(ToolStrategy::Hybrid)
        .with_first_class_tools(["note-delete"]);
    let individual = hybrid.clone().with_tool_strategy(ToolStrategy::Individual);
    let listed = tool(&hybrid.tools(), "note-delete");
    assert_eq!(listed, tool(&individual.tools(), "note-delete"));
    assert!(listed["inputSchema"]["properties"]["confirm"].is_object());
    assert!(listed["outputSchema"].is_object(), "{listed}");

    let quiet = hybrid.with_advertise_output_schema(false);
    assert!(tool(&quiet.tools(), "note-delete")
        .get("outputSchema")
        .is_none());
}

#[test]
fn the_list_does_not_depend_on_how_many_other_commands_exist() {
    let cases = cases();
    let case = &cases["servers"][0];
    let runs = Arc::new(AtomicUsize::new(0));
    let small = build(&cases, &case["config"], &runs);
    let before = serde_json::to_string(&small.tools()).unwrap();
    let registry = registry_of(&cases, &runs);
    for index in 0..100 {
        registry
            .register(
                CommandDefinition::new(
                    format!("extra-n{index}"),
                    "Extra",
                    vec![],
                    Echo(Arc::clone(&runs)),
                )
                .with_expose(ExposeOptions::new().with_mcp(true)),
            )
            .unwrap();
    }
    // Commands registered after the server was built change nothing in the list either.
    let big = McpServer::new(registry, "strategies", "1.0.0")
        .with_tool_strategy(ToolStrategy::Hybrid)
        .with_contexts(context_configs(&cases))
        .unwrap()
        .with_first_class_tools(names(&case["config"]["firstClassTools"]));
    assert_eq!(serde_json::to_string(&big.tools()).unwrap(), before);
}

#[tokio::test]
async fn discover_carries_the_hints_and_the_hybrid_instructions_over_both_transports() {
    let cases = cases();
    for case in cases["servers"].as_array().unwrap() {
        let runs = Arc::new(AtomicUsize::new(0));
        for lane in [Lane::HttpModern, Lane::StdioModern] {
            let mut client = Client::connect(build(&cases, &case["config"], &runs), lane).await;
            let response = client.raw("server/discover", json!({}), None).await;
            let result = &response["result"];
            let label = format!("{} {lane:?}: {response}", case["id"]);
            assert_eq!(result["ttlMs"], case["ttlMs"], "{label}");
            assert_eq!(result["cacheScope"], "public", "{label}");
            assert_eq!(
                result["capabilities"]["tools"]["listChanged"], false,
                "{label}"
            );
            let instructions = result["instructions"].as_str().unwrap();
            assert!(
                instructions.contains(
                    "The command tools listed are the common ones. Call afd-discover to find others, afd-detail for a schema, and afd-call to run one."
                ),
                "{label}"
            );
            assert!(instructions.contains("Use afd-batch"), "{label}");
        }
    }
}

#[tokio::test]
async fn list_changed_is_false_on_every_strategy_and_era() {
    let cases = cases();
    let runs = Arc::new(AtomicUsize::new(0));
    for name in ["individual", "grouped", "lazy"] {
        let config = json!({ "toolStrategy": name, "contexts": true, "bootstrap": true });
        let server = build(&cases, &config, &runs);
        let capabilities = server.get_info().capabilities;
        assert_eq!(
            capabilities.tools.unwrap().list_changed,
            Some(false),
            "{name}"
        );
        // Contexts make the default `ttlMs` 0 for these strategies; discover says so too.
        let mut client = Client::connect(server, Lane::HttpModern).await;
        let discovered = client.raw("server/discover", json!({}), None).await;
        assert_eq!(discovered["result"]["ttlMs"], 0, "{name}");
        assert_eq!(discovered["result"]["cacheScope"], "public", "{name}");
    }
}

#[tokio::test]
async fn an_unknown_name_points_to_afd_discover() {
    let cases = cases();
    let runs = Arc::new(AtomicUsize::new(0));
    let case = &cases["servers"][0];
    for lane in LANES {
        let mut client = Client::connect(build(&cases, &case["config"], &runs), lane).await;
        for (tool, arguments) in [
            ("admin-reset", json!({})),
            ("afd-call", json!({ "command": "admin-reset" })),
        ] {
            let response = client
                .in_context(
                    "tools/call",
                    json!({ "name": tool, "arguments": arguments }),
                    None,
                )
                .await
                .unwrap();
            let result = command_result(&response);
            assert_eq!(
                result["error"]["code"], "COMMAND_NOT_FOUND",
                "{lane:?} {tool}"
            );
            let suggestion = result["error"]["suggestion"].as_str().unwrap();
            assert!(
                suggestion.ends_with("Use afd-discover to list all commands."),
                "{lane:?} {tool}: {suggestion}"
            );
        }
        // A private command is indistinguishable from a missing one, by name or through the router.
        let private = client
            .in_context(
                "tools/call",
                json!({ "name": "admin-reset", "arguments": {} }),
                None,
            )
            .await
            .unwrap();
        let missing = client
            .in_context(
                "tools/call",
                json!({ "name": "admin-reset-x", "arguments": {} }),
                None,
            )
            .await
            .unwrap();
        assert_eq!(
            command_result(&private)["error"]["code"],
            command_result(&missing)["error"]["code"]
        );
    }
}

async fn call_result(server: &McpServer, name: &str, arguments: Value) -> Value {
    command_result(
        &modern_post(
            server,
            "tools/call",
            json!({ "name": name, "arguments": arguments }),
            &[],
        )
        .await,
    )
}

#[tokio::test]
async fn afd_help_reports_the_surface_on_every_strategy() {
    let cases = cases();
    let runs = Arc::new(AtomicUsize::new(0));
    let hybrid_case = &cases["servers"][0];
    let hybrid = build(&cases, &hybrid_case["config"], &runs);
    let first_class = names(&hybrid_case["config"]["firstClassTools"]);
    for (route, tool, arguments) in [
        ("by name", "afd-help", json!({})),
        (
            "through afd-call",
            "afd-call",
            json!({ "command": "afd-help", "input": {} }),
        ),
    ] {
        let help = call_result(&hybrid, tool, arguments).await;
        let data = &help["data"];
        assert_eq!(data["toolStrategy"], "hybrid", "{route}");
        assert_eq!(data["firstClassTools"], json!(first_class), "{route}");
        for command in data["commands"].as_array().unwrap() {
            let name = command["name"].as_str().unwrap();
            if first_class.iter().any(|entry| entry == name) {
                assert_eq!(command["firstClass"], true, "{route} {name}");
            } else {
                assert!(command.get("firstClass").is_none(), "{route} {name}");
            }
        }
        // The list is fixed, so the context does not change what afd-help reports.
        let mut client = Client::connect(hybrid.clone(), Lane::HttpModern).await;
        let in_review = client
            .in_context(
                "tools/call",
                json!({ "name": tool, "arguments": arguments_for(tool) }),
                Some("review"),
            )
            .await
            .unwrap();
        assert_eq!(
            command_result(&in_review)["data"]["firstClassTools"],
            json!(first_class)
        );
    }

    // Through a batch and a pipeline.
    let batch = call_result(
        &hybrid,
        "afd-batch",
        json!({ "commands": [{ "command": "afd-help" }] }),
    )
    .await;
    assert_eq!(
        batch["results"][0]["result"]["data"]["toolStrategy"],
        "hybrid"
    );
    let pipe = call_result(
        &hybrid,
        "afd-pipe",
        json!({ "steps": [{ "command": "afd-help" }] }),
    )
    .await;
    assert_eq!(pipe["steps"][0]["data"]["toolStrategy"], "hybrid");

    for name in ["individual", "grouped", "lazy"] {
        let config = json!({ "toolStrategy": name, "contexts": false, "bootstrap": true });
        let server = build(&cases, &config, &runs);
        let call = if name == "lazy" {
            call_result(&server, "afd-call", json!({ "command": "afd-help" })).await
        } else if name == "grouped" {
            call_result(&server, "bootstrap", json!({ "action": "help" })).await
        } else {
            call_result(&server, "afd-help", json!({})).await
        };
        let data = &call["data"];
        assert_eq!(data["toolStrategy"], name);
        assert!(data.get("firstClassTools").is_none(), "{name}");
        assert!(
            data["commands"]
                .as_array()
                .unwrap()
                .iter()
                .all(|command| command.get("firstClass").is_none()),
            "{name}"
        );
    }

    // In process, with no MCP server, afd-help says nothing about tools.
    let registry = registry_of(&cases, &runs);
    register_bootstrap_commands(&registry).unwrap();
    let local = registry.execute("afd-help", json!({}), None).await;
    let data = local.data.unwrap();
    assert!(data.get("toolStrategy").is_none());
    assert!(data.get("firstClassTools").is_none());
}

fn arguments_for(tool: &str) -> Value {
    if tool == "afd-call" {
        json!({ "command": "afd-help", "input": {} })
    } else {
        json!({})
    }
}

/// `note-list` (first-class), `note-delete` (first-class, confirm-gated), `note-boom` (a
/// first-class handler that panics) and `tag-list` (not first-class).
fn guarded(runs: &Arc<AtomicUsize>, mode: ConfirmationMode) -> McpServer {
    let expose = || ExposeOptions::new().with_mcp(true);
    let registry = CommandRegistry::new();
    for name in ["note-list", "tag-list"] {
        registry
            .register(
                CommandDefinition::new(name, "Read", vec![], Echo(Arc::clone(runs)))
                    .with_expose(expose()),
            )
            .unwrap();
    }
    registry
        .register(
            CommandDefinition::new("note-delete", "Delete", vec![], Echo(Arc::clone(runs)))
                .as_mutation()
                .with_confirm_prompt("Delete this note?")
                .with_expose(expose()),
        )
        .unwrap();
    registry
        .register(CommandDefinition::new("note-boom", "Panics", vec![], Boom).with_expose(expose()))
        .unwrap();
    McpServer::new(Arc::new(registry), "guarded", "1.0.0")
        .with_tool_strategy(ToolStrategy::Hybrid)
        .with_first_class_tools(["note-list", "note-delete", "note-boom"])
        .with_confirmations(mode)
}

#[tokio::test]
async fn the_context_hook_runs_on_first_class_calls_and_can_refuse_them() {
    let runs = Arc::new(AtomicUsize::new(0));
    let seen: Arc<std::sync::Mutex<Vec<String>>> = Arc::default();
    let log = Arc::clone(&seen);
    let deny = Arc::new(AtomicBool::new(false));
    let denying = Arc::clone(&deny);
    let server = guarded(&runs, ConfirmationMode::Off).with_context_hook(
        move |request: ContextHookRequest, context: CommandContext| {
            let log = Arc::clone(&log);
            let denying = Arc::clone(&denying);
            async move {
                log.lock().unwrap().push(request.tool.clone());
                if request.tool == "note-list" && denying.load(Ordering::SeqCst) {
                    return Err(CommandError::new("UNAUTHORIZED", "No").with_suggestion("Sign in"));
                }
                Ok(context)
            }
        },
    );
    let allowed = call_result(&server, "note-list", json!({})).await;
    assert_eq!(allowed["success"], true, "{allowed}");
    deny.store(true, Ordering::SeqCst);
    let refused = call_result(&server, "note-list", json!({})).await;
    assert_eq!(refused["error"]["code"], "UNAUTHORIZED", "{refused}");
    assert_eq!(
        runs.load(Ordering::SeqCst),
        1,
        "a refused call runs nothing"
    );
    // An unlisted command by name goes through the hook too.
    let unlisted = call_result(&server, "tag-list", json!({})).await;
    assert_eq!(unlisted["success"], true);
    assert_eq!(
        *seen.lock().unwrap(),
        ["note-list", "note-list", "tag-list"]
    );
}

#[tokio::test]
async fn confirmations_apply_to_first_class_calls_and_to_the_meta_tools() {
    let runs = Arc::new(AtomicUsize::new(0));
    let server = guarded(&runs, ConfirmationMode::Enforce);
    let refused = call_result(&server, "note-delete", json!({})).await;
    assert_eq!(
        refused["error"]["code"], "CONFIRMATION_REQUIRED",
        "{refused}"
    );
    assert_eq!(runs.load(Ordering::SeqCst), 0);
    let ran = call_result(&server, "note-delete", json!({ "confirm": true })).await;
    assert_eq!(ran["success"], true, "{ran}");
    assert_eq!(ran["data"], json!({}), "the acknowledgement is removed");
    assert_eq!(runs.load(Ordering::SeqCst), 1);

    let through_call = call_result(&server, "afd-call", json!({ "command": "note-delete" })).await;
    assert_eq!(through_call["error"]["code"], "CONFIRMATION_REQUIRED");
    let batch = call_result(
        &server,
        "afd-batch",
        json!({ "commands": [{ "command": "note-delete" }], "confirm": ["note-delete"] }),
    )
    .await;
    assert_eq!(batch["success"], true, "{batch}");
    assert_eq!(runs.load(Ordering::SeqCst), 2);

    // A client that can elicit is asked, as for any individual tool.
    let asked = modern_post_with_meta(
        &server,
        "tools/call",
        json!({ "name": "note-delete", "arguments": {} }),
        json!({
            "io.modelcontextprotocol/clientCapabilities": { "elicitation": { "form": {} } },
        }),
        &[],
    )
    .await;
    assert_eq!(asked["result"]["resultType"], "input_required", "{asked}");
    assert_eq!(
        runs.load(Ordering::SeqCst),
        2,
        "nothing ran before the answer"
    );
}

#[tokio::test]
async fn a_panicking_first_class_handler_is_a_failure_and_the_server_keeps_serving() {
    let runs = Arc::new(AtomicUsize::new(0));
    let server = guarded(&runs, ConfirmationMode::Off);
    let mut results: HashMap<&str, Value> = HashMap::new();
    for lane in LANES {
        let mut client = Client::connect(server.clone(), lane).await;
        let boom = client
            .in_context(
                "tools/call",
                json!({ "name": "note-boom", "arguments": {} }),
                None,
            )
            .await
            .unwrap();
        let result = command_result(&boom);
        assert_eq!(
            result["error"]["code"], "COMMAND_EXECUTION_ERROR",
            "{lane:?}"
        );
        assert!(
            !boom.to_string().contains("first-class handler failed"),
            "{boom}"
        );
        let fine = client
            .in_context(
                "tools/call",
                json!({ "name": "note-list", "arguments": {} }),
                None,
            )
            .await
            .unwrap();
        results.insert("fine", command_result(&fine));
        assert_eq!(results["fine"]["success"], true, "{lane:?}");
    }
}
