//! The `generic` profile (section 10.3): for a harness a deployer wires up themselves, and for a
//! CI step or a person. A capture event reads the capture contract on stdin and forwards it
//! unchanged to `memory-capture`, which validates it; `session-start` prints the bundle's text
//! plainly. Cursor stays here: its deployer sends the contract themselves (W18).

use std::io::Write;
use std::time::Duration;

use serde_json::{Value, json};

use crate::Environment;
use crate::child;
use crate::failure::{Failure, Outcome};

/// The contract's events (section 10.1).
const CAPTURE_EVENTS: [&str; 5] = ["tool-use", "stop", "pre-compact", "session-end", "manual"];
/// A call's limit.
const TIMEOUT: Duration = Duration::from_secs(25);
/// The bundle's default `maxChars`.
const BUNDLE_CHARS: u64 = 9000;

fn object(input: &[u8], empty_is_object: bool) -> Result<Value, Failure> {
    if empty_is_object && input.iter().all(u8::is_ascii_whitespace) {
        return Ok(json!({}));
    }
    match serde_json::from_slice::<Value>(input) {
        Ok(value) if value.is_object() => Ok(value),
        _ => Err(Failure::new(
            "invalid-stdin",
            "stdin is not one JSON object",
        )),
    }
}

pub(crate) fn run(
    event: &str,
    sweep: bool,
    input: &[u8],
    environment: &Environment,
    stdout: &mut dyn Write,
) -> Outcome {
    if event == "session-start" {
        if sweep {
            return Err(Failure::new(
                "invalid-arguments",
                "--sweep is for session-end only",
            ));
        }
        // Optional `space`, `project`, `session` and `task`, as context-bundle takes them.
        let given = object(input, true)?;
        let mut bundle = json!({ "render": "text", "maxChars": BUNDLE_CHARS });
        for key in ["space", "project", "session", "task"] {
            if let Some(value) = given.get(key).filter(|value| value.is_string()) {
                bundle[key] = value.clone();
            }
        }
        if bundle.get("task").is_none()
            && let Some(task) = environment.task.as_deref().filter(|t| !t.trim().is_empty())
        {
            bundle["task"] = json!(task.trim().chars().take(4000).collect::<String>());
        }
        let data = child::call(environment, "context-bundle", &bundle, TIMEOUT)?;
        if let Some(text) = data.get("text").and_then(Value::as_str) {
            let _ = writeln!(stdout, "{text}");
        }
        return Ok(None);
    }
    if !CAPTURE_EVENTS.contains(&event) {
        return Err(Failure::new(
            "invalid-arguments",
            "the generic events are session-start, tool-use, stop, pre-compact, session-end and manual",
        ));
    }
    if sweep && event != "session-end" {
        return Err(Failure::new(
            "invalid-arguments",
            "--sweep is for session-end only",
        ));
    }
    let contract = object(input, false)?;
    child::call(environment, "memory-capture", &contract, TIMEOUT)?;
    if sweep {
        child::call(environment, "memory-sweep", &json!({}), TIMEOUT)?;
    }
    Ok(None)
}
