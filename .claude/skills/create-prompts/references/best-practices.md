# Prompt File Best Practices

Guidelines for writing effective, maintainable prompt files.

## Do

### Write specific descriptions

The description is the only thing users see in the `/` menu. Make it count.

```yaml
# Good -- specific, action-oriented
description: "[my-repo] Initialize a KB review session with tools and skills"

# Bad -- vague
description: "Help with KB stuff"
```

### Include repo prefix for multi-repo setups

When working alongside prompts from other repositories, prefix descriptions with a short identifier:

```yaml
description: "[my-repo] Scan content for stale timestamps"
```

This helps users quickly identify which repo a prompt belongs to.

### Provide reasoning behind rules

The agent makes better edge-case decisions when it understands _why_:

```markdown
## Important

- Do not edit `entities` or `graph_synced` fields -- these are managed by the
  enrichment pipeline and manual edits will be overwritten on next ingestion.
```

### Show expected output format

Use markdown templates so the agent knows exactly what to produce:

```markdown
## Output

Review complete:
- Frontmatter valid (7/7 required fields)
- Content quality: no issues
- Stale content: lastUpdated is 8 months old
```

### Reference shared docs, don't duplicate

```markdown
## Instructions

1. Read the contribution guide at [CONTRIBUTING.md](../../CONTRIBUTING.md)
2. Follow the workflow described there
```

Not:

```markdown
## Instructions

1. First search for duplicates...
2. Then write content with these frontmatter fields: title, area...
   (duplicating the entire contributing doc content)
```

### Scope tools to what's needed

```yaml
# Good -- only what this prompt uses
tools: ["mcp_server/*"]

# Unnecessary -- gives full access when only search is needed
# (omitting tools field)
```

### Design for idempotency

Running the prompt again should be safe. Init prompts verify before acting, task prompts check current state before modifying.

### Define output format explicitly

The single biggest improvement to any prompt. Use Markdown templates, tables, or code blocks to show the desired structure. Agents follow concrete output templates far more reliably than prose descriptions.

## Don't

### Don't use deprecated `mode` field

```yaml
# Deprecated
mode: "agent"

# Current
agent: agent
```

### Don't assume tools are available

If a tool listed in `tools` is unavailable at runtime, it is silently ignored. Always design prompts to gracefully handle missing tools.

```markdown
7. Verify MCP connectivity by calling `server_status`. If MCP
   is unavailable, note this in the readiness report and list which
   capabilities are affected.
```

### Don't mix multiple tasks in one prompt

Each prompt should have one clear purpose. If a workflow involves multiple distinct phases, consider separate prompts or a custom agent.

### Don't hardcode paths to workspace root

Paths resolve relative to `.github/prompts/`. Use `../../` to reach workspace root:

```markdown
# Wrong
Read [CONTRIBUTING.md](CONTRIBUTING.md)

# Right
Read [CONTRIBUTING.md](../../CONTRIBUTING.md)
```

### Don't skip the Important section

Every agent-mode prompt should have guardrails:

```markdown
## Important

- Do not modify files unless explicitly asked
- Do not edit AI-managed frontmatter fields
- Stop and ask the user when uncertain about scope
```

### Don't put always-on rules in prompts

Rules that apply to every interaction belong in `.instructions.md` or `AGENTS.md`, not in individual prompt files.

### Don't skip the output section

Without an explicit output format, agent responses vary wildly between invocations.

## Naming Conventions

| Convention               | Example                                                               |
| ------------------------ | --------------------------------------------------------------------- |
| Kebab-case file names    | `init-kb-review.prompt.md`                                            |
| Action-first naming      | `review-*`, `create-*`, `init-*`, `generate-*`                        |
| Consistent verb prefixes | `review-` for audits, `create-` for generation, `init-` for bootstrap |

## Testing

- **Play button:** Open any `.prompt.md` and click the play button in the editor title bar to test
- **Diagnostics:** Right-click in Chat view then Diagnostics to see loaded prompts and errors
- **Settings Sync:** User-level prompts sync via Settings Sync (enable "Prompts and Instructions")

## Common Anti-Patterns

| Anti-Pattern                    | Problem                               | Fix                                    |
| ------------------------------- | ------------------------------------- | -------------------------------------- |
| Vague description               | Users can't tell when to use it       | Be specific about what the prompt does |
| No output template              | Agent produces inconsistent output    | Add a structured output section        |
| Duplicated instructions         | Maintenance burden, content drift     | Reference shared docs via links        |
| Missing guardrails              | Agent takes unintended actions        | Add Important section with constraints |
| No verification step            | Agent claims success without checking | Include verification/status checks     |
| Using `mode` instead of `agent` | Deprecated -- may stop working        | Migrate to `agent: agent`              |
| Multiple unrelated tasks        | Unfocused results                     | One purpose per prompt                 |
| Over 200 lines                  | Hard to maintain, slow to load        | Extract to skill with references       |
