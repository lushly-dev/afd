//! The proposal record (phase 2 specification section 9.1, phase 4 section 2.1; D62, D92): a
//! decision trace kept as a record of kind `proposal` in the knowledge instance's namespace.
//!
//! New proposals are version 2 (`schemas/proposal.v2.json`), which adds `drafter`, `conflictSet`,
//! `withdrawal`, `redacted` and `decision.channel` and nests envelope version 2. A version 1
//! record (`schemas/proposal.v1.json`) is read and stays version 1 when it is decided, withdrawn
//! or applied: it is written back without any of version 2's fields.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use umbel_store::{ContentHash, canonical_json};

/// The record kind.
pub(crate) const KIND: &str = "proposal";
/// The version a new proposal is written in.
pub(crate) const VERSION: u32 = 2;
/// The versions this plugin reads; each is written back in its own version.
pub(crate) const VERSIONS: [u32; 2] = [1, VERSION];
/// The top-level keys version 2 adds; a version 1 record never holds them.
const VERSION_2_KEYS: [&str; 4] = ["drafter", "conflictSet", "withdrawal", "redacted"];
/// `decision.channel` of a person's decision at a terminal.
pub(crate) const CHANNEL_TERMINAL: &str = "terminal";

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
    /// Version 2: `terminal` or `policy`. A version 1 decision has none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) channel: Option<String>,
}

/// The curator instance a drafted proposal came from (version 2). `plugin`, `instance`,
/// `pipeline` and `run` are attested by the host; `mode`, `candidate` and `promoted_by` are
/// verified by this plugin against the memory store (phase 4 section 3.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Drafter {
    pub(crate) plugin: String,
    pub(crate) instance: String,
    pub(crate) pipeline: String,
    pub(crate) run: String,
    /// `scheduled` or `promoted`.
    pub(crate) mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) candidate: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) promoted_by: Option<String>,
}

impl Drafter {
    /// Whether the draft widens its sources' readers (phase 4 section 5.1): only a promotion may.
    pub(crate) fn widens(&self) -> bool {
        self.mode == "promoted"
    }

    /// Whether `other` is the same drafter making the same claims, whatever the run: what an
    /// idempotent retry must repeat (a later run renders the same draft under its own run).
    pub(crate) fn same_draft(&self, other: &Self) -> bool {
        self.plugin == other.plugin
            && self.instance == other.instance
            && self.pipeline == other.pipeline
            && self.mode == other.mode
            && self.candidate == other.candidate
            && self.promoted_by == other.promoted_by
    }

    /// Whether this drafter is the attested step's: the same plugin and instance.
    pub(crate) fn is(&self, attestation: &umbel_sdk::PipelineAttestation) -> bool {
        self.plugin == attestation.plugin && self.instance == attestation.instance
    }
}

/// `mode` of a draft that widens nobody's readers.
pub(crate) const MODE_SCHEDULED: &str = "scheduled";

/// Who withdrew a proposal, why and when (version 2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Withdrawal {
    /// `drafter` or `proposer`.
    pub(crate) by: String,
    /// `source-erased`, `source-changed`, `superseded-alternative` or `retracted`.
    pub(crate) reason: String,
    pub(crate) at: String,
}

impl Withdrawal {
    /// A proposer taking their own proposal back: always `retracted` (phase 4 step 1, amendment 7).
    pub(crate) fn retracted(at: &str) -> Self {
        Self {
            by: "proposer".to_owned(),
            reason: "retracted".to_owned(),
            at: at.to_owned(),
        }
    }

    /// The attested drafter withdrawing one of its own proposals (phase 4 section 9.1).
    pub(crate) fn by_drafter(reason: &str, at: &str) -> Self {
        Self {
            by: "drafter".to_owned(),
            reason: reason.to_owned(),
            at: at.to_owned(),
        }
    }

    /// Whether the drafter withdrew it.
    pub(crate) fn is_drafters(&self) -> bool {
        self.by == "drafter"
    }
}

/// A drafter's reasons for a withdrawal; `retracted` is a proposer's only (phase 4 section 2.1).
pub(crate) const DRAFTER_REASONS: [&str; 3] =
    ["source-erased", "source-changed", "superseded-alternative"];
/// The reason a redaction records, and the only withdrawal reason that redacts.
pub(crate) const SOURCE_ERASED: &str = "source-erased";

/// When a forgotten source's text was removed (version 2, phase 4 section 9.1).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Redacted {
    pub(crate) at: String,
    /// `source-erased`.
    pub(crate) reason: String,
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
    /// Version 2: the drafting curator instance, or `None`.
    #[serde(default)]
    pub(crate) drafter: Option<Drafter>,
    /// Version 2: the conflict set a drafted alternative belongs to, or `None`.
    #[serde(default)]
    pub(crate) conflict_set: Option<String>,
    /// Version 2: set exactly when the state is `withdrawn`.
    #[serde(default)]
    pub(crate) withdrawal: Option<Withdrawal>,
    /// Version 2: set when a forgotten source's text was removed.
    #[serde(default)]
    pub(crate) redacted: Option<Redacted>,
}

impl Proposal {
    /// A proposal record of a version this plugin reads, or `None`.
    pub(crate) fn from_value(value: &Value) -> Option<Self> {
        let proposal: Self = serde_json::from_value(value.clone()).ok()?;
        VERSIONS.contains(&proposal.version).then_some(proposal)
    }

    /// The record body in the proposal's own version: version 2 holds its four keys, `null` when
    /// unset; version 1 holds none of them, and no `decision.channel`.
    pub(crate) fn to_value(&self) -> Value {
        let mut value = serde_json::to_value(self).unwrap_or(Value::Null);
        if self.version < 2
            && let Some(map) = value.as_object_mut()
        {
            for key in VERSION_2_KEYS {
                map.remove(key);
            }
            if let Some(decision) = map.get_mut("decision").and_then(Value::as_object_mut) {
                decision.remove("channel");
            }
        }
        value
    }

    /// Whether the proposal is version 2 or later, so holds version 2's fields.
    pub(crate) fn is_v2(&self) -> bool {
        self.version >= 2
    }

    /// `decision.channel` for a person's decision at a terminal, in this proposal's version.
    pub(crate) fn terminal_channel(&self) -> Option<String> {
        self.is_v2().then(|| CHANNEL_TERMINAL.to_owned())
    }

    /// The document's collection and the path inside it.
    pub(crate) fn split_doc(&self) -> Option<(&str, &str)> {
        self.change.doc.split_once('/')
    }

    /// Whether the proposal is still open: waiting for a decision, or approved with its apply
    /// not finished.
    pub(crate) fn is_open(&self) -> bool {
        matches!(self.state, State::Pending | State::Approved)
    }

    /// The memory record ids its evidence cites, erased entries included.
    pub(crate) fn memory_sources(&self) -> Vec<String> {
        memory_sources(&self.evidence)
    }
}

/// The memory record ids `evidence` cites: the `<mem id>` of each memory entry's
/// `<mem id>@<recordVersion>` reference.
pub(crate) fn memory_sources(evidence: &[Value]) -> Vec<String> {
    evidence
        .iter()
        .filter(|entry| entry.get("kind").and_then(Value::as_str) == Some("memory"))
        .filter_map(|entry| entry.get("ref").and_then(Value::as_str))
        .map(|reference| {
            reference
                .split_once('@')
                .map_or(reference, |(id, _)| id)
                .to_owned()
        })
        .collect()
}

/// The change hash of a redacted proposal: `sha256:` of the canonical JSON
/// `{ "redacted": "<proposal id>" }` (phase 4 section 9.1), the same for every redaction of it.
pub(crate) fn redacted_hash(id: &str) -> String {
    let mut whole = Map::new();
    whole.insert("redacted".to_owned(), Value::String(id.to_owned()));
    ContentHash::of(canonical_json(&Value::Object(whole)).as_bytes()).to_string()
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
