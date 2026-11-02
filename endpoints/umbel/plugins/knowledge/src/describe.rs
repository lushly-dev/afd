//! `knowledge-describe` (specification sections 5.4 and 8.5): one document's record without its
//! bytes, its outline, its links and its backlinks.
//!
//! A document the caller may not read is `DOCUMENT_NOT_FOUND`. Backlinks are `links_to` edges
//! read in the incoming direction from the graph store, which counts only the origins the
//! caller's reader filter admits, so a restricted document's links never add to the count.
//! The co-citation cap is a property of the document's own text, so it is reported from there.

use serde_json::{Value, json};
use umbel_okf::links::{Target, resolve};
use umbel_sdk::{Cx, HostError, Outcome, success};
use umbel_store::Direction;

use crate::budget::fit_count;
use crate::doc::{Loaded, label, load, readable};
use crate::fail;

/// The most links and headings listed in full.
const FULL: usize = 200;

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let Some(space) = cx.call().space.clone() else {
        return fail::no_space();
    };
    let doc_id = input.get("doc").and_then(Value::as_str).unwrap_or_default();
    let loaded = match load(cx, &space, doc_id) {
        Ok(Some(loaded)) => loaded,
        Ok(None) => return fail::document_not_found(),
        Err(error) => return fail::host(&error),
    };
    let facts = match Facts::gather(cx, &space, &loaded) {
        Ok(facts) => facts,
        Err(error) => return fail::host(&error),
    };

    // Shrink in steps until the result fits: first the stored frontmatter and envelope, then the
    // long lists. Each step is structural; nothing is cut mid-value.
    let steps: [Level; 4] = [
        Level {
            frontmatter: true,
            list: FULL,
        },
        Level {
            frontmatter: false,
            list: FULL,
        },
        Level {
            frontmatter: false,
            list: 50,
        },
        Level {
            frontmatter: false,
            list: 10,
        },
    ];
    let budget = cx.call().output_budget;
    // `kept` counts the steps of reduction not taken: all of them is the full record.
    let last = steps.len() - 1;
    let (_, outcome) = fit_count(last, budget, |kept| {
        let step = last - kept;
        let mut outcome = render(&space, &loaded, &facts, &steps[step]);
        if step > 0 {
            outcome = outcome.with_warning_details(
                "RESULTS_LIMITED",
                "parts of the record were left out to fit the output budget; ask for a larger budget",
                json!({ "frontmatterOmitted": !steps[step].frontmatter, "listLimit": steps[step].list }),
            );
        }
        outcome
    });
    outcome
}

/// How much of the record to show.
struct Level {
    frontmatter: bool,
    list: usize,
}

/// What the document and the stores say beyond the record itself.
struct Facts {
    resolved: Vec<Value>,
    broken: Vec<Value>,
    external: Vec<Value>,
    links_total: usize,
    backlinks: usize,
    backlinks_at_least: bool,
    chunks: usize,
    index_applied: u64,
    graph_applied: u64,
    co_cited_targets: usize,
}

impl Facts {
    fn gather(cx: &Cx, space: &str, loaded: &Loaded) -> Result<Self, HostError> {
        let doc = &loaded.doc;
        // Other collections of the space resolve `/collection/path` links; without the optional
        // `content` grant only the document's own collection is known.
        let collections = cx
            .content_collections(space)
            .map(|found| found.into_iter().map(|c| c.id).collect::<Vec<_>>())
            .unwrap_or_else(|_| vec![doc.collection.clone()]);
        let structure = loaded.structure();
        let (mut resolved, mut broken, mut external) = (Vec::new(), Vec::new(), Vec::new());
        let mut cited: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        for link in structure.links.iter().take(FULL * 5) {
            match resolve(&link.target, &doc.id, &collections) {
                Target::External(url) => {
                    external.push(json!({ "target": url, "line": link.line }));
                }
                Target::Fragment(slug) => {
                    if structure.heading_by_slug(&slug).is_some() {
                        resolved.push(json!({ "target": link.target, "doc": doc.id, "fragment": slug, "line": link.line }));
                    } else {
                        broken.push(json!({ "target": link.target, "line": link.line }));
                    }
                }
                Target::Document { id, fragment } => {
                    if id != doc.id {
                        cited.insert(id.clone());
                    }
                    // A document the caller cannot read looks like a document that is not there:
                    // a broken link names only what the link says, never the id it resolved to.
                    if readable(cx, space, &id)? {
                        resolved.push(json!({ "target": link.target, "doc": id, "fragment": fragment, "line": link.line }));
                    } else {
                        broken.push(json!({ "target": link.target, "line": link.line }));
                    }
                }
                Target::File(_) => {}
                Target::Unresolved | _ => {
                    broken.push(json!({ "target": link.target, "line": link.line }));
                }
            }
        }
        let backlink_node = format!("doc:{}", doc.id);
        let edges = cx.graph_neighbors(
            space,
            &backlink_node,
            &["links_to".to_owned()],
            Direction::In,
            1000,
        )?;
        let backlinks = edges
            .iter()
            .filter(|edge| edge.to == backlink_node && edge.from.starts_with("doc:"))
            .count();
        let chunks = cx.index_chunks(space, &doc.id)?.len();
        Ok(Self {
            links_total: structure.links.len(),
            resolved,
            broken,
            external,
            backlinks,
            backlinks_at_least: edges.len() >= 1000,
            chunks,
            index_applied: cx.index_applied(space)?,
            graph_applied: cx.graph_applied(space)?,
            co_cited_targets: cited.len(),
        })
    }
}

fn render(space: &str, loaded: &Loaded, facts: &Facts, level: &Level) -> Outcome {
    let doc = &loaded.doc;
    let structure = loaded.structure();
    let outline: Vec<Value> = structure
        .headings
        .iter()
        .take(level.list)
        .map(|heading| {
            json!({
                "level": heading.level,
                "text": heading.text,
                "slug": heading.slug,
                "line": heading.line,
                "lines": { "start": heading.lines.start, "end": heading.lines.end },
            })
        })
        .collect();
    let take = |list: &[Value]| -> Vec<Value> { list.iter().take(level.list).cloned().collect() };
    let mut record = json!({
        "version": 1,
        "id": doc.id,
        "space": space,
        "collection": doc.collection,
        "path": doc.path,
        "rev": doc.rev,
        "contentHash": doc.content_hash,
        "type": doc.doc_type,
        "title": doc.title,
        "description": doc.description,
        "tags": doc.tags,
        "aliases": doc.aliases,
        "owners": doc.owners,
        "status": label(&doc.status),
        "staleAfter": doc.stale_after,
        "supersededBy": doc.superseded_by,
        "verification": doc.verification,
        "access": doc.access,
        "sensitivity": label(&doc.sensitivity),
        "flags": doc.flags.iter().map(label).collect::<Vec<_>>(),
        "size": doc.size,
        "lines": doc.lines,
    });
    if let Some(map) = record.as_object_mut() {
        if level.frontmatter {
            map.insert("frontmatter".to_owned(), json!(doc.frontmatter));
            map.insert("envelope".to_owned(), json!(doc.envelope));
        }
        map.insert("totalLines".to_owned(), json!(loaded.total_lines()));
        map.insert("outline".to_owned(), json!(outline));
        map.insert(
            "links".to_owned(),
            json!({
                "total": facts.links_total,
                "resolved": take(&facts.resolved),
                "broken": take(&facts.broken),
                "external": take(&facts.external),
                // Pairs of the first `limit` distinct documents the text links to are co-cited;
                // a longer list is capped so one document cannot flood the graph.
                "coCitation": {
                    "targets": facts.co_cited_targets,
                    "limit": crate::graph::CO_CITATION_TARGETS,
                    "capped": facts.co_cited_targets > crate::graph::CO_CITATION_TARGETS,
                },
            }),
        );
        map.insert(
            "backlinks".to_owned(),
            json!({
                "count": facts.backlinks,
                "atLeast": facts.backlinks_at_least,
            }),
        );
        map.insert("chunks".to_owned(), json!(facts.chunks));
        map.insert("indexApplied".to_owned(), json!(facts.index_applied));
        map.insert("graphApplied".to_owned(), json!(facts.graph_applied));
        if loaded.is_code() {
            // Symbol chunking is the `code` feature's; without it code is plain text.
            map.insert("codeIndexing".to_owned(), json!("plain-text"));
        }
        map.insert("trust".to_owned(), json!("content"));
    }
    success(record)
        .with_sources(vec![json!({
            "type": "document",
            "id": format!("{space}:{}", doc.id),
            "title": doc.title,
        })])
        .with_metadata("dev.umbel/trust", json!("content"))
}
