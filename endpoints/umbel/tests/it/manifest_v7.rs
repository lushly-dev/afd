//! The plugin manifest, version 7 (phase 1 specification, section 8.7; D211): the top-level
//! `instructions`, its rules (compiled plugins only), versions 1 to 6 refusing it, version 7
//! keeping version 6's keys, and the schema file accepting and refusing the same manifests. What
//! the host serves from it is in `plugin_instructions.rs`.
use std::path::Path;

use jsonschema::Validator;
use serde_json::Value;
use umbel::plugins::{MAX_INSTRUCTIONS_CHARS, Manifest, PluginError};

const FILE: &str = "umbel-plugin.toml";
const PARAGRAPH: &str =
    "This instance keeps garden notes. Save what the person says about a bed with notes-capture.";

/// A manifest of `version` for a plugin of `kind`, with `top` among the top-level keys.
fn head(version: u32, kind: &str, top: &str) -> String {
    let (domains, extra) = match kind {
        "component" => (
            "domains = [\"notes\"]\n",
            "\n[component]\npath = \"notes.wasm\"\n",
        ),
        "mounted" => (
            "domains = [\"notes\"]\n",
            "\n[mount]\nprefix = \"notes\"\ntransport = \"stdio\"\ncommand = [\"notes-server\"]\n",
        ),
        "pack" => ("", ""),
        _ => ("domains = [\"notes\"]\n", ""),
    };
    format!(
        "manifest_version = {version}\nprotocol = 1\n{top}\n[plugin]\nid = \"notes\"\ntitle = \"Garden notes\"\nversion = \"0.1.0\"\ndescription = \"Short notes about a garden.\"\nkind = \"{kind}\"\n{domains}{extra}"
    )
}

/// `instructions = <value>` as a top-level line, `value` already TOML.
fn with(value: &str) -> String {
    format!("instructions = {value}\n")
}

/// A version 7 compiled plugin whose `instructions` is the TOML `value`.
fn v7(value: &str) -> String {
    head(7, "compiled", &with(value))
}

fn quoted(text: &str) -> String {
    toml::Value::String(text.to_owned()).to_string()
}

fn parse(text: &str) -> Result<Manifest, PluginError> {
    Manifest::parse(text, FILE)
}

/// The refusal of `text`: `PLUGIN_MANIFEST_INVALID` naming `instructions` and holding `problem`.
#[track_caller]
fn invalid(text: &str, problem: &str) -> PluginError {
    let error = parse(text).expect_err(text);
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID", "{text}: {error}");
    assert!(
        error.message().contains("`instructions`"),
        "{text}: {error} does not name `instructions`"
    );
    assert!(
        error.message().contains(problem),
        "{error} does not say: {problem}"
    );
    assert!(!error.suggestion().is_empty(), "{error}");
    error
}

#[test]
fn a_compiled_plugins_paragraph_is_read_as_written() {
    let manifest = parse(&v7(&quoted(PARAGRAPH))).unwrap();
    assert_eq!(manifest.manifest_version, 7);
    assert_eq!(manifest.instructions.as_deref(), Some(PARAGRAPH));
    // Absent, there is none; a version 6 manifest never has one.
    assert!(
        parse(&head(7, "compiled", ""))
            .unwrap()
            .instructions
            .is_none()
    );
    assert!(
        parse(&head(6, "compiled", ""))
            .unwrap()
            .instructions
            .is_none()
    );
    // The cap counts characters, not bytes.
    let at_cap = "é".repeat(MAX_INSTRUCTIONS_CHARS);
    assert_eq!(
        parse(&v7(&quoted(&at_cap)))
            .unwrap()
            .instructions
            .as_deref(),
        Some(at_cap.as_str())
    );
}

#[test]
fn only_a_compiled_plugin_declares_a_paragraph() {
    for kind in ["component", "mounted", "pack"] {
        let error = invalid(
            &head(7, kind, &with(&quoted(PARAGRAPH))),
            &format!("is for compiled plugins only: a {kind} plugin's text does not reach"),
        );
        assert!(error.message().contains("mcp.instructions"), "{error}");
        // Without the key, a version 7 plugin of that kind reads as before.
        assert!(parse(&head(7, kind, "")).unwrap().instructions.is_none());
    }
}

#[test]
fn a_paragraph_is_1_to_800_characters_on_one_line() {
    assert_eq!(MAX_INSTRUCTIONS_CHARS, 800);
    let rule = "must be 1 to 800 characters without control characters";
    invalid(&v7("\"\""), rule);
    invalid(&v7(&quoted(&"a".repeat(MAX_INSTRUCTIONS_CHARS + 1))), rule);
    for control in ["\\n", "\\r", "\\t", "\\u0000", "\\u007f", "\\u0085"] {
        invalid(&v7(&format!("\"One line.{control}Another.\"")), rule);
    }
    invalid(&v7("[\"One.\", \"Two.\"]"), "must be a string");
    invalid(&v7("{ text = \"One.\" }"), "must be a string");
}

#[test]
fn versions_1_to_6_name_and_refuse_the_key() {
    for version in 1..=6 {
        let error = invalid(
            &head(version, "compiled", &with(&quoted(PARAGRAPH))),
            "is reserved (a plugin's instructions paragraph needs manifest_version = 7)",
        );
        assert!(
            error
                .message()
                .contains(&format!("manifest version {version} does not define it")),
            "{error}"
        );
    }
}

#[test]
fn version_7_keeps_every_earlier_key_and_reservation() {
    assert_eq!(umbel::MANIFEST_VERSION, 7);
    assert_eq!(umbel::MANIFEST_VERSIONS, [1, 2, 3, 4, 5, 6, 7]);
    let error = parse(&head(8, "compiled", "")).unwrap_err();
    assert_eq!(error.code(), "PLUGIN_PROTOCOL_UNSUPPORTED");
    assert!(
        error.suggestion().contains("manifest versions 1 to 7"),
        "{error}"
    );
    // Version 6's records, in a version 7 manifest.
    let records = format!(
        "{}\n[[grants]]\nname = \"records\"\nreason = \"Reads.\"\n\n[[grants]]\nname = \"records_write\"\nreason = \"Writes.\"\n\n[[records]]\nkind = \"note\"\nkeys = [\"/bed\"]\n",
        v7(&quoted(PARAGRAPH))
    );
    assert_eq!(parse(&records).unwrap().records.len(), 1);
    // The reserved keys stay reserved, and an unknown key is unknown.
    let error = parse(&head(7, "compiled", "ui = {}\n")).unwrap_err();
    assert!(
        error
            .message()
            .contains("manifest version 7 does not define it"),
        "{error}"
    );
    let error = parse(&head(7, "compiled", "instruction = \"One.\"\n")).unwrap_err();
    assert!(error.message().contains("is not a known key"), "{error}");
}

// ── The schema file ────────────────────────────────────────────────────────────────────────────

fn schemas_dir() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("schemas")
}

fn read(path: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap())
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

fn validator() -> Validator {
    let schema = read(&schemas_dir().join("plugin-manifest.v7.json"));
    jsonschema::meta::validate(&schema).unwrap();
    jsonschema::validator_for(&schema).unwrap()
}

fn as_json(text: &str) -> Value {
    serde_json::to_value(text.parse::<toml::Table>().unwrap()).unwrap()
}

fn as_toml(instance: &Value) -> String {
    toml::to_string(&toml::Value::try_from(instance).unwrap()).unwrap()
}

#[test]
fn the_schema_accepts_and_refuses_the_same_manifests() {
    let validator = validator();
    let accepted = [
        v7(&quoted(PARAGRAPH)),
        v7(&quoted(&"a".repeat(MAX_INSTRUCTIONS_CHARS))),
        v7(&quoted(&"é".repeat(MAX_INSTRUCTIONS_CHARS))),
        head(7, "compiled", ""),
        head(7, "component", ""),
        head(7, "mounted", ""),
        head(7, "pack", ""),
    ];
    for text in &accepted {
        if let Err(error) = validator.validate(&as_json(text)) {
            panic!("the schema refused {text}: {error}");
        }
        if let Err(error) = parse(text) {
            panic!("the host refused {text}: {error}");
        }
    }
    let refused = [
        head(6, "compiled", &with(&quoted(PARAGRAPH))),
        v7("\"\""),
        v7(&quoted(&"a".repeat(MAX_INSTRUCTIONS_CHARS + 1))),
        v7("\"One line.\\nAnother.\""),
        v7("\"Tab\\tseparated.\""),
        v7("\"Bell\\u0007.\""),
        v7("\"Next line\\u0085.\""),
        v7("[\"One.\"]"),
        v7("42"),
        head(7, "component", &with(&quoted(PARAGRAPH))),
        head(7, "mounted", &with(&quoted(PARAGRAPH))),
        head(7, "pack", &with(&quoted(PARAGRAPH))),
    ];
    for text in &refused {
        assert!(
            !validator.is_valid(&as_json(text)),
            "the schema accepted {text}"
        );
        assert!(parse(text).is_err(), "the host accepted {text}");
    }
}

#[test]
fn the_version_7_examples_validate_and_load() {
    let validator = validator();
    let example = |name: &str| read(&schemas_dir().join("examples").join(name));
    let declared = example("plugin-manifest.v7.json");
    validator.validate(&declared).unwrap();
    let manifest = parse(&as_toml(&declared)).unwrap();
    assert_eq!(manifest.manifest_version, 7);
    assert_eq!(
        manifest.instructions.as_deref(),
        declared["instructions"].as_str()
    );
    assert_eq!(manifest.records.len(), 2, "version 6's keys are kept");

    let defaults = example("plugin-manifest.v7.defaults.json");
    validator.validate(&defaults).unwrap();
    assert!(parse(&as_toml(&defaults)).unwrap().instructions.is_none());

    // The version 6 schema refuses version 7's example, and version 7's a version 6 manifest.
    let v6 =
        jsonschema::validator_for(&read(&schemas_dir().join("plugin-manifest.v6.json"))).unwrap();
    assert!(!v6.is_valid(&declared));
    assert!(!validator.is_valid(&example("plugin-manifest.v6.json")));
    // A version 6 manifest lifted to version 7 is a version 7 manifest: nothing was taken away.
    let mut lifted = example("plugin-manifest.v6.json");
    lifted["manifest_version"] = serde_json::json!(7);
    validator.validate(&lifted).unwrap();
    parse(&as_toml(&lifted)).unwrap();
}
