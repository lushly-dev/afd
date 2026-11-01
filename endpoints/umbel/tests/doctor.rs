//! The doctor's checks that need no registry, and `skip` for the ones that do
//! (specification sections 2 and 10).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use serde_json::{Value, json};
use umbel::doctor::{self, Check, CheckStatus, Report};
use umbel::workspace::Workspace;

fn fresh() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("ws");
    Workspace::init(&root, None).unwrap();
    (dir, root)
}

fn with_config(text: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("ws");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("umbel.toml"), text).unwrap();
    (dir, root)
}

fn check<'a>(report: &'a Report, id: &str) -> &'a Check {
    report
        .checks
        .iter()
        .find(|check| check.id == id)
        .unwrap_or_else(|| panic!("no check {id}"))
}

fn status(report: &Report, id: &str) -> CheckStatus {
    check(report, id).status
}

fn journal_line(seq: u64, mutation_space: Option<&str>) -> String {
    let metadata = mutation_space.map_or_else(
        || json!({}),
        |space| json!({ "dev.umbel/mutation": true, "dev.umbel/space": space }),
    );
    json!({
        "seq": seq,
        "timestamp": "2026-11-02T10:15:00.000Z",
        "command": "note-add",
        "input": {},
        "contextDigest": { "hash": "sha256:00", "interface": "agent" },
        "result": { "success": true, "data": {}, "metadata": metadata },
        "durationMs": 1
    })
    .to_string()
}

fn event_line(space: &str, seq: u64, journal_seq: u64) -> String {
    json!({
        "version": 0, "id": format!("{space}:{seq}"), "space": space, "seq": seq,
        "cursor": format!("v0:{space}:{seq}"), "journalSeq": journal_seq, "command": "note-add",
        "timestamp": "2026-11-02T10:15:00.000Z", "record": null, "provenance": {}
    })
    .to_string()
}

fn write_journal(root: &Path, lines: &[String]) {
    fs::write(
        root.join("state/journal.jsonl"),
        lines.iter().map(|l| format!("{l}\n")).collect::<String>(),
    )
    .unwrap();
}

fn write_events(root: &Path, space: &str, text: &str) {
    let dir = root.join("state/spaces").join(space);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("events.jsonl"), text).unwrap();
}

#[test]
fn a_fresh_workspace_is_healthy_with_two_skipped_checks() {
    let (_dir, root) = fresh();
    let report = doctor::run(&root);
    assert!(report.healthy());
    let ids: Vec<_> = report.checks.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "workspace.found",
            "config.parse",
            "config.keys",
            "spaces.valid",
            "state.writable",
            "state.lock",
            "keys.present",
            "journal.readable",
            "events.consistent",
            "http.config",
            "mcp.surface",
            "cli.verbs",
            "plugins.none"
        ]
    );
    for check in &report.checks {
        let expected = if check.id == "mcp.surface" || check.id == "cli.verbs" {
            CheckStatus::Skip
        } else {
            CheckStatus::Pass
        };
        assert_eq!(check.status, expected, "{}: {}", check.id, check.message);
    }
    assert_eq!(
        check(&report, "mcp.surface").message,
        "Needs a sealed host; run umbel workspace doctor on a workspace that opens."
    );
    assert!(
        report
            .checks
            .iter()
            .all(|c| c.suggestion.is_none() || c.status != CheckStatus::Pass)
    );

    let data = report.data();
    assert_eq!(data["healthy"], true);
    assert_eq!(data["foundBy"], "flag");
    assert_eq!(data["workspace"], root.display().to_string());
    let result = report.into_result();
    assert!(result.success);
    assert!(result.warnings.is_none());
}

#[test]
fn workspace_found_fails_without_a_workspace_and_reports_nothing_else() {
    let dir = tempfile::tempdir().unwrap();
    let report = doctor::run(dir.path());
    assert!(!report.healthy());
    assert_eq!(report.checks.len(), 1);
    assert_eq!(status(&report, "workspace.found"), CheckStatus::Fail);
    assert!(
        check(&report, "workspace.found")
            .suggestion
            .as_deref()
            .unwrap()
            .contains("umbel init")
    );
    assert_eq!(report.data()["workspace"], Value::Null);
}

#[test]
fn a_workspace_whose_umbel_toml_does_not_parse_is_still_reported() {
    let (_dir, root) = with_config("config_version = [\n");
    let report = doctor::run(&root);
    assert!(!report.healthy());
    assert_eq!(status(&report, "workspace.found"), CheckStatus::Pass);
    assert_eq!(status(&report, "config.parse"), CheckStatus::Fail);
    for id in ["config.keys", "spaces.valid", "http.config", "plugins.none"] {
        assert_eq!(status(&report, id), CheckStatus::Skip, "{id}");
    }
    // The checks that need no configuration still run.
    assert_eq!(status(&report, "state.writable"), CheckStatus::Pass);
    assert_eq!(status(&report, "journal.readable"), CheckStatus::Pass);
}

#[test]
fn config_parse_fails_for_another_version_and_names_the_supported_one() {
    let (_dir, root) = with_config("config_version = 2\n");
    let report = doctor::run(&root);
    let parse = check(&report, "config.parse");
    assert_eq!(parse.status, CheckStatus::Fail);
    assert!(parse.message.contains("version 1"));
    assert!(parse.suggestion.is_some());
}

#[test]
fn a_workspace_that_will_not_open_is_never_reported_healthy() {
    for text in [
        "config_version = 1\n[journal]\nlock_timeout_ms = 5\n",
        "config_version = 1\n[mcp]\nconfirmations = \"x\"\n",
        "config_version = 1\n[log]\nlevel = \"loud\"\n",
        "config_version = 1\n[principal]\nlocal_id = \"\"\n",
        "config_version = 1\nprofile = \"solo\"\n",
        "config_version = 1\n[http]\nbind = \"0.0.0.0:1\"\n",
        "config_version = 1\n[http]\npath = \"/health\"\n",
        "config_version = 1\n[http]\nallowed_hosts = [\"*\"]\n",
        "config_version = 1\n[http]\nallowed_origins = [\"null\"]\n",
        "config_version = 1\ndefault_space = \"x\"\n",
        "config_version = 1\n[spaces.Bad]\n",
        "config_version = 1\n[plugins]\nenabled = [\"x\"]\n",
        "config_version = 1\nbogus = true\n",
    ] {
        let (_dir, root) = with_config(text);
        assert!(!doctor::run(&root).healthy(), "{text}");
        assert!(Workspace::open(&root).is_err(), "{text}");
    }
}

#[test]
fn config_keys_fails_on_unknown_and_warns_on_reserved() {
    let (_dir, root) = with_config("config_version = 1\nbogus = 1\n[http]\nnope = 2\n");
    let report = doctor::run(&root);
    let keys = check(&report, "config.keys");
    assert_eq!(keys.status, CheckStatus::Fail);
    assert!(keys.message.contains("bogus") && keys.message.contains("http.nope"));

    let (_dir, root) = with_config(
        "config_version = 1\n[events]\nretention = \"forever\"\n[spaces.main]\nbackend = \"embedded\"\n",
    );
    let report = doctor::run(&root);
    let keys = check(&report, "config.keys");
    assert_eq!(keys.status, CheckStatus::Warn);
    assert!(
        keys.message.contains("events.retention") && keys.message.contains("spaces.main.backend")
    );
    assert!(report.healthy());
    let result = report.into_result();
    assert!(result.success);
    let warnings = result.warnings.unwrap();
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].code, "DOCTOR_CONFIG_KEYS");
}

#[test]
fn spaces_valid_fails_on_a_bad_id_or_an_undeclared_default() {
    for text in [
        "config_version = 1\n[spaces.Bad]\n",
        "config_version = 1\ndefault_space = \"x\"\n",
        "config_version = 1\n[spaces.a]\n[spaces.b]\n",
    ] {
        let (_dir, root) = with_config(text);
        let report = doctor::run(&root);
        assert_eq!(status(&report, "spaces.valid"), CheckStatus::Fail, "{text}");
    }
}

#[test]
fn state_writable_fails_when_state_is_not_a_directory_and_passes_when_it_can_be_created() {
    let (_dir, root) = with_config("config_version = 1\n");
    assert_eq!(
        status(&doctor::run(&root), "state.writable"),
        CheckStatus::Pass
    );
    assert_eq!(
        status(&doctor::run(&root), "state.lock"),
        CheckStatus::Pass,
        "no state/ yet"
    );
    assert!(
        !root.join("state").exists(),
        "the doctor creates nothing under state/ when it is missing"
    );

    fs::write(root.join("state"), "a file").unwrap();
    let report = doctor::run(&root);
    assert_eq!(status(&report, "state.writable"), CheckStatus::Fail);
    assert!(
        check(&report, "state.writable")
            .suggestion
            .as_deref()
            .unwrap()
            .starts_with("Make ")
    );
}

#[test]
fn state_lock_warns_after_a_second_and_fails_after_the_timeout() {
    let (_dir, root) = fresh();
    let workspace = Workspace::open(&root).unwrap();

    // Held 1.4 s of a 10 s timeout: taken, but late.
    let held = workspace.lock().unwrap();
    let release = thread::spawn(move || {
        thread::sleep(Duration::from_millis(1400));
        drop(held);
    });
    let report = doctor::run(&root);
    release.join().unwrap();
    assert_eq!(status(&report, "state.lock"), CheckStatus::Warn);
    assert!(report.healthy());

    fs::write(
        root.join("umbel.toml"),
        "config_version = 1\n[journal]\nlock_timeout_ms = 100\n",
    )
    .unwrap();
    let held = workspace.lock().unwrap();
    let report = doctor::run(&root);
    assert_eq!(status(&report, "state.lock"), CheckStatus::Fail);
    assert!(
        check(&report, "state.lock")
            .suggestion
            .as_deref()
            .unwrap()
            .contains("more than")
    );
    drop(held);
    assert_eq!(status(&doctor::run(&root), "state.lock"), CheckStatus::Pass);
}

#[test]
fn keys_present_passes_warns_and_fails() {
    let (_dir, root) = fresh();
    let approval = root.join("state/keys/approval.key");

    // A missing key that can be created passes.
    fs::remove_file(&approval).unwrap();
    assert_eq!(
        status(&doctor::run(&root), "keys.present"),
        CheckStatus::Pass
    );
    Workspace::open(&root).unwrap();

    // A short key fails and the suggestion says to delete it.
    fs::write(&approval, [1u8; 31]).unwrap();
    let report = doctor::run(&root);
    assert_eq!(status(&report, "keys.present"), CheckStatus::Fail);
    assert!(
        check(&report, "keys.present")
            .message
            .contains("approval.key")
    );
    fs::remove_file(&approval).unwrap();
    Workspace::open(&root).unwrap();

    // A malformed token fails; a good one passes.
    let token = root.join("state/keys/http.token");
    fs::write(&token, "NOT-HEX").unwrap();
    assert_eq!(
        status(&doctor::run(&root), "keys.present"),
        CheckStatus::Fail
    );
    fs::remove_file(&token).unwrap();
    Workspace::open(&root).unwrap().http_token().unwrap();
    assert_eq!(
        status(&doctor::run(&root), "keys.present"),
        CheckStatus::Pass
    );

    // A missing key that cannot be created fails.
    fs::remove_file(&approval).unwrap();
    fs::remove_file(&token).unwrap();
    fs::remove_file(root.join("state/keys/confirmation.key")).unwrap();
    fs::remove_dir(root.join("state/keys")).unwrap();
    fs::write(root.join("state/keys"), "a file").unwrap();
    assert_eq!(
        status(&doctor::run(&root), "keys.present"),
        CheckStatus::Fail
    );
}

#[cfg(unix)]
#[test]
fn keys_present_warns_on_wider_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let (_dir, root) = fresh();
    let key = root.join("state/keys/confirmation.key");
    fs::set_permissions(&key, fs::Permissions::from_mode(0o644)).unwrap();
    let report = doctor::run(&root);
    assert_eq!(status(&report, "keys.present"), CheckStatus::Warn);
    assert!(report.healthy());
    assert!(
        check(&report, "keys.present")
            .message
            .contains("confirmation.key")
    );
    fs::set_permissions(&key, fs::Permissions::from_mode(0o400)).unwrap();
    assert_eq!(
        status(&doctor::run(&root), "keys.present"),
        CheckStatus::Pass
    );
}

#[test]
fn journal_readable_reports_entries_a_torn_tail_and_a_bad_line() {
    let (_dir, root) = fresh();
    assert_eq!(
        status(&doctor::run(&root), "journal.readable"),
        CheckStatus::Pass
    );

    write_journal(&root, &[journal_line(1, None), journal_line(2, None)]);
    let report = doctor::run(&root);
    let journal = check(&report, "journal.readable");
    assert_eq!(journal.status, CheckStatus::Pass);
    assert!(
        journal.message.contains("2 entries") && journal.message.contains("last seq 2"),
        "{}",
        journal.message
    );

    let mut torn = fs::read_to_string(root.join("state/journal.jsonl")).unwrap();
    torn.push_str("{\"seq\":3,\"time");
    fs::write(root.join("state/journal.jsonl"), &torn).unwrap();
    let report = doctor::run(&root);
    assert_eq!(status(&report, "journal.readable"), CheckStatus::Warn);
    assert!(report.healthy());

    let broken = format!(
        "{}\nnot json\n{}\n",
        journal_line(1, None),
        journal_line(3, None)
    );
    fs::write(root.join("state/journal.jsonl"), broken).unwrap();
    let report = doctor::run(&root);
    assert_eq!(status(&report, "journal.readable"), CheckStatus::Fail);
    assert!(
        check(&report, "journal.readable")
            .message
            .contains("line 2")
    );

    // A complete last line that is not an entry is a failure, not a torn tail.
    fs::write(
        root.join("state/journal.jsonl"),
        format!("{}\nnot json\n", journal_line(1, None)),
    )
    .unwrap();
    assert_eq!(
        status(&doctor::run(&root), "journal.readable"),
        CheckStatus::Fail
    );
}

#[test]
fn events_consistent_passes_when_the_streams_hold_every_mutation() {
    let (_dir, root) = fresh();
    write_journal(
        &root,
        &[
            journal_line(1, Some("main")),
            journal_line(2, None),
            journal_line(3, Some("main")),
        ],
    );
    write_events(
        &root,
        "main",
        &format!(
            "{}\n{}\n",
            event_line("main", 1, 1),
            event_line("main", 2, 3)
        ),
    );
    let report = doctor::run(&root);
    assert_eq!(
        status(&report, "events.consistent"),
        CheckStatus::Pass,
        "{}",
        check(&report, "events.consistent").message
    );
}

#[test]
fn events_consistent_warns_when_behind_or_marked_and_suggests_a_rebuild() {
    let (_dir, root) = fresh();
    write_journal(
        &root,
        &[journal_line(1, Some("main")), journal_line(2, Some("main"))],
    );
    write_events(&root, "main", &format!("{}\n", event_line("main", 1, 1)));
    let report = doctor::run(&root);
    let events = check(&report, "events.consistent");
    assert_eq!(events.status, CheckStatus::Warn);
    assert!(events.message.contains("no event"));
    assert!(
        events
            .suggestion
            .as_deref()
            .unwrap()
            .contains("umbel event rebuild")
    );
    assert!(report.healthy());

    write_events(
        &root,
        "main",
        &format!(
            "{}\n{}\n",
            event_line("main", 1, 1),
            event_line("main", 2, 2)
        ),
    );
    assert_eq!(
        status(&doctor::run(&root), "events.consistent"),
        CheckStatus::Pass
    );
    fs::write(root.join("state/projection.pending"), "").unwrap();
    let report = doctor::run(&root);
    assert_eq!(status(&report, "events.consistent"), CheckStatus::Warn);
    assert!(
        check(&report, "events.consistent")
            .message
            .contains("projection.pending")
    );
}

#[test]
fn events_consistent_fails_on_disorder_and_unparsable_lines_and_warns_on_a_torn_tail() {
    let (_dir, root) = fresh();
    for (name, text) in [
        (
            "a seq gap",
            format!(
                "{}\n{}\n",
                event_line("main", 1, 1),
                event_line("main", 3, 2)
            ),
        ),
        (
            "a stream not starting at 1",
            format!("{}\n", event_line("main", 2, 1)),
        ),
        (
            "journalSeq going back",
            format!(
                "{}\n{}\n",
                event_line("main", 1, 5),
                event_line("main", 2, 4)
            ),
        ),
        (
            "journalSeq repeating",
            format!(
                "{}\n{}\n",
                event_line("main", 1, 5),
                event_line("main", 2, 5)
            ),
        ),
        (
            "an unparsable middle line",
            format!(
                "{}\nnope\n{}\n",
                event_line("main", 1, 1),
                event_line("main", 2, 2)
            ),
        ),
    ] {
        write_events(&root, "main", &text);
        let report = doctor::run(&root);
        assert_eq!(
            status(&report, "events.consistent"),
            CheckStatus::Fail,
            "{name}"
        );
        assert!(!report.healthy(), "{name}");
    }
    write_events(
        &root,
        "main",
        &format!("{}\n{{\"seq\":2,\"jour", event_line("main", 1, 1)),
    );
    let report = doctor::run(&root);
    assert_eq!(status(&report, "events.consistent"), CheckStatus::Warn);
    assert!(report.healthy());
}

#[test]
fn events_are_found_by_directory_when_the_configuration_is_unreadable() {
    let (_dir, root) = fresh();
    write_events(&root, "main", &format!("{}\n", event_line("main", 2, 1)));
    fs::write(root.join("umbel.toml"), "config_version = [\n").unwrap();
    let report = doctor::run(&root);
    assert_eq!(status(&report, "events.consistent"), CheckStatus::Fail);
}

#[test]
fn http_config_and_plugins_none_fail_on_their_rules() {
    let (_dir, root) = with_config(
        "config_version = 1\n[http]\nbind = \"0.0.0.0:1\"\n[plugins]\nenabled = [\"x\"]\n",
    );
    let report = doctor::run(&root);
    assert_eq!(status(&report, "http.config"), CheckStatus::Fail);
    assert_eq!(status(&report, "plugins.none"), CheckStatus::Fail);
    assert!(check(&report, "plugins.none").message.contains("phase 1"));
    // Each of these rules is reported by its own check, so config.parse stays a pass.
    assert_eq!(status(&report, "config.parse"), CheckStatus::Pass);
}

#[test]
fn an_unhealthy_report_is_the_failure_workspace_unhealthy_with_the_report_as_details() {
    let (_dir, root) = with_config(
        "config_version = 1\n[http]\npath = \"/health\"\n[plugins]\nenabled = [\"x\"]\n",
    );
    let report = doctor::run(&root);
    let first = report
        .checks
        .iter()
        .find(|c| c.status == CheckStatus::Fail)
        .unwrap()
        .clone();
    let data = report.data();
    let result = report.into_result();
    assert!(!result.success);
    let error = result.error.unwrap();
    assert_eq!(error.code, "WORKSPACE_UNHEALTHY");
    assert_eq!(error.suggestion, first.suggestion);
    let details = error.details.unwrap();
    assert_eq!(details["healthy"], false);
    assert_eq!(details["checks"], data["checks"]);
    assert_eq!(details["workspace"], data["workspace"]);
}

#[test]
fn a_skip_never_makes_the_workspace_unhealthy_and_a_warning_never_either() {
    let report = Report {
        workspace: None,
        found_by: None,
        checks: vec![
            Check::skip_sealed("mcp.surface"),
            Check::warn("state.lock", "slow", "wait"),
        ],
    };
    assert!(report.healthy());
    let result = report.into_result();
    assert!(result.success);
    assert_eq!(result.warnings.unwrap()[0].code, "DOCTOR_STATE_LOCK");
}
