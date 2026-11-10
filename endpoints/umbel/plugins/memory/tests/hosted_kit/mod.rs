//! The hosted kit of the step 10 tests (phase 5 specification, sections 8.1, 8.3 and 8.4): a
//! hosted workspace with the memory plugin, `umbel-testkit-idp` as its identity provider and
//! authorization server (or, in mode `gateway`, its gateway signer), served over real sockets, and
//! a scripted browser that opens the person page, logs in at the kit and decides. The HTTP client
//! and the served listener are the host's own test support (`tests/support/hosted.rs`), included by
//! path; the browser's steps are those of the knowledge plugin's `relay_kit/`.
//!
//! Every clock is a `ManualClock` the test moves: commands, decisions, tokens' verification and
//! the kit's ID tokens all follow it, so no test depends on the wall time or on chance.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

#[path = "../../../../tests/support/hosted.rs"]
pub mod hosted;

use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;

use afd::{Actor, ActorKind, ManualClock};
use serde_json::{Value, json};
use tokio::net::TcpListener;
use umbel::plugins::sdk;
use umbel::{Host, HostBuilder};
use umbel_testkit_idp::{Client as KitClient, ScriptedLogin, TestCa, TestIdp};

pub use hosted::{Client, PUBLIC_URL, Reply, Served};

/// The person page's client secret at the kit.
pub const SECRET: &str = "memory-test-person-secret-77d1";
/// The secret's environment variable, as the configuration names it.
pub const SECRET_ENV: &str = "UMBEL_TEST_PERSON_SECRET";
/// The page's redirect URI in mode `oauth`, as the host derives it from the public URL.
pub const REDIRECT: &str = "https://127.0.0.1/mcp/d/return";
/// The public origin a decision's form posts from in mode `oauth`.
pub const ORIGIN: &str = "https://127.0.0.1";
/// Every scope the tests' tokens carry: `approve` for a host-verified confirmation, `erase` for
/// `memory-erase` (section 5.2).
pub const SCOPES: [&str; 4] = ["umbel:read", "umbel:write", "umbel:approve", "umbel:erase"];

/// `[auth.namespaces.corp]` with the kit's person login asking for `acr` (TOML list items), and
/// the login-only issuer `idp`.
pub fn person_login(kit: &TestIdp, acr: &str) -> String {
    format!(
        "[auth.namespaces.corp]\nperson = {{ issuer = \"idp\", client_id = \"umbel-person-page\", client_secret_env = \"{SECRET_ENV}\", acr_values = [{acr}], uv_amr = [\"pin\"] }}\n\n[auth.issuers.idp]\nissuer = \"{}\"\nnamespace = \"corp\"\naccess_tokens = false\n",
        kit.identity_provider().issuer()
    )
}

/// The spaces, groups and the memory plugin of every hosted workspace.
///
/// - `alpha` (the default), readable by everyone; `beta`, readable by `corp/bo` alone (so hidden
///   from `corp/ada` and `corp/cy`).
/// - The group `records-admins` names `corp/ada` and `corp/cy`; `curators` names `corp/ed`.
/// - `policy` is appended to the `memory_write` grant's table (`erasers`, `editors`, ...).
pub fn spaces_and_plugin(policy: &str) -> String {
    format!(
        r#"[access.groups.records-admins]
members = ["human:corp/ada", "human:corp/cy"]

[access.groups.curators]
members = ["human:corp/ed"]

[spaces.alpha]
[spaces.beta]
readers = ["human:corp/bo"]

[plugins]
enabled = ["memory"]

[plugins.memory]
source = "compiled:memory"
[plugins.memory.grants.memory_write]
allow = ["alpha", "beta"]
default_access = "space"
{policy}
"#
    )
}

/// An `oauth` workspace: namespace `corp` with the kit's person login asking for `phr`, the kit's
/// authorization server as issuer `as`, the operator `corp/ada`, the legacy principals `human:ada`
/// and `human:bo` mapping to `corp/ada` and `corp/bo`, and [`spaces_and_plugin`].
pub fn oauth_config(kit: &TestIdp, policy: &str) -> String {
    format!(
        r#"config_version = 5
default_space = "alpha"

[principal]
local_id = "corp/ada"

[principal.equivalents]
"human:ada" = "human:corp/ada"
"human:bo" = "human:corp/bo"

[http]
public_url = "{PUBLIC_URL}"
allowed_hosts = ["127.0.0.1"]

[auth]
mode = "oauth"

{login}
[auth.issuers.as]
issuer = "{issuer}"
namespace = "corp"
algorithms = ["ES256", "RS256"]

{rest}
"#,
        login = person_login(kit, "\"phr\""),
        issuer = kit.authorization_server().issuer(),
        rest = spaces_and_plugin(policy),
    )
}

/// A host over `dir` with the memory plugin, trusting the kit's CA, with the person login's
/// secret, on `clock` for commands, tokens and decisions alike.
pub fn host(dir: &Path, kit: &TestIdp, clock: &ManualClock) -> Host {
    HostBuilder::open(dir)
        .unwrap()
        .with_compiled(Arc::new(sdk(umbel_plugin_memory::plugin())))
        .with_clock(clock.clone())
        .with_auth_root_certificate(kit.ca().certificate_pem().as_bytes().to_vec())
        .with_auth_clock(clock.clone())
        .with_auth_secret(SECRET_ENV, SECRET)
        .seal()
        .unwrap()
}

/// Make the kit's identity provider sign ID tokens on `clock`, the host's.
pub fn follow(kit: &TestIdp, clock: &ManualClock) {
    let clock = clock.clone();
    kit.identity_provider().follow_clock(Some(Arc::new(move || {
        afd::Clock::now(&clock).div_euclid(1000)
    })));
}

/// Now, in milliseconds: the host's clocks start there (the kit's metadata fetches still run on
/// the wall time).
pub fn now_ms() -> i64 {
    i64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis(),
    )
    .unwrap()
}

/// `id` as a person: `human:<id>`.
pub fn human(id: &str) -> Actor {
    Actor::new(ActorKind::Human).with_id(id)
}

/// `corp/<client>` acting for `corp/<person>`.
pub fn agent_for(client: &str, person: &str) -> Actor {
    Actor::new(ActorKind::Agent)
        .with_id(format!("corp/{client}"))
        .with_on_behalf_of(format!("corp/{person}"))
}

/// Run `command` with `input` through `host`'s registry in `context`, as JSON.
pub async fn run(host: &Host, context: afd::CommandContext, command: &str, input: Value) -> Value {
    serde_json::to_value(host.registry().execute(command, input, Some(context)).await).unwrap()
}

/// `command` as `actor` through the library (the embedder's, treated by its actor).
pub async fn library(host: &Host, actor: Actor, command: &str, input: Value) -> Value {
    run(host, host.context(actor), command, input).await
}

/// Remember `text` (subject `subject`) in `space` as `actor` through the library, shared as
/// `share` (`private`, `space`, or `None` for the default, `space` here); the record's id.
pub async fn remember(
    host: &Host,
    actor: Actor,
    space: &str,
    subject: &str,
    text: &str,
    share: Option<&str>,
) -> String {
    let mut input =
        json!({ "space": space, "class": "semantic", "subject": subject, "text": text });
    if let Some(share) = share {
        input["share"] = json!(share);
    }
    let answer = library(host, actor, "memory-remember", input).await;
    answer["data"]["id"]
        .as_str()
        .unwrap_or_else(|| panic!("{answer}"))
        .to_owned()
}

// ── MCP ─────────────────────────────────────────────────────────────────────────────────────────

/// A `tools/call` request of `tool` with `arguments` from a 2026-07-28 client that declared
/// URL-mode elicitation, with `extra` params (`inputResponses`, `requestState`), and the header
/// `credential` (`authorization`, or the gateway's assertion).
pub async fn call_with(
    client: &Client,
    credential: (&str, &str),
    tool: &str,
    arguments: Value,
    extra: Value,
) -> Value {
    let mut meta = umbel::testkit::mcp::modern_meta();
    meta["io.modelcontextprotocol/clientCapabilities"] =
        json!({ "elicitation": { "url": {}, "form": {} } });
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
        credential,
    ];
    let reply = client
        .send(client.request("POST", "/mcp", &headers, body.to_string()))
        .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    reply.json()
}

/// A `CommandResult` from a call's answer.
pub fn result(answer: &Value) -> Value {
    answer["result"]["structuredContent"].clone()
}

/// The error code of a call's answer: a `CommandResult`'s, or a JSON-RPC error's.
pub fn code(answer: &Value) -> String {
    let result = result(answer);
    result["error"]["code"]
        .as_str()
        .or_else(|| answer["error"]["data"]["code"].as_str())
        .unwrap_or_default()
        .to_owned()
}

/// The retry carrying the relay's `accept` and `state`.
pub fn accepted(state: &str) -> Value {
    json!({ "inputResponses": { "relay": { "action": "accept" } }, "requestState": state })
}

/// An `input_required` answer's relay prompt.
#[derive(Debug, Clone)]
pub struct Asked {
    pub url: String,
    pub message: String,
    pub state: String,
}

/// `url`'s path and query: what follows its origin.
pub fn path_of(url: &str) -> String {
    match url.split_once("://") {
        Some((_, rest)) => match rest.find('/') {
            Some(start) => rest[start..].to_owned(),
            None => "/".to_owned(),
        },
        None => url.to_owned(),
    }
}

impl Asked {
    pub fn path(&self) -> String {
        path_of(&self.url)
    }
}

/// The relay prompt of an answer, which must be `input_required` with exactly one URL request.
pub fn asked(answer: &Value) -> Asked {
    let result = &answer["result"];
    assert_eq!(result["resultType"], "input_required", "{answer}");
    let requests = result["inputRequests"].as_object().unwrap();
    assert_eq!(requests.len(), 1, "{answer}");
    let params = &requests["relay"]["params"];
    assert_eq!(params["mode"], "url", "{answer}");
    Asked {
        url: params["url"].as_str().unwrap().to_owned(),
        message: params["message"].as_str().unwrap().to_owned(),
        state: result["requestState"].as_str().unwrap().to_owned(),
    }
}

/// Whether an answer asks for anything (an `input_required`).
pub fn asks(answer: &Value) -> bool {
    answer["result"]["resultType"] == "input_required"
}

// ── The browser ─────────────────────────────────────────────────────────────────────────────────

/// What the browser holds after opening a decision's link.
pub struct Opened {
    pub location: String,
    pub cookie: (String, String),
}

impl Opened {
    pub fn cookie_header(&self) -> String {
        format!("{}={}", self.cookie.0, self.cookie.1)
    }
}

/// Open the page at `path` (GET), as a browser with no cookie.
pub async fn open(client: &Client, path: &str) -> Opened {
    let reply = client.get(path, &[]).await;
    assert_eq!(reply.status, 302, "{}", reply.text);
    let location = reply.headers["location"].to_str().unwrap().to_owned();
    let cookie = reply.headers["set-cookie"].to_str().unwrap().to_owned();
    let pair = cookie.split(';').next().unwrap();
    let (name, value) = pair.split_once('=').unwrap();
    Opened {
        location,
        cookie: (name.to_owned(), value.to_owned()),
    }
}

/// Follow the authorization URL at the kit (a scripted login must be queued) and answer the path
/// and query the identity provider redirects back to, which must be at `origin`.
pub async fn authorize(kit: &TestIdp, location: &str, origin: &str) -> String {
    let kit_client = Client::tls(kit.address(), kit.ca().certificate_pem(), None);
    let path = location
        .strip_prefix(kit.base_url())
        .unwrap_or(location)
        .to_owned();
    let reply = kit_client.get(&path, &[]).await;
    assert!(reply.status == 302 || reply.status == 303, "{}", reply.text);
    let back = reply.headers["location"].to_str().unwrap().to_owned();
    assert!(
        back.starts_with(&format!("{origin}/")),
        "the provider sent the login back to {back}, not to {origin}"
    );
    path_of(&back)
}

/// The decision form's hidden `login` and `csrf` values in a rendered page.
pub fn form(page: &str) -> Option<(String, String)> {
    let value = |name: &str| {
        let marker = format!("name=\"{name}\" value=\"");
        let start = page.find(&marker)? + marker.len();
        let end = page[start..].find('"')? + start;
        Some(page[start..end].to_owned())
    };
    Some((value("login")?, value("csrf")?))
}

/// What a completed login shows.
pub struct LoggedIn {
    pub opened: Opened,
    pub page: Reply,
    pub form: Option<(String, String)>,
}

/// Open `path` on `browser`, log in at `kit` as `script` says, and come back to the page at
/// `origin` with the login's cookie.
pub async fn login(
    kit: &TestIdp,
    browser: &Client,
    path: &str,
    origin: &str,
    script: ScriptedLogin,
) -> LoggedIn {
    kit.identity_provider().script_login(script);
    let opened = open(browser, path).await;
    let back = authorize(kit, &opened.location, origin).await;
    let cookie = opened.cookie_header();
    let page = browser.get(&back, &[("cookie", cookie.as_str())]).await;
    let form = form(&page.text);
    LoggedIn { opened, page, form }
}

/// Post `decision` (`approve` or `decline`) on a logged-in page at `path` from `origin`.
pub async fn post(
    browser: &Client,
    path: &str,
    logged: &LoggedIn,
    decision: &str,
    origin: &str,
) -> Reply {
    let (login, csrf) = logged.form.clone().unwrap();
    let cookie = logged.opened.cookie_header();
    let headers = [
        ("content-type", "application/x-www-form-urlencoded"),
        ("cookie", cookie.as_str()),
        ("origin", origin),
    ];
    browser
        .send(browser.request(
            "POST",
            path,
            &headers,
            format!("login={login}&csrf={csrf}&decision={decision}"),
        ))
        .await
}

/// The preview's text as the page renders it: what follows `<pre` up to `</pre>`, unescaped
/// enough to search.
pub fn preview_of(page: &str) -> String {
    let start = page.find("<pre").map_or(0, |start| {
        page[start..].find('>').map_or(start, |end| start + end + 1)
    });
    let end = page[start..]
        .find("</pre>")
        .map_or(page.len(), |end| start + end);
    page[start..end]
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

// ── Mode oauth ──────────────────────────────────────────────────────────────────────────────────

/// A served `oauth` workspace: the kit, the host on its own listener, and an HTTP client that is
/// both the MCP client and the person's browser (the page is served beside the MCP path).
pub struct Hosted {
    pub kit: TestIdp,
    pub dir: tempfile::TempDir,
    pub host: Host,
    pub served: Served,
    pub client: Client,
    pub clock: ManualClock,
}

impl Hosted {
    /// Start, with `policy` appended to the `memory_write` grant's table.
    pub async fn start(policy: &str) -> Self {
        let kit = TestIdp::start().await.unwrap();
        kit.identity_provider().register_client(
            KitClient::confidential("umbel-person-page", SECRET).redirect_uri(REDIRECT),
        );
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("umbel.toml"), oauth_config(&kit, policy)).unwrap();
        let clock = afd::fixed_clock(now_ms());
        follow(&kit, &clock);
        let host = host(dir.path(), &kit, &clock);
        host.check_person_logins().await;
        let served = Served::start(&host).await;
        let client = Client::plain(served.address);
        Self {
            kit,
            dir,
            host,
            served,
            client,
            clock,
        }
    }

    /// The workspace's directory.
    pub fn dir(&self) -> &Path {
        self.dir.path()
    }

    pub fn now_s(&self) -> i64 {
        afd::Clock::now(&self.clock).div_euclid(1000)
    }

    /// Move every clock on by `ms`, then check the person login again, as the server does when
    /// its discovery document's cache ends (a jump past it would otherwise serve no verified
    /// command until the next check): the test, not the wall time, decides when.
    pub async fn advance(&self, ms: i64) {
        self.clock.advance(ms);
        self.host.check_person_logins().await;
    }

    /// An access token for `subject` from client `client`, with [`SCOPES`].
    pub fn token(&self, subject: &str, client: &str) -> String {
        self.token_with(subject, client, &SCOPES)
    }

    /// An access token for `subject` from client `client`, with `scopes`.
    pub fn token_with(&self, subject: &str, client: &str, scopes: &[&str]) -> String {
        self.kit
            .authorization_server()
            .access_token(PUBLIC_URL)
            .issued_at(self.now_s())
            .lifetime(3000)
            .subject(subject)
            .client_id(client)
            .scopes(scopes.iter().copied())
            .sign()
    }

    /// `tool` with `arguments` as `subject` through `client`'s token, with `extra`.
    pub async fn call(
        &self,
        subject: &str,
        client: &str,
        tool: &str,
        arguments: Value,
        extra: Value,
    ) -> Value {
        let bearer = format!("Bearer {}", self.token(subject, client));
        call_with(
            &self.client,
            ("authorization", bearer.as_str()),
            tool,
            arguments,
            extra,
        )
        .await
    }

    /// Log in as `user` on decision `path`, with the page shown; the logged-in page.
    pub async fn log_in(&self, path: &str, user: &str) -> LoggedIn {
        let logged = login(
            &self.kit,
            &self.client,
            path,
            ORIGIN,
            ScriptedLogin::user(user),
        )
        .await;
        assert_eq!(logged.page.status, 200, "{}", logged.page.text);
        logged
    }

    /// Log in as `user` on decision `path` and decide `decision`; the page's text and the post's
    /// answer.
    pub async fn decide(&self, path: &str, user: &str, decision: &str) -> (String, Reply) {
        let logged = self.log_in(path, user).await;
        let page = logged.page.text.clone();
        let reply = post(&self.client, path, &logged, decision, ORIGIN).await;
        (page, reply)
    }

    /// `tool` with `arguments` as `subject` through `client`, decided `approve` on the person page
    /// by `subject`, then retried with the relay's state: the retry's answer and the preview's
    /// text the person saw.
    pub async fn decided(
        &self,
        subject: &str,
        client: &str,
        tool: &str,
        arguments: Value,
    ) -> (Value, String) {
        let first = self
            .call(subject, client, tool, arguments.clone(), json!({}))
            .await;
        let asked = asked(&first);
        let (page, reply) = self.decide(&asked.path(), subject, "approve").await;
        assert_eq!(reply.status, 200, "{}", reply.text);
        let retry = self
            .call(subject, client, tool, arguments, accepted(&asked.state))
            .await;
        (retry, preview_of(&page))
    }

    /// The journal's entries for `command`.
    pub fn journal(&self, command: &str) -> Vec<Value> {
        journal(self.dir(), command)
    }

    /// The command line in process, as the operator (`principal.local_id`, `corp/ada`), with
    /// `console` for its terminal, on this workspace's clock: the JSON it printed.
    pub async fn command_line(
        &self,
        console: Arc<dyn umbel::cli::Console>,
        args: &[&str],
    ) -> Value {
        let mut environment = umbel::cli::Environment::from_process();
        environment.cwd = self.dir().to_path_buf();
        environment.workspace = None;
        environment.console = console;
        environment.vars.clear();
        let clock = self.clock.clone();
        let ca = self.kit.ca().certificate_pem().as_bytes().to_vec();
        let mut stdout = Vec::new();
        umbel::cli::run(
            std::iter::once("umbel").chain(args.iter().copied()),
            &environment,
            &mut stdout,
            move |builder: HostBuilder| {
                builder
                    .with_compiled(Arc::new(sdk(umbel_plugin_memory::plugin())))
                    .with_clock(clock.clone())
                    .with_auth_root_certificate(ca)
                    .with_auth_clock(clock)
                    .with_auth_secret(SECRET_ENV, SECRET)
            },
        )
        .await;
        let text = String::from_utf8(stdout).unwrap();
        serde_json::from_str(&text)
            .unwrap_or_else(|error| panic!("stdout is not one JSON document ({error}): {text}"))
    }
}

/// The journal's entries for `command` in `dir`.
pub fn journal(dir: &Path, command: &str) -> Vec<Value> {
    std::fs::read_to_string(dir.join("state/journal.jsonl"))
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|entry| entry["command"] == command)
        .collect()
}

/// The event lines of `space` in `dir`.
pub fn events(dir: &Path, space: &str) -> Vec<Value> {
    std::fs::read_to_string(dir.join("state/spaces").join(space).join("events.jsonl"))
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect()
}

/// Every file under `dir`, recursively, with its bytes.
pub fn every_file(dir: &Path) -> Vec<(std::path::PathBuf, Vec<u8>)> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(next) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&next) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if let Ok(bytes) = std::fs::read(&path) {
                out.push((path, bytes));
            }
        }
    }
    out
}

// ── Mode gateway ────────────────────────────────────────────────────────────────────────────────

/// The kit gateway's key set as a deployer pins it: every key with the `alg` it signs with.
pub fn pinned_jwks(kit: &TestIdp) -> Value {
    let mut jwks = kit.gateway().jwks();
    for key in jwks["keys"].as_array_mut().unwrap() {
        let alg = match (key["kty"].as_str(), key["crv"].as_str()) {
            (Some("RSA"), _) => "RS256",
            (Some("EC"), Some("P-256")) => "ES256",
            (Some("EC"), Some("P-384")) => "ES384",
            (Some("OKP"), _) => "EdDSA",
            other => panic!("an unexpected kit key {other:?}"),
        };
        key["alg"] = json!(alg);
    }
    jwks
}

/// A `gateway` workspace on the loopback channel, its person page on `[http.person]` at
/// `https://localhost:<port>`, the login asking for `acr` (TOML list items).
pub fn gateway_config(kit: &TestIdp, port: u16, acr: &str, policy: &str) -> String {
    format!(
        r#"config_version = 5
default_space = "alpha"

[principal]
local_id = "corp/ada"

[principal.equivalents]
"human:ada" = "human:corp/ada"
"human:bo" = "human:corp/bo"

[http]
public_url = "{PUBLIC_URL}"
allowed_hosts = ["127.0.0.1"]

[http.person]
bind = "127.0.0.1:{port}"
public_url = "https://localhost:{port}"
allowed_hosts = ["localhost"]

[http.person.tls]
cert = "person-tls/cert.pem"
key = "person-tls/key.pem"

[auth]
mode = "gateway"

{login}
[auth.gateway]
alias = "edge"
namespace = "corp"
issuer = "{issuer}"
keys = "gateway/jwks.json"
max_scopes = ["umbel:read", "umbel:write", "umbel:approve", "umbel:erase"]

{rest}
"#,
        login = person_login(kit, acr),
        issuer = kit.gateway().issuer(),
        rest = spaces_and_plugin(policy),
    )
}

/// The person listener's certificate from `ca` for `names`, and its key, owner-readable only.
pub fn write_person_tls(dir: &Path, ca: &TestCa, names: &[&str]) {
    let tls = dir.join("person-tls");
    std::fs::create_dir_all(&tls).unwrap();
    let issued = ca.server_certificate(names).unwrap();
    std::fs::write(tls.join("cert.pem"), issued.certificate_pem()).unwrap();
    std::fs::write(tls.join("key.pem"), issued.private_key_pem()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(tls.join("key.pem"), std::fs::Permissions::from_mode(0o600))
            .unwrap();
    }
}

/// A host's person listener, served on a listener the test bound, until dropped.
pub struct PersonServed {
    pub address: SocketAddr,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
}

impl PersonServed {
    pub async fn start(host: &Host, listener: TcpListener) -> Self {
        let server = host
            .person_server()
            .unwrap()
            .expect("the person page's own listener");
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

/// A served `gateway` workspace: the gateway-facing listener (loopback, plain HTTP) and the person
/// page's own listener (TLS, origin `https://localhost:<port>`), with a browser of it.
pub struct GatewayHosted {
    pub kit: TestIdp,
    pub dir: tempfile::TempDir,
    pub host: Host,
    pub served: Served,
    pub gateway: Client,
    pub person: PersonServed,
    pub browser: Client,
    pub origin: String,
    pub clock: ManualClock,
}

impl GatewayHosted {
    /// Start, the person login asking for `acr` (TOML list items), `policy` appended to the
    /// `memory_write` grant's table.
    pub async fn start(acr: &str, policy: &str) -> Self {
        let kit = TestIdp::start().await.unwrap();
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
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("umbel.toml"),
            gateway_config(&kit, port, acr, policy),
        )
        .unwrap();
        std::fs::create_dir_all(dir.path().join("gateway")).unwrap();
        std::fs::write(
            dir.path().join("gateway/jwks.json"),
            pinned_jwks(&kit).to_string(),
        )
        .unwrap();
        write_person_tls(dir.path(), kit.ca(), &["127.0.0.1", "localhost"]);
        let clock = afd::fixed_clock(now_ms());
        follow(&kit, &clock);
        let host = host(dir.path(), &kit, &clock);
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
        }
    }

    pub fn now_s(&self) -> i64 {
        afd::Clock::now(&self.clock).div_euclid(1000)
    }

    /// `tool` through the gateway as `subject` with the gateway's client `gateway-client`.
    pub async fn call(&self, subject: &str, tool: &str, arguments: Value, extra: Value) -> Value {
        let assertion = self
            .kit
            .gateway()
            .assertion(PUBLIC_URL, "POST")
            .issued_at(self.now_s())
            .lifetime(60)
            .subject(subject)
            .claim("client", json!("gateway-client"))
            .scopes(SCOPES)
            .sign();
        call_with(
            &self.gateway,
            ("umbel-gateway-assertion", assertion.as_str()),
            tool,
            arguments,
            extra,
        )
        .await
    }
}
