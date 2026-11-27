use super::proof::encode_hex;
use super::tests::restrict;
use super::*;
use serde_json::json;
use sha2::Sha256;

#[test]
fn p5_s9_3_mounts_json_validates_bearer_keychain_and_proof_key() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("mounts.json");
    let valid_proof = "ab".repeat(32);

    for good in [
        // Managed desktop: `bearer_keychain` + `proof_key` on loopback IPv4.
        json!({
            "mounts": [{
                "instance": "mail",
                "url": "http://127.0.0.1:17400/mcp",
                "bearer_keychain": { "keychain": "loam-plugin-mount", "account": "mail.tok_1" },
                "proof_key": valid_proof,
            }],
            "inbound": true,
        }),
        // Loopback IPv6 is also accepted.
        json!({
            "mounts": [{
                "instance": "mail",
                "url": "http://[::1]:17400/mcp",
                "bearer_keychain": { "keychain": "loam-plugin-mount-01234567", "account": "mail.tok_1" },
                "proof_key": valid_proof,
            }],
        }),
        // Linux file fallback (D166): plaintext `bearer` + `proof_key`.
        json!({
            "mounts": [{
                "instance": "mail",
                "url": "http://127.0.0.1:17400/mcp",
                "bearer": "sk-linux-fallback-01234567",
                "proof_key": valid_proof,
            }],
        }),
        // `proof_key` without a bearer.
        json!({
            "mounts": [{
                "instance": "local",
                "url": "http://127.0.0.1:17401/mcp",
                "proof_key": valid_proof,
            }],
        }),
    ] {
        std::fs::write(&path, good.to_string()).unwrap();
        restrict(&path);
        assert!(read_deployed(&path).is_ok(), "should accept {good}");
    }

    for bad in [
        // `bearer` and `bearer_keychain` are mutually exclusive.
        json!({
            "mounts": [{
                "instance": "mail",
                "url": "http://127.0.0.1:17400/mcp",
                "bearer": "sk-plain-01234567",
                "bearer_keychain": { "keychain": "loam-plugin-mount", "account": "mail.tok_1" },
                "proof_key": valid_proof,
            }],
        }),
        // Every `bearer_keychain` entry requires a loopback `proof_key` (never resolve a
        // keychain bearer for an unverified endpoint).
        json!({
            "mounts": [{
                "instance": "remote",
                "url": "https://example.com/mcp",
                "bearer_keychain": { "keychain": "loam-plugin-mount", "account": "remote.tok_1" },
            }],
        }),
        json!({
            "mounts": [{
                "instance": "mail",
                "url": "http://127.0.0.1:17400/mcp",
                "bearer_keychain": { "keychain": "loam-plugin-mount", "account": "mail.tok_1" },
            }],
        }),
        // Invalid keychain service or account name.
        json!({
            "mounts": [{
                "instance": "mail",
                "url": "http://127.0.0.1:17400/mcp",
                "bearer_keychain": { "keychain": "../bad", "account": "mail.tok_1" },
            }],
        }),
        json!({
            "mounts": [{
                "instance": "mail",
                "url": "http://127.0.0.1:17400/mcp",
                "bearer_keychain": { "keychain": "loam-plugin-mount", "account": "has space" },
            }],
        }),
        json!({
            "mounts": [{
                "instance": "mail",
                "url": "http://127.0.0.1:17400/mcp",
                "bearer_keychain": { "keychain": "loam-plugin-mount", "account": "mail.tok_1", "extra": 1 },
            }],
        }),
        // Invalid `proof_key`: wrong length, uppercase hex, non-hex.
        json!({
            "mounts": [{
                "instance": "mail",
                "url": "http://127.0.0.1:17400/mcp",
                "proof_key": "a".repeat(63),
            }],
        }),
        json!({
            "mounts": [{
                "instance": "mail",
                "url": "http://127.0.0.1:17400/mcp",
                "proof_key": "A".repeat(64),
            }],
        }),
        json!({
            "mounts": [{
                "instance": "mail",
                "url": "http://127.0.0.1:17400/mcp",
                "proof_key": format!("{}g", "a".repeat(63)),
            }],
        }),
        // `proof_key` requires a loopback `http://127.0.0.1:<port>` or `http://[::1]:<port>` URL
        // with explicit port and no credentials, query, or fragment.
        json!({
            "mounts": [{
                "instance": "mail",
                "url": "https://127.0.0.1:17400/mcp",
                "proof_key": valid_proof,
            }],
        }),
        json!({
            "mounts": [{
                "instance": "mail",
                "url": "http://localhost:17400/mcp",
                "proof_key": valid_proof,
            }],
        }),
        json!({
            "mounts": [{
                "instance": "mail",
                "url": "http://example.com:17400/mcp",
                "proof_key": valid_proof,
            }],
        }),
        json!({
            "mounts": [{
                "instance": "mail",
                "url": "http://127.0.0.1/mcp",
                "proof_key": valid_proof,
            }],
        }),
        json!({
            "mounts": [{
                "instance": "mail",
                "url": "http://user:pass@127.0.0.1:17400/mcp",
                "proof_key": valid_proof,
            }],
        }),
        json!({
            "mounts": [{
                "instance": "mail",
                "url": "http://127.0.0.1:17400/mcp?x=1",
                "proof_key": valid_proof,
            }],
        }),
    ] {
        std::fs::write(&path, bad.to_string()).unwrap();
        restrict(&path);
        assert_eq!(read_deployed(&path).err(), Some(MOUNTS_INVALID), "{bad}");
    }
}

#[test]
fn p5_s9_6_mounts_rs_parses_materializer_golden_fixture_mounts_json() {
    use crate::desktop_state::{Copilot, DesktopState, EngineState, InstalledPlugin, Workspace};
    use crate::js_json::{self, Json};
    use crate::materialize::{MOUNT_KEYCHAIN, Profile, project};
    use sha2::Digest;

    let golden_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../manifest/test/fixtures/desktop-projection-golden.json");
    let golden = Json::parse(&std::fs::read(golden_path).unwrap()).unwrap();
    let data = tempfile::tempdir().unwrap();
    let write_file = |path: &Path, bytes: &[u8]| {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    };
    let bundle_of = |plugin: &str| encode_hex(&Sha256::digest(plugin.as_bytes()));
    let proof_key = "ab".repeat(32);

    let Some(Json::Arr(apps)) = golden.get("apps") else {
        panic!("golden fixture apps")
    };
    let mut by_plugin: Vec<(String, Vec<&Json>)> = Vec::new();
    for app in apps {
        let plugin = app.get("plugin").unwrap().as_str().unwrap().to_owned();
        match by_plugin.iter_mut().find(|(id, _)| *id == plugin) {
            Some((_, list)) => list.push(app),
            None => by_plugin.push((plugin, vec![app])),
        }
    }
    let mut plugins = Vec::new();
    for (plugin, members) in &by_plugin {
        let root = data
            .path()
            .join("plugins")
            .join(plugin)
            .join(bundle_of(plugin));
        let mut manifest = vec![
            ("plugin_manifest_version".to_owned(), Json::Int(1)),
            (
                "plugin".to_owned(),
                Json::obj([
                    ("id", Json::str(plugin)),
                    ("title", Json::str("A plugin")),
                    ("version", Json::str("0.1.0")),
                    ("description", Json::str("Golden test plugin.")),
                ]),
            ),
        ];
        let mut app_refs = Vec::new();
        let mut engine = None;
        for app in members {
            let instance = app.get("instance").unwrap().as_str().unwrap();
            let app_manifest = app.get("manifest").unwrap();
            write_file(
                &root.join("apps").join(instance).join("app-manifest.json"),
                js_json::pretty(app_manifest).as_bytes(),
            );
            app_refs.push(Json::obj([
                ("id", Json::str(instance)),
                ("path", Json::Str(format!("apps/{instance}"))),
            ]));
            if let Some(mount) = app.get("mount") {
                let auth = mount.get("auth").unwrap().as_str().unwrap();
                let artifact = format!("engines/linux-x64/{plugin}-engine");
                write_file(&root.join(&artifact), b"\x7fELF");
                manifest.push((
                    "engine".to_owned(),
                    Json::obj([
                        ("id", Json::Str(format!("{plugin}-engine"))),
                        ("kind", Json::str("http-service")),
                        ("mount_app", Json::str(instance)),
                        ("service_mode", Json::str("login")),
                        (
                            "artifacts",
                            Json::obj([(
                                "linux-x64",
                                Json::obj([
                                    ("path", Json::Str(artifact)),
                                    ("sha256", Json::Str("0".repeat(64))),
                                ]),
                            )]),
                        ),
                        ("auth", Json::obj([("mode", Json::str(auth))])),
                        (
                            "mount",
                            Json::obj([
                                ("audience", Json::str("person")),
                                ("labels", mount.get("labels").unwrap().clone()),
                                ("approvals", mount.get("approvals").unwrap().clone()),
                                ("expose", mount.get("expose").unwrap().clone()),
                                ("commands", mount.get("commands").unwrap().clone()),
                            ]),
                        ),
                    ]),
                ));
                let Some(Json::Int(port)) = mount.get("port") else {
                    panic!("golden mount port")
                };
                engine = Some(EngineState {
                    port: u16::try_from(*port).unwrap(),
                    token_id: (auth != "none").then(|| "golden-token".into()),
                    proof_key: (auth != "none").then(|| proof_key.clone()),
                    file_fallback: false,
                });
            }
        }
        manifest.insert(2, ("apps".to_owned(), Json::Arr(app_refs)));
        write_file(
            &root.join("plugin-manifest.json"),
            js_json::pretty(&Json::Obj(manifest)).as_bytes(),
        );
        plugins.push(InstalledPlugin {
            id: plugin.clone(),
            bundle_sha256: bundle_of(plugin),
            engine,
        });
    }
    let workspace = golden.get("workspace").unwrap();
    let copilot = golden.get("copilot").unwrap();
    let Some(Json::Bool(inbound)) = golden.get("inbound") else {
        panic!("golden inbound")
    };
    let state = DesktopState {
        desktop_state_version: 1,
        workspace: Workspace {
            id: workspace.get("id").unwrap().as_str().unwrap().into(),
            name: workspace.get("name").unwrap().as_str().unwrap().into(),
        },
        inbound: *inbound,
        copilot: Some(Copilot {
            default: copilot
                .get("default")
                .and_then(Json::as_str)
                .map(str::to_owned),
            providers: serde_json::from_str(&js_json::pretty(copilot.get("providers").unwrap()))
                .unwrap(),
        }),
        plugins,
        pending_revocations: Vec::new(),
    };
    let built = project(data.path(), &state, &Profile::default_profile()).unwrap();
    let mounts_path = data.path().join("mounts.json");
    std::fs::write(&mounts_path, built.mounts.as_bytes()).unwrap();
    restrict(&mounts_path);

    let deployed = read_deployed(&mounts_path).expect("mounts.rs parses 9b1 golden output");
    assert_eq!(deployed.inbound, *inbound);
    assert_eq!(deployed.mounts.len(), 1);
    match &deployed.mounts[0] {
        Access::Http(http) => {
            assert_eq!(http.instance, "mail");
            assert_eq!(http.url, "http://127.0.0.1:17400/mcp");
            assert_eq!(http.bearer, None);
            assert_eq!(
                http.bearer_keychain,
                Some(KeychainRef {
                    keychain: MOUNT_KEYCHAIN.into(),
                    account: "mail.golden-token".into(),
                })
            );
            assert_eq!(http.proof_key.as_deref(), Some(proof_key.as_str()));
        }
        Access::Stdio(_) => panic!("expected http mount"),
    }
}

#[test]
fn p5_s9_3_hmac_proof_matches_independent_rfc2104_vector_and_rejects_mismatches() {
    let key_bytes: Vec<u8> = (0u8..32).collect();
    let nonce_bytes: Vec<u8> = (32u8..64).collect();
    let wrong_key_bytes: Vec<u8> = (0u8..32).map(|_| 0xff).collect();
    let wrong_nonce_bytes: Vec<u8> = (0u8..32).map(|_| 0x00).collect();
    let key = encode_hex(&key_bytes);
    let nonce = encode_hex(&nonce_bytes);
    let wrong_key = encode_hex(&wrong_key_bytes);
    let wrong_nonce = encode_hex(&wrong_nonce_bytes);
    // Computed independently with Python `hmac.new(bytes.fromhex(key), nonce.encode("ascii"), "sha256").hexdigest()`.
    let expected = "f11850ce2b92900b74888d4b8512576ee53d386643a045a8a46d9e0a3e760bfd";
    assert_eq!(compute_proof(&key, &nonce).as_deref(), Some(expected));
    assert!(verify_proof_header(&key, &nonce, expected));

    // Uppercase, flipped nibble, wrong length, wrong key, and wrong nonce all fail closed.
    assert!(!verify_proof_header(
        &key,
        &nonce,
        &expected.to_ascii_uppercase()
    ));
    let mut flipped = expected.to_owned();
    flipped.replace_range(0..1, "e");
    assert!(!verify_proof_header(&key, &nonce, &flipped));
    assert!(!verify_proof_header(&key, &nonce, &expected[..63]));
    assert!(!verify_proof_header(&wrong_key, &nonce, expected));
    assert!(!verify_proof_header(&key, &wrong_nonce, expected));
}

#[derive(Clone)]
enum HealthMode {
    Valid(String),
    WrongProof,
    MissingProof,
    UppercaseProof(String),
    DuplicateValidProof(String),
    Status(hyper::StatusCode, Option<String>),
    Redirect(String),
    Hang,
    ValidWithUnclosedBody(String),
}

#[derive(Clone, Debug)]
struct RecordedRequest {
    method: String,
    path: String,
    query: Option<String>,
    authorization: Option<String>,
}

struct MockServer {
    port: u16,
    requests: Arc<StdMutex<Vec<RecordedRequest>>>,
    stop: tokio::sync::watch::Sender<bool>,
}

impl Drop for MockServer {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
    }
}

impl MockServer {
    fn mcp_url(&self) -> String {
        format!("http://127.0.0.1:{}/mcp", self.port)
    }

    fn recorded(&self) -> Vec<RecordedRequest> {
        self.requests.lock().unwrap().clone()
    }

    fn any_authorization_header(&self) -> bool {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .any(|req| req.authorization.is_some())
    }
}

/// Starts a loopback HTTP/1.1 mock engine serving `/health` and `/mcp`, recording every request
/// and its `Authorization` header.
async fn start_mock_engine(mode: HealthMode, expected_bearer: Option<String>) -> MockServer {
    use bytes::Bytes;
    use http_body_util::Full;
    use hyper::Response;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let requests = Arc::new(StdMutex::new(Vec::new()));
    let (stop, mut stopped) = tokio::sync::watch::channel(false);
    let record = requests.clone();

    tokio::spawn(async move {
        loop {
            let accepted = tokio::select! {
                res = listener.accept() => res,
                _ = stopped.changed() => return,
            };
            let Ok((stream, _)) = accepted else {
                continue;
            };
            let mode = mode.clone();
            let expected_bearer = expected_bearer.clone();
            let record = record.clone();
            let mut conn_stop = stopped.clone();
            tokio::spawn(async move {
                if let HealthMode::ValidWithUnclosedBody(ref key) = mode {
                    // Raw HTTP/1.1 responder: flushes valid 200 + `X-Loam-Proof` headers and
                    // declares a 1 MiB body without ever writing the body bytes, proving the
                    // client discards the response body unread.
                    let mut stream = stream;
                    let mut buf = [0u8; 2048];
                    let Ok(n) = stream.read(&mut buf).await else {
                        return;
                    };
                    let raw = String::from_utf8_lossy(&buf[..n]);
                    let first_line = raw.lines().next().unwrap_or("");
                    let target = first_line.split_whitespace().nth(1).unwrap_or("");
                    let (path, query) = target
                        .split_once('?')
                        .map_or((target, None), |(p, q)| (p, Some(q.to_owned())));
                    let auth = raw.lines().find_map(|line| {
                        let (name, val) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("authorization")
                            .then(|| val.trim().to_owned())
                    });
                    record.lock().unwrap().push(RecordedRequest {
                        method: "GET".into(),
                        path: path.into(),
                        query: query.clone(),
                        authorization: auth,
                    });
                    let proof = query
                        .as_deref()
                        .and_then(|q| q.strip_prefix("nonce="))
                        .and_then(|nonce| compute_proof(key, nonce))
                        .unwrap_or_default();
                    let headers = format!(
                        "HTTP/1.1 200 OK\r\nX-Loam-Proof: {proof}\r\nContent-Length: 1048576\r\n\r\n"
                    );
                    let _ = stream.write_all(headers.as_bytes()).await;
                    let _ = stream.flush().await;
                    // Hold the socket open without sending the body until the test ends.
                    let _ = conn_stop.changed().await;
                    return;
                }
                let service = hyper::service::service_fn(
                    move |req: hyper::Request<hyper::body::Incoming>| {
                        let mode = mode.clone();
                        let expected_bearer = expected_bearer.clone();
                        let record = record.clone();
                        async move {
                            let method = req.method().as_str().to_owned();
                            let path = req.uri().path().to_owned();
                            let query = req.uri().query().map(str::to_owned);
                            let auth = req
                                .headers()
                                .get(hyper::header::AUTHORIZATION)
                                .and_then(|v| v.to_str().ok())
                                .map(str::to_owned);
                            record.lock().unwrap().push(RecordedRequest {
                                method,
                                path: path.clone(),
                                query: query.clone(),
                                authorization: auth.clone(),
                            });

                            if path == "/health" {
                                let nonce = query.as_deref().and_then(|q| q.strip_prefix("nonce="));
                                let response = match &mode {
                                    HealthMode::Valid(key) => {
                                        let proof = nonce
                                            .and_then(|n| compute_proof(key, n))
                                            .expect("valid health request nonce");
                                        Response::builder()
                                            .status(200)
                                            .header("X-Loam-Proof", proof)
                                            .body(Full::new(Bytes::from_static(b"ignored body")))
                                            .unwrap()
                                    }
                                    HealthMode::WrongProof => Response::builder()
                                        .status(200)
                                        .header("X-Loam-Proof", "0".repeat(64))
                                        .body(Full::new(Bytes::new()))
                                        .unwrap(),
                                    HealthMode::MissingProof => Response::builder()
                                        .status(200)
                                        .body(Full::new(Bytes::new()))
                                        .unwrap(),
                                    HealthMode::UppercaseProof(key) => {
                                        let proof = nonce
                                            .and_then(|n| compute_proof(key, n))
                                            .expect("valid health request nonce")
                                            .to_ascii_uppercase();
                                        Response::builder()
                                            .status(200)
                                            .header("X-Loam-Proof", proof)
                                            .body(Full::new(Bytes::new()))
                                            .unwrap()
                                    }
                                    HealthMode::DuplicateValidProof(key) => {
                                        let proof = nonce
                                            .and_then(|n| compute_proof(key, n))
                                            .expect("valid health request nonce");
                                        Response::builder()
                                            .status(200)
                                            .header("X-Loam-Proof", proof.clone())
                                            .header("X-Loam-Proof", proof)
                                            .body(Full::new(Bytes::new()))
                                            .unwrap()
                                    }
                                    HealthMode::Status(status, key) => {
                                        let mut builder = Response::builder().status(*status);
                                        if let Some(key) = key
                                            && let Some(proof) =
                                                nonce.and_then(|n| compute_proof(key, n))
                                        {
                                            builder = builder.header("X-Loam-Proof", proof);
                                        }
                                        builder.body(Full::new(Bytes::new())).unwrap()
                                    }
                                    HealthMode::Redirect(location) => Response::builder()
                                        .status(302)
                                        .header(hyper::header::LOCATION, location.as_str())
                                        .body(Full::new(Bytes::new()))
                                        .unwrap(),
                                    HealthMode::Hang => {
                                        tokio::time::sleep(Duration::from_secs(5)).await;
                                        Response::builder()
                                            .status(200)
                                            .body(Full::new(Bytes::new()))
                                            .unwrap()
                                    }
                                    HealthMode::ValidWithUnclosedBody(_) => unreachable!(),
                                };
                                return Ok::<_, std::convert::Infallible>(response);
                            }

                            if path == "/mcp" {
                                if let Some(expected) = &expected_bearer {
                                    let wanted = format!("Bearer {expected}");
                                    if auth.as_deref() != Some(wanted.as_str()) {
                                        return Ok(Response::builder()
                                            .status(401)
                                            .body(Full::new(Bytes::new()))
                                            .unwrap());
                                    }
                                }
                                let body = json!({
                                    "jsonrpc": "2.0",
                                    "id": 1,
                                    "result": { "ok": true }
                                })
                                .to_string();
                                return Ok(Response::builder()
                                    .status(200)
                                    .header("Content-Type", "application/json")
                                    .body(Full::new(Bytes::from(body)))
                                    .unwrap());
                            }

                            Ok(Response::builder()
                                .status(404)
                                .body(Full::new(Bytes::new()))
                                .unwrap())
                        }
                    },
                );
                let conn = hyper::server::conn::http1::Builder::new()
                    .serve_connection(hyper_util::rt::TokioIo::new(stream), service);
                tokio::select! {
                    _ = conn => {}
                    _ = conn_stop.changed() => {}
                }
            });
        }
    });
    MockServer {
        port,
        requests,
        stop,
    }
}

fn http_entry(
    url: String,
    bearer_keychain: Option<(&str, &str)>,
    proof_key: Option<String>,
) -> Access {
    let mut obj = json!({
        "instance": "mail",
        "url": url,
    });
    if let Some((keychain, account)) = bearer_keychain {
        obj["bearer_keychain"] = json!({ "keychain": keychain, "account": account });
    }
    if let Some(proof_key) = proof_key {
        obj["proof_key"] = json!(proof_key);
    }
    serde_json::from_value(obj).unwrap()
}

#[tokio::test]
async fn p5_s9_3_valid_proof_resolves_bearer_keychain_and_authenticates_mcp() {
    let proof_key = "12".repeat(32);
    let token = "sk-mail-approver-0123456789abcdef";
    let server = start_mock_engine(HealthMode::Valid(proof_key.clone()), Some(token.into())).await;
    let kc_calls = Arc::new(AtomicU64::new(0));
    let kc_calls_reader = kc_calls.clone();
    let reader: KeychainReader = Arc::new(move |service, account| {
        kc_calls_reader.fetch_add(1, Ordering::SeqCst);
        (service == "loam-plugin-mount" && account == "mail.tok_1").then(|| token.to_owned())
    });

    let entry = http_entry(
        server.mcp_url(),
        Some(("loam-plugin-mount", "mail.tok_1")),
        Some(proof_key),
    );
    let mounts = Mounts::with_test_config(Ok(vec![entry]), reader, PROOF_TIMEOUT);
    let notify: Notify = Arc::new(|_, _| {});

    let handle = mounts
        .open("mail", notify.clone())
        .await
        .expect("valid proof opens mount");
    assert_eq!(kc_calls.load(Ordering::SeqCst), 1);

    let reply = mounts
        .send(
            handle,
            json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" }),
            notify,
        )
        .await
        .expect("authenticated MCP call succeeds");
    assert_eq!(reply["result"], json!({ "ok": true }));
    mounts.close(handle).await.unwrap();

    let recorded = server.recorded();
    assert_eq!(recorded.len(), 2);
    // First request: unauthenticated GET /health?nonce=<64-hex>.
    assert_eq!(recorded[0].method, "GET");
    assert_eq!(recorded[0].path, "/health");
    assert_eq!(recorded[0].authorization, None);
    let nonce = recorded[0]
        .query
        .as_deref()
        .and_then(|q| q.strip_prefix("nonce="))
        .expect("nonce query param");
    assert!(
        hex64(nonce),
        "nonce must be 64 lowercase hex chars: {nonce}"
    );
    // Second request: authenticated POST /mcp carrying the resolved bearer token.
    assert_eq!(recorded[1].method, "POST");
    assert_eq!(recorded[1].path, "/mcp");
    assert_eq!(
        recorded[1].authorization.as_deref(),
        Some("Bearer sk-mail-approver-0123456789abcdef")
    );
}

#[tokio::test]
async fn p5_s9_3_missing_or_malformed_keychain_bearer_fails_closed() {
    let proof_key = "34".repeat(32);
    let server = start_mock_engine(HealthMode::Valid(proof_key.clone()), None).await;
    let notify: Notify = Arc::new(|_, _| {});

    // Absent keychain entry -> MOUNT_KEYCHAIN_MISSING, zero Authorization header sent.
    let mounts = Mounts::with_test_config(
        Ok(vec![http_entry(
            server.mcp_url(),
            Some(("loam-plugin-mount", "mail.missing")),
            Some(proof_key.clone()),
        )]),
        Arc::new(|_, _| None),
        PROOF_TIMEOUT,
    );
    assert_eq!(
        mounts.open("mail", notify.clone()).await.err(),
        Some(KEYCHAIN_MISSING)
    );
    assert!(!server.any_authorization_header());

    // Non-key-shaped values (spaces or trailing CR/LF control characters) -> MOUNT_KEYCHAIN_MISSING.
    for bad_secret in [
        "invalid bearer with spaces",
        "sk-valid-token-01234567\n",
        "sk-valid-token-01234567\r\n",
    ] {
        let bad_secret = bad_secret.to_owned();
        let mounts = Mounts::with_test_config(
            Ok(vec![http_entry(
                server.mcp_url(),
                Some(("loam-plugin-mount", "mail.bad")),
                Some(proof_key.clone()),
            )]),
            Arc::new(move |_, _| Some(bad_secret.clone())),
            PROOF_TIMEOUT,
        );
        assert_eq!(
            mounts.open("mail", notify.clone()).await.err(),
            Some(KEYCHAIN_MISSING)
        );
    }
    assert!(!server.any_authorization_header());

    // Defense in depth: `open` also refuses `bearer_keychain` without `proof_key` with zero
    // keychain reads even if `Mounts::new` bypassed `read_deployed`.
    let kc_calls = Arc::new(AtomicU64::new(0));
    let kc_calls_reader = kc_calls.clone();
    let mounts = Mounts::with_test_config(
        Ok(vec![http_entry(
            server.mcp_url(),
            Some(("loam-plugin-mount", "mail.tok_1")),
            None,
        )]),
        Arc::new(move |_, _| {
            kc_calls_reader.fetch_add(1, Ordering::SeqCst);
            Some("sk-must-not-be-read-01234567".into())
        }),
        PROOF_TIMEOUT,
    );
    assert_eq!(
        mounts.open("mail", notify).await.err(),
        Some(MOUNTS_INVALID)
    );
    assert_eq!(kc_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn p5_s9_3_failed_proof_sends_zero_bearer_and_never_reads_keychain() {
    let proof_key = "56".repeat(32);
    let notify: Notify = Arc::new(|_, _| {});

    let cases = [
        ("wrong proof", HealthMode::WrongProof),
        ("missing proof", HealthMode::MissingProof),
        (
            "uppercase proof",
            HealthMode::UppercaseProof(proof_key.clone()),
        ),
        (
            "duplicate proof headers",
            HealthMode::DuplicateValidProof(proof_key.clone()),
        ),
        (
            "HTTP 500 with valid proof",
            HealthMode::Status(
                hyper::StatusCode::INTERNAL_SERVER_ERROR,
                Some(proof_key.clone()),
            ),
        ),
        (
            "HTTP 404",
            HealthMode::Status(hyper::StatusCode::NOT_FOUND, None),
        ),
        (
            "HTTP 204 with valid proof",
            HealthMode::Status(hyper::StatusCode::NO_CONTENT, Some(proof_key.clone())),
        ),
    ];

    for (label, mode) in cases {
        let server = start_mock_engine(mode, None).await;
        let kc_calls = Arc::new(AtomicU64::new(0));
        let kc_calls_reader = kc_calls.clone();
        let reader: KeychainReader = Arc::new(move |_, _| {
            kc_calls_reader.fetch_add(1, Ordering::SeqCst);
            Some("sk-must-never-be-sent-01234567".into())
        });
        let mounts = Mounts::with_test_config(
            Ok(vec![http_entry(
                server.mcp_url(),
                Some(("loam-plugin-mount", "mail.tok_1")),
                Some(proof_key.clone()),
            )]),
            reader,
            PROOF_TIMEOUT,
        );
        assert_eq!(
            mounts.open("mail", notify.clone()).await.err(),
            Some(UNREACHABLE),
            "{label}"
        );
        assert!(
            !server.any_authorization_header(),
            "{label}: mock server must receive ZERO Authorization headers"
        );
        assert_eq!(
            server.recorded().len(),
            1,
            "{label}: only /health should be requested"
        );
        assert_eq!(
            kc_calls.load(Ordering::SeqCst),
            0,
            "{label}: keychain must not be read when proof fails"
        );
    }
}

#[tokio::test]
async fn p5_s9_3_redirect_is_refused_with_zero_bearer_and_target_unreached() {
    let proof_key = "78".repeat(32);
    // Target server would answer 200 + valid proof if the redirect were followed.
    let target = start_mock_engine(HealthMode::Valid(proof_key.clone()), None).await;
    let redirect_url = format!("http://127.0.0.1:{}/health", target.port);
    let squatter = start_mock_engine(HealthMode::Redirect(redirect_url), None).await;
    let kc_calls = Arc::new(AtomicU64::new(0));
    let kc_calls_reader = kc_calls.clone();
    let mounts = Mounts::with_test_config(
        Ok(vec![http_entry(
            squatter.mcp_url(),
            Some(("loam-plugin-mount", "mail.tok_1")),
            Some(proof_key),
        )]),
        Arc::new(move |_, _| {
            kc_calls_reader.fetch_add(1, Ordering::SeqCst);
            Some("sk-must-never-be-sent-01234567".into())
        }),
        PROOF_TIMEOUT,
    );
    let notify: Notify = Arc::new(|_, _| {});
    assert_eq!(mounts.open("mail", notify).await.err(), Some(UNREACHABLE));
    assert!(!squatter.any_authorization_header());
    assert!(
        target.recorded().is_empty(),
        "redirect target must never be contacted"
    );
    assert_eq!(kc_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn p5_s9_3_proof_timeout_and_unreachable_port_send_zero_bearer() {
    assert_eq!(PROOF_TIMEOUT, Duration::from_secs(2));
    let proof_key = "9a".repeat(32);
    let hanging = start_mock_engine(HealthMode::Hang, None).await;
    let kc_calls = Arc::new(AtomicU64::new(0));
    let kc_calls_reader = kc_calls.clone();
    let mounts = Mounts::with_test_config(
        Ok(vec![http_entry(
            hanging.mcp_url(),
            Some(("loam-plugin-mount", "mail.tok_1")),
            Some(proof_key.clone()),
        )]),
        Arc::new(move |_, _| {
            kc_calls_reader.fetch_add(1, Ordering::SeqCst);
            Some("sk-must-never-be-sent-01234567".into())
        }),
        Duration::from_millis(200),
    );
    let notify: Notify = Arc::new(|_, _| {});
    let started = tokio::time::Instant::now();
    assert_eq!(
        mounts.open("mail", notify.clone()).await.err(),
        Some(UNREACHABLE)
    );
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(!hanging.any_authorization_header());
    assert_eq!(kc_calls.load(Ordering::SeqCst), 0);

    // Connection error on a closed loopback port also aborts before keychain lookup.
    let closed = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let closed_port = closed.local_addr().unwrap().port();
    drop(closed);
    let mounts_closed = Mounts::with_test_config(
        Ok(vec![http_entry(
            format!("http://127.0.0.1:{closed_port}/mcp"),
            Some(("loam-plugin-mount", "mail.tok_1")),
            Some(proof_key),
        )]),
        Arc::new(|_, _| panic!("keychain must not be read on connection error")),
        PROOF_TIMEOUT,
    );
    assert_eq!(
        mounts_closed.open("mail", notify).await.err(),
        Some(UNREACHABLE)
    );
}

#[tokio::test]
async fn p5_s9_3_unclosed_health_body_fails_closed_and_failed_opens_release_handle_slots() {
    let proof_key = "bc".repeat(32);
    let unclosed =
        start_mock_engine(HealthMode::ValidWithUnclosedBody(proof_key.clone()), None).await;
    let mounts = Mounts::with_test_config(
        Ok(vec![http_entry(
            unclosed.mcp_url(),
            Some(("loam-plugin-mount", "mail.tok_1")),
            Some(proof_key.clone()),
        )]),
        Arc::new(|_, _| panic!("keychain must not be read when /health body hangs")),
        Duration::from_millis(200),
    );
    let notify: Notify = Arc::new(|_, _| {});
    // An unclosed `/health` response cannot keep HTTP/1.1 keep-alive framing intact for the
    // bound connection, so it fails closed within `proof_timeout` with zero bearer sent.
    assert_eq!(
        mounts.open("mail", notify.clone()).await.err(),
        Some(UNREACHABLE)
    );
    assert!(!unclosed.any_authorization_header());

    // Plaintext `bearer` + `proof_key` (D166 Linux file fallback) also sends zero Authorization
    // header when proof fails.
    let bad = start_mock_engine(HealthMode::WrongProof, None).await;
    let fallback_entry: Access = serde_json::from_value(json!({
        "instance": "mail",
        "url": bad.mcp_url(),
        "bearer": "sk-linux-fallback-never-sent-01234567",
        "proof_key": proof_key.clone(),
    }))
    .unwrap();
    let mounts_fallback = Mounts::with_test_config(
        Ok(vec![fallback_entry]),
        Arc::new(|_, _| None),
        PROOF_TIMEOUT,
    );
    assert_eq!(
        mounts_fallback.open("mail", notify.clone()).await.err(),
        Some(UNREACHABLE)
    );
    assert!(!bad.any_authorization_header());

    // Repeated failed proofs release their reserved slots and never hit HANDLES_PER_INSTANCE.
    let mounts_bad = Mounts::with_test_config(
        Ok(vec![http_entry(
            bad.mcp_url(),
            Some(("loam-plugin-mount", "mail.tok_1")),
            Some(proof_key),
        )]),
        Arc::new(|_, _| Some("sk-valid-bearer-01234567".into())),
        PROOF_TIMEOUT,
    );
    for _ in 0..=HANDLES_PER_INSTANCE {
        assert_eq!(
            mounts_bad.open("mail", notify.clone()).await.err(),
            Some(UNREACHABLE)
        );
    }
    assert!(!bad.any_authorization_header());
}

/// Starts a mock engine bound to an explicit loopback port (used to simulate a port squatter
/// taking over the exact same port after the verified engine exits).
async fn start_mock_engine_on_port(
    port: u16,
    mode: HealthMode,
    expected_bearer: Option<String>,
    session_id: Option<String>,
) -> MockServer {
    use bytes::Bytes;
    use http_body_util::Full;
    use hyper::Response;

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    let requests = Arc::new(StdMutex::new(Vec::new()));
    let (stop, mut stopped) = tokio::sync::watch::channel(false);
    let record = requests.clone();

    tokio::spawn(async move {
        loop {
            let accepted = tokio::select! {
                res = listener.accept() => res,
                _ = stopped.changed() => return,
            };
            let Ok((stream, _)) = accepted else {
                continue;
            };
            let mode = mode.clone();
            let expected_bearer = expected_bearer.clone();
            let session_id = session_id.clone();
            let record = record.clone();
            let mut conn_stop = stopped.clone();
            tokio::spawn(async move {
                let service = hyper::service::service_fn(
                    move |req: hyper::Request<hyper::body::Incoming>| {
                        let mode = mode.clone();
                        let expected_bearer = expected_bearer.clone();
                        let session_id = session_id.clone();
                        let record = record.clone();
                        async move {
                            let method = req.method().as_str().to_owned();
                            let path = req.uri().path().to_owned();
                            let query = req.uri().query().map(str::to_owned);
                            let auth = req
                                .headers()
                                .get(hyper::header::AUTHORIZATION)
                                .and_then(|v| v.to_str().ok())
                                .map(str::to_owned);
                            record.lock().unwrap().push(RecordedRequest {
                                method: method.clone(),
                                path: path.clone(),
                                query: query.clone(),
                                authorization: auth.clone(),
                            });

                            if path == "/health" {
                                let nonce = query.as_deref().and_then(|q| q.strip_prefix("nonce="));
                                let response = match &mode {
                                    HealthMode::Valid(key) => {
                                        let proof = nonce
                                            .and_then(|n| compute_proof(key, n))
                                            .expect("valid health request nonce");
                                        Response::builder()
                                            .status(200)
                                            .header("X-Loam-Proof", proof)
                                            .body(Full::new(Bytes::new()))
                                            .unwrap()
                                    }
                                    _ => Response::builder()
                                        .status(200)
                                        .header("X-Loam-Proof", "0".repeat(64))
                                        .body(Full::new(Bytes::new()))
                                        .unwrap(),
                                };
                                return Ok::<_, std::convert::Infallible>(response);
                            }
                            if path == "/mcp" && method == "POST" {
                                if let Some(expected) = &expected_bearer {
                                    let wanted = format!("Bearer {expected}");
                                    if auth.as_deref() != Some(wanted.as_str()) {
                                        return Ok(Response::builder()
                                            .status(401)
                                            .body(Full::new(Bytes::new()))
                                            .unwrap());
                                    }
                                }
                                let body = json!({
                                    "jsonrpc": "2.0",
                                    "id": 1,
                                    "result": { "protocolVersion": "2025-06-18" }
                                })
                                .to_string();
                                let mut builder = Response::builder()
                                    .status(200)
                                    .header("Content-Type", "application/json");
                                if let Some(id) = &session_id {
                                    builder = builder.header("Mcp-Session-Id", id.as_str());
                                }
                                return Ok(builder.body(Full::new(Bytes::from(body))).unwrap());
                            }
                            Ok(Response::builder()
                                .status(200)
                                .body(Full::new(Bytes::new()))
                                .unwrap())
                        }
                    },
                );
                let conn = hyper::server::conn::http1::Builder::new()
                    .serve_connection(hyper_util::rt::TokioIo::new(stream), service);
                tokio::select! {
                    _ = conn => {}
                    _ = conn_stop.changed() => {}
                }
            });
        }
    });
    MockServer {
        port,
        requests,
        stop,
    }
}

#[tokio::test]
async fn p5_s9_3_bearer_is_bound_to_verified_connection_and_re_proves_after_peer_replacement() {
    let proof_key = "de".repeat(32);
    let token = "sk-bound-bearer-0123456789abcdef";
    let notify: Notify = Arc::new(|_, _| {});

    // 1. Legitimate engine passes proof on `mount_open` and binds its TCP connection.
    let engine = start_mock_engine_on_port(
        0,
        HealthMode::Valid(proof_key.clone()),
        Some(token.into()),
        Some("sess-1".into()),
    )
    .await;
    let port = engine.port;
    let url = engine.mcp_url();
    let mounts = Mounts::with_test_config(
        Ok(vec![http_entry(
            url.clone(),
            Some(("loam-plugin-mount", "mail.tok_1")),
            Some(proof_key.clone()),
        )]),
        Arc::new(move |_, _| Some(token.to_owned())),
        PROOF_TIMEOUT,
    );
    let handle = mounts.open("mail", notify.clone()).await.unwrap();

    // 2. Engine exits before the first authenticated POST; a port squatter takes the same port.
    drop(engine);
    tokio::time::sleep(Duration::from_millis(25)).await;
    let squatter = start_mock_engine_on_port(port, HealthMode::WrongProof, None, None).await;

    // 3. `mount_send` detects the lost verified connection, runs a fresh `/health` proof on
    // the new connection, aborts with `MOUNT_UNREACHABLE`, and sends ZERO `Authorization` header.
    assert_eq!(
        mounts
            .send(
                handle,
                json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }),
                notify.clone(),
            )
            .await
            .err(),
        Some(UNREACHABLE)
    );
    assert!(
        !squatter.any_authorization_header(),
        "squatter taking over the port after mount_open must receive ZERO Authorization headers"
    );
    assert!(
        squatter.recorded().iter().all(|req| req.path == "/health"),
        "squatter must only see unauthenticated /health, never /mcp"
    );

    // 4. Legitimate engine returns on the same port: `mount_send` re-proves and succeeds,
    // establishing a session on the new verified connection.
    drop(squatter);
    tokio::time::sleep(Duration::from_millis(25)).await;
    let engine_restarted = start_mock_engine_on_port(
        port,
        HealthMode::Valid(proof_key.clone()),
        Some(token.into()),
        Some("sess-2".into()),
    )
    .await;
    let reply = mounts
        .send(
            handle,
            json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }),
            notify,
        )
        .await
        .expect("restarted legitimate engine passes fresh proof and answers /mcp");
    assert_eq!(reply["result"], json!({ "protocolVersion": "2025-06-18" }));

    // 5. Engine exits again and a squatter takes the port before `mount_close`: `close` must
    // NOT open an unverified connection to send `DELETE` with the bearer.
    drop(engine_restarted);
    tokio::time::sleep(Duration::from_millis(25)).await;
    let squatter_close = start_mock_engine_on_port(port, HealthMode::WrongProof, None, None).await;
    mounts.close(handle).await.unwrap();
    assert!(
        !squatter_close.any_authorization_header(),
        "mount_close must never transmit bearer to a replacement listener"
    );
    assert!(
        squatter_close.recorded().is_empty(),
        "mount_close must not open a new connection after the verified socket closed"
    );
}
