# Agent-First Design: Phase A specification

| Field | Value |
| --- | --- |
| Epic | [#2544](https://github.com/lushly-dev/afd/issues/2544) (Q4 follow-up: [#2545](https://github.com/lushly-dev/afd/issues/2545)) |
| Proposal & status | [`agent-first-design.proposal.md`](agent-first-design.proposal.md), [`STATUS.md`](STATUS.md) |
| Phase 0 record | [`bench/record/README.md`](bench/record/README.md) (step 0.6 **go with changes**, 2026-11-24, [#2530](https://github.com/lushly-dev/afd/pull/2530)) |
| Companion amendments applied to | [Patterns](../patterns/spec.md#8-amendment-agent-first-design-phase-a-approved-2026-11-24), [Design Decisions](../design-decisions/design-decisions.proposal.md#amendment-agent-first-design-phase-a-approved-2026-11-24), [Screens from Jobs](../screens-from-jobs/screens-from-jobs.proposal.md#10-measurement-and-exit-criteria) |
| Scenarios | [`scenarios/`](scenarios/) — 12 ranked jobs (5 in `slice-1`, 7 in `slice-2`; 58 steps) |

## Status

- **State:** Approved Phase A specification (merged 2026-11-24 in [#2537](https://github.com/lushly-dev/afd/pull/2537);
  all four companion amendments in [section 4](#4-proposed-amendments-for-the-owner) accepted by
  the owner on 2026-11-24 and applied to Patterns, Design Decisions, Screens from Jobs, and
  `agent-first-design.proposal.md` §10). Promoted from `proposed/` to
  `docs/features/active/agent-first-design/` under Epic [#2544](https://github.com/lushly-dev/afd/issues/2544).
- **Phase 0 inputs folded into this specification:**
  - Step 0.1 showed agents already pass nine checks in ten on result-state stories without a
    default pattern set; steps 0.2 and 0.5 stay deferred, so `afd-defaults` is specified as an
    inspectable, versioned pattern library without assuming a mandatory skill.
  - Step 0.3 proved a modality-enforced persona panel finds 12 of 12 planted faults (20/20
    sampled matches right, 23/30 other findings real on independent review).
  - Step 0.4 and the walk-tuning rerun proved three operational requirements folded directly into
    `panel-walk` and `panel-review` below: (1) pass the application's fixed date (`appDate`) in
    the walk prompt so personas judge screen dates against it; (2) require an explicit `Done.` or
    `Stopped, because` ending line; (3) judge clean-vs-changed walks by a blind pairwise report
    comparison beside the journal path so worked-around perception trouble is caught.
- **Companion amendments applied (2026-11-24):** All four amendments in
  [section 4](#4-proposed-amendments-for-the-owner) were accepted by the owner and applied to
  [`../patterns/spec.md`](../patterns/spec.md#8-amendment-agent-first-design-phase-a-approved-2026-11-24),
  [`../design-decisions/design-decisions.proposal.md`](../design-decisions/design-decisions.proposal.md#amendment-agent-first-design-phase-a-approved-2026-11-24),
  [`../screens-from-jobs/screens-from-jobs.proposal.md`](../screens-from-jobs/screens-from-jobs.proposal.md#10-measurement-and-exit-criteria),
  and [`agent-first-design.proposal.md` §10](agent-first-design.proposal.md#10-out-of-scope).

---

## 1. Command surface

Fifteen commands cover all twelve ranked jobs in
[section 4 of the proposal](agent-first-design.proposal.md#4-draft-jobs): five existing commands
from Patterns, Design Decisions and Umbel (reused or amended) and ten new commands (eight drafted
initially, plus `design-release` and `specimen-pattern-merge` added after the three-seat walks).
Every command returns an AFD `CommandResult`, every error carries a `suggestion` naming tools on
the same host or a clear handoff, every new command declares an `outputBudget`, and every report
command includes `unmeasured` so products adopting by degrees never fail for having less set up
(job 14).

### 1.1 Command summary

| Command | Owner / home | Kind | Slice | Jobs |
| --- | --- | --- | --- | --- |
| `design-states` | New (`specimen-server` / `endpoints/specimen-cli`) | Read | `slice-1` | 6, 7, 14 |
| `design-card-list` | New (Design Decisions / `specimen-server`) | Read | `slice-1` | 10, 9, 4, 14 |
| `design-release` | New (Design Decisions / `specimen-server`), `confirmationMode: 'host-verified'` | Mutation | `slice-1` | 10, 15 |
| `design-observe` | New (Screens from Jobs / `specimen-server`) | Read | `slice-2` | 15 |
| `panel-walk` | New (Phase C runner on `specimen-server`), `long-running`, `task: optional` | Mutation | `slice-1` | 8 |
| `panel-review` | New (Phase C orchestrator on `specimen-server`), `long-running`, `task: optional` | Mutation | `slice-1` | 9 |
| `panel-calibrate` | New (Phase C calibration on `specimen-server`), `confirmationMode: 'host-verified'` | Mutation | `slice-2` | 12 |
| `specimen-pattern-fork` | New (Patterns amendment / `specimen-server`) | Mutation | `slice-2` | 2 |
| `specimen-pattern-compare` | New (Patterns amendment / `specimen-server`) | Read | `slice-2` | 5, 4 |
| `specimen-pattern-merge` | New (Patterns amendment / `specimen-server`) | Mutation | `slice-2` | 5 |
| `components-pattern-list` | Existing (Patterns / Umbel A31, amended) | Read | `slice-1` | 1 |
| `components-brief` | Existing (Umbel `components`, amended) | Read | `slice-1` | 1, 2, 7 |
| `specimen-validate` | Existing (Patterns / `specimen-server`, amended) | Read | `slice-2` | 4 |
| `specimen-review` | Existing (Design Decisions / `specimen-server`) | Read | `slice-1` | 10 |
| `decision-record` | Existing (Design Decisions / `specimen-server`, amended), `confirmationMode: 'host-verified'` over MCP | Mutation | `slice-1` | 10, 9, 2, 5 |

### 1.2 Shared types, IDs and the ten default patterns

Identifiers follow Design Decisions and Screens from Jobs: 12-character Crockford base-32
(`[0-9a-hjkmnp-tv-z]{12}`) with typed prefixes (`dec-<12>`, `card-<12>`, `walk-<12>`,
`run-<12>`, `cal-<12>`). Tracked records live under `specimens/` (append-only decisions under
`specimens/decisions/`, append-only release manifests under `specimens/releases/<release>.json`,
and approved patterns under `specimens/patterns/`); scratch walk logs and capture blobs live
under `.specimen/`.

**Canonical `afd-defaults@1.0.0` result-state pattern IDs (10, alphabetical as sorted by Umbel A31.3):**
`alternatives-and-confidence`, `approval-request`, `batch-partial-failure`, `collection-states`,
`destructive-confirm`, `error-recovery`, `evidence-and-sources`, `progress-and-plan`,
`undo-offer`, `warnings-banner`.
*(The approver's side of an approval queue remains an open follow-up in [`STATUS.md`](STATUS.md#follow-ups-not-yet-issues).)*

```ts
export type ApprovalStatus = 'proposed' | 'approved' | 'deprecated';

export interface UnmeasuredEntry {
	area: string;
	reason: string;
	addToMeasure: string;
}

export type RefusalScope = 'unsafe' | 'wrong-for-context' | 'not-a-priority';

export type EscalationTrigger =
	| 'split-3-to-2'
	| 'conflicts-recorded-decision'
	| 'no-precedent'
	| 'guidance-change'
	| 'irreversible-or-default';

export type Modality = 'pointer' | 'keyboard' | 'screen-reader' | 'low-vision';
```

### 1.3 New command contracts

#### `design-states` (Read, `slice-1`, `outputBudget: { defaultBytes: 32768, maxBytes: 98304 }`)

Names every screen state a set of commands or a job scenario can produce, mapped to the pattern
that covers each state. Reads the product's command manifest configured in `specimen.config.json`
(or an explicit `scenario` path).

- **Input:** `{ commands?: string[], scenario?: string, consumer?: string, includeProposed?: boolean, limit?: number, after?: string }`
  (at least one of `commands` or `scenario` is required; empty fails with `NO_COMMANDS`).
- **Result:**
  ```ts
  {
    defaultsVersion: string;          // e.g. 'afd-defaults@1.0.0'
    states: Array<{
      id: string;                     // e.g. 'error-recovery', 'progress-and-plan'
      command: string;
      trigger: string;                // contract field or refusal code
      pattern: string;                // '<library>/<pattern>' after approved patternBindings
      source: 'default' | 'copied' | 'replaced' | 'product';
      approvalStatus: ApprovalStatus; // only 'approved' unless includeProposed: true
      setup: string;                  // wire fixture or scenario step forcing this state
    }>;
    next?: string;                    // pagination cursor when more states remain
    nextSteps: string[];              // concrete follow-up steps (names target host when cross-server)
    unmeasured: UnmeasuredEntry[];
  }
  ```
- **Errors:** `NO_COMMANDS`, `TARGET_COMMAND_NOT_FOUND` (distinct from AFD's MCP router `COMMAND_NOT_FOUND`).

#### `panel-walk` (Mutation, `slice-1`, `executionTime: 'long-running'`, `task: 'optional'`, `outputBudget: { defaultBytes: 24576, maxBytes: 65536 }`)

Runs one persona walk against a running application with strict modality enforcement. Deliberately
declares no `approval` gate because AFD forbids registering `task` alongside an approval
(`spec/command-metadata.md:41`). The runner enforces the modality's tool table unconditionally at
runtime; if a caller passes `requestedTools` asking for a tool outside that table (e.g. `click` or
`dom_query` under `screen-reader`), `panel-walk` refuses pre-flight with `MODALITY_FORBIDDEN`.

- **Input:**
  `{ job: string, persona: string, modality: Modality, target: string, appDate?: string, maxActions?: number, baselineWalk?: string, requestedTools?: string[] }`
  - Default `maxActions`: 60. `appDate` (`YYYY-MM-DD`, aligned with the application fixture clock)
    is injected into the walk prompt; omitting `appDate` succeeds but adds a `fixed-clock` entry
    to `unmeasured` because phase 0 proved clock mismatch causes false positives.
- **Result:**
  ```ts
  {
    walk: string;                     // 'walk-<12>'
    job: string;
    persona: string;
    modality: Modality;
    ending: 'done' | 'stopped';       // required separate last line
    actions: number;
    path: {
      done: boolean;
      failed: number;
      repeats: number;
      outside: number;
      deviations: number;             // failed + repeats + outside (0 on a clean path)
    };
    findings: Array<{
      summary: string;
      evidence: 'observed' | 'hypothesis';
      where: string;
    }>;
    comparison?: {                    // present when baselineWalk is supplied (step 0.4 measure)
      baselineWalk: string;
      method: 'blind-pairwise-report';
      worse: 'current' | 'baseline' | 'same';
      why: string;
    };
    unmeasured: UnmeasuredEntry[];    // always names forced-colors and motion when absent
  }
  ```
- **Errors:** `MODALITY_FORBIDDEN`, `JOB_NOT_FOUND`, `PERSONA_NOT_FOUND`, `WALK_NOT_FOUND`.

#### `panel-review` (Mutation, `slice-1`, `executionTime: 'long-running'`, `task: 'optional'`, `outputBudget: { defaultBytes: 32768, maxBytes: 98304 }`)

Orchestrates a multi-persona panel across one or more jobs for a proposed change, measures
overlap across modalities and model families, settles uncontroversial items provisionally, and
emits decision cards only for items that hit one of the five escalation triggers. Deliberately
declares no `approval` gate because AFD forbids registering `task` alongside an approval
(`spec/command-metadata.md:41`).

- **Input:**
  - Review mode (default): `{ action?: 'review', change: string, author?: string, jobs: string[], target: string, appDate: string, captures?: { before?: string, after?: string }, panelSize?: number, budget?: { maxRounds?: number, maxCostUsd?: number }, baseline?: string }`
  - Withdraw mode (recovery from a misconfigured bulk run): `{ action: 'withdraw', run: string, reason: string }` — marks still-open cards and provisional settlements from `run` as `withdrawn` so they neither pollute `design-card-list` nor poison `panel-calibrate`. Cards already decided by a person are never withdrawn (`preservedDecidedCards`).
  - **Server-derived author check:** The server derives the change's author from the `change`
    record or git commit metadata (optional input `author` is cross-checked only, never trusted as
    authoritative). When the invoking reviewer's verified `ctx.actor.id` matches the derived
    author, `panel-review` refuses with `AUTHOR_CANNOT_REVIEW`. If `ctx.actor.id` is absent (for
    example, unauthenticated stdio MCP), `panel-review` refuses with `AUTHOR_CANNOT_REVIEW` by
    default unless the workspace explicitly permits unverified local runs, in which case it
    records `reviewer-identity` in `unmeasured`.
  - Pre-flight budget refusal: returns `BUDGET_EXCEEDED` when `maxRounds === 0`, `maxCostUsd === 0`,
    or the change's budget is already exhausted before launching a round. If a round stops
    mid-flight on budget after completing a valid quorum, it returns `success: true` with
    `stoppedBy: 'budget'` and the cards already produced.
- **Result (review mode):**
  ```ts
  {
    run: string;                      // 'run-<12>' linking walks, provisional items and cards
    round: number;
    panelSize: number;                // default 5
    walks: string[];                  // walk ids run in this round
    overlap: {
      families: string[];
      sharedFindings: number;
      uniqueFindings: number;
    };
    provisional: Array<{
      item: string;
      summary: string;
      decidedBy: { kind: 'panel'; reviewers: string[]; split: string };
      provisional: true;
    }>;
    escalated: Array<{
      card: string;                   // 'card-<12>'
      trigger: EscalationTrigger;
      split?: string;                 // e.g. '3-2'
      question: string;
      evidenceForBothSides: { for: string[]; against: string[] };
    }>;
    stoppedBy: 'converged' | 'gate-regression' | 'budget' | 'no-new-findings' | null;
    nextSteps: string[];              // directs caller to design-card-list; never to self-approve
    unmeasured: UnmeasuredEntry[];
  }
  ```
- **Result (withdraw mode):**
  ```ts
  {
    run: string;
    withdrawn: true;
    withdrawnCards: string[];         // open/provisional cards marked 'withdrawn'
    withdrawnProvisional: number;     // provisional items removed from panel-calibrate pool
    preservedDecidedCards: string[];  // person-decided cards left intact
    reason: string;
  }
  ```
- **Errors:** `AUTHOR_CANNOT_REVIEW`, `BUDGET_EXCEEDED`, `JOB_NOT_FOUND`, `RUN_NOT_FOUND`.

#### `design-card-list` (Read, `slice-1`, `outputBudget: { defaultBytes: 32768, maxBytes: 98304 }`)

Returns the pre-ship queue of decision cards sorted by severity and paged by cursor, unifying
interface changes (from `specimen-review`), panel escalations (from `panel-review`) and
guidance changes (pattern forks, upstream merges and `keep` waivers). Provisional panel
settlements and withdrawn cards are **excluded by default** (`includeProvisional: false`) so a
person sees only points that need their decision (job 9).

- **Input:** `{ scope?: 'all' | 'release' | 'guidance' | 'interface', card?: string, status?: 'open' | 'deferred' | 'changes-requested' | 'withdrawn' | 'all', severity?: 'blocker' | 'major' | 'minor', includeProvisional?: boolean, includeDecided?: boolean, limit?: number, after?: string }`
  (default `limit`: 10; passing `card` fetches one card in full detail and fails with
  `CARD_NOT_FOUND` if the id does not exist).
- **Result:**
  ```ts
  {
    page: string;                     // local visual review page URL, e.g. 'cards.html?scope=release'
    cards: Array<{
      card: string;                   // 'card-<12>'
      run?: string;                   // 'run-<12>' when emitted by panel-review
      what: string;
      owner: 'default' | 'company' | 'product';
      touches: string[];
      severity: 'blocker' | 'major' | 'minor';
      visual: {
        kind: 'captures' | 'transcript' | 'diff';
        before?: string;              // artifact path (never inline image/blob)
        after?: string;               // artifact path
        context?: { state?: string; viewport?: string; theme?: string; modality?: Modality };
        summary: string;
      };
      why: {
        findings: Array<{ summary: string; evidence: 'observed' | 'hypothesis' }>;
        evidenceForBothSides?: { for: string[]; against: string[] };
        reviewerCount: number;
        split: string;
        trigger: EscalationTrigger | 'pre-ship-release' | 'keep-waiver';
      };
      effect: {
        gatesBefore: { passed: number; failed: number };
        gatesAfter: { passed: number; failed: number };
        checksSummary?: string;       // check-level delta when available
        regression: boolean;
      };
      risk: { affects: string[]; undoable: boolean };
      status: 'open' | 'provisional' | 'approved' | 'changes-requested' | 'rejected' | 'deferred' | 'withdrawn';
    }>;
    total: number;
    more: number;
    next?: string;                    // pagination cursor
    unmeasured: UnmeasuredEntry[];
  }
  ```
- **Errors:** `CARD_NOT_FOUND` (when `card` is passed and does not exist).

#### `design-release` (Mutation, `slice-1`, `confirmationMode: 'host-verified'`, `outputBudget: { defaultBytes: 16384, maxBytes: 49152 }`)

Enforces the pre-ship release gate (job 10: *"nothing reaches users that I did not approve"*) and
writes an append-only release manifest at `specimens/releases/<release>.json` marking the named
approved decisions as `released` with a timestamp so post-release observation (`design-observe`,
job 15) can compare journals before and after the release.

- **Input:** `{ release: string, decisions: string[], scope?: 'all' | 'release' | 'guidance' | 'interface', releasedAt?: string }`
  - `decisions` requires `minItems: 1`. Every id must exist (`DECISION_NOT_FOUND`), must be a
    non-provisional person `approve` decision (`DECISION_NOT_APPROVED` for `reject`, `defer`,
    `request-changes`, or `provisional: true`), and must not already belong to a different release
    (`DECISION_NOT_APPROVED`; re-calling with the identical `(release, decisions)` pair is
    idempotent).
  - Requires static `confirmationMode: 'host-verified'` (`HumanRelay`, `spec/command-metadata.md:40,145-158`),
    or outside MCP an interactive review-page/CLI prompt (`decidedBy: { kind: 'person', channel: 'review-page' | 'cli' }`).
    `HumanRelay` returns `CONFIRMATION_REQUIRED` when unavailable or `CONFIRMATION_DECLINED` when
    declined (`spec/command-metadata.md:157,199`), while the handler refuses non-person actors
    with `PERSON_REQUIRED`.
  - Release gate scope: defaults to `scope: 'all'` (deliberately global across `release`,
    `guidance`, and escalated cards unless narrowed to a named scope). Refuses with
    `UNAPPROVED_CARDS_OPEN` while any card in scope has status `open` or `changes-requested`
    (`deferred` cards do not block release and remain listed under `status: 'deferred'`).
  - `releasedAt` defaults to the server clock; an explicit override is accepted only for
    deterministic fixtures or recorded release backfills and may not predate the latest decision's
    approval timestamp.
- **Result:**
  ```ts
  {
    release: string;
    manifestPath: string;             // 'specimens/releases/<release>.json'
    releasedAt: string;               // ISO-8601 timestamp
    decisions: string[];              // decision ids marked released
    nextSteps: string[];              // points to design-observe once post-release journals exist
    unmeasured: UnmeasuredEntry[];
  }
  ```
- **Errors:** `PERSON_REQUIRED`, `UNAPPROVED_CARDS_OPEN`, `DECISION_NOT_FOUND`, `DECISION_NOT_APPROVED`.

#### `specimen-pattern-fork` (Mutation, `slice-2`, Patterns amendment, `outputBudget: { defaultBytes: 16384, maxBytes: 49152 }`)

Copies an upstream pattern file into the product's own library with a recorded `derivedFrom`
source and per-statement digests, and sets `approvalStatus: 'proposed'` so a person approves
it before agents receive it by default. Never silently overwrites an existing local pattern.

- **Input:** `{ source: string, target?: string, bind?: boolean }`
  - `source` is `<library>/<pattern>` (e.g. `afd-defaults/error-recovery`).
  - `target` defaults to the source pattern id under the local library.
  - `bind: true` records a pending binding `"<source>": "<localLibrary>/<target>"` in
    `specimen.config.json` (and compiled pack bindings). While the forked copy is still
    `approvalStatus: 'proposed'`, `components-brief` and `design-states` continue resolving
    `<source>` to the approved upstream default (unless `includeProposed: true`). Once a person
    approves `card` via `decision-record`, `approvalStatus` flips to `'approved'` atomically and
    the binding becomes active.
- **Result:**
  ```ts
  {
    pattern: string;
    path: string;                     // 'specimens/patterns/<target>/pattern.json'
    approvalStatus: 'proposed';
    derivedFrom: {
      library: string;
      pattern: string;
      version: string;
      revision: string;
      statements: Record<string, string>; // statement id -> sha256 digest at fork time
    };
    bindingStatus: 'pending-approval' | 'unbound';
    card: string;                     // decision card created for person approval
    nextSteps: string[];              // directs person to approve card via decision-record
  }
  ```
- **Errors:** `PATTERN_UNKNOWN` *(dual use: also a `specimen-validate` issue code in Patterns)*,
  `ALREADY_EXISTS` (suggests choosing a new `target` or comparing/editing the existing copy with
  `specimen-pattern-compare`; never suggests blind overwrite).

#### `specimen-pattern-compare` (Read, `slice-2`, Patterns amendment, `outputBudget: { defaultBytes: 32768, maxBytes: 98304 }`)

Compares one copied pattern (or all copied patterns in summary form when `pattern` is omitted)
against its upstream source statement by statement using the `derivedFrom.statements` (and
`derivedFrom.declined`) digests recorded when it was forked or last merged.

- **Input:** `{ pattern?: string, upstreamVersion?: string, onlyChanged?: boolean }`
  (default `onlyChanged: true` so unchanged statements do not waste context; pass `onlyChanged: false` for the full list).
- **Result (single pattern):**
  ```ts
  {
    pattern: string;
    source: { library: string; pattern: string; baseVersion: string; currentVersion: string };
    statements: Array<{
      id: string;
      section: 'useWhen' | 'avoidWhen' | 'keep' | 'customize';
      status: 'unchanged' | 'changed-here' | 'changed-upstream' | 'changed-both' | 'dropped-here' | 'added-upstream' | 'declined';
      waiverReason?: string;          // present when a 'keep' statement is 'dropped-here'
      localText?: string;
      upstreamText?: string;
    }>;
    waivers: Array<{ id: string; reason: string }>;
    nextSteps: string[];              // points to specimen-pattern-merge to stage chosen updates
    unmeasured: UnmeasuredEntry[];
  }
  ```
- **Result (bulk summary, when `pattern` is omitted):**
  ```ts
  {
    patterns: Array<{
      pattern: string;
      source: { library: string; pattern: string; baseVersion: string; currentVersion: string };
      counts: {
        changedHere: number;
        changedUpstream: number;
        changedBoth: number;
        droppedHere: number;
        addedUpstream: number;
        declined: number;
      };
      waivers: number;
    }>;
    nextSteps: string[];
    unmeasured: UnmeasuredEntry[];
  }
  ```
- **Errors:** `PATTERN_UNKNOWN`, `NOT_A_COPIED_PATTERN`.

#### `specimen-pattern-merge` (Mutation, `slice-2`, Patterns amendment, `outputBudget: { defaultBytes: 16384, maxBytes: 49152 }`)

Stages selected upstream statement updates (and explicitly declined upstream additions) from
`specimen-pattern-compare` onto a guidance decision card so a person reviews and approves them
before the copied pattern and its `derivedFrom` digests are updated. The live `pattern.json` and
its active `patternBindings` stay `approved` and undisturbed until the staged card is approved.

- **Input:** `{ pattern: string, upstreamVersion?: string, accept?: string[], decline?: string[], waivers?: Array<{ id: string, reason: string }>, resolutions?: Array<{ id: string, text: string, gate?: string, setup?: string }> }`
  - `accept` / `decline` reference statement IDs directly (no repeated prose). At least one of
    `accept` or `decline` must be non-empty; overlapping IDs, unknown statement IDs, or
    `resolutions` entries that do not match an accepted `changed-both` statement fail standard
    input validation (`VALIDATION_ERROR`).
  - **Version and digest pinning:** Pins `upstreamVersion` (defaulting to current upstream) and
    the upstream sha256 digest of every staged statement onto the decision card. If upstream
    changes between staging and approval, `decision-record` refuses approval with
    `UPSTREAM_CHANGED` so content the person never reviewed is never applied.
  - **Paired gates and setups:** Accepting an upstream `keep` statement also merges its referenced
    `gate` and `setup` keys; if both local and upstream modified the statement or its paired
    `gate`/`setup` (`changed-both`), accepting it without an entry in `resolutions` fails with
    `STATEMENT_CONFLICT`. Accepting a previously `dropped-here` waived statement clears its waiver
    on approval.
  - **Declined additions and `keep` waivers:** Declining a non-`keep` upstream addition records
    its digest in `derivedFrom.declined` on approval so `specimen-pattern-compare` classifies it
    as `declined` (resurfacing only if upstream changes it again). Declining an upstream `keep`
    statement requires a matching `waivers` reason (entering `waivedKeep` on approval; otherwise
    refused with `VALIDATION_ERROR` so `specimen-validate` never sees an unwaived dropped `keep`).
  - Staging a new merge while an earlier unapproved merge card for the same pattern is still open
    supersedes the open draft card cleanly rather than leaving duplicate pending merge cards.
- **Result:**
  ```ts
  {
    pattern: string;
    card: string;                     // 'card-<12>' staged for human decision-record approval
    upstreamVersion: string;          // pinned upstream version reviewed on the card
    upstreamDigests: Record<string, string>; // pinned statement sha256 digests
    accepted: string[];
    declined: string[];
    stagedStatus: 'proposed';         // status of the staged merge; live pattern stays approved until approval
    nextSteps: string[];              // directs person to approve card via decision-record
  }
  ```
- **Errors:** `PATTERN_UNKNOWN`, `NOT_A_COPIED_PATTERN`, `STATEMENT_CONFLICT`.

#### `panel-calibrate` (Mutation, `slice-2`, `confirmationMode: 'host-verified'`, `outputBudget: { defaultBytes: 16384, maxBytes: 49152 }`)

Samples items where agents agreed (settled provisionally without escalation) for **blind** review
by a person, records the person's independent verdicts, compares them server-side against the
hidden `panelVerdict`, reports the disagreement rate, and reopens every disagreed item as an open
decision card. Because AFD's `confirmationMode` is a static per-command literal
(`spec/command-metadata.md:40`), the entire command is `host-verified` over MCP (both `sample`
and `record` belong to a person-led calibration session; the local review page may also display
the sample directly).

- **Input:**
  - Sample mode: `{ action: 'sample', count?: number, seed?: number }` (default `count: 5`).
  - Record mode (`PERSON_REQUIRED` for non-person actors):
    `{ action: 'record', sample: string, judgements: Array<{ item: string, verdict: 'accept' | 'reject', reason?: string }> }`.
- **Result:**
  ```ts
  {
    sample: string;                   // 'cal-<12>'
    items: Array<{
      item: string;
      summary: string;
      evidence: { visual?: string; walk?: string };
      panelVerdict?: 'accept' | 'reject'; // omitted during 'sample' (blind), revealed on 'record'
    }>;
    recorded?: number;
    disagreed?: number;
    disagreementRate?: number;        // 0..1 computed server-side against hidden panelVerdict
    reopenedCards?: string[];         // open decision cards created for every disagreed item
    unmeasured: UnmeasuredEntry[];
  }
  ```
- **Errors:** `NOTHING_TO_SAMPLE`, `SAMPLE_NOT_FOUND`, `PERSON_REQUIRED`.

#### `design-observe` (Read, `slice-2`, `outputBudget: { defaultBytes: 16384, maxBytes: 49152 }`)

Reads a post-release command journal (by file path) against what an approved, released decision
was meant to fix, filtering entries whose timestamps follow `releasedAt`. If the journal file is
missing or unreadable it fails with `JOURNAL_NOT_FOUND`; if zero entries postdate `releasedAt` it
succeeds with `status: 'insufficient-data'` and `metrics.runs: 0`.

- **Input:** `{ decision: string, journal: string, beforeJournal?: string }`
- **Result:**
  ```ts
  {
    decision: string;
    releasedAt: string;
    meantToFix?: { job: string; target: string }; // optional when decision recorded no target
    status: 'improved' | 'unchanged' | 'regressed' | 'insufficient-data';
    metrics: {
      runs: number;
      completionRate: number;
      unexpectedFailures: number;
      repeats: number;
      outsideSteps: number;
      before?: { runs: number; completionRate: number; unexpectedFailures: number; repeats: number; outsideSteps: number };
    };
    note: string;                     // states movement after release is observation, not proof of causation
    unmeasured: UnmeasuredEntry[];    // names perception-only trouble that leaves commands unchanged
  }
  ```
- **Errors:** `DECISION_NOT_FOUND`, `NOT_RELEASED`, `JOURNAL_NOT_FOUND`.

---

## 2. Error codes and validation issue codes

Every command-level error code below carries a `suggestion` naming the recovery command on the
same host or the human handoff.

| Error code | From | Recovery the suggestion names |
| --- | --- | --- |
| `NO_COMMANDS` | `design-states` | Pass at least one command name in `commands` or a scenario path in `scenario` |
| `TARGET_COMMAND_NOT_FOUND` | `design-states` | Check the product's command manifest or pass a command declared by the application |
| `MODALITY_FORBIDDEN` | `panel-walk` | Remove forbidden tools and run with only the tools permitted for the persona's modality |
| `JOB_NOT_FOUND` | `panel-walk`, `panel-review` | Pass a job id present in the product's `scenarios/` directory |
| `PERSONA_NOT_FOUND` | `panel-walk` | Pass a persona id declared in the product's persona set |
| `WALK_NOT_FOUND` | `panel-walk` | Run `panel-walk` first to produce a baseline walk id |
| `AUTHOR_CANNOT_REVIEW` | `panel-review` | Run `panel-review` from an independent reviewer rather than the author of the change |
| `BUDGET_EXCEEDED` | `panel-review` | Raise `budget` explicitly or review cards already produced in `design-card-list` |
| `RUN_NOT_FOUND` | `panel-review` (`withdraw`) | Pass a `run-<12>` id returned by an earlier `panel-review` |
| `AUTHOR_CANNOT_DECIDE` | `decision-record` (amended) | Have an independent panel or person decide rather than the author |
| `CARD_NOT_FOUND` | `decision-record` (card mode), `design-card-list` | List open cards with `design-card-list` |
| `PERSON_REQUIRED` | `decision-record`, `design-release`, `panel-calibrate` | Stop retrying as an agent; hand the card, release or calibration sample to a person |
| `REFUSAL_SCOPE_REQUIRED` | `decision-record` (amended) | Pass `refusalScope` (`unsafe`, `wrong-for-context`, or `not-a-priority`) when rejecting a card |
| `REGRESSION_ACK_REQUIRED` | `decision-record` (amended) | Pass `regressionAccepted: true` separately when approving a card whose `effect.regression` is true |
| `REFUSED_AS_UNSAFE` | `decision-record` (amended) | Read the blocking safety decision in `decision-list` and have a person record `supersedes` with `remediation` once fixed |
| `UNAPPROVED_CARDS_OPEN` | `design-release` | Review and decide all `open` and `changes-requested` cards in `design-card-list` before releasing |
| `DECISION_NOT_APPROVED` | `design-release` | Pass only non-provisional approved decisions not already released under another release |
| `PATTERN_UNKNOWN` | `specimen-pattern-fork`, `specimen-pattern-compare`, `specimen-pattern-merge` | Check the library and pattern id in the product's configured pattern libraries |
| `ALREADY_EXISTS` | `specimen-pattern-fork` | Choose a different `target` id or inspect the existing copy with `specimen-pattern-compare` |
| `NOT_A_COPIED_PATTERN` | `specimen-pattern-compare`, `specimen-pattern-merge` | Only patterns with `derivedFrom` (created by `specimen-pattern-fork`) can be compared or merged upstream |
| `STATEMENT_CONFLICT` | `specimen-pattern-merge` | Provide a `resolutions` entry with merged text (and `gate`/`setup` when paired) for every `changed-both` statement being accepted |
| `UPSTREAM_CHANGED` | `decision-record` (merge card approval) | Re-run `specimen-pattern-compare` and `specimen-pattern-merge` against the current upstream version before approving |
| `NOTHING_TO_SAMPLE` | `panel-calibrate` | Run `panel-review` to produce provisional panel agreements before sampling |
| `SAMPLE_NOT_FOUND` | `panel-calibrate` | Start a blind sample with `panel-calibrate` (`action: sample`) first |
| `DECISION_NOT_FOUND` | `design-observe`, `design-release` | List recorded decisions with `decision-list` |
| `NOT_RELEASED` | `design-observe` | Mark the approved decision released with `design-release` before observing post-release journals |
| `JOURNAL_NOT_FOUND` | `design-observe` | Pass a readable path to an AFD command journal (`.jsonl`) |

**Validation issue code (inside `specimen-validate` `success: true` result envelope):**
Following Specimen's existing `specimen-validate` contract (`{ id?, file? }` returning
`{ valid: boolean, issues: Array<{ severity, code, message, suggestion }> }`), dropping an
upstream `keep` statement without a `waivedKeep` entry reports an error-severity validation issue
with `code: 'WAIVER_REASON_REQUIRED'` and `valid: false` (tested in
[`11-dropped-keep-requires-reason.scenario.yaml`](scenarios/11-dropped-keep-requires-reason.scenario.yaml)).
*(Note: `PATTERN_UNKNOWN` is used both as a `specimen-validate` issue code in Patterns and as a
command-level error code on `specimen-pattern-fork`/`compare`/`merge`.)*

---

## 3. Exit criteria for Phase A

1. Every scenario in [`scenarios/`](scenarios/) passes `afd scenario validate`, the dry-run
   fixture/reference validator (`validateScenario`), and `scenarioCoverage` with zero untested
   commands, zero untested command-level error codes and zero undrafted commands.
   - `slice-1` (ranks 1–5): jobs 6, 1, 10, 8, 9 (`01` through `05` in `scenarios/`).
   - `slice-2` (ranks 6–12): jobs 2, 5, 12, 7, 14, 4, 15 (`06` through `12` in `scenarios/`).
2. Three fresh independent readers (Person, Job List, Calling Agent) have walked the jobs,
   commands and scenarios; findings applied or declined with reasons recorded, plus independent
   verification of commands added by the walks.
3. Two-model independent review completed with zero unresolved blockers.
4. The owner accepts or refuses each proposed amendment in [section 4](#4-proposed-amendments-for-the-owner)
   so each accepted part moves into the proposal that owns it. *(Met 2026-11-24: all four
   amendments accepted and applied.)*

---

## 4. Proposed amendments for the owner

*(Accepted 2026-11-24 and applied to Patterns, Design Decisions, Screens from Jobs and
`agent-first-design.proposal.md` §10; heading kept for anchor stability.)*

### 4.1 Amendment to Patterns (`docs/features/active/patterns/spec.md` & Umbel A31)

1. **Default pattern ownership (`afd-defaults`):** Applies Patterns' 2026-11-21 question 4
   decision (library-owned; `docs/features/active/patterns/patterns.proposal.md:795,814`) to
   AFD's ten result-state patterns listed in [section 1.2](#12-shared-types-ids-and-the-ten-default-patterns)
   as a versioned default library (`afd-defaults@<semver>`). A product that customizes nothing
   names `afd-defaults` at a version in `specimen.config.json`.
2. **Approval status (`approvalStatus`) & Pack Format 2 schema update:** Add optional
   `approvalStatus?: 'proposed' | 'approved' | 'deprecated'` on `pattern.json`,
   `PackPatternRecord`, `PackCopyRecord`, `PackCatalogV2` and individual statements (updating
   Pack Format 2's `additionalProperties: false` schemas and `checkPack`). Separate from
   completeness (`complete`/`draft`) and release lifecycle (`stable`/`preview`/`deprecated`).
   `components-pattern-list`, `components-pattern-open` and `components-brief` serve only
   `approved` content by default (`includeProposed: true` exposes proposed items for review).
   Also add optional `patterns?: string[]` to `components-brief`'s input schema so callers can
   fetch default or copied pattern guidance directly by `<library>/<pattern>` id.
3. **Copied patterns (`derivedFrom`, `waivedKeep`, `specimen-pattern-fork`, `specimen-pattern-compare`, `specimen-pattern-merge`):**
   - `PatternFile` and Pack Format 2 gain optional
     `derivedFrom: { library, pattern, version, revision, statements: Record<id, sha256>, declined?: Record<id, sha256> }`
     so statement-by-statement comparison (`unchanged`, `changed-here`, `changed-upstream`,
     `changed-both`, `dropped-here`, `added-upstream`, `declined`) works without fetching
     historical pack blobs.
   - `PatternFile` gains optional `waivedKeep: Array<{ id, reason }>`. `specimen-validate`
     reports `valid: false` with issue code `WAIVER_REASON_REQUIRED` if a copied pattern drops
     an upstream `keep` without a waiver reason, and verifies that an `approved` pattern's digest
     matches a recorded person approval.
   - `specimen-pattern-merge` stages selected upstream statement updates (including paired `gate`
     and `setup` keys, `waivers` for declined `keep`s, and `declined` digests for non-`keep`s)
     pinned to `upstreamVersion` and upstream digests on a guidance decision card applied
     atomically upon person approval (refused with `UPSTREAM_CHANGED` if upstream moved).
4. **Holding a product's screens to a copied or replaced pattern (`patternBindings`):**
   - `specimen.config.json` gains optional
     `patternBindings?: Record<"<sourceLibrary>/<pattern>", "<localLibrary>/<pattern>">`, and
     Specimen compiles active (approved) bindings into Pack Format 2 (`library.json`) /
     `consumers.json` (v3) so sandboxed WASI Umbel (`Cx::pack_read`) resolves them without
     reading `specimen.config.json` directly.
   - Bindings targeting a `proposed` local copy remain pending until a person approves the copy's
     decision card; until then, `components-brief` and `design-states` continue serving the
     approved upstream default unless `includeProposed: true`. Nothing is layered implicitly.

### 4.2 Amendment to Design Decisions (`docs/features/active/design-decisions/design-decisions.proposal.md`)

1. **Provisional panel answers (`decidedBy.kind: 'panel'`) & Mode 3 input:** Extend `decidedBy`
   from `person | script | test` to add `{ kind: 'panel', reviewers: string[], split: string }`,
   valid **only** on Design Decisions Mode 3 (`items: string[]`) with `provisional: true` and
   `panel: { reviewers: string[], split: string }` on non-release, non-guidance, non-escalated
   review items. Refused if the caller authored the change (`AUTHOR_CANNOT_DECIDE`, verified
   against `ctx.actor.id`/change author) or if `provisional: true` is passed on card mode,
   release or guidance approval (`PERSON_REQUIRED`).
2. **Resolution of Recommendation 7 (Q7 conflict) & host-verified human confirmation:** Design
   Decisions Q7 currently lets CLI answers (`decidedBy.kind: 'script'`) settle review items for
   solo terminal workflows, and §6.6 currently derives `decidedBy.kind: 'person'` from MCP
   elicitation (which `spec/command-metadata.md:394-396` notes trusts the client application).
   Because AFD's `confirmationMode: 'host-verified'` is a static per-command literal
   (`spec/command-metadata.md:40,145-158`) that gates MCP calls via `HumanRelay` while leaving
   in-process `DirectRegistry` calls ungated (`spec/command-metadata.md:158`):
   - `decision-record`, `design-release` and `panel-calibrate` declare static
     `confirmationMode: 'host-verified'` over MCP (`HumanRelay` returns `CONFIRMATION_REQUIRED`
     if unavailable and `CONFIRMATION_DECLINED` if declined, distinct from approval middleware's
     `APPROVAL_REQUIRED` / `APPROVAL_UNAVAILABLE` and handler-level `PERSON_REQUIRED`).
   - Provisional panel settlements on `decision-record` Mode 3 run in-process from `panel-review`
     via `DirectRegistry` (checking `AUTHOR_CANNOT_DECIDE` in the handler), keeping Mode 3 out of
     `HumanRelay` popups while preventing external MCP agents from bypassing human gates.
   - Outside MCP, solo CLI triage may still record `decidedBy.kind: 'script'` on local review
     items, while release cards, guidance approvals, `design-release` and `panel-calibrate`
     require interactive review-page or CLI human confirmation
     (`decidedBy: { kind: 'person', channel: 'review-page' | 'cli' }`, refusing `script`/agent
     actors with `PERSON_REQUIRED`).
   *(Confirmed by the owner on 2026-11-24.)*
3. **Decision card mode on `decision-record`, `design-card-list`, `design-release`, and `decision-list` filters:**
   - Card mode input on `decision-record`: `{ card?: string, cards?: string[], chosen: 'approve' | 'request-changes' | 'reject' | 'defer', reason: string, refusalScope?: RefusalScope, regressionAccepted?: boolean, meantToFix?: { job: string, target: string }, supersedes?: string, remediation?: string }`
     (aligned with Design Decisions' `chosen` input so it does not collide with output
     `decision: dec-<12>`). Batch `cards: string[]` is allowed only on non-regression cards
     reviewed together on `page`.
   - Card mode result on `decision-record`: single `card` returns
     `{ decision: string, chosen: 'approve' | 'request-changes' | 'reject' | 'defer', refusalScope?: RefusalScope, regressionAccepted?: boolean, meantToFix?: { job: string, target: string }, superseded?: string, appliedPatterns?: string[] }`;
     batch `cards` returns `{ decisions: Array<...> }` with one entry per decided card (matching
     Design Decisions §7).
   - Enforces `CARD_NOT_FOUND`, `REFUSAL_SCOPE_REQUIRED` on `reject`, `REGRESSION_ACK_REQUIRED`
     when `effect.regression === true` without `regressionAccepted: true`, `UPSTREAM_CHANGED`
     when a staged pattern merge's upstream moved, and lasting blocking on `refusalScope: 'unsafe'`
     (`REFUSED_AS_UNSAFE`, which also closes the re-proposed card as `rejected` so it does not
     strand the release gate). A person can reverse a mistake or unlock a fixed safety concern
     via `supersedes: '<dec-12>'` + `remediation: string`.
   - Approving a pattern fork or merge card atomically flips `approvalStatus` to `'approved'` (or
     applies the staged merge statements, paired `gate`/`setup` updates, `waivedKeep`/`declined`
     records and refreshed `derivedFrom` digests).
   - `design-release` writes append-only `specimens/releases/<release>.json` manifests (preserving
     Design Decisions §12 Q9's append-only decision files). `decision-list` gains optional filters
     (`kind?: 'choice' | 'card'`, `released?: boolean`, `limit`, `after`) joining against
     `specimens/releases/`.
4. **Variants differ in mechanism:** Clarify in Design Decisions §6.3 that `specimen-compare`
   variants should differ in how they solve the problem, not only in styling density.

### 4.3 Amendment to Screens from Jobs (`docs/features/active/screens-from-jobs/screens-from-jobs.proposal.md`)

1. **Panel walks and report+journal measure:** Extend the "The limit" paragraph in Screens from
   Jobs §10 (`screens-from-jobs.proposal.md:670`) to note that `panel-walk` walks the running
   application under enforced modalities, recording both the journal path against the scenario's
   steps and a blind pairwise report comparison against a baseline walk (proved in phase 0 step
   0.4), and that `design-observe` reads post-release journals against the same scenario steps
   and `releasedAt` timestamp.
2. **Decision card visuals:** Screens from Jobs' capture sets supply the before-and-after
   artifact paths (with `state`, `viewport`, `theme`, `modality`) for `design-card-list` cards.

### 4.4 Amendment to Agent-First Design (`agent-first-design.proposal.md` §10)

1. **Reconcile Job 15 with §10 "Out of scope":** Proposal §10 (`agent-first-design.proposal.md:935`,
   previously `:927`) listed *"Measuring outcomes with real users in production"* as out of scope,
   while Job 15 (`design-observe`) reads post-release AFD command journals against what an
   approved decision was meant to fix. Narrow §10 to exclude analytics/telemetry outside AFD
   command journals while keeping post-release AFD command-journal observation in scope.
   *(Confirmed by the owner on 2026-11-24 and applied.)*

---

## 5. Host placement, tool strategy, and what a model is told

### 5.1 Host topology and tool-list budget
- **Umbel `components` server** hosts `components-pattern-list`, `components-pattern-open`, and
  `components-brief` (reading Pack Format 2 + compiled `consumers.json` bindings under WASI).
- **`endpoints/specimen-server`** migrates onto `@lushly-dev/afd-server` (bringing meta-tools,
  `outputBudget` enforcement, `confirmationMode: 'host-verified'` / `HumanRelay`, and `task`
  support for long-running commands) and hosts all `specimen-*`, `decision-*`, `design-*`, and
  `panel-*` commands.
- **Tool strategy:** With ~50 commands on `specimen-server`, flat `individual` listing would bloat
  every prompt and a single `specimen` category would exceed `grouped`'s 8,192-char `anyOf` cap.
  `specimen-server` uses `hybrid` (up to 8 first-class tools: `design-states`, `design-card-list`,
  `decision-record`, `specimen-review`, `specimen-validate`, `panel-walk`, `panel-review`,
  `design-release`) or categorized `grouped` (`specimen`, `design`, `panel`, `decision`), leaving
  the rest reachable via `afd-discover` / `afd-detail`.

### 5.2 What a model is told (with no skill installed)
- **Self-guiding `nextSteps`:** `design-states`, `panel-review`, `design-release`,
  `specimen-pattern-fork`, `specimen-pattern-compare`, and `specimen-pattern-merge` all return
  `nextSteps` naming the next command (explicitly naming the target host when crossing from
  `specimen-server` to Umbel, e.g. `umbel: components-brief`) or human handoff so an agent needs
  no installed skill.
- **Hard human boundary in tool descriptions:** `decision-record` (card mode), `design-release`,
  and `panel-calibrate` (`action: 'record'`) state in their tool descriptions: *"Do not call this
  to approve release, guidance, escalated cards, or calibration judgements as an agent; show the
  card or `page` URL to the person and wait."*
- **Same-host error suggestions:** Error suggestions name only tools on the same host (or
  explicitly name a human handoff), never pointing `specimen-server` callers blindly at Umbel
  tools or telling `design-states` callers to run `afd-discover` on `specimen-server` for
  product-app commands.
- **Pass by reference:** Visuals (`visual.before`/`after`), journals (`journal`/`beforeJournal`),
  and pattern merge selections (`accept`/`decline` statement IDs) are passed by path or ID —
  never forcing the model to copy large text blobs back into tool arguments.

---

## 6. Scenario checks, three-seat walks, and scenario limits

### 6.1 What writing the scenarios changed
- Writing the 12 scenarios turned prose jobs into concrete contracts: separating `panel-walk`
  (single-persona enforced modality + blind comparison) from `panel-review` (5-member panel +
  provisional settlement + escalation triggers), defining explicit refusal codes for every
  boundary, and keeping the fixture domain completely independent of the phase 0 seed library
  (an invented neighbourhood bookshop in
  [`scenarios/fixtures/bookshop.json`](scenarios/fixtures/bookshop.json)).

### 6.2 What the three-seat walks and independent reviews found (taken and declined)
Three fresh read-only readers walked the draft specification and scenarios on 2026-11-24
(Person, Job List, Calling Agent), followed by a two-model independent review (Claude Opus 5.5
and Gemini 4 Neon) that also performed a focused walk of the two commands the walks added
(`design-release` and `specimen-pattern-merge`).

**Taken (applied to `spec.md` and `scenarios/`):**
1. **Fixed blind calibration contradiction (`panel-calibrate`, all 3 seats):** `action: 'record'`
   now takes the person's independent `verdict: 'accept' | 'reject'` (not `agree: boolean` against
   a hidden verdict), includes visual/walk evidence in `sample`, asserts `panelVerdict: { notExists: true }`
   in scenario `08`, requires `host-verified` human confirmation (`PERSON_REQUIRED`), and creates
   open `reopenedCards` for every disagreed item.
2. **Closed two dead-end journeys with two new commands (all 3 seats + two-model review):** Added
   `specimen-pattern-merge` (staging upstream statement updates, paired `gate`/`setup` keys,
   `waivers` for declined `keep`s, and `derivedFrom.declined` for non-`keep`s pinned to
   `upstreamVersion` and upstream digests, with `STATEMENT_CONFLICT` and `UPSTREAM_CHANGED`) and
   `design-release` (static `confirmationMode: 'host-verified'`, blocking on `open` and
   `changes-requested` cards via `UNAPPROVED_CARDS_OPEN`, validating `DECISION_NOT_FOUND` and
   `DECISION_NOT_APPROVED`, and writing append-only `specimens/releases/<release>.json` manifests).
3. **Aligned `decision-record` card mode and trust boundaries (Calling Agent, Person, two-model review):**
   Switched input from `decision` to `chosen`, documented both input and output card-mode shapes
   (including batch `decisions[]`) plus Mode 3 `items: string[]` with `provisional: true` + `panel`,
   upgraded person-only gates to static `confirmationMode: 'host-verified'` with `HumanRelay`
   over MCP (with Mode 3 provisional panel writes running in-process via `DirectRegistry` per
   `spec/command-metadata.md:158`, plus review-page/CLI fallback and distinguishing
   `CONFIRMATION_REQUIRED`/`CONFIRMATION_DECLINED` and `APPROVAL_REQUIRED`/`APPROVAL_UNAVAILABLE`
   from `PERSON_REQUIRED`), added batch `cards: string[]`, `CARD_NOT_FOUND`,
   `REGRESSION_ACK_REQUIRED`, `supersedes` + `remediation` for `unsafe` refusals, and
   `decision-list` filters.
4. **Aligned Umbel, Patterns and Specimen contracts (Calling Agent, Person, two-model review):**
   Fixed `components-pattern-list` assertions to Umbel A31.3's top-level `libraries[]` and
   alphabetical ordering; added `patterns?: string[]`, `includeProposed`, `components-pattern-open`,
   and Pack Format 2 schema updates to §4.1; routed `patternBindings` into compiled pack/consumer
   files for WASI Umbel; added `consumer` to `bookshop.json`; clarified pending pre-approval
   bindings and live `stagedStatus: 'proposed'` on merge; removed destructive `replace: true` from
   `specimen-pattern-fork`; fixed `specimen-validate` scenario to match `{ file }` returning
   `{ valid: false, issues: [{ code: 'WAIVER_REASON_REQUIRED' }] }`.
5. **Wired runtime inputs, recovery, budgets and host guidance (all 3 seats + two-model review):**
   Derived `panel-review` `author` server-side from change/commit metadata, added `target`,
   `appDate`, `captures`, `run` ID, `action: 'withdraw'` (with output contract, `RUN_NOT_FOUND`,
   and preserving person-decided cards), and `'withdrawn'` card status; preserved
   `evidenceForBothSides` and added `page`, cursor pagination, filters and `includeProvisional: false`
   default to `design-card-list`; renamed `COMMAND_NOT_FOUND` → `TARGET_COMMAND_NOT_FOUND` and
   `path.total` → `path.deviations`; added `PERSONA_NOT_FOUND`, `JOURNAL_NOT_FOUND`, bulk
   `specimen-pattern-compare` summary shape, `outputBudget` on all 10 new commands, `long-running`
   + `task: 'optional'` on `panel-walk`/`panel-review`, the 10 canonical `afd-defaults` pattern
   IDs, valid Crockford base-32 IDs, and [section 5](#5-host-placement-tool-strategy-and-what-a-model-is-told).

**Declined (with reasons):**
1. **Voice / copy plugin and screen-direction skill for Job 1 (Person & Job List):** The copy
   plugin is a future Umbel unit (`agent-first-design.proposal.md:56,155`) and the skill (step
   0.5) was deferred at step 0.6. Job 1 in Phase A specifies the 10 default result-state patterns
   and self-guiding commands; voice/copy guidance remains explicitly unmeasured until its unit
   exists.
2. **Additional separate read/list commands (`panel-persona-list`, `design-card-get`, `panel-walk-get`,
   unchanged-default diff, waiver inventory, calibration history):** Kept out of the Phase A command
   count to avoid tool-list bloat (`design-card-list { card }` handles single-card detail,
   `specimen-pattern-compare` without `pattern` handles bulk summary); deeper portfolio/history
   reads belong to implementation phases B–D.
3. **Dropping scenarios `09` (Job 7) and `10` (Job 14) as cross-cutting properties (Job List):**
   Kept because the owner confirmed the 12-job ranking including Job 7 (rank 9) and Job 14
   (rank 10, the quiet job) in proposal Q11.
4. **Adding separate scenarios for all 5 escalation triggers and all 4 modalities (Job List):**
   `04` and `05` cover the schema contracts and primary cases; exhaustive trigger and modality
   matrices belong in Phase C test suites rather than multiplying Phase A scenario files.

### 6.3 What a scenario could not express
Per [jobs-first.md](../../../../.claude/skills/afd/references/jobs-first.md#what-a-scenario-cannot-express),
these behaviors are specified above and noted in scenario file comments, and must be verified by
host/integration tests in Phases B–D:
- **Actor identity (`person` vs `agent` vs `script`):** Every scenario step runs as
  `actor: { kind: 'test' }`, so a single scenario cannot execute the same command once as an
  agent (refused with `PERSON_REQUIRED`, `CONFIRMATION_REQUIRED`, or `AUTHOR_CANNOT_DECIDE`) and
  once as a host-verified person (`HumanRelay`).
- **Clock advancement:** Scenarios cannot advance wall-clock time between `design-release` and
  `design-observe` or across a year of calibration; `releasedAt` and `appDate` are passed
  explicitly as dates/timestamps.
- **Unreachable `CommandResult` fields:** Scenario `expect` cannot assert top-level `warnings`,
  `alternatives`, `sources`, `plan`, `undoCommand`, `undoArgs`, or `error.details` (such as
  `error.details.decision` on `REFUSED_AS_UNSAFE`).
- **Live host isolation and cross-server pack reload:** Enforcing that `panel-walk` strips
  forbidden browser/DOM tools inside the runner sandbox, verifying zero skill files are loaded in
  Job 7, and propagating compiled `patternBindings` packs from `specimen-server` to Umbel
  (`scenarios/06` steps 5–6) require runtime integration tests.
