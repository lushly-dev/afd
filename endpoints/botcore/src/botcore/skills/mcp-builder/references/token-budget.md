# Token Budget Management

Measuring and bounding what an MCP server costs a client in context.

## The Problem

MCP tool definitions and outputs consume context tokens. Large schemas or outputs can:

1. **Exhaust context** -- tens of thousands of tokens consumed before the conversation starts
2. **Trigger warnings** -- "Context low - Run /compact to continue"
3. **Hit client limits** -- Claude Code warns when a server's tools exceed about 25,000 tokens and caps each tool output (`MAX_MCP_OUTPUT_TOKENS`)
4. **Degrade tool selection** -- the more schema the model holds, the smaller the share of context that describes the task at hand

### Real-World Examples

- n8n MCP's `n8n_create_workflow` tool has massive JSON payload definitions
- Docker MCP consumed 125,964 tokens with 135 tools
- Users report `/doctor` showing "Large MCP tools context (~144,802 tokens > 25,000)"

Sources:
- [github.com/anthropics/claude-code/issues/12241](https://github.com/anthropics/claude-code/issues/12241)
- [github.com/anthropics/claude-code/issues/3406](https://github.com/anthropics/claude-code/issues/3406)

## Measure First

The cost is the serialized `tools/list` payload, not the number of `@mcp.tool` decorators. Measure it from the client side, which is what the model sees:

```python
import json
from fastmcp import Client

async with Client(mcp) as client:
    tools = await client.list_tools()
payload = json.dumps([tool.model_dump() for tool in tools])
print(f"tools/list is about {len(payload) // 4:,} tokens")
```

Record the number next to the tool list in the README and re-measure when tools change. Compare it with the client's budget: Claude Code's `/doctor` reports per-server totals and flags large ones. Consolidate when the payload grows, not at a fixed count.

### Tool Descriptions

| Metric | Measure | Act when |
|--------|---------|----------|
| `tools/list` payload | Serialized JSON, ~4 chars per token | It is a large share of what the session can afford, or `/doctor` flags the server |
| Per-tool description | Characters | It carries reference text, examples or option catalogs that belong behind a docs tool |
| Tool count | The payload, not the count | Consolidation would cut the payload without hiding distinct operations |

**Estimation:** ~4 characters = 1 token

### Output Limits

```python
# Budgets for modern long-context models
MAX_OUTPUT_LENGTH = 100_000     # ~25,000 tokens; botcore's run_command default
MAX_RESEARCH_LENGTH = 100_000   # default for research_stream(..., max_length=...)

# Structured payloads (JSON/NDJSON) must not be truncated at all --
# clipping them yields a decode error, not a smaller result.
# Use run_command(..., max_output=None).

# Claude Code defaults (can be overridden)
# MAX_MCP_OUTPUT_TOKENS=25000 (env var)
```

### Truncation Pattern

Botcore's `smart_truncate()` keeps the head and the tail of a stream (40% and 60% of the budget), so the summary at the top and the verdict at the bottom both survive. The simplest prose-only pattern keeps the head:

```python
def truncate_output(output: str, max_length: int = MAX_OUTPUT_LENGTH) -> str:
    if len(output) <= max_length:
        return output

    # Keep beginning (usually has summary/status)
    truncated = output[:max_length]

    # Find last complete line
    last_newline = truncated.rfind('\n')
    if last_newline > max_length * 0.8:
        truncated = truncated[:last_newline]

    return truncated + "\n\n... (truncated for token safety)"
```

## Tool Description Optimization

### Before (87 tokens)

```python
description="""Search the web using Tavily Search API.

This tool performs comprehensive web searches with advanced filtering,
content extraction, and result ranking. It supports various search modes
including news, academic papers, and general web content.

Parameters:
- query: The search query string
- max_results: Maximum number of results (1-10)
- search_depth: "basic" or "advanced"

Returns structured results with titles, snippets, and URLs."""
```

### After (12 tokens)

```python
description="Search using Tavily. Best for factual/academic topics with citations."
```

### 60% Reduction Example

The mcp-omnisearch server reduced from:
- 20 tools, 14,214 tokens -> 8 tools, 5,663 tokens

## Consolidation Strategies

### 1. Action Parameter

```python
# Before: 5 tools
@mcp.tool()
def search_web(): ...
@mcp.tool()
def search_news(): ...
@mcp.tool()
def search_academic(): ...

# After: 1 tool
@mcp.tool(description="Web search. Types: web, news, academic.")
def search(query: str, type: str = "web"): ...
```

### 2. Provider Parameter

```python
# Before: 3 tools
@mcp.tool()
def tavily_search(): ...
@mcp.tool()
def brave_search(): ...
@mcp.tool()
def google_search(): ...

# After: 1 tool
@mcp.tool(description="Web search via Tavily, Brave, or Google.")
def search(query: str, provider: str = "tavily"): ...
```

### 3. Standardize Parameter Names

Use consistent names across tools:
- `query` (not `search_term`, `q`, `text`)
- `limit` (not `max_results`, `count`, `num`)
- `provider` (not `engine`, `service`, `source`)

## Monitoring

### Claude Code Health Check

```bash
# Check MCP token usage
/doctor
```

Look for:
- "Large MCP tools context (~X tokens > 25,000)"
- Specific server token consumption

### Manual Audit

Run the measurement snippet from [Measure First](#measure-first) in a test and keep the number in the README next to the tool list, so a review can see when a change moved it.

## Environment Variables

```bash
# Increase output limit (if needed)
MAX_MCP_OUTPUT_TOKENS=50000

# MCP mode flag (triggers quiet output in child processes)
LUSHBOT_MCP=1
```

## Selective Server Loading

For third-party servers you cannot modify:

1. Use McPick or similar toggles to manage active servers
2. Only enable servers needed for current session
3. Disable heavy servers (Docker, n8n) when not needed
