# Loam

> This proposal is the rationale for Loam. The
> [architecture](architecture.md) is authoritative for anything current:
> where the two differ, the architecture wins and this document is
> corrected. Progress is in [STATUS.md](STATUS.md).

| Field | Value |
| --- | --- |
| Status | Proposed; drafted in a design session on 2026-10-30, direction not yet approved, implementation not started |
| Date | 2026-10-30 |
| Package boundary | New TypeScript units under `endpoints/loam/`, as the architecture's repository placement describes; Rust WebAssembly modules only where a measurement shows they pay |
| Implementation | Not started by this proposal |
| Name | Loam, decided 2026-10-30 (D22); "AFD Loam" in full |
| First consumer | A Lushly support application: internal tooling for building Lushly, specified in Lushly's repository |

## Purpose

Loam is an application shell for AFD applications. One chrome holds many
apps. Each app is a plugin that declares what it contributes and subscribes
to the shell's surfaces; the shell provides everything that every app would
otherwise build again: sign-in, account and persona; workspaces and projects
that group what the apps make; documents, with types any plugin contributes
and an editor area that holds many at once; settings, experiments and
notifications; the command palette, the copilot and the status bar; overlays
that belong to the app that opened them; a layout engine and a library of
shared UX patterns; and one component library with Violet tokens.

Loam ships empty. With no app installed it is a signed-in chrome with a
palette, a projects section, settings, experiments and an agent panel, and
nothing to do. Capability arrives as apps: some built here as examples and
first-party defaults, most built by the people who deploy it, without
touching this codebase.

Everything the shell knows is a command. Layout, scope, overlays, settings,
experiments, identity and navigation are readable and writable through AFD
commands, so an agent, a test or a script drives the shell exactly as a
person does. Apps talk to each other through the same registry, under grants.

The shell is TypeScript end to end: one kernel runs in the browser, in
Tauri's webview on the desktop and in a Node process on the hosted server,
and the chrome is FAST-AF web components on a Violet design foundation.
Rust enters only where a measurement shows it pays, as WebAssembly behind a
TypeScript interface, and in Umbel, which Loam mounts.

## Positioning

The shells people love share one shape and one discipline. The shape is a
stable global band beside a contextual band: Linear's Inbox and My Issues
above its teams, Things' fixed lists above its areas and projects, Notion's
Favorites above its teamspaces, Arc's pins above the space name, VS Code's
activity bar beside its views. The discipline is that everything is
reachable from the keyboard and a palette, the sidebar is personal, and the
chrome collapses out of the way. The dated reasoning is in the
[research](research.md).

Plugin shells have converged on declared contributions plus runtime
extension points: VS Code's `contributes` with `when` clauses, Grafana's
versioned extension points, Backstage's blueprints, Obsidian's workspace
tree. None of them is an AFD surface: their commands are not the same
commands their agents see, their state is not commands, and their plugins
cannot call each other through a registry with grants. MCP Apps, stable
since 2026-01-26, gives agents a way to render UI but not a shell to live in.

Loam takes the position nobody holds: a shell whose entire state is commands,
whose apps are AFD plugins, whose agents and people share one registry, and
whose projects, identity, overlays and experiments are shell-level so that no
app builds them and no app leaks them into another. The 2026
[landscape](landscape.md) of agent hosts, agent members and agent-rendered
interfaces, and the gaps between them, is where that position is tested.

## Why a shell built on AFD

AFD already provides most of what a shell needs: one command registry for
palette, in-app agent, MCP and CLI callers with per-interface exposure;
`CommandResult` with reasoning, warnings, confidence and undo; the actor and
an extensible command context; confirmations and approvals; the journal and
its replay; batch and pipeline composition; bootstrap discovery and AFD
contexts; view-state commands; the auth adapter with Better Auth and Convex
behind it; and servers in TypeScript, Python, Rust and C++. Loam builds on
those and adds only what a shell of apps needs: the surface catalog, the
layout engine, scope, the overlay manager, the experiments lifecycle, the
app loader and the bus. The architecture's
[Built on AFD](architecture.md#6-built-on-afd) table is the map, and its
prerequisites table lists the AFD features that land first.

## Vocabulary

AFD and Umbel already name most of these, so Loam reuses them; the full
glossary is in the [architecture](architecture.md#12-glossary).

| Word | Meaning here | Precedent |
| --- | --- | --- |
| App | A plugin with a user interface: the unit that lands in the shell | Umbel's plugin; [Plugin Discovery](../../../docs/features/proposed/plugin-discovery/plugin-discovery.proposal.md) |
| Command | The unit of capability inside an app or the shell, exposed to every interface from one registry | AFD core |
| Interface | Who is calling: palette, agent, MCP, CLI, and the proposed `apps` flag | AFD `expose` |
| Surface | A shell-owned region or section an app subscribes to: rail, sidebar, main, inspector, panel, status bar, palette, settings, experiments, notifications, overlays, agent | New; VS Code calls the same idea a contribution point |
| Part | A region of the layout engine's grid: title bar, rail, sidebar, main, inspector, panel, status bar | VS Code's workbench parts |
| Scope | The shell-level context a command runs in: a workspace, optionally narrowed to a project | New; Lushly's active-workspace rule |
| Workspace, project | The two levels of scope; a project groups resources that apps make | Linear, Notion, Slack use the same words |
| Overlay | A toast, dialog, modal, popover or prompt, owned by the shell or by an app session | New |
| Experiment | A flag with a lifecycle that a person opts into | Home Assistant Labs and others |
| Persona | How a signed-in person presents and what the shell emphasizes for them; never a grant | Enterprise consoles; see the research |
| Kit | The shell's own components, built on the FAST-AF component set | New |
| Document, document type | A shell resource with one model and any number of editors; the type any plugin contributes that gives it a schema, an editor and commands | VS Code custom editors, Obsidian leaves |
| Editor area | The main part when documents are open: tabs, splits, pinned and preview editors | VS Code's editor groups |
| Copilot | The shell's chat panel that drives apps and documents through commands; its agents, handoffs and sessions are AFD records | The Agent Engine proposal |
| Agent | A record naming instructions, AFD contexts, skills, a tools filter, a model preference and an owner; the shell's orchestrator or an app's specialist | New |
| Design foundation | Loam's semantic token layer on Violet, its themes, the bridge to the component set, the design document, its skill and the component checklist | The afd.dev design record |

"Surface" in Umbel's documents means a transport (MCP, CLI, library); here it
means a shell region. The two glossaries cross-reference each other
(decision D13). "Module" and "extension" are not used, for the reasons Umbel
gives.

Apps carry plain semantic names for what they do, such as `projects`,
`violet`, `health` and `console`, and their commands follow AFD's
`domain-action` rule, such as `project-create` and `health-report-open`. Only
the shell carries a botanical name, in the register of Violet, Specimen and
Umbel: loam is the soil in which everything grows and which is itself nothing
in particular.

## The empty shell

With no app installed the shell provides the chrome and every part of the
layout; sign-in, account, persona and sessions; workspaces and projects with
their store and a projects section; an editor area, a documents section and
a New menu whose only entry is App, which opens the builder; settings and experiments sections with
no app entries; the notifications inbox; the command palette over the
shell's own commands; the copilot over the same registry; the overlay
manager; the journal; the app loader; the kit; and, on the hosted server,
MCP and REST over the shell's exposed commands. The architecture's
[components](architecture.md#4-components) table says what each owns and
what it does not.

## The shape of the chrome

The default layout, with one project active. Letters on the rail are apps.

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Title bar   workspace ▾        search and palette (⌘K)      agent  me ▾  │
├────┬──────────────────┬───────────────────────────────────┬──────────────┤
│Rail│ Sidebar          │ Main                              │ Inspector    │
│    │                  │                                   │              │
│ ◉ P│ Project: Atlas ▾ │ The active app's stage, routed    │ Properties   │
│ ◉ A│                  │ under the workspace and project   │ of the       │
│ ◉ B│ ─ app views ─    │                                   │ selection    │
│ ◉ C│   list           │                                   │              │
│ ───│   tree           ├───────────────────────────────────┤              │
│ ◉ W│   custom         │ Panel   results · logs · terminal │              │
│ ◉ X│                  │                                   │              │
│ ⚙  │                  │                                   │              │
├────┴──────────────────┴───────────────────────────────────┴──────────────┤
│ Status bar   ⟵ workspace and project items      app and item items ⟶     │
└──────────────────────────────────────────────────────────────────────────┘
   P projects section      A B C project-scoped apps      W X workspace-only apps
   ─── the divider         ⚙ settings and experiments     toasts: bottom right
```

The main part shows the active app's stage or, when documents are open, the
editor area: tabs, splits and pinned editors over open documents. Every
part is optional per app and collapses by rule; the layout engine renders
only the parts an app declares. On narrow viewports the rail becomes
a bottom tab bar and the sidebar a drawer.

## Apps and projects

This is the design question the proposal exists to settle. A shell that
makes a project the mandatory first choice confuses the apps that have
nothing to do with projects: a person picks a project and then sees a
sidebar whose whole context is that project, even in an app that ignores it.
A shell with no project level leaves every app to invent its own grouping.

Loam makes scope a shell-level context with two levels, workspace and
project, and makes every app declare which it supports:

- `scopes: ['workspace']`: the app never takes a project. Its resources
  belong to the workspace.
- `scopes: ['project']`: the app only works inside a project. It is dimmed
  until one is active.
- `scopes: ['workspace', 'project']`: the app works at both levels and
  receives whichever is active.

The rail has two bands with a divider between them, in the pattern the
research found in Arc, Things, Linear and Notion. The top band is headed by
the projects section and the project switcher and lists the apps that
subscribe to the project scope; the bottom band lists the apps that never
take a project. An app that supports both scopes appears once: in the top band under the
project when one is active, otherwise in workspace scope (D29).

| Option | Shape | Strength | Weakness |
| --- | --- | --- | --- |
| A. Project first | Choose a project, then apps inside it | One context everywhere | Workspace-only apps are orphans inside a project; the problem this proposal starts from |
| B. Apps first with a projects app | A rail of apps; a projects app opens a project and shows each app's contributions grouped under it | Apps stay primary; projects are just one app | A person inside a project-scoped app has no visible project context; two navigation models |
| C. Scope as a shell context, two rail bands | The rail is split; a project switcher heads the top band; the active scope reaches every command | One rail, one scope, visible divider between what cares about the project and what does not; agents get one `scope` field | Dual-scope apps need a rule; D29 gives it |

Recommendation: C, with B's projects section as the project home. Rules:

- Projects are shell resources: id, slug, name, icon, status, members,
  timestamps. Apps attach their own resources to a project by id. The
  projects section aggregates each app's contributions through the
  `project-summary` surface, so the project home shows what every app made
  without the shell knowing what it is.
- The active scope reaches every command as a field on the command context
  and, over MCP, as explicit per-request input in `_meta`, never as
  connection state, because `tools/list` must not vary per connection under
  MCP 2026-07-28. The URL carries it too: `/<workspace>/<app>/...` and
  `/<workspace>/p/<project>/<app>/...`.
- The active project narrows, never grants. Authorization comes from
  membership and the provider's roles; a cross-project mutation is refused
  after the access decision, with a suggestion naming the project the
  resource belongs to.
- Switching project keeps the active app when it supports the new scope and
  returns to the projects section when it does not.

## Documents

In the workspaces people use most, a document is the unit of work: a file in
VS Code, a note in Obsidian, a page in Notion, a file in Figma. Each is an
application in miniature with its own model and editor, and the shell gives
all of them one frame: a New menu, tabs, splits, dirty state, recents,
search, links. Loam treats documents the same way, as shell resources whose
types are contributions.

- **A document type is a contribution.** Any plugin, of any of the three
  kinds, may declare document types: id, title, icon, templates for New, the
  content schema and its version, the editor (a native view or a sandboxed
  `ui://` view), the scopes it supports, and which optional surfaces it uses
  (inspector, panel, embed). A plugin may contribute an app, document types
  or both; Violet, for example, can be an app with "token set" documents.
- **An instance is a shell resource.** Id, type, title, scope (workspace or
  project), owner, timestamps, tags, status; its content is stored through
  the `store` grant under the type's schema. One model per instance, any
  number of editors: the same document can be open in two tabs or a split,
  in the model VS Code's custom editors use.
- **The editor area is the main part.** When a document opens, the main
  part shows the editor area: tabs, splits, pinned and preview tabs, dirty
  indicators, autosave by the type's policy, restored on reload through
  view-state. The document's UI sits inside its editor frame, built from the
  kit; it never touches the rail or the sidebar. A type that declares
  `inspector` gets one that follows its selection model; a type that
  declares `panel` gets bottom views.
- **New is shell-owned.** `document-create` takes a type and a template; the
  New menu aggregates every type the active scope and grants allow, recents
  first.
- **The documents section** is the browser: by type, by project, recent,
  favorites; search through the palette; trash with undo. `project-summary`
  shows a project's documents by type.
- **References are links and commands.** A document names another through a
  resource link; `document-link-add` records it so backlinks exist and
  agents can traverse; the `embed` surface lets a type render a read-only
  preview of another document inside itself, with the reader's access
  re-checked. A type's commands take an instance id, so another document, an
  app or the copilot drives a document the same way, under `calls` grants.
  Documents never import each other's code.
- **Undo and history.** Every edit that goes through a command is journaled
  and undoable; a type may add snapshots. Export and import are type-defined
  behind a generic `document-export` envelope.

The reference document type is `notes`: text with links and embeds, small
enough to read, real enough to use.

## Multiplayer

Shells that get multiplayer right treat it as a service every document
gets, not a feature one document type builds. Figma keeps the latest value
per property per object on the server, with the server defining order, so
edits to different properties both land and only same-property edits
conflict [S75]. Linear syncs a transaction log into a local store so the
client renders first and reconciles later [S76]. Loam's own prior art is
the owner's earlier multiplayer service: it worked well, but it was built
for one document type early and should have been a shareable service for
all of them, and its hardest lessons were about authorization, that live
sessions must be revalidated when membership changes and that a share link
needs a generation so revoking it ends the sessions bound to it [S78].

Loam makes collaboration a shell service with four parts, bound by a
contract every document type and run declares from phase 2, so that no
type is ever built for itself (D46).

- **Sync.** The command journal is the system of record: every change to a
  shared document is a journaled command, so agents and people share one
  path, attribution is free, and the journal replays a session. For content
  people edit concurrently at fine grain, text and canvases, the type binds
  its model to a CRDT, and each CRDT update travels as a command,
  `document-apply-update`, whose payload is the delta: the journal sees
  every change and the CRDT merges them. Structured fields that are not
  CRDT-bound default to per-property last-writer-wins with the server
  ordering. Clients render optimistically and reconcile from results, in
  the pattern the optimistic-mutations guidance already sets for AFD
  clients, which stops short of collaborative conflict resolution and so
  leaves it to the shell [S77].
- **Presence.** An ephemeral channel per document and per run: who is
  here, cursors and selections expressed in the type's selection model so
  the editor and the inspector can show them, typing and running
  indicators. Agents appear in presence with their identity and sponsor
  (D40).
- **Sharing.** Membership comes from the project; a document may be shared
  within the workspace; links admit review from outside membership and
  carry a generation, so revoking a link ends every session bound to it.
  Live sessions revalidate authorization inside the transaction when
  membership changes and rebind when still authorized; a document moved
  across projects rebinds the same way.
- **Threads.** Comments anchored to the type's locators, a section, a node
  or a range, with resolved state, mentions of people and agents, and an
  inbox entry; a run's discussion is the same thread type, in the shape of
  Slack's per-task channels.

What is universal: documents and runs get all four by declaring the
contract; the shell runs the sync endpoint on the hosted server, the
presence channel, the share store and the threads store; the browser and
the desktop connect to them; offline edits queue as commands and merge on
reconnect. What stays per type: the model's CRDT binding, the selection
model, the locator form, and what the resolved action of an agent edit
looks like. The collaboration service has its own specification after
phases 2 and 6; the binding is part of the document record from phase 2.

## Surfaces

An app subscribes to surfaces in its manifest. The shell renders only what
the manifest declares, so nothing is inherited between apps and nothing
appears that was not asked for. The full catalog, with each surface's
contract and ownership rule, is in the
[architecture](architecture.md#surface-catalog). In short:

| Surface | What an app contributes | Who owns it at app switch |
| --- | --- | --- |
| rail | Icon, label, badge, supported scopes, order hint | Shell |
| sidebar | Views: list, tree, custom; a project section when project-scoped | The app; parked on switch |
| header | Title, breadcrumbs, primary actions | The app |
| main | The stage, with routes | The app |
| inspector | Selection-driven properties | The app; cleared on switch |
| panel | Bottom views such as results, logs, a terminal | The app; parked on switch |
| status | Items on the left for workspace and project, on the right for the app and the active item | Left: shell; right: the app, removed on switch |
| documents | Document types with their templates, schema, editor and optional surfaces | Shell |
| new | Creators beyond document types: a title, an icon and a command | Shell, filtered by scope |
| editor | The editor frame for an open document: mount, instance id, selection model, dirty, save and dispose hooks | The document's plugin; tabs stay, the active editor changes |
| embed | A read-only preview of one document inside another | The embedding document |
| palette | Commands exposed to the palette, quick picks | Shell, filtered by the active app and scope |
| settings | Sections with a schema, at user, workspace or project scope | Shell |
| experiments | Flags the app declares, with a lifecycle | Shell |
| notifications | Persistent items in the inbox | Shell |
| overlays | Toasts, dialogs, modals, popovers, prompts through shell commands | The app session; policy on switch |
| agent | AFD contexts, skills, prompts and specialist agents for the copilot | Shell |
| keybindings, menus | Bindings and context-menu entries | Shell; conflicts refused at registration |
| project-summary | A summary of what the app holds in a project | Shell, rendered in the projects section |

Declared surfaces are the whole mechanism by which the shared UX engine
stays opt-in: an app that does not declare `inspector` never gets one, and a
document type added to one app never changes another.

## Overlays

Toasts, dialogs, modals, popovers and prompts are the place where apps leak
into each other. Loam makes every overlay a shell resource with an owner and
a lifetime, opened only through shell commands, so an app cannot render its
own toast region or stack a modal over another app.

| Kind | Default lifetime | On app switch | Where |
| --- | --- | --- | --- |
| toast | transient, timed | dismissed unless `sticky`, which moves it to the inbox | the shell's toast region |
| popover | transient, light-dismiss | closed | anchored to its invoker, top layer |
| dialog | session | parked and restored on return, or cancelled with `cancel-on-leave` | top layer, non-modal |
| modal | session, one at a time shell-wide | cancelled with its result reported to the owner | top layer, rest of the shell inert |
| prompt | session | cancelled | the agent's confirmation and input-required flow |
| global | shell-owned | survives | sign-in expired, update available, offline |

Focus returns to the invoker; modals trap focus; the top layer, `inert`, the
popover attribute and anchor positioning are the platform primitives, with
fallbacks where a browser lacks one.

## Layout engine and shared UX

Layout is data. The engine has a parts model (title bar, rail, sidebar,
main, inspector, panel, status bar), constraints (minimum sizes, collapse
rules, breakpoints) and persisted state per app and scope through the
view-state commands. An app declares a layout preset naming the parts it
uses; the shell decides positions and sizes. No app positions chrome.

The shared UX library is a set of compositions an app opts into by name:
list and detail, split, board, document, dashboard, wizard, console. Each
composition declares the parts it needs and the selection model it exposes
to the inspector, so an app that opts into list-and-detail gets a working
sidebar list, a stage and an inspector that follows the selection, and
nothing else. Compositions are the only path to shared behavior; there is no
inheritance.

Keyboard: a global bindings registry with the shell's reserved chords, an
app's local bindings, conflicts refused at registration, and two-key
sequences for navigation in Linear's pattern.

## Component library

The shell's kit is built on the FAST-AF component set in
`foundations/fast-af` (`@lushly-dev/violet-elements`: buttons, dialogs,
menus, tabs, data grid, toasts, persona and the rest) with Violet tokens
flowing through CSS custom properties. Apps get the whole set, plus the
kit's shell pieces (rail, sidebar, navigation, inspector, status items,
empty states, command list), through the SDK.

An app may bring its own elements. They register under a scoped custom
element registry, so tag names never collide between apps or with the shell,
and each app's root resets inherited styles so that no app's typography or
spacing reaches another. Scoped registries ship in Chromium and Safari but
not Firefox, so the SDK carries a polyfill until the watchlist says
otherwise.

## Design foundation

Violet is the token engine, and the foundation is built before the chrome
grows past a skeleton. Components are built and styled as they are needed,
under a checklist, but the system they draw from and the guidance for
extending it come first, in phase 0 (D26).

- **A semantic layer on Violet.** Loam defines its token set as a Violet
  theme: color roles (surface, text, border, accent, status), a type ramp,
  a spacing scale, radii, elevation, motion durations and easings, density,
  focus and state tokens, in light, dark and high contrast. The kit and
  every app consume semantic tokens only; a component never references a
  primitive. An app may add tokens under its own namespace, resolved
  through the same engine.
- **One component set, many design systems.** The FAST-AF components in
  `@lushly-dev/violet-elements` are the shared set for Loam, Lushly and any
  other consumer. Today they carry local theme registries and no dependency
  on Violet's engine, because Violet was not ready when they were built.
  The foundation changes that once: the components consume Violet themes
  through the Violet runtime, as CSS custom properties with defaults baked
  in so they still render without it, and Loam's theme and Lushly's theme
  become two Violet design systems feeding the same components. Nothing is
  forked. Lushly's move to Violet throughout starts with these shared
  components; its theme and the rest of that transition are specified in
  Lushly's repository (D28). This is a phase 0 deliverable and a
  prerequisite for everything visual.
- **Guidance before components.** A design document in the shape of the
  afd.dev design record: the token layer, the type ramp, color-field and
  density rules, the rhythm of the parts, motion rules, iconography and the
  verification checklist. An authoring skill declared in
  `skills/exports.json` carries the same rules for agents, modeled on the
  site design skill, so a component built by an agent follows the system
  or extends it deliberately.
- **Components as needed, under a checklist.** A kit or app component ships
  when it is used, with: semantic tokens only, verified by a lint; every
  state (hover, focus, active, disabled, invalid, loading); keyboard and
  ARIA; light, dark and high contrast; a Specimen fixture; an axe pass; a
  line in the design document. The checklist is the gate, not a catalog
  built ahead of use.
- **What the first consumer gets.** The Lushly support application runs
  the kit and the shared components under Lushly's own Violet theme, not
  Loam's; Loam's tokens are the shell's default design system, and a
  consumer swaps the theme, never the components.

## Identity: login, account, persona

- **Sign-in** comes from `@lushly-dev/afd-auth`: the adapter contract, the
  middleware that fills the actor, multi-tab session sync, and the Better
  Auth, Convex and Mock adapters. Better Auth is the first production
  adapter because Lushly runs it; its passkey and organization plugins give
  passkeys, organizations, teams, roles and an active organization on the
  session. The shell binds the active organization to the workspace.
- **Account** is a shell section: profile, email, passkeys and sessions,
  organizations and memberships, agent credentials, data export, deletion.
  Apps contribute sections to it the way they do to settings.
- **Persona** is a lens, never a grant. It holds how a person presents
  (name, avatar, pronouns), their defaults (landing app, default scope,
  density, theme) and an emphasis (which rail bands expand, which settings
  surface first). A person may hold several and switch through the account
  menu; the switch is explicit and visible. Authorization stays with the
  provider's roles and the per-command scopes MCP Authorization proposes.
  Enterprise consoles that let a persona hide a section and call it security
  are the counterexample the research records.
- **Actor.** Every command carries AFD's actor. A person is `human`; the
  in-app agent is `agent` acting `onBehalfOf` the person; the persona is
  recorded in the command context's extension, not in the actor.

## Settings, experiments, notifications

- **Settings** are a tree of sections. The shell owns its own; each app
  contributes a section with a JSON Schema and a scope (user, workspace or
  project). Values are read and written through `settings-*` commands,
  searched across apps from the palette, and persisted through the kernel's
  store.
- **Experiments** are flags with a lifecycle: hidden, visible, enabled,
  graduated, removed. Nothing is on by default. A person opts in per
  experiment; a workspace owner may enable one for everyone; an experiment
  shows what may change and when it will graduate or go. Apps declare the
  experiments they own, and an app or a surface may require one, in which
  case the shell hides it until the flag is on. Commands: `experiment-list`,
  `experiment-enable`, `experiment-disable`, `experiment-check`.
- **Notifications** are a persistent inbox, distinct from toasts: items with
  a source app, a resource link, read state and an action. Sticky toasts
  land here.

## Commands between apps

Every app's commands register in the shell's registry under the app's name
as the domain. A command another app may call declares it, and the calling
app declares the grant in its manifest; the kernel enforces both at the
registry. Composition is `afd-batch` and `afd-pipe`. Navigation between apps
is a command, `shell-open`, with a resource link that names the app, the
resource and the scope. Events are the journal: every mutation is a
journaled command, and `shell-events` lets an app read them by cursor and
pattern, in the shape Umbel's event log takes. The callee's new `apps`
exposure flag beside palette, agent, MCP and CLI and the caller's `calls`
grant are both required (D30); the flag is a small AFD feature proposal.

## The copilot

Loam ships a copilot: a chat panel beside the work that drives every app and
document through commands, aware of the active app, document and scope, with
confirmations and approvals from AFD and a session history. It uses no
vendor's copilot SDK.

- **Built on AFD, not on an agent framework.** An agent is an AFD record:
  id, title, instructions, the AFD contexts it may enter, skills, a tools
  filter, a model preference and an owner. The shell ships an orchestrator;
  apps and document types contribute specialists through the `agent`
  surface. A handoff is a journaled command. Sessions, turns and tool calls
  are records in the store and the journal. Because these are AFD data, the
  model SDK underneath only does model calls, streaming and the tool loop,
  and can change without changing an app.
- **Tools are the registry.** In the browser the copilot calls commands
  through the DirectClient against the kernel; on the hosted server, through
  the registry; both under `expose.agent`. A command's `confirmPrompt`
  becomes the runtime's interrupt and the shell's `prompt` overlay; a
  command with an approval policy runs only with a token minted by trusted
  shell code. Mounted servers appear as tools under their mounts, with Umbel
  as the knowledge and memory source.
- **Provider-agnostic.** The first consumer runs Gemini; others will run
  Claude or OpenAI; a deployment may run a local model. The runtime adapter
  swaps providers by configuration.
- **Multi-agent by design, bounded by budget.** The orchestrator may hand a
  turn to a specialist with typed input, a budget and a timeout, in series
  or in parallel, and the specialist's contexts limit what it can call.
  Every hop is visible in the panel and in the journal.
- **Where it runs.** In the browser the runtime runs in a worker, with
  model calls streamed through the hosted server, which holds the keys; on
  the hosted server it runs in the same Node process as MCP and REST; on
  the desktop it runs in the webview's worker, with keys from the hosted
  server or a local configuration. The stream to the panel is AG-UI
  events, so another runtime can attach later.
- **The SDK.** Decided on 2026-10-31 (D27): TanStack AI 1.0,
  released 2026-10-23: 23 provider adapters plus an OpenAI-compatible one; a
  headless client for any framework or none, which a web-component panel
  needs; isomorphic tools that map one definition to a client-side
  DirectClient call and a server-side registry call; subagents with typed
  input, budgets and serial or parallel runs; approvals as interrupts;
  durable sessions; AG-UI as its stream; MCP in both directions; MIT. The
  OpenAI Agents SDK has the cleanest handoff and guardrail primitives and
  MCP support, and its model interface takes other providers through an AI
  SDK extension, but its defaults, tracing and vocabulary are OpenAI's. The
  AI SDK is the most adopted and has agent classes and signed approvals, but
  its gateway framing and Node-only runtime fit less well. TanStack AI's
  risks are real: 1.0 is a week old, its harness is experimental, and web
  components are not documented. A spike of the headless client inside a
  web-component panel is the first task of the phase 5 specification. The
  GitHub Copilot SDK was considered and set
  aside: it drives the Copilot CLI as a separate process over JSON-RPC,
  needs a Copilot subscription or key-only BYOK, keeps the agent loop
  inside that process, and its session handling has been hard to get right
  in the owner's production use. Choosing TanStack also lets Loam reuse
  Lushly's copilot code, which already runs on a TanStack server with
  approval evidence over AFD commands, and extract shared libraries where
  they fit; D19 keeps whatever is extracted generic.

## Three kinds of app

| Kind | What it is | When |
| --- | --- | --- |
| Native app | An ES module with a manifest that renders FAST-AF elements into shell mount points under a scoped registry, through the SDK | The default; the Lushly support application's apps |
| Sandboxed view | An iframe speaking the MCP Apps profile: a `ui://` resource rendered by the shell as host, with data pushed after the view reports ready | Any MCP server with Apps support appears as an app with no Loam code; any Loam view can be served to other MCP hosts |
| Mounted AFD server | An AFD server over MCP or HTTP mounted as an app with no UI of its own; the shell's console renders its commands as forms from input schemas and its results through `@lushly-dev/afd-adapters` | Violet, Health, Specimen and Umbel on day one; the fastest way to put anything with commands in the shell |

The three kinds mirror Umbel's three loader kinds and share its manifest
fields, so a plugin with UI is one manifest with UI contributions added. A
document type is a contribution any of the three can make: a native plugin
ships its editor as a view, a sandboxed one as a `ui://` resource, and a
mounted server's documents open in the console's generic editor.

## Languages: TypeScript first, Rust where it pays

Rust is not chosen for its own sake. Each part gets the language that gives
it an advantage, and the SDK boundary, which hides the kernel from every
app, keeps the choice reversible per part.

| Part | Language | Why |
| --- | --- | --- |
| Chrome, kit, apps, document editors | TypeScript web components | The platform's component set, Violet, and the only language app authors need (D21) |
| Kernel: registry, exposure, grants, bus, scope, documents, settings, experiments, overlays, layout | TypeScript on `@lushly-dev/afd-server` and `@lushly-dev/afd-view-state` | Everything the kernel needs exists in AFD's TypeScript today: the validating registry, middleware, exposure, AFD contexts, the lazy strategy, the journal, confirmations, approvals, view-state. In Rust these are open parity items. One language with the apps and the copilot removes a binding boundary and a second toolchain |
| Stores | TypeScript over store traits: IndexedDB in the browser, SQLite or Postgres hosted, `@lushly-dev/local-db` as the adapter shape | Data access, not computation |
| Identity | TypeScript on `@lushly-dev/afd-auth` | The adapters and Better Auth are TypeScript |
| Copilot runtime | TypeScript on TanStack AI (D27) | Decided |
| Hosted server | One Node process: AFD's `createMcpHandler` for MCP 2026-07-28, REST, the auth layer and the copilot runtime | One process and no cross-language seam; Hono, which the owner's other applications already use: web-standard Request and Response, the MCP SDK's Hono package, Better Auth mounts on it, and TanStack AI's `chat()` returns a Response (D36) |
| Desktop | Tauri 2: its Rust host process with the TypeScript kernel in the webview; native plugins only for menus, files, notifications and updates | Native integration and small installers without writing Rust for logic |
| Measured accelerators | Rust compiled to WebAssembly behind a TypeScript interface | Only by the admission rule in D37, a measured operation on a reference workspace over a budget: the palette and reference index, journal replay and diff, document content indexing, tree-sitter for code documents. The TypeScript implementation ships first |
| Umbel | Rust, by its own decision | Mounted as an app and as the copilot's knowledge; never embedded |

What this gives up, honestly: a single static binary for hosted deployment,
the lower memory floor of a Rust server, and a shared crate family with
Umbel. What it gains: every AFD TypeScript package reused directly, Lushly's
code reused directly, one toolchain for shell, apps and copilot, and no
prerequisite waiting on Rust parity. A Rust-rendered chrome stays reserved,
not chosen.

Hosts:

| Host | Kernel | Chrome | Adds |
| --- | --- | --- | --- |
| Browser | In the page, with a worker for the copilot runtime | FAST-AF in the page | Static deployment |
| Desktop | In Tauri's webview; Tauri's Rust host for native integration | The same chrome | Native menus, files, notifications, offline, updates |
| Hosted | A Node process: MCP and REST, the SPA, the auth layer, the copilot runtime | The same chrome, served | Multi-user workspaces, agents over MCP |

## First-party apps

Each is small enough to read as a tutorial and real enough to use.

| App | Purpose | Kind | When |
| --- | --- | --- | --- |
| hello | One surface each: rail, sidebar, main, a setting, an experiment, a toast; the reference for the contract and the test kit | Native | Phase 1 |
| notes | The reference document type: text with links, backlinks and embeds; one model, many editors | Native document type | Phase 2 |
| console | Any mounted AFD server: commands, schemas, forms, results, the journal | Native, over mounted servers | Phase 5 |
| violet | Token sets, themes and exports over `@lushly-dev/violet-afd` | Mounted, then native views | Phase 5 |
| health | Health reports in the shell: the existing dashboard's reading of report 1.1 files, under a project | Native, from `endpoints/health-dashboard` | Phase 5 |
| specimen | The component bench: list, render, diff | Mounted | Phase 5 |
| umbel | Knowledge, memory and context for the in-app agent and a browser over them | Mounted Umbel | After Umbel's phase 2 |

The projects section, the documents section, the builder, settings,
experiments, account, notifications and the copilot are shell sections, not
apps, because each aggregates across apps.

## Building apps inside Loam

A new app does not need a repository. From New, "App" creates a draft app
in the workspace and the main part opens the builder: the console as the
app's first stage, showing its commands, their schemas, the output of every
call and the journal, and the copilot beside it with the builder agent
loaded, a specialist that carries the SDK skill, the design skill and the
`app-*` commands. The person describes the app; the agent writes its
manifest, its commands and, when the console is not enough, its views, as
TypeScript, HTML and CSS against the SDK; the shell checks, previews and
runs it. When it is good enough it is published to the person and then,
with review, to the team. Loam is the operating system and the development
environment for its own apps (D47).

- **The console is the first UI.** Every app starts with the console as its
  main surface: the command list, forms from input schemas, results
  through the adapters, the journal of calls. Views replace parts of it as
  the builder adds them, and a usage view shows which commands run through
  the palette, the copilot, MCP, other apps or a view, so UI is built where
  it is used (D48).
- **The agent builds with the environment, not a shell.** The builder agent
  has no terminal and no file system. It has `app-create`,
  `app-draft-write`, `app-check`, `app-preview`, `app-publish`,
  `app-version-list`, `app-export` and the store. Everything it does is a
  journaled command, with approvals where the autonomy policy asks, and
  what it writes passes `app check`, the manifest, the surfaces, the
  grants, the design lint and the test kit, before it runs.
- **Drafts run sandboxed.** An app built inside the shell runs as a
  sandboxed view by default, with the kit delivered inside it and tokens
  passed as custom properties, under the grants its manifest declares and
  a content security policy the shell sets. Promotion to the native kind is
  a review step, not a default.
- **Publish is a lifecycle.** Draft, checked, published to self, published
  to the team. Each publish is a version with a changelog the agent drafts;
  publishing to the team needs a workspace owner's approval under the
  autonomy policy; a published app is an artifact in the workspace store,
  installable, versioned and revocable.
- **The repository is optional.** `app-export` writes the app as a package
  the repository workflow takes over, and an app that lives in a repository
  can still be edited in the builder through the same commands. Neither
  path requires the other, and the first consumer can go a long way as a
  service.
- **What builders get by declaration (D49).** Collaborative documents from
  a declared type, with a document type kit that supplies a text editor and
  a form or table editor; triggers from their events and actions from their
  commands, which the automations surface composes; affordance tests in
  the test kit that grade whether a model picks their commands from their
  descriptions, contexts and skills; packaging as workspace artifacts or
  npm packages, validated on install, with no store.

This is why the vision is safe: the agent's capability is bounded by the
registry and the grants, every action is journaled and reviewable, the
code runs in a sandbox until a person promotes it, and nothing leaves the
workspace without a publish.

## Guides and tools for building your own

- An SDK package as the versioned public contract: manifest types, the
  surface catalog, the kit, kernel bindings, the test kit.
- `app new` scaffolding by kind: native, sandboxed view, mounted server,
  document type.
- `app check`: the manifest, the surfaces against the catalog, the grants
  against what the shell allows, the layout preset, and AFD's surface
  validation run against a shell with only the app loaded.
- A test kit that boots a headless shell with only the app under test, runs
  AFD scenarios through the palette, the agent and MCP, drives the layout
  through view-state commands, and replays the journal; Specimen captures the
  chrome.
- Authoring skills for apps, surfaces and compositions, declared in
  `skills/exports.json`; the shell emits skills for installed apps.

## Relationship to other proposals

- [Umbel](../../umbel/README.md): the agent-side host, in Rust by its own
  decision. Loam's manifest extends Umbel's with UI contributions, the
  loader kinds correspond, the event shape is shared as a language-neutral
  contract, and Loam mounts Umbel as the copilot's knowledge and memory. A
  shared schema package is extracted when both exist (D10).
- [View State](../../../docs/features/complete/view-state/view-state.proposal.md):
  the shell's layout commands are these commands; the kernel implements the
  registry in Rust and the TypeScript package stays the contract.
- [Auth Adapter](../../../docs/features/complete/auth-adapter/): sign-in,
  the middleware and the adapters.
- [Contextual Tool Loading](../../../docs/features/complete/contextual-tool-loading/)
  and the [MCP 2026-07-28 upgrade](../../../docs/features/active/mcp-2026-07-28/proposal.md):
  the in-app agent's contexts follow the active app and scope as explicit
  per-request input.
- [Plugin Discovery](../../../docs/features/proposed/plugin-discovery/plugin-discovery.proposal.md):
  the manifest fields; Loam loads declared apps rather than scanning.
- [MCP Authorization](../../../docs/features/proposed/mcp-authorization/mcp-authorization.proposal.md):
  the hosted server's Rust layer, per-command scopes and `credentials`.
- [Agent Engine](../../../docs/features/proposed/agent-engine/proposal.md):
  the copilot is the engine's first host: its agents, handoffs and sessions
  are the engine's records, and its loop runs behind the panel.
- [Chat History Panel](../../../docs/features/proposed/chat-history-panel/):
  the copilot's session history.
- [Skill Knowledge Layer](../../../docs/features/proposed/skill-knowledge-layer/):
  skills the agent surface delivers.
- [Rust Support](../../../docs/features/proposed/rust-support/00-overview.md)
  and [Rust Distribution](../../../docs/features/proposed/rust-distribution/00-overview.md):
  Loam is the UI head those plans imagined, built in this repository in
  TypeScript; it reaches the Rust crate through Umbel and through measured
  WebAssembly modules.
- [Specimens](../../../docs/features/proposed/specimens/specimens.proposal.md):
  the chrome's observation bench and an app.
- Violet, Health and the Health dashboard: first mounted and native apps.

## Decisions

Every decision to date is in the [decision log](decisions.md); nothing is
open on 2026-10-31. What the phase specifications settle is listed in the
[status](STATUS.md).

## First proof

1. The empty shell boots in the browser with no app installed, renders every
   part, signs in through the Mock adapter, and every layout change is a
   journaled view-state command an agent can replay.
2. The hello app loads native, as a sandboxed view, and mounted; a second app
   lands with no shell change; opening a toast and a modal in hello and
   switching to the second app leaves nothing of hello on screen.
3. A workspace with two projects: a project-scoped app shows different
   resources in each, a workspace-only app shows the same, and the projects
   section lists both apps' contributions without knowing what they are.
4. The copilot opens a project, switches apps, changes a setting and
   enables an experiment through commands alone; the same commands run over
   MCP against the hosted server with the scope in `_meta`.
5. Violet and Health appear as apps through the console with no Loam code of
   their own; the same build runs on the desktop through Tauri.
6. The Lushly support application runs on the shell with its own apps and no
   change to Loam.
7. Two `notes` documents open side by side and link to each other; the
   copilot edits one through its commands while the other is unchanged;
   both restore after a reload with their backlinks intact.
8. The copilot answers through one model adapter, is switched to a second
   provider by configuration, and hands a turn to a specialist an app
   contributed, under a budget, with every hop journaled.
9. The chrome references semantic tokens only, in light, dark and high
   contrast, and a component an agent builds from the design skill passes
   the checklist without a human edit.
10. A person with no repository creates an app from New, describes it to
    the copilot, and the builder agent produces a draft that passes
    `app check` and runs sandboxed on the console; after an owner's
    approval it is published to the team and a second person installs it;
    `app-export` produces a package the repository workflow accepts.

## Research and evidence

- [Status](STATUS.md), what is done, what is not, and follow-ups; read it first
- [Architecture](architecture.md), the through line each phase implements against
- [Decision log](decisions.md)
- [Trajectory watch](trajectory.md), the movements anticipated and the dated watchlist
- [Research synthesis](research.md)
- [Annotated source ledger](sources.md)

The research distinguishes documented features from vendor claims and marks
what could not be verified. Neither this proposal nor its merge establishes
implemented capability or a delivery commitment.
