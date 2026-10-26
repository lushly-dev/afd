//! The approval token's building blocks: canonical JSON, base64url, HMAC-SHA256 and
//! constant-time comparison. Every byte here matches TypeScript's `approval.ts`, so a token
//! issued by one implementation verifies on another.

use hmac::{Hmac, Mac};
use serde_json::{Map, Value};
use sha2::Sha256;
use subtle::ConstantTimeEq;

use crate::actor::Actor;

/// Largest integer every JSON number reader holds exactly (`Number.MAX_SAFE_INTEGER`).
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

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
    let mut out = String::new();
    encode(value, &mut out)?;
    Ok(out)
}

fn encode(value: &Value, out: &mut String) -> Result<(), String> {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        Value::Number(number) => out.push_str(&number_json(number)?),
        Value::String(text) => out.push_str(&string_json(text)),
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                encode(item, out)?;
            }
            out.push(']');
        }
        Value::Object(map) => encode_object(map, out)?,
    }
    Ok(())
}

fn encode_object(map: &Map<String, Value>, out: &mut String) -> Result<(), String> {
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    out.push('{');
    for (index, key) in keys.into_iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push_str(&string_json(key));
        out.push(':');
        encode(&map[key], out)?;
    }
    out.push('}');
    Ok(())
}

/// `JSON.stringify` of a string. serde_json escapes the same characters the same way (`\"`,
/// `\\`, `\b`, `\f`, `\n`, `\r`, `\t`, other controls as lowercase `\u00xx`).
fn string_json(text: &str) -> String {
    serde_json::to_string(text).expect("strings serialize")
}

fn number_json(number: &serde_json::Number) -> Result<String, String> {
    if number.is_f64() {
        // serde_json holds only finite floats.
        return Ok(js_number(number.as_f64().unwrap_or_default()));
    }
    let integer = number
        .as_i64()
        .map(i128::from)
        .or_else(|| number.as_u64().map(i128::from))
        .ok_or_else(|| {
            // Only with serde_json's `arbitrary_precision`: a number beyond 64 bits.
            "Cannot bind an approval to a number beyond 64 bits".to_owned()
        })?;
    if integer.unsigned_abs() <= u128::from(MAX_SAFE_INTEGER) {
        return Ok(integer.to_string());
    }
    let float = integer as f64;
    if float as i128 == integer {
        Ok(js_number(float))
    } else {
        Err("Cannot bind an approval to an integer that a 64-bit float cannot hold exactly".into())
    }
}

/// ECMAScript `Number::toString` of a finite float (as `JSON.stringify` writes it): the shortest
/// digits that round-trip, ties to even, in fixed notation for decimal exponents from -7 to 20
/// and scientific notation otherwise.
pub(crate) fn js_number(value: f64) -> String {
    ryu_js::Buffer::new().format(value).to_owned()
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
