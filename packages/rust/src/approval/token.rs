//! The approval token's building blocks: canonical JSON, base64url, HMAC-SHA256 and
//! constant-time comparison. Every byte here matches TypeScript's `approval.ts`, so a token
//! issued by one implementation verifies on another.

use hmac::{Hmac, KeyInit, Mac};
use serde_json::Value;
use sha2::Sha256;
use subtle::ConstantTimeEq;

use crate::actor::Actor;
use crate::canonical::{self, Inexact};
pub(crate) use crate::canonical::{base64url_decode, base64url_encode};

/// Stable JSON for binding a token to an input: object keys sorted at every depth (by UTF-16
/// code units, as JavaScript sorts), strings escaped and numbers written as JavaScript's
/// `JSON.stringify` writes them (`1.0` is `1`, `1e21` is `1e+21`).
///
/// It fails closed rather than collide: an integer beyond 2^53 that a 64-bit float cannot hold
/// exactly is refused, since TypeScript would read it as a neighbouring value.
///
/// # Errors
/// The value holds an integer that a 64-bit float cannot represent exactly.
pub fn canonical_json(value: &Value) -> Result<String, String> {
    canonical::exact(value).map_err(|inexact| match inexact {
        Inexact::BeyondSixtyFourBits => "Cannot bind an approval to a number beyond 64 bits".into(),
        Inexact::UnsafeInteger => {
            "Cannot bind an approval to an integer that a 64-bit float cannot hold exactly".into()
        }
    })
}

/// The actor fields a token is bound to. `label` is display text, so it is left out.
pub(crate) fn actor_json(actor: Option<&Actor>) -> String {
    crate::credentials::actor_binding_json(actor)
}

pub(crate) fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC takes keys of any length");
    mac.update(data);
    mac.finalize().into_bytes().into()
}

/// A keyed digest; `purpose` keeps an input digest from ever matching an actor digest.
pub(crate) fn digest(key: &[u8], purpose: &str, value: &str) -> [u8; 32] {
    hmac_sha256(key, format!("{purpose}\0{value}").as_bytes())
}

/// Constant-time equality. Lengths are not secret (every digest here is 32 bytes).
pub(crate) fn safe_equal(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && bool::from(a.ct_eq(b))
}
