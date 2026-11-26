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

/// `violet-elements`' committed pack: its records and rules, in Specimen's committed form.
pub fn fast_af_committed() -> PathBuf {
    let config: Value = serde_json::from_slice(
        &std::fs::read(fast_af_library().join("specimen.config.json")).unwrap(),
    )
    .unwrap();
    fast_af_library().join(config["pack"]["directory"].as_str().unwrap())
}

/// `violet-elements`' directory, whose `specimen.config.json` and `package.json` stamp its catalog.
pub fn fast_af_library() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../foundations/fast-af/packages/violet-elements")
}

/// This crate's FAST-AF test data: the page set and the fact fixture.
pub fn fast_af_fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fast_af")
}

/// The catalog `specimen pack-export` writes for `library` from its committed `files` (keyed as in
/// a pack, `rules/<library>.json` and `data/<library>/components/<tag>.json`) and a `stamp` holding
/// `title`, `package` and `prefix` (no `revision`, which the tests never stamp): `packCatalog` in
/// the format's words (Specimen's `pack-format.md`, "Catalog"). The records are listed by tag, each with its
/// summary when it has one, its status and its digest; the pack digest covers the rules and every
/// record. `catalog_is_what_specimen_exports` in `fast_af.rs` holds it to Specimen's own export.
pub fn export_catalog(files: &BTreeMap<String, Vec<u8>>, library: &str, stamp: &Value) -> Vec<u8> {
    let rules_path = format!("rules/{library}.json");
    let rules = files
        .get(&rules_path)
        .unwrap_or_else(|| panic!("{rules_path} is missing"));
    let prefix = format!("data/{library}/components/");
    let mut tags: Vec<&str> = files
        .keys()
        .filter_map(|path| path.strip_prefix(&prefix)?.strip_suffix(".json"))
        .collect();
    tags.sort_by(|a, b| digest::utf16_cmp(a, b));
    let components: Vec<Value> = tags
        .iter()
        .map(|tag| {
            let bytes = &files[&format!("{prefix}{tag}.json")];
            let record: Value = serde_json::from_slice(bytes).unwrap();
            let mut entry = json!({
                "tag": tag,
                "status": record["status"],
                "digest": digest::file_digest(bytes),
            });
            if let Some(summary) = record.get("summary") {
                entry["summary"] = summary.clone();
            }
            entry
        })
        .collect();
    let digested = files
        .iter()
        .filter(|(path, _)| {
            **path == rules_path
                || path.starts_with(&prefix)
                || path.starts_with(&format!("data/{library}/patterns/"))
        })
        .map(|(path, bytes)| (path.as_str(), bytes.as_slice()));
    // `packCatalog` writes `PACK_FORMAT_VERSION`; every file of a pack the reader accepts carries
    // that same version, so the rules file's is it.
    let format = serde_json::from_slice::<Value>(rules).unwrap()["format"].clone();
    let mut catalog = json!({
        "format": format,
        "library": library,
        "title": stamp["title"],
        "package": stamp["package"],
        "prefix": stamp["prefix"],
        "digest": digest::pack_digest(digested),
        "rules": digest::file_digest(rules),
        "components": components,
    });
    if format.as_u64() == Some(2) {
        let pat_prefix = format!("data/{library}/patterns/");
        let mut pat_names: Vec<&str> = files
            .keys()
            .filter_map(|path| {
                let tail = path.strip_prefix(&pat_prefix)?.strip_suffix(".json")?;
                (!tail.contains('/')).then_some(tail)
            })
            .collect();
        pat_names.sort_by(|a, b| digest::utf16_cmp(a, b));
        let patterns: Vec<Value> = pat_names
            .iter()
            .map(|name| {
                let bytes = &files[&format!("{pat_prefix}{name}.json")];
                let record: Value = serde_json::from_slice(bytes).unwrap();
                let mut entry = json!({
                    "pattern": name,
                    "status": record["status"],
                    "scope": record["scope"],
                    "facets": record["facets"],
                    "digest": digest::file_digest(bytes),
                });
                if let Some(summary) = record.get("summary") {
                    entry["summary"] = summary.clone();
                }
                if let Some(approval) = record.get("approvalStatus") {
                    entry["approvalStatus"] = approval.clone();
                }
                if let Some(replaced) = record.get("replacedBy") {
                    entry["replacedBy"] = replaced.clone();
                }
                entry
            })
            .collect();
        let mut copy_pairs: Vec<(&str, &str)> = files
            .keys()
            .filter_map(|path| {
                let tail = path.strip_prefix(&pat_prefix)?.strip_suffix(".json")?;
                let (pat, name) = tail.split_once('/')?;
                (!name.contains('/')).then_some((pat, name))
            })
            .collect();
        copy_pairs
            .sort_by(|a, b| digest::utf16_cmp(a.0, b.0).then_with(|| digest::utf16_cmp(a.1, b.1)));
        let copies: Vec<Value> = copy_pairs
            .iter()
            .map(|(pat, name)| {
                let bytes = &files[&format!("{pat_prefix}{pat}/{name}.json")];
                let record: Value = serde_json::from_slice(bytes).unwrap();
                let mut entry = json!({
                    "pattern": pat,
                    "name": name,
                    "status": record["status"],
                    "revision": record["revision"],
                    "fingerprint": record["fingerprint"],
                    "digest": digest::file_digest(bytes),
                });
                if let Some(approval) = record.get("approvalStatus") {
                    entry["approvalStatus"] = approval.clone();
                }
                if let Some(replaced) = record.get("replacedBy") {
                    entry["replacedBy"] = replaced.clone();
                }
                entry
            })
            .collect();
        catalog["patterns"] = Value::Array(patterns);
        catalog["copies"] = Value::Array(copies);
        if let Some(bindings) = stamp.get("patternBindings") {
            catalog["patternBindings"] = bindings.clone();
        }
    }
    canonical::canonical_json(&catalog).into_bytes()
}

/// The stamp `specimen pack-export` gives `violet-elements`: the title and prefix from its
/// `specimen.config.json`'s `pack` section, the name and version from the `package.json` it names.
pub fn fast_af_stamp() -> (String, Value) {
    let read = |path: PathBuf| -> Value {
        serde_json::from_slice(&std::fs::read(&path).unwrap_or_else(|error| {
            panic!("{}: {error}", path.display());
        }))
        .unwrap()
    };
    let config = read(fast_af_library().join("specimen.config.json"));
    let pack = &config["pack"];
    let manifest = read(fast_af_library().join(pack["package"].as_str().unwrap()));
    let stamp = json!({
        "title": pack["title"],
        "package": { "name": manifest["name"], "version": manifest["version"] },
        "prefix": pack["prefix"],
    });
    (pack["library"].as_str().unwrap().to_owned(), stamp)
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

    /// The pack `specimen pack-export` writes for `violet-elements`, beside Specimen's example
    /// library: the export's records and rules are the committed ones byte for byte (the format's
    /// two forms differ only by the catalog), and its catalog is derived from them here, as export
    /// derives it, so a rebuilt record needs no second step.
    pub fn fast_af() -> Self {
        let mut pack = Self::example();
        let (library, stamp) = fast_af_stamp();
        let committed: BTreeMap<String, Vec<u8>> = read_tree(&fast_af_committed())
            .into_iter()
            .filter(|(path, _)| path.starts_with("data/") || path.starts_with("rules/"))
            .collect();
        let catalog = export_catalog(&committed, &library, &stamp);
        pack.files.extend(committed);
        pack.files
            .insert(format!("data/{library}/library.json"), catalog);
        pack
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
        let pat_prefix = format!("data/{library}/patterns/");
        let mut catalog = self.json(&catalog_path);
        catalog["rules"] = json!(digest::file_digest(&self.files[&rules_path]));
        for entry in catalog["components"].as_array_mut().unwrap() {
            let file = format!("{prefix}{}.json", entry["tag"].as_str().unwrap());
            if let Some(bytes) = self.files.get(&file) {
                entry["digest"] = json!(digest::file_digest(bytes));
            }
        }
        if let Some(patterns) = catalog.get_mut("patterns").and_then(Value::as_array_mut) {
            for entry in patterns {
                let file = format!("{pat_prefix}{}.json", entry["pattern"].as_str().unwrap());
                if let Some(bytes) = self.files.get(&file) {
                    entry["digest"] = json!(digest::file_digest(bytes));
                }
            }
        }
        if let Some(copies) = catalog.get_mut("copies").and_then(Value::as_array_mut) {
            for entry in copies {
                let file = format!(
                    "{pat_prefix}{}/{}.json",
                    entry["pattern"].as_str().unwrap(),
                    entry["name"].as_str().unwrap()
                );
                if let Some(bytes) = self.files.get(&file) {
                    entry["digest"] = json!(digest::file_digest(bytes));
                }
            }
        }
        let digested = self
            .files
            .iter()
            .filter(|(path, _)| {
                **path == rules_path || path.starts_with(&prefix) || path.starts_with(&pat_prefix)
            })
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
        for name in ["dropdown", "field", "option", "select"] {
            let path = format!("data/{library}/components/example-{name}.json");
            let library_id = library.to_owned();
            self.edit(&path, |record| {
                if let Some(patterns) = record.get_mut("patterns").and_then(Value::as_array_mut) {
                    for pat in patterns {
                        if pat.get("library").and_then(Value::as_str) == Some("example") {
                            pat["library"] = json!(library_id);
                        }
                    }
                }
            });
        }
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
            &json!({ "format": 1, "library": library, "rules": [] }),
        );
        self.set_json(
            &format!("data/{library}/library.json"),
            &json!({
                "format": 1, "library": library, "title": "Synthetic",
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
            &json!({ "format": 1, "library": library, "rules": [
                { "id": "shared.focus", "text": "Focus moves into the group in reading order and leaves it with Tab.",
                  "appliesTo": { "attributes": ["label"] }, "basis": "verified" },
                { "id": "shared.labelling", "text": "Every group needs a label attribute; a nearby heading does not name it.",
                  "appliesTo": { "attributes": ["label"] }, "basis": "authored" },
            ] }),
        );
        self.set_json(
            &format!("data/{library}/library.json"),
            &json!({
                "format": 1, "library": library, "title": "Synthetic",
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

    /// A host serving this pack in space `main`, with `map` as `main`'s consumers.
    pub fn host_with_consumers(&self, map: Value) -> Fx {
        self.host_with_consumer_maps(&[("main", map)], toml::Table::new())
    }

    /// A host serving this pack in space `main`, with each `(space, map)` as that space's
    /// consumers and `config` as the instance's configuration.
    pub fn host_with_consumer_maps(&self, maps: &[(&str, Value)], config: toml::Table) -> Fx {
        let dir = TempDir::new().unwrap();
        let library = dir.path().join("library");
        self.write(&library);
        let mut host = TestHost::compiled(sdk(umbel_plugin_components::plugin()))
            .spaces(&["main", "beta"])
            .config(config)
            .pack_override("main", "library", &library);
        for (space, map) in maps {
            let consumers = dir.path().join(format!("consumers-{space}"));
            std::fs::create_dir_all(consumers.join("data")).unwrap();
            std::fs::write(
                consumers.join("pack.toml"),
                include_str!("../../packs/consumers/pack.toml"),
            )
            .unwrap();
            std::fs::write(consumers.join("data/consumers.json"), map.to_string()).unwrap();
            host = host.pack_override(space, "consumers", &consumers);
        }
        Fx {
            _dir: dir,
            host: host.boot().unwrap(),
        }
    }

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
        "format": 1, "tag": tag, "status": "stable",
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
        "format": 1, "tag": tag, "summary": summary, "status": "stable",
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

    pub async fn pattern_list(&self, input: Value) -> Value {
        serde_json::to_value(self.host.call("components-pattern-list", input).await).unwrap()
    }

    pub async fn pattern_open(&self, input: Value) -> Value {
        serde_json::to_value(self.host.call("components-pattern-open", input).await).unwrap()
    }

    pub async fn pattern_open_with_budget(&self, input: Value, ask: u64) -> Value {
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
                .execute("components-pattern-open", input, Some(context))
                .await,
        )
        .unwrap()
    }

    pub async fn pattern_list_with_budget(&self, input: Value, ask: u64) -> Value {
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
                .execute("components-pattern-list", input, Some(context))
                .await,
        )
        .unwrap()
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
