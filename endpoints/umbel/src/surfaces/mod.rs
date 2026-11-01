//! How the host presents its registry: the first-class tool set, the MCP server.

pub(crate) mod http;
pub(crate) mod mcp;

use afd::CommandRegistry;

/// The first-class tools of the hybrid strategy when `mcp.first_class_tools` is absent: the
/// hot path of an empty host, "what is this host and its spaces" at session start and "what
/// changed since my cursor" during a session (D31). Only commands that are registered and
/// exposed to MCP are named, so the set stays valid while the event commands are not yet
/// registered. Phase 1 extends this from what plugin manifests declare (O3); a deployer's explicit
/// `mcp.first_class_tools` always wins.
pub(crate) fn default_first_class_tools(registry: &CommandRegistry) -> Vec<String> {
    ["workspace-show", "event-list"]
        .into_iter()
        .filter(|name| {
            registry
                .get(name)
                .is_some_and(|command| command.expose.is_exposed_to(afd::CommandInterface::Mcp))
        })
        .map(str::to_owned)
        .collect()
}
