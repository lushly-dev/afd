//! Step F3 tests: releasing `mail-replyset-send` over MCP, pure-read
//! `mail-replyset-next` returning `dev.loam/unit` + stateless HMAC-SHA256
//! claims, `mail-replyset-submit` (`UNIT_NOT_OPEN`), persistent claim key and
//! `instructions_version` (migration 24), two-sender unit isolation, and HTTP
//! `/mcp` mirror of Scenario 5 (`compose-replies-apart`) (plugin.spec.md,
//! sections 5–9, 11, 18 and 19: F-T3, F-T4, F-T6, F-T7, F-T9, F-T10).

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::sync::Arc;

use afd::{ActorKind, CommandContext, CommandInterface, canonical_json};
use axum::body::Body;
use http_body_util::BodyExt;
use loam_mail::cli::{Caller, EXIT_OK, Local, Runner, run};
use loam_mail::engine::Engine;
use loam_mail::home::Home;
use loam_mail::replysets::{INSTRUCTIONS_VERSION, MAX_PREVIEW_MCP_BYTES};
use loam_mail::secrets::InMemory;
use loam_mail::serve::router;
use loam_mail::store::Store;
use serde_json::{Value, json};
use support::imap::{USER, World};
use support::smtp::SmtpFault;
use support::synced::{Fixture, assert_labelled, mail};
use tower::ServiceExt;

const PORT: u16 = 4333;
const CLI_TOKEN: &str = "lmail_cli_f3_test";
const GOOD_HOST: &str = "127.0.0.1:4333";
const MODERN_META: &str = r#"{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}"#;

const CONTENT_WORDS: &[&str] = &[
    "ada@example.com",
    "bea@example.com",
    "Ada Lovelace",
    "Bea Smith",
    "ADA_ONLY_SENTINEL",
    "BEA_ONLY_SENTINEL",
    "Thursday works",
    "invoice is attached",
];

fn world(world: &mut World) {
    world.mailbox("INBOX", &[]);
    world.mailbox("Sent Messages", &["\\Sent"]);
    world.mailbox("Deleted Messages", &["\\Trash"]);
    world.mailbox("Junk", &["\\Junk"]);
    world.add(
        "INBOX",
        "From: Ada Lovelace <ada@example.com>\r\n\
         To: person@example.com\r\n\
         Message-ID: <ada-f3@example.org>\r\n\
         Subject: Thursday\r\n\
         Content-Type: text/plain\r\n\r\n\
         Does Thursday work for you? ADA_ONLY_SENTINEL\r\n"
            .as_bytes()
            .to_vec(),
        &[],
    );
    world.add(
        "INBOX",
        "From: Bea Smith <bea@example.com>\r\n\
         To: person@example.com\r\n\
         Message-ID: <bea-f3@example.org>\r\n\
         Subject: Invoice question\r\n\
         Content-Type: text/plain\r\n\r\n\
         Can you send the invoice? BEA_ONLY_SENTINEL\r\n"
            .as_bytes()
            .to_vec(),
        &[],
    );
    world.add(
        "Sent Messages",
        mail(USER, "sent-friend", "To: friend@example.org\r\n"),
        &["\\Seen"],
    );
}

fn run_async<F: std::future::Future>(f: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(f)
}

fn find_message(fixture: &Fixture, query: &str) -> i64 {
    let found = fixture.person("mail-search", json!({ "query": query }));
    found["data"]["hits"][0]["message"].as_i64().unwrap()
}

async fn approved_local(
    registry: &afd::CommandRegistry,
    name: &str,
    input: Value,
) -> afd::CommandResult<Value> {
    let local = Local(registry);
    let held = local.run(name, input.clone(), true, None).await;
    let token = held
        .error
        .as_ref()
        .and_then(|e| e.details.as_ref())
        .and_then(|d| d.get("approvalToken"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| panic!("{name} was not held: {held:?}"));
    local.run(name, input, true, Some(token)).await
}

async fn make_token(registry: &afd::CommandRegistry, name: &str, role: &str) -> (String, String) {
    let made = approved_local(
        registry,
        "mail-token-create",
        json!({ "name": name, "role": role }),
    )
    .await;
    assert!(made.success, "{made:?}");
    let data = made.data.unwrap();
    (
        data["token"].as_str().unwrap().to_string(),
        data["secret"].as_str().unwrap().to_string(),
    )
}

fn modern_mcp(method: &str, mut params: Value) -> Value {
    let mut meta: Value = serde_json::from_str(MODERN_META).unwrap();
    if let Some(extra) = params.get("_meta").and_then(Value::as_object).cloned() {
        for (k, v) in extra {
            meta[k] = v;
        }
    }
    params["_meta"] = meta;
    json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params })
}

fn legacy_mcp(method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params })
}

async fn post_mcp(app: &axum::Router, token: &str, body: Value, protocol: &str) -> (u16, Value) {
    let method = body["method"].as_str().unwrap_or_default().to_string();
    let mut builder = axum::http::Request::post("/mcp")
        .header("host", GOOD_HOST)
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("authorization", format!("Bearer {token}"))
        .header("mcp-protocol-version", protocol)
        .header("mcp-method", method);
    if let Some(name) = body["params"]["name"].as_str() {
        builder = builder.header("mcp-name", name.to_string());
    }
    let request = builder.body(Body::from(body.to_string())).unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&bytes).to_string();
    let json = serde_json::from_str(&text).unwrap_or_else(|_| {
        text.lines()
            .find_map(|line| line.strip_prefix("data: "))
            .and_then(|data| serde_json::from_str(data).ok())
            .unwrap_or(Value::String(text))
    });
    (status, json)
}

async fn post_mcp_http_raw(
    addr: std::net::SocketAddr,
    token: &str,
    body: Value,
    protocol: &str,
) -> (u16, Vec<u8>, Value) {
    let stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    let (mut sender, conn) =
        hyper::client::conn::http1::handshake(hyper_util::rt::TokioIo::new(stream))
            .await
            .unwrap();
    tokio::spawn(async move {
        let _ = conn.await;
    });
    let method = body["method"].as_str().unwrap_or_default().to_string();
    let mut builder = axum::http::Request::post("/mcp")
        .header("host", format!("127.0.0.1:{}", addr.port()))
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("authorization", format!("Bearer {token}"))
        .header("mcp-protocol-version", protocol)
        .header("mcp-method", method);
    if let Some(name) = body["params"]["name"].as_str() {
        builder = builder.header("mcp-name", name.to_string());
    }
    let request = builder.body(Body::from(body.to_string())).unwrap();
    let response = sender.send_request(request).await.unwrap();
    let status = response.status().as_u16();
    let raw = response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec();
    let text = String::from_utf8_lossy(&raw).to_string();
    let json = serde_json::from_str(&text).unwrap_or_else(|_| {
        text.lines()
            .find_map(|line| line.strip_prefix("data: "))
            .and_then(|data| serde_json::from_str(data).ok())
            .unwrap_or(Value::String(text))
    });
    (status, raw, json)
}

async fn post_cli(app: &axum::Router, command: &str, input: Value) -> (u16, Value) {
    let body = json!({ "command": command, "input": input, "terminal": true });
    let request = axum::http::Request::post("/cli")
        .header("host", GOOD_HOST)
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {CLI_TOKEN}"))
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap();
    (status, json)
}

fn tool_result(response: &Value) -> &Value {
    &response["result"]["structuredContent"]
}

fn mcp_call(name: &str, arguments: Value) -> Value {
    modern_mcp(
        "tools/call",
        json!({ "name": name, "arguments": arguments }),
    )
}

fn mcp_call_with_approval(name: &str, arguments: Value, approval_token: &str) -> Value {
    modern_mcp(
        "tools/call",
        json!({
            "name": name,
            "arguments": arguments,
            "_meta": { "dev.afd/approval": approval_token },
        }),
    )
}

/// Counts every JSON value in `v` (including objects, arrays, and scalars),
/// matching Loam kernel's `PREVIEW_VALUES_MAX = 200` walk.
fn count_json_values(v: &Value) -> usize {
    match v {
        Value::Array(items) => 1 + items.iter().map(count_json_values).sum::<usize>(),
        Value::Object(map) => 1 + map.values().map(count_json_values).sum::<usize>(),
        _ => 1,
    }
}

/// Creates a 2-reply set (Ada + Bea) with answered questions and submits both
/// replies via `mail-replyset-next` + `mail-replyset-submit`, returning
/// `(set_id, final_revision)`.
fn create_completed_two_reply_set(fixture: &Fixture) -> (i64, i64) {
    let ada_msg = find_message(fixture, "ADA_ONLY_SENTINEL");
    let bea_msg = find_message(fixture, "BEA_ONLY_SENTINEL");
    let created = fixture.person(
        "mail-replyset-create",
        json!({
            "messages": [ada_msg, bea_msg],
            "questions": [
                {
                    "question": "Does Thursday work?",
                    "messages": [ada_msg],
                    "answer": "Thursday works.",
                },
                {
                    "question": "Can you send the invoice?",
                    "messages": [bea_msg],
                    "answer": "The invoice is attached.",
                },
            ],
        }),
    );
    assert_eq!(created["success"], true, "{created}");
    let set_id = created["data"]["replyset"]["id"].as_i64().unwrap();

    for text in [
        "Dear Ada, Thursday works.",
        "Dear Bea, the invoice is attached.",
    ] {
        let next = fixture.person("mail-replyset-next", json!({ "replyset": set_id }));
        assert_eq!(next["success"], true, "{next}");
        let sub = fixture.person(
            "mail-replyset-submit",
            json!({
                "replyset": set_id,
                "reply": next["data"]["reply"],
                "unit": next["data"]["unit"],
                "claim": next["data"]["claim"],
                "text": text,
            }),
        );
        assert_eq!(sub["success"], true, "{sub}");
    }
    let show = fixture.person("mail-replyset-show", json!({ "replyset": set_id }));
    assert_eq!(show["success"], true, "{show}");
    let rev = show["data"]["replyset"]["revision"].as_i64().unwrap();
    (set_id, rev)
}

/// F-T3: Non-approver (HTTP agent and stdio) gets `APPROVAL_REQUIRED` with
/// `retryable: false`, content-free summary, engine suggestion, and NO
/// `approvalToken`; `/cli` keeps `approvalToken`.
#[test]
fn ft3_non_approver_held_result_for_replyset_send() {
    let fixture = Fixture::new(world);
    let (set_id, rev) = create_completed_two_reply_set(&fixture);
    let input = json!({ "replyset": set_id, "revision": rev });

    run_async(async {
        let (_agent_id, agent_secret) = make_token(&fixture.registry, "claude", "agent").await;
        let app = router(
            &fixture.registry,
            Arc::clone(&fixture.engine),
            PORT,
            CLI_TOKEN,
        )
        .unwrap();

        // 1. Ordinary agent over HTTP /mcp.
        let (status, resp) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "afd-call",
                json!({ "command": "mail-replyset-send", "input": input }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(status, 200, "{resp}");
        let sc = tool_result(&resp);
        assert_eq!(sc["success"], false, "{sc}");
        assert_eq!(sc["error"]["code"], "APPROVAL_REQUIRED", "{sc}");
        assert_eq!(sc["error"]["retryable"], false, "{sc}");
        assert!(
            sc["error"]["details"].get("approvalToken").is_none(),
            "non-approver must not receive approvalToken: {sc}"
        );
        assert!(!resp.to_string().contains("approvalToken"), "{resp}");
        let suggestion = sc["error"]["suggestion"].as_str().unwrap();
        assert!(
            suggestion.contains("loam-mail mail-replyset-send"),
            "{suggestion}"
        );
        assert_labelled(sc, CONTENT_WORDS);
        assert_eq!(fixture.smtp.world().received.len(), 0);

        // 2. `/cli` route keeps `approvalToken`.
        let (cli_status, cli_body) = post_cli(&app, "mail-replyset-send", input.clone()).await;
        assert_eq!(cli_status, 200, "{cli_body}");
        assert_eq!(cli_body["error"]["code"], "APPROVAL_REQUIRED", "{cli_body}");
        assert!(
            cli_body["error"]["details"]["approvalToken"]
                .as_str()
                .is_some_and(|t| !t.is_empty()),
            "/cli must retain approvalToken: {cli_body}"
        );
        assert_eq!(fixture.smtp.world().received.len(), 0);
    });

    // 3. Stdio caller (Mcp interface, Agent actor with no token id) — run
    //    outside `run_async` because `Fixture::execute` owns its own runtime.
    let stdio_ctx = CommandContext::new()
        .with_interface(CommandInterface::Mcp)
        .with_actor(ActorKind::Agent);
    let stdio_res = fixture.execute("mail-replyset-send", input, stdio_ctx);
    assert_eq!(
        stdio_res["error"]["code"], "APPROVAL_REQUIRED",
        "{stdio_res}"
    );
    assert_eq!(stdio_res["error"]["retryable"], false, "{stdio_res}");
    assert!(
        stdio_res["error"]["details"].get("approvalToken").is_none(),
        "stdio caller must not receive approvalToken: {stdio_res}"
    );
    assert_labelled(&stdio_res, CONTENT_WORDS);
    assert_eq!(fixture.smtp.world().received.len(), 0);
}

/// F-T4: Approver release matrix for `mail-replyset-send`: single-use token,
/// wrong-approver refusal, 2025-era protocol refusal, `afd-batch`/`afd-pipe`
/// refusal, agent `_meta` ignored, tool-arg `approvalToken` -> `VALIDATION_ERROR`,
/// and single-use replay refusal even after SMTP 452 leaves the set open.
#[test]
fn ft4_approver_release_matrix_for_replyset_send() {
    let fixture = Fixture::new(world);
    let (set_id, rev) = create_completed_two_reply_set(&fixture);
    let (set2, rev2) = create_completed_two_reply_set(&fixture);
    let send_input = json!({ "replyset": set_id, "revision": rev });
    let send2 = json!({ "replyset": set2, "revision": rev2 });

    run_async(async {
        let (_agent_id, agent_secret) = make_token(&fixture.registry, "agent", "agent").await;
        let (_app_a_id, approver_a) = make_token(&fixture.registry, "loam-a", "approver").await;
        let (_app_b_id, approver_b) = make_token(&fixture.registry, "loam-b", "approver").await;
        let app = router(
            &fixture.registry,
            Arc::clone(&fixture.engine),
            PORT,
            CLI_TOKEN,
        )
        .unwrap();

        // 1. Approver A gets a hold with approvalToken.
        let (st, held_resp) = post_mcp(
            &app,
            &approver_a,
            mcp_call(
                "afd-call",
                json!({ "command": "mail-replyset-send", "input": send_input }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(st, 200, "{held_resp}");
        let held_sc = tool_result(&held_resp);
        assert_eq!(held_sc["error"]["code"], "APPROVAL_REQUIRED", "{held_sc}");
        assert_labelled(held_sc, CONTENT_WORDS);
        let token = held_sc["error"]["details"]["approvalToken"]
            .as_str()
            .expect("approver gets approvalToken")
            .to_string();
        assert_eq!(fixture.smtp.world().received.len(), 0);

        // 2. Another approver (B) cannot redeem A's token.
        let (_, wrong_app) = post_mcp(
            &app,
            &approver_b,
            mcp_call_with_approval(
                "afd-call",
                json!({ "command": "mail-replyset-send", "input": send_input }),
                &token,
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&wrong_app)["success"], false, "{wrong_app}");
        assert_eq!(fixture.smtp.world().received.len(), 0);

        // 3. 2025-era protocol client cannot redeem approval token.
        let (_, legacy) = post_mcp(
            &app,
            &approver_a,
            legacy_mcp(
                "tools/call",
                json!({
                    "name": "afd-call",
                    "arguments": { "command": "mail-replyset-send", "input": send_input },
                    "_meta": { "dev.afd/approval": token },
                }),
            ),
            "2025-06-18",
        )
        .await;
        assert_eq!(tool_result(&legacy)["success"], false, "{legacy}");
        assert_eq!(fixture.smtp.world().received.len(), 0);

        // 4. `afd-batch` and `afd-pipe` refused up front for both agent and approver,
        //    with no approvalToken leaked and 0 SMTP sends.
        for (caller_label, secret) in [("agent", &agent_secret), ("approver", &approver_a)] {
            let batch_body = mcp_call_with_approval(
                "afd-batch",
                json!({ "commands": [{ "command": "mail-replyset-send", "input": send_input }] }),
                &token,
            );
            let (_, batch_resp) = post_mcp(&app, secret, batch_body, "2026-07-28").await;
            let batch_code = tool_result(&batch_resp)["error"]["code"]
                .as_str()
                .unwrap_or("");
            assert!(
                matches!(batch_code, "ONE_COMMAND_PER_CALL" | "APPROVAL_REQUIRED"),
                "{caller_label} batch: {batch_resp}"
            );
            assert!(
                !batch_resp.to_string().contains("approvalToken"),
                "{caller_label} batch leaked token: {batch_resp}"
            );

            let pipe_body = mcp_call_with_approval(
                "afd-pipe",
                json!({ "steps": [{ "command": "mail-replyset-send", "input": send_input }] }),
                &token,
            );
            let (_, pipe_resp) = post_mcp(&app, secret, pipe_body, "2026-07-28").await;
            let pipe_code = tool_result(&pipe_resp)["error"]["code"]
                .as_str()
                .unwrap_or("");
            assert!(
                matches!(pipe_code, "ONE_COMMAND_PER_CALL" | "APPROVAL_REQUIRED"),
                "{caller_label} pipe: {pipe_resp}"
            );
            assert!(
                !pipe_resp.to_string().contains("approvalToken"),
                "{caller_label} pipe leaked token: {pipe_resp}"
            );
        }
        assert_eq!(fixture.smtp.world().received.len(), 0);

        // 5. Agent presenting approver's token in `_meta` is ignored.
        let (_, agent_meta) = post_mcp(
            &app,
            &agent_secret,
            mcp_call_with_approval(
                "afd-call",
                json!({ "command": "mail-replyset-send", "input": send_input }),
                &token,
            ),
            "2026-07-28",
        )
        .await;
        let agent_sc = tool_result(&agent_meta);
        assert_eq!(agent_sc["error"]["code"], "APPROVAL_REQUIRED", "{agent_sc}");
        assert!(agent_sc["error"]["details"].get("approvalToken").is_none());
        assert_eq!(fixture.smtp.world().received.len(), 0);

        // 6. Putting `dev.afd/approval` in tool arguments fails with VALIDATION_ERROR.
        let (_, arg_token) = post_mcp(
            &app,
            &approver_a,
            mcp_call(
                "afd-call",
                json!({
                    "command": "mail-replyset-send",
                    "input": send_input,
                    "dev.afd/approval": token,
                }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&arg_token)["error"]["code"],
            "VALIDATION_ERROR",
            "{arg_token}"
        );
        assert_eq!(fixture.smtp.world().received.len(), 0);

        // 7. Approver A retries with `_meta["dev.afd/approval"]` on MCP 2026-07-28 -> sends once!
        let (_, sent_resp) = post_mcp(
            &app,
            &approver_a,
            mcp_call_with_approval(
                "afd-call",
                json!({ "command": "mail-replyset-send", "input": send_input }),
                &token,
            ),
            "2026-07-28",
        )
        .await;
        let sent_sc = tool_result(&sent_resp);
        assert_eq!(sent_sc["success"], true, "{sent_sc}");
        assert_eq!(sent_sc["data"]["state"], "sent");
        assert_eq!(sent_sc["data"]["sent"], 2);
        assert_eq!(fixture.smtp.world().received.len(), 2);

        // 8. Second retry with the same token is refused (0 extra sends).
        let (_, replay) = post_mcp(
            &app,
            &approver_a,
            mcp_call_with_approval(
                "afd-call",
                json!({ "command": "mail-replyset-send", "input": send_input }),
                &token,
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&replay)["success"], false, "{replay}");
        assert_eq!(fixture.smtp.world().received.len(), 2);

        // 9. Single-use token replay even when a transient SMTP 452 leaves the set open.
        let (_, hold2) = post_mcp(
            &app,
            &approver_a,
            mcp_call(
                "afd-call",
                json!({ "command": "mail-replyset-send", "input": send2 }),
            ),
            "2026-07-28",
        )
        .await;
        let tok2 = tool_result(&hold2)["error"]["details"]["approvalToken"]
            .as_str()
            .unwrap()
            .to_string();

        fixture.smtp.world().fault = Some(SmtpFault::RefuseMailFrom(452));
        let (_, fail_send) = post_mcp(
            &app,
            &approver_a,
            mcp_call_with_approval(
                "afd-call",
                json!({ "command": "mail-replyset-send", "input": send2 }),
                &tok2,
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&fail_send)["error"]["code"],
            "PROVIDER_LIMIT",
            "{fail_send}"
        );
        fixture.smtp.world().fault = None;

        // Replaying tok2 fails (both because token is spent and revision advanced), 0 new sends.
        let (_, replay2) = post_mcp(
            &app,
            &approver_a,
            mcp_call_with_approval(
                "afd-call",
                json!({ "command": "mail-replyset-send", "input": send2 }),
                &tok2,
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&replay2)["success"], false, "{replay2}");
        assert_eq!(fixture.smtp.world().received.len(), 2);
    });
}

/// F-T6: Whole preview canonical stability, `SHOW_BUDGET == MOST_BUDGET`,
/// Loam shell 64 KiB / 200-value ceiling on ordinary 2-reply preview, M39
/// worst-case transport check under 3.5 MiB, 51st reply refusal, and atomic
/// `PREVIEW_TOO_LARGE` rollback on submit.
#[test]
fn ft6_replyset_preview_stability_shell_ceiling_and_m39_transport_cap() {
    let fixture = Fixture::new(world);
    let (set_id, _rev) = create_completed_two_reply_set(&fixture);

    // 1. Canonical JSON stability across reads & all content labelled.
    let s1 = fixture.person("mail-replyset-show", json!({ "replyset": set_id }));
    let s2 = fixture.person("mail-replyset-show", json!({ "replyset": set_id }));
    assert_eq!(s1["success"], true, "{s1}");
    assert_eq!(
        canonical_json(&s1["data"]).unwrap(),
        canonical_json(&s2["data"]).unwrap()
    );
    assert_labelled(&s1, CONTENT_WORDS);

    // 2. Ordinary 2-reply set fits within Loam shell's 64 KiB / 200-value ceiling.
    let data = &s1["data"];
    let raw_bytes = serde_json::to_string(data).unwrap().len();
    let value_count = count_json_values(data);
    assert!(
        raw_bytes <= 65_536,
        "ordinary 2-reply preview must fit Loam 64 KiB ceiling, got {raw_bytes}"
    );
    assert!(
        value_count <= 200,
        "ordinary 2-reply preview must fit Loam 200-value ceiling, got {value_count}"
    );

    // 3. `mail-replyset-show` declares default budget == max budget.
    let show_def = fixture
        .registry
        .list()
        .into_iter()
        .find(|c| c.name == "mail-replyset-show")
        .unwrap();
    let budget = show_def
        .output_budget
        .expect("mail-replyset-show has budget");
    assert_eq!(budget.default_bytes, budget.max_bytes);

    // 4. 51st reply refused.
    let too_many: Vec<i64> = (1..=51).collect();
    let refused = fixture.person("mail-replyset-create", json!({ "messages": too_many }));
    assert_eq!(refused["error"]["code"], "INVALID_INPUT", "{refused}");

    // 5. Worst-case M39 escaping check: fill a 45-reply set with heavy quote/backslash/control
    //    characters until `mail-replyset-submit` refuses with `PREVIEW_TOO_LARGE`, verifying
    //    that the last accepted state fits over MCP within `MAX_PREVIEW_MCP_BYTES` and that
    //    the rejected submit left revision and reply text untouched!
    let many_fixture = Fixture::new(|w| {
        w.mailbox("INBOX", &[]);
        w.mailbox("Sent Messages", &["\\Sent"]);
        for i in 1..=50u32 {
            w.add(
                "INBOX",
                format!(
                    "From: Sender {i} <sender{i}@example.org>\r\n\
                     To: person@example.com\r\n\
                     Message-ID: <m39-{i}@example.org>\r\n\
                     Subject: Cohort item {i}\r\n\
                     Content-Type: text/plain\r\n\r\n\
                     Question {i}\r\n"
                )
                .into_bytes(),
                &[],
            );
        }
    });
    let mut msg_ids = Vec::with_capacity(50);
    for i in 1..=50 {
        msg_ids.push(find_message(&many_fixture, &format!("Question {i}")));
    }
    let big_set = many_fixture.person("mail-replyset-create", json!({ "messages": msg_ids }));
    assert_eq!(big_set["success"], true, "{big_set}");
    let big_id = big_set["data"]["replyset"]["id"].as_i64().unwrap();

    // Worst-case JSON-escaped chunk: `\"\x01` expands 2x-6x in JSON and again in MCP text.
    let unit_pattern = "\"\\\u{0001}";
    let worst_chunk: String = unit_pattern.repeat(8_000); // 24,000 chars (< 32,768)
    let mut last_accepted_rev = 1i64;
    let mut hit_too_large = false;
    let mut boundary_unit: Option<(i64, String, String)> = None;
    for _ in 0..50 {
        let next = many_fixture.person("mail-replyset-next", json!({ "replyset": big_id }));
        assert_eq!(next["success"], true, "{next}");
        let rid = next["data"]["reply"].as_i64().unwrap();
        let uid = next["data"]["unit"].as_str().unwrap().to_string();
        let clm = next["data"]["claim"].as_str().unwrap().to_string();
        let sub = many_fixture.person(
            "mail-replyset-submit",
            json!({
                "replyset": big_id,
                "reply": rid,
                "unit": uid,
                "claim": clm,
                "text": worst_chunk,
            }),
        );
        if sub["success"] == true {
            last_accepted_rev = sub["data"]["revision"].as_i64().unwrap();
        } else {
            assert_eq!(sub["error"]["code"], "PREVIEW_TOO_LARGE", "{sub}");
            hit_too_large = true;
            boundary_unit = Some((rid, uid, clm));
            break;
        }
    }
    assert!(
        hit_too_large,
        "expected worst-case 50-reply set to hit PREVIEW_TOO_LARGE"
    );

    // Binary-search the largest accepted worst-case partial chunk on the
    // boundary reply so the set sits right at the build-time ceiling (and
    // proves the rejected submit above left the unit and claim intact for a
    // shorter retry!).
    let (boundary_rid, boundary_uid, boundary_clm) = boundary_unit.unwrap();
    let mut lo = 0usize;
    let mut hi = 8_000usize;
    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2);
        let probe = many_fixture.person(
            "mail-replyset-submit",
            json!({
                "replyset": big_id,
                "reply": boundary_rid,
                "unit": boundary_uid,
                "claim": boundary_clm,
                "text": unit_pattern.repeat(mid),
            }),
        );
        if probe["success"] == true {
            // Accepted — now pack via `mail-replyset-update` on the same reply
            // to find the exact maximum accepted character count.
            last_accepted_rev = probe["data"]["revision"].as_i64().unwrap();
            lo = mid;
            break;
        }
        assert_eq!(probe["error"]["code"], "PREVIEW_TOO_LARGE", "{probe}");
        hi = mid - 1;
    }
    let mut best_repeats = lo;
    let mut hi_upd = hi;
    while best_repeats < hi_upd {
        let mid = best_repeats + (hi_upd - best_repeats).div_ceil(2);
        let probe = many_fixture.person(
            "mail-replyset-update",
            json!({
                "replyset": big_id,
                "revision": last_accepted_rev,
                "reply": boundary_rid,
                "text": unit_pattern.repeat(mid),
            }),
        );
        if probe["success"] == true {
            last_accepted_rev = probe["data"]["replyset"]["revision"].as_i64().unwrap();
            best_repeats = mid;
        } else {
            assert_eq!(probe["error"]["code"], "PREVIEW_TOO_LARGE", "{probe}");
            hi_upd = mid - 1;
        }
    }
    let expected_last_text = if best_repeats > 0 {
        unit_pattern.repeat(best_repeats)
    } else {
        worst_chunk.clone()
    };

    // Atomic rollback + real loopback TCP HTTP `/mcp` transport verification:
    // read the largest accepted worst-case set over a real TCP socket with NO
    // output-budget override (matching Loam's desktop call), measuring the RAW
    // HTTP response body bytes (including any SSE framing) before parsing!
    let mut accepted_replies = 0usize;
    run_async(async {
        let (_tok_id, agent_secret) = make_token(&many_fixture.registry, "ft6-http", "agent").await;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = router(
            &many_fixture.registry,
            Arc::clone(&many_fixture.engine),
            addr.port(),
            CLI_TOKEN,
        )
        .unwrap();
        let server_task = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let (status, raw_bytes, http_resp) = post_mcp_http_raw(
            addr,
            &agent_secret,
            mcp_call(
                "afd-call",
                json!({ "command": "mail-replyset-show", "input": { "replyset": big_id } }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(status, 200, "{http_resp}");
        assert!(
            raw_bytes.len() < 4 * 1024 * 1024,
            "raw HTTP/SSE wire response exceeded 4 MiB desktop transport cap: {}",
            raw_bytes.len()
        );
        let sc = tool_result(&http_resp);
        assert_eq!(sc["success"], true, "{sc}");
        assert_eq!(sc["data"]["replyset"]["revision"], last_accepted_rev);
        let replies = sc["data"]["replyset"]["replies"].as_array().unwrap();
        assert_eq!(replies.len(), 50);
        let last_filled = replies
            .iter()
            .rev()
            .find(|r| r["content"]["text"].is_string())
            .expect("at least one reply was accepted before PREVIEW_TOO_LARGE");
        assert_eq!(
            last_filled["content"]["text"].as_str().unwrap(),
            expected_last_text,
            "largest accepted boundary reply must arrive whole over HTTP MCP"
        );
        accepted_replies = replies
            .iter()
            .filter(|r| r["content"]["text"].is_string())
            .count();
        let shown_result = afd::success(sc["data"].clone());
        let mcp_measured = loam_mail::reply_size(&shown_result, Some(CommandInterface::Mcp));
        assert!(
            mcp_measured <= MAX_PREVIEW_MCP_BYTES,
            "accepted worst-case preview exceeded 3.5 MiB reply_size cap: {mcp_measured}"
        );

        // Tight explicit output budget over the same real HTTP `/mcp` connection
        // returns `PREVIEW_TOO_LARGE` (never `OUTPUT_BUDGET_EXCEEDED`), non-retryable.
        let (tight_status, _tight_raw, tight_resp) = post_mcp_http_raw(
            addr,
            &agent_secret,
            modern_mcp(
                "tools/call",
                json!({
                    "name": "afd-call",
                    "arguments": {
                        "command": "mail-replyset-show",
                        "input": { "replyset": big_id },
                    },
                    "_meta": {
                        "dev.afd/outputBudget": { "maxBytes": 256 }
                    }
                }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tight_status, 200, "{tight_resp}");
        let tight_sc = tool_result(&tight_resp);
        assert_eq!(
            tight_sc["error"]["code"], "PREVIEW_TOO_LARGE",
            "{tight_resp}"
        );
        assert_eq!(tight_sc["error"]["retryable"], false);

        server_task.abort();
    });
    assert!(accepted_replies > 0);

    // Pin the Loam 200-value shell ceiling boundary (#2410): a 3-reply set's
    // full show with one shared question fits <= 200 JSON values, a 5-reply
    // set's exceeds it, and its slim confirmation preview (D175) fits.
    let set3 = many_fixture.person(
        "mail-replyset-create",
        json!({
            "messages": &msg_ids[0..3],
            "questions": [{ "question": "Shared?", "messages": &msg_ids[0..3], "answer": "Yes." }],
        }),
    );
    assert_eq!(set3["success"], true, "{set3}");
    let set3_id = set3["data"]["replyset"]["id"].as_i64().unwrap();
    for _ in 0..3 {
        let u = many_fixture.person("mail-replyset-next", json!({ "replyset": set3_id }));
        assert_eq!(u["success"], true, "{u}");
        let sub = many_fixture.person(
            "mail-replyset-submit",
            json!({
                "replyset": set3_id,
                "reply": u["data"]["reply"],
                "unit": u["data"]["unit"],
                "claim": u["data"]["claim"],
                "text": "Yes, confirmed.",
            }),
        );
        assert_eq!(sub["success"], true, "{sub}");
    }
    let show3 = many_fixture.person("mail-replyset-show", json!({ "replyset": set3_id }));
    assert_eq!(show3["success"], true, "{show3}");
    assert!(
        count_json_values(&show3["data"]) <= 200,
        "3-reply set with 1 shared question should fit 200 values, got {}",
        count_json_values(&show3["data"])
    );

    let set5 = many_fixture.person(
        "mail-replyset-create",
        json!({
            "messages": &msg_ids[0..5],
            "questions": [{ "question": "Shared?", "messages": &msg_ids[0..5], "answer": "Yes." }],
        }),
    );
    assert_eq!(set5["success"], true, "{set5}");
    let set5_id = set5["data"]["replyset"]["id"].as_i64().unwrap();
    for _ in 0..5 {
        let u = many_fixture.person("mail-replyset-next", json!({ "replyset": set5_id }));
        assert_eq!(u["success"], true, "{u}");
        let sub = many_fixture.person(
            "mail-replyset-submit",
            json!({
                "replyset": set5_id,
                "reply": u["data"]["reply"],
                "unit": u["data"]["unit"],
                "claim": u["data"]["claim"],
                "text": "Yes, confirmed.",
            }),
        );
        assert_eq!(sub["success"], true, "{sub}");
    }
    let show5 = many_fixture.person("mail-replyset-show", json!({ "replyset": set5_id }));
    assert_eq!(show5["success"], true, "{show5}");
    assert!(
        count_json_values(&show5["data"]) > 200,
        "5-reply set's full show crosses the 200-value shell ceiling, got {}",
        count_json_values(&show5["data"])
    );
    // D175 (#2410): the send's confirmation preview of the same set fits.
    let preview5 = many_fixture.person("mail-replyset-preview", json!({ "replyset": set5_id }));
    assert_eq!(preview5["success"], true, "{preview5}");
    assert!(count_json_values(&preview5["data"]) <= 200, "{preview5}");

    // The largest accepted worst-case set still has replies with no text, so
    // its confirmation preview refuses it as the send does: Loam asks nothing.
    let big_preview = many_fixture.person("mail-replyset-preview", json!({ "replyset": big_id }));
    assert_eq!(
        big_preview["error"]["code"], "REPLYSET_INCOMPLETE",
        "{big_preview}"
    );
}

/// F-T7: Stale/future revisions fail on `mail-replyset-show` and before any
/// hold on `mail-replyset-send`; mutating a reply set between hold and
/// approved retry fails with `PREVIEW_CHANGED` and sends nothing; CLI fills a
/// missing revision from the preview.
#[test]
fn ft7_replyset_revision_checks_pre_hold_mid_hold_and_cli_autofill() {
    let fixture = Fixture::new(world);
    let (set_id, rev) = create_completed_two_reply_set(&fixture);

    // 1. Stale and future revisions fail on mail-replyset-show.
    for bad_rev in [rev - 1, rev + 1, 999] {
        let bad_show = fixture.person(
            "mail-replyset-show",
            json!({ "replyset": set_id, "revision": bad_rev }),
        );
        assert_eq!(bad_show["error"]["code"], "PREVIEW_CHANGED", "{bad_show}");
    }

    // 2. Stale/future revision on mail-replyset-send fails BEFORE hold (no token).
    run_async(async {
        let (_app_id, approver) = make_token(&fixture.registry, "loam", "approver").await;
        let (_other_id, other_agent) = make_token(&fixture.registry, "helper", "agent").await;
        let app = router(
            &fixture.registry,
            Arc::clone(&fixture.engine),
            PORT,
            CLI_TOKEN,
        )
        .unwrap();

        for bad_rev in [rev - 1, rev + 1] {
            let (_, resp) = post_mcp(
                &app,
                &approver,
                mcp_call(
                    "afd-call",
                    json!({
                        "command": "mail-replyset-send",
                        "input": { "replyset": set_id, "revision": bad_rev }
                    }),
                ),
                "2026-07-28",
            )
            .await;
            let sc = tool_result(&resp);
            assert_eq!(sc["error"]["code"], "PREVIEW_CHANGED", "{sc}");
            assert!(!resp.to_string().contains("approvalToken"), "{resp}");
        }

        // 3. Hold at current revision, then another token updates the reply set
        //    before the approved retry -> PREVIEW_CHANGED and 0 SMTP sends!
        let (_, hold) = post_mcp(
            &app,
            &approver,
            mcp_call(
                "afd-call",
                json!({
                    "command": "mail-replyset-send",
                    "input": { "replyset": set_id, "revision": rev }
                }),
            ),
            "2026-07-28",
        )
        .await;
        let token = tool_result(&hold)["error"]["details"]["approvalToken"]
            .as_str()
            .unwrap()
            .to_string();

        let (_, edited) = post_mcp(
            &app,
            &other_agent,
            mcp_call(
                "afd-call",
                json!({
                    "command": "mail-replyset-update",
                    "input": {
                        "replyset": set_id,
                        "revision": rev,
                        "sharedText": "Mutated after preview.",
                    }
                }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&edited)["success"], true, "{edited}");

        let (_, stale_retry) = post_mcp(
            &app,
            &approver,
            mcp_call_with_approval(
                "afd-call",
                json!({
                    "command": "mail-replyset-send",
                    "input": { "replyset": set_id, "revision": rev }
                }),
                &token,
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&stale_retry)["error"]["code"],
            "PREVIEW_CHANGED",
            "{stale_retry}"
        );
        assert_eq!(fixture.smtp.world().received.len(), 0);
    });

    // 4. CLI auto-fills missing `revision` from preview and sends cleanly.
    struct SayYes;
    impl loam_mail::cli::Person for SayYes {
        fn confirm(&mut self, _question: &str) -> std::io::Result<bool> {
            Ok(true)
        }
        fn secret(&mut self, _prompt: &str) -> std::io::Result<String> {
            Ok(String::new())
        }
    }
    let mut person = SayYes;
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let status = run(
        &[
            "mail-replyset-send".to_string(),
            json!({ "replyset": set_id }).to_string(),
        ],
        &fixture.registry,
        Caller::Terminal(&mut person),
        &InMemory::default(),
        &mut out,
        &mut err,
    )
    .unwrap();
    assert_eq!(
        status,
        EXIT_OK,
        "out={} err={}",
        String::from_utf8_lossy(&out),
        String::from_utf8_lossy(&err)
    );
    assert_eq!(fixture.smtp.world().received.len(), 2);
}

/// F-T9: Pure-read stateless `mail-replyset-next`, `dev.loam/unit` exact shape,
/// `mail-replyset-submit` metadata, claim refusal matrix (`UNIT_NOT_OPEN`),
/// persistence across engine restart and `mail-rebuild`, claim key secrecy,
/// journal redaction of `claim` on both success and failure, and migration 24.
#[test]
fn ft9_units_stateless_next_claims_submit_audit_restart_rebuild_and_journal() {
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ADA_ONLY_SENTINEL");
    let bea_msg = find_message(&fixture, "BEA_ONLY_SENTINEL");

    // 1. Verify registry metadata for `mail-replyset-next` (read) and `mail-replyset-submit` (non-destructive mutation, no approval).
    let next_def = fixture
        .registry
        .list()
        .into_iter()
        .find(|c| c.name == "mail-replyset-next")
        .unwrap();
    assert!(!next_def.mutation, "mail-replyset-next must be a read");
    assert_ne!(next_def.destructive, Some(true));
    assert!(next_def.approval.is_none());

    let submit_def = fixture
        .registry
        .list()
        .into_iter()
        .find(|c| c.name == "mail-replyset-submit")
        .unwrap();
    assert!(
        submit_def.mutation,
        "mail-replyset-submit must be a mutation"
    );
    assert_ne!(submit_def.destructive, Some(true));
    assert!(submit_def.approval.is_none());

    // Create a 2-reply set with questions.
    let created = fixture.person(
        "mail-replyset-create",
        json!({
            "messages": [ada_msg, bea_msg],
            "questions": [
                {
                    "question": "Does Thursday work?",
                    "messages": [ada_msg],
                    "answer": "Thursday works.",
                },
                {
                    "question": "Can you send the invoice?",
                    "messages": [bea_msg],
                    "answer": "The invoice is attached.",
                },
            ],
        }),
    );
    assert_eq!(created["success"], true, "{created}");
    let set_id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let ada_reply = created["data"]["replyset"]["replies"][0]["reply"]
        .as_i64()
        .unwrap();
    let bea_reply = created["data"]["replyset"]["replies"][1]["reply"]
        .as_i64()
        .unwrap();
    let q_ada = created["data"]["replyset"]["content"]["questions"][0]["id"]
        .as_i64()
        .unwrap();

    // Capture raw claim key so we can assert it NEVER leaks anywhere.
    let raw_key = fixture
        .engine
        .with_store(|store| store.replyset_claim_key())
        .unwrap();
    let mut raw_key_hex = String::with_capacity(64);
    for b in raw_key {
        use std::fmt::Write;
        let _ = write!(&mut raw_key_hex, "{b:02x}");
    }

    // 2. `mail-replyset-next` is a pure read: DB total_changes == 0 across calls,
    //    exact `dev.loam/unit` shape, matching `unit` & 43-char `claim`.
    let journal_path = fixture.directory.path().join("data").join("journal.jsonl");
    let journal_before = std::fs::read_to_string(&journal_path).unwrap_or_default();

    let next1 = fixture.agent("tok_a", "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(next1["success"], true, "{next1}");
    assert!(!next1.to_string().contains(&raw_key_hex));
    let next1_again = fixture.agent("tok_a", "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(
        canonical_json(&next1["data"]).unwrap(),
        canonical_json(&next1_again["data"]).unwrap(),
        "stateless mail-replyset-next must be deterministic across repeated reads"
    );

    // Journal was NOT appended by `mail-replyset-next`.
    let journal_after_next = std::fs::read_to_string(&journal_path).unwrap_or_default();
    assert_eq!(journal_before, journal_after_next);

    // Exact `dev.loam/unit` marker checks (matching Loam kernel units.ts).
    let unit_id = next1["data"]["unit"].as_str().unwrap().to_string();
    let claim1 = next1["data"]["claim"].as_str().unwrap().to_string();
    assert_eq!(unit_id, format!("rsu_{set_id}_{ada_reply}_1"));
    assert_eq!(claim1.len(), 43);
    assert!(
        claim1
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
        "claim must be unpadded base64url: {claim1}"
    );
    let marker = next1["data"]["dev.loam/unit"].as_object().unwrap();
    let mut marker_keys: Vec<&str> = marker.keys().map(String::as_str).collect();
    marker_keys.sort();
    assert_eq!(marker_keys, ["id", "instructions", "submit"]);
    assert_eq!(marker["id"], unit_id);
    let instructions = marker["instructions"].as_str().unwrap();
    assert!(!instructions.is_empty() && instructions.len() <= 4_096);
    let submit_obj = marker["submit"].as_object().unwrap();
    let mut submit_keys: Vec<&str> = submit_obj.keys().map(String::as_str).collect();
    submit_keys.sort();
    assert_eq!(submit_keys, ["command", "field", "input"]);
    assert_eq!(submit_obj["command"], "mail-replyset-submit");
    assert_eq!(submit_obj["field"], "text");
    assert_eq!(
        submit_obj["input"],
        json!({
            "replyset": set_id,
            "reply": ada_reply,
            "unit": unit_id,
            "claim": claim1,
        })
    );
    assert!(submit_obj["input"].get("text").is_none());

    // 3. Guessed claim, short claim, wrong reply's claim -> UNIT_NOT_OPEN.
    for bad_claim in ["guess", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"] {
        let bad = fixture.agent(
            "tok_a",
            "mail-replyset-submit",
            json!({
                "replyset": set_id,
                "reply": ada_reply,
                "unit": unit_id,
                "claim": bad_claim,
                "text": "Hi Ada.",
            }),
        );
        assert_eq!(bad["error"]["code"], "UNIT_NOT_OPEN", "{bad}");
        assert!(
            bad["error"]["suggestion"]
                .as_str()
                .unwrap()
                .contains("mail-replyset-next")
        );
    }

    // 4. Overlong text (> 32,768 chars) fails with INVALID_INPUT AND its valid
    //    unspent `claim1` is STILL redacted from `journal.jsonl`!
    let too_long = fixture.agent(
        "tok_a",
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": ada_reply,
            "unit": unit_id,
            "claim": claim1,
            "text": "a".repeat(32_769),
        }),
    );
    assert_eq!(too_long["error"]["code"], "INVALID_INPUT", "{too_long}");
    let journal_after_failed = std::fs::read_to_string(&journal_path).unwrap();
    assert!(
        !journal_after_failed.contains(&claim1),
        "unspent claim leaked into journal after failed submit!"
    );

    // 5. `mail-replyset-submit` schema accepts ONLY { replyset, reply, unit, claim, text }
    //    (no recipient, subject, or account parameters).
    let mut submit_params: Vec<&str> = submit_def
        .parameters
        .iter()
        .map(|p| p.name.as_str())
        .collect();
    submit_params.sort();
    assert_eq!(
        submit_params,
        ["claim", "reply", "replyset", "text", "unit"]
    );

    // 6. Claim survives `mail-rebuild`!
    let rebuilt = fixture.person("mail-rebuild", json!({}));
    assert_eq!(rebuilt["success"], true, "{rebuilt}");
    let next_after_rebuild =
        fixture.agent("tok_a", "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(next_after_rebuild["data"]["claim"], claim1);

    // 6b. If the source message's derived text/subject changes (e.g. parser upgrade
    //     or repaired blob), `claim1` for the SAME `unit_id` fails with UNIT_NOT_OPEN!
    {
        let conn =
            rusqlite::Connection::open(fixture.directory.path().join("data").join("mail.sqlite3"))
                .unwrap();
        conn.execute(
            "UPDATE envelope SET subject = 'Thursday (re-derived)' WHERE message_id = ?1",
            [ada_msg],
        )
        .unwrap();
    }
    let stale_after_source_change = fixture.agent(
        "tok_a",
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": ada_reply,
            "unit": unit_id,
            "claim": claim1,
            "text": "Stale source digest.",
        }),
    );
    assert_eq!(
        stale_after_source_change["error"]["code"], "UNIT_NOT_OPEN",
        "{stale_after_source_change}"
    );
    // Restore via rebuild: because the derived source changed and then changed
    // back during rebuild, generation advanced permanently (1 -> 3) so the
    // original `rsu_1_1_1` claim MUST stay `UNIT_NOT_OPEN` (plugin.spec.md 9.1).
    let rebuilt2 = fixture.person("mail-rebuild", json!({}));
    assert_eq!(rebuilt2["success"], true, "{rebuilt2}");
    let stale_after_restore = fixture.agent(
        "tok_a",
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": ada_reply,
            "unit": unit_id,
            "claim": claim1,
            "text": "Replaying original claim after restore.",
        }),
    );
    assert_eq!(
        stale_after_restore["error"]["code"], "UNIT_NOT_OPEN",
        "{stale_after_restore}"
    );
    let next_post_restore =
        fixture.agent("tok_a", "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(next_post_restore["success"], true, "{next_post_restore}");
    let post_restore_unit = next_post_restore["data"]["unit"]
        .as_str()
        .unwrap()
        .to_string();
    let post_restore_claim = next_post_restore["data"]["claim"]
        .as_str()
        .unwrap()
        .to_string();
    let post_restore_rev = next_post_restore["data"]["revision"].as_i64().unwrap();
    assert_ne!(
        post_restore_unit, unit_id,
        "generation must advance after derived source change"
    );

    // 7. Updating Ada's answer invalidates `post_restore_claim` -> UNIT_NOT_OPEN.
    let ans_upd = fixture.person(
        "mail-replyset-update",
        json!({
            "replyset": set_id,
            "revision": post_restore_rev,
            "answers": [{ "question": q_ada, "answer": "Thursday at 3pm works." }],
        }),
    );
    assert_eq!(ans_upd["success"], true, "{ans_upd}");
    let stale_ans = fixture.agent(
        "tok_a",
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": ada_reply,
            "unit": post_restore_unit,
            "claim": post_restore_claim,
            "text": "Old answer text.",
        }),
    );
    assert_eq!(stale_ans["error"]["code"], "UNIT_NOT_OPEN", "{stale_ans}");

    // 8. Pull fresh unit for Ada, then simulate engine restart (drop and reopen
    //    Store/Engine on the same data directory) and verify the claim STILL works!
    let next2 = fixture.agent("tok_a", "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(next2["success"], true, "{next2}");
    let unit2 = next2["data"]["unit"].as_str().unwrap().to_string();
    let claim2 = next2["data"]["claim"].as_str().unwrap().to_string();
    let rev_before_submit = next2["data"]["revision"].as_i64().unwrap();
    assert_ne!(unit2, post_restore_unit);

    // Drop `next_def` and `submit_def` (which hold `Arc<Engine>` via their
    // command handlers) along with `fixture.registry` and `fixture.engine` so
    // the store lock is released before reopening on disk.
    let home = Home::at(fixture.directory.path().join("data"));
    let _dir = fixture.directory;
    drop(next_def);
    drop(submit_def);
    drop(fixture.registry);
    drop(fixture.engine);
    drop(fixture.server);
    drop(fixture.smtp);
    drop(fixture.http);
    {
        let engine2 = Arc::new(Engine::new(Some(home.clone())));
        let registry2 = loam_mail::registry(&engine2).unwrap();
        let ctx = CommandContext::new()
            .with_interface(CommandInterface::Mcp)
            .with_actor(afd::Actor::new(ActorKind::Agent).with_id("tok_a"));
        let sub = run_async(registry2.execute(
            "mail-replyset-submit",
            json!({
                "replyset": set_id,
                "reply": ada_reply,
                "unit": unit2,
                "claim": claim2,
                "text": "Dear Ada, Thursday at 3pm works.",
            }),
            Some(ctx.clone()),
        ));
        let sub_val = serde_json::to_value(&sub).unwrap();
        assert_eq!(sub_val["success"], true, "{sub_val}");
        assert_eq!(
            sub_val["data"],
            json!({
                "reply": {
                    "reply": ada_reply,
                    "source": "submitted",
                    "unit": unit2,
                },
                "revision": rev_before_submit + 1,
            })
        );
        assert!(
            !sub_val.to_string().contains("Thursday at 3pm works"),
            "submit result must never echo text: {sub_val}"
        );
        assert!(
            !sub_val.to_string().contains(&claim2),
            "submit result must never echo claim: {sub_val}"
        );

        // Spent claim fails with UNIT_NOT_OPEN.
        let spent = run_async(registry2.execute(
            "mail-replyset-submit",
            json!({
                "replyset": set_id,
                "reply": ada_reply,
                "unit": unit2,
                "claim": claim2,
                "text": "Replay!",
            }),
            Some(ctx.clone()),
        ));
        assert_eq!(spent.error.unwrap().code, "UNIT_NOT_OPEN");

        // Pull Bea's unit; Ada's claim fails for Bea; person edits Bea -> late submit fails!
        let bea_next = run_async(registry2.execute(
            "mail-replyset-next",
            json!({ "replyset": set_id }),
            Some(ctx.clone()),
        ));
        let bea_data = bea_next.data.unwrap();
        let bea_unit = bea_data["unit"].as_str().unwrap().to_string();
        let bea_claim = bea_data["claim"].as_str().unwrap().to_string();

        let cross_claim = run_async(registry2.execute(
            "mail-replyset-submit",
            json!({
                "replyset": set_id,
                "reply": bea_reply,
                "unit": bea_unit,
                "claim": claim2,
                "text": "Wrong claim!",
            }),
            Some(ctx.clone()),
        ));
        assert_eq!(cross_claim.error.unwrap().code, "UNIT_NOT_OPEN");

        // Person edits Bea directly -> late submit with bea_claim fails with UNIT_NOT_OPEN!
        let person_ctx = CommandContext::new()
            .with_interface(CommandInterface::Cli)
            .with_actor(ActorKind::Human);
        let edited = run_async(registry2.execute(
            "mail-replyset-update",
            json!({
                "replyset": set_id,
                "revision": rev_before_submit + 1,
                "reply": bea_reply,
                "text": "Person wrote Bea's reply.",
            }),
            Some(person_ctx.clone()),
        ));
        assert!(edited.success, "{edited:?}");

        let late = run_async(registry2.execute(
            "mail-replyset-submit",
            json!({
                "replyset": set_id,
                "reply": bea_reply,
                "unit": bea_unit,
                "claim": bea_claim,
                "text": "Late composer overwrite.",
            }),
            Some(ctx),
        ));
        assert_eq!(late.error.unwrap().code, "UNIT_NOT_OPEN");

        // Show confirms recorded inputs, instructionsVersion, and counts.
        let shown = run_async(registry2.execute(
            "mail-replyset-show",
            json!({ "replyset": set_id }),
            Some(person_ctx),
        ));
        let shown_data = shown.data.unwrap();
        let r0 = &shown_data["replyset"]["replies"][0];
        assert_eq!(r0["unit"], unit2);
        assert_eq!(r0["source"], "submitted");
        assert_eq!(r0["submissions"], 1);
        assert_eq!(r0["edits"], 0);
        assert_eq!(r0["inputs"]["message"], ada_msg);
        assert_eq!(r0["inputs"]["instructionsVersion"], INSTRUCTIONS_VERSION);
        assert_eq!(
            r0["inputs"]["sourceTextDigest"],
            next2["data"]["inputs"]["sourceTextDigest"]
        );

        // Verify journal never contains claim2 or raw_key_hex.
        let journal_final = std::fs::read_to_string(home.root().join("journal.jsonl")).unwrap();
        assert!(!journal_final.contains(&claim2));
        assert!(!journal_final.contains(&raw_key_hex));
    }

    // 9. Migration 24 upgrade from schema v23 preserves rows and initializes claim key.
    {
        let conn = rusqlite::Connection::open(home.database()).unwrap();
        conn.execute_batch(
            "DROP TABLE replyset_claim_key;
             ALTER TABLE replyset_event DROP COLUMN instructions_version;
             ALTER TABLE replyset_reply DROP COLUMN known_source_digest;
             ALTER TABLE replyset_reply DROP COLUMN instructions_version;
             PRAGMA user_version = 23;",
        )
        .unwrap();
    }
    let upgraded = Store::open(&home).unwrap();
    assert!(upgraded.schema_version().unwrap() >= 24);
    let new_key = upgraded.replyset_claim_key().unwrap();
    assert_ne!(new_key, [0u8; 32]);
}

/// F-T10 + HTTP `/mcp` mirror of Scenario 5 (`compose-replies-apart`):
/// two-sender isolation (neither unit contains any text, address, name,
/// subject, or answer of the other sender) and full Scenario 5 step walk.
#[test]
fn ft10_two_sender_isolation_and_http_mcp_mirror_of_scenario_5() {
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ADA_ONLY_SENTINEL");
    let bea_msg = find_message(&fixture, "BEA_ONLY_SENTINEL");

    let created = fixture.person(
        "mail-replyset-create",
        json!({
            "messages": [ada_msg, bea_msg],
            "questions": [
                {
                    "question": "Does Thursday work?",
                    "messages": [ada_msg],
                    "answer": "Thursday works.",
                },
                {
                    "question": "Can you send the invoice?",
                    "messages": [bea_msg],
                    "answer": "The invoice is attached.",
                },
            ],
        }),
    );
    assert_eq!(created["success"], true, "{created}");
    let set_id = created["data"]["replyset"]["id"].as_i64().unwrap();
    assert_eq!(set_id, 1);

    run_async(async {
        let (_agent_id, agent_secret) = make_token(&fixture.registry, "scenario5", "agent").await;
        let app = router(
            &fixture.registry,
            Arc::clone(&fixture.engine),
            PORT,
            CLI_TOKEN,
        )
        .unwrap();

        // Step 0: mail-replyset-next -> Ada's unit; ZERO leak of Bea.
        let (_, r0) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "afd-call",
                json!({ "command": "mail-replyset-next", "input": { "replyset": 1 } }),
            ),
            "2026-07-28",
        )
        .await;
        let s0 = tool_result(&r0);
        assert_eq!(s0["success"], true, "{s0}");
        assert_eq!(s0["data"]["replyset"], 1);
        assert_eq!(s0["data"]["reply"], 1);
        assert_eq!(s0["data"]["content"]["trust"], "content");
        assert_eq!(
            s0["data"]["content"]["recipient"]["address"],
            "ada@example.com"
        );
        let ada_unit = s0["data"]["unit"].as_str().unwrap().to_string();
        let ada_claim = s0["data"]["claim"].as_str().unwrap().to_string();
        assert!(ada_unit.starts_with("rsu_1_1_"));
        assert_eq!(ada_claim.len(), 43);
        let s0_text = s0.to_string();
        for bea_forbidden in [
            "bea@example.com",
            "Bea Smith",
            "BEA_ONLY_SENTINEL",
            "Invoice question",
            "Can you send the invoice?",
            "The invoice is attached.",
        ] {
            assert!(
                !s0_text.contains(bea_forbidden),
                "F-T10 violation: Ada's unit leaked `{bea_forbidden}`: {s0_text}"
            );
        }

        // Step 1: submit Ada's reply.
        let (_, r1) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "afd-call",
                json!({
                    "command": "mail-replyset-submit",
                    "input": {
                        "replyset": 1,
                        "reply": 1,
                        "unit": ada_unit,
                        "claim": ada_claim,
                        "text": "Dear Ada, Thursday works.",
                    }
                }),
            ),
            "2026-07-28",
        )
        .await;
        let s1 = tool_result(&r1);
        assert_eq!(s1["success"], true, "{s1}");
        assert_eq!(s1["data"]["reply"]["reply"], 1);
        assert_eq!(s1["data"]["reply"]["source"], "submitted");

        // Step 2: same claim cannot be used twice -> UNIT_NOT_OPEN.
        let (_, r2) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "afd-call",
                json!({
                    "command": "mail-replyset-submit",
                    "input": {
                        "replyset": 1,
                        "reply": 1,
                        "unit": ada_unit,
                        "claim": ada_claim,
                        "text": "Dear Ada, Friday works.",
                    }
                }),
            ),
            "2026-07-28",
        )
        .await;
        let s2 = tool_result(&r2);
        assert_eq!(s2["error"]["code"], "UNIT_NOT_OPEN", "{s2}");
        assert!(
            s2["error"]["suggestion"]
                .as_str()
                .unwrap()
                .contains("mail-replyset-next")
        );

        // Step 3: mail-replyset-next -> Bea's unit; ZERO leak of Ada.
        let (_, r3) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "afd-call",
                json!({ "command": "mail-replyset-next", "input": { "replyset": 1 } }),
            ),
            "2026-07-28",
        )
        .await;
        let s3 = tool_result(&r3);
        assert_eq!(s3["success"], true, "{s3}");
        assert_eq!(s3["data"]["reply"], 2);
        assert_eq!(s3["data"]["content"]["trust"], "content");
        assert_eq!(
            s3["data"]["content"]["recipient"]["address"],
            "bea@example.com"
        );
        let bea_unit = s3["data"]["unit"].as_str().unwrap().to_string();
        let bea_claim = s3["data"]["claim"].as_str().unwrap().to_string();
        let s3_text = s3.to_string();
        for ada_forbidden in [
            "ada@example.com",
            "Ada Lovelace",
            "ADA_ONLY_SENTINEL",
            "Does Thursday work",
            "Thursday works.",
            "Dear Ada",
        ] {
            assert!(
                !s3_text.contains(ada_forbidden),
                "F-T10 violation: Bea's unit leaked `{ada_forbidden}`: {s3_text}"
            );
        }

        // Step 4: Ada's claim cannot submit Bea's reply -> UNIT_NOT_OPEN.
        let (_, r4) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "afd-call",
                json!({
                    "command": "mail-replyset-submit",
                    "input": {
                        "replyset": 1,
                        "reply": 2,
                        "unit": bea_unit,
                        "claim": ada_claim,
                        "text": "Dear Bea, Thursday works.",
                    }
                }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&r4)["error"]["code"], "UNIT_NOT_OPEN", "{r4}");

        // Step 5: Bea's reply submitted with her own claim.
        let (_, r5) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "afd-call",
                json!({
                    "command": "mail-replyset-submit",
                    "input": {
                        "replyset": 1,
                        "reply": 2,
                        "unit": bea_unit,
                        "claim": bea_claim,
                        "text": "Dear Bea, the invoice is attached.",
                    }
                }),
            ),
            "2026-07-28",
        )
        .await;
        let s5 = tool_result(&r5);
        assert_eq!(s5["success"], true, "{s5}");
        assert_eq!(s5["data"]["reply"]["reply"], 2);
        assert_eq!(s5["data"]["reply"]["source"], "submitted");

        // Step 6: mail-replyset-show shows both submitted replies with inputs.
        let (_, r6) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "afd-call",
                json!({ "command": "mail-replyset-show", "input": { "replyset": 1 } }),
            ),
            "2026-07-28",
        )
        .await;
        let s6 = tool_result(&r6);
        assert_eq!(s6["success"], true, "{s6}");
        let replies = &s6["data"]["replyset"]["replies"];
        assert_eq!(replies[0]["reply"], 1);
        assert_eq!(replies[0]["source"], "submitted");
        assert_eq!(replies[0]["unit"], ada_unit);
        assert_eq!(replies[0]["content"]["text"], "Dear Ada, Thursday works.");
        assert_eq!(replies[1]["reply"], 2);
        assert_eq!(replies[1]["source"], "submitted");
        assert_eq!(
            replies[1]["content"]["text"],
            "Dear Bea, the invoice is attached."
        );
        let rev = s6["data"]["replyset"]["revision"].as_i64().unwrap();

        // Step 7: mail-replyset-show with revision 999 -> PREVIEW_CHANGED.
        let (_, r7) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "afd-call",
                json!({ "command": "mail-replyset-show", "input": { "replyset": 1, "revision": 999 } }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&r7)["error"]["code"], "PREVIEW_CHANGED", "{r7}");

        // Step 8: mail-replyset-send at revision shown -> APPROVAL_REQUIRED (no token).
        let (_, r8) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "afd-call",
                json!({ "command": "mail-replyset-send", "input": { "replyset": 1, "revision": rev } }),
            ),
            "2026-07-28",
        )
        .await;
        let s8 = tool_result(&r8);
        assert_eq!(s8["error"]["code"], "APPROVAL_REQUIRED", "{s8}");
        assert!(s8["error"]["details"].get("approvalToken").is_none());
        assert_eq!(fixture.smtp.world().received.len(), 0);
    });
}

/// Regression (Blocker 1): Migration 24 must NOT strand an existing near-limit
/// v23 reply set by adding `"instructionsVersion": null` to legacy rows.
#[test]
fn f3_migration_24_preserves_near_limit_v23_replyset_preview() {
    let fixture = Fixture::new(|w| {
        w.mailbox("INBOX", &[]);
        w.mailbox("Sent Messages", &["\\Sent"]);
        for i in 1..=50u32 {
            w.add(
                "INBOX",
                format!(
                    "From: Legacy {i} <legacy{i}@example.org>\r\n\
                     To: person@example.com\r\n\
                     Message-ID: <v23-{i}@example.org>\r\n\
                     Subject: Legacy item {i}\r\n\
                     Content-Type: text/plain\r\n\r\n\
                     Body {i}\r\n"
                )
                .into_bytes(),
                &[],
            );
        }
    });
    let mut msg_ids = Vec::with_capacity(50);
    for i in 1..=50 {
        msg_ids.push(find_message(&fixture, &format!("Body {i}")));
    }
    let created = fixture.person("mail-replyset-create", json!({ "messages": msg_ids }));
    assert_eq!(created["success"], true, "{created}");
    let set_id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let reply_ids: Vec<i64> = created["data"]["replyset"]["replies"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["reply"].as_i64().unwrap())
        .collect();

    // Fill all 50 replies via `mail-replyset-update` (legacy `edited` rows with
    // `instructions_version = NULL`) using JSON-escaped text so the set hits the
    // 3.5 MiB MCP preview cap mid-way, then pack the boundary reply tightly so
    // adding 50x `,"instructionsVersion":null` WOULD overflow `MAX_PREVIEW_MCP_BYTES`.
    let mut rev = 1i64;
    let chunk = "\"\\".repeat(12_000); // 24,000 chars -> ~144 KB MCP wire each
    let mut boundary_rid = *reply_ids.last().unwrap();
    let mut hit_cap = false;
    for &rid in &reply_ids {
        if !hit_cap {
            let upd = fixture.person(
                "mail-replyset-update",
                json!({
                    "replyset": set_id,
                    "revision": rev,
                    "reply": rid,
                    "text": chunk,
                }),
            );
            if upd["success"] == true {
                rev = upd["data"]["replyset"]["revision"].as_i64().unwrap();
                continue;
            }
            assert_eq!(upd["error"]["code"], "PREVIEW_TOO_LARGE", "{upd}");
            hit_cap = true;
            boundary_rid = rid;
        }
        let small = fixture.person(
            "mail-replyset-update",
            json!({
                "replyset": set_id,
                "revision": rev,
                "reply": rid,
                "text": "ok",
            }),
        );
        assert_eq!(small["success"], true, "{small}");
        rev = small["data"]["replyset"]["revision"].as_i64().unwrap();
    }
    assert!(hit_cap, "expected 50-reply fixture to reach preview cap");

    // Pack the boundary reply right up to the ceiling using binary search.
    let mut lo = 1usize;
    let mut hi = 12_000usize;
    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2);
        let probe = fixture.person(
            "mail-replyset-update",
            json!({
                "replyset": set_id,
                "revision": rev,
                "reply": boundary_rid,
                "text": "\"\\".repeat(mid),
            }),
        );
        if probe["success"] == true {
            rev = probe["data"]["replyset"]["revision"].as_i64().unwrap();
            lo = mid;
        } else {
            assert_eq!(probe["error"]["code"], "PREVIEW_TOO_LARGE", "{probe}");
            hi = mid - 1;
        }
    }

    // Rewind database schema to v23, then reopen under v24.
    let home = Home::at(fixture.directory.path().join("data"));
    let _dir = fixture.directory;
    drop(fixture.registry);
    drop(fixture.engine);
    drop(fixture.server);
    drop(fixture.smtp);
    drop(fixture.http);
    {
        let conn = rusqlite::Connection::open(home.database()).unwrap();
        conn.execute_batch(
            "DROP TABLE replyset_claim_key;
             ALTER TABLE replyset_event DROP COLUMN instructions_version;
             ALTER TABLE replyset_reply DROP COLUMN known_source_digest;
             ALTER TABLE replyset_reply DROP COLUMN instructions_version;
             PRAGMA user_version = 23;",
        )
        .unwrap();
    }

    let engine2 = Arc::new(Engine::new(Some(home)));
    let registry2 = loam_mail::registry(&engine2).unwrap();
    let person_ctx = CommandContext::new()
        .with_interface(CommandInterface::Cli)
        .with_actor(ActorKind::Human);
    let shown = run_async(registry2.execute(
        "mail-replyset-show",
        json!({ "replyset": set_id }),
        Some(person_ctx),
    ));
    let shown_val = serde_json::to_value(&shown).unwrap();
    assert_eq!(shown_val["success"], true, "{shown_val}");
    // Legacy rows omit `instructionsVersion` rather than emitting `null`, AND
    // confirm this fixture sits close enough to the cap that injecting 50 null
    // fields WOULD cross `MAX_PREVIEW_MCP_BYTES` or `MOST_BUDGET`.
    let mut inflated = shown_val["data"].clone();
    for reply in shown_val["data"]["replyset"]["replies"].as_array().unwrap() {
        assert!(
            reply["inputs"].get("instructionsVersion").is_none(),
            "legacy reply must omit instructionsVersion: {reply}"
        );
    }
    for reply in inflated["replyset"]["replies"].as_array_mut().unwrap() {
        reply["inputs"]["instructionsVersion"] = Value::Null;
    }
    let inflated_mcp =
        loam_mail::reply_size(&afd::success(inflated.clone()), Some(CommandInterface::Mcp));
    let inflated_json = serde_json::to_string(&afd::success(inflated))
        .unwrap()
        .len();
    assert!(
        inflated_mcp > MAX_PREVIEW_MCP_BYTES || inflated_json + 64 > 1_835_008,
        "fixture must sit within 50 null fields of a preview cap (inflated_mcp={inflated_mcp}, inflated_json={inflated_json})"
    );
    // Pre-approval send check must also accept the upgraded set (not PREVIEW_TOO_LARGE).
    assert!(
        loam_mail::replysets::pre_approval_check(
            &engine2,
            &json!({ "replyset": set_id, "revision": rev }),
        )
        .is_none(),
        "upgraded v23 reply set must pass mail-replyset-send pre-approval check"
    );
}

/// Regression (Blocker 2): An unrelated edit that widens `detail.set.revision`
/// (e.g. 9 -> 10) must NOT change the budget-fitted source window or invalidate
/// an open reply's claim.
#[test]
fn f3_unrelated_revision_width_bump_keeps_open_claim_valid() {
    // 32,768 chars of quotes/backslashes expand to > 65 KiB in JSON, forcing
    // `canonical_unit_for_reply` to binary-search right against `OPEN_BUDGET`
    // (not merely hit `UNIT_TEXT_LIMIT`).
    let long_body = format!("LONG_REV_SENTINEL {}", "\"\\".repeat(16_384));
    let fixture = Fixture::new(move |w| {
        w.mailbox("INBOX", &[]);
        w.mailbox("Sent Messages", &["\\Sent"]);
        w.add(
            "INBOX",
            format!(
                "From: Ada Lovelace <ada@example.com>\r\n\
                 To: person@example.com\r\n\
                 Message-ID: <long-rev@example.com>\r\n\
                 Subject: Long message\r\n\
                 Content-Type: text/plain\r\n\r\n\
                 {long_body}\r\n"
            )
            .into_bytes(),
            &[],
        );
    });
    let msg_id = find_message(&fixture, "LONG_REV_SENTINEL");
    let created = fixture.person("mail-replyset-create", json!({ "messages": [msg_id] }));
    assert_eq!(created["success"], true, "{created}");
    let set_id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let reply_id = created["data"]["replyset"]["replies"][0]["reply"]
        .as_i64()
        .unwrap();

    // Advance revision to 9 via unrelated `sharedText` edits.
    let mut rev = 1i64;
    while rev < 9 {
        let upd = fixture.person(
            "mail-replyset-update",
            json!({
                "replyset": set_id,
                "revision": rev,
                "sharedText": format!("shared draft {rev}"),
            }),
        );
        assert_eq!(upd["success"], true, "{upd}");
        rev = upd["data"]["replyset"]["revision"].as_i64().unwrap();
    }
    assert_eq!(rev, 9);

    let next = fixture.agent("tok_a", "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(next["success"], true, "{next}");
    assert_eq!(
        next["data"]["textComplete"], false,
        "expected budget-truncated unit"
    );
    assert!(
        next["data"]["content"]["message"]["text"]
            .as_str()
            .unwrap()
            .chars()
            .count()
            < 32_768,
        "expected truncation by OPEN_BUDGET, not UNIT_TEXT_LIMIT"
    );
    let unit = next["data"]["unit"].as_str().unwrap().to_string();
    let claim = next["data"]["claim"].as_str().unwrap().to_string();

    // Bump revision from 9 -> 10 (extra decimal digit) via unrelated sharedText edit.
    let bump = fixture.person(
        "mail-replyset-update",
        json!({
            "replyset": set_id,
            "revision": 9,
            "sharedText": "shared draft 10",
        }),
    );
    assert_eq!(bump["data"]["replyset"]["revision"], 10, "{bump}");

    // Previously issued claim MUST still submit cleanly!
    let sub = fixture.agent(
        "tok_a",
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": reply_id,
            "unit": unit,
            "claim": claim,
            "text": "Reply composed from truncated unit.",
        }),
    );
    assert_eq!(
        sub["success"], true,
        "claim broke across 9->10 revision bump: {sub}"
    );
}

/// Regression (Blocker 3): `mail-replyset-next` must allow Loam (which passes
/// no output-budget override) to fetch a valid unit whose linked answers push
/// it into `MOST_BUDGET`, while still refusing an explicit smaller budget.
#[test]
fn f3_next_fetches_most_budget_fallback_unit_without_budget_override() {
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ADA_ONLY_SENTINEL");
    let big_answer = "A".repeat(4_096);
    let questions: Vec<Value> = (0..16)
        .map(|i| {
            json!({
                "question": format!("Detailed question {i}?"),
                "messages": [ada_msg],
                "answer": big_answer,
            })
        })
        .collect();
    let created = fixture.person(
        "mail-replyset-create",
        json!({
            "messages": [ada_msg],
            "questions": questions,
        }),
    );
    assert_eq!(created["success"], true, "{created}");
    let set_id = created["data"]["replyset"]["id"].as_i64().unwrap();
    let reply_id = created["data"]["replyset"]["replies"][0]["reply"]
        .as_i64()
        .unwrap();

    // Default MCP call with NO output-budget override (as Loam calls it) succeeds!
    let next = fixture.agent("tok_a", "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(next["success"], true, "{next}");
    assert!(
        serde_json::to_string(&next["data"]).unwrap().len() > 65_536,
        "expected fallback unit larger than OPEN_BUDGET"
    );
    let unit = next["data"]["unit"].as_str().unwrap().to_string();
    let claim = next["data"]["claim"].as_str().unwrap().to_string();

    // Explicit smaller caller budget is still refused with OUTPUT_BUDGET_EXCEEDED.
    let small = fixture.execute(
        "mail-replyset-next",
        json!({ "replyset": set_id }),
        CommandContext::new()
            .with_interface(CommandInterface::Mcp)
            .with_actor(afd::Actor::new(ActorKind::Agent).with_id("tok_a"))
            .with_output_budget_ask(65_536),
    );
    assert_eq!(small["error"]["code"], "OUTPUT_BUDGET_EXCEEDED", "{small}");

    // Submitting the fetched fallback unit succeeds cleanly.
    let sub = fixture.agent(
        "tok_a",
        "mail-replyset-submit",
        json!({
            "replyset": set_id,
            "reply": reply_id,
            "unit": unit,
            "claim": claim,
            "text": "Reply using all 16 answers.",
        }),
    );
    assert_eq!(sub["success"], true, "{sub}");
}

/// Regression (Blocker 5): `mail-replyset-next` must NEVER write to SQLite
/// (including `refetch`) when the source message's blob is missing or damaged.
#[test]
fn f3_next_damaged_body_writes_no_refetch_row() {
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ADA_ONLY_SENTINEL");
    let created = fixture.person("mail-replyset-create", json!({ "messages": [ada_msg] }));
    assert_eq!(created["success"], true, "{created}");
    let set_id = created["data"]["replyset"]["id"].as_i64().unwrap();

    // Remove the whole-message blob file on disk to simulate a missing/damaged body.
    let blobs_dir = fixture.directory.path().join("data").join("blobs");
    let mut removed = 0usize;
    for shard in std::fs::read_dir(&blobs_dir).unwrap() {
        let shard = shard.unwrap().path();
        if shard.is_dir() {
            for entry in std::fs::read_dir(&shard).unwrap() {
                let path = entry.unwrap().path();
                if path.is_file() {
                    std::fs::remove_file(&path).unwrap();
                    removed += 1;
                }
            }
        }
    }
    assert!(removed > 0, "expected blob files to delete");

    let before_refetch: i64 = {
        let conn =
            rusqlite::Connection::open(fixture.directory.path().join("data").join("mail.sqlite3"))
                .unwrap();
        conn.query_row("SELECT count(*) FROM refetch", [], |r| r.get(0))
            .unwrap()
    };
    assert_eq!(before_refetch, 0);

    let next = fixture.agent("tok_a", "mail-replyset-next", json!({ "replyset": set_id }));
    assert_eq!(next["error"]["code"], "STORE_FAILED", "{next}");

    let after_refetch: i64 = {
        let conn =
            rusqlite::Connection::open(fixture.directory.path().join("data").join("mail.sqlite3"))
                .unwrap();
        conn.query_row("SELECT count(*) FROM refetch", [], |r| r.get(0))
            .unwrap()
    };
    assert_eq!(
        after_refetch, 0,
        "mail-replyset-next must not enqueue refetch rows on a damaged body"
    );

    // Multipart (held-in-parts) damage-and-repair regression (Blocker 4/5):
    // when a held text part's blob is missing, `mail-replyset-next` must fail
    // closed with `STORE_FAILED` (zero `refetch` rows, NEVER assembling partial
    // degraded text under the open unit id); after restoring the blob, `next`
    // and `submit` succeed cleanly.
    let mp_fixture = Fixture::new(|w| {
        w.mailbox("INBOX", &[]);
        w.mailbox("Sent Messages", &["\\Sent"]);
        // Message > 1 MiB so IMAP sync holds it in parts (structure + text part).
        let big_attachment = "Q".repeat(1_100_000);
        let raw = format!(
            "From: Clara Oswald <clara@example.com>\r\n\
             To: person@example.com\r\n\
             Message-ID: <multipart-damage@example.com>\r\n\
             Subject: Multipart check\r\n\
             MIME-Version: 1.0\r\n\
             Content-Type: multipart/mixed; boundary=\"bnd\"\r\n\r\n\
             --bnd\r\n\
             Content-Type: text/plain; charset=utf-8\r\n\r\n\
             MULTIPART_TEXT_SENTINEL Please confirm Friday.\r\n\
             --bnd\r\n\
             Content-Type: application/octet-stream; name=\"big.bin\"\r\n\
             Content-Disposition: attachment; filename=\"big.bin\"\r\n\r\n\
             {big_attachment}\r\n\
             --bnd--\r\n"
        );
        w.add("INBOX", raw.into_bytes(), &[]);
    });
    let mp_msg = find_message(&mp_fixture, "Multipart check");
    let mp_created = mp_fixture.person("mail-replyset-create", json!({ "messages": [mp_msg] }));
    assert_eq!(mp_created["success"], true, "{mp_created}");
    let mp_set_id = mp_created["data"]["replyset"]["id"].as_i64().unwrap();
    let mp_reply_id = mp_created["data"]["replyset"]["replies"][0]["reply"]
        .as_i64()
        .unwrap();

    // Confirm the message is held in parts (not whole) and locate its held text part blob.
    let db_path = mp_fixture
        .directory
        .path()
        .join("data")
        .join("mail.sqlite3");
    let text_blob_hex: String = {
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        let whole_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM held WHERE message_id = ?1 AND part = 'whole'",
                [mp_msg],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            whole_count, 0,
            "expected >1 MiB message to be held in parts"
        );
        let blob: Vec<u8> = conn
            .query_row(
                "SELECT blob FROM held WHERE message_id = ?1 AND kind = 'text' LIMIT 1",
                [mp_msg],
                |r| r.get(0),
            )
            .unwrap();
        blob.iter().map(|b| format!("{b:02x}")).collect()
    };
    let blob_path = mp_fixture
        .directory
        .path()
        .join("data")
        .join("blobs")
        .join(&text_blob_hex[..2])
        .join(&text_blob_hex);
    let saved_blob = std::fs::read(&blob_path).unwrap();
    std::fs::remove_file(&blob_path).unwrap();

    // Missing text part -> fails closed with STORE_FAILED and 0 refetch rows!
    let mp_damaged = mp_fixture.agent(
        "tok_a",
        "mail-replyset-next",
        json!({ "replyset": mp_set_id }),
    );
    assert_eq!(
        mp_damaged["error"]["code"], "STORE_FAILED",
        "damaged held text part must fail closed, never assemble partial text: {mp_damaged}"
    );
    let mp_refetch: i64 = {
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.query_row("SELECT count(*) FROM refetch", [], |r| r.get(0))
            .unwrap()
    };
    assert_eq!(mp_refetch, 0);

    // Restore blob -> `mail-replyset-next` returns full text and submits cleanly!
    std::fs::write(&blob_path, &saved_blob).unwrap();
    let mp_ok = mp_fixture.agent(
        "tok_a",
        "mail-replyset-next",
        json!({ "replyset": mp_set_id }),
    );
    assert_eq!(mp_ok["success"], true, "{mp_ok}");
    assert!(
        mp_ok["data"]["content"]["message"]["text"]
            .as_str()
            .unwrap()
            .contains("MULTIPART_TEXT_SENTINEL"),
        "{mp_ok}"
    );
    let mp_sub = mp_fixture.agent(
        "tok_a",
        "mail-replyset-submit",
        json!({
            "replyset": mp_set_id,
            "reply": mp_reply_id,
            "unit": mp_ok["data"]["unit"],
            "claim": mp_ok["data"]["claim"],
            "text": "Friday is confirmed.",
        }),
    );
    assert_eq!(mp_sub["success"], true, "{mp_sub}");
}
