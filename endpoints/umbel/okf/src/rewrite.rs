//! Frontmatter-only rewrites (phase 2 specification, section 9.3): replace or add some top-level
//! keys of a file's frontmatter and leave every other byte of the file as it was, comments
//! included.
//!
//! A key's lines are its own line and the lines that continue it: lines indented more than the
//! key, a block sequence written at the key's own indentation (`- item`), and blank lines that a
//! continuation follows. They are replaced by a canonical block; a key the frontmatter does not
//! have is appended before the closing fence; a file with no frontmatter gets a new block in
//! front. The result is read back with the same reader the stores use and each key is checked, so
//! a rewrite never reports success for a file it did not change as asked.

use std::fmt;

use serde_json::Value;

use crate::frontmatter::split;

/// Why a rewrite was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum RewriteError {
    /// The file opens a frontmatter block that never closes.
    Unclosed,
    /// The file is not UTF-8 or its frontmatter does not read.
    Unreadable(String),
    /// The rewritten file does not hold the value for this key: the frontmatter is written in a
    /// form the rewrite cannot edit (for example a flow mapping).
    NotApplied(String),
    /// A key that cannot be written as a plain top-level key.
    BadKey(String),
}

impl fmt::Display for RewriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unclosed => f.write_str("the frontmatter block is not closed"),
            Self::Unreadable(why) => write!(f, "the frontmatter does not read: {why}"),
            Self::NotApplied(key) => write!(
                f,
                "the rewrite did not produce the requested `{key}` (its frontmatter is written in a form that cannot be edited line by line)"
            ),
            Self::BadKey(key) => write!(f, "`{key}` is not a plain frontmatter key"),
        }
    }
}

impl std::error::Error for RewriteError {}

const BOM: &str = "\u{FEFF}";

/// Set top-level frontmatter keys to values, replacing a key's lines and appending those the
/// frontmatter lacks (in the order given), and keep every other byte of `text`.
///
/// # Errors
/// [`RewriteError`] when the frontmatter does not close or read, a key is not a plain word, or
/// the result does not hold a requested value.
pub fn rewrite_keys(text: &str, keys: &[(&str, Value)]) -> Result<String, RewriteError> {
    for (key, _) in keys {
        if key.is_empty()
            || !key
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return Err(RewriteError::BadKey((*key).to_owned()));
        }
    }
    let (bom, rest) = match text.strip_prefix(BOM) {
        Some(rest) => (BOM, rest),
        None => ("", text),
    };
    let lines: Vec<&str> = rest.split_inclusive('\n').collect();
    let eol = match lines.first() {
        Some(line) if line.ends_with("\r\n") => "\r\n",
        _ => "\n",
    };
    let opens = lines
        .first()
        .is_some_and(|line| line.trim_end_matches(['\n', '\r']) == "---");

    let out = if opens {
        let Some(close) =
            (1..lines.len()).find(|&n| lines[n].trim_end_matches(['\n', '\r']) == "---")
        else {
            return Err(RewriteError::Unclosed);
        };
        let mut body: Vec<String> = lines[1..close].iter().map(|l| (*l).to_owned()).collect();
        let mut appended = Vec::new();
        for (key, value) in keys {
            let block = render(key, value, eol);
            match find_key(&body, key) {
                Some((start, end)) => {
                    body.splice(start..end, std::iter::once(block));
                }
                None => appended.push(block),
            }
        }
        let mut out = String::with_capacity(text.len() + 64);
        out.push_str(bom);
        out.push_str(lines[0]);
        for line in &body {
            out.push_str(line);
        }
        for block in &appended {
            out.push_str(block);
        }
        for line in &lines[close..] {
            out.push_str(line);
        }
        out
    } else {
        let mut out = String::with_capacity(text.len() + 64);
        out.push_str(bom);
        out.push_str("---");
        out.push_str(eol);
        for (key, value) in keys {
            out.push_str(&render(key, value, eol));
        }
        out.push_str("---");
        out.push_str(eol);
        out.push_str(rest);
        out
    };

    let parts =
        split(out.as_bytes()).map_err(|problem| RewriteError::Unreadable(problem.to_string()))?;
    let fields = parts.fields.unwrap_or_default();
    for (key, value) in keys {
        if fields.get(*key) != Some(value) {
            return Err(RewriteError::NotApplied((*key).to_owned()));
        }
    }
    Ok(out)
}

/// The lines (`start..end`, end exclusive) of `key` in the block's lines.
fn find_key(body: &[String], key: &str) -> Option<(usize, usize)> {
    let start = body.iter().position(|line| is_key_line(line, key))?;
    let mut end = start + 1;
    let mut n = start + 1;
    while n < body.len() {
        let line = body[n].trim_end_matches(['\n', '\r']);
        if line.trim().is_empty() {
            // A blank line belongs to the key only when a continuation follows it.
            let mut ahead = n + 1;
            while ahead < body.len() && body[ahead].trim().is_empty() {
                ahead += 1;
            }
            if ahead < body.len() && continues(&body[ahead]) {
                n = ahead;
                end = n + 1;
                n += 1;
                continue;
            }
            break;
        }
        if continues(&body[n]) {
            end = n + 1;
            n += 1;
        } else {
            break;
        }
    }
    Some((start, end))
}

fn continues(line: &str) -> bool {
    line.starts_with([' ', '\t'])
        || line.starts_with("- ")
        || line.trim_end_matches(['\n', '\r']) == "-"
}

fn is_key_line(line: &str, key: &str) -> bool {
    let rest = [
        line.strip_prefix(key),
        line.strip_prefix('"')
            .and_then(|r| r.strip_prefix(key))
            .and_then(|r| r.strip_prefix('"')),
        line.strip_prefix('\'')
            .and_then(|r| r.strip_prefix(key))
            .and_then(|r| r.strip_prefix('\'')),
    ]
    .into_iter()
    .flatten()
    .next();
    let Some(rest) = rest else {
        return false;
    };
    let rest = rest.trim_start_matches([' ', '\t']);
    match rest.strip_prefix(':') {
        Some(after) => after.is_empty() || after.starts_with([' ', '\t', '\n', '\r']),
        None => false,
    }
}

/// A mapping key as YAML text: plain when it is a simple word, else a quoted string.
fn key_text(name: &str) -> String {
    let simple = name
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if simple {
        name.to_owned()
    } else {
        Value::String(name.to_owned()).to_string()
    }
}

/// `key: value` as the canonical block: scalars and flow values as JSON (valid YAML), lists of
/// scalars and mappings as block sequences.
fn render(key: &str, value: &Value, eol: &str) -> String {
    let mut out = String::new();
    match value {
        Value::Array(items) if !items.is_empty() => {
            out.push_str(key);
            out.push(':');
            out.push_str(eol);
            for item in items {
                match item {
                    Value::Object(map) if !map.is_empty() => {
                        // `by` and `at` first, as OKF writes an actor stamp; the rest by name.
                        let mut entries: Vec<(&String, &Value)> = map.iter().collect();
                        entries.sort_by_key(|(name, _)| {
                            (
                                !matches!(name.as_str(), "by" | "at"),
                                name.as_str() != "by",
                                (*name).clone(),
                            )
                        });
                        for (n, (name, inner)) in entries.into_iter().enumerate() {
                            out.push_str(if n == 0 { "  - " } else { "    " });
                            out.push_str(&key_text(name));
                            out.push_str(": ");
                            out.push_str(&inner.to_string());
                            out.push_str(eol);
                        }
                    }
                    other => {
                        out.push_str("  - ");
                        out.push_str(&other.to_string());
                        out.push_str(eol);
                    }
                }
            }
        }
        other => {
            out.push_str(key);
            out.push_str(": ");
            out.push_str(&other.to_string());
            out.push_str(eol);
        }
    }
    out
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn replaces_a_key_and_keeps_every_other_byte() {
        let text = "---\n# keep me\ntitle: A  title\nstatus: stable   # inline\ntags: [a,   b]\n---\nBody\n";
        let out = rewrite_keys(text, &[("status", json!("deprecated"))]).unwrap();
        assert_eq!(
            out,
            "---\n# keep me\ntitle: A  title\nstatus: \"deprecated\"\ntags: [a,   b]\n---\nBody\n"
        );
    }

    #[test]
    fn appends_a_missing_key_before_the_closing_fence() {
        let text = "---\ntitle: T\n---\nBody\n";
        let out = rewrite_keys(text, &[("stale_after", json!("2027-01-01T00:00:00Z"))]).unwrap();
        assert_eq!(
            out,
            "---\ntitle: T\nstale_after: \"2027-01-01T00:00:00Z\"\n---\nBody\n"
        );
    }

    #[test]
    fn replaces_a_block_with_its_continuation_lines() {
        let text = "---\nverified:\n  - by: human:ada\n    at: 2026-01-01T00:00:00Z\nstatus: stable\n---\n";
        let list = json!([
            { "by": "human:ada", "at": "2026-01-01T00:00:00Z" },
            { "by": "human:bo", "at": "2026-11-01T00:00:00Z" },
        ]);
        let out = rewrite_keys(text, &[("verified", list)]).unwrap();
        assert_eq!(
            out,
            "---\nverified:\n  - by: \"human:ada\"\n    at: \"2026-01-01T00:00:00Z\"\n  - by: \"human:bo\"\n    at: \"2026-11-01T00:00:00Z\"\nstatus: stable\n---\n"
        );
    }

    #[test]
    fn a_block_sequence_at_the_keys_own_indentation_belongs_to_it() {
        let text = "---\nverified:\n- by: human:ada\n  at: 2026-01-01T00:00:00Z\ntitle: T\n---\n";
        let out = rewrite_keys(
            text,
            &[("verified", json!([{ "by": "human:bo", "at": "x" }]))],
        )
        .unwrap();
        assert_eq!(
            out,
            "---\nverified:\n  - by: \"human:bo\"\n    at: \"x\"\ntitle: T\n---\n"
        );
    }

    #[test]
    fn a_file_without_frontmatter_gets_a_block() {
        let out = rewrite_keys("# Heading\n\nText\n", &[("status", json!("deprecated"))]).unwrap();
        assert_eq!(out, "---\nstatus: \"deprecated\"\n---\n# Heading\n\nText\n");
    }

    #[test]
    fn line_endings_and_the_byte_order_mark_are_kept() {
        let text = "\u{FEFF}---\r\ntitle: T\r\n---\r\nBody\r\n";
        let out = rewrite_keys(text, &[("status", json!("deprecated"))]).unwrap();
        assert_eq!(
            out,
            "\u{FEFF}---\r\ntitle: T\r\nstatus: \"deprecated\"\r\n---\r\nBody\r\n"
        );
    }

    #[test]
    fn an_unclosed_block_and_a_bad_key_are_refused() {
        assert_eq!(
            rewrite_keys("---\ntitle: T\n", &[("status", json!("x"))]),
            Err(RewriteError::Unclosed)
        );
        assert!(matches!(
            rewrite_keys("---\ntitle: T\n---\n", &[("a b", json!("x"))]),
            Err(RewriteError::BadKey(_))
        ));
    }
}
