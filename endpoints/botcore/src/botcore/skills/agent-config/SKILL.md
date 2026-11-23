---
name: agent-config
description: >
  Configures agents for the botcore-agents plugin under [plugins.agents]: models,
  connector command resolution, permissions, state persistence, and the fields
  that have no effect yet. Use when writing or debugging an agent definition.
metadata:
  source: botcore
  version: 2.1.0
  portable: true
---

# Configuring botcore agents

The optional `botcore-agents` plugin reads `[plugins.agents]` from `botcore.toml`, or `[tool.botcore.plugins.agents]` from `pyproject.toml`. Its models are in `packages/botcore-agents/src/botcore_agents/config.py`.

## Loading

- Config arrives only through the plugin's `configure()` hook, which `botcore serve` calls. `build_host` refuses the plugin because it doesn't declare `host_context_safe`. Without the hook, `agent_create` returns `AGENT_NOT_CONFIGURED`.
- An agent's identity is its table key in `[plugins.agents.agents.<key>]`, which is what `agent_create(name=...)` takes. The `name` field isn't read.
- The key is also who the agent's tool calls run as: an agent actor whose id is the key, unless the tool host's actor is an agent with an id of its own. `botcore-memory` keys agent memory on it (`agent_<key>` for a lowercase key, else a digest), so agents read and write only their own; two people running the same key share its memory. A spawned `<role>-<n>` is a different agent with its own memory.
- Agent, plugin and state tables reject unknown keys, but `permissions` ignores them. A misspelt `allow_filesytem = true` leaves filesystem access off without any error.

## Model

There is no built-in `default_model`. An agent uses its `model`, or else `default_model`; with both blank, `agent_start` returns `CONFIG_ERROR`. Model IDs vary by Copilot account, so copy one from `llm_model_list`.

## Tools

Resolution order:

1. A non-empty `connector_commands` is the exact tool list, and `connectors` is ignored. Any namespace command works, such as `research_query` or `dev_test`. An unknown name is only logged here, then makes `agent_start` fail with `SESSION_CREATE_ERROR`.
2. An empty `connectors` (the default) gives no tools.
3. `"*"` gives every command with a known connector prefix. It needs `botcore-agents[connectors]`, and returns `INTEGRATION_UNAVAILABLE` without it.
4. Otherwise commands match by prefix, so `["github"]` gives every `github_*` command.

To combine every GitHub command with `research_query`, list them all in `connector_commands`.

`skills` names prompt knowledge and never becomes a tool. In this version nothing reads it, and any name, real or not, is silently accepted. Put the guidance an agent needs in `system_prompt`, which is appended to the runtime's own system message.

## Permissions

`[plugins.agents.agents.<key>.permissions]`:

| Field | Default | Behaviour |
|---|---|---|
| `allow_shell` | `false` | `shell_allowlist` narrows it: each command is approved on its own (`&&`, `\|\|`, `;`, `\|`, line breaks, redirections, backticks and `$` outside quotes are refused). The program must equal the pattern's first word; the rest is an fnmatch glob over the arguments, so `git *` admits every git option and is effectively unrestricted. Pin patterns to subcommands: `git status *`, `git diff *`. |
| `allow_filesystem` | `false` | `filesystem_paths` narrows reads and writes. Paths resolve against the process's working directory. |
| `allow_mcp` | `true` | Only with `mcp_servers` naming servers: the session then offers MCP tools and approves calls to those servers only. Default `[]` offers none. |
| `allow_custom_tools` | `true` | |

Allowlists only narrow, so `filesystem_paths` grants nothing without `allow_filesystem = true`. URL fetches and requests that need org-managed approval are always denied.

## Other fields

| Field | Default | Notes |
|---|---|---|
| `role` | `""` | `task_assign(role=...)` matches it exactly, then reuses an agent with capacity or spawns `<role>-<n>` from the first match. Keep it a short key. |
| `max_concurrent_tasks` | 1 | 1 to 10. |
| `max_agents` (plugin) | 10 | 1 to 100; spawned instances count. |
| `memory_scope`, `heartbeat_interval`, `is_lead`, `name`, `skills` | `"session"`, 30, `false`, `""`, `[]` | Validated, but not read yet. |

## State

```toml
[plugins.agents.state]
enabled = false        # while false, state_save and state_load return NO_BACKEND
path = ".botcore/orchestrator-state.json"   # relative to the workspace
retention_hours = 168  # 1 to 8760; older snapshots are ignored, older finished tasks pruned
autosave = false       # with enabled: best-effort save after agent and task changes
```

Nothing restores state on startup, so call `state_load`. Agents return stopped and unfinished tasks pending: start the agent, then call `task_resume`.

## Example

```toml
[plugins.agents]
default_model = "<id from llm_model_list>"

[plugins.agents.agents.reviewer]
role = "reviewer"
skills = ["code-reviewer", "security-auditor"]   # recorded only; see Tools
connector_commands = ["dev_lint", "dev_test"]
system_prompt = "Review the change for correctness and security problems."

[plugins.agents.agents.reviewer.permissions]
allow_filesystem = true
filesystem_paths = ["src/", "tests/"]
```
