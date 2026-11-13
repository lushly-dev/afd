//! The embedding provider trait (records host specification, section 9.1; D166).
//!
//! [`Embedder`] is one of the two trait names phase 2 reserved here and left undefined. A record
//! lane's meaning scores come from one, when a deployer configures a model and its gate passes.
//! The providers are in `umbel-embed`; this crate holds the trait, the model's id and the error,
//! and loads nothing.

use std::fmt;

use crate::error::{Result, StoreError};

/// `<models id>@<16 hex>`: the configured id and a digest of everything that can change its
/// vectors (section 9.2). Two ids that differ name two models, whose vectors never mix.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ModelId(String);

impl ModelId {
    /// Parse `<models id>@<16 lowercase hex>`, the id matching `^[a-z][a-z0-9-]{0,31}$`.
    ///
    /// # Errors
    /// [`StoreError::Invalid`] when the text is not in that form.
    pub fn parse(text: &str) -> Result<Self> {
        let valid = text.split_once('@').is_some_and(|(id, digest)| {
            let mut chars = id.chars();
            chars.next().is_some_and(|c| c.is_ascii_lowercase())
                && id.len() <= 32
                && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
                && digest.len() == 16
                && digest
                    .bytes()
                    .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        });
        if valid {
            Ok(Self(text.to_owned()))
        } else {
            Err(StoreError::invalid(
                "a model id is <models id>@<16 lowercase hex>, the id matching ^[a-z][a-z0-9-]{0,31}$",
            ))
        }
    }

    /// The text form.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ModelId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Why an embedding failed. No message holds a text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmbedError {
    /// The provider could not be reached or timed out. Retryable.
    Unavailable(String),
    /// The provider answered something that is not `dimensions` finite numbers per text.
    Invalid(String),
}

impl fmt::Display for EmbedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable(reason) => {
                write!(f, "the embedding provider is unavailable: {reason}")
            }
            Self::Invalid(reason) => {
                write!(f, "the embedding provider's answer is invalid: {reason}")
            }
        }
    }
}

impl std::error::Error for EmbedError {}

/// An embedding model. Synchronous, as the store traits are, and called from a blocking thread.
pub trait Embedder: Send + Sync {
    /// The model's id.
    fn model(&self) -> &ModelId;
    /// How many numbers a vector holds.
    fn dimensions(&self) -> usize;
    /// One vector per text, in order. The caller scales each to length 1; a zero vector is no
    /// vector.
    ///
    /// # Errors
    /// [`EmbedError`], whose message never holds a text.
    fn embed(&self, texts: &[&str]) -> std::result::Result<Vec<Vec<f32>>, EmbedError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_model_id_is_the_configured_id_and_sixteen_hex_digits() {
        let id = ModelId::parse("potion@0123456789abcdef").unwrap();
        assert_eq!(id.as_str(), "potion@0123456789abcdef");
        assert_eq!(id.to_string(), "potion@0123456789abcdef");
        for bad in [
            "",
            "potion",
            "potion@",
            "@0123456789abcdef",
            "Potion@0123456789abcdef",
            "potion@0123456789ABCDEF",
            "potion@0123456789abcde",
            "potion@0123456789abcdef0",
            "9potion@0123456789abcdef",
            "po tion@0123456789abcdef",
        ] {
            assert!(ModelId::parse(bad).is_err(), "{bad}");
        }
        assert!(ModelId::parse(&format!("{}@0123456789abcdef", "a".repeat(32))).is_ok());
        assert!(ModelId::parse(&format!("{}@0123456789abcdef", "a".repeat(33))).is_err());
    }

    #[test]
    fn an_embed_error_says_which_kind_it_is() {
        assert!(
            EmbedError::Unavailable("timed out".into())
                .to_string()
                .contains("unavailable")
        );
        assert!(
            EmbedError::Invalid("3 numbers, not 4".into())
                .to_string()
                .contains("invalid")
        );
    }
}
