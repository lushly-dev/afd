//! Mode `gateway` over real sockets (phase 5 step 4): a workspace whose `[auth.gateway]` pins
//! `umbel-testkit-idp`'s gateway signer, served on `127.0.0.1:0` (the loopback channel over plain
//! HTTP, or the pinned channel over TLS with `client_auth = "ca"`), and calls carrying a fresh
//! `Umbel-Gateway-Assertion` each.

use afd::ManualClock;
use serde_json::{Value, json};
use umbel::{Host, HostBuilder};
use umbel_testkit_idp::{TestIdp, TokenBuilder};

use super::hosted::{Client, PUBLIC_URL, Reply, Served, tls_table, write_tls};

/// The assertion's request header.
pub const ASSERTION: &str = "umbel-gateway-assertion";
/// The 401's challenge, whatever the reason (section 4.4).
pub const CHALLENGE: &str = "Umbel-Gateway realm=\"umbel\"";
/// The 401's body.
pub const REFUSAL: &str = r#"{"error":"UNAUTHORIZED","suggestion":"The gateway must connect with its pinned certificate and send a valid Umbel-Gateway-Assertion."}"#;

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

/// Write [`pinned_jwks`] to `<dir>/gateway/jwks.json`.
pub fn write_keys(dir: &std::path::Path, kit: &TestIdp) {
    std::fs::create_dir_all(dir.join("gateway")).unwrap();
    std::fs::write(dir.join("gateway/jwks.json"), pinned_jwks(kit).to_string()).unwrap();
}

/// How a test's gateway connects.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    /// Plain HTTP on the loopback bind, no pin.
    Loopback,
    /// TLS with `client_auth = "ca"` and the kit gateway's certificate pinned.
    Pinned,
}

/// What varies between the tests' `gateway` workspaces.
pub struct Setup<'a> {
    /// The gateway's alias (`edge` by default), so that a test can tell its own log lines apart.
    pub alias: &'a str,
    pub channel: Channel,
    /// Extra `[auth]` keys.
    pub auth: &'a str,
    /// Extra `[auth.gateway]` keys.
    pub gateway: &'a str,
    /// `[auth.gateway] max_scopes`.
    pub ceiling: &'a str,
    /// Appended at the end: spaces, plugins, limits.
    pub rest: &'a str,
}

impl Default for Setup<'_> {
    fn default() -> Self {
        Self {
            alias: "edge",
            channel: Channel::Loopback,
            auth: "",
            gateway: "",
            ceiling: r#"["umbel:read", "umbel:write"]"#,
            rest: "",
        }
    }
}

/// The `umbel.toml` of `setup`: namespace `corp`, the kit's gateway as `edge` mapping into it,
/// its pinned key set at `gateway/jwks.json`, and the default space `main`.
pub fn config(kit: &TestIdp, setup: &Setup<'_>) -> String {
    let (tls, pins) = match setup.channel {
        Channel::Loopback => (String::new(), String::new()),
        Channel::Pinned => (
            tls_table("ca"),
            format!(
                "client_cert_sha256 = [\"{}\"]\n",
                kit.gateway().certificate().sha256_hex()
            ),
        ),
    };
    format!(
        r#"config_version = 5
default_space = "main"

[principal]
local_id = "corp/ada"

[mcp]
first_class_tools = ["fixture-whoami", "fixture-touch", "event-list"]

[http]
public_url = "{PUBLIC_URL}"
allowed_hosts = ["127.0.0.1"]

{tls}

[auth]
mode = "gateway"
{auth}

[auth.namespaces.corp]

[auth.gateway]
alias = "{alias}"
namespace = "corp"
issuer = "{issuer}"
keys = "gateway/jwks.json"
max_scopes = {ceiling}
{pins}{gateway}

[spaces.main]

{rest}
"#,
        auth = setup.auth,
        alias = setup.alias,
        issuer = kit.gateway().issuer(),
        ceiling = setup.ceiling,
        gateway = setup.gateway,
        rest = setup.rest,
    )
}

/// A served `gateway` workspace and a client on its channel.
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
        Self::start_configured(setup, |builder| builder).await
    }

    /// As [`Self::start`], the builder passed through `configure`.
    pub async fn start_configured(
        setup: Setup<'_>,
        configure: impl FnOnce(HostBuilder) -> HostBuilder,
    ) -> Self {
        let kit = TestIdp::start().await.unwrap();
        let dir = super::workspace(&config(&kit, &setup));
        write_keys(dir.path(), &kit);
        if setup.channel == Channel::Pinned {
            write_tls(dir.path(), &kit);
        }
        let clock = afd::fixed_clock(super::oauth::now_ms());
        let host = super::oauth::host_with(dir.path(), &kit, Some(&clock), None, configure);
        let served = Served::start(&host).await;
        let client = match setup.channel {
            Channel::Loopback => Client::plain(served.address),
            Channel::Pinned => Client::tls(
                served.address,
                kit.ca().certificate_pem(),
                Some(kit.gateway().certificate()),
            ),
        };
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

    /// An assertion for a POST to the public URL, issued now on the host's clock for 60 seconds:
    /// subject `ada`, client `gateway-client`, scope `umbel:read umbel:write`.
    pub fn assertion(&self) -> TokenBuilder {
        self.kit
            .gateway()
            .assertion(PUBLIC_URL, "POST")
            .issued_at(self.now_s())
            .lifetime(60)
            .scopes(["umbel:read", "umbel:write"])
    }

    /// Call `tool` with `arguments` as a 2026-07-28 client, sending `assertion` when given and
    /// `headers` besides.
    pub async fn call_with(
        &self,
        assertion: Option<&str>,
        headers: &[(&str, &str)],
        tool: &str,
        arguments: Value,
    ) -> Reply {
        let mut all: Vec<(&str, &str)> = headers.to_vec();
        if let Some(assertion) = assertion {
            all.push((ASSERTION, assertion));
        }
        modern(
            &self.client,
            "tools/call",
            json!({ "name": tool, "arguments": arguments }),
            &all,
        )
        .await
    }

    /// Call `tool` with `arguments`, sending `assertion` when given.
    pub async fn call(&self, assertion: Option<&str>, tool: &str, arguments: Value) -> Reply {
        self.call_with(assertion, &[], tool, arguments).await
    }

    /// The `CommandResult` of a call made with a fresh valid assertion of `builder`.
    pub async fn result(&self, builder: TokenBuilder, tool: &str, arguments: Value) -> Value {
        let reply = self.call(Some(&builder.sign()), tool, arguments).await;
        assert_eq!(reply.status, 200, "{}", reply.text);
        reply.json()["result"]["structuredContent"].clone()
    }

    /// What `fixture-whoami` saw for an assertion of `builder`.
    pub async fn whoami(&self, builder: TokenBuilder) -> Value {
        let result = self.result(builder, "fixture-whoami", json!({})).await;
        assert_eq!(result["success"], json!(true), "{result}");
        result["data"].clone()
    }
}

/// A 2026-07-28 JSON-RPC request to `/mcp` with `headers` added.
pub async fn modern(
    client: &Client,
    method: &str,
    mut params: Value,
    headers: &[(&str, &str)],
) -> Reply {
    params["_meta"] = super::mcp::modern_meta();
    let name = params["name"].as_str().map(str::to_owned);
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let mut all = vec![
        ("content-type", "application/json"),
        ("accept", "application/json, text/event-stream"),
        ("mcp-protocol-version", "2026-07-28"),
        ("mcp-method", method),
    ];
    if let Some(name) = &name {
        all.push(("mcp-name", name));
    }
    all.extend_from_slice(headers);
    client
        .send(client.request("POST", "/mcp", &all, body.to_string()))
        .await
}

/// Whether the reply is section 4.4's one 401, exactly.
pub fn assert_refused(reply: &Reply, label: &str) {
    assert_eq!(reply.status, 401, "{label}: {}", reply.text);
    assert_eq!(
        reply
            .headers
            .get("www-authenticate")
            .and_then(|value| value.to_str().ok()),
        Some(CHALLENGE),
        "{label}"
    );
    assert_eq!(reply.text, REFUSAL, "{label}");
}

/// Whether a logged line records the gateway `alias` refusing with `rule`.
pub fn refused_with(line: &str, alias: &str, rule: &str) -> bool {
    line.contains("refused a gateway request")
        && super::oauth::has_field(line, "rule", rule)
        && super::oauth::has_field(line, "gateway", alias)
}

/// Whether a logged line records the gateway `alias` refusing anything.
pub fn refused_by(line: &str, alias: &str) -> bool {
    line.contains("refused a gateway request") && super::oauth::has_field(line, "gateway", alias)
}
