//! Umbel's `KeySource` (phase 5 specification, section 3.3): each `verify = "jwt"` issuer's
//! signing keys, found through its metadata and cached.
//!
//! - **Discovery** (RFC 8414 3.1 and 5, the order MCP gives clients): the authorization-server
//!   metadata with the issuer's path inserted after `/.well-known/oauth-authorization-server`,
//!   then OpenID Connect discovery with the path inserted, then with it appended. Only a 404 moves
//!   on to the next location; any other failure ends the discovery, and so does a document whose
//!   `issuer` differs from the configured one (RFC 8414 3.3), whose `jwks_uri` is missing or not
//!   `https`, or that is not one JSON object.
//! - **Fetching** ([`super::fetch`]): HTTPS only, no redirects, 1 MiB per body, 10 seconds for
//!   the whole fetch, metadata and key set together.
//! - **The key set**: keys without a `kid` are left out (a token must name one, so they can never
//!   verify anything); two keys with one `kid` make the whole set unusable, since the token could
//!   not say which it means.
//! - **The cache**: the response's `max-age`, bounded to 5 minutes to 24 hours (5 minutes
//!   without one, or with `no-store` or `no-cache`).
//! - **Refetching**: at most one fetch per minute per issuer, whatever asks for it: a token
//!   naming a `kid` the cached set lacks, or the cache ending. The `kid` comes from a token that
//!   is not yet verified, so a stream of made-up `kid`s costs the issuer one request a minute.
//! - **Failing closed**: a failed refetch keeps the last good keys until their cache ends; after
//!   that, and before the first good fetch, every token is refused with `unavailable` until a
//!   fetch succeeds.

use std::sync::{Arc, Mutex, PoisonError};

use afd::server::auth::{Jwk, KeyError, KeySource};
use async_trait::async_trait;
use serde_json::Value;

use super::fetch::{FetchError, Fetched, Fetcher};

/// The shortest a key set is cached: 5 minutes.
pub(crate) const MIN_CACHE_MS: i64 = 5 * 60 * 1000;
/// The longest a key set is cached: 24 hours.
pub(crate) const MAX_CACHE_MS: i64 = 24 * 60 * 60 * 1000;
/// The least time between two fetches of one issuer's keys: 1 minute.
pub(crate) const REFETCH_INTERVAL_MS: i64 = 60 * 1000;

/// The metadata locations of `issuer`, in the order 3.3 gives, without repeats: RFC 8414 with
/// path insertion, OpenID Connect with path insertion, OpenID Connect appended.
pub(crate) fn metadata_urls(issuer: &str) -> Vec<String> {
    let Ok(parsed) = reqwest::Url::parse(issuer) else {
        return Vec::new();
    };
    let origin = parsed.origin().ascii_serialization();
    let path = parsed.path().trim_end_matches('/');
    let mut urls = vec![
        format!("{origin}/.well-known/oauth-authorization-server{path}"),
        format!("{origin}/.well-known/openid-configuration{path}"),
        format!("{origin}{path}/.well-known/openid-configuration"),
    ];
    urls.dedup();
    urls
}

/// Why discovery or a key fetch failed, logged as its code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DiscoveryError {
    /// A location's fetch failed.
    Fetch(FetchError),
    /// No location had a document.
    NotFound,
    /// The document's `issuer` is not the configured one.
    IssuerMismatch,
    /// The document lacks the URL needed, or it is not `https`.
    MissingUrl,
    /// The key set is not a JWKS this host can use.
    KeySet,
    /// The whole fetch passed its time limit.
    Timeout,
}

impl DiscoveryError {
    /// The code logged.
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Fetch(error) => error.code(),
            Self::NotFound => "metadata-not-found",
            Self::IssuerMismatch => "issuer-mismatch",
            Self::MissingUrl => "metadata-url",
            Self::KeySet => "key-set",
            Self::Timeout => "timeout",
        }
    }
}

/// The verified metadata document of `issuer`, from the first location that has one.
pub(crate) async fn discover(fetcher: &Fetcher, issuer: &str) -> Result<Fetched, DiscoveryError> {
    for url in metadata_urls(issuer) {
        match fetcher.get(&url).await {
            Ok(fetched) => {
                if fetched.document.get("issuer").and_then(Value::as_str) != Some(issuer) {
                    return Err(DiscoveryError::IssuerMismatch);
                }
                return Ok(fetched);
            }
            Err(FetchError::NotFound) => {}
            Err(error) => return Err(DiscoveryError::Fetch(error)),
        }
    }
    Err(DiscoveryError::NotFound)
}

/// The `https` URL a metadata document gives under `member`.
pub(crate) fn metadata_url(document: &Fetched, member: &str) -> Result<String, DiscoveryError> {
    let url = document
        .document
        .get(member)
        .and_then(Value::as_str)
        .ok_or(DiscoveryError::MissingUrl)?;
    super::fetch::https(url).map_err(|_| DiscoveryError::MissingUrl)?;
    Ok(url.to_owned())
}

/// How long a response asks to be cached, bounded to 5 minutes to 24 hours.
pub(crate) fn cache_ms(max_age_s: Option<u64>) -> i64 {
    let asked = max_age_s
        .map(|seconds| i64::try_from(seconds.saturating_mul(1000)).unwrap_or(i64::MAX))
        .unwrap_or(MIN_CACHE_MS);
    asked.clamp(MIN_CACHE_MS, MAX_CACHE_MS)
}

/// The usable keys of a JWKS document: each key with a non-empty string `kid`, which no other
/// key repeats.
pub(crate) fn key_set(
    document: &serde_json::Map<String, Value>,
) -> Result<Vec<Jwk>, DiscoveryError> {
    let keys = document
        .get("keys")
        .and_then(Value::as_array)
        .ok_or(DiscoveryError::KeySet)?;
    let mut kept: Vec<Jwk> = Vec::new();
    for key in keys {
        let Ok(key) = Jwk::from_value(key.clone()) else {
            return Err(DiscoveryError::KeySet);
        };
        let Some(kid) = key.kid().filter(|kid| !kid.is_empty()).map(str::to_owned) else {
            continue;
        };
        if kept.iter().any(|other| other.kid() == Some(kid.as_str())) {
            return Err(DiscoveryError::KeySet);
        }
        kept.push(key);
    }
    Ok(kept)
}

/// A cached key set.
struct Cached {
    keys: Vec<Jwk>,
    until_ms: i64,
}

/// What the cache knows about one issuer.
#[derive(Default)]
struct State {
    cached: Option<Cached>,
    last_fetch_ms: Option<i64>,
}

/// The fetched keys of one issuer.
pub(crate) struct IssuerKeys {
    inner: Arc<Inner>,
}

/// What a fetch shares with the request that started it, so it can outlive that request.
struct Inner {
    alias: String,
    issuer: String,
    fetcher: Fetcher,
    clock: Arc<dyn afd::Clock>,
    timeout: std::time::Duration,
    state: Mutex<State>,
    fetching: Arc<tokio::sync::Mutex<()>>,
}

impl std::fmt::Debug for IssuerKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IssuerKeys")
            .field("alias", &self.inner.alias)
            .finish_non_exhaustive()
    }
}

/// What a lookup in the cache found.
enum Lookup {
    Found(Jwk),
    /// The cache is valid and lacks the `kid`.
    Unknown,
    /// No valid cache.
    Empty,
}

impl IssuerKeys {
    /// The keys of `issuer` (its exact configured string), logged as `alias`.
    pub(crate) fn new(
        alias: &str,
        issuer: &str,
        fetcher: Fetcher,
        environment: &super::fetch::AuthEnvironment,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                alias: alias.to_owned(),
                issuer: issuer.to_owned(),
                fetcher,
                clock: Arc::clone(&environment.clock),
                timeout: environment.timeout,
                state: Mutex::new(State::default()),
                fetching: Arc::new(tokio::sync::Mutex::new(())),
            }),
        }
    }
}

impl Inner {
    fn lookup(&self, kid: &str, now: i64) -> Lookup {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        match &state.cached {
            Some(cached) if now < cached.until_ms => cached
                .keys
                .iter()
                .find(|key| key.kid() == Some(kid))
                .cloned()
                .map_or(Lookup::Unknown, Lookup::Found),
            Some(_) => {
                // The cache ended: its keys are no longer trusted.
                state.cached = None;
                Lookup::Empty
            }
            None => Lookup::Empty,
        }
    }

    /// Claim the one fetch a minute allows, or `false` when one ran less than a minute ago.
    fn may_fetch(&self, now: i64) -> bool {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        // A clock that moved back counts as within the minute: fail closed, never refetch more.
        if state
            .last_fetch_ms
            .is_some_and(|last| now < last.saturating_add(REFETCH_INTERVAL_MS))
        {
            return false;
        }
        state.last_fetch_ms = Some(now);
        true
    }

    /// Discovery and the key set, within the time limit.
    async fn fetch(&self) -> Result<Cached, DiscoveryError> {
        let work = async {
            let metadata = discover(&self.fetcher, &self.issuer).await?;
            let jwks_uri = metadata_url(&metadata, "jwks_uri")?;
            let jwks = self
                .fetcher
                .get(&jwks_uri)
                .await
                .map_err(DiscoveryError::Fetch)?;
            let keys = key_set(&jwks.document)?;
            Ok::<_, DiscoveryError>((keys, jwks.max_age_s))
        };
        let (keys, max_age_s) = tokio::time::timeout(self.timeout, work)
            .await
            .map_err(|_| DiscoveryError::Timeout)??;
        Ok(Cached {
            keys,
            until_ms: self.clock.now().saturating_add(cache_ms(max_age_s)),
        })
    }

    /// Fetch and store the result, keeping the last good keys on a failure.
    async fn refresh(&self) {
        match self.fetch().await {
            Ok(cached) => {
                self.state
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .cached = Some(cached);
            }
            Err(error) => {
                tracing::warn!(
                    target: "umbel::auth",
                    issuer = self.alias.as_str(),
                    reason = error.code(),
                    "could not fetch an issuer's signing keys"
                );
            }
        }
    }
}

#[async_trait]
impl KeySource for IssuerKeys {
    async fn key(&self, issuer: &str, kid: &str) -> Result<Jwk, KeyError> {
        let inner = &self.inner;
        if issuer != inner.issuer {
            return Err(KeyError::Unavailable);
        }
        if let Lookup::Found(key) = inner.lookup(kid, inner.clock.now()) {
            return Ok(key);
        }
        // One fetch at a time per issuer; whoever waited sees what it fetched.
        let fetching = Arc::clone(&inner.fetching).lock_owned().await;
        let now = inner.clock.now();
        let before = match inner.lookup(kid, now) {
            Lookup::Found(key) => return Ok(key),
            other => other,
        };
        let refused = |lookup: &Lookup| match lookup {
            Lookup::Unknown => KeyError::Unknown,
            _ => KeyError::Unavailable,
        };
        if !inner.may_fetch(now) {
            return Err(refused(&before));
        }
        // The fetch runs on a task of its own, holding the per-issuer lock, and stores its result
        // whether or not this request is still waiting: a caller that hangs up mid-fetch cannot
        // spend the minute's one fetch and leave the cache empty.
        let task = Arc::clone(inner);
        let fetched = tokio::spawn(async move {
            task.refresh().await;
            drop(fetching);
        });
        if fetched.await.is_err() {
            return Err(KeyError::Unavailable);
        }
        match inner.lookup(kid, inner.clock.now()) {
            Lookup::Found(key) => Ok(key),
            Lookup::Unknown => Err(KeyError::Unknown),
            Lookup::Empty => Err(refused(&before)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_inserts_the_path_then_appends_it() {
        assert_eq!(
            metadata_urls("https://idp.example.com/tenant/v2"),
            [
                "https://idp.example.com/.well-known/oauth-authorization-server/tenant/v2",
                "https://idp.example.com/.well-known/openid-configuration/tenant/v2",
                "https://idp.example.com/tenant/v2/.well-known/openid-configuration",
            ]
        );
        assert_eq!(
            metadata_urls("https://idp.example.com/tenant/"),
            [
                "https://idp.example.com/.well-known/oauth-authorization-server/tenant",
                "https://idp.example.com/.well-known/openid-configuration/tenant",
                "https://idp.example.com/tenant/.well-known/openid-configuration",
            ]
        );
        // Without a path the two OpenID Connect forms are one URL.
        assert_eq!(
            metadata_urls("https://idp.example.com"),
            [
                "https://idp.example.com/.well-known/oauth-authorization-server",
                "https://idp.example.com/.well-known/openid-configuration",
            ]
        );
    }

    #[test]
    fn the_cache_lasts_five_minutes_to_a_day() {
        assert_eq!(cache_ms(None), MIN_CACHE_MS);
        assert_eq!(cache_ms(Some(0)), MIN_CACHE_MS);
        assert_eq!(cache_ms(Some(60)), MIN_CACHE_MS);
        assert_eq!(cache_ms(Some(3600)), 3_600_000);
        assert_eq!(cache_ms(Some(10 * 86_400)), MAX_CACHE_MS);
        assert_eq!(cache_ms(Some(u64::MAX)), MAX_CACHE_MS);
    }

    #[test]
    fn a_key_set_keeps_keys_with_one_kid_each() {
        let set = |value: Value| key_set(value.as_object().unwrap());
        let keys = set(serde_json::json!({ "keys": [
            { "kty": "EC", "kid": "a" },
            { "kty": "EC" },
            { "kty": "EC", "kid": "" },
            { "kty": "RSA", "kid": "b" },
        ] }))
        .unwrap();
        let kids: Vec<_> = keys.iter().filter_map(Jwk::kid).collect();
        assert_eq!(kids, ["a", "b"]);
        for bad in [
            serde_json::json!({ "keys": [{ "kid": "a" }, { "kid": "a" }] }),
            serde_json::json!({ "keys": ["a"] }),
            serde_json::json!({ "keys": {} }),
            serde_json::json!({}),
        ] {
            assert_eq!(set(bad).err(), Some(DiscoveryError::KeySet));
        }
    }
}
