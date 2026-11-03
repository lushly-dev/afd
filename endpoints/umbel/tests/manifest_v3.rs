//! The plugin manifest, version 3 (phase 3 specification, section 2.3): the `journal` key on
//! commands and pipelines, both modes and `keep`'s limits, a mode required of every command and
//! pipeline of a plugin holding `memory` or `memory_write`, `authority_prompt` and its limits,
//! neither key on a component command or a mounted tool, `memory_write` refused beside a document
//! write grant, the memory grants in the catalog and granted to a compiled plugin, versions 1 and 2
//! still loading; and at seal (phase 3 step 4), a pipeline's inheritance of `digest` and of its
//! steps' `authority_prompt` in step order, and the refusal of a digest step feeding a plain one.
//! Digest journaling itself is `journal_digest.rs`'s and the prompt `cli_authority_prompt.rs`'s.
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
fn the_memory_grants_are_in_the_catalog_and_granted_to_a_compiled_plugin() {
    let manifest = format!(
        "{}\n[[grants]]\nname = \"memory\"\nreason = \"Reads memory.\"\n{}",
        head(3, "compiled"),
        command("find", PLAIN)
    );
    let plugin = Raw::new(manifest, |services| {
        assert!(services.is_granted("memory"));
        Ok(vec![closure("notes-find", |input, _| afd::success(input))])
    });
    let dir = support::workspace(&config(&[("notes", "")], ""));
    seal(dir.path(), |b| b.with_compiled(plugin)).unwrap();
    assert!(umbel::plugins::PENDING_GRANTS.is_empty());
}

// ── Pipelines at seal ──────────────────────────────────────────────────────────────────────────

/// A memory plugin with the commands `notes-<name>` (each with its `keys`) and `pipelines`.
fn memory_plugin(commands: &[(&str, &str)], pipelines: &str) -> Raw {
    let body: String = commands
        .iter()
        .map(|(name, keys)| command(name, keys))
        .collect();
    let names: Vec<String> = commands
        .iter()
        .map(|(name, _)| format!("notes-{name}"))
        .collect();
    Raw::new(
        format!("{}{pipelines}", v3(&["memory"], &body)),
        move |_| {
            Ok(names
                .iter()
                .map(|name| closure(name, |input, _| afd::success(input)))
                .collect())
        },
    )
}

/// A pipeline over steps `(command, input TOML)`.
fn steps_pipeline(name: &str, steps: &[(&str, &str)]) -> String {
    let mut text = format!(
        "\n[[pipelines]]\nname = \"notes-{name}\"\ndescription = \"Run steps.\"\neffects = [\"inspect\"]\ninput_schema = {{ type = \"object\" }}\n{PLAIN}\n"
    );
    for (step, input) in steps {
        text.push_str(&format!(
            "[[pipelines.steps]]\ncommand = \"notes-{step}\"\n{input}\n"
        ));
    }
    text
}

fn seal_plugin(plugin: Raw) -> Result<umbel::Host, umbel::HostError> {
    let dir = support::workspace(&config(&[("notes", "")], ""));
    let sealed = seal(dir.path(), |b| b.with_compiled(plugin));
    drop(dir);
    sealed
}

#[test]
fn a_digest_step_feeding_a_plain_step_is_refused_at_seal() {
    let commands = [("read", DIGEST), ("plain", PLAIN), ("other", DIGEST)];
    for reference in ["$prev.text", "$first", "$steps[0].text", "$steps.got.text"] {
        let pipeline = steps_pipeline(
            "flow",
            &[
                ("read", "as = \"got\""),
                ("plain", &format!("input = {{ copied = \"{reference}\" }}")),
            ],
        );
        let error = seal_plugin(memory_plugin(&commands, &pipeline))
            .err()
            .unwrap();
        assert_eq!(
            error.code(),
            "PLUGIN_MANIFEST_INVALID",
            "{reference}: {error}"
        );
        assert!(
            error.message().contains("pipelines[0].steps[1].input"),
            "{error}"
        );
    }
    // `$input`, a literal and a digest consumer are all allowed.
    for (step, input) in [
        ("plain", "input = { copied = \"$input.text\" }"),
        ("plain", "input = { copied = \"$$prev\" }"),
        ("other", "input = { copied = \"$prev.text\" }"),
    ] {
        let pipeline = steps_pipeline("flow", &[("read", ""), (step, input)]);
        seal_plugin(memory_plugin(&commands, &pipeline)).unwrap();
    }
}

#[test]
fn a_pipeline_inherits_digest_and_its_steps_authority_prompts_in_step_order() {
    // The prompts need memory_write, which needs an allow list: the CLI test of this file's
    // neighbour drives them end to end. Here the inheritance is read from the prompt the CLI asks.
    let commands = format!(
        "{}{}{}",
        command(
            "first",
            &format!("{DIGEST}\nauthority_prompt = \"First prompt.\"")
        )
        .replace("[\"inspect\"]", "[\"store-write\"]"),
        command("second", PLAIN),
        command(
            "third",
            &format!("{PLAIN}\nauthority_prompt = \"Third prompt.\"")
        )
        .replace("[\"inspect\"]", "[\"store-write\"]"),
    );
    let pipeline = steps_pipeline("all", &[("first", ""), ("second", ""), ("third", "")])
        .replace("[\"inspect\"]", "[\"store-write\"]");
    let text = format!("{}{pipeline}", v3(&["memory_write"], &commands));
    let plugin = || {
        Raw::new(text.clone(), |_| {
            Ok(["notes-first", "notes-second", "notes-third"]
                .into_iter()
                .map(|name| closure(name, |input, _| afd::success(input)))
                .collect())
        })
    };
    let config = "config_version = 4\ndefault_space = \"main\"\n[spaces.main]\n[plugins]\nenabled = [\"notes\"]\n[plugins.notes]\nsource = \"compiled:notes\"\n[plugins.notes.grants.memory_write]\nallow = [\"main\"]\n";
    let dir = support::workspace(config);
    let console = support::Scripted::new(true, true);
    let run = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(support::cli_with(
            dir.path(),
            &["notes", "all"],
            console.clone(),
            |b| b.with_compiled(plugin()),
        ));
    assert_eq!(run.code, 0, "{}", run.stdout);
    let asked = console.asked();
    assert_eq!(asked.len(), 1, "{asked:?}");
    let first = asked[0].find("notes-first: First prompt.").unwrap();
    let third = asked[0].find("notes-third: Third prompt.").unwrap();
    assert!(first < third, "{asked:?}");
    // Digest, with no kept key, although the pipeline declares plain.
    let entry = support::journal_entries(dir.path())
        .into_iter()
        .find(|entry| entry.command == "notes-all")
        .unwrap();
    assert_eq!(entry.input["dev.umbel/journal"], "digest");
    assert_eq!(entry.input["keep"], serde_json::json!({}));
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
    // Version 4 (phase 4) is tested in `manifest_v4.rs`.
    assert!(umbel::MANIFEST_VERSIONS.contains(&3));
}
