# MCP client features: status

Epic: [#2497](https://github.com/lushly-dev/afd/issues/2497).

Read this before the [proposal](mcp-client-features.proposal.md). It records exactly what is done
and what is not, so an agent never has to scan the code to learn what is current. It follows the
shape of the [MCP resources and skills status](../../complete/mcp-resources-skills/STATUS.md) and
the [Umbel status](../../../../endpoints/umbel/docs/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "planned", "in progress" or
  "deferred", with what remains or blocks it spelled out.
- Each pull request edits only its own row in [Sub-issues](#sub-issues) and appends a row in
  [Session log](#session-log). Do not add a running sentence saying which issues are done or next.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them; link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** proposed on 2026-11-24 under epic [#2497](https://github.com/lushly-dev/afd/issues/2497).
  Each sub-issue's current state is on its own row below.
- **Baseline:** read on 2026-11-24 against `main` (`3d48e8b83`), a hosted Umbel `ideas` instance,
  Claude Code 2.1.331, the 2026-11-24 Claude MCP announcement and the linked MCP extension specs.
- **Tracked elsewhere / out of scope:** MCP Apps ([Apps Exposure](../../active/apps-exposure/STATUS.md))
  and elicitation phase 4 ([#552](https://github.com/lushly-dev/afd/issues/552)) are tracked in
  their own issues. Enterprise Managed Authorization is listed as out of scope in
  [MCP Authorization](../../active/mcp-authorization/mcp-authorization.proposal.md#out-of-scope) and
  is currently untracked.

## Sub-issues

GitHub labels stay on the linked issues; the table below records each issue's state and next gate.

| Issue | Scope | State | Notes / next gate |
| --- | --- | --- | --- |
| [#2498](https://github.com/lushly-dev/afd/issues/2498) | Plan, proposal, this `STATUS.md` and feature index row | Done ([#2549](https://github.com/lushly-dev/afd/pull/2549)) | Adds `docs/features/proposed/mcp-client-features/` and index row in `docs/features/README.md`; no code changes |
| [#2499](https://github.com/lushly-dev/afd/issues/2499) | Botcore managed host (`create_host_mcp_server`) on `afd.create_server` with old tool names as aliases | Done ([#2580](https://github.com/lushly-dev/afd/pull/2580)) | Moved `create_host_mcp_server` onto `afd.server.create_server` with `create_host_policy_middleware`, `command_tools` -> `"lazy"`/`"individual"`, `{name}-start`/`-call`/`-docs` compatibility aliases, `raw_python=True` preserved, `host_http.py` unchanged |
| [#2500](https://github.com/lushly-dev/afd/issues/2500) | Task retention: keep finished result one hour after completion (TS, Python, Rust, `spec/`) | Done ([#2575](https://github.com/lushly-dev/afd/pull/2575)) | Separated 1 h `maxRunMs` run budget from 1 h `ttlMs` post-completion retention across TS, Python, Rust, Umbel `SqliteTasks`, `spec/command-metadata.md`, and todo tasks conformance |
| [#2501](https://github.com/lushly-dev/afd/issues/2501) | Check AFD and Umbel tasks against Claude Code's task client requirements + live run | Done ([#2635](https://github.com/lushly-dev/afd/pull/2635)) | Four Claude Code cases in `packages/examples/todo/spec/task-cases.json`: the task answer's fields and `taskId` format, the settled `tasks/get` answer, a working poll and an answer that does not wait for the work, and a `failed` task's `error.message` (TypeScript and Python; Rust's results are always JSON, so `server_tasks.rs` covers it). They pass on `ts` and `py` (13/13) and `rs` (12/12), 2026-11-26, `--suite tasks --mode modern`. The runner reads `tasks/get` off the wire, since the SDK client drops `resultType`. The failed case found a TypeScript bug: an unserializable result crashed a stdio server; fixed in `tasks-runtime.ts`. Umbel's task answers come from `packages/rust`, covered by `rs`; Umbel itself is not in the tasks suite. Live run below |
| [#2502](https://github.com/lushly-dev/afd/issues/2502) | Warn without refusing when a skill catalog exceeds Claude Code's limits | Planned (approach first) | Propose approach first: `SkillCatalog` vs `afd validate --surface`, host configurability |
| [#2503](https://github.com/lushly-dev/afd/issues/2503) | Measure meta-tools vs per-command tools and hybrid strategy under Claude's tool search | Planned (approach first) | Measure on todo example and an Umbel instance; record results and default recommendation under [Measurements and live checks](#measurements-and-live-checks) |
| [#2504](https://github.com/lushly-dev/afd/issues/2504) | Botcore serves registered skill folders over `io.modelcontextprotocol/skills` (keeping `skill-seed`) | Deferred (blocked) | Blocked by `#2499`: requires Botcore's managed host on `afd.create_server` |
| [#2505](https://github.com/lushly-dev/afd/issues/2505) | Retire Botcore's `{name}-start`, `{name}-call` and `{name}-docs` tool aliases | Deferred (blocked) | Blocked by `#2499` and one Botcore release shipping the old tool names as aliases |
| [#2506](https://github.com/lushly-dev/afd/issues/2506) | Decide whether a finished Umbel task's result may outlive its starting token | Deferred (owner decision) | Owner decision on trust model (does token expiry bound finished results as well as execution?); also depends on `#2500` |
| [#2507](https://github.com/lushly-dev/afd/issues/2507) | Decide whether an AFD task may ask a person (`input_required`) | Deferred (owner decision) | Owner decision to revisit the 2026-11-07 rule in `spec/command-metadata.md#tasks`; if yes, starts with a proposal. Related: `#552` |
| [#2508](https://github.com/lushly-dev/afd/issues/2508) | Adopt MCP File Uploads (`io.modelcontextprotocol/files`) | Deferred (blocked) | Blocked on external dependency: extension is experimental and expects breaking changes; plan once accepted as an Extensions Track SEP with a reference implementation |

## Host limits to plan for

Full details and codebase comparison are in the
[proposal](mcp-client-features.proposal.md#host-limits-and-client-requirements).

| Area | Requirement or limit | Source |
| --- | --- | --- |
| Claude Code skills caps | At most 100 skills per server; for scanned skills, 100 KB per text file and 400 KB per skill; client qualifies names as `<server>:<skill>` | [Use skills from MCP servers](https://code.claude.com/docs/en/mcp#use-skills-from-mcp-servers) |
| MCP skills host coverage | Not loaded in cloud sessions, `claude -p`, `claude remote-control` server mode, GitHub Actions or the Agent SDK. Confirmed 2026-11-24 on an Agent SDK session (Claude Code 2.1.331) against a hosted Umbel `ideas` server that served `skill://ideas-guide/SKILL.md`. Separately observed 2026-11-24: Codex does not read MCP skills. Keep file seeding (`botcore skill-seed`) | [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) (Claude sessions); 2026-11-24 observation (Codex) |
| Claude Code task creation | Initial answer carries `resultType: "task"`, `taskId` (<= 128 printable ASCII, no spaces), `status`, `createdAt`, `lastUpdatedAt`, `ttlMs` (`ttlMs` may be `null`; v2.1.317+ tolerates omitting those three fields, earlier versions reject without them) and optional `pollIntervalMs`. On HTTP and claude.ai connector servers, accept and answer before running the work | [MCP tasks for server authors](https://code.claude.com/docs/en/mcp#mcp-tasks-for-server-authors) |
| Claude Code `tasks/get` and errors | `tasks/get` returns `resultType: "complete"`, `taskId`, `status`, `createdAt`, `lastUpdatedAt`, `ttlMs` (`ttlMs` may be `null`); `failed` tasks include `error.message` | [MCP tasks for server authors](https://code.claude.com/docs/en/mcp#mcp-tasks-for-server-authors) |
| Claude Code task polling, input and retention | Optional `pollIntervalMs` clamped to 250–30000 ms outside the cloud (default 2000) and 1000–30000 ms in cloud sessions; at most 16 `inputRequests` keys on `input_required`; keep finished results at least 1 hour after finishing (`ttlMs` = run time + retention, or `null`) | [MCP tasks for server authors](https://code.claude.com/docs/en/mcp#mcp-tasks-for-server-authors) |

## Measurements and live checks

- **Live Claude Code task run (`#2501`), 2026-11-26:** Claude Code 2.1.332, local, Sonnet 5.5,
  against the TypeScript todo server over stdio (`TASK_CONFORMANCE=1`), every message logged by a
  stdio proxy.
  - A one-shot `claude -p` declared no tasks (`clientCapabilities` of `roots` and `elicitation`
    only), so `afd-call` of `todo-slow-task` ran inline, as it must for such a client.
  - `claude -p --input-format stream-json` with `CLAUDE_AUTO_BACKGROUND_TASKS=1` and its input kept
    open declared `io.modelcontextprotocol/tasks` on `server/discover` and every call. `afd-call` of
    `todo-slow-task` (`delayMs: 3000`) answered at once with `resultType: "task"`, a 26-character
    `taskId`, `status: "working"`, `ttlMs: 7200000` and `pollIntervalMs: 1000`. Claude Code polled
    `tasks/get` 60 ms later, then once a second (the server's `pollIntervalMs`), each answer
    carrying `resultType: "complete"`, until `completed` with `ttlMs: 3603012`. The model received
    `{"success":true,"data":{"delayedMs":3000}}` as the tool's result.

- **Tool-search strategy benchmark (`#2503`):** not run yet. Record client version, date, token and
  call measurements for meta-tools, per-command tools and hybrid, and the default recommendation
  here when `#2503` runs.

## Open decisions

- **`#2506` (Umbel finished-result lifetime vs token expiry):** awaiting owner decision.
- **`#2507` (Confirmations / `input_required` inside AFD tasks):** awaiting owner decision.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-24 | `#2498` second review | Epic [#2497](https://github.com/lushly-dev/afd/issues/2497)'s body lists Enterprise Managed Auth as tracked under `#1552`, which lists it as out of scope; correct the epic body or file an issue if Enterprise Managed Auth enters scope | Open |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-24 | `#2498` planning session | Added `docs/features/proposed/mcp-client-features/` (`mcp-client-features.proposal.md`, `STATUS.md`) and indexed the feature in `docs/features/README.md` |
| 2026-11-25 | `#2499` Botcore host on AFD MCP | Rebuilt `create_host_mcp_server` on `afd.server.create_server` with `create_host_policy_middleware`, `"lazy"`/`"individual"` strategy mapping, `{name}-start`/`-call`/`-docs` compatibility aliases, and `2026-07-28` `server/discover` coverage; verified with `pnpm verify` (`ci.yml`, `alfred.yml`, `botcore.yml`, `botcore-factory.yml`, `health.yml`, `health-dashboard.yml`) |
| 2026-11-25 | `#2500` task retention | Separated 1 h execution run budget (`maxRunMs`) from 1 h post-completion retention (`ttlMs`) in `spec/command-metadata.md`, TypeScript, Python, Rust, Umbel `SqliteTasks`, and todo conformance; verified with TS/Python/Rust/Umbel task suites, `tasks` conformance (`ts`, `py`, `rs`), and `pnpm verify` |
| 2026-11-26 | `#2501` Claude Code task client | Added four Claude Code cases to the todo tasks suite (`$task` wire view, `todo-unserializable-task`, and `matches`/`type`/`lessThan` matchers in `dx/conformance.ts`), passing on `ts`, `py` and `rs`; fixed TypeScript tasks whose result cannot be serialized; recorded a live Claude Code 2.1.332 task run end to end |
