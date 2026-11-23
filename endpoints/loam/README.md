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

In development. The shell runs in a browser today, and three of its phases
have met their exit criteria on `main`:

- **Phase 0, kernel, chrome and design foundation.** The kernel with its
  command registries and journal, the chrome as FAST-AF elements, Loam's
  Violet theme in light, dark and high contrast, and the browser host.
- **Phase 1, the app contract.** One manifest, an SDK and a test kit for
  apps; native, view and mounted apps; the `loam` CLI that scaffolds, checks
  and packs one; and a console that gives every app a first interface from
  its commands alone.
- **Phase 2, scope, projects and documents.** Workspaces and projects that
  scope what an app sees, and documents whose types an app contributes, open
  side by side in the editor area.

Phases 3 to 6 are being built: identity; settings, notifications and
overlays; the copilot; and hosts. Phases 7 and 8 (the builder, and guides)
and the collaboration service have not started. [STATUS.md](docs/STATUS.md) says
exactly what is done and what is not; this summary only orients.

What is here:

| Directory | What it holds |
| --- | --- |
| [`packages/`](packages/README.md) | The TypeScript packages: manifest, SDK, test kit, CLI, theme, kernel, console, chrome, the browser host, identity and the hosted server. Its README has the commands that build and test them |
| `apps/` | Five small apps that prove the contract: `hello` (the reference app, in all three kinds), `tally`, `tasks` (scoped to a project), and `notes` and `checklist` (document types) |
| [`plugins/mail/`](plugins/mail/README.md) | Loam Mail, a plugin with an engine of its own in Rust, under construction |
| `docs/` | The design: architecture, decisions, phase specifications and status |

Nothing is released. Every TypeScript package is `private: true`, and every
release unit, the mail engine included, is quarantined with no route under the
[platform migration](../../docs/features/complete/platform-monorepo/) rules.
The name was decided on 2026-10-30 (decision D22 in the
[decision log](docs/decisions.md)).

The first consumers are two deployments of the same build (D128, decided
2026-11-16, widening D19). A local, individual Loam each person installs on
the desktop, for per-person apps, with mail as the first app (D135): a
person's work and personal accounts side by side in one client. And a hosted
collaboration Loam for the Lushly organization, with Lushly and AFD as its
projects, which holds the team's shared project work and internal
communication tools as people join. The local one comes first; the hosted
one waits until sometime in 2027 (D129), and its code is frozen behind its
own CI job until then ([the frozen hosted lane](docs/STATUS.md#the-frozen-hosted-lane),
D162). The hosted deployment is specified
in Lushly's repository; Loam records only the shell needs either surfaces,
and nothing Lushly-specific lives here.

## Documents

Read [STATUS.md](docs/STATUS.md) first: it says exactly what is done, what
is not, and what future sessions must know. No agent should have to scan the
codebase to learn what is current.

| Document | Purpose |
| --- | --- |
| [Status](docs/STATUS.md) | Source of truth for progress: document and phase state, exact done and not-done lists, follow-ups not yet issues, session log |
| [Architecture](docs/architecture.md) | The through line: vision, principles, system shape, components, the surface catalog, interfaces, libraries and phases. Each phase's owning agent writes a detailed specification against it |
| [Proposal](docs/proposal.md) | What Loam is, the app contract, how projects and apps relate, documents and multiplayer, surfaces, overlays, the design foundation, identity and agent members, the copilot, the language choice per part, first-party apps, the builder and the first proof |
| [Design](docs/design.md) | The design record for the chrome and kit: principles, the token contract, type, color and contrast floors, density, the parts, motion, focus and state, icons, layout classes, the component checklist and list, and a dated history; the `loam-design` skill carries the same rules |
| [Decision log](docs/decisions.md) | Dated decisions each phase specification cites, and the open decisions, all closed on 2026-10-31 |
| [Trajectory watch](docs/trajectory.md) | Where agent interfaces, the web platform, plugin shells and client-side Rust are heading, what Loam reserves for each, and the dated watchlist |
| [Research](docs/research.md) | Synthesis of public sources on loved application layouts, plugin shells, isolation and overlays, client runtimes, identity and experiments |
| [Landscape](docs/landscape.md) | The AI-first shells, platforms and operating systems of 2026, the gaps between them, and the opportunities Loam adopts, reserves or watches, closed as decisions D39 to D49 |
| [Sources](docs/sources.md) | Annotated source ledger with dates and inference limits |

The feature index in [docs/features](../../docs/features/README.md) lists Loam
under active features and points here.
