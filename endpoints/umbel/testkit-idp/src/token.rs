//! Tokens: a builder for every compact JWS the kit signs (access tokens, ID tokens, ID-JAGs,
//! gateway assertions) and for opaque tokens, with hooks that break one rule at a time; the
//! registry introspection answers from; and the kit's own verification of the tokens it receives.

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Number, Value, json};

use crate::ca::IssuedCertificate;
use crate::keys::{Algorithm, Key, KeyKind, KeySet};
use crate::{Error, b64, lock, now, random_bytes, random_token};

/// What a [`TokenBuilder`] makes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    /// An RFC 9068 access token (`typ` `at+jwt`).
    AccessToken,
    /// An opaque access token: 32 random bytes, answered only through introspection.
    Opaque,
    /// An OpenID Connect ID token (`typ` `JWT`).
    IdToken,
    /// An ID-JAG (`typ` `oauth-id-jag+jwt`).
    IdJag,
    /// A gateway assertion (`typ` `umbel-gw+jwt`).
    GatewayAssertion,
}

/// A claim RFC 9068 section 2.2 and the specification's rule 8 require.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequiredClaim {
    /// `exp`.
    Exp,
    /// `iat`.
    Iat,
    /// `jti`.
    Jti,
    /// `sub`.
    Sub,
    /// `client_id`.
    ClientId,
}

impl RequiredClaim {
    /// Every required claim.
    pub const ALL: [RequiredClaim; 5] =
        [Self::Exp, Self::Iat, Self::Jti, Self::Sub, Self::ClientId];

    /// The claim's name.
    pub fn name(self) -> &'static str {
        match self {
            Self::Exp => "exp",
            Self::Iat => "iat",
            Self::Jti => "jti",
            Self::Sub => "sub",
            Self::ClientId => "client_id",
        }
    }
}

/// One rule of section 3.2 broken, everything else left valid. Apply breaks last: a later setter
/// can undo one.
///
/// The breaks are defined for access tokens, and [`Break::rule`] is the rule code of an access
/// token. On another [`TokenKind`] a break changes the same member where that kind has it:
/// [`Break::Typ`] gives an ID token (`typ` `JWT`) the access token's `at+jwt` instead, and
/// [`Break::Missing`] of [`RequiredClaim::ClientId`] removes a gateway assertion's `client` and
/// leaves an ID token, which has no `client_id`, unchanged.
///
/// The time breaks are relative to the moment they are applied and assume AFD's defaults (a
/// clock skew of at most 300 seconds, of at least 2 for [`Break::ExpiresBeforeIssued`]; a
/// longest lifetime under a day), and [`Break::TooManyScopes`] the default limit of 64.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Break {
    /// `typ` `JWT` (`at+jwt` on an ID token).
    Typ,
    /// `alg` `ES512`, which AFD can never be configured to accept.
    Alg,
    /// `alg` `none` and an empty signature.
    AlgNone,
    /// `alg` `HS256`, an HMAC keyed with the signing key's public bytes (the confusion attack).
    Hs256,
    /// No `kid`.
    MissingKid,
    /// A `kid` that is not in the key set.
    UnknownKid,
    /// The `kid` of a key whose type does not fit the `alg` (an RSA key under `ES256`, or the
    /// P-256 key under an RSA algorithm).
    KeyMismatch,
    /// A `crit` header.
    Crit,
    /// A `jku` header.
    Jku,
    /// An `x5u` header.
    X5u,
    /// An `x5c` header.
    X5c,
    /// An embedded `jwk` header (the signing key's own public JWK).
    Jwk,
    /// The header repeats a member name (`typ`).
    DuplicateHeaderMember,
    /// The claims repeat a member name (`sub`).
    DuplicateClaim,
    /// Signed by another key of the same kind, under the published `kid`.
    Signature,
    /// An `iss` no verifier is configured for (`<iss>/unknown`).
    UnknownIssuer,
    /// Another resource as `aud`.
    Audience,
    /// The right resource and another, as an array.
    MultipleAudiences,
    /// A required claim left out.
    Missing(RequiredClaim),
    /// An empty `sub`.
    EmptySubject,
    /// A control character (U+0007) in `sub`.
    ControlCharacter,
    /// A `jti` of 256 characters.
    LongClaim,
    /// `exp` as a string.
    StringTime,
    /// Expired an hour ago.
    Expired,
    /// Issued an hour from now.
    NotYetValid,
    /// `nbf` an hour from now.
    NotBefore,
    /// A lifetime (`exp - iat`) of a day.
    LifetimeTooLong,
    /// `iat` a second from now and `exp` now: `exp` before `iat`, both within a skew of 2 seconds
    /// when the token is verified less than `skew - 1` seconds after the break is applied.
    ExpiresBeforeIssued,
    /// A `scope` with two spaces between scopes.
    MalformedScope,
    /// 65 scopes under the prefix `umbel`.
    TooManyScopes,
    /// `cnf.jkt` (a DPoP-bound token).
    DpopBound,
    /// `cnf["x5t#S256"]` of a certificate the request does not present.
    WrongCertificate,
    /// A `cnf` that is not an object.
    CnfNotObject,
}

impl Break {
    /// Every break.
    pub const ALL: [Break; 37] = [
        Self::Typ,
        Self::Alg,
        Self::AlgNone,
        Self::Hs256,
        Self::MissingKid,
        Self::UnknownKid,
        Self::KeyMismatch,
        Self::Crit,
        Self::Jku,
        Self::X5u,
        Self::X5c,
        Self::Jwk,
        Self::DuplicateHeaderMember,
        Self::DuplicateClaim,
        Self::Signature,
        Self::UnknownIssuer,
        Self::Audience,
        Self::MultipleAudiences,
        Self::Missing(RequiredClaim::Exp),
        Self::Missing(RequiredClaim::Iat),
        Self::Missing(RequiredClaim::Jti),
        Self::Missing(RequiredClaim::Sub),
        Self::Missing(RequiredClaim::ClientId),
        Self::EmptySubject,
        Self::ControlCharacter,
        Self::LongClaim,
        Self::StringTime,
        Self::Expired,
        Self::NotYetValid,
        Self::NotBefore,
        Self::LifetimeTooLong,
        Self::ExpiresBeforeIssued,
        Self::MalformedScope,
        Self::TooManyScopes,
        Self::DpopBound,
        Self::WrongCertificate,
        Self::CnfNotObject,
    ];

    /// The rule code (`spec/authorization.md`, M5) AFD's `JwtVerifier` refuses such an access
    /// token with, under its default rules and an issuer accepting every [`Algorithm`].
    pub fn rule(self) -> &'static str {
        match self {
            Self::Typ | Self::DuplicateHeaderMember => "typ",
            Self::Alg | Self::AlgNone | Self::Hs256 => "alg",
            Self::MissingKid => "kid",
            Self::UnknownKid | Self::KeyMismatch => "key",
            Self::Crit => "crit",
            Self::Jku | Self::X5u | Self::X5c | Self::Jwk => "key-reference",
            Self::DuplicateClaim | Self::UnknownIssuer => "unknown-issuer",
            Self::Signature => "signature",
            Self::Audience | Self::MultipleAudiences => "audience",
            Self::Missing(_)
            | Self::EmptySubject
            | Self::ControlCharacter
            | Self::LongClaim
            | Self::StringTime => "claims",
            Self::Expired => "expired",
            Self::NotYetValid | Self::NotBefore => "not-yet-valid",
            Self::LifetimeTooLong | Self::ExpiresBeforeIssued => "lifetime",
            Self::MalformedScope => "scope-malformed",
            Self::TooManyScopes => "scopes-too-many",
            Self::DpopBound => "dpop-unsupported",
            Self::WrongCertificate | Self::CnfNotObject => "binding",
        }
    }
}

/// How the authorization server answers an introspection request for one token (RFC 7662).
#[derive(Debug, Clone, PartialEq)]
pub enum IntrospectionAnswer {
    /// `active: true` with the token's claims and `token_type` `Bearer`, or `active: false`
    /// once it has expired or been revoked. The default.
    Claims,
    /// `{"active": false}`.
    Inactive,
    /// The normal answer without this member.
    Without(String),
    /// The normal answer with an RFC 7396 merge patch applied.
    Patch(Value),
    /// Exactly this JSON value, whatever the token's state.
    Raw(Value),
}

pub(crate) struct Registered {
    claims: Map<String, Value>,
    answer: IntrospectionAnswer,
    revoked: bool,
}

/// The tokens an authorization server issued, by token string, for introspection.
#[derive(Default)]
pub(crate) struct Registry {
    tokens: Mutex<HashMap<String, Registered>>,
}

impl Registry {
    fn insert(&self, token: &str, claims: Map<String, Value>, answer: IntrospectionAnswer) {
        lock(&self.tokens).insert(
            token.to_owned(),
            Registered {
                claims,
                answer,
                revoked: false,
            },
        );
    }

    pub(crate) fn revoke(&self, token: &str) -> bool {
        match lock(&self.tokens).get_mut(token) {
            Some(entry) => {
                entry.revoked = true;
                true
            }
            None => false,
        }
    }

    pub(crate) fn set_answer(&self, token: &str, answer: IntrospectionAnswer) -> bool {
        match lock(&self.tokens).get_mut(token) {
            Some(entry) => {
                entry.answer = answer;
                true
            }
            None => false,
        }
    }

    /// The RFC 7662 answer for `token` at `now`.
    pub(crate) fn answer(&self, token: &str, now: i64) -> Value {
        let tokens = lock(&self.tokens);
        let Some(entry) = tokens.get(token) else {
            return json!({ "active": false });
        };
        let normal = || {
            let expired = entry
                .claims
                .get("exp")
                .and_then(Value::as_f64)
                .is_some_and(|exp| exp <= now as f64);
            if entry.revoked || expired {
                return json!({ "active": false });
            }
            let mut answer = Map::new();
            answer.insert("active".into(), Value::Bool(true));
            answer.insert("token_type".into(), json!("Bearer"));
            for (name, value) in &entry.claims {
                answer.insert(name.clone(), value.clone());
            }
            Value::Object(answer)
        };
        match &entry.answer {
            IntrospectionAnswer::Claims => normal(),
            IntrospectionAnswer::Inactive => json!({ "active": false }),
            IntrospectionAnswer::Without(member) => {
                let mut answer = normal();
                if let Some(answer) = answer.as_object_mut() {
                    answer.remove(member);
                }
                answer
            }
            IntrospectionAnswer::Patch(patch) => {
                let mut answer = normal();
                merge_patch(&mut answer, patch);
                answer
            }
            IntrospectionAnswer::Raw(value) => value.clone(),
        }
    }
}

/// RFC 7396 JSON merge patch.
pub(crate) fn merge_patch(target: &mut Value, patch: &Value) {
    let Value::Object(patch) = patch else {
        *target = patch.clone();
        return;
    };
    if !target.is_object() {
        *target = Value::Object(Map::new());
    }
    if let Value::Object(members) = target {
        for (name, value) in patch {
            if value.is_null() {
                members.remove(name);
            } else {
                merge_patch(members.entry(name.clone()).or_insert(Value::Null), value);
            }
        }
    }
}

#[derive(Clone)]
enum KidChoice {
    Signing,
    Absent,
    Value(String),
}

#[derive(Clone)]
enum SignatureChoice {
    Valid,
    OtherKey,
    Empty,
    HmacWithPublicKey,
}

/// A token to sign. The role that made it set valid defaults for its [`TokenKind`]; every setter
/// changes exactly what it names, and a [`Break`] breaks one rule.
///
/// The defaults: `iat` now; a lifetime of 300 seconds (60 for a gateway assertion); a `jti` of 16
/// random bytes; `ES256` for access tokens and gateway assertions and `RS256` for ID tokens and
/// ID-JAGs (the algorithm OpenID Connect and the ID-JAG draft make mandatory); the role's current
/// key of the algorithm's kind, named by its `kid`.
#[derive(Clone)]
pub struct TokenBuilder {
    kind: TokenKind,
    keys: Arc<KeySet>,
    registry: Option<Arc<Registry>>,
    header: Map<String, Value>,
    claims: Map<String, Value>,
    algorithm: Algorithm,
    signing_kid: Option<String>,
    kid: KidChoice,
    signature: SignatureChoice,
    header_duplicates: Vec<String>,
    claim_duplicates: Vec<String>,
    answer: IntrospectionAnswer,
}

impl fmt::Debug for TokenBuilder {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TokenBuilder")
            .field("kind", &self.kind)
            .field("header", &self.header)
            .field("claims", &self.claims)
            .finish_non_exhaustive()
    }
}

impl TokenBuilder {
    pub(crate) fn new(
        kind: TokenKind,
        keys: Arc<KeySet>,
        registry: Option<Arc<Registry>>,
        claims: Map<String, Value>,
    ) -> Self {
        let (typ, algorithm) = match kind {
            TokenKind::AccessToken | TokenKind::Opaque => {
                (crate::ACCESS_TOKEN_TYP, Algorithm::ES256)
            }
            TokenKind::IdToken => ("JWT", Algorithm::RS256),
            TokenKind::IdJag => (crate::ID_JAG_TYP, Algorithm::RS256),
            TokenKind::GatewayAssertion => (crate::GATEWAY_ASSERTION_TYP, Algorithm::ES256),
        };
        let mut header = Map::new();
        header.insert("alg".into(), json!(algorithm.name()));
        header.insert("typ".into(), json!(typ));
        Self {
            kind,
            keys,
            registry,
            header,
            claims,
            algorithm,
            signing_kid: None,
            kid: KidChoice::Signing,
            signature: SignatureChoice::Valid,
            header_duplicates: Vec::new(),
            claim_duplicates: Vec::new(),
            answer: IntrospectionAnswer::Claims,
        }
    }

    /// What it makes.
    pub fn kind(&self) -> TokenKind {
        self.kind
    }

    /// The claims so far.
    pub fn claims(&self) -> &Map<String, Value> {
        &self.claims
    }

    /// The header so far, before the `kid` of the signing key is added.
    pub fn header(&self) -> &Map<String, Value> {
        &self.header
    }

    /// Set `sub`.
    pub fn subject(self, subject: &str) -> Self {
        self.claim("sub", json!(subject))
    }

    /// Set `client_id`.
    pub fn client_id(self, client_id: &str) -> Self {
        self.claim("client_id", json!(client_id))
    }

    /// Set `aud` to one string.
    pub fn audience(self, audience: &str) -> Self {
        self.claim("aud", json!(audience))
    }

    /// Set `aud` to an array.
    pub fn audiences<I, S>(self, audiences: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let audiences: Vec<String> = audiences.into_iter().map(Into::into).collect();
        self.claim("aud", json!(audiences))
    }

    /// Set `scope` to these scopes, separated by single spaces.
    pub fn scopes<I, S>(self, scopes: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let scopes: Vec<String> = scopes.into_iter().map(Into::into).collect();
        self.claim("scope", json!(scopes.join(" ")))
    }

    /// Set `scope` to exactly this text.
    pub fn scope_text(self, scope: &str) -> Self {
        self.claim("scope", json!(scope))
    }

    /// Set `jti`.
    pub fn jti(self, jti: &str) -> Self {
        self.claim("jti", json!(jti))
    }

    /// Set `nonce` (ID tokens).
    pub fn nonce(self, nonce: &str) -> Self {
        self.claim("nonce", json!(nonce))
    }

    /// Set `iat` and move `exp` with it, keeping the lifetime.
    pub fn issued_at(mut self, iat: i64) -> Self {
        let lifetime = self.lifetime_s();
        self.claims.insert("iat".into(), json!(iat));
        self.claims.insert("exp".into(), json!(iat + lifetime));
        self
    }

    /// Set `exp` to `iat + seconds`.
    pub fn lifetime(mut self, seconds: i64) -> Self {
        let iat = self
            .claims
            .get("iat")
            .and_then(Value::as_i64)
            .unwrap_or_else(now);
        self.claims.insert("exp".into(), json!(iat + seconds));
        self
    }

    /// Set `exp`.
    pub fn expires_at(self, exp: i64) -> Self {
        self.claim("exp", json!(exp))
    }

    /// Set `nbf`.
    pub fn not_before(self, nbf: i64) -> Self {
        self.claim("nbf", json!(nbf))
    }

    /// Bind the token to `certificate` (RFC 8705): `cnf["x5t#S256"]`.
    pub fn certificate(self, certificate: &IssuedCertificate) -> Self {
        self.cnf_x5t_s256(&certificate.x5t_s256())
    }

    /// Set `cnf` to `{"x5t#S256": thumbprint}`.
    pub fn cnf_x5t_s256(self, thumbprint: &str) -> Self {
        self.claim("cnf", json!({ "x5t#S256": thumbprint }))
    }

    /// Set any claim.
    pub fn claim(mut self, name: &str, value: Value) -> Self {
        self.claims.insert(name.to_owned(), value);
        self
    }

    /// Leave a claim out.
    pub fn without_claim(mut self, name: &str) -> Self {
        self.claims.remove(name);
        self
    }

    /// Set any header member (`alg` changes only the header; [`Self::algorithm`] changes how it
    /// is signed too; `kid` replaces the signing key's).
    pub fn header_member(mut self, name: &str, value: Value) -> Self {
        if name == "kid" {
            self.kid = match value {
                Value::String(kid) => KidChoice::Value(kid),
                other => {
                    self.header.insert(name.to_owned(), other);
                    KidChoice::Absent
                }
            };
            return self;
        }
        self.header.insert(name.to_owned(), value);
        self
    }

    /// Leave a header member out (`kid` included).
    pub fn without_header_member(mut self, name: &str) -> Self {
        if name == "kid" {
            self.kid = KidChoice::Absent;
        }
        self.header.remove(name);
        self
    }

    /// Sign with `algorithm` (setting the header's `alg`), under the current key of its kind
    /// unless [`Self::signing_key`] names one.
    pub fn algorithm(mut self, algorithm: Algorithm) -> Self {
        self.algorithm = algorithm;
        self.header.insert("alg".into(), json!(algorithm.name()));
        self
    }

    /// Sign with the key `kid` (published or retired), naming it in the header.
    pub fn signing_key(mut self, kid: &str) -> Self {
        self.signing_kid = Some(kid.to_owned());
        self
    }

    /// How the authorization server answers introspection of this token (registered tokens only).
    pub fn introspection(mut self, answer: IntrospectionAnswer) -> Self {
        self.answer = answer;
        self
    }

    /// Break exactly one rule (section 3.2); see [`Break`].
    pub fn break_rule(mut self, rule: Break) -> Self {
        let now = now();
        let other_resource = "https://other.invalid/mcp";
        match rule {
            Break::Typ => {
                let wrong = if self.kind == TokenKind::IdToken {
                    crate::ACCESS_TOKEN_TYP
                } else {
                    "JWT"
                };
                self.header_member("typ", json!(wrong))
            }
            Break::Alg => self.header_member("alg", json!("ES512")),
            Break::AlgNone => {
                self.signature = SignatureChoice::Empty;
                self.header_member("alg", json!("none"))
            }
            Break::Hs256 => {
                self.signature = SignatureChoice::HmacWithPublicKey;
                self.header_member("alg", json!("HS256"))
            }
            Break::MissingKid => self.without_header_member("kid"),
            Break::UnknownKid => {
                let kid = format!("unknown-{}", random_token(8));
                self.header_member("kid", json!(kid))
            }
            Break::KeyMismatch => {
                let other = if self.algorithm.key_kind() == KeyKind::Rsa {
                    KeyKind::P256
                } else {
                    KeyKind::Rsa
                };
                let kid = self.keys.current_kid(other);
                self.header_member("kid", json!(kid))
            }
            Break::Crit => self
                .header_member("x-testkit", json!(true))
                .header_member("crit", json!(["x-testkit"])),
            Break::Jku => self.header_member("jku", json!("https://attacker.invalid/jwks")),
            Break::X5u => self.header_member("x5u", json!("https://attacker.invalid/cert.pem")),
            Break::X5c => {
                let der = base64::engine::general_purpose::STANDARD.encode(random_bytes(64));
                self.header_member("x5c", json!([der]))
            }
            Break::Jwk => {
                let jwk = self
                    .signer()
                    .map(|key| key.public_jwk())
                    .unwrap_or(Value::Null);
                self.header_member("jwk", jwk)
            }
            Break::DuplicateHeaderMember => {
                self.header_duplicates.push("typ".into());
                self
            }
            Break::DuplicateClaim => {
                self.claim_duplicates.push("sub".into());
                self
            }
            Break::Signature => {
                self.signature = SignatureChoice::OtherKey;
                self
            }
            Break::UnknownIssuer => {
                let iss = self.claims.get("iss").and_then(Value::as_str).unwrap_or("");
                let iss = format!("{iss}/unknown");
                self.claim("iss", json!(iss))
            }
            Break::Audience => self.audience(other_resource),
            Break::MultipleAudiences => {
                let mut audiences = match self.claims.get("aud") {
                    Some(Value::Array(audiences)) => audiences.clone(),
                    Some(aud) => vec![aud.clone()],
                    None => Vec::new(),
                };
                audiences.push(json!(other_resource));
                self.claim("aud", Value::Array(audiences))
            }
            Break::Missing(RequiredClaim::ClientId) if self.kind == TokenKind::GatewayAssertion => {
                self.without_claim("client")
            }
            Break::Missing(claim) => self.without_claim(claim.name()),
            Break::EmptySubject => self.subject(""),
            Break::ControlCharacter => {
                let sub = self.claims.get("sub").and_then(Value::as_str).unwrap_or("");
                let sub = format!("{sub}\u{7}");
                self.subject(&sub)
            }
            Break::LongClaim => self.jti(&"j".repeat(256)),
            Break::StringTime => {
                let exp = self.claims.get("exp").cloned().unwrap_or(json!(now + 300));
                self.claim("exp", json!(exp.to_string()))
            }
            Break::Expired => self.issued_at(now - 3900).lifetime(300),
            Break::NotYetValid => self.issued_at(now + 3600).lifetime(300),
            Break::NotBefore => self.not_before(now + 3600),
            Break::LifetimeTooLong => self.issued_at(now).lifetime(86_400),
            Break::ExpiresBeforeIssued => self.issued_at(now + 1).lifetime(-1),
            Break::MalformedScope => self.scope_text("umbel:read  umbel:write"),
            Break::TooManyScopes => {
                self.scopes((0..65).map(|index| format!("umbel:read:space-{index}")))
            }
            Break::DpopBound => {
                let jkt = b64(random_bytes(32));
                self.claim("cnf", json!({ "jkt": jkt }))
            }
            Break::WrongCertificate => {
                let thumbprint = b64(random_bytes(32));
                self.cnf_x5t_s256(&thumbprint)
            }
            Break::CnfNotObject => self.claim("cnf", json!("x5t#S256")),
        }
    }

    fn lifetime_s(&self) -> i64 {
        match (
            self.claims.get("iat").and_then(Value::as_i64),
            self.claims.get("exp").and_then(Value::as_i64),
        ) {
            (Some(iat), Some(exp)) => exp - iat,
            _ => 300,
        }
    }

    fn signer(&self) -> Option<Arc<Key>> {
        match &self.signing_kid {
            Some(kid) => self.keys.key(kid),
            None => self.keys.current(self.algorithm.key_kind()),
        }
    }

    /// The token: a compact JWS, or for [`TokenKind::Opaque`] 32 random bytes in base64url. A token
    /// of the authorization server is registered for introspection.
    ///
    /// # Panics
    /// When [`Self::signing_key`] names no key or one that cannot sign with the algorithm: a
    /// mistake in the test, not a case to test.
    #[allow(
        clippy::expect_used,
        reason = "a key that cannot sign is a mistake in the test, and the builder is for tests"
    )]
    pub fn sign(self) -> String {
        self.try_sign()
            .expect("umbel-testkit-idp cannot sign this token")
    }

    /// [`Self::sign`], returning the error.
    ///
    /// # Errors
    /// The signing key does not exist, or cannot sign with the algorithm.
    pub fn try_sign(self) -> Result<String, Error> {
        if self.kind == TokenKind::Opaque {
            let token = random_token(32);
            if let Some(registry) = &self.registry {
                registry.insert(&token, self.claims, self.answer);
            }
            return Ok(token);
        }
        let key = self
            .signer()
            .ok_or_else(|| Error::new("no such signing key"))?;
        let mut header = self.header.clone();
        match &self.kid {
            KidChoice::Signing => {
                header.insert("kid".into(), json!(key.kid()));
            }
            KidChoice::Value(kid) => {
                header.insert("kid".into(), json!(kid));
            }
            KidChoice::Absent => {}
        }
        let header_text = object_text(&header, &self.header_duplicates);
        let claims_text = object_text(&self.claims, &self.claim_duplicates);
        let message = format!("{}.{}", b64(header_text), b64(claims_text));
        let signature = match self.signature {
            SignatureChoice::Valid => key.sign(self.algorithm, message.as_bytes())?,
            SignatureChoice::OtherKey => Key::generate(key.kind(), key.kid().to_owned())?
                .sign(self.algorithm, message.as_bytes())?,
            SignatureChoice::Empty => Vec::new(),
            SignatureChoice::HmacWithPublicKey => {
                let hmac =
                    aws_lc_rs::hmac::Key::new(aws_lc_rs::hmac::HMAC_SHA256, &key.public_bytes());
                aws_lc_rs::hmac::sign(&hmac, message.as_bytes())
                    .as_ref()
                    .to_vec()
            }
        };
        let token = format!("{message}.{}", b64(signature));
        if self.kind == TokenKind::AccessToken
            && let Some(registry) = &self.registry
        {
            registry.insert(&token, self.claims, self.answer);
        }
        Ok(token)
    }
}

/// The JSON text of `members`, then each of `duplicates` repeated with its value.
fn object_text(members: &Map<String, Value>, duplicates: &[String]) -> String {
    let text = Value::Object(members.clone()).to_string();
    if duplicates.is_empty() {
        return text;
    }
    let mut text = text[..text.len() - 1].to_owned();
    for name in duplicates {
        let value = members.get(name).cloned().unwrap_or(Value::Null);
        if text.len() > 1 {
            text.push(',');
        }
        text.push_str(&format!("{}:{value}", Value::String(name.clone())));
    }
    text.push('}');
    text
}

/// A JSON object: a JOSE header or a claims set.
pub(crate) type JsonObject = Map<String, Value>;

/// A compact JWS the kit received, verified under `keys` (published keys only): its header and
/// claims. The header must name an [`Algorithm`] and a `kid` and carry no `crit`, `jku`, `x5u`,
/// `x5c` or `jwk`; with `typ`, its `typ` must equal it ignoring ASCII case. Member names must be
/// unique. Each refusal is a short reason for an `error_description`.
pub(crate) fn verify_signed(
    token: &str,
    keys: &KeySet,
    typ: Option<&str>,
) -> Result<(JsonObject, JsonObject), &'static str> {
    let parts: Vec<&str> = token.split('.').collect();
    let [header_part, claims_part, signature_part] = parts[..] else {
        return Err("the token is not a compact JWS");
    };
    let header = decode_object(header_part).ok_or("the JWS header is not one JSON object")?;
    let claims = decode_object(claims_part).ok_or("the JWS payload is not one JSON object")?;
    if let Some(typ) = typ
        && !header
            .get("typ")
            .and_then(Value::as_str)
            .is_some_and(|value| value.eq_ignore_ascii_case(typ))
    {
        return Err("the JWS typ is wrong");
    }
    if ["crit", "jku", "x5u", "x5c", "jwk"]
        .iter()
        .any(|member| header.contains_key(*member))
    {
        return Err("the JWS header has a member the kit refuses");
    }
    let algorithm = header
        .get("alg")
        .and_then(Value::as_str)
        .and_then(Algorithm::named)
        .ok_or("the JWS alg is not accepted")?;
    let kid = header
        .get("kid")
        .and_then(Value::as_str)
        .ok_or("the JWS has no kid")?;
    let key = keys
        .published_key(kid)
        .ok_or("the JWS kid is not in the issuer's key set")?;
    if key.kind() != algorithm.key_kind() {
        return Err("the JWS kid names a key of another type");
    }
    let signature = URL_SAFE_NO_PAD
        .decode(signature_part)
        .map_err(|_| "the JWS signature is not base64url")?;
    let verifier = (jsonwebtoken::crypto::aws_lc::DEFAULT_PROVIDER.verifier_factory)(
        &algorithm.backend(),
        &key.decoding_key(),
    )
    .map_err(|_| "the JWS key cannot verify")?;
    let message = &token[..header_part.len() + 1 + claims_part.len()];
    verifier
        .verify(message.as_bytes(), &signature)
        .map_err(|_| "the JWS signature does not verify")?;
    Ok((header, claims))
}

/// A base64url part decoded to a JSON object with unique member names at every depth.
fn decode_object(part: &str) -> Option<Map<String, Value>> {
    let bytes = URL_SAFE_NO_PAD.decode(part).ok()?;
    match serde_json::from_slice::<Strict>(&bytes).ok()?.0 {
        Value::Object(members) => Some(members),
        _ => None,
    }
}

/// A JSON value whose objects have unique member names (RFC 7515 section 4, RFC 7519 section 4).
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
    use super::*;

    #[test]
    fn duplicates_are_written_and_refused() {
        let mut members = Map::new();
        members.insert("a".into(), json!(1));
        let text = object_text(&members, &["a".to_owned()]);
        assert_eq!(text, r#"{"a":1,"a":1}"#);
        assert!(decode_object(&b64(&text)).is_none());
        assert!(decode_object(&b64(r#"{"a":{"b":1,"b":2}}"#)).is_none());
        assert!(decode_object(&b64(r#"{"a":1}"#)).is_some());
    }

    #[test]
    fn merge_patch_follows_rfc_7396() {
        let mut target = json!({ "a": "b", "c": { "d": "e", "f": "g" } });
        merge_patch(&mut target, &json!({ "a": "z", "c": { "f": null } }));
        assert_eq!(target, json!({ "a": "z", "c": { "d": "e" } }));
    }
}
