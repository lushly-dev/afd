//! AFD's JWT access-token verifier (`spec/authorization.md`, M3, RFC 9068).
//!
//! `jsonwebtoken` (on its `aws-lc-rs` provider, called directly) checks the signature and nothing
//! else: AFD never calls `jsonwebtoken::decode` and never builds a `Validation`, so no library
//! default applies. Routing, every header and key rule, and every claim rule are this module's
//! and [`super::claims`]'s own code, in the specification's order.

use std::fmt;
use std::sync::Arc;

use async_trait::async_trait;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use jsonwebtoken::{Algorithm, DecodingKey};
use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};

use crate::clock::{Clock, SYSTEM_CLOCK};
use crate::credentials::Credentials;

use super::claims::{check_claims, check_jws_header, check_key_fit, TokenRules};
use super::{AuthRefusal, RuleCode, TokenVerifier};

/// The JWS algorithms AFD's verifier can check. `none`, the `HS*` family, `ES512` and Ed448 are
/// not here: the first two are always refused, and the backend verifies neither of the others.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum SigningAlgorithm {
    /// RSASSA-PKCS1-v1_5 with SHA-256.
    RS256,
    /// RSASSA-PKCS1-v1_5 with SHA-384.
    RS384,
    /// RSASSA-PKCS1-v1_5 with SHA-512.
    RS512,
    /// RSASSA-PSS with SHA-256.
    PS256,
    /// RSASSA-PSS with SHA-384.
    PS384,
    /// RSASSA-PSS with SHA-512.
    PS512,
    /// ECDSA on P-256 with SHA-256.
    ES256,
    /// ECDSA on P-384 with SHA-384.
    ES384,
    /// EdDSA on Ed25519.
    EdDSA,
}

impl SigningAlgorithm {
    /// The JWS `alg` name.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RS256 => "RS256",
            Self::RS384 => "RS384",
            Self::RS512 => "RS512",
            Self::PS256 => "PS256",
            Self::PS384 => "PS384",
            Self::PS512 => "PS512",
            Self::ES256 => "ES256",
            Self::ES384 => "ES384",
            Self::EdDSA => "EdDSA",
        }
    }

    fn backend(self) -> Algorithm {
        match self {
            Self::RS256 => Algorithm::RS256,
            Self::RS384 => Algorithm::RS384,
            Self::RS512 => Algorithm::RS512,
            Self::PS256 => Algorithm::PS256,
            Self::PS384 => Algorithm::PS384,
            Self::PS512 => Algorithm::PS512,
            Self::ES256 => Algorithm::ES256,
            Self::ES384 => Algorithm::ES384,
            Self::EdDSA => Algorithm::EdDSA,
        }
    }

    fn named(alg: &str) -> Option<Self> {
        [
            Self::RS256,
            Self::RS384,
            Self::RS512,
            Self::PS256,
            Self::PS384,
            Self::PS512,
            Self::ES256,
            Self::ES384,
            Self::EdDSA,
        ]
        .into_iter()
        .find(|algorithm| algorithm.as_str() == alg)
    }
}

impl fmt::Display for SigningAlgorithm {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A JSON Web Key (RFC 7517) as its JSON object, so that the key rules read exactly the members
/// the issuer published.
#[derive(Clone, PartialEq)]
pub struct Jwk(Map<String, Value>);

impl Jwk {
    /// A key from its JSON object.
    ///
    /// # Errors
    /// `value` is not a JSON object.
    pub fn from_value(value: Value) -> Result<Self, String> {
        match value {
            Value::Object(members) => Ok(Self(members)),
            _ => Err("[AFD] a JWK is a JSON object".to_owned()),
        }
    }

    /// The key's members.
    pub fn members(&self) -> &Map<String, Value> {
        &self.0
    }

    /// The key's `kid`, when it is a string.
    pub fn kid(&self) -> Option<&str> {
        self.0.get("kid").and_then(Value::as_str)
    }
}

impl fmt::Debug for Jwk {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Jwk")
            .field("kid", &self.kid())
            .field("kty", &self.0.get("kty").and_then(Value::as_str))
            .finish_non_exhaustive()
    }
}

/// Why a [`KeySource`] gave no key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum KeyError {
    /// The issuer's key set holds no key with that `kid`: the token is refused with `key`.
    Unknown,
    /// The key set could not be fetched or read: the token is refused with `unavailable`, and the
    /// request fails closed.
    Unavailable,
}

/// Where an issuer's signing keys come from. The host fetches them (its JWKS, its cache, its
/// refetch policy); AFD opens no socket.
///
/// The `kid` comes from a token AFD has not yet verified, so it is the caller's choice: refetch
/// on an unknown `kid` at most once in a while per issuer, and keep the last good keys, rather
/// than let a stream of made-up `kid`s drive requests to the issuer.
#[async_trait]
pub trait KeySource: Send + Sync {
    /// The key of `issuer` (its exact configured string) with this `kid`.
    async fn key(&self, issuer: &str, kid: &str) -> Result<Jwk, KeyError>;
}

/// A fixed key set, for an issuer whose keys are configured rather than fetched (and for tests).
#[derive(Debug, Clone)]
pub struct StaticKeys {
    keys: Vec<Jwk>,
}

impl StaticKeys {
    /// The keys of a JWKS document (`{ "keys": [...] }`).
    ///
    /// # Errors
    /// The document has no `keys` array, or a key is not an object with a non-empty string
    /// `kid` that no other key has.
    pub fn from_jwks(document: &Value) -> Result<Self, String> {
        let keys = document
            .get("keys")
            .and_then(Value::as_array)
            .ok_or("[AFD] a JWKS document has a \"keys\" array")?;
        let mut parsed: Vec<Jwk> = Vec::new();
        for key in keys {
            let key = Jwk::from_value(key.clone())?;
            let Some(kid) = key.kid().filter(|kid| !kid.is_empty()) else {
                return Err("[AFD] every key of a JWKS document needs a non-empty kid".to_owned());
            };
            if parsed.iter().any(|kept| kept.kid() == Some(kid)) {
                return Err(format!("[AFD] kid {kid:?} appears more than once"));
            }
            parsed.push(key);
        }
        Ok(Self { keys: parsed })
    }
}

#[async_trait]
impl KeySource for StaticKeys {
    async fn key(&self, _issuer: &str, kid: &str) -> Result<Jwk, KeyError> {
        self.keys
            .iter()
            .find(|key| key.kid() == Some(kid))
            .cloned()
            .ok_or(KeyError::Unknown)
    }
}

/// One issuer whose JWT access tokens a [`JwtVerifier`] accepts.
#[derive(Clone)]
pub struct JwtIssuer {
    alias: String,
    issuer: String,
    algorithms: Vec<SigningAlgorithm>,
    keys: Arc<dyn KeySource>,
}

impl fmt::Debug for JwtIssuer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("JwtIssuer")
            .field("alias", &self.alias)
            .field("issuer", &self.issuer)
            .field("algorithms", &self.algorithms)
            .finish_non_exhaustive()
    }
}

impl JwtIssuer {
    /// The issuer `issuer` (its exact `iss` string), logged as `alias` when one of its tokens is
    /// refused, signing with `algorithms`, whose keys come from `keys`.
    ///
    /// # Errors
    /// `alias` is empty, longer than 64 bytes or not visible ASCII; `issuer` is not an absolute
    /// `https` URL without user information, query or fragment; `algorithms` is empty.
    pub fn new<I>(
        alias: impl Into<String>,
        issuer: impl Into<String>,
        algorithms: I,
        keys: impl KeySource + 'static,
    ) -> Result<Self, String>
    where
        I: IntoIterator<Item = SigningAlgorithm>,
    {
        let alias = alias.into();
        if alias.is_empty() || alias.len() > 64 || !alias.bytes().all(|b| b.is_ascii_graphic()) {
            return Err(format!(
                "[AFD] issuer alias {alias:?} must be 1 to 64 visible ASCII characters"
            ));
        }
        let issuer = issuer.into();
        super::resource::check_https_url("issuer", &issuer)?;
        let mut kept: Vec<SigningAlgorithm> = Vec::new();
        for algorithm in algorithms {
            if !kept.contains(&algorithm) {
                kept.push(algorithm);
            }
        }
        if kept.is_empty() {
            return Err(format!("[AFD] issuer {alias:?} lists no signing algorithm"));
        }
        Ok(Self {
            alias,
            issuer,
            algorithms: kept,
            keys: Arc::new(keys),
        })
    }

    /// The alias logged with a refused token's rule code.
    pub fn alias(&self) -> &str {
        &self.alias
    }

    /// The issuer's exact `iss` string.
    pub fn issuer(&self) -> &str {
        &self.issuer
    }
}

/// The SHA-256 thumbprint of the request's TLS client certificate (RFC 8705 3.1), which the host's
/// TLS layer inserts into the request's extensions for certificate-bound tokens.
#[derive(Clone, PartialEq, Eq)]
pub struct ClientCertificate {
    thumbprint: String,
}

impl ClientCertificate {
    /// The certificate presented in the TLS handshake, as DER.
    pub fn from_der(der: &[u8]) -> Self {
        Self {
            thumbprint: URL_SAFE_NO_PAD.encode(Sha256::digest(der)),
        }
    }

    /// The thumbprint: unpadded base64url of the SHA-256 of the DER certificate.
    pub fn thumbprint(&self) -> &str {
        &self.thumbprint
    }
}

impl fmt::Debug for ClientCertificate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ClientCertificate([redacted])")
    }
}

/// AFD's verifier of JWT access tokens (RFC 9068), applying `spec/authorization.md` M3 in order.
///
/// A compact JWS goes to the configured issuer its unverified `iss` names exactly (else
/// `unknown-issuer`). Any other token goes to the introspection verifier, when one is set with
/// [`Self::with_introspection`], and is otherwise refused with `unknown-issuer`: a token is never
/// sent to an issuer that did not issue it. A JWS whose header or payload is not a JSON object
/// with unique member names is refused (`typ` for the header, `unknown-issuer` for the payload).
#[derive(Clone)]
pub struct JwtVerifier {
    rules: TokenRules,
    issuers: Vec<JwtIssuer>,
    introspection: Option<Arc<dyn TokenVerifier>>,
    clock: Arc<dyn Clock>,
}

impl fmt::Debug for JwtVerifier {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("JwtVerifier")
            .field("rules", &self.rules)
            .field("issuers", &self.issuers)
            .field("introspection", &self.introspection.is_some())
            .finish_non_exhaustive()
    }
}

impl JwtVerifier {
    /// A verifier of the `issuers`' tokens under `rules`.
    ///
    /// # Errors
    /// No issuer, or two with the same `iss` string or alias.
    pub fn new(rules: TokenRules, issuers: Vec<JwtIssuer>) -> Result<Self, String> {
        if issuers.is_empty() {
            return Err("[AFD] a JWT verifier needs at least one issuer".to_owned());
        }
        for (index, issuer) in issuers.iter().enumerate() {
            if issuers[..index]
                .iter()
                .any(|earlier| earlier.issuer == issuer.issuer || earlier.alias == issuer.alias)
            {
                return Err(format!(
                    "[AFD] issuer {:?} ({}) is configured more than once",
                    issuer.alias, issuer.issuer
                ));
            }
        }
        Ok(Self {
            rules,
            issuers,
            introspection: None,
            clock: Arc::new(SYSTEM_CLOCK),
        })
    }

    /// Send every token that is not a compact JWS to `verifier`, the one introspection issuer
    /// (`spec/authorization.md`, M3 rule 1). It should apply
    /// [`check_introspection`](super::check_introspection) to the endpoint's answer.
    pub fn with_introspection(mut self, verifier: impl TokenVerifier + 'static) -> Self {
        self.introspection = Some(Arc::new(verifier));
        self
    }

    /// Read the time from `clock`. Default: the system clock.
    pub fn with_clock(mut self, clock: impl Clock + 'static) -> Self {
        self.clock = Arc::new(clock);
        self
    }

    /// The rules the claims must pass.
    pub fn rules(&self) -> &TokenRules {
        &self.rules
    }

    /// Verify `token` for a request whose TLS client certificate has the thumbprint `certificate`
    /// (`None` for none). The refusal names the rule code and, once the issuer is known, its
    /// alias; never the token or a claim value.
    ///
    /// # Errors
    /// The first broken rule of M3.
    pub async fn verify_token(
        &self,
        token: &str,
        certificate: Option<&str>,
    ) -> Result<Credentials, AuthRefusal> {
        let Some([header_part, payload_part, signature_part]) = compact_jws_parts(token) else {
            return Err(AuthRefusal::new(RuleCode::UnknownIssuer));
        };
        // 1. Route by the unverified `iss`.
        let payload = decode_object(payload_part);
        let issuer = payload
            .as_ref()
            .and_then(|payload| payload.get("iss"))
            .and_then(Value::as_str)
            .and_then(|iss| self.issuers.iter().find(|issuer| issuer.issuer == iss))
            .ok_or_else(|| AuthRefusal::new(RuleCode::UnknownIssuer))?;
        let refuse = |rule: RuleCode| AuthRefusal::new(rule).with_issuer(issuer.alias.clone());
        let payload = payload.expect("the issuer was found in it");
        // 2. Header.
        let header = decode_object(header_part).ok_or_else(|| refuse(RuleCode::Typ))?;
        let header = Value::Object(header);
        let names: Vec<&str> = issuer.algorithms.iter().map(|a| a.as_str()).collect();
        check_jws_header(&header, &names).map_err(refuse)?;
        let alg = header["alg"].as_str().and_then(SigningAlgorithm::named);
        let kid = header["kid"].as_str().unwrap_or_default();
        let Some(alg) = alg else {
            return Err(refuse(RuleCode::Alg));
        };
        // 3. Key.
        let jwk = match issuer.keys.key(&issuer.issuer, kid).await {
            Ok(jwk) => jwk,
            Err(KeyError::Unknown) => return Err(refuse(RuleCode::Key)),
            Err(KeyError::Unavailable) => return Err(refuse(RuleCode::Unavailable)),
        };
        let members = Value::Object(jwk.0);
        check_key_fit(&header, Some(&members)).map_err(refuse)?;
        let key = decoding_key(alg, &members).ok_or_else(|| refuse(RuleCode::Key))?;
        // 4. Signature.
        let signature = URL_SAFE_NO_PAD
            .decode(signature_part)
            .map_err(|_| refuse(RuleCode::Signature))?;
        let message = &token[..header_part.len() + 1 + payload_part.len()];
        let verifier =
            (jsonwebtoken::crypto::aws_lc::DEFAULT_PROVIDER.verifier_factory)(&alg.backend(), &key)
                .map_err(|_| refuse(RuleCode::Key))?;
        if verifier.verify(message.as_bytes(), &signature).is_err() {
            return Err(refuse(RuleCode::Signature));
        }
        // 5 to 10. Claims.
        let now = self.clock.now().div_euclid(1000);
        check_claims(&payload, &issuer.issuer, &self.rules, now, certificate).map_err(refuse)
    }
}

#[async_trait]
impl TokenVerifier for JwtVerifier {
    async fn verify(
        &self,
        token: &str,
        request: &http::request::Parts,
    ) -> Result<Credentials, AuthRefusal> {
        let certificate = request
            .extensions
            .get::<ClientCertificate>()
            .map(ClientCertificate::thumbprint);
        if compact_jws_parts(token).is_none() {
            return match &self.introspection {
                Some(introspection) => introspection.verify(token, request).await,
                None => Err(AuthRefusal::new(RuleCode::UnknownIssuer)),
            };
        }
        self.verify_token(token, certificate).await
    }

    fn rules(&self) -> Option<&TokenRules> {
        Some(&self.rules)
    }
}

/// Whether `token` has the shape of a compact JWS (three base64url parts, the first two non-empty):
/// the routing test of `spec/authorization.md` M3 rule 1.
pub fn is_compact_jws(token: &str) -> bool {
    compact_jws_parts(token).is_some()
}

fn compact_jws_parts(token: &str) -> Option<[&str; 3]> {
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
fn decode_object(part: &str) -> Option<Map<String, Value>> {
    let bytes = URL_SAFE_NO_PAD.decode(part).ok()?;
    match serde_json::from_slice::<Strict>(&bytes).ok()?.0 {
        Value::Object(members) => Some(members),
        _ => None,
    }
}

/// The verification key of a JWK that passed rule 3, or `None` when its material is unusable
/// (bad base64url, a coordinate of the wrong length, an Ed448 key).
fn decoding_key(alg: SigningAlgorithm, jwk: &Value) -> Option<DecodingKey> {
    let member = |name: &str| {
        jwk.get(name)
            .and_then(Value::as_str)
            .and_then(|text| URL_SAFE_NO_PAD.decode(text).ok())
            .filter(|bytes| !bytes.is_empty())
    };
    match alg {
        SigningAlgorithm::RS256
        | SigningAlgorithm::RS384
        | SigningAlgorithm::RS512
        | SigningAlgorithm::PS256
        | SigningAlgorithm::PS384
        | SigningAlgorithm::PS512 => Some(DecodingKey::from_rsa_raw_components(
            &member("n")?,
            &member("e")?,
        )),
        SigningAlgorithm::ES256 | SigningAlgorithm::ES384 => {
            let size = if alg == SigningAlgorithm::ES256 {
                32
            } else {
                48
            };
            let (x, y) = (member("x")?, member("y")?);
            if x.len() != size || y.len() != size {
                return None;
            }
            let mut point = Vec::with_capacity(1 + 2 * size);
            point.push(0x04);
            point.extend_from_slice(&x);
            point.extend_from_slice(&y);
            Some(DecodingKey::from_ec_der(&point))
        }
        SigningAlgorithm::EdDSA => {
            if jwk.get("crv").and_then(Value::as_str) != Some("Ed25519") {
                return None;
            }
            let x = member("x")?;
            (x.len() == 32).then(|| DecodingKey::from_ed_der(&x))
        }
    }
}

/// A JSON value whose objects, at every depth, have unique member names (RFC 7515 4 and RFC 7519
/// 4: a JOSE header or claims set with a repeated name is refused, never read as its last value).
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
    use super::*;

    #[test]
    fn jws_shape() {
        assert!(is_compact_jws("a.b.c"));
        assert!(is_compact_jws("a.b."));
        for bad in ["a.b", "a.b.c.d", ".b.c", "a..c", "a+.b.c", "a.b.c=", "abc"] {
            assert!(!is_compact_jws(bad), "{bad}");
        }
    }

    #[test]
    fn repeated_members_are_refused() {
        let encode = |text: &str| URL_SAFE_NO_PAD.encode(text);
        assert!(decode_object(&encode(r#"{"a":1,"b":{"c":2}}"#)).is_some());
        assert!(decode_object(&encode(r#"{"a":1,"a":2}"#)).is_none());
        assert!(decode_object(&encode(r#"{"a":{"c":1,"c":2}}"#)).is_none());
        assert!(decode_object(&encode(r#"[{"a":1}]"#)).is_none());
        assert!(decode_object(&format!("{}=", encode("{}"))).is_none());
    }
}
