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
  - Step 2 (host), 2026-11-03, merged in [#753](https://github.com/lushly-dev/afd/pull/753) as `83639abb`: the
    pipeline attestation table and the SDK's `CallContext.pipeline`, a version 4 pipeline's exposure checked at seal
    and its `result` applied, the CLI's confirmation preview, and `secure_delete` with a reporting checkpoint on
    `store.sqlite3`; its [amendments](#amendments-from-step-2) settle ten details and change no trust-model point.
  - Step 3a (knowledge: record and journal), 2026-11-03, in its pull request, from `83639abb`: proposal version 2
    written and version 1 read and kept, the knowledge manifest at version 4, the digest set of 11.2, and
    `knowledge-proposal-preview` declared as `confirm_preview` by approve and reject; its
    [amendments](#amendments-from-step-3a) settle eleven details, fix one fault in step 1's schema, and change no
    trust-model point. Merged in [#754](https://github.com/lushly-dev/afd/pull/754) as `37af26c9`.
  - Step 3b (knowledge: the drafted path), 2026-11-03, in its pull request, from `37af26c9`: `drafters`,
    `knowledge-propose-batch` and `knowledge-proposal-feed` on the host's attestation, `PROPOSAL_ALREADY_OPEN`,
    a drafter's withdrawal and redaction with the checkpoint's state carried through a new `truncate_wal` host
    service; a listed drafter's memory claims refused until step 3c (`PROPOSAL_DRAFT_UNVERIFIABLE`); every draft
    that was not applied redacted when its source is erased, and the change log's earlier hashes of it
    forgotten. Its [amendments](#amendments-from-step-3b) settle thirteen details and change no trust-model
    point; 12 and 13 record the owner's decisions on its two questions, for the stronger guarantee. Merged in
    [#763](https://github.com/lushly-dev/afd/pull/763) as `4a6b2de4`.
  - Step 3c (knowledge: verifying drafts), 2026-11-03, in its pull request, from `4a6b2de4`: `umbel_okf::draft` (the
    fixed rendering, the rationale, `subject_key` and the id and key derivations); the knowledge plugin's optional,
    read-only `memory` grant and a `journal` on every command and pipeline; every check of 3.2, with
    `PROPOSAL_DRAFT_MISMATCH` naming it, in place of step 3b's refusals, which stay only for claims this instance cannot
    verify; approve's re-checks and authorship from the store (8.2); the "erased" claim checked. Its
    [amendments](#amendments-from-step-3c) settle fourteen details and change no trust-model point; the
    fourteenth, the drafter's target held and enforced by the knowledge instance, settles the question the step found,
    under owner decision 10. Merged in [#765](https://github.com/lushly-dev/afd/pull/765) as `7e52e337`.
  - Step 4 (curator: candidates), 2026-11-03, in its pull request, from `7e52e337`: the `umbel-plugin-curator` crate
    with its manifest, `settle` pack, `curator-guide` skill and configuration; eligible records, groups, settling,
    conflict sets and section 5.1's rule as a pure, public core; drafting through `umbel_okf::draft`, proven against
    the real knowledge plugin's verification; `curator-candidates` and `curator-promote`; per-principal candidate and
    consent records; the `memory` job gains the crate. Its [amendments](#amendments-from-step-4) settle twelve
    details and change no trust-model point; the first adds a host service, `readable_collections` under `documents`,
    for the metadata of collections the caller reads (in place of the `content` grant, for least privilege), and the
    ninth a host field, `CallContext.person`, so `curator-promote` makes `memory-confirm`'s person check. Merged in
    [#767](https://github.com/lushly-dev/afd/pull/767) as `0d46a9a0`.
  - Step 5 (curator: runs), 2026-11-03, in its pull request, from `0d46a9a0`: `curator-plan`, `curator-finish`,
    `curator-status` and the `curator-run` pipeline (command line only, `result = "last"`, digest); the lock, its
    takeover and owner-only release; recovery by derived proposal ids; the rotating memory and document scans;
    re-verification and deprecation drafts with per-document `review` records; rejection and apply feedback; the
    re-check of open drafts and forgotten evidence (the `erased` notice, the curator's records erased, a consent that
    keeps no sources). Its [amendments](#amendments-from-step-5) settle thirteen details and change no trust-model point;
    the first refuses the run's steps outside the run, and the ninth declares one grant less (`graph`).
- **Not done:** steps 6 and 7 of section [15](#15-implementation-plan); step 6 (auto-approval) is next.
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
[plugins.knowledge.config.drafters.curator.targets.main]   # no drafters: PROPOSAL_DRAFTER_NOT_ALLOWED
collection = "notes"            # where the curator's creates go in the space main
prefix = "learned"              # optional; a create is exactly notes/learned/<derived id>
```

(This is step 3c's amendment 14; the approved text read `drafters = ["curator"]`, and named no target.)

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
| Document id | `change.doc` is exactly the drafter's target, as this instance's own configuration names it (step 3c, amendment 14), followed by the candidate id, or the conflict set id when `conflictSet` is set | `document` |
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
prefix = "learned"              # optional; plain segments, no trailing / (step 3c, amendment 14)
```

- **Document id:** `<collection>/<prefix>/<candidate id>`, or `<collection>/<prefix>/<conflict set id>` for
  alternatives (`<collection>/<id>` without a prefix). Opaque and content-free. The knowledge instance's drafter
  entry names the same target and is the one enforced (step 3c, amendment 14).
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
| `CURATOR_RUN_REQUIRED` | `curator-plan` or `curator-finish` called other than as a step of the curator's own `curator-run` (step 5, amendment 1) | No |
| `PROPOSAL_DRAFTER_NOT_ALLOWED` | An attested submission from an instance not in `drafters` | No |
| `PROPOSAL_DRAFTER_TARGET_INVALID` | A drafter's configured target names a collection the space lacks, or one that is not markdown (step 3c, amendment 14) | No |
| `PROPOSAL_EVIDENCE_INVALID` (extended) | Memory evidence, memory `derivedFrom`, a `conflictSet` or a withdrawal without an accepted attestation | No |
| `PROPOSAL_DRAFT_MISMATCH` | A drafter's claim does not match the memory store or the fixed rendering (3.2, and step 3c's amendment 4); `details.check` names the check. Also at approve, for a copied field that no longer matches (8.2), and for an "erased" claim the store contradicts (step 3c, amendment 11) | No |
| `PROPOSAL_DRAFT_UNVERIFIABLE` | A listed drafter's claim this instance cannot verify: memory without the `memory` grant or on an op other than `create`, or content citing no memory record (step 3b, amendment 1; step 3c, amendments 2 and 3); `details.claim` names it. Also at approve, for a memory draft without the grant | No |
| `PROPOSAL_ALREADY_OPEN` | A drafted proposal for a document or source that has an open proposal | No |
| `PROPOSAL_BATCH_TOO_LARGE` | More than 50 proposals, 50 withdrawals or 400 cited sources | No |
| `PROPOSAL_ACCESS_WIDENED` | Approve's re-check of 5.1 fails | No |
| `PROPOSAL_SOURCE_GONE` | Approve finds a source gone (8.2) | No |
| `PROPOSAL_AUTO_NOT_ALLOWED` | `knowledge-auto-approve` with a pipeline attestation | No |
| `CONFIRMATION_PREVIEW_FAILED` | The preview failed; nothing ran | No |
| `CURATOR_CANDIDATES_SKIPPED` (warning) | A run skipped candidates; details hold counts by reason | |
| `CURATOR_LOCK_TAKEN_OVER` (warning) | `curator-finish` found its expired lock taken over by another run, so it recorded its report and left the state (step 5, amendment 3) | |
| `PROPOSAL_REDACTION_PENDING` (warning) | A redaction's checkpoint found a reader holding the write-ahead log (step 3b, amendment 8) | |

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
- the curator listed in `drafters`, with its target `notes` and prefix `learned` (step 3c, amendment 14);
- the target `notes/learned/` (collection `notes`, prefix `learned`), named alike in the curator's and the
  knowledge instance's configuration;
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

### Amendments from step 3a

Step 3a settled these details of sections 2.1, 8.1 and 11.2 that the text left open, and fixed one fault in step 1's
schema. None changes who may draft, verify, approve or read anything, or what the knowledge plugin trusts.

1. **The record's store envelope.** A version 2 proposal's record is written with envelope version 2 (`authority`,
   `redactions`, `constraints` and `confirmation` null): the version its body's `provenance` nests, as D36 and phase
   3's step 1 kept version 1 beside proposal version 1. Every later save keeps the record's envelope version, so a
   version 1 record's envelope stays version 1.
2. **Reading both versions.** The plugin reads versions 1 and 2 and writes each back in its own version. A version 1
   record gains no version 2 key and no `decision.channel` when it is decided, withdrawn or applied, and stays valid
   against `proposal.v1.json`; an idempotent retry by key still returns it, and another change under its key is still
   `PROPOSAL_KEY_REUSED`. A record of any other version is treated as absent (`PROPOSAL_NOT_FOUND`, and lists skip
   it), as an unreadable body already was.
3. **A proposer's withdrawal** of a version 2 proposal records `{ by: "proposer", reason: "retracted", at }`, `at`
   from the call's clock (step 1's amendment 7). A decision by a person records `channel = "terminal"`.
4. **Memory evidence through `knowledge-propose`.** Its closed input schema already refuses the kind, so the host
   answers `VALIDATION_ERROR`. The handler also refuses `kind = "memory"` with `PROPOSAL_EVIDENCE_INVALID` (11.3), so
   no caller that skips the schema can store one. `derivedFrom`, `conflictSet` and withdrawals are not inputs of
   `knowledge-propose` at all. The attested path is step 3b's.
5. **The digest set's `keep`.** `-proposal-show`, `-proposal-preview`, `-approve`, `-reject` and `-withdraw` keep
   `["space", "proposal"]`, so reject's `reason` is not kept. `-proposal-list`, which has no proposal input, keeps
   its filters, `["space", "state", "area", "after", "limit"]`, none of them content. `knowledge-propose`,
   `-verify` and every read and index command declare no `journal` and stay plain. The `journal` on every command
   that phase 3's rule requires comes with the `memory` grant in step 3c. A failed call keeps no input value (phase 3
   step 5, amendment 4), so AFD's `APPROVAL_REQUIRED` entry before an approve keeps no id.
6. **What the preview shows beyond 8.1's list:** the record's version and state, its proposer's principal and actor
   kind, and a withdrawal or redaction. A person deciding a proposal that is no longer pending then sees why the
   decision will refuse. The preview renders every state, and the decision fails with its own code.
7. **The settling figures** labelled **"drafter's policy"** are each memory entry's `observations` and the draft's
   settling instant, the content's `generated.at` (13, point 3). Section 3.2 checks the sessions only as a bound,
   cannot verify that sessions are distinct, and checks `generated.at` only within bounds. The preview names the
   settling days, authorities and session floor as the drafter's pack. Excerpts are not shown: the diff holds the
   text.
8. **Untrusted text in the preview.** Values that came from a proposer or a record are JSON-quoted on their line:
   evidence refs, constraints, access tokens, the run id and the settling instant. Every diff line is prefixed `| `.
   So no content can start a line that reads as one of the preview's own labels. The CLI's sanitising and cap (step
   2's amendment 8) apply on top. The result carries `dev.umbel/trust = "content"`; its data stays exactly
   `{ preview }`, with no output budget declared, since the CLI caps what it shows.
9. **Approve's reader rules, shared.** Approve's gate and the preview use one function (`apply::readable`): the
   proposal readable, and its target too (the collection for a create, the document otherwise). Two consequences:
   - An approve or reject of a proposal the caller may not read now stops at the preview with
     `CONFIRMATION_PREVIEW_FAILED`, `details.cause = "PROPOSAL_NOT_FOUND"`, before any prompt. It used to fail after
     the prompt with `PROPOSAL_NOT_FOUND`. Nothing of the proposal is shown either way; `proposals.rs` changed with it.
   - In the decision gate the reader check now runs before the area check, so an unreadable proposal is reported
     absent even where no area governs it any more.
10. **Approve's prompt** is the text 2.2 shows, "Apply this proposal to the knowledge base?": it no longer tells the
    person to read `knowledge-proposal-show` first, since the preview comes before it.
11. **A fault in step 1's schema, fixed.** `proposal.v2.json`'s rule that a drafter's withdrawal needs a drafter tested
    `withdrawal.by` without `type: object`. A `null` withdrawal matched it, so every undrafted pending version 2
    record was refused. It now has `type: object`. `tests/schemas/phase4.rs` checks that an undrafted pending record
    validates; each of step 1's examples had a drafter or a proposer's withdrawal, which is why it was missed.
12. **Drafted records before step 3b.** No command stores a drafter, memory evidence, a conflict set or a redaction
    in this step. The tests write such records straight through the document store (`tests/support/records.rs`), as a
    library embedder can (D14). So the preview, show, list and the digest set are tested on them before step 3b's
    batch writes them. Approve's re-checks of a drafted proposal (8.2) and `agent-inferred` for its document stay
    steps 3b and 3c's.

### Amendments from step 3b

Step 3b settled these details of sections 2.1, 3.1, 3.2, 7.1, 8.2, 9.1, 11.2 and 11.3 that the text left open.
None lets a non-drafter submit drafted proposals, weakens the attestation or leaves more forgotten text readable
than the text alone; the first holds owner decision 10 in place until step 3c can verify, and the sixth removes
more than 9.1 lists. The two questions this step found were put to the owner, who decided both for the stronger
forget guarantee, with no accepted residue (2026-11-03): amendments 12 and 13 close them, and 7 and 8 are written as
they now stand.

1. **A listed drafter's memory claims are refused until step 3c verifies them.** Owner decision 10 is attest
   *and verify*, and the checks of 3.2 that read the memory store and `umbel_okf::draft` are step 3c's. So in
   step 3b `knowledge-propose-batch` refuses, from an attested, listed drafter, every claim 3.2 would verify
   that way, item by item, with a new code, **`PROPOSAL_DRAFT_UNVERIFIABLE`** (not retryable), whose
   `details.claim` names the claim and never the content:
   - `memory-evidence`: a `memory` evidence entry;
   - `derived-from`: a `derivedFrom` (which 2.1 makes memory only);
   - `candidate`: `drafter.candidate` (its derivation needs the sources);
   - `promotion`: `mode = "promoted"` or a `promotedBy` (the widening check needs the sources);
   - `conflict-set`: a `conflictSet` (its consistency check reads the sources' subject keys);
   - `content`: a `create` or `update` (3.2's content row compares it byte for byte with the fixed rendering).

   What a listed drafter can store in step 3b is therefore a `verify` or `deprecate` draft citing `document`,
   `url`, `text` or `record` evidence, with `mode = "scheduled"`, which this plugin computes (nothing is
   widened) rather than takes on trust. `PROPOSAL_EVIDENCE_INVALID` and `PROPOSAL_DRAFT_MISMATCH` did not fit:
   the first means "no accepted attestation", and the second that a check ran and failed. The preview labels a
   draft that cites no memory record "Drafter, checked at submission: it cites no memory record, so it widens
   no one's readers", never "verified against memory at submission". So no proposal carrying that label can
   be stored before the verification exists. Step 3c lifts each refusal as its check lands, and settles
   whether the code stays for an instance whose `memory` grant is withheld. `drafted.rs`
   (`a_listed_drafters_memory_claims_are_refused_until_they_can_be_verified`) holds each claim refused and
   nothing stored.
2. **The batch's shapes.** An item is `knowledge-propose`'s input without `space`, plus `drafter: { mode?,
   candidate?, promotedBy? }` (the claims only: `plugin`, `instance`, `pipeline` and `run` come from the
   attestation and are never input), `conflictSet` and `derivedFrom`; an evidence entry may have 2.1's
   memory shape. AFD's schema subset has no `pattern` or `oneOf`, so the host's schema checks types, enums
   and lengths, and the handler the rest. The lists carry no `maxItems`, so the caps answer
   `PROPOSAL_BATCH_TOO_LARGE` rather than `VALIDATION_ERROR`; the 400 counts distinct memory record ids
   across the batch, before any item, whoever calls. The result is `{ space, drafter, results, withdrawals,
   erased, counts, checkpoint }`: `drafter` the attestation or `null`; `results[i]` `{ index, ok: true, created,
   rev?, proposal }` (the summary) or `{ index, ok: false, error }`; `withdrawals[i]` `{ index, ok: true,
   withdrawn, redacted, proposal }` or `{ index, ok: false, proposal: <id>, error }`; `erased` (amendment 12)
   `{ sources, redacted: [ids], withdrawn: [ids], refused: [{ proposal, error }] }` or `null`; `counts` `{ created,
   existing, refused, withdrawn, redacted, withdrawalsRefused }`. Only `PROPOSAL_DRAFTER_NOT_ALLOWED`,
   `PROPOSAL_BATCH_TOO_LARGE` and a missing space refuse the whole call. Without an attestation, a non-null
   `drafter`, `conflictSet` or `derivedFrom`, a memory entry, or any withdrawal is `PROPOSAL_EVIDENCE_INVALID`
   for its item. 3.1's `finish` step reads `$steps.submit.results`; step 5 also passes
   `$steps.submit.withdrawals` and `$steps.submit.checkpoint`.
3. **Withdrawals run first**, then the proposals, so a run that withdraws a stale draft and submits its
   replacement for the same document (7.3's recovery) is not refused as already open.
4. **`PROPOSAL_ALREADY_OPEN`.** "Open" is `pending` or `approved` (an apply that stopped). The caller's
   readable proposals are read once per attested batch and the set is kept up to date as items are stored,
   so a batch's second draft for a document is refused. The idempotent retry is checked first, so a rerun
   gets its own existing proposal back (`created: false`). Members of one conflict set do not block each
   other on their shared document (3.2's conflict-set row; step 3c passes the set). An ordinary batch and
   `knowledge-propose` are not held to it, as phase 2 allows several proposals per document. The
   memory-source half is in place and is first exercised in step 3c, since no draft cites memory before it.
5. **A retry repeats the drafter's claims.** The same key with the same change hash returns the existing
   proposal only when its drafter's `plugin`, `instance`, `pipeline`, `mode`, `candidate` and `promotedBy`
   and its conflict set are the ones asked for, and drafted and undrafted never match; anything else is
   `PROPOSAL_KEY_REUSED`. The `run` is not compared, since a later run renders the same draft (7.3).
6. **What a redaction removes, beyond 9.1's list.** Also the rationale, replaced by a fixed sentence (a
   drafter's rationale is its own text, which 3.2 bounds only by its counts); every evidence `excerpt`, not
   only memory entries'; a verify's `verification.note`; and `derivedFrom` in the stored record's envelope as
   well as the body's. The id, the document id, the idempotency key, `flags` and `confidence` stay.
7. **Who withdraws and redacts, and in which states.** A drafter's withdrawal needs the proposal's `drafter`
   to name the attested plugin and instance and its proposer to be the batch's caller, since a run works for
   its caller; otherwise `PROPOSAL_NOT_PROPOSER`. Its reasons are `source-erased`, `source-changed` and
   `superseded-alternative` (the schema refuses `retracted`), and `redact: true` goes exactly with
   `source-erased` (`PROPOSAL_INVALID` otherwise), as `redacted.reason` is always `source-erased`. A `pending`
   draft is withdrawn, and with `redact` withdrawn with `source-erased` and redacted. With `redact`, any other
   draft that was not applied is redacted in place, keeping its state and its withdrawal or decision
   (amendment 12). Without it, a withdrawn draft is left as it is, and an approved or rejected one is
   `PROPOSAL_STATE_INVALID`, as only a pending proposal is withdrawn. An applied one is always
   `PROPOSAL_STATE_INVALID`: 9.1 never retracts it. A redacted draft is not written again (idempotent:
   `withdrawn` and `redacted` false), though the change log still forgets any earlier hash of it (amendment
   13).
8. **The checkpoint's state, carried through (step 2's amendment 9).** A new host service,
   `HostServices::truncate_wal` (SDK `Cx::truncate_wal`, answering `WalCheckpoint::Clean` or `Pending`), runs
   step 2's `SqliteStore::truncate_wal` under the rules of `checkpoint` (a write grant allowed for the space,
   in one of the call's spaces). It is compiled-only, as `CallContext.pipeline` is; WIT world 1.0.0 is
   unchanged. After a batch that redacted anything, or made the change log forget a hash (amendment 13), the
   plugin runs it once and reports `checkpoint: "clean"` or `"pending"` (`null` otherwise; an error reads as
   `pending`). `pending` adds the warning
   **`PROPOSAL_REDACTION_PENDING`**, which suggests `store-check`, whose checkpoint finishes it, as does a
   later write's best-effort checkpoint. A pipeline with `result = "last"` returns only the last step's data
   (step 2's amendment 5), so a step's warnings do not reach the pipeline's result; the batch's `checkpoint`
   field is what reaches `curator-finish`, and the step's digest journal entry keeps the warning's code.
   Step 5 surfaces it in the run's answer.
9. **The feed.** Its input is `{ space, after }`, `after` a required integer. A call without an attestation,
   or with one of an unlisted instance, is `PROPOSAL_DRAFTER_NOT_ALLOWED` (11.3 names it for submissions; 11.2
   says the feed refuses such a call). It reads the store's change log after `after` under the caller's
   reader filter, in pages of 500 and at most 5000 changes per call, and reports each readable proposal of
   this instance whose `drafter` names the attested plugin and instance, whose proposer is the caller, and
   which is `rejected` or `applied` at a revision after `after`, once per call, in revision order: `{
   proposal, state, doc, candidate, conflictSet, rev, decidedAt, decidedBy, channel }`, with `reason` for a
   rejection and `contentHash` for an apply, and `redacted`. A withdrawal is not a decision and is not
   reported. A redaction writes the record again, so a redacted rejection is reported once more, with
   `redacted: true` and no reason. `next` is the
   last revision read, for `feedAfter`; `more` says the bound stopped it. A rejection's reason is an
   approver's text, so the data carries `trust: "content"`, as the result's metadata does. Its journal keeps
   `space` and `after`; the batch's keeps `space`.
10. **Drafted proposals are `agent-inferred`**, in the body's provenance, the stored record's envelope and the
    document an approval writes, whoever ran the pipeline (8.2). Approve's authorship rule for a draft, which
    compares the approver with every source's principal read from the memory store and with `promotedBy`,
    comes with step 3c's `memory` grant, as do 8.2's re-checks. Until then a draft keeps phase 2's rule: the
    runner approving it is self-approval. That is stricter than 8.2, under which a `verify` or `deprecate`
    draft needs no exception, and never looser.
11. **Test support.** `plugins/knowledge/tests/support/drafter.rs` holds two stand-in drafters, `curator`
    (listed) and `scribe` (not): compiled plugins whose pipelines' only steps are the batch and the feed, so
    the host attests them as it will the curator's. `umbel-store-embedded`'s `testkit` feature gains
    `SqliteStore::hold_reader`, a reader holding the write-ahead log, so `redaction.rs` sees `pending` without
    linking SQLite into the plugin's tests; the knowledge crate's dev-dependency enables that feature, and no
    crate is added.
12. **Every draft that was not applied is redacted when its source is erased** (the owner's decision of
    2026-11-03, closing step 3b's first question). 9.1 and step 1's schema redacted only a draft the drafter
    withdrew, so a rejected draft, one its proposer withdrew with `knowledge-withdraw`, and one approved whose
    apply never landed kept their memory-derived text readable by the target's readers after the source was
    forgotten. Now:
    - **`proposal.v2.json`** allows `redacted` beside `withdrawn` (whoever withdrew it), `rejected` and
      `approved`, and never beside `pending` or `applied`; it no longer requires a redacted record's withdrawal
      to be a drafter's for `source-erased`. A redacted record keeps no `verification.note`, no
      `decision.reason` and no evidence `excerpt` of any kind, beside 9.1's fields. The schema changed, with
      `tests/schemas/phase4.rs`.
    - **The redaction** keeps the decision (who, when, the channel and the outcome) or the withdrawal as it was,
      and removes the rest as amendment 6 says, now including a rejection's reason, which is an approver's text
      and may quote the draft. A pending draft is withdrawn by the drafter with `source-erased` first. An
      applied proposal is never retracted (owner decision 7).
    - **How it reaches drafts that are not open.** The curator re-checks only its open drafts (9.1), so the
      batch gains an **`erased`** notice: up to 400 memory record ids (`mem-` and 24 hex digits) the drafter saw
      `Erased` in the memory store's changes feed. The knowledge plugin redacts each of that drafter's own drafts
      for the caller that cites one of them and was not applied, whatever its state, and answers which it
      redacted and withdrew. The notice needs an accepted attestation (`PROPOSAL_EVIDENCE_INVALID` for the whole
      call otherwise; `PROPOSAL_INVALID` for a malformed id; `PROPOSAL_BATCH_TOO_LARGE` over 400). A `withdraw`
      item with `redact: true` reaches the same states by id. Step 3c may check that a named source is in fact
      gone before redacting; nothing is lost by redacting early, since a redaction only removes text.
    - **Approve** refuses a redacted draft with `PROPOSAL_SOURCE_GONE` (8.2's code) before anything else, since
      nothing is left to apply.
    - **Limit, stated:** proposals are read under the caller's reader filter, so a draft its own proposer can no
      longer read (the proposer removed from the record's readers since) is reached by neither path. Its readers
      are then only those the record still admits.
13. **No earlier body hash of a redacted draft is left in the change log** (the owner's decision of 2026-11-03,
    closing step 3b's second question). `store.sqlite3`'s `changes` table kept every version's record hash, a
    hash of a body that held the forgotten text, which may confirm a guess as the change hash 9.1 redacts would.
    Now:
    - **The store:** `DocumentStore::forget_record_history(ns, kind, id)` sets `content_hash` to null on the
      record's earlier changes (the current version's keeps its hash; revisions, trace ids and times stay) and
      answers how many it changed; the embedded store does it in one `BEGIN IMMEDIATE` transaction, under
      `secure_delete`, and the batch's checkpoint (amendment 8) truncates the write-ahead log after it. `NotFound`
      for an absent record. `store-embedded/tests/secure_delete.rs` holds that the old hashes are gone from the
      database file and its log after the checkpoint.
    - **The host:** a compiled-only service, `HostServices::record_forget_history(space, kind, id)` (SDK
      `Cx::record_forget_history`), under `records_write` for the space and only in the instance's own
      namespace. `tests/store_truncate_wal.rs` holds its rules.
    - **The plugin** calls it after every redaction, and again for a redacted draft a later notice or item names,
      so an interrupted run leaves nothing behind.
    - **The journal and the events.** A decision or withdrawal of a drafted proposal (`knowledge-reject`,
      `knowledge-withdraw`) no longer puts the record's hash in `dev.umbel/provenance`'s `contentHash`, since
      those keys enter both. Undrafted proposals keep it. `redaction.rs`
      (`no_earlier_body_hash_of_a_redacted_draft_remains`) holds, for a draft the batch stored and a person
      rejected, that neither earlier hash is left in the change log, the files, the journal or the events.

### Amendments from step 3c

Step 3c settled these details of sections 2.1, 3.2, 4.5, 8.1, 8.2, 9.1, 10.3, 11.2, 11.3 and 13 that the text left
open.
None accepts a drafter's claim unverified, reads memory beyond the caller's reader filter, or changes who may draft,
approve or read anything. Every one refuses where the text was silent, or reads the store where the text allowed
trust; the tenth ends step 3b's interim authorship rule for 8.2's, as 3b's amendment 10 said it would.

1. **`umbel_okf::draft`'s bytes.** The rendering's frontmatter holds `title`, `type`, `tags` and `generated`, in that
   order. Each value is a YAML double-quoted scalar with JSON's escapes, plus `\u` escapes for C1 controls, U+2028,
   U+2029 and U+FEFF, so no record's text can break a line. `tags` is `[]` when there are none. Tags and constraints
   are the records' union, sorted, each once. The text gets one final newline when it has none. `Holds only` appears
   only with constraints.
   - `generated.by` is `umbel:<plugin>/<instance>` from the host's attestation, which is 4.5's `umbel:curator/<instance>`
     for the curator plugin.
   - `generated.at` is the canonical instant `YYYY-MM-DDTHH:MM:SS.mmmZ` (`format_instant`), so it reads back as one
     value.
   - The rationale, 4.5's "fixed text from the snapshot", is `Drafted from <class> memory of authority <authority>,
     observed in <n> session(s) by <m> principal(s), settled at <instant>.` `Rationale::parse` is its exact inverse.
   - The idempotency key is `<instance>/<candidate id>/<drafts>`: 4.5's `curator/...` for the instance `curator`, and
     two curator instances never share a key.

   `okf/tests/draft.rs` pins each of these byte for byte.
2. **The `memory` grant is optional.** It is declared `required = false`, so a deployer who runs no curator may deny
   it (`deny = ["memory"]` under `[plugins.knowledge]`) and the instance still loads. This settles step 3b's amendment
   1 question: for such an instance `PROPOSAL_DRAFT_UNVERIFIABLE` stays. Every memory claim is refused with claim
   `memory-evidence`, and approve refuses a stored memory draft with the same code, so nothing is accepted or applied
   unverified.
   - It is a read grant, so it needs no `allow` list and the README's `umbel.toml` is unchanged.
   - The reads are `memory_get` and, only when no version is current, `memory_history`, both under the caller's reader
     filter, never a derivation read (owner decision 4).
   - Holding it, phase 3 section 2.3 requires a `journal` on every command and pipeline. The read and index commands,
     `knowledge-propose`, `-verify` and `knowledge-refresh` declare `plain`, as they behaved before. The digest set is
     unchanged.
3. **What stays unverifiable**, claim by claim, with `PROPOSAL_DRAFT_UNVERIFIABLE`:
   - `memory-evidence`: without the grant, or on an op other than `create`, since 4.5 drafts memory only as a new
     document's fixed rendering.
   - `content`: a drafter's `create` or `update` that cites no memory record, since there is no rendering to compare it
     with.

   The other claims step 3b refused now have checks. A candidate, a promotion, a conflict set or a `derivedFrom` on a
   draft citing no memory record is false on its face: `PROPOSAL_DRAFT_MISMATCH` with `candidate`, `mode` or
   `promoted-by`, `conflict-set`, or `derived-from`.
4. **Checks the table did not name**, each `PROPOSAL_DRAFT_MISMATCH`:
   - `source-authority`: a source whose authority is not `person`, `agent`, `tool` or `import`. A transcript never
     settles (owner decision 9), and step 1's amendment 9 already kept it out of the evidence schema.
   - `evidence`: a draft citing memory cites only memory. Any other entry's `ref` is free text that would outlive a
     redaction.
   - `derived-from`: `derivedFrom` names each source exactly once, as kind `memory` (2.1's "per source"). A missing or
     extra entry fails here; a differing hash is `source-hash`, as the table says.
   - `rationale`: the rationale is amendment 1's fixed text, of the group's class, with an authority no higher than the
     highest source's, at the content's settling instant. Counts above the store's are `counts`, as the table says.
   - `key`: the idempotency key is amendment 1's derivation for the attested instance and the verified candidate, with
     any draft count. A key survives a redaction (step 3b, amendment 6), so it must be content-free.
   - `run`: a drafted item's `run` is absent or the attested run. It is stored as `proposer.run` and the envelope's
     `session`, which also survive a redaction.

   A memory entry not in 2.1's exact shape (an unknown key, a malformed `ref`) is `PROPOSAL_INVALID`. Two entries for
   one record are `group`.
5. **How the checks read the store.** Each source is read once per batch, at the call's `now`, with flagged and expired
   versions let through, so a refusal can name its cause:
   - `source-missing`: no version readable under the caller's filter. Never written, forgotten, purged and another
     person's private record are one answer.
   - `source-not-live`: versions readable but none current (invalidated or superseded), or a current version that is
     invalidated, superseded, outside its validity or expired.
   - `source-flagged`, `source-class` and `source-authority`, as named.

   The checks run in this order, and the first that fails refuses the item: `run`, source exists, version and hash, group
   (before the copied fields, since the rendering needs one group), copied fields, confidence, counts, excerpt,
   `generated-at`, content, rationale, candidate, key, the conflict set's form, document, the conflict set's
   consistency, sensitivity, widening and mode. Further:
   - `confidence` is the highest of the sources' asserted confidences, and absent when none asserts one.
   - An entry without an `excerpt` claims none.
   - `generated-at`'s lower bound is each source's current `recordedAt`.
6. **Document and conflict set.**
   - Document: `change.doc` is a `create` at `<collection>/<path>` whose path ends in the candidate id, or in the
     conflict set id when one is set. Submit already requires a collection an area governs. **Superseded by
     amendment 14**: the path is exactly the configured target's.
   - Conflict set: it has the form `k-` and 20 hex digits. Every *open* proposal sharing it targets the same document,
     the `subject_key` of its title (the verified rendering's subject) equals this draft's, and none cites this draft's
     content hash.
   - The set id's derivation from the lowest member is not checked: 4.4 fixes it when the set first forms, and later
     members may be lower.
   - A verified conflict set goes to `PROPOSAL_ALREADY_OPEN`, so alternatives do not block each other on their shared
     document (step 3b, amendment 4).
7. **Verification and the idempotent retry.** A retry that repeats the change and the drafter's claims returns the
   stored draft before any check, as step 3b's amendment 4 says, since it accepts nothing new. A different draft under
   a used key is verified before it is called `PROPOSAL_KEY_REUSED`, so a replayed batch with a tampered copied field
   is `PROPOSAL_DRAFT_MISMATCH` naming that field (section 13, point 1). Verification also comes before
   `PROPOSAL_ALREADY_OPEN`.
8. **What is stored.** A verified draft stores:
   - its `derivedFrom`, in the body's provenance and the record's envelope, each entry of kind `memory`;
   - its conflict set;
   - its claimed and verified `mode`, `candidate` and `promotedBy`.

   A later save (a decision, a withdrawal) keeps the envelope's `derivedFrom`, and only a redaction removes it. Phase
   2's approve cleared it on every save, when no proposal had one. No result's `dev.umbel/provenance` carries it, as
   11.2 requires.
9. **Approve's re-checks (8.2)** run in this order: the redaction refusal (step 3b, amendment 12), the state, the
   target, each source, then authorship.
   - Target, scheduled draft: the target's current resolved access set must lie within every source's copied set, and
     its sensitivity must not be below any source's.
   - Target, promoted draft: 5.1 lets its target be wider, so the current target must lie within the target's access
     set recorded at submission (the proposal's `provenance.access`). No reader is added after the owner's consent.
   - A target that fails either rule is `PROPOSAL_ACCESS_WIDENED`.
   - Sources: one absent, not live, flagged, or not at its cited version and hash is `PROPOSAL_SOURCE_GONE`; a copied
     field no longer equal to the record's is `PROPOSAL_DRAFT_MISMATCH` naming it.

   An apply resumed from `approved` re-checks too. The approver reads under their own filter (owner decision 4), so a
   promoted draft of a private record can be approved only by someone who can read it: its owner, which is
   self-approval.
10. **Authorship from the store (8.2, D102).** Approving a drafted proposal is self-approval when the approver's
    effective principal or actor string equals a source record's principal, read at approve, or `promotedBy`. The
    proposer, who ran the pipeline, is no longer compared. So a draft of another person's shared memory, and a drafted
    `verify` or `deprecate` (which cite no memory), are approved by the runner with no exception, as 8.2 says, and
    step 3b's stricter interim rule (its amendment 10) ends. Undrafted proposals keep phase 2's rule.
11. **The "erased" claim is checked.** Step 3b's amendment 12 left this open. Two paths redact: a `withdraw` item with
    `redact: true`, and each draft the `erased` notice reaches. Either redacts only when the memory store, read under
    the caller's filter, no longer holds one of the sources named. Otherwise the draft is unchanged and the item is
    `PROPOSAL_DRAFT_MISMATCH` with `details.check = "source-erased"`; the notice reports it in `erased.refused`.
    - An erased record never returns, so the check never keeps forgotten text.
    - A record the caller can no longer read counts as gone, since a redaction only removes.
    - A draft citing no memory record is never redacted as if a source were erased.
    - Without the `memory` grant nothing can be checked, and the redaction proceeds, for the same reason.
    - A draft already redacted is not checked again.
12. **The preview's labels.** They stand as steps 3a and 3b set them, and every field under "verified against memory at
    submission" is now checked by a row of 3.2: the drafter's `mode`, `candidate` and `promotedBy`, and each memory
    entry's principal, class, sensitivity, authority, origin, constraints, access, confirmation and content hash.
    - The observed sessions (bounded only) and the settling instant (bounded) stay under "drafter's policy".
    - The principals count, now verified exactly, stays beside them rather than change the layout: it says less than
      is known, never more.
    - A draft citing no memory still reads "checked at submission: it cites no memory record".
    - Records a library embedder writes are trusted, as before (D14).
13. **Tests.**
    - `okf/tests/draft.rs` (10 tests, with amendment 14's).
    - `plugins/knowledge/tests/verify_drafts.rs` (20, with amendment 14's), with `tests/support/memory.rs`, which writes memory records
      through the store and builds drafts through `umbel_okf::draft`. It enables `umbel-store`'s `conformance` feature
      for the knowledge crate's tests, for the suite's memory samples; no crate is added.
    - `drafted.rs` gains approve's authorship from the store, and its step 3b refusal test becomes the test of what
      stays refused.
    - `journal_modes.rs` approves a verified draft (a seeded draft citing a record the store never held is now
      `PROPOSAL_SOURCE_GONE`) and holds the manifest's `plain` journals and its optional `memory` grant.
    - `redaction.rs` redacts a verified draft after its source is forgotten, and holds that a draft citing no memory is
      not redacted as erased.
    - The 400-source cap stays in `drafted.rs`.
14. **The drafter's target, held and enforced by the knowledge instance** (settled 2026-11-03 as the faithful
    application of the owner's decision 10, attest and verify, closing the question this step found). 3.2's
    document row named "the curator's configured target", which lives in the curator's namespace and which knowledge
    cannot read, so a faulty drafter could have put text in the path before the id, and a document id outlives a
    redaction.
    - **Configuration.** `drafters` becomes a table keyed by instance, each entry with its `targets` by space:
      `[plugins.knowledge.config.drafters.curator.targets.main]` with `collection` and an optional `prefix`. A table
      rather than a sibling map, so a target can never name an instance that is not listed. A drafter listed with no
      target in a space (`[plugins.knowledge.config.drafters.<instance>]` alone) drafts no create there; its `verify`
      and `deprecate` drafts are unaffected. Targets are per space because collections are.
    - **Validated at load**, by the configuration schema the host checks (`PLUGIN_CONFIG_INVALID`): the shapes, a
      collection id, and a prefix of one to eight plain segments joined by `/`, each a lowercase letter or digit then
      letters, digits, `-` or `_` (`umbel_okf::draft::is_safe_prefix`): no `.` or `..`, no empty segment, no leading
      or trailing `/`. **Checked at use**, on every drafted create, because a plugin's schema cannot see the
      workspace's collections: the collection must be a markdown collection of the space, else
      **`PROPOSAL_DRAFTER_TARGET_INVALID`** (11.3). That the knowledge instance writes it (`content_write` and
      `documents_write` allowed for it) is not visible to a plugin at all; an approval of a draft there stops with
      `PROPOSAL_APPLY_UNAVAILABLE`, as for any proposal.
    - **The check.** A drafter's create must be exactly `umbel_okf::draft::document_id(collection, prefix, id)`,
      `<collection>/<prefix>/<id>` (its file `<prefix>/<id>.md`), or `<collection>/<id>` without a prefix, where `id`
      is the verified candidate id or the conflict set id. Anything else, and a create with no target, is
      `PROPOSAL_DRAFT_MISMATCH` with `check = "document"`. With the key, the `run`, the candidate and the conflict
      set already checked, no drafter-chosen text survives in a drafted proposal's path, id or key.
    - **The curator (step 4)** reads its own target from its configuration (4.5, where the prefix loses its trailing
      `/`). The curator's configuration and knowledge's drafter entry must agree; **knowledge's entry is the one
      enforced**, so a curator configured otherwise has its creates refused, never written elsewhere.
    - Tests: `okf/tests/draft.rs` (`a_target_prefix_is_a_safe_relative_path_of_plain_segments`, and the derivation
      with and without a prefix); `verify_drafts.rs` (`the_document_is_exactly_the_configured_targets_path`: an extra
      or a different path segment, no prefix where one is configured, and the wrong collection refused; the exact path
      accepted, with and without a prefix; a drafter with no target refused its create and accepted its verify; a
      target naming a missing or a code collection; and `an_unsafe_target_prefix_is_refused_when_the_configuration_loads`).
      The conflict-set test's "another document" case now reaches the check by moving the target between drafts.

### Amendments from step 4

Step 4 settled these details of sections 2.3, 4, 5, 10.3, 11.1, 11.3 and 13 that the text left open. None reads memory
beyond the caller's reader filter, writes memory, widens a reader without the owner's promotion at a terminal, settles a
`transcript` record or changes what the knowledge plugin verifies. The first adds a host service under the `documents`
grant the curator already holds, for the metadata of collections the caller reads, in place of the `content` grant; the
ninth gives `curator-promote` the host's own person check, as `memory-confirm` has it.

1. **The target's readers: `readable_collections`, under `documents` (host and SDK).** Section 5.1 compares the target
   collection's resolved access set and sensitivity with each source's, and none of D90's grants gave them. The
   `content` grant's collection list does, but `content` also carries `content_read` of every file of every collection
   in the space, outside any reader filter, and `content_replace` wherever an allow list permits: far more than the
   rule needs. So the host gains a narrow, read-only service, **`readable_collections(space)`**, returning for each
   collection only its id, kind, default access set and sensitivity (the SDK's `CollectionMeta`), and only for
   collections whose access set the caller's reader filter admits; it lists and reads no file and returns no root or
   glob. Compiled plugins only, as `CallContext.pipeline` and `person` are; WIT world 1.0.0 and the schemas are
   unchanged, and a component or mounted server answers `NotGranted`.
   - **Why `documents` and not a new grant.** `documents` already means "read the space's documents under the caller's
     reader filter", and holds `reader_tokens`. A collection's default access set and sensitivity are what reading
     its documents under the same filter already reveals of each of them, and the filter is the same one, so the
     service adds no reach the grant did not have. A new grant would add a catalog name, a manifest and configuration
     surface and a deny to reason about, for metadata a `documents` holder can already infer. `content` is untouched.
   - **Readers only.** A collection the caller cannot read is left out, so the curator answers
     `CURATOR_TARGET_UNCONFIGURED` with `details.reason = "collection-missing"` for it, the same answer as for one that
     does not exist, and shows none of its readers or sensitivity. **5.1 still works**: the caller reads every source,
     so a target within every source's readers that the caller cannot read is possible (a source shared with `space`
     and `group:<g>`, a target for `group:<g>` alone, a caller outside the group), and refusing it is the stronger
     answer. Its proposal would carry the target's access set, so the run's caller could not read it: not follow it in
     the feed, retry it, withdraw it, or redact it when a source is forgotten (step 3b's amendment 12 reaches only
     drafts the caller can read). A target the caller reads is unaffected, and its readers can use it.
   - The curator declares no `content` grant. `documents` is required, so denying it fails the instance at load
     (`PLUGIN_GRANT_DENIED`) and no command runs on a guess; the handler's own answer to a withheld service is
     `collection-unknown`, fail closed. The other reasons are `unconfigured` (no `spaces.<space>` target, or a prefix
     that is not `umbel_okf::draft::is_safe_prefix`) and `not-markdown`. `graph` is not declared in this step, which
     reads no graph; step 5 declares it with re-verification, which does.
   - Tests: `tests/readable_collections.rs` (metadata and never file data, filtered by readers, refused without
     `documents` and not carried by `content`, refused outside the call's spaces); the curator's `config.rs` (an
     unreadable target is missing, its readers use it, the denied grant fails the load) and `target.rs`'s unit test
     (`collection-unknown`).
2. **When a group settles.** A candidate's members are every eligible record the caller can read with one content hash
   and class (eligible: semantic or procedural, live, unflagged, an authority the pack admits, and at least
   `min_confidence` when set, a record asserting none failing a set gate). It has settled when **every** member's current
   version has stood for the class's window and the members' sessions sum to `min_sessions`. A member still in its
   window holds the group back rather than splitting it, so the id, which derives from the lowest member, does not move
   as members settle. **`settledAt` is the latest member's `recordedAt` plus the window**, the instant the stability rule
   first held for every member: a pure function of the records, so `curator-candidates`, which writes nothing, and a run
   agree, and it lies within knowledge's `generated-at` bounds. A run's recorded snapshot is kept while its `settledAt`
   still bounds every member's current version; a confirmation or another new version re-settles it.
3. **`curator-candidates` computes; it writes nothing.** It is `inspect`, so it computes the caller's candidates at the
   call's `now` (section 4.6) and merges the caller's recorded candidates. It shows, per candidate, the id, status, skip
   reason, class, authority, source count, sessions, principals, `own`, `contentHash` (own candidates only), the candidate
   record's access set, sensitivity, conflict set, document, mode, `stableAt` (when the window ends), `settledAt`,
   `drafts`, `quietUntil` and `promotedTo`; the target's collection, prefix, readers and sensitivity; counts by status and
   of what was listed, eligible, read, left unread by `max_gets` and unopened; `more` when `max_records` stopped the list.
   It filters by `status` and pages by `after` and `limit` (at most 500). A recorded outcome whose sources the caller no
   longer reads is listed from its record. **No subject, text, tag, constraint or rejection reason** is in the result or
   the journal. The list itself runs newest first, as the store orders it, up to `max_records`; of the eligible records
   it found, the oldest are read in full first, so `max_gets` leaves out the newest, which are furthest from settling.
   Step 5's rotating scan (`scanAfter`) is what reaches records past `max_records` across runs.
4. **A caller with no principal** has no curator records and no candidate id: `CURATOR_PRINCIPAL_UNKNOWN`. The effective
   principal is derived as the knowledge plugin derives it, so the candidate ids agree.
5. **The status order and a run's records.** First that holds: a recorded `applied` or `erased` (never drafted again);
   `too-many-sources`; `sensitivity-higher` (even while settling, as it cannot change); `settling`; `conflict-too-large`;
   a recorded `drafted`, or `rejected` inside `quietUntil`; `target-exists` (`doc_get` under the caller's filter);
   `ready` with `scheduled`; `ready` with `promoted` when a consent covers the candidate; `needs-promotion`. A run's
   `drafts` count and conflict set are kept. Only records whose `principal` and `space` are the caller's are read as
   theirs, whoever else they are readable by.
6. **Conflict sets.** A candidate skipped for too many sources or higher sensitivity can never be drafted, so it joins no
   set and takes no alternative's place. Every other candidate with the subject key joins; the set's id is the lowest id
   a member was recorded with, else derived from the lowest member; members past `max_alternatives` that are settling or
   ready are skipped, and every member carries the id.
7. **Section 5.1 compares tokens.** The target's readers are within a source's when each of the target's tokens is in
   the source's access set, token for token, as the knowledge plugin compares them: `space` does not stand for
   `group:<g>`. Sensitivity is compared first.
8. **`curator-promote`'s details.** The `contentHash` is `sha256:` and 16 to 64 hex digits, or the hex alone, as
   `memory-confirm` takes it. Refusals, in order after `CURATOR_CANDIDATE_NOT_FOUND`, carry `details.reason`:
   `not-a-person` (amendment 9), `not-own`, `content-hash`, and `status` with the status, for anything but
   `needs-promotion` (a recorded outcome included); `not-own` comes before the hash, so nothing is learned of another
   person's records. A consent covering exactly the candidate's sources is `created: false`; one for earlier versions is
   replaced by compare-and-set (`CURATOR_CONFLICT`, retryable, if it changed meanwhile). A consent covers a candidate only
   for exactly its sources at their versions and hashes, given by the caller, who owns every one. Its record's access is
   `principal:<caller>`, its envelope `user-stated` with no hash or `derivedFrom`.
9. **`CallContext.person` (host).** `memory-confirm` mirrors D88 on two host mechanisms: the `require-human` gate, and the
   memory service's own person check, which also withholds the person from a caller with an agent's environment variable
   (D86). A plugin cannot see that check, so the SDK's `CallContext` gains `person`, filled by the host for a compiled
   plugin's command from the same function (`CallServices::person`, which the memory services now share); a component
   (WIT world 1.0.0 unchanged) and a mounted server see `false`. `curator-promote` refuses a call without it, so an agent
   that answers the prompt in a pseudo-terminal with an agent variable set is refused as `memory-confirm` refuses it. Not
   an attestation (D86). `tests/call_person.rs` holds it.
10. **Configuration and pack.** The schema accepts `model` with any value, so a configured model is refused by every
    command with `CURATOR_MODEL_UNAVAILABLE` (before anything is read; `curator-promote`'s terminal prompt comes first,
    as the host asks before any handler) rather than failing the load. The prefix has the knowledge plugin's pattern and
    is refused at load. The pack holds sections 4, 6 and 7's defaults, including step 5's (`quiet_days`, `every_hours`,
    `[reverify]`), with ceilings: `max_records` at most 5000, `max_gets` 500, `max_proposals` 50 (the batch's cap),
    `max_alternatives` 2 to 8, windows 1 to 3650 days, `min_sessions` 1 to 1000; `authorities` lists only `person`,
    `agent`, `tool` and `import`.
11. **Records.** This step writes only `consent` records. The `candidate` record's body (`records::candidate_body`) and
    its reading are here, valid against `curator-record.v1.json` in every status, for step 5's run to write. A call reads
    at most 5000 records of a kind. New codes beside 11.3's: `CURATOR_INVALID` (input), `CURATOR_PRINCIPAL_UNKNOWN`,
    `CURATOR_CONFLICT` (retryable) and `CURATOR_FAILED` (a store failure).
12. **Tests, and the proof against knowledge.** The curator crate depends on no plugin crate, so its `draft.rs` re-derives
    every row of 3.2 from the store's records beside the curator's own drafting, byte for byte. The strongest check is
    in `first-party/tests/curator_drafts.rs`: the curator's own `evaluate` and `draft` code drafts from records the store
    holds, and a pipeline step the host attests to the instance `curator` submits them to the real
    `knowledge-propose-batch`. A scheduled draft, both alternatives of a conflict set and a promotion of the caller's own
    record are stored, a rerun returns them (`created: false`), and the same draft with its copied authority changed, or
    the promotion claiming `scheduled`, is `PROPOSAL_DRAFT_MISMATCH` (`copied-authority`, `mode`). The pipeline belongs to
    a stand-in with the plugin id `curator` until step 5 ships `curator-run`. `umbel-first-party` takes the curator as a
    dev-dependency only; step 7 links it into the binary.

### Amendments from step 5

Step 5 settled these details of sections 2.3, 3.1, 4.6, 6, 7, 9.1, 10.3, 11.1, 11.3 and 13 that the text left open.
None puts the curator in the request path, reads memory beyond the caller's reader filter, writes memory or
knowledge, approves anything or keeps forgotten text; the first refuses where the text was silent, the seventh
removes more than the text said and the ninth declares less. No host `src/` file changed; `schemas/` did (amendments
2, 5, 6 and 7), and `umbel-okf` and the knowledge plugin by two shared derivations (amendments 2 and 5).

1. **The run's steps run only inside the run.** `curator-plan` and `curator-finish` refuse any call the host does not
   attest as a step of the curator plugin's `curator-run` (new code **`CURATOR_RUN_REQUIRED`**, not retryable): a
   person calling them at the command line, and another plugin's pipeline naming them as steps. So no caller takes the
   lock without finishing, prints a plan's drafts (memory text) to stdout, or feeds `finish` invented results. `finish`
   also refuses a `run` that is not the attestation's.
2. **Recovery by derived proposal ids** (7.3). The proposal id is phase 2's derivation, `p-` and 20 hex of SHA-256 of
   `<space>\0<proposer actor string>\0<key>`, now shared as `umbel_okf::draft::proposal_id`, which the knowledge
   plugin's `proposal_id` calls (byte for byte the same; `okf/tests/draft.rs` pins it). Before it returns, `plan`
   records each draft on its candidate record (or review, amendment 5): `status` stays `ready`, `drafts` becomes the
   key's draft number plus one, and the new **`proposal`** field holds the derived id; `finish` sets `drafted` with the
   id the batch answered. `curator-record.v1.json`'s candidate gains `proposal` (null or `p-` and 20 hex), the
   proposal of the latest draft that may be open. Then:
   - a `ready` record whose `proposal` is the id of its key `drafts - 1` and whose candidate renders as recorded (the
     same sources at the same versions, content hash, snapshot and conflict set) is submitted again under that key, and
     the batch returns the stored proposal (`created: false`);
   - otherwise its proposal is withdrawn (`source-changed`; `PROPOSAL_NOT_FOUND` when it was never stored), and the
     candidate is not drafted again in the same run: once `finish` records the withdrawal, the next run drafts under
     the key `drafts`, so no key is used for two drafts;
   - a refusal that may hide a stored proposal under the key (`PROPOSAL_KEY_REUSED`, `PROPOSAL_DRAFT_MISMATCH`) moves
     `drafts` on by one more, so the next run withdraws whatever the key holds and drafts under a new one. Any other
     refusal (such as `PROPOSAL_ALREADY_OPEN`) keeps the key for the next run.

   A draft that may be open keeps its candidate record until it is decided, withdrawn or submitted again, so its
   proposal is never lost from the caller's records. A rejection keeps its record while it is quiet, whatever the live status (a confirmation
   re-settling it), so the same content is not drafted again before `quietUntil`.
3. **What passes from `plan` to `finish`.** The pipeline's batch step also passes `erased = "$steps.plan.erased"`, and
   `finish` takes `{ space, run, plan, results, withdrawals, erased, checkpoint, feed }`: `plan` is `plan`'s
   content-free bookkeeping (each draft's record id, proposal id and key in the batch's order, each withdrawal's, the
   next cursors, the counts and inconsistencies, `plan`'s own checkpoint and the run's start), and the others are the
   batch's `results`, `withdrawals`, `erased` and `checkpoint` (step 3b's amendment 2) and the feed's whole answer. The
   state's cursors (`feedAfter` from the feed's `next`, `memoryAfter`, `scanAfter`, `reviewAfter`) move only when
   `finish` runs and still holds the lock, so a run that stopped part way is read again in full by the next. A `finish`
   that finds the lock taken over records its run and leaves the state to the other run, with the warning **`CURATOR_LOCK_TAKEN_OVER`**
   on its own result.
4. **A confirmation withdraws the draft it replaced.** 9.1's row "`Confirmed`: Nothing" holds for the changes feed (no
   redaction, nothing withdrawn from it). But a confirmation writes a new version, and approve refuses a draft whose
   source is not at its cited version (8.2), so the re-check, which reads each source with `memory_get`, withdraws it
   with `source-changed`, as any other version change. The candidate re-settles from the new version, and the next draft
   cites the raised authority, as 9.1 says the next plan may. A flagged source reads as changed too.
5. **Re-verification's records, checks and scan** (section 6).
   - A new record kind, **`review`**, one per (space, principal, document): `v-` and 20 hex of SHA-256 of
     `<space>\0<principal>\0<document id>`, readable by its principal alone, with `doc`, `op` (`verify` or
     `deprecate`), `baseHash`, `status` (`ready`, `drafted`, `rejected`, `applied`, `refused`, `withdrawn`), `drafts`,
     `proposal`, `at` and `quietUntil`. It is what keeps 6.1's "it has no open proposal" for the caller's own drafts
     (another proposer's open proposal is the batch's `PROPOSAL_ALREADY_OPEN`), quiets a rejected review for
     `quiet_days` and a refused one for `every_hours`, and withdraws a draft whose document changed (`source-changed`).
     The key is `<instance>/<review id>/<drafts>`, and a verify's `staleAfter` counts from `at`, the instant the draft
     was first planned, so a rerun renders the same draft.
   - **`sources-unchanged`** checks every frontmatter `sources` entry with a `resource` that resolves to a document of
     the space and a `contentHash`, and every envelope `derivedFrom` entry of kind `document`; an unreadable cited
     document fails it. **`not-flagged`** is none of the content scan's flags (`hidden-text`, `instruction-like`,
     `schema-invalid`); `broken-links` is `links-resolve`'s, and the structural `fields-limited` and `type-defaulted` are
     not checks.
   - A **deprecated** document is never verified, and is `successor-missing` when it names no successor that resolves
     to a readable document (knowledge-stale's rule). A document that is not deprecated and names one that is readable
     and not deprecated gets the `deprecate` draft first, with `supersededBy` the value as written and one `document`
     evidence entry, the successor at its current hash. The resolution is the knowledge plugin's, now shared as
     `umbel_okf::links::successor`.
   - Verify and deprecate drafts together count toward `reverify.max_per_run`, in document id order, after the
     candidates (4.6). Documents are read under the caller's filter through `documents`, from a rotating cursor
     (`reviewAfter`, a new field of the state record) at most 2000 a run, as `knowledge-stale` bounds its scan.
6. **The report** (7.2). `curator-report.v1.json` gains `checkpoint` (`null`, `clean` or `pending`: `pending` when
   either `plan`'s own checkpoint or the batch's is), so the batch's `PROPOSAL_REDACTION_PENDING` reaches the run's
   answer (step 3b's amendment 8); `refused`, at most 50 `{ code, candidate?, doc?, check? }`, the knowledge plugin's
   refusals of this run's drafts by code; and the counts `deprecate` and `refused`. `remaining` is the work the caps left:
   drafts and withdrawals deferred by `max_proposals`, `reverify.max_per_run` and the batch's caps, plus the readable
   semantic and procedural records the rotating scan did not reach, an upper bound from the store's counts. `finish`'s
   own result also carries the warnings `PROPOSAL_REDACTION_PENDING` and `CURATOR_CANDIDATES_SKIPPED` (counts by
   reason), which reach the journal; only its data is the pipeline's answer. The run record keeps the report.
7. **A consent after a forget keeps no sources.** The host has no record deletion, so step 1's amendment 12 ("the
   consent record is removed") is met by rewriting it as `{ version, kind, id, space, principal, access, by, at,
   erased: true }`, which covers nothing (`curator-record.v1.json` allows it). `plan` erases what the caller's records
   keep of each record the changes feed shows `Erased`, before the batch: each candidate citing one becomes `erased`
   (9.1) and each consent citing one keeps no sources; each rewritten record's earlier hashes are forgotten
   (`record_forget_history`, step 3b's amendment 13) and a reporting checkpoint runs (`truncate_wal`), so the source's
   hash is gone from the document store's bytes. A run names at most 400 erased records to the batch (its cap) and reads
   at most 5000 changes; the rest wait for the next run, whose cursor has not moved.
8. **The batch's caps are `plan`'s.** A run's batch holds at most 50 drafts, 50 withdrawals and 400 distinct cited
   memory records, so it is never refused whole with `PROPOSAL_BATCH_TOO_LARGE`; what does not fit is `remaining`.
9. **Grants and effects.** The curator does not declare `graph`: re-verification reads documents only, through
   `documents` (step 4's amendment 1 deferred the choice to this step), so it holds one grant less than D90 lists. No
   grant is added: `doc_list`, `doc_get` and `memory_counts` are under `documents` and `memory`, `record_forget_history`
   and `truncate_wal` under `records_write`. `curator-run`'s effects are `store-write` alone: no step writes the
   workspace, so 3.1's `workspace-write` is dropped.
10. **Shared memory, one open draft.** The knowledge plugin's `PROPOSAL_ALREADY_OPEN` holds across proposers (step 3b's
    amendment 4), so while one person's draft of a shared record is open, another's run is refused for it and reports
    `refused` with that code; it drafts once the first is decided. A candidate drafted alone that later joins a conflict
    set is reported `conflict-after-draft` by every run while its draft is open.
11. **`draft::item` leaves out `confidence`** when no source asserts one. Step 4 wrote `null`, which the batch's input
    schema refuses (`type: number`), and step 3c's amendment 5 says a draft claims none.
12. **`curator-status`** returns `{ space, principal, at, lastRun, overdue, overdueAfter, locked, promotable, promoted,
    invalidatable }`: the last run record's report, `overdue` (also when no run of the caller's ever finished), the
    caller's lock while it is held, the needs-promotion candidates whose sources are all the caller's, the promoted ones,
    and the caller's own live sources of applied candidates. It is `inspect` and writes nothing.
13. **Tests.** In `plugins/curator/tests`, with a stand-in for the knowledge plugin's batch and feed in their shapes
    (`support/knowledge.rs`; the crate links no plugin, D3), whose stubs hold ids and never text: `run.rs` (7),
    `feedback.rs` (6), `forgotten.rs` (7), `reverify.rs` (5), `deterministic.rs` (3), `poisoning.rs` (5) and
    `not_request_path.rs` (7, through the host's MCP server on every lane, the same server the binary serves on stdio).
    Against the real knowledge plugin, `first-party/tests/curator_run.rs` (5): drafts verified and stored, a rejection
    and an apply read back, a forgotten source redacted with its text and hash gone from the store's bytes, verify and
    deprecate drafts accepted, and a pipeline whose step is `knowledge-approve` refused (`CONFIRMATION_REQUIRED`) even
    when a person answers yes.

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
| 2026-11-03 | A host hook for plugin configuration checks that need the workspace: a knowledge drafter target's collection exists, is markdown and is one the instance may write. Today these fail closed per draft, with `PROPOSAL_DRAFTER_TARGET_INVALID` or `PROPOSAL_APPLY_UNAVAILABLE`, not at load (step 3c, amendment 14); a run now reports each such refusal by code in its report's `refused` (step 5, amendment 6). Pair it with the doctor API above | Phase 4 step 7, before real use |
| 2026-11-03 | A `MemoryMeta` projection with `contentHash` and `observations`, if `max_gets` proves too small (4.1) | When a deployer asks |
| 2026-11-03 | A memory retrieval eval before ranking candidates beyond fixed rules | After phase 4 |
| 2026-11-03 | Phase 3's follow-up on sharing writers closing others' records bears on 9.2's listed invalidations | Owner, before phase 5 |
