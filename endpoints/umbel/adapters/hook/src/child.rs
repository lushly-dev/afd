//! Running `$UMBEL_BIN [--workspace <dir>] call <command> @-` with the input on its stdin
//! (section 10.6), and reading its `CommandResult` from stdout.

use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::Environment;
use crate::failure::Failure;

/// The most bytes read from the child's stdout.
const MAX_OUTPUT_BYTES: u64 = 16 * 1024 * 1024;
/// How often a running child is polled.
const POLL: Duration = Duration::from_millis(10);

/// Run one command and return its `data` on success.
///
/// # Errors
/// `no-binary` when the binary does not start, `child-timeout` past `timeout` (the child is
/// killed), `child-failed` for output that is not a `CommandResult`, and the command's own error
/// code when it failed. The child's error message is never repeated: only its code.
pub(crate) fn call(
    environment: &Environment,
    command: &str,
    input: &Value,
    timeout: Duration,
) -> Result<Value, Failure> {
    let mut process = Command::new(&environment.bin);
    if let Some(workspace) = &environment.workspace {
        process.arg("--workspace").arg(workspace);
    }
    process
        .args(["--format", "json", "call", command, "@-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = process.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            Failure::new("no-binary", "the Umbel binary was not found; set UMBEL_BIN")
        } else {
            Failure::new("no-binary", "the Umbel binary did not start")
        }
    })?;
    let bytes = serde_json::to_vec(input).unwrap_or_default();
    let writer = child.stdin.take().map(|mut stdin| {
        std::thread::spawn(move || {
            let _ = stdin.write_all(&bytes);
        })
    });
    let reader = child.stdout.take().map(|stdout| {
        std::thread::spawn(move || {
            let mut out = Vec::new();
            let _ = stdout.take(MAX_OUTPUT_BYTES).read_to_end(&mut out);
            out
        })
    });
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(POLL),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(Failure::new(
                    "child-timeout",
                    "the Umbel binary did not finish in time",
                ));
            }
        }
    }
    if let Some(writer) = writer {
        let _ = writer.join();
    }
    let out = reader
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    let result: Value = serde_json::from_slice(&out).map_err(|_| {
        Failure::new(
            "child-failed",
            "the Umbel binary's output is not a command result",
        )
    })?;
    match result.get("success").and_then(Value::as_bool) {
        Some(true) => Ok(result.get("data").cloned().unwrap_or(Value::Null)),
        Some(false) => {
            let code = result
                .pointer("/error/code")
                .and_then(Value::as_str)
                .filter(|code| code.len() <= 64 && code.bytes().all(code_byte))
                .unwrap_or("COMMAND_FAILED");
            Err(Failure::new(
                code,
                &format!("{command} failed; run umbel-hook status, or the command by hand"),
            ))
        }
        None => Err(Failure::new(
            "child-failed",
            "the Umbel binary's output is not a command result",
        )),
    }
}

/// An error code's bytes: upper case, digits and `_`, as AFD's codes are.
fn code_byte(byte: u8) -> bool {
    byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_'
}
