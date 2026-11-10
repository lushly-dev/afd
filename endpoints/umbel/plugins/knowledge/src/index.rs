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
//! decision 1). To a caller whose positions are sealed (phase 5 section 9.3) every total counts
//! only the documents it can read, a link to a document it cannot read is broken, `remaining`
//! asks only after changes it can read, and every revision is shown through the host.

use std::collections::BTreeMap;

use chrono::{DateTime, SecondsFormat};
use serde_json::{Map, Value, json};
use umbel_okf::Structure;
use umbel_okf::frontmatter::split;
use umbel_okf::structure;
use umbel_sdk::{Cx, HostError, Outcome, failure, success};
use umbel_store::{ChangeKind, Document, GraphBatch, IndexChunk, StoreError};

use crate::chunk::{self, Chunked};
use crate::code::{self, Budget, Mode};
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
    /// Code files read by this run (index or graph), the symbols they define, and the files whose
    /// symbol parse was degraded to plain text, each with its reason.
    code_files: usize,
    code_symbols: usize,
    degraded: Vec<(String, &'static str)>,
    /// What each document added to the totals above, for a caller who sees only what it can
    /// read (phase 5 section 9.3).
    per_doc: BTreeMap<String, Contribution>,
}

/// One document's part of a run's totals.
#[derive(Default)]
struct Contribution {
    indexed: bool,
    removed: bool,
    chunks: usize,
    limited: bool,
    graphed: bool,
    nodes: usize,
    edges: usize,
    /// Links that resolve to no document at all, and the documents the others name.
    unresolved: usize,
    targets: Vec<String>,
    code_file: bool,
    code_symbols: usize,
    degraded: bool,
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
    // A caller whose positions are sealed (phase 5 section 9.3) spends `limit` on the document
    // changes it can read alone, and the run stops just before the first readable one past it:
    // how far a run gets, and whether one remains, never depend on changes it cannot read.
    let sealed_walk = cx.call().sealed_positions && !rebuild;
    let mut taken = 0u64;
    if sealed_walk {
        loop {
            let page = cx.derive_changes(space, to, PAGE)?;
            let Some(last) = page.last().map(|change| change.rev) else {
                break;
            };
            let readable = readable_document_revs(cx, space, to, last)?;
            for change in &page {
                let document = matches!(change.kind, ChangeKind::Put | ChangeKind::Delete);
                if document && readable.contains(&change.rev) {
                    if taken >= limit {
                        remaining = true;
                        break;
                    }
                    taken += 1;
                }
                to = change.rev;
                if document {
                    touched.insert(change.target.clone(), change.rev);
                }
            }
            if remaining || page.len() < PAGE as usize {
                break;
            }
        }
    } else {
        loop {
            let want =
                u32::try_from(budget.saturating_sub(seen).min(u64::from(PAGE))).unwrap_or(PAGE);
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
    }

    // 4. Build every document's chunks and graph contribution in memory. A store whose applied
    // revision is already at or past a document's last change skips it.
    // The `content` grant is optional: without it the space's collections are unknown, and no
    // more. Every other refusal stops the run (a stopped task's host refusing it included), so a
    // refused call never reads as an empty answer.
    let found = match cx.content_collections(space) {
        Ok(found) => found,
        Err(HostError::NotGranted(text)) if text.contains("grant `content`") => Vec::new(),
        Err(error) => return Err(error.into()),
    };
    let collections = found.iter().map(|c| c.id.clone()).collect::<Vec<_>>();
    // Mentions of symbols are stored only in a space that has a code collection.
    let mentions = found.iter().any(|c| c.kind == "code");
    let mut totals = Totals::default();
    let mut batch = GraphBatch::default();
    let mut present: BTreeMap<String, bool> = BTreeMap::new();
    for (id, last) in &touched {
        let index_needs = rebuild || *last > index_applied;
        let graph_needs = rebuild || *last > graph_applied;
        match cx.derive_document(space, id)? {
            Some(document) => {
                let analysed = analyse(&document);
                let part = totals.per_doc.entry(id.clone()).or_default();
                if let Some(facts) = &analysed.code
                    && (index_needs || graph_needs)
                {
                    part.code_file = true;
                    part.code_symbols = facts.symbols.len();
                    totals.code_files += 1;
                    totals.code_symbols += facts.symbols.len();
                    if let Mode::PlainText(reason) = facts.mode
                        && reason.degraded()
                    {
                        part.degraded = true;
                        totals.degraded.push((id.clone(), reason.code()));
                    }
                }
                let Analysed {
                    chunked,
                    structure,
                    code_fields,
                    code,
                } = analysed;
                if index_needs {
                    let built =
                        index_chunks(&document, &chunked, &code_fields, &ranking.index.filterable);
                    totals.chunks += built.len();
                    let part = totals.per_doc.entry(id.clone()).or_default();
                    part.chunks = built.len();
                    part.indexed = true;
                    if chunked.limited {
                        part.limited = true;
                        totals.limited.push(id.clone());
                    }
                    writer.replace(id, built).map_err(host_error)?;
                    totals.indexed += 1;
                }
                if graph_needs {
                    let symbols = code.as_ref().map_or(&[][..], |facts| &facts.symbols[..]);
                    let built = graph::build(
                        &document,
                        &structure,
                        &collections,
                        symbols,
                        mentions && code.is_none(),
                    );
                    totals.graphed += 1;
                    totals.nodes += built.graph.nodes.len();
                    totals.edges += built.graph.edges.len();
                    totals.broken_links += built.unresolved;
                    let part = totals.per_doc.entry(id.clone()).or_default();
                    part.graphed = true;
                    part.nodes = built.graph.nodes.len();
                    part.edges = built.graph.edges.len();
                    part.unresolved = built.unresolved;
                    part.targets.clone_from(&built.targets);
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
                let part = totals.per_doc.entry(id.clone()).or_default();
                if index_needs {
                    writer.replace(id, Vec::new()).map_err(host_error)?;
                    totals.removed += 1;
                    part.removed = true;
                }
                if graph_needs {
                    totals.graphed += 1;
                    part.graphed = true;
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
    // read (the totals already do, section 6) unless its positions are sealed.
    let head = cx.derive_head(space)?.max(index_after);
    let sealed = cx.call().sealed_positions;
    // A caller whose positions are sealed sees only what it can read (phase 5 section 9.3).
    let shown = if sealed {
        Some(readable_totals(cx, space, from, to, &totals)?)
    } else {
        None
    };

    let position = |rev: u64| cx.doc_position(space, rev);
    let plain;
    let totals_view = match &shown {
        Some(shown) => shown,
        None => {
            plain = Shown::of(&totals);
            &plain
        }
    };

    // What the caller may be told.
    let (listed, more, truncated) = readable_ids(cx, space, from, to, &totals)?;
    let mut data = json!({
        "space": space,
        "rebuild": rebuild,
        "fromRev": position(from)?,
        "toRev": position(to)?,
        "applied": position(index_after)?,
        "indexApplied": position(index_after)?,
        "graphApplied": position(graph_after)?,
        "head": position(head)?,
        "documents": { "indexed": totals_view.indexed, "removed": totals_view.removed },
        "chunks": totals_view.chunks,
        "graph": {
            "documents": totals_view.graphed,
            "nodes": totals_view.nodes,
            "edges": totals_view.edges,
            "brokenLinks": totals_view.broken_links,
            "brokenLinksComplete": !totals_view.broken_partial,
        },
        "ids": listed,
        "idsMore": more,
        "idsComplete": !truncated,
        "remaining": remaining,
    });
    if totals_view.code_files > 0
        && let Some(map) = data.as_object_mut()
    {
        map.insert(
            "code".to_owned(),
            json!({
                "documents": totals_view.code_files,
                "symbols": totals_view.code_symbols,
                "degraded": totals_view.degraded,
            }),
        );
    }
    let reasoning = if sealed {
        format!(
            "Indexed {} and removed {} documents of `{space}` that you can read; the graph holds {} of their contributions rebuilt.",
            totals_view.indexed, totals_view.removed, totals_view.graphed
        )
    } else {
        format!(
            "Indexed {} and removed {} documents of `{space}` from revision {from} to {to}; the graph holds {} contributions rebuilt.",
            totals.indexed, totals.removed, totals.graphed
        )
    };
    let mut outcome = success(data)
    .with_reasoning(&reasoning)
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
        json!({ space: { "applied": index_after, "head": head, "schema": crate::INDEX_SCHEMA } }),
    );
    if !totals.degraded.is_empty() && totals_view.degraded > 0 {
        // The first 20 readable ones; to a sealed caller, never fewer because of ones it
        // cannot read.
        let mut files = Vec::new();
        let examined = if sealed { totals.degraded.len() } else { 20 };
        for (id, reason) in totals.degraded.iter().take(examined) {
            if files.len() < 20 && readable(cx, space, id)? {
                files.push(json!({ "id": id, "reason": reason }));
            }
        }
        outcome = outcome.with_warning_details(
            "CODE_PARSE_DEGRADED",
            &format!(
                "{} code file(s) were indexed as plain text because their parse exceeded a budget or failed; the reason of each readable one is listed",
                totals_view.degraded
            ),
            json!({ "count": totals_view.degraded, "files": files }),
        );
    }
    if remaining {
        outcome = outcome.with_warning_details(
            "INDEX_REMAINING",
            "the run stopped at its limit; run knowledge-index again to continue",
            json!({ "toRev": position(to)? }),
        );
    }
    if !totals.limited.is_empty() && totals_view.limited > 0 {
        let mut ids = Vec::new();
        let examined = if sealed { totals.limited.len() } else { 20 };
        for id in totals.limited.iter().take(examined) {
            if ids.len() < 20 && readable(cx, space, id)? {
                ids.push(id.clone());
            }
        }
        outcome = outcome.with_warning_details(
            "CHUNKS_LIMITED",
            &format!(
                "{} document(s) have more than {} chunks; only the first {} of each are indexed",
                totals_view.limited,
                chunk::MAX_CHUNKS,
                chunk::MAX_CHUNKS
            ),
            json!({ "count": totals_view.limited, "ids": ids }),
        );
    }
    Ok(outcome)
}

/// The revisions of the document changes the caller can read after `after` and at or before
/// `last`.
fn readable_document_revs(
    cx: &Cx,
    space: &str,
    after: u64,
    last: u64,
) -> Result<std::collections::BTreeSet<u64>, HostError> {
    let mut revs = std::collections::BTreeSet::new();
    let mut cursor = after;
    loop {
        let page = cx.doc_changes(space, cursor, PAGE, None)?;
        for change in &page {
            if change.rev > last {
                return Ok(revs);
            }
            cursor = change.rev;
            if matches!(change.kind, ChangeKind::Put | ChangeKind::Delete) {
                revs.insert(change.rev);
            }
        }
        if page.len() < PAGE as usize {
            return Ok(revs);
        }
    }
}

/// The totals a result shows.
struct Shown {
    indexed: usize,
    removed: usize,
    chunks: usize,
    limited: usize,
    graphed: usize,
    nodes: usize,
    edges: usize,
    broken_links: usize,
    broken_partial: bool,
    code_files: usize,
    code_symbols: usize,
    degraded: usize,
}

impl Shown {
    /// Every document's, for a caller whose positions are plain.
    fn of(totals: &Totals) -> Self {
        Self {
            indexed: totals.indexed,
            removed: totals.removed,
            chunks: totals.chunks,
            limited: totals.limited.len(),
            graphed: totals.graphed,
            nodes: totals.nodes,
            edges: totals.edges,
            broken_links: totals.broken_links,
            broken_partial: totals.broken_partial,
            code_files: totals.code_files,
            code_symbols: totals.code_symbols,
            degraded: totals.degraded.len(),
        }
    }
}

/// The run's totals over the documents the caller can read (phase 5 section 9.3): a removal it
/// can read in the change log, a write it can read now; and a link to a document it cannot read
/// counts as broken, as `knowledge-describe` shows one.
fn readable_totals(
    cx: &Cx,
    space: &str,
    from: u64,
    to: u64,
    totals: &Totals,
) -> Result<Shown, HostError> {
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
                && totals.per_doc.contains_key(&change.target)
            {
                last.insert(change.target.clone(), change.kind);
            }
        }
        if page.len() < PAGE as usize {
            break;
        }
    }
    let mut shown = Shown {
        indexed: 0,
        removed: 0,
        chunks: 0,
        limited: 0,
        graphed: 0,
        nodes: 0,
        edges: 0,
        broken_links: 0,
        broken_partial: false,
        code_files: 0,
        code_symbols: 0,
        degraded: 0,
    };
    let mut known: BTreeMap<String, bool> = BTreeMap::new();
    for (id, kind) in last {
        let visible = match kind {
            ChangeKind::Delete => true,
            _ => readable(cx, space, &id)?,
        };
        let Some(part) = totals.per_doc.get(&id).filter(|_| visible) else {
            continue;
        };
        shown.indexed += usize::from(part.indexed);
        shown.removed += usize::from(part.removed);
        shown.chunks += part.chunks;
        shown.limited += usize::from(part.limited);
        shown.graphed += usize::from(part.graphed);
        shown.nodes += part.nodes;
        shown.edges += part.edges;
        shown.code_files += usize::from(part.code_file);
        shown.code_symbols += part.code_symbols;
        shown.degraded += usize::from(part.degraded);
        shown.broken_links += part.unresolved;
        for target in &part.targets {
            if known.len() >= TARGET_LOOKUPS && !known.contains_key(target) {
                shown.broken_partial = true;
                continue;
            }
            let here = match known.get(target) {
                Some(here) => *here,
                None => {
                    let here = readable(cx, space, target)?;
                    known.insert(target.clone(), here);
                    here
                }
            };
            if !here {
                shown.broken_links += 1;
            }
        }
    }
    Ok(shown)
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

/// What reading a document found: its chunks, the markdown structure they came from (empty for
/// text that has none), and for a code file the symbols and the `code` field of each chunk.
struct Analysed {
    chunked: Chunked,
    structure: Structure,
    /// Per chunk, aligned with `chunked.chunks`; empty strings when there are no symbols.
    code_fields: Vec<String>,
    /// Present for a code document.
    code: Option<code::Analysis>,
}

/// Read a document once, so the index and the graph are built from the same parse.
fn analyse(document: &Document) -> Analysed {
    if document.doc_type == "code" {
        let text = String::from_utf8_lossy(&document.bytes);
        let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
        let mut analysis = code::analyse(&document.path, text, &Budget::default());
        return Analysed {
            chunked: std::mem::take(&mut analysis.chunked),
            structure: Structure::default(),
            code_fields: std::mem::take(&mut analysis.code),
            code: Some(analysis),
        };
    }
    let (chunked, structure) = match split(&document.bytes) {
        Ok(parts) => {
            let body = structure(parts.text, parts.body_offset);
            (chunk::markdown(parts.text, &body), body)
        }
        Err(_) => {
            let text = String::from_utf8_lossy(&document.bytes);
            (chunk::plain(&text), Structure::default())
        }
    };
    Analysed {
        chunked,
        structure,
        code_fields: Vec::new(),
        code: None,
    }
}

/// The index's chunks of a document: each chunk's text and the document's context fields.
pub(crate) fn index_chunks(
    document: &Document,
    chunked: &Chunked,
    code_fields: &[String],
    filterable: &[String],
) -> Vec<IndexChunk> {
    let is_code = document.doc_type == "code";
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
            code: code_fields
                .get(chunk.ordinal as usize)
                .filter(|names| !names.is_empty())
                .cloned(),
            tags: document.tags.clone(),
            owners: document.owners.clone(),
            doc_type: document.doc_type.clone(),
            collection: document.collection.clone(),
            status: label(&document.status),
            verified: label(&document.verification.tier),
            sensitivity: label(&document.sensitivity),
            lang: is_code
                .then(|| code::language_of(&document.path).map(str::to_owned))
                .flatten(),
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
