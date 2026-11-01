# Umbel status

Read this before anything else in the area, and update it before you end a
session that changed Umbel. It is the source of truth for progress: an agent
should never have to scan the codebase to learn what is current.

## How to keep this file

- **Say exactly what is done and exactly what is not.** "Done" means merged
  to `main` with evidence linked: a pull request, a commit, a passing check.
  Anything else is "in progress" or "open" with what remains spelled out.
- **Record how you verified it**: the command or check, and the date.
- **Write down follow-ups that are not yet issues.** If a future agent must
  know it but nobody owns it yet, it goes in the follow-ups table with a date
  and who raised it. Promote it to an issue when it gets an owner, and link
  the issue here.
- **Never delete history.** Mark an entry superseded and point to what
  replaced it.
- **Every phase specification carries the same block**: state, last verified
  with date and evidence, done, not done, follow-ups. This file aggregates
  those blocks; the phase folder holds the detail (decisions D20 and D24).
- **Dates are absolute.** Never "last week".

## Documents

| Document | State | Evidence | Verified |
| --- | --- | --- | --- |
| [Architecture](architecture.md) | Revised after the 2026-10-30 end-to-end review and corrected in the 2026-10-31 handoff check; the through line | Merged in [#491](https://github.com/lushly-dev/afd/pull/491), [#493](https://github.com/lushly-dev/afd/pull/493) and [#516](https://github.com/lushly-dev/afd/pull/516); handoff corrections in [#519](https://github.com/lushly-dev/afd/pull/519) | 2026-10-30: three independent reviews (AFD alignment, coherence, external facts); relative links, fences and diagrams rendered. 2026-10-31: links, anchors and every D, O, R, W and S reference re-checked on `main` |
| [Proposal](proposal.md) | Approved rationale; the architecture wins where they differ | #491, #493 and #516 | Same as above |
| [Decision log](decisions.md) | D1 to D67 (D51 to D67 proposed with the phase 2 specification, in review, amended 2026-11-01 by its revision; D40 and D42 annotated); open decisions O1, O4 and O5; O2 closed as D27 on 2026-10-31; O3 closed as D37 and D38 on 2026-11-01 with the phase 1 specification, approved and merged in [#583](https://github.com/lushly-dev/afd/pull/583) | D1 to D12 in #491; D13 to D20 in #493; D21 to D26 and the O list in #516; D27 in [#522](https://github.com/lushly-dev/afd/pull/522); D28 to D36 accepted with the phase 0 specification, which the owner approved under the delegation of 2026-10-31 and which merged in [#564](https://github.com/lushly-dev/afd/pull/564) as `fb35d525`; D21, D28, D29, D31, D32, D33, D34, D35 and D36 were amended 2026-10-31 after its review | Same as above; 2026-10-31: D27's links and the O2 references re-checked; D28 to D36 merged with #564 |
| [Trajectory watch](trajectory.md) | Current as of 2026-10-30; rows carry R and W numbers; W1, W2, W5, W6, W12 and W15 refreshed 2026-10-31 for phase 0; W1, W2, W15, W16 and the library rows refreshed and W17 added 2026-11-01 for phase 1; W1 to W4, W11, W16 and the store, search, parsing and tree-sitter library rows refreshed 2026-11-01 for phase 2 | #493; corrections in #516; the refresh with the phase 0 specification, merged in #564 | External claims fact-checked against primary sources on 2026-10-30; the refreshed rows on 2026-10-31 |
| [Phase 0 specification](phases/0-host-skeleton/spec.md) | Approved 2026-10-31 under the owner's delegation (D24) after an independent review ("approve after must-fixes") and revision; merged in [#564](https://github.com/lushly-dev/afd/pull/564) as `fb35d525`; implementation in progress | [#564](https://github.com/lushly-dev/afd/pull/564), merged | 2026-10-31 against `main` at `472b5f68`: every finding checked against `packages/rust`, `packages/cli`, `packages/server`, `python/`, `spec/` and `scripts/`; links and anchors resolve |
| [Phase 1 specification](phases/1-plugin-contract/spec.md) | Written 2026-11-01; revised 2026-11-01 after the independent review and the owner's trust-model decisions; approved by the owner (D24) and merged in [#583](https://github.com/lushly-dev/afd/pull/583) as `880779ff`; steps 0a, 0b, 1, 2a, 2b, 3, 4, 5, 6 and 7 done 2026-11-01 (see Phase 1 below); 0a amended section 8.3's digest key. Closes O3 (D37, D38) and adds D39 to D50 with the architecture amendments they need; D38, D40, D42, D43, D47, D48 and D50 amended 2026-11-01 | [#583](https://github.com/lushly-dev/afd/pull/583), merged | 2026-11-01 against `main` at `393d30aa`: `packages/rust`, `endpoints/umbel`, the todo example and its runner, Plugin Discovery, the Skill Knowledge Layer and Botcore's command policy read; trajectory rows checked against primary sources; links and anchors resolve |
| [Phase 2 specification](phases/2-knowledge/spec.md) | Written 2026-11-01; revised 2026-11-01 after the independent review and the owner's decisions; approved and merged in [#625](https://github.com/lushly-dev/afd/pull/625) as `e996aad1`. Adds D51 to D67 with the architecture amendments they need, and step 0 in AFD (output budgets, a public frontmatter reader); step 0a done 2026-11-01 (see Phase 2 below) and amended section 14 | [#625](https://github.com/lushly-dev/afd/pull/625), merged | Revision 2026-11-01 against `main` at `886c3b4d`: the review's findings checked against `src/middleware.rs`, `src/principal.rs`, `src/cli/prompt.rs`, `sdk/src/cx.rs`, the WIT world and the tantivy, tantivy-query-grammar, tree-sitter and tree-sitter-typescript crate sources. First written 2026-11-01 against `main` at `1cca6309`: `endpoints/umbel` schemas, grants, SDK, principal and scan read; `packages/rust` sources, frontmatter, context fields; `spec/` read; trajectory rows checked against crates.io, GitHub and the OKF specification; links and anchors resolve |
| [Research](research.md), [Sources](sources.md) | Current as of 2026-10-30, with corrected figures | #491; corrections in #516 | Same as above |

## Phases

| Phase | State | Owner | Evidence | Next gate |
| --- | --- | --- | --- | --- |
| AFD prerequisites | Done for phase 0, including step 0 of the phase 0 plan (2026-10-31); the rows for phases 1 to 5 remain | Owner's sessions; step 0 by the phase 0 owning agent | [#523](https://github.com/lushly-dev/afd/pull/523), [#526](https://github.com/lushly-dev/afd/pull/526), [#539](https://github.com/lushly-dev/afd/pull/539), [#538](https://github.com/lushly-dev/afd/pull/538), [#555](https://github.com/lushly-dev/afd/pull/555), [#556](https://github.com/lushly-dev/afd/pull/556) and [#560](https://github.com/lushly-dev/afd/pull/560) and step 0, [#567](https://github.com/lushly-dev/afd/pull/567), merged | Later phases' rows of the prerequisites table, each before the phase that needs it |
| 0. Host skeleton | Done 2026-11-01: exit criterion met | Phase 0 owning agent | [Specification](phases/0-host-skeleton/spec.md) ([#564](https://github.com/lushly-dev/afd/pull/564)); steps [#567](https://github.com/lushly-dev/afd/pull/567), [#570](https://github.com/lushly-dev/afd/pull/570), [#572](https://github.com/lushly-dev/afd/pull/572), [#573](https://github.com/lushly-dev/afd/pull/573), [#574](https://github.com/lushly-dev/afd/pull/574), [#575](https://github.com/lushly-dev/afd/pull/575); exit run [run 41263228249](https://github.com/lushly-dev/afd/actions/runs/41263228249) | None |
| 1. Plugin contract | Done 2026-11-01: exit criterion met; `umbel.yml` [run 41298630706](https://github.com/lushly-dev/afd/actions/runs/41298630706) green on `main` at `886c3b4d` | Phase 1 owning agent | [Specification](phases/1-plugin-contract/spec.md) ([#583](https://github.com/lushly-dev/afd/pull/583), `880779ff`); step 0a: the [AFD proposal](../../../docs/features/active/mcp-resources-skills/mcp-resources-skills.proposal.md) and [`spec/mcp-resources.md`](../../../spec/mcp-resources.md); step 0b: [#608](https://github.com/lushly-dev/afd/pull/608); step 1: [#606](https://github.com/lushly-dev/afd/pull/606); step 2a: [#610](https://github.com/lushly-dev/afd/pull/610); step 2b: [#612](https://github.com/lushly-dev/afd/pull/612); step 3: [#611](https://github.com/lushly-dev/afd/pull/611); step 5: [#613](https://github.com/lushly-dev/afd/pull/613); step 4: [#620](https://github.com/lushly-dev/afd/pull/620); step 6: [#622](https://github.com/lushly-dev/afd/pull/622); step 7: [#623](https://github.com/lushly-dev/afd/pull/623); step 8: [#624](https://github.com/lushly-dev/afd/pull/624) | None |
| 2. Knowledge | Specification approved and merged ([#625](https://github.com/lushly-dev/afd/pull/625), `e996aad1`); steps 0a and 0b done 2026-11-01; step 1 (shapes and configuration) done 2026-11-01 in [632](https://github.com/lushly-dev/afd/pull/632); steps 2 to 10 not done | Phase 2 owning agent | [Specification](phases/2-knowledge/spec.md) ([#625](https://github.com/lushly-dev/afd/pull/625)); step 0a: the [AFD proposal](../../../docs/features/active/output-budgets/output-budgets.proposal.md) and [`spec/output-budgets.md`](../../../spec/output-budgets.md); step 0b: [#PR_NUMBER](https://github.com/lushly-dev/afd/pull/PR_NUMBER), the Rust output budgets and the public frontmatter reader; step 1: [632](https://github.com/lushly-dev/afd/pull/632) | Step 2 (store traits and the SQLite stores) |
| 3. Memory and context | Not started | None | None | Phase 2 exit criterion met |
| 4. Curator | Not started | None | None | Phase 3 exit criterion met |
| 5. Auth and hosted | Not started | None | None | Phase 2 exit criterion met |
| 6. Backends | Not started | None | None | Phase 2 exit criterion met |
| 7. Distribution and guides | Not started | None | None | Phases 4, 5 and 6 exit criteria met |
| Further first-class plugins | Not started | None | None | Phase 2 exit criterion met; each gets its own specification (D18) |

## Phase detail

### AFD prerequisites

- **State:** done for phase 0, including the two additions the phase 0
  specification puts in its step 0 (added 2026-10-31); the rows for phases 1
  to 5 remain. Last verified 2026-10-31 against `main` at `57c731d2`; the
  step 0 rows on 2026-10-31 at `045b6feb`.
- **Done:** Rust `structuredContent` and top-level `outputSchema` (the Rust
  part of #465, which stays open for Python and C++) and the per-request
  context hook (`McpServer::with_context_hook`), both merged in
  [#523](https://github.com/lushly-dev/afd/pull/523) as `77f176d3` with all
  nine checks green.
- **Done:** the Rust grouped, individual and lazy strategies, the five
  meta-tools and AFD contexts (language parity D1), merged in
  [#526](https://github.com/lushly-dev/afd/pull/526) as `03815e26` with all
  eleven checks green and the todo conformance suite at 34/34 in both MCP eras
  and with confirmations. Every route carries `structuredContent` and runs the
  context hook once per call; `grouped` is now the Rust default, which the
  owner accepted on 2026-10-31.
- **Done:** [#531](https://github.com/lushly-dev/afd/issues/531), a panic in
  the server's own request handling hanging the MCP request, fixed in
  [#539](https://github.com/lushly-dev/afd/pull/539) as `2552748c`; a
  handler's panic was already a `COMMAND_EXECUTION_ERROR` result. The hybrid
  strategy's spec step, [`spec/tool-strategies.md`](../../../spec/tool-strategies.md),
  merged in [#538](https://github.com/lushly-dev/afd/pull/538) as `977a0a35`.
- **Done:** the hybrid tool strategy (D27) in Rust,
  `ToolStrategy::Hybrid` with `McpServer::with_first_class_tools`, merged in
  [#560](https://github.com/lushly-dev/afd/pull/560) as `57c731d2` with all 25
  checks green; `tests/server_hybrid.rs` runs every case of
  `spec/tool-strategies.json` over stdio and Streamable HTTP in both MCP eras.
  Python ([#555](https://github.com/lushly-dev/afd/pull/555), `51f8d9d8`) and
  TypeScript ([#556](https://github.com/lushly-dev/afd/pull/556), `0d9720a1`)
  landed first. C++ (step 4) waits on its MCP target (parity D2, #341) and
  does not block Umbel. The [hybrid status](../../../docs/features/active/hybrid-tool-strategy/STATUS.md)
  tracks it.
- **Done:** step 0 of the
  [phase 0 plan](phases/0-host-skeleton/spec.md#step-0-the-afd-pull-request),
  a process-shared mode for the Rust `FileJournalSink` behind the new
  `journal-file-shared` feature (D29) and `DirectClient::with_interface`
  (D34), merged in [#567](https://github.com/lushly-dev/afd/pull/567) as
  `045b6feb` on 2026-10-31 with all nine checks green (Rust fmt, clippy and
  test; Rust docs.rs build; todo conformance for TypeScript and Python, Rust
  and C++; TypeScript on Node 22 and 24; Python 3.11 and 3.12). Run locally
  first: everything `rust.yml` runs, the Rust todo backend's checks with
  `--locked`, and `pnpm check`. The spec needed no amendment.
- **Not done:** the later rows of the
  [prerequisites table](architecture.md#afd-prerequisites): resources,
  prompts and Skills over MCP (phases 1 and 2, shared with Loam), output
  budgets (phase 2; specified in step 0a, implemented in Rust in step 0b),
  the MCP approval relay in Rust (phase 4), token
  verification, `scopes` and `credentials` (phase 5, with
  [#532](https://github.com/lushly-dev/afd/issues/532)) and the Rust MCP Tasks
  runtime (phase 5).
- **Note:** the hybrid strategy, resources, prompts, the Skills over MCP
  extension and output budgets are AFD-wide features; each needs a
  `docs/features` proposal, spec first, before Rust implements it (D25).

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
  [MCP resources and skills](../../../docs/features/active/mcp-resources-skills/mcp-resources-skills.proposal.md)
  with its [status](../../../docs/features/active/mcp-resources-skills/STATUS.md),
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

### Phase 2. Knowledge

- **State:** specification in review, **revised** 2026-11-01 after the
  independent review and the owner's decisions of the same day; not yet
  approved (D24). Implementation not started. Last verified 2026-11-01
  against `main` at `886c3b4d`.
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
  the [AFD proposal](../../../docs/features/active/output-budgets/output-budgets.proposal.md)
  with its [status](../../../docs/features/active/output-budgets/STATUS.md),
  [`spec/output-budgets.md`](../../../spec/output-budgets.md) (B1 to B8)
  with its cases [`spec/output-budgets.json`](../../../spec/output-budgets.json),
  amendments to `command-metadata.md`, `context-fields.md`, `journal.md`,
  `error-codes.md` (`OUTPUT_BUDGET_EXCEEDED`, specified, joining the
  catalog in 0b), `protocol-conformance.md` and `CHANGELOG.md`; parity rows
  Planned in every language. Verified 2026-11-01 against `main` at
  `e996aad1`: current behavior read in the four languages, MCP 2026-07-28
  rules checked; `pnpm check` and the alfred parity tests. The
  specification's [Amendments from step 0a](phases/2-knowledge/spec.md#amendments-from-step-0a)
  record what changed for 0b.
- **Done:** step 0b, the Rust output budgets and the public frontmatter
  reader in AFD, 2026-11-01 ([#PR_NUMBER](https://github.com/lushly-dev/afd/pull/PR_NUMBER)):
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
- **Not done:** steps 2 to 10 of the
  [plan](phases/2-knowledge/spec.md#14-implementation-plan); the exit
  criterion. TypeScript, Python and C++ output budgets are AFD's follow-up
  and do not block Umbel. Step 4 owes the ten grants, the allow lists and `deny` and
  `grants.<g>.allow` in configuration version 3 (both still as in version 2),
  the gate setting `dev.umbel/changes`, `event-list` filtering by `access`,
  the store refusal of an invalid envelope, and the CLI behaviour of
  `confirm = "require-human"` (the manifest key only parses today).
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
- **Needs the owner:** approval of the revised specification.
- **Follow-ups:** the specification's follow-ups table, mirrored below.

Phases 3 to 7 have no detail yet; add a heading in this shape when one
starts.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-10-30 | Design session | Land the phase 0 prerequisites in `packages/rust`; the lazy strategy, meta-tools and contexts are already parity item D1 and #465 is open | Done 2026-10-31: see the AFD prerequisites detail above |
| 2026-10-30 | Design session | Decide the execution model, open decision O2 | Done 2026-10-31: the owner chose the hybrid strategy, recorded as [D27](decisions.md) in [#522](https://github.com/lushly-dev/afd/pull/522), open until merged |
| 2026-10-30 | Design session | Decide the first external integration, open decision O1; it sets the connector contract | Open, owner's decision |
| 2026-10-30 | Design session | When crates land, add the units under `endpoints/umbel/` to the release inventory (`scripts/release/inventory.json`, D21); units start quarantined. Corrected 2026-10-31: `architecture.json` needs no change, since the boundary check classifies endpoint manifests by path | Open; specified 2026-10-31 as step 1 of the [phase 0 plan](phases/0-host-skeleton/spec.md#11-implementation-plan) (one unit, `umbel`, private, no route). Corrected again 2026-10-31 in the phase 0 review: `architecture.json` gains an explicit unit with `publicSurfaces`, as Botcore and Health have (D21, D35) |
| 2026-10-30 | Design session | Harness channels must negotiate MCP 2025-11-25 or earlier; keep the SDK's compatibility on push paths and re-check watchlist row W15 | Open |
| 2026-10-30 | Design session | Refresh the trajectory watchlist rows before each phase specification, in particular W2 and W3 ahead of 2027-03-30 | Open, recurring; refreshed 2026-10-31 for phase 0 |
| 2026-10-30 | End-to-end review | Write `docs/features` proposals, spec first, for the hybrid tool strategy, for resources, prompts and Skills over MCP in AFD servers reconciled with the Skill Knowledge Layer (shared with Loam, which also needs `ui://` resources), and for per-tool output budgets | Open. Hybrid tool strategy: [proposal](../../../docs/features/active/hybrid-tool-strategy/hybrid-tool-strategy.proposal.md) written and approved 2026-10-31. Resources and Skills over MCP: [proposal](../../../docs/features/active/mcp-resources-skills/mcp-resources-skills.proposal.md) and spec written and approved 2026-11-01 (phase 1 step 0a), prompts deferred to its next step. Output budgets: [proposal](../../../docs/features/active/output-budgets/output-budgets.proposal.md) and spec written and approved 2026-11-01 (phase 2 step 0a) |
| 2026-10-30 | End-to-end review | Reconcile vocabulary and the proposal record with the Agent Engine proposal, whose modules are Umbel's plugins and whose loop overlaps the curator | Open |
| 2026-10-30 | End-to-end review | Over MCP, the Rust approval middleware includes approval tokens by default; Umbel must turn that off on the MCP path. Re-checked 2026-10-31: [#518](https://github.com/lushly-dev/afd/pull/518) closed #460 with the private in-process exchange, and the default on the MCP path is unchanged | Open |
| 2026-10-31 | Owner review | Confirmation `requestState` is bound to the command and input, not the actor; with the context hook admitting several actors, one could replay another's confirmation | Issue [#532](https://github.com/lushly-dev/afd/issues/532); needed before phase 5 |
| 2026-10-31 | Owner review | A panicking command handler hangs the Rust MCP request | Done: fixed in [#539](https://github.com/lushly-dev/afd/pull/539) |
| 2026-10-31 | Phase 0 specification | AFD: let `DirectClient` take the CLI interface, so the Umbel CLI stops checking `expose.cli` itself (D34) | Superseded 2026-10-31: now step 0 of the [phase 0 plan](phases/0-host-skeleton/spec.md#step-0-the-afd-pull-request) |
| 2026-10-31 | Phase 0 specification | AFD: the Rust telemetry middleware, which replaces Umbel's interim one (D33); in the prerequisites table for phase 2 | Superseded 2026-10-31: D33 dropped, no interim middleware; the prerequisite row stays for phase 2 |
| 2026-10-31 | Phase 0 specification | A journal sink failure never changes a command's result, so a lock timeout or a full disk loses a journal entry and its event while the command succeeds; decide whether audited mutations need a fail-closed mode before phase 2 writes records | Specified 2026-11-01 in the [phase 2 specification](phases/2-knowledge/spec.md) as D66 (fail-open, store changes carry trace ids, `store-check` reports gaps), in review; an owner point |
| 2026-10-31 | Phase 0 specification | Several stdio harnesses on one workspace contend for the writer lock (D29); consider `umbel serve --stdio --proxy <url>` | Superseded 2026-10-31: D29 amended, any number of processes share a workspace |
| 2026-10-31 | Phase 0 review | The phase 2 embedded store must support several processes on one workspace (for example SQLite in WAL mode, or LMDB), so D29's model survives; no single-writer daemon (D28) | Specified 2026-11-01 in the [phase 2 specification](phases/2-knowledge/spec.md) as D51 (SQLite in WAL mode and tantivy's writer lock, bounded waits), in review |
| 2026-10-31 | Phase 0 review | AFD: an accessor for `McpServer`'s default instructions, so a host can add a line without replacing them | Open, AFD, if wanted |
| 2026-10-31 | Phase 0 specification | Windows in the `umbel.yml` matrix (key permissions, file locks, signals) | Open, phase 7 |
| 2026-10-31 | Phase 0 specification | An external client check, `afd validate` against `umbel serve --http`, in CI; the client must send the bearer token | Open; specified 2026-11-01 as the `conformance` job of the [phase 1 plan](phases/1-plugin-contract/spec.md#14-implementation-plan), step 6 (D49) |
| 2026-11-01 | Step 4 | For the step 5 agent: the MCP cases of `journal_events.rs`, `trusted_keys.rs` and `process.rs`, and `Host::repair_events` at the start of `umbel serve` | Done 2026-11-01 in [#575](https://github.com/lushly-dev/afd/pull/575) |
| 2026-11-01 | Phase 0 step 4 | AFD's Rust schema validation has no `pattern` keyword, so a schema using it is refused at registration and the handler checks the `consumer` pattern itself (spec "Amendments from step 4"); decide whether AFD adds `pattern` across languages (see `spec/validation.md`) | Open |
| 2026-11-01 | Phase 1 specification | The owner's decision on the four trust-model points of the specification's section 11 | Done 2026-11-01: decided by the owner; recorded in the specification's section 11, D42 and D43 |
| 2026-11-01 | Phase 1 review | Operating-system sandboxing for stdio mounts: a stdio child runs as the host's user and can read `state/keys/` and every space (owner decision 2) | Open, a later phase; owner to place |
| 2026-11-01 | Phase 1 review | Carry the plugin inside the provenance envelope (version 0 is closed with no source field) | Specified 2026-11-01 in the [phase 2 specification](phases/2-knowledge/spec.md) as envelope version 1's `plugin` field (D55), in review |
| 2026-11-01 | Phase 1 specification | A precompiled component cache; wasmtime's `Component::deserialize` is `unsafe`, which the crate forbids | Open, phase 7 or when startup cost is measured |
| 2026-11-01 | Phase 1 specification | A mount's tool snapshot under `state/`, so one-shot CLI calls do not spawn every mounted server | Open, a later phase |
| 2026-11-01 | Phase 1 specification | WIT world 2.0.0 on WASI 0.3 when a wasmtime long-term line supports the async component model (about 60), or the owner decides to leave the long-term line (W17, restated after review) | Open |
| 2026-11-01 | Phase 1 specification | MCP prompts in AFD servers, after the resources and Skills proposal of step 0a | Open, AFD; recorded as the next step of the [proposal](../../../docs/features/active/mcp-resources-skills/mcp-resources-skills.proposal.md#implementation-plan) on 2026-11-01 |
| 2026-11-01 | Phase 1 specification | The `http` and `secrets` grants, each with a required per-instance `allow` list, and moving an HTTP mount's `bearer_env` under `secrets` | Open, the first plugin that needs outbound calls; `secrets` by phase 5 |
| 2026-11-01 | Phase 1 step 6 | Remove the three `--suppress` rules from `tests/scripts/external-clients.sh`: Umbel's built-in command descriptions need an action verb and 20 characters, `event-list`'s schema is complex, and the todo example's overlap and complexity warnings need a decision | Open, a later phase: step 8 changes nothing under `src/`, where the descriptions and `event-list` live |
| 2026-11-01 | Phase 2 specification | Store grants for components: WIT world `umbel:plugin/plugin@1.1.0` with store imports | Open, the first phase that needs a component reading stores |
| 2026-11-01 | Phase 2 specification | Output budgets in TypeScript, Python and C++ after the phase 2 step 0b | Open, AFD |
| 2026-11-01 | Phase 2 specification | Documents as MCP resources (`kb://`) once a permission-filtered listing exists | Open, after phase 5 |
| 2026-11-01 | Phase 2 specification | Restore from `store-backup` | Open, phase 6 |
| 2026-11-01 | Phase 2 specification | Partitioned BM25 statistics per access set, or coarsened scores, and an end to hidden-count leaks (scores, revision and `seq` gaps, `store-show`'s head, index-building totals) | Open, **phase 5 prerequisite** (owner decision 2026-11-01); in the architecture's prerequisites table |
| 2026-11-01 | Phase 2 specification revision | Measure chunk sizes against S57 (about 250-token chunks with overlap) with the eval harness once its baseline exists | Open, after phase 2 step 9 |
| 2026-11-01 | Phase 2 specification | A per-collection option to block, not only flag, content the write scan matches | Open, when a deployer asks |
| 2026-11-01 | Phase 2 specification | Watching collection roots instead of an explicit `knowledge-refresh` | Open, later |
| 2026-11-01 | Phase 2 step 1 | `umbel.toml` version 3 keeps `plugins.<id>.deny` and `plugins.<id>.grants.<g>.allow` as version 2 had them (the phase 1 grant names; `grants` reserved), and `workspace-config.v3.json` says the same; step 4 adds the ten grants and the allow lists to both the host and the schema | Open, phase 2 step 4 |
| 2026-11-01 | Phase 2 step 1 | An event whose command supplied no valid `access` carries `["space"]` and `internal`; the store write that refuses an invalid envelope (`STORE_PROVENANCE_REQUIRED`) is step 4's, so until then a plugin that supplies a mistyped restrictive access set widens its event to the space (the store is not written yet) | Open, phase 2 step 4 |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-10-30 | Design session with the owner | Proposal, research and sources written and merged ([#491](https://github.com/lushly-dev/afd/pull/491)); name decided; diagrams, trajectory watch, trajectory reservations, decisions D13 to D20 and this status file in [#493](https://github.com/lushly-dev/afd/pull/493), merged |
| 2026-10-30 | End-to-end review | Three independent reviews and a verification pass. Moved the area from `umbel/` to `endpoints/umbel/` (D21 supersedes D6). Command names brought into AFD's rule (D22); glossary (D23); phase specification path and approval (D24); AFD-first map and prerequisites table (D25); open decisions numbered O1 to O5. Principal moved onto AFD's actor and credentials; event log defined as a journal projection; candidates moved from the host to the curator; permission filtering moved into the store query; memory classes clarified; Skills given three delivery paths; Open Knowledge Format updated to v0.2; library versions and Rust 1.97 recorded; retrieval figures, SharePoint, Codex, events and authorization claims corrected. #493 had merged at its earlier head, so these went in [#516](https://github.com/lushly-dev/afd/pull/516), merged |
| 2026-10-30 | Design session with the owner | Spaces added at the owner's request: isolated knowledge bases inside one deployment (principle 16, D26), with the three levels of coupling in the architecture's data and content section, per-space phases and glossary entries; O5 narrowed to tenancy beyond spaces. [#516](https://github.com/lushly-dev/afd/pull/516), merged |
| 2026-10-31 | Handoff check | Re-checked every document against `main` before handoff. Pull request states corrected: #493 and #516 merged, and D21 to D26 came in #516. [#518](https://github.com/lushly-dev/afd/pull/518) closed #460 and gave Rust the private in-process approval exchange, so the approval rows now name only the MCP approval relay, which language parity tracks without an issue yet. The rmcp prerequisite was removed: the crate commits no lock, and its 3.7 requirement already resolves 3.8.0. Links, anchors and every D, O, R, W and S reference resolve. [#519](https://github.com/lushly-dev/afd/pull/519) |
| 2026-10-31 | Execution-model decision | The owner decided O2: the hybrid strategy, with code mode later and optional, recorded as D27. O2 references in the proposal, architecture and this file now point at D27; the hybrid prerequisite is required for phase 0. Wrote the AFD [hybrid tool strategy proposal](../../../docs/features/active/hybrid-tool-strategy/hybrid-tool-strategy.proposal.md) with its status file; no `spec/` or code changes. Links and anchors checked. [#522](https://github.com/lushly-dev/afd/pull/522), open |
| 2026-10-31 | Loam cross-review | From the Loam proposal's end-to-end review: corrected the placement rule (D21 consequence, the architecture's repository placement and the follow-up) so Umbel's units join only the release inventory, since `architecture.json` lists foundation families only and endpoint manifests are classified by path; noted on O3 that Loam's app manifest will extend Umbel's; marked the resources prerequisite as shared with Loam; added "surface" to the glossary with Loam's different meaning. Checked and unchanged: D22's registry enforcement holds in Rust (`CommandRegistry::register` rejects invalid names); the architecture's one use of "handoff" is AFD's pattern. Loam keeps Umbel's event field names where the shapes overlap. [#522](https://github.com/lushly-dev/afd/pull/522), open |
| 2026-10-31 | Owner review of the blockers | The owner accepted every recommendation: #523 merged first and #526 rebased onto it; grouped becomes the Rust default; the hybrid proposal approved and moved to `docs/features/active/` with the six answers recorded; issues [#531](https://github.com/lushly-dev/afd/issues/531), [#532](https://github.com/lushly-dev/afd/issues/532) and [#533](https://github.com/lushly-dev/afd/issues/533) filed. [#522](https://github.com/lushly-dev/afd/pull/522) |
| 2026-10-31 | Owner review of the blockers | [#526](https://github.com/lushly-dev/afd/pull/526) rebased onto #523, integrated (structured results and the context hook on every route) and merged as `03815e26`. Of the phase 0 prerequisites, only the hybrid strategy and [#531](https://github.com/lushly-dev/afd/issues/531) remain. [#534](https://github.com/lushly-dev/afd/pull/534) |
| 2026-10-31 | Phase 0 blockers | [#531](https://github.com/lushly-dev/afd/issues/531) fixed in [#539](https://github.com/lushly-dev/afd/pull/539); the hybrid spec merged in [#538](https://github.com/lushly-dev/afd/pull/538). Only the hybrid implementation remains among the AFD prerequisites. [#540](https://github.com/lushly-dev/afd/pull/540) |
| 2026-10-31 | Phase 0 blockers | The hybrid strategy merged in TypeScript, Python and Rust ([#556](https://github.com/lushly-dev/afd/pull/556), [#555](https://github.com/lushly-dev/afd/pull/555), [#560](https://github.com/lushly-dev/afd/pull/560)). Every AFD prerequisite for phase 0 is done; phase 0 now waits only on its specification and the owner's approval (D24). [#562](https://github.com/lushly-dev/afd/pull/562) |
| 2026-10-31 | Phase 0 specification | Wrote the [phase 0 specification](phases/0-host-skeleton/spec.md) at the D24 path: one `umbel` package (library and binary) on the `afd` crate's `server` feature, MSRV 1.97, `umbel.yml`, a quarantined inventory unit with no route; the workspace layout, `umbel.toml` version 1 with spaces and the default space, the writer lock (since superseded, see the next row) and the doctor; six built-in commands with `workspace-show` and `event-list` first-class under the hybrid strategy; the CLI envelope and exit codes; the context hook and principal version 0; the journal projection, event and cursor version 0, provenance envelope version 0; the tests for the exit criterion and a six-step plan. Decisions D28 to D36, architecture amendments and the trajectory refresh in the same pull request; O3 left open. Spec in review, not approved |
| 2026-10-31 | Phase 0 specification review | Revised the specification in [#564](https://github.com/lushly-dev/afd/pull/564) after the independent review ("approve after must-fixes"), every finding checked against the code: any number of host processes per workspace under one append lock held across the journal and event appends, with tail-read sequence numbers, a pending-projection marker and catch-up before the next append, race-safe shared keys (D29 amended); a bearer token on loopback HTTP, path and host validation (D32 amended); no interim telemetry (D33 dropped); `DirectClient::with_interface` in AFD (D34 amended); the store criterion (D28 amended). New step 0, an AFD pull request for the shared `FileJournalSink` mode and the `DirectClient` interface; Umbel's own test drivers; trusted host-owned keys, `Host::context`, `Workspace::resolve_space`; cursor consumers and `v0:<space>:0`; doctor `skip`; CLI confirmations, reserved verbs and sanitized text; an explicit `architecture.json` unit and a repository-contract test; cursor schemas and example files. Spec in review, not approved |
| 2026-10-31 | Phase 0 approval and step 0 | The owner delegated approval of the phase 0 specification; it merged in [#564](https://github.com/lushly-dev/afd/pull/564) as `fb35d525`, with D28 to D36. Implemented step 0 in `packages/rust` ([#567](https://github.com/lushly-dev/afd/pull/567)): `FileJournalSink::shared`, `with_lock_timeout`, `lock`, `append_locked`, `JournalFileLock` and `JournalLockError` behind the `journal-file-shared` feature (Rust 1.89; the crate's minimum stays 1.82 for every other feature set), and `DirectClient::with_interface`; tests in `src/journal/tests.rs`, `tests/journal_shared.rs` and `tests/direct_approval.rs`; the two `rust.yml` legs for the new feature; the CHANGELOG, README and language parity rows. Spec status block updated. Merged as `045b6feb` |
| 2026-10-31 | Phase 0 step 1 | Scaffolded `endpoints/umbel/` ([#570](https://github.com/lushly-dev/afd/pull/570)): `Cargo.toml` (the single `umbel` package, library and binary, `afd` by path with `server` and `journal-file-shared`), `Cargo.lock` committed (and the `.gitignore` negation), `rust-toolchain.toml` (1.98.0), `clippy.toml`, a `src/lib.rs` that forbids unsafe code, a `src/main.rs` that prints `--version` and one smoke test; `.github/workflows/umbel.yml` (Linux and macOS, plus an MSRV 1.97 check); the quarantined `umbel` unit in `scripts/release/inventory.json` (private, no route), its explicit `architecture.json` unit and a repository-contract test; the `AGENTS.md` CI row, key rule and tree line. In review |
| 2026-10-31 | Phase 0 step 2 | Implemented the workspace in `endpoints/umbel/` ([#572](https://github.com/lushly-dev/afd/pull/572)): `src/workspace/` (discovery, configuration version 1, layout, keys, lock, `init`), `src/doctor.rs`, the six schemas and examples under `schemas/`, and the `workspace.rs`, `doctor.rs` and `schemas.rs` tests. Marked step 1 done ([#570](https://github.com/lushly-dev/afd/pull/570), `273e0160`, `umbel.yml` green on Linux, macOS and MSRV). Kept `reqwest` and `rustls` out of the lock. Spec amended in four small places |
| 2026-11-01 | Phase 0 step 3 | Implemented the registry and the CLI in `endpoints/umbel/` ([#573](https://github.com/lushly-dev/afd/pull/573)): `src/host/` (`HostBuilder`, `seal`, `Host`, `HostError`, `Workspace::resolve_space`), `src/commands/` (`workspace-show`, `space-list`, `workspace-doctor`), `src/middleware.rs` (event stamp, space check), `src/principal.rs`, `src/surfaces/` (the default first-class set, the MCP server `seal` validates), `src/logging.rs`, `src/cli/` (`run`, argument parsing, JSON and text output, the sanitizer, approvals and confirmations) and the `umbel` binary; tests `cli.rs`, `seal.rs`, `doctor_sealed.rs`, `trusted_keys.rs`. Spec amendments: `async-trait`, the event stamp outermost, public `cli::run` and `RESERVED_VERBS`, the `cli.rs` row. Marked step 3 done |
| 2026-11-01 | Phase 0 step 4 | Journal and events: the projecting sink, the pending marker and catch-up, `repair_events`, event and provenance version 0, cursors and consumers, `event-list`, `event-ack`, `event-rebuild`, and the multi-process tests, in [#574](https://github.com/lushly-dev/afd/pull/574). Amendments recorded in the specification's "Amendments from step 4" |
| 2026-11-01 | Phase 0 step 5 | Implemented the MCP surfaces in `endpoints/umbel/` ([#575](https://github.com/lushly-dev/afd/pull/575)): `src/surfaces/http.rs` (the exact-path service and the bearer layer), the context hook in `src/principal.rs`, `Host::mcp_server` and `Host::http_router`, `src/cli/serve.rs` (`umbel serve --stdio` and `--http`) and the binary's exit handling; tests `protocol_http.rs`, `protocol_stdio.rs`, `hybrid_surface.rs`, `context_hook.rs`, `approvals.rs`, `confirmations.rs`, `process.rs`, the MCP cases of `trusted_keys.rs` and the drivers in `tests/support/`. Rebased onto step 4: the MCP cases of `journal_events.rs`, `trusted_keys.rs` and `process.rs` are in, and `umbel serve` calls `Host::repair_events`. Found and fixed: a held `stdout` lock blocked the stdio transport's writer, and the runtime waited for an uncancellable stdin read at exit. Spec amended ("Amendments from step 5"); marked step 5 done. |
| 2026-11-01 | Phase 0 exit | Phase 0 done. Steps 0 to 5 merged in #567, #570, #572, #573, #574 and #575; step 6 added the README's build and run sections and re-ran the exit criterion on `main` at `8001fc74`: 261 tests passed, `umbel workspace doctor` on a fresh workspace healthy with 13 checks passing, `umbel.yml` green. Phase 1 is unblocked. [#580](https://github.com/lushly-dev/afd/pull/580) |
| 2026-11-01 | Phase 1 specification | Wrote the [phase 1 specification](phases/1-plugin-contract/spec.md) at the D24 path, in review: manifest, WIT world, protocol version, configuration version 2, grants and effects, the compiled, component and mounted loaders, packs, skills on three paths, AFD contexts and pipelines, the SDK, test kit, `plugin new` and `plugin check`, security with four trust-model points for the owner, the exit criterion with every test file, and a plan with an AFD step 0 (resources, the Skills extension, tool `_meta`, the todo library split). Closed O3 as D37 and D38; D39 to D50; architecture amendments (host services, manifest, WIT world, packs, the sandbox and MCP client rows, versioning, prerequisites, glossary) and the trajectory refresh with the new W17. Spec in review, not approved |
| 2026-11-01 | Phase 1 specification revision | Revised the phase 1 specification after the independent review of [#583](https://github.com/lushly-dev/afd/pull/583), each finding checked against the code first: recorded the owner's four trust-model decisions and the coordinator's allow-list rule (section 11, D42, D43); moved a mount's `url` and `bearer_env` to `umbel.toml`; gave pipelines the union of their steps' confirmation prompts; made mounted commands space-less unless `bind_space`; instance prefixes, transport-level result limits, load-time description scans, advertised and validation schemas; `--workspace` CI, `hello-mcp` location, rustls for HTTPS mounts, CI cost measures; restated W17 and D38 (wasmtime 48 is the constraint); split step 2 into 2a and 2b; added exit run 4 (the stock binary mounts the Rust todo backend) and the `plugin-isolation` job. Amended D38, D40, D42, D43, D47, D48, D50 and architecture section 8. Spec in review, not approved |
| 2026-11-01 | Phase 1 step 0a | Owner approval of the phase 1 specification recorded (merged in [#583](https://github.com/lushly-dev/afd/pull/583) as `880779ff`). Wrote the AFD feature proposal [MCP resources and skills](../../../docs/features/active/mcp-resources-skills/mcp-resources-skills.proposal.md) and its status, approved under the owner's delegation, and [`spec/mcp-resources.md`](../../../spec/mcp-resources.md) with `spec/mcp-resources.json`; amended `command-metadata.md`, `protocol-conformance.md`, `CHANGELOG.md` and the language parity matrix (Planned); reconciled the Skill Knowledge Layer; amended the phase 1 specification (digest key, step 0a path, status block) and the prerequisites rows of the Umbel and Loam architectures. Documents only |
| 2026-11-01 | Phase 1 step 1 | Manifest and configuration ([#606](https://github.com/lushly-dev/afd/pull/606)): the manifest, source resolution, pack and skill file checks, the three schemas with examples, configuration version 2 and `init`, the doctor's file-only plugin checks (replacing `plugins.none`), the WIT file, the version constants, `[workspace.lints]` and `--workspace` in `umbel.yml`. Resumed from a partial branch left by an agent whose disk filled; reviewed, merged with `main`, and verified (fmt, clippy `-D warnings`, 338 tests, the MSRV check). Amendment: `seal` still refuses an enabled plugin until step 2a |
| 2026-11-01 | Phase 1 step 0b | Rust MCP resources, the Skills extension, tool `_meta` and `register_with_schemas` in `packages/rust`, and the todo backend library split ([#608](https://github.com/lushly-dev/afd/pull/608)); `rmcp` 3.8.0 routed the extension's methods, so no spec stop. Seven spec clarifications (see the specification's "Amendments from step 0b"). New optional dependency `saphyr-parser` |
| 2026-11-01 | Phase 1 step 2a | Loader core and compiled plugins ([#610](https://github.com/lushly-dev/afd/pull/610)): the load sequence, grant gates, plugin gate, `plugin-list` and `plugin-show`, `umbel-sdk`, `umbel-plugin-hello`, the `testkit` feature and its tests. Resumed from a partial branch left by an agent whose disk filled; reviewed against the specification, merged with `main` (step 0b), fixed the clippy findings the earlier session never compiled. Origin `_meta` stays with step 3 (the plan assigns it there). Six amendments in the specification |
| 2026-11-01 | Phase 1 step 3 | Skills on three paths ([#611](https://github.com/lushly-dev/afd/pull/611)): validation through AFD's `SkillCatalog`, the host's MCP server serving every loaded skill on the Skills extension and as resources, `skill-list`, `skill-export` and the origin `_meta` on plugin tools; `SkillCatalog::entries()` made public in `packages/rust`. Eight amendments in the specification |
| 2026-11-01 | Phase 1 step 2b | Packs and per-space overrides, first-class suggestions, plugin contexts (`build_server` before `install_middleware`) and pipelines as data with the confirmation union ([#612](https://github.com/lushly-dev/afd/pull/612)): `plugins/pipelines.rs`, `PackSet` in `plugins/packs.rs`, the loader preparing every instance before it registers any, `surfaces::first_class_plan`, the doctor's sealed `plugins.first_class` and `plugins.pipelines`, `TestHostBuilder::pack_override`. Step 3 (skills) ran in parallel in the same crate. Eleven spec amendments, mostly shapes the specification left open |
| 2026-11-01 | Phase 1 step 5 | Mounted loader ([#613](https://github.com/lushly-dev/afd/pull/613)): rmcp client over stdio and Streamable HTTP with rustls, instance-only `url` and `bearer_env`, renaming, overrides, `bind_space`, advertised and validation schemas, the description scan, transport-level result limits, stamps, respawn, `hello-mcp`, the SDK's `mounted` feature and the tests. Started on a branch whose session ran out of disk; resumed, merged with step 2b, and verified in full. Ten amendments in the specification |
| 2026-11-01 | Phase 1 step 4 | Component loader ([#620](https://github.com/lushly-dev/afd/pull/620)): wasmtime 48.0.8 and `wasmtime-wasi` `p2` (facts checked against crates.io and the 48 tier table), the process-wide engine and linker, world identification from versions, the import check against grants, virtualized WASI 0.2 with the tape-backed clock and random, limits and their errors, the SDK's `component` feature, hello as a component, four fixture components, CI changes. The WIT file committed in step 1 did not parse (`list` is a keyword) and was corrected to `%list`. Seventeen spec amendments. Resumed in a worktree with about 13 GB free: a Rust build of wasmtime plus some 45 test binaries that each link it took the shared target directory to 14 GB, so no further Rust build ran after the full test and MSRV runs |
| 2026-11-01 | Phase 1 step 6 | Todo plugin and conformance job ([#622](https://github.com/lushly-dev/afd/pull/622)): `umbel-plugin-todo`, `umbel-todo`, the runner's `umbel` and `umbel-mounted` backends, the `todo-http` fixture, the Rust backend's `TOOL_STRATEGY`, `external-clients.sh`, and the `conformance` and `plugin-isolation` jobs. Amendments recorded in the specification's "Amendments from step 6" |
| 2026-11-01 | Phase 1 step 7 | `plugin new` and `plugin check` ([#623](https://github.com/lushly-dev/afd/pull/623)): the templates for every plugin kind, `plugin-new`, `plugin-check` with its internal temporary host (no `testkit`) and the explicit `spawn=true`, the README's "Write a plugin" section, and `plugin_scaffold.rs`, which builds the compiled and component scaffolds. Ten amendments in the specification's "Amendments from step 7"; the component template declares `packs`, `clock` and `log`, because the Rust component it builds imports no `wasi:random`. |
| 2026-11-01 | Phase 1 exit | Phase 1 done. Steps 0a to 7 merged in #583 (specification), #606, #608, #610, #611, #612, #613, #620, #622 and #623; step 8 added `tests/hello_three_ways.rs` (hello compiled, as a component and mounted, over MCP stdio and HTTP in both eras and through the CLI, with the fixed clock) and re-ran the exit criterion on `main` at `1cca6309` plus that test: `cargo test --locked --workspace` 550 passed, the todo conformance suite 34/34 against `umbel-todo` (legacy and modern) and against the stock `umbel` mounting the Rust backend (legacy and modern), the confirmations suite 5/5, the Rust backend 34/34 twice and 5/5, `afd validate --surface --strict` 0 errors and 0 warnings, 4 scenarios passed, `plugin check` healthy on each of the four `plugin new` templates, and `workspace doctor` on a fresh workspace with hello enabled 20 of 20 checks passing. Phase 2 is unblocked; its next gate is a specification written and approved (D24). [#624](https://github.com/lushly-dev/afd/pull/624) |
| 2026-11-01 | Phase 2 specification | Wrote the [phase 2 specification](phases/2-knowledge/spec.md) at the D24 path, in review: store traits and the embedded SQLite and tantivy backend shared by several processes, configuration version 3, access and reader filters, store grants with allow lists and derivation reads, manifest version 2, envelope and event version 1, `sources-filesystem` and the OKF container, the `knowledge` plugin (query syntax, ranking, chunking, locators, the structural graph with tree-sitter symbols, open and find, multi-space fusion), proposals and the verification lifecycle, output budgets AFD-first, the eval harness with a synthetic thousand-document fixture and a gate for optional lanes, security, the exit criterion with every test file, and a plan with step 0 in AFD. D51 to D67; architecture amendments (host services, store traits, envelope, libraries, data, phases 3 and 4 rows, prerequisites with the telemetry middleware moved to phase 5, glossary); trajectory refresh. Nine points for the owner in section 15. Spec in review, not approved |
| 2026-11-01 | Phase 2 specification revision | Revised the [phase 2 specification](phases/2-knowledge/spec.md#revision-2026-11-01) in [#625](https://github.com/lushly-dev/afd/pull/625), rebased onto `886c3b4d`, after the independent review and the owner's decisions of 2026-11-01. Checked every finding against the code and the tantivy 0.27.0, tantivy-query-grammar 0.27.0, tree-sitter 0.27.1 and tree-sitter-typescript 0.23.2 sources; none rejected. Query parsing through the grammar AST with bounded prefixes; tantivy features and explicit LZ4; indexers serialised by the writer with one-transaction graph batches and no lowering of `applied`; co-citation per citer; totals plus readable ids for sync, status and index, and `event-list` filtered by `access`; the gate's named allow-list; `confirm = "require-human"`; self-approval by actor; SDK method and error tables; plan dependencies, fixture counts, CI job, eval scope. Owner decisions recorded in section 15 and D53, D54, D62 and D67; D40 and D42 annotated; D51, D55, D57 to D60 and D64 to D66 amended; architecture phase 4 exit and prerequisites amended. Cited the phase 1 exit run, `umbel.yml` run 41298630706 on `main` at `886c3b4d`. Spec in review, not approved |
| 2026-11-01 | Phase 2 step 0a | Output budgets specified in AFD (documents only): the [proposal](../../../docs/features/active/output-budgets/output-budgets.proposal.md) and status in `docs/features/active/output-budgets/`, `spec/output-budgets.md` and `spec/output-budgets.json`, the `spec/` amendments and parity rows; the architecture's prerequisites row and the phase 2 specification's status block and "Amendments from step 0a" updated. No code |
| 2026-11-01 | Phase 2 step 0b | AFD Rust output budgets and the public frontmatter reader ([#PR_NUMBER](https://github.com/lushly-dev/afd/pull/PR_NUMBER)): `packages/rust` `output_budget.rs` and its wiring in the registry, journal, router, tool lists, `afd-detail` and `afd-help`; `OUTPUT_BUDGET_EXCEEDED` in the shared catalog and four constants; `afd::frontmatter` and the `frontmatter` feature; `tests/output_budget.rs` over `spec/output-budgets.json`. Nine amendments in the specification's "Amendments from step 0b" |
| 2026-11-01 | Phase 2 step 1 | Shapes and configuration ([632](https://github.com/lushly-dev/afd/pull/632)): the nine schemas of the specification's section 2 with examples (`tests/schemas.rs` extended: closed, every example validates and, for the configuration, manifest, envelope and event, opens in the host; each refusal the host makes is also the schema's); configuration version 3 (`tests/config_v3.rs`: collections, roots inside and outside, symbolic links, overlap, readers, groups, the store, versions 1 and 2 read as 3, `init` writes 3) and the doctor's `collections.roots`; manifest version 2 parsing (`tests/manifest_v2.rs`: the effects with and without their grants, `output_budget` compiled-only, `confirm = "require-human"`, version 1 unchanged); `store` a host domain; envelope and event version 1 projected from the gate's stamp, with version 0 lines read and rebuilt as written (`tests/journal_events.rs`). Eight amendments recorded in the specification ([Amendments from step 1](phases/2-knowledge/spec.md#amendments-from-step-1)). No store, index or plugin code. Two follow-ups for step 4 added |
