//! Token verification through the host (phase 5 specification, section 3.2; step 2b): every
//! rule, broken alone by `umbel-testkit-idp`, refused by the verifier the host builds from
//! `[auth]` with the specified 401 and its rule code in the log; routing by shape, so a token
//! never reaches an issuer that did not issue it; the per-issuer and `[auth]` settings; bound
//! tokens; and the introspection issuer with its client credentials and 60-second cache.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "support/logs.rs"]
mod logs;
mod support;

use std::time::Duration;

use serde_json::{Value, json};
use support::hosted::{Client, PUBLIC_URL, tls_table, write_tls};
use support::oauth::{Running, Setup, modern, refused_with};
use umbel_testkit_idp::{
    Algorithm, Break, Client as KitClient, Endpoint, Fault, IntrospectionAnswer, TestIdp,
};

/// The 401 of section 3.2, with `error="invalid_token"` when a token was sent.
fn assert_unauthorized(reply: &support::hosted::Reply, token_sent: bool, label: &str) {
    assert_eq!(reply.status, 401, "{label}: {}", reply.text);
    let challenge = reply
        .headers
        .get("www-authenticate")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    assert!(
        challenge.starts_with("Bearer resource_metadata="),
        "{label}: {challenge}"
    );
    assert_eq!(
        challenge.contains("error=\"invalid_token\""),
        token_sent,
        "{label}: {challenge}"
    );
    assert_eq!(reply.json()["error"], json!("UNAUTHORIZED"), "{label}");
}

/// Whether AFD logged a refusal of `alias` with `rule`.
fn logged(alias: &str, rule: &str) -> bool {
    logs::lines("refused a request's bearer token")
        .iter()
        .any(|line| refused_with(line, alias, rule))
}

#[tokio::test]
async fn every_rule_broken_alone_is_refused_with_its_code_and_nothing_runs() {
    logs::install();
    let running = Running::start(Setup {
        alias: "as-rules",
        ..Setup::default()
    })
    .await;
    // The unbroken token is accepted and runs.
    let valid = running.token().sign();
    assert_eq!(
        running.whoami(&valid).await["principal"]["authentication"],
        "verified"
    );
    for rule in Break::ALL {
        let token = running.token().break_rule(rule).sign();
        let label = format!("{rule:?}");
        let reply = running.call(Some(&token), "fixture-touch", json!({})).await;
        assert_unauthorized(&reply, true, &label);
        // Before routing names an issuer, AFD logs `-` for it.
        let alias = if rule.rule() == "unknown-issuer" {
            "-"
        } else {
            "as-rules"
        };
        assert!(
            logged(alias, rule.rule()),
            "{label}: no {} refusal logged",
            rule.rule()
        );
    }
    // Nothing a broken token sent stopped the issuer's good tokens.
    assert_eq!(
        running.whoami(&valid).await["principal"]["issuer"],
        "as-rules"
    );
}

#[tokio::test]
async fn a_token_travels_only_in_one_authorization_header() {
    let running = Running::start(Setup::default()).await;
    let token = running.token().sign();
    let body =
        json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }).to_string();
    let json_headers = [
        ("content-type", "application/json"),
        ("accept", "application/json, text/event-stream"),
    ];
    // No token: the 401 without `error`.
    let reply = modern(&running.client, "tools/list", json!({}), None).await;
    assert_unauthorized(&reply, false, "none");
    // In the query.
    let path = format!("/mcp?access_token={token}");
    let reply = running
        .client
        .send(
            running
                .client
                .request("POST", &path, &json_headers, body.clone()),
        )
        .await;
    assert_eq!(reply.status, 401, "{}", reply.text);
    // In two headers, even when both are valid.
    let bearer = format!("Bearer {token}");
    let mut headers = json_headers.to_vec();
    headers.push(("authorization", &bearer));
    headers.push(("authorization", &bearer));
    let reply = running
        .client
        .send(
            running
                .client
                .request("POST", "/mcp", &headers, body.clone()),
        )
        .await;
    assert_eq!(reply.status, 401, "{}", reply.text);
    // In a form body.
    let form = [("content-type", "application/x-www-form-urlencoded")];
    let reply = running
        .client
        .send(
            running
                .client
                .request("POST", "/mcp", &form, format!("access_token={token}")),
        )
        .await;
    assert_eq!(reply.status, 401, "{}", reply.text);
}

#[tokio::test]
async fn tokens_route_by_shape_and_never_reach_an_issuer_that_did_not_issue_them() {
    logs::install();
    let running = Running::start(Setup {
        alias: "as-route",
        ..Setup::default()
    })
    .await;
    let idp = running.kit.identity_provider();
    let server = running.kit.authorization_server();
    // A JWS from the login-only issuer: unknown, and its keys are never fetched.
    let token = idp.access_token(PUBLIC_URL).subject("ada").sign();
    assert_unauthorized(
        &running
            .call(Some(&token), "fixture-whoami", json!({}))
            .await,
        true,
        "idp",
    );
    assert_eq!(idp.hits(Endpoint::Jwks), 0);
    assert_eq!(idp.hits(Endpoint::OauthMetadata), 0);
    // An opaque token with no introspection issuer is sent nowhere.
    let opaque = server.opaque_token(PUBLIC_URL).subject("ada").sign();
    assert_unauthorized(
        &running
            .call(Some(&opaque), "fixture-whoami", json!({}))
            .await,
        true,
        "opaque",
    );
    assert_eq!(server.hits(Endpoint::Introspection), 0);
    assert!(
        logs::lines("refused a request's bearer token")
            .iter()
            .any(|line| support::oauth::has_field(line, "rule", "unknown-issuer"))
    );

    // With the authorization server as the introspection issuer, a JWS naming it is still not
    // introspected: it is routed by its `iss` among the JWT issuers, which it is not one of.
    let kit = TestIdp::start().await.unwrap();
    kit.authorization_server()
        .register_client(KitClient::confidential("umbel-rs", &home()).introspection());
    let running = Running::serve(kit, &introspected("as-intro-route"), None).await;
    let server = running.kit.authorization_server();
    let jws = running.token().sign();
    assert_unauthorized(
        &running.call(Some(&jws), "fixture-whoami", json!({})).await,
        true,
        "jws",
    );
    assert_eq!(server.hits(Endpoint::Introspection), 0);
    assert_eq!(server.hits(Endpoint::Jwks), 0);
}

#[tokio::test]
async fn algorithms_skew_lifetime_and_scope_limits_come_from_auth() {
    logs::install();
    let running = Running::start(Setup {
        alias: "as-settings",
        issuer: "algorithms = [\"ES256\"]",
        auth: "clock_skew_s = 0\nmax_token_lifetime_s = 120\nscope_prefix = \"corp.umbel\"",
        ..Setup::default()
    })
    .await;
    let scoped = |builder: umbel_testkit_idp::TokenBuilder| {
        builder.scopes(["corp.umbel:read", "corp.umbel:write"])
    };
    let good = scoped(running.token().lifetime(120)).sign();
    assert_eq!(
        running.whoami(&good).await["principal"]["scopes"],
        json!(["corp.umbel:read", "corp.umbel:write"])
    );
    let cases = [
        (
            "alg",
            scoped(running.token().lifetime(120))
                .algorithm(Algorithm::RS256)
                .sign(),
        ),
        ("lifetime", scoped(running.token().lifetime(121)).sign()),
        (
            "not-yet-valid",
            scoped(running.token().issued_at(running.now_s() + 5).lifetime(60)).sign(),
        ),
        (
            "scopes-too-many",
            running
                .token()
                .lifetime(120)
                .scopes((0..65).map(|n| format!("corp.umbel:read:s{n}")))
                .sign(),
        ),
    ];
    for (rule, token) in cases {
        assert_unauthorized(
            &running
                .call(Some(&token), "fixture-whoami", json!({}))
                .await,
            true,
            rule,
        );
        assert!(logged("as-settings", rule), "{rule}");
    }
    // 65 scopes under another prefix are not counted.
    let other = running
        .token()
        .lifetime(120)
        .scopes(
            (0..65)
                .map(|n| format!("umbel:read:s{n}"))
                .chain(["corp.umbel:read".to_owned()]),
        )
        .sign();
    assert_eq!(
        running.whoami(&other).await["principal"]["scopes"],
        json!(["corp.umbel:read"])
    );
}

#[tokio::test]
async fn required_bound_tokens_need_the_presented_certificate() {
    logs::install();
    let kit = TestIdp::start().await.unwrap();
    let tls = tls_table("any");
    let setup = Setup {
        alias: "as-bound",
        auth: "require_bound_tokens = true",
        rest: &tls,
        ..Setup::default()
    };
    let dir = support::workspace(&support::oauth::config(&kit, &setup));
    write_tls(dir.path(), &kit);
    let clock = afd::fixed_clock(support::oauth::now_ms());
    let host = support::oauth::host(dir.path(), &kit, Some(&clock), None);
    let served = support::hosted::Served::start(&host).await;
    let mine = kit.ca().client_certificate("agent").unwrap();
    let other = kit.ca().client_certificate("other").unwrap();
    let with = |certificate| Client::tls(served.address, kit.ca().certificate_pem(), certificate);
    let token =
        |builder: umbel_testkit_idp::TokenBuilder| builder.subject("ada").scopes(["umbel:read"]);
    let server = kit.authorization_server();
    let bound = token(server.access_token(PUBLIC_URL))
        .certificate(&mine)
        .sign();
    let reply = modern(
        &with(Some(&mine)),
        "tools/call",
        json!({ "name": "fixture-whoami", "arguments": {} }),
        Some(&bound),
    )
    .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let principal = &reply.json()["result"]["structuredContent"]["data"]["principal"];
    assert_eq!(
        principal["tokenBinding"],
        json!({ "kind": "mtls", "thumbprint": mine.x5t_s256() })
    );
    for (label, client, token) in [
        (
            "unbound",
            with(Some(&mine)),
            token(server.access_token(PUBLIC_URL)).sign(),
        ),
        ("other certificate", with(Some(&other)), bound.clone()),
        ("no certificate", with(None), bound.clone()),
    ] {
        let reply = modern(
            &client,
            "tools/call",
            json!({ "name": "fixture-whoami", "arguments": {} }),
            Some(&token),
        )
        .await;
        assert_unauthorized(&reply, true, label);
    }
    assert!(logged("as-bound", "binding"));
}

/// The value of `HOME`, the environment variable the introspection tests name as their client
/// secret: a variable every test process has, so no test sets one.
fn home() -> String {
    std::env::var("HOME").unwrap()
}

/// A setup whose authorization server is the introspection issuer `alias`.
fn introspected(alias: &str) -> Setup<'_> {
    Setup {
        alias,
        issuer: "verify = \"introspection\"\nintrospection = { client_id = \"umbel-rs\", client_secret_env = \"HOME\" }",
        ..Setup::default()
    }
}

/// A running workspace whose authorization server is the introspection issuer `alias`, with
/// Umbel registered there as an introspection client.
async fn introspection(alias: &str) -> Running {
    let kit = TestIdp::start().await.unwrap();
    kit.authorization_server()
        .register_client(KitClient::confidential("umbel-rs", &home()).introspection());
    Running::serve(kit, &introspected(alias), None).await
}

#[tokio::test]
async fn opaque_tokens_are_introspected_with_umbels_credentials_and_cached_for_a_minute() {
    logs::install();
    let running = introspection("as-intro").await;
    let server = running.kit.authorization_server();
    let opaque = |running: &Running| {
        server
            .opaque_token(PUBLIC_URL)
            .issued_at(running.now_s())
            .lifetime(600)
            .subject("ada")
            .scopes(["umbel:read"])
            .sign()
    };
    let token = opaque(&running);
    let principal = running.whoami(&token).await["principal"].clone();
    assert_eq!(principal["authentication"], "verified");
    assert_eq!(principal["issuer"], "as-intro");
    assert_eq!(principal["actor"]["onBehalfOf"], "corp/ada");
    assert_eq!(server.hits(Endpoint::Introspection), 1);
    // Within a minute the accepted answer is reused, and checked again.
    running.whoami(&token).await;
    assert_eq!(server.hits(Endpoint::Introspection), 1);
    // A revoked token keeps its cached answer for at most that minute.
    assert!(server.revoke(&token));
    running.whoami(&token).await;
    running.clock.advance(61_000);
    assert_unauthorized(
        &running
            .call(Some(&token), "fixture-whoami", json!({}))
            .await,
        true,
        "revoked",
    );
    assert_eq!(server.hits(Endpoint::Introspection), 2);
    assert!(logged("as-intro", "inactive"));

    // The answer must carry every member rule 12 requires, and pass rules 5 to 10.
    for member in ["exp", "iat", "iss", "aud", "sub", "client_id", "jti"] {
        let token = opaque(&running);
        assert!(
            server.set_introspection_answer(&token, IntrospectionAnswer::Without(member.into()))
        );
        assert_unauthorized(
            &running
                .call(Some(&token), "fixture-whoami", json!({}))
                .await,
            true,
            member,
        );
    }
    assert!(logged("as-intro", "claims"));
    let token = opaque(&running);
    server.set_introspection_answer(
        &token,
        IntrospectionAnswer::Patch(json!({ "aud": "https://elsewhere.example.com/mcp" })),
    );
    assert_unauthorized(
        &running
            .call(Some(&token), "fixture-whoami", json!({}))
            .await,
        true,
        "aud",
    );
    assert!(logged("as-intro", "audience"));
    let token = opaque(&running);
    server.set_introspection_answer(&token, IntrospectionAnswer::Inactive);
    assert_unauthorized(
        &running
            .call(Some(&token), "fixture-whoami", json!({}))
            .await,
        true,
        "inactive",
    );
    // A refused answer is never cached: the same token is asked again.
    let before = server.hits(Endpoint::Introspection);
    running
        .call(Some(&token), "fixture-whoami", json!({}))
        .await;
    assert_eq!(server.hits(Endpoint::Introspection), before + 1);

    // An endpoint that fails is `unavailable`, never cached; it answers again once it recovers.
    let token = opaque(&running);
    server.set_fault(Endpoint::Introspection, Fault::Status(500));
    assert_unauthorized(
        &running
            .call(Some(&token), "fixture-whoami", json!({}))
            .await,
        true,
        "500",
    );
    assert!(logged("as-intro", "unavailable"));
    server.clear_fault(Endpoint::Introspection);
    running.whoami(&token).await;
    // A redirect from the endpoint is never followed.
    let token = opaque(&running);
    server.set_fault(Endpoint::Introspection, Fault::Redirect);
    assert_unauthorized(
        &running
            .call(Some(&token), "fixture-whoami", json!({}))
            .await,
        true,
        "redirect",
    );
    assert_eq!(server.moved_hits(Endpoint::Introspection), 0);
}

#[tokio::test]
async fn the_introspection_cache_ends_at_the_tokens_expiry() {
    let running = introspection("as-intro-exp").await;
    let server = running.kit.authorization_server();
    let token = server
        .opaque_token(PUBLIC_URL)
        .issued_at(running.now_s())
        .lifetime(20)
        .subject("ada")
        .scopes(["umbel:read"])
        .sign();
    running.whoami(&token).await;
    // Past `exp` and the skew, but within the minute: the cached answer no longer passes.
    running.clock.advance(20_000 + 61_000);
    assert_unauthorized(
        &running
            .call(Some(&token), "fixture-whoami", json!({}))
            .await,
        true,
        "expired",
    );
}

#[tokio::test]
async fn an_introspection_issuer_without_its_secret_does_not_start() {
    let kit = TestIdp::start().await.unwrap();
    let setup = Setup {
        issuer: "verify = \"introspection\"\nintrospection = { client_id = \"umbel-rs\", client_secret_env = \"UMBEL_TEST_SECRET_THAT_IS_NEVER_SET\" }",
        ..Setup::default()
    };
    let dir = support::workspace(&support::oauth::config(&kit, &setup));
    let host = support::oauth::host(dir.path(), &kit, None, None);
    let error = host.http_server().unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
    let details = error
        .clone()
        .into_result::<Value>()
        .error
        .unwrap()
        .details
        .unwrap();
    assert_eq!(
        details["key"],
        json!("auth.issuers.as.introspection.client_secret_env")
    );
    assert!(
        error
            .message()
            .contains("UMBEL_TEST_SECRET_THAT_IS_NEVER_SET"),
        "{}",
        error.message()
    );
}

#[tokio::test]
async fn a_slow_introspection_endpoint_fails_closed_at_the_timeout() {
    let kit = TestIdp::start().await.unwrap();
    kit.authorization_server()
        .register_client(KitClient::confidential("umbel-rs", &home()).introspection());
    let running = Running::serve(
        kit,
        &introspected("as-intro-slow"),
        Some(Duration::from_millis(500)),
    )
    .await;
    let server = running.kit.authorization_server();
    let token = server
        .opaque_token(PUBLIC_URL)
        .issued_at(running.now_s())
        .subject("ada")
        .sign();
    server.set_fault(
        Endpoint::Introspection,
        Fault::Delay(Duration::from_secs(3)),
    );
    let started = std::time::Instant::now();
    assert_unauthorized(
        &running
            .call(Some(&token), "fixture-whoami", json!({}))
            .await,
        true,
        "slow",
    );
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn a_cached_introspection_answer_is_bound_again_to_each_requests_certificate() {
    let kit = TestIdp::start().await.unwrap();
    kit.authorization_server()
        .register_client(KitClient::confidential("umbel-rs", &home()).introspection());
    let tls = tls_table("any");
    let mut setup = introspected("as-intro-bound");
    setup.rest = &tls;
    let dir = support::workspace(&support::oauth::config(&kit, &setup));
    write_tls(dir.path(), &kit);
    let clock = afd::fixed_clock(support::oauth::now_ms());
    let host = support::oauth::host(dir.path(), &kit, Some(&clock), None);
    let served = support::hosted::Served::start(&host).await;
    let mine = kit.ca().client_certificate("agent").unwrap();
    let other = kit.ca().client_certificate("other").unwrap();
    let with = |certificate| Client::tls(served.address, kit.ca().certificate_pem(), certificate);
    let server = kit.authorization_server();
    let token = server
        .opaque_token(PUBLIC_URL)
        .subject("ada")
        .scopes(["umbel:read"])
        .certificate(&mine)
        .sign();
    let call = |client: Client| {
        let token = token.clone();
        async move {
            modern(
                &client,
                "tools/call",
                json!({ "name": "fixture-whoami", "arguments": {} }),
                Some(&token),
            )
            .await
        }
    };
    assert_eq!(call(with(Some(&mine))).await.status, 200);
    assert_eq!(server.hits(Endpoint::Introspection), 1);
    // The answer is cached, and still refused on a connection without the bound certificate.
    assert_unauthorized(&call(with(Some(&other))).await, true, "other");
    assert_unauthorized(&call(with(None)).await, true, "none");
    assert_eq!(server.hits(Endpoint::Introspection), 1);
}

#[tokio::test]
async fn a_caller_that_hangs_up_does_not_spend_the_minutes_discovery() {
    let running = introspection("as-intro-hangup").await;
    let server = running.kit.authorization_server();
    server.set_fault(
        Endpoint::OauthMetadata,
        Fault::Delay(Duration::from_millis(1500)),
    );
    let token = server
        .opaque_token(PUBLIC_URL)
        .issued_at(running.now_s())
        .subject("ada")
        .scopes(["umbel:read"])
        .sign();
    let abandoned = tokio::time::timeout(
        Duration::from_millis(300),
        running.call(Some(&token), "fixture-whoami", json!({})),
    )
    .await;
    assert!(abandoned.is_err(), "the call should still be discovering");
    tokio::time::sleep(Duration::from_millis(2500)).await;
    server.clear_fault(Endpoint::OauthMetadata);
    running.whoami(&token).await;
    assert_eq!(server.hits(Endpoint::OauthMetadata), 1);
}

#[tokio::test]
async fn introspection_is_bounded_in_size_and_in_flight() {
    let running = introspection("as-intro-bounds").await;
    let server = running.kit.authorization_server();
    let opaque = || {
        server
            .opaque_token(PUBLIC_URL)
            .issued_at(running.now_s())
            .subject("ada")
            .scopes(["umbel:read"])
            .sign()
    };
    running.whoami(&opaque()).await;
    let asked = server.hits(Endpoint::Introspection);
    // A token over 4096 bytes is sent nowhere.
    let long = "a".repeat(4097);
    assert_unauthorized(
        &running.call(Some(&long), "fixture-whoami", json!({})).await,
        true,
        "long",
    );
    assert_eq!(server.hits(Endpoint::Introspection), asked);
    // At most 32 requests in flight: the rest are refused at once, never queued.
    server.set_fault(
        Endpoint::Introspection,
        Fault::Delay(Duration::from_millis(1500)),
    );
    let mut calls = tokio::task::JoinSet::new();
    for _ in 0..40 {
        let client = running.client.clone();
        let token = opaque();
        calls.spawn(async move {
            modern(
                &client,
                "tools/call",
                json!({ "name": "fixture-whoami", "arguments": {} }),
                Some(&token),
            )
            .await
            .status
        });
    }
    let statuses = calls.join_all().await;
    assert!(
        statuses.iter().filter(|status| **status == 401).count() >= 8,
        "{statuses:?}"
    );
    assert!(server.hits(Endpoint::Introspection) <= asked + 32);
}

#[tokio::test]
async fn a_replay_clock_on_the_host_never_reaches_token_verification() {
    let kit = TestIdp::start().await.unwrap();
    let dir = support::workspace(&support::oauth::config(&kit, &Setup::default()));
    // The host's calls run at the epoch; tokens are still judged on the system clock.
    let host = umbel::HostBuilder::open(dir.path())
        .unwrap()
        .with_auth_root_certificate(kit.ca().certificate_pem().as_bytes().to_vec())
        .with_clock(afd::fixed_clock(0))
        .register(support::oauth::whoami())
        .register(support::oauth::touch())
        .seal()
        .unwrap();
    let served = support::hosted::Served::start(&host).await;
    let client = Client::plain(served.address);
    let server = kit.authorization_server();
    let valid = server
        .access_token(PUBLIC_URL)
        .subject("ada")
        .scopes(["umbel:read"])
        .sign();
    let reply = modern(
        &client,
        "tools/call",
        json!({ "name": "fixture-whoami", "arguments": {} }),
        Some(&valid),
    )
    .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let expired = server
        .access_token(PUBLIC_URL)
        .subject("ada")
        .scopes(["umbel:read"])
        .break_rule(Break::Expired)
        .sign();
    let reply = modern(
        &client,
        "tools/call",
        json!({ "name": "fixture-whoami", "arguments": {} }),
        Some(&expired),
    )
    .await;
    assert_unauthorized(&reply, true, "expired");
}
