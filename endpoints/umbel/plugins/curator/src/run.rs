//! What `curator-plan` and `curator-finish` share (phase 4 specification, sections 3.1 and 7):
//! the guard that they run only as steps of the instance's own `curator-run`, the actor string
//! the knowledge plugin derives proposal ids from, and the content-free bookkeeping `plan` hands
//! to `finish` through the pipeline.
//!
//! **Only inside the run.** Each of the two refuses a call the host does not attest as a step of
//! this plugin's `curator-run` pipeline (`CURATOR_RUN_REQUIRED`), so neither a person at the
//! command line nor another plugin's pipeline can take the lock, read drafts that hold memory
//! text onto stdout, or feed `finish` invented results. The attestation is the host's (section
//! 10.1): a table keyed by the step's fresh random trace id, never anything a caller sends.

use serde_json::{Value, json};
use umbel_sdk::{CallContext, Cx, Outcome, PipelineAttestation, failure};
use umbel_store::memory::{MemoryCursor, Millis, format_instant, parse_instant};

use crate::PLUGIN_ID;
use crate::state::Cursors;

/// The pipeline the curator ships (section 3.1).
pub const PIPELINE: &str = "curator-run";

/// `CURATOR_RUN_REQUIRED`: a step command called outside the instance's own `curator-run`.
fn run_required() -> Outcome {
    failure(
        "CURATOR_RUN_REQUIRED",
        "curator-plan and curator-finish run only as steps of curator-run",
        "Run `umbel call curator-run '{\"space\": \"<space>\"}'` at the command line, from cron or a session hook.",
    )
}

/// The host's attestation that this call is a step of this plugin's `curator-run`.
///
/// # Errors
/// `CURATOR_RUN_REQUIRED` for any other call.
pub(crate) fn attested(cx: &Cx) -> Result<PipelineAttestation, Outcome> {
    match &cx.call().pipeline {
        Some(attestation)
            if attestation.plugin == PLUGIN_ID && attestation.pipeline == PIPELINE =>
        {
            Ok(attestation.clone())
        }
        _ => Err(run_required()),
    }
}

/// The actor string the knowledge plugin derives a proposal's id from: `<kind>:<id>`, or
/// `<kind>:anonymous` for an actor with no id (its `ActorRef::text`).
#[must_use]
pub fn actor(call: &CallContext) -> String {
    format!(
        "{}:{}",
        call.actor_kind,
        call.actor_id.as_deref().unwrap_or("anonymous")
    )
}

/// What a planned draft is of.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Subject {
    /// A memory candidate (`c-`).
    Candidate,
    /// A document's review (`v-`): a verify or deprecate draft.
    Review,
}

impl Subject {
    fn as_str(self) -> &'static str {
        match self {
            Self::Candidate => "candidate",
            Self::Review => "review",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        match text {
            "candidate" => Some(Self::Candidate),
            "review" => Some(Self::Review),
            _ => None,
        }
    }
}

/// One draft `plan` submits, in the batch's order: which record it is of, and the proposal id the
/// knowledge plugin derives from its key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Planned {
    /// A candidate's or a review's.
    pub subject: Subject,
    /// The candidate or review record id.
    pub id: String,
    /// The derived proposal id.
    pub proposal: String,
    /// The key's draft number.
    pub key: u32,
    /// For a review: `verify` or `deprecate`.
    pub op: Option<String>,
}

/// One withdrawal `plan` asks for, in the batch's order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Withdrawal {
    /// A candidate's or a review's.
    pub subject: Subject,
    /// The candidate or review record id.
    pub id: String,
    /// The proposal withdrawn.
    pub proposal: String,
    /// `source-changed` or `superseded-alternative` (an erased source goes through the notice).
    pub reason: &'static str,
}

/// What `plan` counted for the report (section 7.2): ids and counts only.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Counted {
    /// Memory records read in full.
    pub read: u64,
    /// Live candidates that have settled.
    pub settled: u64,
    /// Live candidates.
    pub candidates: u64,
    /// Candidates that need their owner's promotion.
    pub needs_promotion: u64,
    /// Work the caps left for later runs (section 7.3).
    pub remaining: u64,
    /// `{ candidate, reason }` per skipped candidate.
    pub skipped: Vec<Value>,
    /// `{ kind, doc?, candidate?, check? }`.
    pub inconsistencies: Vec<Value>,
}

/// Everything `plan` hands `finish`, content-free.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Bookkeeping {
    /// The drafts, parallel to the batch's `proposals`.
    pub drafts: Vec<Planned>,
    /// The withdrawals, parallel to the batch's `withdraw`.
    pub withdrawals: Vec<Withdrawal>,
    /// Where the next run continues, once this one finishes.
    pub cursors: Cursors,
    /// The counts.
    pub counted: Counted,
    /// The reporting checkpoint after `plan` erased curator records, if it did.
    pub checkpoint: Option<&'static str>,
    /// When the run started.
    pub started_at: Millis,
}

fn cursor_value(cursor: Option<&MemoryCursor>) -> Value {
    cursor.map_or(
        Value::Null,
        |c| json!({ "recordedAt": format_instant(c.recorded_at), "id": c.id }),
    )
}

fn checkpoint_of(value: Option<&Value>) -> Option<&'static str> {
    match value.and_then(Value::as_str) {
        Some("clean") => Some("clean"),
        Some("pending") => Some("pending"),
        _ => None,
    }
}

impl Bookkeeping {
    /// As JSON, for the pipeline.
    #[must_use]
    pub fn to_value(&self) -> Value {
        json!({
            "drafts": self.drafts.iter().map(|d| json!({
                "subject": d.subject.as_str(),
                "id": d.id,
                "proposal": d.proposal,
                "key": d.key,
                "op": d.op,
            })).collect::<Vec<_>>(),
            "withdrawals": self.withdrawals.iter().map(|w| json!({
                "subject": w.subject.as_str(),
                "id": w.id,
                "proposal": w.proposal,
                "reason": w.reason,
            })).collect::<Vec<_>>(),
            "cursors": {
                "memoryAfter": self.cursors.memory_after,
                "scanAfter": cursor_value(self.cursors.scan_after.as_ref()),
                "reviewAfter": self.cursors.review_after,
            },
            "counted": {
                "read": self.counted.read,
                "settled": self.counted.settled,
                "candidates": self.counted.candidates,
                "needsPromotion": self.counted.needs_promotion,
                "remaining": self.counted.remaining,
                "skipped": self.counted.skipped,
                "inconsistencies": self.counted.inconsistencies,
            },
            "checkpoint": self.checkpoint,
            "startedAt": format_instant(self.started_at),
        })
    }

    /// Back from JSON; `None` when it is not what `plan` wrote.
    #[must_use]
    pub fn parse(value: &Value) -> Option<Self> {
        let text = |v: &Value, key: &str| v.get(key).and_then(Value::as_str).map(str::to_owned);
        let mut drafts = Vec::new();
        for d in value.get("drafts")?.as_array()? {
            drafts.push(Planned {
                subject: Subject::parse(d.get("subject")?.as_str()?)?,
                id: text(d, "id")?,
                proposal: text(d, "proposal")?,
                key: u32::try_from(d.get("key")?.as_u64()?).ok()?,
                op: text(d, "op"),
            });
        }
        let mut withdrawals = Vec::new();
        for w in value.get("withdrawals")?.as_array()? {
            withdrawals.push(Withdrawal {
                subject: Subject::parse(w.get("subject")?.as_str()?)?,
                id: text(w, "id")?,
                proposal: text(w, "proposal")?,
                reason: match w.get("reason")?.as_str()? {
                    "source-changed" => "source-changed",
                    "superseded-alternative" => "superseded-alternative",
                    _ => return None,
                },
            });
        }
        let cursors = value.get("cursors")?;
        let scan_after = match cursors.get("scanAfter")? {
            Value::Null => None,
            c => Some(MemoryCursor {
                recorded_at: parse_instant(c.get("recordedAt")?.as_str()?).ok()?,
                id: text(c, "id")?,
            }),
        };
        let counted = value.get("counted")?;
        let count = |key: &str| counted.get(key).and_then(Value::as_u64);
        Some(Self {
            drafts,
            withdrawals,
            cursors: Cursors {
                memory_after: cursors.get("memoryAfter")?.as_u64()?,
                scan_after,
                review_after: text(cursors, "reviewAfter"),
            },
            counted: Counted {
                read: count("read")?,
                settled: count("settled")?,
                candidates: count("candidates")?,
                needs_promotion: count("needsPromotion")?,
                remaining: count("remaining")?,
                skipped: counted.get("skipped")?.as_array()?.clone(),
                inconsistencies: counted.get("inconsistencies")?.as_array()?.clone(),
            },
            checkpoint: checkpoint_of(value.get("checkpoint")),
            started_at: parse_instant(value.get("startedAt")?.as_str()?).ok()?,
        })
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn the_bookkeeping_reads_back_as_written() {
        let kept = Bookkeeping {
            drafts: vec![Planned {
                subject: Subject::Review,
                id: "v-0123456789abcdef0123".into(),
                proposal: "p-0123456789abcdef0123".into(),
                key: 2,
                op: Some("verify".into()),
            }],
            withdrawals: vec![Withdrawal {
                subject: Subject::Candidate,
                id: "c-0123456789abcdef0123".into(),
                proposal: "p-abcdefabcdefabcdefab".into(),
                reason: "superseded-alternative",
            }],
            cursors: Cursors {
                memory_after: 9,
                scan_after: Some(MemoryCursor {
                    recorded_at: 1_767_225_600_000,
                    id: "mem-000000000000000000000001".into(),
                }),
                review_after: None,
            },
            counted: Counted {
                read: 3,
                skipped: vec![
                    json!({ "candidate": "c-0123456789abcdef0123", "reason": "target-exists" }),
                ],
                ..Counted::default()
            },
            checkpoint: Some("pending"),
            started_at: 1_767_225_600_000,
        };
        assert_eq!(Bookkeeping::parse(&kept.to_value()), Some(kept));
        assert_eq!(Bookkeeping::parse(&json!({})), None);
    }

    #[test]
    fn the_actor_string_is_the_knowledge_plugins() {
        let call = CallContext {
            actor_kind: "human".into(),
            actor_id: Some("local".into()),
            ..CallContext::default()
        };
        assert_eq!(actor(&call), "human:local");
        let anonymous = CallContext {
            actor_kind: "agent".into(),
            ..CallContext::default()
        };
        assert_eq!(actor(&anonymous), "agent:anonymous");
    }
}
