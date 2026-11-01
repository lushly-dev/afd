//! Shared by the integration tests: opening the store and the writer child.

use std::path::Path;
use std::process::Command;
use std::sync::Arc;

use umbel_store::StoreError;
use umbel_store::conformance::{ENV_WRITER, SPACE, Stores, run_child};
use umbel_store_embedded::{SqliteStore, StoreOptions};

/// Open the SQLite stores of `space` under `dir`.
pub(crate) fn open(dir: &Path, space: &str) -> Result<Stores, StoreError> {
    let store = Arc::new(SqliteStore::open(dir, space, StoreOptions::default())?);
    Ok(Stores { documents: store.clone(), graph: store, index: None })
}

/// The command that re-runs this test binary as one writer child (specification section 3.1).
pub(crate) fn spawn_writer(dir: &Path) -> Command {
    let exe = std::env::current_exe().unwrap_or_else(|_| "umbel-store-embedded-tests".into());
    let mut command = Command::new(exe);
    command.args(["--exact", "writer_child", "--nocapture"]).env(ENV_WRITER, dir);
    command
}

/// The body of the `writer_child` test: a no-op unless `UMBEL_STORE_WRITER` is set.
pub(crate) fn writer_child() {
    let Ok(dir) = std::env::var(ENV_WRITER) else {
        return;
    };
    let stores = open(Path::new(&dir), SPACE).unwrap_or_else(|e| panic!("opening the store: {e}"));
    if let Err(why) = run_child(&stores) {
        panic!("{why}");
    }
}
