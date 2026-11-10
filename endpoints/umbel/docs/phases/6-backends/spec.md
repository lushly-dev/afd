# Phase 6 specification: backends

| Field | Value |
| --- | --- |
| Phase | 6, backends ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | Repository owner approves; the phase 6 owning agent writes and implements |
| Read first | [STATUS.md](../../STATUS.md), then the [architecture](../../architecture.md), the [decision log](../../decisions.md), the [phase 2 specification](../2-knowledge/spec.md) (the store traits, section 3; access, section 6), the [phase 3 specification](../3-memory-context/spec.md) (the memory store and forget, sections 5 and 7) and the [phase 5 specification](../5-auth-hosted/spec.md) (exact filtering, section 9; shared state, section 10.2; its step 7 amendments) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request, as the earlier phases' steps did |

## Status

- **State:** **draft, written 2026-11-09, in review; not approved.** It needs an independent review, a revision and
  the owner's answers to section [12](#12-for-the-owner) before implementation (D24).
  - It proposes decisions [D131 to D148](../../decisions.md). Four of them wait on the owner's answers to the
    questions of section 12: D131 (question 1), D138's recovery window (question 4), D145 (question 2) and D146
    (question 3). The others are settled here as technical or security-strength choices, taking the strongest
    option, and are decided with the approval under the owner's 2026-10-31 delegation.
  - Phase 5 is not done: its steps 6 and 8 to 12 are in progress on other branches. Steps 1 to 8 of this plan need
    nothing phase 5 has not merged. Step 9 (host state on PostgreSQL) needs phase 5's task and usage stores (its
    steps 8 and 9), and step 11 (the exit) needs phase 5's exit (section [11](#11-implementation-plan)).
- **Last verified:** 2026-11-09 against `main` at `8258e0fc`.
  - Read in the code: `store/src/traits.rs`, `store/src/memory.rs`, `store/src/lib.rs`, the conformance suite
    (`store/src/conformance/`: its groups, `Stores`, `Report`, skipping), `store-embedded/src/` (connection pragmas,
    `secure_delete`, the index's statistics provider, memory ranking and keys), `src/store/mod.rs` (the concrete
    embedded types the `store-*` built-ins need), `src/shared/` (the `NonceStore`, `LimitStore` and `PersonStore`
    traits), `src/events/` (the projecting journal sink), `src/workspace/layout.rs` and
    `schemas/workspace-config.v5.json` (the reserved `backend` key); AFD's `JournalSink` (`packages/rust/src/journal.rs`).
  - Read in the documents: the architecture's phase 6 row, components, versioning and glossary; the proposal's
    pluggable backends and scale profiles; D10, D26, D28, D29, D51 to D55, D66, D70 to D73, D81 to D83, D89 and D123
    to D130; the phase 5 specification's sections 9, 10.2, 12, 13, 15 and its follow-ups; STATUS.md's follow-ups.
  - External facts are dated in the [trajectory refresh](#trajectory-refresh). Library facts come from `cargo info`
    and the crates' published sources (tantivy 0.27.0's `Directory`, `tokio-postgres` 0.7.18's `ChannelBinding`,
    `tokio-postgres-rustls` 0.14.0's `tls-server-end-point`). No Rust was built or run.
- **Done:** nothing; this is the specification.
- **Not done:** the review, the revision, the owner's answers, and every step of section 11.
- **Follow-ups:** the [table at the end](#follow-ups).

## What this phase serves

The phase 6 row of the architecture:

> Store traits finalized, conformance suite, embedded reference backend certified, a second backend selectable per
> space.

Its exit criterion: *the second backend passes the suite; a workspace moves one space to it by configuration while
another stays embedded.*

The row asks this specification to settle three things:

| Item | Where |
| --- | --- |
| Trait boundaries | 3 |
| Suite contents | 3.3, 3.4 |
| Migration between backends | 6 |

It also takes up what earlier phases deferred to it:

| Deferred item | From | Where here |
| --- | --- | --- |
| Several machines behind one URL | Phase 5 section 15, D126 ("traits for phase 6") | 5 (owner question 2) |
| Restore from `store-backup` | Phase 2 specification, STATUS follow-up | 6.2 |
| The shared-state traits in `src/shared/` | Phase 5 section 10.2 | 3.1, 5 |
| A second backend that proves itself against the suite | D10, D51 | 3.4, 4 |
| "Shared backend, permission filters in the index" at the enterprise profile | Proposal, scale profiles | 4, 5 |
| The suite's "phase 6's second backend runs the same function" | `store/src/conformance/mod.rs` | 3.3 |
| `spaces.<id>.backend`, reserved | D52, configuration versions 3 to 5 | 2.1 |
| The manifest's reserved `backends` key | D37 | 1 (D132) |

| Principle | How phase 6 serves it |
| --- | --- |
| 1. Empty host | Backends are storage only; they hold no domain logic. Because a backend sees every space's content and keys, it is part of the host's trusted base, not a plugin (D132) |
| 5. Content lives in the workspace | The backend choice is the deployer's, per space, in `umbel.toml`; the binary ships the embedded default |
| 7. Provenance on everything | Every backend stores the envelope whole; archives and moves carry it byte for byte (6) |
| 9. Stored content is untrusted input | Unchanged; the database is also treated as untrusted for confidentiality and for widening access (4.6) |
| 10. Permission-aware | The reader filter stays inside every query, and every exactness guarantee of phase 5 becomes a conformance obligation every backend proves (3.2) |
| 11. Stateless and horizontal | With owner question 2, several machines share one deployment's state through PostgreSQL (5) |
| 13. Same interface at every scale | Moving a space changes no command, result shape, ranking or position (3.4, 6.3) |
| 14. Every mutation is an event | The journal and its events are appended in one transaction on the shared state backend (5.3) |
| 15. AFD first | Checked: nothing here is a generic AFD server feature. Umbel implements AFD's existing `JournalSink`; no AFD step is needed (5.3) |
| 16. Spaces do not mix | Each space has its own PostgreSQL schema, keys and epochs; a move moves one space (4.3, 6.3) |

Decisions served: D10, D26, D28, D29, D36, D51, D53, D54, D55, D66, D70, D71, D72, D73, D82, D83, D89, D103, D120,
D123, D125, D126, D127 and D128, and the new D131 to D148. O1 and O4 are untouched.

## Trajectory refresh

Refreshed 2026-11-09 against primary sources. **Nothing found changes the architecture.** Two findings set dates in
the design: PostgreSQL 14 reaches its end of life on 2026-11-12, and PostgreSQL 19 is planned for 2026-11-19.

| Row | Checked against | Finding on 2026-11-09 | Effect on phase 6 |
| --- | --- | --- | --- |
| PostgreSQL releases (new W19) | [Versioning policy](https://www.postgresql.org/support/versioning/); [PostgreSQL 19 RC 1](https://www.postgresql.org/about/news/postgresql-19-rc-1-released-3409/) | Supported: 18 (18.6; end of life 2030-11-14), 17 (17.11; 2029-11-08), 16 (16.15; 2028-11-09), 15 (15.19; 2027-11-11), 14 (14.24; 2026-11-12). 19 RC 1 on 2026-10-15; general availability planned 2026-11-19 | Supported servers are 16, 17 and 18, and 19 once released and green in CI (4.1). The doctor fails a major past its end of life (D135) |
| Sequences | [Sequence functions, PostgreSQL 18](https://www.postgresql.org/docs/18/functions-sequence.html) | `nextval` is never rolled back; "sequence objects cannot be used to obtain 'gapless' sequences". The page says nothing about commit order | Revisions and event sequence numbers come from a locked head row, never a sequence (4.4) |
| Row security | [Row security policies, PostgreSQL 18](https://www.postgresql.org/docs/18/ddl-rowsecurity.html) | Superusers and `BYPASSRLS` roles "always bypass" it; table owners do unless the table has `FORCE ROW LEVEL SECURITY`; only the owner may change policies | The runtime role is neither superuser, `BYPASSRLS` nor owner, and every content table forces row security (4.5) |
| Cluster identity | [System information functions, PostgreSQL 18](https://www.postgresql.org/docs/18/functions-info.html) | `pg_control_system()` returns `system_identifier`, cluster-wide. The page states no default privilege | The keyring's separation is proven with it, under the admin role, and fails closed when it cannot be read (4.7) |
| Connections | [libpq connection parameters, PostgreSQL 18](https://www.postgresql.org/docs/18/libpq-connect.html); `tokio-postgres` 0.7.18 (`cargo info`, MSRV 1.85, MIT or Apache-2.0) source, `src/config.rs`; `tokio-postgres-rustls` 0.14.0 source, `src/lib.rs` | libpq: `verify-full` checks the certificate's issuer and that the host name matches; channel binding "is only supported over SSL connections with PostgreSQL 11 or later servers using the SCRAM authentication method", and `require` refuses a connection without it. `tokio-postgres` takes `channel_binding` (`disable`, `prefer`, `require`); `tokio-postgres-rustls` 0.14.0 supplies `tls-server-end-point` from the server certificate, with an `aws_lc_rs` feature. `deadpool-postgres` 0.14.2 (MSRV 1.85) and `postgres-types` 0.2.14 | 4.2 |
| tantivy | 0.27.0 source, `src/directory/directory.rs` | `Directory` is a public trait: `get_file_handle`, `delete`, `exists`, `open_write`, `atomic_read`, `atomic_write`, `sync_directory`, `acquire_lock` and `watch`; only `watch` serves reloading on commit | The index on PostgreSQL is the same tantivy code over a new `Directory` (4.8) |
| W1, W2, W5, W7 | Not re-checked | Phase 5's refresh of 2026-11-03 stands; no row bears on storage | None |

Rows W3, W4, W6 and W8 to W18 were not re-checked.

## Terms

These enter the [glossary](../../architecture.md#12-glossary).

| Term | Meaning |
| --- | --- |
| Backend kind | The implementation behind the store traits: `embedded` or `postgres`. A host build feature, never a plugin (D132) |
| Backend instance | One `[backends.<id>]` entry of `umbel.toml`: a kind and its connection settings. Spaces name it in `spaces.<id>.backend` |
| Certification | A passing run of the whole conformance suite, with no failure and no skip, against one backend kind, recorded with what it was run against (3.4, 4.11) |
| Sealed column | A database column holding ciphertext that only the host can open; the database never sees the plaintext (4.6) |
| Data key | The random key that seals one stored row version, kept wrapped beside it (4.6) |
| Epoch | A period, one day by default, during which one space key wraps a space's data keys and blinds its lookup values (4.7) |
| Recovery window | How long a retired epoch's key is kept before it is destroyed (owner question 4) |
| Erasure horizon | How long anything deleted or forgotten in a PostgreSQL space stays recoverable from any copy: one epoch plus the recovery window, plus how long the deployer keeps keyring backups (4.7) |
| Keyring | The store of epoch keys and host keys, kept apart from the content database (4.7) |
| Root key | The deployer's 32-byte secret that wraps every keyring entry held in PostgreSQL; a host secret, never stored by Umbel |
| Space archive | The portable, backend-neutral copy of one space that `store-backup` writes and `store-restore` and `store-move` read (6.1) |
| Move | Copying a space from one backend instance to another, verifying it, switching by configuration and retiring the source (6.3) |
| Retired store | A space's former store after a move: its memory keys destroyed and its data deleted, leaving only a marker (6.3) |
| Deployment mode | `deployment.instances`: `single` (one machine, today's) or `shared` (several machines behind one URL) (5) |
| State backend | The backend instance holding a shared deployment's host state: the journal, events, cursors, shared stores and usage (5.2) |
| Store-held collection | A collection whose documents live in the document store as their source, imported from and exported to files only at the CLI (5.8) |

## 1. Crate layout

```text
endpoints/umbel/
├── store/src/                    # umbel-store: store traits version 3
│   ├── admin.rs                  # StoreAdmin: show, check, digest, freeze, export, import, retire
│   ├── backend.rs                # Backend, BackendDescriptor
│   ├── archive.rs                # space archive version 1 items, the archive and content digests
│   ├── state/                    # host-state traits: events, cursors, nonces, limits, person, tasks, usage, keys
│   └── conformance/              # + exactness, memory_exactness, admin, archive, instances, crash, state_* groups
├── store-lexical/                # umbel-store-lexical (new): the tantivy index of phase 2 and phase 5 step 7,
│                                 #   moved from store-embedded and made generic over tantivy's Directory
├── store-embedded/src/           # implements version 3 and the state traits (moved from src/shared/); certified
├── store-postgres/               # umbel-store-postgres (new)
│   └── src/
│       ├── connect.rs            # TLS, SCRAM with channel binding, the two roles, the pool, session settings
│       ├── migrate.rs            # the versioned database schema; the admin role only
│       ├── seal.rs               # sealed columns, data keys, blind values, padding
│       ├── keyring.rs            # epochs, rotation, the keyring client (files or PostgreSQL)
│       ├── documents.rs, graph.rs, admin.rs
│       ├── index/                # PgDirectory, the local cache
│       ├── memory/               # memory records, blinded postings, BM25 per reader filter
│       └── state/                # host state for shared deployments
├── testkit-pg/                   # umbel-testkit-pg (new): throwaway PostgreSQL clusters for tests
├── src/backends/                 # configuration version 6, opening per space, certification records, doctor
├── src/archive/                  # store-backup (archive), store-restore
├── src/moves/                    # store-move, store-move-abort, the retire step
├── src/shared/                   # selects the files and SQLite stores or the PostgreSQL ones (5)
├── plugins/sources-filesystem/   # store-held collections: sources-import, sources-export
├── plugins/knowledge/            # applying a proposal to a store-held collection
└── schemas/                      # + the shapes of section 2
```

| Crate | Depends on | New third-party dependencies | Notes |
| --- | --- | --- | --- |
| `umbel-store` | as before | none | Traits version 3, the suite version 3 and the state traits. Still builds for `wasm32-wasip2` without the `conformance` feature |
| `umbel-store-lexical` | `umbel-store`, tantivy 0.27 (moved) | none | The index code of `store-embedded/src/index/`, unchanged in behaviour, generic over `Directory` (D139) |
| `umbel-store-embedded` | + `umbel-store-lexical` | none | Implements version 3; the SQLite stores of `src/shared/` move here |
| `umbel-store-postgres` | `umbel-store`, `umbel-store-lexical` | `tokio-postgres` 0.7.18, `tokio-postgres-rustls` 0.14.0 (feature `aws_lc_rs`), `deadpool-postgres` 0.14.2; `chacha20poly1305` and `hmac` already in the lock | Behind the host's new `store-postgres` feature, off by default until phase 7 decides the distributed binaries |
| `umbel-testkit-pg` | `rcgen` (dev, in the lock) | none | Test-only, `publish = false`, quarantined with no route; runs the system's `initdb` and `postgres`, never downloads a server (D147) |
| `umbel` (host) | + the two store crates by feature | none | Sections 5 to 7 |

**Backends are not plugins (D132).** Principle 2 lists backends among a plugin's contributions, and D37 reserved the
manifest's `backends` key. A backend holds every document, record, memory record and key of the spaces it serves, and
the host's own state in a shared deployment; no grant or instance allow list could bound what it sees, so it is part
of the trusted base, like the host itself. A backend is therefore a host build feature (`store-embedded`,
`store-postgres`), chosen per space by configuration. The manifest's `backends` key stays reserved, and a plugin
declaring it is refused as today.

## 2. Versioned shapes

Every new shape is a closed JSON Schema 2020-12 file with examples (D36). Nested shapes take a new version with their
parent.

| Shape | File | Was | Section |
| --- | --- | --- | --- |
| Workspace configuration version 6 | `workspace-config.v6.json` | 5 (D107) | 2.1 |
| Space archive version 1: the manifest and its item lines | `space-archive.v1.json`, `archive-item.v1.json` | new | 2.2, 6.1 |
| Move record version 1 | `store-move.v1.json` | new | 2.3, 6.3 |
| Certification report version 1 | `certification.v1.json` | new | 2.4, 3.4 |
| Store traits version 3 | `STORE_TRAITS_VERSION = 3` (code) | 2 (D70) | 3 |
| PostgreSQL schema version 1 | `umbel_meta.schema_version` (database) | new | 4.10 |

`workspace-show`'s `versions` gains `config: [1, …, 6]`, `store: 3`, `archive: 1`, `move: 1` and
`certification: 1`. The plugin protocol stays **1**, the manifest stays at version 5 and WIT world 1.0.0 is unchanged.
No record, envelope, event, cursor or locator shape changes: a moved space answers with the same bytes (6.3).

### 2.1 Workspace configuration, version 6 (D142)

```toml
version = 6

[backends.main]                       # a backend instance; "embedded" is built in and needs no entry
kind = "postgres"
host = "db.internal.example"          # or socket = "/run/postgresql" (a Unix socket directory)
port = 5432
database = "umbel"
user = "umbel_runtime"
password_file = "/run/secrets/umbel-runtime"   # or password_env; never a literal (phase 5 section 10.4)
admin_user = "umbel_admin"
admin_password_file = "/run/secrets/umbel-admin"
ca_file = "certs/db-ca.pem"           # optional: only these roots, never the platform's, for this instance
pool_size = 16
statement_timeout_ms = 15000

[backends.main.epochs]
rotate_hours = 24                     # 1 to 168
recovery_days = 30                    # owner question 4; 1 to 90

[keyring]
kind = "postgres"                     # or "files" (state/keys/keyring/), allowed only when instances = "single"
host = "keys.internal.example"
port = 5432
database = "umbel_keys"
user = "umbel_keys_runtime"
password_file = "/run/secrets/umbel-keys"
admin_user = "umbel_keys_admin"
admin_password_file = "/run/secrets/umbel-keys-admin"
root_key_file = "/run/secrets/umbel-root.key"  # or root_key_env; 32 bytes, base64url

[deployment]
instances = "shared"                  # "single" (default) or "shared"
state = "main"                        # the state backend; required when shared, a postgres instance

[spaces.alpha]
backend = "main"                      # default "embedded"

[spaces.alpha.collections.guides]
root = "content/guides"
kind = "markdown"
source = "store"                      # "files" (default) or "store"; "store" is required when shared
```

Rules, each refused at load with `CONFIG_INVALID` naming the key:
- A backend id matches the space id grammar; `embedded` is reserved and always present.
- `kind` is `postgres`; exactly one of `host` and `socket`; `port` 1 to 65535.
- Every secret is `*_file` or `*_env`, under phase 5 section 10.4's rules; a literal `password` key does not exist.
- `ca_file` follows phase 5's file-path rules (inside the workspace or absolute, readable, PEM).
- `pool_size` 1 to 256; `statement_timeout_ms` 1 000 to 600 000.
- `rotate_hours` 1 to 168; `recovery_days` 1 to 90.
- `[keyring]` is required when any space or the state names a `postgres` instance. `kind = "files"` is refused when
  `instances = "shared"`. A `postgres` keyring needs `root_key_file` or `root_key_env`.
- `instances = "shared"` needs `state`, naming a `postgres` instance; every space's `backend` naming a `postgres`
  instance (D145); every collection `source = "store"` (D146); and `auth.mode` `oauth` or `gateway`, since the HTTP
  token of mode `none` is a single machine's loopback secret.
- `spaces.<id>.backend` names a declared instance or `embedded`.
- `source = "store"` is admitted for `markdown` and `code` collections; `root` stays required, as the default folder
  for `sources-import` and `sources-export` (5.8).

Versions 1 to 5 read as 6 with every space `embedded`, no backends, no keyring, `instances = "single"` and every
collection `source = "files"`. `umbel init` writes version 6.

### 2.2 Space archive, version 1 (D143)

A directory: `manifest.json` (`space-archive.v1.json`) and one JSON Lines file per kind of item
(`archive-item.v1.json`, one schema with a `kind` discriminator).

```json
{ "version": 1, "space": "alpha", "createdAt": "2026-11-09T10:00:00.000Z",
  "source": { "kind": "embedded", "storeTraits": 3, "storeId": "…" },
  "heads": { "documents": 4120, "memory": 812 },
  "files": [ { "name": "documents.jsonl", "items": 1180, "sha256": "…" }, … ],
  "digest": "sha256:…", "keys": "excluded" }
```

| File | Items |
| --- | --- |
| `documents.jsonl` | Each stored document at its current revision: id, bytes (base64url), metadata, envelope, access, sensitivity, flags |
| `records.jsonl` | Each plugin record: namespace, kind, id, body, envelope, version |
| `changes.jsonl` | Every change, in revision order, with its revision, kind, target, hash (or none where forgotten), trace id and time |
| `graph.jsonl` | Each origin document's contribution and the applied revision |
| `memory.jsonl` | Each memory record version with its metadata and its **sealed** text fields as stored, in D82's construction under the record's own key, with the associated-data version each was sealed under (4.9); tombstones; destroyed markers; capture prefixes erased |
| `memory-changes.jsonl` | Every memory change in revision order |

The index is never archived: it is derived, and rebuilt from the documents on restore. `keys` is always `"excluded"`
in a backup (D82): a backup's memory opens only with the key material the deployer keeps apart. A move carries keys
on a separate channel (6.3) and never writes them into an archive. `digest` is section 6.1's archive digest.

### 2.3 Move record, version 1 (D144)

Stored in the target's metadata and, after the switch, as `state/spaces/<space>/moved.json` where the source was.

```json
{ "version": 1, "id": "mv-…", "space": "alpha",
  "from": { "backend": "embedded", "storeId": "…" }, "to": { "backend": "main", "storeId": "…" },
  "digest": "sha256:…", "heads": { "documents": 4120, "memory": 812 },
  "state": "verified", "copiedAt": "…", "switchedAt": null, "retiredAt": null }
```

`state` is `copying`, `verified`, `switched`, `retired` or `aborted`.

### 2.4 Certification report, version 1 (D134, D141)

```json
{ "version": 1, "backend": { "kind": "postgres", "crate": "umbel-store-postgres", "crateVersion": "0.1.0",
    "schema": 1 },
  "server": { "product": "PostgreSQL", "major": 18, "version": "18.6", "systemIdentifier": "…" },
  "suite": { "storeTraits": 3, "suiteVersion": 3, "groups": 31, "cases": 412 },
  "outcome": "passed", "failures": [], "skipped": [], "at": "2026-11-09T10:00:00.000Z" }
```

`outcome` is `passed` only when `failures` and `skipped` are both empty.

## 3. Store traits, version 3 (D133, D134)

### 3.1 The boundary

**What does not change.** `DocumentStore`, `SearchIndex`, `IndexWriterSession`, `GraphStore` and `MemoryStore` keep
every method, signature and meaning of version 2 as phase 5 step 7 left them. In particular these stay as they are:
the reader filter applied inside each query before ordering and limits; derivation reads only inside a store write;
`last_readable_document`; recall's BM25 per reader filter and its 50 000-match refusal; the memory query syntax parsed
in `umbel-store`. The traits stay **synchronous**, per space, `Send + Sync` and object-safe, and are always called
from a blocking thread (D51). A backend whose client is asynchronous runs it on the host's runtime and blocks the
calling thread; a call from a runtime worker thread is refused as `Invalid`, so it can never stall the runtime.

**What version 3 adds:**

| Item | Purpose |
| --- | --- |
| `Backend` | Opens a space's stores (`open_space`, `provision_space`), describes itself (`descriptor`: kind, crate version, schema version, server product and major), and lists the spaces it holds. The host holds one per backend instance |
| `StoreAdmin` (per space) | Backend-neutral maintenance, replacing the host's reach into the embedded types (`src/store/mod.rs`): `show` (operator statistics), `check` (integrity: every seal opens, revisions are dense and ordered, the change log matches the documents, applied revisions are not past the head), `digest` (the archive and content digests, 6.1), `freeze` and `thaw` (6.3), `export` and `import` (streams of archive items; import only into an empty space), `retire` (6.3) |
| `umbel_store::state` | The host-state traits that were `pub(crate)` in `src/shared/` and `src/events/`: `EventLog` (journal and event appends in one unit, reads, heads), `CursorStore`, `NonceStore`, `LimitStore`, `PersonStore`, `TaskStore`, `UsageStore` and `KeyStore`. Each keeps phase 5's semantics; the embedded implementations move to `umbel-store-embedded`, unchanged in behaviour (5.2) |
| `StoreError` variants | `Unavailable { retryable }` (a lost connection; the request fails closed), `Frozen` (`SPACE_MOVING`), `Retired` (`SPACE_MOVED`), `SchemaMismatch { found, supported }` |
| `KeyStatus` | Gains an `epochs` form (the current epoch, the oldest kept, and whether rotation is overdue) beside the key file's |

**What version 3 retires.** `MemoryStore::backup` writes an embedded-shaped copy; it stays for the embedded backend's
old backups, but the suite no longer calls it and the host no longer uses it: backups go through `StoreAdmin::export`
(6.2). The suite's `memory_restore` hook becomes `StoreAdmin::import`.

### 3.2 Exactness is part of the contract

Phase 5 step 7 made filtering exact in the embedded backend and proved it there (`partitioned_stats.rs`,
`exact_filtering.rs`). Version 3 makes each property an obligation of **every** backend, stated on the trait and
proven by the suite (3.3):
- statistics (`doc_freq`, document count, token totals) over readable, live chunks only, from exact token counts;
- ties broken by a total key (score at four places, document id, ordinal), never by storage layout;
- a prefix expanding into the first 256 terms, in byte order, that a readable chunk holds;
- snippet weights from readable, live chunks;
- memory BM25 over the reader's statistics with FTS5's formula, and the tier, time and id order after it;
- `last_readable_document` counting document changes only;
- every count, total and head shown to a plugin computed under the reader filter.

The rule the suite applies to each: **adding, changing or deleting rows a reader cannot read changes no byte of that
reader's results**, scores and positions included.

### 3.3 The conformance suite, version 3

| Group | Holds | New |
| --- | --- | --- |
| `documents`, `records`, `changes`, `envelope`, `access`, `graph`, `index`, `concurrency`, `durability` | Phase 2's, as they are | |
| The nine `memory_*` groups | Phase 3's and phase 5 step 7's, as they are | |
| `exactness` | 3.2 for knowledge, as differential probes: each read run before and after unreadable documents are written, indexed, changed and deleted, compared byte for byte; moved here from `store-embedded/tests/partitioned_stats.rs` | Yes |
| `memory_exactness` | 3.2 for memory, the same way | Yes |
| `admin` | `check` finds each seeded fault (a damaged row, a revision gap, an applied revision past the head) and passes a clean store; `digest` is stable across reopen and differs after any write; `freeze` refuses writes with `Frozen` and keeps reads; `retire` leaves nothing readable and refuses reopening with `Retired` | Yes |
| `archive` | `export` then `import` into a fresh store gives equal archive and content digests and byte-identical reads for three readers; import refuses a non-empty space, a damaged file (its `sha256`) and a digest mismatch, writing nothing | Yes |
| `instances` | The `concurrency` cases with each writer holding its own backend handle (its own process, connections and caches): readers on one handle see another's commits on their next call, revisions stay dense and in commit order, and one index writer at a time | Yes |
| `crash` | A writer child killed (`SIGKILL`) inside a document write, a graph apply, an index commit, a memory write and a forget: on reopen nothing is partial, and a forget's key destruction is either complete or rolled forward by the next writer (D83) | Yes |
| `state_events`, `state_cursors`, `state_nonces`, `state_limits`, `state_person`, `state_tasks`, `state_usage`, `state_keys` | The state traits: dense event sequences per space with the journal and events appended together or not at all; one `consume` winning among processes; limit counters exact under contention; person and task rows' expiry and leases; usage append and owner-only reads; keys created once under a race | Yes |

**Certification (D134).** A backend kind is certified for store traits version 3 when `run_all` reports **no
failure and no skip**. A backend without an index or a memory store cannot be certified, and the host refuses to
open a space on an uncertified kind (4.11). `Report::assert_certified` is new beside `assert_passed`, and writes
section 2.4's report.

**Across backends.** `store-postgres/tests/differential.rs` (not part of the suite, because it needs two backends)
loads one seeded corpus of 2 000 documents and 5 000 memory records into both backends and runs 5 000 seeded queries
for each of five readers: knowledge search ids, scores to four places and snippets, and memory recall orders, must be
**identical**. The knowledge eval gate runs on both and must give equal reports. This holds because the index is the
same tantivy code (4.8) and memory matching uses `umbel-store`'s FTS5-equivalent tokenizer (4.9).

### 3.4 The embedded reference backend, certified

Step 2 implements version 3 in `umbel-store-embedded` and certifies it on Linux and macOS: `StoreAdmin` over the
existing files, the state stores moved from `src/shared/`, and the new groups. Its physical `store-backup` directories
of phases 2 and 3 stay readable by `store-restore` (6.2). Nothing it does today changes.

## 4. The PostgreSQL backend

### 4.1 Which servers (D135)

PostgreSQL 16, 17 and 18, and 19 once it is released and green in CI. The doctor's `backends.server` check fails a
major whose upstream end of life (a dated table compiled into the binary, from the versioning policy) has passed by
the host's clock, and a major below 16. A server that reports another product in `version()` (a service that speaks
PostgreSQL's protocol) is served only if certification passes on it (4.11); nothing is assumed from compatibility
claims.

Why 16 and not 15: a deployment set up during this phase on 15 would reach end of life on 2027-11-11 and the doctor
would then fail it. CI tests the oldest and newest supported majors (D147).

### 4.2 Connections and roles (D135)

- **Transport.** A TCP connection always uses TLS 1.2 or 1.3 through rustls with the `aws-lc-rs` provider, with the
  certificate verified and the host name checked (libpq's `verify-full`). The roots are the platform's, or only
  `ca_file`'s when it is set. There is no setting that weakens this. A `socket` connection uses the Unix socket.
- **Authentication.** On TCP, SCRAM-SHA-256 with **channel binding required** (`tls-server-end-point`), so a server
  holding a misissued certificate still cannot relay the login. `trust`, `password` (cleartext) and `md5` answers are
  refused by the client. On a socket, SCRAM or peer authentication.
- **Two roles.** The *runtime* role serves requests. The *admin* role is used only by CLI commands that change the
  database's schema or run certification (`store-init`, `store-certify`, `store-move` into a new space); `serve` never
  holds it. The doctor fails when the runtime role is a superuser, has `BYPASSRLS`, has `CREATEROLE` or `CREATEDB`,
  owns any Umbel table, or may `CREATE` in an Umbel schema.
- **Session settings**, set on every connection: `search_path` to the space's schema and `pg_catalog` only (never
  `public`); `statement_timeout`; `lock_timeout` and the pool's wait both bounded by `store.lock_timeout_ms`;
  `idle_in_transaction_session_timeout`; `application_name = 'umbel'`; `default_transaction_read_only = on` for
  read paths.
- **SQL.** Every value is a bound parameter. The only identifiers built into SQL are schema names from 4.3's
  mapping, which are hex and never the space id.
- **Failures.** A lost or refused connection is `Unavailable`; a pool wait past the timeout is `Busy`. Either way
  the request fails closed and nothing is cached as an answer.

### 4.3 Layout

- `umbel_meta` holds the schema version, the space registry (space id to schema name), certification reports, move
  records, epoch metadata (never keys) and the index's file registry.
- Each space has its own schema, `us_` followed by the first 26 base32 characters of SHA-256 over the space id: a
  fixed-length identifier that fits PostgreSQL's 63-byte limit for every space id.
- A space's tables: `head` (one row: document revision, memory revision, frozen or retired state, the current
  epoch); `documents`; `records`; `changes`; `graph_nodes`, `graph_edges`, `graph_applied`; `index_meta`,
  `index_files`; `memory_records`, `memory_versions`, `memory_postings`, `memory_prefixes`, `memory_changes`,
  `memory_markers`; `data_keys`.
- Several backend instances may share one database; spaces never share a schema.

### 4.4 Transactions and revisions (D136)

- **Writes serialise per space on the `head` row.** Every write transaction begins with `SELECT … FROM head FOR
  UPDATE`, then takes the next revision from it. Revisions are therefore dense and in commit order, so a reader
  paging `changes` after a revision can never miss a change that commits later with a lower number. A sequence is
  never used for a revision (trajectory refresh).
- The memory store has its own revision on the same row, under the same lock; a document write and a memory write
  are never one transaction.
- **Reads that take several statements** (a page and its count, a recall's matches and statistics) run in one
  `REPEATABLE READ READ ONLY` transaction, so they see one snapshot.
- Lock order is `head`, then rows in id order; nothing else locks, so writers cannot deadlock.
- Compare-and-set (`Expect`) is checked inside the locked transaction, after opening the current seal (4.6).
- Advisory locks are used only for the index writer (4.8) and the epoch rotation lease (4.7), keyed by a fixed
  namespace and the schema name.

### 4.5 Access inside the query, and row security behind it (D136)

- Access sets are `text[]` columns with GIN indexes; the reader's tokens are a bound `text[]` parameter, and every
  read's `WHERE` holds `access && $reader` (and, for edges, both endpoints' and the origin's).
- **Defence in depth:** every content table has row security enabled and forced. Its policy admits a row only when
  `access && current_setting('umbel.reader')::text[]`, or when `current_setting('umbel.derivation') = 'on'`. Each
  transaction sets both with `SET LOCAL` from the same filter it binds into the query; a derivation transaction is
  opened only inside a store write, as the host allows today (D54). A query that forgot its filter therefore still
  returns only readable rows. This guards against Umbel's own bugs, not against a compromised host, which holds the
  role's credentials.
- `tests/rls.rs` runs a deliberately unfiltered `SELECT` on every table under each conformance reader and must see
  only readable rows.

### 4.6 Sealing: the database never sees content (D137)

**Every content-bearing value is sealed by the host before it reaches PostgreSQL.** The database, its write-ahead
log, its replicas, its backups and its operators see identifiers and shape, never content.

| Sealed | Plain (identifiers and shape) |
| --- | --- |
| Document bytes, frontmatter, title; record bodies; text-bearing envelope fields (`sources`, `constraints`, `redactions`, `confirmation`); every content hash; graph node labels and edge attributes; index segment files; memory `subject`, `text`, `tags`, content hash and text-bearing envelope fields | Ids, paths, collection, type, status, revisions, times, kinds, flags, sizes (padded), access sets, sensitivity, owners and principals, trace ids, memory class, scope, validity and lifecycle fields, token counts |

- **Data keys.** Each stored row version gets a fresh random 256-bit data key from the operating system. Its value is
  sealed with XChaCha20-Poly1305 (`chacha20poly1305`, as D82) under that key, with a random 192-bit nonce. The data
  key is stored in `data_keys`, wrapped under the space's current epoch key, and deleted with the row version.
- **Associated data binds the row.** The seal's associated data is the space id, table, row id, version or revision,
  **the access set and the sensitivity**. A database that moves a value to another row, another space, or rewrites
  the access column to widen it, yields a value that does not open: `STORE_CORRUPT`, the read fails closed, and the
  doctor's `store.check` reports it. The database can withhold or roll back rows (availability), but it cannot read
  content or widen who reads it.
- **Padding.** Sealed values are padded to the next multiple of 256 bytes before sealing, so lengths do not reveal
  small differences.
- **Blind values.** Equality lookups on sealed content (a memory observation's content hash) use HMAC-SHA256 under the epoch's blind key, derived from the epoch key. Memory
  postings use them too (4.9).
- **What it costs in function, stated:** a deployer cannot read or report on content with SQL tools; content is
  reached only through commands, under the reader filter, as principle 10 intends.

### 4.7 Epochs, the keyring and the erasure horizon (D138, owner question 4)

PostgreSQL cannot erase bytes: a deleted or updated row stays in dead tuples until vacuumed, in the write-ahead log
until recycled, and in archives and backups for as long as they are kept. SQLite's `secure_delete`, which phases 3 and
4 rely on (D73, phase 4 section 9.1), has no equivalent. Sealing turns erasure into key destruction:

- **Epochs.** Each space has one epoch key at a time, 32 random bytes in the keyring. Every `rotate_hours` (default
  24) a new epoch begins: rotation unwraps each live data key under the old epoch key and rewraps it under the new
  one, re-blinds the blind values and rebuilds memory postings (4.9), then marks the old epoch retired.
- **Retired epoch keys are destroyed** after `recovery_days` (owner question 4; recommended 30). Within the window, a
  database backup taken then can still be restored, with the keyring.
- **What a delete, forget or replace does.** The row version and its data key are deleted at once, so nothing
  reaches it through Umbel. Copies outside the live database (dead tuples, the write-ahead log, archives, replicas,
  backups) hold the data key only wrapped under the epoch key of the time. Once that epoch key is destroyed, those
  copies cannot be opened by anyone.
- **The erasure horizon** is one epoch, plus the recovery window, plus how long the deployer keeps keyring backups.
  `workspace-show` states it per space, and the doctor's `store.epochs` warns when rotation is more than one epoch
  late and fails at four.
- **Who rotates.** `serve` rotates when an epoch is due, in batches between requests, under an advisory-lock lease so
  one instance does it; `store-rekey` (CLI, operator) does the same on demand. Rotation is never in a request's path
  and never holds a request.
- **This keeps D82's forget and adds a bound it lacks.** For memory, per-record keys remain the unit of erasure, as
  D82 decided; in this backend a record's key is its data key. The embedded backend's stated limit, that a file-level
  copy holds live text for good, does not exist here: no copy of a PostgreSQL space holds readable content once its
  epoch is destroyed.

**The keyring** holds epoch keys and, in a shared deployment, the host keys (5.5). It is never in the content
database:
- `kind = "files"` (single machine only): `state/keys/keyring/`, one file per key, mode 0600, written race-safe like
  today's keys; a destroyed key is overwritten and removed.
- `kind = "postgres"`: its own database, each entry sealed under the **root key**, which the deployer supplies as a
  host secret (phase 5 section 10.4) and Umbel never stores. A stolen content database, keyring database or backup
  alone opens nothing; all three are needed.
- **The keyring must be on another cluster** than every content database, so that its backups can be kept on a
  shorter schedule than theirs. `store-init` reads `pg_control_system()`'s `system_identifier` from both under the
  admin role and records them; the doctor's `keyring.separate` fails when they are equal, and **fails, not warns,
  when either cannot be read**, naming the grant (`EXECUTE` on `pg_control_system()`) that lets it be proven.
- Losing the keyring loses every PostgreSQL space's content, as losing `memory.keys` loses memory today. The doctor's
  `keyring.backup` check reports the age of the keyring's last verified copy when the deployer records one with
  `store-keyring-verify`, and warns when none is recorded.

### 4.8 The index on PostgreSQL (D139)

The index is **the same tantivy code** as the embedded backend (index schema 2, per-filter statistics, readable
prefix expansion and snippets, the total tie order), moved to `umbel-store-lexical` and made generic over tantivy's
`Directory`. The PostgreSQL backend supplies `PgDirectory`:
- **Files** are rows of `index_files`: name, size, the sealed content (4.6), and a deletion time. Segment files are
  immutable once written. `meta.json` is `index_meta`'s one row, with a `generation` and the applied revision,
  replaced by `atomic_write` in one statement.
- **The writer lock** is an advisory lock held on a dedicated connection for the writer session's life; waiting past
  `store.lock_timeout_ms` is `Busy`. One writer at a time across every machine.
- **Readers** keep a local cache under `state/cache/index/<backend>/<schema>/`, mode 0700: each file is fetched,
  opened, checked against its seal and written once. **Every search first reads `generation`** and reloads when it
  moved, so a commit on one machine is seen by the next search on any machine.
- **Deletion is deferred.** A file tantivy deletes is marked and purged, with its data key, after ten minutes, so a
  reader on another machine that read the previous generation can still fetch it.
- **The cache is plaintext on the instance's disk**, as the embedded index is. A retired or moved space's cache is
  deleted; at start, a cache whose schema is no longer registered is removed.

Ranking, snippets and every exactness property are therefore identical across backends, which `differential.rs` and
the eval gate hold (3.3).

### 4.9 Memory on PostgreSQL (D140)

- Records and versions are rows; sealed fields as 4.6 lists; every access, bitemporal, expiry and flag condition is in
  the matching statement, as D70 requires.
- **Seals.** Memory fields use D82's construction under the record's own key, which in this backend is its data key,
  wrapped under the epoch. D82's associated data (space, id, owner, part, version) is extended by the access set and
  sensitivity, so 4.6's binding holds; each row records its associated-data version (1, D82's; 2, extended). A
  restored row keeps the version it was sealed under and opens with it; a move, which carries the key, re-seals under
  the target's version.
- **Matching.** The memory tokenizer of `umbel-store` (FTS5's `porter unicode61 remove_diacritics 2`, ported in phase
  5 step 7) tokenizes each record at write. `memory_postings` holds, per record version and column, each token's
  blind value (4.6) and its positions; `memory_prefixes` holds the blind value of every prefix of 2 to 1 024 characters
  of each token, for `word*`. The query, parsed in `umbel-store` as today, is tokenized the way FTS5 tokenizes a
  query, and matched in SQL on blind values; phrases are checked on positions; `+` and `-` as D70 defines them.
- **Ranking.** Phase 5 step 7's: FTS5's `bm25()` formula over the reader's statistics, then tier, recorded time and id.
  Token counts are plain (shape), so statistics come from SQL counts under the reader filter.
- **Forget** deletes the record's versions, postings, prefixes and data keys in one transaction, writes the tombstone
  and the `Erased` change, and keeps D83's marker discipline, so an interrupted forget is rolled forward by the next
  writer. The erasure horizon (4.7) bounds every other copy.
- **Rotation** rebuilds postings and prefixes under the new blind key from the opened text.
- `differential.rs` holds recall orders identical to the embedded backend's (3.3).

### 4.10 Schema versions and migration (D148)

- `umbel_meta.schema_version` is 1 in this phase. The host refuses a database whose version is newer than it knows
  (`STORE_SCHEMA_TOO_NEW`) and one that is older (`STORE_SCHEMA_OUTDATED`, naming `store-init`).
- `store-init` (CLI, operator, admin role) creates `umbel_meta`, the roles' grants, each declared space's schema and
  the row security policies, and upgrades an older schema version, each upgrade in one transaction. It is idempotent.
- `serve` and every other command never change the database's schema.

### 4.11 Certification on the deployer's own server (D141)

The CI certifies the backend kind against PostgreSQL 16 and 18. A deployer's server may still differ: a managed
service's isolation, locking or extension behaviour, or a protocol-compatible product. So:
- `store-certify --backend <id>` (CLI, operator, admin role) runs the whole suite on the deployer's server, in a
  scratch schema it creates and drops, with writer children that re-run the CLI (`--child`), and records section
  2.4's report in `umbel_meta`.
- A space is served on a backend instance only when a passing report exists for its server's product and major, the
  crate's version and schema version, and the suite version. Otherwise every call to the space is
  `STORE_BACKEND_UNCERTIFIED` and the doctor's `backends.certified` fails, naming the command to run. A minor update of
  the server needs no new report; a major upgrade or an Umbel upgrade that changes the suite does.

## 5. Several machines behind one URL (D145, owner question 2)

### 5.1 Deployment modes

`deployment.instances = "single"` is today's model: every process on one machine, sharing `state/` under the
workspace lock (D29) and `state/shared/` (D126). `"shared"` lets any number of machines serve one deployment behind
one URL. Each machine runs the same `umbel.toml` and the same plugin set from its own workspace directory; nothing
mutable lives on its local disk except caches.

### 5.2 Where each piece of state lives

| State | `single` | `shared` |
| --- | --- | --- |
| Space stores | The space's backend instance, `embedded` or `postgres` | A `postgres` instance (required) |
| Journal and events (D29) | `state/journal.jsonl` and `state/spaces/<space>/events.jsonl` | The state backend's `EventLog` (5.3) |
| Cursors | `state/spaces/<space>/cursors/` | The state backend |
| Nonces, relay evidence, gateway `jti`s, spent decisions | `state/shared/nonces.sqlite3` | The state backend |
| Person decisions, tasks, limit counters | `state/shared/*.sqlite3` | The state backend |
| Usage events | `state/usage/` | The state backend |
| Confirmation, approval, cursor, relay, person and limits keys | `state/keys/` | The keyring (5.5) |
| Epoch keys | The keyring | The keyring |
| Index cache | — (embedded indexes live with their store) | `state/cache/` (derived, per machine) |

The PostgreSQL implementations keep each trait's phase 5 semantics: `consume` is `INSERT … ON CONFLICT DO NOTHING`
answered by the affected row count; limit windows and leases are computed in SQL. Content-bearing columns of the
state stores (person decision previews' hashes, task results' counts) are sealed under the state backend's epochs
like any space's.

### 5.3 The journal and its events in one transaction

The host's projecting sink implements AFD's `JournalSink` over `EventLog`. In a shared deployment, one transaction
locks the journal's head row, appends the journal entry with the next journal sequence, and appends each projected
event with its space's next event sequence. Sequences are dense and in commit order (4.4). There is no
`projection.pending` window, because the entry and its events commit together; `event-rebuild` still rebuilds every
stream from the journal. D66 stays as decided: a journal failure does not change a command's result, and
`store-check` reports a store change with no journal entry.

### 5.4 One clock for shared decisions

Every comparison that several machines must agree on (a nonce's expiry, a limit window, a task lease, a person
decision's expiry) uses the state backend's clock (`clock_timestamp()`), never the instance's. The command context's
recorded clock is unchanged for everything that is journaled. The doctor's `deployment.clock` warns when an
instance's clock differs from the database's by more than five seconds.

### 5.5 Host keys

In a shared deployment the host keys are keyring entries, created once under a race by the first instance (an
`INSERT … ON CONFLICT DO NOTHING`, then a read), and every instance holds them in memory. `state/keys/` must not exist;
the doctor's `deployment.local_state` fails when `state/keys/`, `state/shared/`, `state/journal.jsonl` or any
`state/spaces/<space>/` other than a moved marker is present, so a machine cannot silently serve from local state.
`store-move --state` (6.4) carries a single-machine deployment's existing state into the state backend.

### 5.6 What each machine checks at start

`serve` refuses to start, naming the failing check, unless: the configuration is version 6 and loads; the state
backend and every space's backend are reachable, at the supported schema version and certified (4.11); the keyring
opens and is separate (4.7); and the local state is empty (5.5). Each machine also records itself in the state
backend (instance id, binary version, configuration digest), and the doctor's `deployment.config` fails when two
live instances report different configuration digests or binary versions outside one minor release.

### 5.7 Authentication under `shared`

`auth.mode` must be `oauth` or `gateway` (2.1). Every phase 5 rule holds unchanged; only where its state lives moves.

### 5.8 Content under `shared`: store-held collections (D146, owner question 3)

A collection's files are the source of its documents today: `sources-sync` reads them, and applying a proposal writes
the file through `content_write` before the document. On several machines each would read and write its own copy,
and a sync on a machine holding an older file would overwrite a newer document. So under `shared` every collection is
**store-held** (`source = "store"`):
- The document store is the source. Applying a proposal writes the document under compare-and-set on its revision and
  hash; no file is written, and `content_write` is not used.
- `sources-import` (CLI, operator) reads a folder (the collection's `root` by default) and writes each changed file
  as a document, under compare-and-set, with origin `import`. It refuses to overwrite a document changed since the
  folder's last import or export unless `--force` names it; the person decides.
- `sources-export` (CLI, operator) writes the collection's documents to a folder, so it can be kept in git or
  reviewed; exported files carry their revision in a sidecar `.umbel-export.json`.
- `sources-sync` refuses a store-held collection (`SOURCES_STORE_HELD`), and the `content` and `content_write` grants
  answer `PLUGIN_GRANT_UNAVAILABLE` for one.

A single-machine deployment may use `source = "store"` too, and keeps `files` as its default.

## 6. Moving, backing up and restoring (D143, D144)

### 6.1 The archive and its digest

Two digests, each SHA-256 over a space's items in a fixed order (documents by id, records by namespace, kind and id,
changes and memory changes by revision, graph contributions by origin, memory versions by record and version), each
item serialised as canonical JSON (`umbel-store`'s `canonical_json`):
- **The archive digest** takes memory's sealed fields as stored. It needs no key, so a backup and its restore are
  checked with it: a restore keeps memory ciphertext as it is, and the restored store's export digests equal.
- **The content digest** takes memory's sealed fields as their plaintext's content hash, computed inside the store
  that holds the keys. It is equal across backends whatever their seals, and the plaintext never leaves the store. A
  move, which carries keys, is checked with it.

Two stores with equal content digests answer every read identically.

### 6.2 `store-backup` and `store-restore`

- `store-backup` (CLI, operator) writes a space archive (2.2) for **every** backend kind, through `StoreAdmin::export`,
  under the space's freeze for the copy's duration (6.3), or under a single snapshot for a backend that has one.
- `store-restore` (CLI, operator) imports an archive into a space that is empty on its configured backend, checks
  each file's `sha256` and the archive digest, and rebuilds the index and graph from the documents. Memory comes back sealed
  under the keys the archive excluded: it opens only where the deployer has also restored the key material (the
  embedded key file, or a keyring holding the epoch). A record whose key is absent stays unreadable and is reported by
  `memory-reindex`, as D89 already handles; restore never invents keys.
- `store-restore` also reads the embedded backend's physical backup directories of phases 2 and 3, into an embedded
  space only. This closes phase 2's restore follow-up.

### 6.3 `store-move`

`store-move <space> --to <backend>` (CLI, operator):
1. **Freeze.** The source's `freeze` refuses every write to the space with `SPACE_MOVING` (retryable) and keeps reads.
2. **Copy.** It `provision_space`s the target (refusing a target that already holds the space), streams `export` into
   `import`, and carries memory keys on a separate channel inside the process, rewrapped for the target (the embedded
   key file's per-record keys become the PostgreSQL record's data key, and the reverse); keys never touch an archive
   or a temporary file.
3. **Verify.** Both content digests are computed and must be equal, and the target's `check` must pass; else the target space
   is retired, the record is `aborted`, and the source is thawed.
4. **Record.** The move record (2.3) is stored in the target, `verified`.

**The switch is the configuration.** The deployer then sets `spaces.<space>.backend` to the target. At the next open,
the host serves the space from the target only if it holds a `verified` move record whose content digest equals the
frozen source's current one; otherwise it refuses the space with `SPACE_BACKEND_UNSYNCED`. On that first open it marks the
record `switched` and **retires the source**: the source's memory keys are destroyed first, exactly as a forget does
(D82, D83), then its data is deleted, leaving `moved.json` (2.3) in its place. Only then is the record `retired`.

**Why the source is not kept.** A kept copy would still hold every memory record that is forgotten after the move,
so a forget would no longer be true (D73). A move back is another move, always possible because the target holds
everything.

- **Revert is refused.** If the configuration names the source again, the host finds `moved.json` and refuses the space
  with `SPACE_MOVED`, naming the move and the backend it went to.
- **Abort.** Before the switch, `store-move-abort` retires the target's copy and thaws the source.
- **Events and cursors do not move.** They are host state (5.2): a moved space's event stream, positions and sealed
  cursors are unchanged, and so are its answers, which the exit test compares byte for byte.

### 6.4 Moving host state

`store-move --state --to <backend>` carries a single-machine deployment's journal, events, cursors, shared stores and
usage into a state backend, and its host keys into a `postgres` keyring, with the workspace lock held throughout. It
verifies counts and digests, then deletes the local copies, keys last; after it, the deployer sets
`deployment.instances = "shared"`. It is the only way local state reaches a shared deployment.

## 7. Host services and commands

### 7.1 Built-ins

| Command | Exposure | Effect | Notes |
| --- | --- | --- | --- |
| `store-init` | CLI only, operator | `workspace-write` | 4.10; the admin role |
| `store-certify` | CLI only, operator | `workspace-write` | 4.11 |
| `store-backup` | CLI only, operator | `workspace-write` | 6.2; now an archive for every kind |
| `store-restore` | CLI only, operator | `store-write` | 6.2 |
| `store-move`, `store-move-abort` | CLI only, operator | `store-write`, `workspace-write` | 6.3, 6.4 |
| `store-rekey` | CLI only, operator | `store-write` | 4.7 |
| `store-keyring-verify` | CLI only, operator | `inspect` | Opens every key of a keyring copy the deployer names, and records the copy's age (4.7) |
| `store-show`, `store-check` | CLI only, operator, as since phase 5 step 7 | `inspect` | Now through `StoreAdmin` for every backend; `store-show` adds the backend instance, server, certification, epochs and erasure horizon |
| `sources-import`, `sources-export` | CLI only, operator (`sources` plugin) | `store-write`; `workspace-write` | 5.8 |

None is exposed over MCP, none is a task, and each refuses any caller but the operator (`COMMAND_NOT_EXPOSED`), as
phase 5 step 7 made the existing `store-*` built-ins do. **No plugin grant is new.**

### 7.2 Doctor checks

| Check | Fails when |
| --- | --- |
| `backends.reachable` | A configured instance cannot be connected to under 4.2's rules |
| `backends.server` | A major below 16 or past its end of life |
| `backends.roles` | The runtime role is a superuser, `BYPASSRLS`, `CREATEROLE` or `CREATEDB`, owns an Umbel table or may create in an Umbel schema |
| `backends.schema` | The schema version is not this binary's |
| `backends.certified` | No passing report matches (4.11) |
| `backends.rls` | A content table without forced row security or its policy |
| `keyring.opens`, `keyring.separate` | The keyring cannot be opened; the separation cannot be proven (4.7) |
| `keyring.backup` | Warns when no keyring copy has been verified |
| `store.epochs` | Warns one epoch late, fails four epochs late |
| `deployment.local_state`, `deployment.config`, `deployment.clock` | 5.5, 5.6, 5.4 (the clock warns) |
| `spaces.moves` | A space whose configured backend does not match a switched move, or an unfinished move older than a day (warns) |

### 7.3 `workspace-show`

To the operator: each space's backend instance and kind, the deployment mode, the erasure horizon per PostgreSQL
space, and the certification in force. To every other caller nothing about backends changes: backend names, servers
and epochs are operator information, and a hosted caller sees phase 5's answer.

### 7.4 Error and warning codes

| Code | When | Retryable | Details |
| --- | --- | --- | --- |
| `STORE_UNAVAILABLE` | A backend connection is lost or refused | Yes | `backend` (operator only) |
| `STORE_BACKEND_UNCERTIFIED` | 4.11 | No | `backend`, `command: "store-certify"` (operator only) |
| `STORE_SCHEMA_TOO_NEW`, `STORE_SCHEMA_OUTDATED` | 4.10 | No | `found`, `supported` |
| `STORE_CORRUPT` | A seal that does not open, including a widened access column (4.6) | No | None to non-operators |
| `KEYRING_UNAVAILABLE` | The keyring cannot be read | Yes | None |
| `KEYRING_EPOCH_MISSING` | A row's epoch key is destroyed or absent (a restored copy older than the window) | No | `epoch` (operator only) |
| `SPACE_MOVING` | A write during a move | Yes | None |
| `SPACE_MOVED` | The configuration names a retired source | No | `to` (operator only) |
| `SPACE_BACKEND_UNSYNCED` | The configured target holds no matching verified move | No | `move` (operator only) |
| `STORE_RESTORE_INVALID` | A damaged archive file, a digest mismatch or a non-empty target | No | `file` |
| `SOURCES_STORE_HELD` | `sources-sync` on a store-held collection | No | `command: "sources-import"` |

To a non-operator, every one of these that would name a space it cannot read is phase 5 section 5.4's one answer.

## 8. Security

### 8.1 What earlier phases decided, and how it holds

| Guarantee | How phase 6 keeps it |
| --- | --- |
| **Forget** (D73, D82, D83, D103, D120) | Per-record keys remain the unit of erasure; a forget deletes the key, rows, postings and prefixes at once and keeps D83's markers. Every copy PostgreSQL keeps is bounded by the erasure horizon (4.7). A move retires the source, memory keys first (6.3). Archives never hold keys (2.2). The cache holds documents only, never memory |
| **Access and exactness** (D53, D125) | The filter stays inside every query; row security stands behind it; every exactness property is a suite obligation for every backend (3.2, 4.5) |
| **Phase 4's redaction** (section 9.1) | Embedded: `secure_delete`, unchanged. PostgreSQL: the redacted version's data key is deleted, and the epoch bounds every copy (4.7) |
| **Shared state** (D126) | The same traits and atomicity, on the state backend, with one clock (5.4) |
| **Journal** (D29, D66) | Entry and events in one transaction; D66 unchanged |
| **Spaces do not mix** (D26) | A schema, epochs and data keys per space; associated data binds the space (4.6) |
| **Host-owned authority, attestation, person** | Untouched: no backend sets them |

### 8.2 Threats

| Threat | Control | Test |
| --- | --- | --- |
| The database's operators, a replica, a backup or a hosting provider reads content | Every content value sealed before it leaves the host (4.6) | `store-postgres/tests/canary.rs`: canaries never appear in the data directory, the write-ahead log or a `pg_dump` |
| A stolen database or backup, with or without the keyring | Root key outside both; epoch keys outside the content database | `canary.rs`, `keyring.rs` |
| A forgotten memory or deleted document recovered from an old backup | Epochs, destroyed after the recovery window (4.7) | `erasure_horizon.rs`: a dump from before a forget, with the current keyring after the window, opens nothing |
| The database widens access by editing the access column, or moves a row | Access and identity in the seal's associated data (4.6) | `tamper.rs` |
| The database serves another space's or an older row | Associated data; dense, checked revisions (`check`) | `tamper.rs` |
| A query that forgets the reader filter | Forced row security (4.5) | `rls.rs` |
| A connection intercepted, or a misissued server certificate | `verify-full` TLS; SCRAM with channel binding required | `connect.rs` (with testkit-pg's CA and a wrong-host certificate) |
| A runtime role with too much power | Doctor's `backends.roles`; admin role never in `serve` | `doctor_backends.rs` |
| Search-path or SQL injection | Pinned `search_path`; bound parameters; hex schema names | `connect.rs`, `migrate.rs` |
| A Postgres-compatible service that differs in semantics | Certification on the server itself (4.11) | `certify.rs` |
| A revision missed by a reader because of commit order | Head-row serialisation (4.4) | Suite `instances` |
| A machine serving from stale local state | `deployment.local_state` refuses start (5.5) | `deployment.rs` |
| Two machines with different configurations | `deployment.config` (5.6) | `deployment.rs` |
| Clock skew between machines deciding expiry | The database's clock (5.4) | Suite `state_*` with a skewed instance clock |
| A file sync overwriting a newer document | Store-held collections under `shared` (5.8) | `store_held.rs` |
| A move losing or altering data | Freeze, digest equality, `check`, then switch (6.3) | Suite `archive`; `moves.rs` |
| A revert serving a stale source | Retired source and `moved.json` (6.3) | `moves.rs` |
| A kept source defeating a later forget | Retire at switch, memory keys first | `moves.rs` with canaries |
| Losing the keyring | Stated: it loses content, as `memory.keys` does; doctor's `keyring.backup` | `doctor_backends.rs` |
| The local index cache read on an instance | Stated: plaintext, as the embedded index; mode 0700; deleted on retire | `cache.rs` |
| Denial of service through the pool | Bounded pool, timeouts, phase 5's limits first | `connect.rs`, `limits.rs` |

Not defended, and stated: a compromised host process holds every credential and key it uses, as it does today; a
database that withholds or rolls back rows can deny service or show an older state, which `store-check` and the
revision checks detect but cannot prevent.

## 9. Exit criterion and tests

The exit criterion is met when `umbel.yml` is green on `main` with every test below, and
`first-party/tests/exit_backends.rs` passes in it against PostgreSQL 16 and 18.

**Setup:** two throwaway clusters from `umbel-testkit-pg` (a content cluster and a keyring cluster, each with TLS from a
test CA, SCRAM, a runtime and an admin role), and `umbel-testkit-idp` as phase 5's exit uses it.

It asserts:

1. **Certified.** `run_all` on the embedded backend and on the PostgreSQL backend: no failure, no skip; the two
   reports are stored. `store-certify` on the test cluster records a passing report, and a space on an uncertified
   instance answers `STORE_BACKEND_UNCERTIFIED`.
2. **The same answers.** `differential.rs`'s corpus gives identical knowledge and memory results on both backends, and
   the eval gate gives equal reports.
3. **One space moves by configuration, another stays.** A workspace with spaces `alpha` and `beta` on `embedded`,
   with documents, proposals, memory for two principals and events.
   - A write to `alpha` during `store-move alpha --to main` is `SPACE_MOVING`.
   - After the move and the configuration change, for three readers, every knowledge and memory read, `event-list`,
     `space-list` and sealed positions on `alpha` are byte-identical to before; `beta` still answers from `embedded`.
   - `alpha`'s embedded files are gone except `moved.json`, and no memory canary is in any file under `state/`.
   - Setting `alpha` back to `embedded` is `SPACE_MOVED`; moving it back with `store-move` works.
4. **Backup and restore.** `store-backup` of `alpha` on PostgreSQL restores into an empty embedded workspace, and back,
   with equal digests; an altered archive file is `STORE_RESTORE_INVALID` and writes nothing.
5. **Several machines** (with owner question 2). Two workspace directories standing for two machines, one
   configuration, `instances = "shared"`, every collection store-held, behind phase 5's balancer in mode `oauth`:
   - phase 5's exit points 2 (results filtered, byte-identical before and after hidden writes), 5 (approval through
     the person page on one instance, retry through the other), 6 (tasks, `TASK_LOST` when an instance dies) and 7
     (usage) pass with the state in PostgreSQL;
   - an approval nonce spent on one machine is refused on the other;
   - a third machine with leftover local state, or another configuration digest, refuses to start.
6. **Erasure.** Ada's memory record and a document are written, then a `pg_dump` and a keyring copy are taken. The
   record is forgotten and the document deleted. With the test clock past one epoch and the recovery window, the old
   dump with the current keyring opens neither, and the old dump with the old keyring copy still does (the stated
   horizon). At no point does a canary appear in the data directory, the write-ahead log or a dump.
7. **Unchanged locally.** Phase 5's exit tests pass unchanged on an all-embedded `single` workspace.

| Test file | Crate | Covers |
| --- | --- | --- |
| `store/tests/conformance_v3.rs` | store | The suite's own cases against a deliberately faulty in-memory backend: each new group detects its fault |
| `store-embedded/tests/conformance.rs` (extended) | embedded | `run_all` with `assert_certified` |
| `store-postgres/tests/conformance.rs` | postgres | `run_all` with `assert_certified`, against 16 and 18 |
| `store-postgres/tests/differential.rs` | postgres | 3.3 across backends |
| `store-postgres/tests/connect.rs`, `migrate.rs`, `rls.rs` | postgres | 4.2, 4.10, 4.5 |
| `store-postgres/tests/canary.rs`, `tamper.rs`, `keyring.rs`, `erasure_horizon.rs`, `cache.rs` | postgres | 4.6 to 4.8 |
| `tests/config_v6.rs`, `tests/schemas.rs` (extended) | host | 2 |
| `tests/doctor_backends.rs` | host | 7.2 |
| `tests/certify.rs` | host | 4.11 |
| `tests/archive.rs`, `tests/moves.rs` | host | 6 |
| `tests/deployment.rs` | host | 5.5 to 5.7 |
| `plugins/sources-filesystem/tests/store_held.rs`, `plugins/knowledge/tests/store_held_apply.rs` | plugins | 5.8 |
| `first-party/tests/exit_backends.rs` | first-party | The exit criterion |

**CI (D147).** `umbel.yml` gains a `backends` job on Linux with PostgreSQL 16 and 18 from the PostgreSQL project's
apt repository, started by `umbel-testkit-pg` from the installed binaries; no container, no external service and no
credential. The macOS daily leg runs it with Homebrew's PostgreSQL 18. `scripts/affected/suites.mjs` gains its local
entry, which needs `initdb` and `postgres` on the path, and fails, never skips, without them.

## 10. Out of scope, and the seams reserved

| Out of scope | When | Seam |
| --- | --- | --- |
| A git-backed knowledge store, where a proposal becomes a pull request (the proposal's "second backend") | Its own specification, with owner question 1 | `Backend`; store-held collections' `sources-export` |
| Dedicated search engines as backends (the proposal's "beyond" profile) | When a deployment needs past one PostgreSQL index | `SearchIndex`, certification |
| Vector lanes, including `pgvector` | Optional lanes after phase 2, gated by the eval (O4) | None here |
| Destroying epoch keys in a cloud key service, so erasure does not depend on keyring backups | When a deployer asks; vendor-specific | The keyring's `kind` |
| Sharding one space across databases | The "beyond" profile | One schema per space |
| Read replicas for queries | When load needs it | Reads are snapshot transactions already |
| Online moves without a write freeze | Later, if a freeze's length matters | `freeze`, the move record |
| Windows | Phase 7 | |

## 11. Implementation plan

Each step is one pull request, green on the repository's checks and `umbel.yml`, and updates STATUS.md and this
file. A step that finds a design decision stops and amends this document. Steps changing host code carry the
`Plugin-isolation-exempt:` line.

| Step | Pull request | Contents | Tests | Size |
| --- | --- | --- | --- | --- |
| 1 | Shapes | Section 2's schemas and examples; configuration version 6 parsing and its rules; constants. Nothing acts on the new keys | `schemas.rs`, `config_v6.rs` | M |
| 2 | Traits version 3 and the embedded backend certified | `Backend`, `StoreAdmin`, the state traits and their move from `src/shared/`; `umbel-store-lexical` extracted; suite version 3 with its new groups and `assert_certified`; the embedded backend passing it with no skip; the host's `store-*` built-ins through `StoreAdmin` | `conformance_v3.rs`, `store-embedded/tests/conformance.rs` | L |
| 3 | Test clusters | `umbel-testkit-pg`; the `backends` job and its `suites.mjs` entry, running only the testkit's own tests | Its own suite | M |
| 4a | PostgreSQL: foundation and documents | Connections, roles, migration, sealing, the keyring, epochs (without rotation's scheduler); `DocumentStore`, `GraphStore`, `StoreAdmin` | `connect.rs`, `migrate.rs`, `rls.rs`, `canary.rs`, `tamper.rs`, `keyring.rs`, the suite's non-index, non-memory groups | L |
| 4b | PostgreSQL: index | `PgDirectory`, the cache | The `index` and `exactness` groups, `cache.rs` | L |
| 4c | PostgreSQL: memory | 4.9 | The `memory_*` groups | L |
| 4d | PostgreSQL: certified | The `instances`, `crash`, `admin`, `archive` and `state_*` groups; `differential.rs`; the backend certified on 16 and 18 | `conformance.rs`, `differential.rs` | M |
| 5 | Host: backends per space | Opening spaces by configuration; `store-init`, `store-certify`; the doctor's backend and keyring checks; `workspace-show` and `store-show` | `doctor_backends.rs`, `certify.rs` | M |
| 6 | Archives | `store-backup` for every kind; `store-restore`, with phases 2 and 3's physical backups | `archive.rs` | M |
| 7 | Moves | `store-move`, `store-move-abort`, the switch and the retire step | `moves.rs` | M |
| 8 | Rotation | The scheduler in `serve`, `store-rekey`, `store-keyring-verify`; `erasure_horizon.rs` | `erasure_horizon.rs` | M |
| 9 | Shared deployments | 5.1 to 5.7: the state backend's stores, the event log in one transaction, the host keys, the start checks, `store-move --state` | `deployment.rs`, the `state_*` groups on PostgreSQL | L |
| 10 | Store-held collections | 5.8 in `sources` and `knowledge` | `store_held.rs`, `store_held_apply.rs` | M |
| 11 | Exit | `exit_backends.rs`; STATUS.md marks phase 6 done | The exit | L |

**Order:**
- 1 first. 2 needs 1. 3 needs nothing and may run beside 1 and 2.
- 4a needs 2 and 3. 4b and 4c need 4a and may run side by side. 4d needs 4b and 4c.
- 5 needs 4d. 6 and 8 need 5. 7 needs 6.
- 9 needs 5, and phase 5's steps 8 and 9 (tasks and usage). 10 needs 5.
- 11 needs every step and phase 5's exit.

Steps 9, 10 and the exit's point 5 are built only if the owner answers question 2 with "yes", and step 10's design
follows question 3.

**Build cost.** One new dependency family (`tokio-postgres`, `tokio-postgres-rustls`, `deadpool-postgres`); TLS and
the cipher are already in the lock. Share `CARGO_TARGET_DIR`, use `-p <crate>` and `-j4`, and build only under load 20.
The `backends` job needs the PostgreSQL server packages, not Docker.

## 12. For the owner

Four questions change what people can do, or what phase 6 delivers. Everything else is settled in the sections above
as the strongest choice, and recorded as decisions.

1. **Which second backend comes first** (D131; 4, 10).
   - **Recommendation: PostgreSQL now; a git-backed knowledge store later, in its own specification.**
     - Only a shared database lets several servers serve one deployment (question 2), which phase 5 left to this phase.
     - PostgreSQL can hold every store: knowledge, memory, history and shared state. A git repository can hold
       knowledge documents only.
     - A git-backed store changes **who approves knowledge and where**: approval would move into the git host's
       reviews, outside Umbel's verified approvals and audit. That deserves its own analysis and your decisions, not a
       corner of this phase.
   - Options:
     - (a) PostgreSQL: organisations can keep any space's knowledge, memory and history in their own database, and run
       several Umbel servers on it.
     - (b) A git-backed knowledge store: knowledge changes become pull requests that people review in their git host,
       but memory stays on one machine and servers still cannot share a deployment.
     - (c) Both in this phase: both outcomes, with the git store's approval questions answered inside this
       specification.

2. **Several servers behind one address in this phase** (D145; 5).
   - **Recommendation: yes.**
     - A hosted deployment on one machine stops for everyone whenever that machine restarts or fails.
     - The design needs nothing beyond what question 1's PostgreSQL already provides, and its tests reuse phase 5's.
   - Options:
     - (a) Yes: a hosted deployment can run several Umbel servers behind one address, so one server's restart or
       failure does not interrupt people, and capacity grows by adding servers.
     - (b) In a later phase: spaces can live in PostgreSQL, but each deployment still runs on one machine, and a
       restart interrupts everyone until it is back.

3. **How people change knowledge when several servers share it** (D146; 5.8). This applies only to deployments on
   several servers; one machine keeps working from files as today.
   - **Recommendation: (a).**
     - With files as the source, a server that sees an older copy of the folder can overwrite newer knowledge, and
       nothing in Umbel can prove two servers see the same folder at every moment.
     - Holding the knowledge in the database gives every server one truth, and exporting keeps files available for
       git and review.
   - Options:
     - (a) The knowledge base lives in the database: people change it through proposals as today; an operator loads
       or refreshes it from a folder at the command line, and writes it out to files whenever wanted. Editing a file
       on a server no longer changes anything by itself.
     - (b) Files stay the source: every server mounts one shared network folder. Editors keep editing files directly,
       but a server that loses the mount or sees a stale copy serves outdated knowledge, or overwrites newer
       knowledge, until someone notices.

4. **How long deleted things stay recoverable from backups** (D138; 4.7). In PostgreSQL, Umbel encrypts everything
   with keys it replaces daily, and keeps each replaced key for a recovery window before destroying it. Within the
   window, an operator who restores a database backup gets everything back, including whatever was forgotten or
   deleted since. After it, that backup can no longer be read, and what was forgotten or deleted is gone for good.
   Deployers can choose 1 to 90 days; the question is the default.
   - **Recommendation: 30 days.**
     - It lets an operator recover from a disaster or corruption noticed weeks later.
     - It makes a forgotten memory unrecoverable by anyone within about a month, plus however long the deployer keeps
       copies of the keyring.
   - Options:
     - (a) 30 days: a database backup up to 30 days old can be restored after a disaster, and anything forgotten or
       deleted is beyond recovery after about 31 days.
     - (b) 7 days: forgetting is final within about a week, but a problem found later than a week (corruption,
       a mistaken bulk change) cannot be undone from a backup.
     - (c) 90 days: backups up to three months old can be restored, and forgotten memories stay recoverable from them
       for three months.

### Decisions made here that do not change the trust model

These are settled as technical or security-strength choices, taking the strongest option, and are decided with the
approval under the owner's 2026-10-31 delegation: D132 (backends are not plugins), D133 (traits version 3), D134
(the suite and certification), D135 (servers, connections and roles), D136 (layout, transactions, row security), D137
(sealing all content), D138 apart from the default window (epochs and the keyring), D139 (the index), D140 (memory),
D141 (certification on the deployer's server), D142 (configuration version 6), D143 (archives, backup and restore),
D144 (moves, retiring the source), D147 (test clusters and CI) and D148 (schema versions).

## Follow-ups

| Date | Follow-up | Owner |
| --- | --- | --- |
| 2026-11-09 | PostgreSQL 19's general availability is planned for 2026-11-19: add it to the `backends` job and the supported list once released and green | Phase 6 owning agent, step 3 |
| 2026-11-09 | Whether `pg_control_system()` is executable by the admin role on common managed services was not checked; `keyring.separate` fails closed when it is not, so a deployer may need to grant it | Step 5 |
| 2026-11-09 | A cloud key service as the keyring's epoch store, so destroyed epochs are beyond every backup (section 10) | When a deployer asks |
| 2026-11-09 | Memory recall and the sealed event listing read what the caller can read with no cache (phase 5 follow-up); on PostgreSQL each recall also opens every readable match's seal. Measure on the exit's corpus and cache per (memory head, reader, epoch) if needed | Step 4c |
| 2026-11-09 | The proposal names a git-backed knowledge store as the second backend; the architecture says only "a second backend". Amend the proposal's sentence once question 1 is answered | Owner, with question 1 |
| 2026-11-09 | `scripts/affected/suites.mjs` needs PostgreSQL binaries for the `backends` entry; `SETUP.md` lists the tooling each suite needs | Step 3 |
