//! Signing keys: generated in memory on start, published as a JWKS, rotated and retired on demand.

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex};

use aws_lc_rs::rand::SystemRandom;
use aws_lc_rs::rsa::KeySize;
use aws_lc_rs::signature::{
    ECDSA_P256_SHA256_FIXED_SIGNING, ECDSA_P384_SHA384_FIXED_SIGNING, EcdsaKeyPair, Ed25519KeyPair,
    KeyPair, RSA_PKCS1_SHA256, RSA_PKCS1_SHA384, RSA_PKCS1_SHA512, RSA_PSS_SHA256, RSA_PSS_SHA384,
    RSA_PSS_SHA512, RsaEncoding, RsaKeyPair, RsaPublicKeyComponents,
};
use serde_json::{Value, json};

use crate::{Error, b64, lock};

/// A JWS algorithm the kit signs with: the set AFD's `JwtVerifier` checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Algorithm {
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

impl Algorithm {
    /// Every algorithm.
    pub const ALL: [Algorithm; 9] = [
        Self::RS256,
        Self::RS384,
        Self::RS512,
        Self::PS256,
        Self::PS384,
        Self::PS512,
        Self::ES256,
        Self::ES384,
        Self::EdDSA,
    ];

    /// The JWS `alg` name.
    pub fn name(self) -> &'static str {
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

    /// The algorithm named `name`.
    pub fn named(name: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|algorithm| algorithm.name() == name)
    }

    /// The kind of key that signs with it.
    pub fn key_kind(self) -> KeyKind {
        match self {
            Self::RS256 | Self::RS384 | Self::RS512 | Self::PS256 | Self::PS384 | Self::PS512 => {
                KeyKind::Rsa
            }
            Self::ES256 => KeyKind::P256,
            Self::ES384 => KeyKind::P384,
            Self::EdDSA => KeyKind::Ed25519,
        }
    }

    pub(crate) fn backend(self) -> jsonwebtoken::Algorithm {
        match self {
            Self::RS256 => jsonwebtoken::Algorithm::RS256,
            Self::RS384 => jsonwebtoken::Algorithm::RS384,
            Self::RS512 => jsonwebtoken::Algorithm::RS512,
            Self::PS256 => jsonwebtoken::Algorithm::PS256,
            Self::PS384 => jsonwebtoken::Algorithm::PS384,
            Self::PS512 => jsonwebtoken::Algorithm::PS512,
            Self::ES256 => jsonwebtoken::Algorithm::ES256,
            Self::ES384 => jsonwebtoken::Algorithm::ES384,
            Self::EdDSA => jsonwebtoken::Algorithm::EdDSA,
        }
    }
}

impl fmt::Display for Algorithm {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

/// A kind of signing key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum KeyKind {
    /// RSA, 2048 bits (`kty` `RSA`).
    Rsa,
    /// EC on P-256 (`kty` `EC`, `crv` `P-256`).
    P256,
    /// EC on P-384 (`kty` `EC`, `crv` `P-384`).
    P384,
    /// Ed25519 (`kty` `OKP`, `crv` `Ed25519`).
    Ed25519,
}

impl KeyKind {
    /// Every kind.
    pub const ALL: [KeyKind; 4] = [Self::Rsa, Self::P256, Self::P384, Self::Ed25519];

    fn slug(self) -> &'static str {
        match self {
            Self::Rsa => "rsa",
            Self::P256 => "p256",
            Self::P384 => "p384",
            Self::Ed25519 => "ed25519",
        }
    }
}

enum Pair {
    Rsa(RsaKeyPair),
    Ec(EcdsaKeyPair),
    Ed(Ed25519KeyPair),
}

/// One private key and its `kid`.
pub(crate) struct Key {
    kid: String,
    kind: KeyKind,
    pair: Pair,
}

impl Key {
    pub(crate) fn generate(kind: KeyKind, kid: String) -> Result<Self, Error> {
        let failed = |_| Error::new(format!("cannot generate a {} key", kind.slug()));
        let pair = match kind {
            KeyKind::Rsa => Pair::Rsa(RsaKeyPair::generate(KeySize::Rsa2048).map_err(failed)?),
            KeyKind::P256 => {
                Pair::Ec(EcdsaKeyPair::generate(&ECDSA_P256_SHA256_FIXED_SIGNING).map_err(failed)?)
            }
            KeyKind::P384 => {
                Pair::Ec(EcdsaKeyPair::generate(&ECDSA_P384_SHA384_FIXED_SIGNING).map_err(failed)?)
            }
            KeyKind::Ed25519 => Pair::Ed(Ed25519KeyPair::generate().map_err(failed)?),
        };
        Ok(Self { kid, kind, pair })
    }

    pub(crate) fn kid(&self) -> &str {
        &self.kid
    }

    pub(crate) fn kind(&self) -> KeyKind {
        self.kind
    }

    /// Sign `message` with `algorithm`, which must fit the key's kind.
    pub(crate) fn sign(&self, algorithm: Algorithm, message: &[u8]) -> Result<Vec<u8>, Error> {
        if algorithm.key_kind() != self.kind {
            return Err(Error::new(format!(
                "{algorithm} cannot sign with the {} key {}",
                self.kind.slug(),
                self.kid
            )));
        }
        let failed = |_| Error::new(format!("signing with {} failed", self.kid));
        let rng = SystemRandom::new();
        match &self.pair {
            Pair::Rsa(pair) => {
                let padding: &'static dyn RsaEncoding = match algorithm {
                    Algorithm::RS384 => &RSA_PKCS1_SHA384,
                    Algorithm::RS512 => &RSA_PKCS1_SHA512,
                    Algorithm::PS256 => &RSA_PSS_SHA256,
                    Algorithm::PS384 => &RSA_PSS_SHA384,
                    Algorithm::PS512 => &RSA_PSS_SHA512,
                    _ => &RSA_PKCS1_SHA256,
                };
                let mut signature = vec![0; pair.public_modulus_len()];
                pair.sign(padding, &rng, message, &mut signature)
                    .map_err(failed)?;
                Ok(signature)
            }
            Pair::Ec(pair) => Ok(pair.sign(&rng, message).map_err(failed)?.as_ref().to_vec()),
            Pair::Ed(pair) => Ok(pair.sign(message).as_ref().to_vec()),
        }
    }

    /// The public key's raw bytes: the PKCS #1 `RSAPublicKey` DER, the uncompressed EC point, or
    /// the Ed25519 public key. The `HS256` confusion case keys its HMAC with these.
    pub(crate) fn public_bytes(&self) -> Vec<u8> {
        match &self.pair {
            Pair::Rsa(pair) => pair.public_key().as_ref().to_vec(),
            Pair::Ec(pair) => pair.public_key().as_ref().to_vec(),
            Pair::Ed(pair) => pair.public_key().as_ref().to_vec(),
        }
    }

    /// The public JWK (RFC 7517, 7518, 8037), with `kid` and `use` `sig` and no `alg`, so an RSA
    /// key verifies every RSA algorithm.
    pub(crate) fn public_jwk(&self) -> Value {
        match &self.pair {
            Pair::Rsa(pair) => {
                let components = RsaPublicKeyComponents::<Vec<u8>>::from(pair.public_key());
                json!({
                    "kty": "RSA", "kid": self.kid, "use": "sig",
                    "n": b64(&components.n), "e": b64(&components.e),
                })
            }
            Pair::Ec(pair) => {
                let point = pair.public_key().as_ref();
                let size = (point.len() - 1) / 2;
                let crv = if self.kind == KeyKind::P256 {
                    "P-256"
                } else {
                    "P-384"
                };
                json!({
                    "kty": "EC", "kid": self.kid, "use": "sig", "crv": crv,
                    "x": b64(&point[1..=size]), "y": b64(&point[1 + size..]),
                })
            }
            Pair::Ed(pair) => json!({
                "kty": "OKP", "kid": self.kid, "use": "sig", "crv": "Ed25519",
                "x": b64(pair.public_key().as_ref()),
            }),
        }
    }

    /// The key for `jsonwebtoken`'s verifier.
    pub(crate) fn decoding_key(&self) -> jsonwebtoken::DecodingKey {
        match &self.pair {
            Pair::Rsa(pair) => {
                let components = RsaPublicKeyComponents::<Vec<u8>>::from(pair.public_key());
                jsonwebtoken::DecodingKey::from_rsa_raw_components(&components.n, &components.e)
            }
            Pair::Ec(pair) => jsonwebtoken::DecodingKey::from_ec_der(pair.public_key().as_ref()),
            Pair::Ed(pair) => jsonwebtoken::DecodingKey::from_ed_der(pair.public_key().as_ref()),
        }
    }
}

struct Entry {
    key: Arc<Key>,
    published: bool,
}

struct State {
    entries: Vec<Entry>,
    current: HashMap<KeyKind, String>,
    generated: u32,
    jwks_override: Option<Value>,
}

/// One role's signing keys. Each [`KeyKind`] has a current key; [`Self::rotate`] adds a new
/// current key and keeps the old one published, [`Self::retire`] stops publishing a key (it can
/// still sign, for tests of a retired `kid`), and [`Self::set_jwks_override`] serves any document
/// in place of the JWKS.
pub struct KeySet {
    prefix: String,
    state: Mutex<State>,
}

impl fmt::Debug for KeySet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("KeySet")
            .field("kids", &self.kids())
            .finish_non_exhaustive()
    }
}

impl KeySet {
    /// One published key of each kind, with `kid`s `<prefix>-<kind>-<n>`.
    pub(crate) fn generate(prefix: &str) -> Result<Self, Error> {
        let set = Self {
            prefix: prefix.to_owned(),
            state: Mutex::new(State {
                entries: Vec::new(),
                current: HashMap::new(),
                generated: 0,
                jwks_override: None,
            }),
        };
        for kind in KeyKind::ALL {
            set.rotate(kind)?;
        }
        Ok(set)
    }

    /// Generate a new key of `kind`, publish it and make it the current one for its kind; the
    /// previous key stays published until [`Self::retire`]. Returns its `kid`.
    ///
    /// # Errors
    /// The key cannot be generated.
    pub fn rotate(&self, kind: KeyKind) -> Result<String, Error> {
        let number = {
            let mut state = lock(&self.state);
            state.generated += 1;
            state.generated
        };
        let kid = format!("{}-{}-{number}", self.prefix, kind.slug());
        let key = Arc::new(Key::generate(kind, kid.clone())?);
        let mut state = lock(&self.state);
        state.entries.push(Entry {
            key,
            published: true,
        });
        state.current.insert(kind, kid.clone());
        Ok(kid)
    }

    /// Stop publishing `kid`. The key still signs when a builder names it. Returns whether the
    /// key exists.
    pub fn retire(&self, kid: &str) -> bool {
        self.set_published(kid, false)
    }

    /// Publish `kid` again. Returns whether the key exists.
    pub fn republish(&self, kid: &str) -> bool {
        self.set_published(kid, true)
    }

    fn set_published(&self, kid: &str, published: bool) -> bool {
        let mut state = lock(&self.state);
        match state.entries.iter_mut().find(|entry| entry.key.kid == kid) {
            Some(entry) => {
                entry.published = published;
                true
            }
            None => false,
        }
    }

    /// Serve `document` in place of the JWKS (`None`: the published keys again).
    pub fn set_jwks_override(&self, document: Option<Value>) {
        lock(&self.state).jwks_override = document;
    }

    /// The document the JWKS endpoint serves: the override, or [`Self::published_jwks`].
    pub fn jwks(&self) -> Value {
        if let Some(document) = &lock(&self.state).jwks_override {
            return document.clone();
        }
        self.published_jwks()
    }

    /// `{ "keys": [...] }` of every published key, in generation order.
    pub fn published_jwks(&self) -> Value {
        let state = lock(&self.state);
        let keys: Vec<Value> = state
            .entries
            .iter()
            .filter(|entry| entry.published)
            .map(|entry| entry.key.public_jwk())
            .collect();
        json!({ "keys": keys })
    }

    /// The public JWK of `kid`, published or not.
    pub fn public_jwk(&self, kid: &str) -> Option<Value> {
        self.key(kid).map(|key| key.public_jwk())
    }

    /// The current key's `kid` for `kind`.
    pub fn current_kid(&self, kind: KeyKind) -> String {
        lock(&self.state)
            .current
            .get(&kind)
            .cloned()
            .unwrap_or_default()
    }

    /// Every `kid`, published or not, in generation order.
    pub fn kids(&self) -> Vec<String> {
        lock(&self.state)
            .entries
            .iter()
            .map(|entry| entry.key.kid.clone())
            .collect()
    }

    /// Whether `kid` is published.
    pub fn is_published(&self, kid: &str) -> bool {
        lock(&self.state)
            .entries
            .iter()
            .any(|entry| entry.key.kid == kid && entry.published)
    }

    /// Any key with this `kid`.
    pub(crate) fn key(&self, kid: &str) -> Option<Arc<Key>> {
        lock(&self.state)
            .entries
            .iter()
            .find(|entry| entry.key.kid == kid)
            .map(|entry| Arc::clone(&entry.key))
    }

    /// The published key with this `kid`.
    pub(crate) fn published_key(&self, kid: &str) -> Option<Arc<Key>> {
        lock(&self.state)
            .entries
            .iter()
            .find(|entry| entry.key.kid == kid && entry.published)
            .map(|entry| Arc::clone(&entry.key))
    }

    /// The current key of `kind`.
    pub(crate) fn current(&self, kind: KeyKind) -> Option<Arc<Key>> {
        let kid = self.current_kid(kind);
        self.key(&kid)
    }
}
