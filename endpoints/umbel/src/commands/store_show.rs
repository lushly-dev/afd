//! `store-show`: what a space's stores hold and how far its derived data has caught up.

use super::store_common::{is_cli_human, space_property, view};
use super::{Builtin, blocking, expose_everywhere_but_the_palette, returns_object};
use crate::store::{Hub, command_error};
use crate::versions::STORE_VERSION;
use crate::workspace::Workspace;
use afd::{CommandContext, CommandDefinition, CommandHandler, CommandResult, failure, success};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::Arc;
use umbel_store::ReaderFilter;

struct Handler {
    workspace: Arc<Workspace>,
    stores: Hub,
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let (space, filter) = match view(&self.workspace, &input, &context) {
            Ok(view) => view,
            Err(error) => return failure(error),
        };
        let totals = is_cli_human(&context);
        let stores = Arc::clone(&self.stores);
        let space = space.to_string();
        let shown = blocking(move || {
            let stores = stores.space(&space).map_err(|e| command_error(&e))?;
            let fail = |e: umbel_store::StoreError| command_error(&e);
            let counts = |reader: &ReaderFilter| -> Result<Value, afd::CommandError> {
                let rows = stores.sqlite.counts(reader).map_err(fail)?;
                let chunks = stores.tantivy.count_readable(reader).map_err(fail)?;
                Ok(json!({
                    "documents": rows.documents,
                    "records": rows.records,
                    "changes": rows.changes,
                    "chunks": chunks,
                    "nodes": rows.nodes,
                    "edges": rows.edges,
                }))
            };
            let head = stores.documents.head().map_err(fail)?;
            let info = stores.sqlite.info().map_err(fail)?;
            let index = stores.tantivy.info().map_err(fail)?;
            let mut data = json!({
                "space": space,
                "backend": "embedded",
                "storeVersion": STORE_VERSION,
                "schemaVersion": info.schema_version,
                "head": head,
                "counts": counts(&filter)?,
                "index": {
                    "applied": stores.index.applied().map_err(fail)?,
                    "schema": index.schema_version,
                    "segments": index.segments,
                },
                "graph": { "applied": stores.graph.applied().map_err(fail)? },
                "files": {
                    "databaseBytes": info.database_bytes,
                    "walBytes": info.wal_bytes,
                    "indexBytes": index.bytes,
                },
            });
            if totals {
                data["totals"] = counts(&ReaderFilter::derivation())?;
            }
            Ok(data)
        })
        .await;
        match shown {
            Ok(data) => success(data),
            Err(error) => failure(error),
        }
    }
}

/// `store-show`.
pub(crate) fn store_show(workspace: Arc<Workspace>, stores: Hub) -> Builtin {
    let definition = CommandDefinition::new(
        "store-show",
        "What a space's stores hold: the head revision, the counts the caller can read, and how far the index and the graph have caught up",
        vec![],
        Handler { workspace, stores },
    )
    .with_category("store")
    .with_returns(returns_object(
        "space, backend, storeVersion, schemaVersion, head, counts, index, graph, files, and totals for a person at the CLI",
    ))
    .with_expose(expose_everywhere_but_the_palette());
    Builtin {
        definition,
        schema: json!({
            "type": "object",
            "properties": { "space": space_property() },
            "additionalProperties": false,
        }),
    }
}
