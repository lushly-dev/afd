//! Specification-authored execution-controls vectors (`spec/vectors/execution-controls.json`;
//! `spec/execution-controls.md`, #1737).
//!
//! Runs the per-call deadline vector on Tokio's paused clock (with the `native` feature) and
//! verifies that remaining Rust gaps stay documented in `gaps.rust` (#2130).

use serde_json::{json, Value};
use std::path::PathBuf;

fn load_vectors() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../spec/vectors/execution-controls.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("{} is not valid JSON: {error}", path.display()))
}

#[test]
fn defaults_and_documented_gaps_match_spec() {
    let vectors = load_vectors();
    assert_eq!(
        vectors["defaults"],
        json!({
            "defaultTimeoutMs": 30000,
            "maxBatchSize": 500,
            "maxBatchParallelism": 16,
            "maxValidationIssues": 100,
        })
    );
    assert_eq!(
        vectors["gaps"]["rust"],
        json!({
            "deadlineSignal": "https://github.com/lushly-dev/afd/issues/2130",
            "defaultDeadline": "https://github.com/lushly-dev/afd/issues/2130",
            "singleCancellation": "https://github.com/lushly-dev/afd/issues/2130",
            "batchCancellation": "https://github.com/lushly-dev/afd/issues/2130",
            "batchLimits": "https://github.com/lushly-dev/afd/issues/2130",
            "validationIssueCap": "https://github.com/lushly-dev/afd/issues/2130",
        })
    );
    let gaps = vectors["gaps"]["rust"]
        .as_object()
        .expect("gaps.rust is an object");
    for case in vectors["cases"].as_array().expect("cases is an array") {
        let control = case["control"].as_str().expect("case control is a string");
        let executed = control == "deadline";
        let gapped = gaps.contains_key(control);
        assert!(
            executed ^ gapped,
            "control `{control}` must be either executed or listed in gaps.rust"
        );
    }
}

#[cfg(feature = "native")]
#[tokio::test(start_paused = true)]
async fn per_call_deadline_times_out_with_retryable_timeout() {
    use afd::{
        success, CommandContext, CommandDefinition, CommandHandler, CommandRegistry, CommandResult,
    };
    use async_trait::async_trait;
    use std::time::Duration;

    struct SlowHandler {
        delay_ms: u64,
    }

    #[async_trait]
    impl CommandHandler for SlowHandler {
        async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
            tokio::time::sleep(Duration::from_millis(self.delay_ms)).await;
            success(json!({ "done": true }))
        }
    }

    let vectors = load_vectors();
    let case = vectors["cases"]
        .as_array()
        .expect("cases is an array")
        .iter()
        .find(|entry| entry["id"] == "per-call-deadline-timeout")
        .expect("per-call-deadline-timeout case exists");

    let command_name = case["call"]["command"].as_str().unwrap();
    let timeout_ms = case["call"]["timeoutMs"].as_u64().unwrap();
    let delay_ms = case["call"]["handler"]["delayMs"].as_u64().unwrap();

    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            command_name,
            "Slow handler for deadline vector",
            vec![],
            SlowHandler { delay_ms },
        ))
        .expect("register slow handler");

    let result = registry
        .execute(
            command_name,
            json!({}),
            Some(CommandContext::new().with_timeout(timeout_ms)),
        )
        .await;

    assert_eq!(result.success, case["expect"]["success"].as_bool().unwrap());
    let err = result.error.expect("expected TIMEOUT error");
    assert_eq!(err.code, case["expect"]["code"].as_str().unwrap());
    assert_eq!(err.retryable, case["expect"]["retryable"].as_bool());
}
