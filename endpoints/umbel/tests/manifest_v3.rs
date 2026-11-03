//! The plugin manifest, version 3 (phase 3 specification, section 2.3): the `journal` key on
//! commands and pipelines, both modes and `keep`'s limits, a mode required of every command and
//! pipeline of a plugin holding `memory` or `memory_write`, `authority_prompt` and its limits,
//! neither key on a component command or a mounted tool, `memory_write` refused beside a document
//! write grant, the memory grants in the catalog and still unavailable, and versions 1 and 2 still
//! loading. Parsing only: digest journaling, a pipeline's inheritance of `digest` and of its steps'
//! `authority_prompt`, the seal-time refusal of a digest step feeding a plain step, and the prompt
//! itself are phase 3 step 4's, tested with the rest of this file there.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use support::plugins::{Raw, closure, config, seal};
use umbel::plugins::{JournalMode, MAX_AUTHORITY_PROMPT_CHARS, Manifest, PluginError};

const FILE: &str = "umbel-plugin.toml";

fn head(version: u32, kind: &str) -> String {
    let component = if kind == "component" {
        "\n[component]\npath = \"notes.wasm\"\n"
    } else {
        ""
    };
    format!(
        r#"manifest_version = {version}
protocol = 1

[plugin]
id = "notes"
title = "Notes"
version = "0.1.0"
description = "A plugin that remembers."
kind = "{kind}"
domains = ["notes"]
{component}"#
    )
}

fn grants(names: &[&str]) -> String {
    names
        .iter()
        .map(|name| format!("\n[[grants]]\nname = \"{name}\"\nreason = \"Needed.\"\n"))
        .collect()
}

/// A command `notes-<name>` with `keys` appended to its table.
fn command(name: &str, keys: &str) -> String {
    format!(
        "\n[[commands]]\nname = \"notes-{name}\"\ndescription = \"Do {name}.\"\neffects = [\"inspect\"]\ninput_schema = {{ type = \"object\" }}\n{keys}\n"
    )
}

/// A pipeline `notes-<name>` running `notes-<step>`, with `keys` appended to its table.
fn pipeline(name: &str, step: &str, keys: &str) -> String {
    format!(
        "\n[[pipelines]]\nname = \"notes-{name}\"\ndescription = \"Run {step}.\"\neffects = [\"inspect\"]\ninput_schema = {{ type = \"object\" }}\n{keys}\n[[pipelines.steps]]\ncommand = \"notes-{step}\"\n"
    )
}

fn v3(grant_names: &[&str], body: &str) -> String {
    format!("{}{}{body}", head(3, "compiled"), grants(grant_names))
}

fn parse(text: &str) -> Result<Manifest, PluginError> {
    Manifest::parse(text, FILE)
}

fn invalid(text: &str, key: &str) -> PluginError {
    let error = parse(text).expect_err(text);
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID", "{text}: {error}");
    assert!(
        error.message().contains(key),
        "{text}: {error} does not name {key}"
    );
    error
}

const DIGEST: &str = "journal = { mode = \"digest\", keep = [\"space\", \"project\"] }";
const PLAIN: &str = "journal = { mode = \"plain\" }";
const PROMPT: &str = "authority_prompt = \"Record this as your own word?\"";

// ── journal ────────────────────────────────────────────────────────────────────────────────────

#[test]
fn journal_takes_both_modes_and_is_stored() {
    let manifest = parse(&v3(
        &[],
        &format!(
            "{}{}{}{}",
            command("find", DIGEST),
            command("count", PLAIN),
            command("list", "journal = { mode = \"digest\" }"),
            pipeline("run", "find", PLAIN),
        ),
    ))
    .unwrap();
    assert_eq!(manifest.manifest_version, 3);
    let digest = manifest.commands[0].journal.as_ref().unwrap();
    assert_eq!(digest.mode, JournalMode::Digest);
    assert_eq!(digest.mode.as_str(), "digest");
    assert_eq!(digest.keep, ["space", "project"]);
    let plain = manifest.commands[1].journal.as_ref().unwrap();
    assert_eq!(plain.mode, JournalMode::Plain);
    assert!(plain.keep.is_empty());
    assert!(
        manifest.commands[2]
            .journal
            .as_ref()
            .unwrap()
            .keep
            .is_empty()
    );
    assert_eq!(
        manifest.pipelines[0].journal.as_ref().unwrap().mode,
        JournalMode::Plain
    );
    // Without a memory grant, journal is optional.
    let bare = parse(&v3(&["config"], &command("find", ""))).unwrap();
    assert_eq!(bare.commands[0].journal, None);
}

#[test]
fn keep_goes_with_digest_and_names_at_most_16_keys_once_each() {
    let sixteen: Vec<String> = (0..16).map(|n| format!("\"k{n}\"")).collect();
    let keep = |keys: &[String]| {
        format!(
            "journal = {{ mode = \"digest\", keep = [{}] }}",
            keys.join(", ")
        )
    };
    parse(&v3(&[], &command("find", &keep(&sixteen)))).unwrap();
    let seventeen: Vec<String> = (0..17).map(|n| format!("\"k{n}\"")).collect();
    let error = invalid(&v3(&[], &command("find", &keep(&seventeen))), "keep");
    assert!(error.message().contains("16"), "{error}");
    for (journal, key) in [
        ("journal = { mode = \"plain\", keep = [\"space\"] }", "keep"),
        (
            "journal = { mode = \"digest\", keep = [\"a\", \"a\"] }",
            "twice",
        ),
        ("journal = { mode = \"digest\", keep = [\"\"] }", "keep"),
        ("journal = { mode = \"digest\", keep = \"space\" }", "keep"),
        ("journal = { keep = [\"space\"] }", "mode"),
        ("journal = { mode = \"verbose\" }", "mode"),
        ("journal = { mode = \"digest\", redact = true }", "redact"),
        ("journal = \"digest\"", "journal"),
    ] {
        invalid(&v3(&[], &command("find", journal)), key);
        invalid(
            &v3(
                &[],
                &format!(
                    "{}{}",
                    command("find", ""),
                    pipeline("run", "find", journal)
                ),
            ),
            key,
        );
    }
}

#[test]
fn a_plugin_holding_memory_or_memory_write_declares_journal_everywhere() {
    for grant in ["memory", "memory_write"] {
        let both = format!(
            "{}{}",
            command("find", DIGEST),
            pipeline("run", "find", PLAIN)
        );
        parse(&v3(&[grant], &both)).unwrap();
        let error = invalid(
            &v3(
                &[grant],
                &format!("{}{}", command("find", DIGEST), command("count", "")),
            ),
            "commands[1].journal",
        );
        assert!(error.message().contains(grant), "{error}");
        invalid(
            &v3(
                &[grant],
                &format!("{}{}", command("find", DIGEST), pipeline("run", "find", "")),
            ),
            "pipelines[0].journal",
        );
    }
    // A plugin with neither grant may leave it out.
    parse(&v3(
        &["records"],
        &format!("{}{}", command("find", ""), pipeline("run", "find", "")),
    ))
    .unwrap();
}

// ── authority_prompt ───────────────────────────────────────────────────────────────────────────

#[test]
fn authority_prompt_needs_memory_write_and_is_at_most_500_characters() {
    let remember = |keys: &str| command("remember", &format!("{PLAIN}\n{keys}"));
    let manifest = parse(&v3(&["memory_write"], &remember(PROMPT))).unwrap();
    assert_eq!(
        manifest.commands[0].authority_prompt.as_deref(),
        Some("Record this as your own word?")
    );
    let longest = "x".repeat(MAX_AUTHORITY_PROMPT_CHARS);
    parse(&v3(
        &["memory_write"],
        &remember(&format!("authority_prompt = \"{longest}\"")),
    ))
    .unwrap();
    invalid(
        &v3(
            &["memory_write"],
            &remember(&format!("authority_prompt = \"{longest}x\"")),
        ),
        "authority_prompt",
    );
    invalid(
        &v3(&["memory_write"], &remember("authority_prompt = \"\"")),
        "authority_prompt",
    );
    invalid(
        &v3(
            &["memory_write"],
            &remember("authority_prompt = \"line\\u0007\""),
        ),
        "authority_prompt",
    );
    // Reading memory is not enough: only a memory write can get authority person.
    let error = invalid(&v3(&["memory"], &remember(PROMPT)), "authority_prompt");
    assert!(error.message().contains("memory_write"), "{error}");
    invalid(&v3(&[], &command("remember", PROMPT)), "authority_prompt");
    // A pipeline has no prompt of its own: it inherits its steps' from step 4.
    invalid(
        &v3(
            &["memory_write"],
            &format!(
                "{}{}",
                remember(PROMPT),
                pipeline("run", "remember", &format!("{PLAIN}\n{PROMPT}"))
            ),
        ),
        "authority_prompt",
    );
}

// ── Kinds ──────────────────────────────────────────────────────────────────────────────────────

#[test]
fn neither_key_is_available_to_a_component_command() {
    let component = |keys: &str| format!("{}{}", head(3, "component"), command("find", keys));
    parse(&component("")).unwrap();
    for keys in [PLAIN, DIGEST, PROMPT] {
        let key = keys.split(' ').next().unwrap();
        let error = invalid(&component(keys), key);
        assert!(error.message().contains("component"), "{error}");
    }
}

#[test]
fn neither_key_is_available_to_a_mounted_tool() {
    let mounted = |keys: &str| {
        format!(
            "{}\n[mount]\nprefix = \"notes\"\ntransport = \"stdio\"\ncommand = [\"notes-server\"]\n[[mount.tools]]\ntool = \"find\"\n{keys}\n",
            head(3, "mounted")
        )
    };
    parse(&mounted("")).unwrap();
    for keys in [PLAIN, PROMPT] {
        let key = keys.split(' ').next().unwrap();
        let error = invalid(&mounted(keys), key);
        assert!(error.message().contains("mounted tool"), "{error}");
    }
}

// ── Grants ─────────────────────────────────────────────────────────────────────────────────────

#[test]
fn memory_write_is_refused_beside_a_document_write_grant() {
    for other in [
        "documents_write",
        "records_write",
        "index_write",
        "graph_write",
        "content_write",
    ] {
        let error = invalid(
            &v3(&["memory_write", other], &command("find", PLAIN)),
            "grants",
        );
        assert!(error.message().contains(other), "{error}");
    }
    // Reading memory beside a document write is allowed, as is reading documents beside a memory
    // write.
    parse(&v3(&["memory", "records_write"], &command("find", PLAIN))).unwrap();
    parse(&v3(&["memory_write", "documents"], &command("find", PLAIN))).unwrap();
}

#[test]
fn store_write_is_satisfied_by_memory_write() {
    let remember = command("remember", PLAIN).replace("[\"inspect\"]", "[\"store-write\"]");
    parse(&v3(&["memory_write"], &remember)).unwrap();
    invalid(&v3(&["memory"], &remember), "store-write");
}

#[test]
fn the_memory_grants_are_in_the_catalog_and_still_unavailable() {
    let manifest = |required: bool| {
        format!(
            "{}\n[[grants]]\nname = \"memory\"\nrequired = {required}\nreason = \"Reads memory.\"\n{}",
            head(3, "compiled"),
            command("find", PLAIN)
        )
    };
    let plugin = |text: String| {
        Raw::new(text, |_| {
            Ok(vec![closure("notes-find", |input, _| afd::success(input))])
        })
    };
    let dir = support::workspace(&config(&[("notes", "")], ""));
    let error = seal(dir.path(), |b| b.with_compiled(plugin(manifest(true))))
        .err()
        .unwrap();
    assert_eq!(error.code(), "PLUGIN_GRANT_UNAVAILABLE", "{error}");
    assert!(error.message().contains("memory"), "{error}");
    assert!(error.message().contains("phase 3"), "{error}");
    // Optional: withheld, and the plugin loads.
    seal(dir.path(), |b| b.with_compiled(plugin(manifest(false)))).unwrap();
}

// ── Versions ───────────────────────────────────────────────────────────────────────────────────

#[test]
fn versions_1_and_2_still_load_and_refuse_what_version_3_adds() {
    for version in [1, 2] {
        let body = command("find", "");
        let manifest = parse(&format!("{}{body}", head(version, "compiled"))).unwrap();
        assert_eq!(manifest.manifest_version, version);
        assert_eq!(manifest.commands[0].journal, None);
        assert_eq!(manifest.commands[0].authority_prompt, None);
        for keys in [PLAIN, PROMPT] {
            let key = keys.split(' ').next().unwrap();
            let error = invalid(
                &format!("{}{}", head(version, "compiled"), command("find", keys)),
                key,
            );
            assert!(error.message().contains("manifest_version = 3"), "{error}");
        }
        let error = invalid(
            &format!(
                "{}{}{}",
                head(version, "compiled"),
                command("find", ""),
                pipeline("run", "find", PLAIN)
            ),
            "journal",
        );
        assert!(error.message().contains("manifest_version = 3"), "{error}");
    }
    assert_eq!(umbel::MANIFEST_VERSION, 3);
}
