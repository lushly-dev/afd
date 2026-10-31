# Loam: the AI-first shell landscape, gaps and opportunities

**Research date:** October 31, 2026

**Status:** Synthesis of public sources on shells, platforms and operating
systems that put agents first, to find gaps and opportunities Loam should
take, reserve or watch. Not a delivery commitment. Source IDs refer to the
[ledger](sources.md); the opportunities closed as decisions D39 to D46 in
the [decision log](decisions.md) on 2026-10-31.

## Executive conclusion

Four things happened in the last twelve months that change what a shell
is for. Operating systems and browsers became agent hosts that expect
applications to declare typed actions, which is AFD's thesis landing in
Windows, Android, iOS and Chrome. Chat products became shells that host
apps as sandboxed views and plugins as files, while coding tools became
managers of many parallel agent runs. Agents became workspace members with
identities, sponsors and delegated work, in Linear, Slack and Microsoft's
identity stack. And the trust problem moved from the model to the
interface: OWASP now names human-agent trust exploitation, and practitioners
measure approval fatigue as a control failure.

Nobody has combined them. Chat platforms host apps but not people's work;
operating systems expose app actions but offer no shell for a team;
coding tools manage agents but only for code; work tools admit agents as
members but each with its own semantics. The gap Loam sits in is a shell
where people, apps, documents and agents share one command registry, and
where agent membership, autonomy policy and agent-rendered UI are
shell-level primitives rather than each app's invention.

## 1. The landscape in six fronts

### Chat products that became shells

| Product | What it is now | Evidence |
| --- | --- | --- |
| ChatGPT apps | Apps built on MCP render inside the conversation as sandboxed views; the Apps SDK implements the same iframe-and-bridge model the MCP Apps extension defines, so a view built for one runs in the other; monetization of digital goods is still refused and commerce runs through an approved-partner checkout | S55, S16 |
| Claude Cowork | Claude's desktop agent for file work, general availability April 2026; plugins are directories of markdown and JSON that bundle skills, slash commands, MCP connectors in `.mcp.json` and sub-agents, Apache-2.0, loaded by Cowork and Claude Code alike; eleven role plugins published | S56 |
| Codex app | A desktop app whose purpose is managing several coding agents in parallel in git worktrees, with scheduled automations and enterprise plugins; merged into the ChatGPT desktop app in July 2026 | S57 |
| ChatGPT Atlas | OpenAI's browser with an agent mode, launched 2025-10-21 and shut down 2026-08-09 after the merger into the desktop app; a memory-injection vulnerability was reported in its first weeks | S58 |
| Notion custom agents | Autonomous background agents on Business and Enterprise plans since 2026-02-24, with MCP integrations, admin control over who creates them, every run logged and reversible, and credit-based pricing | S59 |

### Operating systems and browsers as agent hosts

| Platform | Mechanism | Evidence |
| --- | --- | --- |
| Windows | An on-device registry of agent connectors, which are MCP servers, behind an MCP proxy that authenticates, authorizes and audits; agents run under separate standard accounts in contained sessions; File Explorer and Settings ship as connectors; public preview | S61 |
| Android | AppFunctions on Android 16: apps annotate functions, the OS indexes the generated schema, agents call them under an `EXECUTE_APP_FUNCTIONS` permission; Google describes apps as on-device MCP servers; experimental, Gemini in private preview as of May 2026 | S62 |
| Apple | App Intents connect apps to Siri's app actions, onscreen awareness and personal context; the Foundation Models framework runs on-device and server models with custom skills; Xcode plugins speak MCP and the Agent Client Protocol; announced 2026-06-08 | S63 |
| Chrome | WebMCP lets a page register tools for the browser's agent through `document.modelContext.registerTool`, in an origin trial from Chrome 149 with the entry point moved from `navigator` in 150; Gemini in Chrome browses on the person's behalf since January 2026 | S64, S65 |
| Chrome, on-device | The Prompt API runs Gemini Nano in extensions and is still being developed for pages; it needs about 22 GB of disk and a 4 GB GPU; Mozilla objects to the API and Safari has no plan | S66 |

The pattern is one: applications declare typed, discoverable actions; the
platform's agent composes them; the agent carries an identity of its own;
permission is mediated by the platform, not the app. Microsoft's identity
stack makes the same move at the directory level, with agent identities
that have human sponsors and are governed like users [S60].

### Work tools where agents are members

| Product | Model | Evidence |
| --- | --- | --- |
| Linear | Admins install agents and choose their teams; agents are not billable seats; issues are delegated to agents and stay visible in My Issues; agents can comment, be mentioned and collaborate on documents but cannot sign in or administer; workspace and team guidance for agents; name conflicts resolved by the system | S67 |
| Slack Code | Mentioning an agent opens a temporary code channel for the task with tabs for discussion, plan, diffs and a live preview; anyone in the channel can pause, redirect or stop the agent; human sign-off before production; archived when done; API generally available; launched 2026-08-24 | S68 |
| GitHub Copilot in Linear | Assigning an issue to Copilot runs it in an ephemeral environment and streams progress to the issue; billed by GitHub, not Linear; generally available July 2026 | S67 |

### Coding tools as agent managers

Cursor rebuilt around an Agents Window in April 2026 with parallel agents
across worktrees, cloud machines and SSH hosts; Google split Antigravity's
Agent Manager into a standalone desktop app in May 2026; Zed shipped
parallel agents with a threads sidebar and external agents over the Agent
Client Protocol in April 2026; Devin Desktop has an agent command center
[S69]. The common surface is a list of runs, each isolated in a worktree or
sandbox, with plan, diff and preview views, scheduled runs, and the editor
demoted to one view among several.

### Agent-rendered interfaces

Three specifications now coexist, and a runtime layer joins them. MCP Apps
renders HTML in sandboxed iframes [S16]. Google's A2UI v0.9 of 2026-04-17
declares UI as validated JSON against the client's own component catalog,
streams and repairs partial output, ships renderers for Flutter, Lit,
Angular and React, runs over MCP, WebSockets, REST, AG-UI or A2A, and lists
MCP Apps integration on its roadmap [S70]. OpenAI's Apps SDK is the
iframe model with an open JSON schema beside it [S55, S70]. AG-UI is the
interaction protocol underneath, not a UI specification [S46, S70].

### The interface of trust

OWASP's Top 10 for Agentic Applications 2026 names ASI09, human-agent
trust exploitation, where confident explanations steer a person into
approving a harmful action, and its 2026 incident roundups tag real cases
under it [S71]. Practitioners describe approval fatigue as a control that
decays into a rubber stamp and propose measuring approval volume, override
rates and auto-approve usage per workflow; the recurring patterns are
autonomy levels (suggest, ask, act), approval of a plan or a capability
within limits rather than each command, showing the resolved action,
visible failures, audit and undo, and the distinction between in the loop,
on the loop and reviewed later [S72]. Prompt injection in agentic browsers
is described by OpenAI and the UK's NCSC as unlikely ever to be fully
solved, and a July 2026 study reportedly found four of seven agentic
browsers could be made to bypass the same-origin policy [S65].

Two external arguments confirm the AFD position: Builder.io's agent-native
architecture puts one action layer under UI, agents, HTTP, MCP and CLI,
with the UI as one surface among several; and CLI-Anything, from June
2026, argues that agents should drive structured commands with explicit
state and deterministic feedback rather than visual layouts [S73].

## 2. Gaps and opportunities

Each row says what Loam would do, the disposition proposed and the decision
it needs. Dispositions: adopt means a phase deliverable; reserve means a
record or seam now and the feature later; watch means a watchlist row only.

| ID | Gap or opportunity | What Loam would do | Disposition | Decision |
| --- | --- | --- | --- | --- |
| OP1 | Operating systems and browsers now want applications to declare actions, and Loam's registry already is one | Project the registry outward: register commands exposed to MCP as WebMCP tools in the browser behind feature detection; package the hosted server as an MCP bundle for the Windows registry when the desktop lands; map to AppFunctions and App Intents when Tauri mobile does. Each is a projection of `expose`, not new commands | Adopt WebMCP in phase 5; reserve the OS registries | D39 |
| OP2 | Agents are becoming workspace members with identities, sponsors and delegated work, with different semantics in every product | Agent members as a shell primitive: an agent identity with a human sponsor, installed by an owner, scoped to projects, not a seat, visible on delegated work with the person still accountable, unable to sign in or administer, with workspace and project guidance; AFD's actor with `onBehalfOf` is the wire form | Adopt: identities in phase 3, delegation in phase 5 | D40 |
| OP3 | Approval decays into theater and nobody measures it; OWASP names the exploit | Autonomy policy as shell settings per workspace, project, app and command: suggest, ask or act; approval of a plan or a capability within limits; the resolved action always shown; approval volume, override and auto-approve rates reported as a control-health signal; tool results and mounted content treated as untrusted in the copilot | Adopt in phase 5, policy in settings from phase 4 | D41 |
| OP4 | The unit of agent work became the run: isolated, parallel, scheduled, shareable, with plan, diff and preview | Runs as shell resources: a copilot session becomes a run with a scope, an isolation (sandbox or worktree for code), a plan, artifacts and a status; a runs list; scheduled automations; pause, redirect and stop by anyone with access; a run shareable in a project in the shape of a temporary channel | Records in phase 5; the section when the first consumer needs it | D42 |
| OP5 | Three agent-UI specifications; Loam has one path, the iframe | A2UI as the second path, with the kit as its component catalog and the Lit renderer as the starting point; agent-declared UI renders native components under the design foundation, safer than an iframe and themeable by Violet | Adopt after MCP Apps, phase 5 or later | D43 |
| OP6 | Plugin formats fragment while skills converge; eleven open role plugins already exist | The copilot's agent surface loads Agent Skills directories and Claude-plugin-shaped packs: skills, `.mcp.json` connectors as mounted servers, commands as palette entries, sub-agents as specialists; a Loam app may be only such a pack | Adopt in phase 5 | D44 |
| OP7 | On-device models exist in Chrome and Apple's frameworks for cheap tasks, with heavy requirements and no cross-browser story | An on-device provider in the runtime adapter when `availability()` reports a model, for suggestions, summaries and classification, never for a consequential action; cloud fallback always | Watch; a provider when the adapter is stable | D45 |
| OP8 | Multiple people and agents editing one document needs conflict-free writes, and the owner's earlier multiplayer was built for one document type when it should have served all | Collaboration as a shell service, sync, presence, sharing and threads, bound by a contract every document type and run declares; the journal as record, CRDT updates as commands, link generations, authorization epochs | Adopt as a shell service with its own specification after phases 2 and 6 | D46 |
| OP9 | Chat platforms treat apps as sandboxed views with no shell around them | Nothing new: Loam's sandboxed view already hosts those apps and can export its own; the gap is Loam's position, recorded in the proposal | Already in the design | None |
| OP10 | External agents should find a shell's commands without a person | A server card, a well-known catalog entry and a plain guide for agents, generated from the registry, as Umbel plans | Adopt in phase 6 with distribution | None; follows Umbel |
| OP12 | Apps built by chat exist outside any shell: prototypes from prompts, role plugins as files, agents assigned work; nobody lets a team build, check, run and publish an app inside the environment the app will live in, with the agent bounded by that environment | The builder: from New, an app drafted by the copilot through `app-*` commands only, run sandboxed on the console, checked, published to the person and then the team with approval, exported to a repository only if wanted | Adopt as phase 7 | D47, D48, D49 |
| OP11 | Agent usage is being metered and priced per run or credit | Usage events per run in the journal, as Umbel defines them, surfaced in account and settings; no pricing | Reserve | None |

## 3. What this changes in the design

- **Identity gains a second kind of member.** The account record and the
  membership model in phase 3 take agent members with sponsors; the actor
  on every command already carries `onBehalfOf`.
- **Settings gain an autonomy section** with inheritance from workspace to
  project to app to command, and the copilot's interrupts read it.
- **The copilot's sessions become runs** with isolation and artifacts; the
  agent surface accepts skills and packs; a second renderer sits beside the
  sandboxed view.
- **The registry projects outward** through WebMCP first, through platform
  registries later, with no new commands.
- **Multiplayer becomes a shell service** for every document type and run,
  with the binding on the document record from phase 2 (D46).
- **The shell becomes the development environment** for its own apps, with
  drafts as artifacts, the console as the first stage and a publish
  lifecycle (D47 to D49).
- **The trajectory watch** gains the rows in section 5.

Nothing above adds a language, a host or a dependency the architecture
does not already name, except A2UI's Lit renderer and a CRDT library behind
the document store trait (D46).

## 4. Deliberately not chased

A browser of Loam's own; computer-use automation of other applications;
a plugin marketplace with billing; a model gateway; chasing the Prompt API
before it is stable on pages; building Loam's views on the ChatGPT Apps SDK
rather than the MCP Apps profile it implements; agent accounts at the
operating-system level before Windows' preview settles; and any feature
whose only evidence is a vendor's launch post.

## 5. Watchlist additions

Rows W20 to W27 in the [trajectory watch](trajectory.md) track WebMCP's
default-on milestone, the Windows registry's general availability,
AppFunctions and App Intents maturity, A2UI's 1.0 and MCP Apps integration,
the Prompt API on pages, Slack Code's non-engineering channels, Linear's
agent guidance API, and OWASP's next agentic release.

## Sources

Rows S55 to S74 of the [ledger](sources.md), retrieved on 2026-10-31, with
inference limits per row. Where a claim rests on secondary blogs, the row
says so; the Atlas shutdown date, the Chrome 157 default-on claim for
WebMCP, the 93 percent approval figure and the same-origin study are each
marked unverified or secondary.
