//! The introspection issuer (phase 5 specification, section 3.2 rule 12; RFC 7662): the one
//! issuer configured `verify = "introspection"`, asked about every token that is not a compact
//! JWS.
//!
//! - **The endpoint** is the issuer's verified metadata's `introspection_endpoint`, found as
//!   [`super::keys`] finds keys (the same discovery order, issuer check and fetching rules), and
//!   cached as metadata is: 5 minutes to 24 hours, at most one discovery a minute.
//! - **Umbel authenticates** with its own client credentials (`introspection.client_id`, and the
//!   secret in `client_secret_env`), as RFC 6749 2.3.1's `client_secret_basic`.
//! - **The answer** passes AFD's `check_introspection`: `active: true`, and `exp`, `iat`, `iss`,
//!   `aud`, `sub` and `client_id` present, then rules 5 to 10. A token is only ever sent to this
//!   issuer, and only when it is not a JWS.
//! - **The cache** keeps an accepted answer under the token's SHA-256 until the earlier of its
//!   `exp` and 60 seconds, and checks it again on every use (the time, and the certificate the
//!   new request presents); a refused or failed answer is never cached. It holds at most 4096
//!   answers, in memory only.
//! - **Bounds:** a token over 4096 bytes is `token-malformed` and sent nowhere, and at most 32
//!   requests are in flight at once; past that a token is `unavailable`, never queued.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use afd::server::auth::{RuleCode, TokenRules, check_introspection};
use afd::{Clock, Credentials};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use reqwest::header::HeaderValue;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use super::fetch::{AuthEnvironment, Fetcher};
use super::keys::{DiscoveryError, cache_ms, discover, metadata_url};

/// How long an accepted answer is reused at most: 60 seconds.
pub(crate) const CACHE_MS: i64 = 60 * 1000;
/// The most answers cached.
pub(crate) const MAX_CACHED: usize = 4096;
/// The most introspection requests in flight at once; past it a token is `unavailable` rather
/// than queued, so a flood of made-up tokens cannot spend Umbel's credentials at the endpoint.
pub(crate) const MAX_IN_FLIGHT: usize = 32;
/// The longest token sent to the endpoint, in bytes; a longer one is `token-malformed` and sent
/// nowhere.
pub(crate) const MAX_TOKEN_BYTES: usize = 4096;

/// A cached, accepted answer.
struct Answer {
    response: Value,
    until_ms: i64,
}

/// The discovered endpoint.
struct Endpoint {
    url: String,
    until_ms: i64,
}

#[derive(Default)]
struct State {
    endpoint: Option<Endpoint>,
    last_discovery_ms: Option<i64>,
    answers: HashMap<[u8; 32], Answer>,
}

/// The introspection client of one issuer.
pub(crate) struct Introspector {
    alias: String,
    issuer: String,
    authorization: HeaderValue,
    rules: TokenRules,
    fetcher: Fetcher,
    clock: Arc<dyn Clock>,
    timeout: std::time::Duration,
    state: Arc<Mutex<State>>,
    discovering: Arc<tokio::sync::Mutex<()>>,
    in_flight: Arc<tokio::sync::Semaphore>,
}

impl std::fmt::Debug for Introspector {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Introspector")
            .field("alias", &self.alias)
            .finish_non_exhaustive()
    }
}

/// `application/x-www-form-urlencoded` (RFC 6749 appendix B, as `url`'s serializer does).
pub(crate) fn form_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'*' => {
                out.push(char::from(byte));
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

impl Introspector {
    /// The introspection client of `issuer` (its exact configured string), logged as `alias`,
    /// authenticating as `client_id` with `secret`, checking answers under `rules`.
    ///
    /// # Errors
    /// The credentials cannot form an `Authorization` header.
    pub(crate) fn new(
        alias: &str,
        issuer: &str,
        client_id: &str,
        secret: &str,
        rules: TokenRules,
        fetcher: Fetcher,
        environment: &AuthEnvironment,
    ) -> Result<Self, String> {
        let basic = STANDARD.encode(format!(
            "{}:{}",
            form_encode(client_id),
            form_encode(secret)
        ));
        let mut authorization = HeaderValue::from_str(&format!("Basic {basic}"))
            .map_err(|_| "the introspection credentials cannot be sent".to_owned())?;
        authorization.set_sensitive(true);
        Ok(Self {
            alias: alias.to_owned(),
            issuer: issuer.to_owned(),
            authorization,
            rules,
            fetcher,
            clock: Arc::clone(&environment.clock),
            timeout: environment.timeout,
            state: Arc::new(Mutex::new(State::default())),
            discovering: Arc::new(tokio::sync::Mutex::new(())),
            in_flight: Arc::new(tokio::sync::Semaphore::new(MAX_IN_FLIGHT)),
        })
    }

    /// The issuer's alias.
    pub(crate) fn alias(&self) -> &str {
        &self.alias
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The endpoint, from the cache or a discovery (at most one a minute).
    async fn endpoint(&self) -> Result<String, RuleCode> {
        let cached = |state: &State, now: i64| {
            state
                .endpoint
                .as_ref()
                .filter(|endpoint| now < endpoint.until_ms)
                .map(|endpoint| endpoint.url.clone())
        };
        if let Some(url) = cached(&self.lock(), self.clock.now()) {
            return Ok(url);
        }
        let discovering = Arc::clone(&self.discovering).lock_owned().await;
        let now = self.clock.now();
        {
            let mut state = self.lock();
            if let Some(url) = cached(&state, now) {
                return Ok(url);
            }
            state.endpoint = None;
            if state
                .last_discovery_ms
                .is_some_and(|last| now < last.saturating_add(super::keys::REFETCH_INTERVAL_MS))
            {
                return Err(RuleCode::Unavailable);
            }
            state.last_discovery_ms = Some(now);
        }
        // The discovery runs on a task of its own, holding the lock, and stores what it found
        // whether or not this request is still waiting: a caller that hangs up cannot spend the
        // minute's one discovery.
        let (fetcher, issuer, alias) = (
            self.fetcher.clone(),
            self.issuer.clone(),
            self.alias.clone(),
        );
        let (state, timeout) = (Arc::clone(&self.state), self.timeout);
        let task = tokio::spawn(async move {
            let found = tokio::time::timeout(timeout, async {
                let metadata = discover(&fetcher, &issuer).await?;
                let url = metadata_url(&metadata, "introspection_endpoint")?;
                Ok::<_, DiscoveryError>((url, metadata.max_age_s))
            })
            .await
            .map_err(|_| DiscoveryError::Timeout)
            .and_then(|found| found);
            match found {
                Ok((url, max_age_s)) => {
                    state
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .endpoint = Some(Endpoint {
                        url,
                        until_ms: now.saturating_add(cache_ms(max_age_s)),
                    });
                }
                Err(error) => tracing::warn!(
                    target: "umbel::auth",
                    issuer = alias.as_str(),
                    reason = error.code(),
                    "could not discover the introspection endpoint"
                ),
            }
            drop(discovering);
        });
        if task.await.is_err() {
            return Err(RuleCode::Unavailable);
        }
        cached(&self.lock(), now).ok_or(RuleCode::Unavailable)
    }

    /// Check `response` now, for a request presenting `certificate`.
    fn check(&self, response: &Value, certificate: Option<&str>) -> Result<Credentials, RuleCode> {
        let now = self.clock.now().div_euclid(1000);
        check_introspection(response, &self.issuer, &self.rules, now, certificate)
    }

    /// Verify the opaque `token` for a request presenting `certificate`: the credentials and the
    /// answer's members, which the mapping reads.
    ///
    /// # Errors
    /// AFD's rule code: `inactive`, `claims` and rules 5 to 10 for the answer, `unavailable` when
    /// the endpoint cannot be found or does not answer.
    pub(crate) async fn verify(
        &self,
        token: &str,
        certificate: Option<&str>,
    ) -> Result<(Credentials, Map<String, Value>), RuleCode> {
        if token.len() > MAX_TOKEN_BYTES {
            return Err(RuleCode::TokenMalformed);
        }
        let digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        let now = self.clock.now();
        let cached = {
            let mut state = self.lock();
            match state.answers.get(&digest) {
                Some(answer) if now < answer.until_ms => Some(answer.response.clone()),
                Some(_) => {
                    state.answers.remove(&digest);
                    None
                }
                None => None,
            }
        };
        if let Some(response) = cached {
            // Only this request's certificate (and the time, which the cache's end already
            // bounds) can differ: a request without the bound certificate is refused, and the
            // answer stays for the requests that present it.
            let credentials = self.check(&response, certificate)?;
            return Ok((credentials, object(response)));
        }
        let Ok(_permit) = Arc::clone(&self.in_flight).try_acquire_owned() else {
            tracing::warn!(
                target: "umbel::auth",
                issuer = self.alias.as_str(),
                "refused a token: the introspection requests in flight are at their limit"
            );
            return Err(RuleCode::Unavailable);
        };
        let url = self.endpoint().await?;
        let body = format!("token={}&token_type_hint=access_token", form_encode(token));
        let response = match self
            .fetcher
            .post_form(&url, &self.authorization, body)
            .await
        {
            Ok(fetched) => Value::Object(fetched.document),
            Err(error) => {
                tracing::warn!(
                    target: "umbel::auth",
                    issuer = self.alias.as_str(),
                    reason = error.code(),
                    "the introspection endpoint did not answer"
                );
                return Err(RuleCode::Unavailable);
            }
        };
        let credentials = self.check(&response, certificate)?;
        let until_ms = credentials
            .expires_at
            .saturating_mul(1000)
            .min(now.saturating_add(CACHE_MS));
        {
            let mut state = self.lock();
            state.answers.retain(|_, answer| now < answer.until_ms);
            if state.answers.len() >= MAX_CACHED {
                // Full of live answers: drop the one that ends first.
                if let Some(first) = state
                    .answers
                    .iter()
                    .min_by_key(|(_, answer)| answer.until_ms)
                    .map(|(key, _)| *key)
                {
                    state.answers.remove(&first);
                }
            }
            state.answers.insert(
                digest,
                Answer {
                    response: response.clone(),
                    until_ms,
                },
            );
        }
        Ok((credentials, object(response)))
    }
}

fn object(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(members) => members,
        _ => Map::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn form_encoding_follows_rfc_6749_appendix_b() {
        assert_eq!(form_encode("abc-._*"), "abc-._*");
        assert_eq!(form_encode("a b+c/d:é"), "a+b%2Bc%2Fd%3A%C3%A9");
        assert_eq!(form_encode("~!"), "%7E%21");
    }
}
