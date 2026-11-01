//! The doctor's plugin checks that need only files (phase 1 specification, section 9.2): each
//! in pass, warn and fail, without a sealed host, and `skip` for a compiled source with no
//! catalog, and the sealed-host cases: `plugins.loaded` on a host that loaded its plugins.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::{Path, PathBuf};

use umbel::HostBuilder;
use umbel::doctor::{self, Check, CheckStatus, Report};
use umbel::plugins::CompiledCatalog;

const PLUGIN_CHECKS: [&str; 8] = [
    "plugins.config",
    "plugins.sources",
    "plugins.grants",
    "plugins.packs",
    "plugins.skills",
    "plugins.loaded",
    "plugins.first_class",
    "plugins.pipelines",
];

fn workspace(config: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("ws");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("umbel.toml"), config).unwrap();
    (dir, root)
}

fn write(root: &Path, rel: &str, text: &str) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
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

fn config(body: &str) -> String {
    format!("config_version = 2\n{body}")
}

/// A mounted stdio plugin `id`, with the sections in `extra`.
fn mounted(id: &str, extra: &str) -> String {
    format!(
        r#"manifest_version = 1
protocol = 1
[plugin]
id = "{id}"
title = "{id}"
version = "1.0.0"
description = "d"
kind = "mounted"
domains = ["{id}"]
[mount]
prefix = "{id}"
transport = "stdio"
command = ["bin/server"]
{extra}"#
    )
}

fn component(id: &str, grants: &str) -> String {
    format!(
        r#"manifest_version = 1
protocol = 1
[plugin]
id = "{id}"
title = "{id}"
version = "1.0.0"
description = "d"
kind = "component"
domains = ["{id}"]
[component]
path = "{id}.wasm"
{grants}"#
    )
}

fn grant(name: &str, required: bool) -> String {
    format!("[[grants]]\nname = \"{name}\"\nrequired = {required}\nreason = \"because\"\n")
}

/// A pack plugin `id` shipping the pack `voice`, with a valid pack on disk.
fn pack_plugin(root: &Path, id: &str) {
    let dir = format!("plugins/{id}");
    write(
        root,
        &format!("{dir}/umbel-plugin.toml"),
        &format!(
            r#"manifest_version = 1
protocol = 1
[plugin]
id = "{id}"
title = "{id}"
version = "1.0.0"
description = "d"
kind = "pack"
[[packs]]
id = "voice"
path = "packs/voice"
[[skills]]
name = "{id}-guide"
path = "skills/{id}-guide"
"#
        ),
    );
    write(
        root,
        &format!("{dir}/packs/voice/pack.toml"),
        &pack_toml(id, "voice"),
    );
    write(root, &format!("{dir}/packs/voice/data/words.txt"), "hello");
    write(
        root,
        &format!("{dir}/skills/{id}-guide/SKILL.md"),
        &format!("---\nname: {id}-guide\ndescription: When to use {id}.\n---\n# guide\n"),
    );
}

fn pack_toml(plugin: &str, id: &str) -> String {
    format!(
        "pack_version = 1\nid = \"{id}\"\nplugin = \"{plugin}\"\nversion = \"1.0.0\"\ntitle = \"Voice\"\ndescription = \"d\"\n"
    )
}

// ── Without plugins, and the checks' shape ─────────────────────────────────────────────────────

#[test]
fn no_plugins_passes_every_file_check_and_skips_the_sealed_ones() {
    for text in ["config_version = 1\n", "config_version = 2\n"] {
        let (_dir, root) = workspace(text);
        let report = doctor::run(&root);
        let ids: Vec<_> = report
            .checks
            .iter()
            .filter(|c| c.id.starts_with("plugins."))
            .map(|c| c.id.as_str())
            .collect();
        assert_eq!(ids, PLUGIN_CHECKS, "{text}");
        assert!(
            report.checks.iter().all(|c| c.id != "plugins.none"),
            "plugins.none is gone"
        );
        for id in &PLUGIN_CHECKS[..5] {
            assert_eq!(status(&report, id), CheckStatus::Pass, "{text}: {id}");
        }
        for id in &PLUGIN_CHECKS[5..] {
            assert_eq!(status(&report, id), CheckStatus::Skip, "{text}: {id}");
            assert!(check(&report, id).message.contains("sealed host"));
        }
        assert_eq!(
            check(&report, "plugins.config").message,
            "No plugins are enabled"
        );
        assert!(report.healthy());
    }
}

#[test]
fn a_workspace_that_cannot_be_read_skips_every_plugin_check() {
    let (_dir, root) = workspace("config_version = [\n");
    let report = doctor::run(&root);
    for id in PLUGIN_CHECKS {
        assert_eq!(status(&report, id), CheckStatus::Skip, "{id}");
    }
}

#[test]
fn a_mounted_plugin_whose_server_does_not_start_fails_the_load_and_the_doctor_still_reads_its_files()
 {
    let (_dir, root) = workspace(&config("[plugins]\nenabled = [\"hello\"]\n"));
    write(
        &root,
        "plugins/hello/umbel-plugin.toml",
        &mounted("hello", ""),
    );
    let error = HostBuilder::open(&root).unwrap().seal().err().unwrap();
    // The mounted loader tries `bin/hello`, which is not there; a build without it has no loader.
    let expected = if cfg!(feature = "mounted") {
        "PLUGIN_LOAD_FAILED"
    } else {
        "PLUGIN_KIND_UNAVAILABLE"
    };
    assert_eq!(error.code(), expected);
    assert!(error.message().contains("hello"), "{error}");
    assert!(!error.suggestion().is_empty());
    // The doctor still reports the files.
    let report = doctor::run(&root);
    assert_eq!(status(&report, "plugins.sources"), CheckStatus::Pass);
}

// ── plugins.config ─────────────────────────────────────────────────────────────────────────────

#[test]
fn plugins_config_passes_a_valid_configuration_and_fails_each_broken_rule() {
    let (_dir, root) = workspace(&config(
        "[plugins]\nenabled = [\"a\", \"b\"]\n[plugins.b]\nrequired = false\n",
    ));
    let report = doctor::run(&root);
    let found = check(&report, "plugins.config");
    assert_eq!(found.status, CheckStatus::Pass);
    assert!(
        found.message.contains("2 plugin instance(s): a, b"),
        "{}",
        found.message
    );

    for (text, key) in [
        (
            "config_version = 1\n[plugins]\nenabled = [\"x\"]\n",
            "plugins.enabled",
        ),
        (
            "config_version = 2\n[plugins]\nenabled = [\"enabled\"]\n",
            "plugins.enabled",
        ),
        (
            "config_version = 2\n[plugins]\nenabled = [\"x\"]\n[plugins.x]\nbogus = 1\n",
            "plugins.x.bogus",
        ),
        (
            "config_version = 2\n[plugins]\nenabled = [\"x\"]\n[plugins.x]\ndeny = [\"teleport\"]\n",
            "plugins.x.deny",
        ),
        (
            "config_version = 2\n[plugins]\nenabled = [\"x\"]\n[plugins.x]\nspaces = [\"nowhere\"]\n",
            "plugins.x.spaces",
        ),
        (
            "config_version = 2\n[plugins]\nenabled = [\"x\"]\n[plugins.x.limits]\nfuel = 99999999999\n",
            "plugins.x.limits.fuel",
        ),
        (
            "config_version = 2\n[plugins]\nenabled = []\n[plugins.x]\n",
            "plugins.x",
        ),
    ] {
        let (_dir, root) = workspace(text);
        let report = doctor::run(&root);
        let found = check(&report, "plugins.config");
        assert_eq!(found.status, CheckStatus::Fail, "{text}");
        assert!(found.message.contains(key), "{text}: {}", found.message);
        assert!(found.suggestion.is_some());
        assert!(!report.healthy());
        for id in &PLUGIN_CHECKS[1..5] {
            assert_eq!(status(&report, id), CheckStatus::Skip, "{text}: {id}");
        }
    }
}

#[test]
fn the_reserved_allow_key_is_a_config_keys_warning_not_a_failure() {
    let (_dir, root) = workspace(&config(
        "[plugins]\nenabled = [\"x\"]\n[plugins.x.grants.http]\nallow = [\"example.com\"]\n",
    ));
    let report = doctor::run(&root);
    assert_eq!(status(&report, "config.keys"), CheckStatus::Warn);
    assert!(
        check(&report, "config.keys")
            .message
            .contains("plugins.x.grants")
    );
    assert_eq!(status(&report, "plugins.config"), CheckStatus::Pass);
}

// ── plugins.sources ────────────────────────────────────────────────────────────────────────────

#[test]
fn a_directory_source_that_validates_passes() {
    let (_dir, root) = workspace(&config("[plugins]\nenabled = [\"tickets\"]\n"));
    write(
        &root,
        "plugins/tickets/umbel-plugin.toml",
        &mounted("tickets", ""),
    );
    let report = doctor::run(&root);
    assert_eq!(status(&report, "plugins.sources"), CheckStatus::Pass);
    assert_eq!(status(&report, "plugins.grants"), CheckStatus::Pass);
    assert!(report.healthy());
}

#[test]
fn a_source_that_does_not_resolve_fails_a_required_instance_and_warns_an_optional_one() {
    let (_dir, root) = workspace(&config(
        "[plugins]\nenabled = [\"tickets\"]\n[plugins.tickets]\nsource = \"plugins/tickets\"\n",
    ));
    let report = doctor::run(&root);
    let found = check(&report, "plugins.sources");
    assert_eq!(found.status, CheckStatus::Fail);
    assert!(
        found.message.contains("PLUGIN_NOT_FOUND"),
        "{}",
        found.message
    );
    assert!(found.message.contains("tickets"));
    assert!(
        found
            .suggestion
            .as_deref()
            .unwrap()
            .contains("plugins.tickets.source")
    );
    assert!(!report.healthy());

    let (_dir, root) = workspace(&config(
        "[plugins]\nenabled = [\"tickets\"]\n[plugins.tickets]\nsource = \"plugins/tickets\"\nrequired = false\n",
    ));
    let report = doctor::run(&root);
    assert_eq!(status(&report, "plugins.sources"), CheckStatus::Warn);
    assert!(
        report.healthy(),
        "an optional instance never makes the workspace unhealthy"
    );
    let result = report.into_result();
    assert!(result.success);
    assert_eq!(result.warnings.unwrap()[0].code, "DOCTOR_PLUGINS_SOURCES");
}

#[test]
fn a_manifest_that_breaks_a_rule_fails_with_its_code_and_key() {
    for (manifest, code, key) in [
        (
            mounted("tickets", "").replace("protocol = 1", "protocol = 2"),
            "PLUGIN_PROTOCOL_UNSUPPORTED",
            "protocol",
        ),
        (
            mounted("tickets", "").replace("kind = \"mounted\"", "kind = \"nope\""),
            "PLUGIN_MANIFEST_INVALID",
            "plugin.kind",
        ),
        (
            mounted("tickets", "url = \"x\"\n"),
            "PLUGIN_MANIFEST_INVALID",
            "mount.url",
        ),
        (
            "not = [toml".to_owned(),
            "PLUGIN_MANIFEST_INVALID",
            "umbel-plugin.toml",
        ),
    ] {
        let (_dir, root) = workspace(&config("[plugins]\nenabled = [\"tickets\"]\n"));
        write(&root, "plugins/tickets/umbel-plugin.toml", &manifest);
        let report = doctor::run(&root);
        let found = check(&report, "plugins.sources");
        assert_eq!(found.status, CheckStatus::Fail, "{key}");
        assert!(found.message.contains(code), "{key}: {}", found.message);
        assert!(found.message.contains(key), "{key}: {}", found.message);
    }
}

#[test]
fn an_instance_key_that_does_not_fit_the_plugins_kind_is_a_config_error() {
    let cases = [
        (
            "[plugins.tickets.limits]\nfuel = 10\n",
            mounted("tickets", ""),
            "limits",
        ),
        (
            "url = \"https://x.example/mcp\"\n",
            mounted("tickets", ""),
            "url",
        ),
        (
            "[plugins.tickets.env]\nA = \"b\"\n",
            mounted("tickets", "")
                .replace("stdio", "http")
                .replace("command = [\"bin/server\"]", "bearer = \"none\""),
            "env",
        ),
        ("prefix = \"other\"\n", component("tickets", ""), "prefix"),
        ("timeout_ms = 5\n", component("tickets", ""), "timeout_ms"),
        (
            "",
            mounted("tickets", "")
                .replace("stdio", "http")
                .replace("command = [\"bin/server\"]", "bearer = \"none\""),
            "url",
        ),
        (
            "url = \"https://x.example/mcp\"\n",
            mounted("tickets", "")
                .replace("stdio", "http")
                .replace("command = [\"bin/server\"]", "bearer = \"required\""),
            "bearer_env",
        ),
    ];
    for (instance, manifest, key) in cases {
        let (_dir, root) = workspace(&config(&format!(
            "[plugins]\nenabled = [\"tickets\"]\n[plugins.tickets]\nrequired = true\n{instance}"
        )));
        write(&root, "plugins/tickets/umbel-plugin.toml", &manifest);
        write(&root, "plugins/tickets/tickets.wasm", "\0asm");
        let report = doctor::run(&root);
        let found = check(&report, "plugins.sources");
        assert_eq!(found.status, CheckStatus::Fail, "{key}: {}", found.message);
        assert!(
            found.message.contains("PLUGIN_CONFIG_INVALID"),
            "{key}: {}",
            found.message
        );
        assert!(
            found.message.contains(&format!("`{key}`")),
            "{key}: {}",
            found.message
        );
    }
}

#[test]
fn an_http_mount_is_optional_by_default_so_its_failure_only_warns() {
    let http = mounted("tickets", "")
        .replace("stdio", "http")
        .replace("command = [\"bin/server\"]", "bearer = \"none\"");
    let (_dir, root) = workspace(&config("[plugins]\nenabled = [\"tickets\"]\n"));
    write(&root, "plugins/tickets/umbel-plugin.toml", &http);
    let report = doctor::run(&root);
    assert_eq!(
        status(&report, "plugins.sources"),
        CheckStatus::Warn,
        "no url"
    );
    assert!(report.healthy());
    // The deployer may make it required.
    let (_dir, root) = workspace(&config(
        "[plugins]\nenabled = [\"tickets\"]\n[plugins.tickets]\nrequired = true\n",
    ));
    write(&root, "plugins/tickets/umbel-plugin.toml", &http);
    assert_eq!(
        status(&doctor::run(&root), "plugins.sources"),
        CheckStatus::Fail
    );
    // With its url it passes.
    let (_dir, root) = workspace(&config(
        "[plugins]\nenabled = [\"tickets\"]\n[plugins.tickets]\nurl = \"http://127.0.0.1:9000/mcp\"\n",
    ));
    write(&root, "plugins/tickets/umbel-plugin.toml", &http);
    assert_eq!(
        status(&doctor::run(&root), "plugins.sources"),
        CheckStatus::Pass
    );
}

// ── Compiled sources and the catalog ───────────────────────────────────────────────────────────

const HELLO: &str = r#"manifest_version = 1
protocol = 1
[plugin]
id = "hello"
title = "Hello"
version = "0.1.0"
description = "d"
kind = "compiled"
domains = ["hello"]
"#;

#[test]
fn a_compiled_source_is_skipped_without_a_catalog_and_resolved_with_one() {
    let (_dir, root) = workspace(&config("[plugins]\nenabled = [\"hello\", \"other\"]\n"));
    let report = doctor::run(&root);
    let found = check(&report, "plugins.sources");
    assert_eq!(found.status, CheckStatus::Skip);
    assert!(
        found.message.contains("hello") && found.message.contains("other"),
        "{}",
        found.message
    );
    assert!(report.healthy(), "a skip never makes a workspace unhealthy");

    let catalog = CompiledCatalog::new().with("hello", HELLO);
    let report = doctor::run_with_catalog(&root, &catalog);
    let found = check(&report, "plugins.sources");
    // `hello` resolves; `other` is in no catalog and has no directory.
    assert_eq!(found.status, CheckStatus::Fail);
    assert!(
        found.message.contains("PLUGIN_NOT_FOUND") && found.message.contains("other"),
        "{}",
        found.message
    );
    assert!(
        !found.message.contains("hello:"),
        "hello is fine: {}",
        found.message
    );

    let (_dir, root) = workspace(&config("[plugins]\nenabled = [\"hello\"]\n"));
    let report = doctor::run_with_catalog(&root, &catalog);
    assert_eq!(status(&report, "plugins.sources"), CheckStatus::Pass);
    assert_eq!(status(&report, "plugins.grants"), CheckStatus::Pass);
}

#[test]
fn a_failure_outranks_a_skip() {
    let (_dir, root) = workspace(&config(
        "[plugins]\nenabled = [\"hello\", \"tickets\"]\n[plugins.tickets]\nsource = \"plugins/gone\"\n",
    ));
    let report = doctor::run(&root);
    assert_eq!(status(&report, "plugins.sources"), CheckStatus::Fail);
}

#[test]
fn a_source_and_the_manifests_kind_must_agree() {
    let (_dir, root) = workspace(&config("[plugins]\nenabled = [\"hello\"]\n"));
    // `compiled:hello` whose catalog manifest says component.
    let catalog = CompiledCatalog::new().with("hello", HELLO.replace("compiled", "mounted"));
    let report = doctor::run_with_catalog(&root, &catalog);
    assert_eq!(status(&report, "plugins.sources"), CheckStatus::Fail);
    // A directory holding a compiled plugin's manifest.
    write(&root, "plugins/hello/umbel-plugin.toml", HELLO);
    let report = doctor::run(&root);
    let found = check(&report, "plugins.sources");
    assert_eq!(found.status, CheckStatus::Fail);
    assert!(
        found.message.contains("PLUGIN_CONFIG_INVALID") && found.message.contains("compiled:<id>"),
        "{}",
        found.message
    );
}

#[test]
fn a_source_with_both_a_compiled_plugin_and_a_directory_is_a_conflict() {
    let (_dir, root) = workspace(&config("[plugins]\nenabled = [\"hello\"]\n"));
    write(
        &root,
        "plugins/hello/umbel-plugin.toml",
        &mounted("hello", ""),
    );
    let catalog = CompiledCatalog::new().with("hello", HELLO);
    let report = doctor::run_with_catalog(&root, &catalog);
    let found = check(&report, "plugins.sources");
    assert_eq!(found.status, CheckStatus::Fail);
    assert!(
        found.message.contains("PLUGIN_CONFLICT"),
        "{}",
        found.message
    );
}

// ── plugins.grants ─────────────────────────────────────────────────────────────────────────────

fn grants_report(instance: &str, manifest_grants: &str) -> Report {
    let (_dir, root) = workspace(&config(&format!(
        "[plugins]\nenabled = [\"hello\"]\n[plugins.hello]\nsource = \"plugins/hello\"\n{instance}"
    )));
    write(
        &root,
        "plugins/hello/umbel-plugin.toml",
        &component("hello", manifest_grants),
    );
    write(&root, "plugins/hello/hello.wasm", "\0asm");
    doctor::run(&root)
}

#[test]
fn declared_grants_in_the_catalog_pass() {
    let grants: String = ["config", "log", "packs", "events", "clock", "random"]
        .iter()
        .map(|name| grant(name, true))
        .collect();
    let report = grants_report("", &grants);
    assert_eq!(status(&report, "plugins.grants"), CheckStatus::Pass);
    assert!(
        check(&report, "plugins.grants")
            .message
            .contains("6 declared")
    );
}

#[test]
fn a_reserved_or_unknown_grant_fails_when_required_and_warns_when_optional() {
    for name in [
        "documents",
        "index",
        "graph",
        "memory",
        "http",
        "secrets",
        "teleport",
    ] {
        let report = grants_report("", &grant(name, true));
        let found = check(&report, "plugins.grants");
        assert_eq!(found.status, CheckStatus::Fail, "{name}");
        assert!(
            found.message.contains("PLUGIN_GRANT_UNAVAILABLE") && found.message.contains(name),
            "{name}: {}",
            found.message
        );
        assert!(found.suggestion.as_deref().unwrap().contains(name));

        let report = grants_report("", &grant(name, false));
        assert_eq!(
            status(&report, "plugins.grants"),
            CheckStatus::Warn,
            "{name}"
        );
    }
    let report = grants_report("", &grant("documents", true));
    assert!(check(&report, "plugins.grants").message.contains("phase 2"));
}

#[test]
fn a_denied_grant_fails_the_load_when_required_and_is_withheld_when_optional() {
    let report = grants_report("deny = [\"events\"]\n", &grant("events", true));
    let found = check(&report, "plugins.grants");
    assert_eq!(found.status, CheckStatus::Fail);
    assert!(
        found.message.contains("PLUGIN_GRANT_DENIED"),
        "{}",
        found.message
    );
    assert!(
        found
            .suggestion
            .as_deref()
            .unwrap()
            .contains("plugins.hello.deny")
    );

    let report = grants_report("deny = [\"events\"]\n", &grant("events", false));
    assert_eq!(status(&report, "plugins.grants"), CheckStatus::Warn);
    assert!(report.healthy());

    // Denying a grant the plugin does not declare does nothing.
    let report = grants_report("deny = [\"events\"]\n", &grant("clock", true));
    assert_eq!(status(&report, "plugins.grants"), CheckStatus::Pass);

    // A required grant in an optional instance only warns: the instance is skipped, the host runs.
    let report = grants_report(
        "required = false\ndeny = [\"events\"]\n",
        &grant("events", true),
    );
    assert_eq!(status(&report, "plugins.grants"), CheckStatus::Warn);
}

// ── plugins.packs and plugins.skills ───────────────────────────────────────────────────────────

fn pack_workspace() -> (tempfile::TempDir, PathBuf) {
    let (dir, root) = workspace(&config(
        "default_space = \"main\"\n[spaces.main]\n[spaces.research]\n[plugins]\nenabled = [\"style\"]\n",
    ));
    pack_plugin(&root, "style");
    (dir, root)
}

#[test]
fn packs_and_skills_that_validate_pass() {
    let (_dir, root) = pack_workspace();
    let report = doctor::run(&root);
    assert_eq!(status(&report, "plugins.sources"), CheckStatus::Pass);
    let packs = check(&report, "plugins.packs");
    assert_eq!(packs.status, CheckStatus::Pass, "{}", packs.message);
    assert!(packs.message.contains("1 pack"), "{}", packs.message);
    let skills = check(&report, "plugins.skills");
    assert_eq!(skills.status, CheckStatus::Pass, "{}", skills.message);
    assert!(skills.message.contains("1 skill"), "{}", skills.message);
}

#[test]
fn a_pack_that_breaks_a_rule_fails_with_pack_invalid() {
    for (edit, why) in [
        ("pack.toml=", "no readable pack.toml"),
        ("pack.toml=pack_version = 2\n", "pack_version"),
        ("pack.toml=extra = 1\n", "extra"),
        ("pack.toml=not toml [", "not valid TOML"),
        (
            "pack.toml=pack_version = 1\nid = \"voice\"\nplugin = \"other\"\nversion = \"1.0.0\"\ntitle = \"t\"\ndescription = \"d\"\n",
            "not `voice` of `style`",
        ),
        (
            "pack.toml=pack_version = 1\nid = \"other\"\nplugin = \"style\"\nversion = \"1.0.0\"\ntitle = \"t\"\ndescription = \"d\"\n",
            "not `voice` of `style`",
        ),
        (
            "pack.toml=pack_version = 1\nid = \"voice\"\nplugin = \"style\"\nversion = \"one\"\ntitle = \"t\"\ndescription = \"d\"\n",
            "version",
        ),
        ("stray.txt=x", "stray.txt"),
        ("notes/a.txt=x", "notes"),
    ] {
        let (_dir, root) = pack_workspace();
        let (file, text) = edit.split_once('=').unwrap();
        let pack = root.join("plugins/style/packs/voice");
        if text.is_empty() {
            fs::remove_file(pack.join(file)).unwrap();
        } else {
            write(&pack, file, text);
        }
        let report = doctor::run(&root);
        let found = check(&report, "plugins.packs");
        assert_eq!(found.status, CheckStatus::Fail, "{edit}: {}", found.message);
        assert!(
            found.message.contains("PACK_INVALID"),
            "{edit}: {}",
            found.message
        );
        assert!(found.message.contains(why), "{edit}: {}", found.message);
        assert!(!report.healthy());
    }
}

#[test]
fn a_pack_holds_at_most_1000_files() {
    let (_dir, root) = pack_workspace();
    for index in 0..1000 {
        write(
            &root,
            &format!("plugins/style/packs/voice/data/{index}.txt"),
            "x",
        );
    }
    let report = doctor::run(&root);
    let found = check(&report, "plugins.packs");
    assert_eq!(found.status, CheckStatus::Fail);
    assert!(found.message.contains("1000 files"), "{}", found.message);
}

#[test]
fn a_space_override_is_validated_for_the_spaces_the_instance_is_enabled_for() {
    let (_dir, root) = pack_workspace();
    let over = "spaces/research/packs/style/voice";
    write(
        &root,
        &format!("{over}/pack.toml"),
        &pack_toml("style", "voice"),
    );
    write(&root, &format!("{over}/data/words.txt"), "bonjour");
    assert_eq!(
        status(&doctor::run(&root), "plugins.packs"),
        CheckStatus::Pass
    );
    assert!(
        check(&doctor::run(&root), "plugins.packs")
            .message
            .contains("2 pack")
    );

    write(
        &root,
        &format!("{over}/pack.toml"),
        &pack_toml("style", "wrong"),
    );
    let report = doctor::run(&root);
    let found = check(&report, "plugins.packs");
    assert_eq!(found.status, CheckStatus::Fail);
    assert!(
        found.message.contains("spaces/research/packs/style/voice"),
        "{}",
        found.message
    );

    // The instance is enabled for main only, so research's override is not its business.
    let (_dir, root) = workspace(&config(
        "default_space = \"main\"\n[spaces.main]\n[spaces.research]\n[plugins]\nenabled = [\"style\"]\n[plugins.style]\nspaces = [\"main\"]\n",
    ));
    pack_plugin(&root, "style");
    write(&root, &format!("{over}/pack.toml"), "broken [");
    assert_eq!(
        status(&doctor::run(&root), "plugins.packs"),
        CheckStatus::Pass
    );
}

#[test]
fn a_skill_holds_at_most_512_files() {
    let (_dir, root) = pack_workspace();
    for index in 0..512 {
        write(
            &root,
            &format!("plugins/style/skills/style-guide/refs/{index}.md"),
            "x",
        );
    }
    let report = doctor::run(&root);
    let found = check(&report, "plugins.skills");
    assert_eq!(found.status, CheckStatus::Fail);
    assert!(
        found.message.contains("SKILL_INVALID") && found.message.contains("513 files"),
        "{}",
        found.message
    );
}

#[cfg(unix)]
#[test]
fn a_symlink_out_of_a_pack_or_skill_is_refused() {
    let (_dir, root) = pack_workspace();
    let outside = tempfile::tempdir().unwrap();
    write(outside.path(), "secret.txt", "x");
    std::os::unix::fs::symlink(
        outside.path().join("secret.txt"),
        root.join("plugins/style/packs/voice/data/link.txt"),
    )
    .unwrap();
    std::os::unix::fs::symlink(
        outside.path().join("secret.txt"),
        root.join("plugins/style/skills/style-guide/link.txt"),
    )
    .unwrap();
    let report = doctor::run(&root);
    assert_eq!(status(&report, "plugins.packs"), CheckStatus::Fail);
    assert!(check(&report, "plugins.packs").message.contains("symlink"));
    assert_eq!(status(&report, "plugins.skills"), CheckStatus::Fail);
}

#[test]
fn a_mounted_plugins_packs_are_checked_once_however_many_instances() {
    let (_dir, root) = workspace(&config(
        "[plugins]\nenabled = [\"a\", \"b\"]\n[plugins.a]\nsource = \"plugins/t\"\nprefix = \"tickets\"\n[plugins.b]\nsource = \"plugins/t\"\nprefix = \"tickets2\"\n",
    ));
    write(
        &root,
        "plugins/t/umbel-plugin.toml",
        &mounted(
            "tickets",
            "[[packs]]\nid = \"voice\"\npath = \"packs/voice\"\n",
        )
        .replace(
            "domains = [\"tickets\"]",
            "domains = [\"tickets\", \"tickets2\"]",
        ),
    );
    write(
        &root,
        "plugins/t/packs/voice/pack.toml",
        &pack_toml("tickets", "voice"),
    );
    let report = doctor::run(&root);
    assert_eq!(status(&report, "plugins.sources"), CheckStatus::Pass);
    assert!(
        check(&report, "plugins.packs").message.contains("1 pack"),
        "{}",
        check(&report, "plugins.packs").message
    );
}

// ── Sealed host: plugins.loaded, and the binary's catalog when seal fails ─────────────────────

mod sealed {
    use super::*;
    use afd::{Actor, ActorKind};
    use serde_json::Value;
    use std::sync::Arc;
    use umbel::cli::{Console, Environment};
    use umbel::plugins::sdk;
    use umbel::workspace::Overrides;

    fn hello() -> impl umbel::plugins::CompiledPlugin {
        sdk(umbel_plugin_hello::plugin())
    }

    struct NoPerson;

    impl Console for NoPerson {
        fn is_interactive(&self) -> bool {
            false
        }

        fn ask(&self, _text: &str) -> bool {
            false
        }
    }

    async fn sealed_report(
        root: &Path,
        configure: impl FnOnce(HostBuilder) -> HostBuilder,
    ) -> Value {
        let host = configure(HostBuilder::open(root).unwrap()).seal().unwrap();
        let actor = Actor::new(ActorKind::Test).with_id("doctor");
        let result = host
            .registry()
            .execute(
                "workspace-doctor",
                serde_json::json!({}),
                Some(host.context(actor)),
            )
            .await;
        assert!(result.success, "{result:?}");
        result.data.unwrap()
    }

    fn find<'a>(report: &'a Value, id: &str) -> &'a Value {
        report["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|check| check["id"] == id)
            .unwrap_or_else(|| panic!("no check {id}"))
    }

    #[tokio::test]
    async fn plugins_loaded_passes_naming_kinds_counts_and_the_trust_note() {
        let (_dir, root) = workspace(&config("[plugins]\nenabled = [\"hello\", \"guide\"]\n"));
        pack_plugin(&root, "guide");
        let report = sealed_report(&root, |b| b.with_compiled(hello())).await;
        let loaded = find(&report, "plugins.loaded");
        assert_eq!(loaded["status"], "pass", "{loaded}");
        let message = loaded["message"].as_str().unwrap();
        assert!(
            message.contains("hello (compiled, 1 command(s))"),
            "{message}"
        );
        assert!(message.contains("guide (pack, 0 command(s))"), "{message}");
        assert!(message.contains("trusted, not sandboxed"), "{message}");
        // The file-only checks still run, and the two that wait for the first-class set and the
        // pipelines are filled in by the sealed host (the sealed cases below cover them).
        assert_eq!(find(&report, "plugins.sources")["status"], "pass");
        assert_eq!(find(&report, "plugins.first_class")["status"], "pass");
        assert_eq!(find(&report, "plugins.pipelines")["status"], "pass");
    }

    #[tokio::test]
    async fn plugins_loaded_passes_with_no_plugins() {
        let (_dir, root) = workspace("config_version = 2\n");
        let report = sealed_report(&root, |b| b).await;
        let loaded = find(&report, "plugins.loaded");
        assert_eq!(loaded["status"], "pass");
        assert_eq!(loaded["message"], "No plugins are enabled");
    }

    #[tokio::test]
    async fn plugins_loaded_warns_when_an_optional_instance_failed() {
        let (_dir, root) = workspace(&config(
            "[plugins]\nenabled = [\"hello\", \"ghost\"]\n[plugins.ghost]\nrequired = false\n",
        ));
        let report = sealed_report(&root, |b| b.with_compiled(hello())).await;
        let loaded = find(&report, "plugins.loaded");
        assert_eq!(loaded["status"], "warn", "{loaded}");
        let message = loaded["message"].as_str().unwrap();
        assert!(
            message.contains("ghost failed to load: PLUGIN_NOT_FOUND"),
            "{message}"
        );
        assert!(message.contains("hello (compiled"), "{message}");
        assert!(!loaded["suggestion"].as_str().unwrap().is_empty());
        assert_eq!(report["healthy"], true, "a warning is not a failure");
    }

    /// `umbel workspace doctor` in process, with `configure` as the binary's hook.
    async fn cli_doctor(root: &Path, configure: impl FnOnce(HostBuilder) -> HostBuilder) -> Value {
        let environment = Environment {
            cwd: root.to_path_buf(),
            workspace: None,
            overrides: Overrides::default(),
            console: Arc::new(NoPerson),
        };
        let mut stdout = Vec::new();
        umbel::cli::run(
            ["umbel", "workspace", "doctor"],
            &environment,
            &mut stdout,
            configure,
        )
        .await;
        let document: Value = serde_json::from_slice(&stdout).unwrap();
        document
            .get("data")
            .or_else(|| document["error"].get("details"))
            .unwrap()
            .clone()
    }

    #[tokio::test]
    async fn a_compiled_source_resolves_with_the_binarys_catalog_even_when_seal_fails() {
        // `mcp.first_class_tools` names a command that does not exist, so seal fails.
        let (_dir, root) = workspace(&config(
            "[plugins]\nenabled = [\"hello\"]\n[mcp]\nfirst_class_tools = [\"nope-nope\"]\n",
        ));
        assert!(
            HostBuilder::open(&root)
                .unwrap()
                .with_compiled(hello())
                .seal()
                .is_err()
        );

        let with = cli_doctor(&root, |b| b.with_compiled(hello())).await;
        let sources = find(&with, "plugins.sources");
        assert_eq!(sources["status"], "pass", "{sources}");
        assert!(
            sources["message"]
                .as_str()
                .unwrap()
                .contains("1 source(s) resolve")
        );
        assert_eq!(find(&with, "plugins.config")["status"], "pass");

        // The same binary without the plugin cannot resolve it: the instance's source fails.
        let without = cli_doctor(&root, |b| b).await;
        assert_eq!(find(&without, "plugins.sources")["status"], "fail");
    }
}
