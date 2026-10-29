# Context & Problem Statement

> Part of [Bot Core + Skill Registry Plan](./00-overview.md)

---

## Context — Full Ecosystem

**Three bots** with ~80% duplicated command code:

- **lushbot** (lushx) — lushly-dev workspace orchestrator
- **proto** (fabux-proto) — fabric-ux-prototype tooling
- **fabux** — fabric-ux-system KB curation

**~70 skills** across 4 directories with significant drift:

- lushly-dev root: 23 skills
- proto: 27 skills
- fabux: 19 skills
- agent mirror: 17 skills (subset of root, 3 stale copies)

**Key drift findings:**

- `reviewer` exists in 4 places at 4 different versions (4.6.0, 4.2.0, 1.0.0, empty folder)
- `spec-writer` appears 3 places at 3 different versions (2.2.0, 1.1.0, 1.0.0 — proto is a complete rewrite)
- 3 skills with same name but completely different content across proto ↔ fabux (design-tokens, fabric-components, fabric-ux-patterns)
- `accessibility` has 3 unrelated skills under the same/similar name
- fabux `reviewer/` is broken (empty folder)
- lushbot ↔ fabux share byte-for-byte identical code in: runner.py, workspace.py, dev/core.py, dev/quality.py, dev/analysis.py, dev/portability.py, docs.py

**The user is already building more bots** (mechanic, possibly others). These are all built on AFD Python package with Click CLI + FastMCP MCP server.

---

## Problem Statement

1. **Bot code duplication** — Three bots share ~80% identical command modules (lint, test, check-size, check-coverage, dead-code, circular-imports, unused-deps, check-paths, check-changelog, check-agents, workspace info). Changes in one don't propagate to others.

2. **Skill duplication and drift** — Skills are manually copied between repos. No mechanism to distinguish "this is a general skill I copied" from "this is my domain-specific version." Same-name skills diverge silently.

3. **No portability** — Skills at a workspace root aren't visible to CLI-based editors or external cloners. Skills need to be committed to each repo.

4. **No skill identity** — When `reviewer` appears in 4 places, there's no way to know which is source of truth, which is stale, which is an intentional fork.

5. **Growing bot count** — Each new bot (mechanic, future ones) will re-copy the same command modules and skills, multiplying drift.

---

## Brainstormed Approaches (Skills Distribution)

### Option A: Skills as an npm/pip Package ("skill-pack")

**How**: Publish a package containing only markdown files. A postinstall script copies/symlinks SKILL.md files into `.claude/skills/`.

**Pros**: Versioned via semver, works in any repo, discoverable via package managers.

**Cons**: Package managers aren't designed for markdown assets. Postinstall scripts are fragile and a security concern. Symlinks break on Windows. Awkward metaphor.

### Option B: Git Submodule for a Skills Repo

**How**: A `skills` repo added as a submodule at `.claude/skills/shared/` in each project.

**Pros**: Pinned to a commit, git-native.

**Cons**: Submodules are painful (detached HEAD, forgotten `--recursive`). Doesn't compose with local skills. Clone friction.

### Option C: Skill Feed / Registry with CLI Sync

**How**: Central `skills` repo as a registry. Each project declares which skills it wants in a manifest. CLI tool copies subscribed skills into the project, committed to git.

**Pros**: Explicit subscription. Committed copies work for cloners and CLI editors. Composable with local skills. Versioning via git tags.

**Cons**: Sync command must be run manually. Copies can drift between syncs.

### Option D: Improved Workspace Inheritance (status quo)

**How**: Keep shared skills at workspace root. Fix stale references.

**Pros**: Already partially working. Zero tooling cost.

**Cons**: Doesn't solve CLI-editor, external-clone, or cross-workspace problems.

### Option E: Hybrid Feed + Local Override

**How**: Combine feed (Option C) with layering — managed skills are marked with `source:` in frontmatter, project-local skills are never overwritten.

**Pros**: Clean owned-vs-shared separation. Override mechanism. Feed updates don't clobber customizations.

**Cons**: Slightly more complex directory structure.

### Option F: Template Repo + Sync Bot

**How**: GitHub Action monitors skills repo, opens PRs in subscribed repos when skills change.

**Pros**: Automated, visible updates via PR. Each repo owns its copy.

**Cons**: PR noise. GitHub-specific. Setup overhead per repo.
