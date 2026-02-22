---
name: skill-manager
description: >
  Create, maintain, and validate Claude skills. Covers skill structure, naming
  conventions, routing tables, reference files, and automated quality checks.
  Use when creating new skills, auditing existing skills, or fixing lint errors.
version: "2.2.0"
triggers:
  - create skill
  - new skill
  - skill lint
  - audit skills
  - skill template
  - skill-manager
  - SKILL.md
  - skill best practices
portable: true
---

# Skill Manager

Expert guidance for creating, maintaining, and validating Claude skills across projects.

## Capabilities

1. **Create Skills** — Generate new skills with proper structure and metadata
2. **Lint Skills** — Automated validation against 17 quality rules
3. **Maintain Skills** — Update, refactor, and organize existing skills
4. **Distributed Architecture** — Manage skills across multiple repositories

## Quick Commands

```bash
# Lint all skills (auto-discovers .claude/skills)
lush skill lint

# Lint single skill
lush skill lint .claude/skills/problem-solver

# JSON output for agents/CI
lush skill lint --agent

# Strict mode (warnings = errors)
lush skill lint --strict
```

Via MCP: `lush-dev skill-lint` action.

## Routing Logic

| Request type | Load reference |
|--------------|----------------|
| SKILL.md format, frontmatter syntax | [references/format.md](references/format.md) |
| Routing tables, progressive loading | [references/routing.md](references/routing.md) |
| Description writing, trigger keywords | [references/descriptions.md](references/descriptions.md) |
| Reference file organization | [references/reference-files.md](references/reference-files.md) |
| Skill architecture, folder structure | [references/architecture.md](references/architecture.md) |
| Multi-repo skill distribution | [references/distributed-skills.md](references/distributed-skills.md) |
| Linter rules and fixes | [references/linter-rules.md](references/linter-rules.md) |
| Full technical specification | [references/skills-specification.md](references/skills-specification.md) |

## Core Principles

### 1. Progressive Loading

Skills load content in stages to optimize context:
- **Stage 1:** Name + description + triggers (always loaded, used for routing)
- **Stage 2:** SKILL.md body (when skill is selected)
- **Stage 3:** References (only when explicitly needed)

Design for minimal initial context, with deep references on-demand.

### 2. Distributed Architecture

> **Product-specific skills live with their product; general skills live in a shared location.**

```
shared-skills/.claude/skills/     # General (cross-project)
├── problem-solver/
├── researcher/
└── accessibility/

project-a/.claude/skills/         # Project A specific
└── domain-logic/

project-b/.claude/skills/         # Project B specific
└── data-pipeline/
```

### 3. Naming Convention

| Pattern | Example | Rule |
|---------|---------|------|
| Lowercase | `problem-solver` | Required |
| Hyphenated | `skill-manager` | Required |
| No suffixes | `accessibility` (not `accessibility-expert`) | Preferred |
| Descriptive | `testing` (not `test-writer`) | Preferred |

### 4. Quality Gates

Run linter before committing any skill changes:
```bash
lush skill lint --strict
```

## Create a New Skill

### Step 1: Choose Location

- **General skill** (applies to multiple projects) → Shared skills directory
- **Product-specific** (only for one project) → `{project}/.claude/skills/`

### Step 2: Create Structure

```
{skills-dir}/{skill-name}/
├── SKILL.md              # Required: Main skill file
└── references/           # Optional: Supporting documents
    └── {topic}.md
```

### Step 3: Use Template

Copy from `templates/skill.template.md` and fill in:
- `name:` — Lowercase-hyphenated identifier
- `description:` — What it does and when to use it
- `version:` — Start at "1.0.0"
- `triggers:` — Keywords for routing (array format)

### Step 4: Validate

```bash
lush skill lint .claude/skills/{skill-name}
```

## Frontmatter Reference

### Required Fields

```yaml
name: skill-name
description: >
  What this skill does.
  Use when building X.
version: "1.0.0"
triggers:
  - keyword1
  - keyword2
```

### Optional Fields

```yaml
portable: true            # Skill used across projects
context: fork             # Isolate in subagent
user-invocable: true      # Show in slash-command menu
allowed-tools:            # Restrict tool access
  - Read
  - Grep
```

## Linter Rules Summary

| ID | Severity | Rule |
|----|----------|------|
| SK001 | Error | Frontmatter required |
| SK002 | Error | `name:` field required |
| SK003 | Error | `description:` field required |
| SK004 | Warning | Name must be lowercase-hyphenated |
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
