//! Step F2b tests: releasing `mail-draft-send` and `mail-unsubscribe` over MCP
//! with preview revision/digest checks, fixed recipient bases (migration 23),
//! `PREVIEW_CHANGED`, `PREVIEW_TOO_LARGE`, approver-released `new` recipients
//! (Q2 (a)), and Scenarios 1, 2 and 4 over HTTP `/mcp` (plugin.spec.md,
//! sections 5–8, 18 and 19: F-T3 to F-T8).

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::sync::Arc;

use afd::{ActorKind, CommandContext, CommandInterface, canonical_json};
use axum::body::Body;
use http_body_util::BodyExt;
use loam_mail::cli::{EXIT_FAILED, EXIT_OK, Local, Runner};
use loam_mail::serve::router;
use serde_json::{Value, json};
use support::imap::{USER, World};
use support::synced::{Fixture, assert_labelled, mail};
use tower::ServiceExt;

const PORT: u16 = 4331;
const CLI_TOKEN: &str = "lmail_cli_f2b_test";
const GOOD_HOST: &str = "127.0.0.1:4331";
const MODERN_META: &str = r#"{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}"#;
const STALE_DIGEST: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const ADA: &str = "Ada Lovelace <ada@example.com>";
const NEWS: &str = "Newsletter <news@lists.example.com>";

const CONTENT_WORDS: &[&str] = &[
    "ada@example.com",
    "brandnew@example.net",
    "friend@example.org",
    "lists.example.com",
    "Thursday works",
    "Bring the invoice",
    "SecretUnsubToken",
];

fn world(world: &mut World) {
    world.mailbox("INBOX", &[]);
    world.mailbox("Sent Messages", &["\\Sent"]);
    world.mailbox("Deleted Messages", &["\\Trash"]);
    world.mailbox("Junk", &["\\Junk"]);
    world.add(
        "INBOX",
        mail(
            ADA,
            "ada-thursday",
            "To: person@example.com\r\nSubject: Thursday\r\n",
        ),
        &[],
    );
    world.add(
        "INBOX",
        mail(
            NEWS,
            "news-41",
            concat!(
                "To: person@example.com\r\n",
                "List-Id: <news.lists.example.com>\r\n",
                "List-Unsubscribe: <https://lists.example.com/u/41?k=SecretUnsubToken>\r\n",
                "List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n",
            ),
        ),
        &[],
    );
    world.add(
        "Sent Messages",
        mail(USER, "sent-friend", "To: friend@example.org\r\n"),
        &["\\Seen"],
    );
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

fn mcp_call_with_approval(name: &str, arguments: Value, approval: &str) -> Value {
    modern_mcp(
        "tools/call",
        json!({
            "name": name,
            "arguments": arguments,
            "_meta": { "dev.afd/approval": approval },
        }),
    )
}

fn run_async<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}

/// F-T3 & F-T5: Non-approver MCP agent gets `APPROVAL_REQUIRED` with
/// `retryable: false`, content-free summary, engine suggestion, and NO
/// `approvalToken` (over HTTP MCP and stdio); `/cli` keeps the token; and
/// `tools/list` exposes `mail-draft-send`, `mail-unsubscribe`, and
/// `mail-operation-approve` while keeping all 8 terminal-only commands hidden.
#[test]
fn ft3_ft5_non_approver_holds_without_token_and_tools_list_matches_m18() {
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ada-thursday");
    let news_msg = find_message(&fixture, "news-41");

    let (draft_id, digest) = run_async(async {
        let (_, agent_secret) = make_token(&fixture.registry, "Agent", "agent").await;
        let app = router(
            &fixture.registry,
            Arc::clone(&fixture.engine),
            PORT,
            CLI_TOKEN,
        )
        .unwrap();

        // F-T5: tools/list and afd-help over HTTP include released commands & previews,
        // and omit all terminal-only commands.
        let (status, listed) = post_mcp(
            &app,
            &agent_secret,
            modern_mcp("tools/list", json!({})),
            "2026-07-28",
        )
        .await;
        assert_eq!(status, 200);
        let listed_str = listed.to_string();
        let (help_status, help) = post_mcp(
            &app,
            &agent_secret,
            mcp_call("afd-help", json!({ "format": "full" })),
            "2026-07-28",
        )
        .await;
        assert_eq!(help_status, 200);
        let help_str = tool_result(&help).to_string();
        for expected in [
            "mail-draft-send",
            "mail-draft-show",
            "mail-unsubscribe",
            "mail-unsubscribe-show",
            "mail-operation-approve",
            "mail-operation-show",
            "mail-replyset-send",
            "mail-replyset-submit",
        ] {
            let quoted = format!("\"{expected}\"");
            assert!(
                listed_str.contains(&quoted),
                "{expected} missing from tools/list: {listed_str}"
            );
            assert!(
                help_str.contains(&quoted),
                "{expected} missing from afd-help: {help_str}"
            );
        }
        for forbidden in [
            "mail-token-create",
            "mail-token-revoke",
            "mail-token-list",
            "mail-policy-set",
            "mail-account-add",
            "mail-account-remove",
            "mail-sender-screen",
            "mail-sender-accept",
            "mail-rebuild",
        ] {
            let quoted = format!("\"{forbidden}\"");
            assert!(
                !listed_str.contains(&quoted),
                "{forbidden} must not be listed in tools/list: {listed_str}"
            );
            assert!(
                !help_str.contains(&quoted),
                "{forbidden} must not be listed in afd-help: {help_str}"
            );
        }

        // Create a draft replying to Ada.
        let (_, created) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "mail-draft-create",
                json!({
                    "answers": ada_msg,
                    "to": ["ada@example.com"],
                    "subject": "Re: Thursday",
                    "body": "Thursday works for me.",
                }),
            ),
            "2026-07-28",
        )
        .await;
        let draft_id = tool_result(&created)["data"]["draft"].as_i64().unwrap();

        // Read unsubscribe preview digest.
        let (_, unsub_preview) = post_mcp(
            &app,
            &agent_secret,
            mcp_call("mail-unsubscribe-show", json!({ "message": news_msg })),
            "2026-07-28",
        )
        .await;
        let digest = tool_result(&unsub_preview)["data"]["unsubscribe"]["digest"]
            .as_str()
            .unwrap()
            .to_string();

        // F-T3 over HTTP MCP and `/cli`: both released commands return APPROVAL_REQUIRED,
        // retryable: false, content-free summary, engine suggestion, NO approvalToken over MCP,
        // token present on `/cli`.
        for (cmd, input) in [
            (
                "mail-draft-send",
                json!({ "draft": draft_id, "revision": 1 }),
            ),
            (
                "mail-unsubscribe",
                json!({ "message": news_msg, "digest": digest }),
            ),
        ] {
            let (status, resp) = post_mcp(
                &app,
                &agent_secret,
                mcp_call(cmd, input.clone()),
                "2026-07-28",
            )
            .await;
            assert_eq!(status, 200, "{cmd}: {resp}");
            let res = tool_result(&resp);
            assert_eq!(res["success"], false, "{cmd}: {res}");
            assert_eq!(res["error"]["code"], "APPROVAL_REQUIRED", "{cmd}: {res}");
            assert_eq!(res["error"]["retryable"], false, "{cmd}: {res}");
            assert!(
                res["error"]["details"].get("approvalToken").is_none(),
                "{cmd} leaked approvalToken to non-approver: {res}"
            );
            assert!(
                res["error"]["details"]["summary"].as_str().is_some(),
                "{cmd} missing summary: {res}"
            );
            let suggestion = res["error"]["suggestion"].as_str().unwrap_or_default();
            assert!(suggestion.contains("terminal"), "{cmd}: {res}");
            assert!(suggestion.contains(cmd), "{cmd}: {res}");
            assert_labelled(res, CONTENT_WORDS);

            // Over `/cli` route: token IS present for the terminal to retry.
            let (cli_status, cli_resp) = post_cli(&app, cmd, input).await;
            assert_eq!(cli_status, 200, "{cmd}: {cli_resp}");
            assert_eq!(
                cli_resp["error"]["code"], "APPROVAL_REQUIRED",
                "{cmd}: {cli_resp}"
            );
            assert!(
                cli_resp["error"]["details"]["approvalToken"]
                    .as_str()
                    .is_some(),
                "{cmd} missing approvalToken on /cli: {cli_resp}"
            );
        }
        (draft_id, digest)
    });

    // Over stdio (MCP interface, no actor id): also stripped.
    for (cmd, input) in [
        (
            "mail-draft-send",
            json!({ "draft": draft_id, "revision": 1 }),
        ),
        (
            "mail-unsubscribe",
            json!({ "message": news_msg, "digest": digest }),
        ),
    ] {
        let stdio = fixture.execute(
            cmd,
            input,
            CommandContext::new().with_interface(CommandInterface::Mcp),
        );
        assert_eq!(
            stdio["error"]["code"], "APPROVAL_REQUIRED",
            "{cmd}: {stdio}"
        );
        assert_eq!(stdio["error"]["retryable"], false, "{cmd}: {stdio}");
        assert!(
            stdio["error"]["details"].get("approvalToken").is_none(),
            "{cmd} leaked approvalToken over stdio: {stdio}"
        );
    }

    assert!(fixture.smtp.received().is_empty());
    assert!(fixture.http.received().is_empty());
}

/// Mirrors Loam shell's `valuesIn` counter (`mounted-approvals.ts`, Phase 5 §7.2):
/// counts every JSON value including containers.
fn json_value_count(value: &Value) -> usize {
    let mut count = 0;
    let mut stack = vec![value];
    while let Some(item) = stack.pop() {
        count += 1;
        match item {
            Value::Array(items) => stack.extend(items.iter()),
            Value::Object(map) => stack.extend(map.values()),
            _ => {}
        }
    }
    count
}

/// Runs the full F-T4 refusal matrix against one released command (`mail-draft-send`
/// or `mail-unsubscribe`) using `token` issued to `approver1_secret`.
#[allow(clippy::too_many_arguments)]
async fn assert_ft4_refusal_matrix(
    app: &axum::Router,
    cmd: &str,
    input: &Value,
    token: &str,
    agent_secret: &str,
    approver1_secret: &str,
    approver2_secret: &str,
    smtp: &support::smtp::SmtpServer,
    http: &support::http::HttpServer,
    expected_smtp: usize,
    expected_http: usize,
) {
    // 1. Legacy MCP 2025-06-18 carrying _meta["dev.afd/approval"] -> APPROVAL_REQUIRED.
    let (_, legacy) = post_mcp(
        app,
        approver1_secret,
        legacy_mcp(
            "tools/call",
            json!({
                "name": cmd,
                "arguments": input.clone(),
                "_meta": { "dev.afd/approval": token },
            }),
        ),
        "2025-06-18",
    )
    .await;
    assert_eq!(
        tool_result(&legacy)["error"]["code"],
        "APPROVAL_REQUIRED",
        "{cmd} legacy: {legacy}"
    );
    assert_eq!(smtp.received().len(), expected_smtp);
    assert_eq!(http.received().len(), expected_http);

    // 2. Non-approver agent passing approver's token in _meta -> APPROVAL_REQUIRED, no token.
    let (_, agent_try) = post_mcp(
        app,
        agent_secret,
        mcp_call_with_approval(cmd, input.clone(), token),
        "2026-07-28",
    )
    .await;
    assert_eq!(
        tool_result(&agent_try)["error"]["code"],
        "APPROVAL_REQUIRED",
        "{cmd} agent _meta: {agent_try}"
    );
    assert!(
        tool_result(&agent_try)["error"]["details"]
            .get("approvalToken")
            .is_none(),
        "{cmd} leaked token to agent: {agent_try}"
    );
    assert_eq!(smtp.received().len(), expected_smtp);
    assert_eq!(http.received().len(), expected_http);

    // 3. Non-approver calling `afd-batch` with released command -> refused up front
    // (`ONE_COMMAND_PER_CALL`), no `approvalToken`, zero side effects.
    let (_, agent_batch) = post_mcp(
        app,
        agent_secret,
        mcp_call(
            "afd-batch",
            json!({ "commands": [{ "command": cmd, "input": input.clone() }] }),
        ),
        "2026-07-28",
    )
    .await;
    assert_eq!(
        tool_result(&agent_batch)["error"]["code"],
        "ONE_COMMAND_PER_CALL",
        "{cmd} agent batch: {agent_batch}"
    );
    assert!(
        !agent_batch.to_string().contains("approvalToken"),
        "{cmd} leaked token in agent batch: {agent_batch}"
    );
    assert_eq!(smtp.received().len(), expected_smtp);
    assert_eq!(http.received().len(), expected_http);

    // 4. Another approver presenting approver 1's token -> APPROVAL_REQUIRED.
    let (_, other_approver) = post_mcp(
        app,
        approver2_secret,
        mcp_call_with_approval(cmd, input.clone(), token),
        "2026-07-28",
    )
    .await;
    assert_eq!(
        tool_result(&other_approver)["error"]["code"],
        "APPROVAL_REQUIRED",
        "{cmd} other approver: {other_approver}"
    );
    assert_eq!(smtp.received().len(), expected_smtp);
    assert_eq!(http.received().len(), expected_http);

    // 5. Approver calling `afd-batch` and `afd-pipe` carrying approval -> refused
    // (`APPROVAL_REQUIRED` by approver carrier or `ONE_COMMAND_PER_CALL` by server),
    // no `approvalToken`, zero side effects.
    for meta_tool in ["afd-batch", "afd-pipe"] {
        let args = if meta_tool == "afd-batch" {
            json!({ "commands": [{ "command": cmd, "input": input.clone() }] })
        } else {
            json!({ "steps": [{ "command": cmd, "input": input.clone() }] })
        };
        let (_, resp) = post_mcp(
            app,
            approver1_secret,
            mcp_call_with_approval(meta_tool, args, token),
            "2026-07-28",
        )
        .await;
        let code = tool_result(&resp)["error"]["code"].as_str().unwrap_or("");
        assert!(
            matches!(code, "APPROVAL_REQUIRED" | "ONE_COMMAND_PER_CALL"),
            "{cmd} {meta_tool}: {resp}"
        );
        assert!(
            !resp.to_string().contains("approvalToken"),
            "{cmd} {meta_tool} leaked approvalToken: {resp}"
        );
        assert_eq!(smtp.received().len(), expected_smtp);
        assert_eq!(http.received().len(), expected_http);
    }

    // 6. Passing `dev.afd/approval` inside tool arguments -> VALIDATION_ERROR.
    let mut poisoned = input.clone();
    poisoned
        .as_object_mut()
        .unwrap()
        .insert("dev.afd/approval".to_string(), json!(token));
    let (_, in_args) = post_mcp(app, approver1_secret, mcp_call(cmd, poisoned), "2026-07-28").await;
    assert_eq!(
        tool_result(&in_args)["error"]["code"],
        "VALIDATION_ERROR",
        "{cmd} in_args: {in_args}"
    );
    assert_eq!(smtp.received().len(), expected_smtp);
    assert_eq!(http.received().len(), expected_http);
}

/// F-T4: Approver release over MCP 2026-07-28 runs once for both
/// `mail-draft-send` and `mail-unsubscribe`; replay (including single-use on an
/// open draft), cross-approver reuse, MCP 2025-06-18, `afd-batch`, `afd-pipe`,
/// non-approver `_meta` and batch holds, approval key in tool arguments, and
/// revoked approver tokens are all refused for BOTH commands.
#[test]
fn ft4_approver_release_enforces_single_use_actor_protocol_and_revocation() {
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ada-thursday");
    let news_msg = find_message(&fixture, "news-41");

    run_async(async {
        let (_, agent_secret) = make_token(&fixture.registry, "Agent", "agent").await;
        let (_, approver1_secret) = make_token(&fixture.registry, "Loam1", "approver").await;
        let (approver2_id, approver2_secret) =
            make_token(&fixture.registry, "Loam2", "approver").await;
        let app = router(
            &fixture.registry,
            Arc::clone(&fixture.engine),
            PORT,
            CLI_TOKEN,
        )
        .unwrap();

        // Draft replying to Ada.
        let (_, created) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "mail-draft-create",
                json!({
                    "answers": ada_msg,
                    "to": ["ada@example.com"],
                    "subject": "Re: Thursday",
                    "body": "Thursday works for me.",
                }),
            ),
            "2026-07-28",
        )
        .await;
        let draft_id = tool_result(&created)["data"]["draft"].as_i64().unwrap();
        let send_input = json!({ "draft": draft_id, "revision": 1 });

        // Approver 1 gets an approvalToken on hold for `mail-draft-send`.
        let (_, held) = post_mcp(
            &app,
            &approver1_secret,
            mcp_call("mail-draft-send", send_input.clone()),
            "2026-07-28",
        )
        .await;
        let held_res = tool_result(&held);
        assert_eq!(held_res["error"]["code"], "APPROVAL_REQUIRED", "{held}");
        let token = held_res["error"]["details"]["approvalToken"]
            .as_str()
            .unwrap()
            .to_string();

        // Full refusal matrix for `mail-draft-send`.
        assert_ft4_refusal_matrix(
            &app,
            "mail-draft-send",
            &send_input,
            &token,
            &agent_secret,
            &approver1_secret,
            &approver2_secret,
            &fixture.smtp,
            &fixture.http,
            0,
            0,
        )
        .await;

        // Prove single-use directly on an open draft: fault SMTP before handover so
        // the draft stays `open` at revision 1, then replay the spent token -> APPROVAL_REQUIRED.
        fixture.smtp.world().fault = Some(support::smtp::SmtpFault::RefuseMailFrom(452));
        let (_, faulted) = post_mcp(
            &app,
            &approver1_secret,
            mcp_call_with_approval("mail-draft-send", send_input.clone(), &token),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&faulted)["error"]["code"],
            "PROVIDER_LIMIT",
            "{faulted}"
        );
        fixture.smtp.world().fault = None;
        let (_, spent_replay) = post_mcp(
            &app,
            &approver1_secret,
            mcp_call_with_approval("mail-draft-send", send_input.clone(), &token),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&spent_replay)["error"]["code"],
            "APPROVAL_REQUIRED",
            "replaying spent draft token must fail APPROVAL_REQUIRED: {spent_replay}"
        );
        assert!(fixture.smtp.received().is_empty());

        // Fresh approval token succeeds ONCE; replay after send is refused too.
        let (_, held2) = post_mcp(
            &app,
            &approver1_secret,
            mcp_call("mail-draft-send", send_input.clone()),
            "2026-07-28",
        )
        .await;
        let token2 = tool_result(&held2)["error"]["details"]["approvalToken"]
            .as_str()
            .unwrap()
            .to_string();
        let (_, sent) = post_mcp(
            &app,
            &approver1_secret,
            mcp_call_with_approval("mail-draft-send", send_input.clone(), &token2),
            "2026-07-28",
        )
        .await;
        let sent_res = tool_result(&sent);
        assert_eq!(sent_res["success"], true, "{sent}");
        assert_eq!(sent_res["data"]["state"], "sent");
        assert_eq!(fixture.smtp.received().len(), 1);
        assert_eq!(fixture.smtp.received()[0].to, vec!["ada@example.com"]);

        let (_, replay_after_sent) = post_mcp(
            &app,
            &approver1_secret,
            mcp_call_with_approval("mail-draft-send", send_input, &token2),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&replay_after_sent)["error"]["code"],
            "INVALID_INPUT",
            "{replay_after_sent}"
        );
        assert_eq!(fixture.smtp.received().len(), 1);

        // Now run the FULL F-T4 refusal matrix + revocation + single-use replay for `mail-unsubscribe`.
        let (_, unsub_show) = post_mcp(
            &app,
            &approver1_secret,
            mcp_call("mail-unsubscribe-show", json!({ "message": news_msg })),
            "2026-07-28",
        )
        .await;
        let digest = tool_result(&unsub_show)["data"]["unsubscribe"]["digest"]
            .as_str()
            .unwrap()
            .to_string();
        let unsub_input = json!({ "message": news_msg, "digest": digest });

        let (_, held_unsub) = post_mcp(
            &app,
            &approver1_secret,
            mcp_call("mail-unsubscribe", unsub_input.clone()),
            "2026-07-28",
        )
        .await;
        let unsub_tok = tool_result(&held_unsub)["error"]["details"]["approvalToken"]
            .as_str()
            .unwrap()
            .to_string();

        // Full refusal matrix for `mail-unsubscribe` (zero HTTP requests throughout).
        assert_ft4_refusal_matrix(
            &app,
            "mail-unsubscribe",
            &unsub_input,
            &unsub_tok,
            &agent_secret,
            &approver1_secret,
            &approver2_secret,
            &fixture.smtp,
            &fixture.http,
            1,
            0,
        )
        .await;

        // Approver 2 holds a token, gets revoked, and cannot redeem it (401).
        let (_, held_revoked) = post_mcp(
            &app,
            &approver2_secret,
            mcp_call("mail-unsubscribe", unsub_input.clone()),
            "2026-07-28",
        )
        .await;
        let revoked_tok = tool_result(&held_revoked)["error"]["details"]["approvalToken"]
            .as_str()
            .unwrap()
            .to_string();
        let revoked = approved_local(
            &fixture.registry,
            "mail-token-revoke",
            json!({ "token": approver2_id }),
        )
        .await;
        assert!(revoked.success, "{revoked:?}");
        let (revoked_status, _) = post_mcp(
            &app,
            &approver2_secret,
            mcp_call_with_approval("mail-unsubscribe", unsub_input.clone(), &revoked_tok),
            "2026-07-28",
        )
        .await;
        assert_eq!(revoked_status, 401);
        assert!(fixture.http.received().is_empty());

        // Approver 1 redeems `mail-unsubscribe` ONCE; replay fails APPROVAL_REQUIRED.
        let (_, unsubbed) = post_mcp(
            &app,
            &approver1_secret,
            mcp_call_with_approval("mail-unsubscribe", unsub_input.clone(), &unsub_tok),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&unsubbed)["success"], true, "{unsubbed}");
        assert_eq!(tool_result(&unsubbed)["data"]["method"], "one-click");
        assert_eq!(tool_result(&unsubbed)["data"]["state"], "sent");
        assert_eq!(fixture.http.received().len(), 1);

        let (_, unsub_replay) = post_mcp(
            &app,
            &approver1_secret,
            mcp_call_with_approval("mail-unsubscribe", unsub_input, &unsub_tok),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&unsub_replay)["error"]["code"],
            "APPROVAL_REQUIRED",
            "{unsub_replay}"
        );
        assert_eq!(fixture.http.received().len(), 1);
    });
}

/// F-T6: Previews are whole, labelled, stable in canonical JSON across reads
/// (including fixed recipient bases when mailboxes/sent history later change),
/// default to `MOST_BUDGET`, fail with `PREVIEW_TOO_LARGE` when over budget,
/// serve worst-case max drafts whole over HTTP within 3.5 MiB / 4 MiB, and
/// `mail-unsubscribe-show` never contacts the network.
#[test]
fn ft6_previews_are_whole_stable_sized_and_never_contact_network() {
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ada-thursday");
    let news_msg = find_message(&fixture, "news-41");

    let worst_id = run_async(async {
        let (_, agent_secret) = make_token(&fixture.registry, "Agent", "agent").await;
        let app = router(
            &fixture.registry,
            Arc::clone(&fixture.engine),
            PORT,
            CLI_TOKEN,
        )
        .unwrap();

        // 1. Draft preview stability + fixed recipient basis (migration 23).
        let (_, created) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "mail-draft-create",
                json!({
                    "answers": ada_msg,
                    "to": ["ada@example.com", "brandnew@example.net"],
                    "subject": "Re: Thursday",
                    "body": "Thursday works for me.",
                }),
            ),
            "2026-07-28",
        )
        .await;
        let draft_id = tool_result(&created)["data"]["draft"].as_i64().unwrap();

        let (_, show1) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "mail-draft-show",
                json!({ "draft": draft_id, "revision": 1 }),
            ),
            "2026-07-28",
        )
        .await;
        let (_, show2) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "mail-draft-show",
                json!({ "draft": draft_id, "revision": 1 }),
            ),
            "2026-07-28",
        )
        .await;
        let d1 = &tool_result(&show1)["data"];
        let d2 = &tool_result(&show2)["data"];
        let d1_canon = canonical_json(d1).unwrap();
        assert_eq!(d1_canon, canonical_json(d2).unwrap());
        assert_eq!(d1["recipientBasis"]["to"], json!(["thread", "new"]));
        assert_labelled(tool_result(&show1), CONTENT_WORDS);
        // Ordinary draft preview fits inside Loam's shell confirmation ceiling
        // (64 KiB canonical JSON, 200 values in `mounted-approvals.ts`).
        assert!(d1_canon.len() <= 64 * 1024, "len={}", d1_canon.len());
        assert!(
            json_value_count(d1) <= 200,
            "values={}",
            json_value_count(d1)
        );

        // Mutate sender history behind the draft's back: `brandnew@example.net`
        // becomes `written = 1`. Because bases are stored at creation, `mail-draft-show`
        // at revision 1 remains identical in canonical JSON.
        fixture
            .engine
            .with_store(|store| {
                let path = fixture.directory.path().join("data").join("mail.sqlite3");
                let conn = rusqlite::Connection::open(path).unwrap();
                conn.execute(
                    "INSERT INTO sender (address, id, domain, name, messages, bulk, written, answered, recent)
                     VALUES ('brandnew@example.net', 9999, 'example.net', 'Brand New', 0, 0, 1, 0, 100)
                     ON CONFLICT(address) DO UPDATE SET written = 1",
                    [],
                )
                .unwrap();
                let _ = store.schema_version()?;
                Ok(())
            })
            .unwrap();
        let (_, show3) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "mail-draft-show",
                json!({ "draft": draft_id, "revision": 1 }),
            ),
            "2026-07-28",
        )
        .await;
        let d3 = &tool_result(&show3)["data"];
        assert_eq!(canonical_json(d1).unwrap(), canonical_json(d3).unwrap());
        assert_eq!(d3["recipientBasis"]["to"], json!(["thread", "new"]));

        // 2. Worst-case maximum draft (48 KiB quotes/backslashes/control chars,
        // 100 recipients, 998-char subject) builds and renders whole over HTTP
        // within 3.5 MiB reply_size and 4 MiB wire cap.
        let hundred: Vec<String> = (0..100).map(|i| format!("r{i:03}@example.org")).collect();
        let worst_body = "\x01\"\\".repeat((48 * 1024) / 3);
        let worst_subject = "\"\\".repeat(998 / 2);
        let (_, worst_created) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "mail-draft-create",
                json!({
                    "to": hundred,
                    "subject": worst_subject,
                    "body": worst_body,
                }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&worst_created)["success"],
            true,
            "{worst_created}"
        );
        let worst_id = tool_result(&worst_created)["data"]["draft"]
            .as_i64()
            .unwrap();
        let (worst_status, worst_shown) = post_mcp(
            &app,
            &agent_secret,
            mcp_call("mail-draft-show", json!({ "draft": worst_id })),
            "2026-07-28",
        )
        .await;
        assert_eq!(worst_status, 200);
        assert_eq!(tool_result(&worst_shown)["success"], true);
        assert_eq!(
            tool_result(&worst_shown)["data"]["content"]["body"],
            worst_body
        );
        let wire_bytes = serde_json::to_string(&worst_shown).unwrap().len();
        assert!(wire_bytes < 4 * 1024 * 1024, "wire_bytes={wire_bytes}");

        // 101st recipient is refused.
        let hundred_one: Vec<String> = (0..101).map(|i| format!("r{i:03}@example.org")).collect();
        let (_, too_many) = post_mcp(
            &app,
            &agent_secret,
            mcp_call("mail-draft-create", json!({ "to": hundred_one })),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&too_many)["success"], false);

        // 4. Unsubscribe preview stability and zero network traffic.
        let (_, u1) = post_mcp(
            &app,
            &agent_secret,
            mcp_call("mail-unsubscribe-show", json!({ "message": news_msg })),
            "2026-07-28",
        )
        .await;
        let (_, u2) = post_mcp(
            &app,
            &agent_secret,
            mcp_call("mail-unsubscribe-show", json!({ "message": news_msg })),
            "2026-07-28",
        )
        .await;
        let u1_canon = canonical_json(&tool_result(&u1)["data"]).unwrap();
        assert_eq!(u1_canon, canonical_json(&tool_result(&u2)["data"]).unwrap());
        assert!(u1_canon.len() <= 64 * 1024, "len={}", u1_canon.len());
        assert!(
            json_value_count(&tool_result(&u1)["data"]) <= 200,
            "values={}",
            json_value_count(&tool_result(&u1)["data"])
        );
        assert!(fixture.http.received().is_empty());

        worst_id
    });

    // 3. Tight output budget on `mail-draft-show` and `mail-unsubscribe-show`
    // returns `PREVIEW_TOO_LARGE` (never `OUTPUT_BUDGET_EXCEEDED`).
    let tight_draft = fixture.execute(
        "mail-draft-show",
        json!({ "draft": worst_id }),
        CommandContext::new()
            .with_interface(CommandInterface::Mcp)
            .with_output_budget_ask(128),
    );
    assert_eq!(
        tight_draft["error"]["code"], "PREVIEW_TOO_LARGE",
        "{tight_draft}"
    );
    assert_eq!(tight_draft["error"]["retryable"], false);

    let tight_unsub = fixture.execute(
        "mail-unsubscribe-show",
        json!({ "message": news_msg }),
        CommandContext::new()
            .with_interface(CommandInterface::Mcp)
            .with_output_budget_ask(64),
    );
    assert_eq!(
        tight_unsub["error"]["code"], "PREVIEW_TOO_LARGE",
        "{tight_unsub}"
    );
    assert_eq!(tight_unsub["error"]["retryable"], false);
}

/// F-T7: Revisions and digests checked at preview, before hold, and in the
/// handler/transaction; changing the draft or re-deriving the unsubscribe
/// target between approver hold and retry fails `PREVIEW_CHANGED` and sends or
/// contacts NOTHING (0 SMTP/HTTP requests, 0 `outbound` rows).
#[test]
fn ft7_revisions_and_digests_refuse_before_hold_and_on_mid_flight_change() {
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ada-thursday");
    let news_msg = find_message(&fixture, "news-41");

    run_async(async {
        let (_, agent_secret) = make_token(&fixture.registry, "Agent", "agent").await;
        let (_, approver_secret) = make_token(&fixture.registry, "Loam", "approver").await;
        let app = router(
            &fixture.registry,
            Arc::clone(&fixture.engine),
            PORT,
            CLI_TOKEN,
        )
        .unwrap();

        // Create draft (rev 1).
        let (_, created) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "mail-draft-create",
                json!({
                    "answers": ada_msg,
                    "to": ["ada@example.com"],
                    "subject": "Re: Thursday",
                    "body": "Thursday works for me.",
                }),
            ),
            "2026-07-28",
        )
        .await;
        let draft_id = tool_result(&created)["data"]["draft"].as_i64().unwrap();

        // Ahead revision (2) on preview and send fails PREVIEW_CHANGED before hold.
        let (_, show_ahead) = post_mcp(
            &app,
            &approver_secret,
            mcp_call(
                "mail-draft-show",
                json!({ "draft": draft_id, "revision": 2 }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&show_ahead)["error"]["code"],
            "PREVIEW_CHANGED",
            "{show_ahead}"
        );
        let (_, send_ahead) = post_mcp(
            &app,
            &approver_secret,
            mcp_call(
                "mail-draft-send",
                json!({ "draft": draft_id, "revision": 2 }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&send_ahead)["error"]["code"],
            "PREVIEW_CHANGED",
            "{send_ahead}"
        );
        assert!(
            tool_result(&send_ahead)["error"]["details"]
                .get("approvalToken")
                .is_none()
        );

        // Malformed `typedRecipients` fails INVALID_INPUT before any approval hold.
        let (_, bad_typed) = post_mcp(
            &app,
            &approver_secret,
            mcp_call(
                "mail-draft-send",
                json!({
                    "draft": draft_id,
                    "revision": 1,
                    "typedRecipients": ["not-an-address"],
                }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&bad_typed)["error"]["code"],
            "INVALID_INPUT",
            "{bad_typed}"
        );
        assert!(
            tool_result(&bad_typed)["error"]["details"]
                .get("approvalToken")
                .is_none()
        );

        // Approver holds draft send at rev 1.
        let (_, held) = post_mcp(
            &app,
            &approver_secret,
            mcp_call(
                "mail-draft-send",
                json!({ "draft": draft_id, "revision": 1 }),
            ),
            "2026-07-28",
        )
        .await;
        let send_tok = tool_result(&held)["error"]["details"]["approvalToken"]
            .as_str()
            .unwrap()
            .to_string();

        // Another token updates the draft to rev 2 BEFORE the approver retries!
        let (_, updated) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "mail-draft-update",
                json!({
                    "draft": draft_id,
                    "revision": 1,
                    "body": "Thursday works. Bring the invoice.",
                }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&updated)["data"]["revision"], 2);

        // Approver retries rev 1 with its valid approval token -> PREVIEW_CHANGED,
        // zero SMTP messages, zero outbound rows!
        let (_, stale_retry) = post_mcp(
            &app,
            &approver_secret,
            mcp_call_with_approval(
                "mail-draft-send",
                json!({ "draft": draft_id, "revision": 1 }),
                &send_tok,
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&stale_retry)["error"]["code"],
            "PREVIEW_CHANGED",
            "{stale_retry}"
        );
        assert!(fixture.smtp.received().is_empty());

        // Unsubscribe: wrong digest refused before hold; target changing between hold
        // and approved retry refuses PREVIEW_CHANGED and sends zero HTTP requests.
        let (_, bad_unsub) = post_mcp(
            &app,
            &approver_secret,
            mcp_call(
                "mail-unsubscribe",
                json!({ "message": news_msg, "digest": STALE_DIGEST }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&bad_unsub)["error"]["code"],
            "PREVIEW_CHANGED",
            "{bad_unsub}"
        );
        assert!(
            tool_result(&bad_unsub)["error"]["details"]
                .get("approvalToken")
                .is_none()
        );

        let (_, unsub_show) = post_mcp(
            &app,
            &approver_secret,
            mcp_call("mail-unsubscribe-show", json!({ "message": news_msg })),
            "2026-07-28",
        )
        .await;
        let digest = tool_result(&unsub_show)["data"]["unsubscribe"]["digest"]
            .as_str()
            .unwrap()
            .to_string();
        let (_, held_unsub) = post_mcp(
            &app,
            &approver_secret,
            mcp_call(
                "mail-unsubscribe",
                json!({ "message": news_msg, "digest": digest }),
            ),
            "2026-07-28",
        )
        .await;
        let unsub_tok = tool_result(&held_unsub)["error"]["details"]["approvalToken"]
            .as_str()
            .unwrap()
            .to_string();

        // Replace the message's held header blob with a different URL to simulate
        // a re-derived / changed target between hold and retry.
        let new_headers = b"From: Newsletter <news@lists.example.com>\r\n\
To: person@example.com\r\n\
Subject: News\r\n\
List-Unsubscribe: <https://lists.example.com/u/999>\r\n\
List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n\r\n";
        let home = loam_mail::home::Home::at(fixture.directory.path().join("data"));
        let log = loam_mail::log::Log::open(home.blobs()).unwrap();
        let new_blob = log.put(new_headers).unwrap();
        let db_path = home.database();
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute(
            "UPDATE held SET blob = ?1, size = ?2 WHERE message_id = ?3 AND part = 'header'",
            rusqlite::params![
                new_blob.as_bytes().as_slice(),
                new_headers.len() as i64,
                news_msg
            ],
        )
        .unwrap();
        drop(conn);

        let (_, stale_unsub) = post_mcp(
            &app,
            &approver_secret,
            mcp_call_with_approval(
                "mail-unsubscribe",
                json!({ "message": news_msg, "digest": digest }),
                &unsub_tok,
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&stale_unsub)["error"]["code"],
            "PREVIEW_CHANGED",
            "{stale_unsub}"
        );
        assert!(fixture.http.received().is_empty());

        let conn = rusqlite::Connection::open(&db_path).unwrap();
        let outbound_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM outbound", [], |r| r.get(0))
            .unwrap();
        assert_eq!(outbound_count, 0);
    });
}

/// F-T8 (Q2 (a)): An approver-released send over MCP allows `new` recipients
/// (marked `"basis": "new"` in `mail-draft-show`), while the exact same draft
/// at the terminal still asks the person to type the address verbatim.
#[test]
fn ft8_new_recipient_allowed_on_approver_send_and_typed_at_terminal() {
    let fixture = Fixture::new(world);

    let (approver_secret, draft_id) = run_async(async {
        let (_, approver_secret) = make_token(&fixture.registry, "Loam", "approver").await;
        let app = router(
            &fixture.registry,
            Arc::clone(&fixture.engine),
            PORT,
            CLI_TOKEN,
        )
        .unwrap();

        // Draft with a `new` recipient (never written to, not in any thread).
        let (_, created) = post_mcp(
            &app,
            &approver_secret,
            mcp_call(
                "mail-draft-create",
                json!({
                    "to": ["brandnew@example.net"],
                    "subject": "Hello new recipient",
                    "body": "Thursday works for me.",
                }),
            ),
            "2026-07-28",
        )
        .await;
        let draft_id = tool_result(&created)["data"]["draft"].as_i64().unwrap();
        let (_, preview) = post_mcp(
            &app,
            &approver_secret,
            mcp_call(
                "mail-draft-show",
                json!({ "draft": draft_id, "revision": 1 }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&preview)["data"]["recipientBasis"]["to"],
            json!(["new"])
        );
        (approver_secret, draft_id)
    });

    // At the terminal, wrong typing aborts and sends nothing.
    let arg = json!({ "draft": draft_id }).to_string();
    let (status, _out, err, _) =
        fixture.terminal_typing(&["mail-draft-send", &arg], true, &["wrong@example.net"]);
    assert_eq!(status, EXIT_FAILED);
    assert!(err.contains("Address did not match"), "{err}");
    assert!(fixture.smtp.received().is_empty());

    // Direct CLI human approval without typedRecipients still refuses RECIPIENT_NOT_ALLOWED.
    let direct_held = fixture.person(
        "mail-draft-send",
        json!({ "draft": draft_id, "revision": 1 }),
    );
    let cli_tok = direct_held["error"]["details"]["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();
    let cli_refused = fixture.execute(
        "mail-draft-send",
        json!({ "draft": draft_id, "revision": 1 }),
        CommandContext::new()
            .with_interface(CommandInterface::Cli)
            .with_actor(ActorKind::Human)
            .with_approval(cli_tok),
    );
    assert_eq!(
        cli_refused["error"]["code"], "RECIPIENT_NOT_ALLOWED",
        "{cli_refused}"
    );
    assert!(fixture.smtp.received().is_empty());

    // Through the approver over MCP 2026-07-28, Q2 (a) allows the `new` recipient.
    run_async(async {
        let app = router(
            &fixture.registry,
            Arc::clone(&fixture.engine),
            PORT,
            CLI_TOKEN,
        )
        .unwrap();
        let send_input = json!({ "draft": draft_id, "revision": 1 });
        let (_, held) = post_mcp(
            &app,
            &approver_secret,
            mcp_call("mail-draft-send", send_input.clone()),
            "2026-07-28",
        )
        .await;
        let tok = tool_result(&held)["error"]["details"]["approvalToken"]
            .as_str()
            .unwrap()
            .to_string();
        let (_, sent) = post_mcp(
            &app,
            &approver_secret,
            mcp_call_with_approval("mail-draft-send", send_input, &tok),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&sent)["success"], true, "{sent}");
        assert_eq!(tool_result(&sent)["data"]["state"], "sent");
        assert_eq!(fixture.smtp.received().len(), 1);
        assert_eq!(fixture.smtp.received()[0].to, vec!["brandnew@example.net"]);
    });

    // A second identical draft sent at the terminal WITH verbatim typing also succeeds.
    let made2 = fixture.person(
        "mail-draft-create",
        json!({
            "to": ["brandnew@example.net"],
            "subject": "Terminal typed",
            "body": "Thursday works for me.",
        }),
    );
    let draft2 = made2["data"]["draft"].as_i64().unwrap();
    let arg2 = json!({ "draft": draft2 }).to_string();
    let (status, out, err, _) =
        fixture.terminal_typing(&["mail-draft-send", &arg2], true, &["brandnew@example.net"]);
    assert_eq!(status, EXIT_OK, "out={out}\nerr={err}");
    assert_eq!(fixture.smtp.received().len(), 2);
}

/// Exercises the exact Scenarios 1, 2, and 4 step sequences against HTTP `/mcp`
/// with an ordinary agent token (mirroring `run-scenarios.mjs` in CI).
#[test]
fn scenarios_1_2_and_4_pass_over_http_mcp_as_ordinary_agent() {
    let fixture = Fixture::new(world);
    let ada_msg = find_message(&fixture, "ada-thursday");
    let news_msg = find_message(&fixture, "news-41");

    run_async(async {
        let (_, agent_secret) = make_token(&fixture.registry, "Agent", "agent").await;
        let app = router(
            &fixture.registry,
            Arc::clone(&fixture.engine),
            PORT,
            CLI_TOKEN,
        )
        .unwrap();

        // Scenario 1: agent-cannot-send
        let (_, s1_0) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "mail-draft-create",
                json!({
                    "answers": ada_msg,
                    "to": ["ada@example.com"],
                    "subject": "Re: Thursday",
                    "body": "Thursday works for me.",
                }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&s1_0)["data"]["revision"], 1);
        let d1 = tool_result(&s1_0)["data"]["draft"].as_i64().unwrap();
        let (_, s1_1) = post_mcp(
            &app,
            &agent_secret,
            mcp_call("mail-draft-send", json!({ "draft": d1, "revision": 1 })),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&s1_1)["error"]["code"], "APPROVAL_REQUIRED");
        assert!(
            tool_result(&s1_1)["error"]["suggestion"]
                .as_str()
                .unwrap()
                .contains("terminal")
        );
        let (_, s1_2) = post_mcp(
            &app,
            &agent_secret,
            mcp_call("mail-draft-show", json!({ "draft": d1 })),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&s1_2)["data"]["state"], "open");
        assert_eq!(tool_result(&s1_2)["data"]["revision"], 1);
        assert_eq!(tool_result(&s1_2)["data"]["account"], 1);
        assert_eq!(
            tool_result(&s1_2)["data"]["recipientBasis"]["to"],
            json!(["thread"])
        );
        assert_eq!(
            tool_result(&s1_2)["data"]["content"]["trust"],
            json!("content")
        );
        assert_eq!(
            tool_result(&s1_2)["data"]["content"]["to"],
            json!(["ada@example.com"])
        );
        assert_eq!(
            tool_result(&s1_2)["data"]["content"]["body"],
            "Thursday works for me."
        );
        let (_, s1_3) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "afd-call",
                json!({
                    "command": "mail-token-create",
                    "input": { "name": "Helper", "role": "approver" },
                }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&s1_3)["error"]["code"], "COMMAND_NOT_FOUND");

        // Scenario 2: send-what-i-saw
        let (_, s2_upd) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "mail-draft-update",
                json!({
                    "draft": d1,
                    "revision": 1,
                    "body": "Thursday works. Bring the invoice.",
                }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&s2_upd)["data"]["revision"], 2);
        let (_, s2_show_stale) = post_mcp(
            &app,
            &agent_secret,
            mcp_call("mail-draft-show", json!({ "draft": d1, "revision": 1 })),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&s2_show_stale)["error"]["code"],
            "PREVIEW_CHANGED"
        );
        let (_, s2_send_stale) = post_mcp(
            &app,
            &agent_secret,
            mcp_call("mail-draft-send", json!({ "draft": d1, "revision": 1 })),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&s2_send_stale)["error"]["code"],
            "PREVIEW_CHANGED"
        );
        let (_, s2_send_ahead) = post_mcp(
            &app,
            &agent_secret,
            mcp_call("mail-draft-send", json!({ "draft": d1, "revision": 3 })),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&s2_send_ahead)["error"]["code"],
            "PREVIEW_CHANGED"
        );
        let (_, s2_send_ok) = post_mcp(
            &app,
            &agent_secret,
            mcp_call("mail-draft-send", json!({ "draft": d1, "revision": 2 })),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&s2_send_ok)["error"]["code"],
            "APPROVAL_REQUIRED"
        );

        // Scenario 4: unsubscribe-target-shown
        let (_, s4_0) = post_mcp(
            &app,
            &agent_secret,
            mcp_call("mail-unsubscribe-show", json!({ "message": news_msg })),
            "2026-07-28",
        )
        .await;
        let digest = tool_result(&s4_0)["data"]["unsubscribe"]["digest"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(digest.len(), 43);
        let (_, s4_1) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "mail-unsubscribe-show",
                json!({ "message": news_msg, "digest": STALE_DIGEST }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&s4_1)["error"]["code"], "PREVIEW_CHANGED");
        let (_, s4_2) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "mail-unsubscribe",
                json!({ "message": news_msg, "digest": STALE_DIGEST }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&s4_2)["error"]["code"], "PREVIEW_CHANGED");
        let (_, s4_3) = post_mcp(
            &app,
            &agent_secret,
            mcp_call(
                "mail-unsubscribe",
                json!({ "message": news_msg, "digest": digest }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&s4_3)["error"]["code"], "APPROVAL_REQUIRED");
        let (_, s4_4) = post_mcp(
            &app,
            &agent_secret,
            mcp_call("mail-unsubscribe", json!({ "message": news_msg })),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&s4_4)["error"]["code"], "VALIDATION_ERROR");

        assert!(fixture.smtp.received().is_empty());
        assert!(fixture.http.received().is_empty());
    });
}
