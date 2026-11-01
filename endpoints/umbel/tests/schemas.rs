//! The six versioned schema files under `schemas/` (specification sections 7 and 10).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use jsonschema::{Retrieve, Uri, Validator};
use serde_json::{Value, json};
use umbel::workspace::ConfigFile;

const STEMS: [&str; 6] = [
    "workspace-config.v1",
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
