//! `umbel.toml`, configuration version 7 (the Ideas host-review specification, sections 4, 6.1
//! and 6.5; D180): `[person.local]` and a space's `verified_levels`, each with its default and its
//! refusals; versions 1 to 6 refusing the keys and reading as version 7 with none of them; the
//! doctor's reading; and the schema file accepting and refusing the same configurations.
//! `person.decision_ttl_s` is tested in `person_ttl.rs`. Parsing and validation only here: no
//! local page is served and no read consults `verified_levels`.
use std::fs;
use std::path::{Path, PathBuf};

use jsonschema::Validator;
use serde_json::{Value, json};
use umbel::doctor::{self, CheckStatus};
use umbel::workspace::{
    AssuranceLevel, ConfigFile, DEFAULT_VERIFIED_LEVELS, McpApprovals, PersonConfig, Workspace,
    WorkspaceError,
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
    assert!(!config.person.pending_list);
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
        assert_eq!(config.mcp.approvals, McpApprovals::Enforce, "{text}");
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
#[cfg(feature = "auth")]
fn the_pending_list_is_off_unless_turned_on() {
    let on = open(&oauth("\n[person]\npending_list = true\n")).unwrap();
    assert!(on.config().person.pending_list);
    let off = open(&oauth("")).unwrap();
    assert!(!off.config().person.pending_list);
    // Not through `invalid`, which prints the file it opens: a hosted file names its issuers.
    let not_a_boolean = open(&oauth("\n[person]\npending_list = 1\n"))
        .err()
        .map(|error| (error.code().to_owned(), error.key().map(str::to_owned)));
    assert_eq!(
        not_a_boolean,
        Some((
            "WORKSPACE_CONFIG_INVALID".to_owned(),
            Some("person.pending_list".to_owned())
        ))
    );
    let error = invalid(
        "config_version = 7\n[person]\npending_list = true\n",
        "person.pending_list",
    );
    assert!(error.message().contains("auth.mode"), "{error}");
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
            .contains("versions 1 to 8")
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
        json!({ "config_version": 7, "person": { "local": { "public_origin": "https://garden-host.example-tailnet.ts.net:8443" } } }),
        json!({ "config_version": 7, "person": { "local": { "public_origin": "https://garden-host.example-tailnet.ts.net/" } } }),
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
        edited(&base, |c| c["person"]["pending_list"] = json!("yes")),
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
            c["person"]["local"]["public_origin"] =
                json!("http://garden-host.example-tailnet.ts.net:8443")
        }),
        edited(&base, |c| {
            c["person"]["local"]["public_origin"] =
                json!("https://garden-host.example-tailnet.ts.net:8443/d/")
        }),
        edited(&base, |c| {
            c["person"]["local"]["public_origin"] =
                json!("https://garden-host.example-tailnet.ts.net/?bed=3")
        }),
        edited(&base, |c| {
            c["person"]["local"]["public_origin"] =
                json!("https://gardener@garden-host.example-tailnet.ts.net")
        }),
        edited(&base, |c| {
            c["person"]["local"]["public_origin"] =
                json!("https://Garden-Host.example-tailnet.ts.net")
        }),
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
    // What `umbel init` writes is version 8's bare example (`config_v8.rs`), which is this one
    // lifted to version 8.
    let mut bare = example("workspace-config.v7.json");
    bare["config_version"] = json!(8);
    assert_eq!(bare, example("workspace-config.v8.json"));
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

// ── The deployer's journal mode for a component (the component journal specification, D196) ──

/// A version `version` workspace enabling the instance `components` with `journal`.
fn journaled(version: u32, journal: &str) -> String {
    format!(
        "config_version = {version}\n\n[spaces.main]\n\n[plugins]\nenabled = [\"components\"]\n\n[plugins.components]\nsource = \"plugins/components\"\n\n{journal}"
    )
}

const D2_JOURNAL: &str = r#"[plugins.components.journal]
mode = "digest"
keep = ["space", "library"]

[plugins.components.journal.commands]
components-brief = { mode = "digest", keep = ["space", "library", "detail", "render", "consumer"] }
components-show = { mode = "plain" }
"#;

#[test]
fn a_component_instances_journal_parses_as_the_specification_prints_it() {
    use umbel::plugins::JournalMode;
    let workspace = open(&journaled(7, D2_JOURNAL)).unwrap();
    let instance = &workspace.config().plugins.instances[0];
    let journal = instance.journal.as_ref().unwrap();
    assert_eq!(journal.mode, Some(JournalMode::Digest));
    assert_eq!(journal.keep, ["space", "library"]);
    let brief = journal.for_command("components-brief").unwrap();
    assert_eq!(brief.mode, JournalMode::Digest);
    assert_eq!(
        brief.keep,
        ["space", "library", "detail", "render", "consumer"]
    );
    // An entry replaces the instance's mode and keep whole; an explicit plain stays declared.
    let show = journal.for_command("components-show").unwrap();
    assert_eq!(show.mode, JournalMode::Plain);
    assert!(show.keep.is_empty());
    let list = journal.for_command("components-list").unwrap();
    assert_eq!(list.keep, ["space", "library"]);
    // Only commands named, with no instance mode: the rest are not reached.
    let only = open(&journaled(
        7,
        "[plugins.components.journal.commands]\ncomponents-brief = { mode = \"digest\" }\n",
    ))
    .unwrap();
    let only = only.config().plugins.instances[0].journal.clone().unwrap();
    assert_eq!(only.mode, None);
    assert!(only.for_command("components-list").is_none());
    // No table: no journal.
    let none = open(&journaled(7, "")).unwrap();
    assert!(none.config().plugins.instances[0].journal.is_none());
}

#[test]
fn the_journal_rules_are_refused_naming_the_key() {
    let k = "plugins.components.journal";
    for (journal, key, says) in [
        (
            "[plugins.components.journal]\nmode = \"full\"\n",
            format!("{k}.mode"),
            "\"digest\" or \"plain\"",
        ),
        (
            "[plugins.components.journal]\nmode = \"plain\"\nkeep = [\"space\"]\n",
            format!("{k}.keep"),
            "digest",
        ),
        (
            "[plugins.components.journal]\nkeep = [\"space\"]\n",
            format!("{k}.keep"),
            "digest",
        ),
        (
            "[plugins.components.journal]\nmode = \"digest\"\nkeep = [\"a\", \"a\"]\n",
            format!("{k}.keep"),
            "twice",
        ),
        (
            "[plugins.components.journal.commands]\ncomponents-brief = { keep = [\"space\"] }\n",
            format!("{k}.commands.components-brief.mode"),
            "required",
        ),
        (
            "[plugins.components.journal.commands]\ncomponents-brief = \"digest\"\n",
            format!("{k}.commands.components-brief"),
            "table",
        ),
        (
            "[plugins.components.journal.commands]\n\"Not A Name\" = { mode = \"plain\" }\n",
            format!("{k}.commands.Not A Name"),
            "command name",
        ),
        (
            "[plugins.components.journal]\nmode = \"digest\"\nshow = [\"reason\"]\n",
            format!("{k}.show"),
            "not a known key",
        ),
        (
            "[plugins.components.journal.commands]\ncomponents-brief = { mode = \"digest\", show = [\"reason\"] }\n",
            format!("{k}.commands.components-brief.show"),
            "not a known key",
        ),
        (
            "[plugins.components.journal]\nmode = \"digest\"\nwhen = \"always\"\n",
            format!("{k}.when"),
            "not a known key",
        ),
    ] {
        let error = invalid(&journaled(7, journal), &key);
        assert!(error.message().contains(says), "{journal}: {error}");
    }
    let many: Vec<String> = (0..17).map(|n| format!("\"k{n}\"")).collect();
    let error = invalid(
        &journaled(
            7,
            &format!(
                "[plugins.components.journal]\nmode = \"digest\"\nkeep = [{}]\n",
                many.join(", ")
            ),
        ),
        &format!("{k}.keep"),
    );
    assert!(error.message().contains("limit is 16"), "{error}");
}

#[test]
fn the_journal_before_version_7_needs_version_7_on_both_paths() {
    for version in [3, 6] {
        let text = journaled(version, "[plugins.components.journal]\nmode = \"digest\"\n");
        let error = invalid(&text, "plugins.components.journal");
        assert!(
            error.message().contains("needs config_version = 7"),
            "{error}"
        );
        // The doctor reads `[plugins]` on its own path, with the same message.
        let (_dir, root) = workspace_with(&text);
        let report = doctor::run(&root);
        let config = report
            .checks
            .iter()
            .find(|check| check.id == "plugins.config")
            .unwrap();
        assert_eq!(config.status, CheckStatus::Fail, "{}", config.message);
        assert!(
            config.message.contains("needs config_version = 7"),
            "{}",
            config.message
        );
    }
}

#[test]
fn the_schema_and_the_host_agree_on_the_journal() {
    let validator = validator(7);
    let journal = example("workspace-config.v7.journal.json");
    validator.validate(&journal).unwrap();
    opens(&journal).unwrap();
    let path = |c: &mut Value| -> Value { c["plugins"]["components"]["journal"].take() };
    let refused = [
        edited(&journal, |c| {
            let mut j = path(c);
            j["keep"] = json!((0..17).map(|n| format!("k{n}")).collect::<Vec<_>>());
            c["plugins"]["components"]["journal"] = j;
        }),
        edited(&journal, |c| {
            c["plugins"]["components"]["journal"]["commands"]["components-brief"]["show"] =
                json!(["reason"]);
        }),
        edited(&journal, |c| {
            c["plugins"]["components"]["journal"]["commands"]["components-list"] =
                json!({ "keep": ["space"] });
        }),
        edited(&journal, |c| {
            c["plugins"]["components"]["journal"]["commands"]["components-list"] =
                json!({ "mode": "plain", "keep": ["space"] });
        }),
        edited(&journal, |c| {
            c["plugins"]["components"]["journal"]["mode"] = json!("plain");
        }),
        edited(&journal, |c| {
            c["plugins"]["components"]["journal"]["commands"]["Not A Name"] =
                json!({ "mode": "plain" });
        }),
    ];
    for instance in refused {
        assert!(!validator.is_valid(&instance), "{instance}");
        assert!(opens(&instance).is_err(), "{instance}");
    }
    assert!(!self::validator(6).is_valid(&journal));
}

// ── mcp.approvals (D202, #1329) ────────────────────────────────────────────────────────────────

#[test]
fn mcp_approvals_parses_in_version_7_and_is_refused_earlier() {
    for (value, expected) in [
        ("enforce", McpApprovals::Enforce),
        ("mcp-elicitation", McpApprovals::McpElicitation),
        ("off", McpApprovals::Off),
    ] {
        let workspace = open(&format!(
            "config_version = 7\n\n[mcp]\napprovals = \"{value}\"\n"
        ))
        .unwrap();
        assert_eq!(workspace.config().mcp.approvals, expected);
    }
    for bad in ["\"agents\"", "\"none\"", "true", "1"] {
        invalid(
            &format!("config_version = 7\n\n[mcp]\napprovals = {bad}\n"),
            "mcp.approvals",
        );
    }
    for version in [1, 2, 3, 4, 5, 6] {
        let error = invalid(
            &format!("config_version = {version}\n\n[mcp]\napprovals = \"off\"\n"),
            "mcp.approvals",
        );
        assert!(
            error.message().contains("needs config_version = 7"),
            "{version}: {error}"
        );
    }
}

#[test]
#[cfg(feature = "auth")]
fn mcp_approvals_relaxation_is_refused_in_hosted_modes_by_host_and_schema() {
    let validator = validator(7);
    for (label, base) in [("oauth", oauth("")), ("gateway", gateway(""))] {
        // Explicit "enforce" is allowed in hosted modes.
        let enforce = format!("{base}\n[mcp]\napprovals = \"enforce\"\n");
        let parsed: toml::Table = enforce.parse().unwrap();
        let json_val = serde_json::to_value(parsed).unwrap();
        validator.validate(&json_val).unwrap();
        let ws = open(&enforce).unwrap();
        assert_eq!(ws.config().mcp.approvals, McpApprovals::Enforce, "{label}");

        // Relaxing MCP approvals is refused in hosted modes by both host and schema.
        for relaxed in ["mcp-elicitation", "off"] {
            let text = format!("{base}\n[mcp]\napprovals = \"{relaxed}\"\n");
            let error = invalid(&text, "mcp.approvals");
            assert!(
                error
                    .message()
                    .contains("must be \"enforce\" in a hosted mode"),
                "{label}/{relaxed}: {error}"
            );
            let parsed: toml::Table = text.parse().unwrap();
            let json_val = serde_json::to_value(parsed).unwrap();
            assert!(
                !validator.is_valid(&json_val),
                "schema accepted {label} with mcp.approvals = {relaxed}"
            );
        }
    }

    // Mode `none` accepts all three values in both host and schema.
    for value in ["enforce", "mcp-elicitation", "off"] {
        let instance = json!({ "config_version": 7, "mcp": { "approvals": value } });
        validator.validate(&instance).unwrap();
        opens(&instance).unwrap();
    }
    let bad = json!({ "config_version": 7, "mcp": { "approvals": "agents" } });
    assert!(!validator.is_valid(&bad));
    assert!(opens(&bad).is_err());
}
