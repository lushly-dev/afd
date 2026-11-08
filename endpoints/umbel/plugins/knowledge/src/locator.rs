//! Locators (specification section 8.3, decision D61): the stable address of a hit.
//!
//! The locator **string** is `umbel-okf`'s ([`umbel_okf::locator`]), shared with the context
//! plugin; the locator **object** of `knowledge-search`'s detailed format is the index's, and
//! stays here.

use serde_json::{Value, json};

pub(crate) use umbel_okf::locator::{parse, short, string};

/// The locator object: version 1 (`schemas/locator.v1.json`) with the applied revision as a
/// number, or, when the host gave `applied` sealed (phase 5 section 9.3), version 2
/// (`schemas/locator.v2.json`), `<space>@r1.<token>/<schema>`.
pub(crate) fn object(
    space: &str,
    doc: &str,
    chunk: u32,
    lines: (u32, u32),
    heading_path: &[String],
    hash: &str,
    applied: &Value,
) -> Value {
    let (version, applied) = match applied {
        Value::String(sealed) => (2, sealed.clone()),
        other => (1, other.as_u64().unwrap_or(0).to_string()),
    };
    json!({
        "version": version,
        "space": space,
        "doc": doc,
        "chunk": chunk,
        "lines": { "start": lines.0, "end": lines.1 },
        "headingPath": heading_path,
        "contentHash": hash,
        "indexVersion": format!("{space}@{applied}/{}", crate::INDEX_SCHEMA),
    })
}
