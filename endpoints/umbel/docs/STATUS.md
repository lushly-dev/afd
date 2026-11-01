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
| [Decision log](decisions.md) | D1 to D36; open decisions O1 and O3 to O5; O2 closed as D27 on 2026-10-31 | D1 to D12 in #491; D13 to D20 in #493; D21 to D26 and the O list in #516; D27 in [#522](https://github.com/lushly-dev/afd/pull/522); D28 to D36 accepted with the phase 0 specification, which the owner approved under the delegation of 2026-10-31 and which merged in [#564](https://github.com/lushly-dev/afd/pull/564) as `fb35d525`; D21, D28, D29, D31, D32, D33, D34, D35 and D36 were amended 2026-10-31 after its review | Same as above; 2026-10-31: D27's links and the O2 references re-checked; D28 to D36 merged with #564 |
| [Trajectory watch](trajectory.md) | Current as of 2026-10-30; rows carry R and W numbers; W1, W2, W5, W6, W12 and W15 refreshed 2026-10-31 for phase 0 | #493; corrections in #516; the refresh with the phase 0 specification, merged in #564 | External claims fact-checked against primary sources on 2026-10-30; the refreshed rows on 2026-10-31 |
| [Phase 0 specification](phases/0-host-skeleton/spec.md) | Approved 2026-10-31 under the owner's delegation (D24) after an independent review ("approve after must-fixes") and revision; merged in [#564](https://github.com/lushly-dev/afd/pull/564) as `fb35d525`; implementation in progress | [#564](https://github.com/lushly-dev/afd/pull/564), merged | 2026-10-31 against `main` at `472b5f68`: every finding checked against `packages/rust`, `packages/cli`, `packages/server`, `python/`, `spec/` and `scripts/`; links and anchors resolve |
| [Research](research.md), [Sources](sources.md) | Current as of 2026-10-30, with corrected figures | #491; corrections in #516 | Same as above |

## Phases

| Phase | State | Owner | Evidence | Next gate |
| --- | --- | --- | --- | --- |
| AFD prerequisites | Done for phase 0, including step 0 of the phase 0 plan (2026-10-31); the rows for phases 1 to 5 remain | Owner's sessions; step 0 by the phase 0 owning agent | [#523](https://github.com/lushly-dev/afd/pull/523), [#526](https://github.com/lushly-dev/afd/pull/526), [#539](https://github.com/lushly-dev/afd/pull/539), [#538](https://github.com/lushly-dev/afd/pull/538), [#555](https://github.com/lushly-dev/afd/pull/555), [#556](https://github.com/lushly-dev/afd/pull/556) and [#560](https://github.com/lushly-dev/afd/pull/560) and step 0, [#567](https://github.com/lushly-dev/afd/pull/567), merged | Later phases' rows of the prerequisites table, each before the phase that needs it |
| 0. Host skeleton | Done 2026-11-01: exit criterion met | Phase 0 owning agent | [Specification](phases/0-host-skeleton/spec.md) ([#564](https://github.com/lushly-dev/afd/pull/564)); steps [#567](https://github.com/lushly-dev/afd/pull/567), [#570](https://github.com/lushly-dev/afd/pull/570), [#572](https://github.com/lushly-dev/afd/pull/572), [#573](https://github.com/lushly-dev/afd/pull/573), [#574](https://github.com/lushly-dev/afd/pull/574), [#575](https://github.com/lushly-dev/afd/pull/575); exit run [run 41263228249](https://github.com/lushly-dev/afd/actions/runs/41263228249) | None |
| 1. Plugin contract | Not started; unblocked | None | None | Specification written and approved (D24); decides O3 |
| 2. Knowledge | Not started | None | None | Phase 1 exit criterion met |
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
  budgets (phase 2), the MCP approval relay in Rust (phase 4), token
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

Phases 1 to 7 have no detail yet; add a heading in this shape when one
starts. Phase 1 is next.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-10-30 | Design session | Land the phase 0 prerequisites in `packages/rust`; the lazy strategy, meta-tools and contexts are already parity item D1 and #465 is open | Done 2026-10-31: see the AFD prerequisites detail above |
| 2026-10-30 | Design session | Decide the execution model, open decision O2 | Done 2026-10-31: the owner chose the hybrid strategy, recorded as [D27](decisions.md) in [#522](https://github.com/lushly-dev/afd/pull/522), open until merged |
| 2026-10-30 | Design session | Decide the first external integration, open decision O1; it sets the connector contract | Open, owner's decision |
| 2026-10-30 | Design session | When crates land, add the units under `endpoints/umbel/` to the release inventory (`scripts/release/inventory.json`, D21); units start quarantined. Corrected 2026-10-31: `architecture.json` needs no change, since the boundary check classifies endpoint manifests by path | Open; specified 2026-10-31 as step 1 of the [phase 0 plan](phases/0-host-skeleton/spec.md#11-implementation-plan) (one unit, `umbel`, private, no route). Corrected again 2026-10-31 in the phase 0 review: `architecture.json` gains an explicit unit with `publicSurfaces`, as Botcore and Health have (D21, D35) |
| 2026-10-30 | Design session | Harness channels must negotiate MCP 2025-11-25 or earlier; keep the SDK's compatibility on push paths and re-check watchlist row W15 | Open |
| 2026-10-30 | Design session | Refresh the trajectory watchlist rows before each phase specification, in particular W2 and W3 ahead of 2027-03-30 | Open, recurring; refreshed 2026-10-31 for phase 0 |
| 2026-10-30 | End-to-end review | Write `docs/features` proposals, spec first, for the hybrid tool strategy, for resources, prompts and Skills over MCP in AFD servers reconciled with the Skill Knowledge Layer (shared with Loam, which also needs `ui://` resources), and for per-tool output budgets | Open. Hybrid tool strategy: [proposal](../../../docs/features/active/hybrid-tool-strategy/hybrid-tool-strategy.proposal.md) written and approved 2026-10-31; the other two not started |
| 2026-10-30 | End-to-end review | Reconcile vocabulary and the proposal record with the Agent Engine proposal, whose modules are Umbel's plugins and whose loop overlaps the curator | Open |
| 2026-10-30 | End-to-end review | Over MCP, the Rust approval middleware includes approval tokens by default; Umbel must turn that off on the MCP path. Re-checked 2026-10-31: [#518](https://github.com/lushly-dev/afd/pull/518) closed #460 with the private in-process exchange, and the default on the MCP path is unchanged | Open |
| 2026-10-31 | Owner review | Confirmation `requestState` is bound to the command and input, not the actor; with the context hook admitting several actors, one could replay another's confirmation | Issue [#532](https://github.com/lushly-dev/afd/issues/532); needed before phase 5 |
| 2026-10-31 | Owner review | A panicking command handler hangs the Rust MCP request | Done: fixed in [#539](https://github.com/lushly-dev/afd/pull/539) |
| 2026-10-31 | Phase 0 specification | AFD: let `DirectClient` take the CLI interface, so the Umbel CLI stops checking `expose.cli` itself (D34) | Superseded 2026-10-31: now step 0 of the [phase 0 plan](phases/0-host-skeleton/spec.md#step-0-the-afd-pull-request) |
| 2026-10-31 | Phase 0 specification | AFD: the Rust telemetry middleware, which replaces Umbel's interim one (D33); in the prerequisites table for phase 2 | Superseded 2026-10-31: D33 dropped, no interim middleware; the prerequisite row stays for phase 2 |
| 2026-10-31 | Phase 0 specification | A journal sink failure never changes a command's result, so a lock timeout or a full disk loses a journal entry and its event while the command succeeds; decide whether audited mutations need a fail-closed mode before phase 2 writes records | Open, phase 2 specification |
| 2026-10-31 | Phase 0 specification | Several stdio harnesses on one workspace contend for the writer lock (D29); consider `umbel serve --stdio --proxy <url>` | Superseded 2026-10-31: D29 amended, any number of processes share a workspace |
| 2026-10-31 | Phase 0 review | The phase 2 embedded store must support several processes on one workspace (for example SQLite in WAL mode, or LMDB), so D29's model survives; no single-writer daemon (D28) | Open, phase 2 specification |
| 2026-10-31 | Phase 0 review | AFD: an accessor for `McpServer`'s default instructions, so a host can add a line without replacing them | Open, AFD, if wanted |
| 2026-10-31 | Phase 0 specification | Windows in the `umbel.yml` matrix (key permissions, file locks, signals) | Open, phase 7 |
| 2026-10-31 | Phase 0 specification | An external client check, `afd validate` against `umbel serve --http`, in CI; the client must send the bearer token | Open, phase 1 |
| 2026-11-01 | Step 4 | For the step 5 agent: the MCP cases of `journal_events.rs`, `trusted_keys.rs` and `process.rs`, and `Host::repair_events` at the start of `umbel serve` | Done 2026-11-01 in [#575](https://github.com/lushly-dev/afd/pull/575) |
| 2026-11-01 | Phase 0 step 4 | AFD's Rust schema validation has no `pattern` keyword, so a schema using it is refused at registration and the handler checks the `consumer` pattern itself (spec "Amendments from step 4"); decide whether AFD adds `pattern` across languages (see `spec/validation.md`) | Open |

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
| 2026-11-01 | Phase 0 exit | Phase 0 done. Steps 0 to 5 merged in #567, #570, #572, #573, #574 and #575; step 6 added the README's build and run sections and re-ran the exit criterion on `main` at `8001fc74`: 261 tests passed, `umbel workspace doctor` on a fresh workspace healthy with 13 checks passing, `umbel.yml` green. Phase 1 is unblocked. [#576](https://github.com/lushly-dev/afd/pull/576) |
