//! The plugin manifest, version 5 (phase 5 specification, section 2.3; D115, D127): `person` per
//! surface on a `require-human` command, MCP exposure of such a command only with `person.mcp`,
//! the preview and `journal.keep` rule; `task` and its refusals; both on a pipeline, admitted at
//! seal only when every step admits them; versions 1 to 4 still loading, with every
//! `require-human` command at `{ cli = "terminal" }` and never a task. What acts on the keys is
//! later steps': the person page (step 5) and tasks (step 8). Until step 5 a `require-human`
//! command is registered off MCP whatever its `person` says.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use support::plugins::{Raw, closure, config, seal};
use umbel::plugins::{Assurance, Manifest, PersonDecl, PluginError, TaskMode};

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

const RETURNS: &str = "returns = { type = \"object\", properties = { preview = { type = \"string\" } }, required = [\"preview\"], additionalProperties = false }";
const SPACE_AND_CHANGE: &str = "space = { type = \"string\" }, change = { type = \"string\" }";
const KEEP: &str = "journal = { mode = \"digest\", keep = [\"space\", \"change\"] }";
const CLI_ONLY: &str = "expose = { mcp = false, agent = false, cli = true }";
const MCP_AND_CLI: &str = "expose = { mcp = true, agent = false, cli = true }";

/// `review-approve`: `require-human`, previewed by `review-preview`, with `keys` appended.
fn approve(keys: &str) -> String {
    command(
        "approve",
        "\"store-write\"",
        &format!("{SPACE_AND_CHANGE}, note = {{ type = \"string\" }}"),
        &format!(
            "confirm_prompt = \"Apply it?\"\nconfirm = \"require-human\"\nconfirm_preview = \"review-preview\"\n{keys}"
        ),
    )
}

fn preview() -> String {
    command(
        "preview",
        "\"inspect\"",
        SPACE_AND_CHANGE,
        &format!("{CLI_ONLY}\njournal = {{ mode = \"digest\", keep = [\"change\"] }}\n{RETURNS}"),
    )
}

/// `review-refresh`: a store write that may be a task, with `keys` appended.
fn refresh(keys: &str) -> String {
    command(
        "refresh",
        "\"store-write\"",
        "space = { type = \"string\" }",
        keys,
    )
}

/// A pipeline `review-<name>` running `steps` (command names), with `keys` appended.
fn pipeline(name: &str, effects: &str, keys: &str, steps: &[&str]) -> String {
    let steps: String = steps
        .iter()
        .map(|step| format!("[[pipelines.steps]]\ncommand = \"{step}\"\n"))
        .collect();
    format!(
        "\n[[pipelines]]\nname = \"review-{name}\"\ndescription = \"Run it.\"\neffects = [{effects}]\ninput_schema = {{ type = \"object\" }}\n{keys}\n{steps}"
    )
}

fn v5(body: &str) -> String {
    format!("{}{body}", head(5, "compiled"))
}

fn parse(text: &str) -> Result<Manifest, PluginError> {
    Manifest::parse(text, FILE)
}

#[track_caller]
fn invalid(text: &str, key: &str) -> PluginError {
    let error = parse(text).expect_err(text);
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID", "{text}: {error}");
    assert!(
        error.message().contains(key),
        "{text}: {error} does not name {key}"
    );
    error
}

// ── person ─────────────────────────────────────────────────────────────────────────────────────

#[test]
fn person_is_stored_per_surface_and_defaults_to_a_terminal() {
    let manifest = parse(&v5(&format!(
        "{}{}",
        approve(&format!(
            "person = {{ cli = \"verified\", mcp = \"verified\" }}\n{MCP_AND_CLI}\n{KEEP}"
        )),
        preview()
    )))
    .unwrap();
    assert_eq!(manifest.manifest_version, 5);
    let person = manifest.commands[0].person.unwrap();
    assert_eq!(person.cli, Assurance::Verified);
    assert_eq!(person.mcp, Some(Assurance::Verified));
    assert!(person.needs_preview());
    assert!(manifest.commands[0].expose.mcp);
    // Declared, but not served over MCP until the person page exists (step 5).
    assert!(!manifest.commands[0].mcp_exposed());
    // The preview is no require-human command: no person.
    assert_eq!(manifest.commands[1].person, None);
    // A require-human command without person is at a terminal, CLI only.
    let plain = parse(&v5(&format!("{}{}", approve(CLI_ONLY), preview()))).unwrap();
    assert_eq!(plain.commands[0].person, Some(PersonDecl::default()));
    let default = PersonDecl::default();
    assert_eq!((default.cli, default.mcp), (Assurance::Terminal, None));
    assert!(!default.needs_preview());
    // Versions 2 to 4 have the same default.
    for version in [2, 3, 4] {
        let text = format!(
            "{}{}",
            head(version, "compiled"),
            command(
                "approve",
                "\"store-write\"",
                SPACE_AND_CHANGE,
                &format!("confirm_prompt = \"Apply it?\"\nconfirm = \"require-human\"\n{CLI_ONLY}")
            )
        );
        let manifest = parse(&text).unwrap();
        assert_eq!(
            manifest.commands[0].person,
            Some(PersonDecl::default()),
            "{version}"
        );
        assert_eq!(manifest.commands[0].task, TaskMode::Never, "{version}");
    }
}

#[test]
fn person_goes_with_require_human_and_names_only_the_assurances_it_defines() {
    let not_gated = command(
        "approve",
        "\"store-write\"",
        SPACE_AND_CHANGE,
        "confirm_prompt = \"Apply it?\"\nperson = { cli = \"terminal\" }",
    );
    let error = invalid(&v5(&not_gated), "commands[0].person");
    assert!(error.message().contains("require-human"), "{error}");
    for (person, key) in [
        ("person = { cli = \"strong\" }", "person.cli"),
        ("person = { mcp = \"terminal\" }", "person.mcp"),
        ("person = { mcp = true }", "person.mcp"),
        ("person = { agent = \"verified\" }", "person.agent"),
        ("person = \"verified\"", "person"),
    ] {
        invalid(
            &v5(&format!(
                "{}{}",
                approve(&format!("{person}\n{CLI_ONLY}")),
                preview()
            )),
            &format!("commands[0].{key}"),
        );
    }
    // person.mcp with expose.mcp = false says nothing true: refused.
    let error = invalid(
        &v5(&format!(
            "{}{}",
            approve(&format!(
                "person = {{ mcp = \"verified\" }}\n{CLI_ONLY}\n{KEEP}"
            )),
            preview()
        )),
        "commands[0].person",
    );
    assert!(error.message().contains("expose.mcp"), "{error}");
}

#[test]
fn only_person_mcp_admits_mcp_exposure_and_never_agents() {
    // Without person.mcp, MCP exposure stays refused, naming the way out.
    let error = invalid(
        &v5(&format!("{}{}", approve(MCP_AND_CLI), preview())),
        "commands[0].confirm",
    );
    assert!(error.message().contains("person"), "{error}");
    // The default exposure is MCP, agents and the CLI: refused.
    invalid(
        &v5(&format!("{}{}", approve(""), preview())),
        "commands[0].confirm",
    );
    // Agents and a missing CLI are refused even with person.mcp.
    for expose in [
        "expose = { mcp = true, agent = true, cli = true }",
        "expose = { mcp = true, agent = false, cli = false }",
    ] {
        invalid(
            &v5(&format!(
                "{}{}",
                approve(&format!(
                    "person = {{ mcp = \"verified\" }}\n{expose}\n{KEEP}"
                )),
                preview()
            )),
            "commands[0].confirm",
        );
    }
    let mcp = parse(&v5(&format!(
        "{}{}",
        approve(&format!(
            "person = {{ mcp = \"verified\" }}\n{MCP_AND_CLI}\n{KEEP}"
        )),
        preview()
    )))
    .unwrap();
    assert_eq!(mcp.commands[0].person.unwrap().cli, Assurance::Terminal);
    // Version 4 keeps its rule and message.
    let four = format!(
        "{}{}{}",
        head(4, "compiled"),
        approve(MCP_AND_CLI),
        preview()
    );
    let error = invalid(&four, "commands[0].confirm");
    assert!(error.message().contains("mcp = false"), "{error}");
}

#[test]
fn a_person_page_decision_needs_a_preview_and_keeps_its_ids_only() {
    for person in [
        "person = { cli = \"verified\" }",
        "person = { mcp = \"verified\" }",
    ] {
        let expose = if person.contains("mcp") {
            MCP_AND_CLI
        } else {
            CLI_ONLY
        };
        // Without confirm_preview.
        let without = command(
            "approve",
            "\"store-write\"",
            SPACE_AND_CHANGE,
            &format!(
                "confirm_prompt = \"Apply it?\"\nconfirm = \"require-human\"\n{person}\n{expose}\n{KEEP}"
            ),
        );
        let error = invalid(
            &v5(&format!("{without}{}", preview())),
            "commands[0].person",
        );
        assert!(error.message().contains("confirm_preview"), "{error}");
        // Without a digest journal, or with a plain one.
        for journal in ["", "journal = { mode = \"plain\" }"] {
            invalid(
                &v5(&format!(
                    "{}{}",
                    approve(&format!("{person}\n{expose}\n{journal}")),
                    preview()
                )),
                "commands[0].journal",
            );
        }
        // A preview property missing from keep.
        let error = invalid(
            &v5(&format!(
                "{}{}",
                approve(&format!(
                    "{person}\n{expose}\njournal = {{ mode = \"digest\", keep = [\"change\"] }}"
                )),
                preview()
            )),
            "commands[0].journal",
        );
        assert!(error.message().contains("`space`"), "{error}");
        // keep may hold more than the preview reads.
        parse(&v5(&format!(
            "{}{}",
            approve(&format!(
                "{person}\n{expose}\njournal = {{ mode = \"digest\", keep = [\"space\", \"change\", \"note\"] }}"
            )),
            preview()
        )))
        .unwrap();
    }
    // A terminal decision keeps version 4's rules: no keep rule.
    parse(&v5(&format!(
        "{}{}",
        approve(&format!("person = {{ cli = \"terminal\" }}\n{CLI_ONLY}")),
        preview()
    )))
    .unwrap();
}

#[test]
fn journal_show_names_text_a_person_page_shows_and_nothing_else() {
    // The preview reads `note` too: as text the person reads (show), never kept.
    let reading = command(
        "preview",
        "\"inspect\"",
        &format!("{SPACE_AND_CHANGE}, note = {{ type = \"string\" }}"),
        &format!("{CLI_ONLY}\njournal = {{ mode = \"digest\", keep = [\"change\"] }}\n{RETURNS}"),
    );
    let gated = |journal: &str| {
        v5(&format!(
            "{}{reading}",
            approve(&format!(
                "person = {{ mcp = \"verified\" }}\n{MCP_AND_CLI}\n{journal}"
            ))
        ))
    };
    let manifest = parse(&gated(
        "journal = { mode = \"digest\", keep = [\"space\", \"change\"], show = [\"note\"] }",
    ))
    .unwrap();
    assert_eq!(
        manifest.commands[0].journal.as_ref().unwrap().show,
        ["note"]
    );
    // Without show, the preview's `note` is neither kept nor shown: refused.
    let error = invalid(&gated(KEEP), "commands[0].journal");
    assert!(error.message().contains("`note`"), "{error}");
    // Shown and kept at once; named twice; with a plain journal; more than four.
    invalid(
        &gated(
            "journal = { mode = \"digest\", keep = [\"space\", \"change\", \"note\"], show = [\"note\"] }",
        ),
        "show",
    );
    invalid(
        &gated(
            "journal = { mode = \"digest\", keep = [\"space\", \"change\"], show = [\"note\", \"note\"] }",
        ),
        "show",
    );
    invalid(
        &gated("journal = { mode = \"plain\", show = [\"note\"] }"),
        "show",
    );
    invalid(
        &gated(
            "journal = { mode = \"digest\", keep = [\"space\", \"change\"], show = [\"note\", \"a\", \"b\", \"c\", \"d\"] }",
        ),
        "show",
    );
    // A shown input the preview does not read.
    let error = invalid(
        &v5(&format!(
            "{}{}",
            approve(&format!(
                "person = {{ mcp = \"verified\" }}\n{MCP_AND_CLI}\njournal = {{ mode = \"digest\", keep = [\"space\", \"change\"], show = [\"note\"] }}"
            )),
            preview()
        )),
        "commands[0].journal.show",
    );
    assert!(error.message().contains("`note`"), "{error}");
    // On a command no person page decides, and below manifest version 5.
    invalid(
        &v5(&refresh(
            "journal = { mode = \"digest\", keep = [\"space\"], show = [\"space2\"] }",
        )),
        "show",
    );
    invalid(
        &format!(
            "{}{}",
            head(4, "compiled"),
            refresh("journal = { mode = \"digest\", show = [\"space\"] }")
        ),
        "show",
    );
}

// ── task ───────────────────────────────────────────────────────────────────────────────────────

#[test]
fn task_is_stored_and_defaults_to_never() {
    let manifest = parse(&v5(&format!(
        "{}{}{}",
        refresh("task = \"optional\""),
        command("count", "\"store-write\"", "", "task = \"required\""),
        command("noop", "\"plugin-state\"", "", "task = \"never\"")
    )))
    .unwrap();
    let tasks: Vec<_> = manifest.commands.iter().map(|c| c.task).collect();
    assert_eq!(
        tasks,
        [TaskMode::Optional, TaskMode::Required, TaskMode::Never]
    );
    assert_eq!(TaskMode::Optional.as_str(), "optional");
    assert_eq!(
        parse(&v5(&refresh(""))).unwrap().commands[0].task,
        TaskMode::Never
    );
    // Plain journaling is allowed.
    parse(&v5(&refresh(
        "task = \"optional\"\njournal = { mode = \"plain\" }",
    )))
    .unwrap();
}

#[test]
fn task_is_refused_where_a_task_could_wait_for_someone_or_keep_content() {
    for (keys, why) in [
        ("task = \"sometimes\"", "never"),
        ("task = true", "string"),
        (
            "task = \"optional\"\njournal = { mode = \"digest\" }",
            "digest",
        ),
        (
            "task = \"required\"\nconfirm_prompt = \"Sure?\"",
            "confirm_prompt",
        ),
        ("task = \"optional\"\napproval = \"required\"", "approval"),
        (
            "task = \"optional\"\nexpose = { mcp = false }",
            "expose.mcp",
        ),
    ] {
        let error = invalid(&v5(&refresh(keys)), "commands[0].task");
        assert!(error.message().contains(why), "{keys}: {error}");
    }
    // A read: its results carry content.
    let error = invalid(
        &v5(&command("scan", "\"inspect\"", "", "task = \"optional\"")),
        "commands[0].task",
    );
    assert!(error.message().contains("inspect"), "{error}");
    // Beside confirm = "require-human" (and so beside person).
    invalid(
        &v5(&format!(
            "{}{}",
            approve(&format!("{CLI_ONLY}\ntask = \"optional\"")),
            preview()
        )),
        "commands[0].task",
    );
    // Beside authority_prompt, in a memory plugin.
    let memory = head(5, "compiled").replace("records_write", "memory_write");
    let error = invalid(
        &format!(
            "{memory}{}",
            command(
                "remember",
                "\"store-write\"",
                "",
                "authority_prompt = \"Record it as yours?\"\njournal = { mode = \"plain\" }\ntask = \"optional\""
            )
        ),
        "commands[0].task",
    );
    assert!(error.message().contains("authority_prompt"), "{error}");
    // A component command.
    let error = invalid(
        &format!(
            "{}{}",
            head(5, "component"),
            command("refresh", "\"plugin-state\"", "", "task = \"optional\"")
        ),
        "commands[0].task",
    );
    assert!(error.message().contains("component"), "{error}");
    // A mounted tool takes neither key.
    for key in ["task = \"optional\"", "person = { cli = \"verified\" }"] {
        let mounted = format!(
            "manifest_version = 5\nprotocol = 1\n[plugin]\nid = \"tickets\"\ntitle = \"Tickets\"\nversion = \"0.1.0\"\ndescription = \"A mounted server.\"\nkind = \"mounted\"\ndomains = [\"tickets\"]\n[mount]\nprefix = \"tickets\"\ntransport = \"stdio\"\ncommand = [\"tickets-mcp\"]\n[[mount.tools]]\ntool = \"create\"\n{key}\n"
        );
        let error = invalid(&mounted, "mount.tools[0]");
        assert!(error.message().contains("mounted tool"), "{error}");
    }
}

// ── Pipelines ──────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_pipelines_task_and_person_parse_with_their_own_refusals() {
    let manifest = parse(&v5(&format!(
        "{}{}",
        refresh("task = \"optional\""),
        pipeline(
            "all",
            "\"store-write\"",
            "task = \"required\"\nexpose = { mcp = true, agent = false, cli = false }",
            &["review-refresh"]
        )
    )))
    .unwrap();
    assert_eq!(manifest.pipelines[0].task, TaskMode::Required);
    assert_eq!(manifest.pipelines[0].person, None);
    let gated = parse(&v5(&format!(
        "{}{}{}",
        approve(&format!("{CLI_ONLY}\n{KEEP}")),
        preview(),
        pipeline(
            "approve-all",
            "\"store-write\"",
            &format!("person = {{ cli = \"terminal\" }}\n{CLI_ONLY}"),
            &["review-approve"]
        )
    )))
    .unwrap();
    assert_eq!(gated.pipelines[0].person.unwrap().cli, Assurance::Terminal);
    // A pipeline declares no preview, and no pipeline step is confirmed over MCP: only the
    // terminal.
    for person in [
        "person = { cli = \"verified\" }",
        "person = { mcp = \"verified\" }",
    ] {
        let error = invalid(
            &v5(&format!(
                "{}{}{}",
                approve(&format!("{CLI_ONLY}\n{KEEP}")),
                preview(),
                pipeline(
                    "approve-all",
                    "\"store-write\"",
                    &format!("{person}\n{CLI_ONLY}"),
                    &["review-approve"]
                )
            )),
            "pipelines[0].person",
        );
        assert!(error.message().contains("preview"), "{error}");
    }
    assert_eq!(gated.pipelines[0].task, TaskMode::Never);
    for (keys, effects, why) in [
        (
            "task = \"optional\"\njournal = { mode = \"digest\" }",
            "\"store-write\"",
            "digest",
        ),
        (
            "task = \"optional\"\nexpose = { mcp = false }",
            "\"store-write\"",
            "expose.mcp",
        ),
        ("task = \"optional\"", "\"inspect\"", "inspect"),
        (
            "task = \"optional\"\nperson = { cli = \"terminal\" }",
            "\"store-write\"",
            "person",
        ),
        ("task = \"later\"", "\"store-write\"", "never"),
    ] {
        let error = invalid(
            &v5(&format!(
                "{}{}",
                refresh("task = \"optional\""),
                pipeline("all", effects, keys, &["review-refresh"])
            )),
            "pipelines[0].task",
        );
        assert!(error.message().contains(why), "{keys}: {error}");
    }
    invalid(
        &v5(&format!(
            "{}{}",
            refresh(""),
            pipeline(
                "all",
                "\"store-write\"",
                "person = { mcp = \"terminal\" }",
                &["review-refresh"]
            )
        )),
        "pipelines[0].person.mcp",
    );
}

/// Seal a version 5 plugin whose commands are `body`, with a handler for each of `commands`.
fn sealed(body: &str, commands: &'static [&'static str]) -> Result<umbel::Host, umbel::HostError> {
    let plugin = Raw::new(v5(body), move |_| {
        Ok(commands
            .iter()
            .map(|name| closure(name, |input, _| afd::success(input)))
            .collect())
    });
    let config = config(&[("review", "")], "").replace("config_version = 2", "config_version = 5")
        + "[plugins.review.grants.records_write]\nallow = [\"main\"]\n";
    let dir = support::workspace(&config);
    seal(dir.path(), |b| b.with_compiled(plugin))
}

#[test]
fn at_seal_a_pipeline_task_needs_every_step_to_admit_it() {
    let all = |step_task: &str, other: &str| {
        format!(
            "{}{}{}",
            refresh(&format!("task = \"{step_task}\"")),
            command("tidy", "\"store-write\"", "", other),
            pipeline(
                "all",
                "\"store-write\"",
                "task = \"optional\"\nexpose = { mcp = true, agent = false, cli = false }",
                &["review-refresh", "review-tidy"]
            )
        )
    };
    let host = sealed(
        &all("optional", "task = \"required\""),
        &["review-refresh", "review-tidy"],
    )
    .unwrap();
    assert!(host.registry().get("review-all").is_some());
    let error = sealed(&all("optional", ""), &["review-refresh", "review-tidy"])
        .err()
        .unwrap();
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID", "{error}");
    assert!(error.message().contains("pipelines[0].task"), "{error}");
    assert!(error.message().contains("review-tidy"), "{error}");
    // A host command is never a task.
    let error = sealed(
        &format!(
            "{}{}",
            refresh("task = \"optional\""),
            pipeline(
                "all",
                "\"store-write\"",
                "task = \"optional\"\nexpose = { mcp = true, agent = false, cli = false }",
                &["review-refresh", "space-list"]
            )
        ),
        &["review-refresh"],
    )
    .err()
    .unwrap();
    assert!(error.message().contains("space-list"), "{error}");
}

#[test]
fn at_seal_a_pipeline_person_needs_every_step_to_be_gated_at_the_terminal() {
    let gated = |step_person: &str, steps: &[&str]| {
        format!(
            "{}{}{}",
            approve(&format!("{step_person}\n{CLI_ONLY}\n{KEEP}")),
            preview(),
            pipeline(
                "approve-all",
                "\"store-write\"",
                &format!("person = {{ cli = \"terminal\" }}\n{CLI_ONLY}"),
                steps
            )
        )
    };
    let commands: &'static [&'static str] = &["review-approve", "review-preview"];
    // A terminal step, whether or not it also names MCP: admitted.
    for step in ["", "person = { cli = \"terminal\" }"] {
        let host = sealed(&gated(step, &["review-approve"]), commands).unwrap();
        assert!(
            host.registry().get("review-approve-all").is_some(),
            "{step}"
        );
    }
    // A step proven on the person page is stronger than the pipeline: refused.
    let error = sealed(
        &gated("person = { cli = \"verified\" }", &["review-approve"]),
        commands,
    )
    .err()
    .unwrap();
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID", "{error}");
    assert!(error.message().contains("pipelines[0].person"), "{error}");
    // A step that is not require-human does not admit a person.
    let error = sealed(&gated("", &["review-approve", "review-preview"]), commands)
        .err()
        .unwrap();
    assert!(error.message().contains("review-preview"), "{error}");
}

#[tokio::test]
async fn a_command_proven_on_the_person_page_is_refused_until_the_person_page_exists() {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    let ran = Arc::new(AtomicBool::new(false));
    let seen = Arc::clone(&ran);
    let plugin = Raw::new(
        v5(&format!(
            "{}{}",
            approve(&format!(
                "person = {{ cli = \"verified\" }}\n{CLI_ONLY}\n{KEEP}"
            )),
            preview()
        )),
        move |_| {
            let seen = Arc::clone(&seen);
            Ok(vec![
                closure("review-approve", move |input, _| {
                    seen.store(true, Ordering::SeqCst);
                    afd::success(input)
                }),
                closure("review-preview", |_, _| {
                    afd::success(serde_json::json!({ "preview": "Change c1" }))
                }),
            ])
        },
    );
    let config = config(&[("review", "")], "").replace("config_version = 2", "config_version = 5")
        + "[plugins.review.grants.records_write]\nallow = [\"main\"]\n";
    let dir = support::workspace(&config);
    // A person at a terminal answers yes: still refused, since the terminal check is not the
    // assurance the command names.
    let console = support::Scripted::new(true, true);
    let run = support::cli_with(
        dir.path(),
        &["call", "review-approve", "change=c1"],
        console,
        |builder| builder.with_compiled(plugin),
    )
    .await;
    assert_eq!(run.code, 1, "{}", run.stdout);
    assert_eq!(
        run.error_code(),
        "PERSON_VERIFICATION_UNAVAILABLE",
        "{}",
        run.stdout
    );
    assert!(
        !ran.load(Ordering::SeqCst),
        "the handler ran on the terminal check"
    );
    assert_eq!(
        umbel::auth::PERSON_VERIFICATION_UNAVAILABLE,
        "PERSON_VERIFICATION_UNAVAILABLE"
    );
}

#[test]
fn a_require_human_command_with_person_mcp_stays_off_mcp_until_the_person_page() {
    let host = sealed(
        &format!(
            "{}{}",
            approve(&format!(
                "person = {{ mcp = \"verified\" }}\n{MCP_AND_CLI}\n{KEEP}"
            )),
            preview()
        ),
        &["review-approve", "review-preview"],
    )
    .unwrap();
    let approve = host.registry().get("review-approve").unwrap();
    assert!(!approve.expose.mcp, "served over MCP before step 5");
    assert!(approve.expose.cli && !approve.expose.agent);
}

// ── Versions ───────────────────────────────────────────────────────────────────────────────────

#[test]
fn versions_1_to_4_refuse_what_version_5_adds() {
    for version in [1, 2, 3, 4] {
        let bare = head(version, "compiled").replace(
            "\n[[grants]]\nname = \"records_write\"\nreason = \"Records decisions.\"\n",
            "",
        );
        let error = invalid(
            &format!(
                "{bare}{}",
                command("refresh", "\"plugin-state\"", "", "task = \"optional\"")
            ),
            "commands[0].task",
        );
        assert!(error.message().contains("manifest_version = 5"), "{error}");
        let error = invalid(
            &format!(
                "{bare}{}",
                command(
                    "refresh",
                    "\"plugin-state\"",
                    "",
                    "person = { cli = \"terminal\" }"
                )
            ),
            "commands[0].person",
        );
        assert!(error.message().contains("manifest_version = 5"), "{error}");
        let error = invalid(
            &format!(
                "{bare}{}{}",
                command("refresh", "\"plugin-state\"", "", ""),
                pipeline(
                    "all",
                    "\"plugin-state\"",
                    "task = \"optional\"",
                    &["review-refresh"]
                )
            ),
            "pipelines[0].task",
        );
        assert!(error.message().contains("manifest_version = 5"), "{error}");
    }
}

#[test]
fn a_host_reads_manifest_versions_1_to_5_and_scopes_stay_reserved() {
    // Version 6 (the records host specification) is read beside them and tested in
    // `manifest_v6.rs`.
    assert_eq!(umbel::MANIFEST_VERSION, 6);
    assert_eq!(umbel::MANIFEST_VERSIONS, [1, 2, 3, 4, 5, 6]);
    let error = invalid(
        &v5(&refresh("scopes = [\"umbel:write\"]")),
        "commands[0].scopes",
    );
    assert!(error.message().contains("reserved"), "{error}");
    let error = parse(&head(7, "compiled")).unwrap_err();
    assert_eq!(error.code(), "PLUGIN_PROTOCOL_UNSUPPORTED");
    assert!(
        error.suggestion().contains("manifest versions 1 to 6"),
        "{error}"
    );
}
