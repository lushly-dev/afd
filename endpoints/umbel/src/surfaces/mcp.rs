//! The MCP server: hybrid strategy, two first-class tools, confirmations signed with the
//! workspace's shared key.

use crate::host::HostError;
use crate::principal;
use crate::workspace::{Confirmations, Workspace};
use afd::server::{ConfirmationMode, McpServer, ServerInstances, ToolStrategy};
use afd::{Clock, CommandRegistry, ContextConfig};
use std::sync::Arc;

pub(crate) fn mode(confirmations: Confirmations) -> ConfirmationMode {
    match confirmations {
        Confirmations::Enforce => ConfirmationMode::Enforce,
        Confirmations::RequireHuman => ConfirmationMode::RequireHuman,
        Confirmations::Off => ConfirmationMode::Off,
    }
}

/// The name and version the MCP server announces in `initialize` (`serverInfo`). Umbel's own,
/// unless the embedding binary sets its own with
/// [`HostBuilder::with_server_identity`](crate::HostBuilder::with_server_identity).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ServerIdentity {
    pub(crate) name: String,
    pub(crate) version: String,
}

impl Default for ServerIdentity {
    fn default() -> Self {
        Self {
            name: "umbel".to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
        }
    }
}

/// Build the server over `registry` and check its surface (`McpServer::validate`).
///
/// With `contexts`, the server scopes commands by them and registers `afd-context-list`,
/// `afd-context-enter` and `afd-context-exit` into `registry` (once: pass none when the registry
/// already has them, as the doctor's re-check does).
///
/// # Errors
/// `WORKSPACE_KEY_INVALID` for a confirmation key under 32 bytes; `WORKSPACE_CONFIG_INVALID`
/// naming `mcp.first_class_tools` with `McpServer::validate`'s message, or naming
/// `plugins.enabled` for contexts the server refuses.
pub(crate) fn build_server(
    registry: &Arc<CommandRegistry>,
    workspace: &Workspace,
    first_class: &[String],
    contexts: &[ContextConfig],
    clock: Option<&Arc<dyn Clock>>,
    identity: &ServerIdentity,
) -> Result<McpServer, HostError> {
    let config = &workspace.config().mcp;
    let key = workspace.confirmation_key()?;
    let mut server = McpServer::new(Arc::clone(registry), &identity.name, &identity.version)
        .with_tool_strategy(ToolStrategy::Hybrid)
        .with_context_hook(principal::hook(
            Arc::new(workspace.config().clone()),
            principal::HttpAuth::new(
                &workspace.config().auth,
                workspace.config().http.public_url.as_deref(),
            ),
            clock.cloned(),
        ))
        .with_first_class_tools(first_class.iter().cloned())
        .with_tools_list_ttl_ms(config.tools_list_ttl_ms)
        .with_confirmations_key(mode(config.confirmations), key)
        .map_err(|message| {
            HostError::new(
                crate::workspace::codes::WORKSPACE_KEY_INVALID,
                format!(
                    "{} is invalid: {message}",
                    workspace.layout().confirmation_key().display()
                ),
                format!(
                    "Delete {}; the next open creates a new key. Pending confirmations, and HTTP clients holding the old token, must start again.",
                    workspace.layout().confirmation_key().display()
                ),
            )
        })?;
    if !config.instructions.is_empty() {
        server = server.with_instructions(config.instructions.clone());
    }
    // A hosted mode's server fails closed over HTTP however it is served (phase 5 section 6.3):
    // only the listener's own authorized server admits a caller. Without the `auth` feature there
    // is no authorization to attach, so a hosted workspace does not open a host at all.
    #[cfg(feature = "auth")]
    if let Some(authorization) = super::http::base_authorization(workspace)? {
        server = server.with_authorization(authorization);
    }
    #[cfg(not(feature = "auth"))]
    if workspace.config().auth.mode.is_hosted() {
        return Err(crate::workspace::WorkspaceError::config_invalid(
            "auth.mode",
            format!(
                "is \"{}\", which this build of umbel cannot serve safely (it was built without the `auth` feature)",
                workspace.config().auth.mode.as_str()
            ),
        )
        .into());
    }
    // Hosted modes share both the confirmation key and the approval nonce store across processes
    // behind one URL; mode `none` serves one local process with in-memory approval nonces.
    let instances = if workspace.config().auth.mode.is_hosted() {
        ServerInstances::Multiple
    } else {
        ServerInstances::Single
    };
    server = server.with_instances(instances);
    if !contexts.is_empty() {
        server = server.with_contexts(contexts.to_vec()).map_err(|message| {
            HostError::config_invalid(
                "plugins.enabled",
                &format!("contributes AFD contexts the server refuses: {message}"),
                "Rename the plugin's contexts so that no two instances share a name and none is an AFD context command.",
            )
        })?;
    }
    server.validate().map_err(|message| {
        HostError::config_invalid(
            "mcp.first_class_tools",
            &format!("is not valid: {message}"),
            "Name 1 to 8 registered commands that are exposed to MCP, or remove mcp.first_class_tools to use the default set.",
        )
    })?;
    Ok(server)
}
