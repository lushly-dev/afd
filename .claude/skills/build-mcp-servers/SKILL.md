---
name: build-mcp-servers
description: >
  Builds and debugs Python MCP servers on Botcore and the MCP SDK: tool-list
  cost, output budgets, subprocesses, execute tools and client setup. Use when
  writing an MCP server or tool, or when a server bloats context, truncates
  JSON, hangs or won't start.
metadata:
  source: botcore
  version: 2.1.0
  portable: true
---

<!-- Generated from skills/exports.json; edit the canonical mcp-builder skill. -->

# MCP servers

Botcore uses the official MCP Python SDK (`mcp`), not the standalone `fastmcp` package: `botcore._mcp.sdk_types()` returns SDK 2's `MCPServer` or SDK 1's `FastMCP`. To expose Botcore commands, write a plugin and serve it with `create_host_mcp_server` (see the Botcore plugin skill).

## Measure what the tool list costs

The model reads every tool's name, description and input schema from `tools/list`. Measure the serialized payload rather than counting tools:

```python
import json

tools = await server.list_tools()
payload = json.dumps([t.model_dump(mode="json", by_alias=True, exclude_none=True) for t in tools])
print(f"tools/list: {len(payload):,} chars, about {len(payload) // 4:,} tokens")
```

Record the figure next to the tool list and re-measure whenever tools change.

Where it costs depends on the client. Claude Code's tool search is on by default and loads only tool names and server instructions up front; `/context` shows which tools are deferred. Clients without deferral, and Claude Code with tool search off, load everything.

- **Instructions.** Set the server's `instructions` to say what tasks its tools handle, so tool search can find them. Botcore's factories set only a name.
- **Descriptions.** Give purpose and call shape, with searchable words first. Claude Code cuts long descriptions and instructions; [its MCP docs](https://code.claude.com/docs/en/mcp) give the current limits. Put reference text behind a docs tool, as Botcore's `{name}-docs` does.
- **Growth.** When the payload grows, consolidate related operations behind one dispatcher, such as an `action` argument or Botcore's `{name}-call(command, arguments)`.

## Bound prose, never structured output

Truncated JSON or NDJSON is not a shorter result but a decode error. Bound only output that degrades gracefully: logs, diffs and test output. The helpers are in `botcore.utils.runner`:

- **`run_command(cmd, cwd=None, timeout=300, max_output=MAX_OUTPUT_LENGTH)`** bounds each stream to 100,000 characters.
  - Pass `max_output=None` when you parse the output.
  - Surface the returned `truncated` flag so a clipped result is visible.
  - On success it returns `error: None` and drops stderr.
  - `failure_kind` separates `failed` (non-zero exit), `unavailable` (missing executable) and `error` (timeout or other).
- **`run_external_tool` and `run_python_module`** take no `max_output` and always apply the default budget, so call `run_command` directly for structured output.
- **`smart_truncate`** keeps the first 40% and the last 60% of the budget around a `... [N chars truncated] ...` marker, so a tool's leading summary and trailing verdict both survive. The legacy `{name}-run` applies it to its whole output; a host's `{name}-call` returns the full `CommandResult`.

Claude Code sets its own limits on top:
- It saves a large successful result to a file and points the model at it. `MAX_MCP_OUTPUT_TOKENS` and a tool's `_meta["anthropic/maxResultSizeChars"]` adjust when that happens.
- It keeps only the head and tail of a long error result, so keep error payloads short.

## Subprocesses

Use `asyncio.create_subprocess_exec` with `stdin=asyncio.subprocess.DEVNULL` and a timeout, as `run_command` does. On Windows, a child that inherits stdin shares the stdio transport's pipe, and the server and the child deadlock waiting on the same stream.

## Execute tools are trusted-local only

A single `code: str` tool lets a model chain calls in one round trip, and sidesteps clients that once failed to build arguments for complex schemas (nested objects, enums, `dict[str, Any]`). Add one for that reason only after reproducing the failure on the client and model you target; keep the structured tools and re-test on model updates.

An execute tool runs arbitrary code. Botcore offers one only in a trusted-local host ([`host-composition.md`](https://github.com/lushly-dev/afd/blob/main/endpoints/botcore/docs/host-composition.md)):

```python
from pathlib import Path
from botcore import ExecutionContext, build_host, create_host_mcp_server

from notes_plugin import host_policies

context = ExecutionContext(Path.cwd(), profile="trusted-local")
host = build_host("notes", context, plugins=("notes",), policies=host_policies())
server = create_host_mcp_server(host, raw_python=True)  # adds notes-run
```

`raw_python=True` raises `ValueError` without `trusted-local`. Command calls inside the code still go through host policy, but the code itself can import anything; it is checked only for syntax and a 32,000-character limit. The legacy `create_mcp_server` exposes the same `{name}-run` with no policy at all.

Offer an execute tool only to the local user who could already run that code. If another principal can reach it, including through content an agent reads, use structured tools under host policy; if it must stay, apply the security audit skill's code-execution policy and still treat it as unconfined.

## Client configuration

- **Claude Code.** Use `claude mcp add <name> -- <command> [args...]` (the default transport is stdio).
  - `--scope project` writes the shared `.mcp.json` at the project root, under `mcpServers`.
  - Local and user scopes are stored in `~/.claude.json`.
- **VS Code.** `.vscode/mcp.json` uses a top-level `servers` key, and each stdio server needs `"type": "stdio"`. Without it, servers have failed silently to start.
- **Launching.** Start the server with `uv run`, and set `cwd` to the project that owns the environment so it imports the right packages.
