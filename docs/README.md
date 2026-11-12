# AFD Documentation

> Agent-First Development — where commands are the application and UI is just one surface.

Start with the [root README](../README.md): it tells the story, walks through a five-minute quickstart and introduces [the rest of the AFD family](../README.md#the-rest-of-the-repository). This folder holds what sits behind it.

## Where to look

| You want | Go to |
|----------|-------|
| The argument for agent-first development | [whitepaper/](./whitepaper/AFD-Whitepaper.md) |
| How to design and write commands | The skills under [`.claude/skills/`](../.claude/skills): `afd` (philosophy, jobs first, command schema, MCP integration), then `afd-typescript`, `afd-python`, `afd-rust` or `afd-cpp` |
| The contract every language implements | [`spec/`](../spec): wire format, error codes, command metadata, authorization, and the vectors that test them |
| What each language implements today | [language-parity.md](./language-parity.md) |
| What is proposed, in progress or shipped | [features/](./features/README.md) |
| How releases and hosted checks are run | [operations/](./operations/) |
| Past repository reviews | [reviews/](./reviews/) |
| History before per-package changelogs | [changelog-archive.md](./changelog-archive.md); current changelogs are indexed in the [root CHANGELOG](../CHANGELOG.md) |

## The rest of the family

Each project keeps its documentation next to its code. A status file says exactly what is done and what is not, so nobody has to read the code to find out.

| Project | Start here | Status |
|---------|-----------|--------|
| Specimen, a component observation bench | [README](../foundations/specimen/README.md) | [Specimens status](./features/active/specimens/STATUS.md) |
| FAST-AF, a web component runtime and components | [README](../foundations/fast-af/README.md) | In its README |
| Violet, a design token engine | [README](../foundations/violet/README.md) | [Transition notes](./features/active/platform-monorepo/violet-transition.md) |
| Umbel, a host for capability plugins | [README](../endpoints/umbel/README.md), [architecture](../endpoints/umbel/docs/architecture.md) | [Umbel status](../endpoints/umbel/docs/STATUS.md) |
| Loam, an application shell | [README](../endpoints/loam/README.md), [architecture](../endpoints/loam/docs/architecture.md) | [Loam status](../endpoints/loam/docs/STATUS.md) |
| Botcore, shared agent tooling | [README](../endpoints/botcore/README.md) | [Handoff record](./features/active/platform-monorepo/botcore-handoff.md) |
| Health, repository audits, and its dashboard | [Health](../endpoints/health/README.md), [dashboard](../endpoints/health-dashboard/README.md) | In each README |

How these came to share one repository, and the rules that keep an imported package from being published by accident, are in the [platform monorepo](./features/active/platform-monorepo/) project and its [status](./features/active/platform-monorepo/STATUS.md).

## Features

A feature is proposed, reviewed, built and shipped. Its folder under [features/](./features/README.md) moves with it:

| Stage | Folder | Description |
|-------|--------|-------------|
| **Proposed** | `features/proposed/` | Draft proposals pending review |
| **Active** | `features/active/` | Approved, in implementation |
| **Complete** | `features/complete/` | Shipped and archived |

A feature that adds or changes commands starts from the jobs it serves, each written as a scenario file before the commands are specified. Each feature folder contains:

- `<feature>.proposal.md` — the what and why
- `scenarios/` — the jobs, one `*.scenario.yaml` each
- `spec.md` — the how, after approval
- `STATUS.md` — what is done and not done, kept current once work starts
- `assets/` — diagrams and screenshots (optional)

The [feature index](./features/README.md) lists every feature and its state.

## Operations

| Document | What it covers |
|----------|----------------|
| [platform-releases.md](./operations/platform-releases.md) | How a package is admitted for release, and the npm release workflow |
| [native-first-releases.md](./operations/native-first-releases.md) | The first Rust and C++ releases, and the ones that followed |
| [stabilization-release.md](./operations/stabilization-release.md) | The October 2026 stabilization release and its receipts |
| [hosted-verification.md](./operations/hosted-verification.md), [hosted-verification-round.md](./operations/hosted-verification-round.md), [hosted-render.md](./operations/hosted-render.md) | Checking auth and durable persistence against hosted providers |
| [model-routing.md](./operations/model-routing.md) | Which model and effort a development agent uses for which task |
| [skills-audit-2026-11.md](./operations/skills-audit-2026-11.md) | The November 2026 audit of the repository's skills |
