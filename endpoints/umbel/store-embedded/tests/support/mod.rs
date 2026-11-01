//! Shared by the integration tests: opening the store and the writer child.
// Each test binary uses a different part of this module.
#![allow(dead_code)]

use std::path::Path;
use std::process::Command;
use std::sync::Arc;

use umbel_store::conformance::{SPACE, Stores, run_child, wait_for_start, write_documents};
use umbel_store::{
    ChangeKind, DocGraph, DocumentStore, Expect, GraphBatch, Node, ReaderFilter, StoreError,
};
use umbel_store_embedded::{SqliteStore, StoreOptions, TantivyIndex};

/// Set to `race` for a child that opens the store only after the start line, `busy` for one
/// that tries a single write with a short lock timeout and reports whether it was `Busy`,
/// `index` for one that writes documents and indexes them in turns with the others, or `hold`
/// for one that takes the index writer and keeps it until told to stop.
pub(crate) const ENV_MODE: &str = "UMBEL_STORE_WRITER_MODE";

pub(crate) fn open_with(
    dir: &Path,
    space: &str,
    options: StoreOptions,
) -> Result<Arc<SqliteStore>, StoreError> {
    SqliteStore::open(dir, space, options).map(Arc::new)
}

/// Open the index of `space` under `dir`.
pub(crate) fn open_index(
    dir: &Path,
    space: &str,
    options: StoreOptions,
) -> Result<Arc<TantivyIndex>, StoreError> {
    TantivyIndex::open(dir, space, options).map(Arc::new)
}

/// Open the SQLite stores and the tantivy index of `space` under `dir`.
pub(crate) fn open(dir: &Path, space: &str) -> Result<Stores, StoreError> {
    let store = open_with(dir, space, StoreOptions::default())?;
    let index = open_index(dir, space, StoreOptions::default())?;
    Ok(Stores {
        documents: store.clone(),
        graph: store,
        index: Some(index),
    })
}

/// The command that re-runs this test binary as one writer child (specification section 3.1).
pub(crate) fn spawn_writer(dir: &Path) -> Command {
    let exe = std::env::current_exe().unwrap_or_else(|_| "umbel-store-embedded-tests".into());
    let mut command = Command::new(exe);
    command
        .args(["--exact", "writer_child", "--nocapture"])
        .env(umbel_store::conformance::ENV_WRITER, dir);
    command
}

/// The body of the `writer_child` test: a no-op unless `UMBEL_STORE_WRITER` is set.
pub(crate) fn writer_child() {
    let Ok(dir) = std::env::var(umbel_store::conformance::ENV_WRITER) else {
        return;
    };
    let dir = Path::new(&dir);
    let fail = |why: String| -> ! { panic!("{why}") };
    match std::env::var(ENV_MODE).as_deref() {
        Ok("race") => {
            wait_for_start().unwrap_or_else(|e| fail(e));
            let stores =
                open(dir, SPACE).unwrap_or_else(|e| fail(format!("opening the store: {e}")));
            write_documents(&stores).unwrap_or_else(|e| fail(e));
        }
        Ok("index") => {
            wait_for_start().unwrap_or_else(|e| fail(e));
            let stores =
                open(dir, SPACE).unwrap_or_else(|e| fail(format!("opening the store: {e}")));
            index_child(&stores).unwrap_or_else(|e| fail(e));
        }
        Ok("hold") => {
            let stores =
                open(dir, SPACE).unwrap_or_else(|e| fail(format!("opening the store: {e}")));
            let index = stores
                .index
                .unwrap_or_else(|| fail("the stores have no index".to_owned()));
            let mut writer = index
                .writer()
                .unwrap_or_else(|e| fail(format!("taking the writer: {e}")));
            println!("UMBEL-HELD {}", writer.applied().unwrap_or(u64::MAX));
            // Hold it until the parent writes a line, or is gone.
            let mut line = String::new();
            let _ = std::io::stdin().read_line(&mut line);
            if line.trim() == "commit" {
                writer
                    .commit(7)
                    .unwrap_or_else(|e| fail(format!("commit: {e}")));
            }
        }
        Ok("busy") => {
            let store = open_with(
                dir,
                SPACE,
                StoreOptions {
                    lock_timeout_ms: 200,
                },
            )
            .unwrap_or_else(|e| fail(format!("opening the store: {e}")));
            let doc =
                umbel_store::conformance::samples::document("busy/doc", &["space"], "x", "busy");
            match store.put_document(doc, Expect::Any) {
                Err(StoreError::Busy) => println!("UMBEL-BUSY"),
                other => println!("UMBEL-UNEXPECTED {other:?}"),
            }
        }
        _ => {
            let stores =
                open(dir, SPACE).unwrap_or_else(|e| fail(format!("opening the store: {e}")));
            run_child(&stores).unwrap_or_else(|e| fail(e));
        }
    }
}

/// What one indexing pass saw: the index's and the graph's revisions before and after.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Pass {
    pub(crate) index_before: u64,
    pub(crate) index_after: u64,
    pub(crate) graph_before: u64,
    pub(crate) graph_after: u64,
}

/// The indexing procedure of specification section 8.7, in miniature: take the index writer
/// first, only then read both applied revisions and start from the smaller, read the changes
/// after it, stage the chunks and one graph batch, commit the graph and then the index, neither
/// ever lowering its revision. Documents are indexed as one chunk each, with their id as text.
pub(crate) fn index_pass(stores: &Stores) -> Result<Pass, String> {
    let index = stores.index.as_ref().ok_or("no index")?;
    let mut writer = index.writer().map_err(|e| format!("the writer: {e}"))?;
    let index_applied = writer.applied().map_err(|e| e.to_string())?;
    let graph_applied = stores.graph.applied().map_err(|e| e.to_string())?;
    let from = index_applied.min(graph_applied);
    let changes = stores
        .documents
        .changes(from, 1000, &ReaderFilter::derivation(), None)
        .map_err(|e| format!("changes: {e}"))?;
    let to = changes.last().map_or(from, |c| c.rev);
    let mut graph = GraphBatch::default();
    for change in changes {
        if change.kind != ChangeKind::Put {
            continue;
        }
        // A store already at or past a change's revision skips it.
        if change.rev > index_applied {
            let chunk = umbel_store::conformance::samples::chunk(
                &change.target,
                0,
                &change.target,
                &format!("indexed note {}", change.target),
                &["space"],
            );
            writer
                .replace(&change.target, vec![chunk])
                .map_err(|e| format!("replace: {e}"))?;
        }
        if change.rev > graph_applied {
            graph.entries.push((
                change.target.clone(),
                Some(DocGraph {
                    nodes: vec![Node {
                        id: format!("doc:{}", change.target),
                        kind: "document".to_owned(),
                        label: change.target.clone(),
                    }],
                    edges: vec![],
                }),
            ));
        }
    }
    let graph_to = graph_applied.max(to);
    let index_to = index_applied.max(to);
    stores
        .graph
        .apply(graph, graph_to)
        .map_err(|e| format!("the graph: {e}"))?;
    writer
        .commit(index_to)
        .map_err(|e| format!("the index: {e}"))?;
    Ok(Pass {
        index_before: index_applied,
        index_after: index_to,
        graph_before: graph_applied,
        graph_after: graph_to,
    })
}

/// The `index` child: write a document, then run an indexing pass, `ENV_COUNT` times, printing
/// what each pass saw.
fn index_child(stores: &Stores) -> Result<(), String> {
    let id = std::env::var(umbel_store::conformance::ENV_ID).map_err(|e| e.to_string())?;
    let count: usize = std::env::var(umbel_store::conformance::ENV_COUNT)
        .map_err(|e| e.to_string())?
        .parse()
        .map_err(|e: std::num::ParseIntError| e.to_string())?;
    for n in 0..count {
        let doc_id = format!("{id}/doc-{n:03}");
        let document = umbel_store::conformance::samples::document(
            &doc_id,
            &["space"],
            &doc_id,
            &format!("trace-{id}"),
        );
        stores
            .documents
            .put_document(document, Expect::Absent)
            .map_err(|e| format!("put_document: {e}"))?;
        let pass = index_pass(stores)?;
        println!(
            "UMBEL-INDEXED {} {} {} {}",
            pass.index_before, pass.index_after, pass.graph_before, pass.graph_after
        );
    }
    Ok(())
}
