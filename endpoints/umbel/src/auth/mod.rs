//! The MCP Authorization layer's vocabulary (phase 5 specification, sections 2, 4.1 and 5.1):
//! the constants section 2's shapes and rules name, the scope grammar and its order, and the
//! form of a namespaced principal id.
//!
//! Step 1 of the phase 5 plan adds these, and configuration version 5 parses with them. Step 2b
//! adds token verification (`verifier`, with `keys`, `introspection` and `fetch`) and the mapping
//! of a verified token to a caller (`mapping`, `caller`). Step 2c adds the doctor's hosted profile
//! (`doctor`, with `files` for the certificates, keys and CA files it reads, which the verifier's
//! per-issuer `ca_file` shares). Step 3 adds section 5's resolver (`scopes`) and scope gate
//! (`scope_gate`), replacing step 2b's interim rule. Step 4 adds section 4.4's gateway-trusted
//! mode (`gateway`): the pinned channel, the assertion's verification and its mapping.

use crate::workspace::SpaceId;

pub(crate) mod caller;
#[cfg(feature = "auth")]
pub(crate) mod doctor;
#[cfg(feature = "auth")]
pub(crate) mod fetch;
#[cfg(feature = "auth")]
pub(crate) mod files;
#[cfg(feature = "auth")]
pub(crate) mod gateway;
#[cfg(feature = "auth")]
pub(crate) mod introspection;
#[cfg(feature = "auth")]
pub(crate) mod keys;
#[cfg(feature = "auth")]
pub(crate) mod mapping;
pub(crate) mod scope_gate;
pub(crate) mod scopes;
#[cfg(feature = "auth")]
pub(crate) mod verifier;

pub use caller::{ChainEntry, TokenBinding, mapped_id};

/// The scope verbs, in the order 5.1 lists them.
pub const SCOPE_VERBS: &[&str] = &["read", "write", "approve", "erase"];
/// `auth.scope_prefix`'s default.
pub const DEFAULT_SCOPE_PREFIX: &str = "umbel";
/// The most Umbel scopes a token may carry (3.2 rule 10): more is a 401, `scopes-too-many`.
pub const MAX_TOKEN_SCOPES: usize = 64;
/// The longest `delegationChain` (2.1).
pub const MAX_DELEGATION_CHAIN: usize = 8;
/// The longest subject or client id kept literally in a principal id (4.1); a longer one, or one
/// starting with `~`, becomes [`HASHED_ID_PREFIX`] and the lowercase base32 of its SHA-256.
pub const MAX_LITERAL_ID_CHARS: usize = 120;
/// The longest principal id (phase 2's grammar, phase 0's `principal.local_id`). A namespaced id
/// `<ns>/<id>` whose literal form would be longer is hashed too (amendment from step 1).
pub const MAX_PRINCIPAL_ID_CHARS: usize = 128;
/// The first character of a hashed id; no literal id can start with it (4.1).
pub const HASHED_ID_PREFIX: char = '~';
/// The unpadded lowercase base32 characters of a SHA-256 (256 bits in 52 characters).
pub const HASHED_ID_BASE32_CHARS: usize = 52;
/// RFC 8176's user-verification methods, the only ones `uv_amr` may name (2.2, owner decision 6).
pub const UV_AMR_METHODS: &[&str] = &["pin", "fpt", "face", "iris", "retina", "vbm"];
/// The JWS algorithms an issuer may list: AFD's `SigningAlgorithm` (step 0b's amendment). `none`,
/// the `HS*` family, `ES512` and Ed448 are refused.
pub const SIGNING_ALGORITHMS: &[&str] = &[
    "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "EdDSA",
];
/// An issuer's `algorithms` when the file gives none: RS256, which RFC 9068 and OIDC Core require
/// every issuer to support.
pub const DEFAULT_ALGORITHMS: &[&str] = &["RS256"];
/// `auth.clock_skew_s`'s default and largest value (AFD's `DEFAULT_CLOCK_SKEW_S` and
/// `MAX_CLOCK_SKEW_S`).
pub const DEFAULT_CLOCK_SKEW_S: u64 = 60;
/// The largest `auth.clock_skew_s`.
pub const MAX_CLOCK_SKEW_S: u64 = 300;
/// `auth.max_token_lifetime_s`'s default.
pub const DEFAULT_MAX_TOKEN_LIFETIME_S: u64 = 3_600;
/// The largest `auth.max_token_lifetime_s`: one day (amendment from step 1).
pub const MAX_TOKEN_LIFETIME_S: u64 = 86_400;
/// A person login's `max_age_s` default and largest value (amendment from step 1).
pub const DEFAULT_PERSON_MAX_AGE_S: u64 = 300;
/// The largest `max_age_s`.
pub const MAX_PERSON_MAX_AGE_S: u64 = 3_600;
/// `[auth.gateway] max_assertion_age_s`'s default and largest value (amendment from step 1).
pub const DEFAULT_MAX_ASSERTION_AGE_S: u64 = 60;
/// The largest `max_assertion_age_s` (amendment from step 4): 60, as an assertion lives at most
/// [`MAX_ASSERTION_LIFETIME_S`] after its `iat` and must not have expired, so a larger age could
/// never admit one more assertion.
pub const MAX_ASSERTION_AGE_S: u64 = 60;
/// What a gateway's caller obtains to gain a scope, in a missing scope's suggestion (step 4): its
/// scopes are the gateway's to assert, within `max_scopes`, never a token's.
pub(crate) const GATEWAY_SCOPE_SOURCE: &str =
    "a new Umbel-Gateway-Assertion from the gateway, within its scope ceiling,";
/// How long after its `iat` a gateway assertion may expire (4.4).
pub const MAX_ASSERTION_LIFETIME_S: u64 = 60;
/// How long a person decision waits to be decided (7.2).
pub const PERSON_DECISION_TTL_S: u64 = 600;
/// `[limits]`'s defaults (11).
pub const DEFAULT_IP_REQUESTS_PER_MINUTE: u64 = 1_200;
/// `calls_per_minute`'s default.
pub const DEFAULT_CALLS_PER_MINUTE: u64 = 600;
/// `read_bytes_per_minute`'s default: 64 MiB.
pub const DEFAULT_READ_BYTES_PER_MINUTE: u64 = 67_108_864;
/// `person_pages_per_hour`'s default.
pub const DEFAULT_PERSON_PAGES_PER_HOUR: u64 = 30;
/// `usage.retention_days`'s default (12.1).
pub const DEFAULT_USAGE_RETENTION_DAYS: u64 = 400;
/// `erase_approvals`' default (8.4): one eraser, only because a single administrator could not
/// erase otherwise.
pub const DEFAULT_ERASE_APPROVALS: u64 = 1;
/// `erase_approval_window_s`'s default, smallest and largest values (8.4).
pub const DEFAULT_ERASE_APPROVAL_WINDOW_S: u64 = 86_400;
/// The smallest `erase_approval_window_s`.
pub const MIN_ERASE_APPROVAL_WINDOW_S: u64 = 600;
/// The largest `erase_approval_window_s`.
pub const MAX_ERASE_APPROVAL_WINDOW_S: u64 = 604_800;
/// A task's default `ttlMs` (12.2).
pub const DEFAULT_TASK_TTL_MS: u64 = 3_600_000;
/// More readable memory matches than this is `MEMORY_QUERY_TOO_BROAD` (9.2).
#[allow(clippy::cast_possible_truncation)]
pub const MAX_MEMORY_MATCHES: usize = umbel_store::memory::MAX_RECALL_MATCHES as usize;

/// A `verified` command with no person login to prove the person, or no namespaced caller (phase 5
/// section 10.5; `crate::person::unavailable`).
pub const PERSON_VERIFICATION_UNAVAILABLE: &str = "PERSON_VERIFICATION_UNAVAILABLE";

/// One scope verb (5.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ScopeVerb {
    /// `read`.
    Read,
    /// `write`.
    Write,
    /// `approve`.
    Approve,
    /// `erase`.
    Erase,
}

impl ScopeVerb {
    /// The verb as a scope spells it.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Write => "write",
            Self::Approve => "approve",
            Self::Erase => "erase",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "read" => Self::Read,
            "write" => Self::Write,
            "approve" => Self::Approve,
            "erase" => Self::Erase,
            _ => return None,
        })
    }
}

/// An Umbel scope: `<prefix>:<verb>`, or `<prefix>:<verb>:<space>` (5.1).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Scope {
    /// The verb.
    pub verb: ScopeVerb,
    /// The space it is narrowed to; `None` for every space.
    pub space: Option<SpaceId>,
}

impl Scope {
    /// Parse `text` under `prefix`, exactly: no wildcard, case-sensitive. `None` for a scope under
    /// another prefix, which is ignored, and for one that is malformed under this prefix.
    pub fn parse(prefix: &str, text: &str) -> Option<Self> {
        let rest = text.strip_prefix(prefix)?.strip_prefix(':')?;
        let (verb, space) = match rest.split_once(':') {
            Some((verb, space)) => (verb, Some(SpaceId::parse(space).ok()?)),
            None => (rest, None),
        };
        Some(Self {
            verb: ScopeVerb::parse(verb)?,
            space,
        })
    }

    /// The scope as a token carries it under `prefix`.
    pub fn to_scope_string(&self, prefix: &str) -> String {
        match &self.space {
            Some(space) => format!("{prefix}:{}:{space}", self.verb.as_str()),
            None => format!("{prefix}:{}", self.verb.as_str()),
        }
    }

    /// Whether holding `self` implies holding `other` (5.1): a verb implies itself on every
    /// space, every verb on a space implies `read` there, and `write` implies neither `approve`
    /// nor `erase`.
    pub fn implies(&self, other: &Self) -> bool {
        let verb = self.verb == other.verb || other.verb == ScopeVerb::Read;
        let space = match (&self.space, &other.space) {
            (None, _) => true,
            (Some(mine), Some(theirs)) => mine == theirs,
            (Some(_), None) => false,
        };
        verb && space
    }
}

/// Whether `text` is a scope prefix: `^[a-z][a-z0-9.-]{0,31}$` (2.2).
pub fn is_scope_prefix(text: &str) -> bool {
    lower_id(text, 32, |c| c == '.' || c == '-')
}

/// Whether `text` is an identity namespace: `^[a-z][a-z0-9-]{0,31}$` (2.2).
pub fn is_namespace(text: &str) -> bool {
    lower_id(text, 32, |c| c == '-')
}

/// Whether `text` is an issuer or gateway alias: `^[a-z][a-z0-9-]{0,62}$` (amendment from step 1).
pub fn is_alias(text: &str) -> bool {
    lower_id(text, 63, |c| c == '-')
}

fn lower_id(text: &str, max: usize, extra: impl Fn(char) -> bool) -> bool {
    let mut chars = text.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && text.len() <= max
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || extra(c))
}

/// Whether `id` is a subject or client id as 4.1 maps it into a principal under namespace `ns`:
/// a literal of 1 to [`MAX_LITERAL_ID_CHARS`] characters, with no control character, not starting
/// with `~`, whose `<ns>/<id>` fits [`MAX_PRINCIPAL_ID_CHARS`]; or the hashed form, `~` and
/// [`HASHED_ID_BASE32_CHARS`] lowercase base32 characters.
pub fn is_mapped_id(ns: &str, id: &str) -> bool {
    if let Some(hash) = id.strip_prefix(HASHED_ID_PREFIX) {
        return hash.len() == HASHED_ID_BASE32_CHARS
            && hash
                .bytes()
                .all(|b| b.is_ascii_lowercase() || (b'2'..=b'7').contains(&b));
    }
    let length = id.chars().count();
    (1..=MAX_LITERAL_ID_CHARS).contains(&length)
        && ns.chars().count() + 1 + length <= MAX_PRINCIPAL_ID_CHARS
        && !id.chars().any(char::is_control)
}

/// `<ns>/<id>` split at its first `/`, when `ns` is a namespace and `id` a mapped id of it.
pub fn split_namespaced(text: &str) -> Option<(&str, &str)> {
    let (ns, id) = text.split_once('/')?;
    (is_namespace(ns) && is_mapped_id(ns, id)).then_some((ns, id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(text: &str) -> Scope {
        Scope::parse("umbel", text).unwrap()
    }

    #[test]
    fn scopes_parse_exactly() {
        assert_eq!(
            scope("umbel:read"),
            Scope {
                verb: ScopeVerb::Read,
                space: None
            }
        );
        assert_eq!(scope("umbel:write:alpha").space.unwrap().as_str(), "alpha");
        for bad in [
            "umbel:Read",
            "umbel:read:",
            "umbel:read:Alpha",
            "umbel:read:*",
            "umbel:admin",
            "umbel:read:a:b",
            "umbel",
            "umbel:",
            "other:read",
            "umbelx:read",
            "UMBEL:read",
        ] {
            assert_eq!(Scope::parse("umbel", bad), None, "{bad}");
        }
        assert_eq!(
            scope("umbel:erase:a").to_scope_string("umbel"),
            "umbel:erase:a"
        );
    }

    #[test]
    fn the_order_follows_section_5_1() {
        assert!(scope("umbel:write").implies(&scope("umbel:write:alpha")));
        assert!(scope("umbel:write:alpha").implies(&scope("umbel:read:alpha")));
        assert!(scope("umbel:approve:alpha").implies(&scope("umbel:read:alpha")));
        assert!(scope("umbel:write").implies(&scope("umbel:read:beta")));
        assert!(!scope("umbel:write").implies(&scope("umbel:approve")));
        assert!(!scope("umbel:write:alpha").implies(&scope("umbel:erase:alpha")));
        assert!(!scope("umbel:write:alpha").implies(&scope("umbel:write")));
        assert!(!scope("umbel:write:alpha").implies(&scope("umbel:read:beta")));
        assert!(!scope("umbel:read").implies(&scope("umbel:write:alpha")));
    }

    #[test]
    fn identifiers() {
        for ok in ["umbel", "u", "corp.tools-1", &"a".repeat(32)] {
            assert!(is_scope_prefix(ok), "{ok}");
        }
        for bad in ["", "Umbel", "1umbel", "um:bel", &"a".repeat(33)] {
            assert!(!is_scope_prefix(bad), "{bad}");
        }
        assert!(is_namespace("corp") && is_namespace("idp-2"));
        assert!(!is_namespace("corp.x") && !is_namespace(&"a".repeat(33)));
        assert!(is_alias("corp-idp") && is_alias(&"a".repeat(63)));
        assert!(!is_alias(&"a".repeat(64)) && !is_alias("Corp"));
    }

    #[test]
    fn mapped_ids_are_literal_or_hashed() {
        assert!(is_mapped_id("corp", "U019488227"));
        assert!(is_mapped_id("corp", "auth0|abc/def"));
        assert!(is_mapped_id("corp", &format!("~{}", "a2".repeat(26))));
        assert!(!is_mapped_id("corp", &format!("~{}", "a1".repeat(26))));
        assert!(!is_mapped_id("corp", "~short"));
        assert!(!is_mapped_id("corp", ""));
        assert!(!is_mapped_id("corp", "a\nb"));
        assert!(is_mapped_id("corp", &"x".repeat(120)));
        assert!(!is_mapped_id("corp", &"x".repeat(121)));
        // `<ns>/<id>` must fit the 128 characters of a principal id.
        let ns = "n".repeat(32);
        assert!(is_mapped_id(&ns, &"x".repeat(95)));
        assert!(!is_mapped_id(&ns, &"x".repeat(96)));
        assert_eq!(split_namespaced("corp/U1"), Some(("corp", "U1")));
        assert_eq!(split_namespaced("corp/a/b"), Some(("corp", "a/b")));
        assert_eq!(split_namespaced("Corp/U1"), None);
        assert_eq!(split_namespaced("corp/"), None);
        assert_eq!(split_namespaced("ada"), None);
    }
}
