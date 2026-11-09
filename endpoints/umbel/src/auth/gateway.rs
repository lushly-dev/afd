//! Gateway-trusted mode (phase 5 specification, section 4.4; D114, owner decision 5): a gateway
//! is trusted only to say who authenticated, and only through both of these on every request.
//!
//! 1. **A pinned, authenticated channel** ([`GatewayVerifier::channel`]). With
//!    `http.tls.client_auth = "ca"` and `client_cert_sha256` (the pinned leg), the TLS handshake
//!    already chained the client certificate to `client_ca`, and its SHA-256 must be one of the
//!    pins. Otherwise (the loopback leg, which configuration admits only on a loopback bind) the
//!    connection's own local address must be loopback, whatever listener an embedder served on,
//!    and pins, when any are configured, must match too.
//! 2. **A per-request assertion** in `Umbel-Gateway-Assertion` ([`GatewayVerifier::verify`]):
//!    exactly one, a compact JWS of at most 4096 bytes whose header and claims are JSON objects
//!    with unique member names; `typ` exactly `umbel-gw+jwt`; section 3.2's rules 3 to 5 (AFD's
//!    own header and key checks) against the pinned key set, each key naming its `alg`; the
//!    signature under that key; `iss` the configured issuer, `aud` (a string or a one-element
//!    array) and `htu` exactly `http.public_url`, `htm` exactly the request's method; `sub` and
//!    `client` claim texts; `jti` of at least 128 bits; `scope` a non-empty, well-formed claim of
//!    at most 64 Umbel scopes; whole-second `iat` and `exp`, `iat` no later than now plus
//!    `auth.clock_skew_s` and no earlier than now minus `max_assertion_age_s`, `exp` after now
//!    and 1 to 60 seconds after `iat`, an `nbf`, when present, no later than now plus the skew;
//!    no `cnf` (an assertion is not a token, so no binding is checked or assumed). Last, the
//!    `jti` is spent once in the shared nonce store (`gateway:<jti>`), across every process
//!    behind one URL.
//!
//! **Mapping** (4.1 in the gateway's namespace): a service when `sub` equals `client`, else the
//! agent `<ns>/<client>` acting for the person `<ns>/<sub>`; the chain is the client; no claim
//! group, no `humanPresent`, `acr` or `auth_time` is ever taken from an assertion. **Scopes**
//! are the meet of the asserted Umbel scopes and `max_scopes` in the scope order ([`meet`]).
//!
//! Every refusal is one 401 that names no reason; the reason is logged at `warn` (target
//! `umbel::auth`) as the gateway's alias and a rule code ([`Rule`]), never a claim value or the
//! assertion. No identity header (`X-User` and the like) is ever read.

use std::collections::BTreeSet;
use std::fmt;
use std::path::Path;
use std::sync::Arc;

use afd::server::auth::{ClientCertificate, RuleCode, check_jws_header, check_key_fit};
use afd::{Actor, ActorKind, Credentials};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use jsonwebtoken::{Algorithm, DecodingKey};
use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Number, Value};

use super::caller::{ChainEntry, VerifiedCaller, Vouched, mapped_id};
use super::fetch::AuthEnvironment;
use super::files::{self, Secrecy};
use super::{MAX_ASSERTION_LIFETIME_S, MAX_TOKEN_SCOPES, Scope};
use crate::shared::SharedError;
use crate::shared::nonces::NonceStore;
use crate::surfaces::http::layers::LocalAddr;
use crate::workspace::{ClientAuth, Config, GatewayConfig, WorkspaceError};

/// The request header that carries the assertion (4.4), as `http` names it.
pub(crate) const ASSERTION_HEADER: &str = "umbel-gateway-assertion";
/// An assertion's `typ`, compared exactly.
pub(crate) const ASSERTION_TYP: &str = "umbel-gw+jwt";
/// The longest assertion read: a longer one is refused before it is decoded.
pub(crate) const MAX_ASSERTION_BYTES: usize = 4096;
/// The 401's `WWW-Authenticate` value (4.4).
pub(crate) const CHALLENGE: &str = "Umbel-Gateway realm=\"umbel\"";
/// The scheme of every challenge in mode `gateway` (4.4).
pub(crate) const SCHEME: &str = "Umbel-Gateway";
/// The `realm` of every challenge in mode `gateway` (4.4).
pub(crate) const REALM: &str = "umbel";

/// The challenge of every 403 in mode `gateway`, before dispatch (5.2) and at layer 6 alike:
/// `Umbel-Gateway realm="umbel", error="insufficient_scope", scope="<missing>"`. It is 4.4's
/// scheme and realm, since a gateway's caller holds no OAuth token to step up, with 3.3's
/// `error` and `scope` and no `resource_metadata`, since mode `gateway` publishes no metadata
/// (3.3). AFD renders it ([`afd::server::auth::ScopeChallenge`]), so `scope` names only scope
/// tokens and is left out rather than sent empty, as M5 says.
///
/// # Errors
/// Never for these constants; AFD's checks on a scheme and a parameter, should they change.
pub(crate) fn scope_challenge() -> Result<afd::server::auth::ScopeChallenge, String> {
    afd::server::auth::ScopeChallenge::new(SCHEME)?.with_param("realm", REALM)
}
/// The 401 body's suggestion (4.4).
pub(crate) const SUGGESTION: &str = "The gateway must connect with its pinned certificate and send a valid Umbel-Gateway-Assertion.";
/// The key prefix of a spent `jti` in the shared nonce store (section 10.2).
pub(crate) const NONCE_PREFIX: &str = "gateway:";
/// The most keys a pinned key set may hold.
const MAX_PINNED_KEYS: usize = 64;
/// The longest claim text (AFD's rule for `sub` and `client_id`).
const MAX_CLAIM_CHARS: usize = afd::server::auth::MAX_CLAIM_CHARS;
/// The fewest base64url characters a `jti` may have: 22 carry 128 bits.
const MIN_JTI_CHARS: usize = 22;
/// The fewest hexadecimal digits a `jti` written in hexadecimal (with or without hyphens, as a
/// UUID is) may have: 32 carry 128 bits.
const MIN_JTI_HEX_DIGITS: usize = 32;
/// Members only a private or symmetric JWK has: a pinned key set must hold public keys only.
const PRIVATE_MEMBERS: &[&str] = &["d", "p", "q", "dp", "dq", "qi", "oth", "k"];

/// Why a gateway request was refused: logged as its code, never sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Rule {
    /// The connection is not the pinned channel: no pinned certificate, or not loopback.
    Channel,
    /// No `Umbel-Gateway-Assertion` header.
    NoAssertion,
    /// More than one, one longer than 4096 bytes, or one that is not a compact JWS.
    AssertionMalformed,
    /// The header is not one JSON object with unique members, or `typ` is not `umbel-gw+jwt`.
    Typ,
    /// `alg` is none of the pinned keys' algorithms.
    Alg,
    /// No `kid`.
    Kid,
    /// A `crit` header.
    Crit,
    /// `jku`, `x5u`, `x5c` or `jwk`.
    KeyReference,
    /// No pinned key with that `kid`, or one that does not fit the header.
    Key,
    /// The signature does not verify.
    Signature,
    /// `iss` is not the configured issuer.
    Issuer,
    /// `aud` is not exactly the public URL.
    Audience,
    /// `htm` is not exactly the request's method.
    Htm,
    /// `htu` is not exactly the public URL.
    Htu,
    /// The claims are not one JSON object with unique members, or a required claim is missing
    /// or not of its form.
    Claims,
    /// The `jti` is too short to carry 128 bits.
    Jti,
    /// `iat`, or `nbf`, is in the future beyond the clock skew.
    NotYetValid,
    /// `exp` is not 1 to 60 seconds after `iat`.
    Lifetime,
    /// `exp` has passed.
    Expired,
    /// `iat` is older than `max_assertion_age_s`.
    TooOld,
    /// A malformed `scope` claim.
    ScopeMalformed,
    /// More than 64 Umbel scopes.
    ScopesTooMany,
    /// A `cnf` claim: an assertion is never bound.
    Binding,
    /// The `jti` was already spent.
    Replayed,
    /// The request reached the gateway layer without the host's caller slot: a layer is missing.
    Unavailable,
}

impl Rule {
    /// The rule code as logged.
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Channel => "channel",
            Self::NoAssertion => "no-assertion",
            Self::AssertionMalformed => "assertion-malformed",
            Self::Typ => "typ",
            Self::Alg => "alg",
            Self::Kid => "kid",
            Self::Crit => "crit",
            Self::KeyReference => "key-reference",
            Self::Key => "key",
            Self::Signature => "signature",
            Self::Issuer => "issuer",
            Self::Audience => "audience",
            Self::Htm => "htm",
            Self::Htu => "htu",
            Self::Claims => "claims",
            Self::Jti => "jti",
            Self::NotYetValid => "not-yet-valid",
            Self::Lifetime => "lifetime",
            Self::Expired => "expired",
            Self::TooOld => "too-old",
            Self::ScopeMalformed => "scope-malformed",
            Self::ScopesTooMany => "scopes-too-many",
            Self::Binding => "binding",
            Self::Replayed => "replayed",
            Self::Unavailable => "unavailable",
        }
    }

    /// AFD's header and key rule codes, as this module names them.
    fn from_afd(rule: RuleCode) -> Self {
        match rule {
            RuleCode::Typ => Self::Typ,
            RuleCode::Alg => Self::Alg,
            RuleCode::Kid => Self::Kid,
            RuleCode::Crit => Self::Crit,
            RuleCode::KeyReference => Self::KeyReference,
            // `check_key_fit` and anything else it may add refuse the key.
            _ => Self::Key,
        }
    }
}

impl fmt::Display for Rule {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

/// Why [`GatewayVerifier::verify`] refused a request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Refusal {
    /// A rule was broken: 401.
    Rule(Rule),
    /// The shared nonce store could not spend the `jti`; nothing was spent and the request fails
    /// closed, never as a replay.
    Shared(SharedError),
}

impl From<Rule> for Refusal {
    fn from(rule: Rule) -> Self {
        Self::Rule(rule)
    }
}

/// One pinned key: its `kid`, its algorithm and its verification key.
struct PinnedKey {
    kid: String,
    alg: Algorithm,
    alg_name: &'static str,
    key: DecodingKey,
}

/// The gateway's pinned key set (`[auth.gateway] keys`), read once at start.
///
/// Stricter than an issuer's published set, since the deployer writes it: a JSON object with
/// unique member names whose `keys` hold 1 to 64 public keys, every one usable. Each names a
/// unique non-empty `kid` and its `alg` (one of AFD's signing algorithms; rule 3's allow-list is
/// the pinned keys' own algorithms, as the gateway has no `algorithms` key), fits that `alg`
/// (AFD's `check_key_fit`: `kty` and curve, `use` `sig`, `key_ops` with `verify`), holds key
/// material that verifies, and no private member. One key that is not so refuses the whole file.
pub(crate) struct PinnedKeys {
    keys: Vec<PinnedKey>,
}

impl fmt::Debug for PinnedKeys {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PinnedKeys")
            .field("keys", &self.keys.len())
            .finish()
    }
}

impl PinnedKeys {
    /// Read the gateway's `keys` file under `root`: a regular file of at most 1 MiB, writable by
    /// no one but its owner (this user or root) in a directory others cannot write, checked on the
    /// file that was opened ([`files::read_trusted`]), holding a pinned key set ([`Self::parse`]).
    ///
    /// # Errors
    /// What is wrong, naming the path and never the file's contents.
    pub(crate) fn load(root: &Path, gateway: &GatewayConfig) -> Result<Self, String> {
        let path = root.join(&gateway.keys);
        let bytes = files::read_trusted(&path, Secrecy::Public).map_err(|problem| {
            if problem.contains("writable") || problem.contains("owned by") {
                format!(
                    "{problem}, so someone else could add a key the gateway's assertions are trusted under"
                )
            } else {
                problem
            }
        })?;
        Self::parse(&bytes).map_err(|problem| format!("{}: {problem}", path.display()))
    }

    /// A pinned key set from its JSON text.
    ///
    /// # Errors
    /// What is wrong, naming the key by its place and never its material.
    pub(crate) fn parse(bytes: &[u8]) -> Result<Self, String> {
        let Some(document) = strict_object(bytes) else {
            return Err(
                "is not a JSON object with unique member names (a JWKS, RFC 7517 5)".to_owned(),
            );
        };
        let Some(Value::Array(entries)) = document.get("keys") else {
            return Err("has no \"keys\" array".to_owned());
        };
        if entries.is_empty() {
            return Err("pins no key".to_owned());
        }
        if entries.len() > MAX_PINNED_KEYS {
            return Err(format!("pins more than {MAX_PINNED_KEYS} keys"));
        }
        let mut keys: Vec<PinnedKey> = Vec::new();
        for (index, entry) in entries.iter().enumerate() {
            let at = format!("key {}", index + 1);
            let Some(members) = entry.as_object() else {
                return Err(format!("{at} is not a JSON object"));
            };
            let kid = members
                .get("kid")
                .and_then(Value::as_str)
                .filter(|kid| !kid.is_empty())
                .ok_or_else(|| format!("{at} has no kid"))?;
            if keys.iter().any(|key| key.kid == kid) {
                return Err(format!("{at} repeats an earlier key's kid"));
            }
            if let Some(member) = PRIVATE_MEMBERS
                .iter()
                .find(|member| members.contains_key(**member))
            {
                return Err(format!(
                    "{at} holds the private or symmetric member \"{member}\": pin public keys only"
                ));
            }
            let (alg, alg_name) = members
                .get("alg")
                .and_then(Value::as_str)
                .and_then(signing_algorithm)
                .ok_or_else(|| {
                    format!(
                        "{at} names no alg among RS256, RS384, RS512, PS256, PS384, PS512, ES256, ES384 and EdDSA"
                    )
                })?;
            let header = serde_json::json!({ "alg": alg_name, "kid": kid });
            check_key_fit(&header, Some(entry))
                .map_err(|_| format!("{at} does not fit its alg (kty, crv, use or key_ops)"))?;
            let key = decoding_key(alg, entry)
                .ok_or_else(|| format!("{at} holds key material that cannot verify (an RSA modulus of 2048 to 8192 bits and an exponent of at least 3, or a point on its curve)"))?;
            keys.push(PinnedKey {
                kid: kid.to_owned(),
                alg,
                alg_name,
                key,
            });
        }
        Ok(Self { keys })
    }

    /// How many keys are pinned.
    pub(crate) fn len(&self) -> usize {
        self.keys.len()
    }

    /// The pinned keys' algorithms, each once: rule 3's allow-list.
    fn algorithms(&self) -> Vec<&'static str> {
        let mut names: Vec<&'static str> = Vec::new();
        for key in &self.keys {
            if !names.contains(&key.alg_name) {
                names.push(key.alg_name);
            }
        }
        names
    }

    fn get(&self, kid: &str) -> Option<&PinnedKey> {
        self.keys.iter().find(|key| key.kid == kid)
    }
}

/// AFD's signing algorithms, as `jsonwebtoken` names them (`none`, `HS*`, `ES512` and Ed448
/// are not among them).
fn signing_algorithm(name: &str) -> Option<(Algorithm, &'static str)> {
    Some(match name {
        "RS256" => (Algorithm::RS256, "RS256"),
        "RS384" => (Algorithm::RS384, "RS384"),
        "RS512" => (Algorithm::RS512, "RS512"),
        "PS256" => (Algorithm::PS256, "PS256"),
        "PS384" => (Algorithm::PS384, "PS384"),
        "PS512" => (Algorithm::PS512, "PS512"),
        "ES256" => (Algorithm::ES256, "ES256"),
        "ES384" => (Algorithm::ES384, "ES384"),
        "EdDSA" => (Algorithm::EdDSA, "EdDSA"),
        _ => return None,
    })
}

/// The smallest and largest RSA modulus a pinned key may have, in bits (AFD's verifier, through
/// `aws-lc-rs`, verifies nothing outside them).
const RSA_MODULUS_BITS: std::ops::RangeInclusive<usize> = 2048..=8192;

/// The verification key of a JWK that fits `alg`, or `None` when its material could never
/// verify: base64url that is not strict, an RSA modulus outside 2048 to 8192 bits or an
/// exponent below 3, an EC point of the wrong length or off its curve, or an Ed25519 key that
/// does not parse. The EC and Ed25519 material is parsed by `aws-lc-rs` itself, the library that
/// verifies the signatures.
fn decoding_key(alg: Algorithm, jwk: &Value) -> Option<DecodingKey> {
    use aws_lc_rs::signature::{self, ParsedPublicKey};
    let member = |name: &str| {
        jwk.get(name)
            .and_then(Value::as_str)
            .and_then(|text| URL_SAFE_NO_PAD.decode(text).ok())
            .filter(|bytes| !bytes.is_empty())
    };
    match alg {
        Algorithm::RS256
        | Algorithm::RS384
        | Algorithm::RS512
        | Algorithm::PS256
        | Algorithm::PS384
        | Algorithm::PS512 => {
            let (n, e) = (member("n")?, member("e")?);
            (RSA_MODULUS_BITS.contains(&bit_length(&n)) && !below_3(&e))
                .then(|| DecodingKey::from_rsa_raw_components(&n, &e))
        }
        Algorithm::ES256 | Algorithm::ES384 => {
            let (size, curve): (usize, &'static dyn signature::VerificationAlgorithm) =
                if alg == Algorithm::ES256 {
                    (32, &signature::ECDSA_P256_SHA256_FIXED)
                } else {
                    (48, &signature::ECDSA_P384_SHA384_FIXED)
                };
            let (x, y) = (member("x")?, member("y")?);
            if x.len() != size || y.len() != size {
                return None;
            }
            let mut point = Vec::with_capacity(1 + 2 * size);
            point.push(0x04);
            point.extend_from_slice(&x);
            point.extend_from_slice(&y);
            ParsedPublicKey::new(curve, &point).ok()?;
            Some(DecodingKey::from_ec_der(&point))
        }
        Algorithm::EdDSA => {
            if jwk.get("crv").and_then(Value::as_str) != Some("Ed25519") {
                return None;
            }
            let x = member("x")?;
            if x.len() != 32 {
                return None;
            }
            ParsedPublicKey::new(&signature::ED25519, &x).ok()?;
            Some(DecodingKey::from_ed_der(&x))
        }
        _ => None,
    }
}

/// The number of significant bits of a big-endian unsigned integer.
fn bit_length(bytes: &[u8]) -> usize {
    let Some(first) = bytes.iter().position(|byte| *byte != 0) else {
        return 0;
    };
    (bytes.len() - first - 1) * 8 + (8 - bytes[first].leading_zeros() as usize)
}

/// Whether a big-endian unsigned integer is below 3.
fn below_3(bytes: &[u8]) -> bool {
    bit_length(bytes) <= 1 || (bit_length(bytes) == 2 && bytes[bytes.len() - 1] < 3)
}

/// The meet of `granted` and `ceiling` in the scope order (4.4, 5.1), exactly as section 4.4
/// defines it: a granted scope is kept when some ceiling scope implies it, and a ceiling scope is
/// kept when some granted scope implies it. Granted scopes first, then ceiling scopes, each once.
/// So `write` asserted under a ceiling of `write:alpha` yields `write:alpha`. Never wider than
/// either side: every scope kept is implied by both.
pub(crate) fn meet(granted: &[Scope], ceiling: &[Scope]) -> Vec<Scope> {
    let mut kept: Vec<Scope> = Vec::new();
    let mut push = |scope: &Scope| {
        if !kept.contains(scope) {
            kept.push(scope.clone());
        }
    };
    for scope in granted {
        if ceiling.iter().any(|limit| limit.implies(scope)) {
            push(scope);
        }
    }
    for scope in ceiling {
        if granted.iter().any(|held| held.implies(scope)) {
            push(scope);
        }
    }
    kept
}

/// The gateway's verifier, built once from `[auth.gateway]`.
pub(crate) struct GatewayVerifier {
    alias: String,
    namespace: String,
    issuer: String,
    public_url: String,
    prefix: String,
    max_age_s: i64,
    skew_s: i64,
    ceiling: Vec<Scope>,
    pins: BTreeSet<String>,
    /// The pinned leg: `client_auth = "ca"` with pins. Otherwise the loopback leg.
    pinned_leg: bool,
    keys: PinnedKeys,
    nonces: Arc<dyn NonceStore>,
    clock: Arc<dyn afd::Clock>,
}

impl fmt::Debug for GatewayVerifier {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GatewayVerifier")
            .field("alias", &self.alias)
            .field("pinned_leg", &self.pinned_leg)
            .field("keys", &self.keys)
            .finish_non_exhaustive()
    }
}

fn invalid(key: &str, message: impl fmt::Display) -> WorkspaceError {
    WorkspaceError::config_invalid(key, message)
}

impl GatewayVerifier {
    /// The verifier `config`'s `[auth.gateway]` describes: its pinned key set read under `root`,
    /// its times on `environment`'s clock (the system clock in a shipped build), its `jti`s spent
    /// in `nonces`.
    ///
    /// # Errors
    /// `WORKSPACE_CONFIG_INVALID` naming `auth.gateway` when the mode has no gateway,
    /// `auth.gateway.keys` when the pinned key set cannot be used, or `http.public_url`.
    pub(crate) fn from_config(
        config: &Config,
        root: &Path,
        environment: &AuthEnvironment,
        nonces: Arc<dyn NonceStore>,
    ) -> Result<Self, WorkspaceError> {
        let gateway =
            config.auth.gateway.as_ref().ok_or_else(|| {
                invalid("auth.gateway", "is required when auth.mode = \"gateway\"")
            })?;
        let public_url = config.http.public_url.clone().ok_or_else(|| {
            invalid(
                "http.public_url",
                "is required when auth.mode is not \"none\"",
            )
        })?;
        let keys = PinnedKeys::load(root, gateway)
            .map_err(|problem| invalid("auth.gateway.keys", problem))?;
        let prefix = config.auth.scope_prefix.clone();
        let ceiling = gateway
            .max_scopes
            .iter()
            .map(|scope| {
                Scope::parse(&prefix, scope).ok_or_else(|| {
                    invalid(
                        "auth.gateway.max_scopes",
                        format!("entry `{scope}` is not a scope under {prefix}"),
                    )
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let client_auth = config
            .http
            .tls
            .as_ref()
            .map_or(ClientAuth::None, |tls| tls.client_auth);
        let pins: BTreeSet<String> = gateway.client_cert_sha256.iter().cloned().collect();
        Ok(Self {
            alias: gateway.alias.clone(),
            namespace: gateway.namespace.clone(),
            issuer: gateway.issuer.clone(),
            public_url,
            prefix,
            max_age_s: i64::try_from(gateway.max_assertion_age_s).unwrap_or(i64::MAX),
            skew_s: i64::try_from(config.auth.clock_skew_s).unwrap_or(i64::MAX),
            ceiling,
            pinned_leg: client_auth == ClientAuth::Ca && !pins.is_empty(),
            pins,
            keys,
            nonces,
            clock: Arc::clone(&environment.clock),
        })
    }

    /// The gateway's alias, for the log.
    pub(crate) fn alias(&self) -> &str {
        &self.alias
    }

    /// The scope prefix.
    pub(crate) fn prefix(&self) -> &str {
        &self.prefix
    }

    /// Rule 1 of 4.4, from the connection's facts the listener put in `extensions` (never from
    /// a header): the pinned leg needs a client certificate whose SHA-256 is pinned; the loopback
    /// leg needs the connection's local address to be loopback, and a pinned certificate too when
    /// any pin is configured.
    ///
    /// # Errors
    /// [`Rule::Channel`].
    pub(crate) fn channel(&self, extensions: &http::Extensions) -> Result<(), Rule> {
        if channel_allows(self.pinned_leg, &self.pins, extensions) {
            Ok(())
        } else {
            Err(Rule::Channel)
        }
    }

    /// Verify the request whose head is `parts`: the channel, then the one assertion, then spend
    /// its `jti`. The credentials AFD is to admit, and the caller they map to.
    ///
    /// # Errors
    /// The first broken [`Rule`], or the shared store's failure.
    pub(crate) async fn verify(
        &self,
        parts: &http::request::Parts,
    ) -> Result<(Credentials, VerifiedCaller), Refusal> {
        self.channel(&parts.extensions)?;
        let mut values = parts.headers.get_all(ASSERTION_HEADER).iter();
        let assertion = match (values.next(), values.next()) {
            (None, _) => return Err(Rule::NoAssertion.into()),
            (Some(value), None) => value,
            (Some(_), Some(_)) => return Err(Rule::AssertionMalformed.into()),
        };
        if assertion.len() > MAX_ASSERTION_BYTES {
            return Err(Rule::AssertionMalformed.into());
        }
        let assertion = assertion.to_str().map_err(|_| Rule::AssertionMalformed)?;
        let checked = self.check(assertion, parts.method.as_str())?;
        self.spend(&checked).await?;
        Ok(self.caller(checked))
    }

    /// Every rule but the `jti`'s spend, on the system clock (or the `testkit` seam's).
    fn check(&self, assertion: &str, method: &str) -> Result<Checked, Rule> {
        let [header_part, payload_part, signature_part] =
            compact_parts(assertion).ok_or(Rule::AssertionMalformed)?;
        // The header: an object with unique members, `typ` exactly, then AFD's rule 2 (with the
        // `typ` it knows put in place of ours, which is already checked) against the pinned
        // keys' algorithms.
        let header = decode_part(header_part).ok_or(Rule::Typ)?;
        if header.get("typ").and_then(Value::as_str) != Some(ASSERTION_TYP) {
            return Err(Rule::Typ);
        }
        let mut as_afd = header.clone();
        as_afd.insert("typ".into(), Value::String("at+jwt".into()));
        check_jws_header(&Value::Object(as_afd), &self.keys.algorithms())
            .map_err(Rule::from_afd)?;
        // The key (rule 3): pinned under that `kid`, and naming the header's `alg`. Every pinned
        // key was held to AFD's `check_key_fit` against its own `alg` when the file was read, so
        // a key that names the header's `alg` fits it.
        let kid = header
            .get("kid")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let key = self.keys.get(kid).ok_or(Rule::Key)?;
        if header.get("alg").and_then(Value::as_str) != Some(key.alg_name) {
            return Err(Rule::Key);
        }
        // The signature, under that key alone.
        let signature = URL_SAFE_NO_PAD
            .decode(signature_part)
            .map_err(|_| Rule::Signature)?;
        let message = &assertion[..header_part.len() + 1 + payload_part.len()];
        let verifier =
            (jsonwebtoken::crypto::aws_lc::DEFAULT_PROVIDER.verifier_factory)(&key.alg, &key.key)
                .map_err(|_| Rule::Key)?;
        if verifier.verify(message.as_bytes(), &signature).is_err() {
            return Err(Rule::Signature);
        }
        // The claims, read only now that they are signed.
        let claims = decode_part(payload_part).ok_or(Rule::Claims)?;
        self.check_claims(&claims, method)
    }

    /// The claim rules, in order: who issued it and for what request, the required claims, no
    /// binding, the times, then the scopes.
    fn check_claims(&self, claims: &Map<String, Value>, method: &str) -> Result<Checked, Rule> {
        if claims.get("iss").and_then(Value::as_str) != Some(self.issuer.as_str()) {
            return Err(Rule::Issuer);
        }
        let audience = match claims.get("aud") {
            Some(Value::String(aud)) => Some(aud.as_str()),
            Some(Value::Array(auds)) if auds.len() == 1 => auds[0].as_str(),
            _ => None,
        };
        if audience != Some(self.public_url.as_str()) {
            return Err(Rule::Audience);
        }
        if claims.get("htm").and_then(Value::as_str) != Some(method) {
            return Err(Rule::Htm);
        }
        if claims.get("htu").and_then(Value::as_str) != Some(self.public_url.as_str()) {
            return Err(Rule::Htu);
        }
        let subject = claim_text(claims.get("sub")).ok_or(Rule::Claims)?;
        let client = claim_text(claims.get("client")).ok_or(Rule::Claims)?;
        let jti = claim_text(claims.get("jti")).ok_or(Rule::Claims)?;
        if !carries_128_bits(jti) {
            return Err(Rule::Jti);
        }
        let iat = whole_seconds(claims.get("iat")).ok_or(Rule::Claims)?;
        let exp = whole_seconds(claims.get("exp")).ok_or(Rule::Claims)?;
        let nbf = match claims.get("nbf") {
            None => None,
            Some(value) => Some(whole_seconds(Some(value)).ok_or(Rule::Claims)?),
        };
        let scope = match claims.get("scope") {
            Some(Value::String(text)) if !text.is_empty() => text,
            Some(Value::String(_)) | None => return Err(Rule::Claims),
            Some(_) => return Err(Rule::ScopeMalformed),
        };
        if claims.contains_key("cnf") {
            return Err(Rule::Binding);
        }
        let now = self.clock.now().div_euclid(1000);
        if iat > now.saturating_add(self.skew_s)
            || nbf.is_some_and(|nbf| nbf > now.saturating_add(self.skew_s))
        {
            return Err(Rule::NotYetValid);
        }
        let lifetime = exp.saturating_sub(iat);
        if lifetime < 1 || lifetime > i64::try_from(MAX_ASSERTION_LIFETIME_S).unwrap_or(60) {
            return Err(Rule::Lifetime);
        }
        if exp <= now {
            return Err(Rule::Expired);
        }
        if now.saturating_sub(iat) > self.max_age_s {
            return Err(Rule::TooOld);
        }
        let asserted = afd::server::auth::parse_scope_claim(
            Some(&Value::String(scope.clone())),
            Some(&self.prefix),
            MAX_TOKEN_SCOPES,
        )
        .map_err(|rule| match rule {
            RuleCode::ScopesTooMany => Rule::ScopesTooMany,
            _ => Rule::ScopeMalformed,
        })?;
        let granted: Vec<Scope> = asserted
            .iter()
            .filter_map(|scope| Scope::parse(&self.prefix, scope))
            .collect();
        Ok(Checked {
            subject: subject.to_owned(),
            client: client.to_owned(),
            jti: jti.to_owned(),
            iat,
            exp,
            scopes: meet(&granted, &self.ceiling)
                .iter()
                .map(|scope| scope.to_scope_string(&self.prefix))
                .collect(),
        })
    }

    /// Spend the `jti` once in the shared nonce store, kept until the assertion could no longer
    /// be accepted on its own times (its `exp`, and `iat` plus the longest age, plus the skew).
    async fn spend(&self, checked: &Checked) -> Result<(), Refusal> {
        let key = format!("{NONCE_PREFIX}{}", checked.jti);
        let until_s = checked
            .exp
            .max(checked.iat.saturating_add(self.max_age_s))
            .saturating_add(self.skew_s)
            .saturating_add(1);
        let expires_ms = until_s.saturating_mul(1000);
        let now_ms = self.clock.now();
        let store = Arc::clone(&self.nonces);
        let spent = tokio::task::spawn_blocking(move || store.consume(&key, expires_ms, now_ms))
            .await
            .map_err(|error| {
                Refusal::Shared(SharedError::Failed {
                    store: "nonces",
                    message: error.to_string(),
                })
            })?
            .map_err(Refusal::Shared)?;
        if spent {
            Ok(())
        } else {
            Err(Rule::Replayed.into())
        }
    }

    /// Section 4.1's mapping in the gateway's namespace, with `authentication` `gateway`.
    fn caller(&self, checked: Checked) -> (Credentials, VerifiedCaller) {
        let ns = self.namespace.as_str();
        let client = format!("{ns}/{}", mapped_id(ns, &checked.client));
        let (actor, kind) = if checked.subject == checked.client {
            (
                Actor::new(ActorKind::Service).with_id(&client),
                ActorKind::Service,
            )
        } else {
            (
                Actor::new(ActorKind::Agent)
                    .with_id(&client)
                    .with_on_behalf_of(format!("{ns}/{}", mapped_id(ns, &checked.subject))),
                ActorKind::Agent,
            )
        };
        let credentials = Credentials::new(
            self.issuer.clone(),
            checked.subject,
            checked.client,
            self.public_url.clone(),
            checked.iat,
            checked.exp,
        )
        .with_scopes(checked.scopes.clone());
        let caller = VerifiedCaller {
            credentials: credentials.clone(),
            namespace: self.namespace.clone(),
            issuer: self.alias.clone(),
            actor,
            chain: vec![ChainEntry { kind, id: client }],
            vouched: Vouched::Gateway,
            scopes: checked.scopes,
            claim_groups: Vec::new(),
        };
        (credentials, caller)
    }
}

/// Rule 1 of 4.4 (see [`GatewayVerifier::channel`]): on the pinned leg a pinned certificate; on
/// the loopback leg a loopback local address, and a pinned certificate when any pin is set.
fn channel_allows(
    pinned_leg: bool,
    pins: &BTreeSet<String>,
    extensions: &http::Extensions,
) -> bool {
    let pinned = || certificate_pinned(pins, extensions);
    if pinned_leg {
        return pinned();
    }
    let loopback = extensions
        .get::<LocalAddr>()
        .is_some_and(|LocalAddr(local)| local.ip().to_canonical().is_loopback());
    loopback && (pins.is_empty() || pinned())
}

/// Whether the connection's TLS client certificate, which the handshake verified (the listener's
/// `ClientCertificate`, never a header), is one of `pins`. Never with no pins.
pub(crate) fn certificate_pinned(pins: &BTreeSet<String>, extensions: &http::Extensions) -> bool {
    !pins.is_empty()
        && extensions
            .get::<ClientCertificate>()
            .and_then(|certificate| sha256_hex(certificate.thumbprint()))
            .is_some_and(|hex| pins.contains(&hex))
}

/// What an assertion that passed every rule but its spend says.
struct Checked {
    subject: String,
    client: String,
    jti: String,
    iat: i64,
    exp: i64,
    /// The meet, under the prefix.
    scopes: Vec<String>,
}

/// The lowercase hexadecimal SHA-256 behind an unpadded base64url thumbprint.
fn sha256_hex(thumbprint: &str) -> Option<String> {
    let bytes = URL_SAFE_NO_PAD.decode(thumbprint).ok()?;
    (bytes.len() == 32).then(|| bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// The lowercase hexadecimal SHA-256 of `der`, as `client_cert_sha256` pins it.
#[cfg(test)]
fn pin_of(der: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(der)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// A claim text: a string of 1 to 255 characters with no control character.
fn claim_text(value: Option<&Value>) -> Option<&str> {
    let text = value?.as_str()?;
    (!text.is_empty()
        && text.chars().count() <= MAX_CLAIM_CHARS
        && !text.chars().any(char::is_control))
    .then_some(text)
}

/// A time claim: a JSON integer of seconds (no fraction, no string).
fn whole_seconds(value: Option<&Value>) -> Option<i64> {
    value?.as_i64()
}

/// Whether a `jti` can carry 128 bits: base64url characters only, at least 22 of them, and at
/// least 32 hexadecimal digits when it holds nothing but hexadecimal digits and hyphens.
fn carries_128_bits(jti: &str) -> bool {
    let base64url = jti
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if !base64url || jti.len() < MIN_JTI_CHARS {
        return false;
    }
    let hex = jti
        .bytes()
        .all(|byte| byte.is_ascii_hexdigit() || byte == b'-');
    !hex || jti.bytes().filter(u8::is_ascii_hexdigit).count() >= MIN_JTI_HEX_DIGITS
}

/// The three parts of a compact JWS: three base64url parts, the first two non-empty, as AFD
/// reads a JWS's shape (an empty signature is then refused by the rules, `alg: none` as `alg`).
fn compact_parts(token: &str) -> Option<[&str; 3]> {
    let mut parts = token.split('.');
    let parts = [parts.next()?, parts.next()?, parts.next()?];
    if token.matches('.').count() != 2 {
        return None;
    }
    let base64url = |part: &str| {
        part.bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    };
    (!parts[0].is_empty() && !parts[1].is_empty() && parts.iter().all(|part| base64url(part)))
        .then_some(parts)
}

/// A base64url part decoded to a JSON object with unique member names at every depth.
fn decode_part(part: &str) -> Option<Map<String, Value>> {
    strict_object(&URL_SAFE_NO_PAD.decode(part).ok()?)
}

/// `bytes` as one JSON object with unique member names at every depth (RFC 7515 4, RFC 7519 4:
/// a repeated name is refused, never read as its last value).
fn strict_object(bytes: &[u8]) -> Option<Map<String, Value>> {
    match serde_json::from_slice::<Strict>(bytes).ok()?.0 {
        Value::Object(members) => Some(members),
        _ => None,
    }
}

/// A JSON value whose objects, at every depth, have unique member names.
struct Strict(Value);

impl<'de> Deserialize<'de> for Strict {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(StrictVisitor).map(Strict)
    }
}

struct StrictVisitor;

impl<'de> Visitor<'de> for StrictVisitor {
    type Value = Value;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a JSON value with unique member names")
    }

    fn visit_bool<E: de::Error>(self, value: bool) -> Result<Value, E> {
        Ok(Value::Bool(value))
    }

    fn visit_i64<E: de::Error>(self, value: i64) -> Result<Value, E> {
        Ok(Value::Number(value.into()))
    }

    fn visit_u64<E: de::Error>(self, value: u64) -> Result<Value, E> {
        Ok(Value::Number(value.into()))
    }

    fn visit_f64<E: de::Error>(self, value: f64) -> Result<Value, E> {
        Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| E::custom("a JSON number is finite"))
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<Value, E> {
        Ok(Value::String(value.to_owned()))
    }

    fn visit_string<E: de::Error>(self, value: String) -> Result<Value, E> {
        Ok(Value::String(value))
    }

    fn visit_unit<E: de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_none<E: de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Value, A::Error> {
        let mut items = Vec::new();
        while let Some(Strict(item)) = seq.next_element()? {
            items.push(item);
        }
        Ok(Value::Array(items))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
        let mut members = Map::new();
        while let Some(name) = map.next_key::<String>()? {
            let Strict(value) = map.next_value()?;
            if members.insert(name, value).is_some() {
                return Err(de::Error::custom("a member name appears more than once"));
            }
        }
        Ok(Value::Object(members))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use serde_json::json;

    fn scope(text: &str) -> Scope {
        Scope::parse("umbel", text).unwrap()
    }

    fn scopes(texts: &[&str]) -> Vec<Scope> {
        texts.iter().map(|text| scope(text)).collect()
    }

    #[test]
    fn every_gateway_challenge_shares_one_scheme_and_realm() {
        assert_eq!(CHALLENGE, format!("{SCHEME} realm=\"{REALM}\""));
        let challenge = scope_challenge().unwrap();
        assert_eq!(
            challenge.header_value(&["umbel:write:alpha".to_owned(), "umbel:approve".to_owned()]),
            "Umbel-Gateway realm=\"umbel\", error=\"insufficient_scope\", scope=\"umbel:write:alpha umbel:approve\""
        );
        // A refusal naming no scope token sends no empty `scope`, and nothing points to metadata.
        assert_eq!(
            challenge.header_value(&[]),
            "Umbel-Gateway realm=\"umbel\", error=\"insufficient_scope\""
        );
    }

    fn texts(scopes: &[Scope]) -> Vec<String> {
        scopes
            .iter()
            .map(|scope| scope.to_scope_string("umbel"))
            .collect()
    }

    #[test]
    fn the_ceiling_is_a_meet_in_the_scope_order() {
        // Section 4.4's example.
        assert_eq!(
            texts(&meet(
                &scopes(&["umbel:write"]),
                &scopes(&["umbel:write:alpha"])
            )),
            ["umbel:write:alpha"]
        );
        // A narrower grant under a wider ceiling is kept as granted.
        assert_eq!(
            texts(&meet(
                &scopes(&["umbel:read:alpha"]),
                &scopes(&["umbel:read"])
            )),
            ["umbel:read:alpha"]
        );
        // Each side's own scopes, once, granted ones first.
        assert_eq!(
            texts(&meet(
                &scopes(&["umbel:read", "umbel:write:main", "umbel:approve"]),
                &scopes(&["umbel:read", "umbel:write"]),
            )),
            ["umbel:read", "umbel:write:main"]
        );
        // `write` implies neither `approve` nor `erase`, so a ceiling of `write` cuts them.
        assert!(
            meet(
                &scopes(&["umbel:approve", "umbel:erase"]),
                &scopes(&["umbel:write"])
            )
            .is_empty()
        );
        // A verb on another space is not kept.
        assert!(
            meet(
                &scopes(&["umbel:write:beta"]),
                &scopes(&["umbel:write:alpha"])
            )
            .is_empty()
        );
        // Narrower than the order's greatest lower bound where 4.4's two rules say so: never wider.
        assert!(meet(&scopes(&["umbel:write:alpha"]), &scopes(&["umbel:read"])).is_empty());
        // Every scope kept is implied by both sides.
        let granted = scopes(&[
            "umbel:read",
            "umbel:write",
            "umbel:approve:alpha",
            "umbel:erase:beta",
        ]);
        let ceiling = scopes(&[
            "umbel:read:alpha",
            "umbel:write:alpha",
            "umbel:approve",
            "umbel:erase",
        ]);
        for kept in meet(&granted, &ceiling) {
            assert!(granted.iter().any(|held| held.implies(&kept)), "{kept:?}");
            assert!(ceiling.iter().any(|limit| limit.implies(&kept)), "{kept:?}");
        }
    }

    #[test]
    fn a_jti_must_carry_128_bits() {
        assert!(carries_128_bits(&"Z".repeat(22)));
        assert!(carries_128_bits("abcdefghijklmnopqrstuv"));
        assert!(!carries_128_bits(&"Z".repeat(21)));
        // Only hexadecimal digits: 22 are not enough.
        assert!(!carries_128_bits(&"A".repeat(22)));
        // Hexadecimal needs 32 digits; a UUID has exactly 32.
        assert!(!carries_128_bits(&"a".repeat(31)));
        assert!(carries_128_bits(&"a".repeat(32)));
        assert!(carries_128_bits("123e4567-e89b-12d3-a456-426614174000"));
        assert!(!carries_128_bits("123e4567-e89b-12d3-a456-42661417400"));
        // Only base64url characters.
        assert!(!carries_128_bits(&format!("{}+", "Z".repeat(30))));
        assert!(!carries_128_bits(&format!("{} ", "Z".repeat(30))));
    }

    /// RFC 7517 appendix A.1's P-256 key, with `kid` and `alg` as a pinned key needs them.
    fn p256(kid: &str) -> Value {
        json!({
            "kty": "EC", "crv": "P-256", "kid": kid, "alg": "ES256", "use": "sig",
            "x": "MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4",
            "y": "4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM",
        })
    }

    fn rsa(modulus_bytes: usize, exponent: &[u8]) -> Value {
        let mut n = vec![0xA5_u8; modulus_bytes];
        n[0] = 0xC3;
        json!({
            "kty": "RSA", "kid": "r", "alg": "RS256",
            "n": URL_SAFE_NO_PAD.encode(&n), "e": URL_SAFE_NO_PAD.encode(exponent),
        })
    }

    #[test]
    fn pinned_material_that_could_never_verify_is_refused() {
        // RSA: 2048 to 8192 bits, an exponent of at least 3.
        assert!(parse(&json!({ "keys": [rsa(256, &[1, 0, 1])] })).is_ok());
        assert!(parse(&json!({ "keys": [rsa(1024, &[1, 0, 1])] })).is_ok());
        for (label, key) in [
            ("a 1024-bit modulus", rsa(128, &[1, 0, 1])),
            ("an 8200-bit modulus", rsa(1025, &[1, 0, 1])),
            ("an exponent of 1", rsa(256, &[1])),
            ("an exponent of 2", rsa(256, &[0, 2])),
        ] {
            let error = parse(&json!({ "keys": [key] })).unwrap_err();
            assert!(error.contains("cannot verify"), "{label}: {error}");
        }
        assert!(parse(&json!({ "keys": [rsa(256, &[3])] })).is_ok());
        // EC: a point of the right length that is not on P-256.
        let mut off_curve = p256("a");
        off_curve["x"] = json!(URL_SAFE_NO_PAD.encode([1_u8; 32]));
        off_curve["y"] = json!(URL_SAFE_NO_PAD.encode([1_u8; 32]));
        let error = parse(&json!({ "keys": [off_curve] })).unwrap_err();
        assert!(error.contains("cannot verify"), "{error}");
        assert_eq!(bit_length(&[0, 0, 1]), 1);
        assert_eq!(bit_length(&[0x80, 0]), 16);
        assert_eq!(bit_length(&[]), 0);
    }

    #[test]
    fn a_trust_file_is_checked_as_opened() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("jwks.json");
        std::fs::write(&path, "{}").unwrap();
        assert_eq!(files::read_trusted(&path, Secrecy::Public).unwrap(), b"{}");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o664)).unwrap();
            let error = files::read_trusted(&path, Secrecy::Public).unwrap_err();
            assert!(error.contains("writable by group or other"), "{error}");
        }
        assert!(files::read_trusted(dir.path(), Secrecy::Public).is_err());
    }

    fn parse(document: &Value) -> Result<PinnedKeys, String> {
        PinnedKeys::parse(document.to_string().as_bytes())
    }

    #[test]
    fn a_pinned_key_set_holds_usable_public_keys_each_naming_its_alg() {
        let keys = parse(&json!({ "keys": [p256("a"), p256("b")] })).unwrap();
        assert_eq!(keys.len(), 2);
        assert_eq!(keys.algorithms(), ["ES256"]);
        let without = |member: &str| {
            let mut key = p256("a");
            key.as_object_mut().unwrap().remove(member);
            json!({ "keys": [key] })
        };
        let with = |member: &str, value: Value| {
            let mut key = p256("a");
            key[member] = value;
            json!({ "keys": [key] })
        };
        for (label, document) in [
            ("no keys", json!({ "keys": [] })),
            ("not a set", json!([p256("a")])),
            ("no kid", without("kid")),
            ("no alg", without("alg")),
            ("a repeated kid", json!({ "keys": [p256("a"), p256("a")] })),
            ("an algorithm AFD refuses", with("alg", json!("ES512"))),
            ("an HMAC algorithm", with("alg", json!("HS256"))),
            ("a key of another curve", with("alg", json!("ES384"))),
            ("a key for encryption", with("use", json!("enc"))),
            (
                "a key not for verifying",
                with("key_ops", json!(["encrypt"])),
            ),
            ("private material", with("d", json!("AAAA"))),
            ("a symmetric key", with("k", json!("AAAA"))),
            ("a short coordinate", with("x", json!("AAAA"))),
            ("an entry that is not an object", json!({ "keys": ["x"] })),
        ] {
            assert!(parse(&document).is_err(), "{label} was accepted");
        }
        // A repeated member name anywhere refuses the file, never read as its last value.
        let text = format!("{{\"keys\":[{}],\"keys\":[]}}", p256("a"));
        assert!(PinnedKeys::parse(text.as_bytes()).is_err());
        let repeated_in_key = r#"{"keys":[{"kty":"EC","kty":"RSA"}]}"#;
        assert!(PinnedKeys::parse(repeated_in_key.as_bytes()).is_err());
        // The error names the key's place, never its material.
        let error = parse(&with("x", json!("AAAA"))).unwrap_err();
        assert!(
            error.contains("key 1") && !error.contains("AAAA"),
            "{error}"
        );
    }

    fn extensions(local: Option<&str>, certificate: Option<&[u8]>) -> http::Extensions {
        let mut extensions = http::Extensions::new();
        if let Some(local) = local {
            extensions.insert(LocalAddr(local.parse().unwrap()));
        }
        if let Some(der) = certificate {
            extensions.insert(ClientCertificate::from_der(der));
        }
        extensions
    }

    #[test]
    fn the_channel_is_pinned_or_loopback_from_the_connection_alone() {
        let gateway_cert = b"the gateway's certificate".as_slice();
        let other_cert = b"another certificate of the same CA".as_slice();
        let pins: BTreeSet<String> = [pin_of(gateway_cert)].into_iter().collect();
        let none = BTreeSet::new();
        // The pinned leg: the pinned certificate, wherever the connection is.
        assert!(channel_allows(
            true,
            &pins,
            &extensions(Some("10.0.0.5:8443"), Some(gateway_cert))
        ));
        assert!(!channel_allows(
            true,
            &pins,
            &extensions(Some("10.0.0.5:8443"), Some(other_cert))
        ));
        assert!(!channel_allows(
            true,
            &pins,
            &extensions(Some("127.0.0.1:8443"), None)
        ));
        // The loopback leg: the connection's own local address, never a guess.
        assert!(channel_allows(
            false,
            &none,
            &extensions(Some("127.0.0.1:8443"), None)
        ));
        assert!(channel_allows(
            false,
            &none,
            &extensions(Some("[::1]:8443"), None)
        ));
        assert!(channel_allows(
            false,
            &none,
            &extensions(Some("[::ffff:127.0.0.1]:8443"), None)
        ));
        assert!(!channel_allows(
            false,
            &none,
            &extensions(Some("10.0.0.5:8443"), None)
        ));
        assert!(!channel_allows(
            false,
            &none,
            &extensions(Some("0.0.0.0:8443"), None)
        ));
        assert!(!channel_allows(false, &none, &extensions(None, None)));
        // Pins on the loopback leg are enforced too.
        assert!(channel_allows(
            false,
            &pins,
            &extensions(Some("127.0.0.1:8443"), Some(gateway_cert))
        ));
        assert!(!channel_allows(
            false,
            &pins,
            &extensions(Some("127.0.0.1:8443"), Some(other_cert))
        ));
        assert!(!channel_allows(
            false,
            &pins,
            &extensions(Some("127.0.0.1:8443"), None)
        ));
        assert!(!channel_allows(
            false,
            &pins,
            &extensions(Some("10.0.0.5:8443"), Some(gateway_cert))
        ));
    }

    #[test]
    fn parts_are_read_strictly() {
        assert!(compact_parts("a.b.c").is_some());
        assert!(compact_parts("a.b.").is_some());
        for bad in [".b.c", "a..c", "a.b", "a.b.c.d", "a+.b.c", "a.b.c="] {
            assert!(compact_parts(bad).is_none(), "{bad}");
        }
        assert!(strict_object(br#"{"a":1,"b":{"c":[1,{"d":2}]}}"#).is_some());
        assert!(strict_object(br#"{"a":1,"a":1}"#).is_none());
        assert!(strict_object(br#"{"a":{"b":1,"b":2}}"#).is_none());
        assert!(strict_object(br"[]").is_none());
        let thumbprint = ClientCertificate::from_der(b"x").thumbprint().to_owned();
        assert_eq!(sha256_hex(&thumbprint), Some(pin_of(b"x")));
        assert_eq!(sha256_hex("not base64url!"), None);
    }

    #[test]
    fn claims_text_and_times_are_exact() {
        assert_eq!(claim_text(Some(&json!("ada"))), Some("ada"));
        assert_eq!(claim_text(Some(&json!(""))), None);
        assert_eq!(claim_text(Some(&json!("a\u{7}"))), None);
        assert_eq!(claim_text(Some(&json!("x".repeat(256)))), None);
        assert_eq!(claim_text(Some(&json!(1))), None);
        assert_eq!(
            whole_seconds(Some(&json!(1_700_000_000))),
            Some(1_700_000_000)
        );
        assert_eq!(whole_seconds(Some(&json!(1.5))), None);
        assert_eq!(whole_seconds(Some(&json!("1"))), None);
        let codes: BTreeSet<&str> = [
            Rule::Channel,
            Rule::NoAssertion,
            Rule::AssertionMalformed,
            Rule::Typ,
            Rule::Alg,
            Rule::Kid,
            Rule::Crit,
            Rule::KeyReference,
            Rule::Key,
            Rule::Signature,
            Rule::Issuer,
            Rule::Audience,
            Rule::Htm,
            Rule::Htu,
            Rule::Claims,
            Rule::Jti,
            Rule::NotYetValid,
            Rule::Lifetime,
            Rule::Expired,
            Rule::TooOld,
            Rule::ScopeMalformed,
            Rule::ScopesTooMany,
            Rule::Binding,
            Rule::Replayed,
            Rule::Unavailable,
        ]
        .into_iter()
        .map(Rule::code)
        .collect();
        assert_eq!(codes.len(), 25, "every rule has its own code");
    }
}
