//! The rules every command in the engine's registry keeps, checked when the
//! registry is built and again by the tests.
//!
//! The `afd` crate enforces an approval policy but does not act on a command's
//! `destructive` flag, and it knows nothing of this engine's naming. These
//! checks tie the declarations together (the specification's M18 and M29).

use afd::{ApprovalPolicy, CommandDefinition, CommandRegistry};

use crate::DOMAIN;

/// Returns one sentence for each rule a command in `registry` breaks, in the
/// order of the commands' names. An empty list means the registry is sound.
#[must_use]
pub fn check(registry: &CommandRegistry) -> Vec<String> {
    let mut commands = registry.list();
    commands.sort_by(|a, b| a.name.cmp(&b.name));
    commands
        .iter()
        .flat_map(|command| check_command(command))
        .collect()
}

/// The rules one command breaks.
fn check_command(command: &CommandDefinition) -> Vec<String> {
    let mut broken = Vec::new();
    let name = &command.name;
    let holds_for_approval = matches!(
        command.approval,
        Some(ApprovalPolicy::Required | ApprovalPolicy::Conditional(_))
    );

    if name
        .strip_prefix(DOMAIN)
        .and_then(|rest| rest.strip_prefix('-'))
        .is_none_or(str::is_empty)
    {
        broken.push(format!("{name}: a command's name starts with `{DOMAIN}-`"));
    }
    // M29: what cannot be undone needs the person's approval, every time. A
    // policy decided per call could waive it, so only `Required` counts.
    let always_held = matches!(command.approval, Some(ApprovalPolicy::Required));
    if command.destructive == Some(true) && !always_held {
        broken.push(format!(
            "{name}: a destructive command always requires approval (M29)"
        ));
    }
    if command.destructive == Some(true) && !command.mutation {
        broken.push(format!("{name}: a destructive command is a mutation"));
    }
    // M18: a command that waits for a person is the command line's alone. The
    // crate turns `palette` and `agent` on by default, so each is named.
    let expose = &command.expose;
    if holds_for_approval && (expose.mcp || expose.agent || expose.palette) {
        broken.push(format!(
            "{name}: a command with an approval policy is exposed to `cli` only (M18)"
        ));
    }
    if !(expose.cli || expose.mcp) {
        broken.push(format!(
            "{name}: a command is exposed to `cli`, `mcp` or both"
        ));
    }
    broken
}
