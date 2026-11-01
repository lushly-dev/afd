//! Shared by the integration tests: opening the store and the writer child.
// Each test binary uses a different part of this module.
#![allow(dead_code)]

use std::path::Path;
use std::process::Command;
use std::sync::Arc;

use umbel_store::conformance::{SPACE, Stores, run_child, wait_for_start, write_documents};
use umbel_store::{DocumentStore, Expect, StoreError};
use umbel_store_embedded::{SqliteStore, StoreOptions, TantivyIndex};

/// Set to `race` for a child that opens the store only after the start line, or `busy` for one
/// that tries a single write with a short lock timeout and reports whether it was `Busy`.
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
