//! Loam Mail's engine: a person's mail on their machine, served as AFD commands.
//!
//! Built a step at a time from the engine's specification
//! (`../docs/engine.spec.md`). So far: the command registry and the rules every
//! command in it must keep, the command line's entry point, the data
//! directory, the log, the store's tables, what is derived from the log
//! (fields, threads, the search index), the provider interface and its IMAP
//! implementation, sync, the keychain, the read commands, the tokens and the
//! journal, and the server: `serve` over HTTP, `mcp` over stdio, and the
//! command line's forwarding to a running server. The other commands arrive
//! with the steps that follow.

pub mod cli;
pub mod commands;
pub mod derive;
pub mod engine;
pub mod fetch;
pub mod forward;
pub mod home;
pub mod html;
pub mod index;
pub mod journal;
pub mod log;
pub mod parts;
pub mod provider;
pub mod read;
pub mod rules;
pub mod secrets;
pub mod serve;
pub mod store;
pub mod sync;
pub mod tokens;
pub mod work;

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
    registry.register(commands::account_remove(Arc::clone(engine)))?;
    registry.register(read::thread_list(Arc::clone(engine)))?;
    registry.register(read::thread_open(Arc::clone(engine)))?;
    registry.register(read::message_open(Arc::clone(engine)))?;
    registry.register(read::attachment_open(Arc::clone(engine)))?;
    registry.register(read::search(Arc::clone(engine)))?;
    registry.register(tokens::create(Arc::clone(engine)))?;
    registry.register(tokens::list(Arc::clone(engine)))?;
    registry.register(tokens::revoke(Arc::clone(engine)))?;
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
            .with_summarize({
                let engine = Arc::clone(engine);
                move |command, input, _context| commands::approval_summary(&engine, command, input)
            }),
    )?;
    registry.add_middleware(gate);
    registry.add_middleware(reply_limit(Arc::clone(engine)));
    if let Some(home) = engine.home() {
        registry.set_journal(journal::recorder(home, &registry, Arc::clone(engine)));
    }
    Ok(registry)
}

/// On a running server, a reply larger than a call may return (the
/// specification's 3.2) becomes a failure that says so. Each read's largest
/// output budget fits within the limit, so this is the last guard, for a
/// reply that is mostly text the MCP escaping doubles.
fn reply_limit(engine: Arc<engine::Engine>) -> afd::CommandMiddleware {
    Arc::new(move |_name, _input, context, next| {
        let engine = Arc::clone(&engine);
        Box::pin(async move {
            let result = next().await;
            if !engine.work().serving() {
                return result;
            }
            let limit = engine.limits().reply;
            let size = reply_size(&result, context.interface);
            if size <= limit {
                return result;
            }
            afd::failure(
                afd::CommandError::new(
                    "REPLY_TOO_LARGE",
                    format!(
                        "the reply is {size} bytes, more than the {limit} a call to a running server may return; a command that changes something has made its change"
                    ),
                )
                .with_suggestion("Ask for less: a smaller output budget, a page or a window."),
            )
        })
    })
}

/// The bytes a result takes in its reply: over MCP the result goes out as
/// JSON text and again as structured content, so twice, the text escaped.
/// The few bytes of the reply's envelope are left out.
fn reply_size(
    result: &afd::CommandResult<serde_json::Value>,
    interface: Option<afd::CommandInterface>,
) -> usize {
    let Ok(text) = serde_json::to_string(result) else {
        return 0;
    };
    if interface == Some(afd::CommandInterface::Mcp) {
        let escaped = serde_json::to_string(&text).map_or(0, |escaped| escaped.len());
        text.len() + escaped
    } else {
        text.len()
    }
}
