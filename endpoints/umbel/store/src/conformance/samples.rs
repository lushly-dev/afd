//! Builders for the documents, envelopes and memory entries the suite writes. Public so a
//! backend's own tests write the same shapes.

use serde_json::Map;

use crate::memory::{
    DAY_MS, MemoryBatch, MemoryClass, MemoryScope, MemoryWrite, Millis, Quota, Retention,
    format_instant,
};
use crate::{
    AccessSet, Authority, ContentHash, DocumentWrite, Envelope, Flag, IndexChunk, Origin,
    Sensitivity, Status, Tier, Verification,
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
        redactions: None,
        constraints: None,
        confirmation: None,
        delegation_chain: None,
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

/// Chunk `ordinal` of document `doc` (`<collection>/<path>`), readable by `access`, with plain
/// defaults for everything a case does not set: a `note` in the collection, `stable`,
/// `unverified`, `internal`, no tags, no dates.
///
/// # Panics
/// When `doc` has no `/` or `access` holds an invalid token.
#[must_use]
pub fn chunk(doc: &str, ordinal: u32, title: &str, body: &str, access: &[&str]) -> IndexChunk {
    let (collection, path) = doc.split_once('/').unwrap_or((doc, ""));
    IndexChunk {
        doc: doc.to_owned(),
        ordinal,
        line_start: 1,
        line_end: u32::try_from(body.lines().count().max(1)).unwrap_or(1),
        heading_path: Vec::new(),
        chunk_hash: ContentHash::of(body.as_bytes()).to_string(),
        body: body.to_owned(),
        title: title.to_owned(),
        aliases: Vec::new(),
        description: None,
        code: None,
        tags: Vec::new(),
        owners: Vec::new(),
        doc_type: "note".to_owned(),
        collection: collection.to_owned(),
        status: "stable".to_owned(),
        verified: "unverified".to_owned(),
        sensitivity: "internal".to_owned(),
        lang: None,
        path: format!("{path}.md"),
        updated: None,
        stale_after: None,
        meta: serde_json::Map::new(),
        access: AccessSet::new(access.iter().copied())
            .unwrap_or_else(|_| unreachable!("the caller passes valid access tokens")),
    }
}

/// The memory suite's base instant, 2026-11-02T10:00:00.000Z.
pub const MEMORY_AT: Millis = 1_793_613_600_000;

/// The `n`th suite id: `mem-` and `n` as 24 hex digits.
#[must_use]
pub fn memory_id(n: u64) -> String {
    format!("mem-{n:024x}")
}

/// A semantic memory entry `memory_id(n)` owned by `owner`, readable by `access`, with
/// authority `agent`, valid from [`MEMORY_AT`] with no end, expiring 180 days later, no project
/// or session, and an envelope version 2 that agrees with it. Edit fields, then call
/// [`agree`] so the envelope follows.
///
/// # Panics
/// When `access` holds an invalid token.
#[must_use]
pub fn memory_entry(
    n: u64,
    owner: &str,
    access: &[&str],
    subject: &str,
    text: &str,
) -> MemoryWrite {
    let access_set = AccessSet::new(access.iter().copied())
        .unwrap_or_else(|_| unreachable!("the caller passes valid access tokens"));
    let mut envelope = envelope(access, "suite", &format_instant(MEMORY_AT));
    envelope.version = 2;
    envelope.origin = Origin::AgentInferred;
    envelope.authority = Some(Authority::Agent.as_str().to_owned());
    let mut entry = MemoryWrite {
        id: memory_id(n),
        class: MemoryClass::Semantic,
        scope: MemoryScope {
            space: SPACE.to_owned(),
            project: None,
            principal: owner.to_owned(),
            agent: None,
            session: None,
        },
        subject: subject.to_owned(),
        text: text.to_owned(),
        tags: Vec::new(),
        access: access_set,
        sensitivity: Sensitivity::Internal,
        flags: Vec::new(),
        valid_from: MEMORY_AT,
        valid_until: None,
        expires_at: MEMORY_AT + 180 * DAY_MS,
        supersedes: Vec::new(),
        renew: None,
        envelope,
    };
    agree(&mut entry);
    entry
}

/// Make an entry's envelope agree with its fields: principal, agent, session, intervals,
/// access and sensitivity.
pub fn agree(entry: &mut MemoryWrite) {
    let e = &mut entry.envelope;
    e.space = entry.scope.space.clone();
    e.principal = Some(entry.scope.principal.clone());
    e.agent = entry.scope.agent.clone();
    e.session = entry.scope.session.clone();
    e.valid_from = Some(format_instant(entry.valid_from));
    e.valid_until = entry.valid_until.map(format_instant);
    e.access = entry.access.tokens().to_vec();
    e.sensitivity = Some(entry.sensitivity);
}

/// Set an entry's authority.
pub fn set_authority(entry: &mut MemoryWrite, authority: Authority) {
    entry.envelope.authority = Some(authority.as_str().to_owned());
}

/// A batch at `at` with no keys, no quota and the default retention.
#[must_use]
pub fn memory_batch(at: Millis, entries: Vec<MemoryWrite>) -> MemoryBatch {
    MemoryBatch {
        idempotency: None,
        capture_key: None,
        at,
        quota: Quota::unlimited(),
        retention: Retention::default(),
        entries,
    }
}
