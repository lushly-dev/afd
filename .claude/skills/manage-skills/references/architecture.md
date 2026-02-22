# Skill Architecture

Guidance for organizing skills, deciding skill boundaries, and structuring skill directories for optimal agent consumption.

## Skill Directory Structure

Every skill lives in its own directory under `.claude/skills/`. Only `SKILL.md` is required — everything else is optional.

```
{skill-name}/
├── SKILL.md              # Required: Entry point (< 500 lines)
├── references/           # Optional: Deep-dive documents
│   └── {topic}.md
├── scripts/              # Optional: Deterministic helpers
│   └── {helper}.py
├── hooks/                # Optional: Guardrail/janitor hooks
│   └── {hook}.sh
├── assets/               # Optional: Images, data files
└── templates/            # Optional: Boilerplate templates
```

| Directory | Purpose | Example contents |
|-----------|---------|-----------------|
| `references/` | Detailed knowledge the agent loads on demand | API specs, pattern catalogs, checklists |
| `scripts/` | Deterministic code the agent can execute | Linters, generators, validators |
| `hooks/` | Pre/post guardrails for quality gates | Pre-commit checks, post-edit verification |
| `assets/` | Static resources referenced by the skill | Diagrams, sample data, config files |
| `templates/` | Boilerplate the agent copies and fills in | Component scaffolds, doc templates |

## Progressive Disclosure and Token Budgets

Skills load in three stages to minimize context window usage:

| Stage | What loads | When | Token budget |
|-------|-----------|------|-------------|
| **Discovery** | Frontmatter only (`name`, `description`, `triggers`) | Session start (all skills) | ~30 tokens per skill |
| **Brain** | SKILL.md body | When a skill is triggered by name or context | < 500 lines (~5,000 tokens) |
| **Resources** | `references/`, `scripts/`, `hooks/` | When explicitly needed during execution | No hard limit |

**Total description budget** across all skills: ~2% of context window (~16K chars fallback).

### The 500 Line Rule

`SKILL.md` body must stay under **500 lines**. This is the content an agent loads into context every time the skill activates — bloated skills waste the token budget and dilute focus.

If your SKILL.md exceeds 500 lines:
1. Move detailed reference material to `references/`
2. Move examples and catalogs to `references/`
3. Keep only the workflow, rules, and routing table in the body

## Skill Location Hierarchy

Skills are resolved in this order (first match wins):

| Priority | Location | Scope |
|----------|----------|-------|
| 1 | Enterprise (organization-level) | All repos in the org |
| 2 | Personal (`~/.claude/skills/`) | All repos for one user |
| 3 | Project (`.claude/skills/`) | One repository |
| 4 | Plugin (via packages/extensions) | Installed extensions |

Nested `.claude/skills/` directories are auto-discovered — a monorepo can have skills at the root and within individual packages.

## XML Tagging in SKILL.md

Use XML tags in the SKILL.md body to help LLMs parse sections accurately:

```markdown
<context>
Background knowledge the agent needs before acting.
</context>

<rules>
Hard constraints that must always be followed.
</rules>

<workflow>
Step-by-step procedure for the agent to execute.
</workflow>

<examples>
Concrete input/output pairs showing correct behavior.
</examples>
```

Tags are optional but recommended for skills with complex structure. They prevent the agent from confusing rules with examples or context with workflow steps.

## Freedom Level

Choose the right constraint level for each skill based on the domain:

### Narrow Bridge

Strict sequential steps with exact expected outputs. Use for deterministic tasks where deviation causes errors.

```
✓ Linting / formatting
✓ Scaffold generation
✓ Migration scripts
✓ Commit message formatting
```

### Open Field

Heuristics and judgment guidelines. Use for creative or analytical tasks where rigid steps would be counterproductive.

```
✓ Code review
✓ Architecture decisions
✓ Content writing
✓ Bug investigation
```

Choose based on the domain — if a human expert would follow an exact checklist, use narrow bridge. If they'd apply judgment, use open field.

## Self-Verification Pattern

Every skill should include a mandatory verification step before the agent considers the task complete. This prevents "looks good to me" drift.

```markdown
## Verification (required)

Before completing, run:
1. `lush skill lint` — confirm zero errors
2. Check that all generated files exist at expected paths
3. Verify no placeholder text remains
```

Without self-verification, agents tend to declare success without confirming their output actually works.

## When to Create a New Skill

### Create Separate Skills When

- **Distinct domains** — Content design vs. component specs
- **Different audiences** — Developer docs vs. user-facing UI
- **Independent usage** — One skill useful without the other
- **Large scope** — Too much content for one skill

### Keep as One Skill When

- **Related content** — All aspects of content design
- **Shared principles** — Same underlying rules apply
- **Cross-referencing needed** — Topics frequently used together
- **Manageable size** — < 30-40 reference files

## Skill Sizing

### Too Small

```
❌ skill-button-labels/
❌ skill-error-messages/
❌ skill-tooltips/
```

**Problem:** Fragmented, hard to route, inefficient. Each activation burns discovery tokens for minimal payoff.

### Too Large

```
❌ skill-everything/
   └── references/ (100+ files)
```

**Problem:** SKILL.md exceeds 500 lines, slow loading, unfocused, hard to maintain.

### Right Size

```
✓ content-design/
   ├── SKILL.md (< 500 lines)
   └── references/
       ├── style/ (10 files)
       ├── patterns/ (15 files)
       ├── terminology/ (10 files)
       └── strategy/ (3 files)
```

**Sweet spot:** 20-40 reference files, clear domain boundary, SKILL.md under 500 lines.

## Organizing Multiple Skills

### Recommended Skill Breakdown

For a UX system:

```
.claude/skills/
├── content-design/       # UI text, style guide, terminology
├── component-specs/      # Component patterns, props, usage
├── accessibility/        # A11y guidelines, WCAG compliance
├── design-tokens/        # Colors, spacing, typography
└── skill-creation/       # Meta-skill for creating skills
```

### Naming Convention

- Use kebab-case
- Be descriptive but concise
- Reflect the domain, not the format

```
✓ content-design
✓ component-specs
✓ accessibility-guidelines

✗ content
✗ specs
✗ a11y
```

## Reference Organization

### Flat Structure

For small skills (< 10 references):

```
references/
├── grammar.md
├── punctuation.md
├── word-choice.md
└── capitalization.md
```

### Categorized Structure

For larger skills:

```
references/
├── style/
│   ├── grammar.md
│   └── punctuation.md
├── patterns/
│   ├── errors.md
│   └── empty-states.md
└── terminology/
    ├── power-bi.md
    └── fabric-core.md
```

### Deep Structure

For very large skills (use sparingly):

```
references/
├── style/
│   ├── mechanics/
│   │   ├── grammar.md
│   │   └── punctuation.md
│   └── voice/
│       ├── tone.md
│       └── word-choice.md
```

## Skill Interdependencies

### Acceptable

- Skills reference each other rarely
- Each skill works independently
- Shared concepts explained in each skill

### Problematic

- Skills require each other to function
- Circular dependencies
- Frequent cross-skill routing

### Solution for Shared Content

Create a `shared/` or `common/` folder within each skill that needs it, or create a dedicated shared skill:

```
.claude/skills/
├── fabric-common/        # Shared terminology, principles
├── content-design/       # References fabric-common
└── component-specs/      # References fabric-common
```

## Evolution Strategy

### Starting Out

1. Start with one skill
2. Add references as needed
3. Monitor for natural boundaries

### Growing

1. When skill exceeds ~40 references, evaluate split
2. When SKILL.md exceeds ~500 lines, extract to references
3. Look for distinct sub-domains
4. Split along natural boundaries

### Mature State

1. Stable set of 3-6 skills
2. Clear domain ownership
3. Regular reference updates
4. All SKILL.md files under 500 lines

## Skill Discovery

### Help Users Find Skills

In your repo README or AGENTS.md:

```markdown
## Available Skills

| Skill | Use for |
|-------|---------|
| content-design | UI text, error messages, terminology |
| component-specs | Component patterns, props, examples |
| accessibility | A11y guidelines, WCAG compliance |
```

### Skill Discoverability Checklist

- [ ] Description includes clear triggers
- [ ] Skill name is intuitive
- [ ] AGENTS.md lists available skills with trigger words
- [ ] Examples show when to use each skill
- [ ] SKILL.md body is under 500 lines
