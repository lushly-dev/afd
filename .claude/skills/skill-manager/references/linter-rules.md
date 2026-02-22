# Skill Linter Rules

The `skill-lint.mjs` script validates skills against these rules.

## Running the Linter

```bash
# Single skill
node scripts/skill-lint.mjs ../convex

# All skills in directory
node scripts/skill-lint.mjs ..

# JSON output for CI
node scripts/skill-lint.mjs .. --format json

# Strict mode (warnings = errors)
node scripts/skill-lint.mjs .. --strict
```

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

## Warning Rules (should fix)

### SK004: Name Format
Names must be lowercase-hyphenated: `^[a-z][a-z0-9-]*$`

```yaml
# Bad
name: Skill_Name
name: skillName
name: SKILL-NAME

# Good
name: skill-name
```

---

### SK005: Description Length
Descriptions should be under 1024 characters.

**Fix:** Move detailed content to the body or references.

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

### Required Fields

```yaml
name: skill-name          # Lowercase-hyphenated
description: >            # What it does, when to use
  Description here.
version: "1.0.0"          # Semantic version
triggers:                 # Keywords for routing
  - keyword1
  - keyword2
```

### Optional Fields

```yaml
portable: true            # Skill used across projects (enables SK011)
context: fork             # Isolate in subagent (Claude Code 2.0+)
user-invocable: true      # Show in slash-command menu
allowed-tools:            # Restrict tool access
  - Read
  - Grep
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (no errors, warnings OK) |
| 1 | Failure (errors found, or warnings in --strict mode) |
