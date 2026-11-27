//! An Ideas instance in mode `oauth`, the shape the plan's hosted exit takes (Ideas plan,
//! section 7, measures 11, 13 and 14; steps 0.9 and 0.10; #2007), end to end over real sockets
//! with `umbel-testkit-idp` as the authorization server and the person's identity provider.
//!
//! What a real deployment adds is a provider, a public address and real harnesses. What is in
//! this repository is held here, before the owner chooses a cloud host:
//!
//! - **Finding how to sign in.** A call with no token is refused with the challenge that names
//!   the protected-resource metadata, and the metadata names the authorization server, which is
//!   all a cloud connector needs to begin its OAuth flow.
//! - **Measure 11.** Two harnesses, each its own OAuth client, capture and ask against one
//!   instance over stateless MCP, each in one call, and see each other's ideas.
//! - **Measure 14's inputs.** A signed-in harness with no skill gets the instance's own
//!   instructions paragraph and its first-class tools, as a local one does.
//! - **Measure 13 and step 0.9.** A review of 150 decisions in three groups is staged with no
//!   login and confirmed on the person page, one login a group, after a passkey login with user
//!   verification as D181 defines it (`acr` `phr`, `amr` `mfa`: what Better Auth reports once it
//!   reports `acr` and `amr`). What is applied is recorded at level `verified`. A login without
//!   user verification confirms nothing, and a harness that cannot open a URL elicitation is told
//!   so (`url-elicitation-required`), which is the fallback step 0.9 asks about.
//!
//! Every clock is a `ManualClock` the test holds, and every text an invented fixture about
//! gardening.
#[path = "../../../../tests/support/hosted.rs"]
#[allow(dead_code, unreachable_pub, clippy::module_inception)]
mod hosted;

use std::path::Path;
use std::sync::Arc;

use afd::ManualClock;
use hosted::{Client, METADATA_PATHS, PUBLIC_URL, Reply, Served};
use serde_json::{Value, json};
use umbel::plugins::sdk;
use umbel::{Host, HostBuilder};
use umbel_testkit_idp::{Client as KitClient, ScriptedLogin, TestIdp};

/// The person page's client secret at the kit, and its environment variable.
const SECRET: &str = "ideas-test-person-secret-4b9e";
const SECRET_ENV: &str = "UMBEL_TEST_PERSON_SECRET";
/// The page's redirect URI and the origin its forms post from, as the host derives them from
/// [`PUBLIC_URL`].
const REDIRECT: &str = "https://127.0.0.1/mcp/d/return";
const ORIGIN: &str = "https://127.0.0.1";
/// The scopes a harness's token carries: `approve` for a confirmation on the person page.
const SCOPES: [&str; 3] = ["umbel:read", "umbel:write", "umbel:approve"];
/// The two harnesses, each its own OAuth client acting for the space's person.
const WEB: &str = "web-harness";
const PHONE: &str = "phone-harness";
/// The pack's `page_items`: a group of 50 is three pages.
const PAGE_ITEMS: usize = 20;

const ROSES: &str = "Prune roses in late winter, before the buds swell.";
const SUN: &str = "Roses want morning sun and shelter from the afternoon heat.";

/// The plugin specification's paragraph for the server's instructions (section 11.2).
fn paragraph() -> String {
    const SPEC: &str = include_str!("../../../../docs/plugins/ideas/spec.md");
    let (_, rest) = SPEC
        .split_once("### 11.2 The paragraph for the server's instructions")
        .unwrap();
    rest.lines()
        .skip_while(|line| !line.starts_with('>'))
        .take_while(|line| line.starts_with('>'))
        .map(|line| line.trim_start_matches('>').trim())
        .collect::<Vec<_>>()
        .join(" ")
}

/// An `oauth` workspace: namespace `corp`, whose person login asks for D181's passkey login
/// (`acr_values = ["phr"]`, `uv_amr = ["mfa"]`, the `better-auth` preset's person rule in the
/// auth profiles specification, 7.2); the kit's authorization server as issuer `as`; the space
/// `main` with the person `human:corp/ada`; the ideas plugin, whose manifest gives the paragraph
/// for the instructions; and the first-class tools as the README's instance sets them (section
/// 11.4).
fn config(kit: &TestIdp) -> String {
    format!(
        r#"config_version = 7
default_space = "main"

[principal]
local_id = "corp/ada"

[http]
public_url = "{PUBLIC_URL}"
allowed_hosts = ["127.0.0.1"]

[mcp]
first_class_tools = ["ideas-capture", "ideas-ask", "ideas-guide"]

[auth]
mode = "oauth"

[auth.namespaces.corp]
person = {{ issuer = "idp", client_id = "umbel-person-page", client_secret_env = "{SECRET_ENV}", acr_values = ["phr"], uv_amr = ["mfa"] }}

[auth.issuers.idp]
issuer = "{idp}"
namespace = "corp"
access_tokens = false

[auth.issuers.as]
issuer = "{issuer}"
namespace = "corp"
algorithms = ["ES256", "RS256"]

[spaces.main]
person = "human:corp/ada"

[plugins]
enabled = ["ideas"]

[plugins.ideas]
source = "compiled:ideas"

[plugins.ideas.grants.records_write]
allow = ["main"]
default_access = "space"
"#,
        idp = kit.identity_provider().issuer(),
        issuer = kit.authorization_server().issuer(),
    )
}

/// Now, in milliseconds.
fn now_ms() -> i64 {
    i64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis(),
    )
    .unwrap()
}

/// `url`'s path and query.
fn path_of(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    rest.find('/')
        .map_or_else(|| "/".to_owned(), |start| rest[start..].to_owned())
}

/// The value of the hidden input `name` on a rendered page.
fn hidden(page: &str, name: &str) -> Option<String> {
    let marker = format!("name=\"{name}\" value=\"");
    let start = page.find(&marker)? + marker.len();
    let end = page[start..].find('"')? + start;
    Some(page[start..end].to_owned())
}

/// The texts of a page's items (its checkboxes), unescaped.
fn items(page: &str) -> Vec<String> {
    page.split("name=\"k\" value=\"")
        .skip(1)
        .map(|item| {
            let start = item.find("<span>").unwrap() + "<span>".len();
            let end = item.find("</span>").unwrap();
            item[start..end]
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&#x27;", "'")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&amp;", "&")
        })
        .collect()
}

/// A `CommandResult` from a `tools/call` answer.
fn result(answer: &Value) -> Value {
    answer["result"]["structuredContent"].clone()
}

/// `data` of a successful result.
#[track_caller]
fn data(answer: &Value) -> Value {
    let result = result(answer);
    assert_eq!(result["success"], true, "{answer}");
    result["data"].clone()
}

/// A relay prompt: the page's URL and the state to retry with.
struct Asked {
    url: String,
    message: String,
    state: String,
}

/// The relay prompt of an answer, which must be `input_required` with one URL request.
#[track_caller]
fn asked(answer: &Value) -> Asked {
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

/// The retry carrying the relay's `accept` and `state`.
fn accepted(state: &str) -> Value {
    json!({ "inputResponses": { "relay": { "action": "accept" } }, "requestState": state })
}

/// A served `oauth` workspace with the ideas plugin: the kit, the host on its own listener, and
/// one HTTP client that is every harness and the person's browser (the page is served beside the
/// MCP path).
struct Instance {
    kit: TestIdp,
    _dir: tempfile::TempDir,
    _host: Host,
    _served: Served,
    client: Client,
    clock: ManualClock,
}

impl Instance {
    async fn start() -> Self {
        Self::start_with("").await
    }

    /// An instance whose configuration has `extra` appended.
    async fn start_with(extra: &str) -> Self {
        let kit = TestIdp::start().await.unwrap();
        kit.identity_provider().register_client(
            KitClient::confidential("umbel-person-page", SECRET).redirect_uri(REDIRECT),
        );
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("umbel.toml"),
            format!("{}{extra}", config(&kit)),
        )
        .unwrap();
        let clock = afd::fixed_clock(now_ms());
        let follow = clock.clone();
        kit.identity_provider().follow_clock(Some(Arc::new(move || {
            afd::Clock::now(&follow).div_euclid(1000)
        })));
        let host = build(dir.path(), &kit, &clock);
        host.check_person_logins().await;
        let served = Served::start(&host).await;
        let client = Client::plain(served.address);
        Self {
            kit,
            _dir: dir,
            _host: host,
            _served: served,
            client,
            clock,
        }
    }

    fn now_s(&self) -> i64 {
        afd::Clock::now(&self.clock).div_euclid(1000)
    }

    /// An access token for `ada` from `client`, as the authorization server issues one after the
    /// harness's OAuth flow.
    fn token(&self, client: &str) -> String {
        self.kit
            .authorization_server()
            .access_token(PUBLIC_URL)
            .issued_at(self.now_s())
            .lifetime(3000)
            .subject("ada")
            .client_id(client)
            .scopes(SCOPES)
            .sign()
    }

    /// POST one JSON-RPC request of `method` to `/mcp` as a 2026-07-28 client, stateless (no
    /// session header, ever), with `capabilities` and `token` when given.
    async fn rpc(
        &self,
        method: &str,
        params: Value,
        capabilities: Value,
        token: Option<&str>,
        name: Option<&str>,
    ) -> Reply {
        let mut meta = umbel::testkit::mcp::modern_meta();
        meta["io.modelcontextprotocol/clientCapabilities"] = capabilities;
        let mut params = params;
        params["_meta"] = meta;
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let bearer = token.map(|token| format!("Bearer {token}"));
        let mut headers = vec![
            ("content-type", "application/json"),
            ("accept", "application/json, text/event-stream"),
            ("mcp-protocol-version", "2026-07-28"),
            ("mcp-method", method),
        ];
        if let Some(name) = name {
            headers.push(("mcp-name", name));
        }
        if let Some(bearer) = &bearer {
            headers.push(("authorization", bearer));
        }
        let reply = self
            .client
            .send(
                self.client
                    .request("POST", "/mcp", &headers, body.to_string()),
            )
            .await;
        assert!(
            reply.headers.get("mcp-session-id").is_none(),
            "a stateless server keeps no session"
        );
        reply
    }

    /// `tool` with `arguments` from harness `client`, which declared URL-mode elicitation, with
    /// `extra` params (the relay's retry): the JSON-RPC answer.
    async fn call(&self, client: &str, tool: &str, arguments: Value, extra: Value) -> Value {
        let mut params = json!({ "name": tool, "arguments": arguments });
        if let Value::Object(extra) = extra {
            for (key, value) in extra {
                params[key] = value;
            }
        }
        let reply = self
            .rpc(
                "tools/call",
                params,
                json!({ "elicitation": { "url": {}, "form": {} } }),
                Some(&self.token(client)),
                Some(tool),
            )
            .await;
        assert_eq!(reply.status, 200, "{}", reply.text);
        reply.json()
    }

    /// Open the decision page at `path` and log in at the kit as `script` says: the cookie and
    /// the page the provider's return lands on.
    async fn log_in(&self, path: &str, script: ScriptedLogin) -> (String, Reply) {
        self.kit.identity_provider().script_login(script);
        let opened = self.client.get(path, &[]).await;
        assert_eq!(opened.status, 302, "{}", opened.text);
        let location = opened.headers["location"].to_str().unwrap().to_owned();
        let set = opened.headers["set-cookie"].to_str().unwrap();
        let cookie = set.split(';').next().unwrap().to_owned();
        let kit = Client::tls(self.kit.address(), self.kit.ca().certificate_pem(), None);
        let at_kit = location
            .strip_prefix(self.kit.base_url())
            .unwrap_or(&location)
            .to_owned();
        let authorized = kit.get(&at_kit, &[]).await;
        assert!(
            matches!(authorized.status, 302 | 303),
            "{}",
            authorized.text
        );
        let back = authorized.headers["location"].to_str().unwrap().to_owned();
        assert!(back.starts_with(&format!("{ORIGIN}/")), "{back}");
        let page = self
            .client
            .get(&path_of(&back), &[("cookie", cookie.as_str())])
            .await;
        (cookie, page)
    }

    /// Post a decision's form with this login's cookie.
    async fn post(&self, path: &str, cookie: &str, form: &str) -> Reply {
        let headers = [
            ("content-type", "application/x-www-form-urlencoded"),
            ("cookie", cookie),
            ("origin", ORIGIN),
        ];
        self.client
            .send(self.client.request("POST", path, &headers, form.to_owned()))
            .await
    }

    /// Log in on the decision at `path` with a passkey login (D181), read every page, keep every
    /// item, and approve on the last: each page's items.
    async fn read_and_approve(&self, path: &str) -> Vec<Vec<String>> {
        let (cookie, mut page) = self
            .log_in(path, ScriptedLogin::user("ada").amr(["mfa"]))
            .await;
        let base = path.split('?').next().unwrap().to_owned();
        let mut shown = Vec::new();
        loop {
            assert_eq!(page.status, 200, "{}", page.text);
            let these = items(&page.text);
            assert!(these.len() <= PAGE_ITEMS, "{}", page.text);
            let number = shown.len() + 1;
            let pages = page
                .text
                .split_once("<p>Page ")
                .and_then(|(_, rest)| rest.split_once(". Approve"))
                .map_or(1, |(numbers, _)| {
                    numbers.rsplit(' ').next().unwrap().parse().unwrap()
                });
            let last = number == pages;
            let mut form = format!(
                "login={}&csrf={}&page={number}&decision={}",
                hidden(&page.text, "login").unwrap(),
                hidden(&page.text, "csrf").unwrap(),
                if last { "approve" } else { "next" }
            );
            for position in 0..these.len() {
                form.push_str(&format!("&k={position}"));
            }
            shown.push(these);
            let posted = self.post(&base, &cookie, &form).await;
            if last {
                assert_eq!(posted.status, 200, "{}", posted.text);
                assert!(posted.text.contains("You approved"), "{}", posted.text);
                return shown;
            }
            assert_eq!(posted.status, 303, "{}", posted.text);
            // The browser follows the page's own redirect, and says so (fetch metadata).
            let to = posted.headers["location"].to_str().unwrap().to_owned();
            page = self
                .client
                .get(
                    &to,
                    &[
                        ("cookie", cookie.as_str()),
                        ("sec-fetch-site", "same-origin"),
                    ],
                )
                .await;
        }
    }
}

/// A host over `dir` with the ideas plugin, trusting the kit's CA, with the person login's
/// secret, on `clock` for commands, tokens and decisions alike.
fn build(dir: &Path, kit: &TestIdp, clock: &ManualClock) -> Host {
    HostBuilder::open(dir)
        .unwrap()
        .with_compiled(Arc::new(sdk(umbel_plugin_ideas::plugin())))
        .with_clock(clock.clone())
        .with_auth_root_certificate(kit.ca().certificate_pem().as_bytes().to_vec())
        .with_auth_clock(clock.clone())
        .with_auth_secret(SECRET_ENV, SECRET)
        .seal()
        .unwrap()
}

/// `count` statements about beds, each its own idea.
fn beds(count: usize) -> Vec<String> {
    (0..count)
        .map(|i| {
            format!(
                "Bed {i} wants {} barrows of leaf mould before the frost.",
                i % 7 + 2
            )
        })
        .collect()
}

#[tokio::test]
async fn a_harness_with_no_token_is_told_where_to_sign_in() {
    let instance = Instance::start().await;
    let refused = instance
        .rpc(
            "tools/call",
            json!({ "name": "ideas-ask", "arguments": { "question": "When do I prune?" } }),
            json!({}),
            None,
            Some("ideas-ask"),
        )
        .await;
    assert_eq!(refused.status, 401, "{}", refused.text);
    let challenge = refused.headers["www-authenticate"].to_str().unwrap();
    assert!(
        challenge.contains(&format!(
            "resource_metadata=\"https://127.0.0.1{}\"",
            METADATA_PATHS[0]
        )),
        "{challenge}"
    );
    // The metadata names the authorization server a cloud connector signs in at.
    let metadata = instance.client.get(METADATA_PATHS[0], &[]).await;
    assert_eq!(metadata.status, 200, "{}", metadata.text);
    let metadata = metadata.json();
    assert_eq!(metadata["resource"], PUBLIC_URL);
    assert_eq!(
        metadata["authorization_servers"],
        json!([instance.kit.authorization_server().issuer()])
    );
}

#[tokio::test]
async fn a_signed_in_harness_with_no_skill_gets_the_instances_instructions_and_tools() {
    // Measure 14's inputs, over hosted MCP: the paragraph and the first-class tools.
    let instance = Instance::start().await;
    let token = instance.token(PHONE);
    let discovered = instance
        .rpc("server/discover", json!({}), json!({}), Some(&token), None)
        .await;
    assert_eq!(discovered.status, 200, "{}", discovered.text);
    let discovered = discovered.json();
    // AFD's default, then the manifest's paragraph (Umbel's phase 1 specification, section 8.7).
    let instructions = discovered["result"]["instructions"].as_str().unwrap();
    assert!(
        instructions.ends_with(&format!("\n\n{}", paragraph())),
        "{instructions}"
    );
    assert!(instructions.contains("is an AFD server."), "{instructions}");
    let listed = instance
        .rpc("tools/list", json!({}), json!({}), Some(&token), None)
        .await;
    assert_eq!(listed.status, 200, "{}", listed.text);
    let listed = listed.json();
    let names: Vec<&str> = listed["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    for first_class in ["ideas-capture", "ideas-ask", "ideas-guide"] {
        assert!(names.contains(&first_class), "{names:?}");
    }
}

#[tokio::test]
async fn two_harnesses_capture_and_ask_one_instance_each_in_one_call() {
    // Measure 11: one call each once the vocabulary is known; `ideas-guide` gives it the first
    // time, so a harness new to the instance takes two.
    let instance = Instance::start().await;
    let guide = data(
        &instance
            .call(WEB, "ideas-guide", json!({}), json!({}))
            .await,
    );
    let types: Vec<&str> = guide["types"]
        .as_array()
        .unwrap()
        .iter()
        .map(|kind| kind["name"].as_str().unwrap())
        .collect();
    assert!(types.contains(&"principle"), "{guide}");

    let captured = data(
        &instance
            .call(
                WEB,
                "ideas-capture",
                json!({ "ideas": [{ "statement": ROSES, "type": "principle", "said": "person" }] }),
                json!({}),
            )
            .await,
    );
    assert_eq!(captured["captured"], 1, "{captured}");
    let roses = captured["ideas"][0]["id"].as_str().unwrap().to_owned();

    // The other harness, its own client, finds it in one call, then adds its own.
    let asked_phone = data(
        &instance
            .call(
                PHONE,
                "ideas-ask",
                json!({ "question": "When should I prune the roses?" }),
                json!({}),
            )
            .await,
    );
    let found: Vec<&str> = asked_phone["ideas"]
        .as_array()
        .unwrap()
        .iter()
        .map(|idea| idea["id"].as_str().unwrap())
        .collect();
    assert_eq!(found, [roses.as_str()], "{asked_phone}");
    let sun = data(
        &instance
            .call(
                PHONE,
                "ideas-capture",
                json!({ "ideas": [{ "statement": SUN, "type": "principle", "said": "person" }] }),
                json!({}),
            )
            .await,
    );
    assert_eq!(sun["captured"], 1, "{sun}");
    let sun = sun["ideas"][0]["id"].as_str().unwrap().to_owned();

    let asked_web = data(
        &instance
            .call(
                WEB,
                "ideas-ask",
                json!({ "question": "What do roses want?" }),
                json!({}),
            )
            .await,
    );
    let mut found: Vec<&str> = asked_web["ideas"]
        .as_array()
        .unwrap()
        .iter()
        .map(|idea| idea["id"].as_str().unwrap())
        .collect();
    found.sort_unstable();
    let mut expected = [roses.as_str(), sun.as_str()];
    expected.sort_unstable();
    assert_eq!(found, expected, "{asked_web}");
    assert_eq!(asked_web["pending"]["unreviewed"], 2, "{asked_web}");
}

#[tokio::test]
async fn a_review_of_150_staged_without_a_login_is_confirmed_on_the_person_page() {
    // Measure 13 on the hosted page, and step 0.9's question for a harness with URL elicitation.
    let instance = Instance::start().await;
    let statements = beds(150);
    let mut ids = Vec::new();
    for chunk in statements.chunks(64) {
        let ideas: Vec<Value> = chunk
            .iter()
            .map(|s| json!({ "statement": s, "type": "principle", "said": "person" }))
            .collect();
        let captured = data(
            &instance
                .call(WEB, "ideas-capture", json!({ "ideas": ideas }), json!({}))
                .await,
        );
        ids.extend(
            captured["ideas"]
                .as_array()
                .unwrap()
                .iter()
                .map(|idea| idea["id"].as_str().unwrap().to_owned()),
        );
    }
    assert_eq!(ids.len(), 150);
    let groups = ["beds-east", "beds-north", "beds-west"];
    let proposals: Vec<Value> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| {
            json!({ "decide": "affirm", "idea": id, "version": 1, "group": groups[i / 50],
                    "reason": "The person said it twice." })
        })
        .collect();
    // Staged by the agent with no login.
    let staged = data(
        &instance
            .call(
                WEB,
                "ideas-review-stage",
                json!({ "proposals": proposals }),
                json!({}),
            )
            .await,
    );
    assert_eq!(staged["staged"], 150, "{staged}");
    let review = staged["review"].as_str().unwrap().to_owned();

    for (index, group) in groups.iter().enumerate() {
        let shown = data(
            &instance
                .call(
                    WEB,
                    "ideas-review-show",
                    json!({ "review": review, "part": group, "limit": 1 }),
                    json!({}),
                )
                .await,
        );
        let digest = shown["parts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|part| part["part"] == *group)
            .unwrap_or_else(|| panic!("{shown}"))["digest"]
            .clone();
        let input = json!({ "review": review, "part": group, "digest": digest });
        // The first call asks: one URL elicitation whose message names the command, not the
        // ideas' words.
        let begun = instance
            .call(WEB, "ideas-review-apply", input.clone(), json!({}))
            .await;
        let prompt = asked(&begun);
        assert!(
            prompt.message.contains("ideas-review-apply"),
            "{}",
            prompt.message
        );
        assert!(!prompt.message.contains("leaf mould"), "{}", prompt.message);
        // The person signs in with a passkey and reads all three pages of the group.
        let pages = instance.read_and_approve(&path_of(&prompt.url)).await;
        assert_eq!(pages.len(), 3, "{group}");
        let seen: Vec<&String> = pages.iter().flatten().collect();
        assert_eq!(seen.len(), 50, "{group}");
        for i in index * 50..index * 50 + 50 {
            let needle = format!("\"Bed {i} wants");
            assert_eq!(
                seen.iter().filter(|text| text.contains(&needle)).count(),
                1,
                "Bed {i}"
            );
        }
        // The same call again runs, at level `verified`.
        let applied = data(
            &instance
                .call(WEB, "ideas-review-apply", input, accepted(&prompt.state))
                .await,
        );
        assert_eq!(applied["level"], "verified", "{applied}");
        assert_eq!(applied["applied"]["affirm"], 50, "{applied}");
        assert_eq!(applied["pulled"], json!([]), "{applied}");
        assert_eq!(
            applied["pending"]["staged"],
            150 - 50 * (index + 1),
            "{applied}"
        );
    }

    // An affirmed idea carries the login's assurance: the person page, D181's passkey class.
    let opened = data(
        &instance
            .call(PHONE, "ideas-open", json!({ "id": ids[75] }), json!({}))
            .await,
    );
    assert_eq!(opened["standing"], "affirmed", "{opened}");
    let assurance = &opened["label"]["affirmed"]["assurance"];
    assert_eq!(assurance["level"], "verified", "{opened}");
    assert_eq!(assurance["method"], "person-page", "{opened}");
    assert_eq!(assurance["acr"], "phr", "{opened}");
}

/// Stage one affirm and begin its apply from `client`: the call's input and its answer.
async fn begin_one(instance: &Instance, capabilities: Value) -> (Value, Reply) {
    let captured = data(
        &instance
            .call(
                WEB,
                "ideas-capture",
                json!({ "ideas": [{ "statement": ROSES, "type": "principle", "said": "person" }] }),
                json!({}),
            )
            .await,
    );
    let id = captured["ideas"][0]["id"].as_str().unwrap().to_owned();
    let staged = data(
        &instance
            .call(
                WEB,
                "ideas-review-stage",
                json!({ "proposals": [{ "decide": "affirm", "idea": id, "version": 1,
                                        "group": "roses", "reason": "Said twice." }] }),
                json!({}),
            )
            .await,
    );
    let part = &staged["parts"][0];
    let input =
        json!({ "review": staged["review"], "part": part["part"], "digest": part["digest"] });
    let reply = instance
        .rpc(
            "tools/call",
            json!({ "name": "ideas-review-apply", "arguments": input }),
            capabilities,
            Some(&instance.token(PHONE)),
            Some("ideas-review-apply"),
        )
        .await;
    (input, reply)
}

#[tokio::test]
async fn a_login_without_user_verification_confirms_nothing() {
    let instance = Instance::start().await;
    let (input, reply) = begin_one(
        &instance,
        json!({ "elicitation": { "url": {}, "form": {} } }),
    )
    .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let prompt = asked(&reply.json());
    // A password login, and a hardware key without user verification: refused at the return.
    for script in [
        ScriptedLogin::user("ada").amr(["pwd"]),
        ScriptedLogin::user("ada").amr(["hwk"]),
    ] {
        let (_, page) = instance.log_in(&path_of(&prompt.url), script).await;
        assert_eq!(page.status, 403, "{}", page.text);
        assert!(
            page.text.contains("PERSON_VERIFICATION_INSUFFICIENT"),
            "{}",
            page.text
        );
    }
    // Nothing was decided: the retry asks again, and the idea is still a seed.
    let retry = instance
        .call(PHONE, "ideas-review-apply", input, accepted(&prompt.state))
        .await;
    assert_eq!(retry["result"]["resultType"], "input_required", "{retry}");
    let guide = data(
        &instance
            .call(PHONE, "ideas-guide", json!({}), json!({}))
            .await,
    );
    assert_eq!(guide["pending"]["staged"], 1, "{guide}");
}

#[tokio::test]
async fn a_harness_without_url_elicitation_is_told_it_cannot_confirm() {
    // Step 0.9's other answer, by default: a harness that cannot open the page is refused with a
    // reason it can relay. `person.pending_list` gives it the decision instead (below).
    let instance = Instance::start().await;
    let (_, reply) = begin_one(&instance, json!({})).await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let refused = result(&reply.json());
    assert_eq!(refused["success"], false, "{refused}");
    assert_eq!(refused["error"]["code"], "APPROVAL_REQUIRED", "{refused}");
    assert_eq!(
        refused["error"]["details"]["reason"], "url-elicitation-required",
        "{refused}"
    );
    let guide = data(
        &instance
            .call(PHONE, "ideas-guide", json!({}), json!({}))
            .await,
    );
    assert_eq!(guide["pending"]["staged"], 1, "{guide}");
}

/// `ideas-review-apply` with `input` from harness `client`, which declared no URL-mode
/// elicitation: the tool's result.
async fn apply_without_url(instance: &Instance, client: &str, input: &Value) -> Value {
    let reply = instance
        .rpc(
            "tools/call",
            json!({ "name": "ideas-review-apply", "arguments": input }),
            json!({ "elicitation": { "form": {} } }),
            Some(&instance.token(client)),
            Some("ideas-review-apply"),
        )
        .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let answer = reply.json();
    assert_ne!(answer["result"]["resultType"], "input_required", "{answer}");
    result(&answer)
}

/// The pending-list refusal's decision id and page URL, checked against the instance's addresses.
#[track_caller]
fn listed(refused: &Value) -> (String, String) {
    let error = &refused["error"];
    assert_eq!(error["code"], "CONFIRMATION_REQUIRED", "{refused}");
    assert_eq!(error["retryable"], true, "{refused}");
    assert_eq!(error["details"]["reason"], "pending-list", "{refused}");
    let decision = error["details"]["decision"].as_str().unwrap().to_owned();
    let url = error["details"]["url"].as_str().unwrap().to_owned();
    assert_eq!(url, format!("{PUBLIC_URL}/d/{decision}"), "{refused}");
    assert_eq!(
        error["details"]["list"],
        format!("{PUBLIC_URL}/d/"),
        "{refused}"
    );
    (decision, url)
}

/// An instance with `person.pending_list` on, and one staged affirm: the instance and the apply's
/// input.
async fn listing() -> (Instance, Value) {
    let instance = Instance::start_with("\n[person]\npending_list = true\n").await;
    let (input, reply) = begin_one(&instance, json!({})).await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    (instance, input)
}

#[tokio::test]
async fn with_the_pending_list_a_harness_without_url_elicitation_confirms_on_the_page() {
    // P15's relay part (#2010): the harness is told where the decision is, the person decides on
    // the same page with the same login, and the same call sent again runs once.
    let (instance, input) = listing().await;
    let (decision, url) = listed(&apply_without_url(&instance, PHONE, &input).await);

    // The same call again names the same decision; another harness, another client, gets its own.
    let (again, _) = listed(&apply_without_url(&instance, PHONE, &input).await);
    assert_eq!(again, decision);
    let (other, _) = listed(&apply_without_url(&instance, WEB, &input).await);
    assert_ne!(other, decision);

    // The page names the decision the refusal named (A53).
    let (_, page) = instance
        .log_in(&path_of(&url), ScriptedLogin::user("ada").amr(["mfa"]))
        .await;
    assert_eq!(page.status, 200, "{}", page.text);
    assert!(
        page.text.contains(&format!(
            "<dt>Decision</dt><dd><code>{decision}</code></dd>"
        )),
        "{}",
        page.text
    );
    // The person signs in with a passkey on the decision's page and approves.
    let pages = instance.read_and_approve(&path_of(&url)).await;
    assert_eq!(pages.len(), 1);

    // Two identical calls race: exactly one runs, at level `verified`.
    let (first, second) = tokio::join!(
        apply_without_url(&instance, PHONE, &input),
        apply_without_url(&instance, PHONE, &input),
    );
    let ran: Vec<&Value> = [&first, &second]
        .into_iter()
        .filter(|answer| answer["success"] == true)
        .collect();
    assert_eq!(ran.len(), 1, "{first} {second}");
    assert_eq!(ran[0]["data"]["level"], "verified", "{}", ran[0]);
    assert_eq!(ran[0]["data"]["applied"]["affirm"], 1, "{}", ran[0]);
    // The same call again does not run on the spent decision.
    let after = apply_without_url(&instance, PHONE, &input).await;
    assert_eq!(after["success"], false, "{after}");
    assert_ne!(after["error"]["details"]["decision"], decision, "{after}");
    // The other harness's decision is still pending: nothing it decided ran.
    let still = apply_without_url(&instance, WEB, &input).await;
    assert_eq!(still["error"]["details"]["decision"], other, "{still}");
}

#[tokio::test]
async fn a_url_mode_retry_and_a_list_retry_run_one_decision_once() {
    let (instance, input) = listing().await;
    // The decision begins in URL mode, from a client that can open the link.
    let begun = instance
        .call(PHONE, "ideas-review-apply", input.clone(), json!({}))
        .await;
    let prompt = asked(&begun);
    instance.read_and_approve(&path_of(&prompt.url)).await;
    // The same principal retries both ways at once: one runs.
    let (resumed, listed_answer) = tokio::join!(
        instance.call(
            PHONE,
            "ideas-review-apply",
            input.clone(),
            accepted(&prompt.state)
        ),
        apply_without_url(&instance, PHONE, &input),
    );
    let resumed = result(&resumed);
    let ran = [&resumed, &listed_answer]
        .into_iter()
        .filter(|answer| answer["success"] == true)
        .count();
    assert_eq!(ran, 1, "{resumed} {listed_answer}");
    let guide = data(
        &instance
            .call(PHONE, "ideas-guide", json!({}), json!({}))
            .await,
    );
    assert_eq!(guide["pending"]["staged"], 0, "{guide}");
}

#[tokio::test]
async fn a_listed_decision_declined_is_answered_once_and_an_expired_one_never() {
    let (instance, input) = listing().await;
    let (decision, url) = listed(&apply_without_url(&instance, PHONE, &input).await);
    // The person declines on the page.
    let (cookie, page) = instance
        .log_in(&path_of(&url), ScriptedLogin::user("ada").amr(["mfa"]))
        .await;
    assert_eq!(page.status, 200, "{}", page.text);
    let form = format!(
        "login={}&csrf={}&page=1&decision=decline",
        hidden(&page.text, "login").unwrap(),
        hidden(&page.text, "csrf").unwrap(),
    );
    let base = path_of(&url);
    let posted = instance
        .post(base.split('?').next().unwrap(), &cookie, &form)
        .await;
    assert_eq!(posted.status, 200, "{}", posted.text);
    assert!(posted.text.contains("You declined"), "{}", posted.text);
    // Answered once, then a new decision.
    let declined = apply_without_url(&instance, PHONE, &input).await;
    assert_eq!(
        declined["error"]["code"], "CONFIRMATION_DECLINED",
        "{declined}"
    );
    let (fresh, fresh_url) = listed(&apply_without_url(&instance, PHONE, &input).await);
    assert_ne!(fresh, decision);

    // Approved, then expired before the call is sent again: never an answer.
    instance.read_and_approve(&path_of(&fresh_url)).await;
    instance.clock.advance(601_000);
    // The person login's check is kept for its cache's life; check it again, as the server does.
    instance._host.check_person_logins().await;
    let (later, _) = listed(&apply_without_url(&instance, PHONE, &input).await);
    assert_ne!(later, fresh);
    let guide = data(
        &instance
            .call(PHONE, "ideas-guide", json!({}), json!({}))
            .await,
    );
    assert_eq!(guide["pending"]["staged"], 1, "{guide}");
}

#[tokio::test]
async fn with_the_pending_list_a_harness_with_url_elicitation_still_opens_the_link() {
    let (instance, input) = listing().await;
    let begun = instance
        .call(PHONE, "ideas-review-apply", input, json!({}))
        .await;
    asked(&begun);
}
