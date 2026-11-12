# Host specification: standing records, indexed and matched

| Field | Value |
| --- | --- |
| Serves | The host changes the [Ideas plan](../../../../../docs/features/active/ideas/ideas.proposal.md) calls P2 (indexed records) and P3 (matching), and what [D157](../../decisions.md) left to "be specified with indexed records": the manifest declaration, the label's values and the indexing. Step A2 of that plan, first part. Its phase B implements this document |
| Owner | Repository owner approves; the Ideas plan's owning agent writes and implements |
| Read first | [STATUS.md](../../STATUS.md), the [architecture](../../architecture.md) (principles 4 and 7 to 10, sections 4, 5 and 7), the [decision log](../../decisions.md) (D9, D42, D53, D55, D56, D63, D65, D68, D70 to D72, D74, D115, D125, D150, D157, open decision O4, and D158 to D171, made here), the Ideas plan's sections 4.3, 4.4, 4.9, 6, 7 and 9, and [phase 0's results](../../../../../docs/features/active/ideas/prototype/README.md) (0.2) with `prototype/match.py` (class `Lexical`) |
| Elevation | Exact names, shapes, codes, tables, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

Code paths are relative to `endpoints/umbel/`.

## Status

- **State:** written 2026-11-11 for step A2 of the Ideas plan. **Decided under the owner's direction of 2026-11-11**
  that the plan carry on through its phases on its recommendations, with questions queued. **The owner has not yet
  read this specification.** Every decision here stays open to him (the
  [Ideas status](../../../../../docs/features/active/ideas/STATUS.md), Q2), and section
  [18](#18-for-the-owner) lists what he could reasonably want otherwise. **Step B1 of section
  [16](#16-implementation-plan), the shapes, is implemented** (2026-11-11), amended below
  ([B1](#amendments-from-step-b1)): manifest version 6, configuration version 6, the lane's types and pure
  functions, the `Embedder` trait, the SDK's eight methods answering `not_granted`, and the version constants.
  **An independent review of step B1** (2026-11-12) found one blocker and six improvements; all seven are taken,
  in the table after the amendments. Step B1 is merged: [#1048](https://github.com/lushly-dev/afd/pull/1048), as
  `dd72d6b6`.
  - **Step B2, the lane and finding, is implemented** (2026-11-12), amended
    below ([B2](#amendments-from-step-b2), A12 to A23), and merged:
    [#1063](https://github.com/lushly-dev/afd/pull/1063), as `5c7c963a`. **An independent
    review of step B2** (2026-11-12) found one blocker and eight improvements; all nine are taken, in the table
    after its amendments (R8 to R16). A kind a manifest declares is now written with its lane rows and found by key and by text when the
    put returns; an undeclared kind behaves as before.
  - **Step B3, standing, is implemented** (2026-11-12) on the branch `lush/ideas-b3-standing`, amended below
    ([B3](#amendments-from-step-b3), A24 to A40). It is in its pull request, not merged. **An independent
    security review of step B3** (2026-11-12) found two blockers and six improvements; all eight are taken, in
    the table after its amendments (R17 to R24). A standing record now reads `unverified`, `attested` or
    `affirmed`, computed at each read. It is affirmed only inside a call that carries the person gate's proof,
    which at a terminal an agent variable withholds, by the space's one configured person, and only while that
    person is the space's and the wording is the one decided on; it is attested only by evidence that cites,
    word for word, a document that is the person's own now, which for an own collection means the host held it
    to its file on disk; and a call for verified content is given at most what the space's `verified_admits`
    names. The embedded schema is version 3. Steps B4 to B6 are not implemented: nothing is matched, and no
    vector is written.
  - **Revised 2026-11-11 after an independent review** by one reviewer, whose verdict was "approve after the
    blockers": four blockers and nine improvements, about sixty citations sampled and found correct. All thirteen
    are taken, two of them in a different way from the one proposed.
  - **Revised again the same day after a focused pass** on that revision, which verified the thirteen fixes and
    their new citations and found, in what the fixes had introduced, one blocker and six improvements. All seven
    are taken. Both are in the [Review response](#review-response).
  - It decides [D158 to D171](../../decisions.md). It answers open decision O4 for record lanes only.
  - It refines D157 in three places, which D161 and D162 record and section [18](#18-for-the-owner) lists.
  - It differs from the plan's outline in several places, each because of something in the code. Section
    [18](#18-for-the-owner) marks them "differs from the plan".
- **Last verified:** 2026-11-12 for step B3 as revised after its review, on the branch `lush/ideas-b3-standing`
  over `main` at `5c7c963a`, on macOS (`aarch64-apple-darwin`) with Rust 1.98.0, from `endpoints/umbel/`. Every
  command under "Run" below was run again after the last code edit of the revision, the tests last.
  - **The review** (2026-11-12, independent, of the step's security) attacked the proof through a nested call,
    another command, another input, a step of a batch and of a pipeline, MCP with no decision, a forged mark and
    the CLI with no terminal; checked that attested is never stored and lapses on every change, that the
    evidence's refusals are alike, that no label names a tier, that `verified_only` is never wider than
    `verified_admits`, and that every new statement carries the reader clause; and put eight faults of its own
    into the code, each caught. All of that held. It reproduced two things by probe: a terminal process with an
    agent variable set affirming, and a document stored before `own = true` attesting an agent's records after
    the configuration change alone. For the revision, read again: `src/authority.rs`' marks, `src/cli/mod.rs`
    where they are set, `store-embedded/src/connection.rs`' migration, `store-embedded/tests/lane_schema.rs`,
    `src/commands/store_records.rs`, and `plugins/sources-filesystem/tests/` (its sync tests and support).
  - Read for the step, whole unless a part is named: this document's Status, its step B1 and B2 amendments with
    their review tables, the follow-ups table, and sections 2 to 7 and 11 to 16; `src/middleware.rs`' plugin
    gate, `person_gate` and `confirmed_by_a_person`; `src/person/mod.rs`, and in `service.rs` its header,
    `run_fields` and the ledger's `admit`; `src/authority.rs`; `src/plugins/grants.rs`, `record_services.rs`,
    `store_services.rs` (to the graph services), `content.rs`, `compiled.rs`' handler, `pipelines.rs`' header and
    handler, and in `loader.rs` the gate entry and where `Shared` is built; `src/cli/mod.rs` where the terminal's
    marks are set; `src/store/mod.rs`; `src/commands/store_records.rs`; `src/workspace/records.rs` (its head) and
    in `config.rs` `SpaceConfig`, `CollectionConfig` and `command_writable`; `store/src/lane.rs` (the standing
    types), `traits.rs`, `error.rs`, in `document.rs` `DocumentWrite::check` and `ChangeKind`,
    `conformance/mod.rs`, and in `conformance/lane.rs` its helpers and its statistics case;
    `store-embedded/src/lane/` (every file), `documents.rs`, `sql.rs` and `schema.rs`; `sdk/src/records.rs` and
    the record methods of `cx.rs`; in `tests/`, `require_human.rs`, `support/records.rs`, `support/person.rs`,
    `support/plugins.rs`, the head of `person_page.rs` and of `records_put.rs`, and `doctor_stores.rs`' record
    tests; `store-embedded/tests/lane_suite_detects.rs`, and `lane_rebuild.rs`' last test; decision rows D160 to
    D162. Not read: `src/person/page.rs`, `relay.rs` and `oidc.rs`, and the rest of `service.rs`.
  - Run, all passing, each command by itself, the commands step B1's entry below names:
    `cargo fmt --all --check`;
    `cargo clippy --locked --workspace --all-targets -- -D warnings`;
    `cargo clippy --locked --target wasm32-wasip2 -p umbel-plugin-components -- -D warnings`;
    `cargo build --locked --release --target wasm32-wasip2 -p umbel-fixture-behaviors -p umbel-fixture-imports -p umbel-fixture-sockets -p umbel-fixture-future -p umbel-plugin-hello --features umbel-plugin-hello/component`;
    `cargo build --locked -p umbel-plugin-hello --features mounted --bin hello-mcp`;
    `cargo test --locked --workspace` (277 `test result` lines, from 261 test binaries and 16 doc-test runs, all `ok`: 2525 tests passed, none failed, 1 ignored).
  - Run beside the gate, all passing: `cargo build --locked --target wasm32-wasip2 -p umbel-store`; the six
    clippy legs of `.github/workflows/umbel.yml` that the gate does not name, each with `-D warnings`
    (`-p umbel --lib --no-default-features`, the same with `--features mounted` and with `--features component`;
    `-p umbel-sdk -p umbel-plugin-hello --features umbel-sdk/mounted,umbel-plugin-hello/mounted --all-targets`;
    the four fixture components and `umbel-plugin-hello` with `--features umbel-plugin-hello/component` for
    `wasm32-wasip2`; `-p umbel-plugin-knowledge --no-default-features --all-targets`); and
    `cargo clippy --locked -p umbel-store-embedded --lib -- -D warnings`, the embedded store without its
    `testkit` feature.
  - The tests step B3's exit names: `tests/records_standing.rs` (19 tests), `tests/records_person_page.rs` (2,
    with `umbel-testkit-idp`) and `tests/records_own_source.rs` (2). **The suite passes on the embedded backend
    with nothing skipped**: its `standing` group has 16 cases, which `store-embedded/tests/lane_conformance.rs`
    also runs alone. **From the review**: `plugins/sources-filesystem/tests/own_collection.rs` (1 test: the real
    `sources-sync` against an own collection), `store-embedded/tests/lane_standing_rows.rs` (1: rows written by
    hand), `lane_schema.rs`' migration of a version 2 store (8 tests in the file), and in `records_standing.rs`
    the pin of the review's probe, the refusal under an agent variable and a space whose person changes. Beside
    them: `store-embedded/tests/lane_suite_detects.rs` gains two tests (the `standing`
    group fails on each of eight broken backends and passes on the unbroken wrapper); `tests/doctor_stores.rs`
    gains one of `records.standing`; `src/person/mod.rs` has a unit test of `gate_proof` over every way a call
    can carry no proof, `src/plugins/record_services.rs` one of section 6.6's `admitted`, and
    `src/commands/store_records.rs` one more, of `records.standing`. Two of step B2's tests changed with what
    they pinned: `records_find.rs`' refusal of `standings` on a standing kind is now an answer, and
    `records_put.rs`' `record_list` of a standing kind is now a refusal.
  - **Thirty-two faults were put into the code, one at a time, and each was caught**; the tree was restored
    after each, and the gate above ran on the restored tree. Fourteen in the host: a decision and a mark without
    the proof; a proof for a command that is not `require-human`; a call that names no command taking the proof
    of the command the mark names; the terminal's mark not held to this command; a person-page proof not bound
    to this input; the caller not held to the space's person; every put of a standing record the person's; a
    mark's third check removed, and its fourth; section 3's rule 2 removed; the file read through a symbolic
    link; a call's `standings` widening past `verified_admits`; `verified_only` admitting every standing; and
    `record_get` served on a standing kind. Sixteen in the embedded store: a decision reaching a record its
    reader may not read; attested without the cited content hash; every collection own; a mark counting for
    content it was not made on; evidence that is not word for word attesting; the speaker not held; a mark
    counting in a command-writable collection; the source shown to a reader who may not read the document; the
    standing clause not applied; evidence citing a document the writer may not read, and another content hash; a
    mark and an unmark reaching a document their reader may not read; a mark naming any content hash; a
    standing record's wording changing; and `document_own` answering for an unreadable document. Two with a
    mark's first and second checks removed in the host and in the store together, since each is made twice.
    **Two were caught at first only by the suite**, with no test through the host: a mark counting for content
    it was not made on, and evidence that is not word for word. `records_standing.rs` now holds both.
    **For the revision, sixteen more, each caught**: the terminal's proof without the human-present mark; an own
    collection attesting, and `document_own` answering, without the held fact; a former person's decisions
    counting; the affirmation not bound to the lane row's wording, and a decision that is not an affirmation
    affirming; the decider shown to every reader of a read, and of a find; the file read before the size is
    held to the bytes; a put into an own collection not recorded as held; a put nothing held keeping the fact; a
    hold recorded for any content hash; a mark by another person writing nothing; an affirmation not written
    over a former person's; a proof for a command that is not `require-human`; and `store-documents-hold`
    holding a document that differs from its file.
  - Run from the repository root, on Node 24.21.0 and not the `.nvmrc`'s 26, all passing:
    `node --test scripts/plugin-manifest.test.mjs` (47 tests), `biome check endpoints/umbel` (237 files) and the
    file-size, orphan-files, portability and boundaries checks.
  - Before the review the same commands passed on the step as first written: `cargo test --locked --workspace`
    gave 275 `test result` lines and 2519 tests; the difference is the revision's own tests.
  - Not run: Linux, which is where the Umbel workflow runs; the minimum Rust (`cargo +1.97.0 check`); the todo
    example's conformance runs against Umbel; and `pnpm check` and `pnpm verify` as a whole. No timing was
    taken: step B6 measures.
- **Verified before that:** 2026-11-12 for step B2 as revised after its review, on the branch `lush/ideas-b2-lane` over
  `main` at `dd72d6b6`, on macOS (`aarch64-apple-darwin`) with Rust 1.98.0, from `endpoints/umbel/`. Every
  command under "Run" below was run again after the last code edit of the revision, the tests last.
  - **The review** (2026-11-12, independent) reran formatting, the workspace's clippy and the whole workspace's
    tests, all passing, and ran eight probes on a copy of the two store crates. For the revision, read again:
    `store-embedded/src/lane/reindex.rs`, `rank.rs` and `find.rs`, `store/src/lane/query.rs`, the faults and
    the two tests of `store-embedded/tests/index_suite_detects.rs`. That SQLite's busy handler sleeps up to
    100 ms between tries is the review's figure and was not read from SQLite's source here: what holds the
    pause is the test, which fails with none.
  - Read for the step, whole unless a part is named: this document's Status, its step B1 amendments and sections
    1 to 8 and 11 to 18 (not 9 and 10, which are B5's); `store/src/traits.rs`, `error.rs`, `lib.rs`, `lane.rs`,
    `lane/extract.rs` (its code, not its tests), `lane/normalise.rs` and `lane/score.rs`, `canonical.rs` (the
    JSON and base64), `access.rs` (the reader filter), `document.rs` (`check_record`, `record_target`),
    `conformance/mod.rs`, `fixture.rs`, `records.rs` and `samples.rs`' envelope;
    `store-embedded/src/schema.rs`, `connection.rs`, `documents.rs`, `sql.rs`, `error.rs`, `lib.rs`, and how
    `memory/pool.rs` creates its schema; `store-embedded/tests/sqlite.rs`, `secure_delete.rs` (its head),
    `conformance.rs` and `support/mod.rs`; `store/tests/support/mod.rs` and `suite_detects.rs` (their heads);
    `src/plugins/store_services.rs`, `grants.rs`, `src/store/mod.rs` and `embedded.rs`; in
    `memory_services.rs` the principal check, the scan and the envelope a write is given; `loader.rs`' gate
    entry and where `Shared` is built; `src/middleware.rs`' unprojected mutations and `sanitize`;
    `src/authority.rs` (to `write_authority`); `src/host/mod.rs`' built-ins and digest commands, and
    `host/digest.rs`; `src/commands/mod.rs`, `store_common.rs`, `store_backup.rs`, `store_doctor.rs` (the
    three store checks and the head of the memory checks), `workspace_doctor.rs` (its handler) and
    `plugin_show.rs` (its head); `src/doctor.rs` (to `inspect_with`); `sdk/src/records.rs` (its methods) and the
    record methods of `sdk/src/cx.rs` and `store.rs`; in `tests/`, `support/store.rs` (its manifest, its
    envelope, its handler's head and its configuration), the names of `support/plugins.rs`' helpers,
    `support/mod.rs`' CLI and call helpers, `store_grants.rs` (its head), `doctor.rs` and `doctor_stores.rs`'
    lists, and `manifest_v6.rs`' manifests.
  - Run, all passing, each command by itself. **`AGENTS.md` no longer holds the gate's list**
    ([A22](#amendments-from-step-b2)); these are the commands step B1's entry below names:
    `cargo fmt --all --check`;
    `cargo clippy --locked --workspace --all-targets -- -D warnings`;
    `cargo clippy --locked --target wasm32-wasip2 -p umbel-plugin-components -- -D warnings`;
    `cargo build --locked --release --target wasm32-wasip2 -p umbel-fixture-behaviors -p umbel-fixture-imports -p umbel-fixture-sockets -p umbel-fixture-future -p umbel-plugin-hello --features umbel-plugin-hello/component`;
    `cargo build --locked -p umbel-plugin-hello --features mounted --bin hello-mcp`;
    `cargo test --locked --workspace` (269 `test result` lines, from 253 test binaries and 16 doc-test runs, all `ok`: 2480 tests passed, none failed, 1 ignored). Before the review the same command gave 267 lines and 2474
    tests; the difference is the revision's own tests.
  - Run beside the gate, all passing: `cargo build --locked --target wasm32-wasip2 -p umbel-store`; and the six
    clippy legs of `.github/workflows/umbel.yml` that the gate does not name, each with `-D warnings`
    (`-p umbel --lib --no-default-features`, the same with `--features mounted` and with `--features component`;
    `-p umbel-sdk -p umbel-plugin-hello --features umbel-sdk/mounted,umbel-plugin-hello/mounted --all-targets`;
    the four fixture components and `umbel-plugin-hello` with `--features umbel-plugin-hello/component` for
    `wasm32-wasip2`; `-p umbel-plugin-knowledge --no-default-features --all-targets`); and, since the
    workspace's own run builds the embedded store with its `testkit` feature,
    `cargo clippy --locked -p umbel-store-embedded --lib -- -D warnings`, which builds it without.
  - The tests step B2's exit names: `store-embedded/tests/lane_schema.rs` (7 tests: a version 1 store, built
    from the dump of one the code before this step wrote, opens as version 2 with its records, its schema a new
    store's statement for statement; every table and index of 5.1; the traits version set and not inserted; four
    handles migrating one store once; a kind declared after its records exist is stale until the rebuild),
    `lane_delete_bytes.rs` (1), `tests/records_put.rs` (11) and `tests/records_find.rs` (6). **The suite passes
    on the embedded backend with nothing skipped**: its `lane` group has 16 cases, which
    `store-embedded/tests/lane_conformance.rs` also runs alone. **From the review**:
    `store-embedded/tests/lane_rebuild.rs` (3 tests: two rebuilds under two declarations, a waiting writer's
    turn between chunks, and a wording edited while undeclared) and `lane_suite_detects.rs` (2: the group fails
    on each of eight broken backends and passes on the unbroken wrapper), and a unit test that holds a chunk's
    query plan to one range over the primary key. Beside them: `tests/doctor_stores.rs` gains two
    tests of `records.declared` and `records.size`; `src/commands/store_records.rs` has five unit tests,
    `store/src/lane/query.rs` four and `src/store/mod.rs` two.
  - **Five faults were put into the code, one at a time, and each was caught by the `lane` group**: the reader
    clause taken out of the corpus's size, out of the terms' counts and out of the gather; the reader and text
    filters taken out of a total; and `put_record`'s stale mark made a no-op. A sixth, the lane writer's rule in
    the plugin gate, was caught by `records_put.rs`. One was not caught at first: with the reader clause out of
    the corpus's size, `records_find.rs` still passed, because a ranked page carries no score and its three
    records kept their order. The suite's case `a_ranking_counts_only_what_its_reader_may_read` was written for
    that, on records chosen so that the order moves. **For the revision, three more, each caught by the test
    written for it**: the generation check taken out of a chunk, the pause between chunks set to nothing, and
    the rebuild's clearing put back under "for a standing kind".
  - Run from the repository root, on Node 24.21.0 and not the `.nvmrc`'s 26, all passing:
    `node --test scripts/plugin-manifest.test.mjs` (47 tests), `biome check endpoints/umbel` (234 files) and the
    file-size, orphan-files, portability and boundaries checks.
  - Not run: Linux, which is where the Umbel workflow runs; the minimum Rust (`cargo +1.97.0 check`); the todo
    example's conformance runs against Umbel; and `pnpm check` and `pnpm verify` as a whole. No timing was
    taken: step B6 measures.
- **Verified before that:** 2026-11-12 for step B1 as revised after its review, on the branch
  `lush/ideas-b1-shapes` over `main` at `e5de4194`: everything under "Run" below was run again on the revised
  code. The step was first verified 2026-11-11, with the same commands.
  - Read for the step, whole unless a part is named: `src/plugins/manifest.rs` (to line 1560, and where it tests
    the manifest version after that), `manifest/v5.rs`, and `v4.rs`'s head; `src/workspace/config.rs`,
    `plugins_config.rs` and `access.rs`, and `hosted.rs`'s key lists, key scan and `is_v5_key`;
    `src/plugins/mod.rs`'s constants and grants; `src/doctor.rs`'s configuration checks; `store/src/lib.rs`,
    `error.rs` and `canonical.rs`, `document.rs`'s record types and `check_record`, `memory/tokenizer.rs`'s header
    and `tokens`; `sdk/src/store.rs` and `lib.rs`, and `cx.rs`'s `HostError` and the record methods of
    `HostServices`; `src/versions.rs`, and `src/commands/workspace_show.rs`'s versions; in `tests/`, how
    `manifest_v5.rs`, `config_v5.rs`, `schemas.rs` and `schemas/phase5.rs` pin a version's keys, and
    `support/plugins.rs`; the structure of `schemas/plugin-manifest.v5.json` and `workspace-config.v5.json`;
    `spec/plugin-manifest.md` (P3 to P6 and Umbel's profile) and the Umbel part of
    `scripts/plugin-manifest.test.mjs`; `.github/workflows/umbel.yml`'s commands; and what the commit that added
    version 5's shapes (`ed694c53`) changed outside its new files.
  - Run, all passing, on macOS (`aarch64-apple-darwin`) with Rust 1.98.0, from `endpoints/umbel/`: the Umbel gate of
    `AGENTS.md`, each command by itself:
    `cargo fmt --all --check`;
    `cargo clippy --locked --workspace --all-targets -- -D warnings`;
    `cargo clippy --locked --target wasm32-wasip2 -p umbel-plugin-components -- -D warnings`;
    `cargo build --locked --release --target wasm32-wasip2 -p umbel-fixture-behaviors -p umbel-fixture-imports -p umbel-fixture-sockets -p umbel-fixture-future -p umbel-plugin-hello --features umbel-plugin-hello/component`;
    `cargo build --locked -p umbel-plugin-hello --features mounted --bin hello-mcp`;
    `cargo test --locked --workspace` (262 `test result` lines printed here, from 246 test binaries and 16 doc-test
    runs, all `ok`: 2430 tests passed, none failed, 1 ignored; the review's own run printed 265 such lines).
  - Run beside the gate, all passing: `cargo build --locked --target wasm32-wasip2 -p umbel-store` and
    `cargo build --locked -p umbel-store` (the two new dependencies, [A11](#amendments-from-step-b1));
    `cargo +1.97.0 check --locked -p umbel-store -p umbel-sdk --all-targets` (the crates' minimum Rust; run
    2026-11-11 and not again, since neither crate's library changed after it);
    the six clippy legs of `.github/workflows/umbel.yml` that the gate does not name, each with `-D warnings`
    (`-p umbel --lib --no-default-features`, the same with `--features mounted` and with `--features component`;
    `-p umbel-sdk -p umbel-plugin-hello --features umbel-sdk/mounted,umbel-plugin-hello/mounted --all-targets`; the
    four fixture components and `umbel-plugin-hello` with `--features umbel-plugin-hello/component` for
    `wasm32-wasip2`; `-p umbel-plugin-knowledge --no-default-features --all-targets`);
    `node --test scripts/plugin-manifest.test.mjs` (47 tests: Umbel's version 6 schema conforms to the shared
    manifest's core); and, from the repository root, `biome check .`, `node scripts/run-tooling-tests.mjs` and the
    portability, file-size, orphan-files, versions and boundaries checks.
  - The five tests step B1's exit names: `tests/manifest_v6.rs` (13 tests), `tests/config_v6.rs` (21),
    `store/tests/lane_normalise.rs` (9), `store/tests/lane_score.rs` (10) and `store/tests/lane_fixture.rs` (4).
    The last recomputes sections [8.1](#81-identical)'s digest and [8.2](#82-words)'s scores in Rust, from
    `umbel_store::lane` and the store's tokenizer, and they are this document's figures to four places: the first
    time the code, and not the script below, produced them.
  - Not run: Linux, which is where the Umbel workflow runs; the minimum Rust over the whole workspace (only
    `umbel-store` and `umbel-sdk`, above); the todo example's conformance runs against Umbel; and `pnpm check` as
    a whole, whose TypeScript builds and tests this change does not reach.
- **Verified before that:** 2026-11-11, for the specification itself, against the branch `lush/ideas-a2-records` at
  `083d3505`.
  - Read whole in the code: `store/src/traits.rs`, `document.rs`, `index.rs`, `access.rs`, `error.rs`, `lib.rs`,
    `memory/query.rs`; `store-embedded/src/schema.rs`, `documents.rs`, `connection.rs`, `lib.rs`, `sql.rs`,
    `memory/schema.rs`, `memory/rank.rs`; `sdk/src/store.rs` (to line 460); `src/person/mod.rs` (to line 400);
    `src/plugins/manifest/v5.rs` (to line 125), `src/plugins/mod.rs` (lines 55 to 175), `grants.rs` (to line 380),
    `store_services.rs` (to line 520), `src/store/mod.rs` (to line 140), `src/authority.rs` (to line 260);
    `docs/features/active/ideas/prototype/match.py`.
  - Read in part, by the lines cited here: `store/src/envelope.rs`, `memory.rs` (recall's types and limits),
    `memory/tokenizer.rs` (its header and `tokens`), `conformance/mod.rs` and `conformance/memory/mod.rs` (the group
    lists); `store-embedded/src/memory/read.rs` (recall and its statistics), `inspect.rs` (`backup_to`);
    `sdk/src/cx.rs`, `memory.rs`, `lib.rs`; `src/plugins/manifest.rs` (the key lists, `parse`, the versioned-key
    check, the memory rules), `manifest/v4.rs`, `memory_services.rs`, `loader.rs` (the gate entry, the command
    policy, grant decisions), `content.rs`; `src/workspace/config.rs`, `plugins_config.rs` and `hosted.rs` (the
    versioned key lists); `src/middleware.rs` (the plugin gate, `person_gate`, the sealed fields), `src/access.rs`,
    `src/provenance.rs` (`effective_principal`), `src/cli/mod.rs` (the confirmed mark), `src/commands/` (names,
    `operator_only`, `workspace-show`'s versions); `plugins/sources-filesystem/src/document.rs` and `state.rs`,
    `plugins/knowledge/src/index.rs` and `proposal/apply.rs` (which dates a document carries, and who writes
    documents); `Cargo.toml`, `store/Cargo.toml`, `store-embedded/Cargo.toml` and `Cargo.lock`. For the revision:
    `src/person/service.rs` (its header, `run_fields` and the ledger's `admit`, for section 6.1's proof) and
    `src/workspace/config.rs` (`roots_overlap`, `resolve_root`, `check_collection_roots`, and where each runs).
    Not read: `store/src/conformance/`'s case files, `src/workspace/hosted.rs` beyond its key lists,
    `src/person/page.rs`, `relay.rs` and `oidc.rs`, and the rest of `service.rs`.
  - Read in the documents: the architecture's principles and sections 4 to 7 and 12; the decision rows D9, D24,
    D42, D45, D53, D55, D56, D63, D65, D68, D70 to D72, D74, D82, D98, D115, D125, D133, D134, D150, D151 and D157,
    and the open decisions; the phase 2 specification's sections 5.1 and 5.2 and its row reserving the trait names
    (section 13); the phase 3 specification's lines on FTS5's `secure-delete` and its limits, by search; the phase 6
    specification's section 2's table and sections 3.1 to 3.3; the components specification (for this shape); the
    Ideas plan's sections 4.3, 4.4, 4.9, 6, 9 and 11 and its status; and phase 0's results (0.2 and what it means
    for the plan).
  - Run: `cargo search` and `cargo info` for five crates, and their published sources read (the
    [trajectory refresh](#trajectory-refresh)). Section 5.1's tables and 6.3's clause, on SQLite 3.54.0, with five
    records across the three standings. A Python script that computed the worked scores of section
    [8.2](#82-words) and the digest of [8.1](#81-identical) from this document's formulas, taking its tokens from
    that SQLite's FTS5 `porter unicode61 remove_diacritics 2`.
  - **No Rust was built or run** for the specification; step B1's run is above.
  - The review's two measurements, on section 5.1's tables at 100 000 records, are the reviewer's and were not
    repeated here: about 1.0 second for the counts of 64 pooled records, and about 8 seconds for a rebuild in one
    transaction. Step B6 measures both.
- **Done:** this document, its decision rows, and the amendments to the architecture and STATUS.md that it needs.
  Step B1 of section [16](#16-implementation-plan), 2026-11-11, with its amendments
  ([B1](#amendments-from-step-b1)), merged as `dd72d6b6`. Step B2, 2026-11-12, reviewed independently, with its
  amendments ([B2](#amendments-from-step-b2)) and its review's nine findings taken, merged as `5c7c963a`
  ([#1063](https://github.com/lushly-dev/afd/pull/1063)): embedded schema version 2 and its migration;
  `put_declared_record`, `put_record`'s stale mark, `read_record`, `find_records`, `lane_status` and
  `reindex_records` in chunks, without vectors; the host's put path of section 4.2 without steps 6 and 8,
  `record_read` and `record_find`; the loader's `Shared.records` and `GateEntry.lane_writer`;
  `store-records-reindex`; the doctor's `records.declared` and `records.size`; and the suite's `lane` group.
- **In progress:** step B3, implemented, reviewed independently and verified 2026-11-12 on
  `lush/ideas-b3-standing`, with its amendments ([B3](#amendments-from-step-b3)) and its review's eight findings
  taken; in its pull request, not merged. It holds:
  `gate_proof` and `CallServices.person_gate`; `decide_record`, `mark_document_own`, `unmark_document_own` and
  `document_own`, with `record_decide`, `doc_own_mark`, `doc_own_unmark` and `doc_own`; evidence, section 4.2's
  steps 6 and 7.5 and `record_put_cited`; the label and section 6.3's clause, computed at each read; the
  `StandingView` the host builds from a space's own and command-writable collections, its `verified_admits` and
  the call's `verified_only` and `standings`; the first row of section 4.2's authority table; section 3's rule
  2 in `svc_doc_put`; `record_get` and `record_list` refused on a standing kind; `ChangeKind::Standing`; the
  doctor's `records.standing`, and `records.declared` saying what a rebuild removes whatever the declaration;
  and the suite's `standing` group. Both follow-ups addressed to it are settled (A25, A26). **From its
  review**: embedded schema version 3 and its migration; `put_document_held`, `hold_document` and
  `unheld_documents`; `store-documents-hold`; the doctor's `records.own`; `StandingView.person`; the terminal
  proof's human-present mark; and the label's decider shown to the operator and the person only.
- **Not done:** steps B4 to B6 of section [16](#16-implementation-plan). Step B3 leaves B4 the standing of a
  match: `match_records` takes the same clause and the same labels as a find
  (`store-embedded/src/lane/standing.rs`: `and_admitted`, `label`), the `standing` group's case that
  `admit` narrows it ([A34](#amendments-from-step-b3)), and in `svc_record_match` the withholding of who affirmed
  a hit ([A39](#amendments-from-step-b3)). B5 has `store-records-reindex`'s `vectorsOnly` and
  `meaning` ([A18](#amendments-from-step-b2)), the model id and loading a model.
  **Section 16 gives one part
  of section [12.4](#124-workspace-show-and-plugin-show) to no step**: what `workspace-show` says of a space (its
  person, `verifiedAdmits`, own collections and meaning) and the declared kinds `plugin-show` lists. B1 did the
  three version numbers, which is all its row names; the rest needs a step before B6's exit reads it.
- **Follow-ups:** the [table at the end](#follow-ups).

### Review response

An independent review of 2026-11-11 (verdict: approve after the blockers) raised four blockers and nine
improvements, each checked against the code; all held. Changes:

| # | Finding | Change made |
| --- | --- | --- |
| B1 | A command's input could become an `own` document across spaces: rule 1 looked at `content_write` on the collection itself, and roots may overlap between spaces (`src/workspace/config.rs:1046`, `:1341`) | A collection is *command-writable* when any `content_write` allow covers it or any collection of any space whose root overlaps it, as written or resolved. `own` is refused on one (section 3) |
| B2 | `doc_own_mark` widened D157: any readable document could be marked, an applied proposal included | A mark is refused on a document of a command-writable collection, and counts only while that stays so. **Beyond the ruling**, it is also refused unless the document equals its file on disk, which is what makes "a synced document" something the host checked (6.2). Recorded as a refinement of D157 in D162 and section 18 |
| B3 | The label showed a document's dates, units and speaker to a reader who cannot open it, and 6.3's clause let an unreadable document move 6.6's filter and totals | For such a reader the source is `basis` alone (6.5, 11.1). The one remaining bit is stated in section 14 and put to the owner (18, row 8). A differential case for unreadable documents joins the `standing` group (15.1) |
| B4 | D157's "verified content only" had no host setting | `spaces.<id>.verified_admits` and a `verified_only` flag on every reading service. **Differently in one respect**: the space's own asking is `spaces.<id>.verified_only`, which replaces `min_standing`; the two together would have said the same thing twice (section 3, 6.6). The focused pass then dropped that space-level flag (F1 below) |
| I5 | The cost of statistics was unbounded, and a 64-text match would take tens of seconds at 100 000 records | `N` and `L` once a call; one table of counts for the whole call; `STAT_POSTINGS` with `RECORD_QUERY_TOO_BROAD`; the measured costs stated as estimates that B6 records, part by part (8.2, 16) |
| I6 | Dropping a declaration, editing a wording and declaring again bypassed D160 | An undeclared `put_record` on a kind with a declaration row marks it stale, and the rebuild takes the affirmation and the evidence from every record whose wording changed (section 2, 12.1) |
| I7 | The gate could pass on noise and go stale | Counts, not rates: at least max(3, ceil(0.02 n)) more probes found within `k`, `n` at least 50, no leak. The report is bound to the declaration hash, the normalisation version, the model id, `k` and the weight; the host recomputes the rule from the counts; it is read at host start and by a rebuild; the doctor warns at four times the records. Phase 0's static model is said not to pass (10) |
| I8 | Seven places left to the implementer | Each decided: `cut` (only the rarest term's read passing the bound after every clause; the bound itself compared before key filters, 7, 8.2); the HTTP `url` (`https`, or `http` to a literal loopback address, 9.2); a decision and a mark are noted for `dev.umbel/changes` and the event (6.1); `basis` is `collection` when both hold (6.2); `RECORD_MODEL_UNAVAILABLE` is a failure for the eval and for `vectorsOnly`, and a warning on a full rebuild (12.1, 13); the ONNX provider learns its dimensions by one embed at load (9.2); ties for the best 64 by `meaning` break by id (8.3) |
| I9 | A rebuild held the write lock for a whole kind, and looked up `created_rev` in `changes` a record at a time | Chunks of 1 000 records, the kind offline while it runs and the rest of the store not; one grouped scan of `changes` (12.1) |
| I10 | `exclude` and a probe's `self` counted a text twice | Excluded records are left out of the statistics (8, 8.2, 10) |
| I11 | Text went to the HTTP provider before a refusal | A put's text is embedded after its write commits, through a new `put_record_vector`, and a match's after its query passes its checks (4.2, 9.4). The store's new methods are now eleven |
| I12 | Three overstatements | "Text never enters the journal" is now what is true: the host's services write none, and a command's own input and result follow its declared mode (14, D169). "Nothing here changes what D157 decided" is now a list of what is refined (18). Phase 0's gain is stated as 0.886 against 0.914 to 0.971 of 35 probes (10, 18) |
| I13 | The status and the nit | This block; `src/person/service.rs` read and cited in 6.1; the delegation chain is `memory_services.rs:413` (4.2) |

The same revision added row 17 of section 18 on the dates an attested label carries, as the coordinator asked.

A focused pass of 2026-11-11 on that revision verified the thirteen fixes and their citations, and found one
blocker and six improvements in what the fixes had introduced. Changes:

| # | Finding | Change made |
| --- | --- | --- |
| F1 | Blocker. A space with `verified_only = true` could never affirm anything: reads returned only verified records, so no review could list an unverified one, and whether `record_decide` reached one was contradictory | The space-level flag is gone. `spaces.<id>.verified_admits` says what verified means; a call's `verified_only` asks; `record_decide` and the marks check readability only and ignore what a call admits. Recorded as a refinement of D157's "by a deployment's setting or by a call" in D161 and section 18, row 7 (section 3, 6.1, 6.6, 13) |
| F2 | The chunked rebuild cleared the stale mark unconditionally, so an undeclared put or a second rebuild during the chunks was forgotten | `record_kinds.generation`, which `put_record` and each rebuild's start raise; the rebuild clears the mark only if the generation is the one it wrote, and reports `superseded` otherwise (section 2, 5.1, 12.1) |
| F3 | `RECORD_LANE_STALE` misled during a rebuild | Its When names all four cases, its message says "is being rebuilt or must be rebuilt", and the suggestion is to retry once and then ask. One code, on purpose: the store cannot tell a running rebuild from a stopped one (13) |
| F4 | `STAT_POSTINGS` bounded the reader's counts, not the work, and tripped at a different point by how counts were fetched | The total is `scanned`, every posting of the needed terms, whoever may read them, however fetched. Stated plainly: a reader of 1% pays for all; a refusal is the one place unreadable records change a reader's answer. B6 times a reader of 1% of a kind (8.2, 14, 16, 18 row 12) |
| F5 | "Command-writable" is judged now, with no history | Stated as the deployer's limit beside the shell caveat (section 3); the absolute claims in 6.2, section 14, section 18 and the architecture are softened to "as far as the configuration now tells the host" |
| F6 | A failed vector write after the commit was unspecified | No failure in step 8 fails the put: the host logs it and returns the `RecordMeta`, and the record waits for a rebuild (4.2) |
| F7 | Two leftovers in section 2 | An undeclared put on a once-declared kind is said to touch `record_kinds`; and a changed `text` pointer is said to change every wording hash, so the rebuild removes every affirmation and evidence row of the kind, which the doctor counts and says first (section 2, 12.3) |

### Amendments from step B1

Step B1 (shapes) found these points this document had wrong, had given to two steps, or had not settled, and took the
narrowest reading of each. None changes a decision row.

| # | Point | Decision |
| --- | --- | --- |
| A1 | Section [16](#16-implementation-plan) gives "command-writable collections across spaces, the own-collection rules" to step B3. Section [3](#3-configuration) makes the first rule a refusal when the configuration is read, and [15.2](#152-other-tests) puts its cases in `tests/config_v6.rs`, which is B1's exit. Had B1 accepted `own` on a command-writable collection, B3 would have refused a version 6 file B1 opened | B1 implements the first rule, as written and as resolved (a missing root to where it would be created, A2), and `Config::command_writable`, with every case 15.2 lists. B3 keeps the second rule (`STORE_OWN_SOURCE_MISMATCH`), the mark's four checks and the `StandingView` |
| A2 | Section 3 gives `Config::command_writable(space, collection) -> bool`, and has the resolved form of an overlap checked "where `check_collection_roots` runs", with "a root that does not exist yet is checked when it does, at the next start". `Config` holds no workspace root, so the method could not resolve one. And a content write creates the directories its path lacks (`src/plugins/content.rs:238`), so a root that does not exist yet is already writable: left unresolved, a missing own root passed while another space's covered root reached its directory through a link, and a command could then write into it until the next start (the independent review's blocker, reproduced) | The command-writable collections are judged once, where the configuration is read (`ConfigFile::into_config`, which has the root), and `Config` keeps the answer. **Every root is resolved whether or not it exists** (`effective_root`, `src/workspace/records.rs`): followed through each symbolic link on its way, at most 40; the part that exists as the file system resolves it; a link whose target is missing to where the target would be; the segments after that as written. Section 3's sentence is replaced. **What this leaves, now stated in section 3, in 6.2's check 3 and in section 14**: the judgment is each host's at its own start, so a link changed under a running host is not seen until it restarts, and two hosts over one workspace that started at different times can disagree about a collection until both have. Section [6.2](#62-the-persons-own)'s check 3 reads this same answer in B3. The doctor's `config.parse` reports the first rule too |
| A3 | Sections [1](#1-crate-layout-and-versions), [11.1](#111-umbel-store) and [12.4](#124-workspace-show-and-plugin-show) make the store traits version 3 where `DocumentStore` gains eleven methods. Section 16 gives B1 "the version constants" and gives the methods to B2 to B5 | `STORE_TRAITS_VERSION` is 3 from B1: version 3 begins with `lane` and `Embedder`, and the trait gains its methods under the same number in B2 to B5. `workspace-show` and `store-show` say 3. `StoreError`'s four variants and `ChangeKind::Standing` are not B1's: each arrives with the first method that answers it. The embedded store writes the constant into `meta.store_traits_version` when it creates a store, so a document store created between B1 and B2 holds 3 beside embedded schema 1; section [5.1](#51-tables-embedded-schema-version-2)'s migration sets the value, which leaves it right. **The memory store writes the same constant** when it is provisioned (`store-embedded/src/memory/pool.rs:408`), and 5.1's migration is the document store's alone: a memory store made from B1 on records 3, and one made before keeps 2, for good. Nothing reads `store_traits_version` in either store (the two inserts are its only uses), so nothing breaks and nothing is migrated; a later change that starts to read it must expect both values in memory stores |
| A4 | Section [2](#2-declaration-d159) has the loader copy the declarations into `Shared.records` and set `GateEntry.lane_writer`. Nothing reads either before B2's put path, and a field nothing reads fails the gate's clippy | Left to B2. In B1 a declared kind is parsed, validated and kept on `Manifest.records`, and its records are written and read as an undeclared kind's. B2's first start therefore finds such a kind stale, as section 2 says of records written before a declaration |
| A5 | `records` is a new top-level key of Umbel's profile of the shared plugin manifest. `spec/plugin-manifest.md`'s P3 lists every key a profile adds ("a change to this table is a change to this page"), and `scripts/plugin-manifest.test.mjs` pins the keys each of Umbel's schema versions adds. This document named neither | P3 gains `records`, top level, Umbel's from manifest version 6, and the page names `v6.json`; the test admits `records` from version 6 and holds the new schema to the core as it holds the other five. `tests/schemas.rs` gains the two version 6 stems, and each schema has two examples under `schemas/examples/` |
| A6 | Section 2 fixes the text of five rules and gives its table's other rules no key and no text | Each names its key: `records[i].kind` (its shape; declared twice), `.standing` (true with no text pointer, which is that rule's and not "declares nothing"), `.text` and `.keys` (how many, a pointer's shape, named twice, a key that is also a text pointer), `.match` (its shape; not one of `text`), and `records` (more than 16). `records = []` declares nothing, so none of the five rules applies to it, as an empty `grants` reads today; in versions 1 to 5 it is the reserved key all the same. The rules run in this order: reserved, compiled, grants, the count, the entries, and the journal rule after memory's |
| A7 | Sections 3 and [9.2](#92-models-in-the-configuration) leave these open | `own` without the space's `person` is refused at `own`, and `speaker` without `own = true` at `speaker`. A `meaning.model` that no `[models]` table declares is refused at `meaning.model`. A model's key that is another provider's is refused, naming the provider's own keys. `dimensions` is required for `http`, which has no other way to learn it. `weight` takes the integers 0 and 1 as well as a float. `dir` is checked as written, by a collection root's rule; that it resolves inside the workspace is B5's, where the files are read. A model's `name` and `version` refuse control characters, as `speaker` does by section 3; 9.2 gives each only a length. **An `http` model's `url` has one grammar, which the schema's pattern and the host's `check_model_url` both state**: `https://` and a host name of letters, digits, dots and hyphens or a bracketed IPv6 address, or `http://` and `127.` with three more octets of 0 to 255, or `[::1]` spelled so; then an optional port of 1 to 65535 without a leading zero; then an optional path, query or fragment of printable ASCII. So `http://127.999.0.1/`, a port of 99999 or 0, `https://a_b.example/` and `http://[0:0:0:0:0:0:0:1]/` are refused by both, where the first draft's schema and host each admitted some the other refused. `PluginInstance.records_default_access` holds the grant table's new key. `SpaceConfig` is no longer `Eq`, since `weight` is a float. **The model id is not computed in B1.** Section 9.2 takes it over "the canonical JSON of the table" and does not say whether that is the table as written or with its defaults filled, which decides whether `pooling = "mean"` written out names the same model as `pooling` left out. B5 settles it, by amendment |
| A8 | Section 11.1 gives the lane's types and the names of three functions. What it left open | `Pointer::parse`'s message never holds the text. `RecordDecl` gains `to_json` and `match_pointer`, which `hash` and the fixture's test use. `extract` runs `RecordDecl::check` first; holds one string at a key pointer to the 1 to 256 bytes and no control character of a list's strings; and gives a wording hash for every kind with a text pointer, standing or not, as 5.1's column and [12.1](#121-store-records-reindex)'s comparison need. `normalise` has `match_digest` beside it. `score` holds `Corpus`, `Posting`, `idf`, `score`, `directed`, `words`, `cosine`, `fused` and `round4`, and a caller gives the postings in the terms' byte order, so every backend adds in one order. **A score with no shared term is 0 and never negative zero**: Rust's empty sum of floats is `-0.0`, which prints as `-0.0000` and serialises as `-0.0`, so `score` folds from `0.0` and `round4` adds `0.0`. **`cosine` answers 0.0 for two vectors of different lengths**, which are not of one model, where section 8.3 speaks only of two unit vectors; it is a floor for a pure function and not a rule a lane may lean on. For B5: a model whose vectors are not `dimensions` long is refused when it is loaded, and a stored vector of another length is another model id's, so a served lane never reaches that 0. `LaneRecord::to_json` writes `dev.umbel/standing` as `null` for a kind without standing. `ModelId` has `parse` and `as_str`. `Evidence`'s shape check is B3's. Every type derives `Debug`, `Clone` and `PartialEq`; only `Standing` has a wire form of its own |
| A9 | Section [11.2](#112-the-sdk) puts the methods in `sdk/src/records.rs` and the three reads on `Reader` "through the `reads!` macro", which is private to `sdk/src/store.rs` | `record_read`, `record_find` and `record_match` are in that macro, in `store.rs`; `records.rs` holds the other five on `Cx` and all eight on `SpaceCx`. `HostServices`' defaults name the grant `records_write` for `record_put_cited`, `record_decide`, `doc_own_mark` and `doc_own_unmark`, `records` for the three reads, and `documents` for `doc_own` |
| A10 | Section [15.1](#151-the-suite-d170) names two fixture files and `lane_fixture.rs` | B1 writes `store/fixtures/lane/records.json`: the five records of section 8.2, each with its access set and key values, section 8.1's three texts and their digest, and section 8.2's two texts with `N`, `L`, the identical ids, and every record's two directed scores and words score. `lane_fixture.rs` recomputes all of it, and holds the first rows to this document's figures as printed. `vectors.json` is left to the step whose suite reads it |
| A11 | The [trajectory refresh](#trajectory-refresh) left unchecked that `unicode-normalization` and `caseless` build for `wasm32-wasip2`, and that the repository's licence policy admits `Unicode-3.0` | Both build for the host (`aarch64-apple-darwin`) and for `wasm32-wasip2`: `cargo build --locked --target wasm32-wasip2 -p umbel-store`, and the gate's component clippy and release builds, which compile both through `umbel-sdk`. Rust 1.97, the crates' minimum, checks them (`cargo +1.97.0 check --locked -p umbel-store -p umbel-sdk --all-targets`). `Cargo.lock` gains the two packages and nothing else: `tinyvec`, which `unicode-normalization` needs, was there. Their tables are Unicode 18.0.0 and Unicode 16.0.0, which `lane_normalise.rs` pins beside the two `=` requirements. Their licences are `(MIT OR Apache-2.0) AND Unicode-3.0`, and `MIT` for `caseless`, which carries a table made from Unicode's `CaseFolding-16.0.0.txt`. **The repository configures no licence policy**: it has no `deny.toml` and no `about.toml`, and no workflow runs a licence check, so there is nothing to hold the two to. `Unicode-3.0` was already in `Cargo.lock`, through `unicode-ident` and the `icu_*` crates |

**An independent review of step B1** (2026-11-12) checked sections 2 and 3 as parsed, `normalise` and `score`, and
the fixture, which it recomputed by itself, and reran part of the gate: formatting, workspace clippy, the
workspace's tests and the `wasm32-wasip2` build of `umbel-store`, not the component clippy leg, the release fixture
builds or the `hello-mcp` build. A focused pass confirmed the blocker closed after seven more attempts to evade it. It found one blocker and six improvements. All seven
are taken:

| # | Finding | Change made |
| --- | --- | --- |
| R1 | Blocker. A root that did not exist was never resolved, so `own = true` passed while its root was missing and another space's covered root reached the same directory through a link; a content write creates missing directories, so a command could then write into the own collection for the rest of the run. `tests/config_v6.rs` pinned the wrong answer for a missing `handbook` | Every root is resolved whether or not it exists (A2); section 3's sentence is replaced; the test is corrected and the reproduced case added, with a missing covered root, a link whose target is missing and a relative link |
| R2 | A2 was a security statement that sat only in the amendment table | Stated in section 3, in 6.2's check 3 and in section 14, with that hosts started at different times can disagree |
| R3 | A3 covered the document store only; the memory store writes the constant too | A3 says so: new memory stores record 3, old ones keep 2, and nothing reads the value |
| R4 | The schema and the host disagreed on a model's `url`: the schema admitted `http://127.999.0.1/x`, a port of 99999 and `https://a_b.example/`; the host admitted `http://[0:0:0:0:0:0:0:1]/x` | One grammar in both (A7), with these cases in `the_schema_refuses_what_the_host_refuses` |
| R5 | `cosine`'s 0.0 for vectors of two lengths, and the control characters refused in a model's `name` and `version`, were in the code and in no document | A8 and A7, with the note for B5 that a dimension mismatch is refused at load |
| R6 | `lane_score.rs` asserted `directed(own, own)` is 1, which is one value divided by itself | The text is scored against a copy of its terms tokenised apart from another spelling, in both directions, and against the corpus's other records, which score below 1 |
| R7 | The Status block said 262 results where the review's run printed 265 result lines, and STATUS.md ended "No Rust built or run" after describing a Rust run | The Status block says what the rerun printed here, 262 lines from 246 test binaries and 16 doc-test runs, and names the review's 265; STATUS.md's sentence is scoped to the specification's writing |

### Amendments from step B2

Step B2 (the lane and finding) found these points this document had given to two steps, had left no way to do, or
had not settled, and took the narrowest reading of each. None changes a decision row. The numbers carry on from
step B1's.

| # | Point | Decision |
| --- | --- | --- |
| A12 | Section [16](#16-implementation-plan) gives B2 "the host's put path (4.2 except steps 6 and 8)", and [15.2](#152-other-tests) puts "the access set and authority the host fills" in `tests/records_put.rs`, which is B2's exit. It also gives "the authority the host fills" to B3. The table's first row, a call that carries the person gate's proof, cannot be filled before B3 makes that proof | B2 fills the authority of a standing kind's put by the table's other three rows (`authority::record_authority`: a human through the library is `person`, any other human `tool`, any other actor `agent`), with version 3 and the delegation chain. B3 adds the first row with `gate_proof`. The host sets the access set, the version and the authority before `seal` runs its check, where section [4.2](#42-what-the-host-does-in-order) writes "seal, then": the stored envelope is the same, and the check then runs over the envelope that is stored, so an access set the plugin sent is never a reason to refuse |
| A13 | Section 16 gives B2 `read_record`, `find_records`, `record_read` and `record_find`, whose signatures carry a `StandingView`, `standings` and `verified_only`, and gives B3 the label, `verified_admits` and the call's `verified_only` | **The store's seam is `store-embedded/src/lane/standing.rs`**, two functions B3 replaces. Until B3 nothing writes a decision or an evidence row, so no standing fact exists: a record of a standing kind is labelled `unverified` with no affirmation and no source, and a view that does not admit `unverified` adds `AND 0` to the statement. **The host's seam is `CallServices::standing_view`**: it admits all three standings and names no own or command-writable collection, and a call that passes `standings` or `verified_only = true` on a standing kind is refused with `RECORD_QUERY_INVALID`, "standings and verified_only are not served yet for a standing kind". It is refused, never answered as if it had not asked. `FindPage.admitted` is the view's `admit`, for a kind without standing too. What B2 does implement of standing, because it is part of a method B2 owns: step 7.4's `WordingFixed`, which `records_put.rs` holds until the `standing` group does; section [4.3](#43-wording-never-changes-d160)'s and [12.1](#121-store-records-reindex)'s clearing of `affirmed_seq` and the evidence row, which are statements over a column and a table nothing fills yet; and `lane_status`'s two counts. A put that carries evidence is `Invalid` in the store until B3. `record_get` and `record_list` are unchanged on a standing kind until B3 |
| A14 | Section [15.1](#151-the-suite-d170) has cases that must pass a bound ("`cut` only when the rarest term's postings pass the bound", "a rebuild stopped after a chunk", and for B4 "`LaneTooBroad` past `STAT_POSTINGS`, with the constant lowered for the case") and names no way to lower one. A put on the embedded store is one synchronised transaction, about 8 ms here: 20 001 postings are minutes, and the suite reaches a backend through its traits alone | `umbel_store::lane::LaneLimits` holds the gather bound, the work cap and the rebuild's chunk, defaulting to this document's constants (`REINDEX_CHUNK = 1 000` and `STAT_TERMS = 500` are named beside the others). A backend holds one: `SqliteStore::with_lane_limits`, which the host never calls. The suite's `Stores` gains `lane: Option<LaneOpen>`, a function the backend supplies that opens the document store of a directory with limits lowered, as `memory_restore` is supplied. **`None` says the backend has no record lane, and the `lane` group is then skipped**, as the index and memory groups are for a backend without them. The store's own in-memory fake (`store/tests/support`) has none: its five lane methods answer `Invalid`. So section [11.1](#111-umbel-store)'s "required, not defaulted" holds for the trait, and "or does not pass the suite" is held by the embedded backend's test, which fails on any skipped case |
| A15 | The suite's "a rebuild stopped after a chunk" needs a rebuild to stop, and the trait has no way to stop one | The case's `scan` unwinds in the second chunk (`resume_unwind`, which prints nothing) and the case catches it. A backend must leave the kind stale when `scan` unwinds, which any rebuild of one transaction a chunk does; **that is a contract on every backend, and `reindex_records`' documentation on the trait states it**, with the other two a rebuild must hold (section [12.1](#121-store-records-reindex)). The `lane` group has 16 cases: section 15.1's, without `put_record_vector`, whose method arrives in B5, and with four more that hold what the list implies: a later put keeps the access set and an unreadable id is taken; records written before a declaration wait for a rebuild, which is section 2's second way to be stale; a reader never sees a record it may not read, by id, by key, by text, ranked, in a total or in a cursor, a record a page; and a ranking counts only what its reader may read, on five records chosen so that counting the two unreadable ones in any statistic changes the order. The last exists because a ranked page carries no score: only its order can show what was counted. `store-embedded/tests/lane_conformance.rs` runs the group alone, in about a second; `conformance.rs` runs it with the rest |
| A16 | Section [7](#7-finding-d164) gives a find's rules and does not say where they are checked, nor settle these: a query whose kind is not the declaration's; a text query on a kind with no text pointer; two filters on one key; the cursor's member order; what `cut`'s limit counts over several fields | The rules are one pure function, `RecordFind::plan` in `store/src/lane/query.rs`, with `Cursor`: the host calls it first, to put `RECORD_QUERY_INVALID` before the rule's text, and every backend calls it again. A kind that is not the declaration's and a text query with nothing to search are refused. Two filters on one key must both pass. `next` is the base64 of the canonical JSON, whose keys are sorted: `{"k":[...],"o":"<order>"}`. Under order `rank` its `k` holds the score at four places as a number. Over several fields the gather's rows are records, as `df0` is: `LIMIT bound + 1` is over distinct lanes |
| A17 | Section [13](#13-failures) has `RECORD_LANE_STALE`'s message name the kind and has `host_error` map `LaneStale`. `host_error` is given a store error and no kind | The record services map `LaneStale` themselves, with the kind. `host_error` keeps a fallback without one, "the lane is being rebuilt or must be rebuilt", and maps `WordingFixed` and `LaneTooBroad`. `command_error` gives the built-in its `RECORD_LANE_STALE`. `EvidenceInvalid` and `ChangeKind::Standing` arrive with B3, by [A3](#amendments-from-step-b1)'s rule |
| A18 | Section [12.1](#121-store-records-reindex) describes the whole command. Section 16 gives B2 the rebuild "without vectors" and B5 "`store-records-reindex`'s vectors". The host's digest table held plugin commands only | In B2 the input is `{ space, plugin?, kind? }` and the output, per kind, is `plugin`, `kind` and the report's six counts. `vectorsOnly`, `meaning` in the output and `RECORD_MODEL_UNAVAILABLE` are B5's. A name that selects nothing is `RECORD_KIND_NOT_DECLARED`; no name where nothing is declared is a success with no kind. A `superseded` rebuild is a success with the warning `RECORD_LANE_STALE`. `digest_commands` gains the built-in, keeping `space`, `plugin` and `kind`. `reindex_records` has the trait's whole signature from B2: until B5 `embedder` is not called and `vectors_only` skips the rebuild and answers the counts. **For B5**: the rebuild also deletes a record's vectors when its match digest is not the one its lane row held, where 12.1 names only a standing kind's changed wording. A vector is of the match value it was embedded for, and a rebuild after an undeclared edit would otherwise leave one for other words |
| A19 | Section 4.2's step 7.6 keeps a lane row "when it exists" and says nothing of a record that is stored and has none, which is what a rebuild leaves of a body `extract` refuses | A put on such a record inserts its lane row with the revision and time of the record's first put, read from the change log in that transaction: one pass, in this case alone, as the rebuild's step 1.2 reads them. So a record indexed late is still as old as it is. **For a standing kind that put is also the one that fixes the record's wording**, since no lane row held one before it; section 4.2's step 7.6 now says both |
| A20 | Section [5.1](#51-tables-embedded-schema-version-2) has the migration set `user_version` and `meta.store_traits_version`. Section [8.1](#81-identical) has `lane_normalisation` written to `meta` and names no moment. Section 15.2 asks for "a version 1 store", and the embedded store had no migration and so no test of one to follow | The opening transaction of a new store and of a version 1 store runs section 5.1's statements and sets both `meta` rows by upsert, so a store that recorded traits version 2 or 3 ends with one row saying 3. `SCHEMA_VERSION` is public. The fixture is `store-embedded/tests/fixtures/store-v1.sql`: the dump of a store written by the code before this step (commit `dd72d6b6`), with a document, three records of one kind under three access sets and one of another. `lane_schema.rs` holds a migrated store's schema to a new store's, statement for statement. `lane_delete_bytes.rs` runs `DELETE FROM records` on a connection with the store's two pragmas, since no service deletes a record before P16, and writes the vector by hand, since vectors are B5's |
| A21 | Section [12.3](#123-doctor-checks) does not say which spaces the two checks read, nor which declaration "a standing kind" means | They read each space that already has a store, as the `stores.*` checks do: the doctor gives no space an empty one. "A standing kind" is the manifest's. The two are skipped without a sealed host, as every store check is |
| A22 | Section 16 calls the Umbel gate "the command list in `AGENTS.md`". The repository's `AGENTS.md` was shortened after this document was written and holds no such list | The gate is the list step B1's Status records, which is the Umbel workflow's main legs, and the workflow's six other clippy legs beside it. The Status block names each command |
| A23 | Section [1](#1-crate-layout-and-versions)'s layout names `store-embedded/src/lane/`'s files as `write.rs`, `read.rs`, `find.rs`, `matching.rs`, `standing.rs` and `reindex.rs` | B2's are `mod.rs` (the kind's state and the clauses every statement shares), `write.rs`, `find.rs` (the read and orders `id` and `recent`), `rank.rs` (order `rank`: section [8.2](#82-words)'s once-a-call part, the gather and the query direction, which B4's `matching.rs` builds on), `standing.rs` (A13's seam), `status.rs` and `reindex.rs`. `src/commands/store_records.rs` holds the command and the doctor's two checks; `src/plugins/record_services.rs` the host's side, compiled with the `store-embedded` feature as the memory services are |

**An independent review of step B2** (2026-11-12) read the step and reran formatting, the workspace's clippy and
the whole workspace's tests, all passing, and ran eight probes on a copy of the two store crates. It found the
migration, interrupted rebuilds, access (but for one statement), section 5.1's SQL, the bound parameters and the
fault-detection claim above sound, and one blocker and eight improvements. All nine are taken:

| # | Finding | Change made |
| --- | --- | --- |
| R8 | Blocker, data safety. Two rebuilds at once under two declarations left the kind ready with the other declaration's lane rows: the later rebuild cleared the stale mark, and the earlier kept writing chunks and only reported `superseded`. In the probe, 10 lane rows of 12 were the wrong declaration's | Each chunk's transaction reads the generation first, and the rebuild stops when it is not its own. `store-embedded/tests/lane_rebuild.rs` reproduces it through a rebuild hook of the `testkit` feature, which runs the second rebuild between the first one's chunks, with no sleep in shipped code; it fails without the check. The same test holds an undeclared put overtaking a rebuild. Section 12.1's "two rebuilds at once are safe" is replaced by what is true and why; section 14 gains the row |
| R9 | Chunks did not bound a writer's wait: the rebuild retook the lock microseconds after each commit while a waiting writer slept up to 100 ms in SQLite's busy handler. Measured on a debug build at 30 000 records: unrelated puts waited up to 5.4 s and 3 of 10 failed as busy | The rebuild pauses 120 ms between chunks, longer than the handler's longest sleep. `lane_rebuild.rs` holds that a writer which starts waiting during one chunk has committed before the next begins; it fails with no pause. Sections 12.1 and 14 state the guarantee, a turn between chunks, and leave every figure to B6 |
| R10 | The rebuild cleared standing only under a standing declaration. A wording edited while undeclared, rebuilt under a declaration without standing and then declared standing again kept `affirmed_seq` on the new wording; a put already cleared it. Not reachable before B3 | The rebuild clears the affirmation, the evidence and the vectors of any record whose wording hash is not the one its lane row held, whatever the declaration, and counts it. `lane_rebuild.rs` holds it on rows written by hand. Section 12.1's step 1.3 and the trait say so. The follow-up for B3 is narrowed to what is still open: a kind whose `standing` changes and whose wording does not |
| R11 | Nothing said that an older host which already holds a store open keeps writing through the old `put_record` after a newer build migrates it, so a declared kind's lane misses those writes with no stale mark; nor that the migration is one-way and runs on any open, `workspace-doctor`'s included | Section 5.1 states both, and what an operator does: stop every older host before a newer build first opens the workspace, and rebuild if in doubt. Section 14 gains the row |
| R12 | Two statements of a ranked find, over its candidates' frequencies and lengths, carried no reader clause. Safe as they stood, since they named only lanes a statement with the clause returned; section 5.3 says every statement | Both carry the reader and the view. Section 5.3 says exactly which statements "every" covers: every one of a read, and not a put's look at the lane row of the record it writes |
| R13 | A forged `recent` cursor holding a revision past 2^63 - 1 passed `RecordFind::plan` and was refused by the store as `Invalid` with no `RECORD_QUERY_INVALID` before it | `Cursor::decode` refuses a revision no store holds, for orders `recent` and `rank`, with the cases in `query.rs`' tests |
| R14 | A chunk's `(?3 IS NULL OR id > ?3)` was likely to read the kind from its start each chunk; a ranked find cloned a string a term a candidate | The chunk is `id > COALESCE(?3, '')`, and a unit test holds its query plan to one range over the primary key with no sort. The frequencies are kept by lane and then by term, and looked up without a clone |
| R15 | The `lane` group had no test that it fails on a broken backend, as the index has | `store-embedded/tests/lane_suite_detects.rs`: the embedded store behind a wrapper that breaks one rule at a time. Eight faults, each failing the case that should catch it, and the unbroken wrapper passing the group |
| R16 | A15 put a contract on every backend without saying so where a backend's author reads, and A19 is also the moment a standing kind's wording becomes fixed | `reindex_records`' documentation on the trait states the three things a rebuild must hold; section 4.2's step 7.6 states A19, and that for a standing kind that put fixes the wording |

### Amendments from step B3

Step B3 (standing) found these points this document had left no way to do, had stated two ways, or had not
settled, and took the narrowest reading of each. None changes a decision row. Two of them, A25 and A26, are the
follow-ups the table at the end addressed to this step. A36 to A40 were made after the step's independent
review, whose table follows this one; A36 replaces A35. The numbers carry on from step B2's.

| # | Point | Decision |
| --- | --- | --- |
| A24 | Section [11.1](#111-umbel-store) gives `decide_record` the result `StandingLabel` and `mark_document_own` the result `Rev`. Section [6.1](#61-affirmed-record_decide) has the host note for the call only a decision that took a revision, and [6.2](#62-the-persons-own) has a mark that changes nothing return the stored `rev` and note nothing. Neither result says whether a revision was taken | The trait's two methods answer what they wrote: `Decided { label, rev: Option<Rev> }` and `Marked { rev, wrote }`, both in `umbel_store::lane`; section 11.1's block says so. The SDK's `record_decide` and `doc_own_mark` keep section [11.2](#112-the-sdk)'s results. The other way, comparing the store's head before and after, would let a write another process made in between be noted for this call |
| A25 | **The follow-up addressed to this step**: a kind whose `standing` changes and whose wording does not. Section [2](#2-declaration-d159) said that changing `standing` costs every standing the kind holds, and [12.3](#123-doctor-checks) had the doctor say so; section [12.1](#121-store-records-reindex)'s rebuild clears a record only when its wording hash is not the one its lane row held | **Only a changed wording costs standing.** Declared with standing, then without, then with it again over the same text pointers, a record whose wording never moved reads affirmed again, with its evidence. This is the smaller of the two choices, and it is D160's own words ("the rebuild takes the affirmation and the evidence from every record whose wording changed"). It keeps D160 because every way a wording can move clears what stood on it: a put on a kind without standing (section [4.3](#43-wording-never-changes-d160)), and a rebuild that finds another wording than its lane row held, whatever the declaration (R10). So a wording that moved and came back has lost its affirmation, and one that kept it is the wording the person saw. It keeps D161 because nothing writes a standing fact while a kind has no standing: `record_decide` and `record_put_cited` are refused there, so an affirmation that is read was written inside a gated call by the space's person. The rebuild's code is unchanged. Sections 2 and 12.3 are corrected. Held by the `standing` group's rebuild case, by `store-embedded/tests/lane_rebuild.rs` (as step B2 left it) and by `tests/records_standing.rs` end to end |
| A26 | **The follow-up addressed to this step**: the doctor said what a rebuild will remove only for a manifest that declares standing, and since R10 the rebuild also removes it under a declaration without standing whose `text` changed | `records.declared` adds the two counts for any stale kind whose stored `text` differs from the manifest's, whatever the manifest declares it as, when the kind holds an affirmation or an evidence row. With A25, a stored `standing` that differs is no longer a reason. A kind that holds neither is told nothing |
| A27 | Section 6.2 gives a mark four checks, in order. Section 11.1 gives `mark_document_own(mark, reader)` no view and no file, so the store can make only the first two | The host makes all four, in order, before it calls the store: it reads the document under the caller's filter (`NotFound`), compares the content hash (`Conflict`), asks `Config::command_writable` for the document's collection, and hashes the file. The store makes checks 1 and 2 again in the transaction that writes the mark. Check 3 is held a second time at every read, by section [6.3](#63-attested)'s clause over the view. An unmark of a document the caller may not read is `NotFound`, as an unmark with no mark is |
| A28 | Section [3](#3-configuration)'s rule 2 and 6.2's check 4 read `<root>/<path>` "through the confined reader `svc_content_read` uses". That service asks the plugin for the `content` grant and counts the bytes toward the call's 64 MiB | The host reads the file for itself (`own_file_hash`, `src/plugins/content.rs`): the same path rules and the same refusal of a symbolic link inside the root, with no grant asked and nothing counted. `<path>` is the document record's `path`. Anything that is not a regular file of the document's size inside the root is a mismatch: a missing file, a directory, a link, a path with `..`, a collection whose root is missing. The file is read only when its length is the document's |
| A29 | Section 6.1 says a step of a pipeline has `None` under its own name, and that `None` is `RECORD_DECISION_NOT_GATED` | Both hold, and a caller never sees the second for a gated step: the plugin gate runs for the step first and refuses it with `CONFIRMATION_REQUIRED`, because the mark names the pipeline. The same is true of a batch. `gate_proof` is the second line: it is what answers when a handler asks for services under a name the call was not decided for (`Services::call`, another command, the same command with another input). It also holds a person-page decision to the surface of the arm that reads it, which `attested` already implies. **What it does not hold, by section 6.1's own design**: that a decision on the person page was for this caller and not another person of the same namespace. That is the ledger's part of `admit`, which the gate ran for this call. **At a terminal it first held no more than the plugin gate's check**, where memory's `person` also asks for the CLI's human-present mark (D86), so a process with a terminal and an agent variable affirmed; step B3 pinned that and put it to the owner, and its review ruled it a blocker: see A37. `CommandPolicy.person` is the command's `person`, or the default (the terminal at the CLI, nothing over MCP). Section [4.2](#42-what-the-host-does-in-order)'s first authority row asks for the proof alone, so a put inside a gated call is `person` whether or not the caller is the space's person |
| A30 | Section 6.1's check 1 answers `RECORD_KIND_NOT_STANDING` for any kind that is not a standing kind of the instance; section [13](#13-failures) answers `RECORD_KIND_NOT_DECLARED` for a lane service on an undeclared kind | `record_decide` follows 6.1: one check, one code, declared or not. `record_put_cited` follows 13: `RECORD_KIND_NOT_DECLARED` for a kind the manifest does not declare, `RECORD_KIND_NOT_STANDING` for one it declares without standing. `record_get` and `record_list` are refused on a standing kind after the grant and the space are checked, for a `Reader` too; step B2's test that listed a standing kind through `record_list` now holds the refusal |
| A31 | Section 4.2 has the evidence's shape checked in step 6 and its document in step 7.5, and section 13 gives one code for both. What it left open | `Evidence::check` is in `umbel-store` ([A8](#amendments-from-step-b1) left it to this step), and the host and the store both call it. `StoreError::EvidenceInvalid` carries the rule and never a value. **An absent document, one the writer may not read and one with another content hash get one message**, so a refusal says nothing of a document the writer may not read. The store refuses evidence on a kind without standing as `Invalid`. `ChangeKind::Standing` arrives here ([A3](#amendments-from-step-b1), [A17](#amendments-from-step-b2)): `changes` reads it, and no reader of changes acts on it |
| A32 | Section [7](#7-finding-d164) reads a page's labels by "a second statement over `record_evidence` and `documents`", and section [5.3](#53-the-reader-clause) asks the reader clause of every statement of a read | A page's labels are two statements over its lanes: the decisions that affirm them, and the sources that attest them. Both join `record_lane l` and carry the reader clause again, as R12 settled for a ranked find. A lane row whose `affirmed_seq` names no decision row was first `Corrupt`; since the review it is a record that is not affirmed (A38). `record_decide` computes its answer with the same statements, under the caller's filter and with no standing clause. The seam step B2 left, `store-embedded/src/lane/standing.rs`, now holds the label, the clause, the decision, the marks and the evidence's check |
| A33 | Section [12.3](#123-doctor-checks) does not say which spaces `records.standing` reads, nor what it says of a person | It reads every declared space, with or without a store, since it reads the configuration and the loaded manifests alone; it runs on a sealed host, as the other two do. It lists, for each space where a standing kind is enabled, the kinds, the own collections, the command-writable ones and `verified_admits`. **It says whether a person is set and never who.** The three checks are reported in the order `records.declared`, `records.standing`, `records.size` |
| A34 | Section [15.1](#151-the-suite-d170) lists the `standing` group's cases | The group has 16 cases, after `lane` (14 before the step's review, which added the two of A36 and A38). They are section 15.1's, with `match_records` left to step B4, whose method it is, and with these made explicit: a decision on a record its reader may not read is `NotFound` and writes nothing, under any `admit`; a mark's first two checks; a deleted document loses its mark for good; nothing a body holds is read as standing; and a wording that moved and came back while its kind had no standing has lost its affirmation (A25). `store-embedded/tests/lane_conformance.rs` runs the group alone, and `lane_suite_detects.rs` holds that it fails on eight broken backends (six before the review). The group builds each `StandingView` itself: that the host builds the right one from a configuration is `tests/records_standing.rs`' |
| A35 | **A limit this step found, and states.** Section 3's rule 2 is checked when a document is put. A document stored before its collection was named `own`, or stored by `doc_put` with no file while it was not, was never held to it, and reads as the person's own by collection from the moment the deployer sets `own = true`. Section 3's "what was written before" spoke of files only | Stated in section 3 and in section [14](#14-security), as the deployer's: naming a collection `own` is saying that the documents stored for it now are the person's, as well as the files. `tests/records_own_source.rs` holds what is true: every put from then on is held to the file. A doctor check that compares the stored documents of each own collection with their files would turn the statement into a check; it is a [follow-up](#follow-ups) **Superseded after the step's review by A36**: the review reproduced the gap as an attack, and it is closed, not stated |
| A36 | **Replaces A35's stated gap** (the review's second blocker). A call stored `journal/unfiled` with no file on disk and `journal/roses` differing from its file, and cited both, while `journal` was not own; after `own = true` alone both records read attested and passed `verified_only`. Section 3's rule 2 was a check at each put, and "own by collection" read the configuration alone | **The host keeps, for each document, the fact that it held its current content to its file on disk**, and "own by collection" asks for it (sections 3, 6.2 and 6.3). The fact is one row of a new table, `doc_held`, naming the content hash: embedded schema version 3, with a migration that leaves it empty and a test on the dump of a version 2 store (5.1). It is a table and not a column of `documents`, which the ruling's words allow either way, because a migrated store must have a new store's schema statement for statement. It is written in three places and nowhere else: `put_document_held`, which `svc_doc_put` calls for an own collection after rule 2 passed, in the put's transaction; `hold_document`, after a mark's fourth check passed; and `hold_document` from `store-documents-hold` (12.5), a CLI-only, operator-only built-in that compares each stored document of one own collection with its file and reports three counts and never text. Any other put clears the fact, and a deleted document loses it. The doctor's `records.own` counts the documents of own collections not yet held and names the command (12.3). `DocumentStore` gains the three methods under traits version 3 (11.1). Held by the suite's case, by `tests/records_standing.rs`, which pins the review's probe as refused, by `tests/records_own_source.rs`, and by `plugins/sources-filesystem/tests/own_collection.rs`, which runs the real `sources-sync` against an own collection: add, unchanged, update and delete, with a byte order mark and CRLF line endings, each put as the file is on disk and each held to it |
| A37 | **The review's first blocker, ruled.** Section 6.1 made the terminal's proof the plugin gate's own check. A process at a terminal with an agent variable set answers the `require-human` prompt and passes that gate, so it affirmed and marked, where memory's `person` refuses it (D86) | `gate_proof`'s terminal row also asks that the CLI's human-present mark name the command (`authority::cli_mark`, now `pub(crate)`), which the CLI sets only for a human at a terminal with no agent variable. So `gate_proof` no longer has exactly the gate's arms: at a terminal it is stricter, and a call the gate passed can be `RECORD_DECISION_NOT_GATED`. Section 6.1's table and text say so; section 14 states what remains as D74's and D86's limit, an agent that unsets the variable and holds a pseudo-terminal, with `person = { cli = "verified" }` as the answer where that matters; section 18 has row 24. `tests/records_standing.rs` pins the refusal for each built-in variable and a configured one, for `affirm`, `mark` and `unmark`, and that a put inside such a call is not `person` |
| A38 | **Affirmed was stored and not read** (the review's third and sixth findings). A lane row's `affirmed_seq` was read as standing by itself: after `spaces.<id>.person` changed, the former person's affirmations and marks still counted; and the decision was joined on its sequence number alone, so D160 was held at each write and not at each read | Affirmed is read as attested is (section 6): the decision the row names must be an affirmation, of the wording hash the row holds, by one of the principals the space's person decides as. `StandingView` gains `person`, which the host fills with the configured `person` and the principal `[principal.equivalents]` maps it to: the same list section 6.1's check 3 holds the caller to, so what a decision is recorded under is what a read counts. A mark is held to it too. A space with no person reads nothing affirmed and no mark. So that the new person can decide: `Affirm` writes whenever the record does not read affirmed, `Withdraw` whenever the row names a decision, and a mark by another person on the same content is a new mark. Held by the suite's case, by `tests/records_standing.rs`, and by `store-embedded/tests/lane_standing_rows.rs` on rows written by hand: another wording, another record's decision, a withdrawal, a decision that is not stored, another person |
| A39 | **The label named the person to every reader** (the review's fourth finding, and this step's own follow-up): `affirmed.by`, and for a decision on the person page the namespace, the login's time and its `acr`, while section 12.4 has `workspace-show` say only whether a space has a person | `Affirmation` is `at`, `level` and an optional `seen` with `by` and the whole assurance (11.1). The store answers it whole. The host's `record_read` and `record_find` take `seen` away unless the reader is the operator or the space's person; a read as another principal is that principal's (6.5). `record_decide` answers its caller. Tested for both readers at a terminal and on the person page |
| A40 | **The host read a file before the document's size was checked** (the review's fifth finding, on A28): rule 2 ran on the plugin's `doc.size` before `DocumentWrite::check` | `svc_doc_put` refuses a document of an own collection whose `size` is not the length of its bytes, or whose bytes pass `MAX_DOCUMENT_BYTES`, before any file is read, and the file reader refuses a size past the largest document. A mark's fourth check reads the size of a stored document, which the store already checked |

**An independent security review of step B3** (2026-11-12) confirmed the finding this step had put to the owner,
that at a terminal an agent variable did not withhold the proof, and found one more blocker; it reproduced both
by probe. What else it attacked held: a nested call, another command and another input, a step of a batch and of
a pipeline, MCP with no decision, a forged mark and the CLI with no terminal; attested never stored, and lapsing
on every change; the evidence's refusals alike; no tier name in a label; `verified_only` never wider than
`verified_admits`; and the reader clause in every new statement. It put eight faults of its own into the code,
and each was caught. Two blockers and six improvements, all taken:

| # | Finding | Change made |
| --- | --- | --- |
| R17 | Blocker, ruled. A process at a terminal with an agent variable set affirmed and marked: section 6.1's terminal proof was the plugin gate's check alone. Standing is to be at least as strict as memory's person-gated commands | The terminal row of `gate_proof` also asks for the CLI's human-present mark (A37). The test that pinned the old behaviour pins the refusal; sections 6.1, 14 and 18 (row 24) say what holds and what remains |
| R18 | Blocker (A35). A document stored before `own = true` attested an agent's records: a call stored one document with no file and one differing from its file, cited both while the collection was not own, and after the configuration change alone both read attested and passed `verifiedOnly` | A host-only fact that a document was held to its file, on a row of its own beside `documents`, required by the collection arm and by `document_own`, set at a put that passed rule 2 and by a mark's fourth check; schema version 3 with its migration test; `store-documents-hold` and the doctor's `records.own` for adoption (A36). The probe is pinned as refused |
| R19 | A former person's decisions kept counting after `spaces.<id>.person` changed | The view carries the person's identities, and a decision and a mark count only when made by one of them (A38); sections 6 and 18 (row 25) say that changing a space's person sets the former person's decisions aside |
| R20 | `affirmed.by`, and a verified decision's namespace, `authTime` and `acr`, were shown to every reader of the record | `at` and the assurance's level for every reader; the rest for the operator and the person only (A39) |
| R21 | The host read the file before the document's size was checked, on the plugin's `doc.size` (A28) | The size is held to the bytes sent and to the largest document first (A40) |
| R22 | The affirmation was not bound to the wording at read: the decision was joined on its sequence number alone | `decision = 'affirm'` and the lane row's wording hash are conditions of the read (A38), with a test on hand-written rows |
| R23 | Two tests were missing: the real `sources-sync` against an own collection, and the pin for the second blocker | `plugins/sources-filesystem/tests/own_collection.rs` (add, unchanged, update, delete, with a byte order mark and CRLF) and `tests/records_standing.rs`' pin (A36) |
| R24 | A25 is sound and reverses section 2 | Put to the owner in section 18, row 26, with the cost of the other way |

## What this specification serves

The goal, from the plan: a thought captured through any agent lands at once, lasts, can be found by field and by
text, is matched against what is already held, and is never read as more than it is.

| Principle | How this serves it |
| --- | --- |
| 1. Empty host | The host gains services about records in general: declare, index, find, match, label. It learns nothing about ideas. The plugin holds every domain rule |
| 2. Plugins are the unit | A plugin declares its record kinds in its manifest and reaches them through the `records` and `records_write` grants it already declares. No new grant |
| 4. No model in the request path | Finding and the words score are deterministic. An embedding of the incoming text may run in the request when the deployer configures a model; it writes no text and makes no judgment (D168) |
| 6. Deterministic core | The same records, reader, query and model give the same bytes: scores at four places, ties by id |
| 7. Provenance on everything | A declared record keeps the envelope. For a standing kind the host fills its authority (D169) |
| 8. Durable knowledge changes by proposal, or carries its standing | Standing is computed at each read from facts only the host writes, and labelled on every read (D161) |
| 9. Stored content is untrusted input | Nothing a call passes decides standing. Text is scanned at put and flagged. The host's services put no text in the journal, an event or an error, and a plugin that declares a kind must state a journal mode on every command (D169, D72) |
| 10. Permission-aware | The reader filter is a clause of every statement, and statistics count only what the reader may read (D163, D125) |
| 11. Stateless and horizontal | No cache and no session: a put is findable when it returns, in the same database |
| 12. Small surfaces, measured | A meaning lane is turned on only by an instance's own measurement (D167) |
| 13. Same interface at every scale | Scoring lives in `umbel-store`, in Rust, so a second backend computes the same numbers |
| 16. Spaces do not mix | Every table is in the space's own store; a model's vectors are per space |

Decisions served: D9, D42, D53, D55, D63, D65, D68, D70, D71, D72, D74, D115, D125, D150 and D157. New: D158 to
D171. Open decision O4 gains an answer for record lanes and stays open for knowledge search.

## Trajectory refresh

What the design leans on outside this repository, what was checked on 2026-11-11 and how, and what was not.

| Fact | Checked, and how | Not checked; do it at implementation |
| --- | --- | --- |
| SQLite: `STRICT`, `WITHOUT ROWID`, partial indexes, `secure_delete`, the JSON functions | Each is already used by the embedded store (`store-embedded/src/schema.rs`, `connection.rs:120`), on rusqlite 0.41 with `bundled` (`store-embedded/Cargo.toml:15`), which the architecture's libraries table gives as SQLite 3.54.1. `json_extract`, the tables and 6.3's clause were run on SQLite 3.54.0 | Size and time of the term table at 100 000 records. Step B6 measures it |
| FTS5 | **Not used by this lane** (D163), so no FTS5 option is leaned on. Its tokenizer's rules are, through the Rust port in `store/src/memory/tokenizer.rs`, which `store/tests/memory_tokenizer.rs` holds to FTS5's own tokens | Nothing |
| `fastembed` (the ONNX provider) | `cargo info`: 7.7.0, Apache-2.0, Rust 1.88. Its source: `TextEmbedding::try_new_from_user_defined(UserDefinedEmbeddingModel, InitOptionsUserDefined)` takes the model and tokenizer files as bytes; every network path is behind the `hf-hub` feature; `ort` is pinned at `=2.0.0-rc.15`; `embed` takes `&mut self`. The architecture's table said 7.5 | That it builds on the workspace's toolchain with `default-features = false`; which TLS stack `ort/tls-rustls` brings; the size it adds; the licence of the ONNX Runtime binary the build fetches; each model's own licence, which is the deployer's to check |
| `model2vec-rs` (the static provider) | `cargo info` and its source: 0.4.0, Rust 1.88, an MIT `LICENSE` file (crates.io shows no SPDX expression). `StaticModel::from_bytes(tokenizer, model, config, normalize)`, `encode`, `dim`; the feature `local-only` compiles out its downloads. It depends on `tokenizers` 0.21 and `safetensors` 0.5 | That its vectors equal the Python library's for `potion-base-8M`, which is what phase 0 measured: compare with `match.py embed` on a fixed list. That `tokenizers` builds without `onig`. The model's licence |
| `unicode-normalization`, `caseless` (the identical digest) | `cargo info` and source: 0.1.26, `(MIT OR Apache-2.0) AND Unicode-3.0`, tables for Unicode 18.0.0; and 0.2.2, MIT, case folding for Unicode 16.0.0. Neither is in `Cargo.lock` today | That both build for `wasm32-wasip2`, which `umbel-store` must (`store/src/lib.rs:8`); that the repository's licence policy admits `Unicode-3.0`. **Checked in step B1** ([A11](#amendments-from-step-b1)): both build for it, and the repository configures no licence policy |
| `reqwest` (the HTTP provider) | 0.13.5 is in `Cargo.lock` for the `auth` and `mounted` features, and its manifest has a `blocking` feature | That `blocking` composes with the host's runtime when called from a blocking thread |
| Phase 0's figures | Read from its [results](../../../../../docs/features/active/ideas/prototype/README.md): across documents, 35 probes with a duplicate; within five candidates, words alone 0.886, fused 0.914 to 0.971; model labels, pooled pairs | They are indicative only (D167). The owner's check of the labels is queued (Ideas status, Q5) |
| The phase 0 tokenizer | `match.py` tokenises with `[A-Za-z0-9]+`, drops tokens over 40 characters and stems with Snowball's English stemmer | **How much the lane's tokenizer changes the phase 0 rates.** The lane uses the memory tokenizer, which is Porter's first stemmer over `unicode61` tokens (section [8.2](#82-words)). Step B6 reruns phase 0's pairs |

No row of the [trajectory watch](../../trajectory.md) is touched: no MCP surface, no client behaviour and no
standard is leaned on here.

## Terms

| Term | Meaning |
| --- | --- |
| Declared kind | A record kind of a plugin's own namespace that its manifest lists under `[[records]]` (D159) |
| Standing kind | A declared kind with `standing = true`: its records are D157's standing records |
| Lane | The host's index of a declared kind's records in the space's document store: their terms, keys, digests and vectors (D163). Not the knowledge index and not memory's lane |
| Text pointer, key pointer | A path into a record's body that the declaration names: a text pointer's string is indexed by words; a key pointer's values are filtered on exactly |
| Match field | The one text pointer a declaration names as `match`: the field `record_match` compares |
| Wording | The values at a standing kind's text pointers. Fixed by the first put (D160) |
| Evidence | What a put may say about where a wording came from: a document, its content hash, unit numbers, the rule's version, the speaker, and whether the plugin found the wording to be exactly those units (D161) |
| Unit | A numbered piece of a document under the plugin's own rule, such as a sentence. The host stores the numbers and does not interpret them |
| The person | The one person a space is configured for, `[spaces.<id>] person` (D161) |
| Own | A document is the person's own now when it lies in a collection configured `own`, or the person marked it and no command writes files where it lies (section [6.2](#62-the-persons-own)) |
| Command-writable | Said of a collection that some `content_write` allow covers, or whose root overlaps one that is covered, in any space (section 3) |
| Verified content only | A read that returns only what the space's `verified_admits` names: affirmed records, or affirmed and attested ones. Asked for by the call, never set for a whole space (6.6) |
| Label | The `StandingLabel` the host computes for a record at each read: `unverified`, `attested` or `affirmed`, with what backs it |
| Words, meaning, fused | The three scores of a match (section [8](#8-matching-d165)) |
| Model id | A configured embedding model's name with a digest of everything that could change its vectors (section [9.2](#92-models-in-the-configuration)) |
| Probe | A text with the ids of its true duplicates, which the gate scores (section [10](#10-the-gate-for-a-meaning-lane-d167)) |

## 1. Crate layout and versions

```text
endpoints/umbel/
├── store/src/
│   ├── lane.rs               # new: RecordDecl, Pointer, Evidence, Standing, StandingLabel, LaneRecord,
│   │                         #      RecordFind, RecordMatch, MatchResult, OwnInfo, the limits
│   ├── lane/extract.rs       # new: a body's text values, key values, wording hash, match digest, terms
│   ├── lane/normalise.rs     # new: the identical digest's normalisation
│   ├── lane/score.rs         # new: BM25, the directed and the symmetric words score, cosine, fusing
│   ├── embed.rs              # new: Embedder, ModelId, EmbedError
│   ├── traits.rs             # DocumentStore gains eleven methods (section 11)
│   └── conformance/          # new groups: lane.rs, standing.rs, matching.rs; fixtures in store/fixtures/lane/
├── store-embedded/src/
│   ├── schema.rs             # schema version 2: the tables of section 5
│   └── lane/                 # new: write.rs, read.rs, find.rs, matching.rs, standing.rs, reindex.rs
├── embed/                    # new crate `umbel-embed`: the providers, each behind a feature
├── sdk/src/records.rs        # new: the Cx methods of section 11.2
├── src/plugins/manifest/v6.rs        # new: [[records]]
├── src/plugins/record_services.rs    # new: the host side of every service here
├── src/commands/store_records.rs     # new: store-records-reindex, store-records-eval
└── schemas/                  # plugin-manifest.v6.json, workspace-config.v6.json, record-probes.v1.json,
                              # record-eval-report.v1.json
```

| Version | Now | Becomes | Where |
| --- | --- | --- | --- |
| Manifest | 5 (`src/plugins/mod.rs:70`) | 6 | Section [2](#2-declaration-d159) |
| Workspace configuration | 5 (`src/workspace/config.rs:33`) | 6 | Section [3](#3-configuration) |
| Store traits | 2 (`store/src/lib.rs:52`) | 3 | Section [11](#11-traits-and-the-sdk) |
| Embedded store schema | 1 (`store-embedded/src/schema.rs:4`) | 2, and 3 after step B3's review (`doc_held`) | Section [5](#5-the-lane-d163) |
| Plugin protocol, WIT world, envelope, event, document record | unchanged | unchanged | |

**Phase 6 names two of the same numbers** (D170). Its specification proposes store traits version 3 (D133) and
workspace configuration version 6 (D142), with `workspace-config.v6.json`. Neither is implemented. Whichever of the
two specifications lands a number second takes the next one, renames its schema file and its constants, and records
the change as an amendment in its own document. This document's additions do not depend on phase 6's, nor phase 6's
on these. The phase 6 specification is not edited here.

New dependencies, all optional except the first two:

| Crate | In | Feature | Why |
| --- | --- | --- | --- |
| `unicode-normalization` `=0.1.26`, `caseless` `=0.2.2` | `umbel-store` | always | The identical digest (8.1). Pinned exactly: a table change would change stored digests |
| `model2vec-rs` 0.4, `default-features = false`, features `local-only` and one of `onig` or `fancy-regex` | `umbel-embed` | `static` | The static provider |
| `fastembed` 7.7, `default-features = false`, feature `ort-download-binaries-rustls-tls` | `umbel-embed` | `onnx` | The ONNX provider. If the build may not fetch, `ort-load-dynamic` and a deployer-supplied ONNX Runtime |
| `reqwest` 0.13, features `rustls` and `blocking` | `umbel-embed` | `http` | The HTTP provider |

The `umbel` crate gains the features `embed-static`, `embed-onnx` and `embed-http`, each `["dep:umbel-embed",
"umbel-embed/<name>"]`. None is in `default`. `umbel-first-party` enables none; the instance's operator builds with
the one its eval chose.

## 2. Declaration (D159)

Manifest version 6 adds one top-level key, an array of tables:

```toml
manifest_version = 6

[[records]]
kind = "note"
standing = true
text = ["/statement"]
keys = ["/bed", "/tags", "/source"]
match = "/statement"
```

| Key | Type | Rule |
| --- | --- | --- |
| `kind` | string | `^[a-z][a-z0-9-]{0,62}$` (`is_slug`, `store/src/document.rs:309`). Unique in the manifest. At most 16 entries |
| `standing` | bool | Default `false`. `true` needs at least one `text` pointer |
| `text` | array of pointers | 0 to 4, distinct |
| `keys` | array of pointers | 0 to 16, distinct, none also in `text` |
| `match` | pointer | Optional. One of `text` |

A **pointer** is `/` followed by one to four member names joined by `/`, each `^[A-Za-z_][A-Za-z0-9_]{0,63}$`, at
most 128 bytes in all. It names object members only: no array index and no `~` escape. This is a subset of RFC 6901
that needs no unescaping.

Rules the parser applies, each a `PLUGIN_MANIFEST_INVALID` naming the key:

| Rule | Key named | Problem text |
| --- | --- | --- |
| `records` in manifest versions 1 to 5 | `records` | `is reserved (a declared record kind needs manifest_version = 6); manifest version <n> does not define it` |
| `plugin.kind` is not `compiled` | `records` | `is for compiled plugins only in protocol 1: a declared kind's standing rests on the plugin's code running in the host's process (D162)` |
| `records` or `records_write` is not in `[[grants]]` | `records` | `needs the grants records and records_write declared in [[grants]]` |
| An entry with no `text`, no `keys` and `standing = false` | `records[i]` | `declares nothing: give text, keys or standing` |
| A command or pipeline without `journal` | `commands[i].journal`, `pipelines[i].journal` | `is required: a plugin that declares a record kind declares journal = { mode = "digest" } or { mode = "plain" } on every command and pipeline` |

The first follows `check_versioned_keys` (`src/plugins/manifest.rs:996`): `Manifest::parse` checks the top keys with
it, passing `(6, v6::TOP_KEYS_V6)`, where today it calls `check_keys` (`manifest.rs:719`). The second is refused at
parse, not at load: memory's grants are refused for a component at load, as an unavailable grant
(`src/plugins/loader.rs:1144`), and a declaration is not a grant. The last is memory's rule (`manifest.rs:851`, D72)
for the same reason: a record's text must not reach the journal.

`src/plugins/manifest/v6.rs` parses the entries into `umbel_store::lane::RecordDecl` (section 11.1) and
`Manifest` gains `records: Vec<RecordDecl>`. `MANIFEST_VERSION` becomes 6 and `MANIFEST_VERSIONS` `[1, 2, 3, 4, 5, 6]`.
`schemas/plugin-manifest.v6.json` is version 5's with `records`. The loader copies the declarations into
`Shared.records: BTreeMap<String, RecordDecl>` (`src/plugins/grants.rs:66`) and sets `GateEntry.lane_writer`
(`src/plugins/loader.rs:146`) for a plugin with any entry.

**An undeclared kind behaves as today**: `record_put`, `record_get` and `record_list` do what they do now. One
thing is new, and only for a kind that was once declared: an undeclared put marks its `record_kinds` row stale
(below). A kind that was never declared has no such row, and for it no table of section 5 is touched.

**A declaration that changes.** The store keeps each kind's declaration hash, a stale mark and a generation
counter (5.1). A kind is *stale* when its stored hash differs from the manifest's, when it holds records written
before it was declared, when a record of it was written while it was not declared, or while a rebuild of it is
under way. For the third, `put_record`, the path an undeclared kind takes, sets the stale mark of any kind that has
a `record_kinds` row **and adds one to its generation**, in the same transaction as its write. So a plugin version
that drops a declaration, edits a wording and declares the kind again finds it stale, and the rebuild takes the
standing from every record whose wording changed (12.1). Every lane service on a stale kind answers
`RECORD_LANE_STALE` until `store-records-reindex` rebuilds it. A put on a stale kind is refused too, so a lane is
never half one declaration and half another.

**Changing `text` costs every standing the kind holds.** The wording hash is taken over the values at
the text pointers in declaration order (4.3), so adding, removing, reordering or renaming a text pointer changes
the wording hash of every record, and the rebuild then removes every affirmation and every evidence row of the
kind, whatever the kind is declared as when it runs. That is right, since what the person affirmed was the old
wording, and it is not recoverable. So before a deployer runs the rebuild, the doctor's `records.declared` says,
for a stale kind whose stored `text` differs from the manifest's and that holds an affirmation or an evidence
row: how many affirmations and how many evidence rows the rebuild will remove (12.3). Changing `keys` or `match`
costs none.

**Changing `standing` alone costs none** (amended in step B3, [A25](#amendments-from-step-b3); this paragraph
had it cost every standing the kind holds, which the rebuild never did). A kind declared with standing, then
without, then with it again over the same text pointers keeps the affirmation and the evidence of every record
whose wording did not move in between, and such a record reads affirmed again. While the kind has no standing
its records carry no label, nothing can be affirmed or cited, and a put that changes a wording clears what stood
on the old one (4.3). So what survives is an affirmation of the wording the person decided on.

## 3. Configuration

Workspace configuration version 6 adds these keys. Each is refused in versions 1 to 5 with `needs config_version =
6`, as version 5's keys are (`src/workspace/config.rs:584`).

```toml
config_version = 6

[spaces.garden]
person = "human:local"
verified_admits = "affirmed"

[spaces.garden.collections.journal]
root = "content/journal"
own = true

[spaces.garden.collections.talks]
root = "content/talks"
own = true
speaker = "Gardener"

[spaces.garden.meaning]
model = "potion"
weight = 0.5
k = 5

[models.potion]
provider = "static"
name = "potion-base-8m"
dir = "models/potion-base-8m"

[models.potion.files]
"model.safetensors" = "sha256:<64 hex>"
"tokenizer.json" = "sha256:<64 hex>"
"config.json" = "sha256:<64 hex>"

[plugins.notes.grants.records_write]
allow = ["garden"]
default_access = "private"
```

| Key | Type, default | Rule |
| --- | --- | --- |
| `spaces.<id>.person` | principal string, none | `human:<id>`, parsed as every principal string is. The one person whose decisions give standing in the space |
| `spaces.<id>.verified_admits` | `affirmed` or `affirmed+attested`; default `affirmed` | What "verified content only" means in the space: what a call that asks for it is given (6.6). There is no setting that asks for every read |
| `spaces.<id>.collections.<cid>.own` | bool, `false` | Needs the space's `person`. See the two rules below |
| `spaces.<id>.collections.<cid>.speaker` | string, none | 1 to 128 characters, no control character. Only with `own = true`. Which part of each document is the person's, for a plugin's rule to use |
| `spaces.<id>.meaning.model` | a `[models]` id | Required in the table |
| `spaces.<id>.meaning.weight` | number 0 to 1, default 0.5 | `w` of the fused score (8.3) |
| `spaces.<id>.meaning.k` | integer 1 to 20, default 5 | The `k` within which the gate counts a probe's duplicate as found (10) |
| `models.<mid>` | table | `<mid>` matches `^[a-z][a-z0-9-]{0,31}$`. Section [9.2](#92-models-in-the-configuration) |
| `plugins.<iid>.grants.records_write.default_access` | `private` or `space`; default `private` | The access set the host gives a declared kind's record (4.2) |

Two rules make "own" mean something the host can stand behind. Both are new, and both follow from who writes
documents today: `sources-sync` reads files from disk, and the knowledge plugin's proposal apply writes a command's
input as a file and a document (`plugins/knowledge/src/proposal/apply.rs:761`).

A collection is **command-writable** when some enabled instance's `grants.content_write.allow` covers it, or covers
any collection of any space whose root overlaps its root. An allow entry covers `<space>/<cid>` when it is that
string or `<space>/*` (`allows`, `src/plugins/store_services.rs:32`). Two roots overlap when they are equal or one
contains the other, as written (`roots_overlap`, `src/workspace/config.rs:1250`) or once resolved, a root that does
not exist yet to where it would be created (rule 1 below). The check runs across spaces: today's overlap check is within one space only (`config.rs:1046`,
`:1341`), so two spaces may share a directory, and a file written through one is a file of the other.

1. **No command writes files into an own collection.** A collection with `own = true` that is command-writable is
   `WORKSPACE_CONFIG_INVALID` at `spaces.<id>.collections.<cid>.own`: "a collection named as the person's own may
   not be written through content_write (plugins.<iid>.grants.content_write covers `<space>/<cid>`, whose root
   overlaps it): a command's input would become a file there". Both forms are checked when the configuration is
   read, which a host does at its start. **A root that does not exist yet is resolved to where it would be
   created** (amended in step B1, [A2](#amendments-from-step-b1)): a content write creates the directories its path lacks
   (`src/plugins/content.rs:238`), so a missing root is already a place a command can write to. Each root is
   followed through every symbolic link on its way: the part that exists is resolved as the file system resolves
   it, a link whose target is missing is followed to where the target would be, and the segments after the last one
   that exists are taken as written. This replaces "a root that does not exist yet is checked when it does, at the
   next start", under which a missing own root passed while another space's covered root reached its directory
   through a link, and a command could then write into the own collection for the rest of the run. So an own
   collection takes no knowledge proposal and no verification write, and neither does any collection that shares
   its directory.
2. **A document put into an own collection equals its file.** `svc_doc_put` (`store_services.rs:367`), for a document
   whose collection is `own`, reads `<root>/<path>` through the confined reader `svc_content_read` uses
   (`src/plugins/content.rs:134`) and refuses the put unless the SHA-256 of those bytes is the document's
   `contentHash`: `HostError::Invalid`, code `STORE_OWN_SOURCE_MISMATCH`. A file that changed between a sync's read
   and its put is refused once and stored by the next sync. **The document's `size` is held to the bytes sent and
   to the largest document before any file is read** (after step B3's review): the size is the plugin's word
   until the store checks it, and the host reads a file of that length.

   **A put that passes is stored with the fact that the host held it to its file** (after step B3's review,
   [A36](#amendments-from-step-b3)): one row of `doc_held` (5.1), written in the put's own transaction through
   `DocumentStore::put_document_held`, naming the content hash. Any other put of the document clears it, and a
   deleted document loses it. **A document of an own collection is the person's own by collection only while
   that fact holds for its current content** (6.2). So a document that was stored before its collection was named
   `own`, or by a `doc_put` with no file while it was not, attests nothing when the deployer sets `own = true`:
   nothing held it to a file. `umbel store-documents-hold` (12.5) is how an operator has the host compare the
   documents a collection already holds with their files; a sync does not, since it skips a file that did not
   change.

A person's mark (6.2) is held to the same two things, for the same reason.

What these do not establish, each the deployer's:

- **Who typed the file.** A shell on the machine can put any file in the collection's root (D157 says so, as D74
  does of memory's files).
- **What was written before.** Command-writable is judged on the configuration as it is now. The host keeps no
  history of it. A file written through `content_write` while a collection was covered stays on disk after the
  allow is removed, and then `own`, or a mark, passes both rules. A deployer who names a collection `own`, or takes
  a `content_write` allow away, is saying the files there now are the person's.
- **What `store-documents-hold` finds equal** (after step B3's review, [A36](#amendments-from-step-b3), which
  replaces the gap A35 stated). A stored document that equals its file is held to it, whoever put it and whenever.
  A file a command wrote while the collection was covered, left there and synced, is such a file: this is the
  bullet above, seen from the document. A stored document with no file, or one that differs from its file, is
  never held.
- **What changes under a running host** (stated in step B1, [A2](#amendments-from-step-b1)). A host judges which collections are
  command-writable once, when it reads the configuration at its start, with the symbolic links as they are then,
  and keeps that answer for its life (`Config::command_writable`). A link made, moved or removed while it runs
  changes which directory a root reaches, and the host does not see it until its next start. **Two hosts over one
  workspace that started at different times can therefore disagree** about the same collection: one refuses a
  configuration, or a mark, that the other accepts, until both have restarted. Changing links under a running host
  is the deployer's, as a shell on the machine is.
  One more case is known and left (found in B1's focused review): on a volume that ignores case, two paths that do
  not yet exist and differ only in case are judged apart. A covered link to a missing `content/JOURNAL` beside an
  own root `content/journal` passes until someone creates the directory, and the next start then refuses the
  configuration. No command can make that directory through the link's spelling alone.

Keeping an own collection free of text the person did not write is the deployer's.

In code: `CONFIG_VERSION` 6 and `CONFIG_VERSIONS` `[1, …, 6]`; `SPACE_KEYS_V6`, `COLLECTION_KEYS_V6` and `TOP_KEYS_V6`
beside the version 3 and 5 lists (`config.rs:52` to `57`, `hosted.rs:33`); `RECORDS_WRITE_GRANT_KEYS_V6` beside
`MEMORY_WRITE_GRANT_KEYS_V5` (`src/workspace/plugins_config.rs:70`); `CollectionConfig` gains `own: bool` and
`speaker: Option<String>`, `SpaceConfig` gains `person`, `verified_admits` and `meaning`; `umbel
init` writes version 6. `Config` gains `command_writable(space, collection) -> bool`, which both rules and 6.2 use.
`schemas/workspace-config.v6.json` is version 5's with these keys.

## 4. Writing a declared record

### 4.1 The services

`record_put` keeps its signature (`sdk/src/store.rs:428`). For a declared kind the host does the steps of 4.2.
One new service carries evidence:

| Service | Grant | Does |
| --- | --- | --- |
| `record_put(space, kind, id, body, envelope, expect)` | `records_write`, allowed for the space | Writes the record and its lane rows. Leaves any stored evidence as it is |
| `record_put_cited(space, kind, id, body, envelope, expect, evidence)` | the same | The same, and replaces the record's evidence. Standing kinds only |

### 4.2 What the host does, in order

`svc_record_put` (`store_services.rs:435`), when `Shared.records` holds the kind:

1. **Grant and space**, as today (`writing("records_write", space, None)`).
2. **A principal.** No effective principal (`effective_principal_of`, `src/access.rs:36`) is
   `RECORD_PRINCIPAL_REQUIRED`, as memory refuses (`src/plugins/memory_services.rs:135`).
3. **The envelope.** `seal` as today (`store_services.rs:178`), then:
   - For a new record, `access` becomes `["principal:<effective principal>"]`, or `["space"]` when the
     instance's `default_access` is `space`, whatever the plugin sent. Private by default, as memory's are (D68).
     For a record that exists the store keeps the stored access set (step 7.6): a later put never changes who
     reads a declared record, so a change of `default_access` touches only records written after it.
   - For a standing kind, `version` becomes 3 and the delegation chain is filled, as memory's are
     (`src/plugins/memory_services.rs:412` and `:413`), and `authority` is filled by this table, whatever the
     plugin sent (D71):

     | The call | `authority` |
     | --- | --- |
     | Carries the person gate's proof (6.1) | `person` |
     | A human through the library (`embedder_human`, `src/authority.rs:78`) | `person` |
     | Any other human actor | `tool` |
     | Any other actor | `agent` |

   `origin` stays the writer's claim; `unspecified` is refused as it is today.
4. **Extract** (`umbel_store::lane::extract`, 11.1). A value at a text pointer must be a string of at most 16 KiB of
   UTF-8, or absent or `null`. A value at a key pointer must be a string, or an array of at most 64 strings, each 1
   to 256 bytes with no control character, or absent or `null`. Anything else is `RECORD_FIELD_INVALID`, naming the
   pointer and never the value.
5. **Scan.** Each text value goes through `umbel_scan::scan_content`, as memory's text does
   (`src/plugins/memory_services.rs:62`). The findings (`instruction-like`, `hidden-text`, as
   `umbel_store::MemoryFlag`) are stored with the lane row and returned with the record. Flagged, never blocked
   (D67).
6. **Evidence** (`record_put_cited` only): its shape is checked (11.1). The document is checked inside the store's
   transaction (step 7).
7. **One transaction** (`BEGIN IMMEDIATE`, as `put_record` uses, `store-embedded/src/documents.rs:348`), through
   `DocumentStore::put_declared_record` (11.1):
   1. The kind's declaration row (5.1): absent with no record of the kind stored, it is inserted; a different hash,
      a stale mark, or absent with records stored, is `StoreError::LaneStale`.
   2. An existing record that the writer's reader filter does not admit is `Conflict { current: None }`: to this
      writer the id is taken, and nothing more is said, its content hash included.
   3. `expect` against the stored content hash, as today.
   4. **Wording (D160).** For a standing kind with a stored record, the new wording hash must equal the stored one,
      else `StoreError::WordingFixed`. Keys, other fields, evidence and the envelope may change.
   5. Evidence: `SELECT content_hash FROM documents d WHERE d.doc = ?` with the writer's reader filter as a clause
      (`and_doc_readable`, `store-embedded/src/sql.rs:111`). No row, or a hash other than the evidence's, is
      `StoreError::EvidenceInvalid`.
   6. The next revision; the `records` row as today; the `record_access` rows as today for a new record, and left
      as they are for one that exists, whose stored envelope then carries the stored access set; the `record_lane`
      row (kept, with its `lane` and `created_rev`, when it exists; **a record that is stored and has none**,
      which is what a rebuild leaves of a body it could not index, gets one here, at the revision and time of its
      first put, read from the change log ([A19](#amendments-from-step-b2)), **and for a standing kind this put is
      then the one that fixes its wording**: step 7.4 had no stored wording to hold it to); `record_terms` and
      `record_keys` rewritten
      when the text or the key values changed; `record_evidence` upserted when given; the record's vectors deleted
      when its match value changed; one `changes` row of kind `record`, as today.

   It answers the `RecordMeta` and whether the record now needs a vector for the space's model: it has a match
   value and no vector for that model id.
8. **A vector, after the write.** Only when step 7 committed and says one is needed, and the space's model loaded,
   the host embeds the match value (9.4) and writes it with `DocumentStore::put_record_vector`, which stores it only
   if the record's match digest is still the one embedded. So no text is sent to a provider for a put that was
   refused, and none for a put that changed only keys. **No failure in this step fails the put**, since the record
   is already written: a failure to embed, a failure of `put_record_vector` itself (a busy store, an I/O error),
   and a vector it declined because the digest moved all leave the record with no vector. The host logs a warning
   that names the kind and the step and no text, and returns the `RecordMeta` step 7 gave. The record waits for
   `store-records-reindex`, and 9.4 says what a missing vector costs. `record_put` returns after this step.

A record is findable and matchable by words the moment its put returns: the lane rows commit with it, and every
read of section 7 and 8 is a read of the same database. Two captures in a row match each other.

### 4.3 Wording never changes (D160)

For a kind with `standing = true`, the values at the text pointers are fixed by the first put, absent ones
included. The **wording hash** is `sha256:` of the canonical JSON (`canonical_json`, `store/src/canonical.rs:75`) of
the array of those values in declaration order, `null` for an absent one. A put that would change it is refused with
`RECORD_WORDING_FIXED`. A new wording is a new record.

This is how D157's "a change to wording that has standing is a new version, which is unverified and waits" is kept.
Which record a plugin treats as held and which as pending is the plugin's own pointer, in a record of its own. The
host guarantees one thing: standing attaches to wording that cannot move, so an affirmation can never come to cover
words the person did not see.

For a declared kind without `standing`, text may change, and the lane follows it. A put that changes it clears any
affirmation and evidence the record still holds from a time when the kind was a standing kind.

## 5. The lane (D163)

Declared kinds are indexed in the space's document store, `store.sqlite3`, in the same transaction as their
`records` row. The lane is ordinary tables: a term table with frequencies, a key table, and one row per record. It
is not tantivy and not an FTS5 table.

**Why not tantivy.** D157 keeps these records out of the index that knowledge search reads, so that an agent's
write cannot move knowledge ranking (D70's reason), and the index writer is a separate, exclusive commit
(`store/src/traits.rs:167`): a record would not be findable when its put returns.

**Why not FTS5, which the plan named.** Three things in the design need what FTS5 does not give through SQL:

- The words score runs in both directions (8.2), so the host needs each candidate's own terms with their
  frequencies, and how many readable records hold each of those terms. FTS5 answers the second only through one
  `MATCH` a term, and the first only by tokenising each candidate's text again, which is what memory's recall does,
  under a ceiling of 50 000 matches (`store-embedded/src/memory/read.rs:228`). A sentence matches most of a store
  through its common words, so the ceiling would refuse ordinary captures.
- The reader filter must be a clause of every statement (D169). A term table joins to `record_access` as every other
  table does (`sql.rs:83`).
- A second backend cannot run FTS5. A term table is what phase 6's PostgreSQL design already assumes for memory:
  tokens from `umbel-store`'s tokenizer, found by value.

What the plan wanted from FTS5 is kept: the same database, the same transaction, the tokens FTS5's
`porter unicode61 remove_diacritics 2` gives (through `umbel_store::memory::tokenizer::tokens`,
`store/src/memory/tokenizer.rs:41`), and deletion that overwrites, because every connection of the store sets
`secure_delete = ON` (`store-embedded/src/connection.rs:120`). What is given up: phrase and prefix queries, and
snippets. Neither finding nor matching uses them.

### 5.1 Tables, embedded schema version 2

`SCHEMA_VERSION` becomes 2. `initialise` (`connection.rs:131`) gains one step: a store at version 1 runs the
statements below in its opening transaction, sets `user_version` to 2 and `meta.store_traits_version` to 3. A build
of today opening a version 2 store answers `VersionUnsupported`, as it does for any newer schema
(`connection.rs:147`). These statements, and 6.3's clause over them, ran on SQLite 3.54.0 on 2026-11-11.

**What the migration asks of an operator** (stated after step B2's review). Two things about it are not
protected by the version check, and both are the operator's:

- **It is one-way, and any open runs it.** The first build with this schema that opens a space's store migrates
  it, whatever opened it: a call, a host's start, `store-show`, or `workspace-doctor`, whose record checks open
  the store of every space that has one. No build reads a version 2 store back as version 1. A copy made with
  `store-backup` before the upgrade is the way back.
- **A host that already holds the store open is not stopped.** The version check runs when a store is opened.
  An older host that opened the store before the migration keeps its connections, and keeps writing through the
  `put_record` it has, which knows nothing of `record_kinds`. So a record it writes to a declared kind is in
  `records` and not in the lane, **with no stale mark**: no lane service refuses, and no find returns that
  record or its change, until the kind is rebuilt.

So: **stop every older host of a workspace before a newer build first opens it.** Where that was not done, or it
is not known whether it was, run `umbel store-records-reindex` for each space once the older hosts are stopped: a
rebuild reads every record of every declared kind and is the whole repair. The doctor's `records.declared` counts a
record such a host created, since it has no lane row, and cannot see one such a host changed, whose lane row is
merely old.

```sql
CREATE TABLE record_kinds (
    ns        TEXT NOT NULL,
    kind      TEXT NOT NULL,
    decl_hash TEXT NOT NULL,              -- sha256: of the declaration's canonical JSON
    decl      TEXT NOT NULL,              -- that JSON, for store-records-reindex and the doctor
    stale     INTEGER NOT NULL DEFAULT 0, -- 1: written while undeclared, or a rebuild is under way (section 2, 12.1)
    generation INTEGER NOT NULL DEFAULT 0, -- raised by each undeclared put and each rebuild's start (12.1)
    PRIMARY KEY (ns, kind)
) STRICT, WITHOUT ROWID;

CREATE TABLE record_lane (
    lane         INTEGER PRIMARY KEY,     -- stable for the record's life
    ns           TEXT NOT NULL,
    kind         TEXT NOT NULL,
    id           TEXT NOT NULL,
    created_rev  INTEGER NOT NULL,        -- the revision of the first put
    created_at   TEXT NOT NULL,           -- its envelope's observedAt
    wording_hash TEXT,                    -- NULL for a kind with no text pointer
    match_digest BLOB,                    -- 32 bytes (8.1); NULL with no match value
    n0           INTEGER NOT NULL,        -- tokens of the value at text pointer 0; 0 when absent
    n1           INTEGER NOT NULL,
    n2           INTEGER NOT NULL,
    n3           INTEGER NOT NULL,
    flags        TEXT NOT NULL,           -- JSON array of scan findings
    affirmed_seq INTEGER,                 -- the record_decisions row that affirms it now, else NULL
    UNIQUE (ns, kind, id),
    FOREIGN KEY (ns, kind, id) REFERENCES records (ns, kind, id) ON DELETE CASCADE
) STRICT;
CREATE INDEX record_lane_by_recency ON record_lane (ns, kind, created_rev, id);
CREATE INDEX record_lane_by_digest ON record_lane (ns, kind, match_digest) WHERE match_digest IS NOT NULL;

CREATE TABLE record_terms (
    ns    TEXT NOT NULL,
    kind  TEXT NOT NULL,
    field INTEGER NOT NULL,               -- the text pointer's position in the declaration, 0 to 3
    term  TEXT NOT NULL,                  -- one token, as the tokenizer gives it
    lane  INTEGER NOT NULL REFERENCES record_lane (lane) ON DELETE CASCADE,
    tf    INTEGER NOT NULL,               -- how often the field holds the term
    PRIMARY KEY (ns, kind, field, term, lane)
) STRICT, WITHOUT ROWID;
CREATE INDEX record_terms_by_lane ON record_terms (lane, field);

CREATE TABLE record_keys (
    ns    TEXT NOT NULL,
    kind  TEXT NOT NULL,
    key   INTEGER NOT NULL,               -- the key pointer's position in the declaration, 0 to 15
    value TEXT NOT NULL,
    lane  INTEGER NOT NULL REFERENCES record_lane (lane) ON DELETE CASCADE,
    PRIMARY KEY (ns, kind, key, value, lane)
) STRICT, WITHOUT ROWID;
CREATE INDEX record_keys_by_lane ON record_keys (lane, key);

CREATE TABLE record_vectors (
    lane   INTEGER NOT NULL REFERENCES record_lane (lane) ON DELETE CASCADE,
    model  TEXT NOT NULL,                 -- the model id (9.2)
    vector BLOB NOT NULL,                 -- dimensions x f32, little-endian, of length 1
    PRIMARY KEY (lane, model)
) STRICT, WITHOUT ROWID;

CREATE TABLE record_evidence (
    lane     INTEGER PRIMARY KEY REFERENCES record_lane (lane) ON DELETE CASCADE,
    doc      TEXT NOT NULL,
    doc_hash TEXT NOT NULL,
    units    TEXT NOT NULL,               -- JSON array of unit numbers
    rule     TEXT NOT NULL,
    speaker  TEXT,
    verbatim INTEGER NOT NULL             -- 1: the plugin found the wording to be exactly those units
) STRICT;
CREATE INDEX record_evidence_by_doc ON record_evidence (doc, doc_hash);

CREATE TABLE record_decisions (
    seq          INTEGER PRIMARY KEY,     -- the revision the decision took
    ns           TEXT NOT NULL,
    kind         TEXT NOT NULL,
    id           TEXT NOT NULL,
    decision     TEXT NOT NULL CHECK (decision IN ('affirm', 'withdraw')),
    wording_hash TEXT NOT NULL,           -- the wording decided on
    by           TEXT NOT NULL,           -- the person's effective principal
    at           TEXT NOT NULL,
    assurance    TEXT NOT NULL,           -- JSON, umbel_store::Assurance
    trace_id     TEXT
) STRICT;
CREATE INDEX record_decisions_by_record ON record_decisions (ns, kind, id, seq);

CREATE TABLE doc_own (
    doc       TEXT PRIMARY KEY REFERENCES documents (doc) ON DELETE CASCADE,
    doc_hash  TEXT NOT NULL,              -- the content the person marked
    speaker   TEXT,
    rev       INTEGER NOT NULL,           -- the revision the mark took
    by        TEXT NOT NULL,
    at        TEXT NOT NULL,
    assurance TEXT NOT NULL,
    trace_id  TEXT
) STRICT, WITHOUT ROWID;
```

**Schema version 3** (after step B3's review, [A36](#amendments-from-step-b3)) adds one table, and a store at
version 1 or 2 gains it, empty, in its opening transaction, under the rules above: one-way, on any open. It is a
table and not a column of `documents`, so that a migrated store has a new store's schema statement for statement.
`SCHEMA_VERSION` is 3. No document of a migrated store is held to its file: an own collection's documents attest
nothing until `umbel store-documents-hold` has run for it (12.5), and the doctor's `records.own` counts them.
`store-embedded/tests/fixtures/store-v2.sql` is the dump of a version 2 store, and `lane_schema.rs` holds the
migration to it.

```sql
CREATE TABLE doc_held (
    doc      TEXT PRIMARY KEY REFERENCES documents (doc) ON DELETE CASCADE,
    doc_hash TEXT NOT NULL                -- the content the host held to its file on disk (section 3, rule 2)
) STRICT, WITHOUT ROWID;
```

`changes.kind` gains the value `standing`, `ChangeKind::Standing`: one row for each affirmation, withdrawal, mark
and unmark, with the record's target (`record_target`, `store/src/document.rs:465`) or the document's id, a `NULL`
content hash, and the access set the record or document had then in `change_access`. Every reader of changes outside
the store already ignores kinds it does not name (`matches!(change.kind, ChangeKind::Put | ChangeKind::Delete)`
throughout `plugins/knowledge` and `plugins/context`), and `last_readable_document` counts `put` and `delete` only
(`store-embedded/src/documents.rs:323`), so a decision moves no sealed position.

### 5.2 Where a record's text lives

A declared record's text is in two places: `records.body`, and, as terms without order, `record_terms`. Its key
values are in `records.body` and `record_keys`. A vector in `record_vectors` and the digest in `record_lane` are
derived from the match field. Every lane row hangs from `record_lane`, which hangs from `records`, by `ON DELETE
CASCADE`, so deleting the `records` row removes all of it in one statement, and `secure_delete` overwrites the
cells. A later erasure specification (the plan's P16) has that one statement to run, the change log's hashes
(`forget_record_history`, `store/src/traits.rs:147`) and `record_decisions` to settle, and nothing else.

`store-backup` copies the database with `VACUUM INTO` (`store-embedded/src/inspect.rs:122`), so a copy holds the
lane whole and needs no rebuild.

### 5.3 The reader clause

Every statement over the lane names `record_lane l` and adds, through `Sql::and_readable` (`sql.rs:83`):

```sql
AND EXISTS (SELECT 1 FROM record_access ax
            WHERE ax.ns = l.ns AND ax.kind = l.kind AND ax.id = l.id AND ax.token IN (?, ...))
```

A reader with no token reads nothing (`AND 0`). A derivation read is refused by every service here with
`StoreError::Invalid`, as memory refuses it (`refuse_derivation`, `store/src/memory.rs:1262`): the lane is never
read without a reader, except by `store-records-reindex` and the doctor, which return counts and no record.

"Every statement" is every statement of a read: `read_record`'s one, and each of `find_records`', the two a
ranked find runs over its candidates' frequencies and lengths included, which name only lanes a statement with
the clause returned and carry it again all the same (after step B2's review). A put reads the lane row of the
record it writes without the clause, after step 7.2 of section [4.2](#42-what-the-host-does-in-order) found that
the writer may read that record.

## 6. Standing (D161, D162)

A standing record's label is computed at each read from four facts, each written only by the host: whether a
decision row affirms it, its evidence row, the cited document's row, and whether that document is the person's own
now. Nothing a plugin stores in a body, and nothing a call passes, is read as standing.

| Standing | Holds when |
| --- | --- |
| `affirmed` | The decision `record_lane.affirmed_seq` names is an affirmation, of the wording the lane row holds now, made by the space's person |
| `attested` | Not affirmed, and 6.3's condition holds |
| `unverified` | Otherwise |

**Affirmed is read, as attested is** (after step B3's review, [A38](#amendments-from-step-b3)). The lane row's
pointer alone is not standing. A read asks three things of the decision it names: `decision = 'affirm'`,
`wording_hash` equal to the lane row's, and `by` among the principals the space's person decides as. The first
two make D160 hold at each read as well as at each write, whatever left the row behind. The third is the next
paragraph.

**Changing a space's person sets the former person's decisions aside.** The `StandingView` of a read carries
the principals the configured `person` decides as (the `person` string, and the principal `[principal.equivalents]`
maps it to), and a decision affirms, and a mark counts, only when its `by` is one of them. So after
`spaces.<id>.person` changes, or is removed, what the former person affirmed reads `unverified` and what they
marked is nobody's own, with nothing written and nothing deleted. The new person affirms and marks again, in
their own name: `Affirm` writes whenever the record does not read affirmed, and a mark by another person on the
same content is a new mark. Naming the former person again restores what they decided.

### 6.1 Affirmed: `record_decide`

```text
record_decide(space, kind, id, decision) -> StandingLabel        decision: Affirm | Withdraw
```

Grant `records_write`, allowed for the space. The checks, in order:

1. The kind is a standing kind of the calling instance, else `RECORD_KIND_NOT_STANDING`.
2. **The call passed the person gate.** `CallServices` gains `person_gate: Option<umbel_store::Assurance>`, set once
   in `Services::build` (`src/plugins/grants.rs:154`), where the command name, the validated input and the context
   are all at hand. It is `Some` only when the command is one of this instance's commands declared
   `confirm = "require-human"`, and the context carries the proof that the plugin gate's `person_gate`
   (`src/middleware.rs:437`) accepted for that surface:

   | `context.interface` | The command's `person` | Proof | Recorded as |
   | --- | --- | --- | --- |
   | `Cli` | `cli = "verified"` | `crate::person::attested(config, command, input, context)` is `Some` (`src/person/mod.rs:254`) | `Assurance::verified(namespace, auth_time, acr)` |
   | `Cli` | `cli = "terminal"` | `context.extra["dev.umbel/human-confirmed"]` equals the command (`confirmed_by_a_person`, `middleware.rs:481`), **and the CLI's human-present mark names it** (`authority::cli_mark`) | `Assurance::terminal()` |
   | `Mcp` | `mcp = "verified"` | `attested(...)` is `Some` | `Assurance::verified(...)` |
   | anything else | | none | `None` |

   This is a new function, `crate::person::gate_proof(config, command, person, input, context)`, with
   `person_gate`'s arms and `attested` in place of `admit`: the same checks without spending the decision again,
   which the gate did before the handler ran, **and at a terminal one check more than the gate makes** (after
   step B3's review, [A37](#amendments-from-step-b3)). The CLI sets its human-present mark only for a human at a
   terminal with no agent variable set (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `AI_AGENT`, the workspace's
   `principal.agent_env`). The plugin gate does not ask for it, so a process at a terminal that carries an agent
   variable answers the prompt and passes the gate. It gets no proof: standing is at least as strict as memory's
   `person` (D86), which asks for the same mark, and such a call's `record_decide` and marks are
   `RECORD_DECISION_NOT_GATED`. `attested` binds the proof to this command, this surface and the
   digest of this input. What it does not repeat is the ledger's part of `admit`
   (`src/person/service.rs:920`): reading the decision back as approved, live and for this caller, and spending
   `person-run:<id>` once. The gate did both for this call before the handler ran, and only the host writes the
   mark `attested` reads (`service.rs:639`). `CommandPolicy` (`grants.rs:59`) gains `require_human: bool` and
   `person: PersonDecl`, filled where it is built (`src/plugins/loader.rs:913`). `Services::call`, which names no
   command, and `read_only_view` (`grants.rs:285`) have `None`. A step of a pipeline has `None` under its own name,
   so a review is one command. `None` is `RECORD_DECISION_NOT_GATED`. A gated step of a pipeline or of a batch
   is refused by the plugin gate before its handler runs, so its caller sees `CONFIRMATION_REQUIRED`
   ([A29](#amendments-from-step-b3)).
3. **The caller is the space's person.** The space has a `person`, and `identities(config, effective principal)`
   (`src/access.rs:73`) holds it, else `RECORD_DECISION_NOT_THE_PERSON`.
4. The record is readable by the caller, else `NotFound`. Readable is all: **no standing filter applies to a
   decision**, so an unverified record can always be affirmed and an affirmed one withdrawn. `decide_record` takes
   the view only to compute the label it returns, and ignores its `admit`.

Then, in one transaction: `Affirm` on a record not affirmed takes the next revision, inserts a `record_decisions`
row with the record's wording hash, the person's principal, the clock's time and the assurance, sets
`affirmed_seq`, and writes a `standing` change. `Withdraw` on an affirmed record does the same with `withdraw` and
sets `affirmed_seq` to `NULL`. `Affirm` on an affirmed record, and `Withdraw` on one that is not, write nothing and
return the label as it is. "Affirmed" here is as a read has it (section 6): a record whose lane row names a
former person's decision does not read affirmed, so the space's person affirms it again, and a withdrawal clears
such a row too.

A decision that took a revision is noted for the call as every store write is (`note_write`,
`store_services.rs:111`), so the command's result carries it in `dev.umbel/changes` and the command's event covers
it. One that wrote nothing notes nothing. The same holds for a mark and an unmark (6.2).

**What the host guarantees, and what it does not.** A decision row exists only because a person decided this very
call, with this input, at the assurance the command declares (D115). Which records the handler affirms inside that
call is the compiled plugin's code (D162): the plugin's specification must hold its review command to affirming the
records its preview showed and its input named. A record's wording cannot change after the person saw it (D160), so
naming the record is naming the wording.

### 6.2 The person's own

A document is **the person's own now** when one of these holds for the document as stored now:

- **By collection.** Its collection is configured `own = true` in the space, **and the host held its current
  content to its file on disk** (`doc_held`, section 3's rule 2; after step B3's review,
  [A36](#amendments-from-step-b3)). Section 3's two rules are what that rests on, and the second is now a fact
  about each document, not only a check at each put.
- **By mark.** A `doc_own` row, **made by the space's person** ([A38](#amendments-from-step-b3)), names it with
  `doc_hash` equal to its current content hash, and its collection is
  not command-writable now (section 3), which is to say as this host judged it at its start ([A2](#amendments-from-step-b1)).

When both hold, the basis is `collection`: the deployer's configuration is read first.

```text
doc_own_mark(space, doc, content_hash, speaker) -> Rev
doc_own_unmark(space, doc) -> Rev
doc_own(space, doc) -> Option<OwnInfo>
```

`doc_own_mark` and `doc_own_unmark` need `records_write` allowed for the space and the `documents` grant, and make
6.1's checks 2 and 3. No new grant: a mark is a standing fact, written as an affirmation is, about a document the
caller reads. A mark is refused unless all of these hold:

1. The document is readable by the caller, else `NotFound`.
2. Its current content hash equals `content_hash`, else `Conflict { current }`, so a person marks the bytes they
   were shown.
3. **Its collection is not command-writable**, else `STORE_OWN_MARK_REFUSED`. The answer is the one the host took
   when it read the configuration at its start (section 3, [A2](#amendments-from-step-b1)): a symbolic link changed since then is
   not seen until the next start, and hosts that started at different times can disagree until they have.
4. **It equals its file on disk**: the SHA-256 of `<root>/<path>`, read as section 3's rule 2 reads it, is its
   content hash, else `STORE_OWN_MARK_REFUSED`. A mark that passes records the same fact a put into an own
   collection records: the host held this content to its file (`DocumentStore::hold_document`).

A mark takes a revision and writes a `standing` change on the document's id. A mark that changes nothing (the
same content hash, speaker and person) returns the stored `rev`. Unmarking deletes the row and writes a `standing` change; with no row it is `NotFound`.

**This refines D157**, which lets a person say an uploaded source is theirs and is silent on any other. Here the
person's say-so covers any source that did not reach the host as a command's input. Today that is a synced document
in a collection nobody named as the person's, which checks 3 and 4 establish as far as the host can: no command
writes files where it lies, and it is the file on disk. Later it is an upload, which the uploads specification
admits by its own check in place of 4. It is not meant to cover a document a command's input produced, such as an
applied knowledge proposal: a person approving a proposal has approved a change to the knowledge base, not said the
words are theirs. The host refuses that as far as the configuration now tells it, and no further: section 3 states
the limit, a file written while its collection was command-writable and left there after.

`doc_own` needs `documents`. It returns `None` unless the document is readable by the caller and the person's own
now, and otherwise how: `collection` or `marked`, the speaker, the content hash and the two dates of 6.5. A plugin
reads the speaker from it, so the deployer's configuration and the person's mark reach the plugin's rule through
the host and not through a call's input.

A document replaced by new content keeps its mark row, which no longer matches, so it stops being the person's own
until marked again. A deleted document loses its row. A collection that becomes command-writable by a later change
of configuration stops its marks from counting, without deleting them, in each host from that host's next start.

**Uploads.** No document arrives by upload today. The uploads specification (the plan's P17) must do one of two
things, and this is its seam: store uploads outside own collections, or carry how a document arrived on a column of
its own that 6.3's condition then reads. Under rule 2 of section 3, a document with no file on disk cannot be put
into an own collection at all, so **an uploaded document never inherits a collection's `own`**, whatever that
specification chooses. It becomes the person's own only by a mark, and that specification replaces check 4 for a
document it stored itself.

### 6.3 Attested

A record is attested when it is not affirmed and this holds, as one clause of the reading statement. `?c` and `?s`
repeat for each own collection of the space, with its speaker or `NULL`, `?w` lists the space's
command-writable collections, and `?p` the principals the space's person decides as (amended after step B3's
review, [A36 and A38](#amendments-from-step-b3): the `doc_held` condition and the mark's `by`):

```sql
EXISTS (SELECT 1 FROM record_evidence e
        JOIN documents d ON d.doc = e.doc AND d.content_hash = e.doc_hash
        WHERE e.lane = l.lane AND e.verbatim = 1
          AND ((EXISTS (SELECT 1 FROM doc_held h WHERE h.doc = d.doc AND h.doc_hash = d.content_hash)
                AND d.collection = ?c AND e.speaker IS ?s)
               OR (d.collection NOT IN (?w, ...)
                   AND EXISTS (SELECT 1 FROM doc_own o
                               WHERE o.doc = d.doc AND o.doc_hash = d.content_hash
                                 AND o.by IN (?p, ...)
                                 AND o.speaker IS e.speaker))))
```

In words: the record's evidence says the plugin found its wording to be exactly the cited units; the cited document
is stored now with the cited content hash; that document is the person's own now, which for an own collection
means the host held that content to its file, and for a mark that the space's person made it; and the speaker the
plugin's check used is the speaker the collection or the mark names.

The clause does not ask whether the reader may read the cited document. Standing is a fact about the record, and
the same for every reader of it. What a reader who cannot read the document is shown of it is in 6.5, and what that
reader can still infer is stated in section 14.

Attested is never stored. Consequences, each intended:

- A person marks a document as theirs and every record that cites it word for word reads as attested at once, with
  nothing written to those records. They unmark it and those records read as unverified again.
- **A document that changes lapses the attestation of the records that cite it**, because their evidence names the
  old hash. The plugin cites again, with `record_put_cited`, when the units still stand in the new content. Evidence
  is not wording, so it may change.
- A deployer who removes `own` from a collection, changes its `speaker`, makes a marked document's collection
  command-writable, or changes the space's `person`, lapses what rested on it.
- A deployer who names a collection `own` attests nothing by that alone: only documents the host has held to
  their files count (section 3).

### 6.4 The split between the host core and the plugin (D162)

D157 says attested is found by "the host's own deterministic check". This decision says what that means: **code in
the host's process, never the caller**, in two parts. It refines D157 in that: the comparison of words, which D157
gives to the host, is the compiled plugin's, and the host core keeps everything about the source.

| Part | Establishes | How |
| --- | --- | --- |
| The host core | That the cited document exists and the writer may read it; that its content is the content cited; whose it is; that no command writes files where it lies and that it is the file on disk; that a person decided | The put's check (4.2, step 7.5), 6.2, section 3's rules, 6.1 |
| The compiled plugin's code | That the wording is whole units, word for word, of the person's own part of that document | Its own rule, deterministic and versioned. It records what it compared in the evidence: the units, the rule's version and the speaker, so the check can be replayed against the stored document |

Compiled plugins are the deployer's own code in the host's process, trusted and not sandboxed (D42). A component,
whose code is a third party's, cannot declare a record kind at all (D159), so no sandboxed code decides
`verbatim`. An agent's call decides nothing: it passes unit numbers, and the plugin's code compares bytes it read
from the store through the host.

The host core does not re-run the comparison. It holds no rule for dividing a document into units, and holding one
would put a domain rule in the host (principle 1). The cost of that choice is in section 18.

### 6.5 The label

Every record a lane service returns is a `LaneRecord` (11.1), and for a standing kind it carries a
`StandingLabel`. The SDK serialises a `LaneRecord` as the record's own members plus three: when the record was
first put, the scan's findings, and the label:

```json
{
  "ns": "notes", "kind": "note", "id": "n-0007", "rev": 41, "contentHash": "sha256:…",
  "body": { "statement": "Prune roses in late winter, before the buds swell.", "bed": "north" },
  "envelope": { "…": "…" },
  "dev.umbel/createdAt": "2026-11-02T09:20:11.004Z",
  "dev.umbel/flags": [],
  "dev.umbel/standing": {
    "standing": "attested",
    "affirmed": null,
    "source": {
      "doc": "journal/roses", "contentHash": "sha256:…", "basis": "collection", "speaker": null,
      "units": [4], "rule": "sentences/1",
      "storedAt": "2026-11-02T09:14:07.120Z", "generatedAt": null
    }
  }
}
```

| Member | Holds |
| --- | --- |
| `standing` | `unverified`, `attested` or `affirmed`. Never `machine`, `human` or `owner`, the tiers of verified knowledge (D63), so no label reads as verified knowledge |
| `affirmed` | For an affirmed record: `{ "by", "at", "assurance" }` from its decision row. Else `null`. **Who affirmed it is shown to the operator and to the space's person only** (after step B3's review, [A39](#amendments-from-step-b3)): every other reader of the record gets `by` as `null` and `assurance` as `{ "level" }` alone, so it learns that the record is affirmed, when, and whether at a terminal or on the person page, and not who the space's person is, nor the namespace, the login's time or its `acr` of a verified decision. This is section 12.4's rule for who a space's person is |
| `source` | When 6.3's condition holds, affirmed or not. Else `null`. **When the reader may not read the cited document, it holds `basis` and nothing else**: every other member is `null`, the units, rule, speaker and dates included |
| `source.basis` | `collection` or `marked`; `collection` when both hold |
| `source.storedAt` | The document version's envelope `observedAt`: when the host stored that content |
| `source.generatedAt` | The document's own `generated.at`, when its frontmatter states one (OKF's key, D56). Else `null` |

`LabelSource` in Rust holds `basis` and an optional `seen` with the rest (11.1); the SDK writes them as the one
flat object above, with `null` for each member of an absent `seen`. `Affirmation` has the same shape for the same
reason: `at`, `level`, and an optional `seen` with `by` and the whole assurance. A store answers it whole, and the
host's `record_read` and `record_find` take `seen` away for a reader who is neither the operator
(`access::is_operator`) nor the space's person; a read made as another principal (`as_reader`) is that
principal's. `record_decide` answers its caller, who is the person.

**Which date.** D157 has an attested label carry the source's date, "the person wrote it then". The host holds no
such date. A document record carries the envelope's `observedAt`, which the host fills with its clock at the put
(`store_services.rs:191`), and `generated`, which the file states about itself
(`plugins/sources-filesystem/src/document.rs:46`); the file's modification time stays in the source plugin's sync
state and is not on the document (`plugins/sources-filesystem/src/state.rs:30`). So the label says when the host
stored the content, which is the latest the person can have written it, and what the file claims. A plugin that
knows a better date, such as one the person supplied, states it beside the label, as its own.

The member names carry the host's prefix because the host computed them. Inside a result's data nothing enforces
that: the plugin gate strips host keys from result metadata only (`src/middleware.rs:346`). Passing the label
through unchanged is the compiled plugin's (D162), and the plugin's specification must hold every read command to
it.

`record_get` and `record_list` return a bare `Record`, with no label. On a standing kind they are therefore
refused with `RECORD_KIND_STANDING`, and the plugin reads through `record_read` and `record_find`. On every other
kind they are unchanged.

### 6.6 Verified content only

D157: where verified content only is asked for, by a deployment's setting or by a call, only affirmed records are
returned; a deployment's setting may also admit attested ones; a call never widens what the deployment set.

**This refines D157's "by a deployment's setting or by a call".** The deployment sets what verified means, and a
consumer that wants verified content asks for it, call by call:

- `spaces.<id>.verified_admits` says what "verified" is in the space: `affirmed` (the default), or
  `affirmed+attested`.
- Every reading service of a standing kind takes `verified_only`, the call asking, and `standings`, a set that
  narrows further.
- **No setting asks for every read.** A store that hid unverified records from every reader could not be
  reviewed: no command could list what waits for the person, and nothing could ever be affirmed. A deployment that
  wants a consumer to see verified content only configures that consumer's plugin to ask, as the context plugin's
  `verified_only` is configured today (`plugins/context/src/settings.rs:24`).

The host computes the set it applies, and returns it as `admitted`:

```text
base     = verified_admits' set               when the call's verified_only is true
         = {unverified, attested, affirmed}   otherwise
admitted = base                               when the call's standings is empty
         = base intersected with standings    otherwise
```

A call that sets `verified_only` cannot widen it past `verified_admits`: asking for a standing outside `base` is
not an error and returns less. The plugin maps its own inputs to the flag: the plugin's specification says which of
its commands pass a caller's request for verified content through, and which always set it.

`record_decide`, `doc_own_mark` and `doc_own_unmark` are not reading services: they check readability only (6.1,
6.2).

The filter is a clause of the statement, so totals, statistics and candidates count only admitted records:

```sql
-- admitted = {affirmed}:              AND <affirmed>
-- admitted = {attested, affirmed}:    AND (<affirmed> OR <6.3>)
-- admitted = {unverified}:            AND NOT <affirmed> AND NOT <6.3>
-- <affirmed> (section 6's three conditions, after step B3's review):
--   EXISTS (SELECT 1 FROM record_decisions c WHERE c.seq = l.affirmed_seq AND c.decision = 'affirm'
--           AND c.wording_hash = l.wording_hash AND c.by IN (?p, ...))
```

## 7. Finding (D164)

```text
record_read(space, kind, id, standings, verified_only) -> Option<LaneRecord>
record_find(space, query) -> FindPage
```

Grant `records`. `record_read` returns `None` for a record that is absent, not readable or not admitted, without
saying which.

| `RecordFind` | Type | Rule |
| --- | --- | --- |
| `kind` | string | A declared kind of the instance, else `RECORD_KIND_NOT_DECLARED` |
| `keys` | list of `{ key: pointer, any: [string] }` | At most 8 filters; each `any` holds 1 to 64 values. A record passes a filter when one of its values at that key pointer is in `any`, and passes when it passes every filter. A pointer the declaration does not list under `keys` is `RECORD_QUERY_INVALID` |
| `standings`, `verified_only` | list, bool | 6.6. Empty and `false` for a kind without standing, else `RECORD_QUERY_INVALID` |
| `text` | `{ query: string, fields: [pointer] }`, optional | `query` is plain text of 1 to 1024 characters, no syntax. `fields` are text pointers of the declaration; empty means all of them |
| `order` | `id`, `recent` or `rank` | `rank` needs `text`; `text` with another order filters and does not rank |
| `after` | string, optional | The `next` of the page before, for the same query |
| `limit` | 1 to 200 | |
| `total` | bool | Whether to count |

`FindPage` holds `items` (each a `LaneRecord`), `next`, `total` when asked, `admitted`, and `cut` (below).

**Order `id`:** by `l.id` ascending, in the byte order of its UTF-8. **Order `recent`:** by `created_rev`
descending, then id. Both are one statement, with the key filters as `EXISTS` clauses over `record_keys`, 5.3's
reader clause, 6.6's clause, the cursor, and `LIMIT limit + 1`:

```sql
SELECT r.ns, r.kind, r.id, r.rev, r.content_hash, r.body, r.envelope,
       l.lane, l.created_rev, l.created_at, l.flags, l.affirmed_seq, <6.3> AS attested
FROM record_lane l JOIN records r ON r.ns = l.ns AND r.kind = l.kind AND r.id = l.id
WHERE l.ns = ? AND l.kind = ?
  AND EXISTS (SELECT 1 FROM record_keys k WHERE k.lane = l.lane AND k.key = ? AND k.value IN (?, ...))
  <reader clause> <standing clause>
  AND l.id > ?                                -- order id; order recent compares (created_rev, id)
ORDER BY l.id LIMIT ?
```

The labels' sources for one page are read by a second statement over `record_evidence` and `documents` for the
page's lanes, taking `json_extract(d.record, '$.envelope.observedAt')` and `'$.envelope.generated.at'`, with
`doc_access` deciding whether `doc` is shown.

**With `text`.** The query is tokenised by the lane's tokenizer. A query with no token is `RECORD_QUERY_INVALID`.

- Under order `id` or `recent`, the text is one more filter, exact and in the statement: the record holds at least
  one of the query's terms in a searched field
  (`EXISTS (SELECT 1 FROM record_terms t WHERE t.lane = l.lane AND t.field IN (...) AND t.term IN (...))`).
- Under order `rank`, the records are the *candidates* that section 8.2's steps 1 to 3 gather, among those that
  pass the filters, and they are ordered by step 4's `score(q, d)`, with the statistics of the reader's admitted
  records as they are (the query is not counted as a record). The order is that score at four places descending,
  then `created_rev` descending, then id. In a store large enough for the gather's bound to bite, a record that
  shares only the query's commonest terms is not ranked. The page carries no score, as memory's recall carries
  none (D70): the order is the answer.

**Cursors.** `next` is opaque to the caller: the base64 of the canonical JSON `{ "o": order, "k": [...] }`, where
`k` is the last item's id, or its `created_rev` and id, or its rounded score, `created_rev` and id. A cursor for
another order is `RECORD_QUERY_INVALID`. A ranked page is recomputed for each call, and a record that arrives
between pages can shift later pages, as in any stateless listing.

**Totals** count the records that pass the filters, the reader clause and the standing clause: with `text` under
order `id` or `recent`, those that hold a query term; under order `rank`, the candidates. Never a record the reader
may not read.

**`cut`** is `true` only under order `rank`, and only when 8.2's step 3 read the postings of the query's rarest
term and found more than the bound after every clause, so some records that hold that term were not ranked. Leaving
commoner terms out of the gather does not set it.

## 8. Matching (D165)

```text
record_match(space, query) -> MatchPage
```

Grant `records`. It takes up to 64 texts and returns, for each, the records whose match field is identical and the
nearest records with their scores. **The host returns scores only.** Bands, thresholds and what to refuse are the
calling plugin's, as values in its pack. Phase 0 is the reason: across documents no lane could refuse safely (half
the duplicates missed at 2% wrong refusals), while words alone put the duplicate among the nearest five for 0.886
of its 35 probes.

| `RecordMatch` | Type | Rule |
| --- | --- | --- |
| `kind` | string | A declared kind with a `match` pointer, else `RECORD_KIND_NOT_DECLARED` |
| `texts` | list of strings | 1 to 64, each 1 byte to 16 KiB |
| `k` | 1 to 20 | The most nearest records a text gets |
| `keys`, `standings`, `verified_only` | as `RecordFind` | Only records that pass take part |
| `exclude` | list of ids | At most 64. Left out of both lists **and out of the statistics**, for matching a stored record's own text against the rest |

`MatchPage` holds `results`, one `MatchResult` per text in order; `admitted`; and `meaning`, which is one of
`served` with the model id, `off` (no model configured, or its gate not passed), `incomplete` (9.4) or `failed`
(the incoming texts could not be embedded). A `MatchResult` holds `identical` (at most 8, by id), `nearest` (at most
`k`) and `cut`. Each entry is a `MatchHit`: the record's `id`, `rev`, the value of its match field, its label and
flags, and in `nearest` its `words`, `meaning` and `fused`. A record can be in both lists.

### 8.1 Identical

The **normalisation**, version 1 (`umbel_store::lane::normalise`):

1. NFKC (`unicode_normalization::UnicodeNormalization::nfkc`).
2. Unicode default case folding (`caseless::default_case_fold_str`).
3. NFKC again, since folding can denormalise.
4. Each run of characters for which `char::is_whitespace` holds becomes one U+0020.
5. Leading and trailing U+0020 are removed.

The **match digest** is the SHA-256 of the result's UTF-8. It is stored in `record_lane.match_digest` at put, and
`identical` is one indexed lookup with the reader, standing and key clauses, ordered by id, limited to 8.

Worked example: each of these three texts has the digest
`c714bd413a290f5b1724d67dd0b26ea3e76a93b1904daaa487f16cea4e1aec8b`:

```text
"Prune roses in late winter, before the buds swell."
"  PRUNE roses in late<TAB>winter,<U+00A0>before the buds swell. "
"<U+FF30>rune roses in late winter, before the buds swell."
```

A value whose normalised form is empty has no digest and is identical to nothing.

Both crates are pinned exactly (section 1), and the constant `NORMALISATION_VERSION = 1` is written to `meta` as
`lane_normalisation`. A change of either crate's tables is a new version and a run of `store-records-reindex`.
The digest is not keyed: while a record lives, its text is beside it. A digest kept after erasure, under a key only
the host holds, is the erasure specification's (P16).

### 8.2 Words

`words` is phase 0's score (`match.py`, class `Lexical`): BM25 over stemmed tokens, scaled so that a text scores 1
against itself, taken in both directions, the lower kept. A short text inside a long one therefore scores low.

**Tokens.** `umbel_store::memory::tokenizer::tokens`, over the match field. This differs from phase 0, which split
on ASCII letters and digits and used Snowball's English stemmer: the lane takes the tokenizer the store already has
and holds to a reference, and that also reads other scripts. Step B6 measures what the difference does to phase 0's
rates.

**Statistics**, for one text `q` and the calling reader: let the *corpus* be the records of the kind that the
reader may read and the call admits (5.3, 6.6), **without the records `exclude` names**, not narrowed by `keys`,
**plus `q` itself as one more record**, as phase 0's probes were members of the corpus they were scored against.
`exclude` is how a caller says "this text is that stored record": leaving the stored one out keeps the text from
being counted twice. `N` is the corpus's size, `L` its total tokens in the match field, `avg = L / N`, and `df(t)`
how many of its records hold term `t`. Counting only what the reader may read is D125's rule: a record the reader
cannot read changes no score.

```text
idf(t)       = ln(1 + (N - df(t) + 0.5) / (df(t) + 0.5))
score(Q, D)  = sum over each distinct term t of Q that D holds:
                 idf(t) * tf(D, t) * (k1 + 1) / (tf(D, t) + k1 * (1 - b + b * |D| / avg))
               with k1 = 1.2, b = 0.75, |D| the tokens of D
directed(Q, D) = score(Q, D) / score(Q, Q), or 0 when score(Q, Q) is 0
words(q, d)  = min(directed(q, d), directed(d, q))
```

`k1` and `b` are the memory lane's (`store-embedded/src/memory/rank.rs:15`). The `idf` is tantivy's form, which
phase 0 measured, and not FTS5's floored form, which memory uses (`rank.rs:98`): in a small store FTS5's form gives
the floor weight to every term that more than half the records hold, and a store of short records starts small.
All of it is `f64`, in `umbel_store::lane::score`, so every backend computes the same numbers.

**Once a call**, before any text:

- `N0` and `L0`, the stored part of `N` and `L`: one statement over `record_lane`, with the reader, standing and
  exclude clauses. Each text then adds 1 and its own length.
- An empty table of stored counts, `df0`, kept for the whole call. A term is counted at most once a call, whichever
  text or pooled record first needs it, for at most 500 terms a statement. The statement reads every posting of
  those terms in the kind and the field, and answers two numbers a term: `scanned`, all of them, and `df0`, those
  whose record passes the same three clauses:

  ```sql
  SELECT t.term, COUNT(*) AS scanned, SUM(<reader, standing and exclude predicates over l>) AS df0
  FROM record_terms t JOIN record_lane l ON l.lane = t.lane
  WHERE t.ns = ? AND t.kind = ? AND t.field = ? AND t.term IN (?, ...)
  GROUP BY t.term
  ```

  Each text then adds 1 to `df0` for each term it holds.
- A running total of `scanned` over the terms the call has needed. **When it passes `STAT_POSTINGS = 4 000 000`
  the call is refused** with `RECORD_QUERY_TOO_BROAD` and returns nothing. The total is defined over the needed
  terms' postings and not over how they were fetched: an implementation that reads every count of the kind in one
  grouped scan still adds only the needed terms' `scanned`, so it refuses at the same point.

**What the cap bounds, plainly.** It bounds work, which is postings read, whoever may read them. Three things
follow, and each is intended:

- A reader who may read 1% of a large kind pays for all of it, and is refused at the same point as a reader of
  everything. The reader's own share bounds nothing.
- A call needs each term once, so its total never passes the kind's postings: inside the design bound of 100 000
  short records, about two million postings, the cap is not reached. Past it the answer is a refusal with a code,
  not a call that runs for minutes.
- **This is the one place where records a reader cannot read change that reader's answer**: from an answer to a
  refusal, never what an answer holds. A refusal tells the reader that the kind is very large, and nothing of what
  is in it. Section 14 states it, and the differential cases of 15.1 run under the cap.

**Then, for each text:**

1. **Counts** for the text's distinct terms, from `df0`.
2. **Gather order.** The text's terms that some stored record holds, by `df0` ascending, then by the term's bytes.
3. **Gather.** Terms are taken in that order while the sum of their `df0` stays at or under
   `GATHER_POSTINGS = 20 000`, and at least one is taken. The bound is compared with `df0`, which no key filter
   narrows. The taken terms' postings are then read with every clause, reader, standing, key and exclude, and give
   the *candidates*. When the first term's `df0` alone exceeds the bound, its postings are read with every clause
   in `lane` order with `LIMIT 20 001`: more than 20 000 rows sets the result's `cut` and drops the last. Nothing
   else sets `cut`. A record that shares only the text's commonest terms is therefore not a candidate: that is the
   bound's purpose, and it is the same effect a stop list has.
4. **Query direction.** For every candidate, `directed(q, d)`, using its frequencies for all of the text's terms
   (one statement over `record_terms` for the candidates' lanes) and its length (`record_lane`'s `n` column of the
   match field).
5. **Pool.** The 64 candidates with the highest `directed(q, d)` at four places, ties by id ascending.
6. **Both directions.** For each pooled record: its full term list (one statement), counts for those terms from
   `df0`, `directed(d, q)`, and `words`.

For `record_find` with `text` under order `rank`, the once-a-call part and steps 1 to 4 run over the searched
fields, without counting the query as a record, and step 4's `score(q, d)` orders the candidates. Over several
fields a record's frequency for a term is its sum over them, its length the sum of their token counts, and a count
is of the records that hold the term in any of them.

**What it costs.** The independent review of this document built section 5.1's tables at 100 000 records and
measured the counts for the terms of 64 pooled records at about 1.0 second, most of it in the commonest terms.
Without a table kept across a call's texts, a 64-text match would have paid that 64 times. With it the common
terms are counted once, and the whole call is bounded by one pass over the kind's postings. These are estimates
until step B6, which records, at 10 000 and 100 000 records, the time of the once-a-call part, of the counts, of
the gather and of both directions, for 1 text and for 64, **for a reader of everything and for a reader who may
read 1% of the kind**.

**Worked example.** A reader reads five records of kind `note`, whose match fields are:

```text
n1  Prune roses in late winter, before the buds swell.
n2  Roses are pruned in late winter before their buds swell.
n3  Tomatoes need six hours of sun and steady watering.
n4  Mulch keeps the soil cool and holds water through summer.
n5  Water tomatoes at the base, never on the leaves.
```

For the text `Prune your roses in late winter before the buds swell.`, `N` is 6 and `L` is 57, and:

| Record | `directed(q, d)` | `directed(d, q)` | `words` |
| --- | --- | --- | --- |
| `n1` | 0.8304 | 0.9578 | 0.8304 |
| `n2` | 0.7367 | 0.6428 | 0.6428 |
| `n5` | 0.0837 | 0.0422 | 0.0422 |
| `n4` | 0.0587 | 0.0341 | 0.0341 |
| `n3` | 0.0000 | 0.0000 | 0.0000 |

For `PRUNE ROSES  in late winter, before the buds swell.`, `n1` is identical and scores 1.0000, and `n2` scores
0.6714. These numbers were computed on 2026-11-11 from the formulas above with FTS5's tokens, and are the first
rows of the conformance fixture (15.1).

### 8.3 Meaning and fused

When `meaning` is `served`, each text is embedded (9.4), and:

```text
meaning(q, d) = the dot product of the two unit vectors
fused(q, d)   = w * meaning(q, d) + (1 - w) * words(q, d)       w = spaces.<id>.meaning.weight
```

The pool is then the union of step 5's 64 and the 64 records with the highest `meaning` at four places, ties by id
ascending, found by an exact scan of the reader's vectors for the model (9.4). Every pooled record gets all three
scores. `nearest` is the pool by `fused` descending, then id ascending, cut to `k`.

When `meaning` is not `served`, `meaning` is absent from every hit, `fused` equals `words`, and the pool is step
5's.

Every score is returned rounded to four decimal places, and ordering uses the rounded values, so a difference in
the last bits of a float never changes an order. `fused` is computed from the unrounded scores.

The sum is weighted, not the reciprocal-rank fusion the phase 2 specification reserves for knowledge lanes: phase 0
measured the weighted sum, and a rank fusion would discard the scores a plugin's bands are set on.

## 9. Meaning (D166, D168)

### 9.1 The trait

`Embedder` is one of two trait names phase 2 reserved in `umbel-store` and left undefined (phase 2 specification,
section 13). It is defined here. `VectorIndex` stays reserved for knowledge search.

```rust
// store/src/embed.rs
/// `<models id>@<16 hex>`: the configured id and a digest of everything that can change its vectors.
pub struct ModelId(String);

pub enum EmbedError {
    /// The provider could not be reached or timed out. Retryable.
    Unavailable(String),
    /// The provider answered something that is not `dimensions` finite numbers per text.
    Invalid(String),
}

pub trait Embedder: Send + Sync {
    fn model(&self) -> &ModelId;
    fn dimensions(&self) -> usize;
    /// One vector per text, in order. The caller scales each to length 1; a zero vector is no vector.
    fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError>;
}
```

No error message holds a text. The trait is synchronous, as the store traits are, and called from a blocking
thread.

### 9.2 Models in the configuration

**None by default.** A workspace with no `[models]` table and no `[spaces.<id>.meaning]` loads no model, and
`meaning` is `off` everywhere. This answers open decision O4 for record lanes: none by default, chosen per instance
by its own eval. O4 stays open for knowledge search.

| `models.<mid>` key | Providers | Rule |
| --- | --- | --- |
| `provider` | all | `static`, `onnx` or `http` |
| `name` | all | 1 to 128 characters; the model's public name, for people and for the HTTP request |
| `dir` | `static`, `onnx` | Relative to the workspace, resolving inside it, not under `state/` |
| `files` | `static`, `onnx` | A table of file name to `sha256:<64 hex>`. `static`: exactly `model.safetensors`, `tokenizer.json`, `config.json`. `onnx`: exactly `model.onnx`, `tokenizer.json`, `config.json`, `special_tokens_map.json`, `tokenizer_config.json` |
| `pooling` | `onnx` | `mean` (default) or `cls` |
| `max_length` | `onnx` | 16 to 8192 tokens, default 512 |
| `url` | `http` | An `https` URL. Or an `http` URL whose host is a literal loopback address, `127.0.0.0/8` or `[::1]`, never a name: a model server on the same machine. Anything else is refused when the configuration is read |
| `dimensions` | `http` | 16 to 4096. The static provider reads its own (`StaticModel::dim`). The ONNX provider embeds the one text `dimensions` when it loads and takes the length of the answer, 16 to 4096, else the model stays unloaded |
| `version` | `http` | Required: 1 to 64 characters. The deployer's word for which model the endpoint serves |
| `bearer_env` | `http` | The name of an environment variable holding a bearer token; optional |
| `timeout_ms` | `http` | 100 to 60 000, default 5 000 |

The **model id** is `<mid>@` and the first 16 hexadecimal digits of the SHA-256 of the canonical JSON of the
table, without `bearer_env` and `timeout_ms`. So a changed file digest, pooling, length, endpoint or version is a
different model, whose vectors are not the old one's.

**Model files live in the workspace and are pinned.** At start the host reads each file of each configured model,
checks its SHA-256 against the configuration, and loads the model from those bytes. A mismatch, a missing file or a
provider this build was not compiled with leaves the model unloaded: `meaning` is `off` for its spaces and the
doctor's `records.meaning` fails. **The host never downloads**, at start or in a request: the static and ONNX
providers are built without their crates' download features (section 1).

| Provider | Feature | What runs |
| --- | --- | --- |
| `static` | `embed-static` | A token lookup table, averaged: `model2vec_rs::StaticModel::from_bytes`. No inference runtime. Phase 0 measured 17 700 statements a second for `potion-base-8M` |
| `onnx` | `embed-onnx` | A transformer through ONNX Runtime: `fastembed::TextEmbedding::try_new_from_user_defined`, behind a `Mutex`, since its `embed` takes `&mut self`. Phase 0 measured 9 to 78 statements a second on one machine's CPU |
| `http` | `embed-http` | `POST <url>` with `{ "model": <name>, "input": [<text>, ...] }`, and `Authorization: Bearer` when `bearer_env` is set. The answer is `{ "data": [ { "index", "embedding" }, ... ] }`. The scheme is what `url` allows; no redirect is followed; the answer is capped at 16 MiB; at most 64 texts a request |

**The HTTP provider sends record text off the machine.** It is the deployer's explicit choice, the doctor warns
about it by name every run, and it is the only path here by which a record's text leaves the host other than as an
answer to a reader.

### 9.3 Principle 4 (D168)

Principle 4 says the host never calls a language model to answer a request. An embedding of the incoming text is
within it: it produces numbers, writes no text and makes no judgment, the judgment stays with the calling model and
the person, and the architecture already names optional local embeddings behind a provider trait
([section 6](../../architecture.md#libraries-and-infrastructure)). This is taken on the Ideas plan's recommendation
(its section 11, question 4), which the owner was not asked by itself. It is recorded as such, and is the owner's
to overturn. What it costs is latency inside a request (9.2's figures) and, with the HTTP provider, a network call.

### 9.4 Vectors

A vector is computed after a put's write commits (4.2, step 8), scaled to length 1, and stored in
`record_vectors` under the model id. A match embeds its texts in batches of 64, and only after its query has passed
every check the host can make without the store's answer: the limits of 11.1, the kind, and `lane_status` saying
the kind is not stale. So no text goes to a provider for a call that is then refused for its shape.

**Search is an exact scan**: one statement reads the reader's admitted vectors of the kind for the model, with the
key and exclude clauses, and the host takes dot products. The **design bound is 100 000 records of a kind in a
space**. Past it nothing is refused; the doctor's `records.size` warns, and step B6 records the time at 10 000 and
at 100 000. An index over vectors is a follow-up, to be taken only on those figures.

**Missing vectors.** A record has no vector when it was written with no model loaded, under another model id, or
when its embedding failed. For a call, `meaning` is `incomplete`, and every hit is scored by words alone, when any
admitted record the reader may read, of the kind, with a match value, has no vector for the current model. The
check uses the reader's records only, so a record the reader cannot read changes nothing in the answer.
`store-records-reindex` computes what is missing and deletes the vectors of every other model; the doctor reports
the count.

## 10. The gate for a meaning lane (D167)

D65's pattern, for record lanes: a lane is served only where the instance's own measurement supports it.

**`store-records-eval`** (12.2) scores an instance's labelled probes by words alone and fused. A probes file is the
deployer's, in the workspace, `schemas/record-probes.v1.json`:

```json
{ "version": 1, "space": "garden", "plugin": "notes", "kind": "note",
  "probes": [ { "id": "p-01", "text": "Cut the roses back before spring growth starts.",
                "duplicates": ["n1"], "self": null, "reader": null } ] }
```

`duplicates` are the ids of the stored records that are the same statement; a probe may have none. `self` is the
record the text was taken from: it is passed as `exclude`, so it is left out of the answer and of the statistics
(8.2). `reader` is a principal string, by default the space's `person`. At most 5 000 probes.

For each probe the command runs the store's match as that reader with `k = 20`, once by words alone and once
fused, whether or not the lane is served yet. A probe with a duplicate is a *hit* at `j` when one of its duplicates
is among the first `j` of `nearest`. The command then checks each returned id against `record_access` by a
separate statement: an id the reader may not read is a *leak*.

It writes `evals/records/<space>/<plugin>.<kind>.json`, beside the configuration
(`schemas/record-eval-report.v1.json`). The report holds no text:

| Member | Holds |
| --- | --- |
| `version`, `space`, `plugin`, `kind` | 1, and what was scored |
| `declHash`, `normalisation` | The kind's declaration hash and `NORMALISATION_VERSION` at the eval |
| `model`, `weight`, `k` | The model id and the space's two settings at the eval |
| `probes`, `n` | How many probes, and how many have a duplicate |
| `hits` | `{ "words": { "1", "3", "5", "10", "20", "k" }, "fused": { the same } }`: counts of probes, never rates |
| `leaks` | The count |
| `records` | How many records the kind held |
| `probesDigest`, `hostVersion`, `at` | The SHA-256 of the probes file, the host's version, the time |
| `passed` | The command's own answer, for a person reading the file. The host does not trust it |

**The rule.** With `n` the probes that have a duplicate, a report passes when all three hold:

```text
n >= 50
hits.fused.k - hits.words.k >= max(3, ceil(0.02 * n))
leaks == 0
```

Counts are compared, not rates, so the rule cannot pass on a rounding. At `n = 50` fused must find the duplicate
within `k` for three more probes than words alone; at `n = 200`, four more; at `n = 500`, ten more.

**Serving.** For a space, plugin instance and kind, `meaning` is `served` only when the model loaded and a report
exists that the host itself finds to pass: it recomputes the rule from the report's counts, and requires the
report's `declHash`, `normalisation`, `model`, `weight` and `k` to equal the kind's declaration hash, the build's
normalisation version and the space's configuration. A report bound to anything else is not this lane's. Otherwise
`meaning` is `off`, matching is by words, and the doctor's `records.meaning` says why. Vectors are written whenever
a model is loaded, gate or no gate, so that the eval has something to score.

**When the report is read.** When a host process starts, for every space, instance and kind; and again by
`store-records-reindex` for the kinds it rebuilt, since a rebuild after a changed declaration unbinds the report.
Every `umbel` command is its own process, so it reads the report as it stands. A server already running serves by
what it read at its start, and is restarted after an eval.

**Going stale.** A report does not expire by date. The doctor's `records.meaning` warns when a kind holds more than
four times the `records` its report names: a duplicate falls further down the list as a store grows, so recall
measured on a small store says little about a large one.

The order of work for a deployer is therefore: configure the model, run `store-records-reindex`, run
`store-records-eval`, read the report, restart the server.

**Phase 0's figures are indicative only.** Across documents, on 35 probes with a duplicate, words alone found the
duplicate within five for 0.886 of them (31), and words fused with a model for between 0.914 (32) and 0.971 (34),
with labels made by models and weights chosen on the same labels. **None of that would pass this gate**: 35 is
under 50, and the static model, `potion-base-8M`, found one more probe than words alone, where the rule asks for
three. Whether a static model is worth its lane is exactly what an instance's own 50 probes are for.

## 11. Traits and the SDK

### 11.1 `umbel-store`

`store/src/lane.rs` holds the shared types, so the host, the SDK and every backend name the same ones. `extract`,
`normalise` and `score` are pure functions there, so every backend refuses alike and scores alike, as
`check_record` does today (`store/src/document.rs:439`). The crate still builds for `wasm32-wasip2`.

```rust
pub const MAX_RECORD_KINDS: usize = 16;
pub const MAX_TEXT_POINTERS: usize = 4;
pub const MAX_KEY_POINTERS: usize = 16;
pub const MAX_POINTER_BYTES: usize = 128;
pub const MAX_LANE_TEXT_BYTES: usize = 16 * 1024;
pub const MAX_KEY_VALUES: usize = 64;
pub const MAX_KEY_VALUE_BYTES: usize = 256;
pub const MAX_EVIDENCE_UNITS: usize = 256;
pub const MAX_FIND_LIMIT: u32 = 200;
pub const MAX_FIND_QUERY_CHARS: usize = 1024;
pub const MAX_KEY_FILTERS: usize = 8;
pub const MAX_MATCH_TEXTS: usize = 64;
pub const MAX_MATCH_K: u32 = 20;
pub const MAX_MATCH_EXCLUDE: usize = 64;
pub const MAX_IDENTICAL: usize = 8;
pub const GATHER_POSTINGS: u64 = 20_000;
pub const STAT_POSTINGS: u64 = 4_000_000;
pub const MATCH_POOL: usize = 64;
pub const LANE_DESIGN_RECORDS: u64 = 100_000;
pub const NORMALISATION_VERSION: u32 = 1;

pub struct Pointer(String);                       // parse, as_str, get(&Value) -> Option<&Value>
pub struct RecordDecl {
    pub kind: String,
    pub standing: bool,
    pub text: Vec<Pointer>,
    pub keys: Vec<Pointer>,
    pub matched: Option<usize>,                   // an index into `text`
}
impl RecordDecl {
    pub fn check(&self) -> Result<()>;            // section 2's rules
    pub fn hash(&self) -> ContentHash;            // of {"keys","kind","match","standing","text"}, canonical
}

pub struct Extracted {
    pub texts: [Option<String>; 4],
    pub keys: Vec<(u8, String)>,                  // (key position, value), sorted, distinct
    pub wording_hash: Option<ContentHash>,
    pub match_digest: Option<[u8; 32]>,
    pub terms: Vec<(u8, String, u32)>,            // (field position, term, frequency)
    pub lengths: [u32; 4],
}
pub fn extract(decl: &RecordDecl, body: &Value) -> Result<Extracted>;   // Invalid names the pointer

pub enum Standing { Unverified, Attested, Affirmed }                    // serialised in lower case
pub struct Evidence {
    pub doc: DocId,
    pub doc_hash: ContentHash,
    pub units: Vec<u32>,                          // 1 to 256, each at least 1, ascending, distinct
    pub rule: String,                             // ^[a-z][a-z0-9-]{0,62}/[0-9]{1,6}$, such as sentences/1
    pub speaker: Option<String>,                  // 1 to 128 characters, no control character
    pub verbatim: bool,
}
pub struct LaneWrite {
    pub evidence: Option<Evidence>,               // None leaves the stored evidence
    pub flags: Vec<MemoryFlag>,
    pub model: Option<ModelId>,                   // the space's loaded model, if any
}
pub struct DeclaredPut {
    pub meta: RecordMeta,
    pub embed: Option<[u8; 32]>,                  // the match digest to embed for, when `model` has no vector
}

pub struct OwnCollection { pub id: String, pub speaker: Option<String> }
/// What the host derives from the configuration for one call. Only the host builds one.
pub struct StandingView {
    pub own: Vec<OwnCollection>,
    pub command_writable: Vec<String>,            // the space's collections a command can write files into
    pub person: Vec<String>,                      // the principals the space's person decides as (section 6)
    pub admit: Vec<Standing>,                     // 6.6's `admitted`
}

pub enum OwnBasis { Collection, Marked }
pub struct Affirmation {
    pub at: String,
    pub level: String,                            // terminal or verified
    pub seen: Option<AffirmationSeen>,            // None for a reader who is not the operator or the person
}
pub struct AffirmationSeen { pub by: String, pub assurance: Assurance }
pub struct LabelSource {
    pub basis: OwnBasis,
    pub seen: Option<SourceSeen>,                 // None when the reader may not read the document
}
pub struct SourceSeen {
    pub doc: DocId,
    pub content_hash: ContentHash,
    pub speaker: Option<String>,
    pub units: Vec<u32>,
    pub rule: String,
    pub stored_at: String,
    pub generated_at: Option<String>,
}
pub struct StandingLabel {
    pub standing: Standing,
    pub affirmed: Option<Affirmation>,
    pub source: Option<LabelSource>,
}
pub struct LaneRecord {
    pub record: Record,
    pub created_at: String,
    pub flags: Vec<MemoryFlag>,
    pub label: Option<StandingLabel>,             // None for a kind without standing
}
impl LaneRecord { pub fn to_json(&self) -> Value; }                     // section 6.5's shape

pub struct KeyFilter { pub key: Pointer, pub any: Vec<String> }
pub enum FindOrder { Id, Recent, Rank }
pub struct TextQuery { pub query: String, pub fields: Vec<Pointer> }
pub struct RecordFind {
    pub kind: String,
    pub keys: Vec<KeyFilter>,
    pub standings: Vec<Standing>,
    pub verified_only: bool,
    pub text: Option<TextQuery>,
    pub order: FindOrder,
    pub after: Option<String>,
    pub limit: u32,
    pub total: bool,
}
pub struct FindPage {
    pub items: Vec<LaneRecord>,
    pub next: Option<String>,
    pub total: Option<u64>,
    pub admitted: Vec<Standing>,
    pub cut: bool,
}

pub struct RecordMatch {
    pub kind: String,
    pub texts: Vec<String>,
    pub k: u32,
    pub keys: Vec<KeyFilter>,
    pub standings: Vec<Standing>,
    pub verified_only: bool,
    pub exclude: Vec<String>,
}
/// The incoming texts' unit vectors, one per text, which the host computed.
pub struct MatchVectors { pub model: ModelId, pub weight: f64, pub vectors: Vec<Vec<f32>> }
pub struct MatchHit {
    pub id: String,
    pub rev: Rev,
    pub text: String,                             // the match field's value
    pub flags: Vec<MemoryFlag>,
    pub label: Option<StandingLabel>,
    pub words: Option<f64>,                       // None in `identical`
    pub meaning: Option<f64>,
    pub fused: Option<f64>,
}
pub struct MatchResult { pub identical: Vec<MatchHit>, pub nearest: Vec<MatchHit>, pub cut: bool }
pub enum MeaningState { Served(ModelId), Off, Incomplete, Failed }
pub struct MatchPage {
    pub results: Vec<MatchResult>,
    pub admitted: Vec<Standing>,
    pub meaning: MeaningState,
}

pub enum Decision { Affirm, Withdraw }
/// What a decision and a mark did (step B3, A24): the host notes for its call only a revision that was taken.
pub struct Decided { pub label: StandingLabel, pub rev: Option<Rev> }
pub struct Marked { pub rev: Rev, pub wrote: bool }
pub struct RecordDecision {
    pub decision: Decision,
    pub by: String,
    pub at: String,
    pub assurance: Assurance,
    pub trace_id: Option<String>,
}
pub struct OwnMark {
    pub doc: DocId,
    pub doc_hash: ContentHash,
    pub speaker: Option<String>,
    pub by: String,
    pub at: String,
    pub assurance: Assurance,
    pub trace_id: Option<String>,
}
pub struct OwnInfo {
    pub basis: OwnBasis,
    pub speaker: Option<String>,
    pub content_hash: ContentHash,
    pub stored_at: String,
    pub generated_at: Option<String>,
}

pub enum LaneState { Ready, Stale }
pub struct LaneStatus {
    pub state: LaneState,
    pub stored: Option<String>,                   // the stored declaration's canonical JSON, if any
    pub affirmed: u64,                            // records affirmed now
    pub evidence: u64,                            // evidence rows
    pub records: u64,                             // records of the kind
    pub unindexed: u64,                           // of those, without a lane row
    pub with_match: u64,
    pub vectors: BTreeMap<String, u64>,           // by model id
}
pub struct ReindexReport {
    pub records: u64,
    pub unindexed: u64,
    pub wordings_changed: u64,                    // records that lost their affirmation and evidence
    pub superseded: bool,                         // the generation moved: the kind is still stale (12.1)
    pub vectors_written: u64,
    pub vectors_removed: u64,
}
```

`DocumentStore` (`store/src/traits.rs:20`) gains eleven methods. They are required, not defaulted: a backend
implements the lane or does not pass the suite. `put_record`, which exists, gains one duty: it sets the stale mark
of a kind that has a `record_kinds` row (section 2).

```rust
fn put_declared_record(&self, ns: &str, decl: &RecordDecl, id: &str, body: Value, envelope: Envelope,
    expect: Expect, lane: LaneWrite, writer: &ReaderFilter) -> Result<DeclaredPut>;
/// Store `vector` for the record if its match digest is still `digest`; whether it was stored.
fn put_record_vector(&self, ns: &str, decl: &RecordDecl, id: &str, digest: &[u8; 32], model: &ModelId,
    vector: Vec<f32>) -> Result<bool>;
fn read_record(&self, ns: &str, decl: &RecordDecl, id: &str, view: &StandingView,
    reader: &ReaderFilter) -> Result<Option<LaneRecord>>;
fn find_records(&self, ns: &str, decl: &RecordDecl, query: &RecordFind, view: &StandingView,
    reader: &ReaderFilter) -> Result<FindPage>;
/// `Served` or `Incomplete` when `vectors` is given, `Off` otherwise; the host sets `Failed`.
fn match_records(&self, ns: &str, decl: &RecordDecl, query: &RecordMatch, vectors: Option<&MatchVectors>,
    view: &StandingView, reader: &ReaderFilter) -> Result<MatchPage>;
fn decide_record(&self, ns: &str, decl: &RecordDecl, id: &str, decision: RecordDecision,
    view: &StandingView, reader: &ReaderFilter) -> Result<Decided>;
fn mark_document_own(&self, mark: OwnMark, reader: &ReaderFilter) -> Result<Marked>;
fn unmark_document_own(&self, doc: &str, at: &str, trace_id: Option<&str>,
    reader: &ReaderFilter) -> Result<Rev>;
fn document_own(&self, doc: &str, view: &StandingView, reader: &ReaderFilter) -> Result<Option<OwnInfo>>;
/// Rebuild one kind's lane from its `records` rows (12.1). `scan` is the host's write scan.
fn reindex_records(&self, ns: &str, decl: &RecordDecl, scan: &dyn Fn(&str) -> Vec<MemoryFlag>,
    embedder: Option<&dyn Embedder>, vectors_only: bool) -> Result<ReindexReport>;
fn lane_status(&self, ns: &str, decl: &RecordDecl) -> Result<LaneStatus>;
```

After step B3's review the trait gains three more, for the fact that the host held a document to its file
(section 3, rule 2; [A36](#amendments-from-step-b3)), under the same traits version:

```rust
/// `put_document`, and in the same transaction the fact that the host held this content to its file.
fn put_document_held(&self, doc: DocumentWrite, expect: Expect) -> Result<DocMeta>;
/// Record the fact for a stored document at `hash`; false when it is absent or has another content hash.
fn hold_document(&self, doc: &str, hash: &ContentHash) -> Result<bool>;
/// How many stored documents of `collection` are not held to their file at their current content.
fn unheld_documents(&self, collection: &str) -> Result<u64>;
```

`StoreError` (`store/src/error.rs:8`) gains `LaneStale`, `WordingFixed`, `EvidenceInvalid(String)` and
`LaneTooBroad { limit: u64 }`.
`ChangeKind` gains `Standing`. `STORE_TRAITS_VERSION` becomes 3.

### 11.2 The SDK

`sdk/src/records.rs` adds to `Cx`, and to `SpaceCx` with the space bound. The three read methods are also on
`Reader`, through the `reads!` macro (`sdk/src/store.rs:118`). `HostServices` (`sdk/src/cx.rs`) gains the same
eight, each defaulting to `not_granted`, as its record methods do today (`cx.rs:483`).

```rust
pub fn record_put_cited(&self, space: &str, kind: &str, id: &str, body: Value, envelope: Envelope,
    expect: Expect, evidence: Evidence) -> Result<RecordMeta, HostError>;
pub fn record_read(&self, space: &str, kind: &str, id: &str, standings: &[Standing],
    verified_only: bool) -> Result<Option<LaneRecord>, HostError>;
pub fn record_find(&self, space: &str, query: &RecordFind) -> Result<FindPage, HostError>;
pub fn record_match(&self, space: &str, query: &RecordMatch) -> Result<MatchPage, HostError>;
pub fn record_decide(&self, space: &str, kind: &str, id: &str,
    decision: Decision) -> Result<StandingLabel, HostError>;
pub fn doc_own_mark(&self, space: &str, doc: &str, content_hash: &ContentHash,
    speaker: Option<&str>) -> Result<Rev, HostError>;
pub fn doc_own_unmark(&self, space: &str, doc: &str) -> Result<Rev, HostError>;
pub fn doc_own(&self, space: &str, doc: &str) -> Result<Option<OwnInfo>, HostError>;
```

The host's side is `src/plugins/record_services.rs`. For each call it builds the reader filter as every store read
does (`CallServices::filter`, `store_services.rs:118`) and the `StandingView` from the space's configuration
(its own collections, its command-writable ones, and 6.6's `admitted`). It embeds a put's text after the store has
written it, and a match's texts after the query has passed its checks (9.4). A component and a mounted server
reach none of this: WIT world 1.0.0 has no such function, and they cannot declare a kind.

## 12. Built-ins, the doctor and `workspace-show`

Both commands are host built-ins in the `store` domain, exposed to the CLI only, for the operator only
(`operator_only`, `src/commands/mod.rs:117`), and journaled as a digest that keeps their inputs, none of which is
content. Both join `UNPROJECTED_MUTATIONS` (`src/middleware.rs:81`): they change no record and make no event.

### 12.1 `store-records-reindex`

Input `{ space, plugin?, kind?, vectorsOnly?: false }`. For each loaded instance and declared kind it names, in
the space, it calls `reindex_records`:

1. Unless `vectorsOnly`, the rebuild, **in chunks, so the write lock is never held for a whole kind**:
   1. One short transaction sets the kind's stale mark and adds one to its generation, inserting its
      `record_kinds` row if there is none, and the rebuild remembers the generation it wrote. From here every lane
      service on the kind answers `RECORD_LANE_STALE` until step 1.4, whether or not it was stale before: a kind
      being rebuilt is offline, and everything else in the store is not.
   2. One read, outside any write transaction: for the records of the kind that have no lane row, their first
      revision and its time, by **one grouped scan** of `changes`
      (`SELECT target, MIN(rev), at FROM changes WHERE kind = 'record' GROUP BY target`, kept for the kind's
      targets). `changes` has no index on `target`, so this is one pass over the log and never a lookup a record.
   3. The kind's `records` rows, by id, 1 000 to a `BEGIN IMMEDIATE` transaction. For each: `extract` it; write
      its lane row, replacing its terms and keys. A row with no lane row yet takes `created_rev` and `created_at`
      from step 1.2, else from its own revision and envelope. A body that `extract` refuses under the declaration
      is left without lane rows and counted as `unindexed`. **A record whose wording hash is not the one
      its lane row held loses its standing, whatever the kind is declared as now**: `affirmed_seq` is cleared,
      its evidence row is deleted, its vectors are deleted, and it is counted in `wordings_changed`. (Amended
      after step B2's review, which had this "for a standing kind": a wording edited while the kind was
      undeclared, rebuilt under a declaration without standing and then declared standing again, would have kept
      its affirmation on words the person never saw. A put already cleared it, by section
      [4.3](#43-wording-never-changes-d160).) Access sets are not touched: a record written before the kind was
      declared keeps the access the plugin gave it. **Each chunk's transaction reads the generation first, and
      writes nothing unless it is the one step 1.1 wrote**: when it has moved, the rebuild stops there and
      reports `superseded`. **Between two chunks the rebuild leaves the write lock free for a pause**, 120 ms in
      the embedded store, longer than the longest sleep of SQLite's busy handler, so a writer that was waiting
      for the lock takes it before the next chunk does.
   4. One short transaction reads the generation. **Only if it is still the one step 1.1 wrote** does it write the
      declaration to the `record_kinds` row and clear the stale mark. If it moved, an undeclared put from another
      process or another rebuild ran during the chunks: the kind stays stale, the report says `superseded`, and the
      command's result carries the warning `RECORD_LANE_STALE` with "run it again". So a write the rebuild did not
      see is never forgotten.

   A rebuild that stops part-way leaves the kind stale, and running it again finishes it: each chunk is whole, and
   rewriting a record's lane rows twice gives the same rows. That holds when what stops it is the host's `scan`
   unwinding, which is a contract on every backend and stated on the trait ([A15](#amendments-from-step-b2)).

   **Two rebuilds at once** (corrected after step B2's review). The sentence that stood here, "two rebuilds at
   once are safe for the same reason, and the one that started first reports `superseded`", was true only of two
   rebuilds under one declaration. Under two, the later one cleared the stale mark with its declaration while the
   earlier kept writing chunks under its own, and the kind was left ready with rows of a declaration that was
   not the stored one: in the review's probe, 10 lane rows of 12. What holds now, and why: a rebuild writes only
   while the generation is its own, and reads it inside each chunk's transaction. Chunks and step 1.1 are write
   transactions, so they are in one order. A chunk of the earlier rebuild that comes before the later one's
   step 1.1 is overwritten, since the later rebuild then writes every row of the kind. One that comes after
   finds the generation moved and writes nothing. So of two rebuilds at once, under one declaration or two, the
   later writes every row and clears the mark, and the earlier reports `superseded` and clears nothing.
2. Vectors, outside any long transaction: for each record with a match value and no vector for the space's model,
   embed in batches of 64 and write each batch in its own transaction. Delete the vectors of every other model.
3. Read the kind's gate report again (10) and say in the output whether the lane is served.

Output: per kind, the `ReindexReport` and `meaning`. Failures: `RECORD_KIND_NOT_DECLARED`, `STORE_BUSY`. When the
space configures a model that did not load, step 2 is skipped: with `vectorsOnly` that is the failure
`RECORD_MODEL_UNAVAILABLE`, since nothing was done; without it the rebuild succeeded, and the same code is a
warning on the result.

**What it costs, and what is guaranteed** (corrected after step B2's review). The independent review of this
document measured the rebuild of one kind at 100 000 records at about 8 seconds in one transaction. This section
then said that in chunks of 1 000 "no writer waits longer than one chunk, about a tenth of a second". Chunks
alone did not give that: the rebuild took the lock again microseconds after each commit, while a waiting writer
slept in SQLite's busy handler for up to 100 ms between tries, so the writer could lose every race. The review of
step B2 measured it on a debug build at 30 000 records: unrelated `put_record` calls waited up to 5.4 seconds,
and 3 of 10 failed as busy. **What is guaranteed is this, and no figure: a writer that is waiting for the lock
gets a turn between two chunks**, because the rebuild pauses there for longer than the handler's longest sleep.
How long a writer waits, and what the pauses add to a rebuild (about a hundred of them at 100 000 records), are step B6's to
measure.

### 12.2 `store-records-eval`

Input `{ space, plugin, kind, probes }`, where `probes` is a path relative to the workspace, inside it and not
under `state/`, of at most 16 MiB. It does what section 10 says and returns the report it wrote. Failures:
`RECORD_KIND_NOT_DECLARED`, `RECORD_PROBES_INVALID` (naming the first rule broken and the probe's id, never its
text), `RECORD_MODEL_UNAVAILABLE` (no model configured for the space, or it did not load: always a failure here,
since there is nothing to score), `RECORD_LANE_STALE`.

### 12.3 Doctor checks

| Check | Passes when | Otherwise |
| --- | --- | --- |
| `records.declared` | Every declared kind of every loaded instance is `Ready` in each of its spaces, with no unindexed record | `fail` for a stale kind, naming it and `umbel store-records-reindex`. **For a kind whose stored `text` differs from the manifest's and that holds an affirmation or an evidence row, whatever the manifest declares it as, it adds that the rebuild will remove its affirmations and evidence rows, with both counts** (section 2; amended in step B3, [A25 and A26](#amendments-from-step-b3)); `warn` for unindexed records, with the count |
| `records.standing` | Every space where a standing kind is enabled has a `person` | `warn`: no record there can be affirmed or attested. It also lists each space's own collections, its command-writable ones and `verified_admits`, and says whether a person is set, never who ([A33](#amendments-from-step-b3)) |
| `records.meaning` | No space configures a model; or each configured model loaded, has no missing vector, and has a passing report for each kind with a match field | `fail` for a file whose digest differs, a missing file, or a provider not compiled in; `warn` for a missing report, one that does not pass or is bound to another declaration, normalisation, model, weight or `k`, saying which; for a kind that holds more than four times the records its report names; and for missing vectors, with the count. **Always `warn` for an `http` model, naming the host record text is sent to** |
| `records.own` | Every stored document of every own collection is held to its file on disk (section 3, rule 2), in each space that has a store | `warn`, naming each `<space>/<collection>` with its count of documents not held, which attest nothing, and `umbel store-documents-hold`; `fail` when a store cannot be read. After step B3's review ([A36](#amendments-from-step-b3)) |
| `records.size` | No kind holds more than 100 000 records in a space | `warn`, naming the kind and the count |

### 12.4 `workspace-show` and `plugin-show`

`workspace-show`'s `versions` (`src/commands/workspace_show.rs:125`) gain `manifest: [1, …, 6]`,
`config: [1, …, 6]` and `store: 3`. Each space it lists gains `person` (whether one is set, not who, for a caller
who is not the operator), `verifiedAdmits`, the ids of its own collections, and `meaning`: the
model id and, per
`<plugin>.<kind>`, whether it is served. `plugin-show` lists an instance's declared kinds with their pointers.

### 12.5 `store-documents-hold`

Added after step B3's review ([A36](#amendments-from-step-b3)). A host built-in in the `store` domain, as the two
above are: exposed to the CLI only, for the operator only, journaled as a digest that keeps its inputs, and in
`UNPROJECTED_MUTATIONS`. It changes no document and makes no event.

Input `{ space, collection }`. The collection must be one of the space configured `own = true`, else
`STORE_COLLECTION_NOT_OWN`. For each stored document of the collection it reads `<root>/<path>` as section 3's
rule 2 does and, where the file's hash is the document's content hash, records that the host held the document to
its file (`hold_document`). Output: `space`, `collection` and three counts: `documents`, `held` (equal to their
file, and held now) and `differing` (not equal, or with no file). **Counts, and never a document's id or text.**
With `differing` above zero the result carries the warning `STORE_OWN_SOURCE_MISMATCH`: the collection's sync
stores a changed file again and removes a document whose file is gone. Running it again changes nothing.

It is how a collection that already holds documents becomes the person's own: after `own = true` is set, and after
a store migrates to schema version 3 (5.1). A sync does not do it, since it skips a file that did not change.

## 13. Failures

A host service answers `HostError` (`sdk/src/cx.rs:158`), which has a variant and a message and no suggestion.
The message begins with the code, as `STORE_WRITE_NOT_ALLOWED` does today (`store_services.rs:27`). The last
column is what the calling plugin's own failure should suggest; the plugin's specification fixes its wording. No
message, detail or log line holds a record's text or a key's value.

| Code | Variant | When | Message after the code | The plugin should suggest |
| --- | --- | --- | --- | --- |
| `RECORD_KIND_NOT_DECLARED` | `Invalid` | A lane service on a kind the instance's manifest does not declare, or `record_match` on one with no `match` | `the kind <kind> is not a declared record kind of <instance>` | Nothing to a caller: a plugin fault |
| `RECORD_KIND_STANDING` | `Invalid` | `record_get` or `record_list` on a standing kind | `<kind> is a standing kind: read it with record_read or record_find, which label it` | A plugin fault |
| `RECORD_KIND_NOT_STANDING` | `Invalid` | `record_put_cited` or `record_decide` on a kind without standing | `<kind> is not a standing kind` | A plugin fault |
| `RECORD_PRINCIPAL_REQUIRED` | `Invalid` | A put with no effective principal | `a declared record needs a caller with an effective principal` | Call as an identified principal |
| `RECORD_FIELD_INVALID` | `Invalid` | 4.2, step 4 | `the value at <pointer> must be <rule>` | Fix the field named |
| `RECORD_WORDING_FIXED` | `Invalid` | 4.3 | `the wording of a standing record never changes; write a new record` | Capture the new wording as a new record |
| (none) | `Conflict { current: None }` | A put on an existing record the writer may not read (4.2, step 7.2) | | Use another id |
| `RECORD_EVIDENCE_INVALID` | `Invalid` | The evidence's shape, or its document is absent, unreadable by the writer or has another content hash | `the evidence is not acceptable: <which rule>` | Read the document again and cite its current content |
| `RECORD_LANE_STALE` | `Invalid` | Section 2, any of four: the declaration changed; records predate it; a record was written while the kind was undeclared; **a rebuild is under way** | `the lane of <kind> is being rebuilt or must be rebuilt` | Retry once after a few seconds: a rebuild in chunks ends by itself. If it is still refused, ask the operator to run `umbel store-records-reindex`. The plugin's failure is retryable |
| `RECORD_QUERY_INVALID` | `Invalid` | A find or match query that breaks a rule of section 7 or 8 | `<which rule>` | Fix the field named |
| `RECORD_QUERY_TOO_BROAD` | `Invalid` | A match, or a ranked find, whose counts pass `STAT_POSTINGS` (8.2). Nothing is returned | `the call counts more than <limit> postings` | Match fewer texts in one call; if one text does it, tell the operator the kind is past its design size |
| `RECORD_DECISION_NOT_GATED` | `NotGranted` | 6.1, check 2 | `a decision on standing is made only inside a call a person decided` | Call the plugin's review command on its own and have the person decide it |
| `RECORD_DECISION_NOT_THE_PERSON` | `NotGranted` | 6.1, check 3 | `only the space's person decides standing here` | Have the space's person decide, or ask the operator to set the space's `person` |
| `STORE_OWN_SOURCE_MISMATCH` | `Invalid` | Section 3, rule 2 | `a document of a collection named as the person's own must equal its file on disk` | Run the sync again |
| `STORE_OWN_MARK_REFUSED` | `NotGranted` | 6.2, checks 3 and 4 | `a document can be marked as the person's own only where no command writes files`, or `only when it equals its file on disk` | Tell the person this document cannot be marked: it lies where commands write, or is not the synced file. Sync again if the file changed |

A record that is absent, unreadable or not admitted is `None` from `record_read`, without saying which. A record
or document that is absent or unreadable is `NotFound` from `record_decide`, `doc_own_mark` and `doc_own_unmark`,
without saying which; what a call admits plays no part there. `StoreError::LaneStale`, `WordingFixed`,
`EvidenceInvalid` and `LaneTooBroad` map to the codes above in `host_error` (`src/store/mod.rs:116`); every other
store error maps as today.

One code covers a kind that waits for a rebuild and one in the middle of one, on purpose. The store cannot tell a
rebuild that is running from one that stopped: the stale mark is all either leaves. A second code would tell
callers to wait for a rebuild that had died. So the one code says both, and the suggestion is to retry once and
then ask.

The built-ins answer `CommandError`s, with a suggestion as AFD requires:

| Code | When | Retryable | Suggestion |
| --- | --- | --- | --- |
| `RECORD_KIND_NOT_DECLARED` | The plugin instance is not loaded for the space, or declares no such kind | No | List the instance's declared kinds with `umbel plugin-show <plugin>` |
| `RECORD_PROBES_INVALID` | The probes file is missing, too large, not valid against `record-probes.v1.json`, or names another space, plugin or kind | No | Fix the file at the place the message names and run the command again |
| `RECORD_MODEL_UNAVAILABLE` | `store-records-eval`, and `store-records-reindex` with `vectorsOnly`: no model is configured for the space, or it did not load. On a full `store-records-reindex` the same code is a warning on a successful result | No | Run `umbel workspace-doctor` and fix what `records.meaning` reports |
| `RECORD_LANE_STALE` | The kind is stale | No | Run `umbel store-records-reindex` first |
| `STORE_COLLECTION_NOT_OWN` | `store-documents-hold` on a collection that is not one of the space configured `own = true` | No | Name a collection whose table sets `own = true`; `umbel workspace-doctor` lists them under `records.standing` |

## 14. Security

| Threat | Handling |
| --- | --- |
| An agent claims standing for its own write | No input of any service is read as standing. A decision row needs the person gate's proof for this call and this input (6.1); attested needs a document the host stores, at the cited hash, that is the person's own now (6.3). A body's fields are the plugin's |
| A process at a terminal that is an agent affirms | At a terminal the proof asks for the CLI's human-present mark as well as the answered prompt, and the CLI withholds that mark when an agent variable is set, so such a call passes the plugin gate and still affirms and marks nothing (6.1, after step B3's review). **What remains is D74's limit, and D86's**: a process that unsets the agent variables and holds a pseudo-terminal is, to the CLI, a person at a terminal. The assurance `terminal` is "not an attestation" (`src/authority.rs`). Where that matters, the plugin declares its review command `person = { cli = "verified" }`, and an affirmation then rests on a login on the person page |
| A former person's decisions keep counting | A decision affirms, and a mark counts, only when it was made by one of the principals the space's person decides as now (section 6). Changing `spaces.<id>.person` sets the former person's decisions aside, with nothing deleted |
| A lane row that names a decision it should not | An affirmation is read as one only when the decision is an affirmation of the wording the lane row holds now (section 6), so D160 holds at each read as well as at each write |
| A reader learns who a space's person is, through a label | `affirmed.by`, and all of a decision's assurance but its level, are shown to the operator and to the space's person only (6.5), as `workspace-show` says only whether a space has a person (12.4) |
| An agent rewrites words a person affirmed | The wording of a standing record never changes (D160). A plugin version that drops the declaration to edit a wording leaves the kind stale, and the rebuild takes the standing from every record whose wording changed (section 2, 12.1) |
| A compiled plugin sets `verbatim` wrongly | Possible: it is trusted code (D42, D162). The evidence records what it compared, so a replay finds it. Components cannot declare a kind |
| A command's input becomes "the person's own" file | A collection cannot be `own` while it is command-writable, **in any space that shares its directory**, and a document put there must equal its file (section 3). A root that does not exist yet counts where it would be created, since a content write makes missing directories. **Judged once, when a host reads the configuration at its start** ([A2](#amendments-from-step-b1)): a symbolic link changed under a running host is not seen until its next start, and two hosts started at different times can disagree until then. Outside this, and stated: a shell on the machine, links changed under a running host, and files written there before the collection stopped being command-writable |
| A command's input becomes the person's own by a mark | A mark is refused on a document whose collection is command-writable, and on one that is not its file on disk; a mark stops counting when its collection becomes command-writable (6.2). So an applied proposal cannot be marked while its collection is one. **Judged on the configuration now, as each host read it at its start** ([A2](#amendments-from-step-b1)): a file written while a collection was command-writable, and left after the allow was removed, passes; and a link changed under a running host changes nothing for that host until it restarts, so hosts started at different times can disagree about one mark. Both are the deployer's (section 3) |
| A document a command stored becomes the person's own when its collection is later named `own` | Prevented (after step B3's review, [A36](#amendments-from-step-b3), which replaces the gap A35 stated): a document of an own collection is the person's only while the host has held its current content to its file, a fact written only when section 3's rule 2 passed at its put, when a mark's fourth check passed, or when `store-documents-hold` found it equal to its file. A document stored with no file, or one that differs from its file, is never held, whatever the configuration becomes. What remains is section 3's: a file a command wrote while the collection was covered, left on disk, is a file |
| A person's mark is replayed onto other content | A mark names the content hash the person was shown and stops matching when the document changes (6.2) |
| A reader learns of records it may not read | The reader clause is in every statement; statistics, totals, candidates and the missing-vector check count only the reader's records (5.3, 8.2, 9.4). The suite's differential cases hold it (15.1) |
| A reader learns of a document it may not read, through a label | When the reader may not read the cited document, the label's source is `basis` alone: no id, hash, date, speaker, unit or rule (6.5). **One bit remains, and is accepted**: whether a record the reader can read is attested by a document it cannot. That bit moves when the unseen document is changed, deleted, marked or unmarked, and moves the record in and out of 6.6's filter and its totals. It says that some own document backs this wording now, and nothing of which. The alternative, reading such a record as unverified for that reader, would make standing differ by reader |
| Record text reaches the journal or the event log | The host's services write no text to the journal, to an event or into an error. Text-derived envelope fields are removed from the event of a lane writer, as for a memory writer (`middleware.rs:590`, with `GateEntry.lane_writer`). **A command's own input and result are journaled as its manifest declares** (D72): under `digest` no text, under `plain` as they are. The host makes a plugin that declares a kind state a mode on every command (section 2); choosing `digest` for each command that carries record text is the plugin's, and its specification must hold it to that |
| Stored text carries instructions | Scanned at put and flagged on every read (4.2, step 5). A net, not a guarantee (D75) |
| Record text leaves the machine | Only through the `http` provider, which the deployer configures by name and the doctor warns about every run (9.2). A put's text is sent only after the record was written, and a match's only after its query passed its checks (4.2, 9.4), so a refused call sends nothing |
| A model file is swapped | Files are pinned by SHA-256 and checked at start; a changed digest is a different model id, whose vectors are not served (9.2) |
| A lane is turned on by a report that no longer describes it | The host recomputes the rule from the report's counts and binds it to the declaration, the normalisation, the model, the weight and `k`; the doctor warns at four times the records (10) |
| A large query exhausts the host | 64 texts of 16 KiB, a 20 000-posting gather, 4 000 000 postings read a call, whoever may read them, with a refusal past it, a pool of 64, pages of 200, a stated bound of 100 000 records for the vector scan (11.1) |
| A rebuild blocks every writer | It runs in chunks of 1 000 records, only its own kind is offline while it runs, and between two chunks it leaves the write lock free for longer than a waiting writer sleeps between tries, so **a waiting writer gets a turn between chunks**. That is the guarantee; how long the wait is, step B6 measures (12.1) |
| Two rebuilds, or a rebuild and an undeclared put, leave a lane that is not its declaration's | A rebuild writes only while the kind's generation is the one it raised, read inside each chunk's transaction, and clears the stale mark only then (12.1) |
| An older host keeps writing a store a newer build migrated | Not prevented: the version check runs at open. Stated in 5.1, with what the operator does: stop older hosts before a newer build first opens the workspace, and rebuild if in doubt |
| The work cap tells a reader of hidden records | Past `STAT_POSTINGS` a call is refused whatever the reader may read, so a refusal says the kind is very large. It is the one place where records a reader cannot read change its answer, it changes an answer into a refusal and nothing else, and it is reached only past the design size (8.2) |
| One space reads another's records | Every table is in the space's own `store.sqlite3`; the services refuse a space outside the call's, as today |

What this does not defend: a compiled plugin that lies (it runs in the host), and a shell on the host's machine.
Both are D42's and D74's stated limits.

## 15. Conformance and tests

### 15.1 The suite (D170)

Three groups join `GROUPS` (`store/src/conformance/mod.rs:297`), after `records`. With phase 2's nine and
memory's nine that is 21. Phase 6's specification plans sixteen more; the two sets do not overlap.

| Group | File | Cases |
| --- | --- | --- |
| `lane` | `conformance/lane.rs` | A declared put writes its lane rows and an undeclared put writes none; `extract`'s refusals, each naming the pointer; a put is found by the next read on another handle; key filters, any-of within a key and all-of across keys; the three orders and their cursors, page by page to the end; totals under each order; ids ordered by bytes, with non-ASCII and case-differing ids; a text query's order against the fixture; `cut` only when the rarest term's postings pass the bound after every clause, and not when a key filter brings them under it; a kind with a changed declaration refuses every service and `reindex_records` clears it; **an undeclared `put_record` on a kind that has a declaration row makes it stale**; a rebuild stopped after a chunk leaves the kind stale and a second run finishes it; `put_record_vector` stores for the digest embedded and not for another; **differential**: every read repeated after records the reader cannot read are written, changed and reindexed is byte-identical |
| `standing` | `conformance/standing.rs` | A standing record reads `unverified`; wording is fixed and keys are not; affirm, withdraw, and both repeated; a decision's change row; attested by an own collection, by a mark, by both (`collection`), and by neither; the speaker must agree; a changed document lapses attestation and a second `put_declared_record` with evidence restores it; unmark lapses it; a mark on a document whose collection the view names command-writable does not count; a rebuild after a wording was changed while undeclared clears the affirmation and the evidence; **a document of an own collection attests only once the host held it to its file, and a former person's decisions and marks are set aside** (after step B3's review); `admit` narrows `read_record`, `find_records` and `match_records`, totals and statistics included; evidence naming an absent or unreadable document, or another hash, is refused; **for a reader who cannot read the cited document, the label's source is `basis` and nothing else**; **differential**: every read repeated after documents the reader cannot read, and that no record it reads cites, are written, changed, marked and deleted is byte-identical; and after the same is done to an unreadable document that a readable record cites, the only difference is that record's standing and `basis`, and its place in a filter or total |
| `matching` | `conformance/matching.rs` | The digest of each fixture text; `identical` under whitespace, case and width changes; the `words` score of every fixture pair to four places, in both orders of put; an empty lane; a text with no token; `exclude` leaves a record out of both lists and out of the statistics, so a stored text matched with itself excluded scores as if it were not stored; counts are the same whether one text or 64 are matched in a call; `LaneTooBroad` past `STAT_POSTINGS`, with the constant lowered for the case, reached by postings the reader cannot read as well as by ones it can, and at the same point however the counts are fetched; the pool and `k`; ties by id; with `MatchVectors`, `meaning` and `fused` to four places and the order by `fused` then id; `Incomplete` when one readable record lacks a vector, and `Served` when only an unreadable one does; **differential**, as for `lane`, on scores |

Fixtures are `store/fixtures/lane/records.json` (the records, each with its access set, the texts to match, and the
expected digests and scores, starting with section 8.1's and 8.2's) and `store/fixtures/lane/vectors.json` (a
four-dimension vector for each record and text). Every fixture text is invented and about gardening. The suite
never loads a model: it passes vectors in. A helper test, `store/tests/lane_fixture.rs`, recomputes every expected
score from `umbel_store::lane::score` and the tokenizer, so the fixture cannot drift from the formulas.

**Versions.** The store traits and the suite become version 3, and the workspace configuration version 6. Phase 6
names the same two numbers (section 1): the second to land renumbers. The PostgreSQL backend must implement the
eleven methods and pass the three groups; that is a [follow-up](#follow-ups), because phase 6's specification, which is
not edited here, was written before them.

### 15.2 Other tests

| File | Proves |
| --- | --- |
| `store/tests/lane_normalise.rs` | The five steps of 8.1, each alone and together; the pinned Unicode versions |
| `store/tests/lane_score.rs` | 8.2's formulas against hand-computed cases; that a text scores 1 against itself; rounding |
| `store-embedded/tests/lane_schema.rs` | A version 1 store, and a version 2 store with a declared kind's lane, each open as version 3 with their rows intact and no document held; every table and index of 5.1; a build constant for the schema version |
| `store-embedded/tests/lane_delete_bytes.rs` | After a `records` row is deleted and the log checkpointed, neither file holds the record's text, a term of it, a key value or its vector (the seam for erasure, 5.2) |
| `store-embedded/tests/conformance.rs` | The whole suite, the three groups included |
| `tests/manifest_v6.rs` | Section 2: every rule and its message; versions 1 to 5 refuse `records`; the schema file accepts and refuses the same manifests |
| `tests/config_v6.rs` | Section 3: every key, its default and its refusal; `own` refused on a command-writable collection: covered itself, covered through `<space>/*`, and **covered only through a collection of another space whose root is the same directory, contains it or lies inside it, as written and through a symbolic link**; versions 1 to 5 refuse the keys |
| `tests/records_put.rs` | 4.2, step by step: the access set and authority the host fills whatever the plugin sends; the scan's flags; the event of a writing command holds no text, and the journal entry of one declared `digest` holds none; a stub provider is called for a put that committed and has a match value, and is not called for a put refused for its wording, its evidence or its `expect`, nor for one that changed only keys |
| `tests/records_standing.rs` | 6.1's four checks: at a terminal with and without the confirmed mark, as `tests/require_human.rs` does it; another command's mark; a `Services::call` with no command; a caller who is not the space's person. 6.2's marks, each of its four checks: a document of a command-writable collection, and one written by `doc_put` with no file, are refused. A decision and a mark appear in `dev.umbel/changes`; a repeated one does not. A call's `verified_only` with each `verified_admits`, and a call that asks for a standing outside it gets less; a decision reaches an unverified record whatever a read would admit; no space key asks for every read. `record_get` on a standing kind is refused |
| `tests/records_person_page.rs` | With `umbel-testkit-idp`: a decision on the person page for a `mcp = "verified"` command affirms; the same mark with another input does not |
| `tests/records_own_source.rs` | Section 3, rule 2: a put that equals the file is stored, and held to it; one that differs is refused; a size that is not the length of the bytes is refused before a file is read; a collection that is not own is unchanged |
| `plugins/sources-filesystem/tests/own_collection.rs` | The real `sources-sync` against an own collection: add, unchanged, update and delete, with a byte order mark and CRLF line endings, each put as the file is on disk and each held to it |
| `store-embedded/tests/lane_standing_rows.rs` | On rows written by hand: a lane row's pointer is not standing unless the decision is an affirmation, of the row's wording, by the space's person |
| `tests/records_find.rs`, `tests/records_match.rs` | Sections 7 and 8 through the SDK, on a fixture plugin |
| `embed/tests/providers.rs` | Each provider behind its feature: the static provider on a small model built in the test; the HTTP provider against a local server, with its refusals; the ONNX provider only where a model file is given by an environment variable, skipped otherwise |
| `tests/records_meaning.rs` | 9.2's digest check and model id; an `http` URL to a name is refused and to `127.0.0.1` is not; a put writes a vector; a failed embed does not fail the put; a match with a bad query calls no provider; `store-records-reindex`, its chunks and its warning and failure for an unloaded model; 10's serving rule in each state, with a stub `Embedder`: a report bound to another declaration hash, normalisation, model, weight or `k`, and one whose `passed` is true and whose counts do not pass |
| `tests/records_eval.rs` | `store-records-eval` on a fixture: the report's counts, a leak counted, the rule on each side of each threshold (49 and 50 probes; two and three more hits at 50; three and four at 200), `self` left out of the statistics, a probes file that breaks each rule; the doctor's warning at four times the records |
| `tests/records_exit.rs`, `tests/records_scale.rs` | Step B6 |

## 16. Implementation plan

This is the Ideas plan's phase B (D171). Each step is one pull request with its tests. "The Umbel gate" is the
command list in `AGENTS.md` for a change under `endpoints/umbel/`.

| Step | Deliverable | Exit |
| --- | --- | --- |
| B1. Shapes | Manifest version 6 and its schema (section 2); configuration version 6 and its schema (section 3, parsing and validation only); `store/src/lane.rs` with `extract`, `normalise` and `score`, and `store/src/embed.rs` (11.1); the two new dependencies of `umbel-store`, with the `wasm32-wasip2` build checked; the SDK's types and method signatures answering `not_granted` (11.2); the version constants; `workspace-show`'s versions | The Umbel gate; `manifest_v6.rs`, `config_v6.rs`, `lane_normalise.rs`, `lane_score.rs`, `lane_fixture.rs` |
| B2. The lane and finding | Schema version 2 (5.1); `put_declared_record` without evidence; `put_record`'s stale mark; `read_record`, `find_records`; `lane_status`, `reindex_records` in chunks, without vectors; the host's put path (4.2 except steps 6 and 8), `record_read` and `record_find`; `store-records-reindex`; the doctor's `records.declared` and `records.size`; the suite's `lane` group | The Umbel gate; `lane_schema.rs`, `lane_delete_bytes.rs`, `records_put.rs`, `records_find.rs`; the suite passes |
| B3. Standing | The space's `person` and `verified_admits`, and the call's `verified_only`; `gate_proof` and `CallServices.person_gate`; `decide_record`; command-writable collections across spaces, the own-collection rules and the mark's four checks; `mark_document_own`, `unmark_document_own`, `document_own`; evidence and `record_put_cited`; the label; the authority the host fills; `record_get` and `record_list` refused on a standing kind; the doctor's `records.standing`; the suite's `standing` group | The Umbel gate; `records_standing.rs`, `records_person_page.rs`, `records_own_source.rs` |
| B4. Matching by words | `match_records` without vectors; `record_match`; the suite's `matching` group, words only | The Umbel gate; `records_match.rs`; the suite's expected scores hold to four places |
| B5. Meaning and its gate | The `umbel-embed` crate and its three providers; the host features; `[models]` and `[spaces.<id>.meaning]` acted on; `put_record_vector` and vectors after a put's write; the exact scan and `fused`; `store-records-reindex`'s vectors; `store-records-eval` and its two schemas; the serving rule; the doctor's `records.meaning`; the rest of `matching` | The Umbel gate, and once with each `embed-*` feature; `providers.rs`, `records_meaning.rs`, `records_eval.rs`. The [trajectory refresh](#trajectory-refresh)'s unchecked rows for the three crates are checked, and recorded as amendments here |
| B6. Exit | A fixture plugin, compiled, declared in `tests/records_exit.rs`: a standing kind `note` with a statement, two keys and a match field. One run through all of it over MCP and at the CLI: put, find by key and by text, match two captures in a row, cite a document of an own collection and read attested, change the document and read unverified, affirm at a terminal, read with a call's `verified_only` under each `verified_admits`, reindex after a declaration change and after an undeclared edit, and the stub model's gate both ways. `tests/records_scale.rs`, ignored by default and run in release, at 10 000 and at 100 000 records, words alone and with 256-dimension vectors: a put; a find by key and by text; a match of 1 text and of 64, with the once-a-call part, the counts, the gather and both directions timed apart, for a reader of everything and for a reader who may read 1% of the kind (8.2); the vector scan; and a rebuild, with its longest chunk. The times are printed with no threshold and recorded in STATUS.md, on macOS and in CI, beside the review's estimates of 1.0 s and 8 s. Outside the repository, on the phase 0 corpus: `store-records-eval` over phase 0's labelled pairs as probes, with the counts recorded in the Ideas status, to show what the lane's tokenizer did to phase 0's rates | The Umbel gate; the exit test passes; the timings and the phase 0 counts are recorded; this document's Status block, STATUS.md and the Ideas status say so |

B2 needs B1. B3 and B4 each need B2 and can run side by side. B5 needs B4. B6 needs all.

The Ideas plan says phase B is done "when the suite passes and the labelled pairs of phase 0.2 meet measure 1".
Phase 0 changed measure 1 from refusing to offering, and its rates are not fixed until the owner has checked the
labels (Ideas status, Q5). So B6 records the rates and does not gate on a number.

## 17. Out of scope, with seams (D171)

| Not here | Where | The seam this leaves |
| --- | --- | --- |
| Erasing a record | The plan's P16 | One `DELETE` on `records` removes every lane row by cascade, overwritten under `secure_delete` (5.2); `lane_delete_bytes.rs` proves it. P16 adds the delete itself, the keyed digest and what becomes of `record_decisions` |
| Uploads | P17 | 6.2: an upload never inherits `own`; it becomes the person's by a mark, which exists here. That specification replaces the mark's fourth check, "equals its file on disk", for a document it stored itself, and keeps the third |
| A review on the person page, in pages | P15 | `record_decide` and `doc_own_mark` take whatever proof the person gate accepted. A longer or paged decision changes the gate and the relay, not these services |
| Guidance from a plugin | P18 | Nothing |
| The graph | P4 | D157 leaves the graph to that change. The lane writes no node or edge |
| Sharing a standing record | Later | `default_access` gives `space`. Narrower sharing, and whose decision counts where several people share a space, wait for D157's open point |
| The PostgreSQL backend | Phase 6, after this | The eleven methods and three groups are a follow-up there. Scoring, normalisation and extraction are in `umbel-store` so that it computes the same numbers; terms would be found by lookup value, as phase 6 plans for memory |
| Components | WIT world 1.1.0 | A component cannot declare a kind (D159). Whether one ever may is that world's question, and D162's reason stands against it |
| Knowledge search by meaning | O4, still open | `VectorIndex` stays reserved. `umbel-embed`'s providers are reusable as they are |
| A vector index | When B6's timings ask for one | `record_vectors` is keyed by model; an index would sit beside it |

## 18. For the owner

**The owner has not read this specification.** It was written under his direction of 2026-11-11 that the Ideas plan
carry on through its phases on its recommendations. Each choice below is one he could reasonably want otherwise,
with what the other way would cost. Those marked "differs from the plan" are where this document did not follow the
plan's outline for step A2, because of what the code holds.

| # | Chosen here | The alternative, and its cost |
| --- | --- | --- |
| 1 | **The host core does not itself check "word for word".** The compiled plugin's code does, and records what it compared (D162). Refines D157, which gives that check to the host | The host divides documents into sentences and compares. That puts a text rule in the host, against principle 1, and fixes one rule for every plugin. Cost of the choice made: attested is as right as the plugin's rule, and a plugin's fault is found by replay, not prevented |
| 2 | **A new wording is a new record** (D160) | Versions inside one record, with the host tracking which is held. More host state, and a way for an affirmation to drift onto words the person did not see |
| 3 | **Attested lapses when the cited document changes**, until the plugin cites the new content (6.3) | Keep attested for content the host once stored. The host would have to keep every earlier version's hash, and a sentence the person later deleted would stay attested |
| 4 | **An own collection, and any collection sharing its directory in any space, takes no knowledge proposal and no verification write**, and a document put there must equal its file (section 3). Differs from the plan | Trust the configuration alone. Then a proposal an agent drafted and a person approved into that directory would read as the person's own words |
| 5 | **A person can mark as theirs only a document that did not reach the host as a command's input**: one in a collection no command writes files into, that is the file on disk (6.2). Refines D157, which speaks of uploads only. Differs from the plan, which let any document be marked | Any readable document. Then a person could, in one decision, turn an agent-drafted, applied proposal into "their own words", and every record citing it word for word would read as attested. Cost of the choice made: a person who did write a page that went in by proposal cannot mark it; they affirm the records instead |
| 6 | **A space has one configured `person`**, and only that person's decisions give standing (section 3, 6.1). Differs from the plan, which had no key for D157's "the one person a space is configured for" | Any person who passes the gate and can read the record. In a space with two readers, either could affirm the other's record |
| 7 | **The deployment sets what verified means; a consumer that wants verified content asks, call by call. No setting hides unverified records from every read** (`verified_admits`, a call's `verified_only`, 6.6). Refines D157's "by a deployment's setting or by a call" | A space-wide switch, as D157's words allow. Then no review could list what waits for the person and nothing in that space could ever be affirmed; the revision before this one had one, and the focused pass found exactly that. Cost of the choice made: a deployer who wants one consumer held to verified content configures that consumer, not the space. And `verified_admits` defaults to affirmed alone: attested rests on the plugin's rule (row 1), so admitting it as verified is the deployer's to choose |
| 8 | **A reader who cannot read a cited document still sees that the record is attested**, and nothing of the document (6.5, section 14) | Read such a record as unverified for that reader. No bit about the unseen document would remain, and one record would have two standings |
| 9 | **The lane is a term table, not FTS5** (D163). Differs from the plan | FTS5 as memory uses it. The both-directions score would re-tokenise every match and refuse past 50 000, the PostgreSQL backend would need a second design, and phrase search would come free. Phrase search is what is given up |
| 10 | **The lane's tokenizer is the store's, not phase 0's; its `idf` is phase 0's, not memory's** (8.2). Differs from the plan in each half | Snowball's stemmer, as phase 0 used: a second tokenizer in the store, with no reference to hold it to. FTS5's `idf`: near-zero weights in small stores. Cost of the choice made: phase 0's rates must be measured again, in B6 |
| 11 | **The host returns scores and never a verdict** (D165) | Thresholds in the host. Phase 0 found none that refuses safely across documents, and each plugin's bands differ |
| 12 | **A match that would read more than four million postings is refused, whoever may read them** (8.2) | No cap: past the design size a call could run for minutes. Or a cap on the reader's own share: a reader of 1% of a huge kind would never be refused and would still pay for all of it. Or a lower cap: ordinary 64-text calls on a large store would be refused. Cost of the choice made: past the design size, a refusal tells a reader the kind is very large |
| 13 | **No model by default; three providers; the HTTP one sends text off the machine** (D166) | Ship one model in the binary: a larger binary, a model licence in the repository, and a default nobody measured on their own records. Or no HTTP provider: a deployer with a model server could not use it |
| 14 | **An embedding in the request path is within principle 4** (D168) | Words only, always. In phase 0, across documents, words alone found the duplicate within five for 0.886 of 35 probes, and fused for between 0.914 and 0.971 |
| 15 | **The gate: at least 50 probes with a duplicate, at least max(3, 2%) more of them found within `k`, no leak, and a report bound to the lane it measured** (D167) | A lower bar turns lanes on by noise: phase 0's static model, one probe better of 35, would have passed a bar of rates. A higher one asks more labelling of each instance |
| 16 | **A failed embedding never fails a capture**; the record waits for `store-records-reindex`, and matching falls back to words for that reader (4.2, 9.4). Differs from the plan, which had vectors always present after a put | Fail the put. A model server that is down would then stop capture |
| 17 | **The host holds no date of writing for a document, so the attested label carries the two dates it does hold, each named for what it is**: `storedAt`, when the host stored that content, and `generatedAt`, what the file says of itself. A plugin that knows a better date shows its own beside them (6.5). Differs from the plan and from D157's wording, "the person wrote it then" | Call the stored date the date of writing: for an archive synced in one day, every idea would be dated that day. Or keep the file's modification time on the document: it needs a document record version 2, and a clone or a copy resets it anyway |
| 18 | **Records are private to the writer's principal, by the host, with `space` as the only other choice** (4.2) | The plugin chooses the access set, as for undeclared kinds today. Then "private by default" would be the plugin's promise |
| 19 | **`record_get` and `record_list` are refused on a standing kind** (6.5). Differs from the plan | Change what they return. That breaks every plugin that calls them today. Or leave them: an unlabelled read of a standing record would exist |
| 20 | **Vectors are searched by exact scan, with a bound of 100 000 a kind** (9.4) | An approximate index now: a dependency and a recall loss nobody has measured, for a size the first instance is a thirtieth of |
| 21 | **A kind being rebuilt is offline until the rebuild ends**, and the rest of the store is not (12.1) | One transaction for the whole kind: the kind stays readable, and every writer to the space waits about eight seconds at 100 000 records |
| 22 | **A plugin's host specifications sit beside its own** (D158) | Under `phases/`. These changes belong to no phase |
| 23 | **Two version numbers are shared with phase 6's proposal**, and the second to land renumbers (D170). The plan named only the traits version | Take 4 and 7 now. Phase 6 is approved and not started, so either order is possible |

Rows 24 to 28 were added after step B3 and its independent review (2026-11-12). Like every row here they are
decided under the owner's direction and are open to him.

| # | Chosen here | The alternative, and its cost |
| --- | --- | --- |
| 24 | **At a terminal, an agent variable withholds the proof a standing decision is written under**: the proof asks for the CLI's human-present mark as well as the answered `require-human` prompt, so standing is as strict as memory's `person` (6.1, section 14) | The plugin gate's check alone, as this document first had it: a process with a terminal and an agent variable would affirm. What remains either way is a process that unsets the variable and holds a pseudo-terminal (D74, D86). The answer where that matters is `person = { cli = "verified" }` on the plugin's review command, at the cost of a login for each decision |
| 25 | **Changing a space's person sets the former person's decisions and marks aside** (section 6): they stay stored and are not read, and the new person decides again | Keep them counting: a deployer who changes `person` because the former one should no longer decide would keep everything they affirmed. Or delete them at the change: the host does not know when the configuration changed, and naming the former person again could not restore them. Cost of the choice made: a person who is renamed (another principal string, with no `[principal.equivalents]` entry mapping the old to the new) must affirm again |
| 26 | **A kind's `standing` setting alone costs no standing** ([A25](#amendments-from-step-b3)): declared with standing, then without, then with it again over the same text pointers, a record whose wording never moved reads affirmed again. **This reverses what section 2 first said**, on the ground that it is D160's own wording and that every way a wording can move clears what stood on it | The rebuild clears every affirmation and evidence row of a kind whose stored `standing` differs from the declaration's, as section 2 first said. A deployer who turns standing off is then read as taking back what was affirmed, which is simpler to state. Its cost: a plugin version that drops `standing` by mistake, or for one release, destroys every affirmation of the kind, which a person must then make again one by one, and which the doctor could only warn of before the rebuild |
| 27 | **A document of an own collection is the person's only once the host has held it to its file**, and an operator runs `store-documents-hold` for a collection that already holds documents ([A36](#amendments-from-step-b3)) | Trust the configuration: every stored document of an own collection is the person's. Then a document a command stored with no file, before the collection was named own, would attest an agent's records by the configuration change alone, which the review of step B3 reproduced. Cost of the choice made: one command to run after naming a collection own, and after upgrading a store, which the doctor names |
| 28 | **Who affirmed a record is shown to the operator and to the space's person only** (6.5) | Show `by` and the whole assurance to every reader of the record, as this document first had it: a reader of one affirmed record would learn who the space's person is, and for a verified decision their identity namespace and when they logged in. Cost of the choice made: a second reader of a shared space cannot tell from a label whose affirmation it is; there is one person a space, so there is one answer |

**What this refines in D157.** D157's rules stand, and three of them are made narrower or more exact here, each
recorded in D161 or D162:

- *The host's own check.* D157 has the host find that a wording is whole sentences of the source. Here the host
  core establishes everything about the source, and the compiled plugin's code compares the words (row 1, D162).
- *The person's say-so.* D157 lets a person say an uploaded source is theirs. Here a person may say so of any
  source that did not reach the host as a command's input: today a synced document in a collection nobody named as
  theirs, later an upload; not a document a command's input produced, as far as the configuration now tells the
  host (row 5, D162).
- *Verified content only.* D157 names a deployment's setting and a call. Here the deployment sets what verified
  means, `verified_admits`, and a consumer asks per call, `verified_only`; there is no space-wide switch, because a
  store that hid unverified records from every reader could not be reviewed (row 7, D161).

And two places where D157's wording met something the host does not have: a configured person for a space (row 6),
and a date of writing for a source (row 17).

## Follow-ups

| Date | Raised by | Follow-up | Where it goes |
| --- | --- | --- | --- |
| 2026-11-11 | This specification | The PostgreSQL backend implements `DocumentStore`'s eleven new methods and passes the `lane`, `standing` and `matching` groups, with terms and key values found by lookup value and text sealed, as phase 6 plans for memory. Phase 6's specification predates them and is not edited here | The phase 6 owning agent, as an amendment to its specification before its step that certifies PostgreSQL |
| 2026-11-11 | This specification | Store traits version 3 and workspace configuration version 6 are named by this document and by phase 6's. The second to land renumbers | Whichever of step B1 and phase 6's step 1 merges second. Step B1 (2026-11-11) takes both numbers in its pull request; `main` at `e5de4194` holds neither from phase 6, so once that pull request merges it is phase 6 that renumbers |
| 2026-11-11 | This specification | The lane's tokenizer is not phase 0's. Phase 0's labelled pairs are scored again through `store-records-eval` | Step B6; the counts go in the Ideas status |
| 2026-11-11 | This specification | The trajectory refresh's unchecked rows: the three provider crates' builds, sizes and licences, `model2vec-rs` against the Python library's vectors, the two Unicode crates on `wasm32-wasip2` | Steps B1 and B5, each recorded as an amendment here. B1's part, the two Unicode crates, is done ([A11](#amendments-from-step-b1)); the three provider crates stay with B5 |
| 2026-11-11 | This specification | A plugin must pass the label through unchanged and affirm only what its preview showed (6.1, 6.5). Nothing in the host enforces either | The plugin's specification (the plan's step A3) and its review |
| 2026-11-11 | This specification | The plugin's rule for "whole units, word for word" has no replay command. One that re-runs each record's evidence against the stored document and reports disagreements would make D162's "can be replayed" a check | The plugin's specification (step A3) |
| 2026-11-11 | This specification | A gate report does not expire. A lane measured at 3 000 records is still served at 60 000 | Taken in the revision after the independent review: the report is bound to the lane it measured, and the doctor warns when the kind holds more than four times the records it held at the eval (10) |
| 2026-11-11 | This specification | The vector scan reads every admitted vector for each call. A cache keyed by the store's head revision, or an index, if B6's timings ask | After B6 |
| 2026-11-11 | This specification | This document has had no independent review | Done 2026-11-11: one reviewer, verdict "approve after the blockers", four blockers and nine improvements, all taken; then a focused pass on that revision, one blocker and six improvements, all taken ([Review response](#review-response)) |
| 2026-11-11 | Independent review | The costs it measured on section 5.1's tables at 100 000 records (about 1.0 s for the counts of 64 pooled records, about 8 s for a rebuild in one transaction) are estimates on another machine and another build | Step B6 records the real times of each part (8.2, 12.1) |
| 2026-11-11 | Independent review | One bit about a document a reader cannot read remains in a record's standing (section 14). It is accepted here | The owner, section 18, row 8 |
| 2026-11-12 | Step B2, narrowed after its review | Section [2](#2-declaration-d159) says that changing a declared kind's `standing` costs every standing the kind holds, and section [12.3](#123-doctor-checks) has the doctor say the rebuild will remove it. Section [12.1](#121-store-records-reindex)'s rebuild clears a record only when its wording hash is not the one its lane row held. **Closed by the review of step B2 (R10)**: a wording that changed, by a put or by an edit while the kind was undeclared, loses its standing whatever the kind is declared as when the rebuild runs. **Still open**: a kind whose `standing` changes and whose wording does not. Declared with standing, then without, then with it again over the same text pointers, a record keeps its affirmation and its evidence through both rebuilds, and reads as affirmed again; section 2 and the doctor's message say it would not. Either the rebuild also clears every standing of a kind whose stored `standing` differs from the declaration's, or section 2 and 12.3 say that only a changed wording costs standing | **Closed in step B3** ([A25](#amendments-from-step-b3)): only a changed wording costs standing, and sections 2 and 12.3 say so |
| 2026-11-12 | Step B2 | The suite lowers the lane's bounds through a function the backend supplies (`Stores.lane`, [A14](#amendments-from-step-b2)), and skips the `lane` group for a backend that supplies none. The store's in-memory fake supplies none, so the suite's lane cases are held to one implementation | The phase 6 owning agent, with the follow-up above on the eleven methods: the PostgreSQL backend supplies one. Whether the fake should gain a lane, as a second implementation the cases are checked against, is open |
| 2026-11-12 | Step B2's focused review | The doctor warns that a rebuild will remove affirmations only for a manifest that declares standing (`src/commands/store_records.rs`, section [12.3](#123-doctor-checks)). Since the review's third finding the rebuild also removes them under a declaration without standing whose `text` changed, and says nothing first | **Done in step B3** ([A26](#amendments-from-step-b3)): the doctor says it whatever the declaration |
| 2026-11-12 | Step B2's focused review | The rebuild deletes a record's vectors on any change of wording, even when the value at `match` did not move, so adding a `text` pointer to a kind would drop and re-embed every vector | Step B5: delete on a moved match digest only |
| 2026-11-12 | Step B2's focused review | The pause between chunks adds 120 ms for each 1 000 records, about 12 s offline for a kind of 100 000 | Step B6 records it with the other timings |
| 2026-11-12 | Step B3 | Step B3 has had no independent review. It is the step whose purpose is that nothing an agent's call claims or passes gives a record standing | **Done 2026-11-12**: an independent security review, two blockers and six improvements, all taken (the table after the step B3 amendments, R17 to R24) |
| 2026-11-12 | Step B3 | A document stored before its collection was named `own` was never held to its file, and reads as the person's own by collection ([A35](#amendments-from-step-b3)). A doctor check that compares the stored documents of each own collection with their files would turn the deployer's statement into a check | **Closed after the step's review** ([A36](#amendments-from-step-b3)): the review reproduced it as an attack. A document of an own collection now counts only once the host held it to its file; `store-documents-hold` is the comparison this row asked for, and `records.own` counts what it has not reached |
| 2026-11-12 | Step B3 | Section [6.5](#65-the-label)'s label names the person who affirmed a record (`affirmed.by`) to every reader of that record, while section [12.4](#124-workspace-show-and-plugin-show) has `workspace-show` say only whether a space has a person, not who, to a caller who is not the operator. Step B3 implements 6.5 as written | **Closed after the step's review** ([A39](#amendments-from-step-b3)): `by` and the assurance beyond its level are shown to the operator and the person only. Section 18, row 28 |
| 2026-11-12 | Step B3 | The `standing` group holds `admit` on `read_record` and `find_records`, statistics included. Section [15.1](#151-the-suite-d170) also asks it of `match_records` | Step B4, with the method: the same clause (`and_admitted`) and the same labels, and the host withholds who affirmed a hit from its label as it does from a read's ([A39](#amendments-from-step-b3)) |
| 2026-11-12 | Step B3 | **At a terminal, an agent variable does not withhold the proof.** Section 6.1 makes the terminal's proof the plugin gate's own check: the mark the CLI sets once a `require-human` prompt is answered. Memory asks more for its `person` (D86): the CLI's human-present mark as well, which it withholds when an agent variable is set (`CLAUDECODE`, `AI_AGENT`, the workspace's `principal.agent_env`), so `memory-confirm` is refused there (`tests/cli_authority_prompt.rs`). `record_decide` and `doc_own_mark` are not: a process that has a terminal, answers the prompt and carries an agent variable affirms, with the assurance `terminal`. Step B3 implements section 6.1 as written and pins it in `tests/records_standing.rs`. An agent's ordinary call has no terminal and is refused. The assurance `terminal` also names a command and not an input, and is "not an attestation" (`src/authority.rs`) | **Ruled after the step's review** ([A37](#amendments-from-step-b3)): `gate_proof`'s terminal row asks for the human-present mark, and the test pins the refusal. What remains, an agent that unsets the variable and holds a pseudo-terminal, is in section 14; the plugin's specification (step A3) still chooses whether its review command is `person = { cli = "verified" }`. Section 18, row 24 |
| 2026-11-12 | Step B3's focused review | No test pins that a person's identities are the configured `person` and the principal `[principal.equivalents]` maps it to, and no other. It was checked by reading: the write check, the read clause and the decider check share one list | Step B4 or B6: add the test |
| 2026-11-12 | Step B3's focused review | A decision recorded under a legacy principal lapses if `person` is later changed to its namespaced target. It fails closed. Section [3](#3-configuration) should tell a deployer to keep `person` as the legacy string once decisions exist under it | The next change to this document |
| 2026-11-12 | Step B3's focused review | In mode `none`, `store-documents-hold` runs with `--yes`, with no terminal and with an agent variable set. It holds only documents equal to their files, so it grants nothing a re-sync would not. Requiring a present human there is optional hardening | The owner |
