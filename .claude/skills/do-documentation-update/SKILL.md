---
name: do-documentation-update
source: botcore
description: >
  Run a documentation update pass across CHANGELOG, AGENTS.md, README.md, and skill files. Ensures docs reflect current code state with proper changelog formatting, semver alignment, and version-tag consistency. Standalone skill — invoke directly, not only as part of do-commit.

version: 1.0.0
triggers:
  - do documentation update
  - update docs
  - update documentation
  - docs update
  - documentation pass
  - update changelog
  - sync docs
  - documentation gate
portable: true
user-invocable: true
---

# Do Documentation Update

Run a documentation update pass — CHANGELOG, AGENTS.md, README.md, skill files.

This skill is standalone. Invoke it directly whenever code changes need documentation, not only as part of `do-commit`. Agents should run this after any feature, fix, refactor, or structural change.

## Bot Commands

This skill is distributed via botcore. The bot provides commands that automate many of these checks — use them instead of doing manual work. The bot name varies per project (it may be called `botcore`, `alfred`, `libbot`, etc.).

| Command | What it does | Used in |
|---------|-------------|--------|
| `docs_check_changelog` | Detects if CHANGELOG.md is stale vs staged changes | Step 2 |
| `docs_check_agents` | Detects if AGENTS.md needs updating from structural changes | Step 3 |
| `docs_lint` | Checks broken internal links, broken anchors, missing frontmatter | Step 8 |
| `skill_lint` | Validates skill file frontmatter and structure | Step 7 |
| `spec_status` | Reads spec/proposal status from frontmatter | Step 5 |
| `spec_validate` | Validates spec structure (frontmatter, sections, length) | Step 5 |

Call these via MCP tools or CLI when available. If the bot is not installed, the manual steps below still work.

## Workflow

### Step 1: Gather Context

Understand what changed before touching any docs:

```bash
# Recent commits
git log --oneline -20

# Files changed since last commit (unstaged work)
git diff --stat

# Files changed since last tag (for changelog)
git log --oneline $(git describe --tags --abbrev=0 2>/dev/null || echo HEAD~20)..HEAD --no-merges

# Current version
cat package.json | grep '"version"'   # TypeScript
cat pyproject.toml | grep 'version'   # Python
cat Cargo.toml | grep 'version'       # Rust
```

### Step 2: Update CHANGELOG.md

**Every user-visible change gets a changelog entry.** This is the most commonly skipped step — do not skip it.

Run `docs_check_changelog` first — it compares staged source files against CHANGELOG.md and reports whether an update is needed.

#### What goes in the changelog

| Include | Exclude |
|---------|---------|
| New features (`feat:`) | Internal refactors with no behavior change |
| Bug fixes (`fix:`) | Test-only changes |
| Breaking changes | CI/build config tweaks |
| Deprecations | Code style/formatting |
| Security fixes | Dependency bumps (unless user-facing) |
| Removed features | Typo fixes in code |

#### Format: Keep a Changelog 1.1.0

Add entries under `## [Unreleased]` using the six standard categories. Omit empty categories.

| Category | When to use |
|----------|-------------|
| **Added** | New features, new commands, new APIs |
| **Changed** | Behavior changes to existing features |
| **Deprecated** | Features marked for future removal |
| **Removed** | Features or APIs that were removed |
| **Fixed** | Bug fixes |
| **Security** | Vulnerability patches |

#### Entry format

```markdown
## [Unreleased]

### Added
- **component-name** -- brief description of what and why

### Fixed
- **auth** -- session token no longer expires during active use
```

Rules:
- Bold the component or area name
- Describe **what changed** and **why it matters** — not implementation details
- One entry per logical change, not per commit
- Use sub-entries (indented `-`) for multi-part features

#### Version headings and semver

When a version is released, `[Unreleased]` becomes a versioned heading:

```markdown
## [1.2.0] - 2026-03-15
```

The version number follows [Semantic Versioning](https://semver.org/):

| Bump | When | Example |
|------|------|---------|
| **Patch** (0.0.X) | Bug fixes, no API changes | `fix:` commits |
| **Minor** (0.X.0) | New features, backward compatible | `feat:` commits |
| **Major** (X.0.0) | Breaking changes | `BREAKING CHANGE:` or `feat!:` / `fix!:` |

#### Git tags and version alignment

Git tags and changelog headings must stay in sync:

```
Tag: v1.2.0  →  Heading: ## [1.2.0] - 2026-03-15
Tag: v1.1.0  →  Heading: ## [1.1.0] - 2026-02-01
```

**Convention**: Tags use `v` prefix (`v1.2.0`), changelog headings omit it (`[1.2.0]`).

#### Comparison links

Maintain comparison links at the bottom of CHANGELOG.md:

```markdown
[unreleased]: https://github.com/org/repo/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/org/repo/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/org/repo/compare/v1.0.0...v1.1.0
```

Each link shows the diff between consecutive versions. The `[unreleased]` link always compares the latest tag to HEAD.

See [changelog-versioning.md](references/changelog-versioning.md) for the full versioning reference including pre-release versions, monorepo strategies, and edge cases.

### Step 3: Update AGENTS.md

Check if structural changes require AGENTS.md updates:

| Change type | AGENTS.md action |
|-------------|-----------------|
| New skill added | Add row to skills table |
| Skill removed | Remove row from skills table |
| New command/tool | Add to commands section |
| Architecture change | Update architecture section |
| New package added | Update package structure |
| Convention changed | Update conventions section |

Run `docs_check_agents` — it detects structural changes (new commands, new packages) in staged files and flags whether AGENTS.md needs updating. If AGENTS.md was updated, sync CLAUDE.md afterward (see Step 9).

**Count verification**: List actual directories/files and compare to counts claimed in AGENTS.md:

```bash
# Skill count
ls -d .claude/skills/*/  | wc -l

# Component count (if applicable)
ls -d src/components/*/  | wc -l
```

### Step 4: Update README.md

Check if changes affect developer-facing documentation:

| Change type | README.md action |
|-------------|-----------------|
| New CLI command | Add to commands table |
| Install steps changed | Update quick start |
| New dependency | Update prerequisites |
| API change | Update usage examples |
| Version bump | Update badges |

README.md should remain a self-contained quick start — keep it lean. Deep content belongs in skills or docs/.

### Step 5: Close Out Specs

If the completed work was driven by a spec, proposal, or feature document in the repo, update its lifecycle status:

1. **Find the spec** — check for spec/proposal files related to the work (common locations: `docs/features/`, `docs/specs/`, project root). Run `spec_status <path>` to read current status from frontmatter.
2. **Mark complete** — update frontmatter status to `complete` or equivalent, or move the file/folder to the project's completed/archived location. Run `spec_validate <path>` to verify the spec is well-formed before closing it out.
3. **Update the feature index** — if the project maintains a feature table or index (e.g., a features README with proposed/active/complete tables), move the entry to the completed section

This is a judgment call — not every change has a backing spec. But if one exists, leaving it marked "active" or "in progress" after the work ships creates confusion.

### Step 6: Update ROADMAP.md

If the project has a ROADMAP.md (or equivalent), check whether the completed work fulfills a roadmap item:

1. **Scan the roadmap** — look for items matching the work just completed
2. **Move to shipped** — move the item to the Shipped section (or equivalent) and link to the CHANGELOG version:
   ```markdown
   ### Shipped

   | Item | Version |
   |------|---------|
   | Feature X | [1.2.0](CHANGELOG.md#120---2026-03-15) |
   ```
3. **Clean up phases** — remove the item from its previous phase (Exploring, In Design, Preview, etc.)

Skip this step if no roadmap exists or the work doesn't correspond to a roadmap item.

### Step 7: Lint Skill Files

If any skill files (`.claude/skills/`) were modified, run `skill_lint` — it validates frontmatter fields, structure, and format.

Fix any issues flagged: missing frontmatter fields, format violations, broken references.

### Step 8: Verify Links

Check for broken or stale links across all documentation files touched in this pass.

Run `docs_lint` — it scans markdown files for broken internal links, broken anchor references, and missing frontmatter on specs. Pass a path to scope it: `docs_lint path=docs/` or omit for the default `docs/` directory.

#### Internal links

If `docs_lint` is not available, verify manually that relative Markdown links resolve to files that exist:

```bash
# Find all markdown link targets in a file
grep -oP '\]\((?!https?://|#)([^)]+)\)' README.md AGENTS.md CHANGELOG.md

# Check each target exists
# For [text](path/to/file.md) — does path/to/file.md exist?
# For [text](path/to/file.md#heading) — does the file and heading exist?
```

Common breakages:
- File was moved or renamed but links weren't updated
- Skill directory was added/removed but skills table links are stale
- Feature spec moved from `active/` to `complete/` but cross-references still point to old path

#### Links that need updating after changes

| What changed | Links to check |
|-------------|----------------|
| File moved or renamed | All docs referencing the old path |
| Skill added/removed | Skills table in AGENTS.md, sidebar configs |
| Spec moved to complete | Feature index, any docs linking to the spec |
| Package renamed | README badges, install instructions, import examples |
| Heading renamed | Any `#anchor` links targeting that heading |

#### External links (spot check)

For docs that reference external URLs, spot-check a few critical ones:
- Badge image URLs (shields.io, etc.)
- Links to external specs or standards (Keep a Changelog, SemVer)
- Repository URLs (especially after org or repo renames)

Full external link validation is expensive — only do it during audits, not every update pass.

### Step 9: Sync CLAUDE.md

If AGENTS.md was modified, regenerate CLAUDE.md:

```bash
# If a sync script exists
node scripts/sync-claude-md.mjs
# Or copy AGENTS.md content if no script
```

**Never edit CLAUDE.md directly.** It is auto-generated from AGENTS.md.

### Step 10: Report

Summarize what was updated:

```
Documentation update complete:
- CHANGELOG.md: Added 2 entries under [Unreleased] (Added, Fixed)
- AGENTS.md: Updated skill count (14 → 15), added new skill row
- README.md: No changes needed
- Spec: Moved auth-adapter to complete
- ROADMAP.md: Moved "Auth Adapter" to Shipped, linked to [1.2.0]
- Links: Fixed 2 broken refs (old spec path, removed skill)
- Skills: Passed lint
```

## Quick Reference

### Commit type → changelog category

| Commit prefix | Changelog category |
|--------------|-------------------|
| `feat:` | Added |
| `fix:` | Fixed |
| `feat!:` / `fix!:` / `BREAKING CHANGE:` | Changed (with breaking note) |
| `deprecate:` or deprecation noted | Deprecated |
| `remove:` or removal noted | Removed |
| Security fix noted | Security |

### Skippable commits (no changelog entry needed)

- `chore:` — tooling, CI, deps (unless user-facing)
- `test:` — test additions/changes
- `refactor:` — internal restructuring with no behavior change
- `style:` — formatting, whitespace
- `docs:` — documentation-only (the docs update itself)
- `ci:` — CI pipeline changes

## When to Escalate

- CHANGELOG.md doesn't exist yet — create it with proper header and `[Unreleased]` section
- Version in code doesn't match latest changelog version — flag the mismatch, don't silently fix
- Breaking changes detected but no major version bump planned — confirm with user
- Multiple packages changed in a monorepo — clarify whether one or multiple changelog entries are needed
