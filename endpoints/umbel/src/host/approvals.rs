//! `mcp.approvals = "off"` (auth.mode `none` only, D202) as the policy each command is registered
//! with.
//!
//! AFD's approval middleware holds a call when the command's own policy or the one its list gives
//! holds it, and the registry refuses to dispatch a command whose own policy gates unless an
//! approval step admitted the call. So "off" cannot live only in the middleware's list: the
//! definition the registry holds carries it. Every registration path (built-ins, the embedder's
//! commands, plugin commands and pipelines, AFD's bootstrap commands) passes through
//! [`as_registered`].

use crate::workspace::{Config, McpApprovals};
use afd::{ApprovalDecision, ApprovalPolicy, CommandDefinition, CommandInterface};

/// `definition` as the registry holds it. Under `mcp.approvals = "off"`, a policy that may hold a
/// call becomes one that never holds an MCP call and decides every other call (CLI, library,
/// DirectClient) as before. A host-verified (`confirmation_mode`) command, a `require-human` one
/// and every command in another mode keep their policy untouched.
pub(crate) fn as_registered(
    config: &Config,
    mut definition: CommandDefinition,
    require_human: bool,
) -> CommandDefinition {
    if config.mcp.approvals != McpApprovals::Off
        || require_human
        || definition.confirmation_mode.is_some()
    {
        return definition;
    }
    definition.approval = match definition.approval.take() {
        Some(policy @ ApprovalPolicy::Required | policy @ ApprovalPolicy::Conditional(_)) => {
            Some(ApprovalPolicy::when_async(move |input, context| {
                let (input, context, policy) = (input.clone(), context.clone(), policy.clone());
                Box::pin(async move {
                    if context.interface == Some(CommandInterface::Mcp) {
                        ApprovalDecision::NotRequired
                    } else {
                        policy.decide(&input, &context).await
                    }
                })
            }))
        }
        other => other,
    };
    definition
}
