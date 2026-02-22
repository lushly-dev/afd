# Skill Linter Rules

Rules for validating agent skills. These align with the [Agent Skills open standard](https://agentskills.io) where noted.

## Running the Linter

Each repository provides its own CLI or MCP server that includes the skill linter. Check your repo's **AGENTS.md** for the exact command — it will be listed under development or quality commands.

Common patterns across repos:

```bash
# Lint a single skill
<repo-cli> skill-lint .claude/skills/my-skill

# Lint all skills
<repo-cli> skill-lint .claude/skills

# JSON output for CI
<repo-cli> skill-lint .claude/skills --format json
```

Replace `<repo-cli>` with your repo's CLI (e.g., `lushx dev`, `proto dev`, `libbot`, `fabux`).

## Error Rules (must fix)

### SK001: Frontmatter Required
SKILL.md must start with YAML frontmatter delimited by `---`.

```yaml
---
name: my-skill
description: What this skill does.
---
```

**Fix:** Add frontmatter block at the top of the file.

---

### SK002: Name Required
The `name:` field is required in frontmatter.

**Fix:** Add `name: skill-name` to frontmatter.

---

### SK003: Description Required
The `description:` field is required in frontmatter.

**Fix:** Add `description: What this skill does. Use when [scenarios].`

---

### SK008: Reference Must Exist
All files linked in the skill body must exist.

```markdown
# Bad - file doesn't exist
See [patterns.md](references/patterns.md)
```

**Fix:** Create the missing file or correct the link path.

---

### SK010: Placeholder Text
No `{placeholder}` style text should remain in production skills.

```markdown
# Bad
{What this skill does}. Use when {scenarios}.

# Good
Validate component accessibility. Use when building interactive UI.
```

**Fix:** Replace all placeholders with actual content.

---

### SK015: Duplicate Name
Each skill must have a unique `name:` value across all skill directories.

**Fix:** Rename one of the conflicting skills.

---

### SK018: Name Must Match Directory
The `name:` field must exactly match the parent directory name.

```
# Bad — directory is "my-skill" but name differs
.claude/skills/my-skill/SKILL.md
---
name: my_skill   # ✗ doesn't match "my-skill"
---

# Good — name matches directory
.claude/skills/my-skill/SKILL.md
---
name: my-skill   # ✓ matches parent directory
---
```

**Fix:** Rename either the directory or the `name:` field so they match.

---

### SK019: No Consecutive Hyphens
The `name:` field must not contain consecutive hyphens (`--`).

```yaml
# Bad
name: my--skill
name: problem---solver

# Good
name: my-skill
name: problem-solver
```

**Fix:** Replace `--` (or longer runs) with a single `-`.

---

## Warning Rules (should fix)

### SK004: Name Format
Names must follow the Agent Skills open standard naming constraints:

- **Regex:** `^[a-z][a-z0-9](-?[a-z0-9])*$`
- **Must match the parent directory name** (e.g., `my-skill/SKILL.md` → `name: my-skill`)
- **No consecutive hyphens** (`my--skill` is invalid)
- **Max 64 characters**
- Must start with a lowercase letter
- Only lowercase letters, digits, and single hyphens allowed

```yaml
# Bad
name: Skill_Name       # uppercase, underscores
name: skillName        # camelCase
name: SKILL-NAME       # uppercase
name: my--skill        # consecutive hyphens
name: 1-skill          # starts with digit

# Good
name: skill-name
name: my-skill
name: problem-solver-v2
```

---

### SK005: Description Length
Descriptions must be under 1024 characters. This is a **hard limit** from the Agent Skills open standard, not a guideline.

Descriptions exceeding 1024 characters will be truncated by compliant tools, breaking routing and discovery.

**Fix:** Move detailed content to the body or `references/`. Keep the description focused on *what* and *when*.

---

### SK006: Triggers Missing
Skills must have triggers defined. Use either:

**Option A: Frontmatter array (preferred)**
```yaml
triggers:
  - convex
  - reactive database
  - vector search
```

**Option B: Inline in description (legacy)**
```yaml
description: >
  Build reactive backends. Use when building real-time apps.
  Triggers: convex, vector search.
```

---

### SK009: Body Too Long
SKILL.md body exceeds 800 lines, impacting context efficiency.

**Fix:** Move detailed content to `references/` subdirectory.

---

### SK011: BaseDir Usage (Portable Skills Only)
Only applies when `portable: true` is set in frontmatter.

Use `{baseDir}` for portable reference paths:

```markdown
# Hardcoded (fine for non-portable skills)
See [patterns.md](references/patterns.md)

# Portable (required when portable: true)
See [{baseDir}/references/patterns.md]({baseDir}/references/patterns.md)
```

---

### SK012: File Naming
Main skill file should be `SKILL.md` (uppercase) for visibility.

**Fix:** Rename `skill.md` to `SKILL.md`.

---

### SK014: Orphan References
Reference files in `references/` that aren't linked from SKILL.md.

**Fix:** Either link the file or remove it if unused.

---

## Info Rules (recommendations)

### SK007: Routing Table
Multi-topic skills benefit from routing tables.

```markdown
## Routing Logic

| Request type | Load reference |
|--------------|----------------|
| Topic A | [references/topic-a.md](references/topic-a.md) |
| Topic B | [references/topic-b.md](references/topic-b.md) |
```

---

### SK013: Version Recommended
Add `version: "1.0.0"` to track skill evolution.

---

### SK016: Escalation Section
Add a "When to Escalate" section for complex decisions.

```markdown
## When to Escalate

- Cross-team conflicts
- Breaking changes
- Novel patterns not covered
```

---

### SK017: Migrate Inline Triggers
Suggests migrating inline "Triggers:" to frontmatter `triggers:` array.

```yaml
# Before (legacy)
description: >
  Build apps. Triggers: convex, database.

# After (preferred)
description: >
  Build apps.
triggers:
  - convex
  - database
```

**Benefits:**
- Machine-parseable for routing
- Cleaner descriptions
- Easier to update

---

## Frontmatter Reference

### Open Standard Fields (agentskills.io)

These fields are defined by the [Agent Skills open standard](https://agentskills.io) and are portable across compliant tools.

```yaml
# --- Required ---
name: skill-name            # Max 64 chars, lowercase+hyphens, must match parent dir
description: >               # Max 1024 chars (hard limit). What it does, when to use.
  Description here.

# --- Optional ---
license: MIT                 # SPDX identifier, max 128 chars
compatibility: >             # Max 500 chars. Version/platform notes.
  Claude Code 2.x, VS Code Copilot, Cursor
metadata:                    # Key-value pairs. Max 10 keys, key max 64 chars, value max 256 chars.
  author: team-name
  domain: infrastructure
allowed-tools:               # Restrict tool access (experimental)
  - Read
  - Grep
```

### Claude Code Extension Fields

These fields are specific to Claude Code / VS Code Copilot and may not be recognized by other Agent Skills-compatible tools.

```yaml
version: "1.0.0"            # Semantic version — track skill evolution
triggers:                    # Keywords for routing (array format)
  - keyword1
  - keyword2
portable: true               # Skill used across projects (enables SK011)
context: fork                # Isolate in subagent (Claude Code 2.0+)
user-invocable: true         # Show in slash-command menu (default: true)
disable-model-invocation: true  # Boolean. User-only, removed from model context
agent: general-purpose       # Must be: Explore, Plan, general-purpose, or custom string
model: claude-sonnet         # Model identifier string — override model for this skill
argument-hint: "file path"   # String hint for argument placeholder in UI
hooks:                       # Array of hook objects — guardrails and janitors
  - event: PreToolUse        #   Required: event name (PreToolUse, PostToolUse, etc.)
    matcher: Write            #   Optional: tool/pattern filter
    command: "${CLAUDE_PLUGIN_ROOT}/hooks/check.sh"  # Required: command to run
```

### Validation Constraints

| Field | Constraint |
|-------|------------|
| `name` | Required. Max 64 chars. Regex: `^[a-z][a-z0-9](-?[a-z0-9])*$`. Must match parent directory. |
| `description` | Required. Max 1024 chars (hard limit, truncated by tools). |
| `license` | Optional. SPDX identifier, max 128 chars. |
| `compatibility` | Optional. Max 500 chars. |
| `metadata` | Optional. Max 10 keys. Key max 64 chars, value max 256 chars. |
| `hooks` | Optional. Array of objects. Each requires `event` (string) and `command` (string); `matcher` is optional. |
| `agent` | Optional. One of `Explore`, `Plan`, `general-purpose`, or a custom string. |
| `model` | Optional. Model identifier string. |
| `argument-hint` | Optional. String. |
| `disable-model-invocation` | Optional. Boolean (`true`/`false`). |
| `triggers` | Optional. Array of strings. |
| `version` | Optional. Semantic version string. |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (no errors, warnings OK) |
| 1 | Failure (errors found, or warnings in --strict mode) |
