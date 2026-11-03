//! The `generic` profile (section 10.3): the capture contract forwarded unchanged, and
//! `session-start` printing the bundle's text plainly.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::json;
use support::{Fx, command_of};

#[test]
fn the_contract_is_forwarded_unchanged() {
    let fx = Fx::new();
    let contract = json!({
        "version": 1,
        "space": "main",
        "harness": { "name": "ci-runner", "version": "4.2" },
        "event": "manual",
        "session": "build-1182",
        "project": "widgets",
        "idempotencyKey": "ci-runner:build-1182:decisions",
        "decisions": [{ "subject": "Pin the toolchain", "text": "Builds use the pinned toolchain.", "rationale": "Reproducible output.", "origin": "user-stated" }],
        "artifacts": [{ "kind": "file", "resource": "rust-toolchain.toml", "title": null, "summary": null }],
        "unknownField": "the plugin's schema refuses this, not the hook"
    });
    for event in ["manual", "tool-use", "stop", "pre-compact", "session-end"] {
        let ran = fx.run(&["generic", event], &contract);
        assert_eq!(
            (ran.code, ran.stdout.as_str(), ran.stderr.as_str()),
            (0, "", "")
        );
    }
    let calls = fx.calls();
    assert_eq!(calls.len(), 5);
    for call in &calls {
        assert_eq!(command_of(call), "memory-capture");
        assert_eq!(call["input"], contract, "forwarded unchanged");
        let args: Vec<&str> = call["args"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a.as_str().unwrap())
            .collect();
        assert_eq!(
            &args[2..],
            ["--format", "json", "call", "memory-capture", "@-"]
        );
        assert_eq!(args[0], "--workspace");
    }
    // `--sweep` on session-end runs memory-sweep after the capture.
    fx.run(&["generic", "session-end", "--sweep"], &contract);
    let calls = fx.calls();
    assert_eq!(command_of(&calls[6]), "memory-sweep");
    assert_eq!(calls[6]["input"], json!({}));
}

#[test]
fn session_start_prints_the_text_plainly() {
    let fx = Fx::new();
    std::fs::write(fx.workspace().join("bundle-text"), "Context, quoted.").unwrap();
    let ran = fx.run(
        &["generic", "session-start"],
        &json!({ "project": "widgets", "session": "s-1", "task": "Review the release", "ignored": 1 }),
    );
    assert_eq!((ran.code, ran.stdout.as_str()), (0, "Context, quoted.\n"));
    let calls = fx.calls();
    assert_eq!(command_of(&calls[0]), "context-bundle");
    assert_eq!(
        calls[0]["input"],
        json!({ "render": "text", "maxChars": 9000, "project": "widgets", "session": "s-1", "task": "Review the release" })
    );
    // Empty stdin is an empty request; a null text prints nothing.
    std::fs::remove_file(fx.workspace().join("bundle-text")).unwrap();
    let ran = fx.run_with(&fx.environment(), &["generic", "session-start"], b"");
    assert_eq!((ran.code, ran.stdout.as_str()), (0, ""));
    assert_eq!(
        fx.calls()[1]["input"],
        json!({ "render": "text", "maxChars": 9000 })
    );
}

#[test]
fn stdin_that_is_not_one_object_sends_nothing() {
    let fx = Fx::new();
    for stdin in [&b"[1, 2]"[..], b"not json", b""] {
        let ran = fx.run_with(&fx.environment(), &["generic", "stop"], stdin);
        assert_eq!(ran.code, 0);
        assert_eq!(ran.stdout, "");
        assert!(
            ran.stderr.starts_with("umbel-hook: invalid-stdin:"),
            "{}",
            ran.stderr
        );
    }
    assert!(fx.calls().is_empty());
}
