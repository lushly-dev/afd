//! Candidates and their statuses (phase 4 specification, sections 4 to 5 and 4.6): a pure
//! function of the caller's readable records, the pack, the target, the caller's curator records,
//! whether each target document exists, and `now`.
//!
//! A group of eligible records (`settle`) is one candidate, whose id is content-free:
//! `c-` and 20 hex of SHA-256 of `<space>\0<principal>\0<lowest source id>`. Its status is decided
//! in this order, the first that holds (step 4, amendment 5):
//!
//! 1. what a run recorded as `applied` or `erased`: never drafted again (7.1, 9.1);
//! 2. `skipped` with `too-many-sources`: more than 32 readable sources;
//! 3. `skipped` with `sensitivity-higher`: a source is more sensitive than the target (5.1; no
//!    promotion overrides it);
//! 4. `settling`: not every source has stood for the window, or too few sessions (4.2);
//! 5. `skipped` with `conflict-too-large`: past the conflict set's alternatives (4.4);
//! 6. what a run recorded as `drafted`, or `rejected` inside its quiet period (7.1);
//! 7. `skipped` with `target-exists`: its document exists (4.5);
//! 8. `ready`, `scheduled`, when the target's readers are within every source's (5.1);
//! 9. `ready`, `promoted`, when they are wider and the owner of every source consented to exactly
//!    these sources at these versions (5.2);
//! 10. `needs-promotion` otherwise.

use std::collections::BTreeMap;

use umbel_store::memory::Millis;
use umbel_store::{Authority, MemoryClass, MemoryRecord, Sensitivity};

use crate::access::{self, Rule};
use crate::conflicts;
use crate::pack::Settle;
use crate::records::{Consent, Stored};
use crate::settle::{self, Group, Snapshot};
use crate::target::Target;

/// A candidate's status (section 2.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Status {
    /// Not yet settled.
    Settling,
    /// Settled, and a run would draft it.
    Ready,
    /// A run drafted it and its proposal is open.
    Drafted,
    /// Settled, but its target is wider than its sources' readers: only its owner's promotion
    /// drafts it.
    NeedsPromotion,
    /// Never drafted while the reason holds.
    Skipped,
    /// Its draft was rejected; quiet until `quietUntil`.
    Rejected,
    /// Its draft was applied.
    Applied,
    /// A source was erased.
    Erased,
}

impl Status {
    /// Every status, in the order `curator-candidates` counts them.
    pub const ALL: [Self; 8] = [
        Self::Settling,
        Self::Ready,
        Self::Drafted,
        Self::NeedsPromotion,
        Self::Skipped,
        Self::Rejected,
        Self::Applied,
        Self::Erased,
    ];

    /// The record's spelling.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Settling => "settling",
            Self::Ready => "ready",
            Self::Drafted => "drafted",
            Self::NeedsPromotion => "needs-promotion",
            Self::Skipped => "skipped",
            Self::Rejected => "rejected",
            Self::Applied => "applied",
            Self::Erased => "erased",
        }
    }

    /// The status `text` spells.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|status| status.as_str() == text)
    }

    /// Whether a run recorded this as an outcome the live computation cannot see.
    #[must_use]
    pub fn is_outcome(self) -> bool {
        matches!(
            self,
            Self::Drafted | Self::Rejected | Self::Applied | Self::Erased
        )
    }
}

/// Why a candidate is skipped (section 2.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Reason {
    /// More than 32 readable sources.
    TooManySources,
    /// Past the conflict set's alternatives.
    ConflictTooLarge,
    /// Its document exists.
    TargetExists,
    /// A source is more sensitive than the target.
    SensitivityHigher,
}

impl Reason {
    /// The record's spelling.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TooManySources => "too-many-sources",
            Self::ConflictTooLarge => "conflict-too-large",
            Self::TargetExists => "target-exists",
            Self::SensitivityHigher => "sensitivity-higher",
        }
    }
}

/// How a ready candidate is drafted (section 2.1's `drafter.mode`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Mode {
    /// The target's readers are within every source's.
    Scheduled,
    /// Wider, with the owner's consent: `promotedBy`.
    Promoted {
        /// The owner of every source, who consented at a terminal.
        by: String,
    },
}

/// One candidate. `sources` hold memory text for drafting; nothing here is ever logged, and
/// `curator-candidates` shows only ids, counts and labels.
#[derive(Debug, Clone)]
pub struct Candidate {
    /// `c-` and 20 hex digits.
    pub id: String,
    /// The class.
    pub class: MemoryClass,
    /// The sources' common content hash.
    pub content_hash: String,
    /// `sha256:` of the subject key (section 4.4, step 1's amendment 11).
    pub subject_key: String,
    /// The readable sources, by id, at most 32 (the lowest ids).
    pub sources: Vec<MemoryRecord>,
    /// How many readable sources the group has, which may be more than 32.
    pub source_count: usize,
    /// The sum of the sources' observed sessions.
    pub sessions: u64,
    /// The distinct owners.
    pub principals: u64,
    /// The highest authority.
    pub authority: Option<Authority>,
    /// The highest asserted confidence.
    pub confidence: Option<f64>,
    /// The candidate record's access set: the sources' intersection and `principal:<caller>`.
    pub access: Vec<String>,
    /// The highest sensitivity.
    pub sensitivity: Sensitivity,
    /// Whether every source is the caller's own.
    pub own: bool,
    /// When every source will have stood for the window.
    pub stable_at: Option<Millis>,
    /// The snapshot, once settled.
    pub snapshot: Option<Snapshot>,
    /// The status.
    pub status: Status,
    /// The skip reason.
    pub reason: Option<Reason>,
    /// How a ready candidate is drafted.
    pub mode: Option<Mode>,
    /// Its conflict set.
    pub conflict_set: Option<String>,
    /// The document it is drafted as.
    pub doc: String,
    /// How many times a run drafted it.
    pub drafts: u32,
    /// The end of a rejection's quiet period.
    pub quiet_until: Option<Millis>,
    /// The document an applied draft created.
    pub promoted_to: Option<String>,
}

/// What [`evaluate`] reads.
#[derive(Debug, Clone)]
pub struct Inputs<'a> {
    /// The space.
    pub space: &'a str,
    /// The caller's effective principal.
    pub principal: &'a str,
    /// The command context's clock.
    pub now: Millis,
    /// The settle pack.
    pub settle: &'a Settle,
    /// The space's target.
    pub target: &'a Target,
    /// The memory records read under the caller's reader filter.
    pub records: Vec<MemoryRecord>,
    /// The caller's candidate records.
    pub stored: &'a [Stored],
    /// The caller's consent records.
    pub consents: &'a [Consent],
}

/// What [`evaluate`] found.
#[derive(Debug, Clone)]
pub struct Evaluation {
    /// The live candidates, by id.
    pub candidates: Vec<Candidate>,
    /// The caller's recorded outcomes (`drafted`, `rejected`, `applied`, `erased`) with no live
    /// group now, by id.
    pub recorded: Vec<Stored>,
}

/// A candidate of `group` before the target, the conflict sets and the caller's records.
fn of_group(group: Group, inputs: &Inputs<'_>, stored: Option<&Stored>) -> Candidate {
    let settle = inputs.settle;
    let source_count = group.members.len();
    let stable_at = group.stable_at(settle);
    let live_snapshot = group.settled(inputs.now, settle);
    let id = umbel_okf::draft::candidate_id(inputs.space, inputs.principal, group.lowest());
    let sessions = group.sessions();
    let principals = group.principals();
    let authority = group.authority();
    let confidence = group.confidence();
    let sensitivity = group.sensitivity();
    let mut sources = group.members;
    sources.truncate(umbel_okf::draft::MAX_SOURCES);
    let subject_key = sources
        .first()
        .map(|s| umbel_okf::draft::subject_key_digest(&s.subject))
        .unwrap_or_default();
    let latest = sources.iter().map(|s| s.recorded_at).max().unwrap_or(0);
    // The snapshot is fixed when the candidate first becomes ready, while it still bounds the
    // sources' current versions; a changed source re-settles it.
    let snapshot = live_snapshot.map(|live| {
        stored
            .and_then(|s| s.snapshot)
            .filter(|kept| kept.settled_at >= latest && kept.settled_at <= inputs.now)
            .unwrap_or(live)
    });
    let (status, reason) = if source_count > umbel_okf::draft::MAX_SOURCES {
        (Status::Skipped, Some(Reason::TooManySources))
    } else if access::rule(inputs.target, &sources) == Rule::MoreSensitive {
        (Status::Skipped, Some(Reason::SensitivityHigher))
    } else if snapshot.is_none() {
        (Status::Settling, None)
    } else {
        (Status::Ready, None)
    };
    Candidate {
        own: sources
            .iter()
            .all(|s| s.scope.principal == inputs.principal),
        access: access::candidate_access(&sources, inputs.principal),
        sessions,
        principals,
        authority,
        confidence,
        sensitivity,
        class: group.class,
        content_hash: group.content_hash,
        id,
        subject_key,
        sources,
        source_count,
        stable_at,
        snapshot,
        status,
        reason,
        mode: None,
        conflict_set: stored.and_then(|s| s.conflict_set.clone()),
        doc: String::new(),
        drafts: stored.map_or(0, |s| s.drafts),
        quiet_until: None,
        promoted_to: None,
    }
}

/// The candidates of `inputs`, asking `exists` whether a ready candidate's document exists.
///
/// # Errors
/// Whatever `exists` answers.
pub fn evaluate<E>(
    mut inputs: Inputs<'_>,
    mut exists: impl FnMut(&str) -> Result<bool, E>,
) -> Result<Evaluation, E> {
    let stored: BTreeMap<&str, &Stored> =
        inputs.stored.iter().map(|s| (s.id.as_str(), s)).collect();
    let records = std::mem::take(&mut inputs.records);
    let groups = settle::group(records, inputs.now, inputs.settle);
    let mut candidates: Vec<Candidate> = groups
        .into_iter()
        .map(|group| {
            let id = umbel_okf::draft::candidate_id(inputs.space, inputs.principal, group.lowest());
            let kept = stored.get(id.as_str()).copied();
            of_group(group, &inputs, kept)
        })
        .collect();
    candidates.sort_by(|a, b| a.id.cmp(&b.id));
    conflicts::assign(
        &mut candidates,
        inputs.space,
        inputs.principal,
        usize::try_from(inputs.settle.max_alternatives).unwrap_or(usize::MAX),
    );
    for candidate in &mut candidates {
        candidate.doc = inputs
            .target
            .document_id(candidate.conflict_set.as_deref().unwrap_or(&candidate.id));
        // A run's recorded outcome stands over what the live computation would say: an applied
        // or erased candidate is never drafted again (7.1, 9.1); a drafted one, or one rejected
        // inside its quiet period, while it would otherwise be drafted.
        if let Some(kept) = stored.get(candidate.id.as_str()) {
            let stands = match kept.status {
                Status::Applied | Status::Erased => true,
                Status::Drafted => candidate.status == Status::Ready,
                Status::Rejected => {
                    candidate.status == Status::Ready
                        && kept.quiet_until.is_some_and(|until| until > inputs.now)
                }
                _ => false,
            };
            if stands {
                candidate.status = kept.status;
                candidate.reason = None;
                candidate.quiet_until = kept.quiet_until;
                candidate.promoted_to = kept.promoted_to.clone();
                continue;
            }
        }
        if candidate.status != Status::Ready {
            continue;
        }
        if exists(&candidate.doc)? {
            candidate.status = Status::Skipped;
            candidate.reason = Some(Reason::TargetExists);
            continue;
        }
        match access::rule(inputs.target, &candidate.sources) {
            Rule::Within => candidate.mode = Some(Mode::Scheduled),
            Rule::Widens
                if candidate.own
                    && inputs
                        .consents
                        .iter()
                        .any(|consent| consent.covers(candidate, inputs.principal)) =>
            {
                candidate.mode = Some(Mode::Promoted {
                    by: inputs.principal.to_owned(),
                });
            }
            Rule::Widens | Rule::MoreSensitive => candidate.status = Status::NeedsPromotion,
        }
    }
    let live: Vec<&str> = candidates.iter().map(|c| c.id.as_str()).collect();
    let mut recorded: Vec<Stored> = inputs
        .stored
        .iter()
        .filter(|s| s.status.is_outcome() && !live.contains(&s.id.as_str()))
        .cloned()
        .collect();
    recorded.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(Evaluation {
        candidates,
        recorded,
    })
}
