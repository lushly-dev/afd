//! `umbel.toml`, configuration version 6 (records host specification, sections 3 and 9.2; D161,
//! D166): a space's `person`, `verified_admits` and `[meaning]`, a collection's `own` and
//! `speaker`, `[models]` and the `records_write` table's `default_access`; every key with its
//! default and its refusal; `own` refused on a command-writable collection, in every way a
//! collection is one; versions 1 to 5 refusing the keys and reading as version 6 with none of
//! them; and the schema file accepting and refusing the same configurations. Parsing and
//! validation only here: nothing gives a record standing, checks a document against its file or
//! loads a model.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::path::{Path, PathBuf};

use jsonschema::Validator;
use serde_json::{Value, json};
use umbel::doctor::{self, CheckStatus};
use umbel::workspace::{
    ConfigFile, DefaultAccess, ModelProvider, Pooling, VerifiedAdmits, Workspace, WorkspaceError,
};

fn workspace_with(text: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("ws");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("umbel.toml"), text).unwrap();
    (dir, root)
}

fn open(text: &str) -> Result<Workspace, WorkspaceError> {
    let (_dir, root) = workspace_with(text);
    Workspace::open(&root)
}

/// The refusal of `text`, which must be `WORKSPACE_CONFIG_INVALID` naming exactly `key`.
#[track_caller]
fn invalid(text: &str, key: &str) -> WorkspaceError {
    let error = open(text).expect_err(text);
    refused_at(&error, key, text);
    error
}

#[track_caller]
fn refused_at(error: &WorkspaceError, key: &str, text: &str) {
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{text}: {error}");
    assert_eq!(error.key(), Some(key), "{text}: {error}");
    assert!(
        error.message().contains(&format!("`{key}`")),
        "{text}: {error} does not name {key}"
    );
    assert!(!error.suggestion().is_empty());
}

fn digest(digit: char) -> String {
    format!("sha256:{}", digit.to_string().repeat(64))
}

/// `[models.potion]`, a static model, with `keys` appended to its table and its three files.
fn potion(keys: &str) -> String {
    format!(
        "\n[models.potion]\nprovider = \"static\"\nname = \"potion-base-8m\"\ndir = \"models/potion-base-8m\"\n{keys}\n[models.potion.files]\n\"model.safetensors\" = \"{}\"\n\"tokenizer.json\" = \"{}\"\n\"config.json\" = \"{}\"\n",
        digest('1'),
        digest('2'),
        digest('3')
    )
}

/// Section 3's own example: a garden space with its person, two own collections, a meaning lane
/// on a static model, and a `notes` instance that writes records there. `rest` is appended.
fn garden(rest: &str) -> String {
    format!(
        r#"config_version = 6

[spaces.garden]
person = "human:local"
verified_admits = "affirmed"

[spaces.garden.collections.journal]
root = "content/journal"
own = true

[spaces.garden.collections.talks]
root = "content/talks"
own = true
speaker = "Gardener"

[spaces.garden.meaning]
model = "potion"
weight = 0.5
k = 5
{}
[plugins]
enabled = ["notes"]

[plugins.notes.grants.records_write]
allow = ["garden"]
default_access = "private"
{rest}"#,
        potion("")
    )
}

/// A version 6 file with one space `garden` whose table holds `space`, and `rest` after it.
fn space(space: &str, rest: &str) -> String {
    format!("config_version = 6\n\n[spaces.garden]\n{space}\n{rest}")
}

/// A version 6 file with one model table `[models.<id>]` holding `keys`.
fn model(id: &str, keys: &str) -> String {
    format!("config_version = 6\n\n[models.{id}]\n{keys}\n")
}

const HTTP: &str = "provider = \"http\"\nname = \"garden-embeddings\"\nurl = \"https://embeddings.example.com/v1/embeddings\"\ndimensions = 384\nversion = \"2026-11\"";

fn onnx(keys: &str) -> String {
    format!(
        "config_version = 6\n\n[models.minilm]\nprovider = \"onnx\"\nname = \"all-minilm-l6-v2\"\ndir = \"models/minilm\"\n{keys}\n[models.minilm.files]\n\"model.onnx\" = \"{}\"\n\"tokenizer.json\" = \"{}\"\n\"config.json\" = \"{}\"\n\"special_tokens_map.json\" = \"{}\"\n\"tokenizer_config.json\" = \"{}\"\n",
        digest('4'),
        digest('5'),
        digest('6'),
        digest('7'),
        digest('8')
    )
}

// ── Every key, and its default ─────────────────────────────────────────────────────────────────

#[test]
fn the_specifications_example_opens_with_every_key() {
    let workspace = open(&garden("")).unwrap();
    let config = workspace.config();
    assert_eq!(config.version, 6);
    let garden = &config.spaces[0];
    assert_eq!(garden.id.as_str(), "garden");
    assert_eq!(garden.person.as_deref(), Some("human:local"));
    assert_eq!(garden.verified_admits, VerifiedAdmits::Affirmed);
    assert_eq!(garden.verified_admits.as_str(), "affirmed");
    let meaning = garden.meaning.as_ref().unwrap();
    assert_eq!(meaning.model, "potion");
    assert!((meaning.weight - 0.5).abs() < f64::EPSILON);
    assert_eq!(meaning.k, 5);

    let [journal, talks] = garden.collections.as_slice() else {
        panic!("{:?}", garden.collections);
    };
    assert_eq!(
        (journal.id.as_str(), journal.own, journal.speaker.as_deref()),
        ("journal", true, None)
    );
    assert_eq!(
        (talks.id.as_str(), talks.own, talks.speaker.as_deref()),
        ("talks", true, Some("Gardener"))
    );

    let [potion] = config.models.as_slice() else {
        panic!("{:?}", config.models);
    };
    assert_eq!(potion.id, "potion");
    assert_eq!(potion.name, "potion-base-8m");
    assert_eq!(potion.provider.as_str(), "static");
    let ModelProvider::Static { dir, files } = &potion.provider else {
        panic!("{:?}", potion.provider);
    };
    assert_eq!(dir, "models/potion-base-8m");
    assert_eq!(
        files.iter().collect::<Vec<_>>(),
        [
            (&"config.json".to_owned(), &digest('3')),
            (&"model.safetensors".to_owned(), &digest('1')),
            (&"tokenizer.json".to_owned(), &digest('2')),
        ]
    );

    let notes = &config.plugins.instances[0];
    assert_eq!(notes.allow["records_write"], ["garden"]);
    assert_eq!(notes.records_default_access, DefaultAccess::Private);
    // Nothing writes files into an own collection here.
    assert!(!config.command_writable("garden", "journal"));
    assert!(!config.command_writable("garden", "talks"));
}

#[test]
fn every_key_has_a_default_and_earlier_versions_read_with_them() {
    let bare = open("config_version = 6\n").unwrap();
    let config = bare.config();
    assert_eq!(config.spaces[0].id.as_str(), "main");
    assert_eq!(config.spaces[0].person, None);
    assert_eq!(config.spaces[0].verified_admits, VerifiedAdmits::Affirmed);
    assert_eq!(config.spaces[0].meaning, None);
    assert!(config.models.is_empty());

    let plain = open(&space(
        "",
        "[spaces.garden.collections.handbook]\nroot = \"content/handbook\"\n\n[plugins]\nenabled = [\"notes\"]\n\n[plugins.notes.grants.records_write]\nallow = [\"garden\"]\n",
    ))
    .unwrap();
    let config = plain.config();
    assert_eq!(config.spaces[0].person, None);
    assert!(!config.spaces[0].collections[0].own);
    assert_eq!(config.spaces[0].collections[0].speaker, None);
    assert_eq!(
        config.plugins.instances[0].records_default_access,
        DefaultAccess::Private
    );
    // A meaning table needs only its model.
    let lane = open(&space(
        "",
        &format!(
            "[spaces.garden.meaning]\nmodel = \"potion\"\n{}",
            potion("")
        ),
    ))
    .unwrap();
    let meaning = lane.config().spaces[0].meaning.clone().unwrap();
    assert!((meaning.weight - umbel::workspace::DEFAULT_MEANING_WEIGHT).abs() < f64::EPSILON);
    assert!((meaning.weight - 0.5).abs() < f64::EPSILON);
    assert_eq!(meaning.k, umbel::workspace::DEFAULT_MEANING_K);
    assert_eq!(meaning.k, 5);

    // Versions 1 to 5 read as version 6 with no person, no own collection and no model.
    for version in 1..=5 {
        let workspace = open(&format!("config_version = {version}\n")).unwrap();
        let config = workspace.config();
        assert_eq!(config.version, version);
        assert_eq!(config.spaces[0].person, None, "{version}");
        assert_eq!(config.spaces[0].verified_admits, VerifiedAdmits::Affirmed);
        assert_eq!(config.spaces[0].meaning, None);
        assert!(config.models.is_empty());
    }
    let v5 = open(
        "config_version = 5\n\n[spaces.garden.collections.journal]\nroot = \"content/journal\"\n\n[plugins]\nenabled = [\"notes\"]\n\n[plugins.notes.grants.records_write]\nallow = [\"garden\"]\n",
    )
    .unwrap();
    assert!(!v5.config().spaces[0].collections[0].own);
    assert_eq!(
        v5.config().plugins.instances[0].records_default_access,
        DefaultAccess::Private
    );
    assert_eq!(umbel::CONFIG_VERSION, 6);
    assert_eq!(umbel::CONFIG_VERSIONS, [1, 2, 3, 4, 5, 6]);
}

#[test]
fn versions_1_to_5_refuse_the_keys() {
    #[track_caller]
    fn needs_6(text: &str, key: &str) {
        let error = invalid(text, key);
        assert!(
            error.message().contains("needs config_version = 6"),
            "{text}: {error}"
        );
    }
    for version in 1..=5 {
        let head = format!("config_version = {version}\n");
        needs_6(&format!("{head}{}", potion("")), "models");
        needs_6(
            &format!("{head}\n[spaces.garden]\nperson = \"human:local\"\n"),
            "spaces.garden.person",
        );
        needs_6(
            &format!("{head}\n[spaces.garden]\nverified_admits = \"affirmed\"\n"),
            "spaces.garden.verified_admits",
        );
        needs_6(
            &format!("{head}\n[spaces.garden.meaning]\nmodel = \"potion\"\n"),
            "spaces.garden.meaning",
        );
    }
    // Collections and grant tables exist from version 3.
    for version in 3..=5 {
        let head = format!(
            "config_version = {version}\n\n[spaces.garden.collections.journal]\nroot = \"content/journal\"\n"
        );
        needs_6(
            &format!("{head}own = true\n"),
            "spaces.garden.collections.journal.own",
        );
        needs_6(
            &format!("{head}speaker = \"Gardener\"\n"),
            "spaces.garden.collections.journal.speaker",
        );
        needs_6(
            &format!(
                "{head}\n[plugins]\nenabled = [\"notes\"]\n\n[plugins.notes.grants.records_write]\nallow = [\"garden\"]\ndefault_access = \"space\"\n"
            ),
            "plugins.notes.grants.records_write.default_access",
        );
    }
    for version in [0, 7] {
        let error = open(&format!("config_version = {version}\n")).unwrap_err();
        assert_eq!(error.code(), "WORKSPACE_CONFIG_UNSUPPORTED");
        assert!(error.message().contains("1 to 6"), "{error}");
    }
    let error = invalid("name = \"garden\"\n", "config_version");
    assert!(
        error.message().contains("set config_version = 6"),
        "{error}"
    );
}

// ── A space's person, verified_admits and meaning ──────────────────────────────────────────────

#[test]
fn a_spaces_person_is_a_human_principal_string() {
    for person in ["human:local", "human:corp/U019488227", "human:a:b"] {
        let workspace = open(&space(&format!("person = \"{person}\""), "")).unwrap();
        assert_eq!(workspace.config().spaces[0].person.as_deref(), Some(person));
    }
    for person in [
        "\"local\"",
        "\"agent:helper\"",
        "\"service:sync\"",
        "\"human:\"",
        "\"Human:local\"",
        "\"\"",
    ] {
        let error = invalid(
            &space(&format!("person = {person}"), ""),
            "spaces.garden.person",
        );
        assert!(
            error
                .message()
                .contains("must be a principal string human:<id>"),
            "{error}"
        );
    }
    let error = invalid(&space("person = 7", ""), "spaces.garden.person");
    assert!(error.message().contains("must be a string"), "{error}");
}

#[test]
fn verified_admits_is_affirmed_or_affirmed_and_attested() {
    for (text, admits) in [
        ("affirmed", VerifiedAdmits::Affirmed),
        ("affirmed+attested", VerifiedAdmits::AffirmedAttested),
    ] {
        let workspace = open(&space(&format!("verified_admits = \"{text}\""), "")).unwrap();
        assert_eq!(workspace.config().spaces[0].verified_admits, admits);
        assert_eq!(admits.as_str(), text);
    }
    for bad in ["\"attested\"", "\"unverified\"", "\"all\"", "\"\"", "true"] {
        invalid(
            &space(&format!("verified_admits = {bad}"), ""),
            "spaces.garden.verified_admits",
        );
    }
    // No setting asks for every read: the space-level flag of an earlier draft is no key.
    let error = invalid(
        &space("verified_only = true", ""),
        "spaces.garden.verified_only",
    );
    assert!(error.message().contains("is not a known key"), "{error}");
    let error = invalid(
        &space("min_standing = \"affirmed\"", ""),
        "spaces.garden.min_standing",
    );
    assert!(error.message().contains("is not a known key"), "{error}");
}

#[test]
fn a_meaning_table_names_a_declared_model_a_weight_and_a_k() {
    let lane = |keys: &str| {
        space(
            "",
            &format!("[spaces.garden.meaning]\n{keys}\n{}", potion("")),
        )
    };
    for (keys, weight, k) in [
        ("model = \"potion\"\nweight = 0.0\nk = 1", 0.0, 1),
        ("model = \"potion\"\nweight = 1.0\nk = 20", 1.0, 20),
        ("model = \"potion\"\nweight = 0\nk = 7", 0.0, 7),
        ("model = \"potion\"\nweight = 1", 1.0, 5),
        ("model = \"potion\"\nweight = 0.25", 0.25, 5),
    ] {
        let workspace = open(&lane(keys)).unwrap();
        let meaning = workspace.config().spaces[0].meaning.clone().unwrap();
        assert!((meaning.weight - weight).abs() < f64::EPSILON, "{keys}");
        assert_eq!(meaning.k, k, "{keys}");
    }
    for (keys, key) in [
        ("weight = 0.5", "model"),
        ("model = 3", "model"),
        ("model = \"Potion\"", "model"),
        ("model = \"\"", "model"),
        ("model = \"potion\"\nweight = -0.1", "weight"),
        ("model = \"potion\"\nweight = 1.01", "weight"),
        ("model = \"potion\"\nweight = 2", "weight"),
        ("model = \"potion\"\nweight = \"half\"", "weight"),
        ("model = \"potion\"\nk = 0", "k"),
        ("model = \"potion\"\nk = 21", "k"),
        ("model = \"potion\"\nk = 2.5", "k"),
        ("model = \"potion\"\nthreshold = 0.8", "threshold"),
    ] {
        invalid(&lane(keys), &format!("spaces.garden.meaning.{key}"));
    }
    invalid(&space("meaning = \"potion\"", ""), "spaces.garden.meaning");
    // The model must be one `[models]` declares.
    let error = invalid(
        &space("", "[spaces.garden.meaning]\nmodel = \"potion\"\n"),
        "spaces.garden.meaning.model",
    );
    assert!(
        error
            .message()
            .contains("names `potion`, which no [models.potion] table declares"),
        "{error}"
    );
    let error = invalid(&lane("model = \"minilm\""), "spaces.garden.meaning.model");
    assert!(error.message().contains("[models.minilm]"), "{error}");
}

// ── A collection's own and speaker ─────────────────────────────────────────────────────────────

#[test]
fn own_needs_the_spaces_person_and_speaker_goes_with_own() {
    let journal = |space_keys: &str, keys: &str| {
        space(
            space_keys,
            &format!("[spaces.garden.collections.journal]\nroot = \"content/journal\"\n{keys}\n"),
        )
    };
    const PERSON: &str = "person = \"human:local\"";
    let own = open(&journal(PERSON, "own = true")).unwrap();
    assert!(own.config().spaces[0].collections[0].own);
    let stated = open(&journal(PERSON, "own = false")).unwrap();
    assert!(!stated.config().spaces[0].collections[0].own);
    // `own = false` asks nothing of the space.
    open(&journal("", "own = false")).unwrap();

    let error = invalid(
        &journal("", "own = true"),
        "spaces.garden.collections.journal.own",
    );
    assert!(
        error.message().contains("needs the space's person"),
        "{error}"
    );
    invalid(
        &journal(PERSON, "own = \"yes\""),
        "spaces.garden.collections.journal.own",
    );

    let spoken = open(&journal(PERSON, "own = true\nspeaker = \"Gardener\"")).unwrap();
    assert_eq!(
        spoken.config().spaces[0].collections[0].speaker.as_deref(),
        Some("Gardener")
    );
    for keys in [
        "speaker = \"Gardener\"",
        "own = false\nspeaker = \"Gardener\"",
    ] {
        let error = invalid(
            &journal(PERSON, keys),
            "spaces.garden.collections.journal.speaker",
        );
        assert!(
            error.message().contains("goes with own = true only"),
            "{error}"
        );
    }
    let longest = "g".repeat(128);
    open(&journal(
        PERSON,
        &format!("own = true\nspeaker = \"{longest}\""),
    ))
    .unwrap();
    for speaker in [
        "\"\"".to_owned(),
        format!("\"{}\"", "g".repeat(129)),
        "\"Gardener\\nGuest\"".to_owned(),
        "3".to_owned(),
    ] {
        let error = invalid(
            &journal(PERSON, &format!("own = true\nspeaker = {speaker}")),
            "spaces.garden.collections.journal.speaker",
        );
        assert!(
            error.message().contains("1 to 128 characters")
                || error.message().contains("must be a string"),
            "{error}"
        );
    }
}

// ── [models] ───────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_model_has_an_id_a_provider_and_a_name() {
    for id in ["Potion", "9potion", "potion_base", &"p".repeat(33)] {
        let error = invalid(&model(id, HTTP), &format!("models.{id}"));
        assert!(
            error.message().contains("^[a-z][a-z0-9-]{0,31}$"),
            "{error}"
        );
    }
    open(&model(&"p".repeat(32), HTTP)).unwrap();
    invalid("config_version = 6\nmodels = \"potion\"\n", "models");
    invalid(
        "config_version = 6\n\n[models]\npotion = \"static\"\n",
        "models.potion",
    );

    let error = invalid(&model("served", "name = \"x\""), "models.served.provider");
    assert!(error.message().contains("is required"), "{error}");
    for provider in ["\"local\"", "\"openai\"", "\"\"", "3"] {
        invalid(
            &model("served", &format!("provider = {provider}\nname = \"x\"")),
            "models.served.provider",
        );
    }
    let nameless = HTTP.replace("name = \"garden-embeddings\"\n", "");
    let error = invalid(&model("served", &nameless), "models.served.name");
    assert!(error.message().contains("is required"), "{error}");
    for name in [
        "\"\"".to_owned(),
        format!("\"{}\"", "n".repeat(129)),
        "\"a\\tb\"".to_owned(),
    ] {
        invalid(
            &model("served", &HTTP.replace("\"garden-embeddings\"", &name)),
            "models.served.name",
        );
    }
    open(&model(
        "served",
        &HTTP.replace("garden-embeddings", &"n".repeat(128)),
    ))
    .unwrap();
    let error = invalid(
        &model("served", &format!("{HTTP}\nquantize = true")),
        "models.served.quantize",
    );
    assert!(error.message().contains("is not a known key"), "{error}");
}

#[test]
fn a_static_model_pins_its_three_files_in_a_directory_of_the_workspace() {
    let files = |entries: &[(&str, String)]| {
        let lines: String = entries
            .iter()
            .map(|(name, digest)| format!("\"{name}\" = \"{digest}\"\n"))
            .collect();
        format!(
            "config_version = 6\n\n[models.potion]\nprovider = \"static\"\nname = \"potion-base-8m\"\ndir = \"models/potion\"\n\n[models.potion.files]\n{lines}"
        )
    };
    let three = [
        ("model.safetensors", digest('1')),
        ("tokenizer.json", digest('2')),
        ("config.json", digest('3')),
    ];
    open(&files(&three)).unwrap();
    // Exactly the three: none missing, none more, none renamed.
    for entries in [
        &three[..2],
        &[three.as_slice(), &[("vocab.txt", digest('4'))]].concat(),
        &[
            ("model.onnx", digest('1')),
            ("tokenizer.json", digest('2')),
            ("config.json", digest('3')),
        ],
        &[],
    ] {
        let error = invalid(&files(entries), "models.potion.files");
        assert!(
            error
                .message()
                .contains("must name exactly model.safetensors, tokenizer.json, config.json"),
            "{error}"
        );
    }
    for bad in [
        "sha256:abc".to_owned(),
        digest('1').to_uppercase(),
        digest('g'),
        "1".repeat(64),
        format!("sha512:{}", "1".repeat(64)),
    ] {
        let error = invalid(
            &files(&[
                ("model.safetensors", bad),
                ("tokenizer.json", digest('2')),
                ("config.json", digest('3')),
            ]),
            "models.potion.files.\"model.safetensors\"",
        );
        assert!(
            error.message().contains("sha256:<64 lowercase hex>"),
            "{error}"
        );
    }
    let no_files = "config_version = 6\n\n[models.potion]\nprovider = \"static\"\nname = \"p\"\ndir = \"models/potion\"\n";
    let error = invalid(no_files, "models.potion.files");
    assert!(error.message().contains("is required"), "{error}");
    invalid(
        &format!("{no_files}files = [\"model.safetensors\"]\n"),
        "models.potion.files",
    );

    let potion_at = |dir: &str| potion("").replace("\"models/potion-base-8m\"", dir);
    let no_dir = potion("").replace("dir = \"models/potion-base-8m\"\n", "");
    let error = invalid(
        &format!("config_version = 6\n{no_dir}"),
        "models.potion.dir",
    );
    assert!(error.message().contains("is required"), "{error}");
    for dir in [
        "\"/opt/models/potion\"",
        "\"../models/potion\"",
        "\"models/../../potion\"",
        "\"state/models/potion\"",
        "\"./state\"",
        "\".\"",
        "\"\"",
        "\"models\\\\potion\"",
        "7",
    ] {
        invalid(
            &format!("config_version = 6\n{}", potion_at(dir)),
            "models.potion.dir",
        );
    }
    // A key of another provider is refused, saying whose it is.
    for (keys, key) in [
        ("pooling = \"mean\"", "pooling"),
        ("max_length = 128", "max_length"),
        ("url = \"https://embeddings.example.com/v1\"", "url"),
        ("dimensions = 256", "dimensions"),
        ("version = \"1\"", "version"),
        ("bearer_env = \"TOKEN\"", "bearer_env"),
        ("timeout_ms = 1000", "timeout_ms"),
    ] {
        let error = invalid(
            &format!("config_version = 6\n{}", potion(keys)),
            &format!("models.potion.{key}"),
        );
        assert!(
            error
                .message()
                .contains("is not a key of provider \"static\", which reads dir, files"),
            "{error}"
        );
    }
}

#[test]
fn an_onnx_model_pins_its_five_files_and_has_pooling_and_a_length() {
    let workspace = open(&onnx("")).unwrap();
    let ModelProvider::Onnx {
        dir,
        files,
        pooling,
        max_length,
    } = &workspace.config().models[0].provider
    else {
        panic!("{:?}", workspace.config().models);
    };
    assert_eq!(dir, "models/minilm");
    assert_eq!(files.len(), 5);
    assert_eq!(*pooling, Pooling::Mean);
    assert_eq!(pooling.as_str(), "mean");
    assert_eq!(*max_length, umbel::workspace::DEFAULT_MODEL_MAX_LENGTH);
    assert_eq!(*max_length, 512);

    let set = open(&onnx("pooling = \"cls\"\nmax_length = 8192")).unwrap();
    let ModelProvider::Onnx {
        pooling,
        max_length,
        ..
    } = &set.config().models[0].provider
    else {
        panic!();
    };
    assert_eq!((*pooling, *max_length), (Pooling::Cls, 8192));
    open(&onnx("max_length = 16")).unwrap();
    for (keys, key) in [
        ("pooling = \"max\"", "pooling"),
        ("pooling = true", "pooling"),
        ("max_length = 15", "max_length"),
        ("max_length = 8193", "max_length"),
        ("max_length = \"512\"", "max_length"),
        ("url = \"https://embeddings.example.com/v1\"", "url"),
        ("dimensions = 384", "dimensions"),
        ("timeout_ms = 1000", "timeout_ms"),
    ] {
        invalid(&onnx(keys), &format!("models.minilm.{key}"));
    }
    // A static model's three files are not an onnx model's five.
    let three = onnx("")
        .replace(
            &format!("\"special_tokens_map.json\" = \"{}\"\n", digest('7')),
            "",
        )
        .replace(
            &format!("\"tokenizer_config.json\" = \"{}\"\n", digest('8')),
            "",
        );
    let error = invalid(&three, "models.minilm.files");
    assert!(
        error.message().contains(
            "must name exactly model.onnx, tokenizer.json, config.json, special_tokens_map.json, tokenizer_config.json"
        ),
        "{error}"
    );
}

#[test]
fn an_http_model_names_an_https_url_or_a_literal_loopback_address() {
    let workspace = open(&model("served", HTTP)).unwrap();
    let served = &workspace.config().models[0];
    assert_eq!(served.provider.as_str(), "http");
    let ModelProvider::Http {
        url,
        dimensions,
        version,
        bearer_env,
        timeout_ms,
    } = &served.provider
    else {
        panic!("{:?}", served.provider);
    };
    assert_eq!(url, "https://embeddings.example.com/v1/embeddings");
    assert_eq!(*dimensions, 384);
    assert_eq!(version, "2026-11");
    assert_eq!(*bearer_env, None);
    assert_eq!(*timeout_ms, umbel::workspace::DEFAULT_MODEL_TIMEOUT_MS);
    assert_eq!(*timeout_ms, 5_000);

    let with_url = |url: &str| {
        model(
            "served",
            &HTTP.replace("https://embeddings.example.com/v1/embeddings", url),
        )
    };
    for url in [
        "https://embeddings.example.com:8443/v1/embeddings",
        "https://localhost/embed",
        "http://127.0.0.1:8090/v1/embeddings",
        "http://127.0.0.2/embed",
        "http://[::1]:8090/embed",
    ] {
        open(&with_url(url)).unwrap_or_else(|error| panic!("{url}: {error}"));
    }
    for url in [
        // A name, even the loopback name, and any other address.
        "http://localhost:8090/v1/embeddings",
        "http://embeddings.example.com/v1/embeddings",
        "http://embeddings/v1",
        "http://10.0.0.5/embed",
        "http://192.168.1.20:8090/embed",
        "http://[::2]/embed",
        "ftp://127.0.0.1/embed",
        "embeddings.example.com/v1",
        "",
    ] {
        let error = invalid(&with_url(url), "models.served.url");
        assert!(
            error.message().contains("https") && error.message().contains("loopback"),
            "{url}: {error}"
        );
    }
    // No credentials in the URL: the token is `bearer_env`'s.
    let error = invalid(
        &with_url("https://token@embeddings.example.com/"),
        "models.served.url",
    );
    assert!(error.message().contains("no credentials"), "{error}");
    let without = |line: &str| model("served", &HTTP.replace(line, ""));
    for (line, key) in [
        (
            "\nurl = \"https://embeddings.example.com/v1/embeddings\"",
            "url",
        ),
        ("\ndimensions = 384", "dimensions"),
        ("\nversion = \"2026-11\"", "version"),
    ] {
        let error = invalid(&without(line), &format!("models.served.{key}"));
        assert!(error.message().contains("is required"), "{error}");
    }
    let set = open(&model(
        "served",
        &format!("{HTTP}\nbearer_env = \"EMBEDDINGS_TOKEN\"\ntimeout_ms = 60000"),
    ))
    .unwrap();
    let ModelProvider::Http {
        bearer_env,
        timeout_ms,
        ..
    } = &set.config().models[0].provider
    else {
        panic!();
    };
    assert_eq!(bearer_env.as_deref(), Some("EMBEDDINGS_TOKEN"));
    assert_eq!(*timeout_ms, 60_000);
    for (keys, key) in [
        ("dimensions = 15", "dimensions"),
        ("dimensions = 4097", "dimensions"),
        ("version = \"\"", "version"),
        ("bearer_env = \"not a name\"", "bearer_env"),
        ("bearer_env = \"sk-secret-value-123\"", "bearer_env"),
        ("timeout_ms = 99", "timeout_ms"),
        ("timeout_ms = 60001", "timeout_ms"),
        ("dir = \"models/served\"", "dir"),
        ("pooling = \"mean\"", "pooling"),
        ("max_length = 512", "max_length"),
    ] {
        // A later key of the same name replaces HTTP's: build the table without it first.
        let base: String = HTTP
            .lines()
            .filter(|line| !line.starts_with(&format!("{key} =")))
            .collect::<Vec<_>>()
            .join("\n");
        invalid(
            &model("served", &format!("{base}\n{keys}")),
            &format!("models.served.{key}"),
        );
    }
    invalid(
        &model(
            "served",
            &HTTP.replace("\"2026-11\"", &format!("\"{}\"", "v".repeat(65))),
        ),
        "models.served.version",
    );
    let error = invalid(
        &model(
            "served",
            &format!(
                "{HTTP}\n[models.served.files]\n\"model.onnx\" = \"{}\"",
                digest('1')
            ),
        ),
        "models.served.files",
    );
    assert!(
        error
            .message()
            .contains("is not a key of provider \"http\""),
        "{error}"
    );
}

// ── The records_write grant table ──────────────────────────────────────────────────────────────

#[test]
fn records_write_takes_a_default_access() {
    let notes = |keys: &str| {
        format!(
            "config_version = 6\n\n[spaces.garden]\n\n[plugins]\nenabled = [\"notes\"]\n\n[plugins.notes.grants.records_write]\nallow = [\"garden\"]\n{keys}\n"
        )
    };
    for (keys, access) in [
        ("", DefaultAccess::Private),
        ("default_access = \"private\"", DefaultAccess::Private),
        ("default_access = \"space\"", DefaultAccess::Space),
    ] {
        let workspace = open(&notes(keys)).unwrap();
        assert_eq!(
            workspace.config().plugins.instances[0].records_default_access,
            access,
            "{keys}"
        );
    }
    for bad in ["\"public\"", "\"group:gardeners\"", "true"] {
        invalid(
            &notes(&format!("default_access = {bad}")),
            "plugins.notes.grants.records_write.default_access",
        );
    }
    // The table holds nothing else, and `allow` stays required.
    let error = invalid(
        &notes("writers = [\"space\"]"),
        "plugins.notes.grants.records_write.writers",
    );
    assert!(error.message().contains("is not a known key"), "{error}");
    invalid(
        &notes("").replace("allow = [\"garden\"]\n", "default_access = \"space\"\n"),
        "plugins.notes.grants.records_write.allow",
    );
    // No other grant's table gains the key.
    let error = invalid(
        &notes("").replace(
            "[plugins.notes.grants.records_write]",
            "[plugins.notes.grants.index_write]\nallow = [\"garden\"]\ndefault_access = \"space\"\n\n[plugins.notes.grants.records_write]",
        ),
        "plugins.notes.grants.index_write.default_access",
    );
    assert!(error.message().contains("is not a known key"), "{error}");
}

// ── Own collections and command-writable ones (section 3, rule 1) ──────────────────────────────

/// A garden with an own collection `journal` at `content/journal`, a plain `handbook`, a second
/// space `orchard` with one collection `shared` at `shared_root`, and a `notes` instance whose
/// `content_write` allow is `allow`.
fn two_spaces(shared_root: &str, allow: &str) -> String {
    format!(
        r#"config_version = 6
default_space = "garden"

[spaces.garden]
person = "human:local"

[spaces.garden.collections.journal]
root = "content/journal"
own = true

[spaces.garden.collections.handbook]
root = "content/handbook"

[spaces.orchard.collections.shared]
root = "{shared_root}"

[plugins]
enabled = ["notes"]

[plugins.notes.grants.content_write]
allow = [{allow}]
"#
    )
}

const OWN: &str = "spaces.garden.collections.journal.own";

#[test]
fn own_is_refused_on_a_collection_a_grant_covers() {
    // Covered itself.
    let error = invalid(&two_spaces("elsewhere", "\"garden/journal\""), OWN);
    assert!(
        error.message().contains(
            "a collection named as the person's own may not be written through content_write (plugins.notes.grants.content_write covers `garden/journal`): a command's input would become a file there"
        ),
        "{error}"
    );
    // Covered through `<space>/*`.
    let error = invalid(&two_spaces("elsewhere", "\"garden/*\""), OWN);
    assert!(
        error
            .message()
            .contains("(plugins.notes.grants.content_write covers `garden/journal`)"),
        "{error}"
    );
    // A grant that covers other collections leaves the own one alone, and the others are
    // command-writable.
    for allow in ["\"garden/handbook\"", "\"orchard/shared\"", "\"orchard/*\""] {
        let workspace = open(&two_spaces("elsewhere", allow)).unwrap();
        let config = workspace.config();
        assert!(!config.command_writable("garden", "journal"), "{allow}");
        assert_eq!(
            config.command_writable("garden", "handbook"),
            allow.contains("handbook"),
            "{allow}"
        );
        assert_eq!(
            config.command_writable("orchard", "shared"),
            allow.contains("orchard"),
            "{allow}"
        );
        assert!(!config.command_writable("garden", "absent"));
        assert!(!config.command_writable("meadow", "journal"));
    }
    // `documents_write` writes documents, not files: it makes nothing command-writable.
    let documents = two_spaces("elsewhere", "\"garden/handbook\"").replace(
        "[plugins.notes.grants.content_write]\nallow = [\"garden/handbook\"]",
        "[plugins.notes.grants.documents_write]\nallow = [\"garden/*\"]",
    );
    let workspace = open(&documents).unwrap();
    assert!(!workspace.config().command_writable("garden", "journal"));
    assert!(!workspace.config().command_writable("garden", "handbook"));
    // Without `own`, a covered collection is as before.
    let plain = two_spaces("elsewhere", "\"garden/journal\"").replace("own = true\n", "");
    let workspace = open(&plain).unwrap();
    assert!(workspace.config().command_writable("garden", "journal"));
}

#[test]
fn own_is_refused_where_another_spaces_covered_root_overlaps_it_as_written() {
    // The same directory, one that contains it, and one inside it.
    for shared in [
        "content/journal",
        "./content/journal/",
        "content",
        "content/journal/2026",
    ] {
        for allow in ["\"orchard/shared\"", "\"orchard/*\""] {
            let text = two_spaces(shared, allow);
            let error = invalid(&text, OWN);
            assert!(
                error.message().contains(
                    "(plugins.notes.grants.content_write covers `orchard/shared`, whose root overlaps it)"
                ),
                "{shared}: {error}"
            );
            assert!(
                error
                    .message()
                    .contains("a command's input would become a file there"),
                "{error}"
            );
        }
        // Uncovered, two spaces may share a directory, as before.
        let workspace = open(&two_spaces(shared, "\"garden/handbook\"")).unwrap();
        assert!(!workspace.config().command_writable("garden", "journal"));
    }
    // A sibling directory does not overlap.
    let workspace = open(&two_spaces("content/journal-drafts", "\"orchard/shared\"")).unwrap();
    assert!(!workspace.config().command_writable("garden", "journal"));
    assert!(workspace.config().command_writable("orchard", "shared"));
}

#[cfg(unix)]
#[test]
fn own_is_refused_where_another_spaces_covered_root_overlaps_it_through_a_symbolic_link() {
    use std::os::unix::fs::symlink;

    // `shared` is written as a root of its own and is a link to: the own collection's
    // directory, a directory that contains it, and one inside it.
    for target in ["content/journal", "content", "content/journal/2026"] {
        let text = two_spaces("linked", "\"orchard/shared\"");
        let (_dir, root) = workspace_with(&text);
        // With no link yet, `linked` is a directory of its own that does not exist: the roots
        // overlap neither as written nor where they would be made.
        let unresolved = Workspace::open(&root).unwrap();
        assert!(!unresolved.config().command_writable("garden", "journal"));

        fs::create_dir_all(root.join("content/journal/2026")).unwrap();
        symlink(root.join(target), root.join("linked")).unwrap();
        // A link made after a start is seen at the next one.
        let error = Workspace::open(&root).unwrap_err();
        refused_at(&error, OWN, target);
        assert!(
            error.message().contains(
                "(plugins.notes.grants.content_write covers `orchard/shared`, whose root overlaps it)"
            ),
            "{target}: {error}"
        );
        // The doctor says the same.
        let report = doctor::run(&root);
        let parse = report
            .checks
            .iter()
            .find(|check| check.id == "config.parse")
            .unwrap();
        assert_eq!(parse.status, CheckStatus::Fail, "{target}");
        assert!(parse.message.contains(OWN), "{}", parse.message);
    }
    // The own collection itself may be the link: its target is what is shared.
    let text = two_spaces("vault/notes", "\"orchard/shared\"");
    let (_dir, root) = workspace_with(&text);
    fs::create_dir_all(root.join("vault/notes")).unwrap();
    fs::create_dir_all(root.join("content")).unwrap();
    symlink(root.join("vault/notes"), root.join("content/journal")).unwrap();
    let error = Workspace::open(&root).unwrap_err();
    refused_at(&error, OWN, "the own root is the link");
    // A link to somewhere else shares nothing.
    let (_dir, root) = workspace_with(&two_spaces("linked", "\"orchard/shared\""));
    fs::create_dir_all(root.join("content/journal")).unwrap();
    fs::create_dir_all(root.join("content/talks")).unwrap();
    symlink(root.join("content/talks"), root.join("linked")).unwrap();
    let workspace = Workspace::open(&root).unwrap();
    assert!(!workspace.config().command_writable("garden", "journal"));
    assert!(workspace.config().command_writable("orchard", "shared"));
}

#[cfg(unix)]
#[test]
fn a_collection_that_shares_a_covered_directory_is_command_writable_without_being_own() {
    use std::os::unix::fs::symlink;

    // Section 6.2 reads the same judgment for a person's mark, so it holds for every collection.
    let text = two_spaces("linked", "\"orchard/shared\"").replace("own = true\n", "");
    let (_dir, root) = workspace_with(&text);
    fs::create_dir_all(root.join("content/journal")).unwrap();
    symlink(root.join("content"), root.join("linked")).unwrap();
    let workspace = Workspace::open(&root).unwrap();
    let config = workspace.config();
    assert!(config.command_writable("garden", "journal"));
    assert!(config.command_writable("orchard", "shared"));
    // `handbook` does not exist yet. A content write creates the directories its path lacks,
    // so the root counts where it would be created: inside `content`, which `linked` is.
    assert!(config.command_writable("garden", "handbook"));
}

#[cfg(unix)]
#[test]
fn own_is_refused_where_its_root_does_not_exist_yet_and_a_covered_root_would_reach_it() {
    use std::os::unix::fs::symlink;

    // The own root is missing, and another space's covered root is a link to the directory it
    // would be made in: a command writing `journal/...` through `linked` would create it.
    let text = two_spaces("linked", "\"orchard/shared\"");
    let (_dir, root) = workspace_with(&text);
    fs::create_dir_all(root.join("content")).unwrap();
    symlink(root.join("content"), root.join("linked")).unwrap();
    assert!(!root.join("content/journal").exists());
    let error = Workspace::open(&root).unwrap_err();
    refused_at(&error, OWN, "a missing own root under a linked directory");
    assert!(
        error.message().contains(
            "(plugins.notes.grants.content_write covers `orchard/shared`, whose root overlaps it)"
        ),
        "{error}"
    );
    // The answer is the same once the directory exists: nothing changes at the next start.
    fs::create_dir_all(root.join("content/journal")).unwrap();
    refused_at(&Workspace::open(&root).unwrap_err(), OWN, "the root made");

    // The covered root is the missing one: a directory not yet made, inside a link to the own
    // collection's directory.
    let (_dir, root) = workspace_with(&two_spaces("linked/2026", "\"orchard/shared\""));
    fs::create_dir_all(root.join("content/journal")).unwrap();
    symlink(root.join("content/journal"), root.join("linked")).unwrap();
    assert!(!root.join("linked/2026").exists());
    refused_at(
        &Workspace::open(&root).unwrap_err(),
        OWN,
        "a missing covered root under a link",
    );

    // Neither exists, and the link's own target is missing: it is followed to where the target
    // would be.
    let (_dir, root) = workspace_with(&two_spaces("linked", "\"orchard/shared\""));
    symlink("content", root.join("linked")).unwrap();
    assert!(!root.join("content").exists());
    refused_at(
        &Workspace::open(&root).unwrap_err(),
        OWN,
        "a link whose target is missing",
    );
    // A relative link out of a subdirectory, with `..`, resolves from the link's directory.
    let (_dir, root) = workspace_with(&two_spaces("mirror/notes", "\"orchard/shared\""));
    fs::create_dir_all(root.join("mirror")).unwrap();
    symlink("../content/journal", root.join("mirror/notes")).unwrap();
    refused_at(
        &Workspace::open(&root).unwrap_err(),
        OWN,
        "a relative link with ..",
    );

    // Missing roots that would be made apart stay apart, linked or not.
    let (_dir, root) = workspace_with(&two_spaces("linked", "\"orchard/shared\""));
    symlink("archive", root.join("linked")).unwrap();
    let workspace = Workspace::open(&root).unwrap();
    assert!(!workspace.config().command_writable("garden", "journal"));
    assert!(workspace.config().command_writable("orchard", "shared"));
    // A link that points at itself is no directory; it is taken as written.
    let (_dir, root) = workspace_with(&two_spaces("linked", "\"orchard/shared\""));
    symlink("linked", root.join("linked")).unwrap();
    let workspace = Workspace::open(&root).unwrap();
    assert!(!workspace.config().command_writable("garden", "journal"));
}

// ── The doctor and the key scan ────────────────────────────────────────────────────────────────

#[test]
fn the_doctor_reads_version_6_and_names_an_unknown_key() {
    let (_dir, root) = workspace_with(&garden(""));
    let report = doctor::run(&root);
    for id in ["config.parse", "config.keys", "spaces.valid"] {
        let check = report.checks.iter().find(|check| check.id == id).unwrap();
        assert_eq!(check.status, CheckStatus::Pass, "{id}: {}", check.message);
    }
    let (_dir, root) =
        workspace_with(&garden("").replace("weight = 0.5", "weight = 0.5\nbands = 3"));
    let report = doctor::run(&root);
    let keys = report
        .checks
        .iter()
        .find(|check| check.id == "config.keys")
        .unwrap();
    assert_eq!(keys.status, CheckStatus::Fail);
    assert!(
        keys.message.contains("spaces.garden.meaning.bands"),
        "{}",
        keys.message
    );
    assert!(
        keys.suggestion
            .as_deref()
            .unwrap()
            .contains("versions 1 to 6")
    );
    // A space's own rules are the spaces check's.
    let (_dir, root) = workspace_with(&garden("").replace("person = \"human:local\"\n", ""));
    let report = doctor::run(&root);
    let spaces = report
        .checks
        .iter()
        .find(|check| check.id == "spaces.valid")
        .unwrap();
    assert_eq!(spaces.status, CheckStatus::Fail);
    assert!(
        spaces
            .message
            .contains("spaces.garden.collections.journal.own"),
        "{}",
        spaces.message
    );
}

// ── The schema file ────────────────────────────────────────────────────────────────────────────

fn schemas_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("schemas")
}

fn read(path: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap())
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

fn validator(version: u32) -> Validator {
    let schema = read(&schemas_dir().join(format!("workspace-config.v{version}.json")));
    jsonschema::meta::validate(&schema).unwrap();
    jsonschema::validator_for(&schema).unwrap()
}

fn as_toml(instance: &Value) -> String {
    toml::to_string(&toml::Value::try_from(instance).unwrap()).unwrap()
}

fn opens(instance: &Value) -> Result<(), WorkspaceError> {
    ConfigFile::parse(&as_toml(instance))
        .and_then(|file| file.into_config(Path::new("/w/example")))
        .map(drop)
}

/// `instance` with `edit` applied.
fn edited(instance: &Value, edit: impl FnOnce(&mut Value)) -> Value {
    let mut copy = instance.clone();
    edit(&mut copy);
    copy
}

/// Section 3's example as the JSON the schema describes.
fn garden_json() -> Value {
    json!({
        "config_version": 6,
        "spaces": { "garden": {
            "person": "human:local",
            "verified_admits": "affirmed",
            "collections": {
                "journal": { "root": "content/journal", "own": true },
                "talks": { "root": "content/talks", "own": true, "speaker": "Gardener" }
            },
            "meaning": { "model": "potion", "weight": 0.5, "k": 5 }
        } },
        "models": { "potion": {
            "provider": "static",
            "name": "potion-base-8m",
            "dir": "models/potion-base-8m",
            "files": {
                "model.safetensors": digest('1'),
                "tokenizer.json": digest('2'),
                "config.json": digest('3')
            }
        } },
        "plugins": {
            "enabled": ["notes"],
            "notes": { "grants": { "records_write": { "allow": ["garden"], "default_access": "private" } } }
        }
    })
}

fn http_json() -> Value {
    json!({
        "provider": "http",
        "name": "garden-embeddings",
        "url": "https://embeddings.example.com/v1/embeddings",
        "dimensions": 384,
        "version": "2026-11"
    })
}

fn onnx_json() -> Value {
    json!({
        "provider": "onnx",
        "name": "all-minilm-l6-v2",
        "dir": "models/minilm",
        "files": {
            "model.onnx": digest('4'),
            "tokenizer.json": digest('5'),
            "config.json": digest('6'),
            "special_tokens_map.json": digest('7'),
            "tokenizer_config.json": digest('8')
        }
    })
}

#[test]
fn the_schema_accepts_what_the_host_accepts() {
    let validator = validator(6);
    let base = garden_json();
    let accepted = [
        json!({ "config_version": 6 }),
        base.clone(),
        edited(&base, |c| {
            c["spaces"]["garden"]["verified_admits"] = json!("affirmed+attested");
            c["spaces"]["garden"]["meaning"] = json!({ "model": "potion" });
        }),
        edited(&base, |c| {
            c["spaces"]["garden"]["meaning"]["weight"] = json!(1)
        }),
        edited(&base, |c| {
            c["spaces"]["garden"]["meaning"]["weight"] = json!(0.0)
        }),
        edited(&base, |c| c["spaces"]["garden"]["meaning"]["k"] = json!(20)),
        edited(&base, |c| {
            c["plugins"]["notes"]["grants"]["records_write"]["default_access"] = json!("space");
        }),
        edited(&base, |c| {
            c["spaces"]["garden"]["collections"]["journal"]["own"] = json!(false);
        }),
        // A space with no person, and so no own collection.
        json!({ "config_version": 6, "spaces": { "garden": { "collections": { "handbook": { "root": "content/handbook", "own": false } } } } }),
        json!({ "config_version": 6, "spaces": { "garden": { "person": "human:corp/U019488227" } } }),
        json!({ "config_version": 6, "models": { "served": http_json() } }),
        json!({ "config_version": 6, "models": { "served": edited(&http_json(), |m| {
            m["url"] = json!("http://127.0.0.1:8090/v1/embeddings");
            m["bearer_env"] = json!("EMBEDDINGS_TOKEN");
            m["timeout_ms"] = json!(100);
            m["dimensions"] = json!(16);
        }) } }),
        json!({ "config_version": 6, "models": { "served": edited(&http_json(), |m| {
            m["url"] = json!("http://[::1]:8090/embed");
            m["dimensions"] = json!(4096);
        }) } }),
        json!({ "config_version": 6, "models": { "served": edited(&http_json(), |m| {
            m["url"] = json!("https://embeddings.example.com:65535/v1?model=small#top");
        }) } }),
        json!({ "config_version": 6, "models": { "served": edited(&http_json(), |m| {
            m["url"] = json!("https://[2001:db8::1]:8443/embed");
        }) } }),
        json!({ "config_version": 6, "models": { "served": edited(&http_json(), |m| {
            m["url"] = json!("http://127.255.255.255:1");
        }) } }),
        json!({ "config_version": 6, "models": { "served": edited(&http_json(), |m| {
            m["url"] = json!("https://embeddings.example.com");
        }) } }),
        json!({ "config_version": 6, "models": { "minilm": onnx_json() } }),
        json!({ "config_version": 6, "models": { "minilm": edited(&onnx_json(), |m| {
            m["pooling"] = json!("cls");
            m["max_length"] = json!(8192);
        }) } }),
    ];
    for instance in &accepted {
        if let Err(error) = validator.validate(instance) {
            panic!("the schema refused {instance}: {error}");
        }
        if let Err(error) = opens(instance) {
            panic!("the host refused {instance}: {error}");
        }
    }
}

#[test]
fn the_schema_refuses_what_the_host_refuses() {
    let validator = validator(6);
    let base = garden_json();
    let with = |edit: &dyn Fn(&mut Value)| edited(&base, |c| edit(c));
    let garden = |edit: &dyn Fn(&mut Value)| with(&|c| edit(&mut c["spaces"]["garden"]));
    let potion = |edit: &dyn Fn(&mut Value)| with(&|c| edit(&mut c["models"]["potion"]));
    let served = |edit: &dyn Fn(&mut Value)| json!({ "config_version": 6, "models": { "served": edited(&http_json(), |m| edit(m)) } });
    let minilm = |edit: &dyn Fn(&mut Value)| json!({ "config_version": 6, "models": { "minilm": edited(&onnx_json(), |m| edit(m)) } });
    let without = |model: &mut Value, key: &str| {
        model.as_object_mut().unwrap().remove(key);
    };
    let refused = [
        // Versions.
        with(&|c| c["config_version"] = json!(5)),
        json!({ "config_version": 7 }),
        // person, verified_admits, meaning.
        garden(&|s| s["person"] = json!("agent:helper")),
        garden(&|s| s["person"] = json!("local")),
        garden(&|s| s["person"] = json!("human:")),
        garden(&|s| s["verified_admits"] = json!("attested")),
        garden(&|s| s["verified_only"] = json!(true)),
        garden(&|s| s["meaning"] = json!({ "weight": 0.5 })),
        garden(&|s| s["meaning"]["model"] = json!("Potion")),
        garden(&|s| s["meaning"]["weight"] = json!(1.5)),
        garden(&|s| s["meaning"]["weight"] = json!(-0.1)),
        garden(&|s| s["meaning"]["weight"] = json!("half")),
        garden(&|s| s["meaning"]["k"] = json!(0)),
        garden(&|s| s["meaning"]["k"] = json!(21)),
        garden(&|s| s["meaning"]["threshold"] = json!(0.8)),
        garden(&|s| s["meaning"] = json!("potion")),
        // own and speaker.
        garden(&|s| without(s, "person")),
        garden(&|s| s["collections"]["journal"]["own"] = json!("yes")),
        garden(&|s| s["collections"]["journal"]["speaker"] = json!("")),
        garden(&|s| s["collections"]["talks"]["speaker"] = json!("g".repeat(129))),
        garden(&|s| s["collections"]["talks"]["own"] = json!(false)),
        garden(&|s| without(&mut s["collections"]["talks"], "own")),
        // The records_write table.
        with(&|c| {
            c["plugins"]["notes"]["grants"]["records_write"]["default_access"] = json!("public")
        }),
        with(&|c| c["plugins"]["notes"]["grants"]["records_write"]["writers"] = json!(["space"])),
        with(&|c| {
            without(
                &mut c["plugins"]["notes"]["grants"]["records_write"],
                "allow",
            )
        }),
        with(&|c| {
            c["plugins"]["notes"]["grants"]["index_write"] =
                json!({ "allow": ["garden"], "default_access": "space" })
        }),
        // Models: the id, the provider, the name.
        with(&|c| c["models"] = json!({ "Potion": c["models"]["potion"].clone() })),
        with(&|c| c["models"] = json!("potion")),
        potion(&|m| m["provider"] = json!("local")),
        potion(&|m| without(m, "provider")),
        potion(&|m| without(m, "name")),
        potion(&|m| m["name"] = json!("")),
        potion(&|m| m["quantize"] = json!(true)),
        // A static model.
        potion(&|m| without(m, "dir")),
        potion(&|m| m["dir"] = json!("/opt/models/potion")),
        potion(&|m| m["dir"] = json!("../models/potion")),
        potion(&|m| m["dir"] = json!("state/models/potion")),
        potion(&|m| without(m, "files")),
        potion(&|m| without(&mut m["files"], "config.json")),
        potion(&|m| m["files"]["vocab.txt"] = json!(digest('4'))),
        potion(&|m| m["files"]["config.json"] = json!("sha256:abc")),
        potion(&|m| m["files"]["config.json"] = json!(digest('1').to_uppercase())),
        potion(&|m| m["pooling"] = json!("mean")),
        potion(&|m| m["max_length"] = json!(128)),
        potion(&|m| m["url"] = json!("https://embeddings.example.com/v1")),
        potion(&|m| m["timeout_ms"] = json!(1000)),
        // An onnx model.
        minilm(&|m| without(&mut m["files"], "tokenizer_config.json")),
        minilm(&|m| m["pooling"] = json!("max")),
        minilm(&|m| m["max_length"] = json!(15)),
        minilm(&|m| m["max_length"] = json!(8193)),
        minilm(&|m| m["dimensions"] = json!(384)),
        // An http model.
        served(&|m| without(m, "url")),
        served(&|m| without(m, "dimensions")),
        served(&|m| without(m, "version")),
        served(&|m| m["url"] = json!("http://localhost:8090/v1/embeddings")),
        served(&|m| m["url"] = json!("http://embeddings.example.com/v1")),
        served(&|m| m["url"] = json!("http://10.0.0.5/embed")),
        served(&|m| m["url"] = json!("ftp://127.0.0.1/embed")),
        // The pattern and `check_model_url` agree on the host, the port and what follows.
        served(&|m| m["url"] = json!("http://127.999.0.1/x")),
        served(&|m| m["url"] = json!("http://127.01.0.1/x")),
        served(&|m| m["url"] = json!("http://127.1/x")),
        served(&|m| m["url"] = json!("http://[0:0:0:0:0:0:0:1]/x")),
        served(&|m| m["url"] = json!("http://[::2]/x")),
        served(&|m| m["url"] = json!("https://a_b.example/")),
        served(&|m| m["url"] = json!("https://token@embeddings.example.com/")),
        served(&|m| m["url"] = json!("https://embeddings.example.com:99999/")),
        served(&|m| m["url"] = json!("https://embeddings.example.com:65536/")),
        served(&|m| m["url"] = json!("https://embeddings.example.com:0/")),
        served(&|m| m["url"] = json!("https://embeddings.example.com:080/")),
        served(&|m| m["url"] = json!("https://embeddings.example.com:+80/")),
        served(&|m| m["url"] = json!("https://embeddings.example.com:/")),
        served(&|m| m["url"] = json!("https://embeddings.example.com/v1 /embed")),
        served(&|m| m["url"] = json!("https://embeddings.example.com/caf\u{e9}")),
        served(&|m| m["url"] = json!("https:///embed")),
        served(&|m| m["url"] = json!("https://[]/embed")),
        served(&|m| m["url"] = json!("")),
        served(&|m| m["dimensions"] = json!(15)),
        served(&|m| m["dimensions"] = json!(4097)),
        served(&|m| m["version"] = json!("")),
        served(&|m| m["version"] = json!("v".repeat(65))),
        served(&|m| m["bearer_env"] = json!("not a name")),
        served(&|m| m["timeout_ms"] = json!(99)),
        served(&|m| m["timeout_ms"] = json!(60_001)),
        served(&|m| m["dir"] = json!("models/served")),
        served(&|m| m["files"] = json!({ "model.onnx": digest('1') })),
        served(&|m| m["pooling"] = json!("mean")),
    ];
    for instance in &refused {
        assert!(
            !validator.is_valid(instance),
            "the schema accepted {instance}"
        );
        assert!(opens(instance).is_err(), "the host accepted {instance}");
    }
    // Rules across tables are the host's: the schema admits these, the host refuses them.
    let host_only = [
        // A model no `[models]` table declares.
        garden(&|s| s["meaning"]["model"] = json!("minilm")),
        // An own collection a grant covers, itself and through another space's root.
        with(&|c| {
            c["plugins"]["notes"]["grants"]["content_write"] = json!({ "allow": ["garden/*"] })
        }),
        with(&|c| {
            c["default_space"] = json!("garden");
            c["spaces"]["orchard"] = json!({ "collections": { "shared": { "root": "content" } } });
            c["plugins"]["notes"]["grants"]["content_write"] =
                json!({ "allow": ["orchard/shared"] });
        }),
    ];
    for instance in &host_only {
        assert!(validator.is_valid(instance), "{instance}");
        assert!(opens(instance).is_err(), "the host accepted {instance}");
    }
}

#[test]
fn the_version_6_examples_validate_and_open() {
    let validator = validator(6);
    let example = |name: &str| read(&schemas_dir().join("examples").join(name));
    for name in [
        "workspace-config.v6.json",
        "workspace-config.v6.records.json",
    ] {
        let instance = example(name);
        if let Err(error) = validator.validate(&instance) {
            panic!("{name}: {error}");
        }
        opens(&instance).unwrap_or_else(|error| panic!("{name}: {error}"));
    }
    // What `umbel init` writes is the bare example.
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("fresh");
    Workspace::init(&target, None).unwrap();
    let written: toml::Table = fs::read_to_string(target.join("umbel.toml"))
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(
        serde_json::to_value(written).unwrap(),
        example("workspace-config.v6.json")
    );

    let records = example("workspace-config.v6.records.json");
    let config = ConfigFile::parse(&as_toml(&records))
        .and_then(|file| file.into_config(Path::new("/w/example")))
        .unwrap();
    // The example read as JSON keeps no table order, so the models are compared by id.
    let mut providers: Vec<(&str, &str)> = config
        .models
        .iter()
        .map(|model| (model.id.as_str(), model.provider.as_str()))
        .collect();
    providers.sort_unstable();
    assert_eq!(
        providers,
        [("minilm", "onnx"), ("potion", "static"), ("served", "http")]
    );
    // The handbook takes files from a command, so it is not own; the journal and the talks are.
    assert!(config.command_writable("garden", "handbook"));
    assert!(!config.command_writable("garden", "journal"));
    let own: Vec<&str> = config.spaces[0]
        .collections
        .iter()
        .filter(|collection| collection.own)
        .map(|collection| collection.id.as_str())
        .collect();
    assert_eq!(own, ["journal", "talks"]);
    assert_eq!(
        config.spaces[1].verified_admits,
        VerifiedAdmits::AffirmedAttested
    );

    // Each version's schema refuses the other's files.
    let v5 = self::validator(5);
    assert!(!v5.is_valid(&records));
    assert!(!v5.is_valid(&example("workspace-config.v6.json")));
    assert!(!validator.is_valid(&example("workspace-config.v5.json")));
    // A version 5 file lifted to version 6 is a version 6 file: nothing was taken away.
    let mut lifted = example("workspace-config.v5.full.json");
    lifted["config_version"] = json!(6);
    validator.validate(&lifted).unwrap();
    for version in umbel::CONFIG_VERSIONS {
        assert!(
            schemas_dir()
                .join(format!("workspace-config.v{version}.json"))
                .is_file(),
            "{version}"
        );
    }
}
