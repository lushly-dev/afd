//! The `umbel-memory` binary: a stdio server and one-shot command lines write one workspace's
//! memory at once (sections 5.3 and 8, D28, D29). SQLite WAL serialises the writers; each process
//! reads every other's commits, and no write is lost.
//!
//! (`CARGO_BIN_EXE_umbel-memory` is set only for the package that owns the binary, so this test
//! lives in the memory crate.)
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Output, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use serde_json::{Value, json};

const MODERN: &str = r#""_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}"#;

const CONFIG: &str = r#"config_version = 4
default_space = "main"

[principal]
local_id = "ada"
on_behalf_of = "ada"

[spaces.main]

[plugins]
enabled = ["memory"]

[plugins.memory]
source = "compiled:memory"
[plugins.memory.grants.memory_write]
allow = ["main"]
"#;

fn command(dir: &Path, args: &[&str]) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_umbel-memory"));
    command
        .args(args)
        .current_dir(dir)
        .env_remove("UMBEL_WORKSPACE")
        .env_remove("UMBEL_LOG")
        .env_remove("UMBEL_HTTP_BIND")
        .env_remove("UMBEL_TEST_HUMAN_PRESENT")
        .env_remove("UMBEL_TEST_CLOCK");
    for (name, _) in std::env::vars_os() {
        if name.to_string_lossy().starts_with("GIT_") {
            command.env_remove(name);
        }
    }
    command
}

struct Server {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
}

impl Server {
    fn start(dir: &Path) -> Self {
        let mut child = command(dir, &["serve", "--stdio"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (sender, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        Self {
            child,
            stdin,
            lines,
        }
    }

    /// Call a tool and return its structured result; stdout carries only JSON-RPC.
    fn call(&mut self, id: u32, name: &str, arguments: &Value) -> Value {
        let request = format!(
            r#"{{"jsonrpc":"2.0","id":{id},"method":"tools/call","params":{{"name":"{name}","arguments":{arguments},{MODERN}}}}}"#
        );
        writeln!(self.stdin, "{request}").unwrap();
        self.stdin.flush().unwrap();
        let line = self
            .lines
            .recv_timeout(Duration::from_secs(60))
            .expect("no response");
        let response: Value = serde_json::from_str(&line).expect("stdout is only JSON-RPC");
        assert_eq!(response["id"], id, "{response}");
        response["result"]["structuredContent"].clone()
    }

    /// Call a command that is not first-class, through `afd-call`.
    fn afd_call(&mut self, id: u32, command: &str, input: &Value) -> Value {
        self.call(
            id,
            "afd-call",
            &json!({ "command": command, "input": input }),
        )
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn json_of(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "not JSON ({error}): {}",
            String::from_utf8_lossy(&output.stdout)
        )
    })
}

fn fact(n: u32) -> String {
    json!({
        "class": "semantic",
        "subject": format!("Fact {n}"),
        "text": format!("The statement number {n}, written by a one-shot process."),
        "project": "afd",
    })
    .to_string()
}

#[test]
fn a_server_and_one_shot_commands_write_one_workspace_at_once() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("umbel.toml"), CONFIG).unwrap();

    let mut server = Server::start(dir.path());
    // Before anything is written: an empty status, and no memory file.
    let empty = server.afd_call(1, "memory-status", &json!({}));
    assert_eq!(empty["success"], true, "{empty}");
    assert_eq!(empty["data"]["provisioned"], false, "{empty}");
    assert!(
        !dir.path()
            .join("state/spaces/main/store/memory.sqlite3")
            .exists()
    );

    // The server's agent remembers one fact; memory-remember is first-class.
    let by_agent = server.call(
        2,
        "memory-remember",
        &json!({ "class": "procedural", "subject": "Tests", "text": "Run the tests before the build." }),
    );
    assert_eq!(by_agent["success"], true, "{by_agent}");
    let agent_id = by_agent["data"]["id"].as_str().unwrap().to_owned();

    // Six one-shot writers at once, while the server is open.
    let writers: Vec<Child> = (0..6)
        .map(|n| {
            command(dir.path(), &["call", "memory-remember", &fact(n)])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .unwrap()
        })
        .collect();
    let mut ids = Vec::new();
    for writer in writers {
        let output = writer.wait_with_output().unwrap();
        assert_eq!(
            output.status.code(),
            Some(0),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
        let result = json_of(&output);
        assert_eq!(result["data"]["state"], "created", "{result}");
        ids.push(result["data"]["id"].as_str().unwrap().to_owned());
    }
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 6, "every write is its own record");

    // The server, open throughout, sees every commit.
    let status = server.afd_call(3, "memory-status", &json!({}));
    assert_eq!(status["data"]["counts"]["total"], 7, "{status}");
    let shown = server.afd_call(4, "memory-show", &json!({ "id": ids[0] }));
    assert_eq!(shown["success"], true, "{shown}");
    // A one-shot process with nobody at the terminal writes with authority tool.
    assert_eq!(shown["data"]["record"]["provenance"]["authority"], "tool");

    // And a one-shot reader sees the server's write: the same person, through on_behalf_of.
    let output = command(
        dir.path(),
        &[
            "call",
            "memory-show",
            &json!({ "id": agent_id }).to_string(),
        ],
    )
    .stdin(Stdio::null())
    .output()
    .unwrap();
    let read = json_of(&output);
    assert_eq!(read["success"], true, "{read}");
    assert_eq!(read["data"]["record"]["provenance"]["authority"], "agent");
    assert_eq!(read["data"]["record"]["scope"]["principal"], "human:ada");

    // Every write made one event.
    let events =
        std::fs::read_to_string(dir.path().join("state/spaces/main/events.jsonl")).unwrap();
    assert_eq!(events.lines().count(), 7);
}
