//! A command's input on stdin (phase 3 specification, section 10.6): one word, `@-`, as the whole
//! input reads one JSON object from stdin, up to 16 MiB. A transcript window does not fit in one
//! argument (Linux caps one at 128 KiB).

use afd::{CommandError, error_codes};
use serde_json::Value;

use super::prompt::Console;

/// The word that means "read the input from stdin".
pub(crate) const STDIN_WORD: &str = "@-";
/// The most bytes `@-` reads.
pub(crate) const MAX_STDIN_BYTES: usize = 16 * 1024 * 1024;
/// The code for an input over [`MAX_STDIN_BYTES`].
pub(crate) const INPUT_TOO_LARGE: &str = "INPUT_TOO_LARGE";

/// Whether the words of a command's input are `@-` alone.
pub(crate) fn is_stdin(words: &[String]) -> bool {
    matches!(words, [word] if word == STDIN_WORD)
}

/// Read one JSON object from the console's stdin.
///
/// # Errors
/// `INPUT_TOO_LARGE` past [`MAX_STDIN_BYTES`]; `INVALID_INPUT` for unreadable stdin, invalid JSON
/// or a value that is not an object.
pub(crate) fn read_object(console: &dyn Console) -> Result<Value, Box<CommandError>> {
    let invalid = |message: String| {
        Box::new(
            CommandError::new(error_codes::INVALID_INPUT, message)
                .with_suggestion("Pipe one JSON object to the command's stdin, as `@-` expects.")
                .with_retryable(false),
        )
    };
    let bytes = console
        .read_stdin(MAX_STDIN_BYTES)
        .map_err(|error| invalid(format!("stdin cannot be read: {error}")))?;
    if bytes.len() > MAX_STDIN_BYTES {
        return Err(Box::new(
            CommandError::new(
                INPUT_TOO_LARGE,
                format!("the input on stdin is larger than {MAX_STDIN_BYTES} bytes"),
            )
            .with_suggestion("Split the input into several calls.")
            .with_retryable(false),
        ));
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|error| invalid(format!("the input on stdin is not JSON: {error}")))?;
    if !value.is_object() {
        return Err(invalid(
            "the input on stdin is not a JSON object".to_owned(),
        ));
    }
    Ok(value)
}

/// `CONFIRMATION_REQUIRED` for a `require-human` command given `@-`: its stdin is the prompt's.
pub(crate) fn require_human_refusal(command: &str) -> CommandError {
    CommandError::new(
        error_codes::CONFIRMATION_REQUIRED,
        format!("'{command}' must be confirmed by a person at a terminal; its input cannot come from stdin (@-)"),
    )
    .with_suggestion("Pass the input as arguments and answer the prompt at a terminal.")
    .with_retryable(false)
}
