//! The person page end to end (phase 5 step 5): an `oauth` workspace whose namespace `corp` has a
//! person login at the kit's identity provider, a compiled plugin `gate` with commands a person
//! decides, and a scripted browser that opens the page, logs in at the kit and decides.

use std::sync::{Arc, Mutex};

use afd::ManualClock;
use serde_json::{Value, json};
use umbel::{Host, HostBuilder};
use umbel_testkit_idp::{Client as KitClient, LoginScript, TestIdp};

use super::hosted::{Client, PUBLIC_URL, Reply, Served};
use super::oauth::{Setup, now_ms};
use super::plugins::{Raw, closure};

/// The person page's client secret at the kit.
pub const SECRET: &str = "person-page-test-secret-6f1e";
/// The page's redirect URI, as the host derives it from the public URL.
pub const REDIRECT: &str = "https://127.0.0.1/mcp/d/return";
/// The public origin a decision's form posts from.
pub const ORIGIN: &str = "https://127.0.0.1";
/// What a preview of proposal `canary` shows, never stored.
pub const PREVIEW_CANARY: &str = "preview-canary-0c91d2";

pub const MANIFEST: &str = r#"manifest_version = 5
protocol = 1

[plugin]
id = "gate"
title = "Gate"
version = "0.1.0"
description = "Commands a person decides on the person page."
kind = "compiled"
domains = ["gate"]

[[commands]]
name = "gate-approve"
description = "Apply a proposal, decided by a person."
effects = ["plugin-state"]
input_schema = { type = "object", properties = { space = { type = "string" }, proposal = { type = "string" }, reason = { type = "string" } }, required = ["proposal"], additionalProperties = false }
confirm_prompt = "Apply this proposal?"
confirm = "require-human"
person = { cli = "verified", mcp = "verified" }
expose = { mcp = true, agent = false, cli = true }
confirm_preview = "gate-preview"
journal = { mode = "digest", keep = ["space", "proposal"] }

[[commands]]
name = "gate-reject"
description = "Reject a proposal, decided by a person."
effects = ["plugin-state"]
input_schema = { type = "object", properties = { space = { type = "string" }, proposal = { type = "string" } }, required = ["proposal"], additionalProperties = false }
confirm_prompt = "Reject this proposal?"
confirm = "require-human"
person = { cli = "terminal", mcp = "verified" }
expose = { mcp = true, agent = false, cli = true }
confirm_preview = "gate-preview"
journal = { mode = "digest", keep = ["space", "proposal"] }

[[commands]]
name = "gate-terminal"
description = "A command a person confirms at a terminal only."
effects = ["plugin-state"]
input_schema = { type = "object", properties = { proposal = { type = "string" } }, additionalProperties = false }
confirm_prompt = "Really?"
confirm = "require-human"
expose = { mcp = false, agent = false, cli = true }

[[commands]]
name = "gate-preview"
description = "Render what is about to be decided."
effects = ["inspect"]
input_schema = { type = "object", properties = { space = { type = "string" }, proposal = { type = "string" } }, additionalProperties = false }
expose = { mcp = false, agent = false, cli = true }
journal = { mode = "digest", keep = ["proposal"] }
returns = { type = "object", properties = { preview = { type = "string" } }, required = ["preview"], additionalProperties = false }
"#;

/// What the gate's commands saw.
#[derive(Clone, Default)]
pub struct Seen(pub Arc<Mutex<Vec<Value>>>);

impl Seen {
    pub fn of(&self, command: &str) -> Vec<Value> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|call| call["command"] == command)
            .cloned()
            .collect()
    }

    pub fn runs(&self, command: &str) -> usize {
        self.of(command).len()
    }
}

/// The preview of proposal `proposal`; `checking` when the host runs it as the caller before it
/// begins a decision (step 6), which carries `dev.umbel/person-check`.
fn preview_of(proposal: &str, checking: bool) -> afd::CommandResult<Value> {
    match proposal {
        "xss" => afd::success(json!({
            "preview": "<script>alert(1)</script>\"><img src=x onerror=alert(2)> & 'q'",
        })),
        // Fails on the page only: the host's check before begin passes.
        "fail" if !checking => afd::failure(
            afd::CommandError::new("PREVIEW_BROKEN", "the preview broke")
                .with_suggestion("Fix the preview."),
        ),
        // Refuses the caller: the host's check before begin fails, so no person is asked.
        "refuse" => afd::failure(
            afd::CommandError::new("GATE_REFUSED", "the gate refuses this proposal")
                .with_suggestion("Ask someone else.")
                .with_retryable(false),
        ),
        "canary" => afd::success(json!({ "preview": format!("Proposal {PREVIEW_CANARY}") })),
        other => afd::success(json!({ "preview": format!("Proposal {other}: apply it") })),
    }
}

/// The compiled plugin `gate`, recording every call into `seen`.
pub fn plugin(seen: &Seen) -> Raw {
    plugin_with(seen, MANIFEST.to_owned())
}

/// The plugin `gate` with `manifest` in place of [`MANIFEST`].
pub fn plugin_with(seen: &Seen, manifest: String) -> Raw {
    let seen = seen.clone();
    Raw::new(manifest, move |_| {
        let record = |name: &'static str, seen: Seen| {
            closure(name, move |input, context| {
                seen.0.lock().unwrap().push(json!({
                    "command": name,
                    "input": input,
                    "principal": context.extra.get("dev.umbel/principal"),
                    "mark": context.extra.get("dev.umbel/person-decision"),
                    "check": context.extra.get("dev.umbel/person-check"),
                    "interface": format!("{:?}", context.interface),
                }));
                if name == "gate-preview" {
                    let checking = context
                        .extra
                        .get("dev.umbel/person-check")
                        .is_some_and(|check| !check.is_null());
                    preview_of(input["proposal"].as_str().unwrap_or_default(), checking)
                } else {
                    afd::success(json!({ "done": input["proposal"] }))
                }
            })
        };
        Ok(vec![
            record("gate-approve", seen.clone()),
            record("gate-reject", seen.clone()),
            record("gate-terminal", seen.clone()),
            record("gate-preview", seen.clone()),
        ])
    })
}

/// The `[plugins]` and space tables of the person page's workspaces.
pub const REST: &str = "[spaces.other]\n\n[plugins]\nenabled = [\"gate\"]\n";

/// The extra `[mcp]`-free settings: confirmations that never prove a person.
pub const AUTH: &str = "";

/// Make the kit's identity provider sign ID tokens on `clock`, the host's, so a login's times
/// never depend on the wall time.
pub fn follow(kit: &TestIdp, clock: &ManualClock) {
    let clock = clock.clone();
    kit.identity_provider().follow_clock(Some(Arc::new(move || {
        afd::Clock::now(&clock).div_euclid(1000)
    })));
}

/// A served `oauth` workspace with the gate plugin, the kit's person login and a browser.
pub struct Page {
    pub kit: TestIdp,
    pub dir: tempfile::TempDir,
    pub host: Host,
    pub served: Served,
    pub client: Client,
    pub clock: ManualClock,
    pub seen: Seen,
}

/// A host over `dir` for the page's tests: the kit's CA, the person secret, the gate plugin.
pub fn host(dir: &std::path::Path, kit: &TestIdp, clock: &ManualClock, seen: &Seen) -> Host {
    let seen = seen.clone();
    super::oauth::host_with(dir, kit, Some(clock), None, move |builder: HostBuilder| {
        builder
            .with_compiled(plugin(&seen))
            .with_auth_secret("UMBEL_TEST_PERSON_SECRET", SECRET)
    })
}

impl Page {
    /// Start with the default setup, `rest` appended.
    pub async fn start() -> Self {
        Self::start_with(Setup {
            rest: REST,
            ..Setup::default()
        })
        .await
    }

    /// Start with `setup`.
    pub async fn start_with(setup: Setup<'_>) -> Self {
        let kit = TestIdp::start().await.unwrap();
        kit.identity_provider().register_client(
            KitClient::confidential("umbel-person-page", SECRET).redirect_uri(REDIRECT),
        );
        let dir = super::workspace(&super::oauth::config(&kit, &setup));
        let clock = afd::fixed_clock(now_ms());
        follow(&kit, &clock);
        let seen = Seen::default();
        let host = host(dir.path(), &kit, &clock, &seen);
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
            seen,
        }
    }

    /// A second host on the same workspace, served on its own port.
    pub async fn second(&self) -> (Host, Served, Client) {
        let host = host(self.dir.path(), &self.kit, &self.clock, &self.seen);
        host.check_person_logins().await;
        let served = Served::start(&host).await;
        let client = Client::plain(served.address);
        (host, served, client)
    }

    pub fn now_s(&self) -> i64 {
        afd::Clock::now(&self.clock).div_euclid(1000)
    }

    /// An access token of the authorization server for `subject`, client `test-client`, with
    /// `read`, `write` and `approve`.
    pub fn token(&self, subject: &str) -> String {
        self.kit
            .authorization_server()
            .access_token(PUBLIC_URL)
            .issued_at(self.now_s())
            .lifetime(300)
            .subject(subject)
            .scopes(["umbel:read", "umbel:write", "umbel:approve"])
            .sign()
    }

    /// The same, from client `client`.
    pub fn token_of(&self, subject: &str, client: &str) -> String {
        self.kit
            .authorization_server()
            .access_token(PUBLIC_URL)
            .issued_at(self.now_s())
            .lifetime(300)
            .subject(subject)
            .client_id(client)
            .scopes(["umbel:read", "umbel:write", "umbel:approve"])
            .sign()
    }

    /// The `extra` keys a command's context carried for `token` (`fixture-whoami`'s).
    pub async fn extra_keys(&self, token: &str) -> Vec<String> {
        let answer = call(
            &self.client,
            token,
            "fixture-whoami",
            json!({}),
            json!({}),
            true,
        )
        .await;
        result(&answer)["data"]["extraKeys"]
            .as_array()
            .unwrap_or_else(|| panic!("{answer}"))
            .iter()
            .map(|key| key.as_str().unwrap().to_owned())
            .collect()
    }

    /// Queue the identity provider's next login.
    pub fn script(&self, script: impl Into<LoginScript>) {
        self.kit.identity_provider().script_login(script);
    }
}

/// `tools/call` of `tool` with `arguments` from a 2026-07-28 client that declared URL-mode
/// elicitation (unless `url` is false), sending `token`, with `extra` params (`inputResponses`,
/// `requestState`).
pub async fn call(
    client: &Client,
    token: &str,
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
    let bearer = format!("Bearer {token}");
    let headers = [
        ("content-type", "application/json"),
        ("accept", "application/json, text/event-stream"),
        ("mcp-protocol-version", "2026-07-28"),
        ("mcp-method", "tools/call"),
        ("mcp-name", tool),
        ("authorization", bearer.as_str()),
    ];
    let reply: Reply = client
        .send(client.request("POST", "/mcp", &headers, body.to_string()))
        .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    reply.json()
}

/// An `input_required` answer's relay prompt: the URL, its message and the state.
#[derive(Debug, Clone)]
pub struct Asked {
    pub url: String,
    pub message: String,
    pub state: String,
    pub elicitation_id: String,
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
    /// The page's path, from the URL.
    pub fn path(&self) -> String {
        path_of(&self.url)
    }

    /// The decision id, from the URL.
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
        elicitation_id: params["elicitationId"].as_str().unwrap().to_owned(),
    }
}

/// The retry carrying the relay's `accept` and `state`.
pub fn accepted(state: &str) -> Value {
    json!({ "inputResponses": { "relay": { "action": "accept" } }, "requestState": state })
}

/// A `CommandResult` from a call's answer.
pub fn result(answer: &Value) -> Value {
    answer["result"]["structuredContent"].clone()
}

/// What the browser holds after opening a decision's link.
pub struct Opened {
    /// The identity provider's authorization URL.
    pub location: String,
    /// The login cookie's name and value.
    pub cookie: (String, String),
    pub reply: Reply,
}

impl Opened {
    pub fn cookie_header(&self) -> String {
        format!("{}={}", self.cookie.0, self.cookie.1)
    }

    /// The `state` the authorization URL carries.
    pub fn state(&self) -> String {
        query_value(&self.location, "state").unwrap()
    }
}

/// The value of `name` in `url`'s query.
pub fn query_value(url: &str, name: &str) -> Option<String> {
    let query = url.split_once('?')?.1;
    url::form_urlencoded::parse(query.as_bytes())
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
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
/// and query the identity provider redirects back to, which must be [`ORIGIN`]'s.
pub async fn authorize(kit: &TestIdp, location: &str) -> String {
    authorize_to(kit, location, ORIGIN).await
}

/// [`authorize`], the redirect back required to be at `origin`.
pub async fn authorize_to(kit: &TestIdp, location: &str, origin: &str) -> String {
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

/// Open `path`, log in at the kit with the queued script, and come back with the cookie.
pub async fn login(page: &Page, client: &Client, path: &str) -> LoggedIn {
    login_at(&page.kit, client, path, ORIGIN).await
}

/// [`login`] at `kit`, on the page whose origin is `origin`, whatever served it.
pub async fn login_at(kit: &TestIdp, client: &Client, path: &str, origin: &str) -> LoggedIn {
    let opened = open(client, path).await;
    let back = authorize_to(kit, &opened.location, origin).await;
    let cookie = opened.cookie_header();
    let reply = client.get(&back, &[("cookie", cookie.as_str())]).await;
    let form = form(&reply.text);
    LoggedIn {
        opened,
        page: reply,
        form,
    }
}

/// Post a decision for decision `id` with `login`, `csrf`, the cookie and an `Origin`.
pub async fn decide(
    client: &Client,
    id: &str,
    fields: &str,
    cookie: Option<&str>,
    origin: Option<&str>,
) -> Reply {
    decide_to(client, &format!("/mcp/d/{id}"), fields, cookie, origin).await
}

/// [`decide`], posting to the page's `path` (`<prefix>/d/<id>`).
pub async fn decide_to(
    client: &Client,
    path: &str,
    fields: &str,
    cookie: Option<&str>,
    origin: Option<&str>,
) -> Reply {
    let mut headers: Vec<(&str, &str)> =
        vec![("content-type", "application/x-www-form-urlencoded")];
    if let Some(cookie) = cookie {
        headers.push(("cookie", cookie));
    }
    if let Some(origin) = origin {
        headers.push(("origin", origin));
    }
    client
        .send(client.request("POST", path, &headers, fields.to_owned()))
        .await
}

/// Log in as `user` and decide `decision` (`approve` or `decline`) on the page at `path`.
pub async fn decide_as(
    page: &Page,
    client: &Client,
    path: &str,
    user: &str,
    decision: &str,
) -> Reply {
    decide_as_at(&page.kit, client, path, user, decision, ORIGIN).await
}

/// [`decide_as`] at `kit`, posting from `origin` to the page at `path`, whatever served it.
pub async fn decide_as_at(
    kit: &TestIdp,
    client: &Client,
    path: &str,
    user: &str,
    decision: &str,
    origin: &str,
) -> Reply {
    kit.identity_provider()
        .script_login(umbel_testkit_idp::ScriptedLogin::user(user));
    let logged = login_at(kit, client, path, origin).await;
    assert_eq!(logged.page.status, 200, "{}", logged.page.text);
    let (login, csrf) = logged.form.clone().unwrap();
    let cookie = logged.opened.cookie_header();
    decide_to(
        client,
        path,
        &format!("login={login}&csrf={csrf}&decision={decision}"),
        Some(&cookie),
        Some(origin),
    )
    .await
}
