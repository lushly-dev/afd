//! Access tokens, access sets and the reader filter (specification sections 3.1 and 6).

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::error::{Result, StoreError};

/// The most tokens one reader filter may hold (a principal, its groups and `space`).
pub const MAX_READER_TOKENS: usize = 1000;

/// The actor kinds a principal string may name.
const PRINCIPAL_KINDS: &[&str] = &["human", "agent", "service", "script"];

/// Check one access token: `space`, `group:<id>` (`^[a-z][a-z0-9-]{0,62}$`) or
/// `principal:<kind>:<id>` with a kind of human, agent, service or script and an id of 1 to 128
/// characters without a control character.
///
/// # Errors
/// [`StoreError::Invalid`] naming the rule the token breaks.
pub fn validate_token(token: &str) -> Result<()> {
    if token == "space" {
        return Ok(());
    }
    if let Some(group) = token.strip_prefix("group:") {
        let mut chars = group.chars();
        let valid = chars.next().is_some_and(|c| c.is_ascii_lowercase())
            && group.len() <= 63
            && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        return if valid {
            Ok(())
        } else {
            Err(StoreError::invalid(format!(
                "access token `{token}`: a group id must match ^[a-z][a-z0-9-]{{0,62}}$"
            )))
        };
    }
    if let Some(principal) = token.strip_prefix("principal:") {
        let valid = principal.split_once(':').is_some_and(|(kind, id)| {
            PRINCIPAL_KINDS.contains(&kind)
                && (1..=128).contains(&id.chars().count())
                && !id.chars().any(char::is_control)
        });
        return if valid {
            Ok(())
        } else {
            Err(StoreError::invalid(format!(
                "access token `{token}`: a principal must be principal:<kind>:<id> with kind human, agent, service or script and an id of 1 to 128 characters"
            )))
        };
    }
    Err(StoreError::invalid(format!(
        "`{token}` is not an access token; use space, group:<id> or principal:<kind>:<id>"
    )))
}

/// A sorted, deduplicated, non-empty list of access tokens: who may read a record.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct AccessSet(Vec<String>);

impl AccessSet {
    /// Build a set from tokens, sorting and deduplicating them.
    ///
    /// # Errors
    /// [`StoreError::Invalid`] when the list is empty or a token is malformed.
    pub fn new<I, S>(tokens: I) -> Result<Self>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut tokens: Vec<String> = tokens.into_iter().map(Into::into).collect();
        tokens.sort();
        tokens.dedup();
        if tokens.is_empty() {
            return Err(StoreError::invalid("an access set is never empty"));
        }
        for token in &tokens {
            validate_token(token)?;
        }
        Ok(Self(tokens))
    }

    /// The tokens, sorted.
    #[must_use]
    pub fn tokens(&self) -> &[String] {
        &self.0
    }

    /// Whether `reader` holds one of the set's tokens (always, under derivation).
    #[must_use]
    pub fn readable_by(&self, reader: &ReaderFilter) -> bool {
        reader.admits(self)
    }
}

impl Serialize for AccessSet {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for AccessSet {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        let tokens = Vec::<String>::deserialize(deserializer)?;
        Self::new(tokens).map_err(serde::de::Error::custom)
    }
}

/// The caller's access tokens in one space, or a derivation read. Every read method takes one and
/// applies it inside its query, before ordering and limits (principle 10).
///
/// Only the host builds a reader filter, from the call's principal and the space's readers; a
/// plugin never holds a constructor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderFilter(Mode);

#[derive(Debug, Clone, PartialEq, Eq)]
enum Mode {
    Tokens(Vec<String>),
    Derivation,
}

impl ReaderFilter {
    /// A reader holding these tokens (possibly none: it reads nothing).
    ///
    /// # Errors
    /// [`StoreError::Invalid`] when a token is malformed or there are more than
    /// [`MAX_READER_TOKENS`].
    pub fn tokens<I, S>(tokens: I) -> Result<Self>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut tokens: Vec<String> = tokens.into_iter().map(Into::into).collect();
        tokens.sort();
        tokens.dedup();
        if tokens.len() > MAX_READER_TOKENS {
            return Err(StoreError::invalid(format!(
                "a reader filter holds at most {MAX_READER_TOKENS} tokens"
            )));
        }
        for token in &tokens {
            validate_token(token)?;
        }
        Ok(Self(Mode::Tokens(tokens)))
    }

    /// The derivation read: no access filter, for a command that writes derived data (D54).
    #[must_use]
    pub fn derivation() -> Self {
        Self(Mode::Derivation)
    }

    /// Whether this is the derivation read.
    #[must_use]
    pub fn is_derivation(&self) -> bool {
        matches!(self.0, Mode::Derivation)
    }

    /// The reader's tokens, sorted, or `None` for a derivation read.
    #[must_use]
    pub fn token_list(&self) -> Option<&[String]> {
        match &self.0 {
            Mode::Tokens(tokens) => Some(tokens),
            Mode::Derivation => None,
        }
    }

    /// Whether this reader may read a record with `access`.
    #[must_use]
    pub fn admits(&self, access: &AccessSet) -> bool {
        match &self.0 {
            Mode::Derivation => true,
            Mode::Tokens(tokens) => access.tokens().iter().any(|t| tokens.contains(t)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_follow_the_grammar() {
        for good in [
            "space",
            "group:eng",
            "group:a-1",
            "principal:human:ada",
            "principal:agent:a:b",
        ] {
            assert!(validate_token(good).is_ok(), "{good}");
        }
        for bad in [
            "",
            "Space",
            "group:",
            "group:Eng",
            "group:1a",
            "principal:robot:x",
            "principal:human:",
            "principal:human",
            "x",
        ] {
            assert!(validate_token(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn sets_sort_dedup_and_refuse_empty() {
        let set = AccessSet::new(["group:b", "space", "group:b"]).unwrap();
        assert_eq!(set.tokens(), ["group:b", "space"]);
        assert!(AccessSet::new(Vec::<String>::new()).is_err());
        assert!(serde_json::from_str::<AccessSet>("[]").is_err());
    }

    #[test]
    fn readers_admit_by_intersection() {
        let set = AccessSet::new(["group:eng"]).unwrap();
        assert!(
            ReaderFilter::tokens(["space", "group:eng"])
                .unwrap()
                .admits(&set)
        );
        assert!(!ReaderFilter::tokens(["space"]).unwrap().admits(&set));
        assert!(
            !ReaderFilter::tokens(Vec::<String>::new())
                .unwrap()
                .admits(&set)
        );
        assert!(ReaderFilter::derivation().admits(&set));
    }
}
