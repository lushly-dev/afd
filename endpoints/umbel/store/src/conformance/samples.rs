//! Builders for the documents and envelopes the suite writes. Public so a backend's own tests
//! write the same shapes.

use serde_json::Map;

use crate::{
    AccessSet, ContentHash, DocumentWrite, Envelope, Flag, Origin, Sensitivity, Status, Tier,
    Verification,
};

use super::SPACE;

/// An envelope for a write in [`SPACE`] by `trace`, observed at `at`, readable by `access`.
///
/// # Panics
/// When `access` holds an invalid token.
#[must_use]
pub fn envelope(access: &[&str], trace: &str, at: &str) -> Envelope {
    Envelope {
        version: 1,
        origin: Origin::DocumentDerived,
        space: SPACE.to_owned(),
        plugin: Some("suite".to_owned()),
        agent: None,
        principal: Some("human:local".to_owned()),
        session: None,
        trace_id: Some(trace.to_owned()),
        observed_at: at.to_owned(),
        valid_from: None,
        valid_until: None,
        confidence: None,
        authority: None,
        sources: None,
        generated: None,
        content_hash: None,
        derived_from: None,
        access: AccessSet::new(access.iter().copied())
            .map(|set| set.tokens().to_vec())
            .unwrap_or_default(),
        sensitivity: Some(Sensitivity::Internal),
    }
}

/// A document `id` (`<collection>/<path>`) with `text` as its bytes, readable by `access`,
/// written by call `trace`.
///
/// # Panics
/// When `id` has no `/` or `access` holds an invalid token.
#[must_use]
pub fn document(id: &str, access: &[&str], text: &str, trace: &str) -> DocumentWrite {
    let (collection, path) = id.split_once('/').unwrap_or((id, ""));
    let bytes = text.as_bytes().to_vec();
    let access_set = AccessSet::new(access.iter().copied()).unwrap_or_else(|_| {
        AccessSet::new(["space"]).unwrap_or_else(|_| unreachable!("`space` is a valid token"))
    });
    DocumentWrite {
        version: 1,
        id: id.to_owned(),
        space: SPACE.to_owned(),
        collection: collection.to_owned(),
        path: format!("{path}.md"),
        content_hash: ContentHash::of(&bytes),
        size: bytes.len() as u64,
        lines: text.lines().count() as u64,
        bytes,
        frontmatter: Map::new(),
        doc_type: "note".to_owned(),
        title: format!("Title of {id}"),
        description: None,
        tags: Vec::new(),
        aliases: Vec::new(),
        owners: Vec::new(),
        status: Status::Stable,
        stale_after: None,
        superseded_by: None,
        verification: Verification {
            tier: Tier::Unverified,
            last: None,
            count: 0,
        },
        access: access_set,
        sensitivity: Sensitivity::Internal,
        flags: Vec::<Flag>::new(),
        envelope: envelope(access, trace, "2026-11-02T10:00:00.000Z"),
    }
}
