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

Release a new version using Changesets — the automated versioning and changelog tool.

## AFD-Specific: Changesets-Driven Release

The AFD monorepo uses [@changesets/cli](https://github.com/changesets/changesets) for versioning and changelog management. All `@lushly-dev/*` packages share one version (fixed versioning).

### How Changesets Works

1. **During development**: When you make a change worth releasing, create a changeset:
   ```bash
   pnpm changeset
   ```
   This prompts for the semver bump type and a description, then creates a markdown file in `.changeset/`.

2. **At release time**: The GitHub Actions workflow (or manual command) consumes all changesets:
   ```bash
   pnpm version-packages    # bumps versions + updates CHANGELOGs
   ```

3. **Publishing**: CI handles this automatically, or manually:
   ```bash
   pnpm publish:npm          # build + publish to npm
   ```

### Automated CI Flow

The Release workflow runs on every push to `main`:

1. If pending changesets exist → opens a **"Release" PR** that bumps versions and updates CHANGELOGs
2. When the Release PR is merged → publishes all bumped packages to npm with provenance

No manual tagging or version bumping needed.

### Manual Release (if needed)

```bash
# 1. Ensure all changes have changesets
pnpm changeset status

# 2. Version bump + changelog update
pnpm version-packages

# 3. Commit the version bump
git add -A
git commit -m "chore: release packages"

# 4. Push to trigger publish
git push origin main

# 5. Or publish locally
pnpm publish:npm
```

### Design Principles

| Principle | Rationale |
|-----------|-----------|
| **Changesets owns versioning** | Changelog entries accumulate per-PR; release notes write themselves. |
| **Fixed versioning** | All `@lushly-dev/*` packages share one version via `"fixed"` config. |
| **Quality gate in CI** | Build + test run before publish in the Release workflow. |
| **No manual tagging** | Changesets action creates tags and GitHub Releases automatically. |
| **No npm auth locally** | Publishing happens in CI with `NPM_TOKEN` secret. |
| **Agent-compatible** | `pnpm changeset` → commit → merge = agents can contribute to releases. |

### Creating a Changeset

When making changes that should be released:

```bash
pnpm changeset
```

Choose the bump type:
- **patch** — bug fixes, dependency updates, docs
- **minor** — new features, non-breaking additions
- **major** — breaking changes

Write a concise description of what changed. The changeset file is committed with your PR.

### Configuration

Config lives in `.changeset/config.json`:
- `"fixed": [["@lushly-dev/*"]]` — all published packages share one version
- `"access": "public"` — packages are public on npm
- `"ignore"` — example apps and root package are excluded from versioning
- `"changelog"` — uses `@changesets/changelog-github` for PR links in changelogs

## Workflow

### Step 1: Pre-Flight

Verify the repo is ready for release:

| Check | Required | Action if failed |
|-------|----------|-----------------|
| On `main` or release branch | Yes | Switch to `main`: `git checkout main && git pull` |
| Clean working tree | Yes | Commit or stash changes (consider `do-commit` first) |
| All tests pass | Yes | Run full test suite, fix failures |
| Pending changesets exist | Yes | Run `pnpm changeset` to create one |

### Step 2: Version + Changelog

```bash
pnpm version-packages
```

This consumes all `.changeset/*.md` files, bumps versions in all `@lushly-dev/*` package.json files, and appends entries to each package's CHANGELOG.md.

### Step 3: Build + Test

```bash
pnpm check
```

### Step 4: Commit + Push

```bash
git add -A
git commit -m "chore: release packages"
git push origin main
```

### Step 5: Publish

CI publishes automatically when it detects version bumps on main. Or publish manually:

```bash
pnpm publish:npm
```

### Step 6: Post-Release

1. Verify packages are available: `npm info @lushly-dev/afd-core`
2. Check GitHub Release was created
3. Announce if applicable

## Reference

See [release-checklist.md](references/release-checklist.md) for the expanded checklist.
