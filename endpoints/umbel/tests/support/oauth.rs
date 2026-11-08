//! Mode `oauth` with the host's own verifier (phase 5 step 2b): a workspace whose issuers are
//! `umbel-testkit-idp`'s, a host that trusts the kit's CA for its metadata and key fetches, and
//! calls over a real socket with a bearer token.
//!
//! Each test names its token issuer with its own alias, so the rule codes AFD logs (target
//! `afd::auth`, with the alias) can be told apart from other tests' in the same binary.

use std::time::Duration;

use afd::ManualClock;
use serde_json::{Value, json};
use umbel::{Host, HostBuilder};
use umbel_testkit_idp::TestIdp;

use super::hosted::{Client, PUBLIC_URL, Reply, Served};

/// What varies between the tests' `oauth` workspaces.
pub struct Setup<'a> {
    /// The alias of the authorization server's issuer table.
    pub alias: &'a str,
    /// Extra keys of that issuer table (`algorithms`, `delegation`, `services`, ...).
    pub issuer: &'a str,
    /// Extra `[auth]` keys.
    pub auth: &'a str,
    /// Extra `[http]` keys.
    pub http: &'a str,
    /// Appended at the end: spaces, groups, `[http.tls]`, an introspection issuer.
    pub rest: &'a str,
    /// The `[principal]` table's body.
    pub principal: &'a str,
}

impl Default for Setup<'_> {
    fn default() -> Self {
        Self {
            alias: "as",
            issuer: "algorithms = [\"ES256\", \"RS256\"]",
            auth: "",
            http: "",
            rest: "",
            principal: "local_id = \"corp/ada\"",
        }
    }
}

/// The `umbel.toml` of `setup`: namespace `corp` with the kit's identity provider as its
/// login-only person issuer `idp`, and the kit's authorization server as `setup.alias`.
pub fn config(kit: &TestIdp, setup: &Setup<'_>) -> String {
    format!(
        r#"config_version = 5
default_space = "main"

[principal]
{principal}

[mcp]
first_class_tools = ["fixture-whoami", "fixture-touch", "event-list"]

[http]
public_url = "{PUBLIC_URL}"
allowed_hosts = ["127.0.0.1"]
{http}

[auth]
mode = "oauth"
{auth}

[auth.namespaces.corp]
person = {{ issuer = "idp", client_id = "umbel-person-page", client_secret_env = "UMBEL_TEST_PERSON_SECRET", acr_values = ["phr"], uv_amr = ["pin"] }}

[auth.issuers.idp]
issuer = "{idp}"
namespace = "corp"
access_tokens = false

[auth.issuers.{alias}]
issuer = "{issuer}"
namespace = "corp"
{issuer_keys}

[spaces.main]

{rest}
"#,
        principal = setup.principal,
        http = setup.http,
        auth = setup.auth,
        alias = setup.alias,
        idp = kit.identity_provider().issuer(),
        issuer = kit.authorization_server().issuer(),
        issuer_keys = setup.issuer,
        rest = setup.rest,
    )
}

/// The `fixture-whoami` command: what its context carries.
pub fn whoami() -> afd::CommandDefinition {
    super::fixture("fixture-whoami", |_, context| {
        let mut keys: Vec<&String> = context.extra.keys().collect();
        keys.sort();
        afd::success(json!({
            "actor": context.actor,
            "principal": context.extra.get("dev.umbel/principal"),
            "claimGroups": context.extra.get("dev.umbel/claim-groups"),
            "extraKeys": keys,
            "debug": format!("{context:?}"),
            "credentials": context.credentials.as_deref().map(|credentials| serde_json::to_value(credentials).unwrap()),
        }))
    })
}

/// The `fixture-touch` command: a mutation that returns `true`.
pub fn touch() -> afd::CommandDefinition {
    let mut touch = super::fixture("fixture-touch", |_, _| afd::success(json!(true)));
    touch.mutation = true;
    touch
}

/// A host over `dir` trusting the kit's CA, with `fixture-whoami` and `fixture-touch`, on
/// `clock` for token times and caches when given, with `timeout` for its fetches when given.
pub fn host(
    dir: &std::path::Path,
    kit: &TestIdp,
    clock: Option<&ManualClock>,
    timeout: Option<Duration>,
) -> Host {
    let mut builder = HostBuilder::open(dir)
        .unwrap()
        .with_auth_root_certificate(kit.ca().certificate_pem().as_bytes().to_vec())
        .with_unfinished_oauth()
        .register(whoami())
        .register(touch());
    if let Some(clock) = clock {
        builder = builder.with_auth_clock(clock.clone());
    }
    if let Some(timeout) = timeout {
        builder = builder.with_auth_fetch_timeout(timeout);
    }
    builder.seal().unwrap()
}

/// A served `oauth` workspace and a plain HTTP client of it.
pub struct Running {
    pub kit: TestIdp,
    pub dir: tempfile::TempDir,
    pub host: Host,
    pub served: Served,
    pub client: Client,
    pub clock: ManualClock,
}

impl Running {
    /// Start a kit, write `setup`'s workspace and serve it on a clock set to now.
    pub async fn start(setup: Setup<'_>) -> Self {
        Self::start_with(setup, None).await
    }

    /// As [`Self::start`], with `timeout` for the host's fetches.
    pub async fn start_with(setup: Setup<'_>, timeout: Option<Duration>) -> Self {
        let kit = TestIdp::start().await.unwrap();
        Self::serve(kit, &setup, timeout).await
    }

    /// Serve `setup`'s workspace over the running `kit`.
    pub async fn serve(kit: TestIdp, setup: &Setup<'_>, timeout: Option<Duration>) -> Self {
        let dir = super::workspace(&config(&kit, setup));
        let clock = afd::fixed_clock(now_ms());
        let host = host(dir.path(), &kit, Some(&clock), timeout);
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

    /// The host clock's time, in whole seconds.
    pub fn now_s(&self) -> i64 {
        afd::Clock::now(&self.clock).div_euclid(1000)
    }

    /// An access token of the authorization server for the public URL, issued now on the host's
    /// clock: subject `ada`, client `test-client`, scope `umbel:read umbel:write`.
    pub fn token(&self) -> umbel_testkit_idp::TokenBuilder {
        self.kit
            .authorization_server()
            .access_token(PUBLIC_URL)
            .issued_at(self.now_s())
            .lifetime(300)
            .subject("ada")
            .scopes(["umbel:read", "umbel:write"])
    }

    /// Call `tool` with `arguments` as a 2026-07-28 client sending `token`.
    pub async fn call(&self, token: Option<&str>, tool: &str, arguments: Value) -> Reply {
        modern(
            &self.client,
            "tools/call",
            json!({ "name": tool, "arguments": arguments }),
            token,
        )
        .await
    }

    /// The `CommandResult` of a call that reached the server.
    pub async fn result(&self, token: &str, tool: &str, arguments: Value) -> Value {
        let reply = self.call(Some(token), tool, arguments).await;
        assert_eq!(reply.status, 200, "{}", reply.text);
        reply.json()["result"]["structuredContent"].clone()
    }

    /// What `fixture-whoami` saw for `token`.
    pub async fn whoami(&self, token: &str) -> Value {
        let result = self.result(token, "fixture-whoami", json!({})).await;
        assert_eq!(result["success"], json!(true), "{result}");
        result["data"].clone()
    }
}

/// Milliseconds since the epoch on the system clock.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// A 2026-07-28 JSON-RPC request to `/mcp`, with a bearer token when given.
pub async fn modern(
    client: &Client,
    method: &str,
    mut params: Value,
    token: Option<&str>,
) -> Reply {
    params["_meta"] = super::mcp::modern_meta();
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

/// Whether a logged line records AFD refusing a token of `alias` with `rule`.
pub fn refused_with(line: &str, alias: &str, rule: &str) -> bool {
    line.contains("refused a request's bearer token")
        && has_field(line, "rule", rule)
        && has_field(line, "issuer", alias)
}

/// Whether a logged line has the field `name` with exactly `value`, quoted or not.
pub fn has_field(line: &str, name: &str, value: &str) -> bool {
    line.split_whitespace()
        .any(|word| word == format!("{name}={value}") || word == format!("{name}=\"{value}\""))
}
