# Loam

AFD Loam is an application shell for AFD applications: one chrome into which
many apps land as plugins and share what no app should build twice. Sign-in,
account, persona and agent members; workspaces and projects that group what
the apps make; documents, with types any plugin contributes and an editor
area that holds many at once; multiplayer, presence and sharing as one
service for all of them; settings, experiments and notifications; the
command palette, the copilot and the status bar; a builder in which the
copilot makes, checks and publishes an app to the team without leaving the
shell; overlays that stay with the app that opened them; a layout engine
and a shared UX library; and one component library. The shell's own state
is commands, so agents, tests and automation drive it the
way people do. It is TypeScript end to end: one kernel runs in the browser,
on the desktop under Tauri and on a hosted server, and the chrome is FAST-AF
web components on a Violet design foundation; Rust enters only where a
measurement shows it pays.

Loam is the soil: the layer everything grows in and nothing is.

## Status

Proposed, documentation only. No crate, package or release exists yet. The
name was decided on 2026-10-30 (decision D22 in the
[decision log](docs/decisions.md)). When code lands, this area holds the
TypeScript packages, and any Rust WebAssembly unit a measurement admits,
beside these documents, following Botcore's layout under `endpoints/`, and
its units start quarantined under the
[platform migration](../../docs/features/active/platform-monorepo/) rules.

The first consumer is a Lushly support application: internal tooling used to
build Lushly, not Lushly's own product interfaces. That application is
specified in Lushly's repository; Loam records only the shell needs it
surfaces, and nothing Lushly-specific lives here.

## Documents

Read [STATUS.md](docs/STATUS.md) first: it says exactly what is done, what
is not, and what future sessions must know. No agent should have to scan the
codebase to learn what is current.

| Document | Purpose |
| --- | --- |
| [Status](docs/STATUS.md) | Source of truth for progress: document and phase state, exact done and not-done lists, follow-ups not yet issues, session log |
| [Architecture](docs/architecture.md) | The through line: vision, principles, system shape, components, the surface catalog, interfaces, libraries and phases. Each phase's owning agent writes a detailed specification against it |
| [Proposal](docs/proposal.md) | What Loam is, the app contract, how projects and apps relate, documents and multiplayer, surfaces, overlays, the design foundation, identity and agent members, the copilot, the language choice per part, first-party apps, the builder and the first proof |
| [Decision log](docs/decisions.md) | Dated decisions each phase specification cites, and the open decisions, all closed on 2026-10-31 |
| [Trajectory watch](docs/trajectory.md) | Where agent interfaces, the web platform, plugin shells and client-side Rust are heading, what Loam reserves for each, and the dated watchlist |
| [Research](docs/research.md) | Synthesis of public sources on loved application layouts, plugin shells, isolation and overlays, client runtimes, identity and experiments |
| [Landscape](docs/landscape.md) | The AI-first shells, platforms and operating systems of 2026, the gaps between them, and the opportunities Loam adopts, reserves or watches, closed as decisions D39 to D49 |
| [Sources](docs/sources.md) | Annotated source ledger with dates and inference limits |

The feature index in [docs/features](../../docs/features/README.md) lists Loam
under proposed features and points here.
