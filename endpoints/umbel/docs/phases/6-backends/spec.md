# Phase 6 specification: backends

| Field | Value |
| --- | --- |
| Phase | 6, backends ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | Repository owner approves; the phase 6 owning agent writes and implements |
| Read first | [STATUS.md](../../STATUS.md), then the [architecture](../../architecture.md), the [decision log](../../decisions.md), the [phase 2 specification](../2-knowledge/spec.md) (the store traits, section 3; access, section 6), the [phase 3 specification](../3-memory-context/spec.md) (the memory store and forget, sections 5 and 7) and the [phase 5 specification](../5-auth-hosted/spec.md) (`memory-erase` and the erasure outbox, sections 8.4 and 8.5; exact filtering, section 9; shared state, section 10.2; threats, section 13.2; its step 7 amendments) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request, as the earlier phases' steps did |

## Status

- **State:** **draft, written 2026-11-09, revised 2026-11-09 after its independent review; not approved.** It needs
  the owner's answers to section [12](#12-for-the-owner) before implementation (D24).
  - It proposes decisions [D131 to D149](../../decisions.md). Three wait on the owner's answers to section 12's
    questions: D131 (question 1), D145 (question 2) and D138's recovery window (question 3). The others are settled
    here as technical or security-strength choices, taking the strongest option, and are decided with the approval
    under the owner's 2026-10-31 delegation. Two of those the owner may want to revisit when reading the questions:
    D146 (in a shared deployment the knowledge base lives in the database; the draft's question 3, now settled) and
    D149 (a shared deployment needs a key service that can truly destroy keys).
  - Phase 5 is not done: its steps 6 and 8 to 12 are in progress on other branches. Steps 2 and 4e of this plan wait
    for phase 5's steps 8 to 11 (tasks, usage, `memory-erase` and the erasure sweep), so that store traits version 3
    and its suite cover them once; step 11 (the exit) waits for phase 5's exit (section [11](#11-implementation-plan)).
- **Last verified:** 2026-11-09 against `main` at `8258e0fc`.
  - Read in the code: `store/src/traits.rs`, `store/src/memory.rs`, `store/src/lib.rs`, the conformance suite
    (`store/src/conformance/`: its groups, `Stores`, `Report`, skipping), `store-embedded/src/` (connection pragmas,
    `secure_delete`, the index's `MmapDirectory` and `INDEX_WRITER_LOCK`, memory ranking, the `record_keys` table of
    one key per record, the `records` and `versions` columns), `src/store/mod.rs` (the concrete embedded types the
    `store-*` built-ins need), `src/shared/` (`NonceStore` at `nonces.rs:50`, `LimitStore` at `limits.rs:50` and
    `PersonStore` at `person.rs:253`, all `pub(crate)`; the person store's `verifier` and `nonce` columns,
    `person.rs:470-471`, in plain text with `secure_delete`), `src/events/` (no trait: `ProjectingSink` over AFD's
    `FileJournalSink`, `projector.rs:66-74, 312-323`; the `Event` shape with `actor` and the `provenance` envelope,
    `event.rs:110-140`), `src/workspace/layout.rs` (`state/spaces/<space>/events.jsonl` and `cursors/`),
    `plugins/knowledge/src/graph.rs:125, 142, 204` and `traverse.rs:22` (node ids `doc:`, `heading:`, `dir:`,
    `tag:`, `owner:` and `symbol:` carry text), `schemas/workspace-config.v5.json` (the reserved `backend` key); AFD's
    `JournalEntry` (`packages/rust/src/journal.rs:126-163`: the validated `input` and the whole `result`).
  - Read in the documents: the architecture's phase 6 row, components, versioning and glossary; the proposal's
    pluggable backends and scale profiles; D10, D26, D28, D29, D51 to D55, D66, D70 to D73, D81 to D83, D89 and D123
    to D130; the phase 5 specification's sections 8.4, 8.5, 9, 10.2, 12, 13, 15 and its follow-ups; STATUS.md's
    follow-ups.
  - External facts are dated in the [trajectory refresh](#trajectory-refresh). Library facts come from the crates'
    published sources and crates.io (tantivy 0.27.0's `Directory`, `tokio-postgres` 0.7.18's `ChannelBinding`,
    `tokio-postgres-rustls` 0.14.0's `tls-server-end-point`, `cryptoki` 0.12.1). No Rust was built or run.
- **Done:** nothing; this is the specification.
- **Not done:** the owner's answers, and every step of section 11.
- **Follow-ups:** the [table at the end](#follow-ups).

### Review response

The independent review of 2026-11-09 raised six blockers, sixteen improvements and five nits. Each was checked
against the code and the documents; all hold. The coordinator's decision on each is recorded with the finding.

| # | Finding | Verdict | Change made |
| --- | --- | --- | --- |
| B1 | Shared host state leaks: journal entries hold the input and the whole result, events carry the provenance envelope, the person store keeps the PKCE verifier and nonce in plain text | Holds (`journal.rs:126-163`, `event.rs:110-140`, `person.rs:152-155, 470-471`) | Every host-state value is sealed under the state backend's epochs except sequence numbers, trace ids and times; the space and every other key column is a lookup value (5.3). `canary.rs` and exit point 6 cover the state backend. The person row's erasure bound replaces `secure_delete` (5.3) |
| B2 | Identifiers and memory's search tables expose content and allow frequency and chosen-word analysis | Holds (`graph.rs:125, 142, 204`, `traverse.rs:22`) | Document ids, record ids, graph node ids and edge endpoints, memory scope values and tags, access tokens and owners are sealed with lookup values; ordering happens in the host (4.6). Memory lookup values are keyed per access partition, so a writer can correlate only with records it can already read; prefixes are capped at six characters and padded; positions are not stored, and phrases are confirmed in the host (4.9). Section 4.12 lists what the database still sees; 8.2 states each residual leak |
| B3 | Erasure with a PostgreSQL keyring was not bounded: dead rows, WAL, archives, replicas and backups keep "destroyed" epoch keys under a root key that never rotates | Holds | **D149, decided under the delegation, revisable by the owner:** `shared` requires a key service that can truly destroy keys, behind a `KeyService` trait; the keyring holds only wrapped material the key service must unwrap; epoch keys are wrapped under per-period keys that the key service destroys. Root-key rotation and a compromise procedure (4.7). The horizon is stated as the window plus the key service's own deletion delay; single machines keep local key files with their horizon stated (4.7) |
| B4 | Rotation raced and broke search while it ran | Holds | The epoch switches on the `head` row under its lock first; every row records its epoch; lookups are computed under every epoch with live rows; an epoch is destroyed only after a check finds no row referencing it, else refused; a `rotation` suite group; rotation lands in steps 4b and 4e, before certification (4.7, 3.3, 11) |
| B5 | Retiring a moved source was unsafe | Holds | A durable retired mark in the source's own store, checked inside every read and write transaction; then keys destroyed, then data deleted; every open rolls an unfinished retire forward; the target's content digest and `check` re-run before retiring; a suite case with another process's handle; the crash order and a revert after a crash (6.3) |
| B6 | The plan's dependencies and 3.1's code claim were wrong | Holds | Steps 2 and 4e wait for phase 5's steps 8 to 11, chosen over a later suite version so that certification covers the whole contract once (11). PostgreSQL tables and suite cases for `erase_targets`, `erase_requests` and the erasure outbox, committed with key destruction (4.9, 3.3). 3.1 corrected: only three `src/shared/` traits exist; the journal is a JSON Lines file with no trait |
| I1 | Collation, non-ASCII ids, `jsonb`, times | Holds | Every key column is `bytea` or `text COLLATE "C"`; the differential corpus adds non-ASCII and mixed-case ids; nothing is `jsonb`; times are `bigint` milliseconds (4.3) |
| I2 | PostgreSQL side channels | Holds | Stated in 8.2 (timeouts, pool waits, cross-owner work, plan choices); phase 5's prefix-timing follow-up carried here; SQL work per query bounded; generic plans forced (4.9, 4.2) |
| I3 | Certification under the admin role; unsigned reports | Holds | Certification runs as the runtime role; the admin role only creates and drops the scratch schema. Reports and move records carry an HMAC under a keyring key (4.11, 6.3) |
| I4 | Archive memory keys and restore across backends; the plaintext claim | Holds | Each archived memory record names its wrapped key and epoch, or the key file's store; restore rewraps in process across kinds; exit point 4 reads memory after the restore; the claim is qualified: archives and the index cache hold document plaintext (2.2, 6.2, 4.8) |
| I5 | `meta` writes, tantivy's `.managed.json` and `META_LOCK`, large segments | Holds | Compare-and-set on `generation`; every `atomic_write` file under it; `META_LOCK` in process; segments in sealed 1 MiB chunks (4.8) |
| I6 | Tables without an access set; a missing setting; name resolution | Holds | A policy per table (4.5); `current_setting(…, true)` so a missing `umbel.reader` admits nothing; every name schema-qualified and `search_path` set to `pg_catalog, pg_temp` (4.2) |
| I7 | Keyring separation proven once, under the admin role | Holds | Re-checked at every start under the runtime role, since PostgreSQL 18 grants `pg_control_system()` to everyone; what equal and different identifiers prove is stated (4.7) |
| I8 | Schema names and catalog statistics | Holds | Schema names are an HMAC under a deployment key; `pg_class` and `pg_stat_*` row counts are stated; one database per deployment is recommended and checked (4.3, 4.12) |
| I9 | Associated data; tag filters | Holds | Every plain column is mirrored inside the row's seal and compared on read, so expiry, validity, invalidation, owner and access are bound; tags have lookup values and filter in the query (4.6, 4.9) |
| I10 | The unit of a memory key | Holds | One key per record, as D82 and the embedded `record_keys` table; every version of a record is sealed under it; forget, rotation and archives follow it (4.6, 4.9, 2.2) |
| I11 | Backups by freeze; forget during a freeze | Holds | Backups read one snapshot on both backends; a forget during a move's freeze is `SPACE_MOVING`; a freeze ends after `max_freeze_minutes` by aborting the move (6.2, 6.3) |
| I12 | The journal head row's throughput | Holds | Stated (every command, reads included, appends under one row lock) and measured by exit point 5 against a floor (5.3, 9) |
| I13 | Exit point 5 and `hosted_leaks.rs` | Holds | Exit point 5 re-runs it with the spaces on PostgreSQL (9) |
| I14 | Step 4a too large | Holds | Split into 4a (connections, roles, migration), 4b (encryption, keyring, rotation) and 4c (documents and graph) (11) |
| I15 | The rotation lease and pooling proxies | Holds | The lease holds a dedicated connection; the doctor's `backends.pooling` fails a transaction-pooling proxy (4.2, 4.7) |
| I16 | Root-key procedures; destroyed epoch keys in memory | Holds | Both procedures written; instances drop a destroyed epoch key within 30 seconds (4.7) |
| N1 | How a call from a runtime worker is refused | Holds | A thread-local guard set by the host's blocking helper; `Handle::try_current()` also succeeds in `spawn_blocking`, so it cannot decide alone (3.1) |
| N2 | Exit point 3's files | Holds | `events.jsonl` and `cursors/` stay (9) |
| N3 | Where the moved marker lives on PostgreSQL | Holds | The source schema's `head` row and the `umbel_meta` registry (2.3, 6.3) |
| N4 | The group count | Holds | The draft's groups were 32, not 31; with `rotation` and `memory_erase` the suite has 34 (2.4, 3.3) |
| N5 | `pg_catalog` first | Holds | `search_path` is `pg_catalog, pg_temp` (4.2) |

The owner questions were rewritten: question 2 states what a shared deployment costs people, with no argument from
saving work; the draft's question 3 is settled (D146); the recovery-window question states each option's true
horizon.

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
| A prefix's expansion time grows with hidden terms | Phase 5 follow-up of 2026-11-08 | 4.8, 8.2 |

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
| 16. Spaces do not mix | Each space has its own PostgreSQL schema, keys, epochs and lookup keys; a move moves one space (4.3, 6.3) |

Decisions served: D10, D26, D28, D29, D36, D51, D53, D54, D55, D66, D70, D71, D72, D73, D82, D83, D85, D89, D103,
D118, D120, D123, D125, D126, D127 and D128, and the new D131 to D149. O1 and O4 are untouched.

## Trajectory refresh

Refreshed 2026-11-09 against primary sources. **Nothing found changes the architecture.** Two findings set dates in
the design: PostgreSQL 14 reaches its end of life on 2026-11-12, and PostgreSQL 19 is planned for 2026-11-19. Three
set the key service's design: every key service checked delays real destruction, and one documents that its own
backups keep deleted material until the deployer deletes them.

| Row | Checked against | Finding on 2026-11-09 | Effect on phase 6 |
| --- | --- | --- | --- |
| PostgreSQL releases (new W19) | [Versioning policy](https://www.postgresql.org/support/versioning/); [PostgreSQL 19 RC 1](https://www.postgresql.org/about/news/postgresql-19-rc-1-released-3409/) | Supported: 18 (18.6; end of life 2030-11-14), 17 (17.11; 2029-11-08), 16 (16.15; 2028-11-09), 15 (15.19; 2027-11-11), 14 (14.24; 2026-11-12). 19 RC 1 on 2026-10-15; general availability planned 2026-11-19 | Supported servers are 16, 17 and 18, and 19 once released and green in CI (4.1). The doctor fails a major past its end of life (D135) |
| Sequences | [Sequence functions, PostgreSQL 18](https://www.postgresql.org/docs/18/functions-sequence.html) | `nextval` is never rolled back; "sequence objects cannot be used to obtain 'gapless' sequences". The page says nothing about commit order | Revisions and event sequence numbers come from a locked head row, never a sequence (4.4) |
| Row security | [Row security policies, PostgreSQL 18](https://www.postgresql.org/docs/18/ddl-rowsecurity.html) | Superusers and `BYPASSRLS` roles "always bypass" it; table owners do unless the table has `FORCE ROW LEVEL SECURITY`; only the owner may change policies | The runtime role is neither superuser, `BYPASSRLS` nor owner, and every table forces row security (4.5) |
| Cluster identity | [System information functions, PostgreSQL 18](https://www.postgresql.org/docs/18/functions-info.html); [`system_functions.sql`, `REL_18_STABLE`](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/catalog/system_functions.sql) | `pg_control_system()` returns `system_identifier`, cluster-wide. The documentation states no privilege; the catalog script revokes `EXECUTE` from `PUBLIC` on many functions but on no `pg_control_*` function, so every role may call it by default | The keyring's separation is re-checked at every start under the runtime role (4.7) |
| Search path | [CREATE FUNCTION, PostgreSQL 18](https://www.postgresql.org/docs/18/sql-createfunction.html), "Writing SECURITY DEFINER functions safely" | The temporary schema "is searched first by default, and is normally writable by anyone"; writing `pg_temp` last forces it to be searched last | `search_path` is `pg_catalog, pg_temp`, and every Umbel name is schema-qualified (4.2) |
| Limits | [Appendix K, PostgreSQL 18](https://www.postgresql.org/docs/18/limits.html) | Field size 1 GB; identifier length 63 bytes | Index segments in 1 MiB chunks (4.8); fixed-length schema names (4.3) |
| Pooling proxies | [PgBouncer features](https://www.pgbouncer.org/features.html) (newest release listed 1.26.1) | Transaction pooling "Never" supports `SET`/`RESET` or session-level advisory locks | The doctor's `backends.pooling` fails a transaction-pooling proxy; settings are `SET LOCAL` (4.2) |
| Connections | [libpq connection parameters, PostgreSQL 18](https://www.postgresql.org/docs/18/libpq-connect.html); `tokio-postgres` 0.7.18 (MSRV 1.85, MIT or Apache-2.0) source, `src/config.rs`; `tokio-postgres-rustls` 0.14.0 source, `src/lib.rs` | libpq: `verify-full` checks the certificate's issuer and that the host name matches; channel binding "is only supported over SSL connections with PostgreSQL 11 or later servers using the SCRAM authentication method", and `require` refuses a connection without it. `tokio-postgres` takes `channel_binding` (`disable`, `prefer`, `require`); `tokio-postgres-rustls` 0.14.0 supplies `tls-server-end-point` from the server certificate, with an `aws_lc_rs` feature. `deadpool-postgres` 0.14.2 (MSRV 1.85) and `postgres-types` 0.2.14 | 4.2 |
| AWS KMS (new W20) | [Deleting an AWS KMS key](https://docs.aws.amazon.com/kms/latest/developerguide/deleting-keys.html) | A waiting period of 7 to 30 days, default 30, "might be up to 24 hours longer"; a key pending deletion cannot be used; after it, deletion is "irreversible". For keys in a CloudHSM key store, "AWS KMS does not delete the key material from cluster backups" | A key service's deletion delay is part of the erasure horizon, and its own backups count (4.7, D149) |
| Google Cloud KMS (W20) | [Destroy and restore key versions](https://docs.cloud.google.com/kms/docs/destroy-restore) | Scheduled for destruction 30 days by default; "key material can remain in Google systems for up to 45 days from the scheduled destruction time", including "data center backups" | As above |
| Azure Key Vault (W20) | [Soft-delete overview](https://learn.microsoft.com/en-us/azure/key-vault/general/soft-delete-overview) (updated 2026-06-12) | A deleted key stays recoverable for 7 to 90 days, default 90; with purge protection it cannot be purged before then | As above |
| HashiCorp Vault transit (W20) | [Transit API](https://developer.hashicorp.com/vault/api-docs/secret/transit) | Deleting a key needs `deletion_allowed`; afterwards "it will no longer be possible to decrypt any data encrypted with the named key"; `exportable` "cannot be disabled" once set | A key service whose keys were ever exportable is refused (4.7) |
| PKCS#11 | `cryptoki` 0.12.1 on crates.io (2026-09-16, Apache-2.0, MSRV 1.77); SoftHSM 2.7.0 (Homebrew, BSD-2-Clause) and 2.6.1 (Ubuntu 24.04) | A maintained Rust binding; a software token packaged on both CI platforms | The first `KeyService` implementation is `pkcs11`, tested against SoftHSM (4.7, D147) |
| tantivy | 0.27.0 source, `src/directory/directory.rs` | `Directory` is a public trait: `get_file_handle`, `delete`, `exists`, `open_write`, `atomic_read`, `atomic_write`, `sync_directory`, `acquire_lock` and `watch`; `meta.json` and `.managed.json` are written through `atomic_write`; `INDEX_WRITER_LOCK` and `META_LOCK` through `acquire_lock` | The index on PostgreSQL is the same tantivy code over a new `Directory` (4.8) |
| W1, W2, W5, W7 | Not re-checked | Phase 5's refresh of 2026-11-03 stands; no row bears on storage | None |

Rows W3, W4, W6 and W8 to W18 were not re-checked.

## Terms

These enter the [glossary](../../architecture.md#12-glossary).

| Term | Meaning |
| --- | --- |
| Backend kind | The implementation behind the store traits: `embedded` or `postgres`. A host build feature, never a plugin (D132) |
| Backend instance | One `[backends.<id>]` entry of `umbel.toml`: a kind and its connection settings. Spaces name it in `spaces.<id>.backend` |
| Certification | A passing run of the whole conformance suite, with no failure and no skip, against one backend kind, recorded with what it was run against (3.4, 4.11) |
| Sealed value | A value encrypted by the host before it reaches PostgreSQL; the database never sees the plaintext (4.6) |
| Lookup value | An HMAC-SHA256 of a sealed value under a lookup key, stored beside it so that equality and membership can be tested in SQL without the plaintext (4.6) |
| Data key | The random key that seals one stored row version (knowledge, records, graph, index files, host state) or one memory record (D82), kept wrapped beside it (4.6) |
| Epoch | A period, one day by default, during which one space key wraps a space's new data keys and derives its new lookup values (4.7) |
| Access partition | The set of memory records with the same access set; memory's lookup values are keyed per partition (4.9) |
| Recovery window | How long a retired epoch's key is kept before it is destroyed (owner question 3) |
| Key service | A KMS or HSM, behind the `KeyService` trait, that holds keys it never exports and can destroy them (4.7, D149) |
| Period key | A key-service key that wraps every epoch key of one backend instance and one period; destroying it ends that period's recoverability (4.7) |
| Root key | The key-service key that wraps the keyring's long-lived entries; rotated by `store-root-rotate` (4.7) |
| Erasure horizon | How long anything deleted or forgotten in a PostgreSQL space can still be recovered from any copy, stated per space (4.7) |
| Keyring | The store of wrapped epoch keys and host keys, kept apart from the content database (4.7) |
| Space archive | The portable, backend-neutral copy of one space that `store-backup` writes and `store-restore` and `store-move` read (6.1) |
| Move | Copying a space from one backend instance to another, verifying it, switching by configuration and retiring the source (6.3) |
| Retired store | A space's former store after a move: marked retired, its keys destroyed and its data deleted, leaving only the mark (6.3) |
| Deployment mode | `deployment.instances`: `single` (one machine, today's) or `shared` (several machines behind one URL) (5) |
| State backend | The backend instance holding a shared deployment's host state: the journal, events, cursors, shared stores and usage (5.2) |
| Store-held collection | A collection whose documents live in the document store as their source, imported from and exported to files only at the CLI (5.8) |

## 1. Crate layout

```text
endpoints/umbel/
├── store/src/                    # umbel-store: store traits version 3
│   ├── admin.rs                  # StoreAdmin: show, check, digest, snapshot, freeze, export, import, retire, keys
│   ├── backend.rs                # Backend, BackendDescriptor
│   ├── blocking.rs               # the blocking-call guard (3.1)
│   ├── archive.rs                # space archive version 1 items, the archive and content digests
│   ├── state/                    # host-state traits: events, cursors, nonces, limits, person, tasks, usage, keys
│   └── conformance/              # + exactness, memory_exactness, memory_erase, admin, archive, instances, crash,
│                                 #   rotation and state_* groups
├── store-lexical/                # umbel-store-lexical (new): the tantivy index of phase 2 and phase 5 step 7,
│                                 #   moved from store-embedded and made generic over tantivy's Directory
├── store-embedded/src/           # implements version 3 and the state traits (moved from src/shared/ and src/events/)
├── store-postgres/               # umbel-store-postgres (new)
│   └── src/
│       ├── connect.rs            # TLS, SCRAM with channel binding, the two roles, the pool, session settings
│       ├── migrate.rs            # the versioned database schema; the admin role only
│       ├── seal.rs               # sealed values, data keys, lookup values, row mirrors, padding
│       ├── keyring.rs            # epochs, rotation, the keyring, the root key
│       ├── keyservice/           # KeyService: pkcs11, and test (testkit feature only)
│       ├── documents.rs, graph.rs, admin.rs
│       ├── index/                # PgDirectory, the local cache
│       ├── memory/               # memory records, partition-keyed lookups, BM25 per reader filter, erase
│       └── state/                # host state for shared deployments
├── testkit-pg/                   # umbel-testkit-pg (new): throwaway PostgreSQL clusters and a SoftHSM token
├── src/backends/                 # configuration version 6, opening per space, certification records, doctor
├── src/archive/                  # store-backup (archive), store-restore
├── src/moves/                    # store-move, store-move-abort, the switch and the retire step
├── src/shared/                   # selects the files and SQLite stores or the PostgreSQL ones (5)
├── plugins/sources-filesystem/   # store-held collections: sources-import, sources-export
├── plugins/knowledge/            # applying a proposal to a store-held collection
└── schemas/                      # + the shapes of section 2
```

| Crate | Depends on | New third-party dependencies | Notes |
| --- | --- | --- | --- |
| `umbel-store` | as before | none | Traits version 3, the suite version 3 and the state traits. Still builds for `wasm32-wasip2` without the `conformance` feature |
| `umbel-store-lexical` | `umbel-store`, tantivy 0.27 (moved) | none | The index code of `store-embedded/src/index/`, unchanged in behaviour, generic over `Directory` (D139) |
| `umbel-store-embedded` | + `umbel-store-lexical` | none | Implements version 3; the SQLite stores of `src/shared/` and the journal and event files of `src/events/` move here behind the new traits |
| `umbel-store-postgres` | `umbel-store`, `umbel-store-lexical` | `tokio-postgres` 0.7.18, `tokio-postgres-rustls` 0.14.0 (feature `aws_lc_rs`), `deadpool-postgres` 0.14.2, `cryptoki` 0.12.1; `chacha20poly1305`, `hmac`, `hkdf` and `zeroize` already in the lock | Behind the host's new `store-postgres` feature, off by default until phase 7 decides the distributed binaries |
| `umbel-testkit-pg` | `rcgen` (dev, in the lock) | none | Test-only, `publish = false`, quarantined with no route; runs the system's `initdb`, `postgres` and `softhsm2-util`, never downloads a server (D147) |
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
recovery_days = 30                    # owner question 3; 1 to 90

[keyring]
kind = "postgres"                     # or "files" (state/keys/keyring/), allowed only when instances = "single"
host = "keys.internal.example"
port = 5432
database = "umbel_keys"
user = "umbel_keys_runtime"
password_file = "/run/secrets/umbel-keys"
admin_user = "umbel_keys_admin"
admin_password_file = "/run/secrets/umbel-keys-admin"

[keyring.key_service]                 # required when kind = "postgres" (D149)
kind = "pkcs11"
module = "/usr/lib/pkcs11/vendor-pkcs11.so"   # the key service vendor's PKCS#11 library
token_label = "umbel"
pin_file = "/run/secrets/umbel-hsm-pin"                      # or pin_env
deletion_delay_days = 0               # required: the service's own delay, backups included, before destroyed
                                      #   material is gone from it (4.7); 0 to 365

[deployment]
instances = "shared"                  # "single" (default) or "shared"
state = "main"                        # the state backend; required when shared, a postgres instance

[store]
max_freeze_minutes = 60               # 5 to 1440 (6.3)

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
- Every secret is `*_file` or `*_env`, under phase 5 section 10.4's rules; a literal `password` or `pin` key does not
  exist.
- `ca_file` and `module` follow phase 5's file-path rules (inside the workspace or absolute, readable).
- `pool_size` 1 to 256; `statement_timeout_ms` 1 000 to 600 000; `max_freeze_minutes` 5 to 1 440.
- `rotate_hours` 1 to 168; `recovery_days` 1 to 90; `deletion_delay_days` 0 to 365 and required, with no default, so
  the horizon shown is the deployer's statement and never Umbel's guess.
- `[keyring]` is required when any space or the state names a `postgres` instance. `kind = "files"` is refused when
  `instances = "shared"` (D149). `kind = "postgres"` requires `[keyring.key_service]`.
- `key_service.kind` is `pkcs11`. The `test` kind exists only in builds with the `testkit` feature and is refused
  elsewhere.
- `instances = "shared"` needs `state`, naming a `postgres` instance; every space's `backend` naming a `postgres`
  instance (D145); every collection `source = "store"` (D146); `[keyring]` of kind `postgres`; and `auth.mode`
  `oauth` or `gateway`, since the HTTP token of mode `none` is a single machine's loopback secret.
- `spaces.<id>.backend` names a declared instance or `embedded`.
- `source = "store"` is admitted for `markdown` and `code` collections; `root` stays required, as the default folder
  for `sources-import` and `sources-export` (5.8).

Versions 1 to 5 read as 6 with every space `embedded`, no backends, no keyring, `instances = "single"`,
`max_freeze_minutes = 60` and every collection `source = "files"`. `umbel init` writes version 6.

### 2.2 Space archive, version 1 (D143)

A directory: `manifest.json` (`space-archive.v1.json`) and one JSON Lines file per kind of item
(`archive-item.v1.json`, one schema with a `kind` discriminator). `store-backup` writes it mode 0600 in a 0700
directory.

```json
{ "version": 1, "space": "alpha", "createdAt": "2026-11-09T10:00:00.000Z",
  "source": { "kind": "postgres", "storeTraits": 3, "storeId": "…" },
  "heads": { "documents": 4120, "memory": 812 },
  "files": [ { "name": "documents.jsonl", "items": 1180, "sha256": "…" }, … ],
  "memoryKeys": { "kind": "epochs", "epochs": [ 41, 42 ] },
  "digest": "sha256:…", "keys": "excluded" }
```

| File | Items |
| --- | --- |
| `documents.jsonl` | Each stored document at its current revision: id, bytes (base64url), metadata, envelope, access, sensitivity, flags. **Plaintext** |
| `records.jsonl` | Each plugin record: namespace, kind, id, body, envelope, version. **Plaintext** |
| `changes.jsonl` | Every change, in revision order, with its revision, kind, target, hash (or none where forgotten), trace id and time |
| `graph.jsonl` | Each origin document's contribution and the applied revision |
| `memory.jsonl` | Each memory record version with its metadata and its **sealed** fields as stored, under the record's own key (D82), with the associated-data version each was sealed under (4.9); tombstones; destroyed markers; capture prefixes erased |
| `memory-keys.jsonl` | One line per memory record: its id and **where its key is**, never the key: `{ "kind": "wrapped", "epoch": 42, "wrapped": "…" }` (the record key wrapped under that epoch's key) from a PostgreSQL source, or `{ "kind": "keyfile", "storeId": "…" }` (the embedded key file with that `store_id`) from an embedded one |
| `memory-changes.jsonl` | Every memory change in revision order |

The index is never archived: it is derived, and rebuilt from the documents on restore. `keys` is always `"excluded"`
in a backup (D82): a backup's memory opens only with key material the deployer keeps apart, the keyring holding
`memoryKeys.epochs` or the embedded key file named by `storeId`. A move carries keys on a separate channel (6.3) and
never writes them into an archive. `digest` is section 6.1's archive digest.

**An archive holds knowledge in plaintext.** Documents, records and the graph are as readable in an archive as in the
embedded store; only memory stays sealed. An archive of a PostgreSQL space therefore does not keep 4.6's guarantee,
and the deployer must protect it as they protect the embedded store's files. `store-backup` says so in its result,
and 8.2 lists it.

### 2.3 Move record, version 1 (D144)

```json
{ "version": 1, "id": "mv-…", "space": "alpha",
  "from": { "backend": "embedded", "storeId": "…" }, "to": { "backend": "main", "storeId": "…" },
  "digest": "sha256:…", "heads": { "documents": 4120, "memory": 812 },
  "state": "verified", "frozenAt": "…", "copiedAt": "…", "switchedAt": null, "retiredAt": null,
  "mac": "hmac-sha256:…" }
```

`state` is `copying`, `verified`, `switched`, `retired` or `aborted`. `mac` is an HMAC-SHA256 over the canonical JSON
of every other field, under the keyring's `attest` key (4.7); a record whose `mac` does not verify is
`STORE_CORRUPT`.

Where it is kept:
- **In the target**, from `copying` on: `umbel_meta.moves` on PostgreSQL, the store's `meta` table on embedded.
- **In the source**, from the freeze on: the freeze mark names the move id and the target backend; from the retire
  step on, the retired mark does too (6.3). On PostgreSQL both marks are the source schema's `head` row and its
  `umbel_meta.spaces` registry row, which survive the data's deletion. On embedded they are the documents and memory
  databases' `meta` rows and, after the data is deleted, `state/spaces/<space>/moved.json`, which holds the record.

### 2.4 Certification report, version 1 (D134, D141)

```json
{ "version": 1, "backend": { "kind": "postgres", "crate": "umbel-store-postgres", "crateVersion": "0.1.0",
    "schema": 1 },
  "server": { "product": "PostgreSQL", "major": 18, "version": "18.6", "systemIdentifier": "…" },
  "role": "runtime",
  "suite": { "storeTraits": 3, "suiteVersion": 3, "groups": 34, "cases": 448 },
  "outcome": "passed", "failures": [], "skipped": [], "at": "2026-11-09T10:00:00.000Z",
  "mac": "hmac-sha256:…" }
```

`outcome` is `passed` only when `failures` and `skipped` are both empty. `role` is the role the suite ran as, always
`runtime` for a report the host accepts. `cases` is the count at the time of writing and is checked against the
suite's own count, never typed by hand. `mac` is as in 2.3; a report whose `mac` does not verify is not a report.

## 3. Store traits, version 3 (D133, D134)

### 3.1 The boundary

**What exists today.** `umbel-store` has `DocumentStore`, `SearchIndex`, `IndexWriterSession`, `GraphStore` and
`MemoryStore`. The host's own state has three traits, all `pub(crate)` in `src/shared/`: `NonceStore`, `LimitStore` and
`PersonStore`, each with a SQLite implementation. The journal is AFD's `FileJournalSink`, a JSON Lines file, wrapped by
`src/events/`'s `ProjectingSink`, which appends each event to a per-space JSON Lines file; there is no trait for
either, nor for cursors, which are files under `state/spaces/<space>/cursors/`. Phase 5's steps 8 and 9 add the task
and usage stores, and its steps 10 and 11 add `erase_targets`, the `erase_requests` table and the erasure outbox; none
is merged.

**What does not change.** The five store traits keep every method, signature and meaning of version 2 as phase 5 step
7 left them, and as phase 5's steps 10 and 11 extend `MemoryStore`. In particular these stay as they are: the reader
filter applied inside each query before ordering and limits; derivation reads only inside a store write;
`last_readable_document`; recall's BM25 per reader filter and its 50 000-match refusal; the memory query syntax parsed
in `umbel-store`. The traits stay **synchronous**, per space, `Send + Sync` and object-safe, and are always called from
a blocking thread (D51).

**How a call from the runtime is refused.** A backend whose client is asynchronous drives it on its own runtime and
blocks the calling thread. Blocking a runtime worker thread would stall every request on it, so such a call is
refused with `StoreError::Invalid("store called from an async task")`, never a panic and never a stall.
`tokio::runtime::Handle::try_current()` cannot decide it alone: it succeeds on a worker thread and also inside
`spawn_blocking`, where blocking is correct. So `umbel_store::blocking` holds a thread-local guard that the host's one
helper for store calls, `store_blocking(f)`, sets around `f` inside `spawn_blocking`. A backend call proceeds when
`try_current()` fails (a plain thread: the CLI, a conformance child, a test) or when the guard is set; otherwise it is
refused. `store/tests/conformance_v3.rs` calls a store from an `async` task and expects `Invalid`.

**What version 3 adds:**

| Item | Purpose |
| --- | --- |
| `Backend` | Opens a space's stores (`open_space`, `provision_space`), describes itself (`descriptor`: kind, crate version, schema version, server product and major, whether it keeps epochs), and lists the spaces it holds. The host holds one per backend instance |
| `StoreAdmin` (per space) | Backend-neutral maintenance, replacing the host's reach into the embedded types (`src/store/mod.rs`): `show` (operator statistics), `check` (integrity: every seal opens, every mirror matches, revisions are dense and ordered, the change log matches the documents, applied revisions are not past the head), `digest` (the archive and content digests, 6.1), `snapshot` (one consistent read view for `export` and `digest`), `freeze` and `thaw` (6.3), `export` and `import` (streams of archive items; import only into an empty space), `retire` and `retire_resume` (6.3), `keys` (`KeyAdmin`: the epoch state, `rotate_step`, `destroy_epoch`; a backend without epochs answers `Unsupported`) |
| `umbel_store::state` | Host-state traits. Three move from `src/shared/` unchanged in meaning: `NonceStore`, `LimitStore`, `PersonStore`. New: `EventLog` (the journal append and its events in one unit, reads, heads; replaces `ProjectingSink`'s files), `CursorStore`, `TaskStore` and `UsageStore` (phase 5's steps 8 and 9 shapes, made traits here), and `KeyStore` (host keys). The embedded implementations move to `umbel-store-embedded`, unchanged in behaviour: the same files, locks and formats (5.2) |
| `MemoryStore` additions | Phase 5's `erase_targets(space, principal, ids?)`, the erase request rows and the erasure outbox, as phase 5's steps 10 and 11 define them, become trait methods with suite cases (`memory_erase`, 3.3) |
| `StoreError` variants | `Unavailable { retryable }` (a lost connection; the request fails closed), `Frozen` (`SPACE_MOVING`), `Retired` (`SPACE_MOVED`), `SchemaMismatch { found, supported }`, `EpochMissing`, `EpochInUse` |
| `KeyStatus` | Gains an `epochs` form (the current epoch, the live epochs, the oldest kept, whether rotation is overdue or in progress) beside the key file's |

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
- every count, total and head shown to a plugin computed under the reader filter;
- every ordering of ids by byte order of their UTF-8, never by a collation.

The rule the suite applies to each: **adding, changing or deleting rows a reader cannot read changes no byte of that
reader's results**, scores and positions included.

### 3.3 The conformance suite, version 3

| Group | Holds | New |
| --- | --- | --- |
| `documents`, `records`, `changes`, `envelope`, `access`, `graph`, `index`, `concurrency`, `durability` | Phase 2's, as they are, with non-ASCII and mixed-case ids added to the fixtures | |
| The nine `memory_*` groups | Phase 3's and phase 5 step 7's, as they are | |
| `memory_erase` | Phase 5's 8.4 and 8.5 at the store: `erase_targets` selects by owner through equivalents whatever the access set; an erase request holds only the plan's hash and expires; the erasure outbox row commits in the same transaction as the key destruction, or neither does (a child killed between them) | Yes |
| `exactness` | 3.2 for knowledge, as differential probes: each read run before and after unreadable documents are written, indexed, changed and deleted, compared byte for byte; moved here from `store-embedded/tests/partitioned_stats.rs` | Yes |
| `memory_exactness` | 3.2 for memory, the same way | Yes |
| `admin` | `check` finds each seeded fault (a damaged row, a mirror that disagrees with its column, a revision gap, an applied revision past the head) and passes a clean store; `digest` is stable across reopen and differs after any write; `freeze` refuses writes, forget included, with `Frozen` and keeps reads; `retire` leaves nothing readable; **a second process holding an open handle** answers `Retired` to its next read and its next write; a retire killed after the mark is finished by the next open | Yes |
| `archive` | `export` then `import` into a fresh store gives equal archive and content digests and byte-identical reads for three readers; `export` under concurrent writes gives one snapshot's items; import refuses a non-empty space, a damaged file (its `sha256`) and a digest mismatch, writing nothing | Yes |
| `instances` | The `concurrency` cases with each writer holding its own backend handle (its own process, connections and caches): readers on one handle see another's commits on their next call, revisions stay dense and in commit order, and one index writer at a time | Yes |
| `crash` | A writer child killed (`SIGKILL`) inside a document write, a graph apply, an index commit, a memory write, a forget and an erase: on reopen nothing is partial, and a forget's key destruction is either complete or rolled forward by the next writer (D83) | Yes |
| `rotation` | For a backend with epochs: reads for three readers stay byte-identical while a rotation is in progress (interleaved batch by batch); writes during a rotation land in the new epoch; a rotation killed part-way is finished by the next rotation; destroying an epoch a row still references is refused with `EpochInUse`; after destruction nothing references it. For a backend without epochs: `keys` answers `Unsupported`, which the group checks and counts as passed | Yes |
| `state_events`, `state_cursors`, `state_nonces`, `state_limits`, `state_person`, `state_tasks`, `state_usage`, `state_keys` | The state traits: dense event sequences per space with the journal and events appended together or not at all; one `consume` winning among processes; limit counters exact under contention; person and task rows' expiry and leases; usage append and owner-only reads; keys created once under a race | Yes |

That is 34 groups: nine of phase 2, nine of memory, and sixteen new.

**Certification (D134).** A backend kind is certified for store traits version 3 when `run_all` reports **no
failure and no skip**. A backend without an index or a memory store cannot be certified, and the host refuses to
open a space on an uncertified kind (4.11). `Report::assert_certified` is new beside `assert_passed`, and writes
section 2.4's report.

**Across backends.** `store-postgres/tests/differential.rs` (not part of the suite, because it needs two backends)
loads one seeded corpus of 2 000 documents and 5 000 memory records into both backends and runs 5 000 seeded queries
for each of five readers: knowledge search ids, scores to four places and snippets, and memory recall orders, must be
**identical**. The corpus includes non-ASCII ids (`Ünïcödé`, CJK and combining sequences) and ids differing only in
case, so an ordering by any collation instead of bytes fails it. It runs once with a rotation in progress on the
PostgreSQL side. The knowledge eval gate runs on both and must give equal reports. This holds because the index is
the same tantivy code (4.8) and memory matching uses `umbel-store`'s FTS5-equivalent tokenizer (4.9).

### 3.4 The embedded reference backend, certified

Step 2 implements version 3 in `umbel-store-embedded` and certifies it on Linux and macOS: `StoreAdmin` over the
existing files, the state stores moved from `src/shared/` and `src/events/`, and the new groups. Its physical
`store-backup` directories of phases 2 and 3 stay readable by `store-restore` (6.2). Nothing it does today changes.

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
- **Two roles.** The *runtime* role serves requests and runs certification. The *admin* role is used only by CLI
  commands that change the database's schema: `store-init`, `store-move` provisioning a new space, and
  `store-certify`'s creation and removal of its scratch schema. `serve` never holds it. The doctor fails when the
  runtime role is a superuser, has `BYPASSRLS`, has `CREATEROLE` or `CREATEDB`, owns any Umbel table, or may `CREATE`
  in an Umbel schema.
- **Session settings.** Each connection sets `application_name = 'umbel'`, `statement_timeout`,
  `lock_timeout`, `idle_in_transaction_session_timeout` and `plan_cache_mode = force_generic_plan` (8.2). Each
  transaction sets, with `SET LOCAL`: `search_path = pg_catalog, pg_temp`, with `pg_catalog` named first and the
  temporary schema named last so it is searched last; its access mode (`umbel.mode`, 4.5); and its reader
  (`umbel.reader`). `default_transaction_read_only = on` for read paths.
- **Names.** Every Umbel table, function and operator in SQL is schema-qualified (`us_….documents`,
  `OPERATOR(pg_catalog.&&)`), so no name depends on `search_path`. The only identifiers built into SQL are schema
  names from 4.3's mapping, which are base32 of an HMAC and never the space id.
- **SQL.** Every value is a bound parameter.
- **Pooling.** Rotation leases and the index writer hold session-level advisory locks on a dedicated connection,
  outside the pool (4.7, 4.8). A transaction-pooling proxy between Umbel and the server would release those locks and
  `SET` values between transactions, so the doctor's `backends.pooling` check sets a random session value on one
  connection, reads it back in a second transaction, and takes and re-checks a session advisory lock; it fails when
  either did not survive.
- **Failures.** A lost or refused connection is `Unavailable`; a pool wait past `store.lock_timeout_ms` is `Busy`.
  Either way the request fails closed and nothing is cached as an answer.

### 4.3 Layout (D136)

- `umbel_meta` holds the schema version, the space registry (lookup value of the space id, schema name, its retired
  or frozen mark), certification reports, move records, epoch metadata (never keys) and the index's file registry.
- Each space has its own schema: `us_` followed by the first 26 base32 characters of HMAC-SHA256 under the
  deployment's naming key (4.7, a keyring entry) over the space id. It is fixed-length, fits the 63-byte identifier
  limit, and does not reveal the space id to anyone without the keyring.
- A space's tables: `head` (one row: document revision, memory revision, frozen and retired marks, the current epoch,
  the live epochs); `documents`; `records`; `changes`; `graph_nodes`, `graph_edges`, `graph_applied`; `index_meta`,
  `index_atomic`, `index_files`, `index_chunks`; `memory_records`, `memory_versions`, `memory_keys`,
  `memory_partitions`, `memory_terms`, `memory_changes`, `memory_markers`, `memory_erase_requests`,
  `memory_erasure_outbox`.
- **Key columns** are `bytea` (lookup values, sealed values) or `text COLLATE "C"` (namespaces, kinds); integers for
  revisions and epochs. No column is `jsonb`: envelopes and metadata are canonical JSON inside seals. Times are
  `bigint` milliseconds since the epoch. Nothing is ordered by a collation (3.2).
- **One database per deployment** is recommended: `pg_class` and the statistics views show every role each schema's
  tables, their row estimates and sizes (4.12). The doctor's `backends.database` warns when the database holds
  schemas that are not Umbel's.
- Several backend instances may share one database; spaces never share a schema.

### 4.4 Transactions and revisions (D136)

- **Writes serialise per space on the `head` row.** Every write transaction begins with `SELECT … FROM head FOR
  UPDATE`, then takes the next revision from it. Revisions are therefore dense and in commit order, so a reader
  paging `changes` after a revision can never miss a change that commits later with a lower number. A sequence is
  never used for a revision (trajectory refresh).
- The memory store has its own revision on the same row, under the same lock; a document write and a memory write
  are never one transaction.
- **Reads that take several statements** (a page and its count, a recall's matches and statistics, an export) run in
  one `REPEATABLE READ READ ONLY` transaction, so they see one snapshot.
- Lock order is `head`, then rows in id-lookup order; nothing else locks, so writers cannot deadlock. A rotation batch
  takes the same locks in the same order (4.7).
- Compare-and-set (`Expect`) is checked inside the locked transaction, after opening the current seal (4.6).
- Uniqueness of an id is checked by the host inside the locked transaction, against the id's lookup value under every
  live epoch (4.7), because one id has different lookup values in different epochs.
- Advisory locks are used only for the index writer (4.8) and the rotation lease (4.7), keyed by a fixed namespace and
  the schema name.

### 4.5 Access inside the query, and row security behind it (D136)

- Access sets are `bytea[]` columns of lookup values (4.6) with GIN indexes; the reader's tokens, as lookup values
  under every live epoch, are a bound `bytea[]` parameter, and every read's `WHERE` holds `access && $reader` (and,
  for edges, both endpoints' and the origin's).
- **Defence in depth:** every table has row security enabled and forced. Each transaction declares its mode with
  `SET LOCAL umbel.mode` and, for reads, `umbel.reader`, from the same filter it binds into the query. Every policy
  reads them with `current_setting(name, true)`, which is `NULL` when unset, so a transaction that declared nothing
  sees no row.

| Table | Policy admits a row when |
| --- | --- |
| `documents`, `records`, `changes`, `graph_nodes`, `graph_edges`, `memory_records`, `memory_versions`, `memory_partitions`, `memory_terms`, `memory_changes` | `access && current_setting('umbel.reader', true)::bytea[]`, or `umbel.mode` is `derivation`, `admin`, `rotation` or `erase` |
| `memory_keys` | as above, through the record's access set, which the row carries |
| `head`, `graph_applied`, `index_meta`, `index_atomic`, `index_files`, `index_chunks` | `umbel.mode` is any declared mode (these hold no per-row access; every reader of the space needs them) |
| `memory_markers`, `memory_erase_requests`, `memory_erasure_outbox` | `umbel.mode` is `derivation`, `admin` or `erase` |

- A derivation transaction is opened only inside a store write, as the host allows today (D54); `erase` only by
  phase 5's `erase_targets` and the erase itself; `admin` only by `StoreAdmin`; `rotation` only by `KeyAdmin`. A
  query that forgot its filter therefore still returns only readable rows. This guards against Umbel's own bugs, not
  against a compromised host, which holds the role's credentials.
- `tests/rls.rs` runs a deliberately unfiltered `SELECT` on every table under each conformance reader, and under no
  declared mode, and must see only readable rows, and none respectively.

### 4.6 Sealing: the database never sees content (D137)

**Every content-bearing value, and every identifier that carries text, is sealed by the host before it reaches
PostgreSQL.** The database, its write-ahead log, its replicas, its backups and its operators see what section 4.12
lists, and no content.

| Sealed, with a lookup value where SQL must find or filter by it | Sealed only | Plain |
| --- | --- | --- |
| Document ids (collection paths), record ids, change targets; graph node ids (`doc:`, `heading:`, `dir:`, `tag:`, `owner:`, `symbol:`) and edge endpoints and origins; access tokens; owners and principals; memory scope values (`project`, `agent_id`, `agent`, `session`, `capture_key`) and `tags`; memory content hashes; the space id | Document bytes, frontmatter, title; record bodies; envelopes whole; every content hash not looked up; graph node labels and edge attributes; index files; memory `subject` and `text`; memory invalidation reasons; every mirror (below) | Revisions and versions, epochs, times (`bigint` milliseconds), collection and type names, plugin namespaces and kinds, record and change kinds, edge kinds, memory class, status and lifecycle flags, sensitivity, padded sizes, token counts, trace ids |

- **Data keys.** Each stored row version of knowledge, records, graph and index files gets a fresh random 256-bit key
  from the operating system; each **memory record gets one key for all its versions**, as D82 decided and as the
  embedded `record_keys` table holds. Values are sealed with XChaCha20-Poly1305 (`chacha20poly1305`, as D82) under
  the data key, with a random 192-bit nonce. The data key is stored in the row (`memory_keys` for memory), wrapped
  under the space's epoch key with the space, table, row identity and epoch as associated data, and deleted with the
  row version or, for memory, by forget.
- **Lookup values** are HMAC-SHA256 under a lookup key derived (HKDF-SHA256) from the epoch key: one per epoch for
  knowledge, graph and records; one per epoch **and access partition** for memory (4.9). Each row records the epoch
  its lookup values were computed under. Queries bind the lookup value of each wanted id or token under every live
  epoch (4.7).
- **Ordering happens in the host.** No order over a sealed value is possible in SQL. A listing ordered by id reads
  the readable rows' sealed ids under the reader filter, opens them and sorts by UTF-8 bytes, then pages; it caches the
  sorted id list per (space, document revision, reader filter, live epochs) in the instance's memory, for at most 60
  seconds. `show` reports the cache's size.
- **Every plain column is bound to its row.** Each row's seal contains a mirror: the canonical JSON of the row's plain
  and lookup-bearing columns as plaintext (its owner, access tokens, sensitivity, expiry, validity and recorded
  times, invalidation status, flags, revision or version, and for memory its scope values and tags). A read opens the
  seal, recomputes each lookup value from the mirror under the row's epoch, and compares every column with the
  mirror. Any difference is `STORE_CORRUPT`: the read fails closed and `store.check` reports it. A database that
  widens an access set, revives an expired or invalidated record, changes an owner, moves a value to another row or
  space, or swaps two rows' keys yields a row that does not open or does not match. A write that changes a plain
  column re-seals the mirror (memory: under the same record key). The database can withhold or roll back rows
  (availability), but it cannot read content or widen who reads it.
- **Associated data** of every seal is the space id, table, row identity (the plaintext id inside the seal, and the
  version or revision) and the associated-data version (4.9).
- **Padding.** Content values are padded to the next multiple of 256 bytes before sealing; identifiers and other
  short values to the next multiple of 64 bytes, so lengths reveal only those buckets.
- **What it costs in function, stated:** a deployer cannot read or report on content or identifiers with SQL tools;
  content is reached only through commands, under the reader filter, as principle 10 intends.

### 4.7 Epochs, the keyring and the erasure horizon (D138, D149, owner question 3)

PostgreSQL cannot erase bytes: a deleted or updated row stays in dead tuples until vacuumed, in the write-ahead log
until recycled, and in archives, replicas and backups for as long as they are kept. SQLite's `secure_delete`, which
phases 3 and 4 rely on (D73, phase 4 section 9.1), has no equivalent. Sealing turns erasure into key destruction,
and this section bounds every place a key can survive.

#### The key hierarchy

| Key | Wraps or derives | Where it lives | Destroyed |
| --- | --- | --- | --- |
| Data key | One row version's values, or one memory record's | In the row, wrapped under an epoch key | With the row version; for memory, by forget (D82) |
| Epoch key | The space's data keys written or rewrapped during the epoch; its lookup keys (HKDF) | The keyring, wrapped under a period key (`postgres` keyring) or as a file (`files` keyring) | After the recovery window, once no row references it |
| Period key | Every epoch key of one backend instance and one period of `rotate_hours` | The key service, never exportable | When every epoch key it wraps is destroyed |
| Root key | The keyring's long-lived entries: host keys (5.5), the naming key (4.3), the `attest` key (2.3), the state lookup key (5.3) | The key service, never exportable | Retired by `store-root-rotate` |

#### The key service (D149)

`shared` deployments, and any deployment with a `postgres` keyring, need a key service that can truly destroy keys:

```rust
pub trait KeyService: Send + Sync {
    fn descriptor(&self) -> KeyServiceDescriptor;          // kind, product, deletion_delay_days as configured
    fn create(&self, label: &str) -> Result<KeyHandle, KeyServiceError>;
    fn wrap(&self, key: &KeyHandle, secret: &[u8; 32], aad: &[u8]) -> Result<Vec<u8>, KeyServiceError>;
    fn unwrap(&self, key: &KeyHandle, wrapped: &[u8], aad: &[u8]) -> Result<Zeroizing<[u8; 32]>, KeyServiceError>;
    fn destroy(&self, key: &KeyHandle) -> Result<Destroyed, KeyServiceError>;
    fn state(&self, key: &KeyHandle) -> Result<KeyState, KeyServiceError>;   // active, destroying, destroyed
}
```

- **`pkcs11`** is the implementation in this phase, through `cryptoki`. `create` makes an AES-256 token object with
  `CKA_TOKEN`, `CKA_SENSITIVE` and `CKA_EXTRACTABLE = false`; `wrap` and `unwrap` are `CKM_AES_GCM` encryption with
  the associated data; `destroy` is `C_DestroyObject`. `serve` refuses a key whose attributes show it was ever
  extractable (`CKA_NEVER_EXTRACTABLE` false). A PKCS#11 library reaches hardware security modules and the cloud
  services that ship one; which vendors' libraries meet these calls is a follow-up, checked per vendor before the
  doctor admits it.
- **`test`** is an in-process service compiled only with the `testkit` feature. SoftHSM, which CI uses through
  `pkcs11`, keeps its token as files, so the doctor's `keyring.key_service` fails a SoftHSM token outside `testkit`
  builds: a software token on the instance's disk destroys no better than the `files` keyring.
- **The keyring holds only wrapped material.** Its database stores each epoch key wrapped under its period key, and
  each long-lived entry wrapped under the root key, with associated data naming the entry. A stolen keyring database,
  any of its backups or its dead rows open nothing without the key service.
- **Instances hold unwrapped keys in memory only**, zeroized when dropped. Each instance reads the keyring's
  `generation` at most every 30 seconds, and before every rotation step; a changed generation makes it drop every
  epoch key the keyring no longer lists as live and re-read the rest. A destroyed epoch key therefore leaves every
  instance's memory within 30 seconds of the destruction's commit. The key service also refuses to unwrap a destroyed
  key, so no instance can load it again.

#### Epochs and rotation

- **Each space has one current epoch.** Every `rotate_hours` (default 24) a new epoch begins. A period key is created
  for the backend instance's new period on first use, under the rotation lease.
- **Rotation, step by step,** each step its own transaction, so a rotation killed at any point is finished by the next
  one:
  1. *Create.* A fresh epoch key `E+1` is written to the keyring, wrapped under the period key, state `created`.
  2. *Switch.* In the space, under the `head` row's lock: `current_epoch = E+1`, and `E+1` is added to `live_epochs`.
     From this commit on, every write seals and wraps under `E+1` and computes lookups under `E+1`. The keyring entry
     becomes `current`.
  3. *Rewrap in batches.* Under the `head` lock, at most 256 rows still on epoch `E`, locked in id-lookup order: each
     data key is unwrapped under `E` and rewrapped under `E+1`; each lookup value is recomputed under `E+1` from the
     opened mirror; the row's epoch becomes `E+1`. The `head` lock is held for one batch only, so writes wait at most
     one batch. Index files and their chunks, memory keys and memory terms (4.9) are batches like any row.
  4. *Retire.* When no row on `E` remains, `E` leaves `live_epochs` (under the `head` lock) and its keyring entry
     becomes `retired` with its retirement time.
- **Reads during a rotation** read `live_epochs` in their own snapshot and bind lookup values under each, so every row
  matches under the epoch it is on; reads are byte-identical before, during and after (suite `rotation`).
- **Who rotates.** `serve` rotates when an epoch is due, in batches between requests, under a session-level advisory
  lock held on a dedicated connection outside the pool (the lease), so one instance does it; `store-rekey` (CLI,
  operator) does the same on demand, and `store-rekey --now` starts a new epoch at once. Rotation is never in a
  request's path. The doctor's `store.epochs` warns when rotation is more than one epoch late and fails at four.
- **Destroying an epoch.** After `recovery_days`, a retired epoch is destroyed by the lease holder: in one transaction
  per space it counts every row on that epoch across every table; any count above zero refuses the destruction with
  `EpochInUse` and the doctor fails `store.epochs`. When every space's count is zero the keyring entry is deleted,
  the keyring's `generation` is bumped, and, once no live entry is wrapped under it, the period key is destroyed in
  the key service. A destruction killed part-way is resumed by the next lease holder from the keyring's state.

#### What a delete, forget or replace does

The row version, or the memory record's key, is deleted at once, so nothing reaches it through Umbel. Copies outside
the live database (dead tuples, the write-ahead log, archives, replicas, backups) hold that key only wrapped under the
epoch key of the time; that epoch key is held only wrapped under its period key; and once the period key is
destroyed in the key service, no copy of either database, from any time, can be opened by anyone.

#### The erasure horizon, stated honestly

| Keyring | The horizon of a delete or forget | What Umbel cannot bound |
| --- | --- | --- |
| `postgres`, with a key service (required for `shared`) | Up to one epoch (until the next rotation rewraps the live rows away from the epoch the deleted key's copies are under), **plus the recovery window, plus the key service's own deletion delay** (`deletion_delay_days`, which the deployer takes from their service: for example AWS KMS's 7 to 30 days plus up to 24 hours, or Google Cloud KMS's up to 45 days from the scheduled destruction, or a hardware module's backup retention) | Copies of plaintext made outside the database: archives (2.2), the index cache (4.8), what agents copied elsewhere; and the key service's own honesty about its deletion |
| `files` (single machine only) | Up to one epoch, plus the recovery window, **plus the life of any file-level copy of `state/keys/`** (filesystem snapshots, machine backups), which Umbel cannot see | As above, and every file-level copy of the keyring |

`workspace-show` and `store-show` state the horizon per space in these terms, from the configuration, with the
`files` row's unbounded part named, never a single number of days. No document, result or message says that anything
is "beyond recovery after N days" without the key service's delay and the stated exceptions.

#### The keyring's separation

- **The keyring must be on another cluster** than every content database, so its backups and operators can be kept
  apart. At every start, `serve` and the doctor's `keyring.separate` read `pg_control_system()`'s
  `system_identifier` from the keyring and from every content database, **under the runtime role**, which PostgreSQL
  18 lets every role call by default; `store-init` records the values. Start fails when they are equal, or when
  either cannot be read (a server that revoked the function), naming the grant to restore.
- **What the check proves.** Equal identifiers prove the two are one cluster or a physical copy of one (a replica, a
  restored base backup), which is refused. Different identifiers prove only that they are different clusters by
  lineage. They do not prove that the clusters' backups, disks or operators are separate, which the deployer
  arranges and the documentation tells them to. A server that lies about its identity defeats the check; it is a
  check against mistakes, not against a hostile database.

#### The root key: rotation and compromise

- **`store-root-rotate`** (CLI, operator, keyring admin role): creates a new root key in the key service, rewraps
  every long-lived keyring entry under it in one keyring transaction, records the new key's handle, then destroys the
  old root key in the key service. Instances reload at their next generation check. Run yearly at least; the doctor's
  `keyring.root_age` warns at 400 days.
- **Compromise of the key service's credentials, or of a host holding unwrapped keys:**
  1. Revoke the leaked credentials in the key service; give the instances new ones.
  2. `store-root-rotate`, so the old root key is destroyed.
  3. Rotate every host key (`store-rekey --host-keys`): confirmations, cursors, relays and person decisions in flight
     become invalid and are asked for again.
  4. `store-rekey --all --now`: every space starts a new epoch under a new period key and rewraps away from the old
     ones.
  5. Decide on the old epochs: destroying them at once (`store-rekey --destroy-before <time>`) ends recoverability
     from every backup taken before; keeping them to the end of the window keeps backups usable but leaves the
     exposed keys alive for that long. The command asks the operator to name the choice; it has no default.
  6. A deployment whose `files` keyring was copied off the machine follows the same steps with the copy treated as a
     leaked credential: rekey everything and destroy the old epochs.

#### Losing the keyring

Losing the keyring or the key service's keys loses every PostgreSQL space's content, as losing `memory.keys` loses
memory today. The doctor's `keyring.backup` check reports the age of the keyring's last verified copy when the
deployer records one with `store-keyring-verify`, and warns when none is recorded.

### 4.8 The index on PostgreSQL (D139)

The index is **the same tantivy code** as the embedded backend (index schema 2, per-filter statistics, readable
prefix expansion and snippets, the total tie order), moved to `umbel-store-lexical` and made generic over tantivy's
`Directory`. The PostgreSQL backend supplies `PgDirectory`:
- **Segment files** are rows of `index_files` (name lookup value, sealed name, size, epoch, deletion time) with their
  bytes in `index_chunks`: sealed chunks of 1 MiB each, so no value approaches PostgreSQL's 1 GB field limit and no
  read holds a whole segment in one value. Segment files are immutable once written.
- **Every `atomic_write` file** (`meta.json` and `.managed.json`) is a row of `index_atomic`, sealed. A commit
  replaces them in one transaction with a compare-and-set on `index_meta.generation`: `UPDATE … SET generation =
  $g + 1 … WHERE generation = $g`; zero rows updated means another writer committed, and the session fails with
  `Busy` without writing.
- **Locks.** `INDEX_WRITER_LOCK` is a session-level advisory lock held on a dedicated connection for the writer
  session's life; waiting past `store.lock_timeout_ms` is `Busy`; one writer at a time across every machine.
  `META_LOCK` is an in-process lock only: on another machine, a reader is protected by deferred deletion.
- **Readers** keep a local cache under `state/cache/index/<backend>/<schema>/`, mode 0700: each file is fetched,
  opened, checked against its seal and written once. **Every search first reads `generation`** and reloads when it
  moved, so a commit on one machine is seen by the next search on any machine.
- **Deletion is deferred.** A file tantivy deletes is marked and purged, with its chunks and data key, after ten
  minutes, so a reader on another machine that read the previous generation can still fetch it.
- **The cache is plaintext on the instance's disk**, as the embedded index is: it holds every indexed document's
  terms and stored fields. A retired or moved space's cache is deleted; at start, a cache whose schema is no longer
  registered is removed. 4.6's claim does not cover the cache, and 8.2 says so.
- **Prefix timing (phase 5's follow-up, carried here).** A prefix's expansion walks each segment's dictionary until
  it has 256 readable terms, so its time grows with the hidden terms it passes. Cutting the walk off at a fixed count
  would let hidden terms push readable ones past the cut and change a reader's results, which 3.2 forbids. So the walk
  stays exact, the channel is stated in 8.2, and step 4d measures it on the exit's and the eval's corpora; if it is
  measurable there, step 4d adds per-filter term lists, built at index commit for each distinct reader filter seen,
  which keep results exact and make the walk's length independent of hidden terms, on both backends alike.

Ranking, snippets and every exactness property are therefore identical across backends, which `differential.rs` and
the eval gate hold (3.3).

### 4.9 Memory on PostgreSQL (D140)

- **Rows.** `memory_records` and `memory_versions` hold 4.6's sealed and plain columns; `memory_keys` holds one
  wrapped key per record. Every access, bitemporal, expiry, flag, scope and tag condition is in the matching
  statement, as D70 requires: scope values and tags by their lookup values.
- **Seals.** Every version's fields use D82's construction under the record's key. D82's associated data (space, id,
  owner, part, version) is extended by 4.6's mirror; each row records its associated-data version (1, D82's; 2,
  extended). A restored row keeps the version it was sealed under and opens with it; a move re-seals under the
  target's version.
- **Access partitions.** Records with the same access set form a partition, a row of `memory_partitions` (its id, its
  access lookup values, its epoch). Every memory lookup value (terms, prefixes, tags, scope values, the content hash) is
  an HMAC under a key derived from the epoch's lookup key and the partition's canonical access set. A query computes
  its lookup values for each partition the reader can read (read from `memory_partitions` under the reader filter, in
  the same snapshot), at most 512 partitions per statement, in as many statements as needed. **So a writer who chooses
  a word and watches the database can correlate it only with records in partitions it wrote to**, which a writer can
  only do for access sets its own records may carry; it learns nothing of records in other partitions.
- **Terms.** The memory tokenizer of `umbel-store` (FTS5's `porter unicode61 remove_diacritics 2`, ported in phase 5
  step 7) tokenizes each record version at write. `memory_terms` holds **one row per record version and column**:
  `terms bytea[]`, the lookup values of its distinct tokens, and `prefixes bytea[]`, the lookup values of each token's
  prefixes of one to six characters; both arrays are padded with random values to the next power of two of at least
  16. GIN indexes serve `&&` and `@>`. No positions are stored.
- **Matching.** The query, parsed in `umbel-store` as today, is tokenized the way FTS5 tokenizes a query. A term
  matches on `terms`; a prefix of up to six characters on `prefixes`; a longer prefix on its first six characters,
  then is confirmed in the host. Phrases match all their terms in SQL and are confirmed in the host. Confirmation opens
  the candidate's text and re-tokenizes it, which is exact: FTS5's own definitions decide. `+` and `-` as D70 defines
  them.
- **Ranking.** Phase 5 step 7's: FTS5's `bm25()` formula over the reader's statistics, then tier, recorded time and
  id. Document counts and token totals come from SQL counts of plain token counts under the reader filter; term
  frequencies from the host's re-tokenization of each readable match it ranks, which phase 5 step 7 already opens.
- **Bounded SQL work.** A recall runs at most `ceil(partitions / 512) × 3` statements, each with its candidate count
  capped at 50 001, so the refusal of phase 5 (50 000 matches) is decided without reading more; each statement is
  under `statement_timeout`.
- **Forget** deletes the record's key, versions, terms and partition reference in one transaction, writes the
  tombstone and the `Erased` change, and keeps D83's marker discipline, so an interrupted forget is rolled forward by
  the next writer. A forget during a move's freeze is `SPACE_MOVING` (6.3). The erasure horizon (4.7) bounds every
  other copy.
- **Erase (phase 5's 8.4 and 8.5).** `erase_targets` runs under `umbel.mode = erase`, selecting by the owner's lookup
  value under every live epoch and every partition, through equivalents, whatever the access set. `memory_erase_requests`
  holds phase 5's request rows (id, the space, the target's lookup value, the plan's hash, the first eraser sealed,
  times). `memory_erasure_outbox` holds phase 5's outbox rows, sealed, **inserted in the same transaction that deletes
  the record keys**; each named instance's row is marked done after its sweep commits.
- **Rotation** recomputes each version's `terms` and `prefixes` under the new epoch from the opened text (4.7, step
  3), and rewraps the record key.
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
- `store-certify --backend <id>` (CLI, operator) creates a scratch schema and grants the runtime role exactly what
  `store-init` grants on a space, **under the admin role**, then runs the whole suite **under the runtime role**, with
  writer children that re-run the CLI (`--child`), then drops the schema under the admin role. A suite that passed only
  with the admin role's rights would prove nothing about `serve`.
- It records section 2.4's report in `umbel_meta`, with its `mac` under the keyring's `attest` key, so the database's
  operator cannot write a passing report.
- A space is served on a backend instance only when a passing, verified report exists for its server's product and
  major, the crate's version and schema version, and the suite version. Otherwise every call to the space is
  `STORE_BACKEND_UNCERTIFIED` and the doctor's `backends.certified` fails, naming the command to run. A minor update of
  the server needs no new report; a major upgrade or an Umbel upgrade that changes the suite does.

### 4.12 What the database still sees

Sealing hides content and identifiers. It does not hide the shape of the data or how it is used. Anyone who can read
the content database, its log, replicas or backups learns the following, and nothing in this phase hides it:

| Seen | From | What it can tell |
| --- | --- | --- |
| That a deployment exists and how many spaces it has | Schema names in the catalog | Not the space ids (4.3) |
| Row counts and sizes per table and space | `pg_class` (`reltuples`, `relpages`), the `pg_stat_*` views, the files | How many documents, records, edges, memory records and versions each space has, and how fast they grow |
| Padded sizes of every sealed value | The columns | Each document's size within 256 bytes; each id's length within 64 |
| Token counts per memory column; padded term and prefix array sizes | `memory_versions`, `memory_terms` | Each record's length in tokens; its distinct-token count within a power of two |
| Which records share a term, within one partition and epoch | Equal lookup values in `memory_terms` | Frequency analysis inside a partition (for example, the most common lookup value is probably a common word), and which records mention the same thing. Not across partitions, and not across epochs |
| Which documents link to which, and node degrees | Lookup values of edge endpoints | The graph's structure, never its labels |
| Which records share an access set, owner, scope or tag | Equal lookup values within an epoch | Groupings, not names; a writer who controls a principal's name and can write a record for it can recognise that principal's lookup value |
| Times | Plain `bigint` columns | When each row was written, changed, valid, recorded, expired; the bitemporal history's timing |
| Revisions, versions, kinds, class, flags, sensitivity, collection and type names, namespaces | Plain columns | The space's structure and its plugins |
| Trace ids | Plain columns | Which rows one call wrote; trace ids are random and carry no content |
| Access patterns | Statement logs, `pg_stat_statements`, timing | Which rows are read when, how often, by how many queries |
| The epoch of every row | Plain column | Rotation progress |

On the state backend (5.3) the same applies, with sequence numbers, trace ids and times plain.

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
| Person decisions and logins, tasks, limit counters | `state/shared/*.sqlite3` | The state backend |
| Usage events | `state/usage/` | The state backend |
| Confirmation, approval, cursor, relay, person and limits keys | `state/keys/` | The keyring, under the root key (5.5) |
| Epoch keys | The keyring | The keyring, under period keys |
| Index cache | — (embedded indexes live with their store) | `state/cache/` (derived, per machine) |

The PostgreSQL implementations keep each trait's phase 5 semantics: `consume` is `INSERT … ON CONFLICT DO NOTHING`
answered by the affected row count; limit windows and leases are computed in SQL.

### 5.3 Host state on PostgreSQL: sealed, in one transaction

**What is sealed.** The state backend is a backend instance with its own schema (`us_` and the HMAC of the reserved
name `@state`), its own epochs, period keys and rotation, exactly as a space's (4.6, 4.7). Only these stay plain:
sequence numbers (journal and event), trace ids, and times (`bigint` milliseconds). Everything else is sealed:

| Store | Sealed | Lookup values |
| --- | --- | --- |
| Journal | The whole entry except `seq`, `traceId` and the time: command, input, actor, context digest and fields, output budget, the result with its metadata, the tape | None |
| Events | The whole event except `seq`, `journalSeq`, `traceId` and the time: command, actor, record, changes, the provenance envelope with its `sources` and `constraints`, the cursor | The space id; the event's access tokens, so `event-list` filters inside the query and row security stands behind it (4.5) |
| Cursors | The cursor's name and value | The consumer's name |
| Nonces, relay evidence, `jti`s, spent decisions | Any payload | The key |
| Person decisions and logins | Everything but times and status: the PKCE verifier, the `nonce`, the preview's hash, the declared ids, the decision | The decision and login ids, the browser hash |
| Tasks | Request, progress, result and owner | Task id, owner |
| Usage | Every field but the time | Owner |
| Limit counters | The counter's key | The counter's key |

Lookup values for keys that are random (nonces, `jti`s, decision, login and task ids) and for limit counters use the
**state lookup key**, a long-lived keyring entry under the root key, because those rows hold no content and must be
found across epochs by a value Umbel cannot recompute; `store-root-rotate` replaces it and keeps the old one until the
longest-lived row under it has expired. Every other lookup value is epoch-keyed.

**The person row's erasure bound replaces `secure_delete`.** On one machine the person store relies on SQLite's
`secure_delete` to remove a login's verifier and nonce from the file when the row is purged, one hour after expiry.
On PostgreSQL the purged row stays in dead tuples, the log and backups, sealed under its row's data key, which is
wrapped under the state backend's epoch of the time. So a purged person row is recoverable by anyone holding the
database copy, the keyring and the key service until that epoch's period key is destroyed: up to one epoch plus the
recovery window plus the key service's deletion delay after the purge. A PKCE verifier and a `nonce` are useless
once their login has expired, so what the bound protects is the record of who logged in when.

**The journal and its events in one transaction.** The host's projecting sink implements AFD's `JournalSink` over
`EventLog`. In a shared deployment, one transaction locks the journal's head row, appends the sealed journal entry
with the next journal sequence, and appends each projected event with its space's next event sequence. Sequences are
dense and in commit order (4.4). There is no `projection.pending` window, because the entry and its events commit
together; `event-rebuild` still rebuilds every stream from the journal. D66 stays as decided: a journal failure does
not change a command's result, and `store-check` reports a store change with no journal entry.

**The head row's throughput, stated.** Every command is journaled, reads included (D29), so every command of the
whole deployment takes the journal's head row lock for one short transaction. The deployment's command rate is
therefore bounded by how many such commits the state backend makes per second on one row: roughly the inverse of its
commit latency, typically hundreds to a few thousand per second, and fewer on a remote or synchronously replicated
server. Exit point 5 measures it with 64 concurrent callers over two instances and records the figure in STATUS.md;
it must reach at least 300 journaled commands per second on the CI runner, or the step stops and amends this section
(follow-up).

### 5.4 One clock for shared decisions

Every comparison that several machines must agree on (a nonce's expiry, a limit window, a task lease, a person
decision's expiry) uses the state backend's clock (`clock_timestamp()`), never the instance's. The command context's
recorded clock is unchanged for everything that is journaled. The doctor's `deployment.clock` warns when an
instance's clock differs from the database's by more than five seconds.

### 5.5 Host keys

In a shared deployment the host keys are keyring entries under the root key, created once under a race by the first
instance (an `INSERT … ON CONFLICT DO NOTHING`, then a read), and every instance holds them in memory. `state/keys/`
must not exist; the doctor's `deployment.local_state` fails when `state/keys/`, `state/shared/`,
`state/journal.jsonl` or any `state/spaces/<space>/` is present, so a machine cannot silently serve from local state.
`store-move --state` (6.4) carries a single-machine deployment's existing state into the state backend.

### 5.6 What each machine checks at start

`serve` refuses to start, naming the failing check, unless: the configuration is version 6 and loads; the state
backend and every space's backend are reachable, not behind a transaction-pooling proxy, at the supported schema
version and certified (4.11); the keyring opens through the key service and is separate (4.7, checked now, under the
runtime role); and the local state is empty (5.5). Each machine also records itself in the state backend (instance id,
binary version, configuration digest), and the doctor's `deployment.config` fails when two live instances report
different configuration digests or binary versions outside one minor release.

### 5.7 Authentication under `shared`

`auth.mode` must be `oauth` or `gateway` (2.1). Every phase 5 rule holds unchanged; only where its state lives moves.

### 5.8 Content under `shared`: store-held collections (D146)

A collection's files are the source of its documents today: `sources-sync` reads them, and applying a proposal writes
the file through `content_write` before the document. On several machines each would read and write its own copy of
the folder, and nothing in Umbel can prove that every machine sees the same folder at every moment: a machine that
sees an older copy serves stale knowledge, and a sync from it overwrites newer knowledge. **So under `shared` every
collection is store-held** (`source = "store"`). This is settled as a correctness choice under the delegation (D146),
not asked of the owner:
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
each id compared by UTF-8 bytes; changes and memory changes by revision; graph contributions by origin; memory
versions by record and version), each item serialised as canonical JSON (`umbel-store`'s `canonical_json`):
- **The archive digest** takes memory's sealed fields and `memory-keys.jsonl` as stored. It needs no key, so a backup
  and its restore into the same backend kind with the same key source are checked with it.
- **The content digest** takes memory's sealed fields as their plaintext's content hash, computed inside the store
  that holds the keys, and omits `memory-keys.jsonl`. It is equal across backends whatever their seals, and the
  plaintext never leaves the store. A move, and a restore across kinds, are checked with it.

Two stores with equal content digests answer every read identically.

### 6.2 `store-backup` and `store-restore`

- `store-backup` (CLI, operator) writes a space archive (2.2) for **every** backend kind, through `StoreAdmin::export`
  inside one `StoreAdmin::snapshot`, with no write freeze: on PostgreSQL one `REPEATABLE READ READ ONLY` transaction
  per store (documents, memory); on embedded one SQLite read transaction per database, held for the export. Each
  store's head is recorded in the manifest. Documents and memory are never one transaction (4.4), so each is
  consistent with itself, as they are in use.
- `store-restore` (CLI, operator) imports an archive into a space that is empty on its configured backend, checks
  each file's `sha256` and the archive digest, rebuilds the index and graph from the documents, and **rewraps every
  memory key in process**:

  | From \ into | Embedded | PostgreSQL |
  | --- | --- | --- |
  | Embedded (`keyfile`) | The key file with the archive's `storeId` is restored by the deployer beside the store, as today (D82) | `--keys <path>` names that key file; each record key is read from it and wrapped under the target's current epoch |
  | PostgreSQL (`wrapped`) | Each key is unwrapped under its epoch from the keyring and written to the new key file | Each key is unwrapped under its epoch and rewrapped under the target's current epoch |

  A record whose key source is absent or destroyed (a missing key file, an epoch past its window:
  `KEYRING_EPOCH_MISSING`) stays unreadable and is reported by `memory-reindex`, as D89 already handles; restore
  never invents keys. Keys never touch a temporary file. A restore across kinds is then checked by the content digest.
- `store-restore` also reads the embedded backend's physical backup directories of phases 2 and 3, into an embedded
  space only. This closes phase 2's restore follow-up.

### 6.3 `store-move`

`store-move <space> --to <backend>` (CLI, operator):
1. **Freeze.** The source's `freeze` writes a freeze mark in the source's own store (the move id, the target, the
   time) and from its commit refuses every write to the space with `SPACE_MOVING` (retryable), **forget and erase
   included**, and keeps reads. A forget refused this way is retried by its caller after the move.
2. **Copy.** It `provision_space`s the target (refusing a target that already holds the space), writes the move
   record `copying` in the target, streams `export` into `import`, and carries memory keys on a separate channel inside
   the process, rewrapped for the target as 6.2's table does; keys never touch an archive or a temporary file.
3. **Verify.** Both content digests are computed and must be equal, and the target's `check` must pass; else the
   target space is retired (below), the record is `aborted`, and the source is thawed.
4. **Record.** The move record (2.3) becomes `verified`, with its `mac`.

**A freeze has a maximum length.** When a freeze has lasted `store.max_freeze_minutes` (default 60) and the record is
not `switched`, the next open of the source or the doctor aborts the move: the target is retired, the record
`aborted`, the source thawed. `store-move` reports the freeze's length when it finishes.

**The switch is the configuration.** The deployer then sets `spaces.<space>.backend` to the target. At the next open
of the target, the host:
1. checks that the target holds a `verified` record whose `mac` verifies and whose source is still frozen for this
   move with an unchanged content digest; otherwise it refuses the space with `SPACE_BACKEND_UNSYNCED`;
2. **re-computes the target's content digest and runs its `check`**, both of which must match and pass;
3. marks the record `switched`, and only then serves the target;
4. **retires the source**, in this order, each step durable before the next:
   1. *Mark.* A retired mark (the move id and the target) is written in the source's own store, in the same place as
      the freeze mark (2.3). From its commit, every read and write on every handle to the source, in every process,
      checks the mark inside its own transaction and answers `SPACE_MOVED`. On embedded, every read and write
      transaction of the documents and memory databases reads the `meta` mark, and every `SearchIndex` read reads it
      in the documents database before touching the index; on PostgreSQL, every transaction reads the `head` row.
   2. *Destroy keys.* The source's memory keys are destroyed exactly as a forget does (D82, D83, with markers). On
      PostgreSQL the source schema's epoch keys are destroyed at once, without the recovery window, after the same
      check that no row still needs them, since the target holds the space.
   3. *Delete data.* Every table or file of the source is deleted, except the mark: on PostgreSQL the schema keeps
      only its `head` row and the `umbel_meta.spaces` row; on embedded, `state/spaces/<space>/moved.json` holds the
      record, and the store's files are removed. The index cache of the source is deleted.
   4. *Complete.* The mark records completion; the move record becomes `retired`.
5. **Every open rolls an unfinished retire forward.** An open of a source carrying a retired mark without completion
   finishes steps 2 to 4 under the source's write lock, then answers `SPACE_MOVED`. An open of a target whose record
   is `switched` but not `retired` resumes the retire of the source.

**Crash order and revert.** A crash may leave the move at any point; each case resolves to one outcome:

| Crash after | The source on its next open | The target on its next open |
| --- | --- | --- |
| Freeze, before `verified` | Frozen; reads served, writes `SPACE_MOVING` until the move finishes, is aborted, or its freeze passes `max_freeze_minutes` | Not served (`copying`): `SPACE_BACKEND_UNSYNCED` |
| `verified`, before the switch | As above | Switches on its first open (above) |
| `switched`, before the retired mark | Frozen for a move whose target is `switched`: the host checks the target's record, writes the retired mark and finishes the retire, then answers `SPACE_MOVED`. **If the target cannot be reached, the source answers every read and write `STORE_UNAVAILABLE`**: it cannot know whether the target already serves newer writes, so it serves nothing | Served; resumes the retire |
| The retired mark, at any later step | Finishes the retire; `SPACE_MOVED` | Served; resumes the retire |

So a configuration reverted to the source after a crash never serves the source once the target may have taken a
write: either the move had not switched, and the frozen source is still the truth, or it had, and the source retires.

**Why the source is not kept.** A kept copy would still hold every memory record that is forgotten after the move,
so a forget would no longer be true (D73). A move back is another move, always possible because the target holds
everything.

- **Revert is refused.** If the configuration names a retired source again, the host finds its mark and refuses the
  space with `SPACE_MOVED`, naming the move and the backend it went to.
- **Abort.** Before the switch, `store-move-abort` retires the target's copy (the same four steps) and thaws the
  source.
- **Events and cursors do not move.** They are host state (5.2): a moved space's event stream, positions and sealed
  cursors are unchanged, and so are its answers, which the exit test compares byte for byte.

### 6.4 Moving host state

`store-move --state --to <backend>` carries a single-machine deployment's journal, events, cursors, shared stores and
usage into a state backend, sealed (5.3), and its host keys into a `postgres` keyring under the root key, with the
workspace lock held throughout. It verifies counts and digests, then deletes the local copies, keys last, and any `moved.json` (each move's record is held by its target); after it,
the deployer sets `deployment.instances = "shared"`. It is the only way local state reaches a shared deployment.

## 7. Host services and commands

### 7.1 Built-ins

| Command | Exposure | Effect | Notes |
| --- | --- | --- | --- |
| `store-init` | CLI only, operator | `workspace-write` | 4.10; the admin role |
| `store-certify` | CLI only, operator | `workspace-write` | 4.11; the runtime role, the admin role for the scratch schema only |
| `store-backup` | CLI only, operator | `workspace-write` | 6.2; now an archive for every kind, from a snapshot |
| `store-restore` | CLI only, operator | `store-write` | 6.2 |
| `store-move`, `store-move-abort` | CLI only, operator | `store-write`, `workspace-write` | 6.3, 6.4 |
| `store-rekey` | CLI only, operator | `store-write` | 4.7; `--now`, `--all`, `--host-keys`, `--destroy-before` |
| `store-root-rotate` | CLI only, operator | `workspace-write` | 4.7 |
| `store-keyring-verify` | CLI only, operator | `inspect` | Opens every key of a keyring copy the deployer names, through the key service, and records the copy's age (4.7) |
| `store-show`, `store-check` | CLI only, operator, as since phase 5 step 7 | `inspect` | Now through `StoreAdmin` for every backend; `store-show` adds the backend instance, server, certification, epochs and the erasure horizon in 4.7's terms |
| `sources-import`, `sources-export` | CLI only, operator (`sources` plugin) | `store-write`; `workspace-write` | 5.8 |

None is exposed over MCP, none is a task, and each refuses any caller but the operator (`COMMAND_NOT_EXPOSED`), as
phase 5 step 7 made the existing `store-*` built-ins do. **No plugin grant is new.**

### 7.2 Doctor checks

| Check | Fails when |
| --- | --- |
| `backends.reachable` | A configured instance cannot be connected to under 4.2's rules |
| `backends.server` | A major below 16 or past its end of life |
| `backends.roles` | The runtime role is a superuser, `BYPASSRLS`, `CREATEROLE` or `CREATEDB`, owns an Umbel table or may create in an Umbel schema |
| `backends.pooling` | A session setting or advisory lock does not survive between transactions (4.2) |
| `backends.database` | Warns when the database holds schemas that are not Umbel's (4.3) |
| `backends.schema` | The schema version is not this binary's |
| `backends.certified` | No passing, verified report matches (4.11) |
| `backends.rls` | A table without forced row security or its policy |
| `keyring.opens`, `keyring.separate` | The keyring cannot be opened; the separation cannot be proven, under the runtime role (4.7) |
| `keyring.key_service` | No key service for a `postgres` keyring; a key that was ever extractable; a software token outside `testkit` builds |
| `keyring.root_age` | Warns when the root key is older than 400 days |
| `keyring.backup` | Warns when no keyring copy has been verified |
| `store.epochs` | Warns one epoch late, fails four epochs late, fails when a due destruction was refused (`EpochInUse`) |
| `deployment.local_state`, `deployment.config`, `deployment.clock` | 5.5, 5.6, 5.4 (the clock warns) |
| `spaces.moves` | A space whose configured backend does not match a switched move; a freeze past `max_freeze_minutes` (and aborts it); an unfinished retire (warns) |

### 7.3 `workspace-show`

To the operator: each space's backend instance and kind, the deployment mode, the erasure horizon per PostgreSQL
space in 4.7's terms, and the certification in force. To every other caller nothing about backends changes: backend
names, servers and epochs are operator information, and a hosted caller sees phase 5's answer.

### 7.4 Error and warning codes

| Code | When | Retryable | Details |
| --- | --- | --- | --- |
| `STORE_UNAVAILABLE` | A backend connection is lost or refused; a frozen source whose switched target cannot be reached (6.3) | Yes | `backend` (operator only) |
| `STORE_BACKEND_UNCERTIFIED` | 4.11 | No | `backend`, `command: "store-certify"` (operator only) |
| `STORE_SCHEMA_TOO_NEW`, `STORE_SCHEMA_OUTDATED` | 4.10 | No | `found`, `supported` |
| `STORE_CORRUPT` | A seal that does not open, a mirror that disagrees, a move record or report whose `mac` does not verify (4.6) | No | None to non-operators |
| `KEYRING_UNAVAILABLE` | The keyring or the key service cannot be reached | Yes | None |
| `KEYRING_EPOCH_MISSING` | A row's epoch key is destroyed or absent (a restored copy older than the window) | No | `epoch` (operator only) |
| `KEYRING_EPOCH_IN_USE` | A destruction refused because a row still references the epoch (operator commands only) | No | `epoch`, `rows` |
| `SPACE_MOVING` | A write, forget or erase during a move's freeze | Yes | None |
| `SPACE_MOVED` | A retired source | No | `to` (operator only) |
| `SPACE_BACKEND_UNSYNCED` | The configured target holds no matching verified move | No | `move` (operator only) |
| `STORE_RESTORE_INVALID` | A damaged archive file, a digest mismatch or a non-empty target | No | `file` |
| `SOURCES_STORE_HELD` | `sources-sync` on a store-held collection | No | `command: "sources-import"` |

To a non-operator, every one of these that would name a space it cannot read is phase 5 section 5.4's one answer.

## 8. Security

### 8.1 What earlier phases decided, and how it holds

| Guarantee | How phase 6 keeps it |
| --- | --- |
| **Forget** (D73, D82, D83, D103, D120) | One key per record remains the unit of erasure; a forget deletes the key, rows and terms at once and keeps D83's markers. Every copy PostgreSQL keeps is bounded by the erasure horizon (4.7), now including the keyring's copies through the key service. A move retires the source after a durable mark, keys first (6.3). Archives never hold keys (2.2). The cache holds documents only, never memory. A forget during a move's freeze waits for the move |
| **Erase and the outbox** (D118, D120) | `erase_targets`, erase requests and the outbox on PostgreSQL, the outbox committed with key destruction (4.9); suite `memory_erase` |
| **Access and exactness** (D53, D125) | The filter stays inside every query; row security stands behind it on every table; every exactness property is a suite obligation for every backend (3.2, 4.5) |
| **Phase 4's redaction** (section 9.1) | Embedded: `secure_delete`, unchanged. PostgreSQL: the redacted version's data key is deleted, and the horizon bounds every copy (4.7) |
| **Shared state** (D126) | The same traits and atomicity, on the state backend, sealed, with one clock (5.3, 5.4) |
| **Journal** (D29, D66) | Entry and events in one transaction, sealed; D66 unchanged |
| **Spaces do not mix** (D26) | A schema, epochs, data keys and lookup keys per space; associated data binds the space (4.6) |
| **Host-owned authority, attestation, person** | Untouched: no backend sets them |

### 8.2 Threats

| Threat | Control | Test |
| --- | --- | --- |
| The database's operators, a replica, a backup or a hosting provider reads content or identifiers | Every content value and text-bearing identifier sealed before it leaves the host (4.6); host state too (5.3) | `store-postgres/tests/canary.rs`: canaries in document text, ids, node ids, scope values, tags, journal inputs and results, event envelopes, actor labels, a PKCE verifier and nonce, task and usage payloads never appear in the data directory, the write-ahead log or a `pg_dump`, of the content or the state backend |
| Frequency analysis of memory terms | Partition- and epoch-keyed lookup values; padded arrays; no positions (4.9) | `canary.rs` (no plaintext), `memory_lookup.rs` (equal words in two partitions give unequal lookup values) |
| A chosen-word attack by someone who can write memory and read the database | Lookup keys per access partition: a writer correlates only within partitions it writes to (4.9) | `memory_lookup.rs` |
| A stolen database, keyring or backup, in any combination without the key service | Epoch keys only wrapped under period keys in the key service; root key there too (4.7) | `canary.rs`, `keyring.rs` |
| A forgotten memory or deleted document recovered from an old backup | Epochs, period keys destroyed after the recovery window and the service's delay (4.7) | `erasure_horizon.rs` |
| A "destroyed" key surviving in the keyring's dead rows, log or backups | The keyring holds only wrapped material; the period key is destroyed in the key service (4.7) | `erasure_horizon.rs`: an old keyring copy opens nothing after the period key's destruction |
| A root key that never changes | `store-root-rotate`; the doctor's age warning (4.7) | `keyring.rs` |
| An instance keeping a destroyed epoch key in memory | Generation checks every 30 seconds; zeroized; the key service refuses to unwrap it (4.7) | `keyring.rs` |
| A rotation that breaks search or races a write | Switch under the `head` lock first; per-row epochs; lookups under every live epoch (4.7) | Suite `rotation`; `differential.rs` during a rotation |
| An epoch destroyed while a row still needs it | The reference check; `EpochInUse` (4.7) | Suite `rotation` |
| The database widens access, revives an expired record, changes an owner, moves a row or swaps keys | The mirror in every seal and the associated data (4.6) | `tamper.rs` |
| The database serves another space's or an older row | Associated data; dense, checked revisions (`check`) | `tamper.rs` |
| A query that forgets the reader filter | Forced row security on every table; a missing setting admits nothing (4.5) | `rls.rs` |
| A connection intercepted, or a misissued server certificate | `verify-full` TLS; SCRAM with channel binding required | `connect.rs` (with testkit-pg's CA and a wrong-host certificate) |
| A runtime role with too much power | Doctor's `backends.roles`; admin role never in `serve`; certification under the runtime role | `doctor_backends.rs`, `certify.rs` |
| A forged certification report or move record | `mac` under the `attest` key (2.3, 2.4) | `certify.rs`, `moves.rs` |
| Search-path or SQL injection | Schema-qualified names; `search_path = pg_catalog, pg_temp`; bound parameters; HMAC schema names | `connect.rs`, `migrate.rs` (a `pg_temp` table shadowing a name) |
| A transaction-pooling proxy dropping locks and settings | `backends.pooling` (4.2) | `doctor_backends.rs` |
| A Postgres-compatible service that differs in semantics | Certification on the server itself (4.11) | `certify.rs` |
| A revision missed by a reader because of commit order | Head-row serialisation (4.4) | Suite `instances` |
| A machine serving from stale local state | `deployment.local_state` refuses start (5.5) | `deployment.rs` |
| Two machines with different configurations | `deployment.config` (5.6) | `deployment.rs` |
| Clock skew between machines deciding expiry | The database's clock (5.4) | Suite `state_*` with a skewed instance clock |
| A file sync overwriting a newer document | Store-held collections under `shared` (5.8) | `store_held.rs` |
| A move losing or altering data | Freeze, digest equality, `check`, then switch, then digest and `check` again (6.3) | Suite `archive`; `moves.rs` |
| A retired source still answering a process that held it open | The retired mark read inside every transaction (6.3) | Suite `admin` |
| A revert or crash serving a stale source | Marks in the source; the crash table; `STORE_UNAVAILABLE` when the target is unreachable (6.3) | `moves.rs` (a child killed at each step) |
| A kept source defeating a later forget | Retire at switch, keys first | `moves.rs` with canaries |
| Losing the keyring or the key service | Stated: it loses content, as `memory.keys` does; doctor's `keyring.backup` | `doctor_backends.rs` |
| Denial of service through the pool | Bounded pool, timeouts, phase 5's limits first | `connect.rs`, `limits.rs` |

**Residual leaks, stated.** These remain, and no test claims otherwise:
- **Shape and usage**, as section 4.12 lists: row counts and sizes per space in the catalog, padded sizes, token
  counts, term sharing inside one partition and epoch, the graph's structure, times, kinds and access patterns.
- **Archives hold knowledge in plaintext** (2.2), and **the index cache holds every indexed document's terms in
  plaintext** on each instance's disk (4.8). 4.6's guarantee covers the database, its log, replicas and backups, not
  these.
- **Timing.** A query's time depends on data it cannot read in four ways: (1) the statement timeout, where hidden rows
  push a query past it, turning a result into `STORE_UNAVAILABLE` (one bit per query; the timeout is set far above the
  measured worst case, and exit point 5 records it); (2) pool waits, which reveal other callers' load; (3) work across
  owners: knowledge's prefix walk passes hidden terms (4.8) and its statistics read
  every chunk's fast fields, while memory's partition-keyed lookups touch only readable partitions' rows, apart from
  GIN pages shared with others; (4) plan choices, where the planner's statistics over all rows could pick a different
  plan for a different hidden population, which `plan_cache_mode = force_generic_plan` reduces but does not remove.
  None changes a result's bytes; each is a timing channel to a caller who can time many queries.
- **The key service's own deletion** is trusted as its vendor documents it; Umbel cannot verify it.

Not defended, and stated: a compromised host process holds every credential and key it uses, as it does today; a
database that withholds or rolls back rows can deny service or show an older state, which `store-check` and the
revision checks detect but cannot prevent.

## 9. Exit criterion and tests

The exit criterion is met when `umbel.yml` is green on `main` with every test below, and
`first-party/tests/exit_backends.rs` passes in it against PostgreSQL 16 and 18.

**Setup:** two throwaway clusters from `umbel-testkit-pg` (a content cluster and a keyring cluster, each with TLS from a
test CA, SCRAM, a runtime and an admin role), a SoftHSM token as the key service, and `umbel-testkit-idp` as phase 5's
exit uses it.

It asserts:

1. **Certified.** `run_all` on the embedded backend and on the PostgreSQL backend: no failure, no skip, 34 groups; the
   two reports are stored. `store-certify` on the test cluster records a passing report run as the runtime role, a
   report with a changed byte does not verify, and a space on an uncertified instance answers
   `STORE_BACKEND_UNCERTIFIED`.
2. **The same answers.** `differential.rs`'s corpus gives identical knowledge and memory results on both backends,
   also during a rotation, and the eval gate gives equal reports.
3. **One space moves by configuration, another stays.** A workspace with spaces `alpha` and `beta` on `embedded`,
   with documents, proposals, memory for two principals and events.
   - A write and a forget to `alpha` during `store-move alpha --to main` are `SPACE_MOVING`.
   - After the move and the configuration change, for three readers, every knowledge and memory read, `event-list`,
     `space-list` and sealed positions on `alpha` are byte-identical to before; `beta` still answers from `embedded`.
   - Under `state/spaces/alpha/`, only `moved.json`, `events.jsonl` and `cursors/` remain; no memory canary is in any
     file under `state/`.
   - Setting `alpha` back to `embedded` is `SPACE_MOVED`; moving it back with `store-move` works.
   - A second move killed after `switched` and before the retired mark, with the configuration reverted: the source
     finishes its retire and answers `SPACE_MOVED`.
4. **Backup and restore.** `store-backup` of `alpha` on PostgreSQL restores into an empty embedded workspace, and back,
   with equal content digests; **after each restore, Ada's and Ben's memory recalls are byte-identical to before**; an
   altered archive file is `STORE_RESTORE_INVALID` and writes nothing.
5. **Several machines** (with owner question 2). Two workspace directories standing for two machines, one
   configuration, `instances = "shared"`, every collection store-held, behind phase 5's balancer in mode `oauth`:
   - phase 5's exit points 2 (results filtered, byte-identical before and after hidden writes), 5 (approval through
     the person page on one instance, retry through the other), 6 (tasks, `TASK_LOST` when an instance dies) and 7
     (usage) pass with the state in PostgreSQL;
   - **phase 5's `first-party/tests/hosted_leaks.rs` runs again with every space on PostgreSQL** and passes unchanged;
   - an approval nonce spent on one machine is refused on the other;
   - a third machine with leftover local state, or another configuration digest, or behind a transaction-pooling
     proxy, refuses to start;
   - the journal head row's throughput with 64 concurrent callers over the two instances is recorded and reaches at
     least 300 journaled commands per second (5.3).
6. **Erasure.** Ada's memory record and a document are written, and a person login completes, then a `pg_dump` of the
   content and state backends and a keyring copy are taken. The record is forgotten, the document deleted, and the
   login purged. With the test clock past one epoch and the recovery window, and the test key service's deletion
   delay passed: the old dumps with the current keyring open none of them, and **the old dumps with the old keyring
   copy open none of them either**, because the period key is destroyed. Before that point, the old dumps with the
   old keyring copy still open (the stated window). At no point does a canary (document text, ids, memory text, a
   journal input or result, an event envelope, a PKCE verifier or nonce) appear in either cluster's data directory,
   write-ahead log or a dump. A `files` keyring run shows the stated difference: an old keyring copy still opens the
   old dump.
7. **Unchanged locally.** Phase 5's exit tests pass unchanged on an all-embedded `single` workspace.

| Test file | Crate | Covers |
| --- | --- | --- |
| `store/tests/conformance_v3.rs` | store | The suite's own cases against a deliberately faulty in-memory backend: each new group detects its fault; the blocking guard (3.1) |
| `store-embedded/tests/conformance.rs` (extended) | embedded | `run_all` with `assert_certified` |
| `store-postgres/tests/conformance.rs` | postgres | `run_all` with `assert_certified`, against 16 and 18 |
| `store-postgres/tests/differential.rs` | postgres | 3.3 across backends |
| `store-postgres/tests/connect.rs`, `migrate.rs`, `rls.rs` | postgres | 4.2, 4.10, 4.5 |
| `store-postgres/tests/canary.rs`, `tamper.rs`, `keyring.rs`, `erasure_horizon.rs`, `memory_lookup.rs`, `cache.rs` | postgres | 4.6 to 4.9, 5.3 |
| `tests/config_v6.rs`, `tests/schemas.rs` (extended) | host | 2 |
| `tests/doctor_backends.rs` | host | 7.2 |
| `tests/certify.rs` | host | 4.11 |
| `tests/archive.rs`, `tests/moves.rs` | host | 6 |
| `tests/deployment.rs` | host | 5.5 to 5.7 |
| `plugins/sources-filesystem/tests/store_held.rs`, `plugins/knowledge/tests/store_held_apply.rs` | plugins | 5.8 |
| `first-party/tests/exit_backends.rs` | first-party | The exit criterion |

**CI (D147).** `umbel.yml` gains a `backends` job on Linux with PostgreSQL 16 and 18 from the PostgreSQL project's
apt repository and SoftHSM from Ubuntu's, started by `umbel-testkit-pg` from the installed binaries; no container, no
external service and no credential. The macOS daily leg runs it with Homebrew's PostgreSQL 18 and SoftHSM.
`scripts/affected/suites.mjs` gains its local entry, which needs `initdb`, `postgres` and `softhsm2-util` on the path,
and fails, never skips, without them.

## 10. Out of scope, and the seams reserved

| Out of scope | When | Seam |
| --- | --- | --- |
| A git-backed knowledge store, where a proposal becomes a pull request (the proposal's "second backend") | Its own specification, with owner question 1 | `Backend`; store-held collections' `sources-export` |
| Dedicated search engines as backends (the proposal's "beyond" profile) | When a deployment needs past one PostgreSQL index | `SearchIndex`, certification |
| Vector lanes, including `pgvector` | Optional lanes after phase 2, gated by the eval (O4) | None here |
| Native key-service adapters (cloud KMS APIs) beside `pkcs11` | When a deployer needs one whose PKCS#11 library does not meet 4.7's calls | `KeyService` |
| Sealed archives | When a deployer needs archives that keep 4.6's guarantee | Space archive version 2 |
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
| 2 | Traits version 3 and the embedded backend certified | `Backend`, `StoreAdmin`, `KeyAdmin`, the blocking guard; the state traits, the three existing ones moved from `src/shared/` and the new `EventLog`, `CursorStore`, `TaskStore`, `UsageStore` and `KeyStore` over today's files and stores; `MemoryStore`'s erase methods; `umbel-store-lexical` extracted; suite version 3 with its 34 groups and `assert_certified`; the embedded backend passing it with no skip; the host's `store-*` built-ins through `StoreAdmin` | `conformance_v3.rs`, `store-embedded/tests/conformance.rs` | L |
| 3 | Test clusters | `umbel-testkit-pg` with the SoftHSM token; the `backends` job and its `suites.mjs` entry, running only the testkit's own tests | Its own suite | M |
| 4a | PostgreSQL: connections, roles, migration | 4.1 to 4.5 and 4.10: TLS, SCRAM, the roles, the pool, session settings, `backends.pooling`; `store-init`'s schema and policies | `connect.rs`, `migrate.rs`, `rls.rs` | M |
| 4b | PostgreSQL: encryption and the keyring | 4.6 and 4.7: seals, mirrors, lookup values, padding; `KeyService` with `pkcs11` and `test`; the keyring, period and root keys, epochs, **rotation and destruction** with the lease, generation checks; the `rotation` group for the rows 4c adds | `keyring.rs`, `tamper.rs`, the `rotation` group | L |
| 4c | PostgreSQL: documents and graph | `DocumentStore`, `GraphStore`, `StoreAdmin`, with host-side ordering | The suite's document, record, change, envelope, access, graph, `admin` and `archive` groups; `canary.rs` for these tables | L |
| 4d | PostgreSQL: index | `PgDirectory`, chunks, compare-and-set, the cache; the prefix walk's timing measured (4.8) | The `index` and `exactness` groups, `cache.rs` | L |
| 4e | PostgreSQL: memory | 4.9: partitions, terms, host confirmation, ranking, forget, erase and the outbox, **memory rotation** | The `memory_*` groups, `memory_erase`, the `rotation` group for memory, `memory_lookup.rs` | L |
| 4f | PostgreSQL: certified | The `instances`, `crash` and `state_*` groups; `differential.rs`; the backend certified on 16 and 18 | `conformance.rs`, `differential.rs` | M |
| 5 | Host: backends per space | Opening spaces by configuration; `store-init`, `store-certify` with `mac`s; the doctor's backend and keyring checks; `workspace-show` and `store-show` with the horizon | `doctor_backends.rs`, `certify.rs` | M |
| 6 | Archives | `store-backup` from a snapshot for every kind; `store-restore` with key rewrapping across kinds, and phases 2 and 3's physical backups | `archive.rs` | M |
| 7 | Moves | `store-move`, `store-move-abort`, the switch, the retire step and its roll-forward, the freeze limit | `moves.rs` | M |
| 8 | Operations | The rotation scheduler in `serve`, `store-rekey`, `store-root-rotate`, `store-keyring-verify`; `erasure_horizon.rs` | `erasure_horizon.rs` | M |
| 9 | Shared deployments | 5.1 to 5.7: the state backend's sealed stores, the event log in one transaction, the host keys, the start checks, `store-move --state` | `deployment.rs`, the `state_*` groups on PostgreSQL, `canary.rs` for the state backend | L |
| 10 | Store-held collections | 5.8 in `sources` and `knowledge` | `store_held.rs`, `store_held_apply.rs` | M |
| 11 | Exit | `exit_backends.rs`; STATUS.md marks phase 6 done | The exit | L |

**Order:**
- 1 first. 3 needs nothing and may run beside 1.
- **2 needs 1 and phase 5's steps 8 to 11**, so that the task and usage stores and the erase and outbox methods are
  in store traits version 3 from the start. A later suite version for them would certify the embedded backend twice
  and leave version 3 certifying less than the host uses; waiting is the cleaner contract.
- 4a needs 2 and 3. 4b needs 4a. 4c needs 4b. 4d needs 4c. **4e needs 4c and phase 5's steps 10 and 11**, and may run
  beside 4d. 4f needs 4d and 4e.
- 5 needs 4f. 6 and 8 need 5. 7 needs 6.
- 9 needs 5. 10 needs 5.
- 11 needs every step and phase 5's exit.

Steps 9, 10 and the exit's point 5 are built only if the owner answers question 2 with "yes".

**Build cost.** One new dependency family (`tokio-postgres`, `tokio-postgres-rustls`, `deadpool-postgres`) and
`cryptoki`; TLS and the cipher are already in the lock. Share `CARGO_TARGET_DIR`, use `-p <crate>` and `-j4`, and
build only under load 20. The `backends` job needs the PostgreSQL server and SoftHSM packages, not Docker.

## 12. For the owner

Three questions change what people can do, or what phase 6 delivers. Everything else is settled in the sections above
as the strongest choice and recorded as decisions. Two of those settled decisions shape question 2's answer, and are
stated inside it so you can revisit them there: D146 (in a deployment on several servers the knowledge base lives in
the database) and D149 (such a deployment needs a key service that can truly destroy keys).

1. **Which second backend comes first** (D131; 4, 10).
   - **Recommendation: PostgreSQL now; a git-backed knowledge store later, in its own specification.**
     - Only a shared database lets several servers serve one deployment (question 2), which phase 5 left to this
       phase.
     - PostgreSQL can hold every store: knowledge, memory, history and shared state. A git repository can hold
       knowledge documents only.
     - A git-backed store changes **who approves knowledge and where**: approval would move into the git host's
       reviews, outside Umbel's verified approvals and audit. That deserves its own analysis and your decisions, not a
       corner of this phase.
   - Options:
     - (a) PostgreSQL: organisations can keep any space's knowledge, memory and history in their own database, and run
       several Umbel servers on it.
     - (b) A git-backed knowledge store: knowledge changes become pull requests that people review in their git host,
       but memory stays on one machine and servers cannot share a deployment.
     - (c) Both in this phase: both outcomes, with the git store's approval questions answered inside this
       specification.
   - **Whichever you choose, the proposal's sentence naming a git-backed store as the second backend is amended to
     match your answer**: with (a), it names PostgreSQL and keeps the git store as a later backend; with (b) or (c),
     it stays and gains what this phase delivers.

2. **Several servers behind one address in this phase** (D145; 5).
   - **Recommendation: yes.**
     - A hosted deployment on one machine stops for everyone whenever that machine restarts or fails.
     - Several servers let people keep working through one server's restart or failure, and let a deployment grow by
       adding servers.
   - **What it asks of the people who run and use such a deployment:**
     - **Every space lives in PostgreSQL.** None can stay in the embedded files on one machine.
     - **Nobody edits knowledge files directly.** People change knowledge through proposals, as today; an operator
       loads a folder into the database, or writes the knowledge out to files for git or review, at the command line.
       Editing a file on a server changes nothing by itself. This is settled (D146): with files as the source, a
       server that sees an older copy of the folder can serve stale knowledge or overwrite newer knowledge, and
       nothing in Umbel can prove that every server sees the same folder.
     - **The deployer must run a key service that can truly destroy keys** (a hardware security module, or a cloud key
       service reached through its PKCS#11 library), so that when someone forgets a memory or deletes a document, every
       copy of it, in every database backup and every copy of the keyring, becomes unreadable once the recovery
       window (question 3) and the key service's own deletion delay have passed. Without one, a copy of the keyring
       could bring forgotten things back for as long as that copy is kept. This is settled (D149).
     - A deployment on one machine is unaffected by any of this: it keeps its files, its local keys and today's
       editing.
   - Options:
     - (a) Yes: a hosted deployment can run several Umbel servers behind one address, so one server's restart or
       failure does not interrupt people, with the three requirements above.
     - (b) In a later phase: spaces can live in PostgreSQL, but each deployment still runs on one machine, and a
       restart interrupts everyone until it is back.

3. **How long deleted things stay recoverable from backups** (D138; 4.7). In PostgreSQL, Umbel encrypts everything
   under keys it replaces daily, and keeps each replaced key for a recovery window. Within the window, an operator who
   restores a database backup gets everything back, including whatever was forgotten or deleted since. Once the
   window has passed, Umbel asks the key service to destroy the key; after the key service's own deletion delay
   (which depends on the service: immediate for a hardware module that keeps no backups, a month or more for the
   cloud services checked, and longer for any service that keeps its own backups), that backup can no longer be read by anyone. On a single machine
   without a key service, the key is deleted from its file, but any copy of the machine's key folder kept elsewhere
   still opens old backups for as long as that copy exists. Deployers can choose 1 to 90 days; the question is the
   default.
   - **Recommendation: 30 days.**
     - It lets an operator recover from a disaster or corruption noticed weeks later.
     - A forgotten memory becomes unrecoverable by anyone about a month after it is forgotten, plus the key service's
       deletion delay.
   - Options:
     - (a) 30 days: a database backup up to 30 days old can be restored after a disaster; anything forgotten or
       deleted can be recovered from backups for up to about 31 days, plus the key service's deletion delay.
     - (b) 7 days: anything forgotten or deleted can be recovered from backups for up to about 8 days, plus the key
       service's deletion delay; a problem found more than a week later (corruption, a mistaken bulk change) cannot be
       undone from a backup.
     - (c) 90 days: backups up to three months old can be restored; anything forgotten or deleted can be recovered from
       them for up to about 91 days, plus the key service's deletion delay.

### Decisions made here that do not change the trust model

These are settled as technical or security-strength choices, taking the strongest option, and are decided with the
approval under the owner's 2026-10-31 delegation: D132 (backends are not plugins), D133 (traits version 3), D134
(the suite and certification), D135 (servers, connections and roles), D136 (layout, transactions, row security), D137
(sealing all content and text-bearing identifiers), D138 apart from the default window (epochs, rotation and the
keyring), D139 (the index), D140 (memory), D141 (certification on the deployer's server), D142 (configuration version
6), D143 (archives, backup and restore), D144 (moves, retiring the source), D146 (store-held collections in shared
deployments), D147 (test clusters and CI), D148 (schema versions) and D149 (the key service). D146 and D149 apply only
if question 2 is answered "yes" (D149 also to any `postgres` keyring), and the owner may revisit either when reading
question 2.

## Follow-ups

| Date | Follow-up | Owner |
| --- | --- | --- |
| 2026-11-09 | PostgreSQL 19's general availability is planned for 2026-11-19: add it to the `backends` job and the supported list once released and green | Phase 6 owning agent, step 3 |
| 2026-11-09 | `pg_control_system()` is callable by every role in PostgreSQL 18's own catalog script; whether managed services revoke it was not checked. `keyring.separate` fails closed when it is revoked, so a deployer may need to grant it | Step 5 |
| 2026-11-09 | Which vendors' PKCS#11 libraries (cloud HSMs, Google's library over Cloud KMS) support `CKM_AES_GCM` wrap with associated data, non-extractable keys and `C_DestroyObject`, and what each one's deletion delay is, so the doctor can name them; a native adapter where none does | Step 4b, then when a deployer asks |
| 2026-11-09 | Memory recall and the sealed event listing read what the caller can read with no cache (phase 5 follow-up); on PostgreSQL each recall also opens every readable match's seal and re-tokenizes it. Measure on the exit's corpus and cache per (memory head, reader, epoch) if needed | Step 4e |
| 2026-11-09 | The journal head row bounds a shared deployment's command rate (5.3). If exit point 5's figure falls short of 300 per second, or a deployer needs more, give each space its own journal head and order `event-rebuild` by event sequence; that needs a design amendment | Step 11 |
| 2026-11-09 | Sealed archives, so a PostgreSQL space's backup keeps 4.6's guarantee (section 10) | When a deployer asks |
| 2026-11-09 | Phase 5's prefix-timing follow-up (4.8): measure how a prefix's expansion time grows with hidden terms on the exit's corpus and the eval's, and add per-filter term lists if it is measurable | Step 4d |
| 2026-11-09 | The proposal names a git-backed knowledge store as the second backend; the architecture says only "a second backend". Amend the proposal's sentence once question 1 is answered, whichever the answer | Owner, with question 1 |
| 2026-11-09 | `scripts/affected/suites.mjs` needs PostgreSQL and SoftHSM binaries for the `backends` entry; `SETUP.md` lists the tooling each suite needs | Step 3 |
