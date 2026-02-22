# Release Management

Detailed guidance on automated release pipelines, semantic versioning, changelog generation, and release tooling.

## Semantic Versioning (SemVer)

All version numbers follow `MAJOR.MINOR.PATCH` format per semver.org:

| Component | When to Increment | Example |
|---|---|---|
| **MAJOR** | Incompatible API changes (breaking) | `2.0.0` |
| **MINOR** | Backward-compatible new features | `1.3.0` |
| **PATCH** | Backward-compatible bug fixes | `1.3.1` |

### Pre-release Versions

```
1.0.0-alpha.1    # Early development
1.0.0-beta.1     # Feature complete, testing
1.0.0-rc.1       # Release candidate
```

### Version Precedence

`1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-beta < 1.0.0-rc.1 < 1.0.0`

## Conventional Commits to SemVer Mapping

Release tools map commit types to version increments:

| Commit Pattern | SemVer Bump | Example |
|---|---|---|
| `fix:` | PATCH | `fix(api): handle null response` |
| `feat:` | MINOR | `feat(auth): add SSO support` |
| `feat!:` or `BREAKING CHANGE:` | MAJOR | `feat(api)!: rename endpoints` |
| `docs:`, `style:`, `refactor:`, `test:`, `chore:` | No release | Internal changes |
| `perf:` | PATCH (configurable) | `perf(db): optimize query` |

## Release-Please

Google's tool for automated releases based on conventional commits. Creates and maintains a release PR that accumulates changes.

### How It Works

1. Developers merge conventional commits to main
2. Release-please detects unreleased commits
3. It creates (or updates) a release PR with:
   - Version bump based on commit types
   - Generated CHANGELOG entries
   - Updated version references in code
4. When the release PR is merged, it creates a GitHub release and tag

### Setup (GitHub Actions)

```yaml
# .github/workflows/release-please.yml
name: release-please
on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          release-type: node  # or: python, rust, go, etc.
```

### Configuration

```json
// release-please-config.json
{
  "release-type": "node",
  "packages": {
    ".": {
      "changelog-path": "CHANGELOG.md",
      "bump-minor-pre-major": true,
      "bump-patch-for-minor-pre-major": true
    }
  }
}
```

### Best For

- Single-package repositories
- Projects wanting a human-reviewed release PR
- Teams that want to batch multiple changes into one release
- Google-ecosystem projects

## Changesets

A workflow tool focused on monorepos where multiple packages need independent versioning.

### How It Works

1. Developer makes changes and runs `npx changeset`
2. A changeset file is created in `.changeset/` describing the change and its semver impact
3. Changeset files accumulate over multiple PRs
4. When ready to release, run `npx changeset version` to:
   - Consume all changeset files
   - Bump package versions
   - Update CHANGELOGs
5. Then `npx changeset publish` to publish to npm

### Setup

```bash
npm install -D @changesets/cli
npx changeset init
```

### Changeset File Format

```markdown
<!-- .changeset/cool-dogs-laugh.md -->
---
"@myorg/core": minor
"@myorg/cli": patch
---

Add batch processing support to core.
Update CLI to expose new batch commands.
```

### GitHub Action for Automated Releases

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - uses: changesets/action@v1
        with:
          publish: npm run release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Best For

- Monorepos with multiple publishable packages
- Projects where each change needs explicit versioning intent
- Teams that want fine-grained control over release notes
- Libraries published to package registries

## Semantic-Release

Fully automated versioning and publishing. Every qualifying merge to main triggers a release automatically.

### How It Works

1. Developer merges conventional commits to main
2. CI triggers semantic-release
3. It analyzes commits since last release
4. Determines version bump from commit types
5. Generates release notes
6. Creates git tag and GitHub release
7. Publishes package (npm, PyPI, etc.)

### Setup

```bash
npm install -D semantic-release @semantic-release/changelog @semantic-release/git
```

```json
// .releaserc.json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/changelog",
    "@semantic-release/npm",
    ["@semantic-release/git", {
      "assets": ["CHANGELOG.md", "package.json"],
      "message": "chore(release): ${nextRelease.version}"
    }],
    "@semantic-release/github"
  ]
}
```

### Best For

- Projects wanting zero-touch releases
- Strong CI/CD with high test confidence
- Single-package repos with frequent releases
- Teams comfortable with fully automated publishing

## Tool Comparison

| Feature | release-please | changesets | semantic-release |
|---|---|---|---|
| Automation level | Semi (release PR) | Semi (manual changeset) | Full |
| Monorepo support | Limited | Excellent | Plugin-based |
| Human review step | Yes (release PR) | Yes (changeset files) | No (fully automated) |
| Changelog format | Generated | Authored + generated | Generated |
| Publishing | Via CI after merge | Via CLI or CI | Automatic |
| Commit convention | Required | Not required | Required |
| Pre-release support | Yes | Yes | Yes |
| Language support | Many (node, python, rust, go, etc.) | Node/npm focused | Plugin-based |

## Changelog Best Practices

### Format

Follow Keep a Changelog (keepachangelog.com) structure:

```markdown
# Changelog

## [1.2.0] - 2025-03-15

### Added
- OAuth2 token refresh support (#123)
- Batch processing endpoint (#145)

### Fixed
- Null response handling in API client (#134)
- Race condition in connection pool (#138)

### Changed
- Upgraded authentication library to v3 (#142)

### Deprecated
- Legacy XML response format (removed in 2.0.0)

### Removed
- Unused internal cache layer (#140)

### Security
- Patched XSS vulnerability in user input display (#136)
```

### Rules

1. **Newest entries at the top**
2. **Group by type** -- Added, Fixed, Changed, Deprecated, Removed, Security
3. **Link to issues/PRs** -- Every entry references the originating change
4. **Date every release** -- ISO 8601 format (YYYY-MM-DD)
5. **Include Unreleased section** -- Track changes not yet in a release
6. **Write for users, not developers** -- Focus on impact, not implementation

## Agentic Release Considerations

- Agents should never trigger releases without human approval
- Agents can prepare release PRs, changeset files, and changelog drafts
- Version bumps proposed by agents should be reviewed (especially MAJOR bumps)
- Agents should validate that all conventional commits in the range are well-formed before proposing a release
- In CI, agents can verify that a release would succeed (dry-run) without actually publishing
