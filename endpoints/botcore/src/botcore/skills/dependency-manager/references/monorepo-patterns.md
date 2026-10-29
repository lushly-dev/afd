# Monorepo Dependency Patterns

Strategies for managing dependencies in monorepos, including version policies, workspace tooling, and internal package references.

## Version Management Strategies

### Single Version Policy

All packages in the monorepo use the same version of each shared dependency. One source of truth.

**Advantages:**
- No version conflicts when sharing code between packages
- Simpler mental model -- one version per dependency
- Easier security patching -- update once, applies everywhere
- No duplicate packages in node_modules

**Disadvantages:**
- Upgrading a dependency requires all packages to be compatible
- One package can block the entire monorepo from upgrading
- Can be restrictive for large, diverse monorepos

**Best for:** Tightly coupled monorepos where packages share components and types.

**Implementation (pnpm catalogs):**

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'apps/*'

catalog:
  react: ^18.3.0
  react-dom: ^18.3.0
  typescript: ^5.5.0
  vitest: ^2.0.0
  zod: ^3.23.0
```

```json
// packages/ui/package.json
{
  "dependencies": {
    "react": "catalog:",
    "zod": "catalog:"
  }
}
```

**Implementation (npm/yarn -- root package.json):**

```json
// Root package.json with overrides/resolutions
{
  "overrides": {
    "react": "^18.3.0",
    "typescript": "^5.5.0"
  }
}
```

### Independent Version Policy

Each package manages its own dependency versions independently.

**Advantages:**
- Packages can upgrade at their own pace
- No cross-package upgrade blocking
- Teams have full autonomy

**Disadvantages:**
- Version drift between packages can cause runtime issues when sharing code
- Duplicate dependencies increase install time and disk usage
- Harder to track which version is used where

**Best for:** Loosely coupled monorepos where packages are independently deployed and rarely share code.

### Hybrid Approach (Recommended)

- **Core dependencies** (runtime, framework): Single version policy
- **Tooling** (linters, formatters, test runners): Single version policy
- **Domain-specific packages**: Independent versions allowed

```json5
// renovate.json5 -- enforce single version for core deps
{
  "packageRules": [
    {
      "matchPackageNames": ["react", "react-dom", "typescript", "vitest"],
      "groupName": "core dependencies",
      "matchUpdateTypes": ["minor", "patch"],
      "description": "Single version policy: update everywhere at once"
    }
  ]
}
```

## Workspace Tooling

### pnpm Workspaces

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'apps/*'
  - 'tools/*'
```

**Key features:**
- Content-addressable store (hard links, minimal disk usage)
- Strict mode prevents phantom dependencies
- `workspace:*` protocol for internal dependencies
- Catalog protocol for centralized version management

```json
// packages/ui/package.json
{
  "name": "@org/ui",
  "dependencies": {
    "@org/shared-types": "workspace:*",
    "@org/utils": "workspace:^1.0.0"
  }
}
```

### npm Workspaces

```json
// Root package.json
{
  "workspaces": [
    "packages/*",
    "apps/*"
  ]
}
```

```bash
# Run command in specific workspace
npm run build -w packages/ui

# Install dependency in specific workspace
npm install zod -w packages/api

# Run command across all workspaces
npm run test --workspaces
```

### Yarn Workspaces

```json
// Root package.json
{
  "workspaces": ["packages/*", "apps/*"]
}
```

```bash
# Yarn Berry (v4): install in specific workspace
yarn workspace @org/ui add zod

# Run across workspaces
yarn workspaces foreach -A run build
```

## Internal Dependencies

### Referencing Internal Packages

```json
// Using workspace protocol (pnpm, yarn)
{
  "dependencies": {
    "@org/shared-utils": "workspace:*",     // Always latest local version
    "@org/ui-components": "workspace:^1.0.0" // Semver range within workspace
  }
}
```

### Build Order and Task Orchestration

Internal dependencies create a build graph. Tools like Nx and Turborepo understand this graph:

```json
// turbo.json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],   // Build dependencies first
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {}                   // No dependencies, can run in parallel
  }
}
```

```json
// nx.json
{
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"],
      "cache": true
    }
  }
}
```

### Publishing Internal Packages

When publishing workspace packages to a registry:

1. Replace `workspace:*` with actual version numbers at publish time
2. pnpm and Yarn handle this automatically during `publish`
3. Use changesets or semantic-release for version management

```bash
# pnpm: workspace protocol is replaced during publish
pnpm publish --filter @org/ui

# Using changesets for versioning
npx changeset       # Create a changeset
npx changeset version  # Apply version bumps
npx changeset publish  # Publish to registry
```

## Dependency Hoisting

### How Hoisting Works

Package managers can "hoist" shared dependencies to the monorepo root to save disk space:

```
monorepo/
├── node_modules/
│   └── react/             # Hoisted: used by multiple packages
├── packages/
│   ├── app-a/
│   │   └── node_modules/
│   │       └── unique-pkg/ # Not hoisted: only used here
│   └── app-b/
```

### Hoisting Pitfalls

- **Phantom dependencies**: Code can accidentally import hoisted packages it did not declare as dependencies
- **Version conflicts**: Two packages needing different major versions cannot both be hoisted
- **pnpm strict mode**: Prevents phantom dependencies by default (recommended)

```ini
# .npmrc (pnpm) -- strict mode
shamefully-hoist=false   # Default: strict isolation
hoist=false              # Disable hoisting entirely
```

**Recommendation:** Use pnpm with strict mode. If you must hoist (e.g., for tools that expect flat node_modules), hoist selectively:

```ini
# .npmrc (pnpm) -- selective hoisting
public-hoist-pattern[]=@types/*
public-hoist-pattern[]=eslint-*
```

## Monorepo Dependency Audit

### Checking for Version Inconsistencies

```bash
# pnpm: list packages using different versions of a dependency
pnpm ls react --depth 0 --recursive

# Custom check: find version mismatches (Node.js monorepo)
# Lists all packages and their version of react
pnpm ls react --json --recursive | jq '.[].dependencies.react.version' 2>/dev/null
```

### Tools for Monorepo Dependency Health

| Tool | Purpose |
|---|---|
| `syncpack` | Enforce consistent dependency versions across packages |
| `manypkg` | Check and fix issues in monorepo packages |
| `depcheck` | Find unused dependencies in each package |
| Nx/Turborepo | Build graph visualization, affected detection |
| `license-checker` | Audit licenses across all workspace packages |

```bash
# syncpack: check for version mismatches
npx syncpack list-mismatches

# syncpack: fix mismatches
npx syncpack fix-mismatches

# depcheck: find unused deps in a package
npx depcheck packages/ui
```

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Every package has its own React version | Runtime conflicts, bundle bloat | Single version policy for framework deps |
| Root package.json has all dependencies | Unclear ownership, phantom deps | Declare deps where they are used |
| No `workspace:` protocol for internal deps | Published packages may resolve wrong version | Use `workspace:*` for internal refs |
| `shamefully-hoist=true` without reason | Phantom dependencies, hidden coupling | Use strict mode, hoist selectively |
| No build orchestration tool | Slow builds, incorrect build order | Use Turborepo or Nx |
| Manual version bumps across packages | Drift, forgotten updates | Use changesets or release-please |
