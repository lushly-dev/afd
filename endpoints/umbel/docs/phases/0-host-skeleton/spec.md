# Phase 0 specification: host skeleton

| Field | Value |
| --- | --- |
| Phase | 0, host skeleton ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | Repository owner approves; the phase 0 owning agent writes and implements |
| Read first | [STATUS.md](../../STATUS.md), then the [architecture](../../architecture.md) and the [decision log](../../decisions.md) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

## Status

- **State:** approved, implementation in progress (steps 0 to 2 done). Written and revised
  2026-10-31 after an independent review returned "approve after
  must-fixes"; the coordinator's decisions on D29, D32, D33 and D34, made
  under the owner's delegation of 2026-10-31, are recorded as amendments in
  the [decision log](../../decisions.md). The owner approved the
  specification on 2026-10-31 under that delegation (D24), and it merged in
  [#564](https://github.com/lushly-dev/afd/pull/564) as `fb35d525`.
- **Last verified:** 2026-10-31 against `main` at `fb35d525`. Evidence, read
  in `packages/rust`: `FileJournalSink` (`src/journal/file.rs`: caches
  `last_seq`, forbids two processes per file), `create_context_digest`,
  `MiddlewareNext` (takes no arguments), `execute_batch_with_context` (merges
  the request `context` with `or_insert`), `DirectClient::call` (always sets
  the agent interface), `get_bootstrap_commands` and `bootstrap_expose`
  (`mcp: true`, no `cli`), `McpServer::with_confirmations_key` (errors on a
  key under 32 bytes), `default_instructions` (no accessor), `HttpOptions`,
  `tests/common/mod.rs` (crate-level `#![cfg(feature = "server")]`, `rmcp`
  import, drivers over a bare `McpServer`). In TypeScript,
  `createDirectRegistry({ interface })` in `packages/server`; in Python,
  `DirectCommandRegistry(server, interface=...)`. In `scripts/`, the release
  inventory, `check-boundaries.mjs` (`publicSurfaces` default
  `UNMAPPED-native-public-surfaces`) and `repository-contract.test.mjs`.
  Trajectory rows re-checked against primary sources (see
  [Trajectory refresh](#trajectory-refresh)). Relative links and anchors in
  this file resolve.
- **Done:** this specification; the architecture amendments and decisions
  [D28 to D36](../../decisions.md) it needs, with their 2026-10-31
  amendments, in [#564](https://github.com/lushly-dev/afd/pull/564).
- **Done:** step 0, the AFD pull request
  ([#567](https://github.com/lushly-dev/afd/pull/567)), merged as `045b6feb`
  on 2026-10-31 exactly as the [plan](#step-0-the-afd-pull-request) lists it,
  with all nine checks green.
- **Done:** step 1, the scaffold ([#570](https://github.com/lushly-dev/afd/pull/570)),
  merged as `273e0160` on 2026-10-31 as the plan's table lists it, with
  `umbel.yml` green on Linux, macOS and the MSRV leg.
- **Done:** step 2, the workspace ([#572](https://github.com/lushly-dev/afd/pull/572)),
  on 2026-10-31: discovery, `umbel.toml` version 1 with defaults and
  validation, the layout and `Workspace::init`, race-safe keys, the workspace
  lock over AFD's `JournalFileLock`, `doctor::run`, the six schema files with
  their examples, and `workspace.rs`, `doctor.rs` and `schemas.rs`. Checks:
  `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings`,
  the library-only clippy leg, `cargo test --locked` and `cargo +1.97.0 check
  --locked --all-targets`, run locally, then `umbel.yml` and `pnpm check` on
  the pull request. Amendments it needed: see
  [Amendments from step 2](#amendments-from-step-2).
- **Not done:** steps 3 to 6 of the [plan](#11-implementation-plan); the exit
  criterion.
- **Follow-ups not yet issues:** listed in [Follow-ups](#follow-ups) and
  mirrored in [STATUS.md](../../STATUS.md#follow-ups-not-yet-issues).

## What this phase serves

The phase 0 row of the architecture: *the empty host serves MCP and CLI from
one registry with bootstrap discovery, the journal and its event log, and
approvals, from a workspace with defaults.* Exit criterion: *with zero
plugins, the host's built-in commands pass the Rust server's protocol tests in
both MCP eras, and the workspace doctor reports the workspace.* It is item 1
of the proposal's [first proof](../../proposal.md#first-proof), and it keeps
item 4's path open: a harness hook runs the `umbel` CLI against a workspace
that a stdio server is already serving (D29).

| Principle | How phase 0 serves it |
| --- | --- |
| 1. Empty host | No domain command ships; the built-ins describe the workspace and read the event log |
| 3. Everything is a command | One `CommandRegistry` behind MCP, the CLI and the library; only the process verbs `init` and `serve` are not commands (D30) |
| 5. Content lives in the workspace | One deployer-owned directory; every key has a baked default |
| 7. Provenance on everything | Provenance envelope version 0 is defined and carried on every event |
| 11. Stateless and horizontal | No in-memory session state on HTTP; cursors are stored, not held; any number of host processes share one workspace (D29) |
| 12. Small surfaces, measured | The hybrid strategy with two first-class tools by default |
| 14. Every mutation is an event | The event log is a journal projection from the first commit |
| 15. AFD first | Everything below is built on the `afd` crate. The two generic pieces phase 0 lacks, a process-shared file journal and interface selection on Rust's `DirectClient`, land in AFD first as step 0 (D25); phase 0 has no divergence |
| 16. Spaces do not mix | One event stream and one cursor set per space; the default space is configuration |

Decisions served: D1, D5, D8, D13, D14, D19, D20, D21, D22, D23, D24, D25,
D26 and D27, and the new D28 to D36 made here, as amended on 2026-10-31.
Open decisions: O3 stays open, because the manifest is a phase 1 decision and
phase 0 loads no plugin; O1, O4 and O5 do not touch phase 0. O5's reserved
tenant field appears below as a reserved name.

## Trajectory refresh

Refreshed 2026-10-31 for the rows phase 0 depends on. Nothing changed that
alters this specification.

| Row | Checked against | Finding on 2026-10-31 | Effect on phase 0 |
| --- | --- | --- | --- |
| W1 release cycle (R1, R2) | MCP roadmap, last updated 2026-08-22 | Unchanged; next revision 2027-03-30 | Phase 0 pins MCP 2026-07-28 and serves 2025-11-25 clients through `rmcp` |
| W2 MCP Events, SEP-3415 (R1) | The pull request | Still open, not a draft, review required, last updated 2026-10-31; no sponsor recorded | The event and cursor shape stays Umbel's own; poll by cursor only; no stream or webhook projection in phase 0 |
| W5 agent identity (R2) | SEP-1932 and SEP-1933 pull requests; roadmap | Both open; the Agent Identity working group is still forming; human-presence attestation listed as a possible topic | Principal version 0 reserves the delegation chain, token binding and human-presence fields and fills none |
| W6 HTTP over stdio | Roadmap; specification pull requests | A roadmap item for the transports working group; no SEP found | stdio stays newline-delimited JSON-RPC from `rmcp` |
| W12 OpenTelemetry GenAI | The conventions repository | No release or tag | Phase 0 logs to stderr; no telemetry middleware and no OpenTelemetry export |
| W15 Claude Code channels | Channels documentation | Still a research preview; Claude Code does not register a channel server that negotiates 2026-07-28 | Keep the 2025-11-25 era on stdio; nothing to push in phase 0 |
| Library row: `rmcp` | `rmcp` releases | 3.8.0 published 2026-10-26; the `afd` crate's `3.7` requirement resolves it | Umbel commits a lock that pins what CI tested |

## Terms

Terms are the [architecture's glossary](../../architecture.md#12-glossary).
This phase adds four, entered in the glossary in this pull request:
**built-in command** (a command the host registers itself), **state
directory** (the part of the workspace the host writes), **workspace lock**
(the file lock every host process holds across one append to the journal and
its event) and **cursor** (an opaque position in one space's event stream).
"Workspace" alone always means the Umbel workspace; the Cargo one is always
"Cargo workspace".

## 1. Crate layout

One Cargo package, `umbel`, at `endpoints/umbel/`, holding both the host
library and the binary (D35). It is also the root of the Cargo workspace, so
later phases add members beside it without moving it.

```text
endpoints/umbel/
├── Cargo.toml            # [package] umbel + [workspace]
├── Cargo.lock            # committed; this is a binary
├── rust-toolchain.toml   # channel = "1.98.0", components clippy, rustfmt
├── clippy.toml           # allow-unwrap-in-tests = true, allow-expect-in-tests = true
├── README.md             # exists; gains build and run sections
├── schemas/              # versioned JSON Schemas (section 7)
│   ├── workspace-config.v1.json
│   ├── principal.v0.json
│   ├── provenance-envelope.v0.json
│   ├── event.v0.json
│   ├── cursor.v0.json
│   ├── cursor-file.v0.json
│   └── examples/         # one or more instances per schema, validated by tests
├── src/
│   ├── lib.rs            # #![forbid(unsafe_code)]; the public API below
│   ├── main.rs           # the `umbel` binary; requires the `cli` feature
│   ├── workspace/        # discovery, config, layout, the workspace lock, keys
│   ├── commands/         # built-in commands
│   ├── events/           # projection, streams, cursors, catch-up, rebuild
│   ├── principal.rs      # the context hook and principal version 0
│   ├── provenance.rs     # envelope version 0
│   ├── middleware.rs     # space validation and stamp, event stamp
│   ├── surfaces/         # MCP server, HTTP router and bearer layer, stdio, CLI projection
│   └── doctor.rs
├── tests/                # integration tests (section 10); tests/support/ holds the drivers
└── docs/                 # these documents
```

`Cargo.toml`:

```toml
[package]
name = "umbel"
version = "0.1.0"
edition = "2024"
rust-version = "1.97"
publish = false
license = "MIT"
description = "AFD Umbel: an empty host for capability plugins over MCP and CLI"
repository = "https://github.com/lushly-dev/afd"

[workspace]
members = ["."]

[features]
default = ["cli"]
# The `umbel` binary's argument parser. Embedders use default-features = false.
cli = ["dep:clap"]

[[bin]]
name = "umbel"
path = "src/main.rs"
required-features = ["cli"]

[dependencies]
afd = { path = "../../packages/rust", features = ["server", "journal-file-shared"] }
async-trait = "0.1"
axum = { version = "0.8", default-features = false, features = ["http1", "tokio"] }
chrono = { version = "0.4", default-features = false, features = ["clock", "std"] }
clap = { version = "4", features = ["derive"], optional = true }
getrandom = ">=0.3, <0.5"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sha2 = "0.10"
tokio = { version = "1", features = ["fs", "io-std", "io-util", "macros", "net", "rt-multi-thread", "signal", "sync", "time"] }
# preserve_order keeps [spaces.*] in the file's order, which space-list reports.
toml = { version = "1", features = ["preserve_order"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "fmt", "json"] }

[dev-dependencies]
bytes = "1"
http = "1"
http-body-util = "0.1"
# No resolve-http or TLS features: the schemas are checked offline, and reqwest and rustls stay out of the lock.
jsonschema = { version = "0.60", default-features = false }
# The in-memory stdio driver serves the McpServer over a pipe; same requirement as the afd crate.
rmcp = { version = "3.7", default-features = false, features = ["server", "transport-io"] }
tempfile = "3"
tower = { version = "0.5", features = ["util"] }

[lints.rust]
unsafe_code = "forbid"
missing_docs = "warn"
unreachable_pub = "warn"

[lints.clippy]
all = { level = "warn", priority = -1 }
unwrap_used = "warn"
expect_used = "warn"
```

Rules:

- **The `afd` dependency is by path, with the `server` feature, the
  `journal-file-shared` feature that step 0 adds, and the crate's default
  features** (`native`, `journal-file`, `approval`). Umbel never copies code
  from `packages/rust`; a missing generic feature is an AFD change first
  (D25), which is what step 0 is. `sha2` stays on 0.10 and `getrandom` on the
  `afd` crate's range so that one copy of each is built.
- **MSRV 1.97**, as the architecture records for the Cargo workspace. Phase 0
  itself needs 1.89 (`std::fs::File::lock` and `try_lock`, which
  `journal-file-shared` uses, and 1.88 for `server`); the workspace declares
  1.97 now so that phase 1's wasmtime does not raise it mid-stream. The
  pinned toolchain is the repository's, 1.98.0.
- **Formatting** is rustfmt's default, as in `packages/rust`; no
  `rustfmt.toml`. **Lints**: the table above, and CI runs clippy with
  `-D warnings`.
- **`Cargo.lock` is committed.** The repository's `.gitignore` ignores
  `Cargo.lock`; step 1 adds the negation `!endpoints/umbel/Cargo.lock`. CI
  builds with `--locked`.
- **Public library API**, and nothing else public:

| Item | Purpose |
| --- | --- |
| `Host`, `HostBuilder`, `HostError` | Open a workspace, register extra commands before sealing (the seam phase 1's compiled-in loader uses, and tests use for fixtures), seal into a `Host` |
| `Host::registry() -> Arc<CommandRegistry>` | The one registry. A bare `registry.execute` carries no principal: commands that need one answer `UNAUTHORIZED` (section 3) |
| `Host::context(actor: Actor) -> CommandContext` | A context for a library call: the actor, a new trace id, and `extra["dev.umbel/principal"]` filled with transport `library` and authentication `embedder` (section 4) |
| `Host::mcp_server() -> McpServer` | The configured MCP server (section 4) |
| `Host::http_router() -> axum::Router` | `/mcp` (or `http.path`) and `/health`, behind the bearer layer (section 4) |
| `Host::cli_client() -> DirectClient` | What the CLI projection calls through, with the CLI interface (section 4) |
| `RESERVED_VERBS`, `SPACE_NOT_FOUND` | The reserved CLI verbs `seal` refuses; the code of an undeclared space |
| `cli::{run, Environment, Console}` (feature `cli`) | The whole command line as a function: the `umbel` binary calls `run` with the process's terminal; tests call it in process with fixture commands and a scripted `Console` (section 4) |
| `Host::repair_events() -> Result<RepairReport, HostError>` | The full catch-up of section 6, under the workspace lock; `umbel serve` calls it at start |
| `Host::workspace() -> &Workspace`, `Workspace`, `Config`, `SpaceId` | Read-only views of the workspace |
| `Workspace::resolve_space(&self, input: &Value, context: &CommandContext) -> Result<SpaceId, CommandError>` | The one space resolution, used by the space middleware and by every handler (section 5) |
| `doctor::run(path) -> Report`, `Report`, `Check`, `CheckStatus` | The doctor without a sealed host (section 2). `doctor::inspect(discovery result)` and `doctor::run_discovered(flag)` report the workspace the discovery rules find; `Report::into_result` is the `CommandResult`, and a sealed host replaces the two `skip` checks |
| `events::{Event, Cursor}` | Event version 0 and the cursor |
| `principal::Principal`, `provenance::Envelope` | Version 0 of each |
| `CONFIG_VERSION`, `PRINCIPAL_VERSION`, `PROVENANCE_VERSION`, `EVENT_VERSION`, `CURSOR_VERSION` | `1`, `0`, `0`, `0`, `0` |

`HostBuilder::open(path)` reads the workspace and validates `umbel.toml`;
`HostBuilder::register(def)` adds a command; `HostBuilder::seal()` registers
the built-ins and the AFD bootstrap commands, refuses a command whose first
name segment is a reserved CLI verb (section 4), installs the middleware
(section 5), sets the journal, builds the MCP server and validates its
surface (`McpServer::validate`), runs the marker catch-up of section 6, and
returns the `Host`. Commands cannot be added after `seal`, which keeps the
hybrid set fixed while serving
([H2](../../../../../spec/tool-strategies.md#h2-validation-at-construction)).

`seal` maps the errors of the `afd` builders it calls: a key shorter than 32
bytes, which `McpServer::with_confirmations_key` and the approval middleware
refuse, is `WORKSPACE_KEY_INVALID` naming the file; `McpServer::validate`'s
message is `WORKSPACE_CONFIG_INVALID` naming `mcp.first_class_tools`; a
reserved CLI verb or a name collision is `WORKSPACE_CONFIG_INVALID` naming
the command. Every `HostError` converts into a failure `CommandResult` with
that code and the suggestion in section 3.

### Repository placement

- **Release inventory.** Step 1 adds one unit to
  `scripts/release/inventory.json`, quarantined, with no route, because the
  crate is `publish = false`:

```json
{
  "id": "umbel",
  "family": "umbel",
  "protocol": "language-tag-v1",
  "sourceRevision": "<the main commit step 1 branches from>",
  "authority": "none: new endpoint authored in lushly-dev/afd; the crate is publish = false and cannot publish; no route, registry identity or release exists",
  "state": "quarantined",
  "routes": [],
  "gates": ["umbel.yml", "release-approval"],
  "fixed": false,
  "distributions": [
    {
      "name": "umbel",
      "registry": "crates",
      "manifest": "endpoints/umbel/Cargo.toml",
      "format": "rust",
      "initialVersion": "0.1.0",
      "private": true
    }
  ]
}
```

- **`architecture.json`** gains one explicit unit, as Botcore and Health
  have. The boundary check would classify `endpoints/umbel/Cargo.toml` by its
  path as an endpoint unit of the `umbel` family anyway, but without an
  explicit unit its coverage map reads `UNMAPPED-native-public-surfaces`:

```json
{
  "manifest": "endpoints/umbel/Cargo.toml",
  "family": "umbel",
  "layer": "endpoint",
  "publicSurfaces": [
    "rust-library",
    "bin:umbel",
    "umbel serve --stdio",
    "umbel serve --http",
    "workspace-config-1",
    "principal-0",
    "provenance-envelope-0",
    "event-0",
    "cursor-0"
  ]
}
```

  The path dependency on `packages/rust` is an endpoint to foundation edge,
  which is allowed. Because the manifest has a `[package]`, both the boundary
  check and the release control read its identity; a virtual workspace
  manifest would fail the boundary check's identity read, which is one reason
  for the single package.
- **Repository contract.** Step 1 adds a test to
  `scripts/repository-contract.test.mjs`, beside Health's: the `umbel` unit
  is quarantined with `routes: []` and the one private distribution above;
  `assertAdmission` refuses it for any route; `discoverDistributions` never
  yields it; `architecture.json` holds the unit above; no workflow other than
  `umbel.yml` names it; and `umbel.yml` has `contents: read` and no
  `publish`, `upload`, `id-token` or `secrets.`.
- **`AGENTS.md`** gains the `umbel.yml` row in the CI table and a key rule:
  "Changed `endpoints/umbel/`? `pnpm check` does not build it. Run
  `cd endpoints/umbel && cargo fmt --check && cargo clippy --locked --all-targets -- -D warnings && cargo test --locked`."
  The architecture listing line for `endpoints/umbel/` changes from
  "documents only" to "host skeleton; quarantined".

### CI workflow `umbel.yml`

```yaml
name: Umbel

on:
  push:
    branches: [main]
    paths:
      - 'endpoints/umbel/**'
      - '!endpoints/umbel/docs/**'
      # Umbel depends on the afd crate by path.
      - 'packages/rust/**'
      - '.github/workflows/umbel.yml'
  pull_request:
    branches: [main]
    paths:
      - 'endpoints/umbel/**'
      - '!endpoints/umbel/docs/**'
      - 'packages/rust/**'
      - '.github/workflows/umbel.yml'

permissions:
  contents: read

env:
  CARGO_TERM_COLOR: always

jobs:
  check:
    name: Umbel (fmt, clippy, test)
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 25
    defaults:
      run:
        working-directory: endpoints/umbel
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - name: Install Rust toolchain
        run: rustup toolchain install
      - name: Cache cargo
        uses: Swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6 # v2.9.2
        with:
          workspaces: endpoints/umbel
      - name: Format
        run: cargo fmt --check
      - name: Clippy
        run: cargo clippy --locked --all-targets -- -D warnings
      - name: Clippy (library only, no default features)
        run: cargo clippy --locked --lib --no-default-features -- -D warnings
      - name: Test
        run: cargo test --locked

  msrv:
    name: Umbel (MSRV 1.97)
    runs-on: ubuntu-latest
    timeout-minutes: 20
    defaults:
      run:
        working-directory: endpoints/umbel
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - name: Install Rust 1.97
        run: rustup toolchain install 1.97.0 --profile minimal
      - name: Cache cargo
        uses: Swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6 # v2.9.2
        with:
          workspaces: endpoints/umbel
          key: msrv
      - name: Check
        run: cargo +1.97.0 check --locked --all-targets
```

The action SHAs are the ones `rust.yml` pins on 2026-10-31; Dependabot keeps
them current. Windows is not in the matrix in phase 0 (see
[Follow-ups](#follow-ups)).

## 2. The workspace

### Layout

```text
<workspace>/
├── umbel.toml                       # configuration, deployer-owned
├── spaces/                          # content, deployer-owned; reserved until phase 2
│   └── <space>/
└── state/                           # written by the host; deployers git-ignore it
    ├── lock                         # the workspace lock (D29); empty
    ├── journal.jsonl                # the AFD journal, one per deployment
    ├── projection.pending           # present only while an event may be missing (section 6)
    ├── keys/
    │   ├── approval.key             # 32 random bytes, mode 0600
    │   ├── confirmation.key         # 32 random bytes, mode 0600
    │   └── http.token               # 64 lowercase hex characters, mode 0600; created at first serve --http
    └── spaces/
        └── <space>/
            ├── events.jsonl         # the space's event stream
            └── cursors/
                └── <cursor-key>.json
```

`umbel init [dir] [--name <name>]` creates `umbel.toml` (only
`config_version = 1` and, when given, `name`), `spaces/main/`, `state/` with
the approval and confirmation keys, and a `state/.gitignore` containing `*`.
It refuses a directory that already holds `umbel.toml` (exit 1,
`ALREADY_EXISTS`). A host that opens a workspace creates any missing `state/`
directory and any missing key the same way, so a hand-written `umbel.toml`
works without `init`.

**Key creation is race-safe**, because several processes may open a new
workspace at once: the host writes the random bytes to a temporary file in
`state/keys/` (mode 0600 on Unix), then `std::fs::hard_link`s it to the final
name, which fails with `AlreadyExists` exactly as `create_new` does when
another process won; the host then removes its temporary file and reads the
winner's key. A reader never sees a partly written key. Every process of a
workspace therefore shares one confirmation key, so a confirmation
`requestState` issued by one process is accepted by another.

`<cursor-key>` is the lowercase hex SHA-256 of
`<actor kind>:<actor id>:<consumer>` (section 6), so no caller-chosen string
becomes a path.

### Finding the workspace

In order, the first that applies:

1. the `--workspace <dir>` flag;
2. the `UMBEL_WORKSPACE` environment variable;
3. the nearest directory, from the current directory upward to the
   filesystem root, that contains `umbel.toml`.

Nothing found is `WORKSPACE_NOT_FOUND`. There is no implicit workspace in a
home directory: a host that writes state somewhere the deployer did not choose
is a surprise. Harness configurations should always pass `--workspace`.

### Configuration: `umbel.toml`, version 1

Every key has a default baked into the binary, so a file holding only
`config_version = 1` is a complete workspace with one space, `main`. Unknown
keys are an error (`WORKSPACE_CONFIG_INVALID`, naming the key); keys marked
reserved are accepted, unused, and reported by the doctor as warnings.

```toml
config_version = 1          # required; the host refuses any other value
name = "my-team"            # default: the workspace directory's name
default_space = "main"      # default: "main" when no [spaces] table, the only space when there is one
profile = "team"            # only "team" in phase 0; reserved for other profiles

[spaces.main]               # default: one space, "main"
title = "Main"              # default: the id
# content_roots = []        # reserved (phase 2)
# backend = "embedded"      # reserved (phase 6)

[plugins]
enabled = []                # must be empty in phase 0; the loader is phase 1

[mcp]
# first_class_tools = [...] # default: computed (see "The first-class default" in section 3); 1 to 8 names (H1, H5)
tools_list_ttl_ms = 300000  # default
confirmations = "enforce"   # "enforce" (default), "require-human" or "off"
instructions = ""           # default: empty, meaning AFD's default hybrid instructions, unchanged

[http]
bind = "127.0.0.1:7410"     # default; must be a loopback address in phase 0 (D32)
path = "/mcp"               # default; starts with "/", is not "/" and not "/health"
allowed_hosts = []          # added to the loopback names and the bound IP; "*" refused
allowed_origins = []        # exact http(s) origins; "*" and "null" refused
max_body_bytes = 1048576    # default 1 MiB; 1024 to 16777216

[journal]
record_failures = true      # default
lock_timeout_ms = 10000     # default; 100 to 600000; how long an append waits for the workspace lock

[events]
# retention = "forever"     # reserved; phase 0 keeps every event

[log]
level = "info"              # "error", "warn", "info", "debug" or "trace"
format = "text"             # "text" or "json"

[principal]
local_id = "local"          # the actor id of the local CLI and stdio callers
# on_behalf_of = "..."      # optional: the person a local agent acts for
```

Validation, each a `WORKSPACE_CONFIG_INVALID` naming the key, at `open`:

- A space id matches `^[a-z][a-z0-9-]{0,62}$`. Ids are identity: renaming one
  is a new space.
- `default_space` names a declared space. Several spaces and no
  `default_space` is an error.
- `mcp.first_class_tools`, when set, has 1 to 8 entries, each a valid command
  name; whether each names a registered MCP-exposed command is checked at
  `seal` (H2), and `McpServer::validate`'s message is passed through.
- `http.bind` parses as a socket address whose IP is loopback
  (`127.0.0.0/8` or `::1`). The port may be 0 (tests).
- `http.path` starts with `/`, is not `/`, is not `/health`, and has no
  query, fragment or `..` segment.
- `http.allowed_hosts` entries are host names or IP literals, optionally with
  a port; `*`, and any entry containing `*`, is refused.
- `http.allowed_origins` entries are exact `http` or `https` origins; `*` and
  `null` are refused.
- `journal.lock_timeout_ms` is 100 to 600000.
- `principal.local_id` is 1 to 128 printable characters.
- `profile` is `team`, and `plugins.enabled` is empty, because phase 0 loads
  no plugin; a host that ignored a configured plugin would be wrong. The
  doctor reports the second as `plugins.none`.
- `name` is non-empty text without control characters; `mcp.confirmations`,
  `log.level` and `log.format` are one of their listed values;
  `max_body_bytes` is 1024 to 16777216.

The machine-readable schema is `schemas/workspace-config.v1.json` (section 7).

### Configuration precedence

Command-line flags, then environment variables, then `umbel.toml`, then the
baked defaults. The environment variables are exactly: `UMBEL_WORKSPACE`,
`UMBEL_LOG` (a `tracing` filter, overrides `log.level`) and `UMBEL_HTTP_BIND`
(overrides `http.bind`, still loopback only). The flags are listed in
[section 4](#cli).

### The workspace lock

Any number of host processes may open one workspace at once (D29): stdio
servers from different harness sessions, an HTTP server, and one-shot CLI
commands such as a harness hook's. Phase 0 stores only append-only files and
atomically renamed files, which makes this safe under these rules:

- **Writes take the workspace lock.** Every append, to the journal and to an
  event stream, happens while holding an exclusive OS lock on `state/lock`
  (`std::fs::File::lock`, through AFD's `JournalFileLock`, step 0). One lock
  is held across the journal append **and** the event append of the same
  call, so events enter each stream in journal order.
- **Sequence numbers come from the file, under the lock.** The journal's next
  `seq` and a stream's next `seq` are read from the tail of the file while
  the lock is held, never from a cached value, because another process may
  have appended since.
- **Readers take no lock.** The journal and event readers tolerate a torn
  last line (an append in flight, or a crash mid-append): they skip it when
  it is not a complete line. The next locked append repairs it as
  `FileJournalSink` does today.
- **Cursor files are written by atomic rename**: a temporary file in the same
  `cursors/` directory, then `rename` over the target. No lock: the last
  writer wins, and a reader sees the old or the new file, never a mix.
- **Keys are created race-safe** (above) and then only read.
- **Approval nonces stay in memory**, per process. Approval tokens never
  leave the process that issued them (section 4), so nothing needs sharing.
- **Repairs hold the lock for their whole run**: the marker catch-up at
  `seal`, the full catch-up of `Host::repair_events`, and `event-rebuild`
  (section 6).
- **Lock timeout.** An append waits up to `journal.lock_timeout_ms` (default
  10 seconds) for the lock. Appends hold it for milliseconds, so a timeout
  means another process is running a long repair or is stuck. Where it
  arises, and what the caller sees:
  - opening a workspace (`seal`'s marker catch-up) and `Host::repair_events`:
    the open fails with `WORKSPACE_LOCK_TIMEOUT`; the CLI prints the failure
    and exits 1, and `umbel serve` writes it to stderr and exits 1;
  - `event-rebuild`, and `event-list` or `space-list` when they must catch up
    first: the command's result is the failure `WORKSPACE_LOCK_TIMEOUT`;
  - the journal append of any other command: the command has already run,
    and by AFD's journal rule a sink failure never changes its result. The
    entry and its event are not written; the recorder's `on_error` logs the
    failure at `error` with the code, the command name and the trace id. The
    [Follow-ups](#follow-ups) carry the fail-closed question to phase 2.

The lock assumes a local filesystem: advisory locks on network filesystems
are not reliable, and phase 0 does not support a workspace on one (see
[section 9](#9-out-of-scope-and-the-seams-reserved)).

There is no read-only open. Under D29 every process may write; a workspace
whose `state/` is not writable fails to open with
`WORKSPACE_STATE_UNWRITABLE`, and `doctor::run` still reports it.

### `workspace-doctor`

The doctor runs as the `workspace-doctor` command on a sealed host and as
`doctor::run(path)` on a workspace that cannot be opened, which is how
`umbel workspace doctor` still reports a broken `umbel.toml`. Both return the
same `CommandResult`. Each check has an id, a status (`pass`, `warn`, `fail`
or `skip`), a message and, for `warn` and `fail`, a suggestion. `skip` means
the check could not run here; `doctor::run` reports the registry-dependent
checks as `skip` with the message "Needs a sealed host; run umbel workspace
doctor on a workspace that opens." A check that needs a readable `umbel.toml`
(`config.keys`, `spaces.valid`, `http.config`, `plugins.none`) is also `skip`
when `config.parse` failed, with the message "Needs a readable umbel.toml;
config.parse failed.". A skipped check never makes the workspace unhealthy.
`config.parse` fails for a syntax error, another version, and any value that
breaks a rule no other check owns (`name`, `profile`, `[mcp]`, `[journal]`,
`[log]`, `[principal]`), so a workspace that will not open is never reported
healthy. When no workspace is found, the report holds `workspace.found` alone.

| Id | Passes when | `warn` | `fail` | Without a sealed host |
| --- | --- | --- | --- | --- |
| `workspace.found` | A workspace was found; reports the path and which rule found it | | Not found | Runs |
| `config.parse` | `umbel.toml` parses and `config_version` is 1 | | Parse error; another version (names the supported one) | Runs |
| `config.keys` | Every key is known and unreserved | A reserved key is set | An unknown key | Runs |
| `spaces.valid` | Ids valid, `default_space` declared | | Either rule broken | Runs |
| `state.writable` | `state/` and each space's state directory exist and are writable, or can be created | | Not writable | Runs |
| `state.lock` | The workspace lock is taken and released within `journal.lock_timeout_ms` | Taking it waited longer than 1 second (another process held it) | Not taken within the timeout | Runs |
| `keys.present` | The approval and confirmation keys exist with 32 bytes or more and, on Unix, mode 0600; `http.token`, when present, is 64 lowercase hex characters with mode 0600 | Wider permissions | Missing and cannot be created, shorter, or a malformed token | Runs |
| `journal.readable` | The journal parses as AFD JSON Lines; reports the entry count and last `seq` | A torn last line | An unparsable entry before the last line | Runs |
| `events.consistent` | Each stream parses, `seq` increases from 1, `journalSeq` increases, no `projection.pending` marker, and the projection has caught up with the journal | Behind the journal, or the marker is present (suggests `umbel event rebuild`) | Unparsable, or `journalSeq` out of order | Runs |
| `http.config` | `http.bind` is loopback, `http.path` is valid, no allowed host is a wildcard, and every origin is exact | | Any rule broken | Runs |
| `mcp.surface` | The first-class set validates against the registry | | The message from `McpServer::validate` | `skip` |
| `cli.verbs` | No command's first name segment is a reserved CLI verb (section 4) | | A command named | `skip` |
| `plugins.none` | `plugins.enabled` is empty | | Not empty: plugins arrive in phase 1 | Runs |

Output (`data`):

```json
{
  "workspace": "/abs/path",
  "foundBy": "flag",
  "healthy": true,
  "checks": [
    { "id": "config.parse", "status": "pass", "message": "umbel.toml is configuration version 1" }
  ]
}
```

`foundBy` is `flag`, `env` or `search`. When no check fails, the result is a
success, `healthy: true`, with one warning per `warn` check (code
`DOCTOR_<ID>` with dots as underscores, such as `DOCTOR_STATE_LOCK`). When any
check fails, the result is the failure `WORKSPACE_UNHEALTHY`, with the same
object as `details` and the first failing check's suggestion, so the CLI exits
1 and an agent sees the failure.

## 3. Built-in commands

Every name follows D22 and is checked by the registry. Every error below
carries a suggestion. Input schemas are closed (`additionalProperties:
false`). Every command declares `returns`, so its first-class tool carries
`outputSchema`.

**Exposure.** Each command sets every `expose` flag explicitly:

| Command | Mutation | `palette` | `mcp` | `agent` | `cli` | First-class by default | Purpose |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `workspace-show` | No | false | true | true | true | Yes, first | What this deployment is: name, spaces, default space, versions |
| `event-list` | No | false | true | true | true | Yes, second | Read one space's events after a cursor |
| `event-ack` | Yes | false | true | true | true | No | Store the caller's cursor in a space |
| `space-list` | No | false | true | true | true | No | The spaces, with stream heads |
| `workspace-doctor` | No | false | true | true | true | No | The checks in section 2 |
| `event-rebuild` | Yes | false | false | false | true | No | Rebuild one or every event stream from the journal |
| `afd-help`, `afd-docs`, `afd-schema` | No | AFD's | true | true | true | No | AFD's bootstrap commands |

`event-rebuild` rewrites host state, so no agent reaches it: not over MCP, and
not through an embedder's in-process agent, whose `DirectClient` uses the
agent interface. Only the CLI (the CLI interface) and trusted host code
(`registry.execute` with no interface) can run it.

The bootstrap commands are not registered with `register_bootstrap_commands`,
because AFD exposes them to MCP, the palette and the agent but not the CLI
(`bootstrap_expose`). `seal` takes AFD's own definitions from
`get_bootstrap_commands(&registry)`, adds `cli: true` to each with
`with_expose`, keeps every other flag, and registers them. They are AFD's
code unchanged; only the exposure differs.

### The first-class default

With zero plugins the hot path is "what is this host and its spaces" at
session start and "what changed since my cursor" during a session, so the
default set is `workspace-show` then `event-list` (D31), leaving six of the
eight places for plugins. When `mcp.first_class_tools` is absent, the set is
computed by one function, `surfaces::default_first_class_tools(&registry)`,
which returns those two in phase 0. That function is the seam by which the
default changes once plugins add hot-path tools: phase 1 extends it from what
plugin manifests declare (O3). A deployer's explicit `mcp.first_class_tools`
always wins.

Under the hybrid strategy the MCP `tools/list` is therefore exactly
`afd-discover`, `afd-detail`, `afd-call`, `afd-batch`, `afd-pipe`,
`workspace-show`, `event-list` (no AFD contexts are configured in phase 0).

### Trusted keys

The host owns three keys, and no caller can set them:

- `CommandContext.extra["dev.umbel/principal"]`: set by the context hook on
  every MCP call, by the CLI, and by `Host::context`, always overwriting
  (section 4). Because AFD's `afd-batch` merges the request's `context` into
  `extra` with `or_insert`, a value already set by the hook cannot be
  replaced from a batch request. Commands take the caller's identity **only**
  from this key, never from `context.actor` alone, and never from any other
  `dev.umbel/` key in `extra`, which they ignore.
- `result.metadata["dev.umbel/space"]` and
  `result.metadata["dev.umbel/mutation"]`: always written by the space and
  stamp middleware after the handler returns, overwriting or removing what a
  handler set (section 5).

### `workspace-show`

- **Input:** `{}`.
- **Output:**

```json
{
  "name": "my-team",
  "workspace": "/abs/path",
  "defaultSpace": "main",
  "profile": "team",
  "spaces": [{ "id": "main", "title": "Main" }],
  "host": { "name": "umbel", "version": "0.1.0", "afdContract": "<CONTRACT_VERSION>" },
  "versions": { "config": 1, "principal": 0, "provenance": 0, "event": 0, "cursor": 0 },
  "surfaces": { "toolStrategy": "hybrid", "firstClassTools": ["workspace-show", "event-list"] },
  "plugins": []
}
```

- **Errors:** none of its own.

### `space-list`

- **Input:** `{}`.
- **Output:** `{ "spaces": [{ "id", "title", "default": bool, "events": integer, "head": cursor }] }`,
  in configuration order. `head` is `v0:<space>:0` for an empty stream.
- **Errors:** `WORKSPACE_LOCK_TIMEOUT` when it must catch up first
  (section 6).

### `event-list`

- **Input:** `{ "space"?: string, "after"?: cursor, "limit"?: integer 1..1000 (default 100), "consumer"?: string }`.
  Without `after`, reading starts after the cursor the caller acknowledged for
  `consumer`, or after `v0:<space>:0` when it has none. A call without a
  principal (a bare `registry.execute`) has no acknowledged cursor.
- **Output:**

```json
{
  "space": "main",
  "consumer": "default",
  "events": [ "<event version 0>" ],
  "cursor": "v0:main:42",
  "acknowledged": "v0:main:40",
  "head": "v0:main:57",
  "hasMore": true
}
```

  `cursor` is the cursor of the last returned event, or the starting cursor
  when none was returned. It is never `null`: `v0:<space>:0` is the cursor
  before the first event, so an empty stream answers `cursor`,
  `acknowledged` and `head` all `v0:<space>:0`. `cursor` is not stored: the
  caller acknowledges with `event-ack`.
- **Errors:** `SPACE_NOT_FOUND`; `INVALID_CURSOR`; `VALIDATION_ERROR` for
  `limit` or `consumer`; `WORKSPACE_LOCK_TIMEOUT` when it must catch up
  first.

### `event-ack`

- **Input:** `{ "space"?: string, "cursor": cursor, "consumer"?: string }`.
- **Output:** `{ "space", "consumer", "acknowledged": cursor, "previous": cursor }`.
  `previous` is `v0:<space>:0` when nothing was stored. Any valid cursor of
  the space may be stored, including an earlier one, which is how a consumer
  replays.
- **Errors:** `SPACE_NOT_FOUND`; `INVALID_CURSOR`; `VALIDATION_ERROR` for
  `consumer`; `UNAUTHORIZED` when the context has no
  `extra["dev.umbel/principal"]` or its actor has no id (only possible
  through the library), with the suggestion "Call through Host::context(actor)
  with an actor that has an id."
- It is journaled like any command, but never projected into an event
  (section 6).

`consumer` names one reader among the sessions of one principal. Every stdio
server of a workspace acts as the same local principal (section 4), so two
harness sessions that share the default consumer overwrite each other's
cursor, last writer wins. A session that needs its own position passes its
own `consumer`, such as its session id. It matches
`^[a-z0-9][a-z0-9._-]{0,63}$` and defaults to `default`.

### `workspace-doctor`

- **Input:** `{}`. **Output:** section 2. **Errors:** `WORKSPACE_UNHEALTHY`.

### `event-rebuild`

- **Input:** `{ "space"?: string }`; absent means every space.
- **Output:** `{ "rebuilt": [{ "space", "events": integer, "head": cursor }] }`.
- Holds the workspace lock for its whole run, rewrites each stream from the
  journal into a temporary file and renames it over the old one, then removes
  `projection.pending`. Cursors are kept, and stay meaningful because the
  projection is deterministic.
- **Errors:** `SPACE_NOT_FOUND`; `WORKSPACE_LOCK_TIMEOUT`.

### Error codes

These are Umbel package codes, in the sense of AFD's
[error codes](../../../../../spec/error-codes.md#other-codes-a-result-can-carry):
they do not join the shared catalog. Every other code a result carries is
AFD's.

| Code | Meaning | Retryable | Suggestion |
| --- | --- | --- | --- |
| `SPACE_NOT_FOUND` | The space is not declared in this workspace | No | "Call space-list for the spaces of this workspace." |
| `INVALID_CURSOR` | The cursor is malformed, of another space, or past the head | No | "Use a cursor returned by event-list for this space, or omit it to start after your acknowledged cursor." |
| `WORKSPACE_NOT_FOUND` | No workspace was found | No | "Pass --workspace <dir>, set UMBEL_WORKSPACE, or run umbel init." |
| `WORKSPACE_CONFIG_INVALID` | `umbel.toml` is invalid, or a command breaks a registration rule; the message names the key or the command | No | Names the rule broken |
| `WORKSPACE_CONFIG_UNSUPPORTED` | `config_version` is not 1 | No | "This umbel reads configuration version 1; upgrade umbel or migrate umbel.toml." |
| `WORKSPACE_STATE_UNWRITABLE` | `state/` cannot be created or written | No | "Make <path> writable by this user, or point --workspace at a workspace you can write." |
| `WORKSPACE_KEY_INVALID` | A key file is shorter than 32 bytes or, for `http.token`, malformed | No | "Delete <file>; the next open creates a new key. Pending confirmations, and HTTP clients holding the old token, must start again." |
| `WORKSPACE_LOCK_TIMEOUT` | The workspace lock was not taken within `journal.lock_timeout_ms` | Yes | "Another umbel process held the workspace lock for more than <ms> ms, usually during umbel event rebuild. Retry when it finishes; if no umbel process is running, run umbel workspace doctor." |
| `WORKSPACE_UNHEALTHY` | A doctor check failed | No | The first failing check's suggestion |

The `WORKSPACE_*` codes other than `WORKSPACE_UNHEALTHY` and
`WORKSPACE_LOCK_TIMEOUT` come only from opening the workspace, so only the
CLI and the library return them; a server that cannot open its workspace does
not start (section 4). `WORKSPACE_LOCK_TIMEOUT` is also a command result, as
section 2 lists. The lock is shared and never refuses a second process, so
there is no "locked" error.

## 4. Surfaces

### MCP

`Host::mcp_server()` builds one `McpServer`:

```text
McpServer::new(registry, "umbel", env!("CARGO_PKG_VERSION"))
  .with_tool_strategy(ToolStrategy::Hybrid)
  .with_first_class_tools(first_class)            // mcp.first_class_tools, else the computed default
  .with_tools_list_ttl_ms(config.mcp.tools_list_ttl_ms)
  .with_confirmations_key(config.mcp.confirmations, state/keys/confirmation.key)?
  .with_context_hook(principal::hook(transport, config.principal))
  .with_instructions(config.mcp.instructions)     // only when non-empty
```

- **Instructions.** When `mcp.instructions` is empty, the server sends AFD's
  default hybrid instructions unchanged. The `afd` crate has no accessor for
  its default text, so Umbel cannot append a line to it without copying it;
  the [Follow-ups](#follow-ups) record the accessor as a possible AFD
  addition. A non-empty value replaces the default entirely.
- **stdio:** `umbel serve --stdio` calls `serve_stdio`. stdout carries only
  JSON-RPC; every log line goes to stderr.
- **Streamable HTTP:** `umbel serve --http [--bind <addr>] [--print-token]`
  binds a `tokio::net::TcpListener` and serves `Host::http_router()`: the
  `try_streamable_http_service` mounted with `nest_service` at `http.path`,
  and `GET /health` answering 200 with `{"status":"ok"}`, both behind the
  bearer layer below. Its `HttpOptions` come from configuration:
  `allowed_hosts` is the loopback names (`localhost`, `127.0.0.1`, `[::1]`,
  AFD's default), plus the bound IP when it is another loopback address (such
  as `127.0.0.2`, or `[::1]` already listed), plus `http.allowed_hosts`;
  `allowed_origins` is `http.allowed_origins`, and AFD refuses every browser
  `Origin` when it is empty; `max_body_bytes` is `http.max_body_bytes`.
  On start the host writes one stderr line,
  `umbel listening on http://<addr><path> (token in <workspace>/state/keys/http.token)`,
  with the bound port (tests bind port 0 and read it); with `--print-token`
  it also prints the token alone, once, on stdout, which HTTP mode does not
  otherwise use. SIGINT and SIGTERM stop accepting, finish requests in flight
  for up to 10 seconds and exit 0.
- **The bearer layer** is access control, not identity (D32, as amended).
  Loopback is reachable by every process and every user on the machine, so
  every HTTP request, `/health` included, must carry
  `Authorization: Bearer <token>`, where the token is the content of
  `state/keys/http.token`: 32 random bytes as 64 lowercase hex characters,
  created race-safe (section 2) with mode 0600 at the first `serve --http`
  and reused after. The layer compares the SHA-256 digests of the presented
  and stored tokens, so the comparison time does not depend on the token. A
  missing or wrong token is HTTP 401 with `WWW-Authenticate: Bearer
  realm="umbel"` and the body
  `{"error":"UNAUTHORIZED","suggestion":"Send Authorization: Bearer <token>; the token is in <workspace>/state/keys/http.token, readable by the workspace owner."}`,
  before AFD's Host and Origin checks run. A valid token says nothing about
  who calls: the actor is still the one loopback principal. To rotate the
  token, delete the file and restart the server. Phase 5's MCP Authorization
  layer replaces this layer.
- **Startup failures.** Any failure before `serve` is serving (the workspace
  does not open, `seal` fails, the address is in use, the token cannot be
  created) is written to stderr as one failure `CommandResult` in JSON on a
  single line, and the process exits 1. Nothing is written to stdout, which
  on stdio belongs to JSON-RPC.
- **Both eras** come from the `afd` crate: 2026-07-28 statelessly, 2025-11-25
  through `initialize`. Phase 0 adds nothing to either.
- **Approval tokens never travel over MCP.** The approval middleware is
  installed with `with_include_token(false)` (architecture section 8). The
  MCP approval relay is phase 4, so until then an approval-gated command
  called over MCP answers `APPROVAL_REQUIRED` with no token, which is the
  intended behaviour.

### The context hook, version 0

The hook sets the actor and the principal projection (section 7) on every
`tools/call`, per request, always overwriting
`extra["dev.umbel/principal"]`. Phase 0 has no authentication (phase 5), so
the hook never reads identity from the request: no header, no query
parameter, and not the bearer token (D32).

| Transport | `actor` | `principal.authentication` |
| --- | --- | --- |
| stdio | `{ kind: "agent", id: <principal.local_id>, onBehalfOf: <principal.on_behalf_of> when set }` | `"process"`: the process boundary is the trust boundary |
| Streamable HTTP | `{ kind: "agent", id: "loopback" }` | `"none"`: the bearer token grants access, every caller is the same principal |
| CLI | `{ kind: "human", id: <principal.local_id> }` | `"process"` |
| Library | The actor passed to `Host::context(actor)` | `"embedder"` |

The principal goes into `CommandContext.extra["dev.umbel/principal"]`. The
journal keeps the actor, the interface and the trace id; every other context
key, this one included, enters the journal only by name, inside
`contextDigest.hash`, never by value
([journal](../../../../../spec/journal.md#context-digest-no-secrets)).
Phase 5 replaces the HTTP row with the verified caller from the MCP
Authorization layer and lifts the loopback restriction; nothing else in the
hook changes.

### CLI

```text
umbel [--workspace <dir>] [--format json|text] [--log <filter>] <verb or command> [args]

umbel init [dir] [--name <name>]                 process verb (D30)
umbel serve (--stdio | --http) [--bind <addr>] [--print-token]
umbel help [<filter>] [--full]                   afd-help { filter, format: "brief" | "full" }
umbel docs [<command>]                           afd-docs { command }
umbel schema [--format json|typescript]          afd-schema { format }
umbel call <command> [json | key=value ...] [--approve] [--yes]
umbel batch '<afd-batch request JSON>' | <file.json>
umbel <domain> <action> [json | key=value ...] [--approve] [--yes]   = umbel call <domain>-<action>
```

- **Flags.** `--format json|text` goes before the verb; `umbel schema` has its own
  `--format json|typescript` after it. `--workspace` and `--log` may go anywhere
  before the command's input; every word after a command name is input, except
  `--approve` and `--yes`, wherever they are.
- **Reserved verbs.** `init`, `serve`, `help`, `docs`, `schema`, `call` and
  `batch` are reserved CLI verbs: `seal` refuses a command whose name's first
  segment is one of them (`WORKSPACE_CONFIG_INVALID`), so the projection
  never shadows a command. `umbel call <command>` reaches any CLI-exposed
  command by its full name.
- **Projection.** `umbel workspace doctor` is `umbel call workspace-doctor`;
  the split is at the first `-` of the command name, so a command named
  `a-b-c` is `umbel a b-c`.
- **Arguments** parse as the AFD CLI does: one JSON object, or
  whitespace-separated `key=value` pairs whose value is JSON when it parses
  and a string otherwise. A word without `=` is `INVALID_INPUT`.
- **Execution** goes through `Host::cli_client()`, a `DirectClient` built
  with `with_interface(CommandInterface::Cli)` (step 0) and an approval hook.
  The registry then enforces `expose.cli`: an unknown name is
  `COMMAND_NOT_FOUND` with suggestions drawn only from CLI-exposed names, and
  a registered command not exposed to the CLI is `COMMAND_NOT_EXPOSED`, as
  AFD's [unknown and unexposed commands](../../../../../spec/error-codes.md#unknown-and-unexposed-commands-d4)
  rule says for an in-process registry called with an interface.
- **Approvals.** When stdin and stderr are both terminals, the hook shows the
  summary on stderr and asks `Approve? [y/N]`; with `--approve` it approves
  once without asking; with neither and no terminal the token-free
  `APPROVAL_REQUIRED` result is printed unchanged. This is the AFD CLI's
  behaviour.
- **Confirmations.** The CLI enforces `confirm_prompt`, which the in-process
  registry does not: before calling a command that declares one (under
  `mcp.confirmations` `enforce` or `require-human`), when stdin and stderr are
  both terminals it writes the prompt to stderr and asks `Proceed? [y/N]`; a
  refusal is `CONFIRMATION_DECLINED`. With `--yes` it proceeds without
  asking, except under `require-human`, where `--yes` is refused and only a
  terminal answer counts. With no terminal and no `--yes` the result is
  `CONFIRMATION_REQUIRED` with the suggestion "Run it at a terminal, or pass
  --yes." With `mcp.confirmations = "off"` the CLI asks nothing.
- **Help, docs and schema** run `afd-help`, `afd-docs` and `afd-schema`
  through the same `cli_client()`, so they are journaled like any command
  and, because the context's interface is the CLI, AFD's bootstrap handlers
  list and describe exactly the CLI-exposed commands, `event-rebuild`
  included.
- **Batch.** `umbel batch` takes an `afd-batch` request **object**,
  `{ "commands": [...], "options"?: {...}, "context"?: {...} }`, as a JSON
  argument or a path ending in `.json`; this differs from `afd batch`, which
  takes a bare array of commands. It runs the request with
  `CommandRegistry::execute_batch_with_context` under the CLI's context, with
  `interface: Cli` and the principal already set, so each item is checked
  against `expose.cli` by the registry and the request's `context` cannot
  replace the principal. Its items do not use the approval or confirmation
  exchange: an approval-gated item answers `APPROVAL_REQUIRED`, as
  `afd-batch` steps do over MCP. The printed JSON is the AFD batch result.
- **Output.** In JSON mode, the default (agent first; harness adapters are
  scripts over it), stdout holds exactly one JSON document: the
  `CommandResult` as the same JSON value `afd call --format json` prints,
  written with two-space indentation (`serde_json::to_writer_pretty`) and a
  final newline. Errors that occur before a command runs (usage, workspace)
  are printed as a failure `CommandResult` too. `--format text` prints the
  AFD CLI's text layout; every string taken from a result is first cleaned of
  terminal control characters and escape sequences by the rules of the AFD
  CLI's `sanitizeForTerminal` (`packages/cli/src/terminal.ts`): every C0
  control except newline and tab, DEL, every C1 control, and CSI, OSC, DCS,
  SOS, PM, APC and two-byte escape sequences are removed. JSON mode needs no
  cleaning, because JSON escapes control characters.
- **Exit codes** are the AFD CLI's:

| Code | When |
| --- | --- |
| 0 | Success; `serve` stopped by SIGINT or SIGTERM |
| 1 | The command failed, the command line was invalid, the workspace could not be opened, or `serve` failed to start |
| 2 | `umbel batch` completed with some failed commands |
| 130 | A one-shot command interrupted with Ctrl+C |

### Library

An embedder links `umbel` with `default-features = false`, opens a
`HostBuilder`, registers its commands, seals, and then serves the MCP server
or router itself, or calls the registry with `Host::context(actor)`. A call
through `registry.execute` without that context carries no principal. An
embedder's in-process agent should call through a `DirectClient` (agent
interface), which cannot reach `event-rebuild`. The library never installs a
`tracing` subscriber, and takes the workspace lock only around appends and
repairs.

## 5. Registry assembly and middleware

`seal` assembles the registry in this order, which the tests pin:

1. Built-in commands, then commands added through `HostBuilder::register`.
2. The bootstrap commands, from `get_bootstrap_commands` with `cli: true`
   added (section 3).
3. Middleware, outermost first. AFD middleware receives the validated input
   and the context and calls `next()`, which takes no arguments: it can
   refuse before the handler or rewrite the result after it, but it cannot
   change the input or the context the handler sees. So:
   1. **Event stamp**: after the handler, sets
      `result.metadata["dev.umbel/mutation"] = true` on a successful result
      of a command declared `mutation: true`, other than `event-ack` and
      `event-rebuild`, and **removes** the key from every other result. On a
      stamped result of a command with no `space` property it also sets
      `dev.umbel/space` to the default space. It is outermost, so it runs
      last on the way out: the space middleware below removes
      `dev.umbel/space` from a command with no `space` property, and the
      default space must be written after that removal.
   2. **Space** (D26): for a command whose input schema has a `space`
      property, calls `Workspace::resolve_space(&input, &context)`, which
      returns `input.space` when given and the default space otherwise, and
      refuses an undeclared one with `SPACE_NOT_FOUND` before the handler
      runs. The handler calls the same function itself to learn its space;
      there is one implementation, so the two agree. After the handler, the
      middleware **overwrites** `result.metadata["dev.umbel/space"]` with the
      resolved space. For a command with no `space` property it **removes**
      that key.
   3. **Approval**: `create_approval_middleware` over `registry.list()` taken
      at this point, with the secret from `state/keys/approval.key`,
      `with_include_token(false)`, the default time to live and single-use
      replay, and the in-memory nonce store. Phase 5 replaces the nonce store
      with the shared one.
4. `set_journal` with a `JournalRecorder` over the projecting sink (section 6),
   `with_record_failures(config.journal.record_failures)` and an `on_error`
   that logs at `error`. The recorder wraps the whole chain, so the stamps
   above are in the journaled result and the journal alone is enough to
   rebuild every stream.

Phase 0 installs no telemetry middleware. The journal already records each
call's command, timing, outcome and actor kind; the AFD Rust telemetry
middleware stays a prerequisite of a later phase (architecture section 9).

## 6. Journal and event log

### The journal

One AFD journal per deployment at `state/journal.jsonl`, written by
`FileJournalSink::shared("state/journal.jsonl", "state/lock")` (step 0) with
each call run under `tokio::task::spawn_blocking`, as the sink's
documentation advises for a server. It is AFD's format unchanged
([spec/journal.md](../../../../../spec/journal.md)): any AFD language can read
and replay it. Every command call is recorded, reads included, except AFD's
default exclusion of `auth-*` commands. Phase 0 sets no redaction; the
`with_redact` seam is phase 3's.

### The projection

A `JournalSink` wrapper, the projecting sink, implements `append` as one
critical section:

1. Take the workspace lock: `inner.lock()`, which waits up to
   `journal.lock_timeout_ms`.
2. If `state/projection.pending` exists, run the catch-up (below) first.
3. If the record is an **event candidate** (its result is a success and
   carries `metadata["dev.umbel/mutation"] == true`), create
   `state/projection.pending` if it does not exist.
4. Append the journal entry with `inner.append_locked(&lock, record)`, which
   reads the last `seq` from the file's tail.
5. For a candidate, append its event to the stream of
   `metadata["dev.umbel/space"]`, with the next `seq` read from that
   stream's tail, then remove `state/projection.pending`.
6. Release the lock and return the journal entry.

If step 5 fails, the sink logs the error, leaves the marker, and still
returns the journal entry: the command's result never changes (the journal's
own rule). Because the marker is created before the journal append and
removed only after the event append, a crash or an error anywhere between
them leaves it behind, and the **next append by any process**, the next
`seal`, or the next `event-list` or `space-list`, runs the catch-up before
anything else. A projection that failed at runtime is therefore repaired
before the next event is appended, not only at startup.

**Catch-up** runs under the lock: for each space, read the last event's
`journalSeq`; take the smallest of those (0 for an empty stream); project
every candidate journal entry after it, skipping any whose `journalSeq` its
stream already holds; then remove the marker. `event-rebuild` is the same
function from `journalSeq` 0, writing new files that replace the old ones.
`Host::repair_events`, which `umbel serve` runs at start, is the same
function even without a marker, so that a stream damaged by hand is repaired
too. The result equals an uninterrupted run.

Readers (`event-list`, `space-list`, the doctor) take no lock, except that
`event-list` and `space-list` first run the catch-up when they find the
marker; a marker seen during another process's in-flight append disappears
once that append releases the lock, and the catch-up then has nothing to do.

### Event, version 0

One JSON object per line in `state/spaces/<space>/events.jsonl`:

```json
{
  "version": 0,
  "id": "main:12",
  "space": "main",
  "seq": 12,
  "cursor": "v0:main:12",
  "journalSeq": 341,
  "command": "memory-remember",
  "timestamp": "2026-11-02T10:15:00.000Z",
  "traceId": "c0f3...",
  "actor": { "kind": "agent", "id": "local" },
  "record": { "kind": "memory", "id": "mem-77" },
  "provenance": { "<envelope version 0>": "" }
}
```

| Field | Rule |
| --- | --- |
| `version` | `0` |
| `id` | `<space>:<seq>`, unique in the deployment |
| `seq` | Per space, from 1, increasing by 1 |
| `cursor` | The cursor that resumes after this event |
| `journalSeq` | The journal entry's `seq` |
| `command`, `timestamp`, `traceId`, `actor` | Copied from the journal entry; `traceId` and `actor` omitted when absent |
| `record` | `result.metadata["dev.umbel/record"]` when the command set it: `{ kind, id, version? }`; otherwise `null` |
| `provenance` | Envelope version 0 (section 7), built from the entry and `result.metadata["dev.umbel/provenance"]` |

### Cursors

A cursor is an opaque string to consumers. Version 0 encodes
`v0:<space>:<seq>`, where `seq` is the event's, and `v0:<space>:0` is the
cursor before the first event; `schemas/cursor.v0.json` is its pattern. A
cursor for another space, a `seq` past the head, or any other string is
`INVALID_CURSOR`.

Stored cursors are per principal and consumer, in
`state/spaces/<space>/cursors/<cursor-key>.json` (section 2), as
`{ "version": 0, "actor": { "kind", "id" }, "consumer", "cursor", "updatedAt" }`
(`schemas/cursor-file.v0.json`), written by atomic rename. Each space, each
principal and each consumer is independent; one principal's sessions that
share a consumer share its cursor, last writer wins.

### Retention and replay

Phase 0 keeps every journal entry and every event. `events.retention` is
reserved; the doctor reports sizes. Replay means two things, both available:
a consumer re-reads a stream from any cursor (`event-list` with `after`, or
`event-ack` to an earlier cursor), and the host rebuilds streams from the
journal (`event-rebuild`). Journal replay against a registry is AFD's
`replay_journal`; phase 0 adds no command for it.

## 7. Versioned shapes

Each shape is a closed JSON Schema 2020-12 file under
`endpoints/umbel/schemas/` (D36), versioned independently of the binary and
of AFD's contract version (architecture section 8, Versioning), with at least
one instance in `schemas/examples/<schema file stem>.json` (more as
`<stem>.<case>.json`) that the tests validate. The examples in this section
are shortened from those files; the files are normative.

Rules for every shape:

- Within a version the schema is closed (`additionalProperties: false`, also
  on nested objects the shape owns).
- A **reserved** field is named here so that a later version gives it exactly
  this meaning. Version 0 producers never write it and the version 0 schemas
  refuse it. The refusal is a rule of version 0 only: the version that defines
  a reserved field accepts it, and its schema is a new file.
- **Nested shapes version with their parent.** An event version 0 carries a
  provenance envelope version 0 (`event.v0.json` references
  `provenance-envelope.v0.json`), and a principal version 0 carries AFD's
  `Actor`. A new envelope version therefore needs a new event version that
  references it; an event reader that knows event version *n* knows exactly
  which nested versions it holds. AFD's `Actor` follows AFD's contract
  version, which `workspace-show` reports.
- A reader refuses a `version` it does not know and names the upgrade.

| Schema | Shape | Version |
| --- | --- | --- |
| `workspace-config.v1.json` | `umbel.toml`, section 2 (the TOML read as JSON); reserved keys are permitted by it and flagged by the doctor | 1 |
| `principal.v0.json` | The principal projection | 0 |
| `provenance-envelope.v0.json` | The provenance envelope | 0 |
| `event.v0.json` | One event line, section 6 | 0 |
| `cursor.v0.json` | A cursor string: `^v0:[a-z][a-z0-9-]{0,62}:(0\|[1-9][0-9]*)$` | 0 |
| `cursor-file.v0.json` | A stored cursor file, section 6 | 0 |

### Principal projection, version 0

```json
{
  "version": 0,
  "actor": { "kind": "agent", "id": "local", "onBehalfOf": "ada" },
  "transport": "stdio",
  "authentication": "process"
}
```

| Field | Rule |
| --- | --- |
| `actor` | AFD's `Actor`, equal to `CommandContext.actor` |
| `transport` | `stdio`, `http`, `cli` or `library` |
| `authentication` | `none`, `process` or `embedder` in version 0; phase 5 adds `verified` and `gateway` |

Reserved (D14, O5): `credentials` (AFD's field once MCP Authorization lands;
Umbel never copies it here), `delegationChain`, `tokenBinding`,
`humanPresent`, `policyDecision` with its `policyVersion`, `scopes`,
`spaces` (the spaces the caller may read) and `tenant`.

### Provenance envelope, version 0

```json
{
  "version": 0,
  "origin": "agent-inferred",
  "space": "main",
  "agent": { "kind": "agent", "id": "local" },
  "principal": "ada",
  "session": null,
  "traceId": "c0f3...",
  "observedAt": "2026-11-02T10:15:00.000Z",
  "validFrom": null,
  "validUntil": null,
  "confidence": 0.8,
  "authority": null
}
```

| Field | Rule |
| --- | --- |
| `origin` | `user-stated`, `agent-inferred` or `document-derived`, from the command; `unspecified` when the command gave none. Store writes, from phase 2, refuse `unspecified` |
| `space` | The record's space |
| `agent` | The actor when its kind is `agent`, `service` or `script`; otherwise `null` |
| `principal` | The person: the actor's `onBehalfOf`, or the actor's id when its kind is `human`; otherwise `null` |
| `session` | A harness session id when the command supplied one; `null` in phase 0 |
| `traceId` | The call's trace id |
| `observedAt` | The journal entry's timestamp |
| `validFrom`, `validUntil` | ISO 8601 or `null`, from the command |
| `confidence` | 0 to 1 or `null`: the command's value, else the result's `confidence` |
| `authority` | A string or `null` in version 0; phase 3's version 1 closes the set |

The command supplies `origin`, `session`, `validFrom`, `validUntil`,
`confidence` and `authority` in `result.metadata["dev.umbel/provenance"]`;
the host fills the rest and refuses nothing in phase 0, because phase 0 has no
store. Reserved: `sources` and `generated` (the Open Knowledge Format's
names, D16), `contentHash`, `derivedFrom`, `access`, `sensitivity`,
`redactions`, `delegationChain` and `tenant`.

## 8. Logging and security defaults

- **Logging:** `tracing` with a `tracing-subscriber` fmt layer writing to
  **stderr only**, on every surface; `log.format = "json"` switches to JSON
  lines. The filter is `--log`, else `UMBEL_LOG`, else `log.level`. Inputs,
  results, keys and the HTTP token are never logged; at `debug` the command
  name, trace id and duration are.
- **Telemetry:** none beyond the journal in phase 0. No OpenTelemetry export
  until W12 has a release and the AFD Rust telemetry middleware lands.
- **Security defaults:** HTTP binds loopback only and refuses anything else,
  and every HTTP request needs the workspace's bearer token (D32); Host and
  Origin validation from AFD with empty origins refused and no wildcard host;
  1 MiB body cap; confirmations enforced on MCP and the CLI; approval tokens
  never on MCP; key files and the token created 0600 and doctor-checked; the
  context hook never trusts a header; host-owned keys overwritten (section 3);
  `event-rebuild` unreachable by agents; `event-list` returns at most 1000
  events per call; terminal output sanitized; no language-model client, no
  outbound network call, no dynamic library loading.

## 9. Out of scope, and the seams reserved

| Out of scope | Phase | Seam left in phase 0 |
| --- | --- | --- |
| Plugins, the loader, the manifest (O3), grants, the WIT world | 1 | `HostBuilder::register`; `plugins.enabled` key; doctor check `plugins.none` |
| Plugin-declared first-class tools | 1 | `surfaces::default_first_class_tools` (section 3) |
| Resources, prompts, Skills delivery | 1, 2 | None needed: the server lists tools only |
| AFD contexts contributed by plugins; a context binding the default space | 1 | `default_space` is configuration; `Workspace::resolve_space` takes the context |
| Content roots, stores, the embedded key-value store (D28) | 2 | `spaces/<space>/`; reserved `content_roots` and `backend` keys. The store must keep D29's multi-process model |
| Telemetry middleware and export | 2 | The journal records command, timing, outcome and actor kind |
| Redaction of captured transcripts | 3 | `JournalRecorder::with_redact` |
| Envelope version 1 | 3 | Reserved envelope fields |
| The MCP approval relay | 4 | `with_include_token(false)`; `APPROVAL_REQUIRED` over MCP |
| Authentication, non-loopback HTTP, scopes, shared nonce store, usage events | 5 | The context hook's HTTP row; the bearer layer; reserved principal fields; keys in `state/keys/` |
| Rate limits and size caps per agent (architecture section 8) | 5 | Body cap and `event-list` limit only; per-agent limits need phase 5's verified caller |
| Event streaming, webhooks, harness channels | After W2 | Cursors are opaque and versioned |
| A workspace on a network filesystem, or shared by several machines | 6 | The workspace lock assumes a local filesystem (section 2) |
| Distribution artifacts | 7 | `publish = false`; quarantined inventory unit |

## 10. Exit criterion and tests

The exit criterion is met when `umbel.yml` is green on `main` with every test
below, and `umbel workspace doctor` on a fresh `umbel init` workspace exits 0
with `healthy: true`.

**"The Rust server's protocol tests"** means the criteria of the
[protocol conformance index](../../../../../spec/protocol-conformance.md#acceptance-index)
that `packages/rust/tests/server_http.rs`, `server_hybrid.rs`,
`server_context_hook.rs`, `server_confirmations.rs` and `server_approval.rs`
assert, run against a sealed Umbel host with zero plugins, over Streamable
HTTP and stdio, in both eras. Each Umbel test names the criterion it covers.

**Drivers.** AFD's `packages/rust/tests/common/mod.rs` cannot be included by
path: it is `#![cfg(feature = "server")]`, a feature Umbel does not have, and
its HTTP driver builds a service from a bare `McpServer`, which would skip
Umbel's router, path, options and bearer layer. Umbel therefore writes its
own drivers in `endpoints/umbel/tests/support/mod.rs`, against Umbel's public
API, and reuses nothing from AFD's tests:

- **HTTP:** `tower::ServiceExt::oneshot` on `Host::http_router()`, with the
  token header added unless a test removes it; a modern helper that derives
  the `Mcp-*` headers from the body, and a legacy helper that runs
  `initialize` first.
- **stdio, in memory:** `rmcp::ServiceExt::serve` of `Host::mcp_server()`
  over two `tokio::io::duplex` pipes (a dev-dependency, as above), speaking
  newline-delimited JSON-RPC, in both eras. The real `serve_stdio` path is
  covered by `process.rs`.

`umbel.yml` runs on `packages/rust/**` because of the path dependency. The
34-case todo conformance suite does not apply until phase 1, which loads the
todo example as a plugin.

Integration tests, in `endpoints/umbel/tests/`:

| File | Asserts |
| --- | --- |
| `protocol_http.rs` | Modern: `server/discover` names `umbel` and the crate version with AFD's default hybrid instructions; the server's `tools` capability has `listChanged: false`; `tools/list` is exactly the seven tools in section 3's order, with `ttlMs` 300000 and `cacheScope` `public`; `workspace-show` returns `structuredContent` equal to its JSON text; an unknown and a CLI-only name (`event-rebuild`) both answer `COMMAND_NOT_FOUND` ending "Use afd-discover to list all commands."; header and body mismatch is 400 with `-32020`; an unsupported version is `-32022`; `GET` is 405; a foreign `Host` and a foreign `Origin` are refused; a body over the cap is refused. Bearer: no token, a wrong token, and a token with a different length are 401 with the body of section 4, on `/mcp` and `/health`; a non-default `http.path` serves there and not at `/mcp`; a bind on `127.0.0.2` accepts `Host: 127.0.0.2:<port>`. Legacy: `initialize` then the same list and call on the same endpoint |
| `protocol_stdio.rs` | Both eras over the in-memory stdio driver: the same list, `workspace-show`, `event-list`, an unknown tool |
| `hybrid_surface.rs` | Each first-class tool equals the individual-strategy tool of the same registry (with `outputSchema`); `afd-help` reports `toolStrategy: "hybrid"` and `firstClassTools`; `afd-discover` lists every MCP-exposed built-in and bootstrap command and not `event-rebuild`; `afd-call` runs `workspace-doctor` and `space-list`; `afd-batch` runs two reads. Configuration: zero or nine names fail `open` with `WORKSPACE_CONFIG_INVALID` naming `mcp.first_class_tools`; an unknown name or a CLI-only name fails `seal` with `McpServer::validate`'s message; with the key absent the set is `default_first_class_tools`' |
| `context_hook.rs` | The principal per transport (section 4) on HTTP and stdio, validated against `principal.v0.json`; an `X-Actor` header changes nothing; the journal entry's `actor` is the expected actor and its `contextDigest.hash` equals `afd::create_context_digest` of the expected context (actor, interface, trace id, and `extra` holding exactly `dev.umbel/principal`) |
| `trusted_keys.rs` | `afd-batch` over MCP and `umbel batch` with a request `context` holding a forged `dev.umbel/principal`: `event-ack` stores under the real principal's cursor key; a fixture read whose handler sets `dev.umbel/mutation` and `dev.umbel/space` produces no event and the result carries neither key; a fixture mutation whose handler sets `dev.umbel/space` to another space is projected into the resolved space; `Host::context(actor)` fills the principal and a bare `registry.execute` of `event-ack` is `UNAUTHORIZED`; a fixture command with a `space` property reads the same space from `Workspace::resolve_space` as the middleware stamps |
| `approvals.rs` | A fixture command with an approval policy, registered through `HostBuilder::register`: over MCP in both eras, `APPROVAL_REQUIRED` with no `approvalToken` in `details`; through `cli_client` with an approving hook, it runs exactly once; with a declining hook, it does not run |
| `confirmations.rs` | A fixture command with `confirm_prompt` under `enforce`: over MCP, refused without confirmation and run with `confirm: true`; the `requestState` issued by one `Host` is accepted by a second `Host` on the same workspace (the shared key), and after a restart; through the CLI projection with no terminal, `CONFIRMATION_REQUIRED`, and with `--yes`, run; under `require-human`, `--yes` refused |
| `journal_events.rs` | Fixture mutations in spaces `main` and `second`: one journal line per call, readable by `afd::parse_journal`; events only for successful mutations, in the right stream, valid against `event.v0.json`; none for reads, failures, `event-ack` or `event-rebuild`; `record` and provenance taken from result metadata, `origin: "unspecified"` without it. Repair: with an injected failure of the event append, the marker remains, and the next mutation's append first projects the missed event, so both streams equal an uninterrupted run; create the marker and delete the last event line, reopen, and the stream is byte-identical; delete the last event line without a marker, and `Host::repair_events` restores it; `event-rebuild` output is byte-identical to the live stream |
| `multi_process.rs` | Two `Host`s sealed on one workspace in one test process (separate lock file handles, so the OS lock really excludes): 200 interleaved fixture mutations across both give journal `seq` 1 to 200 with no gap or duplicate, and each stream's `seq` and `journalSeq` increase; a reader running beside them never fails on a torn line; a lock held by the test past `lock_timeout_ms` makes `event-rebuild` answer `WORKSPACE_LOCK_TIMEOUT` with section 3's suggestion and makes a mutation's journal append log the error while its result stays a success; two hosts opening a fresh workspace at once end with one shared confirmation key |
| `cursors.rs` | `event-list` paging with `limit`, `hasMore` and `head`; an empty stream answers `v0:main:0` for `cursor`, `acknowledged` and `head`; without `after` it starts after the acknowledged cursor; two principals' cursors are independent, and two consumers of one principal are independent; the cursor file validates against `cursor-file.v0.json`; a cursor of another space, past the head, or malformed is `INVALID_CURSOR`; an undeclared space is `SPACE_NOT_FOUND` |
| `workspace.rs` | Discovery order: flag, then `UMBEL_WORKSPACE`, then upward search; the minimal file yields space `main`; each validation rule in section 2 with its key named, including `http.path`, a wildcard in `http.allowed_hosts` and `journal.lock_timeout_ms`; `config_version = 2` is `WORKSPACE_CONFIG_UNSUPPORTED`; reserved keys accepted; a non-loopback `http.bind` and `UMBEL_HTTP_BIND` both refused; precedence of flag over environment over file; a command named `serve-start` registered through the builder fails `seal`; a 16-byte confirmation key fails `seal` with `WORKSPACE_KEY_INVALID` |
| `doctor.rs` | Every check's pass, warn and fail case from section 2; `doctor::run` reports `mcp.surface` and `cli.verbs` as `skip` and stays healthy; `WORKSPACE_UNHEALTHY` carries the report in `details`; `doctor::run` reports a workspace whose `umbel.toml` does not parse |
| `schemas.rs` | Each schema file is valid JSON Schema 2020-12; every file in `schemas/examples/` validates against its schema; each reserved field of a version 0 schema is refused by it; the cursor pattern accepts `v0:main:0` and refuses `v0:main:01` and `v1:main:3` |
| `cli.rs` | Runs the built binary for the cases that need no fixture, and `umbel::cli::run` in process for the cases that register fixtures (the binary has no way to load one; both take the same arguments and print the same output and exit codes): `init` creates section 2's layout with 0600 keys and refuses an existing workspace; `umbel workspace show` equals `umbel call workspace-show`; JSON output parses as one `CommandResult` with two-space indentation; exit codes 0, 1 (failure, usage, missing workspace) and 2 (`batch` with one failure); an unknown command suggests similar CLI-exposed names and an MCP-only fixture is `COMMAND_NOT_EXPOSED`; `umbel help` lists `event-rebuild` and not the MCP-only fixture; `key=value` parsing; `--format text` strips an escape sequence a fixture returns; `umbel workspace doctor` on a fresh workspace exits 0 |
| `process.rs` | Runs the built binary: `serve --stdio` answers a legacy `initialize` and a modern `tools/list`, and stdout holds only JSON-RPC lines; with that server running, one-shot `umbel event ack` and `umbel event list` calls succeed and the journal holds both processes' entries with contiguous `seq`; `serve --stdio` on a workspace whose `umbel.toml` is invalid writes one failure line to stderr, nothing to stdout, and exits 1; `serve --http --bind 127.0.0.1:0 --print-token` prints the listening line on stderr and the token on stdout, answers `/health` and a modern `tools/list` with the token and 401 without it, and exits 0 on SIGINT (Unix) |

Unit tests sit beside the code for the cursor codec, cursor keys, space id
validation, the projection's skip rule, tail reading of a stream, the
terminal sanitizer, and the configuration defaults.

## 11. Implementation plan

Each step is one pull request, green on the repository's checks (and, from
step 1, on `umbel.yml`), and updates [STATUS.md](../../STATUS.md) and this
file's status block.

### Step 0: the AFD pull request

Small, in `packages/rust`, landing before step 1 (D25). Two additions; no
existing behaviour changes.

**1. A process-shared mode for `FileJournalSink`**, behind a new feature
`journal-file-shared = ["journal-file"]`, which needs Rust 1.89 for
`std::fs::File::lock` and `try_lock` (documented in `Cargo.toml` as the
`server` feature's 1.88 is; the crate's MSRV stays 1.82 for every other
feature set):

```rust
impl FileJournalSink {
    /// A sink that several sinks and processes may append to at once. Every append holds an
    /// exclusive OS lock on `lock_path` and reads the last `seq` from the file's tail; nothing is
    /// cached between appends. Reads take no lock and skip a torn last line, as today.
    pub fn shared(path: impl Into<PathBuf>, lock_path: impl Into<PathBuf>) -> Self;
    /// How long `lock` and `append` wait for the lock. Default: 10 seconds.
    pub fn with_lock_timeout(self, timeout: Duration) -> Self;
    /// Take the lock, waiting up to the timeout (retrying `try_lock` every 10 ms). The lock file
    /// and its directory are created when missing.
    pub fn lock(&self) -> Result<JournalFileLock, JournalLockError>;
    /// Append while holding `lock`, which must come from this sink's `lock`.
    pub fn append_locked(&self, lock: &JournalFileLock, record: JournalRecord)
        -> Result<JournalEntry, String>;
}

/// An exclusive lock on a shared journal's lock file; released on drop.
#[must_use]
pub struct JournalFileLock { /* the locked File and its path */ }

#[non_exhaustive]
pub enum JournalLockError {
    /// Not acquired within the timeout.
    Timeout { waited_ms: u64 },
    /// The lock file could not be opened or locked.
    Io(String),
}
```

- In shared mode, `JournalSink::append` is `lock`, `append_locked`, drop;
  `JournalLockError` becomes the `String` error the trait returns, so a
  `JournalRecorder` over it behaves as over any sink.
- `append_locked` refuses a lock from another sink or path with an error
  naming both, reads the last complete line from the end of the file (in
  chunks backward until a newline before it, or the start), truncates a torn
  tail or adds a missing final newline exactly as the first append does
  today, and appends one line.
- A sink made with `new` is unchanged: it caches `last_seq` and still forbids
  a second writer. The documentation of `new` points at `shared`.
- Tests in `packages/rust/src/journal/tests.rs` and a new
  `tests/journal_shared.rs`: two shared sinks on one file (separate handles)
  with 100 concurrent appends each give `seq` 1 to 200 with no gap or
  duplicate; a torn tail written between appends is repaired; a held lock
  makes `lock` return `Timeout`; `append_locked` with another sink's lock is
  refused; `read` while another sink appends never fails.

**2. Interface selection on `DirectClient`**, which TypeScript
(`createDirectRegistry({ interface })` in `@lushly-dev/afd-server`) and Python
(`DirectCommandRegistry(server, interface=...)`) already have:

```rust
impl DirectClient {
    /// The interface every call runs as. Default: `CommandInterface::Agent`.
    pub fn with_interface(self, interface: CommandInterface) -> Self;
}
```

- `call` sets `context.interface` to it instead of always `Agent`. Nothing
  else in the approval exchange changes.
- Tests in `tests/direct_approval.rs`: with `Cli`, a CLI-only command runs,
  an agent-only one is `COMMAND_NOT_EXPOSED`, an unknown name's suggestions
  name only CLI-exposed commands, and the approval hook still runs once.

Docs: the `packages/rust` CHANGELOG under Unreleased; the
[language parity](../../../../../docs/language-parity.md) rows for the
command journal (shared file sink, Rust only, not a contract change) and
`DirectClient` (interface selection, now in all three).

### Umbel steps

| Step | Pull request | Contents | Tests | Size |
| --- | --- | --- | --- | --- |
| 0 | AFD: shared journal, `DirectClient` interface | Above | Above | M |
| 1 | Scaffold | `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `clippy.toml`, `src/lib.rs` and `src/main.rs` printing `--version`; `umbel.yml`; the inventory unit, the `architecture.json` unit and the repository-contract test; the `.gitignore` negation; `AGENTS.md` rows | `cargo test` with one smoke test; the release, boundary and repository-contract checks pass with the new unit | S |
| 2 | Workspace | Discovery, `umbel.toml` version 1 with defaults and validation, layout and `init`, race-safe keys, the workspace lock, `doctor::run`, the six schema files and their examples | `workspace.rs` (rules that need no registry), `doctor.rs` (checks that need no registry, and `skip`), `schemas.rs` | M |
| 3 | Registry and CLI | `HostBuilder` and `seal` with its error mapping and reserved verbs, `Host::context`, `Workspace::resolve_space`, the built-in `workspace-*` and `space-list` commands, bootstrap with `cli: true`, the space and stamp middleware, logging, the CLI projection with `cli_client`, approvals and confirmations on the CLI, the sanitizer, exit codes | `cli.rs`, the rest of `workspace.rs` and `doctor.rs`, `trusted_keys.rs` (cases without events) | M |
| 4 | Journal and events | The projecting sink over `FileJournalSink::shared`, the pending marker and catch-up, `repair_events`, event and envelope version 0, cursors with consumers, `event-list`, `event-ack`, `event-rebuild`, the event stamp | `journal_events.rs`, `cursors.rs`, `multi_process.rs`, the rest of `trusted_keys.rs` | M |
| 5 | MCP surfaces | `mcp_server`, the context hook version 0, the HTTP router with the bearer layer and `serve`, approvals and confirmations over MCP, the stdio and HTTP drivers | `protocol_http.rs`, `protocol_stdio.rs`, `hybrid_surface.rs`, `context_hook.rs`, `approvals.rs`, `confirmations.rs`, `process.rs` | L |
| 6 | Exit | README build and run sections; STATUS.md marks phase 0 done with the run's evidence; the exit criterion re-run on `main` | None new | S |

Step 1 needs step 0 merged, because its `Cargo.toml` names the
`journal-file-shared` feature. Steps 2 and 3 may run in parallel after
step 1; step 4 needs 3; step 5 needs 3 and may run beside 4, with
`journal_events.rs`, `trusted_keys.rs` and `process.rs` gaining their MCP
cases when both have landed.

## Amendments from step 2

Made in [#572](https://github.com/lushly-dev/afd/pull/572), each the smallest
change the code needed:

- The `toml` dependency gains `preserve_order` (`space-list` reports spaces in
  configuration order, which a sorted map cannot), and `jsonschema` takes
  `default-features = false`, which keeps `reqwest` and `rustls` out of
  `Cargo.lock` (the default features resolve HTTP references).
- The validation list gains `profile`, `plugins.enabled`, `name` and the enum
  and range rules the schema already states.
- The doctor's `skip` also covers checks that need a readable `umbel.toml`,
  and `config.parse` covers the value rules no other check owns (section 2).
- Discovery is `workspace::discover(flag, env value, cwd)`, a pure function, so
  tests need not change the process environment (setting it is `unsafe` in
  edition 2024, and the crate forbids unsafe code).

## Amendments from step 3

What step 3 settled where the plan left room, and the amendments it made to this
document (the pull request number is in the status block):

- **Amendments** (made in the step 3 pull request): `async-trait` is a
  dependency, because `CommandHandler` is an `async_trait` and has no closure
  form; the middleware order of section 5 swaps the event stamp and the space
  middleware, because the literal order removed the default space the stamp had
  just written; `cli::run`, `Environment` and `Console` are public under the
  `cli` feature, because the binary cannot load a fixture command and the CLI
  tests need them; `RESERVED_VERBS` and `SPACE_NOT_FOUND` are public; the
  `cli.rs` row says which cases run the binary.
- **The event stamp** is in step 3, with the space middleware ("the space and
  stamp middleware" of the step 3 row): it only writes result metadata, so the
  cases of `trusted_keys.rs` that read it need no events. Step 4 adds the
  projection that reads it.
- **`space-list`** counts the complete lines of each stream file for `events` and
  `head`, which is exact for a stream the projection writes; step 4 replaces it
  with the catch-up of section 6.
- **`seal`** builds and validates the MCP server (`McpServer::validate`, the
  confirmation key) and discards it; `Host::mcp_server` and the context hook
  are step 5's. Until the event commands exist, the default first-class set
  names only the commands that are registered.
- **`umbel serve`** parses and answers `NOT_IMPLEMENTED` until step 5.
- **Test files.** The cases of `workspace.rs` and `doctor.rs` that need a
  sealed host are in `tests/seal.rs` and `tests/doctor_sealed.rs`, so they do
  not collide with the step 2 cases; the `trusted_keys.rs` cases that need no
  events are in `tests/trusted_keys.rs`, which step 4 extends. `cli.rs` covers
  `umbel help` without `event-rebuild`, which step 4 registers.

## Follow-ups

| Date | Follow-up | Owner |
| --- | --- | --- |
| 2026-10-31 | ~~AFD: let `DirectClient` take the interface (`cli`), so the Umbel CLI stops checking `expose.cli` itself (D34)~~ Superseded 2026-10-31: in [step 0](#step-0-the-afd-pull-request) | AFD, language parity |
| 2026-10-31 | ~~AFD: the Rust telemetry middleware (parity "No" today), which replaces Umbel's interim one (D33)~~ Superseded 2026-10-31: D33 dropped; the middleware stays in the prerequisites table, with no interim in Umbel | AFD, language parity |
| 2026-10-31 | AFD: a journal sink failure never changes the command's result, so a lock timeout or a full disk loses a journal entry and its event while the command succeeds; decide whether Umbel needs a fail-closed mode for audited mutations before phase 2 writes records | Phase 2 specification |
| 2026-10-31 | ~~Several harnesses on one workspace over stdio contend for the writer lock; consider `umbel serve --stdio --proxy <url>`~~ Superseded 2026-10-31: D29 now allows any number of processes per workspace | Phase 1 or 7 specification |
| 2026-10-31 | The phase 2 embedded store must support several processes on one workspace (for example SQLite in WAL mode, or LMDB), so that D29's model survives; no single-writer daemon (D28) | Phase 2 specification |
| 2026-10-31 | AFD: an accessor for `McpServer`'s default instructions, so a host can add a line (Umbel would name the default space) without replacing them | AFD, if wanted |
| 2026-10-31 | Windows in the `umbel.yml` matrix: key-file permissions, file locks on open files, and signal handling differ | Phase 7 |
| 2026-10-31 | An external client check: `afd validate` against `umbel serve --http` in CI, which needs the client to send the bearer token | Phase 1 |
