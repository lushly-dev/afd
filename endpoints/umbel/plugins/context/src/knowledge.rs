//! The `knowledge` section (section 9.3): the task's terms over the index, a document's score
//! from its best chunks, each hit read again through the document store, and the pushed
//! document's passage cut to the pack's length. No graph expansion.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::json;
use umbel_okf::{is_stale, locator};
use umbel_sdk::{Cx, HostError, Outcome};
use umbel_store::{ChangeKind, ChunkHit, Document, Flag, IndexFilters, IndexQuery, Status, Tier};

use crate::fail;
use crate::render::clean_header;
use crate::select::{Gap, Item, Lane, Request, Section, Warning};
use crate::settings::{Bundle, Settings};

/// The chunk hits one search asks for.
const HITS: u32 = 64;
/// The next best chunks that add to a document's score.
const SECONDARY: usize = 2;
/// The types of the reserved OKF files, which a bundle never holds.
const RESERVED_TYPES: [&str; 2] = ["okf-index", "okf-log"];
const RESERVED_FILES: [&str; 2] = ["index.md", "log.md"];

/// What the knowledge lane found.
pub(crate) struct Found {
    pub(crate) lane: Lane,
    pub(crate) warnings: Vec<Warning>,
    pub(crate) applied: Option<u64>,
}

/// A serde enum's wire spelling.
fn label<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
}

pub(crate) fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

/// A grant that is not there is an absent lane; anything else fails the call.
fn absent<T>(result: Result<T, HostError>) -> Result<Option<T>, Outcome> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(HostError::NotGranted(_)) => Ok(None),
        Err(error) => Err(fail::host(&error)),
    }
}

/// `text` cut at a line boundary to at most `max` bytes, and whether it was cut. A first line
/// longer than `max` is cut at a character boundary.
pub(crate) fn cut(text: &str, max: usize) -> (String, bool) {
    if text.len() <= max {
        return (text.to_owned(), false);
    }
    let mut end = 0;
    for (at, _) in text.match_indices('\n') {
        if at > max {
            break;
        }
        end = at;
    }
    if end == 0 {
        end = max;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
    }
    (text[..end].trim_end_matches(['\n', '\r']).to_owned(), true)
}

fn reserved(doc: &Document) -> bool {
    RESERVED_TYPES.contains(&doc.doc_type.as_str())
        || RESERVED_FILES
            .iter()
            .any(|file| doc.path == *file || doc.path.ends_with(&format!("/{file}")))
}

fn flagged(doc: &Document) -> bool {
    doc.flags
        .iter()
        .any(|flag| matches!(flag, Flag::HiddenText | Flag::InstructionLike))
}

fn item(space: &str, doc: &Document, best: &ChunkHit, bundle: &Bundle, now: i64) -> Item {
    let id = format!("{space}:{}", doc.id);
    let (text, was_cut) = cut(&best.chunk.body, bundle.max_item_bytes);
    let (start, end) = (best.chunk.line_start, best.chunk.line_end);
    let locator = locator::string(space, &doc.id, start, end, doc.content_hash.as_str());
    let verification = label(&doc.verification.tier);
    let status = label(&doc.status);
    let stale = is_stale(doc.stale_after.as_deref(), now);
    let flags: Vec<String> = doc.flags.iter().map(label).collect();
    let json = json!({
        "kind": "document",
        "id": id,
        "title": doc.title,
        "text": text,
        "cut": was_cut,
        "locator": locator,
        "status": status,
        "verification": verification,
        "stale": stale,
        "flags": flags,
        "trust": "content",
        "provenance": {
            "origin": doc.envelope.origin,
            "authority": null,
            "generated": doc.envelope.generated,
        },
    });
    let source = json!({
        "type": "document",
        "id": id,
        "title": doc.title,
        "location": format!("L{start}-L{end}"),
    });
    let mut header = format!(
        "[knowledge · {} · verified: {verification} · {}",
        clean_header(&id),
        clean_header(&locator)
    );
    if doc.status == Status::Draft {
        header.push_str(" · draft");
    }
    if stale {
        header.push_str(" · stale");
    }
    header.push(']');
    Item {
        id,
        json,
        source,
        header,
        title: doc.title.clone(),
        text,
        capped: false,
    }
}

/// The knowledge lane of `request`.
pub(crate) fn lane(
    cx: &Cx,
    request: &Request,
    settings: &Settings,
    bundle: &Bundle,
) -> Result<Found, Outcome> {
    let section = Section::Knowledge;
    let space = request.space.as_str();
    let mut found = Found {
        lane: Lane::new(section),
        warnings: Vec::new(),
        applied: None,
    };
    if request.as_of_given {
        found.warnings.push((
            "KNOWLEDGE_NOT_BITEMPORAL",
            "asOf reads memory as of that instant; the knowledge section is the documents' current state".to_owned(),
            None,
        ));
    }
    if request.terms.is_empty() {
        found.lane.gap = Some(Gap::NoTask);
        return Ok(found);
    }
    let Some(applied) = absent(cx.index_applied(space))? else {
        found.lane.gap = Some(Gap::LaneUnavailable);
        return Ok(found);
    };
    // Phase 2's F4: stale when the caller can read a document change after `applied`.
    let Some(changes) = absent(cx.doc_changes(space, applied, 1000, None))? else {
        found.lane.gap = Some(Gap::LaneUnavailable);
        return Ok(found);
    };
    found.applied = Some(applied);
    if applied == 0 {
        found.lane.gap = Some(Gap::IndexEmpty);
        return Ok(found);
    }
    if changes
        .iter()
        .any(|change| matches!(change.kind, ChangeKind::Put | ChangeKind::Delete))
    {
        let head = changes.last().map_or(applied, |change| change.rev);
        // Revisions as the caller may see them (phase 5 section 9.3).
        let (Some(applied), Some(head)) = (
            absent(cx.doc_position(space, applied))?,
            absent(cx.doc_position(space, head))?,
        ) else {
            found.lane.gap = Some(Gap::LaneUnavailable);
            return Ok(found);
        };
        found.warnings.push((
            "INDEX_STALE",
            format!("the index of `{space}` is behind the documents; run knowledge-refresh"),
            Some(json!({ "space": space, "applied": applied, "head": head })),
        ));
    }
    let mut filters = IndexFilters::default();
    if settings.verified_only {
        filters.verified = vec!["human".to_owned(), "owner".to_owned()];
    }
    // Each term is letters and digits only, so quoting it as a one-word phrase escapes nothing.
    let text = request
        .terms
        .iter()
        .map(|term| format!("\"{term}\""))
        .collect::<Vec<_>>()
        .join(" OR ");
    let hits = cx
        .index_search(
            space,
            &IndexQuery {
                text,
                filters,
                limit: HITS,
            },
        )
        .map_err(|error| fail::host(&error))?;
    let mut by_doc: BTreeMap<String, Vec<ChunkHit>> = BTreeMap::new();
    for hit in hits {
        by_doc.entry(hit.doc.clone()).or_default().push(hit);
    }
    let mut scored = Vec::new();
    for (doc_id, mut chunks) in by_doc {
        chunks.sort_by(|a, b| {
            b.score
                .total_cmp(&a.score)
                .then(a.chunk.ordinal.cmp(&b.chunk.ordinal))
        });
        let best = f64::from(chunks[0].score);
        let rest: f64 = chunks
            .iter()
            .skip(1)
            .take(SECONDARY)
            .map(|hit| f64::from(hit.score))
            .sum();
        let raw = round4(best + bundle.secondary_weight * rest);
        // A stale index never serves a deleted or tightened document: read it again.
        let Some(doc) = cx
            .doc_get(space, &doc_id)
            .map_err(|error| fail::host(&error))?
        else {
            continue;
        };
        if doc.status == Status::Deprecated || reserved(&doc) {
            continue;
        }
        if settings.verified_only && !matches!(doc.verification.tier, Tier::Human | Tier::Owner) {
            continue;
        }
        // Pushed without a request, so the bar is higher than search's: never a flagged one.
        if flagged(&doc) {
            found.lane.flagged += 1;
            continue;
        }
        let score = if doc.status == Status::Draft {
            round4(raw * bundle.draft_factor)
        } else {
            raw
        };
        let best = chunks.swap_remove(0);
        scored.push((score, doc, best));
    }
    scored.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
    found.lane.items = scored
        .iter()
        .map(|(_, doc, best)| item(space, doc, best, bundle, request.now))
        .collect();
    Ok(found)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn a_passage_is_cut_at_a_line_boundary() {
        assert_eq!(cut("short", 10), ("short".to_owned(), false));
        let (text, was_cut) = cut("one\ntwo\nthree\nfour", 10);
        assert_eq!((text.as_str(), was_cut), ("one\ntwo", true));
        // One long line is cut at a character boundary, never inside a character.
        let (text, was_cut) = cut("ééééé", 5);
        assert_eq!((text.as_str(), was_cut), ("éé", true));
    }
}
