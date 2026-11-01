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
the plugin contract, has its
[specification](docs/phases/1-plugin-contract/spec.md) in review. Nothing is released or published; the crate is
`publish = false` and its release unit is quarantined with no route under the
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
