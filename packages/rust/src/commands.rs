//! Command definition and registry types.
//!
//! Commands are the core abstraction in AFD. Every application action
//! is defined as a command with a clear schema.

use async_trait::async_trait;
use futures_util::{stream::FuturesUnordered, FutureExt, StreamExt};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::pin::Pin;
use std::sync::{Arc, OnceLock, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::Duration;

use crate::actor::{with_context_defaults, ContextDefaults};
use crate::approval::{approval_mode, ApprovalPolicy};
use crate::batch::{
    create_batch_result, create_failed_batch_result, BatchCommandResult, BatchRequest, BatchResult,
    BatchTiming,
};
use crate::context_fields::{apply_context_fields, check_context_fields, ContextField};
use crate::errors::{error_codes, CommandError};
use crate::handoff::HandoffCommandLike;
use crate::journal::JournalRecorder;
use crate::result::{execution_failure, failure, CommandResult, ResultMetadata};
use crate::time::Instant;

mod chain;
mod context;

use chain::{middleware_chain, run_handler};
pub(crate) use context::CallState;
pub use context::CommandContext;
#[cfg(feature = "server")]
pub(crate) use context::InstanceGuard;
// The MCP server sets these on a request's context.
#[cfg(feature = "server")]
pub(crate) use context::ScopeCheck;
// The unit tests set the two filters a server would.
#[cfg(any(feature = "server", test))]
pub(crate) use context::{ToolSurface, Visibility};

type BatchExecutionFuture<'a> =
    Pin<Box<dyn Future<Output = (usize, BatchCommandResult<serde_json::Value>)> + Send + 'a>>;

mod definition;
mod execute;
mod registry;
mod tool_export;

pub use definition::*;
#[allow(unused_imports)]
pub(crate) use execute::*;
pub use registry::*;
pub use tool_export::*;

// COMMAND DEFINITION

/// A boxed, `Send` future, as returned by middleware.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Runs the rest of the middleware chain and then the handler, with the context it is given.
///
/// A middleware passes on the context it received, refined if it needs to be (a trace ID, an
/// actor, a field of `extra`): the layers after it and the handler see that context. It may call
/// `next` more than once (a retry middleware does), cloning the context for each call. The
/// `interface`, `credentials`, `clock`, `random` and the state only the crate sets stay as they
/// were before the chain, at every layer and at the handler.
pub type MiddlewareNext = Arc<
    dyn Fn(CommandContext) -> BoxFuture<'static, CommandResult<serde_json::Value>> + Send + Sync,
>;

/// Middleware that wraps command execution, added with
/// [`CommandRegistry::add_middleware`].
///
/// It receives the command name, the validated input (shared, so no layer copies it), the
/// context and `next`, and returns the result: usually `next(context).await`, possibly inspected
/// or replaced. A middleware that returns without calling `next` stops the call.
///
/// # Example
///
/// ```rust
/// use afd::{CommandMiddleware, CommandRegistry};
/// use std::sync::Arc;
///
/// let logging: CommandMiddleware = Arc::new(|name, _input, context, next| {
///     Box::pin(async move {
///         let result = next(context).await;
///         println!("{name}: success={}", result.success);
///         result
///     })
/// });
///
/// let registry = CommandRegistry::new();
/// registry.add_middleware(logging);
/// ```
pub type CommandMiddleware = Arc<
    dyn Fn(
            String,
            Arc<serde_json::Value>,
            CommandContext,
            MiddlewareNext,
        ) -> BoxFuture<'static, CommandResult<serde_json::Value>>
        + Send
        + Sync,
>;

/// Trait for command handlers.
#[async_trait]
pub trait CommandHandler: Send + Sync {
    /// Execute the command with the given input.
    async fn execute(
        &self,
        input: serde_json::Value,
        context: CommandContext,
    ) -> CommandResult<serde_json::Value>;
}

#[cfg(test)]
mod tests;
