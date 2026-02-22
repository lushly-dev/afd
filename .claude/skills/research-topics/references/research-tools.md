# Research Tools Reference

Quick reference for CLI and built-in tools available during research workflows.

## Lushbot Research CLI

When available in a project, `lushbot research` provides fast, sourced answers via AI models.

### Fast Research

```bash
# Uses Gemini 3 Flash (~15-30s)
lushbot research "FAST Element v2 binding syntax"
```

### Deep Research

```bash
# Uses Gemini 3 Pro (~30-90s) for complex questions
lushbot research "complex architecture question" --mode thinking
```

### Agent Mode

```bash
# Returns structured JSON output
lushbot research "Vite 6 features" --agent
```

Agent mode response format:

```json
{
  "answer": "...",
  "mode": "fast",
  "model": "gemini-3-flash-preview",
  "sources": ["https://...", "https://..."]
}
```

## Built-in Tools

### Web Search

- Use the `WebSearch` tool for current information, release notes, and comparisons
- Always verify source authority and publication dates
- Include the current year in queries for recent information

### Web Fetch

- Use `WebFetch` to retrieve and analyze specific web pages
- Works best with public, unauthenticated URLs
- Use for reading official documentation pages

### Codebase Search

| Tool | Use For |
|------|---------|
| `Grep` | Finding patterns, imports, usages in code |
| `Glob` | Finding files by name or extension |
| `Read` | Reading specific files for context |

## Search Strategy by Source Type

| Source | Tool | Reliability |
|--------|------|------------|
| Project docs | `Read` (README, AGENTS.md) | Highest -- project-specific truth |
| Codebase patterns | `Grep` / `Glob` | High -- shows actual usage |
| Official docs | `WebFetch` on doc URLs | High -- canonical reference |
| Web search | `WebSearch` | Medium -- verify independently |
| CLI research | `lushbot research` | Medium -- check returned sources |
| GitHub issues | `gh` CLI or `WebFetch` | Variable -- check open/closed status |
