//! The server's authorization hooks (`spec/authorization.md`): the real checks with the
//! `server-auth` feature, and no-ops without it, so the routing code reads the same either way.

use std::sync::Arc;

use rmcp::service::RequestContext;
use rmcp::{ErrorData, RoleServer};
use serde_json::{Map, Value};

use crate::commands::Visibility;
use crate::{CommandError, Credentials};

use super::McpServer;

/// The server's authorization configuration, if any.
#[cfg(feature = "server-auth")]
pub(crate) type AuthConfig = Option<Arc<super::auth::Authorization>>;
/// Nothing to configure without `server-auth`.
#[cfg(not(feature = "server-auth"))]
#[derive(Clone, Default)]
pub(crate) struct AuthConfig;

/// The verified credentials of a tool call's request, or the `UNAUTHORIZED` refusal of an HTTP
/// request the bearer layer did not verify (M1: fail closed, before anything runs).
#[cfg(feature = "server-auth")]
pub(crate) fn call_credentials(
    server: &McpServer,
    context: &RequestContext<RoleServer>,
) -> Result<Option<Arc<Credentials>>, Box<CommandError>> {
    let Some(auth) = &server.inner.auth else {
        return Ok(None);
    };
    super::auth::request_credentials(context)
        .map_err(|refused| Box::new(refused.command_error(auth)))
}

#[cfg(not(feature = "server-auth"))]
pub(crate) fn call_credentials(
    _server: &McpServer,
    _context: &RequestContext<RoleServer>,
) -> Result<Option<Arc<Credentials>>, Box<CommandError>> {
    Ok(None)
}

/// Fail closed and check the required scopes of a request that names no command
/// (`tools/list`, `server/discover`, `resources/*`, `initialize` and the rest).
#[cfg(feature = "server-auth")]
pub(crate) fn check_request(
    server: &McpServer,
    context: &RequestContext<RoleServer>,
) -> Result<Option<Arc<Credentials>>, ErrorData> {
    let Some(auth) = &server.inner.auth else {
        return Ok(None);
    };
    super::auth::check_request(auth, context)
        .map_err(|refused| super::auth::error_data(auth, &refused))
}

#[cfg(not(feature = "server-auth"))]
pub(crate) fn check_request(
    _server: &McpServer,
    _context: &RequestContext<RoleServer>,
) -> Result<Option<Arc<Credentials>>, ErrorData> {
    Ok(None)
}

/// After routing (M6): the `INSUFFICIENT_SCOPE` failure of a call of `tool` with `args` by a
/// caller with `credentials`, or `None` to proceed.
#[cfg(feature = "server-auth")]
pub(crate) fn call_refusal(
    server: &McpServer,
    tool: &str,
    args: &Map<String, Value>,
    credentials: Option<&Credentials>,
) -> Option<CommandError> {
    let (Some(auth), Some(credentials)) = (&server.inner.auth, credentials) else {
        return None;
    };
    let missing = super::auth::scopes::call_missing(server, auth, tool, args, credentials);
    (!missing.is_empty()).then(|| super::auth::insufficient_scope(auth, &missing))
}

#[cfg(not(feature = "server-auth"))]
pub(crate) fn call_refusal(
    _server: &McpServer,
    _tool: &str,
    _args: &Map<String, Value>,
    _credentials: Option<&Credentials>,
) -> Option<CommandError> {
    None
}

/// The listing filter for a caller with `credentials` (M6, "Listing").
#[cfg(feature = "server-auth")]
pub(crate) fn visibility(
    server: &McpServer,
    credentials: Option<&Arc<Credentials>>,
) -> Option<Visibility> {
    super::auth::visibility(server.inner.auth.as_ref()?, credentials)
}

#[cfg(not(feature = "server-auth"))]
pub(crate) fn visibility(
    _server: &McpServer,
    _credentials: Option<&Arc<Credentials>>,
) -> Option<Visibility> {
    None
}

/// Whether `tools/list` varies by authorization, so its `cacheScope` is `private`.
#[cfg(feature = "server-auth")]
pub(crate) fn filters_listing(server: &McpServer) -> bool {
    server
        .inner
        .auth
        .as_ref()
        .is_some_and(|auth| auth.filter_tools_by_scope)
}

#[cfg(not(feature = "server-auth"))]
pub(crate) fn filters_listing(_server: &McpServer) -> bool {
    false
}
