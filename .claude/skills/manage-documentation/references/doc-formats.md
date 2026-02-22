# Document Format Specifications

Format standards for each documentation type. Each document has a distinct audience and structure.

---

## AGENTS.md Format

The canonical agent instruction file. All AI coding tools (Copilot, Claude, Cursor) consume this. CLAUDE.md is auto-generated from it.

### Required Sections (in order)

| Section | Purpose | Max Lines |
|---------|---------|-----------|
| H1 title + callout | File name + link to SETUP.md | 3 |
| Project overview | What, how, why -- one paragraph | 5 |
| Commands | Common commands + single-file examples | 20 |
| Repository structure | Folder to purpose table | 25 |
| Architecture | Tech stack table + brief subsections | 40 |
| Code style | Config + formatting rules | 10 |
| Key rules | Hard constraints agents must follow | 15 |
| Testing | Test patterns | 15 |
| Skills | Table of all skills with triggers | varies |

**Target total: ~150 lines** (excluding the skills table).

### Skills Table

Three columns: Skill, Purpose (100 chars max), Triggers. Keep one row per skill. Ensure every directory in `.claude/skills/` has a corresponding row.

### Key Rules Section

Bullet list of hard constraints. Each rule should be one line with emphasis on the keyword:

```markdown
- **Fabric tokens only** -- never hardcode colors/spacing
- **Lit is Storybook-only** -- never import in src/
```

### CLAUDE.md Sync

AGENTS.md is the source of truth. Sync via script:

```bash
node scripts/sync-claude-md.mjs
```

**Never edit CLAUDE.md directly.** Always edit AGENTS.md and re-sync.

---

## README.md Format

The developer's first impression. Must work as a self-contained quick start.

### Required Sections (in order)

| Section | Purpose | Max Lines |
|---------|---------|-----------|
| H1 + badges | Project name, status, version, tech stack | 10 |
| Description | What, why, differentiators -- one paragraph | 5 |
| Quick start | Install + run in 10 lines or fewer of bash | 15 |
| What's included | Package table + tooling table | 20 |
| Architecture overview | Brief descriptions linking to skills | 30 |
| Commands table | Full script reference | 20 |
| Testing | How to run tests + strategy overview | 15 |
| Documentation | Links to CHANGELOG, ROADMAP, AGENTS, skills | 10 |
| Contributing | How to contribute, link to AGENTS/SETUP | 10 |

**Target: ~200 lines** (excluding code blocks).

### Self-Contained Quick Start

A developer should be able to clone, install, and see something running with just the README:

```markdown
## Quick start

```bash
npm install
npm run dev
# Open http://localhost:5173
```
```

### Architecture Overview

Use brief descriptions (2-3 sentences per area) and link to skills for depth. This follows the "drive content to skills" principle.

### Badge Maintenance

Update version badges when cutting a release. Use shields.io static badges:

```markdown
![Version: 0.8.0](https://img.shields.io/badge/version-0.8.0-blue)
```

---

## CHANGELOG.md Format

Based on [Keep a Changelog 1.1.0](https://keepachangelog.com/). Entries are human-curated summaries -- never dump git logs.

### File Header

```markdown
# Changelog

All notable changes to the project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning follows [Semantic Versioning](https://semver.org/).
```

### Version Sections

Newest first. Each version gets a heading with semver and ISO date:

```markdown
## [Unreleased]

### Added
- New feature description

## [0.9.0] -- 2026-02-20

### Added
- Feature A -- brief description of what it does and why it matters
```

### Change Type Categories

Use only these six. Omit empty categories.

| Category | When to Use |
|----------|-------------|
| **Added** | New features |
| **Changed** | Changes in existing behavior |
| **Deprecated** | Features marked for removal |
| **Removed** | Features that were removed |
| **Fixed** | Bug fixes |
| **Security** | Vulnerability fixes |

### Entry Formatting

- Start with a bold component/area name: `- **Rich Data Grid** -- added column pinning`
- Use sub-entries (indented `-`) for multi-part features
- Each entry should answer: **what changed** and **why it matters** (not how it was implemented)

### The [Unreleased] Section

Always keep `[Unreleased]` at the top. Add entries as work merges, not at release time. When cutting a release:

1. Rename `[Unreleased]` to `[x.y.z] -- YYYY-MM-DD`
2. Add a fresh empty `[Unreleased]` above it
3. Add a comparison link at the bottom of the file

### Comparison Links

Add at the bottom of the file:

```markdown
[unreleased]: https://github.com/user/repo/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/user/repo/compare/v0.8.0...v0.9.0
```

---

## ROADMAP.md Format

A forward-looking document showing where the project is heading. Phase-based.

### Required Sections

| Section | Purpose |
|---------|---------|
| H1 + vision | Project direction in 2-3 sentences |
| Disclaimer | Roadmap is aspirational, not a commitment |
| Phase tables | One table per active phase (Exploring through GA) |
| Shipped | Recently completed items linking to CHANGELOG versions |

### Phases

Items flow forward through these phases:

| Phase | Description |
|-------|-------------|
| **Exploring** | Under consideration; gathering feedback |
| **In Design** | Decided to build; figuring out approach |
| **Preview** | Publicly available in limited capacity |
| **GA** | Generally available, production-ready |
| **Shipped** | Delivered -- link to CHANGELOG version |

### Shipped Section

Link to CHANGELOG versions rather than duplicating what shipped:

```markdown
### Shipped

| Item | Version |
|------|---------|
| Rich Data Grid | [0.8.0](CHANGELOG.md#080---) |
```

### Disclaimer

Include near the top:

```markdown
> **Disclaimer:** This roadmap is aspirational and subject to change. Items may be
> reprioritized, delayed, or removed based on feedback and project needs.
```

### Maintenance Cadence

- **After each release:** Move shipped items to the Shipped table, link to CHANGELOG
- **When starting new work:** Add items to Exploring or In Design
- **Quarterly review:** Prune items that are no longer relevant

---

## Common Mistakes by Document Type

| Document | Mistake | Fix |
|----------|---------|-----|
| AGENTS.md | Stale skill count | Verify against `.claude/skills/` directories |
| AGENTS.md | Duplicating skill content | Extract to skill, leave summary + link |
| AGENTS.md | Missing commands section | Agents waste time searching package.json |
| README.md | No quick start | Forces developers to hunt through files |
| README.md | Stale version badges | Sync with CHANGELOG version |
| README.md | Wall of text | Use tables, headings, code blocks |
| CHANGELOG.md | Git log dumps | Curate for humans, summarize impact |
| CHANGELOG.md | Missing dates | Every version needs ISO 8601 date |
| CHANGELOG.md | Empty categories | Remove headings with no entries |
| ROADMAP.md | Overpromising | Avoid specific dates; use phase-based |
| ROADMAP.md | Never updating | Stale roadmap signals abandoned project |
| ROADMAP.md | Too granular | User-visible goals, not implementation tasks |
