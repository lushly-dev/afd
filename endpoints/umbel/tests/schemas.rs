//! The versioned schema files under `schemas/` (phase 0 specification sections 7 and 10; phase 1
//! sections 2, 8.2 and 9.1; phase 2 section 2) and the WIT world.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use jsonschema::{Retrieve, Uri, Validator};
use serde_json::{Value, json};
use umbel::events::Event;
use umbel::plugins::{Manifest, PackManifest};
use umbel::provenance::Envelope;
use umbel::workspace::ConfigFile;

const STEMS: [&str; 18] = [
    "workspace-config.v1",
    "workspace-config.v2",
    "workspace-config.v3",
    "plugin-manifest.v1",
    "plugin-manifest.v2",
    "pack-manifest.v1",
    "principal.v0",
    "provenance-envelope.v0",
    "provenance-envelope.v1",
    "event.v0",
    "event.v1",
    "cursor.v0",
    "cursor-file.v0",
    "document.v1",
    "locator.v1",
    "proposal.v1",
    "eval-queries.v1",
    "eval-report.v1",
];

fn schemas_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("schemas")
}

fn read(path: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap())
        .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn schema(stem: &str) -> Value {
    read(&schemas_dir().join(format!("{stem}.json")))
}

/// Resolves a `$ref` to a sibling schema from the files, never from the network.
struct Siblings(BTreeMap<String, Value>);

impl Retrieve for Siblings {
    fn retrieve(
        &self,
        uri: &Uri<String>,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        self.0
            .get(uri.as_str())
            .cloned()
            .ok_or_else(|| format!("no schema file has the id {}", uri.as_str()).into())
    }
}

fn validator(stem: &str) -> Validator {
    let siblings = STEMS
        .iter()
        .map(|stem| {
            let value = schema(stem);
            (value["$id"].as_str().unwrap().to_owned(), value)
        })
        .collect();
    jsonschema::options()
        .with_retriever(Siblings(siblings))
        .build(&schema(stem))
        .unwrap_or_else(|e| panic!("{stem}: {e}"))
}

/// Every example of `stem`: `<stem>.json` and `<stem>.<case>.json`.
fn examples(stem: &str) -> Vec<(String, Value)> {
    let mut found = Vec::new();
    for entry in fs::read_dir(schemas_dir().join("examples"))
        .unwrap()
        .flatten()
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        let case = name.strip_suffix(".json").unwrap();
        if case == stem
            || case
                .strip_prefix(stem)
                .is_some_and(|rest| rest.starts_with('.'))
        {
            found.push((name, read(&entry.path())));
        }
    }
    found.sort_by(|a, b| a.0.cmp(&b.0));
    found
}

#[test]
fn each_schema_file_is_valid_json_schema_2020_12() {
    for stem in STEMS {
        let value = schema(stem);
        assert_eq!(
            value["$schema"], "https://json-schema.org/draft/2020-12/schema",
            "{stem}"
        );
        jsonschema::meta::validate(&value).unwrap_or_else(|e| panic!("{stem}: {e}"));
    }
}

#[test]
fn schemas_are_closed() {
    for stem in STEMS.iter().filter(|stem| !stem.starts_with("cursor.")) {
        let value = schema(stem);
        assert_eq!(value["additionalProperties"], false, "{stem}");
    }
}

#[test]
fn every_example_validates_against_its_schema() {
    for stem in STEMS {
        let validator = validator(stem);
        let found = examples(stem);
        assert!(!found.is_empty(), "{stem} has no example");
        for (name, example) in found {
            if let Err(error) = validator.validate(&example) {
                panic!("{name}: {error}");
            }
        }
    }
}

#[test]
fn every_example_file_belongs_to_a_schema() {
    let known: usize = STEMS.iter().map(|stem| examples(stem).len()).sum();
    let files = fs::read_dir(schemas_dir().join("examples"))
        .unwrap()
        .count();
    assert_eq!(known, files, "an example file matches no schema stem");
}

#[test]
fn version_0_schemas_refuse_each_reserved_field() {
    let cases: [(&str, &[&str]); 2] = [
        (
            "principal.v0",
            &[
                "credentials",
                "delegationChain",
                "tokenBinding",
                "humanPresent",
                "policyDecision",
                "policyVersion",
                "scopes",
                "spaces",
                "tenant",
            ],
        ),
        (
            "provenance-envelope.v0",
            &[
                "sources",
                "generated",
                "contentHash",
                "derivedFrom",
                "access",
                "sensitivity",
                "redactions",
                "delegationChain",
                "tenant",
            ],
        ),
    ];
    for (stem, reserved) in cases {
        let validator = validator(stem);
        let (_, base) = examples(stem).remove(0);
        assert!(validator.is_valid(&base), "{stem}");
        for field in reserved {
            let mut with = base.clone();
            with[*field] = json!("x");
            assert!(
                !validator.is_valid(&with),
                "{stem} accepted reserved field {field}"
            );
        }
    }
}

#[test]
fn nested_reserved_provenance_fields_are_refused_inside_an_event() {
    let validator = validator("event.v0");
    let (_, mut event) = examples("event.v0").remove(0);
    assert!(validator.is_valid(&event));
    event["provenance"]["contentHash"] = json!("sha256:00");
    assert!(!validator.is_valid(&event));
}

#[test]
fn the_cursor_pattern_accepts_and_refuses() {
    let validator = validator("cursor.v0");
    for ok in ["v0:main:0", "v0:main:12", "v0:a-b2:100"] {
        assert!(validator.is_valid(&json!(ok)), "{ok}");
    }
    for bad in [
        "v0:main:01",
        "v1:main:3",
        "v0:Main:1",
        "v0:main:",
        "main:1",
        "v0:main:-1",
        "v0:1main:1",
    ] {
        assert!(!validator.is_valid(&json!(bad)), "{bad}");
    }
    assert!(!validator.is_valid(&json!(3)));
}

#[test]
fn the_config_schema_refuses_what_the_host_refuses() {
    let validator = validator("workspace-config.v1");
    let bad = [
        json!({}),
        json!({ "config_version": 2 }),
        json!({ "config_version": 1, "unknown": 1 }),
        json!({ "config_version": 1, "http": { "bind": "0.0.0.0:7410" } }),
        json!({ "config_version": 1, "http": { "path": "/" } }),
        json!({ "config_version": 1, "http": { "path": "/health" } }),
        json!({ "config_version": 1, "http": { "path": "/a/../b" } }),
        json!({ "config_version": 1, "http": { "allowed_hosts": ["*"] } }),
        json!({ "config_version": 1, "http": { "allowed_origins": ["*"] } }),
        json!({ "config_version": 1, "http": { "allowed_origins": ["null"] } }),
        json!({ "config_version": 1, "http": { "max_body_bytes": 10 } }),
        json!({ "config_version": 1, "journal": { "lock_timeout_ms": 99 } }),
        json!({ "config_version": 1, "plugins": { "enabled": ["x"] } }),
        json!({ "config_version": 1, "mcp": { "first_class_tools": [] } }),
        json!({ "config_version": 1, "mcp": { "confirmations": "sometimes" } }),
        json!({ "config_version": 1, "spaces": { "Bad": {} } }),
        json!({ "config_version": 1, "profile": "solo" }),
    ];
    for instance in bad {
        assert!(!validator.is_valid(&instance), "{instance}");
    }
}

#[test]
fn the_config_examples_open_in_the_host_too() {
    let validator = validator("workspace-config.v1");
    for (name, example) in examples("workspace-config.v1") {
        assert!(validator.is_valid(&example), "{name}");
        let table = toml::Value::try_from(&example).unwrap();
        let text = toml::to_string(&table).unwrap();
        ConfigFile::parse(&text)
            .and_then(|file| file.into_config(Path::new("/w/example")))
            .unwrap_or_else(|e| panic!("{name}: {e}"));
    }
}

fn as_toml(example: &Value) -> String {
    toml::to_string(&toml::Value::try_from(example).unwrap()).unwrap()
}

#[test]
fn the_version_2_config_schema_refuses_what_the_host_refuses() {
    let validator = validator("workspace-config.v2");
    let ok = [
        json!({ "config_version": 2 }),
        json!({ "config_version": 2, "plugins": { "enabled": [] } }),
        json!({ "config_version": 2, "plugins": { "enabled": ["hello"], "hello": {} } }),
    ];
    for instance in ok {
        assert!(validator.is_valid(&instance), "{instance}");
    }
    let enabled = |instance: Value| json!({ "config_version": 2, "plugins": { "enabled": ["hello"], "hello": instance } });
    let bad = [
        json!({ "config_version": 1 }),
        json!({ "config_version": 3 }),
        json!({ "config_version": 2, "unknown": 1 }),
        json!({ "config_version": 2, "plugins": { "enabled": "hello" } }),
        json!({ "config_version": 2, "plugins": { "enabled": ["Hello"] } }),
        json!({ "config_version": 2, "plugins": { "enabled": ["a", "a"] } }),
        json!({ "config_version": 2, "plugins": { "enabled": [], "Bad": {} } }),
        json!({ "config_version": 2, "plugins": { "enabled": [], "x": 3 } }),
        enabled(json!({ "bogus": 1 })),
        enabled(json!({ "source": "../x" })),
        enabled(json!({ "source": "/abs" })),
        enabled(json!({ "source": "compiled:Bad" })),
        enabled(json!({ "spaces": [] })),
        enabled(json!({ "spaces": ["Bad"] })),
        enabled(json!({ "deny": ["teleport"] })),
        enabled(json!({ "prefix": "workspace" })),
        enabled(json!({ "prefix": "serve" })),
        enabled(json!({ "url": "http://example.com/mcp" })),
        enabled(json!({ "url": "https://user@example.com/mcp" })),
        enabled(json!({ "bearer_env": "not a name" })),
        enabled(json!({ "limits": { "fuel": 20_000_000_001_u64 } })),
        enabled(json!({ "limits": { "timeout_ms": 60_001 } })),
        enabled(json!({ "limits": { "memory_bytes": 1_073_741_825_u64 } })),
        enabled(json!({ "limits": { "table_elements": 1_000_001 } })),
        enabled(json!({ "limits": { "bogus": 1 } })),
        enabled(json!({ "connect_timeout_ms": 60_001 })),
        enabled(json!({ "timeout_ms": 300_001 })),
        enabled(json!({ "max_result_bytes": 16_777_217 })),
        enabled(json!({ "env": { "A": 1 } })),
        enabled(json!({ "grants": { "http": { "allow": "x" } } })),
        enabled(json!({ "grants": { "http": { "other": [] } } })),
    ];
    for instance in bad {
        assert!(!validator.is_valid(&instance), "{instance}");
    }
    // A host the file schema alone cannot judge but the schema still lets through: `enabled`
    // as a table is refused because `enabled` must be an array.
    assert!(!validator.is_valid(&json!({ "config_version": 2, "plugins": { "enabled": {} } })));
}

#[test]
fn the_version_2_config_examples_open_in_the_host_too() {
    let validator = validator("workspace-config.v2");
    let found = examples("workspace-config.v2");
    assert_eq!(found.len(), 3);
    for (name, example) in found {
        assert!(validator.is_valid(&example), "{name}");
        ConfigFile::parse(&as_toml(&example))
            .and_then(|file| file.into_config(Path::new("/w/example")))
            .unwrap_or_else(|e| panic!("{name}: {e}"));
    }
}

#[test]
fn the_plugin_manifest_examples_are_manifests_to_the_host_too() {
    let validator = validator("plugin-manifest.v1");
    let found = examples("plugin-manifest.v1");
    assert_eq!(
        found.len(),
        5,
        "compiled, component, mounted, http and pack"
    );
    for (name, example) in found {
        assert!(validator.is_valid(&example), "{name}");
        Manifest::parse(&as_toml(&example), &name).unwrap_or_else(|e| panic!("{name}: {e}"));
    }
}

#[test]
fn the_pack_manifest_example_is_a_pack_manifest_to_the_host_too() {
    let validator = validator("pack-manifest.v1");
    let (name, example) = examples("pack-manifest.v1").remove(0);
    assert!(validator.is_valid(&example), "{name}");
    PackManifest::parse(&as_toml(&example), &name).unwrap();
    for bad in [json!({ "pack_version": 2 }), json!({ "extra": 1 })] {
        let mut with = example.clone();
        for (key, value) in bad.as_object().unwrap() {
            with[key] = value.clone();
        }
        assert!(!validator.is_valid(&with), "{with}");
    }
    let mut missing = example;
    missing.as_object_mut().unwrap().remove("title");
    assert!(!validator.is_valid(&missing));
}

#[test]
fn the_plugin_manifest_schema_refuses_what_the_host_refuses() {
    let validator = validator("plugin-manifest.v1");
    let base = read(&schemas_dir().join("examples/plugin-manifest.v1.json"));
    assert!(validator.is_valid(&base));
    let with = |edit: &dyn Fn(&mut Value)| {
        let mut manifest = base.clone();
        edit(&mut manifest);
        manifest
    };
    // Versions, and the reserved top-level keys and grant key.
    assert!(!validator.is_valid(&with(&|m| m["manifest_version"] = json!(2))));
    assert!(!validator.is_valid(&with(&|m| m["protocol"] = json!(2))));
    for reserved in [
        "ui",
        "connectors",
        "backends",
        "dependencies",
        "signature",
        "scopes",
        "on_conflict",
    ] {
        assert!(
            !validator.is_valid(&with(&|m| m[reserved] = json!({}))),
            "{reserved}"
        );
    }
    assert!(!validator.is_valid(&with(&|m| m["grants"][0]["allow"] = json!(["x"]))));
    // Closed objects, and a component world key.
    assert!(!validator.is_valid(&with(&|m| m["plugin"]["bogus"] = json!(1))));
    assert!(!validator.is_valid(&with(&|m| m["commands"][0]["bogus"] = json!(1))));
    assert!(!validator.is_valid(&with(&|m| m["commands"][0]["scopes"] = json!(["x"]))));
    // Names and effects.
    assert!(!validator.is_valid(&with(&|m| m["plugin"]["id"] = json!("Hello"))));
    assert!(!validator.is_valid(&with(&|m| m["plugin"]["version"] = json!("1.0"))));
    assert!(!validator.is_valid(&with(&|m| m["plugin"]["domains"] = json!(["workspace"]))));
    assert!(!validator.is_valid(&with(&|m| m["commands"][0]["name"] = json!("hello"))));
    for effects in [
        json!([]),
        json!(["store-write"]),
        json!(["workspace-write"]),
        json!(["inspect", "external"]),
    ] {
        assert!(
            !validator.is_valid(&with(&|m| m["commands"][0]["effects"] = effects.clone())),
            "{effects}"
        );
    }
    assert!(!validator.is_valid(&with(
        &|m| m["commands"][0]["input_schema"] = json!("../x.json")
    )));
    assert!(!validator.is_valid(&with(
        &|m| m["commands"][0]["input_schema"] = json!("/abs.json")
    )));
    assert!(!validator.is_valid(&with(&|m| m["commands"][0]["input_schema"] = json!("a.txt"))));
    // Kind rules.
    assert!(
        !validator.is_valid(&with(&|m| m["plugin"]["kind"] = json!("component"))),
        "component needs its table"
    );
    assert!(
        !validator.is_valid(&with(&|m| m["component"] = json!({ "path": "a.wasm" }))),
        "a compiled plugin has no component"
    );
    assert!(!validator.is_valid(&with(
        &|m| m["mount"] = json!({ "prefix": "hello", "transport": "stdio", "command": ["x"] })
    )));
    assert!(
        !validator.is_valid(&with(&|m| m["plugin"]
            .as_object_mut()
            .unwrap()
            .remove("domains")
            .map(|_| ())
            .unwrap_or(()))),
        "domains are required"
    );
}

#[test]
fn the_plugin_manifest_schema_knows_the_other_kinds() {
    let validator = validator("plugin-manifest.v1");
    let get = |stem: &str| {
        examples("plugin-manifest.v1")
            .into_iter()
            .find(|(name, _)| name.contains(stem))
            .unwrap()
            .1
    };
    let component = get("component");
    let mut wrong = component.clone();
    wrong["component"]["world"] = json!("umbel:plugin/plugin@1.0.0");
    assert!(!validator.is_valid(&wrong), "no world key");
    let mut wrong = component.clone();
    wrong["component"]["path"] = json!("hello.bin");
    assert!(!validator.is_valid(&wrong));

    let mounted = get("mounted");
    for (key, value) in [("url", json!("http://x/mcp")), ("bearer_env", json!("T"))] {
        let mut wrong = mounted.clone();
        wrong["mount"][key] = value;
        assert!(!validator.is_valid(&wrong), "{key} is the deployer's");
    }
    let mut wrong = mounted.clone();
    wrong["grants"] = json!([{ "name": "log", "reason": "x" }]);
    assert!(
        !validator.is_valid(&wrong),
        "a mounted plugin has no grants"
    );
    let mut wrong = mounted.clone();
    wrong["commands"] = json!([]);
    assert!(
        !validator.is_valid(&wrong),
        "mounted commands come from tools/list"
    );
    let mut wrong = mounted.clone();
    wrong["mount"]["bearer"] = json!("required");
    assert!(!validator.is_valid(&wrong), "bearer is an http key");

    let http = get("http");
    let mut wrong = http.clone();
    wrong["mount"]["command"] = json!(["x"]);
    assert!(!validator.is_valid(&wrong), "command is a stdio key");

    let pack = get("pack");
    let mut wrong = pack.clone();
    wrong["plugin"]["domains"] = json!(["style"]);
    assert!(!validator.is_valid(&wrong), "a pack plugin has no domains");
    let mut wrong = pack.clone();
    wrong["contexts"] = json!([]);
    assert!(!validator.is_valid(&wrong), "a pack plugin has no contexts");
}

#[test]
fn defs_holds_every_top_level_property_for_loam_to_reference() {
    let schema = schema("plugin-manifest.v1");
    let properties = schema["properties"].as_object().unwrap();
    for (name, property) in properties {
        assert_eq!(
            property["$ref"],
            format!("#/$defs/{name}"),
            "{name} is not defined under $defs by its own name"
        );
        assert!(schema["$defs"].get(name).is_some(), "{name}");
    }
    // Loam adds `ui` in its own schema; this one keeps it out.
    assert!(!properties.contains_key("ui"));
}

#[test]
fn the_wit_world_is_the_files_the_specification_prints() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let wit = fs::read_to_string(root.join("wit/umbel-plugin-1.0.0/world.wit")).unwrap();
    assert!(wit.starts_with("package umbel:plugin@1.0.0;"));
    assert_eq!(umbel::WIT_WORLD, "umbel:plugin/plugin@1.0.0");
    for needed in [
        "interface types",
        "interface config",
        "interface log",
        "interface packs",
        "interface events",
        "interface clock",
        "interface random",
        "interface command",
        "world plugin",
        "export command;",
    ] {
        assert!(wit.contains(needed), "{needed}");
    }
    // The specification prints the file; they must not drift apart.
    let spec = fs::read_to_string(root.join("docs/phases/1-plugin-contract/spec.md")).unwrap();
    let start = spec.find("```wit\n").unwrap() + "```wit\n".len();
    let end = start + spec[start..].find("```").unwrap();
    assert_eq!(&spec[start..end], wit);
}

// ── Phase 2 (section 2) ────────────────────────────────────────────────────────────────────────

fn example(stem: &str, case: &str) -> Value {
    let name = if case.is_empty() {
        format!("{stem}.json")
    } else {
        format!("{stem}.{case}.json")
    };
    read(&schemas_dir().join("examples").join(name))
}

/// `instance` with `edit` applied.
fn edited(instance: &Value, edit: impl FnOnce(&mut Value)) -> Value {
    let mut copy = instance.clone();
    edit(&mut copy);
    copy
}

fn assert_refuses(validator: &Validator, label: &str, instances: &[Value]) {
    for instance in instances {
        assert!(!validator.is_valid(instance), "{label} accepted {instance}");
    }
}

#[test]
fn the_version_3_config_schema_refuses_what_the_host_refuses() {
    let validator = validator("workspace-config.v3");
    let space = |body: Value| json!({ "config_version": 3, "spaces": { "main": body } });
    let collection = |body: Value| space(json!({ "collections": { "handbook": body } }));
    let granting = |grants: Value| json!({ "config_version": 3, "spaces": { "main": {}, "beta": {} }, "plugins": { "enabled": ["x"], "x": { "grants": grants } } });
    let ok = [
        json!({ "config_version": 3 }),
        space(json!({ "readers": ["*"] })),
        space(json!({ "readers": ["human:ada", "group:platform", "agent:a:b"] })),
        collection(json!({ "root": "spaces/main/handbook" })),
        collection(json!({ "root": "a", "max_file_bytes": 16_777_216 })),
        json!({ "config_version": 3, "access": { "groups": { "x": { "members": ["*", "agent:ci"] } } } }),
        json!({ "config_version": 3, "store": { "lock_timeout_ms": 100 } }),
        space(json!({ "backend": "embedded" })),
        granting(json!({ "documents_write": { "allow": ["main/handbook", "beta/*"] } })),
        granting(json!({ "content_write": { "allow": ["main/*"] } })),
        granting(json!({ "records_write": { "allow": ["main", "*"] } })),
        granting(
            json!({ "index_write": { "allow": ["main"] }, "graph_write": { "allow": ["*"] } }),
        ),
        json!({ "config_version": 3, "plugins": { "enabled": ["x"], "x": { "deny": ["content_write", "graph_write", "records"] } } }),
    ];
    for instance in ok {
        assert!(validator.is_valid(&instance), "{instance}");
    }
    let bad = [
        json!({ "config_version": 2 }),
        json!({ "config_version": 4 }),
        // An allow list: only the five write grants take one, each with at least one entry of
        // its form (collection-level or space-level), once.
        granting(json!({ "documents": { "allow": ["main"] } })),
        granting(json!({ "http": { "allow": ["example.com"] } })),
        granting(json!({ "documents_write": {} })),
        granting(json!({ "documents_write": { "allow": [] } })),
        granting(json!({ "documents_write": { "allow": ["main"] } })),
        granting(json!({ "documents_write": { "allow": ["*"] } })),
        granting(json!({ "documents_write": { "allow": ["main/handbook", "main/handbook"] } })),
        granting(json!({ "documents_write": { "allow": "main/*" } })),
        granting(json!({ "documents_write": { "allow": ["main/*"], "other": [] } })),
        granting(json!({ "content_write": { "allow": ["Main/*"] } })),
        granting(json!({ "records_write": { "allow": ["main/notes"] } })),
        granting(json!({ "index_write": { "allow": [] } })),
        granting(json!({ "graph_write": { "allow": [1] } })),
        json!({ "config_version": 3, "unknown": 1 }),
        space(json!({ "content_roots": ["notes"] })),
        space(json!({ "readers": [] })),
        space(json!({ "readers": ["ada"] })),
        space(json!({ "readers": ["space"] })),
        space(json!({ "readers": ["group:Bad"] })),
        space(json!({ "bogus": 1 })),
        space(json!({ "collections": { "Bad": { "root": "a" } } })),
        collection(json!({})),
        collection(json!({ "root": "/abs" })),
        collection(json!({ "root": "../x" })),
        collection(json!({ "root": "a/../b" })),
        collection(json!({ "root": "a\\b" })),
        collection(json!({ "root": "a", "kind": "pdf" })),
        collection(json!({ "root": "a", "include": [""] })),
        collection(json!({ "root": "a", "access": [] })),
        collection(json!({ "root": "a", "access": ["everyone"] })),
        collection(json!({ "root": "a", "access": ["principal:robot:x"] })),
        collection(json!({ "root": "a", "sensitivity": "secret" })),
        collection(json!({ "root": "a", "default_type": "" })),
        collection(json!({ "root": "a", "strict": "yes" })),
        collection(json!({ "root": "a", "max_file_bytes": 0 })),
        collection(json!({ "root": "a", "max_file_bytes": 16_777_217 })),
        collection(json!({ "root": "a", "bogus": 1 })),
        json!({ "config_version": 3, "access": { "bogus": 1 } }),
        json!({ "config_version": 3, "access": { "groups": { "Bad": { "members": [] } } } }),
        json!({ "config_version": 3, "access": { "groups": { "x": {} } } }),
        json!({ "config_version": 3, "access": { "groups": { "x": { "members": ["group:y"] } } } }),
        json!({ "config_version": 3, "access": { "groups": { "x": { "members": ["ada"] } } } }),
        json!({ "config_version": 3, "store": { "lock_timeout_ms": 99 } }),
        json!({ "config_version": 3, "store": { "lock_timeout_ms": 600_001 } }),
        json!({ "config_version": 3, "store": { "bogus": 1 } }),
        json!({ "config_version": 3, "profile": "org" }),
        json!({ "config_version": 3, "plugins": { "enabled": ["x"], "x": { "prefix": "store" } } }),
    ];
    assert_refuses(&validator, "workspace-config.v3", &bad);
}

#[test]
fn the_version_3_config_examples_open_in_the_host_too() {
    let validator = validator("workspace-config.v3");
    let found = examples("workspace-config.v3");
    assert_eq!(found.len(), 3, "minimal, full and reserved");
    for (name, example) in found {
        assert!(validator.is_valid(&example), "{name}");
        ConfigFile::parse(&as_toml(&example))
            .and_then(|file| file.into_config(Path::new("/w/example")))
            .unwrap_or_else(|e| panic!("{name}: {e}"));
    }
    // The older schemas still describe the older files and refuse version 3's keys.
    let v2 = validator_for_config_v2();
    assert!(!v2.is_valid(&example("workspace-config.v3", "full")));
}

fn validator_for_config_v2() -> Validator {
    validator("workspace-config.v2")
}

#[test]
fn the_version_2_manifest_schema_refuses_what_the_host_refuses() {
    let validator = validator("plugin-manifest.v2");
    let base = example("plugin-manifest.v2", "");
    assert!(validator.is_valid(&base));
    let with = |edit: &dyn Fn(&mut Value)| edited(&base, |m| edit(m));
    assert_refuses(
        &validator,
        "plugin-manifest.v2",
        &[
            with(&|m| m["manifest_version"] = json!(1)),
            with(&|m| m["manifest_version"] = json!(3)),
            with(&|m| m["protocol"] = json!(2)),
            with(&|m| m["commands"][0]["effects"] = json!(["inspect", "store-write"])),
            with(&|m| m["commands"][0]["effects"] = json!(["destroy"])),
            // The grants the effects need.
            with(&|m| m["grants"] = json!([{ "name": "documents", "reason": "x" }])),
            with(&|m| m["grants"] = json!([{ "name": "clock", "reason": "x" }])),
            with(&|m| m["grants"] = json!([{ "name": "documents_write", "reason": "x" }])),
            // output_budget.
            with(&|m| m["commands"][0]["output_budget"] = json!({ "default_bytes": 1 })),
            with(&|m| {
                m["commands"][0]["output_budget"] = json!({ "default_bytes": 0, "max_bytes": 1 })
            }),
            with(&|m| {
                m["commands"][0]["output_budget"] =
                    json!({ "default_bytes": 1, "max_bytes": 2, "x": 1 })
            }),
            // confirm.
            with(&|m| m["commands"][1]["confirm"] = json!("always")),
            with(&|m| {
                m["commands"][1]
                    .as_object_mut()
                    .unwrap()
                    .remove("confirm_prompt");
            }),
            with(&|m| m["commands"][1]["expose"]["mcp"] = json!(true)),
            with(&|m| m["commands"][1]["expose"]["agent"] = json!(true)),
            with(&|m| m["commands"][1]["expose"]["cli"] = json!(false)),
            with(&|m| {
                m["commands"][1].as_object_mut().unwrap().remove("expose");
            }),
            // A host domain.
            with(&|m| m["plugin"]["domains"] = json!(["store"])),
        ],
    );
    // A component plugin may not declare an output budget in protocol 1.
    let mut component = example("plugin-manifest.v1", "component");
    component["manifest_version"] = json!(2);
    assert!(validator.is_valid(&component));
    component["commands"][0]["output_budget"] = json!({ "default_bytes": 1, "max_bytes": 2 });
    assert!(!validator.is_valid(&component));
    // A mounted tool holds no grants, so neither new effect fits it.
    let mut mounted = example("plugin-manifest.v1", "mounted");
    mounted["manifest_version"] = json!(2);
    assert!(validator.is_valid(&mounted));
    mounted["mount"]["tools"] = json!([{ "tool": "a", "effects": ["store-write"] }]);
    assert!(!validator.is_valid(&mounted));
    // Version 1 files stay version 1: the version 1 schema refuses what version 2 adds.
    let v1 = self::validator("plugin-manifest.v1");
    assert!(!v1.is_valid(&base));
    assert!(v1.is_valid(&example("plugin-manifest.v1", "")));
}

#[test]
fn the_version_2_manifest_examples_are_manifests_to_the_host_too() {
    let validator = validator("plugin-manifest.v2");
    let found = examples("plugin-manifest.v2");
    assert_eq!(
        found.len(),
        2,
        "a compiled plugin that writes, and a component"
    );
    for (name, example) in found {
        assert!(validator.is_valid(&example), "{name}");
        let manifest =
            Manifest::parse(&as_toml(&example), &name).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(manifest.manifest_version, 2, "{name}");
    }
    let manifest = Manifest::parse(&as_toml(&example("plugin-manifest.v2", "")), "x").unwrap();
    assert!(manifest.commands.iter().any(|c| c.require_human));
    assert!(manifest.commands.iter().any(|c| c.output_budget.is_some()));
}

#[test]
fn version_1_provenance_refuses_the_still_reserved_fields_and_needs_every_field() {
    let validator = validator("provenance-envelope.v1");
    let base = example("provenance-envelope.v1", "");
    assert!(validator.is_valid(&base));
    for field in ["redactions", "delegationChain", "tenant", "bogus"] {
        assert!(
            !validator.is_valid(&edited(&base, |e| e[field] = json!("x"))),
            "version 1 accepted {field}"
        );
    }
    for field in base.as_object().unwrap().keys() {
        assert!(
            !validator.is_valid(&edited(&base, |e| {
                e.as_object_mut().unwrap().remove(field);
            })),
            "version 1 accepted a missing {field}"
        );
    }
    assert_refuses(
        &validator,
        "provenance-envelope.v1",
        &[
            edited(&base, |e| e["version"] = json!(0)),
            edited(&base, |e| e["access"] = json!([])),
            edited(&base, |e| e["access"] = json!(["everyone"])),
            edited(&base, |e| e["access"] = json!(["space", "space"])),
            edited(&base, |e| e["sensitivity"] = json!("secret")),
            edited(&base, |e| e["sensitivity"] = json!(null)),
            edited(&base, |e| e["contentHash"] = json!("sha256:00")),
            edited(&base, |e| e["contentHash"] = json!("md5:abc")),
            edited(&base, |e| e["principal"] = json!("ada")),
            edited(&base, |e| e["principal"] = json!("robot:x")),
            edited(&base, |e| e["plugin"] = json!("Bad")),
            edited(&base, |e| {
                e["sources"] = json!([{ "title": "no resource" }])
            }),
            edited(&base, |e| {
                e["sources"] = json!([{ "resource": "/a", "url": "https://x" }])
            }),
            edited(&base, |e| {
                e["generated"] = json!({ "by": "human:ada", "at": "2026-10-30T09:00:00" })
            }),
            edited(&base, |e| e["generated"] = json!({ "by": "human:ada" })),
            edited(&base, |e| {
                e["derivedFrom"] = json!([{ "kind": "proposal", "id": "p-1" }])
            }),
            edited(&base, |e| e["confidence"] = json!(1.5)),
        ],
    );
    let many: Vec<Value> = (0..65)
        .map(|n| json!({ "resource": format!("/{n}") }))
        .collect();
    assert!(!validator.is_valid(&edited(&base, |e| e["sources"] = Value::Array(many))));
    // Every access token form is accepted.
    for tokens in [
        json!(["space"]),
        json!(["group:platform"]),
        json!(["principal:human:ada", "principal:agent:a:b"]),
    ] {
        assert!(
            validator.is_valid(&edited(&base, |e| e["access"] = tokens.clone())),
            "{tokens}"
        );
    }
    // The other examples: an agent's, and the bare one.
    for case in ["agent", "unspecified"] {
        assert!(
            validator.is_valid(&example("provenance-envelope.v1", case)),
            "{case}"
        );
    }
}

#[test]
fn version_0_and_version_1_events_sit_side_by_side() {
    let v0 = validator("event.v0");
    let v1 = validator("event.v1");
    for case in ["", "minimal"] {
        let old = example("event.v0", case);
        let new = example("event.v1", case);
        assert!(v0.is_valid(&old) && !v1.is_valid(&old), "event v0 {case}");
        assert!(v1.is_valid(&new) && !v0.is_valid(&new), "event v1 {case}");
    }
    let new = example("event.v1", "");
    assert_refuses(
        &v1,
        "event.v1",
        &[
            // A version 1 event carries an envelope version 1, and the reverse is refused.
            edited(&new, |e| {
                e["provenance"] = example("provenance-envelope.v0", "")
            }),
            edited(&new, |e| e["provenance"]["tenant"] = json!("t")),
            edited(&new, |e| e["changes"] = json!({ "fromRev": 1, "toRev": 2 })),
            edited(&new, |e| {
                e["changes"] = json!({ "fromRev": 0, "toRev": 2, "count": 1 })
            }),
            edited(&new, |e| {
                e["changes"] = json!({ "fromRev": 1, "toRev": 2, "count": 1, "x": 1 })
            }),
        ],
    );
    assert!(v1.is_valid(&edited(&new, |e| {
        e.as_object_mut().unwrap().remove("changes");
    })));
    let old = example("event.v0", "");
    assert!(!v0.is_valid(&edited(&old, |e| e["changes"] =
        json!({ "fromRev": 1, "toRev": 1, "count": 1 }))));
}

#[test]
fn the_host_reads_and_writes_the_examples_it_documents() {
    // Round trip through the host's types: nothing is added, dropped or renamed.
    for case in ["", "agent", "unspecified"] {
        let value = example("provenance-envelope.v1", case);
        let envelope: Envelope = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(envelope.version, 1);
        assert_eq!(
            serde_json::to_value(&envelope).unwrap(),
            value,
            "envelope v1 {case}"
        );
    }
    for case in ["", "unspecified"] {
        let value = example("provenance-envelope.v0", case);
        let envelope: Envelope = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(envelope.version, 0);
        assert_eq!(
            serde_json::to_value(&envelope).unwrap(),
            value,
            "envelope v0 {case}"
        );
    }
    for stem in ["event.v0", "event.v1"] {
        for case in ["", "minimal"] {
            let value = example(stem, case);
            let event: Event = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(
                serde_json::to_value(&event).unwrap(),
                value,
                "{stem} {case}"
            );
        }
    }
    let event: Event = serde_json::from_value(example("event.v1", "")).unwrap();
    assert_eq!(event.changes.unwrap().count, 38);
}

#[test]
fn the_document_locator_and_proposal_schemas_refuse_what_the_specification_refuses() {
    let document = validator("document.v1");
    let base = example("document.v1", "");
    assert!(document.is_valid(&base));
    assert!(document.is_valid(&example("document.v1", "code")));
    for field in base.as_object().unwrap().keys() {
        let required = document.is_valid(&edited(&base, |d| {
            d.as_object_mut().unwrap().remove(field);
        }));
        assert!(!required, "document.v1 accepted a missing {field}");
    }
    assert_refuses(
        &document,
        "document.v1",
        &[
            edited(&base, |d| d["version"] = json!(2)),
            edited(&base, |d| d["id"] = json!("no-slash")),
            edited(&base, |d| d["status"] = json!("archived")),
            edited(&base, |d| d["verification"]["tier"] = json!("admin")),
            edited(&base, |d| {
                d["verification"]["last"] = json!({ "by": "human:ada" })
            }),
            edited(&base, |d| d["flags"] = json!(["spooky"])),
            edited(&base, |d| {
                d["flags"] = json!(["hidden-text", "hidden-text"])
            }),
            edited(&base, |d| d["access"] = json!([])),
            edited(&base, |d| d["envelope"]["version"] = json!(0)),
            edited(&base, |d| d["bogus"] = json!(1)),
            edited(&base, |d| d["size"] = json!(-1)),
        ],
    );

    let locator = validator("locator.v1");
    let base = example("locator.v1", "");
    assert!(locator.is_valid(&base));
    assert_refuses(
        &locator,
        "locator.v1",
        &[
            edited(&base, |l| l["version"] = json!(2)),
            edited(&base, |l| l["lines"] = json!({ "start": 0, "end": 3 })),
            edited(&base, |l| l["lines"] = json!({ "start": 1 })),
            edited(&base, |l| l["indexVersion"] = json!("main@1842")),
            edited(&base, |l| l["indexVersion"] = json!("1842/1")),
            edited(&base, |l| l["contentHash"] = json!("9f2c")),
            edited(&base, |l| {
                l.as_object_mut().unwrap().remove("headingPath");
            }),
            edited(&base, |l| l["bogus"] = json!(1)),
        ],
    );

    let proposal = validator("proposal.v1");
    let base = example("proposal.v1", "");
    assert!(proposal.is_valid(&base));
    assert!(proposal.is_valid(&example("proposal.v1", "applied")));
    for field in base.as_object().unwrap().keys() {
        assert!(
            !proposal.is_valid(&edited(&base, |p| {
                p.as_object_mut().unwrap().remove(field);
            })),
            "proposal.v1 accepted a missing {field}"
        );
    }
    let evidence: Vec<Value> = (0..33)
        .map(|n| json!({ "kind": "text", "ref": format!("e{n}") }))
        .collect();
    assert_refuses(
        &proposal,
        "proposal.v1",
        &[
            edited(&base, |p| p["id"] = json!("p-xyz")),
            edited(&base, |p| p["state"] = json!("merged")),
            edited(&base, |p| p["change"]["op"] = json!("delete")),
            // create has no base hash, every other op has one, and update/create carry content.
            edited(&base, |p| p["change"]["baseHash"] = json!(null)),
            edited(&base, |p| {
                p["change"].as_object_mut().unwrap().remove("content");
            }),
            edited(&base, |p| p["rationale"] = json!("")),
            edited(&base, |p| p["rationale"] = json!("x".repeat(4001))),
            edited(&base, |p| p["evidence"] = json!([])),
            edited(&base, |p| p["evidence"] = Value::Array(evidence.clone())),
            edited(&base, |p| p["evidence"][0]["kind"] = json!("rumour")),
            edited(&base, |p| {
                p["evidence"][0]["excerpt"] = json!("x".repeat(1001))
            }),
            edited(&base, |p| p["policy"]["rule"] = json!("curator")),
            edited(&base, |p| p["exception"] = json!("override")),
            edited(&base, |p| p["confidence"] = json!(2)),
            edited(&base, |p| p["proposer"]["principal"] = json!("ada")),
            edited(&base, |p| {
                p["decision"] = json!({ "by": { "kind": "human" } })
            }),
            edited(&base, |p| p["result"] = json!({ "rev": 1 })),
            edited(&base, |p| p["provenance"]["version"] = json!(0)),
        ],
    );
    let create = example("proposal.v1", "applied");
    assert!(
        !proposal.is_valid(&edited(&create, |p| p["change"]["baseHash"] =
            json!("sha256:".to_owned() + &"0".repeat(64))))
    );
}

#[test]
fn the_eval_schemas_refuse_what_the_specification_refuses() {
    let queries = validator("eval-queries.v1");
    let base = example("eval-queries.v1", "");
    assert!(queries.is_valid(&base));
    assert!(queries.is_valid(&example("eval-queries.v1", "unanswerable")));
    for field in base.as_object().unwrap().keys() {
        assert!(
            !queries.is_valid(&edited(&base, |q| {
                q.as_object_mut().unwrap().remove(field);
            })),
            "eval-queries.v1 accepted a missing {field}"
        );
    }
    assert_refuses(
        &queries,
        "eval-queries.v1",
        &[
            edited(&base, |q| q["id"] = json!("q-1")),
            edited(&base, |q| q["kind"] = json!("fuzzy")),
            edited(&base, |q| q["query"] = json!("")),
            edited(&base, |q| q["spaces"] = json!([])),
            edited(&base, |q| q["spaces"] = json!(["alpha", "alpha"])),
            edited(&base, |q| q["principal"] = json!("eval-reader")),
            edited(&base, |q| q["filters"] = json!({ "bogus": 1 })),
            edited(&base, |q| q["qrels"] = json!({ "no-space-prefix": 2 })),
            edited(&base, |q| q["qrels"] = json!({ "alpha:handbook/x": 3 })),
            edited(&base, |q| q["qrels"] = json!({ "alpha:handbook/x": 0 })),
            // Unanswerable means no qrels, and only that kind is unanswerable.
            edited(&base, |q| q["unanswerable"] = json!(true)),
            edited(&base, |q| {
                q["kind"] = json!("unanswerable");
                q["unanswerable"] = json!(true);
            }),
            edited(&base, |q| q["kind"] = json!("unanswerable")),
        ],
    );

    let report = validator("eval-report.v1");
    let base = example("eval-report.v1", "");
    assert!(report.is_valid(&base));
    for field in base.as_object().unwrap().keys() {
        assert!(
            !report.is_valid(&edited(&base, |r| {
                r.as_object_mut().unwrap().remove(field);
            })),
            "eval-report.v1 accepted a missing {field}"
        );
    }
    assert_refuses(
        &report,
        "eval-report.v1",
        &[
            edited(&base, |r| r["k"] = json!(0)),
            edited(&base, |r| r["leaks"] = json!(-1)),
            edited(&base, |r| r["metrics"]["overall"] = json!({})),
            edited(&base, |r| {
                r["metrics"]["overall"]["on"]["recall"] = json!(1.2)
            }),
            edited(&base, |r| {
                r["metrics"]["byKind"] = json!({ "permission": {} })
            }),
            edited(&base, |r| r["unanswerable"]["emptyRate"] = json!(2)),
            edited(&base, |r| r["results"][0]["kind"] = json!("fuzzy")),
            edited(&base, |r| r["results"][0]["runs"] = json!({ "both": [] })),
            edited(&base, |r| {
                r["results"][0]["runs"]["on"][0] = json!({ "space": "alpha" })
            }),
            edited(&base, |r| r["corpusDigest"] = json!("abc")),
            edited(&base, |r| r["bogus"] = json!(1)),
        ],
    );
}
