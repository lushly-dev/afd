//! The language-neutral vectors in `spec/vectors/idempotency.json`: idempotency keys
//! (`spec/idempotency.md`).
//!
//! Rust implements none of it yet. The file lists Rust in its `gaps`, and every case is skipped
//! here as that documented gap until Rust implements it and leaves the list
//! (<https://github.com/lushly-dev/afd/issues/2676>).

use std::path::PathBuf;

use serde_json::Value;

const GAP: &str = "https://github.com/lushly-dev/afd/issues/2676";

/// Each section's name and the path to its array of cases.
const SECTIONS: [(&str, &[&str]); 9] = [
    ("declaration", &["declaration", "cases"]),
    ("key.form", &["key", "form"]),
    ("key.derived", &["key", "derived"]),
    ("key.delivery", &["key", "delivery"]),
    ("step", &["step", "cases"]),
    ("step.options", &["step", "options"]),
    ("retry", &["retry", "cases"]),
    ("timeoutRecovery", &["timeoutRecovery", "cases"]),
    ("journal", &["journal", "cases"]),
];

fn vectors() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../spec/vectors")
        .join("idempotency.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("{} is not valid JSON: {error}", path.display()))
}

#[test]
fn rust_is_a_documented_gap() {
    // When Rust implements idempotency keys, it leaves `gaps` and the test below runs the cases
    // instead of skipping them.
    let vectors = vectors();
    assert_eq!(vectors["gaps"]["rust"].as_str(), Some(GAP));
    assert_eq!(vectors["metaKey"], "dev.afd/idempotencyKey");
}

#[test]
fn every_case_is_skipped_as_the_gap() {
    let vectors = vectors();
    for (name, path) in SECTIONS {
        let mut section = &vectors;
        for key in path {
            section = &section[*key];
        }
        let cases = section
            .as_array()
            .unwrap_or_else(|| panic!("{name} is not an array"));
        assert!(!cases.is_empty(), "{name} has no cases");
        for case in cases {
            assert!(
                case.is_object(),
                "{name} holds a case that is not an object"
            );
            let title = case["description"]
                .as_str()
                .or_else(|| case["expected"].as_str())
                .unwrap_or_else(|| panic!("{name} holds a case with no title"));
            eprintln!("skipped: {name}: {title} (documented Rust gap, {GAP})");
        }
    }
}
