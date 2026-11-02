//! `umbel.toml`, configuration version 3 (phase 2 specification, sections 4.1 and 3.5):
//! collections, readers, access groups and the store; roots inside and outside the workspace,
//! symbolic links, and versions 1 and 2 read as version 3 with no collections.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::PathBuf;

use umbel::doctor::{self, CheckStatus};
use umbel::workspace::{CollectionKind, Workspace, WorkspaceError};

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

fn invalid(text: &str, key: &str) {
    let error = open(text).expect_err(text);
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{text}: {error}");
    assert!(
        error.message().contains(key),
        "{text}: {error} does not name {key}"
    );
    assert!(!error.suggestion().is_empty());
}

fn with_collection(body: &str) -> String {
    format!(
        "config_version = 3\n[spaces.main]\n[spaces.main.collections.handbook]\nroot = \"spaces/main/handbook\"\n{body}"
    )
}

const FULL: &str = r#"
config_version = 3
default_space = "main"
profile = "team"

[spaces.main]
title = "Main"
readers = ["*"]

[spaces.main.collections.handbook]
root = "spaces/main/handbook"
kind = "markdown"
include = ["**/*.md"]
exclude = ["drafts/**"]
access = ["space"]
sensitivity = "internal"
default_type = "document"
strict = false
max_file_bytes = 1048576

[spaces.main.collections.code]
root = "spaces/main/code"
kind = "code"
access = ["group:platform", "principal:human:ada"]
sensitivity = "confidential"

[spaces.research]
readers = ["group:platform", "human:ada"]

[access.groups.platform]
members = ["human:ada", "agent:ci"]

[access.groups.everyone]
members = ["*"]

[store]
lock_timeout_ms = 2500
"#;

// ── What a complete file reads as ──────────────────────────────────────────────────────────────

#[test]
fn a_full_file_reads_every_key() {
    let workspace = open(FULL).unwrap();
    let config = workspace.config();
    assert_eq!(config.version, 3);
    assert_eq!(config.store.lock_timeout_ms, 2500);
    let groups: Vec<_> = config.access.groups.iter().map(|g| g.id.as_str()).collect();
    assert_eq!(groups, ["platform", "everyone"]);
    assert_eq!(config.access.groups[0].members, ["human:ada", "agent:ci"]);

    let main = &config.spaces[0];
    assert_eq!(main.readers, ["*"]);
    let ids: Vec<_> = main.collections.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, ["handbook", "code"], "configuration order");
    let handbook = &main.collections[0];
    assert_eq!(handbook.root, "spaces/main/handbook");
    assert_eq!(handbook.kind, CollectionKind::Markdown);
    assert_eq!(handbook.exclude, ["drafts/**"]);
    assert_eq!(handbook.default_type, "document");
    assert_eq!(handbook.max_file_bytes, 1_048_576);
    assert!(!handbook.strict);
    let code = &main.collections[1];
    assert_eq!(code.kind, CollectionKind::Code);
    assert_eq!(code.access, ["group:platform", "principal:human:ada"]);
    assert_eq!(code.sensitivity, "confidential");

    let research = &config.spaces[1];
    assert_eq!(research.readers, ["group:platform", "human:ada"]);
    assert!(research.collections.is_empty());
}

#[test]
fn defaults_are_filled_by_kind() {
    let workspace = open(&with_collection("")).unwrap();
    let config = workspace.config();
    assert_eq!(config.spaces[0].readers, ["*"]);
    assert_eq!(config.store.lock_timeout_ms, 5000);
    assert!(config.access.groups.is_empty());
    let handbook = &config.spaces[0].collections[0];
    assert_eq!(handbook.kind, CollectionKind::Markdown);
    assert_eq!(handbook.include, ["**/*.md"]);
    assert!(handbook.exclude.is_empty());
    assert_eq!(handbook.access, ["space"]);
    assert_eq!(handbook.sensitivity, "internal");
    assert_eq!(handbook.default_type, "document");
    assert!(!handbook.strict);
    assert_eq!(handbook.max_file_bytes, 1_048_576);

    let workspace = open(&with_collection("kind = \"code\"\n")).unwrap();
    let code = &workspace.config().spaces[0].collections[0];
    assert_eq!(code.default_type, "code");
    assert_eq!(
        code.include,
        [
            "**/*.rs", "**/*.py", "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs"
        ]
    );
}

#[test]
fn versions_1_and_2_read_as_version_3_with_no_collections() {
    for version in [1, 2] {
        let workspace = open(&format!("config_version = {version}\n[spaces.main]\n")).unwrap();
        let config = workspace.config();
        assert_eq!(config.version, version);
        assert_eq!(config.spaces[0].readers, ["*"]);
        assert!(config.spaces[0].collections.is_empty());
        assert!(config.access.groups.is_empty());
        assert_eq!(config.store.lock_timeout_ms, 5000);
    }
}

#[test]
fn version_3_keys_are_unknown_in_versions_1_and_2() {
    for version in [1, 2] {
        invalid(
            &format!("config_version = {version}\n[access.groups.x]\nmembers = []\n"),
            "access",
        );
        invalid(
            &format!("config_version = {version}\n[store]\nlock_timeout_ms = 200\n"),
            "store",
        );
        invalid(
            &format!("config_version = {version}\n[spaces.main]\nreaders = [\"*\"]\n"),
            "spaces.main.readers",
        );
        invalid(
            &format!(
                "config_version = {version}\n[spaces.main.collections.c]\nroot = \"spaces/main/c\"\n"
            ),
            "spaces.main.collections",
        );
    }
}

#[test]
fn version_3_refuses_content_roots_and_keeps_backend_reserved() {
    let error =
        open("config_version = 3\n[spaces.main]\ncontent_roots = [\"notes\"]\n").unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
    assert!(
        error.message().contains("spaces.main.content_roots"),
        "{error}"
    );
    assert!(error.message().contains("collections"), "{error}");
    // `backend` is reserved, as in version 2: accepted here, flagged by the doctor.
    open("config_version = 3\n[spaces.main]\nbackend = \"embedded\"\n").unwrap();
    // Versions 1 and 2 still treat content_roots as reserved, not unknown.
    open("config_version = 2\n[spaces.main]\ncontent_roots = [\"notes\"]\n").unwrap();
}

#[test]
fn another_version_is_unsupported_and_names_1_2_and_3() {
    let error = open("config_version = 4\n").unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_CONFIG_UNSUPPORTED");
    assert!(error.message().contains("1, 2 and 3"), "{error}");
}

// ── Collections ────────────────────────────────────────────────────────────────────────────────

#[test]
fn collection_ids_roots_and_values_are_validated_with_the_key_named() {
    let bad_id = "config_version = 3\n[spaces.main.collections.Bad]\nroot = \"x\"\n";
    invalid(bad_id, "spaces.main.collections.Bad");
    invalid(
        "config_version = 3\n[spaces.main.collections.a]\n",
        "spaces.main.collections.a.root",
    );
    for root in ["/etc", "../outside", "a/../../b", "a\\\\b", "", "C:/x", "."] {
        invalid(
            &format!("config_version = 3\n[spaces.main.collections.a]\nroot = \"{root}\"\n"),
            "spaces.main.collections.a.root",
        );
    }
    invalid(
        "config_version = 3\n[spaces.main.collections.a]\nroot = \"state/x\"\n",
        "state/",
    );
    for (body, key) in [
        ("kind = \"pdf\"\n", "kind"),
        ("include = []\n", "include"),
        ("include = [\"/abs/**\"]\n", "include"),
        ("exclude = [\"../x\"]\n", "exclude"),
        ("access = []\n", "access"),
        ("access = [\"everyone\"]\n", "access"),
        ("access = [\"group:Bad\"]\n", "access"),
        ("access = [\"principal:robot:x\"]\n", "access"),
        ("sensitivity = \"secret\"\n", "sensitivity"),
        ("default_type = \"\"\n", "default_type"),
        ("strict = \"yes\"\n", "strict"),
        ("max_file_bytes = 0\n", "max_file_bytes"),
        ("max_file_bytes = 16777217\n", "max_file_bytes"),
        ("bogus = 1\n", "bogus"),
    ] {
        invalid(
            &with_collection(body),
            &format!("collections.handbook.{key}"),
        );
    }
    open(&with_collection("max_file_bytes = 16777216\n")).unwrap();
    open(&with_collection("max_file_bytes = 1\n")).unwrap();
}

#[test]
fn roots_of_one_space_may_not_overlap_but_other_spaces_may_share_a_path() {
    let overlapping = |a: &str, b: &str| {
        format!(
            "config_version = 3\n[spaces.main.collections.a]\nroot = \"{a}\"\n[spaces.main.collections.b]\nroot = \"{b}\"\n"
        )
    };
    for (a, b) in [
        ("spaces/main/x", "spaces/main/x"),
        ("spaces/main/x", "spaces/main/x/y"),
        ("spaces/main/x/y", "spaces/main/x"),
        ("./spaces/main/x/", "spaces/main/x"),
    ] {
        invalid(&overlapping(a, b), "collections.b.root");
    }
    open(&overlapping("spaces/main/x", "spaces/main/xy")).unwrap();
    open("config_version = 3\ndefault_space = \"a\"\n[spaces.a.collections.c]\nroot = \"shared\"\n[spaces.b.collections.c]\nroot = \"shared\"\n").unwrap();
}

#[test]
fn a_root_may_be_a_symbolic_link_inside_the_workspace_but_not_one_that_leaves_it() {
    let (dir, root) = workspace_with(&with_collection(""));
    fs::create_dir_all(root.join("spaces/real")).unwrap();
    fs::create_dir_all(root.join("spaces/main")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        symlink(root.join("spaces/real"), root.join("spaces/main/handbook")).unwrap();
        Workspace::open(&root).expect("a link to a directory inside the workspace");
        fs::remove_file(root.join("spaces/main/handbook")).unwrap();

        let outside = dir.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join("spaces/main/handbook")).unwrap();
        let error = Workspace::open(&root).unwrap_err();
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
        assert!(
            error.message().contains("collections.handbook.root"),
            "{error}"
        );
        assert!(error.message().contains("outside the workspace"), "{error}");

        // A link in the middle of the path leads out just the same.
        fs::remove_file(root.join("spaces/main/handbook")).unwrap();
        symlink(&outside, root.join("spaces/main/handbook")).unwrap();
        fs::write(
            root.join("umbel.toml"),
            with_collection("").replace("spaces/main/handbook", "spaces/main/handbook/inner"),
        )
        .unwrap();
        fs::create_dir_all(outside.join("inner")).unwrap();
        assert!(Workspace::open(&root).is_err());
    }
    #[cfg(not(unix))]
    let _ = dir;
}

#[test]
fn two_roots_that_resolve_to_one_directory_overlap() {
    let (_dir, root) = workspace_with(
        "config_version = 3\n[spaces.main.collections.a]\nroot = \"spaces/a\"\n[spaces.main.collections.b]\nroot = \"spaces/b\"\n",
    );
    fs::create_dir_all(root.join("spaces/a")).unwrap();
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root.join("spaces/a"), root.join("spaces/b")).unwrap();
        let error = Workspace::open(&root).unwrap_err();
        assert!(error.message().contains("collections.b.root"), "{error}");
        assert!(error.message().contains("overlaps"), "{error}");
    }
}

#[test]
fn a_root_that_does_not_exist_yet_opens_and_the_doctor_reports_it() {
    let (_dir, root) = workspace_with(&with_collection(""));
    Workspace::open(&root).expect("a missing root is the doctor's to report");
    let report = doctor::run(&root);
    let check = report
        .checks
        .iter()
        .find(|check| check.id == "collections.roots")
        .unwrap();
    assert_eq!(check.status, CheckStatus::Fail);
    assert!(
        check.message.contains("does not exist"),
        "{}",
        check.message
    );
    assert!(check.message.contains("handbook"), "{}", check.message);
    assert!(
        check
            .suggestion
            .as_deref()
            .is_some_and(|s| s.contains("umbel.toml"))
    );
    assert!(!report.healthy());

    fs::create_dir_all(root.join("spaces/main/handbook")).unwrap();
    let report = doctor::run(&root);
    let check = report
        .checks
        .iter()
        .find(|check| check.id == "collections.roots")
        .unwrap();
    assert_eq!(check.status, CheckStatus::Pass, "{}", check.message);

    // A file where a directory belongs.
    fs::remove_dir(root.join("spaces/main/handbook")).unwrap();
    fs::write(root.join("spaces/main/handbook"), "x").unwrap();
    let report = doctor::run(&root);
    let check = report
        .checks
        .iter()
        .find(|check| check.id == "collections.roots")
        .unwrap();
    assert_eq!(check.status, CheckStatus::Fail);
    assert!(
        check.message.contains("not a directory"),
        "{}",
        check.message
    );
}

#[test]
fn the_doctor_passes_collections_roots_without_collections_and_skips_without_a_config() {
    let (_dir, root) = workspace_with("config_version = 2\n");
    let report = doctor::run(&root);
    let check = report
        .checks
        .iter()
        .find(|check| check.id == "collections.roots")
        .unwrap();
    assert_eq!(check.status, CheckStatus::Pass);

    let (_dir, root) = workspace_with("config_version = [\n");
    let report = doctor::run(&root);
    let check = report
        .checks
        .iter()
        .find(|check| check.id == "collections.roots")
        .unwrap();
    assert_eq!(check.status, CheckStatus::Skip);
}

#[cfg(unix)]
#[test]
fn the_doctor_fails_a_root_that_leaves_the_workspace() {
    let (dir, root) = workspace_with(&with_collection(""));
    let outside = dir.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::create_dir_all(root.join("spaces/main")).unwrap();
    std::os::unix::fs::symlink(&outside, root.join("spaces/main/handbook")).unwrap();
    let report = doctor::run(&root);
    let check = report
        .checks
        .iter()
        .find(|check| check.id == "collections.roots")
        .unwrap();
    assert_eq!(check.status, CheckStatus::Fail);
    assert!(
        check.message.contains("outside the workspace"),
        "{}",
        check.message
    );
}

// ── Readers, groups and the store ──────────────────────────────────────────────────────────────

#[test]
fn readers_follow_the_grammar_and_name_declared_groups() {
    for ok in [
        "readers = [\"*\"]",
        "readers = [\"human:ada\", \"agent:ci\", \"service:s\", \"script:j\"]",
        "readers = [\"agent:a:b\"]",
        "readers = [\"group:platform\"]",
    ] {
        open(&format!(
            "config_version = 3\n[spaces.main]\n{ok}\n[access.groups.platform]\nmembers = []\n"
        ))
        .unwrap_or_else(|e| panic!("{ok}: {e}"));
    }
    for bad in [
        "readers = []",
        "readers = [\"ada\"]",
        "readers = [\"robot:x\"]",
        "readers = [\"human:\"]",
        "readers = [\"space\"]",
        "readers = [\"group:Bad\"]",
        "readers = \"*\"",
        "readers = [1]",
    ] {
        invalid(
            &format!("config_version = 3\n[spaces.main]\n{bad}\n"),
            "spaces.main.readers",
        );
    }
    let undeclared = "config_version = 3\n[spaces.main]\nreaders = [\"group:nobody\"]\n";
    invalid(undeclared, "spaces.main.readers");
    invalid(undeclared, "nobody");
}

#[test]
fn a_group_in_an_access_set_must_be_declared() {
    invalid(
        &with_collection("access = [\"group:nobody\"]\n"),
        "collections.handbook.access",
    );
    open(&format!(
        "{}[access.groups.nobody]\nmembers = []\n",
        with_collection("access = [\"group:nobody\"]\n")
    ))
    .unwrap();
}

#[test]
fn groups_hold_principal_strings_or_a_star() {
    for ok in ["[]", "[\"*\"]", "[\"human:ada\", \"agent:ci\"]"] {
        open(&format!(
            "config_version = 3\n[access.groups.x]\nmembers = {ok}\n"
        ))
        .unwrap();
    }
    for bad in [
        "[\"ada\"]",
        "[\"group:y\"]",
        "[\"robot:x\"]",
        "\"*\"",
        "[2]",
    ] {
        invalid(
            &format!("config_version = 3\n[access.groups.x]\nmembers = {bad}\n"),
            "access.groups.x.members",
        );
    }
    invalid(
        "config_version = 3\n[access.groups.x]\n",
        "access.groups.x.members",
    );
    invalid(
        "config_version = 3\n[access.groups.Bad]\nmembers = []\n",
        "access.groups.Bad",
    );
    invalid(
        "config_version = 3\n[access.groups.x]\nmembers = []\nbogus = 1\n",
        "access.groups.x.bogus",
    );
    invalid("config_version = 3\n[access]\nbogus = 1\n", "access.bogus");
    invalid("config_version = 3\naccess = 3\n", "access");
}

#[test]
fn the_store_section_is_validated() {
    open("config_version = 3\n[store]\nlock_timeout_ms = 100\n").unwrap();
    open("config_version = 3\n[store]\nlock_timeout_ms = 600000\n").unwrap();
    for bad in ["99", "600001", "\"fast\""] {
        invalid(
            &format!("config_version = 3\n[store]\nlock_timeout_ms = {bad}\n"),
            "store.lock_timeout_ms",
        );
    }
    invalid("config_version = 3\n[store]\nbogus = 1\n", "store.bogus");
}

#[test]
fn the_profile_stays_team() {
    invalid("config_version = 3\nprofile = \"org\"\n", "profile");
}

#[test]
fn unknown_collection_keys_are_found_by_the_key_scan() {
    let file = umbel::workspace::ConfigFile::parse(
        "config_version = 3\n[spaces.main.collections.a]\nroot = \"r\"\nbogus = 1\n[access.groups.g]\nmembers = []\nbogus = 2\n",
    )
    .unwrap();
    let scan = file.scan_keys();
    assert_eq!(
        scan.unknown,
        ["access.groups.g.bogus", "spaces.main.collections.a.bogus"]
    );
}

// ── init ───────────────────────────────────────────────────────────────────────────────────────

#[test]
fn init_writes_version_3_and_creates_spaces_main() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("fresh");
    let workspace = Workspace::init(&target, Some("team")).unwrap();
    assert_eq!(
        fs::read_to_string(target.join("umbel.toml")).unwrap(),
        "config_version = 3\nname = \"team\"\n"
    );
    assert_eq!(workspace.config().version, 3);
    assert!(target.join("spaces/main").is_dir());
    assert_eq!(workspace.config().spaces[0].readers, ["*"]);
    let report = doctor::run(&target);
    assert!(report.healthy(), "{:?}", report.checks);
}

// ── Allow lists (phase 2 step 4) ───────────────────────────────────────────────────────────────

const WITH_GRANTS: &str = r#"
config_version = 3
default_space = "main"
[spaces.main]
[spaces.beta]
[plugins]
enabled = ["notes"]
[plugins.notes]
source = "compiled:notes"
"#;

#[test]
fn version_3_reads_allow_lists_per_write_grant() {
    let workspace = open(&format!(
        "{WITH_GRANTS}[plugins.notes.grants.documents_write]\nallow = [\"main/handbook\", \"beta/*\"]\n[plugins.notes.grants.index_write]\nallow = [\"main\"]\n[plugins.notes.grants.graph_write]\nallow = [\"*\"]\n"
    ))
    .unwrap();
    let instance = &workspace.config().plugins.instances[0];
    assert_eq!(
        instance.allow["documents_write"],
        ["main/handbook", "beta/*"]
    );
    assert_eq!(instance.allow["index_write"], ["main"]);
    assert_eq!(instance.allow["graph_write"], ["*"]);
    // Nothing is read for a grant that is not listed.
    assert!(!instance.allow.contains_key("records_write"));
}

#[test]
fn an_allow_list_is_checked_against_its_grants_form_and_the_declared_spaces() {
    for (grant, allow, key) in [
        ("documents", "[\"main\"]", "plugins.notes.grants.documents"),
        ("http", "[\"example.com\"]", "plugins.notes.grants.http"),
        ("documents_write", "[]", "allow"),
        (
            "documents_write",
            "[\"main\"]",
            "must be <space>/<collection>",
        ),
        ("documents_write", "[\"main/a\", \"main/a\"]", "twice"),
        ("documents_write", "[\"nowhere/a\"]", "nowhere"),
        ("records_write", "[\"main/notes\"]", "must be a space id"),
        ("records_write", "[\"nowhere\"]", "nowhere"),
        ("index_write", "[\"Main\"]", "must be a space id"),
        (
            "content_write",
            "[\"main/Bad Name\"]",
            "must be <space>/<collection>",
        ),
    ] {
        invalid(
            &format!("{WITH_GRANTS}[plugins.notes.grants.{grant}]\nallow = {allow}\n"),
            key,
        );
    }
    invalid(
        &format!("{WITH_GRANTS}[plugins.notes.grants.documents_write]\n"),
        "allow",
    );
    invalid(
        &format!(
            "{WITH_GRANTS}[plugins.notes.grants.documents_write]\nallow = [\"main/*\"]\nother = 1\n"
        ),
        "other",
    );
}

#[test]
fn versions_1_and_2_still_treat_grants_as_reserved() {
    for version in [1, 2] {
        let text = format!(
            "config_version = {version}\n[plugins]\nenabled = [\"notes\"]\n[plugins.notes]\n[plugins.notes.grants.documents_write]\nallow = [\"main/*\"]\n"
        );
        if version == 1 {
            continue; // version 1 has no plugin instances at all
        }
        let workspace = open(&text).unwrap();
        assert!(workspace.config().plugins.instances[0].allow.is_empty());
        let (_dir, root) = workspace_with(&text);
        let report = doctor::run(&root);
        let keys = report
            .checks
            .iter()
            .find(|c| c.id == "config.keys")
            .unwrap();
        assert_eq!(
            keys.status,
            CheckStatus::Warn,
            "reserved, not unknown: {keys:?}"
        );
    }
}
