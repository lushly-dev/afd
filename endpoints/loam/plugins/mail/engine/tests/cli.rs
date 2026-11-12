//! The command line, in process and as the built program.

#![allow(clippy::expect_used)]

use std::process::Command;

use std::sync::Arc;

use loam_mail::cli::{Caller, EXIT_FAILED, EXIT_OK, EXIT_USAGE, run};
use loam_mail::engine::Engine;
use loam_mail::home::Home;

fn run_with(args: &[&str]) -> (u8, String, String) {
    run_in(None, args)
}

fn run_in(home: Option<Home>, args: &[&str]) -> (u8, String, String) {
    let registry =
        loam_mail::registry(&Arc::new(Engine::new(home))).expect("the engine's registry is sound");
    let args: Vec<String> = args.iter().map(ToString::to_string).collect();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let status = run(
        &args,
        &registry,
        Caller::Script,
        &loam_mail::secrets::InMemory::default(),
        &mut out,
        &mut err,
    )
    .expect("writing to memory");
    (
        status,
        String::from_utf8(out).expect("utf-8"),
        String::from_utf8(err).expect("utf-8"),
    )
}

#[test]
fn help_is_the_default_and_names_the_program() {
    for args in [&[][..], &["help"], &["--help"], &["-h"]] {
        let (status, out, err) = run_with(args);
        assert_eq!(status, EXIT_OK);
        assert!(out.starts_with("loam-mail: "), "{out}");
        assert!(out.contains("loam-mail help"));
        assert!(err.is_empty());
    }
}

#[test]
fn version_prints_the_crate_version() {
    let (status, out, _) = run_with(&["version"]);
    assert_eq!(status, EXIT_OK);
    assert_eq!(out, format!("loam-mail {}\n", env!("CARGO_PKG_VERSION")));
}

#[test]
fn an_unknown_argument_fails_and_points_to_help() {
    let (status, out, err) = run_with(&["mail-draft-send"]);
    assert_eq!(status, EXIT_USAGE);
    assert!(out.is_empty());
    assert!(err.contains("`mail-draft-send` is not something this build can do"));
    assert!(err.contains("loam-mail help"));
}

#[test]
fn an_unknown_argument_is_echoed_without_control_characters() {
    let (_, _, err) = run_with(&["\u{1b}[2Jgone\u{7}"]);
    assert!(err.contains("`[2Jgone`"), "{err:?}");
    assert!(!err.contains('\u{1b}') && !err.contains('\u{7}'));
}

#[test]
fn the_built_program_answers_help() {
    let output = Command::new(env!("CARGO_BIN_EXE_loam-mail"))
        .arg("help")
        .output()
        .expect("the program runs");
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).starts_with("loam-mail: "));
    let refused = Command::new(env!("CARGO_BIN_EXE_loam-mail"))
        .arg("serve")
        .output()
        .expect("the program runs");
    assert_eq!(refused.status.code(), Some(2));
}

#[test]
fn help_lists_the_commands_the_command_line_can_run() {
    let (_, out, _) = run_with(&["help"]);
    assert!(out.contains("Commands:\n"), "{out}");
    for command in [
        "mail-account-add",
        "mail-account-list",
        "mail-rebuild",
        "mail-status",
        "mail-sync",
    ] {
        assert!(out.contains(&format!("  {command}  ")), "{out}");
    }
}

#[test]
fn a_command_runs_and_prints_its_result_as_json() {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let home = Home::at(directory.path().join("data"));
    let (status, out, err) = run_in(Some(home.clone()), &["mail-rebuild"]);
    assert_eq!(status, EXIT_OK, "{out}{err}");
    let result: serde_json::Value = serde_json::from_str(&out).expect("JSON");
    assert_eq!(result["success"], true);
    assert_eq!(result["data"]["messages"], 0);
    assert_eq!(result["data"]["threads"], 0);
    assert_eq!(result["data"]["resumed"], false);
    assert_eq!(result["metadata"]["actorKind"], "script");
    // An empty object is the same as no input.
    let (status, _, _) = run_in(Some(home), &["mail-rebuild", "{}"]);
    assert_eq!(status, EXIT_OK);
}

#[test]
fn an_input_that_is_not_one_json_object_is_refused_before_the_command_runs() {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let home = Home::at(directory.path().join("data"));
    for args in [
        &["mail-rebuild", "[]"][..],
        &["mail-rebuild", "not json"],
        &["mail-rebuild", "{}", "{}"],
    ] {
        let (status, out, err) = run_in(Some(home.clone()), args);
        assert_eq!(status, EXIT_USAGE, "{args:?}");
        assert!(out.is_empty());
        assert!(err.contains("JSON object"), "{err}");
    }
    assert!(!home.root().exists(), "nothing was opened");
}

#[test]
fn a_command_that_fails_says_why_as_json_and_exits_with_one() {
    // No data directory can be worked out: the command fails, help does not.
    let (status, out, _) = run_in(None, &["mail-rebuild"]);
    assert_eq!(status, EXIT_FAILED);
    let result: serde_json::Value = serde_json::from_str(&out).expect("JSON");
    assert_eq!(result["success"], false);
    assert_eq!(result["error"]["code"], "STORE_FAILED");
    assert!(result["error"]["suggestion"].is_string());
}

#[test]
fn a_store_another_process_owns_fails_the_command_with_its_code() {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let home = Home::at(directory.path().join("data"));
    let _owner = loam_mail::store::Store::open(&home).expect("the store opens");
    let (status, out, _) = run_in(Some(home), &["mail-rebuild"]);
    assert_eq!(status, EXIT_FAILED);
    let result: serde_json::Value = serde_json::from_str(&out).expect("JSON");
    assert_eq!(result["error"]["code"], "STORE_IN_USE");
}

#[test]
fn the_built_program_rebuilds_the_store_it_is_pointed_at() {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let output = Command::new(env!("CARGO_BIN_EXE_loam-mail"))
        .arg("mail-rebuild")
        .env("LOAM_MAIL_HOME", directory.path().join("data"))
        .output()
        .expect("the program runs");
    assert!(output.status.success(), "{output:?}");
    let result: serde_json::Value = serde_json::from_slice(&output.stdout).expect("JSON");
    assert_eq!(result["success"], true);
    assert!(directory.path().join("data/mail.sqlite3").exists());
    assert!(output.stderr.is_empty(), "no progress without a terminal");
}
