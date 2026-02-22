# Version Upgrades

Strategies for planning and executing dependency upgrades, from routine patches to major version migrations.

## Upgrade Types

| Type | Semver | Risk | Strategy |
|---|---|---|---|
| Patch | `1.0.0` -> `1.0.1` | Low | Auto-merge with CI pass |
| Minor | `1.0.0` -> `1.1.0` | Low-Medium | Auto-merge with CI + changelog review |
| Major | `1.0.0` -> `2.0.0` | Medium-High | Manual review, staged rollout |
| Multi-major | `1.x` -> `4.x` | High | Sequential upgrade through each major version |

## Patch and Minor Upgrades

These should be routine and largely automated.

**Process:**

1. Automated tool (Dependabot/Renovate) opens a PR
2. CI runs full test suite
3. Review the changelog for unexpected behavioral changes
4. Merge if CI passes and changelog looks clean

**Auto-merge criteria (recommended):**

- CI passes on all platforms and Node/Python/Rust versions
- No new high/critical vulnerabilities introduced
- Minimum release age of 3 days for minor, 1 day for patch
- Package is not on the "manual review required" list

**Caution:** Some packages do not follow semver strictly. Maintain a list of packages where minor updates have historically introduced breaking changes, and require manual review for those.

## Major Version Upgrades

Major upgrades require planning and staged execution.

### Pre-Upgrade Assessment

1. **Read the migration guide** -- Most well-maintained packages publish migration guides for major versions
2. **Review the full changelog** -- Read every entry between your current version and the target
3. **Identify breaking changes** -- List every breaking change that affects your codebase
4. **Estimate effort** -- Count files affected, API changes needed, test modifications
5. **Check ecosystem readiness** -- Ensure plugins, extensions, and peer dependencies support the new version

```bash
# Find all import/usage sites for a package
grep -r "from 'package-name'" src/ --include='*.ts' --include='*.tsx' -l
grep -r "require('package-name')" src/ --include='*.js' -l

# Check peer dependency compatibility
npm ls package-name
```

### Sequential Major Upgrades

When upgrading across multiple major versions (e.g., v2 to v5), upgrade one major version at a time:

```
v2.x -> v3.x (latest patch) -> v4.x (latest patch) -> v5.x (latest patch)
```

**Why sequential?**

- Each major version's changelog documents changes from the previous major
- Migration guides assume you are on the previous major version
- Automated codemods (if available) target specific version transitions
- Easier to isolate which upgrade introduced a regression

**Process for each step:**

1. Upgrade to latest patch of the next major version
2. Apply code changes required by that major version's migration guide
3. Run codemods if the package provides them
4. Run full test suite and fix failures
5. Commit and verify in CI before proceeding to next major

### Large-Scale Migration Strategy

For major upgrades affecting many files (e.g., React 17 to 18, Angular version upgrades):

#### Phase 1: Preparation

- Create a tracking issue listing all breaking changes
- Set up a feature branch for the migration
- Run any available codemods to handle mechanical changes
- Add compatibility shims where possible to enable incremental migration

#### Phase 2: Incremental Migration

- Migrate one module or feature area at a time
- Use compatibility layers to allow old and new code to coexist temporarily
- Write tests that validate both old and new behavior
- Get code reviews on each incremental PR

#### Phase 3: Cleanup

- Remove compatibility shims and deprecated API usage
- Update all test fixtures and snapshots
- Remove the old version from the lockfile
- Update documentation and internal guides

### Dealing with Breaking Changes

| Type of Breaking Change | Strategy |
|---|---|
| Renamed API | Find-and-replace or codemod |
| Removed API | Implement replacement or wrapper |
| Changed behavior | Update tests, verify in staging |
| New required config | Add configuration, document |
| Dropped runtime support | Upgrade runtime first |
| Changed peer dependencies | Upgrade peer dependencies first |

## Upgrade Planning Template

```markdown
## Dependency Upgrade Plan: <package> v<current> -> v<target>

### Impact Assessment

- **Files affected:** <count>
- **Breaking changes:** <count>
- **Estimated effort:** <hours/days>
- **Risk level:** Low / Medium / High

### Breaking Changes

| Change | Impact | Fix Strategy | Files Affected |
|---|---|---|---|
| | | | |

### Prerequisites

- [ ] <prerequisite 1>
- [ ] <prerequisite 2>

### Migration Steps

1. [ ] <step 1>
2. [ ] <step 2>

### Rollback Plan

- Revert the upgrade PR
- <additional rollback steps>

### Verification

- [ ] All tests pass
- [ ] Manual testing of affected features
- [ ] Performance benchmarks show no regression
- [ ] Security audit shows no new vulnerabilities
```

## Handling Upgrade Blockers

When a dependency cannot be upgraded due to blockers:

1. **Document the blocker** -- Create an issue explaining why the upgrade is blocked
2. **Pin the current version** -- Ensure automated tools do not keep opening PRs
3. **Set a review date** -- Revisit the blocker quarterly
4. **Assess risk** -- If the current version has vulnerabilities, evaluate workarounds
5. **Escalate if needed** -- If the blocker is a security vulnerability, escalate to the team

```jsonc
// Renovate: ignore a specific major version
{
  "packageRules": [
    {
      "matchPackageNames": ["problematic-package"],
      "matchUpdateTypes": ["major"],
      "enabled": false,
      "description": "Blocked: requires Node 22+ which we don't support yet. Review Q3 2025."
    }
  ]
}
```

## Ecosystem-Specific Tips

### Node.js / npm

- Use `npm outdated` to see available updates at a glance
- Use `npx npm-check-updates` (`ncu`) for interactive upgrades
- Leverage codemods: many frameworks publish them (`npx @next/codemod@latest`)
- Check `engines` field for runtime compatibility

### Python / pip

- Use `pip list --outdated` to see available updates
- Use `pip-compile` (pip-tools) for deterministic upgrades
- Check `python_requires` for compatibility
- Use `tox` to test across multiple Python versions

### Rust / Cargo

- Use `cargo outdated` to see available updates
- Use `cargo update` for compatible updates within semver range
- Check MSRV (Minimum Supported Rust Version) before upgrading
- Use `cargo semver-checks` to verify semver compliance of your own crates

### Go

- Use `go list -m -u all` to see available updates
- Use `go get package@latest` for upgrades
- Run `go mod tidy` after upgrades to clean up
- Check `go` directive in `go.mod` for minimum Go version requirements
