//! The Rust server's protocol criteria over Streamable HTTP (specification section 10), against a
//! sealed Umbel host with zero plugins: discovery, the tool list, calls, header and body checks,
//! Host and Origin validation, the body cap, and the bearer layer. Each test names the AFD test
//! (`server_http.rs`, `server_hybrid.rs`) whose criterion it covers.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use axum::body::Body;
use http::Request;
use serde_json::json;
use support::mcp::{Era, Http, Transport, command_result, tool_names};
use support::*;
use umbel::{Host, HostBuilder};

fn server() -> (tempfile::TempDir, Host) {
    let dir = minimal();
    let host = host(dir.path());
    (dir, host)
}

fn exposed_only_to_cli(name: &str) -> afd::CommandDefinition {
    with_exposure(
        fixture(name, |_, _| afd::success(json!({}))),
        false,
        false,
        true,
    )
}

const UNAUTHORIZED: &str = "UNAUTHORIZED";

// server_http.rs: discover_describes_the_server
#[tokio::test]
async fn discover_names_umbel_with_the_default_hybrid_instructions() {
    let (_dir, host) = server();
    let http = Http::new(&host);
    let body = http.modern("server/discover", json!({})).await;
    let result = &body["result"];
    assert_eq!(result["resultType"], "complete");
    assert!(
        result["supportedVersions"]
            .as_array()
            .unwrap()
            .contains(&json!("2026-07-28"))
    );
    let server_info = &result["_meta"]["io.modelcontextprotocol/serverInfo"];
    assert_eq!(server_info["name"], "umbel");
    assert_eq!(server_info["version"], env!("CARGO_PKG_VERSION"));
    // AFD's default instructions, unchanged: the hybrid ones name the meta-tools.
    let instructions = result["instructions"].as_str().unwrap();
    assert!(instructions.contains("afd-discover"), "{instructions}");
    assert!(instructions.contains("CommandResult"), "{instructions}");
    // The tool list never changes while serving (H2): no listChanged.
    assert_eq!(result["capabilities"]["tools"]["listChanged"], false);
}

// server_http.rs: tools_list_shows_exposed_commands_with_cache_hints; server_hybrid.rs: the lists
#[tokio::test]
async fn tools_list_is_the_meta_tools_then_the_first_class_tools() {
    let (_dir, host) = server();
    let http = Http::new(&host);
    let body = http.modern("tools/list", json!({})).await;
    assert_eq!(tool_names(&body), default_tools(&host));
    assert_eq!(body["result"]["resultType"], "complete");
    assert_eq!(body["result"]["ttlMs"], 300_000);
    assert_eq!(body["result"]["cacheScope"], "public");
    // The first-class tools carry outputSchema, structured results being on.
    for tool in body["result"]["tools"].as_array().unwrap() {
        if tool["name"] == "workspace-show" {
            assert!(tool["outputSchema"].is_object(), "{tool}");
        }
    }
}

#[tokio::test]
async fn the_tools_list_ttl_follows_configuration() {
    let dir = workspace("config_version = 1\n\n[mcp]\ntools_list_ttl_ms = 1234\n");
    let host = host(dir.path());
    let body = Http::new(&host).modern("tools/list", json!({})).await;
    assert_eq!(body["result"]["ttlMs"], 1234);
}

// server_structured.rs: structured results equal the text
#[tokio::test]
async fn workspace_show_returns_structured_content_equal_to_its_text() {
    let (_dir, host) = server();
    let http = Http::new(&host);
    let response = http
        .modern(
            "tools/call",
            json!({ "name": "workspace-show", "arguments": {} }),
        )
        .await;
    let result = command_result(&response);
    assert_eq!(result["success"], true, "{result}");
    assert_eq!(response["result"]["structuredContent"], result);
    assert_eq!(result["data"]["host"]["name"], "umbel");
    assert_eq!(result["data"]["surfaces"]["toolStrategy"], "hybrid");
    assert_eq!(response["result"]["isError"], false);
}

// server_http.rs: tools_call_returns_command_results_and_hides_private_commands
#[tokio::test]
async fn an_unknown_and_a_cli_only_name_answer_the_same() {
    let dir = minimal();
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(exposed_only_to_cli("fixture-cli-only"))
        .seal()
        .unwrap();
    let http = Http::new(&host);
    let names = ["no-such-command", "fixture-cli-only", "event-rebuild"];
    let mut results = Vec::new();
    for name in names {
        let response = http
            .modern("tools/call", json!({ "name": name, "arguments": {} }))
            .await;
        assert_eq!(response["result"]["isError"], true, "{name}");
        let result = command_result(&response);
        assert_eq!(result["error"]["code"], "COMMAND_NOT_FOUND", "{name}");
        assert!(
            result["error"]["message"].as_str().unwrap().contains(name),
            "{name}: {result}"
        );
        assert!(
            result["error"]["suggestion"]
                .as_str()
                .unwrap()
                .ends_with("Use afd-discover to list all commands."),
            "{name}: {result}"
        );
        results.push(result);
    }
    // A CLI-only name is never suggested, to a caller who asked for another one.
    for result in &results {
        let suggestion = result["error"]["suggestion"].as_str().unwrap();
        assert!(!suggestion.contains("fixture-cli-only"), "{suggestion}");
        assert!(
            !suggestion.contains("Did you mean 'event-rebuild'"),
            "{suggestion}"
        );
    }
}

// server_http.rs: header_mismatch_is_rejected
#[tokio::test]
async fn header_and_body_mismatch_is_400_with_32020() {
    let (_dir, host) = server();
    let http = Http::new(&host);
    let body = json!({
        "jsonrpc": "2.0", "id": 4, "method": "tools/call",
        "params": { "name": "workspace-show", "arguments": {}, "_meta": support::mcp::modern_meta() },
    });
    let reply = http
        .post(
            &body,
            &[
                ("mcp-protocol-version", "2026-07-28"),
                ("mcp-method", "tools/call"),
                ("mcp-name", "other"),
            ],
        )
        .await;
    assert_eq!(reply.status, 400, "{}", reply.text);
    assert_eq!(reply.json()["error"]["code"], -32020);
}

#[tokio::test]
async fn an_unsupported_version_is_32022() {
    let (_dir, host) = server();
    let http = Http::new(&host);
    let mut meta = support::mcp::modern_meta();
    meta["io.modelcontextprotocol/protocolVersion"] = json!("2099-01-01");
    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": { "_meta": meta },
    });
    let reply = http
        .post(
            &body,
            &[
                ("mcp-protocol-version", "2099-01-01"),
                ("mcp-method", "tools/list"),
            ],
        )
        .await;
    assert_eq!(reply.json()["error"]["code"], -32022, "{}", reply.text);
}

#[tokio::test]
async fn get_is_405() {
    let (_dir, host) = server();
    let reply = Http::new(&host).get("/mcp").await;
    assert_eq!(reply.status, 405, "{}", reply.text);
}

// server_http.rs: foreign_origins_are_refused
#[tokio::test]
async fn a_foreign_host_and_a_foreign_origin_are_refused() {
    let (_dir, host) = server();
    let foreign_host = Http::new(&host).with_host("evil.example");
    let reply = foreign_host
        .modern_reply("tools/list", json!({}), &[])
        .await;
    assert_eq!(reply.status, 403, "{}", reply.text);

    let http = Http::new(&host);
    let reply = http
        .modern_reply(
            "tools/list",
            json!({}),
            &[("origin", "https://evil.example")],
        )
        .await;
    assert_eq!(reply.status, 403, "{}", reply.text);
    // A request without an Origin passes (a native client).
    let reply = http.modern_reply("tools/list", json!({}), &[]).await;
    assert_eq!(reply.status, 200);
    // An allowed origin passes, once configured.
    let dir =
        workspace("config_version = 1\n\n[http]\nallowed_origins = [\"http://localhost:5173\"]\n");
    let host = support::host(dir.path());
    let http = Http::new(&host);
    let reply = http
        .modern_reply(
            "tools/list",
            json!({}),
            &[("origin", "http://localhost:5173")],
        )
        .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let reply = http
        .modern_reply("tools/list", json!({}), &[("origin", "http://localhost:9")])
        .await;
    assert_eq!(reply.status, 403, "{}", reply.text);
}

#[tokio::test]
async fn a_body_over_the_cap_is_refused() {
    let dir = workspace("config_version = 1\n\n[http]\nmax_body_bytes = 1024\n");
    let host = host(dir.path());
    let http = Http::new(&host);
    let big = "x".repeat(4096);
    let reply = http
        .modern_reply(
            "tools/call",
            json!({ "name": "workspace-show", "arguments": { "padding": big } }),
            &[],
        )
        .await;
    assert_eq!(reply.status, 413, "{}", reply.text);
    // A body within the cap is served.
    let reply = http.modern_reply("tools/list", json!({}), &[]).await;
    assert_eq!(reply.status, 200);
}

// Legacy: server_http.rs legacy_clients_initialize_on_the_same_endpoint
#[tokio::test]
async fn legacy_clients_initialize_then_list_and_call_on_the_same_endpoint() {
    let (_dir, host) = server();
    let mut client = support::mcp::Client::connect(&host, Transport::Http, Era::Legacy).await;
    assert_eq!(client.tool_names().await, default_tools(&host));
    let result = client.call("workspace-show", json!({})).await;
    assert_eq!(result["success"], true, "{result}");
    assert!(result["data"]["name"].is_string());
}

mod bearer {
    use super::*;

    async fn assert_refused(reply: &support::mcp::Reply, host: &Host) {
        assert_eq!(reply.status, 401, "{}", reply.text);
        assert_eq!(
            reply.headers.get("www-authenticate").unwrap(),
            "Bearer realm=\"umbel\""
        );
        assert_eq!(
            reply.headers.get("content-type").unwrap(),
            "application/json"
        );
        let token_file = host.workspace().layout().http_token();
        assert_eq!(
            reply.json(),
            json!({
                "error": UNAUTHORIZED,
                "suggestion": format!(
                    "Send Authorization: Bearer <token>; the token is in {}, readable by the workspace owner.",
                    token_file.display()
                ),
            })
        );
    }

    #[tokio::test]
    async fn no_token_a_wrong_token_and_a_token_of_another_length_are_401_on_mcp_and_health() {
        let (_dir, host) = server();
        let right = Http::new(&host);
        let token = right.token().unwrap().to_owned();
        assert_eq!(token.len(), 64);
        let wrong_same_length = "0".repeat(64);
        let wrong_other_length = &token[..63];
        let longer = format!("{token}0");
        for presented in [
            None,
            Some(wrong_same_length.as_str()),
            Some(wrong_other_length),
            Some(longer.as_str()),
            Some(""),
        ] {
            let http = Http::new(&host).with_token(presented);
            let reply = http.modern_reply("tools/list", json!({}), &[]).await;
            assert_refused(&reply, &host).await;
            let health = http.get("/health").await;
            assert_refused(&health, &host).await;
        }
        // The right token passes on both.
        let reply = right.modern_reply("tools/list", json!({}), &[]).await;
        assert_eq!(reply.status, 200);
        let health = right.get("/health").await;
        assert_eq!(health.status, 200);
        assert_eq!(health.json(), json!({ "status": "ok" }));
    }

    #[tokio::test]
    async fn only_the_bearer_scheme_with_the_token_is_accepted() {
        let (_dir, host) = server();
        let right = Http::new(&host);
        let token = right.token().unwrap().to_owned();
        let body = json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/list",
            "params": { "_meta": support::mcp::modern_meta() },
        });
        let headers = [
            ("mcp-protocol-version", "2026-07-28"),
            ("mcp-method", "tools/list"),
        ];
        let without = right.clone().with_token(None);
        for authorization in [
            format!("Basic {token}"),
            token.clone(),
            format!("Bearer{token}"),
            format!("Bearer  {}x", token),
        ] {
            let mut sent = headers.to_vec();
            sent.push(("authorization", authorization.as_str()));
            let reply = without.post(&body, &sent).await;
            assert_eq!(reply.status, 401, "{authorization}: {}", reply.text);
        }
        // The scheme name is case-insensitive.
        let authorization = format!("bearer {token}");
        let mut sent = headers.to_vec();
        sent.push(("authorization", authorization.as_str()));
        let reply = without.post(&body, &sent).await;
        assert_eq!(reply.status, 200, "{}", reply.text);
    }

    #[tokio::test]
    async fn the_bearer_layer_runs_before_the_host_and_origin_checks() {
        let (_dir, host) = server();
        // No token, foreign Host and foreign Origin: 401, not 403.
        let http = Http::new(&host).with_token(None).with_host("evil.example");
        let reply = http
            .modern_reply(
                "tools/list",
                json!({}),
                &[("origin", "https://evil.example")],
            )
            .await;
        assert_eq!(reply.status, 401, "{}", reply.text);
        // With the token, the same request is refused by AFD's checks.
        let http = Http::new(&host).with_host("evil.example");
        let reply = http
            .modern_reply(
                "tools/list",
                json!({}),
                &[("origin", "https://evil.example")],
            )
            .await;
        assert_eq!(reply.status, 403, "{}", reply.text);
    }

    #[tokio::test]
    async fn an_unauthenticated_request_learns_nothing_about_other_paths() {
        let (_dir, host) = server();
        let http = Http::new(&host).with_token(None);
        for path in ["/", "/nothing", "/health/x", "/mcp/extra"] {
            let reply = http.get(path).await;
            assert_eq!(reply.status, 401, "{path}");
        }
        // With the token, a path that is not the endpoint is a 404.
        let http = Http::new(&host);
        for path in ["/", "/nothing", "/mcp/extra"] {
            assert_eq!(http.get(path).await.status, 404, "{path}");
        }
    }

    #[tokio::test]
    async fn the_token_file_is_64_hex_characters_with_mode_0600_and_is_reused() {
        let (_dir, host) = server();
        let file = host.workspace().layout().http_token();
        assert!(
            !file.exists(),
            "created at the first http_router, not at open"
        );
        let first = Http::new(&host).token().unwrap().to_owned();
        assert!(
            first
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        );
        assert_eq!(first.len(), 64);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&file).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        // A second router, and a second host, use the same token.
        assert_eq!(Http::new(&host).token().unwrap(), first);
        let again = support::host(host.workspace().root());
        assert_eq!(Http::new(&again).token().unwrap(), first);
        // Rotation: delete the file, build a new router.
        std::fs::remove_file(&file).unwrap();
        let rotated = Http::new(&host).token().unwrap().to_owned();
        assert_ne!(rotated, first);
        let old = Http::new(&host).with_token(Some(&first));
        assert_eq!(old.get("/health").await.status, 401);
    }

    #[tokio::test]
    async fn a_malformed_token_file_fails_the_router_and_is_not_replaced() {
        let (_dir, host) = server();
        let file = host.workspace().layout().http_token();
        std::fs::write(&file, "not-a-token").unwrap();
        let error = host.http_router().unwrap_err();
        assert_eq!(error.code(), "WORKSPACE_KEY_INVALID");
        assert!(
            error.message().contains("http.token"),
            "{}",
            error.message()
        );
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "not-a-token");
    }

    #[tokio::test]
    async fn the_token_is_never_the_identity() {
        // The actor of an HTTP call is the one loopback principal whatever the token or headers.
        let dir = minimal();
        let host = HostBuilder::open(dir.path())
            .unwrap()
            .register(fixture("fixture-whoami", |_, context| {
                afd::success(json!({ "actor": context.actor }))
            }))
            .seal()
            .unwrap();
        let http = Http::new(&host);
        let response = http
            .modern(
                "tools/call",
                json!({ "name": "afd-call", "arguments": { "command": "fixture-whoami", "input": {} } }),
            )
            .await;
        let result = command_result(&response);
        assert_eq!(
            result["data"]["actor"],
            json!({ "kind": "agent", "id": "loopback" })
        );
    }
}

mod path_and_bind {
    use super::*;

    #[tokio::test]
    async fn a_non_default_http_path_serves_there_and_not_at_mcp() {
        let dir = workspace("config_version = 1\n\n[http]\npath = \"/umbel/v1/rpc\"\n");
        let host = host(dir.path());
        let http = Http::new(&host);
        let body = json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/list",
            "params": { "_meta": support::mcp::modern_meta() },
        });
        let headers = [
            ("mcp-protocol-version", "2026-07-28"),
            ("mcp-method", "tools/list"),
        ];
        let reply = http.post_to("/umbel/v1/rpc", &body, &headers).await;
        assert_eq!(reply.status, 200, "{}", reply.text);
        assert_eq!(tool_names(&reply.json()), default_tools(&host));
        let reply = http.post_to("/mcp", &body, &headers).await;
        assert_eq!(reply.status, 404, "{}", reply.text);
        // /health is unaffected.
        assert_eq!(http.get("/health").await.status, 200);
    }

    #[tokio::test]
    async fn a_path_with_braces_or_a_wildcard_serves_exactly_and_never_panics() {
        let dir = workspace("config_version = 1\n\n[http]\npath = \"/a/{b}/*c\"\n");
        let host = host(dir.path());
        let http = Http::new(&host);
        let body = json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/list",
            "params": { "_meta": support::mcp::modern_meta() },
        });
        let headers = [
            ("mcp-protocol-version", "2026-07-28"),
            ("mcp-method", "tools/list"),
        ];
        let reply = http.post_to("/a/%7Bb%7D/*c", &body, &headers).await;
        // The request path is compared as the client sent it, so the encoded form is not it.
        assert_eq!(reply.status, 404);
        let reply = http.post_to("/a/{b}/*c", &body, &headers).await;
        assert_eq!(reply.status, 200, "{}", reply.text);
    }

    #[tokio::test]
    async fn a_bind_on_another_loopback_address_accepts_its_own_host_header() {
        let dir = workspace("config_version = 1\n\n[http]\nbind = \"127.0.0.2:0\"\n");
        let host = host(dir.path());
        let http = Http::new(&host).with_host("127.0.0.2:41234");
        let reply = http.modern_reply("tools/list", json!({}), &[]).await;
        assert_eq!(reply.status, 200, "{}", reply.text);
        // The loopback names stay allowed.
        let http = Http::new(&host).with_host("localhost:41234");
        assert_eq!(
            http.modern_reply("tools/list", json!({}), &[]).await.status,
            200
        );
        // Another address does not.
        let http = Http::new(&host).with_host("127.0.0.3:41234");
        assert_eq!(
            http.modern_reply("tools/list", json!({}), &[]).await.status,
            403
        );
    }

    #[tokio::test]
    async fn the_default_bind_does_not_accept_another_loopback_address_as_a_host() {
        let (_dir, host) = server();
        let http = Http::new(&host).with_host("127.0.0.2:7410");
        assert_eq!(
            http.modern_reply("tools/list", json!({}), &[]).await.status,
            403
        );
        // Allowed hosts add to the loopback names.
        let dir = workspace("config_version = 1\n\n[http]\nallowed_hosts = [\"umbel.internal\"]\n");
        let host = support::host(dir.path());
        let http = Http::new(&host).with_host("umbel.internal");
        assert_eq!(
            http.modern_reply("tools/list", json!({}), &[]).await.status,
            200
        );
    }

    #[tokio::test]
    async fn an_ipv6_loopback_bind_is_allowed_as_a_host() {
        let dir = workspace("config_version = 1\n\n[http]\nbind = \"[::1]:0\"\n");
        let host = host(dir.path());
        let http = Http::new(&host).with_host("[::1]:5555");
        assert_eq!(
            http.modern_reply("tools/list", json!({}), &[]).await.status,
            200
        );
    }

    #[test]
    fn a_non_loopback_bind_a_wildcard_host_and_a_bad_path_never_open() {
        for (config, key) in [
            ("[http]\nbind = \"0.0.0.0:7410\"\n", "http.bind"),
            ("[http]\nbind = \"192.168.1.5:7410\"\n", "http.bind"),
            ("[http]\nbind = \"[::]:7410\"\n", "http.bind"),
            ("[http]\nallowed_hosts = [\"*\"]\n", "http.allowed_hosts"),
            ("[http]\npath = \"/\"\n", "http.path"),
            ("[http]\npath = \"/health\"\n", "http.path"),
            ("[http]\npath = \"mcp\"\n", "http.path"),
        ] {
            let dir = workspace(&format!("config_version = 1\n\n{config}"));
            let error = HostBuilder::open(dir.path()).err().expect(config);
            assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{config}");
            assert!(
                error.message().contains(key),
                "{config}: {}",
                error.message()
            );
        }
    }
}

#[tokio::test]
async fn requests_are_served_without_any_session_state() {
    // Principle 11: the same router answers consecutive and interleaved requests, with no
    // session header and no state between them.
    let (_dir, host) = server();
    let http = Http::new(&host);
    for _ in 0..3 {
        let list = http.modern("tools/list", json!({}));
        let show = http.modern(
            "tools/call",
            json!({ "name": "workspace-show", "arguments": {} }),
        );
        let (list, show) = tokio::join!(list, show);
        assert_eq!(tool_names(&list), default_tools(&host));
        assert_eq!(command_result(&show)["success"], true);
    }
}

#[tokio::test]
async fn a_request_for_a_nonexistent_route_reaches_nothing() {
    let (_dir, host) = server();
    let http = Http::new(&host);
    let request = Request::delete("/mcp")
        .header("host", "localhost")
        .header("authorization", format!("Bearer {}", http.token().unwrap()))
        .body(Body::empty())
        .unwrap();
    let reply = http.send(request).await;
    assert!(
        reply.status == 405 || reply.status == 404,
        "{}",
        reply.status
    );
}
