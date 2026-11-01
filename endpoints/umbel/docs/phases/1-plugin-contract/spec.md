# Phase 1 specification: plugin contract

| Field | Value |
| --- | --- |
| Phase | 1, plugin contract ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | Repository owner approves; the phase 1 owning agent writes and implements |
| Read first | [STATUS.md](../../STATUS.md), then the [architecture](../../architecture.md), the [decision log](../../decisions.md) and the [phase 0 specification](../0-host-skeleton/spec.md), whose shapes this one extends |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request, as phase 0's steps did |

## Status

- **State:** specification in review, not approved. Written 2026-11-01 by the
  phase 1 owning agent, after phase 0's exit criterion was met on `main` at
  `8001fc74` (recorded by [#580](https://github.com/lushly-dev/afd/pull/580)).
  It closes open decision O3 as [D37 and D38](../../decisions.md) and adds
  D39 to D50; the architecture amendments they need are in the same pull
  request. Approval is the owner's (D24).
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
- **Done:** this specification, in review.
- **Not done:** approval; every step of the [plan](#14-implementation-plan);
  the exit criterion.
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
both recorded as decisions: WASI 0.3 cannot be targeted from the pinned
toolchain (D38), and wasmtime's support windows favour its long-term line
(D39).

| Row | Checked against | Finding on 2026-11-01 | Effect on phase 1 |
| --- | --- | --- | --- |
| W1 release cycle | SEP-3398 (accepted 2026-10-14); roadmap, last updated 2026-08-22 | Unchanged: the next revision is 2027-03-30, which SEP-3398 itself calls subject to confirmation in the transition calendar; 2026-07-28 is still the latest release | Phase 1 pins MCP 2026-07-28 and keeps the 2025-11-25 era, on the server and in the mounted loader's client |
| W2 MCP Events, SEP-3415 | The pull request | Still open, not a draft, review required, last updated 2026-10-31; error codes provisional; no SDK reference implementation | The `events` grant reads Umbel's own event log; nothing is pushed |
| W15 Claude Code channels | Channels documentation | Unchanged since 2026-10-31 | No effect; phase 1 adds no push path |
| W16 Skills over MCP | The extension overview, SEP-2640 and the client matrix (changed 2026-10-30) | SEP-2640 is **Final**; the extension id is `io.modelcontextprotocol/skills`, with `skills/list`, `skills/get` and `resources/read`, and optional `resources/directory/read`. Full client support: MCPJam and mcpc; partial: ChatGPT, fast-agent and the MCP Inspector; none in Claude, Claude Code, Cursor, VS Code, Goose or Microsoft 365 Copilot | The extension is final, so AFD can implement it (step 0); resources and the CLI export stay required delivery paths |
| New W17 WASI 0.3 and `wasm32-wasip3` | WASI releases; wasmtime 46 release notes; the Rust platform-support pages | WASI 0.3.0 was ratified on 2026-06-11 (latest 0.3.2, 2026-10-13); wasmtime supports it by default since 46.0.0 (2026-06-22), though its stability tiers do not list `component-model-async`; the Rust `wasm32-wasip3` target is Tier 3 on stable 1.99 and becomes Tier 2 only with 1.100; `wasm32-wasip2` is Tier 2 | WIT world 1 targets WASI 0.2 (D38); world 2 with WASI 0.3 waits for `wasm32-wasip3` on the pinned toolchain |
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
inherits the workspace lints.

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
members = [".", "sdk", "plugins/hello", "plugins/todo", "tests/fixtures/components/*"]

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
rmcp = { version = "3.7", optional = true, default-features = false, features = [
  "client", "server", "transport-io", "transport-child-process", "transport-streamable-http-client-reqwest",
] }
tempfile = { version = "3", optional = true }
wasmtime = { version = "48.0.8", optional = true, default-features = false, features = [
  "runtime", "cranelift", "component-model", "std", "parallel-compilation",
] }
# Its WASI 0.2 implementation, `wasmtime_wasi::p2`. Step 4 trims both feature lists to the smallest set that builds.
wasmtime-wasi = { version = "48.0.8", optional = true }
```

Rules:

- **Versions.** wasmtime and wasmtime-wasi stay on the 48 long-term line
  (D39): Dependabot raises the patch within it; moving to the next long-term
  line (60) is a pull request that re-runs every component test. `rmcp` keeps
  the `afd` crate's `3.7` requirement so one copy is built; the client
  features pull `reqwest` and `rustls` into the lock, which phase 0 kept out
  and phase 1 accepts for HTTP mounts. The lock is re-committed in each step
  that changes it.
- **`unsafe` stays forbidden.** wasmtime's `Component::deserialize` is
  `unsafe`, so phase 1 compiles each component at `seal` and caches nothing
  (see [Follow-ups](#follow-ups)).
- **Embedders** choose loaders with `default-features = false` plus
  `component` or `mounted`. A manifest of a kind whose feature is off fails
  with `PLUGIN_KIND_UNAVAILABLE`.
- **`umbel.yml`** gains the `wasm32-wasip2` target (`rustup target add
  wasm32-wasip2`), a step that builds the hello component before the tests
  (section 13), the library-only clippy leg per feature (`--no-default-features
  --features component`, `--features mounted`), and a `conformance` job
  (section 13). Its path filter adds `packages/examples/todo/**`.
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
world = "umbel:plugin/plugin@1.0.0"   # the world it was built against; major version must be 1

[mount]                       # required when kind = "mounted", refused otherwise (section 6.3)

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

**Reserved** (D36's rule: named now, refused by version 1): `ui` (Loam's UI
contributions: surfaces, layout preset, document types; see below),
`connectors` and `backends` (contributions the architecture lists for later
phases: federation's connector contract after O1, the store traits in phase
6), `dependencies` (never: D3), `signature` (W9), `scopes` (phase 5's
per-command scopes) and `on_conflict` (Plugin Discovery's conflict option;
version 1 fixes it to `error`).

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
grant semantics of section 7. The host serves exactly protocol 1 in phase 1
and refuses any other with `PLUGIN_PROTOCOL_UNSUPPORTED`, whose suggestion
names the versions it serves. A later host that serves 1 and 2 loads both.

What changes the protocol version, and what does not:

| Change | Version effect |
| --- | --- |
| A new optional manifest key, a new grant, a new WIT interface the world may import | New manifest version and a WIT minor version; protocol unchanged; older plugins load |
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
  list: func(pack: string) -> result<list<string>, host-error>;
  read: func(pack: string, path: string) -> result<list<u8>, host-error>;
}

/// Grant `events`. Read one space's event log by cursor, as event-list returns it.
interface events {
  use types.{json, host-error};
  list: func(space: option<string>, after: option<string>, limit: u32) -> result<json, host-error>;
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
| `wasi:cli/stdout`, `wasi:cli/stderr` | Line-buffered into the host log at `info` and `warn`, tagged with the instance id | `log` |
| `wasi:cli/environment`, `wasi:cli/exit`, `wasi:cli/stdin`, `wasi:cli/terminal-*` | No variables, no arguments, empty stdin, no terminal; `exit` ends the call as a trap | none |
| `wasi:io/*` | Streams and polling over the above | none |
| `wasi:filesystem/*` | No preopened directories, so no file is reachable | none |

  Any other import, in particular `wasi:sockets/*` and `wasi:http/*`, fails
  the instance with `PLUGIN_IMPORT_DENIED`. A Rust component's standard
  library normally imports the clocks and random interfaces, so `plugin new`
  declares the `clock` and `random` grants in a component's manifest.
- **Time and randomness come only from the command context** (architecture
  section 8). There is no other source: the WASI clocks and random
  interfaces are the context's, so the journal's tape restores them on replay
  and `replay_journal` reports a component call as `same`. The tape's read cap
  (`with_max_tape_reads`, default 1000) applies; past it the tape is marked
  truncated, as AFD does for any command.
- **Versioning.** The package is `umbel:plugin@1.0.0`. The host's linker
  provides the newest `1.x` it knows; a component built against an older
  `1.y` resolves through wasmtime's semver-compatible import matching. A world
  with a different major version fails with `PLUGIN_PROTOCOL_UNSUPPORTED`.
  `component.world` in the manifest must equal the world the component's
  metadata names, or the instance fails with `PLUGIN_MANIFEST_INVALID`.
- **WASI 0.3 is reserved for world 2.0.0** (D38): async exports, streams and
  futures, once `wasm32-wasip3` is Tier 2 on the repository's pinned
  toolchain (watch row W17).

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
/// mounted loader sees the manifest's command names. Host services are unavailable: `Cx`
/// answers `NotGranted` for every grant except `clock` and `random`, which come from the AFD
/// command context, and `log`, which writes to stderr.
pub async fn serve_mounted(plugin: impl Plugin) -> std::io::Result<()>;
```

- Dependencies: `serde`, `serde_json`; `wit-bindgen = "0.63"` under
  `component`; `afd` (by path, `server`) and `tokio` under `mounted`.
- `Outcome` serializes exactly as AFD's wire format (camelCase, unset fields
  omitted, never `null`); the SDK's unit tests compare it with
  `afd::CommandResult` round trips.
- The host side of a compiled SDK plugin is `umbel::plugins::sdk(plugin)`,
  which turns an `umbel_sdk::Plugin` into a `CompiledPlugin` (section 6.1).

## 6. Loading

Every kind goes through one sequence at `HostBuilder::seal`, before the
built-in commands' registration finishes, so a plugin cannot change what is
already registered. In order, per instance in `plugins.enabled` order:

1. **Resolve the source** (section 9.1): a compiled plugin from the host
   binary's catalog, or a directory in the workspace. Not found is
   `PLUGIN_NOT_FOUND`.
2. **Read and validate the manifest** (section 2), and check `protocol`.
3. **Validate the instance configuration** against `config.schema`, with
   defaults applied; a failure is `PLUGIN_CONFIG_INVALID` naming the
   instance and the JSON pointer.
4. **Decide the grants** (section 7.2).
5. **Check the spaces**: `spaces` names declared spaces, and a plugin whose
   commands include one without a `space` input property must be enabled for
   the default space (D44).
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

When every instance is prepared, `seal` continues as in phase 0: the bootstrap
commands, the first-class set (now with plugin suggestions, section 8.4), the
contexts (section 8.5), the middleware (now with the plugin gate, section
8.1), the MCP server, the journal and the marker catch-up.

**Failure isolation at load** (D50). An instance whose step fails is a load
failure. When the instance is `required` (the default), `seal` fails with
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
discipline and a declaration to the deployer, **not a sandbox** (flagged for
the owner in [section 11](#11-security)).

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
  wants compiled plugins builds a binary: `umbel::cli::run_with(catalog, ...)`
  is `cli::run` with a `HostBuilder` hook, and `umbel-plugin-todo`'s
  `umbel-todo` binary is the worked example.

### 6.2 Component plugins

- **Engine.** One `wasmtime::Engine` per `Host`, with
  `Config::wasm_component_model(true)`, `consume_fuel(true)`,
  `epoch_interruption(true)` and Cranelift. A background thread increments the
  epoch every 10 ms for the host's life.
- **At seal:** read `component.path` (at most 32 MiB, else
  `PLUGIN_LIMIT_EXCEEDED`), compile it (`Component::new`), check its imports
  against the grants (section 4), link the world and WASI 0.2 into a
  `Linker`, and build an `InstancePre`. A compile or link failure is
  `PLUGIN_LOAD_FAILED` with wasmtime's message.
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
| `memory_bytes` (`StoreLimits`) | 67 108 864 (64 MiB) | 1 073 741 824 | `PLUGIN_LIMIT_EXCEEDED`, `details.limit = "memory"` |
| `table_elements` | 20 000 | 1 000 000 | `PLUGIN_LIMIT_EXCEEDED`, `details.limit = "table"` |
| Input and result JSON | 4 MiB each | fixed | `PLUGIN_LIMIT_EXCEEDED`, `details.limit = "io"` |
| Log output | 64 KiB per call | fixed | Further lines dropped; one `warn` line says so |
| Pack bytes read | 16 MiB per call | fixed | `host-error.too-large` |

  Core instances, memories and tables per store are capped at 64, 4 and 16
  (a component instantiates several core instances).
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

```toml
[mount]
prefix = "tickets"            # required; ^[a-z][a-z0-9]{0,31}$; must equal one of plugin.domains
transport = "stdio"           # required: stdio | http

# stdio
command = ["node", "dist/server.js"]   # required for stdio; the first element is resolved against the plugin root, then PATH
cwd = "."                     # default: the plugin root; must stay inside it
env = { LOG_LEVEL = "warn" }  # the child's whole environment, plus PATH; nothing else is inherited

# http
url = "https://tickets.example.com/mcp"   # required for http: https, or http on a loopback address
bearer_env = "TICKETS_TOKEN"  # optional: the deployer's token, read from the host's environment at seal

only = ["search_tickets", "get_ticket"]   # optional allow-list of original tool names

[[mount.tools]]               # optional overrides, by original tool name
tool = "search_tickets"
name = "tickets-search"       # optional explicit command name; must start with the prefix
effects = ["inspect"]         # default for every tool: ["external"]
confirm_prompt = "..."        # optional
approval = "required"         # optional
first_class = true            # optional suggestion
```

- **Connect at seal.** stdio: spawn the child with `kill_on_drop`, stdin and
  stdout for JSON-RPC, stderr forwarded line by line to the host log at
  `debug` with the instance id. HTTP: Streamable HTTP with
  `Authorization: Bearer <value of bearer_env>` when set. The client
  negotiates 2026-07-28 and falls back to 2025-11-25, and declares **no**
  client capabilities: no sampling, elicitation or roots. A connection
  failure, or no answer within 10 seconds, is `PLUGIN_LOAD_FAILED`.
- **List the tools** (every page of `tools/list`), keep those in `only` when
  it is set, and rename each (D22):
  1. If a `[[mount.tools]]` entry gives `name`, use it.
  2. Otherwise normalize the original: lowercase; every character outside
     `[a-z0-9]` becomes `-`; runs of `-` collapse; leading and trailing `-`
     are trimmed; a segment that starts with a digit gains a leading `n`.
  3. If the normalized name starts with `<prefix>-`, it is the command name;
     otherwise the command name is `<prefix>-<normalized>`.
  4. A name that still fails AFD's rule is skipped with the diagnostic
     `PLUGIN_TOOL_UNNAMEABLE` in `plugin-show`, unless an override names it.
  Two tools that map to one name are `PLUGIN_CONFLICT`.
- **Register** each as a command: the tool's description; its `inputSchema`
  with every keyword the `afd` crate's checker refuses removed (the server
  validates the full schema itself), and the original schema kept in
  `_meta["dev.umbel/origin"].inputSchema`; `returns` from its `outputSchema`
  under the same rule; effects from the override, else `["external"]`;
  `mutation` from the effects (section 7.3). The tool's annotations, such as
  `readOnlyHint`, are untrusted and set nothing.
- **Call:** `tools/call` with the original name and the input as arguments.
  Nothing else crosses: no caller credential, token or principal, no
  `dev.umbel/` key, no request `_meta` beyond what the SDK requires (D43).
  The answer becomes a `CommandResult`: when `structuredContent` is an AFD
  `CommandResult` (an object with a boolean `success`), it is used, with
  every `dev.umbel/` key removed from its `metadata`; otherwise a success
  carries `data = structuredContent`, or `{ "content": [...] }` when there is
  none, and `isError: true` is the failure `PLUGIN_TOOL_ERROR` with the first
  text content as its message. A result over `max_result_bytes` (default 1
  MiB, cap 16 MiB) is `PLUGIN_LIMIT_EXCEEDED`.
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
- **Grants:** none. A mounted manifest with `[[grants]]` is
  `PLUGIN_MANIFEST_INVALID`: the server runs outside the host and reaches no
  host service. Its packs and skills are still served by the host from the
  plugin directory.
- **What a mount does not import in phase 1:** the server's resources,
  prompts and skills (federation's work, after O1).

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
| `events` | `event-list`'s read, without acknowledgement, in a space the instance is enabled for | none | Read-only; events are appended only by journaled commands (architecture section 4); a space outside the instance's spaces is `not-granted` |
| `clock` | The command context's clock | none | Recorded on the journal tape |
| `random` | The command context's random source | none | Recorded on the journal tape |

The architecture's other grants are named and refused until their phase, each
with `PLUGIN_GRANT_UNAVAILABLE` naming it: `documents`, `index`, `graph`
(phase 2), `memory` (phase 3), `http` and `secrets` (the first plugin that
needs outbound calls specifies them). The **journal is not a grant**: the host
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

**Enabling an instance is consent to its declared grants**, minus `deny`
(D42; flagged for the owner). `plugin-show`, `plugin-check` and the doctor
show every grant with its reason and every command's effects before and after
enabling, so a deployer can see what a plugin may do first.

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
  `Workspace::resolve_space`) and refuses a space the instance is not enabled
  for with `PLUGIN_NOT_ENABLED` before the handler runs. After the handler, it
  removes every `dev.umbel/` key from a mounted result's metadata, keeps
  `dev.umbel/record` and `dev.umbel/provenance` from a compiled or component
  result (the command-supplied keys of phase 0), removes every other
  `dev.umbel/` key, and stamps `dev.umbel/plugin = { "id", "kind" }` and, for
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
   listed by `resources/list` with `ttlMs`, `cacheScope: "public"`, a digest
   and a size, and read by `resources/read` (`text/markdown` for `.md`,
   otherwise by file suffix, else `application/octet-stream`).
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
  `McpServer::with_contexts`, which registers AFD's context commands; a
  command's `contexts` go on its definition (`with_contexts`). A context name
  must start with one of the plugin's domains, so contexts never collide. With
  no plugin context the server configures none, as in phase 0. A context that
  binds a default space stays reserved.
- **Pipelines as data** (D3). A `[[pipelines]]` entry is registered as a
  command of the plugin whose handler runs the `afd` crate's
  `execute_pipeline` over the host registry with the caller's context and the
  entry's `steps`, `$input` bound to the command's input. The command's
  `effects` must cover its steps' effects (checked at `seal` for steps that
  name registered commands). A step may name another plugin's command: that
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
enabled = ["hello", "tickets"]       # instance ids, in load order; ^[a-z][a-z0-9-]{0,31}$; unique

[plugins.hello]                      # optional for every instance
source = "compiled:hello"            # default: see below
required = true                      # default true (section 6)
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
prefix = "tickets"                   # mounted only; default the manifest's mount.prefix
timeout_ms = 30000                   # mounted only
max_result_bytes = 1048576           # mounted only
```

- **Sources.** `compiled:<id>` names a plugin the host binary was built with
  (`HostBuilder::with_compiled`). Any other value is a relative path to a
  directory inside the workspace (no `..`, no absolute path, symlinks resolved
  and checked) whose `umbel-plugin.toml` is read. With no `source`, the host
  uses `compiled:<instance id>` when the binary has it and
  `plugins/<instance id>` when that directory exists; both is
  `PLUGIN_CONFLICT`, neither is `PLUGIN_NOT_FOUND`.
- **Instances.** An instance id is the plugin id by default. A plugin may be
  enabled as several instances only when it is mounted, each with its own
  `prefix` (and so its own domain); two instances of a compiled or component
  plugin collide on command names and fail with `PLUGIN_CONFLICT`.
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
files run without a sealed host:

| Id | Passes when | `warn` | `fail` | Without a sealed host |
| --- | --- | --- | --- | --- |
| `plugins.config` | Every instance's keys, `limits` and `spaces` are valid | | A rule broken | Runs |
| `plugins.sources` | Every source resolves; every manifest validates and declares protocol 1; every component file exists within the size cap | An optional instance's source fails | A required instance's source fails | Runs (no compilation; no mount is spawned) |
| `plugins.grants` | Every declared grant is in the catalog and allowed for the kind | An optional grant is denied | A required grant is denied or unavailable | Runs |
| `plugins.packs` | Every pack and override validates within the limits | | Invalid | Runs |
| `plugins.skills` | Every skill validates, names are unique and well formed | | Invalid or duplicate | Runs |
| `plugins.loaded` | Every instance loaded; reports kinds and counts | An optional instance failed (names the code) | Never: a required failure stops the host from opening | `skip` |
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
| `PLUGIN_LOAD_FAILED` | Compilation, linking or the mount's connection failed | Yes for mounts, no otherwise | "Run umbel plugin check path=<dir>; for a mount, check that its server starts." |
| `PLUGIN_NOT_ENABLED` | The call's space is not one of the instance's spaces | No | "Call it in one of <spaces>, or add the space to plugins.<id>.spaces." |
| `PLUGIN_TRAPPED` | A component trapped | No | "The plugin failed; report it to its author with the trace id." |
| `PLUGIN_LIMIT_EXCEEDED` | A per-call limit was reached; `details.limit` names it | No | "Raise plugins.<id>.limits.<limit> within the host cap, or reduce the input." |
| `PLUGIN_RESULT_INVALID` | A component returned something that is not a CommandResult | No | "The plugin failed; report it to its author with the trace id." |
| `PLUGIN_TOOL_ERROR` | A mounted tool answered `isError: true` | No | "See the message from the mounted server." |
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
- `boot`: a `TestHost` with only this plugin seals (for a mount, the server is
  spawned and listed); the result lists the registered commands with their
  final names.
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
| Compiled | The crate's library, `umbel_plugin_hello::plugin()`, wrapped by `umbel::plugins::sdk` | `source = "compiled:hello"` in a host built with `with_compiled` (the tests, and `TestHost::compiled`) |
| Component | `cargo build --locked --release --target wasm32-wasip2 -p umbel-plugin-hello --features component`, giving `umbel_plugin_hello.wasm`; the test copies it with the manifest (kind rewritten to `component`, `[component] path`) into `plugins/hello/` | `source = "plugins/hello"` |
| Mounted | The `hello-mcp` binary (`--features mounted`), `serve_mounted(plugin())` over stdio | `source = "plugins/hello"` with a manifest of kind `mounted`, `[mount] prefix = "hello"`, `command = ["<path to hello-mcp>"]` |

The crate keeps one manifest per kind in `manifests/` (`compiled.toml`,
`component.toml`, `mounted.toml`), identical except for `kind`, the kind's
table and, for the mounted one, no grants, and `plugin-check` passes on each.
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
- **The mounted build** has no host services: its `Cx` reads the default
  pack and configuration compiled into the binary, so a space override does
  not change its salutation, and its results carry `recorded`. Its packs and
  skill are still served by the host from the plugin directory. The tests
  assert exactly that difference.

**todo** (`endpoints/umbel/plugins/todo/`, crate `umbel-plugin-todo`) is the
todo example as a compiled plugin. It implements `CompiledPlugin` directly
over `todo_backend_rust::commands(store)` (step 0b), returning each as
`PluginCommand::Definition`, one in-memory store per host process, and its manifest declares the eleven commands with their
schemas from the backend, `todo-clear`'s confirmation prompt, effects
`["plugin-state"]` on the eight that change the store and `["inspect"]` on
`todo-get`, `todo-list` and `todo-stats`, `domains = ["todo"]` and no grants.
Its `umbel-todo` binary is `umbel::cli::run_with` with the plugin compiled in.
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
  schemas served as the server gave them (after keyword removal), which
  `afd validate --surface`'s `description-injection` rule checks in CI for
  hello and todo; HTTP mounts must use https unless the URL is loopback.
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

**Trust-model changes, for the owner's decision** (flagged, each a part of
D42 or D43):

1. **Compiled plugins are trusted code** with the host's privileges; grants
   are a declaration and an API, not a boundary. Only components are
   sandboxed.
2. **A mounted stdio server runs as the host's operating-system user**,
   outside any sandbox, with a cleared environment plus `PATH` and the
   manifest's `env`. The deployer accepts that by enabling it.
3. **Enabling an instance grants its declared grants** (minus `deny`); there
   is no separate approval step.
4. **An HTTP mount may carry the deployer's own bearer token** from the host's
   environment (`bearer_env`). It is never a caller's token, so architecture
   section 8's rule holds, but it is a deployer secret outside a `secrets`
   grant until that grant is specified.

## 12. Out of scope, and the seams reserved

| Out of scope | When | Seam left in phase 1 |
| --- | --- | --- |
| Federation: indexed-copy and live modes, the connector contract | After phase 2, after O1 | The mounted loader; reserved manifest key `connectors`; a mount's resources, prompts and skills not imported |
| Store grants (`documents`, `index`, `graph`, `memory`) and the `store-write` effect | Phases 2 and 3 | Named in the catalog and refused with `PLUGIN_GRANT_UNAVAILABLE` |
| `http` and `secrets` grants | The first plugin that needs them | Same |
| Backends contributed by plugins | Phase 6 | Reserved key `backends` |
| WIT world 2.0.0 on WASI 0.3, async exports | When `wasm32-wasip3` is Tier 2 on the pinned toolchain (W17) | `component.world`; the protocol table of section 3 |
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
below and its `conformance` job, and three runs succeed in it:

1. **hello three ways**: `tests/hello_three_ways.rs` loads hello as
   `compiled:hello`, as the component built from the same crate, and mounted
   through the `hello-mcp` binary, each in its own workspace, and calls
   `hello-greet` over MCP in both eras and through the CLI in each. The
   compiled and component results are equal; the mounted result carries the
   same `data` from its built-in pack and the `recorded` stamp.
2. **A second plugin with no host change**: the step 6 pull request adds
   `umbel-plugin-todo` and changes nothing under `endpoints/umbel/src/`,
   `endpoints/umbel/wit/` or `endpoints/umbel/schemas/`; the reviewer checks
   `git diff --stat` and the pull request records it.
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

The suite calls tools by name, never lists them, and checks the wire rules:
Umbel's `dev.umbel/space` and `dev.umbel/mutation` metadata keys hold no `_`
and no `null`, so they pass, and the plugin gate's `dev.umbel/plugin` is an
object without either. Under the hybrid strategy the `todo-*` names are
callable directly ([H7](../../../../../spec/tool-strategies.md#h7-calls-confirmations-approvals-and-errors):
a `tools/call` naming an exposed command that is not first-class runs it), so
the suite needs no change beyond the backend.

The `conformance` job in `umbel.yml` (Node 24, pnpm, Rust, path-filtered with
the workflow) runs, in order: the three conformance runs above; `afd scenario
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
| `workspace.rs` (extended) | Version 2 parsing and validation of section 9.1; version 1 opens as version 2 with no plugins; version 3 is `WORKSPACE_CONFIG_UNSUPPORTED` naming 1 and 2; `umbel init` writes version 2; source resolution, both and neither cases |
| `plugin_compiled.rs` | An SDK plugin and a raw `CompiledPlugin` load from `with_compiled`; a catalog plugin not enabled is not loaded; definitions carry the manifest's metadata and expose flags; a missing handler and an extra handler are refused; a panic is `COMMAND_EXECUTION_ERROR` and the next call works |
| `grants.rs` | Each grant of the catalog works when declared; each answers `NotGranted` when undeclared or denied; a denied required grant is `PLUGIN_GRANT_DENIED`; each reserved grant is `PLUGIN_GRANT_UNAVAILABLE`; any grant on a mounted manifest is refused; `events` outside the instance's spaces is `not-granted` |
| `plugin_spaces.rs` | `spaces` limits calls (`PLUGIN_NOT_ENABLED`) and grants; a plugin with a space-less command must include the default space; mutations project into the resolved space |
| `packs.rs` | Default and override per space; whole replacement (a file only in the default is absent under an override); limits; an invalid override fails the load; `plugin-show` reports `default` and `override` |
| `skills.rs` | Name rules and uniqueness; `skills/list`, `skills/get` and `resources/read` in both eras with correct digests, sizes and frontmatter; `-32602` for an unknown URI; `resources/list`; `skill-export` writes files and the origin file, and refuses to overwrite without `force=true` |
| `plugin_component.rs` | hello as a component: imports checked (a component importing `wasi:sockets` and one importing `umbel:plugin/events` without the grant are refused with `PLUGIN_IMPORT_DENIED`); a world `2.0.0` is refused; calls in both eras and the CLI; a trapping fixture is `PLUGIN_TRAPPED` and the next call works |
| `component_limits.rs` | Fixtures that loop, allocate and log past the limits: `fuel`, `timeout`, `memory` and `io` each give `PLUGIN_LIMIT_EXCEEDED` with `details.limit`; host caps refuse larger configured limits |
| `component_replay.rs` | A component that reads the clock and random: the journal tape holds the reads; `TestHost::replay` reports every entry `same`; a second run with another wall time gives the recorded values on replay |
| `plugin_mounted.rs` | hello mounted over stdio (`hello-mcp`) and over Streamable HTTP (the same server on a loopback port): tools listed and renamed; `_meta["dev.umbel/origin"]` with the original name; the `recorded` and `external` stamps; a forged `dev.umbel/space` in a mounted result removed; no client capabilities declared; no `Authorization` header unless `bearer_env` is set; the child's environment holds only `PATH` and `env`; a killed child respawns once and then answers; respawn limit gives `PLUGIN_UNAVAILABLE`; `required = false` with a missing command skips the instance |
| `mount_naming.rs` | Unit-level cases of the renaming rule: case, punctuation, digits, the kept prefix, explicit names, unnameable tools, collisions; `only` |
| `plugin_conflicts.rs` | Two instances of one compiled plugin; a plugin command colliding with a built-in, `afd-help`, a host domain and a reserved verb; two skills of one name; two mounts with one prefix |
| `first_class_plugins.rs` | Suggestions appended in order; truncation at 8 with the `plugins.first_class` warning; an explicit `mcp.first_class_tools` wins; non-MCP commands skipped |
| `contexts_pipelines.rs` | Plugin contexts registered and `afd-context-enter` scopes plugin commands; a pipeline runs its steps with `$input`; a pipeline naming a missing command is not registered and the instance loads; its effects must cover its steps' |
| `plugin_commands.rs` | `plugin-list`, `plugin-show`, `skill-list` outputs, including a failed optional instance; `workspace-show`'s `plugins` and `versions` |
| `doctor_plugins.rs` | Every check of section 9.2 in pass, warn and fail, with and without a sealed host; `plugins.none` absent |
| `testkit.rs` | `TestHost` boots with only the plugin, its MCP and CLI drivers, and `replay` skipping mounted entries |
| `plugin_scaffold.rs` | `plugin-new` for each kind into a temporary directory, and `plugin-check` passing on each; `plugin-check` failing cases for a bad manifest, a bad skill and a component importing too much |
| `hello_three_ways.rs` | The exit run 1 above |
| `plugins/hello/tests/hello.rs` | The SDK's `Outcome` equals AFD's wire format; `hello-greet` with the default pack and with an override, through `TestHost::compiled` |
| `plugins/todo/tests/todo.rs` | The eleven todo commands are registered as the todo plugin's, with `todo-clear`'s confirmation prompt; the manifest's schemas and effects equal the backend's definitions (so a backend change that the manifest misses fails here); one call each |
| `sdk/` unit tests | `Outcome` serialization; `Cx` answering `NotGranted` |

Existing tests that change: `doctor.rs` (the `plugins.none` cases move to
`doctor_plugins.rs`), `hybrid_surface.rs` (the default set still the two
built-ins with no plugin), `cli.rs` (`umbel help` lists the plugin commands),
`seal.rs` (the new reserved domains). `tests/support/` re-exports the
`testkit` drivers.

**The component fixture.** `umbel.yml` builds the hello component and the
fixture components (`tests/fixtures/components/`, small crates for the trap,
loop, allocation, log and import cases) with
`cargo build --locked --release --target wasm32-wasip2` before `cargo test`;
the tests read them from `target/wasm32-wasip2/release/` and fail with the
build command in their message when a file is missing. No `.wasm` file is
committed.

## 14. Implementation plan

Each step is one pull request, green on the repository's checks and
`umbel.yml`, and updates [STATUS.md](../../STATUS.md) and this file's status
block. Any step that finds a design decision stops and amends this document.

### Step 0: AFD first

Two pull requests in AFD, before the Umbel steps that need them (D25).

**0a. The proposal and its spec** (documents only):
`docs/features/proposed/mcp-resources-skills/` with a proposal and a
`spec/` change, shared with Loam (which needs `ui://` resources from the same
mechanism), covering for every language:

- Serving MCP **resources**: `resources/list` and `resources/read` with
  `ttlMs`, `cacheScope`, digests and sizes, the `resources` capability, stable
  order, and the 2026-07-28 rules already recorded (`Mcp-Name` carries
  `params.uri`; lists do not vary per connection).
- Serving the **Skills extension** (`io.modelcontextprotocol/skills`,
  SEP-2640): the declaration, `skills/list`, `skills/get`, manifests computed
  from served bytes, `-32602` for unknown URIs; `directoryRead` optional and
  off by default.
- **Per-command tool `_meta`**: a command may carry extra `_meta` entries
  under reverse-DNS keys other than `dev.afd/`, emitted on its tool under
  every strategy and by `afd-detail`; reserved and host-owned keys refused at
  registration.
- Prompts stay out (no phase needs them yet); the proposal records them as
  its next step.
- Reconciled with the Skill Knowledge Layer: its `*.skill.md` command skills
  remain a separate, local convention; Agent Skills served over MCP are this
  proposal's.

**0b. Rust implementation** in `packages/rust`, behind the `server` feature:
`McpServer::with_resources(impl ResourceProvider)`,
`McpServer::with_skills(SkillCatalog)` (which also serves the skill files as
resources), and `CommandDefinition::with_tool_meta(key, value)`; tests over
stdio and Streamable HTTP in both eras with the spec's vectors; CHANGELOG and
the language parity rows (other languages follow and do not block Umbel, as
for the hybrid strategy). The same pull request splits the Rust todo backend
into a library and its binary: `src/lib.rs` exposing
`pub fn commands(store: Arc<TodoStore>) -> Vec<(CommandDefinition, serde_json::Value)>`
and `TodoStore::new`, with axum and `tower-http` only in the binary (a
`server` feature, on by default), and its conformance runs unchanged. If
`rmcp` cannot route the extension's methods, 0b stops and amends 0a.

### Umbel steps

| Step | Pull request | Contents | Tests | Size |
| --- | --- | --- | --- | --- |
| 0a | AFD: resources, Skills extension, tool `_meta` (spec) | Above | None (documents) | M |
| 0b | AFD: the Rust implementation and the todo library split | Above | Above | L |
| 1 | Manifest and configuration | `plugins/manifest.rs`, `source.rs`; `workspace-config.v2.json`, `plugin-manifest.v1.json`, `pack-manifest.v1.json` with examples; configuration version 2; `init` writes 2; the doctor's file-only plugin checks; the WIT file; the version constants | `manifest.rs`, `schemas.rs`, `workspace.rs`, `doctor_plugins.rs` (file-only cases) | M |
| 2 | Loader core, compiled plugins, grants, packs | The load sequence of section 6, `CompiledPlugin`, `with_compiled`, `cli::run_with`, `Services` and the grant gates, packs and overrides, per-space enablement and the plugin gate, first-class suggestions, contexts and pipelines, `plugin-list`, `plugin-show`, the new `workspace-show` fields; `umbel-sdk` without its features; `umbel-plugin-hello` as a compiled plugin; the `testkit` feature with phase 0's drivers moved into it | `plugin_compiled.rs`, `grants.rs`, `plugin_spaces.rs`, `packs.rs`, `plugin_conflicts.rs`, `first_class_plugins.rs`, `contexts_pipelines.rs`, `plugin_commands.rs`, `testkit.rs`, the rest of `doctor_plugins.rs`, hello's own tests | L |
| 3 | Skills on three paths | Skills validation, `with_skills` and resources on the host's server, `skill-list`, `skill-export`, origin `_meta` on plugin tools | `skills.rs` | M |
| 4 | Component loader | wasmtime 48, the linker with the world and virtualized WASI 0.2, imports against grants, limits, per-call stores, the SDK's `component` feature and `export_component!`, hello as a component, the fixture components, `umbel.yml`'s wasm build | `plugin_component.rs`, `component_limits.rs`, `component_replay.rs` | L |
| 5 | Mounted loader | rmcp's client over stdio and HTTP, renaming, overrides, result mapping, stamps, respawn, the SDK's `mounted` feature and `hello-mcp` | `plugin_mounted.rs`, `mount_naming.rs` | L |
| 6 | The todo plugin and the conformance job | `umbel-plugin-todo` and `umbel-todo` over the todo library; `--backend umbel` and `test:conformance:umbel` in the todo example; the `conformance` job in `umbel.yml` (suites, scenarios, `afd validate --surface`); inventory and `architecture.json` rows for the new crates. **Changes nothing under `endpoints/umbel/src/`, `wit/` or `schemas/`** | `plugins/todo/tests/todo.rs`; the `conformance` job | M |
| 7 | `plugin new` and `plugin check` | Templates, `plugin-new`, `plugin-check`, the README's "Write a plugin" section | `plugin_scaffold.rs` | M |
| 8 | Exit | `hello_three_ways.rs`; STATUS.md marks phase 1 done with the run's evidence; the exit criterion re-run on `main` | `hello_three_ways.rs` | S |

Order: 0a, then 0b. Step 1 needs only 0a merged (it writes no server code).
Step 2 needs 1. Step 3 needs 0b and 2. Steps 4 and 5 need 2 and may run in
parallel. Step 6 needs 0b, 2 and 3 (the suite's server lists resources).
Step 7 needs 4 and 5 (its templates cover every kind). Step 8 needs all.

## Follow-ups

| Date | Follow-up | Owner |
| --- | --- | --- |
| 2026-11-01 | The owner's decision on the four trust-model points of [section 11](#11-security) before step 2 merges | Owner |
| 2026-11-01 | A precompiled component cache: wasmtime's `Component::deserialize` is `unsafe`, which the crate forbids; decide whether a reviewed `unsafe` module or a safe alternative is worth it once startup cost is measured | Phase 7, or earlier if measured |
| 2026-11-01 | A mount's tool snapshot under `state/`, so one-shot CLI calls do not spawn every mounted server at `seal` | A later phase |
| 2026-11-01 | WIT world 2.0.0 on WASI 0.3 once `wasm32-wasip3` is Tier 2 on the pinned toolchain (watch row W17) | Owner of the phase that needs async components |
| 2026-11-01 | MCP prompts in AFD servers, the step after step 0a's proposal, when a phase needs workflows as prompts | AFD |
| 2026-11-01 | The `http` and `secrets` grants, and moving `bearer_env` under `secrets` | The first plugin that needs outbound calls |
