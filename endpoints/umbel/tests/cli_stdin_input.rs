//! A command's input on stdin (phase 3 specification, section 10.6), and where
//! `dev.umbel/human-present` comes from (section 3.3): `@-` reads one JSON object, refuses what is
//! not one or is too large, and is refused by a `require-human` command; the mark is set only at a
//! terminal, without `--yes` or `--approve`, without an agent variable and never from `@-` or a
//! batch's `context`. The test kit's stand-ins are compiled only with `testkit`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

/// Extra words, whether stdin and stderr are terminals, and the environment variables.
type Case = (
    &'static [&'static str],
    bool,
    &'static [(&'static str, &'static str)],
);

use afd::success;
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use support::memory::{MemoryProbe, NOW, config};
use support::{Run, Scripted, cli_with_vars, fixture};
use umbel::cli::Console;
use umbel::plugins::sdk;

/// `whoami-marks` answers its input and the two terminal marks of its context.
fn configure(builder: umbel::HostBuilder) -> umbel::HostBuilder {
    builder
        .with_compiled(sdk(MemoryProbe::new()))
        .with_clock(afd::fixed_clock(NOW))
        .register_with_schema(
            fixture("whoami-marks", |input, context| {
                success(json!({
                    "input": input,
                    "present": context.extra.get("dev.umbel/human-present"),
                    "confirmed": context.extra.get("dev.umbel/human-confirmed"),
                }))
            }),
            json!({ "type": "object" }),
        )
}

async fn cli(dir: &Path, words: &[&str], console: Arc<dyn Console>, vars: &[(&str, &str)]) -> Run {
    cli_with_vars(dir, words, console, vars, configure).await
}

#[tokio::test]
async fn at_sign_dash_reads_one_object_from_stdin() {
    let dir = support::workspace(&config("", ""));
    let stdin = json!({ "a": 1, "text": "x".repeat(200_000) })
        .to_string()
        .into_bytes();
    let run = cli(
        dir.path(),
        &["whoami", "marks", "@-"],
        Scripted::with_stdin(false, false, stdin),
        &[],
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    assert_eq!(run.json()["data"]["input"]["a"], 1);
    for (bytes, code) in [
        (b"[1, 2]".to_vec(), "INVALID_INPUT"),
        (b"not json".to_vec(), "INVALID_INPUT"),
        (vec![b' '; 16 * 1024 * 1024 + 1], "INPUT_TOO_LARGE"),
    ] {
        let run = cli(
            dir.path(),
            &["whoami", "marks", "@-"],
            Scripted::with_stdin(false, false, bytes),
            &[],
        )
        .await;
        assert_eq!(
            run.error_code(),
            code,
            "{}",
            &run.stdout[..run.stdout.len().min(300)]
        );
    }
    // `@-` is the whole input or a literal: beside other words it is a key=value parse error.
    let run = cli(
        dir.path(),
        &["whoami", "marks", "@-", "a=1"],
        Scripted::no_terminal(),
        &[],
    )
    .await;
    assert_eq!(run.error_code(), "INVALID_INPUT");
}

#[tokio::test]
async fn a_require_human_command_refuses_at_sign_dash() {
    let dir = support::workspace(&config("", ""));
    let stdin = json!({ "space": "main", "args": {} })
        .to_string()
        .into_bytes();
    let console = Scripted::with_stdin(true, true, stdin);
    let run = cli(dir.path(), &["mem", "confirm", "@-"], console.clone(), &[]).await;
    assert_eq!(run.error_code(), "CONFIRMATION_REQUIRED");
    assert!(console.asked().is_empty());
}

#[tokio::test]
async fn human_present_is_set_only_for_a_person_at_a_terminal() {
    let dir = support::workspace(&config("", "agent_env = [\"MY_AGENT\"]"));
    let marks = |run: &Run| run.json()["data"]["present"].clone();
    let at_terminal = cli(
        dir.path(),
        &["whoami", "marks"],
        Scripted::new(true, true),
        &[],
    )
    .await;
    assert_eq!(marks(&at_terminal), "whoami-marks");
    assert!(at_terminal.json()["data"]["confirmed"].is_null());
    let cases: [Case; 6] = [
        (&[], false, &[]),
        (&["--yes"], true, &[]),
        (&["--approve"], true, &[]),
        (&[], true, &[("CLAUDE_CODE_ENTRYPOINT", "cli")]),
        (&[], true, &[("MY_AGENT", "1")]),
        (&["@-"], true, &[]),
    ];
    for (extra, interactive, vars) in cases {
        let console = Scripted::with_stdin(interactive, true, b"{}".to_vec());
        let mut words = vec!["whoami", "marks"];
        words.extend_from_slice(extra);
        let run = cli(dir.path(), &words, console, vars).await;
        assert_eq!(run.code, 0, "{}", run.stdout);
        assert!(marks(&run).is_null(), "{extra:?} {vars:?}: {}", run.stdout);
    }
    // A batch's context is dropped: neither mark arrives.
    let batch = json!({
        "commands": [{ "command": "whoami-marks", "input": {} }],
        "context": { "dev.umbel/human-present": "whoami-marks", "dev.umbel/human-confirmed": "whoami-marks" },
    })
    .to_string();
    let run = cli(
        dir.path(),
        &["batch", &batch],
        Scripted::new(true, true),
        &[],
    )
    .await;
    let item: &Value = &run.json()["results"][0]["result"]["data"];
    assert!(
        item["present"].is_null() && item["confirmed"].is_null(),
        "{item}"
    );
}

/// The test kit's stand-ins read their variables only in `src/cli/test_env.rs`, which
/// `src/cli/mod.rs` declares under `#[cfg(feature = "testkit")]`: a normal build has neither.
#[test]
fn the_test_variables_exist_only_under_the_testkit_feature() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut found = Vec::new();
    let mut stack = vec![root.join("src")];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                let text = std::fs::read_to_string(&path).unwrap();
                if text.contains("UMBEL_TEST_HUMAN_PRESENT") || text.contains("UMBEL_TEST_CLOCK") {
                    found.push(path.strip_prefix(root).unwrap().display().to_string());
                }
            }
        }
    }
    assert_eq!(
        found,
        ["src/cli/test_env.rs"],
        "the variables are read only by the testkit module"
    );
    let cli = std::fs::read_to_string(root.join("src/cli/mod.rs")).unwrap();
    let declaration = cli.find("mod test_env;").unwrap();
    let cfg = cli[..declaration]
        .rfind("#[cfg(feature = \"testkit\")]")
        .unwrap();
    assert!(
        !cli[cfg..declaration].contains(';'),
        "the cfg attribute is the declaration's own"
    );
    for use_site in cli.match_indices("test_env::").map(|(at, _)| at) {
        let block = cli[..use_site]
            .rfind("#[cfg(feature = \"testkit\")]")
            .unwrap();
        let open = cli[block..use_site].matches('{').count();
        let close = cli[block..use_site].matches('}').count();
        assert!(open > close, "test_env is used only inside a testkit block");
    }
}
