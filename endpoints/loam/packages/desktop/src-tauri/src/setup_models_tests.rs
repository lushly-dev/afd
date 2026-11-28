//! Unit tests for `setup_models.rs` (P5-S9-5: no-terminal model key setup, unread `/models` body
//! discard, 401 non-overwrite, destination rebinding guard, Linux D166 file fallback, Windows
//! 2,560-byte cap, and `cli` mode coexistence).
use super::*;
use crate::connection::write_owner_only;
use crate::desktop_state;
use crate::keychain::KeychainError;
use crate::models::{self, Kind};
use crate::plugins::KeychainOps;
use crate::setup_error::{
    COPILOT_KEY_INVALID, COPILOT_KEY_REBIND_REQUIRED, COPILOT_KEY_TOO_LONG,
    COPILOT_KEYCHAIN_UNAVAILABLE, DEPLOYMENT_COPILOT_INVALID, MODEL_REFUSED, MODEL_UNREACHABLE,
};
use bytes::Bytes;
use http_body_util::Full;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;

type FakeStore = Arc<Mutex<HashMap<(String, String), String>>>;

fn fake_keychain(
    store: FakeStore,
    unavailable: bool,
    too_long: bool,
    allows_file_fallback: bool,
) -> KeychainOps {
    let r = store.clone();
    let w = store.clone();
    let d = store;
    KeychainOps {
        read: Arc::new(move |svc, acct| {
            if unavailable {
                return None;
            }
            r.lock()
                .unwrap()
                .get(&(svc.to_owned(), acct.to_owned()))
                .cloned()
        }),
        write: Arc::new(move |svc, acct, val| {
            if too_long {
                return Err(KeychainError::TooLong);
            }
            if unavailable {
                return Err(KeychainError::Unavailable);
            }
            w.lock()
                .unwrap()
                .insert((svc.to_owned(), acct.to_owned()), val.to_owned());
            Ok(())
        }),
        delete: Arc::new(move |svc, acct| {
            if unavailable {
                return Err(KeychainError::Unavailable);
            }
            d.lock().unwrap().remove(&(svc.to_owned(), acct.to_owned()));
            Ok(())
        }),
        allows_file_fallback,
    }
}

async fn spawn_mock_models_server(
    status: StatusCode,
    body: &'static str,
) -> (String, Arc<Mutex<Vec<(String, Option<String>)>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let seen_clone = seen.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let seen_req = seen_clone.clone();
            tokio::spawn(async move {
                let svc = service_fn(move |req: hyper::Request<hyper::body::Incoming>| {
                    let path = req
                        .uri()
                        .path_and_query()
                        .map(|pq| pq.as_str().to_owned())
                        .unwrap_or_default();
                    let auth = req
                        .headers()
                        .get("authorization")
                        .or_else(|| req.headers().get("x-api-key"))
                        .and_then(|v| v.to_str().ok())
                        .map(str::to_owned);
                    seen_req.lock().unwrap().push((path, auth));
                    async move {
                        Ok::<_, std::convert::Infallible>(
                            Response::builder()
                                .status(status)
                                .body(Full::new(Bytes::from_static(body.as_bytes())))
                                .unwrap(),
                        )
                    }
                });
                let _ = http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), svc)
                    .await;
            });
        }
    });
    (format!("http://127.0.0.1:{port}"), seen)
}

fn base_save(id: &str, kind: Kind, model: &str) -> ModelSaveInput {
    ModelSaveInput {
        id: id.into(),
        kind: Some(kind),
        model: Some(model.into()),
        endpoint: None,
        set_default: Some(true),
        api_key: None,
        skip_verify: None,
        confirm_rebind_key: None,
        allow_file_fallback: None,
    }
}

#[tokio::test]
async fn p5_s9_5_anthropic_save_verify_and_key_only_update_preserve_working_key_on_401() {
    let data = tempfile::tempdir().unwrap();
    let store: FakeStore = Arc::default();
    let (ok_url, ok_seen) =
        spawn_mock_models_server(StatusCode::OK, r#"{"data":[{"id":"claude-secret-body"}]}"#).await;

    let mut host = ModelHost::new(data.path(), Some(data.path()), "build-1");
    host.keychain = fake_keychain(store.clone(), false, false, false);
    host.verify_urls.anthropic = Some(format!("{ok_url}/v1/models?limit=1"));

    let mut input = base_save("claude", Kind::Anthropic, "claude-sonnet-4-5");
    input.api_key = Some("sk-ant-valid-key-12345".into());
    let saved = save_model(&host, input).await.unwrap();
    assert!(saved.saved && saved.checked && saved.reload_required);
    assert_eq!(saved.answered, Some(200));

    let calls = ok_seen.lock().unwrap().clone();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "/v1/models?limit=1");
    assert_eq!(calls[0].1.as_deref(), Some("sk-ant-valid-key-12345"));

    // Sanitized listing never leaks any secret value.
    let listed = list_models(&host).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, "claude");
    assert_eq!(listed[0].key_status, "configured");
    assert!(listed[0].default);
    assert!(!serde_json::to_string(&listed).unwrap().contains("sk-ant-"));
    assert!(
        !std::fs::read_to_string(data.path().join("models.json"))
            .unwrap()
            .contains("sk-ant-")
    );

    // 401 refusal discards error body unread and MUST NOT overwrite the existing working key.
    let (bad_url, _) = spawn_mock_models_server(
        StatusCode::UNAUTHORIZED,
        r#"{"error":"SENSITIVE_PROVIDER_BODY_NEVER_EXPOSED"}"#,
    )
    .await;
    host.verify_urls.anthropic = Some(format!("{bad_url}/v1/models?limit=1"));
    let mut bad = base_save("claude", Kind::Anthropic, "claude-sonnet-4-5");
    bad.api_key = Some("sk-ant-wrong-key-99999".into());
    let err = save_model(&host, bad).await.unwrap_err();
    assert_eq!(err.code, MODEL_REFUSED);
    assert!(!err.suggestion.contains("SENSITIVE_PROVIDER_BODY"));
    let svc = host.copilot_keychain_service();
    assert_eq!(
        store.lock().unwrap().get(&(svc.clone(), "claude".into())),
        Some(&"sk-ant-valid-key-12345".to_owned())
    );

    // Key-only update on unchanged destination returns `reloadRequired: false`.
    host.verify_urls.anthropic = Some(format!("{ok_url}/v1/models?limit=1"));
    let mut rotate = base_save("claude", Kind::Anthropic, "claude-sonnet-4-5");
    rotate.api_key = Some("sk-ant-rotated-key-67890".into());
    let rotated = save_model(&host, rotate).await.unwrap();
    assert!(rotated.saved && rotated.checked && !rotated.reload_required);
    assert_eq!(
        store.lock().unwrap().get(&(svc, "claude".into())),
        Some(&"sk-ant-rotated-key-67890".to_owned())
    );
}

#[tokio::test]
async fn p5_s9_5_destination_change_refuses_silent_key_rebind_until_confirmed() {
    let data = tempfile::tempdir().unwrap();
    let store: FakeStore = Arc::default();
    let (ok_url, _) = spawn_mock_models_server(StatusCode::OK, "{}").await;

    let mut host = ModelHost::new(data.path(), Some(data.path()), "build-1");
    host.keychain = fake_keychain(store.clone(), false, false, false);
    host.verify_urls.anthropic = Some(format!("{ok_url}/v1/models?limit=1"));
    host.verify_urls.openai = Some(format!("{ok_url}/v1/models"));

    let mut initial = base_save("main", Kind::Anthropic, "claude-sonnet-4-5");
    initial.api_key = Some("sk-initial-key-123456".into());
    save_model(&host, initial).await.unwrap();

    // Changing kind from Anthropic -> OpenAI without a new key refuses silent rebinding.
    let rebind_attempt = base_save("main", Kind::Openai, "gpt-4.1");
    let err = save_model(&host, rebind_attempt).await.unwrap_err();
    assert_eq!(err.code, COPILOT_KEY_REBIND_REQUIRED);

    // Explicit `confirmRebindKey: true` verifies stored key against the new destination and saves.
    let mut confirmed = base_save("main", Kind::Openai, "gpt-4.1");
    confirmed.confirm_rebind_key = Some(true);
    let res = save_model(&host, confirmed).await.unwrap();
    assert!(res.saved && res.checked && res.reload_required);
}

#[tokio::test]
async fn p5_s9_5_offline_unreachable_skip_verify_and_localhost_rejected() {
    let data = tempfile::tempdir().unwrap();
    let store: FakeStore = Arc::default();
    let mut host = ModelHost::new(data.path(), Some(data.path()), "build-1");
    host.keychain = fake_keychain(store, false, false, false);

    // `http://localhost` is rejected by `endpoint_allowed`.
    let mut bad_ep = base_save("local", Kind::OpenaiCompatible, "llama3.2");
    bad_ep.endpoint = Some("http://localhost:11434/v1".into());
    assert_eq!(
        save_model(&host, bad_ep).await.unwrap_err().code,
        DEPLOYMENT_COPILOT_INVALID
    );

    // Closed loopback port returns `MODEL_UNREACHABLE`.
    let closed_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let dead_port = closed_listener.local_addr().unwrap().port();
    drop(closed_listener);

    let mut unreachable = base_save("local", Kind::OpenaiCompatible, "llama3.2");
    unreachable.endpoint = Some(format!("http://127.0.0.1:{dead_port}/v1"));
    assert_eq!(
        save_model(&host, unreachable.clone())
            .await
            .unwrap_err()
            .code,
        MODEL_UNREACHABLE
    );

    // Retrying with `skipVerify: true` saves offline.
    unreachable.skip_verify = Some(true);
    let offline = save_model(&host, unreachable).await.unwrap();
    assert!(offline.saved && !offline.checked && offline.answered.is_none());
    let listed = list_models(&host).unwrap();
    assert_eq!(listed[0].key_status, "not-required");
}

#[tokio::test]
async fn p5_s9_5_linux_file_fallback_and_windows_too_long_cap_and_remove_default() {
    let data = tempfile::tempdir().unwrap();
    let store: FakeStore = Arc::default();
    let (ok_url, _) = spawn_mock_models_server(StatusCode::OK, "{}").await;

    // 1. Keychain unavailable without opt-in fails closed.
    let mut host = ModelHost::new(data.path(), Some(data.path()), "build-1");
    host.keychain = fake_keychain(store.clone(), true, false, true);
    host.verify_urls.openai = Some(format!("{ok_url}/v1/models"));

    let mut input = base_save("openai", Kind::Openai, "gpt-4.1");
    input.api_key = Some("sk-openai-valid-123456".into());
    assert_eq!(
        save_model(&host, input.clone()).await.unwrap_err().code,
        COPILOT_KEYCHAIN_UNAVAILABLE
    );

    // 2. Explicit `allowFileFallback: true` writes `<data>/keys/openai.key` owner-only.
    input.allow_file_fallback = Some(true);
    let saved = save_model(&host, input).await.unwrap();
    assert!(saved.saved && saved.checked);
    let key_file = model_key_file_path(data.path(), "openai");
    assert!(key_file.is_file());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&key_file).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    // Add a second keyless provider and switch default.
    let mut second = base_save("local", Kind::OpenaiCompatible, "llama3.2");
    second.endpoint = Some(format!("{ok_url}/v1"));
    second.set_default = Some(false);
    save_model(&host, second).await.unwrap();
    let def = set_default_model(&host, &ModelSetDefaultInput { id: "local".into() }).unwrap();
    assert_eq!(def.default, "local");
    assert!(def.reload_required);

    // Remove `openai` with `deleteKey: true` deletes `<data>/keys/openai.key`.
    let removed = remove_model(
        &host,
        &ModelRemoveInput {
            id: "openai".into(),
            delete_key: true,
        },
    )
    .unwrap();
    assert!(removed.removed && removed.reload_required);
    assert!(!key_file.exists());

    // 3. Keychain `TooLong` maps to `COPILOT_KEY_TOO_LONG`.
    host.keychain = fake_keychain(store, false, true, false);
    let mut long_input = base_save("longp", Kind::Openai, "gpt-4.1");
    long_input.api_key = Some("sk-valid-shape-123456".into());
    assert_eq!(
        save_model(&host, long_input).await.unwrap_err().code,
        COPILOT_KEY_TOO_LONG
    );
}

#[tokio::test]
async fn p5_s9_5_cli_mode_coexistence_allows_keychain_only_and_never_touches_cli_files() {
    let data = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(data.path().join("site")).unwrap();
    std::fs::write(data.path().join("site/index.html"), "<!doctype html>").unwrap();
    let models_json = serde_json::json!({
        "providers": [{
            "id": "claude",
            "kind": "anthropic",
            "model": "claude-sonnet-4-5",
            "key": { "keychain": "loam-copilot", "account": "claude" }
        }]
    });
    write_owner_only(
        &data.path().join("models.json"),
        serde_json::to_vec_pretty(&models_json).unwrap().as_slice(),
    )
    .unwrap();

    let store: FakeStore = Arc::default();
    let (ok_url, _) = spawn_mock_models_server(StatusCode::OK, "{}").await;
    let mut host = ModelHost::new(data.path(), Some(data.path()), "build-1");
    host.keychain = fake_keychain(store.clone(), false, false, false);
    host.verify_urls.anthropic = Some(format!("{ok_url}/v1/models?limit=1"));

    // Passing `kind`/`model` in `cli` mode is refused with `DESKTOP_CLI_MANAGED`.
    let mut forbidden = base_save("claude", Kind::Anthropic, "claude-sonnet-4-5");
    forbidden.api_key = Some("sk-cli-key-12345678".into());
    assert_eq!(
        save_model(&host, forbidden).await.unwrap_err().code,
        DESKTOP_CLI_MANAGED
    );

    // Key-only update `{ id, apiKey }` succeeds in `cli` mode with `reloadRequired: false`,
    // without creating `desktop-state.json` or `desktop-state.lock`.
    let key_only = ModelSaveInput {
        id: "claude".into(),
        kind: None,
        model: None,
        endpoint: None,
        set_default: None,
        api_key: Some("sk-cli-key-12345678".into()),
        skip_verify: None,
        confirm_rebind_key: None,
        allow_file_fallback: None,
    };
    let saved = save_model(&host, key_only).await.unwrap();
    assert!(saved.saved && saved.checked && !saved.reload_required);
    assert!(!data.path().join(desktop_state::FILE).exists());
    assert!(!data.path().join(desktop_state::LOCK_FILE).exists());
    assert_eq!(
        store
            .lock()
            .unwrap()
            .get(&("loam-copilot".into(), "claude".into())),
        Some(&"sk-cli-key-12345678".to_owned())
    );

    // Deleting the keychain key in `cli` mode works when `deleteKey: true` and refuses `deleteKey: false`.
    assert_eq!(
        remove_model(
            &host,
            &ModelRemoveInput {
                id: "claude".into(),
                delete_key: false,
            }
        )
        .unwrap_err()
        .code,
        DESKTOP_CLI_MANAGED
    );
    let del = remove_model(
        &host,
        &ModelRemoveInput {
            id: "claude".into(),
            delete_key: true,
        },
    )
    .unwrap();
    assert!(del.removed && !del.reload_required);
    assert!(store.lock().unwrap().is_empty());

    // Invalid key shape refused with `COPILOT_KEY_INVALID`.
    let bad_key = ModelSaveInput {
        id: "claude".into(),
        kind: None,
        model: None,
        endpoint: None,
        set_default: None,
        api_key: Some("short".into()),
        skip_verify: Some(true),
        confirm_rebind_key: None,
        allow_file_fallback: None,
    };
    assert_eq!(
        save_model(&host, bad_key).await.unwrap_err().code,
        COPILOT_KEY_INVALID
    );
    assert_eq!(
        models::read(&data.path().join("models.json"))
            .unwrap()
            .len(),
        1
    );
}

async fn spawn_mock_openai_sse_server() -> (String, Arc<Mutex<Vec<(String, Option<String>)>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let seen_clone = seen.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let seen_req = seen_clone.clone();
            tokio::spawn(async move {
                let svc = service_fn(move |req: hyper::Request<hyper::body::Incoming>| {
                    let path = req
                        .uri()
                        .path_and_query()
                        .map(|pq| pq.as_str().to_owned())
                        .unwrap_or_default();
                    let auth = req
                        .headers()
                        .get("authorization")
                        .and_then(|v| v.to_str().ok())
                        .map(str::to_owned);
                    seen_req.lock().unwrap().push((path.clone(), auth));
                    async move {
                        if path.ends_with("/models") {
                            Ok::<_, std::convert::Infallible>(
                                Response::builder()
                                    .status(StatusCode::OK)
                                    .body(Full::new(Bytes::from_static(br#"{"data":[]}"#)))
                                    .unwrap(),
                            )
                        } else {
                            let sse = concat!(
                                "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n",
                                "data: [DONE]\n\n"
                            );
                            Ok::<_, std::convert::Infallible>(
                                Response::builder()
                                    .status(StatusCode::OK)
                                    .header("content-type", "text/event-stream")
                                    .body(Full::new(Bytes::from_static(sse.as_bytes())))
                                    .unwrap(),
                            )
                        }
                    }
                });
                let _ = http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), svc)
                    .await;
            });
        }
    });
    (format!("http://127.0.0.1:{port}"), seen)
}

#[tokio::test]
async fn p5_s9_5_atomic_destination_key_switch_and_live_models_send() {
    let data = tempfile::tempdir().unwrap();
    let store: FakeStore = Arc::default();
    let (url_a, seen_a) = spawn_mock_openai_sse_server().await;
    let (url_b, seen_b) = spawn_mock_openai_sse_server().await;

    let live_models = Arc::new(models::Models::new(Ok(Vec::new())));
    let live_site = SiteState::new(site::Site::Bundled(Box::new(|_| None)));
    let mut host = ModelHost::new(data.path(), Some(data.path()), "build-atomic");
    host.keychain = fake_keychain(store.clone(), true, false, true);
    host.live = Some(ModelLiveHost {
        site: &live_site,
        models: &live_models,
        bundled_factory: Arc::new(|| Box::new(|_| None)),
        on_inbound_enabled: None,
    });

    // 1. Initial save on endpoint A with key A (file fallback) refreshes live `Models`.
    let mut first = base_save("local", Kind::OpenaiCompatible, "llama3.2");
    first.endpoint = Some(format!("{url_a}/v1"));
    first.api_key = Some("sk-endpoint-a-secret-111".into());
    first.allow_file_fallback = Some(true);
    let saved_a = save_model(&host, first).await.unwrap();
    assert!(saved_a.saved && saved_a.checked && saved_a.reload_required);
    let key_file_a = model_key_file_path(data.path(), "local");
    assert!(key_file_a.is_file());

    // Live `Models::send` immediately succeeds against endpoint A using key A (no restart needed).
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let emit: models::Emit = Arc::new(move |ev| {
        let _ = tx.send(ev);
    });
    live_models
        .send(
            "local",
            serde_json::json!({
                "max_tokens": 16,
                "messages": [{"role": "user", "content": "hello"}]
            }),
            1,
            emit,
        )
        .await
        .unwrap();
    let mut got_done = false;
    while let Some(ev) = tokio::time::timeout(std::time::Duration::from_secs(3), rx.recv())
        .await
        .unwrap()
    {
        if ev.get("done").and_then(|v| v.as_bool()) == Some(true) {
            got_done = true;
            break;
        }
    }
    assert!(got_done, "live Models::send must stream to completion");
    let calls_a = seen_a.lock().unwrap().clone();
    assert!(calls_a.iter().any(|(p, auth)| {
        p.ends_with("/chat/completions")
            && auth.as_deref() == Some("Bearer sk-endpoint-a-secret-111")
    }));

    // 2. Destination + key change writes a fresh versioned key file, updates live `Models`, and
    //    deletes the superseded `local.key` after commit.
    let mut second = base_save("local", Kind::OpenaiCompatible, "llama3.2");
    second.endpoint = Some(format!("{url_b}/v1"));
    second.api_key = Some("sk-endpoint-b-secret-222".into());
    second.allow_file_fallback = Some(true);
    let saved_b = save_model(&host, second).await.unwrap();
    assert!(saved_b.saved && saved_b.checked && saved_b.reload_required);
    assert!(
        !key_file_a.exists(),
        "superseded key file must be removed after commit"
    );
    let providers = models::read(&data.path().join("models.json")).unwrap();
    match providers[0].key.as_ref().unwrap() {
        KeyRef::File(f) => {
            assert_ne!(f.file, key_file_a, "must use fresh versioned key file");
            assert!(f.file.is_file());
        }
        other => panic!("expected KeyRef::File, got {other:?}"),
    }

    // Live `Models::send` immediately routes to endpoint B with key B.
    let (tx2, mut rx2) = tokio::sync::mpsc::unbounded_channel();
    let emit2: models::Emit = Arc::new(move |ev| {
        let _ = tx2.send(ev);
    });
    live_models
        .send(
            "local",
            serde_json::json!({
                "max_tokens": 16,
                "messages": [{"role": "user", "content": "second"}]
            }),
            2,
            emit2,
        )
        .await
        .unwrap();
    while let Some(ev) = tokio::time::timeout(std::time::Duration::from_secs(3), rx2.recv())
        .await
        .unwrap()
    {
        if ev.get("done").and_then(|v| v.as_bool()) == Some(true) {
            break;
        }
    }
    let calls_b = seen_b.lock().unwrap().clone();
    assert!(calls_b.iter().any(|(p, auth)| {
        p.ends_with("/chat/completions")
            && auth.as_deref() == Some("Bearer sk-endpoint-b-secret-222")
    }));

    // 3. Migrating from file fallback back to OS keychain removes the old file key.
    host.keychain = fake_keychain(store.clone(), false, false, false);
    let mut migrate = base_save("local", Kind::OpenaiCompatible, "llama3.2");
    migrate.endpoint = Some(format!("{url_b}/v1"));
    migrate.api_key = Some("sk-migrated-keychain-333".into());
    save_model(&host, migrate).await.unwrap();
    let keys_dir_entries: Vec<_> = std::fs::read_dir(data.path().join("keys"))
        .unwrap()
        .collect();
    assert!(
        keys_dir_entries.is_empty(),
        "migrating back to keychain must delete old key file"
    );

    // 4. Keychain destination change uses a fresh versioned keychain account, and failed commit
    //    rolls back the fresh slot while preserving the old slot intact.
    let svc = host.copilot_keychain_service();
    assert_eq!(
        store.lock().unwrap().get(&(svc.clone(), "local".into())),
        Some(&"sk-migrated-keychain-333".to_owned())
    );
    // Force `materialize::commit` to fail by replacing `models.json` with a non-empty directory.
    let models_path = data.path().join("models.json");
    std::fs::remove_file(&models_path).unwrap();
    std::fs::create_dir_all(models_path.join("blocker")).unwrap();

    let mut failing_switch = base_save("local", Kind::OpenaiCompatible, "llama3.2");
    failing_switch.endpoint = Some(format!("{url_a}/v1"));
    failing_switch.api_key = Some("sk-should-roll-back-444".into());
    assert!(save_model(&host, failing_switch).await.is_err());
    // Old slot is untouched AND no leaked replacement slot remains in keychain.
    let snapshot = store.lock().unwrap().clone();
    assert_eq!(snapshot.len(), 1);
    assert_eq!(
        snapshot.get(&(svc, "local".into())),
        Some(&"sk-migrated-keychain-333".to_owned())
    );
}

#[tokio::test]
async fn p5_s9_5_keyless_kind_change_refused_remove_propagates_delete_error_and_debug_redacts() {
    let data = tempfile::tempdir().unwrap();
    let store: FakeStore = Arc::default();
    let (ok_url, _) = spawn_mock_models_server(StatusCode::OK, "{}").await;

    let mut host = ModelHost::new(data.path(), Some(data.path()), "build-guards");
    host.keychain = fake_keychain(store.clone(), false, false, false);
    host.verify_urls.anthropic = Some(format!("{ok_url}/v1/models?limit=1"));

    // 1. `Debug` on `ModelSaveInput` redacts `api_key`.
    let mut debug_input = base_save("claude", Kind::Anthropic, "claude-sonnet-4-5");
    debug_input.api_key = Some("sk-ant-top-secret-999999".into());
    let formatted = format!("{debug_input:?}");
    assert!(!formatted.contains("sk-ant-top-secret"));
    assert!(formatted.contains("[REDACTED]"));

    // 2. New keyless Anthropic provider with `skipVerify: true` is refused.
    let mut new_keyless = base_save("claude", Kind::Anthropic, "claude-sonnet-4-5");
    new_keyless.skip_verify = Some(true);
    assert_eq!(
        save_model(&host, new_keyless).await.unwrap_err().code,
        COPILOT_KEY_INVALID
    );

    // 3. Keyless `openai-compatible` -> `anthropic` kind change without a key is refused even with `skipVerify: true`.
    let mut local = base_save("m1", Kind::OpenaiCompatible, "llama3.2");
    local.endpoint = Some(format!("{ok_url}/v1"));
    save_model(&host, local).await.unwrap();
    let mut bad_switch = base_save("m1", Kind::Anthropic, "claude-sonnet-4-5");
    bad_switch.skip_verify = Some(true);
    assert_eq!(
        save_model(&host, bad_switch).await.unwrap_err().code,
        COPILOT_KEY_INVALID
    );

    // 4. `remove_model` with `deleteKey: true` propagates keychain delete failure and keeps provider intact.
    let mut keyed = base_save("claude", Kind::Anthropic, "claude-sonnet-4-5");
    keyed.api_key = Some("sk-ant-remove-guard-123".into());
    save_model(&host, keyed).await.unwrap();
    host.keychain = fake_keychain(store, true, false, false);
    let err = remove_model(
        &host,
        &ModelRemoveInput {
            id: "claude".into(),
            delete_key: true,
        },
    )
    .unwrap_err();
    assert_eq!(err.code, COPILOT_KEYCHAIN_UNAVAILABLE);
    let listed = list_models(&host).unwrap();
    assert!(
        listed.iter().any(|p| p.id == "claude"),
        "provider must remain listed when deleteKey fails"
    );
}
