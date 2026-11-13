//! `umbel-scan` over identifiers (a hit refuses them) and over served text (a hit flags it, and
//! never blocks it; D67, sections 3.2 and 5.6 of the specification).

use serde_json::{Map, Value};
use umbel_scan::scan_content;

/// Whether an identifier, its separators read as spaces, reads as an instruction.
pub(crate) fn identifier_hit(identifier: &str) -> bool {
    let words = identifier.replace(['-', '.', '_'], " ");
    scan_content(&words).is_instruction_like()
}

/// Whether a path shown outside the content part, its `/` read as a space too, reads as an
/// instruction.
pub(crate) fn path_hit(path: &str) -> bool {
    identifier_hit(&path.replace('/', " "))
}

/// The flags of a string that is served.
pub(crate) fn text_flags(text: &str) -> Vec<&'static str> {
    let scan = scan_content(text);
    let mut flags = Vec::new();
    if scan.is_instruction_like() {
        flags.push("instruction-like");
    }
    if scan.has_hidden_text() {
        flags.push("hidden-text");
    }
    flags
}

fn collect(value: &Value, flags: &mut Vec<&'static str>) {
    match value {
        Value::String(text) => {
            for flag in text_flags(text) {
                if !flags.contains(&flag) {
                    flags.push(flag);
                }
            }
        }
        Value::Array(items) => items.iter().for_each(|item| collect(item, flags)),
        Value::Object(map) => map.values().for_each(|item| collect(item, flags)),
        _ => {}
    }
}

/// `flags` in the fixed order: `instruction-like`, then `hidden-text`.
pub(crate) fn ordered(flags: &[&'static str]) -> Vec<&'static str> {
    ["instruction-like", "hidden-text"]
        .into_iter()
        .filter(|flag| flags.contains(flag))
        .collect()
}

/// Adds `flags` to `item` when any string in it is flagged, and says whether it did.
pub(crate) fn flag_item(item: &mut Map<String, Value>) -> bool {
    let mut flags = Vec::new();
    for value in item.values() {
        collect(value, &mut flags);
    }
    if flags.is_empty() {
        return false;
    }
    item.insert("flags".to_owned(), Value::from(ordered(&flags)));
    true
}
