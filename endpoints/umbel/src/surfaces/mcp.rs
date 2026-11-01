//! The MCP server: hybrid strategy, two first-class tools, confirmations signed with the
//! workspace's shared key.

use crate::host::HostError;
use crate::principal;
use crate::workspace::{Confirmations, Workspace};
use afd::server::{ConfirmationMode, McpServer, ToolStrategy};
use afd::{Clock, CommandRegistry};
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
/// # Errors
/// `WORKSPACE_KEY_INVALID` for a confirmation key under 32 bytes; `WORKSPACE_CONFIG_INVALID`
/// naming `mcp.first_class_tools` with `McpServer::validate`'s message.
pub(crate) fn build_server(
    registry: &Arc<CommandRegistry>,
    workspace: &Workspace,
    first_class: &[String],
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
    server.validate().map_err(|message| {
        HostError::config_invalid(
            "mcp.first_class_tools",
            &format!("is not valid: {message}"),
            "Name 1 to 8 registered commands that are exposed to MCP, or remove mcp.first_class_tools to use the default set.",
        )
    })?;
    Ok(server)
}
