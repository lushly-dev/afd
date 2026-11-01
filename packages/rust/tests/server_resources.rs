//! MCP resources and the Skills extension (`spec/mcp-resources.md`, R1 to R6 and S1 to S7):
//! every case of the shared `spec/mcp-resources.json` over Streamable HTTP and a stdio-shaped
//! connection, in both MCP eras, plus the rules the cases cannot express (capabilities, cache
//! hints, cursors, headers, templates, subscriptions, directory reads, providers).
#![cfg(feature = "server")]

mod common;

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use afd::server::{
    McpServer, ResourceContents, ResourceEntry, ResourceProvider, ResourceReadError, Skill,
    SkillCatalog, MCP_APP_MIME_TYPE,
};
use afd::CommandRegistry;
use async_trait::async_trait;
use common::{modern_post, Stdio};
use serde_json::{json, Value};

fn cases() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/mcp-resources.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("spec/mcp-resources.json"))
        .expect("valid JSON")
}

/// Standard base64, decoded (the cases give binary files as `base64`).
fn decode(text: &str) -> Vec<u8> {
    let mut out = Vec::new();
    let mut group = 0u32;
    let mut bits = 0;
    for byte in text.bytes().filter(|byte| *byte != b'=') {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            other => panic!("not base64: {other}"),
        };
        group = group << 6 | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((group >> bits) as u8);
            group &= (1 << bits) - 1;
        }
    }
    out
}

fn skills_of(entries: &Value) -> Vec<Skill> {
    entries
        .as_array()
        .unwrap()
        .iter()
        .map(|skill| {
            let mut built = Skill::new(skill["path"].as_str().unwrap());
            for file in skill["files"].as_array().unwrap() {
                let bytes = match file["text"].as_str() {
                    Some(text) => text.as_bytes().to_vec(),
                    None => decode(file["base64"].as_str().unwrap()),
                };
                built = built.with_file(file["path"].as_str().unwrap(), bytes);
            }
            built
        })
        .collect()
}

fn empty_registry() -> Arc<CommandRegistry> {
    Arc::new(CommandRegistry::new())
}

fn server_with(catalog: SkillCatalog) -> McpServer {
    McpServer::new(empty_registry(), "resources", "1.0.0").with_skills(catalog)
}

fn case_server() -> McpServer {
    server_with(SkillCatalog::new(skills_of(&cases()["catalog"]["skills"])).unwrap())
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

impl Lane {
    fn modern(self) -> bool {
        matches!(self, Lane::HttpModern | Lane::StdioModern)
    }
}

/// A client of one server on one lane.
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

    /// The whole JSON-RPC response; `Mcp-Name` is `params.uri` for `resources/read`.
    async fn call(&mut self, method: &str, params: Value) -> Value {
        let mut params = params;
        if self.lane.modern() && self.stdio.is_some() {
            params["_meta"] = serde_json::from_str(common::META).unwrap();
        }
        if let Some(stdio) = &mut self.stdio {
            return stdio.request(method, params).await;
        }
        let uri = params["uri"].as_str().map(str::to_owned);
        if self.lane == Lane::HttpModern {
            params["_meta"] = serde_json::from_str(common::META).unwrap();
            let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
            let mut headers = vec![
                ("mcp-protocol-version", "2026-07-28"),
                ("mcp-method", method),
            ];
            if let ("resources/read" | "resources/subscribe" | "resources/unsubscribe", Some(uri)) =
                (method, uri.as_deref())
            {
                headers.push(("mcp-name", uri));
            }
            return common::http_post(&self.server, body, &headers).await.1;
        }
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let (_, response) = common::http_post(
            &self.server,
            body,
            &[("mcp-protocol-version", "2025-11-25")],
        )
        .await;
        response
    }
}

fn error_of(response: &Value) -> (i64, Value) {
    let error = &response["error"];
    assert!(error.is_object(), "expected an error: {response}");
    (error["code"].as_i64().unwrap(), error["data"].clone())
}

#[test]
fn tool_meta_keys_follow_the_key_rule() {
    use afd::{success, CommandContext, CommandDefinition, CommandHandler, CommandResult};

    struct Nop;
    #[async_trait]
    impl CommandHandler for Nop {
        async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
            success(input)
        }
    }
    for case in cases()["toolMetaKeys"].as_array().unwrap() {
        let key = case["key"].as_str().unwrap();
        let command = CommandDefinition::new("meta-probe", "A probe", vec![], Nop)
            .with_tool_meta(key, case["value"].clone());
        let registered = CommandRegistry::new().register(command);
        if case["allowed"] == true {
            assert_eq!(registered, Ok(()), "{case}");
        } else {
            let error = registered.expect_err(&format!("{case}"));
            assert!(
                error.contains(&format!("\"{key}\"")) && error.contains("meta-probe"),
                "{case}: {error}"
            );
        }
    }
}

#[test]
fn catalog_failures_refuse_to_start_naming_the_entry() {
    for case in cases()["catalogFailures"].as_array().unwrap() {
        let error =
            SkillCatalog::new(skills_of(&case["skills"])).expect_err(&format!("{}", case["name"]));
        let entry = case["entry"].as_str().unwrap();
        assert!(error.contains(entry), "{}: {error}", case["name"]);
    }
}

#[tokio::test]
async fn catalog_cases_hold_on_every_lane() {
    let cases = cases();
    let catalog = &cases["catalog"];
    for lane in LANES {
        let mut client = Client::connect(case_server(), lane).await;

        let listed = client.call("skills/list", json!({})).await;
        assert_eq!(
            listed["result"]["skills"], catalog["skillsList"]["skills"],
            "{lane:?}"
        );
        let resources = client.call("resources/list", json!({})).await;
        assert_eq!(
            resources["result"]["resources"], catalog["resourcesList"]["resources"],
            "{lane:?}"
        );
        for read in catalog["reads"].as_array().unwrap() {
            let response = client
                .call("resources/read", json!({ "uri": read["uri"] }))
                .await;
            assert_eq!(
                response["result"]["contents"], read["contents"],
                "{lane:?} {read}"
            );
        }
        for get in catalog["skillsGet"].as_array().unwrap() {
            let response = client
                .call("skills/get", json!({ "uri": get["uri"] }))
                .await;
            let index = get["skillsListIndex"].as_u64().unwrap() as usize;
            assert_eq!(
                response["result"]["skill"], catalog["skillsList"]["skills"][index],
                "{lane:?}"
            );
        }
        for case in catalog["errors"].as_array().unwrap() {
            let response = client
                .call(
                    case["method"].as_str().unwrap(),
                    json!({ "uri": case["uri"] }),
                )
                .await;
            let (code, data) = error_of(&response);
            assert_eq!(code, case["code"].as_i64().unwrap(), "{lane:?} {case}");
            assert_eq!(data["uri"], case["uri"], "{lane:?} {case}");
        }
    }
}

#[tokio::test]
async fn results_carry_cache_hints_on_the_modern_era() {
    let uri = "skill://hello-greeting/references/STYLE.md";
    for lane in LANES {
        let mut client = Client::connect(case_server(), lane).await;
        for (method, params) in [
            ("resources/list", json!({})),
            ("resources/templates/list", json!({})),
            ("resources/read", json!({ "uri": uri })),
            ("skills/list", json!({})),
            (
                "skills/get",
                json!({ "uri": "skill://acme/lint-rules/SKILL.md" }),
            ),
        ] {
            let result = client.call(method, params).await["result"].clone();
            assert!(result.is_object(), "{lane:?} {method}");
            assert!(result.get("nextCursor").is_none(), "{lane:?} {method}");
            if lane.modern() {
                assert_eq!(result["resultType"], "complete", "{method}");
                assert_eq!(result["ttlMs"], 300_000, "{method}");
                assert_eq!(result["cacheScope"], "public", "{method}");
            } else {
                assert!(result.get("cacheScope").is_none(), "{lane:?} {method}");
            }
        }
    }
}

#[tokio::test]
async fn the_ttl_follows_the_tools_list_option_and_ignores_contexts() {
    let server = case_server()
        .with_contexts(vec![afd::ContextConfig::new("work")])
        .unwrap();
    let mut client = Client::connect(server.clone(), Lane::HttpModern).await;
    assert_eq!(
        client.call("resources/list", json!({})).await["result"]["ttlMs"],
        300_000
    );
    // `tools/list` varies by context, so its default is 0; the resource list does not.
    assert_eq!(
        client.call("tools/list", json!({})).await["result"]["ttlMs"],
        0
    );
    let mut client = Client::connect(server.with_tools_list_ttl_ms(1234), Lane::StdioModern).await;
    assert_eq!(
        client.call("resources/list", json!({})).await["result"]["ttlMs"],
        1234
    );
    assert_eq!(
        client.call("skills/list", json!({})).await["result"]["ttlMs"],
        1234
    );
}

#[tokio::test]
async fn a_cursor_is_invalid_params_on_every_list() {
    for lane in LANES {
        let mut client = Client::connect(case_server(), lane).await;
        for method in ["resources/list", "resources/templates/list", "skills/list"] {
            let response = client.call(method, json!({ "cursor": "x" })).await;
            assert_eq!(error_of(&response).0, -32602, "{lane:?} {method}");
        }
    }
}

#[tokio::test]
async fn templates_are_empty_and_subscriptions_are_not_served() {
    for lane in LANES {
        let mut client = Client::connect(case_server(), lane).await;
        let templates = client.call("resources/templates/list", json!({})).await;
        assert_eq!(
            templates["result"]["resourceTemplates"],
            json!([]),
            "{lane:?}"
        );
        for method in ["resources/subscribe", "resources/unsubscribe"] {
            let response = client
                .call(method, json!({ "uri": "skill://hello-greeting/SKILL.md" }))
                .await;
            assert_eq!(error_of(&response).0, -32601, "{lane:?} {method}");
        }
    }
}

#[tokio::test]
async fn capabilities_declare_resources_and_the_extension_only_when_served() {
    let plain = McpServer::new(empty_registry(), "plain", "1.0.0");
    let capabilities = |server: &McpServer| {
        let info = rmcp::ServerHandler::get_info(server);
        serde_json::to_value(info.capabilities).unwrap()
    };
    let none = capabilities(&plain);
    assert!(
        none.get("resources").is_none() && none.get("prompts").is_none(),
        "{none}"
    );
    assert!(none.get("extensions").is_none(), "{none}");

    let with_provider =
        plain
            .clone()
            .with_resources(vec![ResourceEntry::new("file:///a.txt", "a").with_text("a")]);
    let served = capabilities(&with_provider);
    assert_eq!(served["resources"], json!({}), "{served}");
    assert!(served.get("extensions").is_none() && served.get("prompts").is_none());

    let skills = capabilities(&case_server());
    assert_eq!(skills["resources"], json!({}));
    assert_eq!(
        skills["extensions"],
        json!({ "io.modelcontextprotocol/skills": {} })
    );
    let directories = capabilities(
        &case_server().with_skills(
            SkillCatalog::new(skills_of(&cases()["catalog"]["skills"]))
                .unwrap()
                .with_directory_read(true),
        ),
    );
    assert_eq!(
        directories["extensions"],
        json!({ "io.modelcontextprotocol/skills": { "directoryRead": true } })
    );

    // The same declaration reaches the wire in `server/discover` and in `initialize`.
    let discover = modern_post(&case_server(), "server/discover", json!({}), &[]).await;
    assert_eq!(
        discover["result"]["capabilities"]["resources"],
        json!({}),
        "{discover}"
    );
    assert_eq!(
        discover["result"]["capabilities"]["extensions"],
        json!({ "io.modelcontextprotocol/skills": {} })
    );
    let mut stdio = Stdio::connect_modern(case_server());
    let initialize = stdio
        .request(
            "initialize",
            json!({
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": { "name": "test", "version": "0" },
            }),
        )
        .await;
    assert_eq!(
        initialize["result"]["capabilities"]["resources"],
        json!({}),
        "{initialize}"
    );
    assert_eq!(
        initialize["result"]["capabilities"]["extensions"],
        json!({ "io.modelcontextprotocol/skills": {} })
    );
}

#[tokio::test]
async fn skills_methods_answer_without_the_client_declaring_the_extension() {
    // `Client::call` declares no client capabilities on any lane.
    for lane in LANES {
        let mut client = Client::connect(case_server(), lane).await;
        let response = client.call("skills/list", json!({})).await;
        assert!(
            response["result"]["skills"].is_array(),
            "{lane:?} {response}"
        );
    }
}

#[tokio::test]
async fn a_server_with_no_catalog_answers_skills_methods_with_method_not_found() {
    let plain = McpServer::new(empty_registry(), "plain", "1.0.0");
    for lane in LANES {
        let mut client = Client::connect(plain.clone(), lane).await;
        for method in ["skills/list", "skills/get", "resources/directory/read"] {
            let response = client
                .call(method, json!({ "uri": "skill://a/SKILL.md" }))
                .await;
            assert_eq!(error_of(&response).0, -32601, "{lane:?} {method}");
        }
    }
}

#[tokio::test]
async fn directory_reads_are_off_by_default_and_listed_when_on() {
    for lane in LANES {
        let mut off = Client::connect(case_server(), lane).await;
        let refused = off
            .call(
                "resources/directory/read",
                json!({ "uri": "skill://hello-greeting" }),
            )
            .await;
        assert_eq!(error_of(&refused).0, -32601, "{lane:?}");

        let catalog = SkillCatalog::new(skills_of(&cases()["catalog"]["skills"]))
            .unwrap()
            .with_directory_read(true);
        let mut on = Client::connect(server_with(catalog), lane).await;
        let root = on
            .call(
                "resources/directory/read",
                json!({ "uri": "skill://hello-greeting" }),
            )
            .await;
        let names: Vec<&str> = root["result"]["resources"]
            .as_array()
            .unwrap()
            .iter()
            .map(|child| child["uri"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            [
                "skill://hello-greeting/SKILL.md",
                "skill://hello-greeting/assets",
                "skill://hello-greeting/references",
            ],
            "{lane:?}"
        );
        assert_eq!(
            root["result"]["resources"][1]["mimeType"],
            "inode/directory"
        );
        assert_eq!(
            root["result"]["resources"][0]["_meta"]["dev.afd/digest"]
                .as_str()
                .map(|d| d.len()),
            Some(71)
        );
        let sub = on
            .call(
                "resources/directory/read",
                json!({ "uri": "skill://hello-greeting/references" }),
            )
            .await;
        assert_eq!(
            sub["result"]["resources"][0]["uri"],
            "skill://hello-greeting/references/STYLE.md"
        );
        for bad in [
            "skill://hello-greeting/",
            "skill://hello-greeting/SKILL.md",
            "skill://hello-greeting/nowhere",
            "skill://acme",
            "skill://nobody",
        ] {
            let response = on
                .call("resources/directory/read", json!({ "uri": bad }))
                .await;
            let (code, data) = error_of(&response);
            assert_eq!(
                (code, &data["uri"]),
                (-32602, &json!(bad)),
                "{lane:?} {bad}"
            );
        }
        // Directories are not listed as resources.
        let listed = on.call("resources/list", json!({})).await;
        assert!(listed["result"]["resources"]
            .as_array()
            .unwrap()
            .iter()
            .all(|resource| resource["mimeType"] != "inode/directory"));
    }
}

#[tokio::test]
async fn the_modern_http_read_needs_mcp_name_and_skills_methods_do_not() {
    let server = case_server();
    let uri = "skill://hello-greeting/SKILL.md";
    let body = |method: &str, params: Value| {
        let mut params = params;
        params["_meta"] = serde_json::from_str(common::META).unwrap();
        json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params })
    };
    let headers = |method: &'static str| {
        vec![
            ("mcp-protocol-version", "2026-07-28"),
            ("mcp-method", method),
        ]
    };

    let (status, response) = common::http_post(
        &server,
        body("resources/read", json!({ "uri": uri })),
        &headers("resources/read"),
    )
    .await;
    assert_eq!(status, 400, "{response}");
    assert_eq!(response["error"]["code"], -32020, "{response}");

    let mut wrong = headers("resources/read");
    wrong.push(("mcp-name", "skill://other/SKILL.md"));
    let (status, response) = common::http_post(
        &server,
        body("resources/read", json!({ "uri": uri })),
        &wrong,
    )
    .await;
    assert_eq!(status, 400, "{response}");
    assert_eq!(response["error"]["code"], -32020, "{response}");

    for (method, params) in [
        ("skills/get", json!({ "uri": uri })),
        ("skills/list", json!({})),
    ] {
        let (status, response) =
            common::http_post(&server, body(method, params), &headers(method)).await;
        assert_eq!(status, 200, "{method}: {response}");
        assert!(response["result"].is_object(), "{method}: {response}");
    }
}

#[tokio::test]
async fn the_list_does_not_vary_by_context_or_request() {
    let server = case_server()
        .with_contexts(vec![afd::ContextConfig::new("work")])
        .unwrap();
    let mut client = Client::connect(server, Lane::StdioModern).await;
    let plain = client.call("resources/list", json!({})).await["result"]["resources"].clone();
    let mut params = json!({});
    params["_meta"] = json!({ "dev.afd/context": "work" });
    let scoped = client.call("resources/list", params).await["result"]["resources"].clone();
    assert_eq!(plain, scoped);
    assert_eq!(plain.as_array().unwrap().len(), 4);
}

/// A provider with a dynamic entry, a static one and a view.
struct Provider {
    reads: Arc<AtomicUsize>,
    mutate: Arc<std::sync::Mutex<Vec<ResourceEntry>>>,
}

impl Provider {
    fn new() -> Self {
        let entries = vec![
            ResourceEntry::new("file:///notes.txt", "notes")
                .with_title("Notes")
                .with_description("Some notes")
                .with_mime_type("text/plain")
                .with_size(5)
                .with_meta("com.example/kind", json!("note")),
            ResourceEntry::new("file:///static.json", "static")
                .with_mime_type("application/json")
                .with_text("{\"a\":1}"),
            ResourceEntry::new("ui://app/view.html", "view").with_mime_type(MCP_APP_MIME_TYPE),
        ];
        Self {
            reads: Arc::new(AtomicUsize::new(0)),
            mutate: Arc::new(std::sync::Mutex::new(entries)),
        }
    }
}

#[async_trait]
impl ResourceProvider for Provider {
    fn list(&self) -> Vec<ResourceEntry> {
        self.mutate.lock().unwrap().clone()
    }

    async fn read(&self, uri: &str) -> Result<ResourceContents, ResourceReadError> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        match uri {
            "file:///notes.txt" => Ok(ResourceContents::text("hello")),
            "file:///wrong-size.txt" => Ok(ResourceContents::text("hello")),
            "file:///unlisted.bin" => Ok(ResourceContents::new(vec![0xff, 0x00])
                .with_mime_type("application/octet-stream")),
            "ui://app/view.html" => Ok(ResourceContents::text("<html></html>").with_meta(
                "ui",
                json!({ "csp": { "connectDomains": ["https://example.com"] }, "prefersBorder": true }),
            )),
            "file:///bad-meta.txt" => {
                Ok(ResourceContents::text("x").with_meta("dev.afd/digest", json!("x")))
            }
            "file:///broken.txt" => Err(ResourceReadError::Failed("disk on fire".into())),
            _ => Err(ResourceReadError::NotFound),
        }
    }
}

fn provider_server(provider: Provider) -> McpServer {
    McpServer::new(empty_registry(), "provider", "1.0.0").with_resources(provider)
}

#[tokio::test]
async fn a_provider_serves_entries_and_reads_on_every_lane() {
    for lane in LANES {
        let provider = Provider::new();
        let reads = Arc::clone(&provider.reads);
        let mut client = Client::connect(provider_server(provider), lane).await;
        let listed = client.call("resources/list", json!({})).await["result"]["resources"].clone();
        assert_eq!(
            listed,
            json!([
                {
                    "uri": "file:///notes.txt", "name": "notes", "title": "Notes",
                    "description": "Some notes", "mimeType": "text/plain", "size": 5,
                    "_meta": { "com.example/kind": "note" },
                },
                {
                    "uri": "file:///static.json", "name": "static", "mimeType": "application/json",
                    "size": 7,
                    "_meta": { "dev.afd/digest": "sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862" },
                },
                { "uri": "ui://app/view.html", "name": "view", "mimeType": "text/html;profile=mcp-app" },
            ]),
            "{lane:?}"
        );

        let read = |uri: &'static str| json!({ "uri": uri });
        let notes = client
            .call("resources/read", read("file:///notes.txt"))
            .await;
        assert_eq!(
            notes["result"]["contents"],
            json!([{ "uri": "file:///notes.txt", "mimeType": "text/plain", "text": "hello" }]),
            "{lane:?}"
        );
        // The server serves an entry with its bytes up front without calling the provider.
        let before = reads.load(Ordering::SeqCst);
        let fixed = client
            .call("resources/read", read("file:///static.json"))
            .await;
        assert_eq!(
            fixed["result"]["contents"],
            json!([{ "uri": "file:///static.json", "mimeType": "application/json", "text": "{\"a\":1}" }])
        );
        assert_eq!(reads.load(Ordering::SeqCst), before);
        // A server MAY serve a URI it does not list; the entry's mimeType is not used then.
        let unlisted = client
            .call("resources/read", read("file:///unlisted.bin"))
            .await;
        assert_eq!(
            unlisted["result"]["contents"],
            json!([{ "uri": "file:///unlisted.bin", "mimeType": "application/octet-stream", "blob": "/wA=" }])
        );
        // `ui` is allowed on a content item.
        let view = client
            .call("resources/read", read("ui://app/view.html"))
            .await;
        assert_eq!(
            view["result"]["contents"][0]["_meta"]["ui"]["prefersBorder"], true,
            "{lane:?}"
        );
        assert_eq!(view["result"]["contents"][0]["mimeType"], MCP_APP_MIME_TYPE);

        let missing = client
            .call("resources/read", read("file:///missing.txt"))
            .await;
        let (code, data) = error_of(&missing);
        assert_eq!(
            (code, data["uri"].clone()),
            (-32602, json!("file:///missing.txt")),
            "{lane:?}"
        );
        assert_eq!(missing["error"]["message"], "Resource not found");

        let bad = client
            .call("resources/read", read("file:///bad-meta.txt"))
            .await;
        assert_eq!(error_of(&bad).0, -32603, "{lane:?}");
        let broken = client
            .call("resources/read", read("file:///broken.txt"))
            .await;
        assert_eq!(error_of(&broken).0, -32603, "{lane:?}");
        assert!(!broken.to_string().contains("disk on fire"), "{broken}");
    }
}

#[tokio::test]
async fn a_read_whose_size_differs_from_the_listed_size_is_an_internal_error() {
    let provider = Provider::new();
    provider
        .mutate
        .lock()
        .unwrap()
        .push(ResourceEntry::new("file:///wrong-size.txt", "wrong").with_size(99));
    let mut client = Client::connect(provider_server(provider), Lane::StdioModern).await;
    let response = client
        .call("resources/read", json!({ "uri": "file:///wrong-size.txt" }))
        .await;
    assert_eq!(error_of(&response).0, -32603, "{response}");
}

#[tokio::test]
async fn a_provider_that_breaks_a_rule_is_refused_at_start_and_when_listed() {
    let provider = Provider::new();
    let entries = Arc::clone(&provider.mutate);
    let server = provider_server(provider);
    assert_eq!(server.validate(), Ok(()));
    entries
        .lock()
        .unwrap()
        .push(ResourceEntry::new("skill://x/SKILL.md", "stolen"));
    let error = server.validate().unwrap_err();
    assert!(error.contains("skill://x/SKILL.md"), "{error}");
    assert!(server
        .try_streamable_http_service(Default::default())
        .is_err());
    let mut client = Client::connect(server, Lane::StdioModern).await;
    let response = client.call("resources/list", json!({})).await;
    assert_eq!(error_of(&response).0, -32603, "{response}");
    // The tools surface is unaffected by a resource problem.
    let tools = client.call("tools/list", json!({})).await;
    assert!(tools["result"]["tools"].is_array(), "{tools}");
}

#[tokio::test]
async fn provider_entries_come_before_skill_files() {
    let server = case_server().with_resources(Provider::new());
    let mut client = Client::connect(server, Lane::HttpModern).await;
    let listed = client.call("resources/list", json!({})).await["result"]["resources"].clone();
    let uris: Vec<&str> = listed
        .as_array()
        .unwrap()
        .iter()
        .map(|resource| resource["uri"].as_str().unwrap())
        .collect();
    assert_eq!(
        uris,
        [
            "file:///notes.txt",
            "file:///static.json",
            "ui://app/view.html",
            "skill://hello-greeting/SKILL.md",
            "skill://hello-greeting/assets/dot.bin",
            "skill://hello-greeting/references/STYLE.md",
            "skill://acme/lint-rules/SKILL.md",
        ]
    );
    // Both are readable.
    let skill = client
        .call(
            "resources/read",
            json!({ "uri": "skill://acme/lint-rules/SKILL.md" }),
        )
        .await;
    assert!(skill["result"]["contents"][0]["text"].is_string());
}

#[tokio::test]
async fn an_unlisted_skill_uri_is_not_found_and_never_reaches_the_provider() {
    let provider = Provider::new();
    let reads = Arc::clone(&provider.reads);
    let mut client =
        Client::connect(case_server().with_resources(provider), Lane::HttpModern).await;
    for uri in [
        "skill://hello-greeting/missing.md",
        "SKILL://other/SKILL.md",
    ] {
        let response = client.call("resources/read", json!({ "uri": uri })).await;
        let (code, data) = error_of(&response);
        assert_eq!((code, data["uri"].clone()), (-32602, json!(uri)));
    }
    assert_eq!(reads.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn resources_read_runs_no_command_and_skips_the_context_hook() {
    use std::sync::atomic::AtomicBool;
    let hooked = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&hooked);
    let server = case_server().with_context_hook(move |_request, context| {
        let flag = Arc::clone(&flag);
        async move {
            flag.store(true, Ordering::SeqCst);
            Ok(context)
        }
    });
    let mut client = Client::connect(server, Lane::HttpModern).await;
    client
        .call(
            "resources/read",
            json!({ "uri": "skill://acme/lint-rules/SKILL.md" }),
        )
        .await;
    client.call("skills/list", json!({})).await;
    assert!(!hooked.load(Ordering::SeqCst));
}

#[tokio::test]
async fn a_panicking_provider_is_an_internal_error_not_a_hang() {
    struct Panics;
    #[async_trait]
    impl ResourceProvider for Panics {
        fn list(&self) -> Vec<ResourceEntry> {
            vec![ResourceEntry::new("file:///a", "a")]
        }
        async fn read(&self, _uri: &str) -> Result<ResourceContents, ResourceReadError> {
            panic!("provider failed");
        }
    }
    let server = McpServer::new(empty_registry(), "p", "1").with_resources(Panics);
    let mut client = Client::connect(server, Lane::StdioModern).await;
    let response = client
        .call("resources/read", json!({ "uri": "file:///a" }))
        .await;
    assert_eq!(error_of(&response).0, -32603, "{response}");
    assert!(!response.to_string().contains("provider failed"));
}
