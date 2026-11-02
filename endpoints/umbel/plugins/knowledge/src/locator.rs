//! Locators (specification section 8.3, decision D61): the stable address of a hit.
//!
//! The locator **string** is `umbel:<space>/<doc>#L<start>-L<end>@<first 12 hex of the content
//! hash>`. It stays valid while the document's content hash is the same; when it differs,
//! `knowledge-open` serves the current content with the warning `DOCUMENT_CHANGED`.

use serde_json::{Value, json};

/// A parsed locator string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Parsed {
    pub(crate) space: String,
    pub(crate) doc: String,
    pub(crate) start: u32,
    pub(crate) end: u32,
    /// The first 12 hex digits of the content hash.
    pub(crate) hash12: String,
}

/// The locator string of lines `start..=end` of `doc`, whose content hash is `hash`
/// (`sha256:<hex>`).
pub(crate) fn string(space: &str, doc: &str, start: u32, end: u32, hash: &str) -> String {
    format!("umbel:{space}/{doc}#L{start}-L{end}@{}", short(hash))
}

/// The first 12 hex digits of a `sha256:<hex>` hash.
pub(crate) fn short(hash: &str) -> &str {
    let hex = hash.strip_prefix("sha256:").unwrap_or(hash);
    hex.get(..12).unwrap_or(hex)
}

/// The locator object (`schemas/locator.v1.json`). `index` is `(applied, schema)`.
pub(crate) fn object(
    space: &str,
    doc: &str,
    chunk: u32,
    lines: (u32, u32),
    heading_path: &[String],
    hash: &str,
    applied: u64,
) -> Value {
    json!({
        "version": 1,
        "space": space,
        "doc": doc,
        "chunk": chunk,
        "lines": { "start": lines.0, "end": lines.1 },
        "headingPath": heading_path,
        "contentHash": hash,
        "indexVersion": format!("{space}@{applied}/1"),
    })
}

/// Parse a locator string; `None` when it is not one.
pub(crate) fn parse(text: &str) -> Option<Parsed> {
    let rest = text.strip_prefix("umbel:")?;
    let (path, tail) = rest.rsplit_once("#L")?;
    let (space, doc) = path.split_once('/')?;
    let (range, hash12) = tail.split_once('@')?;
    let (start, end) = range.split_once("-L")?;
    let start: u32 = start.parse().ok()?;
    let end: u32 = end.parse().ok()?;
    let valid_hash = hash12.len() == 12
        && hash12
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    if space.is_empty() || doc.is_empty() || start == 0 || end < start || !valid_hash {
        return None;
    }
    Some(Parsed {
        space: space.to_owned(),
        doc: doc.to_owned(),
        start,
        end,
        hash12: hash12.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_locator_string_round_trips() {
        let hash = "sha256:9f2c1a7b0d3e0000000000000000000000000000000000000000000000000000";
        let text = string("main", "handbook/deploy/rollback", 12, 40, hash);
        assert_eq!(
            text,
            "umbel:main/handbook/deploy/rollback#L12-L40@9f2c1a7b0d3e"
        );
        let parsed = parse(&text).expect("parses");
        assert_eq!(parsed.space, "main");
        assert_eq!(parsed.doc, "handbook/deploy/rollback");
        assert_eq!((parsed.start, parsed.end), (12, 40));
        assert_eq!(parsed.hash12, "9f2c1a7b0d3e");
    }

    #[test]
    fn text_that_is_not_a_locator_does_not_parse() {
        for text in [
            "",
            "main/handbook/a",
            "umbel:main/handbook/a",
            "umbel:main/handbook/a#L1-L2",
            "umbel:main/handbook/a#L0-L2@9f2c1a7b0d3e",
            "umbel:main/handbook/a#L5-L2@9f2c1a7b0d3e",
            "umbel:main/handbook/a#L1-L2@9F2C1A7B0D3E",
            "umbel:main/handbook/a#L1-L2@abc",
            "umbel:/a#L1-L2@9f2c1a7b0d3e",
        ] {
            assert!(parse(text).is_none(), "{text}");
        }
    }
}
