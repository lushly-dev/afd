//! Locators (specification section 8.3, decision D61): the stable address of a hit.
//!
//! The locator **string** is `umbel-okf`'s ([`umbel_okf::locator`]), shared with the context
//! plugin; the locator **object** of `knowledge-search`'s detailed format is the index's, and
//! stays here.

use serde_json::{Value, json};

pub(crate) use umbel_okf::locator::{parse, short, string};

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
