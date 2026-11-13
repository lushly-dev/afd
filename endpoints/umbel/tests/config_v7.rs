//! `umbel.toml`, configuration version 7 (the Ideas host-review specification, sections 4, 6.1
//! and 6.5; D180): `[person.local]` and a space's `verified_levels`, each with its default and its
//! refusals; versions 1 to 6 refusing the keys and reading as version 7 with none of them; the
//! doctor's reading; and the schema file accepting and refusing the same configurations.
//! `person.decision_ttl_s` is tested in `person_ttl.rs`. Parsing and validation only here: no
//! local page is served and no read consults `verified_levels`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::{Path, PathBuf};

use jsonschema::Validator;
use serde_json::{Value, json};
use umbel::doctor::{self, CheckStatus};
use umbel::workspace::{
    AssuranceLevel, ConfigFile, DEFAULT_VERIFIED_LEVELS, PersonConfig, Workspace, WorkspaceError,
};

fn workspace_with(text: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("ws");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("umbel.toml"), text).unwrap();
    (dir, root)
}

fn open(text: &str) -> Result<Workspace, WorkspaceError> {
    let (_dir, root) = workspace_with(text);
    Workspace::open(&root)
}

/// The refusal of `text`, which must be `WORKSPACE_CONFIG_INVALID` naming exactly `key`.
#[track_caller]
fn invalid(text: &str, key: &str) -> WorkspaceError {
    let error = open(text).expect_err(text);
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{text}: {error}");
    assert_eq!(error.key(), Some(key), "{text}: {error}");
    assert!(
        error.message().contains(&format!("`{key}`")),
        "{text}: {error} does not name {key}"
    );
    assert!(!error.suggestion().is_empty());
    error
}

/// The specification's own example: a garden space whose verified reads admit the local page,
/// and a local page on its default port. `rest` is appended.
fn garden(rest: &str) -> String {
    format!(
        r#"config_version = 7

[spaces.garden]
person = "human:local"
verified_levels = ["terminal", "verified", "local"]

[person]
decision_ttl_s = 3600

[person.local]
enabled = true
bind = "127.0.0.1:7421"
{rest}"#
    )
}

/// A version 7 file whose `[person.local]` holds `local`, and `rest` after it.
fn local(local: &str, rest: &str) -> String {
    format!("config_version = 7\n\n[person.local]\n{local}\n{rest}")
}

/// A version 7 file with one space `garden` whose table holds `space`.
fn space(space: &str) -> String {
    format!("config_version = 7\n\n[spaces.garden]\n{space}\n")
}

/// An `oauth` workspace on a loopback bind, as `config_v5.rs` opens one, with `rest` appended.
fn oauth(rest: &str) -> String {
    format!(
        "config_version = 7\n\n[principal]\nlocal_id = \"corp/U019488227\"\n\n[http]\nbind = \"127.0.0.1:8443\"\npublic_url = \"https://umbel.example.com/mcp\"\nallowed_hosts = [\"umbel.example.com\"]\n\n[auth]\nmode = \"oauth\"\n\n[auth.namespaces.corp]\n\n[auth.issuers.corp-idp]\nissuer = \"https://idp.example.com\"\naccess_tokens = true\nnamespace = \"corp\"\n{rest}"
    )
}

/// A `gateway` workspace on a loopback bind, as `config_v5.rs` opens one, with `rest` appended.
#[cfg(feature = "auth")]
fn gateway(rest: &str) -> String {
    format!(
        "config_version = 7\n\n[principal]\nlocal_id = \"corp/U019488227\"\n\n[http]\nbind = \"127.0.0.1:8443\"\npublic_url = \"https://umbel.example.com/mcp\"\nallowed_hosts = [\"umbel.example.com\"]\n\n[auth]\nmode = \"gateway\"\n\n[auth.namespaces.corp]\n\n[auth.gateway]\nalias = \"edge\"\nnamespace = \"corp\"\nissuer = \"https://gateway.example.com\"\nkeys = \"secrets/gateway/jwks.json\"\nmax_scopes = [\"umbel:read\", \"umbel:write:main\"]\n{rest}"
    )
}

// ── Every key, and its default ─────────────────────────────────────────────────────────────────

#[test]
#[cfg(feature = "auth")]
fn the_specifications_example_opens_with_every_key() {
    let workspace = open(&garden("")).unwrap();
    let config = workspace.config();
    assert_eq!(config.version, 7);
    assert_eq!(config.person.decision_ttl_s, 3600);
    assert!(config.person.local.enabled);
    assert_eq!(config.person.local.bind.to_string(), "127.0.0.1:7421");
    assert_eq!(
        config.spaces[0].verified_levels,
        [
            AssuranceLevel::Terminal,
            AssuranceLevel::Verified,
            AssuranceLevel::Local
        ]
    );
}

#[test]
fn every_key_has_a_default_and_earlier_versions_read_with_them() {
    let texts = [
        "config_version = 1\n".to_owned(),
        "config_version = 3\n[spaces.garden]\n".to_owned(),
        "config_version = 5\n[spaces.garden]\n".to_owned(),
        "config_version = 6\n[spaces.garden]\nperson = \"human:local\"\n".to_owned(),
        "config_version = 7\n[spaces.garden]\n".to_owned(),
        "config_version = 7\n[person]\n[person.local]\n[spaces.garden]\n".to_owned(),
    ];
    for text in texts {
        let workspace = open(&text).unwrap_or_else(|error| panic!("{text}: {error}"));
        let config = workspace.config();
        assert_eq!(config.person, PersonConfig::default(), "{text}");
        assert!(!config.person.local.enabled);
        assert_eq!(config.person.local.bind.to_string(), "127.0.0.1:7421");
        for space in &config.spaces {
            assert_eq!(space.verified_levels, DEFAULT_VERIFIED_LEVELS, "{text}");
        }
    }
    assert_eq!(
        DEFAULT_VERIFIED_LEVELS.map(AssuranceLevel::as_str),
        ["terminal", "verified"]
    );
}

#[test]
fn versions_1_to_6_refuse_the_keys() {
    for version in [3, 4, 5, 6] {
        let error = invalid(
            &format!("config_version = {version}\n[person.local]\nenabled = true\n"),
            "person",
        );
        assert!(
            error.message().contains("needs config_version = 7"),
            "{error}"
        );
        let error = invalid(
            &format!(
                "config_version = {version}\n[spaces.garden]\nverified_levels = [\"local\"]\n"
            ),
            "spaces.garden.verified_levels",
        );
        assert!(
            error.message().contains("needs config_version = 7"),
            "{error}"
        );
    }
    let error = invalid(
        "config_version = 1\n[person]\ndecision_ttl_s = 60\n",
        "person",
    );
    assert!(
        error.message().contains("needs config_version = 7"),
        "{error}"
    );
}

#[test]
fn unknown_keys_of_the_person_tables_are_refused() {
    invalid("config_version = 7\n[person]\nttl = 60\n", "person.ttl");
    invalid(
        &local("enabled = false\nport = 7421", ""),
        "person.local.port",
    );
    invalid(
        "config_version = 7\n[person]\nlocal = true\n",
        "person.local",
    );
}

// ── The local page (section 6.1) ───────────────────────────────────────────────────────────────

#[test]
fn the_local_page_binds_a_loopback_address() {
    for bind in [
        "127.0.0.1:7421",
        "127.0.0.2:9000",
        "[::1]:7421",
        "127.255.0.1:65535",
    ] {
        let workspace = open(&local(&format!("enabled = false\nbind = \"{bind}\""), "")).unwrap();
        assert_eq!(workspace.config().person.local.bind.to_string(), bind);
    }
    // A disabled page keeps its bind: it is still checked.
    for bind in ["0.0.0.0:7421", "192.168.1.20:7421", "[::]:7421"] {
        let error = invalid(
            &local(&format!("enabled = false\nbind = \"{bind}\""), ""),
            "person.local.bind",
        );
        assert!(error.message().contains("loopback"), "{error}");
    }
    // One spelling for each address, and a port of 1 to 65535, as the schema's pattern has it.
    for bind in [
        "localhost:7421",
        "127.0.0.1",
        "garden",
        "",
        "127.0.0.1:0",
        "127.0.0.1:99999",
        "127.0.0.1:07421",
        "127.0.0.300:1",
        "127.0.0.01:7421",
        "[0:0:0:0:0:0:0:1]:7421",
    ] {
        invalid(
            &local(&format!("enabled = false\nbind = \"{bind}\""), ""),
            "person.local.bind",
        );
    }
    invalid(&local("bind = 7421", ""), "person.local.bind");
    invalid(&local("enabled = \"yes\"", ""), "person.local.enabled");
}

#[test]
#[cfg(feature = "auth")]
fn the_local_page_serves_only_mode_none() {
    // Mode `none` written out, as by default.
    let workspace = open(&local("enabled = true", "[auth]\nmode = \"none\"\n")).unwrap();
    assert!(workspace.config().person.local.enabled);
    // A hosted mode confirms on its own page, after a login.
    let error = invalid(
        &oauth("\n[person.local]\nenabled = true\n"),
        "person.local.enabled",
    );
    assert!(error.message().contains("auth.mode = \"none\""), "{error}");
    let error = invalid(
        &gateway("\n[person.local]\nenabled = true\n"),
        "person.local.enabled",
    );
    assert!(error.message().contains("not \"gateway\""), "{error}");
    // Disabled, the table is harmless in a hosted mode.
    let workspace = open(&oauth("\n[person.local]\nenabled = false\n")).unwrap();
    assert!(!workspace.config().person.local.enabled);
    let workspace = open(&gateway("\n[person.local]\nenabled = false\n")).unwrap();
    assert!(!workspace.config().person.local.enabled);
}

#[test]
#[cfg(not(feature = "auth"))]
fn the_local_page_needs_the_auth_feature() {
    let error = invalid(&local("enabled = true", ""), "person.local.enabled");
    assert!(error.message().contains("auth feature"), "{error}");
    // Disabled, the table is read in any build.
    let workspace = open(&local("enabled = false", "")).unwrap();
    assert!(!workspace.config().person.local.enabled);
}

// ── verified_levels (section 6.5) ──────────────────────────────────────────────────────────────

#[test]
fn verified_levels_names_each_level_once() {
    let levels = |text: &str| {
        open(&space(text)).unwrap().config().spaces[0]
            .verified_levels
            .clone()
    };
    assert_eq!(
        levels("verified_levels = [\"verified\"]"),
        [AssuranceLevel::Verified]
    );
    assert_eq!(
        levels("verified_levels = [\"local\", \"terminal\"]"),
        [AssuranceLevel::Local, AssuranceLevel::Terminal]
    );
    let key = "spaces.garden.verified_levels";
    for text in [
        "verified_levels = []",
        "verified_levels = [\"strong\"]",
        "verified_levels = [\"Verified\"]",
        "verified_levels = [\"local\", \"local\"]",
        "verified_levels = \"local\"",
        "verified_levels = [1]",
    ] {
        invalid(&space(text), key);
    }
}

// ── The doctor ─────────────────────────────────────────────────────────────────────────────────

#[test]
#[cfg(feature = "auth")]
fn the_doctor_reads_version_7_and_names_an_unknown_key() {
    let (_dir, root) = workspace_with(&garden(""));
    let report = doctor::run(&root);
    for id in ["config.parse", "config.keys", "spaces.valid"] {
        let check = report.checks.iter().find(|check| check.id == id).unwrap();
        assert_eq!(check.status, CheckStatus::Pass, "{id}: {}", check.message);
    }
    let (_dir, root) =
        workspace_with(&garden("").replace("enabled = true", "enabled = true\nopen = true"));
    let report = doctor::run(&root);
    let keys = report
        .checks
        .iter()
        .find(|check| check.id == "config.keys")
        .unwrap();
    assert_eq!(keys.status, CheckStatus::Fail);
    assert!(
        keys.message.contains("person.local.open"),
        "{}",
        keys.message
    );
    assert!(
        keys.suggestion
            .as_deref()
            .unwrap()
            .contains("versions 1 to 7")
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

fn opens(instance: &Value) -> Result<(), WorkspaceError> {
    ConfigFile::parse(&as_toml(instance))
        .and_then(|file| file.into_config(Path::new("/w/example")))
        .map(drop)
}

/// `instance` with `edit` applied.
fn edited(instance: &Value, edit: impl FnOnce(&mut Value)) -> Value {
    let mut copy = instance.clone();
    edit(&mut copy);
    copy
}

fn local_json() -> Value {
    example("workspace-config.v7.local.json")
}

#[test]
#[cfg(feature = "auth")]
fn the_schema_accepts_what_the_host_accepts() {
    let validator = validator(7);
    let ok = [
        json!({ "config_version": 7 }),
        json!({ "config_version": 7, "person": {} }),
        json!({ "config_version": 7, "person": { "decision_ttl_s": 60 } }),
        json!({ "config_version": 7, "person": { "decision_ttl_s": 86_400 } }),
        json!({ "config_version": 7, "person": { "local": { "bind": "[::1]:7421" } } }),
        json!({ "config_version": 7, "spaces": { "garden": { "verified_levels": ["local"] } } }),
        local_json(),
    ];
    for instance in ok {
        if let Err(error) = validator.validate(&instance) {
            panic!("the schema refused {instance}: {error}");
        }
        opens(&instance).unwrap_or_else(|error| panic!("the host refused {instance}: {error}"));
    }
}

#[test]
fn the_schema_refuses_what_the_host_refuses() {
    let validator = validator(7);
    let base = local_json();
    let refused = [
        edited(&base, |c| c["person"]["decision_ttl_s"] = json!(59)),
        edited(&base, |c| c["person"]["decision_ttl_s"] = json!(86_401)),
        edited(&base, |c| c["person"]["decision_ttl_s"] = json!("1h")),
        edited(&base, |c| c["person"]["ttl"] = json!(60)),
        edited(&base, |c| {
            c["person"]["local"]["bind"] = json!("0.0.0.0:7421")
        }),
        edited(&base, |c| {
            c["person"]["local"]["bind"] = json!("localhost:7421")
        }),
        edited(&base, |c| {
            c["person"]["local"]["bind"] = json!("127.0.0.1:0")
        }),
        edited(&base, |c| {
            c["person"]["local"]["bind"] = json!("127.0.0.1:99999")
        }),
        edited(&base, |c| {
            c["person"]["local"]["bind"] = json!("127.0.0.300:1")
        }),
        edited(&base, |c| {
            c["person"]["local"]["bind"] = json!("127.0.0.01:7421")
        }),
        edited(&base, |c| {
            c["person"]["local"]["bind"] = json!("[0:0:0:0:0:0:0:1]:7421")
        }),
        edited(&base, |c| c["person"]["local"]["enabled"] = json!("yes")),
        edited(&base, |c| c["person"]["local"]["port"] = json!(7421)),
        edited(&base, |c| {
            c["spaces"]["garden"]["verified_levels"] = json!([])
        }),
        edited(&base, |c| {
            c["spaces"]["garden"]["verified_levels"] = json!(["strong"])
        }),
        edited(&base, |c| {
            c["spaces"]["garden"]["verified_levels"] = json!(["local", "local"]);
        }),
        edited(&base, |c| c["config_version"] = json!(6)),
    ];
    for instance in &refused {
        assert!(
            !validator.is_valid(instance),
            "the schema accepted {instance}"
        );
        assert!(opens(instance).is_err(), "the host accepted {instance}");
    }
}

#[test]
fn the_local_page_in_a_hosted_mode_is_refused_by_both() {
    let validator = validator(7);
    let hosted: toml::Table = oauth("\n[person.local]\nenabled = true\n").parse().unwrap();
    let hosted = serde_json::to_value(hosted).unwrap();
    assert!(!validator.is_valid(&hosted));
    assert!(opens(&hosted).is_err());
    let disabled = edited(&hosted, |c| c["person"]["local"]["enabled"] = json!(false));
    validator.validate(&disabled).unwrap();
    opens(&disabled).unwrap();
}

#[test]
#[cfg(feature = "auth")]
fn the_version_7_examples_validate_and_open() {
    let validator = validator(7);
    for name in ["workspace-config.v7.json", "workspace-config.v7.local.json"] {
        let instance = example(name);
        if let Err(error) = validator.validate(&instance) {
            panic!("{name}: {error}");
        }
        opens(&instance).unwrap_or_else(|error| panic!("{name}: {error}"));
    }
    // What `umbel init` writes is the bare example.
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("fresh");
    Workspace::init(&target, None).unwrap();
    let written: toml::Table = fs::read_to_string(target.join("umbel.toml"))
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(
        serde_json::to_value(written).unwrap(),
        example("workspace-config.v7.json")
    );
    // Each version's schema refuses the other's files.
    let v6 = self::validator(6);
    assert!(!v6.is_valid(&local_json()));
    assert!(!v6.is_valid(&example("workspace-config.v7.json")));
    assert!(!validator.is_valid(&example("workspace-config.v6.json")));
    // A version 6 file lifted to version 7 is a version 7 file: nothing was taken away.
    let mut lifted = example("workspace-config.v6.records.json");
    lifted["config_version"] = json!(7);
    validator.validate(&lifted).unwrap();
}
