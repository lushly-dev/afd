# A person narrows their connected agent's access

- Date: 2026-11-28
- Area: phase 3, identity
- Pull request: [#3059](https://github.com/lushly-dev/afd/pull/3059), on `lush/loam-connected-agent-access`, for [#2784](https://github.com/lushly-dev/afd/issues/2784)

The approach the owner approved on #2784, with the account tab in the same pull request. The job
came first: `phases/3-identity/scenarios/narrow-connected-agent.scenario.yaml`, checked with
`afd scenario validate`. It is not tagged `loam-runner`, since no seed holds a hosted provider with
a connected agent; P3-E8 (`identity/src/mcp-identity.test.ts`) runs its steps.

- **The command.** `account-agent-update { agent, access }` sits in the kernel's `late-identity`
  chunk, beside `-list` and `-disconnect`. It is a human command (`HUMAN_COMMANDS`), recorded
  (`MEMBER_PROVIDER_COMMANDS`) and undoable through the previous `access`. It is not served over
  MCP and is not on the copilot's surface, since both leave the human commands out.
  It refuses as follows:
  - Any id but the person's own gets the disconnect's `AGENT_MEMBER_NOT_FOUND`.
  - A record an owner removed gets `AGENT_DISCONNECTED_BY_OWNER`.
  - A project the person may not enter gets phase 2's `PROJECT_NOT_FOUND`, byte for byte as a
    missing one. Projects are resolved by id or slug through the scope's own decision for the person.
  - A provider refusal after a race answers as the kernel's own.

  `account-agent-list`'s rows carry `access`.
- **The provider.** `POST /loam/connected-agents/update` in `loamServerPlugin` takes only the
  sponsor's own record (`AGENT_MEMBER_SPONSOR_ONLY` otherwise) and refuses one an owner removed. It
  checks the shape (`VALIDATION_ERROR`) and writes `access`, `updatedAt` and `updatedBy`. It revokes
  no token, so the next request reads the new record.
- **The tab.** The agents tab gains a "Can act in" column and "Change access for <app>". The button
  opens a native modal dialog (`chrome/src/identity/agent-access.ts`) with these choices:
  - "Every project you can open", or "Only these projects" with a checkbox for each project the
    person may open.
  - "Workspace-wide work too", the record's `workspace` flag.
- **The review's fixes.** GPT-6.2 Astra (high) found five blockers and Claude Opus 5.5 (high) none.
  All are fixed:
  - **Roster leak.** `/loam/connected-agents` named another person's agent's project ids to every
    member. It now answers `projects: []` and `withheldProjects` to anyone but the sponsor, and
    `agent-member-list` counts those as hidden.
  - **Conditional write.** The endpoint writes only the record as it read it, so an owner's removal
    in between stands.
  - **Stale undo.** The command takes `expected`, the access the caller last saw, which the dialog
    and the undo give, and refuses a record that is no longer that (`AGENT_ACCESS_CHANGED`). An undo
    of a change already replaced therefore never widens it. The kernel also sends what it read as
    `previous`, and the provider refuses a record changed between that read and its write (409).
    The re-check found that the first fix sent only `previous`, which caught no stale undo.
  - **Membership.** The endpoint serves only a member.
  - **Archived projects.** The tab reads `project-list { status: 'all' }`, and it offers no Change
    access when that read fails.

  Also from the review:
  - A refused save (`AGENT_ACCESS_CHANGED`) reads the tab again and says so.
  - Focus returns to the row's button after a save.
  - The labels say what `workspace` and `projects: 'sponsor'` mean.
  - The Chromium case runs alone.
  - Re-approval goes through the consent page.
- **A gap this found.** The web host's `DeferredAuthAdapter` forwarded only `get`, `update`,
  `members` and `invitations` of the account capability. In a browser, therefore, the agents tab
  listed no connected agent, and Disconnect and an owner's removal answered as if there were no
  provider. The forwarded list is now typed against `LoamAccountAccessV1`, so a method added there
  fails the build until it is forwarded.

Verified on 2026-11-28 on Windows with Node 26.13.1, before the review's fixes and again after
them, with the figures below from after:

- The kernel's units: the whole suite, 1,873 tests, before the fixes; after them, 195 tests in
  `identity/` and `stores.test.ts`, among them four cases of #2784 in `agent-members.test.ts`.
  `stores.test.ts`'s deployer-key exemption for `access.projects` now covers the third command
  that takes that path.
- The identity units, 166 tests. P3-E8's two new cases cover narrowing in the person's own
  browser-shaped kernel against the real provider, the agent's MCP call refused in Citadel and
  allowed again once widened on the same token, and the endpoint's refusals.
- The Chromium consent suite, 11 tests, with the tab's case and axe; the case also passes alone.
- `pnpm -F @lushly-dev/loam-web budget`. Under D115 it raises three lazy ceilings. Each figure was
  measured in one tree against `main` at `2462564f`:

  | Ceiling | `main` | This branch | Change | New ceiling |
  | --- | --- | --- | --- | --- |
  | `late` | 173,078 | 173,273 | +195 | 173,600 |
  | `late-identity` | 66,707 | 69,168 | +2,461 | 69,500 |
  | `account` | 40,951 | 44,407 (44,467 merged; 44,621 with the refused-save focus fix) | +3,670 | 45,000 |

  With `main` at `f166dd38f` merged, the kernel alone measured 168,789 on `main` and 168,810 here
  (+21, the command's name in the shell's command list), over its 168,800. It is set to 169,100.
  First paint is otherwise unchanged.

The umbel server did not connect in this session, so `components-brief` was not called. The tab
uses native controls on the account chunk's styles and no `violet-*` component, as the other tabs
do. Left open: an owner's narrowing of a connected agent, which the approach put out of scope.
