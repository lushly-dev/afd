//! The doctor's hosted profile (phase 5 specification, section 6.1; step 2c): the `auth.*`
//! checks, which apply whenever `auth.mode` is not `none`, in the order of section 6.1's table
//! with `auth.ca_files` (amendment from step 2c) before the issuers it lets the host reach.
//!
//! **What a check never shows.** No check prints a secret, a token, a private key or a file's
//! contents: a secret is named by its variable, a file by its path, and a remote document by what
//! is wrong with it (a rule code), never by the values it holds. The one request a check sends
//! with credentials, to the introspection endpoint, carries a token the doctor makes up, so no
//! caller's token ever leaves the host, and Umbel's client secret goes only in the header the
//! verifier would send.
//!
//! **The network.** Each issuer is asked as the verifier would ask it ([`super::keys`]: the
//! three metadata locations in order, only a 404 moving on, HTTPS only, no redirect, 1 MiB and
//! the time limit), through the same client: its own over its `ca_file`'s roots, or the
//! platform's. The issuers are asked at once, on a thread and runtime of the doctor's own, so
//! the checks run the same from the CLI, a sealed host or a host that does not seal.

use std::path::Path;

use afd::server::auth::{Jwk, check_key_fit};
use serde_json::{Map, Value, json};

use super::fetch::{AuthEnvironment, FetchError, Fetcher, for_issuer};
use super::files::{self, Secrecy, Validity};
use super::keys::{DiscoveryError, discover, key_set, metadata_url};
use super::{UV_AMR_METHODS, split_namespaced};
use crate::doctor::Check;
use crate::workspace::{
    AccessToken, AuthMode, Config, Confirmations, IssuerConfig, Layout, ReaderEntry, TokenCheck,
    check_public_url,
};

/// How many entries a check names before it counts the rest.
const MAX_LISTED: usize = 20;

/// What the hosted profile's checks read.
pub(crate) struct Inputs<'a> {
    /// The workspace's configuration.
    pub(crate) config: &'a Config,
    /// The workspace directory, which relative paths are read under.
    pub(crate) root: &'a Path,
    /// The outbound client's roots, clock, time limit and secrets (test seams only).
    pub(crate) environment: &'a AuthEnvironment,
    /// The commands with `person.mcp`, when a sealed host knows them; `None` otherwise.
    pub(crate) person_mcp: Option<&'a [String]>,
}

/// The hosted profile's checks. In mode `none` only `auth.tls`, and only when `[http.tls]` is
/// set (its key and certificate are files like any other); in a hosted mode every check of
/// [`crate::doctor::AUTH_CHECKS`], in that order.
pub(crate) fn checks(inputs: &Inputs<'_>) -> Vec<Check> {
    let config = inputs.config;
    if !config.auth.mode.is_hosted() {
        return if config.http.tls.is_some() {
            vec![tls(inputs)]
        } else {
            Vec::new()
        };
    }
    let probes = probe_all(inputs);
    vec![
        mode(inputs),
        public_url(config),
        tls(inputs),
        trusted_proxies(config),
        ca_files(inputs),
        issuers(config, &probes),
        subjects(config, &probes),
        services(config),
        principals(config),
        person(inputs, &probes),
        secrets(inputs),
        shared(inputs.root),
        confirmations(config),
    ]
}

// ── Findings ────────────────────────────────────────────────────────────────────────────────────

/// What one check found: failures, then warnings, then notes that never change its status.
#[derive(Default)]
struct Findings {
    failures: Vec<String>,
    warnings: Vec<String>,
    notes: Vec<String>,
}

impl Findings {
    fn fail(&mut self, problem: impl Into<String>) {
        self.failures.push(problem.into());
    }

    fn warn(&mut self, problem: impl Into<String>) {
        self.warnings.push(problem.into());
    }

    fn note(&mut self, note: impl Into<String>) {
        self.notes.push(note.into());
    }

    /// The check: `fail` naming every failure and warning, else `warn` naming every warning,
    /// else `pass` with `passed`; each followed by the notes.
    fn into_check(self, id: &str, passed: impl Into<String>, suggestion: &str) -> Check {
        let failed = !self.failures.is_empty();
        let warned = !self.warnings.is_empty();
        let mut parts = self.failures;
        parts.extend(self.warnings);
        if parts.is_empty() {
            parts.push(passed.into());
        }
        parts.extend(self.notes);
        let message = parts.join("; ");
        if failed {
            Check::fail(id, message, suggestion)
        } else if warned {
            Check::warn(id, message, suggestion)
        } else {
            Check::pass(id, message)
        }
    }
}

/// `items` joined with ", ", the first [`MAX_LISTED`] named and the rest counted.
fn listed(items: &[String]) -> String {
    if items.len() <= MAX_LISTED {
        return items.join(", ");
    }
    format!(
        "{} and {} more",
        items[..MAX_LISTED].join(", "),
        items.len() - MAX_LISTED
    )
}

/// The value of the secret variable `name`: the test seam's, else the process environment's;
/// `None` when unset or empty. Only its presence is ever reported.
fn secret(environment: &AuthEnvironment, name: &str) -> Option<String> {
    environment
        .secrets
        .get(name)
        .cloned()
        .or_else(|| std::env::var(name).ok())
        .filter(|value| !value.is_empty())
}

fn now_s(environment: &AuthEnvironment) -> i64 {
    environment.clock.now().div_euclid(1000)
}

// ── auth.mode ───────────────────────────────────────────────────────────────────────────────────

fn mode(inputs: &Inputs<'_>) -> Check {
    let auth = &inputs.config.auth;
    let mut found = Findings::default();
    let passed = match auth.mode {
        AuthMode::Oauth => {
            let accepted: Vec<String> = auth
                .issuers
                .iter()
                .filter(|issuer| issuer.access_tokens)
                .map(|issuer| issuer.alias.clone())
                .collect();
            if accepted.is_empty() {
                found
                    .fail("auth.mode is \"oauth\" with no issuer whose access tokens are accepted");
            }
            format!(
                "auth.mode is \"oauth\" with {} token issuer(s) ({})",
                accepted.len(),
                listed(&accepted)
            )
        }
        AuthMode::Gateway => {
            if auth.gateway.is_none() {
                found.fail("auth.mode is \"gateway\" without [auth.gateway]");
            } else {
                found.warn("auth.mode is \"gateway\", which this build reads but serves only from phase 5 step 4, so umbel serve --http refuses to start");
            }
            "auth.mode is \"gateway\"".to_owned()
        }
        AuthMode::None => "auth.mode is \"none\"".to_owned(),
    };
    found.into_check(
        "auth.mode",
        passed,
        "Declare an issuer whose access tokens are accepted for auth.mode = \"oauth\", or [auth.gateway] for \"gateway\"; until this build serves the mode over HTTP, use stdio and the CLI.",
    )
}

// ── auth.public_url ─────────────────────────────────────────────────────────────────────────────

fn public_url(config: &Config) -> Check {
    let http = &config.http;
    let mut found = Findings::default();
    let passed = match &http.public_url {
        None => {
            found.fail("http.public_url is not set; a hosted mode needs it");
            String::new()
        }
        Some(url) => {
            if let Err(problem) = check_public_url(url, &http.path, &http.allowed_hosts) {
                found.fail(format!("http.public_url: {problem}"));
            }
            format!("http.public_url {url} is https, its host allowed, its path http.path")
        }
    };
    found.into_check(
        "auth.public_url",
        passed,
        "Set http.public_url to the MCP endpoint's absolute https URL: its host in http.allowed_hosts, its path http.path, no query or fragment.",
    )
}

// ── auth.tls ────────────────────────────────────────────────────────────────────────────────────

/// The certificates of the PEM file `key` names, each checked for its validity, and the file
/// for its permissions.
fn certificate_file(found: &mut Findings, root: &Path, key: &str, path: &str, now: i64) -> usize {
    let full = root.join(path);
    let certificates = match files::certificates(&full) {
        Ok(certificates) => certificates,
        Err(problem) => {
            found.fail(format!("{key}: {problem}"));
            return 0;
        }
    };
    if let Some(problem) = files::too_open(&full, Secrecy::Public) {
        found.fail(format!("{key}: {problem}"));
    }
    for (index, certificate) in certificates.iter().enumerate() {
        let which = if certificates.len() == 1 {
            String::new()
        } else {
            format!(" (certificate {})", index + 1)
        };
        match certificate.validity(now) {
            Validity::Expired => found.fail(format!(
                "{key}{which} expired at {}",
                certificate.not_after_text()
            )),
            Validity::NotYetValid => found.fail(format!("{key}{which} is not valid yet")),
            Validity::Expiring => found.warn(format!(
                "{key}{which} expires at {}, within 14 days",
                certificate.not_after_text()
            )),
            Validity::Valid => {}
        }
    }
    certificates.len()
}

fn tls(inputs: &Inputs<'_>) -> Check {
    let config = inputs.config;
    let root = inputs.root;
    let now = now_s(inputs.environment);
    let mut found = Findings::default();
    let bind = config.http.bind;
    let passed = match &config.http.tls {
        None => {
            if bind.ip().is_loopback() {
                format!(
                    "http.bind {bind} is loopback without [http.tls]: a TLS-terminating proxy on this host must forward to it, and a proxy on another host needs a non-loopback bind with [http.tls]"
                )
            } else {
                found.fail(format!(
                    "http.bind {bind} is not loopback and [http.tls] is not set: a non-loopback bind, a proxy on another host included, must speak TLS to Umbel"
                ));
                String::new()
            }
        }
        Some(tls) => {
            certificate_file(&mut found, root, "http.tls.cert", &tls.cert, now);
            let key = root.join(&tls.key);
            if let Err(problem) = files::private_key(&key) {
                found.fail(format!("http.tls.key: {problem}"));
            }
            if let Some(problem) = files::too_open(&key, Secrecy::Secret) {
                found.fail(format!("http.tls.key: {problem}"));
            }
            if let Some(client_ca) = &tls.client_ca {
                certificate_file(&mut found, root, "http.tls.client_ca", client_ca, now);
            }
            if found.failures.is_empty()
                && let Err(error) = crate::surfaces::http::tls::acceptor(root, tls)
            {
                // The listener's own loading: the key matches the certificate, the CA is usable.
                found.fail(error.message());
            }
            format!(
                "[http.tls] on {bind}: every certificate is valid for more than 14 days, and the files are this user's, the key readable by its owner only (client_auth = \"{}\")",
                tls.client_auth.as_str()
            )
        }
    };
    if !files::PERMISSIONS_CHECKED && (config.http.tls.is_some() || config.auth.gateway.is_some()) {
        found.warn("this platform's file permissions and owners are not checked");
    }
    if let Some(gateway) = &config.auth.gateway {
        let path = root.join(&gateway.keys);
        match read_key_set_file(&path) {
            Ok(0) => found.fail(format!(
                "auth.gateway.keys: {} holds no key with a kid",
                path.display()
            )),
            Ok(_) => {}
            Err(problem) => found.fail(format!("auth.gateway.keys: {problem}")),
        }
        if let Some(problem) = files::too_open(&path, Secrecy::Public) {
            found.fail(format!("auth.gateway.keys: {problem}"));
        }
    }
    found.into_check(
        "auth.tls",
        passed,
        "Serve a non-loopback bind with [http.tls]; renew a certificate before it expires; run chmod 600 on the key and chmod go-w on the certificate, CA and key set files.",
    )
}

/// The usable keys of the JWKS file at `path`.
fn read_key_set_file(path: &Path) -> Result<usize, String> {
    let text = files::read_limited(path)?;
    let document = match serde_json::from_slice::<Value>(&text) {
        Ok(Value::Object(document)) => document,
        _ => return Err(format!("{} is not a JWKS object", path.display())),
    };
    key_set(&document)
        .map(|keys| keys.len())
        .map_err(|_| format!("{} is not a key set this host can use", path.display()))
}

// ── auth.ca_files ───────────────────────────────────────────────────────────────────────────────

fn ca_files(inputs: &Inputs<'_>) -> Check {
    let now = now_s(inputs.environment);
    let mut found = Findings::default();
    let mut named = Vec::new();
    for issuer in &inputs.config.auth.issuers {
        let Some(path) = &issuer.ca_file else {
            continue;
        };
        let key = format!("auth.issuers.{}.ca_file", issuer.alias);
        let count = certificate_file(&mut found, inputs.root, &key, path, now);
        named.push(format!(
            "{} trusts only the {count} root(s) of {path}",
            issuer.alias
        ));
    }
    if !files::PERMISSIONS_CHECKED && !named.is_empty() {
        found.warn("this platform's file permissions and owners are not checked");
    }
    let passed = if named.is_empty() {
        "No issuer names a ca_file: every issuer is reached through the platform's roots".to_owned()
    } else {
        format!(
            "{}; every other issuer is reached through the platform's roots",
            named.join("; ")
        )
    };
    found.into_check(
        "auth.ca_files",
        passed,
        "Point ca_file at a PEM file of the issuer's root certificates, each within its validity, writable only by its owner (chmod go-w); renew a root before it expires.",
    )
}

// ── The network ─────────────────────────────────────────────────────────────────────────────────

/// What asking one issuer found.
#[derive(Debug)]
struct Probe {
    alias: String,
    /// The verified metadata document, or what went wrong.
    metadata: Result<Map<String, Value>, String>,
    /// The OpenID Connect discovery document (path inserted, then appended; only a 404 moves
    /// on), whose `issuer` must be this one: `Ok(None)` when the issuer publishes none; `None`
    /// when not asked (the metadata failed).
    oidc: Option<Result<Option<Map<String, Value>>, String>>,
    /// The key set (a `jwt` issuer's), or what went wrong; `None` when not asked.
    keys: Option<Result<Vec<Jwk>, String>>,
    /// The introspection issuer's endpoint and credentials; `None` for any other issuer.
    introspection: Option<Result<(), String>>,
}

/// What `error` means, with its code.
fn describe(error: DiscoveryError) -> String {
    let what = match error {
        DiscoveryError::Fetch(FetchError::Unreachable) => {
            "cannot be reached: the connection, TLS or the time limit failed"
        }
        DiscoveryError::Fetch(FetchError::Status) => "answered an error status or a redirect",
        DiscoveryError::Fetch(FetchError::Insecure) => "named a URL that is not https",
        DiscoveryError::Fetch(FetchError::TooLarge) => "answered more than 1 MiB",
        DiscoveryError::Fetch(FetchError::Malformed) => {
            "answered something other than one JSON object"
        }
        DiscoveryError::Fetch(FetchError::NotFound) => "answered 404",
        DiscoveryError::NotFound => {
            "publishes no metadata at any of the three well-known locations"
        }
        DiscoveryError::IssuerMismatch => "publishes metadata naming a different issuer",
        DiscoveryError::MissingUrl => "publishes metadata without an https URL it needs",
        DiscoveryError::KeySet => "publishes a key set this host cannot use",
        DiscoveryError::Timeout => "did not answer within the time limit",
    };
    format!("{what} ({})", error.code())
}

/// Ask every issuer at once, on a thread and runtime of the doctor's own.
fn probe_all(inputs: &Inputs<'_>) -> Vec<Probe> {
    let environment = inputs.environment.clone();
    let issuers = inputs.config.auth.issuers.clone();
    let root = inputs.root.to_path_buf();
    let secrets: Vec<Option<String>> = issuers
        .iter()
        .map(|issuer| {
            issuer
                .introspection
                .as_ref()
                .and_then(|client| secret(&environment, &client.client_secret_env))
        })
        .collect();
    let unreachable = |issuers: &[IssuerConfig], why: &str| -> Vec<Probe> {
        issuers
            .iter()
            .map(|issuer| Probe {
                alias: issuer.alias.clone(),
                metadata: Err(why.to_owned()),
                oidc: None,
                keys: None,
                introspection: None,
            })
            .collect()
    };
    let asked = issuers.clone();
    let worker = std::thread::Builder::new()
        .name("umbel-doctor-auth".to_owned())
        .spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|_| "the doctor's runtime cannot start".to_owned())?;
            Ok::<_, String>(runtime.block_on(async move {
                let platform = Fetcher::new(&environment);
                let mut tasks = tokio::task::JoinSet::new();
                for (index, (issuer, secret)) in asked.into_iter().zip(secrets).enumerate() {
                    let fetcher = match &platform {
                        Ok(platform) => for_issuer(&issuer, &root, &environment, platform)
                            .map_err(|problem| format!("its ca_file cannot be used: {problem}")),
                        Err(problem) => Err(problem.clone()),
                    };
                    let timeout = environment.timeout;
                    tasks.spawn(
                        async move { (index, probe(issuer, fetcher, secret, timeout).await) },
                    );
                }
                let mut probes: Vec<(usize, Probe)> = Vec::new();
                while let Some(joined) = tasks.join_next().await {
                    if let Ok(found) = joined {
                        probes.push(found);
                    }
                }
                probes.sort_by_key(|(index, _)| *index);
                probes
                    .into_iter()
                    .map(|(_, probe)| probe)
                    .collect::<Vec<_>>()
            }))
        });
    let probes = match worker.map(std::thread::JoinHandle::join) {
        Ok(Ok(Ok(probes))) => probes,
        _ => {
            return unreachable(
                &issuers,
                "was not asked: the doctor's network check did not run",
            );
        }
    };
    if probes.len() == issuers.len() {
        probes
    } else {
        unreachable(
            &issuers,
            "was not asked: the doctor's network check did not finish",
        )
    }
}

/// Ask `issuer` as the verifier would: its metadata, then its key set (`jwt`) or its
/// introspection endpoint with Umbel's credentials and a made-up token (`introspection`).
async fn probe(
    issuer: IssuerConfig,
    fetcher: Result<Fetcher, String>,
    secret: Option<String>,
    timeout: std::time::Duration,
) -> Probe {
    let mut probe = Probe {
        alias: issuer.alias.clone(),
        metadata: Err(String::new()),
        oidc: None,
        keys: None,
        introspection: None,
    };
    let fetcher = match fetcher {
        Ok(fetcher) => fetcher,
        Err(problem) => {
            probe.metadata = Err(problem);
            return probe;
        }
    };
    // One time limit for the metadata and the key set together, as the verifier's fetch has
    // (`IssuerKeys::fetch`); the introspection endpoint's discovery, likewise, has one of its own.
    let deadline = tokio::time::Instant::now() + timeout;
    let metadata = tokio::time::timeout_at(deadline, discover(&fetcher, &issuer.issuer))
        .await
        .map_err(|_| DiscoveryError::Timeout)
        .and_then(|found| found);
    let metadata = match metadata {
        Ok(metadata) => metadata,
        Err(error) => {
            probe.metadata = Err(format!("its metadata {}", describe(error)));
            return probe;
        }
    };
    match issuer.verify {
        TokenCheck::Jwt => {
            let keys = tokio::time::timeout_at(deadline, async {
                let uri = metadata_url(&metadata, "jwks_uri")?;
                let jwks = fetcher.get(&uri).await.map_err(DiscoveryError::Fetch)?;
                key_set(&jwks.document)
            })
            .await
            .map_err(|_| DiscoveryError::Timeout)
            .and_then(|found| found);
            probe.keys = Some(keys.map_err(|error| format!("its key set {}", describe(error))));
        }
        TokenCheck::Introspection => {
            let client_id = issuer
                .introspection
                .as_ref()
                .map(|client| client.client_id.clone())
                .unwrap_or_default();
            let asked = tokio::time::timeout(
                timeout,
                introspect(&fetcher, &metadata, &client_id, secret.as_deref()),
            )
            .await
            .unwrap_or_else(|_| {
                Err(
                    "its introspection endpoint did not answer within the time limit (timeout)"
                        .to_owned(),
                )
            });
            probe.introspection = Some(asked);
        }
    }
    let oidc = tokio::time::timeout(timeout, oidc_document(&fetcher, &issuer.issuer))
        .await
        .map_err(|_| DiscoveryError::Timeout)
        .and_then(|found| found);
    probe.oidc = Some(
        oidc.map_err(|error| format!("its OpenID Connect discovery document {}", describe(error))),
    );
    probe.metadata = Ok(metadata.document);
    probe
}

/// The OpenID Connect discovery document of `issuer`: with the path inserted, then appended
/// (RFC 8414 5, OIDC Discovery 4), only a 404 moving on, its `issuer` this one. `None` when
/// neither location has one.
async fn oidc_document(
    fetcher: &Fetcher,
    issuer: &str,
) -> Result<Option<Map<String, Value>>, DiscoveryError> {
    for url in super::keys::metadata_urls(issuer).into_iter().skip(1) {
        match fetcher.get(&url).await {
            Ok(fetched) => {
                if fetched.document.get("issuer").and_then(Value::as_str) != Some(issuer) {
                    return Err(DiscoveryError::IssuerMismatch);
                }
                return Ok(Some(fetched.document));
            }
            Err(FetchError::NotFound) => {}
            Err(error) => return Err(DiscoveryError::Fetch(error)),
        }
    }
    Ok(None)
}

/// The document an identity check reads for `probe`'s issuer: its OpenID Connect discovery
/// document when it publishes one (`true`), else its RFC 8414 metadata (`false`).
fn identity_document(probe: Option<&Probe>) -> Result<(&Map<String, Value>, bool), String> {
    let Some(probe) = probe else {
        return Err("was not asked".to_owned());
    };
    let metadata = probe.metadata.as_ref().map_err(String::clone)?;
    match &probe.oidc {
        Some(Ok(Some(document))) => Ok((document, true)),
        Some(Err(problem)) => Err(problem.clone()),
        Some(Ok(None)) | None => Ok((metadata, false)),
    }
}

/// Call the introspection endpoint with Umbel's credentials and a token the doctor makes up,
/// which an endpoint that authenticates the caller answers `{"active": false}`.
async fn introspect(
    fetcher: &Fetcher,
    metadata: &super::fetch::Fetched,
    client_id: &str,
    secret: Option<&str>,
) -> Result<(), String> {
    let url = metadata_url(metadata, "introspection_endpoint")
        .map_err(|_| "its metadata names no https introspection_endpoint".to_owned())?;
    let Some(secret) = secret else {
        return Err(
            "its introspection endpoint was not called: Umbel's client secret is unset or empty (auth.secrets)"
                .to_owned(),
        );
    };
    let authorization = super::introspection::basic_authorization(client_id, secret)?;
    let made_up = format!("umbel-doctor-{}", crate::host::new_trace_id());
    let body = format!(
        "token={}&token_type_hint=access_token",
        super::introspection::form_encode(&made_up)
    );
    match fetcher.post_form(&url, &authorization, body).await {
        Ok(answer) => match answer.document.get("active") {
            Some(Value::Bool(false)) => Ok(()),
            Some(Value::Bool(true)) => Err(
                "its introspection endpoint called a token the doctor made up active: it cannot be trusted to introspect"
                    .to_owned(),
            ),
            _ => Err("its introspection endpoint answered without \"active\": false".to_owned()),
        },
        Err(FetchError::Status | FetchError::NotFound) => Err(
            "its introspection endpoint refused Umbel's client credentials or answered an error status (status)"
                .to_owned(),
        ),
        Err(error) => Err(format!(
            "its introspection endpoint {}",
            describe(DiscoveryError::Fetch(error))
        )),
    }
}

fn probe_of<'p>(probes: &'p [Probe], alias: &str) -> Option<&'p Probe> {
    probes.iter().find(|probe| probe.alias == alias)
}

// ── auth.issuers ────────────────────────────────────────────────────────────────────────────────

fn issuers(config: &Config, probes: &[Probe]) -> Check {
    let mut found = Findings::default();
    let mut good = Vec::new();
    for issuer in &config.auth.issuers {
        let alias = &issuer.alias;
        let Some(probe) = probe_of(probes, alias) else {
            found.fail(format!("{alias} was not asked"));
            continue;
        };
        if let Err(problem) = &probe.metadata {
            found.fail(format!("{alias}: {problem}"));
            continue;
        }
        let mut fine = true;
        match &probe.keys {
            Some(Err(problem)) => {
                found.fail(format!("{alias}: {problem}"));
                fine = false;
            }
            Some(Ok(keys)) if keys.is_empty() => {
                found.fail(format!("{alias}: its key set holds no key with a kid"));
                fine = false;
            }
            Some(Ok(keys)) => {
                let unfit: Vec<String> = issuer
                    .algorithms
                    .iter()
                    .filter(|algorithm| !keys.iter().any(|key| fits(key, algorithm)))
                    .cloned()
                    .collect();
                if unfit.len() == issuer.algorithms.len() {
                    found.fail(format!(
                        "{alias}: no key of its key set fits its algorithms ({})",
                        issuer.algorithms.join(", ")
                    ));
                    fine = false;
                } else if !unfit.is_empty() {
                    found.warn(format!(
                        "{alias}: no key of its key set fits {}, so a token signed with it is refused",
                        unfit.join(", ")
                    ));
                }
            }
            None => {}
        }
        if let Some(Err(problem)) = &probe.introspection {
            found.fail(format!("{alias}: {problem}"));
            fine = false;
        }
        if fine {
            good.push(alias.clone());
        }
    }
    found.into_check(
        "auth.issuers",
        format!(
            "Each issuer's metadata names it and its keys or introspection answer as the verifier needs ({})",
            listed(&good)
        ),
        "Check that each issuer's iss is exact, that it is reachable over HTTPS from this host without a redirect (with its ca_file when it is behind a private certificate authority), and that the introspection client's credentials are Umbel's.",
    )
}

/// Whether `key` can verify a token signed with `algorithm` (section 3.2, rule 4).
fn fits(key: &Jwk, algorithm: &str) -> bool {
    let header = json!({ "alg": algorithm, "kid": key.kid().unwrap_or_default() });
    check_key_fit(&header, Some(&Value::Object(key.members().clone()))).is_ok()
}

// ── auth.subjects ───────────────────────────────────────────────────────────────────────────────

fn subjects(config: &Config, probes: &[Probe]) -> Check {
    let auth = &config.auth;
    let mut found = Findings::default();
    for issuer in &auth.issuers {
        let alias = &issuer.alias;
        let mut claims = vec![issuer.subject_claim.as_str()];
        for namespace in &auth.namespaces {
            if let Some(person) = namespace.person.as_ref().filter(|p| &p.issuer == alias) {
                claims.push(person.subject_claim.as_str());
            }
        }
        if !claims.contains(&"sub") {
            continue;
        }
        let (document, oidc) = match identity_document(probe_of(probes, alias)) {
            Ok(found) => found,
            Err(problem) => {
                found.fail(format!(
                    "{alias}: whether its sub is public cannot be confirmed, since its metadata cannot be read: {problem}"
                ));
                continue;
            }
        };
        match document.get("subject_types_supported") {
            Some(Value::Array(types)) if types.iter().any(|t| t.as_str() == Some("public")) => {}
            Some(Value::Array(_)) => found.fail(format!(
                "{alias}: its subject_types_supported lacks public, so its sub may be pairwise and name one person differently to each client"
            )),
            Some(_) => found.fail(format!(
                "{alias}: its subject_types_supported is not a list of strings"
            )),
            // OpenID Connect discovery requires the member: a document without it is not one
            // that can vouch for its subjects.
            None if oidc => found.fail(format!(
                "{alias}: its OpenID Connect discovery document publishes no subject_types_supported, which that document must, so whether its sub is public cannot be confirmed"
            )),
            None => found.warn(format!(
                "{alias}: it publishes no OpenID Connect discovery document and its metadata no subject_types_supported, so whether its sub is public (not pairwise) cannot be confirmed"
            )),
        }
    }
    for namespace in &auth.namespaces {
        let joined: Vec<String> = auth
            .issuers
            .iter()
            .filter(|issuer| issuer.namespace == namespace.id)
            .map(|issuer| format!("{} ({})", issuer.alias, issuer.subject_claim))
            .collect();
        if joined.len() > 1 {
            found.note(format!(
                "namespace {} joins {}: the deployer asserts that these subject claims name the same people, which Umbel cannot verify",
                namespace.id,
                joined.join(" and ")
            ));
        }
    }
    found.into_check(
        "auth.subjects",
        "Every issuer whose subject claim is sub publishes public subjects",
        "Set subject_claim to a stable, public claim (such as oid) at an issuer whose sub is pairwise, or have the provider issue public subjects.",
    )
}

// ── auth.services ───────────────────────────────────────────────────────────────────────────────

fn services(config: &Config) -> Check {
    let mut found = Findings::default();
    let missing: Vec<String> = config
        .auth
        .issuers
        .iter()
        .filter(|issuer| issuer.access_tokens && issuer.services.is_none())
        .map(|issuer| issuer.alias.clone())
        .collect();
    if !missing.is_empty() {
        found.warn(format!(
            "{} set(s) neither services.clients nor services.claim, so only sub == client_id marks a service token there, and an app-only token marked only by a claim maps to a person",
            listed(&missing)
        ));
    }
    found.into_check(
        "auth.services",
        "Every token issuer says how it marks a service token",
        "Set [auth.issuers.<alias>] services = { clients = [...] } or services.claim (for example { name = \"idtyp\", value = \"app\" }).",
    )
}

// ── auth.principals ─────────────────────────────────────────────────────────────────────────────

/// Every principal string `umbel.toml` grants something to, with the key that names it: space
/// `readers`, collection `access`, group `members`, the `memory_write` grants' `writers`,
/// `editors` and `erasers`, `usage.readers`, and an area's `approvers` in an instance's
/// configuration (`[plugins.<id>.config.areas.<area>] approvers`).
fn granted(config: &Config) -> Vec<(String, String)> {
    let mut entries = Vec::new();
    let mut reader = |key: String, text: &str| {
        if let Ok(ReaderEntry::Principal(principal)) = ReaderEntry::parse(text) {
            entries.push((key, principal));
        }
    };
    for space in &config.spaces {
        for entry in &space.readers {
            reader(format!("spaces.{}.readers", space.id), entry);
        }
    }
    for group in &config.access.groups {
        for member in &group.members {
            reader(format!("access.groups.{}.members", group.id), member);
        }
    }
    for entry in &config.usage.readers {
        reader("usage.readers".to_owned(), entry);
    }
    let mut token = |key: String, text: &str| {
        if let Ok(AccessToken::Principal(principal)) = AccessToken::parse(text) {
            entries.push((key, principal));
        }
    };
    for space in &config.spaces {
        for collection in &space.collections {
            for entry in &collection.access {
                token(
                    format!("spaces.{}.collections.{}.access", space.id, collection.id),
                    entry,
                );
            }
        }
    }
    for instance in &config.plugins.instances {
        if let Some(policy) = &instance.memory_write {
            for (name, list) in [
                ("writers", &policy.writers),
                ("editors", &policy.editors),
                ("erasers", &policy.erasers),
            ] {
                for entry in list {
                    token(
                        format!("plugins.{}.grants.memory_write.{name}", instance.id),
                        entry,
                    );
                }
            }
        }
        if let Some(areas) = instance.config.get("areas").and_then(Value::as_object) {
            for (area, table) in areas {
                for entry in table
                    .get("approvers")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                {
                    token(
                        format!("plugins.{}.config.areas.{area}.approvers", instance.id),
                        entry,
                    );
                }
            }
        }
    }
    entries
}

fn principals(config: &Config) -> Check {
    let auth = &config.auth;
    let mut found = Findings::default();
    let namespaced =
        |value: &str| split_namespaced(value).is_some_and(|(ns, _)| auth.has_namespace(ns));
    if !namespaced(&config.principal.local_id) {
        found.fail(format!(
            "principal.local_id `{}` is not <namespace>/<subject> for a declared namespace",
            config.principal.local_id
        ));
    }
    if let Some(person) = config
        .principal
        .on_behalf_of
        .as_deref()
        .filter(|person| !namespaced(person))
    {
        found.fail(format!(
            "principal.on_behalf_of `{person}` is not <namespace>/<subject> for a declared namespace"
        ));
    }
    let entries = granted(config);
    let orphans: Vec<String> = entries
        .iter()
        .filter(|(_, principal)| {
            !auth.produces(principal) && !config.principal.equivalents.contains_key(principal)
        })
        .map(|(key, principal)| format!("`{principal}` in {key}"))
        .collect();
    if !orphans.is_empty() {
        found.fail(format!(
            "{} entr{} name a principal that no namespace or equivalent can produce, so it grants no one: {}",
            orphans.len(),
            if orphans.len() == 1 { "y" } else { "ies" },
            listed(&orphans)
        ));
    }
    found.into_check(
        "auth.principals",
        format!(
            "principal.local_id is namespaced and each of the {} principal entries is one a namespace or [principal.equivalents] produces",
            entries.len()
        ),
        "Name principals as <kind>:<namespace>/<subject> for a declared namespace, or map a legacy principal in [principal.equivalents] (section 4.6).",
    )
}

// ── auth.person ─────────────────────────────────────────────────────────────────────────────────

fn strings(value: Option<&Value>) -> Option<Option<Vec<&str>>> {
    match value {
        None => None,
        Some(Value::Array(items)) => Some(items.iter().map(Value::as_str).collect()),
        Some(_) => Some(None),
    }
}

fn person(inputs: &Inputs<'_>, probes: &[Probe]) -> Check {
    let auth = &inputs.config.auth;
    let mut found = Findings::default();
    let gated = inputs.person_mcp.unwrap_or_default();
    let mut valid = Vec::new();
    for namespace in &auth.namespaces {
        let ns = &namespace.id;
        let has_callers = auth
            .issuers
            .iter()
            .any(|issuer| &issuer.namespace == ns && issuer.access_tokens);
        let Some(login) = &namespace.person else {
            if has_callers && !gated.is_empty() {
                found.warn(format!(
                    "namespace {ns} has token callers and no person login, so {} (person.mcp) are not served to them",
                    listed(gated)
                ));
            }
            continue;
        };
        let failures = found.failures.len();
        if login.acr_values.is_empty() {
            found.fail(format!(
                "namespace {ns}: its person login's acr_values is empty"
            ));
        }
        if login.uv_amr.is_empty() {
            found.fail(format!(
                "namespace {ns}: its person login's uv_amr is empty"
            ));
        }
        if let Some(other) = login
            .uv_amr
            .iter()
            .find(|method| !UV_AMR_METHODS.contains(&method.as_str()))
        {
            found.fail(format!(
                "namespace {ns}: uv_amr names {other}, which is not an RFC 8176 user-verification method"
            ));
        }
        match identity_document(probe_of(probes, &login.issuer)) {
            Ok((document, _)) => {
                let at = &login.issuer;
                match strings(document.get("acr_values_supported")) {
                    Some(Some(supported)) => {
                        let missing: Vec<&str> = login
                            .acr_values
                            .iter()
                            .map(String::as_str)
                            .filter(|acr| !supported.contains(acr))
                            .collect();
                        if !missing.is_empty() {
                            found.fail(format!(
                                "namespace {ns}: {at}'s acr_values_supported lacks {}, so a login asking for it is not user-verified",
                                missing.join(", ")
                            ));
                        }
                    }
                    Some(None) => found.fail(format!(
                        "namespace {ns}: {at}'s acr_values_supported is not a list of strings"
                    )),
                    None => found.warn(format!(
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
                            found.fail(format!(
                                "namespace {ns}: {at}'s claims_supported lacks {}, so an ID token cannot prove user verification",
                                missing.join(" and ")
                            ));
                        }
                    }
                    Some(None) => found.fail(format!(
                        "namespace {ns}: {at}'s claims_supported is not a list of strings"
                    )),
                    None => found.warn(format!(
                        "namespace {ns}: {at} publishes no claims_supported, so whether its ID tokens carry acr and amr cannot be confirmed before a login"
                    )),
                }
            }
            Err(problem) => found.fail(format!(
                "namespace {ns}: its person login at {} cannot be confirmed, since that issuer's metadata cannot be read: {problem}",
                login.issuer
            )),
        }
        if found.failures.len() == failures {
            valid.push(ns.clone());
        } else if !gated.is_empty() {
            found.note(format!(
                "while this fails, namespace {ns}'s verified commands ({}) are not served",
                listed(gated)
            ));
        }
    }
    let passed = if valid.is_empty() {
        "No namespace has a person login".to_owned()
    } else {
        format!(
            "Each person login asks for a user-verified class its provider supports, and the provider's ID tokens carry acr and amr ({})",
            listed(&valid)
        )
    };
    found.into_check(
        "auth.person",
        passed,
        "Give each person login acr_values its provider lists in acr_values_supported and that require user verification, and uv_amr from RFC 8176 (pin, fpt, face, iris, retina, vbm); use a provider that publishes acr and amr in claims_supported.",
    )
}

// ── auth.secrets ────────────────────────────────────────────────────────────────────────────────

fn secrets(inputs: &Inputs<'_>) -> Check {
    let config = inputs.config;
    let mut names: Vec<(String, String)> = Vec::new();
    for namespace in &config.auth.namespaces {
        if let Some(person) = &namespace.person {
            names.push((
                format!("auth.namespaces.{}.person.client_secret_env", namespace.id),
                person.client_secret_env.clone(),
            ));
        }
    }
    for issuer in &config.auth.issuers {
        if let Some(client) = &issuer.introspection {
            names.push((
                format!(
                    "auth.issuers.{}.introspection.client_secret_env",
                    issuer.alias
                ),
                client.client_secret_env.clone(),
            ));
        }
    }
    for instance in &config.plugins.instances {
        if !config.plugins.enabled.contains(&instance.id) {
            continue;
        }
        if let Some(name) = &instance.bearer_env {
            names.push((format!("plugins.{}.bearer_env", instance.id), name.clone()));
        }
    }
    let mut found = Findings::default();
    let mut set = Vec::new();
    for (key, name) in &names {
        if secret(inputs.environment, name).is_some() {
            set.push(name.clone());
        } else {
            found.fail(format!("{name} ({key}) is unset or empty"));
        }
    }
    let passed = if names.is_empty() {
        "No secret variable is named".to_owned()
    } else {
        format!("Each secret variable is set: {}", listed(&set))
    };
    found.into_check(
        "auth.secrets",
        passed,
        "Set each named variable in the environment the host runs in; umbel.toml names a secret's variable, never the secret.",
    )
}

// ── auth.shared ─────────────────────────────────────────────────────────────────────────────────

fn shared(root: &Path) -> Check {
    let dir = Layout::new(root).shared_dir();
    let mut found = Findings::default();
    if let Err(problem) = crate::doctor::writable(&dir) {
        found.fail(format!("state/shared/: {problem}"));
    }
    let existing = dir
        .ancestors()
        .find(|path| path.is_dir())
        .unwrap_or(root)
        .to_path_buf();
    match file_system(&existing) {
        FileSystem::Local => {}
        FileSystem::Remote(kind) => found.fail(format!(
            "state/shared/ is on a {kind} file system, not a local one: its stores are SQLite in WAL mode, shared through memory by the processes of one machine (D29)"
        )),
        FileSystem::Unknown(why) => found.warn(format!(
            "whether state/shared/ is on a local file system cannot be told: {why}"
        )),
    }
    found.into_check(
        "auth.shared",
        "state/shared/ is writable and on a local file system",
        "Put the workspace on a local file system that this user can write; the processes behind one URL share state/shared/ on one machine.",
    )
}

/// What kind of file system holds a path.
enum FileSystem {
    Local,
    Remote(String),
    Unknown(String),
}

/// The remote or user-space file system a Linux `statfs` `f_type` names (statfs(2), magic.h):
/// network file systems, and FUSE, which may be remote.
// Read on Linux; unit-tested everywhere.
#[cfg_attr(not(any(target_os = "linux", target_os = "android")), allow(dead_code))]
fn linux_remote(f_type: u32) -> Option<&'static str> {
    const REMOTE: &[(u32, &str)] = &[
        (0x6969, "NFS"),
        (0x517B, "SMB"),
        (0xFF53_4D42, "CIFS"),
        (0xFE53_4D42, "SMB2"),
        (0x7375_7245, "Coda"),
        (0x5346_414F, "AFS"),
        (0x6B41_4653, "kAFS"),
        (0x564C, "NCP"),
        (0x0102_1997, "9P"),
        (0x00C3_6400, "Ceph"),
        (0x0BD0_0BD0, "Lustre"),
        (0x0116_1970, "GFS2"),
        (0x7461_636F, "OCFS2"),
        (0x6573_5546, "FUSE (which may be remote)"),
    ];
    REMOTE
        .iter()
        .find(|(magic, _)| *magic == f_type)
        .map(|(_, name)| *name)
}

/// Whether a macOS `statfs` `f_fstypename` names a network or user-space file system.
// Read on macOS; unit-tested everywhere.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn macos_remote(name: &str) -> bool {
    [
        "nfs", "smbfs", "afpfs", "webdav", "cifs", "ftp", "macfuse", "osxfuse", "fusefs",
    ]
    .contains(&name)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn file_system(path: &Path) -> FileSystem {
    match rustix::fs::statfs(path) {
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        Ok(stat) => linux_remote(stat.f_type as u32).map_or(FileSystem::Local, |name| {
            FileSystem::Remote(name.to_owned())
        }),
        Err(error) => FileSystem::Unknown(format!("statfs failed: {error}")),
    }
}

#[cfg(target_os = "macos")]
fn file_system(path: &Path) -> FileSystem {
    match rustix::fs::statfs(path) {
        Ok(stat) => {
            #[allow(clippy::cast_sign_loss)]
            let name: String = stat
                .f_fstypename
                .iter()
                .take_while(|c| **c != 0)
                .map(|c| char::from(*c as u8))
                .collect();
            if macos_remote(&name) {
                FileSystem::Remote(name)
            } else {
                FileSystem::Local
            }
        }
        Err(error) => FileSystem::Unknown(format!("statfs failed: {error}")),
    }
}

#[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
fn file_system(_path: &Path) -> FileSystem {
    FileSystem::Unknown("this platform's file system type is not read".to_owned())
}

// ── auth.trusted_proxies ────────────────────────────────────────────────────────────────────────

/// `http.trusted_proxies` (amendment from phase 5 step 3): passes when unset, saying what the
/// per-IP limit keys on; otherwise lists the trusted peers and warns on each that undermines the
/// trust: a loopback address, from which any process on the host can connect and name any client
/// address, and a non-loopback address while the bind is loopback, which can never connect.
fn trusted_proxies(config: &Config) -> Check {
    let http = &config.http;
    let mut found = Findings::default();
    if http.trusted_proxies.is_empty() {
        return found.into_check(
            "auth.trusted_proxies",
            "http.trusted_proxies is not set: the per-IP limit keys on each connection's own peer address, so a proxy on this host is one peer; the per-token limit still keeps each verified caller's budget its own",
            "",
        );
    }
    let bound_loopback = http.bind.ip().is_loopback();
    for proxy in &http.trusted_proxies {
        if proxy.is_loopback() {
            found.warn(format!(
                "http.trusted_proxies lists {proxy}, a loopback address: any process on this host can connect from it and name any client address to the per-IP limit"
            ));
        } else if bound_loopback {
            found.warn(format!(
                "http.trusted_proxies lists {proxy}, but http.bind is a loopback address, so it can never connect"
            ));
        }
    }
    found.note(
        "each listed peer must open every connection with a PROXY protocol version 2 header, and is trusted to name the client address for the per-IP limit only, never an identity",
    );
    let listed_proxies: Vec<String> = http
        .trusted_proxies
        .iter()
        .map(ToString::to_string)
        .collect();
    found.into_check(
        "auth.trusted_proxies",
        format!(
            "http.trusted_proxies lists {} peer(s) ({})",
            listed_proxies.len(),
            listed(&listed_proxies)
        ),
        "List only the proxies' own addresses, on a host where no untrusted user can connect from them; leave http.trusted_proxies unset when no proxy sends the PROXY protocol.",
    )
}

// ── auth.confirmations ──────────────────────────────────────────────────────────────────────────

fn confirmations(config: &Config) -> Check {
    let mut found = Findings::default();
    let value = match config.mcp.confirmations {
        Confirmations::Enforce => {
            found.fail(
                "mcp.confirmations is \"enforce\": a caller's own confirm: true would proceed, which proves no person",
            );
            "enforce"
        }
        Confirmations::RequireHuman => "require-human",
        Confirmations::Off => "off",
    };
    found.into_check(
        "auth.confirmations",
        format!(
            "mcp.confirmations is \"{value}\": it governs only ordinary confirm_prompt commands, never a person-gated one"
        ),
        "Set mcp.confirmations = \"require-human\" in a hosted mode (section 6.1).",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    /// The checks as JSON, keyed by id.
    fn by_id(checks: &[Check]) -> BTreeMap<String, Value> {
        checks
            .iter()
            .map(|check| (check.id.clone(), serde_json::to_value(check).unwrap()))
            .collect()
    }
    use crate::doctor::CheckStatus;
    use crate::workspace::ConfigFile;

    fn config(text: &str) -> Config {
        ConfigFile::parse(text)
            .and_then(|file| file.into_config(Path::new("/w")))
            .unwrap()
    }

    const OAUTH: &str = r#"
config_version = 5
[principal]
local_id = "corp/ada"
[mcp]
confirmations = "require-human"
[http]
public_url = "https://umbel.example.com/mcp"
allowed_hosts = ["umbel.example.com"]
[auth]
mode = "oauth"
[auth.namespaces.corp]
[auth.issuers.as]
issuer = "https://as.example.com"
namespace = "corp"
[spaces.main]
readers = ["human:corp/ada", "human:ada", "group:eng", "*"]
[access.groups.eng]
members = ["human:corp/bo"]
"#;

    #[test]
    fn principals_fail_on_an_entry_no_namespace_or_equivalent_produces() {
        let check = principals(&config(OAUTH));
        assert_eq!(check.status, CheckStatus::Fail, "{}", check.message);
        assert!(
            check.message.contains("`human:ada` in spaces.main.readers"),
            "{}",
            check.message
        );
        let mapped = OAUTH.replace(
            "[principal]\nlocal_id = \"corp/ada\"",
            "[principal]\nlocal_id = \"corp/ada\"\n[principal.equivalents]\n\"human:ada\" = \"human:corp/ada\"",
        );
        let check = principals(&config(&mapped));
        assert_eq!(check.status, CheckStatus::Pass, "{}", check.message);
    }

    #[test]
    fn confirmations_fail_under_enforce() {
        let enforce = OAUTH.replace("confirmations = \"require-human\"", "");
        assert_eq!(confirmations(&config(&enforce)).status, CheckStatus::Fail);
        assert_eq!(confirmations(&config(OAUTH)).status, CheckStatus::Pass);
    }

    #[test]
    fn trusted_proxies_pass_unset_and_warn_where_the_trust_does_not_hold() {
        let unset = trusted_proxies(&config(OAUTH));
        assert_eq!(unset.status, CheckStatus::Pass, "{}", unset.message);
        assert!(unset.message.contains("not set"), "{}", unset.message);
        let with = |bind: &str, proxies: &str| {
            OAUTH.replace(
                "[http]\n",
                &format!("[http]\nbind = \"{bind}\"\ntrusted_proxies = [{proxies}]\n"),
            )
        };
        // A same-host proxy on loopback: any local process could connect from it, so it warns,
        // and says what the peer is trusted with.
        let loopback = trusted_proxies(&config(&with("127.0.0.1:8443", "\"127.0.0.1\"")));
        assert_eq!(loopback.status, CheckStatus::Warn, "{}", loopback.message);
        assert!(
            loopback.message.contains("loopback address"),
            "{}",
            loopback.message
        );
        assert!(
            loopback.message.contains("PROXY protocol"),
            "{}",
            loopback.message
        );
        // A non-loopback proxy can never reach a loopback bind.
        let unreachable = trusted_proxies(&config(&with("127.0.0.1:8443", "\"10.0.0.7\"")));
        assert_eq!(
            unreachable.status,
            CheckStatus::Warn,
            "{}",
            unreachable.message
        );
        assert!(
            unreachable.message.contains("can never connect"),
            "{}",
            unreachable.message
        );
    }

    #[test]
    fn services_warn_without_a_rule() {
        assert_eq!(services(&config(OAUTH)).status, CheckStatus::Warn);
        let with = OAUTH.replace(
            "namespace = \"corp\"\n[spaces",
            "namespace = \"corp\"\nservices = { clients = [\"bot\"] }\n[spaces",
        );
        assert_eq!(services(&config(&with)).status, CheckStatus::Pass);
    }

    fn inputs<'a>(
        config: &'a Config,
        environment: &'a AuthEnvironment,
        person_mcp: Option<&'a [String]>,
    ) -> Inputs<'a> {
        Inputs {
            config,
            root: Path::new("/w"),
            environment,
            person_mcp,
        }
    }

    #[test]
    fn person_warns_when_person_gated_commands_meet_a_namespace_without_a_login() {
        let config = config(OAUTH);
        let environment = AuthEnvironment::default();
        let gated = vec!["kb-approve".to_owned()];
        // A sealed host that knows a person.mcp command: corp has token callers and no login.
        let check = person(&inputs(&config, &environment, Some(&gated)), &[]);
        assert_eq!(check.status, CheckStatus::Warn, "{}", check.message);
        assert!(
            check.message.contains("namespace corp"),
            "{}",
            check.message
        );
        assert!(check.message.contains("kb-approve"), "{}", check.message);
        // Without such a command, or without knowing the commands, nothing to warn about.
        let check = person(&inputs(&config, &environment, Some(&[])), &[]);
        assert_eq!(check.status, CheckStatus::Pass, "{}", check.message);
        let check = person(&inputs(&config, &environment, None), &[]);
        assert_eq!(check.status, CheckStatus::Pass, "{}", check.message);
    }

    #[test]
    fn principals_read_an_areas_approvers_and_the_memory_grants() {
        let text = format!(
            "{OAUTH}\n[plugins]\nenabled = [\"knowledge\", \"memory\"]\n\n[plugins.knowledge.config.areas.handbook]\nspace = \"main\"\ncollection = \"handbook\"\napprovers = [\"principal:human:corp/bo\", \"principal:human:cy\", \"group:eng\"]\n\n[plugins.memory]\nsource = \"compiled:memory\"\n[plugins.memory.grants.memory_write]\nallow = [\"main\"]\nerasers = [\"principal:human:dee\", \"principal:human:corp/bo\"]\n"
        )
        .replace("\"human:ada\", ", "");
        let check = principals(&config(&text));
        assert_eq!(check.status, CheckStatus::Fail, "{}", check.message);
        for orphan in [
            "`human:cy` in plugins.knowledge.config.areas.handbook.approvers",
            "`human:dee` in plugins.memory.grants.memory_write.erasers",
        ] {
            assert!(
                check.message.contains(orphan),
                "{orphan}: {}",
                check.message
            );
        }
        assert!(!check.message.contains("corp/bo"), "{}", check.message);
    }

    #[test]
    fn secrets_name_every_variable_and_never_a_value() {
        let text = format!(
            "{OAUTH}\n[plugins]\nenabled = [\"remote\"]\n\n[plugins.remote]\nsource = \"plugins/remote\"\nurl = \"https://mcp.example.com/mcp\"\nbearer_env = \"UMBEL_TEST_MOUNT_BEARER_UNSET\"\n"
        );
        let config = config(&text);
        let mut environment = AuthEnvironment::default();
        let check = secrets(&inputs(&config, &environment, None));
        assert_eq!(check.status, CheckStatus::Fail, "{}", check.message);
        assert!(
            check.message.contains(
                "UMBEL_TEST_MOUNT_BEARER_UNSET (plugins.remote.bearer_env) is unset or empty"
            ),
            "{}",
            check.message
        );
        environment.secrets.insert(
            "UMBEL_TEST_MOUNT_BEARER_UNSET".to_owned(),
            "bearer-canary-77".to_owned(),
        );
        let check = secrets(&inputs(&config, &environment, None));
        assert_eq!(check.status, CheckStatus::Pass, "{}", check.message);
        assert!(!check.message.contains("bearer-canary-77"));
    }

    #[test]
    fn remote_file_systems_are_told_from_local_ones() {
        for (magic, name) in [
            (0x6969, "NFS"),
            (0xFF53_4D42, "CIFS"),
            (0x6573_5546, "FUSE (which may be remote)"),
        ] {
            assert_eq!(linux_remote(magic), Some(name));
        }
        // ext4, XFS, Btrfs, tmpfs, overlayfs.
        for local in [0xEF53, 0x5846_5342, 0x9123_683E, 0x0102_1994, 0x794C_7630] {
            assert_eq!(linux_remote(local), None, "{local:x}");
        }
        for remote in ["nfs", "smbfs", "afpfs", "webdav", "macfuse"] {
            assert!(macos_remote(remote), "{remote}");
        }
        for local in ["apfs", "hfs", "tmpfs", "devfs"] {
            assert!(!macos_remote(local), "{local}");
        }
        // This test's own temporary directory is local.
        let temp = tempfile::tempdir().unwrap();
        assert!(!matches!(file_system(temp.path()), FileSystem::Remote(_)));
    }

    #[test]
    fn findings_report_failures_before_warnings_and_notes_last() {
        let mut found = Findings::default();
        found.warn("w");
        found.note("n");
        found.fail("f");
        let check = found.into_check("x", "ok", "s");
        assert_eq!(check.status, CheckStatus::Fail);
        assert_eq!(check.message, "f; w; n");
        let by = by_id(&[check]);
        assert_eq!(by["x"]["status"], json!("fail"));
        assert_eq!(
            listed(&(0..25).map(|i| i.to_string()).collect::<Vec<_>>())
                .matches(',')
                .count(),
            19
        );
    }
}
