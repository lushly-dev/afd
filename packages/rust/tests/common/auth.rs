//! Shared drivers for the `server-auth` tests: keys generated in the test, signed tokens, a
//! verifier, and requests through the bearer layer.
#![allow(dead_code)]

use std::sync::{Arc, OnceLock};

use afd::server::auth::{
    Authorization, ClientCertificate, JwtIssuer, JwtVerifier, ProtectedResource, SigningAlgorithm,
    StaticKeys, TokenRules,
};
use afd::server::{HttpOptions, McpServer};
use aws_lc_rs::rand::SystemRandom;
use aws_lc_rs::rsa::KeySize;
use aws_lc_rs::signature::{
    EcdsaKeyPair, Ed25519KeyPair, KeyPair, RsaKeyPair, RsaPublicKeyComponents,
    ECDSA_P256_SHA256_FIXED_SIGNING, ECDSA_P384_SHA384_FIXED_SIGNING, RSA_PKCS1_SHA256,
    RSA_PKCS1_SHA384, RSA_PKCS1_SHA512, RSA_PSS_SHA256, RSA_PSS_SHA384, RSA_PSS_SHA512,
};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use http_body_util::{BodyExt, Full};
use serde_json::{json, Value};
use tower::ServiceExt;

pub const ISSUER: &str = "https://auth.example.com";
pub const RESOURCE: &str = "https://todo.example.com/mcp";
pub const METADATA_URL: &str = "https://todo.example.com/.well-known/oauth-protected-resource/mcp";
/// The cases' `now`, in seconds.
pub const NOW: i64 = 1_793_016_000;

/// A signing key generated in the test.
pub enum TestKey {
    Rsa(RsaKeyPair),
    Ec256(EcdsaKeyPair),
    Ec384(EcdsaKeyPair),
    Ed25519(Ed25519KeyPair),
}

pub fn b64(bytes: impl AsRef<[u8]>) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

static RSA: OnceLock<TestKey> = OnceLock::new();
static RSA_OTHER: OnceLock<TestKey> = OnceLock::new();
static EC256: OnceLock<TestKey> = OnceLock::new();
static EC384: OnceLock<TestKey> = OnceLock::new();
static ED25519: OnceLock<TestKey> = OnceLock::new();

pub fn rsa() -> &'static TestKey {
    RSA.get_or_init(|| TestKey::Rsa(RsaKeyPair::generate(KeySize::Rsa2048).unwrap()))
}

/// A second RSA key, for signatures under the wrong key.
pub fn rsa_other() -> &'static TestKey {
    RSA_OTHER.get_or_init(|| TestKey::Rsa(RsaKeyPair::generate(KeySize::Rsa2048).unwrap()))
}

pub fn ec256() -> &'static TestKey {
    EC256.get_or_init(|| {
        TestKey::Ec256(EcdsaKeyPair::generate(&ECDSA_P256_SHA256_FIXED_SIGNING).unwrap())
    })
}

pub fn ec384() -> &'static TestKey {
    EC384.get_or_init(|| {
        TestKey::Ec384(EcdsaKeyPair::generate(&ECDSA_P384_SHA384_FIXED_SIGNING).unwrap())
    })
}

pub fn ed25519() -> &'static TestKey {
    ED25519.get_or_init(|| TestKey::Ed25519(Ed25519KeyPair::generate().unwrap()))
}

impl TestKey {
    /// The public JWK, with `kid`.
    pub fn jwk(&self, kid: &str) -> Value {
        match self {
            Self::Rsa(pair) => {
                let components = RsaPublicKeyComponents::<Vec<u8>>::from(pair.public_key());
                json!({ "kty": "RSA", "kid": kid, "n": b64(&components.n), "e": b64(&components.e) })
            }
            Self::Ec256(pair) | Self::Ec384(pair) => {
                let point = pair.public_key().as_ref();
                let size = (point.len() - 1) / 2;
                let crv = if size == 32 { "P-256" } else { "P-384" };
                json!({
                    "kty": "EC", "kid": kid, "crv": crv,
                    "x": b64(&point[1..=size]), "y": b64(&point[1 + size..]),
                })
            }
            Self::Ed25519(pair) => {
                json!({ "kty": "OKP", "kid": kid, "crv": "Ed25519", "x": b64(pair.public_key().as_ref()) })
            }
        }
    }

    /// Sign `message` with `alg`.
    pub fn sign(&self, alg: &str, message: &[u8]) -> Vec<u8> {
        let rng = SystemRandom::new();
        match self {
            Self::Rsa(pair) => {
                let padding: &'static dyn aws_lc_rs::signature::RsaEncoding = match alg {
                    "RS384" => &RSA_PKCS1_SHA384,
                    "RS512" => &RSA_PKCS1_SHA512,
                    "PS256" => &RSA_PSS_SHA256,
                    "PS384" => &RSA_PSS_SHA384,
                    "PS512" => &RSA_PSS_SHA512,
                    _ => &RSA_PKCS1_SHA256,
                };
                let mut signature = vec![0; pair.public_modulus_len()];
                pair.sign(padding, &rng, message, &mut signature).unwrap();
                signature
            }
            Self::Ec256(pair) | Self::Ec384(pair) => {
                pair.sign(&rng, message).unwrap().as_ref().to_vec()
            }
            Self::Ed25519(pair) => pair.sign(message).as_ref().to_vec(),
        }
    }
}

/// A header `{ alg, typ: "at+jwt", kid }`.
pub fn header(alg: &str, kid: &str) -> Value {
    json!({ "alg": alg, "typ": "at+jwt", "kid": kid })
}

/// Valid claims at [`NOW`].
pub fn claims() -> Value {
    json!({
        "iss": ISSUER,
        "aud": RESOURCE,
        "sub": "user-1",
        "client_id": "todo-agent",
        "jti": "j-1",
        "iat": NOW - 60,
        "exp": NOW + 3540,
        "scope": "todo:read todo:write",
    })
}

/// A compact JWS of the exact header and payload texts, signed by `key` with `alg`.
pub fn sign_raw(header: &str, payload: &str, key: &TestKey, alg: &str) -> String {
    let message = format!("{}.{}", b64(header), b64(payload));
    let signature = key.sign(alg, message.as_bytes());
    format!("{message}.{}", b64(signature))
}

/// A token for `header` and `claims`, signed by `key` with the header's `alg`.
pub fn sign(header: &Value, claims: &Value, key: &TestKey) -> String {
    let alg = header["alg"].as_str().unwrap_or("RS256").to_owned();
    sign_raw(&header.to_string(), &claims.to_string(), key, &alg)
}

/// A token for valid claims, signed by `key` with `alg` under `kid`.
pub fn valid_token(key: &TestKey, alg: &str, kid: &str) -> String {
    sign(&header(alg, kid), &claims(), key)
}

pub fn every_algorithm() -> Vec<SigningAlgorithm> {
    vec![
        SigningAlgorithm::RS256,
        SigningAlgorithm::RS384,
        SigningAlgorithm::RS512,
        SigningAlgorithm::PS256,
        SigningAlgorithm::PS384,
        SigningAlgorithm::PS512,
        SigningAlgorithm::ES256,
        SigningAlgorithm::ES384,
        SigningAlgorithm::EdDSA,
    ]
}

/// The JWKS of the test keys: `rsa`, `ec256`, `ec384`, `ed25519`.
pub fn jwks() -> Value {
    json!({ "keys": [
        rsa().jwk("rsa"),
        ec256().jwk("ec256"),
        ec384().jwk("ec384"),
        ed25519().jwk("ed25519"),
    ] })
}

pub fn rules() -> TokenRules {
    TokenRules::new(RESOURCE).unwrap()
}

/// A verifier of [`ISSUER`] (alias `auth`) with every algorithm and the test keys, at [`NOW`].
pub fn verifier_with(rules: TokenRules) -> JwtVerifier {
    let keys = StaticKeys::from_jwks(&jwks()).unwrap();
    let issuer = JwtIssuer::new("auth", ISSUER, every_algorithm(), keys).unwrap();
    JwtVerifier::new(rules, vec![issuer])
        .unwrap()
        .with_clock(afd::fixed_clock(NOW * 1000))
}

pub fn verifier() -> JwtVerifier {
    verifier_with(rules())
}

pub fn metadata() -> ProtectedResource {
    ProtectedResource::new(RESOURCE, [ISSUER])
        .unwrap()
        .with_scopes_supported(["todo:read"])
        .unwrap()
}

pub fn authorization() -> Authorization {
    Authorization::new(metadata(), verifier()).unwrap()
}

/// A response through the bearer layer.
pub struct Answer {
    pub status: u16,
    pub headers: http::HeaderMap,
    pub body: Value,
    pub text: String,
}

impl Answer {
    pub fn challenge(&self) -> &str {
        self.headers
            .get("www-authenticate")
            .map(|value| value.to_str().unwrap())
            .unwrap_or("")
    }
}

/// Send one request through `server`'s bearer layer and Streamable HTTP service.
pub async fn send(server: &McpServer, request: http::Request<Full<bytes::Bytes>>) -> Answer {
    let service = server
        .authorized_http_service(HttpOptions::default())
        .unwrap();
    send_to(service, request).await
}

/// Send one request to `service`.
pub async fn send_to<S, B>(service: S, request: http::Request<Full<bytes::Bytes>>) -> Answer
where
    S: tower::Service<http::Request<Full<bytes::Bytes>>, Response = http::Response<B>>,
    S::Error: std::fmt::Debug,
    B: http_body::Body,
    B::Error: std::fmt::Debug,
{
    let response = service.oneshot(request).await.unwrap();
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&bytes).to_string();
    let body = serde_json::from_str(&text).unwrap_or_else(|_| {
        text.lines()
            .find_map(|line| line.strip_prefix("data: "))
            .and_then(|data| serde_json::from_str(data).ok())
            .unwrap_or(Value::Null)
    });
    Answer {
        status,
        headers,
        body,
        text,
    }
}

/// A 2026-07-28 JSON-RPC POST of `method` with `params` to `/mcp`, with `token` as the bearer.
pub fn post(method: &str, params: Value, token: Option<&str>) -> http::Request<Full<bytes::Bytes>> {
    let mut params = params;
    params["_meta"] = serde_json::from_str(super::META).unwrap();
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let mut request = http::Request::post("/mcp")
        .header("host", "localhost")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2026-07-28")
        .header("mcp-method", method);
    if let Some(name) = params["name"].as_str() {
        request = request.header("mcp-name", name);
    }
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    request
        .body(Full::new(bytes::Bytes::from(body.to_string())))
        .unwrap()
}

/// A token for valid claims granting `scope` (`None`: no scope claim).
pub fn token_with_scope(scope: Option<&str>) -> String {
    let mut claims = claims();
    match scope {
        Some(scope) => claims["scope"] = json!(scope),
        None => {
            claims.as_object_mut().unwrap().remove("scope");
        }
    }
    sign(&header("ES256", "ec256"), &claims, ec256())
}

/// The thumbprint the layer would read for this certificate.
pub fn thumbprint(der: &[u8]) -> String {
    ClientCertificate::from_der(der).thumbprint().to_owned()
}

/// An `Arc` around anything, for resolver tests.
pub fn shared<T>(value: T) -> Arc<T> {
    Arc::new(value)
}
