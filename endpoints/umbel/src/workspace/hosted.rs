//! What configuration version 5 adds (phase 5 specification, section 2.2; D107): `[auth]` with
//! its namespaces, issuers and gateway, `[http.tls]` and `http.public_url`, `[limits]`,
//! `[usage]`, `[principal.equivalents]` and a group's `claim`. The `memory_write` grant table's
//! `editors`, `erasers`, `erase_approvals` and `erase_approval_window_s` (sections 8.3 and 8.4)
//! are read with the rest of that table, in `plugins_config.rs`.
//!
//! This module parses, validates and stores them, with every rule section 2.2 checks at open,
//! each a `WORKSPACE_CONFIG_INVALID` naming the key. The listener (step 2a) and the verifier and
//! mapping (step 2b, `crate::auth`) act on them; the gateway, the person page, the remaining
//! limits and usage arrive in steps 3 to 9. The doctor's `auth.*` checks, which need the network,
//! the files or the environment, are step 2c's.

use std::collections::BTreeMap;
use std::net::SocketAddr;

use toml::{Table, Value};

use super::access::{ReaderEntry, parse_principal};
use super::config::{ConfigFile, HttpConfig, KeyScan, Reader, scan_table};
use super::error::WorkspaceError;
use super::plugins_config::is_env_name;
use super::space::SpaceId;
use crate::auth::{
    DEFAULT_ALGORITHMS, DEFAULT_CALLS_PER_MINUTE, DEFAULT_CLOCK_SKEW_S,
    DEFAULT_IP_REQUESTS_PER_MINUTE, DEFAULT_MAX_ASSERTION_AGE_S, DEFAULT_MAX_TOKEN_LIFETIME_S,
    DEFAULT_PERSON_MAX_AGE_S, DEFAULT_PERSON_PAGES_PER_HOUR, DEFAULT_READ_BYTES_PER_MINUTE,
    DEFAULT_SCOPE_PREFIX, DEFAULT_USAGE_RETENTION_DAYS, MAX_ASSERTION_AGE_S, MAX_CLOCK_SKEW_S,
    MAX_PERSON_MAX_AGE_S, MAX_TOKEN_LIFETIME_S, SIGNING_ALGORITHMS, Scope, UV_AMR_METHODS,
    is_alias, is_namespace, is_scope_prefix, split_namespaced,
};

/// The top-level tables configuration version 5 adds.
pub(super) const TOP_KEYS_V5: &[&str] = &["auth", "limits", "usage"];
/// `[http]`'s keys from version 5.
pub(super) const HTTP_KEYS_V5: &[&str] = &[
    "bind",
    "path",
    "allowed_hosts",
    "allowed_origins",
    "max_body_bytes",
    "public_url",
    "tls",
];
/// `[principal]`'s keys from version 5.
pub(super) const PRINCIPAL_KEYS_V5: &[&str] =
    &["local_id", "on_behalf_of", "agent_env", "equivalents"];
/// An access group's keys from version 5.
pub(super) const GROUP_KEYS_V5: &[&str] = &["members", "claim"];
const TLS_KEYS: &[&str] = &["cert", "key", "client_auth", "client_ca"];
const AUTH_KEYS: &[&str] = &[
    "mode",
    "scope_prefix",
    "filter_tools_by_scope",
    "clock_skew_s",
    "max_token_lifetime_s",
    "require_bound_tokens",
    "namespaces",
    "issuers",
    "gateway",
];
const NAMESPACE_KEYS: &[&str] = &["person"];
const PERSON_KEYS: &[&str] = &[
    "issuer",
    "client_id",
    "client_secret_env",
    "subject_claim",
    "max_age_s",
    "acr_values",
    "uv_amr",
];
const ISSUER_KEYS: &[&str] = &[
    "issuer",
    "namespace",
    "subject_claim",
    "verify",
    "algorithms",
    "delegation",
    "services",
    "introspection",
    "access_tokens",
];
const SERVICES_KEYS: &[&str] = &["clients", "claim"];
const CLAIM_MATCH_KEYS: &[&str] = &["name", "value"];
const INTROSPECTION_KEYS: &[&str] = &["client_id", "client_secret_env"];
const GATEWAY_KEYS: &[&str] = &[
    "alias",
    "namespace",
    "issuer",
    "keys",
    "client_cert_sha256",
    "max_assertion_age_s",
    "max_scopes",
];
const GROUP_CLAIM_KEYS: &[&str] = &["issuer", "name", "value"];
const LIMITS_KEYS: &[&str] = &[
    "ip_requests_per_minute",
    "calls_per_minute",
    "read_bytes_per_minute",
    "person_pages_per_hour",
];
const USAGE_KEYS: &[&str] = &["enabled", "readers", "retention_days"];
/// Claims that never become an id (4.1): OIDC Core 5.1's standard claims other than `sub`, which
/// are mutable or name no one, the common mutable ones that are not standard, and the registered
/// claims of a token that are not a subject.
const NOT_SUBJECT_CLAIMS: &[&str] = &[
    "name",
    "given_name",
    "family_name",
    "middle_name",
    "nickname",
    "preferred_username",
    "profile",
    "picture",
    "website",
    "email",
    "email_verified",
    "gender",
    "birthdate",
    "zoneinfo",
    "locale",
    "phone_number",
    "phone_number_verified",
    "address",
    "updated_at",
    "upn",
    "unique_name",
    "login_hint",
    "iss",
    "aud",
    "exp",
    "nbf",
    "iat",
    "jti",
    "typ",
    "scope",
    "scp",
    "azp",
    "acr",
    "amr",
    "auth_time",
    "nonce",
    "at_hash",
    "c_hash",
    "sid",
    "cnf",
    "act",
    "may_act",
    "client_id",
    "groups",
    "roles",
];
/// The longest OAuth identifier (a client id, an `acr` value, a claim name or value) read here.
const MAX_OAUTH_TEXT: usize = 255;
/// The longest file path read here.
const MAX_PATH_CHARS: usize = 4096;

/// `auth.mode`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum AuthMode {
    /// Today's loopback token (the default, and what versions 1 to 4 mean).
    #[default]
    None,
    /// An OAuth 2.1 resource server.
    Oauth,
    /// A verified gateway assertion.
    Gateway,
}

impl AuthMode {
    /// The configuration spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Oauth => "oauth",
            Self::Gateway => "gateway",
        }
    }

    /// Whether this is a hosted mode (`oauth` or `gateway`), where the hosted profile applies.
    pub fn is_hosted(self) -> bool {
        self != Self::None
    }
}

/// `[http.tls] client_auth`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ClientAuth {
    /// No client certificate is asked for (the default).
    #[default]
    None,
    /// A client certificate chaining to `client_ca` is required.
    Ca,
    /// Any client certificate, self-signed included, for RFC 8705 binding only.
    Any,
}

impl ClientAuth {
    /// The configuration spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Ca => "ca",
            Self::Any => "any",
        }
    }
}

/// `[http.tls]`: in-process TLS (section 6.2). The key is read from its file, never stored here.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct TlsConfig {
    /// The certificate chain file, PEM; relative paths are relative to the workspace.
    pub cert: String,
    /// The private key file, PEM.
    pub key: String,
    /// Whether and how a client certificate is asked for.
    pub client_auth: ClientAuth,
    /// The CA file client certificates chain to; set exactly when `client_auth = "ca"`.
    pub client_ca: Option<String>,
}

/// An issuer's `verify`: how its tokens are checked (3.2).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum TokenCheck {
    /// RFC 9068 JWT access tokens (the default).
    #[default]
    Jwt,
    /// RFC 7662 introspection of every token that is not a JWS; at most one issuer.
    Introspection,
}

impl TokenCheck {
    /// The configuration spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Jwt => "jwt",
            Self::Introspection => "introspection",
        }
    }
}

/// An issuer's `delegation` (4.3).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Delegation {
    /// `delegationChain` records the client only (the default); an `act` claim is ignored.
    #[default]
    None,
    /// `delegationChain` records the RFC 8693 `act` chain.
    Act,
}

impl Delegation {
    /// The configuration spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Act => "act",
        }
    }
}

/// A claim with an exact string value: `{ name, value }`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct ClaimMatch {
    /// The claim name.
    pub name: String,
    /// The exact value.
    pub value: String,
}

/// An issuer's `services` (4.1): how a service token is recognised beside `sub == client_id`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct ServicesConfig {
    /// Client ids whose tokens are service tokens.
    pub clients: Vec<String>,
    /// A claim whose exact value marks a service token.
    pub claim: Option<ClaimMatch>,
}

/// The credentials Umbel authenticates to the introspection endpoint with (3.2 rule 12).
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct IntrospectionClient {
    /// Umbel's client id at the issuer.
    pub client_id: String,
    /// The environment variable holding its secret (10.4).
    pub client_secret_env: String,
}

/// `[auth.issuers.<alias>]`: one trusted authorization server (3.2, 4.1).
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct IssuerConfig {
    /// The deployer's name for it, logged with a refused token's rule code.
    pub alias: String,
    /// The exact `iss` string, an absolute `https` URL.
    pub issuer: String,
    /// The identity namespace its subjects belong to.
    pub namespace: String,
    /// The claim that names a person; `sub` by default, never a mutable claim.
    pub subject_claim: String,
    /// How its tokens are checked.
    pub verify: TokenCheck,
    /// The JWS algorithms it signs with; RS256 by default.
    pub algorithms: Vec<String>,
    /// Whether its `act` chain is recorded.
    pub delegation: Delegation,
    /// How a service token is recognised; `None` when the file gives no `services`.
    pub services: Option<ServicesConfig>,
    /// The introspection client; set exactly when `verify = "introspection"`.
    pub introspection: Option<IntrospectionClient>,
    /// Whether its access tokens are accepted and the metadata names it; `false` for an issuer
    /// that only serves a person login (3.3, amendment from step 1). Required on an issuer that
    /// serves a person login, `false` in mode `gateway`, and true by default elsewhere.
    pub access_tokens: bool,
}

/// A namespace's `person`: the person login (7.2).
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct PersonLogin {
    /// An issuer alias of the same namespace, an OIDC provider.
    pub issuer: String,
    /// Umbel's client id there.
    pub client_id: String,
    /// The environment variable holding the client secret.
    pub client_secret_env: String,
    /// The ID token claim that must equal the caller's subject; `sub` by default.
    pub subject_claim: String,
    /// The most seconds since the login's `auth_time`.
    pub max_age_s: u64,
    /// The `acr` classes requested, each requiring user verification; never empty.
    pub acr_values: Vec<String>,
    /// RFC 8176 user-verification methods, one of which `amr` must contain; never empty.
    pub uv_amr: Vec<String>,
}

/// `[auth.namespaces.<ns>]`: one population of people with comparable subjects (4.1).
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct NamespaceConfig {
    /// The namespace, the prefix of its principal ids.
    pub id: String,
    /// Its person login, at most one.
    pub person: Option<PersonLogin>,
}

/// `[auth.gateway]` (4.4): mode `gateway` only.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct GatewayConfig {
    /// The gateway's alias, the principal's `issuer`.
    pub alias: String,
    /// The namespace its assertions map into.
    pub namespace: String,
    /// The assertion's exact `iss`.
    pub issuer: String,
    /// The pinned JWKS file.
    pub keys: String,
    /// The pinned client certificates' SHA-256, lowercase hex.
    pub client_cert_sha256: Vec<String>,
    /// How old an assertion's `iat` may be.
    pub max_assertion_age_s: u64,
    /// The scope ceiling.
    pub max_scopes: Vec<String>,
}

/// `[auth]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct AuthConfig {
    /// The mode; `none` in versions 1 to 4.
    pub mode: AuthMode,
    /// The prefix of Umbel's scopes.
    pub scope_prefix: String,
    /// Whether `tools/list` hides what the token cannot call.
    pub filter_tools_by_scope: bool,
    /// The clock skew allowed on token times.
    pub clock_skew_s: u64,
    /// The longest `exp - iat` accepted.
    pub max_token_lifetime_s: u64,
    /// Whether every token must be bound to the TLS client certificate.
    pub require_bound_tokens: bool,
    /// The identity namespaces, in configuration order.
    pub namespaces: Vec<NamespaceConfig>,
    /// The issuers, in configuration order.
    pub issuers: Vec<IssuerConfig>,
    /// The gateway, in mode `gateway`.
    pub gateway: Option<GatewayConfig>,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            mode: AuthMode::None,
            scope_prefix: DEFAULT_SCOPE_PREFIX.to_owned(),
            filter_tools_by_scope: true,
            clock_skew_s: DEFAULT_CLOCK_SKEW_S,
            max_token_lifetime_s: DEFAULT_MAX_TOKEN_LIFETIME_S,
            require_bound_tokens: false,
            namespaces: Vec::new(),
            issuers: Vec::new(),
            gateway: None,
        }
    }
}

impl AuthConfig {
    /// The issuer named `alias`.
    pub fn issuer(&self, alias: &str) -> Option<&IssuerConfig> {
        self.issuers.iter().find(|issuer| issuer.alias == alias)
    }

    /// Whether `ns` is a declared namespace.
    pub fn has_namespace(&self, ns: &str) -> bool {
        self.namespaces.iter().any(|namespace| namespace.id == ns)
    }

    /// Whether some namespace can produce the principal string `text` (4.1, 4.6): a `human`,
    /// `agent` or `service` whose id is `<ns>/<id>` for a declared namespace.
    pub fn produces(&self, text: &str) -> bool {
        matches!(parse_principal(text), Ok((kind, id))
            if ["human", "agent", "service"].contains(&kind)
                && split_namespaced(id).is_some_and(|(ns, _)| self.has_namespace(ns)))
    }
}

/// `[limits]`: the four rate limits of hosted modes (11).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub struct RateLimits {
    /// Requests per peer address per minute, before verification.
    pub ip_requests_per_minute: u64,
    /// Calls per verified issuer, subject and client per minute.
    pub calls_per_minute: u64,
    /// Result bytes per effective principal per minute.
    pub read_bytes_per_minute: u64,
    /// Person decisions begun per principal per hour.
    pub person_pages_per_hour: u64,
}

impl Default for RateLimits {
    fn default() -> Self {
        Self {
            ip_requests_per_minute: DEFAULT_IP_REQUESTS_PER_MINUTE,
            calls_per_minute: DEFAULT_CALLS_PER_MINUTE,
            read_bytes_per_minute: DEFAULT_READ_BYTES_PER_MINUTE,
            person_pages_per_hour: DEFAULT_PERSON_PAGES_PER_HOUR,
        }
    }
}

/// `[usage]`: content-free usage events (12.1).
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct UsageConfig {
    /// Whether usage events are written.
    pub enabled: bool,
    /// Principal strings and `group:<id>` entries that may read everyone's usage.
    pub readers: Vec<String>,
    /// How many days a month's file is kept.
    pub retention_days: u64,
}

impl Default for UsageConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            readers: Vec::new(),
            retention_days: DEFAULT_USAGE_RETENTION_DAYS,
        }
    }
}

/// An access group's `claim` (4.5): members from one issuer's token claim.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct GroupClaim {
    /// The issuer alias whose tokens carry the claim.
    pub issuer: String,
    /// The claim name; its value is a string or an array of strings.
    pub name: String,
    /// The exact value that makes a caller a member.
    pub value: String,
}

impl ConfigFile {
    /// `auth.mode`; `none` in versions 1 to 4.
    pub(crate) fn auth_mode(&self) -> Result<AuthMode, WorkspaceError> {
        if self.version() < 5 {
            return Ok(AuthMode::None);
        }
        let reader = Reader::new(self.section("auth")?, "auth");
        match reader.string("mode")?.as_deref() {
            None | Some("none") => Ok(AuthMode::None),
            Some("oauth") => Ok(AuthMode::Oauth),
            Some("gateway") => Ok(AuthMode::Gateway),
            Some(_) => Err(WorkspaceError::config_invalid(
                "auth.mode",
                "must be \"none\", \"oauth\" or \"gateway\"",
            )),
        }
    }

    /// `[http.tls]`, version 5.
    pub(super) fn tls(&self, http: Option<&Table>) -> Result<Option<TlsConfig>, WorkspaceError> {
        let key = "http.tls";
        let table = match http.and_then(|http| http.get("tls")) {
            None => return Ok(None),
            Some(Value::Table(table)) => table,
            Some(_) => return Err(WorkspaceError::config_invalid(key, "must be a table")),
        };
        let reader = Reader::new(Some(table), key);
        let path = |name: &str| -> Result<String, WorkspaceError> {
            let at = format!("{key}.{name}");
            let value = reader.string(name)?.ok_or_else(|| {
                WorkspaceError::config_invalid(&at, "is required: the path of a PEM file")
            })?;
            check_file_path(&value)
                .map_err(|problem| WorkspaceError::config_invalid(&at, problem))?;
            Ok(value)
        };
        let cert = path("cert")?;
        let key_file = path("key")?;
        let client_auth = match reader.string("client_auth")?.as_deref() {
            None | Some("none") => ClientAuth::None,
            Some("ca") => ClientAuth::Ca,
            Some("any") => ClientAuth::Any,
            Some(_) => {
                return Err(WorkspaceError::config_invalid(
                    "http.tls.client_auth",
                    "must be \"none\", \"ca\" or \"any\"",
                ));
            }
        };
        let client_ca = match (client_auth, table.contains_key("client_ca")) {
            (ClientAuth::Ca, true) => Some(path("client_ca")?),
            (ClientAuth::Ca, false) => {
                return Err(WorkspaceError::config_invalid(
                    "http.tls.client_ca",
                    "is required with client_auth = \"ca\": the CA file client certificates chain to",
                ));
            }
            (_, true) => {
                return Err(WorkspaceError::config_invalid(
                    "http.tls.client_ca",
                    "goes with client_auth = \"ca\" only",
                ));
            }
            (_, false) => None,
        };
        Ok(Some(TlsConfig {
            cert,
            key: key_file,
            client_auth,
            client_ca,
        }))
    }

    /// `[auth]`, version 5: every rule that needs only `[auth]` and the declared spaces.
    pub(crate) fn auth(&self, declared: Option<&[SpaceId]>) -> Result<AuthConfig, WorkspaceError> {
        let mode = self.auth_mode()?;
        let Some(table) = self.section("auth")?.filter(|_| self.version() >= 5) else {
            return Ok(AuthConfig::default());
        };
        let reader = Reader::new(Some(table), "auth");
        let scope_prefix = reader
            .string("scope_prefix")?
            .unwrap_or_else(|| DEFAULT_SCOPE_PREFIX.to_owned());
        if !is_scope_prefix(&scope_prefix) {
            return Err(WorkspaceError::config_invalid(
                "auth.scope_prefix",
                "must match ^[a-z][a-z0-9.-]{0,31}$",
            ));
        }
        let require_bound_tokens = reader.boolean("require_bound_tokens")?.unwrap_or(false);
        if require_bound_tokens && mode != AuthMode::Oauth {
            return Err(WorkspaceError::config_invalid(
                "auth.require_bound_tokens",
                "applies only to auth.mode = \"oauth\": only a token can be bound to a certificate",
            ));
        }
        let namespaces = namespaces(table)?;
        let issuers = issuers(table, &namespaces)?;
        for namespace in &namespaces {
            if let Some(person) = &namespace.person {
                let key = format!("auth.namespaces.{}.person.issuer", namespace.id);
                match issuers.iter().find(|issuer| issuer.alias == person.issuer) {
                    None => {
                        return Err(WorkspaceError::config_invalid(
                            &key,
                            format!(
                                "names `{}`, which no [auth.issuers.{}] table declares",
                                person.issuer, person.issuer
                            ),
                        ));
                    }
                    Some(issuer) if issuer.namespace != namespace.id => {
                        return Err(WorkspaceError::config_invalid(
                            &key,
                            format!(
                                "names `{}`, an issuer of namespace `{}`: a person login is at an issuer of its own namespace",
                                person.issuer, issuer.namespace
                            ),
                        ));
                    }
                    Some(_) => {}
                }
            }
        }
        for issuer in &issuers {
            let serves_login = namespaces.iter().any(|namespace| {
                namespace
                    .person
                    .as_ref()
                    .is_some_and(|person| person.issuer == issuer.alias)
            });
            let key = format!("auth.issuers.{}.access_tokens", issuer.alias);
            let declared = matches!(table.get("issuers"), Some(Value::Table(issuers))
                if matches!(issuers.get(&issuer.alias), Some(Value::Table(entry))
                    if entry.contains_key("access_tokens")));
            if serves_login && !declared {
                return Err(WorkspaceError::config_invalid(
                    &key,
                    "is required on an issuer that serves a person login: say whether its access tokens are accepted too (true) or it serves the login only (false), so a login issuer never accepts tokens by omission",
                ));
            }
            if !issuer.access_tokens && !serves_login {
                return Err(WorkspaceError::config_invalid(
                    &key,
                    "is false, but no namespace's person login is at this issuer: it would serve nothing",
                ));
            }
            if mode == AuthMode::Gateway && issuer.access_tokens {
                return Err(WorkspaceError::config_invalid(
                    &key,
                    "must be false in auth.mode = \"gateway\": no access token is accepted there, so an issuer serves only a person login",
                ));
            }
        }
        if mode == AuthMode::Oauth && !issuers.iter().any(|issuer| issuer.access_tokens) {
            return Err(WorkspaceError::config_invalid(
                "auth.issuers",
                "must declare at least one issuer whose access tokens are accepted when auth.mode = \"oauth\"",
            ));
        }
        let gateway = match (mode, table.get("gateway")) {
            (AuthMode::Gateway, Some(Value::Table(gateway))) => Some(self::gateway(
                gateway,
                &namespaces,
                &issuers,
                &scope_prefix,
                declared,
            )?),
            (AuthMode::Gateway, Some(_)) => {
                return Err(WorkspaceError::config_invalid(
                    "auth.gateway",
                    "must be a table",
                ));
            }
            (AuthMode::Gateway, None) => {
                return Err(WorkspaceError::config_invalid(
                    "auth.gateway",
                    "is required when auth.mode = \"gateway\"",
                ));
            }
            (_, Some(_)) => {
                return Err(WorkspaceError::config_invalid(
                    "auth.gateway",
                    "applies only to auth.mode = \"gateway\"",
                ));
            }
            (_, None) => None,
        };
        Ok(AuthConfig {
            mode,
            scope_prefix,
            filter_tools_by_scope: reader.boolean("filter_tools_by_scope")?.unwrap_or(true),
            clock_skew_s: reader
                .integer("clock_skew_s", 0, to_i64(MAX_CLOCK_SKEW_S))?
                .unwrap_or(DEFAULT_CLOCK_SKEW_S),
            max_token_lifetime_s: reader
                .integer("max_token_lifetime_s", 1, to_i64(MAX_TOKEN_LIFETIME_S))?
                .unwrap_or(DEFAULT_MAX_TOKEN_LIFETIME_S),
            require_bound_tokens,
            namespaces,
            issuers,
            gateway,
        })
    }

    /// `[limits]`, version 5.
    pub(super) fn rate_limits(&self) -> Result<RateLimits, WorkspaceError> {
        let reader = Reader::new(self.v5_section("limits")?, "limits");
        let defaults = RateLimits::default();
        let at_least_one = |key: &str, default: u64| -> Result<u64, WorkspaceError> {
            Ok(reader.integer(key, 1, i64::MAX)?.unwrap_or(default))
        };
        Ok(RateLimits {
            ip_requests_per_minute: at_least_one(
                "ip_requests_per_minute",
                defaults.ip_requests_per_minute,
            )?,
            calls_per_minute: at_least_one("calls_per_minute", defaults.calls_per_minute)?,
            read_bytes_per_minute: at_least_one(
                "read_bytes_per_minute",
                defaults.read_bytes_per_minute,
            )?,
            person_pages_per_hour: at_least_one(
                "person_pages_per_hour",
                defaults.person_pages_per_hour,
            )?,
        })
    }

    /// `[usage]`, version 5. Its groups are checked against `[access.groups]` in
    /// [`check_hosted`].
    pub(super) fn usage(&self) -> Result<UsageConfig, WorkspaceError> {
        let reader = Reader::new(self.v5_section("usage")?, "usage");
        let readers = reader.string_array("readers")?.unwrap_or_default();
        for (index, entry) in readers.iter().enumerate() {
            match ReaderEntry::parse(entry) {
                Ok(ReaderEntry::Anyone) => {
                    return Err(WorkspaceError::config_invalid(
                        "usage.readers",
                        "must not hold \"*\": everyone reads their own usage, and only named readers read everyone's",
                    ));
                }
                Ok(_) => {}
                Err(_) => {
                    return Err(WorkspaceError::config_invalid(
                        "usage.readers",
                        format!(
                            "entry `{entry}` must be a principal string <kind>:<id> or group:<id>"
                        ),
                    ));
                }
            }
            if readers[..index].contains(entry) {
                return Err(WorkspaceError::config_invalid(
                    "usage.readers",
                    format!("names `{entry}` twice"),
                ));
            }
        }
        Ok(UsageConfig {
            enabled: reader.boolean("enabled")?.unwrap_or(true),
            readers,
            retention_days: reader
                .integer("retention_days", 1, 36_500)?
                .unwrap_or(DEFAULT_USAGE_RETENTION_DAYS),
        })
    }

    /// `[principal.equivalents]`, version 5, in key order. Which side a namespace produces is
    /// checked against `[auth]` in [`check_hosted`].
    pub(super) fn equivalents(
        &self,
        principal: Option<&Table>,
    ) -> Result<BTreeMap<String, String>, WorkspaceError> {
        let key = "principal.equivalents";
        let table = match principal.and_then(|principal| principal.get("equivalents")) {
            None => return Ok(BTreeMap::new()),
            Some(Value::Table(table)) => table,
            Some(_) => return Err(WorkspaceError::config_invalid(key, "must be a table")),
        };
        let mut equivalents = BTreeMap::new();
        for (legacy, value) in table {
            let Value::String(namespaced) = value else {
                return Err(WorkspaceError::config_invalid(
                    key,
                    format!("maps `{legacy}` to something that is not a principal string"),
                ));
            };
            for text in [legacy, namespaced] {
                parse_principal(text)
                    .map_err(|problem| WorkspaceError::config_invalid(key, problem))?;
            }
            equivalents.insert(legacy.clone(), namespaced.clone());
        }
        Ok(equivalents)
    }

    /// A version 5 top-level table, or none in an older version (whose key scan refuses it).
    fn v5_section(&self, name: &str) -> Result<Option<&Table>, WorkspaceError> {
        if self.version() < 5 {
            return Ok(None);
        }
        self.section(name)
    }

    /// The unknown keys of what version 5 adds.
    pub(super) fn scan_v5(&self, table: &Table, scan: &mut KeyScan) {
        if let Some(Value::Table(http)) = table.get("http")
            && let Some(Value::Table(tls)) = http.get("tls")
        {
            scan_table(tls, "http.tls", TLS_KEYS, &[], scan);
        }
        for (name, keys) in [("limits", LIMITS_KEYS), ("usage", USAGE_KEYS)] {
            if let Some(Value::Table(section)) = table.get(name) {
                scan_table(section, name, keys, &[], scan);
            }
        }
        if let Some(Value::Table(access)) = table.get("access")
            && let Some(Value::Table(groups)) = access.get("groups")
        {
            for (id, group) in groups {
                if let Value::Table(group) = group
                    && let Some(Value::Table(claim)) = group.get("claim")
                {
                    let prefix = format!("access.groups.{id}.claim");
                    scan_table(claim, &prefix, GROUP_CLAIM_KEYS, &[], scan);
                }
            }
        }
        let Some(Value::Table(auth)) = table.get("auth") else {
            return;
        };
        scan_table(auth, "auth", AUTH_KEYS, &[], scan);
        let nested = |key: &str| match auth.get(key) {
            Some(Value::Table(entries)) => Some(entries),
            _ => None,
        };
        for (ns, entry) in nested("namespaces").into_iter().flatten() {
            if let Value::Table(entry) = entry {
                let prefix = format!("auth.namespaces.{ns}");
                scan_table(entry, &prefix, NAMESPACE_KEYS, &[], scan);
                if let Some(Value::Table(person)) = entry.get("person") {
                    scan_table(person, &format!("{prefix}.person"), PERSON_KEYS, &[], scan);
                }
            }
        }
        for (alias, entry) in nested("issuers").into_iter().flatten() {
            if let Value::Table(entry) = entry {
                let prefix = format!("auth.issuers.{alias}");
                scan_table(entry, &prefix, ISSUER_KEYS, &[], scan);
                if let Some(Value::Table(services)) = entry.get("services") {
                    let at = format!("{prefix}.services");
                    scan_table(services, &at, SERVICES_KEYS, &[], scan);
                    if let Some(Value::Table(claim)) = services.get("claim") {
                        scan_table(claim, &format!("{at}.claim"), CLAIM_MATCH_KEYS, &[], scan);
                    }
                }
                if let Some(Value::Table(client)) = entry.get("introspection") {
                    let at = format!("{prefix}.introspection");
                    scan_table(client, &at, INTROSPECTION_KEYS, &[], scan);
                }
            }
        }
        if let Some(gateway) = nested("gateway") {
            scan_table(gateway, "auth.gateway", GATEWAY_KEYS, &[], scan);
        }
    }
}

/// Whether the dotted key `key` is one configuration version 5 adds, for the message an older
/// version gives it.
pub(super) fn is_v5_key(key: &str) -> bool {
    let top = key.split('.').next().unwrap_or_default();
    let memory_write = key.starts_with("plugins.")
        && key.rsplit_once('.').is_some_and(|(table, name)| {
            table.ends_with(".grants.memory_write")
                && super::plugins_config::MEMORY_WRITE_GRANT_KEYS_V5.contains(&name)
        });
    TOP_KEYS_V5.contains(&top)
        || ["principal.equivalents", "http.public_url", "http.tls"].contains(&key)
        || (key.starts_with("access.groups.") && key.ends_with(".claim"))
        || memory_write
}

/// `[auth.namespaces]`.
fn namespaces(auth: &Table) -> Result<Vec<NamespaceConfig>, WorkspaceError> {
    let entries = match auth.get("namespaces") {
        None => return Ok(Vec::new()),
        Some(Value::Table(entries)) => entries,
        Some(_) => {
            return Err(WorkspaceError::config_invalid(
                "auth.namespaces",
                "must be a table",
            ));
        }
    };
    let mut parsed = Vec::new();
    for (id, value) in entries {
        let key = format!("auth.namespaces.{id}");
        if !is_namespace(id) {
            return Err(WorkspaceError::config_invalid(
                &key,
                "must have an id matching ^[a-z][a-z0-9-]{0,31}$",
            ));
        }
        let Value::Table(table) = value else {
            return Err(WorkspaceError::config_invalid(&key, "must be a table"));
        };
        let person = match table.get("person") {
            None => None,
            Some(Value::Table(person)) => Some(person_login(person, &format!("{key}.person"))?),
            Some(_) => {
                return Err(WorkspaceError::config_invalid(
                    &format!("{key}.person"),
                    "must be a table",
                ));
            }
        };
        parsed.push(NamespaceConfig {
            id: id.clone(),
            person,
        });
    }
    Ok(parsed)
}

/// A namespace's `person` (7.2, owner decision 6): user verification is mandatory, so
/// `acr_values` and `uv_amr` are required and non-empty, and `uv_amr` names only RFC 8176's
/// user-verification methods.
fn person_login(table: &Table, key: &str) -> Result<PersonLogin, WorkspaceError> {
    let reader = Reader::new(Some(table), key);
    let at = |name: &str| format!("{key}.{name}");
    let required = |name: &str, what: &str| -> Result<String, WorkspaceError> {
        reader.string(name)?.ok_or_else(|| {
            WorkspaceError::config_invalid(&at(name), format!("is required: {what}"))
        })
    };
    let issuer = required("issuer", "the alias of an issuer of this namespace")?;
    let client_id = required("client_id", "Umbel's client id at the identity provider")?;
    check_oauth_text(&client_id)
        .map_err(|p| WorkspaceError::config_invalid(&at("client_id"), p))?;
    let client_secret_env = required(
        "client_secret_env",
        "the environment variable holding the client secret",
    )?;
    check_env_key(&client_secret_env, &at("client_secret_env"))?;
    let subject_claim = reader
        .string("subject_claim")?
        .unwrap_or_else(|| "sub".to_owned());
    check_subject_claim(&subject_claim)
        .map_err(|p| WorkspaceError::config_invalid(&at("subject_claim"), p))?;
    let max_age_s = reader
        .integer("max_age_s", 1, to_i64(MAX_PERSON_MAX_AGE_S))?
        .unwrap_or(DEFAULT_PERSON_MAX_AGE_S);
    let acr_values = non_empty_list(
        &reader,
        "acr_values",
        &at("acr_values"),
        "the acr classes that require user verification (owner decision 6)",
    )?;
    for value in &acr_values {
        check_oauth_text(value)
            .map_err(|p| WorkspaceError::config_invalid(&at("acr_values"), p))?;
    }
    let uv_amr = non_empty_list(
        &reader,
        "uv_amr",
        &at("uv_amr"),
        "the RFC 8176 user-verification methods an ID token's amr must show (owner decision 6)",
    )?;
    for method in &uv_amr {
        if !UV_AMR_METHODS.contains(&method.as_str()) {
            return Err(WorkspaceError::config_invalid(
                &at("uv_amr"),
                format!(
                    "names `{method}`, which is not an RFC 8176 user-verification method; use {}",
                    UV_AMR_METHODS.join(", ")
                ),
            ));
        }
    }
    Ok(PersonLogin {
        issuer,
        client_id,
        client_secret_env,
        subject_claim,
        max_age_s,
        acr_values,
        uv_amr,
    })
}

/// `[auth.issuers]`.
fn issuers(
    auth: &Table,
    namespaces: &[NamespaceConfig],
) -> Result<Vec<IssuerConfig>, WorkspaceError> {
    let entries = match auth.get("issuers") {
        None => return Ok(Vec::new()),
        Some(Value::Table(entries)) => entries,
        Some(_) => {
            return Err(WorkspaceError::config_invalid(
                "auth.issuers",
                "must be a table",
            ));
        }
    };
    let mut parsed: Vec<IssuerConfig> = Vec::new();
    for (alias, value) in entries {
        let key = format!("auth.issuers.{alias}");
        if !is_alias(alias) {
            return Err(WorkspaceError::config_invalid(
                &key,
                "must have an alias matching ^[a-z][a-z0-9-]{0,62}$",
            ));
        }
        let Value::Table(table) = value else {
            return Err(WorkspaceError::config_invalid(&key, "must be a table"));
        };
        let issuer = issuer(alias, table, &key, namespaces)?;
        if let Some(other) = parsed.iter().find(|other| other.issuer == issuer.issuer) {
            return Err(WorkspaceError::config_invalid(
                &format!("{key}.issuer"),
                format!(
                    "`{}` is also the issuer of `{}`: a token's iss must name exactly one issuer",
                    issuer.issuer, other.alias
                ),
            ));
        }
        if issuer.verify == TokenCheck::Introspection
            && let Some(other) = parsed
                .iter()
                .find(|other| other.verify == TokenCheck::Introspection)
        {
            return Err(WorkspaceError::config_invalid(
                &format!("{key}.verify"),
                format!(
                    "is \"introspection\", as `{}`'s is: at most one issuer is introspected, so an opaque token never reaches an authorization server that did not issue it",
                    other.alias
                ),
            ));
        }
        parsed.push(issuer);
    }
    Ok(parsed)
}

fn issuer(
    alias: &str,
    table: &Table,
    key: &str,
    namespaces: &[NamespaceConfig],
) -> Result<IssuerConfig, WorkspaceError> {
    let reader = Reader::new(Some(table), key);
    let at = |name: &str| format!("{key}.{name}");
    let issuer = reader.string("issuer")?.ok_or_else(|| {
        WorkspaceError::config_invalid(&at("issuer"), "is required: the exact iss, an https URL")
    })?;
    split_https_url(&issuer).map_err(|p| WorkspaceError::config_invalid(&at("issuer"), p))?;
    let namespace = reader.string("namespace")?.ok_or_else(|| {
        WorkspaceError::config_invalid(&at("namespace"), "is required: a declared namespace")
    })?;
    if !namespaces.iter().any(|declared| declared.id == namespace) {
        return Err(WorkspaceError::config_invalid(
            &at("namespace"),
            format!("names `{namespace}`, which no [auth.namespaces.{namespace}] table declares"),
        ));
    }
    let subject_claim = reader
        .string("subject_claim")?
        .unwrap_or_else(|| "sub".to_owned());
    check_subject_claim(&subject_claim)
        .map_err(|p| WorkspaceError::config_invalid(&at("subject_claim"), p))?;
    let verify = match reader.string("verify")?.as_deref() {
        None | Some("jwt") => TokenCheck::Jwt,
        Some("introspection") => TokenCheck::Introspection,
        Some(_) => {
            return Err(WorkspaceError::config_invalid(
                &at("verify"),
                "must be \"jwt\" or \"introspection\"",
            ));
        }
    };
    let algorithms = match reader.string_array("algorithms")? {
        None => DEFAULT_ALGORITHMS.iter().map(|a| (*a).to_owned()).collect(),
        Some(list) if list.is_empty() => {
            return Err(WorkspaceError::config_invalid(
                &at("algorithms"),
                "must name at least one algorithm",
            ));
        }
        Some(list) => list,
    };
    for (index, algorithm) in algorithms.iter().enumerate() {
        if !SIGNING_ALGORITHMS.contains(&algorithm.as_str()) {
            let why = if algorithm.eq_ignore_ascii_case("none") || algorithm.starts_with("HS") {
                "is always refused: an access token is signed with a private key"
            } else {
                "is not an algorithm the verifier checks"
            };
            return Err(WorkspaceError::config_invalid(
                &at("algorithms"),
                format!(
                    "names `{algorithm}`, which {why}; use {}",
                    SIGNING_ALGORITHMS.join(", ")
                ),
            ));
        }
        if algorithms[..index].contains(algorithm) {
            return Err(WorkspaceError::config_invalid(
                &at("algorithms"),
                format!("names `{algorithm}` twice"),
            ));
        }
    }
    let delegation = match reader.string("delegation")?.as_deref() {
        None | Some("none") => Delegation::None,
        Some("act") => Delegation::Act,
        Some(_) => {
            return Err(WorkspaceError::config_invalid(
                &at("delegation"),
                "must be \"none\" or \"act\"",
            ));
        }
    };
    let services = match table.get("services") {
        None => None,
        Some(Value::Table(services)) => Some(self::services(services, &at("services"))?),
        Some(_) => {
            return Err(WorkspaceError::config_invalid(
                &at("services"),
                "must be a table",
            ));
        }
    };
    let access_tokens = reader.boolean("access_tokens")?.unwrap_or(true);
    let introspection = match (verify, table.get("introspection")) {
        (TokenCheck::Introspection, Some(Value::Table(client))) => {
            let at = at("introspection");
            let reader = Reader::new(Some(client), &at);
            let client_id = reader.string("client_id")?.ok_or_else(|| {
                WorkspaceError::config_invalid(&format!("{at}.client_id"), "is required")
            })?;
            check_oauth_text(&client_id)
                .map_err(|p| WorkspaceError::config_invalid(&format!("{at}.client_id"), p))?;
            let client_secret_env = reader.string("client_secret_env")?.ok_or_else(|| {
                WorkspaceError::config_invalid(&format!("{at}.client_secret_env"), "is required")
            })?;
            check_env_key(&client_secret_env, &format!("{at}.client_secret_env"))?;
            Some(IntrospectionClient {
                client_id,
                client_secret_env,
            })
        }
        (TokenCheck::Introspection, Some(_)) => {
            return Err(WorkspaceError::config_invalid(
                &at("introspection"),
                "must be a table",
            ));
        }
        (TokenCheck::Introspection, None) => {
            return Err(WorkspaceError::config_invalid(
                &at("introspection"),
                "is required with verify = \"introspection\": { client_id, client_secret_env }, the credentials Umbel authenticates to the endpoint with",
            ));
        }
        (TokenCheck::Jwt, Some(_)) => {
            return Err(WorkspaceError::config_invalid(
                &at("introspection"),
                "goes with verify = \"introspection\" only",
            ));
        }
        (TokenCheck::Jwt, None) => None,
    };
    if !access_tokens && verify == TokenCheck::Introspection {
        return Err(WorkspaceError::config_invalid(
            &at("access_tokens"),
            "must not be false with verify = \"introspection\": introspection checks access tokens",
        ));
    }
    Ok(IssuerConfig {
        alias: alias.to_owned(),
        issuer,
        namespace,
        subject_claim,
        verify,
        algorithms,
        delegation,
        services,
        introspection,
        access_tokens,
    })
}

fn services(table: &Table, key: &str) -> Result<ServicesConfig, WorkspaceError> {
    let reader = Reader::new(Some(table), key);
    let clients = reader.string_array("clients")?;
    let claim = match table.get("claim") {
        None => None,
        Some(Value::Table(claim)) => Some(claim_match(claim, &format!("{key}.claim"))?),
        Some(_) => {
            return Err(WorkspaceError::config_invalid(
                &format!("{key}.claim"),
                "must be a table { name, value }",
            ));
        }
    };
    if clients.is_none() && claim.is_none() {
        return Err(WorkspaceError::config_invalid(
            key,
            "must name clients, a claim or both; leave services out otherwise",
        ));
    }
    if clients.as_ref().is_some_and(Vec::is_empty) {
        return Err(WorkspaceError::config_invalid(
            &format!("{key}.clients"),
            "must name at least one client id; leave it out otherwise",
        ));
    }
    let clients = clients.unwrap_or_default();
    for (index, client) in clients.iter().enumerate() {
        check_oauth_text(client)
            .map_err(|p| WorkspaceError::config_invalid(&format!("{key}.clients"), p))?;
        if clients[..index].contains(client) {
            return Err(WorkspaceError::config_invalid(
                &format!("{key}.clients"),
                format!("names `{client}` twice"),
            ));
        }
    }
    Ok(ServicesConfig { clients, claim })
}

fn claim_match(table: &Table, key: &str) -> Result<ClaimMatch, WorkspaceError> {
    let reader = Reader::new(Some(table), key);
    let name = reader
        .string("name")?
        .ok_or_else(|| WorkspaceError::config_invalid(&format!("{key}.name"), "is required"))?;
    check_claim_name(&name)
        .map_err(|p| WorkspaceError::config_invalid(&format!("{key}.name"), p))?;
    let value = reader
        .string("value")?
        .ok_or_else(|| WorkspaceError::config_invalid(&format!("{key}.value"), "is required"))?;
    check_claim_value(&value)
        .map_err(|p| WorkspaceError::config_invalid(&format!("{key}.value"), p))?;
    Ok(ClaimMatch { name, value })
}

/// `[auth.gateway]` (4.4). Its channel rule, which needs `[http]`, is [`check_channel`]'s.
fn gateway(
    table: &Table,
    namespaces: &[NamespaceConfig],
    issuers: &[IssuerConfig],
    scope_prefix: &str,
    declared: Option<&[SpaceId]>,
) -> Result<GatewayConfig, WorkspaceError> {
    let key = "auth.gateway";
    let reader = Reader::new(Some(table), key);
    let at = |name: &str| format!("{key}.{name}");
    let required = |name: &str, what: &str| -> Result<String, WorkspaceError> {
        reader.string(name)?.ok_or_else(|| {
            WorkspaceError::config_invalid(&at(name), format!("is required: {what}"))
        })
    };
    let alias = required(
        "alias",
        "the gateway's name, which becomes the principal's issuer",
    )?;
    if !is_alias(&alias) {
        return Err(WorkspaceError::config_invalid(
            &at("alias"),
            "must match ^[a-z][a-z0-9-]{0,62}$",
        ));
    }
    if issuers.iter().any(|issuer| issuer.alias == alias) {
        return Err(WorkspaceError::config_invalid(
            &at("alias"),
            format!(
                "`{alias}` is also an issuer's alias; a principal's issuer must name one of them"
            ),
        ));
    }
    let namespace = required("namespace", "the namespace its assertions map into")?;
    if !namespaces.iter().any(|declared| declared.id == namespace) {
        return Err(WorkspaceError::config_invalid(
            &at("namespace"),
            format!("names `{namespace}`, which no [auth.namespaces.{namespace}] table declares"),
        ));
    }
    let issuer = required("issuer", "the assertion's exact iss, an https URL")?;
    split_https_url(&issuer).map_err(|p| WorkspaceError::config_invalid(&at("issuer"), p))?;
    if let Some(other) = issuers.iter().find(|other| other.issuer == issuer) {
        return Err(WorkspaceError::config_invalid(
            &at("issuer"),
            format!("`{issuer}` is also the issuer of `{}`", other.alias),
        ));
    }
    let keys = required("keys", "the pinned JWKS file")?;
    check_file_path(&keys).map_err(|p| WorkspaceError::config_invalid(&at("keys"), p))?;
    let client_cert_sha256 = reader
        .string_array("client_cert_sha256")?
        .unwrap_or_default();
    for (index, pin) in client_cert_sha256.iter().enumerate() {
        if pin.len() != 64
            || !pin
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(WorkspaceError::config_invalid(
                &at("client_cert_sha256"),
                format!("entry `{pin}` must be a SHA-256 in 64 lowercase hexadecimal digits"),
            ));
        }
        if client_cert_sha256[..index].contains(pin) {
            return Err(WorkspaceError::config_invalid(
                &at("client_cert_sha256"),
                format!("names `{pin}` twice"),
            ));
        }
    }
    let max_scopes = non_empty_list(
        &reader,
        "max_scopes",
        &at("max_scopes"),
        "the scope ceiling of every assertion",
    )?;
    for scope in &max_scopes {
        let parsed = Scope::parse(scope_prefix, scope).ok_or_else(|| {
            WorkspaceError::config_invalid(
                &at("max_scopes"),
                format!(
                    "entry `{scope}` must be {scope_prefix}:<verb> or {scope_prefix}:<verb>:<space>, with verb read, write, approve or erase"
                ),
            )
        })?;
        if let (Some(space), Some(declared)) = (&parsed.space, declared)
            && !declared.contains(space)
        {
            return Err(WorkspaceError::config_invalid(
                &at("max_scopes"),
                format!(
                    "entry `{scope}` names `{space}`, which no [spaces.{space}] table declares"
                ),
            ));
        }
    }
    Ok(GatewayConfig {
        alias,
        namespace,
        issuer,
        keys,
        client_cert_sha256,
        max_assertion_age_s: reader
            .integer("max_assertion_age_s", 1, to_i64(MAX_ASSERTION_AGE_S))?
            .unwrap_or(DEFAULT_MAX_ASSERTION_AGE_S),
        max_scopes,
    })
}

/// An access group's `claim` (4.5), version 5. Its issuer is checked against `[auth]` in
/// [`check_hosted`].
pub(super) fn group_claim(group: &Table, key: &str) -> Result<Option<GroupClaim>, WorkspaceError> {
    let at = format!("{key}.claim");
    let table = match group.get("claim") {
        None => return Ok(None),
        Some(Value::Table(table)) => table,
        Some(_) => {
            return Err(WorkspaceError::config_invalid(
                &at,
                "must be a table { issuer, name, value }",
            ));
        }
    };
    let reader = Reader::new(Some(table), &at);
    let issuer = reader.string("issuer")?.ok_or_else(|| {
        WorkspaceError::config_invalid(&format!("{at}.issuer"), "is required: an issuer alias")
    })?;
    let ClaimMatch { name, value } = claim_match(table, &at)?;
    Ok(Some(GroupClaim {
        issuer,
        name,
        value,
    }))
}

/// The rules section 2.2 checks across tables, once each table is valid on its own: the
/// gateway's channel and bound tokens against `[http]`, the operator id and `on_behalf_of`, the
/// equivalents, the group claims' issuers and the usage readers' groups.
pub(super) fn check_hosted(
    auth: &AuthConfig,
    http: &HttpConfig,
    local_id: &str,
    on_behalf_of: Option<&str>,
    equivalents: &BTreeMap<String, String>,
    groups: &[super::AccessGroup],
    usage: &UsageConfig,
) -> Result<(), WorkspaceError> {
    check_channel(auth, http)?;
    if auth.mode.is_hosted() {
        let namespaced = |key: &str, value: &str| -> Result<(), WorkspaceError> {
            match split_namespaced(value) {
                Some((ns, _)) if auth.has_namespace(ns) => Ok(()),
                _ => Err(WorkspaceError::config_invalid(
                    key,
                    format!(
                        "is `{value}`; in auth.mode = \"{}\" it must be <namespace>/<subject> for a declared namespace, so the operator at the CLI is the same principal as their hosted identity (section 4.6)",
                        auth.mode.as_str()
                    ),
                )),
            }
        };
        namespaced("principal.local_id", local_id)?;
        if let Some(person) = on_behalf_of {
            namespaced("principal.on_behalf_of", person)?;
        }
    }
    for (legacy, namespaced) in equivalents {
        let key = "principal.equivalents";
        let legacy_ns = parse_principal(legacy)
            .ok()
            .and_then(|(_, id)| id.split_once('/'))
            .map(|(ns, _)| ns);
        if legacy_ns.is_some_and(|ns| auth.has_namespace(ns)) {
            return Err(WorkspaceError::config_invalid(
                key,
                format!(
                    "maps `{legacy}`, which names a declared namespace: only a legacy principal that no namespace can produce maps to a namespaced one"
                ),
            ));
        }
        if !auth.produces(namespaced) {
            return Err(WorkspaceError::config_invalid(
                key,
                format!(
                    "maps `{legacy}` to `{namespaced}`, which no namespace can produce: the target is human, agent or service:<namespace>/<subject> for a declared namespace"
                ),
            ));
        }
        if equivalents.contains_key(namespaced) {
            return Err(WorkspaceError::config_invalid(
                key,
                format!(
                    "maps `{legacy}` to `{namespaced}`, which is mapped again: chains are refused"
                ),
            ));
        }
    }
    for group in groups {
        let Some(claim) = &group.claim else {
            continue;
        };
        let key = format!("access.groups.{}.claim.issuer", group.id);
        match auth.issuer(&claim.issuer) {
            Some(issuer) if issuer.access_tokens => {}
            Some(_) => {
                return Err(WorkspaceError::config_invalid(
                    &key,
                    format!(
                        "names `{}`, whose access tokens are not accepted: group claims come from access tokens",
                        claim.issuer
                    ),
                ));
            }
            None => {
                return Err(WorkspaceError::config_invalid(
                    &key,
                    format!(
                        "names `{}`, which no [auth.issuers.{}] table declares; groups never take members from a gateway",
                        claim.issuer, claim.issuer
                    ),
                ));
            }
        }
    }
    for entry in &usage.readers {
        if let Ok(ReaderEntry::Group(id)) = ReaderEntry::parse(entry)
            && !groups.iter().any(|group| group.id == id)
        {
            return Err(WorkspaceError::config_invalid(
                "usage.readers",
                format!("names group `{id}`, which no [access.groups.{id}] table declares"),
            ));
        }
    }
    Ok(())
}

/// The gateway's pinned channel and bound tokens, against `[http]` (2.2): `gateway` needs
/// `client_cert_sha256` and `client_auth = "ca"` unless the bind is loopback, and
/// `require_bound_tokens` needs a client certificate. Checked again after a bind override.
pub(super) fn check_channel(auth: &AuthConfig, http: &HttpConfig) -> Result<(), WorkspaceError> {
    let client_auth = http
        .tls
        .as_ref()
        .map_or(ClientAuth::None, |tls| tls.client_auth);
    if let Some(gateway) = &auth.gateway
        && !http.bind.ip().is_loopback()
    {
        if client_auth != ClientAuth::Ca {
            return Err(WorkspaceError::config_invalid(
                "http.tls.client_auth",
                "must be \"ca\" in auth.mode = \"gateway\" on a non-loopback bind: the gateway connects over a CA-validated, pinned channel",
            ));
        }
        if gateway.client_cert_sha256.is_empty() {
            return Err(WorkspaceError::config_invalid(
                "auth.gateway.client_cert_sha256",
                "is required on a non-loopback bind: the SHA-256 of each certificate the gateway may present",
            ));
        }
    }
    if auth.require_bound_tokens && client_auth == ClientAuth::None {
        return Err(WorkspaceError::config_invalid(
            "auth.require_bound_tokens",
            "needs [http.tls] with client_auth = \"ca\" or \"any\", so the client certificate reaches Umbel",
        ));
    }
    Ok(())
}

/// Whether `bind` may be non-loopback (2.2): only in a hosted mode with `[http.tls]`.
pub(super) fn check_bind(
    bind: SocketAddr,
    mode: AuthMode,
    tls: bool,
    value: &str,
    source: &str,
) -> Result<(), WorkspaceError> {
    if bind.ip().is_loopback() || (mode.is_hosted() && tls) {
        return Ok(());
    }
    Err(WorkspaceError::config_invalid(
        "http.bind",
        format!(
            "must be a loopback address (127.0.0.0/8 or ::1), not `{value}` (from {source}); a non-loopback bind needs config_version = 5 with auth.mode = \"oauth\" or \"gateway\" and [http.tls]"
        ),
    ))
}

/// `http.public_url` (2.2): `https`, lowercase, no user information, query or fragment, a host
/// one of `allowed_hosts` admits, and the path `http.path`.
pub(super) fn check_public_url(
    url: &str,
    path: &str,
    allowed_hosts: &[String],
) -> Result<(), String> {
    let (host, port, url_path) = split_https_url(url)?;
    if host.bytes().any(|b| b.is_ascii_uppercase()) {
        return Err(format!(
            "`{url}` must spell its host in lowercase, the canonical form"
        ));
    }
    if url_path != path {
        return Err(format!("`{url}` must have the path http.path, `{path}`"));
    }
    let admitted = allowed_hosts.iter().any(|entry| {
        split_authority(entry).is_some_and(|(allowed, allowed_port)| {
            allowed.eq_ignore_ascii_case(host) && allowed_port.is_none_or(|p| Some(p) == port)
        })
    });
    if !admitted {
        return Err(format!(
            "`{url}` names the host `{host}`, which no http.allowed_hosts entry admits"
        ));
    }
    Ok(())
}

/// An absolute `https` URL as an issuer or the resource is written: `https://host[:port][path]`
/// in visible ASCII, without user information, query or fragment. Returns the host, the port as
/// written and the path.
fn split_https_url(url: &str) -> Result<(&str, Option<&str>, &str), String> {
    let shape = || {
        format!("`{url}` must be an absolute https URL without user information, query or fragment")
    };
    if !url.bytes().all(|b| b.is_ascii_graphic())
        || url.contains(['?', '#', '@', '"', '\\', '<', '>', '`', '{', '}', '|', '^'])
    {
        return Err(shape());
    }
    let rest = url.strip_prefix("https://").ok_or_else(shape)?;
    let end = rest.find('/').unwrap_or(rest.len());
    let (authority, path) = rest.split_at(end);
    let (host, port) = split_authority(authority).ok_or_else(shape)?;
    Ok((host, port, path))
}

/// `host[:port]` or `[ipv6][:port]`: a host name or IP literal and a port of 1 to 65535.
fn split_authority(authority: &str) -> Option<(&str, Option<&str>)> {
    let (host, port) = if let Some(rest) = authority.strip_prefix('[') {
        let (ip, tail) = rest.split_once(']')?;
        ip.parse::<std::net::Ipv6Addr>().ok()?;
        let port = match tail {
            "" => None,
            _ => Some(tail.strip_prefix(':')?),
        };
        (&authority[..ip.len() + 2], port)
    } else {
        match authority.split_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (authority, None),
        }
    };
    let name_ok = host.starts_with('[')
        || (!host.is_empty()
            && !host.starts_with(['.', '-'])
            && host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-'));
    let port_ok = port.is_none_or(|port| port.parse::<u16>().is_ok_and(|p| p > 0));
    (name_ok && port_ok).then_some((host, port))
}

/// A file path read by the host (a certificate, a key, a CA, the gateway's JWKS): absolute, or
/// relative to the workspace and outside `state/`, which the host owns; no `..` segment.
fn check_file_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.chars().count() > MAX_PATH_CHARS
        || path.chars().any(char::is_control)
    {
        return Err(format!(
            "must be a path of 1 to {MAX_PATH_CHARS} characters without control characters"
        ));
    }
    if path.contains('\\') || path.split('/').any(|segment| segment == "..") {
        return Err(format!(
            "`{path}` must use / separators and hold no .. segment"
        ));
    }
    let first = path
        .split('/')
        .find(|segment| !segment.is_empty() && *segment != ".");
    if !path.starts_with('/') && first == Some("state") {
        return Err(format!("`{path}` is under state/, which the host owns"));
    }
    Ok(())
}

/// An `*_env` key (2.2, 10.4): the name of a variable, never a value.
fn check_env_key(name: &str, key: &str) -> Result<(), WorkspaceError> {
    if is_env_name(name) {
        Ok(())
    } else {
        Err(WorkspaceError::config_invalid(
            key,
            "must be an environment variable name such as UMBEL_PERSON_SECRET, never the secret itself",
        ))
    }
}

/// A client id or `acr` value: 1 to 255 visible ASCII characters.
fn check_oauth_text(text: &str) -> Result<(), String> {
    if text.is_empty() || text.len() > MAX_OAUTH_TEXT || !text.bytes().all(|b| b.is_ascii_graphic())
    {
        return Err(format!(
            "entry `{text}` must be 1 to {MAX_OAUTH_TEXT} visible ASCII characters with no space"
        ));
    }
    Ok(())
}

fn check_claim_name(name: &str) -> Result<(), String> {
    check_oauth_text(name).map_err(|_| {
        format!("`{name}` must be a claim name of 1 to {MAX_OAUTH_TEXT} visible ASCII characters")
    })
}

fn check_claim_value(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.chars().count() > MAX_OAUTH_TEXT
        || value.chars().any(char::is_control)
    {
        return Err(format!(
            "must be 1 to {MAX_OAUTH_TEXT} characters without control characters"
        ));
    }
    Ok(())
}

/// A `subject_claim` (4.1): a claim name that is not mutable and names someone.
fn check_subject_claim(name: &str) -> Result<(), String> {
    check_claim_name(name)?;
    if NOT_SUBJECT_CLAIMS.contains(&name) {
        return Err(format!(
            "is `{name}`, which is mutable or names no one: a principal id comes from a stable, non-pairwise subject such as sub or oid (section 4.1)"
        ));
    }
    Ok(())
}

/// A required, non-empty list of strings named once each.
fn non_empty_list(
    reader: &Reader<'_>,
    name: &str,
    key: &str,
    what: &str,
) -> Result<Vec<String>, WorkspaceError> {
    let list = reader
        .string_array(name)?
        .ok_or_else(|| WorkspaceError::config_invalid(key, format!("is required: {what}")))?;
    if list.is_empty() {
        return Err(WorkspaceError::config_invalid(
            key,
            format!("must not be empty: {what}"),
        ));
    }
    for (index, entry) in list.iter().enumerate() {
        if list[..index].contains(entry) {
            return Err(WorkspaceError::config_invalid(
                key,
                format!("names `{entry}` twice"),
            ));
        }
    }
    Ok(list)
}

fn to_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_urls() {
        let hosts = ["umbel.example.com".to_owned(), "other.test:8443".to_owned()];
        for ok in [
            "https://umbel.example.com/mcp",
            "https://umbel.example.com:9443/mcp",
            "https://other.test:8443/mcp",
        ] {
            assert!(check_public_url(ok, "/mcp", &hosts).is_ok(), "{ok}");
        }
        for bad in [
            "http://umbel.example.com/mcp",
            "HTTPS://umbel.example.com/mcp",
            "https://Umbel.example.com/mcp",
            "https://umbel.example.com/mcp?x=1",
            "https://umbel.example.com/mcp#a",
            "https://user@umbel.example.com/mcp",
            "https://umbel.example.com/mcp/",
            "https://umbel.example.com",
            "https://other.test/mcp",
            "https://other.test:9000/mcp",
            "https://elsewhere.test/mcp",
            "https://umbel.example.com:0/mcp",
            "https://umbel.example.com:99999/mcp",
            "https:// umbel.example.com/mcp",
        ] {
            assert!(check_public_url(bad, "/mcp", &hosts).is_err(), "{bad}");
        }
        let ipv6 = ["[::1]".to_owned()];
        assert!(check_public_url("https://[::1]:8443/mcp", "/mcp", &ipv6).is_ok());
    }

    #[test]
    fn file_paths() {
        for ok in [
            "secrets/tls/cert.pem",
            "/etc/umbel/key.pem",
            "./certs/a.pem",
        ] {
            assert!(check_file_path(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "a/../b",
            "state/keys/tls.pem",
            "./state/x",
            "a\\b",
            "a\nb",
        ] {
            assert!(check_file_path(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn subject_claims() {
        for ok in ["sub", "oid", "uid", "https://example.com/claims/id"] {
            assert!(check_subject_claim(ok).is_ok(), "{ok}");
        }
        for bad in [
            "email",
            "preferred_username",
            "upn",
            "name",
            "aud",
            "",
            "a b",
        ] {
            assert!(check_subject_claim(bad).is_err(), "{bad}");
        }
    }
}
