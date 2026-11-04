---
name: do-release
description: >
  Prepares an AFD release on its track: npm (the Changesets version PR), Python (PyPI),
  Rust (crates.io) or C++ (tag only), with tag schemes, the contract version and
  post-publish checks. Use when asked to cut a release, bump a version or check a publish.
argument-hint: npm | python | rust | cpp
---

# Do Release

AFD's four implementations each follow semver on their own API, with their own version, changelog, tag and release path; before 1.0 a minor release may break the API. They are the four admitted units in `scripts/release/inventory.json`. Every other unit there is quarantined and has no release path: stop and ask.

**Publishing is irreversible and is the maintainer's job.** An agent prepares the release PR: version, changelog and docs. It does not push tags, create GitHub Releases, merge the npm version PR (merging it publishes), run a publish workflow, or change repository or registry settings. The one exception is when the session's user, in the current turn, names that irreversible step ("push the `rust-v0.2.2` tag", "merge the version PR"); a request to cut, ship or prepare a release is not that. Then run only the named step, on the reviewed merge commit.

## Tracks

| Track | Version lives in | Changelog | Tag | Published by |
|---|---|---|---|---|
| npm: the nine `afd-npm` packages | each `package.json`, set by Changesets | `packages/*/CHANGELOG.md`, by Changesets | `@lushly-dev/<package>@X.Y.Z`, by the release finalizer | `release.yml` to npm |
| Python `afd` | `python/pyproject.toml` and `__version__` in `python/src/afd/__init__.py` | `python/CHANGELOG.md` | `python-vX.Y.Z` | `publish-python.yml` to PyPI |
| Rust `afd` crate | `packages/rust/Cargo.toml` | `packages/rust/CHANGELOG.md` | `rust-vX.Y.Z` | `publish-rust.yml` to crates.io |
| C++ `afd-cpp` | `project(afd VERSION …)` in `packages/cpp/CMakeLists.txt` | `packages/cpp/CHANGELOG.md` | `cpp-vX.Y.Z` | Nothing: consumers fetch the tag with CMake |

Read current versions from those manifests, and published ones from the registries and `git tag -l`. The private root `package.json` version is not a release; never set one there.

- The root `CHANGELOG.md` is an index; never add release notes to it.
- No no-op changeset for Python, Rust, C++ or docs-only work. A docs or package-description fix waits for the next release; never claim a published artifact changed.
- A hotfix has no separate path: branch from `main` (there are no `release/*` branches), add a `patch` changeset or the track's changelog entry, and follow the track's steps.
- Until the new version or tag is verified, install snippets stay on the last published one. Then update package READMEs, skills, `site/index.html`, `site/js/runtime.js` and `site/llms.txt` together.

## Contract version

`spec/VERSION` (now `1.0-rc`) versions the shared contract: `spec/wire`, `spec/pipeline-variables.md`, `spec/vectors` and the conformance suite. Each implementation exports the version it implements (`AFD_CONTRACT_VERSION`, `afd.CONTRACT_VERSION`, Rust `afd::CONTRACT_VERSION`, C++ `afd::contract_version`). It stays `1.0-rc` until all four languages load every vector file, and changes only through the shared specification process, never in a release. Name it in the changelog section and the tag message; `node scripts/check-versions.mjs` fails when a constant or the Contract row of `docs/language-parity.md` disagrees.

## Every release

- The track's CI and `conformance.yml` are green on the exact candidate, and again on the merge commit.
- Python, Rust and C++ changelogs get a dated section, breaking changes first with migration notes, under a new empty `Unreleased` section.
- `node scripts/check-versions.mjs --write` sets the Version row of `docs/language-parity.md`; check its Distribution row by hand and set its Updated date.
- Verify what the registry or tag actually serves. Never retry a successful publication because a response looked stale.

## npm (Changesets)

1. On every push to `main`, `release.yml` opens or refreshes the version PR, `chore: release packages` on `changeset-release/main`, through `pnpm version-packages`, which also updates the parity docs and commits `.release/npm-intent.json`. `pnpm release:select` shows the selection locally.
2. **Release failures on `main` are silent.** Nothing alerts on a red `release.yml`; read `gh run list --workflow Release --branch main` before assuming a version PR or a publish happened.
3. Review the version PR: the intent, all nine manifests, internal peer ranges, `peerDependenciesMeta` and `pnpm changeset status --verbose`. Exercise optional peers absent and present, especially auth commands and view-state with and without local-db.
4. **The version PR starts without CI.** `release.yml` opens it with `GITHUB_TOKEN`, whose events start no workflows. A person closes and reopens it, and every check must pass before merge (#470 tracks a fix).
5. **Maintainer** merges it; `release.yml` then runs `pnpm check:all`, publishes the approved plan with provenance and pushes the tags. [Platform release controls](../../../docs/operations/platform-releases.md) explains intent, claims and holds.
6. Verify all nine versions at `https://registry.npmjs.org/<name>` rather than a cached `npm view` (listing all nine can take minutes), each tag's target, and a fresh consumer install.

Keep `workspace:^` on internal peer dependencies and `onlyUpdatePeerDependentsWhenOutOfRange` in `.changeset/config.json`: without both, a minor bump became a major one across all nine.

**When an npm publish fails,** read the exact failed run and error before changing anything. Trusted publishing is the only upload path: npm 11.5.1 or later, Node 22.14.0 or later, a GitHub-hosted runner, `id-token: write`, and npm's publisher entry as [recorded](../../../docs/operations/stabilization-release.md#npm-publication-outcome). Never add an npm token as a fallback. A failed or uncertain upload stays held until the reviewed recovery under "Holds and recovery" in platform release controls.

## Python (PyPI)

1. Set the version in `pyproject.toml` and `__version__`; `check-versions` fails if they disagree.
2. Run `uv lock` in `python/` and in each project that locks it as an editable source, `git grep -l -E 'editable = "(\.\./)+python"' -- '*uv.lock'` (alfred, Botcore, Health and the todo backend today). Their workflows fail on a stale lock.
3. Update the compare links at the bottom of `python/CHANGELOG.md`.
4. Commit `chore(python): release afd X.Y.Z`; merge after `python.yml` passes. Run the gate as CI does (`uv sync --frozen --all-extras`): a stale local `.venv` on another interpreter fails test collection with misleading import errors.
5. **Maintainer** tags the merge commit and pushes the tag: `git tag -a python-vX.Y.Z <merge-sha> -m "afd Python X.Y.Z; AFD contract <spec/VERSION>"`. `publish-python.yml` checks the tag against admission and `pyproject.toml`, runs `python.yml` and uploads. A GitHub Release on the tag (`--latest=false`) reruns it, skipping existing files.
6. Verify: download the published wheel, match its SHA-256 to PyPI's, and install base, client, server and CLI in fresh environments on Python 3.10 to 3.12.

## Rust (crates.io)

1. Set the version in `packages/rust/Cargo.toml`.
2. In `packages/rust`, run `cargo publish --dry-run --locked` and the `rust.yml` steps. docs.rs builds each version once, so a failure there costs a patch release, as 0.2.0's did; `rust.yml`'s `docs-rs` job mirrors it in CI, and `pnpm verify` skips it. Reproduce it with `RUSTDOCFLAGS='--cfg docsrs' cargo +nightly doc --all-features --no-deps`: the cfg goes to rustdoc only, since as `RUSTFLAGS` it reaches dependencies whose docsrs paths don't build.
3. Commit `chore(rust): release afd X.Y.Z`; merge after `rust.yml` passes.
4. **Maintainer** tags the merge commit `rust-vX.Y.Z` (annotated, as above) and pushes it. `publish-rust.yml` checks the tag against admission and `Cargo.toml`, runs `rust.yml` with its `docs-rs` job, skips a version crates.io already has, and publishes with a short-lived trusted-publishing token. Create no long-lived token.
5. Verify <https://crates.io/crates/afd>, `"doc_status":true` at `https://docs.rs/crate/afd/<version>/status.json` (failed builds are listed at `/crate/afd/<version>/builds`), the downloaded crate's checksum, and fresh consumers with default and no default features.

A new crate's first version is a one-time manual upload, because crates.io offers trusted publishing only for existing crates; [native-first-releases.md](../../../docs/operations/native-first-releases.md) records 0.1.0's bootstrap.

## C++ (tag only)

1. Set `project(afd VERSION X.Y.Z)`; it generates `afd/version.hpp`. The package uses `SameMinorVersion` compatibility, so a minor bump also updates `find_package(afd X.Y CONFIG REQUIRED)` in `packages/cpp/tests/consumer/CMakeLists.txt`. Only the daily or dispatched `cpp.yml` runs the package jobs that catch a miss, as #454 found.
2. Merge after `cpp.yml` and `conformance.yml` pass. Tag only after a daily or `workflow_dispatch` run of the full `cpp.yml` matrix (sanitizer, macOS, MSVC, Emscripten, package and fuzz legs) passes at the merge commit, or at a later `main` with the same C++ inputs.
3. **Maintainer** tags the merge commit `cpp-vX.Y.Z` (annotated), pushes it, and creates the GitHub Release from the changelog section with `gh release create cpp-vX.Y.Z --verify-tag --latest=false`, so the npm release keeps "Latest".
4. Verify fresh consumers built from the public tag through `FetchContent` (`GIT_TAG cpp-vX.Y.Z`) and an installed `find_package`, checking the header, library and contract versions.
