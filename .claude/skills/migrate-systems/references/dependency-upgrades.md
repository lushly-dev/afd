# Dependency Upgrade Workflows Reference

## Upgrade Categories

| Category | Risk | Examples | Approach |
|---|---|---|---|
| Patch (x.y.Z) | Low | Bug fixes, security patches | Batch and auto-merge with CI |
| Minor (x.Y.0) | Low-Medium | New features, deprecation warnings | Batch by ecosystem, review changelog |
| Major (X.0.0) | High | Breaking changes, API removals | One at a time, full migration workflow |

## Major Version Upgrade Workflow

### 1. Assess

Before upgrading a major dependency:

- **Read the changelog** -- Identify all breaking changes between your current version and the target
- **Check migration guide** -- Most well-maintained packages publish upgrade guides
- **Audit usage** -- Search the codebase for every import and usage of the package
- **Check peer dependencies** -- Verify that other packages in the dependency tree are compatible with the new version
- **Review community issues** -- Check the package's issue tracker for known upgrade problems

```bash
# npm: Check what's outdated
npm outdated

# pip: Check outdated packages
pip list --outdated

# cargo: Check outdated crates
cargo outdated

# Find all imports of a package
grep -rn "from 'package-name'" src/
grep -rn "import.*package-name" src/
```

### 2. Isolate

Upgrade one major dependency at a time. Never batch major version bumps -- if something breaks, you need to know which upgrade caused it.

```bash
# npm: Upgrade a specific package
npm install package-name@latest

# pip: Upgrade a specific package
pip install package-name==X.Y.Z

# cargo: Upgrade a specific crate
cargo update -p crate-name
```

### 3. Fix Breaking Changes

Address breaking changes in order of severity:

1. **Compile/build errors** -- Fix these first; the project must build
2. **Type errors** -- Update type annotations for changed APIs
3. **Deprecation warnings** -- Replace deprecated APIs with recommended alternatives
4. **Runtime behavior changes** -- These are the hardest to find; rely on tests
5. **Test failures** -- Update tests that use changed APIs

### 4. Run Official Codemods

Many packages provide codemods for major upgrades:

```bash
# React (18 -> 19)
npx @codemod/cli react/19/migration src/

# Next.js
npx @next/codemod@latest src/

# Angular
ng update @angular/core@17

# Django
pip install django-upgrade
django-upgrade --target-version 5.0 **/*.py

# ESLint (flat config migration)
npx @eslint/migrate-config .eslintrc.json

# Storybook
npx storybook@latest upgrade
```

### 5. Verify

Run the full verification pipeline:

```bash
# Build
npm run build  # or equivalent

# Type check
npx tsc --noEmit

# Lint
npm run lint

# Unit tests
npm test

# Integration tests
npm run test:integration

# E2E tests (if available)
npm run test:e2e
```

### 6. Stage Rollout

For critical dependencies (frameworks, ORMs, HTTP clients):

1. Deploy to staging environment
2. Run smoke tests against staging
3. Deploy to production behind a feature flag (if possible)
4. Monitor error rates and performance for 24-48 hours
5. Remove the flag and declare the upgrade complete

## Automated Dependency Management Tools

### Renovate

Renovate is an open-source dependency update tool that creates PRs for outdated dependencies.

```json
// renovate.json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "packageRules": [
    {
      "matchUpdateTypes": ["patch"],
      "automerge": true
    },
    {
      "matchUpdateTypes": ["minor"],
      "groupName": "minor dependencies",
      "schedule": ["every weekend"]
    },
    {
      "matchUpdateTypes": ["major"],
      "dependencyDashboardApproval": true,
      "labels": ["breaking-change"]
    }
  ]
}
```

Key Renovate features:
- Groups related updates (e.g., all `@babel/*` packages together)
- Respects semantic versioning constraints
- Creates dashboard issues for tracking pending updates
- Supports npm, pip, cargo, go modules, Docker, and more

### Dependabot

GitHub's built-in dependency update tool.

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      production-dependencies:
        dependency-type: "production"
      development-dependencies:
        dependency-type: "development"
        update-types:
          - "minor"
          - "patch"
    open-pull-requests-limit: 10
```

### Comparison

| Feature | Renovate | Dependabot |
|---|---|---|
| Hosted option | Yes (Mend) | Yes (GitHub native) |
| Self-hosted | Yes | Yes |
| Grouping | Advanced | Basic (v2 groups) |
| Auto-merge | Yes | Via GitHub rules |
| Monorepo support | Excellent | Good |
| Custom managers | Yes (regex) | No |
| Package ecosystems | 60+ | 15+ |
| Schedule flexibility | Cron-like | Daily/weekly/monthly |

## Ecosystem-Specific Workflows

### npm / Node.js

```bash
# Check outdated
npm outdated

# Interactive upgrade (npm-check)
npx npm-check -u

# Update lockfile after manual package.json changes
npm install

# Audit for vulnerabilities
npm audit

# Fix known vulnerabilities
npm audit fix
```

**Key npm considerations:**
- Always commit `package-lock.json` changes
- Use `npm ci` in CI (not `npm install`) for reproducible builds
- Check for peer dependency warnings after upgrades
- Run `npm ls <package>` to see dependency tree resolution

### pip / Python

```bash
# Check outdated
pip list --outdated

# Upgrade specific package
pip install package-name --upgrade

# Generate requirements after upgrade
pip freeze > requirements.txt

# With pip-tools (recommended for production)
pip-compile --upgrade-package package-name requirements.in
pip-sync requirements.txt
```

**Key pip considerations:**
- Use `pip-tools` or `poetry` for deterministic lockfiles
- Virtual environments isolate upgrades from system Python
- Check for Python version compatibility (`python_requires` in setup.py/pyproject.toml)
- Run `mypy` after upgrades to catch type signature changes

### Cargo / Rust

```bash
# Check outdated
cargo outdated

# Update specific crate
cargo update -p crate-name

# Upgrade to new major version (edit Cargo.toml)
# Then run:
cargo build
cargo test
cargo clippy
```

**Key Cargo considerations:**
- `Cargo.lock` should be committed for applications (not libraries)
- Use `cargo deny` to check for license and vulnerability issues
- Run `cargo clippy` after upgrades for lint warnings about new APIs
- Feature flags may change between major versions

### Go Modules

```bash
# Check for updates
go list -m -u all

# Update specific module
go get module/path@latest

# Tidy go.sum
go mod tidy

# Verify checksums
go mod verify
```

## Handling Transitive Dependency Conflicts

When two direct dependencies require incompatible versions of a shared transitive dependency:

### Diagnosis

```bash
# npm: See why a package is installed
npm ls conflicting-package

# pip: Show dependency tree
pip install pipdeptree
pipdeptree --reverse --packages conflicting-package

# cargo: Show dependency tree
cargo tree -p conflicting-crate
```

### Resolution Strategies

| Strategy | When to use |
|---|---|
| Upgrade both direct deps | Both have compatible versions of the transitive dep |
| Pin transitive dep version | One version satisfies both (use `overrides`/`resolutions`) |
| Fork and patch | Upstream is unresponsive, you need an immediate fix |
| Wait for upstream | Non-urgent, the maintainer has a fix in progress |
| Replace one direct dep | The dependency is replaceable with an alternative |

```json
// npm overrides (package.json)
{
  "overrides": {
    "conflicting-package": "2.1.0"
  }
}
```

```json
// Yarn resolutions (package.json)
{
  "resolutions": {
    "conflicting-package": "2.1.0"
  }
}
```

## Security-Driven Upgrades

When a vulnerability is reported in a dependency:

### Triage

1. **Assess severity** -- CVSS score, exploitability, and relevance to your usage
2. **Check if affected** -- Does your code use the vulnerable API/feature?
3. **Find the fix** -- Is there a patched version? What's the minimum version that fixes it?
4. **Evaluate upgrade path** -- Is the fix in a patch release (easy) or a major version (migration needed)?

### Priority Matrix

| Severity | Exploitable in your context | Action |
|---|---|---|
| Critical | Yes | Upgrade immediately, even if it requires a major bump |
| Critical | No | Upgrade within 1 week |
| High | Yes | Upgrade within 1-3 days |
| High | No | Upgrade within 2 weeks |
| Medium/Low | Any | Include in next scheduled upgrade cycle |

## Upgrade Scheduling

### Recommended Cadence

| Update type | Frequency | Process |
|---|---|---|
| Security patches | Immediately when reported | Automated via Renovate/Dependabot |
| Patch versions | Weekly (auto-merge with CI) | Automated |
| Minor versions | Bi-weekly, grouped by ecosystem | Semi-automated, review changelog |
| Major versions | Quarterly assessment, one at a time | Manual, full migration workflow |
| Framework upgrades | Per release cycle of the framework | Manual, dedicated migration sprint |

### Dependency Freshness Audit

Periodically audit the staleness of your dependencies:

```bash
# npm: List outdated with severity
npm outdated --long

# Generate a report
npm outdated --json > outdated-report.json
```

Track metrics:
- Number of dependencies with available major upgrades
- Average age of dependency versions
- Number of dependencies with known vulnerabilities
- Time since last upgrade audit
