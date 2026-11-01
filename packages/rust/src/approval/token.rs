//! The approval token's building blocks: canonical JSON, base64url, HMAC-SHA256 and
//! constant-time comparison. Every byte here matches TypeScript's `approval.ts`, so a token
//! issued by one implementation verifies on another.

use hmac::{Hmac, Mac};
use serde_json::{Map, Value};
use sha2::Sha256;
use subtle::ConstantTimeEq;

use crate::actor::Actor;
use crate::canonical::{self, Inexact};

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
    let Some(actor) = actor else {
        return "null".to_owned();
    };
    let mut fields = Map::new();
    fields.insert(
        "kind".to_owned(),
        serde_json::to_value(actor.kind).expect("actor kinds serialize"),
    );
    if let Some(id) = &actor.id {
        fields.insert("id".to_owned(), Value::String(id.clone()));
    }
    if let Some(on_behalf_of) = &actor.on_behalf_of {
        fields.insert("onBehalfOf".to_owned(), Value::String(on_behalf_of.clone()));
    }
    canonical_json(&Value::Object(fields)).expect("actor fields are strings")
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

const BASE64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Unpadded base64url, as Node's `toString('base64url')` writes it.
pub(crate) fn base64url_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let triple = chunk.iter().enumerate().fold(0u32, |acc, (index, byte)| {
            acc | u32::from(*byte) << (16 - 8 * index)
        });
        for index in 0..=chunk.len() {
            out.push(BASE64URL[(triple >> (18 - 6 * index) & 63) as usize] as char);
        }
    }
    out
}

/// Strict unpadded base64url: `None` for any other character, a dangling character, or
/// non-zero padding bits, so every byte string has exactly one accepted spelling.
pub(crate) fn base64url_decode(text: &str) -> Option<Vec<u8>> {
    let sextet = |byte: u8| {
        BASE64URL
            .iter()
            .position(|&c| c == byte)
            .map(|at| at as u32)
    };
    let bytes = text.as_bytes();
    if bytes.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3 + 2);
    for chunk in bytes.chunks(4) {
        let mut bits = 0u32;
        for (index, byte) in chunk.iter().enumerate() {
            bits |= sextet(*byte)? << (18 - 6 * index);
        }
        let produced = chunk.len() - 1;
        for index in 0..produced {
            out.push((bits >> (16 - 8 * index)) as u8);
        }
        if bits & (0x00ff_ffff >> (8 * produced)) != 0 {
            return None;
        }
    }
    Some(out)
}
