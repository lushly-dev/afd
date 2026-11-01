//! The MCP server: hybrid strategy, two first-class tools, confirmations signed with the
//! workspace's shared key.

use crate::host::HostError;
use crate::principal;
use crate::workspace::{Confirmations, Workspace};
use afd::server::{ConfirmationMode, McpServer, ToolStrategy};
use afd::{Clock, CommandRegistry, ContextConfig};
use std::sync::Arc;

pub(crate) fn mode(confirmations: Confirmations) -> ConfirmationMode {
    match confirmations {
        Confirmations::Enforce => ConfirmationMode::Enforce,
        Confirmations::RequireHuman => ConfirmationMode::RequireHuman,
        Confirmations::Off => ConfirmationMode::Off,
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
) -> Result<McpServer, HostError> {
    let config = &workspace.config().mcp;
    let key = workspace.confirmation_key()?;
    let mut server = McpServer::new(Arc::clone(registry), "umbel", env!("CARGO_PKG_VERSION"))
        .with_tool_strategy(ToolStrategy::Hybrid)
        .with_context_hook(principal::hook(&workspace.config().principal, clock.cloned()))
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
