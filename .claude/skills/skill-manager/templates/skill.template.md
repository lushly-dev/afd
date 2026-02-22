---
name: {skill-name}
description: >
  {What this skill does}. {What content it covers}.
  Use when {scenarios}.
version: "1.0.0"
triggers:
  - {keyword1}
  - {keyword2}
  - {keyword3}
# portable: true  # Uncomment if this skill is used across multiple projects
---

# {Skill Title}

{One-line description of the skill's purpose.}

## Capabilities

1. **{Capability 1}** — {Brief description}
2. **{Capability 2}** — {Brief description}

<!-- ============================================================
     OPTIONAL SECTIONS BELOW
     Delete sections that don't apply to your skill.
     See guidance at end of template for when to include each.
     ============================================================ -->

## Routing Logic

| Request type | Load reference |
|--------------|----------------|
| {Topic 1} | [references/{topic1}.md](references/{topic1}.md) |
| {Topic 2} | [references/{topic2}.md](references/{topic2}.md) |

## Core Principles

### 1. {Principle Name}

{Description of the principle and why it matters.}

### 2. {Principle Name}

{Description of the principle and why it matters.}

## Quick Reference

```{language}
// Example code or commands
```

## Workflow

1. **{Step 1}**: {What to do}
2. **{Step 2}**: {What to do}
3. **{Step 3}**: {What to do}

## Checklist

- [ ] {Check item 1}
- [ ] {Check item 2}
- [ ] {Check item 3}

## When to Escalate

- {Situation requiring human review}
- {Edge case not covered by this skill}

<!-- ============================================================
     SECTION GUIDANCE

     Required:
     - Frontmatter (name, description, version, triggers)
     - H1 title + one-line description
     - Capabilities (at least one)

     Include Routing Logic when:
     - Skill has reference files in references/ folder
     - Skill covers multiple distinct topics

     Include Core Principles when:
     - Skill has non-obvious patterns or philosophy
     - There are important "why" explanations

     Include Quick Reference when:
     - Skill has common commands, syntax, or patterns
     - Users need fast lookup of key information

     Include Workflow when:
     - Skill involves multi-step processes
     - Order of operations matters

     Include Checklist when:
     - Skill has verification steps
     - Quality gates need checking

     Include When to Escalate when:
     - Skill involves judgment calls
     - There are edge cases not covered
     - Human review may be needed

     Include portable: true when:
     - Skill is used across multiple projects
     - Skill is distributed via shared skills directory
     ============================================================ -->
