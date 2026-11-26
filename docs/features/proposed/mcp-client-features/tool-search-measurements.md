# Tool strategies under Claude's tool search (#2503)

Measured 2026-11-26 for [#2503](https://github.com/lushly-dev/afd/issues/2503) on `main` at
`1df3406ce`. Client: Claude Code 2.1.332, headless (`claude -p --output-format stream-json`),
model `claude-sonnet-5-5`, local session. This record informs AFD's default `toolStrategy`;
changing the default is [#2632](https://github.com/lushly-dev/afd/issues/2632).

## Method

- **Servers.** The TypeScript todo example (13 todo commands plus 3 context and 3 bootstrap
  commands, 19 in all) and a
  synthetic AFD server named `wide`: 100 commands across 10 domains (`inventory`, `shipping`,
  `billing`, … × `list`, `get`, `create`, `update`, `delete`, `search`, `export`, `archive`,
  `count`, `summarize`), each with a one-line description and a small Zod schema. Both ran over
  stdio from `createMcpServer`, with only `toolStrategy` changed between runs. `hybrid` listed four
  first-class commands (todo: `todo-create`, `todo-list`, `todo-get`, `todo-toggle`; wide:
  `support-search`, `crm-list`, `billing-list`, `inventory-get`).
- **Tool search** on (`ENABLE_TOOL_SEARCH=true`, the default) and off (`false`).
- **Tasks**, three a server, each in a fresh session: todo creates a todo, reads the statistics, and
  creates two todos in one batch call. Wide summarizes shipping, searches support tickets and counts
  pay runs. Of those six, `todo-create` and `support-search` are first-class `hybrid` tools and the
  other four are not.
- **Metrics.**
  - **Start:** tokens in the session's first request (input plus cache creation plus cache read),
    less the same figure for a session with no MCP server: 21,922 with tool search, 38,335 without
    (Claude Code also defers its own tools).
  - **Calls:** the model's tool calls, `ToolSearch` included.
  - **MCP:** `tools/call` requests on the wire, from a stdio proxy that logged every message.
  - **Session:** all input tokens over the session.
  - **OK:** the task's outcome reached the server and succeeded.
- **Cost.** USD a task includes prompt-cache writes: the first task of each cell without tool
  search paid a cold cache write (USD 0.17 to 0.21) and later tasks read the cache; with tool
  search no cell paid a cold write, since the sessions shared Claude Code's cached prefix. Calls and
  session input compare strategies more cleanly.
- One session per cell and task (48 sessions, USD 3.40 in all). The numbers are means over the three
  tasks. A sample this small shows the direction of each effect, not exact sizes.

## Results

| Server | Strategy | Tool search | Start (tokens) | Calls | MCP | OK | Session input | USD / task |
| --- | --- | --- | ---: | ---: | ---: | --- | ---: | ---: |
| todo | lazy | on | 400 | 4.0 | 2.7 | 3/3 | 118,872 | 0.047 |
| todo | grouped | on | 388 | 2.7 | 1.7 | 3/3 | 88,136 | 0.055 |
| todo | individual | on | 601 | 2.0 | 1.0 | 3/3 | 68,373 | 0.043 |
| todo | hybrid | on | 460 | 2.7 | 1.7 | 3/3 | 84,965 | 0.048 |
| todo | lazy | off | 2,696 | 2.7 | 2.7 | 3/3 | 152,708 | 0.097 |
| todo | grouped | off | 5,202 | 1.0 | 1.0 | 3/3 | 87,418 | 0.089 |
| todo | individual | off | 5,313 | 1.0 | 1.0 | 3/3 | 87,744 | 0.090 |
| todo | hybrid | off | 3,383 | 1.3 | 1.3 | 3/3 | 98,032 | 0.089 |
| wide | lazy | on | 290 | 3.7 | 2.7 | 3/3 | 109,444 | 0.054 |
| wide | grouped | on | 417 | 2.0 | 1.0 | 3/3 | 69,718 | 0.046 |
| wide | individual | on | 1,607 | 2.0 | 1.0 | 3/3 | 71,070 | 0.046 |
| wide | hybrid | on | 348 | 3.0 | 2.3 | 3/3 | 94,055 | 0.049 |
| wide | lazy | off | 2,398 | 2.7 | 2.7 | 3/3 | 151,331 | 0.095 |
| wide | grouped | off | 11,661 | 1.0 | 1.0 | 3/3 | 100,160 | 0.098 |
| wide | individual | off | 11,161 | 1.0 | 1.0 | 3/3 | 99,129 | 0.097 |
| wide | hybrid | off | 2,710 | 2.0 | 2.0 | 3/3 | 124,431 | 0.091 |

Every task succeeded in all 48 sessions. In three todo batch sessions (`individual` without tool
search, and `hybrid` with and without), the model sent `afd-batch` with two `todo-create` items
instead of `todo-create-batch`. The two todos were still created in one call, so these count as OK.

## What it shows

- **With tool search, what a server costs at start barely depends on its strategy.** Claude Code
  loads only tool names and server instructions, so even 100 per-command tools cost 1,607 tokens.
  Meta-tools save about 1,300 tokens there, but a task with arguments then typically pays for
  `ToolSearch`, `afd-discover`, `afd-detail` and `afd-call` (the model skipped `afd-detail` for
  commands without arguments): 3.7 to 4 calls against 2, and 1.5 to 1.7 times the session's input
  tokens.
- **Tools a command can be called through directly beat meta-tools in Claude Code.** `individual`
  took the fewest calls (one `ToolSearch`, one command) on both servers. On the 100-command server,
  `grouped` tied it on calls and was slightly lower on session input (69,718 against 71,070) and
  start cost (417 against 1,607 tokens). On the todo server, `individual` had the lowest session
  input (68,373 against 88,136 for `grouped`). Most of the gap came from the batch task, which
  `grouped` ran through `afd-discover`, `afd-detail` and `afd-batch` (4 calls against 2). The batch
  command sat inside the `todo` group tool, but the prompt's "single batch command call" may also
  have steered the model to `afd-batch`, which it chose even where `todo-create-batch` was its own
  tool. The other two tasks tied on calls, with `grouped` about 5% higher on session input.
- **Without tool search, a large surface costs at start**: 11,000 tokens for 100 commands, against
  2,400 for meta-tools. Over one task, the per-command surface still used fewer input tokens in
  total (99,000 against 151,000), because meta-tools add turns and every turn re-reads the
  context. The start cost grows with the number of commands and the extra turns do not, so
  meta-tools win only past some catalog size this run did not reach. They are still the bounded
  choice for clients that load every tool.
- **`hybrid` sat between the two** and helped only when the task's command was first-class.

## Recommendation

- **For Claude clients, which have tool search,** serve commands as tools Claude can call directly,
  `individual` or `grouped`, rather than only through meta-tools. Between those two, this run
  does not separate them: they tied on the 100-command server, and `grouped` lost on the todo server
  only on one task, whose prompt may have steered it to `afd-batch`. Use meta-tools only
  for catalogs too large to list even as names.
- **Default:** keep `grouped` for now. Whether to move to `individual` turns on how well Claude
  finds an action inside a group tool, which this run saw on one task only. That is
  [#2632](https://github.com/lushly-dev/afd/issues/2632), as #2503 says, to decide after more
  sessions a cell, a second model and tasks that target grouped actions. Document `lazy` (or
  `hybrid`) for clients without tool search and for very large catalogs. Confidence: moderate that
  meta-tools should not be the default under tool search, low on `grouped` against `individual`.

## Not measured

- **An Umbel instance.** There was no local Umbel build in this worktree. Building one takes about
  14 GB of target directory and a long Rust build, and the shared host was under heavy load
  (load average 69). The hosted `ideas` instance serves one fixed strategy, so it cannot be
  compared across strategies. The 100-command synthetic server stands in for scale.
- **Interactive sessions, other models, and multi-task sessions**, in which the start cost is paid
  once and the calls are paid for each task.
