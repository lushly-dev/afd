//! `store-check`: the integrity of a space's stores and the cross-check against the journal.

use super::store_common::{space_property, view};
use super::{Builtin, blocking, returns_object};
use crate::doctor::{Check, CheckStatus};
use crate::store::{Hub, codes};
use crate::workspace::Workspace;
use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult, ExposeOptions,
    ResultOptions, Warning, failure, success_with,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::collections::HashSet;
use std::sync::Arc;
use umbel_store::{DocumentStore, ReaderFilter};

/// A change newer than this has not necessarily had its journal entry appended yet: the entry is
/// written after the handler returns (specification section 3.5).
const RECENT_SECONDS: i64 = 60;
/// The most trace ids a finding names.
const NAMED: usize = 10;

struct Handler {
    workspace: Arc<Workspace>,
    stores: Hub,
}

/// Changes older than [`RECENT_SECONDS`] whose trace id the journal does not hold.
fn missing_from_journal(
    workspace: &Workspace,
    documents: &dyn DocumentStore,
    now_ms: i64,
) -> Result<Vec<String>, String> {
    let text = match std::fs::read_to_string(workspace.layout().journal_file()) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("the journal cannot be read: {error}")),
    };
    let journaled: HashSet<String> = afd::parse_journal(&text)
        .map_err(|error| format!("the journal cannot be read: {error}"))?
        .into_iter()
        .filter_map(|entry| entry.trace_id)
        .collect();
    let mut missing = Vec::new();
    let mut after = 0;
    loop {
        let page = documents
            .changes(after, 1000, &ReaderFilter::derivation(), None)
            .map_err(|error| error.to_string())?;
        let Some(last) = page.last() else { break };
        after = last.rev;
        for change in &page {
            let Some(trace) = &change.trace_id else {
                continue;
            };
            let old_enough = chrono::DateTime::parse_from_rfc3339(&change.at)
                .map(|at| now_ms - at.timestamp_millis() > RECENT_SECONDS * 1000)
                .unwrap_or(false);
            if old_enough && !journaled.contains(trace) && !missing.contains(trace) {
                missing.push(trace.clone());
            }
        }
        if page.len() < 1000 {
            break;
        }
    }
    Ok(missing)
}

fn run(
    workspace: &Workspace,
    stores: &Hub,
    space: &str,
    now_ms: i64,
) -> Result<Vec<Check>, CommandError> {
    let mut checks = Vec::new();
    let opened = match stores.space(space) {
        Ok(opened) => opened,
        Err(error) => {
            checks.push(Check::fail(
                "store.open",
                format!("the stores of `{space}` cannot be opened: {error}"),
                "Restore state/spaces from a backup, or move it aside and run sources-sync and knowledge-index rebuild=true to derive it again.",
            ));
            return Ok(checks);
        }
    };
    match opened.sqlite.integrity_check() {
        Ok(findings) if findings.is_empty() => {
            checks.push(Check::pass(
                "store.sqlite",
                "SQLite's integrity check passed",
            ));
        }
        Ok(findings) => checks.push(Check::fail(
            "store.sqlite",
            format!("SQLite reports: {}", findings.join("; ")),
            "Restore the store from a store-backup.",
        )),
        Err(error) => checks.push(Check::fail(
            "store.sqlite",
            format!("SQLite's integrity check could not run: {error}"),
            "Restore the store from a store-backup.",
        )),
    }
    match opened.tantivy.check() {
        Ok(check) if check.damaged.is_empty() => {
            checks.push(Check::pass(
                "store.index",
                "every index segment's checksum is valid",
            ));
        }
        Ok(check) => checks.push(Check::fail(
            "store.index",
            format!(
                "the index files {} fail their checksum",
                check.damaged.join(", ")
            ),
            "The index is derived data: run knowledge-index rebuild=true.",
        )),
        Err(error) => checks.push(Check::fail(
            "store.index",
            format!("the index cannot be checked: {error}"),
            "The index is derived data: run knowledge-index rebuild=true.",
        )),
    }
    match opened.sqlite.access_problems() {
        Ok(problems) if problems.is_empty() => checks.push(Check::pass(
            "store.access",
            "every document, record and change has an access token",
        )),
        Ok(problems) => checks.push(Check::fail(
            "store.access",
            format!("rows without an access token: {}", problems.join(", ")),
            "Restore the store from a store-backup.",
        )),
        Err(error) => checks.push(Check::fail(
            "store.access",
            format!("the access tables cannot be read: {error}"),
            "Restore the store from a store-backup.",
        )),
    }
    match (
        opened.documents.head(),
        opened.index.applied(),
        opened.graph.applied(),
    ) {
        (Ok(head), Ok(index), Ok(graph)) if index > head || graph > head => {
            checks.push(Check::fail(
                "store.revisions",
                format!("the index ({index}) or the graph ({graph}) is ahead of the head ({head})"),
                "Run knowledge-index rebuild=true; if it persists, restore from a store-backup.",
            ));
        }
        (Ok(head), Ok(index), Ok(graph)) if index < head || graph < head => {
            checks.push(Check::warn(
                "store.revisions",
                format!("the index ({index}) or the graph ({graph}) is behind the head ({head})"),
                "Run knowledge-index (or knowledge-refresh) to catch up.",
            ));
        }
        (Ok(head), Ok(_), Ok(_)) => checks.push(Check::pass(
            "store.revisions",
            format!("the index and the graph reflect the head ({head})"),
        )),
        _ => checks.push(Check::fail(
            "store.revisions",
            "the head or an applied revision cannot be read",
            "Run knowledge-index rebuild=true.",
        )),
    }
    match missing_from_journal(workspace, opened.documents.as_ref(), now_ms) {
        Ok(missing) if missing.is_empty() => checks.push(Check::pass(
            "store.journal",
            "every store change older than a minute has a journal entry",
        )),
        Ok(missing) => checks.push(Check::warn(
            "store.journal",
            format!(
                "{} store change(s) older than a minute have no journal entry (trace ids: {})",
                missing.len(),
                missing.iter().take(NAMED).cloned().collect::<Vec<_>>().join(", ")
            ),
            "A crash between a store write and its journal entry leaves this; the journal is fail-open, so nothing is lost but the audit line.",
        )),
        Err(message) => checks.push(Check::warn(
            "store.journal",
            message,
            "Run workspace-doctor.",
        )),
    }
    // The last step: reclaim the write-ahead log. Best effort, as after an index run.
    if let Err(error) = opened.documents.checkpoint() {
        checks.push(Check::warn(
            "store.checkpoint",
            format!("the checkpoint failed: {error}"),
            "Retry store-check later.",
        ));
    }
    Ok(checks)
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let (space, _filter) = match view(&self.workspace, &input, &context) {
            Ok(view) => view,
            Err(error) => return failure(error),
        };
        let workspace = Arc::clone(&self.workspace);
        let stores = Arc::clone(&self.stores);
        let now = context.clock().now();
        let space = space.to_string();
        let checked =
            blocking(move || run(&workspace, &stores, &space, now).map(|checks| (space, checks)))
                .await;
        let (space, checks) = match checked {
            Ok(done) => done,
            Err(error) => return failure(error),
        };
        let healthy = checks.iter().all(|check| check.status != CheckStatus::Fail);
        let data = json!({ "space": space, "healthy": healthy, "checks": checks });
        if let Some(failed) = checks
            .iter()
            .find(|check| check.status == CheckStatus::Fail)
        {
            let details = match &data {
                Value::Object(map) => map.clone().into_iter().collect(),
                _ => std::collections::HashMap::new(),
            };
            return failure(
                CommandError::new(
                    codes::STORE_CORRUPT,
                    format!(
                        "The stores of `{space}` are unhealthy: {} ({})",
                        failed.message, failed.id
                    ),
                )
                .with_suggestion(failed.suggestion.clone().unwrap_or_default())
                .with_details(details)
                .with_retryable(false),
            );
        }
        let warnings: Vec<Warning> = checks
            .iter()
            .filter(|check| check.status == CheckStatus::Warn)
            .map(|check| {
                let id = check.id.strip_prefix("store.").unwrap_or(&check.id);
                Warning::new(format!("STORE_CHECK_{}", id.to_uppercase()), &check.message)
            })
            .collect();
        let mut options = ResultOptions::default();
        if !warnings.is_empty() {
            options.warnings = Some(warnings);
        }
        success_with(data, options)
    }
}

/// `store-check`.
pub(crate) fn store_check(workspace: Arc<Workspace>, stores: Hub) -> Builtin {
    let definition = CommandDefinition::new(
        "store-check",
        "Check a space's stores: SQLite's integrity, the index's checksums, the access tables, the revisions, and the journal cross-check",
        vec![],
        Handler { workspace, stores },
    )
    .with_category("store")
    .with_returns(returns_object("space, healthy and the checks"))
    .with_expose(
        ExposeOptions::new()
            .with_palette(false)
            .with_mcp(false)
            .with_agent(false)
            .with_cli(true),
    );
    Builtin {
        definition,
        schema: json!({
            "type": "object",
            "properties": { "space": space_property() },
            "additionalProperties": false,
        }),
    }
}
