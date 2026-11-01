# Phase 1 specification: plugin contract

| Field | Value |
| --- | --- |
| Phase | 1, plugin contract ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | Repository owner approves; the phase 1 owning agent writes and implements |
| Read first | [STATUS.md](../../STATUS.md), then the [architecture](../../architecture.md), the [decision log](../../decisions.md) and the [phase 0 specification](../0-host-skeleton/spec.md), whose shapes this one extends |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request, as phase 0's steps did |

## Status

- **State:** specification in review, revised, not approved. Written
  2026-11-01 by the phase 1 owning agent, after phase 0's exit criterion was
  met on `main` at `8001fc74` (recorded by [#580](https://github.com/lushly-dev/afd/pull/580)).
  It closes open decision O3 as [D37 and D38](../../decisions.md) and adds
  D39 to D50; the architecture amendments they need are in the same pull
  request. Approval is the owner's (D24).
- **Revised 2026-11-01** after the independent review of
  [#583](https://github.com/lushly-dev/afd/pull/583): the owner decided the
  four trust-model points (recorded in [section 11](#11-security), D42 and
  D43); must-fixes M1 to M7 and the should-fixes and nits applied, each
  checked against the code it cites (see [Revision 2026-11-01](#revision-2026-11-01)).
- **Last verified:** 2026-11-01 against `main` at `393d30aa`. Evidence, read
  in `packages/rust`: `CommandDefinition` (`src/commands.rs`: no `_meta`,
  origin or source field; not `Clone`), `CommandRegistry::register` and
  `register_with_schema` (the name rule
  `^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$`, a duplicate is a plain `String`
  error, no unregister), `CommandHandler` (`async_trait`, `execute(input,
  context)`), `CommandContext::clock().now()` (epoch milliseconds) and
  `random().next()` (an `f64`), which the journal recorder wraps so the tape
  records every read (`src/journal/recorder.rs`), `replay_journal` (no
  replayable marker; other nondeterminism shows as divergence),
  `registry.get_tool` (individual and hybrid tools carry only
  `_meta.approval`), `McpServer` (tools only: no resources, prompts or
  extension methods; `with_contexts` takes `ContextConfig`), no MCP client in
  the crate, `execute_pipeline` (`src/pipeline.rs`), `CONTRACT_VERSION`
  `1.0-rc`. In `endpoints/umbel`: `HostBuilder::register`, `seal`'s order,
  `surfaces::default_first_class_tools`, `PluginsConfig` (`enabled` must be
  empty) and the doctor's `plugins.none`. In `packages/examples/todo`:
  `dx/run-conformance.ts` (backends hardcoded; the Rust backend over
  Streamable HTTP with `/health` polled; modes `legacy`, `auto` and
  `modern`), `dx/conformance.ts` (`wireProblems`: camelCase keys, no `null`,
  `isError` equal to `!success`), and the Rust backend (a binary crate with
  no `lib.rs`; `register_commands` registers eleven commands; `todo-clear`
  declares a confirmation prompt). In `endpoints/botcore`: `CommandPolicy`
  (`effects`, `capabilities`). [Plugin Discovery](../../../../../docs/features/proposed/plugin-discovery/plugin-discovery.spec.md)
  and the [Skill Knowledge Layer](../../../../../docs/features/proposed/skill-knowledge-layer/skill-knowledge-layer.spec.md)
  read in full. Trajectory rows re-checked against primary sources (see
  [Trajectory refresh](#trajectory-refresh)). Relative links and anchors in
  this file resolve.
- **Revision evidence, 2026-11-01**, read on `main` at `cdfbbfb7`:
  `endpoints/umbel/src/host/mod.rs` (`has_space_property` marks any command
  whose input schema has a `space` property as a space command;
  `install_middleware` snapshots `registry.list()` before
  `surfaces::mcp::build_server`), `src/middleware.rs` (middleware cannot change
  handler input), `src/cli/mod.rs` (`cli::run` already takes a `configure`
  hook), `Cargo.toml` (lints are package-level; no `[workspace.lints]`) and
  `.github/workflows/umbel.yml` (no `--workspace`); in `packages/rust`,
  `src/server/confirmations.rs` (confirmations are checked at the router,
  `afd-batch` and `afd-pipe` included) and `src/server.rs`
  (`McpServer::with_contexts` registers `afd-context-*` into the registry); in
  `rmcp` 3.8.0, its `reqwest` feature (the one that enables `reqwest/rustls`),
  `TokioChildProcess` (no `kill_on_drop` option) and
  `DEFAULT_AUTO_DISCOVER_TIMEOUT` (10 s).
- **Approved 2026-11-01** by the owner (D24) and merged in
  [#583](https://github.com/lushly-dev/afd/pull/583) as `880779ff`; the
  state line above is kept as written and superseded by this one.
- **Step 0a done 2026-11-01** (documents only): the AFD proposal
  [MCP resources and skills](../../../../../docs/features/active/mcp-resources-skills/mcp-resources-skills.proposal.md),
  approved under the owner's delegation of 2026-10-31 and placed in
  `docs/features/active/` (not `proposed/`, as step 0a first said), with
  [`spec/mcp-resources.md`](../../../../../spec/mcp-resources.md), its cases
  in `spec/mcp-resources.json`, the `command-metadata.md`,
  `protocol-conformance.md` and `CHANGELOG.md` amendments and parity rows
  marked Planned. Verified against `main` at `880779ff`. It made the choices
  this plan left open, listed in the proposal's
  [choices](../../../../../docs/features/active/mcp-resources-skills/mcp-resources-skills.proposal.md#choices-this-proposal-made);
  one changes this document: a resource's digest goes under AFD's
  `_meta["dev.afd/digest"]` as `sha256:<hex>`, the Skills extension's format,
  so section 8.3 no longer mints `dev.umbel/sha256` (see
  [Amendments from step 0a](#amendments-from-step-0a)).
- **Step 1 done 2026-11-01** ([#606](https://github.com/lushly-dev/afd/pull/606)):
  manifest and configuration, as the step 1 row of the
  [plan](#14-implementation-plan) lists them. One amendment, in
  [Amendments from step 1](#amendments-from-step-1).
- **Step 0b done 2026-11-01** ([#608](https://github.com/lushly-dev/afd/pull/608)):
  MCP resources, the Skills extension, per-command tool `_meta` and
  `register_with_schemas` in `packages/rust`, and the Rust todo backend split
  into a library. Seven amendments, in
  [Amendments from step 0b](#amendments-from-step-0b).
- **Step 2a done 2026-11-01** ([#610](https://github.com/lushly-dev/afd/pull/610)):
  the loader core and compiled plugins, as the step 2a row of the
  [plan](#14-implementation-plan) lists them. The amendments are in
  [Amendments from step 2a](#amendments-from-step-2a).
- **Step 2b done 2026-11-01** ([#612](https://github.com/lushly-dev/afd/pull/612)):
  packs with per-space overrides, first-class suggestions, plugin contexts
  with `build_server` before `install_middleware`, and pipelines as data with
  the confirmation union, as the step 2b row of the plan lists them. The
  amendments are in [Amendments from step 2b](#amendments-from-step-2b).
- **Step 3 done 2026-11-01** ([#611](https://github.com/lushly-dev/afd/pull/611)): skills on three paths and the origin
  `_meta` of plugin tools, as the step 3 row of the [plan](#14-implementation-plan)
  lists them. The amendments are in [Amendments from step 3](#amendments-from-step-3).
- **Step 5 done 2026-11-01** ([#613](https://github.com/lushly-dev/afd/pull/613)): the mounted loader, as the step 5 row of
  the [plan](#14-implementation-plan) lists it. The amendments are in
  [Amendments from step 5](#amendments-from-step-5).
- **Done:** this specification, approved and merged; steps 0a, 0b, 1, 2a, 2b, 3 and 5.
- **Not done:** the Umbel steps 4 and 6 to 8 of the
  [plan](#14-implementation-plan); the exit criterion.
- **Follow-ups not yet issues:** listed in [Follow-ups](#follow-ups) and
  mirrored in [STATUS.md](../../STATUS.md#follow-ups-not-yet-issues).

## What this phase serves

The phase 1 row of the architecture: *manifest, grants and the host services
catalog, the WIT world, three loader kinds, skills on all three delivery
paths, plugin new and plugin check, the test kit, the hello plugin.* Exit
criterion: *hello loads compiled, as a component and mounted; a second plugin
lands with no host change; the 34-case todo conformance suite passes in
legacy and modern modes with the todo example loaded as a plugin.* It is item
2 of the proposal's [first proof](../../proposal.md#first-proof) and item 5
(a second plugin added without changing the host).

| Principle | How phase 1 serves it |
| --- | --- |
| 1. Empty host | The host still ships no domain command; hello and todo are plugins in their own crates, and the stock `umbel` binary compiles in neither |
| 2. Plugins are the unit | One manifest for every kind; contributions are commands, packs, skills, AFD contexts and pipelines as data; no plugin reaches another |
| 3. Everything is a command | Every plugin contribution that runs is a command in the one registry; the plugin tooling is built-in commands (`plugin-list`, `plugin-show`, `plugin-check`, `plugin-new`, `skill-list`, `skill-export`) |
| 5. Content lives in the workspace | Plugin sources, instance configuration and pack overrides are in the workspace; plugins ship defaults |
| 6. Deterministic core | Components read time and randomness only from the command context, so the journal replays them; mounted calls are marked as recorded only |
| 9. Stored content is untrusted input | Components run sandboxed with no network, filesystem or environment; mounted results and every skill are labeled untrusted; no caller credential reaches a plugin |
| 11. Stateless and horizontal | A fresh component instance per call; no plugin state survives a call except inside a compiled-in plugin or behind a mounted server, and both are declared as the `plugin-state` effect |
| 12. Small surfaces, measured | Plugins suggest first-class tools; the deployer's list wins; the cap of 8 holds |
| 13. Same interface at every scale | The plugin contract does not depend on the profile |
| 15. AFD first | The manifest follows Plugin Discovery's fields; effects follow Botcore's command policy; resources, the Skills extension and tool `_meta` land in AFD first (step 0); scenarios and surface validation run AFD's own tools |
| 16. Spaces do not mix | A plugin instance is enabled per space; every grant is scoped to its spaces; packs are overridden per space |

Decisions served: D1, D2, D3, D4, D8, D11, D18, D19, D20, D21, D22, D23,
D24, D25, D26, D27, D29, D31, D35 and D36, and the new D37 to D50 made here.
Open decisions: **O3 closes** as D37 (the manifest) and D38 (the WIT world).
O1 stays open and is not touched: the mounted loader below is a mechanism, not
the connector contract that federation needs (see
[section 12](#12-out-of-scope-and-the-seams-reserved)). O4 and O5 do not touch
phase 1.

## Trajectory refresh

Refreshed 2026-11-01 for the rows phase 1 depends on, against primary sources
(crates.io, the GitHub releases of each project, the MCP specification
repository at its 2026-10-31 head, docs.rs). Two findings change the design,
both recorded as decisions: wasmtime's support windows favour its long-term
line (D39), and that line, 48, does not support WASI 0.3's async component
model as a stable feature, so world 1 targets WASI 0.2 (D38; restated
2026-11-01 after review: the runtime, not the Rust target, is the binding
constraint).

| Row | Checked against | Finding on 2026-11-01 | Effect on phase 1 |
| --- | --- | --- | --- |
| W1 release cycle | SEP-3398 (accepted 2026-10-14); roadmap, last updated 2026-08-22 | Unchanged: the next revision is 2027-03-30, which SEP-3398 itself calls subject to confirmation in the transition calendar; 2026-07-28 is still the latest release | Phase 1 pins MCP 2026-07-28 and keeps the 2025-11-25 era, on the server and in the mounted loader's client |
| W2 MCP Events, SEP-3415 | The pull request | Still open, not a draft, review required, last updated 2026-10-31; error codes provisional; no SDK reference implementation | The `events` grant reads Umbel's own event log; nothing is pushed |
| W15 Claude Code channels | Channels documentation | Unchanged since 2026-10-31 | No effect; phase 1 adds no push path |
| W16 Skills over MCP | The extension overview, SEP-2640 and the client matrix (changed 2026-10-30) | SEP-2640 is **Final**; the extension id is `io.modelcontextprotocol/skills`, with `skills/list`, `skills/get` and `resources/read`, and optional `resources/directory/read`. Full client support: MCPJam, mcpc and fast-agent (fast-agent moved to full in the matrix's 2026-10-30 change); partial: ChatGPT and the MCP Inspector; none in Claude, Claude Code, Cursor, VS Code, Goose or Microsoft 365 Copilot | The extension is final, so AFD can implement it (step 0); resources and the CLI export stay required delivery paths |
| New W17 WASI 0.3 and `wasm32-wasip3` | WASI releases; wasmtime 46 release notes; the Rust platform-support pages | WASI 0.3.0 was ratified on 2026-06-11 (latest 0.3.2, 2026-10-13); wasmtime supports it by default since 46.0.0 (2026-06-22), but the 48 long-term line Umbel takes (D39) does not list `component-model-async` in its stability tiers, and wasmtime-wasi 48 has WASI 0.3 (`p3`) only as an opt-in feature; the Rust `wasm32-wasip3` target is Tier 3 on stable 1.99 and becomes Tier 2 with 1.100 (2026-11-12); `wasm32-wasip2` is Tier 2 | WIT world 1 targets WASI 0.2 (D38). **The binding constraint is the runtime, not the target:** world 2.0.0 waits for a wasmtime long-term line with `component-model-async` in its supported tiers (about wasmtime 60, around 2027-08) or an owner decision to leave the long-term line (revised 2026-11-01) |
| Library row: wasmtime | crates.io; the release and stability documents at v50.0.1 | 50.0.1 (2026-10-29, a security release, MSRV 1.97); the same day 49.0.5, 48.0.8 and 36.0.20; long-term lines are 48 and 36, each supported for 24 months, others for 2; fuel, epoch interruption, `ResourceLimiter` and `StoreLimits` unchanged | Umbel takes the 48 line (D39) |
| Library row: wit-bindgen and guest tools | crates.io, npm, PyPI; the Component Model book | wit-bindgen 0.63.0 (2026-10-14); `cargo-component` is being deprecated in favour of the `wasm32-wasip2` target with wit-bindgen; componentize-py 0.25.1 (2026-09-12); jco 1.40.0 (2026-10-28); componentize-js 0.23.0 (2026-09-21) | Rust components build with `cargo build --target wasm32-wasip2` and wit-bindgen; the guide names componentize-py and jco for Python and JavaScript, untested in phase 1 |
| Library row: `rmcp` | crates.io; docs.rs at 3.8.0 | 3.8.0 (2026-10-26, MSRV 1.88); `client`, `transport-child-process` and `transport-streamable-http-client-reqwest` exist and are off by default | The mounted loader enables them (D43) |

## Terms

Terms are the [architecture's glossary](../../architecture.md#12-glossary).
This phase adds these, entered in the glossary in this pull request:

| Term | Meaning |
| --- | --- |
| Manifest | A plugin's `umbel-plugin.toml`: identity, version, protocol version, contributions, grants and configuration schema (D37) |
| Plugin kind | How a plugin's code runs: `compiled` (a Rust crate linked into the host binary), `component` (a WebAssembly component), `mounted` (an external MCP server) or `pack` (no code: packs and skills only) |
| Plugin instance | One entry of `plugins.enabled`: a plugin, its source, its configuration and its spaces. Its id is the entry |
| Plugin protocol version | The version of the contract between the host and a plugin: the manifest version, the WIT world's major version and the grant semantics together (D40) |
| Host domain | A first name segment the host owns, which no plugin command may use |
| Effect | What a command may change, declared per command in the shape of Botcore's command policy |
| Mount | A mounted plugin's connection to its MCP server, and the prefix its tools are renamed under |
| Pack override | A pack directory in a space that replaces a plugin's default pack of the same id in that space |

## 1. Crate layout

The Cargo workspace rooted at `endpoints/umbel/` (D35) gains three members
(D48), and the small component fixtures of the tests (section 13). Every member is `publish = false`, edition 2024, MSRV 1.97, and
inherits the workspace lints (see **Lints** below).

```text
endpoints/umbel/
├── Cargo.toml                  # [package] umbel + [workspace] members
├── Cargo.lock
├── schemas/                    # + plugin-manifest.v1.json, pack-manifest.v1.json, workspace-config.v2.json
├── wit/
│   └── umbel-plugin-1.0.0/
│       └── world.wit           # WIT world 1.0.0 (section 4); the file is normative
├── src/
│   ├── plugins/                # the loader: manifest, sources, grants, packs, skills, the three kinds
│   │   ├── manifest.rs
│   │   ├── source.rs
│   │   ├── grants.rs           # the host services and their gates
│   │   ├── packs.rs
│   │   ├── skills.rs
│   │   ├── compiled.rs
│   │   ├── component.rs        # feature `component`
│   │   ├── mounted.rs          # feature `mounted`
│   │   └── pipelines.rs
│   ├── commands/               # + plugin_list, plugin_show, plugin_check, plugin_new, skill_list, skill_export
│   ├── templates/              # plugin-new templates, embedded with include_str!
│   └── testkit/                # feature `testkit` (section 10)
├── sdk/                        # crate `umbel-sdk`: the portable plugin API (section 5)
├── plugins/
│   ├── hello/                  # crate `umbel-plugin-hello`: lib, component, and the `hello-mcp` binary
│   └── todo/                   # crate `umbel-plugin-todo`: the todo example as a compiled plugin, and `umbel-todo`
└── tests/
```

`Cargo.toml` changes:

```toml
[workspace]
# Step 6 adds "plugins/todo"; it is not a member before the crate exists.
members = [".", "sdk", "plugins/hello", "tests/fixtures/components/*"]

[workspace.lints.rust]
unsafe_code = "forbid"
missing_docs = "warn"
unreachable_pub = "warn"

[workspace.lints.clippy]
all = { level = "warn", priority = -1 }
unwrap_used = "warn"
expect_used = "warn"

[lints]
workspace = true          # replaces the package-level [lints.*] tables of phase 0

# Cranelift and wasmtime dominate test time when unoptimized; the tests compile components.
# The test profile inherits these from dev.
[profile.dev.package.cranelift-codegen]
opt-level = 2
[profile.dev.package.wasmtime]
opt-level = 2

[features]
default = ["cli", "component", "mounted"]
cli = ["dep:clap"]
# The WebAssembly component loader.
component = ["dep:wasmtime", "dep:wasmtime-wasi"]
# The mounted MCP server loader.
mounted = ["dep:rmcp"]
# TestHost and its drivers, for plugin crates' tests (section 10).
testkit = ["dep:tempfile", "dep:rmcp"]

[dependencies]
# + the existing dependencies of phase 0
jsonschema = { version = "0.60", default-features = false }   # moved from dev-dependencies: plugin configuration
# `reqwest` is rmcp's feature that enables `reqwest/rustls`; without it HTTPS mounts have no TLS.
rmcp = { version = "3.7", optional = true, default-features = false, features = [
  "client", "server", "transport-io", "transport-child-process", "transport-streamable-http-client-reqwest",
  "reqwest",
] }
tempfile = { version = "3", optional = true }
wasmtime = { version = "48.0.8", optional = true, default-features = false, features = [
  "runtime", "cranelift", "component-model", "std", "parallel-compilation",
] }
# Its WASI 0.2 implementation, `wasmtime_wasi::p2`, and nothing else (no `p3`). `p2` enables
# `wasmtime/async`. Step 4 trims the wasmtime feature list to the smallest set that builds.
wasmtime-wasi = { version = "48.0.8", optional = true, default-features = false, features = ["p2"] }
```

Rules:

- **Versions.** wasmtime and wasmtime-wasi stay on the 48 long-term line
  (D39): Dependabot raises the patch within it; moving to the next long-term
  line (60) is a pull request that re-runs every component test. `rmcp` keeps
  the `afd` crate's `3.7` requirement so one copy is built.
  `transport-streamable-http-client-reqwest` pulls `reqwest` without any TLS
  backend; rmcp's own `reqwest` feature is what enables `reqwest/rustls`, so
  the list above names it, and step 5 tests one mount over HTTPS against a
  local TLS server (`plugin_mounted.rs`). `reqwest` and `rustls`, which phase
  0 kept out of the lock, enter it for HTTP mounts (corrected 2026-11-01 after
  review). The lock is re-committed in each step that changes it.
- **`unsafe` stays forbidden in the host.** wasmtime's
  `Component::deserialize` is `unsafe`, so phase 1 compiles each component at
  `seal` and caches nothing (see [Follow-ups](#follow-ups)).
- **Lints.** Phase 0's lints are package-level `[lints.*]` tables; there is
  no `[workspace.lints]` yet. Step 1 moves them into `[workspace.lints]` as
  above, and every member sets `lints.workspace = true`. The one scoped
  exception is wit-bindgen's generated glue, which uses `unsafe` (exported
  symbols, canonical ABI): `export_component!` expands
  `wit_bindgen::generate!` inside the plugin crate, so a crate built as a
  component (`umbel-sdk` under `component`, `umbel-plugin-hello`, the fixture
  components, and `plugin new`'s component template) does not inherit
  `unsafe_code`; its `Cargo.toml` copies the workspace lints with
  `unsafe_code = "deny"` instead of `forbid`, and the macro wraps the
  generated module in `#[allow(unsafe_code)]`, which `deny` permits and
  `forbid` would not. Hand-written `unsafe` stays refused in those crates.
- **Embedders** choose loaders with `default-features = false` plus
  `component` or `mounted`. A manifest of a kind whose feature is off fails
  with `PLUGIN_KIND_UNAVAILABLE`.
- **`umbel.yml`.** The root `Cargo.toml` has both `[package]` and
  `[workspace]`, so a bare `cargo test` or `cargo clippy` in
  `endpoints/umbel/` covers only the root package. Every cargo step passes
  `--workspace`: `cargo clippy --locked --workspace --all-targets`,
  `cargo test --locked --workspace`, and the MSRV job's
  `cargo +1.97.0 check --locked --workspace --all-targets` (which now
  compiles wasmtime and Cranelift too). The fixture components are named
  `umbel-fixture-*` and are built only for `wasm32-wasip2`, so the
  host-target steps add `--exclude 'umbel-fixture-*'`; a separate clippy
  step lints them with `--target wasm32-wasip2`. It also gains the library-only
  clippy leg per feature (`-p umbel --lib --no-default-features --features
  component`, `--features mounted`), a step that builds the wasm artefacts
  before the tests (section 13), and a `conformance` job (section 13). Its
  path filter adds `packages/examples/todo/**`.
- **Where test binaries come from.** A host test cannot use another crate's
  `CARGO_BIN_EXE_*` (Cargo sets it only for the package's own binaries). So
  `umbel.yml` builds `hello-mcp` before `cargo test` with
  `cargo build --locked -p umbel-plugin-hello --features mounted --bin
  hello-mcp`, and the host tests find it at
  `$CARGO_TARGET_DIR/debug/hello-mcp` (default `endpoints/umbel/target/`),
  through one helper in `tests/support/` that fails with that build command
  in its message when the file is missing, as the component fixtures do.
- **CI cost.** wasmtime and Cranelift are heavy to build and to run
  unoptimized: the test and dev profiles optimize `cranelift-codegen` and
  `wasmtime` (above); the component tests share one `Engine` and compile each
  fixture once per test binary (a `OnceLock` in `tests/support/`);
  `umbel.yml`'s `timeout-minutes` rises to 45 for the check job and 30 for
  the MSRV job; `rust-toolchain.toml` adds `targets = ["wasm32-wasip2"]`, so
  `rustup toolchain install` installs it with the toolchain. Step 4 updates
  the Umbel row of the CI table in `AGENTS.md` (the wasm build, `--workspace`,
  the `conformance` job of step 6).
- **Release inventory.** The `umbel` unit gains three private distributions,
  `umbel-sdk`, `umbel-plugin-hello` and `umbel-plugin-todo`, with their
  manifests; the unit stays quarantined with no route. `architecture.json`
  gains an explicit endpoint unit for each new manifest, with
  `publicSurfaces` (`rust-library` for the SDK and both plugins;
  `bin:hello-mcp`; `bin:umbel-todo`), and the `umbel` unit's list adds
  `workspace-config-2`, `plugin-manifest-1`, `pack-manifest-1`,
  `plugin-protocol-1` and `wit:umbel:plugin@1.0.0`. The repository-contract
  test pins the new distributions as private.
- **The todo plugin's edge.** `umbel-plugin-todo` depends on the Rust todo
  backend by path. `architecture.json` excludes `packages/examples`, so the
  boundary check sees no unit there; step 6 runs `pnpm check` to confirm, and
  if the check refuses the edge the step stops and amends this section.

## 2. The manifest

**Closes O3** (D37). Every plugin, of every kind, has exactly one manifest,
`umbel-plugin.toml`, at the root of its source. TOML matches `umbel.toml`
and Cargo; the file is read as JSON for validation against
`schemas/plugin-manifest.v1.json`, a closed JSON Schema 2020-12 file under the
phase 0 rules (D36). A compiled plugin embeds the same file with
`include_str!`.

### Fields

```toml
manifest_version = 1          # required; this host reads 1
protocol = 1                  # required; the plugin protocol version (D40)

[plugin]                      # required
id = "hello"                  # required; ^[a-z][a-z0-9]{0,31}$; the default instance id
title = "Hello"               # required; 1 to 80 characters
version = "0.1.0"             # required; semantic version
description = "One command, one pack, one skill: the reference plugin."   # required; 1 to 500 characters
kind = "compiled"             # required: compiled | component | mounted | pack
domains = ["hello"]           # required for every kind but pack; the first name segments its commands use
homepage = "https://..."      # optional; https URL
license = "MIT"               # optional; SPDX expression

[component]                   # required when kind = "component", refused otherwise
path = "hello.wasm"           # relative to the plugin root; at most 32 MiB
# No `world` key: the host reads the component's world from its own export and import
# versions (section 4), so a manifest cannot disagree with the binary (revised 2026-11-01).

[mount]                       # required when kind = "mounted", refused otherwise (section 6.3);
                              # where and with what credential is the deployer's, in umbel.toml

[[grants]]                    # optional; the host services the plugin uses (section 7)
name = "packs"
required = true               # default true; an optional grant may be denied without failing the load
reason = "Reads the salutation from the greetings pack."   # required; shown to the deployer

[[commands]]                  # compiled and component only; mounted commands come from tools/list
name = "hello-greet"          # required; AFD's rule; its first segment is one of `domains`
description = "Greet someone, in a space, with the pack's salutation."   # required
effects = ["inspect"]         # required, non-empty (section 7.3)
input_schema = "schemas/hello-greet.input.json"   # required: a path, or an inline table
returns = "schemas/hello-greet.output.json"       # optional, recommended: a path or an inline table
category = "hello"            # optional
tags = ["example"]            # optional
version = "1.0.0"             # optional
contexts = ["hello"]          # optional; AFD contexts this command belongs to
first_class = true            # optional, default false; a suggestion (section 8.4)
confirm_prompt = "..."        # optional
destructive = false           # optional
approval = "none"             # optional: none (default) | required
execution_time = "instant"    # optional: instant | fast | slow | long-running
expose = { mcp = true, agent = true, cli = true, palette = false }   # optional; these are the plugin defaults
examples = [{ title = "Greet Ada", input = { name = "Ada" } }]       # optional

[[contexts]]                  # optional; AFD contexts the plugin contributes
name = "hello"                # AFD's context name rule; must start with one of `domains`
description = "Greeting commands."
triggers = ["greet"]          # optional
priority = 0                  # optional

[[pipelines]]                 # optional; pipelines as data (section 8.5)
name = "hello-twice"
description = "Greet two people in one call."
effects = ["inspect"]
input_schema = { type = "object", properties = { first = { type = "string" }, second = { type = "string" } }, required = ["first", "second"], additionalProperties = false }
steps = [
  { command = "hello-greet", input = { name = "$input.first" }, as = "one" },
  { command = "hello-greet", input = { name = "$input.second" }, as = "two" },
]

[[packs]]                     # optional (section 8.2)
id = "greetings"              # ^[a-z][a-z0-9-]{0,62}$
path = "packs/greetings"

[[skills]]                    # optional (section 8.3)
name = "hello-guide"          # must start with `<plugin id>-` or equal the plugin id
path = "skills/hello-guide"

[config]                      # optional
schema = "config.schema.json" # JSON Schema 2020-12, closed; defaults in it are applied
```

Validation, each a `PLUGIN_MANIFEST_INVALID` naming the manifest path and the
key, at load and by `plugin-check`:

- The file parses, `manifest_version` is 1 and `protocol` is 1; another value
  of either is `PLUGIN_PROTOCOL_UNSUPPORTED`, naming what this host serves.
- Unknown keys are refused; the reserved keys below are refused with a
  message naming the version that defines them.
- Every command name passes AFD's rule (`validate_command_name`) and starts
  with a declared domain; no domain is a host domain (`workspace`, `space`,
  `event`, `plugin`, `skill`, `afd`) or a reserved CLI verb.
- Every schema (input, returns, configuration) is a JSON object; input
  schemas are `type: object` and must pass the `afd` crate's checker, which
  refuses keywords it does not support (`pattern`, among others, per the
  phase 0 amendments from step 4); a path is relative to the plugin root,
  stays inside it (no `..`, no absolute path, symlinks resolved and checked)
  and names a JSON file.
- `effects` is non-empty, from the catalog (section 7.3), and `inspect`
  appears alone or not at all.
- Context, pack and skill ids are unique in the manifest; pipeline names
  follow the command rules.
- Paths for `component.path`, packs and skills exist and stay inside the
  plugin root.
- A mount's `url` or `bearer_env` in the manifest is refused: they belong to
  the deployer's instance configuration (section 9.1; M1 of the 2026-11-01
  review).

**Reserved** (D36's rule: named now, refused by version 1): `ui` (Loam's UI
contributions: surfaces, layout preset, document types; see below),
`connectors` and `backends` (contributions the architecture lists for later
phases: federation's connector contract after O1, the store traits in phase
6), `dependencies` (never: D3), `signature` (W9), `scopes` (phase 5's
per-command scopes), `on_conflict` (Plugin Discovery's conflict option;
version 1 fixes it to `error`) and, in a `[[grants]]` entry, `allow` (the
per-instance allow-list that any future write, `http` or `secrets` grant will
require; section 7.2).

### How it follows Plugin Discovery

Plugin Discovery is a proposed TypeScript API with no manifest file; Umbel
keeps its field meanings and makes them declarative:

| Plugin Discovery | Umbel manifest version 1 |
| --- | --- |
| `protocolVersion: 1`, checked at load; unsupported plugins skipped | `protocol = 1`; an unsupported version fails the instance (section 6), because a configured plugin is never silently ignored |
| `name`, the config key | `plugin.id`, the default instance id and configuration key |
| `PluginMetadata { description, version, homepage }` | `plugin.description`, `plugin.version`, `plugin.homepage` |
| `configSchema()`, validated before `register` | `config.schema`, validated before any command is registered |
| `register(registry)` adding commands and middleware | `[[commands]]`, `[[contexts]]`, `[[pipelines]]`, `[[packs]]` and `[[skills]]`, declared statically; plugins add no middleware |
| `CommandOrigin { source, pluginName, packageName }` | `origin` in `plugin-list` and `plugin-show`, and `_meta["dev.umbel/origin"]` on every plugin tool (section 8.1) |
| `PluginDiagnostics` and `afd-plugins` | `plugin-list` (section 8.6), with Umbel error codes instead of free text |
| `onConflict`, default `explicit-wins`, recommended `error` | Always `error` in version 1: a collision fails the open |
| Discovery by scanning dependencies | None: Umbel loads only the instances `plugins.enabled` names (architecture section 4) |

### Room for Loam

Loam's app manifest extends this one (O3's note; Loam's D10). The schema
exposes every top-level property's definition under `$defs`, so Loam's own
schema, versioned under `endpoints/loam/`, can reference each of them and add
the reserved `ui` table. An Umbel host refuses a manifest with `ui` until a
manifest version defines it; Loam's host accepts it. Field names that both
use keep Umbel's meaning.

## 3. Plugin protocol versioning

**The plugin protocol version is 1** (D40). It names one compatible set: the
manifest at version 1, the WIT world at major version 1 (any `1.x`), and the
grant semantics of section 7. The host serves exactly protocol 1 and manifest
version 1 in phase 1, and refuses any other `protocol` or `manifest_version`
with `PLUGIN_PROTOCOL_UNSUPPORTED`, whose suggestion names the versions it
serves. A later host that serves 1 and 2 loads both.

What changes the protocol version, and what does not:

| Change | Version effect |
| --- | --- |
| A new optional manifest key, a new grant, a new WIT interface the world may import | New manifest version and a WIT minor version; protocol unchanged. A host that serves the new manifest version still reads every earlier one, so older plugins load; a host that does not (this phase's serves manifest 1 only) refuses the newer manifest with `PLUGIN_PROTOCOL_UNSUPPORTED` (D40) |
| A grant's meaning changes, a WIT function changes signature, a required key is added | Protocol 2, manifest 2, WIT 2.0.0 |
| The host's own shapes (event, principal, envelope) change | No plugin protocol change: plugins see them only as JSON through a grant, and the grant documents the version it returns |

The constants, public: `MANIFEST_VERSION = 1`, `PLUGIN_PROTOCOL_VERSION = 1`,
`WIT_WORLD = "umbel:plugin/plugin@1.0.0"`, `PACK_VERSION = 1` and
`CONFIG_VERSION = 2`. `workspace-show` reports them under `versions`.

## 4. The WIT world, version 1.0.0

**Settles the WIT world** (D38). The file
`endpoints/umbel/wit/umbel-plugin-1.0.0/world.wit` is normative; this is its
content:

```wit
package umbel:plugin@1.0.0;

/// Shared types. JSON travels as UTF-8 text; the host parses and validates it.
interface types {
  type json = string;

  /// What the command is called with. The principal is a summary: plugins never
  /// see credentials or tokens.
  record call-context {
    command: string,
    trace-id: string,
    /// The resolved space for a command with a `space` input; none otherwise.
    space: option<string>,
    actor-kind: string,
    actor-id: option<string>,
    on-behalf-of: option<string>,
    /// mcp, cli, agent or palette.
    %interface: string,
  }

  variant host-error {
    /// The grant was not declared, or the deployer denied it.
    not-granted(string),
    not-found(string),
    invalid(string),
    too-large(string),
  }
}

/// Grant `config`. The instance's configuration, validated, with defaults applied.
interface config {
  use types.{json};
  get: func() -> json;
}

/// Grant `log`. Lines go to the host's stderr log, tagged with the instance id.
interface log {
  enum level { error, warn, info, debug, trace }
  write: func(level: level, message: string);
}

/// Grant `packs`. Read the call's space's effective copy of one of this plugin's packs.
interface packs {
  use types.{host-error};
  %list: func(pack: string) -> result<list<string>, host-error>;
  read: func(pack: string, path: string) -> result<list<u8>, host-error>;
}

/// Grant `events`. Read one space's event log by cursor, as event-list returns it.
interface events {
  use types.{json, host-error};
  %list: func(space: option<string>, after: option<string>, limit: u32) -> result<json, host-error>;
}

/// Grant `clock`. The command context's clock, in epoch milliseconds; recorded on the tape.
interface clock {
  now: func() -> s64;
}

/// Grant `random`. The command context's random source, in [0, 1); recorded on the tape.
interface random {
  next: func() -> f64;
}

/// What a component provides: one entry point for every command it declares.
interface command {
  use types.{json, call-context};
  /// Returns an AFD CommandResult as JSON.
  execute: func(name: string, input: json, context: call-context) -> json;
}

world plugin {
  import config;
  import log;
  import packs;
  import events;
  import clock;
  import random;
  export command;
}
```

Rules:

- **The world is read from the component** (revised 2026-11-01). The host
  identifies a component's world by the version of its
  `umbel:plugin/command` export, which must be `1.x`, and of each
  `umbel:plugin/*` import, each `1.y` with `y` no newer than the host knows;
  no recorded world name is trusted. Any other major version is
  `PLUGIN_PROTOCOL_UNSUPPORTED`; a component with no `umbel:plugin/command`
  export is `PLUGIN_LOAD_FAILED`.
- **One entry point.** The host calls `command.execute` with the registered
  name, the validated input and the call context. The returned text must
  deserialize into an AFD `CommandResult` (`afd::CommandResult<Value>`); any
  other text is the failure `PLUGIN_RESULT_INVALID`. Result keys under
  `metadata` named `dev.umbel/` are handled as in section 8.1.
- **Imports are checked against grants at load.** wasmtime lists a
  component's imports before instantiation. An import of an `umbel:plugin`
  interface whose grant is not declared, or was denied, fails the instance
  with `PLUGIN_IMPORT_DENIED` naming the import and the grant. A component may
  import fewer interfaces than the world offers.
- **WASI 0.2 is linked, virtualized.** Components built for `wasm32-wasip2`
  import WASI 0.2 interfaces through their standard library. The host links
  exactly these, with `wasmtime-wasi`'s `p2` implementation over a
  `WasiCtx` built per call:

| WASI 0.2 interface | The host provides | Needs grant |
| --- | --- | --- |
| `wasi:clocks/wall-clock`, `wasi:clocks/monotonic-clock` | The command context's clock: wall time is `clock().now()`; monotonic time is nanoseconds since the call's first clock read; both recorded on the tape | `clock` |
| `wasi:random/random`, `wasi:random/insecure`, `wasi:random/insecure-seed` | Bytes drawn from the command context's random source, four per `next()` read (`floor(next() * 2^32)`, little-endian) | `random` |
| `wasi:cli/stdout`, `wasi:cli/stderr` | Always linked, granted or not: line-buffered into the host log at `info` and `warn`, tagged with the instance id and `wasi`, under the same 64 KiB per-call cap as the `log` grant. Rust's standard library imports `wasi:cli/stderr` to print panic messages, so refusing it would refuse every Rust component; step 4 verifies this with the hello component and a fixture that panics (revised 2026-11-01) | none |
| `wasi:cli/environment`, `wasi:cli/exit`, `wasi:cli/stdin`, `wasi:cli/terminal-*` | No variables, no arguments, empty stdin, no terminal; `exit` ends the call as a trap | none |
| `wasi:io/*` | Streams and polling over the above | none |
| `wasi:filesystem/*` | No preopened directories, so no file is reachable | none |

  Any other import, in particular `wasi:sockets/*` and `wasi:http/*`, fails
  the instance with `PLUGIN_IMPORT_DENIED`. A Rust component's standard
  library normally imports the clocks and random interfaces (random at least
  for `HashMap`'s seed), so `plugin new` declares the `clock` and `random`
  grants in a component's manifest; step 4 records the hello component's
  exact import list in this section.
- **Time and randomness come only from the command context** (architecture
  section 8). There is no other source: the WASI clocks and random
  interfaces are the context's, so the journal's tape restores them on replay
  and `replay_journal` reports a component call as `same`. The tape's read cap
  (`with_max_tape_reads`, default 1000) applies; past it the tape is marked
  truncated, as AFD does for any command. Two sources of reads count against
  it: the standard library's hash-map seeding (an `insecure-seed` read per
  instance, so per call, since each call has a fresh instance) and every
  clock read, including `Instant::now()` in a loop. The guide tells authors
  to read the clock once per call and pass the value down;
  `component_replay.rs` asserts that hello's tape stays under 16 reads per
  call.
- **Versioning.** The package is `umbel:plugin@1.0.0`. The host's linker
  provides the newest `1.x` it knows; a component built against an older
  `1.y` resolves through wasmtime's semver-compatible import matching. A world
  with a different major version fails with `PLUGIN_PROTOCOL_UNSUPPORTED`.
- **WASI 0.3 is reserved for world 2.0.0** (D38): async exports, streams and
  futures. The binding constraint is the runtime: wasmtime's 48 long-term
  line does not list `component-model-async` in its stability tiers, and its
  wasmtime-wasi has WASI 0.3 only as the opt-in `p3` feature. The Rust
  `wasm32-wasip3` target becomes Tier 2 with Rust 1.100 (2026-11-12), so the
  target is not what waits. World 2.0.0 waits for a long-term line that
  supports the async component model (about wasmtime 60, around 2027-08), or
  for an owner decision to leave the long-term line (watch row W17; restated
  2026-11-01 after review).

## 5. The plugin SDK

`umbel-sdk` (`endpoints/umbel/sdk/`) is the portable plugin API: the same
source builds as a compiled plugin, as a component and as a mounted server.
It does **not** depend on the host crate, and depends on the `afd` crate only
under the `mounted` feature, so the component build stays small and free of
Tokio.

```rust
/// A plugin written against the SDK. One value serves every kind.
pub trait Plugin: Send + Sync + 'static {
    /// The manifest text, normally `include_str!("../umbel-plugin.toml")`.
    fn manifest(&self) -> &'static str;
    /// The plugin's files (packs, skills, schemas the manifest names), embedded by
    /// `build::embed_assets`. A compiled SDK plugin supplies its packs and skills through it;
    /// a component and a mounted server ship them in the plugin directory instead.
    fn assets(&self) -> &'static [Asset] { &[] }
    /// The command's handler, by registered name. Called once per call; must not keep state
    /// between calls if the plugin is built as a component.
    fn handle(&self, name: &str, input: serde_json::Value, cx: &mut Cx) -> Outcome;
}

/// What a handler may use. Each method fails with `HostError::NotGranted` when the grant was
/// not declared or was denied.
pub struct Cx { /* the call context and the host services, per kind */ }
impl Cx {
    pub fn call(&self) -> &CallContext;               // command, trace id, space, actor summary, interface
    pub fn config(&self) -> Result<serde_json::Value, HostError>;
    pub fn log(&self, level: Level, message: &str);   // a no-op without the grant
    pub fn pack_read(&self, pack: &str, path: &str) -> Result<Vec<u8>, HostError>;
    pub fn pack_list(&self, pack: &str) -> Result<Vec<String>, HostError>;
    pub fn events(&self, space: Option<&str>, after: Option<&str>, limit: u32) -> Result<serde_json::Value, HostError>;
    pub fn now_ms(&self) -> Result<i64, HostError>;
    pub fn random(&self) -> Result<f64, HostError>;
}

/// An AFD CommandResult as JSON, built with the helpers below.
pub struct Outcome(serde_json::Value);
pub fn success(data: serde_json::Value) -> Outcome;
pub fn failure(code: &str, message: &str, suggestion: &str) -> Outcome;   // suggestion is required (AFD)
impl Outcome {
    pub fn with_reasoning(self, text: &str) -> Self;
    pub fn with_confidence(self, value: f64) -> Self;
    pub fn with_warning(self, code: &str, message: &str) -> Self;
}

/// Build a component (feature `component`, target wasm32-wasip2): generates the wit-bindgen
/// exports for `umbel:plugin/plugin@1.0.0` and routes `command.execute` to `handle`.
#[macro_export] macro_rules! export_component { ($plugin:expr) => { /* ... */ } }

/// Serve the plugin as a stdio MCP server (feature `mounted`), over an `afd::CommandRegistry`
/// and `afd::server::McpServer` with the individual tool strategy, one tool per command, so the
/// mounted loader sees the manifest's command names. There is no host: `Cx` answers from
/// built-in defaults (revised 2026-11-01): `config` is the manifest's configuration schema
/// defaults; `pack_read` and `pack_list` read the default packs in `assets()`; `clock` and
/// `random` come from the AFD command context; `log` writes to stderr; `events` alone answers
/// `NotGranted`. `call().space` is the input's `space` argument as given (no resolution).
pub async fn serve_mounted(plugin: impl Plugin) -> std::io::Result<()>;
```

- Dependencies: `serde`, `serde_json`; `wit-bindgen = "0.63"` under
  `component`; `afd` (by path, `server`) and `tokio` under `mounted`.
- `Outcome` serializes exactly as AFD's wire format (camelCase, unset fields
  omitted, never `null`); the SDK's unit tests compare it with
  `afd::CommandResult` round trips.
- The host side of a compiled SDK plugin is `umbel::plugins::sdk(plugin)`,
  which turns an `umbel_sdk::Plugin` into a `CompiledPlugin` (section 6.1),
  passing `assets()` through. `Asset` and `build::embed_assets` live in the
  SDK, and the host re-exports them.

## 6. Loading

Every kind goes through one sequence in `HostBuilder::seal`, after the
built-in commands and the embedder's `HostBuilder::register` commands are
registered and before AFD's bootstrap commands, so every plugin name is
checked against what is already taken and no plugin can replace it
(revised 2026-11-01). In order, per instance in `plugins.enabled` order:

1. **Resolve the source** (section 9.1): a compiled plugin from the host
   binary's catalog, or a directory in the workspace. Not found is
   `PLUGIN_NOT_FOUND`.
2. **Read and validate the manifest** (section 2), and check `protocol`.
3. **Validate the instance configuration** against `config.schema`, with
   defaults applied; a failure is `PLUGIN_CONFIG_INVALID` naming the
   instance and the JSON pointer.
4. **Decide the grants** (section 7.2).
5. **Check the spaces**: `spaces` names declared spaces, and an instance
   with a space-less command (one without a `space` input property, and
   every mounted command without `bind_space`, section 6.3) must be enabled
   for the default space (D44).
6. **Prepare the kind**: compile the component and check its imports; or
   connect the mount and list its tools; or nothing for a compiled or pack
   plugin.
7. **Check every name** the instance would add (commands, pipelines,
   contexts, skills, packs) against every name already taken: built-ins,
   host domains, reserved verbs, AFD's built-in names (`is_afd_builtin_name`)
   and earlier instances. Any collision is `PLUGIN_CONFLICT` naming both
   owners (D37: always `error`).
8. **Register** each command with `register_with_schema`, with a host-built
   handler per kind, the manifest's metadata, and `_meta["dev.umbel/origin"]`
   (section 8.1).

When every instance is prepared, `seal` continues as in phase 0 with one
change of order: the bootstrap commands, the first-class set (now with plugin
suggestions, section 8.4), the MCP server with the contexts (section 8.5;
now built **before** the middleware, so the context commands are in its
snapshot), the middleware (now with the plugin gate, section 8.1), the
journal and the marker catch-up.

**Failure isolation at load** (D50). An instance whose step fails is a load
failure. When the instance is `required` (the default, except for HTTP mounts,
section 6.3), `seal` fails with
that code and the CLI prints it and exits 1; `umbel serve` writes it to stderr
and exits 1. When `required = false`, the instance is skipped: nothing of it
is registered, `plugin-list` reports it `failed` with the code, and the doctor
reports `plugins.loaded` as `warn`. A failing instance never leaves part of
itself registered, because registration (step 8) runs only after steps 1 to 7
succeeded for it.

### 6.1 Compiled plugins

A compiled plugin is Rust code linked into a host binary, so the deployer who
builds that binary trusts it as much as the host (D42). Compiled plugins reach
host services only through the granted handle; the grant gates are API
discipline and a declaration to the deployer, **not a sandbox**. The owner
decided this on 2026-11-01 ([section 11](#11-security), decision 1):
untrusted plugins ship as components, and `plugin-show` and the doctor print
"trusted, not sandboxed" beside a compiled plugin's grants.

```rust
/// A plugin linked into the host binary.
pub trait CompiledPlugin: Send + Sync + 'static {
    /// The manifest text.
    fn manifest(&self) -> &str;
    /// The plugin's files (packs, skills, schemas the manifest names), embedded.
    fn assets(&self) -> &'static [Asset];
    /// Build the command handlers, given the instance's granted services. Called once at seal.
    fn commands(&self, services: Services) -> Result<Vec<PluginCommand>, PluginError>;
}

pub struct Asset { pub path: &'static str, pub bytes: &'static [u8] }
/// One manifest command's implementation.
pub enum PluginCommand {
    /// A handler; the host builds the CommandDefinition from the manifest entry, so the plugin
    /// cannot set metadata the manifest does not declare.
    Handler { name: String, handler: Arc<dyn afd::CommandHandler> },
    /// A finished AFD definition and its input schema, for code that already builds them (the
    /// todo backend). The host checks it against the manifest entry (name, description, schema,
    /// `mutation` against the effects, `confirm_prompt`, `approval`, `contexts`) and refuses a
    /// mismatch with PLUGIN_MANIFEST_INVALID, then sets the expose flags and the origin `_meta`
    /// itself (`with_expose`, `with_tool_meta`).
    Definition { definition: afd::CommandDefinition, schema: serde_json::Value },
}

impl HostBuilder {
    /// Make a compiled plugin available as `compiled:<id>`. It is loaded only when an instance
    /// in plugins.enabled names it.
    pub fn with_compiled(self, plugin: impl CompiledPlugin) -> Self;
}
```

- `Services` exposes the granted host services (section 7) as Rust methods
  with the same names as the WIT interfaces; an ungranted method answers
  `HostError::NotGranted`. Time and randomness: a compiled handler reads
  `context.clock()` and `context.random()` from the AFD command context, which
  the journal records. Nothing stops it calling the system clock; `plugin new`'s
  template and the guide say not to, because replay then diverges.
- `umbel-sdk`'s `build::embed_assets(&["packs", "skills", "schemas"])`, called
  from a plugin's `build.rs`, writes the `assets()` list into `OUT_DIR`.
- A command named in the manifest with no handler, or a handler with no
  manifest entry, is `PLUGIN_MANIFEST_INVALID`.
- **Lifecycle:** built once at `seal`, dropped with the `Host`. Several host
  processes on one workspace (D29) each hold their own instance, so state a
  compiled plugin keeps in memory is per process; such a command declares the
  `plugin-state` effect.
- **Failure at run time:** a panic is AFD's `COMMAND_EXECUTION_ERROR`; the
  instance stays loaded.
- **The stock `umbel` binary compiles in no plugin** (D48). A deployer who
  wants compiled plugins builds a binary whose `main` calls the existing
  `umbel::cli::run(args, environment, out, configure)` with a `configure`
  hook that calls `with_compiled` (phase 0's `cli::run` already takes that
  hook, so no `run_with` is added; revised 2026-11-01). `umbel-plugin-todo`'s
  `umbel-todo` binary is the worked example.

### 6.2 Component plugins

- **Engine.** One `wasmtime::Engine` per `Host`, with
  `Config::wasm_component_model(true)`, `consume_fuel(true)`,
  `epoch_interruption(true)` and Cranelift. A background thread increments the
  epoch every 10 ms for the host's life.
- **At seal:** read `component.path` (at most 32 MiB, else
  `PLUGIN_LIMIT_EXCEEDED`), compile it (`Component::new`), read its world
  from its export and import versions and check its imports against the
  grants (section 4), link the world and WASI 0.2 into a `Linker`, and build
  an `InstancePre`. A compile or link failure is `PLUGIN_LOAD_FAILED` with
  wasmtime's message. The `Engine` is shared by every instance of the host.
- **Per call:** a new `Store` with the call's state (the command context, the
  granted services, a `WasiCtx` with nothing inherited), `StoreLimits`, the
  fuel and the epoch deadline; instantiate from the `InstancePre`; call
  `command.execute`; drop the store. No state survives a call (principle 11),
  so a component command never declares `plugin-state`. The call runs under
  `tokio::task::spawn_blocking`.
- **Limits**, per call, from `[plugins.<id>.limits]` (section 9.1) within the
  host caps:

| Limit | Default | Host cap | Exceeded |
| --- | --- | --- | --- |
| `fuel` | 1 000 000 000 | 20 000 000 000 | `PLUGIN_LIMIT_EXCEEDED`, `details.limit = "fuel"` |
| `timeout_ms` (epoch deadline) | 5 000 | 60 000 | `PLUGIN_LIMIT_EXCEEDED`, `details.limit = "timeout"` |
| `memory_bytes` (`StoreLimits`, per linear memory) | 67 108 864 (64 MiB) | 1 073 741 824 | `PLUGIN_LIMIT_EXCEEDED`, `details.limit = "memory"` |
| `table_elements` | 20 000 | 1 000 000 | `PLUGIN_LIMIT_EXCEEDED`, `details.limit = "table"` |
| Input and result JSON | 4 MiB each | fixed | `PLUGIN_LIMIT_EXCEEDED`, `details.limit = "io"` |
| Log output | 64 KiB per call | fixed | Further lines dropped; one `warn` line says so |
| Pack bytes read | 16 MiB per call | fixed | `host-error.too-large` |

  Core instances, memories and tables per store are capped at 64, 4 and 16
  (a component instantiates several core instances). `StoreLimits` caps
  each linear memory, not their sum, so with four memories a call can hold
  up to four times `memory_bytes`; the host cap is set with that in mind.
- **Failure isolation at run time:** a trap (including `exit` and an
  out-of-bounds access) is the failure `PLUGIN_TRAPPED` with the trap's
  message and no backtrace beyond wasmtime's frame names; the store is
  discarded and the next call starts clean. The instance stays loaded.
- **Journal:** like any command; the tape holds the clock and random reads,
  so `replay_journal` against a host with the same component reproduces the
  result (tested in `component_replay.rs`).

### 6.3 Mounted plugins

A mounted plugin is an external MCP server whose tools become commands under
the mount's prefix (D22, D43). The host is the server's MCP client, through
`rmcp`'s client role directly: the `afd` crate has no Rust MCP client, and
AFD's parity table records that by role, so this is not a divergence from
principle 15; if AFD gains one, the loader moves to it.

The manifest says what the server is; the deployer's instance configuration
says where it runs and with what credential (owner decision 4 and M1 of the
2026-11-01 review). The manifest never holds a URL or a secret's name:

```toml
[mount]
prefix = "tickets"            # required; ^[a-z][a-z0-9]{0,31}$; must equal one of plugin.domains
transport = "stdio"           # required: stdio | http

# stdio
command = ["node", "dist/server.js"]   # required for stdio; the first element is resolved against the plugin root, then PATH
cwd = "."                     # default: the plugin root; must stay inside it
env = { LOG_LEVEL = "warn" }  # defaults for the child's environment (no secrets); the instance's env overrides them

# http
bearer = "required"           # none (default) | optional | required: whether the server needs a bearer token
                              # url and bearer_env are refused here; they are the instance's (section 9.1)

only = ["search_tickets", "get_ticket"]   # optional allow-list of original tool names

[[mount.tools]]               # optional overrides, by original tool name
tool = "search_tickets"
name = "search"               # optional; relative to the prefix: the command is <prefix>-<name>
effects = ["inspect"]         # default for every tool: ["external"]
bind_space = false            # default false; true makes the tool's `space` argument the Umbel space
confirm_prompt = "..."        # optional
approval = "required"         # optional
first_class = true            # optional suggestion
```

- **Instances and prefixes** (M4). An instance's prefix is the manifest's
  `mount.prefix` unless the instance sets `prefix` (section 9.1); an
  instance prefix **replaces** the plugin's domain for that instance, so two
  instances of one mounted plugin (`tickets` and `tickets2`, say) have
  disjoint command names. Override names are relative to the instance's
  prefix, so one manifest serves every instance. A prefix must pass the
  domain rules of section 2 (not a host domain, not a reserved verb) and be
  unique across instances; the manifest's `domains` check applies to the
  default prefix only.
- **Connect at seal.** stdio: build a `tokio::process::Command` with
  `kill_on_drop(true)` (rmcp's `TokioChildProcess` builder has no such
  option, so it is set on the `Command` before wrapping), `env_clear()`, then
  `PATH`, the manifest's `env` and the instance's `env`; stdin and stdout for
  JSON-RPC; stderr forwarded line by line to the host log at `debug` with
  the instance id. HTTP: Streamable HTTP to the instance's `url` over rmcp's
  reqwest client with rustls (section 1), with `Authorization: Bearer <value
  of the instance's bearer_env>` when set; `bearer = "required"` with no
  `bearer_env`, or a `bearer_env` naming an unset variable, is
  `PLUGIN_CONFIG_INVALID`. The client uses rmcp's `ClientLifecycleMode::Discover`
  with 2026-07-28, and on a legacy answer reconnects with `Initialize` at
  2025-11-25; it does not use `Auto`, whose probe can wait 10 seconds, equal
  to the connect timeout (revised 2026-11-01). It declares **no** client
  capabilities: no sampling, elicitation or roots. A connection failure, or
  no completed handshake within `connect_timeout_ms` (default 10 000, cap
  60 000), is `PLUGIN_LOAD_FAILED`.
- **List the tools** (every page of `tools/list`), keep those in `only` when
  it is set, and rename each (D22):
  1. If a `[[mount.tools]]` entry gives `name`, the command name is
     `<prefix>-<name>`.
  2. Otherwise normalize the original: lowercase; every character outside
     `[a-z0-9]` becomes `-`; runs of `-` collapse; leading and trailing `-`
     are trimmed; a segment that starts with a digit gains a leading `n`.
  3. If the normalized name starts with `<manifest prefix>-`, that leading
     segment is replaced by the instance's prefix; otherwise the command name
     is `<prefix>-<normalized>`.
  4. A name that still fails AFD's rule is skipped with the diagnostic
     `PLUGIN_TOOL_UNNAMEABLE` in `plugin-show`, unless an override names it.
  Two tools that map to one name are `PLUGIN_CONFLICT`.
- **Descriptions are scanned at load** (revised 2026-11-01). Every mounted
  tool's description, and every property description in its schema, is
  checked with the rule of AFD's `description-injection` surface check (the
  same patterns, ported to Rust in `plugins/mounted.rs` and pinned by test
  vectors shared with `packages/testing`). A match is a `warn` diagnostic in
  `plugin-check` and in `plugin-show`, and the doctor's `plugins.loaded`
  reports it as `warn`; the tool still loads, because the description is
  served as untrusted content either way.
- **Schemas** (revised 2026-11-01). The tool's `inputSchema` is
  **advertised** as the server gave it, and **validated** with a copy that
  has every keyword the `afd` crate's checker refuses removed (the server
  validates the full schema itself). Registering the two separately needs
  `CommandRegistry::register_with_schemas(command, validation, advertised)`
  from step 0b. When even the stripped copy fails to compile, the tool is
  skipped with the diagnostic `PLUGIN_TOOL_SCHEMA_UNSUPPORTED` naming the
  checker's message, as for an unnameable tool; when `only` or a
  `[[mount.tools]]` entry names that tool, the instance fails with
  `PLUGIN_LOAD_FAILED` instead, because the deployer asked for it. `returns`
  comes from `outputSchema` under the same rule. The original schemas are
  also in `_meta["dev.umbel/origin"]`.
- **Mounted commands are never space commands** (M3 of the 2026-11-01
  review). Phase 0 treats any command whose input schema has a `space`
  property as a space command (`has_space_property` in `src/host/mod.rs`),
  and its space check would resolve a mounted tool's own `space` argument
  against Umbel's spaces and fail with `SPACE_NOT_FOUND`. Phase 1 builds the
  host's set of space commands from its own knowledge instead: built-ins,
  compiled and component commands by the `space` property, mounted commands
  only when their override says `bind_space = true`. Otherwise a mounted
  tool's `space` argument is the server's own, passes through unchanged, and
  the command is space-less: the plugin gate and the event stamp use the
  default space, so the instance must include it (D44). With `bind_space =
  true`, the argument is Umbel's: resolved, checked against the instance's
  spaces, and forwarded to the server as the resolved space id.
- **Register** each as a command: the tool's description; the schemas
  above; effects from the override, else `["external"]`; `mutation` from the
  effects (section 7.3). The tool's annotations, such as `readOnlyHint`, are
  untrusted and set nothing.
- **Call:** `tools/call` with the original name and the input as arguments.
  Nothing else crosses: no caller credential, token or principal, no
  `dev.umbel/` key, no request `_meta` beyond what the SDK requires (D43).
  The answer becomes a `CommandResult`: when `structuredContent` is an AFD
  `CommandResult` (an object with a boolean `success`), it is used, with
  every `dev.umbel/` key removed from its `metadata`; otherwise a success
  carries `data = structuredContent`, or `{ "content": [...] }` when there is
  none, and `isError: true` is the failure `PLUGIN_TOOL_ERROR` with the first
  text content as its message.
- **Result size is enforced in the transport** (revised 2026-11-01), not
  after parsing: `max_result_bytes` (default 1 MiB, cap 16 MiB) bounds each
  stdio JSON-RPC line through a length-limited line codec, and each HTTP
  response body through a body limit on the reqwest client; a message over
  it is dropped unread and the call is `PLUGIN_LIMIT_EXCEEDED` with
  `details.limit = "result"`. An oversized stdio line poisons the stream, so
  the child is killed and respawned on the next call.
- **Recorded, not replayable** (architecture section 8): the plugin gate
  stamps `result.metadata["dev.umbel/replay"] = "recorded"` on every mounted
  result, the journal keeps it, and the test kit's replay skips those entries
  and reports them `skipped`. AFD's `replay_journal` would re-call the server;
  Umbel never replays a mounted entry.
- **Lifecycle and failure isolation at run time:** one connection per
  instance per host process, shared by concurrent calls. A call while the
  stdio child is gone respawns it (at most 3 respawns in any 60 seconds, then
  `PLUGIN_UNAVAILABLE` until the window passes); a call that fails because
  the connection dropped is `PLUGIN_UNAVAILABLE`, retryable, and is never
  retried by the host, because the call may have run. A call past
  `timeout_ms` (default 30 000, cap 300 000) is `PLUGIN_UNAVAILABLE` too. The
  tool list is fixed at seal: a server that changes its tools is seen at the
  next start, and its `listChanged` notifications are ignored.
- **HTTP mounts default to `required = false`** (D50, revised 2026-11-01):
  every CLI call seals a host, so a required HTTP mount that is down would
  stop `umbel serve` and every CLI command. An instance whose manifest says
  `transport = "http"` defaults to `required = false`; the deployer may set
  `required = true` and accept that. stdio mounts and every other kind keep
  `required = true`.
- **Grants:** none. A mounted manifest with `[[grants]]` is
  `PLUGIN_MANIFEST_INVALID`: the server runs outside the host and reaches no
  host service. Its packs and skills are still served by the host from the
  plugin directory, **once per plugin**, however many instances mount it
  (M4): skill names start with the plugin id, not the prefix, and pack
  overrides are keyed by plugin id.
- **What a mount does not import in phase 1:** the server's resources,
  prompts and skills (federation's work, after O1).
- **Trust** (owner decision 2, section 11): a stdio child runs as the host's
  operating-system user with no OS sandbox, and can read `state/keys/` and
  every space; a stdio mount is as trusted as a compiled plugin. Clearing
  the environment is hygiene, not isolation.

### 6.4 Pack plugins

`kind = "pack"` has no code: packs and skills only, no `domains`, no
`[[commands]]`, no grants. It loads in steps 1 to 5 and 7.

## 7. Grants and host services

### 7.1 The phase 1 catalog

| Grant | The host provides | Effect of using it | Rule |
| --- | --- | --- | --- |
| `config` | The instance's configuration, validated, defaults applied | none | Read-only |
| `log` | Lines into the host's stderr log, tagged with the instance id | none | Capped per call (section 6.2); never into the journal |
| `packs` | List and read files of the plugin's own packs, the call's space's effective copy | none | Only the plugin's packs; paths stay inside the pack; at most 16 MiB per call |
| `events` | `event-list`'s read, without acknowledgement, in a space the instance is enabled for, **under the caller's principal** (the call's context), so a plugin sees no event its caller could not list | none | Read-only; events are appended only by journaled commands (architecture section 4); a space outside the instance's spaces is `not-granted`; `space = none` reads the call's resolved space, or the default space for a space-less command, exactly as `event-list` with no `space` does |
| `clock` | The command context's clock | none | Recorded on the journal tape |
| `random` | The command context's random source | none | Recorded on the journal tape |

The architecture's other grants are named and refused until their phase, each
with `PLUGIN_GRANT_UNAVAILABLE` naming it: `documents`, `index`, `graph`
(phase 2), `memory` (phase 3), `http` and `secrets` (the first plugin that
needs outbound calls specifies them; until then an HTTP mount's bearer is
the deployer's, from the instance's `bearer_env`, owner decision 4). The **journal is not a grant**: the host
journals every call itself, and a journal read would expose other principals'
inputs; a read grant stays reserved.

### 7.2 How the host grants or refuses

For each `[[grants]]` entry of an instance:

1. Unknown, or not in this host's catalog: `PLUGIN_GRANT_UNAVAILABLE`.
2. Not allowed for the kind (any grant for `mounted` or `pack`):
   `PLUGIN_MANIFEST_INVALID`.
3. Listed in the instance's `deny` (section 9.1): when `required`, the load
   fails with `PLUGIN_GRANT_DENIED`; when optional, the grant is withheld.
4. Otherwise granted.

**Enabling an instance is consent to its declared grants**, minus `deny`,
for phase 1's grant catalog (owner decision 3 of 2026-11-01, D42).
`plugin-show`, `plugin-check` and the doctor show every grant with its reason
and every command's effects before and after enabling, so a deployer can see
what a plugin may do first; beside a compiled plugin's grants they print
"trusted, not sandboxed".

**Future grants with write, network or secret effect need an explicit
allow-list** (a tightening the coordinator added on 2026-11-01 under the
owner's delegation, recorded in D42 now so no later phase loosens it by
omission): any grant whose use writes (the store grants' write side, any
grant under the `store-write` effect), reaches the network (`http`) or reads
secrets (`secrets`) is not consented to by enabling. The instance must list
what it allows, per grant, under `[plugins.<id>.grants.<grant>] allow = [...]`
(hosts, secret names or stores, as that grant's specification defines); a
declared grant of that kind with no `allow` is `PLUGIN_GRANT_DENIED`. Phase 1
reserves the key `allow` and has no such grant.

**A plugin never reaches a service it did not declare.** Components: the
import check refuses the load (section 4). Compiled plugins: `Services` has
only granted methods working; the rest answer `NotGranted`. Mounted servers:
no service exists for them. Every grant call is scoped to the instance's
spaces (D26) and, for `packs`, to the call's resolved space; a command without
a `space` input reads the default space's copy.

### 7.3 Effects

Each command declares `effects`, the shape of Botcore's `CommandPolicy`
`effects`, with Umbel's own closed set; the instance's grants play the part of
Botcore's `capabilities`:

| Effect | Means | `mutation` |
| --- | --- | --- |
| `inspect` | Changes nothing anywhere | false |
| `plugin-state` | Changes state the plugin keeps itself: in a compiled plugin's memory or behind a mounted server | true |
| `external` | Acts on a system outside the host, such as any mounted tool not declared otherwise | true |

Reserved for plugins: `store-write` (phase 2, writes through a store grant)
and `workspace-write` (writes files outside `state/`). Manifest version 1
refuses both; the built-ins `skill-export` and `plugin-new`, which are host
code, are the only commands that declare `workspace-write`. The host sets
`mutation` from the effects, so a mutation's successful result is projected
into the event log as in phase 0. Effects are reported by `plugin-show` and,
through `_meta["dev.umbel/origin"].effects`, on every plugin tool.

## 8. Contributions

### 8.1 Commands and the hybrid surface

- **One registry.** Every plugin command, of every kind, is registered with
  `register_with_schema` into the host's one `CommandRegistry`, so MCP, the
  CLI and the library reach it the same way; the AFD meta-tools (`afd-call`,
  `afd-batch`, `afd-pipe`, `afd-discover`, `afd-detail`) see it like any
  other.
- **Exposure.** The manifest's `expose` defaults to `mcp`, `agent` and
  `cli` true and `palette` false; the host sets every flag explicitly on the
  definition, as phase 0 does for built-ins.
- **Origin.** Every plugin command's tool carries
  `_meta["dev.umbel/origin"] = { "plugin": <instance id>, "kind": <kind>,
  "version": <plugin version>, "effects": [...] }`, plus `"tool"` (the
  original name) and `"inputSchema"` (the original schema, when the host
  removed keywords) for a mounted command. It needs AFD's per-command tool
  `_meta` (step 0).
- **The plugin gate**, a new middleware between the space middleware and
  approvals: for a plugin command, it resolves the space (the same
  `Workspace::resolve_space`; the default space for a space-less command)
  and refuses a space the instance is not enabled for with
  `PLUGIN_NOT_ENABLED` before the handler runs. After the handler, it
  removes every `dev.umbel/` key from a mounted result's metadata; keeps
  `dev.umbel/record` from a compiled or component result (the
  command-supplied key of phase 0); handles `dev.umbel/provenance` (revised 2026-11-01): it keeps
  only the fields a command may supply in envelope version 0 (`origin`,
  `session`, `validFrom`, `validUntil`, `confidence`, `authority`, per
  `src/provenance.rs`), each of its documented type, and removes everything
  else, so a plugin, sandboxed or not, cannot supply the host-filled fields
  (`space`, `agent`, `principal`, `traceId`, `observedAt`); the host fills
  them from the journal entry as in phase 0. The plugin is identified as the
  source by the gate's own `dev.umbel/plugin` stamp, which a plugin cannot
  set (below) and the journal keeps with the entry; envelope version 0 is
  closed and has no source field, so carrying the plugin inside the
  envelope is a follow-up for envelope version 1 (phase 3). It removes every
  other `dev.umbel/` key, and stamps `dev.umbel/plugin = { "id", "kind" }` and, for
  mounted, `dev.umbel/replay = "recorded"` and `dev.umbel/trust =
  "external"`. The event stamp and the space middleware stay outermost, so
  `dev.umbel/space` and `dev.umbel/mutation` remain the host's.
- **Journaling** is unchanged: every call is journaled with its input, the
  actor and the plugin gate's stamps; a plugin command declared a mutation
  becomes an event in its space with `record` from its metadata.

### 8.2 Packs

D46. A pack is a directory with a `pack.toml` (`schemas/pack-manifest.v1.json`)
and up to three subdirectories:

```text
packs/<pack-id>/
├── pack.toml
├── data/          # structured data the plugin reads (JSON, TOML, CSV, text)
├── reference/     # reference material: markdown
└── rules/         # declarative rules, as data the plugin interprets; the host does not
```

```toml
pack_version = 1          # required
id = "greetings"          # required; equals the manifest's [[packs]] id
plugin = "hello"          # required; the plugin id
version = "1.0.0"         # required; semantic version
title = "Greetings"       # required
description = "Salutations hello-greet uses."   # required
```

- **Override per space** (D46): a directory
  `<workspace>/spaces/<space>/packs/<plugin id>/<pack id>/` with its own
  `pack.toml` (same `id` and `plugin`) replaces the default pack **whole** in
  that space; files are never merged. Its `version` is the deployer's. A
  space without an override uses the plugin's default. The override is read
  at `seal`.
- **Limits:** at most 1 000 files and 64 MiB per pack; no symlink leaves the
  pack; file names are UTF-8.
- **Validation** (`PACK_INVALID`, naming the path): the schema, the id and
  plugin match, the limits. An invalid override fails the instance's load
  (`required` decides as in section 6).
- `plugin-show` reports each pack per space as `default` or `override` with
  its version and file count.

### 8.3 Skills

D47. A skill is an Agent Skills directory: `SKILL.md` with YAML frontmatter
holding at least `name` and `description`, and optional supporting files. A
skill's `name` equals its directory's last segment and starts with the plugin
id followed by `-`, or equals the plugin id, so two plugins never ship one
name (the Skills extension requires that same-named skills never silently
replace one another). At most 512 files and 16 MiB per skill (the extension's
limits). Skills are untrusted content: the host serves the bytes and never
reads instructions from them. They are delivered three ways (architecture
section 5, R4):

1. **The Skills extension**, `io.modelcontextprotocol/skills` (SEP-2640,
   final): the server declares `resources` and the extension (no
   `directoryRead` in phase 1); `skills/list` returns one entry per skill with
   `uri` `skill://<name>/SKILL.md`, the frontmatter unchanged, and the full
   manifest of files with SHA-256 digests and sizes, computed at `seal` from
   the bytes served; `skills/get` answers by URI; unknown URIs are `-32602`.
2. **Resources**: every skill file is a resource, `skill://<name>/<path>`,
   listed by `resources/list` and read by `resources/read` (`text/markdown`
   for `.md`, otherwise by file suffix, else `application/octet-stream`). In
   MCP 2026-07-28, `ttlMs` and `cacheScope` are fields of the
   `resources/list` **result**, not of each resource (revised 2026-11-01):
   the result carries `cacheScope: "public"` and the server's
   `tools_list_ttl_ms`. Each resource carries `size`, and its digest under
   AFD's `_meta["dev.afd/digest"]` (`sha256:` and the lowercase hex of the
   served bytes), which AFD sets and which equals the digest in the Skills
   extension's file manifest ([`spec/mcp-resources.md`](../../../../../spec/mcp-resources.md#r6-digests-in-resource-_meta)
   R6; amended by step 0a, which replaced `dev.umbel/sha256`).
3. **The CLI export**: `umbel skill export dir=<path> [skill=<name>]`
   (`skill-export`, CLI-only) writes each skill's directory under `<path>`,
   refusing to overwrite a file that differs unless `force=true`, and writes
   `<path>/<name>/.umbel-origin.json` with the instance, plugin version and
   digests, so a harness skill directory knows where it came from.

Skills are per deployment in phase 1, served whichever spaces an instance is
enabled for; per-space skills are reserved. Both MCP paths need AFD's
resources and Skills extension support (step 0).

### 8.4 First-class suggestions

H1 makes the first-class set the deployer's choice; the manifest only
suggests (D45). When `mcp.first_class_tools` is absent,
`surfaces::default_first_class_tools` now returns `workspace-show`, then
`event-list`, then every command whose manifest entry, or mount override,
says `first_class = true`, in `plugins.enabled` order and manifest order,
skipping commands not exposed to MCP, up to the cap of 8. Suggestions past
the cap are dropped, and the doctor reports `plugins.first_class` as `warn`
naming them. A deployer's `mcp.first_class_tools` always wins.

### 8.5 AFD contexts and pipelines

- **Contexts.** The host collects every instance's `[[contexts]]` into
  `McpServer::with_contexts`; a command's `contexts` go on its definition
  (`with_contexts`). A context name must start with one of the plugin's
  domains, so contexts never collide. With no plugin context the server
  configures none, as in phase 0. A context that binds a default space stays
  reserved. **One registration path** (revised 2026-11-01):
  `McpServer::with_contexts` registers `afd-context-list`,
  `afd-context-enter` and `afd-context-exit` into the registry itself
  (`packages/rust/src/server.rs`), and phase 0's `seal` snapshots the
  registry for the event stamp, the space check and approvals in
  `install_middleware` *before* `build_server`. Phase 1 therefore moves
  `build_server` before `install_middleware` in `seal` (after the first-class
  set is computed), so the context commands are registered once, by the
  server, and are inside the middleware snapshot; the host never calls
  `register_context_commands` itself. The middleware still applies to every
  server call, because it lives in the registry.

- **Pipelines as data** (D3). A `[[pipelines]]` entry is registered as a
  command of the plugin whose handler runs the `afd` crate's
  `execute_pipeline` over the host registry with the caller's context and the
  entry's `steps`, `$input` bound to the command's input. The command's
  `effects` must cover its steps' effects (checked at `seal` for steps that
  name registered commands). **Confirmations** (M2 of the 2026-11-01
  review): the Rust server enforces `confirm_prompt` at the router, for a
  tool call and for each step of `afd-batch` and `afd-pipe`
  (`packages/rust/src/server/confirmations.rs`), but a plugin pipeline is
  one command whose handler calls the registry directly, so its steps'
  prompts would never be checked. At `seal`, a pipeline with any
  confirm-gated step therefore gets a `confirm_prompt` of its own: the
  union of its steps' prompts, in step order, each prefixed with the step's
  command name (`"hello-reset: Reset every greeting. todo-clear: Delete
  every todo."`), and `destructive` when any step is. One confirmation of
  the pipeline covers its steps, as one confirmation of `afd-pipe` does. A
  step with `approval = "required"` is still checked inside, because the
  approval middleware runs at the registry. A step may name another plugin's command: that
  is composition at the call site, not a dependency, so a pipeline whose step
  names a command that is not registered is **not** registered itself, the
  instance still loads, and `plugin-show` and the doctor (`plugins.pipelines`,
  `warn`) name the missing command. The `afd` crate refuses parallel steps and
  streaming steps, and so does the manifest.

### 8.6 The plugin commands

| Command | Mutation | `mcp` | `agent` | `cli` | Purpose |
| --- | --- | --- | --- | --- | --- |
| `plugin-list` | No | true | true | true | Every instance: id, kind, plugin version, status (`loaded`, `failed`), the failure code, counts of commands, packs, skills; the diagnostics Plugin Discovery's `afd-plugins` reports |
| `plugin-show` | No | true | true | true | `{ plugin }`: the manifest summary, grants granted and withheld with reasons, commands with effects and origin (mounted: original names, skipped tools), packs per space, skills, pipelines and their state |
| `skill-list` | No | true | true | true | Every skill: name, description, instance, URI, digest of `SKILL.md`, file count |
| `plugin-check` | No | false | false | true | `{ path }`: section 10.3 |
| `plugin-new` | Yes (`workspace-write`, not projected) | false | false | true | `{ kind, id, dir? }`: section 10.2 |
| `skill-export` | Yes (`workspace-write`, not projected) | false | false | true | Section 8.3 |

`workspace-show`'s `plugins` becomes a list of `{ "id", "kind", "version",
"status" }`, and its `versions` gains `manifest`, `protocol`, `wit`, `pack`
and `config: 2`. `plugin-new` and `skill-export` join the unprojected
mutations of phase 0, beside `event-ack` and `event-rebuild`.

## 9. The workspace

### 9.1 `umbel.toml`, version 2

**Configuration version 2** (D41) adds the plugin instances; everything else
is version 1 unchanged. `umbel init` writes `config_version = 2`. The host
reads version 1 as version 2 with no plugins; any other version is
`WORKSPACE_CONFIG_UNSUPPORTED`, naming 1 and 2. The schema is
`schemas/workspace-config.v2.json`.

```toml
config_version = 2

[plugins]
enabled = ["hello", "tickets"]       # instance ids, in load order; ^[a-z][a-z0-9-]{0,31}$; unique; not "enabled"

[plugins.hello]                      # optional for every instance
source = "compiled:hello"            # default: see below
required = true                      # default true, false for an HTTP mount (section 6)
spaces = ["main"]                    # default: every declared space
deny = ["events"]                    # default []; grants withheld (section 7.2)
[plugins.hello.config]               # validated against the manifest's config schema
default_name = "team"
[plugins.hello.limits]               # component only: section 6.2
fuel = 2000000000
timeout_ms = 2000
memory_bytes = 33554432

[plugins.tickets]
source = "plugins/tickets"           # a directory under the workspace holding umbel-plugin.toml
required = false                     # the default for an HTTP mount (section 6.3)
prefix = "tickets"                   # mounted only; default the manifest's mount.prefix; replaces the domain
url = "https://tickets.example.com/mcp"   # http mounts only, required: https, or http on a loopback address
bearer_env = "TICKETS_TOKEN"         # http mounts only: the deployer's own token, read from the host's environment at seal
connect_timeout_ms = 10000           # mounted only
timeout_ms = 30000                   # mounted only
max_result_bytes = 1048576           # mounted only
[plugins.tickets.env]                # stdio mounts only: added to PATH and the manifest's env, overriding it
TICKETS_REGION = "eu"
```

- **Sources.** `compiled:<id>` names a plugin the host binary was built with
  (`HostBuilder::with_compiled`). Any other value is a relative path to a
  directory inside the workspace (no `..`, no absolute path, symlinks resolved
  and checked) whose `umbel-plugin.toml` is read. With no `source`, the host
  uses `compiled:<instance id>` when the binary has it and
  `plugins/<instance id>` when that directory exists; both is
  `PLUGIN_CONFLICT`, neither is `PLUGIN_NOT_FOUND`.
- **Instances.** An instance id is the plugin id by default; `enabled` is
  reserved and refused as an instance id, because `[plugins.enabled]` would
  collide with the list. A plugin may be enabled as several instances only
  when it is mounted, each with its own `prefix`, which replaces the
  plugin's domain for that instance (section 6.3); its packs and skills are
  served once per plugin, not per instance. Two instances of a compiled or
  component plugin collide on command names and fail with
  `PLUGIN_CONFLICT`.
- **Where a mount runs, and its credential, are the deployer's** (owner
  decision 4; M1 of the 2026-11-01 review): `url` and `bearer_env` live
  here, never in the manifest, which may only say `bearer = "required"`
  or `"optional"`. The host reads the variable at seal and never logs,
  journals or reports its value; `plugin-show` reports only whether a bearer
  is configured. A caller's token is never forwarded.
- **Spaces** (D44, D26): each instance is enabled for its `spaces` only;
  grants and pack reads are scoped to them, and the plugin gate refuses a call
  in another space. An instance with a command lacking a `space` input must
  include the default space, else `PLUGIN_CONFIG_INVALID`.
- **Layout.** `plugins/` at the workspace root holds component, mounted and
  pack plugin directories; it is deployer-owned like `spaces/`. Pack
  overrides live under `spaces/<space>/packs/` (section 8.2). The host still
  writes only `state/`.
- **Validation** at `open` (`WORKSPACE_CONFIG_INVALID`, naming the key): the
  id pattern; uniqueness; an instance table without an entry in `enabled`;
  unknown keys; `limits` within the caps; `spaces` naming declared spaces;
  kind-specific keys used with another kind are refused at load
  (`PLUGIN_CONFIG_INVALID`), because the kind is in the manifest.

### 9.2 The doctor

`plugins.none` is removed. These checks replace it; the ones that need only
files run without a sealed host. **Compiled sources without a sealed host**
(revised 2026-11-01): a `compiled:<id>` source resolves only against the
binary's catalog, which lives on the `HostBuilder`. The CLI's doctor builds
its builder with the binary's `configure` hook, so it passes the catalog to
the file-only checks even when `seal` fails; a doctor run with no catalog
(a library call on a bare `Workspace`) reports each `compiled:` source as
`skip`, naming the instance, rather than `fail`.

| Id | Passes when | `warn` | `fail` | Without a sealed host |
| --- | --- | --- | --- | --- |
| `plugins.config` | Every instance's keys, `limits` and `spaces` are valid | | A rule broken | Runs |
| `plugins.sources` | Every source resolves; every manifest validates and declares protocol 1; every component file exists within the size cap | An optional instance's source fails | A required instance's source fails | Runs (no compilation; no mount is spawned) |
| `plugins.grants` | Every declared grant is in the catalog and allowed for the kind | An optional grant is denied | A required grant is denied or unavailable | Runs |
| `plugins.packs` | Every pack and override validates within the limits | | Invalid | Runs |
| `plugins.skills` | Every skill validates, names are unique and well formed | | Invalid or duplicate | Runs |
| `plugins.loaded` | Every instance loaded; reports kinds and counts, and "trusted, not sandboxed" beside each compiled instance's grants | An optional instance failed (names the code); a mounted tool skipped (`PLUGIN_TOOL_UNNAMEABLE`, `PLUGIN_TOOL_SCHEMA_UNSUPPORTED`); a mounted description matched by the `description-injection` rule | Never: a required failure stops the host from opening | `skip` |
| `plugins.first_class` | Suggestions fit the cap | Suggestions dropped | | `skip` |
| `plugins.pipelines` | Every pipeline registered | A pipeline not registered (names the missing step) | | `skip` |

### 9.3 Error codes

Umbel package codes, as in phase 0 (they do not join AFD's shared catalog).
Every one carries a suggestion.

| Code | Meaning | Retryable | Suggestion |
| --- | --- | --- | --- |
| `PLUGIN_NOT_FOUND` | A source does not resolve | No | "Check plugins.<id>.source: compiled:<id> needs a binary built with that plugin; a path needs <dir>/umbel-plugin.toml." |
| `PLUGIN_MANIFEST_INVALID` | The manifest breaks a rule; names the key | No | Names the rule; "Run umbel plugin check path=<dir>." |
| `PLUGIN_PROTOCOL_UNSUPPORTED` | The manifest version, protocol or WIT major version is not served | No | "This umbel serves manifest 1, protocol 1 and umbel:plugin@1.x; rebuild the plugin against them or upgrade umbel." |
| `PLUGIN_KIND_UNAVAILABLE` | The host was built without that loader | No | "Build umbel with the component or mounted feature." |
| `PLUGIN_CONFIG_INVALID` | The instance configuration fails the schema, or a kind rule; names the pointer | No | Names the rule |
| `PLUGIN_GRANT_UNAVAILABLE` | A grant this host does not provide yet | No | "Remove the grant, or wait for the phase that adds it (named in the message)." |
| `PLUGIN_GRANT_DENIED` | A required grant is in `deny` | No | "Remove it from plugins.<id>.deny, or disable the plugin." |
| `PLUGIN_IMPORT_DENIED` | A component imports something no grant allows | No | "Declare the grant <name> in umbel-plugin.toml, or rebuild without <import>." |
| `PLUGIN_CONFLICT` | A name is taken; names both owners | No | "Rename one of them, or disable one instance." |
| `PLUGIN_LOAD_FAILED` | Compilation, linking or the mount's connection failed | No: it happens only at seal, never in a call result, so there is nothing to retry; a restart retries (revised 2026-11-01) | "Run umbel plugin check path=<dir>; for a mount, check that its server starts." |
| `PLUGIN_NOT_ENABLED` | The call's space is not one of the instance's spaces | No | "Call it in one of <spaces>, or add the space to plugins.<id>.spaces." |
| `PLUGIN_TRAPPED` | A component trapped | No | "The plugin failed; report it to its author with the trace id." |
| `PLUGIN_LIMIT_EXCEEDED` | A per-call limit was reached; `details.limit` names it | No | "Raise plugins.<id>.limits.<limit> within the host cap, or reduce the input." |
| `PLUGIN_RESULT_INVALID` | A component returned something that is not a CommandResult | No | "The plugin failed; report it to its author with the trace id." |
| `PLUGIN_TOOL_ERROR` | A mounted tool answered `isError: true` | No | "See the message from the mounted server." |
| `PLUGIN_TOOL_UNNAMEABLE`, `PLUGIN_TOOL_SCHEMA_UNSUPPORTED` | Diagnostics, not results: a mounted tool skipped at load because no command name or no checkable schema could be made (section 6.3) | No | "Add a [[mount.tools]] entry naming it, or leave it out with only." |
| `PLUGIN_UNAVAILABLE` | A mounted server is not reachable now | Yes | "Retry; if it persists, run umbel plugin show plugin=<id>." |
| `PACK_INVALID` | A pack or override breaks a rule | No | Names the rule |
| `SKILL_INVALID` | A skill breaks a rule | No | Names the rule |

## 10. Building your own

### 10.1 Test kit

`umbel::testkit` (feature `testkit`) boots an in-process host with only the
plugin under test, for plugin crates' tests and the host's own:

```rust
pub struct TestHost { /* the Host and its temporary workspace */ }
impl TestHost {
    /// A temporary workspace with one space `main`, plugins.enabled = [<id>] and nothing else.
    pub fn compiled(plugin: impl CompiledPlugin) -> TestHostBuilder;
    /// The same with a plugin directory (component, mounted or pack), copied into the workspace.
    pub fn directory(path: impl AsRef<Path>) -> TestHostBuilder;
    pub fn host(&self) -> &Host;
    /// Call a command as the library principal.
    pub async fn call(&self, name: &str, input: Value) -> CommandResult<Value>;
    /// MCP drivers over the host's own server: in-memory stdio in either era, and the HTTP
    /// router with the bearer token (phase 0's drivers, moved here from tests/support).
    pub async fn mcp(&self, era: Era) -> McpDriver;
    /// Run the CLI in process (umbel::cli::run) and return stdout, stderr and the exit code.
    pub async fn cli(&self, args: &[&str]) -> CliOutput;
    /// Replay the journal against a fresh host with the same plugin: afd::replay_journal for
    /// every entry, skipping mounted entries (dev.umbel/replay = "recorded").
    pub async fn replay(&self) -> ReplayOutcome;
}
impl TestHostBuilder {
    pub fn config(self, table: toml::Table) -> Self;   // the instance configuration
    pub fn spaces(self, ids: &[&str]) -> Self;
    pub fn pack_override(self, space: &str, pack: &str, dir: impl AsRef<Path>) -> Self;
    /// The clock of every call: fixed by default (2026-01-01T00:00:00Z), so results compare.
    pub fn clock(self, epoch_ms: i64) -> Self;
    pub fn boot(self) -> Result<TestHost, HostError>;
}
```

**Scenarios** run with AFD's own runner, not a Rust copy (D49): `afd scenario
run <file> -s http://127.0.0.1:<port>/mcp -H "Authorization: Bearer <token>"`
against `umbel serve --http`, in the `conformance` job (section 13).

### 10.2 `plugin new`

`umbel plugin new kind=<kind> id=<id> [dir=<path>]` (`plugin-new`) writes a
plugin skeleton from templates embedded in the binary, refusing a non-empty
directory:

| Kind | Writes |
| --- | --- |
| `compiled` | `Cargo.toml` (depending on `umbel-sdk` and, as a dev-dependency, `umbel` with `testkit`), `umbel-plugin.toml`, `build.rs`, `src/lib.rs` with one `<id>-hello` command, one skill, one pack, `tests/plugin.rs` using `TestHost::compiled` |
| `component` | The same, with `[lib] crate-type = ["cdylib", "rlib"]`, `export_component!`, the `clock` and `random` grants, and a README line with `cargo build --target wasm32-wasip2 --release` |
| `mounted` | `umbel-plugin.toml` with a `[mount]` for stdio and a README that points at AFD's TypeScript, Python and Rust servers |
| `pack` | `umbel-plugin.toml`, one pack, one skill |

Every generated manifest passes `plugin-check` (tested).

### 10.3 `plugin check`

`umbel plugin check path=<dir>` (`plugin-check`) validates a plugin directory
without enabling it, and reports `{ "plugin", "kind", "healthy", "checks":
[...] }` in the doctor's shape (`pass`, `warn`, `fail`, `skip`):

- `manifest`: the schema and every rule of section 2; protocol 1.
- `grants`: every grant against the catalog and the kind; reasons present.
- `schemas`: every command schema passes the `afd` crate's checker; `returns`
  missing is `warn` (AFD's surface rule `missing-output-schema`).
- `packs`, `skills`, `config`: the rules of sections 8.2, 8.3 and the
  configuration schema, whose defaults must validate.
- `component`: compile, and check imports against grants.
- `boot`: an internal temporary host with only this plugin seals; the
  result lists the registered commands with their final names. It does
  **not** use the `testkit` feature, which the stock binary lacks (revised
  2026-11-01): `plugin-check` builds the host with a `HostBuilder` over a
  temporary workspace in `src/plugins/check.rs`, sharing only the workspace
  writer with `testkit`. For a component the check compiles it; for a
  mount, it spawns or connects to the server only when the caller passes
  `spawn=true` (`umbel plugin check path=<dir> spawn=true`), because that
  runs the plugin's program; without it `boot` is `skip` for a mount, with
  that suggestion. A compiled plugin's `boot` needs a binary with it in the
  catalog, else `skip`.
- `surface`: `skip`, with the suggestion "Run afd validate --surface against
  umbel serve --http with this plugin enabled." AFD's surface validation is
  TypeScript; the `conformance` job runs it against hello and todo.

`plugin-check` writes nothing outside a temporary directory it removes.

### 10.4 Guides

Phase 1 ships the SDK's rustdoc, `endpoints/umbel/README.md`'s "Write a
plugin" section (the four kinds, the manifest, grants, building a component,
mounting a server, the test kit) and the hello plugin as the worked example.
The authoring skills declared in `skills/exports.json` and distribution are
phase 7.

### 10.5 The hello and todo plugins

**hello** (`endpoints/umbel/plugins/hello/`, crate `umbel-plugin-hello`) is
one command, one pack and one skill, written once against `umbel-sdk` and
built three ways:

| Build | How | Loaded as |
| --- | --- | --- |
| Compiled | The crate's library, `umbel_plugin_hello::plugin()`, wrapped by `umbel::plugins::sdk`; its `manifest()` is `include_str!("../manifests/compiled.toml")` | `source = "compiled:hello"` in a host built with `with_compiled` (the tests, and `TestHost::compiled`) |
| Component | `cargo build --locked --release --target wasm32-wasip2 -p umbel-plugin-hello --features component`, giving `umbel_plugin_hello.wasm` | `source = "plugins/hello"`: the test copies `manifests/component.toml` as `umbel-plugin.toml`, the `.wasm` as `hello.wasm`, and the crate's `packs/` and `skills/` into `plugins/hello/` |
| Mounted | The `hello-mcp` binary (`--features mounted`), `serve_mounted(plugin())` over stdio, built before the tests (section 1) | `source = "plugins/hello"`: the test copies `manifests/mounted.toml` as `umbel-plugin.toml`, the binary as `bin/hello-mcp`, and `packs/` and `skills/` |

**One statement of how each manifest is produced** (revised 2026-11-01): the
crate keeps one manifest per kind in `manifests/` (`compiled.toml`,
`component.toml`, `mounted.toml`), each committed whole and never rewritten
by a test; they are identical except for `kind`, the kind's table and, for
the mounted one, no grants and the tool override. `plugin-check` passes on
each. The mounted one is, in full:

```toml
manifest_version = 1
protocol = 1

[plugin]
id = "hello"
title = "Hello"
version = "0.1.0"
description = "One command, one pack, one skill: the reference plugin."
kind = "mounted"
domains = ["hello"]

[mount]
prefix = "hello"
transport = "stdio"
command = ["bin/hello-mcp"]

[[mount.tools]]
tool = "hello-greet"
effects = ["inspect"]     # without it hello-greet defaults to external: a mutation that writes events
first_class = true

[[packs]]
id = "greetings"
path = "packs/greetings"

[[skills]]
name = "hello-guide"
path = "skills/hello-guide"
```

Its contents:

- **`hello-greet`**: input `{ "name"?: string (1 to 80 characters), "space"?: string }`,
  closed; returns `{ "greeting": string, "space": string, "at": string }`.
  The greeting is `<salutation>, <name>!`, where the salutation is the first
  line of `data/salutation.txt` in the pack `greetings` of the call's space
  and `name` defaults to the instance configuration's `default_name`
  (default `"world"`); `at` is the command context's clock as ISO 8601.
  Effects `["inspect"]`; `first_class = true`; grants `config`, `packs`,
  `clock`, `random` (the component's standard library imports both) and
  `log`, each `required`.
- **The pack `greetings`**: `pack.toml` version 1 and `data/salutation.txt`
  holding `Hello`.
- **The skill `hello-guide`**: a `SKILL.md` that tells an agent when to call
  `hello-greet` and how a space override changes the salutation, and
  `references/override.md`.
- **The mounted build** has no host services: `serve_mounted`'s `Cx`
  answers `config` with the configuration schema's defaults and `packs`
  from the default packs embedded in the binary (section 5), so a space
  override does not change its salutation, and its results carry
  `recorded`. `hello-greet`'s `space` argument passes through to the server
  unresolved (section 6.3), so the server reports the space it was given.
  Its packs and skill are still served by the host from the plugin
  directory. The tests assert exactly that difference.

**todo** (`endpoints/umbel/plugins/todo/`, crate `umbel-plugin-todo`) is the
todo example as a compiled plugin. It implements `CompiledPlugin` directly
over `todo_backend_rust::commands(store)` and `TodoStore::new()` (both
added by step 0b's library split; neither exists today: the backend is a
binary crate), returning each as
`PluginCommand::Definition`, one in-memory store per host process, and its manifest declares the eleven commands with their
schemas from the backend, `todo-clear`'s confirmation prompt, effects
`["plugin-state"]` on the eight that change the store and `["inspect"]` on
`todo-get`, `todo-list` and `todo-stats`, `domains = ["todo"]` and no grants.
Its `umbel-todo` binary calls `umbel::cli::run` with a `configure` hook
that adds the plugin through `with_compiled`.
Because the store is in memory, several host processes on one workspace each
have their own todos; that is acceptable for a conformance fixture and is why
its commands declare `plugin-state`.

## 11. Security

Defaults:

- **Components:** no network, no filesystem, no environment, no arguments;
  only the granted interfaces; fuel, epoch and memory limits per call; a
  fresh instance per call; time and randomness only from the command context.
- **Mounted servers:** no caller credential, token, principal or `dev.umbel/`
  key ever crosses (architecture section 8); no sampling, elicitation or
  roots; results labeled `dev.umbel/trust = "external"`; their `dev.umbel/`
  metadata stripped; their annotations untrusted; their descriptions and
  schemas served as the server gave them, each description checked at load
  by the `description-injection` rule (a `warn` in `plugin-check`,
  `plugin-show` and the doctor; section 6.3), and by `afd validate
  --surface` in CI for hello and todo; HTTP mounts must use https unless
  the URL is loopback, and TLS is rustls (section 1).
- **Randomness in components is not secret.** A component's `wasi:random`
  bytes come from the command context's random source and are written to
  the journal tape so replay restores them. Components must never use
  `wasi:random` (or anything seeded from it) for keys, tokens or other
  secrets: anyone who can read the journal can recompute them. The guide and
  `plugin new`'s component template say so; secrets for plugins wait for
  the `secrets` grant.
- **Skills and packs** are untrusted content: served as bytes with digests;
  the host never reads instructions from them; skill names cannot shadow one
  another.
- **Names:** host domains, reserved verbs and AFD's built-in names cannot be
  taken by a plugin; every collision fails the open.
- **Workspace paths:** every plugin path is confined to its root; sources are
  confined to the workspace; nothing a plugin declares becomes a path outside
  them.
- **Phase 0's defaults** hold unchanged: loopback HTTP with the bearer token,
  confirmations, no approval token over MCP, host-owned keys overwritten.

**Trust model: the owner's decisions of 2026-11-01** (recorded by the owner
in conversation; each is part of D42 or D43, amended the same day):

1. **Compiled-in plugins are trusted code** with the host's privileges;
   grants are a declaration and an API, not a sandbox. Untrusted plugins ship
   as components, the only sandboxed kind. `plugin-show` and the doctor print
   "trusted, not sandboxed" beside a compiled plugin's grants.
2. **A mounted stdio server runs as the host's operating-system user**, with
   its environment cleared to `PATH` plus the configured `env` (the
   manifest's defaults and the instance's), and **no operating-system
   sandbox in phase 1**. Such a child can read `state/keys/` (the approval,
   confirmation and HTTP token keys) and every space's files, so a stdio
   mount is as trusted as a compiled plugin; clearing the environment is
   hygiene, not isolation. Operating-system sandboxing for stdio mounts is a
   follow-up.
3. **Enabling a plugin consents to its declared grants, except those in
   `deny`**, for phase 1's grant catalog; there is no separate approval
   step. The coordinator added a tightening under the owner's delegation:
   any future grant with write, network (`http`) or `secrets` effect will
   require an explicit per-instance `allow` list, which enabling does not
   supply (section 7.2). The rule is recorded now, before any such grant
   exists.
4. **An HTTP mount may send the deployer's own bearer token** from an
   environment variable until phase 5's `secrets` grant; a caller's token is
   never forwarded, so architecture section 8's rule holds. The URL and the
   variable's name are the deployer's instance configuration in `umbel.toml`
   (`url`, `bearer_env`); the manifest may only declare that a bearer is
   needed (`bearer`).

## 12. Out of scope, and the seams reserved

| Out of scope | When | Seam left in phase 1 |
| --- | --- | --- |
| Federation: indexed-copy and live modes, the connector contract | After phase 2, after O1 | The mounted loader; reserved manifest key `connectors`; a mount's resources, prompts and skills not imported |
| Store grants (`documents`, `index`, `graph`, `memory`) and the `store-write` effect | Phases 2 and 3 | Named in the catalog and refused with `PLUGIN_GRANT_UNAVAILABLE` |
| `http` and `secrets` grants | The first plugin that needs them; `secrets` by phase 5 (owner decision 4) | Same; their per-instance `allow` list is already required (section 7.2) |
| Operating-system sandboxing of stdio mounts | A follow-up (owner decision 2) | The stdio child's cleared environment; the `[mount]` table |
| Backends contributed by plugins | Phase 6 | Reserved key `backends` |
| WIT world 2.0.0 on WASI 0.3, async exports | When a wasmtime long-term line supports the async component model (about 60), or the owner decides to leave the long-term line (W17) | The world read from the component's export and import versions; the protocol table of section 3 |
| A precompiled component cache | When a safe path exists, or the owner allows `unsafe` there | Compilation at seal |
| A mount's tool snapshot, so one-shot CLI calls need not spawn the server | A later phase | Connection at seal |
| Per-space skills; a context binding a default space | Later | Skills per deployment; `contexts` |
| Signed plugins and packs | After W9 | Reserved key `signature` |
| Per-command scopes | Phase 5 | Reserved key `scopes` |
| Authoring skills, distribution, the registry entry | Phase 7 | The README section and the SDK rustdoc |
| UI contributions | Loam | Reserved key `ui`; `$defs` in the schema |
| A journal read grant | Not planned | Section 7.1 |
| Hot reload, unloading | Not planned | The registry is fixed at seal (H2) |

## 13. Exit criterion and tests

The exit criterion is met when `umbel.yml` is green on `main` with every test
below and its `conformance` job, and four runs succeed in it:

1. **hello three ways**: `tests/hello_three_ways.rs` loads hello as
   `compiled:hello`, as the component built from the same crate, and mounted
   through the `hello-mcp` binary with `manifests/mounted.toml` as given in
   section 10.5, each in its own workspace with the test kit's fixed clock,
   and calls `hello-greet` with `{ "name": "Ada", "space": "main" }` over MCP
   in both eras and through the CLI in each. `space` is passed explicitly,
   because the host's middleware cannot change a handler's input
   (`src/middleware.rs`) and the mounted server sees the argument
   unresolved. The compiled and component results are equal, `at` included;
   the mounted result's `data` equals theirs **without `at`** (the mounted
   server reads its own clock) and carries the `recorded` stamp; no call
   writes an event, because every build declares `inspect`.
2. **A second plugin with no host change**, checked by CI rather than by a
   reviewer (revised 2026-11-01): `umbel.yml` gains a `plugin-isolation`
   job on pull requests that fails when one pull request changes files under
   `endpoints/umbel/plugins/` and also under `endpoints/umbel/src/`,
   `endpoints/umbel/wit/` or `endpoints/umbel/schemas/` (`git diff
   --name-only origin/<base>...HEAD`). The step 6 pull request adds
   `umbel-plugin-todo` and passes it.
3. **The todo conformance suite against Umbel**: in the `conformance` job,
   `pnpm --filter @afd/example-todo test:conformance:umbel` passes the 34 cases with `--mode legacy` and with `--mode modern`, and the
   confirmations suite with `--suite confirmations --mode modern` (the 2025
   era over stateless HTTP has no elicitation back channel, as for the Rust
   backend).
4. **The stock binary loads a plugin from the workspace** (added 2026-11-01
   after review): in the `conformance` job, the stock `umbel` binary, with no
   plugin compiled in, mounts the existing Rust todo backend over Streamable
   HTTP from a workspace directory and passes the 34 cases with `--mode
   legacy` and `--mode modern` (`--backend umbel-mounted`). The plugin
   directory is committed as
   `endpoints/umbel/tests/fixtures/plugins/todo-http/umbel-plugin.toml`:
   kind `mounted`, `prefix = "todo"`, `transport = "http"`, `bearer =
   "none"`, `[[mount.tools]]` entries giving `todo-get`, `todo-list` and
   `todo-stats` `effects = ["inspect"]`, the other eight
   `["plugin-state"]`, and `todo-clear` its confirmation prompt. The runner
   starts the backend as for `--backend rs`, writes `url =
   "http://127.0.0.1:<backend port>/mcp"` and `required = true` into the
   instance, then starts `umbel serve --http`. The backend's tool names
   already start with `todo-`, so the renamed commands keep their names.
3. **The todo conformance suite against Umbel**: in the `conformance` job,
   `pnpm --filter @afd/example-todo test:conformance:umbel` passes the 34 cases with `--mode legacy` and with `--mode modern`, and the
   confirmations suite with `--suite confirmations --mode modern` (the 2025
   era over stateless HTTP has no elicitation back channel, as for the Rust
   backend).

**How the suite is pointed at Umbel.** Step 6 adds `--backend umbel` to
`packages/examples/todo/dx/run-conformance.ts` and the script
`test:conformance:umbel`
(`cargo build --locked --manifest-path ../../../endpoints/umbel/Cargo.toml -p umbel-plugin-todo --bin umbel-todo && tsx dx/run-conformance.ts --backend umbel`).
The backend:

- writes a temporary workspace with `config_version = 2`,
  `plugins.enabled = ["todo"]`, `mcp.confirmations = "off"` for the todo
  suite and `"enforce"` for the confirmations suite (the suite resets with an
  unconfirmed `todo-clear`), and `http.bind = "127.0.0.1:<free port>"`;
- runs `umbel-todo --workspace <dir> serve --http --print-token` (the
  `umbel` CLI with the todo plugin compiled in), reads the token from stdout,
  polls `GET /health` with it until 200, for up to 300 seconds as for the Rust
  backend;
- connects `StreamableHTTPClientTransport` to `http://127.0.0.1:<port>/mcp`
  with `requestInit.headers = { Authorization: "Bearer <token>" }`, once per
  client kind for the confirmations suite, each with a fresh process.

`--backend umbel-mounted` (run 4) is added in the same step and runs the
stock `umbel` binary (`cargo build --locked --manifest-path
../../../endpoints/umbel/Cargo.toml -p umbel --bin umbel`) over the same
kind of temporary workspace, with `plugins.enabled = ["todo"]` and
`[plugins.todo] source = "plugins/todo"` holding a copy of the committed
`todo-http` fixture, after starting the Rust backend on its own port. If a
case fails only because of the mount's result mapping, step 6 stops and
amends section 6.3.

The suite calls tools by name, never lists them, and checks the wire rules:
Umbel's `dev.umbel/space` and `dev.umbel/mutation` metadata keys hold no `_`
and no `null`, so they pass, and the plugin gate's `dev.umbel/plugin` is an
object without either. Under the hybrid strategy the `todo-*` names are
callable directly ([H7](../../../../../spec/tool-strategies.md#h7-calls-confirmations-approvals-and-errors):
a `tools/call` naming an exposed command that is not first-class runs it), so
the suite needs no change beyond the backend.

The `conformance` job in `umbel.yml` (Node 24, pnpm, Rust, path-filtered with
the workflow) runs, in order: the conformance runs 3 and 4 above; `afd scenario
run` over `packages/examples/todo/scenarios/*.scenario.yaml` against the same
Umbel server; and `afd validate --surface --strict` with `-H "Authorization:
Bearer <token>"` against an Umbel server with hello and todo enabled, which
closes phase 0's follow-up for an external client check.

**Tests**, in `endpoints/umbel/tests/` unless named otherwise. Each names the
section it covers.

| File | Asserts |
| --- | --- |
| `manifest.rs` | Every rule of section 2, each with the key named; reserved keys refused naming their version; inline and path schemas; path confinement (`..`, absolute, a symlink out); `manifest_version = 2` and `protocol = 2` are `PLUGIN_PROTOCOL_UNSUPPORTED`; command names outside `domains` and in host domains refused |
| `schemas.rs` (extended) | `plugin-manifest.v1.json`, `pack-manifest.v1.json` and `workspace-config.v2.json` are valid 2020-12 and closed; their examples validate; reserved keys refused; `$defs` holds every top-level property |
| `workspace.rs` (extended) | Version 2 parsing and validation of section 9.1; version 1 opens as version 2 with no plugins; version 3 is `WORKSPACE_CONFIG_UNSUPPORTED` naming 1 and 2; `umbel init` writes version 2; source resolution, both and neither cases; `enabled` refused as an instance id |
| `plugin_compiled.rs` | An SDK plugin (with its packs and skills from `assets()`) and a raw `CompiledPlugin` load from `with_compiled`; a binary built through `cli::run`'s `configure` hook serves them; a catalog plugin not enabled is not loaded; definitions carry the manifest's metadata and expose flags; a missing handler and an extra handler are refused; a panic is `COMMAND_EXECUTION_ERROR` and the next call works; a result's `dev.umbel/provenance` keeps only the command-supplied fields |
| `grants.rs` | Each grant of the catalog works when declared; each answers `NotGranted` when undeclared or denied; a denied required grant is `PLUGIN_GRANT_DENIED`; each reserved grant is `PLUGIN_GRANT_UNAVAILABLE`; `allow` in a `[[grants]]` entry is refused as reserved; any grant on a mounted manifest is refused; `events` outside the instance's spaces is `not-granted`; `events` reads under the caller's principal and, with no space, the call's space; `plugin-show` prints "trusted, not sandboxed" for a compiled instance only |
| `plugin_spaces.rs` | `spaces` limits calls (`PLUGIN_NOT_ENABLED`) and grants; a plugin with a space-less command must include the default space; mutations project into the resolved space |
| `packs.rs` | Default and override per space; whole replacement (a file only in the default is absent under an override); limits; an invalid override fails the load; `plugin-show` reports `default` and `override` |
| `skills.rs` | Name rules and uniqueness; `skills/list`, `skills/get` and `resources/read` in both eras with correct digests, sizes and frontmatter; `-32602` for an unknown URI; `resources/list` with `ttlMs` and `cacheScope` on the result and each resource's `size` and `_meta["dev.afd/digest"]` (amended by step 0a); `skill-export` writes files and the origin file, and refuses to overwrite without `force=true` |
| `plugin_component.rs` | hello as a component: imports checked (a component importing `wasi:sockets` and one importing `umbel:plugin/events` without the grant are refused with `PLUGIN_IMPORT_DENIED`); the world read from the export and import versions, a `2.0.0` export refused; calls in both eras and the CLI; a trapping fixture is `PLUGIN_TRAPPED` and the next call works; a panicking fixture without the `log` grant loads (stderr is always linked) and its panic message reaches the host log; a forged host-filled provenance field is removed |
| `component_limits.rs` | Fixtures that loop, allocate and log past the limits: `fuel`, `timeout`, `memory` and `io` each give `PLUGIN_LIMIT_EXCEEDED` with `details.limit`; host caps refuse larger configured limits |
| `component_replay.rs` | A component that reads the clock and random: the journal tape holds the reads; `TestHost::replay` reports every entry `same`; a second run with another wall time gives the recorded values on replay; hello's tape stays under 16 reads per call |
| `plugin_mounted.rs` | hello mounted over stdio (`hello-mcp`), over Streamable HTTP (the same server on a loopback port) and over **HTTPS** against a local TLS server with a test certificate the client is configured to trust: tools listed and renamed; `_meta["dev.umbel/origin"]` with the original name; the advertised schema is the server's and validation uses the stripped copy; a tool whose stripped schema still fails is skipped with `PLUGIN_TOOL_SCHEMA_UNSUPPORTED`, and fails the load when `only` names it; a description matching `description-injection` gives a `warn`; the `recorded` and `external` stamps; a forged `dev.umbel/space` in a mounted result removed; a tool with its own `space` argument is not a space command and receives the argument unchanged, while `bind_space = true` resolves it and refuses a space outside the instance's; no client capabilities declared; no `Authorization` header unless the instance sets `bearer_env`; `url` or `bearer_env` in a manifest refused; `bearer = "required"` without `bearer_env` is `PLUGIN_CONFIG_INVALID`; the child's environment holds only `PATH`, the manifest's `env` and the instance's `env`; the child dies with the host (`kill_on_drop`); a result over `max_result_bytes` is refused in the transport, over stdio and HTTP; a killed child respawns once and then answers; respawn limit gives `PLUGIN_UNAVAILABLE`; an HTTP mount defaults to `required = false`; `required = false` with a missing command skips the instance; two instances with their own prefixes serve disjoint commands and one copy of the plugin's skills |
| `mount_naming.rs` | Unit-level cases of the renaming rule: case, punctuation, digits, the kept prefix, the manifest prefix replaced by an instance prefix, override names relative to the prefix, unnameable tools, collisions; `only` |
| `plugin_conflicts.rs` | Two instances of one compiled plugin; a plugin command colliding with a built-in, `afd-help`, a host domain and a reserved verb; two skills of one name; two mounts with one prefix |
| `first_class_plugins.rs` | Suggestions appended in order; truncation at 8 with the `plugins.first_class` warning; an explicit `mcp.first_class_tools` wins; non-MCP commands skipped |
| `contexts_pipelines.rs` | Plugin contexts registered once, by the server, and inside the middleware snapshot (approvals and the event stamp see `afd-context-*`); `afd-context-enter` scopes plugin commands; a pipeline runs its steps with `$input`; a pipeline naming a missing command is not registered and the instance loads; its effects must cover its steps'; **a pipeline with a confirm-gated step** gets the union of its steps' prompts, and with `mcp.confirmations = "enforce"` an unconfirmed call fails with `CONFIRMATION_REQUIRED` before any step runs, while a confirmed call runs every step |
| `plugin_commands.rs` | `plugin-list`, `plugin-show`, `skill-list` outputs, including a failed optional instance; `workspace-show`'s `plugins` and `versions` |
| `doctor_plugins.rs` | Every check of section 9.2 in pass, warn and fail, with and without a sealed host; a `compiled:` source resolves with the binary's catalog when seal fails, and is `skip` without a catalog; `plugins.none` absent |
| `testkit.rs` | `TestHost` boots with only the plugin, its MCP and CLI drivers, and `replay` skipping mounted entries |
| `plugin_scaffold.rs` | `plugin-new` for each kind into a temporary directory, and `plugin-check` passing on each, through the stock binary without the `testkit` feature; `boot` is `skip` for a mount without `spawn=true` and spawns it with; `plugin-check` failing cases for a bad manifest, a bad skill and a component importing too much |
| `hello_three_ways.rs` | The exit run 1 above |
| `plugins/hello/tests/hello.rs` | The SDK's `Outcome` equals AFD's wire format; `hello-greet` with the default pack and with an override, through `TestHost::compiled` |
| `plugins/todo/tests/todo.rs` | The eleven todo commands are registered as the todo plugin's, with `todo-clear`'s confirmation prompt; the manifest's schemas and effects equal the backend's definitions (so a backend change that the manifest misses fails here); one call each |
| `sdk/` unit tests | `Outcome` serialization; `Cx` answering `NotGranted` |

Existing tests that change: `doctor.rs` (the `plugins.none` cases move to
`doctor_plugins.rs`), `hybrid_surface.rs` (the default set still the two
built-ins with no plugin), `cli.rs` (`umbel help` lists the plugin commands),
`seal.rs` (the new reserved domains, and the MCP server built before the
middleware). `tests/support/` re-exports the
`testkit` drivers and holds the `hello-mcp` and fixture locators (section 1).

**The component fixture.** `umbel.yml` builds the hello component and the
fixture components (`tests/fixtures/components/`, small crates for the trap,
panic, loop, allocation, log and import cases) with
`cargo build --locked --release --target wasm32-wasip2` before `cargo test`,
and `hello-mcp` for the host (section 1);
the tests read them from `target/wasm32-wasip2/release/` and fail with the
build command in their message when a file is missing. No `.wasm` file is
committed.

## 14. Implementation plan

Each step is one pull request, green on the repository's checks and
`umbel.yml`, and updates [STATUS.md](../../STATUS.md) and this file's status
block. Any step that finds a design decision stops and amends this document.

### Step 0: AFD first

Two pull requests in AFD, before the Umbel steps that need them (D25).

**0a. The proposal and its spec** (documents only; done 2026-11-01, placed
in `docs/features/active/mcp-resources-skills/` because the owner approved
the direction with this specification):
`docs/features/proposed/mcp-resources-skills/` with a proposal and a
`spec/` change, shared with Loam (which needs `ui://` resources from the same
mechanism), covering for every language:

- Serving MCP **resources**: `resources/list` and `resources/read`, the
  `resources` capability, stable order, sizes, and the 2026-07-28 rules
  already recorded (`Mcp-Name` carries `params.uri`; lists do not vary per
  connection). In 2026-07-28, `ttlMs` and `cacheScope` are fields of the list
  **result**, not of each resource; a resource's digest goes in its own
  `_meta` under a reverse-DNS key (Umbel used `dev.umbel/sha256`; see below), and the
  Skills extension's file manifest carries the same digests (revised
  2026-11-01). Step 0a chose AFD's own key, `dev.afd/digest`, set by AFD,
  so Umbel mints none (amended by step 0a).
- Serving the **Skills extension** (`io.modelcontextprotocol/skills`,
  SEP-2640): the declaration, `skills/list`, `skills/get`, manifests computed
  from served bytes, `-32602` for unknown URIs; `directoryRead` optional and
  off by default.
- **Per-command tool `_meta`**: a command may carry extra `_meta` entries,
  emitted on its tool under every strategy and by `afd-detail`. The key rule
  (revised 2026-11-01): reverse-DNS keys other than `dev.afd/`, **plus** the
  MCP Apps key `ui` (`_meta.ui.resourceUri`, which Loam needs for its views;
  [Loam's prerequisites](../../../../loam/docs/architecture.md#afd-prerequisites)
  share this proposal); `approval` and every `dev.afd/` key stay reserved
  and are refused at registration, as are keys the server sets itself.
- **Separate advertised and validation schemas**: a command may be
  registered with the schema it advertises and a narrower one the registry
  validates with, for wrapped tools whose schemas use keywords the checker
  refuses (Umbel's mounted tools, section 6.3).
- Prompts stay out (no phase needs them yet); the proposal records them as
  its next step.
- Reconciled with the Skill Knowledge Layer: its `*.skill.md` command skills
  remain a separate, local convention; Agent Skills served over MCP are this
  proposal's.

**0b. Rust implementation** (done 2026-11-01) in `packages/rust`, behind the `server` feature:
`McpServer::with_resources(impl ResourceProvider)`,
`McpServer::with_skills(SkillCatalog)` (which also serves the skill files as
resources), `CommandDefinition::with_tool_meta(key, value)` and
`CommandRegistry::register_with_schemas(command, validation, advertised)`
(the advertised schema must be a JSON object with `type: object`; only the
validation schema is compiled); tests over
stdio and Streamable HTTP in both eras with the spec's vectors; CHANGELOG and
the language parity rows (other languages follow and do not block Umbel, as
for the hybrid strategy). The same pull request splits the Rust todo backend
into a library and its binary: `src/lib.rs` exposing
`pub fn commands(store: Arc<TodoStore>) -> Vec<(CommandDefinition, serde_json::Value)>`
and `TodoStore::new()` (neither exists today: the backend is a binary crate
with no `lib.rs`, so 0b adds both), with axum and `tower-http` only in the
binary (a
`server` feature, on by default), and its conformance runs unchanged. If
`rmcp` cannot route the extension's methods, 0b stops and amends 0a.

### Umbel steps

| Step | Pull request | Contents | Tests | Size |
| --- | --- | --- | --- | --- |
| 0a | AFD: resources, Skills extension, tool `_meta` (spec) | Above | None (documents) | M |
| 0b | AFD: the Rust implementation and the todo library split | Above | Above | L |
| 1 | Manifest and configuration | `plugins/manifest.rs`, `source.rs`; `workspace-config.v2.json`, `plugin-manifest.v1.json`, `pack-manifest.v1.json` with examples; configuration version 2; `init` writes 2; the doctor's file-only plugin checks; the WIT file; the version constants; `[workspace.lints]` and `lints.workspace = true`; `--workspace` in every cargo step of `umbel.yml` | `manifest.rs`, `schemas.rs`, `workspace.rs`, `doctor_plugins.rs` (file-only cases) | M |
| 2a | Loader core and compiled plugins | The load sequence of section 6, `CompiledPlugin`, `with_compiled` (through `cli::run`'s existing `configure` hook), `Services` and the grant gates, per-space enablement and the plugin gate (with the provenance rule), the host's own set of space commands, `plugin-list`, `plugin-show` ("trusted, not sandboxed"), the new `workspace-show` fields; `umbel-sdk` without its features, with `assets()`; `umbel-plugin-hello` as a compiled plugin; the `testkit` feature with phase 0's drivers moved into it and its fixed clock | `plugin_compiled.rs`, `grants.rs`, `plugin_spaces.rs`, `plugin_conflicts.rs`, `plugin_commands.rs`, `testkit.rs`, the sealed-host cases of `doctor_plugins.rs`, hello's own tests | L |
| 2b | Packs, suggestions, contexts, pipelines | Packs and per-space overrides, first-class suggestions, contexts with `build_server` moved before `install_middleware`, pipelines as data with the confirmation union | `packs.rs`, `first_class_plugins.rs`, `contexts_pipelines.rs` | M |
| 3 | Skills on three paths | Skills validation, `with_skills` and resources on the host's server, `skill-list`, `skill-export`, origin `_meta` on plugin tools | `skills.rs` | M |
| 4 | Component loader | wasmtime 48 and wasmtime-wasi `p2`, the shared `Engine`, the linker with the world and virtualized WASI 0.2 (stdout and stderr always linked), the world read from export and import versions, imports against grants, limits, per-call stores, the SDK's `component` feature and `export_component!` with the scoped `unsafe_code` exception, hello as a component, the fixture components, `umbel.yml`'s wasm build, the test-profile optimization, `timeout-minutes`, `rust-toolchain.toml`'s target and the AGENTS.md row; verify the hello component's import list and record it in section 4 | `plugin_component.rs`, `component_limits.rs`, `component_replay.rs` | L |
| 5 | Mounted loader | rmcp's client over stdio and HTTP with rustls, `url` and `bearer_env` from the instance, renaming with instance prefixes, overrides and `bind_space`, advertised and validation schemas, the load-time description scan, result mapping, the transport-level result limit, stamps, respawn, `kill_on_drop`, the SDK's `mounted` feature with built-in `Cx` defaults, and `hello-mcp` built by `umbel.yml` | `plugin_mounted.rs`, `mount_naming.rs` | L |
| 6 | The todo plugin and the conformance job | `umbel-plugin-todo` and `umbel-todo` over the todo library, and `plugins/todo` added to the workspace members; `--backend umbel`, `--backend umbel-mounted` and `test:conformance:umbel` in the todo example; the `todo-http` fixture; the `conformance` job (suites, the stock binary's mounted run, scenarios, `afd validate --surface`) and the `plugin-isolation` job in `umbel.yml`; inventory and `architecture.json` rows for the new crates. **Changes nothing under `endpoints/umbel/src/`, `wit/` or `schemas/`**, which `plugin-isolation` checks | `plugins/todo/tests/todo.rs`; the `conformance` and `plugin-isolation` jobs | M |
| 7 | `plugin new` and `plugin check` | Templates, `plugin-new`, `plugin-check` with its internal temporary host and `spawn=true`, the README's "Write a plugin" section | `plugin_scaffold.rs` | M |
| 8 | Exit | `hello_three_ways.rs`; STATUS.md marks phase 1 done with the run's evidence; the exit criterion re-run on `main` | `hello_three_ways.rs` | S |

Order: 0a, then 0b. Step 1 needs only 0a merged (it writes no server code).
Step 2a needs 1; 2b needs 2a. Step 3 needs 0b and 2a. Steps 4 and 5 need 2a
and may run in parallel (5 also needs 0b for `register_with_schemas`). Step
6 needs 0b, 2b, 3 and 5 (the suite's server lists resources; run 4 mounts
the todo backend).
Step 7 needs 4 and 5 (its templates cover every kind). Step 8 needs all.

## Revision 2026-11-01

The independent review of [#583](https://github.com/lushly-dev/afd/pull/583)
and the owner's decisions of the same day were applied. Every finding was
checked against the code it cites first (see the status block's revision
evidence).

| Finding | Disposition |
| --- | --- |
| Owner decisions 1 to 4 | Recorded in [section 11](#11-security), D42 and D43; the coordinator's allow-list rule in section 7.2 |
| M1 `url` and `bearer_env` | Moved to the instance configuration (sections 6.3, 9.1); the manifest declares only `bearer` |
| M2 pipelines skip confirmations | Confirmed in `confirmations.rs`: a pipeline gets the union of its steps' prompts (section 8.5); `contexts_pipelines.rs` case |
| M3 a mounted tool's `space` | Confirmed in `has_space_property`: mounted commands are never space commands unless `bind_space = true` (section 6.3). Chosen over renaming the argument, so the server's schema is advertised unchanged |
| M4 multi-instance mounts | Instance prefix replaces the domain; override names relative; packs and skills once per plugin (sections 6.3, 9.1) |
| M5 mounted hello and exit run 1 | `mounted.toml` in full (section 10.5); `serve_mounted`'s built-in defaults (section 5); fixed test clock; `data` compared without `at`; `space` passed explicitly (section 13) |
| M6 CI runs the new crates | `--workspace` everywhere; `hello-mcp` built by `umbel.yml` and found in the target directory; `plugins/todo` a member from step 6 (section 1) |
| M7 HTTPS mounts | rmcp's `reqwest` feature added; the rustls claim corrected; an HTTPS test (sections 1, 13) |
| Should-fix 1 to 20 | Applied: W17 and D38 restated; `wasmtime-wasi` `p2` only; `[workspace.lints]` with the wit-bindgen exception; stdout and stderr always linked; the world read from versions; `wasi:random` and tape-cap notes; advertised and validation schemas, with `register_with_schemas` added to step 0b; transport-level result limit; load-time description scan; architecture section 8 amended; `plugin-check` without `testkit` and with `spawn=true`; first-proof item 5 automated and a stock-binary run added; step 2 split; one context registration path; tool `_meta` rule allows `ui`, `ttlMs`/`cacheScope` on the result, digests in resource `_meta`; `assets()` on the SDK trait; `events` under the caller's principal and provenance limited to command-supplied fields; CI cost measures; doctor and `compiled:` sources; HTTP mounts default to `required = false` |
| Nits | Applied: `run_with` dropped; section 3 and D40 reconciled; `enabled` reserved; `kill_on_drop` on the `Command`; no `Auto` lifecycle probe; `PLUGIN_LOAD_FAILED` not retryable; `events.list` with no space; `StoreLimits` per memory; hello's manifests stated once; `TodoStore::new` added in 0b; W16 updated; section 6's opening sentence fixed |

Partly applied, with the reason: should-fix 17 asked that the plugin be
stamped as the provenance `source`. Provenance envelope version 0
(`schemas/provenance-envelope.v0.json`) is closed and has no source field,
and D36 forbids a version 0 producer from writing new fields. So the gate
keeps only the fields a command may supply, the host fills the rest, and
the plugin is attributed by the gate's `dev.umbel/plugin` stamp; the
envelope field is a follow-up for version 1. Nothing else was rejected.

## Amendments from step 0a

Step 0a ([`spec/mcp-resources.md`](../../../../../spec/mcp-resources.md))
made the choices this plan left open; the proposal lists them all. Two touch
this document:

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 8.3, step 0a | Digest under `_meta["dev.umbel/sha256"]`, bare lowercase hex, "the same value the Skills extension's file manifest gives" | Under AFD's `_meta["dev.afd/digest"]`, `sha256:<hex>`, set by AFD (R6) | The extension writes digests as `sha256:<hex>`, so bare hex was not the same value; AFD computes the digest from the bytes it serves, so the key is AFD's and Umbel needs none |
| Step 0a | `docs/features/proposed/mcp-resources-skills/` | `docs/features/active/mcp-resources-skills/` | Approved under the owner's delegation through this specification |

Other choices step 0a made that step 0b and step 3 must follow: one error
code, `-32602`, for an unknown resource or skill on both eras; cache hints
on `resources/read`, `resources/templates/list` and `skills/get` as well as
the lists; skill names unique in a catalog even under different prefixes
(Umbel's plugin-id prefix rule already guarantees it); frontmatter read with
the YAML 1.2 core schema; skill files' MIME types from a fixed suffix table
([S5](../../../../../spec/mcp-resources.md#s5-skill-files-as-resources)),
which matches section 8.3 for `.md` and the octet-stream default; and
prefixed tool `_meta` keys need two labels, which `dev.umbel/origin`
satisfies.

## Amendments from step 0b

Step 0b ([`packages/rust`](../../../../../packages/rust)) found `rmcp` able to
route the extension's methods and made these choices, none of which changes
what Umbel plans:

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| Step 0b, `with_tool_meta` | "refused when the command is defined or registered" (spec T2) | `with_tool_meta(key, value)` returns `Self`; `register`, `register_with_schema` and `register_with_schemas` refuse a bad key, naming the command and the key | A builder that returns a `Result` breaks chaining, and a registration check also covers the public `tool_meta` field. A plugin's definition fails when the host registers it |
| Step 0b, the todo backend | `src/lib.rs` exposing `commands(store)`; axum and `tower-http` "only in the binary" | As written, and the binary has `required-features = ["server"]` (feature on by default, enabling `axum`, `tower-http` and `afd/server`); `TodoStore::new()` and `register_commands` (what the binary uses) are also public | Without the feature the crate is the commands and the store over `afd` without its `server` feature, which is what the todo plugin needs |
| Spec S6 (directory read) | The result "lists the directory's direct children" | The result's field is `resources` (SEP-2640), with R3's cache hints; children sort by their own last path segment | The spec named no field; SEP-2640 does |
| Spec S2 | Frontmatter "one mapping" | Also at most 64 levels deep with no repeated key | A reader with its own stack, and JSON objects cannot hold a repeated key |
| Spec T2 | Reserved prefixes by name | `dev.afd/` and MCP's reserved prefixes are matched without regard to case | A case-insensitive consumer must not see `DEV.AFD/x` as a different namespace |
| Spec R2 | An absolute URI with a scheme | Also no whitespace or control character | The check the server can make cheaply without a URI parser |
| Crate | No YAML dependency | `saphyr-parser` 0.3 (optional, `server` feature) | Frontmatter needs a real YAML 1.2 reader whose events let the crate refuse tags, anchors and aliases and resolve plain scalars by the core schema itself |

## Amendments from step 1

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 6, 9.1 | The loader (step 2a) makes a configured instance load or fail | Until step 2a, `HostBuilder::seal` refuses a workspace whose `plugins.enabled` is not empty with `WORKSPACE_CONFIG_INVALID` naming `plugins.enabled`; `umbel workspace doctor` still checks the instances' files. Step 2a removes the guard | Phase 0 refused a non-empty `enabled` when the file was read. Version 2 moves that refusal from the file to `seal`, so the doctor and `plugin-check` can read configured instances, while a configured plugin is still never silently ignored |

Two shapes the specification leaves open, fixed here for steps 2a onward:
`doctor::run_with_catalog` and `run_discovered_with_catalog` take a
`plugins::CompiledCatalog` (compiled plugin id to embedded manifest text),
which the CLI's `configure` hook will fill in step 2a; the file-only checks
use `plugins::resolve_source`, which answers `ResolvedSource::Unresolved`
(reported `skip`) when there is no catalog.

## Amendments from step 2a

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 1, 10.1 | The `testkit` feature enables `tempfile` and `rmcp` | It also enables `http` and `http-body-util` | The in-process HTTP driver builds requests and reads response bodies against the router; both crates are also dev-dependencies for the integration tests |
| 10.1 | The test kit's clock is fixed | `HostBuilder::with_clock(impl Clock)` is a new public builder method; `TestHost` uses it for the fixed clock | Phase 0's builder had no way to inject a clock without the test kit reaching into `seal` |
| 1 | The `umbel` crate has no self dependency | Its `[dev-dependencies]` name `umbel` itself with `features = ["testkit"]`, and `umbel-plugin-hello` | The integration tests drive the test kit as a plugin author would, and use hello as the second compiled plugin |
| 5, 7 | `Services` calls are plain method calls | `Plugin::handle` is synchronous and `Services` `events` reads block on files, so the host's wrapper for an SDK command (`SdkHandler`) runs `handle` under `spawn_blocking` and rethrows a panic with `resume_unwind`, which AFD reports as `COMMAND_EXECUTION_ERROR` | A blocking read on the async runtime stalls other calls, and swallowing a panic would turn it into a plain failure |
| 6 | `seal` refuses a configured plugin (amended by step 1) | The guard is removed: every configured instance goes through the load sequence. The CLI passes the compiled catalog to the doctor even when `seal` fails, so `workspace doctor` still reports the instance | Step 1 promised the removal; the doctor must explain a failed load |
| 8.1, 6 step 8 | Origin `_meta["dev.umbel/origin"]` on every plugin tool, registered with the command | Not in step 2a: the step 3 row of the plan owns "origin `_meta` on plugin tools", with the skills that use the same entry. Plugin commands in 2a carry no tool `_meta` of their own | The plan table assigns it to step 3; step 2a registers commands with `register_with_schema` and the gate's stamps |

## Amendments from step 2b

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 6, 8.5 | Each instance is registered as soon as its steps 1 to 7 succeed | Every instance is prepared first (steps 1 to 7), the pipelines are decided against every command that will exist, and only then is anything registered, in `plugins.enabled` order. Registration of a plugin's commands still never leaves part of an instance behind | A pipeline may name another plugin's command, which may be a later instance, and a pipeline whose effects fail must still be able to drop its whole instance |
| 8.5 | "The command's `effects` must cover its steps' effects (checked at `seal` for steps that name registered commands)" | A pipeline whose steps are all registered but whose `effects` miss one of a step's fails its instance with `PLUGIN_MANIFEST_INVALID` naming `pipelines[i].effects` (`inspect` is covered by any effect); an optional instance is dropped and the rest decided again. A step that is a host mutation (`event-ack`, `event-rebuild`) cannot be covered by any plugin effect, so that pipeline is not registered | The failure is the author's, so it is loud; a missing command is the deployment's, so it is a warning |
| 8.5 | A step may name another plugin's command | A step may not name a pipeline: pipelines do not nest, so one can never reach itself. Such a pipeline is not registered, with the reason in `plugin-show` and the doctor. Steps naming `afd-*` commands are also unregistered, because the bootstrap commands are added after the plugins load | Cycle detection needs a registry that does not exist yet; the smallest safe rule is no nesting |
| 8.5 | The union of the steps' prompts, "each prefixed with the step's command name" | As written, with a command named by several steps listed once, and `destructive` when any step is. Prompts are the built definitions' (for a finished definition, the plugin's own) | The union of a repeated step should not repeat its prompt |
| 8.5 | A pipeline is "registered as a command of the plugin" | Also: its result is `{ "steps": [ { index, command, as?, status, data? } ] }`; a failing step fails the pipeline with the step's own error, plus `details.pipeline`, `details.step` and `details.command`; a pipeline is not a transaction, so earlier steps stay done. The pipeline command is not projected into an event (its steps are, as the calls they are); `effects` still set its `mutation` | Spec was silent on the result; projecting both would write each change twice |
| 2, 8.5 | A command's `contexts` are "AFD contexts this command belongs to" | Each must be declared in the same manifest's `[[contexts]]`, else `PLUGIN_MANIFEST_INVALID` naming `commands[i].contexts` | An undeclared context would hide the command from every context without saying so |
| 8.5 | Contexts: names start with a domain so they never collide | The loader also refuses two instances declaring one context name (`PLUGIN_CONFLICT`); the doctor's `mcp.surface` re-check builds its server with no contexts, because the live registry already holds the context commands | Step 7 of the load sequence names contexts; `register_context_commands` refuses a second registration |
| 8.2 | "The override is read at `seal`" | Validated and counted at `seal`; a plugin's reads open the files when it asks, confined to the pack directory. The plugin's own default pack is validated at load too, for every kind (so a broken default pack fails the instance with `PACK_INVALID`) | Holding up to 64 MiB per pack per space in memory is not worth the guarantee |
| 8.4 | Suggestions past the cap are dropped and the doctor warns | As written, for the default set only; with the deployer's `mcp.first_class_tools` set, the doctor's `plugins.first_class` passes and says the list wins and which suggestions it did not use | The deployer's list is not a failure to fit |
| 10.1 | `TestHostBuilder::pack_override(space, pack, dir)` | Copies `dir` to `spaces/<space>/packs/<plugin id>/<pack>/` of the temporary workspace; `replay` repeats it for the fresh host | Same layout the host reads |
| 8.4 | Mounted overrides can suggest first-class tools | Step 5; the loader's `suggestions` list takes manifest commands only for now | Mounted tools do not exist yet |

## Amendments from step 3

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 8.3, step 0b | AFD's `SkillCatalog` exposes what the server serves only over MCP | `SkillCatalog::entries()` is public (additive, `packages/rust`) | `skill-list` and `skill-export` report the description, URI, digests and file manifest the server serves; reading them from the catalog keeps one frontmatter parser and one digest, instead of a second YAML reader in Umbel |
| 8.3 | Skill validation is the manifest's name rule plus file limits | A skill is read through its plugin's files and checked by the same `SkillCatalog::new` the server uses, at load (step 3 of section 6, before any plugin code runs) and by the doctor's `plugins.skills` for directory sources: frontmatter, `name` equal to the directory, a description of 1 to 1 024 characters, AFD's stricter name characters (no `--`, no leading or trailing `-`). A break is `SKILL_INVALID` naming the skill's path. A skill may not ship a file named `.umbel-origin.json` | A skill that loads must be one the host's server can serve; a second set of rules would let the loader accept what the server refuses at `seal` |
| 6 step 7, 8.3 | A skill name collision is always `PLUGIN_CONFLICT` | A name another instance of the same plugin ships with the same bytes is served once (the "once per plugin" rule of section 6.3, applied to every kind); any other repeat (the same plugin id from another directory with other content) is `PLUGIN_CONFLICT` naming both instances. Different plugin ids can never collide: ids have no hyphen and the manifest requires the id as prefix | Two instances of one pack plugin are a normal configuration and must load; the Skills extension needs every name once |
| 8.1 | `_meta["dev.umbel/origin"]` on every plugin tool | Done here for compiled plugins (step 2a deferred it to this step): `{ plugin: <instance id>, kind, version, effects }`, set by the host after the plugin's own definition, so a finished `Definition` cannot keep a value of its own for that key (its other prefixed `_meta` keys stay). The mounted-only `tool` and `inputSchema` entries arrive with step 5 | The plan table assigns the origin to step 3; step 5 owns mounted tools |
| 8.3 | `umbel skill export dir=<path> [skill=<name>]` refuses to overwrite a differing file unless `force=true` | Also all or nothing: when any target differs and `force` is not true, nothing is written (`ALREADY_EXISTS` with `details.differs`); an unchanged file is not rewritten; a target that is a symbolic link, or a directory path component that is one, is refused; an unknown `skill` is `NOT_FOUND` naming the choices. A relative `dir` is relative to the process's working directory. The origin file is deterministic (`umbel_origin: 1`, `skill`, `uri`, `instance`, `plugin`, `version`, and the files with digest and size) and follows the same overwrite rule. `skill-export` joins `event-ack` and `event-rebuild` in the unprojected mutations | A half-written export would leave a harness skill directory that matches neither version |
| 8.6 | `skill-list`: name, description, instance, URI, digest, file count | Also `plugin` and `version` | The origin file records them; the list should agree |
| 10.1 | The test kit's drivers send `Mcp-Name` for tools | They also send it for `resources/read` (the URI, R5) | Modern HTTP rejects a `resources/read` without it |

## Amendments from step 5

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| 1 | `rmcp` features include `transport-child-process` | Not enabled; the host spawns the child itself (`tokio::process::Command`, `kill_on_drop`, `env_clear`) and gives rmcp a line transport over the pipes. The `mounted` feature also names `reqwest`, `sse-stream`, `futures` and `regex` | rmcp's `TokioChildProcess` owns the pipes, so a reader that counts line length for the result limit cannot be put under it |
| 6.3 | The result limit is "a body limit on the reqwest client" | A `StreamableHttpClient` of the host's own wraps `reqwest::Client` (POST only; GET streams and session deletes delegate) and counts the JSON body or event-stream bytes of each response; the stdio reader trips a shared signal when a line passes the limit. A call in flight on a connection that trips gets `PLUGIN_LIMIT_EXCEEDED`; the connection is dropped, so the next call reconnects (counted against the respawn budget, for HTTP too) | reqwest has no body-limit setting |
| 6.3 | A tool the server lists is mounted or skipped by the naming and schema rules | AFD's own meta-tools (`is_afd_builtin_name`: `afd-call`, `afd-batch`, `afd-pipe`, ...) are never mounted; `only` or an override naming a tool the server does not list fails the load (`PLUGIN_LOAD_FAILED`) | `afd-call` of a mounted AFD server would reach every remote command past `only`, `effects` and `bind_space`; a typo must not quietly serve fewer tools |
| 6.3, 10.1 | HTTPS "against a local TLS server with a test certificate the client is configured to trust" | `HostBuilder::with_mount_root_certificate(pem)` adds a trusted root for HTTP mounts (an embedder API; no `umbel.toml` key) | The test needs a way to trust its certificate; a private CA is a real deployment need |
| 10.1 | The test kit has `config`, `spaces`, `clock` | `TestHostBuilder::instance_keys(table)` sets more keys of the instance (`url`, `prefix`, `env`, ...); `replay` and `cli` work for directory sources | Mounted instances need those keys |
| 1, 13 | `hello-mcp` is the only extra binary the host tests find | The mounted tests also use `umbel-mount-fixture`, a `[[bin]]` of the `umbel` package with `required-features = ["testkit"]`, which `cargo test` builds with no extra step; `umbel.yml` builds `hello-mcp` before the tests and gains the mounted library-only clippy leg and a clippy step for the mounted SDK and `hello-mcp` | A scriptable server is needed for the environment, limits, respawn and eras |
| 8.1 | The gate keeps `dev.umbel/provenance` fields a command may supply | For a mounted result it keeps none | A mounted server is outside the host |
| 8.4, 8.5, 6 | A mounted instance's declarations are not mentioned beyond its tools | A mounted manifest may ship packs, contexts, pipelines and skills; a tool is a first-class suggestion when its `[[mount.tools]]` override says `first_class = true`; a pipeline over mounted commands is checked against the effects the load gave the tools (the manifest has no `[[commands]]` for a mounted plugin); a pipeline or context name that collides with a mounted command is `PLUGIN_CONFLICT` | Step 2b merged while step 5 was open; the two had to meet in the loader |
| Shared vectors | Ported rule "pinned by test vectors shared with `packages/testing`" | `packages/testing/src/surface/injection-vectors.json`, read by `surface.test.ts` and `tests/mount_naming.rs`. The TypeScript `<<SYS` alternative only matches after a word character (`\b`); the vectors record that | One file keeps both implementations honest |

## Follow-ups

| Date | Follow-up | Owner |
| --- | --- | --- |
| 2026-11-01 | ~~The owner's decision on the four trust-model points of [section 11](#11-security) before step 2 merges~~ Done 2026-11-01: decided by the owner, recorded in section 11, D42 and D43 | Owner |
| 2026-11-01 | Operating-system sandboxing for stdio mounts (owner decision 2): a stdio child runs as the host's user and can read `state/keys/` and every space; evaluate per-platform sandboxes (for example Landlock or a separate user on Linux, `sandbox-exec` successors on macOS) | A later phase; owner to place |
| 2026-11-01 | Carry the plugin inside the provenance envelope: version 0 is closed with no source field, so phase 1 attributes plugin results through the gate's `dev.umbel/plugin` stamp | Phase 3 (envelope version 1) |
| 2026-11-01 | A precompiled component cache: wasmtime's `Component::deserialize` is `unsafe`, which the crate forbids; decide whether a reviewed `unsafe` module or a safe alternative is worth it once startup cost is measured | Phase 7, or earlier if measured |
| 2026-11-01 | A mount's tool snapshot under `state/`, so one-shot CLI calls do not spawn every mounted server at `seal` | A later phase |
| 2026-11-01 | WIT world 2.0.0 on WASI 0.3 once a wasmtime long-term line supports the async component model (about 60, around 2027-08), or the owner decides to leave the long-term line (watch row W17; restated 2026-11-01: the runtime, not `wasm32-wasip3`, is the constraint) | Owner of the phase that needs async components |
| 2026-11-01 | MCP prompts in AFD servers, the step after step 0a's proposal, when a phase needs workflows as prompts | AFD |
| 2026-11-01 | The `http` and `secrets` grants, each with its required per-instance `allow` list, and moving the instance's `bearer_env` under `secrets` | The first plugin that needs outbound calls; `secrets` by phase 5 |
