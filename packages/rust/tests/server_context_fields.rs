//! Declared context fields over MCP (`spec/context-fields.md`), as TypeScript's
//! `context-fields-mcp.test.ts` checks them: `tools/call` reads each field from `params._meta`
//! on both eras, over Streamable HTTP and a stdio-shaped connection; the context hook wins;
//! undeclared keys are dropped; an invalid value is a `VALIDATION_ERROR` tool result naming the
//! field; `tools/list` does not vary; `server/discover` and `afd-help` list the fields.
#![cfg(feature = "server")]

mod common;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use afd::context_fields::{ContextField, AFD_CONTEXT_FIELDS_META_KEY};
use afd::server::{McpServer, ToolStrategy, DEFAULT_TOOLS_LIST_TTL_MS};
use afd::{
    register_bootstrap_commands, success, CommandContext, CommandDefinition, CommandHandler,
    CommandRegistry, CommandResult, ContextConfig,
};
use async_trait::async_trait;
use common::{command_result, modern_post_with_meta, Stdio};
use serde_json::{json, Value};

/// Returns the declared fields the call sees, and the whole of `extra`.
struct ScopeEcho;

#[async_trait]
impl CommandHandler for ScopeEcho {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        success(json!({
            "scope": context.extra.get("scope"),
            "locale": context.extra.get("locale"),
            "extra": context.extra,
        }))
    }
}

fn scope() -> ContextField {
    ContextField::new(
        "scope",
        "dev.example/scope",
        json!({"type": "object", "properties": {"project": {"type": "string"}}, "required": ["project"]}),
    )
}

fn locale() -> ContextField {
    ContextField::new(
        "locale",
        "dev.example/locale",
        json!({"type": "string", "maxLength": 35}),
    )
}

/// `scope-echo` (exposed to MCP) and the bootstrap commands, with `fields` declared.
fn registry_with(fields: Vec<ContextField>) -> Arc<CommandRegistry> {
    let registry = Arc::new(CommandRegistry::new());
    let mut echo = CommandDefinition::new(
        "scope-echo",
        "Return the declared fields the call sees",
        vec![],
        ScopeEcho,
    );
    echo.expose.mcp = true;
    registry.register(echo).unwrap();
    register_bootstrap_commands(&registry).unwrap();
    registry.set_context_fields(fields).unwrap();
    registry
}

fn server_with(fields: Vec<ContextField>) -> McpServer {
    McpServer::new(registry_with(fields), "fields-test", "1.0.0")
}

fn server() -> McpServer {
    server_with(vec![scope(), locale()])
}

/// Two declared keys and one that is not.
fn meta() -> Value {
    json!({
        "dev.example/scope": { "project": "p-1" },
        "dev.example/locale": "en-GB",
        "dev.example/other": "dropped",
    })
}

/// `scope()` and `locale()` as discovery lists them.
fn described() -> Value {
    json!([
        {
            "name": "scope",
            "meta": "dev.example/scope",
            "schema": {"type": "object", "properties": {"project": {"type": "string"}}, "required": ["project"]},
            "required": false,
            "journal": false,
        },
        {
            "name": "locale",
            "meta": "dev.example/locale",
            "schema": {"type": "string", "maxLength": 35},
            "required": false,
            "journal": false,
        },
    ])
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

/// A client of one server on one lane: MCP 2026-07-28 (per-request `_meta` envelope) or a 2025
/// client (a stdio connection that opened with `initialize`, or a request to the stateless HTTP
/// endpoint), each sending `_meta` in `params`.
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

    fn is_modern(&self) -> bool {
        matches!(self.lane, Lane::HttpModern | Lane::StdioModern)
    }

    /// `method` with `params` and the `meta` keys in `params._meta` (after the 2026-07-28
    /// envelope keys on a modern lane).
    async fn request(&mut self, method: &str, params: Value, meta: Value) -> Value {
        if self.lane == Lane::HttpModern {
            return modern_post_with_meta(&self.server, method, params, meta, &[]).await;
        }
        let mut all = if self.is_modern() {
            serde_json::from_str(common::META).unwrap()
        } else {
            json!({})
        };
        if let Value::Object(extra) = meta {
            for (key, value) in extra {
                all[key] = value;
            }
        }
        let mut params = params;
        params["_meta"] = all;
        if let Some(stdio) = &mut self.stdio {
            return stdio.request(method, params).await;
        }
        let name = params["name"].as_str().map(str::to_owned);
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let mut headers = vec![("mcp-protocol-version", "2025-11-25")];
        if let Some(name) = name.as_deref() {
            headers.push(("mcp-name", name));
        }
        let (status, response) = common::http_post(&self.server, body, &headers).await;
        assert_eq!(status, 200, "{response}");
        response
    }

    /// The `CommandResult` of a `tools/call`, checked to be a tool result.
    async fn call(&mut self, tool: &str, arguments: Value, meta: Value) -> Value {
        let response = self
            .request(
                "tools/call",
                json!({ "name": tool, "arguments": arguments }),
                meta,
            )
            .await;
        let result = command_result(&response);
        assert_eq!(
            response["result"]["structuredContent"], result,
            "{:?}: {response}",
            self.lane
        );
        assert_eq!(
            response["result"]["isError"],
            result["success"] == false,
            "{:?}: {response}",
            self.lane
        );
        result
    }
}

#[tokio::test]
async fn declared_values_reach_the_handler_on_every_lane_and_undeclared_keys_are_dropped() {
    for lane in LANES {
        let mut client = Client::connect(server(), lane).await;
        let result = client.call("scope-echo", json!({}), meta()).await;
        assert_eq!(result["success"], true, "{lane:?}: {result}");
        assert_eq!(
            result["data"]["extra"],
            json!({ "scope": { "project": "p-1" }, "locale": "en-GB" }),
            "{lane:?}: {result}"
        );
        // Without `_meta`, no value: the fields are optional.
        let result = client.call("scope-echo", json!({}), json!({})).await;
        assert_eq!(result["success"], true, "{lane:?}: {result}");
        assert_eq!(result["data"]["extra"], json!({}), "{lane:?}: {result}");
    }
}

#[tokio::test]
async fn an_invalid_value_is_a_validation_error_naming_the_field_on_every_lane() {
    for lane in LANES {
        let mut client = Client::connect(server(), lane).await;
        let result = client
            .call(
                "scope-echo",
                json!({}),
                json!({ "dev.example/scope": { "project": 7 } }),
            )
            .await;
        assert_eq!(result["success"], false, "{lane:?}: {result}");
        let error = &result["error"];
        assert_eq!(error["code"], "VALIDATION_ERROR", "{lane:?}: {result}");
        assert_eq!(error["message"], "Context field 'scope' is not valid");
        assert_eq!(error["details"]["field"], "scope", "{lane:?}: {result}");
        assert_eq!(error["details"]["meta"], "dev.example/scope");
        assert_eq!(error["details"]["errors"][0]["path"], "project");
        assert!(
            error["suggestion"]
                .as_str()
                .unwrap()
                .contains(AFD_CONTEXT_FIELDS_META_KEY),
            "{lane:?}: {result}"
        );

        let long = "x".repeat(36);
        let result = client
            .call(
                "scope-echo",
                json!({}),
                json!({ "dev.example/locale": long }),
            )
            .await;
        assert_eq!(
            result["error"]["details"]["field"], "locale",
            "{lane:?}: {result}"
        );
    }
}

#[tokio::test]
async fn a_value_the_context_hook_sets_wins_on_every_lane() {
    for lane in LANES {
        let saw_caller_values = Arc::new(AtomicBool::new(false));
        let saw = Arc::clone(&saw_caller_values);
        // Trusted code sets the locale, and overrules the caller's scope with `null`.
        let server = server().with_context_hook(move |_request, context| {
            saw.fetch_or(!context.extra.is_empty(), Ordering::SeqCst);
            async move {
                Ok(context
                    .with_extra("locale", json!("fr-FR"))
                    .with_extra("scope", Value::Null))
            }
        });
        let mut client = Client::connect(server, lane).await;
        let result = client.call("scope-echo", json!({}), meta()).await;
        assert_eq!(result["success"], true, "{lane:?}: {result}");
        assert_eq!(
            result["data"]["extra"],
            json!({ "scope": null, "locale": "fr-FR" }),
            "{lane:?}: {result}"
        );
        // The hook never sees the caller's values, so it cannot mistake them for verified ones.
        assert!(!saw_caller_values.load(Ordering::SeqCst), "{lane:?}");

        // A hook that sets neither name leaves the caller's values in place.
        let server = server_with(vec![scope(), locale()])
            .with_context_hook(|_request, context| async move { Ok(context) });
        let mut client = Client::connect(server, lane).await;
        let result = client.call("scope-echo", json!({}), meta()).await;
        assert_eq!(result["data"]["locale"], "en-GB", "{lane:?}: {result}");
    }
}

#[tokio::test]
async fn every_route_runs_with_the_values() {
    let routes = [
        ("scope-echo", json!({})),
        ("scope", json!({ "action": "echo" })),
        ("afd-call", json!({ "command": "scope-echo" })),
        (
            "afd-batch",
            json!({ "commands": [{ "command": "scope-echo" }, { "command": "scope-echo" }] }),
        ),
        (
            "afd-pipe",
            json!({ "steps": [{ "command": "scope-echo" }, { "command": "scope-echo" }] }),
        ),
    ];
    for lane in [Lane::HttpModern, Lane::StdioLegacy] {
        let mut client = Client::connect(server(), lane).await;
        for (tool, arguments) in routes.clone() {
            let result = client.call(tool, arguments, meta()).await;
            let seen: Vec<Value> = match tool {
                "afd-batch" => result["results"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|item| item["result"]["data"].clone())
                    .collect(),
                "afd-pipe" => result["steps"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|step| step["data"].clone())
                    .collect(),
                _ => vec![result["data"].clone()],
            };
            assert!(!seen.is_empty(), "{lane:?} {tool}: {result}");
            for data in seen {
                assert_eq!(
                    data["extra"],
                    json!({ "scope": { "project": "p-1" }, "locale": "en-GB" }),
                    "{lane:?} {tool}: {result}"
                );
            }
        }
    }
}

#[tokio::test]
async fn an_afd_batch_context_argument_never_reaches_extra() {
    // `context` is not an `afd-batch` argument (`spec/meta-tools.json`), so it is ignored like
    // any other argument the tool does not declare: a declared field cannot arrive outside
    // `_meta`, and neither can any other `extra` key.
    for lane in [Lane::HttpModern, Lane::StdioLegacy] {
        let mut client = Client::connect(server(), lane).await;
        for context in [
            json!({ "scope": { "project": "from-arguments" }, "tenant": "acme" }),
            json!("not an object"),
        ] {
            let arguments = json!({
                "commands": [{ "command": "scope-echo" }],
                "context": context,
                "undeclared": true,
            });
            let result = client.call("afd-batch", arguments.clone(), json!({})).await;
            assert_eq!(result["success"], true, "{lane:?}: {result}");
            assert_eq!(
                result["results"][0]["result"]["data"]["extra"],
                json!({}),
                "{lane:?}: {result}"
            );

            // `_meta` still delivers the declared fields, and nothing is added beside them.
            let result = client.call("afd-batch", arguments, meta()).await;
            assert_eq!(
                result["results"][0]["result"]["data"]["extra"],
                json!({ "scope": { "project": "p-1" }, "locale": "en-GB" }),
                "{lane:?}: {result}"
            );
        }
    }
}

#[tokio::test]
async fn a_required_field_is_enforced_except_for_afd_commands_on_every_lane() {
    for lane in LANES {
        let mut client =
            Client::connect(server_with(vec![scope().with_required(true)]), lane).await;
        let result = client.call("scope-echo", json!({}), json!({})).await;
        assert_eq!(
            result["error"]["code"], "VALIDATION_ERROR",
            "{lane:?}: {result}"
        );
        assert_eq!(
            result["error"]["message"],
            "Context field 'scope' is required"
        );
        // A client can discover the fields before it sends them.
        let help = client.call("afd-help", json!({}), json!({})).await;
        assert_eq!(help["success"], true, "{lane:?}: {help}");
        assert_eq!(help["data"]["contextFields"][0]["required"], true);
        let result = client
            .call(
                "scope-echo",
                json!({}),
                json!({ "dev.example/scope": { "project": "p-1" } }),
            )
            .await;
        assert_eq!(result["success"], true, "{lane:?}: {result}");
    }
}

#[tokio::test]
async fn declared_fields_and_the_afd_context_are_read_from_the_same_meta() {
    for lane in [Lane::HttpModern, Lane::StdioModern] {
        let server = server()
            .with_contexts(vec![ContextConfig::new("review")])
            .unwrap();
        let mut client = Client::connect(server, lane).await;
        let mut both = meta();
        both["dev.afd/context"] = json!("review");
        let result = client.call("scope-echo", json!({}), both).await;
        assert_eq!(result["success"], true, "{lane:?}: {result}");
        assert_eq!(result["data"]["locale"], "en-GB", "{lane:?}: {result}");
    }
}

#[tokio::test]
async fn tools_list_does_not_vary_by_a_declared_field_on_every_lane() {
    for strategy in [ToolStrategy::Grouped, ToolStrategy::Individual] {
        for lane in LANES {
            let undeclared = server_with(vec![]).with_tool_strategy(strategy);
            let mut baseline = Client::connect(undeclared, lane).await;
            let without_fields = baseline.request("tools/list", json!({}), json!({})).await;

            let mut client = Client::connect(server().with_tool_strategy(strategy), lane).await;
            let plain = client.request("tools/list", json!({}), json!({})).await;
            let with_meta = client.request("tools/list", json!({}), meta()).await;
            let label = format!("{strategy:?} {lane:?}");
            assert!(plain["result"]["tools"].is_array(), "{label}: {plain}");
            assert_eq!(
                with_meta["result"]["tools"], plain["result"]["tools"],
                "{label}"
            );
            // Declaring the fields changes nothing in the list either.
            assert_eq!(
                plain["result"]["tools"], without_fields["result"]["tools"],
                "{label}"
            );
            if client.is_modern() {
                // So the cache hint is unaffected.
                for response in [&plain, &with_meta] {
                    assert_eq!(
                        response["result"]["ttlMs"], DEFAULT_TOOLS_LIST_TTL_MS,
                        "{label}"
                    );
                    assert_eq!(response["result"]["cacheScope"], "public", "{label}");
                }
            }
        }
    }
}

/// Fails if an `rmcp` upgrade stops calling `ServerHandler::discover` for `server/discover`, or
/// stops serializing `DiscoverResult::meta` as the result's `_meta`.
#[tokio::test]
async fn server_discover_lists_the_fields_over_both_transports() {
    for lane in [Lane::HttpModern, Lane::StdioModern] {
        let mut client = Client::connect(server(), lane).await;
        let response = client
            .request("server/discover", json!({}), json!({}))
            .await;
        let result = &response["result"];
        assert!(
            result["supportedVersions"]
                .as_array()
                .unwrap()
                .contains(&json!("2026-07-28")),
            "{lane:?}: {response}"
        );
        assert_eq!(
            result["_meta"][AFD_CONTEXT_FIELDS_META_KEY],
            described(),
            "{lane:?}: {response}"
        );
        // Next to, not instead of, the server info the SDK keeps in `_meta`.
        assert_eq!(
            result["_meta"]["io.modelcontextprotocol/serverInfo"]["name"], "fields-test",
            "{lane:?}: {response}"
        );
        assert_eq!(result["ttlMs"], DEFAULT_TOOLS_LIST_TTL_MS, "{lane:?}");

        // Left out when no field is declared.
        let mut client = Client::connect(server_with(vec![]), lane).await;
        let response = client
            .request("server/discover", json!({}), json!({}))
            .await;
        assert!(
            response["result"]["_meta"]
                .get(AFD_CONTEXT_FIELDS_META_KEY)
                .is_none(),
            "{lane:?}: {response}"
        );
        assert_eq!(
            response["result"]["_meta"]["io.modelcontextprotocol/serverInfo"]["name"],
            "fields-test"
        );
    }
}

#[tokio::test]
async fn afd_help_lists_the_fields_on_every_lane() {
    for lane in LANES {
        let mut client = Client::connect(server(), lane).await;
        let help = client.call("afd-help", json!({}), json!({})).await;
        assert_eq!(help["success"], true, "{lane:?}: {help}");
        assert_eq!(help["data"]["contextFields"], described(), "{lane:?}");

        let mut client = Client::connect(server_with(vec![]), lane).await;
        let help = client.call("afd-help", json!({}), json!({})).await;
        assert!(
            help["data"].get("contextFields").is_none(),
            "{lane:?}: {help}"
        );
    }
}
