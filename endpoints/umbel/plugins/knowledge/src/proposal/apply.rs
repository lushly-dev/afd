//! Deciding a proposal and applying it (specification sections 9.2 and 9.3): `knowledge-approve`,
//! `knowledge-reject` and `knowledge-verify`, each for a person. Verify is decided at a terminal
//! only. Approve and reject are decided at a terminal, or (phase 5 section 7.3, owner decision 7,
//! D116) over MCP through the approval relay in an area that sets `approve_over_mcp`: the person
//! logs in again on the person page, with user verification, sees the preview and decides, and
//! the host attests that decision on the call ([`umbel_sdk::CallContext::person_decision`]). Before
//! the host asks the person, it runs `knowledge-proposal-preview` as the caller with the same
//! checks ([`check`]), so no person is asked about a call this module would refuse. Every check
//! of a terminal decision holds over MCP: approvers and readers, self-approval through the
//! person's equivalents (D62, D102, section 4.6), approve's re-checks of a draft (D102, D103).
//! Only a version 3 proposal can record a decision over MCP (`decision.channel =
//! "mcp-elicitation"`, `decision.assurance` `verified`); a version 1 or 2 one is decided at a
//! terminal.
//!
//! Approving is a short sequence, each step safe to run again: check the current file against the
//! proposal's `baseHash`, record the decision (`approved`), write the file through the `content`
//! grant with a compare-and-set on its hash, put the document with the proposal as its lineage,
//! record `applied`. A run that stops between steps is resumed by running approve again; it skips
//! what is already done. The file replace and the hash check are not atomic against a writer
//! outside Umbel; Umbel's own writers are serialised by the document store's compare-and-set.
//!
//! A drafted proposal is re-checked at approve (phase 4 section 8.2, D102): the target's readers
//! and sensitivity against what its memory evidence copied, and each source, read again under the
//! approver's reader filter, still readable, live, at its version and as copied. Who authored it
//! comes from the store: approving is self-approval when the approver is the principal of any
//! source record, or its `promotedBy`; the runner of the drafter's pipeline is not its author.
//!
//! Approve never indexes: an indexer applies changes in revision order and approve must not wait
//! on its lock, so the result says `indexed: false` and search reports `INDEX_STALE` until the
//! next `knowledge-index` or `knowledge-refresh`.

use serde_json::{Value, json};
use umbel_okf::frontmatter::split;
use umbel_okf::rewrite_keys;
use umbel_sdk::{Cx, HostError, Outcome, failure, success};
use umbel_store::{ContentHash, Expect, Origin, Record, canonical_json};

use super::area::{self, Area};
use super::checks;
use super::common::{self, Caller};
use super::document::{self, Inherit};
use super::model::{
    ActorRef, CHANNEL_MCP, CHANNEL_POLICY, CHANNEL_TERMINAL, Change, Decision, Op, Policy,
    Proposal, REASON_CLIENT, REASON_PERSON, State,
};
use super::propose::{self, file_path, unavailable};
use crate::fail;

fn host(error: &HostError) -> Outcome {
    match error {
        HostError::TooLarge(_) => failure(
            "PROPOSAL_TOO_LARGE",
            "the proposal does not fit a record (2 MiB)",
            "Propose a smaller file.",
        ),
        other => fail::host(other),
    }
}

/// The frontmatter keys a deprecate or a verify writes, applied to `old_text`; `by` and `at` are
/// the verifying person and time. Every other byte of the file stays as it was.
///
/// # Errors
/// Why the file cannot be rewritten (a sentence naming no content).
pub(crate) fn rewritten(
    old_text: &str,
    change: &Change,
    by: &str,
    at: &str,
) -> Result<String, String> {
    let keys: Vec<(&str, Value)> = match change.op {
        Op::Deprecate => {
            let mut keys = vec![("status", json!("deprecated"))];
            if let Some(next) = &change.superseded_by {
                keys.push(("superseded_by", json!(next)));
            }
            keys
        }
        Op::Verify => {
            let mut verified = verified_list(old_text)?;
            verified.push(json!({ "by": by, "at": at }));
            let mut keys = vec![("verified", Value::Array(verified))];
            if let Some(stale) = change
                .verification
                .as_ref()
                .and_then(|v| v.stale_after.as_ref())
            {
                keys.push(("stale_after", json!(stale)));
            }
            keys
        }
        Op::Create | Op::Update => return Err("only a deprecate or a verify rewrites keys".into()),
    };
    rewrite_keys(old_text, &keys).map_err(|error| error.to_string())
}

/// The file's `verified` entries as a list (a single mapping is a one-element list, as OKF
/// allows).
fn verified_list(text: &str) -> Result<Vec<Value>, String> {
    let parts = split(text.as_bytes()).map_err(|problem| problem.to_string())?;
    Ok(match parts.fields.and_then(|mut f| f.remove("verified")) {
        Some(Value::Array(items)) => items,
        Some(entry @ Value::Object(_)) => vec![entry],
        _ => Vec::new(),
    })
}

/// Whether the file already holds what a deprecate or a verify decided at `at` by `by` writes.
fn effect_present(text: &str, change: &Change, by: &str, at: &str) -> bool {
    let Ok(parts) = split(text.as_bytes()) else {
        return false;
    };
    let fields = parts.fields.unwrap_or_default();
    match change.op {
        Op::Deprecate => {
            fields.get("status") == Some(&json!("deprecated"))
                && change
                    .superseded_by
                    .as_ref()
                    .is_none_or(|next| fields.get("superseded_by") == Some(&json!(next)))
        }
        Op::Verify => verified_list(text).unwrap_or_default().iter().any(|entry| {
            entry.get("by") == Some(&json!(by)) && entry.get("at") == Some(&json!(at))
        }),
        Op::Create | Op::Update => false,
    }
}

/// A proposal and the area that governs it, for a caller who may decide it.
struct Gate {
    proposal: Proposal,
    record: Record,
    area: Area,
}

fn not_approver(why: &str) -> Outcome {
    failure(
        "PROPOSAL_APPROVER_NOT_ALLOWED",
        &format!("the caller may not decide this proposal: {why}"),
        "Ask an approver of the area to decide it; approvers are listed in [plugins.knowledge.config.areas.<id>] in umbel.toml.",
    )
}

/// Approve's reader rules, which the confirmation preview applies too (phase 4 section 8.1): the
/// proposal readable by the caller, and its target too, as the document may have changed since.
/// Absent and unreadable are one answer, so the decision never shows what they may not read.
pub(crate) fn readable(caller: &Caller<'_>, id: &str) -> Result<(Proposal, Record), Outcome> {
    let Some((proposal, record)) = common::get(caller, id).map_err(|e| host(&e))? else {
        return Err(common::not_found());
    };
    // The proposal record carries its target's access set, so reading it proved the caller may
    // read the target; check the target itself too.
    match proposal.change.op {
        Op::Create => {
            let (collection, _) = proposal.split_doc().unwrap_or_default();
            let Some(info) = propose::collection_info(caller.cx, &caller.space, collection) else {
                return Err(unavailable());
            };
            let tokens = caller.tokens().map_err(|e| host(&e))?;
            if !info.access.iter().any(|token| tokens.contains(token)) {
                return Err(common::not_found());
            }
        }
        _ => {
            let readable = caller
                .cx
                .doc_get(&caller.space, &proposal.change.doc)
                .map_err(|e| host(&e))?;
            if readable.is_none() {
                return Err(common::not_found());
            }
        }
    }
    Ok((proposal, record))
}

/// Whether a caller with the effective `principal`, the legacy principals it stands for
/// (`equivalents`, phase 5 section 4.6) and the actor text `actor` wrote one of `authors`
/// (D102): one person's namespaced and legacy principals are one author.
fn is_author(
    authors: &std::collections::BTreeSet<String>,
    principal: &str,
    equivalents: &[String],
    actor: &str,
) -> bool {
    authors.contains(principal)
        || equivalents.iter().any(|legacy| authors.contains(legacy))
        || authors.contains(actor)
}

/// Whether the person deciding on `caller`'s call, as `own` (its effective principal, or its
/// actor for a proposer) and as the actor text `actor`, wrote one of `authors`, its legacy
/// principals (`CallContext::equivalents`) included.
fn caller_wrote(
    authors: &std::collections::BTreeSet<String>,
    caller: &Caller<'_>,
    own: &str,
    actor: &str,
) -> bool {
    is_author(authors, own, &caller.cx.call().equivalents, actor)
}

/// How the person deciding a proposal on this call is proven (phase 5 sections 7.1 and 7.3).
#[derive(Debug, Clone)]
pub(crate) enum Proof {
    /// At the command line: the host's terminal check (D71, D86), not an attestation.
    Terminal,
    /// On the person page, reached over MCP through the approval relay: a fresh login with user
    /// verification by the person the call is for, as the host attests it.
    Verified(umbel_sdk::PersonDecision),
    /// Not yet decided: the host's check before it asks the person (step 6), over MCP.
    Asking,
}

/// The person deciding a proposal on this call.
#[derive(Debug, Clone)]
pub(crate) struct Person {
    /// `decision.by`: a human. At a terminal the caller; over MCP the person the calling client
    /// acts for, who logged in on the person page.
    pub(crate) actor: ActorRef,
    pub(crate) proof: Proof,
}

impl Person {
    /// Whether the decision is made over MCP, through the relay.
    fn over_mcp(&self) -> bool {
        matches!(self.proof, Proof::Verified(_) | Proof::Asking)
    }

    /// `decision.channel` in `proposal`'s version.
    fn channel(&self, proposal: &Proposal) -> Option<String> {
        if self.over_mcp() {
            Some(CHANNEL_MCP.to_owned())
        } else {
            proposal.is_v2().then(|| CHANNEL_TERMINAL.to_owned())
        }
    }

    /// `decision.reasonSource` of a rejection, in a version 3 proposal only: `client` over MCP,
    /// where the asking client wrote the reason and the person saw it on the page; `person` at a
    /// terminal.
    fn reason_source(&self, proposal: &Proposal) -> Option<String> {
        proposal.is_v3().then(|| {
            if self.over_mcp() {
                REASON_CLIENT.to_owned()
            } else {
                REASON_PERSON.to_owned()
            }
        })
    }

    /// `decision.assurance`, in a version 3 proposal only.
    fn assurance(&self, proposal: &Proposal) -> Option<umbel_store::Assurance> {
        if !proposal.is_v3() {
            return None;
        }
        match &self.proof {
            Proof::Terminal => Some(umbel_store::Assurance::terminal()),
            Proof::Verified(decided) => Some(umbel_store::Assurance::verified(
                &decided.namespace,
                &decided.auth_time,
                &decided.acr,
            )),
            Proof::Asking => None,
        }
    }
}

/// The person who decides a proposal on this call, and how they are proven, or the refusal:
/// at a terminal, a human caller with an id and no person-page decision; over MCP, a decision the
/// host attests for this very call, by the person the client acts for. `checking` is the host's
/// check before it asks (step 6), and only [`check`] passes it: then, and only then, the call must
/// carry the host's check mark, for the relay, as the host's own in-process call (no interface),
/// and the person is the one the client acts for. Anything else decides nothing.
pub(crate) fn person_of(caller: &Caller<'_>, checking: bool) -> Result<Person, Outcome> {
    let call = caller.cx.call();
    let refuse = || {
        not_approver(
            "only a person decides a proposal: at a terminal, or on the person page over MCP in an area that sets approve_over_mcp",
        )
    };
    let human = |id: &str| ActorRef {
        kind: "human".to_owned(),
        id: Some(id.to_owned()),
        on_behalf_of: None,
    };
    if checking || call.person_check.is_some() {
        return match (&call.person_check, &caller.actor.on_behalf_of) {
            (Some(check), Some(person))
                if checking
                    && check.surface == "mcp"
                    && call.interface.is_empty()
                    && call.person_decision.is_none() =>
            {
                Ok(Person {
                    actor: human(person),
                    proof: Proof::Asking,
                })
            }
            _ => Err(refuse()),
        };
    }
    match (call.interface.as_str(), &call.person_decision) {
        ("cli", None) if caller.is_human() && caller.actor.id.is_some() => Ok(Person {
            actor: caller.actor.clone(),
            proof: Proof::Terminal,
        }),
        ("mcp", Some(decided))
            if decided.surface == "mcp"
                && !decided.person.is_empty()
                && caller.actor.on_behalf_of.as_deref() == Some(decided.person.as_str()) =>
        {
            Ok(Person {
                actor: human(&decided.person),
                proof: Proof::Verified(decided.clone()),
            })
        }
        _ => Err(refuse()),
    }
}

/// `APPROVAL_RELAY_DISABLED` (phase 5 sections 7.3 and 10.5): a decision over MCP in an area
/// that does not set `approve_over_mcp`. Its `details.area` names the area, which the caller
/// could already learn by reading the proposal.
fn relay_disabled(area: &Area) -> Outcome {
    failure(
        "APPROVAL_RELAY_DISABLED",
        "this proposal's area does not let its approvers decide over MCP",
        "Approve or reject it with the umbel command at a terminal, or ask the operator to set approve_over_mcp for the area in umbel.toml.",
    )
    .with_retryable(false)
    .with_error_details(json!({ "area": area.id }))
}

/// The checks every decision shares: a person ([`person_of`]), approve's reader rules
/// ([`readable`]), over MCP the area's opt-in and a version that can record it, and the area's
/// approvers.
fn gate(caller: &Caller<'_>, person: &Person, id: &str) -> Result<Gate, Outcome> {
    let (proposal, record) = readable(caller, id)?;
    let areas = area::load(caller.cx)?;
    let area = area::by_id(&areas, &proposal.area)
        .or_else(|| area::governing(&areas, &proposal.space, &proposal.change.doc))
        .cloned()
        .ok_or_else(|| {
            failure(
                "PROPOSAL_NO_AREA",
                "no area governs that document any more",
                "Declare an area for its collection in [plugins.knowledge.config.areas] in umbel.toml.",
            )
        })?;
    // The approvers first, so a caller who may not decide learns nothing of the area's opt-in.
    let tokens = caller.tokens().map_err(|e| host(&e))?;
    if !area.admits(&tokens) {
        return Err(not_approver("it is not among the area's approvers"));
    }
    if person.over_mcp() {
        if !area.approve_over_mcp {
            return Err(relay_disabled(&area));
        }
        if !proposal.is_v3() {
            return Err(common::wrong_state(
                &proposal,
                "a version 1 or 2 proposal is decided only at a terminal: its version cannot record a decision made over MCP",
            )
            .with_error_details(json!({ "reason": "proposal-version" })));
        }
    }
    Ok(Gate {
        proposal,
        record,
        area,
    })
}

/// The command a person is asked to decide, in the host's check before it asks (step 6).
#[derive(Debug, Clone, Copy)]
pub(crate) enum Asked {
    Approve,
    Reject,
}

/// The host's check before it asks a person on the person page (step 6): every check the
/// decision itself makes before it writes anything, for the person the client acts for, so a
/// call that would be refused is refused now and no person is asked about it.
pub(crate) fn check(caller: &Caller<'_>, asked: Asked, id: &str) -> Result<(), Outcome> {
    let person = person_of(caller, true)?;
    match asked {
        Asked::Approve => approve_checks(caller, &person, id).map(|_| ()),
        Asked::Reject => reject_checks(caller, &person, id).map(|_| ()),
    }
}

pub(crate) fn approve(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let caller = match Caller::new(cx) {
        Ok(caller) => caller,
        Err(outcome) => return outcome,
    };
    let id = input
        .get("proposal")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match approve_inner(&caller, id) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

fn approve_inner(caller: &Caller<'_>, id: &str) -> Result<Outcome, Outcome> {
    let person = person_of(caller, false)?;
    let (
        Gate {
            proposal,
            record,
            area,
        },
        exception,
    ) = approve_checks(caller, &person, id)?;
    apply(
        caller,
        proposal,
        record,
        &area,
        exception,
        Decider::Person(&person),
    )
}

/// Approve's checks before anything is written: [`gate`], the state, a redaction, a draft's
/// re-checks (section 8.2) and self-approval, with the self-approval exception to record.
fn approve_checks(
    caller: &Caller<'_>,
    person: &Person,
    id: &str,
) -> Result<(Gate, Option<String>), Outcome> {
    let Gate {
        proposal,
        record,
        area,
    } = gate(caller, person, id)?;
    // A redacted draft (an approved one whose source was forgotten before its apply landed)
    // holds nothing to apply (phase 4 section 9.1; step 3b, amendment 12).
    if proposal.redacted.is_some() {
        return Err(failure(
            "PROPOSAL_SOURCE_GONE",
            "a memory record this draft cited was forgotten, and its text was redacted; nothing is applied",
            "Nothing to do: the drafter drafts again from what is still remembered.",
        ));
    }
    if !matches!(proposal.state, State::Pending | State::Approved) {
        return Err(common::wrong_state(
            &proposal,
            "only a pending proposal, or an approved one whose apply stopped, is approved",
        ));
    }
    // A draft's authors are its sources' principals, read from the store now, and its
    // `promotedBy` (section 8.2, D102); nothing in the comparison is the drafter's word, and the
    // runner of the drafter's pipeline is not an author. Before that, 8.2's re-checks: the
    // target's readers, then each source. The approving actor is the person (D62): at a terminal
    // the caller, over MCP the person who logged in on the page, not the client that asked (a
    // person approving their own agent's proposal is allowed and recorded, D62). Their legacy
    // principals are the same person (section 4.6).
    let approver = person.actor.text();
    let self_approval = if proposal.drafter.is_some() {
        let authors = checks::recheck(caller, &proposal)?;
        caller_wrote(&authors, caller, &caller.principal, &approver)
    } else {
        // A verification is the approver's own attestation, not a change someone else wrote
        // (decision D63): applying one's own is not self-approval.
        let proposer = std::collections::BTreeSet::from([proposal.proposer.actor.text()]);
        caller_wrote(&proposer, caller, &approver, &approver) && proposal.change.op != Op::Verify
    };
    let exception = if self_approval {
        if !area.allow_self_approval {
            return Err(failure(
                "PROPOSAL_SELF_APPROVAL",
                "the area does not let an actor approve its own proposal, or a draft of memory records that are its own",
                "Ask another approver of the area, or set allow_self_approval for the area in umbel.toml.",
            ));
        }
        Some("self-approval".to_owned())
    } else {
        None
    };
    Ok((
        Gate {
            proposal,
            record,
            area,
        },
        exception,
    ))
}

/// Who records the decision an apply starts with.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Decider<'r> {
    /// A person ([`Person`]): `decision.by` is the person, `channel` `terminal` or
    /// `mcp-elicitation` with the matching `assurance` (version 3), `policy.rule = "person"`.
    Person(&'r Person),
    /// The area's auto-approval rule (phase 4 section 8.3; step 1, amendment 8): `decision.by` is
    /// `{ kind: "service", id: "policy:<area>" }`, its `principal` the effective principal of the
    /// call that ran the rule, `channel = "policy"` and `policy.rule = "auto:<rule>"`. Never a
    /// person's terminal decision.
    Policy(&'r str),
}

impl Decider<'_> {
    fn actor(self, area: &Area) -> ActorRef {
        match self {
            Self::Person(person) => person.actor.clone(),
            Self::Policy(_) => ActorRef {
                kind: "service".to_owned(),
                id: Some(format!("policy:{}", area.id)),
                on_behalf_of: None,
            },
        }
    }

    fn channel(self, proposal: &Proposal) -> Option<String> {
        match self {
            Self::Person(person) => person.channel(proposal),
            Self::Policy(_) => Some(CHANNEL_POLICY.to_owned()),
        }
    }

    /// `decision.assurance`: a person's, in a version 3 proposal; a policy has none.
    fn assurance(self, proposal: &Proposal) -> Option<umbel_store::Assurance> {
        match self {
            Self::Person(person) => person.assurance(proposal),
            Self::Policy(_) => None,
        }
    }

    fn policy(self, area: &Area) -> Policy {
        match self {
            Self::Person(_) => propose::policy_of(area),
            Self::Policy(rule) => propose::policy_auto(area, rule),
        }
    }
}

/// Apply a proposal the area's auto-approval rule `rule` holds for, as the policy's decision
/// (phase 4 section 8.3), through the same steps as an approval. The caller has checked the rule
/// ([`super::auto`]); a stopped apply that the policy decided resumes here, keeping that decision.
pub(crate) fn apply_by_policy(
    caller: &Caller<'_>,
    proposal: Proposal,
    record: Record,
    area: &Area,
    rule: &str,
) -> Result<Outcome, Outcome> {
    if !proposal.is_v2() {
        // Version 1 has no `channel` to say a policy decided: never decided by one.
        return Err(common::wrong_state(
            &proposal,
            "only a version 2 proposal is decided by an area's rule",
        ));
    }
    // Only a pending proposal, or one this rule decided whose apply stopped: never one a person
    // decided, rejected, withdrew or that is applied.
    let resumes = proposal.state == State::Approved
        && proposal.redacted.is_none()
        && proposal.policy.rule == format!("auto:{rule}")
        && proposal
            .decision
            .as_ref()
            .is_some_and(|decision| decision.channel.as_deref() == Some(CHANNEL_POLICY));
    if proposal.state != State::Pending && !resumes {
        return Err(common::wrong_state(
            &proposal,
            "an area's rule decides only a pending proposal, or resumes the apply it decided",
        ));
    }
    apply(caller, proposal, record, area, None, Decider::Policy(rule))
}

/// Record the decision if it is not recorded, then write the file, the document and `applied`.
fn apply(
    caller: &Caller<'_>,
    mut proposal: Proposal,
    record: Record,
    area: &Area,
    exception: Option<String>,
    decider: Decider<'_>,
) -> Result<Outcome, Outcome> {
    let cx = caller.cx;
    let space = &caller.space;
    let (collection, file) = file_path(&proposal.change.doc)?;
    let info = propose::collection_info(cx, space, &collection);
    let current: Option<Vec<u8>> = match cx.content_read(space, &collection, &file) {
        Ok(bytes) => Some(bytes),
        Err(HostError::NotFound(_)) => None,
        Err(HostError::NotGranted(_)) => return Err(unavailable()),
        Err(error) => return Err(host(&error)),
    };
    let current_hash = current
        .as_ref()
        .map(|bytes| ContentHash::of(bytes).to_string());

    // Who decided and when: a resumed apply keeps the first decision, so the same bytes result.
    let (by, at) = match (&proposal.state, &proposal.decision) {
        (State::Approved, Some(decision)) => (decision.by.text(), decision.at.clone()),
        _ => (decider.actor(area).text(), caller.now.clone()),
    };
    let change = proposal.change.clone();
    let text_now = current
        .as_deref()
        .map(|bytes| String::from_utf8_lossy(bytes).into_owned());

    // What the file must become, and whether it already is.
    let (target, already): (Vec<u8>, bool) = match change.op {
        Op::Create | Op::Update => {
            let wanted = change.content.clone().unwrap_or_default().into_bytes();
            let done = current_hash.as_deref() == Some(ContentHash::of(&wanted).as_str());
            (wanted, done)
        }
        Op::Deprecate | Op::Verify => {
            if text_now
                .as_deref()
                .is_some_and(|text| effect_present(text, &change, &by, &at))
            {
                (current.clone().unwrap_or_default(), true)
            } else if let Some(text) = &text_now {
                let new = rewritten(text, &change, &by, &at).map_err(|why| {
                    failure(
                        "PROPOSAL_APPLY_FAILED",
                        &format!("the file cannot be rewritten: {why}"),
                        "Fix the document's frontmatter, then propose again.",
                    )
                })?;
                (new.into_bytes(), false)
            } else {
                (Vec::new(), false)
            }
        }
    };
    if !already {
        let ready = match change.op {
            Op::Create => current.is_none(),
            _ => current_hash.is_some() && current_hash == change.base_hash,
        };
        if !ready {
            return Err(failure(
                "PROPOSAL_CONFLICT",
                "the file is not the one the proposal was made against; nothing was changed",
                "Read the document again and propose against its current hash.",
            ));
        }
    }

    // Step 1: record the decision.
    let (mut meta_hash, mut last_rev) = (record.content_hash.to_string(), record.rev);
    if proposal.state == State::Pending {
        proposal.state = State::Approved;
        proposal.decision = Some(Decision {
            by: decider.actor(area),
            principal: caller.principal.clone(),
            at: caller.now.clone(),
            reason: None,
            trace_id: caller.cx.call().trace_id.clone(),
            proposer_kind: proposal.proposer.actor.kind.clone(),
            channel: decider.channel(&proposal),
            assurance: decider.assurance(&proposal),
            reason_source: None,
        });
        proposal.exception = exception;
        proposal.policy = decider.policy(area);
        proposal.updated_at = caller.now.clone();
        let meta = save_next(caller, &proposal, &record)?;
        (meta_hash, last_rev) = (meta.content_hash.to_string(), meta.rev);
    }

    // Step 2: the file.
    if !already {
        let expect = match change.op {
            Op::Create => Expect::Absent,
            _ => Expect::Hash(
                ContentHash::parse(&current_hash.clone().unwrap_or_default()).map_err(|_| {
                    failure(
                        "PROPOSAL_CONFLICT",
                        "the file has no hash",
                        "Propose again.",
                    )
                })?,
            ),
        };
        match cx.content_replace(space, &collection, &file, &target, expect) {
            Ok(_) => {}
            Err(HostError::Conflict { .. }) => {
                return Err(apply_failed(
                    caller,
                    &mut proposal,
                    &meta_hash,
                    "the file changed while the proposal was applied",
                ));
            }
            Err(HostError::NotGranted(_)) => return Err(unavailable()),
            Err(error) => return Err(host(&error)),
        }
    }
    let final_hash = ContentHash::of(&target);

    // Step 3: the document.
    let default_type = info
        .as_ref()
        .map_or("document", |info| info.default_type.as_str())
        .to_owned();
    // A person's own proposal is their statement; an agent's, or any drafted one (whoever ran
    // the drafter's pipeline), is an inference (phase 4 section 8.2, D102).
    let doc_origin = if proposal.proposer.actor.kind == "human" && proposal.drafter.is_none() {
        Origin::UserStated
    } else {
        Origin::AgentInferred
    };
    let mut written = None;
    for _ in 0..2 {
        let stored = cx
            .doc_get(space, &proposal.change.doc)
            .map_err(|e| host(&e))?;
        if let Some(stored) = &stored
            && stored.write.content_hash == final_hash
        {
            written = Some((
                stored.rev,
                stored.write.access.tokens().to_vec(),
                stored.write.sensitivity,
            ));
            break;
        }
        let inherit = match (&stored, &info) {
            (Some(stored), _) => Inherit::of_document(stored),
            (None, Some(info)) => Inherit::of_collection(info),
            (None, None) => return Err(unavailable()),
        };
        let write = document::build(
            &proposal,
            target.clone(),
            &file,
            &default_type,
            &inherit,
            &meta_hash,
            doc_origin,
        )
        .map_err(|problem| match problem {
            document::Problem::Frontmatter(reason) => failure(
                "FRONTMATTER_INVALID",
                &format!("the applied file does not read: {reason}"),
                "Fix the proposal's content and propose again.",
            ),
            document::Problem::Access => failure(
                "PROPOSAL_INVALID",
                "the file's access key is not a list of valid tokens",
                "Fix the access key and propose again.",
            ),
        })?;
        let access = write.access.tokens().to_vec();
        let sensitivity = write.sensitivity;
        let expect = stored.as_ref().map_or(Expect::Absent, |stored| {
            Expect::Hash(stored.write.content_hash.clone())
        });
        match cx.doc_put(space, write, expect) {
            Ok(put) => {
                written = Some((put.rev, access, sensitivity));
                break;
            }
            Err(HostError::Conflict { .. }) => {}
            Err(HostError::NotGranted(_)) => return Err(unavailable()),
            Err(error) => return Err(host(&error)),
        }
    }
    let Some((doc_rev, doc_access, doc_sensitivity)) = written else {
        return Err(apply_failed(
            caller,
            &mut proposal,
            &meta_hash,
            "the document store changed while the proposal was applied",
        ));
    };

    // Step 4: applied.
    proposal.state = State::Applied;
    proposal.result = Some(json!({
        "rev": doc_rev,
        "contentHash": final_hash.to_string(),
        "path": file,
    }));
    proposal.updated_at = caller.now.clone();
    let applied_record = Record {
        content_hash: ContentHash::parse(&meta_hash)
            .map_err(|e| fail::host(&HostError::Corrupt(e.to_string())))?,
        rev: last_rev,
        ..record
    };
    let meta = save_next(caller, &proposal, &applied_record)?;
    let mut envelope = applied_record.envelope.clone();
    envelope.origin = Origin::UserStated;
    envelope.access.clone_from(&doc_access);
    envelope.sensitivity = Some(doc_sensitivity);
    envelope.content_hash = Some(final_hash.to_string());
    envelope.confidence = None;
    envelope.derived_from = None;
    // The document's revision as the caller may see it (phase 5 section 9.3), in the data and
    // never in the reasoning's text.
    let shown_rev = caller
        .cx
        .doc_position(&caller.space, doc_rev)
        .map_err(|error| fail::host(&error))?;
    let outcome = success(json!({
        "applied": true,
        "indexed": false,
        "proposal": common::summary(&proposal),
        "document": { "id": proposal.change.doc, "rev": shown_rev, "contentHash": final_hash.to_string() },
        "nextStep": "knowledge-refresh",
    }))
    .with_reasoning(&if caller.cx.call().sealed_positions {
        format!(
            "Applied proposal {} to `{}`; the index is behind until knowledge-refresh runs.",
            proposal.id, proposal.change.doc
        )
    } else {
        format!(
            "Applied proposal {} to `{}` at revision {doc_rev}; the index is behind until knowledge-refresh runs.",
            proposal.id, proposal.change.doc
        )
    })
    .with_metadata(
        "dev.umbel/record",
        json!({ "kind": "proposal", "id": proposal.id, "version": meta.rev }),
    )
    .with_metadata("dev.umbel/provenance", common::provenance_meta(&envelope));
    Ok(outcome)
}

/// Save `proposal` over `record`'s version with the next envelope, compare-and-set.
fn save_next(
    caller: &Caller<'_>,
    proposal: &Proposal,
    record: &Record,
) -> Result<umbel_store::RecordMeta, Outcome> {
    let mut envelope = record.envelope.clone();
    envelope.origin = Origin::UserStated;
    envelope.observed_at.clone_from(&caller.now);
    // A draft keeps naming the memory records it was derived from (D81) until a redaction
    // removes them (section 9.1).
    if proposal.redacted.is_some() {
        envelope.derived_from = None;
    }
    envelope.content_hash =
        Some(ContentHash::of(canonical_json(&proposal.to_value()).as_bytes()).to_string());
    common::save(
        caller,
        proposal,
        envelope,
        Expect::Hash(record.content_hash.clone()),
    )
    .map_err(|error| match error {
        HostError::Conflict { .. } => failure(
            "PROPOSAL_CONFLICT",
            "another process decided or changed the proposal at the same time; nothing more was done",
            "Look at the proposal with knowledge-proposal-show and run the command again if it is still pending.",
        ),
        other => host(&other),
    })
}

/// Note that an apply failed on the proposal (state `approved`, so approve can resume) and answer.
fn apply_failed(
    caller: &Caller<'_>,
    proposal: &mut Proposal,
    meta_hash: &str,
    why: &str,
) -> Outcome {
    proposal.result = Some(json!({ "error": why }));
    proposal.updated_at.clone_from(&caller.now);
    if let Ok(Some((_, record))) = common::get(caller, &proposal.id) {
        let _ = save_next(caller, proposal, &record);
    }
    let _ = meta_hash;
    failure(
        "PROPOSAL_CONFLICT",
        &format!("{why}; the proposal stays approved and can be applied again"),
        "Check the document, then run knowledge-approve again to resume, or reject the proposal.",
    )
}

pub(crate) fn reject(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let caller = match Caller::new(cx) {
        Ok(caller) => caller,
        Err(outcome) => return outcome,
    };
    let id = input
        .get("proposal")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let reason = input
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !reason_valid(Some(reason)) {
        return reason_required();
    }
    match reject_inner(&caller, id, reason) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

fn reject_inner(caller: &Caller<'_>, id: &str, reason: &str) -> Result<Outcome, Outcome> {
    let person = person_of(caller, false)?;
    let Gate {
        mut proposal,
        record,
        area,
    } = reject_checks(caller, &person, id)?;
    proposal.state = State::Rejected;
    proposal.decision = Some(Decision {
        by: person.actor.clone(),
        principal: caller.principal.clone(),
        at: caller.now.clone(),
        reason: Some(reason.to_owned()),
        trace_id: caller.cx.call().trace_id.clone(),
        proposer_kind: proposal.proposer.actor.kind.clone(),
        channel: person.channel(&proposal),
        assurance: person.assurance(&proposal),
        reason_source: person.reason_source(&proposal),
    });
    proposal.policy = propose::policy_of(&area);
    proposal.updated_at.clone_from(&caller.now);
    let meta = save_next(caller, &proposal, &record)?;
    let mut envelope = record.envelope.clone();
    envelope.origin = Origin::UserStated;
    envelope.content_hash = Some(meta.content_hash.to_string());
    Ok(success(json!({
        "rejected": true,
        "proposal": common::summary(&proposal),
    }))
    .with_reasoning(&format!("Rejected proposal {}.", proposal.id))
    .with_metadata(
        "dev.umbel/record",
        json!({ "kind": "proposal", "id": proposal.id, "version": meta.rev }),
    )
    .with_metadata(
        "dev.umbel/provenance",
        common::record_provenance_meta(&proposal, &envelope),
    ))
}

/// Whether `reason` is a rejection's reason: 1 to 2000 characters, not blank.
pub(crate) fn reason_valid(reason: Option<&str>) -> bool {
    reason.is_some_and(|reason| !reason.trim().is_empty() && reason.chars().count() <= 2000)
}

/// `PROPOSAL_REASON_REQUIRED`.
pub(crate) fn reason_required() -> Outcome {
    failure(
        "PROPOSAL_REASON_REQUIRED",
        "a rejection carries a reason of 1 to 2000 characters",
        "Say why: the curator reads the reason on its next run.",
    )
}

/// Reject's checks before anything is written: [`gate`] and the state.
fn reject_checks(caller: &Caller<'_>, person: &Person, id: &str) -> Result<Gate, Outcome> {
    let gate = gate(caller, person, id)?;
    if gate.proposal.state != State::Pending {
        return Err(common::wrong_state(
            &gate.proposal,
            "only a pending proposal is rejected",
        ));
    }
    Ok(gate)
}

/// Apply a proposal the caller, a person at a terminal, just submitted as their own
/// verification: no self-approval exception, because a verification is the approver's
/// attestation, not a change someone else wrote (D63).
pub(crate) fn apply_own(
    caller: &Caller<'_>,
    proposal: Proposal,
    record: Record,
    area: &Area,
) -> Result<Outcome, Outcome> {
    let person = Person {
        actor: caller.actor.clone(),
        proof: Proof::Terminal,
    };
    apply(
        caller,
        proposal,
        record,
        area,
        None,
        Decider::Person(&person),
    )
}

#[cfg(test)]
mod author_tests {
    use super::{caller_wrote, is_author};
    use crate::proposal::common::Caller;
    use crate::proposal::model::ActorRef;
    use std::collections::BTreeSet;
    use umbel_sdk::{CallContext, Cx};

    #[test]
    fn the_approving_caller_is_the_author_of_its_legacy_principals_drafts() {
        let call = |equivalents: Vec<String>| CallContext {
            actor_kind: "human".into(),
            actor_id: Some("corp/ada".into()),
            equivalents,
            ..CallContext::default()
        };
        let legacy = BTreeSet::from(["human:ada".to_owned()]);
        for (equivalents, expected) in [(vec!["human:ada".to_owned()], true), (Vec::new(), false)] {
            let cx = Cx::without_grants(call(equivalents));
            let caller = Caller {
                cx: &cx,
                space: "main".into(),
                now: String::new(),
                now_ms: 0,
                actor: ActorRef {
                    kind: "human".into(),
                    id: Some("corp/ada".into()),
                    on_behalf_of: None,
                },
                principal: "human:corp/ada".into(),
            };
            assert_eq!(
                caller_wrote(&legacy, &caller, "human:corp/ada", "human:corp/ada"),
                expected
            );
        }
    }

    #[test]
    fn a_legacy_principal_is_the_same_author_one_way() {
        let legacy = BTreeSet::from(["human:ada".to_owned()]);
        let equivalents = ["human:ada".to_owned()];
        assert!(is_author(
            &legacy,
            "human:corp/ada",
            &equivalents,
            "human:corp/ada"
        ));
        assert!(!is_author(&legacy, "human:corp/ada", &[], "human:corp/ada"));
        // One way: the legacy principal is not the namespaced one's author.
        let namespaced = BTreeSet::from(["human:corp/ada".to_owned()]);
        assert!(!is_author(&namespaced, "human:ada", &[], "human:ada"));
        assert!(is_author(&namespaced, "human:corp/ada", &[], "agent:x"));
        assert!(is_author(
            &BTreeSet::from(["agent:x".to_owned()]),
            "human:corp/ada",
            &[],
            "agent:x"
        ));
    }
}

#[cfg(test)]
mod person_tests {
    use super::{Proof, person_of};
    use crate::proposal::common::Caller;
    use crate::proposal::model::{ActorRef, Proposal};
    use umbel_sdk::{CallContext, Cx, PersonCheck, PersonDecision};

    // Every field is named today; `..default()` keeps this test building when the host adds one.
    #[allow(clippy::needless_update)]
    fn decided(person: &str, surface: &str) -> PersonDecision {
        PersonDecision {
            surface: surface.into(),
            person: person.into(),
            namespace: "corp".into(),
            auth_time: "2026-11-09T00:00:00.000Z".into(),
            acr: "phr".into(),
            ..PersonDecision::default()
        }
    }

    /// The person deciding on a call through `interface` by an actor of `kind` (`corp/ada` for a
    /// human; `corp/agent` acting for `corp/ada` otherwise), or `None` when refused.
    fn person(
        kind: &str,
        interface: &str,
        decision: Option<PersonDecision>,
        check: Option<&str>,
        checking: bool,
    ) -> Option<(ActorRef, Proof)> {
        let (id, on_behalf_of) = match kind {
            "human" => ("corp/ada", None),
            _ => ("corp/agent", Some("corp/ada".to_owned())),
        };
        let cx = Cx::without_grants(CallContext {
            actor_kind: kind.into(),
            actor_id: Some(id.into()),
            on_behalf_of: on_behalf_of.clone(),
            interface: interface.into(),
            person_decision: decision,
            person_check: check.map(|surface| PersonCheck {
                command: "knowledge-approve".into(),
                surface: surface.into(),
            }),
            ..CallContext::default()
        });
        let caller = Caller {
            cx: &cx,
            space: "alpha".into(),
            now: String::new(),
            now_ms: 0,
            actor: ActorRef {
                kind: kind.into(),
                id: Some(id.into()),
                on_behalf_of,
            },
            principal: "human:corp/ada".into(),
        };
        person_of(&caller, checking)
            .ok()
            .map(|person| (person.actor, person.proof))
    }

    #[test]
    fn over_mcp_only_a_decision_for_the_person_the_client_acts_for_decides() {
        let (actor, proof) = person(
            "agent",
            "mcp",
            Some(decided("corp/ada", "mcp")),
            None,
            false,
        )
        .unwrap_or_else(|| {
            panic!("the attested decision decides");
        });
        assert_eq!(actor.text(), "human:corp/ada");
        assert!(matches!(proof, Proof::Verified(_)));
        // No decision, another person's, or one made for the command line: nothing decides.
        assert!(person("agent", "mcp", None, None, false).is_none());
        assert!(person("agent", "mcp", Some(decided("corp/bo", "mcp")), None, false).is_none());
        assert!(
            person(
                "agent",
                "mcp",
                Some(decided("corp/ada", "cli")),
                None,
                false
            )
            .is_none()
        );
        assert!(person("agent", "mcp", Some(decided("", "mcp")), None, false).is_none());
        // A human over MCP acts for no one: no decision is theirs to carry.
        assert!(
            person(
                "human",
                "mcp",
                Some(decided("corp/ada", "mcp")),
                None,
                false
            )
            .is_none()
        );
        // Elsewhere (an in-process agent, the library) nothing decides.
        assert!(
            person(
                "agent",
                "agent",
                Some(decided("corp/ada", "mcp")),
                None,
                false
            )
            .is_none()
        );
        assert!(person("human", "", None, None, false).is_none());
    }

    #[test]
    fn at_a_terminal_the_person_is_the_caller_and_never_with_a_page_decision() {
        let (actor, proof) = person("human", "cli", None, None, false).unwrap_or_else(|| {
            panic!("the terminal decides");
        });
        assert_eq!(actor.text(), "human:corp/ada");
        assert!(matches!(proof, Proof::Terminal));
        assert!(person("agent", "cli", None, None, false).is_none());
        assert!(
            person(
                "human",
                "cli",
                Some(decided("corp/ada", "cli")),
                None,
                false
            )
            .is_none()
        );
    }

    #[test]
    fn the_hosts_check_before_it_asks_is_for_the_relay_alone() {
        let (actor, proof) = person("agent", "", None, Some("mcp"), true).unwrap_or_else(|| {
            panic!("the relay's check");
        });
        assert_eq!(actor.text(), "human:corp/ada");
        assert!(matches!(proof, Proof::Asking));
        assert!(person("agent", "", None, Some("cli"), true).is_none());
        assert!(person("human", "", None, Some("mcp"), true).is_none());
        assert!(
            person(
                "agent",
                "",
                Some(decided("corp/ada", "mcp")),
                Some("mcp"),
                true
            )
            .is_none()
        );
        // The check only through `check`: the mark alone, as approve and reject see it, decides
        // nothing, even with the host's gate bypassed; `check` without the mark, or from an
        // interface, decides nothing either.
        assert!(person("agent", "", None, Some("mcp"), false).is_none());
        assert!(person("agent", "mcp", None, Some("mcp"), false).is_none());
        assert!(
            person(
                "agent",
                "mcp",
                Some(decided("corp/ada", "mcp")),
                Some("mcp"),
                false
            )
            .is_none()
        );
        assert!(person("human", "cli", None, Some("mcp"), false).is_none());
        assert!(person("agent", "", None, None, true).is_none());
        assert!(person("agent", "mcp", None, Some("mcp"), true).is_none());
        assert!(person("agent", "mcp", Some(decided("corp/ada", "mcp")), None, true).is_none());
    }

    #[test]
    fn the_channel_and_assurance_follow_the_proof_and_the_version() {
        let terminal = super::Person {
            actor: ActorRef {
                kind: "human".into(),
                id: Some("corp/ada".into()),
                on_behalf_of: None,
            },
            proof: Proof::Terminal,
        };
        let verified = super::Person {
            proof: Proof::Verified(decided("corp/ada", "mcp")),
            ..terminal.clone()
        };
        let body = |version: u32| -> Proposal {
            let mut value = serde_json::json!({
                "version": version, "id": "p-0", "idempotencyKey": "k", "changeHash": "h",
                "space": "alpha", "area": "handbook", "state": "pending",
                "change": { "op": "verify", "doc": "handbook/x", "baseHash": "h" },
                "diff": "", "rationale": "r", "evidence": [], "provenance": {},
                "policy": { "area": "handbook", "version": "v", "rule": "person" },
                "exception": null, "proposer": { "actor": { "kind": "agent" }, "principal": "agent:x" },
                "confidence": null, "decision": null, "result": null, "flags": [],
                "createdAt": "", "updatedAt": "",
            });
            if version >= 2 {
                for key in ["drafter", "conflictSet", "withdrawal", "redacted"] {
                    value[key] = serde_json::Value::Null;
                }
            }
            Proposal::from_value(&value).unwrap_or_else(|| panic!("a proposal {version}"))
        };
        assert_eq!(terminal.channel(&body(3)).as_deref(), Some("terminal"));
        assert_eq!(
            terminal.assurance(&body(3)),
            Some(umbel_store::Assurance::terminal())
        );
        assert_eq!(terminal.channel(&body(2)).as_deref(), Some("terminal"));
        assert_eq!(terminal.assurance(&body(2)), None);
        assert_eq!(terminal.channel(&body(1)), None);
        assert_eq!(
            verified.channel(&body(3)).as_deref(),
            Some("mcp-elicitation")
        );
        assert_eq!(
            verified.assurance(&body(3)),
            Some(umbel_store::Assurance::verified(
                "corp",
                "2026-11-09T00:00:00.000Z",
                "phr"
            ))
        );
        assert_eq!(verified.assurance(&body(2)), None);
        // Who wrote a rejection's reason, in version 3 alone: the client over MCP.
        assert_eq!(verified.reason_source(&body(3)).as_deref(), Some("client"));
        assert_eq!(terminal.reason_source(&body(3)).as_deref(), Some("person"));
        assert_eq!(verified.reason_source(&body(2)), None);
    }
}
