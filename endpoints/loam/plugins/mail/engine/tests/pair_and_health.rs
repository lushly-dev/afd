//! Step 9 plugin contract tests for `loam-mail` (phase 5 no-terminal amendment,
//! sections 5.1 and 5.2): `pair`, `unpair`, persistent `proofKey`, pre-bearer
//! `GET /health?nonce=` `X-Loam-Proof`, and `--version` build-feature reporting.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use afd::create_context_digest;
use axum::body::Body;
use http_body_util::{BodyExt, Full};
use loam_mail::cli::command_line_context;
use loam_mail::engine::Engine;
use loam_mail::home::Home;
use loam_mail::pair::{
    PairOutput, UnpairOutput, compute_health_proof, is_hex64, is_valid_token_id,
};
use loam_mail::serve::{PROOF_HEADER, ServerEntry, cli_token_file, router, running, server_file};
use loam_mail::store::{Store, TokenRole, TokenRow};
use loam_mail::tokens;
use serde_json::{Value, json};
use tower::ServiceExt;

const PORT: u16 = 4329;
const GOOD_HOST: &str = "127.0.0.1:4329";
const CLI_TOKEN: &str = "lmail_cli_pair_health_test";
const META: &str = r#"{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}"#;

fn mcp_body(method: &str, params: Value) -> Value {
    let mut params = params;
    params["_meta"] = serde_json::from_str(META).unwrap();
    json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params })
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn programmatic_nonce(seed: u8) -> String {
    let bytes: Vec<u8> = (0u8..32).map(|i| seed.wrapping_add(i)).collect();
    encode_hex(&bytes)
}

fn decode_hex32(hex: &str) -> [u8; 32] {
    assert!(is_hex64(hex), "expected 64 lowercase hex chars, got {hex}");
    let mut out = Vec::with_capacity(32);
    for chunk in hex.as_bytes().as_chunks::<2>().0 {
        let hi = match chunk[0] {
            b'0'..=b'9' => chunk[0] - b'0',
            b'a'..=b'f' => chunk[0] - b'a' + 10,
            other => panic!("invalid hex byte {other}"),
        };
        let lo = match chunk[1] {
            b'0'..=b'9' => chunk[1] - b'0',
            b'a'..=b'f' => chunk[1] - b'a' + 10,
            other => panic!("invalid hex byte {other}"),
        };
        out.push((hi << 4) | lo);
    }
    out.try_into().unwrap()
}

#[test]
fn pair_non_interactive_stdout_json_journal_redaction_and_unpair_stopped() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("mail");
    let bin = env!("CARGO_BIN_EXE_loam-mail");

    // 1. Omitting `--accept-consent` fails closed with clear suggestion and empty stdout.
    let refused = Command::new(bin)
        .args(["pair", "--role", "approver", "--name", "Loam Desktop (a)"])
        .env("LOAM_MAIL_HOME", &home)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(refused.status.code(), Some(2));
    assert!(refused.stdout.is_empty());
    let refused_err = String::from_utf8_lossy(&refused.stderr);
    assert!(refused_err.contains("--accept-consent"), "{refused_err}");
    assert!(!home.exists(), "invalid args must not create store");

    // 2. Pair approver token with `stdin: null` (non-TTY, never PERSON_REQUIRED).
    let out1 = Command::new(bin)
        .args([
            "pair",
            "--role",
            "approver",
            "--name",
            "Loam Desktop (a1b2c3d4)",
            "--accept-consent",
        ])
        .env("LOAM_MAIL_HOME", &home)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(
        out1.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out1.stderr)
    );
    assert!(
        out1.stderr.is_empty(),
        "unexpected stderr: {}",
        String::from_utf8_lossy(&out1.stderr)
    );
    let stdout1 = String::from_utf8(out1.stdout).unwrap();
    assert_eq!(stdout1.lines().count(), 1, "strictly one JSON object");
    let pair1: PairOutput = serde_json::from_str(stdout1.trim()).unwrap();
    assert!(pair1.token.starts_with("lmail_approver_"));
    assert!(is_valid_token_id(&pair1.token_id));
    assert_eq!(pair1.role, "approver");
    assert!(is_hex64(&pair1.proof_key));

    // 3. Pair agent token: returns the exact same persistent proofKey.
    let out2 = Command::new(bin)
        .args([
            "pair",
            "--role",
            "agent",
            "--name",
            "Loam Desktop (e5f60718)",
            "--accept-consent",
        ])
        .env("LOAM_MAIL_HOME", &home)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(
        out2.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out2.stderr)
    );
    let stdout2 = String::from_utf8(out2.stdout).unwrap();
    assert_eq!(stdout2.lines().count(), 1);
    let pair2: PairOutput = serde_json::from_str(stdout2.trim()).unwrap();
    assert!(pair2.token.starts_with("lmail_agent_"));
    assert!(is_valid_token_id(&pair2.token_id));
    assert_eq!(pair2.role, "agent");
    assert_eq!(pair2.proof_key, pair1.proof_key, "proofKey is persistent");
    assert_ne!(pair2.token_id, pair1.token_id);
    assert_ne!(pair2.token, pair1.token);

    // 4. Duplicate token name fails cleanly on stderr with empty stdout.
    let dup = Command::new(bin)
        .args([
            "pair",
            "--role",
            "agent",
            "--name",
            "Loam Desktop (e5f60718)",
            "--accept-consent",
        ])
        .env("LOAM_MAIL_HOME", &home)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(dup.status.code(), Some(1));
    assert!(dup.stdout.is_empty());

    // 5. Interactive `mail-token-create` STILL fails with PERSON_REQUIRED without a TTY.
    let interactive_guard = Command::new(bin)
        .args([
            "mail-token-create",
            r#"{"name":"script","role":"approver"}"#,
        ])
        .env("LOAM_MAIL_HOME", &home)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(!interactive_guard.status.success());
    assert!(String::from_utf8_lossy(&interactive_guard.stdout).contains("PERSON_REQUIRED"));

    // 6. Journal records `source: "pair"` and NEVER contains bearer tokens or proofKey.
    let journal = std::fs::read_to_string(home.join("journal.jsonl")).unwrap();
    assert!(
        !journal.contains(&pair1.token),
        "bearer leaked into journal"
    );
    assert!(
        !journal.contains(&pair2.token),
        "bearer leaked into journal"
    );
    assert!(
        !journal.contains(&pair1.proof_key),
        "proofKey leaked into journal"
    );
    assert!(!journal.contains("lmail_approver_"));
    assert!(!journal.contains("lmail_agent_"));
    let pair_entries: Vec<Value> = journal
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .filter(|entry| entry["input"]["source"] == json!("pair"))
        .collect();
    assert_eq!(pair_entries.len(), 2, "{journal}");
    assert_eq!(pair_entries[0]["command"], json!("mail-token-create"));
    assert!(pair_entries[0]["result"].get("data").is_none());
    let expected_digest = create_context_digest(&command_line_context(false));
    for entry in &pair_entries {
        assert_eq!(
            entry["contextDigest"]["hash"],
            json!(expected_digest.hash),
            "journal contextDigest.hash must follow spec/journal.md: {entry}"
        );
        assert_eq!(entry["contextDigest"]["interface"], json!("cli"));
    }

    // 7. Store keeps ONLY token hashes and accurate roles (never raw bearer strings).
    let store = Store::open(&Home::at(&home)).unwrap();
    let stored_tokens = store.tokens().unwrap();
    assert_eq!(stored_tokens.len(), 2);
    let row1 = stored_tokens
        .iter()
        .find(|t| t.id == pair1.token_id)
        .expect("approver row");
    assert_eq!(row1.role, TokenRole::Approver);
    assert_eq!(row1.hash, tokens::hash(&pair1.token));
    let row2 = stored_tokens
        .iter()
        .find(|t| t.id == pair2.token_id)
        .expect("agent row");
    assert_eq!(row2.role, TokenRole::Agent);
    assert_eq!(row2.hash, tokens::hash(&pair2.token));
    assert_eq!(store.proof_key().unwrap(), decode_hex32(&pair1.proof_key));
    drop(store);

    // 8. `unpair` revokes token1, is idempotent on repeat and unknown id, and preserves proofKey.
    let unpair1 = Command::new(bin)
        .args(["unpair", "--token-id", &pair1.token_id])
        .env("LOAM_MAIL_HOME", &home)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(
        unpair1.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&unpair1.stderr)
    );
    let u1: UnpairOutput =
        serde_json::from_str(std::str::from_utf8(&unpair1.stdout).unwrap().trim()).unwrap();
    assert_eq!(u1.token_id, pair1.token_id);
    assert!(u1.revoked);

    // Repeat unpair on already-revoked token exits 0 idempotently.
    let unpair1_again = Command::new(bin)
        .args(["unpair", "--token-id", &pair1.token_id])
        .env("LOAM_MAIL_HOME", &home)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(unpair1_again.status.success());
    let u1_again: UnpairOutput =
        serde_json::from_str(std::str::from_utf8(&unpair1_again.stdout).unwrap().trim()).unwrap();
    assert!(!u1_again.revoked);

    // Unpair on unknown tokenId exits 0 idempotently.
    let unpair_unknown = Command::new(bin)
        .args(["unpair", "--token-id", "tok_fedcba9876543210"])
        .env("LOAM_MAIL_HOME", &home)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(unpair_unknown.status.success());

    // Remaining token2 and proofKey stay intact.
    let store = Store::open(&Home::at(&home)).unwrap();
    let remaining = store.tokens().unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, pair2.token_id);
    assert_eq!(store.proof_key().unwrap(), decode_hex32(&pair1.proof_key));
}

#[tokio::test]
async fn health_endpoint_verifies_nonce_computes_hmac_and_keeps_auth_strict() {
    let dir = tempfile::tempdir().unwrap();
    let home = Home::at(dir.path().join("mail"));
    let engine = Arc::new(Engine::new(Some(home)));
    let registry = loam_mail::registry(&engine).unwrap();
    engine.open_store().unwrap();

    let key = engine.proof_key().expect("proofKey loaded on open_store");
    let app = router(&registry, Arc::clone(&engine), PORT, CLI_TOKEN).unwrap();

    // 1. Unauthenticated GET /health?nonce=<64-hex> returns 200 + exact X-Loam-Proof.
    let nonce = programmatic_nonce(32);
    let expected = compute_health_proof(&key, &nonce).unwrap();
    let req = axum::http::Request::get(format!("/health?nonce={nonce}"))
        .header("host", GOOD_HOST)
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);
    let proofs: Vec<_> = resp.headers().get_all(PROOF_HEADER).iter().collect();
    assert_eq!(proofs.len(), 1);
    assert_eq!(proofs[0].to_str().unwrap(), expected);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    assert!(body.is_empty());

    // 2. Missing, malformed, uppercase, or extra-param nonce returns 400 with NO X-Loam-Proof.
    let upper = nonce.to_ascii_uppercase();
    let bad_uris = [
        "/health".to_string(),
        "/health?nonce=".to_string(),
        format!("/health?nonce={}", &nonce[..63]),
        format!("/health?nonce={upper}"),
        format!("/health?nonce={nonce}&extra=1"),
        format!("/health?other=1&nonce={nonce}"),
    ];
    for uri in &bad_uris {
        let req = axum::http::Request::get(uri)
            .header("host", GOOD_HOST)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), 400, "uri={uri}");
        assert!(resp.headers().get(PROOF_HEADER).is_none(), "uri={uri}");
    }

    // 3. Bad Host and browser Origin are still refused on GET /health with 403.
    let bad_host = axum::http::Request::get(format!("/health?nonce={nonce}"))
        .header("host", "evil.example:4329")
        .body(Body::empty())
        .unwrap();
    assert_eq!(app.clone().oneshot(bad_host).await.unwrap().status(), 403);

    let with_origin = axum::http::Request::get(format!("/health?nonce={nonce}"))
        .header("host", GOOD_HOST)
        .header("origin", "http://127.0.0.1:4329")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.clone().oneshot(with_origin).await.unwrap().status(),
        403
    );

    // 4. Non-GET /health without bearer is NOT bypassed (returns 401).
    let post_health = axum::http::Request::post(format!("/health?nonce={nonce}"))
        .header("host", GOOD_HOST)
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.clone().oneshot(post_health).await.unwrap().status(),
        401
    );

    // 5. /mcp and /cli still strictly require valid bearer tokens.
    let mcp_unauth = axum::http::Request::post("/mcp")
        .header("host", GOOD_HOST)
        .header("content-type", "application/json")
        .body(Body::from(mcp_body("tools/list", json!({})).to_string()))
        .unwrap();
    assert_eq!(app.clone().oneshot(mcp_unauth).await.unwrap().status(), 401);

    let cli_unauth = axum::http::Request::post("/cli")
        .header("host", GOOD_HOST)
        .header("content-type", "application/json")
        .body(Body::from(
            json!({"command": "_pair", "input": {}, "terminal": false}).to_string(),
        ))
        .unwrap();
    assert_eq!(app.clone().oneshot(cli_unauth).await.unwrap().status(), 401);

    // 6. Router with an unopened engine (no proofKey loaded) returns 200 without X-Loam-Proof.
    let unopened = Arc::new(Engine::new(None));
    let unopened_reg = loam_mail::registry(&unopened).unwrap();
    let unopened_app = router(&unopened_reg, unopened, PORT, CLI_TOKEN).unwrap();
    let req = axum::http::Request::get(format!("/health?nonce={nonce}"))
        .header("host", GOOD_HOST)
        .body(Body::empty())
        .unwrap();
    let resp = unopened_app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);
    assert!(resp.headers().get(PROOF_HEADER).is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pair_unpair_and_keepalive_health_to_mcp_work_against_running_server() {
    let dir = tempfile::tempdir().unwrap();
    let home = Home::at(dir.path().join("mail"));
    let engine = Arc::new(Engine::new(Some(home.clone())));
    let registry = loam_mail::registry(&engine).unwrap();
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(loam_mail::serve::serve(
        Arc::clone(&engine),
        registry,
        0,
        async move {
            let _ = stop_rx.await;
        },
        |_| {},
    ));

    let mut entry: Option<ServerEntry> = None;
    for _ in 0..200 {
        entry = running(&home);
        if entry.is_some() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let entry = entry.expect("server wrote server.json");
    let bin = env!("CARGO_BIN_EXE_loam-mail");

    // 1. Pair against the running server (forwards over `/cli`).
    let home_path = home.root().to_path_buf();
    let pair_out = tokio::task::spawn_blocking(move || {
        Command::new(bin)
            .args([
                "pair",
                "--role",
                "approver",
                "--name",
                "Loam Desktop (live1)",
                "--accept-consent",
            ])
            .env("LOAM_MAIL_HOME", &home_path)
            .stdin(Stdio::null())
            .output()
            .unwrap()
    })
    .await
    .unwrap();
    assert!(
        pair_out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&pair_out.stderr)
    );
    let paired: PairOutput =
        serde_json::from_str(std::str::from_utf8(&pair_out.stdout).unwrap().trim()).unwrap();
    assert!(
        engine.is_approver_token(&paired.token_id),
        "paired approver token must be immediately active as approver"
    );

    // 2. On ONE HTTP/1.1 keep-alive TCP connection (matching `mounts_proof.rs`):
    //    GET /health?nonce=... -> verify X-Loam-Proof -> POST /mcp with Bearer token!
    let stream = tokio::net::TcpStream::connect(("127.0.0.1", entry.port))
        .await
        .unwrap();
    let (mut sender, conn) =
        hyper::client::conn::http1::handshake(hyper_util::rt::TokioIo::new(stream))
            .await
            .unwrap();
    let conn_task = tokio::spawn(conn);

    let nonce = programmatic_nonce(77);
    let health_req = hyper::Request::get(format!("/health?nonce={nonce}"))
        .header("host", format!("127.0.0.1:{}", entry.port))
        .body(Full::new(axum::body::Bytes::new()))
        .unwrap();
    sender.ready().await.unwrap();
    let health_resp = sender.send_request(health_req).await.unwrap();
    assert_eq!(health_resp.status(), 200);
    let proof = health_resp
        .headers()
        .get(PROOF_HEADER)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    let key_bytes = decode_hex32(&paired.proof_key);
    assert_eq!(
        compute_health_proof(&key_bytes, &nonce).as_deref(),
        Some(proof.as_str())
    );
    let _ = health_resp.into_body().collect().await.unwrap();

    // Reuse the EXACT same verified HTTP/1.1 connection for authenticated POST /mcp.
    let list_body = mcp_body("tools/list", json!({})).to_string();
    let mcp_req = hyper::Request::post("/mcp")
        .header("host", format!("127.0.0.1:{}", entry.port))
        .header("authorization", format!("Bearer {}", paired.token))
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2026-07-28")
        .header("mcp-method", "tools/list")
        .body(Full::new(axum::body::Bytes::from(list_body.clone())))
        .unwrap();
    sender.ready().await.unwrap();
    let mcp_resp = sender.send_request(mcp_req).await.unwrap();
    assert_eq!(mcp_resp.status(), 200);
    let _ = mcp_resp.into_body().collect().await.unwrap();
    conn_task.abort();

    // 3. Unpair against the running server (forwards over `/cli`) and verify immediate 401 on /mcp.
    let home_path = home.root().to_path_buf();
    let token_id = paired.token_id.clone();
    let unpair_out = tokio::task::spawn_blocking(move || {
        Command::new(bin)
            .args(["unpair", "--token-id", &token_id])
            .env("LOAM_MAIL_HOME", &home_path)
            .stdin(Stdio::null())
            .output()
            .unwrap()
    })
    .await
    .unwrap();
    assert!(
        unpair_out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&unpair_out.stderr)
    );
    let unpaired: UnpairOutput =
        serde_json::from_str(std::str::from_utf8(&unpair_out.stdout).unwrap().trim()).unwrap();
    assert!(unpaired.revoked);

    // Revoked token is immediately refused on /mcp with 401, while /health still proves the SAME proofKey.
    let stream2 = tokio::net::TcpStream::connect(("127.0.0.1", entry.port))
        .await
        .unwrap();
    let (mut sender2, conn2) =
        hyper::client::conn::http1::handshake(hyper_util::rt::TokioIo::new(stream2))
            .await
            .unwrap();
    let conn2_task = tokio::spawn(conn2);

    let nonce2 = programmatic_nonce(99);
    let health_req2 = hyper::Request::get(format!("/health?nonce={nonce2}"))
        .header("host", format!("127.0.0.1:{}", entry.port))
        .body(Full::new(axum::body::Bytes::new()))
        .unwrap();
    sender2.ready().await.unwrap();
    let health_resp2 = sender2.send_request(health_req2).await.unwrap();
    assert_eq!(health_resp2.status(), 200);
    let proof2 = health_resp2
        .headers()
        .get(PROOF_HEADER)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert_eq!(
        compute_health_proof(&key_bytes, &nonce2).as_deref(),
        Some(proof2.as_str()),
        "proofKey must remain intact after unpair"
    );
    let _ = health_resp2.into_body().collect().await.unwrap();

    let mcp_req2 = hyper::Request::post("/mcp")
        .header("host", format!("127.0.0.1:{}", entry.port))
        .header("authorization", format!("Bearer {}", paired.token))
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2026-07-28")
        .header("mcp-method", "tools/list")
        .body(Full::new(axum::body::Bytes::from(list_body)))
        .unwrap();
    sender2.ready().await.unwrap();
    let mcp_resp2 = sender2.send_request(mcp_req2).await.unwrap();
    assert_eq!(mcp_resp2.status(), 401);
    conn2_task.abort();

    // Verify journal seq numbers stayed strictly monotonic across pair + unpair.
    let journal = std::fs::read_to_string(home.root().join("journal.jsonl")).unwrap();
    let seqs: Vec<u64> = journal
        .lines()
        .map(|line| {
            serde_json::from_str::<Value>(line).unwrap()["seq"]
                .as_u64()
                .unwrap()
        })
        .collect();
    assert!(seqs.len() >= 2, "{journal}");
    assert!(seqs.windows(2).all(|w| w[1] == w[0] + 1), "{seqs:?}");
    assert!(!journal.contains(&paired.token));
    assert!(!journal.contains(&paired.proof_key));

    stop_tx.send(()).unwrap();
    server.await.unwrap().unwrap();
    assert!(!server_file(&home).exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pair_and_unpair_refuse_port_squatter_without_sending_cli_token() {
    let dir = tempfile::tempdir().unwrap();
    let home = Home::at(dir.path().join("mail"));
    // Hold the store lock so `pair`/`unpair` take the running-server `/cli` path.
    let _owner = Store::open(&home).unwrap();
    let expected_proof = encode_hex(&_owner.proof_key().unwrap());

    // Start a rogue HTTP listener that answers `/health` with the WRONG proof
    // and records whether `/cli` was ever called.
    let cli_hits = Arc::new(AtomicUsize::new(0));
    let cli_hits_srv = Arc::clone(&cli_hits);
    let rogue = axum::Router::new()
        .route(
            "/health",
            axum::routing::get(|| async {
                let mut resp = axum::response::Response::new(Body::empty());
                let bad_proof = programmatic_nonce(123);
                resp.headers_mut().insert(
                    axum::http::header::HeaderName::from_static(PROOF_HEADER),
                    axum::http::header::HeaderValue::from_str(&bad_proof).unwrap(),
                );
                resp
            }),
        )
        .route(
            "/cli",
            axum::routing::post(move || {
                let hits = Arc::clone(&cli_hits_srv);
                async move {
                    hits.fetch_add(1, Ordering::SeqCst);
                    axum::http::StatusCode::OK
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    let srv = tokio::spawn(async move {
        let _ = axum::serve(listener, rogue).await;
    });

    std::fs::write(cli_token_file(&home), "lmail_cli_never_leak").unwrap();
    let entry = ServerEntry {
        pid: std::process::id(),
        port,
        transport: Some("real".to_string()),
        proof_key: Some(expected_proof),
    };
    std::fs::write(server_file(&home), serde_json::to_string(&entry).unwrap()).unwrap();

    let bin = env!("CARGO_BIN_EXE_loam-mail");
    let home_path = home.root().to_path_buf();
    let pair_res = tokio::task::spawn_blocking(move || {
        Command::new(bin)
            .args([
                "pair",
                "--role",
                "approver",
                "--name",
                "Loam Desktop (squat)",
                "--accept-consent",
            ])
            .env("LOAM_MAIL_HOME", &home_path)
            .stdin(Stdio::null())
            .output()
            .unwrap()
    })
    .await
    .unwrap();
    assert!(!pair_res.status.success());
    assert!(pair_res.stdout.is_empty());

    let home_path = home.root().to_path_buf();
    let unpair_res = tokio::task::spawn_blocking(move || {
        Command::new(bin)
            .args(["unpair", "--token-id", "tok_0123456789abcdef"])
            .env("LOAM_MAIL_HOME", &home_path)
            .stdin(Stdio::null())
            .output()
            .unwrap()
    })
    .await
    .unwrap();
    assert!(!unpair_res.status.success());
    assert!(unpair_res.stdout.is_empty());

    assert_eq!(
        cli_hits.load(Ordering::SeqCst),
        0,
        "rogue listener failing /health proof must NEVER receive /cli or cli.token"
    );
    srv.abort();
}

#[test]
fn migration_25_upgrades_existing_v24_store_and_preserves_tokens() {
    let dir = tempfile::tempdir().unwrap();
    let home = Home::at(dir.path().join("data"));
    let seeded_hash = tokens::hash("lmail_approver_seeded_v24_token_value");
    let seeded = TokenRow {
        id: "tok_0123456789abcdef".to_string(),
        name: "existing-approver".to_string(),
        hash: seeded_hash,
        created_at: 1_700_000_000_000,
        role: TokenRole::Approver,
    };
    {
        let mut store = Store::open(&home).unwrap();
        assert!(store.schema_version().unwrap() >= 25);
        store.add_token(&seeded).unwrap();
    }
    // Rewind to schema v24 by dropping instance_proof_key, then reopen.
    {
        let conn = rusqlite::Connection::open(home.database()).unwrap();
        conn.execute_batch(
            "DROP TABLE instance_proof_key;
             PRAGMA user_version = 24;",
        )
        .unwrap();
    }
    let upgraded = Store::open(&home).unwrap();
    assert!(upgraded.schema_version().unwrap() >= 25);
    let preserved = upgraded.tokens().unwrap();
    assert_eq!(preserved.len(), 1);
    assert_eq!(preserved[0].id, seeded.id);
    assert_eq!(preserved[0].name, seeded.name);
    assert_eq!(preserved[0].role, TokenRole::Approver);
    assert_eq!(preserved[0].hash, seeded_hash);
    let key1 = upgraded.proof_key().unwrap();
    drop(upgraded);

    // Reopening returns the exact same persistent proofKey.
    let reopened = Store::open(&home).unwrap();
    assert_eq!(reopened.proof_key().unwrap(), key1);
}

#[test]
fn version_flag_reports_test_doubles_only_when_feature_enabled() {
    let bin = env!("CARGO_BIN_EXE_loam-mail");
    let out = Command::new(bin)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(out.status.success());
    assert!(out.stderr.is_empty());
    let stdout = String::from_utf8(out.stdout).unwrap();
    assert!(stdout.starts_with(&format!("loam-mail {}", env!("CARGO_PKG_VERSION"))));
    #[cfg(feature = "test-doubles")]
    assert!(stdout.contains("test-doubles"), "{stdout}");
    #[cfg(not(feature = "test-doubles"))]
    assert!(!stdout.contains("test-doubles"), "{stdout}");
}
