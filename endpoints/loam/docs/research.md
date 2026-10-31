# Loam: research synthesis

**Research date:** October 30, 2026

**Status:** Synthesis of public sources to inform the [proposal](proposal.md).
Not an implementation or a delivery commitment. Source IDs refer to the
[ledger](sources.md). This domain has little published measurement; where a
row reports a number it says whose it is.

## Executive conclusion

Five findings shape the proposal. The layouts people keep choosing share one
shape, a stable global band beside a contextual band, and one discipline,
keyboard and palette first with a personal, collapsible sidebar. Plugin
shells have converged on declared contributions plus versioned runtime
extension points, and the ones that leave cleanup to plugins regret it. The
web platform now ships the primitives shells used to fake: the top layer,
anchor positioning, scoped custom element registries, the Navigation API and
view transitions, so isolation and overlays can be built on the platform
with fallbacks rather than a framework. Client-side Rust is production-grade
for a kernel but not a reason to abandon the platform's component set. And
identity, experiments and persona have settled conventions: organizations
and passkeys from the provider, experiments off by default with a lifecycle,
and persona as a lens that never grants.

## 1. Application layouts people love

### Converged practice

- **A stable band and a contextual band.** Linear puts Inbox and My Issues
  above its teams, each team opening to a home with Triage, Issues, Cycles,
  Projects and Views [S05]. Things fixes Inbox, Today, Upcoming, Anytime and
  Someday at the top and lists Areas with their Projects below; the fixed
  lists cannot be renamed, removed or reordered [S07]. Notion stacks
  Favorites, then Teamspaces, then Private [S08]. Arc pins tabs above the
  space name to make them global and below it to scope them to the space
  [S10]. Slack reorganized its left column into Home, DMs and Activity tabs
  with a workspace switcher and custom sections [S09].
- **Personal sidebars.** Linear's December 2024 sidebar can be reordered and
  customized per person, and its January 2026 mobile update lets a person
  pin projects and initiatives into the main navigation [S06]. Notion's
  sections reorder and collapse, and visibility follows sharing [S08].
  Slack's sections collapse with their own sort and view preferences [S09].
- **Keyboard and palette first.** Linear gives most destinations a two-key
  sequence such as G then I [S05]. Raycast's extension model unifies every
  tool as a command with one structure [S13]. VS Code's command palette lists
  every contributed command and quick picks capture input [S01].
- **The chrome gets out of the way.** Figma's UI3 replaced hiding one panel
  with minimizing both, and the right panel reappears on selection, which
  people still argue about in 2026 [S11]. Things hides a project from the
  sidebar while it is dormant [S07].
- **Status bar semantics.** In VS Code, left-side status items apply to the
  whole workspace and right-side items to the active file [S01].
- **The inspector follows the selection.** Figma's properties panel changes
  with what is selected [S11]; VS Code's secondary sidebar hosts views a
  person drags there [S01].

### Measured findings

| Finding | Result | Source |
| --- | --- | --- |
| Usage and admiration of the shell most developers live in | VS Code 70.9% usage among 30,903 respondents; 55.7% admired; 40.6% desired, the highest | S04 |
| Figma's independent panel toggle | Requested since July 2024, still open in March 2026 | S11 |

### Design implications

Two rail bands with a visible divider, the project switcher heading the
contextual band; fixed shell sections above app entries; a sidebar that is
personal and collapsible; two-key navigation and a palette over every
command; status items split left for scope and right for the active app; an
inspector that follows a declared selection model; every part optional and
collapsible by rule.

## 2. Plugin shells

### Converged practice

- **Declared contributions.** VS Code reads a `contributes` block at startup
  for commands, menus, views, view containers, configuration, keybindings,
  walkthroughs and now chat agents, prompt files and agent skills;
  `when` clauses govern visibility and `enablement` governs commands [S02].
  View containers land only in the activity bar or the panel; views attach
  to built-in or custom containers [S02, S03].
- **Runtime extension points with versioned ids.** Grafana's app plugins
  register links, components and functions against extension points such as
  `grafana/dashboard/panel/menu/v1`; plugins must prefix their own extension
  point ids; the February 2026 release removed every deprecated extension
  API [S14]. Backstage's new frontend system builds apps from blueprints and
  discovers plugin extensions at app creation [S15].
- **Cleanup is the plugin's problem where the shell does not own it.**
  Obsidian's workspace is a tree of splits and leaves; leaves a plugin adds
  persist after the plugin is disabled unless the plugin removes them, and
  there is no public API to list or reorder ribbon buttons, so community
  plugins read private objects [S12].
- **Status bar items are created in code, not declared**, in VS Code and
  Obsidian [S02, S12].
- **Agents get UI through the host.** MCP Apps, stable as 2026-01-26, serves
  `ui://` resources that the host renders in a sandboxed iframe, withholds
  data until the view reports ready, pushes tool input and results, and lets
  the view call tools through the host; ChatGPT, Claude, VS Code, Goose and
  Postman are listed as hosts, with support varying [S16].
- **Runtime loading decoupled from the bundler.** Module Federation 2.0
  reached a stable release in April 2026 with the runtime separated from the
  build tool and runtime plugins; single-spa, import maps and Piral remain
  the lighter alternatives [S17].

### Design implications

A surface catalog the manifest is validated against, so an unknown surface
is refused with a suggestion; every surface owned and cleaned by the shell
on app switch, never left to the app; status items declared with a priority
and removed on switch; `when`-style conditions on keybindings and menus;
MCP Apps as one app kind so the shell is a host and a view can be exported;
native apps as ES modules under a manifest, with import maps and no bundler
coupling.

## 3. Isolation and overlays

### Converged practice

- **Shadow DOM stops selectors, not inheritance.** Global styles cannot reach
  into a shadow root and custom properties pass through, but inherited
  properties leak across app roots; `all: initial` on the root is the
  practical reset; cascade layers and `@scope` control precedence inside one
  app but are not a boundary [S23].
- **Scoped custom element registries ship.** Chrome and Edge 146 and Safari
  26 support them, Firefox does not; a registry attaches to a shadow root, a
  document or an element, and declarative shadow DOM takes a
  `shadowrootcustomelementregistry` attribute [S18].
- **The top layer replaces z-index management.** Popovers and dialogs render
  above the document regardless of DOM position; `popover="auto"` gives
  light dismiss; a modal dialog makes the rest of the page inert; anchor
  positioning tethers top-layer elements to invokers; timed dismissal of a
  toast still needs script [S19, S20].
- **Routing moved into the platform.** The Navigation API became Baseline
  Newly Available on 2026-01-13 with Safari 26.2 and Firefox 147, Safari
  lacking the precommit handler; same-document view transitions are in every
  engine since Firefox 144, cross-document ones are not in Firefox
  [S21, S22].
- **Boundary choice.** Shadow DOM keeps one JavaScript context; iframes give
  hard isolation at the cost of communication and performance [S23].

### Design implications

Native apps render under a scoped registry with a root reset and tokens as
custom properties; sandboxed views are iframes; overlays use `<dialog>`, the
popover attribute, `inert` and anchor positioning with fallbacks; one modal
at a time because the top layer has one; routing on the Navigation API with
URLPattern; polyfills for scoped registries and anchor positioning retired
by the watchlist.

## 4. Client runtimes

### Converged practice

- **Tauri 2** went stable on 2024-10-02 with desktop and mobile from one
  codebase, native plugins in Swift and Kotlin, and point releases through
  2.10 in 2026; reviewers call mobile younger than desktop and the plugin
  ecosystem smaller than Electron's [S24].
- **Rust frontends are production-ready and moving fast.** Dioxus 0.7 added
  runtime hot-patching, a native renderer and an Axum full-stack layer, and
  0.8 is in alpha [S25]; Leptos is at 0.8.22 with a 0.9 release candidate
  [S26]. Neither addresses custom elements or web components in the sources
  found, and both compile to WebAssembly with wasm-bindgen interop [S28].
- **Rust in a Tauri frontend** needs `withGlobalTauri` and hand-written or
  community bindings to `invoke`; the usual crate type is `cdylib` plus
  `rlib` so one crate serves WebAssembly and native [S29].
- **Components run in browsers by transpilation, not natively.** WASI 0.3 was
  ratified on 2026-06-11 with async in the component model; jco transpiles
  any component into core WebAssembly plus JavaScript glue for browsers; the
  component model cannot reach 1.0 without native browser implementations
  [S27].

### Design implications

A TypeScript kernel in every host, with Rust only as WebAssembly
accelerators behind TypeScript interfaces when a measurement shows the need
(decision D25); Tauri's Rust host for native desktop integration; the
chrome on the platform's component set rather than a Rust renderer;
WebAssembly components as an app kind reserved until browsers run them
natively or the watchlist says transpilation is enough.

## 5. Identity, settings, experiments, persona

### Converged practice

- **Organizations and passkeys come from the provider.** Better Auth's
  organization plugin provides organizations, members, invitations, three
  default roles with custom access control, optional teams, and an active
  organization on the session; its passkey plugin provides WebAuthn sign-in
  with autofill and passkey-first onboarding [S30, S31]. Secondary sources
  report v1.4 adding stateless sessions and warn that with a cookie cache a
  revoked session stays valid elsewhere until the cache expires [S32].
- **Experiments are opt-in with a lifecycle.** Home Assistant's Labs holds
  features that are tested and functional but whose design may change and
  which may be removed, under Settings, System, Labs [S34]. CloudZero puts
  Labs in the avatar menu with per-person toggles, an org-wide admin toggle
  and nothing on by default; HighLevel separates visibility from enablement;
  PatternFly frames experimental features as a notice with an opt-in
  agreement and warns against using the pattern as a permission model [S34].
- **Persona is a lens, not a permission.** Zof's console says persona lenses
  change emphasis and grant no access; Morpheus caps persona access by role
  and hides the switcher when only one is allowed; Vodori lists other
  personas in the account menu with a default on sign-in; Collate limits
  sidebar items per persona and resolves a person's default over the
  organization's; Pega groups people with similar needs [S33].

### Design implications

Sign-in and organizations through the auth adapter with Better Auth first;
the workspace bound to the active organization; session revocation visible
across tabs through the adapter's sync and a known cache caveat; experiments
with states, audiences, a shown graduation date and a removal path; persona
as presentation, defaults and emphasis selected from the account menu, with
authorization untouched, and the counterexample recorded where a persona
hides a section and is treated as security.

## 6. Documents in shells

### Converged practice

- **One model, many editors.** VS Code's custom editors keep a single
  document model per resource and allow multiple editor instances of it;
  the provider opens the document once and resolves each editor separately;
  custom documents own edit, save and backup and must fire change events
  [S47]. Obsidian's leaves are views over the same files in a workspace tree
  [S12].
- **The shell owns the frame.** Tabs, splits, dirty state, recents and the
  New command belong to the workbench in VS Code; the `customEditors`
  contribution only says which resources an editor handles [S02, S47].
  Figma and Notion give every document the same chrome around a different
  model [S08, S11].
- **Cleanup is the shell's or it does not happen.** Obsidian leaves persist
  after a plugin is disabled unless the plugin removes them [S12].

### Design implications

Document types as contributions with a schema, templates, an editor kind
and instance commands; one record per instance in the shell's store, one
model, any number of editors; the editor area as the main part with tabs
and splits the shell owns; New, recents, search, trash and references as
shell sections and commands; references as recorded resource links with
backlinks, and embeds with access re-checked; a document's UI contained in
its editor frame and built from the kit.

## 7. Agent runtimes for the copilot

### Converged practice

- **The runtime is TypeScript, and the market settled on three shapes.**
  Model-and-tool-loop libraries (TanStack AI, the AI SDK), agent frameworks
  with their own vocabulary (the OpenAI Agents SDK, Mastra, LangGraph.js,
  Google ADK for TypeScript), and vendor harnesses that drive a separate
  agent process (the GitHub Copilot SDK over the Copilot CLI, the Claude
  Agent SDK over the Claude Code harness) [S43, S44, S45, S48, S49, S50,
  S51].
- **Provider-agnostic is table stakes for the first two shapes.** TanStack
  AI 1.0 ships 23 adapters plus an OpenAI-compatible one; the AI SDK about
  38 plus a gateway; the OpenAI Agents SDK takes other providers through an
  AI SDK extension; Mastra routes through the AI SDK [S43, S44, S45, S50].
  The harnesses are not: the Copilot SDK needs a Copilot subscription or
  key-only BYOK for OpenAI, Microsoft Foundry, Anthropic and Ollama, and
  the Claude Agent SDK runs Claude only, directly or through Bedrock,
  Vertex and Foundry [S48, S49].
- **Approvals became interrupts and sessions became durable.** TanStack AI
  treats tool approvals as interrupts that survive restarts; the AI SDK
  signs approvals; the Copilot SDK routes tool calls through a permission
  handler [S43, S44, S48].
- **AG-UI is the stream.** TanStack AI emits AG-UI events natively, and a
  dozen frameworks integrate with it [S43, S46].
- **Headless matters for web components.** TanStack AI's `@tanstack/ai-client`
  is framework-agnostic and the vanilla client is listed; the AI SDK's UI
  layer is framework hooks [S43, S44].
- **Process-model harnesses are hard to keep bug-free in a shell.** The
  Copilot SDK manages a CLI process and speaks JSON-RPC to it, so session
  state lives in a process the shell does not own; the owner reports that
  its session handling has been hard to get right in production use [S48,
  S53].

### Measured findings

| Finding | Result | Source |
| --- | --- | --- |
| Adoption of the two loop libraries | AI SDK cites 16 million weekly downloads at 7.0; TanStack AI won AI Project of the Year at the 2026 Open Source Awards | S44 |
| Release recency | TanStack AI 1.0 on 2026-10-23; AI SDK 7.0 on 2026-06-25; `@mastra/core` 1.78.0 on 2026-10-15; `@openai/agents` 0.20.0 on 2026-10-08 | S43, S44, S45, S50 |

### Design implications

A runtime adapter so the SDK is replaceable; agents, handoffs and sessions
as AFD records above it; TanStack AI first for its headless client, its
isomorphic tools that map to DirectClient and hosted calls, its subagents
with budgets, its AG-UI stream and the fit with Lushly's existing TanStack
server [S53]; the AI SDK as the fallback; no vendor harness, because the
copilot's loop must be the shell's.

## 8. Design foundations before interface

### Converged practice

- **Tokens first, components as needed.** The afd.dev design record defines
  a semantic token layer, a type ramp, color-field placement rules, section
  anatomy, motion rules and a verification checklist, and the site skill
  carries the same rules for agents, so a section built by an agent follows
  the system [S54]. Violet's engine stores, resolves and exports tokens
  with inheritance, and its runtime loads and switches themes in the
  browser [S40].
- **The component set has its own theme layer, for historical reasons.**
  `@lushly-dev/violet-elements` ships local theme registries and no
  dependency on Violet's engine because Violet was not ready when the
  components were built [S39]; the owner's intent is one component set fed
  by Violet themes, with Lushly's own move to Violet starting there.
- **Shells publish guidelines before APIs.** VS Code's UX guidelines
  describe each container and what belongs in it before an extension author
  reaches the API [S01].

### Design implications

A semantic layer on Violet in light, dark and high contrast; a bridge onto
the component set's registries built once in phase 0; a design document and
an authoring skill before the kit grows; components built when used, under
a checklist with a token-only lint, every state, keyboard and ARIA, a
Specimen fixture and an axe pass.

## 9. Multiplayer as a service

### Converged practice

- **Property-level merge with server order.** Figma's servers keep the
  latest value any client sent for each property of each object; edits to
  different properties both land, same-property edits resolve to the last
  received, and the server's order replaces timestamps [S75]. Linear's
  engine syncs a transaction log into a local store so the client renders
  first and reconciles later [S76].
- **CRDTs for fine-grained text and structure.** Yjs is the most deployed
  library; Automerge has a Rust core with WebAssembly bindings; Postgres
  sync engines cover the structured side [S74].
- **AFD's client guidance stops at the shell's door.** The
  optimistic-mutations skill covers instant feedback and reconciliation
  from command results and excludes collaborative conflict resolution, so
  the shell must own it [S77].
- **The owner's lesson.** An earlier multiplayer service worked well but was
  built for one document type and should have been a shareable service for
  all; its hard problems were authorization epochs on live sessions and
  share-link generations, not merge [S78].

### Design implications

Collaboration as one shell service bound by a per-type contract from the
first document record; the journal as the system of record with CRDT
updates carried as commands; per-property last-writer-wins for unbound
fields; presence in the type's selection model; links with generations and
sessions revalidated on membership change; agents as attributed
collaborators; threads on locators; a multi-client scenario in the test kit
that replays a journal into two clients and compares the models.

## 10. Scale and cost

Nothing in this domain publishes shell-level measurements worth a table.
The relevant figures are AFD's own: deferred tool loading cut context tokens
and raised accuracy in the evaluation Umbel's ledger records, which is why
the copilot scopes contexts to the active app and document, the shell's
bundle must fit a budget the phase 0 specification sets, and any
WebAssembly accelerator must earn its bytes by a measurement on a real
workspace before the chrome depends on it.
