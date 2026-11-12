//! The engine's commands (the specification's section 11), a step at a time.

use std::sync::Arc;

use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult, ExposeOptions,
    failure, success,
};
use async_trait::async_trait;
use serde_json::json;

use crate::engine::Engine;
use crate::store::StoreError;

/// A store's refusal as a command's failure, in the engine's own words.
#[must_use]
pub fn store_failure(error: &StoreError) -> CommandError {
    match error {
        StoreError::InUse => CommandError::new("STORE_IN_USE", error.to_string())
            .with_suggestion("Stop the other loam-mail process, or send the command to it."),
        StoreError::Newer { .. } => CommandError::new("STORE_NEWER", error.to_string())
            .with_suggestion("Use the newer loam-mail that wrote this store."),
        StoreError::IndexStale => CommandError::new("INDEX_STALE", error.to_string())
            .with_suggestion("Run `loam-mail mail-rebuild`."),
        other => CommandError::new("STORE_FAILED", other.to_string())
            .with_suggestion("Check the data directory and its disk, then try again."),
    }
}

/// Exposed to the command line alone: not to MCP, the in-app agent or the
/// palette (the specification's section 11).
fn command_line_only() -> ExposeOptions {
    ExposeOptions::new()
        .with_cli(true)
        .with_agent(false)
        .with_palette(false)
}

struct Rebuild {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Rebuild {
    async fn execute(
        &self,
        _input: serde_json::Value,
        context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        let now = context.clock().now();
        let engine = &self.engine;
        let rebuilt = engine.with_store(|store| {
            let resumed = store.rebuilding()?;
            let mut reported = 0;
            let done = store.rebuild(now, |progress| {
                // A line for each ten thousand messages, and one at the end.
                if progress.finished || progress.done >= reported + 10_000 {
                    reported = progress.done;
                    engine.report(&format!(
                        "rebuilt {} of {} messages",
                        progress.done, progress.total
                    ));
                }
            })?;
            Ok((resumed, done.total, store.thread_count()?))
        });
        match rebuilt {
            Ok((resumed, messages, threads)) => success(json!({
                "messages": messages,
                "threads": threads,
                "resumed": resumed,
            })),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-rebuild`: recomputes every derived table and the search index from
/// the log (the specification's section 4.3).
#[must_use]
pub fn rebuild(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-rebuild",
        "Recompute threads, parts and the search index from the stored mail",
        vec![],
        Rebuild { engine },
    )
    .as_mutation()
    .with_expose(command_line_only())
}
