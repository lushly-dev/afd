# Automated Dependency Updates

Configuration and best practices for Dependabot, Renovate, and other automated dependency update tools.

## Tool Comparison

| Feature | Dependabot | Renovate |
|---|---|---|
| Platform | GitHub only | GitHub, GitLab, Bitbucket, Azure DevOps, Gitea |
| Configuration | `.github/dependabot.yml` | `renovate.json` or `renovate.json5` |
| Grouping | Limited (directory-based) | Advanced (regex, package patterns, update types) |
| Auto-merge | Via GitHub Actions / rulesets | Built-in with configurable rules |
| Major vs minor handling | Same PR format | Separate PRs for major; configurable |
| Monorepo support | Basic | Advanced (group across workspaces) |
| Schedule control | Daily, weekly, monthly | Cron expressions, timezone-aware |
| Custom managers | No | Yes (regex managers for any file format) |
| Replacement suggestions | No | Yes (suggests replacements for deprecated packages) |
| Release age filtering | No | Yes (`minimumReleaseAge`) |
| Pricing | Free | Free (open source), paid (Mend.io hosted) |

**Recommendation:** Use Dependabot for simple GitHub-only projects. Use Renovate for monorepos, multi-platform, or projects needing advanced grouping and auto-merge rules.

## Dependabot Configuration

### Basic Setup

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
      timezone: "America/New_York"
    open-pull-requests-limit: 10
    reviewers:
      - "team-name"
    labels:
      - "dependencies"
    commit-message:
      prefix: "deps"
      include: "scope"

  - package-ecosystem: "pip"
    directory: "/"
    schedule:
      interval: "weekly"
    allow:
      - dependency-type: "direct"

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

### Ignoring Specific Packages

```yaml
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    ignore:
      # Ignore major updates for a specific package
      - dependency-name: "webpack"
        update-types: ["version-update:semver-major"]
      # Ignore all updates for a pinned package
      - dependency-name: "legacy-package"
```

### Grouping (Dependabot)

```yaml
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      # Group all minor and patch updates together
      minor-and-patch:
        update-types:
          - "minor"
          - "patch"
      # Group related packages
      eslint:
        patterns:
          - "eslint*"
          - "@typescript-eslint/*"
```

## Renovate Configuration

### Basic Setup

```json5
// renovate.json5
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "config:recommended",
    "group:monorepos",
    "group:recommended",
    ":separateMajorReleases",
    ":prConcurrentLimit10"
  ],
  "timezone": "America/New_York",
  "schedule": ["before 9am on monday"],
  "labels": ["dependencies"],
  "reviewers": ["team:platform"]
}
```

### Advanced Configuration

```json5
// renovate.json5
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],

  // Global settings
  "timezone": "America/New_York",
  "schedule": ["before 9am on monday"],
  "prConcurrentLimit": 10,
  "prHourlyLimit": 2,
  "labels": ["dependencies"],

  // Require minimum age before auto-merge (supply chain protection)
  "minimumReleaseAge": "3 days",

  "packageRules": [
    // Auto-merge patch updates with CI pass
    {
      "matchUpdateTypes": ["patch"],
      "automerge": true,
      "automergeType": "pr",
      "minimumReleaseAge": "3 days"
    },

    // Auto-merge minor dev dependency updates
    {
      "matchDepTypes": ["devDependencies"],
      "matchUpdateTypes": ["minor", "patch"],
      "automerge": true,
      "minimumReleaseAge": "3 days"
    },

    // Major updates: require manual review, add label
    {
      "matchUpdateTypes": ["major"],
      "automerge": false,
      "labels": ["dependencies", "breaking-change"],
      "reviewers": ["team:senior-engineers"]
    },

    // Group ESLint-related packages
    {
      "groupName": "eslint",
      "matchPackagePatterns": ["eslint"],
      "matchUpdateTypes": ["minor", "patch"]
    },

    // Group testing packages
    {
      "groupName": "testing",
      "matchPackageNames": ["jest", "ts-jest", "@types/jest"],
      "matchPackagePatterns": ["@testing-library/"],
      "matchUpdateTypes": ["minor", "patch"]
    },

    // Pin GitHub Actions to digests for security
    {
      "matchManagers": ["github-actions"],
      "pinDigests": true
    },

    // Block upgrades for a package with known issues
    {
      "matchPackageNames": ["problematic-pkg"],
      "matchUpdateTypes": ["major"],
      "enabled": false,
      "description": "Blocked until we migrate off deprecated API"
    },

    // Supply chain protection: longer age for high-profile packages
    {
      "matchPackageNames": ["react", "next", "express"],
      "minimumReleaseAge": "7 days"
    }
  ]
}
```

### Renovate for Monorepos

```json5
{
  "extends": ["config:recommended", "group:monorepos"],
  "packageRules": [
    // Group workspace package updates by workspace
    {
      "matchPaths": ["packages/frontend/**"],
      "groupName": "frontend dependencies",
      "matchUpdateTypes": ["minor", "patch"]
    },
    {
      "matchPaths": ["packages/backend/**"],
      "groupName": "backend dependencies",
      "matchUpdateTypes": ["minor", "patch"]
    },
    // Single version policy: group shared deps across all workspaces
    {
      "matchPackageNames": ["typescript", "prettier", "eslint"],
      "groupName": "shared tooling"
    }
  ]
}
```

## Auto-Merge Safety Rules

Auto-merge can save significant developer time but must be configured carefully:

### Safe to Auto-Merge

- Patch updates with CI passing and minimum 3-day release age
- Dev dependency minor updates with CI passing
- Well-known packages with strong semver track record

### Never Auto-Merge

- Major version updates
- Packages on the "manual review" list
- Packages with a history of breaking semver
- Any update that fails CI
- Updates to packages with fewer than 1K weekly downloads

### Minimum Release Age

The `minimumReleaseAge` setting (Renovate) is a critical supply chain protection:

| Package Type | Recommended Minimum Age |
|---|---|
| Production dependencies | 3-7 days |
| Dev dependencies | 3 days |
| Auto-merged packages | 7-14 days |
| Critical infrastructure (React, Express) | 7-14 days |

This delay gives registries time to detect and remove malicious packages before they are merged into your project.

## CI Requirements for Dependency PRs

Ensure your CI pipeline validates dependency updates thoroughly:

```yaml
# Example: GitHub Actions for dependency PR validation
name: Dependency PR Checks
on:
  pull_request:
    branches: [main]

jobs:
  validate:
    if: contains(github.event.pull_request.labels.*.name, 'dependencies')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'
      - run: npm ci
      - run: npm audit --audit-level=high
      - run: npm test
      - run: npm run build
      - run: npm run lint
      # Optional: bundle size check for frontend projects
      - run: npx pkg-size --report
```

## Scheduling Best Practices

| Strategy | Schedule | Rationale |
|---|---|---|
| Weekly batch | Monday morning | Start the week with updates, time to fix issues |
| Off-hours | Saturday night | Updates ready for review Monday morning |
| Continuous | Always | Fast response to security patches (noisy) |
| Bi-weekly | Every other Monday | Less noise for small teams |

**Recommendation:** Weekly on Monday morning with PR limits (10 concurrent). This balances freshness with manageable review burden.

## Metrics to Track

Monitor these metrics to ensure your automated update process is healthy:

| Metric | Target | Warning |
|---|---|---|
| Mean time to merge dependency PR | < 3 days | > 7 days |
| Dependency PRs open at any time | < 10 | > 20 |
| Packages more than 1 major behind | 0 | > 3 |
| Failed dependency PR CI runs | < 10% | > 25% |
| Dependencies with known vulnerabilities | 0 high/critical | Any high/critical |
