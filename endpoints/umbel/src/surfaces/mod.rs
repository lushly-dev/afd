//! How the host presents its registry: the first-class tool set, the MCP server.

pub(crate) mod http;
pub(crate) mod mcp;

use afd::CommandRegistry;
use afd::server::MAX_FIRST_CLASS_TOOLS;

/// The first-class tool set `seal` settled on, and how plugin suggestions fared against it
/// (specification section 8.4, D45).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FirstClassPlan {
    /// The set, in list order.
    pub tools: Vec<String>,
    /// Whether the deployer's `mcp.first_class_tools` chose the set; plugin suggestions then do
    /// not apply.
    pub explicit: bool,
    /// Every suggestion the manifests made that MCP exposes, in order.
    pub suggested: Vec<String>,
    /// The suggestions that did not fit the cap of [`MAX_FIRST_CLASS_TOOLS`].
    pub dropped: Vec<String>,
}

/// The first-class tools of the hybrid strategy (H1). The deployer's `explicit` list always
/// wins. Otherwise the default set is "what is this host and its spaces" at session start and
/// "what changed since my cursor" during a session (D31), then the commands plugin manifests
/// suggest with `first_class = true` (`suggestions`, in instance order and manifest order),
/// up to the cap; the suggestions past it are dropped and reported. Only commands that are
/// registered and exposed to MCP are named, so the set stays valid while the event commands are
/// not yet registered.
pub(crate) fn first_class_plan(
    explicit: Option<&[String]>,
    registry: &CommandRegistry,
    suggestions: &[String],
) -> FirstClassPlan {
    let exposed = |name: &str| {
        registry
            .get(name)
            .is_some_and(|command| command.expose.is_exposed_to(afd::CommandInterface::Mcp))
    };
    let mut suggested: Vec<String> = Vec::new();
    for name in suggestions {
        if exposed(name) && !suggested.contains(name) {
            suggested.push(name.clone());
        }
    }
    if let Some(explicit) = explicit {
        return FirstClassPlan {
            tools: explicit.to_vec(),
            explicit: true,
            suggested,
            dropped: Vec::new(),
        };
    }
    let mut tools: Vec<String> = ["workspace-show", "event-list"]
        .into_iter()
        .filter(|name| exposed(name))
        .map(str::to_owned)
        .collect();
    let mut dropped = Vec::new();
    for name in &suggested {
        if tools.contains(name) {
            continue;
        }
        if tools.len() < MAX_FIRST_CLASS_TOOLS {
            tools.push(name.clone());
        } else {
            dropped.push(name.clone());
        }
    }
    FirstClassPlan {
        tools,
        explicit: false,
        suggested,
        dropped,
    }
}
