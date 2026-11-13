//! A person decision's lifetime (the Ideas host-review specification, section 4): the parsing
//! half, from step H1. `person.decision_ttl_s` defaults to phase 5's ten minutes, is honoured
//! between 60 seconds and 24 hours, and is refused outside them. Step H2 adds the lifetime's
//! behaviour: each render moving the expiry, and the hosted login living until its decision
//! expires.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;

use umbel::workspace::{
    DEFAULT_DECISION_TTL_S, PERSON_DECISION_TTL_MAX_S, PERSON_DECISION_TTL_MIN_S, Workspace,
    WorkspaceError,
};

fn open(text: &str) -> Result<Workspace, WorkspaceError> {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("ws");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("umbel.toml"), text).unwrap();
    Workspace::open(&root)
}

fn ttl(text: &str) -> u64 {
    open(text)
        .unwrap_or_else(|error| panic!("{text}: {error}"))
        .config()
        .person
        .decision_ttl_s
}

#[test]
fn the_default_is_600_seconds() {
    assert_eq!(DEFAULT_DECISION_TTL_S, 600);
    assert_eq!(DEFAULT_DECISION_TTL_S, umbel::auth::PERSON_DECISION_TTL_S);
    for text in [
        "config_version = 5\n",
        "config_version = 6\n",
        "config_version = 7\n",
        "config_version = 7\n[person]\n",
    ] {
        assert_eq!(ttl(text), 600, "{text}");
    }
}

#[test]
fn decision_ttl_s_is_honoured_from_a_minute_to_a_day() {
    assert_eq!(
        (PERSON_DECISION_TTL_MIN_S, PERSON_DECISION_TTL_MAX_S),
        (60, 86_400)
    );
    for seconds in [60, 600, 3600, 86_400] {
        assert_eq!(
            ttl(&format!(
                "config_version = 7\n[person]\ndecision_ttl_s = {seconds}\n"
            )),
            seconds
        );
    }
}

#[test]
fn decision_ttl_s_out_of_range_is_refused() {
    for value in ["59", "0", "-600", "86401", "\"1h\"", "600.0"] {
        let text = format!("config_version = 7\n[person]\ndecision_ttl_s = {value}\n");
        let error = open(&text).expect_err(&text);
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{text}: {error}");
        assert_eq!(
            error.key(),
            Some("person.decision_ttl_s"),
            "{text}: {error}"
        );
    }
    // Before version 7 the key does not exist.
    let error = open("config_version = 6\n[person]\ndecision_ttl_s = 3600\n").unwrap_err();
    assert_eq!(error.key(), Some("person"));
    assert!(
        error.message().contains("needs config_version = 7"),
        "{error}"
    );
}
