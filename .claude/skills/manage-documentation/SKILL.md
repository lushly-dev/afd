---
name: manage-documentation
source: botcore
description: >
  Manages documentation architecture, review, staleness detection, and maintenance policy across project repositories. Covers README, AGENTS.md, CLAUDE.md, CHANGELOG, ROADMAP, doc sites, and skill indexing. Use when creating docs, reviewing documentation structure, auditing for staleness, updating changelogs, maintaining roadmaps, or enforcing documentation standards. Triggers: docs, documentation, readme, changelog, roadmap, agents.md, claude.md, doc site, docsify, update docs, sync docs, documentation audit, docs review.

version: 1.0.0
triggers:
  - docs
  - documentation
  - readme
  - changelog
  - roadmap
  - agents.md
  - claude.md
  - doc site
  - docsify
  - update docs
  - sync docs
  - documentation audit
  - docs review
portable: true
---

# Managing Documentation

Documentation architecture, review, staleness detection, and maintenance policy for project repositories.

## Capabilities

1. **Architecture guidance** -- define where documentation belongs and enforce layer boundaries
2. **Format enforcement** -- apply format standards per document type (README, AGENTS, CHANGELOG, ROADMAP)
3. **Staleness detection** -- identify outdated docs via git history, version mismatches, and count drift
4. **Documentation review** -- run structured audits across all project documentation
5. **Rot prevention** -- enforce the "drive content to skills" principle to keep root docs lean
6. **Doc site management** -- Docsify configuration for browsable skill documentation
7. **Index generation** -- auto-generate skill indexes and sidebars from frontmatter
8. **CLAUDE.md sync** -- maintain CLAUDE.md as auto-generated from AGENTS.md

## Routing Logic

| Trigger | Load Reference |
|---------|----------------|
| Architecture, doc layers, where docs belong | [doc-architecture.md](references/doc-architecture.md) |
| Format specs, AGENTS/README/CHANGELOG/ROADMAP format | [doc-formats.md](references/doc-formats.md) |
| Staleness, audit, review, freshness checks | [staleness-detection.md](references/staleness-detection.md) |
| Doc site, docsify, sidebar, index generation | [doc-site-and-indexing.md](references/doc-site-and-indexing.md) |
| Skill creation and structure | See `skill-manager` skill (cross-link, not duplicated) |

## Core Principles

### 1. Skills Are Truth

All detailed knowledge lives in `.claude/skills/`. CLAUDE.md, AGENTS.md, and README.md are routing tables that point to skills for depth. If you are writing more than 5-10 lines about a topic in a root doc, it belongs in a skill.

### 2. Single Source of Truth

AGENTS.md is the canonical agent instruction file. CLAUDE.md is auto-generated from it -- never edit CLAUDE.md directly. Edit AGENTS.md, then run the sync script.

### 3. Link, Don't Duplicate

Reference skills and other docs instead of copying content. Duplication leads to rot. For skill and prompt format standards, defer to the `skill-manager` and related skills.

### 4. Each Document Has an Audience

README.md serves developers (self-contained quick start). AGENTS.md serves AI tools (canonical instructions). CHANGELOG.md serves users (human-curated history). ROADMAP.md serves stakeholders (aspirational direction). Skills serve AI agents and developers (deep guidance).

### 5. Keep a Changelog

CHANGELOG.md follows Keep a Changelog 1.1.0 strictly. Entries are human-curated summaries, never git log dumps. Always maintain an `[Unreleased]` section.

## Workflow

### Documentation Update Pass

1. **Gather changes** -- `git log --oneline -20` to identify recent activity
2. **Check CHANGELOG** -- are recent features/fixes captured in `[Unreleased]`?
3. **Check AGENTS.md** -- does it reflect current architecture, skill count, component count?
4. **Check README.md** -- are commands, descriptions, and quick start current?
5. **Check ROADMAP.md** -- should any items move phases based on shipped work?
6. **Verify counts** -- list `.claude/skills/`, `src/components/`, `.github/prompts/` and compare to doc claims
7. **Apply updates** -- follow each doc's format spec from the reference files
8. **Sync CLAUDE.md** -- run the sync script to regenerate from AGENTS.md
9. **Report** -- summarize what was updated and what was already current

### Documentation Rot Prevention

Add this note to the top of CLAUDE.md and README.md:

```markdown
> **Documentation Policy**: Skills are the source of truth. This file is a
> routing table. See the manage-documentation skill for full policy.
```

## Checklist

- [ ] CLAUDE.md has doc policy note at top
- [ ] README.md has doc policy note at top
- [ ] AGENTS.md reflects current architecture and counts
- [ ] All skills have `category` in frontmatter
- [ ] No content blocks exceeding 10 lines in CLAUDE.md or AGENTS.md for topics covered by skills
- [ ] Skill index is up to date (count matches directories)
- [ ] Version in package.json matches README badge and CHANGELOG latest
- [ ] `[Unreleased]` in CHANGELOG captures all merged work since last version
- [ ] ROADMAP shipped items link to CHANGELOG versions
- [ ] CLAUDE.md content matches AGENTS.md (auto-generated header present)
- [ ] Internal links resolve (no broken references)
- [ ] Doc site reflects current skills

## When to Escalate

- Major restructuring of documentation architecture
- Adding new documentation layers or document types
- Changing the skill specification format
- New document type needed -- discuss format before creating
- Conflicting information across documents that cannot be resolved independently
- Architecture changes requiring simultaneous updates to multiple docs
