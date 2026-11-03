//! The real `umbel-first-party` binary as a child process (section 12): one-shot commands on a
//! frozen clock (`UMBEL_TEST_CLOCK`) with or without a person at the terminal
//! (`UMBEL_TEST_HUMAN_PRESENT`), a stdio MCP server for an agent's calls, and `umbel-hook` through
//! its library entry, `umbel_hook::run`, which spawns the binary as the `umbel-hook` binary does.
//!
//! The hook passes its own environment to the child and a test may not set its process's
//! environment (`unsafe` in edition 2024, and the workspace forbids `unsafe`), so the hook's
//! `$UMBEL_BIN` is a two-line shell script that sets the frozen clock from a file and `exec`s the
//! binary with the hook's arguments unchanged.

use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use serde_json::{Value, json};

pub const BIN: &str = env!("CARGO_BIN_EXE_umbel-first-party");

/// Variables a child must not inherit: the workspace, logging and HTTP overrides, the test kit's
/// own (set per call), and the agent variables that withhold a person's presence (3.3).
const SCRUBBED: [&str; 10] = [
    "UMBEL_WORKSPACE",
    "UMBEL_LOG",
    "UMBEL_HTTP_BIND",
    "UMBEL_TASK",
    "UMBEL_TEST_HUMAN_PRESENT",
    "UMBEL_TEST_CLOCK",
    "UMBEL_BIN",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "AI_AGENT",
];

/// The committed Claude Code transcript fixture.
pub fn transcript() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../adapters/hook/tests/fixtures/claude-code/session.jsonl")
}

/// The fixture's session id.
pub const SESSION: &str = "0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f";

/// A workspace driven through the binary, with a repository `example` for the hook's `cwd`.
pub struct Bin {
    pub root: PathBuf,
    pub ws: PathBuf,
    /// The hook's working directory: a repository named `example`.
    pub repo: PathBuf,
    clock_file: PathBuf,
    wrapper: PathBuf,
    pub clock: i64,
}

fn scrub(command: &mut Command) {
    for name in SCRUBBED {
        command.env_remove(name);
    }
    for (name, _) in std::env::vars_os() {
        if name.to_string_lossy().starts_with("GIT_") {
            command.env_remove(name);
        }
    }
}

impl Bin {
    /// A workspace at `<root>/ws` with `config`, on the clock `clock`.
    pub fn new(root: &Path, config: &str, clock: i64) -> Self {
        let ws = root.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        std::fs::write(ws.join("umbel.toml"), config).unwrap();
        let repo = root.join("repos/example");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        let clock_file = root.join("clock");
        let wrapper = root.join("umbel-first-party-at-clock");
        let quoted = |path: &Path| format!("'{}'", path.display());
        let mut unset = String::new();
        for name in SCRUBBED {
            unset.push_str(&format!("-u {name} "));
        }
        std::fs::write(
            &wrapper,
            format!(
                "#!/bin/sh\nexec env {unset}UMBEL_TEST_CLOCK=\"$(cat {})\" {} \"$@\"\n",
                quoted(&clock_file),
                quoted(Path::new(BIN)),
            ),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let bin = Self {
            root: root.to_path_buf(),
            ws,
            repo,
            clock_file,
            wrapper,
            clock,
        };
        bin.set_clock(clock);
        bin
    }

    /// Move the frozen clock, for the one-shot calls and the hook's children alike.
    pub fn set_clock(&self, clock: i64) {
        std::fs::write(&self.clock_file, clock.to_string()).unwrap();
    }

    pub fn at(&mut self, clock: i64) {
        self.clock = clock;
        self.set_clock(clock);
    }

    fn command(&self, args: &[&str], human: bool) -> Command {
        let mut command = Command::new(BIN);
        scrub(&mut command);
        command
            .arg("--workspace")
            .arg(&self.ws)
            .args(args)
            .current_dir(&self.root)
            .env("UMBEL_TEST_CLOCK", self.clock.to_string())
            .stdin(Stdio::null());
        if human {
            command.env("UMBEL_TEST_HUMAN_PRESENT", "1");
        }
        command
    }

    /// The raw stdout of one command line.
    pub fn raw(&self, args: &[&str], human: bool) -> Vec<u8> {
        let output = self.command(args, human).output().unwrap();
        output.stdout
    }

    /// One command through the binary; `human` puts a person at the terminal who answers yes.
    pub fn call_with(&self, command: &str, input: &Value, extra: &[&str], human: bool) -> Value {
        let input = input.to_string();
        let mut args = vec!["--format", "json", "call", command, input.as_str()];
        args.extend_from_slice(extra);
        let stdout = self.raw(&args, human);
        serde_json::from_slice(&stdout).unwrap_or_else(|error| {
            panic!(
                "{command}: stdout is not JSON ({error}): {}",
                String::from_utf8_lossy(&stdout)
            )
        })
    }

    /// One command with nobody at the terminal: a script, authority `tool`.
    pub fn call(&self, command: &str, input: &Value) -> Value {
        self.call_with(command, input, &[], false)
    }

    /// One command with a person at the terminal who answers yes: authority `person`.
    pub fn person(&self, command: &str, input: &Value) -> Value {
        self.call_with(command, input, &[], true)
    }

    /// Run `umbel-hook` as a harness would; the exit code, stdout and stderr.
    pub fn hook(&self, args: &[&str], stdin: &[u8]) -> (i32, String, String) {
        let environment = umbel_hook::Environment {
            bin: self.wrapper.clone().into_os_string(),
            workspace: Some(self.ws.clone().into_os_string()),
            state_dir: Some(self.root.join("state/umbel-hook")),
            task: None,
        };
        let args: Vec<OsString> = args.iter().map(OsString::from).collect();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = umbel_hook::run(&args, &environment, &mut &stdin[..], &mut out, &mut err);
        (
            code,
            String::from_utf8(out).unwrap(),
            String::from_utf8(err).unwrap(),
        )
    }

    /// The Claude Code hook's stdin for `event`, on the fixture transcript.
    pub fn hook_input(&self, event: &str) -> Value {
        json!({
            "session_id": SESSION,
            "transcript_path": transcript().display().to_string(),
            "cwd": self.repo.display().to_string(),
            "hook_event_name": event,
        })
    }

    /// The hook's last recorded failure, if any.
    pub fn last_error(&self) -> Option<String> {
        std::fs::read_to_string(self.root.join("state/umbel-hook/last-error.json")).ok()
    }

    /// A stdio MCP server on the frozen clock: an agent acting for `principal.on_behalf_of`.
    pub fn mcp(&self) -> Mcp {
        let mut command = self.command(&["serve", "--stdio"], false);
        let mut child = command
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
        Mcp {
            child,
            stdin,
            lines,
            next: 0,
        }
    }

    pub fn store_dir(&self, space: &str) -> PathBuf {
        self.ws.join(format!("state/spaces/{space}/store"))
    }

    /// The journal, the log and both event streams, as text.
    pub fn journaled_text(&self) -> String {
        let mut text = String::new();
        for relative in [
            "state/journal.jsonl",
            "state/log.jsonl",
            "state/spaces/alpha/events.jsonl",
            "state/spaces/beta/events.jsonl",
        ] {
            text.push_str(&std::fs::read_to_string(self.ws.join(relative)).unwrap_or_default());
        }
        text
    }

    /// The journal's entries.
    pub fn journal(&self) -> Vec<Value> {
        std::fs::read_to_string(self.ws.join("state/journal.jsonl"))
            .unwrap_or_default()
            .lines()
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }
}

const MODERN: &str = r#""_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}"#;

/// A stdio MCP server of the binary.
pub struct Mcp {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
    next: u32,
}

impl Mcp {
    /// Call a tool; its structured result.
    pub fn call(&mut self, name: &str, arguments: &Value) -> Value {
        self.next += 1;
        let id = self.next;
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
}

impl Drop for Mcp {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
