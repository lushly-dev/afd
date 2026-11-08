//! The gateway signer of the gateway-trusted mode (phase 5 specification, section 4.4): it signs
//! one `Umbel-Gateway-Assertion` per request, with keys a deployer pins in a file, and connects
//! with a client certificate the deployer pins by its SHA-256.

use std::fmt;
use std::sync::Arc;

use serde_json::{Map, Value, json};

use crate::ca::IssuedCertificate;
use crate::keys::KeySet;
use crate::token::{TokenBuilder, TokenKind};
use crate::{now, random_token};

/// The gateway signer. It serves nothing: Umbel reads its keys from the pinned file
/// ([`Self::jwks`]) and the assertion from the request header.
pub struct GatewaySigner {
    issuer: String,
    keys: Arc<KeySet>,
    certificate: IssuedCertificate,
}

impl fmt::Debug for GatewaySigner {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GatewaySigner")
            .field("issuer", &self.issuer)
            .finish_non_exhaustive()
    }
}

impl GatewaySigner {
    pub(crate) fn new(issuer: String, keys: Arc<KeySet>, certificate: IssuedCertificate) -> Self {
        Self {
            issuer,
            keys,
            certificate,
        }
    }

    /// The gateway's issuer (`[auth.gateway].issuer`): `<base>/gateway`.
    pub fn issuer(&self) -> &str {
        &self.issuer
    }

    /// Its keys, to rotate or retire.
    pub fn keys(&self) -> &KeySet {
        &self.keys
    }

    /// The key set to write to the pinned `keys` file.
    pub fn jwks(&self) -> Value {
        self.keys.jwks()
    }

    /// The gateway's client certificate, issued by the kit's CA (`clientAuth`); pin it with
    /// [`IssuedCertificate::sha256_hex`].
    pub fn certificate(&self) -> &IssuedCertificate {
        &self.certificate
    }

    /// An assertion for one request with `method` to `public_url`: header `typ` `umbel-gw+jwt`,
    /// `alg` `ES256` and the `kid`; claims `iss`, `aud` and `htu` equal to `public_url`, `htm`,
    /// `iat` now, `exp` 60 seconds later, a `jti` of 128 random bits, `sub` `ada`, `client`
    /// `gateway-client` and `scope` `umbel:read`.
    pub fn assertion(&self, public_url: &str, method: &str) -> TokenBuilder {
        let now = now();
        let mut claims = Map::new();
        claims.insert("iss".into(), json!(self.issuer));
        claims.insert("aud".into(), json!(public_url));
        claims.insert("htm".into(), json!(method));
        claims.insert("htu".into(), json!(public_url));
        claims.insert("sub".into(), json!("ada"));
        claims.insert("client".into(), json!("gateway-client"));
        claims.insert("scope".into(), json!("umbel:read"));
        claims.insert("jti".into(), json!(random_token(16)));
        claims.insert("iat".into(), json!(now));
        claims.insert("exp".into(), json!(now + 60));
        TokenBuilder::new(
            TokenKind::GatewayAssertion,
            Arc::clone(&self.keys),
            None,
            claims,
        )
    }
}
