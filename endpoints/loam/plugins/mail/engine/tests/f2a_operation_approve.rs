//! Step F2a tests: releasing `mail-operation-approve` over MCP with proposal
//! generations, stable preview-only `mail-operation-show`, preview digests,
//! `PREVIEW_CHANGED`, `PREVIEW_TOO_LARGE`, atomic transactional approval,
//! CLI digest auto-fill, and scenario 3 (`approve-what-was-proposed`) over HTTP
//! `/mcp` (plugin.spec.md, sections 5–8, 18 and 19: F-T3 to F-T8).

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::sync::Arc;

use afd::{ActorKind, CommandContext, CommandInterface};
use axum::body::Body;
use http_body_util::BodyExt;
use loam_mail::cli::{EXIT_FAILED, EXIT_OK, Local, Runner};
use loam_mail::home::Home;
use loam_mail::operate::ChangeOptions;
use loam_mail::serve::router;
use loam_mail::store::{ApprovalRefusal, OperationState, Policy, Store, StoreError};
use serde_json::{Value, json};
use support::imap::World;
use support::synced::{Fixture, mail};
use tower::ServiceExt;

const PORT: u16 = 4329;
const CLI_TOKEN: &str = "lmail_cli_f2a_test";
const GOOD_HOST: &str = "127.0.0.1:4329";
const MODERN_META: &str = r#"{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}"#;
const STALE_DIGEST: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const NEWS: &str = "News <news@example.net>";
const STRANGER: &str = "Stranger <stranger@example.biz>";

const NOTHING_ALONE: Policy = Policy {
    change_per_call: 0,
    trash_per_call: 0,
    trash_per_day: 0,
    ask_above: 200,
};

fn base_world(world: &mut World) {
    world.mailbox("INBOX", &[]);
    world.mailbox("Archive", &["\\Archive"]);
    world.mailbox("Deleted Messages", &["\\Trash"]);
    for n in 0..4 {
        world.add(
            "INBOX",
            mail(NEWS, &format!("n{n}"), "List-Id: <news.example.net>\r\n"),
            &[],
        );
    }
    for n in 0..2 {
        world.add("INBOX", mail(STRANGER, &format!("s{n}"), ""), &[]);
    }
}

fn scenario3_world(world: &mut World) {
    world.mailbox("INBOX", &[]);
    world.mailbox("Archive", &["\\Archive"]);
    world.mailbox("Deleted Messages", &["\\Trash"]);
    world.mailbox("Notifications", &[]);
    for n in 1..=120u32 {
        world.add(
            "Notifications",
            mail(
                "Alerts <alerts@notifications.example.org>",
                &format!("notif{n}"),
                "List-Id: <alerts.notifications.example.org>\r\n",
            ),
            &[],
        );
    }
}

fn set_policy(fixture: &Fixture, policy: Policy) {
    fixture
        .engine
        .with_store(|store| store.set_policy(&policy, 1).map(|_| ()))
        .unwrap();
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

fn tool_result(response: &Value) -> &Value {
    &response["result"]["structuredContent"]
}

fn changed_at_provider(fixture: &Fixture) -> bool {
    fixture.server.take_log().iter().any(|line| {
        [
            "UID COPY",
            "UID MOVE",
            "UID STORE",
            "UID EXPUNGE",
            "EXPUNGE",
        ]
        .iter()
        .any(|command| line.starts_with(command))
    })
}

/// Migration 20 adds `operation.proposal_generation` and backfills every
/// existing proposal to generation 1 while leaving non-proposals at 0.
#[test]
fn migration_20_adds_proposal_generation_and_backfills_existing_proposals() {
    let dir = tempfile::tempdir().unwrap();
    let home = Home::at(dir.path().join("data"));
    {
        let store = Store::open(&home).unwrap();
        assert!(store.schema_version().unwrap() >= 20);
    }
    // Rewind to schema version 19, insert a direct operation (not proposed) and
    // a proposed operation, then reopen to verify forward migration 20.
    {
        let conn = rusqlite::Connection::open(home.database()).unwrap();
        conn.execute_batch(
            "DROP TABLE instance_proof_key;
             DROP TABLE replyset_claim_key;
             ALTER TABLE replyset_event DROP COLUMN instructions_version;
             ALTER TABLE replyset_reply DROP COLUMN known_source_digest;
             ALTER TABLE replyset_reply DROP COLUMN instructions_version;
             ALTER TABLE draft DROP COLUMN recipient_bases;
             DROP TABLE proposed_story_member;
             DROP TABLE proposed_story;
             DROP TABLE account_policy;
             ALTER TABLE operation DROP COLUMN proposal_generation;
             INSERT INTO operation (id, command, action, kind, asked, creator_kind,
                                    state, created_at, ended_at, messages, started_at, charged)
                 VALUES (1, 'mail-archive', 'move', 'change', '{}', 'human',
                         'done', 100, 110, 2, 100, 1);
             INSERT INTO operation (id, command, action, kind, asked, creator_kind, creator_id,
                                    state, created_at, messages, started_at, charged,
                                    proposer_kind, proposer_id, proposed_at, expires_at)
                 VALUES (2, 'mail-trash', 'move', 'trash', '{}', 'agent', 'tok_a',
                         'proposed', 200, 10, NULL, 0,
                         'agent', 'tok_a', 200, 9999999999999);
             PRAGMA user_version = 19;",
        )
        .unwrap();
    }
    let store = Store::open(&home).unwrap();
    assert!(store.schema_version().unwrap() >= 20);
    let direct = store.operation(1).unwrap().unwrap();
    assert!(direct.proposal.is_none());
    let proposed = store.operation(2).unwrap().unwrap();
    assert_eq!(proposed.proposal.unwrap().generation, 1);
}

/// F-T5: Real engine registry keeps the eight terminal-only commands and
/// `mail-rebuild` off MCP, lists `mail-operation-approve` over HTTP `tools/list`
/// and `afd-help`, and passes `rules::check`.
#[test]
fn ft5_real_registry_and_http_exposure() {
    let fixture = Fixture::new(base_world);
    assert_eq!(
        loam_mail::rules::check(&fixture.registry),
        Vec::<String>::new()
    );
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let (_agent_id, agent_secret) = make_token(&fixture.registry, "claude", "agent").await;
        let app = router(
            &fixture.registry,
            Arc::clone(&fixture.engine),
            PORT,
            CLI_TOKEN,
        )
        .unwrap();

        let (status, listed) = post_mcp(
            &app,
            &agent_secret,
            modern_mcp("tools/list", json!({})),
            "2026-07-28",
        )
        .await;
        assert_eq!(status, 200);
        let listed_str = listed.to_string();
        assert!(listed_str.contains("\"mail-operation-approve\""));
        for cli_only in [
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
            assert!(
                !listed_str.contains(&format!("\"{cli_only}\"")),
                "{cli_only} must stay CLI-only"
            );
        }

        // `afd-help` lists `mail-operation-approve` and none of the CLI-only ones.
        let (status, help) = post_mcp(
            &app,
            &agent_secret,
            modern_mcp(
                "tools/call",
                json!({ "name": "afd-help", "arguments": { "format": "full" } }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(status, 200);
        let help_str = tool_result(&help).to_string();
        assert!(help_str.contains("\"mail-operation-approve\""));
        assert!(!help_str.contains("\"mail-token-create\""));
        assert!(!help_str.contains("\"mail-policy-set\""));
        assert!(!help_str.contains("\"mail-rebuild\""));
    });
}

/// F-T6: `mail-operation-show` preview-only shape, canonical JSON stability,
/// `MOST_BUDGET` default == max on both forms, and `PREVIEW_TOO_LARGE` refusal.
#[test]
fn ft6_operation_show_preview_only_stability_budget_and_too_large() {
    let fixture = Fixture::new(base_world);
    set_policy(&fixture, NOTHING_ALONE);

    // Output budget declared with default == max == MOST_BUDGET (1.75 MiB).
    let show_def = fixture
        .registry
        .list()
        .into_iter()
        .find(|cmd| cmd.name == "mail-operation-show")
        .expect("mail-operation-show registered");
    assert_eq!(
        show_def.output_budget,
        Some(afd::OutputBudget::new(1792 * 1024, 1792 * 1024))
    );

    let sel = fixture.agent("a", "mail-selection-create", json!({ "text": "Words" }));
    let selection = sel["data"]["selection"].as_i64().unwrap();
    let count = sel["data"]["count"].as_i64().unwrap();
    let proposed = fixture.agent(
        "a",
        "mail-trash",
        json!({ "selection": selection, "expectedCount": count }),
    );
    let id = proposed["data"]["operation"].as_i64().unwrap();

    // Normal form returns items + preview with proposal generation and 43-char digest.
    let full = fixture.person("mail-operation-show", json!({ "operation": id }));
    assert_eq!(full["success"], true, "{full}");
    let digest = full["data"]["preview"]["digest"]
        .as_str()
        .expect("digest present")
        .to_string();
    assert_eq!(digest.len(), 43, "43-char base64url digest: {digest}");
    assert!(
        digest
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    );
    assert_eq!(full["data"]["preview"]["proposal"], 1);
    assert_eq!(full["data"]["proposal"]["generation"], 1);
    assert!(full["data"]["items"].is_array());

    // Preview-only form (with matching digest) omits items, nextCursor, and refused.
    let p1 = fixture.person(
        "mail-operation-show",
        json!({ "operation": id, "digest": digest }),
    );
    let p2 = fixture.person(
        "mail-operation-show",
        json!({ "operation": id, "digest": digest }),
    );
    assert_eq!(p1["success"], true, "{p1}");
    assert_eq!(p2["success"], true, "{p2}");
    let d1 = &p1["data"];
    assert_eq!(d1["operation"], id);
    assert_eq!(d1["command"], "mail-trash");
    assert!(d1["asked"].is_object());
    assert_eq!(d1["query"]["trust"], "content");
    assert!(d1["proposal"]["proposer"].is_object());
    assert_eq!(d1["proposal"]["generation"], 1);
    assert_eq!(d1["preview"]["approvable"], true);
    assert_eq!(d1["preview"]["proposal"], 1);
    assert_eq!(d1["preview"]["digest"], digest);
    assert!(d1.get("items").is_none(), "preview-only must omit items");
    assert!(
        d1.get("nextCursor").is_none(),
        "preview-only must omit nextCursor"
    );
    assert!(
        d1["preview"].get("refused").is_none(),
        "preview-only must omit preview.refused"
    );

    // Two reads of an unchanged proposal are equal in canonical JSON.
    let c1 = afd::input_digest(d1).unwrap();
    let c2 = afd::input_digest(&p2["data"]).unwrap();
    assert_eq!(c1, c2, "repeated preview reads must be byte-stable");

    // Exceeding the call's output budget on a proposal preview returns
    // PREVIEW_TOO_LARGE, never OUTPUT_BUDGET_EXCEEDED.
    let tiny_ctx = CommandContext::new()
        .with_interface(CommandInterface::Mcp)
        .with_actor(ActorKind::Agent)
        .with_output_budget_ask(128);
    let too_big = fixture.execute(
        "mail-operation-show",
        json!({ "operation": id, "digest": digest }),
        tiny_ctx.clone(),
    );
    assert_eq!(too_big["success"], false, "{too_big}");
    assert_eq!(too_big["error"]["code"], "PREVIEW_TOO_LARGE", "{too_big}");
    assert_eq!(too_big["error"]["retryable"], false);

    // Same in normal form for an open proposal.
    let too_big_normal =
        fixture.execute("mail-operation-show", json!({ "operation": id }), tiny_ctx);
    assert_eq!(too_big_normal["success"], false, "{too_big_normal}");
    assert_eq!(
        too_big_normal["error"]["code"], "PREVIEW_TOO_LARGE",
        "{too_big_normal}"
    );
}

/// F-T7: Digest mismatches fail before hold, generation increments on dismiss +
/// re-propose resume (by same and different proposer) and invalidates prior
/// approval tokens without touching the provider, `SCREENING_NOT_READY` is
/// ordered before `PREVIEW_CHANGED`, and CLI auto-fills omitted digests while
/// refusing explicit stale digests without asking.
#[test]
fn ft7_digests_generations_ordering_and_cli_autofill() {
    let fixture = Fixture::with_changes(
        |w| {
            base_world(w);
            w.moves = true;
        },
        ChangeOptions {
            batch: 2,
            ..ChangeOptions::default()
        },
    );

    // Create a stopped operation by dropping after the first MOVE batch.
    let ids: Vec<i64> = ["n0", "n1", "n2", "n3", "s0", "s1"]
        .iter()
        .map(|w| {
            let found = fixture.person("mail-search", json!({ "query": w }));
            found["data"]["hits"][0]["message"].as_i64().unwrap()
        })
        .collect();
    fixture.server.world().drop_after_doing = Some("MOVE".to_string());
    let first = fixture.person("mail-trash", json!({ "messages": ids }));
    assert_eq!(first["error"]["code"], "PROVIDER_UNAVAILABLE", "{first}");
    let id = first["error"]["details"]["operation"].as_i64().unwrap();

    set_policy(&fixture, NOTHING_ALONE);
    // Agent "a" proposes resume -> generation 1.
    let r1 = fixture.agent("a", "mail-operation-resume", json!({ "operation": id }));
    assert_eq!(r1["data"]["state"], "proposed", "{r1}");
    assert_eq!(r1["data"]["proposal"]["generation"], 1, "{r1}");
    let show1 = fixture.person("mail-operation-show", json!({ "operation": id }));
    let digest1 = show1["data"]["preview"]["digest"]
        .as_str()
        .unwrap()
        .to_string();

    // Wrong digest on preview -> PREVIEW_CHANGED.
    let bad_preview = fixture.person(
        "mail-operation-show",
        json!({ "operation": id, "digest": STALE_DIGEST }),
    );
    assert_eq!(bad_preview["error"]["code"], "PREVIEW_CHANGED");
    assert_eq!(bad_preview["error"]["retryable"], false);

    // Wrong digest on approve -> PREVIEW_CHANGED before any hold (no token).
    let bad_approve = fixture.person(
        "mail-operation-approve",
        json!({ "operation": id, "digest": STALE_DIGEST }),
    );
    assert_eq!(bad_approve["error"]["code"], "PREVIEW_CHANGED");
    assert!(bad_approve["error"].get("details").is_none());
    assert!(
        bad_approve["error"]["suggestion"]
            .as_str()
            .unwrap()
            .contains("mail-operation-show")
    );

    // Missing digest on approve -> VALIDATION_ERROR before any hold.
    let missing_digest = fixture.person("mail-operation-approve", json!({ "operation": id }));
    assert_eq!(missing_digest["error"]["code"], "VALIDATION_ERROR");

    // Take an approval token for generation 1.
    let held1 = fixture.person(
        "mail-operation-approve",
        json!({ "operation": id, "digest": digest1 }),
    );
    assert_eq!(held1["error"]["code"], "APPROVAL_REQUIRED", "{held1}");
    let token1 = held1["error"]["details"]["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();

    // Dismiss and re-propose by the SAME proposer "a" -> generation rises to 2,
    // digest changes, and retrying with token1 + digest1 fails with PREVIEW_CHANGED
    // without touching the provider.
    fixture.server.take_log();
    let dis = fixture.agent("a", "mail-operation-dismiss", json!({ "operation": id }));
    assert_eq!(dis["data"]["state"], "stopped", "{dis}");
    let r2 = fixture.agent("a", "mail-operation-resume", json!({ "operation": id }));
    assert_eq!(r2["data"]["state"], "proposed", "{r2}");
    assert_eq!(r2["data"]["proposal"]["generation"], 2, "{r2}");
    let show2 = fixture.person("mail-operation-show", json!({ "operation": id }));
    let digest2 = show2["data"]["preview"]["digest"]
        .as_str()
        .unwrap()
        .to_string();
    assert_ne!(digest1, digest2);

    let stale_retry = fixture.execute(
        "mail-operation-approve",
        json!({ "operation": id, "digest": digest1 }),
        CommandContext::new()
            .with_interface(CommandInterface::Cli)
            .with_actor(ActorKind::Human)
            .with_approval(token1),
    );
    assert_eq!(
        stale_retry["error"]["code"], "PREVIEW_CHANGED",
        "{stale_retry}"
    );
    assert!(
        !changed_at_provider(&fixture),
        "stale token must not touch provider"
    );
    assert_eq!(
        fixture.person("mail-operation-show", json!({ "operation": id }))["data"]["state"],
        "proposed"
    );

    // Take an approval token for generation 2, then dismiss and re-propose by a
    // DIFFERENT proposer "b" -> generation rises to 3, token2 fails with PREVIEW_CHANGED.
    let held2 = fixture.person(
        "mail-operation-approve",
        json!({ "operation": id, "digest": digest2 }),
    );
    let token2 = held2["error"]["details"]["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();
    fixture.person("mail-operation-dismiss", json!({ "operation": id }));
    let r3 = fixture.agent("b", "mail-operation-resume", json!({ "operation": id }));
    assert_eq!(r3["data"]["proposal"]["generation"], 3, "{r3}");
    let show3 = fixture.person("mail-operation-show", json!({ "operation": id }));
    let digest3 = show3["data"]["preview"]["digest"]
        .as_str()
        .unwrap()
        .to_string();
    assert_ne!(digest2, digest3);

    let stale_retry2 = fixture.execute(
        "mail-operation-approve",
        json!({ "operation": id, "digest": digest2 }),
        CommandContext::new()
            .with_interface(CommandInterface::Cli)
            .with_actor(ActorKind::Human)
            .with_approval(token2),
    );
    assert_eq!(stale_retry2["error"]["code"], "PREVIEW_CHANGED");
    assert!(!changed_at_provider(&fixture));

    // Order check: while a rebuild is under way (screening not ready), even a
    // wrong digest fails with SCREENING_NOT_READY before PREVIEW_CHANGED.
    fixture
        .engine
        .with_store(|store| store.rebuild_begin())
        .unwrap();
    let unready = fixture.person(
        "mail-operation-approve",
        json!({ "operation": id, "digest": STALE_DIGEST }),
    );
    assert_eq!(unready["error"]["code"], "SCREENING_NOT_READY", "{unready}");
    let unready_preview = fixture.person(
        "mail-operation-show",
        json!({ "operation": id, "digest": STALE_DIGEST }),
    );
    assert_eq!(
        unready_preview["error"]["code"], "SCREENING_NOT_READY",
        "{unready_preview}"
    );
    // Finish rebuild so screening is ready again.
    fixture
        .engine
        .with_store(|store| store.rebuild(1, |_| {}).map(|_| ()))
        .unwrap();

    // CLI missing operation with omitted digest returns PROPOSAL_NOT_OPEN without asking.
    let missing_cli_arg = json!({ "operation": 999999 }).to_string();
    let (status, out, _err, asked) =
        fixture.terminal(&["mail-operation-approve", &missing_cli_arg], true);
    assert_eq!(status, EXIT_FAILED);
    assert!(out.contains("PROPOSAL_NOT_OPEN"), "{out}");
    assert!(
        asked.is_empty(),
        "missing operation must not prompt the person"
    );

    // CLI explicit stale digest fails with PREVIEW_CHANGED without asking.
    let stale_cli_arg = json!({ "operation": id, "digest": STALE_DIGEST }).to_string();
    let (status, out, _err, asked) =
        fixture.terminal(&["mail-operation-approve", &stale_cli_arg], true);
    assert_eq!(status, EXIT_FAILED);
    assert!(out.contains("PREVIEW_CHANGED"), "{out}");
    assert!(asked.is_empty(), "stale digest must not prompt the person");

    // CLI omitting digest auto-fills from the preview and runs on "yes".
    let autofill_arg = json!({ "operation": id }).to_string();
    let (status, out, err, asked) =
        fixture.terminal(&["mail-operation-approve", &autofill_arg], true);
    assert_eq!(status, EXIT_OK, "{out}{err}");
    assert_eq!(asked.len(), 1);
    let done = fixture.person("mail-operation-show", json!({ "operation": id }));
    assert_eq!(done["data"]["state"], "done", "{done}");
}

/// F-T3, F-T4, F-T8 on real `mail-operation-approve` over HTTP `/mcp`:
/// - Non-approver gets `APPROVAL_REQUIRED` with no `approvalToken`, `retryable: false`,
///   content-free summary, engine suggestion; its `_meta` is ignored.
/// - Approver gets `approvalToken`, releases once on MCP 2026-07-28, runs past
///   policy limits without charging caller's day; replay, cross-approver,
///   2025-era, `afd-batch`, `afd-pipe`, and key-in-args are all refused.
/// - Approver's own trash within limit runs and charges its day; above limit
///   becomes a proposal.
#[test]
fn ft3_ft4_ft8_real_operation_approve_over_http_mcp() {
    let fixture = Fixture::new(base_world);
    set_policy(&fixture, NOTHING_ALONE);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let (app, approver1_secret, op_id) = runtime.block_on(async {
        let (_agent_id, agent_secret) = make_token(&fixture.registry, "claude", "agent").await;
        let (_app1_id, approver1_secret) = make_token(&fixture.registry, "Loam", "approver").await;
        let (_app2_id, approver2_secret) =
            make_token(&fixture.registry, "Loam-2", "approver").await;
        let app = router(
            &fixture.registry,
            Arc::clone(&fixture.engine),
            PORT,
            CLI_TOKEN,
        )
        .unwrap();

        // Agent selects all 6 messages and proposes trash (limit = 0 -> proposal).
        let (_, sel_res) = post_mcp(
            &app,
            &agent_secret,
            modern_mcp(
                "tools/call",
                json!({ "name": "mail-selection-create", "arguments": { "text": "Words" } }),
            ),
            "2026-07-28",
        )
        .await;
        let selection = tool_result(&sel_res)["data"]["selection"].as_i64().unwrap();
        let (_, trash_res) = post_mcp(
            &app,
            &agent_secret,
            modern_mcp(
                "tools/call",
                json!({ "name": "mail-trash", "arguments": { "selection": selection, "expectedCount": 6 } }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&trash_res)["data"]["state"], "proposed");
        let op_id = tool_result(&trash_res)["data"]["operation"]
            .as_i64()
            .unwrap();

        // Read preview digest.
        let (_, show_res) = post_mcp(
            &app,
            &agent_secret,
            modern_mcp(
                "tools/call",
                json!({ "name": "mail-operation-show", "arguments": { "operation": op_id } }),
            ),
            "2026-07-28",
        )
        .await;
        let digest = tool_result(&show_res)["data"]["preview"]["digest"]
            .as_str()
            .unwrap()
            .to_string();

        // F-T3: Non-approver agent gets APPROVAL_REQUIRED with NO approvalToken.
        let (_, agent_hold) = post_mcp(
            &app,
            &agent_secret,
            modern_mcp(
                "tools/call",
                json!({ "name": "mail-operation-approve", "arguments": { "operation": op_id, "digest": digest } }),
            ),
            "2026-07-28",
        )
        .await;
        let agent_err = &tool_result(&agent_hold)["error"];
        assert_eq!(agent_err["code"], "APPROVAL_REQUIRED", "{agent_hold}");
        assert_eq!(agent_err["retryable"], false);
        assert!(agent_err["details"].get("approvalToken").is_none());
        let summary = agent_err["details"]["summary"].as_str().unwrap();
        assert!(!summary.contains("Words"), "summary must hold no content");
        assert!(!summary.contains("news@"), "summary must hold no content");
        assert!(
            agent_err["suggestion"]
                .as_str()
                .unwrap()
                .contains("loam-mail mail-operation-approve")
        );

        // F-T4: Approver gets a token.
        let (_, app_hold) = post_mcp(
            &app,
            &approver1_secret,
            modern_mcp(
                "tools/call",
                json!({ "name": "mail-operation-approve", "arguments": { "operation": op_id, "digest": digest } }),
            ),
            "2026-07-28",
        )
        .await;
        let approval_token = tool_result(&app_hold)["error"]["details"]["approvalToken"]
            .as_str()
            .expect("approver receives approvalToken")
            .to_string();

        // Agent trying to present the approver's token in `_meta` has its `_meta` ignored.
        let (_, agent_meta) = post_mcp(
            &app,
            &agent_secret,
            modern_mcp(
                "tools/call",
                json!({
                    "name": "mail-operation-approve",
                    "arguments": { "operation": op_id, "digest": digest },
                    "_meta": { "dev.afd/approval": approval_token }
                }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&agent_meta)["error"]["code"],
            "APPROVAL_REQUIRED"
        );
        assert!(
            tool_result(&agent_meta)["error"]["details"]
                .get("approvalToken")
                .is_none()
        );

        // Another approver trying to redeem approver1's token is refused.
        let (_, cross_approver) = post_mcp(
            &app,
            &approver2_secret,
            modern_mcp(
                "tools/call",
                json!({
                    "name": "mail-operation-approve",
                    "arguments": { "operation": op_id, "digest": digest },
                    "_meta": { "dev.afd/approval": approval_token }
                }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&cross_approver)["success"], false);
        assert_ne!(tool_result(&cross_approver)["data"]["state"], "done");

        // 2025-era request carrying `_meta["dev.afd/approval"]` is refused.
        let (_, legacy_res) = post_mcp(
            &app,
            &approver1_secret,
            legacy_mcp(
                "tools/call",
                json!({
                    "name": "mail-operation-approve",
                    "arguments": { "operation": op_id, "digest": digest },
                    "_meta": { "dev.afd/approval": approval_token }
                }),
            ),
            "2025-06-18",
        )
        .await;
        assert!(
            legacy_res.get("error").is_some() || tool_result(&legacy_res)["success"] == false,
            "2025-era approval must be refused: {legacy_res}"
        );

        // `afd-batch` and `afd-pipe` are refused.
        for meta_tool in ["afd-batch", "afd-pipe"] {
            let (_, meta_res) = post_mcp(
                &app,
                &approver1_secret,
                modern_mcp(
                    "tools/call",
                    json!({
                        "name": meta_tool,
                        "arguments": {
                            "commands": [{ "command": "mail-operation-approve", "input": { "operation": op_id, "digest": digest } }]
                        },
                        "_meta": { "dev.afd/approval": approval_token }
                    }),
                ),
                "2026-07-28",
            )
            .await;
            assert!(
                meta_res.to_string().contains("ONE_COMMAND_PER_CALL")
                    || meta_res.get("error").is_some()
                    || tool_result(&meta_res)["success"] == false,
                "{meta_tool} must be refused: {meta_res}"
            );
        }

        // Putting `dev.afd/approval` inside tool arguments is refused with VALIDATION_ERROR.
        let (_, key_in_args) = post_mcp(
            &app,
            &approver1_secret,
            modern_mcp(
                "tools/call",
                json!({
                    "name": "mail-operation-approve",
                    "arguments": {
                        "operation": op_id,
                        "digest": digest,
                        "dev.afd/approval": approval_token
                    }
                }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&key_in_args)["error"]["code"],
            "VALIDATION_ERROR",
            "{key_in_args}"
        );

        // Approver1 redeems its token on MCP 2026-07-28 -> runs past policy limits!
        let (_, released) = post_mcp(
            &app,
            &approver1_secret,
            modern_mcp(
                "tools/call",
                json!({
                    "name": "mail-operation-approve",
                    "arguments": { "operation": op_id, "digest": digest },
                    "_meta": { "dev.afd/approval": approval_token }
                }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&released)["success"], true, "{released}");
        assert_eq!(tool_result(&released)["data"]["state"], "done", "{released}");
        assert_eq!(tool_result(&released)["data"]["changed"], 6);

        // Single-use: second retry with same token fails.
        let (_, replay) = post_mcp(
            &app,
            &approver1_secret,
            modern_mcp(
                "tools/call",
                json!({
                    "name": "mail-operation-approve",
                    "arguments": { "operation": op_id, "digest": digest },
                    "_meta": { "dev.afd/approval": approval_token }
                }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&replay)["success"], false, "{replay}");
        (app, approver1_secret, op_id)
    });

    // F-T8: Undo so messages return to INBOX, set trash_per_call=1, trash_per_day=1.
    // Approver's own trash of 1 runs and charges its day; a second trash of 1
    // exceeds its day and becomes a proposal!
    let undone = fixture.person("mail-operation-undo", json!({ "operation": op_id }));
    assert_eq!(undone["data"]["state"], "done", "{undone}");
    set_policy(
        &fixture,
        Policy {
            change_per_call: 5,
            trash_per_call: 1,
            trash_per_day: 1,
            ask_above: 200,
        },
    );
    let m0 = fixture.person("mail-search", json!({ "query": "s0" }))["data"]["hits"][0]["message"]
        .as_i64()
        .unwrap();
    let m1 = fixture.person("mail-search", json!({ "query": "s1" }))["data"]["hits"][0]["message"]
        .as_i64()
        .unwrap();
    runtime.block_on(async {
        let (_, own1) = post_mcp(
            &app,
            &approver1_secret,
            modern_mcp(
                "tools/call",
                json!({ "name": "mail-trash", "arguments": { "messages": [m0] } }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(tool_result(&own1)["data"]["state"], "done", "{own1}");
        let (_, own2) = post_mcp(
            &app,
            &approver1_secret,
            modern_mcp(
                "tools/call",
                json!({ "name": "mail-trash", "arguments": { "messages": [m1] } }),
            ),
            "2026-07-28",
        )
        .await;
        assert_eq!(
            tool_result(&own2)["data"]["state"],
            "proposed",
            "approver's second trash exceeds its charged day and becomes a proposal: {own2}"
        );
    });
}

/// Cross-platform mirror of every step in
/// `endpoints/loam/plugins/mail/docs/scenarios/approve-what-was-proposed.scenario.yaml`
/// over HTTP `/mcp` against a 120-message mailbox with the default policy.
#[test]
fn scenario_3_approve_what_was_proposed_over_http_mcp() {
    let fixture = Fixture::new(scenario3_world);
    // Find the Notifications mailbox id outside the tokio runtime.
    let status = fixture.person("mail-status", json!({}));
    let notif_mailbox = status["data"]["accounts"][0]["mailboxes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["name"]["text"] == "Notifications")
        .expect("Notifications mailbox present")["mailbox"]
        .as_i64()
        .unwrap();

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let (_agent_id, agent_secret) = make_token(&fixture.registry, "claude", "agent").await;
        let app = router(
            &fixture.registry,
            Arc::clone(&fixture.engine),
            PORT,
            CLI_TOKEN,
        )
        .unwrap();

        // Step 0: mail-selection-create -> count 120
        let (_, s0) = post_mcp(
            &app,
            &agent_secret,
            modern_mcp(
                "tools/call",
                json!({ "name": "mail-selection-create", "arguments": { "account": 1, "mailbox": notif_mailbox } }),
            ),
            "2026-07-28",
        )
        .await;
        let r0 = tool_result(&s0);
        assert_eq!(r0["success"], true, "{r0}");
        assert_eq!(r0["data"]["count"], 120);
        let selection = r0["data"]["selection"].as_i64().unwrap();

        // Step 1: mail-trash 120 messages -> state: proposed (default trash limit is 50)
        let (_, s1) = post_mcp(
            &app,
            &agent_secret,
            modern_mcp(
                "tools/call",
                json!({ "name": "mail-trash", "arguments": { "selection": selection, "expectedCount": 120 } }),
            ),
            "2026-07-28",
        )
        .await;
        let r1 = tool_result(&s1);
        assert_eq!(r1["success"], true, "{r1}");
        assert_eq!(r1["data"]["state"], "proposed");
        let operation = r1["data"]["operation"].as_i64().unwrap();

        // Step 2: mail-operation-show -> preview.approvable=true, byAccount[0]={account:1, places:120}, proposal=1, 43-char digest
        let (_, s2) = post_mcp(
            &app,
            &agent_secret,
            modern_mcp(
                "tools/call",
                json!({ "name": "mail-operation-show", "arguments": { "operation": operation } }),
            ),
            "2026-07-28",
        )
        .await;
        let r2 = tool_result(&s2);
        assert_eq!(r2["success"], true, "{r2}");
        assert_eq!(r2["data"]["preview"]["approvable"], true);
        assert_eq!(r2["data"]["preview"]["byAccount"][0]["account"], 1);
        assert_eq!(r2["data"]["preview"]["byAccount"][0]["places"], 120);
        assert_eq!(r2["data"]["preview"]["proposal"], 1);
        let digest = r2["data"]["preview"]["digest"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(digest.len(), 43);

        // Step 3: mail-operation-show with matching digest -> command, query.trust=content, proposal.proposer, preview.approvable=true, preview.proposal=1, no items
        let (_, s3) = post_mcp(
            &app,
            &agent_secret,
            modern_mcp(
                "tools/call",
                json!({ "name": "mail-operation-show", "arguments": { "operation": operation, "digest": digest } }),
            ),
            "2026-07-28",
        )
        .await;
        let r3 = tool_result(&s3);
        assert_eq!(r3["success"], true, "{r3}");
        assert_eq!(r3["data"]["command"], "mail-trash");
        assert_eq!(r3["data"]["query"]["trust"], "content");
        assert!(r3["data"]["proposal"]["proposer"].is_object());
        assert_eq!(r3["data"]["preview"]["approvable"], true);
        assert_eq!(r3["data"]["preview"]["proposal"], 1);
        assert!(r3["data"].get("items").is_none());

        // Step 4: mail-operation-show with another digest -> PREVIEW_CHANGED
        let (_, s4) = post_mcp(
            &app,
            &agent_secret,
            modern_mcp(
                "tools/call",
                json!({ "name": "mail-operation-show", "arguments": { "operation": operation, "digest": STALE_DIGEST } }),
            ),
            "2026-07-28",
        )
        .await;
        let r4 = tool_result(&s4);
        assert_eq!(r4["success"], false);
        assert_eq!(r4["error"]["code"], "PREVIEW_CHANGED");

        // Step 5: mail-operation-approve with another digest -> PREVIEW_CHANGED + suggestion contains mail-operation-show
        let (_, s5) = post_mcp(
            &app,
            &agent_secret,
            modern_mcp(
                "tools/call",
                json!({ "name": "mail-operation-approve", "arguments": { "operation": operation, "digest": STALE_DIGEST } }),
            ),
            "2026-07-28",
        )
        .await;
        let r5 = tool_result(&s5);
        assert_eq!(r5["success"], false);
        assert_eq!(r5["error"]["code"], "PREVIEW_CHANGED");
        assert!(
            r5["error"]["suggestion"]
                .as_str()
                .unwrap()
                .contains("mail-operation-show")
        );

        // Step 6: mail-operation-approve with matching digest -> APPROVAL_REQUIRED (held, no token for agent)
        let (_, s6) = post_mcp(
            &app,
            &agent_secret,
            modern_mcp(
                "tools/call",
                json!({ "name": "mail-operation-approve", "arguments": { "operation": operation, "digest": digest } }),
            ),
            "2026-07-28",
        )
        .await;
        let r6 = tool_result(&s6);
        assert_eq!(r6["success"], false);
        assert_eq!(r6["error"]["code"], "APPROVAL_REQUIRED");
        assert!(r6["error"]["details"].get("approvalToken").is_none());

        // Step 7: mail-operation-approve with no digest -> VALIDATION_ERROR
        let (_, s7) = post_mcp(
            &app,
            &agent_secret,
            modern_mcp(
                "tools/call",
                json!({ "name": "mail-operation-approve", "arguments": { "operation": operation } }),
            ),
            "2026-07-28",
        )
        .await;
        let r7 = tool_result(&s7);
        assert_eq!(r7["success"], false);
        assert_eq!(r7["error"]["code"], "VALIDATION_ERROR");
    });
}

/// Direct store-level tests for `Store::approve_proposal_checked` (unmasked by
/// `pre_approval_check`), verifying every refusal branch and atomic rollback.
#[test]
fn direct_store_approve_proposal_checked_refusals_and_atomicity() {
    let fixture = Fixture::new(base_world);
    set_policy(&fixture, NOTHING_ALONE);

    // 1. Missing operation -> ApprovalRefusal::Missing.
    let missing = fixture
        .engine
        .with_store(|store| store.approve_proposal_checked(999_999, STALE_DIGEST, 1_000))
        .unwrap();
    assert_eq!(missing, Err(ApprovalRefusal::Missing));

    // Create a proposal via agent.
    let sel = fixture.agent("a", "mail-selection-create", json!({ "text": "Words" }));
    let selection = sel["data"]["selection"].as_i64().unwrap();
    let count = sel["data"]["count"].as_i64().unwrap();
    let prop = fixture.agent(
        "a",
        "mail-trash",
        json!({ "selection": selection, "expectedCount": count }),
    );
    let id = prop["data"]["operation"].as_i64().unwrap();
    let row = fixture
        .engine
        .with_store(|store| store.operation(id))
        .unwrap()
        .unwrap();
    let now = row.proposal.as_ref().unwrap().proposed_at + 1;
    let expires_at = row.proposal.as_ref().unwrap().expires_at;
    let good_digest = fixture
        .engine
        .with_store(|store| store.proposal_digest(&row))
        .unwrap();

    // 2. Wrong digest -> PreviewChanged, row unchanged in DB.
    let wrong = fixture
        .engine
        .with_store(|store| store.approve_proposal_checked(id, STALE_DIGEST, now))
        .unwrap();
    assert_eq!(wrong, Err(ApprovalRefusal::PreviewChanged));
    let still_open = fixture
        .engine
        .with_store(|store| store.operation(id))
        .unwrap()
        .unwrap();
    assert_eq!(still_open.state, OperationState::Proposed);
    assert!(still_open.proposal.unwrap().approved_at.is_none());

    // 3. Screening not ready -> ScreeningNotReady (checked before digest).
    fixture
        .engine
        .with_store(|store| store.rebuild_begin())
        .unwrap();
    let unready = fixture
        .engine
        .with_store(|store| store.approve_proposal_checked(id, STALE_DIGEST, now))
        .unwrap();
    assert!(matches!(
        unready,
        Err(ApprovalRefusal::ScreeningNotReady(_))
    ));
    fixture
        .engine
        .with_store(|store| store.rebuild(1, |_| {}).map(|_| ()))
        .unwrap();

    // 4. Past expiry -> NotOpen(Expired) and state updated to expired.
    let expired = fixture
        .engine
        .with_store(|store| store.approve_proposal_checked(id, &good_digest, expires_at + 1))
        .unwrap();
    assert_eq!(
        expired,
        Err(ApprovalRefusal::NotOpen(OperationState::Expired))
    );

    // 5. Dismissed proposal -> NotOpen(Dismissed).
    let prop2 = fixture.agent(
        "a",
        "mail-trash",
        json!({ "selection": selection, "expectedCount": count }),
    );
    let id2 = prop2["data"]["operation"].as_i64().unwrap();
    let row2 = fixture
        .engine
        .with_store(|store| store.operation(id2))
        .unwrap()
        .unwrap();
    let digest2 = fixture
        .engine
        .with_store(|store| store.proposal_digest(&row2))
        .unwrap();
    fixture.agent("a", "mail-operation-dismiss", json!({ "operation": id2 }));
    let dismissed = fixture
        .engine
        .with_store(|store| store.approve_proposal_checked(id2, &digest2, now))
        .unwrap();
    assert_eq!(
        dismissed,
        Err(ApprovalRefusal::NotOpen(OperationState::Dismissed))
    );

    // 6. Successful approval transitions to Running; second call returns NotOpen(Running).
    let prop3 = fixture.agent(
        "a",
        "mail-trash",
        json!({ "selection": selection, "expectedCount": count }),
    );
    let id3 = prop3["data"]["operation"].as_i64().unwrap();
    let row3 = fixture
        .engine
        .with_store(|store| store.operation(id3))
        .unwrap()
        .unwrap();
    let digest3 = fixture
        .engine
        .with_store(|store| store.proposal_digest(&row3))
        .unwrap();
    let waiting = fixture
        .engine
        .with_store(|store| store.approve_proposal_checked(id3, &digest3, now))
        .unwrap();
    assert_eq!(waiting, Ok(6));
    let second = fixture
        .engine
        .with_store(|store| store.approve_proposal_checked(id3, &digest3, now))
        .unwrap();
    assert_eq!(
        second,
        Err(ApprovalRefusal::NotOpen(OperationState::Running))
    );

    // 7. Undo proposal whose target is Running or already Undone -> refused atomically.
    let done_op = fixture.person(
        "mail-trash",
        json!({ "selection": selection, "expectedCount": count }),
    );
    assert_eq!(done_op["data"]["state"], "done", "{done_op}");
    let done_id = done_op["data"]["operation"].as_i64().unwrap();
    let undo_prop = fixture.agent("a", "mail-operation-undo", json!({ "operation": done_id }));
    assert_eq!(undo_prop["data"]["state"], "proposed", "{undo_prop}");
    let undo_id = undo_prop["data"]["operation"].as_i64().unwrap();
    let undo_row = fixture
        .engine
        .with_store(|store| store.operation(undo_id))
        .unwrap()
        .unwrap();
    let undo_digest = fixture
        .engine
        .with_store(|store| store.proposal_digest(&undo_row))
        .unwrap();
    let undo_now = undo_row.proposal.as_ref().unwrap().proposed_at + 1;

    // Simulate target flipping to running directly in DB.
    {
        let conn = rusqlite::Connection::open(fixture.engine.home().unwrap().database()).unwrap();
        conn.execute(
            "UPDATE operation SET state = 'running' WHERE id = ?1",
            [done_id],
        )
        .unwrap();
    }
    let target_running = fixture
        .engine
        .with_store(|store| store.approve_proposal_checked(undo_id, &undo_digest, undo_now))
        .unwrap();
    assert_eq!(
        target_running,
        Err(ApprovalRefusal::UndoTargetRunning(done_id))
    );

    // Simulate target already undone by another started operation.
    {
        let conn = rusqlite::Connection::open(fixture.engine.home().unwrap().database()).unwrap();
        conn.execute(
            "UPDATE operation SET state = 'done' WHERE id = ?1",
            [done_id],
        )
        .unwrap();
        conn.execute(
            "UPDATE operation SET undo_of = ?1, started_at = 100 WHERE id = ?2",
            [done_id, id3],
        )
        .unwrap();
    }
    let target_undone = fixture
        .engine
        .with_store(|store| store.approve_proposal_checked(undo_id, &undo_digest, undo_now))
        .unwrap();
    assert_eq!(
        target_undone,
        Err(ApprovalRefusal::UndoTargetUndone {
            original: done_id,
            undone_by: id3,
        })
    );
}

/// Verifies `Store::proposal_items_digest` matches `afd::input_digest` over
/// the canonical JSON array of waiting places and `Store::proposal_digest`
/// matches `afd::input_digest` over the exact outer preview-digest object.
#[test]
fn proposal_items_digest_and_outer_digest_match_canonical_json_vector() {
    let fixture = Fixture::new(base_world);
    set_policy(&fixture, NOTHING_ALONE);
    let sel = fixture.agent("a", "mail-selection-create", json!({ "text": "Words" }));
    let selection = sel["data"]["selection"].as_i64().unwrap();
    let count = sel["data"]["count"].as_i64().unwrap();
    let prop = fixture.agent(
        "a",
        "mail-archive",
        json!({ "selection": selection, "expectedCount": count }),
    );
    let id = prop["data"]["operation"].as_i64().unwrap();

    let (row, items, items_digest, outer_digest) = fixture
        .engine
        .with_store(|store| {
            let row = store.operation(id)?.unwrap();
            let items = store.operation_items(id, None, 100)?;
            let items_digest = store.proposal_items_digest(id)?;
            let outer_digest = store.proposal_digest(&row)?;
            Ok((row, items, items_digest, outer_digest))
        })
        .unwrap();

    let expected_items: Vec<Value> = items
        .iter()
        .map(|item| {
            let flags_value = item
                .flags_wanted
                .as_deref()
                .map(|raw| serde_json::from_str::<Value>(raw).unwrap())
                .unwrap_or(Value::Null);
            json!({
                "flagsWanted": flags_value,
                "mailbox": item.mailbox,
                "providerId": item.provider_id,
                "toMailbox": item.to_mailbox,
                "toProviderId": item.to_provider_id,
                "toValidity": item.to_validity,
                "validity": item.validity,
            })
        })
        .collect();
    let expected_items_digest = afd::input_digest(&Value::Array(expected_items)).unwrap();
    assert_eq!(items_digest, expected_items_digest);

    let proposal = row.proposal.as_ref().unwrap();
    let expected_outer = json!({
        "operation": row.id,
        "proposal": proposal.generation,
        "proposer": {
            "kind": proposal.proposer.kind,
            "id": proposal.proposer.id,
        },
        "command": row.command,
        "asked": loam_mail::operate::normalized_asked(&row),
        "query": row
            .query
            .as_deref()
            .and_then(|q| serde_json::from_str::<Value>(q).ok()),
        "items": expected_items_digest,
    });
    let expected_outer_digest = afd::input_digest(&expected_outer).unwrap();
    assert_eq!(outer_digest, expected_outer_digest);
}

/// Unsafe JS integers are rejected at `mail-selection-create` and any legacy
/// stored query containing an unsafe integer fails `proposal_digest` and
/// `mail-operation-show` cleanly instead of silently hashing to `""`.
#[test]
fn unsafe_integers_rejected_at_selection_and_proposal_digest_propagates_error() {
    let fixture = Fixture::new(base_world);
    set_policy(&fixture, NOTHING_ALONE);

    let unsafe_sel = fixture.agent(
        "a",
        "mail-selection-create",
        json!({ "before": 9_007_199_254_740_993i64 }),
    );
    assert_eq!(unsafe_sel["success"], false, "{unsafe_sel}");
    assert_eq!(unsafe_sel["error"]["code"], "INVALID_INPUT", "{unsafe_sel}");

    let sel = fixture.agent("a", "mail-selection-create", json!({ "text": "Words" }));
    let selection = sel["data"]["selection"].as_i64().unwrap();
    let count = sel["data"]["count"].as_i64().unwrap();
    let prop = fixture.agent(
        "a",
        "mail-trash",
        json!({ "selection": selection, "expectedCount": count }),
    );
    let id = prop["data"]["operation"].as_i64().unwrap();

    // Inject an unsafe integer directly into the stored operation query.
    {
        let conn = rusqlite::Connection::open(fixture.engine.home().unwrap().database()).unwrap();
        conn.execute(
            "UPDATE operation SET query = ?1 WHERE id = ?2",
            rusqlite::params![r#"{"before":9007199254740993}"#, id],
        )
        .unwrap();
    }

    let digest_res = fixture.engine.with_store(|store| {
        let row = store.operation(id)?.unwrap();
        store.proposal_digest(&row)
    });
    assert!(
        matches!(digest_res, Err(StoreError::InvalidDigest(_))),
        "expected InvalidDigest, got {digest_res:?}"
    );

    let shown = fixture.person("mail-operation-show", json!({ "operation": id }));
    assert_eq!(shown["success"], false, "{shown}");
    assert_eq!(shown["error"]["code"], "INVALID_INPUT", "{shown}");
}

/// A stopped undo operation whose `original.undone_by == Some(undo.id)` can be
/// proposed for resume, shows `preview.approvable == true`, and completes once
/// approved.
#[test]
fn stopped_undo_proposed_for_resume_is_approvable_and_completes() {
    let fixture = Fixture::with_changes(
        |w| {
            base_world(w);
            w.moves = true;
        },
        ChangeOptions {
            batch: 2,
            ..ChangeOptions::default()
        },
    );
    let ids: Vec<i64> = ["n0", "n1", "n2", "n3"]
        .iter()
        .map(|w| {
            let found = fixture.person("mail-search", json!({ "query": w }));
            found["data"]["hits"][0]["message"].as_i64().unwrap()
        })
        .collect();
    let moved = fixture.person("mail-trash", json!({ "messages": ids }));
    assert_eq!(moved["data"]["state"], "done", "{moved}");
    let orig_id = moved["data"]["operation"].as_i64().unwrap();

    // Drop after the first undo batch so the undo stops midway with original.undone_by = undo_id.
    fixture.server.world().drop_after_doing = Some("MOVE".to_string());
    let undo = fixture.person("mail-operation-undo", json!({ "operation": orig_id }));
    assert_eq!(undo["error"]["code"], "PROVIDER_UNAVAILABLE", "{undo}");
    let undo_id = undo["error"]["details"]["operation"].as_i64().unwrap();

    // Agent proposes resuming the stopped undo.
    set_policy(&fixture, NOTHING_ALONE);
    let proposed = fixture.agent(
        "a",
        "mail-operation-resume",
        json!({ "operation": undo_id }),
    );
    assert_eq!(proposed["data"]["state"], "proposed", "{proposed}");

    // Preview must be approvable (not self-blocked by original.undone_by == undo_id).
    let shown = fixture.person("mail-operation-show", json!({ "operation": undo_id }));
    assert_eq!(shown["success"], true, "{shown}");
    assert_eq!(shown["data"]["preview"]["approvable"], true, "{shown}");
    assert!(shown["data"]["preview"]["refused"].is_null(), "{shown}");
    let digest = shown["data"]["preview"]["digest"]
        .as_str()
        .unwrap()
        .to_string();

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let approved = runtime.block_on(approved_local(
        &fixture.registry,
        "mail-operation-approve",
        json!({ "operation": undo_id, "digest": digest }),
    ));
    assert!(approved.success, "{approved:?}");
    assert_eq!(approved.data.unwrap()["state"], "done");
}

/// Approving a proposal that is already `running` returns `PROPOSAL_NOT_OPEN`,
/// never retryable `WORK_RUNNING`.
#[test]
fn second_approval_while_running_returns_proposal_not_open_not_work_running() {
    let fixture = Fixture::new(base_world);
    set_policy(&fixture, NOTHING_ALONE);
    let sel = fixture.agent("a", "mail-selection-create", json!({ "text": "Words" }));
    let selection = sel["data"]["selection"].as_i64().unwrap();
    let count = sel["data"]["count"].as_i64().unwrap();
    let prop = fixture.agent(
        "a",
        "mail-trash",
        json!({ "selection": selection, "expectedCount": count }),
    );
    let id = prop["data"]["operation"].as_i64().unwrap();
    let show = fixture.person("mail-operation-show", json!({ "operation": id }));
    let digest = show["data"]["preview"]["digest"]
        .as_str()
        .unwrap()
        .to_string();

    // Transition proposal to `running` in store.
    let now = fixture
        .engine
        .with_store(|store| Ok(store.operation(id)?.unwrap().proposal.unwrap().proposed_at + 1))
        .unwrap();
    fixture
        .engine
        .with_store(|store| store.approve_proposal_checked(id, &digest, now))
        .unwrap()
        .unwrap();

    // Second approval must fail with PROPOSAL_NOT_OPEN (not WORK_RUNNING).
    let second = fixture.person(
        "mail-operation-approve",
        json!({ "operation": id, "digest": digest }),
    );
    assert_eq!(second["success"], false, "{second}");
    assert_eq!(second["error"]["code"], "PROPOSAL_NOT_OPEN", "{second}");
}

/// Malformed `digest` strings fail input schema validation (`VALIDATION_ERROR`)
/// before command journaling, so arbitrary caller text never reaches `journal.jsonl`,
/// while a valid 43-char base64url stale digest still returns `PREVIEW_CHANGED`.
#[test]
fn malformed_digest_rejected_before_journaling() {
    let fixture = Fixture::new(base_world);
    set_policy(&fixture, NOTHING_ALONE);
    let sel = fixture.agent("a", "mail-selection-create", json!({ "text": "Words" }));
    let selection = sel["data"]["selection"].as_i64().unwrap();
    let count = sel["data"]["count"].as_i64().unwrap();
    let prop = fixture.agent(
        "a",
        "mail-trash",
        json!({ "selection": selection, "expectedCount": count }),
    );
    let id = prop["data"]["operation"].as_i64().unwrap();

    let secret_payload = "SECRET_MAIL_TEXT_MUST_NOT_BE_JOURNALED";
    let bad_approve = fixture.person(
        "mail-operation-approve",
        json!({ "operation": id, "digest": secret_payload }),
    );
    assert_eq!(bad_approve["success"], false, "{bad_approve}");
    assert_eq!(
        bad_approve["error"]["code"], "VALIDATION_ERROR",
        "{bad_approve}"
    );

    let bad_show = fixture.person(
        "mail-operation-show",
        json!({ "operation": id, "digest": secret_payload }),
    );
    assert_eq!(bad_show["success"], false, "{bad_show}");
    assert_eq!(bad_show["error"]["code"], "VALIDATION_ERROR", "{bad_show}");

    let journal_path = loam_mail::journal::path(fixture.engine.home().unwrap());
    if journal_path.exists() {
        let content = std::fs::read_to_string(&journal_path).unwrap();
        assert!(
            !content.contains(secret_payload),
            "malformed digest must never be written to journal.jsonl"
        );
    }

    // Valid 43-char base64url stale digest still reaches PREVIEW_CHANGED.
    let stale = fixture.person(
        "mail-operation-approve",
        json!({ "operation": id, "digest": STALE_DIGEST }),
    );
    assert_eq!(stale["error"]["code"], "PREVIEW_CHANGED", "{stale}");
}

/// Verifies `mail-archive` normalizes `asked.copy`, terminal preview renders
/// effect-bearing `asked` on proposed resumes (`mail-mark`), and terminal
/// omitted-digest auto-fill preserves `retryable` and `suggestion` from
/// `preview.refused` (matching explicit-digest failures).
#[test]
fn archive_asked_copy_terminal_mark_resume_and_cli_autofill_retry_contract() {
    let fixture = Fixture::with_changes(
        |w| {
            base_world(w);
            w.moves = true;
        },
        ChangeOptions {
            batch: 2,
            ..ChangeOptions::default()
        },
    );

    // 1. `mail-archive` normalizes `asked.copy = false` in both normal and preview-only forms.
    set_policy(&fixture, NOTHING_ALONE);
    let sel = fixture.agent("a", "mail-selection-create", json!({ "text": "Words" }));
    let selection = sel["data"]["selection"].as_i64().unwrap();
    let count = sel["data"]["count"].as_i64().unwrap();
    let arch = fixture.agent(
        "a",
        "mail-archive",
        json!({ "selection": selection, "expectedCount": count }),
    );
    let arch_id = arch["data"]["operation"].as_i64().unwrap();
    let arch_show = fixture.person("mail-operation-show", json!({ "operation": arch_id }));
    assert_eq!(arch_show["data"]["asked"]["copy"], false, "{arch_show}");
    let arch_digest = arch_show["data"]["preview"]["digest"]
        .as_str()
        .unwrap()
        .to_string();
    let arch_preview = fixture.person(
        "mail-operation-show",
        json!({ "operation": arch_id, "digest": arch_digest }),
    );
    assert_eq!(
        arch_preview["data"]["asked"]["copy"], false,
        "{arch_preview}"
    );
    fixture.agent(
        "a",
        "mail-operation-dismiss",
        json!({ "operation": arch_id }),
    );

    // 2. Stopped `mail-mark { read: true }` proposed for resume renders `Mark: read.` in terminal preview.
    let ids: Vec<i64> = ["n0", "n1", "n2", "n3"]
        .iter()
        .map(|w| {
            let found = fixture.person("mail-search", json!({ "query": w }));
            found["data"]["hits"][0]["message"].as_i64().unwrap()
        })
        .collect();
    fixture.server.world().drop_after_doing = Some("STORE".to_string());
    let marked = fixture.person("mail-mark", json!({ "messages": ids, "read": true }));
    assert_eq!(marked["error"]["code"], "PROVIDER_UNAVAILABLE", "{marked}");
    let mark_id = marked["error"]["details"]["operation"].as_i64().unwrap();
    let resumed = fixture.agent(
        "a",
        "mail-operation-resume",
        json!({ "operation": mark_id }),
    );
    assert_eq!(resumed["data"]["state"], "proposed", "{resumed}");
    let mark_digest = fixture.person("mail-operation-show", json!({ "operation": mark_id }))
        ["data"]["preview"]["digest"]
        .as_str()
        .unwrap()
        .to_string();

    // 3. When screening is not ready, CLI omitted-digest auto-fill preserves
    // `retryable: true` and the engine's `mail-rebuild` suggestion, matching
    // explicit-digest invocation.
    fixture
        .engine
        .with_store(|store| store.rebuild_begin())
        .unwrap();
    let omitted_arg = json!({ "operation": mark_id }).to_string();
    let (status_o, out_o, _err_o, asked_o) =
        fixture.terminal(&["mail-operation-approve", &omitted_arg], true);
    assert_eq!(status_o, EXIT_FAILED);
    assert!(asked_o.is_empty());
    let json_o: Value = serde_json::from_str(&out_o).unwrap();
    assert_eq!(json_o["error"]["code"], "SCREENING_NOT_READY", "{json_o}");
    assert_eq!(json_o["error"]["retryable"], true, "{json_o}");
    assert!(
        json_o["error"]["suggestion"]
            .as_str()
            .unwrap()
            .contains("mail-status"),
        "{json_o}"
    );

    let explicit_arg = json!({ "operation": mark_id, "digest": mark_digest }).to_string();
    let (status_e, out_e, _err_e, asked_e) =
        fixture.terminal(&["mail-operation-approve", &explicit_arg], true);
    assert_eq!(status_e, EXIT_FAILED);
    assert!(asked_e.is_empty());
    let json_e: Value = serde_json::from_str(&out_e).unwrap();
    assert_eq!(json_e["error"]["code"], json_o["error"]["code"]);
    assert_eq!(json_e["error"]["retryable"], json_o["error"]["retryable"]);
    assert_eq!(json_e["error"]["suggestion"], json_o["error"]["suggestion"]);

    // Restore screening readiness and run terminal approval to inspect rendered preview.
    fixture
        .engine
        .with_store(|store| store.rebuild(1, |_| {}).map(|_| ()))
        .unwrap();
    let (status_ok, out_ok, err_ok, asked_ok) =
        fixture.terminal(&["mail-operation-approve", &omitted_arg], true);
    assert_eq!(status_ok, EXIT_OK, "{out_ok}{err_ok}");
    assert_eq!(asked_ok.len(), 1);
    assert!(
        err_ok.contains("Mark: read."),
        "terminal preview must show effect-bearing asked for proposed resume:\n{err_ok}"
    );
}
