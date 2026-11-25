//! Cross-library pattern implementation aggregation (Patterns spec §6.8, Amendment A31.1).
//!
//! A pattern record in one library lists only same-library implementations; components in other
//! libraries claim that pattern via their own `patterns[]` array. At read time Umbel aggregates
//! every claiming component and complete saved copy across all touched libraries into one index
//! keyed by `(owning_library, pattern)`, ordered with the owning library first.

use std::collections::BTreeMap;

use super::Library;
use super::schema_pattern::{ImplementationContexts, KeepBasis};

/// One implementation of a pattern aggregated across touched libraries.
#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)]
pub(crate) struct AggregatedImplementation {
    pub(crate) library: String,
    pub(crate) kind: &'static str,
    pub(crate) tag: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) linkage: &'static str,
    pub(crate) status: String,
    pub(crate) replaced_by: Option<String>,
    pub(crate) contexts: Option<ImplementationContexts>,
    pub(crate) keep: Vec<KeepBasis>,
    pub(crate) revision: Option<String>,
}

impl AggregatedImplementation {
    #[allow(dead_code)]
    pub(crate) fn item_name(&self) -> &str {
        self.tag
            .as_deref()
            .or(self.name.as_deref())
            .unwrap_or_default()
    }
}

/// Aggregates every claiming component and saved copy across `libraries`, keyed by
/// `(owning_library, pattern)`.
///
/// Within each pattern, implementations are sorted owning-library first, then by
/// `(library, kind, tag_or_name)` ascending (`component` before `copy`).
#[allow(dead_code)]
pub(crate) fn aggregate_implementations(
    libraries: &[Library],
) -> BTreeMap<(String, String), Vec<AggregatedImplementation>> {
    let mut index: BTreeMap<(String, String), Vec<AggregatedImplementation>> = BTreeMap::new();

    for lib in libraries {
        for pattern in &lib.patterns {
            index
                .entry((lib.id.clone(), pattern.pattern.clone()))
                .or_default();
        }
        for record in &lib.records {
            for claim in &record.patterns {
                index
                    .entry((claim.library.clone(), claim.pattern.clone()))
                    .or_default()
                    .push(AggregatedImplementation {
                        library: lib.id.clone(),
                        kind: "component",
                        tag: Some(record.tag.clone()),
                        name: None,
                        linkage: "instance",
                        status: record.status.clone(),
                        replaced_by: record.replaced_by.clone(),
                        contexts: claim.contexts.clone(),
                        keep: claim.keep.clone(),
                        revision: None,
                    });
            }
        }
        for copy in &lib.copies {
            index
                .entry((lib.id.clone(), copy.pattern.clone()))
                .or_default()
                .push(AggregatedImplementation {
                    library: lib.id.clone(),
                    kind: "copy",
                    tag: None,
                    name: Some(copy.name.clone()),
                    linkage: "copy",
                    status: copy.status.clone(),
                    replaced_by: copy.replaced_by.clone(),
                    contexts: copy.contexts.clone(),
                    keep: copy.keep.clone(),
                    revision: Some(copy.revision.clone()),
                });
        }
    }

    for ((owning_library, _), entries) in &mut index {
        entries.sort_by(|a, b| {
            let a_foreign = a.library != *owning_library;
            let b_foreign = b.library != *owning_library;
            (a_foreign, a.library.as_str(), a.kind, a.item_name()).cmp(&(
                b_foreign,
                b.library.as_str(),
                b.kind,
                b.item_name(),
            ))
        });
    }

    index
}
