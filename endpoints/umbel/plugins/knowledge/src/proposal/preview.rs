//! `knowledge-proposal-preview` (phase 4 specification, section 8.1; D97): the text the command
//! line shows before `knowledge-approve`'s confirmation prompt, and the person page over MCP.
//! `knowledge-rejection-preview` is the same text after the rejection's reason, labelled with who
//! wrote it, for `knowledge-reject` (phase 5 step 6: a person confirms the reason recorded with
//! their decision). It closes phase 2's "must do before real use": the static
//! prompt could not show what a person approves.
//!
//! The preview applies approve's reader rules ([`super::apply::readable`]) and renders any state,
//! so a decision on a proposal that is no longer pending still fails with its own code. When the
//! host runs it as the caller before it asks a person on the person page
//! (`CallContext::person_check`, phase 5 step 6), it first makes every check the decision would
//! make ([`super::apply::check`]), so a call that would be refused (an area without
//! `approve_over_mcp`, a caller that is not an approver, self-approval) is refused before anyone
//! is asked. The person page renders it as the person, without that mark. It shows
//! the id, op, document, area and change hash; the drafter's fields the host attested, apart from
//! the ones this plugin verified against the memory store; the conflict set and the flags; each
//! evidence entry, a memory entry's copied fields labelled as verified and its counts, with the
//! settling instant, labelled as the drafter's policy (section 3.2 says what cannot be verified);
//! the widening line of a promoted draft; and the diff's first [`DIFF_LINES`] lines.
//!
//! Text that came from a proposer or a file is never written where a label could be: single-line
//! values are JSON-quoted, and every diff line is prefixed `| `, so no content line reads as one of
//! the preview's own lines. The command line also sanitises and caps what it shows.

use std::fmt::Write as _;

use serde_json::{Value, json};
use umbel_okf::frontmatter::split;
use umbel_sdk::{Cx, Outcome, failure, success};

use super::apply::{self, readable};
use super::common::Caller;
use super::model::{Drafter, Proposal};

/// The diff lines a preview shows; `knowledge-proposal-show` has the rest.
pub(crate) const DIFF_LINES: usize = 80;

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let caller = match Caller::new(cx) {
        Ok(caller) => caller,
        Err(outcome) => return outcome,
    };
    let id = input
        .get("proposal")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let rejection = cx.call().command == "knowledge-rejection-preview";
    // A rejection's reason, which the person sees and confirms with the decision (step 6).
    let reason = input
        .get("reason")
        .and_then(Value::as_str)
        .filter(|_| rejection);
    // The host's check before it asks a person to decide `knowledge-approve` or
    // `knowledge-reject` on the person page: the decision's own checks first.
    if let Some(check) = &cx.call().person_check {
        let asked = match (check.command.as_str(), rejection) {
            ("knowledge-approve", false) => apply::Asked::Approve,
            ("knowledge-reject", true) => apply::Asked::Reject,
            _ => {
                return failure(
                    "PROPOSAL_APPROVER_NOT_ALLOWED",
                    "this preview is the confirmation of knowledge-approve (knowledge-proposal-preview) or knowledge-reject (knowledge-rejection-preview) only",
                    "Decide the proposal with knowledge-approve or knowledge-reject.",
                );
            }
        };
        if let Err(refused) = apply::check(&caller, asked, id) {
            return refused;
        }
        if matches!(asked, apply::Asked::Reject) && !apply::reason_valid(reason) {
            return apply::reason_required();
        }
    }
    let (proposal, _) = match readable(&caller, id) {
        Ok(found) => found,
        Err(outcome) => return outcome,
    };
    let mut text = String::new();
    if let Some(reason) = reason.filter(|reason| !reason.is_empty()) {
        text.push_str(&reason_block(reason, cx.call().interface == "cli"));
    }
    text.push_str(&render(&proposal));
    success(json!({ "preview": text }))
        .with_reasoning(&format!(
            "Previewed proposal {} for `{}`, {}.",
            proposal.id,
            proposal.change.doc,
            proposal.state.name()
        ))
        .with_metadata("dev.umbel/trust", json!("content"))
}

/// The rejection's reason, first, so no cap on what is shown can cut it: labelled with who wrote
/// it (the person at a terminal, else the asking client), every line prefixed `| ` so none reads
/// as one of the preview's own lines. It is data, as the proposal's text is.
fn reason_block(reason: &str, at_terminal: bool) -> String {
    let mut out = if at_terminal {
        "Reason, as you gave it (recorded with the rejection):\n".to_owned()
    } else {
        "Reason, as written by the requesting client (recorded with the rejection as the client's words; reject only if you agree with it):\n".to_owned()
    };
    for line in reason.lines() {
        out.push_str("| ");
        out.push_str(line);
        out.push('\n');
    }
    out.push('\n');
    out
}

/// A value from a proposer or a file on one line: JSON-quoted, so a newline cannot start a line.
fn quoted(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_default()
}

/// A string field of an evidence entry, or `?` when it is missing.
fn field<'a>(entry: &'a Value, key: &str) -> &'a str {
    entry.get(key).and_then(Value::as_str).unwrap_or("?")
}

/// The preview text of `proposal`.
pub(crate) fn render(proposal: &Proposal) -> String {
    let mut out = String::new();
    let line = |out: &mut String, text: &str| {
        out.push_str(text);
        out.push('\n');
    };
    line(
        &mut out,
        &format!(
            "Proposal {} (version {}), {}",
            proposal.id,
            proposal.version,
            proposal.state.name()
        ),
    );
    line(&mut out, &format!("  op: {}", proposal.change.op.name()));
    line(&mut out, &format!("  document: {}", proposal.change.doc));
    line(&mut out, &format!("  area: {}", proposal.area));
    line(
        &mut out,
        &format!("  change hash: {}", proposal.change_hash),
    );
    line(
        &mut out,
        &format!(
            "  proposer: {} ({})",
            proposal.proposer.principal, proposal.proposer.actor.kind
        ),
    );
    let flags = if proposal.flags.is_empty() {
        "none".to_owned()
    } else {
        proposal.flags.join(", ")
    };
    line(&mut out, &format!("  flags: {flags}"));
    line(
        &mut out,
        &format!(
            "  conflict set: {}",
            proposal.conflict_set.as_deref().unwrap_or("none")
        ),
    );
    if let Some(withdrawal) = &proposal.withdrawal {
        line(
            &mut out,
            &format!(
                "  withdrawn by the {} ({}) at {}",
                withdrawal.by, withdrawal.reason, withdrawal.at
            ),
        );
    }
    if let Some(redacted) = &proposal.redacted {
        line(
            &mut out,
            &format!(
                "  redacted at {} ({}): its content, diff, rationale and excerpts were removed",
                redacted.at, redacted.reason
            ),
        );
    }
    match &proposal.drafter {
        None => line(&mut out, "Drafter: none"),
        Some(drafter) => drafter_lines(
            &mut out,
            drafter,
            settled_at(proposal).as_deref(),
            cites_memory(&proposal.evidence),
        ),
    }
    evidence_lines(&mut out, &proposal.evidence);
    diff_lines(&mut out, &proposal.diff);
    out
}

/// Whether any evidence entry is a memory record's, erased or not.
fn cites_memory(evidence: &[Value]) -> bool {
    evidence
        .iter()
        .any(|entry| entry.get("kind").and_then(Value::as_str) == Some("memory"))
}

/// The drafter's attested fields, its verified ones, the drafter's policy and the widening line.
/// A draft citing no memory record was checked against no memory record, so its line says only
/// what this plugin computed: with no source to widen, the mode is `scheduled` (phase 4 step 3b,
/// amendment 1).
fn drafter_lines(out: &mut String, drafter: &Drafter, settled: Option<&str>, memory: bool) {
    let _ = writeln!(
        out,
        "Drafter, attested by the host: plugin {}, instance {}, pipeline {}, run {}",
        drafter.plugin,
        drafter.instance,
        drafter.pipeline,
        quoted(&drafter.run)
    );
    let mut verified = format!("  mode {}", drafter.mode);
    if let Some(candidate) = &drafter.candidate {
        let _ = write!(verified, ", candidate {candidate}");
    }
    if let Some(by) = &drafter.promoted_by {
        let _ = write!(verified, ", promoted by {by}");
    }
    if !memory {
        let _ = writeln!(
            out,
            "Drafter, checked at submission: it cites no memory record, so it widens no one's readers"
        );
        let _ = writeln!(out, "{verified}");
        return;
    }
    let _ = writeln!(out, "Drafter, verified against memory at submission:");
    let _ = writeln!(out, "{verified}");
    let _ = writeln!(
        out,
        "Drafter's policy, not verified: settled at {}; the settling days, authorities and session floor are the drafter's pack",
        settled.unwrap_or("?")
    );
    if drafter.widens() {
        let principal = drafter.promoted_by.as_deref().unwrap_or("?");
        let _ = writeln!(out, "widens readers: sources private to `{principal}`");
    }
}

/// The content's `generated.at`: a draft's settling instant (phase 4 section 13, point 3).
fn settled_at(proposal: &Proposal) -> Option<String> {
    let content = proposal.change.content.as_deref()?;
    let fields = split(content.as_bytes()).ok()?.fields?;
    fields.get("generated")?.get("at")?.as_str().map(quoted)
}

/// Each evidence entry: a memory entry's copied fields, labelled verified, and its counts,
/// labelled the drafter's policy; an erased one by its reference; any other by kind and ref.
fn evidence_lines(out: &mut String, evidence: &[Value]) {
    let _ = writeln!(out, "Evidence ({}):", evidence.len());
    for (index, entry) in evidence.iter().enumerate() {
        let n = index + 1;
        let kind = field(entry, "kind");
        let reference = field(entry, "ref");
        if kind == "memory" && entry.get("erased") == Some(&Value::Bool(true)) {
            let _ = writeln!(
                out,
                "  {n}. memory {}: erased, its source was forgotten",
                quoted(reference)
            );
            continue;
        }
        if kind != "memory" {
            let hash = entry
                .get("contentHash")
                .and_then(Value::as_str)
                .map(|hash| format!(" at {hash}"))
                .unwrap_or_default();
            let _ = writeln!(out, "  {n}. {kind} {}{hash}", quoted(reference));
            continue;
        }
        let constraints = match entry.get("constraints").and_then(Value::as_array) {
            Some(items) if !items.is_empty() => items
                .iter()
                .map(|item| quoted(item.as_str().unwrap_or("?")))
                .collect::<Vec<_>>()
                .join(", "),
            _ => "none".to_owned(),
        };
        let access = entry
            .get("access")
            .and_then(Value::as_array)
            .map(|tokens| {
                tokens
                    .iter()
                    .map(|token| quoted(token.as_str().unwrap_or("?")))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_else(|| "?".to_owned());
        let confirmation = match entry.get("confirmation") {
            Some(Value::Object(confirmation)) => format!(
                "by {} at {} (was {})",
                confirmation
                    .get("by")
                    .and_then(Value::as_str)
                    .unwrap_or("?"),
                quoted(
                    confirmation
                        .get("at")
                        .and_then(Value::as_str)
                        .unwrap_or("?")
                ),
                confirmation
                    .get("priorAuthority")
                    .and_then(Value::as_str)
                    .unwrap_or("?")
            ),
            _ => "none".to_owned(),
        };
        let count = |key: &str, one: &str, many: &str| match entry
            .get("observations")
            .and_then(|observations| observations.get(key))
            .and_then(Value::as_u64)
        {
            Some(1) => format!("1 {one}"),
            Some(count) => format!("{count} {many}"),
            None => format!("? {many}"),
        };
        let _ = writeln!(
            out,
            "  {n}. memory {}, verified against memory at submission:",
            quoted(reference)
        );
        let _ = writeln!(
            out,
            "       principal {}; class {}; sensitivity {}",
            field(entry, "principal"),
            field(entry, "class"),
            field(entry, "sensitivity")
        );
        let _ = writeln!(
            out,
            "       authority {}; origin {}",
            field(entry, "authority"),
            field(entry, "origin")
        );
        let _ = writeln!(out, "       constraints: {constraints}");
        let _ = writeln!(out, "       access: {access}");
        let _ = writeln!(out, "       confirmation: {confirmation}");
        let _ = writeln!(out, "       content hash: {}", field(entry, "contentHash"));
        let _ = writeln!(
            out,
            "     drafter's policy: observed in {} by {}",
            count("sessions", "session", "sessions"),
            count("principals", "principal", "principals")
        );
    }
}

/// The diff's first [`DIFF_LINES`] lines, each prefixed `| `, and how many more there are.
fn diff_lines(out: &mut String, diff: &str) {
    let lines: Vec<&str> = diff.lines().collect();
    if lines.is_empty() {
        let _ = writeln!(out, "Diff: none");
        return;
    }
    let shown = lines.len().min(DIFF_LINES);
    let _ = writeln!(out, "Diff (lines 1 to {shown} of {}):", lines.len());
    for text in &lines[..shown] {
        let _ = writeln!(out, "| {text}");
    }
    let more = lines.len() - shown;
    if more > 0 {
        let _ = writeln!(
            out,
            "({more} more diff {}: knowledge-proposal-show has the whole diff)",
            if more == 1 { "line" } else { "lines" }
        );
    }
}
