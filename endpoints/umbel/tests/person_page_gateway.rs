//! The person page in mode `gateway` (phase 5 step 5b; the owner's decision of 2026-11-09), end
//! to end with the test kit: the page on a listener of its own (`[http.person]`), with its own TLS
//! and public origin, which the browser reaches directly and the gateway never carries. A gateway
//! caller starts a verified command through the gateway's channel; the person decides on the
//! direct listener; section 7.2 holds there unchanged: the binding to the command, the input and
//! the gateway's `for`, the subject rule through 4.1's mapping, single use across two hosts, and
//! every refusal step 5 tests for the page. Also the configuration's refusals and the doctor's
//! `auth.person_listener`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;

use afd::ManualClock;
use serde_json::{Value, json};
use support::hosted::{Client, PUBLIC_URL, Reply, Served};

// The gateway-facing public URL of these tests is `PUBLIC_URL`, on host `127.0.0.1` (which the
// kit's gateway issuer names too); the page's own origin is `https://localhost:<port>`, a host of
// its own that a browser here reaches directly.
use support::person::{
    LoggedIn, PREVIEW_CANARY, SECRET, Seen, accepted, asked, authorize_to, decide_as_at, decide_to,
    form, login_at, open, result,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use umbel::Host;
use umbel_testkit_idp::{Client as KitClient, ScriptedLogin, TestCa, TestIdp, User};

/// The scopes every test assertion carries, within the gateway's ceiling.
const SCOPES: [&str; 3] = ["umbel:read", "umbel:write", "umbel:approve"];

fn approve_input() -> Value {
    json!({ "proposal": "p-1" })
}

/// `[auth.namespaces.corp]` with the kit's person login asking for `acr` (a TOML list's
/// items), and the login-only issuer `idp`.
fn person_login_with(kit: &TestIdp, acr: &str) -> String {
    format!(
        "[auth.namespaces.corp]\nperson = {{ issuer = \"idp\", client_id = \"umbel-person-page\", client_secret_env = \"UMBEL_TEST_PERSON_SECRET\", acr_values = [{acr}], uv_amr = [\"pin\"] }}\n\n[auth.issuers.idp]\nissuer = \"{}\"\nnamespace = \"corp\"\naccess_tokens = false\n",
        kit.identity_provider().issuer()
    )
}

/// [`person_login_with`] asking for `phr` alone.
fn person_login(kit: &TestIdp) -> String {
    person_login_with(kit, "\"phr\"")
}

/// `[http.person]` on `port`, origin `https://localhost:<port>`, its files under `person-tls/`.
fn person_table(port: u16) -> String {
    person_table_with(port, "")
}

/// [`person_table`] with `extra` entries (TOML list items, each with a leading comma) in its
/// `allowed_hosts`.
fn person_table_with(port: u16, extra: &str) -> String {
    format!(
        "[http.person]\nbind = \"127.0.0.1:{port}\"\npublic_url = \"https://localhost:{port}\"\nallowed_hosts = [\"localhost\"{extra}]\n\n[http.person.tls]\ncert = \"person-tls/cert.pem\"\nkey = \"person-tls/key.pem\"\n"
    )
}

/// What varies between the tests' gateway workspaces.
#[derive(Clone, Copy, Default)]
struct Options<'a> {
    /// Extra `[auth]` keys.
    auth: &'a str,
    /// Appended at the end.
    rest: &'a str,
    /// Extra `[http]` keys.
    http: &'a str,
    /// Extra `http.person.allowed_hosts` items, each with a leading comma.
    person_hosts: &'a str,
    /// The person login's `acr_values` items; `"phr"` when empty.
    acr: &'a str,
    /// The pinned channel (TLS with the gateway's certificate pinned) rather than loopback.
    pinned: bool,
}

/// A gateway workspace (the loopback channel) with the gate plugin, the kit's person login, and
/// `person` (`[http.person]`, or nothing), `auth` and `rest` appended.
fn config(kit: &TestIdp, person: &str, auth: &str, rest: &str) -> String {
    config_with(
        kit,
        person,
        &Options {
            auth,
            rest,
            ..Options::default()
        },
    )
}

/// [`config`] with every option.
fn config_with(kit: &TestIdp, person: &str, options: &Options<'_>) -> String {
    let acr = if options.acr.is_empty() {
        "\"phr\""
    } else {
        options.acr
    };
    support::gateway::config(
        kit,
        &support::gateway::Setup {
            ceiling: r#"["umbel:read", "umbel:write", "umbel:approve"]"#,
            auth: options.auth,
            rest: &format!(
                "[spaces.other]\n\n[plugins]\nenabled = [\"gate\"]\n\n{}",
                options.rest
            ),
            channel: if options.pinned {
                support::gateway::Channel::Pinned
            } else {
                support::gateway::Channel::Loopback
            },
            ..support::gateway::Setup::default()
        },
    )
    .replace("[auth.namespaces.corp]\n", &person_login_with(kit, acr))
    .replace(
        "allowed_hosts = [\"127.0.0.1\"]",
        &format!("allowed_hosts = [\"127.0.0.1\"]\n{}", options.http),
    ) + "\n"
        + person
}

#[cfg(unix)]
fn chmod(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap();
}

/// The person listener's certificate from `ca` for `names`, and its key, owner-readable only.
fn write_person_tls(dir: &Path, ca: &TestCa, names: &[&str]) {
    let tls = dir.join("person-tls");
    std::fs::create_dir_all(&tls).unwrap();
    let issued = ca.server_certificate(names).unwrap();
    std::fs::write(tls.join("cert.pem"), issued.certificate_pem()).unwrap();
    std::fs::write(tls.join("key.pem"), issued.private_key_pem()).unwrap();
    #[cfg(unix)]
    chmod(&tls.join("key.pem"), 0o600);
}

/// A host's person listener, served on a listener the test bound, until dropped.
struct PersonServed {
    address: SocketAddr,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
}

impl PersonServed {
    async fn start(host: &Host, listener: TcpListener) -> Self {
        let server = host
            .person_server()
            .unwrap()
            .expect("the person page's own listener");
        assert!(server.is_tls());
        let address = listener.local_addr().unwrap();
        let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
        tokio::spawn(async move {
            server
                .serve(listener, async move {
                    let _ = stopped.await;
                })
                .await
                .unwrap();
        });
        Self {
            address,
            stop: Some(stop),
        }
    }
}

impl Drop for PersonServed {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
    }
}

/// A served gateway workspace: the gateway-facing listener (loopback, plain HTTP, host
/// `127.0.0.1`) and the person page's own listener (TLS, origin `https://localhost:<port>`),
/// with a browser of the latter.
struct Gateway {
    kit: TestIdp,
    dir: tempfile::TempDir,
    host: Host,
    served: Served,
    /// The gateway's channel: the gateway-facing listener.
    gateway: Client,
    person: PersonServed,
    /// A browser of the person page's origin.
    browser: Client,
    /// `https://127.0.0.1:<port>`.
    origin: String,
    clock: ManualClock,
    seen: Seen,
}

impl Gateway {
    async fn start() -> Self {
        Self::start_options(&Options::default()).await
    }

    async fn start_with(auth: &str, rest: &str) -> Self {
        Self::start_options(&Options {
            auth,
            rest,
            ..Options::default()
        })
        .await
    }

    async fn start_options(options: &Options<'_>) -> Self {
        let kit = TestIdp::start().await.unwrap();
        // Every class a phishable test login could ask for is one the provider lists.
        kit.identity_provider().set_metadata_patch(Some(
            json!({ "acr_values_supported": ["phr", "phrh", "mfa"] }),
        ));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let origin = format!("https://localhost:{port}");
        kit.identity_provider().register_client(
            KitClient::confidential("umbel-person-page", SECRET)
                .redirect_uri(&format!("{origin}/d/return")),
        );
        let dir = support::workspace(&config_with(
            &kit,
            &person_table_with(port, options.person_hosts),
            options,
        ));
        support::gateway::write_keys(dir.path(), &kit);
        write_person_tls(dir.path(), kit.ca(), &["127.0.0.1", "localhost"]);
        let clock = afd::fixed_clock(support::oauth::now_ms());
        support::person::follow(&kit, &clock);
        let seen = Seen::default();
        let host = support::person::host(dir.path(), &kit, &clock, &seen);
        host.check_person_logins().await;
        let served = Served::start(&host).await;
        let gateway = Client::plain(served.address);
        let person = PersonServed::start(&host, listener).await;
        let browser = Client::tls(person.address, kit.ca().certificate_pem(), None)
            .with_host(&format!("localhost:{port}"));
        Self {
            kit,
            dir,
            host,
            served,
            gateway,
            person,
            browser,
            origin,
            clock,
            seen,
        }
    }

    /// A second host on the same workspace, with its own gateway-facing and person listeners, and
    /// a browser of the latter naming the same public origin (as behind a TCP balancer).
    async fn second(&self) -> (Host, Served, PersonServed, Client, Client) {
        let host = support::person::host(self.dir.path(), &self.kit, &self.clock, &self.seen);
        host.check_person_logins().await;
        let served = Served::start(&host).await;
        let gateway = Client::plain(served.address);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let person = PersonServed::start(&host, listener).await;
        let browser = Client::tls(person.address, self.kit.ca().certificate_pem(), None)
            .with_host(self.browser.host());
        (host, served, person, gateway, browser)
    }

    fn now_s(&self) -> i64 {
        afd::Clock::now(&self.clock).div_euclid(1000)
    }

    /// A fresh assertion for a POST to the public URL: `subject` through the gateway's `client`.
    fn assertion(&self, subject: &str, client: &str) -> String {
        self.kit
            .gateway()
            .assertion(PUBLIC_URL, "POST")
            .issued_at(self.now_s())
            .lifetime(60)
            .subject(subject)
            .claim("client", json!(client))
            .scopes(SCOPES)
            .sign()
    }

    /// `tools/call` of `tool` through the gateway as `subject` with client `gateway-client`.
    async fn call(&self, subject: &str, tool: &str, arguments: Value, extra: Value) -> Value {
        self.call_as(
            &self.gateway,
            subject,
            "gateway-client",
            tool,
            arguments,
            extra,
            true,
        )
        .await
    }

    /// `tools/call` through `channel` as `subject` and `client`, from a client that declared
    /// URL-mode elicitation (unless `url` is false), with `extra` params.
    #[allow(clippy::too_many_arguments)]
    async fn call_as(
        &self,
        channel: &Client,
        subject: &str,
        client: &str,
        tool: &str,
        arguments: Value,
        extra: Value,
        url: bool,
    ) -> Value {
        let reply = gateway_call(
            channel,
            &self.assertion(subject, client),
            tool,
            arguments,
            extra,
            url,
        )
        .await;
        assert_eq!(reply.status, 200, "{}", reply.text);
        reply.json()
    }

    /// Begin a decision for `gate-approve` with `input` as ada.
    async fn begin(&self, input: Value) -> support::person::Asked {
        asked(&self.call("ada", "gate-approve", input, json!({})).await)
    }

    /// Retry `gate-approve` as ada with the relay's `state`.
    async fn retry(&self, input: Value, state: &str) -> Value {
        self.call("ada", "gate-approve", input, accepted(state))
            .await
    }

    /// Log in as `user` on the page at `path` and decide `decision`, through `browser`.
    async fn decide(&self, browser: &Client, path: &str, user: &str, decision: &str) -> Reply {
        decide_as_at(&self.kit, browser, path, user, decision, &self.origin).await
    }

    fn script(&self, script: ScriptedLogin) {
        self.kit.identity_provider().script_login(script);
    }
}

/// Open `path` on the page's own listener, log in at the kit with the queued script, and come
/// back from the provider, which must send the browser to the page's own origin.
async fn login_at_origin(gw: &Gateway, path: &str) -> LoggedIn {
    login_at(&gw.kit, &gw.browser, path, &gw.origin).await
}

/// `tools/call` of `tool` with `arguments` on `channel` carrying `assertion` in the gateway's
/// header, as a 2026-07-28 client that declared URL-mode elicitation unless `url` is false.
async fn gateway_call(
    channel: &Client,
    assertion: &str,
    tool: &str,
    arguments: Value,
    extra: Value,
    url: bool,
) -> Reply {
    let mut meta = umbel::testkit::mcp::modern_meta();
    meta["io.modelcontextprotocol/clientCapabilities"] = if url {
        json!({ "elicitation": { "url": {}, "form": {} } })
    } else {
        json!({ "elicitation": { "form": {} } })
    };
    let mut params = json!({ "name": tool, "arguments": arguments, "_meta": meta });
    if let Value::Object(extra) = extra {
        for (key, value) in extra {
            params[key] = value;
        }
    }
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params });
    let headers = [
        ("content-type", "application/json"),
        ("accept", "application/json, text/event-stream"),
        ("mcp-protocol-version", "2026-07-28"),
        ("mcp-method", "tools/call"),
        ("mcp-name", tool),
        (support::gateway::ASSERTION, assertion),
    ];
    channel
        .send(channel.request("POST", "/mcp", &headers, body.to_string()))
        .await
}

// ── The flow ───────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_gateway_caller_starts_and_the_person_decides_on_the_direct_listener() {
    let gw = Gateway::start().await;
    let prompt = gw.begin(approve_input()).await;
    // The link names the page's own origin, never the gateway-facing URL.
    assert!(
        prompt.url.starts_with(&format!("{}/d/", gw.origin)),
        "{}",
        prompt.url
    );
    assert_eq!(prompt.id().len(), 26);
    assert_eq!(
        prompt.message,
        "Open the link to review gate-approve (proposal p-1) in main"
    );
    // Pending: asked again with the same link.
    let again = asked(&gw.retry(approve_input(), &prompt.state).await);
    assert_eq!(again.url, prompt.url);

    let decided = gw
        .decide(&gw.browser, &prompt.path(), "ada", "approve")
        .await;
    assert_eq!(decided.status, 200, "{}", decided.text);
    assert!(decided.text.contains("You approved"), "{}", decided.text);

    let ran = result(&gw.retry(approve_input(), &again.state).await);
    assert_eq!(ran["success"], json!(true), "{ran}");
    let runs = gw.seen.of("gate-approve");
    assert_eq!(runs.len(), 1);
    let principal = &runs[0]["principal"];
    // The caller came through the gateway, and the person was proven on the page.
    assert_eq!(principal["authentication"], "gateway", "{principal}");
    assert_eq!(principal["actor"]["onBehalfOf"], "corp/ada", "{principal}");
    assert_eq!(principal["humanPresent"]["level"], "verified");
    assert_eq!(principal["humanPresent"]["method"], "person-page");
    assert_eq!(principal["humanPresent"]["acr"], "phr");
    let validator = support::schema_validator("principal.v1");
    assert!(validator.is_valid(principal), "{principal}");
    assert_eq!(runs[0]["mark"]["surface"], "mcp");
    assert_eq!(runs[0]["mark"]["namespace"], "corp");

    // Replayed: nothing runs; the relay begins again.
    let replay = gw.retry(approve_input(), &again.state).await;
    assert_ne!(asked(&replay).url, prompt.url);
    assert_eq!(gw.seen.runs("gate-approve"), 1);

    let journal = std::fs::read_to_string(gw.dir.path().join("state/journal.jsonl")).unwrap();
    let entry: Value = journal
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|entry| entry["command"] == "person-decide")
        .expect("a person-decide entry");
    assert_eq!(
        entry["input"],
        json!({ "id": prompt.id(), "level": "verified", "decision": "approved" })
    );
}

#[tokio::test]
async fn a_declined_decision_runs_nothing() {
    let gw = Gateway::start().await;
    let prompt = gw.begin(approve_input()).await;
    let declined = gw
        .decide(&gw.browser, &prompt.path(), "ada", "decline")
        .await;
    assert_eq!(declined.status, 200, "{}", declined.text);
    let answer = result(&gw.retry(approve_input(), &prompt.state).await);
    assert_eq!(answer["error"]["code"], "CONFIRMATION_DECLINED", "{answer}");
    assert_eq!(gw.seen.runs("gate-approve"), 0);
}

// ── The gateway never carries the page ─────────────────────────────────────────────────────────

#[tokio::test]
async fn the_gateways_channel_never_carries_the_page() {
    let gw = Gateway::start().await;
    let prompt = gw.begin(approve_input()).await;
    let id = prompt.id();
    // Every page route on the gateway-facing listener is 404, under http.path or at the root,
    // and no page is rendered there.
    for path in [
        format!("/mcp/d/{id}"),
        format!("/d/{id}"),
        "/mcp/d/return?state=x".to_owned(),
        "/d/return?state=x".to_owned(),
        "/mcp/d/style.css".to_owned(),
        "/d/style.css".to_owned(),
    ] {
        let reply = gw.gateway.get(&path, &[]).await;
        assert_eq!(reply.status, 404, "{path}: {}", reply.text);
        assert!(!reply.text.contains("<html"), "{path}: {}", reply.text);
        assert!(!reply.headers.contains_key("set-cookie"), "{path}");
    }
    for path in [format!("/mcp/d/{id}"), format!("/d/{id}")] {
        let reply = gw
            .gateway
            .send(gw.gateway.request(
                "POST",
                &path,
                &[("content-type", "application/x-www-form-urlencoded")],
                "login=x&csrf=y&decision=approve",
            ))
            .await;
        assert_eq!(reply.status, 404, "{path}: {}", reply.text);
    }
    // Even with a valid assertion, the gateway's own channel serves no page.
    let assertion = gw.assertion("ada", "gateway-client");
    let carried = gw
        .gateway
        .get(
            &format!("/mcp/d/{id}"),
            &[(support::gateway::ASSERTION, assertion.as_str())],
        )
        .await;
    assert_eq!(carried.status, 404, "{}", carried.text);

    // The page's own listener serves the page, and nothing of MCP, metadata or the gateway.
    let opened = open(&gw.browser, &prompt.path()).await;
    // The provider is asked to send the person back to the page's own origin.
    let redirect = support::person::query_value(&opened.location, "redirect_uri").unwrap();
    assert_eq!(redirect, format!("{}/d/return", gw.origin));
    assert!(!redirect.starts_with("https://127.0.0.1"), "{redirect}");
    let mcp = gateway_call(
        &gw.browser,
        &gw.assertion("ada", "gateway-client"),
        "fixture-whoami",
        json!({}),
        json!({}),
        true,
    )
    .await;
    assert_eq!(mcp.status, 404, "{}", mcp.text);
    for path in [
        "/mcp",
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
        "/",
    ] {
        assert_eq!(gw.browser.get(path, &[]).await.status, 404, "{path}");
    }
    let health = gw.browser.get("/health", &[]).await;
    assert_eq!(health.status, 200);
    assert_eq!(health.json(), json!({ "status": "ok" }));
    // HTTPS only: every answer, a refusal included, tells the browser so.
    assert_eq!(
        health.headers["strict-transport-security"],
        "max-age=31536000"
    );
    let misdirected = gw
        .browser
        .clone()
        .with_host("127.0.0.1")
        .get("/health", &[])
        .await;
    assert_eq!(
        misdirected.headers["strict-transport-security"],
        "max-age=31536000"
    );
    // Its own host check: the gateway-facing host, or any other, is misdirected, /health too.
    for host in ["127.0.0.1", "evil.example", "localhost.evil.example"] {
        let misdirected = gw.browser.clone().with_host(host);
        assert_eq!(misdirected.get("/health", &[]).await.status, 421, "{host}");
        assert_eq!(
            misdirected.get(&prompt.path(), &[]).await.status,
            421,
            "{host}"
        );
    }
    // TLS only, and no client certificate is asked of a browser: every request above came
    // without one; plain HTTP is no HTTP at all.
    assert!(
        Client::plain(gw.person.address)
            .with_host(gw.browser.host())
            .try_send(gw.browser.request("GET", "/health", &[], ""))
            .await
            .map_or(true, |reply| reply.status != 200)
    );
    assert_eq!(gw.seen.runs("gate-approve"), 0);
}

#[tokio::test]
async fn the_page_listener_has_its_own_body_cap_and_limits() {
    let gw = Gateway::start_with("", "[limits]\nip_requests_per_minute = 40\n").await;
    let prompt = gw.begin(approve_input()).await;
    // A post larger than any decision's form is refused before the page reads it.
    let large = "a".repeat(PAST_BODY_CAP);
    let reply = decide_to(&gw.browser, &prompt.path(), &large, None, Some(&gw.origin)).await;
    assert_eq!(reply.status, 413, "{}", reply.text);
    // Its per-IP limit counts under keys of its own: spending it leaves the gateway-facing
    // listener's untouched.
    let mut statuses = Vec::new();
    for _ in 0..41 {
        statuses.push(gw.browser.get("/health", &[]).await.status);
    }
    assert_eq!(statuses.last(), Some(&429), "{statuses:?}");
    assert_eq!(gw.gateway.get("/health", &[]).await.status, 200);
}

/// One byte more than the person listener's body cap.
const PAST_BODY_CAP: usize = 4097;

#[tokio::test]
async fn the_page_has_a_limit_of_its_own_on_its_listener() {
    let gw = Gateway::start().await;
    let prompt = gw.begin(approve_input()).await;
    for _ in 0..30 {
        assert_eq!(gw.browser.get("/d/style.cs", &[]).await.status, 404);
    }
    let limited = gw.browser.get("/d/style.cs", &[]).await;
    assert_eq!(limited.status, 429, "{}", limited.text);
    assert!(limited.headers.contains_key("retry-after"));
    // A person's flow is counted per decision and per login: unaffected.
    let decided = gw
        .decide(&gw.browser, &prompt.path(), "ada", "approve")
        .await;
    assert_eq!(decided.status, 200, "{}", decided.text);
}

// ── Who the decision is for ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_gateway_asserted_for_that_differs_from_the_logged_in_person_is_refused() {
    let gw = Gateway::start().await;
    // The gateway asserts bo; ada logs in.
    let for_bo = asked(
        &gw.call("bo", "gate-approve", approve_input(), json!({}))
            .await,
    );
    gw.script(ScriptedLogin::user("ada"));
    let logged = login_at_origin(&gw, &for_bo.path()).await;
    assert_eq!(logged.page.status, 403, "{}", logged.page.text);
    assert!(
        logged
            .page
            .text
            .contains("This request is for another person"),
        "{}",
        logged.page.text
    );
    assert!(logged.form.is_none());
    assert!(!logged.page.text.contains("gate-approve"));
    // Nothing recorded: bo's retry is asked again, and nothing ran.
    asked(
        &gw.call(
            "bo",
            "gate-approve",
            approve_input(),
            accepted(&for_bo.state),
        )
        .await,
    );
    // The gateway asserts ada; bo logs in.
    let for_ada = gw.begin(approve_input()).await;
    gw.script(ScriptedLogin::user("bo"));
    let logged = login_at_origin(&gw, &for_ada.path()).await;
    assert_eq!(logged.page.status, 403, "{}", logged.page.text);
    asked(&gw.retry(approve_input(), &for_ada.state).await);
    assert_eq!(gw.seen.runs("gate-approve"), 0);
}

#[tokio::test]
async fn section_4_1s_mapping_holds_for_a_caller_through_the_gateway() {
    let gw = Gateway::start().await;
    // A subject over 120 characters, and one starting with `~`: both hashed, by the gateway's
    // mapping and the page's alike, so the same person matches and another does not.
    for (name, subject) in [("long", "u".repeat(130)), ("tilde", "~ada".to_owned())] {
        gw.kit
            .identity_provider()
            .add_user(User::new(name, "pw").subject(&subject));
        let prompt = asked(
            &gw.call(&subject, "gate-approve", approve_input(), json!({}))
                .await,
        );
        // Someone else first: refused.
        gw.script(ScriptedLogin::user("ada"));
        let wrong = login_at_origin(&gw, &prompt.path()).await;
        assert_eq!(wrong.page.status, 403, "{name}: {}", wrong.page.text);
        // The person the gateway asserted: decided, and run once.
        let decided = gw
            .decide(&gw.browser, &prompt.path(), name, "approve")
            .await;
        assert_eq!(decided.status, 200, "{name}: {}", decided.text);
        let ran = result(
            &gw.call(
                &subject,
                "gate-approve",
                approve_input(),
                accepted(&prompt.state),
            )
            .await,
        );
        assert_eq!(ran["success"], json!(true), "{name}: {ran}");
        let principal = gw.seen.of("gate-approve").pop().unwrap()["principal"].clone();
        let on_behalf = principal["actor"]["onBehalfOf"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(on_behalf.starts_with("corp/~"), "{name}: {on_behalf}");
        assert_eq!(on_behalf.len(), "corp/".len() + 53, "{name}: {on_behalf}");
    }
    assert_eq!(gw.seen.runs("gate-approve"), 2);
}

#[tokio::test]
async fn a_decision_is_bound_to_its_command_input_and_the_gateways_principal() {
    let gw = Gateway::start().await;
    let prompt = gw.begin(approve_input()).await;
    let decided = gw
        .decide(&gw.browser, &prompt.path(), "ada", "approve")
        .await;
    assert_eq!(decided.status, 200, "{}", decided.text);
    // Another input, another command: asked again.
    asked(&gw.retry(json!({ "proposal": "p-2" }), &prompt.state).await);
    asked(
        &gw.call(
            "ada",
            "gate-reject",
            approve_input(),
            accepted(&prompt.state),
        )
        .await,
    );
    // Another person the gateway asserts, presenting ada's state.
    asked(
        &gw.call(
            "bo",
            "gate-approve",
            approve_input(),
            accepted(&prompt.state),
        )
        .await,
    );
    // Another of the gateway's clients acting for ada.
    asked(
        &gw.call_as(
            &gw.gateway,
            "ada",
            "other-client",
            "gate-approve",
            approve_input(),
            accepted(&prompt.state),
            true,
        )
        .await,
    );
    assert_eq!(gw.seen.runs("gate-approve"), 0);
    // A client without URL-mode elicitation: refused before anything is asked.
    let refused = result(
        &gw.call_as(
            &gw.gateway,
            "ada",
            "gateway-client",
            "gate-approve",
            json!({ "proposal": "p-9" }),
            json!({}),
            false,
        )
        .await,
    );
    assert_eq!(refused["error"]["code"], "APPROVAL_REQUIRED", "{refused}");
    // The right caller, command and input run it once.
    let ran = result(&gw.retry(approve_input(), &prompt.state).await);
    assert_eq!(ran["success"], json!(true), "{ran}");
    assert_eq!(gw.seen.runs("gate-approve"), 1);
}

#[tokio::test]
async fn a_decision_runs_once_across_two_hosts() {
    let gw = Gateway::start().await;
    let (_host, _served, _person, other_gateway, other_browser) = gw.second().await;
    let prompt = gw.begin(approve_input()).await;
    // Decided on the second host's page, run through the first host's gateway listener,
    // replayed through the second's.
    let decided = gw
        .decide(&other_browser, &prompt.path(), "ada", "approve")
        .await;
    assert_eq!(decided.status, 200, "{}", decided.text);
    let ran = result(&gw.retry(approve_input(), &prompt.state).await);
    assert_eq!(ran["success"], json!(true), "{ran}");
    let replayed = gw
        .call_as(
            &other_gateway,
            "ada",
            "gateway-client",
            "gate-approve",
            approve_input(),
            accepted(&prompt.state),
            true,
        )
        .await;
    asked(&replayed);
    assert_eq!(gw.seen.runs("gate-approve"), 1);
}

#[tokio::test]
async fn an_expired_decision_is_asked_again_and_an_approved_one_does_not_run_late() {
    let gw = Gateway::start().await;
    let pending = gw.begin(approve_input()).await;
    let approved = gw.begin(json!({ "proposal": "p-late" })).await;
    let decided = gw
        .decide(&gw.browser, &approved.path(), "ada", "approve")
        .await;
    assert_eq!(decided.status, 200, "{}", decided.text);
    gw.clock.advance(601_000);
    gw.host.check_person_logins().await;
    let gone = gw.browser.get(&pending.path(), &[]).await;
    assert_eq!(gone.status, 404, "{}", gone.text);
    assert_ne!(
        asked(&gw.retry(approve_input(), &pending.state).await).url,
        pending.url
    );
    asked(
        &gw.retry(json!({ "proposal": "p-late" }), &approved.state)
            .await,
    );
    assert_eq!(gw.seen.runs("gate-approve"), 0);
}

// ── Step 5's refusals, on the direct listener ──────────────────────────────────────────────────

/// Log in with `script` on a fresh decision; nothing is recorded, and the page the return
/// showed is answered.
async fn refused_login(gw: &Gateway, script: ScriptedLogin) -> Reply {
    let prompt = gw.begin(approve_input()).await;
    gw.script(script);
    let logged = login_at_origin(gw, &prompt.path()).await;
    assert!(logged.form.is_none(), "{}", logged.page.text);
    asked(&gw.retry(approve_input(), &prompt.state).await);
    assert_eq!(gw.seen.runs("gate-approve"), 0);
    logged.page
}

#[tokio::test]
async fn every_login_refusal_of_step_5_holds_on_the_direct_listener() {
    let gw = Gateway::start().await;
    // User verification (owner decision 6).
    for script in [
        ScriptedLogin::user("ada").acr(None),
        ScriptedLogin::user("ada").acr(Some("phrh")),
        ScriptedLogin::user("ada").amr(["pwd"]),
    ] {
        let shown = refused_login(&gw, script).await;
        assert_eq!(shown.status, 403);
        assert!(
            shown.text.contains("PERSON_VERIFICATION_INSUFFICIENT"),
            "{}",
            shown.text
        );
    }
    // A stale login, and a session from before this login began.
    let now = gw.now_s();
    for auth_time in [now - 400, now - 200] {
        let shown = refused_login(&gw, ScriptedLogin::user("ada").auth_time(auth_time)).await;
        assert_eq!(shown.status, 400, "{auth_time}");
    }
    // The ID token: nonce, audience, issuer, expiry, type, azp, iat, nbf, signature.
    let future = now + 3_600;
    for (label, script) in [
        (
            "nonce",
            ScriptedLogin::user("ada").adjust_token(|token| token.nonce("not-the-logins")),
        ),
        (
            "no nonce",
            ScriptedLogin::user("ada").adjust_token(|token| token.without_claim("nonce")),
        ),
        (
            "audience",
            ScriptedLogin::user("ada").adjust_token(|token| token.audience("someone-else")),
        ),
        (
            "issuer",
            ScriptedLogin::user("ada")
                .adjust_token(|token| token.claim("iss", json!("https://evil.example"))),
        ),
        (
            "expired",
            ScriptedLogin::user("ada").adjust_token(|token| token.issued_at(0).lifetime(60)),
        ),
        (
            "typ",
            ScriptedLogin::user("ada")
                .adjust_token(|token| token.header_member("typ", json!("at+jwt"))),
        ),
        (
            "azp",
            ScriptedLogin::user("ada")
                .adjust_token(|token| token.claim("azp", json!("someone-else"))),
        ),
        (
            "iat",
            ScriptedLogin::user("ada").adjust_token(move |token| token.claim("iat", json!(future))),
        ),
        (
            "nbf",
            ScriptedLogin::user("ada").adjust_token(move |token| token.claim("nbf", json!(future))),
        ),
        (
            "signature",
            ScriptedLogin::user("ada")
                .adjust_token(|token| token.break_rule(umbel_testkit_idp::Break::Signature)),
        ),
    ] {
        let shown = refused_login(&gw, script).await;
        assert_eq!(shown.status, 400, "{label}: {}", shown.text);
    }
    // RFC 9207: a response from another issuer, or without `iss` where it is advertised.
    gw.kit
        .identity_provider()
        .set_response_iss(umbel_testkit_idp::ResponseIss::Value(
            "https://evil.example".into(),
        ));
    assert_eq!(
        refused_login(&gw, ScriptedLogin::user("ada")).await.status,
        400
    );
    gw.kit
        .identity_provider()
        .set_response_iss(umbel_testkit_idp::ResponseIss::Omitted);
    assert_eq!(
        refused_login(&gw, ScriptedLogin::user("ada")).await.status,
        400
    );
}

#[tokio::test]
async fn a_replayed_or_forged_state_a_missing_cookie_or_another_logins_code_is_refused() {
    let gw = Gateway::start().await;
    let prompt = gw.begin(approve_input()).await;
    gw.script(ScriptedLogin::user("ada"));
    let opened = open(&gw.browser, &prompt.path()).await;
    let back = authorize_to(&gw.kit, &opened.location, &gw.origin).await;
    let cookie = opened.cookie_header();
    // No cookie, another browser's, then the right one once; replayed, nothing.
    assert_eq!(gw.browser.get(&back, &[]).await.status, 400);
    let wrong = format!("{}=not-the-browsers", opened.cookie.0);
    assert_eq!(
        gw.browser
            .get(&back, &[("cookie", wrong.as_str())])
            .await
            .status,
        400
    );
    assert_eq!(
        gw.browser
            .get(&back, &[("cookie", cookie.as_str())])
            .await
            .status,
        200
    );
    assert_eq!(
        gw.browser
            .get(&back, &[("cookie", cookie.as_str())])
            .await
            .status,
        400
    );
    // A forged state's MAC.
    gw.script(ScriptedLogin::user("ada"));
    let opened = open(&gw.browser, &prompt.path()).await;
    let back = authorize_to(&gw.kit, &opened.location, &gw.origin).await;
    let state = opened.state();
    let forged = back.replace(&state, &format!("{}x", &state[..state.len() - 1]));
    assert_eq!(
        gw.browser
            .get(&forged, &[("cookie", opened.cookie_header().as_str())])
            .await
            .status,
        400
    );
    // Another login's code fails its PKCE.
    gw.script(ScriptedLogin::user("ada"));
    let first = open(&gw.browser, &prompt.path()).await;
    let first_back = authorize_to(&gw.kit, &first.location, &gw.origin).await;
    gw.script(ScriptedLogin::user("ada"));
    let second = open(&gw.browser, &prompt.path()).await;
    let second_back = authorize_to(&gw.kit, &second.location, &gw.origin).await;
    let code = support::person::query_value(&first_back, "code").unwrap();
    let injected = second_back.replace(
        &support::person::query_value(&second_back, "code").unwrap(),
        &code,
    );
    let refused = gw
        .browser
        .get(&injected, &[("cookie", second.cookie_header().as_str())])
        .await;
    assert_eq!(refused.status, 400, "{}", refused.text);
    assert!(form(&refused.text).is_none());
    assert_eq!(gw.seen.runs("gate-approve"), 0);
}

#[tokio::test]
async fn the_page_on_its_own_origin_is_unframed_uncached_escaped_and_cookie_bound() {
    let gw = Gateway::start().await;
    let prompt = gw.begin(json!({ "proposal": "xss" })).await;
    gw.script(ScriptedLogin::user("ada"));
    let logged = login_at_origin(&gw, &prompt.path()).await;
    let shown = &logged.page;
    assert_eq!(shown.status, 200, "{}", shown.text);
    for (name, value) in [
        (
            "content-security-policy",
            "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        ),
        ("x-frame-options", "DENY"),
        ("referrer-policy", "no-referrer"),
        ("cache-control", "no-store"),
        ("x-content-type-options", "nosniff"),
    ] {
        assert_eq!(shown.headers[name].to_str().unwrap(), value, "{name}");
    }
    assert_eq!(
        logged.opened.reply.headers["referrer-policy"],
        "no-referrer"
    );
    // The style sheet and the form are the page's own origin's root.
    assert!(
        shown.text.contains("href=\"/d/style.css\""),
        "{}",
        shown.text
    );
    assert!(
        shown
            .text
            .contains(&format!("action=\"/d/{}\"", prompt.id())),
        "{}",
        shown.text
    );
    assert!(!shown.text.to_ascii_lowercase().contains("<script"));
    assert!(
        shown.text.contains("&lt;script&gt;alert(1)&lt;/script&gt;"),
        "{}",
        shown.text
    );
    // Who asked: the gateway's client acting for ada.
    assert!(shown.text.contains("corp/gateway-client"), "{}", shown.text);
    // A `__Host-` cookie with every flag, set by the page's own origin.
    let set_cookie = logged.opened.reply.headers["set-cookie"].to_str().unwrap();
    assert!(
        set_cookie.starts_with("__Host-umbel-person-"),
        "{set_cookie}"
    );
    for flag in ["Path=/", "Secure", "HttpOnly", "SameSite=Lax"] {
        assert!(set_cookie.contains(flag), "{set_cookie}");
    }
    assert!(!set_cookie.contains("Domain"), "{set_cookie}");
}

#[tokio::test]
async fn a_decision_needs_the_pages_own_origin_csrf_token_cookie_and_login() {
    let gw = Gateway::start().await;
    let prompt = gw.begin(approve_input()).await;
    gw.script(ScriptedLogin::user("ada"));
    let logged = login_at_origin(&gw, &prompt.path()).await;
    let (login_id, csrf) = logged.form.clone().unwrap();
    let cookie = logged.opened.cookie_header();
    let path = prompt.path();
    let fields = |csrf: &str| format!("login={login_id}&csrf={csrf}&decision=approve");
    let origin = gw.origin.as_str();
    for (fields, cookie, origin) in [
        // The gateway-facing origin is another origin: refused.
        (
            fields(&csrf),
            Some(cookie.as_str()),
            Some("https://127.0.0.1"),
        ),
        (fields(&csrf), Some(cookie.as_str()), None),
        (
            fields(&csrf),
            Some(cookie.as_str()),
            Some("https://evil.example"),
        ),
        (fields(&csrf), Some(cookie.as_str()), Some("null")),
        (fields("forged"), Some(cookie.as_str()), Some(origin)),
        (
            format!("login={login_id}&decision=approve"),
            Some(cookie.as_str()),
            Some(origin),
        ),
        (fields(&csrf), None, Some(origin)),
        (fields(&csrf), Some("__Host-umbel-person-x=y"), Some(origin)),
        (
            format!("{}&extra=1", fields(&csrf)),
            Some(cookie.as_str()),
            Some(origin),
        ),
    ] {
        let refused = decide_to(&gw.browser, &path, &fields, cookie, origin).await;
        assert_eq!(refused.status, 403, "{fields} {origin:?}: {}", refused.text);
    }
    // `Origin: null` is admitted only with the browser's own `Sec-Fetch-Site: same-origin`.
    for site in ["same-site", "cross-site", "none"] {
        let refused = gw
            .browser
            .send(gw.browser.request(
                "POST",
                &path,
                &[
                    ("content-type", "application/x-www-form-urlencoded"),
                    ("cookie", cookie.as_str()),
                    ("origin", "null"),
                    ("sec-fetch-site", site),
                ],
                fields(&csrf),
            ))
            .await;
        assert_eq!(refused.status, 403, "{site}: {}", refused.text);
    }
    asked(&gw.retry(approve_input(), &prompt.state).await);
    // A same-origin post under the page's no-referrer policy.
    let fine = gw
        .browser
        .send(gw.browser.request(
            "POST",
            &path,
            &[
                ("content-type", "application/x-www-form-urlencoded"),
                ("cookie", cookie.as_str()),
                ("origin", "null"),
                ("sec-fetch-site", "same-origin"),
            ],
            fields(&csrf),
        ))
        .await;
    assert_eq!(fine.status, 200, "{}", fine.text);
    let again = decide_to(
        &gw.browser,
        &path,
        &fields(&csrf),
        Some(&cookie),
        Some(origin),
    )
    .await;
    assert_eq!(again.status, 403);
    let ran = result(&gw.retry(approve_input(), &prompt.state).await);
    assert_eq!(ran["success"], json!(true), "{ran}");
}

#[tokio::test]
async fn the_page_never_shows_or_keeps_what_it_must_not() {
    let gw = Gateway::start().await;
    let prompt = gw
        .begin(json!({ "proposal": "canary", "reason": "reason-canary-5b" }))
        .await;
    let opened = open(&gw.browser, &prompt.path()).await;
    assert!(!opened.reply.text.contains("gate-approve"));
    // The message names the id the preview reads (step 6), never the preview's text nor an input
    // the preview does not read.
    assert_eq!(
        prompt.message,
        "Open the link to review gate-approve (proposal canary) in main"
    );
    assert!(!prompt.message.contains(PREVIEW_CANARY) && !prompt.message.contains("reason"));
    let unknown = gw.browser.get("/d/aaaaaaaaaaaaaaaaaaaaaaaaaa", &[]).await;
    assert_eq!(unknown.status, 404);
    gw.script(ScriptedLogin::user("ada"));
    let logged = login_at_origin(&gw, &prompt.path()).await;
    assert!(
        logged.page.text.contains(PREVIEW_CANARY),
        "{}",
        logged.page.text
    );
    let preview_call = gw.seen.of("gate-preview").pop().unwrap();
    assert_eq!(preview_call["input"], json!({ "proposal": "canary" }));
    assert_eq!(
        preview_call["principal"]["actor"],
        json!({ "kind": "human", "id": "corp/ada" })
    );
    // A failing preview leaves only Decline, and an approval through it is refused.
    let failing = gw.begin(json!({ "proposal": "fail" })).await;
    gw.script(ScriptedLogin::user("ada"));
    let logged = login_at_origin(&gw, &failing.path()).await;
    assert!(!logged.page.text.contains("value=\"approve\""));
    let (login_id, csrf) = logged.form.unwrap();
    let approve = decide_to(
        &gw.browser,
        &failing.path(),
        &format!("login={login_id}&csrf={csrf}&decision=approve"),
        Some(&logged.opened.cookie_header()),
        Some(&gw.origin),
    )
    .await;
    assert_eq!(approve.status, 403);
    for entry in walk(gw.dir.path()) {
        let bytes = std::fs::read(&entry).unwrap();
        for canary in [PREVIEW_CANARY, "reason-canary-5b"] {
            assert!(
                !bytes
                    .windows(canary.len())
                    .any(|window| window == canary.as_bytes()),
                "{canary} in {}",
                entry.display()
            );
        }
    }
}

fn walk(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut found = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            found.extend(walk(&path));
        } else {
            found.push(path);
        }
    }
    found
}

// ── Serving ────────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn verified_commands_are_served_in_mode_gateway_only_with_the_pages_own_listener() {
    // With [http.person]: registered for MCP, host-verified.
    let gw = Gateway::start().await;
    let definition = gw.host.registry().get("gate-approve").unwrap();
    assert!(definition.expose.mcp);
    assert!(definition.confirmation_mode.is_some());
    drop(gw);
    // Without it: as step 5 left mode gateway, nothing is served and no listener is built.
    let kit = TestIdp::start().await.unwrap();
    let dir = support::workspace(&config(&kit, "", "", ""));
    support::gateway::write_keys(dir.path(), &kit);
    let clock = afd::fixed_clock(support::oauth::now_ms());
    let seen = Seen::default();
    let host = support::person::host(dir.path(), &kit, &clock, &seen);
    assert!(!host.registry().get("gate-approve").unwrap().expose.mcp);
    assert!(host.person_server().unwrap().is_none());
    // With it, but without filtered listings: nothing served either.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let dir = support::workspace(&config(
        &kit,
        &person_table(port),
        "filter_tools_by_scope = false",
        "",
    ));
    support::gateway::write_keys(dir.path(), &kit);
    write_person_tls(dir.path(), kit.ca(), &["127.0.0.1", "localhost"]);
    let host = support::person::host(dir.path(), &kit, &clock, &seen);
    assert!(!host.registry().get("gate-approve").unwrap().expose.mcp);
    assert!(host.person_server().unwrap().is_none());
}

#[tokio::test]
async fn a_namespace_whose_login_fails_auth_person_is_not_served_through_the_gateway() {
    let gw = Gateway::start().await;
    gw.kit
        .identity_provider()
        .set_metadata_patch(Some(json!({ "acr_values_supported": ["other"] })));
    let (_host, _served, _person, other_gateway, _browser) = gw.second().await;
    let unknown = result(
        &gw.call_as(
            &other_gateway,
            "ada",
            "gateway-client",
            "gate-approve",
            approve_input(),
            json!({}),
            true,
        )
        .await,
    );
    assert_eq!(unknown["error"]["code"], "COMMAND_NOT_FOUND", "{unknown}");
    assert_eq!(gw.seen.runs("gate-approve"), 0);
}

#[tokio::test]
async fn the_cli_gives_the_pages_own_origin_in_mode_gateway() {
    let gw = Gateway::start().await;
    let console = Arc::new(Shown::default());
    let cli = {
        let dir = gw.dir.path().to_path_buf();
        let console: Arc<dyn umbel::cli::Console> = console.clone();
        let kit_ca = gw.kit.ca().certificate_pem().to_owned();
        let seen = gw.seen.clone();
        async move {
            support::cli_with(
                &dir,
                &["call", "gate-approve", "proposal=p-cli"],
                console,
                move |builder| {
                    builder
                        .with_compiled(support::person::plugin(&seen))
                        .register(support::oauth::whoami())
                        .register(support::oauth::touch())
                        .with_auth_root_certificate(kit_ca.into_bytes())
                        .with_auth_secret("UMBEL_TEST_PERSON_SECRET", SECRET)
                },
            )
            .await
        }
    };
    let browser = async {
        let url = wait_for_url(&console).await;
        assert!(url.starts_with(&format!("{}/d/", gw.origin)), "{url}");
        let path = support::person::path_of(&url);
        let decided = gw.decide(&gw.browser, &path, "ada", "approve").await;
        assert_eq!(decided.status, 200, "{}", decided.text);
    };
    let run = {
        tokio::pin!(cli);
        tokio::select! {
            run = &mut cli => panic!("the CLI ended before the person decided: {}", run.stdout),
            () = browser => cli.await,
        }
    };
    assert_eq!(run.json()["success"], json!(true), "{}", run.stdout);
    let runs = gw.seen.of("gate-approve");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["mark"]["surface"], "cli");
}

/// A console that records what it showed.
#[derive(Default)]
struct Shown(std::sync::Mutex<Vec<String>>);

impl umbel::cli::Console for Shown {
    fn is_interactive(&self) -> bool {
        false
    }
    fn ask(&self, _: &str) -> bool {
        false
    }
    fn show(&self, text: &str) {
        self.0.lock().unwrap().push(text.to_owned());
    }
}

/// The link the CLI showed, within ten seconds.
async fn wait_for_url(console: &Shown) -> String {
    for _ in 0..200 {
        let found = console
            .0
            .lock()
            .unwrap()
            .iter()
            .find_map(|text| text.lines().find(|line| line.starts_with("https://")))
            .map(str::to_owned);
        if let Some(url) = found {
            return url;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    panic!("the CLI showed no link: {:?}", console.0.lock().unwrap());
}

#[tokio::test]
async fn the_pages_own_host_check_holds_beside_its_listeners() {
    // A second name the listener answers is not the page's public host: /health is served on
    // it, the page is not.
    let gw = Gateway::start_options(&Options {
        person_hosts: ", \"alias.example\"",
        ..Options::default()
    })
    .await;
    let prompt = gw.begin(approve_input()).await;
    let alias = gw.browser.clone().with_host("alias.example");
    assert_eq!(alias.get("/health", &[]).await.status, 200);
    assert_eq!(alias.get(&prompt.path(), &[]).await.status, 421);
    assert_eq!(alias.get("/d/style.css", &[]).await.status, 421);
}

#[tokio::test]
async fn the_pages_listener_reads_no_proxy_header() {
    // http.trusted_proxies names this host's address: the gateway-facing listener then demands
    // a PROXY protocol header of it, and the page's own listener reads none.
    let gw = Gateway::start_options(&Options {
        http: "trusted_proxies = [\"127.0.0.1\"]",
        ..Options::default()
    })
    .await;
    assert_eq!(gw.browser.get("/health", &[]).await.status, 200);
    let refused = gw
        .gateway
        .try_send(gw.gateway.request("GET", "/health", &[], ""))
        .await;
    assert!(
        refused.as_ref().map_or(true, |reply| reply.status != 200),
        "{:?}",
        refused.map(|reply| reply.status)
    );
}

#[tokio::test]
async fn in_mode_gateway_a_phishable_class_fails_auth_person_and_nothing_is_served() {
    let gw = Gateway::start_options(&Options {
        acr: "\"phr\", \"mfa\"",
        ..Options::default()
    })
    .await;
    // The namespace's login fails auth.person, so its verified commands are names that do not
    // exist, and nothing runs.
    let unknown = result(
        &gw.call("ada", "gate-approve", approve_input(), json!({}))
            .await,
    );
    assert_eq!(unknown["error"]["code"], "COMMAND_NOT_FOUND", "{unknown}");
    let (status, message) = doctor_check(gw.dir.path(), &gw.kit, "auth.person").await;
    assert_eq!(status, "fail", "{message}");
    assert!(message.contains("allows mfa"), "{message}");
    assert!(message.contains("not phishing-resistant"), "{message}");
    assert_eq!(gw.seen.runs("gate-approve"), 0);
    // phr and phrh alone: served.
    let gw = Gateway::start_options(&Options {
        acr: "\"phr\", \"phrh\"",
        ..Options::default()
    })
    .await;
    gw.begin(approve_input()).await;
    let (status, message) = doctor_check(gw.dir.path(), &gw.kit, "auth.person").await;
    assert_eq!(status, "pass", "{message}");
}

#[tokio::test]
async fn in_mode_oauth_a_phishable_class_warns() {
    let kit = TestIdp::start().await.unwrap();
    kit.identity_provider()
        .set_metadata_patch(Some(json!({ "acr_values_supported": ["phr", "mfa"] })));
    let text = support::oauth::config(
        &kit,
        &support::oauth::Setup {
            rest: support::person::REST,
            ..support::oauth::Setup::default()
        },
    );
    let phishable = text.replace("acr_values = [\"phr\"]", "acr_values = [\"phr\", \"mfa\"]");
    assert_ne!(phishable, text);
    let dir = support::workspace(&phishable);
    let (status, message) = doctor_check(dir.path(), &kit, "auth.person").await;
    assert_eq!(status, "warn", "{message}");
    assert!(message.contains("not phishing-resistant"), "{message}");
    assert!(message.contains("through the MCP client"), "{message}");
    let dir = support::workspace(&text);
    let (status, message) = doctor_check(dir.path(), &kit, "auth.person").await;
    assert_eq!(status, "pass", "{message}");
}

// ── Configuration ──────────────────────────────────────────────────────────────────────────────

/// A gateway workspace with no network behind it, and `[http.person]` from [`PERSON`].
const BASE: &str = r#"config_version = 5

[principal]
local_id = "corp/ada"

[http]
public_url = "https://umbel.example.com/mcp"
allowed_hosts = ["umbel.example.com"]

[auth]
mode = "gateway"

[auth.namespaces.corp]

[auth.gateway]
alias = "edge"
namespace = "corp"
issuer = "https://gateway.example.com"
keys = "gateway/jwks.json"
max_scopes = ["umbel:read"]
"#;

/// The same deployment in mode `oauth`, which serves the page beside the MCP path.
const OAUTH: &str = r#"config_version = 5

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
"#;

const PERSON: &str = r#"
[http.person]
bind = "0.0.0.0:8444"
public_url = "https://person.example.com"
allowed_hosts = ["person.example.com"]

[http.person.tls]
cert = "tls/person.pem"
key = "tls/person-key.pem"
"#;

fn opened(text: &str) -> Result<umbel::Workspace, umbel::workspace::WorkspaceError> {
    opened_with(text, &umbel::workspace::Overrides::default())
}

fn opened_with(
    text: &str,
    overrides: &umbel::workspace::Overrides,
) -> Result<umbel::Workspace, umbel::workspace::WorkspaceError> {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("umbel.toml"), text).unwrap();
    umbel::Workspace::open_located(
        &umbel::workspace::Located {
            root: dir.path().to_path_buf(),
            found_by: umbel::workspace::FoundBy::Flag,
        },
        overrides,
    )
}

#[track_caller]
fn refused(text: &str, key: &str) {
    let error = opened(text)
        .err()
        .unwrap_or_else(|| panic!("opened: {text}"));
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{error}");
    assert_eq!(error.key(), Some(key), "{text}: {error}");
}

#[test]
fn the_pages_own_listener_is_read_with_every_rule_of_its_own() {
    let workspace = opened(&format!("{BASE}{PERSON}")).unwrap();
    let person = workspace.config().http.person.clone().unwrap();
    assert_eq!(person.public_url, "https://person.example.com");
    assert_eq!(person.bind.to_string(), "0.0.0.0:8444");
    assert_eq!(person.allowed_hosts, ["person.example.com"]);
    assert_eq!(person.tls.client_auth, umbel::workspace::ClientAuth::None);
    assert!(person.tls.client_ca.is_none());
    // A port, written as a browser writes it, and another host of the same domain.
    let with_port = PERSON.replace(
        "public_url = \"https://person.example.com\"",
        "public_url = \"https://person.example.com:8444\"",
    );
    assert!(opened(&format!("{BASE}{with_port}")).is_ok());

    let with = |from: &str, to: &str| {
        let person = PERSON.replace(from, to);
        assert_ne!(person, PERSON, "{from}");
        format!("{BASE}{person}")
    };
    // Only in mode gateway: mode oauth serves the page beside the MCP path, mode none none.
    assert!(opened(OAUTH).is_ok());
    refused(&format!("{OAUTH}{PERSON}"), "http.person");
    refused(&format!("config_version = 5\n{PERSON}"), "http.person");
    // Every key required.
    refused(&with("bind = \"0.0.0.0:8444\"\n", ""), "http.person.bind");
    refused(
        &with("public_url = \"https://person.example.com\"\n", ""),
        "http.person.public_url",
    );
    refused(
        &with("allowed_hosts = [\"person.example.com\"]\n", ""),
        "http.person.allowed_hosts",
    );
    refused(
        &with(
            "allowed_hosts = [\"person.example.com\"]",
            "allowed_hosts = []",
        ),
        "http.person.allowed_hosts",
    );
    refused(
        &with(
            "\n[http.person.tls]\ncert = \"tls/person.pem\"\nkey = \"tls/person-key.pem\"\n",
            "",
        ),
        "http.person.tls",
    );
    refused(
        &with("key = \"tls/person-key.pem\"\n", ""),
        "http.person.tls.key",
    );
    refused(
        &with("cert = \"tls/person.pem\"", "cert = \"../person.pem\""),
        "http.person.tls.cert",
    );
    refused(
        &with(
            "bind = \"0.0.0.0:8444\"",
            "bind = \"person.example.com:8444\"",
        ),
        "http.person.bind",
    );
    // No client certificate is ever asked of a browser.
    refused(
        &with(
            "key = \"tls/person-key.pem\"\n",
            "key = \"tls/person-key.pem\"\nclient_auth = \"ca\"\nclient_ca = \"tls/ca.pem\"\n",
        ),
        "http.person.tls.client_auth",
    );
    refused(
        &with(
            "bind = \"0.0.0.0:8444\"\n",
            "bind = \"0.0.0.0:8444\"\npath = \"/p\"\n",
        ),
        "http.person.path",
    );
    // The public origin: https, an origin alone, canonical, admitted by its own hosts.
    for url in [
        "http://person.example.com",
        "https://person.example.com/",
        "https://person.example.com/mcp",
        "https://person.example.com?x=1",
        "https://u@person.example.com",
        "https://Person.example.com",
        "https://person.example.com:443",
        "https://person.example.com:08444",
        "https://other.example.com",
    ] {
        refused(
            &with(
                "public_url = \"https://person.example.com\"",
                &format!("public_url = \"{url}\""),
            ),
            "http.person.public_url",
        );
    }
    // Not the gateway-facing host, on any port: browsers send a host's cookies to every port.
    refused(
        &with(
            "public_url = \"https://person.example.com\"\nallowed_hosts = [\"person.example.com\"]",
            "public_url = \"https://umbel.example.com:8444\"\nallowed_hosts = [\"umbel.example.com:8444\"]",
        ),
        "http.person.public_url",
    );
    // No host both listeners answer.
    refused(
        &with(
            "allowed_hosts = [\"person.example.com\"]",
            "allowed_hosts = [\"person.example.com\", \"umbel.example.com:9000\"]",
        ),
        "http.person.allowed_hosts",
    );
    refused(
        &with(
            "allowed_hosts = [\"person.example.com\"]",
            "allowed_hosts = [\"person.example.com\", \"*.example.com\"]",
        ),
        "http.person.allowed_hosts",
    );
    // Its own address: never http.bind's port on an address both could hold.
    for bind in ["127.0.0.1:7410", "0.0.0.0:7410", "[::]:7410"] {
        refused(
            &with("bind = \"0.0.0.0:8444\"", &format!("bind = \"{bind}\"")),
            "http.person.bind",
        );
    }
    assert!(opened(&with("bind = \"0.0.0.0:8444\"", "bind = \"10.0.0.7:7410\"")).is_ok());
    // A bind override that would take its port is refused too.
    // Canonical hosts: one spelling per origin, as a URL parser writes it.
    for url in [
        "https://127.1",
        "https://2130706433",
        "https://[0::1]",
        "https://person.example.com.",
        "https://-person.example.com",
    ] {
        refused(
            &with(
                "public_url = \"https://person.example.com\"",
                &format!("public_url = \"{url}\""),
            ),
            "http.person.public_url",
        );
    }
    for entry in [
        "Person.example.com",
        "person.example.com.",
        "127.1",
        "[0::1]",
    ] {
        refused(
            &with(
                "allowed_hosts = [\"person.example.com\"]",
                &format!("allowed_hosts = [\"person.example.com\", \"{entry}\"]"),
            ),
            "http.person.allowed_hosts",
        );
    }
    // An http.allowed_hosts entry the public URL's parser would not read is refused too.
    for entry in ["-bad.example", "umbel.example.com:0", "umbel.example.com:"] {
        refused(
            &format!(
                "{}{PERSON}",
                BASE.replace(
                    "allowed_hosts = [\"umbel.example.com\"]",
                    &format!("allowed_hosts = [\"umbel.example.com\", \"{entry}\"]"),
                )
            ),
            "http.allowed_hosts",
        );
    }
    // Not the gateway's own host, which its issuer names.
    refused(
        &with(
            "public_url = \"https://person.example.com\"\nallowed_hosts = [\"person.example.com\"]",
            "public_url = \"https://gateway.example.com\"\nallowed_hosts = [\"gateway.example.com\"]",
        ),
        "http.person.public_url",
    );
    // An IPv4-mapped IPv6 address is the IPv4 address it maps.
    refused(
        &with(
            "bind = \"0.0.0.0:8444\"",
            "bind = \"[::ffff:127.0.0.1]:7410\"",
        ),
        "http.person.bind",
    );
    // The person bind override (--person-bind, UMBEL_HTTP_PERSON_BIND): set, refused where it
    // clashes or names no address, and refused where there is no [http.person].
    let person_bind = |bind: &str| umbel::workspace::Overrides {
        http_person_bind: Some(bind.to_owned()),
        ..umbel::workspace::Overrides::default()
    };
    let moved = opened_with(&format!("{BASE}{PERSON}"), &person_bind("10.0.0.9:9444")).unwrap();
    assert_eq!(
        moved
            .config()
            .http
            .person
            .as_ref()
            .unwrap()
            .bind
            .to_string(),
        "10.0.0.9:9444"
    );
    for bind in ["127.0.0.1:7410", "person.example.com:1"] {
        let Err(error) = opened_with(&format!("{BASE}{PERSON}"), &person_bind(bind)) else {
            panic!("the person bind override {bind} was taken");
        };
        assert_eq!(error.key(), Some("http.person.bind"), "{error}");
    }
    let Err(error) = opened_with(BASE, &person_bind("127.0.0.1:9444")) else {
        panic!("a person bind override without [http.person] was taken");
    };
    assert_eq!(error.key(), Some("http.person.bind"), "{error}");
    let overrides = umbel::workspace::Overrides {
        http_bind: Some("127.0.0.1:8444".to_owned()),
        ..umbel::workspace::Overrides::default()
    };
    let Err(error) = opened_with(&format!("{BASE}{PERSON}"), &overrides) else {
        panic!("the override clashes");
    };
    assert_eq!(error.key(), Some("http.person.bind"), "{error}");
    // A version 4 file has no such table.
    let v4 = opened(&format!("config_version = 4\n{PERSON}"))
        .err()
        .unwrap();
    assert_eq!(v4.code(), "WORKSPACE_CONFIG_INVALID");
    assert!(v4.message().contains("http.person"), "{v4}");
}

#[test]
fn the_schema_admits_and_refuses_the_pages_own_listener_as_the_host_does() {
    let validator = support::schema_validator("workspace-config.v5");
    let json = |text: &str| -> Value {
        serde_json::to_value(text.parse::<toml::Table>().unwrap()).unwrap()
    };
    let good = format!("{BASE}{PERSON}");
    assert!(validator.is_valid(&json(&good)), "{good}");
    assert!(opened(&good).is_ok());
    assert!(validator.is_valid(&json(OAUTH)));
    let bad = [
        format!("{OAUTH}{PERSON}"),
        format!(
            "{BASE}{}",
            PERSON.replace(
                "\"https://person.example.com\"",
                "\"https://person.example.com/\""
            )
        ),
        format!(
            "{BASE}{}",
            PERSON.replace(
                "\"https://person.example.com\"",
                "\"https://person.example.com:443\""
            )
        ),
        format!(
            "{BASE}{}",
            PERSON.replace(
                "\"https://person.example.com\"",
                "\"http://person.example.com\""
            )
        ),
        format!(
            "{BASE}{}",
            PERSON.replace(
                "key = \"tls/person-key.pem\"\n",
                "key = \"tls/person-key.pem\"\nclient_auth = \"none\"\n"
            )
        ),
        format!(
            "{BASE}{}",
            PERSON.replace(
                "allowed_hosts = [\"person.example.com\"]",
                "allowed_hosts = []"
            )
        ),
        format!("{BASE}{}", PERSON.replace("bind = \"0.0.0.0:8444\"\n", "")),
    ];
    for text in &bad {
        assert!(
            !validator.is_valid(&json(text)),
            "the schema accepted {text}"
        );
        assert!(opened(text).is_err(), "the host accepted {text}");
    }
}

// ── The doctor ─────────────────────────────────────────────────────────────────────────────────

/// `auth.person_listener`'s status and message from `umbel workspace doctor` at `dir`.
async fn person_check(dir: &Path, kit: &TestIdp) -> (String, String) {
    doctor_check(dir, kit, "auth.person_listener").await
}

/// The check `id`'s status and message from `umbel workspace doctor` at `dir`.
async fn doctor_check(dir: &Path, kit: &TestIdp, id: &str) -> (String, String) {
    let ca = kit.ca().certificate_pem().as_bytes().to_vec();
    let run = support::cli_with(
        dir,
        &["workspace", "doctor"],
        support::Scripted::no_terminal(),
        move |builder| {
            // The workspace's own commands, so the host seals and the doctor runs as a sealed
            // host's, with the kit's CA standing in for the platform's roots.
            builder
                .with_compiled(support::person::plugin(&Seen::default()))
                .register(support::oauth::whoami())
                .register(support::oauth::touch())
                .with_auth_root_certificate(ca)
                .with_auth_secret("UMBEL_TEST_PERSON_SECRET", SECRET)
        },
    )
    .await;
    let value = run.json();
    // The hosted profile ran with the test seams: the kit's issuer was reached.
    let issuers = value
        .pointer("/data/checks")
        .or_else(|| value.pointer("/error/details/checks"))
        .and_then(Value::as_array)
        .and_then(|checks| checks.iter().find(|check| check["id"] == "auth.issuers"))
        .cloned()
        .unwrap_or_default();
    assert_eq!(issuers["status"], "pass", "{issuers}");
    let data = if value["success"] == json!(true) {
        &value["data"]
    } else {
        &value["error"]["details"]
    };
    let check = data["checks"]
        .as_array()
        .unwrap_or_else(|| panic!("{}", run.stdout))
        .iter()
        .find(|check| check["id"] == id)
        .unwrap_or_else(|| panic!("no {id} in {}", run.stdout))
        .clone();
    (
        check["status"].as_str().unwrap().to_owned(),
        check["message"].as_str().unwrap().to_owned(),
    )
}

/// A TLS server at `listener` that answers every request with `response`, as something other
/// than the page would.
fn impostor(
    listener: TcpListener,
    certificate_pem: &str,
    key_pem: &str,
    response: &'static str,
) -> tokio::task::JoinHandle<()> {
    use tokio_rustls::rustls;
    use tokio_rustls::rustls::pki_types::pem::PemObject;
    use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer};
    let config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![CertificateDer::from_pem_slice(certificate_pem.as_bytes()).unwrap()],
        PrivateKeyDer::from_pem_slice(key_pem.as_bytes()).unwrap(),
    )
    .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
    tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            let acceptor = acceptor.clone();
            tokio::spawn(async move {
                if let Ok(mut tls) = acceptor.accept(tcp).await {
                    let mut buffer = vec![0u8; 8192];
                    let _ = tls.read(&mut buffer).await;
                    let _ = tls.write_all(response.as_bytes()).await;
                    let _ = tls.shutdown().await;
                }
            });
        }
    })
}

/// The page's own answer to `GET /d/style.css`, headers and all, as an impostor would copy it.
const COPIED: &str = "HTTP/1.1 200 OK\r\ncontent-type: text/css\r\ncache-control: no-store\r\ncontent-security-policy: default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'\r\nx-frame-options: DENY\r\nreferrer-policy: no-referrer\r\nstrict-transport-security: max-age=31536000\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok";

#[tokio::test]
async fn the_doctor_checks_the_pages_own_listener() {
    let gw = Gateway::start().await;
    // Served: reachable with its certificate and headers; both binds loopback fails, since the
    // gateway may then be what carries the page.
    let (status, message) = person_check(gw.dir.path(), &gw.kit).await;
    assert_eq!(status, "fail", "{message}");
    assert!(
        message.contains("with the configured certificate and its own Content-Security-Policy"),
        "{message}"
    );
    assert!(message.contains("are both loopback"), "{message}");
    // It claims only what Umbel knows of the gateway's hosts, and names the deployer's duty.
    assert!(
        message.contains("is neither http.public_url's nor auth.gateway.issuer's"),
        "{message}"
    );
    assert!(
        message.contains("neither serves localhost nor holds a certificate for it"),
        "{message}"
    );
    let port = gw.person.address.port();
    let (kit, dir) = (gw.kit, gw.dir);
    drop((gw.person, gw.served, gw.host));

    // Not running: unreachable warns.
    let (_, message) = person_check(dir.path(), &kit).await;
    assert!(message.contains("cannot be reached"), "{message}");

    let read =
        |name: &str| std::fs::read_to_string(dir.path().join("person-tls").join(name)).unwrap();
    let (ours, our_key) = (read("cert.pem"), read("key.pem"));
    let run = |certificate: String, key: String, response: &'static str| {
        let kit = &kit;
        let dir = &dir;
        async move {
            let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
            let task = impostor(listener, &certificate, &key, response);
            let found = person_check(dir.path(), kit).await;
            task.abort();
            let _ = task.await;
            found
        }
    };
    // The page's headers copied behind another certificate: something terminates its TLS.
    let other = kit
        .ca()
        .server_certificate(&["127.0.0.1", "localhost"])
        .unwrap();
    let (status, message) = run(
        other.certificate_pem().to_owned(),
        other.private_key_pem().to_owned(),
        COPIED,
    )
    .await;
    assert_eq!(status, "fail", "{message}");
    assert!(
        message.contains("presented another certificate"),
        "{message}"
    );
    // The configured certificate, but answers that are not the page's: rewritten headers, or
    // another status.
    let (status, message) = run(
        ours.clone(),
        our_key.clone(),
        "HTTP/1.1 200 OK\r\ncontent-type: text/css\r\ncontent-security-policy: default-src *\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok",
    )
    .await;
    assert_eq!(status, "fail", "{message}");
    assert!(
        message.contains("answered without its own content-security-policy"),
        "{message}"
    );
    let (status, message) = run(
        ours.clone(),
        our_key.clone(),
        "HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
    )
    .await;
    assert_eq!(status, "fail", "{message}");
    assert!(message.contains("answered 404"), "{message}");
    // The page's own answer from the configured certificate passes the probe.
    let (_, message) = run(ours, our_key, COPIED).await;
    assert!(
        message.contains("with the configured certificate and its own Content-Security-Policy"),
        "{message}"
    );
}

#[tokio::test]
async fn the_doctor_warns_on_a_loopback_page_where_the_gateway_is_not_and_says_when_it_is_not_served()
 {
    let kit = TestIdp::start().await.unwrap();
    // The gateway on a pinned, non-loopback channel; the page alone on loopback: a warning.
    let port = free_port().await;
    let dir = support::workspace(&config_with(
        &kit,
        &person_table(port),
        &Options {
            pinned: true,
            http: "bind = \"0.0.0.0:8443\"",
            ..Options::default()
        },
    ));
    support::gateway::write_keys(dir.path(), &kit);
    support::hosted::write_tls(dir.path(), &kit);
    write_person_tls(dir.path(), kit.ca(), &["127.0.0.1", "localhost"]);
    let (status, message) = person_check(dir.path(), &kit).await;
    assert_eq!(status, "warn", "{message}");
    assert!(message.contains("http.person.bind 127.0.0.1"), "{message}");
    assert!(!message.contains("are both loopback"), "{message}");
    // Configured without filtered listings: plainly not served.
    let dir = support::workspace(&config_with(
        &kit,
        &person_table(port).replace("bind = \"127.0.0.1:", "bind = \"0.0.0.0:"),
        &Options {
            auth: "filter_tools_by_scope = false",
            ..Options::default()
        },
    ));
    support::gateway::write_keys(dir.path(), &kit);
    write_person_tls(dir.path(), kit.ca(), &["127.0.0.1", "localhost"]);
    let (status, message) = person_check(dir.path(), &kit).await;
    assert_eq!(status, "warn", "{message}");
    assert!(
        message.contains(
            "[http.person] is configured but not served: auth.filter_tools_by_scope is false"
        ),
        "{message}"
    );
}

#[tokio::test]
async fn the_doctor_warns_on_a_wildcard_certificate_for_the_page() {
    let kit = TestIdp::start().await.unwrap();
    let port = free_port().await;
    let dir = support::workspace(&config(
        &kit,
        &person_table(port).replace("bind = \"127.0.0.1:", "bind = \"0.0.0.0:"),
        "",
        "",
    ));
    support::gateway::write_keys(dir.path(), &kit);
    write_person_tls(
        dir.path(),
        kit.ca(),
        &["127.0.0.1", "localhost", "*.example.com"],
    );
    let (status, message) = person_check(dir.path(), &kit).await;
    assert_eq!(status, "warn", "{message}");
    assert!(message.contains("holds a wildcard name"), "{message}");
}

/// A port nothing listens on now.
async fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .await
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

#[tokio::test]
async fn the_doctor_fails_a_certificate_or_key_the_page_cannot_serve() {
    let kit = TestIdp::start().await.unwrap();
    // A port nothing serves: the probe warns, which the failures below outrank; a bind that is
    // not loopback.
    let port = free_port().await;
    let dir = support::workspace(&config(
        &kit,
        &person_table(port).replace("bind = \"127.0.0.1:", "bind = \"0.0.0.0:"),
        "",
        "",
    ));
    support::gateway::write_keys(dir.path(), &kit);
    write_person_tls(dir.path(), kit.ca(), &["127.0.0.1", "localhost"]);
    let (status, message) = person_check(dir.path(), &kit).await;
    assert_eq!(status, "warn", "{message}");

    // A certificate that does not name the page's host.
    write_person_tls(dir.path(), kit.ca(), &["127.0.0.2", "elsewhere.example"]);
    let (status, message) = person_check(dir.path(), &kit).await;
    assert_eq!(status, "fail", "{message}");
    assert!(message.contains("does not name localhost"), "{message}");

    // Expiring within 14 days warns; expired and not yet valid fail.
    let now = support::oauth::now_ms().div_euclid(1000);
    let day = 24 * 60 * 60;
    let soon = TestCa::valid_between(now - 3600, now + 7 * day).unwrap();
    write_person_tls(dir.path(), &soon, &["127.0.0.1", "localhost"]);
    let (status, message) = person_check(dir.path(), &kit).await;
    assert_eq!(status, "warn", "{message}");
    assert!(message.contains("within 14 days"), "{message}");
    let expired = TestCa::valid_between(now - 30 * day, now - day).unwrap();
    write_person_tls(dir.path(), &expired, &["127.0.0.1", "localhost"]);
    let (status, message) = person_check(dir.path(), &kit).await;
    assert_eq!(status, "fail", "{message}");
    assert!(message.contains("expired"), "{message}");

    // A key others can read, or one that is not the certificate's.
    write_person_tls(dir.path(), kit.ca(), &["127.0.0.1", "localhost"]);
    #[cfg(unix)]
    {
        chmod(&dir.path().join("person-tls/key.pem"), 0o644);
        let (status, message) = person_check(dir.path(), &kit).await;
        assert_eq!(status, "fail", "{message}");
        assert!(message.contains("http.person.tls.key"), "{message}");
        chmod(&dir.path().join("person-tls/key.pem"), 0o600);
    }
    let other = kit
        .ca()
        .server_certificate(&["127.0.0.1", "localhost"])
        .unwrap();
    std::fs::write(
        dir.path().join("person-tls/cert.pem"),
        other.certificate_pem(),
    )
    .unwrap();
    let (status, message) = person_check(dir.path(), &kit).await;
    assert_eq!(status, "fail", "{message}");
    assert!(message.contains("http.person.tls.key"), "{message}");
}

#[tokio::test]
async fn the_doctor_warns_where_mode_gateway_has_no_listener_for_the_page() {
    let kit = TestIdp::start().await.unwrap();
    let dir = support::workspace(&config(&kit, "", "", ""));
    support::gateway::write_keys(dir.path(), &kit);
    let (status, message) = person_check(dir.path(), &kit).await;
    assert_eq!(status, "warn", "{message}");
    assert!(message.contains("[http.person] is not set"), "{message}");
    assert!(message.contains("no verified command"), "{message}");
}

// ── `umbel serve --http` ───────────────────────────────────────────────────────────────────────

#[cfg(unix)]
#[tokio::test]
async fn umbel_serve_binds_the_pages_own_listener_beside_the_gateways() {
    use support::process::Process;
    let kit = TestIdp::start().await.unwrap();
    // No plugin the binary lacks; the page's own listener on a port of its own.
    let text = support::gateway::config(&kit, &support::gateway::Setup::default())
        .replace("[auth.namespaces.corp]\n", &person_login(&kit))
        .replace(
            "first_class_tools = [\"fixture-whoami\", \"fixture-touch\", \"event-list\"]",
            "first_class_tools = [\"event-list\"]",
        )
        + "\n[http.person]\nbind = \"127.0.0.1:9\"\npublic_url = \"https://localhost:8444\"\nallowed_hosts = [\"localhost\"]\n\n[http.person.tls]\ncert = \"person-tls/cert.pem\"\nkey = \"person-tls/key.pem\"\n";
    let dir = support::workspace(&text);
    support::gateway::write_keys(dir.path(), &kit);
    write_person_tls(dir.path(), kit.ca(), &["127.0.0.1", "localhost"]);
    // `--person-bind` moves the page's listener, as `--bind` moves the gateway-facing one.
    let process = Process::spawn(
        dir.path(),
        &[
            "serve",
            "--http",
            "--bind",
            "127.0.0.1:0",
            "--person-bind",
            "127.0.0.1:0",
        ],
    );
    let mut seen = Vec::new();
    let address = loop {
        let line = process.stderr_line();
        if let Some(rest) = line.strip_prefix("umbel person page listening on https://") {
            assert!(
                line.contains("public origin https://localhost:8444"),
                "{line}"
            );
            break rest
                .split_whitespace()
                .next()
                .unwrap()
                .parse::<SocketAddr>()
                .unwrap();
        }
        seen.push(line);
        assert!(seen.len() < 50, "{seen:?}");
    };
    assert!(
        seen.iter()
            .any(|line| line.starts_with("umbel listening on http://127.0.0.1:")),
        "{seen:?}"
    );
    assert_ne!(address.port(), 9, "the override was not taken");
    let browser =
        Client::tls(address, kit.ca().certificate_pem(), None).with_host("localhost:8444");
    assert_eq!(browser.get("/health", &[]).await.status, 200);
    let style = browser.get("/d/style.css", &[]).await;
    assert_eq!(style.status, 200, "{}", style.text);
    assert_eq!(
        style.headers["content-security-policy"],
        "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    );
    assert_eq!(browser.get("/mcp", &[]).await.status, 404);
    process.interrupt();
    let (code, _, _) = process.finish();
    assert_eq!(code, Some(0));
}
