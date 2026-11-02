//! A file read, as the document record version 1 (specification section 5.4).

use std::collections::{BTreeSet, HashSet};

use jsonschema::Validator;
use serde_json::Value;
use umbel_okf::links::{Target, resolve};
use umbel_okf::{Analysis, Kind};
use umbel_store::{
    AccessSet, ContentHash, DocumentWrite, Envelope, Flag, Origin, Sensitivity, Source,
};

use crate::collection::Collection;

/// The envelope of a document written from a file. The host fills `space`, `plugin`, `agent`,
/// `principal`, `traceId` and `observedAt` from the call.
pub(crate) fn envelope(
    collection: &str,
    path: &str,
    analysis: &Analysis,
    hash: &ContentHash,
    access: &AccessSet,
    sensitivity: Sensitivity,
) -> Envelope {
    Envelope {
        version: 1,
        origin: Origin::DocumentDerived,
        space: String::new(),
        plugin: None,
        agent: None,
        principal: None,
        session: None,
        trace_id: None,
        observed_at: "1970-01-01T00:00:00.000Z".to_owned(),
        valid_from: None,
        valid_until: None,
        confidence: None,
        authority: None,
        sources: Some(vec![Source {
            resource: format!("/{collection}/{path}"),
            id: None,
            title: None,
            author: None,
            last_modified: None,
        }]),
        generated: analysis.generated.clone(),
        content_hash: Some(hash.to_string()),
        derived_from: None,
        access: access.tokens().to_vec(),
        sensitivity: Some(sensitivity),
    }
}

/// What a document is built from.
pub(crate) struct Parts<'a> {
    pub(crate) space: &'a str,
    pub(crate) collection: &'a Collection,
    pub(crate) id: &'a str,
    pub(crate) path: &'a str,
    pub(crate) bytes: Vec<u8>,
    pub(crate) hash: ContentHash,
    pub(crate) analysis: &'a Analysis,
    /// The flags reading set plus the ones the sync adds (`schema-invalid`, `broken-links`).
    pub(crate) flags: &'a BTreeSet<Flag>,
    pub(crate) access: &'a AccessSet,
    pub(crate) sensitivity: Sensitivity,
}

/// The document a file becomes.
pub(crate) fn build(parts: Parts<'_>) -> DocumentWrite {
    let Parts {
        space,
        collection,
        id,
        path,
        bytes,
        hash,
        analysis,
        flags,
        access,
        sensitivity,
    } = parts;
    DocumentWrite {
        version: 1,
        id: id.to_owned(),
        space: space.to_owned(),
        collection: collection.info.id.clone(),
        path: path.to_owned(),
        envelope: envelope(
            &collection.info.id,
            path,
            analysis,
            &hash,
            access,
            sensitivity,
        ),
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
        access: access.clone(),
        sensitivity,
        flags: flags.iter().copied().collect(),
        lines: analysis.lines,
    }
}

/// The frontmatter schema, compiled.
pub(crate) struct Schema {
    validator: Validator,
    /// The pack file's bytes, for the collection digest.
    pub(crate) bytes: Vec<u8>,
}

impl Schema {
    /// Compile the pack's `data/schema.json`.
    pub(crate) fn compile(bytes: Vec<u8>) -> Result<Self, String> {
        let schema: Value = serde_json::from_slice(&bytes)
            .map_err(|error| format!("data/schema.json is not JSON: {error}"))?;
        let validator = jsonschema::validator_for(&schema)
            .map_err(|error| format!("data/schema.json is not a JSON Schema: {error}"))?;
        Ok(Self { validator, bytes })
    }

    /// Whether the frontmatter satisfies the schema.
    pub(crate) fn accepts(&self, frontmatter: &serde_json::Map<String, Value>) -> bool {
        self.validator.is_valid(&Value::Object(frontmatter.clone()))
    }
}

/// Whether a document holds a link that resolves to nothing: to a document of its own collection
/// that is not among `ids`, or to a heading of itself that does not exist. A link into another
/// collection is not judged here: the sync of that collection may not have run.
pub(crate) fn has_broken_links(
    analysis: &Analysis,
    id: &str,
    ids: &HashSet<String>,
    collections: &[String],
) -> bool {
    let own = id.split_once('/').map_or(id, |(collection, _)| collection);
    analysis
        .structure
        .links
        .iter()
        .any(|link| match resolve(&link.target, id, collections) {
            Target::Document {
                id: target,
                fragment: _,
            } => {
                target
                    .split_once('/')
                    .is_some_and(|(collection, _)| collection == own)
                    && !ids.contains(&target)
            }
            Target::Fragment(fragment) => {
                analysis.structure.heading_by_slug(&fragment).is_none()
                    && analysis
                        .structure
                        .heading_by_slug(&fragment.to_ascii_lowercase())
                        .is_none()
            }
            _ => false,
        })
}

/// A code file has no frontmatter and no links.
pub(crate) fn checks_frontmatter(kind: Kind) -> bool {
    kind == Kind::Markdown
}
