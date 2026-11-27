# Changesets

This folder is managed by [@changesets/cli](https://github.com/changesets/changesets).

When you make a change that should be released, run:

```bash
pnpm changeset
```

This creates a changeset file describing the change and its semver impact.
The Release workflow runs `pnpm check:all` before an approved publication (`ci.yml` gates every change before that). At release time,
`pnpm version-packages` selects complete admitted units, consumes only their
compatible fragments, and updates their manifests/changelogs in a disposable
workspace. The reviewed release PR records `.release/npm-intent.json`; guarded
artifact planning and publication validate that selection after merge.

The nine existing AFD npm packages form the explicit **afd-npm fixed group**.
Other foundation/integration/endpoint families may have independent versions and
release batches. Registry scope does not define group membership. Held units
retain their release records; shared fragments require coordinated selection.

Changesets versions the published npm packages and three private stubs. Each stub holds the
version of something that has no npm package and is released on its own track:

| Fragment names | For a change in | Bump | Body |
|---|---|---|---|
| `"afd-python"` | `python/` | `minor` or `patch` | Entries under `### Added`, `### Changed`, `### Fixed` and the other Keep a Changelog headings |
| `"lushly-botcore"` | `endpoints/botcore/` | `minor` or `patch` | The same |
| `"afd-spec"` | `spec/` | always `patch` | Prose paragraphs, no heading |

A fragment for a stub names only that stub; a change that also touches an npm package gets a
second file. `pnpm version-track <python|botcore|spec>` consumes a track's fragments when its
release is prepared: it writes the dated changelog section and copies the version to
`pyproject.toml` and `__version__`. The npm version PR never touches them. `prepare-pr` step 3
has the format in full and the `cut-release` skill the steps.

This directory contains package-to-semver fragments only. Botcore's own category fragments
(`botcore changeset-create`, for repositories without Changesets) use separately owned storage.
See [platform release controls](../docs/operations/platform-releases.md).

- If you changed one or more `@lushly-dev/*` packages, add a changeset. It is the change's only
  record: Changesets writes each package's `CHANGELOG.md` from it, so never add an `Unreleased`
  section there by hand (`pnpm check:tracks` fails).
- If you changed `python/`, `endpoints/botcore/` or `spec/` in a way a user sees, add a fragment
  that names its stub. Never add to `python/CHANGELOG.md`, `endpoints/botcore/CHANGELOG.md` or
  `spec/CHANGELOG.md` by hand: `pnpm check:tracks` fails.
- If you changed only `packages/rust/`, `packages/cpp/` or docs/skills, do not add a no-op
  changeset. Record Rust and C++ changes in `packages/rust/CHANGELOG.md` and
  `packages/cpp/CHANGELOG.md`. Each is released on its own `rust-v*` or `cpp-v*` tag; the
  `cut-release` skill has the steps.
