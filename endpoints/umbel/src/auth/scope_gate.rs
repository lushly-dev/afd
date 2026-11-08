//! The scope gate (phase 5 specification, section 5.2): the host's middleware that decides, inside
//! the registry, every call a token narrows, by the same rules as the resolver
//! ([`super::scopes::ScopePolicy`]), on the validated input.
//!
//! It runs after the space check and the access check (section 6.3, layer 7), so every space of
//! the call is one the caller reads and its token grants a verb in: a missing scope it names is
//! one the caller could already learn. It is defence in depth behind the 403 before dispatch and
//! AFD's own check at execution, and the only check for a call that reaches the registry another
//! way (a nested call, an in-process caller with credentials). A call no token narrows (the CLI,
//! stdio, the library, a loopback caller) passes.

use std::collections::HashMap;
use std::sync::Arc;

use afd::{
    BoxFuture, CommandContext, CommandError, CommandMiddleware, CommandResult, MiddlewareNext,
    error_codes, failure,
};
use serde_json::{Value, json};

use super::scopes::{ScopePolicy, Verdict};
use crate::access::{Caller, Narrowing};

/// `INSUFFICIENT_SCOPE` naming `missing` (section 10.5: `details.scopes`), as AFD words it.
pub(crate) fn insufficient_scope(resource: Option<&str>, missing: &[String]) -> CommandError {
    let resource = resource.unwrap_or("this server");
    let suggestion = if missing.is_empty() {
        format!("Obtain a token for {resource} that grants the scopes this call needs, then retry.")
    } else {
        format!(
            "Obtain a token for {resource} that also grants {}, then retry.",
            missing.join(" ")
        )
    };
    CommandError::new(
        error_codes::INSUFFICIENT_SCOPE,
        "The access token lacks a scope this call needs",
    )
    .with_suggestion(suggestion)
    .with_details(HashMap::from([("scopes".to_owned(), json!(missing))]))
    .with_retryable(false)
}

/// The scope gate over `policy`.
pub(crate) fn scope_gate(policy: Arc<ScopePolicy>) -> CommandMiddleware {
    Arc::new(
        move |name: String,
              input: Value,
              context: CommandContext,
              next: MiddlewareNext|
              -> BoxFuture<'static, CommandResult<Value>> {
            let config = policy.workspace().config();
            let caller = Caller::of(config, &context);
            let Narrowing::Token(held) = caller.narrowing() else {
                return next();
            };
            let held_text = caller.scope_text();
            let reads = |space: &str| {
                config
                    .spaces
                    .iter()
                    .find(|candidate| candidate.id.as_str() == space)
                    .is_some_and(|declared| caller.reads(config, declared))
            };
            let verdict = policy.decide(&name, &input, held, held_text, Some(&reads), false);
            match verdict {
                Verdict::Allowed => next(),
                Verdict::Hidden => {
                    let error = policy.unknown_command(&name, &context, &|command| {
                        policy.visible(command, held, held_text, &reads)
                    });
                    Box::pin(async move { failure(error) })
                }
                Verdict::Missing(missing) => {
                    let error = insufficient_scope(config.http.public_url.as_deref(), &missing);
                    Box::pin(async move { failure(error) })
                }
                // The space and access checks refuse these first; should one get here, it is
                // refused with section 5.4's one answer, which names nothing.
                Verdict::Unreadable | Verdict::Undecided => {
                    Box::pin(async move { failure(crate::access::space_unavailable()) })
                }
            }
        },
    )
}

/// The hidden-instance check (phase 5 section 9.4; step 3's review), the first host middleware
/// after the event stamp: to a hosted caller a token narrows, a plugin command whose instance
/// serves no space the caller reads does not exist. Its call is answered exactly as AFD answers
/// an unknown name, before the space, access and scope checks could answer it otherwise, so the
/// instance hidden from the listings is not revealed by calling it.
///
/// Over MCP with filtered listings (`auth.filter_tools_by_scope`, the default), AFD answers such
/// a call itself, on every route and before validating its input, since Umbel's resolver says
/// the command is not `known` to the caller (AFD's M6, "Hidden commands"), so the call never
/// reaches this check. It still answers a call that reaches the registry with credentials
/// otherwise: over MCP with unfiltered listings (where `tools/list` names the instance's
/// commands anyway, and an invalid input gets `VALIDATION_ERROR` first), and an in-process
/// caller's.
pub(crate) fn hidden_check(policy: Arc<ScopePolicy>) -> CommandMiddleware {
    Arc::new(
        move |name: String,
              _input: Value,
              context: CommandContext,
              next: MiddlewareNext|
              -> BoxFuture<'static, CommandResult<Value>> {
            let config = policy.workspace().config();
            let caller = Caller::of(config, &context);
            let Narrowing::Token(held) = caller.narrowing() else {
                return next();
            };
            if !caller.gets_one_answer() {
                return next();
            }
            let reads = |space: &str| {
                config
                    .spaces
                    .iter()
                    .find(|candidate| candidate.id.as_str() == space)
                    .is_some_and(|declared| caller.reads(config, declared))
            };
            if !policy.hidden(&name, &reads) {
                return next();
            }
            let held_text = caller.scope_text();
            let error = policy.unknown_command(&name, &context, &|command| {
                policy.visible(command, held, held_text, &reads)
            });
            Box::pin(async move { failure(error) })
        },
    )
}
