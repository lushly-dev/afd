# Changelog and Versioning Reference

Detailed guide for changelog formatting, semantic versioning, git tag management, and version lifecycle. Companion to the do-documentation-update skill.

## Semantic Versioning (SemVer 2.0.0)

Version format: **MAJOR.MINOR.PATCH**

| Segment | Increment when | Resets |
|---------|---------------|--------|
| **MAJOR** | Breaking changes to public API | MINOR and PATCH to 0 |
| **MINOR** | New features, backward compatible | PATCH to 0 |
| **PATCH** | Bug fixes, no API changes | Nothing |

### Pre-release versions

Append a hyphen and identifiers for pre-release:

```
1.0.0-alpha.1
1.0.0-beta.1
1.0.0-rc.1
```

Pre-release versions have lower precedence than the release: `1.0.0-alpha.1 < 1.0.0`.

**Changelog treatment**: Pre-release versions get their own heading, same as stable releases:

```markdown
## [1.0.0-beta.2] - 2026-03-10

### Added
- Beta feature X

## [1.0.0-beta.1] - 2026-03-01

### Added
- Initial beta
```

### 0.x.y versions

During initial development (`0.x.y`), the API is not considered stable:
- `0.MINOR.PATCH` — MINOR bumps may include breaking changes
- The first stable release is `1.0.0`

## Git Tags

### Tag format

```
v1.2.3          # stable release
v1.0.0-beta.1   # pre-release
v2.0.0-rc.1     # release candidate
```

**Convention**: Always prefix with `v`. This is the most widely adopted standard across npm, PyPI, cargo, GitHub Releases, and CI tooling.

### Creating tags

```bash
# Annotated tag (preferred — stores tagger, date, message)
git tag -a v1.2.0 -m "Release v1.2.0"

# Push tags
git push origin v1.2.0
# Or push all tags
git push origin --tags
```

### Querying tags

```bash
# List all version tags
git tag -l "v*"

# Latest tag
git describe --tags --abbrev=0

# Commits since last tag
git log $(git describe --tags --abbrev=0)..HEAD --oneline --no-merges

# Count commits between tags
git rev-list v1.1.0..v1.2.0 --count
```

## Conventional Commits → Version Bump

The commit history determines the next version. Scan commits since the last tag:

```bash
git log $(git describe --tags --abbrev=0)..HEAD --oneline --no-merges
```

### Decision table

| Highest-severity commit type | Version bump | Example |
|-----------------------------|-------------|---------|
| `BREAKING CHANGE:` in footer | **Major** | `feat: redesign API\n\nBREAKING CHANGE: removed v1 endpoints` |
| `feat!:` or `fix!:` (bang suffix) | **Major** | `feat!: change auth flow` |
| `feat:` | **Minor** | `feat: add export command` |
| `fix:` only | **Patch** | `fix: handle null input` |
| `perf:` only | **Patch** | `perf: reduce memory allocation` |

**Rule**: The highest-severity commit wins. If there's one `feat!:` among 20 `fix:` commits, it's a major bump.

### Breaking change detection

Breaking changes can appear in two forms:

1. **Bang suffix**: `feat!: remove deprecated API`
2. **Footer**: 
   ```
   feat: redesign auth
   
   BREAKING CHANGE: OAuth1 support removed. Use OAuth2.
   ```

Both trigger a major version bump.

## Changelog ↔ Tag ↔ Version Alignment

These three must always be in sync:

| Artifact | Format | Example |
|----------|--------|---------|
| Changelog heading | `## [X.Y.Z] - YYYY-MM-DD` | `## [1.2.0] - 2026-03-15` |
| Git tag | `vX.Y.Z` | `v1.2.0` |
| Package version | `X.Y.Z` | `"version": "1.2.0"` |

### Sync verification

```bash
# Get latest changelog version
head -20 CHANGELOG.md | grep -oP '\d+\.\d+\.\d+'

# Get latest git tag
git describe --tags --abbrev=0

# Get package version
node -e "console.log(require('./package.json').version)"  # TS
python -c "import tomllib; print(tomllib.load(open('pyproject.toml','rb'))['project']['version'])"  # Python
```

If these diverge, something went wrong in the release process. Fix the mismatch before proceeding.

## Comparison Links

Every changelog should have comparison links at the bottom. These make each version clickable to see the full diff on GitHub.

### Format

```markdown
[unreleased]: https://github.com/org/repo/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/org/repo/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/org/repo/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/org/repo/releases/tag/v1.0.0
```

**Rules**:
- `[unreleased]` always compares latest tag to `HEAD`
- Each version compares to its predecessor
- First version links to its tag (no predecessor to compare)
- Update `[unreleased]` link when cutting a release

### Generating links

After creating a new version:

1. Change `[unreleased]` to compare from the new tag: `v1.3.0...HEAD`
2. Add a new line for the released version: `v1.2.0...v1.3.0`

## Release Lifecycle in the Changelog

### During development

Entries accumulate under `[Unreleased]`:

```markdown
## [Unreleased]

### Added
- **auth** -- OAuth2 PKCE flow support
- **cli** -- interactive mode for command selection

### Fixed
- **server** -- middleware chain order for error handlers
```

### At release time

1. Replace `[Unreleased]` with the version heading:
   ```markdown
   ## [1.3.0] - 2026-04-01
   ```
2. Add a fresh `[Unreleased]` above it:
   ```markdown
   ## [Unreleased]

   ## [1.3.0] - 2026-04-01
   ```
3. Update comparison links at the bottom

### Post-release

All new work goes under the fresh `[Unreleased]` section. The cycle repeats.

## Monorepo Considerations

### Single changelog

Most monorepos use one CHANGELOG.md at the root. Prefix entries with the package name:

```markdown
### Added
- **@scope/package-a** -- new validation helpers
- **@scope/package-b** -- WebSocket transport support
```

### Per-package changelogs

If packages version independently, each gets its own CHANGELOG.md:

```
packages/
  core/CHANGELOG.md
  server/CHANGELOG.md
  client/CHANGELOG.md
```

Each follows the same format. Tags may include the package name: `@scope/core@1.2.0`.

### Which to use

| Situation | Strategy |
|-----------|----------|
| Packages version together | Single root CHANGELOG |
| Packages version independently | Per-package CHANGELOGs |
| Mixed (some coupled, some independent) | Root for coupled, per-package for independent |

## Edge Cases

### Reverting a release

If a release needs to be reverted:
1. Do **not** delete the changelog entry — it was released
2. Add a new patch version entry documenting the revert:
   ```markdown
   ## [1.2.1] - 2026-03-16

   ### Removed
   - **auth** -- reverted OAuth2 PKCE (introduced in 1.2.0) due to regression
   ```

### Backporting fixes

If a fix is backported to an older major version:
- The fix gets entries in both the current and backport changelogs
- Backport tags: `v1.2.5` (on the v1 branch), `v2.1.1` (on main)

### Yanked releases

Mark yanked versions with `[YANKED]`:

```markdown
## [1.2.0] - 2026-03-15 [YANKED]
```

Add a note explaining why and what version to use instead.

### No user-facing changes

If a release contains only internal changes (CI, deps, refactors), it's acceptable to release a patch with:

```markdown
## [1.2.1] - 2026-03-16

### Changed
- Internal dependency updates and CI improvements
```

Keep it honest — don't inflate the changelog, but do document that a version exists.
