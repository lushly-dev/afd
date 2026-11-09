//! Gateway-trusted mode (phase 5 specification, section 4.4; D114, owner decision 5; step 4),
//! over real sockets against `umbel-testkit-idp`'s gateway signer.
//!
//! - **Accepted:** a valid assertion over the pinned channel (TLS, `client_auth = "ca"`, the
//!   gateway's certificate pinned) or the loopback channel maps, in the gateway's namespace, to
//!   a `gateway` principal with no token binding, no person and no claim group, its scopes cut
//!   to `max_scopes` by the meet in the scope order.
//! - **Refused, one rule at a time:** every assertion built to break exactly one rule, a missing
//!   or repeated header, the wrong or an unpinned key, a wrong method or URL, an expired, future
//!   or too old assertion, a short `jti`, a `cnf`, a replay on the same host and on a second
//!   host sharing the workspace, a missing, unpinned or foreign client certificate: each is the
//!   one 401 (`Umbel-Gateway realm="umbel"`, a body naming no reason), its rule code is logged,
//!   and nothing runs. A refused assertion spends nothing.
//! - **No header names anyone:** `X-User` and the like, and an access token, are never read.
//! - **No metadata** is published, and the 401 points to none.
//! - **Steps 3 and 7 hold for gateway callers:** the scope resolver and gate, the one answer for
//!   an absent or unreadable space, filtered listings, hidden instances answered as unknown
//!   names, sealed positions, `auth-show` and the per-token limit.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "support/logs.rs"]
mod logs;
mod support;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::{Value, json};
use support::gateway::{
    ASSERTION, Channel, Running, Setup, assert_refused, modern, refused_by, refused_with,
    write_keys,
};
use support::hosted::{Client, METADATA_PATHS, PUBLIC_URL, Reply, Served};
use support::plugins::Probe;
use umbel::plugins::sdk;
use umbel_testkit_idp::{Break, KeyKind, RequiredClaim, TestCa, TokenBuilder};

/// Whether the gateway `edge` logged a refusal with `rule`.
fn logged(rule: &str) -> bool {
    logs::lines("refused a gateway request")
        .iter()
        .any(|line| refused_with(line, "edge", rule))
}

/// The rule codes the gateway `alias` has logged refusals with, in order.
fn refusals(alias: &str) -> Vec<String> {
    logs::lines("refused a gateway request")
        .iter()
        .filter(|line| refused_by(line, alias))
        .filter_map(|line| {
            line.split_whitespace()
                .find_map(|word| word.strip_prefix("rule="))
                .map(|code| code.trim_matches('"').to_owned())
        })
        .collect()
}

/// A command that counts its runs.
fn counted(runs: Arc<AtomicUsize>) -> afd::CommandDefinition {
    support::fixture("fixture-count", move |_, _| {
        runs.fetch_add(1, Ordering::SeqCst);
        afd::success(json!(true))
    })
}

// ─── Accepted ────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_valid_assertion_is_a_gateway_caller_mapped_in_its_namespace() {
    let running = Running::start(Setup::default()).await;
    // The presence, assurance and group claims an assertion carries are ignored (4.4, 4.5).
    let seen = running
        .whoami(
            running
                .assertion()
                .claim("acr", json!("phr"))
                .claim("amr", json!(["hwk", "pin"]))
                .claim("auth_time", json!(running.now_s()))
                .claim(
                    "humanPresent",
                    json!({ "level": "verified", "method": "person-page" }),
                )
                .claim("groups", json!(["eng"]))
                .claim("act", json!({ "sub": "someone-else" })),
        )
        .await;
    let principal = &seen["principal"];
    // The projection is principal version 1 as the schema defines a gateway's (step 1).
    let schema = support::schema_validator("principal.v1");
    assert!(
        schema.is_valid(principal),
        "principal.v1.json refuses {principal}"
    );
    assert_eq!(principal["version"], json!(1));
    assert_eq!(
        principal["actor"],
        json!({ "kind": "agent", "id": "corp/gateway-client", "onBehalfOf": "corp/ada" })
    );
    assert_eq!(seen["actor"], principal["actor"]);
    assert_eq!(principal["transport"], json!("http"));
    assert_eq!(principal["authentication"], json!("gateway"));
    assert_eq!(principal["namespace"], json!("corp"));
    assert_eq!(principal["issuer"], json!("edge"));
    assert_eq!(
        principal["delegationChain"],
        json!([{ "kind": "agent", "id": "corp/gateway-client" }])
    );
    assert_eq!(principal["tokenBinding"], Value::Null);
    assert_eq!(principal["humanPresent"], Value::Null);
    assert_eq!(principal["scopes"], json!(["umbel:read", "umbel:write"]));
    assert_eq!(principal["spaces"], json!({ "main": ["read", "write"] }));
    assert_eq!(seen["claimGroups"], json!([]));
    let credentials = &seen["credentials"];
    assert_eq!(
        credentials["issuer"],
        json!(running.kit.gateway().issuer()),
        "{credentials}"
    );
    assert_eq!(credentials["subject"], json!("ada"));
    assert_eq!(credentials["clientId"], json!("gateway-client"));
    assert_eq!(credentials["resource"], json!(PUBLIC_URL));
    assert!(
        credentials.get("authTime").is_none_or(Value::is_null),
        "{credentials}"
    );
    assert!(
        credentials.get("acr").is_none_or(Value::is_null),
        "{credentials}"
    );
    // Neither the assertion nor any part of it reaches a command.
    assert!(!seen.to_string().contains("umbel-gw+jwt"), "{seen}");

    // A service: `sub` equals `client`, acting for no one.
    let service = running
        .whoami(
            running
                .assertion()
                .subject("build-bot")
                .claim("client", json!("build-bot")),
        )
        .await;
    assert_eq!(
        service["principal"]["actor"],
        json!({ "kind": "service", "id": "corp/build-bot" })
    );
    assert_eq!(
        service["principal"]["delegationChain"],
        json!([{ "kind": "service", "id": "corp/build-bot" }])
    );

    // A long subject is hashed into its namespaced form, as section 4.1 maps every id.
    let long = "u".repeat(150);
    let hashed = running.whoami(running.assertion().subject(&long)).await;
    let on_behalf_of = hashed["principal"]["actor"]["onBehalfOf"].as_str().unwrap();
    assert!(on_behalf_of.starts_with("corp/~"), "{on_behalf_of}");
    assert!(!on_behalf_of.contains(&long));

    // auth-show answers the caller's own projection, the assertion's expiry included.
    let assertion = running.assertion();
    let exp = assertion.claims()["exp"].as_i64().unwrap();
    let shown = running.result(assertion, "auth-show", json!({})).await;
    assert_eq!(shown["success"], json!(true), "{shown}");
    let data = &shown["data"];
    assert_eq!(data["authentication"], json!("gateway"));
    assert_eq!(data["issuer"], json!("edge"));
    assert_eq!(data["namespace"], json!("corp"));
    let expected = chrono::DateTime::from_timestamp(exp, 0)
        .unwrap()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    assert_eq!(data["tokenExpiresAt"], json!(expected));
}

#[tokio::test]
async fn the_ceiling_cuts_the_asserted_scopes_as_a_meet() {
    let running = Running::start(Setup {
        ceiling: r#"["umbel:read", "umbel:write:main"]"#,
        ..Setup::default()
    })
    .await;
    // `write` under a ceiling of `write:main` is `write:main`; `approve` and another prefix are
    // cut; `read` is kept, as `write` implies it.
    let seen = running
        .whoami(
            running
                .assertion()
                .scopes(["umbel:write", "umbel:approve", "other:admin"]),
        )
        .await;
    assert_eq!(
        seen["principal"]["scopes"],
        json!(["umbel:read", "umbel:write:main"])
    );
    assert_eq!(
        seen["credentials"]["scopes"],
        json!(["umbel:read", "umbel:write:main"])
    );
    // A grant narrower than the ceiling stays as narrow.
    let seen = running
        .whoami(running.assertion().scopes(["umbel:read:main"]))
        .await;
    assert_eq!(seen["principal"]["scopes"], json!(["umbel:read:main"]));

    // Nothing left under the ceiling: the gateway's own 403, before anything runs, naming
    // `umbel:read` and no metadata.
    // (Every verb implies `read`, so `erase` under this ceiling would keep `read`; a verb on a
    // space the ceiling names nothing in keeps nothing.)
    for scopes in [
        &["other:admin"][..],
        &["umbel:approve:other", "umbel:erase:other"][..],
    ] {
        let reply = running
            .call(
                Some(&running.assertion().scopes(scopes.iter().copied()).sign()),
                "fixture-whoami",
                json!({}),
            )
            .await;
        assert_eq!(reply.status, 403, "{scopes:?}: {}", reply.text);
        assert_eq!(
            reply
                .headers
                .get("www-authenticate")
                .and_then(|value| value.to_str().ok()),
            Some(
                "Umbel-Gateway realm=\"umbel\", error=\"insufficient_scope\", scope=\"umbel:read\""
            )
        );
        assert_eq!(reply.json()["error"], json!("INSUFFICIENT_SCOPE"));
        assert!(!reply.text.contains("resource_metadata"), "{}", reply.text);
    }
    // A mutation with a write scope the ceiling cut is decided after routing, as AFD decides
    // a call a host's own layer admitted: INSUFFICIENT_SCOPE naming what is missing.
    let refused = running
        .result(
            running.assertion().scopes(["umbel:read"]),
            "fixture-touch",
            json!({}),
        )
        .await;
    assert_eq!(
        refused["error"]["code"],
        json!("INSUFFICIENT_SCOPE"),
        "{refused}"
    );
    assert_eq!(
        refused["error"]["details"]["scopes"],
        json!(["umbel:write:main"]),
        "{refused}"
    );
    let touched = running
        .result(running.assertion(), "fixture-touch", json!({}))
        .await;
    assert_eq!(touched["success"], json!(true), "{touched}");
}

// ─── Refused, one rule at a time ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn every_rule_broken_alone_is_refused_with_one_401_and_its_code_and_nothing_runs() {
    logs::install();
    let runs = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&runs);
    // A 20-second age limit, so that an assertion can be too old while it has not expired.
    let running = Running::start_configured(
        Setup {
            alias: "edge-rules",
            gateway: "max_assertion_age_s = 20\n",
            ..Setup::default()
        },
        move |builder| builder.register(counted(counter)),
    )
    .await;
    // Each refusal must log exactly one line, with exactly its own rule: this test's alias is its
    // own, and its calls are sequential.
    let refused_alone = |label: &str, rule: &str, before: usize| {
        let codes = refusals("edge-rules");
        assert_eq!(codes.len(), before + 1, "{label}: {codes:?}");
        assert_eq!(codes[before], rule, "{label}");
    };
    let now = running.now_s();
    let valid = || running.assertion();

    // The unbroken assertion is accepted and runs.
    let reply = running
        .call(Some(&valid().sign()), "fixture-count", json!({}))
        .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    assert_eq!(runs.load(Ordering::SeqCst), 1);

    // The kit's breaks, each changing one member of the assertion.
    let mut cases: Vec<(String, String, &str)> = Vec::new();
    for rule in [
        (Break::Typ, "typ"),
        (Break::Alg, "alg"),
        (Break::AlgNone, "alg"),
        (Break::Hs256, "alg"),
        (Break::MissingKid, "kid"),
        (Break::UnknownKid, "key"),
        (Break::KeyMismatch, "key"),
        (Break::Crit, "crit"),
        (Break::Jku, "key-reference"),
        (Break::X5u, "key-reference"),
        (Break::X5c, "key-reference"),
        (Break::Jwk, "key-reference"),
        (Break::DuplicateHeaderMember, "typ"),
        (Break::DuplicateClaim, "claims"),
        (Break::Signature, "signature"),
        (Break::UnknownIssuer, "issuer"),
        (Break::Audience, "audience"),
        (Break::MultipleAudiences, "audience"),
        (Break::Missing(RequiredClaim::Exp), "claims"),
        (Break::Missing(RequiredClaim::Iat), "claims"),
        (Break::Missing(RequiredClaim::Jti), "claims"),
        (Break::Missing(RequiredClaim::Sub), "claims"),
        (Break::Missing(RequiredClaim::ClientId), "claims"),
        (Break::EmptySubject, "claims"),
        (Break::ControlCharacter, "claims"),
        (Break::LongClaim, "claims"),
        (Break::StringTime, "claims"),
        (Break::NotYetValid, "not-yet-valid"),
        (Break::NotBefore, "not-yet-valid"),
        (Break::LifetimeTooLong, "lifetime"),
        (Break::ExpiresBeforeIssued, "lifetime"),
        (Break::MalformedScope, "scope-malformed"),
        (Break::TooManyScopes, "scopes-too-many"),
        (Break::DpopBound, "binding"),
        (Break::WrongCertificate, "binding"),
        (Break::CnfNotObject, "binding"),
    ] {
        cases.push((
            format!("{:?}", rule.0),
            valid().break_rule(rule.0).sign(),
            rule.1,
        ));
    }
    // And the gateway's own rules.
    let other_url = "https://127.0.0.1/other";
    let builders: Vec<(&str, TokenBuilder, &str)> = vec![
        // The `typ` is compared exactly: an access token's, another case, a media type.
        (
            "typ at+jwt",
            valid().header_member("typ", json!("at+jwt")),
            "typ",
        ),
        (
            "typ in capitals",
            valid().header_member("typ", json!("UMBEL-GW+JWT")),
            "typ",
        ),
        (
            "typ as a media type",
            valid().header_member("typ", json!("application/umbel-gw+jwt")),
            "typ",
        ),
        ("no typ", valid().without_header_member("typ"), "typ"),
        // The method and URL the assertion is bound to.
        (
            "htm GET for a POST",
            valid().claim("htm", json!("GET")),
            "htm",
        ),
        (
            "htm in lowercase",
            valid().claim("htm", json!("post")),
            "htm",
        ),
        ("no htm", valid().without_claim("htm"), "htm"),
        (
            "htu another path",
            valid().claim("htu", json!(other_url)),
            "htu",
        ),
        (
            "htu with a slash",
            valid().claim("htu", json!(format!("{PUBLIC_URL}/"))),
            "htu",
        ),
        (
            "htu with a query",
            valid().claim("htu", json!(format!("{PUBLIC_URL}?a=1"))),
            "htu",
        ),
        (
            "htu in capitals",
            valid().claim("htu", json!("HTTPS://127.0.0.1/mcp")),
            "htu",
        ),
        ("no htu", valid().without_claim("htu"), "htu"),
        ("no aud", valid().without_claim("aud"), "audience"),
        (
            "aud in capitals",
            valid().audience("HTTPS://127.0.0.1/mcp"),
            "audience",
        ),
        // Times.
        (
            "expired",
            valid().issued_at(now - 61).lifetime(60),
            "expired",
        ),
        (
            "too old",
            valid().issued_at(now - 30).lifetime(60),
            "too-old",
        ),
        (
            "issued beyond the skew",
            valid().issued_at(now + 120).lifetime(60),
            "not-yet-valid",
        ),
        ("a lifetime of 61 seconds", valid().lifetime(61), "lifetime"),
        ("a lifetime of 0", valid().lifetime(0), "lifetime"),
        (
            "a fractional iat",
            valid().claim("iat", json!(now as f64 + 0.5)),
            "claims",
        ),
        (
            "nbf as a string",
            valid().claim("nbf", json!(now.to_string())),
            "claims",
        ),
        // Who and what.
        (
            "an empty client",
            valid().claim("client", json!("")),
            "claims",
        ),
        (
            "a client_id for a client",
            valid()
                .without_claim("client")
                .claim("client_id", json!("gateway-client")),
            "claims",
        ),
        ("no scope", valid().without_claim("scope"), "claims"),
        ("an empty scope", valid().scope_text(""), "claims"),
        (
            "a scope array",
            valid().claim("scope", json!(["umbel:read"])),
            "scope-malformed",
        ),
        ("a short jti", valid().jti(&"j".repeat(21)), "jti"),
        (
            "a short hexadecimal jti",
            valid().jti(&"a".repeat(31)),
            "jti",
        ),
        (
            "a jti with a space",
            valid().jti(&format!("{} x", "j".repeat(30))),
            "jti",
        ),
        // Too large to read.
        (
            "an assertion over 4096 bytes",
            valid().claim("pad", json!("x".repeat(4200))),
            "assertion-malformed",
        ),
    ];
    for (label, builder, rule) in builders {
        cases.push((label.to_owned(), builder.sign(), rule));
    }
    cases.push((
        "not a JWS".to_owned(),
        "not-a-jws".to_owned(),
        "assertion-malformed",
    ));
    for (label, assertion, rule) in &cases {
        let before = refusals("edge-rules").len();
        let reply = running
            .call(Some(assertion), "fixture-count", json!({}))
            .await;
        assert_refused(&reply, label);
        refused_alone(label, rule, before);
    }
    // Two headers, and none, and an assertion sent as a bearer token.
    let one = valid().sign();
    let two = valid().sign();
    let before = refusals("edge-rules").len();
    let reply = running
        .call_with(
            None,
            &[(ASSERTION, &one), (ASSERTION, &two)],
            "fixture-count",
            json!({}),
        )
        .await;
    assert_refused(&reply, "two assertions");
    refused_alone("two assertions", "assertion-malformed", before);
    let before = refusals("edge-rules").len();
    let reply = running.call(None, "fixture-count", json!({})).await;
    assert_refused(&reply, "no assertion");
    refused_alone("no assertion", "no-assertion", before);
    let bearer = format!("Bearer {}", valid().sign());
    let before = refusals("edge-rules").len();
    let reply = running
        .call_with(
            None,
            &[("authorization", &bearer)],
            "fixture-count",
            json!({}),
        )
        .await;
    assert_refused(&reply, "an assertion as a bearer token");
    refused_alone("an assertion as a bearer token", "no-assertion", before);
    // Nothing a refused assertion carried ran.
    assert_eq!(runs.load(Ordering::SeqCst), 1);
    // Within the skew, an assertion issued a little ahead is accepted.
    let ahead = running
        .call(
            Some(&valid().issued_at(now + 30).lifetime(60).sign()),
            "fixture-count",
            json!({}),
        )
        .await;
    assert_eq!(ahead.status, 200, "{}", ahead.text);
    assert_eq!(runs.load(Ordering::SeqCst), 2);
    // A key the file does not pin (the gateway rotated after the file was written), last,
    // since every later assertion would be signed by it.
    let before = refusals("edge-rules").len();
    let reply = running
        .call(Some(&unpinned(&running).sign()), "fixture-count", json!({}))
        .await;
    assert_refused(&reply, "an unpinned key");
    refused_alone("an unpinned key", "key", before);
    assert_eq!(runs.load(Ordering::SeqCst), 2);
    // No refusal logged the assertion or a claim value.
    for line in logs::lines("refused a gateway request") {
        assert!(!line.contains("ada") && !line.contains("eyJ"), "{line}");
    }
    assert!(!refusals("edge-rules").is_empty());
}

/// An assertion signed by a P-256 key the gateway made after the pinned file was written.
fn unpinned(running: &Running) -> TokenBuilder {
    let kid = running.kit.gateway().keys().rotate(KeyKind::P256).unwrap();
    running.assertion().signing_key(&kid)
}

#[tokio::test]
async fn an_assertion_is_spent_once_across_hosts_sharing_the_workspace() {
    logs::install();
    let first = Running::start(Setup::default()).await;
    // A second host on the same workspace, behind the same URL.
    let host = support::oauth::host_with(
        first.dir.path(),
        &first.kit,
        Some(&first.clock),
        None,
        |b| b,
    );
    let served = Served::start(&host).await;
    let second = Client::plain(served.address);
    let call = |client: &Client, assertion: &str| {
        let client = client.clone();
        let assertion = assertion.to_owned();
        async move {
            modern(
                &client,
                "tools/call",
                json!({ "name": "fixture-whoami", "arguments": {} }),
                &[(ASSERTION, &assertion)],
            )
            .await
        }
    };
    let a = first.assertion().sign();
    assert_eq!(call(&first.client, &a).await.status, 200);
    assert_refused(&call(&first.client, &a).await, "replayed on the same host");
    assert_refused(&call(&second, &a).await, "replayed on the other host");
    assert!(logged("replayed"));
    let b = first.assertion().sign();
    assert_eq!(call(&second, &b).await.status, 200);
    assert_refused(&call(&first.client, &b).await, "replayed back");

    // A refused assertion spends nothing: the same `jti` on a valid assertion is accepted once.
    let jti = "a-jti-of-twenty-four-ch";
    let broken = first.assertion().jti(jti).claim("htm", json!("GET")).sign();
    assert_refused(&call(&first.client, &broken).await, "wrong method");
    let fixed = first.assertion().jti(jti).sign();
    assert_eq!(call(&second, &fixed).await.status, 200);
    let again = first.assertion().jti(jti).sign();
    assert_refused(&call(&first.client, &again).await, "the jti is spent");

    // The spent `jti`s are in the shared nonce store (its file or its write-ahead log), under the
    // gateway's prefix.
    let shared = first.dir.path().join("state/shared");
    let stored: Vec<u8> = ["nonces.sqlite3", "nonces.sqlite3-wal"]
        .iter()
        .filter_map(|name| std::fs::read(shared.join(name)).ok())
        .flatten()
        .collect();
    let key = format!("gateway:{jti}");
    assert!(
        stored
            .windows(key.len())
            .any(|window| window == key.as_bytes()),
        "no {key} in the nonce store"
    );
    served.stop().await;
}

// ─── The channel ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_pinned_channel_needs_the_pinned_certificate() {
    logs::install();
    let running = Running::start(Setup {
        channel: Channel::Pinned,
        ..Setup::default()
    })
    .await;
    // The pinned certificate, over TLS: accepted.
    let seen = running.whoami(running.assertion()).await;
    assert_eq!(seen["principal"]["authentication"], json!("gateway"));
    // Another certificate of the same CA: the handshake admits it, the pin does not.
    let other = running
        .kit
        .ca()
        .client_certificate("another client")
        .unwrap();
    let client = Client::tls(
        running.served.address,
        running.kit.ca().certificate_pem(),
        Some(&other),
    );
    let reply = modern(
        &client,
        "tools/call",
        json!({ "name": "fixture-whoami", "arguments": {} }),
        &[(ASSERTION, &running.assertion().sign())],
    )
    .await;
    assert_refused(&reply, "an unpinned certificate");
    assert!(logged("channel"));
    // No certificate, or one of another CA: the handshake itself fails (client_auth = "ca").
    let foreign = TestCa::new()
        .unwrap()
        .client_certificate("umbel-testkit-idp gateway")
        .unwrap();
    for (label, certificate) in [("none", None), ("another CA's", Some(&foreign))] {
        let client = Client::tls(
            running.served.address,
            running.kit.ca().certificate_pem(),
            certificate,
        );
        let request = client.request(
            "POST",
            "/mcp",
            &[(ASSERTION, &running.assertion().sign())],
            "{}",
        );
        assert!(
            client.try_send(request).await.is_err(),
            "{label} was served"
        );
    }
    // The pinned certificate alone is no assertion.
    let reply = running.call(None, "fixture-whoami", json!({})).await;
    assert_refused(&reply, "the certificate without an assertion");
}

#[tokio::test]
async fn pins_on_the_loopback_channel_are_enforced_too() {
    // client_auth = "any" on a loopback bind with a pin: the loopback leg, and the pin as well.
    let kit = umbel_testkit_idp::TestIdp::start().await.unwrap();
    let text = support::gateway::config(&kit, &Setup::default()).replace(
        "keys = \"gateway/jwks.json\"\n",
        &format!(
            "keys = \"gateway/jwks.json\"\nclient_cert_sha256 = [\"{}\"]\n",
            kit.gateway().certificate().sha256_hex()
        ),
    ) + &support::hosted::tls_table("any");
    let dir = support::workspace(&text);
    write_keys(dir.path(), &kit);
    support::hosted::write_tls(dir.path(), &kit);
    let clock = afd::fixed_clock(support::oauth::now_ms());
    let host = support::oauth::host_with(dir.path(), &kit, Some(&clock), None, |b| b);
    let served = Served::start(&host).await;
    let now = afd::Clock::now(&clock).div_euclid(1000);
    let assertion = || {
        kit.gateway()
            .assertion(PUBLIC_URL, "POST")
            .issued_at(now)
            .lifetime(60)
            .sign()
    };
    let send = |certificate: Option<&umbel_testkit_idp::IssuedCertificate>| {
        let client = Client::tls(served.address, kit.ca().certificate_pem(), certificate);
        let assertion = assertion();
        async move {
            modern(
                &client,
                "tools/call",
                json!({ "name": "fixture-whoami", "arguments": {} }),
                &[(ASSERTION, &assertion)],
            )
            .await
        }
    };
    assert_eq!(send(Some(kit.gateway().certificate())).await.status, 200);
    let other = kit.ca().client_certificate("another client").unwrap();
    assert_refused(&send(Some(&other)).await, "an unpinned certificate");
    assert_refused(&send(None).await, "no certificate");
    served.stop().await;
}

// ─── No header names anyone; nothing is published ────────────────────────────────────────────

#[tokio::test]
async fn no_identity_header_or_token_names_anyone() {
    let running = Running::start(Setup::default()).await;
    let bo_token = running
        .kit
        .authorization_server()
        .access_token(PUBLIC_URL)
        .subject("bo")
        .scopes(["umbel:read", "umbel:write"])
        .sign();
    let bearer = format!("Bearer {bo_token}");
    let forged: Vec<(&str, &str)> = vec![
        ("x-user", "bo"),
        ("x-forwarded-user", "bo"),
        ("x-remote-user", "human:corp/bo"),
        ("x-actor", "human:corp/bo"),
        (
            "x-umbel-principal",
            "{\"actor\":{\"kind\":\"human\",\"id\":\"corp/bo\"}}",
        ),
        ("x-forwarded-client-cert", "Hash=00"),
        ("authorization", &bearer),
    ];
    // Without an assertion they stand in for none.
    let reply = running
        .call_with(None, &forged, "fixture-whoami", json!({}))
        .await;
    assert_refused(&reply, "identity headers alone");
    // Beside one, they name no one: the assertion's subject is the caller.
    let assertion = running.assertion().sign();
    let reply = running
        .call_with(Some(&assertion), &forged, "fixture-whoami", json!({}))
        .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let seen = &reply.json()["result"]["structuredContent"]["data"];
    assert_eq!(seen["principal"]["actor"]["onBehalfOf"], json!("corp/ada"));
    assert!(!seen.to_string().contains("corp/bo"), "{seen}");
    assert!(!seen.to_string().contains(&bo_token), "{seen}");
    assert!(!seen.to_string().contains(&assertion), "{seen}");
}

#[tokio::test]
async fn mode_gateway_publishes_no_metadata() {
    let running = Running::start(Setup::default()).await;
    for path in METADATA_PATHS {
        let reply = running.client.get(path, &[]).await;
        assert_eq!(reply.status, 404, "{path}: {}", reply.text);
        assert!(!reply.text.contains("authorization_servers"), "{path}");
    }
    // `/health` is public in a hosted mode; any other path is 404 before the gateway layer.
    let health = running.client.get("/health", &[]).await;
    assert_eq!(health.status, 200, "{}", health.text);
    let other = running.client.get("/token", &[]).await;
    assert_eq!(other.status, 404, "{}", other.text);
    // The 401 names the gateway scheme alone, never a metadata URL.
    let reply = running.call(None, "fixture-whoami", json!({})).await;
    assert_refused(&reply, "no assertion");
    assert!(!reply.text.contains("well-known"));
}

/// What a test does to a workspace before starting it.
type Prepare = Box<dyn Fn(&std::path::Path)>;

#[tokio::test]
async fn the_gateway_needs_a_usable_pinned_key_set_to_start() {
    let kit = umbel_testkit_idp::TestIdp::start().await.unwrap();
    let text = support::gateway::config(&kit, &Setup::default());
    let start = |prepare: &dyn Fn(&std::path::Path)| {
        let dir = support::workspace(&text);
        prepare(dir.path());
        let host = support::oauth::host_with(dir.path(), &kit, None, None, |builder| builder);
        let error = host.http_server().map(drop).unwrap_err();
        (dir, error)
    };
    let mut without_alg = support::gateway::pinned_jwks(&kit);
    without_alg["keys"][0]
        .as_object_mut()
        .unwrap()
        .remove("alg");
    let cases: Vec<(&str, Prepare)> = vec![
        ("missing", Box::new(|_| {})),
        (
            "no alg",
            Box::new(move |dir| {
                std::fs::create_dir_all(dir.join("gateway")).unwrap();
                std::fs::write(dir.join("gateway/jwks.json"), without_alg.to_string()).unwrap();
            }),
        ),
        (
            "empty",
            Box::new(|dir| {
                std::fs::create_dir_all(dir.join("gateway")).unwrap();
                std::fs::write(dir.join("gateway/jwks.json"), r#"{"keys":[]}"#).unwrap();
            }),
        ),
    ];
    for (label, prepare) in &cases {
        let (_dir, error) = start(prepare.as_ref());
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{label}");
        assert_eq!(
            error
                .to_command_error()
                .details
                .and_then(|details| details.get("key").cloned()),
            Some(json!("auth.gateway.keys")),
            "{label}: {}",
            error.message()
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let (_dir, error) = start(&|dir| {
            write_keys(dir, &kit);
            std::fs::set_permissions(
                dir.join("gateway/jwks.json"),
                std::fs::Permissions::from_mode(0o666),
            )
            .unwrap();
        });
        assert!(
            error.message().contains("writable by group or other"),
            "{}",
            error.message()
        );
    }
    // With the key set in place it serves, and the bare router still refuses a hosted mode.
    let dir = support::workspace(&text);
    write_keys(dir.path(), &kit);
    let host = support::oauth::host_with(dir.path(), &kit, None, None, |builder| builder);
    assert!(host.http_server().is_ok());
    assert!(host.http_router().is_err());
}

// ─── Steps 3 and 7 apply to gateway callers ──────────────────────────────────────────────────

/// `alpha` is ada's, `private` is bo's; `main`, the default, is anyone's. The probe instance
/// serves `alpha` and `private`, so ada reads one of its spaces and cy none.
const REST: &str = r#"[spaces.alpha]
readers = ["human:corp/ada"]

[spaces.private]
readers = ["human:corp/bo"]

[plugins]
enabled = ["probe"]

[plugins.probe]
spaces = ["alpha", "private"]
"#;

fn probe() -> Probe {
    Probe::with_manifest(
        r#"manifest_version = 1
protocol = 1

[plugin]
id = "probe"
title = "Probe"
version = "0.3.0"
description = "A plugin whose commands report what its grants allow."
kind = "compiled"
domains = ["probe"]

[[commands]]
name = "probe-note"
description = "Record a note, in a space."
effects = ["plugin-state"]
input_schema = { type = "object", properties = { space = { type = "string" }, text = { type = "string" } }, additionalProperties = false }
"#
        .to_owned(),
    )
}

fn configure(builder: umbel::HostBuilder) -> umbel::HostBuilder {
    builder
        .register_with_schema(
            support::fixture("fixture-spaced", |_, _| afd::success(json!(true))),
            json!({
                "type": "object",
                "properties": { "space": { "type": "string" } },
                "additionalProperties": false,
            }),
        )
        .with_compiled(sdk(probe()))
}

/// The reply with the trace id and times removed, as `space_visibility.rs` compares replies.
fn stable(reply: &Reply) -> String {
    fn strip(value: &mut Value) {
        match value {
            Value::Object(members) => {
                for member in ["traceId", "executionTimeMs", "durationMs", "timing"] {
                    members.remove(member);
                }
                members.values_mut().for_each(strip);
            }
            Value::Array(items) => items.iter_mut().for_each(strip),
            Value::String(text) => {
                if let Ok(mut inner) = serde_json::from_str::<Value>(text)
                    && inner.is_object()
                {
                    strip(&mut inner);
                    *text = inner.to_string();
                }
            }
            _ => {}
        }
    }
    let mut value = reply.json();
    strip(&mut value);
    format!("{} {}", reply.status, value)
}

#[tokio::test]
async fn scopes_one_answer_hidden_commands_and_exact_filtering_hold_for_gateway_callers() {
    let running = Running::start_configured(
        Setup {
            rest: REST,
            ..Setup::default()
        },
        configure,
    )
    .await;
    let as_person = |subject: &str, scopes: &[&str]| {
        running
            .assertion()
            .subject(subject)
            .scopes(scopes.iter().copied())
            .sign()
    };
    let call = |assertion: String, command: &'static str, input: Value| {
        let running = &running;
        async move {
            running
                .call(
                    Some(&assertion),
                    "afd-call",
                    json!({ "command": command, "input": input }),
                )
                .await
        }
    };

    // One answer: bo's space and an undeclared one answer alike, byte for byte.
    let unreadable = call(
        as_person("ada", &["umbel:read", "umbel:write"]),
        "fixture-spaced",
        json!({ "space": "private" }),
    )
    .await;
    let absent = call(
        as_person("ada", &["umbel:read", "umbel:write"]),
        "fixture-spaced",
        json!({ "space": "ghost" }),
    )
    .await;
    assert_eq!(stable(&unreadable), stable(&absent));
    assert!(
        unreadable.text.contains("SPACE_NOT_READABLE"),
        "{}",
        unreadable.text
    );
    assert!(!unreadable.text.contains("private") && !absent.text.contains("ghost"));
    // A space the assertion grants no verb in answers alike too, though ada may read it.
    let narrowed = call(
        as_person("ada", &["umbel:read:main"]),
        "fixture-spaced",
        json!({ "space": "alpha" }),
    )
    .await;
    assert_eq!(stable(&narrowed), stable(&absent));

    // The scope gate: a mutation in alpha with read alone names the scope it lacks.
    let refused = call(
        as_person("ada", &["umbel:read:alpha"]),
        "probe-note",
        json!({ "space": "alpha", "text": "x" }),
    )
    .await;
    assert!(
        refused.text.contains("INSUFFICIENT_SCOPE"),
        "{}",
        refused.text
    );
    assert!(
        refused.text.contains("umbel:write:alpha"),
        "{}",
        refused.text
    );
    let noted = call(
        as_person("ada", &["umbel:read:alpha", "umbel:write:alpha"]),
        "probe-note",
        json!({ "space": "alpha", "text": "x" }),
    )
    .await;
    assert!(noted.text.contains("\"success\":true"), "{}", noted.text);

    // Filtered listings (`tools/list` and `afd-discover`): with read alone, the probe's mutation
    // is not listed; an embedder's command runs in the default space, which this assertion
    // grants nothing in.
    let listed = |subject: &'static str, scopes: &'static [&'static str]| {
        let running = &running;
        async move {
            let tools = modern(
                &running.client,
                "tools/list",
                json!({}),
                &[(ASSERTION, &as_person(subject, scopes))],
            )
            .await;
            assert_eq!(tools.status, 200, "{}", tools.text);
            let discovered = running
                .call(
                    Some(&as_person(subject, scopes)),
                    "afd-discover",
                    json!({ "limit": 200 }),
                )
                .await;
            assert_eq!(discovered.status, 200, "{}", discovered.text);
            format!("{} {}", tools.text, discovered.text)
        }
    };
    let reader = listed("ada", &["umbel:read:alpha"]).await;
    assert!(reader.contains("\"event-list\""), "{reader}");
    assert!(!reader.contains("fixture-whoami"), "{reader}");
    assert!(!reader.contains("probe-note"), "{reader}");
    let writer = listed("ada", &["umbel:read:alpha", "umbel:write:alpha"]).await;
    assert!(writer.contains("probe-note"), "{writer}");

    // A hidden instance: cy reads none of the probe's spaces, so its command is an unknown name.
    for input in [
        json!({ "space": "main", "text": "x" }),
        json!({ "space": 5 }),
    ] {
        let hidden = call(
            as_person("cy", &["umbel:read", "umbel:write"]),
            "probe-note",
            input.clone(),
        )
        .await;
        let unknown = call(
            as_person("cy", &["umbel:read", "umbel:write"]),
            "probe-gone",
            input.clone(),
        )
        .await;
        assert_eq!(
            stable(&hidden).replace("probe-note", "probe-gone"),
            stable(&unknown),
            "{input}"
        );
        assert!(hidden.text.contains("COMMAND_NOT_FOUND"), "{}", hidden.text);
    }
    let cy_list = listed("cy", &["umbel:read", "umbel:write"]).await;
    assert!(!cy_list.contains("probe-note"), "{cy_list}");

    // Exact filtering: a gateway caller is handed sealed positions, never version 0.
    let events = running
        .result(
            running.assertion().scopes(["umbel:read", "umbel:write"]),
            "event-list",
            json!({}),
        )
        .await;
    assert_eq!(events["success"], json!(true), "{events}");
    for field in ["cursor", "acknowledged", "head"] {
        let value = events["data"][field].as_str().unwrap_or_default();
        assert!(value.starts_with("v1."), "{field}: {events}");
    }
    let old = running
        .result(
            running.assertion(),
            "event-list",
            json!({ "after": "v0:main:0" }),
        )
        .await;
    assert_eq!(old["error"]["code"], json!("INVALID_CURSOR"), "{old}");

    // space-list names only the spaces ada reads and her assertion grants.
    let spaces = running
        .result(
            running.assertion().scopes(["umbel:read:alpha"]),
            "space-list",
            json!({}),
        )
        .await;
    let ids: Vec<&str> = spaces["data"]["spaces"]
        .as_array()
        .unwrap()
        .iter()
        .map(|space| space["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["alpha"]);
}

#[tokio::test]
async fn the_per_token_limit_counts_each_gateway_caller_apart() {
    let running = Running::start(Setup {
        rest: "[limits]\ncalls_per_minute = 2\n",
        ..Setup::default()
    })
    .await;
    for _ in 0..2 {
        let reply = running
            .call(
                Some(&running.assertion().sign()),
                "fixture-whoami",
                json!({}),
            )
            .await;
        assert_eq!(reply.status, 200, "{}", reply.text);
    }
    let over = running
        .call(
            Some(&running.assertion().sign()),
            "fixture-whoami",
            json!({}),
        )
        .await;
    assert_eq!(over.status, 429, "{}", over.text);
    // Another person behind the same gateway has a budget of their own.
    let bo = running
        .call(
            Some(&running.assertion().subject("bo").sign()),
            "fixture-whoami",
            json!({}),
        )
        .await;
    assert_eq!(bo.status, 200, "{}", bo.text);
}
