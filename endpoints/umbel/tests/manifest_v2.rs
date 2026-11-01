//! The plugin manifest, version 2 (phase 2 specification, section 3.4): the effects
//! `store-write` and `workspace-write` with and without their grants, `output_budget`,
//! `confirm = "require-human"`, and version 1 still loading. Parsing only: the grants themselves,
//! the budget's wiring and the terminal prompt are step 4's, tested below and in
//! `require_human.rs`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::plugins::{leak, seal};
use umbel::plugins::{Asset, Effect, Manifest, PluginError, sdk};
use umbel_sdk::{Cx, Outcome, Plugin, success};

const FILE: &str = "umbel-plugin.toml";

fn head(version: u32, kind: &str) -> String {
    format!(
        r#"manifest_version = {version}
protocol = 1

[plugin]
id = "notes"
title = "Notes"
version = "0.1.0"
description = "A plugin that writes."
kind = "{kind}"
domains = ["notes"]
"#
    )
}

const COMMAND: &str = r#"
[[commands]]
name = "notes-add"
description = "Add a note."
effects = ["store-write"]
input_schema = { type = "object", properties = {}, additionalProperties = false }
"#;

fn grant(name: &str) -> String {
    format!("\n[[grants]]\nname = \"{name}\"\nreason = \"Needed.\"\n")
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

/// A version 2 compiled manifest whose one command is `body` after the shared prologue.
fn v2(grants: &[&str], command: &str) -> String {
    let mut text = head(2, "compiled");
    for name in grants {
        text.push_str(&grant(name));
    }
    text.push_str(command);
    text
}

// ── Versions ───────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_host_reads_manifest_versions_1_and_2_and_no_other() {
    let one = parse(&head(1, "compiled")).unwrap();
    assert_eq!(one.manifest_version, 1);
    let two = parse(&head(2, "compiled")).unwrap();
    assert_eq!(two.manifest_version, 2);
    assert_eq!(umbel::MANIFEST_VERSIONS, [1, 2]);
    for other in [0, 3] {
        let error = parse(&head(other, "compiled")).unwrap_err();
        assert_eq!(error.code(), "PLUGIN_PROTOCOL_UNSUPPORTED", "{other}");
        assert!(error.message().contains("manifest_version"), "{error}");
        assert!(error.suggestion().contains("versions 1 and 2"), "{error}");
    }
    let text = head(2, "compiled").replace("manifest_version = 2", "manifest_version = \"2\"");
    invalid(&text, "manifest_version");
    let missing = head(2, "compiled").replace("manifest_version = 2\n", "");
    let error = invalid(&missing, "manifest_version");
    assert!(
        error.message().contains("set manifest_version = 2"),
        "{error}"
    );
}

#[test]
fn a_version_1_manifest_loads_as_before_and_refuses_what_version_2_adds() {
    let v1 = format!(
        "{}\n[[commands]]\nname = \"notes-list\"\ndescription = \"List.\"\neffects = [\"plugin-state\"]\ninput_schema = {{ type = \"object\" }}\n",
        head(1, "compiled")
    );
    let manifest = parse(&v1).unwrap();
    assert_eq!(manifest.commands[0].effects, [Effect::PluginState]);
    assert!(!manifest.commands[0].require_human);
    assert_eq!(manifest.commands[0].output_budget, None);

    for effect in ["store-write", "workspace-write"] {
        let text = v1.replace("\"plugin-state\"", &format!("\"{effect}\""));
        let error = invalid(&text, "commands[0].effects");
        assert!(
            error.message().contains("needs manifest_version = 2"),
            "{error}"
        );
    }
    for (key, value) in [
        ("output_budget", "{ default_bytes = 1, max_bytes = 2 }"),
        ("confirm", "\"require-human\""),
    ] {
        let text = format!("{v1}{key} = {value}\n");
        let error = invalid(&text, &format!("commands[0].{key}"));
        assert!(error.message().contains("reserved"), "{error}");
        assert!(
            error
                .message()
                .contains("manifest version 1 does not define it"),
            "{error}"
        );
    }
}

// ── Effects and their grants ───────────────────────────────────────────────────────────────────

#[test]
fn store_write_needs_one_store_write_grant_declared() {
    for grant_name in [
        "documents_write",
        "records_write",
        "index_write",
        "graph_write",
    ] {
        let manifest = parse(&v2(&[grant_name], COMMAND)).unwrap();
        assert_eq!(manifest.commands[0].effects, [Effect::StoreWrite]);
        assert!(manifest.commands[0].mutation());
    }
    let error = invalid(&v2(&[], COMMAND), "commands[0].effects");
    assert!(error.message().contains("documents_write"), "{error}");
    // Reading is not writing: the read grants do not make a write command.
    for read in [
        "documents",
        "records",
        "index",
        "graph",
        "content",
        "content_write",
    ] {
        invalid(&v2(&[read], COMMAND), "commands[0].effects");
    }
}

#[test]
fn workspace_write_needs_content_write_declared() {
    let command = COMMAND.replace("store-write", "workspace-write");
    let manifest = parse(&v2(&["content_write"], &command)).unwrap();
    assert_eq!(manifest.commands[0].effects, [Effect::WorkspaceWrite]);
    let error = invalid(&v2(&["documents_write"], &command), "commands[0].effects");
    assert!(error.message().contains("content_write"), "{error}");
    invalid(&v2(&["content"], &command), "commands[0].effects");
}

#[test]
fn the_two_effects_combine_with_each_other_and_with_the_older_ones() {
    let command = COMMAND.replace(
        "[\"store-write\"]",
        "[\"store-write\", \"workspace-write\", \"plugin-state\"]",
    );
    let manifest = parse(&v2(&["documents_write", "content_write"], &command)).unwrap();
    assert_eq!(
        manifest.commands[0].effects,
        [
            Effect::StoreWrite,
            Effect::WorkspaceWrite,
            Effect::PluginState
        ]
    );
    // `inspect` still appears alone, and a name is not repeated.
    let with_inspect = COMMAND.replace("[\"store-write\"]", "[\"inspect\", \"store-write\"]");
    let error = invalid(
        &v2(&["documents_write"], &with_inspect),
        "commands[0].effects",
    );
    assert!(error.message().contains("alone"), "{error}");
    let twice = COMMAND.replace("[\"store-write\"]", "[\"store-write\", \"store-write\"]");
    invalid(&v2(&["documents_write"], &twice), "commands[0].effects");
    let unknown = COMMAND.replace("store-write", "store-read");
    let error = invalid(&v2(&["documents_write"], &unknown), "commands[0].effects");
    assert!(
        error.message().contains("store-write or workspace-write"),
        "{error}"
    );
}

#[test]
fn a_pipeline_may_cover_the_new_effects_without_naming_grants() {
    let text = format!(
        "{}\n[[pipelines]]\nname = \"notes-refresh\"\ndescription = \"Refresh.\"\neffects = [\"store-write\"]\ninput_schema = {{ type = \"object\" }}\n[[pipelines.steps]]\ncommand = \"notes-add\"\n",
        v2(&["documents_write"], COMMAND)
    );
    let manifest = parse(&text).unwrap();
    assert_eq!(manifest.pipelines[0].effects, [Effect::StoreWrite]);
}

#[test]
fn a_mounted_tool_cannot_name_the_new_effects() {
    let text = format!(
        "{}\n[mount]\nprefix = \"notes\"\ntransport = \"stdio\"\ncommand = [\"x\"]\n[[mount.tools]]\ntool = \"a\"\neffects = [\"store-write\"]\n",
        head(2, "mounted")
    );
    let error = invalid(&text, "mount.tools[0].effects");
    assert!(error.message().contains("mounted"), "{error}");
}

#[test]
fn the_new_effects_are_projected_as_their_manifest_spelling() {
    assert_eq!(Effect::StoreWrite.as_str(), "store-write");
    assert_eq!(Effect::WorkspaceWrite.as_str(), "workspace-write");
    assert!(Effect::StoreWrite.mutation() && Effect::WorkspaceWrite.mutation());
}

// ── output_budget ──────────────────────────────────────────────────────────────────────────────

fn budgeted(kind: &str, budget: &str) -> String {
    let mut text = head(2, kind);
    if kind == "component" {
        text.push_str("\n[component]\npath = \"x.wasm\"\n");
    }
    text.push_str(
        "\n[[commands]]\nname = \"notes-find\"\ndescription = \"Find.\"\neffects = [\"inspect\"]\ninput_schema = { type = \"object\" }\n",
    );
    text.push_str(&format!("output_budget = {budget}\n"));
    text
}

#[test]
fn output_budget_is_stored_for_a_compiled_plugin() {
    let manifest = parse(&budgeted(
        "compiled",
        "{ default_bytes = 24000, max_bytes = 96000 }",
    ))
    .unwrap();
    let budget = manifest.commands[0].output_budget.unwrap();
    assert_eq!((budget.default_bytes, budget.max_bytes), (24_000, 96_000));
    let equal = parse(&budgeted(
        "compiled",
        "{ default_bytes = 5, max_bytes = 5 }",
    ))
    .unwrap();
    assert_eq!(equal.commands[0].output_budget.unwrap().max_bytes, 5);
    let none = parse(&format!(
        "{}\n[[commands]]\nname = \"notes-find\"\ndescription = \"Find.\"\neffects = [\"inspect\"]\ninput_schema = {{ type = \"object\" }}\n",
        head(2, "compiled")
    ))
    .unwrap();
    assert_eq!(none.commands[0].output_budget, None);
}

#[test]
fn output_budget_is_closed_positive_and_ordered() {
    for (budget, key) in [
        ("{ default_bytes = 0, max_bytes = 10 }", "default_bytes"),
        ("{ default_bytes = 10, max_bytes = 0 }", "max_bytes"),
        ("{ default_bytes = -1, max_bytes = 10 }", "default_bytes"),
        ("{ default_bytes = 11, max_bytes = 10 }", "default_bytes"),
        ("{ default_bytes = 10 }", "max_bytes"),
        ("{ max_bytes = 10 }", "default_bytes"),
        ("{ default_bytes = 1.5, max_bytes = 10 }", "default_bytes"),
        (
            "{ default_bytes = \"10\", max_bytes = 10 }",
            "default_bytes",
        ),
        ("{ default_bytes = 1, max_bytes = 10, bogus = 1 }", "bogus"),
        ("10", "output_budget"),
    ] {
        invalid(&budgeted("compiled", budget), key);
    }
}

#[test]
fn output_budget_is_refused_to_a_component_naming_world_1_1_0() {
    let error = invalid(
        &budgeted("component", "{ default_bytes = 1, max_bytes = 2 }"),
        "commands[0].output_budget",
    );
    assert!(
        error.message().contains("umbel:plugin/plugin@1.1.0"),
        "{error}"
    );
    assert!(error.message().contains("component"), "{error}");
}

// ── confirm = "require-human" ──────────────────────────────────────────────────────────────────

fn human_only(extra: &str) -> String {
    v2(
        &["documents_write"],
        &format!(
            "{COMMAND}confirm_prompt = \"Apply this change?\"\napproval = \"required\"\nconfirm = \"require-human\"\nexpose = {{ mcp = false, agent = false, cli = true{extra} }}\n"
        ),
    )
}

#[test]
fn require_human_needs_a_prompt_and_cli_only_exposure() {
    let manifest = parse(&human_only("")).unwrap();
    let command = &manifest.commands[0];
    assert!(command.require_human);
    assert!(command.approval_required);
    assert_eq!(
        command.confirm_prompt.as_deref(),
        Some("Apply this change?")
    );
    assert!(!command.expose.mcp && !command.expose.agent && command.expose.cli);
    // A palette entry is the host's own surface, not a remote one: allowed.
    assert!(
        parse(&human_only(", palette = true")).unwrap().commands[0]
            .expose
            .palette
    );

    // The CLI exposure may be left to its default (true).
    let default_cli = v2(
        &["documents_write"],
        &format!(
            "{COMMAND}confirm_prompt = \"Apply?\"\nconfirm = \"require-human\"\nexpose = {{ mcp = false, agent = false }}\n"
        ),
    );
    assert!(parse(&default_cli).unwrap().commands[0].require_human);
}

#[test]
fn require_human_without_its_requirements_is_invalid_naming_confirm() {
    let no_prompt = v2(
        &["documents_write"],
        &format!(
            "{COMMAND}confirm = \"require-human\"\nexpose = {{ mcp = false, agent = false, cli = true }}\n"
        ),
    );
    let error = invalid(&no_prompt, "commands[0].confirm");
    assert!(error.message().contains("confirm_prompt"), "{error}");

    for expose in [
        "",
        "expose = { mcp = true, agent = false, cli = true }\n",
        "expose = { mcp = false, agent = true, cli = true }\n",
        "expose = { mcp = false, agent = false, cli = false }\n",
        "expose = { cli = true }\n",
    ] {
        let text = v2(
            &["documents_write"],
            &format!("{COMMAND}confirm_prompt = \"Apply?\"\nconfirm = \"require-human\"\n{expose}"),
        );
        let error = invalid(&text, "commands[0].confirm");
        assert!(error.message().contains("mcp = false"), "{expose}: {error}");
    }
}

#[test]
fn require_human_has_one_value() {
    for value in ["\"always\"", "\"require_human\"", "\"\"", "true", "1"] {
        let text = v2(
            &["documents_write"],
            &format!(
                "{COMMAND}confirm_prompt = \"Apply?\"\nconfirm = {value}\nexpose = {{ mcp = false, agent = false }}\n"
            ),
        );
        invalid(&text, "commands[0].confirm");
    }
}

// ── Messages and the older reserved keys ───────────────────────────────────────────────────────

#[test]
fn reserved_keys_name_the_manifest_version_they_were_read_under() {
    // A top-level key must precede the first table.
    let text = head(2, "compiled").replacen("protocol = 1\n", "protocol = 1\nui = 1\n", 1);
    let error = invalid(&text, "ui");
    assert!(
        error
            .message()
            .contains("manifest version 2 does not define it"),
        "{error}"
    );
}

// ── The budget, wired (step 4) ─────────────────────────────────────────────────────────────────

/// A compiled plugin whose one command declares a budget of 200 bytes by default, 1000 at most,
/// and answers `pad` bytes of padding beside the budget it was handed.
struct Budgeted {
    manifest: &'static str,
}

impl Plugin for Budgeted {
    fn manifest(&self) -> &'static str {
        self.manifest
    }

    fn assets(&self) -> &'static [Asset] {
        &[]
    }

    fn handle(&self, _name: &str, input: Value, cx: &mut Cx) -> Outcome {
        let pad = input.get("pad").and_then(Value::as_u64).unwrap_or(0);
        success(json!({
            "budget": cx.call().output_budget,
            "pad": "x".repeat(usize::try_from(pad).unwrap()),
        }))
    }
}

fn budgeted_plugin() -> Budgeted {
    let text = format!(
        "{}\n[[commands]]\nname = \"notes-find\"\ndescription = \"Find.\"\neffects = [\"inspect\"]\ninput_schema = {{ type = \"object\", properties = {{ pad = {{ type = \"integer\" }} }}, additionalProperties = false }}\noutput_budget = {{ default_bytes = 200, max_bytes = 1000 }}\n\n[[commands]]\nname = \"notes-plain\"\ndescription = \"Plain.\"\neffects = [\"inspect\"]\ninput_schema = {{ type = \"object\", properties = {{ pad = {{ type = \"integer\" }} }}, additionalProperties = false }}\n",
        head(2, "compiled")
    );
    Budgeted {
        manifest: leak(text),
    }
}

#[tokio::test]
async fn a_declared_output_budget_reaches_the_handler_and_afd_enforces_it() {
    let dir = support::workspace(&support::plugins::config(&[("notes", "")], ""));
    let host = seal(dir.path(), |b| b.with_compiled(sdk(budgeted_plugin()))).unwrap();
    let execute = |input: Value, ask: Option<u64>| {
        let host = &host;
        async move {
            let mut context = host.context(support::agent("a"));
            if let Some(ask) = ask {
                context = context.with_output_budget_ask(ask);
            }
            host.registry()
                .execute("notes-find", input, Some(context))
                .await
        }
    };
    // The default budget is what the handler sees, and a result inside it is returned.
    let small = execute(json!({"pad": 10}), None).await;
    assert!(small.success, "{small:?}");
    assert_eq!(small.data.unwrap()["budget"], 200);
    // A result over it is replaced by AFD's failure, which says what the caller may ask for.
    let big = execute(json!({"pad": 500}), None).await;
    assert_eq!(
        big.error.as_ref().unwrap().code,
        "OUTPUT_BUDGET_EXCEEDED",
        "{big:?}"
    );
    // The caller asks for more: the handler sees the ask, clamped to the maximum.
    let asked = execute(json!({"pad": 500}), Some(800)).await;
    assert!(asked.success, "{asked:?}");
    assert_eq!(asked.data.unwrap()["budget"], 800);
    let clamped = execute(json!({"pad": 10}), Some(5000)).await;
    assert_eq!(clamped.data.unwrap()["budget"], 1000);
    // A command without a declaration has no budget and no limit.
    let plain = host
        .registry()
        .execute(
            "notes-plain",
            json!({"pad": 5000}),
            Some(host.context(support::agent("a"))),
        )
        .await;
    assert!(plain.success);
    assert_eq!(plain.data.unwrap()["budget"], Value::Null);
}
