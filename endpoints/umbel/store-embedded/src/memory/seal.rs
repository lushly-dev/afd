//! The one seam between a record's clear rows and its sealed parts (phase 3 section 5.4, D82).
//!
//! Every `sealed` column is written by [`Seal::seal`] and read by [`Seal::open`], and nothing else
//! touches those bytes. A blob is the seal version [`SEALED`], a 24-byte nonce drawn from the
//! operating system for this seal alone, then XChaCha20-Poly1305's ciphertext and tag under the
//! record's own 32-byte key. The associated data binds the space, record, owner, part and record
//! version, so a blob moved to another of them does not open. Keys never leave this crate: they
//! are drawn here, held in [`RecordKey`], which overwrites itself when dropped, and kept in the key
//! file (`keys.rs`).

use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce, aead::Aead, aead::Payload};
use umbel_store::StoreError;

/// The seal version of a blob sealed with XChaCha20-Poly1305.
pub(crate) const SEALED: u8 = 0x01;
/// A key's length in bytes.
pub(crate) const KEY_BYTES: usize = 32;
/// A nonce's length in bytes.
const NONCE_BYTES: usize = 24;

/// One record's key. Drawn from the operating system, never from the recorded `random` grant,
/// whose values the journal's tape keeps. Overwritten with zeros when dropped; the cipher built
/// from it zeroizes its own copy (`chacha20poly1305`'s `zeroize` feature).
pub(crate) struct RecordKey([u8; KEY_BYTES]);

impl RecordKey {
    /// A new key from the operating system's random source.
    pub(crate) fn generate() -> Result<Self, StoreError> {
        let mut key = Self([0; KEY_BYTES]);
        random(&mut key.0)?;
        Ok(key)
    }

    /// A key read back from the key file; `None` for anything but 32 bytes.
    pub(crate) fn from_slice(bytes: &[u8]) -> Option<Self> {
        let mut key = Self([0; KEY_BYTES]);
        if bytes.len() != KEY_BYTES {
            return None;
        }
        key.0.copy_from_slice(bytes);
        Some(key)
    }

    /// The key's bytes, to store.
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.0
    }

    fn cipher(&self) -> Result<XChaCha20Poly1305, StoreError> {
        XChaCha20Poly1305::new_from_slice(&self.0)
            .map_err(|_| StoreError::Corrupt("a memory key has the wrong length".to_owned()))
    }
}

impl Drop for RecordKey {
    fn drop(&mut self) {
        self.0.fill(0);
        // Keep the overwrite: the buffer is read after it, so it is not a dead store.
        std::hint::black_box(&mut self.0);
    }
}

/// Fill `bytes` from the operating system's random source (`getrandom`, as `chacha20poly1305`
/// brings it): record keys, nonces and the store id.
pub(crate) fn random(bytes: &mut [u8]) -> Result<(), StoreError> {
    chacha20poly1305::aead::common::getrandom::fill(bytes)
        .map_err(|e| StoreError::Io(format!("the operating system's random source: {e}")))
}

/// Which part of a record a blob holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Part {
    /// `records.sealed`: subject, text, tags and content hash.
    Body,
    /// `versions.sealed` of this record version.
    Version(u32),
}

/// What a blob is bound to: its space, record, owner, part and version.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Seal<'a> {
    pub(crate) space: &'a str,
    pub(crate) id: &'a str,
    pub(crate) owner: &'a str,
    pub(crate) part: Part,
}

impl Seal<'_> {
    /// The associated data of section 5.4: the canonical JSON array
    /// `["umbel-memory-seal/1", space, id, owner, part, recordVersion]`, `part` being `body`
    /// (version 0) or `version`.
    pub(crate) fn associated_data(&self) -> Vec<u8> {
        let (part, version) = match self.part {
            Part::Body => ("body", 0),
            Part::Version(n) => ("version", n),
        };
        serde_json::json!([
            "umbel-memory-seal/1",
            self.space,
            self.id,
            self.owner,
            part,
            version
        ])
        .to_string()
        .into_bytes()
    }

    /// Seal `plain` for this record part under `key`, with a fresh nonce.
    ///
    /// # Errors
    /// `Io` when the random source fails; `Invalid` past the cipher's length limit.
    pub(crate) fn seal(&self, key: &RecordKey, plain: &[u8]) -> Result<Vec<u8>, StoreError> {
        let mut nonce = [0; NONCE_BYTES];
        random(&mut nonce)?;
        let aad = self.associated_data();
        let sealed = key
            .cipher()?
            .encrypt(
                &XNonce::from(nonce),
                Payload {
                    msg: plain,
                    aad: &aad,
                },
            )
            .map_err(|_| StoreError::invalid("a memory record is too large to seal"))?;
        let mut blob = Vec::with_capacity(1 + NONCE_BYTES + sealed.len());
        blob.push(SEALED);
        blob.extend_from_slice(&nonce);
        blob.extend_from_slice(&sealed);
        Ok(blob)
    }

    /// Open a blob sealed for this record part under `key`.
    ///
    /// # Errors
    /// [`StoreError::SealInvalid`] when the blob is not one, was sealed under another key, is
    /// bound to another record, owner, space, part or version, or was altered.
    pub(crate) fn open(&self, key: &RecordKey, blob: &[u8]) -> Result<Vec<u8>, StoreError> {
        let invalid = || StoreError::SealInvalid {
            id: self.id.to_owned(),
        };
        let (&version, rest) = blob.split_first().ok_or_else(invalid)?;
        if version != SEALED || rest.len() < NONCE_BYTES {
            return Err(invalid());
        }
        let (nonce, sealed) = rest.split_at(NONCE_BYTES);
        let nonce = <&XNonce>::try_from(nonce).map_err(|_| invalid())?;
        let aad = self.associated_data();
        key.cipher()?
            .decrypt(
                nonce,
                Payload {
                    msg: sealed,
                    aad: &aad,
                },
            )
            .map_err(|_| invalid())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used)]

    use super::*;

    #[test]
    fn a_blob_opens_only_for_its_own_binding_and_key() {
        let seal = Seal {
            space: "main",
            id: "mem-000000000000000000000001",
            owner: "human:ada",
            part: Part::Version(2),
        };
        let key = RecordKey::generate().expect("a key");
        let blob = seal.seal(&key, b"words").expect("sealed");
        assert_eq!(blob[0], SEALED);
        assert_eq!(blob.len(), 1 + NONCE_BYTES + 5 + 16);
        assert!(!blob.windows(5).any(|w| w == b"words"), "no plaintext");
        assert_eq!(seal.open(&key, &blob).ok().as_deref(), Some(&b"words"[..]));
        for other in [
            Seal {
                id: "mem-000000000000000000000002",
                ..seal
            },
            Seal {
                owner: "human:bo",
                ..seal
            },
            Seal {
                space: "beta",
                ..seal
            },
            Seal {
                part: Part::Body,
                ..seal
            },
            Seal {
                part: Part::Version(3),
                ..seal
            },
        ] {
            assert!(other.open(&key, &blob).is_err(), "{other:?}");
        }
        let other_key = RecordKey::generate().expect("a key");
        assert!(seal.open(&other_key, &blob).is_err(), "another key");
        assert!(seal.open(&key, &[]).is_err());
        assert!(seal.open(&key, &[1, 2, 3]).is_err());
        let mut flipped = blob.clone();
        let last = flipped.len() - 1;
        flipped[last] ^= 1;
        assert!(seal.open(&key, &flipped).is_err(), "a flipped bit");
        // The 3a form, stored in clear, is gone.
        let mut clear = vec![0x00];
        clear.extend_from_slice(b"words");
        assert!(seal.open(&key, &clear).is_err(), "no unsealed form");
    }

    #[test]
    fn nonces_differ_per_seal() {
        let seal = Seal {
            space: "main",
            id: "mem-1",
            owner: "human:ada",
            part: Part::Body,
        };
        let key = RecordKey::generate().expect("a key");
        let a = seal.seal(&key, b"same").expect("sealed");
        let b = seal.seal(&key, b"same").expect("sealed");
        assert_ne!(a[1..1 + NONCE_BYTES], b[1..1 + NONCE_BYTES]);
        assert_ne!(a, b);
    }
}
