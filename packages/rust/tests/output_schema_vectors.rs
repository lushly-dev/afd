//! `spec/vectors/output-schema.json`: the CommandResult envelope a command tool advertises as its
//! top-level `outputSchema` (`spec/command-metadata.md`, "Structured results").

use std::path::PathBuf;

use afd::commands::command_result_output_schema;
use serde_json::Value;

#[test]
fn every_envelope_matches_typescript() {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/vectors/output-schema.json");
    let vectors: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let cases = vectors["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 11);
    for case in cases {
        assert_eq!(
            command_result_output_schema(&case["dataSchema"]),
            case["outputSchema"],
            "{}",
            case["description"]
        );
    }
}
