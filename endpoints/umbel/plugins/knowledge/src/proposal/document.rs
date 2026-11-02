//! The document an applied proposal becomes: the file's bytes read the way the sources plugin
//! reads a file, with the proposal as its lineage (specification section 9.2).

use std::collections::BTreeSet;

use serde_json::Value;
use umbel_okf::frontmatter::Declared;
use umbel_okf::{Ingest, Kind, analyze};
use umbel_sdk::CollectionInfo;
use umbel_store::{
    AccessSet, ContentHash, DerivedFrom, Document, DocumentWrite, Envelope, Flag, Origin,
    Sensitivity, Source,
};

use super::model::Proposal;

/// Why the file cannot become a document.
#[derive(Debug)]
pub(crate) enum Problem {
    /// The frontmatter does not read.
    Frontmatter(&'static str),
    /// The file's own `access` key is not a list of valid tokens.
    Access,
}

/// What the document inherits when the file says nothing: the stored document's access set and
/// sensitivity for an existing one, the collection's for a new one.
pub(crate) struct Inherit {
    pub(crate) access: Vec<String>,
    pub(crate) sensitivity: Sensitivity,
    /// The flags the previous version had that reading the file cannot recompute.
    pub(crate) kept_flags: BTreeSet<Flag>,
}

impl Inherit {
    pub(crate) fn of_document(document: &Document) -> Self {
        Self {
            access: document.write.access.tokens().to_vec(),
            sensitivity: document.write.sensitivity,
            kept_flags: document
                .write
                .flags
                .iter()
                .copied()
                .filter(|flag| matches!(flag, Flag::SchemaInvalid | Flag::BrokenLinks))
                .collect(),
        }
    }

    pub(crate) fn of_collection(info: &CollectionInfo) -> Self {
        Self {
            access: info.access.clone(),
            sensitivity: serde_json::from_value(Value::String(info.sensitivity.clone()))
                .unwrap_or(Sensitivity::Internal),
            kept_flags: BTreeSet::new(),
        }
    }
}

/// The document `bytes` of `file` make for `proposal`, applied at revision-to-be by the call.
///
/// `record_hash` is the hash of the proposal record this write derives from.
pub(crate) fn build(
    proposal: &Proposal,
    bytes: Vec<u8>,
    file: &str,
    default_type: &str,
    inherit: &Inherit,
    record_hash: &str,
    origin: Origin,
) -> Result<DocumentWrite, Problem> {
    let analysis = analyze(&Ingest::new(&bytes, file, Kind::Markdown, default_type))
        .map_err(|problem| Problem::Frontmatter(problem.reason()))?;
    let access_tokens = match &analysis.access {
        Declared::Set(tokens) => tokens.clone(),
        Declared::Absent => inherit.access.clone(),
        Declared::Invalid => return Err(Problem::Access),
        _ => inherit.access.clone(),
    };
    let access = AccessSet::new(access_tokens).map_err(|_| Problem::Access)?;
    let sensitivity = analysis.sensitivity.unwrap_or(inherit.sensitivity);
    let (collection, _) = proposal.change.doc.split_once('/').unwrap_or_default();
    let hash = ContentHash::of(&bytes);
    let mut flags: BTreeSet<Flag> = analysis.flags.clone();
    flags.extend(inherit.kept_flags.iter().copied());

    let sources: Vec<Source> = proposal
        .evidence
        .iter()
        .filter(|entry| entry.get("kind").and_then(Value::as_str) == Some("document"))
        .filter_map(|entry| entry.get("ref").and_then(Value::as_str))
        .map(|reference| Source {
            resource: format!("/{reference}"),
            id: None,
            title: None,
            author: None,
            last_modified: None,
        })
        .take(64)
        .collect();
    let envelope = Envelope {
        version: 1,
        origin,
        space: proposal.space.clone(),
        plugin: None,
        agent: None,
        principal: None,
        session: proposal.proposer.run.clone(),
        trace_id: None,
        observed_at: proposal.updated_at.clone(),
        valid_from: None,
        valid_until: None,
        confidence: proposal.confidence,
        authority: None,
        sources: (!sources.is_empty()).then_some(sources),
        generated: analysis.generated.clone(),
        content_hash: Some(hash.to_string()),
        derived_from: Some(vec![DerivedFrom {
            kind: "proposal".to_owned(),
            id: proposal.id.clone(),
            content_hash: record_hash.to_owned(),
        }]),
        access: access.tokens().to_vec(),
        sensitivity: Some(sensitivity),
    };
    Ok(DocumentWrite {
        version: 1,
        id: proposal.change.doc.clone(),
        space: proposal.space.clone(),
        collection: collection.to_owned(),
        path: file.to_owned(),
        envelope,
        content_hash: hash,
        size: bytes.len() as u64,
        bytes,
        frontmatter: analysis.frontmatter.clone(),
        doc_type: analysis.doc_type.clone(),
        title: analysis.title.clone(),
        description: analysis.description.clone(),
        tags: analysis.tags.clone(),
        aliases: analysis.aliases.clone(),
        owners: analysis.owners.clone(),
        status: analysis.status,
        stale_after: analysis.stale_after.clone(),
        superseded_by: analysis.superseded_by.clone(),
        verification: analysis.verification.clone(),
        access,
        sensitivity,
        flags: flags.into_iter().collect(),
        lines: analysis.lines,
    })
}
