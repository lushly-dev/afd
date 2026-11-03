# Phase 4 specification: curator

| Field | Value |
| --- | --- |
| Phase | 4, curator ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | Repository owner approves; the phase 4 owning agent writes and implements |
| Read first | [STATUS.md](../../STATUS.md), then the [architecture](../../architecture.md), the [decision log](../../decisions.md), the [phase 2 specification](../2-knowledge/spec.md) (proposals, areas, verification) and the [phase 3 specification](../3-memory-context/spec.md), whose section 13 binds what this phase may do with memory |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request, as the phase 2 and 3 steps did |

## Status

- **State:** **approved 2026-11-03, under the owner's 2026-10-31 delegation, with the owner's answers of
  2026-11-03 (D24)**, after an independent review and a revision ([Review response](#review-response)). Written
  2026-11-03 by the phase 4 owning agent. It adds decisions [D90 to D105](../../decisions.md), decided with the
  owner's answers, and the architecture amendments they need. The owner chose the recommended option on nine of
  the ten trust-model questions. On question 10 the owner chose **attest and verify**: the knowledge plugin checks
  every claim a drafter makes rather than trusting it (3.2). Section [16](#16-for-the-owner) records each answer as
  the owner's decision of 2026-11-03. Implementation starts with step 1.
- **The owner's correction, 2026-11-03.** Question 10 was first written in as "attest and trust" and corrected
  before commit. Sections 1, 2.1, 3.2, 4.5, 8.1, 8.2, 11, 12, 13 and 15 changed with it; the review response rows
  3 and 5 describe the review-time text and are superseded by 3.2.
- **Last verified:** 2026-11-03 against `main` at `f0c618aa` (phase 3 done), and again for the review. Read in
  `endpoints/umbel`:
  - `plugins/knowledge/src/proposal/{mod,model,area,propose,apply,review,document,common}.rs` and
    `plugins/knowledge/umbel-plugin.toml`. `knowledge-approve` has a static `confirm_prompt`,
    `approval = "required"`, `confirm = "require-human"`, and is CLI only. Self-approval means the
    approving actor string equals the proposing one (`apply.rs:207`). An applied document is
    `user-stated` only when the proposer was a human (`apply.rs:351`). Only `document` evidence is
    checked (`propose.rs:521-526`). A proposal's envelope has `derivedFrom: null` (`propose.rs:372`).
    Withdraw belongs to the proposing actor alone (`review.rs:192`). The proposal id derives from the
    idempotency key (`model.rs:205`). `common::summary` returns `doc` and `changeHash` (`common.rs:229`).
    A reused key with other content is `PROPOSAL_KEY_REUSED` (`propose.rs:230-235`). The input schemas of
    approve (`[proposal]`), reject (`[proposal, reason]`) and verify (`[doc]`) are closed.
  - `schemas/proposal.v1.json`: closed, with `policy.rule` the constant `"person"` (line 206) and envelope
    version 1. **So the curator's fields cannot go "on proposal record version 1"**, as the architecture's
    phase table said; this document makes version 2 (2.1) and amends the architecture.
  - `store/src/envelope.rs`: `DerivedFrom` with a required, parsed hash (lines 193-203, 355); at most 64
    `sources` and `derivedFrom` entries (lines 341-347).
  - `store/src/memory.rs`:
    - `MemoryMeta` (lines 770-801) has class, scope, subject, tags, access, sensitivity, flags, authority,
      origin, validity, `recorded_at` and `expires_at`, but no `contentHash` or `observations`.
    - `Observations` (line 180).
    - The changes feed (lines 991-1200) has no expiry kind; a supersede is `Invalidated`.
    - `refuse_derivation` (line 1243).
  - `store/src/access.rs`: `ReaderFilter::Derivation` (lines 118-171).
  - `schemas/memory-record.v1.json` reserves `promotedTo`, `candidate` and `settledAt`.
  - `src/plugins/store_services.rs`: records are namespaced per instance and read under the caller's
    filter (lines 330-370). Derivation reads need `store-write` and `index_write` or `graph_write`
    (lines 196-230).
  - `src/plugins/pipelines.rs`:
    - Every pipeline is registered with MCP, agent and CLI exposure (lines 281-287).
    - The handler runs steps with a clone of the caller's context (lines 315-335).
    - It returns every step's `data` (lines 355-379).
    - A digest pipeline keeps no key (lines 23-28).
  - `src/plugins/manifest.rs`: `PIPELINE_KEYS` has no `expose` (line 150); a plugin holding `memory_write`
    may not also hold a document write grant (line 116).
  - In `packages/rust`: `CommandRegistry::execute` refuses a command not exposed to the context's interface
    (`commands.rs:1359-1399`). AFD step trace ids are `<pipeline id>-step-<i>` (`pipeline.rs:1901`).
    `$steps.<alias>.<path>` resolves into the step's data, and an unresolved reference is omitted
    (`pipeline.rs:15-40`).
  - `src/middleware.rs`:
    - `confirmed_by_a_person` needs the CLI interface and the mark naming the command (lines 278-286).
    - The ledger is keyed by trace (lines 265-267).
    - Sealed provenance fields are cleared only for memory writers (lines 387-393).
  - `src/host/digest.rs`: a digest entry keeps every `dev.umbel/` metadata key (lines 72-79).
  - `src/host/mod.rs`: the CLI context is `human:<local_id>` (lines 584-591).
  - `src/cli/mod.rs`: the confirm prompt, the authority prompt and the marks (lines 530-580).
  - `src/doctor.rs`: doctor checks are host code, and plugins have no doctor API (lines 178-187).
  - `sdk/src/cx.rs`: `CallContext` (lines 24-46) carries no `extra`.
  - In the repository: `spec/command-metadata.md` ("Asking the human over MCP", lines 236-294) and
    `docs/language-parity.md` (line 136: the MCP approval relay is TypeScript only).
- **No Rust was built** for this document.
- **Done:** this specification, approved 2026-11-03.
  - Step 1 (shapes), 2026-11-03, merged in [#751](https://github.com/lushly-dev/afd/pull/751) as `e7aeff70`: the
    four schemas with examples, manifest version 4 parsed, validated and stored, and the version constants; its
    [amendments](#amendments-from-step-1) settle fourteen details and change no trust-model point.
  - Step 2 (host), 2026-11-03, in its pull request, from `e7aeff70`: the pipeline attestation table and the SDK's
    `CallContext.pipeline`, a version 4 pipeline's exposure checked at seal and its `result` applied, the CLI's
    confirmation preview, and `secure_delete` with a reporting checkpoint on `store.sqlite3`; its
    [amendments](#amendments-from-step-2) settle ten details and change no trust-model point.
- **Not done:** steps 3a to 7 of section [15](#15-implementation-plan); step 3a (knowledge: record and journal) is
  next.
- **Follow-ups:** section [Follow-ups](#follow-ups).

### Review response

The independent review of 2026-11-03 raised 33 findings. Each was checked against the code; 31 hold and were
fixed, and 2 hold in part.

| # | Finding | Verdict | Change made |
| --- | --- | --- | --- |
| 1 | `curator-run` reachable over MCP | Holds in part. `execute` does refuse an unexposed step when the context has an interface (`commands.rs:1359-1399`), but the pipeline is still listed and called over MCP, and library calls carry no interface | Manifest version 4's pipeline `expose`, no wider than its narrowest step, checked at seal (2.2, 10.1, steps 1 and 2, `manifest_v4.rs`, `not_request_path.rs`) |
| 2 | Forgotten memory survives in ids, paths, keys and hashes | Holds | Candidate, conflict-set ids, paths and keys are content-free (2.3, 4.4, 4.5). Erase redacts `changeHash` and the title, and drops `subjectKey` and the reason (9.1). Every knowledge command returning a drafted proposal is digest-journaled (11.2). The document store uses `secure_delete` (9.1). The forget test scans raw bytes (13) |
| 3 | `drafter` fields not attestable from the mark | Holds | Attested (`plugin`, `instance`, `pipeline`, `run`) versus asserted by a listed drafter (`mode`, `candidate`, `promotedBy`, memory evidence) (2.1, 3.2), and question 10 (superseded by the owner's decision 10: 3.2 verifies the drafter's claims) |
| 4 | The mark's anti-forgery premise is false | Holds | A host table keyed by fresh random step trace ids, not `extra`; the SDK reads the table; library embedders trusted (10.1) |
| 5 | Unchecked memory evidence | Holds | Memory evidence and memory `derivedFrom` refused without an accepted mark; the preview says "asserted by drafter" (2.1, 8.1) (superseded by the owner's decision 10: 3.2 verifies memory evidence against the store, and the preview says "verified") |
| 6 | Self-approval laundering | Holds | The recommended rule now compares the approver with `promotedBy` **and** every source's principal; the consequence is stated (8.2, question 6) |
| 7 | Per-space state against per-caller reads | Holds | State, cursors, reports and candidates are per (space, principal) and carry an access set; every run re-checks open drafts' sources (2.3, 7.2, 9.1) |
| 8 | Wrong pipeline references | Holds | `$steps.<alias>.<path>`; the feed takes its drafter from the mark (3.1) |
| 9 | Memory text in the pipeline result | Holds | Manifest version 4's pipeline `result = "last"`; finish returns ids and counts (2.2, 3.1) |
| 10 | `confirm_preview` input rule fails | Holds | The CLI passes only the preview's declared properties; verify declares no preview (2.2, 8.1) |
| 11 | Rerun not idempotent; stuck after a partial run | Holds | `generated.at` is `settledAt`, the rationale is the settle-time snapshot, keys carry a draft number; recovery and the lock owner are specified (4.5, 7.3) |
| 12 | Check at draft, use at approve | Holds | Approve re-checks access and sensitivity against the copied evidence, and source liveness when knowledge holds `memory` (question 7); threat row and tests (8.2, 12) |
| 13 | No mechanism for `curator.overdue` | Holds | Dropped from the doctor; reported by `curator-status` only (7.3) |
| 14 | Curator blind to others' open proposals | Holds | `knowledge-propose-batch` refuses a draft whose document or source already has an open proposal: `PROPOSAL_ALREADY_OPEN` (11.2) |
| 15 | `deprecate-declared` triggered by editing a file | Holds | The declaration must be in bytes an applied proposal wrote; question 1 says so (8.3) |
| 16 | Trust points written as decided | Holds | Architecture row and principle 10 row say "recommended"; D90, D91 and D93 are pending questions 4, 8, 9 and 10; new questions 9 and 10 (16) |
| 17 | Wrong citation for the CLI actor | Holds in part: `principal.rs:175` is a test, though the claim it cited (the CLI is a human) was right | Cited `host/mod.rs:584-591`, actor `human:<local_id>` |
| 18 | `MemoryMeta` lacks hash and observations | Holds | Filter on `MemoryMeta` first, then `memory_get` only the survivors, bounded per run (4.1) |
| 19 | Over-count wider; sessions are labels | Holds | Stated; the threat table no longer claims a session floor protects anything (4.3, 12) |
| 20 | Expiry has no change kind | Holds | Expiry is checked against the clock in every run's re-check (9.1) |
| 21 | `keep` ignored on a digest pipeline | Holds | Removed (3.1) |
| 22 | Path fallbacks and collisions | Holds | Opaque paths from ids; alternatives share the conflict set's path (4.4, 4.5) |
| 23 | `consent` has one record version | Holds | A list of `{ id, recordVersion }` (2.3) |
| 24 | Redaction contradicts "content never changes" and D81 | Holds | Stated as an amendment of D81's `derivedFrom` binding for erased sources (8.1, 9.1, D103) |
| 25 | Caps on withdrawals, `derivedFrom` and sources | Holds | 50 withdrawals; at most 32 sources per candidate (2.3, 11.2) |
| 26 | Memory hashes in kept metadata | Holds | No memory hash in any result's `dev.umbel/provenance` or in curator record envelopes (2.3, 11.2) |
| 27 | Preview details | Holds | "N lines not shown", the change hash, a fresh trace id (8.1) |
| 28 | Plan ordering and sizes | Holds | Step 3 split into 3a and 3b; CI wired in step 4; `deterministic.rs` in step 5 (15) |
| 29 | Two withdrawal paths | Holds | Drafter withdrawals only through the batch with the mark; `knowledge-withdraw` unchanged (9.1, 11.2) |
| 30 | Lock release, starvation, reason after erase | Holds | Finish releases only its own lock; a rotating scan cursor; reason dropped on erase (7.1, 7.3, 9.1) |
| 31 | `pipeline` is not an effect | Holds | Fixed (11.1) |
| 32 | Code prefix | Holds | `CURATOR_CANDIDATES_SKIPPED` (11.3) |
| 33 | Exit point 1 status | Holds | Read through `curator-candidates` (13) |

## What this phase serves

The phase 4 row of the architecture: *settling window, candidates and conflict sets per space, curator
proposals as decision traces, deterministic auto-approval rules per area, scheduled re-verification and
inconsistency proposals, rejection feedback, scheduled runs.* Exit criterion: *a curator proposal approved
from the CLI lands in the knowledge base with full provenance.* It settles what the row asks:
- the curator's proposal fields, on version 2 (2.1);
- auto-approval rules (8.3);
- the MCP approval relay (8.4);
- settling and re-verification defaults (4.2, 6.1);
- the optional model configuration (8.5).

It is the second half of item 4 of the proposal's [first proof](../../proposal.md#first-proof).

| Principle | How phase 4 serves it |
| --- | --- |
| 1. Empty host | The host gains a pipeline attestation table, two pipeline manifest keys and the CLI's confirmation preview, all domain-free. Candidates, drafting and feedback are the `curator` plugin's |
| 2. Plugins are the unit | `curator` never calls another plugin; it reads through grants and reaches proposals only through a pipeline it ships as data (D3, D91) |
| 3. Everything is a command | A run, a promotion and every status read are commands; a schedule is a cron line that runs one |
| 4. No model in the request path | Curator commands and its pipeline are CLI only and never first-class; phase 4 calls no model (owner decision 3) |
| 6. Deterministic core | Candidates, conflict sets and drafts are pure functions of the stores, the pack, the curator's records and the clock (4.6) |
| 7. Provenance on everything | A drafted proposal names its drafter and run (attested by the host) and its candidate, and copies each source's authority, origin, constraints and access, every claim verified by the knowledge plugin against the memory store (2.1, 3.2, 13) |
| 8. Durable knowledge changes by proposal | The curator only proposes; a person approves at a terminal, or the one deterministic rule an area may opt into, which no pipeline can trigger (8.3, owner decision 1) |
| 9. Stored content is untrusted input | By default only `person` authority settles (owner decision 9), flagged records never do, and the approver sees a preview with the diff and the evidence's authority (section 12) |
| 10. Permission-aware | The curator reads memory under its caller's reader filter (owner decision 4); a draft never widens a record's readers without its owner at a terminal (owner decision 5) |
| 14. Every mutation is an event | Runs, promotions, submissions, withdrawals and decisions are journaled commands with events naming content-free ids |
| 15. AFD first | Pipelines, digest journaling, confirmations and approvals are AFD's; no AFD change (section 15) |
| 16. Spaces do not mix | A run, a candidate and a proposal belong to one space |

Decisions served: D3, D7, D9, D13, D15, D17, D24, D25, D26, D36, D42, D46, D54, D62, D63, D66, D67, D68, D69,
D71, D72, D73, D74, D75, D78, D81, D84 and D85, and the new D90 to D105. Open decisions O1, O4 and O5 are
untouched.

## Trajectory refresh

Refreshed 2026-11-03 against primary sources. **No finding changes the architecture.** One finding weighed on
owner decision 2: the 2026-07-28 elicitation specification fixes no user interaction model.

| Row | Checked against | Finding on 2026-11-03 | Effect on phase 4 |
| --- | --- | --- | --- |
| W1 release cycle | [MCP roadmap](https://modelcontextprotocol.io/development/roadmap), last updated 2026-08-22 | 2026-07-28 is current; the same five priority areas | Pins 2026-07-28 and keeps 2025-11-25 |
| W2 MCP Events, SEP-3415 | The pull request, GitHub API | Open, not a draft, updated 2026-11-03 | Curator events stay in Umbel's log |
| W5 agent identity | The roadmap | Human-presence attestation is only "under discussion" | Approval rests on the terminal check until phase 5 (8.4) |
| Elicitation | [Elicitation, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation) | "The protocol itself does not mandate any specific user interaction model"; form schemas are flat primitives, so a diff travels only in `message`; "Servers MUST NOT rely on client-provided user identification without server verification" | A relayed approval proves a client answered, not that a person read the diff (8.4, owner decision 2) |
| W7 Tasks | The roadmap | Tasks (SEP-2663) continue toward core; no date | Runs are bounded one-shot commands (7.3) |
| W11 Open Knowledge Format | Not re-checked | Phase 2's refresh of 2026-11-01 stands | Phase 4 uses only `verified`, `stale_after`, `status`, `generated` |

Rows W3, W4, W6, W8 to W10 and W12 to W18 were not re-checked.

## Terms

Entered in the [glossary](../../architecture.md#12-glossary).

| Term | Meaning |
| --- | --- |
| Curator run | One `curator-run` call for one space and one caller: plan, submit, read feedback, finish |
| Settling window | How long a memory record's current version must stand unchanged before it can be proposed as knowledge |
| Candidate | One caller's group of readable, settled memory records with one content hash and class, kept as a curator record |
| Conflict set | One caller's candidates whose subjects normalise to the same key and whose content differs |
| Draft | The proposal input the curator renders for a candidate, a re-verification or an inconsistency |
| Drafter | The curator instance named on a drafted proposal, attested by the host's pipeline table |
| Pipeline attestation | The host's record, keyed by a step's trace id, of the plugin, instance, pipeline and run a step belongs to |
| Promotion | A person consenting, at a terminal, to have their own memory records drafted for wider readers |
| Confirmation preview | Text a command's declared preview command returns, shown by the CLI before its confirmation prompt |
| Auto-approval rule | A deterministic predicate over a proposal that an area opts into, under which the knowledge plugin applies it without a person |

## 1. Crate layout

```text
endpoints/umbel/
├── Cargo.toml                 # members += plugins/curator
├── src/plugins/pipelines.rs   # pipeline attestation, expose and result (10.1)
├── src/cli/                   # the confirmation preview (10.2)
├── sdk/src/cx.rs              # CallContext.pipeline
├── store-embedded/src/        # secure_delete on store.sqlite3 (9.1)
├── plugins/curator/           # umbel-plugin-curator: compiled plugin
├── okf/src/draft.rs           # the fixed draft rendering and id derivations, shared (4.5, 3.2)
├── plugins/knowledge/         # proposal version 2, the drafted path and its verification, preview, feed, auto rules
├── first-party/               # umbel-first-party gains curator
└── schemas/                   # + the shapes of section 2
```

| Crate | Depends on | New third-party dependencies | Notes |
| --- | --- | --- | --- |
| `umbel` (host) | as before | none | Section 10; manifest version 4 |
| `umbel-sdk` | as before | none | `CallContext.pipeline: Option<PipelineAttestation>`; WIT world 1.0.0 unchanged, so components never see it |
| `umbel-store-embedded` | as before | none | `secure_delete=ON` on every `store.sqlite3` connection |
| `umbel-okf` | as before | none | Gains `draft`: the rendering of 4.5, `subject_key`, and the candidate, conflict-set and document-id derivations, so the curator renders and the knowledge plugin re-renders to verify, without depending on each other (D3 governs plugins, not libraries; D57) |
| `umbel-plugin-knowledge` | as before | none | Section 11.2; declares `memory`, read only (owner decision 7) |
| `umbel-plugin-curator` | `umbel-sdk`, `umbel-store`, `umbel-okf`, `umbel-scan` | `sha2`, `toml`, `chrono`, `serde_json` (in the lock) | Kind `compiled`; id `curator`, domain `curator` |
| `umbel-first-party` | + `umbel-plugin-curator` | none | |

`plugins/curator/tests/no_plugin_dependency.rs` fails if the crate depends on any `umbel-plugin-*` or directly
on an HTTP client (`reqwest`, `hyper`, `ureq`). The crate is `publish = false`, quarantined in
`scripts/release/inventory.json` with no route, with `architecture.json` rows.

## 2. Versioned shapes

Every new shape is a closed JSON Schema 2020-12 file with an example (D36).

| Shape | File | Was | Section |
| --- | --- | --- | --- |
| Proposal record version 2 | `proposal.v2.json` | 1 (D62) | 2.1 |
| Plugin manifest version 4 | `plugin-manifest.v4.json` | 3 (D72) | 2.2 |
| Curator records version 1 | `curator-record.v1.json` (`candidate`, `run`, `consent`, `state`) | new | 2.3 |
| Curator run report version 1 | `curator-report.v1.json` | new | 7.2 |

`workspace-show`'s `versions` changes `manifest` to `[1, 2, 3, 4]` and `proposal` to `[1, 2]`, and gains
`curator: 1`. The plugin protocol stays **1** (D40 as annotated by D54). The workspace configuration stays
version 4.

### 2.1 Proposal record, version 2 (D92)

Version 1 with these changes; every version 1 field keeps its meaning. A version 1 record stays version 1
when it is decided, withdrawn or applied; new proposals are version 2.

| Field | Rule |
| --- | --- |
| `version` | `2` |
| `provenance` | Envelope **version 2**, `authority: null` |
| `drafter` | **New.** `null`, or `{ "plugin", "instance", "pipeline", "run", "mode", "candidate"?, "promotedBy"? }`. **Attested by the host** (10.1): `plugin`, `instance`, `pipeline`, and `run` (the pipeline call's trace id). **Verified by the knowledge plugin** against the memory store (3.2, owner decision 10): `mode` (`scheduled` or `promoted`), `candidate`, `promotedBy`. A mismatch is `PROPOSAL_DRAFT_MISMATCH` |
| `conflictSet` | **New.** `null`, or a conflict set id `k-<20 hex>` (4.4); verified for consistency with the sources and the document id (3.2) |
| `evidence` | Version 1's kinds plus **`memory`**: `{ "kind": "memory", "ref": "<mem id>@<recordVersion>", "principal", "contentHash", "class", "authority", "origin", "constraints", "access", "sensitivity", "confirmation", "observations": { "sessions", "principals" }, "excerpt"?, "erased"? }`. It copies each source's authority, origin, constraints and access (D81). **Refused** (`PROPOSAL_EVIDENCE_INVALID`) without an accepted drafter attestation, and **verified field by field** against the record (3.2) |
| `provenance.derivedFrom` | For a drafted proposal, `{ "kind": "memory", "id", "contentHash" }` per source (D81), at most 32; refused without an accepted attestation; each must equal an evidence entry's id and hash; `null` otherwise |
| `policy.rule` | `"person"` or `"auto:<rule id>"` (8.3) |
| `decision.channel` | **New.** `"terminal"` or `"policy"`; a relay over MCP, in phase 5, would add `"mcp-elicitation"` (owner decision 2) |
| `decision.by` | For `"policy"`, `{ "kind": "service", "id": "policy:<area>" }` |
| `withdrawal` | **New.** `null`, or `{ "by": "drafter" \| "proposer", "reason", "at" }`, reasons `source-erased`, `source-changed`, `superseded-alternative`, `retracted` |
| `redacted` | **New.** `null`, or `{ "at", "reason": "source-erased" }` (9.1) |

### 2.2 Plugin manifest, version 4 (D97, D105)

Version 3 with one command key and two pipeline keys.

**`confirm_preview`** names a command of the same plugin:

```toml
[[commands]]
name = "knowledge-approve"
confirm = "require-human"
confirm_prompt = "Apply this proposal to the knowledge base?"
confirm_preview = "knowledge-proposal-preview"
```

The named command must:
- have the effect `inspect`;
- have CLI exposure;
- declare a `journal`;
- return `{ "preview": <string> }`.

Its input schema's properties must each exist in the gated command's input schema. **The CLI passes only those
properties** of the gated call's input; this is why reject's `reason` never reaches the preview. Any other
shape is `PLUGIN_MANIFEST_INVALID` at load. The key needs `confirm_prompt`, and is refused on mounted tools,
component commands and pipelines.

**`expose`** on a pipeline uses the same keys as on a command (`mcp`, `agent`, `cli`), with the same defaults.
At seal, a pipeline exposed to an interface that any of its steps is not exposed to is
`PLUGIN_MANIFEST_INVALID`, naming the step. Version 1 to 3 pipelines keep phase 1's exposure to every
surface, so `knowledge-refresh` is unchanged. **`result`** on a pipeline is `"steps"` (the default, today's
shape) or `"last"`: the pipeline returns only its last step's data, and only that data enters the journal
entry.

A host reads manifest versions 1 to 4.

### 2.3 Curator records, version 1

These are kept in the curator instance's namespace through `records_write` (D90). **No curator record holds
memory text, and no envelope of one holds a memory hash.** Every record carries the caller's principal and an
access set. **Records are per (space, principal):** a run reads and writes only the records of its effective
principal, so no caller sees counts, cursors or candidates made under another caller's filter.

| Kind | Id | Access | Fields |
| --- | --- | --- | --- |
| `candidate` | `c-` and 20 hex of SHA-256 of `<space>\0<principal>\0<lowest source memory id>` (memory ids are random, so the id says nothing about content) | The intersection of its sources' sets with `principal:<caller>` added; never wider than the caller's own token plus what every source allows | `principal`, `class`, `contentHash`, `subjectKey`, `sources: [{ id, recordVersion }]` (at most 32), `snapshot: { sessions, principals, authority, settledAt }`, `access`, `sensitivity`, `status` (`settling`, `ready`, `drafted`, `needs-promotion`, `skipped`, `rejected`, `applied`, `erased`), `reason`, `drafts` (a count), `firstSeenAt`, `promotedTo`, `conflictSet`, `quietUntil` |
| `run` | `r-` and 20 hex of the run's trace id | `principal:<caller>` | `space`, `principal`, `startedAt`, `finishedAt`, the report (7.2) |
| `consent` | `n-` and the candidate id's hex | `principal:<caller>` | `by`, `at`, `sources: [{ id, recordVersion, contentHash }]` (5.2) |
| `state` | `s-` and 20 hex of SHA-256 of `<space>\0<principal>` | `principal:<caller>` | `feedAfter`, `memoryAfter`, `scanAfter` (7.3), `lastRun`, `lock: { trace, until }` |

`contentHash`, `subjectKey` and `reason` are removed when a source is erased (9.1). A candidate with more than 32
readable sources is `skipped` with reason `too-many-sources`.

## 3. The curator and how it reaches proposals (D90, D91)

### 3.1 Why a pipeline

A proposal is the knowledge plugin's record (D17), and records are namespaced per instance, so the curator cannot
write one; it may not call the knowledge plugin either (D3).

| Option | Verdict |
| --- | --- |
| **A pipeline the curator ships as data**, whose steps are curator and knowledge commands (as `knowledge-refresh` runs `sources-sync`) | **Chosen.** No new grant, no plugin dependency, and the proposal stays knowledge's. A missing knowledge instance leaves the pipeline unregistered and named by `plugin-show` and the doctor, as phase 1's seal already does |
| The curator inside the knowledge plugin | Rejected: knowledge would read memory for every command, and the architecture makes the curator its own plugin |
| A host `proposals` grant into another instance's namespace | Rejected: the host would own a domain record (principle 1) |

`curator-run`: a pipeline with `expose = { mcp = false, agent = false, cli = true }`, `result = "last"`,
`journal = { mode = "digest" }` and effects `store-write` and `workspace-write`.

| Step (`as`) | Command | Plugin | Input |
| --- | --- | --- | --- |
| `plan` | `curator-plan` | curator | `{ "space": "$input.space" }` |
| `submit` | `knowledge-propose-batch` | knowledge | `{ "space": "$input.space", "proposals": "$steps.plan.submit", "withdraw": "$steps.plan.withdraw" }` |
| `feed` | `knowledge-proposal-feed` | knowledge | `{ "space": "$input.space", "after": "$steps.plan.feedAfter" }` (the drafter comes from the attestation) |
| `finish` | `curator-finish` | curator | `{ "space": "$input.space", "run": "$steps.plan.run", "results": "$steps.submit.results", "feed": "$steps.feed" }` |

Because AFD omits an unresolved reference, every step's schema marks the inputs it needs as `required`. A
missing one is a `VALIDATION_ERROR` for that step, not an empty list. All steps are digest-journaled, since
`plan`'s output holds memory-derived text (phase 3, 2.3). The pipeline prints only `finish`'s report: ids and
counts, never text, so cron mail and CI logs hold none. Feedback read by `feed` is applied by `finish`, and the
next run's `plan` sees it.

### 3.2 The drafter: attested, then verified (owner decision 10)

`knowledge-propose-batch` and `knowledge-proposal-feed` read `CallContext.pipeline`, which the SDK fills from
the host's attestation table (10.1). A call without an attestation has `drafter: null`. It may not carry memory
evidence, memory `derivedFrom`, a `conflictSet` or withdrawals, and is otherwise an ordinary batch of proposals
by its caller. **The knowledge instance accepts an attestation only from instances it lists**:

```toml
[plugins.knowledge.config]
drafters = ["curator"]          # default []: an attested submission is PROPOSAL_DRAFTER_NOT_ALLOWED
```

**Listing an instance is not trusting it.** The host attests who drafted (`plugin`, `instance`, `pipeline`,
`run`). The knowledge plugin then **verifies every other claim itself**, through its read-only `memory` grant
(owner decision 7), under the batch caller's reader filter, before it stores the proposal. Each check refuses
the one item with `PROPOSAL_DRAFT_MISMATCH`, whose `details.check` names the check and never the content:

| Check | What the knowledge plugin compares | `details.check` |
| --- | --- | --- |
| Source exists | `memory_get` at `now` finds each evidence entry's record: readable to the caller, live (valid, not invalidated or superseded, `expiresAt > now`), not flagged, class `semantic` or `procedural` | `source-missing`, `source-not-live`, `source-flagged`, `source-class` |
| Version | The record's current version equals the entry's `recordVersion`, and its `contentHash` equals the entry's and the `derivedFrom` entry's | `source-version`, `source-hash` |
| Copied fields | `principal`, `class`, `authority`, `origin`, `constraints`, `access`, `sensitivity` and `confirmation` equal the record's, exactly; the proposal's `confidence` is the highest of the sources' | `copied-<field>`, `confidence` |
| Counts | Each entry's `observations.sessions` is at most the record's; `principals` equals the number of distinct source principals; the rationale's counts are at most those | `counts` |
| One group | Every source has the same `contentHash` and `class`; at most 32 sources | `group` |
| Excerpt | Each `excerpt` is the record's text cut at 1000 characters | `excerpt` |
| Content | `change.content` is byte-equal to `umbel_okf::draft::render` over the verified sources, the instance and `generated.at` | `content` |
| Candidate | `candidate` equals `umbel_okf::draft::candidate_id(space, caller principal, lowest source id)` | `candidate` |
| Document id | `change.doc` is the curator's configured target, ending in the candidate id, or in the conflict set id when `conflictSet` is set | `document` |
| Conflict set | `conflictSet`, when set, has the `k-` form; every open proposal sharing it targets the same document, and their sources share `umbel_okf::draft::subject_key` of the subject and differ in content hash | `conflict-set` |
| Widening and mode | Knowledge computes whether the target's access is wider than the sources' (5.1). If it is not, `mode` must be `scheduled` and `promotedBy` absent. If it is, `mode` must be `promoted`, and the caller's effective principal must be the principal of **every** source; `promotedBy` must equal it. Higher sensitivity is always refused | `mode`, `promoted-by`, `sensitivity` |
| `generated.at` | At or after every source's current `recordedAt`, and at or before `now` | `generated-at` |

Each source is read once per batch: at most 32 per proposal and **400 per batch**, else
`PROPOSAL_BATCH_TOO_LARGE`. Approve repeats the source, version, copied-field and widening checks (8.2), so a
change between submission and approval is caught.

**What still cannot be verified, and why:**
- **That a promotion's owner consented at a terminal.** The consent lives in the curator's own records, which
  are namespaced per instance (`store_services.rs:330-370`), so knowledge cannot read it. Knowledge verifies what
  bounds it: a widening draft is accepted only when the batch's caller owns every source, so no one's private
  memory is widened by a run another principal started. Under owner decision 6, the owner approving their own
  widened record is self-approval.
- **The settling policy:** whether a record had stood for the pack's days, which authorities the pack admits, and
  the session floor. These are the curator's pack and clock, not facts about the record. Knowledge verifies the
  facts it shows the approver, and the preview labels the policy figures "drafter's policy".
- **`generated.at`'s exact value**, the candidate's settling instant in curator state. Knowledge checks only its
  bounds.
- **Sessions as labels** (D68). Knowledge verifies the counts against the store; it cannot verify that the
  sessions were distinct people or times.

### 3.3 Not in the request path, never approving

- Every curator command and `curator-run` are CLI only and never first-class. Over MCP, `tools/list`,
  `afd-discover` and `afd-call` neither list nor run them (`not_request_path.rs`, through the binary's stdio
  server).
- The curator holds no write grant to knowledge or memory (D90; owner decision 8).
- Approve, reject and verify stay `require-human` and CLI only. In a pipeline step they are refused at the
  plugin gate, because the CLI's mark names the pipeline (`middleware.rs:278`); a test holds this.
- `knowledge-auto-approve` refuses any call with a pipeline attestation (8.3).
- An agent at a shell can still run `umbel curator-run`, as it can any CLI command before phase 5. The result
  is proposals, which a person still decides.

## 4. Settling and candidates (D93)

### 4.1 Inputs

Records are read with `memory_list` under the caller's reader filter (owner decision 4) and filtered on `MemoryMeta`
first: class, authority, flags, validity, `recorded_at`, `expires_at`, access and sensitivity. Only survivors
are read with `memory_get` for `contentHash`, `observations`, `constraints`, `confirmation`, `confidence` and
the text. A run makes at most `max_records` (5000) list reads and `max_gets` (500) gets, a bounded cost stated
rather than a new store projection. The changes feed (`memory_changes` after `memoryAfter`) gives `Erased`,
`Purged`, `Invalidated` and `Confirmed`. Expiry has no change kind, so it is checked against the clock (9.1).

### 4.2 Rules and defaults

A record is **settled** at the run's instant `now` (the command context's clock) when all of these hold:

| Rule | Default (pack `settle`) |
| --- | --- |
| Class | `semantic` or `procedural`; `episodic` never (D15) |
| Live | Valid at `now`, not invalidated or superseded, `expiresAt > now` |
| Stable since | `now - recordedAt(current version) >= semantic_days` (7) or `procedural_days` (14) |
| Sessions | The group's sessions (4.3) at least `min_sessions` (2) |
| Authority | In `authorities`, default `["person"]` (which includes records a person confirmed, D84). A pack may widen it per space to `agent`, `tool` or `import` (owner decision 9) |
| Flags | None (D75) |
| Confidence | Carried as asserted; `min_confidence` (unset) may make it a gate |

`transcript` in `authorities` is `CURATOR_PACK_INVALID`.

### 4.3 Groups and counts

A candidate groups one caller's readable settled records with equal `contentHash` and `class`. `sessions` is
the sum of the records' `observations.sessions`; `principals` is the number of distinct `scope.principal`
values. **Neither counts writes or observations** (D81). The store makes one record per owner, project,
class, content hash, authority and access set (phase 3, 8.2), so the sum over-counts across those variants.
Sessions are the caller's unverified labels (D68), so `min_sessions` stops an accident, not an adversary. The
gate against poisoning is authority (4.2). The candidate's authority is the highest of its records (`person`,
`agent`, `tool`, `import`); its constraints are the sorted union. The `snapshot` is fixed when the candidate
first becomes `ready`.

### 4.4 Conflict sets

`subjectKey` is the subject lowercased, with runs of whitespace and ASCII punctuation each made one space, and
trimmed. One caller's candidates with equal `subjectKey` and different `contentHash` form a conflict set.

- **Id:** `k-` and 20 hex of SHA-256 of `<space>\0<principal>\0<the lowest member candidate id>`. It is fixed
  when the set first forms and kept on every member.
- **Size:** at most `max_alternatives` (4) by id order. The rest are `skipped` with reason
  `conflict-too-large`.
- **Drafting:** members not yet drafted are drafted as alternatives on the conflict set's path (4.5). Applying
  one makes the others `PROPOSAL_CONFLICT`, and the next run withdraws them with `superseded-alternative`.
- **After a draft:** a candidate already drafted alone that later joins a set is reported as
  `conflict-after-draft`.
- **The curator never chooses** (D15).

### 4.5 Drafting

Per space, the curator configuration names where promotions go:

```toml
[plugins.curator.config.spaces.main]
collection = "notes"            # a markdown collection with an area
prefix = "learned/"
```

- **Document id:** `<collection>/<prefix><candidate id>`, or `<prefix><conflict set id>` for alternatives.
  Opaque and content-free.
- **Existing document:** the candidate is `skipped` with reason `target-exists`.
- **Content:** fixed, as below.

```markdown
---
title: "<subject, JSON-escaped>"
type: "<fact for semantic, procedure for procedural>"
tags: [<the records' tags, sorted, JSON strings>]
generated:
  by: "umbel:curator/<instance>"
  at: "<snapshot.settledAt>"
---
<text of the source with the earliest recordedAt>

## Holds only

- "<each constraint, JSON-escaped>"
```

The `Holds only` section appears when there are constraints: S16's constraints survive into a document a person
reads. The other proposal fields:
- **`rationale`:** fixed text from the `snapshot` (class, authority, sessions, principals, settledAt), so it
  never changes between runs.
- **`evidence`:** one `memory` entry per source, with an `excerpt` of the first 1000 characters.
- **`idempotency_key`:** `curator/<candidate id>/<drafts>`.
- **`confidence`:** the highest asserted, or `null`.

The rendering and the id derivations live in `umbel_okf::draft`, so the knowledge plugin re-renders to verify (3.2). A rerun renders byte-equal input and gets the existing proposal back.

### 4.6 Determinism

`curator-plan`'s output is a pure function of the caller's readable records and documents, the pack, the
caller's curator records and `now`. Candidates come in id order, then re-verifications in document id order, at
most `max_proposals` (20) per run (`deterministic.rs`).

## 5. Access, sensitivity and promotion (D94, owner decision 5)

### 5.1 The rule

A drafted proposal is readable by anyone who can read its target. Drafting a private record for a shared
collection would therefore show it to the collection's readers before any approval. A candidate
is drafted on a schedule only when:
- every token of the target's resolved access set is in every source's access set; and
- no source's sensitivity is above the target's (`public` < `internal` < `confidential` < `restricted`).

Otherwise it is `needs-promotion` (access) or `skipped` with reason `sensitivity-higher`. Memory is private by
default (D68), so **by default a scheduled run drafts only memory a person already shared**. Approve checks the
rule again (8.2).

### 5.2 `curator-promote`

`curator-promote { space, candidate, contentHash }` is CLI only and `confirm = "require-human"` (refusing
`--yes` and `--approve`), digest-journaled.
- **Own records only:** the caller's effective principal must be the `scope.principal` of every source, as D88
  limits `memory-confirm`. Otherwise `CURATOR_PROMOTE_NOT_ALLOWED`.
- **Proof of looking:** the `contentHash` must match, since prompts cannot show text through
  `curator-candidates`.
- **What it records:** a `consent` record listing each source and version. The next run drafts with
  `mode = "promoted"` and `promotedBy`, which the knowledge plugin checks against the sources' principals (3.2).
- **Limits:** sensitivity is never overridden. The prompt says the text becomes readable by the target
  collection's readers once proposed.

## 6. Re-verification and inconsistencies (D95)

### 6.1 Scheduled re-verification

Phase 2 records a person's verification as an applied `verify` proposal whose `verified` entry is the deciding
actor (`apply.rs`, `rewritten`). So the curator raises `verify` proposals, and **a person approving one is the
verification**; the curator never attests. A readable document is due when:
- it has `stale_after`, and `now >= stale_after - lead_days` (14);
- it is not deprecated;
- it has no open proposal.

It is drafted only when its checks pass, each a `{ kind: "text", ref: "check:<name>", excerpt: "pass" }`
evidence entry:
- `links-resolve`: no `broken-links` flag;
- `sources-unchanged`: every `sources` entry naming a document with a hash still has that hash;
- `not-flagged`.

`verification.staleAfter` is `now + every_days` (180). At most `max_per_run` (20) per run. Documents without
`stale_after` are never due.

### 6.2 Inconsistencies

| Inconsistency | Handling |
| --- | --- |
| A document names a resolving `superseded_by` and is not `deprecated` | A `deprecate` proposal with `supersededBy` |
| A conflict set | Alternatives (4.4) |
| A candidate whose target exists | Reported: `target-exists` |
| A due document failing a check | Reported: `check-failed` and the check |
| A deprecated document whose successor does not resolve | Reported: `successor-missing` |

Edits that need judgment are out of scope (section 14).

## 7. Feedback, runs and scheduling (D96)

### 7.1 Rejection feedback

`knowledge-proposal-feed` returns decisions on proposals whose `drafter.instance` is the attested instance and
whose `proposer.principal` is the caller's, after the record store's change revision `after`, readable proposals
only. `curator-finish` handles each decision:
- **Rejected:** the candidate is marked `rejected`, the reason is kept (dropped on erase, 9.1), and
  `quietUntil = now + quiet_days` (90). **The same content is not drafted again until then.** A changed record
  is a new candidate.
- **Applied:** the candidate is marked `applied` with `promotedTo` and is never drafted again.

### 7.2 The run report

`curator-report.v1.json` holds:
- `{ space, principal, run, at }`;
- `counts: { read, settled, candidates, drafted, needsPromotion, skipped, rejected, applied, withdrawn, reverify, remaining }`;
- `skipped: [{ candidate, reason }]`;
- `inconsistencies: [{ kind, doc?, candidate? }]`;
- `proposals: [ids]`;
- `next: { overdueAfter }`.

Everything is counted over the caller's reads and the caller's records, as ids, never text.
`curator-status { space }` returns the caller's last report, `overdue`, the promotable candidates, and the
records an owner may invalidate (9.2).

### 7.3 Scheduling, the lock and recovery

There is no daemon (D76's precedent): a deployer runs `umbel curator-run --space <s>` from cron, CI or a
session-end hook. **Plugins have no doctor API** (`doctor.rs:178-187`), so overdue (older than twice
`every_hours`, 24) is reported by `curator-status` only, not by the doctor.

**The lock.** `curator-plan` takes the caller's `state.lock` by compare-and-set, with
`until = now + 10 minutes`. A second run gets `CURATOR_BUSY` (retryable), and an expired lock is taken over.
`curator-finish` releases the lock **only if `lock.trace` is its own run**; otherwise it records its report and
leaves the lock.

**Starvation.** `scanAfter` is a rotating cursor over `memory_list` pages, so every record is reached across
runs, and `remaining` says how far behind a run is.

**Recovery from a partial run.** A run that submitted and then failed before `finish` leaves its candidates
`ready`. The next plan renders the same input (4.5), and the batch returns the existing proposals
(`created: false`), which `finish` then records. If a source changed meanwhile, the candidate's content changes:
- `drafts` increments, giving a new key and so no `PROPOSAL_KEY_REUSED`;
- the stale proposal is withdrawn by the re-check (9.1).

## 8. Approval

### 8.1 The confirmation preview (D97)

Phase 2 recorded a follow-up: approval "must do before real use", because the static prompt cannot show what is
approved. Phase 4 closes it.

When a command declares `confirm_preview`, the CLI acts before the confirmation prompt (`src/cli/mod.rs`, before
`prompt::confirm`):
1. It calls the preview command under a **fresh trace id**, with only the properties it declares, in the same
   principal's context without the marks.
2. It prints `preview` to stderr, each line prefixed `> `, with control characters, U+2028, U+2029 and
   bidirectional controls removed, at most 6000 characters, then `(N lines not shown)` when cut.
3. Then it shows the static prompt.

A failed preview refuses the call (`CONFIRMATION_PREVIEW_FAILED`; nothing runs).

`knowledge-proposal-preview { space, proposal }` renders:
- id, op, document, area and change hash;
- the drafter's attested fields, and the verified ones;
- `conflictSet` and flags;
- each evidence entry. Memory entries show authority, origin, constraints and access, labelled **"verified
  against memory at submission"**, and the settling figures labelled **"drafter's policy"** (3.2);
- for a widening draft, the line **"widens readers: sources private to `<principal>`"**;
- the diff's first 80 lines.

It applies approve's reader rules. `knowledge-approve` and `knowledge-reject` declare it. `knowledge-verify`
declares none: it takes a document, not a proposal, and the person attests the document as it stands. A
proposal's content changes after submission only by a redaction (9.1), which withdraws it, so what is previewed
is what is applied.

### 8.2 Approve's re-checks and who authored a draft (owner decision 6, D102)

**Re-checks at approve** for a drafted proposal (the check runs at draft time; the use is at approve):
- the target's current resolved access set and sensitivity are checked against each memory evidence entry's
  copied `access` and `sensitivity` by 5.1's rule, else `PROPOSAL_ACCESS_WIDENED`, applying nothing;
- knowledge holds `memory`, read only (owner decision 7), so each source must still be readable, live and at its
  cited version, else `PROPOSAL_SOURCE_GONE`; and its copied fields must still equal the record's, else
  `PROPOSAL_DRAFT_MISMATCH` (3.2).

**Authorship.** The CLI is always `human:<local_id>` before phase 5 (`host/mod.rs:584-591`), so the person whose
cron runs `curator-run` is the `proposer.actor`. For a drafted proposal, self-approval compares
the approving actor with **every source's `principal`, read from the memory store** at approve, and with
`promotedBy`, which 3.2 verified to be one of them. Nothing in the comparison is the drafter's word. Any
match is `self-approval`, allowed only where the area allows it.

**The consequence, stated plainly:** in a one-person workspace every draft of that person's memory is
self-approval. The area must set `allow_self_approval`, and each approval records `exception: "self-approval"`.
A draft of someone else's shared memory, or a `verify` or `deprecate` draft, is approved by the runner with no
exception. Drafted documents are `agent-inferred`.

### 8.3 Auto-approval rules (owner decision 1, D98)

The mechanism, with **one** rule kind, off by default.

```toml
[plugins.knowledge.config.areas.handbook]
auto = ["deprecate-declared"]   # default []
```

`knowledge-auto-approve { space, limit? }`:
- **Shape:** CLI only, `store-write` and `workspace-write`, digest-journaled, no AFD approval.
- **Refuses** any call with a pipeline attestation (`PROPOSAL_AUTO_NOT_ALLOWED`).
- **Applies** each pending proposal that meets a rule its area lists, through the same apply steps, with
  `policy.rule = "auto:<rule>"`, a policy version covering `auto`, and `decision.channel = "policy"`.

**`deprecate-declared`** holds when all of these do:
- `op = "deprecate"`, drafted, no flags, no `conflictSet`;
- the target's frontmatter names `superseded_by` equal to `change.supersededBy`, which resolves to a readable
  document that is not deprecated;
- **the target's current bytes were written by an applied proposal.** Its envelope's `derivedFrom` names a
  proposal whose `result.contentHash` is the document's hash. So a `superseded_by` someone typed into a file
  and synced through `sources-filesystem` never triggers it.

**Never auto-approved, whatever an area lists:** `create`, `update` and `verify`; memory evidence; flags;
alternatives. A deprecated document drops out of search (D58).

### 8.4 The MCP approval relay (owner decision 2, D99)

AFD's relay asks the client to show a form. "A server cannot tell a person's answer from client code that
answers on its own" (`spec/command-metadata.md`), and the 2026-07-28 elicitation text fixes no interaction
model. Umbel's gate accepts `require-human` only at the CLI. Every MCP caller before phase 5 is an agent or
`agent:loopback`, and only humans approve (D62).

Approval stays CLI only in phase 4. The Rust relay prerequisite and Umbel's use of it move to
phase 5. When it lands it is:
- opt-in per area (`approve_over_mcp`, default false);
- carrying 8.1's preview as the elicitation `message`;
- recording `decision.channel = "mcp-elicitation"` and the verified person;
- limited to approve and reject.

### 8.5 The optional model (owner decision 3, D100)

**No model in phase 4.** Drafts are 4.5's fixed rendering, and
`[plugins.curator.config.model]` is reserved and refused (`CURATOR_MODEL_UNAVAILABLE`). The reasons:
- memory text would leave the process;
- injected memory could steer plausible drafts (S14, S15);
- drafts would stop being reproducible.

## 9. Changed and forgotten evidence (D103, D104)

### 9.1 What an open proposal does when its source changes (owner decision 7)

Phase 3 left this open (D73, D81, D85). **Every run re-checks every open drafted proposal of the caller**: it
reads each source with `memory_get` at `now`, which covers expiry and what the feed cannot show the caller. It
also reads the changes feed.

| Source state | Handling |
| --- | --- |
| `Erased` (forget) | Withdraw with `source-erased` **and redact** (below) |
| Absent or unreadable at re-check, `Purged`, `Invalidated` (which includes superseded), or `expiresAt <= now` | Withdraw with `source-changed`; no redaction (an absent record may be erased; the caller cannot tell, and the next run redacts it if the feed shows `Erased`) |
| `Confirmed` | Nothing; the next plan may raise authority |

**Redaction** is a withdrawal entry with `redact: true`, which knowledge accepts only from the attested drafter
for one of its own proposals. It replaces:
- `change.content`, `diff`, the title and every memory evidence `excerpt`, `contentHash` and `principal` (an
  entry becomes `{ kind, ref, erased: true }`);
- `changeHash`, which becomes `sha256:` of the canonical JSON `{ "redacted": "<proposal id>" }`;
- `derivedFrom`, which becomes `null`.

It sets `redacted`. The curator drops the candidate's `contentHash`, `subjectKey`, `reason` and sources and
marks it `erased`. This **amends D81's binding** that a memory-derived proposal cites its records in
`derivedFrom`, for erased sources only.

**Byte-level reach.** The document store's connections set `secure_delete=ON` (as the memory store and key file
do), and the redaction runs a `wal_checkpoint(TRUNCATE)` that reports `pending` when a reader holds the WAL,
retried by later writes, as phase 3's 5.4 does. Ids, paths and keys are content-free (2.3, 4.5). Every knowledge
command returning a drafted proposal is digest-journaled (11.2). Results keep no memory hash in
`dev.umbel/provenance` (11.2).

**An applied proposal is not retracted:** it is knowledge a person approved, and its `derivedFrom` hash is D85's
disclosed residue.

**Limits, stated:**
- none for approval: approve refuses a proposal whose source is gone (8.2), though the proposal stays readable until the next run redacts it;
- `store-backup` copies;
- text an approver copied elsewhere.

### 9.2 Memory is never written (owner decision 8)

The curator holds no `memory_write`. The reserved fields `promotedTo`, `candidate` and
`settledAt` stay reserved, and candidate state lives in curator records. After an applied promotion,
`curator-status` lists the source records whose owner may close them with `memory-invalidate`, reason
`outdated`. Phase 3's refusal of `memory_write` beside a document write grant stays.

## 10. Host services

### 10.1 Pipelines: attestation, exposure, result (D91, D105)

**Attestation.** `PipelineHandler::execute` (`src/plugins/pipelines.rs`) gives each step a **fresh random trace
id** (the host's `new_trace_id`, replacing AFD's predictable `<pipeline id>-step-<i>`). It records the step in a
host table, `PipelineAttestations`, keyed by that trace id:
`{ plugin, instance, pipeline, run: <the pipeline call's trace id>, command }`. The entry is removed when the
step returns, as the ledger's entries are.

`Services::call` fills `CallContext.pipeline` only when the call's trace id has an entry whose `command` is the
called command. **Nothing is read from `extra`.** So no surface can forge it:
- MCP, `umbel batch`, `afd-call` and `afd-pipe` can set neither the table nor a 128-bit trace id they do not
  know;
- **a library embedder is trusted**, as it already is for actors (D14).

Pipelines do not nest.

**Exposure and result.** Section 2.2's pipeline `expose` is checked at seal, and `result = "last"` is applied in
the handler's return.

**Tests:** `tests/pipeline_attestation.rs` (set for steps, absent for direct calls, absent after the step, a
guessed trace refused, the wrong command refused) and `tests/pipeline_expose.rs`.

### 10.2 The confirmation preview (D97)

Manifest version 4's `confirm_preview` and 8.1's CLI flow; nothing changes on MCP. Tests: `tests/manifest_v4.rs`,
`tests/cli_confirm_preview.rs`.

### 10.3 Grants

No new grant. The curator declares `config`, `packs`, `clock`, `memory`, `documents`, `graph`, `records` and
`records_write` (allow `<space>`). Memory reads stay under the caller's filter (owner decision 4). Knowledge also declares `memory`, read only
(owner decision 7). Phase 3 then requires a `journal` on every
knowledge command and pipeline (11.2).

## 11. The plugins

### 11.1 `curator` (D90)

Manifest version 4. Every command is CLI only and digest-journaled with `keep = ["space"]`.

| Command | Effects | Contract |
| --- | --- | --- |
| `curator-run` | `store-write`, `workspace-write` (a pipeline) | Section 3.1 |
| `curator-plan` | `store-write` | Takes the lock; re-checks open drafts; reads memory, the feed, documents and the caller's records; returns drafts and withdrawals |
| `curator-finish` | `store-write` | Records results, feedback and the report; releases its own lock |
| `curator-status` | `inspect` | 7.2 |
| `curator-candidates` | `inspect` | The caller's candidates by status, with counts, authority and access, and the content hash for candidates whose sources are all the caller's; no text |
| `curator-promote` | `store-write` | Section 5.2; `confirm = "require-human"` |

The `settle` pack is overridable per space (D46) and holds the defaults of sections 4, 6 and 7, including
`max_records`, `max_gets` and `max_proposals`. The skill `curator-guide` explains what a run does, how promotion
works, and that drafts are data.

### 11.2 `knowledge`

The knowledge plugin moves to manifest version 4. **Every command whose result or input can hold a drafted
proposal's content, title, change hash or memory evidence is digest-journaled**, with `keep = ["space",
"proposal"]` where it has a proposal input. Its results never carry `derivedFrom` with memory hashes in
`dev.umbel/provenance`.

| Command | Effects | Exposed | Journal | Contract |
| --- | --- | --- | --- | --- |
| `knowledge-propose-batch` | `store-write` | every surface | digest | `{ space, proposals: [...] (at most 50), withdraw?: [{ proposal, reason, redact? }] (at most 50) }`; each item is `knowledge-propose`'s validation, plus 3.2's attestation rules and verification, plus `PROPOSAL_ALREADY_OPEN` when a drafted item's document, or one of its memory sources, already has an open proposal; results per item |
| `knowledge-proposal-feed` | `inspect` | CLI | digest | Section 7.1; refuses a call without an accepted attestation |
| `knowledge-proposal-preview` | `inspect` | CLI | digest | Section 8.1 |
| `knowledge-auto-approve` | `store-write`, `workspace-write` | CLI | digest | Section 8.3 |
| `knowledge-proposal-list`, `-proposal-show` | unchanged | unchanged | **digest** (was plain) | |
| `knowledge-approve`, `-reject` | unchanged | unchanged | **digest** (was plain) | `confirm_preview`; 8.2's re-checks and authorship rule |
| `knowledge-withdraw` | unchanged | unchanged | **digest** | Proposer only, as phase 2; drafter withdrawals go only through the batch |
| `knowledge-propose`, `-verify` | unchanged | unchanged | plain, as today | They never take a drafter attestation |

The configuration adds `drafters` (3.2) and an `auto` list per area (8.3).

### 11.3 Error and warning codes

| Code | When | Retryable |
| --- | --- | --- |
| `CURATOR_BUSY` | Another run holds the caller's lock in the space | Yes |
| `CURATOR_PACK_INVALID` | The `settle` pack does not read, or names `transcript` | No |
| `CURATOR_TARGET_UNCONFIGURED` | No `spaces.<id>` target for the run's space | No |
| `CURATOR_CANDIDATE_NOT_FOUND` | Absent or not the caller's, alike | No |
| `CURATOR_PROMOTE_NOT_ALLOWED` | A source is not the caller's own, or its hash changed | No |
| `CURATOR_MODEL_UNAVAILABLE` | `config.model` is set (8.5) | No |
| `PROPOSAL_DRAFTER_NOT_ALLOWED` | An attested submission from an instance not in `drafters` | No |
| `PROPOSAL_EVIDENCE_INVALID` (extended) | Memory evidence, memory `derivedFrom`, a `conflictSet` or a withdrawal without an accepted attestation | No |
| `PROPOSAL_DRAFT_MISMATCH` | A drafter's claim does not match the memory store or the fixed rendering (3.2); `details.check` names the check | No |
| `PROPOSAL_ALREADY_OPEN` | A drafted proposal for a document or source that has an open proposal | No |
| `PROPOSAL_BATCH_TOO_LARGE` | More than 50 proposals, 50 withdrawals or 400 cited sources | No |
| `PROPOSAL_ACCESS_WIDENED` | Approve's re-check of 5.1 fails | No |
| `PROPOSAL_SOURCE_GONE` | Approve finds a source gone (8.2) | No |
| `PROPOSAL_AUTO_NOT_ALLOWED` | `knowledge-auto-approve` with a pipeline attestation | No |
| `CONFIRMATION_PREVIEW_FAILED` | The preview failed; nothing ran | No |
| `CURATOR_CANDIDATES_SKIPPED` (warning) | A run skipped candidates; details hold counts by reason | |

## 12. Security

| Threat | Control | Test |
| --- | --- | --- |
| **Poisoned memory promoted** (S14) | By default only `person` authority settles (owner decision 9), flagged never; a person approves every content change after a preview with each source's authority and origin; no auto rule touches content. Session counts are labels and are **not** a control | `curator/tests/poisoning.rs` |
| **Private memory disclosed through a proposal** | 5.1's rule (owner decision 5); per-principal curator records; promotion by the owner at a terminal | `curator/tests/access_rule.rs`, `first-party/tests/curator_leaks.rs` |
| **Access or sensitivity changed between draft and approve** | Approve's re-check (8.2) | `knowledge/tests/drafted.rs` |
| **A source forgotten before approve** | Withdrawal and redaction on the next run; source re-check at approve (8.2) | `curator/tests/forgotten.rs`, `knowledge/tests/drafted.rs` |
| **Forged drafter or forged memory evidence** | Host attestation by random step trace (10.1); `drafters`; memory evidence refused without an attestation; every claim of a listed drafter verified against the memory store and the fixed rendering (3.2) | `pipeline_attestation.rs`, `knowledge/tests/verify_drafts.rs`, `knowledge/tests/drafted.rs` |
| **A faulty or compromised drafter misstating a source** (wrong authority, dropped constraint, another person's record widened) | 3.2's field-by-field checks; widening only of the caller's own records; re-checked at approve | `knowledge/tests/verify_drafts.rs` |
| **Rubber-stamped machine drafts** | The preview (8.1), with verified facts and the drafter's policy labelled apart | `cli_confirm_preview.rs`, `knowledge/tests/preview.rs` |
| **The curator approving its own work** | No approve path from a pipeline; auto refuses an attestation | `curator/tests/not_request_path.rs` |
| **Self-approval laundered through the curator** | 8.2's comparison with every source's principal (owner decision 6) | `knowledge/tests/drafted.rs` |
| **Request-path reachability** | Pipeline `expose`, checked at seal | `pipeline_expose.rs`, `not_request_path.rs` |
| **Constraints lost** (S16) | `Holds only`; constraints in every memory evidence entry | `curator/tests/draft.rs` |
| **Forget residue** | Content-free ids, paths and keys; digest journaling; redaction; `secure_delete` and the checkpoint; limits in 9.1 | `first-party/tests/exit_curator.rs` (point 6), `curator/tests/forgotten.rs` |
| **Model injection** | No model (owner decision 3) | `curator/tests/config.rs` |
| **Hidden counts** | Records, reports and status per principal | `curator_leaks.rs` |
| **Runaway runs** | Per-principal lock with owner-only release; caps; rotating scan | `curator/tests/run.rs` |
| **Auto-deprecation by editing a file** | `deprecate-declared` needs bytes an applied proposal wrote (owner decision 1) | `knowledge/tests/auto_approve.rs` |

Content trust is phase 2's (D67): drafts, excerpts and reasons are `trust: "content"` and never appear in
messages, reasoning or warnings.

## 13. Exit criterion and tests

The exit criterion is met when `umbel.yml` is green on `main` with every test below and
`first-party/tests/exit_curator.rs` passes in it. The test setup is:
- the real `umbel-first-party` binary, run as a child process;
- `testkit`'s frozen clock and stand-in person;
- a space `alpha` with a `notes` collection and an area over it;
- `drafters = ["curator"]`;
- the target `notes/learned/`;
- memory records written as `human:ada` through the store API into the binary's workspace (as phase 3's
  `support/stores.rs`), while the CLI is `human:local`.

It asserts:

1. **A scheduled draft.** `ada` holds a semantic fact with authority `person`, shared with the space, with one
   constraint and canaries in subject, text and tags, observed in two sessions. At day 3 `curator-candidates`
   shows it `settling`. At day 8 it is `ready`, and `curator-run` drafts one version 2 proposal at an opaque
   path, with these properties:
   - `drafter` `run` and `instance` match the attestation;
   - one `memory` evidence entry whose `authority`, `origin`, `constraints`, `access` and `principal` equal the
     record's;
   - `derivedFrom` naming it;
   - and a batch replayed with one copied field changed (`authority`) is refused with
     `PROPOSAL_DRAFT_MISMATCH`, `details.check = "copied-authority"`.

   The pipeline's stdout, the journal and the events hold no canary.
2. **Approved from the CLI.** `knowledge-approve` prints the preview (the diff, the drafter, the "verified
   against memory" label) and the stand-in person confirms. The approver `human:local` matches neither `promotedBy` nor the
   source's principal, so `exception: null` and `decision.channel = "terminal"`.
3. **Lands with full provenance.**
   - The file is the fixed rendering with `Holds only`.
   - The document's envelope is `agent-inferred`, with `generated.by = "umbel:curator/curator"`,
     `generated.at` equal to `settledAt`, and `derivedFrom` the proposal.
   - After `knowledge-refresh`, `knowledge-search` finds it.
   - The candidate is `applied` with `promotedTo`.
   - Events exist for submit and apply.
   - A second run drafts nothing.
4. **Promotion and self-approval.** A private fact of `human:local` is `needs-promotion`. After `curator-promote`,
   the next run drafts it with `promotedBy`. Approving it is `PROPOSAL_SELF_APPROVAL` until the area allows it,
   then `exception: "self-approval"`.
5. **Feedback.** A rejected draft is not drafted again inside the quiet period.
6. **Forgotten evidence.** A second drafted fact of `ada` is forgotten. The next run withdraws and redacts it.
   After the checkpoint, its canaries and source hash are absent from:
   - the raw bytes of `store.sqlite3` and its WAL;
   - the journal and the events;
   - the curator records;
   - the pipeline's stdout.

   The proposal id and path are unchanged and content-free.
7. **Not in the request path.** Over the binary's stdio MCP server, no curator command or pipeline is listed,
   discovered or callable, and `knowledge-approve` is not callable.

**CI.** The `memory` job of `umbel.yml` adds `-p umbel-plugin-curator` (from step 4); the `check` job excludes it.

| Test file | Crate | Covers |
| --- | --- | --- |
| `tests/schemas.rs` (extended) | host | The four new schemas and examples; version 1 proposals still validate |
| `tests/manifest_v4.rs` | host | 2.2's rules; versions 1 to 3 still load, with pipelines exposed everywhere |
| `tests/pipeline_attestation.rs` | host | 10.1 |
| `tests/pipeline_expose.rs` | host | Seal refusal, listing per surface, `result = "last"` in the result and the journal |
| `tests/cli_confirm_preview.rs` | host | 8.1: before the prompt, only declared properties passed, sanitised, capped with the count, fresh trace, failure refuses |
| `store-embedded/tests/secure_delete.rs` | embedded | `store.sqlite3` connections read back `secure_delete=1`; a replaced record's canary absent after a `TRUNCATE` checkpoint; `pending` with a reader held |
| `plugins/knowledge/tests/proposals_v2.rs` | knowledge | Version 2 fields; version 1 kept in its version |
| `plugins/knowledge/tests/drafted.rs` | knowledge | Attestation needed for `drafter`, memory evidence and withdrawals; `drafters`; `PROPOSAL_ALREADY_OPEN`; batch caps; 8.2's re-checks and authorship; `agent-inferred`; no memory hash in result provenance |
| `plugins/knowledge/tests/verify_drafts.rs` | knowledge | Every row of 3.2's table, one mismatch each, with its `details.check` and nothing stored; a valid draft accepted; widening by a caller who owns every source accepted, by any other caller refused; the 400-source cap; approve's repeat of the checks after a source changes |
| `okf/tests/draft.rs` | `umbel-okf` | The rendering, `subject_key` and the id derivations, byte for byte |
| `plugins/knowledge/tests/preview.rs` | knowledge | Rendering, labels, reader rules |
| `plugins/knowledge/tests/redaction.rs` | knowledge | 9.1's redacted record; idempotent; applied proposals untouched |
| `plugins/knowledge/tests/journal_modes.rs` | knowledge | 11.2's digest set: a canary in a drafted proposal never in the journal |
| `plugins/knowledge/tests/auto_approve.rs` | knowledge | 8.3, if built |
| `plugins/knowledge/tests/proposals.rs`, `verification.rs` (existing) | knowledge | Phase 2 behaviour unchanged |
| `plugins/curator/tests/settle.rs` | curator | 4.1 to 4.3 |
| `plugins/curator/tests/conflicts.rs` | curator | 4.4 |
| `plugins/curator/tests/draft.rs` | curator | 4.5: content-free ids and paths, stable rerun, constraints |
| `plugins/curator/tests/access_rule.rs` | curator | 5.1; per-principal records and their access |
| `plugins/curator/tests/promote.rs` | curator | 5.2 |
| `plugins/curator/tests/reverify.rs` | curator | Section 6 |
| `plugins/curator/tests/feedback.rs` | curator | 7.1 |
| `plugins/curator/tests/run.rs` | curator | The pipeline, lock and its owner, takeover, recovery, caps, rotating scan, report, `overdue` |
| `plugins/curator/tests/forgotten.rs` | curator | 9.1 for each source state, expiry by clock |
| `plugins/curator/tests/deterministic.rs` | curator | 4.6 with re-verifications |
| `plugins/curator/tests/poisoning.rs` | curator | Section 12's first row |
| `plugins/curator/tests/not_request_path.rs` | curator | 3.3 |
| `plugins/curator/tests/config.rs` | curator | Targets, pack, model refused |
| `plugins/curator/tests/no_plugin_dependency.rs` | curator | Section 1 |
| `first-party/tests/curator_leaks.rs` | first-party | `bo` sees none of `ada`'s candidates, drafts, counts, cursors or reports |
| `first-party/tests/exit_curator.rs` | first-party | The exit criterion |

## 14. Out of scope, and the seams reserved

| Out of scope | When | Seam |
| --- | --- | --- |
| The MCP approval relay | Phase 5 (owner decision 2) | `decision.channel`; 8.4's conditions |
| A model drafting or extracting | A new owner decision (decision 3 chose none) | `config.model` reserved |
| Derivation reads of memory, team-wide candidates | A new owner decision (decision 4 chose the caller's filter) | `ReaderFilter::Derivation`, still refused |
| Writing memory, the reserved record fields, knowledge invalidating memory | A new owner decision (decision 8 chose never) | The reserved fields; `memory-invalidate` reason `outdated` |
| A doctor API for plugins | When a plugin needs one | `curator-status`'s `overdue` |
| Procedural memory as skills in a pack (D15) | When a deployer asks | Documents of type `procedure` |
| Edits needing judgment | With a model or person tooling | Reported inconsistencies (6.2) |
| More auto-approval rule kinds | Owner decision | The `auto` list and `auto:<rule>` |
| A background scheduler, MCP Tasks for runs | Never in the request path; Tasks in phase 5 | One bounded command |
| Cross-space promotion | Never by default (principle 16) | One space per run |

## 15. Implementation plan

**No step 0**: AFD needs no change, since the relay moved to phase 5 (owner decision 2).

Each step is one pull request, green on the repository's checks and `umbel.yml`, and updates
[STATUS.md](../../STATUS.md) and this file. A step that finds a design decision stops and amends this document.
Steps that change host code carry the `Plugin-isolation-exempt:` line.

| Step | Pull request | Contents | Tests | Size |
| --- | --- | --- | --- | --- |
| 1 | Shapes | The four schemas with examples; manifest version 4 parsing (`confirm_preview`, pipeline `expose` and `result`); version constants | `schemas.rs`, `manifest_v4.rs` | S |
| 2 | Host | Pipeline attestation, exposure at seal, `result`; the SDK field; the CLI preview; `secure_delete` on `store.sqlite3` | `pipeline_attestation.rs`, `pipeline_expose.rs`, `cli_confirm_preview.rs`, `secure_delete.rs` | M |
| 3a | Knowledge: record and journal | Proposal version 2; manifest version 4; the digest set of 11.2; `knowledge-proposal-preview` and `confirm_preview` | `proposals_v2.rs`, `preview.rs`, `journal_modes.rs`, existing suites | M |
| 3b | Knowledge: the drafted path | `drafters`; `knowledge-propose-batch`, `-proposal-feed`; attestation rules; `PROPOSAL_ALREADY_OPEN`; withdrawal and redaction | `drafted.rs`, `redaction.rs` | M |
| 3c | Knowledge: verifying drafts | `umbel_okf::draft` (rendering, `subject_key`, id derivations); knowledge declares `memory` read only; 3.2's checks and `PROPOSAL_DRAFT_MISMATCH`; 8.2's re-checks and authorship from the store | `okf/tests/draft.rs`, `verify_drafts.rs` | L |
| 4 | Curator: candidates | The crate, pack, skill and config; drafting through `umbel_okf::draft`; candidates, conflicts, drafting, access rule; `curator-candidates`, `curator-promote`; per-principal records; the `memory` job gains the crate | `settle.rs`, `conflicts.rs`, `draft.rs`, `access_rule.rs`, `promote.rs`, `config.rs`, `no_plugin_dependency.rs` | L |
| 5 | Curator: runs | `curator-plan`, `-finish`, `-status`, `curator-run`; re-verification and inconsistencies; feedback; lock, recovery and scan; re-check and forgotten evidence | `reverify.rs`, `feedback.rs`, `run.rs`, `forgotten.rs`, `deterministic.rs`, `poisoning.rs`, `not_request_path.rs` | L |
| 6 | Auto-approval | `knowledge-auto-approve` and `deprecate-declared` (owner decision 1) | `auto_approve.rs` | S |
| 7 | Binary and exit | `umbel-first-party` gains curator; `curator_leaks.rs`, `exit_curator.rs`; STATUS.md marks phase 4 done | The two | M |

**Order:** 1, 2, 3a, 3b, 3c in order. Step 4 needs 1 and 3c (it renders with `umbel_okf::draft`). Step 5 needs 4. Step 6 needs 3b. Step 7 needs all.

**Build cost:** no new dependency family. Share `CARGO_TARGET_DIR`, use `-p <crate>`, `-j4`, and build only
under load 20.

### Amendments from step 1

Step 1 settled these details of sections 2, 2.1 to 2.3, 7.2 and 9.1 that the text left open. None changes who may
draft, verify, approve or read anything, or what the knowledge plugin trusts; three of them (5, 11 and 12) keep
less memory-derived residue than the text alone would.

1. **A preview's `returns`.** "Return `{ "preview": <string> }`" is checked at load on the named command's declared
   `returns`, inline or in a file, which must be exactly `{ type = "object", properties = { preview = { type =
   "string" } }, required = ["preview"], additionalProperties = false }`. The result itself is the CLI's to check
   (step 2, `CONFIRMATION_PREVIEW_FAILED`).
2. **A preview asks for nothing.** The named command declares no `confirm_prompt` (so neither `confirm` nor a
   `confirm_preview` of its own) and no `approval = "required"`, since the CLI calls it before the gated prompt
   without the marks (8.1). This also refuses a command previewing itself and chains of previews. A pipeline's
   name is refused, as a preview is a `[[commands]]` entry. Either journal mode satisfies "declare a `journal`".
3. **Where the version 4 keys are checked.** At parse: the named command's existence, effect, CLI exposure,
   journal, `returns` and input properties, for inline schemas; at load, with the plugin's files, the same for
   schemas given as files. The seal rule "a pipeline exposed no wider than its narrowest step" stays step 2's
   (10.1), and a version 4 plugin with a wider pipeline still seals in step 1.
4. **A pipeline's `expose` keys** are `mcp`, `agent` and `cli`; `palette` is refused, since no pipeline was ever
   offered in the palette (`pipelines.rs`). `spec/plugin-manifest.md`'s P3 lists `confirm_preview` and a
   pipeline's `expose` and `result` as Umbel's from manifest version 4.
5. **What a redaction leaves (9.1).** `change.content` is removed (a redacted create keeps no content), `diff`
   becomes the empty string, and the envelope's `contentHash`, which equals `changeHash` (`propose.rs`), takes the
   same redacted hash. Otherwise the envelope would keep the hash of memory-derived content. The title is the
   content's frontmatter, so it goes with the content.
6. **`derivedFrom`'s memory id** is the record's id, `mem-<24 hex>`, without its version, as phase 3's
   "by id in `derivedFrom`" says; the version is in the evidence entry's `ref`, `<mem id>@<recordVersion>`.
7. **Who withdrew.** `knowledge-withdraw` records `withdrawal = { by: "proposer", reason: "retracted" }`;
   `retracted` is a proposer's only reason. A withdrawn version 2 record always has a `withdrawal`, and no other
   state has one or a `redacted`.
8. **Decisions.** A `terminal` decision is a `human` actor's (D62). A `policy` decision's `by` is `{ kind:
   "service", id: "policy:<area>" }`, and its `principal` is the effective principal of the
   `knowledge-auto-approve` call that applied it. `policy.rule` `auto:<rule>` goes with `channel = "policy"` and
   `person` with `terminal`.
9. **Memory evidence's vocabularies.** `class` is `semantic` or `procedural`; `authority` is `person`, `agent`,
   `tool` or `import` (`transcript` never settles, owner decision 9, and `document` and `external` are not memory
   authorities); `origin` excludes `unspecified`, which the store refuses. An erased entry is exactly `{ kind,
   ref, erased: true }`, and only a redacted proposal holds one. Memory evidence, a memory `derivedFrom`, a
   `conflictSet` and a drafter's withdrawal each need a non-null `drafter`; `mode = "promoted"` needs `candidate`
   and `promotedBy`, and `scheduled` has no `promotedBy`.
10. **Curator records' common fields.** Every record carries `version` (1), `kind`, `id`, `space`, `principal` and
    `access`, and each kind admits only its own fields. A run's, a consent's and the state's `access` is exactly
    `principal:<caller>`.
11. **`subjectKey` is a digest.** A candidate keeps `sha256:` of 4.4's normalised key, not the key: a normalised
    subject is memory text, which 2.3 says no curator record holds. Comparing keys, all the curator does with
    them across runs, still works. The knowledge plugin's conflict-set check (3.2) computes
    `umbel_okf::draft::subject_key` over the sources themselves.
12. **Consent after a forget.** When a source is erased, the candidate's `consent` record is removed with its
    content hashes, as 9.1 drops the candidate's.
13. **A candidate's status rules.** `reason` is a code when `skipped` (`too-many-sources`, `conflict-too-large`,
    `target-exists`, `sensitivity-higher`), the approver's reason when `rejected` (with `quietUntil` set), and
    `null` otherwise; `applied` has `promotedTo`; `snapshot` is set from `ready` on.
14. **The state and the report.** `feedAfter` and `memoryAfter` are integer revisions (the record store's
    change revision, `memory_changes`' `Rev`); `scanAfter` is `null` or `memory_list`'s cursor `{ recordedAt, id
    }`; `lock.trace` is the run's trace id. The report carries `version: 1`; its `run` is the pipeline call's
    trace id, as `drafter.run`; a `check-failed` inconsistency names its `check` (6.2, "and the check");
    `proposals` holds at most 50 ids, the batch's cap.

### Amendments from step 2

Step 2 settled these details of sections 2.2, 8.1, 9.1 and 10.1 that the text left open. None changes who may
draft, verify, approve or read anything, or what the knowledge plugin trusts. Two of them (2 and 6) make the
attestation and the preview fail closed where the text was silent.

1. **Where the attestation is read.** The host table is `PipelineAttestations` (`src/plugins/attestation.rs`). It is
   read by a new `CallServices::pipeline()`, and the SDK's handler fills `CallContext.pipeline` from it. The handler
   gets its services from `Services::call_command`, which names the command. A `Services::call` handle names no
   command, so it never carries an attestation. The read also needs the command to be one of the instance's own.
   The SDK's `PipelineAttestation` carries `plugin`, `instance`, `pipeline` and `run`. The table's `command` is
   compared, not copied: it is `CallContext.command`. A component (WIT world 1.0.0 unchanged) and a mounted
   server never see an attestation.
2. **Step trace ids never come from the clock.** `new_trace_id` falls back to the clock's nanoseconds when the
   operating system's random source fails. A step's trace id comes from `random_trace_id` instead, which has no
   fallback. A step that cannot draw one fails with `INTERNAL_ERROR`, retryable, before it runs. The entry is held
   by a guard that drops when the step's future ends, so a step that fails, panics or is cancelled leaves no entry.
   A pipeline call with no trace id (a bare library `registry.execute`) gets a fresh one as its `run`.
3. **Every plugin pipeline's steps are attested**, in every manifest version, for every step command, whether
   another plugin's or the pipeline's own. Whom an attestation is accepted from is the receiving plugin's rule:
   the knowledge plugin's `drafters` (3.2).
4. **Exposure at seal** applies to manifest version 4 pipelines only, with or without `expose`. Without the key, a
   pipeline is on every surface but the palette, so all of its steps must be too. A step that is a host built-in is
   checked by its registered exposure. The refusal is `PLUGIN_MANIFEST_INVALID` at `pipelines[i].expose`, naming
   the interface and the step. As with a pipeline whose effects do not cover its steps, it fails the instance: a
   required instance stops the host, and an optional one is dropped and reported by `plugin-list`.
5. **`result = "last"`** makes the pipeline's `data` the last step's data itself, not wrapped in `steps`. It is
   `null` if the last step returned none. A failed step fails the pipeline, as before, with the step named. The
   pipeline's own journal entry holds only that data. Each step is still journaled under its own name in its own
   mode, as every registry call is (`install_journal`). So an earlier step's text stays out of the journal through
   its own digest mode, which phase 3's flow rule already requires of any step that handles memory text. The
   pipeline's `returns` description says which shape it has.
6. **When the preview runs.** It runs whenever the CLI's confirmation gate applies (a `confirm_prompt` and CLI
   exposure), whatever `mcp.confirmations` says and whatever the prompt does next. So a failing preview always
   refuses. It runs after the refusals that run nothing: `--yes` or `--approve`, and `@-`, on a `require-human`
   command. The refusal is `CONFIRMATION_PREVIEW_FAILED`, `retryable: false`. Its `details` name `command`,
   `preview` and `cause`: the preview's error code, or `PREVIEW_SHAPE` for an answer that is not exactly
   `{ "preview": <string> }`. The preview's own message is not copied.
7. **Where the preview is shown.** It is shown only at a terminal (stdin and stderr are terminals), as the prompts
   are, through a new `Console::show`, which writes to stderr by default. Without a terminal it still runs and is
   not printed, and the prompt then refuses or proceeds as before. The preview call is journaled as its own entry,
   in its own mode, under its own trace id.
8. **The preview's text.** "Control characters" are those the CLI's `sanitize` removes: every C0 control but newline
   and tab, DEL, every C1 control, and escape sequences. Also removed are U+2028, U+2029, U+061C, U+200E, U+200F,
   U+202A to U+202E and U+2066 to U+2069. The 6000-character cap counts the shown lines' characters without the
   `> ` prefixes. Whole lines are shown while they fit; a first line longer than the cap is cut at it. The count
   reads `(1 line not shown)` for one. The preview's input is the gated input's properties that the preview's
   registered input schema names; a property the gated call omitted is omitted.
9. **The document store's checkpoint.** Every `store.sqlite3` connection sets `secure_delete=ON`, and the embedded
   store's `StoreInfo` gains `secure_delete` (`store-show` reports no pragmas and is unchanged). A new `SqliteStore::truncate_wal()` runs `wal_checkpoint(TRUNCATE)` with no
   lock wait and answers `WalCheckpoint::Clean` or `Pending`. The trait's best-effort `checkpoint`, run after
   writes, still waits up to the lock timeout and ignores busy, and it finishes a pending one later. Surfacing the
   state to the knowledge plugin's redaction is step 3b's: the `checkpoint` host service still answers nothing.
10. **The tests' control.** `secure_delete.rs` adds a control that the table did not list. It overwrites a row on a
    connection with `secure_delete` off and checks that the raw-byte scan finds the old bytes, so the absence the
    other tests assert is not the scan's blind spot.

## 16. For the owner

### Owner decisions, 2026-11-03

**The owner answered all ten questions on 2026-11-03: the recommended option on questions 1 to 9, and on question 10 "attest and verify".** They are final
and written into the sections they govern; do not ask again. Approval is under the owner's 2026-10-31 delegation,
with these answers (D24). Each entry keeps the question as it was asked, the decision, and the alternatives the
owner did not choose.

1. **Auto-approval rules** (D98; 8.3, step 6). Should any proposal be applied without a person in phase 4?
   *Decided by the owner, 2026-11-03:* the mechanism with one rule kind, `deprecate-declared`, off by default per area. It applies
   only when the document's current bytes were written by an applied proposal, so a `superseded_by` typed into
   a file never triggers it. It never applies to `create`, `update`, `verify`, memory-derived, flagged or
   alternative proposals. *Alternatives not chosen:* (a) no auto-approval in phase 4 (drop step 6); (b) let the rule
   accept a declaration that arrived by file sync, as any file edit already can change a document directly;
   (c) a rule applying `create` from `person` memory.
2. **The MCP approval relay** (D99; 8.4). Should a person approve over MCP in phase 4? *Decided by the owner, 2026-11-03:* no. Keep
   approve CLI only, and move the Rust relay prerequisite and Umbel's use of it to phase 5, with 8.4's
   conditions. *Alternatives not chosen:* (a) build the AFD Rust relay now and leave Umbel's use until phase 5; (b) enable
   it now per area, recording "the person behind an unverified client".
3. **The optional model** (D100; 8.5). *Decided by the owner, 2026-11-03:* no model in phase 4; the key reserved and refused.
   *Alternatives not chosen:* (a) a deployer-configured child process: JSON on stdin, a draft on stdout, CLI only,
   recorded and never replayed, the model named in `drafter`; (b) an HTTP endpoint once `http` and `secrets`
   exist (phase 5).
4. **Reading other people's memory** (D101; 4.1). *Decided by the owner, 2026-11-03:* memory is read only under the caller's reader
   filter, and `ReaderFilter::Derivation` stays refused. *Alternative not chosen:* a derivation read under a new rule, so a
   team's candidates count across principals; the curator would then see records its caller cannot.
5. **Widening a private record into a proposal** (D94; 5). *Decided by the owner, 2026-11-03:* scheduled drafts only of records whose
   readers cover the target's. A person widens their own records at a terminal with `curator-promote`, own
   records only, as D88 limits `memory-confirm`. *Alternatives not chosen:* (a) no widening in phase 4; (b) an approver
   promotes others' records, which before phase 5 cannot tell local people apart.
6. **Who authored a drafted proposal** (D102; 8.2). *Decided by the owner, 2026-11-03:* self-approval compares the approver with
   `promotedBy` and with every source record's principal. In a one-person workspace every draft of that
   person's memory is therefore self-approval, needing `allow_self_approval` and recorded as such.
   *Alternatives not chosen:* (a) the curator is the author, so the runner approves any scheduled draft with no exception,
   which lets a person remember, run the schedule and approve their own statement unrecorded; (b) the runner is
   the author, so `verify` and `deprecate` drafts also count as self-approval.
7. **Forgotten evidence in an open proposal** (D103; 9.1, 8.2). *Decided by the owner, 2026-11-03:* the next run withdraws and
   redacts. Invalidation, purge, expiry or loss of readability withdraws without redaction. Knowledge declares
   `memory` (read only) so approve refuses a proposal whose source is gone. An applied proposal is never
   retracted. *Alternatives not chosen:* (a) no `memory` grant for knowledge, accepting the window until the next run;
   (b) withdraw only, keeping hashes as D85's residue; (c) keep the proposal open.
8. **Writing memory** (D104; 9.2). *Decided by the owner, 2026-11-03:* the curator never writes memory; `curator-status` lists
   records their owner may invalidate as `outdated`. *Alternative:* the curator holds `memory_write` and
   invalidates promoted records itself, filling the reserved fields (memory record version 2).
9. **What may settle** (D93; 4.2). *Decided by the owner, 2026-11-03:* the default `authorities` is `["person"]`, confirmed records
   included, and a deployer may widen it per space by pack to `agent`, `tool` or `import`, never `transcript`.
   *Alternatives not chosen:* (a) fix it at `person` with no override in phase 4; (b) default to `person` and `agent`.
   An agent's note is what S14's poisoning writes, so widening is the main lever on that risk.
10. **Trusting a drafter** (D91; 3.2, 10.1). *Decided by the owner, 2026-11-03: attest and verify.* The host
    attests a step's plugin, instance, pipeline and run through a table keyed by random step trace ids. The
    knowledge plugin accepts an attestation only from instances in `drafters`, and **verifies every claim of a
    listed drafter itself**:
    - memory evidence and `derivedFrom` against the memory store, through its read-only `memory` grant: existence,
      liveness, version and hash, and the copied `authority`, `origin`, `constraints` and `access`;
    - the content against the shared fixed rendering;
    - the candidate and document ids against their derivations;
    - `conflictSet` for consistency;
    - `mode` and `promotedBy` from the sources' principals and the access comparison.

    Self-approval comes from the records, not the drafter. A mismatch is `PROPOSAL_DRAFT_MISMATCH`. What remains
    unverifiable is stated in 3.2: a promotion's terminal consent, the settling policy, `generated.at`'s exact
    value, and sessions as labels. *Alternatives not chosen:* (a) attest and trust: accept a listed drafter's
    assertions unchecked, as trusted compiled code (D42); (b) no attestation, so curator proposals are recorded as
    the runner's own with no drafter. The owner's standing goal is a high-quality MCP system with no corners cut,
    and option (a) was preferred at first only because verifying looked like more work.

### Decisions made here that do not change the trust model

Decided with the specification's approval: proposal record version 2 (D92); re-verification through `verify`
proposals a person approves (D95); feedback and scheduling (D96); the confirmation preview (D97), which strengthens
approval; and the pipeline `expose` and `result` keys (D105), which narrow exposure. D90 (the curator's grants)
follows owner decisions 4 and 8.

## Follow-ups

| Date | Follow-up | Owner |
| --- | --- | --- |
| 2026-11-03 | Procedural candidates as skills in a pack (D15) | When a deployer asks |
| 2026-11-03 | Edits that need judgment (6.2's reported kinds) | A new owner decision on a model |
| 2026-11-03 | Exact session counts need session ids the store does not return (4.3) | When it matters |
| 2026-11-03 | A doctor API for plugins, so `overdue` reaches `workspace-doctor` (7.3) | When a second plugin needs one |
| 2026-11-03 | A `MemoryMeta` projection with `contentHash` and `observations`, if `max_gets` proves too small (4.1) | When a deployer asks |
| 2026-11-03 | A memory retrieval eval before ranking candidates beyond fixed rules | After phase 4 |
| 2026-11-03 | Phase 3's follow-up on sharing writers closing others' records bears on 9.2's listed invalidations | Owner, before phase 5 |
