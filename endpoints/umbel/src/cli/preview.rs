//! The confirmation preview (phase 4 specification, sections 8.1 and 10.2, D97).
//!
//! A command of manifest version 4 may name, in `confirm_preview`, an `inspect` command of its
//! plugin that renders what a person is about to confirm. Before the command's confirmation
//! prompt the CLI:
//!
//! 1. calls the preview with **only the properties the preview's input schema declares**, taken
//!    from the gated call's input (so reject's `reason` never reaches it), under a **fresh trace
//!    id**, in the CLI principal's context **without the marks** (`dev.umbel/human-present` and
//!    `dev.umbel/human-confirmed`);
//! 2. at a terminal, shows its `preview` on stderr, each line prefixed `> `, with control
//!    characters (those [`sanitize`] removes), U+2028, U+2029 and the bidirectional controls
//!    removed, at most [`MAX_PREVIEW_CHARS`] characters, then `(N lines not shown)` when cut;
//! 3. then asks the static prompt.
//!
//! A preview that fails, or answers anything but `{ "preview": <string> }`, refuses the call
//! with `CONFIRMATION_PREVIEW_FAILED`, and nothing runs. Nothing changes on MCP.

use afd::{CommandError, CommandResult};
use serde_json::{Map, Value, json};

use super::terminal::sanitize;
use crate::host::Host;
use crate::logging;

/// The code of a refused call whose preview failed.
pub(crate) const CONFIRMATION_PREVIEW_FAILED: &str = "CONFIRMATION_PREVIEW_FAILED";
/// The most characters of a preview shown, not counting the `> ` prefixes and line ends.
pub(crate) const MAX_PREVIEW_CHARS: usize = 6000;

/// Run `preview`, the preview `command` declares, for the gated call's `input`, and answer the
/// text to show.
///
/// # Errors
/// `CONFIRMATION_PREVIEW_FAILED` when the preview fails or answers another shape.
pub(super) async fn run(
    host: &Host,
    command: &str,
    preview: &str,
    input: &Value,
) -> Result<String, Box<CommandError>> {
    let declared = declared_input(host, preview, input);
    // A context of its own: a fresh trace id, the CLI's principal, and neither mark.
    let context = host.cli_context();
    let trace = context.trace_id.clone();
    let started = std::time::Instant::now();
    let result = host
        .cli_client()
        .call(preview, declared, Some(context))
        .await;
    logging::log_call(
        preview,
        trace.as_deref(),
        started.elapsed().as_millis(),
        result.success,
    );
    match preview_text(&result) {
        Some(text) => Ok(render(text)),
        None => Err(Box::new(failed(command, preview, &result))),
    }
}

/// The properties of the gated call's input that the preview's input schema declares.
fn declared_input(host: &Host, preview: &str, input: &Value) -> Value {
    let declared: Vec<String> = host
        .registry()
        .get_tool(preview)
        .and_then(|tool| {
            tool.get("inputSchema")?
                .get("properties")?
                .as_object()
                .map(|properties| properties.keys().cloned().collect())
        })
        .unwrap_or_default();
    let kept: Map<String, Value> = input
        .as_object()
        .map(|given| {
            given
                .iter()
                .filter(|(key, _)| declared.contains(key))
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect()
        })
        .unwrap_or_default();
    Value::Object(kept)
}

/// The `preview` string of a successful result whose data is exactly `{ "preview": <string> }`.
fn preview_text(result: &CommandResult<Value>) -> Option<&str> {
    if !result.success {
        return None;
    }
    let data = result.data.as_ref()?.as_object()?;
    if data.len() != 1 {
        return None;
    }
    data.get("preview")?.as_str()
}

fn failed(command: &str, preview: &str, result: &CommandResult<Value>) -> CommandError {
    let cause = result
        .error
        .as_ref()
        .map_or_else(|| json!("PREVIEW_SHAPE"), |error| json!(error.code));
    let mut details = std::collections::HashMap::new();
    details.insert("command".into(), json!(command));
    details.insert("preview".into(), json!(preview));
    details.insert("cause".into(), cause);
    CommandError::new(
        CONFIRMATION_PREVIEW_FAILED,
        format!("'{command}' was not run: its confirmation preview '{preview}' failed"),
    )
    .with_suggestion(format!(
        "Run umbel call {preview} with the same input to see why, then run '{command}' again."
    ))
    .with_retryable(false)
    .with_details(details)
}

/// Whether `c` is a line or paragraph separator, or a bidirectional control: removed from a
/// preview, as they can make a line read differently from what it holds.
fn is_layout_control(c: char) -> bool {
    matches!(
        c,
        '\u{2028}'
            | '\u{2029}'
            | '\u{061c}'
            | '\u{200e}'
            | '\u{200f}'
            | '\u{202a}'..='\u{202e}'
            | '\u{2066}'..='\u{2069}'
    )
}

/// The preview as shown: sanitised, each line prefixed `> `, cut at [`MAX_PREVIEW_CHARS`]
/// characters, with `(N lines not shown)` after a cut (`(1 line not shown)` for one). Whole
/// lines are shown while they fit; a first line longer than the cap is cut at it.
pub(crate) fn render(text: &str) -> String {
    let clean: String = sanitize(text)
        .chars()
        .filter(|c| !is_layout_control(*c))
        .collect();
    let lines: Vec<&str> = clean.lines().collect();
    let mut out = String::new();
    let mut used = 0usize;
    let mut shown = 0usize;
    for line in &lines {
        let length = line.chars().count();
        if used + length > MAX_PREVIEW_CHARS {
            if shown == 0 {
                out.push_str("> ");
                out.extend(line.chars().take(MAX_PREVIEW_CHARS));
                out.push('\n');
                shown = 1;
            }
            break;
        }
        out.push_str("> ");
        out.push_str(line);
        out.push('\n');
        used += length;
        shown += 1;
    }
    match lines.len() - shown {
        0 => {}
        1 => out.push_str("(1 line not shown)\n"),
        hidden => out.push_str(&format!("({hidden} lines not shown)\n")),
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_are_prefixed_and_controls_removed() {
        let shown =
            render("a\u{1b}[31mred\u{1b}[0m\r\nb\u{2028}c\u{2029}\nd\u{202e}e\u{2066}f\u{200f}\n");
        assert_eq!(shown, "> ared\n> bc\n> def\n");
    }

    #[test]
    fn a_long_preview_is_cut_at_whole_lines_with_the_count() {
        let text: String = (0..200).map(|i| format!("{i:049}\n")).collect();
        let shown = render(&text);
        // 49 characters a line: 122 lines fit in 6000.
        assert_eq!(shown.lines().filter(|l| l.starts_with("> ")).count(), 122);
        assert!(shown.ends_with("(78 lines not shown)\n"), "{shown}");
        let one = "x".repeat(7000);
        let shown = render(&format!("{one}\nnext"));
        assert_eq!(
            shown,
            format!("> {}\n(1 line not shown)\n", "x".repeat(6000))
        );
    }

    #[test]
    fn an_exact_fit_is_not_cut() {
        let text = "y".repeat(MAX_PREVIEW_CHARS);
        assert_eq!(render(&text), format!("> {text}\n"));
        assert_eq!(render(""), "");
    }
}
