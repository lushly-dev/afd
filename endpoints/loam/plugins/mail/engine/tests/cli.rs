//! The command line, in process and as the built program.

#![allow(clippy::expect_used)]

use std::process::Command;

use loam_mail::cli::{EXIT_OK, EXIT_USAGE, run};

fn run_with(args: &[&str]) -> (u8, String, String) {
    let registry = loam_mail::registry().expect("the engine's registry is sound");
    let args: Vec<String> = args.iter().map(ToString::to_string).collect();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let status = run(&args, &registry, &mut out, &mut err).expect("writing to memory");
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
