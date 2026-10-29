# Vendoring and Forking

Decision framework for when to vendor, fork, wrap, or directly depend on third-party code.

## Strategy Overview

There are four strategies for consuming third-party code, each with distinct tradeoffs:

| Strategy | Description | Update Burden | Isolation | Best For |
|---|---|---|---|---|
| **Direct Depend** | Standard package manager dependency | Low (automated) | None | Well-maintained, active packages |
| **Wrap** | Depend + isolate behind an internal interface | Low | Medium | Packages you may replace later |
| **Vendor** | Copy source into your repo | High (manual) | Full | Small, stable, "done" packages |
| **Fork** | Clone the repo, maintain independently | Highest | Full | Packages needing custom patches |

## Decision Flowchart

```
Is the package well-maintained and actively developed?
├── YES: Is the API stable and unlikely to change?
│   ├── YES: Direct depend (pin version, use lockfile)
│   └── NO: Wrap (adapter pattern isolates churn)
└── NO: Is the package small and "done" (< 500 LOC)?
    ├── YES: Vendor (copy into your codebase)
    └── NO: Do you need custom modifications?
        ├── YES: Fork (maintain your own branch)
        └── NO: Find an alternative package
```

## When to Vendor

Vendoring means copying the dependency source code directly into your repository.

**Good candidates for vendoring:**

- Trivial utilities (< 200 LOC) -- e.g., a single function like `leftPad`, `debounce`
- "Done" packages that have not changed in years and are feature-complete
- Packages with zero transitive dependencies
- Build-time-only utilities where you need deterministic behavior
- Situations where network access during install is restricted

**Bad candidates for vendoring:**

- Packages with frequent security patches (you must apply them manually)
- Packages with deep transitive dependency trees
- Packages under active development with regular breaking changes
- Large frameworks or libraries (maintenance burden too high)

**Vendoring process:**

1. Copy source files into a `vendor/` or `third_party/` directory
2. Preserve the original license file alongside the vendored code
3. Document the source URL, version/commit hash, and date of vendoring
4. Create a `VENDORED.md` or comment block with update instructions
5. Set a calendar reminder to check for security updates quarterly

```
vendor/
├── debounce/
│   ├── LICENSE          # Original license (required)
│   ├── ORIGIN.md        # Source URL, commit hash, date
│   ├── index.js         # Vendored source
│   └── index.test.js    # Vendored tests (recommended)
```

**Vendoring metadata template (`ORIGIN.md`):**

```markdown
# Vendored: debounce

- **Source:** https://github.com/example/debounce
- **Version:** 1.2.3 (commit abc123)
- **Vendored on:** 2025-06-15
- **License:** MIT
- **Modifications:** None
- **Update instructions:** Download latest from source, replace files, run tests
```

## When to Fork

Forking means creating your own copy of the repository and maintaining it.

**Good candidates for forking:**

- You need a bug fix or feature that upstream will not merge
- Upstream is abandoned but the package is too large to vendor
- You need to patch a security vulnerability with no upstream fix
- The package needs modifications for your specific platform or environment

**Bad candidates for forking:**

- You just want a newer version (use the upstream version instead)
- The modification is small enough to monkey-patch or wrap
- Upstream is active and likely to accept your contribution (submit a PR instead)

**Fork maintenance checklist:**

1. Create a clearly named fork: `@yourorg/package-name` or `yourorg-package-name`
2. Document why you forked in the README
3. Track the upstream branch to enable periodic rebasing
4. Set up CI on your fork to catch regressions
5. Periodically attempt to merge upstream changes
6. Re-evaluate quarterly: Has upstream addressed your need? Can you un-fork?

```bash
# Track upstream for periodic sync
git remote add upstream https://github.com/original/package.git
git fetch upstream

# Rebase your changes on top of upstream
git rebase upstream/main
```

**Fork exit strategy:**

Always plan to return to upstream. Before forking, open an issue or PR upstream explaining your need. If upstream eventually addresses it, migrate back.

## When to Wrap

Wrapping means depending on the package normally but isolating it behind an internal interface.

**Good candidates for wrapping:**

- Packages with unstable or frequently changing APIs
- Packages you might replace with an alternative in the future
- Packages used across many files in your codebase (> 3 import sites)
- Packages where you only use a subset of the API

**Wrapper pattern:**

```typescript
// src/lib/http-client.ts -- Wraps 'axios' behind a stable internal interface

import axios from 'axios';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';

export interface HttpResponse<T> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

export async function get<T>(url: string, config?: Record<string, unknown>): Promise<HttpResponse<T>> {
  const response: AxiosResponse<T> = await axios.get(url, config as AxiosRequestConfig);
  return {
    data: response.data,
    status: response.status,
    headers: response.headers as Record<string, string>,
  };
}

// When replacing axios with fetch or undici:
// 1. Only this file changes
// 2. All consumers use the stable HttpResponse interface
// 3. No import changes across the codebase
```

**Benefits of wrapping:**

- Dependency replacement requires changing only the wrapper file
- You control the interface your codebase depends on
- You can add cross-cutting concerns (logging, retries, metrics) in one place
- Testing is easier -- mock the wrapper, not the package

## Pinning as an Alternative

Before vendoring, consider whether version pinning achieves your goals:

| Concern | Vendoring Solves | Pinning Solves |
|---|---|---|
| Reproducible builds | Yes | Yes (with lockfile) |
| No network during install | Yes | No |
| Avoiding breaking changes | Yes | Yes |
| Easy rollback to previous version | No (manual) | Yes (`git revert`) |
| Automatic security updates | No | Yes (with tools) |
| Air-gapped environments | Yes | Only with registry mirror |

**Recommendation:** Prefer pinning + lockfiles over vendoring in most cases. Vendor only when pinning is insufficient (air-gapped builds, trivial utilities, abandoned packages).

## Decision Matrix Summary

| Scenario | Strategy |
|---|---|
| Active package, stable API | Direct depend |
| Active package, unstable API | Wrap |
| Abandoned, small, no deps | Vendor |
| Abandoned, large, or needs patches | Fork |
| Trivial utility (< 50 LOC) | Vendor or reimplement |
| Needs custom modifications, upstream active | Submit PR upstream, wrap in the interim |
| Needs custom modifications, upstream dead | Fork |
| Security-critical with no upstream fix | Fork + patch immediately |
| Transient build tool | Direct depend (dev dependency) |
