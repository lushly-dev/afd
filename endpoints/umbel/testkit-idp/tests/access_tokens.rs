//! The kit's RFC 9068 access tokens against AFD's `JwtVerifier`, with keys discovered live through
//! the kit's metadata: every algorithm verifies, and every [`Break`] is refused with exactly the
//! rule it names, while the same token without the break is accepted.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::server::auth::{ClientCertificate, TokenRules};
use serde_json::json;
use support::{RESOURCE, rule, verifier, verifier_with};
use umbel_testkit_idp::{Algorithm, Break, Endpoint, Fault, KeyKind, TestIdp};

#[tokio::test]
async fn every_algorithm_verifies_and_the_claims_reach_the_credentials() {
    let kit = TestIdp::start().await.unwrap();
    let verifier = verifier(&kit);
    for algorithm in Algorithm::ALL {
        let token = kit
            .authorization_server()
            .access_token(RESOURCE)
            .algorithm(algorithm)
            .subject("bo")
            .client_id("agent-1")
            .scopes(["umbel:read", "umbel:write:alpha"])
            .claim("acr", json!("phr"))
            .claim("auth_time", json!(1_800_000_000))
            .sign();
        let credentials = verifier
            .verify_token(&token, None)
            .await
            .unwrap_or_else(|refusal| panic!("{algorithm}: {refusal:?}"));
        assert_eq!(credentials.issuer, kit.authorization_server().issuer());
        assert_eq!(credentials.subject, "bo");
        assert_eq!(credentials.client_id, "agent-1");
        assert_eq!(credentials.resource, RESOURCE);
        assert_eq!(credentials.scopes, ["umbel:read", "umbel:write:alpha"]);
        assert_eq!(credentials.acr.as_deref(), Some("phr"));
        assert_eq!(credentials.auth_time, Some(1_800_000_000));
    }
    // The identity provider's access tokens verify under its own issuer.
    let token = kit.identity_provider().access_token(RESOURCE).sign();
    let credentials = verifier.verify_token(&token, None).await.unwrap();
    assert_eq!(credentials.issuer, kit.identity_provider().issuer());
}

#[tokio::test]
async fn each_break_is_refused_with_its_rule_and_only_that_rule() {
    let kit = TestIdp::start().await.unwrap();
    let verifier = verifier(&kit);
    for algorithm in [Algorithm::ES256, Algorithm::RS256] {
        for broken in Break::ALL {
            let builder = || {
                kit.authorization_server()
                    .access_token(RESOURCE)
                    .algorithm(algorithm)
                    .scopes(["umbel:read"])
            };
            // The same token without the break is accepted.
            assert!(
                verifier.verify_token(&builder().sign(), None).await.is_ok(),
                "{algorithm} {broken:?}: the unbroken token"
            );
            let token = builder().break_rule(broken).sign();
            let result = verifier.verify_token(&token, None).await;
            assert_eq!(rule(result), broken.rule(), "{algorithm} {broken:?}");
        }
    }
}

#[tokio::test]
async fn certificate_bound_tokens_need_the_certificate() {
    let kit = TestIdp::start().await.unwrap();
    let certificate = kit.ca().client_certificate("agent-1").unwrap();
    let other = kit.ca().client_certificate("agent-2").unwrap();
    let token = kit
        .authorization_server()
        .access_token(RESOURCE)
        .certificate(&certificate)
        .sign();
    let verifier = verifier(&kit);
    let thumbprint = ClientCertificate::from_der(certificate.certificate_der());
    assert_eq!(thumbprint.thumbprint(), certificate.x5t_s256());
    let credentials = verifier
        .verify_token(&token, Some(thumbprint.thumbprint()))
        .await
        .unwrap();
    assert_eq!(
        credentials.certificate_thumbprint.as_deref(),
        Some(certificate.x5t_s256().as_str())
    );
    assert_eq!(rule(verifier.verify_token(&token, None).await), "binding");
    let wrong = ClientCertificate::from_der(other.certificate_der());
    assert_eq!(
        rule(
            verifier
                .verify_token(&token, Some(wrong.thumbprint()))
                .await
        ),
        "binding"
    );
    // An unbound token, where bound tokens are required.
    let strict = verifier_with(
        &kit,
        TokenRules::new(RESOURCE)
            .unwrap()
            .with_require_bound_tokens(true),
    );
    let unbound = kit.authorization_server().access_token(RESOURCE).sign();
    assert_eq!(
        rule(
            strict
                .verify_token(&unbound, Some(thumbprint.thumbprint()))
                .await
        ),
        "binding"
    );
}

#[tokio::test]
async fn rotation_retirement_and_an_unavailable_key_set() {
    let kit = TestIdp::start().await.unwrap();
    let server = kit.authorization_server();
    let verifier = verifier(&kit);
    let old_kid = server.keys().current_kid(KeyKind::P256);
    let old = server.access_token(RESOURCE).sign();
    let new_kid = server.keys().rotate(KeyKind::P256).unwrap();
    assert_ne!(old_kid, new_kid);
    let new = server.access_token(RESOURCE).sign();
    // Both keys are published after a rotation.
    assert!(verifier.verify_token(&old, None).await.is_ok());
    assert!(verifier.verify_token(&new, None).await.is_ok());
    let jwks = server.keys().jwks();
    let kids: Vec<&str> = jwks["keys"]
        .as_array()
        .unwrap()
        .iter()
        .map(|key| key["kid"].as_str().unwrap())
        .collect();
    assert!(kids.contains(&old_kid.as_str()) && kids.contains(&new_kid.as_str()));
    // A retired key is no longer published: its tokens are refused as an unknown key.
    assert!(server.keys().retire(&old_kid));
    assert!(!server.keys().is_published(&old_kid));
    assert_eq!(rule(verifier.verify_token(&old, None).await), "key");
    assert!(verifier.verify_token(&new, None).await.is_ok());
    // A builder can still sign with the retired key.
    let retired = server.access_token(RESOURCE).signing_key(&old_kid).sign();
    assert_eq!(rule(verifier.verify_token(&retired, None).await), "key");
    assert!(server.keys().republish(&old_kid));
    assert!(verifier.verify_token(&retired, None).await.is_ok());
    // A JWKS override replaces the document: an empty key set.
    server.keys().set_jwks_override(Some(json!({ "keys": [] })));
    assert_eq!(rule(verifier.verify_token(&new, None).await), "key");
    server.keys().set_jwks_override(None);
    // A key published with `use: enc` fails rule 3.
    let mut jwk = server.keys().public_jwk(&new_kid).unwrap();
    jwk["use"] = json!("enc");
    server
        .keys()
        .set_jwks_override(Some(json!({ "keys": [jwk] })));
    assert_eq!(rule(verifier.verify_token(&new, None).await), "key");
    server.keys().set_jwks_override(None);
    // A key set that cannot be fetched fails closed.
    server.set_fault(Endpoint::Jwks, Fault::Status(503));
    assert_eq!(rule(verifier.verify_token(&new, None).await), "unavailable");
    server.clear_fault(Endpoint::Jwks);
    assert!(verifier.verify_token(&new, None).await.is_ok());
}

#[tokio::test]
async fn a_redirected_key_set_is_not_followed() {
    let kit = TestIdp::start().await.unwrap();
    let server = kit.authorization_server();
    let verifier = verifier(&kit);
    let token = server.access_token(RESOURCE).sign();
    server.set_fault(Endpoint::Jwks, Fault::Redirect);
    assert_eq!(
        rule(verifier.verify_token(&token, None).await),
        "unavailable"
    );
    assert_eq!(server.moved_hits(Endpoint::Jwks), 0);
    server.set_fault(Endpoint::OauthMetadata, Fault::Redirect);
    server.clear_fault(Endpoint::Jwks);
    assert_eq!(
        rule(verifier.verify_token(&token, None).await),
        "unavailable"
    );
    assert_eq!(server.moved_hits(Endpoint::OauthMetadata), 0);
}

#[tokio::test]
async fn the_time_breaks_hold_from_a_skew_of_2_to_300_seconds() {
    let kit = TestIdp::start().await.unwrap();
    for skew in [2, 60, 300] {
        let verifier = verifier_with(
            &kit,
            TokenRules::new(RESOURCE)
                .unwrap()
                .with_clock_skew_s(skew)
                .unwrap(),
        );
        for broken in [
            Break::Expired,
            Break::NotYetValid,
            Break::NotBefore,
            Break::LifetimeTooLong,
            Break::ExpiresBeforeIssued,
        ] {
            let token = kit
                .authorization_server()
                .access_token(RESOURCE)
                .break_rule(broken)
                .sign();
            let result = verifier.verify_token(&token, None).await;
            assert_eq!(rule(result), broken.rule(), "skew {skew}: {broken:?}");
        }
    }
}

#[tokio::test]
async fn breaks_on_other_kinds_change_the_member_that_kind_has() {
    let kit = TestIdp::start().await.unwrap();
    let decode = |token: &str, part: usize| -> serde_json::Value {
        use base64::Engine;
        let part = token.split('.').nth(part).unwrap();
        serde_json::from_slice(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(part)
                .unwrap(),
        )
        .unwrap()
    };
    let id_token = kit
        .identity_provider()
        .id_token("ada", "client")
        .break_rule(Break::Typ)
        .sign();
    assert_eq!(decode(&id_token, 0)["typ"], "at+jwt");
    let assertion = kit
        .gateway()
        .assertion(RESOURCE, "POST")
        .break_rule(Break::Missing(umbel_testkit_idp::RequiredClaim::ClientId))
        .sign();
    assert!(decode(&assertion, 1).get("client").is_none());
    // MultipleAudiences appends to an array audience rather than nesting it.
    let token = kit
        .authorization_server()
        .access_token(RESOURCE)
        .audiences([RESOURCE])
        .break_rule(Break::MultipleAudiences)
        .sign();
    assert_eq!(
        decode(&token, 1)["aud"],
        json!([RESOURCE, "https://other.invalid/mcp"])
    );
}
