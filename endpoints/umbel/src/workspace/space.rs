//! Space ids.

use std::fmt;

use serde::Serialize;

/// The id of a space: `^[a-z][a-z0-9-]{0,62}$`. Ids are identity: renaming one is a new space.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct SpaceId(String);

impl SpaceId {
    /// The default space of a workspace that declares none.
    pub const MAIN: &'static str = "main";

    /// Whether `value` is a valid space id.
    pub fn is_valid(value: &str) -> bool {
        let mut chars = value.chars();
        chars.next().is_some_and(|c| c.is_ascii_lowercase())
            && value.len() <= 63
            && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    }

    /// Parse a space id.
    ///
    /// # Errors
    /// Returns a message naming the rule when `value` is not a valid id.
    pub fn parse(value: &str) -> Result<Self, String> {
        if Self::is_valid(value) {
            Ok(Self(value.to_owned()))
        } else {
            Err(format!(
                "`{value}` is not a valid space id; use 1 to 63 characters matching ^[a-z][a-z0-9-]{{0,62}}$"
            ))
        }
    }

    /// The id as a string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl AsRef<str> for SpaceId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for SpaceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::SpaceId;

    #[test]
    fn accepts_the_documented_shape() {
        for id in ["main", "a", "research-2", &format!("a{}", "b".repeat(62))] {
            assert!(SpaceId::is_valid(id), "{id}");
        }
    }

    #[test]
    fn refuses_everything_else() {
        for id in [
            "",
            "Main",
            "1main",
            "-main",
            "main_2",
            "ma in",
            "ünï",
            &format!("a{}", "b".repeat(63)),
        ] {
            assert!(!SpaceId::is_valid(id), "{id}");
        }
    }
}
