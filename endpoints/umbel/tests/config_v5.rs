//! `umbel.toml`, configuration version 5 (phase 5 specification, section 2.2; D107): `[auth]` with
//! its namespaces, person logins, issuers and gateway, `[http.tls]` and `http.public_url`,
//! `[limits]`, `[usage]`, `[principal.equivalents]`, group claims and the `memory_write` table's
//! editors and erasers (sections 8.3 and 8.4), every rule section 2.2 checks at open, versions 1
//! to 4 read as version 5 with `auth.mode = "none"`, and the bare HTTP router refusing a hosted
//! configuration, which only the listener serves (step 2a; `auth_layers.rs` holds the listener).
//! Parsing only here: nothing verifies a token, maps a caller or limits a request.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::fs;
use std::path::PathBuf;

use umbel::doctor::{self, CheckStatus};
use umbel::workspace::{
    AuthMode, ClientAuth, Delegation, Overrides, TokenCheck, Workspace, WorkspaceError,
};

fn workspace_with(text: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("ws");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("umbel.toml"), text).unwrap();
    (dir, root)
}

fn open(text: &str) -> Result<Workspace, WorkspaceError> {
    let (_dir, root) = workspace_with(text);
    Workspace::open(&root)
}

fn open_with(text: &str, overrides: &Overrides) -> Result<Workspace, WorkspaceError> {
    let (_dir, root) = workspace_with(text);
    Workspace::open_located(
        &umbel::workspace::Located {
            root,
            found_by: umbel::workspace::FoundBy::Flag,
        },
        overrides,
    )
}

#[track_caller]
fn invalid(text: &str, key: &str) -> WorkspaceError {
    let error = open(text).expect_err(text);
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{text}: {error}");
    assert!(
        error.message().contains(key),
        "{text}: {error} does not name {key}"
    );
    assert!(!error.suggestion().is_empty());
    error
}

const PERSON: &str = "person = { issuer = \"corp-idp\", client_id = \"umbel-person-page\", client_secret_env = \"UMBEL_PERSON_SECRET\", acr_values = [\"phr\"], uv_amr = [\"pin\", \"fpt\"] }";

/// An `oauth` workspace on a loopback bind, with one namespace, its person login and one issuer;
/// `body` is appended.
fn oauth(body: &str) -> String {
    // The issuer serves the person login, so it says whether it issues tokens too; a body that
    // sets `access_tokens` itself replaces the default `true`.
    let tokens = if body.contains("access_tokens") {
        ""
    } else {
        "access_tokens = true\n"
    };
    format!(
        "config_version = 5\n\n[principal]\nlocal_id = \"corp/U019488227\"\n\n[http]\nbind = \"127.0.0.1:8443\"\npublic_url = \"https://umbel.example.com/mcp\"\nallowed_hosts = [\"umbel.example.com\"]\n\n[auth]\nmode = \"oauth\"\n\n[auth.namespaces.corp]\n{PERSON}\n\n[auth.issuers.corp-idp]\nissuer = \"https://idp.example.com\"\n{tokens}namespace = \"corp\"\n{body}"
    )
}

/// A `gateway` workspace, `bind` and `tls` given, its gateway table followed by `gateway`.
fn gateway(bind: &str, tls: &str, gateway: &str) -> String {
    format!(
        "config_version = 5\n\n[principal]\nlocal_id = \"corp/U019488227\"\n\n[http]\nbind = \"{bind}\"\npublic_url = \"https://umbel.example.com/mcp\"\nallowed_hosts = [\"umbel.example.com\"]\n{tls}\n\n[auth]\nmode = \"gateway\"\n\n[auth.namespaces.corp]\n\n[auth.gateway]\nalias = \"edge\"\nnamespace = \"corp\"\nissuer = \"https://gateway.example.com\"\nkeys = \"secrets/gateway/jwks.json\"\nmax_scopes = [\"umbel:read\", \"umbel:write:main\"]\n{gateway}"
    )
}

const TLS_CA: &str = "\n[http.tls]\ncert = \"secrets/tls/cert.pem\"\nkey = \"secrets/tls/key.pem\"\nclient_auth = \"ca\"\nclient_ca = \"secrets/tls/ca.pem\"\n";
const PIN: &str =
    "client_cert_sha256 = [\"9f2c1b7e3a5d4c6b8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f\"]\n";

// ── Versions ───────────────────────────────────────────────────────────────────────────────────

#[test]
fn versions_1_to_4_read_as_version_5_with_auth_mode_none() {
    for version in 1..=4 {
        let workspace = open(&format!("config_version = {version}\n[spaces.main]\n")).unwrap();
        let config = workspace.config();
        assert_eq!(config.version, version);
        assert_eq!(config.auth.mode, AuthMode::None);
        assert!(config.auth.namespaces.is_empty() && config.auth.issuers.is_empty());
        assert_eq!(config.auth.gateway, None);
        assert_eq!(config.http.public_url, None);
        assert_eq!(config.http.tls, None);
        assert!(config.principal.equivalents.is_empty());
        assert_eq!(config.limits, umbel::workspace::RateLimits::default());
        assert_eq!(config.usage, umbel::workspace::UsageConfig::default());
    }
    // Versions 6 (the records host specification) and 7 (the Ideas host-review specification)
    // are read beside them and tested in `config_v6.rs` and `config_v7.rs`.
    assert_eq!(umbel::CONFIG_VERSION, 7);
    assert_eq!(umbel::CONFIG_VERSIONS, [1, 2, 3, 4, 5, 6, 7]);
}

#[test]
fn version_5_keys_are_refused_in_versions_1_to_4() {
    for version in 1..=4 {
        for (body, key) in [
            ("[auth]\nmode = \"none\"\n", "`auth`"),
            ("[limits]\ncalls_per_minute = 5\n", "`limits`"),
            ("[usage]\nenabled = false\n", "`usage`"),
            (
                "[principal.equivalents]\n\"human:ada\" = \"human:corp/U1\"\n",
                "principal.equivalents",
            ),
            (
                "[http]\npublic_url = \"https://umbel.example.com/mcp\"\n",
                "http.public_url",
            ),
            (
                "[http.tls]\ncert = \"c.pem\"\nkey = \"k.pem\"\n",
                "http.tls",
            ),
        ] {
            let error = invalid(&format!("config_version = {version}\n{body}"), key);
            assert!(
                error.message().contains("needs config_version = 5"),
                "{version}: {error}"
            );
        }
        // A non-loopback bind stays refused, naming what it needs.
        let error = invalid(
            &format!("config_version = {version}\n[http]\nbind = \"0.0.0.0:7410\"\n"),
            "http.bind",
        );
        assert!(error.message().contains("config_version = 5"), "{error}");
    }
    for version in 3..=4 {
        let error = invalid(
            &format!(
                "config_version = {version}\n[access.groups.eng]\nmembers = []\nclaim = {{ issuer = \"a\", name = \"groups\", value = \"eng\" }}\n"
            ),
            "access.groups.eng.claim",
        );
        assert!(
            error.message().contains("needs config_version = 5"),
            "{error}"
        );
    }
    let memory = "config_version = 4\n[plugins]\nenabled = [\"memory\"]\n[plugins.memory]\nsource = \"compiled:memory\"\n[plugins.memory.grants.memory_write]\nallow = [\"main\"]\n";
    for key in [
        "editors = [\"space\"]",
        "erasers = [\"group:x\"]",
        "erase_approvals = 2",
        "erase_approval_window_s = 600",
    ] {
        let error = invalid(&format!("{memory}{key}\n"), key.split(' ').next().unwrap());
        assert!(
            error.message().contains("needs config_version = 5"),
            "{error}"
        );
    }
}

#[test]
fn a_refusal_names_its_key_in_details() {
    let error = invalid(
        &oauth("").replace("mode = \"oauth\"", "mode = \"jwt\""),
        "auth.mode",
    );
    assert_eq!(error.key(), Some("auth.mode"));
    let details = error.to_command_error().details.unwrap();
    assert_eq!(details["key"], "auth.mode");
    assert!(!error.retryable());
}

#[test]
fn another_version_is_unsupported_and_names_1_to_7() {
    for version in [0, 8] {
        let error = open(&format!("config_version = {version}\n")).unwrap_err();
        assert_eq!(error.code(), "WORKSPACE_CONFIG_UNSUPPORTED");
        assert!(error.message().contains("1 to 7"), "{error}");
    }
}

// ── Defaults and the typed configuration ───────────────────────────────────────────────────────

#[test]
fn a_bare_version_5_file_is_mode_none_with_every_default() {
    let workspace = open("config_version = 5\n").unwrap();
    let config = workspace.config();
    let auth = &config.auth;
    assert_eq!(auth.mode, AuthMode::None);
    assert_eq!(auth.mode.as_str(), "none");
    assert!(!auth.mode.is_hosted());
    assert_eq!(auth.scope_prefix, "umbel");
    assert!(auth.filter_tools_by_scope);
    assert_eq!(auth.clock_skew_s, 60);
    assert_eq!(auth.max_token_lifetime_s, 3600);
    assert!(!auth.require_bound_tokens);
    let limits = config.limits;
    assert_eq!(
        (
            limits.ip_requests_per_minute,
            limits.calls_per_minute,
            limits.read_bytes_per_minute,
            limits.person_pages_per_hour
        ),
        (1200, 600, 67_108_864, 30)
    );
    assert!(config.usage.enabled && config.usage.readers.is_empty());
    assert_eq!(config.usage.retention_days, 400);
    assert_eq!(config.principal.local_id, "local");
    // Mode none behaves as version 4: a loopback bind, the HTTP surface as before.
    assert!(config.http.bind.ip().is_loopback());
}

#[test]
fn the_oauth_tables_land_in_typed_configuration() {
    let workspace = open(&oauth(
        "subject_claim = \"oid\"\nverify = \"jwt\"\nalgorithms = [\"PS256\", \"EdDSA\"]\ndelegation = \"act\"\nservices = { clients = [\"build-bot\"], claim = { name = \"idtyp\", value = \"app\" } }\n\n[auth.issuers.corp-as]\nissuer = \"https://as.example.com/tenant\"\nnamespace = \"corp\"\nverify = \"introspection\"\nintrospection = { client_id = \"umbel\", client_secret_env = \"UMBEL_INTROSPECTION\" }\n",
    ))
    .unwrap();
    let config = workspace.config();
    let auth = &config.auth;
    assert_eq!(auth.mode, AuthMode::Oauth);
    assert!(auth.mode.is_hosted());
    assert_eq!(
        config.http.public_url.as_deref(),
        Some("https://umbel.example.com/mcp")
    );
    let corp = &auth.namespaces[0];
    assert_eq!(corp.id, "corp");
    let person = corp.person.as_ref().unwrap();
    assert_eq!(person.issuer, "corp-idp");
    assert_eq!(person.client_id, "umbel-person-page");
    assert_eq!(person.client_secret_env, "UMBEL_PERSON_SECRET");
    assert_eq!(person.subject_claim, "sub");
    assert_eq!(person.max_age_s, 300);
    assert_eq!(person.acr_values, ["phr"]);
    assert_eq!(person.uv_amr, ["pin", "fpt"]);
    let idp = auth.issuer("corp-idp").unwrap();
    assert_eq!(idp.issuer, "https://idp.example.com");
    assert_eq!(idp.namespace, "corp");
    assert_eq!(idp.subject_claim, "oid");
    assert_eq!(idp.verify, TokenCheck::Jwt);
    assert_eq!(idp.algorithms, ["PS256", "EdDSA"]);
    assert_eq!(idp.delegation, Delegation::Act);
    let services = idp.services.as_ref().unwrap();
    assert_eq!(services.clients, ["build-bot"]);
    let claim = services.claim.as_ref().unwrap();
    assert_eq!(
        (claim.name.as_str(), claim.value.as_str()),
        ("idtyp", "app")
    );
    assert!(idp.access_tokens);
    assert_eq!(idp.introspection, None);
    let corp_as = auth.issuer("corp-as").unwrap();
    assert_eq!(corp_as.verify, TokenCheck::Introspection);
    let client = corp_as.introspection.as_ref().unwrap();
    assert_eq!(
        (client.client_id.as_str(), client.client_secret_env.as_str()),
        ("umbel", "UMBEL_INTROSPECTION")
    );
    // An issuer's defaults: sub, jwt, RS256, no delegation, no services.
    assert_eq!(corp_as.subject_claim, "sub");
    assert_eq!(corp_as.algorithms, ["RS256"]);
    assert_eq!(corp_as.delegation, Delegation::None);
    assert!(corp_as.services.is_none());
    assert!(auth.produces("human:corp/U019488227"));
    assert!(auth.produces("service:corp/build-bot"));
    assert!(!auth.produces("script:corp/x") && !auth.produces("human:other/x"));
}

// ── Binding, TLS and the public URL ────────────────────────────────────────────────────────────

#[test]
fn a_non_loopback_bind_needs_a_hosted_mode_and_tls() {
    let tls = "\n[http.tls]\ncert = \"secrets/tls/cert.pem\"\nkey = \"secrets/tls/key.pem\"\n";
    // Mode none: refused with or without TLS.
    invalid(
        "config_version = 5\n[http]\nbind = \"0.0.0.0:8443\"\n",
        "http.bind",
    );
    invalid(
        &format!("config_version = 5\n[http]\nbind = \"0.0.0.0:8443\"\n{tls}"),
        "http.bind",
    );
    // Hosted without TLS: refused, naming what it needs.
    let plain = oauth("").replace("127.0.0.1:8443", "0.0.0.0:8443");
    let error = invalid(&plain, "http.bind");
    assert!(error.message().contains("[http.tls]"), "{error}");
    // Hosted with TLS: opens, IPv6 included.
    let hosted = oauth(tls).replace("127.0.0.1:8443", "0.0.0.0:8443");
    let workspace = open(&hosted).unwrap();
    let parsed = workspace.config().http.tls.clone().unwrap();
    assert_eq!(parsed.cert, "secrets/tls/cert.pem");
    assert_eq!(parsed.key, "secrets/tls/key.pem");
    assert_eq!(parsed.client_auth, ClientAuth::None);
    assert_eq!(parsed.client_ca, None);
    open(&oauth(tls).replace("127.0.0.1:8443", "[::]:8443")).unwrap();
}

#[test]
fn a_bind_override_follows_the_same_rule() {
    let wide = Overrides {
        http_bind: Some("0.0.0.0:9443".into()),
        log_filter: None,
        http_person_bind: None,
    };
    // Not hosted, or hosted without TLS: still loopback only.
    for text in ["config_version = 5\n".to_owned(), oauth("")] {
        let error = open_with(&text, &wide).unwrap_err();
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
        assert!(error.message().contains("UMBEL_HTTP_BIND"), "{error}");
    }
    let tls = "\n[http.tls]\ncert = \"c.pem\"\nkey = \"k.pem\"\n";
    let workspace = open_with(&oauth(tls), &wide).unwrap();
    assert_eq!(workspace.config().http.bind.to_string(), "0.0.0.0:9443");
    // A gateway on loopback needs no pinned certificate; moved off it by an override, it does.
    let loopback = gateway("127.0.0.1:8443", "", "");
    open(&loopback).unwrap();
    let tls_any = "\n[http.tls]\ncert = \"c.pem\"\nkey = \"k.pem\"\nclient_auth = \"any\"\n";
    let error = open_with(&gateway("127.0.0.1:8443", tls_any, ""), &wide).unwrap_err();
    assert!(error.message().contains("http.tls.client_auth"), "{error}");
}

#[test]
fn tls_needs_its_files_and_a_ca_exactly_for_client_auth_ca() {
    let with = |tls: &str| oauth(&format!("\n[http.tls]\n{tls}"));
    open(&with(
        "cert = \"c.pem\"\nkey = \"/etc/umbel/k.pem\"\nclient_auth = \"any\"",
    ))
    .unwrap();
    let ca = open(&with(
        "cert = \"c.pem\"\nkey = \"k.pem\"\nclient_auth = \"ca\"\nclient_ca = \"ca.pem\"",
    ))
    .unwrap();
    let tls = ca.config().http.tls.clone().unwrap();
    assert_eq!(tls.client_auth, ClientAuth::Ca);
    assert_eq!(tls.client_ca.as_deref(), Some("ca.pem"));
    for (tls, key) in [
        ("key = \"k.pem\"", "http.tls.cert"),
        ("cert = \"c.pem\"", "http.tls.key"),
        (
            "cert = \"c.pem\"\nkey = \"k.pem\"\nclient_auth = \"ca\"",
            "http.tls.client_ca",
        ),
        (
            "cert = \"c.pem\"\nkey = \"k.pem\"\nclient_ca = \"ca.pem\"",
            "http.tls.client_ca",
        ),
        (
            "cert = \"c.pem\"\nkey = \"k.pem\"\nclient_auth = \"all\"",
            "http.tls.client_auth",
        ),
        ("cert = \"c.pem\"\nkey = \"../k.pem\"", "http.tls.key"),
        (
            "cert = \"state/keys/c.pem\"\nkey = \"k.pem\"",
            "http.tls.cert",
        ),
        ("cert = \"\"\nkey = \"k.pem\"", "http.tls.cert"),
        (
            "cert = \"c.pem\"\nkey = \"k.pem\"\npassword = \"x\"",
            "http.tls.password",
        ),
    ] {
        invalid(&with(tls), key);
    }
}

#[test]
fn the_public_url_is_required_when_hosted_and_names_this_endpoint() {
    invalid(
        &oauth("").replace("public_url = \"https://umbel.example.com/mcp\"\n", ""),
        "http.public_url",
    );
    for url in [
        "http://umbel.example.com/mcp",
        "https://umbel.example.com/mcp?x=1",
        "https://umbel.example.com/mcp#a",
        "https://ada@umbel.example.com/mcp",
        "https://Umbel.example.com/mcp",
        "https://umbel.example.com/other",
        "https://umbel.example.com/mcp/",
        "https://elsewhere.example.com/mcp",
        "umbel.example.com/mcp",
    ] {
        invalid(
            &oauth("").replace("https://umbel.example.com/mcp", url),
            "http.public_url",
        );
    }
    // A port must be one the allowed host admits; an entry without a port admits any.
    let ported = oauth("").replace(
        "https://umbel.example.com/mcp",
        "https://umbel.example.com:8443/mcp",
    );
    open(&ported).unwrap();
    invalid(
        &ported.replace(
            "allowed_hosts = [\"umbel.example.com\"]",
            "allowed_hosts = [\"umbel.example.com:9443\"]",
        ),
        "http.public_url",
    );
    // With path = "/v1/mcp" the URL's path follows it.
    let moved = oauth("")
        .replace(
            "https://umbel.example.com/mcp",
            "https://umbel.example.com/v1/mcp",
        )
        .replace("[http]\n", "[http]\npath = \"/v1/mcp\"\n");
    open(&moved).unwrap();
    // In mode none the key is optional and still checked when set.
    open("config_version = 5\n[http]\npublic_url = \"https://h.test/mcp\"\nallowed_hosts = [\"h.test\"]\n").unwrap();
    invalid(
        "config_version = 5\n[http]\npublic_url = \"https://h.test/mcp\"\n",
        "http.public_url",
    );
}

// ── [auth] ─────────────────────────────────────────────────────────────────────────────────────

#[test]
fn the_auth_table_refuses_what_it_does_not_define() {
    for (from, to, key) in [
        ("mode = \"oauth\"", "mode = \"jwt\"", "auth.mode"),
        (
            "mode = \"oauth\"",
            "mode = \"oauth\"\nscope_prefix = \"Umbel\"",
            "auth.scope_prefix",
        ),
        (
            "mode = \"oauth\"",
            "mode = \"oauth\"\nscope_prefix = \"um:bel\"",
            "auth.scope_prefix",
        ),
        (
            "mode = \"oauth\"",
            "mode = \"oauth\"\nclock_skew_s = 301",
            "auth.clock_skew_s",
        ),
        (
            "mode = \"oauth\"",
            "mode = \"oauth\"\nclock_skew_s = -1",
            "auth.clock_skew_s",
        ),
        (
            "mode = \"oauth\"",
            "mode = \"oauth\"\nmax_token_lifetime_s = 0",
            "auth.max_token_lifetime_s",
        ),
        (
            "mode = \"oauth\"",
            "mode = \"oauth\"\nmax_token_lifetime_s = 86401",
            "auth.max_token_lifetime_s",
        ),
        (
            "mode = \"oauth\"",
            "mode = \"oauth\"\nfilter_tools_by_scope = \"yes\"",
            "auth.filter_tools_by_scope",
        ),
        (
            "mode = \"oauth\"",
            "mode = \"oauth\"\ntenant = \"t\"",
            "auth.tenant",
        ),
        (
            "[auth.namespaces.corp]",
            "[auth.namespaces.Corp]",
            "auth.namespaces.Corp",
        ),
        (
            "[auth.namespaces.corp]",
            "[auth.namespaces.corp]\nissuer = \"x\"",
            "auth.namespaces.corp.issuer",
        ),
    ] {
        invalid(&oauth("").replacen(from, to, 1), key);
    }
    let edge = open(&oauth("").replacen(
        "mode = \"oauth\"",
        "mode = \"oauth\"\nscope_prefix = \"corp.umbel\"\nclock_skew_s = 0\nmax_token_lifetime_s = 86400\nfilter_tools_by_scope = false",
        1,
    ))
    .unwrap();
    let auth = &edge.config().auth;
    assert_eq!(auth.scope_prefix, "corp.umbel");
    assert_eq!((auth.clock_skew_s, auth.max_token_lifetime_s), (0, 86_400));
    assert!(!auth.filter_tools_by_scope);
}

#[test]
fn oauth_needs_an_issuer_whose_tokens_are_accepted() {
    let none = "config_version = 5\n[principal]\nlocal_id = \"corp/U1\"\n[http]\npublic_url = \"https://h.test/mcp\"\nallowed_hosts = [\"h.test\"]\n[auth]\nmode = \"oauth\"\n[auth.namespaces.corp]\n";
    invalid(none, "auth.issuers");
    // An issuer that only serves the person login does not count.
    let login_only = oauth("access_tokens = false\n");
    invalid(&login_only, "auth.issuers");
    let both = oauth(
        "access_tokens = false\n\n[auth.issuers.corp-as]\nissuer = \"https://as.example.com\"\nnamespace = \"corp\"\n",
    );
    let workspace = open(&both).unwrap();
    assert!(
        !workspace
            .config()
            .auth
            .issuer("corp-idp")
            .unwrap()
            .access_tokens
    );
    // An issuer serving a person login says whether its tokens are accepted: never by omission.
    let error = invalid(
        &oauth("").replace("access_tokens = true\n", ""),
        "auth.issuers.corp-idp.access_tokens",
    );
    assert!(error.message().contains("person login"), "{error}");
    // An issuer serving no login defaults to accepting its tokens.
    let plain = open(&oauth(
        "\n[auth.issuers.corp-as]\nissuer = \"https://as.example.com\"\nnamespace = \"corp\"\n",
    ))
    .unwrap();
    assert!(plain.config().auth.issuer("corp-as").unwrap().access_tokens);
    // A login-only issuer must serve a login, and cannot be introspected.
    invalid(
        &both.replace(
            "issuer = \"https://as.example.com\"\nnamespace = \"corp\"\n",
            "issuer = \"https://as.example.com\"\nnamespace = \"corp\"\naccess_tokens = false\n",
        ),
        "auth.issuers.corp-as.access_tokens",
    );
}

#[test]
fn issuers_name_a_namespace_an_exact_https_iss_and_their_checks() {
    let issuer = |body: &str| {
        oauth(&format!(
            "\n[auth.issuers.extra]\nissuer = \"https://extra.example.com\"\nnamespace = \"corp\"\n{body}"
        ))
    };
    for (text, key) in [
        (
            issuer("").replace("namespace = \"corp\"\n\n", "namespace = \"nowhere\"\n\n"),
            "auth.issuers.corp-idp.namespace",
        ),
        (
            oauth("").replace("namespace = \"corp\"", "namespace = \"other\""),
            "auth.issuers.corp-idp.namespace",
        ),
        (
            oauth("").replace("namespace = \"corp\"", ""),
            "auth.issuers.corp-idp.namespace",
        ),
        (
            oauth("").replace("issuer = \"https://idp.example.com\"\n", ""),
            "auth.issuers.corp-idp.issuer",
        ),
        (
            oauth("").replace("https://idp.example.com", "http://idp.example.com"),
            "auth.issuers.corp-idp.issuer",
        ),
        (
            oauth("").replace("https://idp.example.com", "https://idp.example.com/?a=1"),
            "auth.issuers.corp-idp.issuer",
        ),
        (
            oauth("").replace("https://idp.example.com", "https://u@idp.example.com"),
            "auth.issuers.corp-idp.issuer",
        ),
        (
            oauth("").replace("[auth.issuers.corp-idp]", "[auth.issuers.Corp_IdP]"),
            "auth.issuers.Corp_IdP",
        ),
        (
            issuer("").replace("https://extra.example.com", "https://idp.example.com"),
            "auth.issuers.extra.issuer",
        ),
        (issuer("verify = \"opaque\"\n"), "auth.issuers.extra.verify"),
        (issuer("algorithms = []\n"), "auth.issuers.extra.algorithms"),
        (
            issuer("algorithms = [\"none\"]\n"),
            "auth.issuers.extra.algorithms",
        ),
        (
            issuer("algorithms = [\"HS256\"]\n"),
            "auth.issuers.extra.algorithms",
        ),
        (
            issuer("algorithms = [\"ES512\"]\n"),
            "auth.issuers.extra.algorithms",
        ),
        (
            issuer("algorithms = [\"RS256\", \"RS256\"]\n"),
            "auth.issuers.extra.algorithms",
        ),
        (
            issuer("delegation = \"chain\"\n"),
            "auth.issuers.extra.delegation",
        ),
        (
            issuer("subject_claim = \"email\"\n"),
            "auth.issuers.extra.subject_claim",
        ),
        (
            issuer("subject_claim = \"preferred_username\"\n"),
            "auth.issuers.extra.subject_claim",
        ),
        (
            issuer("subject_claim = \"aud\"\n"),
            "auth.issuers.extra.subject_claim",
        ),
        (
            issuer("subject_claim = \"\"\n"),
            "auth.issuers.extra.subject_claim",
        ),
        (issuer("services = {}\n"), "auth.issuers.extra.services"),
        (
            issuer("services = { clients = [] }\n"),
            "auth.issuers.extra.services.clients",
        ),
        (
            issuer("services = { clients = [\"a\", \"a\"] }\n"),
            "auth.issuers.extra.services.clients",
        ),
        (
            issuer("services = { clients = [\"a b\"] }\n"),
            "auth.issuers.extra.services.clients",
        ),
        (
            issuer("services = { claim = { name = \"idtyp\" } }\n"),
            "auth.issuers.extra.services.claim.value",
        ),
        (
            issuer("services = { roles = [\"app\"] }\n"),
            "auth.issuers.extra.services.roles",
        ),
        (
            issuer("introspection = { client_id = \"u\", client_secret_env = \"S\" }\n"),
            "auth.issuers.extra.introspection",
        ),
        (
            issuer("verify = \"introspection\"\n"),
            "auth.issuers.extra.introspection",
        ),
        (
            issuer("verify = \"introspection\"\nintrospection = { client_id = \"u\" }\n"),
            "auth.issuers.extra.introspection.client_secret_env",
        ),
        (
            issuer(
                "verify = \"introspection\"\nintrospection = { client_id = \"u\", client_secret_env = \"s3cr3t value\" }\n",
            ),
            "auth.issuers.extra.introspection.client_secret_env",
        ),
        (
            issuer(
                "verify = \"introspection\"\nintrospection = { client_id = \"u\", client_secret_env = \"S\" }\naccess_tokens = false\n",
            ),
            "auth.issuers.extra.access_tokens",
        ),
        (issuer("audience = \"x\"\n"), "auth.issuers.extra.audience"),
    ] {
        invalid(&text, key);
    }
    // At most one issuer is introspected.
    let introspected = |alias: &str, url: &str| {
        format!(
            "\n[auth.issuers.{alias}]\nissuer = \"{url}\"\nnamespace = \"corp\"\nverify = \"introspection\"\nintrospection = {{ client_id = \"u\", client_secret_env = \"S\" }}\n"
        )
    };
    open(&oauth(&introspected("one", "https://one.example.com"))).unwrap();
    let error = invalid(
        &oauth(&format!(
            "{}{}",
            introspected("one", "https://one.example.com"),
            introspected("two", "https://two.example.com")
        )),
        "auth.issuers.two.verify",
    );
    assert!(error.message().contains("at most one"), "{error}");
    // Every algorithm the verifier checks may be listed.
    let all = "algorithms = [\"RS256\", \"RS384\", \"RS512\", \"PS256\", \"PS384\", \"PS512\", \"ES256\", \"ES384\", \"EdDSA\"]\n";
    let workspace = open(&issuer(all)).unwrap();
    assert_eq!(
        workspace
            .config()
            .auth
            .issuer("extra")
            .unwrap()
            .algorithms
            .len(),
        9
    );
    assert_eq!(umbel::auth::SIGNING_ALGORITHMS.len(), 9);
}

#[test]
fn an_issuers_ca_file_follows_the_file_path_rules() {
    // Amendment from step 2c: the roots trusted for one issuer, a file under 2.2's path rules.
    let issuer = |text: &str| {
        open(text)
            .unwrap()
            .config()
            .auth
            .issuer("corp-idp")
            .unwrap()
            .ca_file
            .clone()
    };
    assert_eq!(issuer(&oauth("")), None);
    assert_eq!(
        issuer(&oauth("ca_file = \"trust/idp.pem\"\n")).as_deref(),
        Some("trust/idp.pem")
    );
    assert_eq!(
        issuer(&oauth("ca_file = \"/etc/umbel/idp-roots.pem\"\n")).as_deref(),
        Some("/etc/umbel/idp-roots.pem")
    );
    for bad in [
        "\"\"",
        "\"../roots.pem\"",
        "\"trust/../../roots.pem\"",
        "\"state/roots.pem\"",
        "\"./state/keys/roots.pem\"",
        "\"trust\\\\roots.pem\"",
        "1",
    ] {
        invalid(
            &oauth(&format!("ca_file = {bad}\n")),
            "auth.issuers.corp-idp.ca_file",
        );
    }
}

#[test]
fn a_person_login_requires_user_verification() {
    let login = |person: &str| oauth("").replace(PERSON, person);
    for (person, key) in [
        // acr_values and uv_amr are required and never empty (owner decision 6).
        (
            "person = { issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", uv_amr = [\"pin\"] }",
            "person.acr_values",
        ),
        (
            "person = { issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", acr_values = [], uv_amr = [\"pin\"] }",
            "person.acr_values",
        ),
        (
            "person = { issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", acr_values = [\"phr\"] }",
            "person.uv_amr",
        ),
        (
            "person = { issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", acr_values = [\"phr\"], uv_amr = [] }",
            "person.uv_amr",
        ),
        // uv_amr names only RFC 8176's user-verification methods.
        (
            "person = { issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", acr_values = [\"phr\"], uv_amr = [\"pwd\"] }",
            "person.uv_amr",
        ),
        (
            "person = { issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", acr_values = [\"phr\"], uv_amr = [\"otp\"] }",
            "person.uv_amr",
        ),
        (
            "person = { issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", acr_values = [\"phr\"], uv_amr = [\"hwk\"] }",
            "person.uv_amr",
        ),
        (
            "person = { issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", acr_values = [\"phr\"], uv_amr = [\"pin\", \"pin\"] }",
            "person.uv_amr",
        ),
        (
            "person = { issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", acr_values = [\"a b\"], uv_amr = [\"pin\"] }",
            "person.acr_values",
        ),
        // The rest of the login.
        (
            "person = { client_id = \"p\", client_secret_env = \"S\", acr_values = [\"phr\"], uv_amr = [\"pin\"] }",
            "person.issuer",
        ),
        (
            "person = { issuer = \"nowhere\", client_id = \"p\", client_secret_env = \"S\", acr_values = [\"phr\"], uv_amr = [\"pin\"] }",
            "person.issuer",
        ),
        (
            "person = { issuer = \"corp-idp\", client_secret_env = \"S\", acr_values = [\"phr\"], uv_amr = [\"pin\"] }",
            "person.client_id",
        ),
        (
            "person = { issuer = \"corp-idp\", client_id = \"p\", acr_values = [\"phr\"], uv_amr = [\"pin\"] }",
            "person.client_secret_env",
        ),
        (
            "person = { issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"hunter2!\", acr_values = [\"phr\"], uv_amr = [\"pin\"] }",
            "person.client_secret_env",
        ),
        (
            "person = { issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", subject_claim = \"email\", acr_values = [\"phr\"], uv_amr = [\"pin\"] }",
            "person.subject_claim",
        ),
        (
            "person = { issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", max_age_s = 0, acr_values = [\"phr\"], uv_amr = [\"pin\"] }",
            "person.max_age_s",
        ),
        (
            "person = { issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", max_age_s = 3601, acr_values = [\"phr\"], uv_amr = [\"pin\"] }",
            "person.max_age_s",
        ),
        (
            "person = { issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", acr_values = [\"phr\"], uv_amr = [\"pin\"], prompt = \"none\" }",
            "person.prompt",
        ),
    ] {
        invalid(&login(person), key);
    }
    // A person login is at an issuer of its own namespace.
    let other = oauth(
        "\n[auth.namespaces.partners]\nperson = { issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", acr_values = [\"phr\"], uv_amr = [\"pin\"] }\n",
    );
    let error = invalid(&other, "auth.namespaces.partners.person.issuer");
    assert!(error.message().contains("own namespace"), "{error}");
    // D181: mfa (a passkey login) only where every class is phishing-resistant.
    for (acr, uv) in [
        ("\"phr\", \"urn:x:uv\"", "\"mfa\""),
        ("\"mfa\"", "\"mfa\""),
        ("\"urn:x:uv\"", "\"pin\", \"mfa\""),
    ] {
        let error = invalid(
            &login(&format!(
                "person = {{ issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", acr_values = [{acr}], uv_amr = [{uv}] }}"
            )),
            "person.uv_amr",
        );
        assert!(error.message().contains("phishing-resistant"), "{error}");
    }
    for bare in ["hwk", "swk"] {
        invalid(
            &login(&format!(
                "person = {{ issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", acr_values = [\"phr\"], uv_amr = [\"{bare}\"] }}"
            )),
            "person.uv_amr",
        );
    }
    for (acr, uv) in [
        ("\"phr\"", "\"mfa\""),
        ("\"phr\", \"phrh\"", "\"pin\", \"mfa\""),
        ("\"phrh\"", "\"mfa\""),
    ] {
        let workspace = open(&login(&format!(
            "person = {{ issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", acr_values = [{acr}], uv_amr = [{uv}] }}"
        )))
        .unwrap();
        let person = workspace.config().auth.namespaces[0]
            .person
            .clone()
            .unwrap();
        assert!(person.uv_amr.iter().any(|method| method == "mfa"));
    }
    // Every RFC 8176 user-verification method is accepted.
    let all = login(
        "person = { issuer = \"corp-idp\", client_id = \"p\", client_secret_env = \"S\", subject_claim = \"oid\", max_age_s = 3600, acr_values = [\"phr\", \"urn:x:uv\"], uv_amr = [\"pin\", \"fpt\", \"face\", \"iris\", \"retina\", \"vbm\"] }",
    );
    let workspace = open(&all).unwrap();
    let person = workspace.config().auth.namespaces[0]
        .person
        .clone()
        .unwrap();
    assert_eq!(person.uv_amr, umbel::auth::UV_AMR_METHODS);
    assert_eq!(
        (person.subject_claim.as_str(), person.max_age_s),
        ("oid", 3600)
    );
    // A namespace may have no person login.
    open(&oauth("").replace(PERSON, "")).unwrap();
}

#[test]
fn bound_tokens_need_oauth_and_a_client_certificate() {
    let bound = |tls: &str| {
        oauth(tls).replacen(
            "mode = \"oauth\"",
            "mode = \"oauth\"\nrequire_bound_tokens = true",
            1,
        )
    };
    let error = invalid(&bound(""), "auth.require_bound_tokens");
    assert!(error.message().contains("client_auth"), "{error}");
    invalid(
        &bound("\n[http.tls]\ncert = \"c.pem\"\nkey = \"k.pem\"\n"),
        "auth.require_bound_tokens",
    );
    for client_auth in ["any", "ca\"\nclient_ca = \"ca.pem"] {
        let workspace = open(&bound(&format!(
            "\n[http.tls]\ncert = \"c.pem\"\nkey = \"k.pem\"\nclient_auth = \"{client_auth}\"\n"
        )))
        .unwrap();
        assert!(workspace.config().auth.require_bound_tokens);
    }
    invalid(
        "config_version = 5\n[auth]\nrequire_bound_tokens = true\n",
        "auth.require_bound_tokens",
    );
}

// ── The gateway ────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_gateway_is_mode_gateway_only_with_a_pinned_channel_off_loopback() {
    let loopback = open(&gateway("127.0.0.1:8443", "", "")).unwrap();
    let config = loopback.config();
    assert_eq!(config.auth.mode, AuthMode::Gateway);
    let edge = config.auth.gateway.clone().unwrap();
    assert_eq!(edge.alias, "edge");
    assert_eq!(edge.namespace, "corp");
    assert_eq!(edge.issuer, "https://gateway.example.com");
    assert_eq!(edge.keys, "secrets/gateway/jwks.json");
    assert!(edge.client_cert_sha256.is_empty());
    assert_eq!(edge.max_assertion_age_s, 60);
    // At most 60 (amendment from step 4): the lifetime bound makes a larger age admit nothing.
    let sixty = open(&format!(
        "{}max_assertion_age_s = 60\n",
        gateway("127.0.0.1:8443", "", "")
    ))
    .unwrap();
    assert_eq!(
        sixty
            .config()
            .auth
            .gateway
            .as_ref()
            .unwrap()
            .max_assertion_age_s,
        60
    );
    assert_eq!(edge.max_scopes, ["umbel:read", "umbel:write:main"]);
    // Off loopback: TLS with client_auth = "ca" and the pins.
    let error = invalid(
        &gateway("0.0.0.0:8443", TLS_CA, ""),
        "auth.gateway.client_cert_sha256",
    );
    assert!(error.message().contains("non-loopback"), "{error}");
    let tls_any = "\n[http.tls]\ncert = \"c.pem\"\nkey = \"k.pem\"\nclient_auth = \"any\"\n";
    invalid(
        &gateway("0.0.0.0:8443", tls_any, PIN),
        "http.tls.client_auth",
    );
    let pinned = open(&gateway("0.0.0.0:8443", TLS_CA, PIN)).unwrap();
    assert_eq!(
        pinned
            .config()
            .auth
            .gateway
            .as_ref()
            .unwrap()
            .client_cert_sha256
            .len(),
        1
    );
    // Pins need a certificate to reach Umbel (amendment from step 4): on loopback without TLS,
    // or with client_auth = "none", they could never match, so they are refused.
    let error = invalid(
        &gateway("127.0.0.1:8443", "", PIN),
        "auth.gateway.client_cert_sha256",
    );
    assert!(error.message().contains("client_auth"), "{error}");
    let tls_none = "\n[http.tls]\ncert = \"c.pem\"\nkey = \"k.pem\"\nclient_auth = \"none\"\n";
    invalid(
        &gateway("127.0.0.1:8443", tls_none, PIN),
        "auth.gateway.client_cert_sha256",
    );
    open(&gateway("127.0.0.1:8443", tls_any, PIN)).unwrap();
    open(&gateway("127.0.0.1:8443", TLS_CA, PIN)).unwrap();
    // The table is required in mode gateway and refused elsewhere.
    let without = gateway("127.0.0.1:8443", "", "");
    let cut = without.find("\n[auth.gateway]").unwrap();
    invalid(&without[..cut], "auth.gateway");
    invalid(
        &without.replace("mode = \"gateway\"", "mode = \"none\""),
        "auth.gateway",
    );
    invalid(&format!("{}\n", oauth("").replace(
        "[auth.issuers.corp-idp]",
        "[auth.gateway]\nalias = \"edge\"\nnamespace = \"corp\"\nissuer = \"https://g.example.com\"\nkeys = \"k.json\"\nmax_scopes = [\"umbel:read\"]\n\n[auth.issuers.corp-idp]",
    )), "auth.gateway");
}

#[test]
fn the_gateway_table_refuses_what_it_does_not_define() {
    let base = gateway("127.0.0.1:8443", "", "");
    let swap = |from: &str, to: &str| base.replacen(from, to, 1);
    for (text, key) in [
        (
            swap("alias = \"edge\"", "alias = \"Edge\""),
            "auth.gateway.alias",
        ),
        (swap("alias = \"edge\"\n", ""), "auth.gateway.alias"),
        (
            swap(
                "namespace = \"corp\"\nissuer",
                "namespace = \"nowhere\"\nissuer",
            ),
            "auth.gateway.namespace",
        ),
        (
            swap("https://gateway.example.com", "http://gateway.example.com"),
            "auth.gateway.issuer",
        ),
        (
            swap(
                "keys = \"secrets/gateway/jwks.json\"",
                "keys = \"../jwks.json\"",
            ),
            "auth.gateway.keys",
        ),
        (
            swap("keys = \"secrets/gateway/jwks.json\"\n", ""),
            "auth.gateway.keys",
        ),
        (
            format!("{base}client_cert_sha256 = [\"AB12\"]\n"),
            "auth.gateway.client_cert_sha256",
        ),
        (
            format!("{base}client_cert_sha256 = [\"{}\"]\n", "A".repeat(64)),
            "auth.gateway.client_cert_sha256",
        ),
        (
            format!(
                "{base}client_cert_sha256 = [\"{0}\", \"{0}\"]\n",
                "a".repeat(64)
            ),
            "auth.gateway.client_cert_sha256",
        ),
        (
            format!("{base}max_assertion_age_s = 0\n"),
            "auth.gateway.max_assertion_age_s",
        ),
        (
            format!("{base}max_assertion_age_s = 61\n"),
            "auth.gateway.max_assertion_age_s",
        ),
        (
            swap(
                "max_scopes = [\"umbel:read\", \"umbel:write:main\"]",
                "max_scopes = []",
            ),
            "auth.gateway.max_scopes",
        ),
        (
            swap("umbel:write:main", "umbel:admin"),
            "auth.gateway.max_scopes",
        ),
        (
            swap("umbel:write:main", "umbel:write:nowhere"),
            "auth.gateway.max_scopes",
        ),
        (
            swap("umbel:write:main", "other:write"),
            "auth.gateway.max_scopes",
        ),
        (
            swap("umbel:write:main", "umbel:write:*"),
            "auth.gateway.max_scopes",
        ),
        (
            format!("{base}x_user_header = \"X-User\"\n"),
            "auth.gateway.x_user_header",
        ),
    ] {
        invalid(&text, key);
    }
    // The alias and iss are no issuer's.
    // In mode gateway an issuer serves only a person login.
    let with_issuer = |alias: &str, url: &str| {
        base.replace(
            "[auth.namespaces.corp]\n",
            &format!("[auth.namespaces.corp]\n{}\n", PERSON.replace("corp-idp", alias)),
        )
        .replace(
            "[auth.gateway]",
            &format!(
                "[auth.issuers.{alias}]\nissuer = \"{url}\"\nnamespace = \"corp\"\naccess_tokens = false\n\n[auth.gateway]"
            ),
        )
    };
    open(&with_issuer("corp-idp", "https://idp.example.com")).unwrap();
    let error = invalid(
        &with_issuer("corp-idp", "https://idp.example.com")
            .replace("access_tokens = false", "access_tokens = true"),
        "auth.issuers.corp-idp.access_tokens",
    );
    assert!(error.message().contains("gateway"), "{error}");
    invalid(
        &with_issuer("edge", "https://idp.example.com"),
        "auth.gateway.alias",
    );
    invalid(
        &with_issuer("corp-idp", "https://gateway.example.com"),
        "auth.gateway.issuer",
    );
}

// ── Principals: the operator id and equivalents ────────────────────────────────────────────────

#[test]
fn in_hosted_modes_the_operator_is_a_namespaced_principal() {
    // The default local id, a plain id and an undeclared namespace are refused.
    for local_id in [
        "local",
        "ada",
        "other/U1",
        "corp/",
        "Corp/U1",
        "corp/~short",
    ] {
        let text = oauth("").replace("corp/U019488227", local_id);
        let error = invalid(&text, "principal.local_id");
        assert!(error.message().contains("<namespace>/<subject>"), "{error}");
    }
    invalid(
        &oauth("").replace("local_id = \"corp/U019488227\"\n", ""),
        "principal.local_id",
    );
    invalid(
        &gateway("127.0.0.1:8443", "", "").replace("corp/U019488227", "ada"),
        "principal.local_id",
    );
    // on_behalf_of too, when set.
    invalid(
        &oauth("").replace(
            "local_id = \"corp/U019488227\"\n",
            "local_id = \"corp/U019488227\"\non_behalf_of = \"ada\"\n",
        ),
        "principal.on_behalf_of",
    );
    let both = open(&oauth("").replace(
        "local_id = \"corp/U019488227\"\n",
        "local_id = \"corp/U019488227\"\non_behalf_of = \"corp/U019488227\"\n",
    ))
    .unwrap();
    assert_eq!(
        both.config().principal.on_behalf_of.as_deref(),
        Some("corp/U019488227")
    );
    // The hashed form is a subject too.
    let hashed = format!("corp/~{}", "a".repeat(52));
    open(&oauth("").replace("corp/U019488227", &hashed)).unwrap();
    // In mode none any local id stays valid, as in version 4.
    open("config_version = 5\n[principal]\nlocal_id = \"ada\"\non_behalf_of = \"ada\"\n").unwrap();
}

#[test]
fn equivalents_map_a_legacy_principal_one_way_to_a_namespaced_one() {
    let with = |entries: &str| {
        oauth("").replace(
            "local_id = \"corp/U019488227\"\n",
            &format!("local_id = \"corp/U019488227\"\n\n[principal.equivalents]\n{entries}\n"),
        )
    };
    let workspace = open(&with(
        "\"human:ada\" = \"human:corp/U019488227\"\n\"agent:ada\" = \"human:corp/U019488227\"\n\"agent:loopback\" = \"service:corp/build-bot\"",
    ))
    .unwrap();
    let equivalents = &workspace.config().principal.equivalents;
    assert_eq!(equivalents.len(), 3);
    assert_eq!(equivalents["human:ada"], "human:corp/U019488227");
    assert_eq!(equivalents["agent:loopback"], "service:corp/build-bot");
    for entries in [
        // The target is produced by a declared namespace, as a human, agent or service.
        "\"human:ada\" = \"human:ada2\"",
        "\"human:ada\" = \"human:other/U1\"",
        "\"human:ada\" = \"script:corp/U1\"",
        "\"human:ada\" = \"human:corp/\"",
        "\"human:ada\" = \"corp/U1\"",
        "\"human:ada\" = 3",
        // The source is a principal no namespace produces.
        "\"human:corp/U1\" = \"human:corp/U019488227\"",
        "\"agent:corp/bot\" = \"human:corp/U019488227\"",
        "\"ada\" = \"human:corp/U019488227\"",
        "\"robot:ada\" = \"human:corp/U019488227\"",
    ] {
        invalid(&with(entries), "principal.equivalents");
    }
    // Chains cannot form: a target is namespaced and a source never is.
    invalid(
        &with("\"human:ada\" = \"human:corp/U1\"\n\"human:corp/U1\" = \"human:corp/U2\""),
        "principal.equivalents",
    );
    // In mode none, a target still needs a declared namespace.
    invalid(
        "config_version = 5\n[principal.equivalents]\n\"human:ada\" = \"human:corp/U1\"\n",
        "principal.equivalents",
    );
    open("config_version = 5\n[principal.equivalents]\n\"human:ada\" = \"human:corp/U1\"\n[auth.namespaces.corp]\n").unwrap();
}

// ── Groups, limits and usage ───────────────────────────────────────────────────────────────────

#[test]
fn a_group_claim_names_an_issuer_whose_tokens_are_accepted() {
    let group = |claim: &str| {
        oauth(&format!(
            "\n[access.groups.eng]\nmembers = [\"human:corp/U019488227\"]\nclaim = {claim}\n"
        ))
    };
    let workspace = open(&group(
        "{ issuer = \"corp-idp\", name = \"groups\", value = \"engineering\" }",
    ))
    .unwrap();
    let parsed = &workspace.config().access.groups[0];
    let claim = parsed.claim.as_ref().unwrap();
    assert_eq!(
        (
            claim.issuer.as_str(),
            claim.name.as_str(),
            claim.value.as_str()
        ),
        ("corp-idp", "groups", "engineering")
    );
    for (claim, key) in [
        (
            "{ issuer = \"nowhere\", name = \"groups\", value = \"e\" }",
            "claim.issuer",
        ),
        ("{ name = \"groups\", value = \"e\" }", "claim.issuer"),
        ("{ issuer = \"corp-idp\", value = \"e\" }", "claim.name"),
        (
            "{ issuer = \"corp-idp\", name = \"groups\" }",
            "claim.value",
        ),
        (
            "{ issuer = \"corp-idp\", name = \"groups\", value = \"\" }",
            "claim.value",
        ),
        (
            "{ issuer = \"corp-idp\", name = \"groups\", value = \"e\", contains = true }",
            "claim.contains",
        ),
        ("\"groups\"", "access.groups.eng.claim"),
    ] {
        invalid(&group(claim), key);
    }
    // Never from a gateway, nor from a login-only issuer.
    let gw = gateway("127.0.0.1:8443", "", "")
        + "\n[access.groups.eng]\nmembers = []\nclaim = { issuer = \"edge\", name = \"groups\", value = \"e\" }\n";
    let error = invalid(&gw, "access.groups.eng.claim.issuer");
    assert!(error.message().contains("gateway"), "{error}");
    let login_only = oauth(
        "access_tokens = false\n\n[auth.issuers.corp-as]\nissuer = \"https://as.example.com\"\nnamespace = \"corp\"\n\n[access.groups.eng]\nmembers = []\nclaim = { issuer = \"corp-idp\", name = \"groups\", value = \"e\" }\n",
    );
    invalid(&login_only, "access.groups.eng.claim.issuer");
}

#[test]
fn limits_and_usage_take_their_defaults_and_refuse_what_they_do_not_define() {
    let workspace = open(
        "config_version = 5\n[limits]\nip_requests_per_minute = 1\ncalls_per_minute = 2\nread_bytes_per_minute = 3\nperson_pages_per_hour = 4\n[usage]\nenabled = false\nreaders = [\"human:corp/U1\", \"group:auditors\"]\nretention_days = 30\n[access.groups.auditors]\nmembers = []\n",
    )
    .unwrap();
    let config = workspace.config();
    let limits = config.limits;
    assert_eq!(
        (
            limits.ip_requests_per_minute,
            limits.calls_per_minute,
            limits.read_bytes_per_minute,
            limits.person_pages_per_hour
        ),
        (1, 2, 3, 4)
    );
    assert!(!config.usage.enabled);
    assert_eq!(config.usage.readers, ["human:corp/U1", "group:auditors"]);
    assert_eq!(config.usage.retention_days, 30);
    for (body, key) in [
        (
            "[limits]\ncalls_per_minute = 0\n",
            "limits.calls_per_minute",
        ),
        (
            "[limits]\nip_requests_per_minute = -5\n",
            "limits.ip_requests_per_minute",
        ),
        (
            "[limits]\nread_bytes_per_minute = \"64M\"\n",
            "limits.read_bytes_per_minute",
        ),
        (
            "[limits]\nperson_pages_per_hour = 0\n",
            "limits.person_pages_per_hour",
        ),
        ("[limits]\nburst = 10\n", "limits.burst"),
        ("[usage]\nreaders = [\"*\"]\n", "usage.readers"),
        ("[usage]\nreaders = [\"ada\"]\n", "usage.readers"),
        (
            "[usage]\nreaders = [\"human:a\", \"human:a\"]\n",
            "usage.readers",
        ),
        ("[usage]\nreaders = [\"group:nowhere\"]\n", "usage.readers"),
        ("[usage]\nretention_days = 0\n", "usage.retention_days"),
        ("[usage]\nenabled = 1\n", "usage.enabled"),
        ("[usage]\npath = \"x\"\n", "usage.path"),
    ] {
        invalid(&format!("config_version = 5\n{body}"), key);
    }
}

#[test]
fn the_memory_write_table_holds_editors_erasers_and_the_two_person_rule() {
    let memory = |keys: &str| {
        format!(
            "config_version = 5\n[plugins]\nenabled = [\"memory\"]\n[plugins.memory]\nsource = \"compiled:memory\"\n[plugins.memory.grants.memory_write]\nallow = [\"main\"]\n{keys}\n"
        )
    };
    let defaults = open(&memory("")).unwrap();
    let policy = defaults.config().plugins.instances[0]
        .memory_write
        .clone()
        .unwrap();
    assert!(policy.editors.is_empty() && policy.erasers.is_empty());
    assert_eq!(policy.erase_approvals, 1);
    assert_eq!(policy.erase_approval_window_s, 86_400);
    let set = open(&memory(
        "editors = [\"group:eng\", \"principal:human:corp/U2\"]\nerasers = [\"group:records-admins\", \"principal:human:corp/U1\"]\nerase_approvals = 2\nerase_approval_window_s = 604800",
    ))
    .unwrap();
    let policy = set.config().plugins.instances[0]
        .memory_write
        .clone()
        .unwrap();
    assert_eq!(policy.editors, ["group:eng", "principal:human:corp/U2"]);
    assert_eq!(
        policy.erasers,
        ["group:records-admins", "principal:human:corp/U1"]
    );
    assert_eq!(
        (policy.erase_approvals, policy.erase_approval_window_s),
        (2, 604_800)
    );
    for (keys, key) in [
        ("erasers = [\"space\"]", "erasers"),
        ("editors = [\"space\"]", "editors"),
        ("erasers = [\"everyone\"]", "erasers"),
        ("erasers = [\"group:a\", \"group:a\"]", "erasers"),
        ("editors = [\"human:ada\"]", "editors"),
        ("erase_approvals = 0", "erase_approvals"),
        ("erase_approvals = 3", "erase_approvals"),
        ("erase_approval_window_s = 599", "erase_approval_window_s"),
        (
            "erase_approval_window_s = 604801",
            "erase_approval_window_s",
        ),
        ("erase_quorum = 2", "erase_quorum"),
    ] {
        invalid(&memory(keys), key);
    }
}

// ── The examples, the doctor and the HTTP surface ──────────────────────────────────────────────

#[test]
fn the_specifications_example_opens_with_tls() {
    let example = include_str!("../schemas/examples/workspace-config.v5.full.json");
    let value: serde_json::Value = serde_json::from_str(example).unwrap();
    let text = toml::to_string(&toml::Value::try_from(&value).unwrap()).unwrap();
    let workspace = open(&text).unwrap();
    let config = workspace.config();
    assert_eq!(config.auth.mode, AuthMode::Oauth);
    assert_eq!(config.auth.issuers.len(), 3);
    assert_eq!(config.principal.equivalents.len(), 3);
    assert!(!config.http.bind.ip().is_loopback());
}

#[test]
fn the_doctor_reads_version_5_and_reports_its_rules() {
    let (_dir, root) = workspace_with(&oauth(""));
    let report = doctor::run(&root);
    let parse = report
        .checks
        .iter()
        .find(|c| c.id == "config.parse")
        .unwrap();
    assert_eq!(parse.status, CheckStatus::Pass, "{}", parse.message);
    assert!(parse.message.contains("version 5"), "{}", parse.message);
    let keys = report
        .checks
        .iter()
        .find(|c| c.id == "config.keys")
        .unwrap();
    assert_eq!(keys.status, CheckStatus::Pass, "{}", keys.message);
    let http = report
        .checks
        .iter()
        .find(|c| c.id == "http.config")
        .unwrap();
    assert_eq!(http.status, CheckStatus::Pass, "{}", http.message);
    // An auth rule fails config.parse; an http rule fails http.config; an unknown key fails
    // config.keys.
    let (_dir, root) = workspace_with(&oauth("").replace("corp/U019488227", "ada"));
    let report = doctor::run(&root);
    let parse = report
        .checks
        .iter()
        .find(|c| c.id == "config.parse")
        .unwrap();
    assert_eq!(parse.status, CheckStatus::Fail);
    assert!(
        parse.message.contains("principal.local_id"),
        "{}",
        parse.message
    );
    let (_dir, root) =
        workspace_with(&oauth("").replace("https://umbel.example.com/mcp", "https://x.test/mcp"));
    let report = doctor::run(&root);
    let http = report
        .checks
        .iter()
        .find(|c| c.id == "http.config")
        .unwrap();
    assert_eq!(http.status, CheckStatus::Fail);
    assert!(http.message.contains("http.public_url"), "{}", http.message);
    let (_dir, root) = workspace_with(&oauth("bogus = 1\n"));
    let report = doctor::run(&root);
    let keys = report
        .checks
        .iter()
        .find(|c| c.id == "config.keys")
        .unwrap();
    assert_eq!(keys.status, CheckStatus::Fail);
    assert!(
        keys.message.contains("auth.issuers.corp-idp.bogus"),
        "{}",
        keys.message
    );
}

#[test]
fn a_hosted_workspace_opens_but_the_bare_router_leaves_it_to_the_listener() {
    for (text, key) in [
        (oauth(""), "auth.mode"),
        (gateway("127.0.0.1:8443", "", ""), "auth.mode"),
        (
            "config_version = 5\n[http.tls]\ncert = \"c.pem\"\nkey = \"k.pem\"\n".to_owned(),
            "http.tls",
        ),
    ] {
        let dir = support::workspace(&text);
        let host = support::host(dir.path());
        let error = host.http_router().unwrap_err();
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{text}");
        assert!(error.message().contains(key), "{}", error.message());
    }
    // Mode none on loopback serves as before.
    let dir = support::workspace("config_version = 5\n");
    let _router = support::host(dir.path()).http_router().unwrap();
}
