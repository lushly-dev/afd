# Distributed Skills Architecture

Skills should be located based on their scope and applicability. The Agent Skills open standard defines a 4-level scope hierarchy, plus extension points for custom directories and auto-discovery.

## Scope Hierarchy

Skills are organized into four scopes, listed from highest to lowest priority:

| Scope | Location | Managed by | Example use |
|-------|----------|------------|-------------|
| **Enterprise** | Organization-managed directory | IT / platform team | Company coding standards, compliance rules |
| **Personal** | `~/.claude/skills/` | Individual developer | Personal workflow preferences, custom patterns |
| **Project** | `.claude/skills/` in project root | Project team | Domain knowledge, product-specific patterns |
| **Plugin** | Installed packages / extensions | Package authors | Framework skills bundled with libraries |

Higher-priority scopes override lower ones when skill names collide. For example, a project skill named `testing` overrides a personal skill with the same name.

### Enterprise Skills

Organization-managed skills distributed to all developers. These have the highest priority so that org-wide policies (security, compliance, coding standards) cannot be overridden by lower scopes.

### Personal Skills

User-level skills stored in the home directory:

```
~/.claude/skills/
├── my-workflow/        # Personal development workflow
├── review-style/       # Preferred code review approach
└── shortcuts/          # Custom command shortcuts
```

These apply to every project the user works on, making them ideal for personal preferences and cross-project patterns.

### Project Skills

Skills co-located with the project source code:

```
my-project/.claude/skills/
├── domain/             # Project domain knowledge
├── api-client/         # API patterns specific to this project
└── data-pipeline/      # Data processing patterns
```

### Plugin Skills

Skills bundled with installed packages or IDE extensions. These have the lowest priority and act as sensible defaults that any scope above can override.

## Additional Skill Directories

Beyond the four standard scopes, tools can register additional directories with `--add-dir`:

```bash
claude --add-dir /path/to/shared-skills/.claude/skills
```

This is useful for monorepo shared skills or team-level skill libraries that don't fit the enterprise distribution model:

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

Added directories resolve after project skills but before plugin skills.

## Nested Auto-Discovery

Tools auto-discover `.claude/skills/` directories nested within a project. This enables monorepos where each sub-project contributes its own skills:

```
monorepo/
├── .claude/skills/           # Root-level shared skills
│   └── shared-patterns/
├── packages/
│   ├── server/.claude/skills/
│   │   └── server-patterns/  # Auto-discovered
│   └── client/.claude/skills/
│       └── client-patterns/  # Auto-discovered
```

All discovered skills merge into the project scope. When names collide within the same scope, the more deeply nested skill wins.

## Skill vs. Command Namespace

When a skill and a slash command share the same name, the **skill takes precedence**. This means:

- `/my-tool` as a skill → invokes the skill
- `/my-tool` as a command (no matching skill) → invokes the command

To avoid confusion, use distinct names. If intentional overlap is needed, the skill can reference the command internally.

## Placement Rules

### General Skills → Shared Repository

Skills that apply across multiple projects live in a shared skills repository (loaded via `--add-dir` or a workspace-level `.claude/skills/`):

**Criteria for shared placement:**
- Used by 2+ projects
- Technology-agnostic or broadly applicable
- Contains general methodology (not product logic)

### Product-Specific Skills → Project Repos

Skills tightly coupled to a specific product live with that product:

**Criteria for project-specific placement:**
- Only used by one project
- Contains product-specific domain knowledge
- Would confuse agents if loaded for other projects

## Resolution Priority

When an agent encounters a request, skills resolve in scope order:

1. **Enterprise** (organization-managed, highest priority)
2. **Personal** (`~/.claude/skills/`)
3. **Project** (`.claude/skills/` in project root, including nested auto-discovered)
4. **Added directories** (via `--add-dir`)
5. **Plugin** (installed packages / extensions)
6. **AGENTS.md / CLAUDE.md** guidance (fallback documentation)

Within the same scope, more specific matches (deeper nesting, exact name match) take priority. Project-specific skills can **override** general patterns when needed, and enterprise skills enforce organization-wide policies that cannot be bypassed.

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
2. [ ] Update all references in CLAUDE.md / AGENTS.md files
3. [ ] Run linter on both source and destination
4. [ ] Verify skill discovery still works in IDE
5. [ ] Update any documentation pointing to old location
6. [ ] Confirm scope priority hasn't changed unintentionally
