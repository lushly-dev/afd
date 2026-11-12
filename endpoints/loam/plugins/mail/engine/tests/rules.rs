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
