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

Release a new version using the repo's versioning flows for npm packages and Python.

## AFD-Specific Release Tracks

The AFD monorepo uses three release tracks:

- **npm packages** — [@changesets/cli](https://github.com/changesets/changesets) versions and publishes the `@lushly-dev/*` packages with fixed versioning.
- **Python package** — `python/pyproject.toml` is versioned separately and published through `publish-python.yml` on `python-v*` tags or GitHub Releases.
- **C++ library (afd-cpp)** — versioned independently in `packages/cpp/CMakeLists.txt` (`project(afd VERSION ...)`), with its own `packages/cpp/CHANGELOG.md`, released as `afd-cpp-v<version>` tags. It is not on a package registry; consumers use CMake (`add_subdirectory`, `FetchContent` or an installed package). Changesets does not cover it.

### How npm Changesets Work

1. **During development**: When you change a released `@lushly-dev/*` package, create a changeset:
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

### Python Release Flow

When the Python `afd` package changes:

1. Bump `python/pyproject.toml`
2. Update `CHANGELOG.md`
3. Push a `python-v<version>` tag or publish a GitHub Release
4. Let `.github/workflows/publish-python.yml` build, test, and publish to PyPI

### C++ Release Flow

When `packages/cpp` changes in a way worth releasing:

1. Bump `project(afd VERSION x.y.z)` in `packages/cpp/CMakeLists.txt` (it generates `afd/version.hpp`)
2. Move `Unreleased` in `packages/cpp/CHANGELOG.md` under the new version
3. Check that `cpp.yml` and `conformance.yml` are green on `main`
4. Tag `afd-cpp-v<version>` and create a GitHub Release from the changelog section

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
| **Changesets owns npm versioning** | Changelog entries accumulate per-PR for `@lushly-dev/*` packages. |
| **Fixed versioning** | All `@lushly-dev/*` packages share one version via `"fixed"` config. |
| **Python releases are separate** | Python-only work should not get a no-op changeset; it ships through the PyPI workflow. |
| **Quality gate in CI** | Build + test run before publish in the Release workflow. |
| **No manual tagging** | Changesets action creates tags and GitHub Releases automatically. |
| **No npm auth locally** | Publishing happens in CI with `NPM_TOKEN` secret. |
| **Agent-compatible** | `pnpm changeset` → commit → merge = agents can contribute to releases. |

### Creating a Changeset

When making changes to released npm packages that should be versioned:

```bash
pnpm changeset
```

Choose the bump type:
- **patch** — bug fixes, dependency updates, npm-package docs
- **minor** — new features, non-breaking additions
- **major** — breaking changes

Write a concise description of what changed. The changeset file is committed with your PR.

Do not create a no-op changeset for Python-only or docs/skills-only changes.

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
| Pending changesets exist | Yes, when npm packages changed | Run `pnpm changeset` to create one |

### Step 2: Version + Changelog

```bash
pnpm version-packages
```

This consumes all `.changeset/*.md` files, bumps versions in all `@lushly-dev/*` package.json files, and appends entries to each package's CHANGELOG.md.

### Python Versioning

For Python-only releases:

```bash
cd python
$EDITOR pyproject.toml   # bump version
cd ..
git add python/pyproject.toml CHANGELOG.md
git commit -m "chore(python): release afd <version>"
git tag python-v<version>
git push origin main --tags
```

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
