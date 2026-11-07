//! Token rules that need no key and no network (`spec/authorization.md`, M3 rules 2, 3 and 5 to
//! 10, and M3.2): shared by AFD's JWT verifier and a host's introspection verifier.

use serde_json::{Map, Value};

use crate::credentials::Credentials;

use super::resource::{audience_accepts, check_https_url};
use super::RuleCode;

/// The largest clock skew a verifier may allow, in seconds.
pub const MAX_CLOCK_SKEW_S: u64 = 300;
/// The default clock skew, in seconds.
pub const DEFAULT_CLOCK_SKEW_S: u64 = 60;
/// The default longest token lifetime (`exp - iat`), in seconds.
pub const DEFAULT_MAX_TOKEN_LIFETIME_S: u64 = 3600;
/// The default scope limit.
pub const DEFAULT_SCOPE_LIMIT: usize = 64;
/// The most Unicode code points a `jti`, `sub`, `client_id` or `acr` may hold.
pub const MAX_CLAIM_CHARS: usize = 255;

/// The rules a verified token's claims must pass (`spec/authorization.md`, M3 rules 6 to 10):
/// the resource (the only audience accepted), the clock skew, the longest lifetime, the scope
/// prefix and limit, and whether bound tokens are required.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenRules {
    resource: String,
    clock_skew_s: u64,
    max_token_lifetime_s: u64,
    scope_prefix: Option<String>,
    scope_limit: usize,
    require_bound_tokens: bool,
}

impl TokenRules {
    /// The rules for tokens whose audience is `resource`, with the defaults: 60 seconds of skew,
    /// a lifetime of at most 3600 seconds, no scope prefix, at most 64 scopes, and unbound tokens
    /// accepted.
    ///
    /// # Errors
    /// `resource` is not an absolute `https` URL without user information, query or fragment.
    pub fn new(resource: impl Into<String>) -> Result<Self, String> {
        let resource = resource.into();
        check_https_url("resource", &resource)?;
        Ok(Self {
            resource,
            clock_skew_s: DEFAULT_CLOCK_SKEW_S,
            max_token_lifetime_s: DEFAULT_MAX_TOKEN_LIFETIME_S,
            scope_prefix: None,
            scope_limit: DEFAULT_SCOPE_LIMIT,
            require_bound_tokens: false,
        })
    }

    /// The clock skew allowed on `exp`, `iat` and `nbf`, in seconds.
    ///
    /// # Errors
    /// More than [`MAX_CLOCK_SKEW_S`].
    pub fn with_clock_skew_s(mut self, seconds: u64) -> Result<Self, String> {
        if seconds > MAX_CLOCK_SKEW_S {
            return Err(format!(
                "[AFD] a clock skew of {seconds} seconds is more than the {MAX_CLOCK_SKEW_S} allowed"
            ));
        }
        self.clock_skew_s = seconds;
        Ok(self)
    }

    /// The longest `exp - iat` accepted, in seconds.
    ///
    /// # Errors
    /// Zero.
    pub fn with_max_token_lifetime_s(mut self, seconds: u64) -> Result<Self, String> {
        if seconds == 0 {
            return Err("[AFD] the maximum token lifetime must be at least 1 second".to_owned());
        }
        self.max_token_lifetime_s = seconds;
        Ok(self)
    }

    /// Count only scopes starting with `<prefix>:` against the limit.
    ///
    /// # Errors
    /// `prefix` is not a scope token.
    pub fn with_scope_prefix(mut self, prefix: impl Into<String>) -> Result<Self, String> {
        let prefix = prefix.into();
        if !crate::credentials::is_scope_token(&prefix) {
            return Err(format!(
                "[AFD] scope prefix {prefix:?} is not an OAuth scope token"
            ));
        }
        self.scope_prefix = Some(prefix);
        Ok(self)
    }

    /// The most scopes a token may hold (under the prefix, when one is set).
    ///
    /// # Errors
    /// Zero.
    pub fn with_scope_limit(mut self, limit: usize) -> Result<Self, String> {
        if limit == 0 {
            return Err("[AFD] the scope limit must be at least 1".to_owned());
        }
        self.scope_limit = limit;
        Ok(self)
    }

    /// Refuse every token that is not bound to the TLS client certificate (`cnf["x5t#S256"]`).
    pub fn with_require_bound_tokens(mut self, required: bool) -> Self {
        self.require_bound_tokens = required;
        self
    }

    /// The resource: the only audience accepted, and the credentials' `resource`.
    pub fn resource(&self) -> &str {
        &self.resource
    }

    /// The clock skew, in seconds.
    pub fn clock_skew_s(&self) -> u64 {
        self.clock_skew_s
    }

    /// The longest lifetime, in seconds.
    pub fn max_token_lifetime_s(&self) -> u64 {
        self.max_token_lifetime_s
    }

    /// The scope prefix.
    pub fn scope_prefix(&self) -> Option<&str> {
        self.scope_prefix.as_deref()
    }

    /// The scope limit.
    pub fn scope_limit(&self) -> usize {
        self.scope_limit
    }

    /// Whether bound tokens are required.
    pub fn require_bound_tokens(&self) -> bool {
        self.require_bound_tokens
    }
}

/// Parse a `scope` claim (`spec/authorization.md`, M3.2; absent: `None`): scope tokens separated
/// by single spaces, each kept once at its first place. An empty string or no claim grants no
/// scope. Only scopes starting with `<prefix>:` count against `limit` when a prefix is given.
///
/// # Errors
/// [`RuleCode::ScopeMalformed`] for a claim that is not a string, leading, trailing or repeated
/// spaces, or a forbidden character; [`RuleCode::ScopesTooMany`] over the limit.
pub fn parse_scope_claim(
    scope: Option<&Value>,
    prefix: Option<&str>,
    limit: usize,
) -> Result<Vec<String>, RuleCode> {
    let text = match scope {
        None => return Ok(Vec::new()),
        Some(Value::String(text)) => text,
        Some(_) => return Err(RuleCode::ScopeMalformed),
    };
    if text.is_empty() {
        return Ok(Vec::new());
    }
    let mut scopes: Vec<String> = Vec::new();
    for token in text.split(' ') {
        if !crate::credentials::is_scope_token(token) {
            return Err(RuleCode::ScopeMalformed);
        }
        if !scopes.iter().any(|kept| kept == token) {
            scopes.push(token.to_owned());
        }
    }
    let counted = match prefix {
        None => scopes.len(),
        Some(prefix) => scopes
            .iter()
            .filter(|scope| {
                scope
                    .strip_prefix(prefix)
                    .is_some_and(|rest| rest.starts_with(':'))
            })
            .count(),
    };
    if counted > limit {
        return Err(RuleCode::ScopesTooMany);
    }
    Ok(scopes)
}

/// Rule 2 on a decoded JWS header (`spec/authorization.md`, M3), against the issuer's algorithm
/// list: `typ`, then `alg`, `kid`, `crit` and the key references, the first broken rule refusing.
/// `none` and every `HS*` algorithm are refused whatever the list says.
///
/// # Errors
/// [`RuleCode::Typ`], [`RuleCode::Alg`], [`RuleCode::Kid`], [`RuleCode::Crit`] or
/// [`RuleCode::KeyReference`].
pub fn check_jws_header(header: &Value, algorithms: &[&str]) -> Result<(), RuleCode> {
    let Some(header) = header.as_object() else {
        return Err(RuleCode::Typ);
    };
    let typ_ok = header
        .get("typ")
        .and_then(Value::as_str)
        .is_some_and(|typ| {
            typ.eq_ignore_ascii_case("at+jwt") || typ.eq_ignore_ascii_case("application/at+jwt")
        });
    if !typ_ok {
        return Err(RuleCode::Typ);
    }
    let alg_ok = header
        .get("alg")
        .and_then(Value::as_str)
        .is_some_and(|alg| alg != "none" && !alg.starts_with("HS") && algorithms.contains(&alg));
    if !alg_ok {
        return Err(RuleCode::Alg);
    }
    if !header
        .get("kid")
        .and_then(Value::as_str)
        .is_some_and(|kid| !kid.is_empty())
    {
        return Err(RuleCode::Kid);
    }
    if header.contains_key("crit") {
        return Err(RuleCode::Crit);
    }
    if ["jku", "x5u", "x5c", "jwk"]
        .iter()
        .any(|member| header.contains_key(*member))
    {
        return Err(RuleCode::KeyReference);
    }
    Ok(())
}

/// Rule 3 on a header that passed rule 2 and the issuer's key with its `kid` (`None` for none):
/// the key's `kid` is the header's; its `kty` is the `alg`'s family (`RSA` for `RS*` and `PS*`;
/// `EC` with the `alg`'s curve for `ES*`; `OKP` with `Ed25519` or `Ed448` for `EdDSA`); its
/// `alg`, when present, is the header's; its `use`, when present, is `sig`; its `key_ops`, when
/// present, contain `verify`.
///
/// # Errors
/// [`RuleCode::Key`].
pub fn check_key_fit(header: &Value, key: Option<&Value>) -> Result<(), RuleCode> {
    let refuse = Err(RuleCode::Key);
    let (Some(alg), Some(kid)) = (
        header.get("alg").and_then(Value::as_str),
        header.get("kid").and_then(Value::as_str),
    ) else {
        return refuse;
    };
    let Some(key) = key.and_then(Value::as_object) else {
        return refuse;
    };
    if key.get("kid").and_then(Value::as_str) != Some(kid) {
        return refuse;
    }
    let kty = key.get("kty").and_then(Value::as_str);
    let crv = key.get("crv").and_then(Value::as_str);
    let fits = match alg {
        "RS256" | "RS384" | "RS512" | "PS256" | "PS384" | "PS512" => kty == Some("RSA"),
        "ES256" => kty == Some("EC") && crv == Some("P-256"),
        "ES384" => kty == Some("EC") && crv == Some("P-384"),
        "ES512" => kty == Some("EC") && crv == Some("P-521"),
        "EdDSA" => kty == Some("OKP") && matches!(crv, Some("Ed25519" | "Ed448")),
        _ => false,
    };
    if !fits {
        return refuse;
    }
    if key
        .get("alg")
        .is_some_and(|key_alg| key_alg.as_str() != Some(alg))
    {
        return refuse;
    }
    if key
        .get("use")
        .is_some_and(|usage| usage.as_str() != Some("sig"))
    {
        return refuse;
    }
    if let Some(ops) = key.get("key_ops") {
        let verifies = ops
            .as_array()
            .is_some_and(|ops| ops.iter().any(|op| op.as_str() == Some("verify")));
        if !verifies {
            return refuse;
        }
    }
    Ok(())
}

/// A string claim of rule 7: non-empty, at most [`MAX_CLAIM_CHARS`] code points, no control
/// character (general category `Cc`).
fn claim_text(value: &Value) -> Option<&str> {
    let text = value.as_str()?;
    (!text.is_empty()
        && text.chars().count() <= MAX_CLAIM_CHARS
        && !text.chars().any(char::is_control))
    .then_some(text)
}

/// Seconds since the epoch, rounded down, of a time claim already checked to be a number.
fn whole_seconds(seconds: f64) -> i64 {
    // `as` saturates; rule 8 has bounded every time that reaches here.
    seconds.floor() as i64
}

/// Rules 5 to 10 on a token's claims after its signature (or on an introspection response), at
/// `now` (seconds since the epoch), for `issuer` (its exact configured string) under `rules`.
/// `certificate` is the SHA-256 thumbprint (unpadded base64url) of the request's TLS client
/// certificate, `None` for none.
///
/// Rule 10 also refuses a `cnf` that is not an object, and one holding a confirmation method
/// other than `x5t#S256` (`jkt` is `dpop-unsupported`, anything else `binding`), since AFD can
/// prove neither.
///
/// # Errors
/// The first broken rule's code: [`RuleCode::Issuer`], [`RuleCode::Audience`],
/// [`RuleCode::Claims`], [`RuleCode::Expired`], [`RuleCode::NotYetValid`],
/// [`RuleCode::Lifetime`], [`RuleCode::ScopeMalformed`], [`RuleCode::ScopesTooMany`],
/// [`RuleCode::DpopUnsupported`] or [`RuleCode::Binding`].
pub fn check_claims(
    claims: &Map<String, Value>,
    issuer: &str,
    rules: &TokenRules,
    now: i64,
    certificate: Option<&str>,
) -> Result<Credentials, RuleCode> {
    // 5. Issuer.
    if claims.get("iss").and_then(Value::as_str) != Some(issuer) {
        return Err(RuleCode::Issuer);
    }
    // 6. Audience.
    if !audience_accepts(claims.get("aud"), &rules.resource) {
        return Err(RuleCode::Audience);
    }
    // 7. Required claims.
    let number = |name: &str| claims.get(name).map(Value::as_f64);
    let (Some(Some(exp)), Some(Some(iat))) = (number("exp"), number("iat")) else {
        return Err(RuleCode::Claims);
    };
    let text = |name: &str| claims.get(name).and_then(claim_text);
    let (Some(_), Some(subject), Some(client_id)) = (text("jti"), text("sub"), text("client_id"))
    else {
        return Err(RuleCode::Claims);
    };
    let nbf = match number("nbf") {
        None => None,
        Some(Some(nbf)) => Some(nbf),
        Some(None) => return Err(RuleCode::Claims),
    };
    let auth_time = match number("auth_time") {
        None => None,
        Some(Some(auth_time)) => Some(auth_time),
        Some(None) => return Err(RuleCode::Claims),
    };
    let acr = match claims.get("acr") {
        None => None,
        Some(value) => Some(claim_text(value).ok_or(RuleCode::Claims)?),
    };
    // 8. Time.
    let now = now as f64;
    let skew = rules.clock_skew_s as f64;
    if now >= exp + skew {
        return Err(RuleCode::Expired);
    }
    if iat > now + skew || nbf.is_some_and(|nbf| nbf > now + skew) {
        return Err(RuleCode::NotYetValid);
    }
    if exp - iat > rules.max_token_lifetime_s as f64 {
        return Err(RuleCode::Lifetime);
    }
    // 9. Scopes.
    let scopes = parse_scope_claim(
        claims.get("scope"),
        rules.scope_prefix.as_deref(),
        rules.scope_limit,
    )?;
    // 10. Binding.
    let thumbprint = match claims.get("cnf") {
        None => None,
        Some(Value::Object(cnf)) => {
            if cnf.contains_key("jkt") {
                return Err(RuleCode::DpopUnsupported);
            }
            if cnf.keys().any(|method| method != "x5t#S256") {
                return Err(RuleCode::Binding);
            }
            match cnf.get("x5t#S256") {
                None => None,
                Some(Value::String(bound)) if certificate == Some(bound.as_str()) => {
                    Some(bound.clone())
                }
                Some(_) => return Err(RuleCode::Binding),
            }
        }
        Some(_) => return Err(RuleCode::Binding),
    };
    if thumbprint.is_none() && rules.require_bound_tokens {
        return Err(RuleCode::Binding);
    }
    let mut credentials = Credentials::new(
        issuer,
        subject,
        client_id,
        rules.resource.clone(),
        whole_seconds(iat),
        whole_seconds(exp),
    )
    .with_scopes(scopes);
    if let Some(auth_time) = auth_time {
        credentials = credentials.with_auth_time(whole_seconds(auth_time));
    }
    if let Some(acr) = acr {
        credentials = credentials.with_acr(acr);
    }
    if let Some(thumbprint) = thumbprint {
        credentials = credentials.with_certificate_thumbprint(thumbprint);
    }
    Ok(credentials)
}

/// An RFC 7662 introspection response for the one issuer configured for introspection
/// (`spec/authorization.md`, M3, "Introspection"): `active` must be `true`, and `exp`, `iat`,
/// `iss`, `aud`, `sub` and `client_id` must be present; rules 5 to 10 ([`check_claims`]) then
/// apply to it, `jti` among rule 7's claims. A host's introspection [`TokenVerifier`] calls this
/// on the endpoint's answer.
///
/// [`TokenVerifier`]: super::TokenVerifier
///
/// # Errors
/// [`RuleCode::Inactive`] when the response does not say `active: true`, [`RuleCode::Claims`]
/// for a required field missing, then [`check_claims`]'s codes.
pub fn check_introspection(
    response: &Value,
    issuer: &str,
    rules: &TokenRules,
    now: i64,
    certificate: Option<&str>,
) -> Result<Credentials, RuleCode> {
    let Some(response) = response.as_object() else {
        return Err(RuleCode::Inactive);
    };
    if response.get("active") != Some(&Value::Bool(true)) {
        return Err(RuleCode::Inactive);
    }
    if ["exp", "iat", "iss", "aud", "sub", "client_id"]
        .iter()
        .any(|field| !response.contains_key(*field))
    {
        return Err(RuleCode::Claims);
    }
    check_claims(response, issuer, rules, now, certificate)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn rules() -> TokenRules {
        TokenRules::new("https://todo.example.com/mcp").unwrap()
    }

    fn claims() -> Map<String, Value> {
        json!({
            "active": true,
            "iss": "https://auth.example.com",
            "aud": "https://todo.example.com/mcp",
            "sub": "user-1",
            "client_id": "todo-agent",
            "jti": "j-1",
            "iat": 1000,
            "exp": 2000,
        })
        .as_object()
        .unwrap()
        .clone()
    }

    #[test]
    fn introspection_needs_active_and_its_fields() {
        let issuer = "https://auth.example.com";
        let ok = check_introspection(&Value::Object(claims()), issuer, &rules(), 1500, None);
        assert_eq!(ok.unwrap().subject, "user-1");
        let mut inactive = claims();
        inactive.insert("active".into(), json!("true"));
        assert_eq!(
            check_introspection(&Value::Object(inactive), issuer, &rules(), 1500, None),
            Err(RuleCode::Inactive)
        );
        let mut no_iss = claims();
        no_iss.remove("iss");
        assert_eq!(
            check_introspection(&Value::Object(no_iss), issuer, &rules(), 1500, None),
            Err(RuleCode::Claims)
        );
        let mut no_jti = claims();
        no_jti.remove("jti");
        assert_eq!(
            check_introspection(&Value::Object(no_jti), issuer, &rules(), 1500, None),
            Err(RuleCode::Claims)
        );
        assert_eq!(
            check_introspection(&json!([]), issuer, &rules(), 1500, None),
            Err(RuleCode::Inactive)
        );
    }

    #[test]
    fn other_confirmation_methods_are_refused() {
        let issuer = "https://auth.example.com";
        let mut cnf = claims();
        cnf.insert("cnf".into(), json!({ "jwk": { "kty": "EC" } }));
        assert_eq!(
            check_claims(&cnf, issuer, &rules(), 1500, Some("x")),
            Err(RuleCode::Binding)
        );
        cnf.insert("cnf".into(), json!("x"));
        assert_eq!(
            check_claims(&cnf, issuer, &rules(), 1500, Some("x")),
            Err(RuleCode::Binding)
        );
        cnf.insert("cnf".into(), json!({}));
        assert!(check_claims(&cnf, issuer, &rules(), 1500, None).is_ok());
    }

    #[test]
    fn rules_are_bounded() {
        assert!(rules().with_clock_skew_s(301).is_err());
        assert!(rules().with_clock_skew_s(300).is_ok());
        assert!(rules().with_max_token_lifetime_s(0).is_err());
        assert!(rules().with_scope_limit(0).is_err());
        assert!(rules().with_scope_prefix("a b").is_err());
        assert!(TokenRules::new("http://todo.example.com/mcp").is_err());
    }
}
