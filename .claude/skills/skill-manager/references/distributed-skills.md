# Distributed Skills Architecture

Skills should be located based on their scope and applicability.

## Placement Rules

### General Skills → Shared Repository

Skills that apply across multiple projects live in a shared skills repository:

```
shared-skills/.claude/skills/
├── skill-manager/      # Meta-skill for skill management
├── problem-solver/     # General debugging methodology
├── researcher/         # Research and documentation
├── accessibility/      # WCAG compliance (applies everywhere)
├── security/           # Security patterns (applies everywhere)
├── performance/        # Core Web Vitals (applies everywhere)
└── testing/            # Test framework patterns
```

**Criteria for shared placement:**
- Used by 2+ projects
- Technology-agnostic or broadly applicable
- Contains general methodology (not product logic)

### Product-Specific Skills → Project Repos

Skills tightly coupled to a specific product live with that product:

```
project-a/.claude/skills/
└── domain/             # Project A domain knowledge

project-b/.claude/skills/
├── api-client/         # API patterns specific to Project B
└── data-pipeline/      # Data processing patterns
```

**Criteria for project-specific placement:**
- Only used by one project
- Contains product-specific domain knowledge
- Would confuse agents if loaded for other projects

## Resolution Priority

When Claude encounters a request, skills resolve in order:

1. **Project-local** (`.claude/skills/` in current repo)
2. **Shared skills** (common workspace skills)  
3. **CLAUDE.md** guidance (fallback documentation)

This means project-specific skills can **override** general patterns when needed.

## Cross-Referencing

Skills can reference other skills using relative paths:

```markdown
## Related Skills

- General debugging: See `../problem-solver/`
- Security patterns: See `../security/`
```

## Migration Checklist

When moving a skill between locations:

1. [ ] Update all references in source location's `_index.md`
2. [ ] Update all references in CLAUDE.md files
3. [ ] Run linter on both source and destination
4. [ ] Verify skill discovery still works in IDE
5. [ ] Update any documentation pointing to old location
