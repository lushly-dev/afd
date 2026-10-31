//! A per-request context hook for [`McpServer`](super::McpServer): the place where a host turns
//! what the transport knows about a request (HTTP headers, a verified-token extension) into the
//! [`CommandContext`] commands run with.
//!
//! [`McpServer::with_context_hook`](super::McpServer::with_context_hook) installs it. The hook
//! runs once per `tools/call`, before the confirmation gate and before the command is looked up,
//! and returns the context to run with or a [`CommandError`] that becomes the call's failed
//! `CommandResult`.
//!
//! # Security
//!
//! The hook is **trust-bearing**: whatever it puts on the context (the `actor`, and later
//! credentials) is believed by every command, middleware and journal downstream.
//!
//! - **Verify, then trust.** A header such as `X-Actor` is attacker-controlled unless something
//!   in front of the server has verified the request. Read identity only from values your own
//!   transport layer set after authenticating (a `tower` layer's request extension), never from
//!   a header a caller can send. This hook does not verify tokens; it receives whatever a layer
//!   in front of the service established.
//! - **Fail closed.** Return `Err` when the request cannot be attributed. Nothing runs: not the
//!   command, not a confirmation prompt, and an unknown tool name answers the same way as a real
//!   one, so a refused caller learns nothing about which tools exist.
//! - **A refusal is shown to the caller.** Only the `code`, `message`, `suggestion` and
//!   `retryable` of the [`CommandError`] reach the client; `details` and `cause` are dropped.
//!   Do not put the reason a credential was rejected, a user name or a policy name in the message.
//!   Log the reason on the server and return a generic one (`UNAUTHORIZED` or `FORBIDDEN`).
//! - **A panic is a refusal.** A hook that panics refuses the request with a generic
//!   `INTERNAL_ERROR`; the panic message is never sent.
//! - **The server keeps its own invariants.** After the hook, the context's `interface` is set to
//!   [`CommandInterface::Mcp`] and the call is marked remote (so `expose.mcp` is always enforced
//!   and an unexposed command stays indistinguishable from a missing one), a missing `trace_id`
//!   is refilled, a missing `actor`, `clock` or `random` falls back to the server's defaults, and
//!   the active context is the request's own (`_meta["dev.afd/context"]` or the connection's
//!   stack; see [`McpServer::with_contexts`](super::McpServer::with_contexts)), whatever the hook
//!   set. Everything else, including `approval` evidence and `extra`, is exactly what the hook
//!   returns. Never copy request input into `approval`.
//! - **Every route.** The hook runs once for the call whatever the tool: a command's own tool, a
//!   grouped tool, `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`, `afd-detail` or an
//!   unknown name. Every batch item and pipeline step runs with its context.
//!
//! The hook does not cover `tools/list`, `server/discover` or `initialize`; to refuse a request
//! before any MCP handling (a missing or invalid bearer token, for example), put a `tower` layer
//! in front of [`McpServer::streamable_http_service`](super::McpServer::streamable_http_service).
//!
//! # Transports
//!
//! Over Streamable HTTP the request carries its [`http::request::Parts`], so the hook reads
//! headers and the extensions that layers in front of the service inserted. Over stdio there is
//! no such request: [`ContextHookRequest::http_parts`] is `None`, and the hook usually returns
//! the context unchanged (the process boundary is the trust boundary there).
//!
//! # Example
//!
//! ```no_run
//! use std::sync::Arc;
//! use afd::{server::McpServer, Actor, ActorKind, CommandError, CommandRegistry};
//!
//! // A layer in front of the service verifies the bearer token and inserts this extension.
//! #[derive(Clone)]
//! struct VerifiedCaller { id: String }
//!
//! let registry = Arc::new(CommandRegistry::new());
//! let server = McpServer::new(registry, "my-app", "1.0.0").with_context_hook(
//!     |request, context| async move {
//!         let Some(parts) = request.http_parts() else {
//!             return Ok(context); // stdio
//!         };
//!         match parts.extensions.get::<VerifiedCaller>() {
//!             Some(caller) => Ok(context.with_actor(Actor::new(ActorKind::Agent).with_id(&caller.id))),
//!             None => Err(CommandError::new("UNAUTHORIZED", "Authentication is required")
//!                 .with_suggestion("Send a valid bearer token")),
//!         }
//!     },
//! );
//! ```

use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use futures_util::FutureExt;
use rmcp::service::RequestContext;
use rmcp::RoleServer;

use crate::{
    with_context_defaults, CommandContext, CommandError, CommandInterface, ContextDefaults,
};

/// What the hook is told about the request. Extra fields can be added without breaking hooks.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct ContextHookRequest {
    /// The `name` of the tool being called, as the client sent it. It may name a tool that does
    /// not exist or is not exposed to MCP: the hook runs first on purpose.
    pub tool: String,
    request: RequestContext<RoleServer>,
}

impl ContextHookRequest {
    pub(crate) fn new(tool: &str, request: &RequestContext<RoleServer>) -> Self {
        Self {
            tool: tool.to_owned(),
            request: request.clone(),
        }
    }

    /// The SDK's request context: `meta`, `extensions`, the `peer` and the cancellation token.
    pub fn request_context(&self) -> &RequestContext<RoleServer> {
        &self.request
    }

    /// The HTTP request's head (method, URI, headers and the extensions inserted by layers in
    /// front of the service). `None` over stdio.
    pub fn http_parts(&self) -> Option<&http::request::Parts> {
        self.request.extensions.get::<http::request::Parts>()
    }

    /// A request header as text. `None` over stdio, when the header is absent, or when its value
    /// is not visible ASCII. With repeated headers, the first.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.http_parts()?.headers.get(name)?.to_str().ok()
    }
}

/// The stored hook. Build one with [`McpServer::with_context_hook`](super::McpServer::with_context_hook).
pub(crate) type ContextHook = Arc<
    dyn Fn(
            ContextHookRequest,
            CommandContext,
        ) -> BoxFuture<'static, Result<CommandContext, CommandError>>
        + Send
        + Sync,
>;

pub(crate) fn boxed<F, Fut>(hook: F) -> ContextHook
where
    F: Fn(ContextHookRequest, CommandContext) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<CommandContext, CommandError>> + Send + 'static,
{
    Arc::new(move |request, context| hook(request, context).boxed())
}

/// A refusal as the caller sees it: nothing beyond the four fields a client can act on.
fn visible(error: CommandError) -> CommandError {
    CommandError {
        details: None,
        cause: None,
        ..error
    }
}

/// Build the context a tool call runs with.
///
/// `base` already carries the trace id, the `mcp` interface and the remote flag. Without a hook the result is
/// `base` with the server's defaults; with one, the hook's answer is normalized so it cannot
/// drop the server's invariants (see the module docs).
pub(crate) async fn build_context(
    hook: Option<&ContextHook>,
    defaults: &ContextDefaults,
    tool: &str,
    request: &RequestContext<RoleServer>,
    base: CommandContext,
) -> Result<CommandContext, Box<CommandError>> {
    let base = with_context_defaults(base, defaults);
    let Some(hook) = hook else {
        return Ok(base);
    };
    let trace_id = base.trace_id.clone();
    // The hook is given the defaults too, so it can refine the actor rather than start over.
    let answer =
        AssertUnwindSafe(async { hook(ContextHookRequest::new(tool, request), base).await })
            .catch_unwind()
            .await;
    let mut context = match answer {
        Ok(Ok(context)) => context,
        Ok(Err(error)) => return Err(Box::new(visible(error))),
        Err(_) => return Err(Box::new(super::panic_guard::internal_failure())),
    };
    context.interface = Some(CommandInterface::Mcp);
    context.remote = true;
    if context.trace_id.is_none() {
        context.trace_id = trace_id;
    }
    Ok(with_context_defaults(context, defaults))
}
