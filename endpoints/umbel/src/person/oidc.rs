//! The person page's OpenID Connect relying party (phase 5 specification, section 7.2; D115):
//! one [`Provider`] per namespace with a person login.
//!
//! **Discovery.** The provider's OpenID Connect discovery document (the issuer's path inserted,
//! then appended; only a 404 moves on; its `issuer` exactly the configured one), never RFC 8414
//! metadata, which may contradict it. Its `authorization_endpoint`, `token_endpoint` and
//! `jwks_uri` must be `https`. It is fetched through the issuer's own client (its `ca_file`'s roots
//! alone when it has one, the follow-up of step 2c), HTTPS only, no redirect, 1 MiB, 10 seconds, at
//! most once a minute, and cached as a key set is (5 minutes to 24 hours).
//!
//! **Serving** (step 2c's follow-up). The document is held to `auth.person`'s rules (the same
//! function the doctor runs), and the client secret must be set: while either fails, or the
//! document cannot be read or its cache has ended, the namespace's verified commands are not
//! served. The check runs at start, again before the cache ends, and on demand.
//!
//! **The ID token** is checked by Umbel's own code, never a library's defaults: a compact JWS whose
//! header and claims are each one JSON object with unique members; `typ`, when present, `JWT`;
//! AFD's header rules against the issuer's `algorithms`; the key under its `kid` from the
//! provider's key set, fitting the `alg`; the signature through `jsonwebtoken`'s `aws-lc-rs`
//! provider; `iss` exactly; `aud` exactly the client id (one audience); `azp`, when present, the
//! client id; `exp`, `iat` and `nbf` in whole seconds within `auth.clock_skew_s`; the login's
//! `nonce`; `auth_time` no older than `max_age_s` and not before the login began; then user
//! verification and the subject, which the page checks against the decision.

use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use afd::Clock;
use afd::server::auth::{KeySource, check_jws_header, check_key_fit};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::{Map, Value};

use crate::auth::UV_AMR_METHODS;
use crate::auth::fetch::{FetchError, Fetcher};
use crate::auth::gateway::{
    claim_text, compact_parts, decode_part, decoding_key, signing_algorithm,
};
use crate::auth::keys::{
    DiscoveryError, IssuerKeys, MAX_CACHE_MS, MIN_CACHE_MS, REFETCH_INTERVAL_MS, cache_ms,
};
use crate::workspace::PersonLogin;

/// What `auth.person` found for one namespace's login against its provider's document: the
/// failures (the namespace's verified commands are not served while there is one) and the
/// warnings. The doctor and the person page both run it, so the doctor passes exactly what is
/// served.
pub(crate) fn login_findings(
    ns: &str,
    at: &str,
    login: &PersonLogin,
    document: &Map<String, Value>,
) -> (Vec<String>, Vec<String>) {
    let mut failures = Vec::new();
    let mut warnings = Vec::new();
    if login.acr_values.is_empty() {
        failures.push(format!(
            "namespace {ns}: its person login's acr_values is empty"
        ));
    }
    if login.uv_amr.is_empty() {
        failures.push(format!(
            "namespace {ns}: its person login's uv_amr is empty"
        ));
    }
    if let Some(other) = login
        .uv_amr
        .iter()
        .find(|method| !UV_AMR_METHODS.contains(&method.as_str()))
    {
        failures.push(format!(
            "namespace {ns}: uv_amr names {other}, which is not an RFC 8176 user-verification method"
        ));
    }
    match strings(document.get("acr_values_supported")) {
        Some(Some(supported)) => {
            let missing: Vec<&str> = login
                .acr_values
                .iter()
                .map(String::as_str)
                .filter(|acr| !supported.contains(acr))
                .collect();
            if !missing.is_empty() {
                failures.push(format!(
                    "namespace {ns}: {at}'s acr_values_supported lacks {}, so a login asking for it is not user-verified",
                    missing.join(", ")
                ));
            }
        }
        Some(None) => failures.push(format!(
            "namespace {ns}: {at}'s acr_values_supported is not a list of strings"
        )),
        None => warnings.push(format!(
            "namespace {ns}: {at} publishes no acr_values_supported, so whether it supports {} cannot be confirmed before a login",
            login.acr_values.join(", ")
        )),
    }
    match strings(document.get("claims_supported")) {
        Some(Some(claims)) => {
            let missing: Vec<&str> = ["acr", "amr"]
                .into_iter()
                .filter(|claim| !claims.contains(claim))
                .collect();
            if !missing.is_empty() {
                failures.push(format!(
                    "namespace {ns}: {at}'s claims_supported lacks {}, so an ID token cannot prove user verification",
                    missing.join(" and ")
                ));
            }
        }
        Some(None) => failures.push(format!(
            "namespace {ns}: {at}'s claims_supported is not a list of strings"
        )),
        None => warnings.push(format!(
            "namespace {ns}: {at} publishes no claims_supported, so whether its ID tokens carry acr and amr cannot be confirmed before a login"
        )),
    }
    (failures, warnings)
}

fn strings(value: Option<&Value>) -> Option<Option<Vec<&str>>> {
    match value {
        None => None,
        Some(Value::Array(items)) => Some(items.iter().map(Value::as_str).collect()),
        Some(_) => Some(None),
    }
}

/// What the provider's discovery document gives the relying party.
#[derive(Debug, Clone)]
pub(crate) struct ProviderDoc {
    pub(crate) authorization_endpoint: String,
    pub(crate) token_endpoint: String,
    /// RFC 9207: the provider puts `iss` on every authorization response.
    pub(crate) iss_parameter: bool,
}

/// Why a login was refused, logged as its code (target `umbel::person`) and never with a value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Refusal {
    /// The provider cannot be used: its document, keys or secret.
    Provider,
    /// The authorization response named another issuer, or none where one is required.
    IssParameter,
    /// The code could not be exchanged (a PKCE mismatch among the provider's reasons).
    Exchange,
    /// The ID token is not a compact JWS with object parts.
    Malformed,
    Typ,
    Alg,
    Key,
    Signature,
    Issuer,
    Audience,
    Azp,
    Expired,
    IssuedAt,
    NotYetValid,
    Nonce,
    /// `auth_time` is missing, in the future, before the login began, or older than `max_age_s`.
    AuthTime,
    /// No configured `acr`.
    Acr,
    /// No user-verification `amr`.
    Amr,
    /// The subject claim is missing or not a claim text.
    Subject,
}

impl Refusal {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Provider => "provider",
            Self::IssParameter => "iss-parameter",
            Self::Exchange => "exchange",
            Self::Malformed => "id-token-malformed",
            Self::Typ => "typ",
            Self::Alg => "alg",
            Self::Key => "key",
            Self::Signature => "signature",
            Self::Issuer => "issuer",
            Self::Audience => "audience",
            Self::Azp => "azp",
            Self::Expired => "expired",
            Self::IssuedAt => "iat",
            Self::NotYetValid => "not-yet-valid",
            Self::Nonce => "nonce",
            Self::AuthTime => "auth-time",
            Self::Acr => "acr",
            Self::Amr => "amr",
            Self::Subject => "subject",
        }
    }

    /// Whether the person may log in again with user verification
    /// (`PERSON_VERIFICATION_INSUFFICIENT`).
    pub(crate) fn insufficient(self) -> bool {
        matches!(self, Self::Acr | Self::Amr)
    }
}

/// What a verified ID token proved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Proved {
    /// The subject claim's value, as the provider wrote it (mapped by the caller, 4.1).
    pub(crate) subject: String,
    /// `auth_time`, epoch seconds.
    pub(crate) auth_time_s: i64,
    pub(crate) acr: String,
}

/// What the ID token must match: the login's own values.
pub(crate) struct Expected<'a> {
    pub(crate) nonce: &'a str,
    /// When the login began, epoch milliseconds.
    pub(crate) started_ms: i64,
}

#[derive(Default)]
struct DocState {
    /// The document, the check's verdict, and until when both are trusted.
    cached: Option<(ProviderDoc, Result<(), String>, i64, i64)>,
    last_fetch_ms: Option<i64>,
    /// The last failure, for the log.
    problem: Option<String>,
}

/// One namespace's person login and its provider.
pub(crate) struct Provider {
    pub(crate) namespace: String,
    /// The login issuer's alias.
    pub(crate) alias: String,
    /// Its exact `iss`.
    pub(crate) issuer: String,
    pub(crate) login: PersonLogin,
    algorithms: Vec<String>,
    fetcher: Fetcher,
    keys: IssuerKeys,
    clock: Arc<dyn Clock>,
    timeout: Duration,
    skew_s: i64,
    secret: Option<String>,
    state: Mutex<DocState>,
    fetching: Arc<tokio::sync::Mutex<()>>,
}

impl std::fmt::Debug for Provider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Provider")
            .field("namespace", &self.namespace)
            .field("alias", &self.alias)
            .finish_non_exhaustive()
    }
}

fn url_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(char::from(byte));
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

impl Provider {
    /// The provider of `namespace`'s `login`, at the issuer `alias` (`issuer`, its `algorithms`),
    /// reached through `fetcher`, with the client secret `secret` (`None` when unset or empty).
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        namespace: &str,
        alias: &str,
        issuer: &str,
        algorithms: Vec<String>,
        login: PersonLogin,
        fetcher: Fetcher,
        environment: &crate::auth::fetch::AuthEnvironment,
        skew_s: u64,
        secret: Option<String>,
    ) -> Self {
        let keys = IssuerKeys::with_discovery(
            alias,
            issuer,
            fetcher.clone(),
            environment,
            crate::auth::keys::Discovery::OpenId,
        );
        Self {
            namespace: namespace.to_owned(),
            alias: alias.to_owned(),
            issuer: issuer.to_owned(),
            login,
            algorithms,
            fetcher,
            keys,
            clock: Arc::clone(&environment.clock),
            timeout: environment.timeout,
            skew_s: i64::try_from(skew_s).unwrap_or(i64::MAX),
            secret,
            state: Mutex::new(DocState::default()),
            fetching: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    /// The trusted document and the check's verdict at `now`, if the cache holds one.
    fn cached(&self, now: i64) -> Option<(ProviderDoc, Result<(), String>, bool)> {
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        let (doc, verdict, until, fetched) = state.cached.as_ref()?;
        if now >= *until {
            return None;
        }
        // Refresh once four fifths of the cache's life have passed, so a passing namespace is
        // not unlisted while its next check runs.
        let stale = now >= fetched + (until - fetched) * 4 / 5;
        Some((doc.clone(), verdict.clone(), stale))
    }

    /// Whether this namespace's verified commands are served now (7.1, step 2c's follow-up):
    /// the document was read within its cache's life and passed `auth.person`, and the secret is
    /// set. Never waits: a missing or ageing check is started in the background, and until it
    /// passes nothing is served.
    pub(crate) fn served(self: &Arc<Self>) -> bool {
        let now = self.clock.now();
        match self.cached(now) {
            Some((_, verdict, stale)) => {
                if stale {
                    self.spawn_refresh();
                }
                verdict.is_ok()
            }
            None => {
                self.spawn_refresh();
                false
            }
        }
    }

    fn spawn_refresh(self: &Arc<Self>) {
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        let provider = Arc::clone(self);
        runtime.spawn(async move {
            let _ = provider.refresh().await;
        });
    }

    /// The document, after checking it now if the cache holds none (at most one fetch a minute):
    /// `Err` while the namespace's verified commands are not served.
    pub(crate) async fn ensure(self: &Arc<Self>) -> Result<ProviderDoc, String> {
        if let Some((doc, verdict, stale)) = self.cached(self.clock.now()) {
            if stale {
                self.spawn_refresh();
            }
            return verdict.map(|()| doc);
        }
        self.refresh().await
    }

    /// Fetch and check the document, on a task of its own so a caller that hangs up cannot spend
    /// the minute's one fetch.
    async fn refresh(self: &Arc<Self>) -> Result<ProviderDoc, String> {
        let provider = Arc::clone(self);
        let task = tokio::spawn(async move {
            let _fetching = Arc::clone(&provider.fetching).lock_owned().await;
            let now = provider.clock.now();
            if let Some((doc, verdict, stale)) = provider.cached(now)
                && !stale
            {
                return verdict.map(|()| doc);
            }
            {
                let mut state = provider
                    .state
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner);
                if state
                    .last_fetch_ms
                    .is_some_and(|last| now < last.saturating_add(REFETCH_INTERVAL_MS))
                {
                    drop(state);
                    return match provider.cached(now) {
                        Some((doc, verdict, _)) => verdict.map(|()| doc),
                        None => Err("its provider was asked less than a minute ago".to_owned()),
                    };
                }
                state.last_fetch_ms = Some(now);
            }
            let fetched = tokio::time::timeout(
                provider.timeout,
                crate::auth::keys::discover_openid(&provider.fetcher, &provider.issuer),
            )
            .await
            .map_err(|_| DiscoveryError::Timeout)
            .and_then(|found| found);
            let fetched = match fetched {
                Ok(fetched) => fetched,
                Err(error) => {
                    let problem = format!(
                        "namespace {}: its provider's discovery document cannot be read ({})",
                        provider.namespace,
                        error.code()
                    );
                    tracing::warn!(target: "umbel::person", namespace = provider.namespace.as_str(), issuer = provider.alias.as_str(), reason = error.code(), "a person login's provider cannot be read; its verified commands are not served");
                    provider
                        .state
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .problem = Some(problem.clone());
                    // The last good document stays until its cache ends.
                    return match provider.cached(provider.clock.now()) {
                        Some((doc, verdict, _)) => verdict.map(|()| doc),
                        None => Err(problem),
                    };
                }
            };
            let document = fetched.document;
            let endpoint = |member: &str| {
                document
                    .get(member)
                    .and_then(Value::as_str)
                    .filter(|url| crate::auth::fetch::https(url).is_ok())
                    .map(str::to_owned)
            };
            let verdict = (|| {
                let (Some(authorization_endpoint), Some(token_endpoint)) = (
                    endpoint("authorization_endpoint"),
                    endpoint("token_endpoint"),
                ) else {
                    return Err((
                        None,
                        format!(
                            "namespace {}: its provider names no https authorization_endpoint and token_endpoint",
                            provider.namespace
                        ),
                    ));
                };
                let doc = ProviderDoc {
                    authorization_endpoint,
                    token_endpoint,
                    iss_parameter: document.get("authorization_response_iss_parameter_supported")
                        == Some(&Value::Bool(true)),
                };
                // PKCE S256 is required; a provider that publishes its methods must list it.
                if let Some(methods) = document.get("code_challenge_methods_supported")
                    && !methods
                        .as_array()
                        .is_some_and(|methods| methods.iter().any(|m| m.as_str() == Some("S256")))
                {
                    return Err((
                        Some(doc),
                        format!(
                            "namespace {}: its provider's code_challenge_methods_supported lacks S256",
                            provider.namespace
                        ),
                    ));
                }
                let (failures, _) = login_findings(
                    &provider.namespace,
                    &provider.alias,
                    &provider.login,
                    &document,
                );
                if let Some(failure) = failures.into_iter().next() {
                    return Err((Some(doc), failure));
                }
                if provider.secret.is_none() {
                    return Err((
                        Some(doc),
                        format!(
                            "namespace {}: its person login's client secret ({}) is unset or empty",
                            provider.namespace, provider.login.client_secret_env
                        ),
                    ));
                }
                Ok(doc)
            })();
            let fetched_at = provider.clock.now();
            let until = fetched_at
                .saturating_add(cache_ms(fetched.max_age_s).clamp(MIN_CACHE_MS, MAX_CACHE_MS));
            let mut state = provider
                .state
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            match verdict {
                Ok(doc) => {
                    state.cached = Some((doc.clone(), Ok(()), until, fetched_at));
                    state.problem = None;
                    Ok(doc)
                }
                Err((doc, problem)) => {
                    tracing::warn!(target: "umbel::person", namespace = provider.namespace.as_str(), issuer = provider.alias.as_str(), "a person login fails auth.person; its verified commands are not served");
                    match doc {
                        Some(doc) => {
                            state.cached = Some((doc, Err(problem.clone()), until, fetched_at));
                        }
                        None => state.cached = None,
                    }
                    state.problem = Some(problem.clone());
                    Err(problem)
                }
            }
        });
        task.await
            .unwrap_or_else(|_| Err("its provider's check did not finish".to_owned()))
    }

    /// The authorization request (7.2, step 2): authorization code with PKCE `S256`, `state`,
    /// `nonce`, `prompt=login`, `max_age`, `acr_values`, a `claims` request marking `acr`
    /// essential with those values (and `amr` and `auth_time` essential too), and
    /// `response_mode=query`.
    pub(crate) fn authorization_url(
        &self,
        doc: &ProviderDoc,
        redirect_uri: &str,
        state: &str,
        nonce: &str,
        challenge: &str,
    ) -> String {
        let claims = serde_json::json!({
            "id_token": {
                "acr": { "essential": true, "values": self.login.acr_values },
                "amr": { "essential": true },
                "auth_time": { "essential": true },
            }
        });
        let pairs: Vec<(&str, String)> = vec![
            ("response_type", "code".to_owned()),
            ("client_id", self.login.client_id.clone()),
            ("redirect_uri", redirect_uri.to_owned()),
            ("scope", "openid".to_owned()),
            ("state", state.to_owned()),
            ("nonce", nonce.to_owned()),
            ("code_challenge", challenge.to_owned()),
            ("code_challenge_method", "S256".to_owned()),
            ("prompt", "login".to_owned()),
            ("max_age", self.login.max_age_s.to_string()),
            ("acr_values", self.login.acr_values.join(" ")),
            ("claims", claims.to_string()),
            ("response_mode", "query".to_owned()),
        ];
        let query: Vec<String> = pairs
            .iter()
            .map(|(name, value)| format!("{name}={}", url_encode(value)))
            .collect();
        let separator = if doc.authorization_endpoint.contains('?') {
            '&'
        } else {
            '?'
        };
        format!(
            "{}{separator}{}",
            doc.authorization_endpoint,
            query.join("&")
        )
    }

    /// Exchange `code` with the login's PKCE `verifier` (7.2, step 3), authenticated with
    /// `client_secret_basic`, and answer the ID token.
    pub(crate) async fn exchange(
        &self,
        doc: &ProviderDoc,
        code: &str,
        redirect_uri: &str,
        verifier: &str,
    ) -> Result<String, Refusal> {
        let secret = self.secret.as_deref().ok_or(Refusal::Provider)?;
        let authorization =
            crate::auth::introspection::basic_authorization(&self.login.client_id, secret)
                .map_err(|_| Refusal::Provider)?;
        let body = format!(
            "grant_type=authorization_code&code={}&redirect_uri={}&code_verifier={}",
            url_encode(code),
            url_encode(redirect_uri),
            url_encode(verifier)
        );
        let answer = self
            .fetcher
            .post_form(&doc.token_endpoint, &authorization, body)
            .await
            .map_err(|error| {
                if error == FetchError::Unreachable {
                    Refusal::Provider
                } else {
                    Refusal::Exchange
                }
            })?;
        answer
            .document
            .get("id_token")
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty() && token.len() <= 16 * 1024)
            .map(str::to_owned)
            .ok_or(Refusal::Exchange)
    }

    /// Verify `token` as this provider's ID token for this client and login (the module's rules),
    /// then user verification (owner decision 6): `acr` one of `acr_values` and `amr` holding one
    /// of `uv_amr`. The subject claim's value is returned for the page to match.
    pub(crate) async fn verify(
        &self,
        token: &str,
        expected: &Expected<'_>,
    ) -> Result<Proved, Refusal> {
        let [header_part, payload_part, signature_part] =
            compact_parts(token).ok_or(Refusal::Malformed)?;
        let header = decode_part(header_part).ok_or(Refusal::Malformed)?;
        // `typ`, when present, is `JWT` (OpenID Connect Core 2); never an access token's.
        match header.get("typ") {
            None => {}
            Some(Value::String(typ)) if typ.eq_ignore_ascii_case("JWT") => {}
            Some(_) => return Err(Refusal::Typ),
        }
        // AFD's header rules (alg allow-list, `none` and `HS*` refused, `kid` required, `crit`
        // and every key reference refused), with the `typ` it knows put in place of ours.
        let mut as_afd = header.clone();
        as_afd.insert("typ".into(), Value::String("at+jwt".into()));
        let algorithms: Vec<&str> = self.algorithms.iter().map(String::as_str).collect();
        let as_afd = Value::Object(as_afd);
        check_jws_header(&as_afd, &algorithms).map_err(|rule| match rule {
            afd::server::auth::RuleCode::Alg => Refusal::Alg,
            afd::server::auth::RuleCode::Typ => Refusal::Typ,
            _ => Refusal::Key,
        })?;
        let alg_name = header
            .get("alg")
            .and_then(Value::as_str)
            .ok_or(Refusal::Alg)?;
        let (alg, _) = signing_algorithm(alg_name).ok_or(Refusal::Alg)?;
        let kid = header
            .get("kid")
            .and_then(Value::as_str)
            .ok_or(Refusal::Key)?;
        let jwk = self
            .keys
            .key(&self.issuer, kid)
            .await
            .map_err(|error| match error {
                afd::server::auth::KeyError::Unknown => Refusal::Key,
                _ => Refusal::Provider,
            })?;
        let jwk = Value::Object(jwk.members().clone());
        check_key_fit(&as_afd, Some(&jwk)).map_err(|_| Refusal::Key)?;
        let key = decoding_key(alg, &jwk).ok_or(Refusal::Key)?;
        let signature = URL_SAFE_NO_PAD
            .decode(signature_part)
            .map_err(|_| Refusal::Signature)?;
        let message = &token[..header_part.len() + 1 + payload_part.len()];
        let verifier =
            (jsonwebtoken::crypto::aws_lc::DEFAULT_PROVIDER.verifier_factory)(&alg, &key)
                .map_err(|_| Refusal::Key)?;
        if verifier.verify(message.as_bytes(), &signature).is_err() {
            return Err(Refusal::Signature);
        }
        let claims = decode_part(payload_part).ok_or(Refusal::Malformed)?;
        self.check_claims(&claims, expected)
    }

    fn check_claims(
        &self,
        claims: &Map<String, Value>,
        expected: &Expected<'_>,
    ) -> Result<Proved, Refusal> {
        let now = self.clock.now().div_euclid(1000);
        let skew = self.skew_s;
        let seconds = |name: &str| claims.get(name).and_then(Value::as_i64);
        if claims.get("iss").and_then(Value::as_str) != Some(self.issuer.as_str()) {
            return Err(Refusal::Issuer);
        }
        let client = self.login.client_id.as_str();
        let audience_ok = match claims.get("aud") {
            Some(Value::String(aud)) => aud == client,
            Some(Value::Array(items)) => items.len() == 1 && items[0].as_str() == Some(client),
            _ => false,
        };
        if !audience_ok {
            return Err(Refusal::Audience);
        }
        match claims.get("azp") {
            None => {}
            Some(Value::String(azp)) if azp == client => {}
            Some(_) => return Err(Refusal::Azp),
        }
        let exp = seconds("exp").ok_or(Refusal::Expired)?;
        if now >= exp.saturating_add(skew) {
            return Err(Refusal::Expired);
        }
        let iat = seconds("iat").ok_or(Refusal::IssuedAt)?;
        if iat > now.saturating_add(skew) {
            return Err(Refusal::IssuedAt);
        }
        if let Some(nbf) = claims.get("nbf") {
            let nbf = nbf.as_i64().ok_or(Refusal::NotYetValid)?;
            if nbf > now.saturating_add(skew) {
                return Err(Refusal::NotYetValid);
            }
        }
        let nonce = claims
            .get("nonce")
            .and_then(Value::as_str)
            .ok_or(Refusal::Nonce)?;
        if !crate::shared::person::same_digest(nonce, expected.nonce) {
            return Err(Refusal::Nonce);
        }
        // `prompt=login` and `max_age` (7.2, step 2): the person authenticated for this login,
        // and recently. A provider that reused a session reports an older `auth_time`.
        let auth_time = seconds("auth_time").ok_or(Refusal::AuthTime)?;
        let max_age = i64::try_from(self.login.max_age_s).unwrap_or(i64::MAX);
        let started = expected.started_ms.div_euclid(1000);
        if auth_time > now.saturating_add(skew)
            || auth_time < started.saturating_sub(skew)
            || now.saturating_sub(auth_time) > max_age
        {
            return Err(Refusal::AuthTime);
        }
        // User verification (owner decision 6): both, on every login.
        let acr = claims
            .get("acr")
            .and_then(Value::as_str)
            .ok_or(Refusal::Acr)?;
        if !self.login.acr_values.iter().any(|value| value == acr) {
            return Err(Refusal::Acr);
        }
        let verified_by = claims
            .get("amr")
            .and_then(Value::as_array)
            .ok_or(Refusal::Amr)?;
        let user_verified = verified_by
            .iter()
            .filter_map(Value::as_str)
            .any(|method| self.login.uv_amr.iter().any(|uv| uv == method));
        if !user_verified {
            return Err(Refusal::Amr);
        }
        let subject =
            claim_text(claims.get(self.login.subject_claim.as_str())).ok_or(Refusal::Subject)?;
        Ok(Proved {
            subject: subject.to_owned(),
            auth_time_s: auth_time,
            acr: acr.to_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn form_values_are_percent_encoded() {
        assert_eq!(url_encode("a b+c/d?e=f&g"), "a%20b%2Bc%2Fd%3Fe%3Df%26g");
        assert_eq!(url_encode("AZaz09-._~"), "AZaz09-._~");
    }

    fn login() -> PersonLogin {
        PersonLogin {
            issuer: "idp".into(),
            client_id: "page".into(),
            client_secret_env: "SECRET".into(),
            subject_claim: "sub".into(),
            max_age_s: 300,
            acr_values: vec!["phr".into()],
            uv_amr: vec!["pin".into()],
        }
    }

    #[test]
    fn auth_person_fails_on_a_missing_class_or_claim_and_warns_on_silence() {
        let document = |value: Value| value.as_object().unwrap().clone();
        let (failures, warnings) =
            login_findings("corp", "idp", &login(), &document(serde_json::json!({})));
        assert!(failures.is_empty());
        assert_eq!(warnings.len(), 2);
        let (failures, _) = login_findings(
            "corp",
            "idp",
            &login(),
            &document(
                serde_json::json!({ "acr_values_supported": ["other"], "claims_supported": ["acr", "amr"] }),
            ),
        );
        assert_eq!(failures.len(), 1, "{failures:?}");
        let (failures, _) = login_findings(
            "corp",
            "idp",
            &login(),
            &document(
                serde_json::json!({ "acr_values_supported": ["phr"], "claims_supported": ["acr"] }),
            ),
        );
        assert_eq!(failures.len(), 1, "{failures:?}");
        let (failures, warnings) = login_findings(
            "corp",
            "idp",
            &login(),
            &document(
                serde_json::json!({ "acr_values_supported": ["phr"], "claims_supported": ["acr", "amr"] }),
            ),
        );
        assert!(failures.is_empty() && warnings.is_empty());
    }
}
