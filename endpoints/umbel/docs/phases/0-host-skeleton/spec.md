# Phase 0 specification: host skeleton

| Field | Value |
| --- | --- |
| Phase | 0, host skeleton ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | Repository owner approves; the phase 0 owning agent writes and implements |
| Read first | [STATUS.md](../../STATUS.md), then the [architecture](../../architecture.md) and the [decision log](../../decisions.md) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

## Status

- **State:** proposed. Written 2026-10-31; awaiting the owner's approval by
  pull request (D24). Nothing is implemented.
- **Last verified:** 2026-10-31 against `main` at `472b5f68`. Evidence: the
  `afd` crate's `server` feature, `ToolStrategy::Hybrid`,
  `McpServer::with_first_class_tools`, `with_context_hook`,
  `FileJournalSink`, `create_approval_middleware` with
  `with_include_token`, `DirectClient` and the bootstrap commands read in
  `packages/rust/src`; the release inventory and boundary check read in
  `scripts/`; trajectory rows re-checked against primary sources (see
  [Trajectory refresh](#trajectory-refresh)). Relative links and anchors in this
  file resolve.
- **Done:** this specification; the architecture amendments and decisions
  [D28 to D36](../../decisions.md) it needs, in the same pull request.
- **Not done:** every implementation step in the
  [plan](#11-implementation-plan); the exit criterion.
- **Follow-ups not yet issues:** listed in [Follow-ups](#follow-ups) and
  mirrored in [STATUS.md](../../STATUS.md#follow-ups-not-yet-issues).

## What this phase serves

The phase 0 row of the architecture: *the empty host serves MCP and CLI from
one registry with bootstrap discovery, the journal and its event log, and
approvals, from a workspace with defaults.* Exit criterion: *with zero
plugins, the host's built-in commands pass the Rust server's protocol tests in
both MCP eras, and the workspace doctor reports the workspace.* It is item 1
of the proposal's [first proof](../../proposal.md#first-proof).

| Principle | How phase 0 serves it |
| --- | --- |
| 1. Empty host | No domain command ships; the built-ins describe the workspace and read the event log |
| 3. Everything is a command | One `CommandRegistry` behind MCP, the CLI and the library; only the process verbs `init` and `serve` are not commands (D30) |
| 5. Content lives in the workspace | One deployer-owned directory; every key has a baked default |
| 7. Provenance on everything | Provenance envelope version 0 is defined and carried on every event |
| 11. Stateless and horizontal | No in-memory session state on HTTP; cursors are stored, not held |
| 12. Small surfaces, measured | The hybrid strategy with two first-class tools by default |
| 14. Every mutation is an event | The event log is a journal projection from the first commit |
| 15. AFD first | Everything below is built on the `afd` crate; the two divergences are D33 and D34 |
| 16. Spaces do not mix | One event stream and one cursor set per space; the default space is configuration |

Decisions served: D1, D5, D8, D13, D14, D19, D20, D21, D22, D23, D24, D25,
D26 and D27, and the new D28 to D36 made here. Open decisions: O3 stays open,
because the manifest is a phase 1 decision and phase 0 loads no plugin; O1, O4
and O5 do not touch phase 0. O5's reserved tenant field appears below as a
reserved name.

## Trajectory refresh

Refreshed 2026-10-31 for the rows phase 0 depends on. Nothing changed that
alters this specification.

| Row | Checked against | Finding on 2026-10-31 | Effect on phase 0 |
| --- | --- | --- | --- |
| W1 release cycle (R1, R2) | MCP roadmap, last updated 2026-08-22 | Unchanged; next revision 2027-03-30 | Phase 0 pins MCP 2026-07-28 and serves 2025-11-25 clients through `rmcp` |
| W2 MCP Events, SEP-3415 (R1) | The pull request | Still open, not a draft, review required, last updated 2026-10-31; no sponsor recorded | The event and cursor shape stays Umbel's own; poll by cursor only; no stream or webhook projection in phase 0 |
| W5 agent identity (R2) | SEP-1932 and SEP-1933 pull requests; roadmap | Both open; the Agent Identity working group is still forming; human-presence attestation listed as a possible topic | Principal version 0 reserves the delegation chain, token binding and human-presence fields and fills none |
| W6 HTTP over stdio | Roadmap; specification pull requests | A roadmap item for the transports working group; no SEP found | stdio stays newline-delimited JSON-RPC from `rmcp` |
| W12 OpenTelemetry GenAI | The conventions repository | No release or tag | Phase 0 logs to stderr; no OpenTelemetry export (D33) |
| W15 Claude Code channels | Channels documentation | Still a research preview; Claude Code does not register a channel server that negotiates 2026-07-28 | Keep the 2025-11-25 era on stdio; nothing to push in phase 0 |
| Library row: `rmcp` | `rmcp` releases | 3.8.0 published 2026-10-26; the `afd` crate's `3.7` requirement resolves it | Umbel commits a lock that pins what CI tested |

## Terms

Terms are the [architecture's glossary](../../architecture.md#12-glossary).
This phase adds four, entered in the glossary in this pull request:
**built-in command** (a command the host registers itself), **state
directory** (the part of the workspace the host writes), **writer lock** (the
file lock that makes one process the workspace's writer) and **cursor** (an
opaque position in one space's event stream). "Workspace" alone always means
the Umbel workspace; the Cargo one is always "Cargo workspace".

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
│   └── event.v0.json
├── src/
│   ├── lib.rs            # #![forbid(unsafe_code)]; the public API below
│   ├── main.rs           # the `umbel` binary; requires the `cli` feature
│   ├── workspace/        # discovery, config, layout, writer lock, keys
│   ├── commands/         # built-in commands
│   ├── events/           # projection, streams, cursors, rebuild
│   ├── principal.rs      # the context hook and principal version 0
│   ├── provenance.rs     # envelope version 0
│   ├── middleware.rs     # space resolution, event stamp, telemetry
│   ├── surfaces/         # MCP server, HTTP router, stdio, CLI projection
│   └── doctor.rs
├── tests/                # integration tests (section 10)
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
afd = { path = "../../packages/rust", features = ["server"] }
axum = { version = "0.8", default-features = false, features = ["http1", "tokio"] }
chrono = { version = "0.4", default-features = false, features = ["clock", "std"] }
clap = { version = "4", features = ["derive"], optional = true }
getrandom = ">=0.3, <0.5"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sha2 = "0.10"
tokio = { version = "1", features = ["fs", "io-std", "io-util", "macros", "net", "rt-multi-thread", "signal", "sync", "time"] }
toml = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "fmt", "json"] }

[dev-dependencies]
bytes = "1"
http = "1"
http-body-util = "0.1"
jsonschema = "0.60"
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

- **The `afd` dependency is by path, with the `server` feature and the crate's
  default features** (`native`, `journal-file`, `approval`). Umbel never
  copies code from `packages/rust`; a missing generic feature is an AFD change
  first (D25). `sha2` stays on 0.10 and `getrandom` on the `afd` crate's
  range so that one copy of each is built.
- **MSRV 1.97**, as the architecture records for the Cargo workspace. Phase 0
  itself needs 1.89 (`std::fs::File::try_lock`, and 1.88 for `server`); the
  workspace declares 1.97 now so that phase 1's wasmtime does not raise it
  mid-stream. The pinned toolchain is the repository's, 1.98.0.
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
| `Host::registry() -> Arc<CommandRegistry>` | The one registry |
| `Host::mcp_server() -> McpServer` | The configured MCP server (section 4) |
| `Host::http_router() -> axum::Router` | `/mcp` and `/health` (section 4) |
| `Host::cli_client() -> DirectClient` | What the CLI projection calls through (section 4) |
| `Host::workspace() -> &Workspace`, `Workspace`, `Config`, `SpaceId` | Read-only views of the workspace |
| `doctor::run(path) -> Report`, `Report`, `Check`, `CheckStatus` | The doctor without a sealed host (section 2) |
| `events::{Event, Cursor}` | Event version 0 and the cursor |
| `principal::Principal`, `provenance::Envelope` | Version 0 of each |
| `CONFIG_VERSION`, `PRINCIPAL_VERSION`, `PROVENANCE_VERSION`, `EVENT_VERSION` | `1`, `0`, `0`, `0` |

`HostBuilder::open(path)` reads the workspace; `HostBuilder::register(def)`
adds a command; `HostBuilder::seal()` registers the built-ins and the AFD
bootstrap commands, installs the middleware (section 5), sets the journal,
validates the MCP surface (`McpServer::validate`) and returns the `Host`.
Commands cannot be added after `seal`, which keeps the hybrid set fixed while
serving ([H2](../../../../../spec/tool-strategies.md#h2-validation-at-construction)).

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

- **`architecture.json` is unchanged.** The boundary check classifies
  `endpoints/umbel/Cargo.toml` as an endpoint unit of the `umbel` family by its
  path and records the path dependency on `packages/rust` as an endpoint to
  foundation edge, which is allowed. Because the manifest has a `[package]`,
  both the boundary check and the release control read its identity; a
  virtual workspace manifest would fail the boundary check's identity read,
  which is one reason for the single package.
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
    ├── lock                         # the writer lock (D29)
    ├── journal.jsonl                # the AFD journal, one per deployment
    ├── keys/
    │   ├── approval.key             # 32 random bytes, mode 0600
    │   └── confirmation.key         # 32 random bytes, mode 0600
    └── spaces/
        └── <space>/
            ├── events.jsonl         # the space's event stream
            └── cursors/
                └── <principal-key>.json
```

`umbel init [dir] [--name <name>]` creates `umbel.toml` (only
`config_version = 1` and, when given, `name`), `spaces/main/`, `state/` with
both keys, and a `state/.gitignore` containing `*`. It refuses a directory that
already holds `umbel.toml` (exit 1, `ALREADY_EXISTS`). A host that opens a
workspace creates any missing `state/` directory and any missing key the same
way, so a hand-written `umbel.toml` works without `init`.

`<principal-key>` is the lowercase hex SHA-256 of `<actor kind>:<actor id>`,
so no caller-chosen string becomes a path.

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
first_class_tools = ["workspace-show", "event-list"]   # default; 1 to 8 names (H1, H5)
tools_list_ttl_ms = 300000  # default
confirmations = "enforce"   # "enforce" (default), "require-human" or "off"
instructions = ""           # default: the AFD hybrid sentence plus one line naming the default space

[http]
bind = "127.0.0.1:7410"     # default; must be a loopback address in phase 0 (D32)
path = "/mcp"               # default
allowed_hosts = []          # added to the loopback names
allowed_origins = []        # exact http(s) origins; "*" and "null" refused
max_body_bytes = 1048576    # default 1 MiB; 1024 to 16777216

[journal]
record_failures = true      # default

[events]
# retention = "forever"     # reserved; phase 0 keeps every event

[log]
level = "info"              # "error", "warn", "info", "debug" or "trace"
format = "text"             # "text" or "json"

[principal]
local_id = "local"          # the actor id of the local CLI and stdio callers
# on_behalf_of = "..."      # optional: the person a local agent acts for
```

Validation, each a `WORKSPACE_CONFIG_INVALID` naming the key:

- A space id matches `^[a-z][a-z0-9-]{0,62}$`. Ids are identity: renaming one
  is a new space.
- `default_space` names a declared space. Several spaces and no
  `default_space` is an error.
- `mcp.first_class_tools` has 1 to 8 entries; the registry checks the rest at
  `seal` (H2), and its message is passed through.
- `http.bind` parses as a socket address whose IP is loopback
  (`127.0.0.0/8` or `::1`). The port may be 0 (tests).
- `principal.local_id` is 1 to 128 printable characters.

The machine-readable schema is `schemas/workspace-config.v1.json` (section 7).

### Configuration precedence

Command-line flags, then environment variables, then `umbel.toml`, then the
baked defaults. The environment variables are exactly: `UMBEL_WORKSPACE`,
`UMBEL_LOG` (a `tracing` filter, overrides `log.level`) and `UMBEL_HTTP_BIND`
(overrides `http.bind`, still loopback only). The flags are listed in
[section 4](#cli).

### The writer lock

One process writes a workspace (D29). Opening a host for writing takes an
exclusive lock on `state/lock` with `std::fs::File::try_lock` and writes the
process id and start time into it; the lock is released when the process
exits, however it exits. A second writer fails with `WORKSPACE_LOCKED`, whose
`details` carry the holder's pid and start time and whose suggestion is to
stop that process or call through its MCP endpoint.

When the lock is held, the CLI still runs a command that is not a mutation, in
**read-only mode**: it reads the files as they are (the journal and event
readers already skip a torn last line), does not write the journal, and adds
the warning `JOURNAL_NOT_RECORDED` to the result. A mutation is refused with
`WORKSPACE_LOCKED`. `umbel serve` never runs read-only.

### `workspace-doctor`

The doctor runs as the `workspace-doctor` command on a sealed host and as
`doctor::run(path)` on a workspace that cannot be opened, which is how
`umbel workspace doctor` still reports a broken `umbel.toml`. Both return the
same `CommandResult`. Each check has an id, a status (`pass`, `warn` or
`fail`), a message and, unless it passes, a suggestion.

| Id | Passes when | `warn` | `fail` |
| --- | --- | --- | --- |
| `workspace.found` | A workspace was found; reports the path and which rule found it | | Not found |
| `config.parse` | `umbel.toml` parses and `config_version` is 1 | | Parse error; another version (names the supported one) |
| `config.keys` | Every key is known and unreserved | A reserved key is set | An unknown key |
| `spaces.valid` | Ids valid, `default_space` declared | | Either rule broken |
| `state.writable` | `state/` and each space's state directory exist and are writable, or can be created | | Not writable |
| `state.lock` | The lock is free or held by this process | Held by another process (pid, start time) | |
| `keys.present` | Both keys exist with 32 bytes or more and, on Unix, mode 0600 | Wider permissions | Missing and cannot be created, or shorter |
| `journal.readable` | The journal parses as AFD JSON Lines; reports the entry count and last `seq` | A torn last line | An unparsable entry before the last line |
| `events.consistent` | Each stream parses, `seq` increases from 1, `journalSeq` increases, and the projection has caught up with the journal | Behind the journal (suggests `umbel event rebuild`) | Unparsable, or `journalSeq` out of order |
| `http.bind` | `http.bind` is loopback and every origin is exact | | Not loopback; a malformed origin |
| `mcp.surface` | The first-class set validates against the registry | | The message from `McpServer::validate` |
| `plugins.none` | `plugins.enabled` is empty | | Not empty: plugins arrive in phase 1 |

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

Every name follows D22 and is checked by the registry. Every command is
exposed to MCP and the CLI unless the table says otherwise, and to the agent
interface (the default), because the CLI calls through `DirectClient`
(section 4). The bootstrap commands `afd-help`, `afd-docs` and `afd-schema`
are registered by AFD's `register_bootstrap_commands`, exposed to MCP as AFD
defines them, and reached on the CLI through `umbel help`, `umbel docs` and
`umbel schema`.

| Command | Mutation | Expose | First-class by default | Purpose |
| --- | --- | --- | --- | --- |
| `workspace-show` | No | MCP, CLI | Yes, first | What this deployment is: name, spaces, default space, versions |
| `event-list` | No | MCP, CLI | Yes, second | Read one space's events after a cursor |
| `event-ack` | Yes | MCP, CLI | No | Store the caller's cursor in a space |
| `space-list` | No | MCP, CLI | No | The spaces, with stream heads |
| `workspace-doctor` | No | MCP, CLI | No | The checks in section 2 |
| `event-rebuild` | Yes | CLI only | No | Rebuild one or every event stream from the journal |

The default first-class set is `workspace-show` and `event-list` (D31): with
zero plugins the hot path is "what is this host and its spaces" at session
start and "what changed since my cursor" during a session. Six of the eight
places stay for plugins; the deployer sets the list in `mcp.first_class_tools`.
Under the hybrid strategy the MCP `tools/list` is therefore exactly
`afd-discover`, `afd-detail`, `afd-call`, `afd-batch`, `afd-pipe`,
`workspace-show`, `event-list` (no AFD contexts are configured in phase 0).

Every command declares `returns`, so its first-class tool carries
`outputSchema`. Every error below carries a suggestion. Input schemas are
closed (`additionalProperties: false`).

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
  "versions": { "config": 1, "principal": 0, "provenance": 0, "event": 0 },
  "surfaces": { "toolStrategy": "hybrid", "firstClassTools": ["workspace-show", "event-list"] },
  "plugins": []
}
```

- **Errors:** none of its own.

### `space-list`

- **Input:** `{}`.
- **Output:** `{ "spaces": [{ "id", "title", "default": bool, "events": integer, "head": cursor | null }] }`,
  in configuration order.

### `event-list`

- **Input:** `{ "space"?: string, "after"?: cursor, "limit"?: integer 1..1000 (default 100) }`.
  Without `after`, reading starts after the caller's acknowledged cursor, or
  at the beginning when it has none.
- **Output:**

```json
{
  "space": "main",
  "events": [ "<event version 0>" ],
  "cursor": "v0:main:42",
  "acknowledged": "v0:main:40",
  "head": "v0:main:57",
  "hasMore": true
}
```

  `cursor` is the cursor of the last returned event, or the starting cursor
  when none was returned (`null` at the beginning of an empty stream). It is
  not stored: the caller acknowledges with `event-ack`.
- **Errors:** `SPACE_NOT_FOUND`; `INVALID_CURSOR`; `VALIDATION_ERROR` for
  `limit`.

### `event-ack`

- **Input:** `{ "space"?: string, "cursor": cursor }`.
- **Output:** `{ "space", "acknowledged": cursor, "previous": cursor | null }`.
  Any valid cursor of the space may be stored, including an earlier one, which
  is how a consumer replays.
- **Errors:** `SPACE_NOT_FOUND`; `INVALID_CURSOR`; `UNAUTHORIZED` when the
  call has no actor id (only possible through the library), with the
  suggestion to set an actor with an id.
- It is journaled like any command, but never projected into an event
  (section 6).

### `workspace-doctor`

- **Input:** `{}`. **Output:** section 2. **Errors:** `WORKSPACE_UNHEALTHY`.

### `event-rebuild`

- **Input:** `{ "space"?: string }`; absent means every space.
- **Output:** `{ "rebuilt": [{ "space", "events": integer, "head": cursor | null }] }`.
- Rewrites the stream from the journal into a temporary file and renames it
  over the old one; cursors are kept, and stay meaningful because the
  projection is deterministic.
- CLI only: it rewrites host state and needs no agent. **Errors:**
  `SPACE_NOT_FOUND`; `WORKSPACE_LOCKED`.

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
| `WORKSPACE_CONFIG_INVALID` | `umbel.toml` is invalid; the message names the key | No | Names the rule broken |
| `WORKSPACE_CONFIG_UNSUPPORTED` | `config_version` is not 1 | No | "This umbel reads configuration version 1; upgrade umbel or migrate umbel.toml." |
| `WORKSPACE_LOCKED` | Another process holds the writer lock | Yes | "Stop the process with pid <pid>, or call it over MCP." |
| `WORKSPACE_UNHEALTHY` | A doctor check failed | No | The first failing check's suggestion |

The `WORKSPACE_*` codes other than `WORKSPACE_UNHEALTHY` and
`WORKSPACE_LOCKED` come from opening the workspace, so only the CLI and the
library return them; a server that cannot open its workspace does not start.

## 4. Surfaces

### MCP

`Host::mcp_server()` builds one `McpServer`:

```text
McpServer::new(registry, "umbel", env!("CARGO_PKG_VERSION"))
  .with_tool_strategy(ToolStrategy::Hybrid)
  .with_first_class_tools(config.mcp.first_class_tools)
  .with_tools_list_ttl_ms(config.mcp.tools_list_ttl_ms)
  .with_confirmations_key(config.mcp.confirmations, state/keys/confirmation.key)
  .with_context_hook(principal::hook(transport, config.principal))
  .with_instructions(...)        // only when mcp.instructions is set
```

- **stdio:** `umbel serve --stdio` calls `serve_stdio`. stdout carries only
  JSON-RPC; every log line goes to stderr.
- **Streamable HTTP:** `umbel serve --http [--bind <addr>]` binds a
  `tokio::net::TcpListener` and serves `Host::http_router()`: the
  `try_streamable_http_service` mounted with `nest_service` at `http.path`,
  and `GET /health` answering 200 with `{"status":"ok"}`. Its `HttpOptions`
  come from configuration: `allowed_hosts` is the loopback names
  (`localhost`, `127.0.0.1`, `[::1]`, AFD's default) plus `http.allowed_hosts`;
  `allowed_origins` is `http.allowed_origins`, and AFD refuses every browser
  `Origin` when it is empty; `max_body_bytes` is `http.max_body_bytes`.
  On start the host writes one stderr line,
  `umbel listening on http://<addr><path>`, with the bound port (tests bind
  port 0 and read it). SIGINT and SIGTERM stop accepting, finish requests in
  flight for up to 10 seconds, release the lock and exit 0.
- **Both eras** come from the `afd` crate: 2026-07-28 statelessly, 2025-11-25
  through `initialize`. Phase 0 adds nothing to either.
- **Approval tokens never travel over MCP.** The approval middleware is
  installed with `with_include_token(false)` (architecture section 8). The
  MCP approval relay is phase 4, so until then an approval-gated command
  called over MCP answers `APPROVAL_REQUIRED` with no token, which is the
  intended behaviour.

### The context hook, version 0

The hook sets the actor and the principal projection (section 7) on every
`tools/call`, per request. Phase 0 has no authentication (phase 5), so the
hook never reads identity from the request: no header, no query parameter
(D32).

| Transport | `actor` | `principal.authentication` |
| --- | --- | --- |
| stdio | `{ kind: "agent", id: <principal.local_id>, onBehalfOf: <principal.on_behalf_of> when set }` | `"process"`: the process boundary is the trust boundary |
| Streamable HTTP | `{ kind: "agent", id: "loopback" }` | `"none"`: loopback only, every caller is the same principal |
| CLI | `{ kind: "human", id: <principal.local_id> }` | `"process"` |
| Library | Whatever the embedder sets; the host only fills the principal from it | `"embedder"` |

The principal goes into `CommandContext.extra["dev.umbel/principal"]`. The
journal keeps the actor and only the key name of `extra` entries, never their
values ([journal](../../../../../spec/journal.md#context-digest-no-secrets)).
Phase 5 replaces the HTTP row with the verified caller from the MCP
Authorization layer and lifts the loopback restriction; nothing else in the
hook changes.

### CLI

```text
umbel [--workspace <dir>] [--format json|text] [--log <filter>] <verb or command> [args]

umbel init [dir] [--name <name>]          process verb (D30)
umbel serve (--stdio | --http) [--bind <addr>]
umbel help [<command>]                    afd-help, run in process
umbel docs | umbel schema                 afd-docs, afd-schema, run in process
umbel call <command> [json | key=value ...]
umbel batch '<afd-batch request JSON>'
umbel <domain> <action> [json | key=value ...]   = umbel call <domain>-<action>
```

- **Projection.** `umbel workspace doctor` is `umbel call workspace-doctor`;
  the split is at the first `-` of the command name, so a command named
  `a-b-c` is `umbel a b-c`. The CLI lists only commands with `expose.cli`;
  calling another is `COMMAND_NOT_FOUND`, with `find_similar_tools`
  suggestions over CLI-exposed names.
- **Arguments** parse as the AFD CLI does: one JSON object, or
  whitespace-separated `key=value` pairs whose value is JSON when it parses
  and a string otherwise. A word without `=` is `INVALID_INPUT`.
- **Execution** goes through `Host::cli_client()`, a `DirectClient` with an
  approval hook: on a terminal it shows the summary and asks
  `Approve? [y/N]`; with `--approve` it approves once without asking; with
  neither and no terminal the `APPROVAL_REQUIRED` result is printed unchanged.
  `DirectClient` marks the call as the agent interface, so the CLI checks
  `expose.cli` itself before calling (D34).
- **Batch.** `umbel batch` checks `expose.cli` for every item, then runs the
  request with `CommandRegistry::execute_batch_with_context` under the CLI's
  context. Its items do not use the approval exchange: an approval-gated item
  answers `APPROVAL_REQUIRED`, as `afd-batch` steps do over MCP. The printed
  JSON is the AFD batch result.
- **Output** is the `CommandResult` exactly as `afd call --format json`
  prints it: `JSON.stringify(result, null, 2)` formatting, on stdout,
  default `--format json` (agent first; harness adapters are scripts over
  it). `--format text` prints the AFD CLI's text layout. Errors that occur
  before a command runs (usage, workspace) are printed as a failure
  `CommandResult` too, so stdout is always one JSON document in JSON mode.
- **Exit codes** are the AFD CLI's:

| Code | When |
| --- | --- |
| 0 | Success; `serve` stopped by SIGINT or SIGTERM |
| 1 | The command failed, the command line was invalid, or the workspace could not be opened |
| 2 | `umbel batch` completed with some failed commands |
| 130 | A one-shot command interrupted with Ctrl+C |

### Library

An embedder links `umbel` with `default-features = false`, opens a
`HostBuilder`, registers its commands, seals, and then serves the MCP server
or router itself or calls the registry. The library never installs a
`tracing` subscriber and never takes the writer lock until `seal`.

## 5. Registry assembly and middleware

`seal` assembles the registry in this order, which the tests pin:

1. Built-in commands, then commands added through `HostBuilder::register`.
2. `register_bootstrap_commands`.
3. Middleware, outermost first:
   1. **Telemetry** (D33): builds an AFD `TelemetryEvent` per call (command,
      start, end, success, error code, duration, actor kind, never the actor
      id) and emits it through a `TelemetrySink` that writes one `tracing`
      event at `info` on target `umbel::telemetry`.
   2. **Space** (D26): for a command whose input schema has a `space`
      property, resolves `input.space` or the default space, refuses an
      undeclared one with `SPACE_NOT_FOUND` before the handler runs, and
      stamps `result.metadata["dev.umbel/space"]`.
   3. **Event stamp**: on a successful result of a command declared
      `mutation: true`, sets `result.metadata["dev.umbel/mutation"] = true`
      and copies the space stamp, defaulting to the default space for a
      command with no `space` property. `event-ack` and `event-rebuild` are
      never stamped.
   4. **Approval**: `create_approval_middleware` over `registry.list()` taken
      at this point, with the secret from `state/keys/approval.key`,
      `with_include_token(false)`, the default time to live and single-use
      replay, and the in-memory nonce store. Phase 5 replaces the nonce store
      with the shared one.
4. `set_journal` with a `JournalRecorder` over the projecting sink (section 6),
   `with_record_failures(config.journal.record_failures)` and an `on_error`
   that logs at `error`. The recorder wraps the whole chain, so the stamps
   above are in the journaled result and the journal alone is enough to
   rebuild every stream.

## 6. Journal and event log

### The journal

One AFD journal per deployment at `state/journal.jsonl`, written by
`FileJournalSink` with each call run under `tokio::task::spawn_blocking`, as
the sink's documentation advises for a server. It is AFD's format unchanged
([spec/journal.md](../../../../../spec/journal.md)): any AFD language can read
and replay it. Every command call is recorded, reads included, except in
read-only CLI mode (D29) and AFD's default exclusion of `auth-*` commands.
Phase 0 sets no redaction; the `with_redact` seam is phase 3's.

### The projection

A `JournalSink` wrapper, the projecting sink, appends to the file sink and,
when the stored entry is an event candidate, appends an event to its space's
stream before returning. An entry is a candidate when its result is a success
and carries `metadata["dev.umbel/mutation"] == true`. The space is
`metadata["dev.umbel/space"]`.

Startup and `event-rebuild` use the same function: for each space, read the
last event's `journalSeq`, then project every candidate journal entry after
the smallest of those, skipping any whose `journalSeq` the stream already
holds. A crash between the journal append and the event append is therefore
repaired on the next start, and the result equals an uninterrupted run. A
projection error is logged and reported by the doctor; it never changes the
command's result (the journal's own rule).

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
`v0:<space>:<seq>`, where `seq` is the event's; a cursor for another space,
a `seq` past the head, or any other string is `INVALID_CURSOR`. Per-principal
cursors are stored in `state/spaces/<space>/cursors/<principal-key>.json` as
`{ "version": 0, "actor": { "kind", "id" }, "cursor", "updatedAt" }`, written
to a temporary file and renamed. Each space and each principal is independent.

### Retention and replay

Phase 0 keeps every journal entry and every event. `events.retention` is
reserved; the doctor reports sizes. Replay means two things, both available:
a consumer re-reads a stream from any cursor (`event-list` with `after`, or
`event-ack` to an earlier cursor), and the host rebuilds streams from the
journal (`event-rebuild`). Journal replay against a registry is AFD's
`replay_journal`; phase 0 adds no command for it.

## 7. Versioned shapes

Each shape is a closed JSON Schema 2020-12 file under
`endpoints/umbel/schemas/` (D36), versioned independently of the binary and of AFD's
contract version (architecture section 8, Versioning). Within a version the
schema is closed (`additionalProperties: false`). A **reserved** field is
named here so that a later version gives it exactly this meaning; version 0
producers never write it and version 0 schemas refuse it. A reader refuses a
`version` it does not know and names the upgrade.

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

### Event, version 0, and configuration, version 1

The event is section 6's table, with `provenance` referencing
`provenance-envelope.v0.json`. The configuration schema is section 2's file;
reserved keys are permitted by it and flagged by the doctor.

## 8. Logging, telemetry and security defaults

- **Logging:** `tracing` with a `tracing-subscriber` fmt layer writing to
  **stderr only**, on every surface; `log.format = "json"` switches to JSON
  lines. The filter is `--log`, else `UMBEL_LOG`, else `log.level`. Inputs,
  results and keys are never logged; at `debug` the command name, trace id and
  duration are.
- **Telemetry:** the interim middleware in section 5 (D33). No OpenTelemetry
  export until W12 has a release and the AFD Rust telemetry middleware lands.
- **Security defaults:** HTTP binds loopback only and refuses anything else
  (D32); Host and Origin validation from AFD with empty origins refused;
  1 MiB body cap; confirmations enforced; approval tokens never on MCP; key
  files created 0600 and doctor-checked; the context hook never trusts a
  header; `event-list` returns at most 1000 events per call; no
  language-model client, no outbound network call, no dynamic library loading.

## 9. Out of scope, and the seams reserved

| Out of scope | Phase | Seam left in phase 0 |
| --- | --- | --- |
| Plugins, the loader, the manifest (O3), grants, the WIT world | 1 | `HostBuilder::register`; `plugins.enabled` key; doctor check `plugins.none` |
| Resources, prompts, Skills delivery | 1, 2 | None needed: the server lists tools only |
| AFD contexts contributed by plugins; a context binding the default space | 1 | `default_space` is configuration; `SpaceId` resolution is one function |
| Content roots, stores, the embedded key-value store (D28) | 2 | `spaces/<space>/`; reserved `content_roots` and `backend` keys |
| Redaction of captured transcripts | 3 | `JournalRecorder::with_redact` |
| Envelope version 1 | 3 | Reserved envelope fields |
| The MCP approval relay | 4 | `with_include_token(false)`; `APPROVAL_REQUIRED` over MCP |
| Authentication, non-loopback HTTP, scopes, shared nonce store and confirmation key, usage events | 5 | The context hook's HTTP row; reserved principal fields; keys in `state/keys/` |
| Event streaming, webhooks, harness channels | After W2 | Cursors are opaque and versioned |
| Several writer processes on one workspace | 6 | The writer lock (D29) |
| Distribution artifacts | 7 | `publish = false`; quarantined inventory unit |

## 10. Exit criterion and tests

The exit criterion is met when `umbel.yml` is green on `main` with every test
below, and `umbel workspace doctor` on a fresh `umbel init` workspace exits 0
with `healthy: true`.

**"The Rust server's protocol tests"** means the criteria of the
[protocol conformance index](../../../../../spec/protocol-conformance.md#acceptance-index)
that `packages/rust/tests/server_http.rs`, `server_hybrid.rs`,
`server_context_hook.rs` and `server_confirmations.rs` assert, run against a
sealed Umbel host with zero plugins, over Streamable HTTP and stdio, in both
eras. Umbel's tests drive the server with AFD's own drivers, included by path
rather than copied:

```rust
#[path = "../../../packages/rust/tests/common/mod.rs"]
mod common;
```

so a change to the drivers reaches Umbel, and `umbel.yml` runs on
`packages/rust/**` for that reason. The 34-case todo conformance suite does
not apply until phase 1, which loads the todo example as a plugin.

Integration tests, in `endpoints/umbel/tests/`:

| File | Asserts |
| --- | --- |
| `protocol_http.rs` | Modern: `server/discover` names `umbel` and the crate version with the hybrid instructions; `tools/list` is exactly the seven tools in section 3's order, `ttlMs` 300000, `cacheScope` `public`, `listChanged` false; `workspace-show` returns `structuredContent` equal to its JSON text; an unknown and a CLI-only name (`event-rebuild`) both answer `COMMAND_NOT_FOUND` ending "Use afd-discover to list all commands."; header and body mismatch is 400 with `-32020`; an unsupported version is `-32022`; `GET` is 405; a foreign `Host` and a foreign `Origin` are refused; a body over the cap is refused. Legacy: `initialize` then the same list and call on the same endpoint |
| `protocol_stdio.rs` | Both eras over the in-memory stdio driver: the same list, `workspace-show`, `event-list`, an unknown tool |
| `hybrid_surface.rs` | Each first-class tool equals the individual-strategy tool of the same registry (with `outputSchema`); `afd-help` reports `toolStrategy: "hybrid"` and `firstClassTools`; `afd-discover` lists every MCP-exposed built-in and bootstrap command and not `event-rebuild`; `afd-call` runs `workspace-doctor` and `space-list`; `afd-batch` runs two reads; a configured set with an unknown name, a CLI-only name, nine names or none fails `seal` with the entry named |
| `context_hook.rs` | The principal per transport (section 4) on HTTP and stdio, validated against `principal.v0.json`; an `X-Actor` header changes nothing; the journal entry carries the actor and only the key name `dev.umbel/principal` |
| `approvals.rs` | A fixture command with an approval policy, registered through `HostBuilder::register`: over MCP in both eras, `APPROVAL_REQUIRED` with no `approvalToken` in `details`; through `cli_client` with an approving hook, it runs exactly once; with a declining hook, it does not run |
| `confirmations.rs` | A fixture command with `confirm_prompt` under `enforce`: refused without confirmation, run with `confirm: true`; the `requestState` key survives a host restart (it is the workspace key) |
| `journal_events.rs` | Fixture mutations in spaces `main` and `second`: one journal line per call, readable by `afd::parse_journal`; events only for successful mutations, in the right stream, valid against `event.v0.json`; none for reads, failures, `event-ack` or `event-rebuild`; `record` and provenance taken from result metadata, `origin: "unspecified"` without it; delete the last event line, reopen, and the stream is byte-identical; `event-rebuild` output is byte-identical to the live stream |
| `cursors.rs` | `event-list` paging with `limit`, `hasMore` and `head`; without `after` it starts after the acknowledged cursor; two principals' cursors are independent; a cursor of another space, past the head, or malformed is `INVALID_CURSOR`; an undeclared space is `SPACE_NOT_FOUND`; `event-ack` without an actor id through the library is `UNAUTHORIZED` |
| `workspace.rs` | Discovery order: flag, then `UMBEL_WORKSPACE`, then upward search; the minimal file yields space `main`; each validation rule in section 2 with its key named; `config_version = 2` is `WORKSPACE_CONFIG_UNSUPPORTED`; reserved keys accepted; a non-loopback `http.bind` and `UMBEL_HTTP_BIND` both refused; precedence of flag over environment over file |
| `doctor.rs` | Every check's pass, warn and fail case from section 2; `WORKSPACE_UNHEALTHY` carries the report in `details`; `doctor::run` reports a workspace whose `umbel.toml` does not parse |
| `lock.rs` | A second `seal` fails `WORKSPACE_LOCKED` with the holder's pid; a read-only CLI call under the lock succeeds with `JOURNAL_NOT_RECORDED` and writes nothing; a mutation under the lock is refused; the lock is released when the host is dropped |
| `schemas.rs` | Each schema file is valid JSON Schema 2020-12; every example in this specification without a placeholder validates; a reserved field is refused by its version 0 schema |
| `cli.rs` | Runs the built binary: `init` creates section 2's layout with 0600 keys and refuses an existing workspace; `umbel workspace show` equals `umbel call workspace-show`; JSON output parses as one `CommandResult`; exit codes 0, 1 (failure, usage, missing workspace) and 2 (`batch` with one failure); an unknown command suggests similar names; `key=value` parsing; `--format text`; `umbel workspace doctor` on a fresh workspace exits 0 |
| `process.rs` | Runs the built binary: `serve --stdio` answers a legacy `initialize` and a modern `tools/list`, and stdout holds only JSON-RPC lines; `serve --http --bind 127.0.0.1:0` prints the listening line, answers `/health` and a modern `tools/list`, and exits 0 on SIGINT (Unix) |

Unit tests sit beside the code for the cursor codec, principal keys, space id
validation, the projection's skip rule and the configuration defaults.

## 11. Implementation plan

Each step is one pull request, green on `umbel.yml` and the repository's
checks, and updates [STATUS.md](../../STATUS.md) and this file's status block.

| Step | Pull request | Contents | Tests | Size |
| --- | --- | --- | --- | --- |
| 1 | Scaffold | `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `clippy.toml`, `src/lib.rs` and `src/main.rs` printing `--version`; `umbel.yml`; the inventory unit; the `.gitignore` negation; `AGENTS.md` rows | `cargo test` with one smoke test; the release and boundary checks pass with the new unit | S |
| 2 | Workspace | Discovery, `umbel.toml` version 1 with defaults and validation, layout and `init`, keys, the writer lock, `doctor::run`, the four schema files | `workspace.rs`, `doctor.rs` (checks that need no registry), `lock.rs`, `schemas.rs` | M |
| 3 | Registry and CLI | `HostBuilder` and `seal`, the built-in `workspace-*` and `space-list` commands, bootstrap, the telemetry and space middleware, logging, the CLI projection with `DirectClient`, exit codes | `cli.rs`, the rest of `doctor.rs` | M |
| 4 | Journal and events | The projecting sink, event and envelope version 0, cursors, `event-list`, `event-ack`, `event-rebuild`, startup repair, the event stamp | `journal_events.rs`, `cursors.rs` | M |
| 5 | MCP surfaces | `mcp_server`, the context hook version 0, the HTTP router and `serve`, approvals and confirmations wired | `protocol_http.rs`, `protocol_stdio.rs`, `hybrid_surface.rs`, `context_hook.rs`, `approvals.rs`, `confirmations.rs`, `process.rs` | L |
| 6 | Exit | README build and run sections; STATUS.md marks phase 0 done with the run's evidence; the exit criterion re-run on `main` | None new | S |

Steps 2 and 3 may run in parallel after step 1; step 4 needs 3; step 5 needs
3 and may run beside 4, with `journal_events.rs` gaining its MCP case when
both have landed.

## Follow-ups

| Date | Follow-up | Owner |
| --- | --- | --- |
| 2026-10-31 | AFD: let `DirectClient` take the interface (`cli`), so the Umbel CLI stops checking `expose.cli` itself (D34) | AFD, language parity |
| 2026-10-31 | AFD: the Rust telemetry middleware (parity "No" today), which replaces Umbel's interim one (D33); added to the prerequisites table for phase 2 | AFD, language parity |
| 2026-10-31 | AFD: a journal sink failure never changes the command's result; decide whether Umbel needs a fail-closed mode for audited mutations before phase 2 writes records | Phase 2 specification |
| 2026-10-31 | Several harnesses on one workspace over stdio contend for the writer lock; consider `umbel serve --stdio --proxy <url>` forwarding to a running HTTP host | Phase 1 or 7 specification |
| 2026-10-31 | Windows in the `umbel.yml` matrix: key-file permissions and signal handling differ | Phase 7 |
| 2026-10-31 | An external client check: `afd validate` against `umbel serve --http` in CI | Phase 1 |
