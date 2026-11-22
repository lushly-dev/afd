//! Regression tests for #1448: Tauri's invoke-key refusal in `Webview::on_message` must never write the
//! real expected invoke key (or untrusted received key) to stderr or stdout.
//!
//! 1. `invoke_key_mismatch_never_leaks_key_to_stderr` spawns this test binary in child mode so OS stderr
//!    is captured across a real wrong-key `Webview::on_message` call on Tauri's mock runtime, verifying
//!    that `logging::init()` emits only the fixed redacted refusal line and never the real key.
//! 2. `tauri_gates_invoke_key_eprintln_behind_tracing_feature` pins Tauri's compiled source so a future
//!    Tauri bump that adds another `eprintln!` mentioning the invoke key fails here.
use loam_desktop::logging::{self, REDACTED_INVOKE_KEY_LINE};
use loam_desktop::models::Models;
use loam_desktop::mounts::Mounts;
use loam_desktop::site::shell_origin;
use loam_desktop::{MAIN, handler};
use serde_json::json;
use std::borrow::Cow;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::WebviewWindowBuilder;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{INVOKE_KEY, mock_builder};

const CHILD_ENV: &str = "LOAM_TEST_INVOKE_KEY_CHILD";
const FORGED_KEY: &str = "forged-attacker-payload-1448";

fn empty() -> tauri::http::Response<Cow<'static, [u8]>> {
    tauri::http::Response::new(Cow::Borrowed(&[][..]))
}

fn tauri_source() -> PathBuf {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    let output = Command::new(cargo)
        .args([
            "metadata",
            "--format-version",
            "1",
            "--locked",
            "--manifest-path",
        ])
        .arg(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml"))
        .output()
        .expect("cargo metadata");
    assert!(output.status.success(), "cargo metadata failed");
    let metadata: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let tauri = metadata["packages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|package| package["name"] == "tauri")
        .expect("tauri in the graph");
    PathBuf::from(tauri["manifest_path"].as_str().unwrap())
        .parent()
        .unwrap()
        .join("src")
}

#[test]
fn invoke_key_mismatch_never_leaks_key_to_stderr() {
    if std::env::var_os(CHILD_ENV).is_some() {
        logging::init();
        let app = mock_builder()
            .register_uri_scheme_protocol("loam", |_, _| empty())
            .register_uri_scheme_protocol("loam-sandbox", |_, _| empty())
            .invoke_handler(handler())
            .manage(Arc::new(Mounts::new(Ok(Vec::new()))))
            .manage(Arc::new(Models::new(Ok(Vec::new()))))
            .build(tauri::generate_context!("tauri.conf.json", test = true))
            .expect("a mock app");
        let webview = WebviewWindowBuilder::new(&app, MAIN, Default::default())
            .build()
            .expect("the main webview");
        let mut headers = tauri::http::HeaderMap::new();
        headers.insert("Origin", shell_origin().parse().expect("a header value"));
        let responded = Arc::new(AtomicBool::new(false));
        let flag = responded.clone();
        webview.as_ref().clone().on_message(
            tauri::webview::InvokeRequest {
                cmd: "mount_open".into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: shell_origin().parse().expect("a URL"),
                body: InvokeBody::Json(json!({ "instance": "missing" })),
                headers,
                invoke_key: FORGED_KEY.into(),
            },
            Box::new(move |_, _, _, _, _| {
                flag.store(true, Ordering::SeqCst);
            }),
        );
        assert!(
            !responded.load(Ordering::SeqCst),
            "wrong invoke key must be dropped without responding"
        );
        return;
    }

    let exe = std::env::current_exe().expect("test executable");
    let output = Command::new(exe)
        .args([
            "--exact",
            "invoke_key_mismatch_never_leaks_key_to_stderr",
            "--nocapture",
        ])
        .env(CHILD_ENV, "1")
        .output()
        .expect("spawn child test");
    assert!(
        output.status.success(),
        "child failed: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        !stderr.contains(INVOKE_KEY) && !stdout.contains(INVOKE_KEY),
        "real invoke key leaked! stderr={stderr:?}"
    );
    assert!(
        !stderr.contains(FORGED_KEY),
        "untrusted received key leaked to stderr! stderr={stderr:?}"
    );
    assert!(
        stderr.contains(REDACTED_INVOKE_KEY_LINE),
        "expected redacted refusal line on stderr, got: {stderr:?}"
    );
}

#[test]
fn tauri_gates_invoke_key_eprintln_behind_tracing_feature() {
    let src = tauri_source();
    let webview = std::fs::read_to_string(src.join("webview/mod.rs")).unwrap();
    let start = webview
        .find("if request.invoke_key != expected")
        .expect("Webview::on_message's invoke_key check moved: review it for #1448");
    let end = start
        + webview[start..]
            .find("return;")
            .expect("the invoke_key check's early return");
    let block = &webview[start..end];
    assert!(
        block.contains("#[cfg(feature = \"tracing\")]") && block.contains("tracing::error!"),
        "Tauri no longer routes invoke-key mismatch through tracing::error!: {block}"
    );
    assert!(
        block.contains("#[cfg(not(feature = \"tracing\"))]"),
        "Tauri's invoke-key eprintln! is no longer gated on #[cfg(not(feature = \"tracing\"))]: {block}"
    );
    assert_eq!(
        webview.matches("__TAURI_INVOKE_KEY__ expected").count(),
        2,
        "unexpected additional __TAURI_INVOKE_KEY__ log site in Tauri's webview/mod.rs"
    );
    // Ensure no other file in Tauri prints `__TAURI_INVOKE_KEY__` via eprintln! or println!.
    let mut stack = vec![src.clone()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|ext| ext == "rs")
                && path != src.join("webview/mod.rs")
            {
                let text = std::fs::read_to_string(&path).unwrap();
                assert!(
                    !text.contains("__TAURI_INVOKE_KEY__ expected"),
                    "unexpected __TAURI_INVOKE_KEY__ log site in Tauri: {}",
                    path.display()
                );
            }
        }
    }
}
