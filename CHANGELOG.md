# Changelog

AFD's four implementations are versioned and released independently, and each keeps its own changelog. This file is the index.

| Implementation | Package | Changelog | Release tags |
|---|---|---|---|
| TypeScript | Nine `@lushly-dev/*` packages on npm, which share one version | One per package, [listed below](#npm-packages) | `@lushly-dev/<package>@X.Y.Z` |
| Python | [`afd`](https://pypi.org/project/afd/) on PyPI | [python/CHANGELOG.md](python/CHANGELOG.md) | `python-vX.Y.Z` |
| Rust | `afd` on crates.io (first release pending) | [packages/rust/CHANGELOG.md](packages/rust/CHANGELOG.md) | `rust-vX.Y.Z` |
| C++ | `afd-cpp`, consumed through CMake | [packages/cpp/CHANGELOG.md](packages/cpp/CHANGELOG.md) | `cpp-vX.Y.Z` |

## npm packages

Changesets writes these changelogs when it versions the packages.

| Package | Changelog |
|---|---|
| `@lushly-dev/afd-core` | [packages/core/CHANGELOG.md](packages/core/CHANGELOG.md) |
| `@lushly-dev/afd-server` | [packages/server/CHANGELOG.md](packages/server/CHANGELOG.md) |
| `@lushly-dev/afd-client` | [packages/client/CHANGELOG.md](packages/client/CHANGELOG.md) |
| `@lushly-dev/afd-auth` | [packages/auth/CHANGELOG.md](packages/auth/CHANGELOG.md) |
| `@lushly-dev/afd-cli` | [packages/cli/CHANGELOG.md](packages/cli/CHANGELOG.md) |
| `@lushly-dev/afd-testing` | [packages/testing/CHANGELOG.md](packages/testing/CHANGELOG.md) |
| `@lushly-dev/afd-view-state` | [packages/view-state/CHANGELOG.md](packages/view-state/CHANGELOG.md) |
| `@lushly-dev/afd-adapters` | [packages/adapters/CHANGELOG.md](packages/adapters/CHANGELOG.md) |
| `@lushly-dev/local-db` | [packages/local-db/CHANGELOG.md](packages/local-db/CHANGELOG.md) |

## Recording a change

- **An `@lushly-dev/*` package:** run `pnpm changeset` and commit the file it creates.
- **Python, Rust or C++:** add an entry to that implementation's changelog, in its unreleased section.
- **Anything else** (CI, docs, examples, alfred) ships in no package, so its pull request is the record.

The [`do-release` skill](.claude/skills/do-release/SKILL.md) describes how each implementation is released.

## Earlier history

Until 2026-09-27 this file was one changelog for the whole repository. That history is in [docs/changelog-archive.md](docs/changelog-archive.md), except for the Python and Rust entries, which moved to their own changelogs.
