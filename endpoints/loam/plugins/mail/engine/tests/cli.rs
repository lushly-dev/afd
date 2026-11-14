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
    let directory = tempfile::tempdir().expect("a temporary directory");
    let data = directory.path().join("data");
    let output = Command::new(env!("CARGO_BIN_EXE_loam-mail"))
        .arg("help")
        .env("LOAM_MAIL_HOME", &data)
        .output()
        .expect("the program runs");
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).starts_with("loam-mail: "));
    // Arguments `serve` does not take are refused before anything is opened.
    for args in [
        &["serve", "--port"][..],
        &["serve", "--port", "x"],
        &["serve", "now"],
    ] {
        let refused = Command::new(env!("CARGO_BIN_EXE_loam-mail"))
            .args(args)
            .env("LOAM_MAIL_HOME", &data)
            .output()
            .expect("the program runs");
        assert_eq!(refused.status.code(), Some(2), "{args:?}");
    }
    assert!(!data.exists(), "nothing was made");
}

/// Stops a child process when the test ends, however it ends.
struct Child(std::process::Child);

impl Drop for Child {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[cfg(unix)]
#[test]
fn the_built_program_serves_forwards_and_cleans_up_when_asked_to_stop() {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let data = directory.path().join("data");
    let program = env!("CARGO_BIN_EXE_loam-mail");
    let mut server = Child(
        Command::new(program)
            .arg("serve")
            .env("LOAM_MAIL_HOME", &data)
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("the server starts"),
    );
    let entry = data.join("server.json");
    let started = std::time::Instant::now();
    while !entry.exists() {
        assert!(
            started.elapsed() < std::time::Duration::from_secs(30),
            "the server never wrote server.json"
        );
        if let Some(status) = server.0.try_wait().expect("the server's status") {
            panic!("the server stopped: {status}");
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    // The store is the server's: the command goes to it, and runs.
    let output = Command::new(program)
        .arg("mail-token-list")
        .env("LOAM_MAIL_HOME", &data)
        .stdin(std::process::Stdio::null())
        .output()
        .expect("the program runs");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("\"tokens\""));
    // A person's command with no terminal still needs a person.
    let output = Command::new(program)
        .args(["mail-token-create", r#"{"name":"x"}"#])
        .env("LOAM_MAIL_HOME", &data)
        .stdin(std::process::Stdio::null())
        .output()
        .expect("the program runs");
    assert!(String::from_utf8_lossy(&output.stdout).contains("PERSON_REQUIRED"));
    // `mcp` on the same store names the server instead.
    let output = Command::new(program)
        .arg("mcp")
        .env("LOAM_MAIL_HOME", &data)
        .stdin(std::process::Stdio::null())
        .output()
        .expect("the program runs");
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("STORE_IN_USE"));

    // A request to end stops it, and it removes its files.
    let pid = server.0.id().to_string();
    let killed = Command::new("kill")
        .args(["-TERM", &pid])
        .status()
        .expect("kill runs");
    assert!(killed.success());
    let status = server.0.wait().expect("the server ends");
    assert!(status.success(), "{status}");
    assert!(!entry.exists());
    assert!(!data.join("cli.token").exists());
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
    // Nothing in the data directory, the index's files included, is open to
    // others.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut entries = vec![directory.path().join("data")];
        let mut index_files = 0;
        while let Some(path) = entries.pop() {
            let metadata = std::fs::metadata(&path).expect("metadata");
            assert_eq!(
                metadata.permissions().mode() & 0o077,
                0,
                "{} is open to others",
                path.display()
            );
            if metadata.is_dir() {
                for entry in std::fs::read_dir(&path).expect("a directory") {
                    entries.push(entry.expect("an entry").path());
                }
            } else if path
                .parent()
                .is_some_and(|parent| parent.ends_with("index"))
            {
                index_files += 1;
            }
        }
        assert!(index_files > 0, "the rebuild made the index");
    }
}
