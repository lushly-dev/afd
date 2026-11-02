# Umbel

AFD Umbel is an empty host for capability plugins, reachable over MCP and as
a CLI. It ships with no capability of its own; knowledge, memory, context,
tools and connectors arrive as plugins, some built here as examples and
first-party defaults, most built by the people who deploy it for their own
stack. One deployment can hold several isolated knowledge bases, called
spaces, that never mix by default. The frontier model calling it does the
reasoning; Umbel keeps that model informed, remembered and connected, with
every answer traceable to its source.

An umbel is an inflorescence in which every flower stalk rises from a single
point and none depends on another. That is the architecture.

## Status

Phase 0, the host skeleton, is done: the empty host serves MCP over stdio and
Streamable HTTP and a CLI from one registry, with a workspace, the journal and
its per-space event log, approvals and confirmations, and no plugins. Phase 1,
the plugin contract, is done too (its
[specification](docs/phases/1-plugin-contract/spec.md) is met): the host loads
compiled, component and mounted plugins, serves their packs and skills, and
scaffolds and checks them with `plugin new` and `plugin check`; the hello
plugin answers alike built all three ways, and the todo example's conformance
suite passes against it. Phase 2, knowledge, is under way: its store traits, the embedded
SQLite and tantivy backend and, with step 4, the host services (store grants with allow lists,
reader filters, `store-show`, `store-check`, `store-backup`) are in; the knowledge plugins are
not yet. Nothing is released or published; the
crate is `publish = false` and its release unit is quarantined with no route under the
[platform migration](../../docs/features/active/platform-monorepo/) rules.
[STATUS.md](docs/STATUS.md) says exactly what is done.

## Build and run

Umbel needs Rust 1.97 or later (`rust-toolchain.toml` pins it) and builds
against the in-repository `afd` crate.

```sh
cd endpoints/umbel
cargo build --locked
cargo test --locked

# A workspace with one space, `main`.
./target/debug/umbel init ~/umbel-ws
cd ~/umbel-ws
umbel workspace doctor        # exits 0 with "healthy": true
umbel help                    # the commands the CLI can run
umbel workspace show

# MCP for a harness, over stdio (stdout carries only JSON-RPC).
umbel serve --stdio

# MCP over Streamable HTTP, loopback only. Every request needs the bearer
# token in state/keys/http.token; --print-token writes it to stdout.
umbel serve --http --bind 127.0.0.1:7410 --print-token
```

The workspace is found from `--workspace`, then `UMBEL_WORKSPACE`, then the
nearest `umbel.toml` upward. Several processes may use one workspace at once:
stdio servers from different harness sessions, an HTTP server and one-shot CLI
commands. The [phase 0 specification](docs/phases/0-host-skeleton/spec.md)
defines the configuration, commands, surfaces and shapes.

## Write a plugin

A plugin is a directory (or, for a compiled plugin, a crate) with one manifest, `umbel-plugin.toml`.
It runs one of four ways, which its `plugin.kind` names:

| Kind | What it is | Isolation |
| --- | --- | --- |
| `compiled` | A Rust crate linked into a host binary through `umbel-sdk` | None: it runs with the host's permissions, and its grants are a declaration |
| `component` | The same source built as a WebAssembly component for `wasm32-wasip2` | A sandbox: no network, files or environment; only the interfaces its grants allow; fuel, time and memory limits per call |
| `mounted` | An external MCP server the host starts over stdio (or reaches over HTTP), its tools renamed under a prefix | A separate process with a cleared environment; no caller credential ever reaches it |
| `pack` | Content only: packs and skills, no code | Not applicable |

Scaffold one, check it, and read the manifest it writes:

```sh
umbel plugin new kind=component id=notes dir=notes   # compiled | component | mounted | pack
cd notes && cargo test                               # the plugin through the test kit
cargo build --release --target wasm32-wasip2 --features component
cp target/wasm32-wasip2/release/umbel_plugin_notes.wasm notes.wasm
umbel plugin check path=.                            # the manifest, grants, schemas, packs, skills,
                                                     # config, the component's imports, and a boot
```

`plugin new` refuses a directory that is not empty. A compiled or component crate depends on
`umbel-sdk` and, for its tests, on `umbel` with the `testkit` feature; the scaffold names them by git,
and `umbel_path=<checkout of endpoints/umbel>` names them by path instead. It also copies the
host's toolchain pin, so the crate builds with the compiler the host does.

**The manifest** holds the plugin's identity and kind, its `domains` (the first name segment of its
commands), `[[commands]]` with their JSON Schemas and `effects`, `[[packs]]`, `[[skills]]`, an
optional `[config]` schema, and `[[grants]]`. Commands are named `domain-action`. `effects` is
`inspect` (changes nothing) or `plugin-state` and `external` (change something, so the host writes an
event). A mounted plugin declares `[mount]` instead of commands: its tools come from the server, and
`[[mount.tools]]` says what each really does. The
[specification](docs/phases/1-plugin-contract/spec.md#2-the-manifest) is normative.

**Grants** are the host services a plugin may use: `config`, `log`, `packs`, `events`, `clock` and
`random`. Declare each with a `reason`; the deployer sees the reasons and may deny an optional grant.
A component imports a service only when its code calls it, and the host refuses an import its
manifest has no grant for: `plugin check` names the grant to add. A compiled plugin's grants are a
declaration and not a sandbox. Mounted and pack plugins declare none.

**Building a component.** `umbel-sdk`'s `export_component!` exports the WIT world
`umbel:plugin/plugin@1.0.0` from the same `Plugin` implementation the tests run as a compiled
plugin. Build with `--target wasm32-wasip2 --features component`; the toolchain file the scaffold
writes already names the target. A component keeps no state between calls and reads time and
randomness only through `Cx`. Random bytes are written to the journal, so never use them for keys.

**Mounting a server.** Any MCP server over stdio works; AFD's TypeScript (`@lushly-dev/afd-server`),
Python (`afd` with FastMCP) and Rust (`afd` with its `server` feature, or `umbel-sdk`'s
`serve_mounted`) servers all do. `umbel plugin check path=<dir>` reads the manifest and does not
start the server. `spawn=true` starts it, lists its tools and reports what mounts, what was skipped
and which descriptions match the `description-injection` rule. It runs the plugin's own program, so
it is off unless you ask for it.

**The test kit.** `umbel::testkit::TestHost` (feature `testkit`) boots an in-process host with only
your plugin and a fixed clock, with `call`, `mcp`, `http`, `cli` and `replay`; the scaffold's
`tests/plugin.rs` is a working example. [`plugins/hello`](plugins/hello) is the reference plugin:
one command, one pack and one skill, built compiled, as a component and mounted.

**Reading files into the stores.** [`plugins/sources-filesystem`](plugins/sources-filesystem) is the
first plugin that fills the document store (its id is `sources`, so enable `compiled:sources`). It
reads the markdown and code files of the collections a space declares in `umbel.toml` (version 3),
with `sources-sync` and `sources-status`. Changes are found by content hash; a symbolic link inside
a root is never followed; a file over `max_file_bytes` or with malformed frontmatter is skipped and
counted, not guessed at. Its results give totals for every file and the ids of the documents the
caller can read, and only a person at the command line also gets paths. Content that looks like
instructions or hides text is flagged and stored, never blocked. It needs the write grants
`documents_write` and `records_write` allowed for the space in `umbel.toml`, as the plugin's
tests show.

`plugin check` does not run AFD's surface validation, which is a TypeScript tool: run `afd validate
--surface` against `umbel serve --http` with the plugin enabled.

## Access is not a security boundary yet

Phase 2 gives every document, chunk, node and edge an access set and turns the caller's principal
into a reader filter that every store query applies before ranking; a space's `readers` decide who
may open it at all (`SPACE_NOT_READABLE`). That filtering is **exact only for embedders and
tests**, who set the principal themselves. Until phase 5 verifies callers, nothing vouches for who
is on the other end of stdio or loopback HTTP: every stdio caller is the one principal
`agent:<principal.local_id>` (acting for `principal.on_behalf_of` when you set it), every HTTP
caller is `agent:loopback`, and the CLI is always `human:<principal.local_id>`. So on those
surfaces access is a policy, not a boundary, and it protects nothing a local process could not
read from the files. To make one person's CLI and that person's agents line up, set
`principal.local_id` and `principal.on_behalf_of` to the same id. `workspace-show` reports this as
`access: { principals: "unverified", exact: ["library"] }` until phase 5 changes it. Hidden
content and ids are never returned, but hidden counts are not fully hidden: scores, revision and
`seq` gaps, `store-show`'s head and the totals of index-building commands can reveal how many
hidden things exist (an accepted limit, listed in the specification's section 6).

A plugin's write grants (`content_write`, `documents_write`, `records_write`, `index_write`,
`graph_write`) are not given by enabling it: each needs `[plugins.<id>.grants.<grant>] allow =
[...]` in `umbel.toml` (`<space>/<collection>` or `<space>/*` for files and documents, `<space>`
or `*` for the rest). A compiled plugin's store grants are trusted code, not a sandbox, and a
command marked `confirm = "require-human"` runs only when a person answers its prompt at a
terminal: `--yes` and `--approve` do not count, and MCP and agents never reach it.

## Documents

Read [STATUS.md](docs/STATUS.md) first: it says exactly what is done, what
is not, and what future sessions must know. No agent should have to scan the
codebase to learn what is current.

| Document | Purpose |
| --- | --- |
| [Status](docs/STATUS.md) | Source of truth for progress: document and phase state, exact done and not-done lists, follow-ups not yet issues, session log |
| [Architecture](docs/architecture.md) | The through line: vision, principles, system shape, components, interfaces, libraries and phases. Each phase's owning agent writes a detailed specification against it |
| [Proposal](docs/proposal.md) | What Umbel is, the plugin contract, first-party plugins, scale profiles, open decisions and the first proof |
| [Decision log](docs/decisions.md) | Dated decisions each phase specification cites |
| [Trajectory watch](docs/trajectory.md) | Where the protocol, harnesses and enterprise context are heading, what Umbel reserves for each, and the dated watchlist |
| [Research](docs/research.md) | Synthesis of public sources on agent memory, retrieval and the MCP stack |
| [Sources](docs/sources.md) | Annotated source ledger with dates and inference limits |

The feature index in [docs/features](../../docs/features/README.md) lists Umbel
under proposed features and points here.
