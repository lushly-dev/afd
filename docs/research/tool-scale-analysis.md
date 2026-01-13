# Transcript Analysis: Progressive Disclosure Patterns

> Synthesis of industry patterns from Cloudflare, Anthropic, Cursor, and implications for AFD

## Key Industry Findings

### 1. Universal Convergence on Progressive Disclosure

Multiple major players arrived at the **same conclusion independently**:

| Source | Key Insight | Metric |
|--------|-------------|--------|
| **Cloudflare** | Convert MCP to TypeScript code in sandboxes | 98.7% token reduction |
| **Anthropic** | Tool Search Tool discovers tools on demand | 85% token reduction, +25% accuracy |
| **Cursor** | Sync tool descriptions to filesystem folders | 46.9% agent token reduction |

### 2. The Core Pattern

> "Give the agent a file system and get out of the way."

- **Tools become files** (discovered via grep/search)
- **Discovery becomes search** (not pre-loaded schemas)
- **Execution becomes code** (TypeScript/Python, not JSON tool calls)
- **Context remains small** (only load what's needed)

---

## Deep Dive: Primary Sources

### Cloudflare: Code Mode

**Key Insight**: LLMs are much better at writing code than making tool calls.

> "Making an LLM perform tasks with tool calling is like putting Shakespeare through a month-long class in Mandarin and then asking him to write a play in it."

**Approach**: Convert MCP tool schemas into TypeScript APIs:

```typescript
declare const codemode: {
  fetch_agents_documentation: (input: FetchAgentsDocumentationInput) => Promise<...>;
  search_agents_documentation: (input: SearchAgentsDocumentationInput) => Promise<...>;
};
```

Agent writes TypeScript code that calls these functions, runs in isolated Worker sandbox.

**Implication for AFD**: Could generate TypeScript client from command schemas.

---

### Anthropic: Tool Search Tool + Programmatic Tool Calling

**The Problem (Real Numbers)**:
- GitHub: 35 tools (~26K tokens)
- Slack: 11 tools (~21K tokens)  
- 5 servers = 58 tools = ~55K tokens before conversation starts
- Anthropic saw 134K tokens consumed by tool definitions alone

**Tool Search Tool Results**:
- Traditional: ~77K tokens upfront
- With search: ~8.7K tokens (500 for search tool + 3K for discovered tools)
- Accuracy: Opus 4 → 49% to 74%, Opus 4.5 → 79.5% to 88.1%

**Programmatic Tool Calling** (PTC):

Instead of each tool result returning to Claude, Claude writes orchestration code:

```python
team = await get_team_members("engineering")
expenses = await asyncio.gather(*[get_expenses(m["id"], "Q3") for m in team])
exceeded = [m for m, exp in zip(team, expenses) if sum(e["amount"] for e in exp) > budget]
print(json.dumps(exceeded))  # Only this reaches context
```

**Result**: 2000+ expense line items reduced to final 1KB result. 37% token reduction.

**Implication for AFD**: Consider code generation for command orchestration.

---

### Cursor: Files as Universal Abstraction

**5 Techniques**:

1. **Long tool responses → files**: Write output to file, agent uses `tail` to check, reads more if needed
2. **Chat history as files**: After summarization, agent can search history file to recover details
3. **Agent Skills as files**: Name + description in static context, full skill discovered via grep
4. **MCP tools → folders**: One folder per server, tool descriptions as searchable files
5. **Terminal sessions → files**: Outputs synced to filesystem for dynamic discovery

**Critical Insight on MCP Folders**:
> "We considered a tool search approach, but that would scatter tools across a flat index. Instead, we create one folder per server, keeping each server's tools logically grouped."

Agent can use `rg` or `jq` to filter tool descriptions.

**Implication for AFD**: Commands could be organized as folder hierarchies, not flat lists.

---

### Claude Code: Skills with Progressive Disclosure

**Skill Structure**:
```
my-skill/
├── SKILL.md          (required - overview, always loaded)
├── reference.md      (loaded when needed)
├── examples.md       (loaded when needed)
└── scripts/
    └── helper.py     (executed, not loaded)
```

**SKILL.md Front Matter** (always in context):
```yaml
---
name: your-skill-name
description: Brief description of what this Skill does
allowed-tools: [list of tools this skill can use]
---
```

**Progressive Disclosure in SKILL.md**:
```markdown
## Overview
[Essential instructions here]

## Additional resources
- For complete API details, see [reference.md](reference.md)
- For usage examples, see [examples.md](examples.md)
```

**Implication for AFD**: Context could point to command references, not embed all schemas.

---

## Comparison with Contextual Tool Loading Proposal

| Aspect | Our Proposal | Industry Pattern |
|--------|--------------|------------------|
| **Discovery** | `afd-context-list/enter` | Search files/folders |
| **Scoping** | Named contexts | File system paths |
| **Schema storage** | In-memory | Files on disk |
| **Load trigger** | Explicit enter/exit | Agent grep/read |
| **Unload** | Explicit exit | Auto-clear old results |

### What We Got Right ✅

1. **Dynamic scoping** - Only expose tools when needed
2. **Lazy loading** - Load tools on demand
3. **Context hints** - Suggest context switches
4. **Read-only scopes** - Background agent safety

### What to Reconsider 🤔

1. **File-based discovery** - Industry strongly favors files over APIs
2. **Folder-per-context** - Cursor's "one folder per server" pattern
3. **Code generation** - Cloudflare/Anthropic: generate code, not JSON calls
4. **Auto-eviction** - Anthropic clears old tool results automatically

---

## Experimental Ideas

### Experiment 1: Commands as Folders

```
/commands/
  /document-editing/
    CONTEXT.md         # Front matter: name, description, 10 tokens
    format-bold.md     # Full schema, loaded on demand
    format-italic.md
  /print/
    CONTEXT.md
    print-execute.md
```

Agent discovers with `ls`, reads specific command schemas with `cat`.

### Experiment 2: Code Generation Mode

Instead of:
```json
{ "tool": "document-format", "args": { "style": "bold" } }
```

Generate:
```typescript
await afd.document.format({ style: "bold" });
```

### Experiment 3: Anthropic's `--enable-mcp-tool-use-discovery`

- Experimental flag in Claude Code
- Test with lushbot MCP server
- Measure token reduction

### Experiment 4: Auto-Clear Old Results

When context fills, automatically evict oldest tool results first.

---

## Recommended Proposal Updates

1. **Add Phase 5: File-Based Discovery**
   - Commands organized as folder hierarchy
   - CONTEXT.md per folder with front matter
   
2. **Add metric targets**
   - Aim for 50%+ token reduction (industry baseline)
   
3. **Reference this research** in Related Work section

4. **Consider hybrid approach**
   - Keep explicit contexts for access control
   - Add file-based discovery for schemas

---

## References

- [Cloudflare Code Mode](https://blog.cloudflare.com/code-mode/) - MCP → TypeScript, 98.7% reduction
- [Anthropic Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use) - Tool Search, PTC
- [Cursor Dynamic Context Discovery](https://cursor.com/blog/dynamic-context-discovery) - Files as abstraction
- [Claude Code Skills](https://code.claude.com/docs/en/skills) - Progressive disclosure patterns
