# Changesets

This folder is managed by [@changesets/cli](https://github.com/changesets/changesets).

When you make a change that should be released, run:

```bash
pnpm changeset
```

This creates a changeset file describing the change and its semver impact.
The Release workflow runs `pnpm check` before Changesets can act. At release time,
`pnpm version-packages` selects complete admitted units, consumes only their
compatible fragments, and updates their manifests/changelogs in a disposable
workspace. The reviewed release PR records `.release/npm-intent.json`; guarded
artifact planning and publication validate that selection after merge.

The nine existing AFD npm packages form the explicit **afd-npm fixed group**.
Other foundation/integration/endpoint families may have independent versions and
release batches. Registry scope does not define group membership. Held units
retain their release records; shared fragments require coordinated selection.

Changesets only version the published npm packages in this monorepo.

This directory contains npm package-to-semver fragments only. Botcore category
fragments use separately owned storage. See [platform release controls](../docs/operations/platform-releases.md).

- If you changed one or more `@lushly-dev/*` packages, add a changeset.
- If you changed only `python/`, `packages/rust/`, `packages/cpp/` or docs/skills, do not add
  a no-op changeset.
- Record Python, Rust and C++ changes in `python/CHANGELOG.md`, `packages/rust/CHANGELOG.md`
  and `packages/cpp/CHANGELOG.md`. Each is released on its own `python-v*`, `rust-v*` or
  `cpp-v*` tag; the `do-release` skill has the steps.
