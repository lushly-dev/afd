//! End-to-end integration harness for Phase 5 step 9c (P5-S9-2, P5-S9-3, P5-S9-4, and
//! `loam-desktop plugin` CLI parity).
//!
//! Dual-mode executable (mirroring `tests/updater.rs`):
//! 1. When invoked with `--version`, `pair`, `unpair`, or `serve`, acts as a cross-platform native
//!    `http-service` fixture engine conforming to amendment sections 4.5, 5.1, 5.2, and 5.3.
//!    Its filename stem selects test behaviors (`loam-fixture`, `loam-fixture-td`,
//!    `loam-fixture-badprobe`, `loam-fixture-longtok`), avoiding any dependence on custom env vars
//!    stripped by `apply_clean_env`.
//! 2. When invoked with no engine subcommand (`cargo test --locked`), drives the full lifecycle
//!    core (`plugins::*`, `service::*`, live `Mounts` + `SiteState`, real `loam-desktop engine-run`
//!    under `LOAM_TEST_SERVICE_DIR`, and `loam-desktop plugin` CLI).
use bytes::Bytes;
use flate2::Compression;
use flate2::write::DeflateEncoder;
use hmac::{Hmac, KeyInit, Mac};
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use loam_desktop::SiteState;
use loam_desktop::desktop_state;
use loam_desktop::keychain::KeychainError;
use loam_desktop::mounts::Mounts;
use loam_desktop::plugin_manifest::Target;
use loam_desktop::plugin_validate::sha256_hex;
use loam_desktop::plugins::{
    KeychainOps, LiveHost, PendingInstallStore, PluginHost, ServiceAction, cancel, confirm,
    inspect, list_installed, retry_revocation, rotate_token, service_action, uninstall,
};
use loam_desktop::plugins_engine::{ProbeOutcome, poll_engine_health_blocking, probe_error};
use loam_desktop::plugins_error::{
    PLUGIN_ALREADY_INSTALLED, PLUGIN_CONFLICT, PLUGIN_ENGINE_TEST_BUILD, PLUGIN_HASH_MISMATCH,
    PLUGIN_HEALTH_TIMEOUT, PLUGIN_KEY_TOO_LONG, PLUGIN_KEYCHAIN_UNAVAILABLE, PLUGIN_PORT_CONFLICT,
    PLUGIN_PROPOSAL_EXPIRED,
};
use loam_desktop::service;
use loam_desktop::site;
use serde_json::{Map, Value, json};
use sha2::Sha256;
use std::collections::HashMap;
use std::io::Write as _;
use std::net::{SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tempfile::TempDir;

type HmacSha256 = Hmac<Sha256>;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(first) = args.first().map(String::as_str) {
        match first {
            "--version" => {
                fixture_version();
                return;
            }
            "pair" => {
                fixture_pair(&args[1..]);
                return;
            }
            "unpair" => {
                fixture_unpair(&args[1..]);
                return;
            }
            "serve" => {
                fixture_serve(&args[1..]);
                return;
            }
            _ => {}
        }
    }

    run_all_tests();
}

// ---------------------------------------------------------------------------
// Native cross-platform fixture engine (Mode 1)
// ---------------------------------------------------------------------------

fn fixture_exe_stem() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.file_stem().and_then(|s| s.to_str()).map(str::to_owned))
        .unwrap_or_default()
}

/// Derives `<data>/fixture-state/<plugin-id>/` from `<data>/plugins/<plugin-id>/<sha>/engines/<target>/<bin>`.
fn fixture_state_dir() -> PathBuf {
    let exe = std::env::current_exe().expect("current_exe");
    let target_dir = exe.parent().expect("target dir");
    let engines_dir = target_dir.parent().expect("engines dir");
    let bundle_dir = engines_dir.parent().expect("bundle dir");
    let plugin_dir = bundle_dir.parent().expect("plugin dir");
    let plugins_dir = plugin_dir.parent().expect("plugins dir");
    let data_dir = plugins_dir.parent().expect("data dir");
    let plugin_id = plugin_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("fixture");
    let state = data_dir.join("fixture-state").join(plugin_id);
    std::fs::create_dir_all(&state).expect("create fixture state dir");
    state
}

fn record_execution() {
    let state = fixture_state_dir();
    let _ = std::fs::write(state.join("executed.marker"), "ran\n");
}

fn random_hex(num_bytes: usize) -> String {
    let mut buf = vec![0u8; num_bytes];
    getrandom::fill(&mut buf).expect("getrandom");
    let mut out = String::with_capacity(num_bytes * 2);
    for b in buf {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{b:02x}");
    }
    out
}

fn decode_hex_bytes(hex: &str) -> Option<Vec<u8>> {
    if !hex.len().is_multiple_of(2) {
        return None;
    }
    let mut out = Vec::with_capacity(hex.len() / 2);
    for pair in hex.as_bytes().as_chunks::<2>().0 {
        let s = std::str::from_utf8(pair).ok()?;
        out.push(u8::from_str_radix(s, 16).ok()?);
    }
    Some(out)
}

fn fixture_version() {
    record_execution();
    let stem = fixture_exe_stem();
    if stem.contains("loam-fixture-td") {
        println!("loam-fixture 0.1.0 (test-doubles)");
    } else {
        println!("loam-fixture 0.1.0");
    }
}

fn load_or_create_proof_key(state: &Path) -> String {
    let path = state.join("proof-key.txt");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if trimmed.len() == 64 {
            return trimmed.to_owned();
        }
    }
    let key = random_hex(32);
    std::fs::write(&path, format!("{key}\n")).expect("write proof key");
    key
}

fn load_tokens(state: &Path) -> Map<String, Value> {
    let path = state.join("tokens.json");
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

fn save_tokens(state: &Path, tokens: &Map<String, Value>) {
    let path = state.join("tokens.json");
    let tmp = state.join(format!("tokens.{}.tmp", random_hex(6)));
    let bytes =
        serde_json::to_vec_pretty(&Value::Object(tokens.clone())).expect("serialize tokens");
    std::fs::write(&tmp, bytes).expect("write tmp tokens");
    std::fs::rename(&tmp, &path).expect("rename tokens");
}

fn fixture_pair(args: &[String]) {
    record_execution();
    let mut role = String::new();
    let mut name = String::new();
    let mut accepted = false;
    let mut idx = 0;
    while idx < args.len() {
        match args[idx].as_str() {
            "--role" if idx + 1 < args.len() => {
                role = args[idx + 1].clone();
                idx += 2;
            }
            "--name" if idx + 1 < args.len() => {
                name = args[idx + 1].clone();
                idx += 2;
            }
            "--accept-consent" => {
                accepted = true;
                idx += 1;
            }
            _ => idx += 1,
        }
    }
    if role.is_empty() || name.is_empty() || !accepted {
        eprintln!("pair requires --role, --name, and --accept-consent");
        std::process::exit(2);
    }
    let state = fixture_state_dir();
    let proof_key = load_or_create_proof_key(&state);
    let mut tokens = load_tokens(&state);
    // Reject duplicate client name (proving unique `--name` on every pair/rotate).
    if tokens
        .values()
        .any(|v| v.get("name").and_then(Value::as_str) == Some(name.as_str()))
    {
        eprintln!("duplicate pair name");
        std::process::exit(1);
    }
    let token_id = format!("tok-{}", random_hex(8));
    let stem = fixture_exe_stem();
    let token = if stem.contains("loam-fixture-longtok") {
        random_hex(1500) // 3,000 ASCII bytes (> Windows 2,560-byte cap)
    } else {
        format!("sec-{}", random_hex(24))
    };
    tokens.insert(
        token_id.clone(),
        json!({
            "token": token,
            "role": role,
            "name": name,
        }),
    );
    save_tokens(&state, &tokens);
    let note_path = state.join("user-note.txt");
    if !note_path.exists() {
        let _ = std::fs::write(&note_path, "user-data-preserved\n");
    }
    let out = json!({
        "token": token,
        "tokenId": token_id,
        "role": role,
        "proofKey": proof_key,
    });
    println!("{}", serde_json::to_string(&out).expect("json"));
}

fn fixture_unpair(args: &[String]) {
    record_execution();
    let mut token_id = String::new();
    let mut idx = 0;
    while idx < args.len() {
        if args[idx] == "--token-id" && idx + 1 < args.len() {
            token_id = args[idx + 1].clone();
            idx += 2;
        } else {
            idx += 1;
        }
    }
    if token_id.is_empty() {
        std::process::exit(2);
    }
    let state = fixture_state_dir();
    if state.join("block-unpair").exists() {
        eprintln!("unpair blocked by test fixture");
        std::process::exit(1);
    }
    let mut tokens = load_tokens(&state);
    tokens.remove(&token_id);
    save_tokens(&state, &tokens);
}

fn fixture_serve(args: &[String]) {
    record_execution();
    let mut port: u16 = 0;
    let mut idx = 0;
    while idx < args.len() {
        if args[idx] == "--port" && idx + 1 < args.len() {
            port = args[idx + 1].parse().unwrap_or(0);
            idx += 2;
        } else {
            idx += 1;
        }
    }
    if port == 0 {
        std::process::exit(2);
    }
    let state = fixture_state_dir();
    let bad_probe = fixture_exe_stem().contains("loam-fixture-badprobe");

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio rt");
    rt.block_on(async move {
        let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port)))
            .await
            .expect("bind fixture serve");
        let state = Arc::new(state);
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            let state = state.clone();
            tokio::spawn(async move {
                let io = TokioIo::new(stream);
                let svc = service_fn(move |req: Request<Incoming>| {
                    let state = state.clone();
                    async move { handle_fixture_http(req, &state, bad_probe).await }
                });
                let _ = http1::Builder::new()
                    .keep_alive(true)
                    .serve_connection(io, svc)
                    .await;
            });
        }
    });
}

async fn handle_fixture_http(
    req: Request<Incoming>,
    state: &Path,
    bad_probe: bool,
) -> Result<Response<Full<Bytes>>, std::convert::Infallible> {
    if req.method() == Method::GET && req.uri().path() == "/health" {
        let nonce_hex = req
            .uri()
            .query()
            .and_then(|q| q.split('&').find_map(|pair| pair.strip_prefix("nonce=")))
            .unwrap_or("");
        let mut resp = Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "application/json");
        if nonce_hex.len() == 64
            && nonce_hex
                .bytes()
                .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
            && let Ok(key_hex) = std::fs::read_to_string(state.join("proof-key.txt"))
            && let Some(key_bytes) = decode_hex_bytes(key_hex.trim())
            && key_bytes.len() == 32
            && let Ok(mut mac) = HmacSha256::new_from_slice(&key_bytes)
        {
            mac.update(nonce_hex.as_bytes());
            let tag = mac.finalize().into_bytes();
            let mut hex_tag = String::with_capacity(64);
            for b in tag {
                use std::fmt::Write as _;
                let _ = write!(&mut hex_tag, "{b:02x}");
            }
            resp = resp.header("x-loam-proof", hex_tag);
        }
        return Ok(resp
            .body(Full::new(Bytes::from_static(br#"{"status":"ok"}"#)))
            .expect("health response"));
    }

    if req.method() == Method::POST && req.uri().path() == "/mcp" {
        if bad_probe {
            return Ok(Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Full::new(Bytes::from_static(b"bad probe")))
                .expect("500"));
        }
        let tokens = load_tokens(state);
        if !tokens.is_empty() {
            let auth = req
                .headers()
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.strip_prefix("Bearer "));
            let valid = auth.is_some_and(|presented| {
                tokens
                    .values()
                    .any(|entry| entry.get("token").and_then(Value::as_str) == Some(presented))
            });
            if !valid {
                return Ok(Response::builder()
                    .status(StatusCode::UNAUTHORIZED)
                    .body(Full::new(Bytes::from_static(b"unauthorized")))
                    .expect("401"));
            }
        }
        let body_bytes = req
            .into_body()
            .collect()
            .await
            .map(|c| c.to_bytes())
            .unwrap_or_default();
        let req_json: Value = serde_json::from_slice(&body_bytes).unwrap_or(Value::Null);
        let id = req_json.get("id").cloned().unwrap_or(json!(1));
        let method = req_json
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or("initialize");
        let result = match method {
            "tools/list" => json!({ "tools": [{ "name": "widget-ping", "description": "Ping" }] }),
            _ => json!({
                "protocolVersion": "2026-07-28",
                "capabilities": {},
                "serverInfo": { "name": "loam-fixture", "version": "0.1.0" }
            }),
        };
        let payload = serde_json::to_vec(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
        }))
        .expect("mcp response json");
        return Ok(Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "application/json")
            .body(Full::new(Bytes::from(payload)))
            .expect("mcp response"));
    }

    Ok(Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Full::new(Bytes::from_static(b"not found")))
        .expect("404"))
}

// ---------------------------------------------------------------------------
// Test Helpers (Mode 2)
// ---------------------------------------------------------------------------

struct ServiceCleanup {
    entries: Vec<(PathBuf, Option<PathBuf>, String)>,
}

impl ServiceCleanup {
    fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    fn track(&mut self, data: &Path, custom: Option<&Path>, plugin_id: &str) {
        self.entries.push((
            data.to_path_buf(),
            custom.map(Path::to_path_buf),
            plugin_id.to_owned(),
        ));
    }
}

impl Drop for ServiceCleanup {
    fn drop(&mut self) {
        for (data, custom, plugin_id) in &self.entries {
            let _ = service::unregister_service(data, custom.as_deref(), plugin_id);
        }
    }
}

#[derive(Default)]
struct MockKeychainState {
    slots: HashMap<(String, String), String>,
    force_write_error: Option<KeychainError>,
}

fn mock_keychain(state: Arc<Mutex<MockKeychainState>>, allows_file_fallback: bool) -> KeychainOps {
    let r = state.clone();
    let w = state.clone();
    let d = state;
    KeychainOps {
        read: Arc::new(move |svc, acct| {
            r.lock()
                .expect("kc")
                .slots
                .get(&(svc.to_owned(), acct.to_owned()))
                .cloned()
        }),
        write: Arc::new(move |svc, acct, secret| {
            let mut guard = w.lock().expect("kc");
            if let Some(err) = guard.force_write_error {
                return Err(err);
            }
            guard
                .slots
                .insert((svc.to_owned(), acct.to_owned()), secret.to_owned());
            Ok(())
        }),
        delete: Arc::new(move |svc, acct| {
            d.lock()
                .expect("kc")
                .slots
                .remove(&(svc.to_owned(), acct.to_owned()));
            Ok(())
        }),
        allows_file_fallback,
    }
}

/// Builds a canonical `.loam-plugin` zip archive conforming to amendment 4.4.
fn build_canonical_archive(entries: &mut [(String, Vec<u8>, bool)]) -> Vec<u8> {
    entries.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let mut out = Vec::new();
    let mut centrals = Vec::new();

    for (path, data, executable) in entries.iter() {
        let offset = out.len() as u32;
        let name = path.as_bytes();
        let mut enc = DeflateEncoder::new(Vec::new(), Compression::fast());
        enc.write_all(data).expect("deflate");
        let body = enc.finish().expect("finish deflate");
        let crc = crc32fast::hash(data);
        let compressed = body.len() as u32;
        let uncompressed = data.len() as u32;
        let mode: u32 = if *executable { 0o100755 } else { 0o100644 };

        // Local file header (30 bytes + name)
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes());
        out.extend_from_slice(&0x0800u16.to_le_bytes());
        out.extend_from_slice(&8u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0x0021u16.to_le_bytes());
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&compressed.to_le_bytes());
        out.extend_from_slice(&uncompressed.to_le_bytes());
        out.extend_from_slice(&(name.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(name);
        out.extend_from_slice(&body);

        // Central directory header (46 bytes + name)
        centrals.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        centrals.extend_from_slice(&0x0314u16.to_le_bytes());
        centrals.extend_from_slice(&20u16.to_le_bytes());
        centrals.extend_from_slice(&0x0800u16.to_le_bytes());
        centrals.extend_from_slice(&8u16.to_le_bytes());
        centrals.extend_from_slice(&0u16.to_le_bytes());
        centrals.extend_from_slice(&0x0021u16.to_le_bytes());
        centrals.extend_from_slice(&crc.to_le_bytes());
        centrals.extend_from_slice(&compressed.to_le_bytes());
        centrals.extend_from_slice(&uncompressed.to_le_bytes());
        centrals.extend_from_slice(&(name.len() as u16).to_le_bytes());
        centrals.extend_from_slice(&0u16.to_le_bytes());
        centrals.extend_from_slice(&0u16.to_le_bytes());
        centrals.extend_from_slice(&0u16.to_le_bytes());
        centrals.extend_from_slice(&0u16.to_le_bytes());
        centrals.extend_from_slice(&(mode << 16).to_le_bytes());
        centrals.extend_from_slice(&offset.to_le_bytes());
        centrals.extend_from_slice(name);
    }

    let cd_offset = out.len() as u32;
    let cd_size = centrals.len() as u32;
    let count = entries.len() as u16;
    out.extend_from_slice(&centrals);

    // End of central directory (22 bytes)
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&cd_size.to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

fn pure_app_archive(plugin_id: &str, app_id: &str, version: &str, extra_text: &str) -> Vec<u8> {
    let plugin_manifest = json!({
        "plugin_manifest_version": 1,
        "plugin": {
            "id": plugin_id,
            "title": format!("Widget {version}"),
            "version": version,
            "description": "Pure app test plugin."
        },
        "apps": [{ "id": app_id, "path": format!("apps/{app_id}") }]
    });
    let app_manifest = json!({
        "manifest_version": 1,
        "protocol": 1,
        "plugin": {
            "id": app_id,
            "title": "Widget App",
            "version": version,
            "description": "Pure app.",
            "kind": "view",
            "domains": [app_id]
        },
        "view": {
            "handlers": "dist/handlers.html"
        }
    });
    let mut entries = vec![
        (
            "plugin-manifest.json".to_owned(),
            serde_json::to_vec(&plugin_manifest).unwrap(),
            false,
        ),
        (
            format!("apps/{app_id}/app-manifest.json"),
            serde_json::to_vec(&app_manifest).unwrap(),
            false,
        ),
        (
            format!("apps/{app_id}/dist/handlers.html"),
            format!("<!doctype html><!-- {extra_text} -->\n").into_bytes(),
            false,
        ),
    ];
    build_canonical_archive(&mut entries)
}

fn engine_archive(
    plugin_id: &str,
    app_id: &str,
    version: &str,
    bin_stem: &str,
    extra_text: &str,
) -> Vec<u8> {
    let target = Target::current().expect("supported target");
    let exe_bytes = std::fs::read(std::env::current_exe().expect("self exe")).expect("read exe");
    let exe_sha = sha256_hex(&exe_bytes);
    let bin_name = if target.is_windows() {
        format!("{bin_stem}.exe")
    } else {
        bin_stem.to_owned()
    };
    let artifact_path = format!("engines/{}/{bin_name}", target.as_str());
    let plugin_manifest = json!({
        "plugin_manifest_version": 1,
        "plugin": {
            "id": plugin_id,
            "title": format!("Widget Engine {version}"),
            "version": version,
            "description": "Engine-backed test plugin."
        },
        "apps": [{ "id": app_id, "path": format!("apps/{app_id}") }],
        "engine": {
            "id": plugin_id,
            "kind": "http-service",
            "mount_app": app_id,
            "service_mode": "login",
            "artifacts": {
                target.as_str(): {
                    "path": artifact_path,
                    "sha256": exe_sha
                }
            },
            "auth": { "mode": "approver" },
            "mount": {
                "audience": "person",
                "labels": "whole",
                "approvals": "shell",
                "commands": {
                    format!("{app_id}-send"): {
                        "preview": {
                            "command": format!("{app_id}-preview"),
                            "input": ["id"]
                        }
                    }
                }
            }
        }
    });
    let app_manifest = json!({
        "manifest_version": 1,
        "protocol": 1,
        "plugin": {
            "id": app_id,
            "title": "Widget Mounted App",
            "version": version,
            "description": "Mounted app.",
            "kind": "mounted",
            "domains": [app_id]
        },
        "mount": {
            "prefix": app_id,
            "transport": "http"
        }
    });
    let mut entries = vec![
        (
            "plugin-manifest.json".to_owned(),
            serde_json::to_vec(&plugin_manifest).unwrap(),
            false,
        ),
        (
            format!("apps/{app_id}/app-manifest.json"),
            serde_json::to_vec(&app_manifest).unwrap(),
            false,
        ),
        (
            format!("apps/{app_id}/note.txt"),
            extra_text.as_bytes().to_vec(),
            false,
        ),
        (artifact_path, exe_bytes, true),
    ];
    build_canonical_archive(&mut entries)
}

fn supervisor_bin() -> &'static Path {
    Path::new(env!("CARGO_BIN_EXE_loam-desktop"))
}

// ---------------------------------------------------------------------------
// Integration Tests
// ---------------------------------------------------------------------------

fn run_all_tests() {
    let svc_dir = TempDir::new().expect("service temp dir");
    let svc_root = svc_dir.path().join("services");
    // SAFETY: single-threaded test harness sets env before spawning any supervisor threads.
    unsafe {
        std::env::set_var("LOAM_TEST_SERVICE_DIR", &svc_root);
    }

    test_pure_app_install_upgrade_uninstall();
    println!("test p5_s9_pure_app_install_upgrade_uninstall ... ok");

    test_inspect_safety_toctou_and_conflicts();
    println!("test p5_s9_inspect_safety_toctou_and_conflicts ... ok");

    test_doubles_refused_with_clean_rollback();
    println!("test p5_s9_test_doubles_refused_with_clean_rollback ... ok");

    test_port_squatter_never_receives_bearer();
    println!("test p5_s9_port_squatter_never_receives_bearer ... ok");

    test_keychain_caps_and_linux_file_fallback();
    println!("test p5_s9_keychain_caps_and_linux_file_fallback ... ok");

    test_engine_install_live_mounts_rotate_upgrade_rollback_uninstall();
    println!("test p5_s9_engine_install_live_mounts_rotate_upgrade_rollback_uninstall ... ok");

    test_multi_profile_isolation();
    println!("test p5_s9_multi_profile_isolation ... ok");

    test_cli_plugin_subcommands();
    println!("test p5_s9_cli_plugin_subcommands ... ok");

    test_packed_app_refusals_sse_probe_and_logon_profile();
    println!("test p5_s9_packed_app_refusals_sse_probe_and_logon_profile ... ok");
}

fn test_pure_app_install_upgrade_uninstall() {
    let tmp = TempDir::new().unwrap();
    let data = tmp.path().join("data");
    std::fs::create_dir_all(&data).unwrap();
    let kc_state = Arc::new(Mutex::new(MockKeychainState::default()));
    let mut host = PluginHost::new(&data, Some(&data), "test-build-1");
    host.keychain = mock_keychain(kc_state, false);
    let store = PendingInstallStore::new();

    let v1_path = tmp.path().join("widget-v1.loam-plugin");
    std::fs::write(
        &v1_path,
        pure_app_archive("widget-pack", "widgetapp", "0.1.0", "v1"),
    )
    .unwrap();
    let prop1 = inspect(&host, &v1_path, &store).expect("inspect v1");
    assert_eq!(prop1.kind, "install");
    assert!(prop1.engine.is_none());
    let installed1 = confirm(
        &host,
        &prop1.proposal_id,
        &prop1.bundle_sha256,
        false,
        &store,
    )
    .expect("confirm v1");
    assert!(!installed1.has_engine);
    assert!(
        data.join("plugins/widget-pack")
            .join(&installed1.bundle_sha256)
            .is_dir()
    );

    // Re-inspecting identical bundle returns PLUGIN_ALREADY_INSTALLED.
    let dup = inspect(&host, &v1_path, &store).unwrap_err();
    assert_eq!(dup.code, PLUGIN_ALREADY_INSTALLED);

    // Upgrade to v2 removes old `<bundleSha256>` directory.
    let v2_path = tmp.path().join("widget-v2.loam-plugin");
    std::fs::write(
        &v2_path,
        pure_app_archive("widget-pack", "widgetapp", "0.2.0", "v2"),
    )
    .unwrap();
    let prop2 = inspect(&host, &v2_path, &store).expect("inspect v2");
    assert_eq!(prop2.kind, "upgrade");
    assert_eq!(prop2.previous.as_ref().unwrap().version, "0.1.0");
    let installed2 = confirm(
        &host,
        &prop2.proposal_id,
        &prop2.bundle_sha256,
        false,
        &store,
    )
    .expect("confirm v2");
    assert!(
        !data
            .join("plugins/widget-pack")
            .join(&installed1.bundle_sha256)
            .exists(),
        "old version dir must be removed after upgrade"
    );
    assert!(
        data.join("plugins/widget-pack")
            .join(&installed2.bundle_sha256)
            .is_dir()
    );

    let (listed, revs) = list_installed(&host).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].version, "0.2.0");
    assert!(revs.is_empty());

    let un = uninstall(&host, "widget-pack").unwrap();
    assert!(un.uninstalled && un.data_preserved && un.token_revoked);
    assert!(!data.join("plugins/widget-pack").exists());
}

fn test_inspect_safety_toctou_and_conflicts() {
    let tmp = TempDir::new().unwrap();
    let data = tmp.path().join("data");
    std::fs::create_dir_all(&data).unwrap();
    let kc_state = Arc::new(Mutex::new(MockKeychainState::default()));
    let mut host = PluginHost::new(&data, Some(&data), "test-build-1");
    host.keychain = mock_keychain(kc_state, false);
    let store = PendingInstallStore::new();

    // 1. Inspecting an engine bundle NEVER executes the binary.
    let eng_path = tmp.path().join("eng.loam-plugin");
    std::fs::write(
        &eng_path,
        engine_archive("alpha-pack", "alphaapp", "0.1.0", "loam-fixture", "v1"),
    )
    .unwrap();
    let prop = inspect(&host, &eng_path, &store).expect("inspect engine");
    assert!(
        !data.join("fixture-state").exists(),
        "inspect must NEVER execute engine binary"
    );
    // Cancel cleans up staging.
    cancel(&prop.proposal_id, &store).unwrap();
    assert!(!store.has_active());

    // 2. TOCTOU immunity: corrupting source file AFTER Inspect does not affect Confirm (pure-app).
    let src_path = tmp.path().join("toctou.loam-plugin");
    std::fs::write(
        &src_path,
        pure_app_archive("toctou-pack", "toctouapp", "0.1.0", "good"),
    )
    .unwrap();
    let prop = inspect(&host, &src_path, &store).unwrap();
    std::fs::write(&src_path, b"corrupted-after-inspect").unwrap();
    confirm(&host, &prop.proposal_id, &prop.bundle_sha256, false, &store)
        .expect("confirm reads staged bytes only");

    // 3. Hash mismatch & expired proposal errors.
    let p2_path = tmp.path().join("p2.loam-plugin");
    std::fs::write(
        &p2_path,
        pure_app_archive("other-pack", "otherapp", "0.1.0", "v1"),
    )
    .unwrap();
    let prop = inspect(&host, &p2_path, &store).unwrap();
    let wrong_hash = confirm(&host, &prop.proposal_id, &"0".repeat(64), false, &store).unwrap_err();
    assert_eq!(wrong_hash.code, PLUGIN_HASH_MISMATCH);
    let expired =
        confirm(&host, &prop.proposal_id, &prop.bundle_sha256, false, &store).unwrap_err();
    assert_eq!(expired.code, PLUGIN_PROPOSAL_EXPIRED);

    // 4. App ID / domain conflict against already installed plugin.
    let conflict_path = tmp.path().join("conflict.loam-plugin");
    std::fs::write(
        &conflict_path,
        pure_app_archive("rival-pack", "toctouapp", "0.1.0", "v1"),
    )
    .unwrap();
    let conflict_err = inspect(&host, &conflict_path, &store).unwrap_err();
    assert_eq!(conflict_err.code, PLUGIN_CONFLICT);
}

fn test_doubles_refused_with_clean_rollback() {
    let tmp = TempDir::new().unwrap();
    let data = tmp.path().join("data");
    std::fs::create_dir_all(&data).unwrap();
    let kc_state = Arc::new(Mutex::new(MockKeychainState::default()));
    let mut host = PluginHost::new(&data, Some(&data), "test-build-1");
    host.keychain = mock_keychain(kc_state.clone(), false);
    host.supervisor_exe = Some(supervisor_bin());
    let store = PendingInstallStore::new();

    let td_path = tmp.path().join("td.loam-plugin");
    std::fs::write(
        &td_path,
        engine_archive("td-pack", "tdapp", "0.1.0", "loam-fixture-td", "v1"),
    )
    .unwrap();
    let prop = inspect(&host, &td_path, &store).expect("inspect allows staged td binary");
    let err = confirm(&host, &prop.proposal_id, &prop.bundle_sha256, false, &store).unwrap_err();
    assert_eq!(err.code, PLUGIN_ENGINE_TEST_BUILD);
    assert!(
        !data
            .join("plugins/td-pack")
            .join(&prop.bundle_sha256)
            .exists(),
        "rollback must delete staged version directory"
    );
    assert!(kc_state.lock().unwrap().slots.is_empty());
    let (listed, _) = list_installed(&host).unwrap();
    assert!(listed.is_empty());
}

fn test_port_squatter_never_receives_bearer() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let saw_auth = Arc::new(Mutex::new(false));
    let saw_mcp = Arc::new(Mutex::new(false));
    let saw_auth_srv = saw_auth.clone();
    let saw_mcp_srv = saw_mcp.clone();

    let handle = std::thread::spawn(move || {
        use std::io::Read as _;
        listener.set_nonblocking(false).unwrap();
        if let Ok((mut sock, _)) = listener.accept() {
            let _ = sock.set_read_timeout(Some(Duration::from_millis(600)));
            let mut buf = [0u8; 4096];
            if let Ok(n) = sock.read(&mut buf) {
                let text = String::from_utf8_lossy(&buf[..n]);
                if text.to_ascii_lowercase().contains("authorization:") {
                    *saw_auth_srv.lock().unwrap() = true;
                }
                if text.contains("POST /mcp") {
                    *saw_mcp_srv.lock().unwrap() = true;
                }
            }
            // Keep the TCP connection alive after the bad proof to detect any late bearer/MCP send.
            let bogus_proof = random_hex(32);
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: 15\r\nX-Loam-Proof: {bogus_proof}\r\nConnection: keep-alive\r\n\r\n{{\"status\":\"ok\"}}"
            );
            let _ = sock.write_all(resp.as_bytes());
            let _ = sock.flush();
            while let Ok(n) = sock.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let text = String::from_utf8_lossy(&buf[..n]);
                if text.to_ascii_lowercase().contains("authorization:") {
                    *saw_auth_srv.lock().unwrap() = true;
                }
                if text.contains("POST /mcp") {
                    *saw_mcp_srv.lock().unwrap() = true;
                }
            }
        }
    });

    let proof_key = random_hex(32);
    let bearer = format!("secret-{}", random_hex(16));
    let outcome = poll_engine_health_blocking(
        port,
        Some(&proof_key),
        Some(&bearer),
        Duration::from_millis(400),
    );
    let _ = handle.join();

    assert_eq!(outcome, ProbeOutcome::PortConflict);
    assert_eq!(probe_error(outcome).code, PLUGIN_PORT_CONFLICT);
    assert!(
        !*saw_auth.lock().unwrap(),
        "port squatter must NEVER receive Authorization header"
    );
    assert!(
        !*saw_mcp.lock().unwrap(),
        "port squatter must NEVER receive /mcp request"
    );
}

fn test_keychain_caps_and_linux_file_fallback() {
    let mut cleanup = ServiceCleanup::new();
    let tmp = TempDir::new().unwrap();
    let data = tmp.path().join("data");
    std::fs::create_dir_all(&data).unwrap();
    let store = PendingInstallStore::new();
    let arch_path = tmp.path().join("kc.loam-plugin");
    std::fs::write(
        &arch_path,
        engine_archive("kc-pack", "kcapp", "0.1.0", "loam-fixture", "v1"),
    )
    .unwrap();

    // 1. KeychainError::TooLong -> PLUGIN_KEY_TOO_LONG with clean rollback.
    let kc_too_long = Arc::new(Mutex::new(MockKeychainState {
        slots: HashMap::new(),
        force_write_error: Some(KeychainError::TooLong),
    }));
    let mut host = PluginHost::new(&data, Some(&data), "test-build-1");
    host.keychain = mock_keychain(kc_too_long, false);
    host.supervisor_exe = Some(supervisor_bin());
    let prop = inspect(&host, &arch_path, &store).unwrap();
    let err = confirm(&host, &prop.proposal_id, &prop.bundle_sha256, false, &store).unwrap_err();
    assert_eq!(err.code, PLUGIN_KEY_TOO_LONG);
    assert!(
        !data
            .join("plugins/kc-pack")
            .join(&prop.bundle_sha256)
            .exists()
    );

    // 2. KeychainError::Unavailable with allow_file_fallback = false -> PLUGIN_KEYCHAIN_UNAVAILABLE.
    let kc_unavail = Arc::new(Mutex::new(MockKeychainState {
        slots: HashMap::new(),
        force_write_error: Some(KeychainError::Unavailable),
    }));
    host.keychain = mock_keychain(kc_unavail.clone(), true);
    let prop = inspect(&host, &arch_path, &store).unwrap();
    let err = confirm(&host, &prop.proposal_id, &prop.bundle_sha256, false, &store).unwrap_err();
    assert_eq!(err.code, PLUGIN_KEYCHAIN_UNAVAILABLE);

    // 3. Same with allow_file_fallback = true -> succeeds, writes bearer ONLY to owner-only mounts.json!
    cleanup.track(&data, Some(&data), "kc-pack");
    let prop = inspect(&host, &arch_path, &store).unwrap();
    let installed = confirm(&host, &prop.proposal_id, &prop.bundle_sha256, true, &store)
        .expect("D166 file fallback succeeds when opted in");
    assert!(installed.has_engine);
    let state_text = std::fs::read_to_string(data.join(desktop_state::FILE)).unwrap();
    let mounts_text = std::fs::read_to_string(data.join("mounts.json")).unwrap();
    let mounts_json: Value = serde_json::from_str(&mounts_text).unwrap();
    let bearer = mounts_json["mounts"][0]["bearer"]
        .as_str()
        .expect("file fallback stores bearer in owner-only mounts.json");
    assert!(
        !state_text.contains(bearer),
        "desktop-state.json must NEVER hold bearer token"
    );
    assert!(state_text.contains("\"fileFallback\": true"));

    // Token rotation works in file-fallback mode too.
    let rot = rotate_token(&host, "kc-pack").expect("rotate in file-fallback mode");
    assert!(rot.rotated && !rot.reload_required);
    let mounts_after: Value =
        serde_json::from_str(&std::fs::read_to_string(data.join("mounts.json")).unwrap()).unwrap();
    let new_bearer = mounts_after["mounts"][0]["bearer"].as_str().unwrap();
    assert_ne!(bearer, new_bearer);

    let un = uninstall(&host, "kc-pack").unwrap();
    assert!(un.uninstalled && un.token_revoked);
}

fn test_engine_install_live_mounts_rotate_upgrade_rollback_uninstall() {
    let mut cleanup = ServiceCleanup::new();
    let tmp = TempDir::new().unwrap();
    let data = tmp.path().join("data");
    std::fs::create_dir_all(&data).unwrap();
    cleanup.track(&data, Some(&data), "mail-sim");

    let kc_state = Arc::new(Mutex::new(MockKeychainState::default()));
    let kc_ops = mock_keychain(kc_state.clone(), false);
    let site_state = SiteState::new(site::Site::Bundled(Box::new(|_| None)));
    let mounts = Arc::new(Mounts::with_keychain_reader(Ok(Vec::new()), {
        let read = kc_ops.read.clone();
        Arc::new(move |svc, acct| read(svc, acct))
    }));
    let mut host = PluginHost::new(&data, Some(&data), "test-build-1");
    host.keychain = kc_ops;
    host.supervisor_exe = Some(supervisor_bin());
    host.live = Some(LiveHost {
        site: &site_state,
        mounts: &mounts,
        bundled_factory: Arc::new(|| Box::new(|_| None)),
        on_inbound_enabled: None,
    });
    let store = PendingInstallStore::new();

    // 1. Install v1 engine bundle.
    let v1_path = tmp.path().join("sim-v1.loam-plugin");
    std::fs::write(
        &v1_path,
        engine_archive("mail-sim", "simapp", "0.1.0", "loam-fixture", "v1"),
    )
    .unwrap();
    let prop1 = inspect(&host, &v1_path, &store).expect("inspect sim v1");
    let inst1 = confirm(
        &host,
        &prop1.proposal_id,
        &prop1.bundle_sha256,
        false,
        &store,
    )
    .expect("confirm sim v1");
    let port = inst1.engine_port.expect("engine port");
    let tok1 = inst1.token_id.clone().expect("tokenId");
    assert!((17400..=17999).contains(&port));
    assert_eq!(kc_state.lock().unwrap().slots.len(), 1);
    let secret1 = kc_state
        .lock()
        .unwrap()
        .slots
        .values()
        .next()
        .unwrap()
        .clone();
    // Secret must never appear in desktop-state.json or mounts.json.
    assert!(
        !std::fs::read_to_string(data.join(desktop_state::FILE))
            .unwrap()
            .contains(&secret1)
    );
    assert!(
        !std::fs::read_to_string(data.join("mounts.json"))
            .unwrap()
            .contains(&secret1)
    );

    // Live `Mounts` can open & send MCP requests to the running engine!
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        let noop_notify: Arc<dyn Fn(u64, Value) + Send + Sync> = Arc::new(|_, _| {});
        let handle = mounts
            .open("simapp", noop_notify.clone())
            .await
            .expect("live mounts open");
        let reply = mounts
            .send(
                handle,
                json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}),
                noop_notify,
            )
            .await
            .expect("live mounts send");
        assert!(reply.to_string().contains("widget-ping"), "reply={reply}");
        mounts.close(handle).await.expect("close handle");
    });

    // Service actions: status, stop, start, restart.
    assert_eq!(
        service_action(&host, "mail-sim", ServiceAction::Status)
            .unwrap()
            .state,
        "running"
    );
    assert_eq!(
        service_action(&host, "mail-sim", ServiceAction::Stop)
            .unwrap()
            .state,
        "stopped"
    );
    assert_eq!(
        service_action(&host, "mail-sim", ServiceAction::Start)
            .unwrap()
            .state,
        "running"
    );
    assert_eq!(
        service_action(&host, "mail-sim", ServiceAction::Restart)
            .unwrap()
            .state,
        "running"
    );

    // 2. Safe token rotation (happy path).
    let rot1 = rotate_token(&host, "mail-sim").expect("rotate token happy path");
    assert!(rot1.rotated && !rot1.reload_required);
    assert_ne!(rot1.token_id, tok1);
    assert_eq!(kc_state.lock().unwrap().slots.len(), 1);

    // 3. Token rotation with failed unpair records pendingRevocations WITHOUT deleting active binary.
    let block_file = data.join("fixture-state/mail-sim/block-unpair");
    std::fs::write(&block_file, "1").unwrap();
    let rot2 = rotate_token(&host, "mail-sim").expect("rotate with blocked unpair");
    assert_ne!(rot2.token_id, rot1.token_id);
    let (_, pending_revs) = list_installed(&host).unwrap();
    assert_eq!(pending_revs.len(), 1);
    assert_eq!(pending_revs[0].token_id, rot1.token_id);
    // Active engine still running!
    assert_eq!(
        service_action(&host, "mail-sim", ServiceAction::Status)
            .unwrap()
            .state,
        "running"
    );
    // Unblock and retry revocation -> clears pendingRevocations AND preserves active bundle!
    std::fs::remove_file(&block_file).unwrap();
    retry_revocation(&host, &rot1.token_id).expect("retry revocation after rotation");
    let (_, pending_revs) = list_installed(&host).unwrap();
    assert!(pending_revs.is_empty());
    assert!(
        data.join("plugins/mail-sim")
            .join(&inst1.bundle_sha256)
            .is_dir(),
        "active bundle must stay intact after retrying rotation revocation"
    );

    // 4. Upgrade v1 -> v2 preserves user-note.txt, reuses port, removes v1 dir.
    let v2_path = tmp.path().join("sim-v2.loam-plugin");
    std::fs::write(
        &v2_path,
        engine_archive("mail-sim", "simapp", "0.2.0", "loam-fixture", "v2"),
    )
    .unwrap();
    let prop2 = inspect(&host, &v2_path, &store).expect("inspect sim v2");
    assert_eq!(prop2.kind, "upgrade");
    let inst2 = confirm(
        &host,
        &prop2.proposal_id,
        &prop2.bundle_sha256,
        false,
        &store,
    )
    .expect("confirm sim v2");
    assert_eq!(inst2.engine_port, Some(port));
    assert!(
        !data
            .join("plugins/mail-sim")
            .join(&inst1.bundle_sha256)
            .exists(),
        "old v1 dir removed after v2 upgrade"
    );
    assert_eq!(
        std::fs::read_to_string(data.join("fixture-state/mail-sim/user-note.txt")).unwrap(),
        "user-data-preserved\n"
    );

    // 5. Upgrade rollback when v3 fails MCP probe: restores v2 and untouched keychain slot!
    let v3_path = tmp.path().join("sim-v3-bad.loam-plugin");
    std::fs::write(
        &v3_path,
        engine_archive("mail-sim", "simapp", "0.3.0", "loam-fixture-badprobe", "v3"),
    )
    .unwrap();
    host.health_timeout = Duration::from_secs(2);
    let prop3 = inspect(&host, &v3_path, &store).expect("inspect v3 badprobe");
    let err3 = confirm(
        &host,
        &prop3.proposal_id,
        &prop3.bundle_sha256,
        false,
        &store,
    )
    .unwrap_err();
    assert_eq!(err3.code, PLUGIN_HEALTH_TIMEOUT);
    host.health_timeout = Duration::from_secs(10);
    assert!(
        !data
            .join("plugins/mail-sim")
            .join(&prop3.bundle_sha256)
            .exists(),
        "failed v3 dir removed on rollback"
    );
    assert_eq!(
        service_action(&host, "mail-sim", ServiceAction::Status)
            .unwrap()
            .state,
        "running",
        "previous v2 service must be restored after upgrade rollback"
    );

    // 6. Uninstall with failed unpair records pendingRevocations and keeps binary until retry succeeds.
    std::fs::write(&block_file, "1").unwrap();
    let un = uninstall(&host, "mail-sim").expect("uninstall with blocked unpair");
    assert!(un.uninstalled && un.data_preserved && !un.token_revoked);
    assert!(
        data.join("plugins/mail-sim")
            .join(&inst2.bundle_sha256)
            .is_dir(),
        "binary kept until pending revocation completes"
    );
    let (listed, pending_revs) = list_installed(&host).unwrap();
    assert!(listed.is_empty());
    assert_eq!(pending_revs.len(), 1);

    std::fs::remove_file(&block_file).unwrap();
    retry_revocation(&host, &pending_revs[0].token_id).expect("retry revocation after uninstall");
    assert!(
        !data.join("plugins/mail-sim").exists(),
        "plugin dir removed once last pending revocation succeeds"
    );
    assert!(
        data.join("fixture-state/mail-sim/user-note.txt").is_file(),
        "user data directory preserved across uninstall and revocation cleanup"
    );
}

fn test_multi_profile_isolation() {
    let mut cleanup = ServiceCleanup::new();
    let tmp = TempDir::new().unwrap();
    let data_a = tmp.path().join("profile-a");
    let data_b = tmp.path().join("profile-b");
    std::fs::create_dir_all(&data_a).unwrap();
    std::fs::create_dir_all(&data_b).unwrap();
    cleanup.track(&data_a, Some(&data_a), "iso-pack");
    cleanup.track(&data_b, Some(&data_b), "iso-pack");

    let kc_state = Arc::new(Mutex::new(MockKeychainState::default()));
    let mut host_a = PluginHost::new(&data_a, Some(&data_a), "test-build-1");
    host_a.keychain = mock_keychain(kc_state.clone(), false);
    host_a.supervisor_exe = Some(supervisor_bin());
    let mut host_b = PluginHost::new(&data_b, Some(&data_b), "test-build-1");
    host_b.keychain = mock_keychain(kc_state.clone(), false);
    host_b.supervisor_exe = Some(supervisor_bin());

    let arch_path = tmp.path().join("iso.loam-plugin");
    std::fs::write(
        &arch_path,
        engine_archive("iso-pack", "isoapp", "0.1.0", "loam-fixture", "v1"),
    )
    .unwrap();
    let store_a = PendingInstallStore::new();
    let store_b = PendingInstallStore::new();

    let pa = inspect(&host_a, &arch_path, &store_a).unwrap();
    let ia = confirm(&host_a, &pa.proposal_id, &pa.bundle_sha256, false, &store_a).unwrap();
    let pb = inspect(&host_b, &arch_path, &store_b).unwrap();
    let ib = confirm(&host_b, &pb.proposal_id, &pb.bundle_sha256, false, &store_b).unwrap();

    assert_ne!(
        ia.engine_port, ib.engine_port,
        "profiles must get distinct free ports"
    );
    assert_eq!(kc_state.lock().unwrap().slots.len(), 2);

    uninstall(&host_a, "iso-pack").unwrap();
    assert_eq!(
        service_action(&host_b, "iso-pack", ServiceAction::Status)
            .unwrap()
            .state,
        "running",
        "uninstalling profile A must not disturb profile B"
    );
    uninstall(&host_b, "iso-pack").unwrap();
}

fn test_cli_plugin_subcommands() {
    let tmp = TempDir::new().unwrap();
    let data = tmp.path().join("cli-data");
    std::fs::create_dir_all(&data).unwrap();
    let arch_v1 = tmp.path().join("cli-v1.loam-plugin");
    let arch_v2 = tmp.path().join("cli-v2.loam-plugin");
    std::fs::write(
        &arch_v1,
        pure_app_archive("cli-pack", "cliapp", "0.1.0", "v1"),
    )
    .unwrap();
    std::fs::write(
        &arch_v2,
        pure_app_archive("cli-pack", "cliapp", "0.2.0", "v2"),
    )
    .unwrap();

    let run_cli = |args: &[&str]| -> (i32, Value) {
        let output = Command::new(supervisor_bin())
            .args(args)
            .env("LOAM_DESKTOP_DATA_DIR", &data)
            .stdin(Stdio::null())
            .output()
            .expect("spawn loam-desktop plugin");
        let code = output.status.code().unwrap_or(-1);
        let text = String::from_utf8_lossy(&output.stdout);
        let parsed: Value = serde_json::from_str(&text).unwrap_or_else(|e| {
            panic!(
                "invalid JSON stdout ({e}): stdout={text} stderr={}",
                String::from_utf8_lossy(&output.stderr)
            )
        });
        (code, parsed)
    };

    let (code, inspected) = run_cli(&["plugin", "inspect", arch_v1.to_str().unwrap(), "--json"]);
    assert_eq!(code, 0);
    assert_eq!(inspected["ok"], true);
    assert_eq!(inspected["data"]["pluginId"], "cli-pack");

    // Non-TTY install without --yes refuses cleanly.
    let (code_no_yes, err_no_yes) =
        run_cli(&["plugin", "install", arch_v1.to_str().unwrap(), "--json"]);
    assert_ne!(code_no_yes, 0);
    assert_eq!(err_no_yes["ok"], false);
    assert!(err_no_yes["error"]["code"].is_string());

    let (code, installed) = run_cli(&[
        "plugin",
        "install",
        arch_v1.to_str().unwrap(),
        "--yes",
        "--json",
    ]);
    assert_eq!(code, 0);
    assert_eq!(installed["ok"], true);
    assert_eq!(installed["data"]["version"], "0.1.0");

    let (code, listed) = run_cli(&["plugin", "list", "--json"]);
    assert_eq!(code, 0);
    assert_eq!(listed["ok"], true);
    assert_eq!(listed["data"]["plugins"].as_array().unwrap().len(), 1);

    let (code, upgraded) = run_cli(&[
        "plugin",
        "upgrade",
        arch_v2.to_str().unwrap(),
        "--yes",
        "--json",
    ]);
    assert_eq!(code, 0);
    assert_eq!(upgraded["ok"], true);
    assert_eq!(upgraded["data"]["version"], "0.2.0");

    let (code, removed) = run_cli(&["plugin", "uninstall", "cli-pack", "--yes", "--json"]);
    assert_eq!(code, 0);
    assert_eq!(removed["ok"], true);
    assert_eq!(removed["data"]["uninstalled"], true);

    // Unknown flag exits 2.
    let unknown_status = Command::new(supervisor_bin())
        .args(["plugin", "list", "--bogus-flag"])
        .env("LOAM_DESKTOP_DATA_DIR", &data)
        .stdin(Stdio::null())
        .status()
        .expect("spawn unknown flag");
    assert_eq!(unknown_status.code(), Some(2));
}

fn test_packed_app_refusals_sse_probe_and_logon_profile() {
    // 1. Packed app manifest refusals matching `readManifest` (`view.handlers` must be `.html`/`.htm`,
    //    `plugin.domains` cannot name reserved shell domains, `plugin.version` is required semver).
    let bad_view_handlers = json!({
        "manifest_version": 1,
        "protocol": 1,
        "plugin": {
            "id": "badview",
            "title": "Bad View",
            "version": "0.1.0",
            "description": "View with .js handlers.",
            "kind": "view",
            "domains": ["badview"]
        },
        "view": { "handlers": "dist/handlers.js" }
    });
    assert!(
        loam_desktop::plugin_validate::parse_packed_app_manifest(
            &serde_json::to_vec(&bad_view_handlers).unwrap()
        )
        .is_err(),
        "view.handlers ending in .js must be refused"
    );

    let reserved_domain = json!({
        "manifest_version": 1,
        "protocol": 1,
        "plugin": {
            "id": "goodapp",
            "title": "Good App",
            "version": "0.1.0",
            "description": "Reserved domain.",
            "kind": "mounted",
            "domains": ["copilot"]
        },
        "mount": { "prefix": "copilot", "transport": "http" }
    });
    assert!(
        loam_desktop::plugin_validate::parse_packed_app_manifest(
            &serde_json::to_vec(&reserved_domain).unwrap()
        )
        .is_err(),
        "reserved shell domain must be refused"
    );

    // 2. Unauthenticated MCP probe accepts bounded SSE (`text/event-stream`) initialize response.
    let sse_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let sse_port = sse_listener.local_addr().unwrap().port();
    let sse_thread = std::thread::spawn(move || {
        use std::io::Read as _;
        if let Ok((mut sock, _)) = sse_listener.accept() {
            let mut req_buf = [0u8; 4096];
            let _ = sock.read(&mut req_buf);
            let sse_body = concat!(
                "event: message\n",
                "data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2026-07-28\",\"capabilities\":{}}}\n\n"
            );
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                sse_body.len(),
                sse_body
            );
            let _ = sock.write_all(resp.as_bytes());
        }
    });
    let sse_outcome = poll_engine_health_blocking(sse_port, None, None, Duration::from_secs(2));
    let _ = sse_thread.join();
    assert_eq!(sse_outcome, ProbeOutcome::Ok);

    // 3. Logon launch `engine-run <id> --data-dir <custom>` with LOAM_DESKTOP_DATA_DIR UNSET
    //    derives the custom profile's service identity and stops cleanly via `signal_stop`.
    let tmp = TempDir::new().unwrap();
    let custom_data = tmp.path().join("custom-logon-profile");
    let sha = "b".repeat(64);
    let target = Target::current().unwrap();
    let bin_name = if target.is_windows() {
        "loam-fixture.exe"
    } else {
        "loam-fixture"
    };
    let plugin_dir = custom_data.join("plugins/logon-sim");
    loam_desktop::plugin_archive::create_owner_only_dir(&plugin_dir).unwrap();
    let bin_path = plugin_dir
        .join(&sha)
        .join("engines")
        .join(target.as_str())
        .join(bin_name);
    std::fs::create_dir_all(bin_path.parent().unwrap()).unwrap();
    std::fs::copy(std::env::current_exe().unwrap(), &bin_path).unwrap();
    let port =
        loam_desktop::plugins_engine::allocate_port(&desktop_state::DesktopState::fresh(), None)
            .unwrap();
    let desc = service::LaunchDescriptor {
        plugin_id: "logon-sim".to_owned(),
        bundle_sha256: sha,
        binary_path: bin_path,
        port,
    };
    service::write_launch_descriptor(&custom_data, &desc, false).unwrap();

    let mut child = Command::new(supervisor_bin())
        .args(["engine-run", "logon-sim", "--data-dir"])
        .arg(&custom_data)
        .env_remove("LOAM_DESKTOP_DATA_DIR")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn logon engine-run without LOAM_DESKTOP_DATA_DIR");
    let health = poll_engine_health_blocking(port, None, None, Duration::from_secs(5));
    assert_eq!(health, ProbeOutcome::Ok);
    loam_desktop::engine_run::signal_stop(&custom_data, "logon-sim", Some(&custom_data), false)
        .expect("signal_stop must match custom profile derived from --data-dir");
    let status = child.wait().expect("engine-run exited");
    assert!(status.success());
}
