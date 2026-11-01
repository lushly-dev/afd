//! The language-neutral vectors in `spec/vectors/journal-context-cap.json`.
//!
//! `spec/vectors/generate-journal-context-cap.mjs` pads each value to a set number of bytes from
//! the journal's 4096-byte cap, measured as UTF-8 canonical JSON with numbers as JavaScript writes
//! them, and records what TypeScript keeps (`spec/journal.md`, "Declared context fields";
//! `spec/vectors/README.md`).

use std::path::PathBuf;

use afd::journal::{
    canonical_context_json, journal_context_fields, JournalContextFields, MAX_JOURNAL_CONTEXT_BYTES,
};
use afd::CommandContext;
use serde_json::{Map, Value};

fn load_vectors(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../spec/vectors")
        .join(name);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("{} is not valid JSON: {error}", path.display()))
}

#[test]
fn the_cap_measures_and_keeps_as_typescript_does() {
    let vectors = load_vectors("journal-context-cap.json");
    assert_eq!(vectors["maxBytes"], MAX_JOURNAL_CONTEXT_BYTES);
    let field = vectors["field"].as_str().unwrap();
    let cases = vectors["cases"].as_array().unwrap();
    assert!(!cases.is_empty());
    let mut failures = Vec::new();
    for case in cases {
        let description = case["description"].as_str().unwrap();
        // Parsed by serde_json, as a value from `_meta` would be.
        let value: Value = serde_json::from_str(case["json"].as_str().unwrap())
            .unwrap_or_else(|error| panic!("{description}: {error}"));
        let bytes = canonical_context_json(&value).len();
        if case["bytes"] != bytes {
            failures.push(format!(
                "{description}: measured {bytes} bytes, expected {}",
                case["bytes"]
            ));
        }

        let journaled = journal_context_fields(
            &CommandContext::new().with_extra(field, value.clone()),
            [field],
        );
        let expected = match case["expected"].as_str().unwrap() {
            "kept" => JournalContextFields {
                context: Some(Map::from_iter([(field.to_owned(), value)])),
                context_omitted: None,
            },
            _ => JournalContextFields {
                context: None,
                context_omitted: Some(vec![field.to_owned()]),
            },
        };
        if journaled != expected {
            failures.push(format!(
                "{description}: expected {}, {} bytes",
                case["expected"], case["bytes"]
            ));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}
