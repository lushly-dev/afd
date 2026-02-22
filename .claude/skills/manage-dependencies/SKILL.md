---
name: manage-dependencies
source: botcore
description: >
  Guides dependency evaluation, selection, and lifecycle management for software projects. Covers package health assessment (OpenSSF Scorecard, maintenance signals, popularity metrics), vendoring vs forking decisions, major version upgrade strategies, automated update tooling (Dependabot, Renovate), supply chain security (SLSA, Sigstore, SBOM, provenance), monorepo dependency patterns, and agentic workflows for dependency operations. Use when evaluating new packages, adding dependencies, upgrading major versions, configuring automated updates, auditing dependency health, making vendor-or-fork decisions, or securing the software supply chain. Triggers: dependency, package, npm install, pip install, cargo add, upgrade, update, vendoring, fork, supply chain, SBOM, SLSA, Dependabot, Renovate, lockfile, vulnerability, dependency health, monorepo dependencies.

version: 1.0.0
triggers:
  - dependency
  - package
  - npm install
  - pip install
  - cargo add
  - add dependency
  - upgrade dependency
  - update dependency
  - vendoring
  - fork dependency
  - supply chain
  - SBOM
  - SLSA
  - Dependabot
  - Renovate
  - lockfile
  - dependency health
  - dependency audit
  - monorepo dependencies
  - package evaluation
  - major version upgrade
  - dependency security
portable: true
---

# Dependency Management

Expert guidance for evaluating, selecting, securing, and maintaining software dependencies across their full lifecycle.

## Capabilities

1. **Evaluate packages** -- Assess health, maintenance, security posture, and fitness of candidate dependencies before adoption
2. **Add dependencies** -- Select the right package with minimal transitive footprint, pin versions, and update lockfiles
3. **Upgrade dependencies** -- Plan and execute minor, patch, and major version upgrades safely
4. **Configure automation** -- Set up Dependabot, Renovate, or similar tools for continuous dependency updates
5. **Vendor or fork** -- Decide when to vendor, fork, wrap, or directly depend on third-party code
6. **Secure the supply chain** -- Apply SLSA, Sigstore, SBOM, and provenance verification to dependency pipelines
7. **Manage monorepo dependencies** -- Handle shared versions, workspace protocols, and internal package references
8. **Agentic dependency operations** -- Guide AI agents through safe dependency evaluation and modification workflows

## Routing Logic

| Request type | Load reference |
|---|---|
| Evaluating a new package, health check, fitness assessment | [references/package-evaluation.md](references/package-evaluation.md) |
| Vendoring, forking, wrapping, or inlining dependencies | [references/vendoring-and-forking.md](references/vendoring-and-forking.md) |
| Major version upgrades, migration planning, breaking changes | [references/version-upgrades.md](references/version-upgrades.md) |
| Dependabot, Renovate, automated update configuration | [references/automated-updates.md](references/automated-updates.md) |
| SLSA, Sigstore, SBOM, provenance, supply chain security | [references/supply-chain-security.md](references/supply-chain-security.md) |
| Monorepo patterns, workspaces, shared versions, catalogs | [references/monorepo-patterns.md](references/monorepo-patterns.md) |
| Agentic workflows, AI agent dependency operations | [references/agentic-workflows.md](references/agentic-workflows.md) |
| Vulnerability scanning, audit commands, remediation | [references/vulnerability-scanning.md](references/vulnerability-scanning.md) |

## Core Principles

### 1. Minimize Dependency Surface

Every dependency is a liability -- it adds maintenance burden, security exposure, and build complexity. Before adding a package, ask: Can we achieve this with the standard library or existing dependencies? Is the functionality worth the cost of another node in the dependency graph?

### 2. Evaluate Before Adopting

Never add a dependency without assessment. Check maintenance activity, security posture, license compatibility, transitive dependency count, and download trends. A package that solves today's problem but is abandoned tomorrow creates technical debt.

### 3. Pin and Lock

Always use lockfiles (`package-lock.json`, `poetry.lock`, `Cargo.lock`, `go.sum`). Pin direct dependencies to exact versions or tight semver ranges in production. Lockfiles must be committed to version control -- they are the source of truth for reproducible builds.

### 4. Automate Updates, Review Thoughtfully

Use automated update tools (Dependabot, Renovate) to surface available updates, but never blindly merge. Require CI to pass, review changelogs for breaking changes, and enforce a minimum release age for auto-merged updates to avoid supply chain attacks via newly published malicious versions.

### 5. Secure the Supply Chain

Verify provenance of packages. Use registry-native integrity checks (npm `integrity`, pip `--require-hashes`, cargo checksums). Adopt SBOM generation and SLSA provenance verification for critical software. Treat AI-suggested packages with extra scrutiny -- hallucinated package names (slopsquatting) are a real attack vector.

### 6. Prefer Wrapping Over Direct Coupling

Isolate third-party dependencies behind internal interfaces (wrappers, adapters, facades). This reduces blast radius when upgrading or replacing a dependency and keeps domain code decoupled from external APIs.

### 7. Keep Dependency Trees Shallow

Deep transitive dependency chains amplify risk. Prefer packages with few transitive dependencies. When evaluating alternatives, the package with fewer sub-dependencies is often the better choice, all else being equal.

## Workflow

### Adding a New Dependency

#### 1. Justify the Need

- [ ] Confirm the functionality cannot be achieved with the standard library
- [ ] Confirm no existing dependency already provides this capability
- [ ] Document why this dependency is needed (PR description or ADR)

#### 2. Evaluate Candidates

- [ ] Compare at least 2 alternatives when feasible
- [ ] Run the Package Health Assessment (see `references/package-evaluation.md`)
- [ ] Check license compatibility with your project
- [ ] Review transitive dependency count (`npm ls`, `pip show`, `cargo tree`)
- [ ] Search for known vulnerabilities (`npm audit`, `pip-audit`, `cargo audit`)

#### 3. Install and Configure

- [ ] Install with exact version or tight range
- [ ] Verify lockfile is updated and committed
- [ ] Add to appropriate dependency group (production vs dev vs optional)
- [ ] Create wrapper/adapter if the dependency touches more than 3 files

#### 4. Validate

- [ ] Run full test suite
- [ ] Verify build succeeds in CI
- [ ] Check bundle size impact (for frontend packages)
- [ ] Run security audit with no new high/critical findings

### Upgrading a Dependency

#### 1. Assess the Upgrade

- [ ] Read changelog and release notes for all versions between current and target
- [ ] Identify breaking changes and required code modifications
- [ ] For major upgrades, upgrade through each major version sequentially

#### 2. Execute the Upgrade

- [ ] Update version in manifest and regenerate lockfile
- [ ] Apply code changes required by breaking changes
- [ ] Run full test suite and fix failures
- [ ] Test in staging/preview environment before merging

#### 3. Verify

- [ ] CI passes with no regressions
- [ ] No new security vulnerabilities introduced
- [ ] Bundle size impact is acceptable
- [ ] Performance benchmarks show no regressions

## Quick Reference -- Package Health Signals

| Signal | Healthy | Warning | Critical |
|---|---|---|---|
| Last commit | < 3 months | 3-12 months | > 12 months |
| Open issues response | Maintainer responds | Slow response | No response |
| Release cadence | Regular releases | Infrequent | None in 12+ months |
| Known vulnerabilities | 0 high/critical | Patched within 30d | Unpatched high/critical |
| Downloads trend | Stable or growing | Declining | Steep decline |
| Bus factor | 3+ maintainers | 2 maintainers | 1 maintainer |
| License | OSI-approved, compatible | Uncommon but compatible | Incompatible or none |
| Transitive deps | < 10 | 10-50 | > 50 |
| OpenSSF Scorecard | 7+ | 4-6 | < 4 |

## Quick Reference -- Ecosystem Commands

| Task | npm/Node | Python/pip | Rust/Cargo | Go |
|---|---|---|---|---|
| Add dependency | `npm install pkg` | `pip install pkg` | `cargo add pkg` | `go get pkg` |
| Audit vulnerabilities | `npm audit` | `pip-audit` | `cargo audit` | `govulncheck ./...` |
| List dependency tree | `npm ls --all` | `pipdeptree` | `cargo tree` | `go mod graph` |
| Check outdated | `npm outdated` | `pip list --outdated` | `cargo outdated` | `go list -m -u all` |
| Update lockfile | `npm install` | `pip freeze > ...` | `cargo update` | `go mod tidy` |
| Verify integrity | `npm ci` | `pip install --require-hashes` | built-in | `go mod verify` |

## Checklist

### Before Adding a Dependency

- [ ] **Justification**: Need documented; standard library cannot fulfill it
- [ ] **Health check**: Package passes health assessment (see quick reference above)
- [ ] **License**: Compatible with project license
- [ ] **Security**: No unpatched high/critical vulnerabilities
- [ ] **Size**: Transitive dependency count is acceptable
- [ ] **Alternatives**: At least one alternative was considered

### Ongoing Maintenance

- [ ] **Automation**: Dependabot or Renovate configured for the repository
- [ ] **Lockfile**: Committed to version control and kept up to date
- [ ] **Audit**: `npm audit` / `pip-audit` / `cargo audit` runs in CI
- [ ] **SBOM**: Generated for releases (if required by compliance)
- [ ] **Review cadence**: Dependencies reviewed quarterly for health signals
- [ ] **Wrapper pattern**: High-churn dependencies isolated behind interfaces

### Supply Chain Security

- [ ] **Integrity**: Lockfile hashes verified during CI install (`npm ci`, `--require-hashes`)
- [ ] **Provenance**: Signed provenance checked for critical packages
- [ ] **Slopsquatting**: AI-suggested package names verified against registry before install
- [ ] **Scoped packages**: Private packages use scoped names to prevent confusion attacks
- [ ] **Registry config**: `.npmrc` / `pip.conf` restricts to trusted registries

## When to Escalate

Escalate to human review when any of these conditions arise:

- **License conflict** -- Candidate dependency has a viral license (GPL, AGPL) and the project is proprietary
- **Sole maintainer abandonment** -- Critical dependency has a single maintainer who has stopped responding
- **Supply chain incident** -- Evidence of typosquatting, dependency confusion, or compromised package
- **Major version jump** -- Upgrading across 2+ major versions with extensive breaking changes
- **Vendoring decision** -- Team must decide whether to vendor, fork, or replace a problematic dependency
- **Transitive vulnerability** -- High/critical CVE in a transitive dependency with no upstream fix available
- **Compliance requirement** -- SBOM, SLSA, or provenance requirements mandated by contract or regulation
- **AI-hallucinated package** -- Agent suggests installing a package that does not exist in the registry
