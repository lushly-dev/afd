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

/// What vouches for a verified caller: section 2.1's `authentication` and `tokenBinding`.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(not(feature = "auth"), allow(dead_code))]
pub(crate) enum Vouched {
    /// A verified access token (section 3.2), held as the binding says: `authentication`
    /// `verified`.
    Token(TokenBinding),
    /// A verified gateway assertion (section 4.4): `authentication` `gateway`, and no
    /// `tokenBinding`, since an assertion is not a token (amendment from step 1).
    Gateway,
}

/// A verified caller, as section 4.1 maps it from one request's verified token, or section 4.4
/// from its verified gateway assertion.
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
    /// A token, bearer or bound to the certificate, or a gateway assertion.
    pub(crate) vouched: Vouched,
    /// The granted scopes under the configured prefix (5.1), in token order.
    pub(crate) scopes: Vec<String>,
    /// The `[access.groups]` this token's claims make the caller a member of (4.5). Read through
    /// [`Self::claim_groups`], which gives none for a gateway's caller.
    pub(crate) claim_groups: Vec<String>,
}

impl VerifiedCaller {
    /// The `[access.groups]` this caller's token makes it a member of (4.5). **Never any for a
    /// gateway's caller**, whatever the field holds: groups are never taken from a gateway. Every
    /// reader of a verified caller's groups reads them here.
    pub(crate) fn claim_groups(&self) -> &[String] {
        match self.vouched {
            Vouched::Token(_) => &self.claim_groups,
            Vouched::Gateway => &[],
        }
    }

    /// Whether this caller was vouched for as `mode` vouches: a token in mode `oauth`, an
    /// assertion in mode `gateway`, nothing in mode `none`. A caller one mode made never stands
    /// in another, wherever a caller is read (the context hook and the scope resolver).
    #[cfg_attr(not(feature = "auth"), allow(dead_code))]
    pub(crate) fn vouched_for(&self, mode: crate::workspace::AuthMode) -> bool {
        use crate::workspace::AuthMode;
        matches!(
            (mode, &self.vouched),
            (AuthMode::Oauth, Vouched::Token(_)) | (AuthMode::Gateway, Vouched::Gateway)
        )
    }

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
            .field(
                "vouched",
                &match self.vouched {
                    Vouched::Token(_) => "token",
                    Vouched::Gateway => "gateway",
                },
            )
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
pub(crate) struct CallerSlot(
    Arc<OnceLock<Arc<VerifiedCaller>>>,
    /// Where the slot was entered in a [`CallerBook`], so that filling it indexes its caller.
    Arc<OnceLock<(std::sync::Weak<std::sync::Mutex<Book>>, u64)>>,
);

impl CallerSlot {
    /// Fill the slot. `false` when it was already filled (a second verification of one request,
    /// which never happens and is refused).
    #[cfg_attr(not(feature = "auth"), allow(dead_code))]
    pub(crate) fn fill(&self, caller: VerifiedCaller) -> bool {
        let identity = identity(&caller.credentials);
        if self.0.set(Arc::new(caller)).is_err() {
            return false;
        }
        if let Some((book, id)) = self.1.get()
            && let Some(book) = book.upgrade()
        {
            let mut book = book
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if book.slots.contains_key(id) {
                book.index.entry(identity).or_default().insert(*id);
            }
        }
        true
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

/// The requests in flight on the hosted surface, each with its [`CallerSlot`] (phase 5 step 3).
///
/// AFD asks Umbel's scope resolver about credentials alone, while 5.4's "readability before
/// scope" needs the caller those credentials were mapped to: its effective principal and claim
/// groups. The HTTP surface enters every request's slot here before AFD's bearer layer runs and
/// leaves it when the request is answered, so the resolver finds the mapped caller of the
/// credentials it is asked about among the requests in flight. It holds nothing past a request,
/// and is bounded by the connections the listener serves.
#[derive(Clone, Default)]
pub(crate) struct CallerBook(Arc<std::sync::Mutex<Book>>);

/// A verified token's issuer, subject and client: the book's index.
type Identity = (String, String, String);

fn identity(credentials: &Credentials) -> Identity {
    (
        credentials.issuer.clone(),
        credentials.subject.clone(),
        credentials.client_id.clone(),
    )
}

#[derive(Default)]
pub(crate) struct Book {
    next: u64,
    slots: std::collections::HashMap<u64, CallerSlot>,
    /// The filled slots by their caller's identity, so a lookup reads only the requests in
    /// flight for that issuer, subject and client.
    index: std::collections::HashMap<Identity, std::collections::BTreeSet<u64>>,
}

/// A request's place in the [`CallerBook`], left when dropped.
pub(crate) struct BookEntry {
    book: CallerBook,
    id: u64,
}

impl Drop for BookEntry {
    fn drop(&mut self) {
        let mut book = self.book.lock();
        if let Some(caller) = book
            .slots
            .remove(&self.id)
            .and_then(|slot| slot.caller().cloned())
        {
            let identity = identity(&caller.credentials);
            if let Some(ids) = book.index.get_mut(&identity) {
                ids.remove(&self.id);
                if ids.is_empty() {
                    book.index.remove(&identity);
                }
            }
        }
    }
}

impl CallerBook {
    fn lock(&self) -> std::sync::MutexGuard<'_, Book> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Enter a request's slot until the returned entry drops.
    #[cfg_attr(not(feature = "auth"), allow(dead_code))]
    pub(crate) fn enter(&self, slot: CallerSlot) -> BookEntry {
        let mut book = self.lock();
        let id = book.next;
        book.next = book.next.wrapping_add(1);
        let _ = slot.1.set((Arc::downgrade(&self.0), id));
        // A slot filled before it was entered is indexed now; one filled later indexes itself.
        if let Some(caller) = slot.caller() {
            let identity = identity(&caller.credentials);
            book.index.entry(identity).or_default().insert(id);
        }
        book.slots.insert(id, slot);
        BookEntry {
            book: self.clone(),
            id,
        }
    }

    /// The caller mapped for exactly `credentials` by a request in flight. `None` when no
    /// request in flight holds them, or when two hold equal credentials mapped to callers that
    /// differ (which only the issuer could cause), so that no guess is ever made.
    #[cfg_attr(not(feature = "auth"), allow(dead_code))]
    pub(crate) fn caller_for(&self, credentials: &Credentials) -> Option<Arc<VerifiedCaller>> {
        let book = self.lock();
        let mut found: Option<Arc<VerifiedCaller>> = None;
        let ids = book.index.get(&identity(credentials));
        let callers = ids
            .into_iter()
            .flatten()
            .filter_map(|id| book.slots.get(id))
            .filter_map(CallerSlot::caller);
        for caller in callers {
            if caller.credentials != *credentials {
                continue;
            }
            match &found {
                None => found = Some(Arc::clone(caller)),
                Some(seen) if **seen == **caller => {}
                Some(_) => return None,
            }
        }
        found
    }

    /// How many requests are in flight, and how many identities the index holds.
    #[cfg(test)]
    pub(crate) fn len(&self) -> (usize, usize) {
        let book = self.lock();
        (book.slots.len(), book.index.len())
    }
}

impl fmt::Debug for CallerBook {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("CallerBook")
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
pub(crate) fn base32(bytes: &[u8]) -> String {
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

    fn caller_with(credentials: &Credentials, groups: &[&str]) -> VerifiedCaller {
        VerifiedCaller {
            credentials: credentials.clone(),
            namespace: "corp".into(),
            issuer: "as".into(),
            actor: Actor::new(ActorKind::Agent)
                .with_id("corp/app")
                .with_on_behalf_of("corp/ada"),
            chain: Vec::new(),
            vouched: Vouched::Token(TokenBinding::Bearer),
            scopes: Vec::new(),
            claim_groups: groups.iter().map(|g| (*g).to_owned()).collect(),
        }
    }

    #[test]
    fn the_book_finds_a_caller_only_while_its_request_is_in_flight_and_never_guesses() {
        let mine = Credentials::new("https://as", "ada", "app", "https://r/mcp", 1, 2);
        let other = Credentials::new("https://as", "bo", "app", "https://r/mcp", 1, 2);
        let book = CallerBook::default();
        assert!(book.caller_for(&mine).is_none());
        let slot = CallerSlot::default();
        let entry = book.enter(slot.clone());
        // Entered but not yet filled by the verifier.
        assert!(book.caller_for(&mine).is_none());
        assert!(slot.fill(caller_with(&mine, &["eng"])));
        assert_eq!(book.caller_for(&mine).unwrap().claim_groups, ["eng"]);
        assert!(book.caller_for(&other).is_none());
        // A second request with the same credentials and the same caller: still found.
        let same = CallerSlot::default();
        assert!(same.fill(caller_with(&mine, &["eng"])));
        let second = book.enter(same);
        assert!(book.caller_for(&mine).is_some());
        // One whose mapping differs makes the answer ambiguous: none.
        let differing = CallerSlot::default();
        assert!(differing.fill(caller_with(&mine, &["ops"])));
        let third = book.enter(differing);
        assert!(book.caller_for(&mine).is_none());
        drop(third);
        assert!(book.caller_for(&mine).is_some());
        drop((entry, second));
        assert_eq!(book.len(), (0, 0));
        assert!(book.caller_for(&mine).is_none());
    }

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
