---
name: triage-issues
description: >
  Triages the AFD backlog: classifies untriaged issues into status, priority,
  execution, risk and needs labels so the software factory's cells can take
  them. Use when triaging, labeling new issues, answering "what can the fleet
  work on?" or before a factory run; `check` reports without writing.
argument-hint: check | limit:<n>
---

# Triage Issues

Triage records **whether** an issue runs and **how**; it never runs anything. This
skill decides; the factory's cells execute the recorded decision without
re-triaging ([software factory](../../../docs/features/proposed/software-factory/software-factory.proposal.md#intake)).

Label definitions live in `.github/labels.json` (`legacy: true` marks a label you
replace and never apply); the rules between labels live in
`scripts/issue-labels.mjs`. Run them rather than checking by eye:

```bash
node scripts/issue-labels.mjs labels [--create-missing]   # GitHub vs the file
node scripts/issue-labels.mjs check [<n>...] [--json]     # open issues: violations, untriaged
node scripts/issue-labels.mjs check --labels status:planned,execution:bounded [--assigned]
node scripts/issue-labels.mjs dispatch [--json]           # what a cell may take, in order
```

Exit 0 is clean, 1 a violation or difference, 2 a failed read. Exit 2 means
"unknown", never "nothing to do": "0 untriaged" from a failed read looks exactly
like a finished pass. The scripts call `gh`; if it is not signed in, stop and say so.

## Modes

| Argument | Mode |
|---|---|
| _(none)_ | Classify every untriaged issue, then repair every violation `check` reports on open issues. |
| `check` | The same pass, reported as proposals. No writes, including label creation. |
| `limit:<n>` | Classify the first n (positive) untriaged issues, oldest first, then by number: a stable prefix, not a sample. Violation repair still covers every open issue. Start a large backlog with `limit:10`. |

## The pass

1. Run `labels`. In a mutating mode, `--create-missing` adds what GitHub lacks;
   applying a nonexistent label fails per issue and the pass looks done when it
   isn't. Extra or changed labels go in the report; the file and GitHub change
   together, in a PR.
2. Run `check`. Untriaged means no status label or only `status:triage`.
   `status:in-progress` is a cell's claim and wins over a leftover
   `status:triage`; never overwrite it.
3. Classify each issue with the questions below. Before writing, run
   `check --labels <final set>` (with `--assigned` if it will be). Write labels and
   assignee in one `gh issue edit`, removing `status:triage` and any legacy or
   conflicting label in the same write.
4. Read back with `check <numbers>`, then `dispatch`, and report counts from the
   readback, never from the writes you issued.

Assume interruption. Label writes re-apply safely; the deferral comment doesn't,
so look for an existing one before commenting.

Re-judge legacy labels rather than mapping them: a legacy `priority:medium` may be
`priority:1` or nothing, and `status:needs-info` or `status:blocked` becomes
`status:deferred` with the reason, or `status:planned` if the reason is gone.

## Classify: the questions, in order

None of them is "is this well specified?" Long acceptance criteria are fine, often
easier for agents; never defer for scope, length or complexity.

1. **What observable consequence is happening now?** Active harm (a published
   package that breaks consumers, a security exposure, lost data): `priority:0`,
   assigned to the owner, and rare. Broken with no workaround: `priority:1`.
   Otherwise standard, with no label but named in the report, so a missing label
   reads as "evaluated", not "forgotten". Judge the consequence, never the
   importance. Two tiers, because a wider scale collapses: everything argues its way
   to the top.
2. **Can and should an agent finish this now?** No only for an unresolved product
   or architecture question only the owner can answer (`needs:decision`);
   credentials, consent, a registry or vendor portal, a tag or a publish
   (`needs:operator`: publishing is the maintainer's, AGENTS.md); an open blocker
   (`blocked`; name the issue or dependency); an epic with open children; or a
   closure candidate with evidence that nothing observable remains (obsolete,
   duplicate, already fixed; a typo is just `bounded` work). Defer:
   `status:deferred`, no execution profile, exactly one comment naming the reason,
   and the owner assigned for decisions, operator work and closure candidates.
3. **If the agent chooses wrong, will anything catch it?** The gates catch
   functional wrongness. They don't catch a plausible but wrong engineering path
   (`needs:approach`), a UX or content judgment (`needs:ux`), or a bug without a
   reliable repro, such as most flakes (`needs:repro`: reproduce first or stop).
   These shape the session; they don't block it.
4. **How wide is the blast radius of the change?** `risk:high` for auth, the wire
   contract (`spec/`), cross-language parity, release or publish tooling, CI policy
   or gate definitions; `risk:medium` for a shared package or contract with bounded
   impact. Risk describes the change, priority the problem.
5. **Which execution profile?** Planned issues get exactly one. Score 0 to 2 each:
   scope and integration breadth; ambiguity and novelty; consequence and
   reversibility; oracle weakness (2 only when the central failure could escape
   every check; a conformance or property test that reliably rejects the wrong
   behavior counts as deterministic). Totals 0–3 suggest `bounded`, 4–6
   `integrative`, 7–8 `deep`; then judge: explicit contracts and cheap checks can
   make large repetitive work bounded, and a small concurrency change may stay
   deep. `frontier` needs a named unresolved question with a demonstrated
   lower-tier reasoning gap; `expert-escalation` is the owner's manual lane. Record
   the scores so a retry can be explained. Model and effort:
   [model routing](../../../docs/operations/model-routing.md).
6. **Does the owner specifically have to be in the loop?** Only then assign them
   (`Falkicon`); the label says why. Unassigned and planned is the factory's queue;
   assigned and planned is the owner's lane. A yes left unassigned is invisible to
   everyone.

Add the `area:` (or `lang:`) label when the area is clear; cells use it to spot
overlapping work.

**Decision or approach.** A decision is a product question only a person can
answer, and it blocks. An approach is an engineering fork an agent can reason about
but shouldn't pick silently: the session posts its proposed path as an issue
comment and proceeds unless the thread objects.

**An answered question plans the issue.** When the owner has replied to a deferred
issue's question, re-classify it this pass: plan it, re-defer it with the new
reason, or name it a closure candidate.

**A failed attempt triggers diagnosis, not promotion.** Repair missing facts,
credentials, environment or checks; change the profile only for a recorded
reasoning gap.

**Stopped work** keeps its owner and unresolved findings and gets one concrete
disposition with a next action. A session ending is no reason to release a live
claim or close the issue.

## Limits

Writes are labels, adding an assignee and one deferral comment. Triage never runs
anything, spawns sessions, closes issues, edits bodies or changes milestones, and
never removes an assignee the owner set on themselves: they know something you
don't. Name a required account or operator action, never a credential.

## Report

```markdown
## Triage — <date>

- Untriaged: N (`issue-labels.mjs check`, exit <code>)
- Priority: P0 #a | P1 #b | standard #c | legacy re-judged #d (old → new)
- <Applied | proposed>: planned #a (<profile>, <needs/risk labels>) | deferred #b (<reason>) | owner #c (<why>)
- Closure candidates: #d (<evidence>) | none
- Readback: N violations; dispatchable N (`issue-labels.mjs dispatch`), first #a, #b, #c
```
