//! Loam Mail's engine: a person's mail on their machine, served as AFD commands.
//!
//! Built a step at a time from the engine's specification
//! (`../docs/engine.spec.md`). So far: the command registry and the rules every
//! command in it must keep, the command line's entry point, the data
//! directory, the log, the store's tables, what is derived from the log
//! (fields, threads, the search index), the provider interface and its IMAP
//! implementation, sync, the keychain, the read commands, senders, screening
//! (classes, the person's decisions and agents' suggestions), stream stories,
//! bursts, selections and the person's policy, the changes at the provider
//! with their operations, undo and proposals, drafts and snoozed threads,
//! unsubscribe, proposed records,
//! the tokens and the journal,
//! and the server: `serve` over HTTP, `mcp` over stdio, and the command
//! line's forwarding to a running server. The other commands arrive with the
//! steps that follow.

#[cfg(all(feature = "test-doubles", not(debug_assertions)))]
compile_error!(
    "the `test-doubles` feature is for debug/test builds only and must never be enabled in release builds"
);

pub mod changes;
pub mod cli;
pub mod commands;
pub mod derive;
#[cfg(feature = "test-doubles")]
pub mod doubles;
pub mod drafts;
pub mod engine;
pub mod fetch;
pub mod forward;
pub mod home;
pub mod html;
pub mod index;
pub mod journal;
pub mod log;
pub mod operate;
pub mod operations;
pub mod parts;
pub mod policy;
pub mod provider;
pub mod read;
pub mod records;
pub mod replysets;
pub mod rules;
pub mod screening;
pub mod secrets;
pub mod selections;
pub mod senders;
pub mod serve;
pub mod store;
pub mod stories;
pub mod sync;
pub mod tokens;
pub mod unsubscribe;
pub mod work;

use std::sync::Arc;

use afd::{ActorKind, CommandContext, CommandInterface, CommandRegistry};

use crate::engine::Engine;

/// The program's name, as a person types it.
pub const PROGRAM: &str = "loam-mail";

/// The domain every command of the engine is in.
pub const DOMAIN: &str = "mail";

/// Optional build features compiled into this binary (reported by `--version`).
#[cfg(feature = "test-doubles")]
pub const BUILD_FEATURES: &[&str] = &["test-doubles"];

/// Optional build features compiled into this binary (reported by `--version`).
#[cfg(not(feature = "test-doubles"))]
pub const BUILD_FEATURES: &[&str] = &[];

/// How long a person's approval stays good: within one run of the command
/// line, whose key dies with it.
const APPROVAL_TTL_MS: u64 = 30 * 60 * 1000;

/// Whether `context` is an approver caller over HTTP MCP (plugin.spec.md,
/// sections 4.2 and 5.2): `interface == Mcp`, actor is `Agent` with a token id
/// whose loaded role in `engine` is [`store::TokenRole::Approver`].
///
/// The same predicate feeds `McpServer::with_approver` and the middleware that
/// strips `details.approvalToken` for non-approver MCP calls, so the two never
/// disagree. Over stdio (`loam-mail mcp`) there is no actor id; on `/cli` the
/// interface is `Cli`. Neither is ever an approver.
#[must_use]
pub fn is_approver(engine: &Engine, context: &CommandContext) -> bool {
    if context.interface != Some(CommandInterface::Mcp) {
        return false;
    }
    let Some(actor) = context.actor.as_ref() else {
        return false;
    };
    if actor.kind != ActorKind::Agent {
        return false;
    }
    let Some(id) = actor.id.as_deref() else {
        return false;
    };
    engine.is_approver_token(id)
}

/// Builds the command registry of `engine`, registers AFD's bootstrap commands
/// (`afd-help`, `afd-docs`, `afd-schema`), checks it against [`rules::check`],
/// and installs the approval and safety middleware (the specification's section
/// 3.5 and plugin.spec.md sections 5.2 and 12.1).
///
/// # Errors
/// Returns the broken rules, one per line, if a registered command breaks one
/// or two commands share a name, or why the approval middleware could not be
/// made. The engine refuses to start with such a registry.
pub fn registry(engine: &Arc<Engine>) -> Result<Arc<CommandRegistry>, String> {
    let registry = Arc::new(CommandRegistry::new());
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
    registry.register(senders::list(Arc::clone(engine)))?;
    registry.register(senders::show(Arc::clone(engine)))?;
    registry.register(screening::screen(Arc::clone(engine)))?;
    registry.register(screening::suggest(Arc::clone(engine)))?;
    registry.register(screening::accept(Arc::clone(engine)))?;
    registry.register(screening::dismiss(Arc::clone(engine)))?;
    registry.register(screening::message_list(Arc::clone(engine)))?;
    registry.register(stories::story_list(Arc::clone(engine)))?;
    registry.register(stories::story_open(Arc::clone(engine)))?;
    registry.register(stories::story_changes(Arc::clone(engine)))?;
    registry.register(stories::story_propose(Arc::clone(engine)))?;
    registry.register(stories::story_dismiss(Arc::clone(engine)))?;
    registry.register(tokens::create(Arc::clone(engine)))?;
    registry.register(tokens::list(Arc::clone(engine)))?;
    registry.register(tokens::revoke(Arc::clone(engine)))?;
    registry.register(selections::create(Arc::clone(engine)))?;
    registry.register(policy::show(Arc::clone(engine)))?;
    registry.register(policy::set(Arc::clone(engine)))?;
    registry.register(changes::archive(Arc::clone(engine)))?;
    registry.register(changes::label(Arc::clone(engine)))?;
    registry.register(changes::mark(Arc::clone(engine)))?;
    registry.register(changes::trash(Arc::clone(engine)))?;
    registry.register(operations::list(Arc::clone(engine)))?;
    registry.register(operations::show(Arc::clone(engine)))?;
    registry.register(operations::resume(Arc::clone(engine)))?;
    registry.register(operations::cancel(Arc::clone(engine)))?;
    registry.register(operations::undo(Arc::clone(engine)))?;
    registry.register(operations::approve(Arc::clone(engine)))?;
    registry.register(operations::dismiss(Arc::clone(engine)))?;
    registry.register(drafts::create(Arc::clone(engine)))?;
    registry.register(drafts::update(Arc::clone(engine)))?;
    registry.register(drafts::discard(Arc::clone(engine)))?;
    registry.register(drafts::restore(Arc::clone(engine)))?;
    registry.register(drafts::list(Arc::clone(engine)))?;
    registry.register(drafts::show(Arc::clone(engine)))?;
    registry.register(drafts::send(Arc::clone(engine)))?;
    registry.register(drafts::snooze(Arc::clone(engine)))?;
    registry.register(unsubscribe::show(Arc::clone(engine)))?;
    registry.register(unsubscribe::unsubscribe(Arc::clone(engine)))?;
    registry.register(records::list(Arc::clone(engine)))?;
    registry.register(records::propose(Arc::clone(engine)))?;
    registry.register(records::withdraw(Arc::clone(engine)))?;
    registry.register(replysets::create(Arc::clone(engine)))?;
    registry.register(replysets::update(Arc::clone(engine)))?;
    registry.register(replysets::next(Arc::clone(engine)))?;
    registry.register(replysets::submit(Arc::clone(engine)))?;
    registry.register(replysets::show(Arc::clone(engine)))?;
    registry.register(replysets::preview(Arc::clone(engine)))?;
    registry.register(replysets::send(Arc::clone(engine)))?;
    afd::register_bootstrap_commands(&registry)?;
    let broken = rules::check(&registry);
    if !broken.is_empty() {
        return Err(broken.join("\n"));
    }
    install_middleware(&registry, engine)?;
    Ok(registry)
}

/// Installs the engine's production middleware (pre-approval check, non-approver
/// token stripping, approval gate, reply size limit) and journal recorder onto
/// `registry`.
///
/// # Errors
/// When the approval middleware cannot be created.
pub fn install_middleware(registry: &CommandRegistry, engine: &Arc<Engine>) -> Result<(), String> {
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
                move |command, input, context| {
                    commands::approval_summary(&engine, command, input, context.clock().now())
                }
            }),
    )?;
    registry.add_middleware(pre_approval_check(Arc::clone(engine)));
    registry.add_middleware(strip_non_approver_token(Arc::clone(engine)));
    registry.add_middleware(gate);
    registry.add_middleware(reply_limit(Arc::clone(engine)));
    if let Some(home) = engine.home() {
        registry.set_journal(journal::recorder(home, registry, Arc::clone(engine)));
    }
    Ok(())
}

/// Strips `details.approvalToken` and replaces the suggestion on `APPROVAL_REQUIRED`
/// results returned over MCP to callers that are not approvers (plugin.spec.md,
/// section 5.2, M37). The command line's route and approver clients keep the token.
fn strip_non_approver_token(engine: Arc<engine::Engine>) -> afd::CommandMiddleware {
    Arc::new(move |name, _input, context, next| {
        let engine = Arc::clone(&engine);
        let name = name.to_string();
        let should_strip =
            context.interface == Some(CommandInterface::Mcp) && !is_approver(&engine, &context);
        Box::pin(async move {
            let mut result = next(context).await;
            if should_strip
                && let Some(error) = result.error.as_mut()
                && error.code == "APPROVAL_REQUIRED"
            {
                if let Some(details) = error.details.as_mut() {
                    details.remove("approvalToken");
                }
                error.retryable = Some(false);
                error.suggestion = Some(format!(
                    "Only the person can do this: at the terminal with `{PROGRAM} {name}`, or in Loam, which shows them the preview and asks."
                ));
            }
            result
        })
    })
}

/// Checks preview digests and revisions before the approval middleware holds a
/// call, so a missing/unusable/incomplete target or stale preview fails without
/// issuing a token.
fn pre_approval_check(engine: Arc<engine::Engine>) -> afd::CommandMiddleware {
    Arc::new(move |name, input, context, next| {
        let engine = Arc::clone(&engine);
        let name = name.to_string();
        let input = input.clone();
        let now = context.clock().now();
        Box::pin(async move {
            if name == drafts::SEND
                && let Some(error) = drafts::pre_approval_check(&engine, &input, now)
            {
                return afd::failure(error);
            }
            if name == unsubscribe::UNSUBSCRIBE
                && let Some(error) = unsubscribe::pre_approval_check(&engine, &input)
            {
                return afd::failure(error);
            }
            if name == replysets::SEND
                && let Some(error) = replysets::pre_approval_check(&engine, &input)
            {
                return afd::failure(error);
            }
            if name == operations::APPROVE
                && let Some(error) = operations::pre_approval_check(&engine, &input, now)
            {
                return afd::failure(error);
            }
            next(context).await
        })
    })
}

/// On a running server, a reply larger than a call may return (the
/// specification's 3.2) becomes a failure that says so. Each read's largest
/// output budget fits within the limit, so this is the last guard, for a
/// reply that is mostly text the MCP escaping doubles.
fn reply_limit(engine: Arc<engine::Engine>) -> afd::CommandMiddleware {
    Arc::new(move |_name, _input, context, next| {
        let engine = Arc::clone(&engine);
        Box::pin(async move {
            let interface = context.interface;
            let result = next(context).await;
            if !engine.work().serving() {
                return result;
            }
            let limit = engine.limits().reply;
            let size = reply_size(&result, interface);
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
#[must_use]
pub fn reply_size(
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
