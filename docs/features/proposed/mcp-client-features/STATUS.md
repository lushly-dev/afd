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
| [#2502](https://github.com/lushly-dev/afd/issues/2502) | Warn without refusing when a skill catalog exceeds Claude Code's limits | Done ([#2641](https://github.com/lushly-dev/afd/pull/2641)) | Approach on the issue (2026-11-26): in `afd validate --surface`, which reads `skills/list` from any server, not in each language's `SkillCatalog`; limits fixed and named for Claude Code, turned off with `--suppress`. `checkClaudeCodeSkillLimits` in `@lushly-dev/afd-testing` with shared vectors; the client's streamable-http transport now forwards `skills/list` and `skills/get`. Python CLI port: [#2627](https://github.com/lushly-dev/afd/issues/2627) |
| [#2503](https://github.com/lushly-dev/afd/issues/2503) | Measure meta-tools vs per-command tools and hybrid strategy under Claude's tool search | Done ([#2651](https://github.com/lushly-dev/afd/pull/2651)) | 48 headless Claude Code 2.1.332 sessions (Sonnet 5.5) on 2026-11-26 against the todo example and a 100-command synthetic server, four strategies, tool search on and off: [tool-search-measurements.md](tool-search-measurements.md). Recommendation: tools Claude calls directly (`individual` or `grouped`) rather than meta-tools; whether the default moves from `grouped` waits for a larger sample in [#2632](https://github.com/lushly-dev/afd/issues/2632). Umbel not measured (no local build; host under load) |
| [#2504](https://github.com/lushly-dev/afd/issues/2504) | Botcore serves registered skill folders over `io.modelcontextprotocol/skills` (keeping `skill-seed`) | Done ([#2856](https://github.com/lushly-dev/afd/pull/2856)) | `create_host_mcp_server` defaults `skills` to `botcore.host_skills.host_skill_catalog(host)`, serving what `CommandHost.skills` (`HostSkills`, set by `build_host`) names: the 12 bundled skills plus the plugins' `add_skills_dir` folders, filtered by `[skills]` `include`/`skip`, less skills already seeded under `source_dir`; read with AFD's frontmatter reader, so an unreadable folder stops construction naming it. Alfred's host and `factory-cell` copy `skills`. `tests/test_host_skills.py` lists them with `skills/list` over `2026-07-28` HTTP and checks every file's `resources/read` bytes against its digest and size. README says when to serve and when to seed |
| [#2505](https://github.com/lushly-dev/afd/issues/2505) | Retire Botcore's `{name}-start`, `{name}-call` and `{name}-docs` tool aliases | In review ([#2941](https://github.com/lushly-dev/afd/pull/2941)) | `create_host_mcp_server` serves AFD's five meta-tools only (plus `{name}-run` under `raw_python`); the three names stay reserved and a call to one is refused as `TOOL_RETIRED`, naming its replacement. Replacements: `afd-discover`/`afd-detail` with each command's effects as `effect:*` tags; `afd-call` (`input`, not `arguments`); and two commands every built host now serves, `info_catalog` (what `-start` returned, scope-filtered: rows with full policy, Alfred's extra fields, profile, topics; no paths) and `info_docs`. Both describe the innermost serving host or its `serves_as`, which Alfred's child host sets. Alfred's, Botcore's and botcore-memory's tests moved to the `afd-*` names; a `lushly-botcore` breaking-change fragment marks it for the next Botcore release |
| [#2506](https://github.com/lushly-dev/afd/issues/2506) | Decide whether a finished Umbel task's result may outlive its starting token | Decided (2026-11-26); spec done ([#2975](https://github.com/lushly-dev/afd/pull/2975)); Umbel in review (`lush/umbel-task-result-outlives-token`) | Owner, on the issue: yes, readable past the starting token's expiry by the same principal with a refreshed token, still capped by the task's own `ttlMs`. `spec/tasks.md` says the token bounds the run, not the result. Umbel (D225): `options()` drops `with_ttl_capped_at_token_expiry`, and `SqliteTasks` no longer purges a finished result at the token's `exp` (`content_until_ms` written equal to `expires_ms`, read by nothing); a task, and a gateway task at its assertion, still stops with `TASK_TOKEN_EXPIRED`. Unit and end-to-end tests read finished tasks with a later token past the starting token's `exp` until the TTL |
| [#2507](https://github.com/lushly-dev/afd/issues/2507) | Decide whether an AFD task may ask a person (`input_required`) | Decided (2026-11-26); proposal next | Owner, on the issue: allow it, revisiting the 2026-11-07 rule; an approval-gated command run as a task may use `input_required` to ask a person partway through. Next: a proposal and the change to `spec/tasks.md` (who answers, how the answer binds to the task's owner, what happens when nobody answers before the task's time runs out), then the four implementations. Related: `#552` |
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

- **Tool-search strategy benchmark (`#2503`), 2026-11-26:** Claude Code 2.1.332, headless,
  `claude-sonnet-5-5`; results, method and recommendation in
  [tool-search-measurements.md](tool-search-measurements.md). With tool search, a 100-command
  server costs 290 (meta-tools) to 1,607 (per-command) tokens at start, and per-command tools run a
  command in 2 calls against 3.7 for meta-tools, with about 35% less session input; `grouped`
  tied `individual` there. Without tool search the per-command start cost is 11,161 tokens. All 48 sessions succeeded.

## Open decisions

None. Both were decided by the owner on 2026-11-26 and recorded on their issues; this file
recorded them on 2026-11-27:

- **`#2506` (Umbel finished-result lifetime vs token expiry):** yes, for the same principal with
  a refreshed token, within the task's own `ttlMs`.
- **`#2507` (Confirmations / `input_required` inside AFD tasks):** allowed; proposal and spec
  change first.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-24 | `#2498` second review | Epic [#2497](https://github.com/lushly-dev/afd/issues/2497)'s body lists Enterprise Managed Auth as tracked under `#1552`, which lists it as out of scope; correct the epic body or file an issue if Enterprise Managed Auth enters scope | Open |
| 2026-11-27 | `#2506` spec review (Claude, Gemini 4 Neon) | No test in TypeScript, Python or Rust reads a finished task with a later token of the same principal after the starting token expired, with the token-expiry cap off, though the spec now promises it; add one per language (the nearest are `packages/server/src/tasks.test.ts` "enforces auth scopes...", `packages/rust/tests/server_tasks.rs` `the_owner_is_the_issuer_subject_and_client`, `python/tests/test_tasks.py`) | Open |
| 2026-11-27 | `#2506` spec review (Claude) | `packages/rust/README.md`'s tasks example sets `.with_ttl_capped_at_token_expiry(0)` as if typical; mark it optional with the Umbel follow-up, which touches the Rust and Umbel suites anyway | Open |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-24 | `#2498` planning session | Added `docs/features/proposed/mcp-client-features/` (`mcp-client-features.proposal.md`, `STATUS.md`) and indexed the feature in `docs/features/README.md` |
| 2026-11-25 | `#2499` Botcore host on AFD MCP | Rebuilt `create_host_mcp_server` on `afd.server.create_server` with `create_host_policy_middleware`, `"lazy"`/`"individual"` strategy mapping, `{name}-start`/`-call`/`-docs` compatibility aliases, and `2026-07-28` `server/discover` coverage; verified with `pnpm verify` (`ci.yml`, `alfred.yml`, `botcore.yml`, `botcore-factory.yml`, `health.yml`, `health-dashboard.yml`) |
| 2026-11-25 | `#2500` task retention | Separated 1 h execution run budget (`maxRunMs`) from 1 h post-completion retention (`ttlMs`) in `spec/command-metadata.md`, TypeScript, Python, Rust, Umbel `SqliteTasks`, and todo conformance; verified with TS/Python/Rust/Umbel task suites, `tasks` conformance (`ts`, `py`, `rs`), and `pnpm verify` |
| 2026-11-26 | `#2501` Claude Code task client | Added four Claude Code cases to the todo tasks suite (`$task` wire view, `todo-unserializable-task`, and `matches`/`type`/`lessThan` matchers in `dx/conformance.ts`), passing on `ts`, `py` and `rs`; fixed TypeScript tasks whose result cannot be serialized; recorded a live Claude Code 2.1.332 task run end to end |
| 2026-11-26 | `#2502` skill catalog limits | `afd validate --surface` warns, naming the skill, the limit and Claude Code, when a catalog passes 100 skills, a text file 100 KB or a skill 400 KB, or holds files that keep a skill from loading; verified with the `afd-testing` vectors and the CLI's tests against a real AFD server with a catalog |
| 2026-11-26 | `#2503` tool-search measurements | Added `tool-search-measurements.md`: 48 Claude Code sessions over four strategies, tool search on and off, todo and a 100-command synthetic server; recommendation to prefer tools Claude calls directly over meta-tools under tool search, with the default left to [#2632](https://github.com/lushly-dev/afd/issues/2632); every figure re-derived from the session logs by an independent reviewer |
| 2026-11-27 | `#2504` Botcore skills over MCP | Managed host MCP servers serve Botcore's bundled skills and the plugins' skill folders over `io.modelcontextprotocol/skills`; recorded the owner's `#2506` and `#2507` decisions and `#2505` as unblocked; verified with `tests/test_host_skills.py` and `pnpm verify` |
| 2026-11-27 | `#2505` retire Botcore's aliases | Removed the managed host's `-start`/`-call`/`-docs` tools; added `info_catalog`, `info_docs` and `effect:*` tags so what they returned stays reachable over MCP, and a `TOOL_RETIRED` refusal naming each replacement |
| 2026-11-27 | `#2506` spec change | Tasks section: the token bounds a task's run, not its finished result; the owner is a principal across tokens; the token-expiry ttl cap is a host's narrowing |
| 2026-11-28 | `#2506` Umbel | Umbel keeps a finished task's result to its TTL past the starting token's `exp` (D225); tests in `src/shared/tasks/tests.rs` and `tests/it/tasks.rs` |
