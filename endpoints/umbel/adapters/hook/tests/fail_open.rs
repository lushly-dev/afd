//! Failing open (section 10.3), through the `umbel-hook` binary itself: no binary, a refusal, a
//! lock timeout, output that is not a result, malformed stdin and a directory as the transcript
//! each exit 0 with one line on stderr and nothing on stdout, and write `last-error.json`, which
//! holds no text and which a later success removes. `umbel-hook status` prints it.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{Value, json};
use support::{FIXTURE, Fx};

struct Ran {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

/// Run the binary with the fixture's environment and nothing of the person's own.
fn hook(fx: &Fx, bin: &Path, args: &[&str], stdin: &[u8]) -> Ran {
    let mut child = Command::new(env!("CARGO_BIN_EXE_umbel-hook"))
        .args(args)
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .env("HOME", fx.dir.path())
        .env("XDG_STATE_HOME", fx.dir.path().join("state"))
        .env("UMBEL_BIN", bin)
        .env("UMBEL_WORKSPACE", fx.workspace())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(stdin).unwrap();
    let output = child.wait_with_output().unwrap();
    Ran {
        code: output.status.code(),
        stdout: String::from_utf8(output.stdout).unwrap(),
        stderr: String::from_utf8(output.stderr).unwrap(),
    }
}

fn fixture_bin() -> &'static Path {
    Path::new(env!("CARGO_BIN_EXE_umbel-hook-fixture"))
}

fn last_error(fx: &Fx) -> Option<Value> {
    std::fs::read(fx.state().join("last-error.json"))
        .ok()
        .map(|bytes| serde_json::from_slice(&bytes).unwrap())
}

/// Exit 0, nothing on stdout, one line on stderr naming `code`, and `last-error.json` with it.
fn failed_open(fx: &Fx, ran: &Ran, code: &str, event: &str) -> Value {
    assert_eq!(ran.code, Some(0));
    assert_eq!(ran.stdout, "", "no harness output");
    assert_eq!(ran.stderr.lines().count(), 1, "{}", ran.stderr);
    assert!(
        ran.stderr.starts_with(&format!("umbel-hook: {code}: ")),
        "{}",
        ran.stderr
    );
    let error = last_error(fx).expect("last-error.json");
    let mut keys: Vec<&str> = error
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, ["at", "code", "count", "event", "profile"]);
    assert_eq!(error["code"], code);
    assert_eq!(error["event"], event);
    assert_eq!(error["profile"], "claude-code");
    error
}

fn stop_stdin(fx: &Fx, transcript: &Path) -> Vec<u8> {
    fx.stdin("Stop", transcript).to_string().into_bytes()
}

#[test]
fn no_binary_fails_open() {
    let fx = Fx::new();
    let transcript = fx.transcript("session.jsonl", FIXTURE);
    let missing = fx.dir.path().join("no-such-binary");
    let ran = hook(
        &fx,
        &missing,
        &["claude-code", "stop"],
        &stop_stdin(&fx, &transcript),
    );
    let error = failed_open(&fx, &ran, "no-binary", "stop");
    assert_eq!(error["count"], 1);
    assert!(error["at"].as_str().unwrap().ends_with('Z'));
    // Nothing of the transcript in the record or on stderr.
    let raw = std::fs::read_to_string(fx.state().join("last-error.json")).unwrap();
    for text in [&raw, &ran.stderr] {
        assert!(
            !text.contains("Turn")
                && !text.contains("CANARY")
                && !text.contains(&*fx.dir.path().display().to_string())
        );
    }
}

#[test]
fn a_refusal_and_a_lock_timeout_fail_open_and_count() {
    let fx = Fx::new();
    let transcript = fx.transcript("session.jsonl", FIXTURE);
    fx.set_mode("refuse");
    let ran = hook(
        &fx,
        fixture_bin(),
        &["claude-code", "stop"],
        &stop_stdin(&fx, &transcript),
    );
    assert_eq!(failed_open(&fx, &ran, "MEMORY_INVALID", "stop")["count"], 1);
    fx.set_mode("busy");
    let ran = hook(
        &fx,
        fixture_bin(),
        &["claude-code", "session-end"],
        &stop_stdin(&fx, &transcript),
    );
    assert_eq!(
        failed_open(&fx, &ran, "STORE_BUSY", "session-end")["count"],
        2
    );
    fx.set_mode("garbage");
    let ran = hook(
        &fx,
        fixture_bin(),
        &["claude-code", "stop"],
        &stop_stdin(&fx, &transcript),
    );
    assert_eq!(failed_open(&fx, &ran, "child-failed", "stop")["count"], 3);
    // `status` prints it; the doctor's stores.capture warns while it exists.
    let status = hook(&fx, fixture_bin(), &["status"], b"");
    assert_eq!(status.code, Some(0));
    let status: Value = serde_json::from_str(&status.stdout).unwrap();
    assert_eq!(status["lastError"]["code"], "child-failed");
    assert_eq!(status["lastError"]["count"], 3);

    // A success removes it.
    fx.set_mode("ok");
    let ran = hook(
        &fx,
        fixture_bin(),
        &["claude-code", "stop"],
        &stop_stdin(&fx, &transcript),
    );
    assert_eq!(ran.code, Some(0));
    assert_eq!(ran.stdout, "");
    assert!(last_error(&fx).is_none());
    let status = hook(&fx, fixture_bin(), &["status"], b"");
    let status: Value = serde_json::from_str(&status.stdout).unwrap();
    assert_eq!(status["lastError"], Value::Null);
}

#[test]
fn malformed_stdin_fails_open() {
    let fx = Fx::new();
    let transcript = fx.transcript("session.jsonl", FIXTURE);
    for stdin in [
        b"{ not json".to_vec(),
        b"[]".to_vec(),
        json!({ "transcript_path": transcript.display().to_string() })
            .to_string()
            .into_bytes(),
        json!({ "session_id": "../escape", "transcript_path": transcript.display().to_string() })
            .to_string()
            .into_bytes(),
    ] {
        let ran = hook(&fx, fixture_bin(), &["claude-code", "stop"], &stdin);
        failed_open(&fx, &ran, "invalid-stdin", "stop");
    }
    assert!(fx.calls().is_empty());
    // No state file was made for a session id that is not a label.
    let names: Vec<String> = std::fs::read_dir(fx.state())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, ["last-error.json"]);
}

#[test]
fn a_directory_as_the_transcript_fails_open() {
    let fx = Fx::new();
    let ran = hook(
        &fx,
        fixture_bin(),
        &["claude-code", "pre-compact"],
        &fx.stdin("PreCompact", fx.dir.path())
            .to_string()
            .into_bytes(),
    );
    failed_open(&fx, &ran, "transcript-unreadable", "pre-compact");
    let missing = fx.dir.path().join("missing.jsonl");
    let ran = hook(
        &fx,
        fixture_bin(),
        &["claude-code", "stop"],
        &stop_stdin(&fx, &missing),
    );
    failed_open(&fx, &ran, "transcript-unreadable", "stop");
    assert!(fx.calls().is_empty());
}

#[test]
fn bad_arguments_fail_open_too() {
    let fx = Fx::new();
    let transcript = fx.transcript("session.jsonl", FIXTURE);
    let ran = hook(
        &fx,
        fixture_bin(),
        &["claude-code", "no-such-event"],
        &stop_stdin(&fx, &transcript),
    );
    assert_eq!((ran.code, ran.stdout.as_str()), (Some(0), ""));
    assert!(ran.stderr.starts_with("umbel-hook: invalid-arguments:"));
    let error = last_error(&fx).unwrap();
    assert_eq!(error["event"], "no-such-event");
    let ran = hook(
        &fx,
        fixture_bin(),
        &["claude-code", "stop", "--sweep"],
        &stop_stdin(&fx, &transcript),
    );
    assert!(ran.stderr.starts_with("umbel-hook: invalid-arguments:"));
    assert!(fx.calls().is_empty());
}

#[test]
fn a_child_that_never_answers_is_killed() {
    // The bundle's limit is nine seconds, under the hook's ten.
    let fx = Fx::new();
    let transcript = fx.transcript("session.jsonl", FIXTURE);
    fx.set_mode("sleep");
    let mut stdin = fx.stdin("SessionStart", &transcript);
    stdin["source"] = json!("startup");
    let started = std::time::Instant::now();
    let ran = hook(
        &fx,
        fixture_bin(),
        &["claude-code", "session-start"],
        &stdin.to_string().into_bytes(),
    );
    assert!(started.elapsed() < std::time::Duration::from_secs(30));
    let error = failed_open(&fx, &ran, "child-timeout", "session-start");
    assert_eq!(error["count"], 1);
}
