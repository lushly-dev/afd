# Changesets

Add a changeset when your PR includes user-facing changes:

```bash
pnpm changeset
```

This prompts for affected packages, semver bump type, and a summary.
The changeset file is committed with your PR.

When merged, the release workflow creates a version PR. Merging that PR publishes to npm.
