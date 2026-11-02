//! The proposal record, version 1 (specification section 9.1, `schemas/proposal.v1.json`): a
//! decision trace kept as a record of kind `proposal` in the knowledge instance's namespace.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use umbel_store::{ContentHash, canonical_json};

/// The record kind.
pub(crate) const KIND: &str = "proposal";

/// Where a proposal is in its life.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum State {
    /// Waiting for an approver.
    Pending,
    /// Decided, not yet applied (an apply that stopped half way resumes from here).
    Approved,
    /// Applied to the knowledge base.
    Applied,
    /// Refused by an approver, with a reason.
    Rejected,
    /// Taken back by its proposer.
    Withdrawn,
}

impl State {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Applied => "applied",
            Self::Rejected => "rejected",
            Self::Withdrawn => "withdrawn",
        }
    }

    pub(crate) fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "pending" => Self::Pending,
            "approved" => Self::Approved,
            "applied" => Self::Applied,
            "rejected" => Self::Rejected,
            "withdrawn" => Self::Withdrawn,
            _ => return None,
        })
    }
}

/// What a proposal changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Op {
    Create,
    Update,
    Deprecate,
    Verify,
}

impl Op {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Update => "update",
            Self::Deprecate => "deprecate",
            Self::Verify => "verify",
        }
    }
}

/// The change itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Change {
    pub(crate) op: Op,
    pub(crate) doc: String,
    /// `null` only for a create.
    pub(crate) base_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) superseded_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) verification: Option<Verification>,
}

/// A verify proposal's attestation.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Verification {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) stale_after: Option<String>,
}

/// The policy that governed the decision.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Policy {
    pub(crate) area: String,
    pub(crate) version: String,
    pub(crate) rule: String,
}

/// AFD's actor as the record keeps it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActorRef {
    pub(crate) kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) on_behalf_of: Option<String>,
}

impl ActorRef {
    /// `<kind>:<id>`; an actor with no id is `<kind>:anonymous`.
    pub(crate) fn text(&self) -> String {
        format!(
            "{}:{}",
            self.kind,
            self.id.as_deref().unwrap_or("anonymous")
        )
    }
}

/// Who proposed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Proposer {
    pub(crate) actor: ActorRef,
    pub(crate) principal: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) run: Option<String>,
}

/// The decision, once there is one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Decision {
    pub(crate) by: ActorRef,
    pub(crate) principal: String,
    pub(crate) at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) reason: Option<String>,
    pub(crate) trace_id: String,
    pub(crate) proposer_kind: String,
}

/// The proposal record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Proposal {
    pub(crate) version: u32,
    pub(crate) id: String,
    pub(crate) idempotency_key: String,
    pub(crate) change_hash: String,
    pub(crate) space: String,
    pub(crate) area: String,
    pub(crate) state: State,
    pub(crate) change: Change,
    pub(crate) diff: String,
    pub(crate) rationale: String,
    pub(crate) evidence: Vec<Value>,
    pub(crate) provenance: Value,
    pub(crate) policy: Policy,
    pub(crate) exception: Option<String>,
    pub(crate) proposer: Proposer,
    pub(crate) confidence: Option<f64>,
    pub(crate) decision: Option<Decision>,
    pub(crate) result: Option<Value>,
    pub(crate) flags: Vec<String>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

impl Proposal {
    pub(crate) fn from_value(value: &Value) -> Option<Self> {
        serde_json::from_value(value.clone()).ok()
    }

    pub(crate) fn to_value(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }

    /// The document's collection and the path inside it.
    pub(crate) fn split_doc(&self) -> Option<(&str, &str)> {
        self.change.doc.split_once('/')
    }
}

/// `sha256:` of the canonical JSON of `change`, `rationale` and `evidence`: what an idempotent
/// retry must repeat exactly.
pub(crate) fn change_hash(change: &Change, rationale: &str, evidence: &[Value]) -> String {
    let mut whole = Map::new();
    whole.insert(
        "change".to_owned(),
        serde_json::to_value(change).unwrap_or(Value::Null),
    );
    whole.insert("rationale".to_owned(), Value::String(rationale.to_owned()));
    whole.insert("evidence".to_owned(), Value::Array(evidence.to_vec()));
    ContentHash::of(canonical_json(&Value::Object(whole)).as_bytes()).to_string()
}

/// `p-` and the first 20 hex digits of SHA-256 of `<space>\0<proposer actor string>\0<key>`.
pub(crate) fn proposal_id(space: &str, actor: &str, key: &str) -> String {
    let hash = ContentHash::of(format!("{space}\0{actor}\0{key}").as_bytes());
    let hex = hash.as_str().strip_prefix("sha256:").unwrap_or_default();
    format!("p-{}", &hex[..20])
}
