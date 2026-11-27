//! The language-neutral vectors in `spec/vectors/journal-seams.json`: the dispatch id
//! (`spec/dispatch.md`, "The dispatch id") and the approval summary (`spec/command-metadata.md`,
//! "The approval summary").
//!
//! Rust implements neither yet. The file lists Rust in its `gaps`, and every case is skipped here
//! as that documented gap until Rust implements them and leaves the list
//! (<https://github.com/lushly-dev/afd/issues/2681>).

use std::path::PathBuf;

use serde_json::Value;

const GAP: &str = "https://github.com/lushly-dev/afd/issues/2681";

fn vectors() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../spec/vectors")
        .join("journal-seams.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("{} is not valid JSON: {error}", path.display()))
}

fn cases<'a>(vectors: &'a Value, section: &str) -> &'a Vec<Value> {
    vectors[section]["cases"]
        .as_array()
        .unwrap_or_else(|| panic!("{section}.cases"))
}

#[test]
fn rust_is_a_documented_gap() {
    // When Rust implements the dispatch id and the approval summary, it leaves `gaps` and the
    // tests below run the cases instead of skipping them.
    let vectors = vectors();
    assert_eq!(vectors["gaps"]["rust"].as_str(), Some(GAP));
}

#[test]
fn the_id_format_is_stated() {
    let vectors = vectors();
    let format = &vectors["dispatchId"]["format"];
    assert_eq!(format["length"], 22);
    assert_eq!(format["pattern"], "^[A-Za-z0-9_-]{21}[AQgw]$");
}

#[test]
fn dispatch_id_cases_are_skipped_as_the_gap() {
    let vectors = vectors();
    let cases = cases(&vectors, "dispatchId");
    assert!(!cases.is_empty());
    for case in cases {
        assert!(case["run"].is_object() && case["expect"].is_object());
        eprintln!(
            "skipped: {} (documented Rust gap, {GAP})",
            case["description"].as_str().expect("description")
        );
    }
}

#[test]
fn approval_summary_cases_are_skipped_as_the_gap() {
    let vectors = vectors();
    let cases = cases(&vectors, "approvalSummary");
    assert!(!cases.is_empty());
    for case in cases {
        assert!(case["run"].is_object() && case["expect"].is_object());
        eprintln!(
            "skipped: {} (documented Rust gap, {GAP})",
            case["description"].as_str().expect("description")
        );
    }
}
