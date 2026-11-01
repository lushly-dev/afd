//! The host's middleware: the event stamp and the space check.
//!
//! AFD middleware receives the validated input and the context and calls `next()`, which takes no
//! arguments: it can refuse before the handler or rewrite the result after it, but it cannot
//! change what the handler sees. So the host owns two result keys, `dev.umbel/space` and
//! `dev.umbel/mutation`, and these layers **always overwrite** them: a handler (or a plugin) can
//! neither forge a mutation, nor hide one, nor redirect an event to another space.
//!
//! Outermost first: the event stamp, then the space check, then (installed by `seal`) the
//! approval middleware. The event stamp is outermost so that it runs last on the way out and can
//! put the default space on a mutation of a command that has no `space` input.

use afd::{
    BoxFuture, CommandContext, CommandError, CommandMiddleware, CommandResult, MiddlewareNext,
    ResultMetadata, failure,
};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::Arc;

/// `result.metadata` key: the space a result belongs to. Written only by the host.
pub(crate) const SPACE_KEY: &str = "dev.umbel/space";
/// `result.metadata` key: `true` on the successful result of a mutation that is projected into an
/// event. Written only by the host.
pub(crate) const MUTATION_KEY: &str = "dev.umbel/mutation";

/// Commands whose successful result is never projected into an event: the cursor the caller
/// stores and the rebuild of the streams themselves.
pub(crate) const UNPROJECTED_MUTATIONS: &[&str] = &["event-ack", "event-rebuild"];

/// Resolves a call's space (`Workspace::resolve_space`).
pub(crate) type ResolveSpace =
    Arc<dyn Fn(&Value, &CommandContext) -> Result<String, CommandError> + Send + Sync>;

fn metadata_mut(result: &mut CommandResult<Value>) -> &mut ResultMetadata {
    result.metadata.get_or_insert_with(ResultMetadata::new)
}

fn set(result: &mut CommandResult<Value>, key: &str, value: Value) {
    metadata_mut(result).extra.insert(key.to_owned(), value);
}

fn remove(result: &mut CommandResult<Value>, key: &str) {
    if let Some(metadata) = result.metadata.as_mut() {
        metadata.extra.remove(key);
    }
}

/// The event stamp: `dev.umbel/mutation = true` on a successful result of a command declared
/// `mutation: true` (other than [`UNPROJECTED_MUTATIONS`]), removed from every other result. A
/// stamped result of a command with no `space` input also gets the default space.
pub(crate) fn event_stamp(
    mutations: HashSet<String>,
    with_space: Arc<HashSet<String>>,
    default_space: String,
) -> CommandMiddleware {
    let mutations = Arc::new(mutations);
    Arc::new(
        move |name: String,
              _input: Value,
              _context: CommandContext,
              next: MiddlewareNext|
              -> BoxFuture<'static, CommandResult<Value>> {
            let stamped = mutations.contains(&name);
            let has_space = with_space.contains(&name);
            let default_space = default_space.clone();
            Box::pin(async move {
                let mut result = next().await;
                if stamped && result.success {
                    set(&mut result, MUTATION_KEY, Value::Bool(true));
                    if !has_space {
                        set(&mut result, SPACE_KEY, Value::String(default_space));
                    }
                } else {
                    remove(&mut result, MUTATION_KEY);
                }
                result
            })
        },
    )
}

/// The space check (D26): for a command whose input has a `space` property, resolves the space
/// and refuses an undeclared one with `SPACE_NOT_FOUND` before the handler runs; after the
/// handler, overwrites `dev.umbel/space` with the resolved space. For any other command, removes
/// the key.
pub(crate) fn space_check(
    with_space: Arc<HashSet<String>>,
    resolve: ResolveSpace,
) -> CommandMiddleware {
    Arc::new(
        move |name: String,
              input: Value,
              context: CommandContext,
              next: MiddlewareNext|
              -> BoxFuture<'static, CommandResult<Value>> {
            let has_space = with_space.contains(&name);
            let resolved = if has_space {
                Some(resolve(&input, &context))
            } else {
                None
            };
            Box::pin(async move {
                match resolved {
                    Some(Err(error)) => {
                        let mut result = failure(error);
                        remove(&mut result, SPACE_KEY);
                        result
                    }
                    Some(Ok(space)) => {
                        let mut result = next().await;
                        set(&mut result, SPACE_KEY, Value::String(space));
                        result
                    }
                    None => {
                        let mut result = next().await;
                        remove(&mut result, SPACE_KEY);
                        result
                    }
                }
            })
        },
    )
}
