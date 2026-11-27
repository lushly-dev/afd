//! Step F1 tests: approver tokens, `McpServer::with_approver`, non-approver
//! token stripping, and AFD bootstrap command discovery (plugin.spec.md
//! sections 4, 5.2, 12.1, 18 and 19: tests F-T1 to F-T4 and F-T13).

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use afd::{
    Actor, ActorKind, ApprovalPolicy, CommandContext, CommandDefinition, CommandHandler,
    CommandInterface, CommandRegistry, CommandResult, ExposeOptions, success,
};
use async_trait::async_trait;
use axum::body::Body;
use http_body_util::BodyExt;
use loam_mail::cli::{Caller, EXIT_FAILED, EXIT_OK, Local, Person, Runner, run};
use loam_mail::engine::Engine;
use loam_mail::home::Home;
use loam_mail::secrets::InMemory;
use loam_mail::serve::router;
use loam_mail::store::{Store, TokenRole};
use serde_json::{Value, json};
use tower::ServiceExt;

const PORT: u16 = 4322;
const CLI_TOKEN: &str = "lmail_cli_f1_test";
const GOOD_HOST: &str = "127.0.0.1:4322";
const MODERN_META: &str = r#"{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}"#;

struct ScriptedPerson {
    approve: bool,
    asked: Vec<String>,
}

impl Person for ScriptedPerson {
    fn confirm(&mut self, question: &str) -> std::io::Result<bool> {
        self.asked.push(question.to_string());
        Ok(self.approve)
    }

    fn secret(&mut self, _prompt: &str) -> std::io::Result<String> {
        Ok(String::new())
    }
}

struct Setup {
    dir: tempfile::TempDir,
    home: Home,
    engine: Arc<Engine>,
    registry: Arc<CommandRegistry>,
}

fn setup() -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let home = Home::at(dir.path().join("mail"));
    let engine = Arc::new(Engine::new(Some(home.clone())));
    let registry = loam_mail::registry(&engine).unwrap();
    engine.open_store().unwrap();
    Setup {
        dir,
        home,
        engine,
        registry,
    }
}

async fn approved(registry: &CommandRegistry, name: &str, input: Value) -> CommandResult<Value> {
    let local = Local(registry);
    let held = local.run(name, input.clone(), true, None).await;
    let token = held
        .error
        .as_ref()
        .and_then(|error| error.details.as_ref())
        .and_then(|details| details.get("approvalToken"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| panic!("{name} was not held: {held:?}"));
    local.run(name, input, true, Some(token)).await
}

async fn make_token(registry: &CommandRegistry, name: &str, role: &str) -> (String, String) {
    let made = approved(
        registry,
        "mail-token-create",
        json!({ "name": name, "role": role }),
    )
    .await;
    assert!(made.success, "{made:?}");
    let data = made.data.unwrap();
    assert_eq!(data["role"], json!(role));
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

async fn post_cli(app: &axum::Router, body: Value) -> (u16, Value) {
    let request = axum::http::Request::post("/cli")
        .header("host", GOOD_HOST)
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {CLI_TOKEN}"))
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    (status, json)
}

/// Extracts the AFD `CommandResult` JSON from an MCP JSON-RPC `tools/call` response.
fn tool_structured(response: &Value) -> &Value {
    &response["result"]["structuredContent"]
}

/// A held test command exposed to `cli` and `mcp` for testing F-T3 and F-T4
/// before F2a releases the real commands (plugin.spec.md, section 18, F1).
struct CountedHeld {
    runs: Arc<AtomicUsize>,
}

#[async_trait]
impl CommandHandler for CountedHeld {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        let count = self.runs.fetch_add(1, Ordering::SeqCst) + 1;
        success(json!({ "ran": count, "target": input.get("target") }))
    }
}

/// Builds a test registry (without `rules::check`) containing the token commands
/// plus a held MCP-exposed test command wired with the engine's real middleware.
fn held_test_setup() -> (Setup, Arc<AtomicUsize>) {
    let dir = tempfile::tempdir().unwrap();
    let home = Home::at(dir.path().join("mail"));
    let engine = Arc::new(Engine::new(Some(home.clone())));
    engine.open_store().unwrap();
    let runs = Arc::new(AtomicUsize::new(0));
    let registry = Arc::new(CommandRegistry::new());
    registry
        .register(loam_mail::tokens::create(Arc::clone(&engine)))
        .unwrap();
    registry
        .register(loam_mail::tokens::list(Arc::clone(&engine)))
        .unwrap();
    registry
        .register(loam_mail::tokens::revoke(Arc::clone(&engine)))
        .unwrap();
    registry
        .register(
            CommandDefinition::new(
                "mail-test-held",
                "A held command listed over MCP for F1 tests",
                vec![afd::CommandParameter::required_string(
                    "target",
                    "An id for the test",
                )],
                CountedHeld {
                    runs: Arc::clone(&runs),
                },
            )
            .as_mutation()
            .with_confirm_prompt("Run the held test command")
            .with_approval(ApprovalPolicy::Required)
            .with_expose(
                ExposeOptions::new()
                    .with_cli(true)
                    .with_mcp(true)
                    .with_agent(false)
                    .with_palette(false),
            ),
        )
        .unwrap();
    afd::register_bootstrap_commands(&registry).unwrap();
    // Uses the engine's real production middleware (strip_non_approver_token + approval gate).
    loam_mail::install_middleware(&registry, &engine).unwrap();
    (
        Setup {
            dir,
            home,
            engine,
            registry,
        },
        runs,
    )
}

/// F-T1: Approver tokens are made only at the terminal, carry the exact summary,
/// prefix `lmail_approver_`, stored hash + role, never journaled, and `--out`
/// obeys the Unix `0600` new-file rule and Windows refusal.
#[test]
fn ft1_approver_tokens_are_made_only_at_the_terminal() {
    let setup = setup();
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let (_, existing_agent) = rt.block_on(make_token(&setup.registry, "reader", "agent"));
    let app = router(&setup.registry, Arc::clone(&setup.engine), PORT, CLI_TOKEN).unwrap();

    // 1. Over MCP, `mail-token-create` is COMMAND_NOT_FOUND.
    let call = modern_mcp(
        "tools/call",
        json!({
            "name": "afd-call",
            "arguments": { "command": "mail-token-create", "input": { "name": "evil", "role": "approver" } }
        }),
    );
    let (status, body) = rt.block_on(post_mcp(&app, &existing_agent, call, "2026-07-28"));
    assert_eq!(status, 200);
    assert_eq!(tool_structured(&body)["error"]["code"], "COMMAND_NOT_FOUND");
    drop(rt);

    // 2. At CLI with no terminal (`Caller::Script`), PERSON_REQUIRED.
    {
        let args = vec![
            "mail-token-create".to_string(),
            r#"{"name":"Loam","role":"approver"}"#.to_string(),
        ];
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = run(
            &args,
            &setup.registry,
            Caller::Script,
            &InMemory::default(),
            &mut out,
            &mut err,
        )
        .unwrap();
        assert_eq!(code, EXIT_FAILED);
        let parsed: Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(parsed["error"]["code"], "PERSON_REQUIRED");
    }

    // 3. At terminal, asks with the exact approver summary, produces `lmail_approver_` + 64 hex,
    // stores hash + role, and never journals the secret.
    let secret = {
        let args = vec![
            "mail-token-create".to_string(),
            r#"{"name":"Loam","role":"approver"}"#.to_string(),
        ];
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let mut person = ScriptedPerson {
            approve: true,
            asked: Vec::new(),
        };
        let code = run(
            &args,
            &setup.registry,
            Caller::Terminal(&mut person),
            &InMemory::default(),
            &mut out,
            &mut err,
        )
        .unwrap();
        assert_eq!(code, EXIT_OK, "{}", String::from_utf8_lossy(&err));
        let err_text = String::from_utf8(err).unwrap();
        assert!(
            err_text.contains(
                "Make an approver token named \"Loam\". Whoever holds it can send mail, \
                 unsubscribe and approve agents' proposals from this computer, with no limit, \
                 while `loam-mail serve` runs and until you revoke it. The engine cannot check \
                 that you were asked: give it only to Loam, which asks you before each one."
            ),
            "unexpected summary: {err_text}"
        );
        let parsed: Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(parsed["success"], true);
        assert_eq!(parsed["data"]["role"], "approver");
        let id = parsed["data"]["token"].as_str().unwrap();
        assert!(id.starts_with("tok_") && id.len() == 20, "{id}");
        let secret = parsed["data"]["secret"].as_str().unwrap().to_string();
        let hex = secret
            .strip_prefix("lmail_approver_")
            .expect("approver prefix");
        assert_eq!(hex.len(), 64);
        assert!(hex.bytes().all(|b| b.is_ascii_hexdigit()));
        secret
    };

    // Store holds hash + role, never plaintext.
    let rows = setup.engine.with_store(|store| store.tokens()).unwrap();
    let loam_row = rows.iter().find(|row| row.name == "Loam").unwrap();
    assert_eq!(loam_row.role, TokenRole::Approver);
    assert_eq!(loam_row.hash, loam_mail::tokens::hash(&secret));

    // Journal holds neither the secret nor `lmail_approver_`.
    let journal = std::fs::read_to_string(loam_mail::journal::path(&setup.home)).unwrap();
    assert!(!journal.contains(&secret), "secret leaked to journal");
    assert!(
        !journal.contains("lmail_approver_"),
        "prefix leaked to journal"
    );

    // 4. `--out <file>` behavior per platform.
    let out_file = setup.dir.path().join("approver.tok");
    let args = vec![
        "mail-token-create".to_string(),
        r#"{"name":"LoamOut","role":"approver"}"#.to_string(),
        "--out".to_string(),
        out_file.display().to_string(),
    ];
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let mut person = ScriptedPerson {
        approve: true,
        asked: Vec::new(),
    };
    let code = run(
        &args,
        &setup.registry,
        Caller::Terminal(&mut person),
        &InMemory::default(),
        &mut out,
        &mut err,
    )
    .unwrap();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(code, EXIT_OK, "{}", String::from_utf8_lossy(&err));
        let out_text = String::from_utf8(out).unwrap();
        let file_secret = std::fs::read_to_string(&out_file).unwrap();
        assert!(file_secret.starts_with("lmail_approver_"));
        assert!(
            !out_text.contains(&file_secret),
            "secret must not be printed"
        );
        assert!(!out_text.contains("lmail_approver_"));
        let parsed: Value = serde_json::from_str(&out_text).unwrap();
        assert!(parsed["data"].get("secret").is_none());
        assert_eq!(parsed["data"]["out"], out_file.display().to_string());
        let mode = std::fs::metadata(&out_file).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "token file must be 0600");
        // Journal must not hold the `--out` path.
        let journal = std::fs::read_to_string(loam_mail::journal::path(&setup.home)).unwrap();
        assert!(!journal.contains(&out_file.display().to_string()));
        assert!(!journal.contains(&file_secret));

        // Existing file is refused before asking.
        let args_again = vec![
            "mail-token-create".to_string(),
            r#"{"name":"LoamOut2","role":"approver"}"#.to_string(),
            "--out".to_string(),
            out_file.display().to_string(),
        ];
        let (mut out2, mut err2) = (Vec::new(), Vec::new());
        let mut person2 = ScriptedPerson {
            approve: true,
            asked: Vec::new(),
        };
        let code2 = run(
            &args_again,
            &setup.registry,
            Caller::Terminal(&mut person2),
            &InMemory::default(),
            &mut out2,
            &mut err2,
        )
        .unwrap();
        assert_eq!(code2, EXIT_FAILED);
        assert!(person2.asked.is_empty(), "must refuse before asking");
        assert_eq!(std::fs::read_to_string(&out_file).unwrap(), file_secret);
    }

    #[cfg(not(unix))]
    {
        assert_eq!(code, EXIT_FAILED);
        assert!(
            person.asked.is_empty(),
            "Windows must refuse --out before asking"
        );
        assert!(!out_file.exists(), "no file created on Windows");
        let err_text = String::from_utf8(err).unwrap();
        assert!(err_text.contains("--out"), "{err_text}");
    }
}

/// Migration 18 upgrades an existing v17 store's tokens to role `agent`.
#[test]
fn migration_18_defaults_existing_tokens_to_agent() {
    let dir = tempfile::tempdir().unwrap();
    let home = Home::at(dir.path().join("data"));
    let db_path = home.database();
    std::fs::create_dir_all(home.root()).unwrap();
    {
        let _store = Store::open(&home).unwrap();
    }
    {
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "DROP TABLE instance_proof_key;
             DROP TABLE replyset_claim_key;
             ALTER TABLE draft DROP COLUMN recipient_bases;
             DROP TABLE proposed_story_member;
             DROP TABLE proposed_story;
             DROP TABLE account_policy;
             ALTER TABLE operation DROP COLUMN proposal_generation;
             DROP TABLE replyset_event;
             DROP TABLE replyset_question_reply;
             DROP TABLE replyset_question;
             DROP TABLE replyset_reply;
             DROP TABLE replyset;
             DROP TABLE token;
             CREATE TABLE token (
                 id TEXT PRIMARY KEY,
                 name TEXT NOT NULL,
                 hash BLOB NOT NULL UNIQUE CHECK (length(hash) = 32),
                 created_at INTEGER NOT NULL
             ) STRICT;
             INSERT INTO token (id, name, hash, created_at)
                 VALUES ('tok_0123456789abcdef', 'legacy', zeroblob(32), 100);
             PRAGMA user_version = 17;",
        )
        .unwrap();
    }
    let store = Store::open(&home).unwrap();
    assert!(store.schema_version().unwrap() >= 18);
    let tokens = store.tokens().unwrap();
    assert_eq!(tokens.len(), 1);
    assert_eq!(tokens[0].id, "tok_0123456789abcdef");
    assert_eq!(tokens[0].role, TokenRole::Agent);
}

/// F-T2: Approver mapping, revocation with outstanding hold, `mail-token-list`
/// role, and `mail-status` token counts.
#[tokio::test]
async fn ft2_approver_mapping_revocation_list_and_status() {
    let (setup, runs) = held_test_setup();
    let (agent_id, _agent_secret) = make_token(&setup.registry, "claude", "agent").await;
    let (approver_id, approver_secret) = make_token(&setup.registry, "loam", "approver").await;

    // 1. Predicate checks: only HTTP MCP with an approver token is an approver.
    let approver_ctx = CommandContext::new()
        .with_interface(CommandInterface::Mcp)
        .with_actor(Actor::new(ActorKind::Agent).with_id(&approver_id));
    assert!(loam_mail::is_approver(&setup.engine, &approver_ctx));

    let agent_ctx = CommandContext::new()
        .with_interface(CommandInterface::Mcp)
        .with_actor(Actor::new(ActorKind::Agent).with_id(&agent_id));
    assert!(!loam_mail::is_approver(&setup.engine, &agent_ctx));

    let stdio_ctx = CommandContext::new()
        .with_interface(CommandInterface::Mcp)
        .with_actor(Actor::new(ActorKind::Agent));
    assert!(!loam_mail::is_approver(&setup.engine, &stdio_ctx));

    let cli_ctx = CommandContext::new()
        .with_interface(CommandInterface::Cli)
        .with_actor(ActorKind::Human);
    assert!(!loam_mail::is_approver(&setup.engine, &cli_ctx));

    // Even a CLI context carrying the approver's actor id is never an MCP approver.
    let cli_with_id = CommandContext::new()
        .with_interface(CommandInterface::Cli)
        .with_actor(Actor::new(ActorKind::Agent).with_id(&approver_id));
    assert!(!loam_mail::is_approver(&setup.engine, &cli_with_id));

    // 2. `mail-token-list` reports each token's role.
    let listed = Local(&setup.registry)
        .run("mail-token-list", json!({}), true, None)
        .await;
    assert!(listed.success, "{listed:?}");
    let list_tokens = listed.data.unwrap()["tokens"].as_array().unwrap().clone();
    assert_eq!(list_tokens.len(), 2);
    let claude = list_tokens.iter().find(|t| t["name"] == "claude").unwrap();
    let loam = list_tokens.iter().find(|t| t["name"] == "loam").unwrap();
    assert_eq!(claude["role"], "agent");
    assert_eq!(loam["role"], "approver");

    // 3. Approver gets a hold, then is revoked -> next request is 401 and hold cannot be redeemed.
    let app = router(&setup.registry, Arc::clone(&setup.engine), PORT, CLI_TOKEN).unwrap();
    let hold_call = modern_mcp(
        "tools/call",
        json!({
            "name": "afd-call",
            "arguments": { "command": "mail-test-held", "input": { "target": "t1" } }
        }),
    );
    let (status, held_resp) = post_mcp(&app, &approver_secret, hold_call, "2026-07-28").await;
    assert_eq!(status, 200);
    let approval_token = tool_structured(&held_resp)["error"]["details"]["approvalToken"]
        .as_str()
        .expect("approver receives approvalToken")
        .to_string();

    let revoked = approved(
        &setup.registry,
        "mail-token-revoke",
        json!({ "token": approver_id }),
    )
    .await;
    assert!(revoked.success, "{revoked:?}");

    // Immediately refused with 401 when attempting to redeem the hold.
    let retry_call = modern_mcp(
        "tools/call",
        json!({
            "name": "afd-call",
            "arguments": { "command": "mail-test-held", "input": { "target": "t1" } },
            "_meta": { "dev.afd/approval": approval_token }
        }),
    );
    let (status, _) = post_mcp(&app, &approver_secret, retry_call, "2026-07-28").await;
    assert_eq!(status, 401);
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    // 4. `mail-status` reports `tokens: { agents, approvers }`.
    let status_setup = self::setup();
    status_setup
        .engine
        .with_store(|store| store.add_account("icloud", "me@example.com", 1))
        .unwrap();
    let _ = make_token(&status_setup.registry, "a1", "agent").await;
    let _ = make_token(&status_setup.registry, "a2", "agent").await;
    let _ = make_token(&status_setup.registry, "ap1", "approver").await;
    let status_res = Local(&status_setup.registry)
        .run("mail-status", json!({}), true, None)
        .await;
    assert!(status_res.success, "{status_res:?}");
    let status_data = status_res.data.unwrap();
    assert_eq!(status_data["tokens"]["agents"], 2);
    assert_eq!(status_data["tokens"]["approvers"], 1);
}

/// F-T3: A non-approver's held result over HTTP MCP and over stdio carries
/// `APPROVAL_REQUIRED`, `retryable: false`, summary, engine's suggestion, and
/// NO `approvalToken`; `/cli` keeps the token.
#[tokio::test]
async fn ft3_non_approver_held_result_strips_token_and_sets_engine_suggestion() {
    let (setup, runs) = held_test_setup();
    let (_, agent_secret) = make_token(&setup.registry, "claude", "agent").await;
    let app = router(&setup.registry, Arc::clone(&setup.engine), PORT, CLI_TOKEN).unwrap();

    // 1. Ordinary agent over HTTP `/mcp`.
    let call = modern_mcp(
        "tools/call",
        json!({
            "name": "afd-call",
            "arguments": { "command": "mail-test-held", "input": { "target": "x" } }
        }),
    );
    let (status, resp) = post_mcp(&app, &agent_secret, call, "2026-07-28").await;
    assert_eq!(status, 200);
    assert!(
        !resp.to_string().contains("afdap1."),
        "no approval token may appear anywhere in a non-approver MCP response: {resp}"
    );
    let structured = tool_structured(&resp);
    assert_eq!(structured["success"], false);
    assert_eq!(structured["error"]["code"], "APPROVAL_REQUIRED");
    assert_eq!(structured["error"]["retryable"], false);
    assert!(
        structured["error"]["details"]
            .get("approvalToken")
            .is_none()
    );
    assert!(structured["error"]["details"]["summary"].is_string());
    assert!(structured["error"]["details"]["expiresAt"].is_string());
    assert_eq!(
        structured["error"]["suggestion"],
        "Only the person can do this: at the terminal with `loam-mail mail-test-held`, or in Loam, which shows them the preview and asks."
    );

    // 2. Over stdio (`CommandInterface::Mcp` with no actor id).
    let stdio_ctx = CommandContext::new()
        .with_interface(CommandInterface::Mcp)
        .with_actor(Actor::new(ActorKind::Agent));
    let stdio_result = setup
        .registry
        .execute("mail-test-held", json!({ "target": "x" }), Some(stdio_ctx))
        .await;
    assert!(!stdio_result.success);
    let stdio_err = stdio_result.error.unwrap();
    assert_eq!(stdio_err.code, "APPROVAL_REQUIRED");
    assert_eq!(stdio_err.retryable, Some(false));
    assert!(
        stdio_err
            .details
            .as_ref()
            .and_then(|d| d.get("approvalToken"))
            .is_none(),
        "stdio must not receive approvalToken"
    );
    assert_eq!(
        stdio_err.suggestion.as_deref(),
        Some(
            "Only the person can do this: at the terminal with `loam-mail mail-test-held`, or in Loam, which shows them the preview and asks."
        )
    );

    // 3. Over `/cli` route, the token IS kept for CLI retry.
    let (status, cli_resp) = post_cli(
        &app,
        json!({ "command": "mail-test-held", "input": { "target": "x" }, "terminal": true }),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(cli_resp["error"]["code"], "APPROVAL_REQUIRED");
    assert!(
        cli_resp["error"]["details"]["approvalToken"]
            .as_str()
            .is_some_and(|t| t.starts_with("afdap1.")),
        "CLI route must keep approvalToken: {cli_resp}"
    );
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

/// F-T4: Approver release via `_meta["dev.afd/approval"]` on MCP 2026-07-28,
/// single-use, principal binding across approvers, 2025 refusal, batch/pipe
/// refusal, agent `_meta` ignored, and key in tool arguments -> VALIDATION_ERROR.
#[tokio::test]
async fn ft4_approver_release_enforces_carrier_rules() {
    let (setup, runs) = held_test_setup();
    let (_, agent_secret) = make_token(&setup.registry, "agent1", "agent").await;
    let (_, approver1) = make_token(&setup.registry, "loam1", "approver").await;
    let (_, approver2) = make_token(&setup.registry, "loam2", "approver").await;
    let app = router(&setup.registry, Arc::clone(&setup.engine), PORT, CLI_TOKEN).unwrap();

    // Helper: get a fresh approval token for approver1 on target.
    let get_hold = |token: &str, target: &str| {
        let app = app.clone();
        let token = token.to_string();
        let target = target.to_string();
        async move {
            let call = modern_mcp(
                "tools/call",
                json!({
                    "name": "afd-call",
                    "arguments": { "command": "mail-test-held", "input": { "target": target } }
                }),
            );
            let (status, resp) = post_mcp(&app, &token, call, "2026-07-28").await;
            assert_eq!(status, 200);
            tool_structured(&resp)["error"]["details"]["approvalToken"]
                .as_str()
                .expect("approver gets token")
                .to_string()
        }
    };

    // 1. Key in tool arguments is VALIDATION_ERROR from both approver and agent.
    for caller in [&approver1, &agent_secret] {
        let bad = modern_mcp(
            "tools/call",
            json!({
                "name": "afd-call",
                "arguments": {
                    "command": "mail-test-held",
                    "input": { "target": "t1", "dev.afd/approval": "fake" }
                }
            }),
        );
        let (status, resp) = post_mcp(&app, caller, bad, "2026-07-28").await;
        assert_eq!(status, 200);
        assert_eq!(tool_structured(&resp)["error"]["code"], "VALIDATION_ERROR");
    }
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    // 2. Get a valid token for approver1.
    let tok1 = get_hold(&approver1, "t1").await;

    // 3. Ordinary agent presenting approver1's token in `_meta` is ignored -> held with no token.
    let agent_try = modern_mcp(
        "tools/call",
        json!({
            "name": "afd-call",
            "arguments": { "command": "mail-test-held", "input": { "target": "t1" } },
            "_meta": { "dev.afd/approval": tok1 }
        }),
    );
    let (_, resp) = post_mcp(&app, &agent_secret, agent_try, "2026-07-28").await;
    assert_eq!(tool_structured(&resp)["error"]["code"], "APPROVAL_REQUIRED");
    assert!(
        tool_structured(&resp)["error"]["details"]
            .get("approvalToken")
            .is_none()
    );
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    // 4. Another approver (approver2) presenting approver1's token is refused (principal binding).
    let approver2_try = modern_mcp(
        "tools/call",
        json!({
            "name": "afd-call",
            "arguments": { "command": "mail-test-held", "input": { "target": "t1" } },
            "_meta": { "dev.afd/approval": tok1 }
        }),
    );
    let (_, resp) = post_mcp(&app, &approver2, approver2_try, "2026-07-28").await;
    assert_eq!(tool_structured(&resp)["success"], false);
    assert_eq!(tool_structured(&resp)["error"]["code"], "APPROVAL_REQUIRED");
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    // 5. Same token on a 2025-era request is refused and runs nothing.
    let legacy_call = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "afd-call",
            "arguments": { "command": "mail-test-held", "input": { "target": "t1" } },
            "_meta": { "dev.afd/approval": tok1 }
        }
    });
    let (_, resp) = post_mcp(&app, &approver1, legacy_call, "2025-06-18").await;
    assert_eq!(tool_structured(&resp)["success"], false);
    assert_eq!(tool_structured(&resp)["error"]["code"], "APPROVAL_REQUIRED");
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    // 6. Same token in `afd-batch` and `afd-pipe` is refused and runs nothing.
    let batch_call = modern_mcp(
        "tools/call",
        json!({
            "name": "afd-batch",
            "arguments": {
                "commands": [{ "command": "mail-test-held", "input": { "target": "t1" } }]
            },
            "_meta": { "dev.afd/approval": tok1 }
        }),
    );
    let (_, resp) = post_mcp(&app, &approver1, batch_call, "2026-07-28").await;
    assert_eq!(tool_structured(&resp)["success"], false);
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    let pipe_call = modern_mcp(
        "tools/call",
        json!({
            "name": "afd-pipe",
            "arguments": {
                "steps": [{ "command": "mail-test-held", "input": { "target": "t1" } }]
            },
            "_meta": { "dev.afd/approval": tok1 }
        }),
    );
    let (_, resp) = post_mcp(&app, &approver1, pipe_call, "2026-07-28").await;
    assert_eq!(tool_structured(&resp)["success"], false);
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    // 7. Approver1 retries on MCP 2026-07-28 -> runs ONCE.
    let valid_retry = modern_mcp(
        "tools/call",
        json!({
            "name": "afd-call",
            "arguments": { "command": "mail-test-held", "input": { "target": "t1" } },
            "_meta": { "dev.afd/approval": tok1 }
        }),
    );
    let (status, resp) = post_mcp(&app, &approver1, valid_retry.clone(), "2026-07-28").await;
    assert_eq!(status, 200);
    assert_eq!(tool_structured(&resp)["success"], true, "{resp}");
    assert_eq!(tool_structured(&resp)["data"]["ran"], 1);
    assert_eq!(runs.load(Ordering::SeqCst), 1);

    // 8. Second retry with the same token is refused (single-use) and runs nothing.
    let (_, resp2) = post_mcp(&app, &approver1, valid_retry, "2026-07-28").await;
    assert_eq!(tool_structured(&resp2)["success"], false);
    assert_eq!(
        tool_structured(&resp2)["error"]["code"],
        "APPROVAL_REQUIRED"
    );
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

/// F-T13: Discovery through `afd-help { format: "full" }` (as Loam's
/// `discoverInstance` calls it) returns the same commands for an ordinary
/// token and an approver token, includes bootstrap commands, excludes
/// terminal-only commands, and `rules::check` passes with bootstrap commands
/// while still refusing other non-`mail-` names.
#[tokio::test]
async fn ft13_discovery_through_afd_help_and_rules_exemption() {
    let setup = setup();
    let (_, agent_secret) = make_token(&setup.registry, "agent", "agent").await;
    let (_, approver_secret) = make_token(&setup.registry, "loam", "approver").await;
    let app = router(&setup.registry, Arc::clone(&setup.engine), PORT, CLI_TOKEN).unwrap();

    // `rules::check` passes on the real engine registry with bootstrap commands registered.
    assert_eq!(
        loam_mail::rules::check(&setup.registry),
        Vec::<String>::new()
    );

    // `rules::check` still refuses non-bootstrap non-`mail-` names such as `afd-custom`.
    let bad = CommandRegistry::new();
    bad.register(
        CommandDefinition::new(
            "afd-custom",
            "Not a bootstrap command",
            vec![],
            CountedHeld {
                runs: Arc::new(AtomicUsize::new(0)),
            },
        )
        .with_expose(ExposeOptions::new().with_mcp(true)),
    )
    .unwrap();
    assert_eq!(
        loam_mail::rules::check(&bad),
        vec!["afd-custom: a command's name starts with `mail-`"]
    );

    // Discover via Loam's exact `discoverInstance` wire sequence (`mounted.ts`):
    // direct `afd-help { format: "full" }` followed by batched `afd-detail` calls,
    // verified with both an ordinary agent token and an approver token.
    let discover = |token: &str| {
        let app = app.clone();
        let token = token.to_string();
        async move {
            let help_call = modern_mcp(
                "tools/call",
                json!({
                    "name": "afd-help",
                    "arguments": { "format": "full" }
                }),
            );
            let (status, resp) = post_mcp(&app, &token, help_call, "2026-07-28").await;
            assert_eq!(status, 200);
            let structured = tool_structured(&resp);
            assert_eq!(structured["success"], true, "{resp}");
            let mut names: Vec<String> = structured["data"]["commands"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| c["name"].as_str().unwrap().to_string())
                .collect();
            names.sort();

            // Fetch every discovered non-meta command via `afd-detail` in batches of 10,
            // matching Loam's `discoverInstance` (`mounted.ts`).
            let mail_names: Vec<String> = names
                .iter()
                .filter(|n| !n.starts_with("afd-"))
                .cloned()
                .collect();
            assert!(!mail_names.is_empty());
            let mut detailed: Vec<String> = Vec::new();
            for chunk in mail_names.chunks(10) {
                let detail_call = modern_mcp(
                    "tools/call",
                    json!({
                        "name": "afd-detail",
                        "arguments": { "command": chunk }
                    }),
                );
                let (d_status, d_resp) = post_mcp(&app, &token, detail_call, "2026-07-28").await;
                assert_eq!(d_status, 200);
                let d_structured = tool_structured(&d_resp);
                assert_eq!(d_structured["success"], true, "{d_resp}");
                for item in d_structured["data"].as_array().unwrap() {
                    let name = item["name"].as_str().unwrap().to_string();
                    assert!(
                        item["description"].is_string(),
                        "missing description: {item}"
                    );
                    detailed.push(name);
                }
            }
            detailed.sort();
            assert_eq!(
                detailed, mail_names,
                "afd-detail must return every discovered command"
            );

            // Requesting a terminal-only command through `afd-detail` must not expose it.
            let hidden_call = modern_mcp(
                "tools/call",
                json!({
                    "name": "afd-detail",
                    "arguments": { "command": ["mail-token-create", "mail-account-add"] }
                }),
            );
            let (h_status, h_resp) = post_mcp(&app, &token, hidden_call, "2026-07-28").await;
            assert_eq!(h_status, 200);
            let h_structured = tool_structured(&h_resp);
            assert_eq!(h_structured["success"], true, "{h_resp}");
            let items = h_structured["data"]
                .as_array()
                .expect("afd-detail returns an array");
            assert_eq!(items.len(), 2, "{h_resp}");
            for item in items {
                assert_eq!(
                    item["found"], false,
                    "terminal-only command leaked in afd-detail: {item}"
                );
            }

            names
        }
    };

    let agent_names = discover(&agent_secret).await;
    let approver_names = discover(&approver_secret).await;
    assert_eq!(agent_names, approver_names);

    // Includes bootstrap commands and MCP-exposed mail commands.
    for expected in [
        "afd-help",
        "afd-docs",
        "afd-schema",
        "mail-status",
        "mail-account-list",
        "mail-draft-show",
        "mail-unsubscribe-show",
    ] {
        assert!(
            agent_names.iter().any(|n| n == expected),
            "{expected} missing from discovery: {agent_names:?}"
        );
    }

    // Excludes terminal-only commands.
    for terminal_only in [
        "mail-token-create",
        "mail-token-list",
        "mail-token-revoke",
        "mail-account-add",
        "mail-account-remove",
        "mail-policy-set",
        "mail-sender-screen",
        "mail-sender-accept",
        "mail-rebuild",
    ] {
        assert!(
            !agent_names.iter().any(|n| n == terminal_only),
            "{terminal_only} must not be discovered over MCP"
        );
    }

    // `afd-docs` and `afd-schema` also answer over MCP.
    for (cmd, input) in [
        ("afd-docs", json!({ "command": "mail-status" })),
        ("afd-schema", json!({})),
    ] {
        let call = modern_mcp(
            "tools/call",
            json!({ "name": "afd-call", "arguments": { "command": cmd, "input": input } }),
        );
        let (status, resp) = post_mcp(&app, &agent_secret, call, "2026-07-28").await;
        assert_eq!(status, 200);
        assert_eq!(tool_structured(&resp)["success"], true, "{cmd}: {resp}");
    }
}
