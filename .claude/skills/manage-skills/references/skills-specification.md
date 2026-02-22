# Agent Skills Specification

Technical specification for the Agent Skills format, based on the [agentskills.io](https://agentskills.io) open standard with Claude Code extensions.

## SKILL.md Format

### Frontmatter

```yaml
---
name: skill-name              # kebab-case, unique identifier
description: >                # Critical for routing — see Description Rules below
  Brief description of what this skill does.
  Use when [specific scenarios].
  Triggers: [keyword1], [keyword2], [keyword3].
---
```

### Open Standard vs Extension Fields

Fields come from two sources: the **agentskills.io open standard** (portable across IDEs) and **Claude Code extensions** (Claude-specific features).

| Field | Source | Required | Type | Purpose |
|-------|--------|----------|------|---------|
| `name` | Open standard | **Yes** | string | Kebab-case unique identifier. Must match parent directory name. |
| `description` | Open standard | **Yes** | string | Routing trigger — agent uses this to decide when to load the skill. |
| `license` | Open standard | No | string | SPDX license identifier (e.g., `MIT`, `Apache-2.0`) |
| `compatibility` | Open standard | No | array | Target runtimes (e.g., `["claude-code", "cursor"]`) |
| `metadata` | Open standard | No | object | Arbitrary key-value pairs for tooling |
| `allowed-tools` | Open standard | No | array | Restrict available tools (e.g., `[Read, Search, ListDir]`) |
| `version` | Claude Code | No | string | Semantic version (e.g., `"1.2.0"`) |
| `triggers` | Claude Code | No | array | Explicit trigger keywords (supplements description) |
| `portable` | Claude Code | No | boolean | Skill works across IDEs without modification |
| `context` | Claude Code | No | string | Set to `fork` for isolated subagent execution |
| `user-invocable` | Claude Code | No | boolean | If `true`, appears in slash-command menu (default: `true`) |
| `disable-model-invocation` | Claude Code | No | boolean | If `true`, model cannot auto-invoke (default: `false`) |
| `agent` | Claude Code | No | string | Agent mode to use when executing this skill |
| `model` | Claude Code | No | string | Model override for this skill's execution |
| `argument-hint` | Claude Code | No | string | Placeholder text shown in the slash-command input |
| `hooks` | Claude Code | No | array | Lifecycle hooks triggered by tool events |

### Description Field Rules

The `description` is the **routing trigger** — the agent uses this to decide when to load the skill.

| Bad | Good |
|-----|------|
| "Helps with git" | "Use when creating pull requests, reviewing diffs, or merging branches. Enforces Conventional Commits." |
| "Database tool" | "Use when generating, reviewing, or executing SQL migrations. Handles schema validation and rollback planning." |

Include:
- **Triggers**: "Use when...", "Trigger if..."
- **Symptoms**: Observable states that indicate need
- **Keywords**: Terms users might type

### Invocation Control Matrix

Two fields control how a skill can be activated:

| Setting | Slash menu | Model auto-invokes | In model context |
|---------|-----------|-------------------|-----------------|
| Default (both true) | Yes | Yes | Yes |
| `user-invocable: false` | No | Yes | Yes |
| `disable-model-invocation: true` | Yes | No | No |
| Both false / true | No | No | No |

Examples:

```yaml
# Background skill — model-only, no slash command
user-invocable: false

# Manual-only skill — user must invoke, model won't auto-select
disable-model-invocation: true

# With argument hint for slash command input
user-invocable: true
argument-hint: "path/to/file or component name"
```

## Loading Behavior

### Three-Stage Progressive Disclosure

| Stage | What Loads | When | Token Budget |
|-------|------------|------|-------------|
| 1 | Frontmatter only | Session initialization (all skills) | ~50–100 tokens per skill |
| 2 | SKILL.md body | When skill is triggered | ~500–2000 tokens |
| 3 | Reference files | When explicitly needed | Unbounded (load selectively) |

### Context Economy

- Frontmatter is **always** in context — keep descriptions concise (<1024 chars)
- Body loads **on-demand** — can be detailed but aim for <300 lines
- References load **only when requested** — can be extensive, load one at a time

## Directory Structure

```
{skill-name}/
├── SKILL.md              # Entry point (required)
├── references/           # Supporting documentation
│   ├── patterns.md
│   ├── examples.md
│   └── hooks.md
├── scripts/              # Deterministic executables
│   ├── lint.py
│   └── validate.sh
├── hooks/                # Lifecycle hook scripts
│   └── guard.sh
└── assets/               # Templates, configs, static files
    └── template.yaml
```

### Factorization Rules

1. **One level deep** — Link directly from SKILL.md; avoid A→B→C chains
2. **Separate policy from execution** — Markdown for instructions, scripts for logic
3. **Keep references focused** — Each file should be independently useful
4. **Scripts for determinism** — Anything with a correct answer belongs in a script, not prose

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

## String Substitutions

Skills support variable substitution in the body text:

| Variable | Resolves to |
|----------|-------------|
| `$ARGUMENTS` | Full argument string passed after the skill name |
| `$ARGUMENTS[N]` or `$N` | Nth argument, 0-indexed |
| `${CLAUDE_SESSION_ID}` | Current session identifier |

Example:

```markdown
## Workflow

Analyze the file at `$ARGUMENTS[0]` for security vulnerabilities.
If no file is provided (`$ARGUMENTS` is empty), ask the user.
```

## Dynamic Context Injection

Use the `` !`command` `` syntax in the skill body to inject live output at load time:

```markdown
## Current State

Git status:
!`git status --short`

Active branch:
!`git branch --show-current`
```

The command runs when the skill body loads, and its stdout replaces the `` !`...` `` line. Use this for small, fast commands that provide situational context. Avoid long-running or side-effectful commands.

## Hooks in Skills

Skills can define lifecycle hooks that run scripts in response to tool events. Hooks enable guardrails, validation, and automated checks without LLM reasoning overhead.

```yaml
hooks:
  - event: PreToolUse
    matcher: Write
    command: "${CLAUDE_PLUGIN_ROOT}/hooks/guard.sh"
  - event: PostToolUse
    matcher: Bash
    command: "${CLAUDE_PLUGIN_ROOT}/hooks/validate.sh"
```

There are **17 hook events** across three categories:

| Category | Events |
|----------|--------|
| Tool lifecycle | `PreToolUse`, `PostToolUse` |
| Notifications | `Stop`, `SubagentStop` |
| Session | `PreCompact`, `PostCompact`, and others |

Hook scripts receive JSON on stdin with event details and must return JSON on stdout:

```json
{ "decision": "allow" }
```

Or to block:

```json
{ "decision": "deny", "reason": "File is in protected directory" }
```

See [references/hooks.md](references/hooks.md) for the full hook event list, matcher patterns, and implementation examples.

## Deterministic Offloading

> Never rely on the LLM for deterministic work.

If a task has a provably correct answer that can be computed, it belongs in a script — not in the skill body as instructions for the model.

| Task | Approach |
|------|----------|
| Regex matching, string parsing | Script |
| API pagination | Script |
| Math calculations | Script |
| Data transformation (CSV→JSON, etc.) | Script |
| File tree enumeration | Script |
| Schema validation | Script |

Pattern in skill body:

```markdown
## Lint Check

Do not attempt to lint files yourself. Run the linter and read the output:

\`\`\`bash
python ${SKILL_DIR}/scripts/lint.py $ARGUMENTS[0]
\`\`\`

Interpret the results and suggest fixes based on the output.
```

See [references/resource-scripts.md](references/resource-scripts.md) for full patterns.

### Resource Script I/O Rules

Scripts called from skills must follow strict I/O conventions:

**stdout** — Clean Markdown or JSON only. No ANSI escape codes, no spinners, no progress bars, no color sequences. The model reads this directly.

**stderr** — Recovery instructions for the AI, not just error messages. Include what to try next.

```python
# Good stderr
sys.stderr.write("Error: config.yaml not found at project root.\n")
sys.stderr.write("Try: Check if the file exists with a different extension (.yml).\n")
sys.stderr.write("Try: Run 'init' command to generate a default config.\n")

# Bad stderr
sys.stderr.write("ERROR!!!\n")
```

**The handoff pattern** — Skills should explicitly delegate:

```markdown
Do not attempt validation yourself. Run:
\`\`\`bash
python ${SKILL_DIR}/scripts/validate.py $ARGUMENTS[0]
\`\`\`
Read the output and report findings to the user.
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

- `true` (default): Appears in `/` menu, user can call directly
- `false`: "Background skill" — only model invokes autonomously

### Agent and Model Overrides

```yaml
---
name: deep-analysis
agent: code-review        # Use a specific agent mode
model: claude-opus-4      # Override model for this skill
---
```

- `agent`: Routes execution to a named agent configuration
- `model`: Forces a specific model regardless of session default

## Skills vs MCP vs Subagents

| Component | Purpose | Use For | Example |
|-----------|---------|---------|---------|
| **Skills** | Process knowledge ("how") | Workflows, guidelines, methodologies | Code review checklist, deployment procedure |
| **MCP** | Resource access ("what") | APIs, databases, external services | Fetch GitHub issues, query a knowledge base |
| **Subagents** | Parallel execution ("who") | Isolated multi-step tasks | Audit 5 packages simultaneously |

### When to combine

- **Skill + MCP**: Skill defines the review workflow, MCP provides the data. The skill says *how* to review; MCP says *what* to review.
- **Skill + Subagent**: Skill defines the audit procedure, `context: fork` runs it in isolation so verbose output doesn't pollute the main conversation.
- **Skill + Script**: Skill defines the decision logic, scripts handle the deterministic computation. The skill says *when* and *why*; the script does the *what*.

## Portability (Feature-Resilient Skills)

### Core Principle

> Skills should **function correctly** even when advanced frontmatter features aren't supported.

### Portability Tiers

| Feature | Portable | Fallback if Unavailable |
|---------|----------|-------------------------|
| `name` + `description` | Universal | — |
| `allowed-tools` | Open standard | Manually avoid restricted actions |
| `context: fork` | Claude Code | Run in fresh session, summarize results |
| `user-invocable` | Claude Code | Model invokes based on description |
| `disable-model-invocation` | Claude Code | User must manage invocation manually |
| `hooks` | Claude Code | Run checks manually or via scripts |
| `agent` / `model` | Claude Code | Uses session defaults |
| `argument-hint` | Claude Code | No placeholder shown |

### Best Practices

1. **Don't require** extension fields — skill should work with just `name` + `description`
2. **Document fallbacks** — explain how to adapt when a feature is missing
3. **Description is universal** — always write robust descriptions (all IDEs use this)
4. **Test in multiple environments** — verify skill works in Claude Code, Cursor, Windsurf, etc.
5. **Mark portable skills** — set `portable: true` if the skill uses no Claude Code extensions

## Quality Checklist

- [ ] Name is `kebab-case` with no consecutive hyphens
- [ ] Name matches parent directory name
- [ ] Description includes "Use when" and "Triggers:"
- [ ] Description < 1024 characters
- [ ] Main file is `SKILL.md` (uppercase)
- [ ] All linked references exist
- [ ] No placeholder text
- [ ] Includes "When to Escalate" section
- [ ] Version field present
- [ ] Hooks tested with exit code semantics (0 = allow, non-zero = deny)
- [ ] Resource scripts produce clean stdout (no ANSI codes, no spinners)
- [ ] Resource scripts write recovery hints to stderr on failure
