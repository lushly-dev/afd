//! The host's `KeySource` (phase 5 specification, section 3.3; step 2b), through the host: the
//! discovery order (RFC 8414 with path insertion, then OpenID Connect inserted, then appended;
//! only a 404 moves on), the issuer check, an `https` `jwks_uri` only, no redirect followed, the
//! 1 MiB cap and the time limit, the cache of 5 minutes to 24 hours, at most one fetch a minute
//! per issuer whatever asks for it, and the last good keys kept until their cache ends, then
//! failing closed.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration;

use serde_json::json;
use support::oauth::{Running, Setup};
use umbel_testkit_idp::{Endpoint, Fault, KeyKind};

/// Whether `token` is accepted.
async fn accepted(running: &Running, token: &str) -> bool {
    let reply = running.call(Some(token), "fixture-whoami", json!({})).await;
    match reply.status {
        200 => true,
        401 => false,
        status => panic!("unexpected status {status}: {}", reply.text),
    }
}

/// A fresh, valid token on the host's clock.
fn token(running: &Running) -> String {
    running.token().sign()
}

#[tokio::test]
async fn discovery_tries_rfc_8414_then_oidc_inserted_then_appended_and_only_after_a_404() {
    // The first location answers: nothing else is asked.
    let running = Running::start(Setup::default()).await;
    let server = running.kit.authorization_server();
    assert!(accepted(&running, &token(&running)).await);
    assert_eq!(server.hits(Endpoint::OauthMetadata), 1);
    assert_eq!(server.hits(Endpoint::OpenidMetadata), 0);
    assert_eq!(server.hits(Endpoint::OpenidMetadataAppended), 0);
    assert_eq!(server.hits(Endpoint::Jwks), 1);

    // A 404 at the first two: the appended form, in that order.
    let kit = umbel_testkit_idp::TestIdp::start().await.unwrap();
    let server = kit.authorization_server().clone();
    server.set_fault(Endpoint::OauthMetadata, Fault::Status(404));
    server.set_fault(Endpoint::OpenidMetadata, Fault::Status(404));
    let running = Running::serve(kit, &Setup::default(), None).await;
    assert!(accepted(&running, &token(&running)).await);
    assert_eq!(server.hits(Endpoint::OauthMetadata), 1);
    assert_eq!(server.hits(Endpoint::OpenidMetadata), 1);
    assert_eq!(server.hits(Endpoint::OpenidMetadataAppended), 1);

    // Any other failure ends the discovery: nothing further is asked and the token is refused.
    for fault in [
        Fault::Status(500),
        Fault::Status(403),
        Fault::Body("not json".into()),
    ] {
        let kit = umbel_testkit_idp::TestIdp::start().await.unwrap();
        let server = kit.authorization_server().clone();
        server.set_fault(Endpoint::OauthMetadata, fault.clone());
        let running = Running::serve(kit, &Setup::default(), None).await;
        assert!(!accepted(&running, &token(&running)).await, "{fault:?}");
        assert_eq!(server.hits(Endpoint::OpenidMetadata), 0, "{fault:?}");
        assert_eq!(
            server.hits(Endpoint::OpenidMetadataAppended),
            0,
            "{fault:?}"
        );
        assert_eq!(server.hits(Endpoint::Jwks), 0, "{fault:?}");
    }
}

#[tokio::test]
async fn the_document_must_name_this_issuer_and_an_https_key_set() {
    // Another issuer in the document: refused before any key set is fetched.
    let running = Running::start(Setup::default()).await;
    let server = running.kit.authorization_server();
    server.set_metadata_patch(Some(
        json!({ "issuer": "https://elsewhere.example.com/as" }),
    ));
    assert!(!accepted(&running, &token(&running)).await);
    assert_eq!(server.hits(Endpoint::Jwks), 0);

    // An `http` key set: refused without connecting to it.
    let running = Running::start(Setup::default()).await;
    let server = running.kit.authorization_server();
    server.set_metadata_patch(Some(
        json!({ "jwks_uri": server.plain_url(Endpoint::Jwks) }),
    ));
    assert!(!accepted(&running, &token(&running)).await);
    assert_eq!(server.plain_hits(Endpoint::Jwks), 0);
    assert_eq!(server.hits(Endpoint::Jwks), 0);

    // No key set at all.
    let running = Running::start(Setup::default()).await;
    let server = running.kit.authorization_server();
    server.set_metadata_patch(Some(json!({ "jwks_uri": null })));
    assert!(!accepted(&running, &token(&running)).await);
}

#[tokio::test]
async fn no_redirect_is_followed_and_bodies_are_capped() {
    for endpoint in [Endpoint::OauthMetadata, Endpoint::Jwks] {
        let running = Running::start(Setup::default()).await;
        let server = running.kit.authorization_server();
        server.set_fault(endpoint, Fault::Redirect);
        assert!(!accepted(&running, &token(&running)).await, "{endpoint:?}");
        assert_eq!(server.moved_hits(endpoint), 0, "{endpoint:?}");
        // A redirect is not a 404: the discovery stops there.
        assert_eq!(server.hits(Endpoint::OpenidMetadata), 0, "{endpoint:?}");

        let running = Running::start(Setup::default()).await;
        let server = running.kit.authorization_server();
        server.set_fault(endpoint, Fault::Oversize);
        assert!(!accepted(&running, &token(&running)).await, "{endpoint:?}");
    }
}

#[tokio::test]
async fn a_slow_issuer_fails_closed_at_the_time_limit() {
    let running = Running::start_with(Setup::default(), Some(Duration::from_millis(500))).await;
    let server = running.kit.authorization_server();
    server.set_fault(Endpoint::Jwks, Fault::Delay(Duration::from_secs(3)));
    let started = std::time::Instant::now();
    assert!(!accepted(&running, &token(&running)).await);
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn keys_are_cached_and_an_unknown_kid_refetches_at_most_once_a_minute() {
    let running = Running::start(Setup::default()).await;
    let server = running.kit.authorization_server();
    assert!(accepted(&running, &token(&running)).await);
    assert!(accepted(&running, &token(&running)).await);
    assert_eq!(
        server.hits(Endpoint::Jwks),
        1,
        "the second token used the cache"
    );

    // A key the cache lacks, a minute after the last fetch: one refetch, then accepted.
    let rotated = server.keys().rotate(KeyKind::P256).unwrap();
    running.clock.advance(61_000);
    let fresh = running.token().signing_key(&rotated).sign();
    assert!(accepted(&running, &fresh).await);
    assert_eq!(server.hits(Endpoint::Jwks), 2);

    // A stream of made-up kids within the minute fetches nothing.
    for n in 0..20 {
        let made_up = running
            .token()
            .header_member("kid", json!(format!("made-up-{n}")))
            .sign();
        assert!(!accepted(&running, &made_up).await);
    }
    assert_eq!(server.hits(Endpoint::Jwks), 2);
    // A real new key is not seen either until the minute has passed.
    let later = server.keys().rotate(KeyKind::P256).unwrap();
    let newest = running.token().signing_key(&later).sign();
    assert!(!accepted(&running, &newest).await);
    assert_eq!(server.hits(Endpoint::Jwks), 2);
    running.clock.advance(61_000);
    let newest = running.token().signing_key(&later).sign();
    assert!(accepted(&running, &newest).await);
    assert_eq!(server.hits(Endpoint::Jwks), 3);
}

#[tokio::test]
async fn the_last_good_keys_last_until_their_cache_ends_then_the_host_fails_closed() {
    let running = Running::start(Setup::default()).await;
    let server = running.kit.authorization_server();
    assert!(accepted(&running, &token(&running)).await);

    // The issuer fails. A refetch for an unknown kid fails, and the cached keys still serve.
    server.set_fault(Endpoint::Jwks, Fault::Status(503));
    running.clock.advance(61_000);
    let made_up = running
        .token()
        .header_member("kid", json!("made-up"))
        .sign();
    assert!(!accepted(&running, &made_up).await);
    assert_eq!(server.hits(Endpoint::Jwks), 2);
    assert!(accepted(&running, &token(&running)).await);

    // The cache (5 minutes without a max-age) ends: every token is refused, a known kid's too.
    running.clock.advance(5 * 60_000);
    assert!(!accepted(&running, &token(&running)).await);
    // And within the next minute nothing is fetched again, however many tokens arrive.
    let hits = server.hits(Endpoint::Jwks);
    for _ in 0..5 {
        assert!(!accepted(&running, &token(&running)).await);
    }
    assert_eq!(server.hits(Endpoint::Jwks), hits);

    // The issuer recovers: the next fetch, a minute later, serves again.
    server.clear_fault(Endpoint::Jwks);
    assert!(!accepted(&running, &token(&running)).await);
    running.clock.advance(61_000);
    assert!(accepted(&running, &token(&running)).await);
}

#[tokio::test]
async fn a_key_set_with_a_repeated_kid_is_unusable() {
    let running = Running::start(Setup::default()).await;
    let server = running.kit.authorization_server();
    let mut published = server.keys().published_jwks();
    let keys = published["keys"].as_array_mut().unwrap();
    let first = keys[0].clone();
    keys.push(first);
    server.keys().set_jwks_override(Some(published));
    assert!(!accepted(&running, &token(&running)).await);
}

#[tokio::test]
async fn a_caller_that_hangs_up_does_not_spend_the_minutes_fetch() {
    // The fetch outlives the request that started it: a client that disconnects mid-fetch must
    // not leave the issuer without keys for the rest of the minute (13.2, "JWKS refresh used to
    // deny service").
    let running = Running::start(Setup::default()).await;
    let server = running.kit.authorization_server();
    server.set_fault(Endpoint::Jwks, Fault::Delay(Duration::from_millis(1500)));
    let first = token(&running);
    let abandoned = tokio::time::timeout(
        Duration::from_millis(300),
        running.call(Some(&first), "fixture-whoami", json!({})),
    )
    .await;
    assert!(abandoned.is_err(), "the call should still be fetching");
    tokio::time::sleep(Duration::from_millis(2500)).await;
    server.clear_fault(Endpoint::Jwks);
    assert!(accepted(&running, &token(&running)).await);
    assert_eq!(server.hits(Endpoint::Jwks), 1);
}

// ─── An issuer's own roots (`ca_file`, amendment from step 2c) ──────────────────────────────

/// A served workspace whose identity provider `idp` also issues access tokens, and whose
/// authorization server `as` names `ca_file = "trust/as.pem"` holding `as_roots`. The kit's CA
/// stands among the platform's roots only when `kit_ca_is_a_platform_root`.
async fn with_ca_file(as_roots: Option<&str>, kit_ca_is_a_platform_root: bool) -> Running {
    let kit = umbel_testkit_idp::TestIdp::start().await.unwrap();
    let setup = Setup {
        issuer: "algorithms = [\"ES256\", \"RS256\"]\nca_file = \"trust/as.pem\"",
        ..Setup::default()
    };
    let text = support::oauth::config(&kit, &setup).replace(
        "access_tokens = false",
        "access_tokens = true\nalgorithms = [\"ES256\", \"RS256\"]",
    );
    let dir = support::workspace(&text);
    std::fs::create_dir_all(dir.path().join("trust")).unwrap();
    let roots = as_roots.map_or_else(|| kit.ca().certificate_pem().to_owned(), str::to_owned);
    std::fs::write(dir.path().join("trust/as.pem"), roots).unwrap();
    let clock = afd::fixed_clock(support::oauth::now_ms());
    let mut builder = umbel::HostBuilder::open(dir.path())
        .unwrap()
        .with_auth_clock(clock.clone())
        .register(support::oauth::whoami())
        .register(support::oauth::touch());
    if kit_ca_is_a_platform_root {
        builder =
            builder.with_auth_root_certificate(kit.ca().certificate_pem().as_bytes().to_vec());
    }
    let host = builder.seal().unwrap();
    let served = support::hosted::Served::start(&host).await;
    let client = support::hosted::Client::plain(served.address);
    Running {
        kit,
        dir,
        host,
        served,
        client,
        clock,
    }
}

/// A fresh token of the identity provider, which `with_ca_file` makes a token issuer too.
fn idp_token(running: &Running) -> String {
    running
        .kit
        .identity_provider()
        .access_token(support::hosted::PUBLIC_URL)
        .issued_at(running.now_s())
        .lifetime(300)
        .subject("ada")
        .scopes(["umbel:read", "umbel:write"])
        .sign()
}

#[tokio::test]
async fn a_private_ca_vouches_for_its_issuer_alone() {
    // The kit's CA is `as`'s ca_file and no platform root: `as` is reached through it, while
    // `idp`, which names no ca_file, is reached through the platform's roots alone, which do not
    // hold the kit's CA. The private root extends no trust to another issuer.
    let running = with_ca_file(None, false).await;
    assert!(accepted(&running, &token(&running)).await);
    assert!(!accepted(&running, &idp_token(&running)).await);
    assert_eq!(running.kit.identity_provider().hits(Endpoint::Jwks), 0);
}

#[tokio::test]
async fn a_ca_file_replaces_the_platforms_roots_for_its_issuer_and_no_other() {
    // The kit's CA is a platform root, and `as`'s ca_file holds another CA: `as` is refused
    // although the platform's roots would have reached it, and `idp` is unaffected.
    let other = umbel_testkit_idp::TestCa::new().unwrap();
    let running = with_ca_file(Some(other.certificate_pem()), true).await;
    assert!(!accepted(&running, &token(&running)).await);
    assert_eq!(running.kit.authorization_server().hits(Endpoint::Jwks), 0);
    assert!(accepted(&running, &idp_token(&running)).await);
}

#[tokio::test]
async fn a_ca_file_that_cannot_be_trusted_stops_the_server_before_it_starts() {
    let now = support::oauth::now_ms().div_euclid(1000);
    let expired = umbel_testkit_idp::TestCa::valid_between(now - 30 * 86_400, now - 86_400)
        .unwrap()
        .certificate_pem()
        .to_owned();
    let future = umbel_testkit_idp::TestCa::valid_between(now + 86_400, now + 30 * 86_400)
        .unwrap()
        .certificate_pem()
        .to_owned();
    for (roots, why) in [
        (Some(expired.as_str()), "expired"),
        (Some(future.as_str()), "not valid yet"),
        (Some("not a certificate\n"), "holds no PEM certificate"),
    ] {
        let kit = umbel_testkit_idp::TestIdp::start().await.unwrap();
        let setup = Setup {
            issuer: "algorithms = [\"ES256\", \"RS256\"]\nca_file = \"trust/as.pem\"",
            ..Setup::default()
        };
        let dir = support::workspace(&support::oauth::config(&kit, &setup));
        std::fs::create_dir_all(dir.path().join("trust")).unwrap();
        if let Some(roots) = roots {
            std::fs::write(dir.path().join("trust/as.pem"), roots).unwrap();
        }
        let host = umbel::HostBuilder::open(dir.path())
            .unwrap()
            .register(support::oauth::whoami())
            .register(support::oauth::touch())
            .seal()
            .unwrap();
        let Err(error) = host.http_server() else {
            panic!("refused");
        };
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{why}");
        assert!(error.message().contains(why), "{why}: {}", error.message());
        assert_eq!(
            error
                .into_result::<serde_json::Value>()
                .error
                .unwrap()
                .details
                .unwrap()["key"],
            json!("auth.issuers.as.ca_file"),
            "{why}"
        );
    }
    // A missing file too, without echoing anything but its path.
    let kit = umbel_testkit_idp::TestIdp::start().await.unwrap();
    let setup = Setup {
        issuer: "ca_file = \"trust/missing.pem\"",
        ..Setup::default()
    };
    let dir = support::workspace(&support::oauth::config(&kit, &setup));
    let host = umbel::HostBuilder::open(dir.path())
        .unwrap()
        .register(support::oauth::whoami())
        .register(support::oauth::touch())
        .seal()
        .unwrap();
    let Err(error) = host.http_server() else {
        panic!("refused");
    };
    assert!(
        error.message().contains("cannot be read"),
        "{}",
        error.message()
    );
}
