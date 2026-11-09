//! The gateway signer (phase 5 specification, section 4.4): the assertion's shape, its signature
//! under the pinned key set, its breaks, and the gateway's client certificate.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use jsonwebtoken::jwk::Jwk;
use jsonwebtoken::{DecodingKey, Validation};
use serde_json::{Value, json};
use support::{client_with, get};
use umbel_testkit_idp::{Algorithm, Break, Endpoint, KeyKind, TestIdp};

const PUBLIC_URL: &str = "https://umbel.test/mcp";

fn decode(token: &str, part: usize) -> Value {
    let part = token.split('.').nth(part).unwrap();
    serde_json::from_slice(&URL_SAFE_NO_PAD.decode(part).unwrap()).unwrap()
}

/// Verify the signature (and `exp`) against the pinned key set, as `jsonwebtoken` would.
fn verify(jwks: &Value, token: &str) -> Result<Value, jsonwebtoken::errors::Error> {
    let header = jsonwebtoken::decode_header(token)?;
    let key = jwks["keys"]
        .as_array()
        .unwrap()
        .iter()
        .find(|key| key["kid"].as_str() == header.kid.as_deref())
        .ok_or(jsonwebtoken::errors::ErrorKind::InvalidKeyFormat)?;
    let jwk: Jwk = serde_json::from_value(key.clone()).unwrap();
    let mut validation = Validation::new(header.alg);
    validation.set_audience(&[PUBLIC_URL]);
    jsonwebtoken::decode::<Value>(token, &DecodingKey::from_jwk(&jwk)?, &validation)
        .map(|data| data.claims)
}

#[tokio::test]
async fn an_assertion_has_the_shape_section_4_4_requires() {
    let kit = TestIdp::start().await.unwrap();
    let gateway = kit.gateway();
    assert_eq!(gateway.issuer(), format!("{}/gateway", kit.base_url()));
    let token = gateway
        .assertion(PUBLIC_URL, "POST")
        .subject("bo")
        .claim("client", json!("agent-7"))
        .scopes(["umbel:read", "umbel:write:alpha"])
        .sign();
    let header = decode(&token, 0);
    assert_eq!(header["typ"], "umbel-gw+jwt");
    assert_eq!(header["alg"], "ES256");
    assert_eq!(header["kid"], gateway.keys().current_kid(KeyKind::P256));
    let claims = verify(&gateway.jwks(), &token).unwrap();
    assert_eq!(claims["iss"], gateway.issuer());
    assert_eq!(claims["aud"], PUBLIC_URL);
    assert_eq!(claims["htu"], PUBLIC_URL);
    assert_eq!(claims["htm"], "POST");
    assert_eq!(claims["sub"], "bo");
    assert_eq!(claims["client"], "agent-7");
    assert_eq!(claims["scope"], "umbel:read umbel:write:alpha");
    assert_eq!(
        claims["exp"].as_i64().unwrap() - claims["iat"].as_i64().unwrap(),
        60
    );
    let jti = URL_SAFE_NO_PAD
        .decode(claims["jti"].as_str().unwrap())
        .unwrap();
    assert_eq!(jti.len() * 8, 128);
    // Two assertions never share a jti.
    let other = gateway.assertion(PUBLIC_URL, "POST").sign();
    assert_ne!(decode(&other, 1)["jti"], claims["jti"]);
    // Every algorithm signs under the pinned set.
    for algorithm in Algorithm::ALL {
        let token = gateway
            .assertion(PUBLIC_URL, "GET")
            .algorithm(algorithm)
            .sign();
        assert!(verify(&gateway.jwks(), &token).is_ok(), "{algorithm}");
    }
}

#[tokio::test]
async fn assertion_breaks_and_rotation() {
    let kit = TestIdp::start().await.unwrap();
    let gateway = kit.gateway();
    let jwks = gateway.jwks();
    let signed = |broken: Break| {
        gateway
            .assertion(PUBLIC_URL, "POST")
            .break_rule(broken)
            .sign()
    };
    for broken in [
        Break::Signature,
        Break::UnknownKid,
        Break::Expired,
        Break::Audience,
    ] {
        assert!(verify(&jwks, &signed(broken)).is_err(), "{broken:?}");
    }
    assert_eq!(decode(&signed(Break::Typ), 0)["typ"], "JWT");
    assert_eq!(
        decode(&signed(Break::Crit), 0)["crit"],
        json!(["x-testkit"])
    );
    // Fields a test changes one at a time: a wrong `htu` or `htm`, a short `jti`, a long life,
    // and presence claims Umbel must ignore.
    let token = gateway
        .assertion(PUBLIC_URL, "POST")
        .claim("htu", json!("https://umbel.test/other"))
        .claim("htm", json!("GET"))
        .jti("short")
        .lifetime(600)
        .claim("humanPresent", json!(true))
        .claim("acr", json!("phr"))
        .sign();
    let claims = decode(&token, 1);
    assert_eq!(claims["htu"], "https://umbel.test/other");
    assert_eq!(
        claims["exp"].as_i64().unwrap() - claims["iat"].as_i64().unwrap(),
        600
    );
    assert_eq!(claims["humanPresent"], true);
    // A rotated key is not in a key file written before the rotation.
    let kid = gateway.keys().rotate(KeyKind::P256).unwrap();
    let rotated = gateway.assertion(PUBLIC_URL, "POST").sign();
    assert_eq!(decode(&rotated, 0)["kid"], kid);
    assert!(verify(&jwks, &rotated).is_err());
    assert!(verify(&gateway.jwks(), &rotated).is_ok());
}

#[tokio::test]
async fn the_gateway_certificate_is_a_client_certificate_of_the_test_ca() {
    let kit = TestIdp::start().await.unwrap();
    let certificate = kit.gateway().certificate();
    // The kit's own listener accepts it as a client certificate (it chains to the CA, clientAuth).
    let reply = get(
        &client_with(&kit, certificate),
        &kit.authorization_server().url(Endpoint::Jwks),
    )
    .await;
    assert_eq!(reply.status, 200);
    let pin = certificate.sha256_hex();
    assert_eq!(pin.len(), 64);
    assert!(
        pin.bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    );
    let digest = URL_SAFE_NO_PAD.decode(certificate.x5t_s256()).unwrap();
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    assert_eq!(hex, pin);
    assert!(certificate.private_key_pem().contains("PRIVATE KEY"));
    assert!(certificate.certificate_pem().contains("BEGIN CERTIFICATE"));
}
