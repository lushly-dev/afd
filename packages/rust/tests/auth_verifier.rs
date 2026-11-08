//! `spec/authorization.md` M3: AFD's JWT verifier, one test per rule, each with a token signed by
//! a key generated here and built to break only that rule. RSA (PKCS #1 v1.5 and PSS), EC P-256
//! and P-384, and Ed25519.
#![cfg(feature = "server-auth")]

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use afd::server::auth::{
    check_claims, check_introspection, AuthRefusal, ClientCertificate, Credentials, Jwk, JwtIssuer,
    JwtVerifier, KeyError, KeySource, RuleCode, SigningAlgorithm, StaticKeys, TokenRules,
    TokenVerifier,
};
use async_trait::async_trait;
use common::auth::*;
use serde_json::{json, Value};

async fn refused(token: &str) -> RuleCode {
    refused_by(&verifier(), token).await
}

async fn refused_by(verifier: &JwtVerifier, token: &str) -> RuleCode {
    match verifier.verify_token(token, None).await {
        Ok(credentials) => panic!("accepted: {credentials:?}"),
        Err(refusal) => refusal.rule,
    }
}

async fn accepted(token: &str) -> Credentials {
    verifier().verify_token(token, None).await.unwrap()
}

/// `claims()` with `change` applied, signed by the EC P-256 key.
fn token_with(change: impl FnOnce(&mut serde_json::Map<String, Value>)) -> String {
    let mut claims = claims();
    change(claims.as_object_mut().unwrap());
    sign(&header("ES256", "ec256"), &claims, ec256())
}

/// A header with `change` applied, over valid claims, signed by the RSA key with RS256.
fn header_with(change: impl FnOnce(&mut serde_json::Map<String, Value>)) -> String {
    let mut header = header("RS256", "rsa");
    change(header.as_object_mut().unwrap());
    sign_raw(&header.to_string(), &claims().to_string(), rsa(), "RS256")
}

// ─── Every algorithm and key type verifies ───────────────────────────────────────────────────

#[tokio::test]
async fn every_algorithm_verifies_with_its_key() {
    for (alg, kid, key) in [
        ("RS256", "rsa", rsa()),
        ("RS384", "rsa", rsa()),
        ("RS512", "rsa", rsa()),
        ("PS256", "rsa", rsa()),
        ("PS384", "rsa", rsa()),
        ("PS512", "rsa", rsa()),
        ("ES256", "ec256", ec256()),
        ("ES384", "ec384", ec384()),
        ("EdDSA", "ed25519", ed25519()),
    ] {
        let credentials = accepted(&valid_token(key, alg, kid)).await;
        assert_eq!(credentials.subject, "user-1", "{alg}");
        assert_eq!(credentials.client_id, "todo-agent");
        assert_eq!(credentials.issuer, ISSUER);
        assert_eq!(credentials.resource, RESOURCE);
        assert_eq!(credentials.scopes, ["todo:read", "todo:write"]);
        assert_eq!(credentials.issued_at, NOW - 60);
        assert_eq!(credentials.expires_at, NOW + 3540);
    }
}

// ─── Rule 1: route by shape ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn rule_1_a_jws_from_an_unconfigured_issuer_is_unknown() {
    let token = token_with(|claims| {
        claims.insert("iss".into(), json!("https://other.example.com"));
    });
    assert_eq!(refused(&token).await, RuleCode::UnknownIssuer);
    // The issuer is compared exactly: a trailing slash is another issuer.
    let token = token_with(|claims| {
        claims.insert("iss".into(), json!("https://auth.example.com/"));
    });
    assert_eq!(refused(&token).await, RuleCode::UnknownIssuer);
}

#[tokio::test]
async fn rule_1_an_opaque_token_without_introspection_is_unknown() {
    assert_eq!(refused("opaque-token~value").await, RuleCode::UnknownIssuer);
    let parts = http::Request::new(()).into_parts().0;
    let refusal = verifier().verify("opaque-token", &parts).await.unwrap_err();
    assert_eq!(refusal.rule, RuleCode::UnknownIssuer);
    assert_eq!(refusal.issuer, None);
}

/// A host introspection verifier that records every token it is sent.
struct Introspection {
    calls: AtomicUsize,
    answer: Value,
}

#[async_trait]
impl TokenVerifier for Introspection {
    async fn verify(
        &self,
        _token: &str,
        request: &http::request::Parts,
    ) -> Result<Credentials, AuthRefusal> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let certificate = request
            .extensions
            .get::<ClientCertificate>()
            .map(ClientCertificate::thumbprint);
        check_introspection(&self.answer, ISSUER, &rules(), NOW, certificate)
            .map_err(|rule| AuthRefusal::new(rule).with_issuer("introspection"))
    }
}

#[tokio::test]
async fn rule_1_opaque_tokens_go_to_introspection_and_jws_never_do() {
    let mut answer = claims();
    answer["active"] = json!(true);
    let introspection = Arc::new(Introspection {
        calls: AtomicUsize::new(0),
        answer,
    });
    let verifier = verifier().with_introspection(Arc::clone(&introspection));
    let parts = http::Request::new(()).into_parts().0;
    let credentials = verifier.verify("opaque-token", &parts).await.unwrap();
    assert_eq!(credentials.subject, "user-1");
    assert_eq!(introspection.calls.load(Ordering::SeqCst), 1);
    // A JWS from an unknown issuer is never sent to the introspection issuer.
    let foreign = token_with(|claims| {
        claims.insert("iss".into(), json!("https://other.example.com"));
    });
    let refusal = verifier.verify(&foreign, &parts).await.unwrap_err();
    assert_eq!(refusal.rule, RuleCode::UnknownIssuer);
    assert_eq!(introspection.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn rule_1_a_payload_that_is_not_one_json_object_is_unknown() {
    let header = header("ES256", "ec256").to_string();
    // A repeated member is refused, never read as its last value.
    let payload = claims()
        .to_string()
        .replacen('{', "{\"iss\":\"https://evil.example\",", 1);
    let token = sign_raw(&header, &payload, ec256(), "ES256");
    assert_eq!(refused(&token).await, RuleCode::UnknownIssuer);
    let token = sign_raw(&header, "[1]", ec256(), "ES256");
    assert_eq!(refused(&token).await, RuleCode::UnknownIssuer);
}

// ─── Rule 2: the header ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn rule_2_typ() {
    let token = header_with(|header| {
        header.insert("typ".into(), json!("JWT"));
    });
    assert_eq!(refused(&token).await, RuleCode::Typ);
    let token = header_with(|header| {
        header.remove("typ");
    });
    assert_eq!(refused(&token).await, RuleCode::Typ);
    // A media type compares ignoring ASCII case.
    let token = header_with(|header| {
        header.insert("typ".into(), json!("Application/AT+JWT"));
    });
    accepted(&token).await;
    // A header that repeats a member is not read.
    let token = sign_raw(
        r#"{"alg":"RS256","typ":"at+jwt","kid":"rsa","typ":"JWT"}"#,
        &claims().to_string(),
        rsa(),
        "RS256",
    );
    assert_eq!(refused(&token).await, RuleCode::Typ);
}

#[tokio::test]
async fn rule_2_alg() {
    // `none`, with an empty signature.
    let header = json!({ "alg": "none", "typ": "at+jwt", "kid": "rsa" }).to_string();
    let token = format!("{}.{}.", b64(&header), b64(claims().to_string()));
    assert_eq!(refused(&token).await, RuleCode::Alg);
    // HS256, its MAC keyed with the RSA key's published modulus (the key confusion attack).
    let header = json!({ "alg": "HS256", "typ": "at+jwt", "kid": "rsa" }).to_string();
    let message = format!("{}.{}", b64(&header), b64(claims().to_string()));
    let public = rsa().jwk("rsa")["n"].as_str().unwrap().to_owned();
    let key = aws_lc_rs::hmac::Key::new(aws_lc_rs::hmac::HMAC_SHA256, public.as_bytes());
    let mac = aws_lc_rs::hmac::sign(&key, message.as_bytes());
    let token = format!("{message}.{}", b64(mac.as_ref()));
    assert_eq!(refused(&token).await, RuleCode::Alg);
    // An algorithm the issuer does not list.
    let keys = StaticKeys::from_jwks(&jwks()).unwrap();
    let rs256_only = JwtIssuer::new("auth", ISSUER, [SigningAlgorithm::RS256], keys).unwrap();
    let narrow = JwtVerifier::new(rules(), vec![rs256_only])
        .unwrap()
        .with_clock(afd::fixed_clock(NOW * 1000));
    assert_eq!(
        refused_by(&narrow, &valid_token(ec256(), "ES256", "ec256")).await,
        RuleCode::Alg
    );
    // ES512 is never listed: the backend cannot verify it.
    let token = header_with(|header| {
        header.insert("alg".into(), json!("ES512"));
    });
    assert_eq!(refused(&token).await, RuleCode::Alg);
}

#[tokio::test]
async fn rule_2_kid() {
    let token = header_with(|header| {
        header.remove("kid");
    });
    assert_eq!(refused(&token).await, RuleCode::Kid);
    let token = header_with(|header| {
        header.insert("kid".into(), json!(""));
    });
    assert_eq!(refused(&token).await, RuleCode::Kid);
}

#[tokio::test]
async fn rule_2_crit() {
    let token = header_with(|header| {
        header.insert("crit".into(), json!(["exp"]));
    });
    assert_eq!(refused(&token).await, RuleCode::Crit);
}

#[tokio::test]
async fn rule_2_key_references() {
    for (member, value) in [
        ("jku", json!("https://attacker.example/jwks.json")),
        ("x5u", json!("https://attacker.example/cert.pem")),
        ("x5c", json!(["MIIB"])),
        ("jwk", rsa_other().jwk("rsa")),
    ] {
        let token = header_with(|header| {
            header.insert(member.into(), value);
        });
        assert_eq!(refused(&token).await, RuleCode::KeyReference, "{member}");
    }
}

// ─── Rule 3: the key ─────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn rule_3_an_unknown_kid() {
    assert_eq!(
        refused(&valid_token(rsa(), "RS256", "nope")).await,
        RuleCode::Key
    );
}

#[tokio::test]
async fn rule_3_the_key_must_fit_the_header() {
    // An RSA algorithm naming an EC key.
    assert_eq!(
        refused(&valid_token(ec256(), "RS256", "ec256")).await,
        RuleCode::Key
    );
    // ES256 naming the P-384 key.
    assert_eq!(
        refused(&valid_token(ec384(), "ES256", "ec384")).await,
        RuleCode::Key
    );
    // EdDSA naming an RSA key.
    assert_eq!(
        refused(&valid_token(rsa(), "EdDSA", "rsa")).await,
        RuleCode::Key
    );
}

async fn refused_with_key(jwk: Value) -> RuleCode {
    let keys = StaticKeys::from_jwks(&json!({ "keys": [jwk] })).unwrap();
    let issuer = JwtIssuer::new("auth", ISSUER, every_algorithm(), keys).unwrap();
    let verifier = JwtVerifier::new(rules(), vec![issuer])
        .unwrap()
        .with_clock(afd::fixed_clock(NOW * 1000));
    refused_by(&verifier, &valid_token(rsa(), "RS256", "rsa")).await
}

#[tokio::test]
async fn rule_3_alg_use_and_key_ops_on_the_key() {
    let mut key = rsa().jwk("rsa");
    key["alg"] = json!("PS256");
    assert_eq!(refused_with_key(key).await, RuleCode::Key);
    let mut key = rsa().jwk("rsa");
    key["use"] = json!("enc");
    assert_eq!(refused_with_key(key).await, RuleCode::Key);
    let mut key = rsa().jwk("rsa");
    key["key_ops"] = json!(["sign"]);
    assert_eq!(refused_with_key(key).await, RuleCode::Key);
    // Unusable material: a modulus that is not base64url.
    let mut key = rsa().jwk("rsa");
    key["n"] = json!("not base64url!");
    assert_eq!(refused_with_key(key).await, RuleCode::Key);
}

#[tokio::test]
async fn rule_3_an_ed448_key_is_refused() {
    let keys = StaticKeys::from_jwks(&json!({ "keys": [
        { "kty": "OKP", "kid": "ed448", "crv": "Ed448", "x": b64([7u8; 57]) },
    ] }))
    .unwrap();
    let issuer = JwtIssuer::new("auth", ISSUER, every_algorithm(), keys).unwrap();
    let verifier = JwtVerifier::new(rules(), vec![issuer])
        .unwrap()
        .with_clock(afd::fixed_clock(NOW * 1000));
    let token = valid_token(ed25519(), "EdDSA", "ed448");
    assert_eq!(refused_by(&verifier, &token).await, RuleCode::Key);
}

/// A key source that cannot answer.
struct Down;

#[async_trait]
impl KeySource for Down {
    async fn key(&self, _issuer: &str, _kid: &str) -> Result<Jwk, KeyError> {
        Err(KeyError::Unavailable)
    }
}

#[tokio::test]
async fn rule_3_a_key_source_that_cannot_answer_fails_closed() {
    let issuer = JwtIssuer::new("auth", ISSUER, every_algorithm(), Down).unwrap();
    let verifier = JwtVerifier::new(rules(), vec![issuer])
        .unwrap()
        .with_clock(afd::fixed_clock(NOW * 1000));
    let refusal = verifier
        .verify_token(&valid_token(rsa(), "RS256", "rsa"), None)
        .await
        .unwrap_err();
    assert_eq!(refusal.rule, RuleCode::Unavailable);
    assert_eq!(refusal.issuer.as_deref(), Some("auth"));
}

// ─── Rule 4: the signature ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn rule_4_signature() {
    // Signed by another key under the same kid.
    assert_eq!(
        refused(&valid_token(rsa_other(), "RS256", "rsa")).await,
        RuleCode::Signature
    );
    // A payload changed after signing.
    let token = valid_token(ed25519(), "EdDSA", "ed25519");
    let parts: Vec<&str> = token.split('.').collect();
    let mut changed = claims();
    changed["sub"] = json!("user-2");
    let forged = format!("{}.{}.{}", parts[0], b64(changed.to_string()), parts[2]);
    assert_eq!(refused(&forged).await, RuleCode::Signature);
    // PS256 signed, RS256 claimed.
    let header = header("RS256", "rsa").to_string();
    let token = sign_raw(&header, &claims().to_string(), rsa(), "PS256");
    assert_eq!(refused(&token).await, RuleCode::Signature);
    // A signature that is not base64url.
    let token = format!("{}.{}.{}", parts[0], parts[1], "AAAA");
    assert_eq!(refused(&token).await, RuleCode::Signature);
}

// ─── Rule 5: the issuer ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn rule_5_issuer() {
    // A JWS reaches rule 5 only through the issuer its `iss` names exactly, so rule 5 is checked
    // where a host applies it: an introspection answer and the shared claim rules.
    let mut answer = claims();
    answer["active"] = json!(true);
    answer["iss"] = json!("https://other.example.com");
    assert_eq!(
        check_introspection(&answer, ISSUER, &rules(), NOW, None),
        Err(RuleCode::Issuer)
    );
    let mut claims = claims();
    claims["iss"] = json!(42);
    assert_eq!(
        check_claims(claims.as_object().unwrap(), ISSUER, &rules(), NOW, None),
        Err(RuleCode::Issuer)
    );
}

// ─── Rule 6: the audience ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn rule_6_audience() {
    for aud in [
        json!("https://other.example.com/mcp"),
        json!([RESOURCE, "https://other.example.com/mcp"]),
        json!("https://todo.example.com/mcp/"),
        json!(null),
    ] {
        let token = token_with(|claims| {
            claims.insert("aud".into(), aud.clone());
        });
        assert_eq!(refused(&token).await, RuleCode::Audience, "{aud}");
    }
    let token = token_with(|claims| {
        claims.remove("aud");
    });
    assert_eq!(refused(&token).await, RuleCode::Audience);
    let token = token_with(|claims| {
        claims.insert("aud".into(), json!(["HTTPS://TODO.example.com/mcp"]));
    });
    accepted(&token).await;
}

// ─── Rule 7: the required claims ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn rule_7_claims() {
    for missing in ["exp", "iat", "jti", "sub", "client_id"] {
        let token = token_with(|claims| {
            claims.remove(missing);
        });
        assert_eq!(refused(&token).await, RuleCode::Claims, "no {missing}");
    }
    for (claim, value) in [
        ("sub", json!("")),
        ("sub", json!("u".repeat(256))),
        ("sub", json!("user\u{7}1")),
        ("client_id", json!(null)),
        ("jti", json!(7)),
        ("exp", json!("1793019540")),
        ("nbf", json!(true)),
        ("auth_time", json!("yesterday")),
        ("acr", json!("a".repeat(256))),
    ] {
        let token = token_with(|claims| {
            claims.insert(claim.into(), value.clone());
        });
        assert_eq!(refused(&token).await, RuleCode::Claims, "{claim}: {value}");
    }
    let token = token_with(|claims| {
        claims.insert("sub".into(), json!("é".repeat(255)));
        claims.insert("auth_time".into(), json!(NOW - 120));
        claims.insert("acr".into(), json!("phr"));
    });
    let credentials = accepted(&token).await;
    assert_eq!(credentials.auth_time, Some(NOW - 120));
    assert_eq!(credentials.acr.as_deref(), Some("phr"));
}

// ─── Rule 8: time ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn rule_8_expired() {
    let token = token_with(|claims| {
        claims.insert("iat".into(), json!(NOW - 3660));
        claims.insert("exp".into(), json!(NOW - 60));
    });
    assert_eq!(refused(&token).await, RuleCode::Expired);
    let token = token_with(|claims| {
        claims.insert("iat".into(), json!(NOW - 3659));
        claims.insert("exp".into(), json!(NOW - 59));
    });
    accepted(&token).await;
}

#[tokio::test]
async fn rule_8_not_yet_valid() {
    let token = token_with(|claims| {
        claims.insert("iat".into(), json!(NOW + 61));
        claims.insert("exp".into(), json!(NOW + 3600));
    });
    assert_eq!(refused(&token).await, RuleCode::NotYetValid);
    let token = token_with(|claims| {
        claims.insert("nbf".into(), json!(NOW + 61));
    });
    assert_eq!(refused(&token).await, RuleCode::NotYetValid);
    let token = token_with(|claims| {
        claims.insert("nbf".into(), json!(NOW + 60));
    });
    accepted(&token).await;
}

#[tokio::test]
async fn rule_8_lifetime() {
    let token = token_with(|claims| {
        claims.insert("iat".into(), json!(NOW - 60));
        claims.insert("exp".into(), json!(NOW + 3541));
    });
    assert_eq!(refused(&token).await, RuleCode::Lifetime);
    // The skew and the lifetime are configured, never defaulted by the library.
    let strict = verifier_with(
        rules()
            .with_clock_skew_s(0)
            .unwrap()
            .with_max_token_lifetime_s(600)
            .unwrap(),
    );
    let token = token_with(|claims| {
        claims.insert("iat".into(), json!(NOW - 60));
        claims.insert("exp".into(), json!(NOW + 600));
    });
    assert_eq!(refused_by(&strict, &token).await, RuleCode::Lifetime);
    let token = token_with(|claims| {
        claims.insert("iat".into(), json!(NOW + 1));
        claims.insert("exp".into(), json!(NOW + 500));
    });
    assert_eq!(refused_by(&strict, &token).await, RuleCode::NotYetValid);
}

// ─── Rule 9: scopes ──────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn rule_9_scope_malformed() {
    for scope in [
        json!("todo:read  todo:write"),
        json!(["todo:read"]),
        json!(null),
    ] {
        let token = token_with(|claims| {
            claims.insert("scope".into(), scope.clone());
        });
        assert_eq!(refused(&token).await, RuleCode::ScopeMalformed, "{scope}");
    }
}

#[tokio::test]
async fn rule_9_scopes_too_many() {
    let many: Vec<String> = (1..=65).map(|n| format!("todo:s{n}")).collect();
    let token = token_with(|claims| {
        claims.insert("scope".into(), json!(many.join(" ")));
    });
    assert_eq!(refused(&token).await, RuleCode::ScopesTooMany);
    // Under a prefix, only its scopes count.
    let prefixed = verifier_with(rules().with_scope_prefix("other").unwrap());
    let credentials = prefixed.verify_token(&token, None).await.unwrap();
    assert_eq!(credentials.scopes.len(), 65);
}

// ─── Rule 10: binding ────────────────────────────────────────────────────────────────────────

fn parts_with_certificate(der: Option<&[u8]>) -> http::request::Parts {
    let mut parts = http::Request::new(()).into_parts().0;
    if let Some(der) = der {
        parts.extensions.insert(ClientCertificate::from_der(der));
    }
    parts
}

#[tokio::test]
async fn rule_10_dpop_is_refused() {
    let token = token_with(|claims| {
        claims.insert(
            "cnf".into(),
            json!({ "jkt": "0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I" }),
        );
    });
    assert_eq!(refused(&token).await, RuleCode::DpopUnsupported);
}

#[tokio::test]
async fn rule_10_certificate_binding() {
    let certificate = b"a test client certificate (DER)";
    let token = token_with(|claims| {
        claims.insert("cnf".into(), json!({ "x5t#S256": thumbprint(certificate) }));
    });
    let verifier = verifier();
    let credentials = verifier
        .verify(&token, &parts_with_certificate(Some(certificate)))
        .await
        .unwrap();
    assert_eq!(
        credentials.certificate_thumbprint.as_deref(),
        Some(thumbprint(certificate).as_str())
    );
    let other = verifier
        .verify(
            &token,
            &parts_with_certificate(Some(b"another certificate")),
        )
        .await
        .unwrap_err();
    assert_eq!(other.rule, RuleCode::Binding);
    let none = verifier
        .verify(&token, &parts_with_certificate(None))
        .await
        .unwrap_err();
    assert_eq!(none.rule, RuleCode::Binding);
}

#[tokio::test]
async fn rule_10_bound_tokens_required() {
    let bound = verifier_with(rules().with_require_bound_tokens(true));
    let refusal = bound
        .verify(
            &valid_token(rsa(), "RS256", "rsa"),
            &parts_with_certificate(Some(b"cert")),
        )
        .await
        .unwrap_err();
    assert_eq!(refusal.rule, RuleCode::Binding);
}

// ─── Introspection ───────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn introspection_inactive_and_missing_fields() {
    let mut answer = claims();
    answer["active"] = json!(false);
    assert_eq!(
        check_introspection(&answer, ISSUER, &rules(), NOW, None),
        Err(RuleCode::Inactive)
    );
    let mut answer = claims();
    answer["active"] = json!(true);
    answer.as_object_mut().unwrap().remove("client_id");
    assert_eq!(
        check_introspection(&answer, ISSUER, &rules(), NOW, None),
        Err(RuleCode::Claims)
    );
}

// ─── Configuration ───────────────────────────────────────────────────────────────────────────

#[test]
fn configuration_is_checked() {
    let keys = || StaticKeys::from_jwks(&jwks()).unwrap();
    assert!(JwtIssuer::new("", ISSUER, every_algorithm(), keys()).is_err());
    assert!(JwtIssuer::new("a b", ISSUER, every_algorithm(), keys()).is_err());
    assert!(JwtIssuer::new("auth", "http://auth.example.com", every_algorithm(), keys()).is_err());
    assert!(JwtIssuer::new("auth", ISSUER, [], keys()).is_err());
    assert!(JwtVerifier::new(rules(), vec![]).is_err());
    let issuer = JwtIssuer::new("auth", ISSUER, every_algorithm(), keys()).unwrap();
    let again = JwtIssuer::new("again", ISSUER, every_algorithm(), keys()).unwrap();
    assert!(JwtVerifier::new(rules(), vec![issuer, again]).is_err());
    assert!(StaticKeys::from_jwks(&json!({ "keys": [{ "kty": "RSA" }] })).is_err());
    assert!(StaticKeys::from_jwks(&json!({
        "keys": [rsa().jwk("k"), ec256().jwk("k")]
    }))
    .is_err());
    assert!(TokenRules::new(RESOURCE)
        .unwrap()
        .with_clock_skew_s(301)
        .is_err());
}

#[test]
fn refusals_and_debug_output_never_hold_the_token() {
    let token = valid_token(rsa(), "RS256", "rsa");
    let credentials = Credentials::new(ISSUER, "user-1", "todo-agent", RESOURCE, 1, 2);
    let printed = format!("{credentials:?} {:?}", AuthRefusal::new(RuleCode::Key));
    assert!(!printed.contains(&token));
    assert!(!printed.contains("user-1"));
    assert!(!printed.contains("todo-agent"));
    assert_eq!(
        format!("{:?}", ClientCertificate::from_der(b"x")),
        "ClientCertificate([redacted])"
    );
    for rule in RuleCode::ALL {
        assert_eq!(RuleCode::from_name(rule.as_str()), Some(rule));
    }
}
