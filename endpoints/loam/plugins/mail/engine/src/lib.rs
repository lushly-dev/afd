//! Loam Mail's engine: a person's mail on their machine, served as AFD commands.
//!
//! Built a step at a time from the engine's specification
//! (`../docs/engine.spec.md`). So far: the command registry and the rules every
//! command in it must keep, the command line's entry point, the data
//! directory, the log, the store's tables, what is derived from the log
//! (fields, threads, the search index), the provider interface and its IMAP
//! implementation, sync, and the commands `mail-sync`, `mail-status` and
//! `mail-rebuild`. The other commands arrive with the steps that follow.

pub mod cli;
pub mod commands;
pub mod derive;
pub mod engine;
pub mod home;
pub mod index;
pub mod log;
pub mod provider;
pub mod rules;
pub mod store;
pub mod sync;

use std::sync::Arc;

use afd::CommandRegistry;

use crate::engine::Engine;

/// The program's name, as a person types it.
pub const PROGRAM: &str = "loam-mail";

/// The domain every command of the engine is in.
pub const DOMAIN: &str = "mail";

/// Builds the command registry of `engine` and checks it against
/// [`rules::check`].
///
/// # Errors
/// Returns the broken rules, one per line, if a registered command breaks one
/// or two commands share a name. The engine refuses to start with such a
/// registry.
pub fn registry(engine: &Arc<Engine>) -> Result<CommandRegistry, String> {
    let registry = CommandRegistry::new();
    // Commands are registered here, a step at a time.
    registry.register(commands::rebuild(Arc::clone(engine)))?;
    registry.register(commands::sync(Arc::clone(engine)))?;
    registry.register(commands::status(Arc::clone(engine)))?;
    let broken = rules::check(&registry);
    if broken.is_empty() {
        Ok(registry)
    } else {
        Err(broken.join("\n"))
    }
}
