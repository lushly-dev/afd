//! Step C3's surfaces: the plugin and a space's override as `plugin-show` and the doctor show them
//! today, which this plugin does not change (D151: no host code); the first-class suggestion in
//! `tools/list`; and the `components-guide` skill on the three delivery paths of the phase 1
//! specification, section 8.3, as `tests/skills.rs` proves them for hello: the Skills extension,
//! resources, and `skill-list` with `skill-export`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::Path;

use serde_json::{Value, json};
use support::*;
use umbel::testkit::TestHost;
use umbel::testkit::mcp::Client;

const SKILL_URI: &str = "skill://components-guide/SKILL.md";

fn value(result: afd::CommandResult<Value>) -> Value {
    serde_json::to_value(result).unwrap()
}

fn skill_md() -> Vec<u8> {
    std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("skills/components-guide/SKILL.md"))
        .unwrap()
}

fn sha256(bytes: &[u8]) -> String {
    digest::file_digest(bytes)
}

fn frontmatter_description() -> String {
    let text = String::from_utf8(skill_md()).unwrap();
    text.lines()
        .find_map(|line| line.strip_prefix("description: "))
        .unwrap()
        .to_owned()
}

async fn doctor(host: &TestHost) -> Vec<Value> {
    let report = value(host.call("workspace-doctor", json!({})).await);
    assert_eq!(report["data"]["healthy"], true, "{report}");
    report["data"]["checks"].as_array().unwrap().clone()
}

fn check<'a>(checks: &'a [Value], id: &str) -> &'a Value {
    checks
        .iter()
        .find(|check| check["id"] == id)
        .unwrap_or_else(|| panic!("no check {id}"))
}

// ── plugin-show and the doctor ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn plugin_show_reports_the_plugin_and_the_default_pack_in_every_space() {
    let host = default_host();
    let shown = value(
        host.call("plugin-show", json!({ "plugin": "components" }))
            .await,
    );
    let shown = data(&shown);
    assert_eq!(shown["instance"]["source"], "compiled:components");
    assert_eq!(shown["instance"]["kind"], "compiled");
    assert_eq!(shown["instance"]["status"], "loaded");
    assert_eq!(shown["instance"]["spaces"], json!(["main", "beta"]));
    assert_eq!(shown["grants"]["trust"], "trusted, not sandboxed");
    let grants: Vec<_> = shown["grants"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|grant| {
            (
                grant["name"].as_str().unwrap(),
                grant["status"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        grants,
        [
            ("config", "granted"),
            ("packs", "granted"),
            ("log", "granted")
        ]
    );
    let commands: Vec<_> = shown["commands"]
        .as_array()
        .unwrap()
        .iter()
        .map(|command| {
            assert_eq!(command["effects"], json!(["inspect"]), "{command}");
            assert_eq!(command["mutation"], false, "{command}");
            (
                command["name"].as_str().unwrap(),
                command["firstClass"].as_bool().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        commands,
        [
            ("components-brief", true),
            ("components-list", false),
            ("components-open", false),
        ]
    );
    // The default pack carries its own version from its pack.toml, in both spaces.
    assert_eq!(
        shown["packs"],
        json!([{
            "id": "library",
            "path": "packs/library",
            "spaces": [
                { "space": "main", "source": "default", "version": "0.1.0", "files": 7 },
                { "space": "beta", "source": "default", "version": "0.1.0", "files": 7 },
            ],
        }])
    );
    assert_eq!(
        shown["skills"],
        json!([{ "name": "components-guide", "path": "skills/components-guide" }])
    );
    assert_eq!(shown["contexts"], json!([]));
    assert_eq!(shown["pipelines"], json!([]));
}

#[tokio::test]
async fn plugin_show_reports_an_override_in_its_space_alone() {
    let mut pack = Pack::example();
    pack.add_synthetic("own", 2);
    let fx = pack.host();
    let shown = value(
        fx.host
            .call("plugin-show", json!({ "plugin": "components" }))
            .await,
    );
    // The override's version is the deployer's pack.toml's; its file count includes it.
    assert_eq!(
        data(&shown)["packs"][0]["spaces"],
        json!([
            { "space": "main", "source": "override", "version": "1.0.0", "files": 11 },
            { "space": "beta", "source": "default", "version": "0.1.0", "files": 7 },
        ])
    );
}

#[tokio::test]
async fn the_doctor_passes_the_plugin_and_counts_only_the_override_as_a_pack_directory() {
    let checks = doctor(&default_host()).await;
    // A compiled plugin's default pack is embedded, so the doctor has no directory to check.
    assert_eq!(
        check(&checks, "plugins.packs")["message"],
        "0 pack directory(ies) and override(s) validate"
    );
    let fx = {
        let mut pack = Pack::example();
        pack.add_synthetic("own", 2);
        pack.host()
    };
    let checks = doctor(&fx.host).await;
    for (id, message) in [
        ("plugins.config", "1 plugin instance(s): components"),
        (
            "plugins.grants",
            "3 declared grant(s) are in the catalog and allowed for their kind",
        ),
        (
            "plugins.packs",
            "1 pack directory(ies) and override(s) validate",
        ),
        (
            "plugins.skills",
            "1 skill(s) validate and no name is shared",
        ),
        (
            "plugins.loaded",
            "1 instance(s) loaded: components (compiled, 3 command(s)); compiled instance(s) \
             components are trusted, not sandboxed: grants are a declaration, not a sandbox",
        ),
        (
            "plugins.first_class",
            "1 plugin suggestion(s) fit the first-class set (workspace-show, event-list, \
             components-brief)",
        ),
        (
            "mcp.surface",
            "the first-class set (workspace-show, event-list, components-brief) validates \
             against the registry",
        ),
    ] {
        let found = check(&checks, id);
        assert_eq!(found["status"], "pass", "{found}");
        assert_eq!(found["message"], message, "{found}");
    }
}

/// The host checks an override's layout, never the pack format: an override whose library fails
/// the plugin's check still shows and passes the doctor, and the plugin refuses the call (D151,
/// section 9.1).
#[tokio::test]
async fn an_override_the_plugin_refuses_still_shows_and_passes_the_doctor() {
    let mut pack = Pack::example();
    pack.set_raw(&record_path("select"), "{}");
    let fx = pack.host();
    let shown = value(
        fx.host
            .call("plugin-show", json!({ "plugin": "components" }))
            .await,
    );
    assert_eq!(data(&shown)["packs"][0]["spaces"][0]["source"], "override");
    let checks = doctor(&fx.host).await;
    assert_eq!(check(&checks, "plugins.packs")["status"], "pass");
    let listed = fx.list(json!({ "space": "main" })).await;
    assert_eq!(code(&listed), "PACK_INVALID");
    // The other space keeps the default pack, and is served.
    let other = fx.list(json!({ "space": "beta" })).await;
    assert_eq!(data(&other)["libraries"][0]["library"], "example");
}

// ── The first-class suggestion ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn components_brief_is_the_one_first_class_suggestion_on_every_lane() {
    let host = default_host();
    assert_eq!(
        host.host().first_class_tools(),
        ["workspace-show", "event-list", "components-brief"]
    );
    for mut client in Client::lanes(host.host()).await {
        let lane = client.label();
        let listed = client.tool_names().await;
        assert!(listed.contains(&"components-brief".to_owned()), "{lane}");
        for (name, input) in [
            ("components-list", json!({})),
            ("components-open", json!({ "tag": "example-select" })),
        ] {
            assert!(!listed.contains(&name.to_owned()), "{lane}: {listed:?}");
            // Not listed, and still callable by name (H7).
            let result = client.call(name, input).await;
            assert_eq!(result["success"], true, "{lane} {name}: {result}");
        }
        let result = client
            .call("components-brief", json!({ "tags": ["example-select"] }))
            .await;
        assert_eq!(result["success"], true, "{lane}: {result}");
    }
}

// ── The skill on three paths ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_skill_is_served_by_the_extension_and_as_a_resource_in_both_eras() {
    let host = default_host();
    let bytes = skill_md();
    let description = frontmatter_description();
    // Both eras on both transports.
    for mut client in Client::lanes(host.host()).await {
        let lane = client.label();

        // 1. The Skills extension.
        let listed = client.request("skills/list", json!({})).await;
        let skills = listed["result"]["skills"].as_array().unwrap();
        assert_eq!(skills.len(), 1, "{lane}");
        let entry = &skills[0];
        assert_eq!(entry["uri"], SKILL_URI, "{lane}");
        assert_eq!(entry["frontmatter"]["name"], "components-guide", "{lane}");
        assert_eq!(entry["frontmatter"]["description"], description, "{lane}");
        assert_eq!(
            entry["resources"],
            json!([{ "uri": SKILL_URI, "digest": sha256(&bytes), "size": bytes.len() }]),
            "{lane}"
        );
        let got = client
            .request("skills/get", json!({ "uri": SKILL_URI }))
            .await;
        assert_eq!(got["result"]["skill"], *entry, "{lane}");

        // 2. Resources: the same bytes.
        let resources = client.request("resources/list", json!({})).await;
        let listed_files = resources["result"]["resources"].as_array().unwrap();
        assert_eq!(listed_files.len(), 1, "{lane}");
        assert_eq!(listed_files[0]["uri"], SKILL_URI, "{lane}");
        assert_eq!(listed_files[0]["mimeType"], "text/markdown", "{lane}");
        assert_eq!(
            listed_files[0]["_meta"]["dev.afd/digest"],
            sha256(&bytes),
            "{lane}"
        );
        let read = client
            .request("resources/read", json!({ "uri": SKILL_URI }))
            .await;
        assert_eq!(
            read["result"]["contents"][0]["text"]
                .as_str()
                .unwrap()
                .as_bytes(),
            bytes.as_slice(),
            "{lane}"
        );
    }
}

#[tokio::test]
async fn skill_list_and_skill_export_deliver_the_skill() {
    let host = default_host();
    let bytes = skill_md();

    // 3. The commands `skill-list` and `skill-export` (CLI only), called in process: the export
    // writes the skill into a harness's directory.
    let listed = value(host.call("skill-list", json!({})).await);
    assert_eq!(
        data(&listed)["skills"],
        json!([{
            "name": "components-guide",
            "description": frontmatter_description(),
            "instance": "components",
            "plugin": "components",
            "version": "0.1.0",
            "uri": SKILL_URI,
            "digest": sha256(&bytes),
            "files": 1,
        }])
    );

    let out = tempfile::tempdir().unwrap();
    let exported = value(
        host.call(
            "skill-export",
            json!({ "dir": out.path().to_str().unwrap() }),
        )
        .await,
    );
    assert_eq!(data(&exported)["skills"][0]["name"], "components-guide");
    let skill = out.path().join("components-guide");
    assert_eq!(std::fs::read(skill.join("SKILL.md")).unwrap(), bytes);
    let origin: Value =
        serde_json::from_slice(&std::fs::read(skill.join(".umbel-origin.json")).unwrap()).unwrap();
    assert_eq!(origin["skill"], "components-guide");
    assert_eq!(origin["plugin"], "components");
    assert_eq!(origin["uri"], SKILL_URI);
}

#[test]
fn the_skill_stays_under_sixty_lines_and_names_only_commands_that_exist() {
    let text = String::from_utf8(skill_md()).unwrap();
    assert!(text.lines().count() < 60, "section 12.1: under 60 lines");
    let manifest = include_str!("../umbel-plugin.toml");
    for word in text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '-')) {
        if word.starts_with("components-") && word != "components-guide" {
            assert!(
                manifest.contains(&format!("name = \"{word}\"")),
                "the skill names `{word}`, which the manifest does not declare"
            );
        }
    }
}
