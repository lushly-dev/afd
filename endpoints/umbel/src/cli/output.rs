//! What the CLI prints: a result as JSON (the default) or as the AFD CLI's text layout.
//!
//! JSON mode prints exactly one document, two-space indented, with a final newline, and needs no
//! cleaning because JSON escapes control characters. Text mode passes every string taken from a
//! result through [`sanitize`](super::terminal::sanitize).

use super::terminal::sanitize;
use afd::{CommandError, CommandResult, failure};
use serde::Serialize;
use serde_json::Value;

/// `--format`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum Format {
    /// One JSON document on stdout.
    #[default]
    Json,
    /// The AFD CLI's text layout.
    Text,
}

/// A value as pretty JSON with two-space indentation and a final newline.
pub(crate) fn json_document<T: Serialize>(value: &T) -> String {
    let mut out = serde_json::to_string_pretty(value).unwrap_or_else(|_| "null".to_owned());
    out.push('\n');
    out
}

fn text(value: &Value) -> String {
    match value {
        Value::String(s) => sanitize(s),
        other => sanitize(&other.to_string()),
    }
}

/// A value for display: strings print as they are, anything else as indented JSON.
fn format_value(value: &Value) -> String {
    match value {
        Value::String(s) => sanitize(s),
        other => sanitize(&serde_json::to_string_pretty(other).unwrap_or_default()),
    }
}

fn error_summary(error: &Value) -> String {
    let code = error.get("code").map(text).unwrap_or_default();
    let message = error.get("message").map(text).unwrap_or_default();
    sanitize(&format!("[{code}] {message}"))
}

/// A 10-cell bar and a percentage, such as `████████░░ 80%`.
fn confidence(value: f64) -> String {
    let clamped = if value.is_nan() {
        0.0
    } else {
        value.clamp(0.0, 1.0)
    };
    let filled = (clamped * 10.0).round() as usize;
    format!(
        "{}{} {}%",
        "█".repeat(filled),
        "░".repeat(10 - filled),
        (value * 100.0).round()
    )
}

/// The AFD CLI's text layout of one `CommandResult` (already serialized).
pub(crate) fn result_text(result: &Value) -> String {
    let mut out = String::new();
    if result.get("success") == Some(&Value::Bool(true)) {
        out.push_str("✓ Success\n");
        if let Some(data) = result.get("data") {
            out.push_str("\nData:\n");
            out.push_str(&format_value(data));
            out.push('\n');
        }
        if let Some(c) = result.get("confidence").and_then(Value::as_f64) {
            out.push_str(&format!("\nConfidence: {}\n", confidence(c)));
        }
        if let Some(warnings) = result.get("warnings").and_then(Value::as_array) {
            if !warnings.is_empty() {
                out.push('\n');
            }
            for warning in warnings {
                let message = warning.get("message").map(text).unwrap_or_default();
                out.push_str(&format!("⚠ {message}\n"));
            }
        }
    } else {
        out.push_str("✗ Failed\n");
        let fallback;
        let error = match result.get("error") {
            Some(error) => error,
            None => {
                fallback = serde_json::json!({
                    "code": "UNKNOWN_ERROR",
                    "message": "The command failed without error details",
                });
                &fallback
            }
        };
        out.push_str(&format!("\nError: {}\n", error_summary(error)));
        if let Some(suggestion) = error.get("suggestion").filter(|s| !s.is_null()) {
            out.push_str(&format!("\nSuggestion: {}\n", text(suggestion)));
        }
        if error.get("retryable") == Some(&Value::Bool(true)) {
            out.push_str("(This error may be resolved by retrying)\n");
        }
    }
    out
}

/// The AFD CLI's text layout of one batch result (already serialized).
pub(crate) fn batch_text(result: &Value) -> String {
    let count = |path: &str| -> u64 {
        result
            .get("summary")
            .and_then(|summary| summary.get(path))
            .and_then(Value::as_u64)
            .unwrap_or(0)
    };
    let failed = count("failureCount");
    let mut out = String::new();
    if result.get("success") == Some(&Value::Bool(true)) && failed == 0 {
        out.push_str("✓ Batch completed successfully\n");
    } else if result.get("success") == Some(&Value::Bool(true)) {
        out.push_str("⚠ Batch completed with partial failures\n");
    } else {
        out.push_str("✗ Batch failed\n");
    }
    out.push_str("\nSummary:\n");
    out.push_str(&format!("  Total:    {}\n", count("total")));
    out.push_str(&format!("  Success:  {}\n", count("successCount")));
    if failed > 0 {
        out.push_str(&format!("  Failed:   {failed}\n"));
    }
    if count("skippedCount") > 0 {
        out.push_str(&format!("  Skipped:  {}\n", count("skippedCount")));
    }
    if let Some(timing) = result.get("timing") {
        let total = timing.get("totalMs").map(text).unwrap_or_default();
        let average = timing
            .get("averageMs")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        out.push_str(&format!(
            "\nTiming:\n  Total:    {total}ms\n  Average:  {average:.1}ms/command\n"
        ));
    }
    if let Some(c) = result.get("confidence").and_then(Value::as_f64) {
        out.push_str(&format!("\nConfidence: {}\n", confidence(c)));
    }
    if let Some(reasoning) = result.get("reasoning").filter(|r| !r.is_null()) {
        out.push_str(&format!("  {}\n", text(reasoning)));
    }
    if let Some(warnings) = result.get("warnings").and_then(Value::as_array) {
        if !warnings.is_empty() {
            out.push_str("\nWarnings:\n");
        }
        for warning in warnings {
            let field = |name: &str| warning.get(name).map(text).unwrap_or_default();
            out.push_str(&format!(
                "  ⚠ {}\n",
                sanitize(&format!(
                    "[{}] {} ({})",
                    field("code"),
                    field("message"),
                    field("commandId")
                ))
            ));
        }
    }
    if let Some(error) = result.get("error").filter(|e| !e.is_null()) {
        out.push_str(&format!("\nError: {}\n", error_summary(error)));
        if let Some(suggestion) = error.get("suggestion").filter(|s| !s.is_null()) {
            out.push_str(&format!("\nSuggestion: {}\n", text(suggestion)));
        }
    }
    out
}

/// A failure result for something that went wrong before a command ran (usage, workspace).
pub(crate) fn pre_run_failure(code: &str, message: &str, suggestion: &str) -> CommandResult<Value> {
    failure(CommandError::new(code, message).with_suggestion(suggestion))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn json_is_two_space_indented_with_a_final_newline() {
        let out = json_document(&json!({"a": [1]}));
        assert_eq!(out, "{\n  \"a\": [\n    1\n  ]\n}\n");
    }

    #[test]
    fn a_success_prints_its_data_and_warnings() {
        let out = result_text(&json!({
            "success": true,
            "data": {"k": "v"},
            "confidence": 0.8,
            "warnings": [{"code": "W", "message": "careful"}],
        }));
        assert_eq!(
            out,
            "✓ Success\n\nData:\n{\n  \"k\": \"v\"\n}\n\nConfidence: ████████░░ 80%\n\n⚠ careful\n"
        );
    }

    #[test]
    fn a_failure_prints_code_message_suggestion_and_retry_hint() {
        let out = result_text(&json!({
            "success": false,
            "error": {"code": "X", "message": "bad", "suggestion": "fix it", "retryable": true},
        }));
        assert_eq!(
            out,
            "✗ Failed\n\nError: [X] bad\n\nSuggestion: fix it\n(This error may be resolved by retrying)\n"
        );
    }

    #[test]
    fn text_mode_strips_escape_sequences_from_every_string() {
        let out = result_text(&json!({
            "success": false,
            "error": {"code": "X", "message": "a\u{1b}]0;title\u{7}b", "suggestion": "\u{1b}[31mred"},
        }));
        assert!(!out.contains('\u{1b}'), "{out:?}");
        assert!(out.contains("[X] ab"));
        assert!(out.contains("Suggestion: red"));
        let data = result_text(&json!({"success": true, "data": "x\u{1b}[2Ky"}));
        assert!(data.contains("\nxy\n"), "{data:?}");
    }

    #[test]
    fn a_failure_without_an_error_gets_a_placeholder() {
        let out = result_text(&json!({"success": false}));
        assert!(out.contains("[UNKNOWN_ERROR]"));
    }

    #[test]
    fn a_batch_prints_its_summary() {
        let out = batch_text(&json!({
            "success": true,
            "summary": {"total": 2, "successCount": 1, "failureCount": 1, "skippedCount": 0},
            "timing": {"totalMs": 5, "averageMs": 2.5},
            "confidence": 0.5,
            "reasoning": "half",
        }));
        assert!(out.starts_with("⚠ Batch completed with partial failures\n"));
        assert!(out.contains("  Failed:   1\n"));
        assert!(out.contains("Average:  2.5ms/command"));
    }
}
