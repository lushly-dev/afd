# Phase 2 specification: knowledge

| Field | Value |
| --- | --- |
| Phase | 2, knowledge ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | Repository owner approves; the phase 2 owning agent writes and implements |
| Read first | [STATUS.md](../../STATUS.md), then the [architecture](../../architecture.md), the [decision log](../../decisions.md), and the [phase 0](../0-host-skeleton/spec.md) and [phase 1](../1-plugin-contract/spec.md) specifications, whose shapes this one extends |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request, as the phase 0 and phase 1 steps did |

## Status

- **State:** specification in review, **revised** 2026-11-01 after the
  independent review and the owner's decisions of the same day (see
  [Revision 2026-11-01](#revision-2026-11-01)); not yet approved. Written
  2026-11-01 by the phase 2 owning agent; phase 1's exit criterion was met
  the same day (step 8, [#624](https://github.com/lushly-dev/afd/pull/624),
  `886c3b4d`; `umbel.yml` [run 41298630706](https://github.com/lushly-dev/afd/actions/runs/41298630706)
  on `main`). It adds decisions [D51 to D67](../../decisions.md) and the
  architecture amendments they need, in the same pull request. Approval is
  the owner's (D24). Section [15](#15-for-the-owner) records the owner's
  decisions and the points still open.
- **Last verified:** 2026-11-01 against `main` at `886c3b4d` (the revision re-read the code below and, for the revision's findings, `src/middleware.rs` (`sanitize`), `src/cli/prompt.rs`, `src/cli/parse.rs`, `src/host/mod.rs` (the CLI actor), `src/provenance.rs`, `src/commands/workspace_show.rs`, `sdk/src/outcome.rs`, `wit/umbel-plugin-1.0.0/world.wit` (`host-error`), and the crate sources of tantivy 0.27.0, tantivy-query-grammar 0.27.0, tree-sitter 0.27.1 and tree-sitter-typescript 0.23.2). Evidence, read
  in `endpoints/umbel`: `schemas/provenance-envelope.v0.json` (closed; the
  reserved fields `sources`, `generated`, `contentHash`, `derivedFrom`,
  `access`, `sensitivity`, `redactions`, `delegationChain` and `tenant` are
  refused), `schemas/event.v0.json` (one `record`, envelope version 0),
  `schemas/workspace-config.v2.json` (`spaces.<id>.content_roots` and
  `backend` reserved; `profile` is `team` only; `plugins.<id>.grants.<g>.allow`
  reserved), `schemas/plugin-manifest.v1.json` (effects `inspect`,
  `plugin-state`, `external`; a grant is `{ name, required, reason }` with
  names `^[a-z][a-z0-9_]*$`; commands carry `approval`, `confirm_prompt`,
  `expose` and `first_class`), `src/plugins/grants.rs` (`Services`,
  `CallServices`, `ALLOW_REQUIRED` empty, `needs_allow`), `sdk/src/cx.rs`
  (`HostServices` is synchronous and called from a blocking context),
  `src/principal.rs` (stdio is an agent `principal.local_id` acting for
  `principal.on_behalf_of`; HTTP is the agent `loopback`; the CLI is a human
  `local`), `src/plugins/mounted/scan.rs` (the `description-injection`
  patterns), and `plugins/todo/Cargo.toml` (a plugin crate's binary links the
  host with `default-features = false` and another plugin's crate). In
  `packages/rust`: `Source` (`type`, `id`, `title`, `url`, `location`,
  `accessedAt`, `relevance`), `Warning`, `CommandDefinition::mutation`,
  `server/frontmatter.rs` (`parse` is `pub(crate)`), `context_fields.rs`. In
  `spec/`: `command-metadata.md` (approvals, the private in-process
  exchange), `context-fields.md`, `mcp-resources.md` (lists do not vary per
  connection), `tool-strategies.md`. No AFD output-budget mechanism exists in
  `spec/`, `docs/features` or `packages/rust`. Trajectory rows re-checked
  against primary sources on 2026-11-01 ([Trajectory refresh](#trajectory-refresh)).
  Relative links and anchors in this file resolve.
- **Done:** this specification, merged in [#625](https://github.com/lushly-dev/afd/pull/625)
  as `e996aad1`. Step 0a, 2026-11-01: output budgets specified in AFD, the
  [proposal](../../../../../docs/features/active/output-budgets/output-budgets.proposal.md)
  and [`spec/output-budgets.md`](../../../../../spec/output-budgets.md) with
  [`spec/output-budgets.json`](../../../../../spec/output-budgets.json), verified
  against `main` at `e996aad1` (the four languages' engines read, MCP
  2026-07-28 checked, `pnpm check`, the alfred parity tests); see
  [Amendments from step 0a](#amendments-from-step-0a).
  Step 0b, 2026-11-01 ([#633](https://github.com/lushly-dev/afd/pull/633)): the Rust
  implementation in `packages/rust`: `CommandDefinition::with_output_budget`,
  `CommandContext::with_output_budget_ask` and `output_budget()`, the check in
  the innermost link of `CommandRegistry::execute`'s chain, the ask on every
  MCP route and the meta-tools' `meta`, the journal's `outputBudget`, the
  declaration on tools, grouped actions, `afd-detail` and `afd-help`;
  `OUTPUT_BUDGET_EXCEEDED` in the shared catalog and the four constants;
  `afd::frontmatter` public behind the new `frontmatter` feature (enabled by
  `server`). Verified in `packages/rust`: fmt; clippy `-D warnings` and tests
  for default, no-default, `server`, `journal-file-shared` and
  `frontmatter` alone; both wasm checks and one with `frontmatter`; nightly
  docs; `tests/output_budget.rs` running every case of
  `spec/output-budgets.json` in process and over Streamable HTTP and stdio on
  both eras; the Rust todo backend with `--locked` and the conformance suite
  against it (legacy, modern, confirmations); `cargo test --locked
  --workspace` in `endpoints/umbel`; Python's error-code and vector tests;
  C++'s vectors test; `pnpm check`. See
  [Amendments from step 0b](#amendments-from-step-0b). **Step 1, shapes and
  configuration**, 2026-11-01, in [632](https://github.com/lushly-dev/afd/pull/632)
  (nine schemas with examples, configuration version 3, manifest version 2
  parsing, envelope and event version 1); see [Amendments from step
  1](#amendments-from-step-1). **Step 2, store traits and the SQLite stores**,
  2026-11-01, in [636](https://github.com/lushly-dev/afd/pull/636): `umbel-store` (the types, the three traits, the
  conformance suite with its access fixture, a deliberately breakable
  in-memory fake and `suite_detects.rs`) and `umbel-store-embedded`
  (documents, records, the change log and the graph on bundled SQLite in WAL
  mode, safe across processes), with the `knowledge` CI job; see [Amendments
  from step 2](#amendments-from-step-2). **Step 3, the tantivy index**,
  2026-11-01, in [643](https://github.com/lushly-dev/afd/pull/643): `umbel-store-embedded`'s `TantivyIndex`
  (schema 1 with LZ4 named in the settings and `en_stem`, the query builder over
  the `tantivy-query-grammar` AST with its limits and bounded prefixes, the reader
  clause as a score-less mandatory clause, writer sessions on tantivy's own lock
  that never lower `applied`, four-decimal scores, snippets, checksum validation),
  the petgraph cache, and the suite's `index` group with the two index cases that
  waited since step 2; the `knowledge` job's timeout set from a measurement. See
  [Amendments from step 3](#amendments-from-step-3). **Step 4, host
  services**, 2026-11-01, in the step 4 pull request: the ten grants with their
  allow lists (configuration version 3 reads `plugins.<id>.grants.<grant>.allow`)
  and `ALLOW_REQUIRED`, reader filters and `SPACE_NOT_READABLE`, `spaces` as a
  host input, derivation reads and `as_reader` for compiled plugins, provenance
  enforcement, the gate's named allow-list, `dev.umbel/changes` and
  `replay: "recorded"`, `event-list` filtered by `access`, the SDK's store
  methods with `Cx::in_space`, `HostError`'s four new variants,
  `CallContext.spaces` and `output_budget` wired to `with_output_budget`,
  `Outcome::with_sources` and `with_warning_details`, the `store-embedded`
  feature, `store-show`, `store-check` and `store-backup`, the doctor's three
  store checks, `confirm = "require-human"` on the CLI, `workspace-show`'s
  `access` and the README's paragraph on access before phase 5. See
  [Amendments from step 4](#amendments-from-step-4). **Step 5, `umbel-scan`,
  `umbel-okf` and `sources-filesystem`**, 2026-11-01, in [668](https://github.com/lushly-dev/afd/pull/668): `umbel-scan` (the write scan, moved out of `mounted/scan.rs`, which
  re-exports it, plus the hidden-text check), `umbel-okf` (frontmatter under
  the 64 KiB and field caps with no-frontmatter, malformed, empty and
  byte-order-mark decided, markdown structure with bounded work, link
  resolution, one `analyze` call per file), the compiled plugin `sources`
  (crate `umbel-plugin-sources-filesystem`) with `sources-sync` (bounded runs
  with `limit` and `remaining`, change detection by size, modification time and
  SHA-256, compare-and-set writes, tombstones, `dry_run`, access mirroring
  from `.umbel-access.toml`, results of totals plus readable ids), `sources-status`,
  its `frontmatter` pack and its skill, the host service `content_collections`
  and the `knowledge` CI job's new crates. See
  [Amendments from step 5](#amendments-from-step-5). **Step 6, the knowledge core**,
  2026-11-01, in [671](https://github.com/lushly-dev/afd/pull/671): the `umbel-plugin-knowledge` crate without the `code`
  feature and the `umbel-knowledge` binary (the stock `umbel` stays empty); structure-aware
  chunking (D59); `knowledge-index` by the section 8.7 procedure (index only: the writer first,
  derivation reads, one commit that never lowers `applied`, totals plus readable ids);
  `knowledge-search` (fielded BM25 through the query builder, the reader clause inside the query,
  document-level hits with best chunk, locator and verification, explicit labeled multi-space
  queries fused by rank and never written back); `knowledge-open`, `-find`, `-describe`,
  `-list` and `-changes`; output budgets on every read command; content labels; the first-class
  suggestions; the `knowledge-refresh` pipeline; the `ranking` pack and the skill. See
  [Amendments from step 6](#amendments-from-step-6). **Step 8, proposals and verification**,
  2026-11-01, in the step 8 pull request: the proposal record (`proposal.v1`) kept as a decision
  trace; areas with approver lists and self-approval policy; `knowledge-propose` with its
  idempotency key; `knowledge-proposal-list`, `-proposal-show` and `-withdraw`; `knowledge-approve`
  (CLI only, AFD approval, `confirm = "require-human"`: terminal only, `--yes` and `--approve`
  refused), `knowledge-reject` (a reason) and `knowledge-verify`; deprecation as a proposal op; the
  apply sequence (decision, file through `content_write` with the expected hash, document with
  `derivedFrom` the proposal and `confidence`, `applied`) that resumes after a stop; the
  frontmatter-only rewrite `umbel_okf::rewrite_keys`; the write scan on proposals; one host service,
  `reader_tokens`. See [Amendments from step 8](#amendments-from-step-8).
- **Not done:** steps 7a, 7b, 9 and 10 of the [plan](#14-implementation-plan);
  the exit criterion.
- **Follow-ups not yet issues:** listed in [Follow-ups](#follow-ups) and
  mirrored in [STATUS.md](../../STATUS.md#follow-ups-not-yet-issues).

## What this phase serves

The phase 2 row of the architecture: *sources from the filesystem, chunking,
per-space lexical indexes and structural graphs, search, open, find,
metadata, citations as AFD sources, the access field on every document and
chunk, the eval harness.* Exit criterion: *a thousand documents indexed
across two spaces; no result crosses spaces without an explicit multi-space
query; results filtered by principal; recall and ranking reported on a
seeded query set.* It is item 3 of the proposal's
[first proof](../../proposal.md#first-proof): the knowledge plugin indexes a
thousand markdown documents and the eval harness reports recall and nDCG on
a seeded query set.

| Principle | How phase 2 serves it |
| --- | --- |
| 1. Empty host | The host gains store traits, an embedded backend and store grants, all domain-free; chunking, ranking, the graph's meaning, proposals and the eval harness are in the `knowledge` and `sources-filesystem` plugins, and the stock `umbel` binary still compiles in no plugin (D48, D57) |
| 2. Plugins are the unit | Two first-party compiled plugins; they never call each other; the `knowledge-refresh` pipeline composes them at the call site (D3) |
| 4. No model in the request path | BM25, the structural graph and the eval metrics are deterministic; no embedding or rerank lane (O4) |
| 5. Content lives in the workspace | Collections, access groups, area policies and ranking parameters are workspace configuration or pack overrides |
| 6. Deterministic core | Ingestion, chunking, ranking, graph building and the fixture generator are pure functions of their inputs and the command context's clock |
| 7. Provenance on everything | Provenance envelope version 1 on every stored document, record, chunk set and edge set; the host refuses a store write without it (D55) |
| 8. Durable knowledge changes by proposal | The proposal record and its approve and reject commands; approval per area; the file in the content root and the store change together (D62) |
| 9. Stored content is untrusted input | Every hit and window is labeled as content; ingestion and proposals are scanned and flagged; size caps (section 11) |
| 10. Permission-aware from the first plugin | Every document, chunk, node and edge carries an access set; the host turns the caller's principal into a reader filter that every backend applies inside its query, before ranking (D53) |
| 11. Stateless and horizontal | Several host processes share one workspace's stores: SQLite in WAL mode and tantivy's own writer lock, no daemon (D51, D28) |
| 12. Small surfaces, measured | `knowledge-search` and `knowledge-open` are first-class suggestions; concise and detailed formats; output budgets AFD-first (D64); the eval harness gates ranking changes (D65) |
| 13. Same interface at every scale | Profile `team` only; the commands, the store traits and the eval harness do not change at `org` (section 13) |
| 14. Every mutation is an event | Sync, index, propose, approve, reject and verify are journaled mutations with events version 1 |
| 15. AFD first | Output budgets and a public frontmatter parser land in the `afd` crate first (step 0); citations are AFD `sources`; approvals are AFD's |
| 16. Spaces do not mix | One store, index and graph per space; no edge crosses spaces; multi-space queries are explicit, readable-only, labeled and fused for display only (section 8.4) |

Decisions served: D1, D3, D7, D8, D9, D10, D13, D15, D16, D17, D19, D22,
D25, D26, D27, D28, D29, D36, D37, D40, D42, D44, D45, D46 and D48, and the
new D51 to D67 made here. Open decisions: **O4 stays open** and is honoured:
no embedding model by default, the vector and rerank lanes are seams only
(section 13). O1 and O5 are untouched: `sources-filesystem` is a first-party
plugin, not the connector contract federation needs.

## Trajectory refresh

Refreshed 2026-11-01 for the rows phase 2 depends on, against primary
sources (crates.io's API, the projects' GitHub releases and repositories,
the MCP specification repository and the Open Knowledge Format
specification). Nothing found changes the architecture's direction; two
library facts set constraints recorded in D51.

| Row | Checked against | Finding on 2026-11-01 | Effect on phase 2 |
| --- | --- | --- | --- |
| W1 release cycle | The roadmap (`docs/development/roadmap.mdx`, last changed 2026-10-23); `docs/specification/` | 2026-07-28 is still the latest revision (a `draft` directory exists); the roadmap's "Tool result shape" and "Progressive discovery" items are still under a forming Core Primitives working group | Phase 2 pins MCP 2026-07-28 and keeps the 2025-11-25 era, unchanged |
| W2 MCP Events, SEP-3415 | The pull request | Open, not a draft, last updated 2026-10-31 | Events stay Umbel's own log, read by cursor; nothing is pushed |
| W3 single result contract, SEP-3279 | The pull request; the roadmap | SEP-3279 open, last updated 2026-08-19; the roadmap now names a "tool result shape" redesign | Results keep `structuredContent` equal to the text JSON; audience and trust labels stay inside the result (R3) |
| W4 progressive discovery | The roadmap | An experimental server-side mechanism is a roadmap effort; no text | The hybrid strategy (D27) is unchanged; two first-class suggestions |
| W11 Open Knowledge Format | `okf/SPEC.md` (last changed 2026-08-21, "make every timestamp an ISO 8601 datetime with an explicit offset") | Version 0.2. `type` is the only required key; `title`, `description`, `resource`, `tags` recommended; `sources` entries need `resource`; `generated` is `{ by, at }`; `verified` a list of `{ by, at }`; `status` is `draft`, `stable` or `deprecated` (absent means `stable`); `stale_after` an absolute datetime; actors are `<producer>/<version>`, `human:<id>` or `process:<id>`; trust tiers are derived (unverified, machine-confirmed, human-reviewed); `index.md` and `log.md` are reserved at every level; producers may add keys and consumers must preserve them; every timestamp needs a UTC offset | The container (section 5) follows it; Umbel's own keys are extensions OKF tools ignore |
| W16 Skills over MCP | Unchanged since the phase 1 refresh | No client change | Phase 2 adds no skill delivery path; the plugins' skills use phase 1's three |
| Library: tantivy | crates.io; the 0.27.0 crate source and `tantivy-query-grammar` 0.27.0 (re-read 2026-11-01 for the revision) | 0.27.0 (2026-10-17, MSRV 1.88); the grammar keeps fields, phrases with slop, `+`/`-`, `AND`/`OR`/`NOT`, `^boost` and ranges; JSON fields; an `IndexWriter` is exclusive per index through a lock file, readers are many. `QueryParser` refuses a bare `term*` (`PhrasePrefixRequiresAtLeastTwoTerms`: its prefix needs a phrase of two terms), has no clause or expansion limit of its own, and allows regex leaves only when enabled. The `en_stem` tokenizer exists only with the `stemmer` feature; the default doc-store compressor is LZ4 only with `lz4-compression`, and an index written with LZ4 cannot be opened without it. A one-term `PhrasePrefixQuery` runs as a term-range scan bounded by `set_max_expansions` | The embedded index (D51); one writer at a time per space across processes; Umbel parses with `tantivy-query-grammar` and builds the query itself (section 8.1); features fixed in section 1 |
| Library: rusqlite and SQLite | crates.io; `libsqlite3-sys/upgrade.sh` | rusqlite 0.41.1 (2026-10-28, MSRV 1.89); libsqlite3-sys 0.39.1 bundles SQLite 3.54.1 | The embedded document, record and graph store, `bundled` so no system SQLite is needed (D51) |
| Library: tree-sitter | crates.io; GitHub releases | tree-sitter 0.27.1 (2026-10-08, MSRV 1.90); grammars depend on `tree-sitter-language` 0.1.9; tree-sitter-rust 0.24.2, tree-sitter-python 0.25.0, tree-sitter-typescript 0.23.2 | Code symbols for Rust, Python and TypeScript, with JavaScript parsed by the TSX grammar (`LANGUAGE_TSX`), behind the knowledge crate's `code` feature (section 7.4). 0.27.1's `Parser::parse_with_options` takes a progress callback that can cancel, and `QueryCursor` has `set_match_limit` and a progress callback; section 7.4 uses both |
| Library: petgraph | crates.io | 0.8.3 (2025-09-30) | In-memory traversal of the stored graph, unchanged from the architecture |
| Library: pulldown-cmark | crates.io | 0.13.6 (2026-10-30, MSRV 1.71.1); offset iterator | Markdown structure: headings, links, code blocks, line ranges (section 7.1) |
| Library: `saphyr-parser` | crates.io; `packages/rust/src/server/frontmatter.rs` | 0.3.3; already in Umbel's lock through the `afd` crate, whose YAML 1.2 core-schema frontmatter reader (no tags, anchors or aliases) is crate-private | Step 0 makes that reader public in AFD so Umbel parses frontmatter with AFD's rules (D25) |
| Library: `rmcp` | crates.io | 3.8.0 unchanged | No effect |

The Umbel workspace stays at Rust 1.97, above every new crate's minimum
(tree-sitter's 1.90 is the highest).

## Terms

Terms are the [architecture's glossary](../../architecture.md#12-glossary).
This phase adds these, entered in the glossary in this pull request:

| Term | Meaning |
| --- | --- |
| Document | One file of a collection, as stored: its bytes, frontmatter, identity, access set, sensitivity and envelope. Its id is `<collection>/<path without .md>` |
| Chunk | A contiguous, structure-aware part of a document that the index ranks; hits are presented per document |
| Access set | The access tokens that may read a document; every chunk, node and edge derived from it carries it |
| Reader filter | The access tokens of the calling principal in one space, built by the host and applied inside every store query |
| Revision | A space store's monotonically increasing change number; every document, record and tombstone write takes the next one |
| Area | The part of a space's knowledge base one approval policy governs: a collection, optionally narrowed to a document id prefix |
| Locator | The stable address of a hit: space, document, chunk, line range, content hash and index version |
| Derivation read | A read of a space's documents that ignores the caller's reader filter, available only to a command that writes derived data (index or graph) and only to the plugin's own derivation |

## 1. Crate layout

The Cargo workspace (D48) gains six members. Heavy native dependencies are
kept apart so that no step builds more than one new heavy set (section 14).

```text
endpoints/umbel/
├── Cargo.toml                 # members += store, store-embedded, okf, scan, plugins/sources-filesystem, plugins/knowledge
├── store/                     # umbel-store: the store traits v1, shared types, the conformance suite
├── store-embedded/            # umbel-store-embedded: SQLite (WAL) and tantivy, the reference backend
├── okf/                       # umbel-okf: frontmatter, the OKF v0.2 container, markdown structure
├── scan/                      # umbel-scan: the write scan's patterns, shared with the host's mounted loader
├── plugins/
│   ├── sources-filesystem/    # umbel-plugin-sources-filesystem: compiled plugin
│   └── knowledge/             # umbel-plugin-knowledge: compiled plugin, the eval harness, the `umbel-knowledge` binary
├── schemas/                   # + the version 1 and 2 shapes of section 2
└── tests/                     # + the host's store tests (section 10)
```

| Crate | Depends on | New third-party dependencies | Notes |
| --- | --- | --- | --- |
| `umbel-store` | `serde`, `serde_json`, `sha2` | none | Types and traits only, buildable for `wasm32-wasip2`; the conformance suite is the `conformance` module behind the `conformance` feature, a library any backend's tests call |
| `umbel-store-embedded` | `umbel-store` | `rusqlite = { version = "0.41", features = ["bundled"] }`, `tantivy = { version = "0.27", default-features = false, features = ["mmap", "stopwords", "stemmer", "lz4-compression"] }`, `tantivy-query-grammar = "0.27"`, `petgraph = "0.8"` | The only crate that links SQLite and tantivy |
| `umbel` (host) | + `umbel-store`; `umbel-store-embedded` behind the new default feature `store-embedded` | none of its own | Host services, reader filters, the store built-ins (section 3.5). `default-features = false` embedders get no store and every store grant answers `PLUGIN_GRANT_UNAVAILABLE` |
| `umbel-sdk` | + `umbel-store` (types only) | none | `HostServices` gains the store methods (section 3.3), each defaulting to `NotGranted` |
| `umbel-okf` | `afd` (default features off, `frontmatter` on; step 0b), `umbel-store`, `umbel-scan` | `pulldown-cmark = { version = "0.13", default-features = false }` | Shared library of both plugins; not a plugin (D3 governs plugins, not libraries) |
| `umbel-scan` | `regex` (already in the lock) | none | The write scan (section 11), moved out of `src/plugins/mounted/scan.rs` so the host's `mounted` feature and `umbel-okf` share one list without the host linking pulldown-cmark |
| `umbel-plugin-sources-filesystem` | `umbel-sdk`, `umbel-okf` | `globset = "0.4"` | Kind `compiled` |
| `umbel-plugin-knowledge` | `umbel-sdk`, `umbel-okf`, `umbel-store`; the binary also `umbel` (`cli`, `store-embedded`) and `umbel-plugin-sources-filesystem` | `similar = "2"` (proposal diffs), `regex` (already in the lock, for `knowledge-find`); behind the default feature `code`: `tree-sitter = "0.27"`, `tree-sitter-rust = "0.24"`, `tree-sitter-python = "0.25"`, `tree-sitter-typescript = "0.23"`, `streaming-iterator = "0.1"` | Kind `compiled`; binary `umbel-knowledge` (D57) |

`[profile.dev.package]` and the test profile set `opt-level = 2` for
`tantivy`, `tantivy-*` and `libsqlite3-sys`, as phase 1 did for Cranelift,
so the thousand-document tests run in seconds unoptimized. Every crate is
`publish = false`, inside the quarantined `umbel` release unit, with
`architecture.json` rows for the new crates as step 6 of phase 1 added for
its crates.

## 2. Versioned shapes

Every new shape is a closed JSON Schema 2020-12 file under
`endpoints/umbel/schemas/` with an example under `schemas/examples/`
(D36). Reserved fields are named; their producers never write them and the
schemas refuse them.

| Shape | File | Was | Section |
| --- | --- | --- | --- |
| Workspace configuration version 3 | `workspace-config.v3.json` | 2 (D41) | 4 |
| Plugin manifest version 2 | `plugin-manifest.v2.json` | 1 (D37) | 3.4 |
| Provenance envelope version 1 | `provenance-envelope.v1.json` | 0 | 2.1 |
| Event version 1 | `event.v1.json` | 0 | 2.2 |
| Document record version 1 | `document.v1.json` | new | 5.4 |
| Locator version 1 | `locator.v1.json` | new | 8.3 |
| Proposal record version 1 | `proposal.v1.json` | new | 9.1 |
| Eval query set version 1 | `eval-queries.v1.json` (one line of JSON Lines) | new | 10.2 |
| Eval report version 1 | `eval-report.v1.json` | new | 10.3 |
| Store traits version 1 | Rust, `umbel-store` (`STORE_TRAITS_VERSION = 1`) | new | 3.1 |

`workspace-show`'s `versions` changes its existing keys `config` to 3,
`manifest` to `[1, 2]`, `provenance` to 1 and `event` to 1, and gains
`store: 1`, `document: 1`, `locator: 1` and `proposal: 1`. It also gains a
top-level `access` object stating how far access filtering holds (section
6): `{ "principals": "unverified", "exact": ["library"] }` until phase 5. The plugin protocol version stays **1** (D40, amended by
D54): manifest version 2 is an addition within protocol 1, and a phase 2
host reads manifest versions 1 and 2.

### 2.1 Provenance envelope, version 1

Version 1 adds seven of version 0's reserved fields and keeps the rest
reserved (D55). It is the envelope of every stored record and of every event
from phase 2 on.

```json
{
  "version": 1,
  "origin": "document-derived",
  "space": "main",
  "plugin": "sources-filesystem",
  "agent": null,
  "principal": "human:local",
  "session": null,
  "traceId": "c0f3...",
  "observedAt": "2026-11-02T10:15:00.000Z",
  "validFrom": null,
  "validUntil": null,
  "confidence": null,
  "authority": null,
  "sources": [{ "resource": "/handbook/deploy/rollback" }],
  "generated": { "by": "human:ada", "at": "2026-10-30T09:00:00+00:00" },
  "contentHash": "sha256:9f2c...",
  "derivedFrom": null,
  "access": ["space"],
  "sensitivity": "internal"
}
```

| Field | Rule |
| --- | --- |
| Version 0's fields | Unchanged meaning (phase 0 section 7) |
| `principal` | **Changed in version 1**: the call's effective principal string (section 6), `<kind>:<id>` such as `human:local` or `agent:loopback`, never `null` for a call with an actor. Version 0 held the bare id of the person acted for (`"ada"`), or `null` |
| `plugin` | The plugin instance whose command produced the record, filled by the host from the call (the gate's instance), never by the plugin; `null` for host built-ins. Closes phase 1's follow-up "carry the plugin inside the provenance envelope" |
| `sources` | `null` or the OKF `sources` list as the record states it (each entry needs `resource`; `id`, `title`, `author`, `last_modified` optional), at most 64 entries |
| `generated` | `null` or OKF `{ by, at }`, `at` with a UTC offset |
| `contentHash` | `null` or `sha256:<64 hex>` of the record's bytes (a document's file bytes; a record's canonical JSON) |
| `derivedFrom` | `null` or a list of `{ "kind", "id", "contentHash" }` of the records this one was derived from (chunks and edges name their document), at most 64 |
| `access` | The record's access set (section 6), never empty |
| `sensitivity` | `public`, `internal`, `confidential` or `restricted` |

Still reserved, refused by version 1: `redactions`, `delegationChain`,
`tenant`. `authority` stays an open string; phase 3's version 2 closes its
set. **Store writes refuse** an envelope whose `origin` is `unspecified`, or
whose `access` or `sensitivity` is missing, with `STORE_PROVENANCE_REQUIRED`
(principle 7).

### 2.2 Event, version 1

Event version 1 is version 0 with `"version": 1`, `provenance` an envelope
version 1, and one optional field, `changes`:
`{ "fromRev": n, "toRev": m, "count": k }`: the lowest and highest store
revision **this call** wrote and how many it wrote. Other processes may
write between them, so `toRev − fromRev + 1` can exceed `count`; a consumer
that wants exactly the call's documents reads `knowledge-changes` with
`trace` set to the event's `traceId` (section 8.5). The phase 2 host writes
version 1 for every new event. Lines already written as version 0 stay as
written; `event-list` returns each line in its own version and accepts
both. `event-rebuild` writes each event in the version its journal entry
supports: an entry the phase 2 host journaled (it carries the version 1
envelope fields) rebuilds as version 1, an older entry rebuilds as version
0, as it was first written, so no `access` or `sensitivity` is invented.
Cursors stay version 0 (`v0:<space>:<seq>`).

**The envelope of a knowledge mutation's event.** The plugin names the
record (`dev.umbel/record`) and supplies the access-bearing fields through
`dev.umbel/provenance`, which the gate keeps (phase 1); the host fills the
identity fields and refuses a version 1 event without `access`:

| Command | `record` | `access` | `sources` | `contentHash` |
| --- | --- | --- | --- | --- |
| `sources-sync`, `knowledge-index` | `{ sync \| index, <space>/<collection or *> \| <space>, <toRev> }` | `["space"]` | `null` | `null` |
| `knowledge-propose`, `-withdraw`, `-reject` | `{ proposal, <id>, <rev> }` | The target document's access set (for `create`, the collection's resolved set) | `[{ "resource": "/<collection>/<path>" }]` of the target | The proposal record's canonical JSON hash |
| `knowledge-approve`, `knowledge-verify` | `{ proposal, <id>, <rev> }` | As above, after the apply | As above | The applied file's hash, or the record's when not applied |

**`event-list` filters by `access`.** For a version 1 event the host returns
the line only when the caller's reader filter in that space (section 6)
holds a token of the envelope's `access`; otherwise the line is skipped, as
an unreadable document is. Version 0 lines carry no access set and are
returned as before. `event-list` also applies the space's `readers`
(`SPACE_NOT_READABLE`). Skipped lines leave gaps in `seq`, a count leak
accepted with the others in section 6. The `events` grant reads through the
same filter.

## 3. Stores and host services

### 3.1 The store traits, version 1 (D51)

`umbel-store` defines three traits, instantiated **per space** by the host,
synchronous like phase 1's `HostServices` (callers are on a blocking
thread), `Send + Sync`, object-safe. The memory store trait is phase 3's.

Common types:

| Type | Meaning |
| --- | --- |
| `Rev` | `u64`, from 1, per space, shared by documents, records and tombstones |
| `DocId` | `<collection>/<path>` (section 5.1), at most 512 bytes |
| `AccessSet` | A sorted, deduplicated, non-empty list of access tokens (section 6) |
| `ReaderFilter` | The caller's tokens in this space, or `Derivation` (section 3.3); built only by the host |
| `Envelope` | Provenance envelope version 1 |
| `Expect` | `Any`, `Absent`, or `Hash(ContentHash)`: a write's compare-and-set condition |
| `StoreError` | `Conflict { current }`, `NotFound`, `Busy` (a lock wait past `store.lock_timeout_ms`), `Invalid(reason)`, `Corrupt(reason)`, `Io(reason)` |

**`DocumentStore`**

| Method | Contract |
| --- | --- |
| `put_document(doc: DocumentWrite, expect: Expect) -> Result<DocMeta>` | Atomic. `DocumentWrite` is the document record version 1 without `rev` (section 5.4). Takes the next `Rev`, replaces the previous version, appends one change. `Expect` mismatch is `Conflict` and writes nothing |
| `delete_document(id, expect, envelope) -> Result<Rev>` | Writes a tombstone change; the document is no longer readable |
| `get_document(id, reader) -> Result<Option<Document>>` | `None` when absent, deleted **or not readable by `reader`**: the store does not distinguish, so existence does not leak |
| `list_documents(query: ListQuery, reader) -> Result<Page<DocMeta>>` | `ListQuery { collection, prefix, doc_type, after: Option<DocId>, limit ≤ 500 }`, ordered by `DocId` |
| `changes(after: Rev, limit ≤ 1000, reader, trace: Option<&str>) -> Result<Vec<Change>>` | `Change { rev, kind: Put \| Delete \| Record, target, content_hash, trace_id, at }` (`at` the commit time from the command context's clock), ascending; filtered by `reader` (a change to an unreadable document is omitted, so revisions are dense only under `Derivation`) and, when given, by `trace` |
| `head() -> Result<Rev>` | The last revision, 0 when empty |
| `put_record(ns, kind, id, body, envelope, expect)`, `get_record(ns, kind, id, reader)`, `list_records(ns, kind, after, limit, reader)` | Plugin records (proposals, sync state): JSON bodies of at most 2 MiB, namespaced by plugin instance, with the same revision, change and access rules |

**`SearchIndex`** (the lexical lane; section 8.1 fixes its fields)

| Method | Contract |
| --- | --- |
| `writer() -> Result<Box<dyn IndexWriterSession>>` | Takes the space's index writer, waiting at most `store.lock_timeout_ms`, else `Busy`. Holding it **serialises indexers** across threads and processes; it is released when the session is committed, aborted or dropped |
| `IndexWriterSession::applied() -> Result<Rev>` | The index's applied revision, read under the writer |
| `IndexWriterSession::replace(doc: DocId, chunks: Vec<IndexChunk>) -> Result<()>` | Removes every chunk of `doc` and adds these, staged; an empty list removes the document |
| `IndexWriterSession::clear() -> Result<()>` | Stages removal of every chunk (rebuild) |
| `IndexWriterSession::commit(applied: Rev) -> Result<()>` | Makes staged changes visible and records `applied` as the index revision, atomically with them. **Refuses to lower** the revision: `applied` below the current one is `Conflict { current }` and commits nothing |
| `IndexWriterSession::abort()` | Drops staged changes |
| `applied() -> Result<Rev>` | The store revision the index reflects, without the writer |
| `search(query: &IndexQuery, reader) -> Result<Vec<ChunkHit>>` | Parses `IndexQuery.text` in the syntax of section 8.1, **adds the reader filter as a mandatory clause of the same query**, applies the structured filters, and returns at most `IndexQuery.limit ≤ 400` chunk hits with BM25 scores, ordered by score then `(doc, ordinal)`. A syntax error is `Invalid` with the parser's position |
| `chunks(doc, reader) -> Result<Vec<IndexChunk>>` | The stored chunks of one readable document, by ordinal |

**`GraphStore`**

| Method | Contract |
| --- | --- |
| `apply(batch: GraphBatch, applied: Rev) -> Result<()>` | `GraphBatch` is a list of `(doc, Option<(nodes, edges)>)`: for each, every node contribution and edge whose `origin` is `doc` is replaced (`None` removes them). The whole batch and the new applied revision commit in **one** `BEGIN IMMEDIATE` transaction; `applied` below the current one is `Conflict { current }` and writes nothing. The caller builds the batch in memory and holds the index writer (section 8.7), so graph writers are serialised too. `clear` is `apply` of every origin with `None` |
| `applied()` | The store revision the graph reflects |
| `neighbors(node, kinds, direction, limit, reader)` | Edges incident to `node` whose both endpoints and whose origin are readable, **aggregated** per `(from, to, kind)` over readable origins: the weight is the sum of the readable origins' weights (so a `co_cited` weight counts only citers the reader can read) |
| `nodes(ids, reader)` | The readable ones |
| `edges_of_kind(kind, limit, after, reader)` | Paged |

Nodes and edges carry the access set of the document they came from (their
`origin`); a node shared by several documents (a tag, an owner, a symbol) is
readable when any document that produced it is, and an edge is readable only
when both endpoints and its origin document are (D53). An edge is stored
once per origin, so the same pair may have several rows; readers see only
the aggregate of the readable ones. Traversals (`path`,
`related`) are computed by the knowledge plugin over `neighbors`, or by the
backend's optional fast path `subgraph(space-wide, reader) -> petgraph`
used by the embedded backend (section 3.2), with the same filter.

**Conformance suite** (D10). `umbel_store::conformance::run_all(factory)`,
where `factory` makes a fresh, empty set of the three stores for a space,
and `spawn_writer: fn(&Path) -> std::process::Command`, which the backend's
own test supplies (the embedded backend re-runs its own test binary,
`std::env::current_exe()`, with `UMBEL_STORE_WRITER=<dir>` and the filter
`--exact writer_child --nocapture`, so no extra binary target is needed),
runs these case groups, each a `#[test]`-style function returning a
report: `documents` (CAS, revisions, tombstones, paging order, size
limits), `records`, `changes` (order, filtering, revisions dense under
`Derivation`, `trace` filtering),
`envelope` (refusals of section 2.1), `access` (every read path with
three reader filters over the fixture of 40 documents in
`store/fixtures/access/`: no unreadable id, title, chunk, node, edge or
change ever returned, and `get_document` answers `None` alike for absent and
unreadable), `index` (every syntax form of section 8.1 against a fixed
corpus with expected hit sets, the mandatory reader clause, the refused
`access` field, `commit` atomicity: a reader sees all of a commit or none),
`graph` (endpoint and origin filtering, aggregation over readable origins,
replace semantics, one-transaction `apply`), `concurrency` (two writers
in two threads, then two processes through `spawn_writer`, interleaving 200
writes: revisions are dense and unique, every write is readable; two index
writer sessions: the second waits or answers `Busy`; `commit` and `apply`
refuse to lower `applied`), `durability` (reopen after drop returns the same head and
contents). A backend passes when every group passes; phase 6's second
backend runs the same function.

### 3.2 The embedded reference backend (D51)

Per space, under the state directory, which only the host writes:

```text
state/spaces/<space>/
├── events.jsonl, cursors/            # phase 0
├── store/
│   ├── store.sqlite3                 # documents, records, changes, graph
│   ├── store.sqlite3-wal, -shm       # SQLite's
└── index/v1/                         # tantivy: meta.json, segments, .tantivy-writer.lock, .tantivy-meta.lock
```

- **SQLite** opened with `journal_mode=WAL`, `synchronous=FULL` (decision
  traces must survive power loss), `foreign_keys=ON`,
  `busy_timeout = store.lock_timeout_ms` (default 5000). Every write is one
  `BEGIN IMMEDIATE` transaction; a busy timeout is `Busy`. `PRAGMA
  user_version = 1` is the schema version; a newer one is refused with
  `STORE_VERSION_UNSUPPORTED` naming what the host serves; migrations run
  forward under the write transaction at open. Tables: `meta`, `documents`
  (with the bytes as a BLOB), `doc_access (doc, token)`, `records`,
  `record_access`, `changes` (`rev INTEGER PRIMARY KEY`, the revision), `nodes`,
  `node_access`, `edges` and `graph_applied`. Reader filters are a join on the
  access tables with an `IN` list of the reader's tokens, inside the same
  statement as the selection, ordering and limit.
- **SQLite checkpoints.** Read transactions are short (one statement or one
  page of results; no transaction is held across a plugin's work), so they
  never pin the WAL. `wal_autocheckpoint` keeps SQLite's default (1000
  pages). After a `knowledge-index` or `sources-sync` run that wrote, and in
  `store-check`, the backend runs `PRAGMA wal_checkpoint(TRUNCATE)`, which
  is best effort: a busy result is ignored. On macOS the connection also
  sets `PRAGMA fullfsync = ON` (and `checkpoint_fullfsync = ON`), because
  `synchronous=FULL` alone does not flush the drive's cache there, and the
  durability claim above is about power loss.
- **tantivy** under `index/v1/`, an `MmapDirectory`, built with the
  features `mmap`, `stopwords`, `stemmer` and `lz4-compression` (section 1;
  without `stemmer` there is no `en_stem`, and without `lz4-compression` an
  LZ4 index cannot be opened). The index is created with explicit
  `IndexSettings { docstore_compression: Compressor::Lz4, .. }`, so the
  compressor never depends on a default; it is part of index schema 1. A
  writer session takes the index's `IndexWriter` with one thread and a 64 MiB budget; tantivy's
  writer lock is an OS file lock, so a second process's attempt fails at
  once, and the backend retries every 50 ms until `store.lock_timeout_ms`,
  then answers `Busy`. `commit` sets the commit payload to
  `{"applied": <rev>, "schema": 1}`. Readers use `ReloadPolicy::Manual` and
  call `reload()` before each search, so a process sees another's commits.
  The default merge policy stays; because deleted documents count in term
  statistics until segments merge, an incrementally maintained index can
  score slightly differently from a rebuilt one. The eval harness and every
  determinism test therefore run on a rebuilt index (section 10).
- **petgraph** builds a `StableDiGraph` of a space's readable graph from
  SQLite on demand, cached per process keyed by `(space, graph applied rev,
  reader filter digest)`, at most 8 entries, evicted least recently used. The
  cache is derived data, never request state (principle 11).
- **No daemon, any number of processes** (D28, D29): SQLite WAL admits many
  readers and one writer at a time across processes; tantivy admits many
  readers and one writer; both wait, bounded. The workspace lock of D29 is
  **not** held during store writes, only across the journal and event
  appends as in phase 0. A local filesystem is required, as phase 0's lock
  already requires (WAL does not work on network filesystems).
- **Rebuild.** The index and the graph are derived: `knowledge-index` with
  `rebuild = true` clears both and re-derives them from the document store.
  The document store is derived from the content roots except for records
  (proposals, sync state), which are only in SQLite and the journal; hence
  `store-backup` (section 3.5).

### 3.3 Grants and host services (D54)

The phase 1 catalog (config, log, packs, events, clock, random) gains ten
grants. Each is scoped to the instance's spaces (D44) and refused to
components and mounted plugins in protocol 1 with `PLUGIN_GRANT_UNAVAILABLE`
naming the world version that will carry it (`umbel:plugin/plugin@1.1.0`,
section 13): only compiled plugins hold store grants in phase 2.

| Grant | Provides | Write, needs `allow` | `allow` entries |
| --- | --- | --- | --- |
| `content` | List and read files under the call's space's collection roots (section 4.2), confined to each root, symlinks inside a root not followed, at most `max_file_bytes` per file and 64 MiB per call | no | — |
| `content_write` | Replace or create one file in a collection root by writing a temporary file in the same directory, `fsync`, and renaming it over the target (readers see the old or the new file, never a mix), after checking an expected content hash. The check and the rename are **not atomic** against a writer outside Umbel; Umbel's own writers are serialised by the document store's compare-and-set (section 9.2). A hard link in the root is replaced by the rename, not written through | **yes** | `<space>/<collection>` or `<space>/*` |
| `documents` | `get_document`, `list_documents`, `changes` under the caller's reader filter | no | — |
| `documents_write` | `put_document`, `delete_document` | **yes** | `<space>/<collection>` or `<space>/*` |
| `records` | `get_record`, `list_records` in the instance's own namespace, under the caller's reader filter | no | — |
| `records_write` | `put_record` in the instance's own namespace | **yes** | `<space>` or `*` |
| `index` | `search`, `chunks`, `applied` under the caller's reader filter | no | — |
| `index_write` | `writer` and its session (`replace`, `clear`, `commit`, `abort`), and derivation reads | **yes** | `<space>` or `*` |
| `graph` | `neighbors`, `nodes`, `edges_of_kind`, `subgraph` under the caller's reader filter | no | — |
| `graph_write` | `apply`, and derivation reads | **yes** | `<space>` or `*` |

Rules:

1. **Write grants follow D42's allow-list rule**: enabling an instance does
   not consent to them. Each needs `[plugins.<id>.grants.<grant>] allow =
   [...]` in `umbel.toml`; a declared write grant with no `allow`, or one
   whose entries name a space the instance is not enabled for, is
   `PLUGIN_GRANT_DENIED` at load for a required grant and withheld for an
   optional one. At call time a write outside the allowed entries is
   `STORE_WRITE_NOT_ALLOWED`. `ALLOW_REQUIRED` in `src/plugins/grants.rs`
   becomes `["content_write", "documents_write", "records_write",
   "index_write", "graph_write"]`. `http` and `secrets` stay unavailable.
2. **Reads are filtered by the caller** (principle 10): the host builds the
   `ReaderFilter` from the call's principal and the space (section 6) and
   passes it; a plugin cannot construct one.
3. **Derivation reads** (D54): a command whose instance holds `index_write`
   or `graph_write` for the space may read documents with
   `ReaderFilter::Derivation`, which applies no access filter, through the
   service methods `derive_changes(after, limit)` and
   `derive_document(id)` only. The host refuses them (`STORE_WRITE_NOT_ALLOWED`)
   in a command whose effects lack `store-write`. They exist so an index
   reflects every document whatever the caller may read; what the command
   returns to its caller is the plugin's responsibility, and section 5.5
   and 8.7 fix what the index-building commands may return. Compiled
   plugins are trusted code (owner decision 1 of 2026-11-01, phase 1), so
   this is API discipline, not a boundary. **Accepted by the owner on
   2026-11-01** (section 15, decision 1): derivation-reading plugins may
   read every document of a space; compiled plugins only.
4. **Provenance is enforced** on every write (section 2.1): the host fills
   `space`, `plugin`, `agent`, `principal`, `traceId` and `observedAt` from
   the call, overwriting what the plugin sent, and refuses the rest when
   invalid.
5. **Evaluating as another principal.** `as_reader(principal)` returns a
   `Reader` (below): the read methods only, with a reader filter the host
   builds for the named principal string (section 6), in the call's spaces.
   It works only in a command whose manifest entry is exposed to the CLI
   alone and only when the call's actor is a human; otherwise
   `STORE_WRITE_NOT_ALLOWED`. `knowledge-eval` is its one user (section
   10.3).
6. **Revisions reach the event.** A command that wrote sets nothing extra:
   the call's services record the revisions the call wrote, and the plugin
   gate, **after** it sanitises the result, sets
   `result.metadata["dev.umbel/changes"]` (`{ fromRev, toRev, count }`),
   from which the projection fills the event's `changes`. A plugin-supplied
   `dev.umbel/changes` is stripped like every other host key.
7. **What the gate admits.** Phase 1's `sanitize` (`src/middleware.rs`)
   strips every `dev.umbel/` key a plugin returns except `record` and
   `provenance`. Phase 2 extends that allow-list by name, for compiled and
   component plugins only: `dev.umbel/index` (an object of
   `{ <space>: { applied, head, schema } }`, kept only for spaces of the
   call) and `dev.umbel/trust` **only with the value `"content"`** (any
   other value is dropped). For a mounted plugin nothing more is admitted
   and the host's `trust: "external"` always wins, as in phase 1.
8. **Replay.** A store-backed result depends on the store's state, which
   the journal does not hold. The gate stamps `dev.umbel/replay:
   "recorded"` on the result of every call that used a store, content or
   `as_reader` service, as phase 1 does for mounted calls: replay returns
   the journaled result and never re-runs the handler against a different
   store.
9. **Several spaces in one call.** A command whose input schema has a
   `spaces` property (an array of space ids) gets it treated like `space`:
   the space check resolves each entry (`SPACE_NOT_FOUND`), the plugin
   gate checks that the instance is enabled for each (`PLUGIN_NOT_ENABLED`),
   and the reader filter checks each space's `readers`
   (`SPACE_NOT_READABLE`), all before the handler. A command may declare
   both properties; a call gives at most one (both is `VALIDATION_ERROR`),
   and with neither the default space applies. `CallContext.spaces` lists
   the checked spaces (`[space]` for a single-space call). `knowledge-search` and
   `knowledge-eval` use `spaces` in phase 2 (sections 8.4 and 10.3).

**The SDK.** `umbel_sdk::HostServices` gains the methods below, each
defaulting to `Err(HostError::NotGranted)` as phase 1's do; `Cx` wraps each,
and a raw `CompiledPlugin` calls the same methods on `CallServices`. Types
are re-exported from `umbel-store`. Every method takes the space
explicitly; the host refuses (`NotGranted`) a space outside
`CallContext.spaces`. `Cx::in_space(&str) -> Result<SpaceCx<'_>, HostError>`
binds one space after the same check, so a multi-space handler writes
`cx.in_space("beta")?.index_search(&query)`.

| Method | Signature | Grant |
| --- | --- | --- |
| `content_list` | `(space, collection, after: Option<&str>, limit: u32) -> Result<Page<ContentEntry>>` (`ContentEntry { path, size, mtime_ms }`, sorted by path) | `content` |
| `content_read` | `(space, collection, path) -> Result<Vec<u8>>` | `content` |
| `content_replace` | `(space, collection, path, bytes: &[u8], expect: Expect) -> Result<ContentHash>` | `content_write` |
| `doc_get` | `(space, id) -> Result<Option<Document>>` | `documents` |
| `doc_list` | `(space, query: &ListQuery) -> Result<Page<DocMeta>>` | `documents` |
| `doc_changes` | `(space, after: Rev, limit: u32, trace: Option<&str>) -> Result<Vec<Change>>` | `documents` |
| `doc_put` | `(space, doc: DocumentWrite, expect: Expect) -> Result<DocMeta>` | `documents_write` |
| `doc_delete` | `(space, id, expect: Expect, envelope: Envelope) -> Result<Rev>` | `documents_write` |
| `record_get`, `record_list`, `record_put` | `(space, kind, id)`, `(space, kind, after, limit)`, `(space, kind, id, body: Value, envelope, expect)`; the namespace is the instance's, never an argument | `records`, `records_write` |
| `index_search`, `index_chunks`, `index_applied` | `(space, query: &IndexQuery)`, `(space, doc)`, `(space)` | `index` |
| `index_writer` | `(space) -> Result<Box<dyn IndexWriterSession>>` | `index_write` |
| `graph_neighbors`, `graph_nodes`, `graph_edges`, `graph_subgraph` | `(space, node, kinds, direction, limit)`, `(space, ids)`, `(space, kind, after, limit)`, `(space) -> Subgraph` (nodes and aggregated edges, serialisable; the petgraph form stays inside the backend) | `graph` |
| `graph_apply` | `(space, batch: GraphBatch, applied: Rev) -> Result<()>` | `graph_write` |
| `derive_changes`, `derive_document` | `(space, after: Rev, limit: u32) -> Result<Vec<Change>>`, `(space, id) -> Result<Option<Document>>`, under `Derivation` | `index_write` or `graph_write`, in a `store-write` command |
| `as_reader` | `(principal: &str) -> Result<Reader>`; `Reader` holds the read methods above (`doc_*` reads, `record_get`/`record_list`, `index_search`/`index_chunks`/`index_applied`, `graph_*` reads) with that principal's filter, and nothing else | CLI-only command, human actor (rule 5) |

`CallContext` gains `spaces: Vec<String>` and `output_budget: Option<u64>`
(section 8.6). `Outcome` gains `with_sources(Vec<Value>)` (AFD `sources`)
and `with_warning_details(code, message, details: Value)`.

**Errors.** `StoreError` is the store's; the host maps it to the SDK's
`HostError`, which gains four variants, and `HostError` becomes
`#[non_exhaustive]` in the same step. `HostError` mirrors the WIT world's
`host-error`; world `umbel:plugin/plugin@1.0.0` is frozen and does not
change, because no component holds a store grant in protocol 1. World
1.1.0, which gives components store imports (section 13), adds the same
four cases to its `host-error`.

| `StoreError` or host refusal | `HostError` | AFD code a plugin should return |
| --- | --- | --- |
| Grant not declared, denied, withheld; space outside the call | `NotGranted(msg)` | `PLUGIN_GRANT_DENIED` |
| Write outside `allow`; derivation read without `store-write`; `as_reader` refused | `NotGranted(msg)` (the message names `STORE_WRITE_NOT_ALLOWED`) | `STORE_WRITE_NOT_ALLOWED` |
| `NotFound` | `NotFound(msg)` | The command's own (`DOCUMENT_NOT_FOUND`) |
| `Invalid(reason)`, envelope refusals | `Invalid(msg)` | `QUERY_INVALID`, `STORE_PROVENANCE_REQUIRED` or the command's own |
| Size caps | `TooLarge(msg)` | The command's own (`SOURCE_TOO_LARGE`) |
| `Conflict { current }` | **new** `Conflict { current: Option<String> }` (the current hash or revision) | `PROPOSAL_CONFLICT`, `STORE_CONFLICT` |
| `Busy` | **new** `Busy(msg)` | `STORE_BUSY` (retryable) |
| `Corrupt(reason)` | **new** `Corrupt(msg)` | `STORE_CORRUPT` (suggestion: `store-check`, then `knowledge-index rebuild=true`) |
| `Io(reason)` | **new** `Io(msg)` | `STORE_IO` |

### 3.4 Effects and manifest version 2

Manifest version 2 (`schemas/plugin-manifest.v2.json`) is version 1 with two
effects admitted for plugins:

| Effect | Means | Requires |
| --- | --- | --- |
| `store-write` | Writes through a store write grant | One of `documents_write`, `records_write`, `index_write`, `graph_write` declared |
| `workspace-write` | Writes files outside `state/` | `content_write` declared |

`mutation` is derived as in phase 1: any effect but `inspect` makes a
command a mutation, so its successful result is projected into the event
log. Version 2 also admits two command keys:

- `output_budget = { default_bytes, max_bytes }` (section 8.6). In phase 2
  only a **compiled** plugin's command may declare it; on a component
  plugin's command it is `PLUGIN_MANIFEST_INVALID` naming world 1.1.0 (the
  1.0.0 world's call context cannot carry a budget), and mounted tools have
  no manifest command entries, so they get no budget (AFD's backstop does
  not apply to a command without one).
- `confirm = "require-human"` (owner decision 2 of 2026-11-01; the only
  value). It needs `confirm_prompt`. For that command, whatever
  `mcp.confirmations` says, the CLI shows the prompt only when stdin and
  stderr are both terminals, and **refuses `--yes` and `--approve`**: given
  either, the call fails before the handler with `CONFIRMATION_REQUIRED`
  (suggestion: run it at a terminal without `--yes` or `--approve`). With
  `approval = "required"` as well, AFD's approval is also answered only at
  the terminal: the CLI's approval hook gets no `--approve` shortcut for the
  command. On any other surface (MCP, an in-process agent, the library) the
  command is refused with `CONFIRMATION_REQUIRED` before the handler, so a
  `require-human` command must also be `expose = { mcp = false, agent =
  false, cli = true }`, which the loader checks (`PLUGIN_MANIFEST_INVALID`
  otherwise). Agents can propose; only a person at a terminal approves,
  until the MCP approval relay (phase 4).

Everything else in version 2 equals version 1. A host serving phase 2
reads `manifest_version` 1 and 2; any other is
`PLUGIN_PROTOCOL_UNSUPPORTED`.

### 3.5 Host built-in commands

`store` becomes a host domain, so no plugin command may start with
`store-`.

| Command | Mutation | `mcp` | `agent` | `cli` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `store-show` | No | true | true | true | `{ space }`: backend (`embedded`), store traits version, SQLite schema version, head revision, document, record, chunk, node and edge counts, index and graph applied revisions, file sizes. Counts are of documents the caller can read, plus totals only for a CLI human. The head and applied revisions are shown to every reader: they reveal how many changes exist, a count leak accepted in section 6 |
| `store-check` | No | false | false | true | `{ space }`: `PRAGMA integrity_check`, tantivy segment checksums (`Index::validate_checksum`), access-table consistency (every document has at least one token), index and graph applied revisions not ahead of the head, and the journal cross-check of D66: store changes whose trace id has no journal entry. A change is considered only when its `at` is older than 60 seconds and its trace is not one of the journal's open (started, not finished) entries, because the journal entry is appended after the handler returns; a missing entry is a `warn`, never a `fail`. Ends with `PRAGMA wal_checkpoint(TRUNCATE)`. Each finding is a doctor-style check |
| `store-backup` | Yes (`workspace-write`, not projected) | false | false | true | `{ space, path }`: takes the space's index writer (bounded wait, else `STORE_BUSY`), so no indexer commits or merges during the copy; `VACUUM INTO` a new file at `path` (inside the workspace, must not exist); copies the index directory's files named by `meta.json`; releases the writer; writes a manifest of SHA-256 digests. Restore is out of scope (section 13) |

The doctor gains `stores.version` (each space's store opens at a served
version), `stores.access` (the access tables are consistent), `stores.lag`
(`warn` when an index or graph applied revision is behind the head) and
`collections.roots` (each declared root exists, is a directory and is inside
the workspace).

## 4. The workspace

### 4.1 `umbel.toml`, version 3 (D52)

Version 3 is version 2 with `collections` per space (replacing the reserved
`content_roots`, which version 3 refuses), `readers` per space, `[access]`
and `[store]`. The host reads versions 1 and 2 as version 3 with no
collections; `umbel init` writes 3 and creates `spaces/main/`.

```toml
config_version = 3
default_space = "main"
profile = "team"                         # the only value; "org" is refused until its phase (section 13)

[spaces.main]
title = "Main"
readers = ["*"]                          # who may read the space: "*", a principal string or "group:<id>"; default ["*"]

[spaces.main.collections.handbook]
root = "spaces/main/handbook"            # relative to the workspace, resolving inside it
kind = "markdown"                        # "markdown" or "code"
include = ["**/*.md"]                    # globset; default by kind: markdown **/*.md, code see section 7.4
exclude = []
access = ["space"]                       # default access set of its documents
sensitivity = "internal"                 # default sensitivity
default_type = "document"                # type for a file without frontmatter or without `type`
strict = false                           # true: skip a file whose frontmatter fails the schema
max_file_bytes = 1048576                 # 1 MiB; at most 16 MiB

[access.groups.platform]
members = ["human:ada", "agent:ci"]      # principal strings (section 6), or "*"

[store]
lock_timeout_ms = 5000                   # SQLite busy timeout and tantivy writer wait
```

Validation, each `WORKSPACE_CONFIG_INVALID` naming the key, at open:

- A collection id matches `^[a-z][a-z0-9-]{0,62}$` and is unique in its
  space. Two collections of one space may not have overlapping roots.
- `root` is relative, has no `..` segment, and its canonical path is inside
  the canonical workspace root. The root itself may be a symbolic link to a
  directory inside the workspace; nothing inside a root is followed.
- Access tokens and group members follow section 6's grammar. A group named
  in a token must be declared. `readers` is non-empty; each entry is `"*"`,
  a principal string `<kind>:<id>`, or `group:<id>` (section 6).
- `profile` is `team`.

### 4.2 Layout

```text
<workspace>/
├── umbel.toml
├── spaces/<space>/
│   ├── <collection>/            # content, deployer-owned (the root may be elsewhere in the workspace)
│   ├── packs/<plugin>/<pack>/   # pack overrides (D46)
│   └── eval/queries.jsonl       # the space's own eval set (section 10), optional
└── state/spaces/<space>/store/, index/v1/   # section 3.2
```

## 5. The `sources-filesystem` plugin

### 5.1 Identity and the container (D16, D56)

- A **document id** is `<collection>/<path>`, where `<path>` is the file's
  path relative to the collection root with `/` separators and the `.md`
  extension removed (code files keep their extension: `code/src/lib.rs`).
  This is OKF's "path as identity" within the collection. A path that is not
  valid UTF-8, contains a control character, a backslash, or a segment
  starting with `.` is skipped with the warning `SOURCE_PATH_INVALID`. Ids
  are case-sensitive and at most 512 bytes.
- **Frontmatter** is read with AFD's public frontmatter reader (step 0b): a
  first line `---`, one YAML 1.2 core-schema mapping, a line `---`; no tags,
  anchors or aliases; depth 64. Umbel caps it at 64 KiB before calling the
  reader (the cap is Umbel's, not AFD's). The reader distinguishes **no
  frontmatter** (no opening fence: `Ok(None)`) from **malformed**
  frontmatter (a typed error), and returns the body's byte offset and
  1-based line. A file without frontmatter is a document of
  `default_type`, titled by its first level-1 heading or else its file
  name. Malformed frontmatter skips the file with `FRONTMATTER_INVALID`.
- **Field caps.** Frontmatter values copied into every chunk are capped:
  `title` 512 characters, `description` 4 KiB, at most 32 `aliases` and 64
  `tags` (each at most 128 characters). Past a cap the value is cut at a
  character boundary (or the list at the cap), the document gains the flag
  `fields-limited`, and the sync reports the warning `FIELDS_LIMITED`; the
  stored `frontmatter` keeps the original.
- **OKF keys** keep OKF's meanings (W11): `type` (required by OKF; filled
  from `default_type` when absent, with the flag `type-defaulted`),
  `title`, `description`, `resource`, `tags`, `sources`, `generated`,
  `verified`, `status` (`draft`, `stable`, `deprecated`; absent is
  `stable`), `stale_after`. Unknown keys are preserved in the stored
  frontmatter and never refused.
- **Umbel's extension keys**, which OKF consumers ignore: `access` (an
  access set, section 6), `sensitivity`, `owners` (OKF actors, such as
  `human:ada`), `aliases` (alternative names, indexed), `superseded_by` (a
  document id or a `/`-prefixed path, for `deprecated` entries).
- **Reserved files**: `index.md` and `log.md` at any level are stored with
  types `okf-index` and `okf-log`, excluded from search unless the query's
  `type` filter names them, and used by `knowledge-outline` (section 7.3).
  A bundle-root `index.md` may carry `okf_version`; a value other than
  `"0.2"` is the warning `OKF_VERSION_UNKNOWN`.
- **Schema.** The plugin's default pack `frontmatter` holds
  `data/schema.json`, a JSON Schema for the frontmatter (OKF's keys, Umbel's
  extensions, `additionalProperties: true`); a space overrides it whole
  (D46). A document that fails it is stored with the flag `schema-invalid`
  and the warning `FRONTMATTER_SCHEMA`, or skipped when the collection is
  `strict`.

### 5.2 Change detection

`sources-sync` walks each collection root in sorted path order, applying
`include` and `exclude`. For each file: when its size and modification time
equal the stored sync state, it is unchanged; otherwise its bytes are read
and hashed (SHA-256), and only a changed hash writes a document
(`Expect::Hash(previous)`, so a concurrent sync of the same file is a
`Conflict`, retried once, then reported). Stored documents with no file are
deleted (tombstones). The sync state (path, size, mtime, hash per file) is a
record of kind `sync-state` per collection in the instance's namespace.
Files the host process cannot read are skipped with `SOURCE_UNREADABLE`.
A file over `max_file_bytes` is skipped with `SOURCE_TOO_LARGE`. At most
100 000 files per collection; more is `SOURCE_LIMIT` and the sync writes
nothing for that collection. Hard links are indistinguishable from regular
files and are read; a root is the deployer's, and a symbolic link is never
followed (section 4.1).

**Bounded runs.** One call reads at most 64 MiB of file bytes (the
`content` grant's per-call cap) and at most `limit` files (default 5000).
The walk is in sorted path order, so a run that reaches either bound
commits what it wrote and the sync state of the files it reached, stops,
and reports `remaining: true` with the path it stopped after; the next run
continues from there (deletions are detected only by a run that completes
the walk). The first sync of a large collection is therefore several
calls; `knowledge-refresh` reports `remaining` from either step.

### 5.3 Permission mirroring, as far as phase 2 goes

The filesystem carries no principals Umbel can map, so phase 2 mirrors the
permission the content declares:

1. the document's own `access` key, else
2. the nearest `.umbel-access.toml` in its directory or an ancestor up to
   the root (`access = [...]`, `sensitivity = "..."`), which mirrors
   directory inheritance in the systems content is exported from, else
3. the collection's `access` and `sensitivity`.

The resulting access set is the document's and every derived record's.
Operating-system permissions are mirrored only negatively: what the host
cannot read is not ingested. Connectors that mirror a source system's ACLs
come with federation (O1).

### 5.4 The document record, version 1

What `put_document` stores and `knowledge-describe` reports
(`schemas/document.v1.json`):

| Field | Rule |
| --- | --- |
| `version` | `1` |
| `id`, `space`, `collection`, `path` | Identity (section 5.1); `path` relative to the root, with extension |
| `rev` | The revision of this version |
| `contentHash` | `sha256:<hex>` of the bytes |
| `bytes` | The file's bytes (not in `knowledge-describe` output) |
| `frontmatter` | The parsed mapping as JSON, unknown keys kept |
| `type`, `title`, `description`, `tags`, `aliases`, `owners`, `status`, `staleAfter`, `supersededBy` | Normalized from the frontmatter |
| `verification` | `{ "tier": "unverified" \| "machine" \| "human" \| "owner", "last": { by, at } \| null, "count": n }`, derived (section 9.3) |
| `access`, `sensitivity` | Section 5.3 |
| `flags` | Sorted subset of `type-defaulted`, `schema-invalid`, `fields-limited`, `instruction-like`, `hidden-text`, `broken-links` |
| `size`, `lines` | Byte and line counts |
| `envelope` | Provenance envelope version 1, `origin: document-derived`, `sources: [{ "resource": "/<collection>/<path>" }]`, `generated` from the frontmatter |

### 5.5 Commands

| Command | Effects | Grants | Input | Result |
| --- | --- | --- | --- | --- |
| `sources-sync` | `store-write` | `content`, `documents`, `documents_write`, `records`, `records_write`, `packs` | `{ space, collection?, dry_run?, limit? (1 to 100 000, default 5000) }` | Per collection: totals `added`, `updated`, `deleted`, `unchanged`, `skipped` (with counts per reason), `fromRev`, `toRev`, `remaining`; and the ids the caller can read among those added, updated or deleted (at most 100 listed, then a count). `dry_run` writes nothing and is still journaled |
| `sources-status` | `inspect` | `content`, `records` | `{ space, collection? }` | Per collection: totals (file count, changed since the last sync), last sync revision and time, and the changed files whose stored document the caller can read (a stat walk, no reads) |

**What these return (owner decision 1 of 2026-11-01).** Both commands see
every file, and the sync writes documents the caller may not read, so their
results carry **totals plus readable ids**: an id appears only when the
caller's reader filter admits the document's access set (for a deletion,
the access set of the deleted version). Paths of skipped files, whose
access set is unknown because they were not ingested, and of new files not
yet stored, are listed only to a CLI human (who can read the files
anyway); every other caller gets counts and reason codes. The totals reveal
how many hidden files changed, a count leak accepted in section 6. Both
commands stay on every surface, so an agent can refresh the index; the
choice of filtering over CLI-only is recorded in D54.

Record: `{ "kind": "sync", "id": "<space>/<collection or *>", "version": <toRev> }`.

## 6. Access (D53)

**Tokens.** An access token is one of `space` (anyone who may read the
space), `group:<id>` (`<id>` matching `^[a-z][a-z0-9-]{0,62}$`) or
`principal:<kind>:<id>`. An access set is a non-empty list of tokens; a
document is readable by a principal holding any of them.

**Principals.** A principal string is `<kind>:<id>`: `kind` is one of AFD's
actor kinds (`human`, `agent`, `service`, `script`) and `id` the actor id,
1 to 128 characters with no control character (phase 0's rule for
`principal.local_id`). It is split at its **first** colon, so an id may
contain colons. In a token, `principal:<kind>:<id>` is split at its first
two colons. For access the **effective principal** is the person behind the
call when there is one, `human:<onBehalfOf>` (or the actor itself when its
kind is `human`), else the actor. Delegation narrowing (an agent holding
less than its person) is phase 5's (reserved principal field
`delegationChain`).

**Principal strings before phase 5.** The surfaces produce exactly these
(`src/principal.rs`, `src/host/mod.rs`):

| Surface | Actor | Effective principal |
| --- | --- | --- |
| CLI (`umbel`, `umbel-knowledge`) | `human:<principal.local_id>` (default `human:local`); never anything else | The same |
| stdio | `agent:<principal.local_id>`, acting for `principal.on_behalf_of` when set | `human:<on_behalf_of>`, else `agent:<local_id>` |
| Streamable HTTP | `agent:loopback` | `agent:loopback` |
| Library (`Host::context`) | Whatever the embedder sets | As the rule above |

So a deployer who wants one person's CLI approvals and that person's
agents to line up sets `principal.local_id` and `principal.on_behalf_of`
to the same id (`ada`): the CLI is then `human:ada`, and stdio is
`agent:ada` acting for `human:ada`. The README says so.

**The reader filter** for a call in space `s` is built by the host:

1. If the effective principal matches no entry of `spaces.<s>.readers`
   (`*`, its principal string, or a group it is in), the call fails before
   the handler with `SPACE_NOT_READABLE`; nothing else is read.
2. Otherwise the tokens are `space`, `principal:<effective>`, and
   `group:<g>` for every group whose `members` contains `*` or the effective
   principal string.

**Where it applies.** Inside each store query, before ranking and limits
(principle 10): the SQL statement's join, the tantivy query's mandatory
clause, the graph's endpoint check. Derived content inherits the source's
set (chunks, nodes, edges); content whose source the reader cannot open is
denied (architecture section 7). The query syntax cannot name the `access`
field.

**What remains visible (owner decision 4 of 2026-11-01).** No hidden
content or id is returned. Hidden **counts** are not fully hidden, and
phase 2 accepts that:

- BM25 term statistics (document frequency, average field length) are
  computed over the whole space's index, so scores depend on documents the
  caller cannot read, and a caller who varies queries can estimate how many
  hidden chunks contain a term.
- `knowledge-changes` and `event-list` leave gaps in revisions and `seq`
  where unreadable changes and events are skipped; `store-show`'s head
  revision counts every change.
- `sources-sync`, `sources-status` and `knowledge-index` report totals over
  every file (section 5.5, 8.7).

Before phase 5 every local caller is one principal (below), so these leak
nothing a caller could not read from the files. Once phase 5 makes
filtering a boundary they matter: **partitioned statistics (per access set)
or coarsened scores (rank only, or scores rounded to a few levels) are a
phase 5 prerequisite**, in the architecture's prerequisites table and
STATUS.md's follow-ups.

**Before phase 5 (owner decision 1 of 2026-11-01).** Identity still comes
from phase 0's context hook: every stdio caller is one principal, every
HTTP caller is `agent:loopback`, the CLI is always `human:<local_id>`;
embedders set actors through the library surface. Access filtering is
therefore **exact only for embedders and tests** until phase 5 verifies
callers; on stdio and loopback HTTP it is a policy, not a boundary, and it
protects nothing a local process could not read from the files. The README
says so in its own paragraph, and `workspace-show` reports
`"access": { "principals": "unverified", "exact": ["library"] }` (section
2) until phase 5 changes it.

## 7. Chunking and the structural graph

### 7.1 Markdown structure (`umbel-okf`)

`umbel_okf::structure(bytes) -> Structure` parses the body after the
frontmatter with pulldown-cmark (CommonMark, tables, footnotes,
strikethrough, task lists; no HTML rendering), with its offset iterator, and
returns: the heading tree (level, text, slug, line range), blocks (kind,
line range, byte range, text), links (target as written, resolved target,
line), inline code spans, and line offsets. Slugs are lowercase, ASCII
alphanumerics and `-`, with `-2`, `-3` appended to repeats, so they are
stable for a given text.

**Link resolution.** A link's target resolves to a document id when it is a
relative path or a `/`-prefixed path (OKF's bundle-relative form, relative
to the collection root) to a `.md` file of the same collection, with the
`.md` optional; `#fragment` resolves to a heading slug. Absolute URLs are
kept as external links, never fetched. A target that resolves to no stored
document is a broken link, tolerated (OKF), flagged `broken-links`, and
listed by `knowledge-describe`. Links never resolve across collections in
phase 2 except by `/`-prefixed paths that start with another collection's id
(`/runbooks/deploy`), and never across spaces.

### 7.2 Chunking rules (D59)

Words are maximal runs of non-whitespace. For each section (the text under
one heading down to the next heading of any level; a preamble before the
first heading is its own section):

1. Blocks are taken in order. A fenced or indented code block, a table, a
   list item and a block quote are atomic.
2. A chunk accumulates blocks until adding the next would pass **400
   words**; it closes at **240 words** or more at the next block boundary.
3. An atomic block over 400 words alone is split at line boundaries into
   pieces of at most 400 words.
4. A chunk under **40 words** at the end of a section merges into the
   previous chunk of the same section when the result stays at or under 400
   words; otherwise it stands.
5. No overlap. Chunks never cross a section boundary.

Each chunk carries: `ordinal` (from 0, in document order), `lines` (1-based,
inclusive, of the file including frontmatter), `bytes`, `headingPath` (the
heading texts from the top), `contentHash` (`sha256` of its text), and
`text`. Indexed **context** (contextual retrieval without a model) is the
document's title, aliases and description and the chunk's heading path, in
their own fields (section 8.1). The frontmatter is never a chunk; its
`title`, `description`, `tags`, `aliases` and `owners` are fields of every
chunk of the document. At most 2000 chunks per document; past that the
document is indexed with its first 2000 and the flag is reported as the
warning `CHUNKS_LIMITED`. Code collections chunk by symbol (section 7.4).

### 7.3 The structural graph (D60)

Built by `knowledge-index` from each document's structure, deterministically,
per space. Node ids are typed strings:

| Node | Id | From |
| --- | --- | --- |
| Document | `doc:<doc id>` | Every stored document |
| Heading | `heading:<doc id>#<slug>` | Every heading |
| Directory | `dir:<collection>/<dir path>` | Each directory between a root and its documents, and `dir:<collection>` for the root |
| Tag | `tag:<tag>` | `tags` |
| Owner | `owner:<actor>` | `owners` |
| Symbol | `symbol:<language>:<qualified name>` | Code collections (section 7.4) |

| Edge | From → to | Weight |
| --- | --- | --- |
| `contains` | dir → dir, dir → doc, doc → heading, heading → sub-heading | 1 |
| `links_to` | doc → doc, or doc → heading (with a fragment) | Number of links, at most 10 |
| `tagged` | doc → tag | 1 |
| `owned_by` | doc → owner | 1 |
| `supersedes` | the replacement doc → the deprecated doc (from `superseded_by`) | 1 |
| `defines` | code doc → symbol | 1 |
| `mentions` | doc → symbol, when an inline code span equals a symbol's name or qualified name | Count, at most 10 |
| `co_cited` | doc ↔ doc (both directions), stored **per citing document**: origin = the citer, with the citer's access set, one edge per pair of distinct documents it links to | 1 per citer; readers see the sum over the citers they can read (section 3.1), and expansion and `knowledge-related` use a pair only when that sum is at least 2 |

Backlinks are `links_to` read in the incoming direction; every backlink
count (`knowledge-describe`, ranking) counts only origins the caller can
read. Timestamps (the document's `generated.at`, last `verified.at`,
`staleAfter`, the store revision time) are node attributes the commands
filter and sort by, not edges. Co-citation needs no recomputation across
documents: a citer's `co_cited` edges are part of its own contribution and
are replaced with it. A citer contributes pairs from its first 50 distinct
resolved document targets in document order (at most 1225 pairs), so one
document cannot flood the graph; that cap is reported by
`knowledge-describe`. Because the weight is aggregated over readable
citers at query time, a restricted document's links never raise the
co-citation of two public documents for a reader who cannot open it. No
edge crosses spaces. Model-extracted entities are not built (a per-collection
opt-in after phase 2).

### 7.4 Code symbols (tree-sitter, the `code` feature)

A collection with `kind = "code"` holds source files; its default `include`
is `**/*.rs`, `**/*.py`, `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`,
`**/*.mjs`. Grammars: `.rs` tree-sitter-rust, `.py` tree-sitter-python,
`.ts` `LANGUAGE_TYPESCRIPT`, and `.tsx`, `.js`, `.jsx` and `.mjs`
`LANGUAGE_TSX` from tree-sitter-typescript (TSX parses JavaScript and JSX,
so no fourth grammar is built; `tree-sitter-javascript` 0.25, MIT, is the
fallback if the fixtures show a gap). Each
file is a document of type `code` with no frontmatter (access from section
5.3, steps 2 and 3), titled by its path. With the `code` feature the knowledge
plugin parses it with the grammar for its extension and extracts definitions
with one committed query file per language
(`plugins/knowledge/queries/<language>.scm`): Rust `fn`, `struct`, `enum`,
`trait`, `impl` items, `mod`, `const`, `static`, `type`, `macro_rules!`;
Python `def` and `class`; TypeScript and JavaScript `function`, `class`,
`interface`, `type`, `enum`, exported `const`, and methods. The qualified
name joins enclosing names with `::` (Rust) or `.` (others). Chunks are one
per top-level definition (with its doc comments), plus the text between
them in pieces of at most 60 lines; the field `code` holds the symbol
names.

**Budgets.** Parsing uses `Parser::parse_with_options` with a progress
callback that cancels after 2 seconds of wall time; queries use a
`QueryCursor` with `set_match_limit(10_000)` and a progress callback that
cancels after 1 second. The **parse-error rate** is the bytes covered by
`ERROR` nodes, plus one byte per `MISSING` node, divided by the file's
bytes. A file over 1 MiB, a cancelled parse or query, an exceeded match
limit (`did_exceed_match_limit`), or an error rate over 25 % makes the file
indexed as plain text in 60-line chunks with the warning
`CODE_PARSE_DEGRADED` and its reason. The time bounds are a safety net for
pathological input and the one place indexing depends on the machine;
the fixtures stay far below them, so determinism tests are unaffected.
Without the `code` feature code collections are indexed as plain text and
`knowledge-describe` says so.

## 8. The `knowledge` plugin: search, open, find and the graph commands

Kind `compiled`, id `knowledge`, domain `knowledge`, manifest version 2.
Grants: `config`, `log`, `packs`, `clock`, `documents`, `records`,
`records_write`, `index`, `index_write`, `graph`, `graph_write`,
`content_write` (optional: without it, proposals cannot be applied and
`knowledge-approve` answers `PROPOSAL_APPLY_UNAVAILABLE`), `documents_write`
(optional, same), and `content` (optional, same: approve reads the target
file's current bytes to check its hash and to resume, section 9.2).

### 8.1 Index fields and query syntax (D58)

The index schema is fixed by `SearchIndex` version 1; one tantivy document
per chunk:

| Field | Kind | Searchable by default | Boost | Syntax name |
| --- | --- | --- | --- | --- |
| `title` | text, `en_stem` | yes | 3.0 | `title` |
| `aliases` | text, `en_stem` | yes | 2.5 | `aliases` |
| `description` | text, `en_stem` | yes | 2.0 | `description` |
| `headings` | text, `en_stem` (the chunk's heading path) | yes | 2.0 | `headings` |
| `body` | text, `en_stem`, stored (snippets) | yes | 1.0 | `body` |
| `code` | text, `default` tokenizer (symbol names split on `_`, `::`, `.` and case changes by the plugin) | yes | 1.5 | `code` |
| `tags`, `owners`, `type`, `collection`, `status`, `verified`, `sensitivity`, `lang` | raw strings | no | — | same names |
| `path` | raw and text (`default` tokenizer) | no | — | `path` |
| `updated`, `stale_after` | date, fast | no | — | `updated`, `stale_after` (ranges) |
| `meta` | JSON, raw strings, for frontmatter keys the schema pack lists as `filterable` | no | — | `meta.<key>` |
| `doc`, `ordinal`, `lines`, `heading_path`, `chunk_hash` | stored, fast where numeric | no | — | not queryable |
| `access` | raw strings, indexed | no | — | **refused** |

Syntax is the grammar of `tantivy-query-grammar` 0.27 over those fields,
which phase 2 promises to callers as:

| Form | Example |
| --- | --- |
| Terms, default fields, **OR** by default | `rollback canary` |
| Required and excluded | `+rollback -staging` |
| Boolean | `rollback AND (canary OR blue-green) NOT legacy` |
| Phrase, with slop | `"feature flag"`, `"feature flag"~2` |
| Field | `title:rollback`, `tags:platform`, `type:runbook`, `meta.team:infra` |
| Boost | `rollback^3 canary` |
| Range | `updated:[2026-01-01T00:00:00Z TO *]` |
| Prefix | `roll*`, `title:roll*` (at most 256 expansions) |

**Parsing (the review's finding on tantivy 0.27).** tantivy's own
`QueryParser` cannot serve this syntax: it refuses a bare `term*`
(`PhrasePrefixRequiresAtLeastTwoTerms`) and has no clause or expansion
limit. So the backend parses with `tantivy_query_grammar::parse_query` and
**walks the `UserInputAst` itself**, building the tantivy query:

1. Every leaf's field must be one of section 8.1's syntax names; `access`,
   an unknown field and the not-queryable fields are `QUERY_INVALID`. A
   leaf with no field expands to the default fields with their boosts.
2. Counted while walking, each past its limit `QUERY_INVALID`: at most 64
   leaf clauses (after default-field expansion counts as one per written
   leaf), at most 8 distinct named fields, nesting depth at most 16, phrase
   slop at most 8, boosts in `(0, 100]`.
3. (Corrected by step 3, [C1](#amendments-from-step-3): the grammar marks
   `prefix` only on a quoted phrase; the builder itself reads a single
   trailing `*` of an unquoted word.) An unquoted literal that ends in `*` (`roll*`) becomes,
   per field, a one-term
   `PhrasePrefixQuery::new_with_offset(vec![(0, term)])` with
   `set_max_expansions(256)`, which tantivy runs as a term-range scan
   bounded at 256 terms. The prefix is lowercased and **not stemmed**, at
   least 2 characters; the expansion is constant-score, multiplied by the
   field's boost. A quoted `"a b"*` is a phrase prefix with the same
   bound. The grammar's other leaves are `QUERY_INVALID`: `Regex` (which is
   how it reads inner or leading wildcards such as `*b`), `Exists`
   (`field:*`), `Set` and `All` (`*`).
4. Terms and phrases are tokenized with the field's tokenizer (`en_stem`
   or `default`), raw fields take the text as one term, ranges parse as
   RFC 3339 dates on date fields only, `meta.<key>` addresses the JSON field
   only for keys the schema pack lists as `filterable`.
5. The reader filter and the structured filters are added as mandatory
   clauses of the outer `BooleanQuery` (section 3.1), never through the
   text.

Limits: at most 1024 characters plus the counts above; a parse error is
`QUERY_INVALID` with the position the lenient parser reports
(`parse_query_lenient`) and a suggestion that names the valid fields.
Structured filters are also inputs (section 8.2), turned into the same
clauses, so callers need not write syntax.

### 8.2 `knowledge-search` (first-class)

Input (`schemas/knowledge-search.input.json` in the plugin):

| Field | Rule |
| --- | --- |
| `query` | Required, the syntax above |
| `space` or `spaces` | One space (default: the bound default), or 2 to 8 spaces for an explicit multi-space query (section 8.4); not both |
| `filters` | `{ collection?, type?, tags?, status?, verified?: tier[], sensitivity?, updatedAfter?, include_deprecated?: false }` |
| `limit` | Documents, default 10, 1 to 50 |
| `format` | `concise` (default) or `detailed` |
| `expand` | Graph expansion, default `true` |

Ranking, a pure function of the index state and the pack `ranking`
(`data/ranking.toml`, overridable per space; D46):

1. **Chunk retrieval**: BM25 (tantivy's, k1 1.2, b 0.75) with the field
   boosts above, the reader filter mandatory, filters as clauses; top
   `min(400, limit × 8)` chunks.
2. **Document aggregation**: a document's score is its best chunk's score
   plus `0.1 ×` the sum of its next two best; its **best chunk** is the one
   with the highest score, ties by ordinal.
3. **Graph expansion** (when `expand`): for each of the top `limit`
   documents, its readable `links_to` targets, backlinks, `supersedes`
   targets and `co_cited` neighbors (at most 20 per document, by weight then
   id) receive `expansion_weight × parent score × edge factor` (`links_to`
   and backlinks 1.0, `co_cited` 0.5, `supersedes` 0.8; the pack's
   `expansion_weight` defaults to 0.3); a document already in the results
   adds it, one not present enters with it and `matched: false`. An expanded
   document's best chunk is its first chunk.
4. **Status adjustment**: `deprecated` documents are dropped unless
   `include_deprecated`; `draft` multiplies by 0.8; nothing else changes
   order.
5. **Order**: score descending, ties by document id ascending; scores are
   rounded to **4** decimal places first (and reported rounded), so order
   does not depend on the last bits of a float across platforms or
   aggregation order. Every fixture that asserts an exact order is built
   tie-free at that precision (a test checks the gap between neighbours is
   at least 0.001), so the tie rule is never what an exact-order assertion
   depends on.

Each **hit** (concise):

```json
{
  "space": "main",
  "doc": "handbook/deploy/rollback",
  "title": "Rolling back a deployment",
  "type": "runbook",
  "score": 12.4815,
  "matched": true,
  "snippet": "…revert the **canary** before the fleet…",
  "locator": "umbel:main/handbook/deploy/rollback#L12-L40@9f2c1a7b0d3e",
  "status": "stable",
  "verification": "human",
  "stale": false,
  "flags": [],
  "trust": "content"
}
```

`detailed` adds `description`, `tags`, `owners`, `headingPath`, `lines`,
`updated`, `sensitivity`, `contentHash`, the locator object (section 8.3)
and up to three `chunks` (each with ordinal, lines, heading path, snippet
and score). Snippets come from tantivy's snippet generator over the best
chunk's `body`, at most 240 characters (concise) or 480 (detailed),
highlighted with `**`.

The result's `sources` are one AFD `Source` per hit, in order:
`{ "type": "document", "id": "<space>:<doc>", "title", "location": "L12-L40", "relevance" }`,
`relevance` the hit's score divided by the top score (1 for the first);
`url` is never set (no filesystem path leaks); the plugin sets them with
the SDK's `Outcome::with_sources`. `metadata` carries `dev.umbel/index`:
`{ "<space>": { "applied": rev, "head": rev, "schema": 1 } }` and
`dev.umbel/trust: "content"`, both admitted by the gate's allow-list
(section 3.3, rule 7). `confidence` is not set: BM25 scores are
not probabilities.

Warnings (AFD `warnings`): `INDEX_STALE` (applied behind head; details give
both), `STALE_CONTENT` (hits past `stale_after`, ids listed),
`UNVERIFIED_CONTENT` (only when the instance's `warn_unverified = true`),
`CONTENT_FLAGGED` (hits with `instruction-like` or `hidden-text`),
`RESULTS_LIMITED` (fewer hits returned than asked, to fit the output budget;
section 8.6). An empty result is a success with no hits and the suggestion
to relax the query or check `INDEX_STALE`.

The instance configuration's `verified_only = true` (default `false`)
restricts every search and open to documents whose tier is `human` or
`owner`, for deployments that run agents verified-only (proposal,
"Provenance and verification").

### 8.3 Locators (D61)

The **locator object** (`schemas/locator.v1.json`):

```json
{
  "version": 1,
  "space": "main",
  "doc": "handbook/deploy/rollback",
  "chunk": 3,
  "lines": { "start": 12, "end": 40 },
  "headingPath": ["Deploy", "Rolling back"],
  "contentHash": "sha256:9f2c1a7b0d3e...",
  "indexVersion": "main@1842/1"
}
```

`indexVersion` is `<space>@<applied rev>/<index schema>`. The **locator
string** is `umbel:<space>/<doc>#L<start>-L<end>@<first 12 hex of the
content hash>`, accepted by `knowledge-open` as `locator`. A locator stays
valid while the document's content hash is the same; when it differs,
`knowledge-open` serves the current content with the warning
`DOCUMENT_CHANGED` and the new hash.

### 8.4 Spaces and multi-space queries

Every knowledge command takes `space` (default: the default space, as phase
0's space middleware resolves it) and touches only that space's stores.
`knowledge-search` accepts `spaces` (2 to 8, distinct; a host input, section
3.3 rule 9): the host's plugin gate checks that the instance is enabled for each (`PLUGIN_NOT_ENABLED`)
and the reader filter checks each (`SPACE_NOT_READABLE`) before anything
runs; the plugin searches each space separately with that space's reader
filter, then fuses the per-space rankings by **reciprocal rank fusion**
(`1 / (60 + rank)`, ranks from 1, ties by space then document id), because
BM25 scores of different indexes are not comparable. Every hit keeps its
`space`; `score` becomes the fused score and `spaceScore` the space's own.
Nothing is written back; the graph expansion runs within each space before
fusion. A multi-space search is journaled once, a read, with no event. All
other commands are single-space, except `knowledge-eval` (section 10.3).

### 8.5 The other read commands

| Command | Input | Result |
| --- | --- | --- |
| `knowledge-open` (first-class) | `{ space, doc \| locator, from_line?, lines? (default 120, 1 to 400), chunk?, heading?, expect_hash? }`; `chunk` and `heading` (a slug) select their line range, at most 400 lines | `{ doc, title, contentHash, totalLines, window: { start, end }, text, nextFromLine \| null, prevFromLine \| null, headingPath, locator, status, verification, trust: "content" }`; warnings `DOCUMENT_CHANGED`, `STALE_CONTENT`, `CONTENT_FLAGGED`, `WINDOW_LIMITED` (the window was shortened to fit the budget). Not found or not readable: `DOCUMENT_NOT_FOUND` (one code for both) |
| `knowledge-find` | `{ space, doc, pattern, regex? (false), case_sensitive? (false), context_lines? (0 to 5, default 1), max_matches? (default 20, at most 100) }` | Matches in one document: `{ line, column, text, before[], after[] }` and their locators; a regex is compiled with `regex`'s size limit of 1 MiB and no backreferences (the crate has none); `QUERY_INVALID` otherwise |
| `knowledge-describe` | `{ space, doc }` | The document record (section 5.4) without `bytes`, plus `outline` (heading tree), `links` (resolved, broken, external), `backlinks` count (readable citing documents only), `chunks` count, index and graph applied revisions, and `codeIndexing` for code documents |
| `knowledge-list` | `{ space, collection?, prefix?, type?, after?, limit? (default 50, at most 500) }` | Readable documents: id, title, type, status, verification, updated; `nextAfter` |
| `knowledge-changes` | `{ space, after_rev, limit? (default 100, at most 1000), trace? }` | Readable changes (section 3.1) with document ids and hashes, for event consumers that follow `changes`; with `trace` (an event's `traceId`), only that call's changes. Revisions skip unreadable changes |
| `knowledge-neighbors` | `{ space, node \| doc, kinds?, direction? (out, in, both; default both), limit? (default 50, at most 200) }` | Readable edges with the other node's id, kind, label and weight |
| `knowledge-related` | `{ space, doc, limit? (default 10, at most 50) }` | Documents ranked by `3 × links either way + 2 × co_cited weight + 1 × shared tags + 1 × shared owners + 0.5 × shared parent directory`, ties by id; each with the reasons |
| `knowledge-path` | `{ space, from, to, max_hops? (default 4, 1 to 6), kinds? }` | The shortest readable path by breadth-first search over the readable subgraph (ties by node id order), or `PATH_NOT_FOUND` |
| `knowledge-outline` | `{ space, doc }` or `{ space, collection, prefix? }` | A document's heading tree; or a directory tree of readable documents (titles, types), with each directory's `index.md` description when present, at most 1000 entries and a `truncatedAt` cursor |
| `knowledge-stale` | `{ space, as_of? (default now), collection?, limit? }` | Readable documents past `stale_after`, `deprecated` ones without a resolvable `superseded_by`, and those never verified, each with the reason |

All are `inspect`. Every content-bearing field is labeled `trust:
"content"` (section 11).

### 8.6 Output budgets (D64; AFD step 0)

**Phase 2 needs per-tool output budgets**: a search, a window or an outline
can be arbitrarily large, and principle 12 asks for small, measured
surfaces. Under D25 the mechanism is AFD's, specified for every language
and implemented in Rust as step 0 of the plan. What the knowledge commands
do with it:

- Each read command declares a budget in its manifest entry through the
  AFD field step 0 adds, mapped by the loader to
  `CommandDefinition::with_output_budget` (compiled plugins only in phase
  2, section 3.4): `knowledge-search` default
  24 000 bytes, maximum 96 000; `knowledge-open` 32 000 and 128 000;
  `knowledge-find`, `-describe`, `-list`, `-changes`, `-neighbors`,
  `-related`, `-path`, `-outline`, `-stale` 16 000 and 64 000. (Manifest
  version 2 adds the command key `output_budget = { default_bytes,
  max_bytes }`.)
- The handler reads the effective budget from `CallContext.output_budget`
  (`Option<u64>`, `None` for a command without one; the host copies AFD's
  `CommandContext::output_budget()` into it) and **fits its result to it
  structurally**: fewer hits (then
  `RESULTS_LIMITED`), shorter snippets, a shorter window (then
  `WINDOW_LIMITED` with `nextFromLine`), fewer list entries (then a cursor).
  It never truncates JSON. AFD's own check (step 0) is the backstop.
- Callers ask for a smaller or larger budget per call through AFD's
  mechanism, up to the command's maximum.

### 8.7 Index maintenance and the pipeline

| Command | Effects | Input | Result |
| --- | --- | --- | --- |
| `knowledge-index` | `store-write` | `{ space, rebuild? (false), limit? (changes per call, 1 to 100 000, default 10 000) }` | The procedure below. Reports `fromRev`, `toRev`, totals (documents indexed and removed, chunks, nodes, edges, broken links), the ids the caller can read among the documents indexed or removed (at most 100, then a count), and `remaining` when `limit` stopped it. Record `{ "kind": "index", "id": "<space>", "version": <applied> }` |
| `knowledge-refresh` (pipeline, D3) | `store-write` | `{ space }` | Steps: `sources-sync { space: $input.space }`, then `knowledge-index { space: $input.space }`. Composition at the call site: not registered when `sources-sync` is absent (phase 1 section 8.5). Reports `remaining` from either step |

**The indexing procedure** (the review's concurrency finding). Several
processes may run `knowledge-index` for one space at once; the procedure
makes them take turns and never lowers what the index or graph reflects:

1. **Take the index writer first** (`index_writer`, bounded wait, else
   `STORE_BUSY`, retryable). Holding it serialises indexers, including
   their graph writes, across threads and processes.
2. Only then read `index_applied` (under the writer) and `graph_applied`,
   and set `from = min(index, graph)`. With `rebuild`, stage `clear` and an
   empty-everything graph batch, and set `from = 0`.
3. Read changes after `from` with `derive_changes`, at most `limit`, and
   `to` = the last one's revision (or `from` when there are none). For each
   changed document, `derive_document` and build its chunks and graph
   contribution **in memory**; a store whose applied revision is already at
   or past a change's revision skips that change, so a run after a crash
   between the two commits redoes only the lagging store.
4. Stage the index replacements in the writer session; build one
   `GraphBatch`.
5. Commit the graph with `graph_apply(batch, max(graph applied, to))` (one
   `BEGIN IMMEDIATE`), then the index with `commit(max(index applied,
   to))`, then release the writer. Neither ever lowers its revision; a
   `Conflict` (another writer got there, which the writer lock should
   prevent) aborts the run with `STORE_CONFLICT` and leaves both stores as
   committed.
6. Run the best-effort WAL checkpoint (section 3.2).

`knowledge-index` is idempotent and resumable: a crash between the graph
commit and the index commit leaves the index behind, and the next run
starts from the smaller applied revision and redoes only the index's part.
Bounded by `limit`, a run on a large backlog returns `remaining: true`;
callers run it again.

**Approve does not index.** `knowledge-approve` (section 9.2) writes the
document and leaves indexing to the next `knowledge-index` or
`knowledge-refresh`: an indexer must apply changes in revision order, so
it cannot index one document out of turn, and approve must not wait on an
indexer's lock. Its result says `indexed: false` with the suggestion to run
`knowledge-refresh`; search reports `INDEX_STALE` until then.

### 8.8 First-class suggestions and exposure

The manifest marks `knowledge-search` and `knowledge-open` `first_class =
true` (D45): with no `mcp.first_class_tools`, `tools/list` holds
`workspace-show`, `event-list`, `knowledge-search`, `knowledge-open` and the
five meta-tools; every other command is reached by lazy discovery and
`afd-call`. `knowledge-approve`, `knowledge-reject`, `knowledge-verify` and
`knowledge-eval` are `expose = { mcp = false, agent = false, cli = true }`
(section 9.2); everything else is exposed on every surface.

## 9. Proposals and the verification lifecycle

### 9.1 The proposal record, version 1 (D62, D17)

The knowledge base changes only by proposal (principle 8). Phase 2 defines
the record and its commands; phase 4's curator becomes one more proposer.
A proposal is a record of kind `proposal` in the knowledge instance's
namespace, in the target's space (`schemas/proposal.v1.json`):

| Field | Rule |
| --- | --- |
| `version` | `1` |
| `id` | `p-` and the first 20 hex of SHA-256 of `<space>\0<proposer actor string>\0<idempotency_key>` |
| `idempotencyKey`, `changeHash` | The caller's key, and `sha256:` of the canonical JSON of `change`, `rationale` and `evidence` |
| `space`, `area` | The target's space; the area id that governs it (section 9.2) |
| `state` | `pending`, `approved` (decided, not yet applied), `applied`, `rejected`, `withdrawn` |
| `change` | `{ "op": "create" \| "update" \| "deprecate" \| "verify", "doc", "baseHash" (null only for create), "content"? (the whole new file, for create and update, at most `max_file_bytes`), "supersededBy"? (deprecate), "verification"? ({ note?, staleAfter? }, verify) }` |
| `diff` | A unified diff (3 lines of context) of the file before and after, computed at submission by `similar`; for `deprecate` and `verify`, the frontmatter change the apply step will write |
| `rationale` | Required, at most 4000 characters |
| `evidence` | 1 to 32 entries `{ "kind": "document" \| "url" \| "text" \| "record", "ref", "contentHash"?, "excerpt"? (at most 1000 characters) }`; a `document` entry must name a readable document and its current hash, checked at submission |
| `provenance` | Envelope version 1 of the submission |
| `policy` | `{ "area", "version": "sha256:<hex of the canonical JSON of the area's policy>", "rule": "person" }` |
| `exception` | `null`, or `"self-approval"` when the approving actor is the proposing actor and the area allowed it |
| `proposer` | `{ "actor", "principal", "run"? }`: the AFD actor (with its `kind`, so an agent's proposal is recorded with `actor.kind = "agent"`), the effective principal string, and the caller's run id when given |
| `confidence` | `null` or the proposer's confidence in `[0, 1]`; copied to the applied document's envelope |
| `decision` | `null` until decided: `{ "by" (actor), "principal", "at", "reason"?, "traceId", "proposerKind" }` (`proposerKind` repeats `proposer.actor.kind`, so a person approving their own agent's proposal is visible in the decision) |
| `result` | `null` until applied: `{ "rev", "contentHash", "path" }`, or `{ "error" }` when an apply failed |
| `flags` | The write scan's flags on the proposed content (section 11) |
| `createdAt`, `updatedAt` | From the command context's clock |

**`knowledge-propose`'s input** (`schemas/knowledge-propose.input.json` in
the plugin, closed):

| Field | Rule |
| --- | --- |
| `space` | As every command |
| `idempotency_key` | Required, 1 to 128 printable characters, chosen by the caller (a run id plus a step works) |
| `change` | Required; the `change` shape above. `content` must be valid UTF-8 and, for a markdown collection, the whole file including frontmatter |
| `rationale` | Required, 1 to 4000 characters |
| `evidence` | Required, 1 to 32 entries, the shape above |
| `confidence` | Optional, a number in `[0, 1]` |
| `run` | Optional, at most 128 characters |

**Idempotency.** The id depends on the space, the proposer's actor string
and the key. Submitting a key again with the same `changeHash` returns the
existing proposal, in whatever state, with `created: false` and writes
nothing. Submitting it with a **different** `changeHash` is
`PROPOSAL_KEY_REUSED` (not retryable; suggestion: use a new key), and the
existing proposal is unchanged, so a retry can never silently replace what
an approver saw.

### 9.2 Areas and approval

Areas are the knowledge instance's configuration:

```toml
[plugins.knowledge.config.areas.handbook]
space = "main"
collection = "handbook"
prefix = ""                         # document id prefix inside the collection; "" is the whole collection
approvers = ["group:kb-owners"]     # "principal:human:<id>" or "group:<id>" tokens (section 6); default [], any human actor
allow_self_approval = false
```

The most specific area (longest `collection/prefix`) governs a document. A
proposal for a document no area covers is `PROPOSAL_NO_AREA`. Phase 2's only
rule is **`person`**: a human approves. Deterministic auto-approval rules
are phase 4's (section 13).

**Who may approve (owner decisions 2 and 3 of 2026-11-01).**

- The approving actor must be a **human**, at a terminal: approve, reject
  and verify are CLI-only and declare `confirm = "require-human"`
  (section 3.4), so `--yes` and `--approve` are refused and the prompt
  needs stdin and stderr terminals. Before phase 5 the approving actor is
  therefore always `human:<principal.local_id>` (section 6).
- **Matching `approvers`.** The approving actor string `human:<id>`
  matches an entry `principal:human:<id>`, or `group:<g>` whose `members`
  hold `human:<id>` or `*`. `approvers = []` admits any human actor. Entries
  naming another kind are `WORKSPACE_CONFIG_INVALID` at open: only humans
  approve.
- **The approver must be able to read the target** (and, for `create`, the
  collection's resolved access set) under their own reader filter;
  otherwise `PROPOSAL_NOT_FOUND`, because the confirmation prompt and the
  diff would show what they may not read.
- **Self-approval** is refused (`PROPOSAL_SELF_APPROVAL`) only when the
  approving actor string equals the **proposing actor** string and the
  area's `allow_self_approval` is false; when it is true the approval
  proceeds with `exception: "self-approval"`. A person approving **their
  own agent's** proposal (proposer `agent:ada` acting for `human:ada`,
  approver `human:ada`) is not self-approval: it is allowed, with
  `exception: null`, and recorded through `proposer.actor.kind = "agent"`
  and `decision.proposerKind`.

Commands:

| Command | Effects | Exposed | Approval and confirmation | Contract |
| --- | --- | --- | --- | --- |
| `knowledge-propose` | `store-write` | every surface | none | Validates (schema, sizes, `baseHash` equals the current hash, evidence readable, the proposer can read the target, or for `create` the collection), scans, computes the diff, stores `pending`. Record `{ kind: "proposal", id, version: rev }` |
| `knowledge-proposal-list` | `inspect` | every surface | none | `{ space, state?, area?, after?, limit? }`, proposals whose target the caller can read |
| `knowledge-proposal-show` | `inspect` | every surface | none | `{ space, proposal }`: the record, with `diff` and flags |
| `knowledge-withdraw` | `store-write` | every surface | none | The proposer withdraws a `pending` proposal |
| `knowledge-approve` | `store-write`, `workspace-write` | CLI only | AFD `approval = "required"`, `confirm_prompt` (the diff summary and the flags) and `confirm = "require-human"` | The caller must pass **Who may approve** above; the target's current hash (read through `content`) still equals `baseHash` (else `PROPOSAL_CONFLICT`, state unchanged). Steps: set `approved` with `decision`; write the file through `content_write` with the expected hash; `put_document` with origin `user-stated` when the proposer was a human, else `agent-inferred`, `confidence` from the proposal, `sources` the evidence's documents, and `derivedFrom: [{ "kind": "proposal", "id", "contentHash": <the proposal record's hash> }]`; set `applied` with `result`. It does not index (section 8.7): the result has `indexed: false`. Re-running it on an `approved` proposal resumes and skips steps already done (the file's hash already equals the target) |
| `knowledge-reject` | `store-write` | CLI only | `confirm_prompt` and `confirm = "require-human"` | A human approver (same rules) rejects with a required `reason` (at most 2000 characters) the curator reads next run |

Over MCP and to in-process agents, approval waits for the MCP approval relay
(phase 4, architecture prerequisites); until then approve and reject are
CLI-only, where AFD's private in-process approval exchange runs (phase 0
section 4). The AFD approval gates only the apply command (D17).

### 9.3 Verification lifecycle (D63, D15)

In OKF's terms (W11):

- **Tier**, derived from `verified`: none is `unverified`; only non-`human:`
  actors is `machine`; any `human:` actor is `human`; a `human:` actor who
  is in the document's `owners` is `owner`, the owner tier.
- **Status**: `stable` (absent included), `draft`, `deprecated`. An applied
  `create` or `update` proposal sets `status: stable` unless the content
  says otherwise.
- **Stale**: `now ≥ stale_after`, with `now` from the command context's
  clock.

`knowledge-verify` (CLI only, `store-write` and `workspace-write`, AFD
`approval = "required"`, `confirm = "require-human"`): `{ space, doc, note?,
stale_after?, apply? (true) }` submits a `verify` proposal as the calling
human. When that human matches the area's `approvers` and `apply` is true,
the same call approves and applies it, and the one proposal records both:
`proposer.principal` and `decision.principal` are the same human, with
`exception: null`, because a verification is the approver's own attestation,
not a change someone else wrote (D63). Otherwise the proposal stays
`pending` for an approver.

Applying a `verify` appends `{ by: "human:<id>", at: now }` to `verified`
(a single mapping is first turned into a one-element list, as OKF allows)
and sets `stale_after` when given; applying a `deprecate` sets `status:
deprecated` and `superseded_by`. Both are **frontmatter-only rewrites** by
`umbel_okf::rewrite_keys`: each named top-level key's lines (the key line and
its more-indented continuation lines) are replaced by a canonical block, or
appended before the closing `---` when absent; every other byte of the file
is unchanged, comments included.
The curator's scheduled re-verification and inconsistency proposals are
phase 4's; `knowledge-stale` is the list it will read.

## 10. The eval harness (D65)

### 10.1 The thousand-document fixture

`umbel_plugin_knowledge::eval::fixture::generate(seed: u64, out: &Path) -> FixtureManifest`
writes a workspace with two spaces, **1000 markdown documents plus 50 code
files** (1050 documents), **entirely synthetic**: words come from a pseudo-word generator (syllables from fixed
lists combined by a PCG32 stream implemented in the module, not the `rand`
crate, so the output never changes with a dependency), and no real product,
organization, person or system is named. The default seed is `20261101`.

| Space | Collection | Documents | Content |
| --- | --- | --- | --- |
| `alpha` | `handbook` | 450 | Concept, runbook, decision and glossary entries with frontmatter (OKF keys and Umbel's), 3 to 7 sections, 0 to 6 links, 1 to 4 of 40 tags, owners, `generated`; 30 % verified (half by `human:` actors, some of them owners), 10 % past `stale_after`, 5 % deprecated with `superseded_by`; 10 % with `access = ["group:restricted"]` |
| `alpha` | `runbooks` | 150 | Step-by-step runbooks linking to handbook entries |
| `alpha` | `code` | 50 | Rust and Python source files whose symbols handbook entries mention in inline code |
| `beta` | `notes` | 400 | Notes with their own topics and vocabulary, some sharing alpha's pseudo-words so a leak between spaces would be visible |

Each **topic** plants a unique key term in exactly one answer document
(and in passing in up to two others), aliases in the answer's `aliases`, a
phrase, and a chain: a bridge document holding a bridge term and linking to
the answer. The generator writes `spaces/*/…`, a `umbel.toml` (version 3,
both spaces, the `restricted` group), and `eval/queries.jsonl`. A test pins
the SHA-256 of the generated tree (sorted paths and bytes) as a constant,
so the fixture is identical on Linux and macOS and across runs; changing the
generator changes the constant in the same pull request. The generator
also plants exactly 12 documents whose text matches the write scan (8
`instruction-like`, 4 `hidden-text`), so the scan's flag count on the
fixture is asserted, not guessed.

A test (`eval_fixture.rs`) checks the vocabulary **under `en_stem`**:
every topic's key term stems to a token no other topic's key term or alias
stems to, and no word of the unanswerable queries stems to a token the
generator emits anywhere. Otherwise stemming could merge two topics or
make an "unanswerable" query answerable.

### 10.2 The query set, version 1

One JSON object per line (`schemas/eval-queries.v1.json`):

```json
{ "version": 1, "id": "q-0042", "kind": "multi-hop", "query": "valtrin osmerid",
  "spaces": ["alpha"], "principal": "human:eval-reader", "filters": {},
  "qrels": { "alpha:handbook/topics/t-017": 2, "alpha:handbook/bridges/b-017": 1 },
  "unanswerable": false }
```

The seeded set has 220 queries: 80 `exact`, 30 `alias`, 20 `phrase`, 20
`field` (a tag or type filter plus a term), 20 `multi-hop` (the query holds
only the bridge term; the answer is reached through `links_to`), 15
`cross-space` (`spaces: ["alpha", "beta"]`, answer in `beta`), 15
`unanswerable` (pseudo-words the generator never emits), and 20 `permission`
probes run as a principal outside `restricted` whose planted answers are
restricted (expected: no restricted document returned). Grades are 2 (the
answer) and 1 (bridges and passing mentions).

**What counts toward which metric.** recall@k, nDCG@k and MRR@k are over
the **answerable** queries: `exact`, `alias`, `phrase`, `field`,
`multi-hop` and `cross-space` (185 queries); a `cross-space` query is
scored on the fused list. `unanswerable` queries count only toward the
unanswerable rate, and `permission` probes only toward `leaks` (their
qrels list the restricted answers for the member run of the exit test, not
for the metrics). A deployer writes the same
shape by hand in `spaces/<space>/eval/queries.jsonl` with their own content.

### 10.3 Metrics and the report

`knowledge-eval` (CLI only, `inspect`): `{ spaces? (the host-checked
`spaces` input of section 3.3, rule 9; without it, the default space; the
exit test passes `["alpha", "beta"]`), queries? (path in the workspace; default each space's
eval/queries.jsonl), k? (default 10), expand? (both | on | off; default
both) }`. A query whose `spaces` are not all in the call's spaces is
reported as skipped, never run. It writes nothing: the report
**is the result** (printed on stdout by the CLI; CI redirects it to a file
and uploads it). It does not rebuild; a caller that wants the rebuilt-index
numbers of section 3.2 runs `knowledge-index rebuild=true` first, as the
exit test does. It runs each
query through the same code path as `knowledge-search` as the query's
principal, through `CallServices::as_reader` (section 3.3, rule 5), which the
host allows only to a CLI-only command called by a human, and reports
(`schemas/eval-report.v1.json`):

- **recall@k**: the fraction of grade-2 documents in the top k, averaged
  over answerable queries; **nDCG@k** with gain `2^grade − 1` and discount
  `log2(rank + 1)`; **MRR@k**; each overall and per `kind`, with expansion
  on and off.
- **unanswerable**: the fraction of unanswerable queries with no hit, and
  the mean top score of those with hits.
- **leaks**: the count of returned documents the query's principal may not
  read, plus any hit outside the query's `spaces`. Must be 0.
- **latency**: p50 and p95 in milliseconds (reported, never gated).
- **logged results**: per query, the ranked document ids and scores, so a
  run can be diffed; the corpus digest, index applied revisions, the pack
  `ranking` digest and the host version.

### 10.4 The gate and the optional lanes

- **CI gate** (the `knowledge-eval` assertions of section 12): on the seeded
  fixture with a rebuilt index, `leaks = 0`; unanswerable empty rate `1.0`;
  recall@10 ≥ 0.85 and nDCG@10 ≥ 0.70 overall; multi-hop recall@10 with
  expansion ≥ without; and no metric more than 0.02 below
  `plugins/knowledge/eval/baseline.json`, which step 9 commits from its
  first passing run and any later ranking change updates, with the report
  diff, in its own pull request.
- **Optional lanes** (O4): a vector lane, a rerank lane and model-extracted
  entities are not built. The gate a later lane must pass on **an
  instance's own query set** before the instance may enable it: nDCG@10 at
  least 0.01 above BM25 with expansion, recall@10 not more than 0.005 below,
  `leaks = 0`, over **at least 50 answerable queries** (fewer, and the gate
  cannot pass: a 0.01 difference on a handful of queries is noise),
  recorded as an eval report committed beside the instance's
  configuration. The seams are in section 13.

## 11. Security

- **Content is untrusted on read** (principle 9). Every hit, window, match,
  outline entry and proposal body carries `trust: "content"`, and every
  result that includes content has `metadata["dev.umbel/trust"] =
  "content"`. Content appears only inside JSON string fields; the plugins
  never place content in `reasoning`, `suggestions`, error messages or
  warning messages (warnings name ids, not text). Skills of these plugins
  tell agents that retrieved text is data, not instructions.
- **Scanned on write.** Ingestion and proposals run the write scan:
  `instruction-like` (phase 1's `description-injection` patterns,
  `src/plugins/mounted/scan.rs`, moved to the small `umbel-scan` crate so
  the host's mounted loader and `umbel-okf` use one list without the host
  linking pulldown-cmark), `hidden-text` (zero-width and bidirectional control characters,
  Unicode tag characters U+E0000 to U+E007F, HTML comments longer than 200
  characters). Ingestion **flags and does not block** deployer content
  (section 15); a flagged hit carries its flags and the `CONTENT_FLAGGED`
  warning; a proposal with flags shows them in `knowledge-proposal-show` and
  in approve's confirmation prompt. **Expected noise:** the patterns were
  written for tool descriptions, where imperative text addressed to a model
  is rare; in documents it is common (a runbook saying "ignore the previous
  step's output", "you must now run"). Flags are therefore advisory and
  expected on a few percent of ordinary documents; step 5 records the flag
  rate on its fixtures in the pull request, and the eval fixture asserts
  its planted count (section 10.1).
- **Size caps.** Files `max_file_bytes` (default 1 MiB, at most 16 MiB);
  frontmatter 64 KiB; 2000 chunks per document; 100 000 files per
  collection; queries 1024 characters and 64 clauses; prefix expansion 256;
  regexes 1 MiB compiled; proposals' content `max_file_bytes`, rationale
  4000 characters, 32 evidence entries; results by output budget; records
  2 MiB.
- **No path leaks**: results carry document ids, never filesystem paths
  outside the collection; `url` is never set on sources.
- **Confinement**: collection roots inside the workspace (section 4.1);
  symbolic links inside roots not followed; hard links read as files and
  replaced, not written through; `content_write` writes only to
  allowed collections, only to a path that resolves inside the root, only
  `.md` files for markdown collections, never `index.md` or `log.md`.
- **Prompt-injection surfaces**, each with its control: document bodies and
  frontmatter (labeled, scanned, flagged); document titles and descriptions
  in hits (labeled; the scan covers frontmatter values); proposal rationale
  and evidence excerpts (labeled, scanned, shown to the approving human);
  tool descriptions (fixed by the plugins, checked by `afd validate
  --surface` in CI); the eval set (CLI only).
- **Approvals**: CLI-only apply, human approvers who can read the target,
  `confirm = "require-human"` (terminal only; `--yes` and `--approve`
  refused), self-approval by the same actor refused unless the area allows
  it, AFD approval tokens never over MCP (phase 0), area policy version
  recorded.
- **Audit**: every write is journaled with the actor and the person it
  acted for; each store change records its trace id and time, so the
  journal and the store cross-check (D66), with `store-check` ignoring
  changes too recent or still open to have their journal entry yet.
- **Events and index-building outputs** are filtered to what the caller can
  read: `event-list` by the envelope's `access`, sync and index results to
  totals plus readable ids (sections 2.2, 5.5, 8.7).

## 12. Exit criterion and tests

The exit criterion is met when `umbel.yml` is green on `main` with every
test below, and `tests/exit_thousand.rs` (in `plugins/knowledge`) passes in
it: it generates the fixture with seed `20261101`, opens a host with
`compiled:sources-filesystem` and `compiled:knowledge` enabled for both
spaces through the test kit, runs `knowledge-refresh` for `alpha` and
`beta`, and asserts:

1. **A thousand documents indexed across two spaces**: after
   `knowledge-index rebuild=true` in each space, `store-show` (as the CLI
   human) reports 650 documents in `alpha` (600 markdown, 50 code) and 400
   in `beta`, 1000 of them markdown, and both indexes' and graphs' applied
   revisions equal their heads.
2. **No result crosses spaces without an explicit multi-space query**:
   every single-space query of the seeded set returns only that space's
   hits, including the queries whose pseudo-words occur in both spaces; the
   15 `cross-space` queries return `beta` hits only with `spaces`, each
   labeled; `knowledge-open`, `-neighbors`, `-path` and `-related` with a
   document of the other space answer `DOCUMENT_NOT_FOUND` or
   `PATH_NOT_FOUND`.
3. **Results filtered by principal**: the 20 permission probes return no
   restricted document as `human:eval-reader` and return the answers as a
   member of `restricted`; `knowledge-open` of a restricted document is
   `DOCUMENT_NOT_FOUND` for the outsider; `knowledge-neighbors` and
   `knowledge-path` never name a restricted node for the outsider; a space
   with `readers = ["group:restricted"]` refuses the outsider with
   `SPACE_NOT_READABLE`.
4. **Recall and ranking reported**: `knowledge-eval` returns a report that
   validates against `eval-report.v1.json` and meets the gate of section
   10.4; the test writes it to a file the CI job uploads as an artifact.

**CI.** Steps 2 to 10 run in their own `umbel.yml` job, `knowledge`
(`cargo test -p umbel-store -p umbel-store-embedded -p umbel-okf -p
umbel-scan -p umbel-plugin-sources-filesystem -p umbel-plugin-knowledge`),
with its own `timeout-minutes` and the eval report uploaded with
`actions/upload-artifact` (pinned by SHA). Step 3 measures the job on CI
and sets the timeout to three times the measured time, recorded in its
pull request; the existing jobs keep their timeouts and do not build
SQLite or tantivy.

| Test file | Crate | Covers |
| --- | --- | --- |
| `packages/rust/tests/output_budget.rs` | `afd` (step 0b) | Every case of `spec/output-budgets.json` over stdio and Streamable HTTP in both eras and in process |
| `packages/rust/src/frontmatter.rs` (unit tests, moved and made public) | `afd` (step 0b) | The public API keeps the existing rules; `Ok(None)` without an opening fence; typed errors; body offsets |
| `tests/schemas.rs` (extended) | host | Every new schema and example; version 0 and 1 events side by side |
| `tests/config_v3.rs` | host | Collections, roots inside and outside, symlinked roots, readers, groups, reading versions 1 and 2 |
| `tests/manifest_v2.rs` | host | `store-write` and `workspace-write` with and without their grants; version 1 still loads; `output_budget` (compiled only); `confirm = "require-human"` (needs `confirm_prompt` and CLI-only exposure) |
| `store/tests/suite_detects.rs` | `umbel-store` | The suite's own cases against a deliberately broken in-memory fake backend fail where they should (the suite detects leaks, gaps, lost writes, lowered `applied` and unfiltered co-citation weights) |
| `store-embedded/tests/conformance.rs` | `umbel-store-embedded` | `conformance::run_all` against the embedded backend |
| `store-embedded/tests/multiprocess.rs` | `umbel-store-embedded` | Two child processes (`spawn_writer`, the test binary re-run) writing documents and the index of one space concurrently: dense revisions, no lost write, readers see each commit whole; a writer past the lock timeout gets `Busy`; two indexers take turns and neither lowers `applied` |
| `tests/store_grants.rs` | host | Each grant granted, denied, withheld; write grants without `allow`, with entries outside the instance's spaces, and writes outside `allow`; components and mounts refused store grants; derivation reads refused without `store-write`; envelope refusals; `dev.umbel/changes` and event `changes`; the gate's allow-list (`index`, `trust: "content"` kept, other `trust` values and forged `changes` dropped, mounted stays `external`); `replay: "recorded"` on store-backed results; `spaces` checked like `space`; `HostError` mapping |
| `tests/access_filter.rs` | host | Reader filters from principals, `onBehalfOf`, groups with `*`, `SPACE_NOT_READABLE`; every store read path with the access fixture; `event-list` skipping version 1 events the caller cannot read; `workspace-show`'s `access` |
| `tests/require_human.rs` | host | A `confirm = "require-human"` command: `--yes` and `--approve` refused, no terminal refused, a terminal answer accepted (the test console), refused on MCP and in process; manifest checks (needs `confirm_prompt`, CLI-only exposure) |
| `tests/store_commands.rs` | host | `store-show`, `store-check` (with a corrupted index; a missing journal entry; a recent change not reported), `store-backup` (holding the writer) |
| `tests/doctor_stores.rs` | host | The four new doctor checks |
| `plugins/knowledge/tests/process.rs` | knowledge | A stdio server and one-shot CLI `sources-sync` and `knowledge-index` against one workspace at once, through the `umbel-knowledge` binary (`CARGO_BIN_EXE_umbel-knowledge` is set only for the package that owns the binary, so this test lives in the knowledge crate, not the host's `tests/process.rs`) |
| `okf/tests/frontmatter.rs`, `okf/tests/structure.rs`, `scan/tests/scan.rs` | `umbel-okf`, `umbel-scan` | Section 5.1's rules (no frontmatter versus malformed, body offsets), slugs, link resolution, the scan patterns |
| `plugins/sources-filesystem/tests/sync.rs` | sources | Change detection, tombstones, skips and their warnings, caps, field caps, conflicts, `dry_run`, `limit` and `remaining`, results with only readable ids |
| `plugins/sources-filesystem/tests/access_mirror.rs` | sources | Section 5.3's precedence |
| `plugins/knowledge/tests/chunking.rs` | knowledge | Every rule of section 7.2 on committed fixtures with expected chunk boundaries |
| `plugins/knowledge/tests/query_syntax.rs` | knowledge | Every form of section 8.1, the limits, `access` refused |
| `plugins/knowledge/tests/search.rs` | knowledge | Aggregation, expansion, status, order and ties, snippets, sources, warnings, formats, `verified_only` |
| `plugins/knowledge/tests/open_find.rs` | knowledge | Windows, locators, `DOCUMENT_CHANGED`, find limits |
| `plugins/knowledge/tests/graph.rs` | knowledge | Every node and edge kind, co-citation per citer and its cap, a restricted citer not raising a public pair's weight, readable backlink counts, the graph commands, endpoint filtering, no cross-space edge |
| `plugins/knowledge/tests/code_symbols.rs` | knowledge (`code`) | Each language's query file on committed fixtures, JavaScript and JSX through `LANGUAGE_TSX`; degraded parse by error rate and by match limit |
| `plugins/knowledge/tests/spaces.rs` | knowledge | Multi-space validation, fusion, labels, no write-back |
| `plugins/knowledge/tests/budgets.rs` | knowledge | Each command fits its budget structurally; `RESULTS_LIMITED`, `WINDOW_LIMITED` |
| `plugins/knowledge/tests/proposals.rs` | knowledge | Every op, idempotency (same key and content returns the proposal; same key and other content is `PROPOSAL_KEY_REUSED`), conflicts, areas, approvers and their matching, approvers who cannot read the target, self-approval by the same actor refused and allowed, a person approving their own agent's proposal, resume after a crash between steps, `derivedFrom`, `indexed: false`, CLI-only exposure, event envelopes |
| `plugins/knowledge/tests/verification.rs` | knowledge | Tiers, stale, `knowledge-verify`, deprecate, frontmatter-only rewrites |
| `plugins/knowledge/tests/security.rs` | knowledge | Trust labels, no content in messages, flags, confinement, caps |
| `plugins/knowledge/tests/eval_fixture.rs` | knowledge | The generator's pinned digest; the query set validates; key terms and unanswerable words distinct under `en_stem`; the planted scan flags; metrics on a hand-computed three-query case |
| `plugins/knowledge/tests/exit_thousand.rs` | knowledge | The exit criterion above |

## 13. Out of scope, and the seams reserved

| Out of scope | When | Seam left in phase 2 |
| --- | --- | --- |
| Vector lane, embeddings provider (O4) | Opt-in after phase 2, gated by section 10.4 | `knowledge` config `lanes = ["bm25"]` (the only value); RRF fusion code shared with multi-space search; trait names `VectorIndex` and `Embedder` reserved in `umbel-store`, undefined; envelope `derivedFrom` for embeddings |
| Rerank lane | Same | The ranking pipeline's step between aggregation and expansion; trait name `Reranker` reserved |
| Model-extracted entities | Per-collection opt-in after phase 2 | Node kind `entity` and edge kind `extracted` reserved; their own provenance layer via `derivedFrom` |
| Store grants for components | World `umbel:plugin/plugin@1.1.0` | The grants refused to components with that world named |
| Documents as MCP resources | When resources can be permission-filtered (2026-07-28 lists do not vary per connection) | URI scheme `kb://<space>/<doc>` reserved; `knowledge-open` is the fetch tool |
| Federation, native connectors, source ACL mirroring (O1) | After phase 2 | `sources-*` command shape; envelope `sources` |
| Deterministic auto-approval rules, the curator, inconsistency proposals, scheduled re-verification | Phase 4 | Proposal record version 1; `policy.rule` (only `person` now); `knowledge-stale` |
| Memory store trait and grant | Phase 3 | Grant name `memory`; envelope version 2 |
| Restore from backup | Phase 6 (migration between backends) | `store-backup`'s digest manifest |
| A second backend, `spaces.<id>.backend` | Phase 6 | The conformance suite; `backend` still reserved |
| Profile `org`: incremental jobs as MCP Tasks, a vector lane when its eval passes, larger caps, shared backends | `org` work after phases 5 and 6 | `profile` enum; `knowledge-index`'s and `sources-sync`'s `limit` and `remaining` (resumable batches) |
| Verified identity for reader filters, delegation narrowing | Phase 5 | Section 6's effective principal; reserved principal `spaces` and `delegationChain` |
| Partitioned BM25 statistics per access set, or coarsened scores, and no count leaks from revisions, `seq` or totals | **Phase 5 prerequisite** (owner decision 4): filtering becomes a boundary there | Section 6's list of what remains visible; the architecture's prerequisites table |
| Watching roots for changes | Later | `sources-status`; `knowledge-refresh` run by a harness hook or CI |
| Per-agent rate limits | Phase 5 | Size caps only |
| The Rust telemetry middleware (an AFD prerequisite the architecture listed for phase 2) | Phase 5, moved 2026-11-01: phase 2 needs nothing beyond what the journal records; usage events and OpenTelemetry export wait for phase 5 and W12 | The journal's command, timing, outcome and actor kind |

**Scale profile `team`** is what phase 2 builds: up to about 10 000
documents per space on one machine, an embedded store, synchronous
`knowledge-refresh` (a full rebuild of 1000 documents is expected under a
minute in a release build), one writer at a time per space.

## 14. Implementation plan

Each step is one pull request, green on the repository's checks and
`umbel.yml`, and updates [STATUS.md](../../STATUS.md) and this file's status
block. A step that finds a design decision stops and amends this document.

### Step 0: AFD first (D25, D64)

**0a. Output budgets, proposal and spec** (documents only):
`docs/features/proposed/output-budgets/` with a proposal and status, and
`spec/output-budgets.md` with vectors `spec/output-budgets.json`, for every
language:

- A command may declare `outputBudget: { defaultBytes, maxBytes }`
  (positive integers, `defaultBytes ≤ maxBytes`), reported by `afd-detail`
  and on its tool as `_meta["dev.afd/outputBudget"]`.
- A caller asks for `maxBytes` per call in `_meta["dev.afd/outputBudget"]`
  (`{ "maxBytes": n }`), through the meta-tools' `meta` argument, or in
  process on the call context. The ask **reuses the context-field
  plumbing** of `spec/context-fields.md`: it is read from the same places,
  copied into `CommandContext` the same way, applied **per item** in
  `afd-batch` and per step in `afd-pipe`, and journaled with the call. The
  key `dev.afd/outputBudget` thus carries three shapes in three places,
  each fixed by the spec: the declaration on a tool's `_meta`
  (`{ defaultBytes, maxBytes }`), the ask on a call's `_meta`
  (`{ maxBytes }`), and the report on a result's `metadata`
  (`{ limitBytes, usedBytes }`). The effective budget is
  `min(asked, maxBytes)`, or `defaultBytes` when not asked; a non-positive
  or non-integer ask is `VALIDATION_ERROR`.
- The handler reads the effective budget from the command context and fits
  its output.
- After the handler, the server measures the UTF-8 byte length of the
  result's JSON (the `structuredContent`). Over budget: for a command that
  is not a mutation, the result is replaced by a failure
  `OUTPUT_BUDGET_EXCEEDED` (details `limitBytes`, `actualBytes`; suggestion:
  narrow the request or ask for up to `maxBytes`); for a mutation, the
  result is kept and gains the warning `OUTPUT_BUDGET_EXCEEDED`, because the
  work is done. **No implementation truncates structured output.**
- `metadata["dev.afd/outputBudget"] = { "limitBytes", "usedBytes" }` on
  budgeted results. Commands without a budget are unchanged.
- The journal records the effective budget, so replay sees the same one.
- Parity rows marked Planned; TypeScript and Python follow and do not block
  Umbel, as for the hybrid strategy.

**0b. Rust implementation** in `packages/rust`:
`CommandDefinition::with_output_budget`, `CommandContext::output_budget()`,
the server's measurement and replacement on every route (tools, `afd-call`,
`afd-batch` items, `afd-pipe` steps), `DirectClient` call option,
`tests/output_budget.rs` over the vectors; and the frontmatter reader moved
from `src/server/frontmatter.rs` to `src/frontmatter.rs` and made public
behind a new `frontmatter` feature (enabled by `server`), so `umbel-okf` can
depend on `afd` without the server:

- `afd::frontmatter::parse(text: &str) -> Result<Option<Frontmatter>, FrontmatterError>`:
  `Ok(None)` when the first line is not `---` (no frontmatter), an error
  when the frontmatter is malformed.
- `Frontmatter { fields: serde_json::Map<String, Value>, body_offset: usize, body_line: usize }`:
  the mapping, the body's byte offset and its 1-based line.
- `FrontmatterError`, `#[non_exhaustive]`: `Unclosed`, `NotAMapping`,
  `Forbidden { what, line }` (tags, anchors, aliases), `TooDeep { line }`,
  `Syntax { line, column, message }`, `MoreThanOneDocument { line }`, each
  with a generic `Display` (no "SKILL.md"; the skills loader adds its own
  context).
- No size cap: callers cap the input (Umbel at 64 KiB, the skills loader
  as before). The skills loader moves to the public API with unchanged
  behaviour.

CHANGELOG and parity rows.

### Umbel steps

| Step | Pull request | Contents | Tests | Size |
| --- | --- | --- | --- | --- |
| 0a | AFD: output budgets (spec) | Above | None (documents) | M |
| 0b | AFD: Rust output budgets and public frontmatter | Above | `output_budget.rs`, frontmatter units | M |
| 1 | Shapes and configuration | The schemas of section 2 with examples; configuration version 3 (`collections`, `readers`, `[access]`, `[store]`), `init` writes 3; the doctor's `collections.roots`; manifest version 2 parsing (effects, `output_budget` key accepted and stored); version constants; `store` as a host domain; event version 1 projection with envelope version 1 (the `plugin` field filled by the gate) | `schemas.rs`, `config_v3.rs`, `manifest_v2.rs` (parsing cases) | M |
| 2 | Store traits and the SQLite stores | `umbel-store` (types, the three traits, the conformance suite with its access fixture and the `spawn_writer` parameter, an in-memory fake for `suite_detects.rs`); `umbel-store-embedded` with SQLite documents, records, changes and graph (`apply`), the checkpoint policy and `fullfsync` (index methods `unimplemented` behind a not-yet-built marker the suite skips); the new `knowledge` CI job | `suite_detects.rs`, `conformance.rs` (non-index groups), `multiprocess.rs` (documents) | L, heavy: SQLite C build |
| 3 | The tantivy index | The embedded `SearchIndex` (schema with explicit LZ4, tokenizers, the grammar-AST query builder with its limits and bounded prefixes, reader clause, writer sessions that never lower `applied`, payload, writer wait, reload), the petgraph cache, the index groups of the suite; measures the `knowledge` job and sets its timeout | `conformance.rs` (all), `multiprocess.rs` (index) | L, heavy: tantivy |
| 4 | Host services | The ten grants, allow lists and `ALLOW_REQUIRED`, reader filters and `SPACE_NOT_READABLE`, `spaces` as a host input, derivation reads, `as_reader`, provenance enforcement, the gate's allow-list, `replay: "recorded"`, `dev.umbel/changes`, `event-list` filtering by `access`, the SDK's methods, `HostError`'s new variants, `Cx::in_space`, `CallContext.spaces` and `output_budget`, `Outcome::with_sources` and warning details, the `store-embedded` feature, `store-show`, `store-check`, `store-backup`, the doctor's store checks, manifest version 2's `confirm = "require-human"` in the CLI, the output-budget key wired to `with_output_budget`, `workspace-show`'s `access`, the README paragraph on access before phase 5 | `store_grants.rs`, `access_filter.rs`, `require_human.rs`, `store_commands.rs`, `doctor_stores.rs`, `manifest_v2.rs` (rest) | L |
| 5 | `umbel-scan`, `umbel-okf` and `sources-filesystem` | The scan crate (moved from `mounted/scan.rs`, which re-exports it); frontmatter with the field caps, structure, link resolution; the plugin, its packs and skill, `sources-sync` (bounded runs, filtered results), `sources-status`; the flag rate on the fixtures recorded in the pull request | `scan/tests/scan.rs`, `okf/tests/*`, `sync.rs`, `access_mirror.rs` | M |
| 6 | Knowledge core | The knowledge crate without `code`: chunking, `knowledge-index` (the procedure of section 8.7, index only; graph calls behind step 7), search without expansion, open, find, describe, list, changes, budgets, multi-space through `in_space`, warnings, trust labels, first-class suggestions, the pipeline, the `umbel-knowledge` binary, the plugin's skill | `chunking.rs`, `query_syntax.rs`, `search.rs`, `open_find.rs`, `spaces.rs`, `budgets.rs`, `security.rs` (read side), `plugins/knowledge/tests/process.rs` | L |
| 7a | Structural graph | Graph building in `knowledge-index` (one `GraphBatch` per run), co-citation per citer, expansion in search, `neighbors`, `related`, `path`, `outline`, `stale` | `graph.rs`, the expansion cases of `search.rs` | M |
| 7b | Code symbols | The `code` feature, tree-sitter and three grammar crates (JavaScript through `LANGUAGE_TSX`), query files, parse and query budgets, symbol chunking, `defines` and `mentions` | `code_symbols.rs` | M, heavy: tree-sitter grammars' C build |
| 8 | Proposals and verification | The proposal record, areas, propose, list, show, withdraw, approve (CLI, approval, `require-human`), reject, verify, deprecate, frontmatter-only rewrites, the write scan on proposals | `proposals.rs`, `verification.rs`, `security.rs` (write side) | L |
| 9 | Eval harness | The fixture generator and its digest, the query set, `knowledge-eval` (report as result), the gate, `eval/baseline.json`, the report's upload in the `knowledge` job | `eval_fixture.rs` | M |
| 10 | Exit | `exit_thousand.rs`; STATUS.md marks phase 2 done with the run's evidence | `exit_thousand.rs` | S |

**Order and parallelism.** 0a, then 0b. Step 1 needs nothing from AFD and
may run beside 0a and 0b. Step 2 needs 1. Step 3 needs 2. Step 4 needs 0b
(it wires `with_output_budget` and `CallContext.output_budget`) and 3 (its
`store-check` corrupted-index and `store-backup` tests need the tantivy
index), so **3 and 4 are sequential**. Step 5 needs 4. Step 6 needs 5.
Steps 7a and 8 need 6 and may run in parallel; 7b needs 7a. Step 9 needs
7a. Step 10 needs all.

**Build and disk cost.** This machine's disk is limited, and phase 1's
component step showed a shared target directory reaching 14 GB with
wasmtime. Therefore: the plugin crates and the store crates depend on
`umbel` with `default-features = false` (no wasmtime) wherever they need the
host, as `umbel-todo` does, and run their tests with `-p <crate>`; each
heavy native set (SQLite in 2, tantivy in 3, tree-sitter in 7b) arrives in
its own step; **never build steps 2, 3 and 7b at the same time**; share one
`CARGO_TARGET_DIR` and remove it between unrelated
sessions; run the full `--workspace` test only in the step's final check.

## 15. For the owner

### Owner decisions, 2026-11-01

Recorded by the owner in conversation on 2026-11-01, after the independent
review of this specification; written into the sections named.

1. **Access v0 is accepted, tightened** (D53, D54; sections 3.3, 5.5, 6,
   8.7, 2.2). Derivation-reading plugins may read every document in a
   space; compiled plugins only. Access filtering is exact only for
   embedders and tests until phase 5's authentication: every stdio or
   loopback caller is one principal, and the CLI is always
   `human:<local_id>`; the README and `workspace-show` say so. Content that
   matches the injection scan is flagged, not blocked (D67). The outputs of
   the index-building commands and the events are filtered to what the
   caller can read: **chosen: totals plus readable ids** (not CLI-only), so
   agents can still refresh the index; `event-list` filters version 1
   events by their envelope's `access`.
2. **Approve and reject require a human** (D62; sections 3.4, 9.2). A
   per-command `confirm = "require-human"` key in manifest version 2
   forces a terminal-only prompt (stdin and stderr terminals) and refuses
   `--approve` and `--yes` for those commands. Agents can propose; only a
   person at a terminal approves, until the MCP approval relay.
3. **Self-approval** (D62; sections 6, 9.1, 9.2). Refused only when the
   approving human is the same actor who proposed, where the area forbids
   self-approval. A person approving their own agent's proposal is allowed
   and recorded with `proposer.actor.kind = "agent"`. Section 6 lists the
   principal strings each surface produces before phase 5, and `approvers`
   matches the approving actor's `human:<id>`.
4. **BM25 statistics over unreadable chunks are accepted for phase 2**
   (D53; section 6). The earlier claim that no count leaks was wrong:
   scores, revision gaps in `changes`, `store-show`'s head and the totals of
   the index-building commands reveal hidden counts. Partitioned statistics
   or coarsened scores are a **phase 5 prerequisite** (architecture
   prerequisites table, STATUS.md follow-ups).

### Coordinator decisions, 2026-11-01

Under the owner's delegation, following the reviewer:

5. **The journal stays fail-open** (D66), with the `store-check` race fixed:
   changes newer than 60 seconds or belonging to an open journal entry are
   not reported, and a missing entry is a warning (section 3.5).
6. **Proposals stay in phase 2** (D62). The architecture's phase 4 exit is
   amended to "**A curator proposal** approved from the CLI lands in the
   knowledge base with full provenance", so phase 4's exit still proves
   the curator rather than phase 2's person-written proposals.
7. **The `umbel-knowledge` binary is kept** (D57): the stock `umbel` binary
   stays empty; phase 7 decides which binaries ship.

### Points that remain as written

8. Approve and reject are CLI-only until the MCP approval relay (phase 4).
9. A human approver's own verification applies at once, without the
   self-approval exception (D63): it is an attestation, not a change
   someone else wrote.

## Revision 2026-11-01

The independent review of this pull request, the owner's decisions above
and the coordinator's. Every finding was checked against the code
(`src/middleware.rs`, `src/principal.rs`, `src/host/mod.rs`,
`src/cli/prompt.rs`, `src/cli/parse.rs`, `src/provenance.rs`,
`src/commands/workspace_show.rs`, `sdk/src/cx.rs`, `sdk/src/outcome.rs`,
`wit/umbel-plugin-1.0.0/world.wit`, `packages/rust/src/server/frontmatter.rs`)
or the crates' sources (tantivy 0.27.0, tantivy-query-grammar 0.27.0,
tree-sitter 0.27.1, tree-sitter-typescript 0.23.2); none was rejected.

| # | Finding | Disposition | Where |
| --- | --- | --- | --- |
| M1 | `QueryParser` refuses bare `term*`; no expansion or clause limits | Fixed: parse with `tantivy-query-grammar`, walk the AST, refuse `access`, count clauses, fields, depth and slop; `term*` becomes a one-term `PhrasePrefixQuery` with `set_max_expansions(256)` | 8.1, trajectory |
| M2 | `en_stem` needs `stemmer`; LZ4 needs `lz4-compression` | Fixed: features `mmap`, `stopwords`, `stemmer`, `lz4-compression`; LZ4 set explicitly in `IndexSettings` | 1, 3.2 |
| M3 | Concurrent indexers | Fixed: writer first, then `min(applied)`, in-memory graph batch in one `BEGIN IMMEDIATE`, commits never lower `applied` (`Conflict`), `limit`; approve does not index | 3.1, 8.7, 9.2 |
| M4 | `co_cited` leaks unreadable citers | Fixed: stored per citer with its access set, aggregated over readable origins at query time, 50-target cap per citer; backlink counts readable only | 3.1, 7.3, 8.5 |
| M5 | Access holes in sync, status, index and events | Fixed per owner decision 1: totals plus readable ids; event envelopes for knowledge mutations; `event-list` filters by `access` | 2.2, 5.5, 8.7 |
| M6 | The gate strips `dev.umbel/trust` and `dev.umbel/index` | Fixed: named allow-list (`index`; `trust` only `"content"`); mounted stays `external`; `changes` set by the gate after sanitising | 3.3 rules 6 and 7 |
| M7 | `require-human` undefined | Fixed per owner decision 2: manifest v2 `confirm = "require-human"` | 3.4, 9.2 |
| M8 | Self-approval and principal strings | Fixed per owner decision 3 | 6, 9.1, 9.2 |
| M9 | SDK seams | Fixed: method table, `HostError` variants and mapping (WIT 1.0.0 frozen, 1.1.0 adds them), `Cx::in_space`, `spaces` as a host input, `Reader` | 3.3 |
| S1 | Plan dependencies and test names | Fixed: 4 needs 0b and 3; 3 and 4 sequential; `suite_detects.rs` throughout | 14 |
| S2 | `tests/process.rs` cannot see `CARGO_BIN_EXE_umbel-knowledge` | Fixed: `plugins/knowledge/tests/process.rs` | 12, 14 |
| S3 | Fixture counts | Fixed: 1000 markdown plus 50 code; `alpha` 650 | 10.1, 12 |
| S4 | Architecture phase 4 exit | Fixed: "A curator proposal…" | architecture 9 |
| S5 | `content` cap versus first sync | Fixed: `limit` and `remaining` on `sources-sync` | 5.2, 5.5 |
| S6 | SDK budget, sources, warning details | Fixed: `CallContext.output_budget`, compiled only; `with_sources`, `with_warning_details` | 3.3, 3.4, 8.6 |
| S7 | Public frontmatter API | Fixed: `Ok(None)` versus typed errors, body offsets, generic messages, cap is Umbel's | 5.1, 14 (0b) |
| S8 | JS and JSX | Fixed: `LANGUAGE_TSX` | 7.4 |
| S9 | tree-sitter budgets and error rate | Fixed: progress callbacks, match limit, error rate defined | 7.4 |
| S10 | Frontmatter fields copied into chunks | Fixed: caps and `fields-limited` | 5.1 |
| S11 | Replay of store-backed results | Fixed: stamped `recorded` | 3.3 rule 8 |
| S12 | `knowledge-eval` effects and `rebuild` | Fixed: report is the result; `rebuild` dropped | 10.3 |
| S13 | Approvers who cannot read the target | Fixed: `PROPOSAL_NOT_FOUND` | 9.2 |
| S14 | Applied documents' lineage and confidence | Fixed: `derivedFrom` proposal entry; `confidence` on the record | 9.1, 9.2 |
| S15 | `knowledge-propose` input and idempotency | Fixed: schema; `PROPOSAL_KEY_REUSED` | 9.1 |
| S16 | `event-rebuild` and version 0 entries | Fixed: rebuilds in the entry's own version | 2.2 |
| S17 | `changes` ranges and gaps | Fixed: `count` is the call's; `trace` filter; dense only under `Derivation` | 2.2, 3.1, 8.5 |
| S18 | `store-check` race | Fixed: 60-second and open-trace exclusion, warning only | 3.5 |
| S19 | `store-backup` during indexing | Fixed: holds the index writer | 3.5 |
| S20 | SQLite checkpoints and `fullfsync` | Fixed | 3.2 |
| S21 | Float determinism | Fixed: 4 decimals; tie-free exact-order fixtures | 8.2 |
| S22 | CI job | Fixed: `knowledge` job, own timeout measured in step 3, artifact | 12 |
| S23 | Eval scope, stemming, lane minimum | Fixed: metric scope; `en_stem` distinctness test; 50 answerable queries | 10 |
| S24 | D40 and D42 annotations | Fixed in their own rows | decisions |
| S25 | `spawn_writer` | Fixed: backend-supplied `fn(&Path) -> Command`, the test binary re-run | 3.1 |
| N1 | `workspace-show` already has `provenance` | Fixed: existing keys bumped | 2 |
| N2 | Envelope `principal` | Fixed: `human:local`; version 1 holds the effective principal string | 2.1 |
| N3 | `readers` grammar | Fixed | 4.1 |
| N4 | `content` grant for approve's resume | Fixed | 8 |
| N5 | Scan noise | Recorded; fixture plants a known count | 10.1, 11 |
| N6 | D59's S57 rationale | Fixed in D59 | decisions |
| N7 | Hard links | Recorded | 3.3, 5.2, 11 |
| N8 | `content_write` not atomic against outside writers | Fixed wording | 3.3 |
| N9 | pulldown-cmark in the host | Fixed: `umbel-scan` crate | 1, 11 |
| N10 | `dev.afd/outputBudget` shapes | Fixed: context-field plumbing, per item, journaled | 14 (0a) |

## Amendments from step 0a

Step 0a wrote the AFD [proposal](../../../../../docs/features/active/output-budgets/output-budgets.proposal.md)
and [`spec/output-budgets.md`](../../../../../spec/output-budgets.md). It kept every rule of section
14's 0a and made the choices that section left open; these change what 0b builds. The spec is
binding where it and section 14 differ.

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 14 (0a), path | `docs/features/proposed/output-budgets/` | `docs/features/active/output-budgets/` | Approved through D64, as the resources proposal was through D47 |
| 14 (0a), where the check runs | "The server measures", on every MCP route | The engine checks in the innermost link of the middleware chain, after the handler and before it stamps `metadata` (B5): every MCP route, batch item and pipeline step, and `DirectClient` and in-process calls too. In Rust that is the innermost link of `CommandRegistry::execute`'s chain, so the journal recorder, which finishes outside the chain, records the checked result | One place, the same in all four engines, and the journal records what the caller got |
| 14 (0a), what is measured | The UTF-8 length of the `structuredContent` | The UTF-8 length of the result's canonical JSON (the journal context cap's form: keys sorted, no whitespace, JavaScript's number spelling and escaping) with `metadata` removed | Engines stamp different `metadata` (Rust only `actorKind`), and `executionTimeMs` varies by call |
| 14 (0a), failures | Unstated | A handler's own failure passes unchanged and gets no report; only successful results are checked | Its error is what the agent needs |
| 14 (0a), the failure's details | `limitBytes`, `actualBytes` | Also `maxBytes`, and one of two fixed suggestions (ask for up to `maxBytes`, or narrow only when the call already had it) | The agent can ask for the most it may without another `afd-detail` |
| 14 (0a), the error code | A new code | `OUTPUT_BUDGET_EXCEEDED` is listed in `error-codes.md` as specified, not catalogued. **0b adds it to the shared catalog and `vectors/error-codes.json` with its constant in all four languages** (one line each), as the catalog rule requires of a new code in one pull request | A documents-only pull request cannot add the constants |
| 14 (0a), the ask | `_meta`, the meta-tools' `meta`, or in process | The same, plus the AFD HTTP lanes where they read `_meta`; an ask to a command without a declaration is validated, then ignored; an ask above `maxBytes` is clamped; bounds 1 to 2^53 − 1 with no other member; the invalid-ask `VALIDATION_ERROR` details are `{ "field": "outputBudget", "meta": "dev.afd/outputBudget" }`. In Rust the in-process ask is `CommandContext::with_output_budget_ask(max_bytes)` and a `DirectClient` call option | One ask covers a mixed batch; the rest follows declared context fields |
| 14 (0a), the journal | "Records the effective budget" | An optional entry field `outputBudget` (an integer) after `contextOmitted`; it joins the context digest only when present; replay restores it as the ask | Existing journals and the fixture keep their hashes |
| 14 (0a), `meta-tools.json` | Unstated | Unchanged until every language accepts the key | TypeScript and Rust compare it byte for byte |
| 14 (0a), streams | Unstated | Streamed chunks are not checked | No phase 2 command streams |

## Amendments from step 0b

Step 0b implemented the spec and section 14's 0b in `packages/rust`. It found no rule to change; these are the details the plan left open or worded loosely, which steps 1 to 10 build on.

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 14 (0b), `DirectClient` call option | "`DirectClient` call option" | `DirectClient::call` takes an `Option<CommandContext>` and passes it through, so the in-process ask is `CommandContext::with_output_budget_ask(max_bytes)` on that context; there is no second option | The context is already the call option in Rust, and the spec's name for it is binding |
| 14 (0b), `FrontmatterError` | `Forbidden { what, line }` for tags, anchors and aliases | `Forbidden { what, line }` also names a number that is not finite, a mapping key that is not a string and a repeated key; every `line` is 1-based in the whole text (the opening `---` is line 1) and `Syntax.column` is 1-based | Those were three more of the existing reader's refusals; the enum is `#[non_exhaustive]`, so a later variant is not a break |
| 14 (0b), `Frontmatter` | A struct with three public fields | The same fields, `#[non_exhaustive]`: callers read it and cannot build it | AFD may add a field without breaking Umbel |
| 5.1, empty and unterminated blocks | Unstated | `---` then `---` is `NotAMapping` (the rules are unchanged: one mapping is required), so an empty block skips the file with `FRONTMATTER_INVALID`; `---` as the last line, with nothing after it, is `Unclosed`; a closing `---` with no line ending gives `body_offset` equal to the text's length and `body_line` one past it. A byte order mark is not stripped: a text that starts with one has no frontmatter, so `umbel-okf` strips it first | Umbel decides what it does with each case in step 5; AFD fixes only what the reader reports |
| 14 (0b), the journal digest | The budget joins the digest and its context key leaves `keys` | In Rust the effective budget is a field of the context, not a key of `extra`, so it was never among `keys`; the digest gains `"outputBudget"` only when the call has one | Hashes compare only within one implementation; a call without a budget hashes as before |
| 14 (0b), the journal types | `outputBudget` on the entry | `JournalEntry` and `JournalRecord` gain the public field `output_budget`, which breaks a struct literal of either (the changelog says so). Umbel builds neither | The crate is before 1.0 |
| 14 (0b), declaration helpers | `with_output_budget` | Also `afd::OutputBudget` with `from_value(&serde_json::Value)`, which checks the manifest form `{ defaultBytes, maxBytes }` and names the field, for Umbel's manifest version 2 loader (step 1 stores the key, step 4 wires it) | The loader holds JSON, not two integers |
| 14 (0b), where the declaration shows | Tools, grouped actions, `afd-detail`, afd-help (`full`), afd-docs | Done for the first four; `afd-docs` does not report it (the spec allows omitting it there) | The spec's MAY |
| 14 (0b), the vectors | Every case | Every case but one: the `measure` case with a lone surrogate, which a Rust string cannot hold (serde_json refuses it), so the test skips it and names it | The Rust tests assert the rest, including the escapes |

## Amendments from step 1

Step 1 ([632](https://github.com/lushly-dev/afd/pull/632)) read this
specification against the code and made these smallest-correct changes.
Everything else is built as written.

| # | Where the text and the code disagreed | What step 1 did | Section |
| --- | --- | --- | --- |
| A1 | Section 2.2 rebuilds an entry "the phase 2 host journaled (it carries the version 1 envelope fields)" as version 1, but a command that supplies no provenance leaves nothing in its journal entry to tell a phase 2 entry from a phase 1 one | The event stamp (`event_stamp`, outermost middleware) writes the host-owned result key `dev.umbel/event-version = 1` beside `dev.umbel/mutation`; an entry without it projects as version 0, as it was first written. No plugin can set it: the gate strips every `dev.umbel/` key it does not name, and the stamp overwrites | 2.2 |
| A2 | Section 2.2 says the host "refuses a version 1 event without `access`" for knowledge mutations, but every other mutation (`todo-create`, a mounted tool, a test fixture) also becomes a version 1 event, and a plugin that is not a store writer supplies no access set | A version 1 event whose command supplied no valid `access` carries `["space"]`, and `sensitivity` `internal`: readable by everyone who may read the space, as a collection's defaults are. The refusal itself (`STORE_PROVENANCE_REQUIRED`) belongs to the store write in step 4; an invalid supplied value reads as absent, as version 0's fields do, and the journal is read through the same shape check again when the event is projected | 2.1, 2.2 |
| A3 | Section 3.3 rule 6 has the plugin gate set `dev.umbel/changes` in step 4; the projection that reads it is step 1 | `Event::from_entry` reads `dev.umbel/changes` from the entry's result when the entry is version 1 and drops a value that is not `{ fromRev, toRev, count }` with `1 ≤ fromRev ≤ toRev` and `count ≥ 1`. Nothing sets the key yet, and the gate still strips a plugin-supplied one | 2.2, 3.3 |
| A4 | Section 4.1 validates a root's canonical path "at open", but a root that does not exist yet has none, and the doctor's `collections.roots` is defined as the check that it exists | At open a root is checked lexically (relative, `/` separators, no `..`, not the workspace itself, not under `state/`, not overlapping another root of its space) and, **when it exists**, by its canonical path (inside the canonical workspace, not overlapping another resolved root). A missing root opens and `collections.roots` fails it, naming the collection and what is wrong (missing, not a directory, outside the workspace) | 4.1, 3.5 |
| A5 | Section 3.4 lets a mounted plugin's `[[mount.tools]]` name `effects` from the manifest's catalog, and version 2's catalog adds `store-write` and `workspace-write` | A mounted tool may not name either, in any manifest version: it holds no grants, so neither could be satisfied. Version 1 manifests refuse both effects and version 2's two command keys with a message naming `manifest_version = 2` | 3.4 |
| A6 | Section 3.3 makes `store` a host domain without saying which schemas change | `store` joins `HOST_DOMAINS`, so a command or mount prefix `store-` is `PLUGIN_MANIFEST_INVALID` in manifest versions 1 and 2 alike, and a prefix `store` is refused by the host in configuration versions 2 and 3 alike. Only the version 2 manifest schema and the version 3 configuration schema list it; the shipped version 1 and 2 files stay as they were | 3.5 |
| A7 | Section 2 names the shapes but fixes only some of their fields | The schemas fix the rest: `document.v1.json` carries `bytes` as base64 and is absent from `knowledge-describe` output; its `description`, `staleAfter` and `supersededBy` are required and nullable; `eval-report.v1.json` has `corpusDigest`, `indexApplied`, `rankingDigest`, `hostVersion`, `queries` (counts), `metrics` (`overall` and `byKind`, each with `on` and `off`), `unanswerable`, `leaks`, `latency` and `results` (per query, per expansion setting); `eval-queries.v1.json` ties `unanswerable` to the kind `unanswerable` and empty `qrels`; `proposal.v1.json` requires `baseHash: null` and `content` for `create`, a hash for every other op, and `content` for `update` | 5.4, 9.1, 10.2, 10.3 |
| A8 | Section 2 says `workspace-show`'s `store`, `document`, `locator` and `proposal` versions are 1; the crate that owns the store traits version is step 2's | The four constants live in the host's `versions.rs` until `umbel-store` exists; step 2 makes `umbel-store` own `STORE_TRAITS_VERSION` and the host re-export it | 2 |

## Amendments from step 2

Step 2 ([636](https://github.com/lushly-dev/afd/pull/636)) read this specification against rusqlite 0.41 and SQLite and made these
smallest-correct changes. Everything else is built as written; the conformance suite's groups
`documents`, `records`, `changes`, `envelope`, `access`, `graph`, `concurrency` and `durability`
run against the SQLite backend, and the index cases wait for step 3.

| # | Where the text and the code disagreed | What step 2 did | Section |
| --- | --- | --- | --- |
| B1 | `StoreError`'s list has no case for the size caps that section 3.3's `HostError` table maps to `TooLarge`, nor for opening a store whose schema is newer (`STORE_VERSION_UNSUPPORTED`, section 3.2) | `StoreError` (now `#[non_exhaustive]`) gains `TooLarge(reason)` and `VersionUnsupported { found, supported }`. Envelope refusals stay `Invalid`, and the host's plugin-facing code is chosen from the call (`STORE_PROVENANCE_REQUIRED`) | 3.1, 3.3 |
| B2 | `run_all(factory)` with `factory` "makes a fresh, empty set of the three stores for a space" cannot reopen a store (`durability`) or share one with a child process (`spawn_writer`), and the index does not exist until step 3 | `run_all(factory, spawn_writer)`: `factory: Fn(&Path, &str) -> Result<Stores>` opens (creating when empty) the stores of space `main` under a directory and is called again on it to reopen; `Stores { documents, graph, index: Option<..> }`, where `index: None` replaces the plan's "`unimplemented` behind a not-yet-built marker": the index cases report `Skipped`. `spawn_writer` is `Option<fn(&Path) -> Command>` so a single-process fake runs without it. The child protocol: the backend's command sets `UMBEL_STORE_WRITER=<dir>`; the suite adds `UMBEL_STORE_WRITER_ID` and `_COUNT` and starts the children together by writing a line to their standard input (no sleeps); each prints `UMBEL-WROTE <rev> <id>` | 3.1 |
| B3 | Section 3.2 lists `node_access` and the edges' access beside `doc_access`, copying the access set to nodes and edges, but also says derived rows inherit their source's set and section 6 says the filter is the source document's | There are no graph access tables: a node or edge is readable through its **origin document's current** `doc_access`, so a tightened access set hides its edges at once, before the next index run, and a deleted origin's rows are unreadable at once. `apply` refuses a contribution (`Some`) for a document that is not stored. A new table `change_access` holds the access set each change had when it was made, so `changes` is a join like every other read and a delete stays as readable as the version it deleted | 3.1, 3.2, 6 |
| B4 | `apply(batch, applied)` fixes only "`applied` below the current one is `Conflict`"; `store-check` (section 3.5) treats an applied revision ahead of the head as corruption; "`clear` is `apply` of every origin with `None`" needs the list of origins | `applied` above the store's head is `Invalid` and writes nothing. `GraphStore::clear(applied)` is a method under the same rules. `GraphBatch::check()` (an origin once, a node or edge once per contribution, bounded sizes, weights below 2^63) is shared by every backend. `edges_of_kind` returns a `Vec` and continues from an `EdgeKey { from, to }` (the last edge's), not a `Page`. `subgraph` is required and the SQLite backend computes it in SQL; the petgraph cache is step 3 | 3.1, 3.2 |
| B5 | Section 3.1 names the types without their fields | `DocumentWrite` and `Document { rev, #[flatten] write }` serialise as `document.v1.json` (`bytes` base64); `DocMeta` is the listing form (id, rev, collection, path, type, title, status, hash, size, sensitivity, access, flags); `Page<T> { items, next }`, `next` being the `after` of the following page and absent on the last; a list or changes `limit` of 0 or above its cap is `Invalid`; `Change.at` and `trace_id` are the writing envelope's `observedAt` and `traceId`; a record's access set is its envelope's, its content hash is over canonical JSON (keys sorted), and `Expect::Hash` compares it; `Conflict.current` is the current hash, or the current revision for `applied`. `DocumentWrite::check` is shared: a document's envelope must agree with it on space, access and sensitivity, its hash and size must match its bytes, and its metadata is at most 256 KiB | 3.1, 5.4 |
| B6 | Section 3.2's checkpoint policy runs from the host after a run, but the host holds the traits | `DocumentStore::checkpoint()`, a default method that does nothing; SQLite's runs `PRAGMA wal_checkpoint(TRUNCATE)` and ignores a busy result. `SqliteStore::info()` reports the pragmas, schema version and file sizes for `store-show` and `store-check` (step 4). `PRAGMA journal_mode=WAL` on a store several processes create at once can answer busy past the busy handler, so open retries it until the lock timeout | 3.2 |
| B7 | Section 1 says `umbel-store` has no new third-party dependency, `umbel` (host) adds none of its own, and "the existing jobs do not build SQLite" | `umbel-store`'s feature `conformance` adds the optional `tempfile` (already in the lock; the types and traits need nothing new). The host depends on `umbel-store` now and re-exports `STORE_TRAITS_VERSION` as `STORE_VERSION` (step 1's A8). The `check` and `msrv` jobs run `--workspace --exclude umbel-store-embedded`; the new `knowledge` job (Linux and macOS, 45 minutes until step 3 measures it, plus an MSRV check on Linux) owns the SQLite crate. `[profile.dev.package]` optimises `libsqlite3-sys` and `sha2` | 1, 12 |

## Amendments from step 3

Step 3 ([643](https://github.com/lushly-dev/afd/pull/643)) read this specification against tantivy
0.27.0 and `tantivy-query-grammar` 0.27.0 and made these smallest-correct changes. Everything else
is built as written. C1 corrects a claim the revision made about the grammar; the rest are details
the specification left open.

| # | Where the text and the code disagreed | What step 3 did | Section |
| --- | --- | --- | --- |
| C1 | Section 8.1 item 3 and the trajectory row say the grammar marks an unquoted `roll*` with `prefix: true` and reads `*b` as a `Regex` leaf. In 0.27.0 `prefix` is set **only** for a quoted phrase (`"roll"*`, `'a b'*`); an unquoted `roll*` arrives as the word `roll*` with `prefix: false`, and `*b`, `b*b` and `ro*ll` are plain words too (a `Regex` leaf is only `/pattern/`). tantivy's own parser does not read them either, so the tokenizer would silently reduce `*b` to `b` | The builder reads a **single trailing unescaped `*`** of an unquoted word as the prefix (`roll*`, `title:roll*`), and refuses every other unescaped `*` (`*b`, `ro*ll`, `roll**`, `**`) as `QUERY_INVALID` rather than dropping it. A quoted or escaped star is text. `Regex`, `All` (`*`), `Exists` (`field:*`) and `Set` leaves are refused with a reason. `?` is punctuation | 8.1 |
| C2 | Section 8.1 allows a prefix wherever a field is named | A prefix is available on the text fields (`title`, `aliases`, `description`, `headings`, `body`, `code`, `path`). On a raw, date or `meta` field (`tags:plat*`) it is `QUERY_INVALID`: a raw field has no positions for a phrase prefix, and a range over its terms would not be bounded at 256. The expansion is a `ConstScoreQuery` of 1 under the field's boost, so a prefix scores exactly the boost (tested: `title:roll*` scores 3) and a user `^` multiplies it. The cap holds for the one-term form (the scorer stops after 256 terms; tested with 300 terms sharing a prefix) | 8.1 |
| C3 | Section 3.1 says `search` returns BM25 scores "ordered by score then `(doc, ordinal)`"; section 8.2 rounds to four places "first" | The index rounds: `ChunkHit.score` is the score to **four decimals**, and the order is rounded score descending, then document id, then ordinal. It reads one candidate past the limit and widens its window (up to 4096) while that candidate ties the last one at four decimals, so which tied chunks make the cut never depends on segment order. A tie wider than 4096 candidates is cut by tantivy's order | 3.1, 8.2 |
| C4 | Section 8.1 item 5 adds the reader filter and structured filters as mandatory clauses without saying how they score | Both are `ConstScoreQuery(…, 0.0)` inside the outer `BooleanQuery`: they filter and add nothing to a score, so a hit's score is the same for every reader and every filter (tested). This is owner decision 4's accepted leak, not a new one: statistics still span the index | 8.1, 6 |
| C5 | Section 3.2 keys the petgraph cache by `(space, graph applied rev, reader filter digest)`; amendment B3 made an edge readable through its origin document's **current** access set | The key adds the store's **head** revision. A document write that tightens an access set moves the head, not the graph's applied revision, and must hide its edges at once; a cache keyed without the head would keep serving them (tested). `SqliteStore::readable_graph(reader)` returns the `StableDiGraph` with the node index; eight entries, least recently used evicted | 3.2 |
| C6 | Section 3.2 has a writer session take tantivy's lock; opening an index is unstated | `TantivyIndex::open` takes the writer lock **only to create** the index (so processes racing to create one open what the winner made) and opens an existing index without it: a process that only reads never waits for an indexer. It refuses an index not written with LZ4 and a commit payload from a newer schema (`VersionUnsupported`) | 3.2 |
| C7 | Section 3.1 says the lock is "released when the session is committed, aborted or dropped" | `commit` finishes the session: after the commit it waits for the merges the commit made eligible (so no merge runs after the lock is released, which `store-backup` relies on), then drops the writer. A `Conflict` leaves the session open for `abort`. A finished session answers `Invalid` | 3.1, 3.5 |
| C8 | Section 3.1 gives `replace` no limits | At most 2000 chunks per document (section 7.2) and a body of at most 1 MiB are `TooLarge`; two chunks with one ordinal, a chunk of another document, and a date that is not RFC 3339 are `Invalid`. Every chunk is built before anything is staged, so a refused `replace` stages nothing | 3.1 |
| C9 | Section 8.1 says `meta.<key>` addresses the JSON field "only for keys the schema pack lists as `filterable`" | The index cannot know the pack: the **plugin** puts only filterable keys into `IndexChunk.meta`, so the allow-list is enforced at index time, and a key never indexed matches nothing. A value matches as the raw string and also as the number or boolean it reads as (`meta.tier:1`, `meta.ready:true`); a dot in the key is a nesting separator | 8.1 |
| C10 | Section 8.1 says ranges parse as RFC 3339 on date fields | Any offset is accepted and converted to UTC; `updated` and `stale_after` are held at second precision. `updated:<instant>` is a one-point range; `[* TO *]` is `QUERY_INVALID` (it would match every document that has a date, which `field:*` was refused for). A range names its field | 8.1 |
| C11 | Section 8.2 asks for snippets of 240 characters (concise) or 480 (detailed) | The index makes one snippet per hit, **240** characters, `**` around the matches, and none when the match is outside the body. `IndexQuery` carries no length, so the detailed form's 480 needs a field there; step 6 adds one (`snippet_chars`) if it wants it. Nothing in step 3 depends on it | 8.2 |
| C12 | Section 3.2 lists `stopwords` among the features | The feature is carried as specified; `en_stem` is lower-casing, splitting and stemming, and **removes no stop words**, so `the` is searchable. No stop-word filter is registered | 1, 3.2 |
| C13 | Section 3.1 names one `index` group of the suite and the plan names `conformance.rs` and `multiprocess.rs` | The suite gains the `index` group (twelve cases: terms, Booleans, phrases and fields; ranges and prefixes; the 256-term bound; boosts; errors and limits; `access` refused in every position; the reader clause; filters; ties and rounding; atomic commits; `applied` never lowering; `replace` and `clear`), the two cases that waited since step 2 (`access::the_index_honours_the_reader_filter` and `concurrency::two_index_writer_sessions_take_turns`), `samples::chunk`, and `run_groups(factory, spawn_writer, only)`, which runs the named groups. The in-memory fake has no index, so its index cases skip; the embedded backend's `index_suite_detects.rs` plants four faults in the real index (the reader ignored in `search` and in `chunks`, a lowered commit swallowed, a lowered commit raised) and fails each in the case that should catch it. `multiprocess.rs` adds two indexer processes taking turns and never lowering either revision, a second process waiting for the writer and then `Busy`, a killed indexer leaving no stale lock, and a run after a crash between the two commits redoing only the lagging store | 3.1, 12, 14 |
| C14 | Section 12 and the plan: the `knowledge` job's timeout is "three times the measured time" | Measured cold on the development machine (Apple silicon, dev profile with `line-tables-only`, `-j4`, a load average of 10 to 18 from other agents) in a fresh target directory: `cargo build -p umbel-store-embedded` 83 s and 640 MB; clippy on the two crates 20 s; their tests 75 s (build and run; the suite is about 12 s of it); the `wasm32-wasip2` check 4 s; the MSRV check 23 s: **205 s** and 1.1 GB for the job's steps. Tantivy and the 96 crates it adds beyond SQLite, `umbel-store` and their dependencies took 135 of the build's 188 CPU-seconds (`tantivy` 57 s, `tantivy-columnar` 18 s, `tantivy-query-grammar` 4 s, `frostem` 3 s), against 28 s for SQLite's C build; the `tantivy` rlib is 88 MB and `tantivy-columnar`'s 15 MB. Three times 205 s is ten minutes; the `knowledge` job's timeout is **15 minutes** (it was 45), because the hosted runners are slower than this machine and had not run the job when it was set. The first hosted runs are in the pull request; lower the timeout to three times the slower of them if that is under 15 | 12 |

## Amendments from step 4

Step 4 read this specification against the host and made these smallest-correct changes.
Everything else is built as written; the named tests are `store_grants.rs`, `access_filter.rs`,
`require_human.rs`, `store_commands.rs`, `doctor_stores.rs` and the rest of `manifest_v2.rs`.

| # | Where the text and the code disagreed | What step 4 did | Section |
| --- | --- | --- | --- |
| D1 | Rule 3 and rule 5 make derivation reads and `as_reader` depend on the command's effects and exposure, but `Services::call(input, context)` does not know which command it serves | `Services::call_command(command, input, context)` joins `call`; the SDK handler uses it. `call` keeps its signature and, knowing no command, refuses both with `STORE_WRITE_NOT_ALLOWED`. `Shared` records each manifest command's `store-write` effect and CLI-only exposure | 3.3 |
| D2 | Rule 6 has the gate set `dev.umbel/changes` from what the call's services recorded, and rule 8 has it stamp `replay: "recorded"`, but a middleware cannot hand the handler anything and the services are built inside the handler | A `Ledger` keyed by the call's trace id: the services note each use and each revision written, the gate takes the record after the handler returns. Two concurrent calls sharing a trace id (or both lacking one) would share a record, which affects only the event's `changes` range and the replay stamp; every surface sets a trace id. A call counts as "used" when it read or wrote a store, listed or read files, or asked for `as_reader`; `events` reads are not stored state and do not | 3.3 |
| D3 | Rule 7 names the allow-list's two keys only | `dev.umbel/index` is kept only as `{ <space>: { applied, head, schema } }` for the call's spaces, each state three unsigned integers and nothing else; a value of the wrong shape is dropped. `dev.umbel/trust` is kept only as `"content"`, for compiled and component plugins; a mounted result is `"external"` as before. `dev.umbel/changes` is set only on a successful result that wrote | 3.3 |
| D4 | `CallContext.spaces` is "the checked spaces (`[space]` for a single-space call)" and says nothing of a command with no space input | A command with no `space` or `spaces` input gets `[<default space>]`; its `CallContext.space` stays `None`, so a handler still tells the two kinds apart. A mutation that has only `spaces` is projected into the default space (it has no `dev.umbel/space`) | 3.3 |
| D5 | Rule 9 puts `SPACE_NOT_READABLE` in the "reader filter" step before the handler without saying which commands | Every plugin command's spaces are checked in the gate, in the order `SPACE_NOT_FOUND`, `PLUGIN_NOT_ENABLED`, `SPACE_NOT_READABLE`, then `require-human`. The host built-ins that take a space check it themselves: `event-list`, `store-show`, `store-check`, `store-backup`. `space-list` and `workspace-show` still list every declared space (ids and titles only); a call with no principal the host set, an actor with no id and a test actor are anonymous and match only `*` in `readers` and groups whose members include `*` | 3.3, 6 |
| D6 | Rule 1 says a write grant with no `allow`, "or one whose entries name a space the instance is not enabled for", is denied; the form of an entry, the version that reads it and the other grants are not fixed | Configuration version 3 reads `grants`; versions 1 and 2 keep it reserved (accepted, reported, meaningless). Only the five write grants take a list, each at least one entry, no repeat; entries are checked at open against the declared spaces (`<space>/<collection>` or `<space>/*`; `<space>` or `*`); at load **any** entry naming a space the instance is not enabled for denies the grant. `http` and `secrets` take no list yet. `workspace-config.v3.json` carries the shapes and `deny` lists the ten grants | 3.3, 4.1 |
| D7 | Section 3.3 says components and mounted plugins get `PLUGIN_GRANT_UNAVAILABLE` naming world 1.1.0 | Any store grant on a plugin whose kind is not `compiled` is unavailable with that message (a mounted manifest cannot declare grants at all); a build without the `store-embedded` feature makes every store grant unavailable. `GRANTS` holds the sixteen grants of both phases and `RESERVED_GRANTS` only `memory`, `http` and `secrets` | 3.3 |
| D8 | Section 3.3 has world 1.1.0 add the four `host-error` cases and 1.0.0 stay frozen | The 1.0.0 mapping in the host's component state turns a new variant into `invalid(<text>)`; no component holds a store grant, so it cannot arise | 3.3 |
| D9 | Section 3.5's `store-backup` takes "a new file at `path`" and also copies the index and writes a manifest | `path` names a new **directory** inside the workspace and outside `state/` (its parents are created); it holds `store.sqlite3`, `index/v1/<files>` and `manifest.json`. The files named by `meta.json` are copied while the index writer is held, except a `.del` that does not exist: tantivy lists the delete file of a segment whose last delete pass removed nothing without writing it. `store-backup` is a mutation (`workspace-write`) and joins the unprojected ones | 3.5 |
| D10 | Section 3.5's `store-check` excludes changes whose trace is "one of the journal's open (started, not finished) entries" | The journal appends only finished entries, so no open entry is visible; the 60-second rule is the only exclusion. `store-check` returns `STORE_CORRUPT` with the report in `details` when any check fails (an index or database that does not open is the check `store.open`), else a success with one `STORE_CHECK_<ID>` warning per warn. Its checks are `store.sqlite`, `store.index`, `store.access`, `store.revisions` (ahead of the head fails, behind warns), `store.journal` | 3.5 |
| D11 | `store-show` counts "documents the caller can read" and lists chunk, node and edge counts | `counts` has documents, records, changes, chunks, nodes (distinct ids) and edges (one per origin), each over what the caller can read; `totals` has the same over everything and is given only to a person at the CLI. `SqliteStore::counts`, `integrity_check`, `access_problems` and `backup_to` and `TantivyIndex::count_readable` serve the three commands | 3.5 |
| D12 | The doctor's `stores.*` checks are listed but not placed | The file-only doctor reports `stores.version`, `stores.access` and `stores.lag` as `skip` after `collections.roots`; a sealed host fills them in, opening only stores that already exist, so a health check creates nothing | 3.5 |
| D13 | Section 3.4 has the CLI show the `require-human` prompt and refuse other surfaces, without the mechanism | The CLI, after a terminal answer, marks the call's context with `dev.umbel/human-confirmed = <command>`; the plugin gate refuses the command with `CONFIRMATION_REQUIRED` unless the interface is the CLI **and** the mark names it, so a batch, MCP, an in-process agent and the library are refused alike. `--yes` and `--approve` fail before the prompt, and the approval hook of such a command never gets the `--approve` shortcut | 3.4 |
| D14 | Section 8.6 maps the manifest key to `with_output_budget` | The loader applies it to a handler's definition and to a plugin's finished definition alike; `CallContext.output_budget` is `CommandContext::output_budget()`; the component's call context stays without one | 8.6 |
| D15 | Section 1 says `umbel` (host) "adds none of its own" dependency and the `check` and `msrv` jobs "do not build SQLite or tantivy" | The host depends on `umbel-store-embedded` through its default feature `store-embedded`, so excluding the package from the workspace commands no longer keeps it out of the build: those jobs now build SQLite and tantivy once. Plugin crates that link the host with `default-features = false` do not | 1, 12 |

## Amendments from step 5

Step 5 read this specification against the host, the SDK and the crates it uses, and made these
smallest-correct changes. Everything else is built as written; the named tests are
`scan/tests/scan.rs`, `okf/tests/frontmatter.rs`, `okf/tests/structure.rs` (with
`okf/tests/flag_rate.rs`), and `plugins/sources-filesystem/tests/sync.rs`, `access_mirror.rs`,
`readable_results.rs` and `confinement.rs`.

| # | Where the text and the code disagreed | What step 5 did | Section |
| --- | --- | --- | --- |
| E1 | Section 5.2 has the plugin walk "each collection root" and apply `include`, `exclude`, `default_type`, `strict`, `max_file_bytes` and the collection's access, but no service gives a plugin the workspace's collection settings: `config` is the instance's own configuration and the `content` grant lists files by collection id only | A new service under the `content` grant, `HostServices::content_collections(space) -> Vec<CollectionInfo>` (`Cx::content_collections`, `SpaceCx::content_collections`), reports each collection of the space in configuration order: id, kind, include, exclude, access, sensitivity, default type, strict and `max_file_bytes`. **Never the root**: a plugin addresses files by collection and relative path, so no filesystem path reaches it (section 11, "no path leaks"). This is a host and SDK change in the same pull request as the plugin; `umbel.yml`'s plugin-isolation job accepts that when the pull request body carries a line `Plugin-isolation-exempt: <the host change and why>` | 3.3, 4.1, 5.2 |
| E2 | Section 5 and the exit criterion name the plugin `sources-filesystem` (`compiled:sources-filesystem`, envelope `plugin: "sources-filesystem"`), but a manifest's `plugin.id`, a `compiled:<id>` source and a pack's `plugin` are `^[a-z][a-z0-9]{0,31}$` (phase 1 section 4.1, the same rule as a domain), which has no hyphen | The plugin's id is **`sources`** and its domain `sources`, which owns the `sources-` commands. The crate and directory keep the name `umbel-plugin-sources-filesystem` and `plugins/sources-filesystem`. Read `compiled:sources`, `plugins.sources` and the envelope's `plugin: "sources"` wherever the specification says `sources-filesystem`; a space's pack override is `spaces/<space>/packs/sources/frontmatter/`. A later connector plugin is its own id (and, since a domain has one owner, its own domain) | 1, 5, 12 |
| E3 | Section 5.2 keeps the sync state as "a record of kind `sync-state` per collection", but a record is at most 2 MiB and a collection may hold 100 000 files (about 130 bytes each) | The state is **sharded**: records of kind `sync-shard`, id `<collection>/<two hex digits>`, 256 per collection, the shard chosen by the first byte of the SHA-256 of the path; each file is `[size, mtime_ms, hash, skip reason, access-set index, inherited-rule key, collection digest]` with the access sets interned per shard. A record of kind `sync-state` (id `<collection>`) summarises the last run that wrote. A run that changed nothing writes neither, so a no-op sync takes no revision, and `sources-status`'s `lastSync` is the last sync that wrote something. All carry the access set `["space"]` | 5.2 |
| E4 | Section 5.2 says one call reads "at most `limit` files (default 5000)" and 64 MiB, and that a sync reaching a bound "commits what it wrote" | `limit` counts the files **read** (new, changed, or read and then skipped); a file whose size and modification time equal the state costs nothing, so a large collection already synced is confirmed in one call. The 64 MiB is the sum of the listed sizes of the files about to be read, checked before each read (and the `.umbel-access.toml` files read), shared across the collections of one call; the host's own per-call counter is never tripped. A collection the call did not reach reports `remaining: true` with `stoppedAfter: null` | 5.2 |
| E5 | Section 5.3 says "the nearest `.umbel-access.toml`" without saying what a key it leaves out means, or what a rule that does not read means | The nearest file in the file's directory or an ancestor wins **as a unit**; a key it leaves out takes the **collection's** value, not an outer file's. A file that is not TOML, names an unknown key, has an empty or invalid `access`, an invalid `sensitivity` or is over 64 KiB, and a document whose own `access` key is not a non-empty list of valid tokens, skip every file they govern with `ACCESS_INVALID` (fail closed: never more readable than it asked to be). A change to a rule, or to a collection's defaults in `umbel.toml`, is noticed without the file changing: the state keeps a key of the inherited rule and a digest of the collection's settings and the schema pack, and a file whose key or digest differs is read again (written only when its access or sensitivity differs). `.umbel-access.toml` is never a document, whatever `include` says | 5.3 |
| E6 | Section 5.1 flags `broken-links` and section 7.1 resolves links against stored documents, but at sync time the documents a link points at may not be stored yet | The sync judges a link against the collection's selected files only: a document of its own collection that is not among them, or a heading of itself that does not exist. A link into another collection is not judged (that collection's sync may not have run). The flag reflects the collection when the document was last written and can go stale when the target appears later; `knowledge-describe` (step 6) computes the current list | 5.1, 7.1 |
| E7 | Section 5.2 does not say what becomes of a stored document whose file stops being readable as one | The document is deleted (a tombstone, counted in `deleted`, and the file counted in `skipped` under its reason): a skipped file has no document, so search and open never serve the last good version of a file the sync now refuses. A repaired file is added again | 5.2 |
| E8 | Section 5.2 names `SOURCE_UNREADABLE`, `SOURCE_TOO_LARGE`, `SOURCE_LIMIT`, `SOURCE_PATH_INVALID`, `FRONTMATTER_INVALID` and `FRONTMATTER_SCHEMA` | Also used: `SOURCE_UNREADABLE` for a file that is not UTF-8; `FRONTMATTER_INVALID` for an empty block, as step 0b's amendment decided (the block `---` then `---` is not a mapping); `FRONTMATTER_SCHEMA` for a file skipped by a `strict` collection; `ACCESS_INVALID` (E5); `SOURCE_CONFLICT` (the compare-and-set lost twice: the file is left for the next run); `COLLECTION_FAILED` (a warning: one collection's error does not hide the others' totals, and all of them failing is the first error as a failure); `COLLECTION_NOT_FOUND`; `SOURCES_PACK_INVALID` (a `data/schema.json` override that does not load). A `CONTENT_FLAGGED`, `FIELDS_LIMITED`, `FRONTMATTER_SCHEMA` or `OKF_VERSION_UNKNOWN` warning names at most 20 **readable** ids; a skip warning carries per-collection counts and paths only for a person at the command line | 5.2, 5.5, 11 |
| E9 | Section 5.5 gives `sources-status` the grants `content` and `records` | It also needs `documents`, to tell which stored documents the caller can read; the manifest declares it for both commands. `sources-status` lists `modified` and `deleted` files by readable id, and the paths of new files (no stored document to ask about) to a person at the command line only: `human` actor on the CLI interface. A dry run's new files are the same | 5.5 |
| E10 | Section 7.1 gives `umbel_okf::structure(bytes)`, section 5.1 a 64 KiB cap on frontmatter and caps on title, description, aliases and tags | `structure(text, body_offset)` takes the whole file's text and where the body starts, so every line and byte offset it returns is into the file. `frontmatter::split(bytes)` strips a byte order mark and returns `bom_len`; `ingest::analyze` returns `body_offset` into the original bytes. **Owners** are capped like tags (32, each 128 characters, `fields-limited`), because section 7.2 copies them into every chunk and the specification named no cap. Collection is bounded by `MAX_HEADINGS` (20 000), `MAX_BLOCKS` (100 000), `MAX_LINKS` (50 000) and `MAX_CODE_SPANS` (50 000), past which `Structure::limited` is set; a heading's text is cut at 512 characters | 5.1, 7.1 |
| E11 | The manifest's input schemas are checked by AFD's schema subset | It has no `pattern` keyword, so `collection` is a string of 1 to 63 characters and the plugin answers `COLLECTION_NOT_FOUND` for an id that names nothing, however it is spelled | 5.5 |
| E12 | Section 14 lists the `umbel-knowledge` binary in the step 5 contents of the task | The plan's step 5 row does not include it (step 6 does: "the `umbel-knowledge` binary"), so it is not here | 14 |
| E13 | Section 12 puts the new crates' tests in the `knowledge` job, and step 4 left the `check` job running `--workspace` | The `knowledge` job's clippy, test and MSRV commands name `umbel-okf`, `umbel-scan` and `umbel-plugin-sources-filesystem`; the `check` job's `cargo test` excludes them, as it excludes `umbel-store-embedded`, so no suite runs twice (clippy and the MSRV check still cover the workspace). The three crates are in the release inventory (quarantined) and `architecture.json` | 12 |

**The write scan's flag rate on ordinary documents** (section 11 asks step 5 to record it): the 523
Markdown files of this repository's `docs/`, `endpoints/umbel/docs/`, `packages/`,
`.claude/skills/` and `spec/` (`okf/tests/flag_rate.rs`, which prints it): 17 files `instruction-like`
(3.3 %), 1 `hidden-text` (0.2 %), none unreadable. The test asserts the rate stays under a quarter.

## Amendments from step 6

Step 6 read this specification against the host, the SDK, the index and the chunker's inputs, and
made these smallest-correct changes. It needed no host change (no `Plugin-isolation-exempt:` line).
Everything else is built as written; the named tests are `chunking.rs`, `query_syntax.rs`,
`search.rs`, `open_find.rs`, `spaces.rs`, `budgets.rs`, `security.rs` (read side), `index.rs`,
`process.rs` and a `smoke.rs`, all in `plugins/knowledge/tests/`.

| # | Where the text and the code disagreed | What step 6 did | Section |
| --- | --- | --- | --- |
| F1 | Section 8.5's `knowledge-describe` reports "index and graph applied revisions" and counts backlinks from the graph, but the graph is built in step 7a and the SDK has no service for the graph's applied revision | `knowledge-index` writes the index only. `knowledge-describe` reads `links_to` edges **into** the document from the graph store through the `graph` grant, which counts only origins the caller's reader filter admits (`backlinks.count`; `atLeast` when 1000 edges were read), and reports `indexApplied`. There is no `graphApplied`: until step 7a the count is 0, and the tests seed the graph through the embedded store to prove the readable-only count. The links (`resolved`, `broken`, `external`) are computed from the document at read time, which settles the follow-up that `broken-links` goes stale (E6) for `describe`; a broken link names only what the link says, never the id it resolved to, because a document the caller cannot read must look like one that is not there | 7.3, 8.5 |
| F2 | Section 8.7 lists totals "documents indexed and removed, chunks, nodes, edges, broken links", ends with a best-effort WAL checkpoint, and bounds a run by `limit` | Totals are `documents.indexed`, `documents.removed` and `chunks` (nodes, edges and broken links arrive with the graph, 7a). The checkpoint is not run: no host service exposes it to a plugin (SQLite's autocheckpoint and `store-check` cover it; sources-sync did the same). A **rebuild ignores `limit`** and applies every change in one run, because a commit never lowers the applied revision and a part-way rebuild would claim more than it holds. The result adds `applied`, `rebuild`, `ids` (at most 100, each `{ id, change }`), `idsMore` and `idsComplete` (false when more than 5000 candidates were not all examined), and the warnings `INDEX_REMAINING` and `CHUNKS_LIMITED` (readable ids only). The ids are the readable ones among the documents the run touched: a removal is named from the change log read as the caller (a deletion is as readable as the version it deleted), a written document must also be readable now; at most 5000 candidates are examined | 8.7 |
| F3 | Section 7.2 rule 3 splits only an atomic block over 400 words, but a paragraph or a long line can also pass 400 words or the index's body limit (1 MiB) | **Any** block over 400 words is split at line boundaries, a line over the cap at word boundaries, and a word over 64 KiB at character boundaries; no chunk passes 64 KiB (`MAX_CHUNK_BYTES`). A chunk of no words is dropped, and a document with no content gets one empty chunk so its title, aliases and description still find it. Code is chunked as plain text, 60 lines at a time (also capped at 64 KiB), until step 7b | 7.2, 7.4 |
| F4 | Section 8.2's `INDEX_STALE` compares the applied revision with "head", and `dev.umbel/index` carries `head`, but no service returns the head | `head` is the highest revision of a change the caller can read after `applied` (else `applied`), and `INDEX_STALE` is raised when the caller can read a document change (`put` or `delete`, not a bookkeeping record) after `applied`. A caller therefore learns nothing about changes they cannot read, which is also the owner's accepted leak and no more | 8.2 |
| F5 | Section 8.2 makes the detailed snippet 480 characters; C11 left that to step 6 | Both formats show the index's 240-character snippet. A length on `IndexQuery` would change the store crate and its conformance suite for a cosmetic gain; the follow-up stays open | 8.2 |
| F6 | Section 8.3's locator carries "the content hash" and section 8.2's detailed hit "the locator object" without saying which hash or which key | The locator's hash is the document's **current** stored hash (the index keeps no document hash), so `INDEX_STALE` is what warns that lines may have moved. A hit's `locator` is the string; the detailed hit's `locatorObject` is the object of `locator.v1.json` | 8.2, 8.3 |
| F7 | Section 8.5 lists `verification` and `updated` among `knowledge-list`'s fields | `DocMeta` has neither (they are in the document, not the listing), so the list gives id, title, type, status, rev, content hash, size, sensitivity and flags. `knowledge-describe` has the rest. No access set is shown: the caller holds one token of it, not the whole list | 8.5 |
| F8 | Section 8.5 says `knowledge-changes` gives "readable changes with document ids and hashes" and "revisions skip unreadable changes" | It shows `put` and `delete` changes only (the plugins' record changes are bookkeeping) and reports `nextAfterRev`, the last revision scanned, so a consumer never loops on a page of records | 8.5 |
| F9 | Section 8.1 makes `meta.<key>` searchable "for keys the schema pack lists as `filterable`" (C9 moved that to the plugin), but the schema pack belongs to the `sources` plugin, which `knowledge` cannot read | The `knowledge` plugin has its own pack `ranking`: `data/ranking.toml` holds `[aggregation]` (`secondary_weight`, `secondary_count`), `[status]` (`draft_factor`), `[fusion]` (`rrf_k`) and `[index]` (`filterable`, empty by default). A space overrides it whole (D46). The expansion parameters join the file in step 7a | 8.1, 8.2 |
| F10 | Section 8 lists the plugin's grants for the whole phase | Step 6 declares what it uses: `config`, `packs`, `clock`, `documents`, `index`, `index_write`, `graph` and the optional `content` (collection ids for link resolution in `knowledge-describe`). `records`, `records_write`, `graph_write`, `documents_write` and `content_write` come with steps 7a and 8; `index_write` needs `[plugins.knowledge.grants.index_write] allow = [...]` in `umbel.toml` | 8 |
| F11 | Section 8.2 applies `verified_only` to "every search and open" | It also applies to `knowledge-find`; a document below the human tier is `DOCUMENT_NOT_VERIFIED` there and in open (the caller could read it, so no existence leaks). In search the filter only narrows: a requested tier below human cannot widen it | 8.2 |
| F12 | Section 8.5 names `DOCUMENT_NOT_FOUND` for open and no other failure | New codes: `OPEN_ARGUMENTS_INVALID` (both or neither of `doc` and `locator`, or two ways to place the window), `LOCATOR_INVALID` (not a locator, or another space than the call's: pass `space`), `WINDOW_OUT_OF_RANGE`, `CHUNK_NOT_FOUND`, `HEADING_NOT_FOUND`, `DOCUMENT_NOT_VERIFIED`, `QUERY_INVALID` for a bad `knowledge-find` pattern or `updatedAfter`, `KNOWLEDGE_PACK_INVALID`, `KNOWLEDGE_INDEX_INVALID`. A window whose single line is longer than the whole budget is cut at a character boundary with `WINDOW_LIMITED` and `cutLine` (the only place a value is shortened; AFD's check still refuses a result that does not fit) | 8.5, 8.6 |
| F13 | Section 8.6 has the handler fit "structurally" and AFD's check as backstop | The plugin measures exactly what AFD measures (the canonical JSON without `metadata`; a float with no fraction is written as an integer) and counts every warning inside the fit, so a result that fits to the byte passes and one byte less drops a hit (tested against AFD's own check). `knowledge-describe` leaves out the stored frontmatter and envelope first, then shortens its lists | 8.6 |
| F14 | Section 8.4 has `knowledge-search` take `space` or `spaces` | The handler uses `CallContext.spaces` when `spaces` was given (the host's checked list) and `CallContext.space` otherwise; a multi-space search runs each space through `Cx::in_space` with that space's own reader filter and fuses by `1 / (rrf_k + rank)` at four decimals (ties by space, then document id); each hit keeps its `spaceScore` | 8.4 |
| F15 | Section 8.7's pipeline takes `{ space }` | `space` is optional (a missing `$input.space` is absent, so both steps use the default space). The pipeline is registered only when `sources` is enabled | 8.7 |
| F16 | Section 8.2 says `expand` is the graph expansion, "default `true`" | Accepted, and the result says `"expanded": false` until step 7a builds the graph and applies it | 8.2 |
| F17 | Section 8.2 drops `deprecated` documents "unless `include_deprecated`" and excludes the reserved OKF files | Both are applied to the chunk hits after retrieval (the index's `status` filter takes one value), from `limit × 8` chunks, so a query dominated by deprecated chunks can return fewer than `limit` documents. A hit's document is read again through the document store's own filter and current state before it is shown, so an index that is behind never serves a document that was deleted or that became restricted | 8.2 |

## Amendments from step 8

Step 8 read this specification against the host, the SDK and the plugin as step 6 left it, and
made these smallest-correct changes. Everything else is built as written; the named tests are
`proposals.rs`, `verification.rs` and `security.rs` (write side) in `plugins/knowledge/tests/`,
`okf/src/rewrite.rs`'s unit tests, and `reader_tokens_are_the_callers_own_tokens_and_nobody_elses`
in the host's `tests/access_filter.rs`.

| # | Where the text and the code disagreed | What step 8 did | Section |
| --- | --- | --- | --- |
| G1 | Section 9.2 matches `approvers` entries `group:<g>` against groups "whose `members` hold `human:<id>` or `*`", but no service tells a plugin which groups hold the caller; the groups live in the host's configuration | **One host change** (the pull request body carries `Plugin-isolation-exempt:`): `HostServices::reader_tokens(space)` (`Cx::reader_tokens`), under the `documents` grant, returns the access tokens of the caller's own reader filter in the space (`space`, `principal:<effective>`, `group:<g>` for every group that holds the caller or `*`), sorted. An approver entry matches when the caller holds that exact token. It reveals nothing about any other principal and nothing a store read would not, and it is refused for a space outside the call like every store method | 3.3, 9.2 |
| G2 | Section 9.2 gives `knowledge-approve` a `confirm_prompt` of "the diff summary and the flags", but a manifest's `confirm_prompt` is static text (up to 500 characters) and the AFD approval summary names only the command and its input | The prompts are fixed sentences that tell the approver to have read `knowledge-proposal-show` first; the diff and the scan's flags are shown there, filtered by the approver's reader filter. Because the prompt holds no proposal text, it cannot leak what the approver may not read or carry an injection to them. A dynamic prompt needs a host feature (follow-up) | 9.2, 11 |
| G3 | The plan lists "deprecate" among step 8's commands, but section 9 defines no `knowledge-deprecate` command, only the proposal op `deprecate` | Deprecation is the op: `knowledge-propose` with `change.op = "deprecate"` (and optional `supersededBy`), applied by `knowledge-approve`, which writes `status: "deprecated"` and `superseded_by` as a frontmatter-only rewrite. No new command | 9.1, 9.3 |
| G4 | Section 9.2 makes an `approvers` entry naming another kind `WORKSPACE_CONFIG_INVALID` at open, but areas are the plugin instance's configuration | The instance's configuration schema refuses a malformed entry at open (`PLUGIN_CONFIG_INVALID`, naming the key); the plugin checks again when it reads the areas and answers `AREA_CONFIG_INVALID` | 9.2 |
| G5 | Section 9.2 says show returns "the record, with `diff` and flags", and the record holds the whole new file | `knowledge-proposal-show` returns the record without `change.content` (a create's diff is the whole file) and reports `contentBytes`; it carries `trust: "content"`, `dev.umbel/trust: "content"`, the `CONTENT_FLAGGED` warning when the record has flags, and fits its output budget (16 000/64 000) by showing fewer diff lines with `DIFF_LIMITED` and `diffLines`. `knowledge-proposal-list` lists summaries (ids, states, hashes, flags, principals; no text) | 8.6, 9.2 |
| G6 | Section 9.1 says the diff of a deprecate or verify is "the frontmatter change the apply step will write", but a verify's `by` and `at` are the approver and the time of approval, unknown at submission | The submission diff is computed by the same rewrite with the placeholders `human:<approver>` and `<at approval>`; the file gets the real stamp at apply. A verification is the approving person's attestation, so a pending verify applied by another approver records that approver | 9.1, 9.3 |
| G7 | Section 9.2 lists the apply steps and says approve "resumes and skips steps already done", without fixing what a resumed apply may recompute | The decision (`by`, `at`) is recorded first, and a resumed apply uses the first decision, so a deprecate or a verify rewrites to the same bytes; an apply is "already done" when the file holds the proposal's content (create, update), `status: deprecated` with the named `superseded_by`, or a `verified` entry with the decision's `by` and `at`. A file that is neither the base nor the target is `PROPOSAL_CONFLICT`; before the decision is recorded nothing changes, afterwards the proposal stays `approved` and the failed step is noted in `result.error`. The document put compares-and-sets against the stored document's hash and is tried twice | 9.2 |
| G8 | Section 9.2 gives `derivedFrom[0].contentHash` as "the proposal record's hash" without saying which version of a record that changes at every decision | The hash of the record as it stood when the decision was recorded (`approved`), the version that decided the change; the later `applied` version differs only by `result` and `updatedAt` | 9.2 |
| G9 | Section 9.1 caps `content` at `max_file_bytes`, which can be 16 MiB, but a record is at most 2 MiB and the proposal holds the content and its diff | The record's own cap decides: a proposal that does not fit is `PROPOSAL_TOO_LARGE` (suggestion: split the change), so a collection with a large `max_file_bytes` still takes proposals up to roughly 900 KiB of new text | 9.1, 11 |
| G10 | Section 9 names `PROPOSAL_NO_AREA`, `PROPOSAL_NOT_FOUND`, `PROPOSAL_KEY_REUSED`, `PROPOSAL_CONFLICT`, `PROPOSAL_SELF_APPROVAL` and `PROPOSAL_APPLY_UNAVAILABLE` | Also used: `PROPOSAL_INVALID` (a shape, size or id the proposal cannot have), `PROPOSAL_EVIDENCE_INVALID` (a `document` entry must name a readable document and its current hash; one answer for absent, unreadable and stale), `PROPOSAL_STATE_INVALID`, `PROPOSAL_APPROVER_NOT_ALLOWED` (not a person, or not among the area's approvers), `PROPOSAL_NOT_PROPOSER`, `PROPOSAL_REASON_REQUIRED`, `PROPOSAL_TOO_LARGE`, `PROPOSAL_APPLY_FAILED`, `AREA_CONFIG_INVALID`, `FRONTMATTER_INVALID`; warnings `CONTENT_FLAGGED`, `DIFF_LIMITED`, `RESULTS_LIMITED` | 9 |
| G11 | Section 3.4 says every surface but the CLI answers `CONFIRMATION_REQUIRED` for a `require-human` command | Over MCP and to an in-process agent the command is not exposed at all (`COMMAND_NOT_EXPOSED`, the exposure check runs first); a library call or a batch is `CONFIRMATION_REQUIRED`. Both fail before the handler | 3.4, 9.2 |
| G12 | Section 9.1's `change.baseHash` is "null only for create" | A create leaves `baseHash` out of the input (the input schema types it as a string) and the record stores `null`, as `proposal.v1.json` requires; any other op needs the hash. A `document` evidence entry needs its `contentHash`; an actor with no id is `<kind>:anonymous` in the proposal id and the self-approval comparison | 9.1 |
| G13 | Section 9.3 applies a verification "at once" only in the one call | A verification left pending with `apply: false` and later approved by the same person is not self-approval either (D63's reason applies unchanged); `knowledge-verify`'s idempotency key is a digest of the document, its hash, the note and `stale_after`, so the same call again is the same proposal | 9.3 |
| G14 | Section 8 lists `records_write`, `documents_write` and `content_write` without saying how a deployer's existing configuration copes | `records` and `records_write` are required (a proposal cannot exist without them), so an instance needs `[plugins.knowledge.grants.records_write] allow = [...]` as it needed `index_write`'s; `documents_write` and `content_write` stay optional and, with no `allow`, are withheld (`PROPOSAL_APPLY_UNAVAILABLE` at approve, after the decision is recorded). The tests' shared configuration allows all three | 3.3, 8 |
| G15 | Section 9.3 names `umbel_okf::rewrite_keys` without a signature | `rewrite_keys(text, &[(key, Value)]) -> Result<String, RewriteError>`: a key's lines (its own and the more-indented or same-indentation `- ` lines that continue it) are replaced by a canonical block (scalars and flow values as JSON, lists as block sequences, `by` before `at`), missing keys are appended before the closing fence in the order given, a file with no frontmatter gets a block in front; line endings and a byte order mark are kept; the result is read back with the stores' reader and each requested value checked, else `RewriteError::NotApplied` | 9.3 |
| G16 | Section 9.2 says an area's policy version is recorded at submission | It is recorded at submission and set again to the policy in force when the decision is recorded; a proposal for a collection kind other than markdown, or for `index.md` or `log.md`, is `PROPOSAL_INVALID` | 9.1, 9.2 |

## Follow-ups

| Date | Follow-up | Owner |
| --- | --- | --- |
| 2026-11-01 | Store grants for components: WIT world `umbel:plugin/plugin@1.1.0` with `documents`, `index`, `graph`, `records` and `content` imports | The first phase that needs a component reading stores |
| 2026-11-01 | Output budgets in TypeScript, Python and C++ after step 0b | AFD |
| 2026-11-01 | Documents as MCP resources once a permission-filtered listing exists (`kb://`) | After phase 5 |
| 2026-11-01 | Restore from `store-backup` | Phase 6 |
| 2026-11-01 | Partitioned BM25 statistics per access set, or coarsened scores, and an end to count leaks (owner decision 4) | Phase 5 prerequisite |
| 2026-11-01 | Chunk size against the research (S57 found about 250-token chunks with overlap best in one study; phase 2 uses larger, overlap-free structural chunks): measure alternatives with the eval harness once the baseline exists | After step 9 |
| 2026-11-01 | A per-collection option to block, not only flag, content the write scan matches | When a deployer asks |
| 2026-11-01 | Watching collection roots instead of explicit `knowledge-refresh` | Later |
| 2026-11-01 | The `knowledge` job's timeout: 15 minutes, to lower to three times the slower hosted run when that is under 15 (C14) | After the first hosted runs |
| 2026-11-01 | A dynamic confirmation prompt: a `confirm_prompt` that can name the proposal (id, area, flags) so the terminal shows what is being approved, not only the command (G2) | When a deployer asks; a host feature |
| 2026-11-01 | A length on `IndexQuery` so the detailed form's 480-character snippet needs no second search (C11); step 6 kept 240 for both formats (F5) | Open, when a deployer asks |
