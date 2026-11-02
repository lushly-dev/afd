//! Provenance envelope, version 1 (specification section 2.1), as the store sees it.

use serde::{Deserialize, Serialize};

use crate::access::AccessSet;
use crate::error::{Result, StoreError};

/// The envelope version this crate writes.
pub const ENVELOPE_VERSION: u32 = 1;

/// Most `sources` and `derivedFrom` entries an envelope may list.
pub const MAX_ENVELOPE_LIST: usize = 64;

/// How a record came to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Origin {
    /// A person said it.
    UserStated,
    /// An agent inferred it.
    AgentInferred,
    /// It was read out of a document.
    DocumentDerived,
    /// Nobody said. The store refuses it (principle 7).
    Unspecified,
}

/// How sensitive a record is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sensitivity {
    /// Anyone.
    Public,
    /// The default.
    Internal,
    /// Limited.
    Confidential,
    /// Tightly limited.
    Restricted,
}

/// AFD's actor kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActorKind {
    /// A person.
    Human,
    /// A model-driven agent.
    Agent,
    /// A service.
    Service,
    /// A script.
    Script,
    /// A test.
    Test,
}

/// AFD's `Actor`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Actor {
    /// The kind.
    pub kind: ActorKind,
    /// The actor's id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// A display label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// The person acted for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_behalf_of: Option<String>,
}

/// An OKF `{ by, at }` pair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ByAt {
    /// The actor.
    pub by: String,
    /// An ISO 8601 datetime with a UTC offset.
    pub at: String,
}

/// One OKF `sources` entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    /// Where the claim came from.
    pub resource: String,
    /// An id in that resource.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// A title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// An author.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// When the resource last changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<String>,
}

/// A record this one was derived from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DerivedFrom {
    /// The record's kind.
    pub kind: String,
    /// Its id.
    pub id: String,
    /// Its content hash, `sha256:<hex>`.
    pub content_hash: String,
}

/// The provenance envelope, version 1. The reserved fields `redactions`, `delegationChain` and
/// `tenant` are refused when parsing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Envelope {
    /// Always 1.
    pub version: u32,
    /// How the record came to be.
    pub origin: Origin,
    /// The space.
    pub space: String,
    /// The plugin instance whose command produced the record; `null` for host built-ins.
    pub plugin: Option<String>,
    /// The actor, when an agent, service or script.
    pub agent: Option<Actor>,
    /// The effective principal string, such as `human:local`.
    pub principal: Option<String>,
    /// The session.
    pub session: Option<String>,
    /// The call's trace id.
    pub trace_id: Option<String>,
    /// When the call observed it (the command context's clock).
    pub observed_at: String,
    /// Validity start.
    pub valid_from: Option<String>,
    /// Validity end.
    pub valid_until: Option<String>,
    /// 0 to 1.
    pub confidence: Option<f64>,
    /// Open string in version 1.
    pub authority: Option<String>,
    /// The OKF sources.
    pub sources: Option<Vec<Source>>,
    /// OKF `generated`.
    pub generated: Option<ByAt>,
    /// `sha256:<hex>` of the record's bytes.
    pub content_hash: Option<String>,
    /// The records this was derived from.
    pub derived_from: Option<Vec<DerivedFrom>>,
    /// The access set; empty means missing, which the store refuses.
    #[serde(default)]
    pub access: Vec<String>,
    /// The sensitivity; `None` means missing, which the store refuses.
    #[serde(default)]
    pub sensitivity: Option<Sensitivity>,
}

impl Envelope {
    /// Parse an envelope from JSON, refusing unknown and reserved fields.
    ///
    /// # Errors
    /// [`StoreError::Invalid`] with the parser's message.
    pub fn from_value(value: serde_json::Value) -> Result<Self> {
        serde_json::from_value(value)
            .map_err(|e| StoreError::invalid(format!("provenance envelope: {e}")))
    }

    /// The envelope's checks for a store write in `space` (section 2.1): version 1, an origin
    /// that is not `unspecified`, a non-empty valid access set and a sensitivity, a matching
    /// space, a principal string and list sizes within bounds. Returns the normalised access
    /// set.
    ///
    /// # Errors
    /// [`StoreError::Invalid`] naming the first rule broken.
    pub fn check(&self, space: &str) -> Result<AccessSet> {
        let refuse = |rule: &str| Err(StoreError::invalid(format!("provenance envelope: {rule}")));
        if self.version != ENVELOPE_VERSION {
            return refuse("version must be 1");
        }
        if self.origin == Origin::Unspecified {
            return refuse("origin must not be `unspecified`");
        }
        if self.space != space {
            return refuse("space must be the store's space");
        }
        if self.sensitivity.is_none() {
            return refuse("sensitivity is required");
        }
        if self.access.is_empty() {
            return refuse("access is required and never empty");
        }
        if self.observed_at.is_empty() {
            return refuse("observedAt is required");
        }
        if self.confidence.is_some_and(|c| !(0.0..=1.0).contains(&c)) {
            return refuse("confidence must be between 0 and 1");
        }
        if self
            .sources
            .as_ref()
            .is_some_and(|s| s.len() > MAX_ENVELOPE_LIST)
            || self
                .derived_from
                .as_ref()
                .is_some_and(|s| s.len() > MAX_ENVELOPE_LIST)
        {
            return refuse("sources and derivedFrom hold at most 64 entries");
        }
        if let Some(hash) = &self.content_hash {
            crate::canonical::ContentHash::parse(hash)?;
        }
        for entry in self.derived_from.iter().flatten() {
            crate::canonical::ContentHash::parse(&entry.content_hash)?;
        }
        if let Some(principal) = &self.principal {
            let (kind, id) = principal.split_once(':').unwrap_or(("", ""));
            let valid = matches!(kind, "human" | "agent" | "service" | "script")
                && (1..=128).contains(&id.chars().count())
                && !id.chars().any(char::is_control);
            if !valid {
                return refuse("principal must be <kind>:<id>");
            }
        }
        AccessSet::new(self.access.iter().cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn envelope() -> Envelope {
        Envelope::from_value(json!({
            "version": 1, "origin": "document-derived", "space": "main", "plugin": null,
            "agent": null, "principal": "human:local", "session": null, "traceId": "t",
            "observedAt": "2026-11-02T10:15:00.000Z", "validFrom": null, "validUntil": null,
            "confidence": null, "authority": null, "sources": null, "generated": null,
            "contentHash": null, "derivedFrom": null, "access": ["space"], "sensitivity": "internal"
        }))
        .unwrap()
    }

    #[test]
    fn a_complete_envelope_passes() {
        assert_eq!(envelope().check("main").unwrap().tokens(), ["space"]);
    }

    #[test]
    fn the_store_refuses_what_section_2_1_names() {
        let mut e = envelope();
        e.origin = Origin::Unspecified;
        assert!(e.check("main").is_err());
        let mut e = envelope();
        e.access.clear();
        assert!(e.check("main").is_err());
        let mut e = envelope();
        e.sensitivity = None;
        assert!(e.check("main").is_err());
        assert!(envelope().check("other").is_err());
    }

    #[test]
    fn reserved_fields_do_not_parse() {
        let mut value = serde_json::to_value(envelope()).unwrap();
        value["tenant"] = json!("x");
        assert!(Envelope::from_value(value).is_err());
    }
}
