# Umbel status archive: phase 3, part 1 of 2

Moved verbatim from [STATUS.md](STATUS.md) on 2026-11-23 ([#1803](https://github.com/lushly-dev/afd/issues/1803)), which is the index and the
current record. A line here keeps the wording it had when it was moved and is not updated after:
a status recorded here may have changed since, though the detail of a phase still open (its
decisions, what its exit has not proven) still applies unless the index or the phase's
specification says otherwise. A link to `#heading` in a moved line named a heading of STATUS.md as
it stood then; the heading is in this file or, through "Headings in other files" at the end, in
another archive file, which the index lists under [Archive](STATUS.md#archive). A moved line is
never edited; a change of status goes in the index.

## Phase detail

### Phase 3. Memory and context

- **State:** specification approved 2026-11-02, under the owner's 2026-10-31
  delegation, with the owner's answers of 2026-11-02 (D24), and merged in
  [#685](https://github.com/lushly-dev/afd/pull/685) as `e4c91f30`. The owner's last
  four answers (D86 to D89) follow in their own pull request. Step 1 done
  2026-11-02 in [#729](https://github.com/lushly-dev/afd/pull/729) (`ed9a8539`); step 2 done
  2026-11-03 in [#733](https://github.com/lushly-dev/afd/pull/733) (`b84e0bd5`); step 3a done
  2026-11-03 in [#736](https://github.com/lushly-dev/afd/pull/736) (`b970994e`); step 3b done
  2026-11-03 in [#737](https://github.com/lushly-dev/afd/pull/737) (`8d51ee13`); step 4 done
  2026-11-03 in [#740](https://github.com/lushly-dev/afd/pull/740) (`d945bbbf`); step 5 done
  2026-11-03 in [#742](https://github.com/lushly-dev/afd/pull/742) (`0e3a501a`); step 6 done
  2026-11-03 in [#743](https://github.com/lushly-dev/afd/pull/743) (`800856ad`); step 7a done
  2026-11-03 in [#744](https://github.com/lushly-dev/afd/pull/744) (`8f124810`); step 7b done
  2026-11-03 in [#745](https://github.com/lushly-dev/afd/pull/745) (`c8689ebc`); step 8 done
  2026-11-03 in [#746](https://github.com/lushly-dev/afd/pull/746) (`ab5b321d`); step 9 done
  2026-11-03 in [#747](https://github.com/lushly-dev/afd/pull/747) (`4e46de1b`); step 10, the exit, done
  2026-11-03 in the step 10 pull request (below). **Phase 3 is done: the exit criterion is met.**
  Written 2026-11-01 by the phase 3 owning agent, revised 2026-11-02 after an
  independent review. Last verified 2026-11-02 against `main` at `4a26cc0b`, by
  reading the code, scratch SQLite experiments and `pnpm verify`; no Rust built.
- **Key design review:** D82 to D85 had their own independent review on 2026-11-02,
  and the specification's key design was revised from it, in the same pull request.
- **Done:** [the specification](phases/3-memory-context/spec.md), in
  [#685](https://github.com/lushly-dev/afd/pull/685), with D68 to D89, W18, and
  amendments to the architecture's components, host services, interfaces, data,
  cross-cutting rules, library table, phase 5 prerequisites and glossary. The
  prerequisite security fix is done: `umbel batch` drops `request.context`
  ([#688](https://github.com/lushly-dev/afd/pull/688)).
- **Owner's decisions, 2026-11-02, final:** forget uses per-record keys in a
  separate key file (D82, D83); session start pushes `person` authority only, and
  `memory-confirm` promotes a memory (D78, D84); flagged memory is never pushed
  and is labeled on recall (D75); `memory-erase` is deferred to phase 5 (D85);
  hook capture stays, opt-in, user and assistant text only, always private (D79).
- **Owner's decisions after the key design's review, 2026-11-02, final and written in:**
  `memory-remember` prompts at the terminal before a record gets `person`, and declining
  writes nothing (D86); memory is excluded from Time Machine on macOS by default, with the
  file-copy limit stated (D87); `memory-confirm` takes the caller's own records only (D88);
  `memory-reindex` removes orphan keys only with `removeOrphans` (D89).
- **Step 1 done (2026-11-02, [#729](https://github.com/lushly-dev/afd/pull/729), `ed9a8539`), shapes and configuration:**
  - The seven schemas of section 2 with examples: `provenance-envelope.v2`, `event.v2`,
    `plugin-manifest.v3`, `workspace-config.v4`, `memory-record.v1`, `capture.v1` and
    `context-bundle.v1`.
  - Envelope version 2 in `umbel-store` (`Authority`, `Redaction`, `Confirmation`; a row is
    written back in its own version; `check` closes `authority` and bounds `redactions` and
    `constraints` in version 2) and in `src/provenance.rs` (the gate admits `redactions`,
    `constraints` and `authority` only from the closed set; a journal entry is read by its own
    version's rules; `confirmation` stays `null` until step 6 fills it).
  - Event version 2: `EVENT_VERSION = 2`, the envelope version 2 inside it, `changes.store`
    (`memory` only, read from version 2 entries), and `event-list` and the stream reading
    versions 0 to 2.
  - Manifest version 3, parsing only: `journal = { mode, keep }` on commands and pipelines,
    `authority_prompt` (at most 500 characters, needs `memory_write`), a `journal` required on
    every command and pipeline of a plugin declaring `memory` or `memory_write`, neither key on a
    component command or a mounted tool, `memory_write` refused beside a document write grant,
    `store-write` satisfied by `memory_write`. Stored on `CommandDecl` and `PipelineDecl`, not
    acted on.
  - Configuration version 4: `memory_write` in `deny` and `grants` (version 4 only), its table's
    `default_access`, `writers` and `agents_may_share` (`MemoryWritePolicy`), `principal.agent_env`
    and `store.exclude_memory_from_machine_backup` (default `true`); versions 1 to 3 read as 4;
    `umbel init` writes version 4 and `on_behalf_of = "local"`.
  - `memory` and `memory_write` in `GRANTS`, `memory_write` in `ALLOW_REQUIRED_GRANTS`, `memory`
    out of `RESERVED_GRANTS`; both in the new `PENDING_GRANTS`, so the load, `plugin-check` and
    the doctor refuse them with `PLUGIN_GRANT_UNAVAILABLE` ("arrives with phase 3 step 4") until
    step 4 wires them.
  - Versions: `PROVENANCE_VERSION = 2`, `EVENT_VERSION = 2`, `STORE_TRAITS_VERSION = 2`,
    `MANIFEST_VERSIONS = [1, 2, 3]`, `CONFIG_VERSION = 4`, and `MEMORY_VERSION`,
    `MEMORY_KEYS_VERSION`, `CAPTURE_VERSION` and `BUNDLE_VERSION`, all reported by
    `workspace-show`.
  - Tests: `tests/schemas.rs` extended, `tests/config_v4.rs` and `tests/manifest_v3.rs` (parsing)
    new; the version assertions of older tests moved to the new versions.
  - **Envelope version of documents and records, settled in the specification (section 2.1).**
    `document.v1.json` and `proposal.v1.json` nest envelope version 1 and D36 versions a nested
    shape with its parent, so document and record writes keep version 1 in phase 3; their
    `authority` is `null` either way. Memory writes and events use version 2, an event lifting a
    document's version 1 envelope with the three new fields null. `umbel-store`'s `check`
    accepts versions 1 and 2. A spec gap found by the step, closed by amendment as section 14
    allows; not a trust-model change.
- **Step 2 done (2026-11-03, [#733](https://github.com/lushly-dev/afd/pull/733), `b84e0bd5`), the memory trait and suite:**
  - `store/src/memory.rs` with `memory/instant.rs` and `memory/query.rs`: the `MemoryStore` trait and its
    types (5.2), and the memory query parser, with `+a b` compiled for FTS5; six new `StoreError` variants.
  - The nine memory conformance groups (5.5) over the 40-record fixture `store/fixtures/memory/records.json`,
    with `MemoryFactory` and the `MemoryRestore` hook; `samples.rs` builders.
  - `tests/memory_support/` (an in-memory store, correct or with one of eight faults),
    `tests/memory_suite_detects.rs` (the correct store passes every case but the multi-process one, which
    it skips; each fault fails the case that should catch it) and `tests/memory_query.rs`.
  - Four details of 5.2 and 5.5 settled in the specification's
    [Amendments from step 2](phases/3-memory-context/spec.md#amendments-from-step-2): separate
    `run_memory` entry points until 3a; `now`, the expiring-soon window and `Retention` passed in, since
    the store reads no clock or configuration; `confirm`'s two errors; `get` filtering by both instants.
  - Verified 2026-11-03 against `main` at `ed9a8539`: `cargo fmt --all --check`, clippy `-D warnings` on
    `umbel-store` (all targets and features) and `cargo test -p umbel-store --all-features` (31 tests in
    four suites) in `endpoints/umbel`.
- **Step 3a done (2026-11-03, [#736](https://github.com/lushly-dev/afd/pull/736), `b970994e`), the embedded memory store:**
  - `store-embedded/src/memory/`: `SqliteMemoryStore` over `state/spaces/<space>/store/memory.sqlite3`, a
    database of its own. Created with mode `0600` by the first write only (a read of a store not yet
    provisioned answers `NotProvisioned` and creates nothing); WAL, `synchronous=FULL`, `secure_delete=ON`,
    the lock timeout and macOS `fullfsync` set on every connection; the schema of 5.3 with an ordinary FTS5
    table, its `secure-delete` set by the `INSERT` form; `user_version = 1` and a newer one refused; a
    `store_id` written last in provisioning.
  - Every read filters by reader, intervals, expiry, flags, scope, class, tags, authority and the push rule
    inside its own statement; recall is one FTS5 statement ranked by `bm25(3, 2, 1)` at four places, then
    `recordedAt` and id, with the query compiled by `MemoryQuery::fts5`.
  - Writes: replay, erased prefixes, observe or create, supersede, and the quota inside one
    `BEGIN IMMEDIATE`; the purge before a write (at most 16) in a transaction of its own; `invalidate`
    and `confirm` closing versions; forget, sweep and `reindex`. Every erasure is followed by an FTS5
    index `rebuild` in a transaction of its own, then a `TRUNCATE` checkpoint outside any transaction.
  - The sealed columns go through one seam, `memory/seal.rs`, which stores them unsealed until 3b; until
    then `key_status` answers a matching key file, `backup` refuses, and a busy forget checkpoint answers
    `wal: Pending` with no marker to retry it.
  - The suite: `Stores` gains `memory` and `memory_restore`, `run_all` runs the memory groups, and the
    writer child writes memory records on `ENV_KIND`. New tests: `memory_conformance.rs` (the memory
    groups on the store alone: 43 pass, the backup copy case skipped), `memory_multiprocess.rs` (8),
    `memory_erasure_bytes.rs` (8) and `memory_sqlite.rs` (11), which repeats the specification's SQLite
    experiments on the bundled 3.54.1.
  - Seven details settled in the specification's
    [Amendments from step 3a](phases/3-memory-context/spec.md#amendments-from-step-3a). The experiments
    found that FTS5's `secure-delete` can leave a forgotten token **whole** in `records_fts_idx` as a page
    separator, and that `optimize` does nothing on a one-segment index. So forget, the purge before a write
    and sweep rebuild the index after the erasure commits, and no forgotten token or prefix stays on disk;
    the stated limits of 5.4 and 7.2 are unchanged. Cost: 20 to 23 ms per forget on 3000 records, 34 to
    38 ms on 10 000 (debug build, macOS, `fullfsync`). A busy rebuild answers `wal: Pending`.
  - The `knowledge` job's commands already run the new test binaries, so `umbel.yml` changed only in a
    comment, and `scripts/affected/suites.mjs` not at all.
- **Step 3b, sealing and the key file, done 2026-11-03 in [#737](https://github.com/lushly-dev/afd/pull/737) (`8d51ee13`):**
  - `chacha20poly1305` 0.11.0 (`default-features = false`, `alloc`, `getrandom`, `zeroize`; adds `aead`,
    `cipher`, `inout`, `poly1305` and `universal-hash` to the lock) and `libc` 0.2.191 as a macOS-only
    dependency. The lock also re-resolved `getrandom` 0.3.4 to 0.4.3 for `afd`, the host and `tempfile`,
    and `windows-sys` 0.59 to 0.61.2 in seven places; `afd` and the host accept both `getrandom` versions.
  - `memory/seal.rs`: XChaCha20-Poly1305 under each record's own 32-byte key, a 24-byte nonce per seal,
    blob `0x01 ‖ nonce ‖ ciphertext and tag`, the associated data of 5.4; keys, nonces and the store id
    from the operating system; 3a's unsealed form is gone, and every `sealed` column still goes through it.
  - `memory/keys.rs`: `memory.keys` (rollback journal, `secure_delete=ON`, `synchronous=EXTRA`, `UMBK`,
    mode `0600`), created through a temporary file and a rename at provisioning or adopted from a process
    that died before its `store_id` committed; destroyed markers with their kinds; lookups in one
    `SELECT`; settle; orphan removal.
  - Forget in 5.4's order with the erasure point in the key file, a `wal: Pending` answer after it,
    purges with kind `purge`, roll-forward at the start of every writer (never a read), which repeats the
    index rebuild and the checkpoint before settling; every crash point of 7.4 and `UMBEL_TEST_FAIL_AT`
    under a new `testkit` feature; every missing-key error; `reindex` dropping marked rows and counting
    orphans, removing them only with `removeOrphans`; `backup` through `ATTACH`; the rebuild on open of a
    restored copy; `key_status`; `memory_restore` in the tests, so the erasure group's copy case runs and
    nothing in the suite is skipped.
  - `memory/exclusion.rs`: the Time Machine attribute through `libc`, the crate's only `unsafe` code
    (its `unsafe_code` lint is `deny`, as `sdk`'s is), set at provisioning and on a writer's open, removed
    with the setting off; `SqliteMemoryStore::with_machine_backup_exclusion` and
    `is_excluded_from_machine_backup` for the host and doctor of step 4.
  - **Cost, `release` profile, development Mac, `fullfsync` on:** about 20 ms per write of one record (two
    durable commits: the key file's, then the memory database's), 1.3 ms per recall of 10 or 50 hits on
    1000 records and 3.2 to 3.4 ms on 3000, 37 µs per `get`, and 43 to 53 ms per forget on 3000 records
    (the index rebuild about 9 ms of it).
  - New tests: `memory_seal.rs` (5), `memory_keyfile.rs` (20, with two child-process helpers),
    `memory_backup.rs` (8), `memory_machine_backup.rs` (5 on macOS, 1 elsewhere); `memory_erasure_bytes.rs`
    grew to 11 with markers, retries, destroyed keys and `memory-reindex`; `memory_conformance.rs` now passes
    all 44 memory cases and `conformance.rs` skips nothing.
  - Ten details settled in the specification's
    [Amendments from step 3b](phases/3-memory-context/spec.md#amendments-from-step-3b), none changing
    access, authority, forget's guarantees or the trust model.
  - `umbel.yml`'s `knowledge` job already runs these binaries, and its daily macOS leg runs
    `memory_machine_backup.rs`; only its comment changed. Verified locally on macOS only: `cargo fmt --all
    --check`, clippy `-D warnings` on the store crates (all targets and features) and on the workspace
    without `umbel-store-embedded`, and `cargo test -p umbel-store -p umbel-store-embedded --all-features`.
- **Step 4, host services and the journal digest, done 2026-11-03 in [#740](https://github.com/lushly-dev/afd/pull/740) (`d945bbbf`):**
  - **The grants.** `memory` and `memory_write` are available to compiled plugins (`PENDING_GRANTS` is
    empty; components and mounts still get `PLUGIN_GRANT_UNAVAILABLE`, naming world 1.1.0).
    `src/plugins/memory_services.rs` serves section 6: reads under the caller's reader filter, with
    `memory_head` the highest readable revision and `memory_key_file` the file's state alone; writes under
    the `allow` list, with the host filling identity and authority (3.3), setting the access set from
    `share` and the grant's policy (3.2, a capture always private), unioning `umbel-scan`'s findings into
    `flags`, capping the quota and the TTL, and checking 6.3's authority and ownership for invalidate,
    supersede, confirm and forget. The host's `store-embedded` feature now enables `umbel-scan`. A memory
    read opens only the memory store, so it creates no file.
  - **SDK.** `HostServices`, `Cx` and `SpaceCx` gain the sixteen memory methods (defaulting to
    `NotGranted`), with `MemoryPath`, `MemoryWriteRequest` and `LeftOutQuery`; `HostError` gains
    `QuotaExceeded`, `NotProvisioned`, `KeysMissing`, `KeysMismatch`, `KeyAbsent` and `SealInvalid`.
  - **Ledger and gate.** Memory revisions are recorded apart and stamped `changes` with `store: "memory"`;
    a successful call of a plugin holding `memory_write` that wrote none is marked `dev.umbel/no-change`,
    and the event stamp then makes no event; such a plugin's event has `sources`, `contentHash`,
    `derivedFrom`, `constraints` and `generated` nulled.
  - **Digest journaling** (`src/host/digest.rs`): the recorder's `with_redact` reduces the entry of every
    command declared `digest` and every pipeline with a digest step, on every route, stamping
    `dev.umbel/replay: "recorded"` itself; a pipeline passing a digest step's output to a plain step is
    `PLUGIN_MANIFEST_INVALID` at seal, and a pipeline inherits its steps' `authority_prompt`s in step order.
  - **Authority at the CLI** (`src/authority.rs`, `src/cli/`): `dev.umbel/human-present` only for a person
    at a terminal (stdin and stderr terminals, no `@-`, no `--yes` or `--approve`, no agent variable from
    the built-in three or `principal.agent_env`); the `authority_prompt` asked only then, after any
    `confirm_prompt` and whatever `mcp.confirmations` says, a yes setting both marks, a no
    `CONFIRMATION_DECLINED` with nothing written or journaled. `@-` reads one JSON object from stdin, up to
    16 MiB (`INPUT_TOO_LARGE`), and a `require-human` command refuses it. `UMBEL_TEST_CLOCK` and
    `UMBEL_TEST_HUMAN_PRESENT` exist only under `testkit`.
  - **Stores and doctor.** `store-show` gains `memory`; `store-check` checks the memory store and its key
    file (integrity of both, the lexical lane, access tables, rows that do not open, markers, orphans,
    the journal cross-check) after its checkpoint; `store-backup` writes the stripped memory copy with
    `memoryKeys` and `memoryFts` `"excluded"` in the manifest and the warning `MEMORY_KEYS_NOT_BACKED_UP`;
    `store.open`'s suggestion now tells the deployer to keep `memory.sqlite3` and `memory.keys`. The doctor
    adds `stores.memory`, `stores.memory_keys`, `stores.memory_modes`, `stores.memory_backup`,
    `stores.principals`, `stores.sweep` and `stores.capture`. `umbel-store-embedded` gains the read-only
    `SqliteMemoryStore::check`, `maintenance`, `change_traces` and `keys_integrity_check` for them.
  - **README:** the access section gains memory's paragraph (authority, private by default, digest
    journaling, the key file's limits, Time Machine).
  - New tests: `memory_grants.rs` (17), `journal_digest.rs` (2), `cli_authority_prompt.rs` (7),
    `cli_stdin_input.rs` (4); `manifest_v3.rs` grew to 12 (the catalog, the seal refusal, the inheritance),
    `store_commands.rs` by 4, `doctor_stores.rs` by 4, `doctor.rs` and `config_v4.rs` updated; unit tests for
    the authority table, the digest, the ledger, the quota ceilings, the capture check and the prompt.
  - Twelve details settled in the specification's
    [Amendments from step 4](phases/3-memory-context/spec.md#amendments-from-step-4), none weakening access
    or authority; the twelfth makes `authority` and `confirmation` host-owned in every event envelope of
    version 2, so a plugin can no longer claim `person` in an event. The step was not split: about 3 500 lines of non-test code, unit tests included.
  - The plugin-isolation job's `Plugin-isolation-exempt:` line is not needed: this step changes no plugin
    crate.
- **Step 5, the memory plugin's writing side, done 2026-11-03 in [#742](https://github.com/lushly-dev/afd/pull/742) (`0e3a501a`):**
  - **The crate** `plugins/memory` (`umbel-plugin-memory`, compiled, `publish = false`, quarantined in
    `scripts/release/inventory.json` and listed in `architecture.json`): manifest version 3 with the grants
    `packs`, `clock`, `random`, `memory` and `memory_write`, every command journaled (`memory-remember`,
    `memory-capture` and `memory-show` as digests with 8.1's kept keys, `memory-status` plain); the packs
    `policy` (8.11's lifetimes, expiring-soon window and quota) and `hygiene` (nine ordered patterns for
    8.2's eight secret kinds); the skill `memory-guide`, with the extraction schema and prompt for the calling model;
    and the `umbel-memory` binary, the command line with the plugin compiled in. No new dependency: `regex`,
    `sha2`, `toml` and `chrono` were in the lock.
  - **The write pipeline** (8.2), one for remember and capture: shape (caps, one-line fields, labels refused
    when the hygiene pack would mask them), secrets masked before anything is stored or hashed with counts by
    kind in `redactions`, the `umbel-scan` flags, the content hash, expiry by the class's default and maximum.
  - **Commands.** `memory-remember` (first-class, with D86's `authority_prompt`): observe, renew, supersede,
    idempotency, `SECRETS_MASKED` and `CONTENT_FLAGGED`, a result with no text. `memory-capture`: the capture
    contract version 1 mapped as 10.1 says, always private, `CAPTURE_TOO_LARGE` refusing the whole call, a
    `captureId` a replay repeats. `memory-show`: the record, its 4.2 state and its history, one
    `MEMORY_NOT_FOUND` for every absence. `memory-status`: counts by class and state, usage against the
    quota, the key file's state and `pushable`. Each write's event names the record (or the capture) with its
    access and session and no text.
  - **Host changes, minimal** (the pull request needs a `Plugin-isolation-exempt:` line):
    `src/plugins/memory_services.rs` keeps a renewal only for `person`, fills a default `origin` by the
    authority, and checks a supersede's project and access set (`MEMORY_SCOPE_MISMATCH`); `src/host/digest.rs`
    keeps no input value for a failed digest call, so a refused secret-like label never reaches the journal.
    The SDK's `Outcome` gains `with_retryable` and `with_error_details`, for the quota's `retryAfterMs`.
  - **CI.** `umbel.yml` gains the `memory` job (clippy, tests and an MSRV check of the crate, with the
    `knowledge` job's gating, matrix and timeout), and the `check` job's tests exclude the crate.
    `scripts/affected/suites.mjs` is unchanged: its local `cargo test --workspace` already runs the crate.
  - New tests: in the plugin, `remember.rs` (15), `capture.rs` (8), `hygiene.rs` (6), `quota.rs` (6),
    `events.rs` (4), `process.rs` (1) and 11 unit tests; in the host, `memory_grants.rs` grew to 20 (renewal and
    origin by authority, the supersede scope check, a failed digest call) and the SDK gained one unit test.
  - Thirteen details settled in the specification's
    [Amendments from step 5](phases/3-memory-context/spec.md#amendments-from-step-5), none weakening access
    or authority; items 1, 2 and 4 are narrower than the text.
- **Step 6, the memory plugin's reading and lifecycle commands, done 2026-11-03 in [#743](https://github.com/lushly-dev/afd/pull/743) (`800856ad`):**
  - **Commands**, in `plugins/memory`: `memory-recall` (8.4: the query parser's forms, every filter and
    project rule, flagged hits with their label, concise and detailed hits, AFD `sources` with no `url`,
    hits dropped to fit the budget) and `memory-list` (8.5: the same filters, newest first, a cursor that
    resumes after what the budget dropped); `memory-invalidate` (8.6, the note masked and scanned);
    `memory-confirm` (8.7, D88: `require-human` with the fixed prompt and its project-less warning, the
    command line only, own records only, the contentHash memory-show printed, each refusal named);
    `memory-forget` (7.2 to 7.4: by ids, or by session, project or time for a person, with 5.4's limits as
    a fixed suggestion and `MEMORY_ERASURE_PENDING`); `memory-sweep` and `memory-reindex` (8.8, D89: the
    command line only, journaled plain, orphans removed only with `removeOrphans`). Every read carries
    `UNVERIFIED_CONTENT`, `CONTENT_FLAGGED`, `MEMORY_UNREADABLE` and `MEMORY_HISTORY_PURGED` as 4.1 and 8.4
    say, `memory-show` included. Each lifecycle event follows 8.10's table, with no text and no ids. The
    `memory-guide` skill covers them.
  - **Host: no change.** The SDK's `Outcome` gains `with_suggestion` (a success's AFD `suggestions`), the
    one change outside the plugin; the plugin-isolation job counts only `src/`, `wit/` and `schemas/`, so it
    needs no `Plugin-isolation-exempt:` line, and the pull request names the SDK change anyway.
  - New tests: in the plugin, `recall_scope.rs` (6), `bitemporal.rs` (6), `invalidate.rs` (6), `confirm.rs`
    (5), `forget.rs` (6), `retention.rs` (7), `security.rs` (2), `events.rs` grew to 7 and `capture.rs` to 9
    (step 5's deferred capture refused under a prefix a forget erased), and 4 unit tests (15 in all); the SDK
    gained one unit test. Markers, absent key entries and orphan keys are made by putting back a file-level
    copy of `memory.sqlite3` or `memory.keys` with no connection open, so the plugin needs no new
    dependency.
  - Seven details settled in the specification's
    [Amendments from step 6](phases/3-memory-context/spec.md#amendments-from-step-6), none weakening access,
    authority or forget's guarantees.
- **Step 7a, the shared helpers, done 2026-11-03 in [#744](https://github.com/lushly-dev/afd/pull/744) (`8f124810`):**
  - **Moved to `umbel-okf`**, for the `context` plugin of step 7b (9.3, 9.5): the module
    `umbel_okf::locator` with the locator string (`string`, `short`, `parse` and `Parsed`), and
    `umbel_okf::is_stale` (in `frontmatter.rs`, beside the tier it derives, re-exported at the crate
    root). The locator object of `knowledge-search`'s detailed format stays in the knowledge plugin,
    whose `locator` module now re-exports the string's functions. `knowledge-stale`'s own copy of the
    staleness rule (`past_stale`) is replaced by `is_stale`, the same expression.
  - **Behaviour unchanged.** The functions moved as they were; `plugins/knowledge/eval/baseline.json` is
    untouched and `eval_gate.rs` holds the report to it. `umbel-okf` gains `chrono` (`std` only), the
    version and features the knowledge plugin already uses, so the lock gains one edge and no package.
  - Tests: the two locator unit tests moved with the code, with one for the short hash (10 unit tests
    in `umbel-okf`); `okf/tests/frontmatter.rs` gained two for `is_stale` (25). The knowledge plugin has
    194 tests with the `code` feature (two fewer, moved) and 167 without; the `knowledge` job's crates
    pass, `eval_gate` included.
  - The plugin-isolation job's `Plugin-isolation-exempt:` line is not needed: `okf/` and the knowledge
    plugin are not `src/`, `wit/` or `schemas/`. No amendment: the step settled nothing the text left
    open.
- **Step 7b, the `context` plugin, done 2026-11-03 in [#745](https://github.com/lushly-dev/afd/pull/745) (`c8689ebc`):**
  - **The crate** `umbel-plugin-context` (`plugins/context`, plugin `context`, compiled, domain
    `context`): one command, `context-bundle` (effect `inspect`, first-class, journaled as a digest
    keeping `space`, `project` and `session`), the `bundle` pack (shares, `max_items`,
    `per_authority_cap`, `max_item_bytes`, `secondary_weight`, `draft_factor`, stop words), the
    instance configuration (`verified_only`, `push_authorities` and `push_foreign_authorities`, both
    `["person"]` by default) and the `context-guide` skill. Grants `config`, `packs` and `clock`;
    `documents`, `index` and `memory` optional; no write grant. No binary of its own: step 8's
    `umbel-first-party` links it beside memory (D80). It depends on no plugin crate.
  - **Selection** (9.3): the task's terms with no query syntax; the knowledge lane (OR-ed one-word
    phrases, best chunk plus the next two, each document read again, deprecated and reserved files
    dropped, flagged ones counted, drafts lowered, `INDEX_STALE`); the memory lanes tier by tier
    (`person`, `tool`, `agent`, `import`, `transcript`) with `PushFilter` in every read, eight per
    tier, flagged never, `transcript` admitted for the caller's own `episodic` only, a project-less
    record reaching a named project only at `person`, and `left_out`'s `authority` and `flagged`
    counts. **The default push is the caller's and others' `person` records only.**
  - **Budget, rendering, determinism** (9.4 to 9.6): the reserve, shares redistributed from absent
    sections, the carry and the second pass, `max_items`, omissions to 64 entries and the reserve
    with `omittedMore`, the quoted block cut to `maxChars` in UTF-16 units, item text stripped, the
    whole result measured as AFD measures it; `digest` over task, `asOf`, sections and omissions.
    The keys-failed lane: every memory section `lane-unavailable` with `MEMORY_KEYS_MISSING` or
    `MEMORY_KEYS_MISMATCH`, knowledge kept, the block ending `Memory unavailable: <code>.`
  - **First-class suggestion and the `tools/list` size** (9.7): with the four first-party plugins
    the default list is the five meta-tools, `workspace-show`, `event-list`, `knowledge-search`,
    `knowledge-open`, `context-bundle` and `memory-remember`, 16 292 bytes.
  - **CI.** The `memory` job's clippy, tests and MSRV check gain `-p umbel-plugin-context`, and the
    `check` job's tests exclude it; the release inventory (quarantined, no route) and
    `architecture.json` list the crate. `scripts/affected/suites.mjs` is unchanged: its local
    `cargo test --workspace` already runs the crate.
  - **Host: no change.** `tests/default_tools.rs` is a host test that loads each plugin from its
    directory (manifest, schemas, packs, skills) with stub handlers, since the host depends on no
    plugin crate. No `Plugin-isolation-exempt:` line is needed.
  - New tests: in the plugin, `selection.rs` (12), `budget.rs` (6), `labels.rs` (4), `render.rs`
    (6), `deterministic.rs` (3), `lanes_absent.rs` (6), `no_plugin_dependency.rs` (2) and 10 unit
    tests (49 in all); in the host, `default_tools.rs` (2). The tests write documents, chunks and
    memory records through the `umbel-store` API with fixed ids and a fixed clock.
  - Fourteen details settled in the specification's
    [Amendments from step 7b](phases/3-memory-context/spec.md#amendments-from-step-7b), none
    weakening access or authority or widening the push.
- **Step 8, the first-party binary and the harness adapters, done 2026-11-03 in [#746](https://github.com/lushly-dev/afd/pull/746) (`ab5b321d`):**
  - **`umbel-first-party`** (`first-party/`): the `umbel` command line with `sources`, `knowledge`,
    `memory` and `context` compiled in, the only crate that depends on memory and context together
    (D80), with the command line and the embedded stores and no loader, so no wasmtime.
  - **`umbel-hook`** (`adapters/hook/`), a library (`umbel_hook::run`) and a binary on `serde` and
    `serde_json` alone, linking no host: `umbel-hook claude-code|generic <event> [--sweep]`, run as a
    child `$UMBEL_BIN [--workspace] --format json call <command> @-`. The `claude-code` profile maps
    `SessionStart` (startup, clear, compact) to `context-bundle` printed as `additionalContext`, and
    `Stop`, `PreCompact` and `SessionEnd` to `memory-capture` of closed windows and, for the last two,
    the open tail. The transcript reader of 10.3 takes **user and assistant text only**, in file order,
    with every excluded kind left out; windows of 20 turns, parts of at most 64 KiB with the key-block
    rule, calls of at most 800 KiB, keys by position. The state file holds offsets, counts and message
    ids, never text, so a `Stop` with no closed window reads only the new bytes and starts no process.
    The project is the repository's name, read from `.git` with no `git` process, shared by every
    worktree. **Fail-open**: every failure is exit 0, one stderr line, no output, and `last-error.json`
    (`{ at, profile, event, code, count }`, read by the doctor's `stores.capture` since step 4), which a
    success removes. `print-settings claude-code` prints the hooks fragment (timeouts 10 and 30, `Stop`
    async) and writes nothing; `status` prints the last failure. The `generic` profile forwards the
    capture contract unchanged and prints a session-start bundle plainly.
  - **The fixture** (`adapters/hook/tests/fixtures/claude-code/session.jsonl`): 165 lines, 65 text
    turns, synthetic text, a canary in each of 41 excluded lines, a `password=` secret and a planted
    injection in user turns.
  - **The structure re-check** found no local interactive CLI session with conversation (one CLI
    file, with no conversation lines), so 10.3's follow-up stays open. The 25 largest other sessions,
    read for keys, types and enum values only, confirm the rules, with three additions: a queued
    command's `isMeta` on the attachment, a list `prompt`, and wrappers dropped per text block. New
    line types that copy API requests are never read.
  - **One-shot time** (release, Apple silicon): the first `memory-capture` of a window 110 ms
    (provisioning the key file), later ones about 50 ms, a replay 25 ms, `context-bundle` 25 ms; the
    hook's whole `Stop` with three windows 169 ms, a `SessionEnd` tail 65 ms, a `Stop` with nothing
    new 20 ms. The `memory` job's clippy and tests took 120 s cold here; its timeout stays 15 minutes.
  - **CI.** The `memory` job's clippy, tests and MSRV check gain `-p umbel-first-party -p umbel-hook`;
    the `check` job's tests exclude both. The release inventory (quarantined, no route) and
    `architecture.json` list both crates, `publish = false`. `scripts/affected/suites.mjs` is
    unchanged: its local `cargo test --workspace` already runs them.
  - **Host: no change.** No `Plugin-isolation-exempt:` line is needed.
  - New tests: in the hook, `claude_code.rs` (11), `generic.rs` (3), `fail_open.rs` (6) and 5 unit
    tests; in the binary, `hook_smoke.rs` (1), the hook against the real binary. The `memory` job's
    four crates pass 172 tests.
  - Seventeen details settled in the specification's
    [Amendments from step 8](phases/3-memory-context/spec.md#amendments-from-step-8), none making
    capture non-private or on by default or capturing more than user and assistant text.
- **Step 9, import and export, done 2026-11-03 in [#747](https://github.com/lushly-dev/afd/pull/747) (`4e46de1b`):**
  - **`memory-import`** (`plugins/memory/src/import.rs`, CLI only, digest-journaled with `space`,
    `project` and `harness`): a harness's memory files as entries `{ class, subject, text, tags?, path,
    generated? }`, at most 1 MiB and 256 entries, through the write pipeline with `MemoryPath::Import`.
    The host gives every entry authority `import`, whoever calls, a person at a terminal included, and a
    private access set unless a sharing writer passes `share`. `origin` is `document-derived`, the source
    `harness:<harness>/<path>`; there is no idempotency key, so a repeat observes. The result holds ids
    and counts, never text, with the fixed suggestion that the source files stay where they were.
  - **`memory-export`** (`plugins/memory/src/export.rs`, CLI only, `inspect`, budget 64 000 and
    512 000): the caller's own live records with their text, newest first with `memory-list`'s cursor,
    never flagged, `transcript`, invalidated, expired, forgotten or another principal's, even one shared
    with the caller. Each is opened and checked again; one that does not open counts in `unreadable`,
    and one too large for the budget alone is named in `tooLarge` and passed over.
  - **`umbel-hook import <harness> <dir> [--project p] [--class c]`** reads the `*.md` files directly in
    the named directory, skipping `MEMORY.md`, `umbel-*.md`, links and subdirectories, with a small
    frontmatter reader for `name`, `description` and `type`; parts of at most 64 KiB at line boundaries,
    calls of at most 800 KiB and 256 entries, in sorted name order. **`umbel-hook export <harness> <dir>
    [--project p]`** reads every page first, then writes `umbel-<id>.md` (`0600`, by rename, with the
    unverified header of 10.5) and `umbel-index.md`, removes the `umbel-mem-*.md` files of records no
    longer exported, never touches `MEMORY.md` or any other file, and prints the line to add to it. Both
    are a person's commands: a failure exits 1 and records nothing in the state directory.
  - **Host: no change.** `MemoryPath::Import` already gave `import` and the access rule of 3.2. No
    `Plugin-isolation-exempt:` line is needed.
  - New tests: in the plugin, `import_export.rs` (9) and 1 unit test; in the hook, `import_export.rs`
    (6) and 6 unit tests; in the binary, `import_export.rs` (1), the round trip with a forgotten record
    through the real binary.
  - Seven details settled in the specification's
    [Amendments from step 9](phases/3-memory-context/spec.md#amendments-from-step-9), none raising an
    import's authority or exporting more than the caller's own live, unflagged, non-transcript records.
- **Step 10, the exit, done 2026-11-03 in the step 10 pull request:**
  - **`first-party/tests/exit_memory.rs`** (1 test, about 6.5 seconds in a debug build) runs the
    exit criterion of [section 12](phases/3-memory-context/spec.md#12-exit-criterion-and-tests) on
    the committed Claude Code fixture, the real `umbel-first-party` binary as a child process
    (`umbel-hook` through `umbel_hook::run`), spaces `alpha` and `beta`, the `testkit` build's frozen
    clock and person at a terminal, and 40 documents indexed with `knowledge-refresh`. It writes a
    report of each point's numbers to `UMBEL_EXIT_REPORT`, which the `memory` job sets and uploads
    (`memory-exit-report-<os>`), as the `knowledge` job does phase 2's.
  - **`first-party/tests/leak_probes.rs`** (1 test, 14 probe groups), **`poisoning.rs`** (6) and
    **`forget_bytes.rs`** (3), with a shared `tests/support/` (library actors with all four
    plugins, the in-process command line with a scripted terminal, the binary and its stdio MCP
    server, the probes, and stores written through the `umbel-store` API).
  - **Host: no change**, and no plugin or adapter change: the exit tests found no defect in the
    implementation. No `Plugin-isolation-exempt:` line is needed. `umbel-first-party` gains
    dev-dependencies already in the lock (`afd`, `jsonschema`, `rusqlite`, `umbel` with `testkit`,
    `umbel-store` with `conformance`, `umbel-store-embedded`); `Cargo.lock` gains only those edges.
  - The `memory` job's four crates pass 206 tests in 41 suites (172 at step 8; step 9 added 23;
    these 11). `umbel.yml`'s `memory` job sets `UMBEL_EXIT_REPORT` and uploads the report.
  - Eleven details settled in the specification's
    [Amendments from step 10](phases/3-memory-context/spec.md#amendments-from-step-10); the first,
    that a person reading another's shared record may invalidate it as 6.3 already says, is raised for
    the owner as a follow-up.
- **Exit criterion** (2026-11-03, the step 10 branch from `main` at `4e46de1b`, in `endpoints/umbel`
  with its own `CARGO_TARGET_DIR`, debug build, on the development Mac). Each point, from the report:
  1. **A harness hook captures a session.** `Stop` then `SessionEnd` exit 0 with no `last-error.json`;
     `memory-list` shows 4 episodic records, authority `transcript`, access `principal:human:ada`,
     session and project (`example`, from the repository's `.git`) set; none holds any of the
     fixture's 41 excluded canaries; the secret is masked in one window with 1 redaction counted; one
     window is flagged. 4 capture calls made 4 events, holding no text; the same hooks again created
     nothing and added no event.
  2. **Recall by scope.** `zebrollback` finds the three `zebrollbacks` facts in `alpha` and none in
     `beta`; `project` narrows to 2 and `projectOnly` to 1; the flagged window comes back with its
     flags and `CONTENT_FLAGGED`.
  3. **Bitemporal queries.** A fact remembered, superseded and invalidated, on clocks an hour apart,
     answers the four questions of 4.1 in six queries: nothing now; the first as believed between the
     writes; the first and then the second by valid time; both instants together, either one.
  4. **A budgeted bundle with omissions.** `SessionStart` through the hook printed valid hook JSON,
     2128 characters, with a `Left out` line, the person's five facts and not the agent's note (written
     over the binary's stdio MCP server, authority `agent`). `context-bundle` with a task and
     `maxBytes = 4000` measured 3941 bytes by AFD (`dev.afd/outputBudget`), sections `knowledge` then
     `semantic`, every item with provenance and a verification label, 26 `budget` omissions,
     `authority` 2 (the captured decision and the note) and `flagged` 1, valid against
     `context-bundle.v1.json`. After `memory-confirm` at the terminal the note is pushed with its
     `confirmation` (`priorAuthority: agent`) and `authority` is 1.
  5. **Leak probes pass**: all 14 groups of `leak_probes.rs` on the exit's own stores, through
     library actors.
  6. **Deterministic bundles.** Two processes on the frozen clock returned byte-identical `data`
     (13 782 bytes); two stores written through the store API in two orders gave equal digests and
     sections for three queries, on a rebuilt index.
  7. **Forget holds.** After `store-backup` and `memory-forget` (a fact by id, the session by
     selector, 5 records) no canary is in any file of the workspace, the journal, the events or the
     backup, and the bundle omits the fact; the backup restored beside the current key file answers
     `MEMORY_NOT_FOUND` for all 5 and its rebuilt index holds no canary; the hook run again from the
     transcript's first line, and a capture under the window's key, create nothing (refused 1);
     without `memory.keys`, recall and list answer `MEMORY_KEYS_MISSING`, the doctor's
     `stores.memory_keys` fails naming it, and `context-bundle` keeps its knowledge with the warning
     and the `Memory unavailable: MEMORY_KEYS_MISSING.` line.
  - **Local checks:** `cargo fmt --all --check`; `cargo clippy --locked -j4 --workspace --exclude
    umbel-store-embedded --all-targets -- -D warnings`; the `memory` job's clippy and tests as
    `umbel.yml` runs them (206 passed, 0 failed); `node scripts/run-tooling-tests.mjs`. Not run here:
    the `memory` job's MSRV 1.97 check (1.97 is not installed on this machine) and the full
    workspace test. **Full `pnpm verify` re-run, 2026-11-03 on the owner's Mac, `main` at `4e46de1b` plus
    step 10:** Loam's build and `test:mounted` (13 tests); `cargo fmt`; workspace clippy; the
    wasm32-wasip2 components and `hello-mcp`; `cargo test --locked --workspace --exclude
    umbel-store-embedded` (153 suites, 0 failed, the four exit tests among them); then, after the disk
    guard stopped the run under 5 GB free and the build directory was cleared, the store crates' clippy
    and tests (21 suites, 0 failed) and the todo conformance runs against `umbel-todo` (34/34 in each
    mode, confirmations 5/5, mounted 34/34 in each mode) and the external clients, all passing. The
    hosted `umbel.yml` legs ran on the step 10 pull request; macOS and MSRV run in the daily schedule.
