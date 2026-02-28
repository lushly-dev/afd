---
name: do-release
source: botcore
description: >
  Version bump, changelog finalize, build, test, tag, publish to registries, and create GitHub Release. Language-aware for TypeScript (npm), Python (PyPI), and Rust (crates.io). Delegates to manage-git for tagging strategy and manage-documentation for changelog format. Use when ready to release a new version.

version: 1.0.0
triggers:
  - do release
  - release
  - version bump
  - publish
  - tag release
  - ship release
  - cut release
argument-hint: patch | minor | major
portable: true
user-invocable: true
---

# Do Release

Release a new version — bump, changelog, build, test, tag, publish, GitHub Release.

## AFD-Specific: Script-Driven Release

The AFD monorepo uses `scripts/release.mjs` — a single script that handles the entire release process. No Changesets, no external version managers, no hidden state.

### Quick Release

```bash
pnpm release patch       # 0.3.0 → 0.3.1
pnpm release minor       # 0.3.0 → 0.4.0
pnpm release major       # 0.3.0 → 1.0.0
pnpm release 1.0.0       # explicit version
pnpm release patch --dry-run  # preview without changes
```

The script:
1. Verifies you're on `main` with a clean working tree
2. Pulls latest from origin
3. Bumps ALL `@lushly-dev/*` packages to the new version (fixed versioning)
4. Updates `CHANGELOG.md` — moves `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`
5. Runs `pnpm check` (the full quality gate — lint, build, typecheck, test:coverage)
6. Commits: `chore: release vX.Y.Z`
7. Tags: `vX.Y.Z`

Then push to publish:
```bash
git push origin main --tags
```

The Release workflow triggers on the `v*` tag, builds, tests, and publishes to npm with provenance.

### Design Principles

| Principle | Rationale |
|-----------|-----------|
| **Script owns versioning** | No external tool state to corrupt. The script IS the process. |
| **Fixed versioning** | All `@lushly-dev/*` packages share one version. Simplifies compatibility. |
| **Quality gate built in** | Release fails fast if lint, build, typecheck, or tests fail — before any commit. |
| **Tag-triggered publish** | Release workflow only runs on `v*` tag push. Push to main never publishes. |
| **No npm auth locally** | Publishing happens in CI with `NPM_TOKEN` secret. Local workflow ends at `git push --tags`. |
| **Agent-compatible** | `do-release` skill + `pnpm release patch` = agents can release. |

## Workflow

### Step 1: Pre-Flight

Verify the repo is ready for release:

| Check | Required | Action if failed |
|-------|----------|-----------------|
| On `main` or release branch | Yes | Switch to `main`: `git checkout main && git pull` |
| Clean working tree | Yes | Commit or stash changes (consider `do-commit` first) |
| All tests pass | Yes | Run full test suite, fix failures |
| Up-to-date with remote | Yes | `git pull origin main` |

### Step 2: Version Bump

Determine the version increment from the argument (`patch`, `minor`, `major`). If no argument, analyze commits since last tag to suggest:

| Commit pattern | Suggested bump |
|---------------|---------------|
| `fix:` only | patch |
| `feat:` present | minor |
| `BREAKING CHANGE:` or `!:` | major |

Bump version in all relevant files based on detected languages:

| Language | File(s) to update |
|----------|-------------------|
| TypeScript | `package.json` (and workspace `package.json` files) |
| Python | `pyproject.toml` (`[project] version`) |
| Rust | `Cargo.toml` (`[package] version`) |

For monorepos with multiple packages, bump each changed package.

### Step 3: Changelog Finalize

Update CHANGELOG.md:

1. Move entries under `## [Unreleased]` to a new version heading: `## [X.Y.Z] - YYYY-MM-DD`
2. Add a fresh empty `## [Unreleased]` section at the top
3. Verify entries reflect actual changes (cross-reference with commits)
4. Reference `manage-documentation` skill for changelog format conventions

### Step 4: Build

Run a clean build to verify everything compiles with the new version:

| Language | Command |
|----------|---------|
| TypeScript | `pnpm build` or `npm run build` |
| Python | `hatch build` or `python -m build` |
| Rust | `cargo build --release` |

### Step 5: Final Test

Run the full test suite one more time after version bump and build:

| Language | Command |
|----------|---------|
| TypeScript | `pnpm test` |
| Python | `pytest` |
| Rust | `cargo test` |

### Step 6: Commit + Tag

```bash
git add -A
git commit -m "chore: release vX.Y.Z"
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

### Step 7: Publish

For AFD: publishing happens automatically via GitHub Actions when the `v*` tag is pushed. The Release workflow runs `pnpm publish:npm` with the `NPM_TOKEN` secret.

```bash
# Push triggers the Release workflow
git push origin main --tags
```

For other repos, publish to registries based on detected languages:

| Language | Command | Notes |
|----------|---------|-------|
| TypeScript | `pnpm publish:npm` or `npm publish` | Ensure `publishConfig` and `access: public` are set |
| Python | `hatch publish` or `twine upload dist/*` | Requires PyPI credentials |
| Rust | `cargo publish` | Requires crates.io token |

For monorepos, publish each public package. Private packages (`private: true`) are automatically skipped.

### Step 8: Push + GitHub Release

```bash
git push origin main --tags
```

Create a GitHub Release:

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <changelog-excerpt>
```

Extract the changelog section for this version as the release notes.

### Step 9: Post-Release

1. Print summary: version published, registries updated, release URL
2. Remind about announcements (if applicable)
3. Verify the package is available: `npm info <pkg>` / `pip install <pkg>==X.Y.Z --dry-run`

## Reference

See [release-checklist.md](references/release-checklist.md) for the expanded checklist.
