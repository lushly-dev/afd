//! The approval display rules (`spec/approvals.md`, "Approval display"): what a person
//! must be able to read in full before approving an action.
//!
//! An approver, or any surface that shows a person a held call, shows the call's validated input
//! only when [`approval_display`] accepts it, and otherwise shows none of it and offers no
//! approval: a person cannot approve what they cannot see, and truncating is not showing.
//!
//! The same rules as TypeScript's `approvalDisplay` in `@lushly-dev/afd-core`, from Lushly's
//! `approval-display.ts` (D150): lengths count UTF-16 code units and keys are visited in canonical
//! order, so both give the same verdict (`spec/vectors/approver-client.json`, `display`).

use std::fmt;
use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

/// The limits of [`approval_display`]. Lengths count UTF-16 code units.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ApprovalDisplayLimits {
    /// The input's canonical JSON.
    pub max_serialized_length: usize,
    /// One string value.
    pub max_string_length: usize,
    /// One object key.
    pub max_key_length: usize,
    /// Nesting: the input is at depth 0, its members and items at 1.
    pub max_depth: usize,
    /// Values visited, the input itself included.
    pub max_values: usize,
}

/// The limits the rules apply.
pub const APPROVAL_DISPLAY_LIMITS: ApprovalDisplayLimits = ApprovalDisplayLimits {
    max_serialized_length: 8_000,
    max_string_length: 2_000,
    max_key_length: 200,
    max_depth: 6,
    max_values: 400,
};

/// Why [`approval_display`] refused an input, in the order the checks run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ApprovalDisplayRefusal {
    /// Approvals' canonical JSON does not accept it (an integer a 64-bit float cannot hold).
    NotJson,
    /// Its canonical JSON is longer than 8000 code units.
    TooLong,
    /// More than 400 values.
    TooManyValues,
    /// A value deeper than 6.
    TooDeep,
    /// A string longer than 2000 code units.
    StringTooLong,
    /// An object key longer than 200 code units.
    KeyTooLong,
    /// A string or key that hides characters ([`hides_characters`]).
    HiddenCharacters,
}

impl ApprovalDisplayRefusal {
    /// The refusal's name in the spec and the vectors, such as `too-deep`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotJson => "not-json",
            Self::TooLong => "too-long",
            Self::TooManyValues => "too-many-values",
            Self::TooDeep => "too-deep",
            Self::StringTooLong => "string-too-long",
            Self::KeyTooLong => "key-too-long",
            Self::HiddenCharacters => "hidden-characters",
        }
    }
}

impl fmt::Display for ApprovalDisplayRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The verdict of [`approval_display`]: the input to show, or why not.
pub type ApprovalDisplay = Result<Value, ApprovalDisplayRefusal>;

/// Whether one code point makes what a person reads differ from what runs, or draws nothing:
/// controls other than tab and line feed, the soft hyphen, bidirectional marks, embeddings,
/// overrides and isolates, zero-width characters, line and paragraph separators, invisible
/// operators, blank look-alikes, variation selectors other than U+FE0E and U+FE0F, the byte order
/// mark, interlinear annotations, format controls, tags and reserved ignorables, and surrogates
/// (which a Rust string never holds, but a code point from elsewhere may name).
pub fn is_hidden_code_point(code: u32) -> bool {
    matches!(
        code,
        0x00..=0x08
            | 0x0b..=0x1f
            | 0x7f..=0x9f
            | 0xad
            | 0x34f
            | 0x61c
            | 0x115f
            | 0x1160
            | 0x17b4
            | 0x17b5
            | 0x180b..=0x180f
            | 0x200b..=0x200f
            | 0x2028
            | 0x2029
            | 0x202a..=0x202e
            | 0x2060..=0x206f
            | 0x2800
            | 0x3164
            | 0xd800..=0xdfff
            | 0xfe00..=0xfe0d
            | 0xfeff
            | 0xffa0
            | 0xfff0..=0xfffb
            | 0x1bca0..=0x1bca3
            | 0x1d173..=0x1d17a
            | 0xe0000..=0xe0fff
    )
}

/// Six or more combining marks (Unicode general category M) in a row.
fn stacked_marks() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"\p{M}{6,}").expect("a valid pattern"))
}

/// Whether `text` holds a hidden code point ([`is_hidden_code_point`]) or a run of six or more
/// combining marks, which draw over the lines around them.
pub fn hides_characters(text: &str) -> bool {
    text.chars().any(|c| is_hidden_code_point(u32::from(c))) || stacked_marks().is_match(text)
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Whether a person can be shown `input` in full before approving it, and if so the input. The
/// checks, in order: approvals' canonical JSON accepts it; that JSON is at most 8000 UTF-16 code
/// units; then, depth first through keys in canonical order (UTF-16 code units, as JavaScript
/// sorts), each value is at most the 400th visited and at depth 6 or less, each string at most
/// 2000 code units and each key at most 200, and none hides characters. The first failure is the
/// refusal.
pub fn approval_display(input: &Value) -> ApprovalDisplay {
    let Ok(text) = crate::canonical::exact(input) else {
        return Err(ApprovalDisplayRefusal::NotJson);
    };
    if utf16_len(&text) > APPROVAL_DISPLAY_LIMITS.max_serialized_length {
        return Err(ApprovalDisplayRefusal::TooLong);
    }
    // Depth first with an explicit stack, so deep input cannot overflow the call stack. An
    // object's key is checked when its member is reached, just before the member.
    enum Item<'a> {
        Value(&'a Value, usize),
        Key(&'a str),
    }
    let mut visited = 0usize;
    let mut pending = vec![Item::Value(input, 0)];
    while let Some(item) = pending.pop() {
        let (value, depth) = match item {
            Item::Key(key) => {
                if utf16_len(key) > APPROVAL_DISPLAY_LIMITS.max_key_length {
                    return Err(ApprovalDisplayRefusal::KeyTooLong);
                }
                if hides_characters(key) {
                    return Err(ApprovalDisplayRefusal::HiddenCharacters);
                }
                continue;
            }
            Item::Value(value, depth) => (value, depth),
        };
        visited += 1;
        if visited > APPROVAL_DISPLAY_LIMITS.max_values {
            return Err(ApprovalDisplayRefusal::TooManyValues);
        }
        if depth > APPROVAL_DISPLAY_LIMITS.max_depth {
            return Err(ApprovalDisplayRefusal::TooDeep);
        }
        match value {
            Value::String(text) => {
                if utf16_len(text) > APPROVAL_DISPLAY_LIMITS.max_string_length {
                    return Err(ApprovalDisplayRefusal::StringTooLong);
                }
                if hides_characters(text) {
                    return Err(ApprovalDisplayRefusal::HiddenCharacters);
                }
            }
            Value::Array(items) => {
                pending.extend(items.iter().rev().map(|item| Item::Value(item, depth + 1)));
            }
            Value::Object(members) => {
                let mut keys: Vec<&String> = members.keys().collect();
                keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
                for key in keys.into_iter().rev() {
                    pending.push(Item::Value(&members[key.as_str()], depth + 1));
                    pending.push(Item::Key(key));
                }
            }
            _ => {}
        }
    }
    Ok(input.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn refuses_an_integer_a_float_cannot_hold() {
        let input: Value = serde_json::from_str(r#"{"n": 9007199254740993}"#).unwrap();
        assert_eq!(
            approval_display(&input),
            Err(ApprovalDisplayRefusal::NotJson)
        );
    }

    #[test]
    fn names_surrogates_hidden_and_shows_plain_input() {
        assert!(is_hidden_code_point(0xd800) && is_hidden_code_point(0xdfff));
        assert!(!hides_characters("🍅 café"));
        let input = json!({ "b": 1, "a": [true, null, "x"] });
        assert_eq!(approval_display(&input), Ok(input.clone()));
        assert_eq!(ApprovalDisplayRefusal::TooDeep.to_string(), "too-deep");
    }
}
