# Changelog

Everything released from this repository is versioned independently and keeps its own changelog: AFD's four implementations, and the other projects in the family that carry a version. This file is the index.

## AFD

| Implementation | Package | Changelog | Release tags |
|---|---|---|---|
| TypeScript | Nine `@lushly-dev/*` packages on npm, which share one version | One per package, [listed below](#npm-packages) | `@lushly-dev/<package>@X.Y.Z` |
| Python | [`afd`](https://pypi.org/project/afd/) on PyPI | [python/CHANGELOG.md](python/CHANGELOG.md) | `python-vX.Y.Z` |
| Rust | [`afd`](https://crates.io/crates/afd) on crates.io | [packages/rust/CHANGELOG.md](packages/rust/CHANGELOG.md) | `rust-vX.Y.Z` |
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

## The rest of the family

Specimen and `@lushly-dev/fast-element` are published to npm under the `preview` tag and Botcore to PyPI; the Violet packages are versioned here but not published from this repository yet. Umbel, Loam and Health have no release, so their status files are the record ([Umbel](endpoints/umbel/docs/STATUS.md), [Loam](endpoints/loam/docs/STATUS.md)).

| Project | Package | Changelog |
|---|---|---|
| Specimen | `@lushly-dev/specimen` | [foundations/specimen/CHANGELOG.md](foundations/specimen/CHANGELOG.md) |
| Specimen | `@lushly-dev/specimen-afd` | [integrations/specimen-afd/CHANGELOG.md](integrations/specimen-afd/CHANGELOG.md) |
| Specimen | `@lushly-dev/specimen-fast-af` | [integrations/specimen-fast-af/CHANGELOG.md](integrations/specimen-fast-af/CHANGELOG.md) |
| Specimen | `@lushly-dev/specimen-cli` | [endpoints/specimen-cli/CHANGELOG.md](endpoints/specimen-cli/CHANGELOG.md) |
| FAST-AF | `@lushly-dev/fast-element` | [foundations/fast-af/packages/element/packages/fast-element/CHANGELOG.md](foundations/fast-af/packages/element/packages/fast-element/CHANGELOG.md) |
| Violet | `@lushly-dev/violet-core` | [foundations/violet/packages/core/CHANGELOG.md](foundations/violet/packages/core/CHANGELOG.md) |
| Violet | `@lushly-dev/violet-runtime` | [foundations/violet/packages/runtime/CHANGELOG.md](foundations/violet/packages/runtime/CHANGELOG.md) |
| Violet | `@lushly-dev/violet-afd` | [integrations/violet-afd/CHANGELOG.md](integrations/violet-afd/CHANGELOG.md) |
| Violet | `@lushly-dev/violet-cli` | [endpoints/violet-cli/CHANGELOG.md](endpoints/violet-cli/CHANGELOG.md) |
| Violet | `@lushly-dev/violet-server` | [endpoints/violet-server/CHANGELOG.md](endpoints/violet-server/CHANGELOG.md) |
| Botcore | [`lushly-botcore`](https://pypi.org/project/lushly-botcore/) on PyPI | [endpoints/botcore/CHANGELOG.md](endpoints/botcore/CHANGELOG.md) |
| Alfred | `alfred`, this repository's quality bot | [alfred/CHANGELOG.md](alfred/CHANGELOG.md) |

Specimen's four prebuilt host packages keep changelogs beside them, in `foundations/specimen/packages/`. The shared AFD contract has its own: [spec/CHANGELOG.md](spec/CHANGELOG.md).

## Recording a change

- **An `@lushly-dev/*` package**, in AFD or in a project above: run `pnpm changeset` and commit the file it creates.
- **Python, Rust, C++, Botcore or Alfred:** add an entry to that changelog, in its unreleased section.
- **Anything else** (CI, docs, examples, unreleased projects) ships in no package, so its pull request is the record.

The [`cut-release` skill](.claude/skills/cut-release/SKILL.md) describes how each one is released.

## Earlier history

Until 2026-09-27 this file was one changelog for the whole repository. That history is in [docs/changelog-archive.md](docs/changelog-archive.md), except for the Python and Rust entries, which moved to their own changelogs.
