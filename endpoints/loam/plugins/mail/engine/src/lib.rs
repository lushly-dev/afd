//! Loam Mail's engine: a person's mail on their machine, served as AFD commands.
//!
//! This is the skeleton of step B1 of the engine's specification
//! (`../docs/engine.spec.md`). It holds the command registry, the rules every
//! command in it must keep, and the command line's entry point. The commands
//! themselves arrive with the steps that follow.

pub mod cli;
pub mod rules;

use afd::CommandRegistry;

/// The program's name, as a person types it.
pub const PROGRAM: &str = "loam-mail";

/// The domain every command of the engine is in.
pub const DOMAIN: &str = "mail";

/// Builds the engine's command registry and checks it against [`rules::check`].
///
/// # Errors
/// Returns the broken rules, one per line, if a registered command breaks one.
/// The engine refuses to start with such a registry.
pub fn registry() -> Result<CommandRegistry, String> {
    let registry = CommandRegistry::new();
    // Commands are registered here, a step at a time.
    let broken = rules::check(&registry);
    if broken.is_empty() {
        Ok(registry)
    } else {
        Err(broken.join("\n"))
    }
}
