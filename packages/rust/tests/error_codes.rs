//! `afd::error_codes`, `afd::ERROR_CODE_CATALOG` and `afd::HOST_ERROR_CODE_PREFIX` match the
//! shared catalog in `spec/vectors/error-codes.json` (`spec/error-codes.md`).

use std::collections::HashMap;
use std::path::PathBuf;

use afd::{
    error_codes, not_found_error, rate_limit_error, timeout_error, validation_error,
    ERROR_CODE_CATALOG, HOST_ERROR_CODE_PREFIX,
};

#[test]
fn error_codes_match_the_shared_catalog() {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/vectors/error-codes.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    let vector: serde_json::Value = serde_json::from_str(&text).expect("valid JSON");
    let entries = vector["codes"].as_array().expect("codes array");
    let expected_codes: Vec<&str> = entries
        .iter()
        .map(|entry| entry["code"].as_str().expect("string code"))
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
        error_codes::CONFIRMATION_REQUIRED,
        error_codes::CONFIRMATION_DECLINED,
        error_codes::APPROVAL_REQUIRED,
        error_codes::APPROVAL_UNAVAILABLE,
        error_codes::OUTPUT_BUDGET_EXCEEDED,
        error_codes::INSUFFICIENT_SCOPE,
        error_codes::TASK_TOKEN_EXPIRED,
        error_codes::CALL_NOT_GRANTED,
        error_codes::IDEMPOTENCY_KEY_REUSED,
        error_codes::IDEMPOTENCY_IN_PROGRESS,
        error_codes::OUTCOME_UNKNOWN,
    ];
    assert_eq!(catalog.as_slice(), expected_codes.as_slice());

    // Check every entry's `{ code, retryable, profile }`.
    assert_eq!(ERROR_CODE_CATALOG.len(), entries.len());
    let mut by_code = HashMap::new();
    for (actual, expected) in ERROR_CODE_CATALOG.iter().zip(entries.iter()) {
        let code = expected["code"].as_str().expect("code");
        let retryable = match &expected["retryable"] {
            serde_json::Value::Bool(value) => Some(*value),
            serde_json::Value::String(value) if value == "varies" => None,
            other => panic!("unexpected retryable for {code}: {other}"),
        };
        let profile = expected["profile"].as_str().expect("profile");
        assert_eq!(actual.code, code);
        assert_eq!(actual.retryable, retryable, "retryable for {code}");
        assert_eq!(actual.profile, profile, "profile for {code}");
        by_code.insert(code, retryable);
    }

    // Reserved host prefix.
    assert_eq!(
        HOST_ERROR_CODE_PREFIX,
        vector["hostPrefix"].as_str().expect("hostPrefix")
    );
    for code in &expected_codes {
        assert!(
            !code.starts_with(HOST_ERROR_CODE_PREFIX),
            "catalog code {code} must not use reserved host prefix {HOST_ERROR_CODE_PREFIX}"
        );
    }

    // Core helpers match the catalog retryability.
    assert_eq!(
        validation_error("bad", None).retryable,
        by_code["VALIDATION_ERROR"]
    );
    assert_eq!(not_found_error("Doc", "1").retryable, by_code["NOT_FOUND"]);
    assert_eq!(
        rate_limit_error(Some(10)).retryable,
        by_code["RATE_LIMITED"]
    );
    assert_eq!(timeout_error("op", 100).retryable, by_code["TIMEOUT"]);
}
