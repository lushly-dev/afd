//! What a result may say: totals for everything, ids only for what the caller can read, paths
//! only to a person at the command line.

use std::collections::BTreeMap;

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError};
use umbel_store::ListQuery;

/// The most ids a result lists per collection; the rest are counted.
pub(crate) const LISTED: usize = 100;
/// The most paths a result lists to a person at the command line.
pub(crate) const LISTED_PATHS: usize = 100;

/// A person at the command line: the one caller who can read the files anyway.
pub(crate) fn is_person_at_cli(cx: &Cx) -> bool {
    let call = cx.call();
    call.interface == "cli" && call.actor_kind == "human"
}

/// Whether the caller's reader filter admits the stored document `id` of `collection`.
pub(crate) fn readable(
    cx: &Cx,
    space: &str,
    collection: &str,
    id: &str,
) -> Result<bool, HostError> {
    let page = cx.doc_list(
        space,
        &ListQuery {
            collection: Some(collection.to_owned()),
            prefix: Some(id.to_owned()),
            doc_type: None,
            after: None,
            limit: 1,
        },
    )?;
    // Ids are ordered, and an id sorts before every id it is a prefix of.
    Ok(page.items.first().is_some_and(|meta| meta.id == id))
}

/// The ids of changed documents the caller can read, and how many more there are.
#[derive(Debug, Default)]
pub(crate) struct Changes {
    listed: Vec<(String, &'static str)>,
    more: usize,
}

impl Changes {
    pub(crate) fn add(&mut self, id: &str, change: &'static str) {
        if self.listed.len() < LISTED {
            self.listed.push((id.to_owned(), change));
        } else {
            self.more += 1;
        }
    }

    pub(crate) fn json(&self) -> (Value, usize) {
        let listed = self
            .listed
            .iter()
            .map(|(id, change)| json!({ "id": id, "change": change }))
            .collect();
        (Value::Array(listed), self.more)
    }
}

/// Files that were not turned into documents, by the warning code that says why.
#[derive(Debug, Default)]
pub(crate) struct Skips {
    reasons: BTreeMap<String, usize>,
    paths: Vec<String>,
}

impl Skips {
    pub(crate) fn add(&mut self, code: &str, path: &str) {
        *self.reasons.entry(code.to_owned()).or_default() += 1;
        if self.paths.len() < LISTED_PATHS {
            self.paths.push(path.to_owned());
        }
    }

    pub(crate) fn total(&self) -> usize {
        self.reasons.values().sum()
    }

    pub(crate) fn reasons(&self) -> &BTreeMap<String, usize> {
        &self.reasons
    }

    pub(crate) fn paths(&self) -> &[String] {
        &self.paths
    }
}

/// Counts of the flags the documents of a run got, and the readable ids of the ones to warn about.
#[derive(Debug, Default)]
pub(crate) struct Flagged {
    pub(crate) counts: BTreeMap<&'static str, usize>,
    pub(crate) ids: BTreeMap<&'static str, Vec<String>>,
}

impl Flagged {
    pub(crate) fn count(&mut self, flag: &'static str) {
        *self.counts.entry(flag).or_default() += 1;
    }

    /// Note a readable document for the warning `code`, up to a few ids.
    pub(crate) fn note_readable(&mut self, code: &'static str, id: &str) {
        let list = self.ids.entry(code).or_default();
        if list.len() < 20 {
            list.push(id.to_owned());
        }
    }
}
