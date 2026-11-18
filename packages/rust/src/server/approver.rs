//! Approval evidence from an approver client (`spec/command-metadata.md`, "Approval evidence from
//! an approver client"; Loam phase 5, step 0c).
//!
//! A server names its approvers with [`McpServer::with_approver`](super::McpServer::with_approver):
//! MCP clients it trusts to show a person a held action and to carry the person's decision back.
//! For an approver, a held result carries `details.approvalToken` and never becomes a form
//! elicitation, and a `tools/call` carrying `_meta["dev.afd/approval"]` has it set as the call's
//! approval evidence; the token binds the approver's principal binding (M8). From any other
//! caller the key is ignored. In tool arguments the key is refused from every caller.

use std::sync::Arc;

use serde_json::{Map, Value};

use crate::approval::approver::ApproverCall;
use crate::commands::CommandContext;
use crate::errors::{error_codes, CommandError};

/// `_meta` key an approver sets to the approval token of the call it retries.
pub const AFD_APPROVAL_META_KEY: &str = "dev.afd/approval";

/// Whether the caller of one call is an approver, from its context once the server has set the
/// verified credentials and the hook its actor. Only `true` makes one.
pub type ApproverPredicate = Arc<dyn Fn(&CommandContext) -> bool + Send + Sync>;

/// The `VALIDATION_ERROR` for tool arguments that hold the key `dev.afd/approval` at any depth:
/// evidence is never input (rule 5), from any caller. The walk is iterative, so deep input cannot
/// overflow the stack.
pub(crate) fn key_in_arguments(arguments: Option<&Map<String, Value>>) -> Option<CommandError> {
    let arguments = arguments?;
    let mut found = arguments.contains_key(AFD_APPROVAL_META_KEY);
    let mut pending: Vec<&Value> = arguments.values().collect();
    while !found {
        let Some(value) = pending.pop() else { break };
        match value {
            Value::Object(members) if members.contains_key(AFD_APPROVAL_META_KEY) => found = true,
            Value::Object(members) => pending.extend(members.values()),
            Value::Array(items) => pending.extend(items.iter()),
            _ => {}
        }
    }
    found.then(|| {
        CommandError::new(
            error_codes::VALIDATION_ERROR,
            format!("Input may not hold the key \"{AFD_APPROVAL_META_KEY}\""),
        )
        .with_suggestion(format!(
            "Remove \"{AFD_APPROVAL_META_KEY}\" from the input: approval evidence is never input. Only a client the server names an approver sends it, in _meta, on the retry a person approved."
        ))
        .with_retryable(false)
    })
}

/// What the carrier decided for one `tools/call`.
pub(crate) enum ApproverDecision {
    /// Not an approver: the key, if any, is ignored.
    Other,
    /// An approver's call.
    Approver(Arc<ApproverCall>),
    /// An approver's key where it cannot be carried: nothing runs.
    Refuse(CommandError),
    /// An approver whose credentials cannot be bound (M8): an internal error.
    Unbindable,
}

/// Decide the carrier of one `tools/call` (rules 1 to 3) from the call's context after the hook,
/// the request's own `_meta`, the tool and whether the request is MCP 2026-07-28.
pub(crate) fn decide(
    approver: Option<&ApproverPredicate>,
    context: &CommandContext,
    meta: &Map<String, Value>,
    tool: &str,
    modern: bool,
) -> ApproverDecision {
    if !approver.is_some_and(|predicate| predicate(context)) {
        return ApproverDecision::Other;
    }
    if crate::principal_binding(context.actor.as_ref(), context.credentials.as_deref()).is_err() {
        return ApproverDecision::Unbindable;
    }
    let evidence = match meta.get(AFD_APPROVAL_META_KEY) {
        None | Some(Value::Null) => None,
        // Anything but a string is no token: the middleware refuses it as `malformed`.
        Some(Value::String(token)) => Some(token.clone()),
        Some(_) => Some(String::new()),
    };
    if evidence.is_some() && (!modern || tool == "afd-batch" || tool == "afd-pipe") {
        return ApproverDecision::Refuse(
            CommandError::new(
                error_codes::APPROVAL_REQUIRED,
                format!(
                    "_meta[\"{AFD_APPROVAL_META_KEY}\"] is accepted only on a call to one command from an MCP 2026-07-28 client"
                ),
            )
            .with_suggestion(
                "Retry the approved command on its own (its tool or afd-call) from an MCP 2026-07-28 client, with the same input and the token; nothing ran.",
            )
            .with_retryable(false),
        );
    }
    ApproverDecision::Approver(Arc::new(ApproverCall::new(evidence)))
}
