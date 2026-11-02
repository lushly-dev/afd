//! The `umbel-knowledge` binary: a stdio server and one-shot command lines share one workspace at
//! once. `sources-sync` and `knowledge-index` run from several processes while the server
//! searches; the index writers take turns, and the server sees every commit.
//!
//! (`CARGO_BIN_EXE_umbel-knowledge` is set only for the package that owns the binary, so this
//! test lives in the knowledge crate, not the host's `tests/process.rs`.)
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Output, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use serde_json::{Value, json};

mod support;

const MODERN: &str = r#""_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}"#;

fn command(dir: &Path, args: &[&str]) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_umbel-knowledge"));
    command
        .args(args)
        .current_dir(dir)
        .env_remove("UMBEL_WORKSPACE")
        .env_remove("UMBEL_LOG")
        .env_remove("UMBEL_HTTP_BIND");
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

    /// Call a tool and return the parsed response; stdout carries only JSON-RPC.
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
        response
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn structured(response: &Value) -> &Value {
    &response["result"]["structuredContent"]
}

fn run(dir: &Path, args: &[&str]) -> Output {
    command(dir, args).output().unwrap()
}

fn json_of(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "not JSON ({error}): {}",
            String::from_utf8_lossy(&output.stdout)
        )
    })
}

#[test]
fn a_server_and_one_shot_commands_share_a_workspace_at_once() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("umbel.toml"), support::CONFIG).unwrap();
    for root in ["main/handbook", "main/code", "beta/notes"] {
        std::fs::create_dir_all(dir.path().join("spaces").join(root)).unwrap();
    }
    let handbook = dir.path().join("spaces/main/handbook");
    for n in 0..20 {
        std::fs::write(
            handbook.join(format!("doc-{n:02}.md")),
            format!("# Doc {n}\n\nthe canary number {n} and some filler text\n"),
        )
        .unwrap();
    }

    let mut server = Server::start(dir.path());
    // The server answers before anything is indexed.
    let empty = server.call(1, "knowledge-search", &json!({ "query": "canary" }));
    assert_eq!(structured(&empty)["success"], true, "{empty}");

    // One-shot commands from several processes at once: two syncs, then two index runs.
    let syncs: Vec<Child> = (0..2)
        .map(|_| {
            command(dir.path(), &["call", "sources-sync"])
                .stdout(Stdio::piped())
                .spawn()
                .unwrap()
        })
        .collect();
    for sync in syncs {
        let output = sync.wait_with_output().unwrap();
        assert_eq!(
            output.status.code(),
            Some(0),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
        assert_eq!(json_of(&output)["success"], true);
    }
    let indexes: Vec<Child> = (0..2)
        .map(|_| {
            command(dir.path(), &["call", "knowledge-index"])
                .stdout(Stdio::piped())
                .spawn()
                .unwrap()
        })
        .collect();
    let mut indexed = 0;
    for index in indexes {
        let output = index.wait_with_output().unwrap();
        assert_eq!(
            output.status.code(),
            Some(0),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
        let result = json_of(&output);
        assert_eq!(result["success"], true, "{result}");
        indexed += result["data"]["documents"]["indexed"].as_u64().unwrap();
    }
    assert_eq!(
        indexed, 20,
        "the writers took turns: every document was indexed exactly once"
    );

    // The server, started before any of it, sees the commits.
    let found = server.call(
        2,
        "knowledge-search",
        &json!({ "query": "canary", "limit": 50 }),
    );
    let hits = structured(&found)["data"]["hits"].as_array().unwrap().len();
    assert_eq!(hits, 20, "{found}");
    assert!(
        structured(&found)["metadata"]["dev.umbel/trust"].is_string()
            || structured(&found)["success"] == true
    );

    // A one-shot search from the command line agrees.
    let cli = run(
        dir.path(),
        &["call", "knowledge-search", "query=canary", "limit=50"],
    );
    assert_eq!(json_of(&cli)["data"]["hits"].as_array().unwrap().len(), 20);

    // And the pipeline runs end to end from the command line.
    std::fs::write(
        handbook.join("late.md"),
        "# Late\n\nthe canary arrives late\n",
    )
    .unwrap();
    let refreshed = run(dir.path(), &["call", "knowledge-refresh"]);
    assert_eq!(
        json_of(&refreshed)["success"],
        true,
        "{}",
        String::from_utf8_lossy(&refreshed.stdout)
    );
    let again = server.call(3, "knowledge-search", &json!({ "query": "arrives late" }));
    assert_eq!(
        structured(&again)["data"]["hits"][0]["doc"],
        "handbook/late",
        "{again}"
    );
}
