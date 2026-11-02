//! Graph expansion of a search (specification section 8.2, step 3): the readable neighbours of
//! the top documents receive a share of their parents' scores.
//!
//! Neighbours come from the `graph` grant, which serves only edges whose two endpoints and whose
//! origin document the caller can read, so an unreadable neighbour is never returned, scored,
//! counted or hinted at; the document store's own filter is applied again before one is shown.
//! A `co_cited` pair counts only when the readable citers sum to at least the pack's minimum.

use std::collections::BTreeMap;

use umbel_sdk::{Cx, HostError};
use umbel_store::{Direction, IndexChunk};

use crate::graph::doc_node;
use crate::settings::Expansion;

/// The edges one neighbour read asks for.
const EDGE_READ: u32 = 1000;

/// One neighbour a parent reaches.
struct Reach {
    factor: f64,
    weight: u64,
}

/// For each parent `(document, score)`, the share of its score each readable neighbour receives,
/// summed over the parents. Parents are read in the order given; a neighbour reached by several
/// relations of one parent gets the highest factor once.
pub(crate) fn shares(
    cx: &Cx,
    space: &str,
    parents: &[(String, f64)],
    settings: &Expansion,
) -> Result<BTreeMap<String, f64>, HostError> {
    let mut shares: BTreeMap<String, f64> = BTreeMap::new();
    for (doc, score) in parents {
        let me = doc_node(doc);
        let edges = cx.graph_neighbors(
            space,
            &me,
            &[
                "links_to".to_owned(),
                "supersedes".to_owned(),
                "co_cited".to_owned(),
            ],
            Direction::Both,
            EDGE_READ,
        )?;
        let mut reached: BTreeMap<String, Reach> = BTreeMap::new();
        for edge in &edges {
            let out = edge.from == me;
            let other = if out { &edge.to } else { &edge.from };
            let Some(other) = other.strip_prefix("doc:") else {
                continue;
            };
            if other == doc {
                continue;
            }
            let factor = match (edge.kind.as_str(), out) {
                ("links_to", _) => settings.links,
                ("supersedes", true) => settings.supersedes,
                ("co_cited", true) if edge.weight >= settings.co_cited_min_weight => {
                    settings.co_cited
                }
                _ => continue,
            };
            let entry = reached.entry(other.to_owned()).or_insert(Reach {
                factor,
                weight: edge.weight,
            });
            if factor > entry.factor {
                *entry = Reach {
                    factor,
                    weight: edge.weight,
                };
            }
        }
        // At most `max_per_document` neighbours, by weight and then id.
        let mut chosen: Vec<(String, Reach)> = reached.into_iter().collect();
        chosen.sort_by(|a, b| b.1.weight.cmp(&a.1.weight).then_with(|| a.0.cmp(&b.0)));
        chosen.truncate(settings.max_per_document);
        for (other, reach) in chosen {
            *shares.entry(other).or_insert(0.0) += settings.weight * score * reach.factor;
        }
    }
    Ok(shares)
}

/// Whether a document's first chunk satisfies a request's structured filters, which an expanded
/// document must meet as a matched one does (the index applies them to matches).
pub(crate) fn passes(chunk: &IndexChunk, filters: &umbel_store::IndexFilters) -> bool {
    filters
        .collection
        .as_deref()
        .is_none_or(|c| c == chunk.collection)
        && filters
            .doc_type
            .as_deref()
            .is_none_or(|t| t == chunk.doc_type)
        && filters.tags.iter().all(|tag| chunk.tags.contains(tag))
        && filters.status.as_deref().is_none_or(|s| s == chunk.status)
        && (filters.verified.is_empty() || filters.verified.contains(&chunk.verified))
        && filters
            .sensitivity
            .as_deref()
            .is_none_or(|s| s == chunk.sensitivity)
        && filters.updated_after.as_deref().is_none_or(|after| {
            let after = chrono::DateTime::parse_from_rfc3339(after).ok();
            let updated = chunk
                .updated
                .as_deref()
                .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok());
            match (after, updated) {
                (Some(after), Some(updated)) => updated >= after,
                (Some(_), None) => false,
                _ => true,
            }
        })
}
