# Loam trajectory watch

**Research date:** October 30, 2026. **Owner:** repository owner; a phase's
owning agent refreshes the rows it depends on before writing its
specification. Dates are the sources' own; "reserved" means Loam keeps a
seam for it without implementing a draft. Source IDs refer to the
[ledger](sources.md).

## Six movements

1. **Agents are getting interfaces, and hosts are where they render.** MCP
   Apps is stable as 2026-01-26: a `ui://` resource in a sandboxed iframe,
   data withheld until the view is ready, tool calls brokered by the host.
   ChatGPT, Claude, VS Code and others host it with varying support, and the
   specification has a development draft beside the stable one [S16]. VS
   Code now takes agent skills, chat agents and language-model tools as
   contribution points [S02]. Agent runtimes settled into three shapes,
   loop libraries, frameworks and vendor harnesses, and the loop libraries
   converged on AG-UI as the stream to the interface: TanStack AI 1.0
   speaks it natively and a dozen frameworks integrate [S43, S46]. A shell
   that is an MCP Apps host, an AG-UI consumer and an AFD registry is
   where those lines meet.
2. **The platform shipped what shells used to fake.** The top layer with
   popover and dialog, anchor positioning, scoped custom element registries
   in Chromium and Safari, the Navigation API at Baseline since 2026-01-13,
   same-document view transitions in every engine [S18, S19, S21, S22].
   Firefox lags on scoped registries and cross-document transitions.
3. **Plugin shells converge on declared contributions plus versioned runtime
   extension points, and prune.** Grafana removed its deprecated extension
   APIs in February 2026 and requires prefixed, versioned extension point ids
   [S14]; VS Code's `contributes` keeps growing [S02]; Module Federation 2.0
   is stable with the runtime decoupled from bundlers, while import maps
   stay the lighter path [S17].
4. **Loved layouts personalize the sidebar and keep a fixed band.** Linear's
   sidebar became personal in December 2024 and its mobile navigation
   customizable in January 2026 [S06]; Notion's sections reorder and collapse
   [S08]; Slack moved to tabs plus custom sections [S09]; Things and Arc keep
   a fixed global band above a contextual one [S07, S10].
5. **Client-side Rust matured without displacing the platform's components.**
   Tauri 2 is on its 2.10 line with mobile from one codebase [S24]; Dioxus
   0.7 hot-patches Rust at runtime and Leptos is at 0.8 with 0.9 near [S25,
   S26]; WASI 0.3 brought async to the component model, and components reach
   browsers by transpilation only [S27]. None of the Rust frontends addresses
   web components in the sources found.
6. **Identity and experiments have settled conventions.** Organizations,
   teams, roles and passkeys come from the provider [S30, S31]; experiments
   are opt-in, off by default, with a visible lifecycle [S34]; persona is a
   lens that grants nothing in every console that documents it [S33].

7. **Operating systems and browsers became agent hosts, and they expect
   applications to declare actions.** Windows runs a registry of MCP
   connectors behind a proxy with separate agent accounts; Android's
   AppFunctions and Apple's App Intents expose typed app actions to the
   platform's agent; Chrome's WebMCP lets a page register tools in an
   origin trial [S61, S62, S63, S64]. AFD's thesis is now platform
   policy, and a shell whose registry already carries exposure flags can
   project itself into each host.
8. **Agents became members and runs became the unit of work.** Linear
   admits agents as non-seat members with delegated issues and guidance;
   Slack opens a temporary channel per agent task with pause, redirect and
   stop for anyone present; Microsoft gives agents directory identities
   with human sponsors; coding tools rebuilt around lists of parallel,
   isolated runs [S60, S67, S68, S69]. OWASP names human-agent trust
   exploitation, and practitioners measure approval decay [S71, S72]. The
   [landscape](landscape.md) draws the gaps and opportunities.

## What Loam reserves because of them

| ID | Reservation | Movement | Where it lands |
| --- | --- | --- | --- |
| R1 | The sandboxed view as an app kind on the MCP Apps profile, and export of native views as `ui://` resources | 1 | Architecture sections 4 and 5; phase 1 |
| R2 | Agent skills, prompts and AFD contexts as app contributions delivered to the agent panel | 1 | Surface catalog; phase 5 |
| R3 | Overlays on the top layer with `inert` and anchor positioning, fallbacks retired by the watchlist | 2 | Overlay policy; phase 1 |
| R4 | Scoped custom element registries with a polyfill until Firefox ships | 2 | D34; phase 1 |
| R5 | Routing on the Navigation API and URLPattern; view transitions where present | 2 | Libraries table; phase 0 |
| R6 | A surface catalog with versioned surface ids and a removal rule for deprecated surfaces | 3 | Architecture section 4; phase 1 |
| R7 | Native apps as ES modules under import maps; no bundler coupling in the contract | 3 | App manifest; phase 1 |
| R8 | A personal, reorderable sidebar and rail, persisted as view-state | 4 | Layout engine; phase 2 |
| R9 | A kernel behind the SDK interface, so Rust WebAssembly modules, a Rust-rendered chrome or a WebAssembly-component app kind can attach later without a contract change | 5 | Architecture section 6; phases 0 and 6 |
| R10 | Workspaces bound to provider organizations; a reserved tenant field; experiments with audiences | 6 | Data model; D32; phase 3 |
| R11 | A copilot runtime adapter so the SDK can change, with agents, handoffs and sessions as AFD records above it and AG-UI as the stream so another runtime can attach | 1 | Architecture sections 4 and 5; D27; phase 5 |
| R12 | Document types as contributions with one model and many editors, so a document can later be served as an MCP Apps view or driven by any agent through its instance commands | 1 | Architecture sections 4, 5 and 7; phase 2 |
| R13 | The registry projected outward: WebMCP tools in the browser, an MCP bundle for platform registries, AppFunctions and App Intents through Tauri mobile, all as projections of `expose` | 7 | D39; phase 5 and later |
| R14 | Agent members with sponsors, project scope, delegation and guidance, on AFD's actor and `onBehalfOf` | 8 | D40; phases 3 and 5 |
| R15 | Autonomy policy in settings with approval-health metrics, and untrusted labels on tool results | 8 | D41; phases 4 and 5 |
| R16 | Runs as shell resources with isolation, artifacts, scheduling and shared visibility | 8 | D42; phase 5 records |
| R17 | A2UI rendered from the kit as the second agent-UI path, and agent packs in the Agent Skills and plugin-directory shapes | 1, 8 | D43 and D44; phase 5 |
| R18 | Collaboration as one shell service bound per document type and run, with the journal as record, CRDT updates as commands, link generations and authorization epochs | 8 | D46; its own specification after phases 2 and 6 |

## Watchlist

| ID | Item | Status on 2026-10-30 | Next date | What changes for Loam |
| --- | --- | --- | --- | --- |
| W1 | MCP Apps specification | 2026-01-26 stable; development draft open; host support varies | Unknown; follows the MCP release cycle | The host profile the sandboxed view implements; the exact `_meta` key and MIME type pinned in the phase 1 specification |
| W2 | Serving resources from AFD servers | Not implemented; a prerequisite shared with Umbel | Before phase 1 | Whether a Loam view can be served to other hosts |
| W3 | Scoped custom element registries in Firefox | Not shipped; Chrome 146 and Safari 26 ship | Unknown | Retire the polyfill (D34) |
| W4 | CSS anchor positioning in Safari | Unconfirmed in the sources | Unknown | Retire the fallback |
| W5 | Cross-document view transitions in Firefox | Not shipped | Interop 2026 hoped, unconfirmed | Cosmetic only |
| W6 | Navigation API precommit handler in Safari | Missing | Unknown | Route guards use the fallback path |
| W7 | Tauri 2 line and mobile maturity | 2.10 line; mobile younger than desktop | Ongoing | D33 |
| W8 | WebAssembly components in browsers | Transpilation through jco only; no native implementation | Unknown | A component app kind stays reserved |
| W9 | Rust frontends and web components | No support found in Dioxus or Leptos sources | Unknown | A Rust-rendered chrome stays reserved |
| W10 | Module Federation 2.0 versus import maps | Both viable; the contract avoids bundler coupling | Ongoing | Nothing unless a consumer needs federation |
| W11 | MCP Events, SEP-3415 | Open, no sponsor, as Umbel's watch records | Unknown | `shell-events` and notifications on the hosted server gain a protocol projection |
| W12 | Better Auth sessions and cookie cache | 1.4 stateless sessions reported; revocation delayed by the cookie cache | Unknown | Session revocation shown with its caveat; verify in phase 3 |
| W13 | Agent Skills in shells | VS Code contributes `chatSkills`; the format moved to the Agentic AI Foundation on 2026-10-22 | Unknown | Skills delivered to the agent panel follow the format |
| W14 | Platform migration cutover of FAST-AF and Violet | Both quarantined; nothing publishes | Per the migration status | Whether the chrome consumes workspace units or published packages |
| W15 | TanStack AI after 1.0 | Core stable since 2026-10-23; `@tanstack/ai-harness` experimental at 0.x; web components undocumented | Each minor | The runtime adapter pins a version; the spike before phase 5 settles the web-component panel |
| W16 | The AI SDK line | 7.x stable since 2026-06-25; MCP Apps renderer experimental | Ongoing | The fallback behind the adapter |
| W17 | GitHub Copilot SDK | Public preview per GitHub's docs, GA per its README; renaming to Microsoft Copilot SDK; key-only BYOK | Unknown | Nothing unless its process model changes; set aside by O9 |
| W18 | AG-UI governance | No version or license on its introduction page; integrations across a dozen frameworks | Unknown | The stream contract the panel pins |
| W19 | Agent Engine proposal in AFD | Proposed; records and loop undefined | Before phase 5 | The copilot's agent, handoff and session records are its records |
| W20 | WebMCP in Chrome | Origin trial Chrome 149 to 156; `document.modelContext` since 150; a default-on plan for 157 reported, unverified | 2026-11 | The browser projection of the registry ships behind feature detection until it is on by default |
| W21 | Windows on-device agent registry | Public preview with agent accounts and an MCP proxy | Unknown | The desktop packages the hosted server as an MCP bundle |
| W22 | Android AppFunctions and Apple App Intents | Experimental and private preview; App Intents current in iOS 27 | Android 17; iOS 27 | Mobile projections wait for Tauri mobile (D33) |
| W23 | A2UI toward 1.0 and MCP Apps integration | v0.9 of 2026-04-17; Lit renderer; integration on the roadmap | Unknown | The kit as an A2UI catalog (D43) |
| W24 | Chrome Prompt API on pages | Still being developed; extensions shipped; Mozilla objects | Unknown | An on-device provider only when `availability()` says so (D45) |
| W25 | Slack Code beyond engineering and Linear's agent guidance | Code channels for engineering, broader uses planned; guidance per workspace and team | Unknown | Run sharing and agent guidance shapes (D40, D42) |
| W26 | OWASP agentic Top 10 and incident roundups | 2026 edition with ASI09; quarterly roundups | Quarterly | The autonomy policy and approval metrics (D41) |
| W27 | Agent plugin formats | Claude's plugin directories and Agent Skills converge on files; Cowork, Claude Code, VS Code and Raycast each load something | Unknown | The agent-pack loader (D44) follows Agent Skills first |
| W28 | CRDT and sync-engine choice | Yjs the most deployed; Automerge with a Rust core; Postgres sync engines for structured data | Before the collaboration specification | Which library sits behind the document store trait (D46) |

## Deliberately not chased

A chrome rendered by Rust; iframes for native apps; a marketplace or an app
store; multi-tenant hosting before the hosted phase; a second design system,
since Violet and the FAST-AF components are it; Electron; a graph of
projects or a project management product, since a project here is only a
scope; A/B experimentation and metrics; a notifications push service;
server-side rendering of the chrome; mobile-native apps before the desktop
lane is stable; importing any shell's code; a vendor copilot SDK or any
runtime that keeps the agent loop in a process the shell does not own; a
model gateway of Loam's own.

## Sources

The dated sources for the movements above are rows S01 to S34, S43 to
S53 and S55 to S78 of the [ledger](sources.md). Umbel's [trajectory watch](../../umbel/docs/trajectory.md)
covers the protocol, harness and enterprise-context movements Loam depends
on through Umbel, in particular MCP Events, Tasks, agent identity and Skills
over MCP, and is not repeated here.
