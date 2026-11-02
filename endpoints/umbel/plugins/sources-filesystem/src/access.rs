//! Permission mirroring, as far as phase 2 goes (specification section 5.3): a document's own
//! `access` key, else the nearest `.umbel-access.toml` in its directory or an ancestor up to the
//! root, else the collection's `access` and `sensitivity`.
//!
//! The filesystem carries no principals Umbel can map, so the permission a document gets is the
//! permission its content declares. A `.umbel-access.toml` that does not read is an error for
//! the files it governs, never a reason to make them more readable than it meant to.

use std::collections::BTreeMap;

use serde::Deserialize;
use umbel_sdk::{ContentEntry, Cx};
use umbel_store::{Sensitivity, validate_token};

use crate::collection::{Collection, short};

/// The file name that carries a directory's access rule.
pub(crate) const FILE_NAME: &str = ".umbel-access.toml";
/// The largest `.umbel-access.toml` read.
const MAX_BYTES: u64 = 64 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Raw {
    access: Option<Vec<String>>,
    sensitivity: Option<Sensitivity>,
}

/// A directory's rule.
#[derive(Debug, Clone)]
struct Rule {
    access: Option<Vec<String>>,
    sensitivity: Option<Sensitivity>,
}

/// What a document inherits when its own frontmatter says nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Inherit {
    pub(crate) access: Vec<String>,
    pub(crate) sensitivity: Sensitivity,
    /// A short digest of both, kept with the sync state so a change to a rule or to the
    /// collection's defaults is noticed without reading the file.
    pub(crate) key: String,
}

/// The key a file whose rule does not read carries in the sync state.
pub(crate) const INVALID_KEY: &str = "invalid";

fn parse(text: &str) -> Option<Rule> {
    let raw: Raw = toml::from_str(text).ok()?;
    if let Some(tokens) = &raw.access
        && (tokens.is_empty() || tokens.iter().any(|token| validate_token(token).is_err()))
    {
        return None;
    }
    Some(Rule {
        access: raw.access,
        sensitivity: raw.sensitivity,
    })
}

/// The access rules of one collection's directories.
#[derive(Debug, Default)]
pub(crate) struct Directories {
    /// Directory path (`""` for the root) to its rule, or `None` when the file does not read.
    rules: BTreeMap<String, Option<Rule>>,
}

impl Directories {
    /// Read every `.umbel-access.toml` among `entries`. `bytes` counts the bytes read against the
    /// call's cap.
    pub(crate) fn load(
        cx: &Cx,
        space: &str,
        collection: &str,
        entries: &[ContentEntry],
        bytes: &mut u64,
    ) -> Self {
        let mut rules = BTreeMap::new();
        for entry in entries {
            let (directory, name) = entry.path.rsplit_once('/').unwrap_or(("", &entry.path));
            if name != FILE_NAME {
                continue;
            }
            let rule = if entry.size > MAX_BYTES {
                None
            } else {
                match cx.content_read(space, collection, &entry.path) {
                    Ok(content) => {
                        *bytes += content.len() as u64;
                        String::from_utf8(content)
                            .ok()
                            .and_then(|text| parse(&text))
                    }
                    Err(_) => None,
                }
            };
            rules.insert(directory.to_owned(), rule);
        }
        Self { rules }
    }

    /// What the file at `path` inherits: the nearest rule up the tree, with the collection's
    /// values for what the rule leaves out. `None` when that rule does not read.
    pub(crate) fn inherit(&self, path: &str, collection: &Collection) -> Option<Inherit> {
        let mut directory = path.rsplit_once('/').map_or("", |(directory, _)| directory);
        let rule = loop {
            if let Some(rule) = self.rules.get(directory) {
                break rule.as_ref()?.clone();
            }
            match directory.rsplit_once('/') {
                Some((parent, _)) => directory = parent,
                None if !directory.is_empty() => directory = "",
                None => {
                    break Rule {
                        access: None,
                        sensitivity: None,
                    };
                }
            }
        };
        let access = rule
            .access
            .unwrap_or_else(|| collection.info.access.clone());
        let sensitivity = rule.sensitivity.unwrap_or(collection.sensitivity);
        let mut sorted = access.clone();
        sorted.sort();
        sorted.dedup();
        let key = short(
            &umbel_store::ContentHash::of(format!("{sorted:?}|{sensitivity:?}").as_bytes())
                .to_string(),
        );
        Some(Inherit {
            access: sorted,
            sensitivity,
            key,
        })
    }
}
