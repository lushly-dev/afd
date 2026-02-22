# Monorepo Git Strategies

Git workflow patterns for monorepos, including affected-only CI, code ownership, sparse checkout, and cross-package coordination.

## Why Monorepo Git Is Different

Monorepos contain multiple packages, services, or applications in a single repository. This amplifies standard git challenges:

- **More frequent conflicts** -- More developers editing the same repo
- **Longer CI times** -- Building/testing everything on every change is wasteful
- **Complex changelogs** -- Each package needs its own changelog
- **Selective releases** -- Not every package releases on every merge
- **Code ownership** -- Different teams own different subtrees

## Monorepo Directory Structure

```
monorepo/
├── .github/
│   ├── workflows/
│   └── CODEOWNERS
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── CHANGELOG.md
│   │   └── src/
│   ├── server/
│   │   ├── package.json
│   │   ├── CHANGELOG.md
│   │   └── src/
│   └── cli/
│       ├── package.json
│       ├── CHANGELOG.md
│       └── src/
├── apps/
│   ├── web/
│   └── mobile/
├── shared/
│   ├── types/
│   └── utils/
├── package.json
├── turbo.json          # or nx.json
└── pnpm-workspace.yaml
```

## Affected-Only CI/CD

The single most impactful optimization for monorepo CI. Only build and test packages affected by the current change.

### With Nx

```yaml
# .github/workflows/ci.yml
jobs:
  main:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # Full history for affected detection
      - run: npx nx affected -t lint test build --base=origin/main
```

### With Turborepo

```yaml
# .github/workflows/ci.yml
jobs:
  main:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2   # Need parent commit for diff
      - run: npx turbo lint test build --filter="...[HEAD^1]"
```

### With Plain Git

```bash
# Detect which packages changed:
CHANGED_PACKAGES=$(git diff --name-only origin/main...HEAD | \
  grep -oP 'packages/\K[^/]+' | sort -u)

# Run CI only for those packages:
for pkg in $CHANGED_PACKAGES; do
  cd "packages/$pkg"
  npm test
  cd ../..
done
```

## Code Ownership (CODEOWNERS)

Define who owns which parts of the monorepo. GitHub enforces review requirements based on CODEOWNERS.

```
# .github/CODEOWNERS

# Package owners
/packages/core/       @platform-team
/packages/server/     @backend-team
/packages/cli/        @devtools-team

# App owners
/apps/web/            @frontend-team
/apps/mobile/         @mobile-team

# Shared code requires platform review
/shared/              @platform-team

# CI/CD changes require devops review
/.github/             @devops-team

# Root config changes require lead review
/package.json         @tech-leads
/turbo.json           @tech-leads
```

### Benefits

- Automatic review assignments for PRs
- Prevents changes to critical code without proper review
- Clear accountability for each area
- Reduces conflict by defining boundaries

## Branching in Monorepos

### Recommended: Trunk-Based with Scoped Branches

```
main
  ├── feat/core/batch-processing
  ├── fix/server/timeout-handling
  ├── feat/cli/format-flag
  └── chore/deps/upgrade-typescript
```

### Branch Naming Convention

```
<type>/<package>/<description>

Examples:
  feat/core/add-batch-api
  fix/server/connection-pool-leak
  docs/cli/update-readme
  refactor/shared/extract-validators
  chore/deps/update-eslint
```

### Cross-Package Changes

When a change spans multiple packages:

```
feat/cross/unified-error-handling
```

Use `cross` as the scope, and list all affected packages in the PR description and commit body.

## Versioning Strategies

### Independent Versioning (Recommended for Libraries)

Each package has its own version, incremented independently based on its own changes.

```json
// packages/core/package.json
{ "version": "2.1.0" }

// packages/server/package.json
{ "version": "1.5.3" }

// packages/cli/package.json
{ "version": "3.0.1" }
```

**Tool**: Changesets is purpose-built for this pattern.

### Fixed/Locked Versioning (Recommended for Apps)

All packages share the same version number. Any change to any package bumps the version for all.

```json
// All packages
{ "version": "4.2.0" }
```

**Tool**: release-please with `linked-versions` or Lerna in fixed mode.

### Hybrid Versioning

Group related packages that should version together, while allowing independent packages.

```json
// release-please-config.json
{
  "packages": {
    "packages/core": { "release-type": "node" },
    "packages/server": { "release-type": "node" },
    "packages/cli": { "release-type": "node" }
  },
  "group": {
    "sdk": {
      "packages": ["packages/core", "packages/server"],
      "bump-minor-pre-major": true
    }
  }
}
```

## Monorepo Tooling Comparison

| Feature | Nx | Turborepo | pnpm Workspaces | Rush |
|---|---|---|---|---|
| Affected detection | Built-in (project graph) | Filter syntax | Manual | Built-in |
| Remote caching | Nx Cloud | Vercel Remote Cache | No | Rush Cloud |
| Task orchestration | Advanced (topological) | Basic (topological) | Scripts only | Advanced |
| Code generation | Generators + plugins | No | No | Templates |
| Dependency graph | Visual (nx graph) | No | No | No |
| Language support | JS/TS + plugins (Go, Rust, etc.) | JS/TS | JS/TS | JS/TS |
| Best for | Large monorepos (20+ packages) | Medium monorepos (5-20) | Small monorepos (1-5) | Very large (50+) |

## Sparse Checkout

For very large monorepos, developers can check out only the packages they need:

```bash
# Initialize sparse checkout:
git sparse-checkout init --cone

# Check out specific packages:
git sparse-checkout set packages/core packages/server shared/

# Add more packages later:
git sparse-checkout add packages/cli

# Disable sparse checkout (get everything):
git sparse-checkout disable
```

### When to Use Sparse Checkout

- Repository is multi-GB with many packages
- Developer only works on 1-2 packages regularly
- CI jobs only need specific packages
- Agent worktrees should be as lightweight as possible

## Merge Conflict Prevention in Monorepos

1. **Package-scoped branches** -- Reduces cross-team conflicts
2. **CODEOWNERS enforcement** -- Clear ownership boundaries
3. **Lock file strategy** -- Use `pnpm` which has fewer merge conflicts in lock files than npm/yarn
4. **Generated code in .gitignore** -- Never commit auto-generated files
5. **Root config stability** -- Minimize changes to root-level configuration
6. **Merge queues** -- Serialize merges to main to prevent broken builds

## Agentic Considerations for Monorepos

- **Scope agent work to a single package** whenever possible to minimize conflict risk
- **Use sparse checkout in agent worktrees** to reduce disk usage and setup time
- **Run affected-only tests** -- Agents should not run the full test suite for a scoped change
- **Include package scope in commits** -- `feat(core): add feature` not just `feat: add feature`
- **Check cross-package dependencies** -- If an agent changes a shared package, it must verify downstream consumers still build
- **Respect CODEOWNERS** -- Agent PRs touching owned code should request review from the appropriate team
