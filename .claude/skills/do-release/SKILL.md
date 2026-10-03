---
name: do-release
source: botcore
description: >
  Version bump, changelog finalize, build, test, tag, publish to registries, and create GitHub Release. Covers AFD's four release paths: TypeScript (npm, Changesets), Python (PyPI), Rust (crates.io) and C++ (CMake, tags only), with their tag schemes, the contract version, and the steps that unblock npm publishing. Delegates to manage-git for tagging strategy and manage-documentation for changelog format. Use when ready to release a new version.

version: 1.1.0
triggers:
  - do release
  - release
  - version bump
  - publish
  - tag release
  - ship release
  - cut release
argument-hint: npm | python | rust | cpp
portable: true
user-invocable: true
---

# Do Release

AFD ships four implementations. Each follows semver on its own API, has its own version, changelog, tag scheme and release path, and is released on its own schedule. Before 1.0, a minor release may break the API.

## Release tracks

| Implementation | Version lives in | Changelog | Tag | Published by |
|---|---|---|---|---|
| TypeScript: nine `@lushly-dev/*` packages, one fixed version | each `package.json` (Changesets bumps them) | `packages/*/CHANGELOG.md` (Changesets writes them) | `@lushly-dev/<package>@X.Y.Z`, created by Changesets | `release.yml` → npm |
| Python `afd` | `python/pyproject.toml` and `__version__` in `python/src/afd/__init__.py` | `python/CHANGELOG.md` | `python-vX.Y.Z` | `publish-python.yml` → PyPI |
| Rust `afd` crate | `packages/rust/Cargo.toml` | `packages/rust/CHANGELOG.md` | `rust-vX.Y.Z` | `publish-rust.yml` → crates.io |
| C++ `afd-cpp` | `project(afd VERSION …)` in `packages/cpp/CMakeLists.txt` | `packages/cpp/CHANGELOG.md` | `cpp-vX.Y.Z` | Nothing: consumers fetch the tag with CMake |

**Rules:**

- The root `CHANGELOG.md` is an index of these changelogs. Never add release notes to it.
- Record a change in the changelog of the implementation it touches. Do not add a no-op changeset for Python, Rust, C++ or docs-only work.
- **Publishing is irreversible, and it is the maintainer's job.** An agent prepares the release pull request: version bump, changelog and docs. It does not push tags, create GitHub Releases, run a publish, or change repository, npm, PyPI or crates.io settings.

## Contract version

The versioning plan adds a `MAJOR.MINOR` version for the shared AFD contract (`spec/wire`, `spec/pipeline-variables.md`, `spec/vectors` and the conformance suite), stored in `spec/VERSION`. Each implementation exports the version it implements: `AFD_CONTRACT_VERSION` (`@lushly-dev/afd-core`), `afd.CONTRACT_VERSION`, `afd::CONTRACT_VERSION` (Rust) and `afd::contract_version` (C++). It reads `1.0-rc` until all four languages load every vector file.

**`spec/VERSION` does not exist yet.** Until it does, skip the contract steps below. Once it exists, every release also:

- checks that the implementation's constant matches `spec/VERSION` (`alfred parity` reports a mismatch);
- names the contract version it implements in its changelog section;
- updates the Contract row in `docs/language-parity.md`.

## Release checklist

Every release, whatever the implementation:

- [ ] The implementation's CI is green on `main`: `ci.yml` (TypeScript), `python.yml`, `rust.yml` or `cpp.yml`, and `conformance.yml`.
- [ ] Its changelog has a dated section for the version, with breaking changes first and migration notes for each.
- [ ] The version is changed everywhere the track lists below.
- [ ] `docs/language-parity.md`: the implementation's column in the **Version** row shows the new version (`node scripts/check-versions.mjs --write` sets it from the manifest), the **Distribution** row is still true (for example after the first crates.io release or the first C++ tag), and the **Updated** date is today.
- [ ] Contract version checked, once `spec/VERSION` exists.
- [ ] After the maintainer tags or merges: the package is installable and the tag exists.

## TypeScript (npm, Changesets)

1. **During development:** each pull request that changes a published `@lushly-dev/*` package adds a changeset with `pnpm changeset` (patch, minor or major) and commits the file in `.changeset/`.
2. **Version PR:** on every push to `main`, `release.yml` runs `pnpm check`. If changesets are pending, `changesets/action` opens a "chore: release packages" pull request that runs `pnpm version-packages`: `changeset version` bumps all nine packages to one version and writes their changelogs, then `node scripts/check-versions.mjs --write` updates the TypeScript column of the Version row in `docs/language-parity.md`. The release commit therefore carries the docs change, and the `versions` pre-push hook, which runs when `changesets/action` pushes `changeset-release/main`, passes.
3. **Publish:** merging that pull request runs `release.yml` again. With no changesets pending, it runs `pnpm publish:npm` (`changeset publish`), which publishes with provenance and creates the `@lushly-dev/<package>@X.Y.Z` tags and GitHub Releases.
4. **Verify:** `npm view @lushly-dev/afd-core version`.

Configuration is in `.changeset/config.json`: `"fixed": [["@lushly-dev/*"]]` keeps one version, `"access": "public"`, and `@changesets/changelog-github` links pull requests. Internal peer dependencies use `workspace:^` (published as `^X.Y.Z`), and `onlyUpdatePeerDependentsWhenOutOfRange` (under `___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH`) stops Changesets from giving a peer dependent a major bump while the new version stays in range. Without both, any minor bump became a major one, and the fixed group spread it to all nine packages. Check `pnpm changeset status --verbose` before merging a changeset whose bump level matters. Both automated steps need the npm credential and the Actions permission described in [Unblocking npm](#unblocking-npm).

## Python (PyPI)

1. Set the version in `python/pyproject.toml` and `__version__` in `python/src/afd/__init__.py`.
2. Run `uv lock` in `python/`, `alfred/` and `packages/examples/todo/backends/python/`. All three lockfiles record the `afd` version, and `python.yml` runs `uv lock --check`.
3. In `python/CHANGELOG.md`, date the release section, add an empty `## [Unreleased]` above it, and update its compare link.
4. Run `node scripts/check-versions.mjs --write`. It updates the Python column of the Version row in `docs/language-parity.md` from `pyproject.toml`, and fails if `pyproject.toml` and `__version__` disagree.
5. Commit `chore(python): release afd X.Y.Z`, open a pull request, and merge it after `python.yml` passes.
6. **Maintainer:** tag the merge commit and push the tag.
   ```bash
   git tag python-vX.Y.Z <merge-commit-sha>
   git push origin python-vX.Y.Z
   ```
   `publish-python.yml` checks that the tag matches `pyproject.toml`, runs the tests, builds, and publishes with PyPI trusted publishing (environment `pypi`).
7. **Optional:** create a GitHub Release from the tag, with the changelog section as notes. Publishing a GitHub Release whose tag starts with `python-v` also runs `publish-python.yml`: the version check runs again, and the upload skips files already on PyPI. Releases with any other tag do not run it.
8. **Verify:** `pip index versions afd`, or <https://pypi.org/project/afd/>.

**0.9.0** is drafted in `python/CHANGELOG.md`, with its own checklist. It waits for the in-flight Python fixes (#304 and others).

## Rust (crates.io)

1. Set the version in `packages/rust/Cargo.toml`.
2. Date the release section in `packages/rust/CHANGELOG.md` and add an empty `## [Unreleased]` above it.
3. Run `cd packages/rust && cargo publish --dry-run`, and the `rust.yml` checks: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, and both again with `--no-default-features`.
4. Run `node scripts/check-versions.mjs --write`. It updates the Rust column of the Version row in `docs/language-parity.md` from `Cargo.toml`, and the README's Rust badge from `rust-version`.
5. Commit `chore(rust): release afd X.Y.Z`, open a pull request, and merge it after `rust.yml` passes.
6. **Maintainer:** tag the merge commit `rust-vX.Y.Z` and push the tag. `publish-rust.yml` checks that the tag matches `Cargo.toml`, runs `rust.yml`, and then runs `cargo publish` with a short-lived token from crates.io trusted publishing (`rust-lang/crates-io-auth-action`, environment `crates-io`). If crates.io already has that version, it skips the upload.
7. **Verify:** <https://crates.io/crates/afd> and <https://docs.rs/afd>.

### First release: 0.1.0

crates.io offers trusted publishing only for a crate that already exists, so the maintainer publishes 0.1.0 by hand, once. The name `afd` was free on crates.io on 2026-09-27.

1. **In the release pull request**, also:
   - change the Installation section of `packages/rust/README.md` to `cargo add afd`. The README is packaged into the crate and shown on crates.io.
   - drop the "not on crates.io yet" comment in the `afd-rust` skill;
   - change the Rust Distribution row in `docs/language-parity.md` to crates.io.
2. **Maintainer**, on the merge commit, with a crates.io API token that can publish new crates:
   ```bash
   cargo login
   cd packages/rust && cargo publish
   ```
3. **Maintainer**, on crates.io under the crate's Settings → Trusted Publishing, adds a GitHub publisher: owner `lushly-dev`, repository `afd`, workflow `publish-rust.yml`, environment `crates-io`. Then revoke the API token.
4. **Maintainer** pushes `rust-v0.1.0` for the same commit. `publish-rust.yml` runs its checks and skips the upload, because 0.1.0 is already on crates.io. Later versions publish through the workflow.

## C++ (CMake)

afd-cpp is on no registry. A release is a tag and a GitHub Release, and consumers use `FetchContent` with `GIT_TAG cpp-vX.Y.Z`, `find_package(afd X.Y CONFIG)` after installing, or `add_subdirectory`.

1. Set `project(afd VERSION X.Y.Z)` in `packages/cpp/CMakeLists.txt`. It generates `afd/version.hpp`, and the CMake package uses `SameMinorVersion` compatibility.
2. In `packages/cpp/CHANGELOG.md`, move `Unreleased` under the new version with the date, and add an empty `Unreleased` above it.
3. Run `node scripts/check-versions.mjs --write` to update the C++ column of the Version row in `docs/language-parity.md`. For the first release, `cpp-v0.1.0`, also remove "not cut yet" from the C++ README (status note, Using the package and the `FetchContent` example), the Distribution row in `docs/language-parity.md` and `docs/features/README.md`, and move the C++ proposal to `docs/features/complete/`.
4. Merge after `cpp.yml` and `conformance.yml` pass on `main`.
5. **Maintainer:** tag the merge commit `cpp-vX.Y.Z`, push the tag, and create a GitHub Release from the changelog section.

## Unblocking npm

As of 2026-09-27, npm has 1.0.0 while `main` has 2.0.0, versioned by the release pull request #252 (commit `b4a94e6`). Two failures block it:

1. The 2.0.0 publish failed with `E404 Not Found - PUT …/@lushly-dev%2fafd-adapters`, next to npm's notice that tokens which bypass 2FA are being restricted: npm no longer accepts the `NPM_TOKEN` credential.
2. Since then, every Release run fails to open the version pull request: "GitHub Actions is not permitted to create or approve pull requests."

These steps change security settings, so the maintainer does them, in this order:

1. **npm authentication.** Either:
   - **Trusted publishing (preferred).** On npmjs.com, for each of the nine packages, add a trusted publisher: GitHub Actions, organization `lushly-dev`, repository `afd`, workflow `release.yml`. `release.yml` already requests `id-token: write` and provenance, and runs Node 24, whose npm meets trusted publishing's minimum (npm 11.5.1). `changeset publish` publishes through `pnpm publish`; if that does not pick up the OIDC credential, use the token instead. Once trusted publishing works, a follow-up pull request removes `NODE_AUTH_TOKEN` from `release.yml`, and the `NPM_TOKEN` secret can be deleted.
   - **A new token.** Create a granular access token that can publish the `@lushly-dev` packages, and store it as the `NPM_TOKEN` repository secret.
2. **Let Actions open pull requests.** In the repository's Settings → Actions → General → Workflow permissions, allow GitHub Actions to create and approve pull requests. Alternatively, give `changesets/action` a GitHub App token.
3. **Publish 2.0.0.** Re-run the failed Release run [35950563235](https://github.com/lushly-dev/afd/actions/runs/35950563235) for `b4a94e6` (Re-run all jobs, or `gh run rerun 35950563235`).
   - `b4a94e6` has no pending changesets, so Changesets publishes and tags exactly 2.0.0.
   - A re-run uses `release.yml` as it was at `b4a94e6`, which passes `NPM_TOKEN` as `NODE_AUTH_TOKEN` and requests `id-token: write`, so either credential from step 1 applies.
   - Do not wait for a new push instead: `main` has a pending changeset, so a Release run there opens the 2.1.0 version pull request, and 2.0.0 would never reach npm.
   - GitHub allows a re-run for 30 days after the original run, which started on 2026-09-24.
4. **Next:** the following push to `main` opens the 2.1.0 release pull request. Check `npm view @lushly-dev/afd-core version` and the `@lushly-dev/*@2.0.0` tags.

## Reference

See [release-checklist.md](references/release-checklist.md) for the expanded checklist.
