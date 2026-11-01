//! The CLI projection (specification sections 3 and 4).
//!
//! Cases that need no fixture run the built binary. Cases that register fixture commands run
//! `umbel::cli::run` in process, because the binary has no way to load a fixture: it takes the
//! same arguments, workspace discovery, output and exit codes.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#![cfg(feature = "cli")]

mod support;

use afd::{ResultMetadata, success};
use serde_json::{Value, json};
use std::path::Path;
use std::process::{Command, Output};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use support::*;

fn umbel(dir: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_umbel"))
        .args(args)
        .current_dir(dir)
        .env_remove("UMBEL_WORKSPACE")
        .env_remove("UMBEL_LOG")
        .env_remove("UMBEL_HTTP_BIND")
        .env_remove("GIT_DIR")
        .output()
        .unwrap()
}

fn stdout_json(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "stdout is not one JSON document ({error}): {}",
            String::from_utf8_lossy(&output.stdout)
        )
    })
}

#[test]
fn init_creates_the_layout_with_private_keys_and_refuses_an_existing_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("ws");
    let output = umbel(dir.path(), &["init", "ws", "--name", "demo"]);
    assert_eq!(output.status.code(), Some(0), "{output:?}");
    assert_eq!(stdout_json(&output)["success"], true);

    assert!(target.join("umbel.toml").is_file());
    assert!(target.join("spaces/main").is_dir());
    assert!(target.join("state/.gitignore").is_file());
    for key in ["approval.key", "confirmation.key"] {
        let path = target.join("state/keys").join(key);
        assert!(std::fs::metadata(&path).unwrap().len() >= 32);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "{key}");
        }
    }

    let again = umbel(dir.path(), &["init", "ws"]);
    assert_eq!(again.status.code(), Some(1));
    assert_eq!(stdout_json(&again)["error"]["code"], "ALREADY_EXISTS");
}

#[test]
fn the_projection_equals_umbel_call_and_prints_one_indented_result() {
    let dir = minimal();
    let projected = umbel(dir.path(), &["workspace", "show"]);
    let called = umbel(dir.path(), &["call", "workspace-show"]);
    assert_eq!(projected.status.code(), Some(0));
    assert_eq!(projected.stdout, called.stdout);

    let text = String::from_utf8(projected.stdout.clone()).unwrap();
    assert!(text.ends_with("}\n"));
    assert!(text.starts_with("{\n  \""), "two-space indentation: {text}");
    let result = stdout_json(&projected);
    assert_eq!(result["success"], true);
    assert_eq!(result["data"]["defaultSpace"], "main");
    assert_eq!(result["data"]["spaces"][0]["id"], "main");
    assert_eq!(result["data"]["surfaces"]["toolStrategy"], "hybrid");
    assert_eq!(result["metadata"]["actorKind"], "human");
}

#[test]
fn exit_codes_follow_the_afd_cli() {
    let dir = minimal();
    assert_eq!(
        umbel(dir.path(), &["workspace", "show"]).status.code(),
        Some(0)
    );

    let unknown = umbel(dir.path(), &["call", "nope-nothing"]);
    assert_eq!(unknown.status.code(), Some(1));
    assert_eq!(stdout_json(&unknown)["error"]["code"], "COMMAND_NOT_FOUND");

    let usage = umbel(dir.path(), &["workspace"]);
    assert_eq!(usage.status.code(), Some(1));
    assert_eq!(stdout_json(&usage)["error"]["code"], "INVALID_INPUT");

    let flag = umbel(dir.path(), &["--no-such-flag", "workspace", "show"]);
    assert_eq!(flag.status.code(), Some(1));
    assert_eq!(stdout_json(&flag)["error"]["code"], "INVALID_INPUT");

    let nowhere = tempfile::tempdir().unwrap();
    let missing = umbel(nowhere.path(), &["workspace", "show"]);
    assert_eq!(missing.status.code(), Some(1));
    assert_eq!(
        stdout_json(&missing)["error"]["code"],
        "WORKSPACE_NOT_FOUND"
    );
}

#[test]
fn the_workspace_is_found_by_flag_then_environment_then_search() {
    let flagged = workspace("config_version = 1\nname = \"by-flag\"\n");
    let environment = workspace("config_version = 1\nname = \"by-env\"\n");
    let searched = workspace("config_version = 1\nname = \"by-search\"\n");
    std::fs::create_dir(searched.path().join("deep")).unwrap();
    let name = |output: &Output| {
        stdout_json(output)["data"]["name"]
            .as_str()
            .unwrap()
            .to_owned()
    };

    let searched_dir = searched.path().join("deep");
    assert_eq!(
        name(&umbel(&searched_dir, &["workspace", "show"])),
        "by-search"
    );

    let output = Command::new(env!("CARGO_BIN_EXE_umbel"))
        .args(["workspace", "show"])
        .current_dir(&searched_dir)
        .env("UMBEL_WORKSPACE", environment.path())
        .output()
        .unwrap();
    assert_eq!(name(&output), "by-env");

    let output = Command::new(env!("CARGO_BIN_EXE_umbel"))
        .arg("--workspace")
        .arg(flagged.path())
        .args(["workspace", "show"])
        .current_dir(&searched_dir)
        .env("UMBEL_WORKSPACE", environment.path())
        .output()
        .unwrap();
    assert_eq!(name(&output), "by-flag");
}

#[test]
fn the_doctor_exits_zero_on_a_fresh_workspace_and_reports_a_broken_one() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(umbel(dir.path(), &["init", "."]).status.code(), Some(0));
    let healthy = umbel(dir.path(), &["workspace", "doctor"]);
    assert_eq!(healthy.status.code(), Some(0), "{healthy:?}");
    let report = stdout_json(&healthy);
    assert_eq!(report["data"]["healthy"], true);
    let checks = report["data"]["checks"].as_array().unwrap();
    let status = |id: &str| {
        checks
            .iter()
            .find(|check| check["id"] == id)
            .unwrap_or_else(|| panic!("no check {id}"))["status"]
            .clone()
    };
    assert_eq!(status("mcp.surface"), "pass");
    assert_eq!(status("cli.verbs"), "pass");

    std::fs::write(dir.path().join("umbel.toml"), "config_version = [").unwrap();
    let broken = umbel(dir.path(), &["workspace", "doctor"]);
    assert_eq!(broken.status.code(), Some(1));
    let result = stdout_json(&broken);
    assert_eq!(result["error"]["code"], "WORKSPACE_UNHEALTHY");
    assert_eq!(result["error"]["details"]["healthy"], false);
}

#[test]
fn space_list_names_the_default_space() {
    let dir = two_spaces();
    let output = umbel(dir.path(), &["space", "list"]);
    let spaces = &stdout_json(&output)["data"]["spaces"];
    assert_eq!(spaces[0]["id"], "main");
    assert_eq!(spaces[0]["default"], true);
    assert_eq!(spaces[0]["head"], "v0:main:0");
    assert_eq!(spaces[1]["id"], "second");
    assert_eq!(spaces[1]["title"], "Second");
    assert_eq!(spaces[1]["default"], false);
}

#[test]
fn version_and_help_print_to_stdout_and_exit_zero() {
    let dir = tempfile::tempdir().unwrap();
    let version = umbel(dir.path(), &["--version"]);
    assert_eq!(version.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&version.stdout).starts_with("umbel "));
    let help = umbel(dir.path(), &["--help"]);
    assert_eq!(help.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&help.stdout).contains("init"));
}

#[test]
fn serve_is_reserved_but_not_yet_available() {
    let dir = minimal();
    let output = umbel(dir.path(), &["serve", "--stdio"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(stdout_json(&output)["error"]["code"], "NOT_IMPLEMENTED");
}

#[tokio::test]
async fn key_value_arguments_parse_as_json_when_they_can() {
    let dir = minimal();
    let seen = Arc::new(std::sync::Mutex::new(Value::Null));
    let record = Arc::clone(&seen);
    let run = cli_with(
        dir.path(),
        &[
            "call",
            "fixture-echo",
            "count=2",
            "done=true",
            "title=milk",
            "tags=[1,2]",
        ],
        Scripted::no_terminal(),
        move |builder| {
            builder.register_with_schema(
                fixture("fixture-echo", move |input, _| {
                    *record.lock().unwrap() = input.clone();
                    success(input)
                }),
                json!({"type": "object", "additionalProperties": true}),
            )
        },
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    assert_eq!(
        *seen.lock().unwrap(),
        json!({"count": 2, "done": true, "title": "milk", "tags": [1, 2]})
    );

    let bad = cli(dir.path(), &["call", "workspace-show", "oops"]).await;
    assert_eq!(bad.code, 1);
    assert_eq!(bad.error_code(), "INVALID_INPUT");
}

#[tokio::test]
async fn an_unknown_command_suggests_cli_exposed_names_and_an_mcp_only_one_is_not_exposed() {
    let dir = minimal();
    let configure = |builder: umbel::HostBuilder| {
        builder
            .register(with_exposure(
                fixture("secret-mcpwidget", |_, _| success(json!({}))),
                true,
                true,
                false,
            ))
            .register(fixture("widget-open", |_, _| success(json!({}))))
    };
    let unknown = cli_with(
        dir.path(),
        &["call", "widget-opne"],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    assert_eq!(unknown.code, 1);
    assert_eq!(unknown.error_code(), "COMMAND_NOT_FOUND");
    assert!(
        unknown.json()["error"]["suggestion"]
            .as_str()
            .unwrap()
            .contains("widget-open")
    );

    let mcp_only = cli_with(
        dir.path(),
        &["call", "secret-mcpwidget"],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    assert_eq!(mcp_only.code, 1);
    assert_eq!(mcp_only.error_code(), "COMMAND_NOT_EXPOSED");

    let near = cli_with(
        dir.path(),
        &["call", "secret-mcpwidgat"],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    let suggestion = near.json()["error"]["suggestion"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(!suggestion.contains("secret-mcpwidget"), "{suggestion}");
}

#[tokio::test]
async fn help_lists_what_the_cli_can_run_and_not_an_mcp_only_command() {
    let dir = minimal();
    let run = cli_with(dir.path(), &["help"], Scripted::no_terminal(), |builder| {
        builder
            .register(with_exposure(
                fixture("secret-mcpwidget", |_, _| success(json!({}))),
                true,
                true,
                false,
            ))
            .register(fixture("widget-open", |_, _| success(json!({}))))
    })
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    let listing = run.json().to_string();
    for listed in [
        "workspace-show",
        "space-list",
        "workspace-doctor",
        "widget-open",
        "afd-help",
        "afd-docs",
        "afd-schema",
    ] {
        assert!(listing.contains(listed), "{listed} missing from {listing}");
    }
    assert!(!listing.contains("secret-mcpwidget"));

    let docs = cli(dir.path(), &["docs", "workspace-show"]).await;
    assert_eq!(docs.code, 0);
    let schema = cli(dir.path(), &["schema", "--format", "typescript"]).await;
    assert_eq!(schema.code, 0, "{}", schema.stdout);
}

#[tokio::test]
async fn text_format_strips_escape_sequences_a_command_returns() {
    let dir = minimal();
    let run = cli_with(
        dir.path(),
        &["--format", "text", "call", "fixture-escape"],
        Scripted::no_terminal(),
        |builder| {
            builder.register(fixture("fixture-escape", |_, _| {
                afd::success(json!("ok\u{1b}]0;pwned\u{7}\u{1b}[31m red\u{1b}[0m"))
            }))
        },
    )
    .await;
    assert_eq!(run.code, 0);
    assert!(!run.stdout.contains('\u{1b}'), "{:?}", run.stdout);
    assert!(run.stdout.contains("ok red"), "{:?}", run.stdout);
    assert!(run.stdout.starts_with("✓ Success\n"));
}

#[tokio::test]
async fn batch_exits_two_when_a_command_fails_and_checks_each_item_against_the_cli() {
    let dir = minimal();
    let configure = |builder: umbel::HostBuilder| {
        builder.register(with_exposure(
            fixture("secret-mcpwidget", |_, _| success(json!({}))),
            true,
            true,
            false,
        ))
    };
    let ok = cli_with(
        dir.path(),
        &[
            "batch",
            r#"{"commands":[{"command":"workspace-show"},{"command":"space-list"}]}"#,
        ],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    assert_eq!(ok.code, 0, "{}", ok.stdout);
    assert_eq!(ok.json()["summary"]["successCount"], 2);

    let partial = cli_with(
        dir.path(),
        &[
            "batch",
            r#"{"commands":[{"command":"workspace-show"},{"command":"secret-mcpwidget"}]}"#,
        ],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    assert_eq!(partial.code, 2, "{}", partial.stdout);
    let results = &partial.json()["results"];
    assert_eq!(results[1]["result"]["error"]["code"], "COMMAND_NOT_EXPOSED");

    let invalid = cli(dir.path(), &["batch", r#"{"commands":[]}"#]).await;
    assert_eq!(invalid.code, 1);
    let not_json = cli(dir.path(), &["batch", "nonsense"]).await;
    assert_eq!(not_json.code, 1);
    assert_eq!(not_json.error_code(), "INVALID_INPUT");

    std::fs::write(
        dir.path().join("req.json"),
        r#"{"commands":[{"command":"workspace-show"}]}"#,
    )
    .unwrap();
    let from_file = cli(dir.path(), &["batch", "req.json"]).await;
    assert_eq!(from_file.code, 0, "{}", from_file.stdout);

    let text = cli(
        dir.path(),
        &[
            "--format",
            "text",
            "batch",
            r#"{"commands":[{"command":"workspace-show"}]}"#,
        ],
    )
    .await;
    assert!(
        text.stdout.starts_with("✓ Batch completed successfully"),
        "{}",
        text.stdout
    );
}

#[tokio::test]
async fn approvals_run_the_command_once_with_approve_or_at_a_terminal_and_never_otherwise() {
    let dir = minimal();
    let runs = Arc::new(AtomicUsize::new(0));
    let configure = |runs: Arc<AtomicUsize>| {
        move |builder: umbel::HostBuilder| builder.register(needs_approval("fixture-gated", runs))
    };

    let held = cli_with(
        dir.path(),
        &["call", "fixture-gated"],
        Scripted::no_terminal(),
        configure(runs.clone()),
    )
    .await;
    assert_eq!(held.code, 1);
    assert_eq!(held.error_code(), "APPROVAL_REQUIRED");
    assert!(!held.stdout.contains("approvalToken"));
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    let approved = cli_with(
        dir.path(),
        &["call", "fixture-gated", "--approve"],
        Scripted::no_terminal(),
        configure(runs.clone()),
    )
    .await;
    assert_eq!(approved.code, 0, "{}", approved.stdout);
    assert_eq!(runs.load(Ordering::SeqCst), 1);

    let terminal = Scripted::new(true, true);
    let asked = cli_with(
        dir.path(),
        &["call", "fixture-gated"],
        terminal.clone(),
        configure(runs.clone()),
    )
    .await;
    assert_eq!(asked.code, 0, "{}", asked.stdout);
    assert_eq!(runs.load(Ordering::SeqCst), 2);
    assert!(terminal.asked()[0].ends_with("Approve? [y/N] "));

    let declined = cli_with(
        dir.path(),
        &["call", "fixture-gated"],
        Scripted::new(true, false),
        configure(runs.clone()),
    )
    .await;
    assert_eq!(declined.error_code(), "APPROVAL_REQUIRED");
    assert_eq!(runs.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn confirmations_need_a_terminal_or_yes_and_require_human_refuses_yes() {
    let runs = Arc::new(AtomicUsize::new(0));
    let configure = |runs: Arc<AtomicUsize>| {
        move |builder: umbel::HostBuilder| {
            builder.register(needs_confirmation("fixture-confirm", runs))
        }
    };
    let dir = minimal();

    let none = cli_with(
        dir.path(),
        &["call", "fixture-confirm"],
        Scripted::no_terminal(),
        configure(runs.clone()),
    )
    .await;
    assert_eq!(none.error_code(), "CONFIRMATION_REQUIRED");
    assert!(
        none.json()["error"]["suggestion"]
            .as_str()
            .unwrap()
            .contains("--yes")
    );
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    let yes = cli_with(
        dir.path(),
        &["call", "fixture-confirm", "--yes"],
        Scripted::no_terminal(),
        configure(runs.clone()),
    )
    .await;
    assert_eq!(yes.code, 0, "{}", yes.stdout);
    assert_eq!(runs.load(Ordering::SeqCst), 1);

    let declined = cli_with(
        dir.path(),
        &["call", "fixture-confirm"],
        Scripted::new(true, false),
        configure(runs.clone()),
    )
    .await;
    assert_eq!(declined.error_code(), "CONFIRMATION_DECLINED");
    let accepted = cli_with(
        dir.path(),
        &["call", "fixture-confirm"],
        Scripted::new(true, true),
        configure(runs.clone()),
    )
    .await;
    assert_eq!(accepted.code, 0);
    assert_eq!(runs.load(Ordering::SeqCst), 2);

    let human = workspace("config_version = 1\n[mcp]\nconfirmations = \"require-human\"\n");
    let refused = cli_with(
        human.path(),
        &["call", "fixture-confirm", "--yes"],
        Scripted::no_terminal(),
        configure(runs.clone()),
    )
    .await;
    assert_eq!(refused.error_code(), "CONFIRMATION_REQUIRED");
    assert_eq!(runs.load(Ordering::SeqCst), 2);

    let off = workspace("config_version = 1\n[mcp]\nconfirmations = \"off\"\n");
    let free = cli_with(
        off.path(),
        &["call", "fixture-confirm"],
        Scripted::no_terminal(),
        configure(runs.clone()),
    )
    .await;
    assert_eq!(free.code, 0);
    assert_eq!(runs.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn stamps_a_handler_set_never_reach_the_cli_result() {
    let dir = minimal();
    let run = cli_with(
        dir.path(),
        &["call", "fixture-forge"],
        Scripted::no_terminal(),
        |builder| builder.register(forging_read("fixture-forge")),
    )
    .await;
    assert_eq!(run.code, 0);
    let metadata = run.json()["metadata"].clone();
    assert!(metadata.get("dev.umbel/mutation").is_none(), "{metadata}");
    assert!(metadata.get("dev.umbel/space").is_none(), "{metadata}");
    let _ = ResultMetadata::new();
}
