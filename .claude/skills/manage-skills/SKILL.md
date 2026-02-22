---
name: manage-skills
source: botcore
description: >
  Create, maintain, and validate agent skills following the Agent Skills open standard (agentskills.io). Covers SKILL.md format, frontmatter fields (open standard + Claude Code extensions), progressive disclosure, hooks, resource scripts, naming conventions, routing tables, and automated quality checks. Use when creating new skills, auditing existing skills, fixing lint errors, adding hooks to skills, or writing resource scripts for deterministic offloading. Triggers: create skill, new skill, skill lint, audit skills, SKILL.md, hooks, resource scripts, progressive disclosure, Agent Skills, open standard, skill architecture, deterministic offloading.

version: 3.0.0
triggers:
  - create skill
  - new skill
  - skill lint
  - audit skills
  - skill template
  - skill-manager
  - SKILL.md
  - skill best practices
  - hooks
  - resource scripts
  - progressive disclosure
  - Agent Skills
  - open standard
  - deterministic offloading
  - subagents
portable: true
---

# Skill Manager

Expert guidance for creating, maintaining, and validating agent skills across projects and platforms (Claude Code, VS Code Copilot, Copilot CLI, Cursor, and other Agent Skills-compatible tools).

## Capabilities

1. **Create Skills** — Generate new skills with proper structure and metadata
2. **Lint Skills** — Automated validation against quality rules
3. **Maintain Skills** — Update, refactor, and organize existing skills
4. **Distributed Architecture** — Manage skills across multiple repositories and scopes
5. **Hook Integration** — Add guardrail and janitor hooks to skills
6. **Resource Scripts** — Deterministic offloading for parsing, linting, and API calls

## Quick Commands

Each repo provides a skill linter via its own CLI or MCP server. Check your repo's **AGENTS.md** for the exact command.

```bash
# Typical patterns (replace <cli> with your repo's command)
<cli> skill-lint .claude/skills              # Lint all skills
<cli> skill-lint .claude/skills/my-skill     # Lint single skill
<cli> skill-lint .claude/skills --strict     # Warnings = errors
```

## Routing Logic

| Request type | Load reference |
|--------------|----------------|
| SKILL.md format, frontmatter syntax | [references/format.md](references/format.md) |
| Routing tables, progressive loading | [references/routing.md](references/routing.md) |
| Description writing, trigger keywords | [references/descriptions.md](references/descriptions.md) |
| Reference file organization | [references/reference-files.md](references/reference-files.md) |
| Skill architecture, folder structure | [references/architecture.md](references/architecture.md) |
| Multi-repo skill distribution, scopes | [references/distributed-skills.md](references/distributed-skills.md) |
| Linter rules and fixes | [references/linter-rules.md](references/linter-rules.md) |
| Full technical specification | [references/skills-specification.md](references/skills-specification.md) |
| Hook integration (guardrails, janitors) | [references/hooks.md](references/hooks.md) |
| Resource scripts, deterministic offloading | [references/resource-scripts.md](references/resource-scripts.md) |

## Core Principles

### 1. Progressive Disclosure (Three Stages)

Skills load content in stages to optimize context token usage:

| Stage | What loads | When | Budget |
|-------|-----------|------|--------|
| **Discovery** | Frontmatter only (name, description) | Session start — all skills | ~30 tokens per skill |
| **Brain** | SKILL.md body | When skill is triggered | < 500 lines |
| **Resources** | References, scripts, assets | When explicitly needed | No limit |

Design for minimal initial context, with deep references on-demand. The total description budget across all skills is ~2% of the context window (~16K chars fallback).

### 2. Distributed Architecture

> **Product-specific skills live with their product; general skills live in a shared location.**

Skills resolve by scope priority: Enterprise > Personal (`~/.claude/skills/`) > Project (`.claude/skills/`) > Plugin.

```
~/.claude/skills/                 # Personal (all projects)
├── problem-solver/
└── researcher/

project-a/.claude/skills/         # Project-specific
└── domain-logic/

project-b/.claude/skills/         # Project-specific
└── data-pipeline/
```

### 3. Naming Convention

| Pattern | Example | Rule |
|---------|---------|------|
| Lowercase + hyphens | `problem-solver` | Required (open standard) |
| Match parent directory | `manage-skills/SKILL.md` → `name: manage-skills` | Required |
| No consecutive hyphens | `my-skill` (not `my--skill`) | Required |
| Max 64 characters | — | Required |
| No suffixes | `accessibility` (not `accessibility-expert`) | Preferred |

### 4. Deterministic Offloading

> **Never rely on the LLM for deterministic work.** Use resource scripts for regex, parsing, math, API pagination, and data transformation.

Scripts output clean Markdown/JSON to stdout. Recovery instructions go to stderr for the AI.

### 5. Quality Gates

Run the skill linter before committing any skill changes (see AGENTS.md for your repo's command).

## Create a New Skill

### Step 1: Choose Location

- **General skill** (applies to multiple projects) → Shared skills directory
- **Product-specific** (only for one project) → `{project}/.claude/skills/`

### Step 2: Create Structure

```
{skills-dir}/{skill-name}/
├── SKILL.md              # Required: Main entry point
├── references/           # Optional: Deep-dive documents
│   └── {topic}.md
├── scripts/              # Optional: Deterministic helpers
│   └── {helper}.py
└── hooks/                # Optional: Guardrail/janitor hooks
    └── {hook}.sh
```

### Step 3: Use Template

Copy from `templates/skill.template.md` and fill in:
- `name:` — Must match the parent directory name
- `description:` — What it does and when to use it (max 1024 chars)
- `version:` — Start at "1.0.0"
- `triggers:` — Keywords for routing (array format)

### Step 4: Validate

Run the skill linter (see AGENTS.md for your repo's command) and fix any errors before committing.

## Frontmatter Reference

### Open Standard Fields (agentskills.io)

```yaml
name: skill-name            # Required. Max 64 chars, lowercase+hyphens, must match dir
description: >               # Required. Max 1024 chars. Routing trigger.
  What this skill does.
  Use when building X.
license: MIT                 # Optional. SPDX identifier
compatibility: >             # Optional. Max 500 chars. Version/platform notes
  Claude Code 2.x, VS Code Copilot, Cursor
metadata:                    # Optional. Key-value pairs
  author: team-name
allowed-tools:               # Optional (experimental). Restrict tool access
  - Read
  - Grep
```

### Claude Code Extension Fields

```yaml
version: "1.0.0"            # Track skill evolution
triggers:                    # Keywords for routing (array format)
  - keyword1
  - keyword2
portable: true               # Skill used across projects
context: fork                # Isolate in subagent
user-invocable: true         # Show in slash-command menu (default: true)
disable-model-invocation: true  # User-only, removed from model context
agent: general-purpose       # Agent type (Explore, Plan, general-purpose, custom)
model: claude-sonnet         # Override model for this skill
argument-hint: "file path"   # Hint for argument placeholder
hooks:                       # Inline hook definitions
  - event: PreToolUse
    matcher: Write
    command: "${CLAUDE_PLUGIN_ROOT}/hooks/check.sh"
```

## Linter Rules Summary

| ID | Severity | Rule |
|----|----------|------|
| SK001 | Error | Frontmatter required |
| SK002 | Error | `name:` field required |
| SK003 | Error | `description:` field required |
| SK004 | Warning | Name must be lowercase-hyphenated, match dir, no consecutive hyphens |
| SK005 | Warning | Description < 1024 chars |
| SK006 | Warning | Include triggers (frontmatter or inline) |
| SK008 | Error | Linked references must exist |
| SK010 | Error | No placeholder text |
| SK011 | Info | Use `{baseDir}` for portable skills |
| SK012 | Warning | Use `SKILL.md` (uppercase) |
| SK014 | Warning | No orphan reference files |
| SK015 | Error | No duplicate names |
| SK017 | Info | Migrate inline triggers to frontmatter |

Full list: [references/linter-rules.md](references/linter-rules.md)

## When to Escalate

- **Cross-team skill conflicts** — Skills with overlapping domains need governance review
- **Breaking changes** — Renaming or restructuring skills used by other projects
- **New patterns** — Novel skill capabilities not covered by existing guidance
- **Hook security** — Hooks that block tool execution need careful review
