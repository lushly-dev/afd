//! `umbel-hook` against the real `umbel-first-party` binary (sections 10.3 and 10.6): the hook's
//! command line, `@-` input and result parsing as the binary speaks them. The hook is driven
//! through its library entry, `umbel_hook::run`, which spawns the binary exactly as the
//! `umbel-hook` binary does (`CARGO_BIN_EXE_*` is set only for the owning package). Step 10's
//! `exit_memory.rs` asserts the rest of the exit criterion.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::ffi::OsString;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{Value, json};

const CONFIG: &str = r#"config_version = 4
default_space = "main"

[principal]
local_id = "ada"
on_behalf_of = "ada"

[spaces.main]

[plugins]
enabled = ["memory", "context"]

[plugins.memory]
source = "compiled:memory"
[plugins.memory.grants.memory_write]
allow = ["main"]

[plugins.context]
source = "compiled:context"
"#;

const SESSION: &str = "0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f";
const BIN: &str = env!("CARGO_BIN_EXE_umbel-first-party");

fn fixture() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../adapters/hook/tests/fixtures/claude-code/session.jsonl")
}

/// Run the hook as a harness would, with this workspace and a state directory of its own.
fn hook(dir: &Path, args: &[&str], stdin: &Value) -> (i32, String, String) {
    let environment = umbel_hook::Environment {
        bin: BIN.into(),
        workspace: Some(dir.join("ws").into_os_string()),
        state_dir: Some(dir.join("state/umbel-hook")),
        task: None,
    };
    let args: Vec<OsString> = args.iter().map(OsString::from).collect();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let code = umbel_hook::run(
        &args,
        &environment,
        &mut stdin.to_string().as_bytes(),
        &mut out,
        &mut err,
    );
    (
        code,
        String::from_utf8(out).unwrap(),
        String::from_utf8(err).unwrap(),
    )
}

/// One command through the binary, with nobody at the terminal.
fn call(dir: &Path, command: &str, input: &Value) -> Value {
    let output = Command::new(BIN)
        .args(["--workspace"])
        .arg(dir.join("ws"))
        .args(["call", command, &input.to_string()])
        .env_remove("UMBEL_WORKSPACE")
        .env_remove("UMBEL_TEST_HUMAN_PRESENT")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn the_hook_captures_and_bundles_through_the_binary() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("ws")).unwrap();
    std::fs::write(dir.path().join("ws/umbel.toml"), CONFIG).unwrap();
    let stdin = json!({
        "session_id": SESSION,
        "transcript_path": fixture().display().to_string(),
        "cwd": dir.path().display().to_string(),
        "hook_event_name": "Stop",
    });

    let (code, out, err) = hook(dir.path(), &["claude-code", "stop"], &stdin);
    assert_eq!((code, out.as_str()), (0, ""));
    assert!(
        !err.contains("umbel-hook: no-binary") && !err.contains("child-failed"),
        "{err}"
    );
    assert!(
        !dir.path().join("state/umbel-hook/last-error.json").exists(),
        "{err}"
    );
    let listed = call(dir.path(), "memory-list", &json!({ "limit": 50 }));
    assert_eq!(listed["success"], true, "{listed}");
    let items = listed["data"]["items"].as_array().unwrap();
    assert_eq!(items.len(), 3, "{listed}");
    for item in items {
        assert_eq!(item["class"], "episodic");
        assert_eq!(item["authority"], "transcript", "{item}");
        assert_eq!(item["shared"], false, "capture is private");
    }

    // The same event again writes nothing; the end sends the tail.
    hook(dir.path(), &["claude-code", "stop"], &stdin);
    let (code, _, err) = hook(dir.path(), &["claude-code", "session-end"], &stdin);
    assert_eq!(code, 0, "{err}");
    let listed = call(dir.path(), "memory-list", &json!({ "limit": 50 }));
    assert_eq!(
        listed["data"]["items"].as_array().unwrap().len(),
        4,
        "{listed}"
    );

    // A session start prints valid hook output, or nothing when nothing is pushed.
    let mut start = stdin.clone();
    start["source"] = json!("startup");
    let (code, out, err) = hook(dir.path(), &["claude-code", "session-start"], &start);
    assert_eq!(code, 0);
    assert!(
        !dir.path().join("state/umbel-hook/last-error.json").exists(),
        "{err}"
    );
    if !out.is_empty() {
        let output: Value = serde_json::from_str(out.trim()).unwrap();
        let text = output["hookSpecificOutput"]["additionalContext"]
            .as_str()
            .unwrap();
        assert!(text.chars().count() < 10_000);
    }
}
