//! Packs built from Specimen's exported example, written as a space's override, and a host with
//! the plugin. The override sits in space `main`; `beta` keeps the default pack.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use afd::{Actor, ActorKind, CommandInterface};
use serde_json::{Value, json};
use tempfile::TempDir;
use umbel::plugins::sdk;
use umbel::testkit::TestHost;

#[path = "../../src/pack/canonical.rs"]
pub mod canonical;
#[path = "../../src/pack/digest.rs"]
pub mod digest;
pub mod logs;

/// Specimen's fixtures, from this crate.
pub fn specimen_fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../foundations/specimen/fixtures/pack")
}

pub const PACK_TOML: &str = r#"pack_version = 1
id = "library"
plugin = "components"
version = "1.0.0"
title = "Component libraries"
description = "Test libraries."
"#;

/// The files of a directory, by their `/`-separated path relative to it.
pub fn read_tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                let relative = path.strip_prefix(root).unwrap();
                let key = relative
                    .components()
                    .map(|part| part.as_os_str().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join("/");
                out.insert(key, std::fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    if root.exists() {
        walk(root, root, &mut out);
    }
    out
}

/// A pack's files, without the host's `pack.toml`.
#[derive(Debug, Clone, Default)]
pub struct Pack {
    pub files: BTreeMap<String, Vec<u8>>,
}

impl Pack {
    /// Specimen's exported example.
    pub fn example() -> Self {
        Self {
            files: read_tree(&specimen_fixtures().join("exported")),
        }
    }

    pub fn json(&self, path: &str) -> Value {
        serde_json::from_slice(&self.files[path]).unwrap()
    }

    pub fn set_json(&mut self, path: &str, value: &Value) {
        self.files.insert(
            path.to_owned(),
            canonical::canonical_json(value).into_bytes(),
        );
    }

    pub fn set_raw(&mut self, path: &str, text: &str) {
        self.files.insert(path.to_owned(), text.as_bytes().to_vec());
    }

    /// Edits a file's JSON and writes it canonically. Call [`Self::regenerate`] after.
    pub fn edit(&mut self, path: &str, change: impl FnOnce(&mut Value)) {
        let mut value = self.json(path);
        change(&mut value);
        self.set_json(path, &value);
    }

    /// Rewrites the library's catalog digests so the files agree with it.
    pub fn regenerate(&mut self, library: &str) {
        let catalog_path = format!("data/{library}/library.json");
        let rules_path = format!("rules/{library}.json");
        let prefix = format!("data/{library}/components/");
        let mut catalog = self.json(&catalog_path);
        catalog["rules"] = json!(digest::file_digest(&self.files[&rules_path]));
        for entry in catalog["components"].as_array_mut().unwrap() {
            let file = format!("{prefix}{}.json", entry["tag"].as_str().unwrap());
            if let Some(bytes) = self.files.get(&file) {
                entry["digest"] = json!(digest::file_digest(bytes));
            }
        }
        let digested = self
            .files
            .iter()
            .filter(|(path, _)| **path == rules_path || path.starts_with(&prefix))
            .map(|(path, bytes)| (path.as_str(), bytes.as_slice()));
        catalog["digest"] = json!(digest::pack_digest(digested));
        self.set_json(&catalog_path, &catalog);
    }

    /// A second library holding a copy of `example`'s files.
    pub fn copy_example_as(&mut self, library: &str) {
        let source = Self::example();
        for (path, bytes) in &source.files {
            let target = path
                .replace("data/example/", &format!("data/{library}/"))
                .replace("rules/example.json", &format!("rules/{library}.json"));
            self.files.insert(target, bytes.clone());
        }
        let library_id = library.to_owned();
        self.edit(&format!("rules/{library}.json"), |rules| {
            rules["library"] = json!(library_id);
        });
        let library_id = library.to_owned();
        self.edit(&format!("data/{library}/library.json"), |catalog| {
            catalog["library"] = json!(library_id);
        });
        self.regenerate(library);
    }

    /// A library of `count` minimal records, each with a padded summary.
    pub fn add_synthetic(&mut self, library: &str, count: usize) {
        let prefix = format!("{library}-");
        let mut components = Vec::new();
        for index in 0..count {
            let tag = format!("{prefix}item-{index:04}");
            let summary = format!("Item {index:04} does one small thing on a page.");
            let path = format!("data/{library}/components/{tag}.json");
            self.set_json(&path, &record(&tag, &summary));
            components.push(
                json!({ "tag": tag, "summary": summary, "status": "stable", "digest": "sha256:" }),
            );
        }
        self.set_json(
            &format!("rules/{library}.json"),
            &json!({ "format": 0, "library": library, "rules": [] }),
        );
        self.set_json(
            &format!("data/{library}/library.json"),
            &json!({
                "format": 0, "library": library, "title": "Synthetic",
                "package": { "name": "synthetic-components", "version": "1.0.0" },
                "prefix": prefix, "digest": "", "rules": "", "components": components,
            }),
        );
        self.regenerate(library);
    }

    /// A library of `count` records the size of FAST-AF's, sharing two rules.
    pub fn add_rich(&mut self, library: &str, count: usize) {
        let prefix = format!("{library}-");
        let rules = ["shared.focus", "shared.labelling"];
        let mut components = Vec::new();
        for index in 0..count {
            let tag = format!("{prefix}item-{index:04}");
            let record = rich_record(&tag, index, &rules);
            self.set_json(&format!("data/{library}/components/{tag}.json"), &record);
            components.push(json!({
                "tag": tag, "summary": record["summary"], "status": "stable", "digest": "sha256:",
            }));
        }
        self.set_json(
            &format!("rules/{library}.json"),
            &json!({ "format": 0, "library": library, "rules": [
                { "id": "shared.focus", "text": "Focus moves into the group in reading order and leaves it with Tab.",
                  "appliesTo": { "attributes": ["label"] }, "basis": "verified" },
                { "id": "shared.labelling", "text": "Every group needs a label attribute; a nearby heading does not name it.",
                  "appliesTo": { "attributes": ["label"] }, "basis": "authored" },
            ] }),
        );
        self.set_json(
            &format!("data/{library}/library.json"),
            &json!({
                "format": 0, "library": library, "title": "Synthetic",
                "package": { "name": "synthetic-components", "version": "1.0.0" },
                "prefix": prefix, "digest": "", "rules": "", "components": components,
            }),
        );
        self.regenerate(library);
    }

    /// Writes the pack, with the host's `pack.toml`, into `dir`.
    pub fn write(&self, dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("pack.toml"), PACK_TOML).unwrap();
        for (path, bytes) in &self.files {
            let target = dir.join(path);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(target, bytes).unwrap();
        }
    }

    /// A host serving this pack in space `main`.
    pub fn host(&self) -> Fx {
        self.host_with(toml::Table::new())
    }

    pub fn host_with(&self, config: toml::Table) -> Fx {
        let dir = TempDir::new().unwrap();
        self.write(dir.path());
        let host = TestHost::compiled(sdk(umbel_plugin_components::plugin()))
            .spaces(&["main", "beta"])
            .config(config)
            .pack_override("main", "library", dir.path())
            .boot()
            .unwrap();
        Fx { _dir: dir, host }
    }
}

/// `components-brief` on `host`.
pub async fn brief_on(host: &TestHost, input: Value) -> Value {
    serde_json::to_value(host.call("components-brief", input).await).unwrap()
}

/// The bytes AFD measured, and its limit.
pub fn measured(result: &Value) -> (u64, u64) {
    let budget = &result["metadata"]["dev.afd/outputBudget"];
    assert!(budget.is_object(), "no output budget in {result}");
    (
        budget["usedBytes"].as_u64().unwrap(),
        budget["limitBytes"].as_u64().unwrap(),
    )
}

/// The size of a result as AFD measures it: its compact JSON without `metadata`.
pub fn result_bytes(result: &Value) -> usize {
    let mut value = result.clone();
    value.as_object_mut().unwrap().remove("metadata");
    serde_json::to_string(&value).unwrap().len()
}

/// The entries of a brief, by tag.
pub fn entry<'a>(result: &'a Value, tag: &str) -> &'a Value {
    data(result)["content"]["components"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["tag"] == tag)
        .unwrap_or_else(|| panic!("no entry for {tag} in {result}"))
}

/// A record about the size of a FAST-AF record with guidance (about 1 500 bytes in a brief), with
/// something in every section: attributes with values, slots, an event, a command, a CSS property,
/// form, roles, axe, statements, rules, an example, a gap and a long form.
pub fn rich_record(tag: &str, index: usize, rules: &[&str]) -> Value {
    json!({
        "format": 0, "tag": tag, "status": "stable",
        "summary": format!("Component {index:04} groups a few related controls and shows their state on the page."),
        "import": format!("synthetic-components/{tag}.js"),
        "api": {
            "attributes": [
                { "name": "appearance", "property": "appearance", "type": "string",
                  "description": "How strongly the control stands out.",
                  "values": [
                      { "value": "accent", "basis": "observed" },
                      { "value": "neutral", "basis": "observed" },
                      { "value": "outline", "basis": "observed" },
                  ],
                  "default": "neutral", "basis": "observed" },
                { "name": "disabled", "property": "disabled", "type": "boolean", "default": false, "basis": "verified" },
                { "name": "label", "property": "label", "type": "string",
                  "description": "The visible label and accessible name.", "basis": "observed" },
                { "name": "size", "property": "size", "type": "string", "basis": "declared" },
            ],
            "slots": [
                { "name": "", "description": "The content.", "basis": "observed" },
                { "name": "start", "description": "An icon before the content.", "basis": "declared" },
            ],
            "events": [
                { "name": "change", "description": "The value changed.", "detail": "string: the new value", "basis": "verified" },
            ],
            "commands": [
                { "name": "--reset", "description": "Puts every control back to its default.", "basis": "declared" },
            ],
            "cssProperties": [
                { "name": "--synthetic-gap", "description": "Space between the parts.", "default": "4px", "basis": "declared" },
            ],
            "form": { "associated": false, "basis": "observed" },
        },
        "a11y": {
            "role": [ { "state": "default", "role": "group", "name": "from the label attribute", "basis": "observed" } ],
            "axe": { "violations": 0, "exceptions": [], "basis": "observed" },
            "statements": [
                { "id": format!("item-{index:04}.label"), "text": "Give it a label; the content alone does not name the group.", "basis": "authored" },
            ],
        },
        "usage": [
            { "id": format!("item-{index:04}.when"), "text": "Use it to group related controls; for one control, use the control alone.", "basis": "authored" },
        ],
        "rules": rules,
        "examples": [
            { "from": format!("item-{index:04}--default"), "html": format!("<{tag} label=\"Group\" appearance=\"accent\">\n\t<span>Content</span>\n</{tag}>"), "basis": "observed" },
        ],
        "detail": "A group of related controls.\n\nIt names itself from its label attribute and moves focus in reading order.",
        "gaps": [{ "kind": "unobserved", "name": "size", "section": "attributes" }],
    })
}

/// A minimal valid record.
pub fn record(tag: &str, summary: &str) -> Value {
    json!({
        "format": 0, "tag": tag, "summary": summary, "status": "stable",
        "api": { "attributes": [], "slots": [], "events": [], "commands": [], "cssProperties": [] },
        "a11y": { "role": [], "statements": [] },
        "usage": [], "rules": [], "examples": [], "gaps": [],
    })
}

/// A record's path in the example library.
pub fn record_path(name: &str) -> String {
    format!("data/example/components/example-{name}.json")
}

pub struct Fx {
    _dir: TempDir,
    pub host: TestHost,
}

/// A host with no override, serving the default pack.
pub fn default_host() -> TestHost {
    TestHost::compiled(sdk(umbel_plugin_components::plugin()))
        .spaces(&["main", "beta"])
        .boot()
        .unwrap()
}

impl Fx {
    pub async fn list(&self, input: Value) -> Value {
        serde_json::to_value(self.host.call("components-list", input).await).unwrap()
    }

    pub async fn open(&self, input: Value) -> Value {
        serde_json::to_value(self.host.call("components-open", input).await).unwrap()
    }

    pub async fn brief(&self, input: Value) -> Value {
        brief_on(&self.host, input).await
    }

    /// `components-brief` over MCP with an output budget of `ask` bytes.
    pub async fn brief_with_budget(&self, input: Value, ask: u64) -> Value {
        let context = self
            .host
            .host()
            .context(Actor::new(ActorKind::Test).with_id("testkit"))
            .with_interface(CommandInterface::Mcp)
            .with_output_budget_ask(ask);
        serde_json::to_value(
            self.host
                .host()
                .registry()
                .execute("components-brief", input, Some(context))
                .await,
        )
        .unwrap()
    }

    /// The override's directory in the workspace.
    pub fn override_dir(&self) -> PathBuf {
        self.host
            .workspace_dir()
            .join("spaces/main/packs/components/library")
    }
}

/// `details.problems` as `(path, at, code)` triples, as they came.
pub fn problems(result: &Value) -> Vec<(String, Option<String>, String)> {
    result["error"]["details"]["problems"]
        .as_array()
        .unwrap_or_else(|| panic!("no problems in {result}"))
        .iter()
        .map(|problem| {
            (
                problem["path"].as_str().unwrap().to_owned(),
                problem["at"].as_str().map(str::to_owned),
                problem["code"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

pub fn code(result: &Value) -> &str {
    assert_eq!(result["success"], false, "{result}");
    result["error"]["code"].as_str().unwrap()
}

/// `data` of a successful result.
pub fn data(result: &Value) -> &Value {
    assert_eq!(result["success"], true, "{result}");
    &result["data"]
}

pub fn tags(result: &Value) -> Vec<String> {
    data(result)["content"]["components"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["tag"].as_str().unwrap().to_owned())
        .collect()
}

/// The one problem of a pack with one defect.
pub async fn the_problem(pack: &Pack) -> (String, Option<String>, String) {
    let fx = pack.host();
    let result = fx.list(json!({})).await;
    let found = problems(&result);
    assert_eq!(found.len(), 1, "{found:?}");
    found.into_iter().next().unwrap()
}
