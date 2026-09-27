# Changesets

This folder is managed by [@changesets/cli](https://github.com/changesets/changesets).

When you make a change that should be released, run:

```bash
pnpm changeset
```

This creates a changeset file describing the change and its semver impact.
The Release workflow runs `pnpm check` before Changesets can act. At release time,
`pnpm version-packages` consumes all changesets, bumps versions, and updates
CHANGELOG.md automatically. Merging that release PR lets the same workflow publish.

All `@lushly-dev/*` packages use **fixed versioning** — they always share the same version number.

Changesets only version the published npm packages in this monorepo.

- If you changed one or more `@lushly-dev/*` packages, add a changeset.
- If you changed only `python/`, `packages/rust/`, `packages/cpp/` or docs/skills, do not add
  a no-op changeset.
- Record Python, Rust and C++ changes in `python/CHANGELOG.md`, `packages/rust/CHANGELOG.md`
  and `packages/cpp/CHANGELOG.md`. Each is released on its own `python-v*`, `rust-v*` or
  `cpp-v*` tag; the `do-release` skill has the steps.
