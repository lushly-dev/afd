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

/// The child's work: wait for the parent's start line on standard input, then write `ENV_COUNT`
/// documents named `<ENV_ID>/doc-<n>` and print one [`WROTE_PREFIX`] line for each.
///
/// # Errors
/// Why the child failed (the test then panics and the parent reports its output).
pub fn run_child(stores: &Stores) -> Result<(), String> {
    let id = std::env::var(ENV_ID).map_err(|_| format!("{ENV_ID} is not set"))?;
    let count: usize = std::env::var(ENV_COUNT)
        .map_err(|_| format!("{ENV_COUNT} is not set"))?
        .parse()
        .map_err(|e| format!("{ENV_COUNT}: {e}"))?;
    let mut start = String::new();
    std::io::stdin().lock().read_line(&mut start).map_err(|e| e.to_string())?;
    let mut out = std::io::stdout().lock();
    for n in 0..count {
        let doc_id = format!("{id}/doc-{n:03}");
        let document = samples::document(&doc_id, &["space"], &format!("{id} {n}"), &format!("trace-{id}"));
        let meta = stores.documents.put_document(document, Expect::Absent).ctx("put_document")?;
        writeln!(out, "{WROTE_PREFIX} {} {doc_id}", meta.rev).map_err(|e| e.to_string())?;
    }
    out.flush().map_err(|e| e.to_string())
}
