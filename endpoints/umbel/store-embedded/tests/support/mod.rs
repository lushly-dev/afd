//! Shared by the integration tests: opening the store and the writer child.
// Each test binary uses a different part of this module.
#![allow(dead_code)]

use std::path::Path;
use std::process::Command;
use std::sync::Arc;

use umbel_store::conformance::{
    SPACE, Stores, run_child, run_memory_child, wait_for_start, write_documents, write_memories,
};
use umbel_store::{
    ChangeKind, DocGraph, DocumentStore, Expect, GraphBatch, MemoryStore, Node, ReaderFilter,
    StoreError,
};
use umbel_store_embedded::{SqliteMemoryStore, SqliteStore, StoreOptions, TantivyIndex};

/// Set to `race` for a child that opens the store only after the start line, `busy` for one
/// that tries a single write with a short lock timeout and reports whether it was `Busy`,
/// `index` for one that writes documents and indexes them in turns with the others, or `hold`
/// for one that takes the index writer and keeps it until told to stop. The memory store's
/// children: `memory` opens the memory store alone and runs the suite's memory child,
/// `memory-race` opens it only after the start line, `memory-busy` tries one memory write with a
/// short lock timeout, and `memory-forever` writes memory records until it is killed.
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

/// Open the memory store of `space` under `dir`.
pub(crate) fn open_memory(
    dir: &Path,
    space: &str,
    options: StoreOptions,
) -> Result<Arc<SqliteMemoryStore>, StoreError> {
    SqliteMemoryStore::open(dir, space, options).map(Arc::new)
}

/// The memory factory of `run_memory`: the memory store alone.
pub(crate) fn memory_factory(dir: &Path, space: &str) -> Result<Arc<dyn MemoryStore>, StoreError> {
    Ok(open_memory(dir, space, StoreOptions::default())?)
}

/// Section 5.4's restore by hand, as the suite's `MemoryRestore`: with every handle dropped,
/// remove `memory.sqlite3-wal` and `memory.sqlite3-shm` (SQLite would replay a stale WAL into the
/// copy), then copy the backup to `memory.sqlite3` with mode `0600`, beside the current key file.
pub(crate) fn restore_memory(dir: &Path, _space: &str, backup: &Path) -> Result<(), StoreError> {
    let io = |e: std::io::Error| StoreError::Io(e.to_string());
    let db = dir.join("store").join("memory.sqlite3");
    for suffix in ["-wal", "-shm"] {
        let path = std::path::PathBuf::from(format!("{}{suffix}", db.display()));
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(io(e)),
        }
    }
    let bytes = std::fs::read(backup.join("memory.sqlite3")).map_err(io)?;
    let _ = std::fs::remove_file(&db);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&db).map_err(io)?;
    std::io::Write::write_all(&mut file, &bytes).map_err(io)?;
    file.sync_all().map_err(io)
}

/// Open the SQLite stores, the tantivy index and the memory store of `space` under `dir`, with
/// the memory restore of section 5.4.
pub(crate) fn open(dir: &Path, space: &str) -> Result<Stores, StoreError> {
    let store = open_with(dir, space, StoreOptions::default())?;
    let index = open_index(dir, space, StoreOptions::default())?;
    let memory = open_memory(dir, space, StoreOptions::default())?;
    Ok(Stores {
        documents: store.clone(),
        graph: store,
        index: Some(index),
        memory: Some(memory),
        memory_restore: Some(restore_memory),
        lane: Some(open_lane),
    })
}

/// The suite's `LaneOpen`: the document store of `space` under `dir` with the record lane's
/// bounds set to `limits`.
pub(crate) fn open_lane(
    dir: &Path,
    space: &str,
    limits: umbel_store::lane::LaneLimits,
) -> Result<Arc<dyn DocumentStore>, StoreError> {
    let store = SqliteStore::open(dir, space, StoreOptions::default())?.with_lane_limits(limits);
    Ok(Arc::new(store))
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

/// The command that re-runs this test binary as one memory writer child, which opens the memory
/// store alone.
pub(crate) fn spawn_memory_writer(dir: &Path) -> Command {
    let mut command = spawn_writer(dir);
    command.env(ENV_MODE, "memory");
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
        Ok("memory") => {
            let memory = open_memory(dir, SPACE, StoreOptions::default())
                .unwrap_or_else(|e| fail(format!("opening the memory store: {e}")));
            run_memory_child(&*memory).unwrap_or_else(|e| fail(e));
        }
        Ok("memory-race") => {
            wait_for_start().unwrap_or_else(|e| fail(e));
            let memory = open_memory(dir, SPACE, StoreOptions::default())
                .unwrap_or_else(|e| fail(format!("opening the memory store: {e}")));
            write_memories(&*memory).unwrap_or_else(|e| fail(e));
        }
        Ok("memory-forever") => {
            let memory = open_memory(dir, SPACE, StoreOptions::default())
                .unwrap_or_else(|e| fail(format!("opening the memory store: {e}")));
            let mut n = 0_u64;
            loop {
                let entry = umbel_store::conformance::samples::memory_entry(
                    5000 + n,
                    "human:ada",
                    &["principal:human:ada"],
                    &format!("forever {n}"),
                    &format!("written until killed, number {n}"),
                );
                let batch = umbel_store::conformance::samples::memory_batch(
                    umbel_store::conformance::samples::MEMORY_AT,
                    vec![entry],
                );
                let receipt = memory
                    .write(batch)
                    .unwrap_or_else(|e| fail(format!("write: {e}")));
                println!(
                    "{} {} {}",
                    umbel_store::conformance::WROTE_PREFIX,
                    receipt.to_rev.unwrap_or(0),
                    umbel_store::conformance::samples::memory_id(5000 + n)
                );
                n += 1;
            }
        }
        Ok("memory-busy") => {
            let memory = open_memory(
                dir,
                SPACE,
                StoreOptions {
                    lock_timeout_ms: 200,
                },
            )
            .unwrap_or_else(|e| fail(format!("opening the memory store: {e}")));
            let entry = umbel_store::conformance::samples::memory_entry(
                9000,
                "human:ada",
                &["principal:human:ada"],
                "busy",
                "a write that waits",
            );
            let batch = umbel_store::conformance::samples::memory_batch(
                umbel_store::conformance::samples::MEMORY_AT,
                vec![entry],
            );
            match memory.write(batch) {
                Err(StoreError::Busy) => println!("UMBEL-BUSY"),
                other => println!("UMBEL-UNEXPECTED {other:?}"),
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
