//! The host's token verifier for mode `oauth` (phase 5 specification, sections 3.2 to 3.4 and
//! 4.1), built from `[auth]`.
//!
//! - **Routing** (rule 2). A compact JWS goes to AFD's `JwtVerifier`, which knows only the
//!   issuers with `verify = "jwt"` whose access tokens are accepted, so a JWS naming a login-only
//!   issuer, the introspection issuer or no issuer is `unknown-issuer`. Anything else goes to the
//!   one introspection issuer, or is `unknown-issuer` without one. A token is never sent to an
//!   issuer that did not issue it.
//! - **The rules.** AFD's `TokenRules`: the audience `http.public_url`, `auth.clock_skew_s`,
//!   `auth.max_token_lifetime_s`, at most 64 scopes under `auth.scope_prefix`, and
//!   `auth.require_bound_tokens`; each issuer's `algorithms`; the certificate the listener put in
//!   the request's extensions for rule 11.
//! - **The caller.** A verified token's claims are mapped (section 4.1, [`super::mapping`]) and
//!   the caller left in the request's [`CallerSlot`]; a token that cannot be mapped is refused
//!   here, as `claims`, so nothing runs for it. A request without a slot (a layer missing) is
//!   refused as `unavailable` before anything is verified.
//!
//! The token itself goes no further: only AFD's credentials and the mapped caller leave.

use std::sync::Arc;

use afd::Credentials;
use afd::server::auth::{
    AuthRefusal, ClientCertificate, JwtIssuer, JwtVerifier, RuleCode, SigningAlgorithm, TokenRules,
    TokenVerifier, is_compact_jws,
};
use async_trait::async_trait;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::{Map, Value};

use super::caller::CallerSlot;
use super::fetch::{AuthEnvironment, Fetcher};
use super::introspection::Introspector;
use super::keys::IssuerKeys;
use super::mapping;
use crate::workspace::{AccessGroup, AuthConfig, Config, IssuerConfig, TokenCheck, WorkspaceError};

/// The verifier of mode `oauth`.
pub(crate) struct HostVerifier {
    rules: TokenRules,
    jwt: Option<JwtVerifier>,
    introspection: Option<(IssuerConfig, Introspector)>,
    issuers: Vec<IssuerConfig>,
    auth: AuthConfig,
    groups: Vec<AccessGroup>,
}

impl std::fmt::Debug for HostVerifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HostVerifier")
            .field("jwt", &self.jwt)
            .field(
                "introspection",
                &self.introspection.as_ref().map(|(_, i)| i.alias()),
            )
            .finish_non_exhaustive()
    }
}

fn invalid(key: &str, message: impl std::fmt::Display) -> WorkspaceError {
    WorkspaceError::config_invalid(key, message)
}

fn algorithm(name: &str) -> Option<SigningAlgorithm> {
    Some(match name {
        "RS256" => SigningAlgorithm::RS256,
        "RS384" => SigningAlgorithm::RS384,
        "RS512" => SigningAlgorithm::RS512,
        "PS256" => SigningAlgorithm::PS256,
        "PS384" => SigningAlgorithm::PS384,
        "PS512" => SigningAlgorithm::PS512,
        "ES256" => SigningAlgorithm::ES256,
        "ES384" => SigningAlgorithm::ES384,
        "EdDSA" => SigningAlgorithm::EdDSA,
        _ => return None,
    })
}

/// AFD's claim rules from `[auth]` and `http.public_url`.
///
/// # Errors
/// `WORKSPACE_CONFIG_INVALID` naming the key AFD refuses.
pub(crate) fn token_rules(config: &Config) -> Result<TokenRules, WorkspaceError> {
    let auth = &config.auth;
    let resource = config.http.public_url.as_deref().ok_or_else(|| {
        invalid(
            "http.public_url",
            "is required when auth.mode is not \"none\"",
        )
    })?;
    TokenRules::new(resource)
        .map_err(|message| invalid("http.public_url", message))?
        .with_clock_skew_s(auth.clock_skew_s)
        .map_err(|message| invalid("auth.clock_skew_s", message))?
        .with_max_token_lifetime_s(auth.max_token_lifetime_s)
        .map_err(|message| invalid("auth.max_token_lifetime_s", message))?
        .with_scope_prefix(auth.scope_prefix.clone())
        .map_err(|message| invalid("auth.scope_prefix", message))?
        .with_scope_limit(super::MAX_TOKEN_SCOPES)
        .map_err(|message| invalid("auth.scope_prefix", message))
        .map(|rules| rules.with_require_bound_tokens(auth.require_bound_tokens))
}

impl HostVerifier {
    /// The verifier `config` describes, its clock, roots and timeout from `environment`, and the
    /// introspection secret read from the environment variable `[auth.issuers]` names. An
    /// issuer's `ca_file` is read under `root`, the workspace, and trusted for that issuer alone.
    ///
    /// # Errors
    /// `WORKSPACE_CONFIG_INVALID` naming the key that cannot be served: a rule AFD refuses, an
    /// algorithm it cannot verify, an introspection secret that is unset or empty, or a `ca_file`
    /// that cannot be read, holds no certificate, or holds one expired or not yet valid.
    pub(crate) fn from_config(
        config: &Config,
        root: &std::path::Path,
        environment: &AuthEnvironment,
    ) -> Result<Self, WorkspaceError> {
        let rules = token_rules(config)?;
        let platform =
            Fetcher::new(environment).map_err(|message| invalid("auth.issuers", message))?;
        let accepted: Vec<IssuerConfig> = config
            .auth
            .issuers
            .iter()
            .filter(|issuer| issuer.access_tokens)
            .cloned()
            .collect();
        let mut jwt_issuers = Vec::new();
        let mut introspection = None;
        for issuer in &accepted {
            let key = format!("auth.issuers.{}", issuer.alias);
            let fetcher = super::fetch::for_issuer(issuer, root, environment, &platform)
                .map_err(|problem| invalid(&format!("{key}.ca_file"), problem))?;
            match issuer.verify {
                TokenCheck::Jwt => {
                    let algorithms = issuer
                        .algorithms
                        .iter()
                        .map(|name| {
                            algorithm(name).ok_or_else(|| {
                                invalid(
                                    &format!("{key}.algorithms"),
                                    format!("names {name}, which cannot be verified"),
                                )
                            })
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    let keys = IssuerKeys::new(&issuer.alias, &issuer.issuer, fetcher, environment);
                    jwt_issuers.push(
                        JwtIssuer::new(
                            issuer.alias.clone(),
                            issuer.issuer.clone(),
                            algorithms,
                            keys,
                        )
                        .map_err(|message| invalid(&key, message))?,
                    );
                }
                TokenCheck::Introspection => {
                    let client = issuer.introspection.as_ref().ok_or_else(|| {
                        invalid(
                            &format!("{key}.introspection"),
                            "is required with verify = \"introspection\"",
                        )
                    })?;
                    let secret_key = format!("{key}.introspection.client_secret_env");
                    let secret = environment
                        .secrets
                        .get(&client.client_secret_env)
                        .cloned()
                        .or_else(|| std::env::var(&client.client_secret_env).ok())
                        .filter(|secret| !secret.is_empty())
                        .ok_or_else(|| {
                            invalid(
                                &secret_key,
                                format!(
                                    "names the environment variable {}, which is unset or empty, so no token could be introspected",
                                    client.client_secret_env
                                ),
                            )
                        })?;
                    let introspector = Introspector::new(
                        &issuer.alias,
                        &issuer.issuer,
                        &client.client_id,
                        &secret,
                        rules.clone(),
                        fetcher,
                        environment,
                    )
                    .map_err(|message| invalid(&secret_key, message))?;
                    introspection = Some((issuer.clone(), introspector));
                }
            }
        }
        let jwt = if jwt_issuers.is_empty() {
            None
        } else {
            Some(
                JwtVerifier::new(rules.clone(), jwt_issuers)
                    .map_err(|message| invalid("auth.issuers", message))?
                    .with_clock(ArcClock(Arc::clone(&environment.clock))),
            )
        };
        if jwt.is_none() && introspection.is_none() {
            return Err(invalid(
                "auth.issuers",
                "names no issuer whose access tokens are accepted, so no token could be verified",
            ));
        }
        Ok(Self {
            rules,
            jwt,
            introspection,
            issuers: accepted,
            auth: config.auth.clone(),
            groups: config.access.groups.clone(),
        })
    }

    /// Verify, returning the credentials, the issuer and the claims the mapping reads.
    async fn verified(
        &self,
        token: &str,
        certificate: Option<&str>,
    ) -> Result<(Credentials, &IssuerConfig, Map<String, Value>), AuthRefusal> {
        if is_compact_jws(token) {
            let Some(jwt) = &self.jwt else {
                return Err(AuthRefusal::new(RuleCode::UnknownIssuer));
            };
            let credentials = jwt.verify_token(token, certificate).await?;
            let issuer = self
                .issuers
                .iter()
                .find(|issuer| {
                    issuer.verify == TokenCheck::Jwt && issuer.issuer == credentials.issuer
                })
                .ok_or_else(|| AuthRefusal::new(RuleCode::UnknownIssuer))?;
            // The signature is verified, and AFD read this payload as one JSON object with
            // unique member names; it is read again here only for the claims the mapping needs.
            let claims = token
                .split('.')
                .nth(1)
                .and_then(|payload| URL_SAFE_NO_PAD.decode(payload).ok())
                .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                .and_then(|value| match value {
                    Value::Object(members) => Some(members),
                    _ => None,
                })
                .ok_or_else(|| {
                    AuthRefusal::new(RuleCode::Claims).with_issuer(issuer.alias.clone())
                })?;
            return Ok((credentials, issuer, claims));
        }
        let Some((issuer, introspector)) = &self.introspection else {
            return Err(AuthRefusal::new(RuleCode::UnknownIssuer));
        };
        let refuse = |rule: RuleCode| AuthRefusal::new(rule).with_issuer(issuer.alias.clone());
        let (credentials, claims) = introspector
            .verify(token, certificate)
            .await
            .map_err(refuse)?;
        Ok((credentials, issuer, claims))
    }
}

#[async_trait]
impl TokenVerifier for HostVerifier {
    async fn verify(
        &self,
        token: &str,
        request: &axum::http::request::Parts,
    ) -> Result<Credentials, AuthRefusal> {
        let Some(slot) = request.extensions.get::<CallerSlot>() else {
            tracing::error!(
                target: "umbel::auth",
                "refused a token on a request without the host's caller slot: a layer is missing"
            );
            return Err(AuthRefusal::new(RuleCode::Unavailable));
        };
        let certificate = request
            .extensions
            .get::<ClientCertificate>()
            .map(ClientCertificate::thumbprint);
        let (credentials, issuer, claims) = self.verified(token, certificate).await?;
        let caller = mapping::map(
            &self.auth,
            &self.groups,
            issuer,
            &claims,
            credentials.clone(),
        )
        .map_err(|reason| {
            tracing::warn!(
                target: "umbel::auth",
                issuer = issuer.alias.as_str(),
                reason = reason.code(),
                "refused a verified token that names no caller"
            );
            AuthRefusal::new(RuleCode::Claims).with_issuer(issuer.alias.clone())
        })?;
        if !slot.fill(caller) {
            tracing::error!(
                target: "umbel::auth",
                "refused a second verification on one request"
            );
            return Err(AuthRefusal::new(RuleCode::Unavailable));
        }
        Ok(credentials)
    }

    fn rules(&self) -> Option<&TokenRules> {
        Some(&self.rules)
    }
}

/// A shared clock as AFD's verifier takes one.
struct ArcClock(Arc<dyn afd::Clock>);

impl afd::Clock for ArcClock {
    fn now(&self) -> i64 {
        self.0.now()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::ConfigFile;

    const CONFIG: &str = r#"
config_version = 5
[principal]
local_id = "corp/ada"
[http]
public_url = "https://umbel.example.com/mcp"
allowed_hosts = ["umbel.example.com"]
[auth]
mode = "oauth"
[auth.namespaces.corp]
[auth.issuers.as]
issuer = "https://as.example.com"
namespace = "corp"
algorithms = ["ES256"]
"#;

    #[tokio::test]
    async fn a_request_without_the_hosts_caller_slot_is_refused_before_any_verification() {
        let config = ConfigFile::parse(CONFIG)
            .and_then(|file| file.into_config(std::path::Path::new("/w")))
            .unwrap();
        let verifier = HostVerifier::from_config(
            &config,
            std::path::Path::new("/w"),
            &AuthEnvironment::default(),
        )
        .unwrap();
        let (parts, ()) = axum::http::Request::new(()).into_parts();
        let refusal = verifier
            .verify("not-even-a-token", &parts)
            .await
            .unwrap_err();
        assert_eq!(refusal.rule, RuleCode::Unavailable);
        // With a slot, the same token is routed (and refused as no issuer's).
        let (mut parts, ()) = axum::http::Request::new(()).into_parts();
        parts.extensions.insert(CallerSlot::default());
        let refusal = verifier
            .verify("not-even-a-token", &parts)
            .await
            .unwrap_err();
        assert_eq!(refusal.rule, RuleCode::UnknownIssuer);
    }
}
