//! Loam Mail's engine: a person's mail on their machine, served as AFD commands.
//!
//! Built a step at a time from the engine's specification
//! (`../docs/engine.spec.md`). So far: the command registry and the rules every
//! command in it must keep, the command line's entry point, the data
//! directory, the log, the store's tables, what is derived from the log
//! (fields, threads, the search index), the provider interface and its IMAP
//! implementation, sync, the keychain, and the commands `mail-account-add`,
//! `mail-account-list`, `mail-sync`, `mail-status` and `mail-rebuild`. The
//! other commands arrive with the steps that follow.

pub mod cli;
pub mod commands;
pub mod derive;
pub mod engine;
pub mod home;
pub mod index;
pub mod log;
pub mod provider;
pub mod rules;
pub mod secrets;
pub mod store;
pub mod sync;

use std::sync::Arc;

use afd::CommandRegistry;

use crate::engine::Engine;

/// The program's name, as a person types it.
pub const PROGRAM: &str = "loam-mail";

/// The domain every command of the engine is in.
pub const DOMAIN: &str = "mail";

/// How long a person's approval stays good: within one run of the command
/// line, whose key dies with it.
const APPROVAL_TTL_MS: u64 = 30 * 60 * 1000;

/// Builds the command registry of `engine`, checks it against
/// [`rules::check`], and installs the approval middleware that holds a
/// person's command until it is approved (the specification's section 3.5).
///
/// # Errors
/// Returns the broken rules, one per line, if a registered command breaks one
/// or two commands share a name, or why the approval middleware could not be
/// made. The engine refuses to start with such a registry.
pub fn registry(engine: &Arc<Engine>) -> Result<CommandRegistry, String> {
    let registry = CommandRegistry::new();
    // Commands are registered here, a step at a time.
    registry.register(commands::rebuild(Arc::clone(engine)))?;
    registry.register(commands::sync(Arc::clone(engine)))?;
    registry.register(commands::status(Arc::clone(engine)))?;
    registry.register(commands::account_add(Arc::clone(engine)))?;
    registry.register(commands::account_list(Arc::clone(engine)))?;
    let broken = rules::check(&registry);
    if !broken.is_empty() {
        return Err(broken.join("\n"));
    }
    // An approval token lives only as long as the process that issued it: the
    // command line runs a command, asks, and retries in one process. The key
    // is made afresh each time and kept nowhere.
    let mut secret = [0u8; 32];
    getrandom::fill(&mut secret)
        .map_err(|_| "no random source for the approval key".to_string())?;
    // The person has time to make an app-specific password between the
    // question and the retry; the command line also asks for a fresh hold
    // once the password is in.
    let gate = afd::create_approval_middleware(
        afd::ApprovalMiddlewareOptions::new(secret, registry.list())
            .with_ttl_ms(APPROVAL_TTL_MS)
            .with_summarize(|command, input, _context| commands::approval_summary(command, input)),
    )?;
    registry.add_middleware(gate);
    Ok(registry)
}
