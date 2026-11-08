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
