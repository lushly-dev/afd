//! One problem a reader found: its code, the file and, when it is at one place in the file, a
//! JSON Pointer. Nothing from a file's content is ever in a problem (specification, section 3.3).

use serde_json::{Value, json};

/// At most this many problems in a failure's details; `count` says how many there were.
pub(crate) const MAX_SHOWN: usize = 32;

pub(crate) const LAYOUT_INVALID: &str = "LAYOUT_INVALID";
pub(crate) const JSON_INVALID: &str = "JSON_INVALID";
pub(crate) const FORMAT_UNSUPPORTED: &str = "FORMAT_UNSUPPORTED";
pub(crate) const SCHEMA_INVALID: &str = "SCHEMA_INVALID";
pub(crate) const IDENTIFIER_INVALID: &str = "IDENTIFIER_INVALID";
pub(crate) const TEXT_TOO_LONG: &str = "TEXT_TOO_LONG";
pub(crate) const TEXT_INVALID: &str = "TEXT_INVALID";
pub(crate) const NOT_CANONICAL: &str = "NOT_CANONICAL";
pub(crate) const DUPLICATE_ID: &str = "DUPLICATE_ID";
pub(crate) const RULE_UNKNOWN: &str = "RULE_UNKNOWN";
pub(crate) const TAG_UNKNOWN: &str = "TAG_UNKNOWN";
pub(crate) const TAG_MISMATCH: &str = "TAG_MISMATCH";
pub(crate) const LIBRARY_MISMATCH: &str = "LIBRARY_MISMATCH";
pub(crate) const PREFIX_MISMATCH: &str = "PREFIX_MISMATCH";
pub(crate) const CATALOG_MISMATCH: &str = "CATALOG_MISMATCH";
pub(crate) const DIGEST_MISMATCH: &str = "DIGEST_MISMATCH";
/// The plugin's own code, outside the format's sixteen (section 3.4).
pub(crate) const FILE_TOO_LARGE: &str = "FILE_TOO_LARGE";

/// One problem.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Problem {
    // The derived order is the order they are reported in: path, then pointer (absent first),
    // then code.
    pub(crate) path: String,
    pub(crate) at: Option<String>,
    pub(crate) code: &'static str,
}

impl Problem {
    pub(crate) fn new(code: &'static str, path: impl Into<String>, at: Option<String>) -> Self {
        Self {
            path: path.into(),
            at,
            code,
        }
    }

    pub(crate) fn to_json(&self) -> Value {
        match &self.at {
            Some(at) => json!({ "code": self.code, "path": self.path, "at": at }),
            None => json!({ "code": self.code, "path": self.path }),
        }
    }
}

/// The problems in reporting order, at most [`MAX_SHOWN`] of them as JSON.
pub(crate) fn shown(problems: &[Problem]) -> Value {
    Value::Array(
        problems
            .iter()
            .take(MAX_SHOWN)
            .map(Problem::to_json)
            .collect(),
    )
}
