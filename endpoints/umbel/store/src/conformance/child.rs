//! The writer child: what a backend's `writer_child` test runs in another process.

use std::io::{BufRead, Write};

use super::{Ctx, Stores, samples};
use crate::Expect;

/// The directory the child opens; the backend's `spawn_writer` sets it.
pub const ENV_WRITER: &str = "UMBEL_STORE_WRITER";
/// The child's name, a path segment; the suite sets it.
pub const ENV_ID: &str = "UMBEL_STORE_WRITER_ID";
/// How many documents the child writes; the suite sets it.
pub const ENV_COUNT: &str = "UMBEL_STORE_WRITER_COUNT";
/// A line of the child's standard output: `UMBEL-WROTE <rev> <doc id>`.
pub const WROTE_PREFIX: &str = "UMBEL-WROTE";

/// Block until the parent writes its start line to standard input. The suite starts all its
/// children this way, so they begin together and the interleaving needs no sleeps.
///
/// # Errors
/// Why standard input could not be read.
pub fn wait_for_start() -> Result<(), String> {
    let mut start = String::new();
    std::io::stdin()
        .lock()
        .read_line(&mut start)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Write `ENV_COUNT` documents named `<ENV_ID>/doc-<n>`, printing one [`WROTE_PREFIX`] line for
/// each.
///
/// # Errors
/// Why the child failed.
pub fn write_documents(stores: &Stores) -> Result<(), String> {
    let id = std::env::var(ENV_ID).map_err(|_| format!("{ENV_ID} is not set"))?;
    let count: usize = std::env::var(ENV_COUNT)
        .map_err(|_| format!("{ENV_COUNT} is not set"))?
        .parse()
        .map_err(|e| format!("{ENV_COUNT}: {e}"))?;
    let mut out = std::io::stdout().lock();
    for n in 0..count {
        let doc_id = format!("{id}/doc-{n:03}");
        let document = samples::document(
            &doc_id,
            &["space"],
            &format!("{id} {n}"),
            &format!("trace-{id}"),
        );
        let meta = stores
            .documents
            .put_document(document, Expect::Absent)
            .ctx("put_document")?;
        writeln!(out, "{WROTE_PREFIX} {} {doc_id}", meta.rev).map_err(|e| e.to_string())?;
    }
    out.flush().map_err(|e| e.to_string())
}

/// The child's work: [`wait_for_start`], then [`write_documents`]. A backend's `writer_child`
/// test opens the stores in `ENV_WRITER` and calls this.
///
/// # Errors
/// Why the child failed (the test then panics and the parent reports its output).
pub fn run_child(stores: &Stores) -> Result<(), String> {
    wait_for_start()?;
    write_documents(stores)
}
