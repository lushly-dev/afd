# botcore-memory

Memory plugin for Botcore: entries kept across tasks and sessions, in a local JSON store
(`~/.botcore/memory` by default, `{local_path}/{scope}/{scope_id}.json`). The `memory`
documentation topic (`MEMORY_DOCS` in `botcore_memory/commands.py`) lists the five commands,
`memory_set`, `memory_get`, `memory_search`, `memory_delete` and `memory_list`.

## Scopes

| Scope | `scope_id` | Who may read and write |
|---|---|---|
| `agent` | the caller's principal (the default when `scope_id` is left out) | that caller only |
| `team` | a team name | every caller |
| `task` | a task identifier | every caller |

A call for another caller's agent memory is refused with `MEMORY_ACCESS_DENIED`.

## Who the caller is

The caller is decided by how the call arrives, never by an argument.

- **Through a Botcore host** (`CommandHost.execute`: a host's CLI, MCP `afd-call` tool, HTTP
  surface, or an LLM session's bridged tools). The caller is the actor the host's surface
  verified, from `botcore.context.current_call()`. Its principal is `<kind>_<id>`
  (`agent_researcher`, `human_alex`) when the id is lowercase letters, digits, `_` and `-`,
  else `<kind>-<digest>` (the first 32 hex digits of the id's SHA-256), as for `Alex` or
  `lane@random`. Every principal is lowercase, so ids that differ only by case never share a
  file on a case-insensitive disk.
  `botcore_memory.access.principal_id(actor)` gives it. On the HTTP surface the actor is the
  one the bearer token names; `onBehalfOf` is what the caller claims and is not used.
- **A host call whose actor has no id is refused** with `MEMORY_PRINCIPAL_UNKNOWN`, never
  mapped to a shared identity, since a host may serve several callers. The MCP `afd-call` tool
  calls as an agent with no id, so a host serving memory over MCP names its caller:
  `CommandHost(..., actor=Actor(kind="human", id="<you>"))`. An LLM session's tools call as
  the session's `agent_name` (a `botcore-agents` agent's configured key) when a local, trusted
  caller created the session. The name says which agent, not for whom: two people whose tool
  hosts run the same agent name share that agent's memory.
- **Botcore 0.8.0 or later** is required: older hosts do not say who is calling. On one, a
  managed host call is refused with `MEMORY_PRINCIPAL_UNKNOWN` rather than treated as local.
- **Directly in your own process** (the `botcore` CLI, the legacy stdio MCP server's `run`
  tool, a script importing the commands). This is one local user, whose principal is
  `default`. A trusted embedder that runs several agents in one process sets
  `botcore_memory.access.current_agent` to the agent's name before each call; a host call
  ignores it.

The plugin is not admitted to managed hosts (`build_host`) by plugin name: it keeps one store
per process and declares no command policies. A host that serves it registers the commands
itself, with the effects it admits.

## Moving `default` memories to a principal

Entries written before callers had principals sit under `agent/default.json` and stay
readable locally as `default`; no host caller can reach them. `move_default_memory` copies
them to a principal from a local script (it refuses a host call). Stop every host and
process serving the store first: the move holds the store's locks only within its own
process.

```python
import asyncio

from afd import Actor
from botcore_memory.access import principal_id
from botcore_memory.migrate import move_default_memory

result = asyncio.run(move_default_memory(principal_id(Actor(kind="agent", id="researcher"))))
print(result.model_dump(exclude_none=True))
```

It backs up both stores (into `.backup-<UTC time>` beside the scope folders, or
`backup_dir=`) and reports the backup files in every result. It builds the target's store
and writes it once, keeping each entry's id, tags, timestamps, creator and ttl. A target
entry identical to its copy counts as already moved, so running it again after an
interrupted move completes the move; a target key holding anything else is refused with
`MEMORY_MOVE_CONFLICT` before writing. It then reads every entry back. Only when it returns
`verified: true` is the copy complete; it never deletes, so remove `agent/default.json`
yourself after that. On any failure the default entries are untouched.

Point the commands at a non-default store first with
`botcore_memory.commands.configure(MemoryConfig(local_path=...))`.
