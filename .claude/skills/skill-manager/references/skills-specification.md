# Claude Skills Specification

Technical specification for creating and managing Claude Agent Skills.

## SKILL.md Format

### Required Frontmatter

```yaml
---
name: skill-name              # kebab-case, unique identifier
description: >                # Critical for routing - see below
  Brief description of what this skill does.
  Use when [specific scenarios]. 
  Triggers: [keyword1], [keyword2], [keyword3].
---
```

### Optional Frontmatter Fields

| Field | Type | Purpose |
|-------|------|---------|
| `version` | string | Track skill evolution (e.g., "1.0.0") |
| `user-invocable` | boolean | If `true`, appears in slash-command menu |
| `context` | string | Set to `fork` for isolated subagent execution |
| `allowed-tools` | array | Restrict available tools (e.g., `[Read, Search]`) |
| `usage_limit` | number | Optional token limit for skill execution |

### Description Field Rules

The `description` is the **routing trigger** — the agent uses this to decide when to load the skill.

| ❌ Bad | ✅ Good |
|--------|---------|
| "Helps with git" | "Use when creating pull requests, reviewing diffs, or merging branches. Enforces Conventional Commits." |
| "Database tool" | "Use when generating, reviewing, or executing SQL migrations. Handles schema validation and rollback planning." |

Include:
- **Triggers**: "Use when...", "Trigger if..."
- **Symptoms**: Observable states that indicate need
- **Keywords**: Terms users might type

## Loading Behavior

### Three-Stage Progressive Disclosure

| Stage | What Loads | When |
|-------|------------|------|
| 1 | Frontmatter only | Session initialization (all skills) |
| 2 | SKILL.md body | When skill is triggered |
| 3 | Reference files | When explicitly needed |

### Context Economy

- Frontmatter is **always** in context (keep descriptions concise)
- Body loads **on-demand** (can be detailed)
- References load **only when requested** (can be extensive)

## Directory Structure

```
{skill-name}/
├── SKILL.md              # Entry point (required)
├── references/           # Supporting documentation
│   ├── patterns.md
│   └── examples.md
└── scripts/              # Executable tools
    └── helper.py
```

### Factorization Rules

1. **One level deep** — Link directly from SKILL.md; avoid A→B→C chains
2. **Separate policy from execution** — Markdown for instructions, scripts for logic
3. **Keep references focused** — Each file should be independently useful

## Body Structure

```markdown
# Skill Title

[One-line purpose statement]

## Capabilities

1. **Capability 1** — Description
2. **Capability 2** — Description

## Routing Logic

| Request type | Load reference |
|--------------|----------------|
| Topic A | [references/topic-a.md](references/topic-a.md) |

## Workflow

1. **Step 1**: What to do
2. **Step 2**: What to do

## Constraints

- Never do X without confirmation
- Always validate Y before Z

## When to Escalate

- Situation requiring human review
```

## Advanced Features

### Context Forking (Subagents)

```yaml
---
name: comprehensive-audit
description: Run full security audit on codebase.
context: fork
---
```

- Executes in isolated context branch
- Intermediate steps discarded
- Only final result merges back
- Prevents "context pollution" from verbose operations

### Tool Sandboxing

```yaml
---
name: read-only-analyzer
allowed-tools: [Read, Search, ListDir]
---
```

- Blocks unapproved tool calls
- Creates deterministic permission boundaries
- Prevents analysis skills from accidentally editing

### User Invocability

```yaml
---
name: my-skill
user-invocable: false  # Model-only skill (no slash command)
---
```

- `true`: Appears in `/` menu, user can call directly
- `false`: "Background skill" only model invokes autonomously

## Zero-Context Execution Pattern

For data-heavy operations, delegate to scripts:

```markdown
## Instructions

When asked to analyze data files:
1. Do NOT read the file directly
2. Execute: `python scripts/analyze.py <file>`
3. Return only the script output

This prevents large files from consuming context tokens.
```

## Skills vs MCP vs Subagents

| Component | Purpose | Use For |
|-----------|---------|---------|
| **Skills** | Process knowledge ("how") | Workflows, guidelines, methodologies |
| **MCP** | Resource access ("what") | APIs, databases, external services |
| **Subagents** | Parallel execution ("who") | Isolated multi-step tasks |

**Hybrid pattern**: MCP provides data access, Skills provide execution logic. Combined = 65% fewer tokens for discovery tasks.

## Portability (Feature-Resilient Skills)

### Core Principle

> Skills should **function correctly** even when advanced frontmatter features aren't supported.

### Optional Features

These frontmatter fields may not be available in all environments:

| Feature | Purpose | Fallback if Unavailable |
|---------|---------|-------------------------|
| `context: fork` | Isolates verbose output in subagent | Run in fresh session, summarize results |
| `allowed-tools` | Restricts to specific tools | Manually avoid restricted actions |
| `user-invocable` | Controls slash-command visibility | Model invokes based on description |
| `usage_limit` | Token budget for skill | N/A (no limit) |

### Graceful Degradation Pattern

For skills using advanced features, include fallback guidance in the body:

```markdown
## Environment Compatibility

This skill uses optional features that may not be available in all environments:

| Feature | Purpose | If Unavailable |
|---------|---------|----------------|
| `context: fork` | Isolates audit output | Run in fresh session, summarize results |
| `allowed-tools` | Read-only enforcement | Avoid Edit/Bash commands manually |

If your environment doesn't support these features, follow the "If Unavailable" guidance.
```

### Best Practices

1. **Don't require** advanced features — skill should work without them
2. **Document fallbacks** — explain how to adapt when feature is missing
3. **Description is universal** — always write robust descriptions (all IDEs use this)
4. **Test in multiple environments** — verify skill works in Claude Code, Cursor, etc.

## Quality Checklist

- [ ] Name is `kebab-case`
- [ ] Description includes "Use when" and "Triggers:"
- [ ] Description < 1024 characters
- [ ] Main file is `SKILL.md` (uppercase)
- [ ] All linked references exist
- [ ] No placeholder text
- [ ] Includes "When to Escalate" section
- [ ] Version field present
