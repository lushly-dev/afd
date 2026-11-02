//! `knowledge-index` (specification section 8.7): the index maintenance procedure, for the
//! search index and the structural graph.
//!
//! Several processes may run it for one space at once; the procedure makes them take turns and
//! never lowers what the index reflects:
//!
//! 1. take the index writer first (bounded wait, else `STORE_BUSY`);
//! 2. only then read the index's and the graph's applied revisions; the run starts after the
//!    smaller;
//! 3. read the changes after it with a derivation read, and for each changed document build its
//!    chunks and its graph contribution in memory, skipping a store that already reflects the
//!    change;
//! 4. stage the index replacements in the writer session and build one graph batch;
//! 5. commit the graph (one transaction), then the index, each with `max(applied, to)`, release
//!    the writer and checkpoint the store.
//!
//! The result gives totals for every document and the ids the caller can read: the command sees
//! every document, so an id appears only when the caller's reader filter admits it (owner
//! decision 1).

use std::collections::BTreeMap;

use chrono::{DateTime, SecondsFormat};
use serde_json::{Map, Value, json};
use umbel_okf::Structure;
use umbel_okf::frontmatter::split;
use umbel_okf::structure;
use umbel_sdk::{Cx, HostError, Outcome, failure, success};
use umbel_store::{ChangeKind, Document, GraphBatch, IndexChunk, StoreError};

use crate::chunk::{self, Chunked};
use crate::doc::{label, readable};
use crate::fail;
use crate::graph;
use crate::settings::Ranking;

/// The most changes one derivation read returns.
const PAGE: u32 = 1000;
/// The default `limit` of a run, in changes.
const DEFAULT_LIMIT: u64 = 10_000;
/// The most ids a result lists; the rest are counted.
const LISTED: usize = 100;
/// The most candidate ids the result examines for readability.
const EXAMINED: usize = 5000;
/// The most distinct link targets one run looks up to judge whether a link is broken.
const TARGET_LOOKUPS: usize = 10_000;

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let Some(space) = cx.call().space.clone() else {
        return fail::no_space();
    };
    let rebuild = input
        .get("rebuild")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let limit = input
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_LIMIT)
        .clamp(1, 100_000);
    let ranking = match Ranking::load(cx) {
        Ok(ranking) => ranking,
        Err(outcome) => return outcome,
    };
    match build(cx, &space, rebuild, limit, &ranking) {
        Ok(outcome) => outcome,
        Err(Stop::Host(error)) => fail::host(&error),
        Err(Stop::Outcome(outcome)) => outcome,
    }
}

/// Why a run stopped.
enum Stop {
    Host(HostError),
    Outcome(Outcome),
}

impl From<HostError> for Stop {
    fn from(error: HostError) -> Self {
        Self::Host(error)
    }
}

/// What a run did.
#[derive(Default)]
struct Totals {
    indexed: usize,
    removed: usize,
    chunks: usize,
    limited: Vec<String>,
    kinds: BTreeMap<String, &'static str>,
    /// Documents whose graph contribution was replaced or removed.
    graphed: usize,
    nodes: usize,
    edges: usize,
    broken_links: usize,
    /// Whether the link targets looked up reached [`TARGET_LOOKUPS`].
    broken_partial: bool,
}

fn build(
    cx: &Cx,
    space: &str,
    rebuild: bool,
    limit: u64,
    ranking: &Ranking,
) -> Result<Outcome, Stop> {
    // 1. The writer first: holding it serialises indexers across threads and processes.
    let mut writer = cx.index_writer(space)?;
    // 2. Only then the applied revisions; the run starts after the smaller, so a run after a crash
    // between the two commits redoes only the store that lags.
    let index_applied = writer.applied().map_err(host_error)?;
    let graph_applied = cx.graph_applied(space)?;
    let from = if rebuild {
        0
    } else {
        index_applied.min(graph_applied)
    };
    if rebuild {
        writer.clear().map_err(host_error)?;
    }

    // 3. The changes after `from`, each document with the last revision that changed it. A rebuild
    // reads every change in one run (a commit never lowers the applied revision, so a rebuild
    // cannot stop part way).
    let budget = if rebuild { u64::MAX } else { limit };
    let mut touched: BTreeMap<String, u64> = BTreeMap::new();
    let mut to = from;
    let mut seen = 0u64;
    let mut remaining = false;
    loop {
        let want = u32::try_from(budget.saturating_sub(seen).min(u64::from(PAGE))).unwrap_or(PAGE);
        if want == 0 {
            break;
        }
        let page = cx.derive_changes(space, to, want)?;
        for change in &page {
            to = change.rev;
            if matches!(change.kind, ChangeKind::Put | ChangeKind::Delete) {
                touched.insert(change.target.clone(), change.rev);
            }
        }
        seen += page.len() as u64;
        if page.len() < want as usize {
            break;
        }
        if seen >= budget {
            remaining = !cx.derive_changes(space, to, 1)?.is_empty();
            break;
        }
    }

    // 4. Build every document's chunks and graph contribution in memory. A store whose applied
    // revision is already at or past a document's last change skips it.
    let collections = cx
        .content_collections(space)
        .map(|found| found.into_iter().map(|c| c.id).collect::<Vec<_>>())
        .unwrap_or_default();
    let mut totals = Totals::default();
    let mut batch = GraphBatch::default();
    let mut present: BTreeMap<String, bool> = BTreeMap::new();
    for (id, last) in &touched {
        let index_needs = rebuild || *last > index_applied;
        let graph_needs = rebuild || *last > graph_applied;
        match cx.derive_document(space, id)? {
            Some(document) => {
                let (chunked, structure) = analyse(&document);
                if index_needs {
                    let built = index_chunks(&document, &chunked, &ranking.index.filterable);
                    totals.chunks += built.len();
                    if chunked.limited {
                        totals.limited.push(id.clone());
                    }
                    writer.replace(id, built).map_err(host_error)?;
                    totals.indexed += 1;
                }
                if graph_needs {
                    let built = graph::build(&document, &structure, &collections);
                    totals.graphed += 1;
                    totals.nodes += built.graph.nodes.len();
                    totals.edges += built.graph.edges.len();
                    totals.broken_links += built.unresolved;
                    for target in &built.targets {
                        if present.len() >= TARGET_LOOKUPS && !present.contains_key(target) {
                            totals.broken_partial = true;
                            continue;
                        }
                        let here = match present.get(target) {
                            Some(here) => *here,
                            None => {
                                let here = cx.derive_document(space, target)?.is_some();
                                present.insert(target.clone(), here);
                                here
                            }
                        };
                        if !here {
                            totals.broken_links += 1;
                        }
                    }
                    batch.entries.push((id.clone(), Some(built.graph)));
                }
                totals.kinds.insert(id.clone(), "indexed");
            }
            None => {
                if index_needs {
                    writer.replace(id, Vec::new()).map_err(host_error)?;
                    totals.removed += 1;
                }
                if graph_needs {
                    totals.graphed += 1;
                    batch.entries.push((id.clone(), None));
                }
                totals.kinds.insert(id.clone(), "removed");
            }
        }
    }

    // 5. Commit the graph in one transaction, then the index, neither ever lowering its revision;
    // nothing to say when nothing moved.
    let graph_after = graph_applied.max(to);
    let index_after = index_applied.max(to);
    let wrote_graph = rebuild || !batch.entries.is_empty() || graph_after > graph_applied;
    if wrote_graph {
        cx.graph_apply(space, batch, graph_after)?;
    }
    let wrote_index = rebuild || index_after > index_applied;
    if wrote_index {
        writer.commit(index_after).map_err(host_error)?;
    } else {
        writer.abort();
    }
    // 6. Best-effort WAL checkpoint after a run that wrote; a busy store is not a failure.
    if wrote_graph || wrote_index {
        let _ = cx.checkpoint(space);
    }
    // The true head: this command is a derivation read, so it may count what the caller cannot
    // read (the totals already do, section 6).
    let head = cx.derive_head(space)?.max(index_after);

    // What the caller may be told.
    let (listed, more, truncated) = readable_ids(cx, space, from, to, &totals)?;
    let mut outcome = success(json!({
        "space": space,
        "rebuild": rebuild,
        "fromRev": from,
        "toRev": to,
        "applied": index_after,
        "indexApplied": index_after,
        "graphApplied": graph_after,
        "head": head,
        "documents": { "indexed": totals.indexed, "removed": totals.removed },
        "chunks": totals.chunks,
        "graph": {
            "documents": totals.graphed,
            "nodes": totals.nodes,
            "edges": totals.edges,
            "brokenLinks": totals.broken_links,
            "brokenLinksComplete": !totals.broken_partial,
        },
        "ids": listed,
        "idsMore": more,
        "idsComplete": !truncated,
        "remaining": remaining,
    }))
    .with_reasoning(&format!(
        "Indexed {} and removed {} documents of `{space}` from revision {from} to {to}; the graph holds {} contributions rebuilt.",
        totals.indexed, totals.removed, totals.graphed
    ))
    .with_metadata(
        "dev.umbel/record",
        json!({ "kind": "index", "id": space, "version": index_after }),
    )
    .with_metadata(
        "dev.umbel/provenance",
        json!({ "origin": "document-derived", "access": ["space"], "sensitivity": "internal" }),
    )
    .with_metadata(
        "dev.umbel/index",
        json!({ space: { "applied": index_after, "head": head, "schema": 1 } }),
    );
    if remaining {
        outcome = outcome.with_warning_details(
            "INDEX_REMAINING",
            "the run stopped at its limit; run knowledge-index again to continue",
            json!({ "toRev": to }),
        );
    }
    if !totals.limited.is_empty() {
        let mut ids = Vec::new();
        for id in totals.limited.iter().take(20) {
            if readable(cx, space, id)? {
                ids.push(id.clone());
            }
        }
        outcome = outcome.with_warning_details(
            "CHUNKS_LIMITED",
            &format!(
                "{} document(s) have more than {} chunks; only the first {} of each are indexed",
                totals.limited.len(),
                chunk::MAX_CHUNKS,
                chunk::MAX_CHUNKS
            ),
            json!({ "count": totals.limited.len(), "ids": ids }),
        );
    }
    Ok(outcome)
}

/// An index write refused: the host's mapping for the store errors it knows, and a failure of its
/// own for a write the index found malformed (a bug in the chunker, not in the caller's query).
fn host_error(error: StoreError) -> Stop {
    match error {
        StoreError::Conflict { current } => Stop::Host(HostError::Conflict { current }),
        StoreError::Busy => Stop::Host(HostError::Busy(error.to_string())),
        StoreError::TooLarge(reason) => Stop::Host(HostError::TooLarge(reason)),
        StoreError::NotFound => Stop::Host(HostError::NotFound(error.to_string())),
        StoreError::Invalid(reason) => Stop::Outcome(failure(
            "KNOWLEDGE_INDEX_INVALID",
            &format!("the index refused a document's chunks: {reason}"),
            "Report this: the chunker built something the index cannot hold. Other documents are unaffected; run knowledge-index again after fixing or removing the document.",
        )),
        StoreError::Io(_) => Stop::Host(HostError::Io(error.to_string())),
        _ => Stop::Host(HostError::Corrupt(error.to_string())),
    }
}

/// The ids among the run's documents the caller may read, at most [`LISTED`] of them, how many
/// more there are, and whether the examination stopped at [`EXAMINED`] candidates.
///
/// Readable removals come from the change log read as the caller (a deletion is as readable as
/// the version it deleted); a written document must also be readable now.
fn readable_ids(
    cx: &Cx,
    space: &str,
    from: u64,
    to: u64,
    totals: &Totals,
) -> Result<(Vec<Value>, usize, bool), HostError> {
    let mut last: BTreeMap<String, ChangeKind> = BTreeMap::new();
    let mut after = from;
    'pages: loop {
        let page = cx.doc_changes(space, after, PAGE, None)?;
        for change in &page {
            if change.rev > to {
                break 'pages;
            }
            after = change.rev;
            if matches!(change.kind, ChangeKind::Put | ChangeKind::Delete)
                && totals.kinds.contains_key(&change.target)
            {
                last.insert(change.target.clone(), change.kind);
            }
        }
        if page.len() < PAGE as usize {
            break;
        }
    }
    let mut listed = Vec::new();
    let mut more = 0usize;
    for (examined, (id, kind)) in last.into_iter().enumerate() {
        if examined >= EXAMINED {
            return Ok((listed, more, true));
        }
        let visible = match kind {
            ChangeKind::Delete => true,
            _ => readable(cx, space, &id)?,
        };
        if !visible {
            continue;
        }
        if listed.len() < LISTED {
            let change = totals.kinds.get(&id).copied().unwrap_or("indexed");
            listed.push(json!({ "id": id, "change": change }));
        } else {
            more += 1;
        }
    }
    Ok((listed, more, false))
}

/// A document's chunks and the markdown structure they came from (empty for text that has none),
/// so the graph is built from the same parse.
fn analyse(document: &Document) -> (Chunked, Structure) {
    if document.doc_type == "code" {
        let text = String::from_utf8_lossy(&document.bytes);
        return (
            chunk::plain(text.strip_prefix('\u{feff}').unwrap_or(&text)),
            Structure::default(),
        );
    }
    match split(&document.bytes) {
        Ok(parts) => {
            let body = structure(parts.text, parts.body_offset);
            (chunk::markdown(parts.text, &body), body)
        }
        Err(_) => {
            let text = String::from_utf8_lossy(&document.bytes);
            (chunk::plain(&text), Structure::default())
        }
    }
}

/// The index's chunks of a document: each chunk's text and the document's context fields.
pub(crate) fn index_chunks(
    document: &Document,
    chunked: &Chunked,
    filterable: &[String],
) -> Vec<IndexChunk> {
    let code = document.doc_type == "code";
    let updated = document
        .envelope
        .generated
        .as_ref()
        .map(|generated| generated.at.as_str())
        .or(Some(document.envelope.observed_at.as_str()))
        .and_then(rfc3339);
    let stale_after = document.stale_after.as_deref().and_then(rfc3339);
    let mut meta = Map::new();
    for key in filterable {
        if let Some(value) = document.frontmatter.get(key)
            && matches!(value, Value::String(_) | Value::Number(_) | Value::Bool(_))
        {
            meta.insert(key.clone(), value.clone());
        }
    }
    chunked
        .chunks
        .iter()
        .map(|chunk| IndexChunk {
            doc: document.id.clone(),
            ordinal: chunk.ordinal,
            line_start: chunk.line_start,
            line_end: chunk.line_end,
            heading_path: chunk.heading_path.clone(),
            chunk_hash: chunk.hash.clone(),
            body: chunk.text.clone(),
            title: document.title.clone(),
            aliases: document.aliases.clone(),
            description: document.description.clone(),
            code: None,
            tags: document.tags.clone(),
            owners: document.owners.clone(),
            doc_type: document.doc_type.clone(),
            collection: document.collection.clone(),
            status: label(&document.status),
            verified: label(&document.verification.tier),
            sensitivity: label(&document.sensitivity),
            lang: code.then(|| language(&document.path)).flatten(),
            path: document.path.clone(),
            updated: updated.clone(),
            stale_after: stale_after.clone(),
            meta: meta.clone(),
            access: document.access.clone(),
        })
        .collect()
}

/// A time as the index takes it: RFC 3339 in UTC, or `None` for text that is not one.
fn rfc3339(text: &str) -> Option<String> {
    DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|time| time.to_utc().to_rfc3339_opts(SecondsFormat::Secs, true))
}

/// The language of a code file, by extension.
fn language(path: &str) -> Option<String> {
    let extension = path.rsplit_once('.')?.1;
    let name = match extension {
        "rs" => "rust",
        "py" => "python",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" => "javascript",
        _ => return None,
    };
    Some(name.to_owned())
}
