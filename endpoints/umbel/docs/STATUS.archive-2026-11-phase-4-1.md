# Umbel status archive: phase 4, part 1 of 2

Moved verbatim from [STATUS.md](STATUS.md) on 2026-11-23 ([#1803](https://github.com/lushly-dev/afd/issues/1803)), which is the index and the
current record. A line here keeps the wording it had when it was moved and is not updated after:
a status recorded here may have changed since, though the detail of a phase still open (its
decisions, what its exit has not proven) still applies unless the index or the phase's
specification says otherwise. A link to `#heading` in a moved line named a heading of STATUS.md as
it stood then; the heading is in this file or, through "Headings in other files" at the end, in
another archive file, which the index lists under [Archive](STATUS.md#archive). A moved line is
never edited; a change of status goes in the index.

## Phase detail

### Phase 4. Curator

- **State:** specification approved 2026-11-03, under the owner's 2026-10-31 delegation, with the owner's
  answers of 2026-11-03 (D24), after an independent review and a revision, and merged in
  [#749](https://github.com/lushly-dev/afd/pull/749) as `4a9462c0`; step 1 done 2026-11-03 in
  [#751](https://github.com/lushly-dev/afd/pull/751), merge commit `e7aeff70`; step 2 done 2026-11-03 in
  [#753](https://github.com/lushly-dev/afd/pull/753), merge commit `83639abb`; step 3a done 2026-11-03 in
  [#754](https://github.com/lushly-dev/afd/pull/754), merge commit `37af26c9`; step 3b done 2026-11-03 in
  [#763](https://github.com/lushly-dev/afd/pull/763), merge commit `4a6b2de4`; step 3c done 2026-11-03 in
  [#765](https://github.com/lushly-dev/afd/pull/765), merge commit `7e52e337`; step 4 done 2026-11-03 in
  [#767](https://github.com/lushly-dev/afd/pull/767), merge commit `0d46a9a0`; step 5 done 2026-11-03 in
  [#768](https://github.com/lushly-dev/afd/pull/768), merge commit `9ea18e73`; step 6 done 2026-11-03 in
  [#770](https://github.com/lushly-dev/afd/pull/770), merge commit `6e1c0a0a`; step 7 done 2026-11-03 in its pull
  request, and with it **phase 4 is done: the exit criterion is met** (below). Last verified 2026-11-03 against
  `main` at `6e1c0a0a` with step 7's scoped tests, clippy and the tooling tests on the owner's Mac (below).
- **Done:** [the specification](phases/4-curator/spec.md), with D90 to D105 and amendments to the
  architecture's curator component row, proposal and manifest interfaces, phase table (proposal record
  version 2), phase specification list, phase 5 row and prerequisites table (the MCP relay moved to phase 5),
  versioning list and glossary; and every step of its plan, 1 to 7 (below), the last meeting the exit criterion.
- **Findings that shaped it:** `proposal.v1.json` is closed with `policy.rule` constant `person`, so the
  curator's fields need proposal record version 2; records are namespaced per plugin instance, so the
  curator reaches proposals through a pipeline it ships as data, attested by a host table keyed by random
  step trace ids; every pipeline was registered on every surface and returned every step's data, hence
  D105; the CLI is always `human:<local_id>`, so authorship of a draft comes from its sources; memory is
  private by default, so drafting it for a shared collection would disclose it before approval.
- **Review, 2026-11-03:** an independent review raised 33 findings (blockers: `curator-run` listed over MCP;
  forgotten memory surviving in content-derived ids, paths, keys and hashes). Each was checked against the
  code: 31 hold and were fixed, 2 hold in part; the spec's Review response table records each.
- **Owner's decisions, 2026-11-03, final; do not ask again** (spec section 16: the recommended option on 1 to 9,
  and "attest and verify" on 10, corrected by the owner before commit from "attest and trust"):
  1. Auto-approval: one narrow rule, `deprecate-declared`, off by default per area, only on bytes an applied
     proposal wrote, never for content (D98).
  2. No MCP approval relay in phase 4; the Rust relay and Umbel's use of it move to phase 5 (D99).
  3. No model (D100).
  4. Memory is read only under the caller's reader filter; no derivation reads (D101).
  5. Private records are widened only by their owner at a terminal, with `curator-promote` (D94).
  6. Self-approval of a draft compares the approver with `promotedBy` and every source's principal (D102).
  7. A forgotten source withdraws and redacts an open draft; knowledge holds `memory`, read only, so approve
     refuses a proposal whose source is gone (D103).
  8. The curator never writes memory (D104).
  9. Only `person` authority settles by default; a pack may widen it to `agent`, `tool` or `import`, never
     `transcript` (D93).
  10. Attest and verify: the host attests a step's drafter, and the knowledge plugin verifies every claim of a
      listed drafter against the memory store and the shared rendering, refusing a mismatch with
      `PROPOSAL_DRAFT_MISMATCH`; what cannot be verified is stated in the spec's 3.2 (D91).
- **Step 1 done (2026-11-03, merged in [#751](https://github.com/lushly-dev/afd/pull/751) as `e7aeff70`), shapes:**
  - The four schemas of section 2 with examples: `proposal.v2` (6 examples: drafted, applied, promoted, redacted,
    policy, withdrawn), `plugin-manifest.v4` (2: every key, none), `curator-record.v1` (7: the four kinds, with an
    erased and a rejected candidate and a held lock) and `curator-report.v1` (2). Each is closed; the proposal's
    conditionals hold what a drafter attests (memory evidence, a memory `derivedFrom`, a `conflictSet`, a drafter's
    withdrawal need a `drafter`), the state and withdrawal rules, decision channels, and what a redaction leaves.
  - Manifest version 4, parsing and validation only, in `src/plugins/manifest/v4.rs`: `confirm_preview` (needs
    `confirm_prompt`; names an `inspect` command of the same plugin with CLI exposure, a `journal`, no prompt or
    approval of its own, `returns` exactly `{ preview: string }` closed, and only input properties the gated command
    declares; schemas in files are checked at load), refused on component commands, mounted tools and pipelines;
    a pipeline's `expose` (`mcp`, `agent`, `cli`, a command's defaults, no `palette`) and `result` (`steps` or
    `last`). Stored on `CommandDecl.confirm_preview`, `PipelineDecl.expose` and `PipelineDecl.result`
    (`PipelineResult`); versions 1 to 3 refuse the keys and keep every pipeline exposed everywhere with every
    step's data. Nothing acts on them: the seal check of a pipeline's exposure and `result` in the handler are step 2's.
  - Versions: `MANIFEST_VERSION = 4`, `MANIFEST_VERSIONS = [1, 2, 3, 4]`, `PROPOSAL_VERSION = 2` (the newest; the
    knowledge plugin still writes version 1 until step 3a) with `PROPOSAL_VERSIONS = [1, 2]`, and `CURATOR_VERSION =
    1`; `workspace-show` reports `manifest` `[1, 2, 3, 4]`, `proposal` `[1, 2]` and `curator` 1. The
    unsupported-version message names "manifest versions 1 to 4".
  - `spec/plugin-manifest.md`'s P3 lists `confirm_preview`, and a pipeline's `expose` and `result`, as Umbel's from
    manifest version 4, and `scripts/plugin-manifest.test.mjs` expects them from version 4 on. Because `spec/`
    changed, the affected scope is wider than Umbel.
  - Tests: `tests/manifest_v4.rs` (14 tests) and `tests/schemas.rs` extended through `tests/schemas/phase4.rs` (10
    tests; 47 in the suite). Older tests updated for the version bump: `manifest.rs`, `manifest_v2.rs` and
    `manifest_v3.rs` (version 5 is now the unsupported one, "versions 1 to 4", `set manifest_version = 4`),
    `access_filter.rs` and `plugin_commands.rs` (`workspace-show`'s versions).
  - Fourteen [amendments](phases/4-curator/spec.md#amendments-from-step-1), none touching the trust model; among
    them a candidate's `subjectKey` kept as a digest and the consent record removed after a forget, so no curator
    record keeps memory text or an erased source's hash, and the envelope's `contentHash` redacted with `changeHash`.
  - No plugin changed, so no `Plugin-isolation-exempt:` line is needed. `manifest.rs` was already over 1,000 lines
    (2,021) before this step; version 4's code went into the new `manifest/v4.rs` (224 lines), and `manifest.rs`
    grew by 34 lines to 2,055 for the struct fields and the shared versioned-keys helper.
- **Step 2 done (2026-11-03, merged in [#753](https://github.com/lushly-dev/afd/pull/753) as `83639abb`), host:**
  - Pipeline attestation (section 10.1, D91), in the new `src/plugins/attestation.rs`. A pipeline's handler gives
    each step a fresh random 128-bit trace id from the operating system's random source, never the clock, in
    place of AFD's predictable `<pipeline id>-step-<i>`. It records `{ plugin, instance, pipeline, run, command }`
    in the host's `PipelineAttestations` table, keyed by that trace id, and a guard removes the entry when the step
    returns, fails, panics or is cancelled. `CallServices::pipeline()` reads it only for the call's own trace id,
    only for the command the entry names and only for one of the instance's own commands; nothing is read from
    `extra`. The SDK's `CallContext.pipeline: Option<PipelineAttestation>` is filled from it for compiled
    plugins. Components (WIT world 1.0.0 unchanged) and mounted servers never see it.
  - A manifest version 4 pipeline is registered with its own `expose`. At seal, one exposed to an interface that a
    step is not exposed to is `PLUGIN_MANIFEST_INVALID` at `pipelines[i].expose`, naming the interface and the step.
    Versions 1 to 3 keep every surface, unchecked, so `knowledge-refresh` is unchanged. `result = "last"` returns,
    and journals in the pipeline's own entry, only the last step's data.
  - The CLI's confirmation preview (section 8.1, D97), in the new `src/cli/preview.rs`. Before the gated prompt the
    CLI runs the `confirm_preview` command with only its declared properties, under a fresh trace id, without the
    marks. At a terminal it shows the text on stderr through a new `Console::show`: each line prefixed `> `,
    sanitised (controls, U+2028, U+2029, bidirectional controls), capped at 6000 characters with
    `(N lines not shown)`. A failed or misshapen preview refuses with `CONFIRMATION_PREVIEW_FAILED` and nothing
    runs. Nothing changes on MCP.
  - `secure_delete=ON` on every `store.sqlite3` connection, with `StoreInfo.secure_delete`. A new
    `SqliteStore::truncate_wal()` runs `wal_checkpoint(TRUNCATE)` with no lock wait and reports
    `WalCheckpoint::Clean` or `Pending`; the trait's best-effort checkpoint is unchanged.
  - Tests: `tests/pipeline_attestation.rs` (6), `tests/pipeline_expose.rs` (7), `tests/cli_confirm_preview.rs` (9)
    and `store-embedded/tests/secure_delete.rs` (4, with a control without `secure_delete`). `tests/manifest_v4.rs`
    (14) has its seal test changed: a wide version 4 pipeline is now refused. There are 5 new unit tests (the
    table, the rendering). The related suites `contexts_pipelines` (10), `confirmations` (9),
    `cli_authority_prompt` (7), `require_human` (8) and the embedded `sqlite` (7) pass unchanged.
  - Ten [amendments](phases/4-curator/spec.md#amendments-from-step-2), none touching the trust model. Two make
    things fail closed where the text was silent: a step never runs under a clock-drawn trace id, and a failing
    preview refuses even where no prompt is asked.
  - No plugin crate changed (the SDK and the embedded store are not plugins), so no `Plugin-isolation-exempt:` line
    is needed. `src/plugins/manifest.rs` is untouched; `src/plugins/loader.rs`, already over 1,000 lines, grew by 15
    lines to 1,510.
  - Verified 2026-11-03 on the owner's Mac: `cargo fmt --all --check`; `cargo clippy --locked --workspace
    --all-targets -- -D warnings`, and `-p umbel --lib --no-default-features` alone and with `mounted` and with
    `component`; the scoped tests above. No script or workflow changed, so the tooling tests were not rerun.
- **Step 3a done (2026-11-03, merged in [#754](https://github.com/lushly-dev/afd/pull/754) as `37af26c9`), knowledge:
  record and journal:**
  - Proposal record version 2 (section 2.1, D92), in `plugins/knowledge/src/proposal/model.rs`. Every new proposal
    is version 2: `drafter`, `conflictSet`, `withdrawal` and `redacted` null, `decision.channel = "terminal"` on a
    person's decision, a proposer's withdrawal recorded as `{ by: "proposer", reason: "retracted", at }`, and
    envelope version 2 both in the body's `provenance` and on the stored record. A version 1 record is read, retried
    by key, decided, withdrawn and applied, and stays version 1 with none of version 2's keys. A record of another
    version reads as absent. `knowledge-propose` refuses memory evidence (`PROPOSAL_EVIDENCE_INVALID` in the
    handler, behind the schema's `VALIDATION_ERROR`).
  - The knowledge manifest at version 4. Section 11.2's digest set: `knowledge-proposal-list` (keeping its
    filters), `-proposal-show`, `-proposal-preview`, `-approve`, `-reject` and `-withdraw` (keeping `space` and
    `proposal`). `knowledge-propose`, `-verify` and the read and index commands stay plain. No result's
    `dev.umbel/provenance` carries `derivedFrom`. `knowledge-refresh`, now a version 4 pipeline, seals with every
    surface, since both its steps have them.
  - `knowledge-proposal-preview { space, proposal }` (section 8.1, D97), in the new `src/proposal/preview.rs`:
    inspect, CLI only, digest-journaled, returning exactly `{ preview }`. It renders the id, version, state, op,
    document, area, change hash, proposer, flags and conflict set; the drafter's host-attested fields apart from the
    ones verified against memory; each evidence entry, a memory entry's copied fields labelled "verified against
    memory at submission" and its counts and the settling instant labelled "drafter's policy"; the line "widens
    readers: sources private to `<principal>`" for a promoted draft; and the diff's first 80 lines with a count of
    the rest. Untrusted single-line values are JSON-quoted and diff lines prefixed `| `. It applies approve's reader
    rules, now one function shared with approve's gate. `knowledge-approve` and `knowledge-reject` declare it as
    `confirm_preview`; `knowledge-verify` declares none (8.1). Approve's prompt is now "Apply this proposal to the
    knowledge base?".
  - Tests: `plugins/knowledge/tests/proposals_v2.rs` (4), `preview.rs` (8) and `journal_modes.rs` (2), with
    `tests/support/records.rs`, which writes version 1 and drafted version 2 records straight through the document
    store and validates every stored body against its schema. `proposals.rs` changed in one test: approving a
    proposal the person cannot read now stops at the preview with `CONFIRMATION_PREVIEW_FAILED`, cause
    `PROPOSAL_NOT_FOUND`, before any prompt. The scripted terminal records what `Console::show` shows.
  - A fault in step 1's `schemas/proposal.v2.json`, fixed: its "a drafter's withdrawal needs a drafter" rule matched
    a `null` withdrawal, so every undrafted pending version 2 record was refused. `tests/schemas/phase4.rs` now holds
    the case.
  - Twelve [amendments](phases/4-curator/spec.md#amendments-from-step-3a), none touching the trust model.
  - Closes phase 2's "must do before real use" follow-up: the person approving or rejecting at a terminal sees the
    proposal and its diff before the prompt (follow-ups below).
  - No host `src/` or `wit/` file changed. `schemas/proposal.v2.json` did, for the schema fault, with
    `tests/schemas/phase4.rs`; the plugin-isolation check counts `schemas/` as host code, so the pull request
    carries a `Plugin-isolation-exempt:` line naming that fix. The README's knowledge section describes the preview.
  - Verified 2026-11-03 on the owner's Mac: `cargo fmt --all --check`; `cargo clippy --locked -p umbel-store -p
    umbel-store-embedded -p umbel-okf -p umbel-scan -p umbel-plugin-sources-filesystem -p umbel-plugin-knowledge
    --all-targets -- -D warnings` and the same for `-p umbel-plugin-knowledge --no-default-features`; the knowledge
    job's `cargo test` (477 tests in 60 suites, `eval_gate` with the baseline untouched) and `-p
    umbel-plugin-knowledge --no-default-features` (181 in 24); the host's `schemas` test (47). No script or workflow
    changed, so the tooling tests were not rerun.
- **Step 3b done (2026-11-03, merged in [#763](https://github.com/lushly-dev/afd/pull/763) as `4a6b2de4`),
  knowledge: the drafted path:**
  - `[plugins.knowledge.config] drafters` (default `[]`; a table with each drafter's targets since step 3c's
    amendment 14), read in `plugins/knowledge/src/proposal/attest.rs`: a
    call's `CallContext.pipeline` is accepted only from a listed instance; an attested step of any other is
    `PROPOSAL_DRAFTER_NOT_ALLOWED` for the whole call.
  - `knowledge-propose-batch` (every surface, `store-write`, digest keeping `space`), in `src/proposal/batch.rs`: up
    to 50 proposals and 50 withdrawals and 400 distinct memory sources (`PROPOSAL_BATCH_TOO_LARGE`), a result per
    item, withdrawals first. Each proposal is `knowledge-propose`'s validation, now `propose::submit`. Without an
    attestation it is an ordinary batch: drafter claims, memory evidence, a `derivedFrom`, a conflict set and
    withdrawals are `PROPOSAL_EVIDENCE_INVALID` per item. A listed drafter's proposals carry the attestation as
    `drafter` (`mode = "scheduled"`) and are `agent-inferred`; a retry must repeat the drafter's claims (else
    `PROPOSAL_KEY_REUSED`); `PROPOSAL_ALREADY_OPEN` for a document, or a memory source, with an open proposal.
  - **The memory-evidence refusal (owner decision 10's sequencing):** until step 3c verifies a drafter's claims
    against the memory store, a listed, attested drafter's memory evidence, memory `derivedFrom`, candidate,
    promotion, conflict set and create or update content are refused with the new code
    **`PROPOSAL_DRAFT_UNVERIFIABLE`**, `details.claim` naming the claim; only `verify` and `deprecate` drafts
    citing other evidence are stored, and the preview labels them "checked at submission: it cites no memory
    record", never "verified against memory". Nothing labelled as verified against memory can be stored before
    the verification exists. Step 3c lifts it.
  - A drafter's withdrawal and redaction, in `src/proposal/redact.rs`: only of a proposal whose `drafter` is the
    attested instance and whose proposer is the caller; `source-erased` always redacts (9.1's fields, and also
    the rationale, every excerpt, a verify's note, a rejection's reason and the stored envelope's
    `derivedFrom`), idempotently. **Every draft that was not applied is redacted** when its source is erased
    (decided by the owner for the stronger guarantee): a pending one is withdrawn and redacted; a withdrawn one
    (by the drafter or its proposer), a rejected one and an approved one whose apply never landed are redacted
    in place, keeping their decision or withdrawal; an applied one never is. A drafter reaches them by id
    (`redact: true`) or by the new **`erased`** notice of memory record ids, which redacts each of its own
    non-applied drafts citing one. `proposal.v2.json` now allows `redacted` in those states. Approve refuses a
    redacted draft with `PROPOSAL_SOURCE_GONE`.
  - **No earlier body hash of a redacted draft is left in the change log** (decided by the owner for the stronger
    guarantee): a new store method, `DocumentStore::forget_record_history`, and host service,
    `HostServices::record_forget_history`, null the `changes` rows' hashes of the record's earlier versions,
    under `secure_delete`, before the checkpoint. A drafted proposal's reject and withdraw results no longer put
    the record hash in `dev.umbel/provenance`, so neither the journal nor the events keep it.
  - The checkpoint's `Pending` state carried through (step 2's amendment 9): a new compiled-only host service,
    `HostServices::truncate_wal` (SDK `Cx::truncate_wal` and `WalCheckpoint`; `CallServices::svc_truncate_wal`),
    runs `SqliteStore::truncate_wal` under `checkpoint`'s rules. The batch reports `checkpoint: "clean"` or
    `"pending"` after a redaction or a forgotten hash, and `pending` warns `PROPOSAL_REDACTION_PENDING`
    (store-check finishes it).
  - `knowledge-proposal-feed` (CLI only, `inspect`, digest keeping `space` and `after`), in `src/proposal/feed.rs`:
    refuses without an accepted attestation; the rejected and applied decisions on the attested drafter's
    proposals of the caller after a revision, from the change log, with `next` and `more`.
  - Approve: a drafted proposal's document is `agent-inferred`; its authorship stays phase 2's rule until step 3c
    reads the sources (the runner approving a draft is self-approval, stricter than 8.2).
  - Tests: `plugins/knowledge/tests/drafted.rs` (10) and `redaction.rs` (11: each state redacted by the notice and
    by id, applied untouched, the change log's and the journal's earlier hashes gone), with stand-in drafters in
    `tests/support/drafter.rs`; `journal_modes.rs` gains the batch and the feed in the digest set; `preview.rs`'s
    redaction line names the rationale. Store: `store-embedded/tests/secure_delete.rs` gains the change log's
    earlier hashes gone from the raw bytes. Host: `tests/store_truncate_wal.rs` (3: both services), with
    `truncate-wal` and `record-forget-history` ops in `tests/support/store.rs`; `tests/schemas/phase4.rs` holds the
    widened redaction rule. `umbel-store-embedded`'s `testkit` feature gains `SqliteStore::hold_reader`.
  - Thirteen [amendments](phases/4-curator/spec.md#amendments-from-step-3b), none weakening the trust model; 12 and 13
    close the step's two questions for the stronger guarantee. 11.3 gains `PROPOSAL_DRAFT_UNVERIFIABLE` and the
    warning `PROPOSAL_REDACTION_PENDING`.
  - **Host, store and schema code changed:** `src/plugins/store_services.rs` and `src/plugins/grants.rs` (the two
    services), `sdk/src/` (the trait methods and `WalCheckpoint`), `store/src/traits.rs`
    (`DocumentStore::forget_record_history`, implemented by the embedded store and the store tests' fake),
    `store-embedded/src/` (that method, and the testkit hold), `schemas/proposal.v2.json` (the redaction rule),
    with `tests/`. No `wit/` file changed. The pull request needs a `Plugin-isolation-exempt:` line naming the two
    services, the store method and the schema rule.
  - Verified 2026-11-03 on the owner's Mac: `cargo fmt --all --check`; the knowledge job's clippy (`-p umbel-store -p
    umbel-store-embedded -p umbel-okf -p umbel-scan -p umbel-plugin-sources-filesystem -p umbel-plugin-knowledge
    --all-targets -- -D warnings`) and `cargo test` (499 tests in 62 suites, `eval_gate` with the baseline
    untouched); `-p umbel-plugin-knowledge --no-default-features` clippy and tests (202 in 26); `cargo clippy -p umbel
    -p umbel-sdk -p umbel-store --all-targets -- -D warnings`, `-p umbel --lib --no-default-features` and `-p
    umbel-sdk --all-features --lib`; the host's `schemas` (47), `store_truncate_wal` (3) and `store_grants` (23). No script or workflow changed,
    so the tooling tests were not rerun; the full gate is the owner's.
- **Step 3c done (2026-11-03, merged in [#765](https://github.com/lushly-dev/afd/pull/765) as `7e52e337`, from `4a6b2de4`), knowledge: verifying drafts:**
  - `umbel_okf::draft` (the new `okf/src/draft.rs`): section 4.5's fixed rendering, byte for byte, with every value
    escaped onto its one line; the fixed rationale and its exact inverse; `subject_key` and its digest; the candidate,
    conflict-set and document ids; the idempotency key `<instance>/<candidate>/<drafts>`; the excerpt; the settling
    instant read back from a rendering. Shared, so the curator (step 4) renders and the knowledge plugin re-renders,
    neither depending on the other.
  - The knowledge plugin declares `memory`, **read only and optional** (owner decision 7), and therefore a `journal` on
    every command and pipeline (phase 3 section 2.3): the read and index commands, `knowledge-propose`, `-verify` and
    `knowledge-refresh` say `plain`, as they behaved; the digest set is unchanged. A read grant needs no `allow` list,
    so the README's example `umbel.toml` is unchanged; the README says so, and how to deny it.
  - **Every check of section 3.2**, in the new `src/proposal/checks.rs` and `src/proposal/sources.rs`, against the
    memory store read once per batch under the batch caller's reader filter (owner decision 4; never a derivation
    read) and against `umbel_okf::draft`: source exists (`source-missing`, `source-not-live`, `source-flagged`,
    `source-class`), version (`source-version`, `source-hash`), copied fields (`copied-principal`, `-class`,
    `-authority`, `-origin`, `-constraints`, `-access`, `-sensitivity`, `-confirmation`) and `confidence`, `counts`,
    `group`, `excerpt`, `content`, `candidate`, `document`, `conflict-set`, widening and mode (`mode`, `promoted-by`,
    `sensitivity`) and `generated-at`. Each refuses its item with `PROPOSAL_DRAFT_MISMATCH`, `details.check` naming it,
    and nothing stored. Six checks the table did not name close the paths a drafter's free text could outlive a
    redaction or claim what is not so: `source-authority`, `evidence`, `derived-from`, `rationale`, `key`, `run`.
  - Step 3b's `PROPOSAL_DRAFT_UNVERIFIABLE` is lifted claim by claim. It stays only for what this instance cannot
    verify: memory claims with the `memory` grant withheld (at submission and at approve), memory evidence on an op
    other than `create`, and a create or update citing no memory record. A candidate, promotion, conflict set or
    `derivedFrom` on a draft citing no memory is a mismatch.
  - A replayed batch with a tampered copied field is verified before it is called `PROPOSAL_KEY_REUSED`, so it is
    `PROPOSAL_DRAFT_MISMATCH` naming the field (section 13, point 1); an identical retry still returns the stored draft.
    `PROPOSAL_ALREADY_OPEN`'s memory-source half is exercised, and a verified conflict set's alternatives do not block
    each other.
  - A verified draft stores its `derivedFrom` (kind `memory`) in the body and the record's envelope; later saves keep
    it, and only a redaction removes it. No result's `dev.umbel/provenance` carries it.
  - **Approve (section 8.2):** re-checks the target against the copied access and sensitivity
    (`PROPOSAL_ACCESS_WIDENED`; a promotion against the target's readers at submission), then each source under the
    approver's filter (`PROPOSAL_SOURCE_GONE`; a changed copied field is `PROPOSAL_DRAFT_MISMATCH`). **Authorship and
    self-approval come from the store:** the approver against every source record's principal and `promotedBy`. The
    runner is no longer compared, so step 3b's interim rule ends: a draft of another person's shared memory, and a
    drafted `verify` or `deprecate`, are approved by the runner with no exception.
  - The drafter's "erased" claim is checked: a draft is redacted only once the store no longer holds a named source
    (`source-erased` otherwise), which can never keep forgotten text.
  - The preview's "verified against memory at submission" label now covers only fields a 3.2 check verified; the
    sessions and settling instant stay "drafter's policy".
  - Tests: `okf/tests/draft.rs` (10) and `plugins/knowledge/tests/verify_drafts.rs` (20: each row of 3.2 and the added
    checks, the exact target path and an unsafe prefix refused at load, a faithful draft and its preview, widening by the owner accepted and by others refused, the tampered
    replay, the source half of `PROPOSAL_ALREADY_OPEN`, the withheld grant, the "erased" claim, approve's repeat after a
    source or the target changes), with `tests/support/memory.rs`, which writes memory records through the store.
    `drafted.rs` (11): the 3b refusal test now holds what stays refused, and approve's authorship from the store.
    `journal_modes.rs` approves a verified draft and holds the `plain` journals and the optional grant. `redaction.rs`
    redacts a verified draft after its source is forgotten, and refuses to redact a memory-free draft as erased. The
    knowledge crate's tests enable `umbel-store`'s `conformance` feature for its memory samples; no crate is added.
  - **The drafter's target (amendment 14, settled under owner decision 10).** `drafters` is now a table keyed by
    instance, with `targets` per space: `[plugins.knowledge.config.drafters.curator.targets.main]` with `collection`
    and an optional `prefix`. The configuration schema holds the shape and a safe prefix at load
    (`PLUGIN_CONFIG_INVALID`; `umbel_okf::draft::is_safe_prefix`), and every drafted create checks the collection is
    a markdown collection of the space (`PROPOSAL_DRAFTER_TARGET_INVALID`). A drafted create must be exactly
    `<collection>/<prefix>/<derived id>` (`umbel_okf::draft::document_id`); anything else, and a create from a drafter
    with no target, is `PROPOSAL_DRAFT_MISMATCH`, check `document`. No drafter-chosen text survives in the path. The
    curator's configuration (step 4) must name the same target; knowledge's entry is the one enforced. Whether the
    knowledge instance may write the collection is not visible to a plugin, so it is not checked at load; an approval
    there stops with `PROPOSAL_APPLY_UNAVAILABLE`.
  - Fourteen [amendments](phases/4-curator/spec.md#amendments-from-step-3c), none weakening the trust model.
  - **No host `src/`, `wit/`, `schemas/` or SDK file changed**, and no script or workflow: only `umbel-okf` and the
    knowledge plugin, so no `Plugin-isolation-exempt:` line is needed. The knowledge manifest's grant change is the
    optional read-only `memory` grant.
  - Verified 2026-11-03 on the owner's Mac: `cargo fmt --all --check`; the knowledge job's clippy
    (`-p umbel-store -p umbel-store-embedded -p umbel-okf -p umbel-scan -p umbel-plugin-sources-filesystem -p
    umbel-plugin-knowledge --all-targets -- -D warnings`) and `cargo test` (530 tests in 64 suites, `eval_gate` with the
    baseline untouched); `-p umbel-plugin-knowledge --no-default-features` clippy and tests (223 in 27); and `cargo
    test -p umbel-first-party` (13 in 7), whose binary links the knowledge plugin. Not run here: the job's MSRV 1.97
    check (the toolchain is not installed on this machine) and the full gate, which is the owner's. No script or
    workflow changed, so the tooling tests were not rerun.
- **Step 4 done (2026-11-03, merged in [#767](https://github.com/lushly-dev/afd/pull/767) as `0d46a9a0`, from `7e52e337`), curator: candidates:**
  - The `umbel-plugin-curator` crate (`plugins/curator`, kind `compiled`, id and domain `curator`, manifest version 4,
    `publish = false`, quarantined in `scripts/release/inventory.json` with no route, with an `architecture.json` row):
    its manifest, the `settle` pack (sections 4, 6 and 7's defaults and the per-call bounds), the `curator-guide` skill
    and the configuration schema (`spaces.<space>` targets with a safe prefix; `model` reserved and refused). Grants:
    `config`, `packs`, `clock`, `memory` (read), `documents`, `records` and `records_write`; no `content`. **No write grant to memory or knowledge** (owner decision 8), and no dependency on
    another plugin crate (`tests/no_plugin_dependency.rs`).
  - A deterministic, public core: `settle` (eligible records under the pack, groups by content hash and class, the
    window by class, sessions, authority `person` by default and widened only by the pack, never `transcript`,
    flags, liveness, the confidence gate), `access` (section 5.1, token by token, sensitivity first), `conflicts`
    (section 4.4's sets and alternatives), `evaluate` (every status, merged with the caller's records) and `draft`
    (a candidate as a `knowledge-propose-batch` item through `umbel_okf::draft`). Memory is read only under the
    caller's reader filter (owner decision 4), with `memory_list` then `memory_get`, bounded by `max_records` and
    `max_gets` and counted.
  - `curator-candidates` (inspect) and `curator-promote` (`require-human`, own records only, the content hash as proof
    of looking, only `needs-promotion`, sensitivity never overridden), both CLI only and digest-journaled with
    `keep = ["space"]`. Promotion writes a `consent` record readable by its owner alone; candidate records' bodies
    are built and read here for step 5 to write. No result, record or journal entry holds memory text.
  - **Proof that drafts pass the knowledge plugin's verification:** `plugins/curator/tests/draft.rs` re-derives every
    row of section 3.2 from the store's records beside the curator's drafting, byte for byte, and
    `first-party/tests/curator_drafts.rs` submits the curator's own drafts to the real `knowledge-propose-batch` under
    the host's pipeline attestation: a scheduled draft, both alternatives of a conflict set and a promotion are stored,
    a rerun returns them, and a tampered copied field or a misclaimed mode is `PROPOSAL_DRAFT_MISMATCH`.
  - Twelve [amendments](phases/4-curator/spec.md#amendments-from-step-4), none changing the trust model. The first
    adds a host service, `readable_collections` under the `documents` grant, returning only the id, kind, access set
    and sensitivity of the collections the caller reads, for section 5.1's target; a target the caller cannot read is
    `CURATOR_TARGET_UNCONFIGURED` (`collection-missing`). It replaced an optional `content` grant, which also carried
    file reads and writes, at the coordinator's request for least privilege. The ninth adds `CallContext.person`
    (accepted).
  - **Host and SDK changed** (`src/plugins/{compiled,grants,memory_services,store_services}.rs`,
    `sdk/src/{cx,component,mounted,store,lib}.rs`, new `tests/call_person.rs` and `tests/readable_collections.rs`): the
    SDK's `CallContext` gains `person`, the host's own person check (D86), so `curator-promote` refuses an agent's
    environment as `memory-confirm` does, and the memory services now share the same `CallServices::person`; and
    `HostServices::readable_collections` (SDK `CollectionMeta`) serves collection metadata under `documents`, filtered
    by the caller's readers. Compiled plugins only; WIT world 1.0.0 and the schemas are unchanged. The pull request
    needs a `Plugin-isolation-exempt:` line. `umbel-first-party` takes the curator as a dev-dependency only.
  - CI: the `memory` job of `umbel.yml` gains `-p umbel-plugin-curator` in its clippy, tests and MSRV check; the
    `check` job's tests exclude it.
  - Tests: `settle.rs` (8), `conflicts.rs` (5), `draft.rs` (6), `access_rule.rs` (7), `promote.rs` (6), `config.rs`
    (9), `no_plugin_dependency.rs` (3) and 8 unit tests in the curator crate; `first-party/tests/curator_drafts.rs` (1);
    the host's `tests/call_person.rs` (2) and `tests/readable_collections.rs` (4).
  - Verified 2026-11-03 on the owner's Mac: `cargo fmt --all --check`; `cargo clippy -p umbel -p umbel-sdk -p
    umbel-plugin-curator -p umbel-plugin-memory -p umbel-plugin-context -p umbel-plugin-knowledge -p umbel-first-party -p
    umbel-hook --all-targets -- -D warnings`, `-p umbel --lib --no-default-features` (alone, with `mounted`, with
    `component`), `-p umbel-sdk --all-features --lib`, the mounted SDK and `hello-mcp`, and the components for
    `wasm32-wasip2`; the `memory` job's tests with the curator (259 tests in 51 suites); the SDK's and the host's unit tests with the host's `readable_collections`, `call_person`, `require_human`, `cli_authority_prompt`, `memory_grants`, `pipeline_attestation`, `pipeline_expose`, `plugin_compiled`, `grants`, `store_grants`, `store_truncate_wal`, `schemas`, `manifest_v4` and `cli_confirm_preview` (295 tests in 18 suites); and
    `node scripts/run-tooling-tests.mjs` (305). Not run here: the job's MSRV 1.97 check (the toolchain is not
    installed on this machine), the knowledge job (no knowledge file changed) and the full gate, which is the owner's.
- **Step 5 done (2026-11-03, merged in [#768](https://github.com/lushly-dev/afd/pull/768) as `9ea18e73`, from `0d46a9a0`), curator: runs:**
  - `curator-run`, the pipeline the curator ships as data (section 3.1): `curator-plan`, the knowledge plugin's
    `knowledge-propose-batch` and `knowledge-proposal-feed`, then `curator-finish`. Command line only (`expose = { mcp
    = false, agent = false, cli = true }`), `result = "last"`, digest-journaled, effects `store-write`; it answers
    with `finish`'s report, ids and counts only, so stdout, cron mail and the journal hold no memory text.
    `curator-plan` and `curator-finish` refuse any call the host does not attest as a step of it
    (`CURATOR_RUN_REQUIRED`). `curator-status` reports the last run, `overdue`, the lock, the promotable candidates and
    the records an owner may invalidate.
  - **The lock** (7.3): per (space, principal), taken by compare-and-set for 10 minutes (`CURATOR_BUSY`, retryable),
    taken over once expired, released by `finish` only when it is the run's own (`CURATOR_LOCK_TAKEN_OVER` otherwise).
    The cursors (`feedAfter`, `memoryAfter`, `scanAfter` and the new `reviewAfter`) move only at `finish`.
  - **Recovery** by derived proposal ids: the proposal id derivation is shared as `umbel_okf::draft::proposal_id` (the
    knowledge plugin's own now calls it); `plan` records each draft's id and draft number before the batch, so a run
    that stopped after its batch is completed by the next (`created: false`), and a draft whose candidate changed is
    withdrawn before a new key is used. Never `PROPOSAL_KEY_REUSED`.
  - **The re-check** (9.1, owner decision 7): every draft of the caller's that may be open is re-read at `now`; an
    erased source is redacted and withdrawn through the batch's `erased` notice, and the curator's own candidate and
    consent records keep nothing of it (hashes forgotten in the change log, a reporting checkpoint, `checkpoint` in the
    report); invalidated, expired, confirmed, flagged or unreadable sources withdraw with `source-changed`; applied
    alternatives withdraw the others with `superseded-alternative`.
  - **Feedback** (7.1): a rejection quiets the same content for 90 days, keeping the approver's reason only in the
    caller's own record; an apply marks the candidate `applied`, never drafted again.
  - **Re-verification and inconsistencies** (section 6): `verify` drafts for documents due within `lead_days`, with
    the three checks as evidence; `deprecate` drafts for a resolving successor; `check-failed`, `successor-missing`,
    `target-exists` and `conflict-after-draft` reported. A new `review` record per document keeps the caller's drafts,
    so an open one is not drafted again and a rejected one stays quiet. The successor's resolution is shared as
    `umbel_okf::links::successor`.
  - **Rotating scans and caps**: memory from `scanAfter`, documents from `reviewAfter`, wrapping, so every record and
    document is reached across runs; at most `max_proposals` drafts (candidates in id order, then reviews in document
    id order), 50 withdrawals and 400 cited records per batch; `remaining` says how far behind a run is.
  - **Schemas:** `curator-record.v1.json` gains the `review` kind, a candidate's `proposal`, the state's `reviewAfter`
    and a consent that keeps no sources after a forget (the host has no record deletion); `curator-report.v1.json`
    gains `checkpoint`, `refused` and the counts `deprecate` and `refused`; examples updated and two added, with
    `tests/schemas/phase4.rs`.
  - Thirteen [amendments](phases/4-curator/spec.md#amendments-from-step-5), none changing the trust model. The first
    refuses the run's steps outside the run; the ninth declares one grant less than D90 lists (`graph`, unused).
  - **No host `src/` change.** `schemas/` changed (amendments 2, 5, 6, 7), and `umbel-okf` and the knowledge plugin by
    two shared derivations, byte for byte (`model::proposal_id` and `graph::successor` now call `umbel-okf`), so the
    pull request needs a `Plugin-isolation-exempt:` line naming the schema changes. The curator's `draft::item` no
    longer writes `confidence: null` (the batch's schema refuses it). No script or workflow changed.
  - Tests: curator `run.rs` (7), `feedback.rs` (6), `forgotten.rs` (7), `reverify.rs` (5), `deterministic.rs` (3),
    `poisoning.rs` (5), `not_request_path.rs` (7), with a stand-in for the knowledge plugin's batch and feed
    (`tests/support/knowledge.rs`; the curator crate links no plugin); `config.rs` and two step 4 tests updated; unit
    tests for the state, the bookkeeping, the re-check and the review assessment. Against the real knowledge plugin,
    `first-party/tests/curator_run.rs` (5). `okf/tests/draft.rs` gains the proposal id; the host's
    `tests/schemas/phase4.rs` the new shapes.
  - Verified 2026-11-03 on the owner's Mac: `cargo fmt --all --check`; `cargo clippy --locked -p umbel-okf -p
    umbel-plugin-knowledge -p umbel-plugin-curator -p umbel-first-party --all-targets -- -D warnings` and `-p
    umbel-plugin-knowledge --no-default-features`; the knowledge job's tests (532 in 64 suites, `eval_gate` with the
    baseline untouched), the `memory` job's (311 in 59, the curator and `umbel-first-party` included) and the host's
    `schemas` (47). Not run here: the MSRV 1.97 check (the toolchain is not installed), the tooling tests (no script or
    workflow changed) and the full gate, which is the owner's.
