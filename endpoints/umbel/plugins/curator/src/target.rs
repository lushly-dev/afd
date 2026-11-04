//! Where a space's drafts go (phase 4 specification, section 4.5, with step 3c's amendment 14):
//! `[plugins.curator.config.spaces.<space>]` names a markdown collection and an optional prefix,
//! and a draft's document is `<collection>/<prefix>/<derived id>`. The knowledge instance's
//! drafter entry must name the same target and is the one enforced, so a curator configured
//! otherwise has its creates refused, never written elsewhere.
//!
//! The collection's access set and sensitivity are the workspace's, learned through the optional
//! `content` grant's collection list (no file is read; step 4, amendment 1): section 5.1's rule
//! compares them with each source's.

use serde_json::Value;
use umbel_sdk::{Cx, HostError, Outcome};
use umbel_store::Sensitivity;

use crate::fail;

/// A space's target, resolved against the workspace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    /// A markdown collection of the space.
    pub collection: String,
    /// The fixed prefix inside it, if any: [`umbel_okf::draft::is_safe_prefix`].
    pub prefix: Option<String>,
    /// The collection's resolved access set: who can read a document created there, and so a
    /// proposal targeting it.
    pub access: Vec<String>,
    /// The collection's sensitivity.
    pub sensitivity: Sensitivity,
}

impl Target {
    /// The document a candidate (or a conflict set) with `id` is drafted as:
    /// [`umbel_okf::draft::document_id`].
    #[must_use]
    pub fn document_id(&self, id: &str) -> String {
        umbel_okf::draft::document_id(&self.collection, self.prefix.as_deref(), id)
    }
}

/// The configured collection and prefix of `space`, before the workspace is asked.
fn configured(config: &Value, space: &str) -> Result<(String, Option<String>), Outcome> {
    let Some(entry) = config.get("spaces").and_then(|spaces| spaces.get(space)) else {
        return Err(fail::target_unconfigured(
            "unconfigured",
            "[plugins.curator.config.spaces.<space>] names no target for this space",
        ));
    };
    let collection = entry
        .get("collection")
        .and_then(Value::as_str)
        .filter(|id| umbel_store::is_slug(id))
        .map(str::to_owned)
        .ok_or_else(|| {
            fail::target_unconfigured("unconfigured", "the target names no valid collection")
        })?;
    // The configuration schema already held the prefix's shape at load; one that is not a safe
    // prefix reads as no target, never as a wider one.
    let prefix = match entry.get("prefix") {
        None | Some(Value::Null) => None,
        Some(Value::String(prefix)) if umbel_okf::draft::is_safe_prefix(prefix) => {
            Some(prefix.clone())
        }
        Some(_) => {
            return Err(fail::target_unconfigured(
                "unconfigured",
                "the target's prefix is not one to eight plain segments",
            ));
        }
    };
    Ok((collection, prefix))
}

/// The target of `space`, resolved: configured, a markdown collection of the space, with its
/// access set and sensitivity.
pub(crate) fn resolve(cx: &Cx, config: &Value, space: &str) -> Result<Target, Outcome> {
    let (collection, prefix) = configured(config, space)?;
    let collections = match cx.content_collections(space) {
        Ok(collections) => collections,
        Err(HostError::NotGranted(_)) => {
            return Err(fail::target_unconfigured(
                "collection-unknown",
                "the content grant is withheld, so the target collection's readers cannot be learned",
            ));
        }
        Err(error) => return Err(fail::host(&error)),
    };
    let Some(info) = collections.into_iter().find(|info| info.id == collection) else {
        return Err(fail::target_unconfigured(
            "collection-missing",
            "the space declares no such collection",
        ));
    };
    if info.kind != "markdown" {
        return Err(fail::target_unconfigured(
            "not-markdown",
            "the target collection is not a markdown collection",
        ));
    }
    let sensitivity = serde_json::from_value(Value::String(info.sensitivity.clone()))
        .map_err(|_| fail::target_unconfigured("collection-unknown", "unknown sensitivity"))?;
    let mut access = info.access;
    access.sort();
    access.dedup();
    Ok(Target {
        collection,
        prefix,
        access,
        sensitivity,
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_target_is_configured_per_space_with_a_safe_prefix() {
        let config =
            json!({ "spaces": { "main": { "collection": "notes", "prefix": "learned/facts" } } });
        assert_eq!(
            configured(&config, "main").ok(),
            Some(("notes".to_owned(), Some("learned/facts".to_owned())))
        );
        assert!(configured(&config, "beta").is_err());
        for bad in ["../x", "a/", "/a", "A", "a/./b", ""] {
            let config = json!({ "spaces": { "main": { "collection": "notes", "prefix": bad } } });
            assert!(configured(&config, "main").is_err(), "{bad}");
        }
        let none = json!({ "spaces": { "main": { "collection": "notes" } } });
        assert_eq!(
            configured(&none, "main").ok(),
            Some(("notes".to_owned(), None))
        );
    }

    #[test]
    fn the_document_id_is_the_shared_derivation() {
        let target = Target {
            collection: "notes".into(),
            prefix: Some("learned".into()),
            access: vec!["space".into()],
            sensitivity: Sensitivity::Internal,
        };
        assert_eq!(
            target.document_id("c-0123456789abcdef0123"),
            "notes/learned/c-0123456789abcdef0123"
        );
    }
}
