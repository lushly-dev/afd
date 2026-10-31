//! The last line of defence against a panic in the server's own request handling.
//!
//! A command handler's panic never gets here: [`CommandRegistry::execute`](crate::CommandRegistry::execute)
//! turns it into a `COMMAND_EXECUTION_ERROR` result (so a batch, a pipeline and an in-process
//! caller get one too). But `rmcp` runs each request on its own task, and a panic that escapes
//! that task is not an error response: the task ends, nothing is sent, and the client waits
//! forever. [`McpServer`](super::McpServer) guards every request it handles, so code the host
//! wrote that runs outside the registry (a [`with_group_by`](super::McpServer::with_group_by)
//! closure, a [`with_context_hook`](super::McpServer::with_context_hook) callback) or a bug in
//! the server cannot do that.
//!
//! What the caller sees is the generic failure of [`internal_failure`]: `INTERNAL_ERROR`, with
//! a suggestion and no panic message, location or backtrace. The default panic hook still
//! prints the panic to stderr (never stdout, which carries the stdio transport), so the
//! operator has the detail. Only unwinding panics are caught: a build with `panic = "abort"`
//! aborts the process, and so does a panic while another is unwinding.

use std::future::Future;
use std::panic::AssertUnwindSafe;

use futures_util::FutureExt;
use rmcp::model::CallToolResponse;
use rmcp::ErrorData;

use crate::{error_codes, failure, CommandError};

const MESSAGE: &str = "The request could not be processed";

/// The failure a caller sees when the server's own handling of a request panicked.
pub(crate) fn internal_failure() -> CommandError {
    CommandError::new(error_codes::INTERNAL_ERROR, MESSAGE)
        .with_suggestion("Retry later or contact the server operator")
        .with_retryable(true)
}

/// Run a `tools/call`; a panic becomes a failed `CommandResult` (`isError`, with
/// `structuredContent`) instead of a request that never answers.
pub(crate) async fn guard_call<F>(call: F) -> Result<CallToolResponse, ErrorData>
where
    F: Future<Output = Result<CallToolResponse, ErrorData>>,
{
    match AssertUnwindSafe(call).catch_unwind().await {
        Ok(response) => response,
        Err(_) => {
            super::router::tool_result(&failure::<serde_json::Value>(internal_failure()), true)
        }
    }
}

/// Run a request that answers with a JSON-RPC result; a panic becomes a generic `-32603` error.
pub(crate) async fn guard_request<T, F>(request: F) -> Result<T, ErrorData>
where
    F: Future<Output = Result<T, ErrorData>>,
{
    match AssertUnwindSafe(request).catch_unwind().await {
        Ok(response) => response,
        Err(_) => Err(ErrorData::internal_error(MESSAGE, None)),
    }
}
