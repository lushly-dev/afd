//! The shared nonce store (phase 5 specification, section 10.2; step 3): every process that serves
//! one workspace spends an approval nonce, and relay evidence's `relay:<decisionId>`, in
//! `state/shared/nonces.sqlite3`, so a value spent by one is spent for all, and of concurrent
//! spends across processes exactly one succeeds.
//!
//! The processes here are hosts sealed on one hosted workspace in one test process, each opening the
//! store on its own connection, as `multi_process.rs`'s in-process cases are. Mode `none` keeps
//! AFD's store in memory, as phases 2 to 4 did. Approval tokens never leave
//! a shipped host; the `testkit` seam `with_approval_observer` hands them to the test so that it
//! can present one to a second host.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::json;
use support::{agent, minimal, needs_approval, workspace};
use umbel::{Host, HostBuilder};

/// A hosted workspace (mode `oauth`; nothing here is served over HTTP) whose shared stores wait
/// at most 200 milliseconds for each other.
fn hosted() -> tempfile::TempDir {
    workspace(
        r#"config_version = 5

[principal]
local_id = "corp/ada"

[http]
public_url = "https://umbel.example.com/mcp"
allowed_hosts = ["umbel.example.com"]

[auth]
mode = "oauth"

[auth.namespaces.corp]

[auth.issuers.as]
issuer = "https://as.example.com"
namespace = "corp"

[store]
lock_timeout_ms = 200
"#,
    )
}

/// A host with `fixture-gated` (approval required) whose held approvals' tokens go to `tokens`.
fn gated(dir: &Path, runs: &Arc<AtomicUsize>, tokens: &Arc<Mutex<Vec<String>>>) -> Host {
    let tokens = Arc::clone(tokens);
    HostBuilder::open(dir)
        .unwrap()
        .register(needs_approval("fixture-gated", Arc::clone(runs)))
        .with_approval_observer(move |request| {
            tokens.lock().unwrap().push(request.approval_token);
        })
        .seal()
        .unwrap()
}

/// Hold a call of `fixture-gated` on `host` as `actor`, and return the token minted for it.
async fn hold(host: &Host, actor: &str, tokens: &Arc<Mutex<Vec<String>>>) -> String {
    let held = support::call(host, agent(actor), "fixture-gated", json!({})).await;
    assert_eq!(held.error.unwrap().code, "APPROVAL_REQUIRED");
    tokens.lock().unwrap().pop().expect("a token was minted")
}

/// Present `token` for `actor`'s call on `host`.
async fn approve(host: &Host, actor: &str, token: &str) -> afd::CommandResult<serde_json::Value> {
    let mut context = host.context(agent(actor));
    context.approval = Some(token.to_owned());
    host.registry()
        .execute("fixture-gated", json!({}), Some(context))
        .await
}

fn store(dir: &Path) -> std::path::PathBuf {
    dir.join("state").join("shared").join("nonces.sqlite3")
}

#[tokio::test]
async fn an_approval_spent_by_one_process_is_spent_for_every_process() {
    let dir = hosted();
    let runs = Arc::new(AtomicUsize::new(0));
    let tokens = Arc::new(Mutex::new(Vec::new()));
    let first = gated(dir.path(), &runs, &tokens);
    let second = gated(dir.path(), &runs, &tokens);
    // Nothing spent yet: the store is opened on first use.
    let token = hold(&first, "ada", &tokens).await;
    assert!(!store(dir.path()).exists());

    let ran = approve(&first, "ada", &token).await;
    assert!(ran.success, "{:?}", ran.error);
    assert_eq!(runs.load(Ordering::SeqCst), 1);
    // The second process shares the workspace's approval key, so the token verifies there; its
    // nonce is spent, so it is refused and nothing runs.
    let replayed = approve(&second, "ada", &token).await;
    assert!(!replayed.success);
    assert_eq!(replayed.error.unwrap().code, "APPROVAL_REQUIRED");
    assert_eq!(runs.load(Ordering::SeqCst), 1);
    // A token the first process minted and nobody spent is good on the second.
    let fresh = hold(&first, "ada", &tokens).await;
    let ran = approve(&second, "ada", &fresh).await;
    assert!(ran.success, "{:?}", ran.error);
    assert_eq!(runs.load(Ordering::SeqCst), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_spends_across_processes_run_the_call_exactly_once() {
    let dir = hosted();
    let runs = Arc::new(AtomicUsize::new(0));
    let tokens = Arc::new(Mutex::new(Vec::new()));
    let hosts: Vec<Arc<Host>> = (0..4)
        .map(|_| Arc::new(gated(dir.path(), &runs, &tokens)))
        .collect();
    for round in 1..=3 {
        let token = hold(&hosts[0], "ada", &tokens).await;
        let barrier = Arc::new(tokio::sync::Barrier::new(16));
        let attempts: Vec<_> = (0..16)
            .map(|n| {
                let host = Arc::clone(&hosts[n % hosts.len()]);
                let token = token.clone();
                let barrier = Arc::clone(&barrier);
                tokio::spawn(async move {
                    barrier.wait().await;
                    approve(&host, "ada", &token).await.success
                })
            })
            .collect();
        let mut succeeded = 0;
        for attempt in attempts {
            if attempt.await.unwrap() {
                succeeded += 1;
            }
        }
        assert_eq!(succeeded, 1, "round {round}");
        assert_eq!(runs.load(Ordering::SeqCst), round);
    }
}

#[tokio::test]
async fn the_store_is_private_and_holds_no_token() {
    let dir = hosted();
    let runs = Arc::new(AtomicUsize::new(0));
    let tokens = Arc::new(Mutex::new(Vec::new()));
    let host = gated(dir.path(), &runs, &tokens);
    let token = hold(&host, "ada", &tokens).await;
    assert!(approve(&host, "ada", &token).await.success);
    let path = store(dir.path());
    assert!(path.exists());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(path.parent().unwrap()), 0o700);
    }
    // Neither the token nor the caller is written: only the nonce and two times.
    for file in std::fs::read_dir(path.parent().unwrap()).unwrap() {
        let bytes = std::fs::read(file.unwrap().path()).unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(!text.contains(&token), "the token is stored");
        assert!(!text.contains("ada"), "the caller is stored");
    }
}

#[tokio::test]
async fn a_store_that_cannot_answer_refuses_the_approval_as_the_stores_failure() {
    let dir = hosted();
    let runs = Arc::new(AtomicUsize::new(0));
    let tokens = Arc::new(Mutex::new(Vec::new()));
    let host = gated(dir.path(), &runs, &tokens);
    // Held past store.lock_timeout_ms by another process: WORKSPACE_SHARED_TIMEOUT, retryable,
    // naming the store; the token is not spent, so it works once the store is free.
    let token = hold(&host, "ada", &tokens).await;
    let warm = hold(&host, "ada", &tokens).await;
    assert!(approve(&host, "ada", &warm).await.success);
    let holder = rusqlite::Connection::open(store(dir.path())).unwrap();
    holder.execute_batch("BEGIN IMMEDIATE").unwrap();
    let busy = approve(&host, "ada", &token).await.error.unwrap();
    assert_eq!(busy.code, "WORKSPACE_SHARED_TIMEOUT");
    assert_eq!(busy.retryable, Some(true));
    assert_eq!(busy.details.unwrap()["store"], json!("nonces"));
    holder.execute_batch("ROLLBACK").unwrap();
    assert!(approve(&host, "ada", &token).await.success);
    assert_eq!(runs.load(Ordering::SeqCst), 2);

    // A store that cannot be created at all: INTERNAL_ERROR, retryable; nothing runs.
    let dir = hosted();
    let host = gated(dir.path(), &runs, &tokens);
    let token = hold(&host, "ada", &tokens).await;
    // (The read limit, which the library caller meets, already made state/shared.)
    let shared = dir.path().join("state").join("shared");
    let _ = std::fs::remove_dir_all(&shared);
    std::fs::write(&shared, b"not a directory").unwrap();
    let refused = approve(&host, "ada", &token).await.error.unwrap();
    assert_eq!(refused.code, "INTERNAL_ERROR");
    assert_eq!(refused.retryable, Some(true));
    assert_eq!(runs.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn mode_none_and_the_operator_never_depend_on_the_shared_stores() {
    // Mode none: approvals keep AFD's store in memory, so an unusable state/shared changes
    // nothing.
    let dir = minimal();
    let shared = dir.path().join("state").join("shared");
    std::fs::create_dir_all(shared.parent().unwrap()).unwrap();
    std::fs::write(&shared, b"not a directory").unwrap();
    let runs = Arc::new(AtomicUsize::new(0));
    let tokens = Arc::new(Mutex::new(Vec::new()));
    let host = gated(dir.path(), &runs, &tokens);
    let token = hold(&host, "ada", &tokens).await;
    assert!(approve(&host, "ada", &token).await.success);
    // A hosted workspace whose state/shared is unusable still seals, and the operator's CLI,
    // which no limit applies to, runs.
    let dir = hosted();
    let shared = dir.path().join("state").join("shared");
    std::fs::create_dir_all(shared.parent().unwrap()).unwrap();
    std::fs::write(&shared, b"not a directory").unwrap();
    let run = support::cli(dir.path(), &["call", "workspace-show"]).await;
    assert_eq!(run.code, 0, "{}", run.stdout);
}
