//! Drafting (phase 4 specification, section 4.5, with step 3c's amendment 1): a ready candidate as
//! one `knowledge-propose-batch` item, rendered through [`umbel_okf::draft`], the same functions
//! the knowledge plugin re-renders with to verify every claim before it stores the proposal
//! (section 3.2, owner decision 10). Nothing here is the curator's own text.
//!
//! - `change`: a `create` of the candidate's document (or its conflict set's), with
//!   [`umbel_okf::draft::render`] over the sources, `generated.by` naming the attested plugin and
//!   instance and `generated.at` the snapshot's settling instant; `Holds only` lists every
//!   constraint, so the limits a source stated survive into the document a person reads (S16);
//! - `rationale`: [`umbel_okf::draft::Rationale`] from the snapshot, fixed between runs;
//! - `evidence`: one `memory` entry per source, copying its principal, class, authority, origin,
//!   constraints, access, sensitivity and confirmation, with its observed sessions, the group's
//!   principals and an excerpt of its first 1000 characters;
//! - `derivedFrom`: each source by id and content hash (D81);
//! - `drafter`: `mode`, `candidate` and, for a promotion, `promotedBy`;
//! - `conflictSet`, for an alternative;
//! - `idempotency_key`: `<instance>/<candidate>/<drafts>`, so a rerun renders byte-equal input and
//!   gets the existing proposal back, and a changed source (a new draft count) a new key;
//! - `confidence`: the highest asserted, absent when no source asserts one.

use serde_json::{Value, json};
use umbel_okf::draft::{self, Draft, Rationale};
use umbel_store::MemoryRecord;

use crate::evaluate::{Candidate, Mode};

/// Who drafts: the plugin and instance the host attests for the run's steps (section 10.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Drafter<'a> {
    /// The plugin id, `curator`.
    pub plugin: &'a str,
    /// The curator instance.
    pub instance: &'a str,
}

/// The memory evidence entry for `record` (section 2.1), `principals` the distinct owners of the
/// draft's sources.
#[must_use]
pub fn evidence(record: &MemoryRecord, principals: u64) -> Value {
    json!({
        "kind": "memory",
        "ref": format!("{}@{}", record.id, record.record_version),
        "principal": record.scope.principal,
        "contentHash": record.content_hash,
        "class": record.class.as_str(),
        "authority": record.provenance.authority,
        "origin": record.provenance.origin,
        "constraints": record.provenance.constraints,
        "access": record.access.tokens(),
        "sensitivity": record.sensitivity,
        "confirmation": record.provenance.confirmation,
        "observations": { "sessions": record.observations.sessions, "principals": principals },
        "excerpt": draft::excerpt(&record.text),
    })
}

/// The rendered file of `candidate` for `drafter`, or `None` before it has settled.
#[must_use]
pub fn content(candidate: &Candidate, drafter: Drafter<'_>) -> Option<String> {
    let snapshot = candidate.snapshot?;
    let first = candidate.sources.first()?;
    Some(draft::render(&Draft {
        class: candidate.class,
        subject: &first.subject,
        text: &first.text,
        tags: candidate
            .sources
            .iter()
            .flat_map(|s| s.tags.iter().cloned())
            .collect(),
        constraints: candidate
            .sources
            .iter()
            .flat_map(|s| s.provenance.constraints.iter().flatten().cloned())
            .collect(),
        plugin: drafter.plugin,
        instance: drafter.instance,
        settled_at: snapshot.settled_at,
    }))
}

/// `candidate` as a `knowledge-propose-batch` item, or `None` when it has no snapshot or no
/// mode (it is not ready).
#[must_use]
pub fn item(candidate: &Candidate, drafter: Drafter<'_>) -> Option<Value> {
    let snapshot = candidate.snapshot?;
    let mode = candidate.mode.as_ref()?;
    let content = content(candidate, drafter)?;
    let rationale = Rationale {
        class: candidate.class,
        authority: snapshot.authority,
        sessions: snapshot.sessions,
        principals: snapshot.principals,
        settled_at: snapshot.settled_at,
    }
    .render();
    let mut claims = json!({ "mode": "scheduled", "candidate": candidate.id });
    if let Mode::Promoted { by } = mode {
        claims["mode"] = json!("promoted");
        claims["promotedBy"] = json!(by);
    }
    let mut item = json!({
        "idempotency_key": draft::idempotency_key(drafter.instance, &candidate.id, candidate.drafts),
        "change": { "op": "create", "doc": candidate.doc, "content": content },
        "rationale": rationale,
        "evidence": candidate
            .sources
            .iter()
            .map(|s| evidence(s, candidate.principals))
            .collect::<Vec<_>>(),
        "drafter": claims,
        "derivedFrom": candidate
            .sources
            .iter()
            .map(|s| json!({ "kind": "memory", "id": s.id, "contentHash": s.content_hash }))
            .collect::<Vec<_>>(),
    });
    // The highest asserted confidence; absent when no source asserts one, which the knowledge
    // plugin's `confidence` check requires (step 3c's amendment 5) and `null` would not pass.
    if let Some(confidence) = candidate.confidence {
        item["confidence"] = json!(confidence);
    }
    if let Some(set) = &candidate.conflict_set {
        item["conflictSet"] = json!(set);
    }
    Some(item)
}
