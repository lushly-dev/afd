//! The plugin manifest, version 4 (phase 4 specification, section 2.2; D97, D105): the command key
//! `confirm_preview` and what it may name, refused on component commands, mounted tools and
//! pipelines; the pipeline keys `expose` and `result`, parsed and stored; versions 1 to 3 still
//! loading, with every pipeline exposed to every surface and returning every step; and a version
//! 4 plugin sealing, with its pipeline no wider than its steps. What acts on the keys is step 2's
//! and is tested there: the CLI's preview (`cli_confirm_preview.rs`), and a pipeline's exposure at
//! seal and its `result` (`pipeline_expose.rs`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::fs;

use support::plugins::{Raw, closure, config, seal};
use umbel::plugins::{Expose, Manifest, PipelineResult, PluginError};

const FILE: &str = "umbel-plugin.toml";

fn head(version: u32, kind: &str) -> String {
    let component = if kind == "component" {
        "\n[component]\npath = \"review.wasm\"\n"
    } else {
        ""
    };
    format!(
        r#"manifest_version = {version}
protocol = 1

[plugin]
id = "review"
title = "Review"
version = "0.1.0"
description = "A plugin that decides."
kind = "{kind}"
domains = ["review"]
{component}
[[grants]]
name = "records_write"
reason = "Records decisions."
"#
    )
}

/// A command `review-<name>` with `keys` appended to its table, `input` its input properties.
fn command(name: &str, effects: &str, input: &str, keys: &str) -> String {
    format!(
        "\n[[commands]]\nname = \"review-{name}\"\ndescription = \"Do {name}.\"\neffects = [{effects}]\ninput_schema = {{ type = \"object\", properties = {{ {input} }} }}\n{keys}\n"
    )
}

const CLI_ONLY: &str = "expose = { mcp = false, agent = false, cli = true }";
const RETURNS: &str = "returns = { type = \"object\", properties = { preview = { type = \"string\" } }, required = [\"preview\"], additionalProperties = false }";
const JOURNAL: &str = "journal = { mode = \"digest\", keep = [\"change\"] }";
const SPACE_AND_CHANGE: &str = "space = { type = \"string\" }, change = { type = \"string\" }";

/// `review-approve`, gated by a person and previewed by `review-<preview>`.
fn approve(preview: &str) -> String {
    command(
        "approve",
        "\"store-write\"",
        &format!("{SPACE_AND_CHANGE}, note = {{ type = \"string\" }}"),
        &format!(
            "confirm_prompt = \"Apply it?\"\nconfirm = \"require-human\"\n{CLI_ONLY}\nconfirm_preview = \"review-{preview}\""
        ),
    )
}

/// The preview command `review-preview`, with `keys` replacing its defaults where given.
fn preview(input: &str, keys: &str) -> String {
    command("preview", "\"inspect\"", input, keys)
}

fn good_preview() -> String {
    preview(
        SPACE_AND_CHANGE,
        &format!("{CLI_ONLY}\n{JOURNAL}\n{RETURNS}"),
    )
}

/// A pipeline `review-<name>` running `review-preview`, with `keys` appended to its table.
fn pipeline(name: &str, keys: &str) -> String {
    format!(
        "\n[[pipelines]]\nname = \"review-{name}\"\ndescription = \"Run it.\"\neffects = [\"inspect\"]\ninput_schema = {{ type = \"object\" }}\n{keys}\n[[pipelines.steps]]\ncommand = \"review-preview\"\n"
    )
}

fn v4(body: &str) -> String {
    format!("{}{body}", head(4, "compiled"))
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

// ── confirm_preview ────────────────────────────────────────────────────────────────────────────

#[test]
fn confirm_preview_names_a_command_and_is_stored() {
    let manifest = parse(&v4(&format!("{}{}", approve("preview"), good_preview()))).unwrap();
    assert_eq!(manifest.manifest_version, 4);
    assert_eq!(
        manifest.commands[0].confirm_preview.as_deref(),
        Some("review-preview")
    );
    assert_eq!(manifest.commands[1].confirm_preview, None);
    // Not acted on in step 1: the gate keeps its static prompt.
    assert!(manifest.commands[0].require_human);
    assert_eq!(
        manifest.commands[0].confirm_prompt.as_deref(),
        Some("Apply it?")
    );
}

#[test]
fn confirm_preview_needs_confirm_prompt_and_a_command_name() {
    let without_prompt = command(
        "approve",
        "\"inspect\"",
        SPACE_AND_CHANGE,
        "confirm_preview = \"review-preview\"",
    );
    let error = invalid(
        &v4(&format!("{without_prompt}{}", good_preview())),
        "commands[0].confirm_preview",
    );
    assert!(error.message().contains("confirm_prompt"), "{error}");
    for name in ["\"\"", "\"Review_Preview\"", "true", "[\"review-preview\"]"] {
        let gated = approve("preview").replace("\"review-preview\"", name);
        invalid(
            &v4(&format!("{gated}{}", good_preview())),
            "commands[0].confirm_preview",
        );
    }
}

#[test]
fn the_named_command_must_be_one_of_this_plugins_commands() {
    let error = invalid(&v4(&approve("missing")), "commands[0].confirm_preview");
    assert!(error.message().contains("review-missing"), "{error}");
    assert!(error.message().contains("not a command"), "{error}");
    // A pipeline is not a preview, even one of this plugin.
    let error = invalid(
        &v4(&format!(
            "{}{}{}",
            approve("sweep"),
            good_preview(),
            pipeline("sweep", "")
        )),
        "commands[0].confirm_preview",
    );
    assert!(error.message().contains("pipeline"), "{error}");
    // Another plugin's command is not this plugin's.
    let other = approve("preview").replace("\"review-preview\"", "\"knowledge-proposal-preview\"");
    invalid(
        &v4(&format!("{other}{}", good_preview())),
        "commands[0].confirm_preview",
    );
}

#[test]
fn the_preview_is_an_inspect_command_with_cli_exposure_and_a_journal() {
    let case = |preview: String, says: &str| {
        let error = invalid(
            &v4(&format!("{}{preview}", approve("preview"))),
            "commands[0].confirm_preview",
        );
        assert!(error.message().contains(says), "{says}: {error}");
    };
    let all = format!("{CLI_ONLY}\n{JOURNAL}\n{RETURNS}");
    case(
        command("preview", "\"store-write\"", SPACE_AND_CHANGE, &all),
        "inspect",
    );
    case(
        command("preview", "\"plugin-state\"", SPACE_AND_CHANGE, &all),
        "inspect",
    );
    case(
        preview(
            SPACE_AND_CHANGE,
            &format!("expose = {{ cli = false }}\n{JOURNAL}\n{RETURNS}"),
        ),
        "CLI exposure",
    );
    case(
        preview(SPACE_AND_CHANGE, &format!("{CLI_ONLY}\n{RETURNS}")),
        "journal",
    );
    // A preview asks for nothing of its own: the CLI calls it without the marks.
    case(
        preview(
            SPACE_AND_CHANGE,
            &format!("{all}\nconfirm_prompt = \"Show it?\""),
        ),
        "no confirmation or approval",
    );
    case(
        preview(SPACE_AND_CHANGE, &format!("{all}\napproval = \"required\"")),
        "no confirmation or approval",
    );
    // Its exposure elsewhere is its own: MCP and agents may also call it.
    parse(&v4(&format!(
        "{}{}",
        approve("preview"),
        preview(SPACE_AND_CHANGE, &format!("{JOURNAL}\n{RETURNS}"))
    )))
    .unwrap();
    // Either journal mode will do.
    parse(&v4(&format!(
        "{}{}",
        approve("preview"),
        preview(
            SPACE_AND_CHANGE,
            &format!("{CLI_ONLY}\njournal = {{ mode = \"plain\" }}\n{RETURNS}")
        )
    )))
    .unwrap();
}

#[test]
fn the_preview_returns_a_closed_preview_string() {
    let with_returns = |returns: &str| {
        v4(&format!(
            "{}{}",
            approve("preview"),
            preview(
                SPACE_AND_CHANGE,
                &format!("{CLI_ONLY}\n{JOURNAL}\n{returns}")
            )
        ))
    };
    parse(&with_returns(RETURNS)).unwrap();
    for returns in [
        "",
        "returns = { type = \"object\" }",
        "returns = { type = \"object\", properties = { preview = { type = \"integer\" } }, required = [\"preview\"], additionalProperties = false }",
        "returns = { type = \"object\", properties = { preview = { type = \"string\" } }, additionalProperties = false }",
        "returns = { type = \"object\", properties = { preview = { type = \"string\" } }, required = [\"preview\"] }",
        "returns = { type = \"object\", properties = { preview = { type = \"string\" }, diff = { type = \"string\" } }, required = [\"preview\"], additionalProperties = false }",
        "returns = { type = \"array\", properties = { preview = { type = \"string\" } }, required = [\"preview\"], additionalProperties = false }",
    ] {
        let error = invalid(&with_returns(returns), "commands[0].confirm_preview");
        assert!(error.message().contains("returns"), "{returns}: {error}");
    }
}

#[test]
fn the_preview_declares_only_inputs_the_gated_command_declares() {
    // A preview may take fewer properties than the gated command: reject's reason never reaches it.
    parse(&v4(&format!(
        "{}{}",
        approve("preview"),
        preview(
            "change = { type = \"string\" }",
            &format!("{CLI_ONLY}\n{JOURNAL}\n{RETURNS}")
        )
    )))
    .unwrap();
    parse(&v4(&format!(
        "{}{}",
        approve("preview"),
        preview("", &format!("{CLI_ONLY}\n{JOURNAL}\n{RETURNS}"))
    )))
    .unwrap();
    let error = invalid(
        &v4(&format!(
            "{}{}",
            approve("preview"),
            preview(
                &format!("{SPACE_AND_CHANGE}, verdict = {{ type = \"string\" }}"),
                &format!("{CLI_ONLY}\n{JOURNAL}\n{RETURNS}")
            )
        )),
        "commands[0].confirm_preview",
    );
    assert!(error.message().contains("`verdict`"), "{error}");
}

#[test]
fn schemas_in_files_are_checked_when_the_files_are_read() {
    let dir = tempfile::tempdir().unwrap();
    let returns = r#"{ "type": "object", "properties": { "preview": { "type": "string" } }, "required": ["preview"], "additionalProperties": false }"#;
    let write = |name: &str, text: &str| fs::write(dir.path().join(name), text).unwrap();
    write("returns.json", returns);
    write(
        "gated.json",
        r#"{ "type": "object", "properties": { "change": { "type": "string" } } }"#,
    );
    write(
        "preview.json",
        r#"{ "type": "object", "properties": { "change": { "type": "string" } } }"#,
    );
    let manifest = |returns_path: &str| {
        v4(&format!(
            "\n[[commands]]\nname = \"review-approve\"\ndescription = \"Apply.\"\neffects = [\"store-write\"]\ninput_schema = \"gated.json\"\nconfirm_prompt = \"Apply it?\"\nconfirm_preview = \"review-preview\"\n\n[[commands]]\nname = \"review-preview\"\ndescription = \"Show.\"\neffects = [\"inspect\"]\ninput_schema = \"preview.json\"\nreturns = \"{returns_path}\"\n{JOURNAL}\n"
        ))
    };
    write(FILE, &manifest("returns.json"));
    // Parsing alone cannot see the files, and accepts them.
    parse(&manifest("returns.json")).unwrap();
    let loaded = Manifest::load(dir.path()).unwrap();
    assert_eq!(
        loaded.commands[0].confirm_preview.as_deref(),
        Some("review-preview")
    );
    // A returns file of another shape is refused at load.
    write("open.json", r#"{ "type": "object" }"#);
    write(FILE, &manifest("open.json"));
    parse(&manifest("open.json")).unwrap();
    let error = Manifest::load(dir.path()).unwrap_err();
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID", "{error}");
    assert!(error.message().contains("confirm_preview"), "{error}");
    // So is a preview input property the gated command's file does not declare.
    write(
        "preview.json",
        r#"{ "type": "object", "properties": { "change": { "type": "string" }, "reason": { "type": "string" } } }"#,
    );
    write(FILE, &manifest("returns.json"));
    let error = Manifest::load(dir.path()).unwrap_err();
    assert!(error.message().contains("`reason`"), "{error}");
}

#[test]
fn confirm_preview_is_refused_on_component_commands_mounted_tools_and_pipelines() {
    let component = format!(
        "{}{}",
        head(4, "component").replace(
            "\n[[grants]]\nname = \"records_write\"\nreason = \"Records decisions.\"\n",
            ""
        ),
        command(
            "approve",
            "\"inspect\"",
            SPACE_AND_CHANGE,
            "confirm_prompt = \"Apply it?\"\nconfirm_preview = \"review-preview\""
        )
    );
    let error = invalid(&component, "confirm_preview");
    assert!(error.message().contains("component"), "{error}");
    let mounted = format!(
        "{}\n[mount]\nprefix = \"review\"\ntransport = \"stdio\"\ncommand = [\"review-server\"]\n[[mount.tools]]\ntool = \"approve\"\nconfirm_prompt = \"Apply it?\"\nconfirm_preview = \"review-preview\"\n",
        head(4, "mounted").replace(
            "\n[[grants]]\nname = \"records_write\"\nreason = \"Records decisions.\"\n",
            ""
        )
    );
    let error = invalid(&mounted, "confirm_preview");
    assert!(error.message().contains("mounted tool"), "{error}");
    let error = invalid(
        &v4(&format!(
            "{}{}",
            good_preview(),
            pipeline(
                "sweep",
                "confirm_prompt = \"Run it?\"\nconfirm_preview = \"review-preview\""
            )
        )),
        "pipelines[0].confirm_preview",
    );
    assert!(error.message().contains("pipeline"), "{error}");
}

// ── Pipelines: expose and result ───────────────────────────────────────────────────────────────

#[test]
fn a_pipelines_expose_and_result_are_parsed_and_stored() {
    let manifest = parse(&v4(&format!(
        "{}{}{}{}",
        good_preview(),
        pipeline("sweep", &format!("{CLI_ONLY}\nresult = \"last\"")),
        pipeline("all", "result = \"steps\""),
        pipeline("plain", ""),
    )))
    .unwrap();
    let [sweep, all, plain] = &manifest.pipelines[..] else {
        panic!("three pipelines");
    };
    assert_eq!(
        (sweep.expose.mcp, sweep.expose.agent, sweep.expose.cli),
        (false, false, true)
    );
    assert_eq!(sweep.result, PipelineResult::Last);
    assert_eq!(sweep.result.as_str(), "last");
    assert_eq!(all.result, PipelineResult::Steps);
    assert_eq!(all.result.as_str(), "steps");
    // Left out, a version 4 pipeline takes a command's defaults: every surface but the palette.
    assert_eq!(plain.expose, Expose::default());
    assert!(plain.expose.mcp && plain.expose.agent && plain.expose.cli && !plain.expose.palette);
    assert_eq!(plain.result, PipelineResult::Steps);
    // A flag left out takes its default.
    let partial = parse(&v4(&format!(
        "{}{}",
        good_preview(),
        pipeline("sweep", "expose = { mcp = false }")
    )))
    .unwrap();
    let expose = partial.pipelines[0].expose;
    assert_eq!((expose.mcp, expose.agent, expose.cli), (false, true, true));
}

#[test]
fn a_pipelines_expose_and_result_refuse_what_they_do_not_define() {
    for (keys, key) in [
        ("expose = { palette = true }", "expose.palette"),
        ("expose = { cli = \"yes\" }", "expose.cli"),
        ("expose = { surfaces = [\"cli\"] }", "expose.surfaces"),
        ("expose = true", "expose"),
        ("result = \"first\"", "result"),
        ("result = true", "result"),
    ] {
        invalid(
            &v4(&format!("{}{}", good_preview(), pipeline("sweep", keys))),
            &format!("pipelines[0].{key}"),
        );
    }
    let error = invalid(
        &v4(&format!(
            "{}{}",
            good_preview(),
            pipeline("sweep", "expose = { palette = true }")
        )),
        "palette",
    );
    assert!(error.message().contains("never offered"), "{error}");
}

#[test]
fn a_version_4_plugin_seals_with_its_pipeline_no_wider_than_its_steps() {
    // Step 2 acts on the keys at seal: a pipeline exposed wider than its CLI-only step is
    // refused (`pipeline_expose.rs` covers the rule), and one as narrow as it seals.
    let sealed = |keys: &str| {
        let text = v4(&format!(
            "{}{}{}",
            approve("preview"),
            good_preview(),
            pipeline("sweep", keys)
        ));
        let plugin = Raw::new(text, |_| {
            Ok(["review-approve", "review-preview"]
                .into_iter()
                .map(|name| closure(name, |input, _| afd::success(input)))
                .collect())
        });
        let config = config(&[("review", "")], "")
            .replace("config_version = 2", "config_version = 4")
            + "[plugins.review.grants.records_write]\nallow = [\"main\"]\n";
        let dir = support::workspace(&config);
        seal(dir.path(), |b| b.with_compiled(plugin))
    };
    let error = sealed("result = \"last\"").err().unwrap();
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID", "{error}");
    assert!(error.message().contains("pipelines[0].expose"), "{error}");
    assert!(error.message().contains("review-preview"), "{error}");
    let host = sealed(&format!("result = \"last\"\n{CLI_ONLY}")).unwrap();
    let sweep = host.registry().get("review-sweep").unwrap();
    assert!(sweep.expose.cli && !sweep.expose.mcp && !sweep.expose.agent);
}

// ── Versions ───────────────────────────────────────────────────────────────────────────────────

#[test]
fn versions_1_to_3_still_load_with_pipelines_exposed_everywhere() {
    for version in [1, 2, 3] {
        let text = format!(
            "{}{}{}",
            head(version, "compiled").replace(
                "\n[[grants]]\nname = \"records_write\"\nreason = \"Records decisions.\"\n",
                ""
            ),
            command("preview", "\"inspect\"", SPACE_AND_CHANGE, ""),
            pipeline("sweep", "")
        );
        let manifest = parse(&text).unwrap();
        assert_eq!(manifest.manifest_version, version);
        let sweep = &manifest.pipelines[0];
        assert_eq!(sweep.expose, Expose::default(), "{version}");
        assert!(sweep.expose.mcp && sweep.expose.agent && sweep.expose.cli);
        assert_eq!(sweep.result, PipelineResult::Steps, "{version}");
        assert_eq!(manifest.commands[0].confirm_preview, None);
    }
}

#[test]
fn versions_1_to_3_refuse_what_version_4_adds() {
    for version in [1, 2, 3] {
        let bare = head(version, "compiled").replace(
            "\n[[grants]]\nname = \"records_write\"\nreason = \"Records decisions.\"\n",
            "",
        );
        let gated = command(
            "approve",
            "\"inspect\"",
            SPACE_AND_CHANGE,
            "confirm_prompt = \"Apply it?\"\nconfirm_preview = \"review-preview\"",
        );
        let error = invalid(
            &format!(
                "{bare}{gated}{}",
                command("preview", "\"inspect\"", SPACE_AND_CHANGE, "")
            ),
            "confirm_preview",
        );
        assert!(error.message().contains("manifest_version = 4"), "{error}");
        for keys in [CLI_ONLY, "result = \"last\""] {
            let key = keys.split(' ').next().unwrap();
            let error = invalid(
                &format!(
                    "{bare}{}{}",
                    command("preview", "\"inspect\"", SPACE_AND_CHANGE, ""),
                    pipeline("sweep", keys)
                ),
                &format!("pipelines[0].{key}"),
            );
            assert!(error.message().contains("manifest_version = 4"), "{error}");
        }
    }
}

#[test]
fn a_host_reads_manifest_versions_1_to_4_and_versions_5_and_6_beside_them() {
    assert_eq!(umbel::MANIFEST_VERSION, 6);
    assert_eq!(umbel::MANIFEST_VERSIONS, [1, 2, 3, 4, 5, 6]);
    for other in [0, 7] {
        let error = parse(&head(other, "compiled")).unwrap_err();
        assert_eq!(error.code(), "PLUGIN_PROTOCOL_UNSUPPORTED", "{other}");
        assert!(
            error.suggestion().contains("manifest versions 1 to 6"),
            "{error}"
        );
    }
}
