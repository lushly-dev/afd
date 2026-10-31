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

Proposed, documentation only. No crate, package or release exists yet. When
code lands, this area holds the Cargo workspace beside these documents,
following Botcore's layout under `endpoints/`, and its units start
quarantined under the [platform migration](../../docs/features/active/platform-monorepo/)
rules.

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
