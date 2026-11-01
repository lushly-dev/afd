//! The nine versioned schema files under `schemas/` (phase 0 specification sections 7 and 10;
//! phase 1 sections 2, 8.2 and 9.1) and the WIT world.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use jsonschema::{Retrieve, Uri, Validator};
use serde_json::{Value, json};
use umbel::plugins::{Manifest, PackManifest};
use umbel::workspace::ConfigFile;

const STEMS: [&str; 9] = [
    "workspace-config.v1",
    "workspace-config.v2",
    "plugin-manifest.v1",
    "pack-manifest.v1",
    "principal.v0",
    "provenance-envelope.v0",
    "event.v0",
    "cursor.v0",
    "cursor-file.v0",
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
