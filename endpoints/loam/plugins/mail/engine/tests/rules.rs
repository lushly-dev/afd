//! The registry's rules (the specification's M18 and M29), each seen failing.

#![allow(clippy::expect_used)]

use afd::{
    ApprovalPolicy, CommandContext, CommandDefinition, CommandHandler, CommandRegistry,
    CommandResult, ExposeOptions, success,
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
    let registry = loam_mail::registry().expect("the engine's registry is sound");
    assert_eq!(check(&registry), Vec::<String>::new());
}

#[test]
fn sound_commands_break_nothing() {
    let registry = registry_of(vec![
        command("mail-status").with_expose(ExposeOptions::new().with_cli(true).with_mcp(true)),
        command("mail-draft-send")
            .as_mutation()
            .with_destructive(true)
            .with_approval(ApprovalPolicy::Required)
            .with_expose(cli_only()),
    ]);
    assert_eq!(check(&registry), Vec::<String>::new());
}

#[test]
fn a_destructive_command_without_an_approval_policy_is_refused() {
    let registry = registry_of(vec![
        command("mail-draft-send")
            .as_mutation()
            .with_destructive(true)
            .with_expose(cli_only()),
    ]);
    assert_eq!(
        check(&registry),
        ["mail-draft-send: a destructive command carries an approval policy (M29)"]
    );
}

#[test]
fn an_approval_policy_of_not_required_does_not_count() {
    let registry = registry_of(vec![
        command("mail-draft-send")
            .as_mutation()
            .with_destructive(true)
            .with_approval(ApprovalPolicy::NotRequired)
            .with_expose(cli_only()),
    ]);
    assert_eq!(check(&registry).len(), 1);
}

#[test]
fn a_command_that_waits_for_a_person_is_refused_on_every_other_surface() {
    for expose in [
        ExposeOptions::new()
            .with_cli(true)
            .with_agent(false)
            .with_palette(false)
            .with_mcp(true),
        ExposeOptions::new()
            .with_cli(true)
            .with_agent(true)
            .with_palette(false),
        ExposeOptions::new()
            .with_cli(true)
            .with_agent(false)
            .with_palette(true),
        // The crate's defaults: palette and agent on.
        ExposeOptions::new().with_cli(true),
    ] {
        let registry = registry_of(vec![
            command("mail-policy-set")
                .as_mutation()
                .with_approval(ApprovalPolicy::Required)
                .with_expose(expose),
        ]);
        assert_eq!(
            check(&registry),
            ["mail-policy-set: a command with an approval policy is exposed to `cli` only (M18)"]
        );
    }
}

#[test]
fn a_command_outside_the_domain_or_on_no_surface_is_refused() {
    let registry = registry_of(vec![
        command("todo-list").with_expose(ExposeOptions::new().with_cli(true)),
        command("mail-hidden"),
    ]);
    assert_eq!(
        check(&registry),
        [
            "mail-hidden: a command is exposed to `cli`, `mcp` or both",
            "todo-list: a command's name starts with `mail-`",
        ]
    );
}
