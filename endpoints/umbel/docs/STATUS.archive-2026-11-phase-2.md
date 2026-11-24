# Umbel status archive: phase 2

Moved verbatim from [STATUS.md](STATUS.md) on 2026-11-23 ([#1803](https://github.com/lushly-dev/afd/issues/1803)), which is the index and the
current record. A line here keeps the wording it had when it was moved and is not updated after:
a status recorded here may have changed since, though the detail of a phase still open (its
decisions, what its exit has not proven) still applies unless the index or the phase's
specification says otherwise. A link to `#heading` in a moved line named a heading of STATUS.md as
it stood then; the heading is in this file or, through "Headings in other files" at the end, in
another archive file, which the index lists under [Archive](STATUS.md#archive). A moved line is
never edited; a change of status goes in the index.

## Phase detail

### Phase 2. Knowledge

- **State:** done 2026-11-01; the exit criterion is met. Specification
  approved and merged in [#625](https://github.com/lushly-dev/afd/pull/625) as
  `e996aad1`; steps 0a to 9 merged the same day and step 10 (the exit) in the
  step 10 pull request. Last verified 2026-11-01 against `main` at `aa0ecda2`
  plus step 10's test. (Superseded: "specification in review, revised, not
  approved; implementation not started", verified at `886c3b4d`.) One thing
  must be done before real use: the `knowledge-approve` confirmation prompt
  cannot show the diff (see the follow-ups; done 2026-11-03 in phase 4 step 3a).
- **Done:** the [specification](phases/2-knowledge/spec.md): store traits
  version 1 with a conformance suite and the embedded backend on SQLite (WAL)
  and tantivy, shared by several processes (D51, closing D28's choice);
  configuration version 3 with collections, space readers and access groups
  (D52); access tokens and reader filters inside every store query (D53);
  the content, document, record, index and graph grants with allow lists,
  derivation reads and manifest version 2 (D54); provenance envelope version
  1 and event version 1 (D55); the `sources-filesystem` plugin and the OKF
  container (D56); compiled first-party plugins and the `umbel-knowledge`
  binary (D57); query syntax and ranking (D58); chunking (D59); the
  structural graph with tree-sitter symbols (D60); locators (D61); proposals
  with approval per area, CLI-only apply (D62); the verification lifecycle
  (D63); output budgets AFD-first (D64); the eval harness and the lane gate
  (D65); the fail-open journal with store cross-checks (D66); content trust
  (D67). Architecture, decision log and trajectory amendments in the same
  pull request. The [revision](phases/2-knowledge/spec.md#revision-2026-11-01)
  fixed all nine must-fix findings (tantivy query parsing and features,
  concurrent indexers, co-citation leaks, access holes in sync, index and
  events, the gate's allow-list, `require-human`, self-approval, the SDK
  seams), the should-fix items and the nits; no finding was rejected.
- **Done:** step 0a, output budgets in AFD (documents only), 2026-11-01:
  the [AFD proposal](../../../docs/features/complete/output-budgets/output-budgets.proposal.md)
  with its [status](../../../docs/features/complete/output-budgets/STATUS.md),
  [`spec/output-budgets.md`](../../../spec/output-budgets.md) (B1 to B8)
  with its cases [`spec/vectors/output-budgets.json`](../../../spec/vectors/output-budgets.json),
  amendments to `command-metadata.md`, `context-fields.md`, `journal.md`,
  `error-codes.md` (`OUTPUT_BUDGET_EXCEEDED`, specified, joining the
  catalog in 0b), `protocol-conformance.md` and `CHANGELOG.md`; parity rows
  Planned in every language. Verified 2026-11-01 against `main` at
  `e996aad1`: current behavior read in the four languages, MCP 2026-07-28
  rules checked; `pnpm check` and the alfred parity tests. The
  specification's [Amendments from step 0a](phases/2-knowledge/spec.md#amendments-from-step-0a)
  record what changed for 0b.
- **Done:** step 0b, the Rust output budgets and the public frontmatter
  reader in AFD, 2026-11-01 ([#633](https://github.com/lushly-dev/afd/pull/633)):
  `CommandDefinition::with_output_budget`, `CommandContext::with_output_budget_ask`
  and `output_budget()`, the check after the handler (an over-budget read is
  `OUTPUT_BUDGET_EXCEEDED`, a mutation keeps its result with a warning), the
  ask in `_meta["dev.afd/outputBudget"]` and the meta-tools' `meta` on every
  route and both MCP eras, per item in batches and per step in pipelines,
  the journal's `outputBudget` with replay, the declaration on tools,
  grouped actions, `afd-detail` and `afd-help`; `OUTPUT_BUDGET_EXCEEDED` in
  the shared catalog, `vectors/error-codes.json` and the TypeScript, Python,
  Rust and C++ constants; `afd::frontmatter::parse` public (feature
  `frontmatter`, on with `server`): `Ok(None)` for no frontmatter, a typed
  `FrontmatterError`, the body's byte offset and line, generic messages, no
  size cap. Verified 2026-11-01: everything `rust.yml` runs plus the
  `frontmatter`-alone leg, `tests/output_budget.rs` over every case of
  `spec/output-budgets.json` (in process, HTTP and stdio, both eras), the Rust
  todo backend with `--locked` and its conformance runs, `cargo test --locked
  --workspace` in `endpoints/umbel`, the Python and C++ error-code tests and
  `pnpm check`. Nine details are in the specification's
  [Amendments from step 0b](phases/2-knowledge/spec.md#amendments-from-step-0b).
- **Step 1 done (2026-11-01, [632](https://github.com/lushly-dev/afd/pull/632)):**
  shapes and configuration, no store, index or plugin code. Nine schemas
  with examples (`workspace-config.v3`, `plugin-manifest.v2`,
  `provenance-envelope.v1`, `event.v1`, `document.v1`, `locator.v1`,
  `proposal.v1`, `eval-queries.v1`, `eval-report.v1`); configuration version
  3 (`collections`, per-space `readers`, `[access.groups]`, `[store]`;
  versions 1 and 2 still open, `content_roots` refused in 3), `umbel init`
  writing 3, the doctor's `collections.roots`; manifest version 2 parsing
  (`store-write` and `workspace-write` with their grants, `output_budget`
  stored, `confirm = "require-human"` with its prompt and CLI-only checks);
  `store` a host domain; envelope and event version 1 (effective principal
  string, `plugin` from the gate's stamp, `access`, `sensitivity`, `changes`),
  with version 0 lines read and rebuilt as written; `workspace-show`'s
  `versions`. Amendments in the specification's [Amendments from step
  1](phases/2-knowledge/spec.md#amendments-from-step-1). Verified 2026-11-01
  in `endpoints/umbel` with `CARGO_TARGET_DIR` shared: `cargo fmt --all
  --check`, clippy `-D warnings` on the workspace and each `umbel.yml` leg,
  `cargo test --locked --workspace` (600 passed), the MSRV check
  (`cargo +1.97.0 check --locked --workspace --all-targets`), `pnpm check`.
- **Step 2 done (2026-11-01, [636](https://github.com/lushly-dev/afd/pull/636)):** the store traits and the SQLite
  stores, no index and no host wiring. `umbel-store`: the types, the three
  traits (`DocumentStore` with records and the change log, `SearchIndex`
  and `GraphStore`), `STORE_TRAITS_VERSION` (the host re-exports it), the
  conformance suite (`conformance::run_all(factory, spawn_writer)`: 48 cases
  in the groups `documents`, `records`, `changes`, `envelope`, `access` over
  the 40-document fixture in `store/fixtures/access/` with an independent
  oracle for three readers, `graph`, `concurrency` and `durability`; the
  index cases report skipped), and the in-memory fake behind
  `tests/suite_detects.rs`, which fails 19 deliberate faults in the cases
  that should catch them and passes when unbroken. `umbel-store-embedded`:
  bundled SQLite (rusqlite 0.41.1, SQLite 3.54.1) in WAL mode with
  `synchronous=FULL`, `foreign_keys`, a bounded busy timeout, `fullfsync`
  on macOS, `BEGIN IMMEDIATE` for every write, short reads that never pin the
  WAL, SQLite's default autocheckpoint and a best-effort `wal_checkpoint(TRUNCATE)`
  hook; documents, records, the change log (one revision sequence, an
  access set per change), the graph (per origin document, readable through
  that document's access, aggregated over readable origins) and the access
  filter as a semi-join inside every statement. Tests: the suite against
  SQLite (`conformance.rs`, including two child processes through
  `spawn_writer`), `multiprocess.rs` (four processes creating one store at
  once, this process beside two others, a writer past the lock timeout in
  this and in another process is `Busy`), `sqlite.rs` (pragmas, newer
  schema refused, wrong space, a damaged file, checkpoint beside a reader)
  and `suite_detects.rs`. The `knowledge` CI job (Linux and macOS) runs
  them; the `check` and `msrv` jobs exclude the SQLite crate so they do not
  build it. Seven amendments in the specification's [Amendments from step
  2](phases/2-knowledge/spec.md#amendments-from-step-2). Cost of bundled
  SQLite, measured 2026-11-01 on this machine (Apple silicon, dev profile,
  fresh target directory): `cargo build -p rusqlite` took 39 s wall and 106
  MB of target (`libsqlite3-sys` rlib 8.8 MB, `rusqlite` rlib 4.4 MB).
  Verified 2026-11-01 in `endpoints/umbel` with `CARGO_TARGET_DIR` shared:
  `cargo fmt --all --check`, clippy `-D warnings` on the workspace and each
  `umbel.yml` leg, `cargo test --locked --workspace`, the MSRV check
  (`cargo +1.97.0 check --locked --workspace --all-targets`), `pnpm check`.
- **Step 3 done (2026-11-01, [643](https://github.com/lushly-dev/afd/pull/643)):** the tantivy index. `umbel-store-embedded`
  gains `TantivyIndex` (`SearchIndex` under `index/v1/`, an `MmapDirectory` with
  LZ4 named in the index settings, `en_stem`, tantivy 0.27 with
  `mmap`, `stopwords`, `stemmer` and `lz4-compression` and nothing else): one
  document per chunk in schema 1, the query builder over the
  `tantivy-query-grammar` AST (fields checked, `access` refused in every
  position, at most 64 clauses, 8 fields, 16 levels, slop 8, boosts in
  (0, 100], 1024 characters; a single trailing `*` is a prefix bounded at 256
  expansions, constant-scored under the field's boost), the reader filter and
  the structured filters as score-less mandatory clauses, four-decimal scores
  with ties resolved by document id and ordinal, highlighted snippets, writer
  sessions on tantivy's own lock (bounded wait, `Busy`; `applied` read under it
  and never lowered, `Conflict`; the commit payload `{applied, schema}`; merges
  finished before the lock is released), reload before each search, checksum
  validation, and `SqliteStore::readable_graph`, the petgraph form cached by
  `(graph applied, head, reader)` in eight entries. The conformance suite gains
  the `index` group (twelve cases) and the two index cases that waited since
  step 2, `run_groups`, and `samples::chunk`: 59 cases, none skipped against the
  embedded backend. Tests: `conformance.rs` (all), `index.rs` (LZ4 and the
  payload, durability, damaged segment found by the checksum, newer schema
  refused, snippets, scores independent of the reader, the writer wait,
  a second handle seeing commits, caps, the petgraph cache),
  `query_syntax.rs` (the grammar's real behaviour: only a trailing star is a
  prefix, escaped stars, meta values as strings, numbers and booleans, dates,
  paths, depth, the error text), `index_suite_detects.rs` (four planted faults
  in the real index fail the cases that should catch them) and
  `multiprocess.rs` (two indexer processes taking turns and never lowering
  either revision, a second process waiting and then `Busy`, a killed indexer
  leaving no stale lock, a run after a crash between the two commits redoing
  only the lagging store). Fourteen amendments in the specification's
  [Amendments from step 3](phases/2-knowledge/spec.md#amendments-from-step-3);
  C1 corrects the revision's claim about the grammar (it marks `prefix` only
  on a quoted phrase). Measured cold on this machine (Apple silicon, `-j4`,
  load average 10 to 18): `cargo build -p umbel-store-embedded` 83 s and 640
  MB; tantivy and the 96 crates it adds took 135 of 188 CPU-seconds
  (`tantivy` 57 s, `tantivy-columnar` 18 s; the `tantivy` rlib is 88 MB), SQLite's
  C build 28 s; the job's steps 205 s and 1.1 GB. The `knowledge` job's timeout
  is 15 minutes (was 45): three times the local 205 s, widened for the
  slower hosted runners (C14). Verified 2026-11-01 in `endpoints/umbel` with
  `CARGO_TARGET_DIR` shared: `cargo fmt --all --check`, clippy `-D warnings`
  on the workspace and each `umbel.yml` leg including the knowledge and wasm
  legs, `cargo test --locked --workspace`, the MSRV checks, `pnpm verify` (the
  repository's `check` and every `umbel.yml` leg a pull request runs).
- **Step 4 done (2026-11-01, [651](https://github.com/lushly-dev/afd/pull/651)):** host services, the first
  step that lets a plugin reach the stores. The ten grants (`content`,
  `content_write`, `documents`, `documents_write`, `records`, `records_write`,
  `index`, `index_write`, `graph`, `graph_write`), held by compiled plugins
  only, scoped to the call's spaces; the five write grants need
  `[plugins.<id>.grants.<grant>] allow = [...]` (configuration version 3 and
  `workspace-config.v3.json`), else `PLUGIN_GRANT_DENIED` at load for a required
  grant, withheld for an optional one, and `STORE_WRITE_NOT_ALLOWED` for a
  write outside the entries; reader filters built from the effective
  principal, `onBehalfOf`, groups and a space's `readers`
  (`SPACE_NOT_READABLE`, before the handler, for every plugin command and for
  `event-list` and the `store-*` commands); `spaces` checked like `space`;
  derivation reads (`derive_changes`, `derive_document`) for a `store-write`
  command with `index_write` or `graph_write`, and `as_reader` for a
  CLI-only command called by a human; provenance enforcement
  (`STORE_PROVENANCE_REQUIRED`; the host overwrites `space`, `plugin`,
  `agent`, `principal`, `traceId` and `observedAt`); the plugin gate's named
  allow-list (`dev.umbel/index`, `dev.umbel/trust` only `"content"`), the
  gate-set `dev.umbel/changes` and `replay: "recorded"` on store-backed
  results, and `event-list` skipping version 1 events by `access`; the SDK's
  store methods, `Cx::in_space`, `Reader`, `HostError`'s `Conflict`, `Busy`,
  `Corrupt` and `Io`, `CallContext.spaces` and `output_budget`,
  `Outcome::with_sources` and `with_warning_details`; the manifest's
  `output_budget` wired to `with_output_budget`; `store-show`, `store-check`
  and `store-backup` and the doctor's `stores.version`, `stores.access` and
  `stores.lag`; `confirm = "require-human"` on the CLI (a terminal answer
  only; `--yes` and `--approve` refused; refused on every other surface);
  `workspace-show`'s `access` and the README's paragraph on access before
  phase 5. The two step 1 follow-ups for step 4 are done. Fifteen amendments
  in the specification's [Amendments from step
  4](phases/2-knowledge/spec.md#amendments-from-step-4). New tests:
  `store_grants.rs`, `access_filter.rs`, `require_human.rs`,
  `store_commands.rs`, `doctor_stores.rs`, the rest of `manifest_v2.rs`, and
  allow-list cases in `config_v3.rs`, `schemas.rs` and the loader's unit tests.
  The host now links SQLite and tantivy through its default feature
  `store-embedded`, so the `check` and `msrv` jobs build them too (amendment
  D15); plugin crates that use `default-features = false` do not. Verified
  2026-11-01 in `endpoints/umbel` with `CARGO_TARGET_DIR` shared: `cargo fmt
  --all --check`, clippy `-D warnings` on the workspace and on each
  `umbel.yml` leg (no default features, mounted, component, the SDK and hello
  with `mounted`, the components for `wasm32-wasip2`, the knowledge crates),
  the wasm check of `umbel-store`, `cargo test --locked --workspace` (717
  passed), the MSRV checks (`cargo +1.97.0 check --locked --workspace
  --all-targets` and the knowledge crates), `pnpm verify`. The sync, status and
  index outputs of the specification's section 5.5 and 8.7 do not exist yet
  (steps 5 and 6): the "no restricted id or count" tests cover the store
  reads, `store-show`, the graph, the change log and `event-list` now, and
  those commands inherit the reader filter and the gate's `readers` check.
- **Step 5 done (2026-11-01, [668](https://github.com/lushly-dev/afd/pull/668)):** the first plugin that fills the
  stores. `umbel-scan` (the `description-injection` patterns moved out of
  `src/plugins/mounted/scan.rs`, which re-exports them, so the host's `mounted` feature does not
  link pulldown-cmark; plus the hidden-text check: zero-width and bidirectional controls, tag
  characters, HTML comments over 200 characters). `umbel-okf`: frontmatter through AFD's public
  reader under Umbel's 64 KiB cap, with no frontmatter (`Ok(None)`) kept apart from malformed,
  the empty block refused, the byte order mark stripped and offsets true to the file; the OKF keys
  and Umbel's extensions normalized under the field caps (title 512 characters, description 4 KiB,
  32 aliases, 64 tags, owners 32) with `fields-limited`; markdown structure from pulldown-cmark
  (heading tree with slugs and section ranges, top-level blocks, links, code spans, line numbers)
  with bounded work for adversarial input; link resolution; `analyze`, one call per file. The
  compiled plugin `sources` (crate `umbel-plugin-sources-filesystem`; the id has no hyphen, amendment
  E2) with `sources-sync` and `sources-status`, its `frontmatter` schema pack and its skill:
  collections from configuration version 3 through the new host service `content_collections`
  (E1), change detection by size and modification time then SHA-256, compare-and-set writes with
  one retry, tombstones, a sharded sync state, `dry_run`, `limit` and `remaining` (E3, E4), access
  mirroring from the document, the nearest `.umbel-access.toml` or the collection (E5), the write
  scan's flags (flagged, never blocked), and results of **totals plus the ids the caller can read**
  (a person at the command line also gets paths). The `knowledge` CI job runs the new crates;
  (The `$CARGO_TARGET_DIR` fix for the external-clients verify step had already landed in
  [#652](https://github.com/lushly-dev/afd/pull/652).)
  Thirteen amendments in the specification's [Amendments from step
  5](phases/2-knowledge/spec.md#amendments-from-step-5). New tests: `scan/tests/scan.rs`,
  `okf/tests/frontmatter.rs`, `structure.rs` and `flag_rate.rs`,
  `plugins/sources-filesystem/tests/sync.rs`, `access_mirror.rs`, `readable_results.rs` and
  `confinement.rs` (path traversal, symbolic and hard links, names that cannot be ids, size caps,
  100 001 files, pathological markdown, restricted ids absent from results, warnings and events for
  a reader outside the access set). **Flag rate** of the write scan on this repository's 523
  Markdown documents: 17 `instruction-like` (3.3 %), 1 `hidden-text` (0.2 %). Verified 2026-11-01 in
  `endpoints/umbel` with `CARGO_TARGET_DIR` shared: `cargo fmt --all --check`, clippy `-D warnings`
  on the workspace and on each `umbel.yml` leg, the wasm checks and component builds,
  `cargo test --locked --workspace`, the MSRV checks, and `pnpm verify`. The hidden counts of
  section 6 are as the owner accepted: the totals of a sync or status result include files the
  caller cannot read.
- **Step 6 done (2026-11-01, [671](https://github.com/lushly-dev/afd/pull/671)):** the knowledge core. The crate
  `umbel-plugin-knowledge` (plugin `knowledge`, no `code` feature yet) and its binary
  `umbel-knowledge` (the `umbel` command line with `sources` and `knowledge` compiled in; the stock
  `umbel` stays empty, D57). **Chunking** (`chunk.rs`, D59): sections by heading, blocks
  accumulated to 240 words and never past 400, oversize blocks split at lines, short tails merged,
  no overlap, at most 2000 chunks, a 64 KiB cap per chunk, code as 60-line plain text.
  **`knowledge-index`**: the section 8.7 procedure, index only (the writer first, derivation reads,
  chunks built in memory, one commit that never lowers `applied`; bounded by `limit`, a rebuild is
  one run), with totals plus the ids the caller can read. **`knowledge-search`**: fielded BM25
  through the query builder of step 3 (boolean, phrase, field, boost and bounded prefix syntax),
  the reader filter as a mandatory clause of the index query, documents with their best chunk,
  locator and verification, snippets, AFD `sources`, `INDEX_STALE`, `STALE_CONTENT`,
  `UNVERIFIED_CONTENT`, `CONTENT_FLAGGED` and `RESULTS_LIMITED`, `verified_only`, draft and
  deprecated handling; multi-space queries through `Cx::in_space`, fused by reciprocal rank,
  labeled and never written back. **`knowledge-open`** (by line, chunk, heading or locator, with
  `DOCUMENT_CHANGED`), **`-find`**, **`-describe`** (outline, links, readable-only backlinks),
  **`-list`** and **`-changes`**, with `trust: "content"` and `dev.umbel/trust: "content"` on every
  read, output budgets (24 000/96 000 for search, 32 000/128 000 for open, 16 000/64 000 for the
  rest) that the handlers fit structurally and AFD's check backs up, the first-class suggestions
  (`knowledge-search`, `knowledge-open`), the `knowledge-refresh` pipeline, the `ranking` pack and
  the `knowledge-guide` skill. Seventeen amendments in the specification's [Amendments from step
  6](phases/2-knowledge/spec.md#amendments-from-step-6) (F1 to F17); no host change was needed. New
  tests in `plugins/knowledge/tests/`: `chunking.rs` (every rule, a committed fixture),
  `query_syntax.rs`, `search.rs`, `open_find.rs`, `spaces.rs`, `budgets.rs` (including exact fits and
  the refusal by AFD's check), `security.rs` (an outsider never sees a restricted document, its
  chunks, snippets, ids or backlink contributions through search, open, find, describe, list,
  changes or the index; filtering inside the query with sixty better restricted matches; the
  `access` field unqueryable and the reader unchoosable; an unreadable space refused with
  `SPACE_NOT_READABLE`), `index.rs`, `process.rs` (a stdio server and one-shot commands on one
  workspace at once through the `umbel-knowledge` binary) and `smoke.rs`. The `knowledge` CI job
  runs the new crate. The crate is in the release inventory (quarantined) and `architecture.json`.
  Verified 2026-11-01 in `endpoints/umbel` with `CARGO_TARGET_DIR` shared: `cargo fmt --all
  --check`, clippy `-D warnings` on the workspace and each `umbel.yml` leg, `cargo test --locked
  --workspace`, the MSRV checks, and `pnpm verify`.
- **Step 8 done (2026-11-01, [673](https://github.com/lushly-dev/afd/pull/673)):** proposals and the verification lifecycle, all in
  the `knowledge` plugin and one host service. **The proposal** (`proposal/`): the record
  `proposal.v1` kept as a decision trace in the plugin's namespace with the target's access set (so
  the host's reader filter hides proposals whose target the caller cannot read); **areas** with
  approver lists and `allow_self_approval` in the instance's configuration, the most specific
  collection and prefix governing; **`knowledge-propose`** (create, update, deprecate, verify;
  validated against the area, the base hash, the collection and the evidence; scanned; a unified
  diff by `similar`; an idempotency key whose id is `p-` and 20 hex of the space, the proposer's
  actor string and the key, so a retry returns the proposal and another change is
  `PROPOSAL_KEY_REUSED`), **`knowledge-proposal-list`**, **`-proposal-show`** (the record without the
  repeated content, `trust: "content"`, under an output budget) and **`knowledge-withdraw`**.
  **`knowledge-approve`**, **`-reject`** (a required reason) and **`-verify`** are CLI-only with
  `confirm = "require-human"` (a terminal on stdin and stderr; `--yes` and `--approve` refused),
  approve and verify also with AFD's approval. The approver must be a person, among the area's
  approvers (matched through the new host service `reader_tokens`), able to read the target; the
  same actor approving its own proposal is `PROPOSAL_SELF_APPROVAL` unless the area allows it
  (`exception: "self-approval"`), and a person approving their own agent's proposal is allowed with
  `proposer.actor.kind = "agent"` and `decision.proposerKind` recorded. **The apply sequence**:
  check the file against `baseHash`, record the decision, write the file through `content_write` by
  temporary file and rename with the expected hash, put the document (origin `user-stated` for a
  human proposer, else `agent-inferred`; the proposal's `confidence`; the evidence documents as
  `sources`; `derivedFrom` the proposal), record `applied`; a run that stopped resumes without
  repeating a done step. Approve does not index (`indexed: false`, `INDEX_STALE` until
  `knowledge-refresh`). **Verification**: `knowledge-verify` stores a `verify` proposal as the
  calling person and applies it in the same call when they are an approver (no self-approval
  exception); verify and deprecate are frontmatter-only rewrites by the new
  `umbel_okf::rewrite_keys`. Every state change is journaled and evented with the target's access
  set, so `event-list` filters it. Sixteen amendments in the specification's [Amendments from step
  8](phases/2-knowledge/spec.md#amendments-from-step-8) (G1 to G16), among them the one host change
  (the pull request body carries `Plugin-isolation-exempt:`) and the static confirmation prompt. New
  tests: `plugins/knowledge/tests/proposals.rs` (18), `verification.rs` (9) and the write side of
  `security.rs` (6), the unit tests of `rewrite_keys`, and the host's
  `reader_tokens_are_the_callers_own_tokens_and_nobody_elses`. Deployers upgrading add
  `[plugins.knowledge.grants.records_write] allow = [...]`, and `documents_write` and
  `content_write` to apply proposals (amendment G14). Verified 2026-11-01 in `endpoints/umbel` with `CARGO_TARGET_DIR` shared: `cargo fmt --all --check`, clippy `-D warnings` on the workspace and each `umbel.yml` leg, the wasm checks, `cargo test --locked --workspace`, the MSRV checks, and `pnpm verify`.
- **Done:** step 10, the exit (the step 10 pull request): `plugins/knowledge/tests/exit_thousand.rs`
  and the exit criterion re-run. The test generates the fixture with seed `20261101`, opens a host
  with `compiled:sources` and `compiled:knowledge` enabled for both spaces, runs `knowledge-refresh`
  then `knowledge-index rebuild=true` in `alpha` and `beta`, and asserts the specification's four
  points: **(1)** `store-show` as the CLI human reports 650 documents in `alpha` (600 Markdown, 50
  code) and 400 in `beta`, 1000 Markdown in all, and each space's index and graph applied revisions
  equal to its head; **(2)** all 220 seeded queries, each run in `alpha` and in `beta` on its own
  (440 searches), return only that space's hits (the queries whose words occur in both spaces
  included), the 15 `cross-space` queries return `beta` hits only with `spaces` and every hit is
  labeled, and `knowledge-open`, `-neighbors`, `-related` and `-path` with a document of the other
  space answer `DOCUMENT_NOT_FOUND` or `PATH_NOT_FOUND`; **(3)** none of the 45 restricted documents
  (the 20 probes' answers and 25 entries) comes back to `human:eval-reader` in any search run as
  them (every seeded query names them), as a member of `restricted` every probe's first hit is its answer, `knowledge-open` of
  a restricted answer is `DOCUMENT_NOT_FOUND` for the outsider and succeeds for the member, the
  public documents that link to the 20 restricted answers (86 citer and answer pairs) never name the
  answer in `knowledge-neighbors` for the outsider and have `PATH_NOT_FOUND` to it (the member reaches it in one hop), and with `beta`'s
  `readers = ["group:restricted"]` the outsider gets `SPACE_NOT_READABLE` from search, a
  multi-space search that names it, and list, while the group's members and `alpha` are
  unaffected; **(4)** `knowledge-eval`'s report validates against `eval-report.v1.json`, passes
  `eval::gate::check` against `eval/baseline.json`, has 0 leaks in 220 queries, and is written to
  the file `UMBEL_EXIT_REPORT` names (the `knowledge` job sets it, beside the step 9 report, and
  uploads both in the one artifact). **Eval numbers** (seed `20261101`, `k = 10`, 185 answerable
  queries): with expansion on recall 1.0, nDCG 0.9273, MRR 0.9207; off recall 0.8919, nDCG 0.9123,
  MRR 0.8784; multi-hop recall 1.0 against 0.0; the 15 unanswerable queries all empty; 0 leaks;
  latency p50 5.4 ms, p95 40.6 ms in a debug build. **The fixture is synthetic with planted terms**
  (pseudo-words, planted key terms, aliases, bridges and mentions), so its recall measures the
  pipeline and regressions, not quality on real content; a deployer's own corpus needs its own
  query set. The test takes about 21 seconds in a debug build.
- **Exit criterion re-run** (2026-11-01, `main` at `aa0ecda2` plus step 10, in `endpoints/umbel`
  with its own `CARGO_TARGET_DIR`): `cargo test --locked --workspace` in `endpoints/umbel` passed 1032 tests in 107 suites (0 failed, 1 ignored doctest); the `knowledge` job's crates 364 (46 suites) and `-p umbel-plugin-knowledge --no-default-features` 169 (21 suites); the `check` job's test 680 (64 suites); every `umbel.yml` leg exited 0 (`cargo fmt --all
  --check`; clippy `-D warnings` on the workspace, the library-only, mounted and component legs, the
  mounted SDK and hello-mcp leg and the `wasm32-wasip2` leg; the components and hello-mcp builds;
  the `check` job's test; the MSRV 1.97 check; the `knowledge` job's clippy, test, no-default-features
  clippy and test, `wasm32-wasip2` check of `umbel-store` and MSRV check); `pnpm verify` passed all
  14 of its legs (the `umbel.yml` ones including the todo conformance for `umbel-todo` and the
  mounted backend in both MCP eras with confirmations, and the external-clients check). The hosted
  `umbel.yml` runs are the pull request's checks (the `knowledge` job's first hosted timing is a
  follow-up).
- **Smoke on a fresh workspace** with the `umbel-knowledge` debug binary: `umbel-knowledge init`,
  then the `umbel.toml` of the README's "Run the knowledge plugin" (one handbook collection of two
  Markdown files, one code collection with a Rust file, an area approved by `principal:human:ada`);
  `workspace doctor` healthy with 24 checks all `pass`; `knowledge-refresh`; `knowledge-search`
  found both documents (and the Rust symbol `apply_step` by name) and `knowledge-open` read one;
  `knowledge-propose` (create), `knowledge-approve` refused with `CONFIRMATION_REQUIRED` without a
  terminal and **applied at a real pseudo-terminal** (`script` supplying one: two prompts, the
  plugin's confirmation and AFD's approval, both answered `y`; the file was written, the document
  stored, the proposal `applied` with the `self-approval` exception the area allows); after another
  `knowledge-refresh` the approved document was found by search; `store-show` showed the index and
  graph at the head (14); `workspace-show` reported `access: { principals: "unverified", exact:
  ["library"] }`. The approval path is also covered by `proposals.rs` and `require_human.rs`
  (the scripted terminal). The smoke showed the terminal prompt as a fixed sentence with no
  proposal id, diff or flags (amendment G2), which is why the follow-up below is "before real use".
- **Spec items confirmed from the code** (not from memory): output budgets are declared on every
  read command of the knowledge manifest (search 24 000/96 000, open 32 000/128 000, find,
  describe, list, changes, neighbors, related, path, outline, stale, proposal-list and
  proposal-show 16 000/64 000; `knowledge-eval` declares none by design, J11) and tested in
  `budgets.rs` (11 cases, including exact fit and one byte over, a result that cannot fit refused
  rather than truncated) and in AFD's `output_budget.rs`; `event-list` skips version 1 events the
  caller cannot read (`src/commands/event_list.rs`; `access_filter.rs`
  `event_list_skips_version_1_events_the_caller_cannot_read`); `require-human` is enforced in the
  CLI (`tests/require_human.rs`, 7 cases: `--yes` and `--approve` refused, no terminal refused, a
  terminal answer decides, a batch cannot carry it, MCP and in-process refused) and declared on
  `knowledge-approve`, `-reject` and `-verify`; the README states under "Access is not a security
  boundary yet" that filtering is exact only for embedders and tests until phase 5; the README now
  lists every required `allow` list (`records_write` and `graph_write` among them, and
  `documents_write` and `content_write` for applying proposals) with a working `umbel.toml`,
  verified by the smoke run above. No gap was found against those items.
- **Not done:** nothing in phase 2's plan. Open and recorded as follow-ups: the dynamic
  confirmation prompt (**must do before real use**; done 2026-11-03 in phase 4 step 3a), partitioned BM25 statistics (a phase 5
  prerequisite), the hosted `knowledge` job timing, and the ranking tweak for expansion. TypeScript,
  Python and C++ output budgets are AFD's follow-up and do not block Umbel. Store grants for
  components wait for WIT world 1.1.0.
- **Owner decisions (2026-11-01):** recorded in the specification's
  [section 15](phases/2-knowledge/spec.md#15-for-the-owner): access v0
  accepted and tightened (derivation reads compiled-only; filtering exact
  only for embedders and tests until phase 5; flagged, not blocked;
  index-building outputs and events filtered to totals plus readable ids);
  approve and reject require a human at a terminal (`confirm =
  "require-human"`); self-approval refused only for the same actor; BM25
  statistics over unreadable chunks accepted for phase 2, with partitioned
  statistics or coarsened scores a phase 5 prerequisite. The coordinator
  kept D66's fail-open journal (race fixed), D62's proposals in phase 2
  (phase 4's exit amended to a curator proposal) and D57's binary.
- **Needs the owner:** nothing to approve. (Superseded: "approval of the revised specification", given and merged in #625.) The dynamic confirmation prompt below needs a decision on where it lives (a host feature) before a real deployment.
- **Follow-ups:** the specification's follow-ups table, mirrored below.

- **Step 7a done (2026-11-01, [672](https://github.com/lushly-dev/afd/pull/672) and the step 7a graph
  pull request):** the structural graph. **Part 1 (host and SDK):** `HostServices::graph_applied`
  (a `graph` read), `derive_head` (the true head, which counts changes the caller may not read, so a
  derivation read only) and `checkpoint` (any store write grant allowed for the space), and the
  host's whole-graph read served from the readable-graph cache. **Part 2 (the `knowledge` plugin):**
  `knowledge-index` builds the graph in the same run as the index (the writer first, both applied
  revisions, the run starting after the smaller, one `GraphBatch` committed in one transaction before
  the index, neither revision ever lowered, `checkpoint`, and the exact head in the result and in
  `dev.umbel/index`); the nodes and edges of section 7.3 except code symbols: directories, headings,
  `links_to` (and a heading edge for a fragment), `tagged`, `owned_by`, `supersedes` and `co_cited`
  stored per citing document under the 50-target cap, with a contribution never producing a node
  for a link's target. `knowledge-search` expands along readable edges (`links_to` both ways,
  `supersedes`, `co_cited` at weight 2, at most 20 per document, the `ranking` pack's `[expansion]`
  table) and marks a neighbour `matched: false`; `INDEX_STALE` counts a lagging graph.
  `knowledge-neighbors`, `-related`, `-path`, `-outline` and `-stale` are new, with output budgets;
  `knowledge-describe` adds `graphApplied` and `coCitation`; `sources-sync` checkpoints. Nothing hidden
  is named, scored or counted: neighbours, backlink counts, co-citation weights and paths use only
  the origins and endpoints the caller can read (tests: a restricted citer does not raise a public
  pair's weight; a path never passes through a restricted document). Fourteen amendments in the
  specification's [Amendments from step 7a](phases/2-knowledge/spec.md#amendments-from-step-7a)
  (H1 to H14). Verified 2026-11-01 in `endpoints/umbel` (shared `CARGO_TARGET_DIR`): `cargo fmt
  --all --check`, clippy `-D warnings` on the workspace and each `umbel.yml` leg, the wasm checks,
  `cargo test --locked --workspace`, the MSRV checks and `pnpm verify`.

- **Step 7b done (2026-11-01, the step 7b pull request):** code symbols, in the `knowledge` plugin
  only (no host or SDK change). The default `code` feature adds tree-sitter 0.27.1 and the Rust,
  Python and TypeScript grammars (JavaScript and JSX parse through the TSX grammar; the fixtures show
  no gap, so `tree-sitter-javascript` stays out) and one committed query file per language. A code
  file is chunked by top-level definition with its comments, `export` and decorators, the text
  between them in 60-line pieces, and its symbols are the `code` field of each chunk and
  `symbol:<language>:<qualified name>` nodes with a `defines` edge from the file; a markdown
  document's inline code that could name a symbol is a `mentions` edge to that node's id, served
  only where both documents are readable and counting from the day the symbol exists. Parsing and
  querying run under a wall-time bound each (tree-sitter's progress callbacks), a match limit, a
  1 MiB size bound, a 5000-definition bound and a 25 % error rate (bytes under `ERROR` or
  `MISSING` nodes); a file over any is plain text with `CODE_PARSE_DEGRADED` naming only readable
  ids, and `knowledge-describe` says how a file was indexed. Nothing recurses over a tree: 200 000
  levels of nesting pass on a 1 MiB stack. A restricted file's symbols reach an outsider through no
  search, neighbor, path, related, outline, list, find or open (tests). Eight amendments in the
  specification's [Amendments from step 7b](phases/2-knowledge/spec.md#amendments-from-step-7b)
  (I1 to I8); the one that changes meaning: a mention names a **qualified** name, not a bare method
  name (I1). Build cost: about 16 CPU seconds (7 to 8 s wall at `-j4`) for the tree-sitter crates and
  +4.7 MB (+15 % unstripped, +19 % stripped) on the release `umbel-knowledge`. Tests:
  `code_symbols.rs` (27), `code_off.rs` (2, with `--no-default-features`) and unit tests. Verified
  2026-11-01 in `endpoints/umbel` (own `CARGO_TARGET_DIR`): `cargo fmt --all --check`, clippy
  `-D warnings` on the workspace and each `umbel.yml` leg including the knowledge crate without
  `code`, `cargo test --locked --workspace --no-fail-fast` (1006 passed), the MSRV checks and
  `pnpm verify`.

- **Step 9 done (2026-11-01, the step 9 pull request):** the eval harness, all in the `knowledge`
  plugin and no host change. **The fixture** (`eval/fixture.rs`, `rng.rs`, `words.rs`): a PCG32
  stream and a pseudo-word generator implemented in the crate, so the output is a pure function of
  the seed; seed `20261101` writes `umbel.toml` (version 3, both spaces, the `restricted` group),
  600 handbook and runbook documents and 50 code files in `alpha`, 400 notes in `beta`, and
  `spaces/alpha/eval/queries.jsonl`; 150 alpha topics (a key term in one answer and in passing in up
  to two others, two aliases, a phrase, a bridge document that links to the answer) and 15 beta
  topics; 45 restricted handbook documents, 22 deprecated, exactly 8 `instruction-like` and 4
  `hidden-text` planted for the write scan; the tree is pinned by a SHA-256 constant. **The query set**
  (`eval/queries.rs`): 220 queries (80 exact, 30 alias, 20 phrase, 20 field, 20 multi-hop, 15
  cross-space, 15 unanswerable, 20 permission), validated against `eval-queries.v1.json`.
  **`knowledge-eval`** (`eval/run.rs`; CLI only, `inspect`): `{ spaces?, queries?, k?, expand? }`,
  each query run through the ranking code `knowledge-search` runs (now generic over the read methods
  of `Cx` and of `Cx::as_reader`'s `Reader`) as the principal it names; recall@k, nDCG@k and MRR@k
  overall and per kind with expansion on and off, the unanswerable empty rate, `leaks` (checked
  against each hit's stored access set and the principal's reader tokens), latency and every
  query's ranked ids and scores; the report is the result. **The gate** (`eval/gate.rs`): `check`
  (zero leaks, every unanswerable query empty, recall@10 >= 0.85, nDCG@10 >= 0.70, multi-hop
  recall not hurt by expansion, no metric more than 0.02 below `plugins/knowledge/eval/baseline.json`)
  and `lane_gate` (the seam for O4's lanes: at least 50 answerable queries). **CI:** the `knowledge`
  job runs `eval_gate` and uploads the report as an artifact. Eleven amendments in the specification's
  [Amendments from step 9](phases/2-knowledge/spec.md#amendments-from-step-9) (J1 to J11), the main
  one that `queries` is `<collection>/<path>` (a plugin has no workspace path). **The numbers**
  (seed `20261101`, `k = 10`, 185 answerable queries): with expansion on recall 1.0, nDCG 0.9273, MRR
  0.9207; off recall 0.8919, nDCG 0.9123, MRR 0.8784; multi-hop recall 1.0 against 0.0; the 15
  unanswerable queries all empty; 0 leaks in 220 queries. The thresholds are met without any
  change to them or to the fixture after the first run. One ranking finding, recorded as a follow-up:
  expansion lowers the nDCG of exact queries (0.9368 against 1.0) because the link neighbours of a
  strong match outrank its weaker grade-1 mentions. The fixture's code files work with and without
  step 7b's `code` feature (plain text, or by symbol), and no query targets a code file. New tests: `plugins/knowledge/tests/eval_fixture.rs` (8) and `eval_gate.rs` (7), and
  unit tests for the generator's stream, words, metrics, gate and leak check. Verified 2026-11-01
  in `endpoints/umbel` with `CARGO_TARGET_DIR` shared: `cargo fmt --all --check`, clippy `-D warnings` on the workspace and each `umbel.yml` leg, the wasm checks, `cargo test --locked --workspace` and the `knowledge` job's crates, `cargo +1.97.0 check --locked --workspace --all-targets`, and `pnpm verify` (all passed).

Phases 3 to 7 have no detail yet; add a heading in this shape when one
starts.
