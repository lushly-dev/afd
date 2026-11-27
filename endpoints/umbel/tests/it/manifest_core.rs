//! The shared plugin manifest core (`spec/plugin-manifest.md`; the shared plugin manifest
//! proposal's step 3, #1205; D220), read by Umbel's own validator. `scripts/plugin-manifest.test.mjs`
//! runs the same cases on Ajv and holds every Umbel schema version to the core key by key; these
//! tests keep the Rust `jsonschema` crate, the validator Umbel's tests use, giving the same answers
//! and naming the same keys, which the proposal's step 1 checked only once, on 0.60.2.
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use jsonschema::error::ValidationErrorKind;
use jsonschema::{Retrieve, Uri, Validator};
use serde_json::{Value, json};
use umbel::plugins::{MANIFEST_VERSIONS, mount_command_name};

/// The core version every Umbel manifest version conforms to (D220).
const CORE: &str = "plugin-manifest.core.v1.json";

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn read_json(path: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap())
        .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn spec(name: &str) -> Value {
    read_json(&repository().join("spec").join(name))
}

/// The core and the cases' fixture schemas, by `$id`, served from the files and never the network.
struct Schemas(BTreeMap<String, Value>);

impl Retrieve for Schemas {
    fn retrieve(
        &self,
        uri: &Uri<String>,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        self.0
            .get(uri.as_str())
            .cloned()
            .ok_or_else(|| format!("no schema has the id {}", uri.as_str()).into())
    }
}

struct Cases {
    core: Value,
    file: Value,
}

impl Cases {
    fn load() -> Self {
        let file = spec("plugin-manifest.json");
        assert_eq!(
            file["core"], CORE,
            "the cases are written against core version 1"
        );
        Self {
            core: spec(CORE),
            file,
        }
    }

    /// The absolute reference for a case's `against`: `core#/$defs/<name>`, `<schema>` or
    /// `<schema>#/$defs/<name>`.
    fn reference(&self, against: &str) -> String {
        let (name, fragment) = against.split_once('#').unwrap_or((against, ""));
        let id = if name == "core" {
            &self.core["$id"]
        } else {
            &self.file["schemas"][name]["$id"]
        };
        let id = id
            .as_str()
            .unwrap_or_else(|| panic!("no schema named {name}"));
        if fragment.is_empty() {
            id.to_owned()
        } else {
            format!("{id}#{fragment}")
        }
    }

    fn validator(&self, against: &str) -> Validator {
        let mut schemas = BTreeMap::new();
        schemas.insert(
            self.core["$id"].as_str().unwrap().to_owned(),
            self.core.clone(),
        );
        for schema in self.file["schemas"].as_object().unwrap().values() {
            schemas.insert(schema["$id"].as_str().unwrap().to_owned(), schema.clone());
        }
        let root = json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$ref": self.reference(against),
        });
        jsonschema::options()
            .with_retriever(Schemas(schemas))
            .build(&root)
            .unwrap_or_else(|e| panic!("{against}: {e}"))
    }

    fn cases(&self) -> &[Value] {
        self.file["cases"].as_array().unwrap()
    }
}

/// An RFC 6901 pointer segment.
fn segment(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

/// The pointers of the keys a validator's refusal names: the missing or unexpected key for
/// `required`, `unevaluatedProperties` and `additionalProperties`, and the value's own location
/// for anything else, as the Node test reads Ajv's errors.
fn named(validator: &Validator, instance: &Value) -> BTreeSet<String> {
    let mut keys = BTreeSet::new();
    for error in validator.iter_errors(instance) {
        let at = error.instance_path().as_str().to_owned();
        match error.kind() {
            ValidationErrorKind::Required { property } => {
                keys.insert(format!("{at}/{}", segment(property.as_str().unwrap())));
            }
            ValidationErrorKind::UnevaluatedProperties { unexpected }
            | ValidationErrorKind::AdditionalProperties { unexpected } => {
                keys.extend(
                    unexpected
                        .iter()
                        .map(|key| format!("{at}/{}", segment(key))),
                );
            }
            _ => {
                keys.insert(at);
            }
        }
    }
    keys
}

#[test]
fn every_core_case_answers_as_written_naming_the_keys_it_gives() {
    let cases = Cases::load();
    let mut validators: BTreeMap<String, Validator> = BTreeMap::new();
    let mut refusals = 0;
    for case in cases.cases() {
        let id = case["id"].as_str().unwrap();
        let against = case["against"].as_str().unwrap();
        let validator = validators
            .entry(against.to_owned())
            .or_insert_with(|| cases.validator(against));
        let accepted = case["accepted"].as_bool().unwrap();
        let keys = named(validator, &case["fragment"]);
        assert_eq!(keys.is_empty(), accepted, "{id}: named {keys:?}");
        if accepted {
            continue;
        }
        refusals += 1;
        let mut expected: BTreeSet<String> =
            BTreeSet::from([case["pointer"].as_str().unwrap().to_owned()]);
        if let Some(also) = case["alsoNames"].as_array() {
            expected.extend(also.iter().map(|p| p.as_str().unwrap().to_owned()));
        }
        assert_eq!(keys, expected, "{id}");
    }
    // A file that lost its cases would pass the loop above.
    assert!(cases.cases().len() >= 200, "{} cases", cases.cases().len());
    assert!(refusals >= 150, "{refusals} refusals");
}

#[test]
fn every_rule_manifest_passes_the_core() {
    // The rules beyond the schema each start from a manifest the core accepts (the page's
    // Conformance section); what each rule answers is a reader's, not the schema's.
    let cases = Cases::load();
    let validator = cases.validator("core#/$defs/manifest");
    let rules = cases.file["rules"].as_array().unwrap();
    assert!(!rules.is_empty());
    for rule in rules {
        let keys = named(&validator, &rule["manifest"]);
        assert!(keys.is_empty(), "{}: {keys:?}", rule["id"]);
    }
}

/// Every path under `directory` whose name passes `wanted`, skipping build output, installed
/// packages and hidden folders, which a developer's checkout may hold and git does not.
fn find(directory: &Path, wanted: &dyn Fn(&Path) -> bool, found: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(directory).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name != "target" && name != "node_modules" && !name.starts_with('.') {
                find(&path, wanted, found);
            }
        } else if wanted(&path) {
            found.push(path);
        }
    }
}

fn umbel(path: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(path)
}

fn named_like(path: &Path, test: impl Fn(&str) -> bool) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(test)
}

#[test]
fn umbels_manifests_conform_to_the_core() {
    let cases = Cases::load();
    let validator = cases.validator("core#/$defs/manifest");

    let mut examples = Vec::new();
    find(
        &umbel("schemas/examples"),
        &|path| named_like(path, |name| name.starts_with("plugin-manifest")),
        &mut examples,
    );
    let mut toml_files = vec![umbel("tests/fixtures/plugins/todo-http/umbel-plugin.toml")];
    find(
        &umbel("plugins"),
        &|path| {
            named_like(path, |name| name == "umbel-plugin.toml")
                || (path.extension().is_some_and(|e| e == "toml")
                    && path
                        .parent()
                        .is_some_and(|dir| named_like(dir, |name| name == "manifests")))
        },
        &mut toml_files,
    );
    let mut templates = Vec::new();
    find(
        &umbel("src/templates"),
        &|path| named_like(path, |name| name == "manifest.toml.tmpl"),
        &mut templates,
    );
    assert!(examples.len() >= 7, "{} examples", examples.len());
    assert!(toml_files.len() >= 7, "{} TOML manifests", toml_files.len());
    assert!(templates.len() >= 4, "{} scaffolds", templates.len());

    let mut manifests: Vec<(PathBuf, Value)> = examples
        .into_iter()
        .map(|path| {
            let value = read_json(&path);
            (path, value)
        })
        .collect();
    for path in toml_files.into_iter().chain(templates) {
        let text = fs::read_to_string(&path)
            .unwrap()
            .replace("{{id}}", "sample")
            .replace("{{title}}", "Sample");
        let value: Value =
            toml::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        manifests.push((path, value));
    }

    let mut versions = BTreeSet::new();
    for (path, manifest) in &manifests {
        let keys = named(&validator, manifest);
        assert!(keys.is_empty(), "{}: {keys:?}", path.display());
        versions.insert(manifest["manifest_version"].as_u64().unwrap());
    }
    // Every manifest version Umbel reads has an example here, so a version that stopped
    // conforming is caught.
    assert_eq!(
        versions,
        MANIFEST_VERSIONS
            .iter()
            .map(|&v| u64::from(v))
            .collect::<BTreeSet<_>>(),
        "manifest versions with an example"
    );
}

#[test]
fn every_renaming_case_gets_its_name_from_the_host() {
    // The `renaming` cases pin a mounted tool's command name (the page's Renaming row), which
    // Umbel's loader makes with `mount_command_name`.
    let cases = Cases::load();
    let renaming = cases.file["renaming"].as_array().unwrap();
    assert!(!renaming.is_empty());
    for case in renaming {
        let id = case["id"].as_str().unwrap();
        let named = mount_command_name(
            case["manifestPrefix"].as_str().unwrap(),
            case["prefix"].as_str().unwrap(),
            case["tool"].as_str().unwrap(),
            case["name"].as_str(),
        );
        match case["command"].as_str() {
            Some(command) => assert_eq!(named.as_deref(), Ok(command), "{id}"),
            None => {
                assert_eq!(case["unnameable"], true, "{id}");
                assert!(named.is_err(), "{id}: named {named:?}");
            }
        }
    }
}
