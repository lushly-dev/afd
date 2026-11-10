//! Sealed positions (phase 5 section 9.3, D125).
//!
//! In a hosted mode a caller that is neither the operator nor a `process` caller (stdio) sees
//! positions only sealed: an `event-list` cursor or head as cursor version 1 (`v1.<token>`), a
//! store revision as `r1.<token>`, and an index version as locator version 2's
//! `<space>@r1.<token>/<schema>`. Each seals the last position the caller can read at or below
//! the true one, so it moves only when something the caller can read changes.
//!
//! **Sealing is deterministic** (an SIV construction): XChaCha20-Poly1305 under
//! `state/keys/cursor.key`, the 24-byte nonce the first 24 bytes of HMAC-SHA256, under a key
//! derived from the cursor key, over the associated data and the plaintext. Equal positions seal
//! equal for one caller, and nothing else about them can be told apart. The plaintext is the
//! position as eight big-endian bytes; the associated data binds the kind (cursor or revision),
//! the space and the caller's identity, so a token opens only for the caller, the space and the
//! kind it was sealed for. A token is the unpadded base64url of the nonce, the ciphertext and the
//! tag: 48 bytes, 64 characters.

use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};

/// A cursor version 1's prefix.
pub const CURSOR_PREFIX: &str = "v1.";
/// A sealed revision's prefix (`r1.`), also inside a locator version 2's `indexVersion`.
pub const REVISION_PREFIX: &str = "r1.";
/// A `usage-list` cursor's prefix (`u1.`, phase 5 section 12.1).
pub const USAGE_PREFIX: &str = "u1.";

/// The sealed bytes: a 24-byte nonce, an 8-byte position and a 16-byte tag.
const SEALED_BYTES: usize = 24 + 8 + 16;

/// What a sealed position names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// A position in a space's event stream: the `seq` of the last event before it.
    Cursor,
    /// A store revision of a space's document store.
    Revision,
    /// A position in the usage store, after the last record a `usage-list` page returned. Its
    /// "space" is what the caller reads (`own` or `all`).
    Usage,
}

impl Kind {
    fn label(self) -> &'static [u8] {
        match self {
            Self::Cursor => b"cursor",
            Self::Revision => b"revision",
            Self::Usage => b"usage",
        }
    }

    /// The prefix its tokens carry.
    #[must_use]
    pub fn prefix(self) -> &'static str {
        match self {
            Self::Cursor => CURSOR_PREFIX,
            Self::Revision => REVISION_PREFIX,
            Self::Usage => USAGE_PREFIX,
        }
    }
}

/// HMAC-SHA256 (RFC 2104) of `message` under `key`.
pub(crate) fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    const BLOCK: usize = 64;
    let mut block = [0u8; BLOCK];
    if key.len() > BLOCK {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha256::new();
    inner.update(block.map(|byte| byte ^ 0x36));
    inner.update(message);
    let mut outer = Sha256::new();
    outer.update(block.map(|byte| byte ^ 0x5c));
    outer.update(inner.finalize());
    outer.finalize().into()
}

/// The sealer of one workspace: its cursor key, and the nonce key derived from it.
pub struct Positions {
    cipher: Option<XChaCha20Poly1305>,
    nonce_key: [u8; 32],
}

impl std::fmt::Debug for Positions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Positions(..)")
    }
}

impl Positions {
    /// The sealer under `key`, `state/keys/cursor.key` (at least 32 bytes), with the cipher's key
    /// and the nonce's each derived from it by HMAC-SHA256 under its own label. A shorter key,
    /// which the workspace never reads, seals nothing that opens.
    #[must_use]
    pub fn new(key: &[u8]) -> Self {
        // Two keys derived from the file, one per use: the cipher's and the nonce's.
        let cipher_key = hmac_sha256(key, b"umbel/positions/1/cipher");
        Self {
            cipher: (key.len() >= 32)
                .then(|| XChaCha20Poly1305::new_from_slice(&cipher_key).ok())
                .flatten(),
            nonce_key: hmac_sha256(key, b"umbel/positions/1/nonce"),
        }
    }

    /// The associated data: the construction, the kind, the space and the caller, each with its
    /// length.
    fn associated(kind: Kind, space: &str, identity: &str) -> Vec<u8> {
        let mut out = b"umbel/positions/1".to_vec();
        for part in [kind.label(), space.as_bytes(), identity.as_bytes()] {
            out.extend_from_slice(&(part.len() as u64).to_be_bytes());
            out.extend_from_slice(part);
        }
        out
    }

    /// The synthetic nonce of `plaintext` under `associated`.
    fn nonce(&self, associated: &[u8], plaintext: &[u8]) -> [u8; 24] {
        let mut message = (associated.len() as u64).to_be_bytes().to_vec();
        message.extend_from_slice(associated);
        message.extend_from_slice(plaintext);
        let mac = hmac_sha256(&self.nonce_key, &message);
        let mut nonce = [0u8; 24];
        nonce.copy_from_slice(&mac[..24]);
        nonce
    }

    /// `value` sealed for `identity` in `space`, with its kind's prefix.
    #[must_use]
    pub fn seal(&self, kind: Kind, space: &str, identity: &str, value: u64) -> String {
        let associated = Self::associated(kind, space, identity);
        let plaintext = value.to_be_bytes();
        let nonce = self.nonce(&associated, &plaintext);
        let sealed = self
            .cipher
            .as_ref()
            .and_then(|cipher| {
                cipher
                    .encrypt(
                        &XNonce::from(nonce),
                        Payload {
                            msg: &plaintext,
                            aad: &associated,
                        },
                    )
                    .ok()
            })
            .unwrap_or_default();
        let mut bytes = nonce.to_vec();
        bytes.extend_from_slice(&sealed);
        format!("{}{}", kind.prefix(), base64url(&bytes))
    }

    /// The position `text` seals for `identity` in `space`, or `None` when it is not a token of
    /// that kind sealed for them: malformed, altered, another caller's, another space's or
    /// another kind's alike.
    #[must_use]
    pub fn open(&self, kind: Kind, space: &str, identity: &str, text: &str) -> Option<u64> {
        let token = text.strip_prefix(kind.prefix())?;
        let bytes = from_base64url(token)?;
        if bytes.len() != SEALED_BYTES {
            return None;
        }
        let (nonce, sealed) = bytes.split_at(24);
        let associated = Self::associated(kind, space, identity);
        let nonce = <&XNonce>::try_from(nonce).ok()?;
        let plaintext = self
            .cipher
            .as_ref()?
            .decrypt(
                nonce,
                Payload {
                    msg: sealed,
                    aad: &associated,
                },
            )
            .ok()?;
        // The nonce is the plaintext's own: anything else was not sealed here.
        if self.nonce(&associated, &plaintext)[..] != nonce[..] {
            return None;
        }
        let value: [u8; 8] = plaintext.try_into().ok()?;
        Some(u64::from_be_bytes(value))
    }
}

/// How one call's caller sees positions (phase 5 section 9.3): plain for mode `none`, the
/// operator and stdio, sealed for every other hosted caller.
pub(crate) struct Presenter {
    sealer: Option<(Positions, String)>,
}

impl Presenter {
    /// The presenter for `caller`, reading the cursor key only when it seals.
    ///
    /// # Errors
    /// The workspace's error when the cursor key cannot be read or created.
    pub(crate) fn of(
        workspace: &crate::workspace::Workspace,
        caller: &crate::access::Caller,
    ) -> Result<Self, afd::CommandError> {
        if !caller.seals_positions() {
            return Ok(Self { sealer: None });
        }
        let key = workspace
            .cursor_key()
            .map_err(|error| error.to_command_error())?;
        Ok(Self {
            sealer: Some((Positions::new(&key), caller.position_identity().to_owned())),
        })
    }

    /// Whether positions are sealed for this caller.
    pub(crate) fn seals(&self) -> bool {
        self.sealer.is_some()
    }

    /// The cursor after event `seq` of `space`: version 1 sealed, or version 0.
    pub(crate) fn cursor(&self, space: &crate::workspace::SpaceId, seq: u64) -> String {
        match &self.sealer {
            Some((positions, identity)) => {
                positions.seal(Kind::Cursor, space.as_str(), identity, seq)
            }
            None => crate::events::Cursor::new(space.clone(), seq).to_string(),
        }
    }

    /// A store revision of `space` as this caller sees it: sealed, or the number. The caller
    /// passes the last revision it can read at or below the true one.
    pub(crate) fn revision(&self, space: &str, rev: u64) -> serde_json::Value {
        match &self.sealer {
            Some((positions, identity)) => {
                serde_json::Value::String(positions.seal(Kind::Revision, space, identity, rev))
            }
            None => serde_json::Value::from(rev),
        }
    }

    /// The position a sealed token of `kind` names for this caller in `space`; `None` when it
    /// is not one, or when this caller's positions are plain.
    pub(crate) fn open(&self, kind: Kind, space: &str, text: &str) -> Option<u64> {
        let (positions, identity) = self.sealer.as_ref()?;
        positions.open(kind, space, identity, text)
    }
}

/// The most host metadata entries [`Stash`] keeps for the journal; past it the oldest go.
const STASHED: usize = 4096;

/// The host metadata a sealed result leaves out, kept for the journal (phase 5 section 9.3).
///
/// A caller whose positions are sealed is not shown `dev.umbel/changes` or a record's `version`;
/// the journal, which every event stream is rebuilt from, records them as they were. The plugin
/// gate puts each result's under a fresh random reference the result carries
/// (`dev.umbel/journal-ref`), and the journal's last look takes it back, and the reference out,
/// before the entry is stored. Only a result the journal will record is stashed; an entry still
/// unclaimed when [`STASHED`] newer ones arrive is dropped.
#[derive(Default)]
pub(crate) struct Stash {
    entries: std::sync::Mutex<
        std::collections::VecDeque<(String, serde_json::Map<String, serde_json::Value>)>,
    >,
}

impl std::fmt::Debug for Stash {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Stash(..)")
    }
}

impl Stash {
    /// Keep `raw` under `reference` for the journal.
    pub(crate) fn put(&self, reference: &str, raw: serde_json::Map<String, serde_json::Value>) {
        if let Ok(mut entries) = self.entries.lock() {
            if entries.len() >= STASHED {
                entries.pop_front();
            }
            entries.push_back((reference.to_owned(), raw));
        }
    }

    /// The metadata kept under `reference`, removed.
    pub(crate) fn take(
        &self,
        reference: &str,
    ) -> Option<serde_json::Map<String, serde_json::Value>> {
        let mut entries = self.entries.lock().ok()?;
        let at = entries.iter().position(|(key, _)| key == reference)?;
        entries.remove(at).map(|(_, raw)| raw)
    }
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Unpadded base64url (RFC 4648 section 5).
fn base64url(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..=chunk.len() {
            out.push(char::from(ALPHABET[((n >> (18 - 6 * i)) & 63) as usize]));
        }
    }
    out
}

/// Decode unpadded base64url; `None` on anything else, non-canonical trailing bits included.
fn from_base64url(text: &str) -> Option<Vec<u8>> {
    let value = |c: u8| ALPHABET.iter().position(|a| *a == c).map(|v| v as u32);
    let bytes = text.as_bytes();
    if bytes.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let mut n = 0u32;
        for (i, c) in chunk.iter().enumerate() {
            n |= value(*c)? << (18 - 6 * i);
        }
        let take = chunk.len() - 1;
        let decoded = [(n >> 16) as u8, (n >> 8) as u8, n as u8];
        // Bits past the last byte must be zero, so one position has one token.
        let used = 8 * take;
        let mask = if used >= 24 {
            0
        } else {
            (1u32 << (24 - used)) - 1
        };
        if n & mask != 0 {
            return None;
        }
        out.extend_from_slice(&decoded[..take]);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn positions() -> Positions {
        Positions::new(&[7u8; 32])
    }

    #[test]
    fn hmac_follows_rfc_4231() {
        let hex = |bytes: &[u8]| bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
        assert_eq!(
            hex(&hmac_sha256(b"Jefe", b"what do ya want for nothing?")),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }

    #[test]
    fn sealing_is_deterministic_and_opens_only_for_its_caller_space_and_kind() {
        let p = positions();
        let a = p.seal(Kind::Cursor, "main", "agent:corp/c|human:corp/ada", 42);
        assert_eq!(
            a,
            p.seal(Kind::Cursor, "main", "agent:corp/c|human:corp/ada", 42)
        );
        assert!(a.starts_with("v1.") && a.len() == 3 + 64, "{a}");
        assert_eq!(
            p.open(Kind::Cursor, "main", "agent:corp/c|human:corp/ada", &a),
            Some(42)
        );
        assert_ne!(
            a,
            p.seal(Kind::Cursor, "main", "agent:corp/c|human:corp/ada", 43)
        );
        // Another caller, space or kind: refused, like a malformed token.
        assert_eq!(
            p.open(Kind::Cursor, "main", "agent:corp/c|human:corp/bo", &a),
            None
        );
        assert_eq!(
            p.open(Kind::Cursor, "beta", "agent:corp/c|human:corp/ada", &a),
            None
        );
        let r = p.seal(Kind::Revision, "main", "x", 9);
        assert!(r.starts_with("r1."));
        assert_eq!(
            p.open(Kind::Cursor, "main", "x", &format!("v1.{}", &r[3..])),
            None
        );
        assert_eq!(p.open(Kind::Revision, "main", "x", &r), Some(9));
        // A different key opens nothing.
        assert_eq!(
            Positions::new(&[8u8; 32]).open(Kind::Revision, "main", "x", &r),
            None
        );
    }

    #[test]
    fn an_altered_token_is_refused() {
        let p = positions();
        let token = p.seal(Kind::Revision, "main", "x", 1);
        for at in 3..token.len() {
            let mut bytes = token.clone().into_bytes();
            bytes[at] = if bytes[at] == b'A' { b'B' } else { b'A' };
            let altered = String::from_utf8(bytes).unwrap();
            assert_eq!(p.open(Kind::Revision, "main", "x", &altered), None, "{at}");
        }
        for bad in ["", "r1.", "r1.=", "r1.AAAA", "v0:main:1", "r1.!!!!"] {
            assert_eq!(p.open(Kind::Revision, "main", "x", bad), None, "{bad}");
        }
    }

    #[test]
    fn base64url_round_trips_canonically() {
        for n in 0..50 {
            let bytes: Vec<u8> = (0..n).map(|i| (i * 37 + 11) as u8).collect();
            let text = base64url(&bytes);
            assert!(!text.contains('=') && !text.contains('+') && !text.contains('/'));
            assert_eq!(from_base64url(&text), Some(bytes));
        }
        // Non-zero trailing bits are a second spelling of the same bytes: refused.
        assert_eq!(from_base64url("AB"), None);
        assert_eq!(from_base64url("AA"), Some(vec![0]));
    }
}
