//! `afd::error_codes` is the shared catalog in `spec/vectors/error-codes.json`.

use std::path::PathBuf;

use afd::error_codes;

#[test]
fn error_codes_match_the_shared_catalog() {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/vectors/error-codes.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    let vector: serde_json::Value = serde_json::from_str(&text).expect("valid JSON");
    let expected: Vec<&str> = vector["codes"]
        .as_array()
        .expect("codes array")
        .iter()
        .map(|code| code.as_str().expect("string code"))
        .collect();
    // Rust has no reflection over a module's constants, so they are listed here; a code missing
    // from `error_codes` fails to compile, and a wrong value or order fails the comparison.
    let catalog = [
        error_codes::VALIDATION_ERROR,
        error_codes::INVALID_INPUT,
        error_codes::MISSING_REQUIRED_FIELD,
        error_codes::INVALID_FORMAT,
        error_codes::NOT_FOUND,
        error_codes::ALREADY_EXISTS,
        error_codes::CONFLICT,
        error_codes::UNAUTHORIZED,
        error_codes::FORBIDDEN,
        error_codes::TOKEN_EXPIRED,
        error_codes::RATE_LIMITED,
        error_codes::QUOTA_EXCEEDED,
        error_codes::SERVICE_UNAVAILABLE,
        error_codes::TIMEOUT,
        error_codes::CONNECTION_ERROR,
        error_codes::INTERNAL_ERROR,
        error_codes::NOT_IMPLEMENTED,
        error_codes::UNKNOWN_ERROR,
        error_codes::COMMAND_NOT_FOUND,
        error_codes::INVALID_COMMAND_ARGS,
        error_codes::COMMAND_CANCELLED,
        error_codes::COMMAND_EXECUTION_ERROR,
        error_codes::COMMAND_NOT_EXPOSED,
        error_codes::COMMAND_NOT_IN_CONTEXT,
        error_codes::COMMAND_NOT_ALLOWED,
        error_codes::UNKNOWN_TOOL,
        error_codes::AMBIGUOUS_ACTION,
        error_codes::INVALID_GROUPED_CALL,
        error_codes::SESSION_REQUIRED,
        error_codes::CONTEXT_NOT_FOUND,
        error_codes::CONTEXT_DEPTH_EXCEEDED,
        error_codes::INVALID_BATCH_REQUEST,
        error_codes::BATCH_TIMEOUT,
        error_codes::COMMAND_SKIPPED,
        error_codes::INVALID_PIPELINE_REQUEST,
        error_codes::PIPELINE_TIMEOUT,
        error_codes::UNSUPPORTED_OPTION,
        error_codes::STREAM_ABORTED,
        error_codes::STREAM_TIMEOUT,
        error_codes::STREAM_ERROR,
        error_codes::STREAM_ENDED_UNEXPECTEDLY,
        error_codes::COMMAND_FAILED,
    ];
    assert_eq!(catalog.as_slice(), expected.as_slice());
}
