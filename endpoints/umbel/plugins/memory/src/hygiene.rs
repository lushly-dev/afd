//! The `hygiene` pack and secret masking (section 8.2, step 2): an ordered list of kinds and
//! regular expressions, each match replaced with `[REDACTED:<kind>]` before anything is stored or
//! hashed, and counted by kind. A net, not a guarantee.

use std::collections::BTreeMap;

use regex::{Regex, RegexBuilder};
use serde::Deserialize;
use umbel_sdk::{Cx, Outcome};
use umbel_store::Redaction;

use crate::fail;

/// The compiled size each pattern may reach (section 8.2).
const PATTERN_SIZE_LIMIT: usize = 1024 * 1024;
/// The most patterns a pack holds.
const MAX_PATTERNS: usize = 64;
/// What a masked span begins with. A match that already holds one is left alone, so a later,
/// broader pattern does not count a secret twice.
const MARK: &str = "[REDACTED:";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PackFile {
    #[serde(default)]
    pattern: Vec<PatternFile>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PatternFile {
    kind: String,
    regex: String,
}

/// The compiled patterns, in the pack's order.
#[derive(Debug, Clone)]
pub(crate) struct Hygiene {
    patterns: Vec<(String, Regex)>,
}

/// Masks counted by kind, across every field of a write.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Counts(pub(crate) BTreeMap<String, u64>);

impl Counts {
    /// Add another field's counts.
    pub(crate) fn add(&mut self, other: &Self) {
        for (kind, count) in &other.0 {
            *self.0.entry(kind.clone()).or_default() += count;
        }
    }

    /// Whether nothing was masked.
    pub(crate) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// The envelope's `redactions`: sorted by kind, at most 32 entries, `None` when empty.
    pub(crate) fn redactions(&self) -> Option<Vec<Redaction>> {
        (!self.0.is_empty()).then(|| {
            self.0
                .iter()
                .take(32)
                .map(|(kind, count)| Redaction {
                    kind: kind.clone(),
                    count: *count,
                })
                .collect()
        })
    }

    /// `[{ kind, count }]`, for results and warnings.
    pub(crate) fn to_json(&self) -> serde_json::Value {
        serde_json::Value::Array(
            self.0
                .iter()
                .map(|(kind, count)| serde_json::json!({ "kind": kind, "count": count }))
                .collect(),
        )
    }

    /// `SECRETS_MASKED`'s message: counts by kind, never text.
    pub(crate) fn summary(&self) -> String {
        let parts: Vec<String> = self
            .0
            .iter()
            .map(|(kind, count)| format!("{count} {kind}"))
            .collect();
        format!("masked before storing: {}", parts.join(", "))
    }
}

impl Hygiene {
    /// Read the space's hygiene pack.
    pub(crate) fn load(cx: &Cx) -> Result<Self, Outcome> {
        let bytes = cx
            .pack_read("hygiene", "data/secrets.toml")
            .map_err(|error| fail::host(&error))?;
        let text = String::from_utf8(bytes)
            .map_err(|_| fail::pack_invalid("hygiene", "data/secrets.toml is not UTF-8"))?;
        Self::parse(&text).map_err(|reason| fail::pack_invalid("hygiene", &reason))
    }

    /// Parse and compile the pack's text.
    pub(crate) fn parse(text: &str) -> Result<Self, String> {
        let file: PackFile = toml::from_str(text).map_err(|error| error.message().to_owned())?;
        if file.pattern.is_empty() || file.pattern.len() > MAX_PATTERNS {
            return Err(format!("the pack holds 1 to {MAX_PATTERNS} patterns"));
        }
        let mut patterns = Vec::with_capacity(file.pattern.len());
        for (n, pattern) in file.pattern.into_iter().enumerate() {
            let kind_ok = !pattern.kind.is_empty()
                && pattern.kind.len() <= 64
                && pattern
                    .kind
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
            if !kind_ok {
                return Err(format!(
                    "pattern {n}: kind is 1 to 64 lowercase letters, digits and dashes"
                ));
            }
            let regex = RegexBuilder::new(&pattern.regex)
                .size_limit(PATTERN_SIZE_LIMIT)
                .build()
                .map_err(|_| {
                    format!(
                        "pattern {n} ({}) does not compile within 1 MiB",
                        pattern.kind
                    )
                })?;
            patterns.push((pattern.kind, regex));
        }
        Ok(Self { patterns })
    }

    /// `text` with every match masked, in the pack's order, and the counts by kind.
    pub(crate) fn mask(&self, text: &str) -> (String, Counts) {
        let mut current = text.to_owned();
        let mut counts = Counts::default();
        for (kind, regex) in &self.patterns {
            if !regex.is_match(&current) {
                continue;
            }
            let mut masked = 0u64;
            let replaced = regex.replace_all(&current, |caps: &regex::Captures<'_>| {
                let whole = caps.get(0).map_or("", |m| m.as_str());
                if whole.contains(MARK) {
                    whole.to_owned()
                } else {
                    masked += 1;
                    format!("{MARK}{kind}]")
                }
            });
            if masked > 0 {
                current = replaced.into_owned();
                *counts.0.entry(kind.clone()).or_default() += masked;
            }
        }
        (current, counts)
    }

    /// Whether any pattern matches `text`: a label it would mask is refused (section 3.1).
    pub(crate) fn would_mask(&self, text: &str) -> bool {
        self.patterns.iter().any(|(_, regex)| regex.is_match(text))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    const DEFAULT: &str = include_str!("../packs/hygiene/data/secrets.toml");

    fn hygiene() -> Hygiene {
        Hygiene::parse(DEFAULT).expect("the default pack compiles")
    }

    #[test]
    fn an_assignment_holding_a_token_counts_once() {
        let (text, counts) =
            hygiene().mask("token: ghp_abcdefghijklmnopqrstuvwxyz0123456789 then more");
        assert_eq!(text, "token: [REDACTED:github-token] then more");
        assert_eq!(counts.0.get("github-token"), Some(&1));
        assert_eq!(counts.0.len(), 1);
    }

    #[test]
    fn a_pack_that_does_not_compile_is_refused() {
        let bad = "[[pattern]]\nkind = \"x\"\nregex = '('\n";
        assert!(Hygiene::parse(bad).is_err());
        let kind = "[[pattern]]\nkind = \"Bad Kind\"\nregex = 'a'\n";
        assert!(Hygiene::parse(kind).is_err());
        assert!(Hygiene::parse("").is_err());
    }
}
