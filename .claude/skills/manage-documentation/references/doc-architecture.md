# Documentation Architecture

Detailed guidance on structuring documentation across a project or multi-repo setup.

## Documentation Layers

| Layer | File | Purpose | Target Size | Primary Audience |
|-------|------|---------|-------------|------------------|
| Agent instructions | AGENTS.md | Canonical agent file | ~150 lines | All AI tools |
| Human onboarding | README.md | Project intro, install, quick start | ~200 lines | Developers |
| Version history | Per-implementation changelogs; root CHANGELOG.md index | Track-specific release notes | Scales with releases | Users + devs |
| Forward-looking | ROADMAP.md | Phase-based project direction | Scales with scope | Stakeholders |
| Deep knowledge | .claude/skills/ | All detailed docs and patterns | Unlimited | AI agents + devs |
| Browsable | docs/guide/ | Docsify site generated from skills | Auto-generated | Anyone |

## Document Audience Matrix

| Document | Primary Audience | Secondary Audience | Key Principle |
|----------|-----------------|-------------------|---------------|
| AGENTS.md | AI agents (all tools) | Developers | Canonical agent instructions |
| README.md | Developers | AI agents | Self-contained quick start |
| Track changelogs | Users + developers | Release managers | Independent versions; root CHANGELOG.md links to each track |
| ROADMAP.md | Stakeholders | Contributors | Aspirational, not commitment |
| Skills | AI agents | Developers | Deep topic guidance |

## When to Create a Skill

Create a new skill when:
- Topic has more than 20 lines of content
- Topic will be referenced multiple times
- Topic needs examples or code blocks
- Topic is a distinct domain (testing, security, etc.)

## When to Keep in Bootstrap Files

Keep content in AGENTS.md when:
- MCP tool table (one-liner descriptions only)
- Quick command reference (5-10 most common commands)
- Skill index with brief descriptions
- Environment variables list
- Cross-repo skill links

## Drive-to-Skills Principle

If a section in AGENTS.md or README.md exceeds ~10 lines of guidance on a single topic:

1. Trim to a 2-3 sentence summary
2. Add a link: `See the skill-name skill for details.`
3. Move the deep content into the skill (or confirm it's already there)

**Exceptions:**
- CHANGELOG.md -- version history is inherently unique; no extraction needed
- ROADMAP.md -- forward-looking; not guidance content
- README.md -- must be self-contained quick start but still links to skills for depth

## Cross-Repository Pattern

For multi-repo setups:

1. **Central repo** -- shared skills live here (skill-manager, doc-management)
2. **Other repos** -- project-specific skills only
3. **AGENTS.md linking** -- canonical AGENTS.md can reference other repos' skills; never generate alternate instruction files

```markdown
## Cross-Repo Skills
When working in other repos, load their skills:
- ProjectB: `../ProjectB/.claude/skills/project-b/`
```

## Category Organization

Skills should include a `category` field in frontmatter:

```yaml
category: core        # Fundamental skills (doc-management, skill-manager)
category: development # Development workflows (testing, spec-writer)
category: review      # Code/content review (security, reviewer, duplicates)
category: quality     # Quality attributes (performance, accessibility)
```
