//! The plugin manifest, version 6 (records host specification, section 2; D159): the top-level
//! `[[records]]`, each key's rule, the five rules a declaration brings and their messages,
//! versions 1 to 5 refusing the key, a version 6 plugin loading, and the schema file accepting
//! and refusing the same manifests. What acts on a declaration is that specification's later
//! steps: until then a declared kind is written and read as an undeclared one.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::Path;

use jsonschema::Validator;
use serde_json::Value;
use support::plugins::{Raw, closure, config, seal};
use umbel::plugins::{Manifest, PluginError};
use umbel_store::lane::{Pointer, RecordDecl};

const FILE: &str = "umbel-plugin.toml";
const GRANTS: &str = "\n[[grants]]\nname = \"records\"\nreason = \"Reads the notes.\"\n\n[[grants]]\nname = \"records_write\"\nreason = \"Writes the notes.\"\n";
/// Section 2's own example.
const NOTE: &str = "\n[[records]]\nkind = \"note\"\nstanding = true\ntext = [\"/statement\"]\nkeys = [\"/bed\", \"/tags\", \"/source\"]\nmatch = \"/statement\"\n";
const JOURNAL: &str = "journal = { mode = \"digest\" }";

/// A manifest head of `version` for a plugin of `kind`, with `grants` appended.
fn head(version: u32, kind: &str, grants: &str) -> String {
    head_with(version, kind, grants, "")
}

/// [`head`] with `top` among the top-level keys, before the first table.
fn head_with(version: u32, kind: &str, grants: &str, top: &str) -> String {
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
        "manifest_version = {version}\nprotocol = 1\n{top}\n[plugin]\nid = \"notes\"\ntitle = \"Garden notes\"\nversion = \"0.1.0\"\ndescription = \"Short notes about a garden.\"\nkind = \"{kind}\"\n{domains}{extra}{grants}"
    )
}

/// A version 6 compiled plugin holding both record grants, with `body` appended.
fn v6(body: &str) -> String {
    format!("{}{body}", head(6, "compiled", GRANTS))
}

/// One `[[records]]` entry with `keys` as its table.
fn entry(keys: &str) -> String {
    format!("\n[[records]]\n{keys}\n")
}

/// A command `notes-<name>` with `keys` appended to its table.
fn command(name: &str, effects: &str, keys: &str) -> String {
    format!(
        "\n[[commands]]\nname = \"notes-{name}\"\ndescription = \"Do {name}.\"\neffects = [{effects}]\ninput_schema = {{ type = \"object\", properties = {{ space = {{ type = \"string\" }} }} }}\n{keys}\n"
    )
}

/// A pipeline `notes-<name>` over `step`, with `keys` appended.
fn pipeline(name: &str, step: &str, keys: &str) -> String {
    format!(
        "\n[[pipelines]]\nname = \"notes-{name}\"\ndescription = \"Run it.\"\neffects = [\"inspect\"]\ninput_schema = {{ type = \"object\" }}\n{keys}\n[[pipelines.steps]]\ncommand = \"{step}\"\n"
    )
}

fn parse(text: &str) -> Result<Manifest, PluginError> {
    Manifest::parse(text, FILE)
}

/// The refusal of `text`, which must be `PLUGIN_MANIFEST_INVALID` naming `key` in backticks and
/// holding `problem`.
#[track_caller]
fn invalid(text: &str, key: &str, problem: &str) -> PluginError {
    let error = parse(text).expect_err(text);
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID", "{text}: {error}");
    assert!(
        error.message().contains(&format!("`{key}`")),
        "{text}: {error} does not name `{key}`"
    );
    assert!(
        error.message().contains(problem),
        "{error} does not say: {problem}"
    );
    error
}

fn pointer(text: &str) -> Pointer {
    Pointer::parse(text).unwrap()
}

// ── The declaration ────────────────────────────────────────────────────────────────────────────

#[test]
fn records_are_parsed_into_declarations() {
    let manifest = parse(&v6(&format!(
        "{NOTE}{}",
        entry("kind = \"bed\"\nkeys = [\"/aspect\"]")
    )))
    .unwrap();
    assert_eq!(manifest.manifest_version, 6);
    assert_eq!(
        manifest.records,
        [
            RecordDecl {
                kind: "note".to_owned(),
                standing: true,
                text: vec![pointer("/statement")],
                keys: vec![pointer("/bed"), pointer("/tags"), pointer("/source")],
                matched: Some(0),
            },
            // `standing` defaults to false, and `text`, `keys` and `match` to none.
            RecordDecl {
                kind: "bed".to_owned(),
                standing: false,
                text: Vec::new(),
                keys: vec![pointer("/aspect")],
                matched: None,
            },
        ]
    );
    for declared in &manifest.records {
        declared.check().unwrap();
    }
    // The match field is an index into `text`, whichever pointer it names.
    let second = parse(&v6(&entry(
        "kind = \"note\"\ntext = [\"/title\", \"/detail/why\"]\nmatch = \"/detail/why\"",
    )))
    .unwrap();
    assert_eq!(second.records[0].matched, Some(1));
    assert_eq!(
        second.records[0].match_pointer().unwrap().as_str(),
        "/detail/why"
    );
    assert!(!second.records[0].standing);
}

#[test]
fn a_manifest_without_records_declares_none_in_every_version() {
    for version in 1..=6 {
        let manifest = parse(&head(version, "compiled", "")).unwrap();
        assert!(manifest.records.is_empty(), "{version}");
    }
    // An empty list declares nothing, so none of a declaration's rules applies: no grant, no
    // journal, and any kind of plugin.
    let empty = parse(&format!(
        "{}{}",
        head_with(6, "compiled", "", "records = []\n"),
        command("list", "\"inspect\"", "")
    ))
    .unwrap();
    assert!(empty.records.is_empty());
    assert!(empty.commands[0].journal.is_none());
    parse(&head_with(6, "pack", "", "records = []\n")).unwrap();
}

#[test]
fn each_key_follows_its_rule() {
    let bad = |keys: &str, key: &str, problem: &str| {
        invalid(&v6(&entry(keys)), &format!("records[0].{key}"), problem);
    };
    // kind
    bad("text = [\"/statement\"]", "kind", "is required");
    bad(
        "kind = 3\ntext = [\"/statement\"]",
        "kind",
        "must be a string",
    );
    for kind in ["Note", "9note", "note_one", "", &"n".repeat(64)] {
        bad(
            &format!("kind = \"{kind}\"\ntext = [\"/statement\"]"),
            "kind",
            "must match ^[a-z][a-z0-9-]{0,62}$",
        );
    }
    parse(&v6(&entry(&format!(
        "kind = \"{}\"\ntext = [\"/statement\"]",
        "n".repeat(63)
    ))))
    .unwrap();
    invalid(
        &v6(&format!(
            "{NOTE}{}",
            entry("kind = \"note\"\nkeys = [\"/bed\"]")
        )),
        "records[1].kind",
        "`note` is declared twice",
    );
    // standing
    bad(
        "kind = \"note\"\nstanding = \"yes\"\ntext = [\"/statement\"]",
        "standing",
        "must be true or false",
    );
    bad(
        "kind = \"note\"\nstanding = true\nkeys = [\"/bed\"]",
        "standing",
        "needs at least one text pointer",
    );
    bad(
        "kind = \"note\"\nstanding = true",
        "standing",
        "needs at least one text pointer",
    );
    // text: 0 to 4, distinct
    bad(
        "kind = \"note\"\ntext = \"/statement\"",
        "text",
        "must be an array of strings",
    );
    bad(
        "kind = \"note\"\ntext = [\"/a\", \"/b\", \"/c\", \"/d\", \"/e\"]",
        "text",
        "names 5 pointers; at most 4",
    );
    parse(&v6(&entry(
        "kind = \"note\"\ntext = [\"/a\", \"/b\", \"/c\", \"/d\"]",
    )))
    .unwrap();
    bad(
        "kind = \"note\"\ntext = [\"/a\", \"/b\", \"/a\"]",
        "text",
        "names `/a` twice",
    );
    // keys: 0 to 16, distinct, none also in text
    let many = |count: usize| {
        (0..count)
            .map(|index| format!("\"/k{index}\""))
            .collect::<Vec<_>>()
            .join(", ")
    };
    bad(
        &format!("kind = \"note\"\nkeys = [{}]", many(17)),
        "keys",
        "names 17 pointers; at most 16",
    );
    parse(&v6(&entry(&format!(
        "kind = \"note\"\nkeys = [{}]",
        many(16)
    ))))
    .unwrap();
    bad(
        "kind = \"note\"\nkeys = [\"/bed\", \"/bed\"]",
        "keys",
        "names `/bed` twice",
    );
    bad(
        "kind = \"note\"\ntext = [\"/statement\"]\nkeys = [\"/bed\", \"/statement\"]",
        "keys",
        "names `/statement`, which is a text pointer",
    );
    // match: one of text
    bad(
        "kind = \"note\"\ntext = [\"/statement\"]\nmatch = [\"/statement\"]",
        "match",
        "must be a string",
    );
    bad(
        "kind = \"note\"\ntext = [\"/statement\"]\nmatch = \"/title\"",
        "match",
        "names `/title`, which must be one of text",
    );
    bad(
        "kind = \"note\"\ntext = [\"/statement\"]\nkeys = [\"/bed\"]\nmatch = \"/bed\"",
        "match",
        "must be one of text",
    );
    bad(
        "kind = \"note\"\nkeys = [\"/bed\"]\nmatch = \"/statement\"",
        "match",
        "must be one of text",
    );
    // No other key.
    bad(
        "kind = \"note\"\ntext = [\"/statement\"]\nindex = \"words\"",
        "index",
        "is not a known key",
    );
    // At most 16 entries.
    let entries = |count: usize| -> String {
        (0..count)
            .map(|index| entry(&format!("kind = \"k{index}\"\nkeys = [\"/bed\"]")))
            .collect()
    };
    assert_eq!(parse(&v6(&entries(16))).unwrap().records.len(), 16);
    invalid(
        &v6(&entries(17)),
        "records",
        "declares 17 kinds; a manifest declares at most 16",
    );
    invalid(
        &head_with(6, "compiled", GRANTS, "records = \"note\"\n"),
        "records",
        "must be an array of tables",
    );
}

#[test]
fn a_pointer_names_one_to_four_object_members() {
    for good in [
        "/statement",
        "/_private",
        "/detail/why",
        "/a/b/c/d",
        "/Statement_2",
    ] {
        let manifest = parse(&v6(&entry(&format!(
            "kind = \"note\"\ntext = [\"{good}\"]\nmatch = \"{good}\""
        ))))
        .unwrap();
        assert_eq!(manifest.records[0].text[0].as_str(), good);
    }
    let longest = format!("/{}", "a".repeat(64));
    parse(&v6(&entry(&format!(
        "kind = \"note\"\nkeys = [\"{longest}\"]"
    ))))
    .unwrap();
    let too_long_member = format!("/{}", "a".repeat(65));
    // Two members of 64 bytes make 130 bytes with their slashes, past the whole's 128.
    let too_long = format!("/{0}/{0}", "a".repeat(64));
    for bad in [
        "statement",
        "/",
        "/statement/",
        "//statement",
        "/a/b/c/d/e",
        "/tags/0",
        "/0",
        "/a-b",
        "/a~1b",
        "/a b",
        "#/statement",
        too_long_member.as_str(),
        too_long.as_str(),
    ] {
        for key in ["text", "keys"] {
            let error = invalid(
                &v6(&entry(&format!("kind = \"note\"\n{key} = [\"{bad}\"]"))),
                &format!("records[0].{key}"),
                "must be a pointer: / followed by 1 to 4 member names joined by /",
            );
            assert!(error.message().contains("at most 128 bytes"), "{error}");
        }
        invalid(
            &v6(&entry(&format!(
                "kind = \"note\"\ntext = [\"/statement\"]\nmatch = \"{bad}\""
            ))),
            "records[0].match",
            "must be a pointer",
        );
    }
    invalid(
        &v6(&entry("kind = \"note\"\ntext = [\"\"]")),
        "records[0].text",
        "must hold only non-empty strings",
    );
}

// ── The five rules a declaration brings, each with its message ────────────────────────────────

#[test]
fn versions_1_to_5_refuse_records() {
    for version in 1..=5 {
        let error = invalid(
            &format!("{}{NOTE}", head(version, "compiled", GRANTS)),
            "records",
            "is reserved (a declared record kind needs manifest_version = 6)",
        );
        assert!(
            error
                .message()
                .contains(&format!("manifest version {version} does not define it")),
            "{error}"
        );
        // An empty list is the key all the same.
        invalid(
            &head_with(version, "compiled", "", "records = []\n"),
            "records",
            "is reserved (a declared record kind needs manifest_version = 6)",
        );
    }
}

#[test]
fn only_a_compiled_plugin_declares_a_kind() {
    const WHY: &str = "is for compiled plugins only in protocol 1: a declared kind's standing rests on the plugin's code running in the host's process (D162)";
    // A component may hold grants, so it reaches the rule with both declared.
    invalid(
        &format!("{}{NOTE}", head(6, "component", GRANTS)),
        "records",
        WHY,
    );
    // A mounted server and a pack hold no grant at all.
    for kind in ["mounted", "pack"] {
        invalid(&format!("{}{NOTE}", head(6, kind, "")), "records", WHY);
        // Without a declaration each still parses.
        parse(&head(6, kind, "")).unwrap();
    }
    parse(&head(6, "component", GRANTS)).unwrap();
}

#[test]
fn a_declaration_needs_both_record_grants() {
    const WHY: &str = "needs the grants records and records_write declared in [[grants]]";
    let grant = |name: &str| format!("\n[[grants]]\nname = \"{name}\"\nreason = \"Needs it.\"\n");
    for grants in [
        String::new(),
        grant("records"),
        grant("records_write"),
        format!("{}{}", grant("documents"), grant("documents_write")),
    ] {
        invalid(
            &format!("{}{NOTE}", head(6, "compiled", &grants)),
            "records",
            WHY,
        );
    }
    // Declared is enough here, optional or not: what the deployer allows is checked at load.
    let optional = format!(
        "{}{}",
        grant("records").replace("reason", "required = false\nreason"),
        grant("records_write")
    );
    parse(&format!("{}{NOTE}", head(6, "compiled", &optional))).unwrap();
}

#[test]
fn an_entry_declares_text_keys_or_standing() {
    const WHY: &str = "declares nothing: give text, keys or standing";
    for keys in [
        "kind = \"note\"",
        "kind = \"note\"\nstanding = false",
        "kind = \"note\"\ntext = []\nkeys = []",
    ] {
        let error = invalid(&v6(&entry(keys)), "records[0]", WHY);
        // The entry itself is named, and no key of it.
        assert!(!error.message().contains("records[0]."), "{error}");
    }
    invalid(
        &v6(&format!("{NOTE}{}", entry("kind = \"bed\""))),
        "records[1]",
        WHY,
    );
    // Text alone, and keys alone, declare something.
    parse(&v6(&entry("kind = \"note\"\ntext = [\"/statement\"]"))).unwrap();
    parse(&v6(&entry("kind = \"note\"\nkeys = [\"/bed\"]"))).unwrap();
}

#[test]
fn a_plugin_that_declares_a_kind_journals_every_command_and_pipeline() {
    const WHY: &str = "is required: a plugin that declares a record kind declares journal = { mode = \"digest\" } or { mode = \"plain\" } on every command and pipeline";
    invalid(
        &v6(&format!(
            "{NOTE}{}{}",
            command("capture", "\"store-write\"", JOURNAL),
            command("find", "\"inspect\"", "")
        )),
        "commands[1].journal",
        WHY,
    );
    invalid(
        &v6(&format!(
            "{NOTE}{}{}",
            command("find", "\"inspect\"", JOURNAL),
            pipeline("lookup", "notes-find", "")
        )),
        "pipelines[0].journal",
        WHY,
    );
    // Either mode satisfies the rule: which one a command that carries text takes is the
    // plugin's.
    let manifest = parse(&v6(&format!(
        "{NOTE}{}{}{}",
        command("capture", "\"store-write\"", JOURNAL),
        command("find", "\"inspect\"", "journal = { mode = \"plain\" }"),
        pipeline("lookup", "notes-find", JOURNAL)
    )))
    .unwrap();
    assert_eq!(manifest.records.len(), 1);
    // Without a declaration a version 6 plugin's commands need none, as before.
    let plain = parse(&v6(&format!(
        "{}{}",
        command("find", "\"inspect\"", ""),
        pipeline("lookup", "notes-find", "")
    )))
    .unwrap();
    assert!(plain.commands[0].journal.is_none());
}

// ── Versions ───────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_host_reads_manifest_versions_1_to_6() {
    assert_eq!(umbel::MANIFEST_VERSION, 6);
    assert_eq!(umbel::MANIFEST_VERSIONS, [1, 2, 3, 4, 5, 6]);
    for version in umbel::MANIFEST_VERSIONS {
        assert!(
            schemas_dir()
                .join(format!("plugin-manifest.v{version}.json"))
                .is_file(),
            "{version}"
        );
    }
    for other in [0, 7] {
        let error = parse(&head(other, "compiled", "")).unwrap_err();
        assert_eq!(error.code(), "PLUGIN_PROTOCOL_UNSUPPORTED", "{other}");
        assert!(
            error.suggestion().contains("manifest versions 1 to 6"),
            "{error}"
        );
    }
    // Version 6 keeps every earlier key and reservation.
    let error = invalid(
        &v6(&command("find", "\"inspect\"", "scopes = [\"umbel:read\"]")),
        "commands[0].scopes",
        "is reserved",
    );
    assert!(
        error
            .message()
            .contains("manifest version 6 does not define it"),
        "{error}"
    );
    invalid(
        &head_with(6, "compiled", GRANTS, "record = []\n"),
        "record",
        "is not a known key",
    );
}

#[test]
fn a_version_6_plugin_that_declares_a_kind_loads() {
    let body = format!("{NOTE}{}", command("capture", "\"store-write\"", JOURNAL));
    let plugin = Raw::new(v6(&body), |_| {
        Ok(vec![closure("notes-capture", |input, _| {
            afd::success(input)
        })])
    });
    let config = config(&[("notes", "")], "").replace("config_version = 2", "config_version = 6")
        + "[plugins.notes.grants.records_write]\nallow = [\"main\"]\ndefault_access = \"space\"\n";
    let dir = support::workspace(&config);
    let host = seal(dir.path(), |builder| builder.with_compiled(plugin)).unwrap();
    assert!(host.registry().get("notes-capture").is_some());
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
    let schema = read(&schemas_dir().join("plugin-manifest.v6.json"));
    jsonschema::meta::validate(&schema).unwrap();
    jsonschema::validator_for(&schema).unwrap()
}

/// A manifest's TOML as the JSON the schema describes.
fn as_json(text: &str) -> Value {
    serde_json::to_value(text.parse::<toml::Table>().unwrap()).unwrap()
}

fn as_toml(instance: &Value) -> String {
    toml::to_string(&toml::Value::try_from(instance).unwrap()).unwrap()
}

#[test]
fn the_schema_accepts_and_refuses_the_same_manifests() {
    let validator = validator();
    let many = |count: usize| {
        (0..count)
            .map(|index| format!("\"/k{index}\""))
            .collect::<Vec<_>>()
            .join(", ")
    };
    let journaled = format!(
        "{}{}",
        command("capture", "\"store-write\"", JOURNAL),
        pipeline("lookup", "notes-capture", JOURNAL)
    );
    let accepted = [
        v6(""),
        v6(NOTE),
        v6(&format!("{NOTE}{journaled}")),
        v6(&entry("kind = \"note\"\ntext = [\"/statement\"]")),
        v6(&entry("kind = \"note\"\nkeys = [\"/bed\"]")),
        v6(&entry(
            "kind = \"note\"\nstanding = false\ntext = [\"/a\", \"/b\", \"/c\", \"/d\"]\nmatch = \"/d\"",
        )),
        v6(&entry(&format!("kind = \"note\"\nkeys = [{}]", many(16)))),
        v6(&entry(&format!(
            "kind = \"note\"\nkeys = [\"/{}\"]",
            "a".repeat(64)
        ))),
        v6(&(0..16)
            .map(|index| entry(&format!("kind = \"k{index}\"\nkeys = [\"/bed\"]")))
            .collect::<String>()),
        // A version 6 plugin of every kind that declares nothing.
        head(6, "component", GRANTS),
        head(6, "mounted", ""),
        head(6, "pack", ""),
        v6(&command("find", "\"inspect\"", "")),
    ];
    for text in &accepted {
        let instance = as_json(text);
        if let Err(error) = validator.validate(&instance) {
            panic!("the schema refused {text}: {error}");
        }
        if let Err(error) = parse(text) {
            panic!("the host refused {text}: {error}");
        }
    }
    let grant = |name: &str| format!("\n[[grants]]\nname = \"{name}\"\nreason = \"Needs it.\"\n");
    let refused = [
        // Versions: the key is version 6's.
        format!("{}{NOTE}", head(5, "compiled", GRANTS)),
        // Compiled only, both grants, something declared, a journal everywhere.
        format!("{}{NOTE}", head(6, "component", GRANTS)),
        format!("{}{NOTE}", head(6, "mounted", "")),
        format!("{}{NOTE}", head(6, "pack", "")),
        format!("{}{NOTE}", head(6, "compiled", "")),
        format!("{}{NOTE}", head(6, "compiled", &grant("records"))),
        format!("{}{NOTE}", head(6, "compiled", &grant("records_write"))),
        v6(&entry("kind = \"note\"")),
        v6(&entry("kind = \"note\"\nstanding = false")),
        v6(&entry("kind = \"note\"\ntext = []\nkeys = []")),
        v6(&format!("{NOTE}{}", command("find", "\"inspect\"", ""))),
        v6(&format!(
            "{NOTE}{}{}",
            command("find", "\"inspect\"", JOURNAL),
            pipeline("lookup", "notes-find", "")
        )),
        // Each key's rule.
        v6(&entry("text = [\"/statement\"]")),
        v6(&entry("kind = \"Note\"\ntext = [\"/statement\"]")),
        v6(&entry(
            "kind = \"note\"\nstanding = \"yes\"\ntext = [\"/statement\"]",
        )),
        v6(&entry(
            "kind = \"note\"\nstanding = true\nkeys = [\"/bed\"]",
        )),
        v6(&entry("kind = \"note\"\ntext = \"/statement\"")),
        v6(&entry(
            "kind = \"note\"\ntext = [\"/a\", \"/b\", \"/c\", \"/d\", \"/e\"]",
        )),
        v6(&entry("kind = \"note\"\ntext = [\"/a\", \"/a\"]")),
        v6(&entry(&format!("kind = \"note\"\nkeys = [{}]", many(17)))),
        v6(&entry("kind = \"note\"\nkeys = [\"/bed\", \"/bed\"]")),
        v6(&entry(
            "kind = \"note\"\nkeys = [\"/bed\"]\nmatch = \"/statement\"",
        )),
        v6(&entry(
            "kind = \"note\"\ntext = [\"/statement\"]\nindex = \"words\"",
        )),
        v6(&(0..17)
            .map(|index| entry(&format!("kind = \"k{index}\"\nkeys = [\"/bed\"]")))
            .collect::<String>()),
        head_with(6, "compiled", GRANTS, "records = \"note\"\n"),
        // Pointers.
        v6(&entry("kind = \"note\"\ntext = [\"statement\"]")),
        v6(&entry("kind = \"note\"\ntext = [\"/\"]")),
        v6(&entry("kind = \"note\"\ntext = [\"\"]")),
        v6(&entry("kind = \"note\"\ntext = [\"/a/b/c/d/e\"]")),
        v6(&entry("kind = \"note\"\nkeys = [\"/tags/0\"]")),
        v6(&entry("kind = \"note\"\nkeys = [\"/a-b\"]")),
        v6(&entry("kind = \"note\"\nkeys = [\"/a~1b\"]")),
        v6(&entry(&format!(
            "kind = \"note\"\nkeys = [\"/{}\"]",
            "a".repeat(65)
        ))),
        v6(&entry(&format!(
            "kind = \"note\"\nkeys = [\"/{0}/{0}\"]",
            "a".repeat(64)
        ))),
        v6(&entry(
            "kind = \"note\"\ntext = [\"/statement\"]\nmatch = \"statement\"",
        )),
    ];
    for text in &refused {
        assert!(
            !validator.is_valid(&as_json(text)),
            "the schema accepted {text}"
        );
        assert!(parse(text).is_err(), "the host accepted {text}");
    }
    // Rules that compare one value with another are the reader's: the schema admits these, the
    // host refuses them.
    let reader_only = [
        v6(&format!(
            "{NOTE}{}",
            entry("kind = \"note\"\nkeys = [\"/bed\"]")
        )),
        v6(&entry(
            "kind = \"note\"\ntext = [\"/statement\"]\nkeys = [\"/statement\"]",
        )),
        v6(&entry(
            "kind = \"note\"\ntext = [\"/statement\"]\nmatch = \"/title\"",
        )),
    ];
    for text in &reader_only {
        assert!(validator.is_valid(&as_json(text)), "{text}");
        assert!(parse(text).is_err(), "the host accepted {text}");
    }
}

#[test]
fn the_version_6_examples_validate_and_load() {
    let validator = validator();
    let example = |name: &str| read(&schemas_dir().join("examples").join(name));
    let declared = example("plugin-manifest.v6.json");
    validator.validate(&declared).unwrap();
    let manifest = parse(&as_toml(&declared)).unwrap();
    assert_eq!(manifest.manifest_version, 6);
    let kinds: Vec<(&str, bool)> = manifest
        .records
        .iter()
        .map(|record| (record.kind.as_str(), record.standing))
        .collect();
    assert_eq!(kinds, [("note", true), ("bed", false)]);
    assert_eq!(
        manifest.records[0].match_pointer().unwrap().as_str(),
        "/statement"
    );
    assert!(manifest.commands.iter().all(|c| c.journal.is_some()));
    assert!(manifest.pipelines.iter().all(|p| p.journal.is_some()));

    let defaults = example("plugin-manifest.v6.defaults.json");
    validator.validate(&defaults).unwrap();
    let manifest = parse(&as_toml(&defaults)).unwrap();
    assert!(manifest.records.is_empty());

    // The version 5 schema refuses version 6's example, and version 6's a version 5 manifest.
    let v5 =
        jsonschema::validator_for(&read(&schemas_dir().join("plugin-manifest.v5.json"))).unwrap();
    assert!(!v5.is_valid(&declared));
    assert!(!validator.is_valid(&example("plugin-manifest.v5.json")));
    // A version 5 manifest lifted to version 6 is a version 6 manifest: nothing was taken away.
    let mut lifted = example("plugin-manifest.v5.json");
    lifted["manifest_version"] = serde_json::json!(6);
    validator.validate(&lifted).unwrap();
    parse(&as_toml(&lifted)).unwrap();
}
