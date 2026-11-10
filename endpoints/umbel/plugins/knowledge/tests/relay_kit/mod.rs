//! The hosted kit of `relay.rs` (phase 5 step 6): a hosted workspace with the sources and
//! knowledge plugins, `umbel-testkit-idp` as its identity provider and authorization server (or,
//! in mode `gateway`, its gateway signer), served over real sockets, and a scripted browser that
//! opens the person page, logs in at the kit and decides. The HTTP client and the served listener
//! are the host's own test support (`tests/support/hosted.rs`), included by path; the browser's
//! steps are those of the host's `tests/support/person.rs`.
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
use umbel_store::{DocumentStore, ReaderFilter, Record};
use umbel_store_embedded::{SqliteStore, StoreOptions};
use umbel_testkit_idp::{Client as KitClient, ScriptedLogin, TestCa, TestIdp};

pub use hosted::{Client, PUBLIC_URL, Reply, Served};

/// The person page's client secret at the kit.
pub const SECRET: &str = "relay-test-person-secret-41c7";
/// The secret's environment variable, as the configuration names it.
pub const SECRET_ENV: &str = "UMBEL_TEST_PERSON_SECRET";
/// The page's redirect URI in mode `oauth`, as the host derives it from the public URL.
pub const REDIRECT: &str = "https://127.0.0.1/mcp/d/return";
/// The public origin a decision's form posts from in mode `oauth`.
pub const ORIGIN: &str = "https://127.0.0.1";
/// Every scope the tests' tokens carry.
pub const SCOPES: [&str; 3] = ["umbel:read", "umbel:write", "umbel:approve"];
/// The runbook every test proposes to change, and its replacement.
pub const RUNBOOK: &str = "---\ntitle: Rolling back\n---\nRoll back with the previous tag.\n";
pub const UPDATED: &str =
    "---\ntitle: Rolling back\n---\nRoll back with the previous release tag, then verify.\n";

/// `[auth.namespaces.corp]` with the kit's person login asking for `acr` (TOML list items), and
/// the login-only issuer `idp`.
pub fn person_login(kit: &TestIdp, acr: &str) -> String {
    format!(
        "[auth.namespaces.corp]\nperson = {{ issuer = \"idp\", client_id = \"umbel-person-page\", client_secret_env = \"{SECRET_ENV}\", acr_values = [{acr}], uv_amr = [\"pin\"] }}\n\n[auth.issuers.idp]\nissuer = \"{}\"\nnamespace = \"corp\"\naccess_tokens = false\n",
        kit.identity_provider().issuer()
    )
}

/// The spaces, groups and plugins of every relay workspace.
///
/// - `alpha` (the default): `handbook`, whose area sets `approve_over_mcp`; `notes`, whose area
///   does not; `private`, readable by `corp/bo` alone, whose area sets it.
/// - `beta`: readable by `corp/bo` alone, its `handbook` area setting it.
/// - The group `kb-owners` (`corp/ada` and `corp/cy`) approves every area.
///
/// `areas` is appended to the handbook area's table (`allow_self_approval = true`, ...).
pub fn spaces_and_plugins(areas: &str) -> String {
    format!(
        r#"[access.groups.kb-owners]
members = ["human:corp/ada", "human:corp/cy"]

[spaces.alpha]
[spaces.alpha.collections.handbook]
root = "spaces/alpha/handbook"
[spaces.alpha.collections.notes]
root = "spaces/alpha/notes"
[spaces.alpha.collections.private]
root = "spaces/alpha/private"
access = ["principal:human:corp/bo"]

[spaces.beta]
readers = ["human:corp/bo"]
[spaces.beta.collections.handbook]
root = "spaces/beta/handbook"

[plugins]
enabled = ["sources", "knowledge"]

[plugins.sources]
source = "compiled:sources"
[plugins.sources.grants.documents_write]
allow = ["alpha/*", "beta/*"]
[plugins.sources.grants.records_write]
allow = ["alpha", "beta"]

[plugins.knowledge]
source = "compiled:knowledge"
[plugins.knowledge.grants.index_write]
allow = ["alpha", "beta"]
[plugins.knowledge.grants.graph_write]
allow = ["alpha", "beta"]
[plugins.knowledge.grants.records_write]
allow = ["alpha", "beta"]
[plugins.knowledge.grants.documents_write]
allow = ["alpha/*", "beta/*"]
[plugins.knowledge.grants.content_write]
allow = ["alpha/*", "beta/*"]

[plugins.knowledge.config.areas.handbook]
space = "alpha"
collection = "handbook"
approvers = ["group:kb-owners"]
approve_over_mcp = true
{areas}

[plugins.knowledge.config.areas.notes]
space = "alpha"
collection = "notes"
approvers = ["group:kb-owners"]

[plugins.knowledge.config.areas.private]
space = "alpha"
collection = "private"
approvers = ["group:kb-owners"]
approve_over_mcp = true

[plugins.knowledge.config.areas.beta]
space = "beta"
collection = "handbook"
approvers = ["group:kb-owners"]
approve_over_mcp = true
"#
    )
}

/// An `oauth` workspace: namespace `corp` with the kit's person login asking for `phr`, the kit's
/// authorization server as issuer `as`, the operator `corp/ada` whose legacy principal `human:ada`
/// maps to them, and [`spaces_and_plugins`].
pub fn oauth_config(kit: &TestIdp, areas: &str) -> String {
    format!(
        r#"config_version = 5
default_space = "alpha"

[principal]
local_id = "corp/ada"

[principal.equivalents]
"human:ada" = "human:corp/ada"

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
        rest = spaces_and_plugins(areas),
    )
}

/// The drafted-path workspace of [`Relay::start_drafted`] in mode `oauth`, `handbook_extra`
/// appended to the handbook collection's table (`sensitivity`, `access`).
pub fn drafted_config(kit: &TestIdp, handbook_extra: &str) -> String {
    let base = super::support::drafter::config(&["curator"], "corp/local")
        .replacen("config_version = 3", "config_version = 5", 1)
        .replacen(
            "root = \"spaces/main/handbook\"\n",
            &format!("root = \"spaces/main/handbook\"\n{handbook_extra}"),
            1,
        )
        .replacen(
            "[plugins.knowledge.config.areas.handbook]\nspace = \"main\"\ncollection = \"handbook\"\n",
            "[plugins.knowledge.config.areas.handbook]\nspace = \"main\"\ncollection = \"handbook\"\napprovers = [\"group:kb-owners\"]\napprove_over_mcp = true\n",
            1,
        );
    assert!(base.contains("approve_over_mcp = true"), "{base}");
    format!(
        r#"{base}
[principal.equivalents]
"human:ada" = "human:corp/ada"

[access.groups.kb-owners]
members = ["human:corp/ada", "human:corp/cy"]

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
"#,
        login = person_login(kit, "\"phr\""),
        issuer = kit.authorization_server().issuer(),
    )
}

/// The files every workspace starts with.
pub fn write_files(dir: &Path) {
    let write = |relative: &str, text: &str| {
        let path = dir.join("spaces").join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    write("alpha/handbook/runbook.md", RUNBOOK);
    write(
        "alpha/handbook/deploy.md",
        "---\ntitle: Deploying\n---\nDeploy on Tuesdays.\n",
    );
    write(
        "alpha/notes/meeting.md",
        "---\ntitle: Meeting\n---\nNotes.\n",
    );
    write(
        "alpha/private/salaries.md",
        "---\ntitle: Salaries\n---\nPrivate.\n",
    );
    write("beta/handbook/beta.md", "---\ntitle: Beta\n---\nBeta.\n");
}

/// A host over `dir` with the sources and knowledge plugins, trusting the kit's CA, with the
/// person login's secret, on `clock` for commands, tokens and decisions alike.
pub fn host(dir: &Path, kit: &TestIdp, clock: &ManualClock) -> Host {
    host_with(dir, kit, clock, false)
}

/// [`host`], with the stand-in drafters of `support::drafter` linked when `drafters` is set.
pub fn host_with(dir: &Path, kit: &TestIdp, clock: &ManualClock, drafters: bool) -> Host {
    let builder = HostBuilder::open(dir)
        .unwrap()
        .with_compiled(Arc::new(sdk(umbel_plugin_sources_filesystem::plugin())))
        .with_compiled(Arc::new(sdk(umbel_plugin_knowledge::plugin())));
    let builder = if drafters {
        super::support::drafter::link(builder)
    } else {
        builder
    };
    builder
        .with_clock(clock.clone())
        .with_auth_root_certificate(kit.ca().certificate_pem().as_bytes().to_vec())
        .with_auth_clock(clock.clone())
        .with_auth_secret(SECRET_ENV, SECRET)
        .seal()
        .unwrap()
}

/// Make the kit's identity provider sign ID tokens on `clock`, the host's, so a login's times
/// never depend on the wall time.
pub fn follow(kit: &TestIdp, clock: &ManualClock) {
    let clock = clock.clone();
    kit.identity_provider().follow_clock(Some(Arc::new(move || {
        afd::Clock::now(&clock).div_euclid(1000)
    })));
}

/// Now, in milliseconds: the host's clocks start there (the kit's access tokens and metadata
/// fetches still run on the wall time).
pub fn now_ms() -> i64 {
    i64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis(),
    )
    .unwrap()
}

/// A library context of `actor` on `host` (the embedder's, treated by its actor).
pub fn library(host: &Host, actor: Actor) -> afd::CommandContext {
    host.context(actor)
}

/// `actor` as a person: `human:<id>`.
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

/// Read every space's files into the stores and index them, as the operator's person through the
/// library.
pub async fn refresh(host: &Host) {
    for space in ["alpha", "beta"] {
        for command in ["sources-sync", "knowledge-index"] {
            let context = library(host, human("corp/ada"));
            // `beta` is not ada's to read; the embedder syncs it as bo.
            let context = if space == "beta" {
                library(host, human("corp/bo"))
            } else {
                context
            };
            let answer = run(host, context, command, json!({ "space": space })).await;
            assert_eq!(answer["success"], true, "{command} {space}: {answer}");
        }
    }
}

/// The content hash of `doc` in `space`, read as `reader` through the library.
pub async fn hash_of(host: &Host, reader: &str, space: &str, doc: &str) -> String {
    let listed = run(
        host,
        library(host, human(reader)),
        "knowledge-list",
        json!({ "space": space, "prefix": doc }),
    )
    .await;
    listed["data"]["documents"][0]["contentHash"]
        .as_str()
        .unwrap_or_else(|| panic!("{listed}"))
        .to_owned()
}

/// `knowledge-propose`'s input for an update of `doc` in `space` against `base` under `key`.
pub fn propose_input(space: &str, key: &str, doc: &str, base: &str, content: &str) -> Value {
    json!({
        "space": space,
        "idempotency_key": key,
        "change": { "op": "update", "doc": doc, "baseHash": base, "content": content },
        "rationale": "The procedure changed in October.",
        "evidence": [{ "kind": "text", "ref": "release notes" }],
    })
}

/// The stored record of proposal `id` in `space`, read without a filter (the embedder's view).
pub fn stored(dir: &Path, space: &str, id: &str) -> Record {
    SqliteStore::open(
        &dir.join("state/spaces").join(space),
        space,
        StoreOptions::default(),
    )
    .unwrap()
    .get_record("knowledge", "proposal", id, &ReaderFilter::derivation())
    .unwrap()
    .unwrap_or_else(|| panic!("no proposal {id}"))
}

/// The proposal id of a `knowledge-propose` answer.
pub fn proposal_id(answer: &Value) -> String {
    answer["data"]["proposal"]["id"]
        .as_str()
        .unwrap_or_else(|| panic!("{answer}"))
        .to_owned()
}

/// `umbel workspace doctor` at the command line of `dir` (the operator's), with the sources and
/// knowledge plugins, the kit's CA for the platform's roots and the person login's secret; the
/// JSON it printed.
pub async fn doctor(dir: &Path, kit: &TestIdp) -> Value {
    let mut environment = umbel::cli::Environment::from_process();
    environment.cwd = dir.to_path_buf();
    environment.workspace = None;
    environment.console = super::support::Terminal::new(false, false);
    let mut stdout = Vec::new();
    let ca = kit.ca().certificate_pem().as_bytes().to_vec();
    umbel::cli::run(
        ["umbel", "workspace", "doctor"],
        &environment,
        &mut stdout,
        move |builder: HostBuilder| {
            builder
                .with_compiled(Arc::new(sdk(umbel_plugin_sources_filesystem::plugin())))
                .with_compiled(Arc::new(sdk(umbel_plugin_knowledge::plugin())))
                .with_auth_root_certificate(ca)
                .with_auth_secret(SECRET_ENV, SECRET)
        },
    )
    .await;
    serde_json::from_slice(&stdout).unwrap()
}

/// The doctor's check `id`: its status and message.
pub fn check(report: &Value, id: &str) -> (String, String) {
    let data = if report["success"] == true {
        &report["data"]
    } else {
        &report["error"]["details"]
    };
    let check = data["checks"]
        .as_array()
        .unwrap_or_else(|| panic!("no checks in {report}"))
        .iter()
        .find(|check| check["id"] == id)
        .unwrap_or_else(|| panic!("no check {id} in {report}"));
    (
        check["status"].as_str().unwrap().to_owned(),
        check["message"].as_str().unwrap().to_owned(),
    )
}

// ── MCP ─────────────────────────────────────────────────────────────────────────────────────────

/// A `tools/call` request of `tool` with `arguments` from a 2026-07-28 client that declared
/// URL-mode elicitation (unless `url` is false), with `extra` params (`inputResponses`,
/// `requestState`), and the header `credential` (`authorization`, or the gateway's assertion).
pub async fn call_with(
    client: &Client,
    credential: (&str, &str),
    tool: &str,
    arguments: Value,
    extra: Value,
    url: bool,
) -> Value {
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
        credential,
    ];
    let reply = client
        .send(client.request("POST", "/mcp", &headers, body.to_string()))
        .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    reply.json()
}

/// [`call_with`] a bearer `token`.
pub async fn call(
    client: &Client,
    token: &str,
    tool: &str,
    arguments: Value,
    extra: Value,
    url: bool,
) -> Value {
    let bearer = format!("Bearer {token}");
    call_with(
        client,
        ("authorization", bearer.as_str()),
        tool,
        arguments,
        extra,
        url,
    )
    .await
}

/// A `CommandResult` from a call's answer.
pub fn result(answer: &Value) -> Value {
    answer["result"]["structuredContent"].clone()
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

    pub fn id(&self) -> String {
        self.url.rsplit('/').next().unwrap_or_default().to_owned()
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
    pub reply: Reply,
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
        reply,
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

/// Log in as `user` on the page at `path` and decide `decision`.
pub async fn decide(
    kit: &TestIdp,
    browser: &Client,
    path: &str,
    origin: &str,
    user: &str,
    decision: &str,
) -> (LoggedIn, Reply) {
    let logged = login(kit, browser, path, origin, ScriptedLogin::user(user)).await;
    assert_eq!(logged.page.status, 200, "{}", logged.page.text);
    let reply = post(browser, path, &logged, decision, origin).await;
    (logged, reply)
}

// ── Mode oauth ──────────────────────────────────────────────────────────────────────────────────

/// A served `oauth` relay workspace: the kit, the host on its own listener, and an HTTP client
/// that is both the MCP client and the person's browser (the page is served beside the MCP path).
pub struct Relay {
    pub kit: TestIdp,
    /// The workspace and its first host, as the knowledge tests' fixture holds them, so the
    /// memory and drafter helpers of `support` work on it.
    pub fx: super::support::Fx,
    pub served: Served,
    pub client: Client,
    pub clock: ManualClock,
}

impl Relay {
    /// Start, with `areas` appended to the handbook area's table.
    pub async fn start(areas: &str) -> Self {
        let kit = TestIdp::start().await.unwrap();
        let text = oauth_config(&kit, areas);
        Self::serve(kit, &text, false, write_files).await
    }

    /// Start the knowledge tests' drafted-path workspace (`support::drafter::config`: `main` and
    /// `beta`, the stand-in drafters, the `curator` listed in `drafters`) in mode `oauth`, its
    /// handbook area approved by `kb-owners` over MCP, the command line's person `corp/local`,
    /// and `human:ada` mapping to `corp/ada`. `handbook` holds the runbook.
    pub async fn start_drafted() -> Self {
        let kit = TestIdp::start().await.unwrap();
        let text = drafted_config(&kit, "");
        Self::serve(kit, &text, true, |dir| {
            for root in ["main/handbook", "main/code", "beta/notes"] {
                std::fs::create_dir_all(dir.join("spaces").join(root)).unwrap();
            }
            std::fs::write(dir.join("spaces/main/handbook/runbook.md"), RUNBOOK).unwrap();
        })
        .await
    }

    async fn serve(kit: TestIdp, text: &str, drafters: bool, files: impl FnOnce(&Path)) -> Self {
        kit.identity_provider().register_client(
            KitClient::confidential("umbel-person-page", SECRET).redirect_uri(REDIRECT),
        );
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("umbel.toml"), text).unwrap();
        files(dir.path());
        let clock = afd::fixed_clock(now_ms());
        follow(&kit, &clock);
        let host = host_with(dir.path(), &kit, &clock, drafters);
        host.check_person_logins().await;
        if !drafters {
            refresh(&host).await;
        }
        let served = Served::start(&host).await;
        let client = Client::plain(served.address);
        Self {
            kit,
            fx: super::support::Fx {
                dir,
                host,
                drafters,
            },
            served,
            client,
            clock,
        }
    }

    /// The workspace's directory.
    pub fn dir(&self) -> &Path {
        self.fx.dir.path()
    }

    /// The first host.
    pub fn host(&self) -> &Host {
        &self.fx.host
    }

    /// Rewrite `umbel.toml` to `text`, for the next host [`Self::second`] opens.
    pub fn rewrite(&self, text: &str) {
        std::fs::write(self.dir().join("umbel.toml"), text).unwrap();
    }

    /// A second host on the same workspace, served on its own port.
    pub async fn second(&self) -> (Host, Served, Client) {
        let host = host_with(self.dir(), &self.kit, &self.clock, self.fx.drafters);
        host.check_person_logins().await;
        let served = Served::start(&host).await;
        let client = Client::plain(served.address);
        (host, served, client)
    }

    pub fn now_s(&self) -> i64 {
        afd::Clock::now(&self.clock).div_euclid(1000)
    }

    /// An access token for `subject` from client `client`, with [`SCOPES`].
    pub fn token(&self, subject: &str, client: &str) -> String {
        self.kit
            .authorization_server()
            .access_token(PUBLIC_URL)
            .issued_at(self.now_s())
            .lifetime(300)
            .subject(subject)
            .client_id(client)
            .scopes(SCOPES)
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
        call(
            &self.client,
            &self.token(subject, client),
            tool,
            arguments,
            extra,
            true,
        )
        .await
    }

    /// Propose an update of `alpha`'s `handbook/runbook` as `subject`'s client `client`, over
    /// MCP, under `key`; the proposal's id.
    pub async fn propose(&self, subject: &str, client: &str, key: &str) -> String {
        let base = hash_of(self.host(), "corp/ada", "alpha", "handbook/runbook").await;
        let answer = self
            .call(
                subject,
                client,
                "knowledge-propose",
                propose_input("alpha", key, "handbook/runbook", &base, UPDATED),
                json!({}),
            )
            .await;
        proposal_id(&result(&answer))
    }

    /// Propose as `actor` through the library (`human:ada` for a legacy principal, say).
    pub async fn propose_as(
        &self,
        actor: Actor,
        space: &str,
        doc: &str,
        reader: &str,
        key: &str,
    ) -> String {
        let base = hash_of(self.host(), reader, space, doc).await;
        let answer = run(
            self.host(),
            library(self.host(), actor),
            "knowledge-propose",
            propose_input(space, key, doc, &base, UPDATED),
        )
        .await;
        proposal_id(&answer)
    }

    /// Log in as `user` on decision `path` and decide `decision`; the page's answer.
    pub async fn decide(&self, path: &str, user: &str, decision: &str) -> (LoggedIn, Reply) {
        decide(&self.kit, &self.client, path, ORIGIN, user, decision).await
    }

    /// The file `relative` under `spaces/`.
    pub fn file(&self, relative: &str) -> String {
        std::fs::read_to_string(self.dir().join("spaces").join(relative)).unwrap()
    }

    /// The journal's entries for `command`.
    pub fn journal(&self, command: &str) -> Vec<Value> {
        std::fs::read_to_string(self.dir().join("state/journal.jsonl"))
            .unwrap_or_default()
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .filter(|entry| entry["command"] == command)
            .collect()
    }
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
pub fn gateway_config(kit: &TestIdp, port: u16, acr: &str) -> String {
    format!(
        r#"config_version = 5
default_space = "alpha"

[principal]
local_id = "corp/ada"

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
max_scopes = ["umbel:read", "umbel:write", "umbel:approve"]

{rest}
"#,
        login = person_login(kit, acr),
        issuer = kit.gateway().issuer(),
        rest = spaces_and_plugins(""),
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

/// A served `gateway` relay workspace: the gateway-facing listener (loopback, plain HTTP) and the
/// person page's own listener (TLS, origin `https://localhost:<port>`), with a browser of it.
pub struct GatewayRelay {
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

impl GatewayRelay {
    /// Start, the person login asking for `acr` (TOML list items).
    pub async fn start(acr: &str) -> Self {
        let kit = TestIdp::start().await.unwrap();
        // Every class a test login may ask for is one the provider lists.
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
            gateway_config(&kit, port, acr),
        )
        .unwrap();
        std::fs::create_dir_all(dir.path().join("gateway")).unwrap();
        std::fs::write(
            dir.path().join("gateway/jwks.json"),
            pinned_jwks(&kit).to_string(),
        )
        .unwrap();
        write_person_tls(dir.path(), kit.ca(), &["127.0.0.1", "localhost"]);
        write_files(dir.path());
        let clock = afd::fixed_clock(now_ms());
        follow(&kit, &clock);
        let host = host(dir.path(), &kit, &clock);
        host.check_person_logins().await;
        refresh(&host).await;
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
            true,
        )
        .await
    }
}
