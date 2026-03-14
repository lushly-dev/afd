# Changesets

This folder is managed by [@changesets/cli](https://github.com/changesets/changesets).

When you make a change that should be released, run:

```bash
pnpm changeset
```

This creates a changeset file describing the change and its semver impact.
At release time, `pnpm changeset version` consumes all changesets, bumps versions,
and updates CHANGELOG.md automatically.

All `@lushly-dev/*` packages use **fixed versioning** — they always share the same version number.
