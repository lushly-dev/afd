//! The hosted HTTP surface's listener and layers (phase 5 specification, sections 3.2, 3.3, 4.2,
//! 6.2, 6.3, 10.2 and 11; step 2a), over real sockets.
//!
//! Section 6.3's order, outermost first, each proven by what a request meets:
//!
//! 1. **TLS** with `client_auth`: a failed handshake reaches nothing, not even the per-IP count.
//! 2. **The body size limit**: a declared or streamed body over `http.max_body_bytes` is 413
//!    before the per-IP count and before any token work.
//! 3. **The per-IP limit**: past it, `/health`, the metadata and the MCP path are 429 alike, and
//!    no token is verified.
//! 4. **Public routes**: `/health` and the metadata at both well-known paths, with no token.
//! 5. **AFD's bearer layer**: every other request of the MCP path needs a verified token, with
//!    the specified 401; it answers before AFD's host check (layer 7).
//! 7. **The context hook**, version 1: it refuses every caller the host's own verifier did not
//!    map (here the tests' recording verifier, a missing layer), so nothing runs for them; step
//!    2b's `auth_tokens.rs` and `principal_v1.rs` cover the callers it maps.
//!
//! Also: the TLS client certificate's thumbprint reaches the verifier from the handshake only,
//! never from a header; removing an authenticating layer fails closed; stdio and the CLI are
//! unaffected; a shipped build serves `oauth` (since step 7) and `gateway` (since step 4), and a
//! gateway whose pinned key set cannot be used refuses to start. `gateway_mode.rs` holds the
//! gateway layer itself.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::server::auth::{Authorization, Credentials, ProtectedResource};
use afd::server::{HttpOptions, McpServer};
use axum::body::Body;
use serde_json::{Value, json};
use support::hosted::{
    Client, METADATA_PATHS, PUBLIC_URL, Recording, Served, kit_token, kit_verifier, oauth_config,
    tls_table, write_tls,
};
use support::mcp::{self, Stdio};
use tower::ServiceExt;
use umbel::{Host, HostBuilder};
use umbel_testkit_idp::{Break, IssuedCertificate, TestCa, TestIdp};

/// The 401's challenge without a token, and its suffix when one was refused (section 3.2).
const CHALLENGE: &str = "Bearer resource_metadata=\"https://127.0.0.1/.well-known/oauth-protected-resource/mcp\", scope=\"umbel:read\"";

/// One `oauth` workspace served on a real socket, with a recording verifier in the slot.
struct Hosted {
    kit: TestIdp,
    dir: tempfile::TempDir,
    host: Host,
    served: Served,
    verifier: Recording,
}

impl Hosted {
    /// `client_auth`, extra `[auth]` keys, and the rest of the file (`[limits]`, ...); bodies
    /// capped at 4096 bytes; bound tokens required when `bound`.
    async fn start(client_auth: &str, auth: &str, rest: &str, bound: bool) -> Self {
        let kit = TestIdp::start().await.unwrap();
        let text = oauth_config(
            &kit,
            "max_body_bytes = 4096",
            auth,
            &format!("{}\n{rest}", tls_table(client_auth)),
        );
        let dir = support::workspace(&text);
        write_tls(dir.path(), &kit);
        let verifier = Recording::new(kit_verifier(&kit, bound));
        let host = HostBuilder::open(dir.path())
            .unwrap()
            .with_token_verifier(verifier.clone())
            .seal()
            .unwrap();
        let served = Served::start(&host).await;
        Self {
            kit,
            dir,
            host,
            served,
            verifier,
        }
    }

    /// A TLS client trusting the kit's CA, presenting `certificate` when given.
    fn client(&self, certificate: Option<&IssuedCertificate>) -> Client {
        Client::tls(
            self.served.address,
            self.kit.ca().certificate_pem(),
            certificate,
        )
    }

    fn token(&self) -> String {
        kit_token(&self.kit)
    }
}

/// A 2026-07-28 JSON-RPC request to `/mcp`, with a bearer token when given.
async fn modern(
    client: &Client,
    method: &str,
    mut params: Value,
    token: Option<&str>,
) -> mcp::Reply {
    params["_meta"] = mcp::modern_meta();
    let name = params["name"].as_str().map(str::to_owned);
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let bearer = token.map(|token| format!("Bearer {token}"));
    let mut headers = vec![
        ("content-type", "application/json"),
        ("accept", "application/json, text/event-stream"),
        ("mcp-protocol-version", "2026-07-28"),
        ("mcp-method", method),
    ];
    if let Some(name) = &name {
        headers.push(("mcp-name", name));
    }
    if let Some(bearer) = &bearer {
        headers.push(("authorization", bearer));
    }
    client
        .send(client.request("POST", "/mcp", &headers, body.to_string()))
        .await
}

fn header<'a>(reply: &'a mcp::Reply, name: &str) -> Option<&'a str> {
    reply
        .headers
        .get(name)
        .and_then(|value| value.to_str().ok())
}

/// The status line of a raw HTTP answer.
fn status_line(raw: &str) -> &str {
    raw.lines().next().unwrap_or_default()
}

// ─── Layer 1: TLS and client_auth ───────────────────────────────────────────────────────────

#[tokio::test]
async fn tls_is_the_outermost_layer_and_client_auth_ca_requires_a_chained_certificate() {
    let hosted = Hosted::start("ca", "", "[limits]\nip_requests_per_minute = 3\n", false).await;
    let trusted = hosted.kit.ca().client_certificate("gateway").unwrap();
    let stranger = TestCa::new()
        .unwrap()
        .client_certificate("gateway")
        .unwrap();

    // Plain HTTP on the TLS port never reaches HTTP.
    let plain = Client::plain(hosted.served.address)
        .raw(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
        .await
        .unwrap_or_default();
    assert!(!plain.contains("HTTP/1.1"), "{plain}");
    // No certificate, a certificate from another CA, and one from the right CA made for a
    // server (no clientAuth usage) fail the handshake.
    let server_only = hosted.kit.ca().server_certificate(&["127.0.0.1"]).unwrap();
    assert!(hosted.client(None).handshake().await.is_err());
    assert!(hosted.client(Some(&stranger)).handshake().await.is_err());
    assert!(hosted.client(Some(&server_only)).handshake().await.is_err());
    assert!(
        hosted
            .client(None)
            .try_send(hosted.client(None).request("GET", "/health", &[], ""))
            .await
            .is_err()
    );

    // None of those six reached the per-IP limit (layer 3): all three requests remain.
    let client = hosted.client(Some(&trusted));
    for _ in 0..3 {
        assert_eq!(client.get("/health", &[]).await.status, 200);
    }
    assert_eq!(client.get("/health", &[]).await.status, 429);
}

#[tokio::test]
async fn client_auth_any_asks_for_a_certificate_and_none_asks_for_none() {
    let hosted = Hosted::start("any", "", "", false).await;
    let stranger = TestCa::new()
        .unwrap()
        .client_certificate("self-made")
        .unwrap();
    let token = hosted.token();
    // Without a certificate, and with one no CA of the server's vouches for.
    assert_eq!(hosted.client(None).get("/health", &[]).await.status, 200);
    let reply = modern(
        &hosted.client(Some(&stranger)),
        "tools/list",
        json!({}),
        Some(&token),
    )
    .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let reply = modern(&hosted.client(None), "tools/list", json!({}), Some(&token)).await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    assert_eq!(
        hosted.verifier.seen(),
        [Some(stranger.x5t_s256()), None],
        "the certificate the client proved it holds, then none"
    );

    // client_auth = "none": the server asks for none, so a client holding one sends none.
    let hosted = Hosted::start("none", "", "", false).await;
    let held = hosted.kit.ca().client_certificate("agent").unwrap();
    let reply = modern(
        &hosted.client(Some(&held)),
        "tools/list",
        json!({}),
        Some(&hosted.token()),
    )
    .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    assert_eq!(hosted.verifier.seen(), [None]);
}

#[tokio::test]
async fn tls_1_3_and_1_2_are_served_with_http_1_1_only() {
    let hosted = Hosted::start("none", "", "", false).await;
    let ca = hosted.kit.ca().certificate_pem();
    let address = hosted.served.address;
    for versions in [
        &[&tokio_rustls::rustls::version::TLS13][..],
        &[&tokio_rustls::rustls::version::TLS12][..],
    ] {
        let client = Client::tls_versions(address, ca, None, versions, &[b"http/1.1"]);
        assert_eq!(client.get("/health", &[]).await.status, 200);
    }
    // A client that speaks only h2 has no protocol in common with the listener.
    let h2 = Client::tls_versions(
        address,
        ca,
        None,
        &[&tokio_rustls::rustls::version::TLS13],
        &[b"h2"],
    );
    assert!(h2.handshake().await.is_err());
    // No session is resumed: each connection verifies afresh (in both versions, a client that
    // keeps its session cache tries).
    for versions in [
        &[&tokio_rustls::rustls::version::TLS13][..],
        &[&tokio_rustls::rustls::version::TLS12][..],
    ] {
        let client = Client::tls_versions(address, ca, None, versions, &[b"http/1.1"]);
        for _ in 0..2 {
            assert_eq!(
                client.handshake_kind().await.unwrap(),
                tokio_rustls::rustls::HandshakeKind::Full
            );
        }
    }
    // A client offering no ALPN at all is served HTTP/1.1.
    let bare = Client::tls_versions(
        address,
        ca,
        None,
        &[&tokio_rustls::rustls::version::TLS13],
        &[],
    );
    assert_eq!(bare.get("/health", &[]).await.status, 200);
}

// ─── The client certificate reaches the verifier from the handshake only ─────────────────────

#[tokio::test]
async fn a_certificate_thumbprint_comes_from_the_handshake_and_never_from_a_header() {
    let hosted = Hosted::start("any", "require_bound_tokens = true", "", true).await;
    let holder = hosted.kit.ca().client_certificate("bound-agent").unwrap();
    let other = hosted.kit.ca().client_certificate("other-agent").unwrap();
    let bound = hosted
        .kit
        .authorization_server()
        .access_token(PUBLIC_URL)
        .subject("ada")
        .scopes(["umbel:read"])
        .certificate(&holder)
        .sign();
    let call = |client: Client, headers: Vec<(String, String)>| {
        let bound = bound.clone();
        async move {
            let bearer = format!("Bearer {bound}");
            let mut all: Vec<(&str, &str)> = vec![
                ("content-type", "application/json"),
                ("accept", "application/json, text/event-stream"),
                ("mcp-protocol-version", "2026-07-28"),
                ("mcp-method", "tools/list"),
                ("authorization", &bearer),
            ];
            for (name, value) in &headers {
                all.push((name, value));
            }
            let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": { "_meta": mcp::modern_meta() } });
            client
                .send(client.request("POST", "/mcp", &all, body.to_string()))
                .await
        }
    };

    // The holder's own connection: the bound token is accepted.
    let reply = call(hosted.client(Some(&holder)), vec![]).await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    // Another certificate on the connection: refused.
    let reply = call(hosted.client(Some(&other)), vec![]).await;
    assert_eq!(reply.status, 401);
    // No certificate on the connection, but every header a proxy might use to forward one,
    // naming the holder's: refused, and the verifier saw no certificate.
    let forged = vec![
        (
            "x-client-cert".to_owned(),
            holder.certificate_pem().replace('\n', " "),
        ),
        (
            "x-ssl-client-cert".to_owned(),
            holder.certificate_pem().replace('\n', " "),
        ),
        (
            "x-forwarded-client-cert".to_owned(),
            format!("Hash={}", holder.sha256_hex()),
        ),
        ("ssl-client-cert".to_owned(), holder.x5t_s256()),
        ("x-client-cert-sha256".to_owned(), holder.x5t_s256()),
    ];
    let reply = call(hosted.client(None), forged.clone()).await;
    assert_eq!(reply.status, 401);
    // And on the other certificate's connection, the headers do not replace it.
    let reply = call(hosted.client(Some(&other)), forged).await;
    assert_eq!(reply.status, 401);
    assert_eq!(
        hosted.verifier.seen(),
        [
            Some(holder.x5t_s256()),
            Some(other.x5t_s256()),
            None,
            Some(other.x5t_s256()),
        ]
    );
}

// ─── Layer 4: the protected-resource metadata and /health ───────────────────────────────────

#[tokio::test]
async fn the_metadata_is_public_at_both_paths_and_names_only_token_issuers() {
    let hosted = Hosted::start("none", "", "", false).await;
    let client = hosted.client(None);
    let expected = json!({
        "resource": PUBLIC_URL,
        "authorization_servers": [hosted.kit.authorization_server().issuer()],
        "scopes_supported": ["umbel:read"],
        "bearer_methods_supported": ["header"],
        "tls_client_certificate_bound_access_tokens": false,
    });
    for path in METADATA_PATHS {
        let reply = client.get(path, &[]).await;
        assert_eq!(reply.status, 200, "{path}");
        assert_eq!(header(&reply, "content-type"), Some("application/json"));
        // Exactly the document: the login-only issuer `idp` and `resource_name` are left out.
        assert_eq!(reply.json(), expected, "{path}");
        let reply = client.send(client.request("POST", path, &[], "{}")).await;
        assert_eq!(reply.status, 405, "{path}");
        assert_eq!(header(&reply, "allow"), Some("GET"));
    }
    let reply = client.get("/health", &[]).await;
    assert_eq!(
        (reply.status, reply.json()),
        (200, json!({ "status": "ok" }))
    );
    // Nothing public was verified.
    assert_eq!(hosted.verifier.calls(), 0);
    // A path that is neither public nor the MCP path is not found.
    assert_eq!(client.get("/mcp/elsewhere", &[]).await.status, 404);

    // Bound tokens required: the metadata says so.
    let hosted = Hosted::start("any", "require_bound_tokens = true", "", true).await;
    let reply = hosted.client(None).get(METADATA_PATHS[1], &[]).await;
    assert_eq!(
        reply.json()["tls_client_certificate_bound_access_tokens"],
        json!(true)
    );
}

// ─── Layer 5: the bearer layer and its 401 ──────────────────────────────────────────────────

#[tokio::test]
async fn every_other_request_needs_a_verified_token_and_gets_the_specified_401() {
    let hosted = Hosted::start("none", "", "", false).await;
    let client = hosted.client(None);
    let body = json!({
        "error": "UNAUTHORIZED",
        "suggestion": "Obtain a token for https://127.0.0.1/mcp from an authorization server named in https://127.0.0.1/.well-known/oauth-protected-resource/mcp.",
    });

    // No token: the challenge with no `error`.
    for method in ["GET", "POST", "DELETE"] {
        let reply = client
            .send(client.request(
                method,
                "/mcp",
                &[("content-type", "application/json")],
                "{}",
            ))
            .await;
        assert_eq!(reply.status, 401, "{method}");
        assert_eq!(header(&reply, "www-authenticate"), Some(CHALLENGE));
        assert_eq!(reply.json(), body);
    }
    assert_eq!(hosted.verifier.calls(), 0);

    // A refused token: `error="invalid_token"` last, the same body.
    let broken = hosted
        .kit
        .authorization_server()
        .access_token(PUBLIC_URL)
        .break_rule(Break::MultipleAudiences)
        .sign();
    let reply = modern(&client, "tools/list", json!({}), Some(&broken)).await;
    assert_eq!(reply.status, 401);
    assert_eq!(
        header(&reply, "www-authenticate").map(str::to_owned),
        Some(format!("{CHALLENGE}, error=\"invalid_token\""))
    );
    assert_eq!(reply.json(), body);
    assert_eq!(hosted.verifier.calls(), 1);

    // A token in the query, or in a second header, is refused before it is verified.
    let token = hosted.token();
    let reply = client
        .send(client.request(
            "POST",
            &format!("/mcp?access_token={token}"),
            &[("content-type", "application/json")],
            "{}",
        ))
        .await;
    assert_eq!(reply.status, 401);
    let bearer = format!("Bearer {token}");
    let reply = client
        .send(client.request(
            "POST",
            "/mcp",
            &[("authorization", &bearer), ("authorization", &bearer)],
            "{}",
        ))
        .await;
    assert_eq!(reply.status, 401);
    assert_eq!(hosted.verifier.calls(), 1);

    // The valid token is admitted.
    let reply = modern(&client, "tools/list", json!({}), Some(&token)).await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    assert!(reply.json()["result"]["tools"].is_array(), "{}", reply.text);
}

#[tokio::test]
async fn the_bearer_layer_answers_before_the_host_check_and_the_hook_refuses_an_unmapped_caller() {
    let hosted = Hosted::start("none", "", "", false).await;
    let token = hosted.token();
    // A Host the surface does not publish: without a token the bearer layer (5) answers first;
    // with one, AFD's host check (7) refuses it.
    let rebound = hosted.client(None).with_host("attacker.example");
    assert_eq!(
        modern(&rebound, "tools/list", json!({}), None).await.status,
        401
    );
    assert_eq!(
        modern(&rebound, "tools/list", json!({}), Some(&token))
            .await
            .status,
        403
    );
    // Nor is a loopback name implied in a hosted mode.
    let loopback = hosted.client(None).with_host("localhost");
    assert_eq!(
        modern(&loopback, "tools/list", json!({}), Some(&token))
            .await
            .status,
        403
    );

    // A caller verified by a verifier other than the host's reaches the context hook, which
    // refuses it: no caller was mapped for its credentials, so nothing runs.
    let client = hosted.client(None);
    let reply = modern(
        &client,
        "tools/call",
        json!({ "name": "workspace-show", "arguments": {} }),
        Some(&token),
    )
    .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let result = &reply.json()["result"];
    assert_eq!(result["isError"], json!(true), "{result}");
    assert_eq!(
        result["structuredContent"]["error"]["code"],
        json!("UNAUTHORIZED"),
        "{result}"
    );
    assert!(!reply.text.contains(hosted.dir.path().to_str().unwrap()));
}

// ─── Layer 2: the body size limit ───────────────────────────────────────────────────────────

#[tokio::test]
async fn the_body_limit_refuses_before_the_ip_limit_and_before_any_token_work() {
    let hosted = Hosted::start("none", "", "[limits]\nip_requests_per_minute = 2\n", false).await;
    let client = hosted.client(None);
    let token = hosted.token();
    // A declared body over the cap: 413 and the connection closed, the body never read.
    for _ in 0..3 {
        let raw = client
            .raw(
                format!(
                    "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: 4097\r\n\r\n"
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        assert_eq!(status_line(&raw), "HTTP/1.1 413 Payload Too Large", "{raw}");
        assert!(
            raw.to_ascii_lowercase().contains("connection: close"),
            "{raw}"
        );
    }
    assert_eq!(hosted.verifier.calls(), 0);
    // None of them was counted by the per-IP limit behind it.
    assert_eq!(client.get("/health", &[]).await.status, 200);
    // A body of exactly the cap passes the limit (to the bearer layer, which refuses no token).
    let at_cap = "x".repeat(4096);
    let reply = client
        .send(client.request(
            "POST",
            "/mcp",
            &[("content-type", "application/json")],
            at_cap,
        ))
        .await;
    assert_eq!(reply.status, 401);
    // The limit is spent now; an oversized body still meets the body limit first.
    let raw = client
        .raw(b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 999999\r\n\r\n")
        .await
        .unwrap();
    assert_eq!(status_line(&raw), "HTTP/1.1 413 Payload Too Large", "{raw}");
    assert_eq!(client.get("/health", &[]).await.status, 429);
}

#[tokio::test]
async fn a_streamed_body_over_the_limit_is_413() {
    // End to end through the bearer layer, whose own reader is capped too; the unit test
    // `a_streamed_body_past_the_cap_never_reaches_a_reader_that_has_no_cap` in
    // `src/surfaces/http/layers.rs` proves the body limit alone.
    let hosted = Hosted::start("none", "", "", false).await;
    let client = hosted.client(None);
    let token = hosted.token();
    let chunk = "y".repeat(5000);
    let raw = client
        .raw(
            format!(
                "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{chunk}\r\n0\r\n\r\n",
                chunk.len()
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    assert_eq!(status_line(&raw), "HTTP/1.1 413 Payload Too Large", "{raw}");
    // Under the cap, a streamed body is read whole.
    let small = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": { "_meta": mcp::modern_meta() } }).to_string();
    let raw = client
        .raw(
            format!(
                "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nMcp-Protocol-Version: 2026-07-28\r\nMcp-Method: tools/list\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{small}\r\n0\r\n\r\n",
                small.len()
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    assert_eq!(status_line(&raw), "HTTP/1.1 200 OK", "{raw}");
}

// ─── Layer 3: the per-IP limit ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_ip_limit_refuses_before_public_routes_and_verification_and_is_shared() {
    let hosted = Hosted::start("none", "", "[limits]\nip_requests_per_minute = 3\n", false).await;
    let client = hosted.client(None);
    let token = hosted.token();
    assert_eq!(client.get("/health", &[]).await.status, 200);
    assert_eq!(client.get(METADATA_PATHS[0], &[]).await.status, 200);
    assert_eq!(
        modern(&client, "tools/list", json!({}), Some(&token))
            .await
            .status,
        200
    );
    assert_eq!(hosted.verifier.calls(), 1);

    // Past the limit: every route alike, and no token is verified.
    for reply in [
        client.get("/health", &[]).await,
        client.get(METADATA_PATHS[1], &[]).await,
        client.get("/nowhere", &[]).await,
        modern(&client, "tools/list", json!({}), Some(&token)).await,
    ] {
        assert_eq!(reply.status, 429, "{}", reply.text);
        let seconds: u64 = header(&reply, "retry-after").unwrap().parse().unwrap();
        assert!((1..=60).contains(&seconds), "{seconds}");
        assert_eq!(reply.json()["error"], json!("RATE_LIMITED"));
        assert_eq!(
            reply.json()["suggestion"],
            json!(format!(
                "Too many requests from this address; retry after {seconds} seconds."
            ))
        );
    }
    assert_eq!(hosted.verifier.calls(), 1);

    // A second process on the same workspace shares the counters (section 10.2).
    let second = HostBuilder::open(hosted.dir.path())
        .unwrap()
        .with_token_verifier(hosted.verifier.clone())
        .seal()
        .unwrap();
    let served = Served::start(&second).await;
    let other = Client::tls(served.address, hosted.kit.ca().certificate_pem(), None);
    assert_eq!(other.get("/health", &[]).await.status, 429);
    let limits = hosted.dir.path().join("state/shared/limits.sqlite3");
    assert!(limits.is_file());
    // The counters hold an address and times, never a token.
    let bytes = std::fs::read(&limits).unwrap();
    let wal = std::fs::read(limits.with_extension("sqlite3-wal")).unwrap_or_default();
    for file in [&bytes, &wal] {
        assert!(
            !String::from_utf8_lossy(file).contains(&token),
            "a token reached the limit store"
        );
    }
    drop(hosted.host);
}

// ─── Removing an authenticating layer fails closed ──────────────────────────────────────────

/// A 2026-07-28 request for `method` (a `tools/call` of `workspace-show` when `method` is
/// `tools/call`), as the HTTP request a client sends.
fn mcp_request(method: &str, bearer: &str) -> http::Request<Body> {
    let mut params = json!({ "_meta": mcp::modern_meta() });
    if method == "tools/call" {
        params["name"] = json!("workspace-show");
        params["arguments"] = json!({});
    }
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let mut request = http::Request::post("/mcp")
        .header("host", "127.0.0.1")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2026-07-28")
        .header("mcp-method", method)
        .header("authorization", bearer);
    if method == "tools/call" {
        request = request.header("mcp-name", "workspace-show");
    }
    request.body(Body::from(body.to_string())).unwrap()
}

/// `server` served as Streamable HTTP with no bearer layer in front, as a composition that lost
/// layer 5 would serve it. With `admit`, a stand-in for a layer that verified the caller puts
/// admitted credentials on every request (as step 4's gateway layer does), so the request
/// reaches the context hook.
async fn without_the_bearer_layer(
    server: McpServer,
    admit: Option<&Authorization>,
    request: http::Request<Body>,
) -> String {
    let service = server.streamable_http_service(HttpOptions {
        allowed_hosts: vec!["127.0.0.1".into()],
        allowed_origins: vec![],
        max_body_bytes: 4096,
    });
    let (mut parts, body) = request.into_parts();
    if let Some(authorization) = admit {
        authorization.admit(
            &mut parts.extensions,
            Credentials::new(
                "https://as.example",
                "ada",
                "agent",
                PUBLIC_URL,
                0,
                i64::MAX / 2000,
            ),
        );
    }
    let response = service
        .oneshot(http::Request::from_parts(parts, body))
        .await
        .unwrap();
    let bytes = http_body_util::BodyExt::collect(response.into_body())
        .await
        .unwrap()
        .to_bytes();
    String::from_utf8_lossy(&bytes).into_owned()
}

/// An authorization of the test's own, for the compositions below.
fn test_authorization(kit: &TestIdp) -> Authorization {
    let metadata =
        ProtectedResource::new(PUBLIC_URL, [kit.authorization_server().issuer()]).unwrap();
    Authorization::new(metadata, kit_verifier(kit, false)).unwrap()
}

/// A mode `gateway` workspace on the loopback channel.
fn gateway_config(kit: &TestIdp) -> String {
    format!(
        r#"config_version = 5

[principal]
local_id = "corp/ada"

[http]
public_url = "{PUBLIC_URL}"
allowed_hosts = ["127.0.0.1"]

[auth]
mode = "gateway"

[auth.namespaces.corp]

[auth.gateway]
alias = "edge"
namespace = "corp"
issuer = "{issuer}"
keys = "gateway/jwks.json"
max_scopes = ["umbel:read"]
"#,
        issuer = kit.gateway().issuer(),
    )
}

#[tokio::test]
async fn removing_an_authenticating_layer_fails_closed() {
    let hosted = Hosted::start("none", "", "", false).await;
    let bearer = format!("Bearer {}", hosted.token());

    // Layer 5 missing: the host's own server, served over HTTP by an embedder without the
    // listener, admits nobody. Every method is refused, listings and `initialize` included,
    // a valid token sent or not.
    for method in ["tools/call", "tools/list", "initialize"] {
        let text =
            without_the_bearer_layer(hosted.host.mcp_server(), None, mcp_request(method, &bearer))
                .await;
        assert!(text.contains("UNAUTHORIZED"), "{method}: {text}");
        assert!(
            !text.contains("workspace-show") || method == "tools/call",
            "{method}: {text}"
        );
        assert!(!text.contains("\"tools\""), "{method}: {text}");
    }
    // The same composition in mode none serves the loopback agent: the refusal above is the
    // hosted mode's.
    let none = support::workspace("config_version = 5\n");
    let loopback = support::host(none.path());
    let text = without_the_bearer_layer(
        loopback.mcp_server(),
        None,
        mcp_request("tools/call", "Bearer x"),
    )
    .await;
    assert!(text.contains("\"success\":true"), "{text}");

    // Layer 5 missing while a server holds its own authorization: AFD refuses every request,
    // listings included, since no credentials were admitted for it (M1).
    let authorized = hosted
        .host
        .mcp_server()
        .with_authorization(test_authorization(&hosted.kit));
    for method in ["tools/call", "tools/list"] {
        let text =
            without_the_bearer_layer(authorized.clone(), None, mcp_request(method, &bearer)).await;
        assert!(text.contains("UNAUTHORIZED"), "{method}: {text}");
        assert!(!text.contains("\"tools\""), "{method}: {text}");
    }
}

#[tokio::test]
async fn the_hooks_own_check_refuses_admitted_callers_in_both_hosted_modes() {
    // Credentials admitted by some layer reach the context hook, which refuses them: in mode
    // oauth because the host's verifier mapped no caller for them, in mode gateway because the
    // gateway layer did not. Without the hook's check the command would run as the credentials'
    // default actor.
    let kit = TestIdp::start().await.unwrap();
    let oauth = support::workspace(&oauth_config(&kit, "", "", ""));
    let gateway = support::workspace(&gateway_config(&kit));
    for (mode, dir) in [("oauth", &oauth), ("gateway", &gateway)] {
        let host = support::host(dir.path());
        let authorization = test_authorization(&kit);
        let server = host.mcp_server().with_authorization(authorization.clone());
        let text = without_the_bearer_layer(
            server.clone(),
            Some(&authorization),
            mcp_request("tools/call", "Bearer x"),
        )
        .await;
        assert!(text.contains("UNAUTHORIZED"), "{mode}: {text}");
        assert!(!text.contains("\"success\":true"), "{mode}: {text}");
        // The admitted credentials do reach the server: a listing, which the hook does not
        // see, is answered.
        let text = without_the_bearer_layer(
            server,
            Some(&authorization),
            mcp_request("tools/list", "Bearer x"),
        )
        .await;
        assert!(text.contains("\"tools\""), "{mode}: {text}");
    }
}

#[tokio::test]
async fn no_identity_or_address_comes_from_a_header() {
    let hosted = Hosted::start("none", "", "[limits]\nip_requests_per_minute = 4\n", false).await;
    let client = hosted.client(None);
    let token = hosted.token();
    let assertion = hosted.kit.gateway().assertion(PUBLIC_URL, "POST").sign();
    let forged: Vec<(&str, &str)> = vec![
        ("x-user", "ada"),
        ("x-forwarded-user", "ada"),
        ("x-remote-user", "human:corp/ada"),
        ("x-actor", "human:corp/ada"),
        ("forwarded", "for=192.0.2.60;by=127.0.0.1"),
        ("x-forwarded-for", "192.0.2.61"),
        ("x-real-ip", "192.0.2.62"),
        ("umbel-gateway-assertion", &assertion),
        (
            "x-umbel-principal",
            "{\"actor\":{\"kind\":\"human\",\"id\":\"corp/ada\"}}",
        ),
    ];
    let call = json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": { "name": "workspace-show", "arguments": {}, "_meta": mcp::modern_meta() },
    })
    .to_string();
    let mut headers = vec![
        ("content-type", "application/json"),
        ("accept", "application/json, text/event-stream"),
        ("mcp-protocol-version", "2026-07-28"),
        ("mcp-method", "tools/call"),
        ("mcp-name", "workspace-show"),
    ];
    headers.extend(forged.iter().copied());
    // Without a token, the identity headers stand in for none: 401.
    let reply = client
        .send(client.request("POST", "/mcp", &headers, call.clone()))
        .await;
    assert_eq!(reply.status, 401, "{}", reply.text);
    // With one, they name no one either: the hook refuses as it would without them.
    let bearer = format!("Bearer {token}");
    headers.push(("authorization", &bearer));
    let reply = client
        .send(client.request("POST", "/mcp", &headers, call))
        .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    assert_eq!(
        reply.json()["result"]["structuredContent"]["error"]["code"],
        json!("UNAUTHORIZED"),
        "{}",
        reply.text
    );
    // The per-IP limit keys on the socket's address, whatever the forwarding headers say: two
    // requests left, then 429 for every claimed address.
    for (n, address) in ["192.0.2.1", "192.0.2.2", "192.0.2.3"]
        .into_iter()
        .enumerate()
    {
        let reply = client
            .get(
                "/health",
                &[
                    ("x-forwarded-for", address),
                    ("forwarded", &format!("for={address}")),
                    ("x-real-ip", address),
                ],
            )
            .await;
        assert_eq!(reply.status, if n < 2 { 200 } else { 429 }, "{address}");
    }
}

// ─── stdio and the CLI are unaffected ───────────────────────────────────────────────────────

#[tokio::test]
async fn stdio_and_the_cli_are_unaffected_in_mode_oauth() {
    let hosted = Hosted::start("none", "", "", false).await;
    let mut stdio = Stdio::connect(&hosted.host).await;
    let reply = stdio
        .request(
            "tools/call",
            json!({ "name": "workspace-show", "arguments": {} }),
        )
        .await;
    let result = &reply["result"];
    assert_ne!(result["isError"], json!(true), "{reply}");
    assert_eq!(
        result["structuredContent"]["success"],
        json!(true),
        "{reply}"
    );

    let run = support::cli(hosted.dir.path(), &["call", "workspace-show"]).await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    assert_eq!(run.json()["success"], json!(true), "{}", run.stdout);
}

// ─── A shipped build serves both hosted modes ──────────────────────────────────────────────────

#[tokio::test]
async fn a_shipped_build_serves_oauth_and_gateway() {
    let kit = TestIdp::start().await.unwrap();
    // Mode oauth in a shipped build, with no test seam: the host builds its own verifier from
    // [auth.issuers] and, since phase 5 step 7 brought the last disclosure control it waited for
    // (exact filtering; steps 2c and 3 brought the others), serves it.
    let dir = support::workspace(&oauth_config(&kit, "", "", ""));
    let host = support::host(dir.path());
    assert!(
        host.http_server().is_ok(),
        "a shipped build serves oauth since step 7"
    );
    // And it answers: the listener, the layers and the metadata are up, and a request without a
    // token gets the 401 that sends a client to the metadata.
    let served = Served::start(&host).await;
    let client = Client::plain(served.address);
    let reply = support::oauth::modern(&client, "tools/list", json!({}), None).await;
    assert_eq!(reply.status, 401, "{}", reply.text);
    let reply = client
        .send(client.request("GET", METADATA_PATHS[0], &[], String::new()))
        .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    served.stop().await;
    // The bare router never serves a hosted mode: it has no layers.
    assert_eq!(
        host.http_router().unwrap_err().code(),
        "WORKSPACE_CONFIG_INVALID"
    );

    // Mode gateway in a shipped build (phase 5 step 4): served once its pinned key set is usable,
    // a verifier in the token slot or not, and refused to start naming the key set otherwise.
    let dir = support::workspace(&gateway_config(&kit));
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .with_token_verifier(kit_verifier(&kit, false))
        .seal()
        .unwrap();
    let error = host.http_server().unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
    assert!(
        error.message().contains("auth.gateway.keys"),
        "{}",
        error.message()
    );
    support::gateway::write_keys(dir.path(), &kit);
    let served = Served::start(&host).await;
    let client = Client::plain(served.address);
    // A request without an assertion gets the gateway's 401, never AFD's bearer challenge, and
    // no metadata is published.
    let reply = support::oauth::modern(&client, "tools/list", json!({}), None).await;
    support::gateway::assert_refused(&reply, "no assertion");
    let reply = client
        .send(client.request("GET", METADATA_PATHS[0], &[], String::new()))
        .await;
    assert_eq!(reply.status, 404, "{}", reply.text);
    served.stop().await;
    assert_eq!(
        host.http_router().unwrap_err().code(),
        "WORKSPACE_CONFIG_INVALID"
    );
}

#[tokio::test]
async fn tls_files_that_cannot_serve_refuse_to_start_without_echoing_a_key() {
    let kit = TestIdp::start().await.unwrap();
    let start = |rest: &str, prepare: &dyn Fn(&std::path::Path)| {
        let text = oauth_config(&kit, "", "", &format!("{}\n{rest}", tls_table("none")));
        let dir = support::workspace(&text);
        write_tls(dir.path(), &kit);
        prepare(dir.path());
        let host = HostBuilder::open(dir.path())
            .unwrap()
            .with_token_verifier(kit_verifier(&kit, false))
            .seal()
            .unwrap();
        let error = host.http_server().unwrap_err();
        (dir, error)
    };
    // A missing certificate.
    let (_dir, error) = start("", &|dir| {
        std::fs::remove_file(dir.join("tls/cert.pem")).unwrap()
    });
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
    assert!(
        error.message().contains("http.tls.cert"),
        "{}",
        error.message()
    );
    // A key file holding no key, whose text must never be echoed.
    let canary = "CANARY-7d3f9a-not-a-key";
    let (_dir, error) = start("", &|dir| {
        std::fs::write(
            dir.join("tls/key.pem"),
            format!("-----BEGIN PRIVATE KEY-----\n{canary}\n-----END PRIVATE KEY-----\n"),
        )
        .unwrap();
    });
    assert!(
        error.message().contains("http.tls.key"),
        "{}",
        error.message()
    );
    let shown = serde_json::to_string(&error.clone().into_result::<Value>()).unwrap();
    assert!(!shown.contains(canary), "{shown}");
    // A key that is not the certificate's.
    let (_dir, error) = start("", &|dir| {
        let stranger = TestCa::new()
            .unwrap()
            .server_certificate(&["127.0.0.1"])
            .unwrap();
        std::fs::write(dir.join("tls/key.pem"), stranger.private_key_pem()).unwrap();
    });
    assert!(
        error.message().contains("http.tls.key"),
        "{}",
        error.message()
    );
    // A client CA file with no certificate.
    let text = oauth_config(&kit, "", "", &tls_table("ca"));
    let dir = support::workspace(&text);
    write_tls(dir.path(), &kit);
    std::fs::write(dir.path().join("tls/client-ca.pem"), "nothing here\n").unwrap();
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .with_token_verifier(kit_verifier(&kit, false))
        .seal()
        .unwrap();
    let error = host.http_server().unwrap_err();
    assert!(
        error.message().contains("http.tls.client_ca"),
        "{}",
        error.message()
    );
}

// ─── Mode none over TLS ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn mode_none_serves_its_loopback_token_over_tls() {
    let kit = TestIdp::start().await.unwrap();
    let dir = support::workspace(&format!("config_version = 5\n{}", tls_table("none")));
    write_tls(dir.path(), &kit);
    let host = support::host(dir.path());
    // TLS needs the listener: the bare router refuses it.
    assert!(host.http_router().is_err());
    let served = Served::start(&host).await;
    let token = std::fs::read_to_string(host.workspace().layout().http_token()).unwrap();
    let client = Client::tls(served.address, kit.ca().certificate_pem(), None);
    let bearer = format!("Bearer {token}");
    assert_eq!(
        client
            .get("/health", &[("authorization", &bearer)])
            .await
            .status,
        200
    );
    assert_eq!(client.get("/health", &[]).await.status, 401);
    // Mode none publishes no metadata.
    assert_eq!(
        client
            .get(METADATA_PATHS[1], &[("authorization", &bearer)])
            .await
            .status,
        404
    );
    // Plain HTTP on the TLS port gets no HTTP answer.
    let plain = Client::plain(served.address)
        .raw(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
        .await
        .unwrap_or_default();
    assert!(!plain.contains("HTTP/1.1"), "{plain}");
    // The declared-length body limit applies in mode none too.
    let raw = client
        .raw(b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 99999999\r\n\r\n")
        .await
        .unwrap();
    assert_eq!(status_line(&raw), "HTTP/1.1 413 Payload Too Large", "{raw}");
}
