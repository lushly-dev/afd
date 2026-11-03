//! A temporary directory with a fixture workspace (for `umbel-hook-fixture`, the stand-in for
//! `$UMBEL_BIN`), a state directory and transcripts. Nothing touches a real harness's settings or
//! the person's own state directory.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use tempfile::TempDir;

/// The committed transcript fixture: 65 text turns, synthetic text.
pub const FIXTURE: &str = include_str!("../fixtures/claude-code/session.jsonl");
/// The fixture's session id.
pub const SESSION: &str = "0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f";

pub struct Fx {
    pub dir: TempDir,
}

/// What one run printed.
pub struct Ran {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl Fx {
    pub fn new() -> Self {
        let fx = Self {
            dir: tempfile::tempdir().unwrap(),
        };
        std::fs::create_dir_all(fx.workspace()).unwrap();
        std::fs::create_dir_all(fx.cwd()).unwrap();
        fx
    }

    /// The fixture binary's workspace: `calls.jsonl`, `mode`, `bundle-text`.
    pub fn workspace(&self) -> PathBuf {
        self.dir.path().join("ws")
    }

    /// The hook's state directory.
    pub fn state(&self) -> PathBuf {
        self.dir.path().join("state/umbel-hook")
    }

    /// A working directory inside a repository named `example`.
    pub fn cwd(&self) -> PathBuf {
        let repo = self.dir.path().join("example");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        repo.join("src")
    }

    pub fn environment(&self) -> umbel_hook::Environment {
        umbel_hook::Environment {
            bin: env!("CARGO_BIN_EXE_umbel-hook-fixture").into(),
            workspace: Some(self.workspace().into_os_string()),
            state_dir: Some(self.state()),
            task: None,
        }
    }

    pub fn set_mode(&self, mode: &str) {
        std::fs::write(self.workspace().join("mode"), mode).unwrap();
    }

    /// Write a transcript in the temporary directory and return its path.
    pub fn transcript(&self, name: &str, text: &str) -> PathBuf {
        let path = self.dir.path().join(name);
        std::fs::write(&path, text).unwrap();
        path
    }

    /// The harness's stdin for an event.
    pub fn stdin(&self, event: &str, transcript: &Path) -> Value {
        json!({
            "session_id": SESSION,
            "transcript_path": transcript.display().to_string(),
            "cwd": self.cwd().display().to_string(),
            "hook_event_name": event,
            "permission_mode": "default",
        })
    }

    /// Run the hook through its library entry, as the binary does.
    pub fn run(&self, args: &[&str], stdin: &Value) -> Ran {
        self.run_with(&self.environment(), args, stdin.to_string().as_bytes())
    }

    pub fn run_with(
        &self,
        environment: &umbel_hook::Environment,
        args: &[&str],
        stdin: &[u8],
    ) -> Ran {
        let args: Vec<OsString> = args.iter().map(OsString::from).collect();
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let code = umbel_hook::run(
            &args,
            environment,
            &mut &stdin[..],
            &mut stdout,
            &mut stderr,
        );
        Ran {
            code,
            stdout: String::from_utf8(stdout).unwrap(),
            stderr: String::from_utf8(stderr).unwrap(),
        }
    }

    /// Every call the fixture binary received, in order.
    pub fn calls(&self) -> Vec<Value> {
        std::fs::read_to_string(self.workspace().join("calls.jsonl"))
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    /// The inputs of the `memory-capture` calls.
    pub fn captures(&self) -> Vec<Value> {
        self.calls()
            .into_iter()
            .filter(|call| command_of(call) == "memory-capture")
            .map(|call| call["input"].clone())
            .collect()
    }
}

/// The command a call named.
pub fn command_of(call: &Value) -> String {
    let args: Vec<&str> = call["args"]
        .as_array()
        .unwrap()
        .iter()
        .map(|arg| arg.as_str().unwrap())
        .collect();
    let at = args.iter().position(|arg| *arg == "call").unwrap();
    args[at + 1].to_owned()
}

/// All the text a capture sent.
pub fn sent_text(captures: &[Value]) -> String {
    captures
        .iter()
        .flat_map(|capture| capture["episodes"].as_array().unwrap().clone())
        .map(|episode| episode["text"].as_str().unwrap().to_owned())
        .collect::<Vec<_>>()
        .join("\n")
}

/// A user line of the transcript format.
pub fn user_line(text: &str) -> String {
    json!({ "type": "user", "isSidechain": false, "message": { "role": "user", "content": text }, "timestamp": "2026-11-02T10:00:00.000Z", "version": "2.1.316" })
        .to_string()
}

/// An assistant line with one text block.
pub fn assistant_line(id: &str, text: &str) -> String {
    json!({ "type": "assistant", "isSidechain": false, "message": { "id": id, "role": "assistant", "model": "claude-synthetic-1", "content": [{ "type": "text", "text": text }] }, "timestamp": "2026-11-02T10:00:01.000Z" })
        .to_string()
}

/// A transcript of `n` alternating turns, `prefix` in each text.
pub fn turns(n: usize, prefix: &str) -> String {
    let mut text = String::new();
    for i in 0..n {
        let line = if i % 2 == 0 {
            user_line(&format!("{prefix} turn {i}"))
        } else {
            assistant_line(&format!("msg_{prefix}_{i}"), &format!("{prefix} turn {i}"))
        };
        text.push_str(&line);
        text.push('\n');
    }
    text
}
