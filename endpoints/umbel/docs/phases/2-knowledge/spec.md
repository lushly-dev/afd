# Phase 2 specification: knowledge

| Field | Value |
| --- | --- |
| Phase | 2, knowledge ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | Repository owner approves; the phase 2 owning agent writes and implements |
| Read first | [STATUS.md](../../STATUS.md), then the [architecture](../../architecture.md), the [decision log](../../decisions.md), and the [phase 0](../0-host-skeleton/spec.md) and [phase 1](../1-plugin-contract/spec.md) specifications, whose shapes this one extends |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request, as the phase 0 and phase 1 steps did |

## Status

- **State:** specification in review, not approved. Written 2026-11-01 by
  the phase 2 owning agent; phase 1's exit criterion was met the same day
  (step 8, [#624](https://github.com/lushly-dev/afd/pull/624), `886c3b4d`). It adds decisions
  [D51 to D67](../../decisions.md) and the architecture amendments they need,
  in the same pull request. Approval is the owner's (D24). Section
  [15](#15-for-the-owner) lists the decisions that touch the trust model or
  that the architecture leaves to the owner.
- **Last verified:** 2026-11-01 against `main` at `1cca6309`, rebased onto `886c3b4d` (phase 1's exit, which changed no shape this specification reads). Evidence, read
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
- **Done:** this specification, in review.
- **Not done:** approval; every step of the [plan](#14-implementation-plan);
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
| Library: tantivy | crates.io | 0.27.0 (2026-10-17, MSRV 1.88); the query parser keeps fields, phrases, `+`/`-`, `AND`/`OR`/`NOT`, `^boost` and ranges; JSON fields; an `IndexWriter` is exclusive per index through a lock file, readers are many | The embedded index (D51); one writer at a time per space across processes |
| Library: rusqlite and SQLite | crates.io; `libsqlite3-sys/upgrade.sh` | rusqlite 0.41.1 (2026-10-28, MSRV 1.89); libsqlite3-sys 0.39.1 bundles SQLite 3.54.1 | The embedded document, record and graph store, `bundled` so no system SQLite is needed (D51) |
| Library: tree-sitter | crates.io; GitHub releases | tree-sitter 0.27.1 (2026-10-08, MSRV 1.90); grammars depend on `tree-sitter-language` 0.1.9; tree-sitter-rust 0.24.2, tree-sitter-python 0.25.0, tree-sitter-typescript 0.23.2 | Code symbols for Rust, Python and TypeScript (with TSX and JavaScript), behind the knowledge crate's `code` feature (section 7.4) |
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

The Cargo workspace (D48) gains five members. Heavy native dependencies are
kept apart so that no step builds more than one new heavy set (section 14).

```text
endpoints/umbel/
├── Cargo.toml                 # members += store, store-embedded, okf, plugins/sources-filesystem, plugins/knowledge
├── store/                     # umbel-store: the store traits v1, shared types, the conformance suite
├── store-embedded/            # umbel-store-embedded: SQLite (WAL) and tantivy, the reference backend
├── okf/                       # umbel-okf: frontmatter, the OKF v0.2 container, markdown structure
├── plugins/
│   ├── sources-filesystem/    # umbel-plugin-sources-filesystem: compiled plugin
│   └── knowledge/             # umbel-plugin-knowledge: compiled plugin, the eval harness, the `umbel-knowledge` binary
├── schemas/                   # + the version 1 and 2 shapes of section 2
└── tests/                     # + the host's store tests (section 10)
```

| Crate | Depends on | New third-party dependencies | Notes |
| --- | --- | --- | --- |
| `umbel-store` | `serde`, `serde_json`, `sha2` | none | Types and traits only, buildable for `wasm32-wasip2`; the conformance suite is the `conformance` module behind the `conformance` feature, a library any backend's tests call |
| `umbel-store-embedded` | `umbel-store` | `rusqlite = { version = "0.41", features = ["bundled"] }`, `tantivy = { version = "0.27", default-features = false, features = ["mmap", "stopwords"] }`, `petgraph = "0.8"` | The only crate that links SQLite and tantivy |
| `umbel` (host) | + `umbel-store`; `umbel-store-embedded` behind the new default feature `store-embedded` | none of its own | Host services, reader filters, the store built-ins (section 3.5). `default-features = false` embedders get no store and every store grant answers `PLUGIN_GRANT_UNAVAILABLE` |
| `umbel-sdk` | + `umbel-store` (types only) | none | `HostServices` gains the store methods (section 3.3), each defaulting to `NotGranted` |
| `umbel-okf` | `afd` (default features off, `frontmatter` on; step 0b), `umbel-store` | `pulldown-cmark = { version = "0.13", default-features = false }` | Shared library of both plugins; not a plugin (D3 governs plugins, not libraries) |
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

`workspace-show`'s `versions` gains `config: 3`, `manifest: [1, 2]`,
`envelope: 1`, `event: 1`, `store: 1`, `document: 1`, `locator: 1` and
`proposal: 1`. The plugin protocol version stays **1** (D40, amended by
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
  "principal": "local",
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
`{ "fromRev": n, "toRev": m, "count": k }`, the store revisions a mutation
wrote, so a consumer can read the documents it touched with
`knowledge-changes` (section 8.7). The phase 2 host writes version 1 for
every new event. Lines already written as version 0 stay as written;
`event-list` returns each line in its own version and accepts both;
`event-rebuild` writes version 1. Cursors stay version 0 (`v0:<space>:<seq>`).

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
| `changes(after: Rev, limit ≤ 1000, reader) -> Result<Vec<Change>>` | `Change { rev, kind: Put \| Delete \| Record, target, content_hash, trace_id }`, ascending; filtered by `reader` (a change to an unreadable document is omitted) |
| `head() -> Result<Rev>` | The last revision, 0 when empty |
| `put_record(ns, kind, id, body, envelope, expect)`, `get_record(ns, kind, id, reader)`, `list_records(ns, kind, after, limit, reader)` | Plugin records (proposals, sync state): JSON bodies of at most 2 MiB, namespaced by plugin instance, with the same revision, change and access rules |

**`SearchIndex`** (the lexical lane; section 8.1 fixes its fields)

| Method | Contract |
| --- | --- |
| `replace(doc: DocId, chunks: Vec<IndexChunk>, applied: Rev) -> Result<()>` | Removes every chunk of `doc` and adds these, staged; an empty list removes the document |
| `commit(applied: Rev) -> Result<()>` | Makes staged changes visible and records `applied` as the index revision, atomically with them |
| `applied() -> Result<Rev>` | The store revision the index reflects |
| `search(query: &IndexQuery, reader) -> Result<Vec<ChunkHit>>` | Parses `IndexQuery.text` in the syntax of section 8.1, **adds the reader filter as a mandatory clause of the same query**, applies the structured filters, and returns at most `IndexQuery.limit ≤ 400` chunk hits with BM25 scores, ordered by score then `(doc, ordinal)`. A syntax error is `Invalid` with the parser's position |
| `chunks(doc, reader) -> Result<Vec<IndexChunk>>` | The stored chunks of one readable document, by ordinal |
| `clear() -> Result<()>` | Empties the index (rebuild) |

**`GraphStore`**

| Method | Contract |
| --- | --- |
| `replace_document(doc, nodes, edges, applied: Rev)` | Replaces every node and edge whose `origin` is `doc`; staged until `commit` |
| `commit(applied)`, `applied()` | As the index |
| `neighbors(node, kinds, direction, limit, reader)` | Edges incident to `node` whose both endpoints are readable |
| `nodes(ids, reader)` | The readable ones |
| `edges_of_kind(kind, limit, after, reader)` | Paged |

Nodes and edges carry the access set of the document they came from; a
node shared by several documents (a tag, an owner, a symbol) is readable
when any document that produced it is, and an edge is readable only when
both endpoints and its origin document are (D53). Traversals (`path`,
`related`) are computed by the knowledge plugin over `neighbors`, or by the
backend's optional fast path `subgraph(space-wide, reader) -> petgraph`
used by the embedded backend (section 3.2), with the same filter.

**Conformance suite** (D10). `umbel_store::conformance::run_all(factory)`,
where `factory` makes a fresh, empty set of the three stores for a space,
runs these case groups, each a `#[test]`-style function returning a
report: `documents` (CAS, revisions, tombstones, paging order, size
limits), `records`, `changes` (order, filtering, gaps never appear),
`envelope` (refusals of section 2.1), `access` (every read path with
three reader filters over the fixture of 40 documents in
`store/fixtures/access/`: no unreadable id, title, chunk, node, edge or
change ever returned, and `get_document` answers `None` alike for absent and
unreadable), `index` (every syntax form of section 8.1 against a fixed
corpus with expected hit sets, the mandatory reader clause, the refused
`access` field, `commit` atomicity: a reader sees all of a commit or none),
`graph` (endpoint filtering, replace semantics), `concurrency` (two writers
in two threads, then two processes through the suite's `spawn_writer`
helper, interleaving 200 writes: revisions are dense and unique, every write
is readable), `durability` (reopen after drop returns the same head and
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
- **tantivy** under `index/v1/`, an `MmapDirectory`. A write takes the
  index's `IndexWriter` with one thread and a 64 MiB budget; tantivy's
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
| `content_write` | Atomically replace or create one file in a collection root (temporary file in the same directory, `fsync`, rename), with an expected content hash | **yes** | `<space>/<collection>` or `<space>/*` |
| `documents` | `get_document`, `list_documents`, `changes` under the caller's reader filter | no | — |
| `documents_write` | `put_document`, `delete_document` | **yes** | `<space>/<collection>` or `<space>/*` |
| `records` | `get_record`, `list_records` in the instance's own namespace, under the caller's reader filter | no | — |
| `records_write` | `put_record` in the instance's own namespace | **yes** | `<space>` or `*` |
| `index` | `search`, `chunks`, `applied` under the caller's reader filter | no | — |
| `index_write` | `replace`, `commit`, `clear`, and derivation reads | **yes** | `<space>` or `*` |
| `graph` | `neighbors`, `nodes`, `edges_of_kind`, `subgraph` under the caller's reader filter | no | — |
| `graph_write` | `replace_document`, `commit`, and derivation reads | **yes** | `<space>` or `*` |

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
   returns to its caller is the plugin's responsibility. Compiled plugins
   are trusted code (owner decision 1 of 2026-11-01), so this is API
   discipline, not a boundary; section 15 asks the owner to confirm it.
4. **Provenance is enforced** on every write (section 2.1): the host fills
   `space`, `plugin`, `agent`, `principal`, `traceId` and `observedAt` from
   the call, overwriting what the plugin sent, and refuses the rest when
   invalid.
5. **Evaluating as another principal.** `CallServices::as_reader(principal)`
   returns read services whose reader filter is built, by the host, for the
   named principal string (section 6). It works only in a command whose
   manifest entry is exposed to the CLI alone and only when the call's actor
   is a human; otherwise `STORE_WRITE_NOT_ALLOWED`. `knowledge-eval` is its
   one user (section 10.3).
6. **Revisions reach the event.** A command that wrote sets nothing extra:
   the host records the first and last revision the call wrote and sets
   `result.metadata["dev.umbel/changes"]`, from which the projection fills
   the event's `changes`.

The SDK (`umbel_sdk::HostServices` and `Cx`) gains one method per row
above, with the types re-exported from `umbel-store`, each defaulting to
`NotGranted` as phase 1's do: `content_list`, `content_read`,
`content_replace`, `doc_get`, `doc_list`, `doc_changes`, `doc_put`,
`doc_delete`, `record_get`, `record_list`, `record_put`, `index_search`,
`index_chunks`, `index_applied`, `index_replace`, `index_commit`,
`index_clear`, `graph_neighbors`, `graph_nodes`, `graph_edges`,
`graph_subgraph`, `graph_replace`, `graph_commit`, `derive_changes`,
`derive_document`, `as_reader`. A raw `CompiledPlugin` calls the same methods on
`CallServices`.

### 3.4 Effects and manifest version 2

Manifest version 2 (`schemas/plugin-manifest.v2.json`) is version 1 with two
effects admitted for plugins:

| Effect | Means | Requires |
| --- | --- | --- |
| `store-write` | Writes through a store write grant | One of `documents_write`, `records_write`, `index_write`, `graph_write` declared |
| `workspace-write` | Writes files outside `state/` | `content_write` declared |

`mutation` is derived as in phase 1: any effect but `inspect` makes a
command a mutation, so its successful result is projected into the event
log. It also admits the command key `output_budget = { default_bytes,
max_bytes }` (section 8.6). Everything else in version 2 equals version 1. A host serving phase 2
reads `manifest_version` 1 and 2; any other is
`PLUGIN_PROTOCOL_UNSUPPORTED`.

### 3.5 Host built-in commands

`store` becomes a host domain, so no plugin command may start with
`store-`.

| Command | Mutation | `mcp` | `agent` | `cli` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `store-show` | No | true | true | true | `{ space }`: backend (`embedded`), store traits version, SQLite schema version, head revision, document, record, chunk, node and edge counts, index and graph applied revisions, file sizes. Counts are of documents the caller can read, plus totals only for a CLI human |
| `store-check` | No | false | false | true | `{ space }`: `PRAGMA integrity_check`, tantivy segment checksums (`Index::validate_checksum`), access-table consistency (every document has at least one token), index and graph applied revisions not ahead of the head; each finding as a doctor-style check |
| `store-backup` | Yes (`workspace-write`, not projected) | false | false | true | `{ space, path }`: `VACUUM INTO` a new file at `path` (inside the workspace, must not exist), then the index directory copied after a commit, with a manifest of SHA-256 digests. Restore is out of scope (section 13) |

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
readers = ["*"]                          # access tokens that may read the space; default ["*"], everyone

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
  in a token must be declared. `readers` is non-empty.
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
- **Frontmatter** is read with AFD's frontmatter reader (step 0b): a first
  line `---`, one YAML 1.2 core-schema mapping, a line `---`; no tags,
  anchors or aliases; at most 64 KiB and depth 64. A file without
  frontmatter is a document of `default_type`, titled by its first level-1
  heading or else its file name. Malformed frontmatter skips the file with
  `FRONTMATTER_INVALID`.
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
nothing for that collection.

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
| `flags` | Sorted subset of `type-defaulted`, `schema-invalid`, `instruction-like`, `hidden-text`, `broken-links` |
| `size`, `lines` | Byte and line counts |
| `envelope` | Provenance envelope version 1, `origin: document-derived`, `sources: [{ "resource": "/<collection>/<path>" }]`, `generated` from the frontmatter |

### 5.5 Commands

| Command | Effects | Grants | Input | Result |
| --- | --- | --- | --- | --- |
| `sources-sync` | `store-write` | `content`, `documents`, `documents_write`, `records`, `records_write`, `packs` | `{ space, collection?, dry_run? }` | Per collection: `added`, `updated`, `deleted`, `unchanged`, `skipped` with reasons (at most 100 listed, then a count), `fromRev`, `toRev`; `dry_run` writes nothing and is still journaled |
| `sources-status` | `inspect` | `content`, `records` | `{ space, collection? }` | Per collection: root, file count, last sync revision and time, files whose size or mtime changed since (a stat walk, no reads) |

Record: `{ "kind": "sync", "id": "<space>/<collection or *>", "version": <toRev> }`.

## 6. Access (D53)

**Tokens.** An access token is one of `space` (anyone who may read the
space), `group:<id>` (`<id>` matching `^[a-z][a-z0-9-]{0,62}$`) or
`principal:<kind>:<id>`. An access set is a non-empty list of tokens; a
document is readable by a principal holding any of them.

**Principals.** The string for an actor is `<kind>:<id>` (`human:local`,
`agent:loopback`). For access the **effective principal** is the person
behind the call when there is one, `human:<onBehalfOf>` (or the actor itself
when its kind is `human`), else the actor. Delegation narrowing (an agent
holding less than its person) is phase 5's (reserved principal field
`delegationChain`).

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

**What remains visible.** BM25 term statistics are computed over the whole
space's index, so a hidden document can shift visible scores slightly; no
hidden content, id or count is returned. Partitioned statistics are an
`org` concern (section 13) and recorded in [section 15](#15-for-the-owner).

**Before phase 5.** Identity still comes from phase 0's context hook: every
stdio caller is the local agent (acting for `principal.on_behalf_of`), every
HTTP caller the `loopback` agent, the CLI the human `local`; embedders set
actors through the library surface. Phase 2's filtering is therefore exact
for embedders and tests, and a policy, not a boundary, on the local
transports until phase 5 verifies callers. Section 15 records it.

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
| `co_cited` | doc ↔ doc (both directions), when at least 2 documents link to both | Number of such documents |

Backlinks are `links_to` read in the incoming direction. Timestamps (the
document's `generated.at`, last `verified.at`, `staleAfter`, the store
revision time) are node attributes the commands filter and sort by, not
edges. Co-citation is recomputed for the documents whose links changed and
their link targets, considering at most 200 outgoing links per document. No
edge crosses spaces. Model-extracted entities are not built (a per-collection
opt-in after phase 2).

### 7.4 Code symbols (tree-sitter, the `code` feature)

A collection with `kind = "code"` holds source files; its default `include`
is `**/*.rs`, `**/*.py`, `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.mjs`. Each
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
names. A file over 1 MiB or with a parse error rate over 25 % of its bytes is
indexed as plain text in 60-line chunks with the warning `CODE_PARSE_DEGRADED`.
Without the `code` feature code collections are indexed as plain text and
`knowledge-describe` says so.

## 8. The `knowledge` plugin: search, open, find and the graph commands

Kind `compiled`, id `knowledge`, domain `knowledge`, manifest version 2.
Grants: `config`, `log`, `packs`, `clock`, `documents`, `records`,
`records_write`, `index`, `index_write`, `graph`, `graph_write`,
`content_write` (optional: without it, proposals cannot be applied and
`knowledge-approve` answers `PROPOSAL_APPLY_UNAVAILABLE`), `documents_write`
(optional, same).

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

Syntax is tantivy 0.27's query parser over those fields, which phase 2
promises to callers as:

| Form | Example |
| --- | --- |
| Terms, default fields, **OR** by default | `rollback canary` |
| Required and excluded | `+rollback -staging` |
| Boolean | `rollback AND (canary OR blue-green) NOT legacy` |
| Phrase, with slop | `"feature flag"`, `"feature flag"~2` |
| Field | `title:rollback`, `tags:platform`, `type:runbook`, `meta.team:infra` |
| Boost | `rollback^3 canary` |
| Range | `updated:[2026-01-01T00:00:00Z TO *]` |
| Prefix | `roll*` (at most 256 expansions) |

Limits: at most 1024 characters, 64 clauses and 8 fields per query; a parse
error, an unknown field, or the field `access` is `QUERY_INVALID` with the
position and a suggestion that names the valid fields. Structured filters
are also inputs (section 8.2), turned into the same clauses, so callers need
not write syntax.

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
   rounded to 6 decimal places first, so order does not depend on the last
   bits of a float.

Each **hit** (concise):

```json
{
  "space": "main",
  "doc": "handbook/deploy/rollback",
  "title": "Rolling back a deployment",
  "type": "runbook",
  "score": 12.481503,
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
`url` is never set (no filesystem path leaks). `metadata` carries
`dev.umbel/index`: `{ "<space>": { "applied": rev, "head": rev, "schema": 1 } }`
and `dev.umbel/trust: "content"`. `confidence` is not set: BM25 scores are
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
`knowledge-search` alone accepts `spaces` (2 to 8, distinct): the host's
plugin gate checks that the instance is enabled for each (`PLUGIN_NOT_ENABLED`)
and the reader filter checks each (`SPACE_NOT_READABLE`) before anything
runs; the plugin searches each space separately with that space's reader
filter, then fuses the per-space rankings by **reciprocal rank fusion**
(`1 / (60 + rank)`, ranks from 1, ties by space then document id), because
BM25 scores of different indexes are not comparable. Every hit keeps its
`space`; `score` becomes the fused score and `spaceScore` the space's own.
Nothing is written back; the graph expansion runs within each space before
fusion. A multi-space search is journaled once, a read, with no event. All
other commands are single-space.

### 8.5 The other read commands

| Command | Input | Result |
| --- | --- | --- |
| `knowledge-open` (first-class) | `{ space, doc \| locator, from_line?, lines? (default 120, 1 to 400), chunk?, heading?, expect_hash? }`; `chunk` and `heading` (a slug) select their line range, at most 400 lines | `{ doc, title, contentHash, totalLines, window: { start, end }, text, nextFromLine \| null, prevFromLine \| null, headingPath, locator, status, verification, trust: "content" }`; warnings `DOCUMENT_CHANGED`, `STALE_CONTENT`, `CONTENT_FLAGGED`, `WINDOW_LIMITED` (the window was shortened to fit the budget). Not found or not readable: `DOCUMENT_NOT_FOUND` (one code for both) |
| `knowledge-find` | `{ space, doc, pattern, regex? (false), case_sensitive? (false), context_lines? (0 to 5, default 1), max_matches? (default 20, at most 100) }` | Matches in one document: `{ line, column, text, before[], after[] }` and their locators; a regex is compiled with `regex`'s size limit of 1 MiB and no backreferences (the crate has none); `QUERY_INVALID` otherwise |
| `knowledge-describe` | `{ space, doc }` | The document record (section 5.4) without `bytes`, plus `outline` (heading tree), `links` (resolved, broken, external), `backlinks` count, `chunks` count, index and graph applied revisions, and `codeIndexing` for code documents |
| `knowledge-list` | `{ space, collection?, prefix?, type?, after?, limit? (default 50, at most 500) }` | Readable documents: id, title, type, status, verification, updated; `nextAfter` |
| `knowledge-changes` | `{ space, after_rev, limit? (default 100, at most 1000) }` | Readable changes (section 3.1) with document ids and hashes, for event consumers that follow `changes` |
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
  `CommandDefinition::with_output_budget`: `knowledge-search` default
  24 000 bytes, maximum 96 000; `knowledge-open` 32 000 and 128 000;
  `knowledge-find`, `-describe`, `-list`, `-changes`, `-neighbors`,
  `-related`, `-path`, `-outline`, `-stale` 16 000 and 64 000. (Manifest
  version 2 adds the command key `output_budget = { default_bytes,
  max_bytes }`.)
- The handler reads the effective budget from the command context and
  **fits its result to it structurally**: fewer hits (then
  `RESULTS_LIMITED`), shorter snippets, a shorter window (then
  `WINDOW_LIMITED` with `nextFromLine`), fewer list entries (then a cursor).
  It never truncates JSON. AFD's own check (step 0) is the backstop.
- Callers ask for a smaller or larger budget per call through AFD's
  mechanism, up to the command's maximum.

### 8.7 Index maintenance and the pipeline

| Command | Effects | Input | Result |
| --- | --- | --- | --- |
| `knowledge-index` | `store-write` | `{ space, rebuild? (false), limit? (changes per call, default 10 000) }` | Applies the document store's changes after `min(index applied, graph applied)` through derivation reads: re-chunks and re-indexes changed documents, replaces their graph contributions, recomputes affected co-citations, then commits the index and the graph at the last applied revision. `rebuild` clears both first. Reports `fromRev`, `toRev`, documents indexed and removed, chunks, nodes, edges, broken links, and `remaining` when `limit` stopped it. Record `{ "kind": "index", "id": "<space>", "version": <applied> }` |
| `knowledge-refresh` (pipeline, D3) | `store-write` | `{ space }` | Steps: `sources-sync { space: $input.space }`, then `knowledge-index { space: $input.space }`. Composition at the call site: not registered when `sources-sync` is absent (phase 1 section 8.5) |

`knowledge-index` is idempotent and resumable: a crash between the index
commit and the graph commit leaves the graph behind, and the next run
starts from the smaller applied revision.

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
| `id` | `p-` and the first 20 hex of SHA-256 of `<space>\0<proposer principal string>\0<idempotencyKey>`; resubmitting the same key returns the existing proposal |
| `space`, `area` | The target's space; the area id that governs it (section 9.2) |
| `state` | `pending`, `approved` (decided, not yet applied), `applied`, `rejected`, `withdrawn` |
| `change` | `{ "op": "create" \| "update" \| "deprecate" \| "verify", "doc", "baseHash" (null only for create), "content"? (the whole new file, for create and update, at most `max_file_bytes`), "supersededBy"? (deprecate), "verification"? ({ note?, staleAfter? }, verify) }` |
| `diff` | A unified diff (3 lines of context) of the file before and after, computed at submission by `similar`; for `deprecate` and `verify`, the frontmatter change the apply step will write |
| `rationale` | Required, at most 4000 characters |
| `evidence` | 1 to 32 entries `{ "kind": "document" \| "url" \| "text" \| "record", "ref", "contentHash"?, "excerpt"? (at most 1000 characters) }`; a `document` entry must name a readable document and its current hash, checked at submission |
| `provenance` | Envelope version 1 of the submission |
| `policy` | `{ "area", "version": "sha256:<hex of the canonical JSON of the area's policy>", "rule": "person" }` |
| `exception` | `null`, or `"self-approval"` when the area allowed its proposer to approve |
| `proposer` | `{ "actor", "principal", "run"? }`: the AFD actor, the effective principal, and the caller's run id when given (`run` input, at most 128 characters) |
| `decision` | `null` until decided: `{ "by" (actor), "principal", "at", "reason"?, "traceId" }` |
| `result` | `null` until applied: `{ "rev", "contentHash", "path" }`, or `{ "error" }` when an apply failed |
| `flags` | The write scan's flags on the proposed content (section 11) |
| `createdAt`, `updatedAt` | From the command context's clock |

### 9.2 Areas and approval

Areas are the knowledge instance's configuration:

```toml
[plugins.knowledge.config.areas.handbook]
space = "main"
collection = "handbook"
prefix = ""                         # document id prefix inside the collection; "" is the whole collection
approvers = ["group:kb-owners"]     # access-token grammar (section 6); default [], meaning any human actor
allow_self_approval = false
```

The most specific area (longest `collection/prefix`) governs a document. A
proposal for a document no area covers is `PROPOSAL_NO_AREA`. Phase 2's only
rule is **`person`**: a human approves. Deterministic auto-approval rules
are phase 4's (section 13).

Commands:

| Command | Effects | Exposed | Approval and confirmation | Contract |
| --- | --- | --- | --- | --- |
| `knowledge-propose` | `store-write` | every surface | none | Validates (schema, sizes, `baseHash` equals the current hash, evidence readable, the proposer can read the target, or for `create` the collection), scans, computes the diff, stores `pending`. Record `{ kind: "proposal", id, version: rev }` |
| `knowledge-proposal-list` | `inspect` | every surface | none | `{ space, state?, area?, after?, limit? }`, proposals whose target the caller can read |
| `knowledge-proposal-show` | `inspect` | every surface | none | `{ space, proposal }`: the record, with `diff` and flags |
| `knowledge-withdraw` | `store-write` | every surface | none | The proposer withdraws a `pending` proposal |
| `knowledge-approve` | `store-write`, `workspace-write` | CLI only | AFD `approval = "required"` and `confirm_prompt` (the diff summary), with `require-human` | The caller must be a human actor matching the area's `approvers`; not the proposer's principal unless `allow_self_approval` (then `exception`); the target's current hash still equals `baseHash` (else `PROPOSAL_CONFLICT`, state unchanged). Steps: set `approved` with `decision`; write the file through `content_write` with the expected hash; `put_document` with origin `user-stated` when the proposer was a human, else `agent-inferred`, `confidence` from the proposal, `sources` the evidence's documents; re-index that one document; set `applied` with `result`. Re-running it on an `approved` proposal resumes and skips steps already done (file hash equals the target) |
| `knowledge-reject` | `store-write` | CLI only | `require-human` confirmation | A human approver rejects with a required `reason` (at most 2000 characters) the curator reads next run |

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
`approval = "required"`, `require-human`): `{ space, doc, note?,
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
writes a workspace with two spaces and 1000 documents, **entirely
synthetic**: words come from a pseudo-word generator (syllables from fixed
lists combined by a PCG32 stream implemented in the module, not the `rand`
crate, so the output never changes with a dependency), and no real product,
organization, person or system is named. The default seed is `20261101`.

| Space | Collection | Documents | Content |
| --- | --- | --- | --- |
| `alpha` | `handbook` | 400 | Concept, runbook, decision and glossary entries with frontmatter (OKF keys and Umbel's), 3 to 7 sections, 0 to 6 links, 1 to 4 of 40 tags, owners, `generated`; 30 % verified (half by `human:` actors, some of them owners), 10 % past `stale_after`, 5 % deprecated with `superseded_by`; 10 % with `access = ["group:restricted"]` |
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
generator changes the constant in the same pull request.

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
answer) and 1 (bridges and passing mentions). A deployer writes the same
shape by hand in `spaces/<space>/eval/queries.jsonl` with their own content.

### 10.3 Metrics and the report

`knowledge-eval` (CLI only, `inspect`): `{ space?, queries? (path in the
workspace; default each space's eval/queries.jsonl), k? (default 10),
expand? (both | on | off; default both), rebuild? (false) }`. It runs each
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
  `leaks = 0`, recorded as an eval report committed beside the instance's
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
  `src/plugins/mounted/scan.rs`, moved to `umbel-okf::scan` so both use one
  list), `hidden-text` (zero-width and bidirectional control characters,
  Unicode tag characters U+E0000 to U+E007F, HTML comments longer than 200
  characters). Ingestion **flags and does not block** deployer content
  (section 15); a flagged hit carries its flags and the `CONTENT_FLAGGED`
  warning; a proposal with flags shows them in `knowledge-proposal-show` and
  in approve's confirmation prompt.
- **Size caps.** Files `max_file_bytes` (default 1 MiB, at most 16 MiB);
  frontmatter 64 KiB; 2000 chunks per document; 100 000 files per
  collection; queries 1024 characters and 64 clauses; prefix expansion 256;
  regexes 1 MiB compiled; proposals' content `max_file_bytes`, rationale
  4000 characters, 32 evidence entries; results by output budget; records
  2 MiB.
- **No path leaks**: results carry document ids, never filesystem paths
  outside the collection; `url` is never set on sources.
- **Confinement**: collection roots inside the workspace (section 4.1);
  symbolic links inside roots not followed; `content_write` writes only to
  allowed collections, only to a path that resolves inside the root, only
  `.md` files for markdown collections, never `index.md` or `log.md`.
- **Prompt-injection surfaces**, each with its control: document bodies and
  frontmatter (labeled, scanned, flagged); document titles and descriptions
  in hits (labeled; the scan covers frontmatter values); proposal rationale
  and evidence excerpts (labeled, scanned, shown to the approving human);
  tool descriptions (fixed by the plugins, checked by `afd validate
  --surface` in CI); the eval set (CLI only).
- **Approvals**: CLI-only apply, human approvers, `require-human`
  confirmation, AFD approval tokens never over MCP (phase 0), area policy
  version recorded.
- **Audit**: every write is journaled with the actor and the person it
  acted for; each store change records its trace id, so the journal and the
  store cross-check (D66).

## 12. Exit criterion and tests

The exit criterion is met when `umbel.yml` is green on `main` with every
test below, and `tests/exit_thousand.rs` (in `plugins/knowledge`) passes in
it: it generates the fixture with seed `20261101`, opens a host with
`compiled:sources-filesystem` and `compiled:knowledge` enabled for both
spaces through the test kit, runs `knowledge-refresh` for `alpha` and
`beta`, and asserts:

1. **A thousand documents indexed across two spaces**: `store-show` reports
   600 documents in `alpha` and 400 in `beta`, and both indexes' applied
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
4. **Recall and ranking reported**: `knowledge-eval` writes a report that
   validates against `eval-report.v1.json` and meets the gate of section
   10.4; the report is uploaded as a CI artifact.

| Test file | Crate | Covers |
| --- | --- | --- |
| `packages/rust/tests/output_budget.rs` | `afd` (step 0b) | Every case of `spec/output-budgets.json` over stdio and Streamable HTTP in both eras and in process |
| `packages/rust/src/server/frontmatter.rs` (unit tests, made public) | `afd` (step 0b) | The public API keeps the existing rules |
| `tests/schemas.rs` (extended) | host | Every new schema and example; version 0 and 1 events side by side |
| `tests/config_v3.rs` | host | Collections, roots inside and outside, symlinked roots, readers, groups, reading versions 1 and 2 |
| `tests/manifest_v2.rs` | host | `store-write` and `workspace-write` with and without their grants; version 1 still loads; `output_budget` |
| `store/tests/suite_detects.rs` | `umbel-store` | The suite's own cases against a deliberately broken fake backend fail where they should (the suite detects leaks, gaps and lost writes) |
| `store-embedded/tests/conformance.rs` | `umbel-store-embedded` | `conformance::run_all` against the embedded backend |
| `store-embedded/tests/multiprocess.rs` | `umbel-store-embedded` | Two child processes (`spawn_writer`) writing documents and the index of one space concurrently: dense revisions, no lost write, readers see each commit whole; a writer past the lock timeout gets `Busy` |
| `tests/store_grants.rs` | host | Each grant granted, denied, withheld; write grants without `allow`, with entries outside the instance's spaces, and writes outside `allow`; components and mounts refused store grants; derivation reads refused without `store-write`; envelope refusals; `dev.umbel/changes` and event `changes` |
| `tests/access_filter.rs` | host | Reader filters from principals, `onBehalfOf`, groups with `*`, `SPACE_NOT_READABLE`; every store read path with the access fixture |
| `tests/store_commands.rs` | host | `store-show`, `store-check` (with a corrupted index), `store-backup` |
| `tests/doctor_stores.rs` | host | The four new doctor checks |
| `tests/process.rs` (extended) | host | A stdio server and one-shot CLI `sources-sync` and `knowledge-index` against one workspace at once (the `umbel-knowledge` binary) |
| `okf/tests/frontmatter.rs`, `okf/tests/structure.rs`, `okf/tests/scan.rs` | `umbel-okf` | Section 5.1's rules, slugs, link resolution, the scan patterns |
| `plugins/sources-filesystem/tests/sync.rs` | sources | Change detection, tombstones, skips and their warnings, caps, conflicts, `dry_run` |
| `plugins/sources-filesystem/tests/access_mirror.rs` | sources | Section 5.3's precedence |
| `plugins/knowledge/tests/chunking.rs` | knowledge | Every rule of section 7.2 on committed fixtures with expected chunk boundaries |
| `plugins/knowledge/tests/query_syntax.rs` | knowledge | Every form of section 8.1, the limits, `access` refused |
| `plugins/knowledge/tests/search.rs` | knowledge | Aggregation, expansion, status, order and ties, snippets, sources, warnings, formats, `verified_only` |
| `plugins/knowledge/tests/open_find.rs` | knowledge | Windows, locators, `DOCUMENT_CHANGED`, find limits |
| `plugins/knowledge/tests/graph.rs` | knowledge | Every node and edge kind, co-citation, the graph commands, endpoint filtering, no cross-space edge |
| `plugins/knowledge/tests/code_symbols.rs` | knowledge (`code`) | Each language's query file on committed fixtures; degraded parse |
| `plugins/knowledge/tests/spaces.rs` | knowledge | Multi-space validation, fusion, labels, no write-back |
| `plugins/knowledge/tests/budgets.rs` | knowledge | Each command fits its budget structurally; `RESULTS_LIMITED`, `WINDOW_LIMITED` |
| `plugins/knowledge/tests/proposals.rs` | knowledge | Every op, idempotency, conflicts, areas, approvers, self-approval, resume after a crash between steps, CLI-only exposure, events |
| `plugins/knowledge/tests/verification.rs` | knowledge | Tiers, stale, `knowledge-verify`, deprecate, frontmatter-only rewrites |
| `plugins/knowledge/tests/security.rs` | knowledge | Trust labels, no content in messages, flags, confinement, caps |
| `plugins/knowledge/tests/eval_fixture.rs` | knowledge | The generator's pinned digest; the query set validates; metrics on a hand-computed three-query case |
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
| Profile `org`: incremental jobs as MCP Tasks, a vector lane when its eval passes, partitioned term statistics per access set, larger caps, shared backends | `org` work after phases 5 and 6 | `profile` enum; `knowledge-index`'s `limit` and `remaining` (resumable batches) |
| Verified identity for reader filters, delegation narrowing | Phase 5 | Section 6's effective principal; reserved principal `spaces` and `delegationChain` |
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
  process on the call context. The effective budget is
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
`tests/output_budget.rs` over the vectors; and the frontmatter reader made
public as `afd::frontmatter::{parse, FrontmatterError}` behind a new
`frontmatter` feature (enabled by `server`), so `umbel-okf` can depend on
`afd` without the server. CHANGELOG and parity rows.

### Umbel steps

| Step | Pull request | Contents | Tests | Size |
| --- | --- | --- | --- | --- |
| 0a | AFD: output budgets (spec) | Above | None (documents) | M |
| 0b | AFD: Rust output budgets and public frontmatter | Above | `output_budget.rs`, frontmatter units | M |
| 1 | Shapes and configuration | The schemas of section 2 with examples; configuration version 3 (`collections`, `readers`, `[access]`, `[store]`), `init` writes 3; the doctor's `collections.roots`; manifest version 2 parsing (effects, `output_budget` key accepted and stored); version constants; `store` as a host domain; event version 1 projection with envelope version 1 (the `plugin` field filled by the gate) | `schemas.rs`, `config_v3.rs`, `manifest_v2.rs` (parsing cases) | M |
| 2 | Store traits and the SQLite stores | `umbel-store` (types, the three traits, the conformance suite with its access fixture and `spawn_writer`); `umbel-store-embedded` with SQLite documents, records, changes and graph (index methods `unimplemented` behind a not-yet-built marker the suite skips) | `memoryless_suite.rs`, `conformance.rs` (non-index groups), `multiprocess.rs` (documents) | L, heavy: SQLite C build |
| 3 | The tantivy index | The embedded `SearchIndex` (schema, tokenizers, query parser wrapper, reader clause, payload, writer wait, reload), the petgraph cache, the index groups of the suite | `conformance.rs` (all), `multiprocess.rs` (index) | L, heavy: tantivy |
| 4 | Host services | The ten grants, allow lists and `ALLOW_REQUIRED`, reader filters and `SPACE_NOT_READABLE`, derivation reads, provenance enforcement, `dev.umbel/changes`, the SDK's methods, the `store-embedded` feature, `store-show`, `store-check`, `store-backup`, the doctor's store checks, the output-budget key wired to `with_output_budget` | `store_grants.rs`, `access_filter.rs`, `store_commands.rs`, `doctor_stores.rs`, `manifest_v2.rs` (rest) | L |
| 5 | `umbel-okf` and `sources-filesystem` | Frontmatter, structure, link resolution, the scan (moved from `mounted/scan.rs`, which re-exports it); the plugin, its packs and skill, `sources-sync`, `sources-status` | `okf/tests/*`, `sync.rs`, `access_mirror.rs` | M |
| 6 | Knowledge core | The knowledge crate without `code`: chunking, `knowledge-index` (index only; graph calls behind step 7), search without expansion, open, find, describe, list, changes, budgets, multi-space, warnings, trust labels, first-class suggestions, the pipeline, the `umbel-knowledge` binary, the plugin's skill | `chunking.rs`, `query_syntax.rs`, `search.rs`, `open_find.rs`, `spaces.rs`, `budgets.rs`, `security.rs` (read side), `process.rs` (extended) | L |
| 7a | Structural graph | Graph building in `knowledge-index`, co-citation, expansion in search, `neighbors`, `related`, `path`, `outline`, `stale` | `graph.rs`, the expansion cases of `search.rs` | M |
| 7b | Code symbols | The `code` feature, tree-sitter and three grammars, query files, symbol chunking, `defines` and `mentions` | `code_symbols.rs` | M, heavy: tree-sitter grammars' C build |
| 8 | Proposals and verification | The proposal record, areas, propose, list, show, withdraw, approve (CLI, approval, `require-human`), reject, verify, deprecate, frontmatter-only rewrites, the write scan on proposals | `proposals.rs`, `verification.rs`, `security.rs` (write side) | L |
| 9 | Eval harness | The fixture generator and its digest, the query set, `knowledge-eval`, the report, the gate, `eval/baseline.json`, the CI artifact upload | `eval_fixture.rs` | M |
| 10 | Exit | `exit_thousand.rs`; STATUS.md marks phase 2 done with the run's evidence | `exit_thousand.rs` | S |

**Order and parallelism.** 0a, then 0b. Step 1 needs nothing from AFD and
may run beside 0a. Step 2 needs 1. Steps 3 and 4 need 2 and may run in
parallel. Step 5 needs 4. Step 6 needs 0b, 3, 4 and 5. Steps 7a and 8 need
6 and may run in parallel; 7b needs 7a. Step 9 needs 7a. Step 10 needs all.

**Build and disk cost.** This machine's disk is limited, and phase 1's
component step showed a shared target directory reaching 14 GB with
wasmtime. Therefore: the plugin crates and the store crates depend on
`umbel` with `default-features = false` (no wasmtime) wherever they need the
host, as `umbel-todo` does, and run their tests with `-p <crate>`; each
heavy native set (SQLite in 2, tantivy in 3, tree-sitter in 7b) arrives in
its own step; **never build steps 2, 3 and 7b at the same time**, and when
3 and 4 run in parallel, 4 tests against the SQLite stores only until 3
merges; share one `CARGO_TARGET_DIR` and remove it between unrelated
sessions; run the full `--workspace` test only in the step's final check.

## 15. For the owner

Decisions this specification makes that change the trust model, or that
the architecture leaves to the owner. Each has a recommendation already
written into the specification; approving the specification accepts them
unless the owner says otherwise.

1. **Derivation reads (D54, trust model).** A plugin holding `index_write`
   or `graph_write` for a space reads every document of that space,
   whatever its caller may read, inside a `store-write` command, so an
   index reflects all content. Compiled plugins are already trusted (owner
   decision 1), so this adds no new privilege in phase 2, but it is the
   first grant that bypasses the caller's filter by design. The same item covers
   `as_reader` (section 3.3, rule 5), which lets the CLI-only `knowledge-eval`,
   called by a human, read as the query set's principals. Recommendation:
   accept, compiled-only; revisit for components at world 1.1.0.
2. **Access before authentication (D53, trust model).** Reader filters,
   `readers` per space and `[access.groups]` are configuration evaluated
   against phase 0's unverified principals. On stdio and loopback HTTP every
   caller is one principal, so filtering protects against nothing a local
   process could not read from the files; it is exact only for embedders
   and tests until phase 5. Recommendation: accept, and say so in the
   README and in `workspace-show`.
3. **Ingestion flags, never blocks (D67, trust model).**
   Content in a deployer's roots that matches the injection scan is indexed
   and labeled, not refused. Recommendation: accept; add a per-collection
   `scan.block = true` later if a deployer asks.
4. **The journal stays fail-open (D66, audit).** Phase 0's follow-up asked
   whether audited mutations need a fail-closed journal before phase 2
   writes records. Recommendation: no fail-closed mode in phase 2 (it would
   need a write-ahead journal in AFD); instead every store change records
   its trace id, and `store-check` reports changes with no journal entry.
   An approval whose journal entry is lost is still in the store with its
   decision trace.
5. **Proposal record moves into phase 2 (D62, architecture).** The
   architecture's phase 4 row lists the proposal record; the knowledge
   plugin owns the commands (architecture section 4), and the coordinator's brief
   for this phase asks for them here. Phase 4 keeps the curator, auto-approval
   rules and settling defaults. Recommendation: accept the amended rows.
6. **Approve and reject are CLI-only until the MCP approval relay (D62).**
   Recommendation: accept; phase 4's relay lifts it.
7. **Self-approval and verification (D62, D63).** A human may not approve
   their own proposal unless the area allows it, recorded as an exception; a
   human approver's own verification applies at once without that
   exception. Recommendation: accept.
8. **Which binary ships the knowledge plugins (D57, left to the owner by
   D48).** The stock `umbel` binary stays empty; `umbel-knowledge`, built
   from the knowledge crate, is `umbel` plus `sources-filesystem` and
   `knowledge`. Phase 7 decides which artifacts are distributed.
   Recommendation: accept for phase 2; decide the shipped set in phase 7.
9. **BM25 statistics span hidden documents (D53).** Scores may shift
   slightly with content the caller cannot see; no content, id or count
   leaks. Recommendation: accept for `team`; partitioned statistics for
   `org`.

## Follow-ups

| Date | Follow-up | Owner |
| --- | --- | --- |
| 2026-11-01 | Store grants for components: WIT world `umbel:plugin/plugin@1.1.0` with `documents`, `index`, `graph`, `records` and `content` imports | The first phase that needs a component reading stores |
| 2026-11-01 | Output budgets in TypeScript, Python and C++ after step 0b | AFD |
| 2026-11-01 | Documents as MCP resources once a permission-filtered listing exists (`kb://`) | After phase 5 |
| 2026-11-01 | Restore from `store-backup` | Phase 6 |
| 2026-11-01 | Partitioned BM25 statistics per access set | `org` profile work |
| 2026-11-01 | A per-collection option to block, not only flag, content the write scan matches | When a deployer asks |
| 2026-11-01 | Watching collection roots instead of explicit `knowledge-refresh` | Later |
