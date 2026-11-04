//! `knowledge-auto-approve` (phase 4 specification, section 8.3; owner decision 1, D98): the one
//! place a proposal is applied without a person deciding it, and only under a rule an area's
//! deployer opted into.
//!
//! ```toml
//! [plugins.knowledge.config.areas.handbook]
//! auto = ["deprecate-declared"]   # default []: off
//! ```
//!
//! **The one rule kind, `deprecate-declared`,** holds for a proposal when all of these do, each
//! read again at the call's `now`:
//! - it is a version 2 `deprecate` drafted by an instance `drafters` still lists, scheduled, with
//!   no memory evidence, `derivedFrom`, candidate or promotion, no flags and no conflict set, and
//!   it names a `supersededBy`;
//! - its recorded area lists the rule and is still the area governing the document, and the
//!   caller is one of that area's approvers;
//! - the target document is readable, not deprecated, at the proposal's `baseHash`, its file holds
//!   exactly those bytes, and its frontmatter names `superseded_by` equal to `supersededBy`;
//! - **those bytes were written by a person's applied proposal that wrote the declaration**: the
//!   document's envelope names exactly one proposal in `derivedFrom`, a record of this instance's
//!   own namespace that is `applied`, for this document, a `create` or `update` decided by a
//!   person and citing no memory, whose content and `result.contentHash` are the document's
//!   bytes, and whose diff adds the frontmatter line that declares `superseded_by`. So a
//!   declaration typed into a file and synced, carried through a later edit or verification, or
//!   claimed by a forged envelope never triggers it;
//! - the successor resolves (`umbel_okf::links::successor`) to a document the caller reads, that is
//!   not deprecated, and that every reader of the target can read (each of the target's access
//!   tokens is in the successor's set).
//!
//! **Never applied, whatever an area lists:** `create`, `update` and `verify`; memory-derived,
//! flagged and alternative proposals. The area's list names only this kind (the configuration
//! schema and [`super::area::load`] refuse any other value), and nothing in the configuration
//! changes what the rule checks.
//!
//! **Who and how.** Command line only, and refused for any call the host attests as a pipeline
//! step (`PROPOSAL_AUTO_NOT_ALLOWED`), so no pipeline, the curator's included, can trigger it; also
//! refused for a caller that is not a person. A proposal that holds is applied through approve's
//! own steps ([`super::apply::apply_by_policy`]) as the policy's decision: `decision.by` is
//! `{ kind: "service", id: "policy:<area>" }`, its `principal` the caller's, `channel = "policy"`,
//! `policy.rule = "auto:deprecate-declared"` with a version covering the area's `auto` list.
//!
//! **Races.** Every write is a compare-and-set against what was checked: the proposal record
//! against the version read here, the file against its hash, which must be the proposal's
//! `baseHash` and so the checked bytes, and the document against its stored hash. A writer that
//! comes between the check and the apply makes it `PROPOSAL_CONFLICT` and changes nothing it did
//! not check. A policy-decided apply that stopped stays `approved` and is resumed by a later call
//! only when the rule holds again in full.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};
use umbel_okf::frontmatter::split;
use umbel_okf::links;
use umbel_sdk::{Cx, HostError, Outcome, failure, success};
use umbel_store::{ContentHash, Document, Status};

use super::apply;
use super::area::{self, Area};
use super::attest;
use super::common::Caller;
use super::model::{CHANNEL_POLICY, KIND, MODE_SCHEDULED, Op, Proposal, State};
use super::propose::{file_path, unavailable};
use crate::fail;

/// The rule kind: a drafted deprecate whose declaration a person's applied proposal wrote.
pub(crate) const DEPRECATE_DECLARED: &str = "deprecate-declared";
/// Every rule kind an area may list (owner decision 1: one).
pub(crate) const RULES: [&str; 1] = [DEPRECATE_DECLARED];

/// The records read from the store at a time.
const PAGE: u32 = 100;
/// `limit`'s default and ceiling: the most proposals one call applies.
const DEFAULT_LIMIT: u64 = 50;
const MAX_LIMIT: u64 = 200;
/// The most skipped and failed proposals the result lists; the counts cover every one.
const MAX_LISTED: usize = 200;

/// `PROPOSAL_AUTO_NOT_ALLOWED` (section 11.3).
fn not_allowed(why: &str, reason: &str) -> Outcome {
    failure(
        "PROPOSAL_AUTO_NOT_ALLOWED",
        &format!("auto-approval is refused: {why}"),
        "Run knowledge-auto-approve yourself on the command line (from cron with --yes); no pipeline step and no agent runs an area's rule.",
    )
    .with_error_details(json!({ "reason": reason }))
    .with_retryable(false)
}

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    // No pipeline triggers an area's rule (section 3.3), whoever ships it: refused before
    // anything is read.
    if cx.call().pipeline.is_some() {
        return not_allowed(
            "the call is a step of a pipeline, and no pipeline, the curator's included, applies a proposal",
            "pipeline",
        );
    }
    let caller = match Caller::new(cx) {
        Ok(caller) => caller,
        Err(outcome) => return outcome,
    };
    if !caller.is_human() || caller.actor.id.is_none() {
        return not_allowed(
            "only a person's call on the command line runs an area's rule",
            "not-a-person",
        );
    }
    let limit = usize::try_from(
        input
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_LIMIT)
            .clamp(1, MAX_LIMIT),
    )
    .unwrap_or(50);
    match run_inner(&caller, limit) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

/// What the rule reads once per call.
struct Context<'c, 'a> {
    caller: &'c Caller<'a>,
    areas: &'c [Area],
    /// The caller's reader tokens in the space.
    tokens: Vec<String>,
    /// The space's collection ids, for resolving `superseded_by`.
    collections: Vec<String>,
    /// The instances `drafters` lists now.
    drafters: Vec<String>,
}

fn run_inner(caller: &Caller<'_>, limit: usize) -> Result<Outcome, Outcome> {
    let cx = caller.cx;
    let space = &caller.space;
    let areas = area::load(cx)?;
    let mut tally = Tally::default();
    if !areas
        .iter()
        .any(|area| area.space == *space && !area.auto.is_empty())
    {
        return Ok(tally.outcome(space, false));
    }
    let tokens = caller.tokens().map_err(|error| fail::host(&error))?;
    let collections = match cx.content_collections(space) {
        Ok(found) => found.into_iter().map(|info| info.id).collect(),
        Err(HostError::NotGranted(_)) => return Err(unavailable()),
        Err(error) => return Err(fail::host(&error)),
    };
    let ctx = Context {
        caller,
        areas: &areas,
        tokens,
        collections,
        drafters: attest::drafters(cx),
    };
    let mut after: Option<String> = None;
    let mut more = false;
    'pages: loop {
        let page = cx
            .record_list(space, KIND, after.as_deref(), PAGE)
            .map_err(|error| fail::host(&error))?;
        for record in &page.items {
            let Some(proposal) = Proposal::from_value(&record.body) else {
                continue;
            };
            let Some((area, rule)) = considered(&ctx, &proposal) else {
                continue;
            };
            if tally.applied.len() >= limit {
                more = true;
                break 'pages;
            }
            tally.examined += 1;
            // Approve's reader rules, and the version every write compares against, read now.
            let (proposal, record) = match apply::readable(caller, &proposal.id) {
                Ok(found) => found,
                // Absent and unreadable are one answer, as for approve.
                Err(outcome) if outcome.as_value()["error"]["code"] == "PROPOSAL_NOT_FOUND" => {
                    tally.skip(&proposal, "not-readable");
                    continue;
                }
                Err(outcome) => {
                    tally.fail(&proposal, &outcome);
                    continue;
                }
            };
            // Decided, withdrawn or applied since it was listed: not this call's to apply.
            if considered(&ctx, &proposal).map(|(found, _)| found.id.as_str())
                != Some(area.id.as_str())
            {
                tally.skip(&proposal, "state");
                continue;
            }
            let verdict = match rule {
                DEPRECATE_DECLARED => deprecate_declared(&ctx, &proposal, area),
                _ => Err(Refusal::Skip("rule")),
            };
            match verdict {
                Err(Refusal::Skip(reason)) => tally.skip(&proposal, reason),
                Err(Refusal::Fail(outcome)) => tally.fail(&proposal, &outcome),
                Ok(()) => {
                    match apply::apply_by_policy(caller, proposal.clone(), record, area, rule) {
                        Ok(outcome) => tally.apply(&proposal, rule, &outcome),
                        Err(outcome) => tally.fail(&proposal, &outcome),
                    }
                }
            }
        }
        match page.next {
            Some(next) => after = Some(next),
            None => break,
        }
    }
    Ok(tally.outcome(space, more))
}

/// The area and rule a proposal is considered under: its recorded area, when that area lists a
/// rule, for a pending proposal, or for an approved one whose apply stopped after that rule
/// decided it. A person's approval that stopped is the person's to resume.
fn considered<'c>(ctx: &Context<'c, '_>, proposal: &Proposal) -> Option<(&'c Area, &'static str)> {
    let area = area::by_id(ctx.areas, &proposal.area)?;
    let rule = RULES.into_iter().find(|rule| area.lists(rule))?;
    match proposal.state {
        State::Pending => Some((area, rule)),
        State::Approved => {
            let decided = proposal.decision.as_ref().is_some_and(|decision| {
                decision.channel.as_deref() == Some(CHANNEL_POLICY)
                    && proposal.policy.rule == format!("auto:{rule}")
            });
            decided.then_some((area, rule))
        }
        _ => None,
    }
}

/// Why a rule does not hold for a proposal.
enum Refusal {
    /// The rule does not hold: a content-free reason code.
    Skip(&'static str),
    /// It could not be checked: a store or grant failure, reported by code.
    Fail(Outcome),
}

impl From<HostError> for Refusal {
    fn from(error: HostError) -> Self {
        Self::Fail(fail::host(&error))
    }
}

/// Whether the proposal's evidence or provenance cites memory, in any form.
fn cites_memory(proposal: &Proposal) -> bool {
    let derived = proposal
        .provenance
        .get("derivedFrom")
        .is_some_and(|value| !value.is_null());
    derived || !proposal.memory_sources().is_empty()
}

/// `deprecate-declared` for `proposal` under `area` (module documentation).
fn deprecate_declared(
    ctx: &Context<'_, '_>,
    proposal: &Proposal,
    area: &Area,
) -> Result<(), Refusal> {
    let skip = |reason| Err(Refusal::Skip(reason));
    let cx = ctx.caller.cx;
    let space = &ctx.caller.space;

    // The proposal: a drafted deprecate and nothing else.
    if proposal.change.op != Op::Deprecate {
        return skip("op");
    }
    let Some(drafter) = proposal.drafter.as_ref().filter(|_| proposal.is_v2()) else {
        return skip("not-drafted");
    };
    if !ctx.drafters.contains(&drafter.instance) {
        return skip("drafter-not-listed");
    }
    if cites_memory(proposal)
        || drafter.mode != MODE_SCHEDULED
        || drafter.candidate.is_some()
        || drafter.promoted_by.is_some()
    {
        return skip("memory");
    }
    if !proposal.flags.is_empty() {
        return skip("flagged");
    }
    if proposal.conflict_set.is_some() {
        return skip("alternative");
    }
    if proposal.redacted.is_some() || proposal.withdrawal.is_some() || proposal.exception.is_some()
    {
        return skip("state");
    }
    let Some(declared) = proposal
        .change
        .superseded_by
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    else {
        return skip("no-successor");
    };

    // The area: the one recorded, still governing the document, with the caller an approver.
    if area::governing(ctx.areas, space, &proposal.change.doc).map(|found| found.id.as_str())
        != Some(area.id.as_str())
    {
        return skip("area-changed");
    }
    if !area.admits(&ctx.tokens) {
        return skip("not-approver");
    }

    // The target, as stored and as the file holds it.
    let Some(target) = cx.doc_get(space, &proposal.change.doc)? else {
        return skip("target-missing");
    };
    if target.write.status == Status::Deprecated {
        return skip("already-deprecated");
    }
    let hash = target.write.content_hash.as_str();
    if proposal.change.base_hash.as_deref() != Some(hash) {
        return skip("target-changed");
    }
    let Ok((collection, file)) = file_path(&proposal.change.doc) else {
        return skip("target-missing");
    };
    match cx.content_read(space, &collection, &file) {
        Ok(bytes) if ContentHash::of(&bytes).as_str() == hash => {}
        Ok(_) => return skip("bytes-changed"),
        Err(HostError::NotFound(_)) => return skip("target-missing"),
        Err(HostError::NotGranted(_)) => return Err(Refusal::Fail(unavailable())),
        Err(error) => return Err(error.into()),
    }
    if target.write.superseded_by.as_deref() != Some(declared) {
        return skip("declaration-differs");
    }

    // The bytes, and the declaration in them, written by a person's applied proposal.
    let Some(writer) = writer(ctx, &target)? else {
        return skip("not-written-by-proposal");
    };
    if !introduces_declaration(&writer) {
        return skip("declaration-not-written");
    }

    // The successor: resolving, readable, not deprecated, and readable by every reader of the
    // target, so no reader is pointed at a document they cannot open.
    let Some(successor) = links::successor(declared, &target.write.id, &ctx.collections) else {
        return skip("successor-missing");
    };
    let Some(successor) = cx.doc_get(space, &successor)? else {
        return skip("successor-missing");
    };
    if successor.write.status == Status::Deprecated {
        return skip("successor-deprecated");
    }
    let theirs = successor.write.access.tokens();
    if !target
        .write
        .access
        .tokens()
        .iter()
        .all(|token| theirs.contains(token))
    {
        return skip("successor-narrower");
    }
    Ok(())
}

/// The applied proposal that wrote `target`'s current bytes, or `None`: the one proposal the
/// document's envelope names, read from this instance's own namespace (no other plugin writes
/// there), applied to this document by a person's decision, a `create` or `update` citing no
/// memory, whose content and recorded result are exactly the document's bytes. An envelope any
/// other writer put proves nothing by itself: the proposal record is what is checked.
fn writer(ctx: &Context<'_, '_>, target: &Document) -> Result<Option<Proposal>, Refusal> {
    let derived = target
        .write
        .envelope
        .derived_from
        .as_deref()
        .unwrap_or_default();
    let [entry] = derived else {
        return Ok(None);
    };
    if entry.kind != "proposal" {
        return Ok(None);
    }
    let Some(record) = ctx
        .caller
        .cx
        .record_get(&ctx.caller.space, KIND, &entry.id)?
    else {
        return Ok(None);
    };
    let Some(writer) = Proposal::from_value(&record.body) else {
        return Ok(None);
    };
    let hash = target.write.content_hash.as_str();
    let content = writer
        .change
        .content
        .as_deref()
        .is_some_and(|content| ContentHash::of(content.as_bytes()).as_str() == hash);
    let result = writer
        .result
        .as_ref()
        .and_then(|result| result.get("contentHash"))
        .and_then(Value::as_str)
        == Some(hash);
    let by_a_person = writer.decision.as_ref().is_some_and(|decision| {
        decision.by.kind == "human" && decision.channel.as_deref() != Some(CHANNEL_POLICY)
    });
    let holds = writer.id == entry.id
        && writer.state == State::Applied
        && writer.space == ctx.caller.space
        && writer.change.doc == target.write.id
        && matches!(writer.change.op, Op::Create | Op::Update)
        && content
        && result
        && by_a_person
        && writer.redacted.is_none()
        && !cites_memory(&writer);
    Ok(holds.then_some(writer))
}

/// Whether `writer`'s diff adds the frontmatter line of its content that declares
/// `superseded_by`: the person who approved it saw the declaration as a change, not as context
/// carried from earlier bytes.
fn introduces_declaration(writer: &Proposal) -> bool {
    let Some(line) = writer.change.content.as_deref().and_then(declaring_line) else {
        return false;
    };
    added_lines(&writer.diff).is_some_and(|added| added.contains(&line))
}

/// The 1-based line of `content` whose top-level frontmatter key `superseded_by` holds its
/// value on that one line, or `None`: no such key, one written another way (a block scalar, an
/// anchor, a tag, an indented or flow mapping), or more than one line naming it. Anything this
/// does not recognise fails closed.
fn declaring_line(content: &str) -> Option<usize> {
    let parts = split(content.as_bytes()).ok()?;
    parts.fields.as_ref()?.get("superseded_by")?.as_str()?;
    // Line 1 is the opening fence and `body_line - 1` the closing one.
    let closing = parts.body_line.checked_sub(1)?;
    let mut found = None;
    for (index, line) in parts.text.lines().enumerate() {
        let number = index + 1;
        if number == 1 {
            continue;
        }
        if number >= closing {
            break;
        }
        let rest = ["superseded_by:", "\"superseded_by\":", "'superseded_by':"]
            .iter()
            .find_map(|key| line.strip_prefix(key));
        if let Some(rest) = rest {
            let value = rest.trim();
            if found.is_some()
                || value.is_empty()
                || value.starts_with(['|', '>', '&', '*', '!', '{', '['])
            {
                return None;
            }
            found = Some(number);
        }
    }
    found
}

/// The 1-based lines of the new file that a unified diff adds, or `None` for a diff that does not
/// read as one.
fn added_lines(diff: &str) -> Option<BTreeSet<usize>> {
    let mut added = BTreeSet::new();
    let mut next: Option<usize> = None;
    for line in diff.lines() {
        if let Some(header) = line.strip_prefix("@@ ") {
            let new_range = header.split(' ').find(|part| part.starts_with('+'))?;
            let start = new_range[1..].split(',').next()?.parse().ok()?;
            next = Some(start);
            continue;
        }
        // The `---` and `+++` header lines come before the first hunk.
        let Some(current) = next.as_mut() else {
            continue;
        };
        match line.as_bytes().first() {
            Some(b'+') => {
                added.insert(*current);
                *current += 1;
            }
            Some(b' ') => *current += 1,
            Some(b'-' | b'\\') => {}
            _ => return None,
        }
    }
    Some(added)
}

/// What one call did, as ids and codes.
#[derive(Default)]
struct Tally {
    examined: usize,
    applied: Vec<Value>,
    skipped: Vec<Value>,
    skipped_count: usize,
    failed: Vec<Value>,
    failed_count: usize,
    reasons: BTreeMap<&'static str, usize>,
}

impl Tally {
    fn skip(&mut self, proposal: &Proposal, reason: &'static str) {
        self.skipped_count += 1;
        *self.reasons.entry(reason).or_default() += 1;
        if self.skipped.len() < MAX_LISTED {
            self.skipped.push(json!({
                "proposal": proposal.id,
                "doc": proposal.change.doc,
                "reason": reason,
            }));
        }
    }

    fn fail(&mut self, proposal: &Proposal, outcome: &Outcome) {
        self.failed_count += 1;
        if self.failed.len() < MAX_LISTED {
            self.failed.push(json!({
                "proposal": proposal.id,
                "doc": proposal.change.doc,
                "code": outcome.as_value()["error"]["code"],
            }));
        }
    }

    fn apply(&mut self, proposal: &Proposal, rule: &str, outcome: &Outcome) {
        self.applied.push(json!({
            "proposal": proposal.id,
            "doc": proposal.change.doc,
            "rule": rule,
            "rev": outcome.as_value()["data"]["document"]["rev"],
        }));
    }

    fn outcome(self, space: &str, more: bool) -> Outcome {
        let applied = self.applied.len();
        let reasoning = if self.examined == 0 && applied == 0 {
            "No pending proposal is in an area that lists an auto-approval rule; the rules are off unless an area lists one.".to_owned()
        } else {
            format!(
                "Applied {applied} proposal(s) under their area's rule as the policy's decision; skipped {} and failed {} of {} examined.",
                self.skipped_count, self.failed_count, self.examined
            )
        };
        success(json!({
            "space": space,
            "applied": self.applied,
            "skipped": self.skipped,
            "failed": self.failed,
            "counts": {
                "examined": self.examined,
                "applied": applied,
                "skipped": self.skipped_count,
                "failed": self.failed_count,
            },
            "reasons": self.reasons,
            "more": more,
            "indexed": false,
            "nextStep": if applied > 0 { json!("knowledge-refresh") } else { Value::Null },
        }))
        .with_reasoning(&reasoning)
    }
}

#[cfg(test)]
mod tests {
    use super::{added_lines, declaring_line};

    #[test]
    fn the_declaring_line_is_a_top_level_one_line_key_of_the_frontmatter() {
        let text = "---\ntitle: Old\nsuperseded_by: handbook/new\n---\nsuperseded_by: body\n";
        assert_eq!(declaring_line(text), Some(3));
        let quoted = "---\ntitle: Old\n\"superseded_by\": \"handbook/new\"\n---\nBody.\n";
        assert_eq!(declaring_line(quoted), Some(3));
        // Not declared, declared only in the body, or written in a way this does not read.
        for text in [
            "---\ntitle: Old\n---\nBody.\n",
            "No frontmatter.\nsuperseded_by: handbook/new\n",
            "---\ntitle: Old\n---\nsuperseded_by: handbook/new\n",
            "---\ntitle: Old\nsuperseded_by: >\n  handbook/new\n---\nBody.\n",
            "---\ntitle: Old\nmeta:\n  superseded_by: handbook/new\n---\nBody.\n",
        ] {
            assert_eq!(declaring_line(text), None, "{text}");
        }
    }

    #[test]
    fn added_lines_follow_the_new_files_numbering() {
        let create =
            "--- /dev/null\n+++ b/old.md\n@@ -0,0 +1,3 @@\n+---\n+superseded_by: x\n+---\n";
        assert_eq!(
            added_lines(create).unwrap().into_iter().collect::<Vec<_>>(),
            [1, 2, 3]
        );
        let update = "--- a/old.md\n+++ b/old.md\n@@ -1,4 +1,5 @@\n ---\n title: Old\n+superseded_by: x\n ---\n-Body.\n+New body.\n\\ No newline at end of file\n";
        assert_eq!(
            added_lines(update).unwrap().into_iter().collect::<Vec<_>>(),
            [3, 5]
        );
        // Context is not added; a later hunk starts at its own line.
        let context = "--- a/old.md\n+++ b/old.md\n@@ -1,3 +1,3 @@\n ---\n superseded_by: x\n ---\n@@ -9,1 +9,1 @@\n-a\n+b\n";
        assert_eq!(
            added_lines(context)
                .unwrap()
                .into_iter()
                .collect::<Vec<_>>(),
            [9]
        );
        assert_eq!(added_lines("@@ -1 +1 @@\nnot a diff line\n"), None);
        assert!(added_lines("").unwrap().is_empty());
    }
}
