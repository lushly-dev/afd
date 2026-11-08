//! Who a verified caller is (phase 5 specification, sections 2.1, 4.1, 4.3 and 4.5): the shapes
//! the token verifier fills and the context hook reads.
//!
//! The verifier (`super::verifier`) maps a verified token's claims to a [`VerifiedCaller`] and
//! leaves it in the request's [`CallerSlot`], which the HTTP surface puts in every request's
//! extensions before AFD's bearer layer runs. The context hook reads it only beside the
//! credentials AFD's server admitted, and only when the two are equal, so a slot that some other
//! code filled, or that belongs to other credentials, identifies no one. A request's extensions
//! are set by the host's own layers, never by anything the caller sends.

use std::fmt;
use std::sync::{Arc, OnceLock};

use afd::{Actor, ActorKind, Credentials};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{HASHED_ID_PREFIX, MAX_LITERAL_ID_CHARS, MAX_PRINCIPAL_ID_CHARS};

/// One entry of a principal's `delegationChain` (2.1): a client or an RFC 8693 actor, mapped as
/// a client is (4.1).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChainEntry {
    /// `agent` or `service`.
    pub kind: ActorKind,
    /// `<namespace>/<mapped id>`.
    pub id: String,
}

/// How the token that identified a caller is held (2.1's `tokenBinding`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TokenBinding {
    /// A bearer token.
    Bearer,
    /// A token bound to the TLS client certificate (RFC 8705).
    Mtls {
        /// The certificate's SHA-256 thumbprint, unpadded base64url.
        thumbprint: String,
    },
}

/// A verified caller, as section 4.1 maps it from one request's verified token.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct VerifiedCaller {
    /// The credentials AFD's verifier returned for the same token; the hook requires them equal
    /// to the ones the server admitted.
    pub(crate) credentials: Credentials,
    /// The issuer's identity namespace.
    pub(crate) namespace: String,
    /// The issuer's alias.
    pub(crate) issuer: String,
    /// `agent:<ns>/<client>` acting for `<ns>/<subject>`, or `service:<ns>/<client>`.
    pub(crate) actor: Actor,
    /// Outermost first, at most [`super::MAX_DELEGATION_CHAIN`].
    pub(crate) chain: Vec<ChainEntry>,
    /// Bearer, or bound to the certificate.
    pub(crate) binding: TokenBinding,
    /// The granted scopes under the configured prefix (5.1), in token order.
    pub(crate) scopes: Vec<String>,
    /// The `[access.groups]` this token's claims make the caller a member of (4.5).
    pub(crate) claim_groups: Vec<String>,
}

impl VerifiedCaller {
    /// The effective principal: `human:<ns>/<subject>` for a person's client, the service itself
    /// for a service.
    pub(crate) fn effective_principal(&self) -> Option<String> {
        crate::provenance::effective_principal(&self.actor)
    }
}

/// Identifiers stay out of logs, as AFD's `Credentials` keep theirs (step 0a).
impl fmt::Debug for VerifiedCaller {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("VerifiedCaller")
            .field("issuer", &self.issuer)
            .field("namespace", &self.namespace)
            .field("credentials", &self.credentials)
            .field("actor", &"[redacted]")
            .field("chain", &"[redacted]")
            .field("scopes", &"[redacted]")
            .field("claim_groups", &"[redacted]")
            .finish_non_exhaustive()
    }
}

/// The per-request place the token verifier leaves the caller it mapped. The HTTP surface
/// inserts an empty one into every request before AFD's bearer layer; the verifier fills it once.
#[derive(Clone, Default)]
pub(crate) struct CallerSlot(Arc<OnceLock<Arc<VerifiedCaller>>>);

impl CallerSlot {
    /// Fill the slot. `false` when it was already filled (a second verification of one request,
    /// which never happens and is refused).
    #[cfg_attr(not(feature = "auth"), allow(dead_code))]
    pub(crate) fn fill(&self, caller: VerifiedCaller) -> bool {
        self.0.set(Arc::new(caller)).is_ok()
    }

    /// The caller the verifier mapped, if it ran.
    pub(crate) fn caller(&self) -> Option<&Arc<VerifiedCaller>> {
        self.0.get()
    }
}

impl fmt::Debug for CallerSlot {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("CallerSlot")
    }
}

/// A subject or client id as it appears in a principal under namespace `ns` (4.1, amended by
/// step 1): the id itself when it has at most [`MAX_LITERAL_ID_CHARS`] characters, does not start
/// with `~` and keeps `<ns>/<id>` within [`MAX_PRINCIPAL_ID_CHARS`]; otherwise `~` and the 52
/// lowercase unpadded base32 characters of its SHA-256. The ids reaching here passed AFD's claim
/// rule (1 to 255 characters, no control character).
pub fn mapped_id(ns: &str, id: &str) -> String {
    let length = id.chars().count();
    let literal = !id.starts_with(HASHED_ID_PREFIX)
        && length <= MAX_LITERAL_ID_CHARS
        && ns.chars().count() + 1 + length <= MAX_PRINCIPAL_ID_CHARS;
    if literal {
        id.to_owned()
    } else {
        format!(
            "{HASHED_ID_PREFIX}{}",
            base32(&Sha256::digest(id.as_bytes()))
        )
    }
}

/// RFC 4648 base32, lowercase, unpadded.
fn base32(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";
    let mut out = String::with_capacity(bytes.len().div_ceil(5) * 8);
    let mut buffer: u32 = 0;
    let mut bits = 0u32;
    for byte in bytes {
        buffer = (buffer << 8) | u32::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(char::from(ALPHABET[((buffer >> bits) & 31) as usize]));
        }
    }
    if bits > 0 {
        out.push(char::from(ALPHABET[((buffer << (5 - bits)) & 31) as usize]));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{HASHED_ID_BASE32_CHARS, is_mapped_id};

    #[test]
    fn base32_follows_rfc_4648() {
        // RFC 4648 section 10's vectors, lowercase and unpadded.
        for (input, expected) in [
            ("", ""),
            ("f", "my"),
            ("fo", "mzxq"),
            ("foo", "mzxw6"),
            ("foob", "mzxw6yq"),
            ("fooba", "mzxw6ytb"),
            ("foobar", "mzxw6ytboi"),
        ] {
            assert_eq!(base32(input.as_bytes()), expected, "{input}");
        }
    }

    #[test]
    fn ids_are_literal_or_hashed_as_section_4_1_says() {
        assert_eq!(mapped_id("corp", "U019488227"), "U019488227");
        let long = "x".repeat(121);
        let hashed = mapped_id("corp", &long);
        assert!(hashed.starts_with('~'));
        assert_eq!(hashed.len(), 1 + HASHED_ID_BASE32_CHARS);
        assert!(is_mapped_id("corp", &hashed));
        // A literal starting with `~` is always hashed, so no literal produces the hashed form.
        assert_ne!(mapped_id("corp", &hashed), hashed);
        assert!(mapped_id("corp", "~short").starts_with('~'));
        assert_eq!(mapped_id("corp", "~short").len(), 53);
        // Within 120 characters, but `<ns>/<id>` past 128.
        let ns = "n".repeat(32);
        assert_eq!(mapped_id(&ns, &"x".repeat(95)), "x".repeat(95));
        assert!(mapped_id(&ns, &"x".repeat(96)).starts_with('~'));
        for id in ["U1", &long, "~a", &"y".repeat(120)] {
            assert!(is_mapped_id("corp", &mapped_id("corp", id)), "{id}");
        }
    }
}
