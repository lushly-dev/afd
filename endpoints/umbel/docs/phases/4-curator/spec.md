# Phase 4 specification: curator

| Field | Value |
| --- | --- |
| Phase | 4, curator ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | Repository owner approves; the phase 4 owning agent writes and implements |
| Read first | [STATUS.md](../../STATUS.md), then the [architecture](../../architecture.md), the [decision log](../../decisions.md), the [phase 2 specification](../2-knowledge/spec.md) (proposals, areas, verification) and the [phase 3 specification](../3-memory-context/spec.md), whose section 13 binds what this phase may do with memory |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request, as the phase 2 and 3 steps did |

## Status

- **State:** written 2026-11-03 by the phase 4 owning agent; **in review, not approved** (D24). It adds
  decisions [D90 to D104](../../decisions.md), all proposed, and the architecture amendments they need.
  **Eight points change the trust model and wait for the owner**; they are numbered questions in
  section [16](#16-for-the-owner), each with a recommendation. Nothing in this document presents one of
  them as decided: where a section depends on an answer, it says which question and builds the
  recommended option, so that a different answer changes one section and one plan step.
- **Last verified:** 2026-11-03 against `main` at `f0c618aa` (phase 3 done). Read in `endpoints/umbel`:
  - `plugins/knowledge/src/proposal/{mod,model,area,propose,apply,review,document,common}.rs` and
    `plugins/knowledge/umbel-plugin.toml`: the proposal record, areas, `knowledge-approve` (static
    `confirm_prompt`, `approval = "required"`, `confirm = "require-human"`, CLI only); self-approval is
    the approving actor string equal to the proposing actor string (`apply.rs:207`); an applied
    document's origin is `user-stated` only when the proposer was a human (`apply.rs:351`); only
    `document` evidence is checked at submission (`propose.rs:526`); a proposal's envelope has
    `derivedFrom: null` (`propose.rs:372`); withdraw is the proposing actor's only
    (`PROPOSAL_NOT_PROPOSER`, `review.rs:192`).
  - `schemas/proposal.v1.json`: closed (`additionalProperties: false`), `policy.rule` is the constant
    `"person"` (line 206) and the envelope is version 1. **So the curator's fields cannot be added "on
    proposal record version 1"** as the architecture's phase table says; this specification makes
    version 2 (section 2.1) and amends the architecture.
  - `store/src/envelope.rs`: `DerivedFrom { kind, id, contentHash }` with the hash required and parsed
    (lines 193 to 203, 355); `Origin`, `Sensitivity` and `Authority`.
  - `store/src/memory.rs`: `Observations { first, last, count, sessions }` (line 180), the `changes`
    feed with `Created`, `Observed`, `Invalidated`, `Confirmed`, `Erased` and `Purged` (lines 991 to
    1200), `refuse_derivation` (line 1243); `store/src/access.rs`: `ReaderFilter::Derivation`
    (lines 118 to 171); `schemas/memory-record.v1.json` reserves `promotedTo`, `candidate` and
    `settledAt`.
  - `src/plugins/store_services.rs`: records are namespaced by plugin instance (`get_record(&instance,
    ...)`, lines 330 to 370), so one plugin cannot read or write another's proposals; derivation reads
    need `store-write` and `index_write` or `graph_write` (lines 196 to 230); `as_reader` is CLI-only
    for a human (line 528).
  - `src/plugins/pipelines.rs`: a plugin pipeline runs its steps over the host registry with a clone
    of the caller's context (lines 315 to 335); steps may name another plugin's command
    (`knowledge-refresh` runs `sources-sync`); a digest step's output may not feed a plain step.
  - `src/middleware.rs`: the plugin gate; `confirmed_by_a_person` accepts only the CLI's
    `dev.umbel/human-confirmed` mark naming the command itself (line 278).
  - `src/authority.rs`, `src/principal.rs` (the CLI is always `human:local`, line 175; stdio is an agent
    acting for `on_behalf_of`; HTTP is `agent:loopback`), `src/cli/mod.rs` (lines 530 to 580: the
    confirm prompt, the authority prompt and the marks).
  - `src/plugins/{mod,grants,manifest,memory_services}.rs`: the grant catalog, the allow-list grants,
    phase 3's refusal of `memory_write` beside a document write grant (`manifest.rs:116`).
  - `sdk/src/cx.rs`: `CallContext` (lines 24 to 46) carries no `extra`; the memory and record methods.
  - In the repository: `spec/command-metadata.md` ("Confirmations", "Asking the human over MCP",
    lines 75 to 294) and `docs/language-parity.md` (line 136: the approval relay over MCP is TypeScript
    only, Rust "No").
- **No Rust was built** for this document.
- **Done:** this specification.
- **Not done:** everything in section [15](#15-implementation-plan).
- **Follow-ups:** section [Follow-ups](#follow-ups).

## What this phase serves

The phase 4 row of the architecture: *settling window, candidates and conflict sets per space, curator
proposals as decision traces, deterministic auto-approval rules per area, scheduled re-verification and
inconsistency proposals, rejection feedback, scheduled runs.* Exit criterion: *a curator proposal
approved from the CLI lands in the knowledge base with full provenance.* It settles what the row asks:
the curator's proposal fields (section 2.1, on version 2), auto-approval rules (8.3), the MCP approval
relay (8.4), settling and re-verification defaults (4.2, 6.1) and the optional model configuration (8.5).
It is the second half of item 4 of the proposal's [first proof](../../proposal.md#first-proof).

| Principle | How phase 4 serves it |
| --- | --- |
| 1. Empty host | The host gains one context mark for pipelines and one CLI feature, the confirmation preview; both are domain-free. Candidates, drafting and feedback are the `curator` plugin's |
| 2. Plugins are the unit | `curator` never calls `knowledge` or `memory`; it reads memory and documents through grants, and reaches proposals only through a pipeline it ships as data (D3, D91) |
| 3. Everything is a command | A curator run, a promotion and every status read are commands; a schedule is a cron line that runs one |
| 4. No model in the request path | Curator commands are CLI only and never first-class; phase 4 calls no model at all (D100, question 3) |
| 6. Deterministic core | Candidates, conflict sets and drafts are pure functions of the stores, the pack, the clock and the input (4.6) |
| 7. Provenance on everything | A drafted proposal names its drafter, run and candidate; its evidence carries each source record's authority, origin, constraints and access; the applied document is derived from it (2.1, 13) |
| 8. Durable knowledge changes by proposal | The curator only proposes. A person approves at a terminal; the only alternative is a deterministic rule an area opts into, which no curator command can trigger (8.3) |
| 9. Stored content is untrusted input | Only `person` authority settles by default, flagged records never do, the approver sees a preview with the diff and the evidence's authority, content stays out of messages (section 12) |
| 10. Permission-aware | The curator reads memory under its caller's reader filter; a draft never widens a record's readers without that record's owner at a terminal (D94) |
| 14. Every mutation is an event | Runs, promotions, submissions, withdrawals and decisions are journaled commands with events naming records, never text |
| 15. AFD first | Pipelines, digest journaling, confirmations and approvals are AFD's; no AFD change in the recommended options (section 15) |
| 16. Spaces do not mix | A run, a candidate and a proposal belong to one space |

Decisions served: D3, D7, D9, D13, D15, D17, D24, D25, D26, D36, D42, D46, D54, D62, D63, D66, D67, D68,
D69, D71, D72, D73, D74, D75, D78, D81, D84 and D85, and the new D90 to D104. Open decisions O1, O4 and
O5 are untouched.

## Trajectory refresh

Refreshed 2026-11-03 against primary sources. **No finding changes the architecture.** One finding
weighs on question 2: the 2026-07-28 elicitation specification fixes no user interaction model.

| Row | Checked against | Finding on 2026-11-03 | Effect on phase 4 |
| --- | --- | --- | --- |
| W1 release cycle | [MCP roadmap](https://modelcontextprotocol.io/development/roadmap), last updated 2026-08-22 | 2026-07-28 is the current revision; the same five priority areas | Phase 4 pins 2026-07-28 and keeps 2025-11-25, unchanged |
| W2 MCP Events, SEP-3415 | The pull request, GitHub API | Open, not a draft, updated 2026-11-03 | Curator events stay in Umbel's log, read by cursor |
| W5 agent identity | The roadmap | Human-presence attestation is still only "under discussion" as the Agent Identity group forms | Approval rests on the terminal check until phase 5 (8.4) |
| Elicitation (relay) | [Elicitation, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation) | "The protocol itself does not mandate any specific user interaction model"; form schemas are flat primitives, so a diff can travel only in `message`; "Servers MUST NOT rely on client-provided user identification without server verification" | An approval relayed over MCP proves a client answered, not that a person read the diff; with every local MCP caller one principal before phase 5, it would also not say which person (8.4, question 2) |
| W7 Tasks | The roadmap | Tasks (SEP-2663) continue toward core; no date | Runs are bounded one-shot commands, not tasks (7.3) |
| W11 Open Knowledge Format | Not re-checked | Phase 2's refresh of 2026-11-01 stands: `verified`, `stale_after`, `status`, `generated` | Phase 4 uses only those keys, as phase 2 reads and writes them |

W3, W4, W6, W8 to W10 and W12 to W18 were not re-checked: phase 4 changes nothing that depends on them.

## Terms

Entered in the [glossary](../../architecture.md#12-glossary) in this pull request.

| Term | Meaning |
| --- | --- |
| Curator run | One `curator-run` call for one space: plan, submit, read feedback, finish |
| Settling window | How long a memory record's current version must stand unchanged before it can be proposed as knowledge |
| Candidate | A group of readable, settled memory records with one content hash and class, kept as a curator record |
| Conflict set | Candidates in one space whose subjects normalise to the same key and whose content differs |
| Draft | The proposal input the curator renders for a candidate, a re-verification or an inconsistency |
| Drafter | The curator instance named on a drafted proposal, from the host's pipeline mark |
| Pipeline mark | `dev.umbel/pipeline`, a context key only the host sets: the instance and pipeline whose step is running |
| Promotion | A person consenting, at a terminal, to have their own memory record drafted for wider readers |
| Confirmation preview | Text a command's declared preview command returns, shown by the CLI before its confirmation prompt |
| Auto-approval rule | A deterministic predicate over a proposal that an area opts into, under which the knowledge plugin applies the proposal without a person |

## 1. Crate layout

```text
endpoints/umbel/
├── Cargo.toml                 # members += plugins/curator
├── src/plugins/pipelines.rs   # the pipeline mark (section 10.1)
├── src/cli/                   # the confirmation preview (10.2)
├── sdk/src/cx.rs              # CallContext.pipeline
├── plugins/curator/           # umbel-plugin-curator: compiled plugin
├── plugins/knowledge/         # proposal version 2, the drafted path, preview, feed, auto rules
├── first-party/               # umbel-first-party gains curator
└── schemas/                   # + the shapes of section 2
```

| Crate | Depends on | New third-party dependencies | Notes |
| --- | --- | --- | --- |
| `umbel` (host) | as before | none | The pipeline mark; manifest version 4; the CLI's preview |
| `umbel-sdk` | as before | none | `CallContext.pipeline: Option<PipelineMark>`; WIT world 1.0.0 unchanged, so components never see it |
| `umbel-plugin-knowledge` | as before | none | Section 11.2 |
| `umbel-plugin-curator` | `umbel-sdk`, `umbel-store`, `umbel-okf`, `umbel-scan` | `sha2`, `toml`, `chrono`, `serde_json` (all in the lock) | Kind `compiled`; id `curator`, domain `curator` |
| `umbel-first-party` | + `umbel-plugin-curator` | none | Still the only crate linking `memory` with another plugin that reads memory (D80) |

`plugins/curator/tests/no_plugin_dependency.rs` reads `cargo metadata` and fails if the crate depends on
any `umbel-plugin-*`, or on an HTTP client (`reqwest`, `hyper`, `ureq`) directly. The crate is
`publish = false`, quarantined in `scripts/release/inventory.json` with no route, with `architecture.json`
rows, as phase 3's crates are.

## 2. Versioned shapes

Every new shape is a closed JSON Schema 2020-12 file with an example (D36).

| Shape | File | Was | Section |
| --- | --- | --- | --- |
| Proposal record version 2 | `proposal.v2.json` | 1 (D62) | 2.1 |
| Plugin manifest version 4 | `plugin-manifest.v4.json` | 3 (D72) | 2.2 |
| Curator records version 1 | `curator-record.v1.json` (`candidate`, `run`, `consent`, `state`) | new | 2.3 |
| Curator run report version 1 | `curator-report.v1.json` | new | 7.2 |

`workspace-show`'s `versions` changes `manifest` to `[1, 2, 3, 4]` and `proposal` to `[1, 2]`, and gains
`curator: 1`. The plugin protocol stays **1**: manifest version 4 is an addition within it (D40 as
annotated by D54). The workspace configuration stays version 4: everything new is plugin configuration.

### 2.1 Proposal record, version 2 (D92)

Version 1 with these changes; every version 1 field keeps its meaning. A version 1 record stays version
1 when it is decided, withdrawn or applied (as phase 3 kept rows in their own version); new proposals
are version 2.

| Field | Rule |
| --- | --- |
| `version` | `2` |
| `provenance` | Envelope **version 2**, `authority: null` (not applicable to a record) |
| `drafter` | **New.** `null`, or `{ "plugin", "instance", "pipeline", "run", "mode", "candidate"?, "promotedBy"? }`, filled by the knowledge plugin **only from the host's pipeline mark** (10.1), never from input. `mode` is `scheduled` or `promoted`; `candidate` is the curator's candidate id; `promotedBy` is the human who consented (5.2) |
| `conflictSet` | **New.** `null`, or a conflict set id `k-<20 hex>` (4.4); proposals sharing one are alternatives |
| `evidence` | Version 1's kinds plus **`memory`**: `{ "kind": "memory", "ref": "<mem id>@<recordVersion>", "contentHash", "class", "authority", "origin", "constraints", "access", "sensitivity", "confirmation", "observations": { "sessions", "principals" }, "excerpt"?, "erased"? }`. This is the binding of D81: authority, origin, constraints and access are copied, never summarised. After a redaction (9.1) an entry is `{ "kind": "memory", "ref", "erased": true }` |
| `provenance.derivedFrom` | For a drafted proposal, one `{ "kind": "memory", "id", "contentHash" }` per source record (D81); `null` otherwise, and `null` after a redaction |
| `policy.rule` | `"person"` or `"auto:<rule id>"` (8.3) |
| `decision.channel` | **New.** `"terminal"` (a person at the CLI) or `"policy"` (an auto-approval rule). A relay over MCP would add `"mcp-elicitation"` (question 2) |
| `decision.by` | For `"policy"`, `{ "kind": "service", "id": "policy:<area>" }` |
| `redacted` | **New.** `null`, or `{ "at", "reason": "source-erased" }` (9.1) |

`state` keeps its five values; a withdrawal by the drafter sets `decision` to `null` and adds
`withdrawal: { "by": "drafter" | "proposer", "reason" }` with reasons `source-erased`, `source-changed`,
`superseded-alternative`, `retracted` (version 2 only).

### 2.2 Plugin manifest, version 4 (D97)

Version 3 with one command key, `confirm_preview`, naming a command of the same plugin:

```toml
[[commands]]
name = "knowledge-approve"
confirm = "require-human"
confirm_prompt = "Apply this proposal to the knowledge base?"
confirm_preview = "knowledge-proposal-preview"
```

The named command must have the effect `inspect`, the same input schema's required keys, CLI exposure and
a digest or plain `journal`; it returns `{ "preview": <string of at most 6000 characters> }`. Otherwise
`PLUGIN_MANIFEST_INVALID` at load. `confirm_preview` needs `confirm_prompt`, and is refused on mounted
tools, component commands and pipelines. A host reads manifest versions 1 to 4.

### 2.3 Curator records, version 1

Kept by the curator instance in its own namespace through `records_write` (D90). **No record holds
memory text.**

| Kind | Id | Fields |
| --- | --- | --- |
| `candidate` | `c-` and 20 hex of SHA-256 of `<space>\0<contentHash>\0<class>` | `class`, `contentHash`, `subjectKey`, `sources: [{ id, recordVersion }]`, `sessions`, `principals`, `authority`, `access`, `sensitivity`, `status` (`settling`, `ready`, `drafted`, `needs-promotion`, `skipped`, `rejected`, `applied`, `erased`), `reason`, `firstSeenAt`, `settledAt`, `promotedTo` (proposal id), `conflictSet`, `quietUntil` |
| `run` | `r-` and 20 hex of the trace id | `space`, `startedAt`, `finishedAt`, the report's counts (7.2) |
| `consent` | the candidate id | `by`, `at`, `contentHash`, `recordVersion` (5.2) |
| `state` | `state` | `feedAfter` (the knowledge feed cursor), `memoryAfter` (the memory changes cursor), `lastRun`, `lock: { trace, until }` |

`candidate.contentHash` is a hash of memory text. It is removed when its source is erased (9.1). A
candidate record's access set is the intersection of its sources' sets; an empty intersection is the
run's caller's `principal:<kind>:<id>` token.

## 3. The curator and how it reaches proposals (D90, D91)

### 3.1 Why a pipeline

A proposal is the knowledge plugin's record (D17), and records are namespaced per instance
(`store_services.rs:330`), so the curator cannot write one. It also may not call the knowledge plugin
(D3). Three ways were weighed:

| Option | Verdict |
| --- | --- |
| **A pipeline the curator ships as data**, whose steps are curator and knowledge commands, as `knowledge-refresh` runs `sources-sync` | **Chosen.** No new grant, no plugin dependency, the proposal stays knowledge's; a missing knowledge instance leaves the pipeline unregistered and named by the doctor, as phase 1's seal already does |
| The curator inside the knowledge plugin | Rejected: knowledge would hold `memory`, so every knowledge command would need a journal mode, and the architecture's component table makes the curator its own plugin |
| A host `proposals` grant writing into another instance's namespace | Rejected: the host would own a domain record (principle 1) |

`curator-run` (a pipeline, CLI only, `journal = { mode = "digest", keep = ["space"] }`):

| Step | Command | Plugin | Input | Output |
| --- | --- | --- | --- | --- |
| `plan` | `curator-plan` | curator | `{ space }` | `{ run, submit: [draft], withdraw: [{ proposal, reason }], feedAfter }` |
| `submit` | `knowledge-propose-batch` | knowledge | `{ space, proposals: $steps.plan.data.submit, withdraw: $steps.plan.data.withdraw }` | `{ results: [{ key, proposal?, created, error? }], withdrawn: [...] }` |
| `feed` | `knowledge-proposal-feed` | knowledge | `{ space, drafter: "<instance>", after: $steps.plan.data.feedAfter }` | `{ decisions: [{ proposal, candidate, state, reason?, at }], next }` |
| `finish` | `curator-finish` | curator | `{ space, run: $steps.plan.data.run, results: $steps.submit.data.results, feed: $steps.feed.data }` | the run report (7.2) |

Every step is digest-journaled, because `plan`'s output holds memory-derived text and phase 3 refuses a
digest step's output reaching a plain step (section 2.3 of phase 3). Feedback read in `feed` is applied by
`finish`, so the next run's `plan` sees it; one run's latency is accepted. A pipeline does not loop, so the
batch command takes the whole list.

### 3.2 The drafter is attested by the host

`knowledge-propose-batch` fills `drafter` only from `CallContext.pipeline`, which the host sets in the
pipeline handler (10.1) and removes from every other context, as it does `dev.umbel/human-confirmed`. A
direct call has no mark, so its proposals have `drafter: null` and are ordinary proposals by the caller.
**The knowledge instance accepts a mark only from instances listed in its configuration**:

```toml
[plugins.knowledge.config]
drafters = ["curator"]          # default []: a marked submission is PROPOSAL_DRAFTER_NOT_ALLOWED
```

So no other plugin's pipeline can present itself as the curator, and the deployer names who drafts.

### 3.3 Not in the request path, never approving

- Every curator command is `expose = { mcp = false, agent = false, cli = true }` and never first-class.
  `tools/list`, `afd-discover` and `afd-call` over MCP do not reach them (test `not_request_path.rs`).
- The curator holds no `memory_write`, `documents_write`, `content_write` or knowledge-record grant
  (D90). It can change only its own records; proposals go through `knowledge-propose-batch`.
- Approve, reject and verify stay `confirm = "require-human"` and CLI only. A pipeline step that names
  one is refused at the plugin gate, because the CLI's mark names the pipeline, not the step
  (`middleware.rs:278`); a test holds that.
- `knowledge-auto-approve` (8.3) refuses any call carrying a pipeline mark, so no pipeline, the
  curator's included, can decide a proposal.
- An agent at a shell can still run `umbel curator-run`, as it can run any CLI command before phase 5.
  The result is proposals, which a person still decides.

## 4. Settling and candidates (D93)

### 4.1 Inputs, as phase 3 reserved them

From each readable memory record at its current version (`memory_list` under the caller's filter): `class`,
`validFrom`, `validUntil`, `expiresAt`, the current version's `recordedAt` ("stable since"),
`observations.{first,last,count,sessions}`, `invalidation`, `flags`, `provenance.authority`,
`provenance.origin`, `provenance.confidence` (as asserted), `provenance.constraints`, `confirmation`,
`access`, `sensitivity`, `contentHash`, `scope.principal`. From the memory changes feed (`memory_changes`):
`Erased`, `Purged`, `Invalidated` and `Confirmed` since `state.memoryAfter`.

**Reads use the caller's reader filter.** `ReaderFilter::Derivation` stays refused by the memory store
(question 4, D101). A run by the CLI's `human:<local_id>` reads that person's records and those of agents
acting for them (D68), and whatever is shared with them.

### 4.2 Rules and defaults

A record is **settled** at the run's instant `now` (the command context's clock) when all hold:

| Rule | Default (pack `settle`) |
| --- | --- |
| Class | `semantic` or `procedural`; `episodic` never (D15) |
| Live | Valid at `now`, not invalidated, not expired, not superseded |
| Stable since | `now - recordedAt(current version) >= semantic_days` (7) or `procedural_days` (14) |
| Sessions | The group's sessions (4.3) at least `min_sessions` (2) |
| Authority | In `authorities` (`["person"]`), which includes records a person confirmed (D84) |
| Flags | None (D75: a flagged record is never pushed, and is never proposed) |
| Confidence | Not a gate; carried into the proposal's `confidence` as asserted. `min_confidence` (unset) may make it one |

`authorities` may name `agent`, `tool` or `import`; `transcript` is refused in the pack (`CURATOR_PACK_INVALID`),
because captures are a person's conversation, not a statement.

### 4.3 Groups and counts

A candidate groups the settled records with equal `contentHash` and `class`. **`sessions` is the sum of
the records' `observations.sessions`, and `principals` the number of distinct `scope.principal` values;
neither counts writes or observations** (D81). One principal's records with one content hash are one record
per authority (phase 3, 8.2), so the sum over-counts only across authorities of the same person, which is
stated and accepted. The candidate's authority is the highest of its records in the order `person`,
`agent`, `tool`, `import`; its constraints are the union, sorted.

### 4.4 Conflict sets

`subjectKey` is the subject lowercased (Unicode), with runs of whitespace and ASCII punctuation replaced by
one space and trimmed. Candidates in a space with equal `subjectKey` and different `contentHash` form a
conflict set, id `k-` and 20 hex of SHA-256 of `<space>\0<subjectKey>`, at most `max_alternatives` (4) by
id order; more are `skipped` with reason `conflict-too-large`. Each member is drafted as an alternative with
the same `conflictSet` and target path, so applying one makes the others `PROPOSAL_CONFLICT` at apply
(the file exists), and the next run withdraws them with `superseded-alternative`. **The curator never
chooses** (D15): a person approves one, or rejects all.

### 4.5 Drafting

Per space, the curator configuration names where promotions go:

```toml
[plugins.curator.config.spaces.main]
collection = "notes"            # a markdown collection with an area (PROPOSAL_NO_AREA otherwise)
prefix = "learned/"
```

A candidate's draft is `op = "create"`, doc `<collection>/<prefix><slug>`, where `slug` is the subject
lowercased, every run of characters outside `[a-z0-9]` one `-`, trimmed, at most 64 characters, else
`mem-` and 12 hex of the content hash. If the document exists, the candidate is `skipped` with reason
`target-exists` and reported as an inconsistency (6.2). The content is fixed:

```markdown
---
title: "<subject, JSON-escaped>"
type: "<fact for semantic, procedure for procedural>"
tags: [<the records' tags, sorted, JSON strings>]
generated:
  by: "umbel:curator/<instance>"
  at: "<now>"
---
<text of the record with the earliest recordedAt>

## Holds only

- "<each constraint, JSON-escaped>"
```

The `Holds only` section is present when there are constraints; it is how S16's constraints survive
consolidation into a document a person reads. `rationale` is fixed text naming the class, authority,
sessions, principals and settling time; `evidence` is one `memory` entry per source record (2.1) with an
`excerpt` of the first 1000 characters; `idempotency_key` is `curator/<candidate id>/<contentHash prefix of
16>`, so a rerun returns the same proposal and a changed candidate makes a new one; `confidence` is the
highest asserted confidence or `null`.

### 4.6 Determinism

`curator-plan`'s output is a pure function of the readable records, documents, the pack, the curator
records and `now`: candidates in id order, drafts in candidate order, then re-verifications in document id
order, at most `max_proposals` (20) per run. Two stores written with the same records give byte-equal
`submit` lists (test `deterministic.rs`).

## 5. Access, sensitivity and promotion (D94)

### 5.1 The rule

A drafted proposal is readable by anyone who can read its target (phase 2, `knowledge-proposal-list`), so
drafting a private record for a shared collection would show that record to the collection's readers before
anyone approved anything. **A candidate is drafted on a schedule only when every token of the target's
resolved access set is in every source record's access set, and no source's sensitivity is above the
target's** (`public` < `internal` < `confidential` < `restricted`). Otherwise its status is
`needs-promotion` (access) or `skipped` with reason `sensitivity-higher`. Memory is private by default
(D68), so **most candidates need promotion**: by default a scheduled run drafts only memory a person already
shared.

### 5.2 `curator-promote` (question 5)

`curator-promote { space, candidate, contentHash }`: CLI only, `confirm = "require-human"`, refusing
`--yes` and `--approve`, digest-journaled. The caller's effective principal must be the `scope.principal` of
**every** source record (as D88 limits `memory-confirm`), else `CURATOR_PROMOTE_NOT_ALLOWED`; the
`contentHash` must match, as `memory-confirm` asks (prompts are static, so the hash proves the person looked
with `curator-candidates`). It writes a `consent` record. The next run drafts the candidate with
`drafter.mode = "promoted"` and `promotedBy`. Sensitivity is never overridden. The prompt says that the text
will be readable by the target collection's readers once proposed.

## 6. Re-verification and inconsistencies (D95)

### 6.1 Scheduled re-verification

Phase 2's lifecycle (D63) has a person's verification as an applied `verify` proposal whose `verified` entry
is the deciding actor (`apply.rs`, `rewritten`). So the curator raises `op = "verify"` proposals and **a person
approving one is the verification**; the curator never attests. A readable document is due when it has
`stale_after` and `now >= stale_after - lead_days` (14), is not deprecated, and has no open proposal. It is
drafted only when its deterministic checks pass, each named in the evidence as `{ kind: "text", ref:
"check:<name>", excerpt: "pass" }`: `links-resolve` (no `broken-links` flag on the document record),
`sources-unchanged` (every `sources` entry naming a document with a hash still has that hash) and
`not-flagged`. `verification.staleAfter` is `now + every_days` (180) from the pack. At most `max_per_run`
(20). Documents without `stale_after` are never due. Due documents failing a check are reported (6.2).

### 6.2 Inconsistencies

Deterministic inconsistencies the curator can resolve become proposals; the rest are reported in the run
report and `curator-status`, never decided:

| Inconsistency | Handling |
| --- | --- |
| A document names `superseded_by` that resolves, and its `status` is not `deprecated` | `op = "deprecate"` proposal with `supersededBy`; the only kind an auto rule may apply (8.3) |
| A conflict set (4.4) | Alternatives, one per member |
| A candidate whose target exists | Reported: `target-exists` |
| A due document failing a check | Reported: `check-failed` with the check's name |
| A deprecated document whose successor does not resolve | Reported: `successor-missing` (as `knowledge-stale` already reports) |

Proposing an edit that needs judgment (a broken link, a changed source) would need drafting by a model or a
person, and is out of scope (section 14).

## 7. Feedback, runs and scheduling (D96)

### 7.1 Rejection feedback

`knowledge-reject` already requires a reason "the curator reads next run". `knowledge-proposal-feed` returns
decisions on proposals with `drafter.instance` equal to its input, after a cursor (the record store's change
revision), readable proposals only. `curator-finish` marks the candidate `rejected`, keeps the reason in the
candidate record, and sets `quietUntil = now + quiet_days` (90): **a rejected candidate is not drafted again
with the same content hash until then**. A changed record has a new content hash and is a new candidate.
`applied` marks the candidate `applied` with `promotedTo` and is never drafted again.

### 7.2 The run report

`curator-report.v1.json`: `{ space, run, at, counts: { read, settled, candidates, drafted, needsPromotion,
skipped, rejected, applied, withdrawn, reverify }, skipped: [{ candidate, reason }], inconsistencies: [{
kind, doc? , candidate? }], proposals: [ids], next: { overdueAfter } }`. Counts are over what the caller
reads; ids only, never text. `curator-status { space }` returns the last report and `overdue`.

### 7.3 Scheduling

No daemon and no background process (D76's precedent): a deployer runs `umbel curator-run --space <s>` from
cron, CI or a session-end hook. `curator-status` says `overdue` when the last run is older than twice
`every_hours` (24); the doctor's `curator.overdue` check warns. **One run at a time per space**: `curator-plan`
takes `state.lock` by compare-and-set with `until = now + 10 minutes`; a second run gets `CURATOR_BUSY`
(retryable); `curator-finish` releases it, and an expired lock is taken over. A run reads at most `max_records`
(5000) memory records and 2000 documents, and reports `remaining` beyond them.

## 8. Approval (D97 to D100, D102)

### 8.1 The confirmation preview (D97)

Phase 2's follow-up says approval "must do before real use": the static prompt cannot show what is
approved. Curator drafts are machine text, so phase 4 closes it. When a command declares
`confirm_preview` (2.2), the CLI, before the confirmation prompt (`src/cli/mod.rs`, before `prompt::confirm`),
calls the preview command with the same input under the same context minus the marks, and prints its
`preview` to stderr, every line prefixed `> `, control characters, U+2028, U+2029 and bidirectional controls
removed, at most 6000 characters, then the static prompt. A failed preview refuses the call
(`CONFIRMATION_PREVIEW_FAILED`, nothing run). `knowledge-proposal-preview` renders: id, op, document, area,
drafter, `conflictSet`, flags, each evidence entry's kind, authority, origin, constraints and access (memory
entries) or reference, and the diff's first 80 lines. It applies approve's reader rules, so an approver never
sees what they may not read. `knowledge-approve`, `knowledge-reject` and `knowledge-verify` declare it. A
proposal's content never changes after submission (`PROPOSAL_KEY_REUSED`), so what is previewed is what is
applied.

### 8.2 Who authored a draft (question 6, D102)

The CLI is always `human:<local_id>` before phase 5, so the person whose cron runs `curator-run` is the
proposal's `proposer.actor`, and phase 2's rule (`apply.rs:207`) would call their approval self-approval.
Recommended: for a drafted proposal the author is the curator, so **self-approval compares the approver with
`drafter.promotedBy`**: a scheduled draft may be approved by the person who ran the schedule, with
`exception: null`; a promoted draft approved by the person who promoted it is `self-approval`, allowed only
where the area allows it. The applied document's origin is `agent-inferred` for every drafted proposal.

### 8.3 Auto-approval rules (question 1, D98)

Recommended: the mechanism, with **one** rule kind, off by default.

```toml
[plugins.knowledge.config.areas.handbook]
auto = ["deprecate-declared"]   # default []
```

`knowledge-auto-approve { space, limit? }` (CLI only, `store-write` and `workspace-write`, digest-journaled
with `keep = ["space"]`, no AFD approval, refusing any call with a pipeline mark:
`PROPOSAL_AUTO_NOT_ALLOWED`) applies each pending proposal of an area that lists a rule the proposal meets,
through the same apply steps, with `policy.rule = "auto:<rule>"`, the policy version covering `auto`,
`decision.channel = "policy"`. **`deprecate-declared`** holds when: `op = "deprecate"`; drafted; the target's
own frontmatter already names `superseded_by` equal to `change.supersededBy`, which resolves to a readable,
non-deprecated document; no flags; no `conflictSet`. **Never auto-approved, whatever an area lists:** `create`,
`update` and `verify`; anything with memory evidence; anything flagged; any alternative. A deprecated document
drops out of search (D58), so even this rule changes what agents see; it is the author's own declaration,
applied.

### 8.4 The MCP approval relay (question 2, D99)

What a relay would mean here: AFD's relay (`spec/command-metadata.md`, "Asking the human over MCP", TypeScript
only) asks the client to show a form; "a server cannot tell a person's answer from client code that answers
on its own", and the 2026-07-28 elicitation text fixes no interaction model. Umbel's gate accepts a
`require-human` confirmation only from the CLI (`middleware.rs:278`), and every MCP caller before phase 5 is
an agent (stdio) or `agent:loopback` (HTTP), while phase 2 lets only humans approve. A relay would therefore
record an approval by "the person behind an unverified client". **Recommended: keep approval CLI-only in
phase 4, and move both the Rust relay (an AFD prerequisite) and Umbel's use of it to phase 5**, where the
principal is verified. When it lands it must: be opt-in per area (`approve_over_mcp`, default false); carry
the preview of 8.1 as the elicitation `message`; record `decision.channel = "mcp-elicitation"` and the
verified person; never apply to `require-human` commands other than approve and reject.

### 8.5 The optional model (question 3, D100)

D7 allows the curator a configured model for background work. **Recommended for phase 4: no model.** Drafts
are the fixed rendering of 4.5; `[plugins.curator.config.model]` is reserved and refused at load with
`CURATOR_MODEL_UNAVAILABLE`, and `drafter` gains `model` only when one exists. Reasons: memory text would
leave the process to wherever the deployer's model runs; a model reading untrusted memory can be steered into
plausible drafts a busy approver accepts (S14, S15); and drafts would stop being reproducible. The alternatives
are in section 16.

## 9. Changed and forgotten evidence (D103, D104)

### 9.1 What an open proposal does when its source changes (question 7)

Phase 3 left this to phase 4 (D73, D81, D85). The curator learns of changes from the memory changes feed
(4.1), filtered by the access the record had at the change. On its next run, for each open drafted proposal:

| Source change | Recommended handling |
| --- | --- |
| `Erased` (a forget) | Withdraw with `source-erased` **and redact**: the knowledge plugin replaces `change.content`, `diff`, every memory evidence `excerpt`, `contentHash` and `derivedFrom` with nothing (2.1) and sets `redacted`; the curator deletes the candidate's `contentHash` and sources |
| `Purged`, `Invalidated`, superseded or expired | Withdraw with `source-changed`; no redaction |
| `Confirmed` | Nothing: the next plan may raise the candidate's authority |

A withdrawal is not a decision on knowledge, so it is allowed to the drafter (a `withdraw` entry from a marked
call whose instance matches `drafter.instance`), beside phase 2's proposer. **An applied proposal is not
retracted**: it is knowledge a person approved. Its `derivedFrom` keeps the source hash, which D85 already
lists as disclosed residue. **Limits, stated:** the window between a forget and the next run, in which a
person could approve; the old record bytes in `store.sqlite3`'s free pages and WAL, since the document store
is not `secure_delete` (phase 2); `store-backup` copies; text an approver copied elsewhere.

### 9.2 Memory is never written (question 8)

The architecture's data diagram has knowledge invalidating superseded memory (`KB -. invalidates .-> M`), and
phase 3 reserved `memory-invalidate` reason `outdated` and the record fields `promotedTo`, `candidate` and
`settledAt` for it. **Recommended: the curator holds no `memory_write` and writes no memory record.** The
reserved fields stay reserved; candidate state lives in curator records (2.3). After a promotion is applied,
`curator-status` lists the source records whose owner may close them with `memory-invalidate`, reason
`outdated`. This also keeps phase 3's refusal of `memory_write` beside a document write grant untouched.

## 10. Host services

### 10.1 The pipeline mark (D91)

`PipelineHandler::execute` (`src/plugins/pipelines.rs`) sets, in each step's context,
`extra["dev.umbel/pipeline"] = { "instance", "pipeline" }` for the pipeline's own instance. The host removes
the key from every context it did not set: the CLI's single-command and batch contexts, the MCP context hook
and the in-process client. The SDK exposes it as `CallContext.pipeline: Option<PipelineMark { instance,
pipeline }>`. Pipelines do not nest, so a mark names exactly one pipeline. Components do not see it (WIT 1.0.0
is frozen). Tests: `tests/pipeline_mark.rs` (set for steps, absent for direct calls, a forged key from
`umbel batch`, `afd-call`, `afd-pipe` and the MCP route removed).

### 10.2 The confirmation preview (D97)

Manifest version 4's `confirm_preview` (2.2) and the CLI flow of 8.1; nothing changes on MCP, where
`require-human` commands stay unreachable. Tests: `tests/manifest_v4.rs`, `tests/cli_confirm_preview.rs`.

### 10.3 Grants

No new grant. The curator declares `config`, `packs`, `clock`, `memory`, `documents`, `graph`, `records` and
`records_write` (allow `<space>`). `memory` reads stay under the caller's filter; derivation stays refused
(question 4).

## 11. The plugins

### 11.1 `curator` (D90)

Manifest version 4 (it holds `memory`, so every command and pipeline declares `journal`). Every command is
CLI only and digest-journaled with `keep = ["space"]`.

| Command | Effects | Contract |
| --- | --- | --- |
| `curator-run` | pipeline, `store-write` | Section 3.1 |
| `curator-plan` | `store-write` | Takes the lock; reads memory, the changes feed, documents and curator records; updates candidates; returns drafts and withdrawals (4, 6, 9) |
| `curator-finish` | `store-write` | Records results, feedback and the report; releases the lock |
| `curator-status` | `inspect` | The last report, `overdue`, the promotable candidates (ids and reasons), the records an owner may invalidate (9.2) |
| `curator-candidates` | `inspect` | Candidates by status, with counts, authority, access and the content hash for the caller's own; no text |
| `curator-promote` | `store-write` | Section 5.2; `confirm = "require-human"` |

Pack `settle` (overridable per space, D46): `[settle] semantic_days = 7, procedural_days = 14, min_sessions =
2, authorities = ["person"]`; `[conflict] max_alternatives = 4`; `[reverify] lead_days = 14, every_days = 180,
max_per_run = 20`; `[feedback] quiet_days = 90`; `[run] every_hours = 24, max_records = 5000, max_proposals =
20`. Skill `curator-guide`: what a run does, promotion, that drafts are data.

### 11.2 `knowledge`

Moves to manifest version 4. New and changed:

| Command | Effects | Exposed | Journal | Contract |
| --- | --- | --- | --- | --- |
| `knowledge-propose-batch` | `store-write` | every surface | digest | `{ space, proposals: [propose input] (at most 50), withdraw?: [{ proposal, reason }] }`; each item is `knowledge-propose`'s validation; `drafter` from the mark (3.2); memory evidence shape checked; results per item, never failing the whole call for one item |
| `knowledge-proposal-feed` | `inspect` | CLI | digest | Section 7.1 |
| `knowledge-proposal-preview` | `inspect` | CLI | digest | Section 8.1 |
| `knowledge-auto-approve` | `store-write`, `workspace-write` | CLI | digest | Section 8.3; built only if question 1 is answered yes |
| `knowledge-proposal-show` | unchanged | unchanged | **digest** (was plain) | So a drafted proposal's text never enters the journal (D92) |
| `knowledge-approve`, `-reject`, `-verify` | unchanged | unchanged | unchanged | `confirm_preview`; 8.2's author rule; drafted applies get `agent-inferred` |
| `knowledge-withdraw` | unchanged | unchanged | unchanged | Also by the drafter (9.1) |

Configuration adds `drafters` (3.2) and per area `auto` (8.3).

### 11.3 Error and warning codes

| Code | When | Retryable |
| --- | --- | --- |
| `CURATOR_BUSY` | Another run holds the space's lock | Yes |
| `CURATOR_PACK_INVALID` | The `settle` pack does not read, or names `transcript` | No |
| `CURATOR_TARGET_UNCONFIGURED` | No `spaces.<id>` target for the run's space | No |
| `CURATOR_CANDIDATE_NOT_FOUND` | Absent or unreadable alike | No |
| `CURATOR_PROMOTE_NOT_ALLOWED` | A source is not the caller's own, or its hash changed | No |
| `CURATOR_MODEL_UNAVAILABLE` | `config.model` is set (8.5) | No |
| `PROPOSAL_DRAFTER_NOT_ALLOWED` | A marked submission from an instance not in `drafters` | No |
| `PROPOSAL_BATCH_TOO_LARGE` | More than 50 proposals or withdrawals | No |
| `PROPOSAL_AUTO_NOT_ALLOWED` | `knowledge-auto-approve` with a pipeline mark | No |
| `CONFIRMATION_PREVIEW_FAILED` | The preview command failed; nothing ran | No |
| `CANDIDATE_SKIPPED` (warning) | A run skipped candidates; details hold counts by reason | |

## 12. Security

| Threat | Control | Test |
| --- | --- | --- |
| **Poisoned memory promoted** (S14): an agent's note, written after reading hostile content, becomes knowledge | Only `person` authority settles by default (an agent's note needs `memory-confirm`); flagged never; two sessions; a person approves every content change, after the preview showing each source's authority and origin; no auto rule applies to content | `curator/tests/poisoning.rs` |
| **Private memory disclosed through a proposal** | 5.1's access rule; promotion only by the owner at a terminal; candidate records hold no text and are readable only by their sources' readers | `curator/tests/access_rule.rs`, `first-party/tests/curator_leaks.rs` |
| **Rubber-stamped machine drafts** | The confirmation preview with the diff and evidence (8.1); drafts are fixed renderings with a `generated` key | `cli_confirm_preview.rs`, `knowledge/tests/preview.rs` |
| **A forged curator** | The host-set mark and the `drafters` list (3.2) | `pipeline_mark.rs`, `knowledge/tests/drafted.rs` |
| **The curator approving its own work** | No approve path: CLI-only `require-human` refused in a pipeline step; auto refuses a mark | `curator/tests/not_request_path.rs` |
| **Frequency inflation** | Sessions and principals counted, never writes or observations (4.3) | `curator/tests/settle.rs` |
| **Constraints lost in consolidation** (S16) | `Holds only` in the document; constraints in every memory evidence entry | `curator/tests/draft.rs` |
| **Forget residue** | Digest journaling of every step and of `knowledge-proposal-show`; withdraw and redact (9.1); limits stated there | `curator/tests/forgotten.rs`, `first-party/tests/exit_curator.rs` |
| **Model injection** | No model (8.5) | `CURATOR_MODEL_UNAVAILABLE` in `curator/tests/config.rs` |
| **Hidden counts** | Reports and status count only what the caller reads; ids, never text | `curator_leaks.rs` |
| **Runaway runs** | One lock per space; caps per run (7.3) | `curator/tests/run.rs` |
| **Auto-deprecation hiding a document** | Off by default; one narrow rule; events and `policy.rule` record each; a person can propose the reverse | `knowledge/tests/auto_approve.rs` |

Content trust is phase 2's (D67): drafts, excerpts and rejection reasons are `trust: "content"` and never in
messages, reasoning or warnings. The curator's skill says drafts are data.

## 13. Exit criterion and tests

The exit criterion is met when `umbel.yml` is green on `main` with every test below and
`first-party/tests/exit_curator.rs` passes in it: the real `umbel-first-party` binary as a child process, the
frozen clock and the stand-in person of `testkit`, a space `alpha` with a `notes` collection and an area over
it, `drafters = ["curator"]`, and the curator's target `notes/learned/`. It asserts:

1. **A scheduled draft.** A person remembers a semantic fact at the terminal (authority `person`) shared with
   the space, with one constraint and a canary, observed in two sessions; at day 3, `curator-run` reports it
   `settling`; at day 8, `ready`, and drafts one proposal, version 2, with `drafter.mode = "scheduled"`, one
   `memory` evidence entry with `authority`, `origin`, `constraints` and `access` equal to the record's, and
   `derivedFrom` naming the record and its hash. The run's journal entries and events hold no canary.
2. **Approved from the CLI.** `knowledge-approve` prints the preview (the diff, the drafter and the evidence's
   authority) and is confirmed by the stand-in person; the person who ran the schedule approves with
   `exception: null` and `decision.channel = "terminal"`.
3. **Lands with full provenance.** The file on disk is the fixed rendering with `Holds only`; the document's
   envelope has `origin: agent-inferred`, `generated.by = "umbel:curator/curator"` and `derivedFrom` the
   proposal; after `knowledge-refresh`, `knowledge-search` finds it; the candidate record is `applied` with
   `promotedTo` and `settledAt`; events exist for the submission and the apply; a second run drafts nothing.
4. **Promotion.** A private fact of the same person is `needs-promotion`; after `curator-promote`, the next run
   drafts it with `promotedBy`; approving it is `PROPOSAL_SELF_APPROVAL` unless the area allows it.
5. **Feedback.** A rejected draft is not drafted again inside the quiet period, and its reason is in the
   candidate record.
6. **Forgotten evidence.** A drafted proposal's source is forgotten; the next run withdraws it with
   `source-erased`, and its record holds neither the canary nor the source hash.
7. **Not in the request path.** Over the binary's stdio MCP server, no curator command is listed, discovered
   or callable, and `knowledge-approve` is not callable.

**CI.** The `memory` job of `umbel.yml` adds `-p umbel-plugin-curator`; the `check` job excludes it. No new job.

| Test file | Crate | Covers |
| --- | --- | --- |
| `tests/schemas.rs` (extended) | host | `proposal.v2`, `plugin-manifest.v4`, `curator-record.v1`, `curator-report.v1` and examples; version 1 proposals still validate |
| `tests/manifest_v4.rs` | host | `confirm_preview` rules of 2.2; versions 1 to 3 still load |
| `tests/pipeline_mark.rs` | host | 10.1 |
| `tests/cli_confirm_preview.rs` | host | 8.1: shown before the prompt, sanitised, capped; a failing preview refuses; `--yes` still refused for `require-human` |
| `plugins/knowledge/tests/proposals_v2.rs` | knowledge | Version 2 written, version 1 kept in its version; every new field; `derivedFrom` with memory entries |
| `plugins/knowledge/tests/drafted.rs` | knowledge | Mark required for `drafter`; `drafters` list; batch results per item; withdraw by drafter; 8.2's author rule; `agent-inferred` |
| `plugins/knowledge/tests/preview.rs` | knowledge | The rendering, reader rules, flags, cap |
| `plugins/knowledge/tests/redaction.rs` | knowledge | 9.1's redacted record; idempotent; applied proposals untouched |
| `plugins/knowledge/tests/auto_approve.rs` | knowledge | 8.3, if built |
| `plugins/knowledge/tests/proposals.rs`, `verification.rs` (existing) | knowledge | Unchanged behaviour of phase 2 |
| `plugins/curator/tests/settle.rs` | curator | Every rule and default of 4.2; counts of 4.3 |
| `plugins/curator/tests/conflicts.rs` | curator | Keys, alternatives, cap, siblings withdrawn |
| `plugins/curator/tests/draft.rs` | curator | 4.5's rendering, slugs, keys, `target-exists`, constraints |
| `plugins/curator/tests/access_rule.rs` | curator | 5.1; sensitivity; candidate record access |
| `plugins/curator/tests/promote.rs` | curator | 5.2 |
| `plugins/curator/tests/reverify.rs` | curator | 6.1 and its checks; 6.2's table |
| `plugins/curator/tests/feedback.rs` | curator | 7.1 |
| `plugins/curator/tests/run.rs` | curator | The pipeline, lock, caps, report, status, doctor `curator.overdue` |
| `plugins/curator/tests/forgotten.rs` | curator | 9.1 for each change kind |
| `plugins/curator/tests/deterministic.rs` | curator | 4.6 |
| `plugins/curator/tests/poisoning.rs` | curator | Section 12's first row |
| `plugins/curator/tests/not_request_path.rs` | curator | 3.3 |
| `plugins/curator/tests/config.rs` | curator | Targets, pack override, model refused |
| `plugins/curator/tests/no_plugin_dependency.rs` | curator | Section 1 |
| `first-party/tests/curator_leaks.rs` | first-party | `bo` sees none of `ada`'s private candidates, drafts, counts or reports |
| `first-party/tests/exit_curator.rs` | first-party | The exit criterion above |

## 14. Out of scope, and the seams reserved

| Out of scope | When | Seam |
| --- | --- | --- |
| The MCP approval relay | Phase 5, if question 2 is answered as recommended | `decision.channel`; 8.4's conditions |
| A model drafting or extracting | When the owner decides (question 3) | `config.model` reserved; `drafter.model` |
| Derivation reads of memory, team-wide candidates | Phase 5 or later (question 4) | `ReaderFilter::Derivation`, still refused by the memory store |
| Writing memory: `promotedTo`, `candidate`, `settledAt` on records; knowledge invalidating memory | Only by a new owner decision (question 8) | The reserved fields; `memory-invalidate` reason `outdated` |
| Procedural memory as skills in a pack (D15) | When a deployer asks | Procedural candidates are drafted as documents of type `procedure`; a pack target kind is reserved in `spaces.<id>` |
| Update proposals needing judgment (broken links, changed sources, memory contradicting a document) | With a model or a person's tooling | Reported inconsistencies (6.2) |
| More auto-approval rule kinds | By owner decision | The `auto` list and `policy.rule = "auto:<rule>"` |
| A background scheduler, MCP Tasks for runs | Never in the request path; Tasks in phase 5 | `curator-run` is one bounded command |
| Cross-space promotion | Never by default (principle 16) | Candidates and proposals take one space |

## 15. Implementation plan

**No step 0** in the recommended options: AFD needs no change. If question 2 is answered "relay in phase 4",
step 0 is the Rust relay in AFD (spec first, then Rust, as phase 2's step 0 was). Each step is one pull
request, green on the repository's checks and `umbel.yml`, and updates [STATUS.md](../../STATUS.md) and this
file. A step that finds a design decision stops and amends this document. Steps that change host code carry
the `Plugin-isolation-exempt:` line.

| Step | Pull request | Contents | Tests | Size |
| --- | --- | --- | --- | --- |
| 1 | Shapes | The four schemas of section 2 with examples; manifest version 4 parsing; version constants | `schemas.rs`, `manifest_v4.rs` | S |
| 2 | Host: mark and preview | 10.1 and the SDK field; 10.2 and the CLI flow | `pipeline_mark.rs`, `cli_confirm_preview.rs` | M |
| 3 | Knowledge: proposal version 2 | Version 2 records; `drafters`; `knowledge-propose-batch`, `-proposal-feed`, `-proposal-preview`; `confirm_preview` on approve, reject and verify; 8.2's rule; withdraw by drafter and redaction; `knowledge-proposal-show` digest; manifest version 4 | `proposals_v2.rs`, `drafted.rs`, `preview.rs`, `redaction.rs`, existing suites | L |
| 4 | Curator: candidates | The crate, pack, skill, config; `curator-plan`'s memory side (4, 5), `curator-candidates`, `curator-promote`; curator records | `settle.rs`, `conflicts.rs`, `draft.rs`, `access_rule.rs`, `promote.rs`, `deterministic.rs`, `config.rs`, `no_plugin_dependency.rs` | L |
| 5 | Curator: runs | `curator-run`, `curator-finish`, `curator-status`; re-verification and inconsistencies (6); feedback (7.1); lock and caps; forgotten evidence (9.1); doctor check; the `memory` job gains the crate | `reverify.rs`, `feedback.rs`, `run.rs`, `forgotten.rs`, `poisoning.rs`, `not_request_path.rs` | L |
| 6 | Auto-approval | `knowledge-auto-approve` and `deprecate-declared` (8.3). **Only if question 1 is answered yes**; otherwise dropped | `auto_approve.rs` | S |
| 7 | Binary and exit | `umbel-first-party` gains curator; `curator_leaks.rs`, `exit_curator.rs`; STATUS.md marks phase 4 done with the run's evidence | The two | M |

**Order.** 1, 2, 3 in order; 4 needs 1; 5 needs 3 and 4; 6 needs 3; 7 needs all. **Build cost.** No new
dependency family. The curator crate builds `umbel` without wasmtime, as the other plugin tests do; share
`CARGO_TARGET_DIR`, use `-p <crate>`, `-j4`, under load 20.

## 16. For the owner

Eight questions; each changes the trust model, and none is decided here. Each names the decision that records
the answer and the sections it changes.

1. **Auto-approval rules** (D98; 8.3, step 6). Should any proposal be applied without a person in phase 4?
   *Recommended:* ship the mechanism with one rule kind, `deprecate-declared`, off by default per area, and never
   for `create`, `update`, `verify`, memory-derived, flagged or alternative proposals. *Alternatives:* (a) no
   auto-approval in phase 4 (drop step 6; the record still allows `auto:` later); (b) add a rule applying
   `create` proposals from `person`-authority memory, which I do not recommend.
2. **The MCP approval relay** (D99; 8.4). Should a person approve over MCP in phase 4? *Recommended:* no; keep
   approve CLI-only, and move the Rust relay prerequisite and Umbel's use of it to phase 5, when the person
   behind an MCP client is verified, with 8.4's conditions. *Alternatives:* (a) build the AFD Rust relay now (a
   step 0) and leave it unused by Umbel until phase 5; (b) enable it now per area, recording "the person
   behind an unverified client".
3. **The optional model** (D100; 8.5). *Recommended:* no model in phase 4; the configuration key reserved and
   refused. *Alternatives:* (a) a deployer-configured command the curator runs as a child process with a JSON
   request on stdin (candidate, memory text, target) and a draft on stdout, CLI only, its output recorded and
   never replayed, the model named in `drafter.model`; (b) an HTTP endpoint once the `http` and `secrets`
   grants exist (phase 5).
4. **Reading other people's memory** (D101; 4.1). *Recommended:* the curator reads memory only under its
   caller's reader filter; `ReaderFilter::Derivation` stays refused. *Alternative:* a derivation read under a
   new rule (a CLI-only `store-write` command, allowed per instance), so a team's shared candidates could be
   counted across principals; it would let the curator see records its caller cannot.
5. **Widening a private record into a proposal** (D94; 5). *Recommended:* a scheduled run drafts only records
   whose readers already cover the target's; a person widens their own records, at a terminal, through
   `curator-promote`, own records only, as D88 limits `memory-confirm`. *Alternatives:* (a) no widening in
   phase 4, so private memory is never proposed; (b) let an area's approver promote others' records, which
   before phase 5 cannot tell one local person from another.
6. **Who authored a scheduled draft** (D102; 8.2). *Recommended:* the curator; the person who ran the schedule
   may approve it with no exception; a promoted draft's author is the person who promoted it, so their own
   approval is self-approval. *Alternatives:* (a) the runner is the author, so in a one-person workspace every
   draft needs `allow_self_approval`; (b) always require an approver other than the runner.
7. **Forgotten evidence in an open proposal** (D103; 9.1). *Recommended:* the curator's next run withdraws it
   and the knowledge plugin redacts its content, diff, excerpts and source hashes; invalidation or expiry
   withdraws without redaction; an applied proposal is never retracted. *Alternatives:* (a) withdraw only,
   keeping the hash as D85's disclosed residue; (b) keep the proposal open and let the approver decide.
8. **Writing memory** (D104; 9.2). *Recommended:* the curator never writes memory; after a promotion,
   `curator-status` lists records their owner may invalidate as `outdated`. *Alternative:* the curator holds
   `memory_write` and invalidates a promoted record itself, filling the reserved fields, which needs memory
   record version 2 and makes the curator a memory writer.

**Decisions made here that do not change the trust model** (proposed, in review like the rest): the pipeline
composition and host mark (D91), proposal record version 2 (D92), settling defaults and conflict sets (D93),
re-verification through `verify` proposals a person approves (D95), feedback and scheduling (D96), and the
confirmation preview (D97), which strengthens approval and closes phase 2's "must do before real use".

## Follow-ups

| Date | Follow-up | Owner |
| --- | --- | --- |
| 2026-11-03 | Procedural candidates as skills in a pack (D15), with a pack target kind | When a deployer asks |
| 2026-11-03 | Update proposals that need judgment (6.2's reported kinds), with a model or person tooling | After question 3 |
| 2026-11-03 | The document store has no `secure_delete`, so a redacted proposal's old bytes can stay in free pages and the WAL (9.1) | Phase 6, or when a deployer asks |
| 2026-11-03 | `sessions` over-counts across one person's records of different authority (4.3); exact counting needs session ids the store does not return | When it matters |
| 2026-11-03 | A memory retrieval eval before any ranking of candidates beyond the fixed rules (phase 3's follow-up) | After phase 4 |
| 2026-11-03 | Phase 3's follow-up on sharing writers closing others' records (step 10, item 1) also bears on 9.2's listed invalidations | Owner, before phase 5 |
