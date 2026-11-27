# MCP client features: AFD, Botcore and Umbel

> **Goal**: Make AFD's MCP servers, Botcore and Umbel work cleanly with the MCP client features
> Claude shipped on 2026-11-24 — Skills over MCP, Tasks and Elicitation — while tracking File
> Uploads until the extension stabilizes and measuring how client-side tool search affects AFD's
> tool strategies.

| Field | Value |
| --- | --- |
| Status | Proposed 2026-11-24. Work is tracked per sub-issue in [STATUS.md](STATUS.md). |
| Author | jasfalk (drafted with Claude and Gemini) |
| Epic | [#2497](https://github.com/lushly-dev/afd/issues/2497) |
| Packages | `spec/`, `packages/server`, `python/`, `packages/rust`, `packages/examples/todo`, `endpoints/botcore`, `endpoints/umbel` |
| Related | [MCP Resources and Skills](../../complete/mcp-resources-skills/STATUS.md); [MCP Tasks](../../complete/mcp-tasks/STATUS.md); [MCP Confirmations](../../complete/mcp-confirmations/STATUS.md); [Apps Exposure](../../active/apps-exposure/STATUS.md); [MCP Authorization](../../active/mcp-authorization/STATUS.md) ([#1552](https://github.com/lushly-dev/afd/issues/1552)); elicitation phase 4 ([#552](https://github.com/lushly-dev/afd/issues/552)) |

## Problem

AFD's core servers already implement Skills over MCP, Tasks and form/URL elicitation, and Umbel
builds on AFD's Rust server. Three gaps separate that baseline from smooth end-to-end use with
Claude's MCP clients:

1. **Botcore does not use AFD's MCP server layer.** Its managed MCP server
   (`create_host_mcp_server` in
   [`endpoints/botcore/src/botcore/host_surfaces.py`](../../../../endpoints/botcore/src/botcore/host_surfaces.py))
   sits directly on the Python MCP SDK (`FastMCP`/`MCPServer` through `botcore._mcp.sdk_types`),
   even though [`host.py`](../../../../endpoints/botcore/src/botcore/host.py) already uses `afd` for
   `CommandResult`, `DirectClient` and middleware. As a result, Botcore gets none of AFD's Skills
   extension, tasks, confirmations, output budgets or tool strategies, and maintains its own
   discovery/call/docs meta-tools and per-command tool wiring.
2. **Task result retention can expire too soon.** AFD counts `ttlMs` from `createdAt` with a
   one-hour default (`DEFAULT_TASK_TTL_MS = 3_600_000` in
   [`packages/server/src/tasks.ts`](../../../../packages/server/src/tasks.ts),
   [`python/src/afd/server/tasks.py`](../../../../python/src/afd/server/tasks.py) and
   [`packages/rust/src/server/tasks.rs`](../../../../packages/rust/src/server/tasks.rs)) and stops
   the task when `ttlMs` elapses ([`spec/tasks.md`](../../../../spec/tasks.md)).
   A 50-minute job leaves only 10 minutes to collect its result, and a job over an hour is cancelled.
   In Umbel's hosted task store
   ([`endpoints/umbel/src/shared/tasks.rs`](../../../../endpoints/umbel/src/shared/tasks.rs)),
   `with_ttl_capped_at_token_expiry` also ends `ttlMs` at token expiry plus
   `TOKEN_EXPIRY_GRACE_MS` (60 seconds) and purges results at token expiry.
3. **Client-side constraints and trade-offs are untested or unmeasured.** No shared conformance test
   checks every field Claude Code requires on task responses across all three languages, no warning
   catches a skill catalog that fits AFD's spec limits but exceeds Claude Code's tighter caps, and
   AFD's meta-tools have not been measured against per-command tools when Claude's tool search is
   enabled.

## Baseline (2026-11-24)

Read from `main` at `3d48e8b83` on 2026-11-24 and checked against a hosted Umbel `ideas` instance:

| Feature | AFD (TS, Python, Rust, C++) | Botcore | Umbel |
| --- | --- | --- | --- |
| Skills over MCP (`io.modelcontextprotocol/skills`) | Ready in all four languages ([MCP Resources and Skills](../../complete/mcp-resources-skills/STATUS.md)) | No: managed server uses bare MCP SDK; 12 skills in `endpoints/botcore/src/botcore/skills/` ship only via `botcore skill-seed` | Ready: host serves plugin skills automatically ([`endpoints/umbel/src/host/mod.rs`](../../../../endpoints/umbel/src/host/mod.rs)); verified end to end on hosted `ideas` (`skills/list`, then `resources/read`, 4,076 bytes matching manifest digest) |
| Tasks (`io.modelcontextprotocol/tasks`) | Ready in TS, Python and Rust; C++ not planned ([MCP Tasks](../../complete/mcp-tasks/STATUS.md)). `ttlMs` counts from `createdAt` | No | Ready over HTTP (SQLite store) and local stdio (in-memory store); same retention gap, tightened on HTTP by token-expiry cap |
| Elicitation | Confirmations use stateless form input requests ([MCP Confirmations](../../complete/mcp-confirmations/STATUS.md)). Rust and TypeScript implement URL-mode `HumanRelay` ([MCP Authorization](../../active/mcp-authorization/STATUS.md); Python open in [#2264](https://github.com/lushly-dev/afd/issues/2264), C++ N/A). Tasks forbid `input_required` | No: tool annotations (`readOnlyHint`, `destructiveHint`) only | Ready: confirmations and URL-mode human relay |
| File Uploads (`io.modelcontextprotocol/files`) | Not started; extension is experimental | No | No |

Tracked elsewhere: MCP Apps ([Apps Exposure](../../active/apps-exposure/STATUS.md)) and elicitation
phase 4 ([#552](https://github.com/lushly-dev/afd/issues/552)). Enterprise Managed Authorization is
explicitly out of scope in
[MCP Authorization](../../active/mcp-authorization/mcp-authorization.proposal.md#out-of-scope) and
currently has no tracking issue.

## Host limits and client requirements

Server authors targeting Claude and Claude Code must plan around limits stricter than the base MCP
extension drafts.

### Claude Code skills limits

Source: [Use skills from MCP servers](https://code.claude.com/docs/en/mcp#use-skills-from-mcp-servers).

| Constraint | Claude Code limit | AFD spec (`spec/mcp-resources.md`, S2) |
| --- | --- | --- |
| Skills per server | 100 | No server-wide cap |
| Size per text file (scanned skills) | 100 KB | Bounded by per-skill cap |
| Total size per skill (scanned skills) | 400 KB | 512 files or 16 MiB |
| Skill naming in client | `<server>:<skill>` | Unqualified skill `name` |

Because AFD servers may serve other clients, exceeding Claude Code's limits emits a warning
without refusing the catalog ([#2502](https://github.com/lushly-dev/afd/issues/2502)). Botcore's 12
bundled skills under `endpoints/botcore/src/botcore/skills/` fit Claude Code's limits as of
2026-11-24 (largest folder: `gate-discipline` at 161,655 bytes across 8 files; largest file:
`gate-discipline/scripts/check-test-discovery.mjs` at 45,654 bytes).

### MCP skills host availability

Source: [Claude Code's MCP page](https://code.claude.com/docs/en/mcp)
([MCP skill availability](https://code.claude.com/docs/en/mcp#use-skills-from-mcp-servers)).

- Claude Code does **not** load MCP skills in cloud sessions, `claude -p`, `claude remote-control`
  server mode, GitHub Actions or the Agent SDK.
- Observed on 2026-11-24: an Agent SDK session on Claude Code 2.1.331 connected to a hosted Umbel
  `ideas` server did not list `ideas:ideas-guide`, even though direct requests to that server
  declared `io.modelcontextprotocol/skills` on `2026-07-28`, listed `skill://ideas-guide/SKILL.md`
  and returned bytes matching its manifest digest.
- Repository observation (2026-11-24, not from Claude Code's docs): Codex does not read MCP skills.

File-based skill seeding (`botcore skill-seed`) therefore remains supported alongside MCP skills
for fleets, headless/CI runs and non-Claude agents
([#2504](https://github.com/lushly-dev/afd/issues/2504)).

### Claude Code task requirements

Source: [MCP tasks for server authors](https://code.claude.com/docs/en/mcp#mcp-tasks-for-server-authors).

- **Initial task answer (`tools/call`):** carries `resultType: "task"`, `taskId` (at most 128
  printable ASCII characters, no spaces), `status`, `createdAt`, `lastUpdatedAt` and `ttlMs`
  (required by the tasks extension; `ttlMs` may be `null`; Claude Code v2.1.317+ tolerates omitting
  the three timestamp/TTL fields, while earlier versions fail without them), plus optional
  `pollIntervalMs` and `statusMessage`. On HTTP and claude.ai connector servers, accept the job and
  send the task answer before running the work so the call stays within the per-request timer.
- **`tasks/get` answer:** carries `resultType: "complete"`, `taskId`, `status`, `createdAt`,
  `lastUpdatedAt` and `ttlMs` (`ttlMs` may be `null`; `statusMessage` and `pollIntervalMs` are
  optional). In AFD, TypeScript's SDK adds `resultType: "complete"`
  ([`packages/server/src/tasks-runtime.ts`](../../../../packages/server/src/tasks-runtime.ts) and
  [`packages/server/src/tasks.test.ts`](../../../../packages/server/src/tasks.test.ts)), and Rust
  asserts it in `packages/rust/tests/server_tasks.rs`, while Python's `test_tasks.py` does not yet
  assert it; [#2501](https://github.com/lushly-dev/afd/issues/2501) pins all three languages in
  `task-cases.json`.
- **`failed` tasks:** carry top-level `error.message` (within `{ code, message, data }`).
- **`input_required` tasks:** at most 16 `inputRequests` keys per task, answered through
  `tasks/update` (keys beyond 16 are ignored).
- **Polling interval:** optional `pollIntervalMs` (number or omitted). Outside the cloud, Claude
  Code clamps it to `250`–`30000` ms (default `2000` when absent or `null`). In cloud sessions and
  claude.ai chats, checks follow `1000`–`30000` ms and can slow to every 10 seconds after 1 minute
  and every 30 seconds after 10 minutes.
- **Result retention:** keep finished results for at least an hour after completion, with `ttlMs`
  set to the longest run time plus that retention (or `null` when unlimited)
  ([#2500](https://github.com/lushly-dev/afd/issues/2500)).

### Client-side tool search

Source: [tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
and the [2026-11-24 announcement](https://claude.com/resources/articles/skills-over-mcp-tasks-and-more).

Claude loads tool definitions on demand; the 2026-11-24 article says this can cut tool-definition
context by over 85% in multi-server setups. AFD's meta-tools (`afd-discover`, `afd-detail`,
`afd-call`) and lazy loading address the same context cost.
[#2503](https://github.com/lushly-dev/afd/issues/2503) measures meta-tools, per-command tools and
the hybrid strategy on Claude Code with tool search enabled before any default changes.

## Plan

Work is broken into eleven sub-issues under epic [#2497](https://github.com/lushly-dev/afd/issues/2497).
Each issue's live state, dependencies and deferral reason live in [STATUS.md](STATUS.md).

- **Documentation and tracking** ([#2498](https://github.com/lushly-dev/afd/issues/2498)): this
  proposal, `STATUS.md` and the feature index entry.
- **Task retention and client checks** ([#2500](https://github.com/lushly-dev/afd/issues/2500),
  [#2501](https://github.com/lushly-dev/afd/issues/2501)): separate run budget from post-completion
  retention (default one hour after finishing) across `spec/command-metadata.md`, TypeScript, Python
  and Rust; add Claude Code task-client checks to
  [`packages/examples/todo/spec/task-cases.json`](../../../../packages/examples/todo/spec/task-cases.json)
  and run one live end-to-end check from Claude Code (v2.1.304 or later).
- **Botcore managed host on AFD** ([#2499](https://github.com/lushly-dev/afd/issues/2499), followed
  by deferred [#2504](https://github.com/lushly-dev/afd/issues/2504) and
  [#2505](https://github.com/lushly-dev/afd/issues/2505)): move `create_host_mcp_server` onto
  `afd.create_server` with host policy as AFD middleware, keeping `{name}-start`, `{name}-call` and
  `{name}-docs` as aliases for at least one Botcore release, settling `create_host_mcp_server`'s
  `raw_python=True` (`{name}-run`) option in its approach, and leaving legacy trusted-local
  `create_mcp_server` unchanged; then serve registered skill directories
  (`PluginRegistry.add_skills_dir` in
  [`endpoints/botcore/src/botcore/plugin.py`](../../../../endpoints/botcore/src/botcore/plugin.py))
  over `io.modelcontextprotocol/skills`, and retire the aliases after one release.
- **Skill catalog warnings and tool-search measurement**
  ([#2502](https://github.com/lushly-dev/afd/issues/2502),
  [#2503](https://github.com/lushly-dev/afd/issues/2503)): warn without refusing when a skill
  catalog exceeds Claude Code's limits; benchmark AFD's tool strategies under Claude's tool search.
- **Deferred decisions and external dependency**
  ([#2506](https://github.com/lushly-dev/afd/issues/2506),
  [#2507](https://github.com/lushly-dev/afd/issues/2507),
  [#2508](https://github.com/lushly-dev/afd/issues/2508)): two owner trust-model decisions (below)
  and File Uploads (`io.modelcontextprotocol/files`), held until accepted as an Extensions Track SEP
  with a reference implementation.

## Open decisions for the owner

1. **May a finished Umbel task's result outlive its starting token?**
   ([#2506](https://github.com/lushly-dev/afd/issues/2506), depends on `#2500`.) Today Umbel purges
   finished results at token `exp` so no result outlives the authorization that produced it. Keeping
   finished results readable by the same principal with a refreshed token matches Claude Code's
   one-hour expectation but relaxes that rule.
2. **Should an AFD task be allowed to ask a person (`input_required`)?**
   ([#2507](https://github.com/lushly-dev/afd/issues/2507), related to
   [#552](https://github.com/lushly-dev/afd/issues/552).) The 2026-11-07 rule in
   [`spec/tasks.md`](../../../../spec/tasks.md) forbids `task:
   "optional"` or `"required"` alongside `confirmPrompt`, non-default `approval` or
   `confirmationMode`. Revisiting it changes the trust model (who answers, principal binding and
   timeout handling) and would start with a separate proposal.

## Sources

- [MCP servers can now ship skills, run tasks, and more with Claude](https://claude.com/resources/articles/skills-over-mcp-tasks-and-more) (2026-11-24)
- [MCP Skills extension](https://modelcontextprotocol.io/extensions/skills/overview) (`io.modelcontextprotocol/skills`)
- [MCP Tasks extension](https://modelcontextprotocol.io/extensions/tasks/overview) (`io.modelcontextprotocol/tasks`)
- [MCP Elicitation (2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation)
- [MCP File Uploads extension (experimental)](https://github.com/modelcontextprotocol/experimental-ext-file-uploads) (`io.modelcontextprotocol/files`)
- [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp) ([skills](https://code.claude.com/docs/en/mcp#use-skills-from-mcp-servers), [tasks](https://code.claude.com/docs/en/mcp#mcp-tasks-for-server-authors))
- [Claude tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
