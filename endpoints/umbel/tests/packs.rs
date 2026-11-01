//! Packs and per-space overrides (phase 1 specification, section 8.2, D46): the plugin ships a
//! default pack, a space may hold its own copy that replaces the default **whole** (files are
//! never merged), an invalid override or default fails the load, and `plugin-show` reports which
//! copy each space gets.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use std::fs;
use std::path::Path;
use support::plugins::{closure, config, seal};
use support::{agent, call};
use umbel::plugins::{Asset, CompiledPlugin, HostServices, PluginCommand, PluginError, Services};
use umbel::testkit::TestHost;

const MANIFEST: &str = r#"manifest_version = 1
protocol = 1

[plugin]
id = "packer"
title = "Packer"
version = "1.0.0"
description = "Reads its pack."
kind = "compiled"
domains = ["packer"]

[[grants]]
name = "packs"
reason = "Reads the pack."

[[commands]]
name = "packer-list"
description = "List the pack's files in the call's space."
effects = ["inspect"]
input_schema = { type = "object", properties = { space = { type = "string" } }, additionalProperties = false }

[[commands]]
name = "packer-read"
description = "Read one file of the pack in the call's space."
effects = ["inspect"]
input_schema = { type = "object", properties = { space = { type = "string" }, path = { type = "string" } }, additionalProperties = false }

[[packs]]
id = "p"
path = "packs/p"
"#;

fn pack_toml(version: &str) -> String {
    format!(
        "pack_version = 1\nid = \"p\"\nplugin = \"packer\"\nversion = \"{version}\"\ntitle = \"P\"\ndescription = \"d\"\n"
    )
}

static ASSETS: &[Asset] = &[
	Asset {
		path: "packs/p/pack.toml",
		bytes: b"pack_version = 1\nid = \"p\"\nplugin = \"packer\"\nversion = \"1.0.0\"\ntitle = \"P\"\ndescription = \"d\"\n",
	},
	Asset {
		path: "packs/p/data/a.txt",
		bytes: b"default a",
	},
	Asset {
		path: "packs/p/data/b.txt",
		bytes: b"default b",
	},
];

/// A compiled plugin whose commands read its pack through the `packs` grant.
struct Packer {
    assets: &'static [Asset],
}

impl Packer {
    fn new() -> Self {
        Self { assets: ASSETS }
    }
}

impl CompiledPlugin for Packer {
    fn manifest(&self) -> &str {
        MANIFEST
    }

    fn assets(&self) -> &'static [Asset] {
        self.assets
    }

    fn commands(&self, services: Services) -> Result<Vec<PluginCommand>, PluginError> {
        let lister = services.clone();
        let reader = services;
        Ok(vec![
            closure("packer-list", move |input, context| {
                let call = lister.call(&input, &context);
                match call.pack_list("p") {
                    Ok(files) => {
                        afd::success(json!({ "files": files, "space": call.space().as_str() }))
                    }
                    Err(error) => failed(&error),
                }
            }),
            closure("packer-read", move |input, context| {
                let call = reader.call(&input, &context);
                let path = input["path"].as_str().unwrap_or_default();
                match call.pack_read("p", path) {
                    Ok(bytes) => afd::success(json!({ "text": String::from_utf8_lossy(&bytes) })),
                    Err(error) => failed(&error),
                }
            }),
        ])
    }
}

fn failed(error: &umbel::plugins::ServiceError) -> afd::CommandResult<Value> {
    afd::failure(
        afd::CommandError::new("PACKER_READ", error.to_string())
            .with_suggestion("Read a file the effective pack has."),
    )
}

fn write(dir: &Path, rel: &str, text: &str) {
    let path = dir.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

/// The override directory of `space`'s copy of the pack `p` in a workspace.
fn override_dir(workspace: &Path, space: &str) -> std::path::PathBuf {
    workspace.join("spaces").join(space).join("packs/packer/p")
}

fn workspace_with(instance_body: &str) -> tempfile::TempDir {
    support::workspace(&config(&[("packer", instance_body)], ""))
}

async fn list(host: &umbel::Host, space: &str) -> Value {
    let result = call(host, agent("a"), "packer-list", json!({ "space": space })).await;
    assert!(result.success, "{result:?}");
    result.data.unwrap()
}

#[tokio::test]
async fn a_space_without_an_override_uses_the_default_and_one_with_it_replaces_it_whole() {
    let dir = workspace_with("");
    let over = override_dir(dir.path(), "second");
    write(&over, "pack.toml", &pack_toml("2.5.0"));
    write(&over, "data/a.txt", "second a");
    write(&over, "reference/only-here.md", "# only in the override");
    let host = seal(dir.path(), |b| b.with_compiled(Packer::new())).unwrap();

    let main = list(&host, "main").await;
    assert_eq!(
        main["files"],
        json!(["data/a.txt", "data/b.txt", "pack.toml"])
    );
    let second = list(&host, "second").await;
    // Whole replacement: `data/b.txt` exists only in the default, so it is absent here.
    assert_eq!(
        second["files"],
        json!(["data/a.txt", "pack.toml", "reference/only-here.md"])
    );

    let read = |space: &'static str, path: &'static str| {
        let host = &host;
        async move {
            call(
                host,
                agent("a"),
                "packer-read",
                json!({ "space": space, "path": path }),
            )
            .await
        }
    };
    assert_eq!(
        read("main", "data/a.txt").await.data.unwrap()["text"],
        "default a"
    );
    assert_eq!(
        read("second", "data/a.txt").await.data.unwrap()["text"],
        "second a"
    );
    assert_eq!(
        read("main", "data/b.txt").await.data.unwrap()["text"],
        "default b"
    );
    let absent = read("second", "data/b.txt").await;
    assert!(!absent.success);
    assert!(absent.error.unwrap().message.contains("no file"));
    // A path cannot leave the pack.
    assert!(!read("second", "../p/data/a.txt").await.success);
}

#[tokio::test]
async fn plugin_show_reports_default_or_override_with_version_and_file_count_per_space() {
    let dir = workspace_with("");
    let over = override_dir(dir.path(), "second");
    write(&over, "pack.toml", &pack_toml("2.5.0"));
    write(&over, "data/a.txt", "second a");
    let host = seal(dir.path(), |b| b.with_compiled(Packer::new())).unwrap();

    let shown = call(
        &host,
        agent("a"),
        "plugin-show",
        json!({ "plugin": "packer" }),
    )
    .await;
    let packs = shown.data.unwrap()["packs"].clone();
    assert_eq!(packs[0]["id"], "p");
    assert_eq!(
        packs[0]["spaces"],
        json!([
            { "space": "main", "source": "default", "version": "1.0.0", "files": 3 },
            { "space": "second", "source": "override", "version": "2.5.0", "files": 2 },
        ])
    );
}

#[tokio::test]
async fn an_override_in_a_space_the_instance_is_not_enabled_for_is_not_read() {
    let dir = workspace_with("spaces = [\"main\"]");
    // Not even a valid pack: the instance is not enabled for `second`, so nothing reads it.
    write(
        &override_dir(dir.path(), "second"),
        "junk.txt",
        "not a pack",
    );
    let host = seal(dir.path(), |b| b.with_compiled(Packer::new())).unwrap();
    let shown = call(
        &host,
        agent("a"),
        "plugin-show",
        json!({ "plugin": "packer" }),
    )
    .await;
    let spaces = shown.data.unwrap()["packs"][0]["spaces"].clone();
    assert_eq!(spaces.as_array().unwrap().len(), 1);
    assert_eq!(spaces[0]["source"], "default");
}

#[test]
fn an_invalid_override_fails_the_load_naming_the_path() {
    type Case = (&'static str, Box<dyn Fn(&Path)>, &'static str);
    let cases: Vec<Case> = vec![
        (
            "no pack.toml",
            Box::new(|over| write(over, "data/a.txt", "x")),
            "pack.toml",
        ),
        (
            "another pack's id",
            Box::new(|over| {
                write(
                    over,
                    "pack.toml",
                    &pack_toml("1.0.0").replace("id = \"p\"", "id = \"q\""),
                );
            }),
            "declares id `q`",
        ),
        (
            "another plugin's pack",
            Box::new(|over| {
                write(
                    over,
                    "pack.toml",
                    &pack_toml("1.0.0").replace("plugin = \"packer\"", "plugin = \"other\""),
                );
            }),
            "of plugin `other`",
        ),
        (
            "a file the pack may not hold",
            Box::new(|over| {
                write(over, "pack.toml", &pack_toml("1.0.0"));
                write(over, "notes.txt", "stray");
            }),
            "holds `notes.txt`",
        ),
        (
            "an unknown directory",
            Box::new(|over| {
                write(over, "pack.toml", &pack_toml("1.0.0"));
                write(over, "extras/x.txt", "stray");
            }),
            "holds `extras`",
        ),
        (
            "a bad version",
            Box::new(|over| write(over, "pack.toml", &pack_toml("one"))),
            "version",
        ),
    ];
    for (label, build, expected) in cases {
        let dir = workspace_with("");
        build(&override_dir(dir.path(), "second"));
        let error = seal(dir.path(), |b| b.with_compiled(Packer::new()))
            .err()
            .unwrap_or_else(|| panic!("{label}: the load should fail"));
        assert_eq!(error.code(), "PACK_INVALID", "{label}: {error}");
        assert!(error.message().contains(expected), "{label}: {error}");
        assert!(
            error.message().contains("spaces"),
            "{label}: the message names the override's path: {error}"
        );
    }
}

#[test]
fn an_override_over_the_file_limit_fails_the_load() {
    let dir = workspace_with("");
    let over = override_dir(dir.path(), "second");
    write(&over, "pack.toml", &pack_toml("1.0.0"));
    for index in 0..umbel::plugins::MAX_PACK_FILES {
        write(&over, &format!("data/f{index}.txt"), "x");
    }
    // 1000 data files plus pack.toml is 1001 files.
    let error = seal(dir.path(), |b| b.with_compiled(Packer::new()))
        .err()
        .unwrap();
    assert_eq!(error.code(), "PACK_INVALID");
    assert!(error.message().contains("1001 files"), "{error}");
}

#[cfg(unix)]
#[test]
fn an_override_symlink_that_leaves_the_pack_fails_the_load() {
    let dir = workspace_with("");
    let over = override_dir(dir.path(), "second");
    write(&over, "pack.toml", &pack_toml("1.0.0"));
    write(dir.path(), "outside.txt", "secret");
    fs::create_dir_all(over.join("data")).unwrap();
    std::os::unix::fs::symlink(dir.path().join("outside.txt"), over.join("data/link.txt")).unwrap();
    let error = seal(dir.path(), |b| b.with_compiled(Packer::new()))
        .err()
        .unwrap();
    assert_eq!(error.code(), "PACK_INVALID");
    assert!(error.message().contains("symlink"), "{error}");
}

#[test]
fn an_invalid_override_of_an_optional_instance_skips_it_and_plugin_list_reports_it() {
    let dir = workspace_with("required = false");
    write(
        &override_dir(dir.path(), "second"),
        "data/a.txt",
        "no pack.toml",
    );
    let host = seal(dir.path(), |b| b.with_compiled(Packer::new())).unwrap();
    assert!(
        host.registry().get("packer-list").is_none(),
        "nothing of it registered"
    );
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    let listed = runtime
        .block_on(call(&host, agent("a"), "plugin-list", json!({})))
        .data
        .unwrap();
    assert_eq!(listed["plugins"][0]["status"], "failed");
    assert_eq!(listed["plugins"][0]["error"]["code"], "PACK_INVALID");
}

#[test]
fn a_default_pack_that_is_not_valid_fails_the_load_too() {
    static BAD: &[Asset] = &[Asset {
        path: "packs/p/pack.toml",
        bytes: b"pack_version = 2\n",
    }];
    let dir = workspace_with("");
    let error = seal(dir.path(), |b| b.with_compiled(Packer { assets: BAD }))
        .err()
        .unwrap();
    assert_eq!(error.code(), "PACK_INVALID");
    assert!(error.message().contains("pack_version"), "{error}");
}

#[tokio::test]
async fn the_test_kit_gives_a_space_its_own_copy_of_a_pack() {
    let source = tempfile::tempdir().unwrap();
    write(
        source.path(),
        "pack.toml",
        "pack_version = 1\nid = \"greetings\"\nplugin = \"hello\"\nversion = \"9.0.0\"\ntitle = \"Ranch\"\ndescription = \"d\"\n",
    );
    write(source.path(), "data/salutation.txt", "Howdy");
    let host = TestHost::compiled(umbel::plugins::sdk(umbel_plugin_hello::plugin()))
        .spaces(&["main", "ranch"])
        .pack_override("ranch", "greetings", source.path())
        .boot()
        .unwrap();
    let greeting = |space: &'static str| {
        let host = &host;
        async move {
            host.call("hello-greet", json!({ "name": "Ada", "space": space }))
                .await
                .data
                .unwrap()["greeting"]
                .clone()
        }
    };
    assert_eq!(greeting("main").await, "Hello, Ada!");
    assert_eq!(greeting("ranch").await, "Howdy, Ada!");
}
