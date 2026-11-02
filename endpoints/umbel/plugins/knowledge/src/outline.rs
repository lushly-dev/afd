//! `knowledge-outline` (specification section 8.5): a document's heading tree, or a directory tree
//! of the documents the caller can read.
//!
//! The tree is built from the document store under the caller's reader filter, so a document the
//! caller cannot read is not an entry and its directory exists only when a readable document is in
//! it. A directory's description is the description of its `index.md` when that document is
//! readable.

use std::collections::BTreeMap;

use serde_json::{Value, json};
use umbel_okf::structure::Heading;
use umbel_sdk::{Cx, HostError, Outcome, failure, success};
use umbel_store::{DocMeta, ListQuery};

use crate::budget::fit_count;
use crate::doc::{label, load};
use crate::fail;

/// The most documents one directory tree lists.
const MAX_ENTRIES: usize = 1000;
/// The most documents one page of the store returns.
const PAGE: u32 = 500;
/// The types of the reserved OKF files.
const INDEX_TYPE: &str = "okf-index";
const LOG_TYPE: &str = "okf-log";

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let Some(space) = cx.call().space.clone() else {
        return fail::no_space();
    };
    let text = |name: &str| input.get(name).and_then(Value::as_str).map(str::to_owned);
    match (text("doc"), text("collection")) {
        (Some(doc), None) => document(cx, &space, &doc),
        (None, Some(collection)) => {
            directory(cx, &space, &collection, text("prefix"), text("after"))
        }
        _ => failure(
            "GRAPH_ARGUMENTS_INVALID",
            "give exactly one of `doc` and `collection`",
            "Pass `doc` for a heading tree, or `collection` (with an optional `prefix`) for a directory tree.",
        ),
    }
}

/// The heading tree of the first `kept` headings (a parent always precedes its children).
fn heading_tree(headings: &[Heading], kept: usize) -> Vec<Value> {
    let mut children: Vec<Vec<usize>> = vec![Vec::new(); kept];
    let mut roots = Vec::new();
    for (at, heading) in headings.iter().take(kept).enumerate() {
        match heading.parent.filter(|parent| *parent < kept) {
            Some(parent) => children[parent].push(at),
            None => roots.push(at),
        }
    }
    fn node(at: usize, headings: &[Heading], children: &[Vec<usize>]) -> Value {
        let heading = &headings[at];
        json!({
            "level": heading.level,
            "text": heading.text,
            "slug": heading.slug,
            "line": heading.line,
            "lines": { "start": heading.lines.start, "end": heading.lines.end },
            "children": children[at].iter().map(|child| node(*child, headings, children)).collect::<Vec<_>>(),
        })
    }
    roots
        .into_iter()
        .map(|root| node(root, headings, &children))
        .collect()
}

fn document(cx: &Cx, space: &str, doc: &str) -> Outcome {
    let loaded = match load(cx, space, doc) {
        Ok(Some(loaded)) => loaded,
        Ok(None) => return fail::document_not_found(),
        Err(error) => return fail::host(&error),
    };
    let headings = &loaded.structure().headings;
    let total = headings.len();
    let (_, outcome) = fit_count(total, cx.call().output_budget, |kept| {
        let mut outcome = success(json!({
            "doc": loaded.doc.id,
            "title": loaded.doc.title,
            "outline": heading_tree(headings, kept),
            "count": kept,
            "trust": "content",
        }))
        .with_metadata("dev.umbel/trust", json!("content"));
        if kept < total {
            outcome = outcome.with_warning_details(
                "RESULTS_LIMITED",
                "the outline is cut after its first headings, to fit the output budget; ask for a larger budget",
                json!({ "found": total, "shown": kept }),
            );
        }
        outcome
    });
    outcome
}

/// A directory of the tree being built.
#[derive(Default)]
struct Dir {
    description: Option<String>,
    title: Option<String>,
    dirs: BTreeMap<String, Dir>,
    docs: Vec<Value>,
}

impl Dir {
    fn json(&self, name: &str, path: &str) -> Value {
        let mut dirs: Vec<Value> = self
            .dirs
            .iter()
            .map(|(child, dir)| dir.json(child, &format!("{path}/{child}")))
            .collect();
        let mut entries = std::mem::take(&mut dirs);
        entries.extend(self.docs.iter().cloned());
        json!({
            "kind": "directory",
            "name": name,
            "path": path,
            "title": self.title,
            "description": self.description,
            "entries": entries,
            "trust": "content",
        })
    }
}

fn directory(
    cx: &Cx,
    space: &str,
    collection: &str,
    prefix: Option<String>,
    after: Option<String>,
) -> Outcome {
    let run = || -> Result<Outcome, HostError> {
        let mut metas: Vec<DocMeta> = Vec::new();
        let mut cursor = after.clone();
        let mut more = false;
        'pages: loop {
            let page = cx.doc_list(
                space,
                &ListQuery {
                    collection: Some(collection.to_owned()),
                    prefix: prefix.clone(),
                    doc_type: None,
                    after: cursor.clone(),
                    limit: PAGE,
                },
            )?;
            for meta in page.items {
                if metas.len() >= MAX_ENTRIES {
                    more = true;
                    break 'pages;
                }
                metas.push(meta);
            }
            match page.next {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        if metas.is_empty() && after.is_none() {
            // A collection with nothing the caller can read, and one that does not exist, look
            // alike.
            return Ok(success(json!({
                "space": space,
                "collection": collection,
                "tree": null,
                "count": 0,
                "truncatedAt": null,
            }))
            .with_metadata("dev.umbel/trust", json!("content")));
        }
        // Directory descriptions: the readable `index.md` documents among the entries.
        let mut described: BTreeMap<String, (String, Option<String>)> = BTreeMap::new();
        for meta in metas
            .iter()
            .filter(|meta| meta.doc_type == INDEX_TYPE)
            .take(200)
        {
            if let Some(document) = cx.doc_get(space, &meta.id)? {
                let dir = meta
                    .id
                    .rsplit_once('/')
                    .map_or(meta.id.as_str(), |(dir, _)| dir)
                    .to_owned();
                described.insert(dir, (document.title.clone(), document.description.clone()));
            }
        }
        let entries: Vec<&DocMeta> = metas
            .iter()
            .filter(|meta| meta.doc_type != INDEX_TYPE && meta.doc_type != LOG_TYPE)
            .collect();
        let total = entries.len();
        let last_id = |kept: usize| kept.checked_sub(1).map(|at| entries[at].id.clone());
        let (_, outcome) = fit_count(total, cx.call().output_budget, |kept| {
            let mut root = Dir::default();
            for meta in &entries[..kept] {
                let mut node = &mut root;
                // The collection is the root; the directories below it nest from there.
                let mut path = collection.to_owned();
                let segments: Vec<&str> = meta.id.split('/').collect();
                for segment in &segments[1..segments.len().saturating_sub(1)] {
                    path.push('/');
                    path.push_str(segment);
                    node = node.dirs.entry((*segment).to_owned()).or_default();
                    if let Some((title, description)) = described.get(&path) {
                        node.title = Some(title.clone());
                        node.description = description.clone();
                    }
                }
                node.docs.push(json!({
                    "kind": "document",
                    "id": meta.id,
                    "title": meta.title,
                    "type": meta.doc_type,
                    "status": label(&meta.status),
                    "trust": "content",
                }));
            }
            let truncated = kept < total || more;
            let mut outcome = success(json!({
                "space": space,
                "collection": collection,
                "tree": root.json(collection, collection),
                "count": kept,
                "truncatedAt": if truncated { last_id(kept).or_else(|| after.clone()) } else { None },
            }))
            .with_metadata("dev.umbel/trust", json!("content"));
            if kept < total {
                outcome = outcome.with_warning_details(
                    "RESULTS_LIMITED",
                    "fewer documents are listed than were found, to fit the output budget; continue from truncatedAt",
                    json!({ "found": total, "shown": kept }),
                );
            }
            outcome
        });
        Ok(outcome)
    };
    run().unwrap_or_else(|error| fail::host(&error))
}
