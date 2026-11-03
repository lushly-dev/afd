//! `umbel.toml`, configuration version 4 (phase 3 specification, sections 2.4, 3.2 and 3.3):
//! `memory` and `memory_write` in `deny`, the `memory_write` grant table and its sharing policy,
//! `principal.agent_env`, `store.exclude_memory_from_machine_backup` and its default, versions 1
//! to 3 read as version 4, and `umbel init` writing version 4 with `on_behalf_of`. Parsing only:
//! the host enforces the policy and the CLI reads `agent_env` from phase 3 step 4.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::PathBuf;

use umbel::doctor;
use umbel::workspace::{DefaultAccess, Workspace, WorkspaceError};

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

fn invalid(text: &str, key: &str) -> WorkspaceError {
    let error = open(text).expect_err(text);
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{text}: {error}");
    assert!(
        error.message().contains(key),
        "{text}: {error} does not name {key}"
    );
    assert!(!error.suggestion().is_empty());
    error
}

/// A version `version` file enabling the instance `memory` in `main` and `beta`, with `body`
/// appended.
fn with_memory(version: u32, body: &str) -> String {
    format!(
        "config_version = {version}\ndefault_space = \"main\"\n[spaces.main]\n[spaces.beta]\n[plugins]\nenabled = [\"memory\"]\n[plugins.memory]\nsource = \"compiled:memory\"\n{body}"
    )
}

// ── Grants ─────────────────────────────────────────────────────────────────────────────────────

#[test]
fn memory_and_memory_write_are_grants_a_deployer_may_deny() {
    let workspace = open(&with_memory(4, "deny = [\"memory\", \"memory_write\"]\n")).unwrap();
    assert_eq!(
        workspace.config().plugins.instances[0].deny,
        ["memory", "memory_write"]
    );
    assert!(umbel::plugins::GRANTS.contains(&"memory"));
    assert!(umbel::plugins::GRANTS.contains(&"memory_write"));
    assert!(umbel::plugins::needs_allow_list("memory_write"));
    assert!(!umbel::plugins::needs_allow_list("memory"));
    // Both are in the catalog and still unavailable until their services exist (step 4).
    for grant in ["memory", "memory_write"] {
        assert!(
            umbel::plugins::PENDING_GRANTS
                .iter()
                .any(|(name, _)| *name == grant),
            "{grant}"
        );
        assert!(
            !umbel::plugins::RESERVED_GRANTS
                .iter()
                .any(|(name, _)| *name == grant),
            "{grant}"
        );
    }
}

#[test]
fn the_memory_write_table_holds_the_allow_list_and_the_sharing_policy() {
    let workspace = open(&with_memory(
        4,
        "[plugins.memory.grants.memory_write]\nallow = [\"main\", \"beta\"]\ndefault_access = \"space\"\nwriters = [\"group:platform\", \"principal:human:ada\"]\nagents_may_share = true\n",
    ))
    .unwrap();
    let instance = &workspace.config().plugins.instances[0];
    assert_eq!(instance.allow["memory_write"], ["main", "beta"]);
    let policy = instance.memory_write.as_ref().unwrap();
    assert_eq!(policy.default_access, DefaultAccess::Space);
    assert_eq!(policy.writers, ["group:platform", "principal:human:ada"]);
    assert!(policy.agents_may_share);
}

#[test]
fn the_sharing_policy_defaults_to_private_with_no_writers() {
    let workspace = open(&with_memory(
        4,
        "[plugins.memory.grants.memory_write]\nallow = [\"*\"]\n",
    ))
    .unwrap();
    let instance = &workspace.config().plugins.instances[0];
    let policy = instance.memory_write.as_ref().unwrap();
    assert_eq!(policy.default_access, DefaultAccess::Private);
    assert_eq!(policy.default_access.as_str(), "private");
    assert!(policy.writers.is_empty());
    assert!(!policy.agents_may_share);
    // An instance without the table has no policy.
    let bare = open(&with_memory(4, "")).unwrap();
    assert!(bare.config().plugins.instances[0].memory_write.is_none());
}

#[test]
fn the_policy_keys_go_on_memory_write_only_and_are_validated() {
    for (table, key) in [
        // On another write grant, and on the read grant, which takes no table at all.
        (
            "[plugins.memory.grants.records_write]\nallow = [\"main\"]\ndefault_access = \"space\"\n",
            "default_access",
        ),
        (
            "[plugins.memory.grants.records_write]\nallow = [\"main\"]\nwriters = []\n",
            "writers",
        ),
        (
            "[plugins.memory.grants.memory]\nallow = [\"main\"]\n",
            "plugins.memory.grants.memory",
        ),
        // memory_write still needs its allow list, of spaces.
        (
            "[plugins.memory.grants.memory_write]\ndefault_access = \"space\"\n",
            "allow",
        ),
        (
            "[plugins.memory.grants.memory_write]\nallow = []\n",
            "allow",
        ),
        (
            "[plugins.memory.grants.memory_write]\nallow = [\"main/notes\"]\n",
            "must be a space id",
        ),
        (
            "[plugins.memory.grants.memory_write]\nallow = [\"nowhere\"]\n",
            "nowhere",
        ),
        // The policy values.
        (
            "[plugins.memory.grants.memory_write]\nallow = [\"main\"]\ndefault_access = \"public\"\n",
            "default_access",
        ),
        (
            "[plugins.memory.grants.memory_write]\nallow = [\"main\"]\nwriters = [\"everyone\"]\n",
            "writers",
        ),
        (
            "[plugins.memory.grants.memory_write]\nallow = [\"main\"]\nwriters = [\"space\", \"space\"]\n",
            "twice",
        ),
        (
            "[plugins.memory.grants.memory_write]\nallow = [\"main\"]\nwriters = \"space\"\n",
            "writers",
        ),
        (
            "[plugins.memory.grants.memory_write]\nallow = [\"main\"]\nagents_may_share = \"yes\"\n",
            "agents_may_share",
        ),
        (
            "[plugins.memory.grants.memory_write]\nallow = [\"main\"]\nshare = true\n",
            "share",
        ),
    ] {
        invalid(&with_memory(4, table), key);
    }
}

// ── Principal and store ────────────────────────────────────────────────────────────────────────

#[test]
fn principal_agent_env_lists_variable_names() {
    let workspace = open(
        "config_version = 4\n[principal]\nlocal_id = \"ada\"\non_behalf_of = \"ada\"\nagent_env = [\"MY_AGENT\", \"_CI_BOT\"]\n",
    )
    .unwrap();
    let principal = &workspace.config().principal;
    assert_eq!(principal.agent_env, ["MY_AGENT", "_CI_BOT"]);
    assert!(
        open("config_version = 4\n")
            .unwrap()
            .config()
            .principal
            .agent_env
            .is_empty()
    );
    for value in [
        "[\"not a name\"]",
        "[\"1ABC\"]",
        "[\"\"]",
        "[\"A\", \"A\"]",
        "\"MY_AGENT\"",
    ] {
        invalid(
            &format!("config_version = 4\n[principal]\nagent_env = {value}\n"),
            "principal.agent_env",
        );
    }
    let many: Vec<String> = (0..65).map(|n| format!("\"V{n}\"")).collect();
    invalid(
        &format!(
            "config_version = 4\n[principal]\nagent_env = [{}]\n",
            many.join(", ")
        ),
        "principal.agent_env",
    );
}

#[test]
fn store_exclude_memory_from_machine_backup_defaults_to_true() {
    let default = open("config_version = 4\n").unwrap();
    assert!(default.config().store.exclude_memory_from_machine_backup);
    let off =
        open("config_version = 4\n[store]\nexclude_memory_from_machine_backup = false\n").unwrap();
    assert!(!off.config().store.exclude_memory_from_machine_backup);
    invalid(
        "config_version = 4\n[store]\nexclude_memory_from_machine_backup = \"no\"\n",
        "store.exclude_memory_from_machine_backup",
    );
}

// ── Versions ───────────────────────────────────────────────────────────────────────────────────

#[test]
fn versions_1_to_3_read_as_version_4_with_no_change_of_meaning() {
    for version in [1, 2, 3] {
        let workspace = open(&format!("config_version = {version}\n[spaces.main]\n")).unwrap();
        let config = workspace.config();
        assert_eq!(config.version, version);
        assert!(config.principal.agent_env.is_empty());
        assert_eq!(config.principal.on_behalf_of, None);
        assert!(config.store.exclude_memory_from_machine_backup);
    }
    // A version 3 file with its allow lists means what it meant.
    let three = open(&with_memory(
        3,
        "[plugins.memory.grants.records_write]\nallow = [\"main\"]\n",
    ))
    .unwrap();
    let instance = &three.config().plugins.instances[0];
    assert_eq!(instance.allow["records_write"], ["main"]);
    assert!(instance.memory_write.is_none());
}

#[test]
fn version_4_keys_are_refused_in_versions_1_to_3() {
    for version in [1, 2, 3] {
        invalid(
            &format!("config_version = {version}\n[principal]\nagent_env = [\"MY_AGENT\"]\n"),
            "principal.agent_env",
        );
    }
    for version in [2, 3] {
        invalid(
            &with_memory(version, "deny = [\"memory_write\"]\n"),
            "needs config_version = 4",
        );
    }
    invalid(
        "config_version = 3\n[store]\nexclude_memory_from_machine_backup = false\n",
        "store.exclude_memory_from_machine_backup",
    );
    invalid(
        &with_memory(
            3,
            "[plugins.memory.grants.memory_write]\nallow = [\"main\"]\n",
        ),
        "needs config_version = 4",
    );
    // `memory` was a reserved grant name before version 4, so denying it stays valid.
    open(&with_memory(3, "deny = [\"memory\"]\n")).unwrap();
}

#[test]
fn another_version_is_unsupported_and_names_1_to_4() {
    let error = open("config_version = 5\n").unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_CONFIG_UNSUPPORTED");
    assert!(error.message().contains("1 to 4"), "{error}");
    assert_eq!(umbel::CONFIG_VERSION, 4);
}

// ── umbel init ─────────────────────────────────────────────────────────────────────────────────

#[test]
fn init_writes_version_4_with_on_behalf_of_the_local_id() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("fresh");
    let workspace = Workspace::init(&target, Some("team")).unwrap();
    assert_eq!(
        fs::read_to_string(target.join("umbel.toml")).unwrap(),
        "config_version = 4\nname = \"team\"\n\n[principal]\non_behalf_of = \"local\"\n"
    );
    let config = workspace.config();
    assert_eq!(config.version, 4);
    assert_eq!(config.principal.local_id, "local");
    assert_eq!(config.principal.on_behalf_of.as_deref(), Some("local"));
    assert!(target.join("spaces/main").is_dir());
    assert_eq!(config.spaces[0].readers, ["*"]);
    let report = doctor::run(&target);
    assert!(report.healthy(), "{:?}", report.checks);

    // Without a name, the principal table is still written.
    let bare = dir.path().join("bare");
    Workspace::init(&bare, None).unwrap();
    assert_eq!(
        fs::read_to_string(bare.join("umbel.toml")).unwrap(),
        "config_version = 4\n\n[principal]\non_behalf_of = \"local\"\n"
    );
}
