//! The one seam between a record's clear rows and its sealed parts (phase 3 section 5.4).
//!
//! Every `sealed` column is written by [`Seal::seal`] and read by [`Seal::open`], and nothing else
//! touches those bytes. Step 3a stores them **unsealed**: a blob is the byte [`UNSEALED`], the
//! associated data's length and bytes, then the plaintext. [`Seal::open`] still refuses a blob
//! whose associated data is not this record's, part and version, so a moved blob answers
//! `SealInvalid` as it will under the cipher. Step 3b replaces the body of these two functions
//! with XChaCha20-Poly1305 under the record's own key (seal version `0x01`), and removes the
//! unsealed form.

use umbel_store::StoreError;

/// The seal version of a blob stored in clear (step 3a only).
pub(crate) const UNSEALED: u8 = 0x00;

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
    fn associated_data(&self) -> Vec<u8> {
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

    /// Seal `plain` for this record part.
    pub(crate) fn seal(&self, plain: &[u8]) -> Vec<u8> {
        let aad = self.associated_data();
        let len = u32::try_from(aad.len()).unwrap_or(u32::MAX);
        let mut blob = Vec::with_capacity(1 + 4 + aad.len() + plain.len());
        blob.push(UNSEALED);
        blob.extend_from_slice(&len.to_be_bytes());
        blob.extend_from_slice(&aad);
        blob.extend_from_slice(plain);
        blob
    }

    /// Open a blob sealed for this record part.
    ///
    /// # Errors
    /// [`StoreError::SealInvalid`] when the blob is not one, or is bound to another record,
    /// owner, space, part or version.
    pub(crate) fn open(&self, blob: &[u8]) -> Result<Vec<u8>, StoreError> {
        let invalid = || StoreError::SealInvalid {
            id: self.id.to_owned(),
        };
        let (&version, rest) = blob.split_first().ok_or_else(invalid)?;
        if version != UNSEALED || rest.len() < 4 {
            return Err(invalid());
        }
        let (len, rest) = rest.split_at(4);
        let len = u32::from_be_bytes([len[0], len[1], len[2], len[3]]) as usize;
        if rest.len() < len || rest[..len] != self.associated_data()[..] {
            return Err(invalid());
        }
        Ok(rest[len..].to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_blob_opens_only_for_its_own_binding() {
        let seal = Seal {
            space: "main",
            id: "mem-000000000000000000000001",
            owner: "human:ada",
            part: Part::Version(2),
        };
        let blob = seal.seal(b"words");
        assert_eq!(seal.open(&blob).ok().as_deref(), Some(&b"words"[..]));
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
            assert!(other.open(&blob).is_err(), "{other:?}");
        }
        assert!(seal.open(&[]).is_err());
        assert!(seal.open(&[1, 2, 3]).is_err());
    }
}
