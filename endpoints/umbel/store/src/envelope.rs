//! Provenance envelope, versions 1 and 2 (phase 2 specification section 2.1, phase 3
//! specification section 2.1), as the store sees it.
//!
//! Version 2 closes `authority`, gives `redactions` its meaning and adds `constraints` and
//! `confirmation`. A row written in version 1 is read, and written back out, in version 1.

use serde::ser::SerializeMap;
use serde::{Deserialize, Serialize, Serializer};

use crate::access::AccessSet;
use crate::error::{Result, StoreError};

/// The envelope version this crate writes.
pub const ENVELOPE_VERSION: u32 = 2;

/// Most `sources` and `derivedFrom` entries an envelope may list.
pub const MAX_ENVELOPE_LIST: usize = 64;
/// Most `redactions` entries a version 2 envelope may list.
pub const MAX_REDACTIONS: usize = 32;
/// Most `constraints` a version 2 envelope may list.
pub const MAX_CONSTRAINTS: usize = 16;
/// The longest constraint, in characters.
pub const MAX_CONSTRAINT_CHARS: usize = 200;

/// What the host can vouch for about a record's source (envelope version 2, D71). Version 1
/// left `authority` open, so [`Envelope::authority`] stays a string and this is its closed set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Authority {
    /// A person at a terminal, or an embedder's person (phase 3 section 3.3). Not an
    /// attestation.
    Person,
    /// An agent.
    Agent,
    /// A tool or script acting for a person who was not asked.
    Tool,
    /// A captured transcript.
    Transcript,
    /// An import.
    Import,
    /// A document.
    Document,
    /// Something outside the deployment.
    External,
}

impl Authority {
    /// The authority's tier, lower first: `person`, `tool`, `agent`, `import`, `transcript` (the
    /// order phase 3 section 9.3 places memory in), then `document` and `external`, which a
    /// person never pushes. Recall breaks a tie of scores by it (phase 5 section 9.2).
    #[must_use]
    pub fn tier(self) -> u8 {
        match self {
            Self::Person => 0,
            Self::Tool => 1,
            Self::Agent => 2,
            Self::Import => 3,
            Self::Transcript => 4,
            Self::Document => 5,
            Self::External => 6,
        }
    }

    /// Every authority, in the order the specification lists them.
    pub const ALL: [Self; 7] = [
        Self::Person,
        Self::Agent,
        Self::Tool,
        Self::Transcript,
        Self::Import,
        Self::Document,
        Self::External,
    ];

    /// The wire spelling.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Person => "person",
            Self::Agent => "agent",
            Self::Tool => "tool",
            Self::Transcript => "transcript",
            Self::Import => "import",
            Self::Document => "document",
            Self::External => "external",
        }
    }

    /// The authority spelled `text`, or `None`.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|a| a.as_str() == text)
    }
}

/// One `redactions` entry: what hygiene masked, by kind, and how often. Never the text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Redaction {
    /// The secret kind, such as `private-key`.
    pub kind: String,
    /// How many were masked; at least 1.
    pub count: u64,
}

/// `confirmation`: a person vouching for a memory (`memory-confirm`). Filled only by the host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Confirmation {
    /// The principal string of the person who confirmed.
    pub by: String,
    /// When, RFC 3339.
    pub at: String,
    /// The authority the record had before.
    pub prior_authority: Authority,
}

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

/// The provenance envelope, version 1 or 2. The reserved fields `delegationChain` and `tenant`
/// are refused when parsing. A version 1 envelope has no `redactions`, `constraints` or
/// `confirmation`, and is serialised without them.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Envelope {
    /// 1 or 2; this crate writes [`ENVELOPE_VERSION`].
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
    /// Open in version 1; one of [`Authority`] or `None` in version 2. Documents and records
    /// keep `None`, meaning not applicable; the memory store refuses `None` (phase 3 step 2).
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
    /// Version 2: what hygiene masked, sorted by kind, at most [`MAX_REDACTIONS`].
    #[serde(default)]
    pub redactions: Option<Vec<Redaction>>,
    /// Version 2: limits the source stated on use, at most [`MAX_CONSTRAINTS`] of at most
    /// [`MAX_CONSTRAINT_CHARS`] characters.
    #[serde(default)]
    pub constraints: Option<Vec<String>>,
    /// Version 2: filled only by the host, for `memory-confirm`.
    #[serde(default)]
    pub confirmation: Option<Confirmation>,
}

impl Serialize for Envelope {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let v2 = self.version >= 2;
        let mut map = serializer.serialize_map(Some(if v2 { 22 } else { 19 }))?;
        map.serialize_entry("version", &self.version)?;
        map.serialize_entry("origin", &self.origin)?;
        map.serialize_entry("space", &self.space)?;
        map.serialize_entry("plugin", &self.plugin)?;
        map.serialize_entry("agent", &self.agent)?;
        map.serialize_entry("principal", &self.principal)?;
        map.serialize_entry("session", &self.session)?;
        map.serialize_entry("traceId", &self.trace_id)?;
        map.serialize_entry("observedAt", &self.observed_at)?;
        map.serialize_entry("validFrom", &self.valid_from)?;
        map.serialize_entry("validUntil", &self.valid_until)?;
        map.serialize_entry("confidence", &self.confidence)?;
        map.serialize_entry("authority", &self.authority)?;
        map.serialize_entry("sources", &self.sources)?;
        map.serialize_entry("generated", &self.generated)?;
        map.serialize_entry("contentHash", &self.content_hash)?;
        map.serialize_entry("derivedFrom", &self.derived_from)?;
        map.serialize_entry("access", &self.access)?;
        map.serialize_entry("sensitivity", &self.sensitivity)?;
        if v2 {
            map.serialize_entry("redactions", &self.redactions)?;
            map.serialize_entry("constraints", &self.constraints)?;
            map.serialize_entry("confirmation", &self.confirmation)?;
        }
        map.end()
    }
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

    /// The envelope's checks for a store write in `space` (section 2.1): version 1 or 2, an
    /// origin that is not `unspecified`, a non-empty valid access set and a sensitivity, a
    /// matching space, a principal string and list sizes within bounds; in version 2 an
    /// `authority` of the closed set and well-formed `redactions`, `constraints` and
    /// `confirmation`, which version 1 never holds. Returns the normalised access set.
    ///
    /// Document and record writes still pass version 1; see the phase 3 step 1 note in
    /// `docs/STATUS.md`.
    ///
    /// # Errors
    /// [`StoreError::Invalid`] naming the first rule broken.
    pub fn check(&self, space: &str) -> Result<AccessSet> {
        let refuse = |rule: &str| Err(StoreError::invalid(format!("provenance envelope: {rule}")));
        if !(1..=ENVELOPE_VERSION).contains(&self.version) {
            return refuse("version must be 1 or 2");
        }
        self.check_version_2_fields()?;
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

    /// The fields version 2 adds or closes: absent from version 1, well formed in version 2.
    fn check_version_2_fields(&self) -> Result<()> {
        let refuse = |rule: &str| Err(StoreError::invalid(format!("provenance envelope: {rule}")));
        if self.version < 2 {
            if self.redactions.is_some()
                || self.constraints.is_some()
                || self.confirmation.is_some()
            {
                return refuse("redactions, constraints and confirmation need version 2");
            }
            return Ok(());
        }
        if self
            .authority
            .as_deref()
            .is_some_and(|text| Authority::parse(text).is_none())
        {
            return refuse(
                "authority must be person, agent, tool, transcript, import, document or external",
            );
        }
        if let Some(redactions) = &self.redactions {
            if redactions.len() > MAX_REDACTIONS {
                return refuse("redactions hold at most 32 entries");
            }
            if redactions
                .iter()
                .any(|r| r.kind.is_empty() || r.kind.chars().any(char::is_control) || r.count == 0)
            {
                return refuse("each redaction needs a kind and a count of at least 1");
            }
            if redactions
                .windows(2)
                .any(|pair| pair[0].kind >= pair[1].kind)
            {
                return refuse("redactions must be sorted by kind, each kind once");
            }
        }
        if let Some(constraints) = &self.constraints
            && (constraints.len() > MAX_CONSTRAINTS
                || constraints
                    .iter()
                    .any(|c| c.chars().count() > MAX_CONSTRAINT_CHARS))
        {
            return refuse("constraints hold at most 16 entries of at most 200 characters");
        }
        if let Some(confirmation) = &self.confirmation
            && (confirmation.by.is_empty() || confirmation.at.is_empty())
        {
            return refuse("confirmation needs by and at");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

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

    fn version_2() -> Envelope {
        let mut value = serde_json::to_value(envelope()).unwrap();
        value["version"] = json!(2);
        value["authority"] = json!("agent");
        value["redactions"] =
            json!([{ "kind": "aws-key", "count": 1 }, { "kind": "pem", "count": 2 }]);
        value["constraints"] = json!(["staging only"]);
        value["confirmation"] = json!({ "by": "human:ada", "at": "2026-11-02T10:15:00.000Z", "priorAuthority": "agent" });
        Envelope::from_value(value).unwrap()
    }

    #[test]
    fn each_version_is_written_back_in_its_own_shape() {
        let v1 = serde_json::to_value(envelope()).unwrap();
        assert!(v1.get("redactions").is_none() && v1.get("confirmation").is_none());
        let v2 = serde_json::to_value(version_2()).unwrap();
        assert_eq!(v2["constraints"], json!(["staging only"]));
        assert_eq!(v2["confirmation"]["priorAuthority"], "agent");
        let mut bare = envelope();
        bare.version = 2;
        let bare = serde_json::to_value(bare).unwrap();
        assert_eq!(bare["redactions"], Value::Null);
        assert_eq!(Envelope::from_value(v2).unwrap(), version_2());
    }

    #[test]
    fn version_2_closes_authority_and_bounds_its_new_fields() {
        assert!(version_2().check("main").is_ok());
        for authority in Authority::ALL {
            let mut e = version_2();
            e.authority = Some(authority.as_str().to_owned());
            assert!(e.check("main").is_ok(), "{authority:?}");
        }
        let broken: [fn(&mut Envelope); 7] = [
            |e| e.authority = Some("robot".to_owned()),
            |e| {
                e.redactions = Some(vec![Redaction {
                    kind: "pem".into(),
                    count: 0,
                }])
            },
            |e| {
                e.redactions = Some(vec![
                    Redaction {
                        kind: "pem".into(),
                        count: 1,
                    },
                    Redaction {
                        kind: "aws-key".into(),
                        count: 1,
                    },
                ]);
            },
            |e| {
                e.redactions = Some(
                    (0..33)
                        .map(|n| Redaction {
                            kind: format!("k{n:02}"),
                            count: 1,
                        })
                        .collect(),
                );
            },
            |e| e.constraints = Some(vec!["x".repeat(201)]),
            |e| e.constraints = Some(vec!["x".to_owned(); 17]),
            |e| e.version = 3,
        ];
        for edit in broken {
            let mut e = version_2();
            edit(&mut e);
            assert!(e.check("main").is_err(), "{e:?}");
        }
        // Version 1 keeps its open authority and never holds version 2's fields.
        let mut v1 = envelope();
        v1.authority = Some("anything".to_owned());
        assert!(v1.check("main").is_ok());
        v1.constraints = Some(vec![]);
        assert!(v1.check("main").is_err());
    }
}
