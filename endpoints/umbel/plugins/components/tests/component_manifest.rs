//! The component build's manifest (Component Briefs step D2) is the compiled manifest with four
//! differences: `kind = "component"`, the `[component]` table naming the `.wasm` file, the grants
//! `clock` and `random` that the build imports (D198), and no command
//! `journal`, which a component may not declare (D191) and the deployer sets instead (D195 to
//! D197). Anything else that drifts between the two builds fails here.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;

use toml::{Table, Value};

fn manifest(path: &str) -> Table {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(path);
    std::fs::read_to_string(&path).unwrap().parse().unwrap()
}

#[test]
fn the_component_manifest_is_the_compiled_one_but_for_kind_path_grants_and_journal() {
    let mut compiled = manifest("umbel-plugin.toml");
    let mut component = manifest("manifests/component.toml");

    let plugin = |table: &mut Table| table["plugin"].as_table_mut().unwrap().remove("kind");
    assert_eq!(plugin(&mut compiled), Some(Value::from("compiled")));
    assert_eq!(plugin(&mut component), Some(Value::from("component")));

    let path = component.remove("component").unwrap();
    assert_eq!(path["path"].as_str(), Some("components.wasm"));
    assert!(path.as_table().unwrap().len() == 1, "{path}");

    let grants = component["grants"].as_array_mut().unwrap();
    let added: Vec<Value> = grants
        .extract_if(.., |grant| {
            matches!(grant["name"].as_str(), Some("clock" | "random"))
        })
        .collect();
    assert_eq!(added.len(), 2, "{added:?}");

    let commands = compiled["commands"].as_array_mut().unwrap();
    for command in commands.iter_mut() {
        let name = command["name"].as_str().unwrap().to_owned();
        let journal = command.as_table_mut().unwrap().remove("journal");
        assert_eq!(
            journal.and_then(|journal| journal.get("mode").cloned()),
            Some(Value::from("digest")),
            "{name}: the compiled build journals every command as digest"
        );
    }
    for command in component["commands"].as_array().unwrap() {
        assert!(
            command.get("journal").is_none(),
            "a component command may not declare journal (D191): {command}"
        );
    }

    assert_eq!(compiled, component);
}

#[test]
fn the_component_holds_the_compiled_grants_and_what_its_standard_library_imports() {
    let grants = |table: &Table| -> Vec<String> {
        table["grants"]
            .as_array()
            .unwrap()
            .iter()
            .map(|grant| grant["name"].as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(
        grants(&manifest("umbel-plugin.toml")),
        ["config", "packs", "log"]
    );
    // No store, no network, no write: `clock` and `random` are imports no command reads (D198).
    assert_eq!(
        grants(&manifest("manifests/component.toml")),
        ["config", "packs", "clock", "random", "log"]
    );
}
