//! Shared drivers: HTTPS clients that trust only the kit's CA and follow no redirects, form posts,
//! the authorization flow, and AFD's `JwtVerifier` with a live key source that discovers each
//! issuer's JWKS through its RFC 8414 metadata.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;

use afd::server::auth::{
    AuthRefusal, Jwk, JwtIssuer, JwtVerifier, KeyError, KeySource, SigningAlgorithm, TokenRules,
};
use serde_json::Value;
use umbel_testkit_idp::{IssuedCertificate, Issuer, Pkce, TestIdp};

/// The resource (MCP endpoint) the tests' tokens are for.
pub const RESOURCE: &str = "https://umbel.test/mcp";

/// An HTTPS client trusting only the kit's CA, following no redirect.
pub fn client(kit: &TestIdp) -> reqwest::Client {
    builder(kit).build().unwrap()
}

/// The same, presenting `certificate` as its TLS client certificate.
pub fn client_with(kit: &TestIdp, certificate: &IssuedCertificate) -> reqwest::Client {
    let identity = reqwest::Identity::from_pem(certificate.identity_pem().as_bytes()).unwrap();
    builder(kit).identity(identity).build().unwrap()
}

/// The same, following redirects (to prove a client that follows them would be fooled).
pub fn following_client(kit: &TestIdp) -> reqwest::Client {
    builder(kit)
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .unwrap()
}

fn builder(kit: &TestIdp) -> reqwest::ClientBuilder {
    let ca = reqwest::Certificate::from_pem(kit.ca().certificate_pem().as_bytes()).unwrap();
    reqwest::Client::builder()
        .tls_certs_only([ca])
        .redirect(reqwest::redirect::Policy::none())
        .pool_max_idle_per_host(0)
}

/// A response's status, headers and body (JSON when it parses).
pub struct Reply {
    pub status: u16,
    pub headers: reqwest::header::HeaderMap,
    pub text: String,
    pub json: Value,
}

impl Reply {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|value| value.to_str().ok())
    }

    /// The `Location` header's query parameters.
    pub fn location_query(&self) -> HashMap<String, String> {
        let location = self.header("location").expect("a redirect");
        let url = url::Url::parse(location).unwrap();
        url.query_pairs().into_owned().collect()
    }
}

async fn reply(response: reqwest::Response) -> Reply {
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let text = response.text().await.unwrap();
    let json = serde_json::from_str(&text).unwrap_or(Value::Null);
    Reply {
        status,
        headers,
        text,
        json,
    }
}

pub async fn get(client: &reqwest::Client, url: &str) -> Reply {
    reply(client.get(url).send().await.unwrap()).await
}

/// How a form post authenticates its client.
pub enum Auth<'a> {
    None,
    Basic(&'a str, &'a str),
    Post(&'a str, &'a str),
}

pub fn form(pairs: &[(&str, &str)]) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (name, value) in pairs {
        serializer.append_pair(name, value);
    }
    serializer.finish()
}

pub async fn post_form(
    client: &reqwest::Client,
    url: &str,
    auth: Auth<'_>,
    pairs: &[(&str, &str)],
) -> Reply {
    let mut pairs: Vec<(&str, &str)> = pairs.to_vec();
    let mut request = client
        .post(url)
        .header("content-type", "application/x-www-form-urlencoded");
    match auth {
        Auth::None => {}
        Auth::Basic(id, secret) => request = request.basic_auth(id, Some(secret)),
        Auth::Post(id, secret) => {
            pairs.push(("client_id", id));
            pairs.push(("client_secret", secret));
        }
    }
    reply(request.body(form(&pairs)).send().await.unwrap()).await
}

/// One authorization request: the client, its redirect URI, PKCE, `state` and `nonce`.
pub struct Flow {
    pub client_id: String,
    pub secret: String,
    pub redirect_uri: String,
    pub pkce: Pkce,
    pub state: String,
    pub nonce: String,
}

impl Flow {
    pub fn new(client_id: &str, secret: &str, redirect_uri: &str) -> Self {
        Self {
            client_id: client_id.to_owned(),
            secret: secret.to_owned(),
            redirect_uri: redirect_uri.to_owned(),
            pkce: Pkce::new(),
            state: "state-1".to_owned(),
            nonce: "nonce-1".to_owned(),
        }
    }

    /// The authorization request's parameters, then `extra`.
    pub fn params<'a>(
        &'a self,
        scope: &'a str,
        extra: &[(&'a str, &'a str)],
    ) -> Vec<(&'a str, &'a str)> {
        let mut params = vec![
            ("response_type", "code"),
            ("client_id", self.client_id.as_str()),
            ("redirect_uri", self.redirect_uri.as_str()),
            ("scope", scope),
            ("state", self.state.as_str()),
            ("nonce", self.nonce.as_str()),
            ("code_challenge", self.pkce.challenge.as_str()),
            ("code_challenge_method", "S256"),
        ];
        params.extend_from_slice(extra);
        params
    }

    /// `GET` the authorization endpoint with these parameters.
    pub async fn authorize(
        &self,
        client: &reqwest::Client,
        issuer: &Issuer,
        params: &[(&str, &str)],
    ) -> Reply {
        let url = format!(
            "{}?{}",
            issuer.url(umbel_testkit_idp::Endpoint::Authorization),
            form(params)
        );
        get(client, &url).await
    }

    /// Redeem `code` at the token endpoint with the right verifier, then `extra`.
    pub async fn redeem(
        &self,
        client: &reqwest::Client,
        issuer: &Issuer,
        code: &str,
        extra: &[(&str, &str)],
    ) -> Reply {
        let mut pairs = vec![
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", self.redirect_uri.as_str()),
            ("code_verifier", self.pkce.verifier.as_str()),
        ];
        pairs.extend_from_slice(extra);
        post_form(
            client,
            &issuer.url(umbel_testkit_idp::Endpoint::Token),
            Auth::Basic(&self.client_id, &self.secret),
            &pairs,
        )
        .await
    }
}

/// An AFD key source that discovers `issuer`'s JWKS through its RFC 8414 metadata (no redirect
/// followed) and fetches it on every call, so rotation shows at once.
pub struct LiveKeys {
    client: reqwest::Client,
    metadata_url: String,
}

#[async_trait::async_trait]
impl KeySource for LiveKeys {
    async fn key(&self, _issuer: &str, kid: &str) -> Result<Jwk, KeyError> {
        let fetch = |url: String| {
            let client = self.client.clone();
            async move {
                let response = client.get(&url).send().await.ok()?;
                if !response.status().is_success() {
                    return None;
                }
                serde_json::from_str::<Value>(&response.text().await.ok()?).ok()
            }
        };
        let metadata = fetch(self.metadata_url.clone())
            .await
            .ok_or(KeyError::Unavailable)?;
        let jwks_uri = metadata["jwks_uri"].as_str().ok_or(KeyError::Unavailable)?;
        let jwks = fetch(jwks_uri.to_owned())
            .await
            .ok_or(KeyError::Unavailable)?;
        let keys = jwks["keys"].as_array().ok_or(KeyError::Unavailable)?;
        let key = keys
            .iter()
            .find(|key| key["kid"] == kid)
            .ok_or(KeyError::Unknown)?;
        Jwk::from_value(key.clone()).map_err(|_| KeyError::Unavailable)
    }
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

/// AFD's verifier for the kit's two issuers (aliases `idp` and `as`), every algorithm, keys
/// fetched live, tokens for [`RESOURCE`] under `rules`.
pub fn verifier_with(kit: &TestIdp, rules: TokenRules) -> JwtVerifier {
    let issuer = |alias: &str, role: &Issuer| {
        let keys = LiveKeys {
            client: client(kit),
            metadata_url: role.metadata_urls().oauth,
        };
        JwtIssuer::new(alias, role.issuer(), every_algorithm(), keys).unwrap()
    };
    JwtVerifier::new(
        rules,
        vec![
            issuer("idp", kit.identity_provider()),
            issuer("as", kit.authorization_server()),
        ],
    )
    .unwrap()
}

pub fn verifier(kit: &TestIdp) -> JwtVerifier {
    verifier_with(kit, TokenRules::new(RESOURCE).unwrap())
}

/// The rule code of a refusal.
pub fn rule<T: std::fmt::Debug>(result: Result<T, AuthRefusal>) -> &'static str {
    result.expect_err("the token was accepted").rule.as_str()
}
