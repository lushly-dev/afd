//! Canonical JSON as JavaScript writes it: object keys sorted at every depth (by UTF-16 code
//! units, as JavaScript sorts), no whitespace, strings escaped and numbers written as
//! `JSON.stringify` writes them (`1.0` is `1`, `1e21` is `1e+21`, `-0` is `0`).
//!
//! The approval token's input binding (the `approval` feature), the relay input digest
//! ([`input_digest`]) and the journal's cap on a context field's value (`spec/journal.md`,
//! "Declared context fields") all use it, so they agree with TypeScript byte for byte.

use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};

/// Largest integer every JSON number reader holds exactly (`Number.MAX_SAFE_INTEGER`).
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// What to do with an integer that a 64-bit float cannot hold exactly, such as 2^53 + 1, which
/// JavaScript reads as 2^53.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Integers {
    /// Refuse it, so that two distinct integers never share one spelling.
    Exact,
    /// Write the float nearest to it, as JavaScript writes the number it reads.
    Nearest,
}

/// Why [`exact`] refused a value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Inexact {
    /// A number beyond 64 bits (only with serde_json's `arbitrary_precision`).
    BeyondSixtyFourBits,
    /// An integer beyond 2^53 that a 64-bit float cannot hold exactly.
    UnsafeInteger,
}

/// The canonical JSON of `value`, or why it holds a number JavaScript would read as another.
pub(crate) fn exact(value: &Value) -> Result<String, Inexact> {
    let mut out = String::new();
    encode(value, Integers::Exact, &mut out)?;
    Ok(out)
}

/// The canonical JSON of `value` as JavaScript would write it after reading it: an integer that
/// a 64-bit float cannot hold exactly is written as the nearest float (`99999999999999999` is
/// `100000000000000000`).
pub(crate) fn nearest(value: &Value) -> String {
    let mut out = String::new();
    encode(value, Integers::Nearest, &mut out).expect("nearest floats are always written");
    out
}

/// The digest of a validated input that a person decides on (`spec/command-metadata.md`,
/// "Host-verified confirmation", step 2): the unpadded base64url SHA-256 of the input's canonical
/// JSON (the approval tokens' canonical JSON, "Approvals", rule 3). The server computes it from
/// the input validated against the command's schema, defaults applied, and gives it to the
/// [`HumanRelay`](crate::server::HumanRelay) as `RelayCall::input_digest`; the approval middleware
/// compares relay evidence against the same digest of the input it holds. `spec/authorization.json`
/// (`inputDigests`) pins it.
///
/// # Errors
/// The input holds an integer that a 64-bit float cannot hold exactly (beyond ±2^53), which
/// JavaScript would read as another number, so two inputs could share a digest.
pub fn input_digest(input: &Value) -> Result<String, String> {
    let canonical = exact(input).map_err(|inexact| match inexact {
        Inexact::BeyondSixtyFourBits => "Cannot digest an input holding a number beyond 64 bits",
        Inexact::UnsafeInteger => {
            "Cannot digest an input holding an integer that a 64-bit float cannot hold exactly"
        }
    })?;
    Ok(base64url_encode(&Sha256::digest(canonical.as_bytes())))
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
#[cfg_attr(not(feature = "approval"), allow(dead_code))]
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

/// ECMAScript `Number::toString` of a finite float (as `JSON.stringify` writes it): the shortest
/// digits that round-trip, ties to even, in fixed notation for decimal exponents from -7 to 20
/// and scientific notation otherwise.
pub(crate) fn js_number(value: f64) -> String {
    ryu_js::Buffer::new().format(value).to_owned()
}

fn encode(value: &Value, integers: Integers, out: &mut String) -> Result<(), Inexact> {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        Value::Number(number) => out.push_str(&number_json(number, integers)?),
        Value::String(text) => out.push_str(&string_json(text)),
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                encode(item, integers, out)?;
            }
            out.push(']');
        }
        Value::Object(map) => encode_object(map, integers, out)?,
    }
    Ok(())
}

fn encode_object(
    map: &Map<String, Value>,
    integers: Integers,
    out: &mut String,
) -> Result<(), Inexact> {
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    out.push('{');
    for (index, key) in keys.into_iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push_str(&string_json(key));
        out.push(':');
        encode(&map[key], integers, out)?;
    }
    out.push('}');
    Ok(())
}

/// `JSON.stringify` of a string. serde_json escapes the same characters the same way (`\"`,
/// `\\`, `\b`, `\f`, `\n`, `\r`, `\t`, other controls as lowercase `\u00xx`).
fn string_json(text: &str) -> String {
    serde_json::to_string(text).expect("strings serialize")
}

fn number_json(number: &Number, integers: Integers) -> Result<String, Inexact> {
    if number.is_f64() {
        // serde_json holds only finite floats.
        return Ok(js_number(number.as_f64().unwrap_or_default()));
    }
    let Some(integer) = number
        .as_i64()
        .map(i128::from)
        .or_else(|| number.as_u64().map(i128::from))
    else {
        return match integers {
            Integers::Exact => Err(Inexact::BeyondSixtyFourBits),
            // JavaScript reads it as the nearest float, or as Infinity, which it writes as null.
            Integers::Nearest => Ok(number
                .as_f64()
                .filter(|float| float.is_finite())
                .map_or_else(|| "null".to_owned(), js_number)),
        };
    };
    if integer.unsigned_abs() <= u128::from(MAX_SAFE_INTEGER) {
        return Ok(integer.to_string());
    }
    let float = integer as f64;
    if integers == Integers::Nearest || float as i128 == integer {
        Ok(js_number(float))
    } else {
        Err(Inexact::UnsafeInteger)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn writes_numbers_as_javascript_does() {
        let value: Value =
            serde_json::from_str("[1.0, -0, -0.0, 1e21, 1e20, 0.000001, 1e-7, 0.1]").unwrap();
        let expected = "[1,0,0,1e+21,100000000000000000000,0.000001,1e-7,0.1]";
        assert_eq!(nearest(&value), expected);
        assert_eq!(exact(&value).unwrap(), expected);
    }

    #[test]
    fn writes_or_refuses_an_integer_a_float_cannot_hold() {
        for (integer, nearest_float) in [
            (json!(99_999_999_999_999_999_u64), "100000000000000000"),
            (json!(-99_999_999_999_999_999_i64), "-100000000000000000"),
            (json!(9_007_199_254_740_993_u64), "9007199254740992"),
            (json!(u64::MAX), "18446744073709552000"),
        ] {
            assert_eq!(nearest(&integer), nearest_float);
            assert_eq!(exact(&integer), Err(Inexact::UnsafeInteger));
        }
        // An integer the float holds exactly is written as JavaScript writes that float.
        assert_eq!(exact(&json!(1_u64 << 60)).unwrap(), "1152921504606847000");
        assert_eq!(nearest(&json!(1_u64 << 60)), "1152921504606847000");
    }

    #[test]
    fn sorts_keys_by_utf16_code_units_and_escapes_as_javascript_does() {
        let value = json!({ "\u{1F600}": 1, "\u{FFFF}": 2, "b": "\u{1}\n\"\u{7f}\u{2028}" });
        assert_eq!(
            nearest(&value),
            "{\"b\":\"\\u0001\\n\\\"\u{7f}\u{2028}\",\"\u{1F600}\":1,\"\u{FFFF}\":2}"
        );
    }
}
