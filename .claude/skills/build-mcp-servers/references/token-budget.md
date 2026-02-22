# Token Budget Management

Preventing context overflow and model crashes in MCP servers.

## The Problem

MCP tool definitions and outputs consume context tokens. Large schemas or outputs can:

1. **Crash Claude Opus 4.5** -- Large tool schemas cause agent termination
2. **Exhaust context** -- 66,000+ tokens consumed before conversation starts
3. **Trigger warnings** -- "Context low - Run /compact to continue"
4. **Hit hard limits** -- Claude Code's default 25,000 token limit per tool output

### Real-World Examples

- n8n MCP's `n8n_create_workflow` tool has massive JSON payload definitions
- Docker MCP consumed 125,964 tokens with 135 tools
- Users report `/doctor` showing "Large MCP tools context (~144,802 tokens > 25,000)"

Sources:
- [github.com/anthropics/claude-code/issues/12241](https://github.com/anthropics/claude-code/issues/12241)
- [github.com/anthropics/claude-code/issues/3406](https://github.com/anthropics/claude-code/issues/3406)

## Token Budget Guidelines

### Tool Descriptions

| Metric | Target | Danger Zone |
|--------|--------|-------------|
| Total description tokens | <500 | >2000 |
| Per-tool description | <50 tokens | >100 tokens |
| Tool count | <10 | >20 |

**Estimation:** ~4 characters = 1 token

### Output Limits

```python
# Safe limits for all models
MAX_OUTPUT_LENGTH = 8000      # ~2000 tokens
MAX_RESEARCH_LENGTH = 12000   # ~3000 tokens (for long-form content)

# Claude Code defaults (can be overridden)
# MAX_MCP_OUTPUT_TOKENS=25000 (env var)
```

### Truncation Pattern

```python
def truncate_output(output: str, max_length: int = 8000) -> str:
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

```python
# Count tools
grep -c "@mcp.tool" mcp_server.py

# Estimate description tokens
# Count characters in all description= strings, divide by 4
```

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
