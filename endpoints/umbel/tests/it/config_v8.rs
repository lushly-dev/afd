//! `umbel.toml`, configuration version 8 (D212): `limits.kind_records` and
//! `limits.kind_postings`, the records write quota, each with its default and its refusals;
//! versions 1 to 7 refusing the keys and reading as version 8 with the default quota; `umbel
//! init` writing version 8; and the schema file accepting and refusing the same files.
use std::fs;
use std::path::{Path, PathBuf};

use jsonschema::Validator;
use serde_json::{Value, json};
use umbel::workspace::{
    ConfigFile, DEFAULT_KIND_POSTINGS, DEFAULT_KIND_RECORDS, MAX_KIND_LIMIT, Workspace,
    WorkspaceError, default_record_quota,
};
use umbel_store::lane::RecordQuota;

/// A workspace holding `text` as its `umbel.toml`, left on disk for the test's run.
fn workspace_root(text: &str) -> PathBuf {
    let dir = tempfile::tempdir().unwrap().keep();
    let root = dir.join("ws");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("umbel.toml"), text).unwrap();
    root
}

fn open(text: &str) -> Result<Workspace, WorkspaceError> {
    Workspace::open(workspace_root(text))
}

/// The refusal of `text`, which must be `WORKSPACE_CONFIG_INVALID` naming exactly `key`.
#[track_caller]
fn invalid(text: &str, key: &str) -> WorkspaceError {
    let error = open(text).expect_err(text);
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{text}: {error}");
    assert_eq!(error.key(), Some(key), "{text}: {error}");
    error
}

#[test]
fn the_defaults_apply_in_a_hosted_mode_and_mode_none_limits_only_what_it_sets() {
    assert_eq!(DEFAULT_KIND_RECORDS, 50_000);
    assert_eq!(DEFAULT_KIND_POSTINGS, 1_000_000);
    assert_eq!(DEFAULT_KIND_POSTINGS, umbel_store::lane::MATCH_POSTINGS / 4);
    let file = ConfigFile::parse("config_version = 8\n").unwrap();
    let hosted = file.record_quota(true).unwrap();
    assert_eq!(
        (hosted.records, hosted.postings),
        (DEFAULT_KIND_RECORDS, DEFAULT_KIND_POSTINGS)
    );
    assert_eq!(file.record_quota(false).unwrap(), RecordQuota::unlimited());
    // A workspace in mode none, the default, has no limit until a key sets one.
    let quota = open("config_version = 8\n").unwrap().record_quota();
    assert_eq!(quota, RecordQuota::unlimited());
    let quota = open("config_version = 8\n\n[limits]\nkind_postings = 9\n")
        .unwrap()
        .record_quota();
    assert_eq!((quota.records, quota.postings), (u64::MAX, 9));
    // In a hosted mode a key not set is its default.
    let file = ConfigFile::parse("config_version = 8\n\n[limits]\nkind_records = 7\n").unwrap();
    let quota = file.record_quota(true).unwrap();
    assert_eq!((quota.records, quota.postings), (7, DEFAULT_KIND_POSTINGS));
    // Before version 8, the mode's defaults.
    let file = ConfigFile::parse("config_version = 7\n").unwrap();
    assert_eq!(file.record_quota(true).unwrap(), default_record_quota());
    assert_eq!(file.record_quota(false).unwrap(), RecordQuota::unlimited());
}

/// An `oauth` workspace at version 8 (`config_v5.rs`'s fixture), with `limits`.
fn oauth(limits: &str) -> String {
    format!(
        "config_version = 8\n\n[principal]\nlocal_id = \"corp/U019488227\"\n\n[http]\nbind = \"127.0.0.1:8443\"\npublic_url = \"https://umbel.example.com/mcp\"\nallowed_hosts = [\"umbel.example.com\"]\n\n[auth]\nmode = \"oauth\"\n\n[auth.namespaces.corp]\nperson = {{ issuer = \"corp-idp\", client_id = \"umbel-person-page\", client_secret_env = \"UMBEL_PERSON_SECRET\", acr_values = [\"phr\"], uv_amr = [\"pin\", \"fpt\"] }}\n\n[auth.issuers.corp-idp]\nissuer = \"https://idp.example.com\"\naccess_tokens = true\nnamespace = \"corp\"\n\n[limits]\n{limits}"
    )
}

#[test]
fn a_hosted_workspace_is_held_to_the_defaults_and_to_what_it_sets() {
    let read = |text: &str| {
        ConfigFile::parse(text)
            .and_then(|file| file.into_config(Path::new("/w/example")))
            .unwrap_or_else(|error| panic!("the hosted fixture does not open: {error}"))
            .record_quota
    };
    assert_eq!(read(&oauth("")), default_record_quota());
    let set = read(&oauth("kind_records = 9\n"));
    assert_eq!((set.records, set.postings), (9, DEFAULT_KIND_POSTINGS));
    // The same file in mode none limits only what it sets.
    let local = read(&oauth("kind_records = 9\n").replace("mode = \"oauth\"", "mode = \"none\""));
    assert_eq!((local.records, local.postings), (9, u64::MAX));
}

#[test]
fn version_8_sets_each_limit_between_one_and_its_cap() {
    let quota = open("config_version = 8\n\n[limits]\nkind_records = 3\nkind_postings = 40\n")
        .unwrap()
        .record_quota();
    assert_eq!((quota.records, quota.postings), (3, 40));
    let max = open(&format!(
        "config_version = 8\n\n[limits]\nkind_records = {MAX_KIND_LIMIT}\nkind_postings = {MAX_KIND_LIMIT}\n"
    ))
    .unwrap()
    .record_quota();
    assert_eq!(
        (max.records, max.postings),
        (MAX_KIND_LIMIT, MAX_KIND_LIMIT)
    );
    for (key, value) in [
        ("kind_records", "0"),
        ("kind_postings", "0"),
        ("kind_records", "-1"),
        ("kind_postings", "1000000001"),
        ("kind_records", "\"many\""),
    ] {
        let text = format!("config_version = 8\n\n[limits]\n{key} = {value}\n");
        invalid(&text, &format!("limits.{key}"));
        // The doctor's reading refuses what opening refuses, naming the same key.
        let error = ConfigFile::parse(&text)
            .and_then(|file| file.into_config(Path::new("/w/example")))
            .unwrap_err();
        assert_eq!(
            error.key(),
            Some(format!("limits.{key}").as_str()),
            "{error}"
        );
        let report = umbel::doctor::run(workspace_root(&text));
        let parse = report
            .checks
            .iter()
            .find(|check| check.id == "config.parse")
            .unwrap();
        assert_eq!(parse.status, umbel::doctor::CheckStatus::Fail, "{text}");
        assert!(
            parse.message.contains(&format!("limits.{key}")),
            "{parse:?}"
        );
    }
}

#[test]
fn a_key_of_the_same_spelling_outside_limits_is_unknown() {
    for text in [
        "config_version = 8\n\"limits.kind_records\" = 1\n",
        "config_version = 8\n\"limits.kind_postings\" = 1\n\n[limits]\nkind_records = 2\n",
    ] {
        let error = open(text).expect_err(text);
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{text}: {error}");
        assert!(
            error.message().contains("is not a known key"),
            "{text}: {error}"
        );
    }
}

#[test]
fn versions_1_to_7_refuse_the_keys_and_read_with_the_default_quota() {
    for version in 1..=7 {
        for key in ["kind_records", "kind_postings"] {
            let text = format!("config_version = {version}\n\n[limits]\n{key} = 3\n");
            if version >= 5 {
                let error = invalid(&text, &format!("limits.{key}"));
                assert!(
                    error.message().contains("needs config_version = 8"),
                    "{version}: {error}"
                );
            } else {
                // Versions before 5 have no `[limits]` at all: the table is what they refuse,
                // as they refuse `limits.compiled_calls` (D204).
                let error = invalid(&text, "limits");
                assert!(
                    error.message().contains("needs config_version = 5"),
                    "{version}: {error}"
                );
            }
        }
    }
    assert_eq!(
        open("config_version = 7\n").unwrap().record_quota(),
        RecordQuota::unlimited(),
        "mode none"
    );
}

#[test]
fn umbel_init_writes_version_8() {
    assert_eq!(umbel::CONFIG_VERSION, 8);
    assert_eq!(umbel::CONFIG_VERSIONS, [1, 2, 3, 4, 5, 6, 7, 8]);
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("fresh");
    Workspace::init(&target, None).unwrap();
    let written: toml::Table = fs::read_to_string(target.join("umbel.toml"))
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(
        serde_json::to_value(written).unwrap(),
        example("workspace-config.v8.json")
    );
}

// ── The schema file ────────────────────────────────────────────────────────────────────────────

fn schemas_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("schemas")
}

fn read(path: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap())
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

fn example(name: &str) -> Value {
    read(&schemas_dir().join("examples").join(name))
}

fn validator(version: u32) -> Validator {
    let schema = read(&schemas_dir().join(format!("workspace-config.v{version}.json")));
    jsonschema::meta::validate(&schema).unwrap();
    jsonschema::validator_for(&schema).unwrap()
}

fn as_toml(instance: &Value) -> String {
    toml::to_string(&toml::Value::try_from(instance).unwrap()).unwrap()
}

#[test]
fn the_version_8_examples_validate_and_open_and_each_schema_refuses_the_other() {
    let v8 = validator(8);
    for name in ["workspace-config.v8.json", "workspace-config.v8.quota.json"] {
        let instance = example(name);
        if let Err(error) = v8.validate(&instance) {
            panic!("{name}: {error}");
        }
        ConfigFile::parse(&as_toml(&instance))
            .and_then(|file| file.into_config(Path::new("/w/example")))
            .unwrap_or_else(|error| panic!("{name}: {error}"));
    }
    let quota = ConfigFile::parse(&as_toml(&example("workspace-config.v8.quota.json")))
        .unwrap()
        .record_quota(false)
        .unwrap();
    assert_eq!((quota.records, quota.postings), (20_000, 250_000));
    // Version 7's schema refuses the quota, and version 8's a version 7 file.
    let v7 = validator(7);
    let mut lifted = example("workspace-config.v8.quota.json");
    lifted["config_version"] = json!(7);
    assert!(!v7.is_valid(&lifted));
    assert!(!v8.is_valid(&example("workspace-config.v7.json")));
    // The schema's range is the host's.
    for (key, value) in [
        ("kind_records", json!(0)),
        ("kind_postings", json!(MAX_KIND_LIMIT + 1)),
    ] {
        let mut out = example("workspace-config.v8.quota.json");
        out["limits"][key] = value;
        assert!(!v8.is_valid(&out), "{key}");
    }
    // Every version 7 file lifted to version 8 is a version 8 file: nothing was taken away.
    for name in [
        "workspace-config.v7.json",
        "workspace-config.v7.local.json",
        "workspace-config.v7.journal.json",
    ] {
        let mut lifted = example(name);
        lifted["config_version"] = json!(8);
        if let Err(error) = v8.validate(&lifted) {
            panic!("{name}: {error}");
        }
    }
}
