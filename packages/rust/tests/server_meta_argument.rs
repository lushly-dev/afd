//! The meta-tools' `meta` argument over MCP (`spec/context-fields.md`, "Clients that cannot set
//! `_meta`"), as TypeScript's `meta-argument.test.ts` checks it: `afd-call`, `afd-batch`,
//! `afd-pipe`, `afd-discover` and `afd-detail` apply `meta`'s `dev.afd/context` and declared
//! context field keys as if they came in `_meta`; a key sent both ways must agree; a non-object
//! `meta` is refused; other tools' arguments are untouched.
#![cfg(feature = "server")]

mod common;

use std::sync::Arc;

use afd::context_fields::ContextField;
use afd::server::McpServer;
use afd::{
    success, CommandContext, CommandDefinition, CommandHandler, CommandParameter, CommandRegistry,
    CommandResult, ContextConfig,
};
use async_trait::async_trait;
use common::{command_result, modern_post_with_meta, Stdio};
use serde_json::{json, Value};

/// Returns its input, the active context and the whole of `extra`.
struct Echo;

#[async_trait]
impl CommandHandler for Echo {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        success(json!({
            "input": input,
            "activeContext": context.active_context(),
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

/// `open-echo`'s optional `a` and `meta` inputs: a command of its own may take `meta`.
fn open_parameters() -> Vec<CommandParameter> {
    let meta = serde_json::from_value(json!({
        "name": "meta",
        "type": "object",
        "description": "A command input that happens to be called meta",
    }))
    .unwrap();
    vec![CommandParameter::optional_string("a", "Anything"), meta]
}

/// `scope-echo` and `open-echo` (every context) and `plan-echo` (only `planning`), with two
/// declared fields and two contexts.
fn server() -> McpServer {
    let registry = CommandRegistry::new();
    for (name, contexts) in [
        ("scope-echo", None),
        ("plan-echo", Some("planning")),
        ("open-echo", None),
    ] {
        let parameters = if name == "open-echo" {
            open_parameters()
        } else {
            vec![]
        };
        let mut command = CommandDefinition::new(name, "Echo the call", parameters, Echo);
        if let Some(context) = contexts {
            command = command.with_contexts([context]);
        }
        command.expose.mcp = true;
        registry.register(command).unwrap();
    }
    registry
        .set_context_fields(vec![scope(), locale()])
        .unwrap();
    McpServer::new(Arc::new(registry), "meta-argument-test", "1.0.0")
        .with_contexts(vec![
            ContextConfig::new("planning"),
            ContextConfig::new("review"),
        ])
        .unwrap()
}

/// Both declared fields and a key that is neither declared nor `dev.afd/context`.
fn meta() -> Value {
    json!({
        "dev.example/scope": { "project": "p-1" },
        "dev.example/locale": "en-GB",
        "dev.example/other": "dropped",
    })
}

fn declared() -> Value {
    json!({ "scope": { "project": "p-1" }, "locale": "en-GB" })
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

struct Client {
    lane: Lane,
    server: McpServer,
    stdio: Option<Stdio>,
}

impl Client {
    async fn connect(lane: Lane) -> Self {
        let server = server();
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

    /// `tools/call` with `request_meta` keys in `params._meta`; the raw JSON-RPC response.
    async fn request(&mut self, tool: &str, arguments: Value, request_meta: Value) -> Value {
        let params = json!({ "name": tool, "arguments": arguments });
        if self.lane == Lane::HttpModern {
            return modern_post_with_meta(&self.server, "tools/call", params, request_meta, &[])
                .await;
        }
        let mut all = if self.lane == Lane::StdioModern {
            serde_json::from_str(common::META).unwrap()
        } else {
            json!({})
        };
        if let Value::Object(extra) = request_meta {
            for (key, value) in extra {
                all[key] = value;
            }
        }
        let mut params = params;
        params["_meta"] = all;
        if let Some(stdio) = &mut self.stdio {
            return stdio.request("tools/call", params).await;
        }
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params });
        let headers = [("mcp-protocol-version", "2025-11-25"), ("mcp-name", tool)];
        let (status, response) = common::http_post(&self.server, body, &headers).await;
        assert_eq!(status, 200, "{response}");
        response
    }

    /// The `CommandResult` of a `tools/call`, checked to be a tool result.
    async fn call(&mut self, tool: &str, arguments: Value, request_meta: Value) -> Value {
        let response = self.request(tool, arguments, request_meta).await;
        let result = command_result(&response);
        assert_eq!(
            response["result"]["isError"],
            result["success"] == false,
            "{:?}: {response}",
            self.lane
        );
        result
    }
}

fn discovered(result: &Value) -> Vec<String> {
    result["data"]["commands"]
        .as_array()
        .unwrap_or_else(|| panic!("{result}"))
        .iter()
        .map(|command| command["name"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn declared_fields_via_meta_reach_afd_call_on_every_lane() {
    for lane in LANES {
        let mut client = Client::connect(lane).await;
        let result = client
            .call(
                "afd-call",
                json!({ "command": "open-echo", "input": { "a": "x" }, "meta": meta() }),
                json!({}),
            )
            .await;
        assert_eq!(result["success"], true, "{lane:?}: {result}");
        assert_eq!(result["data"]["extra"], declared(), "{lane:?}: {result}");
        assert_eq!(result["data"]["input"], json!({ "a": "x" }), "{lane:?}");
    }
}

#[tokio::test]
async fn declared_fields_via_meta_reach_every_batch_and_pipeline_step() {
    for lane in [Lane::HttpModern, Lane::StdioLegacy] {
        let mut client = Client::connect(lane).await;
        let batch = client
            .call(
                "afd-batch",
                json!({
                    "commands": [{ "command": "scope-echo" }, { "command": "scope-echo" }],
                    "meta": meta(),
                }),
                json!({}),
            )
            .await;
        let results = batch["results"].as_array().unwrap();
        assert_eq!(results.len(), 2, "{lane:?}: {batch}");
        for item in results {
            assert_eq!(
                item["result"]["data"]["extra"],
                declared(),
                "{lane:?}: {batch}"
            );
        }

        let pipe = client
            .call(
                "afd-pipe",
                json!({
                    "steps": [{ "command": "scope-echo" }, { "command": "scope-echo" }],
                    "meta": meta(),
                }),
                json!({}),
            )
            .await;
        let steps = pipe["steps"].as_array().unwrap();
        assert_eq!(steps.len(), 2, "{lane:?}: {pipe}");
        for step in steps {
            assert_eq!(step["data"]["extra"], declared(), "{lane:?}: {pipe}");
        }
    }
}

#[tokio::test]
async fn the_afd_context_via_meta_scopes_afd_call_and_afd_discover() {
    for lane in [Lane::HttpModern, Lane::StdioModern] {
        let mut client = Client::connect(lane).await;
        let planning = json!({ "dev.afd/context": "planning" });
        let review = json!({ "dev.afd/context": "review" });

        let ran = client
            .call(
                "afd-call",
                json!({ "command": "plan-echo", "meta": planning }),
                json!({}),
            )
            .await;
        assert_eq!(ran["success"], true, "{lane:?}: {ran}");
        assert_eq!(ran["data"]["activeContext"], "planning", "{lane:?}: {ran}");

        let denied = client
            .call(
                "afd-call",
                json!({ "command": "plan-echo", "meta": review }),
                json!({}),
            )
            .await;
        assert_eq!(
            denied["error"]["code"], "COMMAND_NOT_IN_CONTEXT",
            "{lane:?}: {denied}"
        );

        let found = client
            .call("afd-discover", json!({ "meta": planning }), json!({}))
            .await;
        assert!(
            discovered(&found).contains(&"plan-echo".to_owned()),
            "{found}"
        );
        let found = client
            .call("afd-discover", json!({ "meta": review }), json!({}))
            .await;
        assert!(
            !discovered(&found).contains(&"plan-echo".to_owned()),
            "{found}"
        );
        assert!(
            discovered(&found).contains(&"scope-echo".to_owned()),
            "{found}"
        );

        // afd-detail takes it too, and its own arguments still check.
        let detail = client
            .call(
                "afd-detail",
                json!({ "command": "scope-echo", "meta": review }),
                json!({}),
            )
            .await;
        assert_eq!(detail["success"], true, "{lane:?}: {detail}");
    }
}

#[tokio::test]
async fn an_unknown_context_via_meta_is_refused_as_in_meta() {
    let mut client = Client::connect(Lane::HttpModern).await;
    let response = client
        .request(
            "afd-call",
            json!({ "command": "scope-echo", "meta": { "dev.afd/context": "nowhere" } }),
            json!({}),
        )
        .await;
    assert_eq!(response["error"]["code"], -32602, "{response}");
}

#[tokio::test]
async fn a_disagreement_with_meta_is_a_validation_error() {
    for lane in [Lane::HttpModern, Lane::StdioLegacy] {
        let mut client = Client::connect(lane).await;
        let result = client
            .call(
                "afd-call",
                json!({ "command": "scope-echo", "meta": { "dev.example/locale": "fr-FR" } }),
                json!({ "dev.example/locale": "en-GB" }),
            )
            .await;
        assert_eq!(result["success"], false, "{lane:?}: {result}");
        assert_eq!(result["error"]["code"], "VALIDATION_ERROR");
        assert_eq!(
            result["error"]["message"],
            "_meta[\"dev.example/locale\"] and the meta argument of afd-call disagree"
        );
        assert_eq!(result["error"]["details"]["meta"], "dev.example/locale");
        assert!(result["error"]["suggestion"].is_string());

        // The same value both ways is fine, whatever the key order.
        let result = client
            .call(
                "afd-call",
                json!({
                    "command": "scope-echo",
                    "meta": { "dev.example/scope": { "project": "p-1" } },
                }),
                json!({ "dev.example/scope": { "project": "p-1" }, "dev.example/locale": "en-GB" }),
            )
            .await;
        assert_eq!(result["success"], true, "{lane:?}: {result}");
        assert_eq!(result["data"]["extra"], declared(), "{lane:?}: {result}");
    }
}

#[tokio::test]
async fn a_non_object_meta_is_a_validation_error() {
    let mut client = Client::connect(Lane::HttpModern).await;
    for tool in [
        "afd-call",
        "afd-batch",
        "afd-pipe",
        "afd-discover",
        "afd-detail",
    ] {
        let result = client
            .call(tool, json!({ "meta": "dev.example/locale" }), json!({}))
            .await;
        assert_eq!(result["success"], false, "{tool}: {result}");
        assert_eq!(result["error"]["code"], "VALIDATION_ERROR", "{tool}");
        assert_eq!(
            result["error"]["message"],
            format!("The meta argument of {tool} must be an object")
        );
        assert_eq!(result["error"]["details"]["argument"], "meta", "{tool}");
    }
}

#[tokio::test]
async fn an_invalid_field_value_via_meta_is_the_fields_validation_error() {
    let mut client = Client::connect(Lane::HttpModern).await;
    let result = client
        .call(
            "afd-call",
            json!({ "command": "scope-echo", "meta": { "dev.example/scope": { "project": 7 } } }),
            json!({}),
        )
        .await;
    assert_eq!(result["success"], false, "{result}");
    assert_eq!(result["error"]["code"], "VALIDATION_ERROR");
    assert_eq!(
        result["error"]["message"],
        "Context field 'scope' is not valid"
    );
    assert_eq!(result["error"]["details"]["field"], "scope");
    assert_eq!(result["error"]["details"]["meta"], "dev.example/scope");
}

#[tokio::test]
async fn other_tools_keep_their_meta_argument() {
    let mut client = Client::connect(Lane::HttpModern).await;
    let result = client
        .call("open-echo", json!({ "meta": meta() }), json!({}))
        .await;
    assert_eq!(result["success"], true, "{result}");
    assert_eq!(result["data"]["input"], json!({ "meta": meta() }));
    assert_eq!(result["data"]["extra"], json!({}), "{result}");
}

#[tokio::test]
async fn the_context_hook_wins_over_a_field_via_meta() {
    let server = server().with_context_hook(|_request, context| async move {
        Ok(context.with_extra("locale", json!("fr-FR")))
    });
    let response = modern_post_with_meta(
        &server,
        "tools/call",
        json!({ "name": "afd-call", "arguments": { "command": "scope-echo", "meta": meta() } }),
        json!({}),
        &[],
    )
    .await;
    let result = command_result(&response);
    assert_eq!(
        result["data"]["extra"],
        json!({ "scope": { "project": "p-1" }, "locale": "fr-FR" }),
        "{result}"
    );
}
