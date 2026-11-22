//! `loam-desktop mcp`, the stdio bridge (phase 6 specification, 10.8): the same binary in a mode decided from its
//! arguments before Tauri or the single-instance plugin starts, so it opens no window and never focuses the running
//! one. It reads `inbound.json` (refusing one that is not owner-only), checks that the process it names is running,
//! then passes each line of stdin, one JSON-RPC message, to the endpoint with the token, writing each answer as one line
//! to stdout. It never starts the app.
//!
//! `loam-desktop mcp --print-connection` prints the URL and the header line for this run, for AFD's CLI
//! (`--connect <url>` and `AFD_HEADERS`) or any HTTP client.
use crate::connection::{self, Connection, PERMISSIONS, UNAVAILABLE, UNAVAILABLE_SUGGESTION};
use serde_json::{Value, json};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The client's bound on one exchange: past the endpoint's own 60 s, so its `504` arrives first.
const EXCHANGE_TIMEOUT: Duration = Duration::from_secs(65);

/// What a refused exchange tells the client: a JSON-RPC error whose `data` is a `CommandResult`-style error.
fn error(id: &Value, code: &str, message: &str, suggestion: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": -32000,
            "message": message,
            "data": { "code": code, "message": message, "suggestion": suggestion },
        },
    })
}

/// The connection, if the desktop that wrote it is running.
fn connect(data: &Path) -> Result<Connection, &'static str> {
    let connection = connection::read(data)?;
    if connection::running(connection.pid) {
        Ok(connection)
    } else {
        Err(UNAVAILABLE)
    }
}

fn refusal(code: &'static str) -> (&'static str, &'static str) {
    if code == PERMISSIONS {
        (
            "inbound.json can be read by someone other than you",
            "Restrict inbound.json to your user, or restart Loam to write it again",
        )
    } else {
        ("Loam is not running", UNAVAILABLE_SUGGESTION)
    }
}

/// The bridge's entry: `args` follow `mcp`. Returns the process's exit code.
pub fn run(args: &[String]) -> i32 {
    let Some(data) = connection::data_directory() else {
        eprintln!("loam-desktop mcp: no data directory ({UNAVAILABLE}): {UNAVAILABLE_SUGGESTION}");
        return 1;
    };
    match args {
        [] => bridge(&data),
        [flag] if flag == "--print-connection" => print_connection(&data),
        _ => {
            eprintln!("Usage: loam-desktop mcp [--print-connection]");
            2
        }
    }
}

fn print_connection(data: &Path) -> i32 {
    match connect(data) {
        Ok(connection) => {
            // Two lines: the URL, then the header, as `AFD_HEADERS` reads one.
            println!("{}", connection.url);
            println!("Authorization: Bearer {}", connection.token);
            0
        }
        Err(code) => {
            let (message, suggestion) = refusal(code);
            eprintln!("loam-desktop mcp: {message} ({code}). {suggestion}.");
            1
        }
    }
}

/// How one exchange ended.
enum Sent {
    /// The answer to write, if any.
    Answered(Option<Value>),
    /// `401`: the token is not this run's, so nothing ran.
    Refused,
    /// No connection was made, so nothing was sent.
    Unreachable,
}

async fn send(client: &reqwest::Client, connection: &Connection, line: &str, id: &Value) -> Sent {
    let response = client
        .post(&connection.url)
        .header("Authorization", format!("Bearer {}", connection.token))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .body(line.to_owned())
        .send()
        .await;
    let answer = |code: &str, message: &str, suggestion: &str| {
        Sent::Answered((!id.is_null()).then(|| error(id, code, message, suggestion)))
    };
    let response = match response {
        Ok(response) => response,
        Err(cause) if cause.is_connect() => return Sent::Unreachable,
        // The message may have reached Loam: never sent again, since a change may have run (10.8).
        Err(_) => {
            return answer(
                UNAVAILABLE,
                "The connection to Loam ended before its answer; the call may have run",
                "Check before you retry a change",
            );
        }
    };
    let status = response.status().as_u16();
    match status {
        200 => match response
            .bytes()
            .await
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        {
            Some(body) => Sent::Answered(Some(body)),
            None => answer(
                "MOUNT_RESULT_INVALID",
                "Loam's answer was not JSON",
                "Retry; if it persists, restart Loam",
            ),
        },
        202 => Sent::Answered(None),
        401 => Sent::Refused,
        503 => answer(
            UNAVAILABLE,
            "Loam is loading or reloaded; a call it was running may have run",
            "Retry once Loam has opened; check before you retry a change",
        ),
        504 => answer(
            "MOUNT_TIMEOUT",
            "Loam did not answer within 60 s; the call may have run",
            "Check before you retry a change",
        ),
        429 => answer("MOUNT_LIMIT", "Too many calls at once", "Retry shortly"),
        _ => answer(
            "REQUEST_INVALID",
            &format!("Loam refused the message (HTTP {status})"),
            "Send one JSON-RPC request or notification per line, at most 1 MiB",
        ),
    }
}

fn write_line(out: &mut impl Write, value: &Value) -> bool {
    let mut line = serde_json::to_vec(value).expect("a JSON value serialises");
    line.push(b'\n');
    out.write_all(&line).and_then(|()| out.flush()).is_ok()
}

fn bridge(data: &Path) -> i32 {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime");
    let client = reqwest::Client::builder()
        .no_proxy()
        // A new loopback connection per message, never a pooled one to a desktop that has since exited: a failure to
        // connect then means nothing was sent, the one failure the bridge retries.
        .pool_max_idle_per_host(0)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(EXCHANGE_TIMEOUT)
        .build()
        .expect("an HTTP client");
    let data: PathBuf = data.to_path_buf();
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            return 1;
        };
        if line.trim().is_empty() {
            continue;
        }
        let id = match serde_json::from_str::<Value>(&line) {
            Ok(message) => message.get("id").cloned().unwrap_or(Value::Null),
            Err(_) => {
                let parse = json!({
                    "jsonrpc": "2.0",
                    "id": null,
                    "error": { "code": -32700, "message": "Each line must be one JSON-RPC message" },
                });
                if !write_line(&mut out, &parse) {
                    return 1;
                }
                continue;
            }
        };
        // The file and its process are checked before every line, so no line goes to a port another program holds
        // since Loam exited. At most two tries, the second after reading the file again (the app may have restarted),
        // and only when nothing was delivered: a `401`, or no connection made.
        let mut answered = None;
        let mut refused = false;
        for _attempt in 0..2 {
            let Ok(connection) = connect(&data) else {
                break;
            };
            match runtime.block_on(send(&client, &connection, &line, &id)) {
                Sent::Answered(answer) => {
                    answered = Some(answer);
                    break;
                }
                Sent::Refused => refused = true,
                Sent::Unreachable => refused = false,
            }
        }
        match answered {
            Some(Some(answer)) => {
                if !write_line(&mut out, &answer) {
                    return 1;
                }
            }
            Some(None) => {}
            None => {
                let (code, message, suggestion) = match connect(&data) {
                    Ok(_) if refused => (
                        UNAVAILABLE,
                        "Loam refused this run's token twice",
                        "Restart Loam, then retry",
                    ),
                    Ok(_) => (UNAVAILABLE, "Loam is not answering", UNAVAILABLE_SUGGESTION),
                    Err(code) => {
                        let (message, suggestion) = refusal(code);
                        (code, message, suggestion)
                    }
                };
                if !id.is_null() {
                    let _ = write_line(&mut out, &error(&id, code, message, suggestion));
                }
                eprintln!("loam-desktop mcp: {message} ({code}). {suggestion}.");
                return 1;
            }
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unavailable_answer_names_the_code_and_the_suggestion() {
        let answer = error(
            &json!(3),
            UNAVAILABLE,
            "Loam is not running",
            UNAVAILABLE_SUGGESTION,
        );
        assert_eq!(answer["id"], 3);
        assert_eq!(
            answer["error"]["data"]["code"],
            "DESKTOP_INBOUND_UNAVAILABLE"
        );
        assert_eq!(
            answer["error"]["data"]["suggestion"],
            "Open Loam, then retry"
        );
        assert_eq!(
            refusal(PERMISSIONS).1,
            "Restrict inbound.json to your user, or restart Loam to write it again"
        );
    }

    #[test]
    fn a_connection_whose_process_has_ended_is_unavailable() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(connect(dir.path()).err(), Some(UNAVAILABLE));
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .arg("--list")
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let pid = child.id();
        child.wait().unwrap();
        connection::write(
            dir.path(),
            &Connection {
                pid,
                ..Connection::new(1, "t".into())
            },
        )
        .unwrap();
        assert_eq!(connect(dir.path()).err(), Some(UNAVAILABLE));
        connection::write(dir.path(), &Connection::new(1, "t".into())).unwrap();
        assert!(connect(dir.path()).is_ok());
    }
}
