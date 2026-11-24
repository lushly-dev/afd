# Umbel status archive: phases 0 and 1

Moved verbatim from [STATUS.md](STATUS.md) on 2026-11-23 ([#1803](https://github.com/lushly-dev/afd/issues/1803)), which is the index and the
current record. A line here keeps the wording it had when it was moved and is not updated after:
a status recorded here may have changed since, though the detail of a phase still open (its
decisions, what its exit has not proven) still applies unless the index or the phase's
specification says otherwise. A link to `#heading` in a moved line named a heading of STATUS.md as
it stood then; the heading is in this file or, through "Headings in other files" at the end, in
another archive file, which the index lists under [Archive](STATUS.md#archive). A moved line is
never edited; a change of status goes in the index.

## Phases rows as they stood on 2026-11-23

The index shortened these rows, pointed their links at the archive files or, after the audit of 2026-11-23, replaced a stale clause; here is each as it was.

| Phase | State | Owner | Evidence | Next gate |
| --- | --- | --- | --- | --- |
| AFD prerequisites | Done for phase 0, including step 0 of the phase 0 plan (2026-10-31); the rows for phases 1 to 5 remain | Owner's sessions; step 0 by the phase 0 owning agent | [#523](https://github.com/lushly-dev/afd/pull/523), [#526](https://github.com/lushly-dev/afd/pull/526), [#539](https://github.com/lushly-dev/afd/pull/539), [#538](https://github.com/lushly-dev/afd/pull/538), [#555](https://github.com/lushly-dev/afd/pull/555), [#556](https://github.com/lushly-dev/afd/pull/556) and [#560](https://github.com/lushly-dev/afd/pull/560) and step 0, [#567](https://github.com/lushly-dev/afd/pull/567), merged | Later phases' rows of the prerequisites table, each before the phase that needs it |
| 2. Knowledge | Specification approved and merged ([#625](https://github.com/lushly-dev/afd/pull/625), `e996aad1`); steps 0a and 0b done 2026-11-01; step 1 (shapes and configuration) done 2026-11-01 in [632](https://github.com/lushly-dev/afd/pull/632); step 2 (store traits and the SQLite stores) done 2026-11-01 in [636](https://github.com/lushly-dev/afd/pull/636); step 3 (the tantivy index) done 2026-11-01 in [643](https://github.com/lushly-dev/afd/pull/643); step 4 (host services) done 2026-11-01 in [651](https://github.com/lushly-dev/afd/pull/651); step 5 (`umbel-scan`, `umbel-okf` and the `sources` plugin) done 2026-11-01 in [668](https://github.com/lushly-dev/afd/pull/668); step 6 (the knowledge core) done 2026-11-01 in [671](https://github.com/lushly-dev/afd/pull/671); step 7a part 1 (the three host services: the true head under derivation reads, the graph's applied revision, the checkpoint) done 2026-11-01 in [672](https://github.com/lushly-dev/afd/pull/672); step 7a part 2 (the structural graph: graph building in `knowledge-index`, rank expansion, `knowledge-neighbors`, `-related`, `-path`, `-outline`, `-stale`) done 2026-11-01 in the step 7a graph pull request; step 8 (proposals and verification) done 2026-11-01 in [673](https://github.com/lushly-dev/afd/pull/673); step 7b (code symbols) done 2026-11-01 in the step 7b pull request; step 9 (the eval harness: the seeded fixture, `knowledge-eval`, the gate and its baseline) done 2026-11-01 in the step 9 pull request; step 10 (the exit: `plugins/knowledge/tests/exit_thousand.rs` and the exit criterion re-run) done 2026-11-01 in the step 10 pull request. **Done 2026-11-01: exit criterion met**; `knowledge-approve` still needs a dynamic confirmation prompt before real use (follow-ups) | Phase 2 owning agent | [Specification](phases/2-knowledge/spec.md) ([#625](https://github.com/lushly-dev/afd/pull/625)); step 0a: the [AFD proposal](../../../docs/features/active/output-budgets/output-budgets.proposal.md) and [`spec/output-budgets.md`](../../../spec/output-budgets.md); step 0b: [#633](https://github.com/lushly-dev/afd/pull/633), the Rust output budgets and the public frontmatter reader; step 1: [632](https://github.com/lushly-dev/afd/pull/632); step 2: [636](https://github.com/lushly-dev/afd/pull/636); step 3: [643](https://github.com/lushly-dev/afd/pull/643); step 4: [651](https://github.com/lushly-dev/afd/pull/651); step 5: [668](https://github.com/lushly-dev/afd/pull/668); step 6: [671](https://github.com/lushly-dev/afd/pull/671); step 7a: [672](https://github.com/lushly-dev/afd/pull/672), the step 7a graph pull request; step 8: [673](https://github.com/lushly-dev/afd/pull/673); step 7b: the step 7b pull request; step 9: the step 9 pull request; step 10: the step 10 pull request | None for phase 2. Phases 3, 5 and 6 are unblocked |
| 3. Memory and context | Specification approved and merged ([#685](https://github.com/lushly-dev/afd/pull/685), `e4c91f30`, with D86 to D89 written in after it); step 1 (shapes and configuration) done 2026-11-02 in [#729](https://github.com/lushly-dev/afd/pull/729), `ed9a8539`; step 2 (the memory trait and suite) done 2026-11-03 in [#733](https://github.com/lushly-dev/afd/pull/733), `b84e0bd5`; step 3a (the embedded memory store) done 2026-11-03 in [#736](https://github.com/lushly-dev/afd/pull/736), `b970994e`; step 3b (sealing and the key file) done 2026-11-03 in [#737](https://github.com/lushly-dev/afd/pull/737), `8d51ee13`; step 4 (host services and the journal digest) done 2026-11-03 in [#740](https://github.com/lushly-dev/afd/pull/740), `d945bbbf`; step 5 (the memory plugin's writing side) done 2026-11-03 in [#742](https://github.com/lushly-dev/afd/pull/742), `0e3a501a`; step 6 (the memory plugin's reading and lifecycle commands) done 2026-11-03 in [#743](https://github.com/lushly-dev/afd/pull/743), `800856ad`; step 7a (the shared helpers: the locator string and `is_stale` in `umbel-okf`) done 2026-11-03 in [#744](https://github.com/lushly-dev/afd/pull/744), `8f124810`; step 7b (the `context` plugin) done 2026-11-03 in [#745](https://github.com/lushly-dev/afd/pull/745), `c8689ebc`; step 8 (the `umbel-first-party` binary and the `umbel-hook` harness adapter) done 2026-11-03 in [#746](https://github.com/lushly-dev/afd/pull/746), `ab5b321d`; step 9 (import and export) done 2026-11-03 in [#747](https://github.com/lushly-dev/afd/pull/747), `4e46de1b`; step 10 (the exit: `leak_probes.rs`, `poisoning.rs`, `forget_bytes.rs` and `exit_memory.rs` in `first-party/tests`) done 2026-11-03 in the step 10 pull request. **Done 2026-11-03: exit criterion met** (see Phase 3 below) | Phase 3 owning agent | [Specification](phases/3-memory-context/spec.md), [#685](https://github.com/lushly-dev/afd/pull/685); step 1: [#729](https://github.com/lushly-dev/afd/pull/729); step 2: [#733](https://github.com/lushly-dev/afd/pull/733); step 3a: [#736](https://github.com/lushly-dev/afd/pull/736); step 3b: [#737](https://github.com/lushly-dev/afd/pull/737); step 4: [#740](https://github.com/lushly-dev/afd/pull/740); step 5: [#742](https://github.com/lushly-dev/afd/pull/742); step 6: [#743](https://github.com/lushly-dev/afd/pull/743); step 7a: [#744](https://github.com/lushly-dev/afd/pull/744); step 7b: [#745](https://github.com/lushly-dev/afd/pull/745); step 8: [#746](https://github.com/lushly-dev/afd/pull/746); step 9: [#747](https://github.com/lushly-dev/afd/pull/747); step 10: the step 10 pull request | None for phase 3. Phase 4 is unblocked |
| 4. Curator | Specification approved 2026-11-03 ([spec](phases/4-curator/spec.md)), under the owner's 2026-10-31 delegation, with the owner's answers of 2026-11-03, merged in [#749](https://github.com/lushly-dev/afd/pull/749), `4a9462c0`; step 1 (shapes) done 2026-11-03 in [#751](https://github.com/lushly-dev/afd/pull/751), `e7aeff70`; step 2 (host) done 2026-11-03 in [#753](https://github.com/lushly-dev/afd/pull/753), `83639abb`; step 3a (knowledge: record and journal) done 2026-11-03 in [#754](https://github.com/lushly-dev/afd/pull/754), `37af26c9`; step 3b (knowledge: the drafted path) done 2026-11-03 in [#763](https://github.com/lushly-dev/afd/pull/763), `4a6b2de4`; step 3c (knowledge: verifying drafts) done 2026-11-03 in [#765](https://github.com/lushly-dev/afd/pull/765), `7e52e337`; step 4 (curator: candidates) done 2026-11-03 in [#767](https://github.com/lushly-dev/afd/pull/767), `0d46a9a0`; step 5 (curator: runs) done 2026-11-03 in [#768](https://github.com/lushly-dev/afd/pull/768), `9ea18e73`; step 6 (auto-approval) done 2026-11-03 in [#770](https://github.com/lushly-dev/afd/pull/770), `6e1c0a0a`; step 7 (the binary and the exit: `umbel-first-party` links the curator, `curator_leaks.rs` and `exit_curator.rs` in `first-party/tests`) done 2026-11-03 in the step 7 pull request. **Done 2026-11-03: exit criterion met** (see Phase 4 below) | Phase 4 owning agent | [Specification](phases/4-curator/spec.md), [#749](https://github.com/lushly-dev/afd/pull/749); step 1: [#751](https://github.com/lushly-dev/afd/pull/751); step 2: [#753](https://github.com/lushly-dev/afd/pull/753); step 3a: [#754](https://github.com/lushly-dev/afd/pull/754); step 3b: [#763](https://github.com/lushly-dev/afd/pull/763); step 3c: [#765](https://github.com/lushly-dev/afd/pull/765); step 4: [#767](https://github.com/lushly-dev/afd/pull/767); step 5: [#768](https://github.com/lushly-dev/afd/pull/768); step 6: [#770](https://github.com/lushly-dev/afd/pull/770); step 7: the step 7 pull request | None for phase 4. Phase 7 now needs phases 5 and 6 |

## Phase detail

### Phase 0. Host skeleton

- **State:** done 2026-11-01; the exit criterion is met. Specification
  approved 2026-10-31 under the owner's delegation (D24). Last verified
  2026-11-01 against `main` at `8001fc74`.
- **Done:** the [specification](phases/0-host-skeleton/spec.md), merged in
  [#564](https://github.com/lushly-dev/afd/pull/564) as `fb35d525`, with
  decisions D28 to D36 and the architecture amendments they need (embedded
  storage moved to phase 2, versioned shapes under
  `endpoints/umbel/schemas/`, four glossary terms). It was revised the same
  day after an independent review returned "approve after must-fixes", with
  the coordinator's decisions recorded as amendments: several host processes
  per workspace under one append lock (D29), a bearer token on loopback HTTP
  (D32), no interim telemetry (D33 dropped), `DirectClient` interface
  selection in AFD instead of a host check (D34), and multi-process support
  as a phase 2 store criterion (D28).
- **Done:** step 0, the AFD pull request
  ([#567](https://github.com/lushly-dev/afd/pull/567), `045b6feb`): see the
  AFD prerequisites detail above.
- **Done:** step 1, the scaffold ([#570](https://github.com/lushly-dev/afd/pull/570),
  `273e0160`): the `umbel` package with a binary that prints `--version`, its
  committed `Cargo.lock`, toolchain and clippy configuration, `umbel.yml`, the
  quarantined release unit with no route, the explicit `architecture.json`
  unit, the repository-contract test, the `.gitignore` negation and the
  `AGENTS.md` rows. `umbel.yml` ran green on Linux, macOS and the MSRV leg.
- **Done:** step 2, the workspace ([#572](https://github.com/lushly-dev/afd/pull/572)):
  `workspace::discover`, `umbel.toml` version 1 with defaults and validation,
  the layout and `Workspace::init`, race-safe keys (temporary file, hard link,
  mode 0600), the workspace lock over AFD's `JournalFileLock` with the
  `WORKSPACE_LOCK_TIMEOUT` error, `doctor::run` with the registry-dependent
  checks as `skip`, and the six schema files under `schemas/` with their
  examples. Tests: `workspace.rs` (23), `doctor.rs` (19), `schemas.rs` (9) and
  unit tests. Verified 2026-10-31 in `endpoints/umbel`: `cargo fmt --check`,
  `cargo clippy --all-targets --locked -- -D warnings`, the library-only
  clippy leg, `cargo test --locked`, `cargo +1.97.0 check --locked
  --all-targets`; `pnpm check` and `umbel.yml` on the pull request.
  `jsonschema` takes `default-features = false` and `toml` gains
  `preserve_order`; four small spec amendments are listed in the
  specification's "Amendments from step 2".
- **Done:** step 3, the registry and the CLI ([#573](https://github.com/lushly-dev/afd/pull/573)):
  `HostBuilder`, `seal` with its error mapping and the reserved CLI verbs,
  `Host::context`, `Host::cli_client`, `Workspace::resolve_space`, the
  `workspace-show`, `space-list` and `workspace-doctor` commands (the doctor
  fills in `mcp.surface` and `cli.verbs` on a sealed host), AFD's bootstrap
  commands with `cli: true`, the event stamp and space middleware (host-owned
  result keys always overwritten), the approval middleware without tokens,
  principal version 0 and the CLI context, logging to stderr, and the CLI:
  `umbel::cli::run` and the `umbel` binary with `init`, `help`, `docs`,
  `schema`, `call`, `batch` and `<domain> <action>`, the JSON envelope and text
  layout, the terminal-escape sanitizer, approvals and confirmations at a
  terminal or with `--approve` and `--yes`, and exit codes 0, 1, 2 and 130.
  Tests: `cli.rs` (16), `seal.rs` (8), `doctor_sealed.rs` (2),
  `trusted_keys.rs` (7) and 47 unit tests. Verified 2026-11-01 in
  `endpoints/umbel`: `cargo fmt --check`, `cargo clippy --all-targets --locked
  -- -D warnings`, the library-only clippy leg, `cargo test --locked`, `cargo
  +1.97.0 check --locked --all-targets`; `pnpm check` and `umbel.yml` on the
  pull request. Not in step 3: `umbel serve` (parsed, answers
  `NOT_IMPLEMENTED` until step 5) and the event commands (step 4). Amendments:
  the specification's "Amendments from step 3".
- **Done:** step 4, journal and events ([#574](https://github.com/lushly-dev/afd/pull/574)):
  the projecting sink over `FileJournalSink::shared`, which holds one
  `state/lock` across the journal append and the event append; `seq` read from
  the file tails under the lock; lock-free readers that skip a torn last line;
  the `projection.pending` marker, so the next append from any process, the next
  `seal`, `event-list` or `space-list` replays a failed projection first;
  `Host::repair_events`; event and provenance envelope version 0 (valid against
  `event.v0.json`); cursors `v0:<space>:<seq>` with `v0:<space>:0` before the
  first event; stored cursors per principal and consumer, written by atomic
  rename; `event-list`, `event-ack` and the CLI-only `event-rebuild`; and
  `space-list` on the catch-up instead of counting lines. Tests:
  `journal_events.rs` (12), `cursors.rs` (10), `multi_process.rs` (4: 200
  interleaved mutations across two hosts with a reader beside them, a held lock
  past the timeout, eight hosts opening a fresh workspace at once, and 24
  concurrent `umbel` processes) and five more cases in `trusted_keys.rs`.
  Verified 2026-11-01 in `endpoints/umbel`: `cargo fmt --check`, `cargo clippy
  --all-targets --locked -- -D warnings`, the library-only clippy leg, `cargo
  test --locked`, `cargo +1.97.0 check --locked --all-targets`; `pnpm check`
  and `umbel.yml` on the pull request. Amendments: the specification's
  "Amendments from step 4".
- **Done:** step 5, the MCP surfaces ([#575](https://github.com/lushly-dev/afd/pull/575)): `Host::mcp_server` (hybrid,
  `workspace-show` and `event-list` first-class, confirmations signed with the
  shared key, approval tokens off), `Host::http_router` (the exact `http.path`
  and `/health` behind the bearer layer: a random token in
  `state/keys/http.token`, mode 0600, on every request; the bound IP in the
  allowed hosts), the context hook version 0 (stdio, HTTP), `umbel serve
  --stdio` and `--http [--bind] [--print-token]` (stdout carries only JSON-RPC;
  startup failures are one JSON line on stderr with exit 1; SIGINT and SIGTERM
  exit 0), and Umbel's own drivers in `tests/support/` (in-process HTTP, in-memory
  stdio in both eras, a child-process driver that kills on drop). Tests:
  `protocol_http.rs` (26), `protocol_stdio.rs` (7), `hybrid_surface.rs` (13),
  `context_hook.rs` (7), `approvals.rs` (4), `confirmations.rs` (9),
  `process.rs` (16) and the MCP cases of `journal_events.rs` and `trusted_keys.rs`. Verified
  2026-11-01 in `endpoints/umbel`: `cargo fmt --check`, `cargo clippy
  --all-targets --locked -- -D warnings`, the library-only clippy leg, `cargo
  test --locked`, `cargo +1.97.0 check --locked --all-targets`; `pnpm check` and
  `umbel.yml` on the pull request. Amendments: the specification's "Amendments
  from step 5". With zero plugins, the host's built-in commands pass the
  protocol tests in both MCP eras over stdio and HTTP, and the first-class set is
  `workspace-show` then `event-list`; `umbel serve` repairs the event streams at
  start.
- **Done:** step 6, the exit: the README's build and run sections, and the
  exit criterion re-run. Evidence: 2026-11-01 on `main` at `8001fc74`: `cargo test --locked` in `endpoints/umbel` passed all 261 tests (18 integration files and the unit tests); `umbel init` then `umbel workspace doctor` on the fresh workspace exited 0 with `healthy: true` and all 13 checks `pass`; `umbel.yml` on `main` at that commit, [run 41263228249](https://github.com/lushly-dev/afd/actions/runs/41263228249).
- **Not done:** nothing in phase 0.
- **Follow-ups:** the open rows of the specification's follow-ups table,
  mirrored below.

### Phase 1. Plugin contract

- **State:** done 2026-11-01; the exit criterion is met. Specification
  approved by the owner (D24) and merged in
  [#583](https://github.com/lushly-dev/afd/pull/583) as `880779ff`; steps 0a,
  0b, 1, 2a, 2b, 3, 4, 5, 6, 7 and 8 done the same day. Last verified
  2026-11-01 against `main` at `1cca6309` plus step 8's test. (Superseded:
  "step 8 is next", verified at `f820783a`; before that "in review, revised,
  not approved", verified at `cdfbbfb7`.)
- **Done:** the [specification](phases/1-plugin-contract/spec.md), in
  review: the manifest `umbel-plugin.toml` version 1 (D37) and the WIT world
  `umbel:plugin/plugin@1.0.0` on WASI 0.2 (D38), which close O3; wasmtime's 48
  long-term line (D39); plugin protocol version 1 (D40); workspace
  configuration version 2 with plugin instances (D41); the phase 1 grants and
  effects (D42); the mounted loader on `rmcp`'s client (D43); per-space
  enablement (D44); first-class suggestions (D45); packs (D46); skills on
  three paths with an AFD step 0 (D47); the SDK and plugin crates (D48); the
  test kit and AFD's own tools in CI (D49); failure isolation (D50). The
  architecture, decision log and trajectory amendments are in the same pull
  request.
- **Revised 2026-11-01:** the owner decided the four trust-model points
  (compiled-in plugins are trusted, not sandboxed; stdio mounts run as the
  host's user with no OS sandbox and are as trusted as compiled plugins;
  enabling consents to declared grants except `deny`, with any future write,
  `http` or `secrets` grant requiring a per-instance `allow` list; HTTP
  mounts may send the deployer's own bearer, with `url` and `bearer_env` in
  `umbel.toml`), recorded in section 11, D42 and D43. Review must-fixes M1
  to M7, the should-fixes and nits applied; should-fix 17 partly (the
  provenance envelope version 0 has no source field). The plan now splits
  step 2 into 2a (loader core, compiled plugins) and 2b (packs, suggestions,
  contexts, pipelines).
- **Done:** step 0a, documents only: the AFD feature proposal
  [MCP resources and skills](../../../docs/features/complete/mcp-resources-skills/mcp-resources-skills.proposal.md)
  with its [status](../../../docs/features/complete/mcp-resources-skills/STATUS.md),
  approved under the owner's delegation of 2026-10-31 and placed in
  `docs/features/active/`; [`spec/mcp-resources.md`](../../../spec/mcp-resources.md)
  (resources R1 to R6, the Skills extension S1 to S8, tool `_meta` T1 to T3
  with MCP Apps' `ui` key allowed, advertised and validation schemas V1 and
  V2) and its cases `spec/mcp-resources.json`; the `command-metadata.md`,
  `protocol-conformance.md` and `CHANGELOG.md` amendments, `spec/VERSION`
  unchanged at `1.0-rc`; four language parity rows, Planned in every
  language; the Skill Knowledge Layer reconciled (its command skills stay
  separate). Verified 2026-11-01 against `main` at `880779ff`: current
  behavior read in `packages/server/src`, `python/src/afd/server`,
  `packages/rust/src` and the C++ todo backend, and external rules checked
  against the MCP 2026-07-28 and 2025-11-25 pages, SEP-2640, the Agent Skills
  specification and the MCP Apps specification; links and anchors resolve;
  `pnpm check` and the alfred parity tests pass. Its choices are listed in
  the specification's "Amendments from step 0a"; the one that changes Umbel:
  a resource's digest is AFD's `_meta["dev.afd/digest"]` (`sha256:<hex>`),
  not `dev.umbel/sha256`.
- **Found by step 0a:** Python's MCP SDK already declares empty `resources`
  and `prompts` capabilities (on the modern era with `subscribe` and
  `listChanged` true); recorded in the AFD status. It does not affect Umbel,
  which is Rust.
- **Done:** step 1, manifest and configuration ([#606](https://github.com/lushly-dev/afd/pull/606)): `umbel-plugin.toml`
  version 1 read and validated in `plugins/manifest.rs` (closed; Plugin
  Discovery's field meanings; `ui` and the other reserved keys refused naming
  their version; a mount's manifest says only `bearer`, never `url` or
  `bearer_env`); `plugins/source.rs` (`compiled:<id>` against a
  `CompiledCatalog`, workspace directories confined against `..`, absolute
  paths and symlinks, the both and neither cases); file checks for packs
  (`plugins/packs.rs`) and skills (`plugins/skills.rs`); the schemas
  `workspace-config.v2.json`, `plugin-manifest.v1.json` and
  `pack-manifest.v1.json` with examples (`$defs` holds every top-level
  property for Loam); `umbel.toml` version 2 (D41, D44: instance `url`,
  `bearer_env`, `spaces`, `deny`, `limits`, `env`; `grants.<grant>.allow` and
  the instance id `enabled` reserved; version 1 still opens as version 2 with
  no plugins) and `umbel init` writing 2; the doctor's `plugins.none` replaced
  by `plugins.config`, `plugins.sources`, `plugins.grants`, `plugins.packs`
  and `plugins.skills`, which need no sealed host (`plugins.loaded`,
  `plugins.first_class` and `plugins.pipelines` are `skip` until step 2a; a
  `compiled:` source is `skip` without a catalog, resolved by
  `doctor::run_with_catalog` with one); the WIT file
  `wit/umbel-plugin-1.0.0/world.wit` (a test pins it to the specification's
  text); the version constants, reported by `workspace-show`;
  `[workspace.lints]` with `lints.workspace = true`; `--workspace` in every
  cargo step of `umbel.yml`; `architecture.json` and the repository-contract
  test gain the five new surfaces. Tests: `manifest.rs` (27),
  `doctor_plugins.rs` (24), extended `schemas.rs` (17), `workspace.rs` (34),
  `doctor.rs` (19) and unit tests. Verified 2026-11-01 in `endpoints/umbel`:
  `cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets
  -- -D warnings`, the library-only clippy leg, `cargo test --locked
  --workspace`, `cargo +1.97.0 check --locked --workspace --all-targets`;
  `pnpm check` and `umbel.yml` on the pull request. One amendment is listed in
  the specification's "Amendments from step 1": until step 2a, `seal` refuses
  a workspace whose `plugins.enabled` is not empty, as phase 0 did, so a
  configured plugin is never silently ignored.
- **Done:** step 0b, the AFD Rust implementation ([#608](https://github.com/lushly-dev/afd/pull/608)):
  `McpServer::with_resources` and `with_skills` (resources, the Skills extension, `skills/list`,
  `skills/get`, optional `resources/directory/read`), `CommandDefinition::with_tool_meta`,
  `CommandRegistry::register_with_schemas` and `afd::check_meta_entry` in `packages/rust`; the Rust
  todo backend split into a library (`commands`, `TodoStore`, `register_commands`; the binary needs
  the default `server` feature). `rmcp` 3.8.0 routes the extension's methods, so the spec stood.
  Verified in `packages/rust`: fmt, clippy `-D warnings` and tests for default, no-default, `server`
  and `journal-file-shared`, both wasm checks, `tests/server_resources.rs` running
  `spec/mcp-resources.json` over HTTP and stdio on both eras; the todo backend with and without
  default features; todo conformance 34/34 legacy, 34/34 modern, 5/5 confirmations; `cargo test
  --locked --workspace` in `endpoints/umbel`. Seven amendments are in the specification's
  "Amendments from step 0b".
- **Done:** step 2a, the loader core and compiled plugins ([#610](https://github.com/lushly-dev/afd/pull/610), `07527f50`): the load
  sequence of section 6 for compiled plugins (`plugins/loader.rs`),
  `CompiledPlugin` and `HostBuilder::with_compiled` (through `cli::run`'s
  `configure` hook), `Services` and the grant gates, failure isolation per
  `required`, per-space enablement and the plugin gate with the provenance
  rule, the host's own set of space commands, `plugin-list` and `plugin-show`
  (printing "trusted, not sandboxed"), `workspace-show` reporting loaded
  plugins, the doctor's `plugins.loaded` on a sealed host (the `seal` guard of
  step 1 is gone, and the CLI passes the compiled catalog even when `seal`
  fails), `umbel-sdk` with `assets()` and `build::embed_assets`,
  `umbel-plugin-hello` as a compiled plugin, and the `testkit` feature
  (`TestHost`, with phase 0's drivers moved into it). Release inventory and
  `architecture.json` rows for `umbel-sdk` and `umbel-plugin-hello`
  (quarantined, no route). Tests: `plugin_compiled.rs`, `grants.rs`,
  `plugin_spaces.rs`, `plugin_conflicts.rs`, `plugin_commands.rs`,
  `testkit.rs`, the sealed cases of `doctor_plugins.rs` and hello's own tests.
  Verified 2026-11-01 in `endpoints/umbel`: `cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets -- -D warnings`, the library-only clippy leg, `cargo test --locked --workspace` (396 passed), `cargo +1.97.0 check --locked --workspace --all-targets`; `pnpm check` and `umbel.yml` on the pull request. The earlier session's clippy fix had never compiled, and clippy found three more unused-import and `unwrap_or_default` findings, fixed here. Not in 2a: origin
  `_meta` on plugin tools (step 3). Amendments: the specification's
  "Amendments from step 2a".
- **Done:** step 2b, packs, suggestions, contexts and pipelines ([#612](https://github.com/lushly-dev/afd/pull/612)):
  packs and per-space overrides (D46: a space's directory under
  `spaces/<space>/packs/<plugin>/<pack>/` replaces the default whole, never
  merged; the defaults and the overrides are validated at `seal`, an invalid
  one is `PACK_INVALID`; the `packs` grant reads the call's space's copy;
  `plugin-show` reports `default` or `override` per space with version and
  file count; `TestHostBuilder::pack_override`), first-class suggestions
  (D45: manifest `first_class` after `workspace-show` and `event-list`, in
  instance and manifest order, the cap of 8 with the doctor's
  `plugins.first_class` naming what was dropped, the deployer's list always
  wins), plugin AFD contexts (`build_server` now runs before
  `install_middleware`, so `McpServer::with_contexts` registers
  `afd-context-*` once and inside the middleware snapshot), and pipelines as
  data (steps run over the host registry with `$input`; one that names a
  missing command is not registered and the instance loads, reported by
  `plugin-show` and the doctor's `plugins.pipelines`; effects must cover the
  steps'; a pipeline with a confirm-gated step gets the union of its steps'
  prompts, so an unconfirmed call fails with `CONFIRMATION_REQUIRED` before
  any step runs). Tests: `packs.rs` (9), `first_class_plugins.rs` (6),
  `contexts_pipelines.rs` (10), the override case of hello's own tests, the
  new `commands[i].contexts` rule in `manifest.rs` and the sealed
  `plugins.first_class` and `plugins.pipelines` cases of `doctor_plugins.rs`.
  Verified 2026-11-01 in `endpoints/umbel`: `cargo fmt --all --check`, `cargo
  clippy --locked --workspace --all-targets -- -D warnings`, the library-only
  clippy leg, `cargo test --locked --workspace`, `cargo +1.97.0 check
  --locked --workspace --all-targets`; `pnpm check` and `umbel.yml` on the
  pull request. Eleven amendments are in the specification's "Amendments from
  step 2b".
- **Done:** step 3, skills on three paths ([#611](https://github.com/lushly-dev/afd/pull/611)): skills validated at load
  by AFD's own `SkillCatalog` (frontmatter, name equal to the directory,
  description, `SKILL_INVALID`; the doctor's `plugins.skills` checks the same);
  every loaded plugin's skills served by the host's MCP server on the Skills
  extension (`skills/list`, `skills/get`) and as resources (`resources/list`,
  `resources/read`, with `size` and `_meta["dev.afd/digest"]`), through
  `McpServer::with_skills`; a skill name served once per plugin and a
  `PLUGIN_CONFLICT` for the same plugin id with other content; `skill-list`
  (read-only, everywhere) and `skill-export` (CLI only, all or nothing,
  `force=true`, the origin file, no write through a symbolic link, unprojected);
  `_meta["dev.umbel/origin"]` (`plugin`, `kind`, `version`, `effects`) on every
  plugin tool; `SkillCatalog::entries()` made public in `packages/rust`.
  Tests: `skills.rs` (18) and the two doctor fixtures that now need real
  frontmatter. Verified 2026-11-01 in `endpoints/umbel`: `cargo fmt --all
  --check`, `cargo clippy --locked --workspace --all-targets -- -D warnings`,
  the library-only clippy leg, `cargo test --locked --workspace`, `cargo
  +1.97.0 check --locked --workspace --all-targets`; `pnpm check` and
  `umbel.yml` on the pull request. Amendments: the specification's
  "Amendments from step 3".
- **Done:** step 5, the mounted loader ([#613](https://github.com/lushly-dev/afd/pull/613)): rmcp's
  client over a child process's stdio (own `tokio::process::Command` with `kill_on_drop` and a
  cleared environment: `PATH`, the manifest's `env`, the instance's `env`) and Streamable HTTP with
  rustls; `url` and `bearer_env` from the instance only; `Discover` at 2026-07-28 with an explicit
  `Initialize` fallback at 2025-11-25 and no declared client capabilities; renaming with instance
  prefixes, `[[mount.tools]]` overrides (`effects`, `bind_space`, `confirm_prompt`, `approval`),
  advertised and stripped validation schemas through `register_with_schemas`, the load-time
  `description-injection` scan (warnings in `plugin-show` and the doctor), result mapping, the
  `max_result_bytes` limit enforced in a counting stdio reader and a bounded HTTP client, the
  plugin gate's `recorded`/`external` stamps, respawn (3 in 60 s), `timeout_ms`/`connect_timeout_ms`,
  HTTP mounts defaulting to `required = false`; `umbel-sdk`'s `mounted` feature (`serve_mounted`,
  `mounted_server`), the `hello-mcp` binary and hello's `mounted.toml`; the test kit's
  `instance_keys`. Tests: `plugin_mounted.rs` (31, including HTTPS against a local TLS server, the AFD meta-tools never mounted, and pipelines, first-class suggestions and contexts over mounted commands),
  `mount_naming.rs`, unit tests of the reader and the result mapping; the injection rule's shared
  vectors in `packages/testing`. Amendments: the specification's "Amendments from step 5".
  Verified 2026-11-01 against `main` at `b0782de7` (step 2b merged): `cargo fmt --all --check`,
  clippy `-D warnings` on the workspace and on the library-only, mounted library-only and mounted
  SDK/`hello-mcp` legs, `cargo test --locked --workspace` (488 passed, 0 failed), `cargo +1.97.0
  check --locked --workspace --all-targets`, `pnpm check` and the `packages/testing` suite (566).
- **Done:** step 4, the component loader ([#620](https://github.com/lushly-dev/afd/pull/620)): a WebAssembly component built against
  `umbel:plugin/plugin@1.0.0` on wasmtime 48.0.8 (a process-wide `Engine` and linker, an epoch ticker, compiled
  components cached by digest), its world read from the `umbel:plugin/command` export and `umbel:plugin/*`
  import versions, every import checked against the grants at load (`PLUGIN_IMPORT_DENIED` naming the
  import and the grant; `wasi:sockets` and `wasi:http` neither allowed nor linked), virtualized WASI 0.2
  (clocks and random bytes from the command context so the journal's tape records and replays them,
  stdout and stderr always linked, line-buffered into the host log under the `log` grant's 64 KiB cap, no
  environment, arguments, stdin or file), per-call stores with fuel, an epoch deadline plus a host
  deadline for a component waiting in the host, per-memory and table limits that name the limit that
  stopped the call, 4 MiB of input and result, trap, exit and result-validity errors; the SDK's `component`
  feature and `export_component!` with the scoped `unsafe_code = "deny"` exception; hello as a
  component (`manifests/component.toml`); four fixture components; the hello import list recorded in
  specification section 4. CI: `wasm32-wasip2` in the toolchain file, the components linted and built
  before the tests, the component-only clippy leg, longer timeouts, the test profile optimizing Cranelift
  and wasmtime, and `CARGO_PROFILE_DEV_DEBUG=line-tables-only`. Tests: `plugin_component.rs` (22),
  `component_limits.rs` (7), `component_replay.rs` (5) and unit tests of the analysis, the limiter and
  the limits. Verified 2026-11-01 in `endpoints/umbel`: `cargo fmt --all --check`, clippy `-D warnings` on
  the workspace and on every `umbel.yml` leg including the new ones, `cargo test --locked --workspace`
  (all pass), `cargo +1.97.0 check --locked --workspace --all-targets`; `pnpm check` and `umbel.yml` on
  the pull request. Facts checked: wasmtime 48.0.8 (MSRV 1.95), `wasmtime-wasi` 48 `p2`, and the tier
  table. Amendments: the specification's "Amendments from step 4", the first being that the normative
  WIT file did not parse (`list` is a WIT keyword; now `%list`).
- **Done:** step 6, the todo plugin and the conformance job ([#622](https://github.com/lushly-dev/afd/pull/622)): `umbel-plugin-todo`
  (`plugins/todo`, a workspace member: the eleven todo commands as a compiled plugin over the
  example's library, schemas generated from the backend and embedded, `plugin-state` on the eight
  mutations, `inspect` on three, `todo-clear`'s prompt) and the `umbel-todo` binary (hello in its
  catalog too); `--backend umbel` and `--backend umbel-mounted` in `dx/run-conformance.ts` with
  `test:conformance:umbel` and `test:conformance:umbel-mounted`; the `todo-http` fixture; the Rust
  backend's `TOOL_STRATEGY` (a spec amendment: its default grouped strategy does not list the
  `todo-*` tools a mount renames); `tests/scripts/external-clients.sh` (`afd connect`, `afd validate
  --surface --strict` with three rules suppressed, `afd scenario run`); the `conformance` and
  `plugin-isolation` jobs of `umbel.yml`; inventory and `architecture.json` rows. Nothing under
  `src/`, `wit/` or `schemas/` changed. Tests: `plugins/todo/tests/todo.rs` (5). Verified 2026-11-01
  in `endpoints/umbel`: `cargo fmt --all --check`, clippy `-D warnings` on the workspace and every
  `umbel.yml` leg, `cargo test --locked --workspace` (532 passed), `cargo +1.97.0 check --locked
  --workspace --all-targets`; conformance locally: Rust backend 34/34 (legacy), 34/34 (modern),
  5/5 (confirmations); `umbel` the same; `umbel-mounted` 34/34 in both modes; scenarios 4/4;
  `pnpm install --frozen-lockfile --force`, `pnpm build`. Amendments: the specification's
  "Amendments from step 6".
- **Done:** step 7, `plugin new` and `plugin check` ([#623](https://github.com/lushly-dev/afd/pull/623)):
  `plugin-new` (CLI only, unprojected) writes a skeleton for each kind from templates embedded in the
  binary (`src/templates/`): a compiled crate and a component crate, each with `Cargo.toml`, the
  manifest, `build.rs`, `src/lib.rs`, an `<id>-hello` command with schemas, a `starter` pack, a skill,
  `tests/plugin.rs` over the test kit and the host's own toolchain pin; a mounted plugin with a stdio
  `[mount]`; a pack plugin. It refuses a non-empty directory and an id the host owns, and takes
  `umbel_path` to depend on a checkout. `plugin-check` (CLI only) reports `manifest`, `grants`,
  `schemas` (`missing-output-schema` and the `description-injection` rule as warnings), `packs`,
  `skills`, `config` (defaults must validate), `component` (compile and imports against the declared
  grants), `boot` (an internal host over a temporary workspace with only the plugin, built with
  `HostBuilder` and not the `testkit` feature; a stdio mount starts only with `spawn=true`; a
  compiled plugin boots only in a binary that links it) and `surface` (`skip` with the `afd validate
  --surface` suggestion). A failed check is `PLUGIN_CHECK_FAILED` with the report as `details`, so
  the CLI exits 1. The README's "Write a plugin" section. Tests: `plugin_scaffold.rs` (14: every
  kind scaffolds, the compiled and component scaffolds build and pass their own tests and the
  check, the component fails with `PLUGIN_IMPORT_DENIED` when a grant is dropped, `spawn=true` is
  what starts a mount's program, a bad manifest, skill, pack and grant fail, and a binary that links
  the plugin boots it) and 3 unit tests of the templates. Verified 2026-11-01 in `endpoints/umbel`:
  `cargo fmt --all --check`, clippy `-D warnings` on the workspace and the three library-only legs,
  `cargo test --locked --workspace`, `cargo +1.97.0 check --locked --workspace --all-targets`;
  `pnpm check` and `umbel.yml` on the pull request. Amendments: the specification's "Amendments
  from step 7".
- **Done:** step 8, the exit ([#624](https://github.com/lushly-dev/afd/pull/624)):
  `endpoints/umbel/tests/hello_three_ways.rs`, and the exit criterion re-run
  on `main` at `1cca6309` plus that test. `umbel.yml` needed no change: it
  already builds the hello component and `hello-mcp` before `cargo test
  --workspace`, and runs the `conformance` and `plugin-isolation` jobs. Evidence,
  all 2026-11-01 on macOS with `CARGO_TARGET_DIR` shared:
  - **Run 1, hello three ways:** `hello_three_ways.rs` loads hello as
    `compiled:hello`, as the component built from the same crate and mounted
    through `hello-mcp` with `manifests/mounted.toml`, each in its own
    workspace with the test kit's fixed clock, and calls `hello-greet` with
    `{ "name": "Ada", "space": "main" }` over MCP (stdio and HTTP, both eras)
    and through the CLI: five surfaces per build. The compiled and component
    `data` are equal, `at` included (`2026-01-01T00:00:00.000Z`); the mounted
    `data` equals them without `at`, which is the mounted server's own clock,
    and carries `dev.umbel/replay = "recorded"`, `dev.umbel/trust =
    "external"` and `dev.umbel/plugin = { id: "hello", kind: "mounted" }`;
    `event-list` then shows no event and head `v0:main:0` in all three
    workspaces. It passed on the first run.
  - **`cargo test --locked --workspace`** in `endpoints/umbel`: 550 passed, 0
    failed, 1 ignored (a doc-test) across 55 test runs, after `cargo fmt
    --all --check` and `cargo clippy --locked --workspace --all-targets -- -D
    warnings` were clean, with the components (`cargo build --locked --release
    --target wasm32-wasip2 ...`) and `hello-mcp` built first as `umbel.yml`
    does.
  - **Run 3, todo conformance against `umbel-todo`:** `pnpm --filter
    @afd/example-todo test:conformance:umbel` 34/34 (legacy), `... --mode
    modern` 34/34, `... --suite confirmations --mode modern` 5/5.
  - **Run 4, the stock `umbel` mounting the Rust backend:** `pnpm --filter
    @afd/example-todo test:conformance:umbel-mounted` 34/34 and `... --mode
    modern` 34/34.
  - **The Rust backend itself:** `pnpm --dir packages/examples/todo
    test:conformance:rs` 34/34, `... --mode modern` 34/34, `... --suite
    confirmations --mode modern` 5/5.
  - **AFD's own clients:** `bash endpoints/umbel/tests/scripts/external-clients.sh
    <umbel-todo> packages/cli/dist/bin.js packages/examples/todo/scenarios`
    exited 0: `afd validate --surface --strict` against `umbel-todo` with
    hello and todo enabled, 0 errors and 0 warnings (18 info, with the three
    suppressed rules of the follow-up below), and `afd scenario run` 4
    scenarios passed, 0 failed.
  - **`plugin check` on each `plugin new` template**, with the stock `umbel`
    binary in a fresh workspace (the component scaffold built for
    `wasm32-wasip2` and copied where its manifest says): `compiled`, `component`,
    `mounted` and `pack` each exit 0 and `healthy: true`, no check failed
    (`compiled`: `component` and `boot` skip; `component`: `component` and
    `boot` pass; `mounted`: `schemas` and `boot` skip; `pack`: `boot` pass;
    `surface` skip in all four).
  - **CLI and doctor smoke:** `umbel-todo init`, `plugins.enabled = ["hello"]`,
    then `workspace doctor` exited 0 with `healthy: true` and all 20 checks
    `pass`; `hello greet name=Ada` answered `Hello, Ada!` for the space `main`
    stamped `compiled`; `plugin list` showed hello loaded, "trusted, not
    sandboxed".
  - **Exit run 2 and the workflow:** `plugin-isolation` and every other job of
    `umbel.yml` ran on the pull request, and again on `main` at the merge
    commit `886c3b4d`: [run 41298630706](https://github.com/lushly-dev/afd/actions/runs/41298630706),
    success (checked 2026-11-01).
- **Not done:** nothing in phase 1. The follow-ups below that name a later
  phase stay open.
- **Needs the owner:** nothing. O1 is unchanged. Phase 2 needs its
  specification written and approved (D24) before it starts.
- **Follow-ups:** the specification's follow-ups table, mirrored below.
