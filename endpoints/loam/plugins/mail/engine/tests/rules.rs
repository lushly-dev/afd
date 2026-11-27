//! The registry's rules (the specification's M18 and M29), each seen failing.

#![allow(clippy::expect_used)]

use afd::{
    ApprovalDecision, ApprovalPolicy, CommandContext, CommandDefinition, CommandHandler,
    CommandRegistry, CommandResult, ExposeOptions, success,
};
use async_trait::async_trait;
use loam_mail::rules::check;

struct Runs;

#[async_trait]
impl CommandHandler for Runs {
    async fn execute(
        &self,
        _input: serde_json::Value,
        _context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        success(serde_json::json!({}))
    }
}

fn command(name: &str) -> CommandDefinition {
    CommandDefinition::new(name, "A test command", vec![], Runs)
}

fn cli_only() -> ExposeOptions {
    ExposeOptions::new()
        .with_cli(true)
        .with_agent(false)
        .with_palette(false)
}

fn registry_of(commands: Vec<CommandDefinition>) -> CommandRegistry {
    let registry = CommandRegistry::new();
    for command in commands {
        registry
            .register(command)
            .expect("the test command registers");
    }
    registry
}

#[test]
fn the_engine_registry_keeps_its_rules() {
    let engine = std::sync::Arc::new(loam_mail::engine::Engine::new(None));
    let registry = loam_mail::registry(&engine).expect("the engine's registry is sound");
    assert_eq!(check(&registry), Vec::<String>::new());
    // The rebuild is the command line's alone (the specification's section 11).
    let rebuild = registry
        .list()
        .into_iter()
        .find(|command| command.name == "mail-rebuild")
        .expect("mail-rebuild is registered");
    assert!(rebuild.expose.cli);
    assert!(!rebuild.expose.mcp && !rebuild.expose.agent && !rebuild.expose.palette);
    assert!(rebuild.mutation);
    assert_ne!(rebuild.destructive, Some(true));
}

fn send() -> CommandDefinition {
    command("mail-draft-send")
        .as_mutation()
        .with_destructive(true)
        .with_expose(cli_only())
}

fn decided_per_call() -> ApprovalPolicy {
    ApprovalPolicy::when(|_input, _context| ApprovalDecision::Required)
}

#[test]
fn sound_commands_break_nothing() {
    let registry = registry_of(vec![
        command("mail-status").with_expose(ExposeOptions::new().with_cli(true).with_mcp(true)),
        // A policy of `NotRequired` is no policy: the command may be on any surface.
        command("mail-archive")
            .as_mutation()
            .with_approval(ApprovalPolicy::NotRequired)
            .with_expose(ExposeOptions::new().with_cli(true).with_mcp(true)),
        // A person's command with no prompt of its own.
        command("mail-sender-screen")
            .as_mutation()
            .with_expose(cli_only()),
        command("mail-sender-accept")
            .as_mutation()
            .with_approval(decided_per_call())
            .with_expose(cli_only()),
        send().with_approval(ApprovalPolicy::Required),
    ]);
    assert_eq!(check(&registry), Vec::<String>::new());
}

#[test]
fn a_destructive_command_that_is_not_always_held_is_refused() {
    // No policy, one that never holds, and one decided per call, which could waive.
    for command in [
        send(),
        send().with_approval(ApprovalPolicy::NotRequired),
        send().with_approval(decided_per_call()),
    ] {
        assert_eq!(
            check(&registry_of(vec![command])),
            ["mail-draft-send: a destructive command always requires approval (M29)"]
        );
    }
}

#[test]
fn a_destructive_command_that_is_not_a_mutation_is_refused() {
    let registry = registry_of(vec![
        command("mail-draft-send")
            .with_destructive(true)
            .with_approval(ApprovalPolicy::Required)
            .with_expose(cli_only()),
    ]);
    assert_eq!(
        check(&registry),
        ["mail-draft-send: a destructive command is a mutation"]
    );
}

#[test]
fn a_command_that_waits_for_a_person_is_refused_on_every_other_surface() {
    for policy in [ApprovalPolicy::Required, decided_per_call()] {
        for expose in [
            cli_only().with_mcp(true),
            cli_only().with_agent(true),
            cli_only().with_palette(true),
            // The crate's defaults: palette and agent on.
            ExposeOptions::new().with_cli(true),
        ] {
            let registry = registry_of(vec![
                command("mail-policy-set")
                    .as_mutation()
                    .with_approval(policy.clone())
                    .with_expose(expose),
            ]);
            assert_eq!(
                check(&registry),
                [
                    "mail-policy-set: a command with an approval policy is exposed to `cli` only \
                     (M18)"
                ]
            );
        }
    }
}

#[test]
fn a_command_outside_the_domain_or_on_no_surface_is_refused() {
    let registry = registry_of(vec![
        command("todo-list").with_expose(ExposeOptions::new().with_cli(true)),
        command("mailbox-list").with_expose(ExposeOptions::new().with_cli(true)),
        command("mail-hidden"),
    ]);
    assert_eq!(
        check(&registry),
        [
            "mail-hidden: a command is exposed to `cli`, `mcp` or both",
            "mailbox-list: a command's name starts with `mail-`",
            "todo-list: a command's name starts with `mail-`",
        ]
    );
}

/// F-T5: Amended M18 allows only the four released commands on MCP beside `cli`,
/// with `ApprovalPolicy::Required` and neither `agent` nor `palette`.
#[test]
fn released_commands_on_mcp_keep_amended_m18_and_fifth_is_refused() {
    let released_expose = cli_only().with_mcp(true);
    let registry = registry_of(vec![
        command("mail-draft-send")
            .as_mutation()
            .with_destructive(true)
            .with_approval(ApprovalPolicy::Required)
            .with_expose(released_expose.clone()),
        command("mail-replyset-send")
            .as_mutation()
            .with_destructive(true)
            .with_approval(ApprovalPolicy::Required)
            .with_expose(released_expose.clone()),
        command("mail-unsubscribe")
            .as_mutation()
            .with_destructive(true)
            .with_approval(ApprovalPolicy::Required)
            .with_expose(released_expose.clone()),
        command("mail-operation-approve")
            .as_mutation()
            .with_approval(ApprovalPolicy::Required)
            .with_expose(released_expose.clone()),
    ]);
    assert_eq!(check(&registry), Vec::<String>::new());

    // A fifth held command on MCP is refused.
    let fifth = registry_of(vec![
        command("mail-sender-accept")
            .as_mutation()
            .with_approval(ApprovalPolicy::Required)
            .with_expose(released_expose.clone()),
    ]);
    assert_eq!(
        check(&fifth),
        ["mail-sender-accept: a command with an approval policy is exposed to `cli` only (M18)"]
    );

    // One of the four with Conditional approval, or with `agent`/`palette` on, is refused.
    for broken in [
        command("mail-operation-approve")
            .as_mutation()
            .with_approval(decided_per_call())
            .with_expose(released_expose.clone()),
        command("mail-operation-approve")
            .as_mutation()
            .with_approval(ApprovalPolicy::Required)
            .with_expose(released_expose.clone().with_agent(true)),
        command("mail-operation-approve")
            .as_mutation()
            .with_approval(ApprovalPolicy::Required)
            .with_expose(released_expose.with_palette(true)),
    ] {
        assert_eq!(
            check(&registry_of(vec![broken])),
            [
                "mail-operation-approve: a command with an approval policy is exposed to `cli` only (M18)"
            ]
        );
    }
}

/// Parses `[[mount.tools]]` entries (`tool = "..."`, `effects = ["..."]`) from
/// the mount manifest so the test stays free of a TOML parser dependency.
fn parse_mount_tools(manifest: &str) -> Vec<(String, Vec<String>)> {
    let mut tools = Vec::new();
    let mut in_tool = false;
    let mut tool_name: Option<String> = None;
    let mut effects: Option<Vec<String>> = None;

    let flush = |tools: &mut Vec<(String, Vec<String>)>,
                 name: &mut Option<String>,
                 effs: &mut Option<Vec<String>>| {
        if let Some(n) = name.take() {
            tools.push((n, effs.take().expect("every [[mount.tools]] has effects")));
        }
    };

    for raw in manifest.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line == "[[mount.tools]]" {
            flush(&mut tools, &mut tool_name, &mut effects);
            in_tool = true;
            continue;
        }
        if line.starts_with('[') {
            flush(&mut tools, &mut tool_name, &mut effects);
            in_tool = false;
            continue;
        }
        if !in_tool {
            continue;
        }
        if let Some(rest) = line.strip_prefix("tool =") {
            let value = rest.trim();
            assert!(
                value.starts_with('"') && value.ends_with('"'),
                "unexpected tool value: {value}"
            );
            tool_name = Some(value[1..value.len() - 1].to_string());
        } else if let Some(rest) = line.strip_prefix("effects =") {
            let value = rest.trim();
            assert!(
                value.starts_with('[') && value.ends_with(']'),
                "unexpected effects value: {value}"
            );
            let inner = value[1..value.len() - 1].trim();
            let list = if inner.is_empty() {
                Vec::new()
            } else {
                inner
                    .split(',')
                    .map(|item| {
                        let s = item.trim();
                        assert!(s.starts_with('"') && s.ends_with('"'), "bad effect: {s}");
                        s[1..s.len() - 1].to_string()
                    })
                    .collect()
            };
            effects = Some(list);
        }
    }
    flush(&mut tools, &mut tool_name, &mut effects);
    tools
}

#[test]
fn mount_manifest_tools_agree_with_engine_registry() {
    let manifest_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("engine/ has parent mail/")
        .join("mount")
        .join("loam-app.toml");
    let manifest = std::fs::read_to_string(&manifest_path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", manifest_path.display()));
    let declared = parse_mount_tools(&manifest);
    assert!(!declared.is_empty(), "mount manifest must declare tools");

    let engine = std::sync::Arc::new(loam_mail::engine::Engine::new(None));
    let registry = loam_mail::registry(&engine).expect("the engine's registry is sound");
    let by_name: std::collections::BTreeMap<String, std::sync::Arc<CommandDefinition>> = registry
        .list()
        .into_iter()
        .map(|cmd| (cmd.name.clone(), cmd))
        .collect();

    let mut seen = std::collections::BTreeSet::new();
    for (name, effects) in &declared {
        assert!(seen.insert(name.clone()), "duplicate mount tool: {name}");
        let cmd = by_name
            .get(name)
            .unwrap_or_else(|| panic!("mount tool not in engine registry: {name}"));
        assert!(
            cmd.expose.mcp,
            "mount tool {name} is not exposed on MCP in the engine registry"
        );
        if cmd.mutation {
            assert!(
                effects == &vec!["store-write".to_string()]
                    || effects == &vec!["external".to_string()],
                "mutation {name} has unexpected effects: {effects:?}"
            );
            if cmd.destructive == Some(true) {
                assert_eq!(
                    effects,
                    &vec!["external".to_string()],
                    "destructive mutation {name} must declare external effect"
                );
            }
        } else {
            assert_eq!(
                effects,
                &vec!["inspect".to_string()],
                "read command {name} must declare inspect effect"
            );
        }
    }

    let missing: Vec<&str> = by_name
        .values()
        .filter(|cmd| cmd.expose.mcp && cmd.name.starts_with("mail-") && !seen.contains(&cmd.name))
        .map(|cmd| cmd.name.as_str())
        .collect();
    assert!(
        missing.is_empty(),
        "MCP-exposed engine commands missing from mount/loam-app.toml: {missing:?}"
    );
}

/// plugin.spec.md section 11 item 2: every command that writes the store or a
/// provider declares `as_mutation()`, and every pure read (including
/// `mail-replyset-next` from step F3) declares `mutation == false`.
#[test]
fn mutation_declarations_match_expected_store_writers() {
    let engine = std::sync::Arc::new(loam_mail::engine::Engine::new(None));
    let registry = loam_mail::registry(&engine).expect("the engine's registry is sound");

    const EXPECTED_MUTATIONS: &[&str] = &[
        "mail-account-add",
        "mail-account-remove",
        "mail-archive",
        "mail-draft-create",
        "mail-draft-discard",
        "mail-draft-restore",
        "mail-draft-send",
        "mail-draft-update",
        "mail-label",
        "mail-mark",
        "mail-operation-approve",
        "mail-operation-cancel",
        "mail-operation-dismiss",
        "mail-operation-resume",
        "mail-operation-undo",
        "mail-policy-set",
        "mail-rebuild",
        "mail-record-propose",
        "mail-record-withdraw",
        "mail-replyset-create",
        "mail-replyset-send",
        "mail-replyset-submit",
        "mail-replyset-update",
        "mail-selection-create",
        "mail-sender-accept",
        "mail-sender-dismiss",
        "mail-sender-screen",
        "mail-sender-suggest",
        "mail-story-dismiss",
        "mail-story-propose",
        "mail-sync",
        "mail-thread-snooze",
        "mail-token-create",
        "mail-token-revoke",
        "mail-trash",
        "mail-unsubscribe",
    ];
    const EXPECTED_READS: &[&str] = &[
        "afd-docs",
        "afd-help",
        "afd-schema",
        "mail-account-list",
        "mail-attachment-open",
        "mail-draft-list",
        "mail-draft-show",
        "mail-message-list",
        "mail-message-open",
        "mail-operation-list",
        "mail-operation-show",
        "mail-policy-show",
        "mail-record-list",
        "mail-replyset-next",
        "mail-replyset-preview",
        "mail-replyset-show",
        "mail-search",
        "mail-sender-list",
        "mail-sender-show",
        "mail-status",
        "mail-story-changes",
        "mail-story-list",
        "mail-story-open",
        "mail-thread-list",
        "mail-thread-open",
        "mail-token-list",
        "mail-unsubscribe-show",
    ];

    let mut actual_mutations = Vec::new();
    let mut actual_reads = Vec::new();
    for command in registry.list() {
        if command.mutation {
            actual_mutations.push(command.name.clone());
        } else {
            actual_reads.push(command.name.clone());
        }
    }
    actual_mutations.sort();
    actual_reads.sort();
    assert_eq!(actual_mutations, EXPECTED_MUTATIONS);
    assert_eq!(actual_reads, EXPECTED_READS);
}
