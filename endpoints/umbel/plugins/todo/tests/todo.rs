//! The todo plugin through the test kit (phase 1 specification, sections 10.5 and 13): the eleven
//! commands are registered as the plugin's, the manifest equals the backend's definitions, and
//! each command answers one call.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;
use std::sync::Arc;

use serde_json::{Value, json};
use umbel::testkit::TestHost;
use umbel_plugin_todo::{MANIFEST, plugin};

const NAMES: [&str; 11] = [
    "todo-create",
    "todo-list",
    "todo-get",
    "todo-update",
    "todo-toggle",
    "todo-delete",
    "todo-clear",
    "todo-stats",
    "todo-create-batch",
    "todo-delete-batch",
    "todo-toggle-batch",
];

fn manifest() -> toml::Table {
    MANIFEST.parse().unwrap()
}

fn host() -> TestHost {
    TestHost::compiled(plugin()).boot().unwrap()
}

#[tokio::test]
async fn the_eleven_commands_are_the_todo_plugins_with_clears_confirmation_prompt() {
    let host = host();
    let registry = host.host().registry();
    for name in NAMES {
        let command = registry
            .get(name)
            .unwrap_or_else(|| panic!("{name} missing"));
        let origin = &command.tool_meta.as_ref().unwrap()["dev.umbel/origin"];
        assert_eq!(origin["plugin"], "todo", "{name}");
        assert_eq!(origin["kind"], "compiled", "{name}");
    }
    let clear = registry.get("todo-clear").unwrap();
    assert_eq!(
        clear.confirm_prompt.as_deref(),
        Some("Delete these todos? This cannot be undone.")
    );
    assert_eq!(clear.destructive, Some(true));
    assert!(
        NAMES
            .iter()
            .filter(|name| **name != "todo-clear")
            .all(|name| registry.get(name).unwrap().confirm_prompt.is_none())
    );

    let shown = host.call("plugin-show", json!({"plugin": "todo"})).await;
    let shown = shown.data.unwrap();
    assert_eq!(shown["instance"]["status"], "loaded");
    assert_eq!(shown["grants"]["items"], json!([]), "no grants");
    assert_eq!(shown["commands"].as_array().unwrap().len(), 11);
}

#[test]
fn the_manifests_schemas_and_effects_equal_the_backends_definitions() {
    let manifest = manifest();
    let commands = manifest["commands"].as_array().unwrap();
    let backend = todo_backend_rust::commands(Arc::new(todo_backend_rust::TodoStore::new()));
    assert_eq!(commands.len(), backend.len());
    for (declared, (definition, schema)) in commands.iter().zip(&backend) {
        let name = definition.name.as_str();
        assert_eq!(declared["name"].as_str(), Some(name));
        assert_eq!(
            declared["description"].as_str(),
            Some(definition.description.as_str()),
            "{name}"
        );
        // The schema file is the backend's schema, exactly.
        let path = declared["input_schema"].as_str().unwrap();
        let file = Path::new(env!("CARGO_MANIFEST_DIR")).join(path);
        let on_disk: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        assert_eq!(
            &on_disk, schema,
            "{name}: regenerate {path} from the backend"
        );
        let effects: Vec<&str> = declared["effects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|effect| effect.as_str().unwrap())
            .collect();
        let expected = if definition.mutation {
            ["plugin-state"]
        } else {
            ["inspect"]
        };
        assert_eq!(effects, expected, "{name}");
        assert_eq!(
            declared
                .get("confirm_prompt")
                .and_then(|prompt| prompt.as_str()),
            definition.confirm_prompt.as_deref(),
            "{name}"
        );
    }
    assert_eq!(
        manifest["plugin"]["domains"],
        toml::Value::Array(vec![toml::Value::from("todo")])
    );
    assert!(
        !manifest.contains_key("grants"),
        "the plugin declares no grants"
    );
}

#[tokio::test]
async fn each_command_answers_one_call() {
    let host = host();
    let created = host
        .call("todo-create", json!({"title": "Write docs"}))
        .await;
    assert!(created.success, "{created:?}");
    let id = created.data.unwrap()["id"].as_str().unwrap().to_owned();

    let calls = [
        ("todo-get", json!({"id": id})),
        ("todo-list", json!({})),
        ("todo-update", json!({"id": id, "title": "Write more docs"})),
        ("todo-toggle", json!({"id": id})),
        ("todo-stats", json!({})),
        (
            "todo-create-batch",
            json!({"todos": [{"title": "One"}, {"title": "Two"}]}),
        ),
        ("todo-toggle-batch", json!({"ids": [id], "completed": true})),
        ("todo-delete", json!({"id": id})),
        ("todo-clear", json!({"all": true, "confirm": true})),
    ];
    for (name, input) in calls {
        let result = host.call(name, input).await;
        assert!(result.success, "{name}: {result:?}");
    }
    let created = host.call("todo-create", json!({"title": "Last"})).await;
    let last = created.data.unwrap()["id"].as_str().unwrap().to_owned();
    let deleted = host.call("todo-delete-batch", json!({"ids": [last]})).await;
    assert!(deleted.success, "{deleted:?}");

    let stats = host.call("todo-stats", json!({})).await.data.unwrap();
    assert_eq!(stats["total"], 0, "{stats}");
}

#[tokio::test]
async fn a_bad_input_is_refused_with_the_backends_validation_error() {
    let host = host();
    let result = host.call("todo-create", json!({"title": ""})).await;
    assert!(!result.success);
    assert_eq!(result.error.unwrap().code, "VALIDATION_ERROR");
}

#[test]
fn the_mounted_fixture_declares_the_same_effects_and_prompt_as_the_compiled_manifest() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/plugins/todo-http/umbel-plugin.toml");
    let text = std::fs::read_to_string(&path).unwrap();
    umbel::plugins::Manifest::parse(&text, "todo-http").expect("the fixture is a valid manifest");
    let mounted: toml::Table = text.parse().unwrap();
    let compiled = manifest();
    // (name, effect, confirmation prompt) of every command, sorted.
    let declared = |entries: &toml::Value, key: &str| {
        let mut found: Vec<(String, String, Option<String>)> = entries
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| {
                (
                    entry[key].as_str().unwrap().to_owned(),
                    entry["effects"][0].as_str().unwrap().to_owned(),
                    entry
                        .get("confirm_prompt")
                        .and_then(toml::Value::as_str)
                        .map(str::to_owned),
                )
            })
            .collect();
        found.sort();
        found
    };
    assert_eq!(
        declared(&mounted["mount"]["tools"], "tool"),
        declared(&compiled["commands"], "name")
    );
}
