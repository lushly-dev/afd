//! Skills on three paths and the origin `_meta` of plugin tools (phase 1 specification, sections
//! 8.1 and 8.3): the skill rules, `skills/list`, `skills/get` and `resources/*` in both eras on
//! both transports, `skill-list`, and `skill-export`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use support::mcp::{Client, Era, Http};
use support::plugins::{Raw, config, echo, echo_manifest, seal};
use support::{agent, call};
use umbel::plugins::{CompiledPlugin, PluginCommand, sdk};
use umbel::testkit::TestHost;

const SKILL_EXTENSION: &str = "io.modelcontextprotocol/skills";

fn hello() -> impl CompiledPlugin {
    sdk(umbel_plugin_hello::plugin())
}

fn hello_files() -> Vec<(String, Vec<u8>)> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("plugins/hello/skills/hello-guide");
    let mut files = Vec::new();
    for name in ["SKILL.md", "references/override.md"] {
        files.push((name.to_owned(), std::fs::read(root.join(name)).unwrap()));
    }
    files
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn data(result: &afd::CommandResult<Value>) -> Value {
    assert!(result.success, "{result:?}");
    result.data.clone().unwrap()
}

fn error_code(response: &Value) -> i64 {
    response["error"]["code"]
        .as_i64()
        .unwrap_or_else(|| panic!("no error: {response}"))
}

// ── A pack plugin on disk, for the rules ───────────────────────────────────────────────────────

const GOOD_SKILL: &str =
    "---\nname: style-guide\ndescription: When to follow the house style.\n---\n\n# Style\n";

fn write(root: &Path, rel: &str, text: &str) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

/// A pack plugin `style` at `plugins/<dir>` shipping the skill `style-guide` with `skill_md`.
fn style_plugin(root: &Path, dir: &str, skill_md: &str) {
    write(
        root,
        &format!("plugins/{dir}/umbel-plugin.toml"),
        r#"manifest_version = 1
protocol = 1

[plugin]
id = "style"
title = "Style"
version = "2.0.0"
description = "Skills only."
kind = "pack"

[[skills]]
name = "style-guide"
path = "skills/style-guide"
"#,
    );
    write(
        root,
        &format!("plugins/{dir}/skills/style-guide/SKILL.md"),
        skill_md,
    );
}

fn style_workspace(skill_md: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = support::workspace(&config(&[("style", "")], ""));
    let root = dir.path().to_path_buf();
    style_plugin(&root, "style", skill_md);
    (dir, root)
}

// ── The rules ──────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_valid_skill_loads() {
    let (_dir, root) = style_workspace(GOOD_SKILL);
    let host = seal(&root, |b| b).unwrap();
    assert!(host.registry().has("skill-list"));
}

#[test]
fn a_skill_that_breaks_a_rule_fails_the_load_with_skill_invalid() {
    let cases: [(&str, String); 7] = [
        ("no frontmatter", "# Style\n".to_owned()),
        (
            "a name that is not the skill's",
            "---\nname: style-other\ndescription: d\n---\n".to_owned(),
        ),
        ("no description", "---\nname: style-guide\n---\n".to_owned()),
        (
            "an empty description",
            "---\nname: style-guide\ndescription: \"\"\n---\n".to_owned(),
        ),
        (
            "frontmatter that is not a mapping",
            "---\n- a\n- b\n---\n".to_owned(),
        ),
        (
            "an anchor",
            "---\nname: style-guide\ndescription: &a d\n---\n".to_owned(),
        ),
        (
            "a description over 1024 characters",
            format!(
                "---\nname: style-guide\ndescription: {}\n---\n",
                "x".repeat(1025)
            ),
        ),
    ];
    for (label, skill_md) in cases {
        let (_dir, root) = style_workspace(&skill_md);
        let error = seal(&root, |b| b)
            .err()
            .unwrap_or_else(|| panic!("{label}"));
        assert_eq!(error.code(), "SKILL_INVALID", "{label}: {error}");
        assert!(
            error.message().contains("skills/style-guide"),
            "{label}: {error}"
        );
        assert!(!error.suggestion().is_empty(), "{label}");
    }
}

#[test]
fn the_file_rules_hold_for_a_skill_a_plugin_ships() {
    // AFD's name rule is stricter than the manifest's: no `--`.
    let (_dir, root) = style_workspace(GOOD_SKILL);
    write(
        &root,
        "plugins/style/umbel-plugin.toml",
        &std::fs::read_to_string(root.join("plugins/style/umbel-plugin.toml"))
            .unwrap()
            .replace("style-guide", "style--guide"),
    );
    std::fs::rename(
        root.join("plugins/style/skills/style-guide"),
        root.join("plugins/style/skills/style--guide"),
    )
    .unwrap();
    write(
        &root,
        "plugins/style/skills/style--guide/SKILL.md",
        "---\nname: style--guide\ndescription: d\n---\n",
    );
    let error = seal(&root, |b| b).err().unwrap();
    assert_eq!(error.code(), "SKILL_INVALID", "{error}");

    // `.umbel-origin.json` is the export's.
    let (_dir, root) = style_workspace(GOOD_SKILL);
    write(
        &root,
        "plugins/style/skills/style-guide/.umbel-origin.json",
        "{}",
    );
    let error = seal(&root, |b| b).err().unwrap();
    assert_eq!(error.code(), "SKILL_INVALID", "{error}");
    assert!(error.message().contains(".umbel-origin.json"), "{error}");

    // At most 512 files.
    let (_dir, root) = style_workspace(GOOD_SKILL);
    for index in 0..512 {
        write(
            &root,
            &format!("plugins/style/skills/style-guide/refs/{index}.md"),
            "x",
        );
    }
    let error = seal(&root, |b| b).err().unwrap();
    assert_eq!(error.code(), "SKILL_INVALID", "{error}");
    assert!(error.message().contains("513 files"), "{error}");
}

#[test]
fn a_skill_name_starts_with_the_plugin_id() {
    let (_dir, root) = style_workspace(GOOD_SKILL);
    write(
        &root,
        "plugins/style/umbel-plugin.toml",
        &std::fs::read_to_string(root.join("plugins/style/umbel-plugin.toml"))
            .unwrap()
            .replace("name = \"style-guide\"", "name = \"other-guide\""),
    );
    let error = seal(&root, |b| b).err().unwrap();
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID", "{error}");
    assert!(error.message().contains("skills[0].name"), "{error}");
}

#[tokio::test]
async fn an_optional_instance_with_a_bad_skill_is_skipped_and_serves_none() {
    let dir = support::workspace(&config(&[("style", "required = false"), ("raw", "")], ""));
    style_plugin(dir.path(), "style", "# no frontmatter\n");
    let host = seal(dir.path(), |b| b.with_compiled(echo("raw"))).unwrap();
    let list = data(&call(&host, agent("a"), "plugin-list", json!({})).await);
    assert_eq!(list["plugins"][0]["status"], "failed");
    assert_eq!(list["plugins"][0]["error"]["code"], "SKILL_INVALID");
    let skills = data(&call(&host, agent("a"), "skill-list", json!({})).await);
    assert_eq!(skills["skills"], json!([]));
    // No skill, no extension.
    let discover = Http::new(&host).modern("server/discover", json!({})).await;
    assert!(
        discover["result"]["capabilities"]["extensions"]
            .get(SKILL_EXTENSION)
            .is_none()
    );
    let mut client = Client::connect(&host, support::mcp::Transport::Stdio, Era::Modern).await;
    assert_eq!(
        error_code(&client.request("skills/list", json!({})).await),
        -32601
    );
    let resources = client.request("resources/list", json!({})).await;
    assert_eq!(resources["result"]["resources"], json!([]));
}

#[tokio::test]
async fn a_skill_is_served_once_per_plugin_and_a_name_cannot_have_two_contents() {
    // Two instances of one pack plugin from one directory: one copy of the skill.
    let dir = support::workspace(&config(
        &[
            ("a", "source = \"plugins/style\""),
            ("b", "source = \"plugins/style\""),
        ],
        "",
    ));
    style_plugin(dir.path(), "style", GOOD_SKILL);
    let host = seal(dir.path(), |b| b).unwrap();
    let skills = data(&call(&host, agent("x"), "skill-list", json!({})).await);
    assert_eq!(skills["skills"].as_array().unwrap().len(), 1);
    assert_eq!(skills["skills"][0]["instance"], "a");
    let list = data(&call(&host, agent("x"), "plugin-list", json!({})).await);
    assert_eq!(list["plugins"].as_array().unwrap().len(), 2);

    // The same plugin id from two directories with other content: a conflict naming both.
    let dir = support::workspace(&config(
        &[
            ("a", "source = \"plugins/one\""),
            ("b", "source = \"plugins/two\""),
        ],
        "",
    ));
    style_plugin(dir.path(), "one", GOOD_SKILL);
    style_plugin(
        dir.path(),
        "two",
        "---\nname: style-guide\ndescription: Another text.\n---\n",
    );
    let error = seal(dir.path(), |b| b).err().unwrap();
    assert_eq!(error.code(), "PLUGIN_CONFLICT", "{error}");
    for owner in ["instance `a`", "instance `b`", "style-guide"] {
        assert!(error.message().contains(owner), "{error}");
    }
}

// ── The three paths ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn skills_are_served_by_the_extension_and_as_resources_in_both_eras() {
    let host = TestHost::compiled(hello()).boot().unwrap();
    let files = hello_files();
    for mut client in Client::lanes(host.host()).await {
        let lane = client.label();
        let modern = client.era == Era::Modern;

        let listed = client.request("skills/list", json!({})).await;
        let skills = listed["result"]["skills"].as_array().unwrap();
        assert_eq!(skills.len(), 1, "{lane}");
        let entry = &skills[0];
        assert_eq!(entry["uri"], "skill://hello-guide/SKILL.md", "{lane}");
        assert_eq!(entry["frontmatter"]["name"], "hello-guide", "{lane}");
        assert_eq!(
            entry["frontmatter"]["description"],
            "When to call hello-greet, and how a space's greetings pack changes the salutation.",
            "{lane}"
        );
        // The manifest holds every file with its digest and size, SKILL.md first.
        let manifest = entry["resources"].as_array().unwrap();
        assert_eq!(manifest.len(), files.len(), "{lane}");
        for (item, (name, bytes)) in manifest.iter().zip(&files) {
            assert_eq!(item["uri"], format!("skill://hello-guide/{name}"), "{lane}");
            assert_eq!(item["digest"], sha256(bytes), "{lane}");
            assert_eq!(item["size"], bytes.len(), "{lane}");
        }
        if modern {
            assert_eq!(listed["result"]["cacheScope"], "public", "{lane}");
            assert!(listed["result"]["ttlMs"].is_number(), "{lane}");
        }

        // `skills/get` answers by the entry's URI.
        let got = client
            .request(
                "skills/get",
                json!({ "uri": "skill://hello-guide/SKILL.md" }),
            )
            .await;
        assert_eq!(got["result"]["skill"], *entry, "{lane}");

        // Every file is a resource, with its size and AFD's digest key; `ttlMs` and `cacheScope`
        // are on the result, not on each resource.
        let resources = client.request("resources/list", json!({})).await;
        let listed_files = resources["result"]["resources"].as_array().unwrap();
        assert_eq!(listed_files.len(), files.len(), "{lane}");
        for (resource, (name, bytes)) in listed_files.iter().zip(&files) {
            assert_eq!(
                resource["uri"],
                format!("skill://hello-guide/{name}"),
                "{lane}"
            );
            assert_eq!(resource["mimeType"], "text/markdown", "{lane}");
            assert_eq!(resource["size"], bytes.len(), "{lane}");
            assert_eq!(resource["_meta"]["dev.afd/digest"], sha256(bytes), "{lane}");
            assert!(resource.get("ttlMs").is_none() && resource.get("cacheScope").is_none());
        }
        if modern {
            assert_eq!(resources["result"]["cacheScope"], "public", "{lane}");
            assert!(resources["result"]["ttlMs"].is_number(), "{lane}");
        }

        // The bytes served are the plugin's.
        for (name, bytes) in &files {
            let read = client
                .request(
                    "resources/read",
                    json!({ "uri": format!("skill://hello-guide/{name}") }),
                )
                .await;
            let content = &read["result"]["contents"][0];
            assert_eq!(
                content["uri"],
                format!("skill://hello-guide/{name}"),
                "{lane}"
            );
            assert_eq!(
                content["text"].as_str().unwrap().as_bytes(),
                bytes.as_slice(),
                "{lane}"
            );
        }

        // An unknown URI is -32602 on both eras, for a skill, a file and a resource.
        for (method, uri) in [
            ("skills/get", "skill://hello-guide/SKILL.md/x"),
            ("skills/get", "skill://nobody/SKILL.md"),
            ("skills/get", "skill://hello-guide/references/override.md"),
            ("resources/read", "skill://hello-guide/nope.md"),
        ] {
            let response = client.request(method, json!({ "uri": uri })).await;
            assert_eq!(error_code(&response), -32602, "{lane} {method} {uri}");
        }
    }
}

#[tokio::test]
async fn the_server_declares_the_extension_when_a_plugin_ships_a_skill() {
    let host = TestHost::compiled(hello()).boot().unwrap();
    let http = Http::new(host.host());
    let discover = http.modern("server/discover", json!({})).await;
    let capabilities = &discover["result"]["capabilities"];
    assert!(capabilities["resources"].is_object(), "{capabilities}");
    assert!(
        capabilities["extensions"][SKILL_EXTENSION].is_object(),
        "{capabilities}"
    );

    let initialize = http
        .post(
            &json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25", "capabilities": {},
                    "clientInfo": { "name": "legacy", "version": "0" },
                },
            }),
            &[],
        )
        .await
        .json();
    let capabilities = &initialize["result"]["capabilities"];
    assert!(capabilities["resources"].is_object(), "{capabilities}");
    assert!(
        capabilities["extensions"][SKILL_EXTENSION].is_object(),
        "{capabilities}"
    );
}

#[tokio::test]
async fn a_host_with_no_skill_declares_neither_resources_nor_the_extension() {
    let dir = support::workspace(&config(&[("raw", "")], ""));
    let host = seal(dir.path(), |b| b.with_compiled(echo("raw"))).unwrap();
    let discover = Http::new(&host).modern("server/discover", json!({})).await;
    let capabilities = &discover["result"]["capabilities"];
    assert!(capabilities.get("resources").is_none(), "{capabilities}");
    assert!(
        capabilities
            .get("extensions")
            .is_none_or(|extensions| extensions.get(SKILL_EXTENSION).is_none()),
        "{capabilities}"
    );
}

#[tokio::test]
async fn skills_from_two_plugins_are_listed_in_enabled_order() {
    let dir = support::workspace(&config(&[("style", ""), ("hello", "")], ""));
    style_plugin(dir.path(), "style", GOOD_SKILL);
    let host = seal(dir.path(), |b| b.with_compiled(hello())).unwrap();
    let mut client = Client::connect(&host, support::mcp::Transport::Stdio, Era::Modern).await;
    let listed = client.request("skills/list", json!({})).await;
    let names: Vec<_> = listed["result"]["skills"]
        .as_array()
        .unwrap()
        .iter()
        .map(|skill| skill["frontmatter"]["name"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(names, ["style-guide", "hello-guide"]);
    let skills = data(&call(&host, agent("a"), "skill-list", json!({})).await);
    let instances: Vec<_> = skills["skills"]
        .as_array()
        .unwrap()
        .iter()
        .map(|skill| skill["instance"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(instances, ["style", "hello"]);
}

// ── skill-list ─────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn skill_list_reports_name_description_instance_uri_digest_and_file_count() {
    let host = TestHost::compiled(hello()).boot().unwrap();
    let listed = data(&host.call("skill-list", json!({})).await);
    let files = hello_files();
    assert_eq!(
        listed["skills"],
        json!([{
            "name": "hello-guide",
            "description": "When to call hello-greet, and how a space's greetings pack changes the salutation.",
            "instance": "hello",
            "plugin": "hello",
            "version": "0.1.0",
            "uri": "skill://hello-guide/SKILL.md",
            "digest": sha256(&files[0].1),
            "files": 2,
        }])
    );

    // The same through MCP (read-only, exposed everywhere) and the CLI.
    let mut client = host.mcp(Era::Modern).await;
    let through_mcp = client.afd_call("skill-list", json!({})).await;
    assert_eq!(through_mcp["data"], listed);
    let cli = host.cli(&["skill", "list"]).await;
    assert_eq!(cli.code, 0, "{}", cli.stdout);
    assert_eq!(cli.json()["data"], listed);
}

// ── skill-export ───────────────────────────────────────────────────────────────────────────────

fn read(path: &Path) -> Vec<u8> {
    std::fs::read(path).unwrap()
}

#[tokio::test]
async fn skill_export_writes_the_files_and_an_origin_file() {
    let host = TestHost::compiled(hello()).boot().unwrap();
    let out = tempfile::tempdir().unwrap();
    let dir = out.path().join("harness");
    let result = host
        .call("skill-export", json!({ "dir": dir.to_str().unwrap() }))
        .await;
    let exported = data(&result);
    assert_eq!(exported["skills"][0]["name"], "hello-guide");
    assert_eq!(exported["skills"][0]["unchanged"], 0);
    assert_eq!(
        exported["skills"][0]["written"].as_array().unwrap().len(),
        3
    );

    let files = hello_files();
    let skill = dir.join("hello-guide");
    for (name, bytes) in &files {
        assert_eq!(&read(&skill.join(name)), bytes, "{name}");
    }
    let origin: Value = serde_json::from_slice(&read(&skill.join(".umbel-origin.json"))).unwrap();
    assert_eq!(origin["skill"], "hello-guide");
    assert_eq!(origin["instance"], "hello");
    assert_eq!(origin["plugin"], "hello");
    assert_eq!(origin["version"], "0.1.0");
    assert_eq!(origin["uri"], "skill://hello-guide/SKILL.md");
    assert_eq!(
        origin["files"],
        json!([
            { "path": "SKILL.md", "digest": sha256(&files[0].1), "size": files[0].1.len() },
            { "path": "references/override.md", "digest": sha256(&files[1].1), "size": files[1].1.len() },
        ])
    );

    // A second export of the same skills changes nothing.
    let again = data(
        &host
            .call("skill-export", json!({ "dir": dir.to_str().unwrap() }))
            .await,
    );
    assert_eq!(again["skills"][0]["written"], json!([]));
    assert_eq!(again["skills"][0]["unchanged"], 3);

    // The export is a mutation but never an event.
    let events = data(&host.call("event-list", json!({})).await);
    assert_eq!(events["events"], json!([]));
}

#[tokio::test]
async fn skill_export_refuses_to_overwrite_a_file_that_differs_unless_forced() {
    let host = TestHost::compiled(hello()).boot().unwrap();
    let out = tempfile::tempdir().unwrap();
    let dir = out.path().to_str().unwrap().to_owned();
    data(&host.call("skill-export", json!({ "dir": dir })).await);
    let skill = out.path().join("hello-guide");
    let original = read(&skill.join("SKILL.md"));
    std::fs::write(skill.join("SKILL.md"), "edited by hand\n").unwrap();
    std::fs::remove_file(skill.join("references/override.md")).unwrap();

    let refused = host.call("skill-export", json!({ "dir": dir })).await;
    assert!(!refused.success);
    let error = refused.error.unwrap();
    assert_eq!(error.code, "ALREADY_EXISTS");
    assert!(error.suggestion.unwrap().contains("force=true"));
    let differs = error.details.unwrap()["differs"].clone();
    assert_eq!(differs.as_array().unwrap().len(), 1);
    assert!(differs[0].as_str().unwrap().ends_with("SKILL.md"));
    // Nothing was written: the edit stays and the removed file is still gone.
    assert_eq!(read(&skill.join("SKILL.md")), b"edited by hand\n");
    assert!(!skill.join("references/override.md").exists());

    let forced = data(
        &host
            .call("skill-export", json!({ "dir": dir, "force": true }))
            .await,
    );
    assert_eq!(forced["skills"][0]["written"].as_array().unwrap().len(), 2);
    assert_eq!(read(&skill.join("SKILL.md")), original);
    assert!(skill.join("references/override.md").exists());
}

#[tokio::test]
async fn skill_export_takes_one_skill_by_name_and_names_the_choices_for_an_unknown_one() {
    let host = TestHost::compiled(hello()).boot().unwrap();
    let out = tempfile::tempdir().unwrap();
    let dir = out.path().to_str().unwrap().to_owned();
    let one = data(
        &host
            .call(
                "skill-export",
                json!({ "dir": dir, "skill": "hello-guide" }),
            )
            .await,
    );
    assert_eq!(one["skills"].as_array().unwrap().len(), 1);

    let missing = host
        .call("skill-export", json!({ "dir": dir, "skill": "nobody" }))
        .await;
    assert!(!missing.success);
    let error = missing.error.unwrap();
    assert_eq!(error.code, "NOT_FOUND");
    assert!(error.suggestion.unwrap().contains("hello-guide"));

    let no_dir = host.call("skill-export", json!({})).await;
    assert!(!no_dir.success);
}

#[cfg(unix)]
#[tokio::test]
async fn skill_export_does_not_write_through_a_symbolic_link() {
    let host = TestHost::compiled(hello()).boot().unwrap();
    let out = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(elsewhere.path(), out.path().join("hello-guide")).unwrap();
    let refused = host
        .call(
            "skill-export",
            json!({ "dir": out.path().to_str().unwrap() }),
        )
        .await;
    assert!(!refused.success);
    assert_eq!(refused.error.unwrap().code, "VALIDATION_ERROR");
    assert_eq!(std::fs::read_dir(elsewhere.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn skill_export_is_a_cli_command_and_not_an_mcp_tool() {
    let host = TestHost::compiled(hello()).boot().unwrap();
    let out = tempfile::tempdir().unwrap();
    let dir = format!("dir={}", out.path().display());
    let run = host.cli(&["skill", "export", &dir]).await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    assert_eq!(run.json()["data"]["skills"][0]["name"], "hello-guide");
    assert!(out.path().join("hello-guide/SKILL.md").exists());

    // Not exposed to MCP or agents: the meta-tool does not reach it.
    let mut client = host.mcp(Era::Modern).await;
    let through_mcp = client
        .afd_call(
            "skill-export",
            json!({ "dir": out.path().to_str().unwrap() }),
        )
        .await;
    assert_eq!(through_mcp["success"], false, "{through_mcp}");
    let found = client.afd_call("afd-help", json!({})).await.to_string();
    assert!(!found.contains("skill-export"), "{found}");
    assert!(found.contains("skill-list"), "{found}");
}

// ── The origin `_meta` ─────────────────────────────────────────────────────────────────────────

fn origin() -> Value {
    json!({
        "plugin": "hello",
        "kind": "compiled",
        "version": "0.1.0",
        "effects": ["inspect"],
    })
}

#[tokio::test]
async fn a_plugin_tool_carries_its_origin_in_meta_on_every_lane() {
    let dir = support::workspace(&config(
        &[("hello", "")],
        "[mcp]\nfirst_class_tools = [\"workspace-show\", \"hello-greet\"]\n",
    ));
    let host = seal(dir.path(), |b| b.with_compiled(hello())).unwrap();
    for mut client in Client::lanes(&host).await {
        let lane = client.label();
        let tools = client.request("tools/list", json!({})).await;
        let tools = tools["result"]["tools"].as_array().unwrap().clone();
        let greet = tools.iter().find(|t| t["name"] == "hello-greet").unwrap();
        assert_eq!(greet["_meta"]["dev.umbel/origin"], origin(), "{lane}");
        // A host command has none.
        let show = tools
            .iter()
            .find(|t| t["name"] == "workspace-show")
            .unwrap();
        assert!(
            show.get("_meta")
                .is_none_or(|meta| meta.get("dev.umbel/origin").is_none()),
            "{lane}"
        );

        // `afd-detail` reports it for any command.
        let response = client
            .call(
                "afd-detail",
                json!({ "command": ["hello-greet", "plugin-list"] }),
            )
            .await;
        assert_eq!(
            response["data"][0]["toolMeta"],
            json!({ "dev.umbel/origin": origin() }),
            "{lane}"
        );
        assert!(response["data"][1].get("toolMeta").is_none(), "{lane}");
    }
}

#[tokio::test]
async fn the_hosts_origin_replaces_one_a_finished_definition_brings() {
    let manifest = echo_manifest("raw", "");
    let plugin = Raw::new(manifest, |_| {
        let definition = afd::CommandDefinition::new(
            "raw-echo",
            "Answer the input.",
            vec![],
            support::plugins::Closure(Box::new(|input, _| afd::success(input))),
        )
        .with_tool_meta("dev.umbel/origin", json!({ "plugin": "forged" }))
        .with_tool_meta("dev.example/note", json!("kept"));
        let schema = json!({
            "type": "object",
            "properties": { "text": { "type": "string" } },
            "additionalProperties": false,
        });
        Ok(vec![PluginCommand::definition(definition, schema)])
    });
    let dir = support::workspace(&config(&[("raw", "")], ""));
    let host = seal(dir.path(), |b| b.with_compiled(plugin)).unwrap();
    let tool = host.registry().get_tool("raw-echo").unwrap();
    assert_eq!(
        tool["_meta"]["dev.umbel/origin"],
        json!({ "plugin": "raw", "kind": "compiled", "version": "1.2.3", "effects": ["inspect"] })
    );
    assert_eq!(tool["_meta"]["dev.example/note"], "kept");
}
