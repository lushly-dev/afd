//! The provenance envelope, versions 0 and 1 (`schemas/provenance-envelope.v0.json`,
//! `schemas/provenance-envelope.v1.json`).
//!
//! Every event carries one. The command supplies `origin`, `session`, `validFrom`, `validUntil`,
//! `confidence`, `authority` and, from version 1, `sources`, `generated`, `contentHash`,
//! `derivedFrom`, `access` and `sensitivity` in `result.metadata["dev.umbel/provenance"]`; the
//! host fills the rest from the journal entry: `space`, `plugin`, `agent`, `principal`, `traceId`
//! and `observedAt`. A value that is not of the documented shape reads as absent; the store
//! writes of phase 2 refuse what the envelope must hold (`STORE_PROVENANCE_REQUIRED`).

use afd::{Actor, ActorKind, JournalEntry};
use serde::ser::SerializeMap;
use serde::{Deserialize, Serialize, Serializer};
use serde_json::{Map, Value};

pub use crate::versions::PROVENANCE_VERSION;
use crate::workspace::{AccessToken, parse_principal};

/// The `result.metadata` key a command sets to supply provenance.
pub const PROVENANCE_KEY: &str = "dev.umbel/provenance";

/// The most `sources` or `derivedFrom` entries an envelope holds.
const MAX_LISTED: usize = 64;

/// The fields a command may supply in `dev.umbel/provenance`, each with its documented shape. The
/// host fills every other field of the envelope (`space`, `plugin`, `agent`, `principal`,
/// `traceId`, `observedAt`) from the journal entry.
const SUPPLIED_FIELDS: &[(&str, FieldType)] = &[
    ("origin", FieldType::Text),
    ("session", FieldType::Text),
    ("validFrom", FieldType::Text),
    ("validUntil", FieldType::Text),
    ("confidence", FieldType::Number),
    ("authority", FieldType::Text),
    ("sources", FieldType::Sources),
    ("generated", FieldType::Generated),
    ("contentHash", FieldType::Hash),
    ("derivedFrom", FieldType::DerivedFrom),
    ("access", FieldType::Access),
    ("sensitivity", FieldType::Sensitivity),
];

#[derive(Clone, Copy)]
enum FieldType {
    Text,
    Number,
    Sources,
    Generated,
    Hash,
    DerivedFrom,
    Access,
    Sensitivity,
}

impl FieldType {
    fn accepts(self, field: &Value) -> bool {
        match self {
            Self::Text => field.is_string(),
            Self::Number => field.is_number(),
            Self::Sources => field.as_array().is_some_and(|entries| {
                entries.len() <= MAX_LISTED
                    && entries.iter().all(|entry| {
                        entry.as_object().is_some_and(|entry| {
                            entry
                                .get("resource")
                                .and_then(Value::as_str)
                                .is_some_and(|resource| !resource.is_empty())
                                && entry.iter().all(|(key, value)| {
                                    ["resource", "id", "title", "author", "last_modified"]
                                        .contains(&key.as_str())
                                        && value.is_string()
                                })
                        })
                    })
            }),
            Self::Generated => field.as_object().is_some_and(|generated| {
                generated.len() == 2
                    && generated
                        .get("by")
                        .and_then(Value::as_str)
                        .is_some_and(|by| !by.is_empty())
                    && generated
                        .get("at")
                        .and_then(Value::as_str)
                        .is_some_and(|at| chrono::DateTime::parse_from_rfc3339(at).is_ok())
            }),
            Self::Hash => field.as_str().is_some_and(is_content_hash),
            Self::DerivedFrom => field.as_array().is_some_and(|entries| {
                entries.len() <= MAX_LISTED
                    && entries.iter().all(|entry| {
                        entry.as_object().is_some_and(|entry| {
                            entry.len() == 3
                                && ["kind", "id"].iter().all(|key| {
                                    entry
                                        .get(*key)
                                        .and_then(Value::as_str)
                                        .is_some_and(|text| !text.is_empty())
                                })
                                && entry
                                    .get("contentHash")
                                    .and_then(Value::as_str)
                                    .is_some_and(is_content_hash)
                        })
                    })
            }),
            Self::Access => field.as_array().is_some_and(|tokens| {
                !tokens.is_empty()
                    && tokens.iter().all(|token| {
                        token
                            .as_str()
                            .is_some_and(|token| AccessToken::parse(token).is_ok())
                    })
            }),
            Self::Sensitivity => field
                .as_str()
                .is_some_and(|text| Sensitivity::parse(text).is_some()),
        }
    }
}

/// `sha256:` and 64 lowercase hex digits.
fn is_content_hash(text: &str) -> bool {
    text.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

/// How sensitive a record is (envelope version 1).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sensitivity {
    /// Fit for anyone.
    Public,
    /// For the people who work here (the default).
    #[default]
    Internal,
    /// For a named few.
    Confidential,
    /// For the very few.
    Restricted,
}

impl Sensitivity {
    fn parse(text: &str) -> Option<Self> {
        match text {
            "public" => Some(Self::Public),
            "internal" => Some(Self::Internal),
            "confidential" => Some(Self::Confidential),
            "restricted" => Some(Self::Restricted),
            _ => None,
        }
    }
}

/// The principal string of the person or process behind `actor` for access (phase 2
/// specification, section 6): `human:<onBehalfOf>` when it acts for someone, the actor itself
/// otherwise as `<kind>:<id>`. `None` for an actor with no id, a test actor, or an id that is not
/// a valid principal id.
pub fn effective_principal(actor: &Actor) -> Option<String> {
    let text = match (&actor.on_behalf_of, actor.kind) {
        (Some(person), _) if !person.is_empty() => format!("human:{person}"),
        (_, ActorKind::Human) => format!("human:{}", actor.id.as_deref()?),
        (_, ActorKind::Agent) => format!("agent:{}", actor.id.as_deref()?),
        (_, ActorKind::Service) => format!("service:{}", actor.id.as_deref()?),
        (_, ActorKind::Script) => format!("script:{}", actor.id.as_deref()?),
        (_, ActorKind::Test) => return None,
    };
    parse_principal(&text).is_ok().then_some(text)
}

/// What a plugin supplied under [`PROVENANCE_KEY`], reduced to the fields a command may supply,
/// each of its documented type: everything else is removed, so a plugin, sandboxed or not,
/// cannot supply the host-filled fields. `None` when nothing is left, or the value is not an
/// object.
pub fn supplied_fields(value: &Value) -> Option<Value> {
    let map = value.as_object()?;
    let kept: Map<String, Value> = SUPPLIED_FIELDS
        .iter()
        .filter_map(|(name, kind)| {
            let field = map.get(*name)?;
            kind.accepts(field)
                .then(|| ((*name).to_owned(), field.clone()))
        })
        .collect();
    (!kept.is_empty()).then_some(Value::Object(kept))
}

/// Where a record came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Origin {
    /// The person said it.
    UserStated,
    /// An agent concluded it.
    AgentInferred,
    /// It came out of a document.
    DocumentDerived,
    /// The command gave none. Store writes, from phase 2, refuse this.
    Unspecified,
}

impl Origin {
    fn from_value(value: Option<&Value>) -> Self {
        match value.and_then(Value::as_str) {
            Some("user-stated") => Self::UserStated,
            Some("agent-inferred") => Self::AgentInferred,
            Some("document-derived") => Self::DocumentDerived,
            _ => Self::Unspecified,
        }
    }
}

/// The provenance envelope, version 0 or 1. Every field of its version is present on the wire;
/// absent ones are `null`. Version 0 has no `plugin`, `sources`, `generated`, `contentHash`,
/// `derivedFrom`, `access` or `sensitivity`: those read as their empty values from a version 0
/// line and are not written for one.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    /// 0, or [`PROVENANCE_VERSION`].
    pub version: u32,
    /// Where the record came from.
    pub origin: Origin,
    /// The record's space.
    pub space: String,
    /// Version 1: the plugin instance whose command produced the record; `null` for a host
    /// built-in.
    #[serde(default)]
    pub plugin: Option<String>,
    /// The actor when its kind is `agent`, `service` or `script`; otherwise `null`.
    pub agent: Option<Actor>,
    /// Version 1: the call's effective principal string, such as `human:local`. Version 0: the
    /// person, as a bare id.
    pub principal: Option<String>,
    /// A harness session id when the command supplied one.
    pub session: Option<String>,
    /// The call's trace id.
    pub trace_id: Option<String>,
    /// The journal entry's timestamp.
    pub observed_at: String,
    /// ISO 8601, from the command.
    pub valid_from: Option<String>,
    /// ISO 8601, from the command.
    pub valid_until: Option<String>,
    /// 0 to 1: the command's value, else the result's `confidence`.
    pub confidence: Option<f64>,
    /// A string; version 2 closes the set.
    pub authority: Option<String>,
    /// Version 1: the OKF `sources` list as the command stated it.
    #[serde(default)]
    pub sources: Option<Vec<Value>>,
    /// Version 1: OKF's `{ by, at }`.
    #[serde(default)]
    pub generated: Option<Value>,
    /// Version 1: `sha256:<hex>` of the record's bytes.
    #[serde(default)]
    pub content_hash: Option<String>,
    /// Version 1: the records this one was derived from.
    #[serde(default)]
    pub derived_from: Option<Vec<Value>>,
    /// Version 1: the record's access set, never empty (empty in a version 0 envelope).
    #[serde(default)]
    pub access: Vec<String>,
    /// Version 1: how sensitive the record is.
    #[serde(default)]
    pub sensitivity: Option<Sensitivity>,
}

impl Serialize for Envelope {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let v1 = self.version >= 1;
        let mut map = serializer.serialize_map(Some(if v1 { 19 } else { 12 }))?;
        map.serialize_entry("version", &self.version)?;
        map.serialize_entry("origin", &self.origin)?;
        map.serialize_entry("space", &self.space)?;
        if v1 {
            map.serialize_entry("plugin", &self.plugin)?;
        }
        map.serialize_entry("agent", &self.agent)?;
        map.serialize_entry("principal", &self.principal)?;
        map.serialize_entry("session", &self.session)?;
        map.serialize_entry("traceId", &self.trace_id)?;
        map.serialize_entry("observedAt", &self.observed_at)?;
        map.serialize_entry("validFrom", &self.valid_from)?;
        map.serialize_entry("validUntil", &self.valid_until)?;
        map.serialize_entry("confidence", &self.confidence)?;
        map.serialize_entry("authority", &self.authority)?;
        if v1 {
            map.serialize_entry("sources", &self.sources)?;
            map.serialize_entry("generated", &self.generated)?;
            map.serialize_entry("contentHash", &self.content_hash)?;
            map.serialize_entry("derivedFrom", &self.derived_from)?;
            map.serialize_entry("access", &self.access)?;
            map.serialize_entry("sensitivity", &self.sensitivity)?;
        }
        map.end()
    }
}

impl Envelope {
    /// The envelope of the journal entry `entry`, a mutation in `space`, in `version` (0 or 1).
    pub fn from_entry(entry: &JournalEntry, space: &str, version: u32) -> Self {
        let metadata = entry.result.metadata.as_ref();
        // The gate has already reduced what a plugin supplied, but the journal is a file: read
        // each field through the same shape check again.
        let reduced = metadata
            .and_then(|metadata| metadata.extra.get(PROVENANCE_KEY))
            .and_then(supplied_fields);
        let supplied: Option<&Map<String, Value>> = reduced.as_ref().and_then(Value::as_object);
        let field = |name: &str| supplied.and_then(|map| map.get(name));
        let text = |name: &str| field(name).and_then(Value::as_str).map(str::to_owned);
        let instant = |name: &str| {
            text(name).filter(|value| chrono::DateTime::parse_from_rfc3339(value).is_ok())
        };
        let list = |name: &str| field(name).and_then(Value::as_array).cloned();
        let confidence = field("confidence")
            .and_then(Value::as_f64)
            .or(entry.result.confidence)
            .filter(|value| (0.0..=1.0).contains(value));
        let v1 = version >= 1;
        let (agent, principal) = match &entry.actor {
            Some(actor) => (
                matches!(
                    actor.kind,
                    ActorKind::Agent | ActorKind::Service | ActorKind::Script
                )
                .then(|| actor.clone()),
                if v1 {
                    effective_principal(actor)
                } else {
                    actor.on_behalf_of.clone().or_else(|| {
                        if actor.kind == ActorKind::Human {
                            actor.id.clone()
                        } else {
                            None
                        }
                    })
                },
            ),
            None => (None, None),
        };
        // An access set is sorted and deduplicated. A command that supplied none (or an invalid
        // one) leaves the record readable by everyone who may read the space.
        let mut access: Vec<String> = list("access")
            .into_iter()
            .flatten()
            .filter_map(|token| token.as_str().map(str::to_owned))
            .collect();
        access.sort();
        access.dedup();
        if access.is_empty() {
            access.push("space".to_owned());
        }
        Self {
            version: if v1 { PROVENANCE_VERSION } else { 0 },
            origin: Origin::from_value(field("origin")),
            space: space.to_owned(),
            plugin: v1.then(|| plugin_id(entry)).flatten(),
            agent,
            principal,
            session: text("session"),
            trace_id: entry.trace_id.clone(),
            observed_at: entry.timestamp.clone(),
            valid_from: instant("validFrom"),
            valid_until: instant("validUntil"),
            confidence,
            authority: text("authority"),
            sources: if v1 { list("sources") } else { None },
            generated: if v1 {
                field("generated").cloned()
            } else {
                None
            },
            content_hash: if v1 { text("contentHash") } else { None },
            derived_from: if v1 { list("derivedFrom") } else { None },
            access: if v1 { access } else { Vec::new() },
            sensitivity: v1.then(|| {
                text("sensitivity")
                    .and_then(|text| Sensitivity::parse(&text))
                    .unwrap_or_default()
            }),
        }
    }
}

/// The plugin instance the gate stamped on the entry's result.
fn plugin_id(entry: &JournalEntry) -> Option<String> {
    entry
        .result
        .metadata
        .as_ref()?
        .extra
        .get(crate::middleware::PLUGIN_KEY)?
        .get("id")?
        .as_str()
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_the_fields_a_command_may_supply_survive_with_their_types() {
        let supplied = json!({
            "origin": "user-stated",
            "confidence": 0.5,
            "session": 7,
            "space": "second",
            "agent": {"kind": "agent"},
            "principal": "root",
            "traceId": "forged",
            "observedAt": "2000-01-01T00:00:00Z",
            "extra": true,
        });
        assert_eq!(
            supplied_fields(&supplied),
            Some(json!({"origin": "user-stated", "confidence": 0.5}))
        );
        assert_eq!(supplied_fields(&json!({"space": "second"})), None);
        assert_eq!(supplied_fields(&json!("text")), None);
    }

    #[test]
    fn version_1_fields_survive_only_in_their_documented_shape() {
        let hash = format!("sha256:{}", "ab".repeat(32));
        let good = json!({
            "sources": [{"resource": "/a", "title": "A"}],
            "generated": {"by": "human:ada", "at": "2026-10-30T09:00:00+00:00"},
            "contentHash": hash,
            "derivedFrom": [{"kind": "proposal", "id": "p-1", "contentHash": hash}],
            "access": ["space", "group:platform", "principal:human:ada"],
            "sensitivity": "restricted",
        });
        assert_eq!(supplied_fields(&good), Some(good.clone()));
        let bad = json!({
            "sources": [{"title": "no resource"}],
            "generated": {"by": "human:ada", "at": "yesterday"},
            "contentHash": "sha256:00",
            "derivedFrom": [{"kind": "proposal", "id": "p-1"}],
            "access": [],
            "sensitivity": "secret",
        });
        assert_eq!(supplied_fields(&bad), None);
        for access in [
            json!(["everyone"]),
            json!(["group:Bad"]),
            json!("space"),
            json!([1]),
        ] {
            assert_eq!(supplied_fields(&json!({ "access": access })), None);
        }
        let too_many: Vec<Value> = (0..65)
            .map(|n| json!({"resource": format!("/{n}")}))
            .collect();
        assert_eq!(supplied_fields(&json!({ "sources": too_many })), None);
    }

    #[test]
    fn the_effective_principal_is_the_person_behind_the_call_when_there_is_one() {
        let actor = |kind, id: Option<&str>, on_behalf_of: Option<&str>| Actor {
            kind,
            id: id.map(str::to_owned),
            label: None,
            on_behalf_of: on_behalf_of.map(str::to_owned),
        };
        let effective = |a: &Actor| effective_principal(a);
        assert_eq!(
            effective(&actor(ActorKind::Human, Some("local"), None)).as_deref(),
            Some("human:local")
        );
        assert_eq!(
            effective(&actor(ActorKind::Agent, Some("local"), Some("ada"))).as_deref(),
            Some("human:ada")
        );
        assert_eq!(
            effective(&actor(ActorKind::Agent, Some("loopback"), None)).as_deref(),
            Some("agent:loopback")
        );
        assert_eq!(
            effective(&actor(ActorKind::Service, Some("s"), None)).as_deref(),
            Some("service:s")
        );
        assert_eq!(
            effective(&actor(ActorKind::Script, Some("j"), None)).as_deref(),
            Some("script:j")
        );
        // An id may hold colons; no id, a test actor and a control character are none.
        assert_eq!(
            effective(&actor(ActorKind::Agent, Some("a:b"), None)).as_deref(),
            Some("agent:a:b")
        );
        assert_eq!(effective(&actor(ActorKind::Agent, None, None)), None);
        assert_eq!(effective(&actor(ActorKind::Test, Some("t"), None)), None);
        assert_eq!(
            effective(&actor(ActorKind::Human, Some("a\nb"), None)),
            None
        );
        assert_eq!(
            effective(&actor(ActorKind::Test, Some("t"), Some("ada"))).as_deref(),
            Some("human:ada")
        );
    }
}
