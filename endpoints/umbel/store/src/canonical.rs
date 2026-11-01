//! Canonical JSON, SHA-256 content hashes and the standard base64 alphabet.

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::{Result, StoreError};

/// `sha256:<64 lowercase hex>` of some bytes: a document's file bytes, a record's canonical JSON.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ContentHash(String);

impl ContentHash {
    /// The hash of `bytes`.
    #[must_use]
    pub fn of(bytes: &[u8]) -> Self {
        let digest = Sha256::digest(bytes);
        let mut text = String::with_capacity(7 + 64);
        text.push_str("sha256:");
        for byte in digest {
            text.push(char::from_digit(u32::from(byte >> 4), 16).unwrap_or('0'));
            text.push(char::from_digit(u32::from(byte & 15), 16).unwrap_or('0'));
        }
        Self(text)
    }

    /// Parse `sha256:<64 lowercase hex>`.
    ///
    /// # Errors
    /// [`StoreError::Invalid`] when the text is not in that form.
    pub fn parse(text: &str) -> Result<Self> {
        let valid = text.strip_prefix("sha256:").is_some_and(|hex| {
            hex.len() == 64 && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        });
        if valid {
            Ok(Self(text.to_owned()))
        } else {
            Err(StoreError::invalid(format!(
                "`{text}` is not sha256:<64 lowercase hex>"
            )))
        }
    }

    /// The text form.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ContentHash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Serialize for ContentHash {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for ContentHash {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        Self::parse(&text).map_err(serde::de::Error::custom)
    }
}

/// JSON with object keys sorted at every depth and no whitespace: the form a record's content
/// hash is taken over, independent of how `serde_json` orders maps.
#[must_use]
pub fn canonical_json(value: &Value) -> String {
    let mut out = String::new();
    write_canonical(value, &mut out);
    out
}

fn write_canonical(value: &Value, out: &mut String) {
    match value {
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(key.clone()).to_string());
                out.push(':');
                if let Some(item) = map.get(key) {
                    write_canonical(item, out);
                }
            }
            out.push('}');
        }
        scalar => out.push_str(&scalar.to_string()),
    }
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 with padding, the encoding of `document.v1.json`'s `bytes`.
#[must_use]
pub fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for shift in [18, 12, 6, 0].iter().take(chunk.len() + 1) {
            out.push(char::from(ALPHABET[((n >> shift) & 63) as usize]));
        }
        for _ in chunk.len()..3 {
            out.push('=');
        }
    }
    out
}

/// Decode standard base64 with padding.
///
/// # Errors
/// [`StoreError::Invalid`] on a character outside the alphabet or a bad length.
pub fn base64_decode(text: &str) -> Result<Vec<u8>> {
    let bytes = text.as_bytes();
    if bytes.len() % 4 != 0 {
        return Err(StoreError::invalid("base64 text must be a multiple of 4 long"));
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for (index, quad) in bytes.chunks(4).enumerate() {
        let last = (index + 1) * 4 == bytes.len();
        let padding = quad.iter().rev().take_while(|&&b| b == b'=').count();
        if padding > 2 || (padding > 0 && !last) {
            return Err(StoreError::invalid("base64 padding is misplaced"));
        }
        let mut n = 0u32;
        for &c in &quad[..4 - padding] {
            let value = ALPHABET
                .iter()
                .position(|&a| a == c)
                .ok_or_else(|| StoreError::invalid("base64 text has a character outside the alphabet"))?;
            n = (n << 6) | value as u32;
        }
        n <<= 6 * padding as u32;
        let produced = 3 - padding;
        for shift in [16, 8, 0].iter().take(produced) {
            out.push(((n >> shift) & 255) as u8);
        }
    }
    Ok(out)
}

/// Serde adapter: a byte vector as base64 text.
pub(crate) mod base64_bytes {
    use serde::{Deserialize, Deserializer, Serializer};

    pub(crate) fn serialize<S: Serializer>(
        bytes: &[u8],
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&super::base64_encode(bytes))
    }

    pub(crate) fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Vec<u8>, D::Error> {
        let text = String::deserialize(deserializer)?;
        super::base64_decode(&text).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trips_every_length() {
        for length in 0..40usize {
            let bytes: Vec<u8> = (0..length).map(|i| (i * 37 + 11) as u8).collect();
            assert_eq!(base64_decode(&base64_encode(&bytes)).unwrap(), bytes);
        }
        assert_eq!(base64_encode(b"Man"), "TWFu");
        assert_eq!(base64_encode(b"Ma"), "TWE=");
        assert_eq!(base64_encode(b"M"), "TQ==");
        assert!(base64_decode("TQ=").is_err());
        assert!(base64_decode("T!==").is_err());
    }

    #[test]
    fn content_hash_is_sha256_of_the_bytes() {
        assert_eq!(
            ContentHash::of(b"abc").as_str(),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert!(ContentHash::parse("sha256:ABC").is_err());
        assert!(ContentHash::parse(ContentHash::of(b"x").as_str()).is_ok());
    }

    #[test]
    fn canonical_json_sorts_keys_at_every_depth() {
        let value: Value = serde_json::from_str(r#"{"b":[{"z":1,"a":2}],"a":"x"}"#).unwrap();
        assert_eq!(canonical_json(&value), r#"{"a":"x","b":[{"a":2,"z":1}]}"#);
    }
}
