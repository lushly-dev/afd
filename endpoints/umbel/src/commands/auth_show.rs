//! `auth-show`: who the caller is, as this host sees it (phase 5 specification, section 10.3).
//!
//! **Its audience is the caller itself.** Every caller may call it, on every surface but the
//! palette, as every host built-in is exposed; in a hosted mode it needs a token's read scope,
//! as every call does until step 3, and section 5.2 asks only "any Umbel scope" of it. Its
//! answer is built from the principal the surface set on this call and the credentials AFD
//! admitted for this request, so it can only ever describe the caller who asked: it takes no
//! input, and nothing names another caller.
//!
//! **What it shows**, exactly section 10.3's list: the principal (the actor: its kind, id and the
//! person it acts for), the namespace and issuer alias, the authentication, the granted scopes,
//! the spaces with the verbs those scopes grant there (only the spaces the caller may read), the
//! delegation chain, and the token's expiry.
//!
//! **What it never shows**: the token or any part of it; any other claim of the credentials
//! (the subject or client id as the issuer wrote them, `auth_time`, `acr`, the bound
//! certificate's thumbprint); the claim groups; the policy version and decision; the
//! configuration (other issuers, namespaces, spaces or callers); and any secret.

use super::{Builtin, empty_input, expose_everywhere_but_the_palette, returns_object};
use crate::principal::Principal;
use afd::{CommandContext, CommandDefinition, CommandHandler, CommandResult, failure, success};
use async_trait::async_trait;
use serde_json::{Value, json};

struct Handler;

/// `UNAUTHORIZED` for a call no surface prepared (a bare `registry.execute`): there is no caller
/// to describe.
fn unidentified() -> afd::CommandError {
    afd::CommandError::new(
        afd::error_codes::UNAUTHORIZED,
        "The caller could not be identified",
    )
    .with_suggestion(
        "Call auth-show through the CLI, MCP or Host::context, which set the caller's principal.",
    )
    .with_retryable(false)
}

/// The token's expiry, ISO 8601 UTC with milliseconds.
fn expiry(context: &CommandContext) -> Value {
    context
        .credentials
        .as_deref()
        .and_then(|credentials| chrono::DateTime::from_timestamp(credentials.expires_at, 0))
        .map_or(Value::Null, |time| {
            json!(time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        })
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        let Some(principal) = Principal::from_context(&context) else {
            return failure(unidentified());
        };
        success(json!({
            "principal": principal.actor,
            "namespace": principal.namespace,
            "issuer": principal.issuer,
            "authentication": principal.authentication,
            "scopes": principal.scopes,
            "spaces": principal.spaces,
            "delegationChain": principal.delegation_chain,
            "tokenExpiresAt": expiry(&context),
        }))
    }
}

/// `auth-show`.
pub(crate) fn auth_show() -> Builtin {
    let definition = CommandDefinition::new(
        "auth-show",
        "Who you are to this host: your principal, namespace, issuer, authentication, scopes, spaces with the verbs they grant, delegation chain and token expiry",
        vec![],
        Handler,
    )
    .with_category("workspace")
    .with_returns(returns_object(
        "principal (kind, id, onBehalfOf), namespace, issuer, authentication, scopes, spaces (space: verbs), delegationChain and tokenExpiresAt; null where no token narrows the caller",
    ))
    .with_expose(expose_everywhere_but_the_palette());
    Builtin {
        definition,
        schema: empty_input(),
    }
}
