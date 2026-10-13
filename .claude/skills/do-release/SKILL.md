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

For subsequent package and dependency changes, follow
[Updating packages in the next round](references/next-round.md). It records
current baselines, per-track versioning, OIDC paths and artifact/consumer gates.

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

`spec/VERSION` exists and currently reads `1.0-rc`. Every release also:

- checks that the implementation's constant matches `spec/VERSION` (`alfred parity` reports a mismatch);
- names the contract version it implements in its changelog section;
- updates the Contract row in `docs/language-parity.md`.

## Release checklist

Every release, whatever the implementation:

- [ ] The implementation's CI is green on `main`: `ci.yml` (TypeScript), `python.yml`, `rust.yml` or `cpp.yml`, and `conformance.yml`.
- [ ] Its changelog has a dated section for the version, with breaking changes first and migration notes for each.
- [ ] The version is changed everywhere the track lists below.
- [ ] `docs/language-parity.md`: the implementation's column in the **Version** row shows the new version (`node scripts/check-versions.mjs --write` sets it from the manifest), the **Distribution** row is still true (for example after the first crates.io release or the first C++ tag), and the **Updated** date is today.
- [ ] Contract version checked against `spec/VERSION`.
- [ ] After the maintainer tags or merges: the package is installable and the tag exists.

## TypeScript (npm, Changesets)

1. **During development:** each pull request that changes a published `@lushly-dev/*` package adds a changeset with `pnpm changeset` (patch, minor or major) and commits the file in `.changeset/`.
2. **Version PR:** on every push to `main`, `release.yml` runs `pnpm check`. If changesets are pending, `changesets/action` opens a "chore: release packages" pull request that runs `pnpm version-packages`: `changeset version` bumps all nine packages to one version and writes their changelogs, then `node scripts/check-versions.mjs --write` updates the TypeScript column of the Version row in `docs/language-parity.md`. The release commit therefore carries the docs change, and the `versions` pre-push hook, which runs when `changesets/action` pushes `changeset-release/main`, passes.
3. **Publish:** merging that pull request runs `release.yml` again. With no changesets pending, it runs `pnpm publish:npm` (`changeset publish`), which publishes with provenance and creates the `@lushly-dev/<package>@X.Y.Z` tags and GitHub Releases.
4. **Verify:** all nine fixed-group registry versions, exact Git tag targets and fresh installed consumers; one core lookup is insufficient.

Configuration is in `.changeset/config.json`: `"fixed": [["@lushly-dev/*"]]` keeps one version, `"access": "public"`, and `@changesets/changelog-github` links pull requests. Internal peer dependencies use `workspace:^` (published as `^X.Y.Z`), and `onlyUpdatePeerDependentsWhenOutOfRange` (under `___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH`) stops Changesets from giving a peer dependent a major bump while the new version stays in range. Without both, any minor bump became a major one, and the fixed group spread it to all nine packages. Check `pnpm changeset status --verbose` before merging a changeset whose bump level matters. Version-PR creation needs Actions permission to create pull requests; upload separately needs the npm authorization described in [Unblocking npm](#unblocking-npm).

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

Python **0.9.0** was published on 2026-10-11 from #372's merge commit
`4e16a0699eeb00c5d6576d29be575b86ca8fa485`, tagged `python-v0.9.0`.
[Publish Python run 38175942746](https://github.com/lushly-dev/afd/actions/runs/38175942746)
passed, and all 12 fresh published-wheel installs passed across Python 3.10–3.12
and base/client/server/CLI, including the original base-import reproduction.
#347 is closed. See `docs/operations/stabilization-release.md` for the wheel
digest, registry consumer checks and current npm release sequence.

## Rust (crates.io)

1. Set the version in `packages/rust/Cargo.toml`.
2. Date the release section in `packages/rust/CHANGELOG.md` and add an empty `## [Unreleased]` above it.
3. Run `cd packages/rust && cargo publish --dry-run`, and the `rust.yml` checks: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, and both again with `--no-default-features`.
4. Run `node scripts/check-versions.mjs --write`. It updates the Rust column of the Version row in `docs/language-parity.md` from `Cargo.toml`, and the README's Rust badge from `rust-version`.
5. Commit `chore(rust): release afd X.Y.Z`, open a pull request, and merge it after `rust.yml` passes.
6. **Maintainer:** tag the merge commit `rust-vX.Y.Z` and push the tag. `publish-rust.yml` checks that the tag matches `Cargo.toml`, runs `rust.yml`, and then runs `cargo publish` with a short-lived token from crates.io trusted publishing (`rust-lang/crates-io-auth-action`, environment `crates-io`). If crates.io already has that version, it skips the upload.
7. **Verify:** <https://crates.io/crates/afd> and <https://docs.rs/afd>.

### First release: 0.1.0

`afd` 0.1.0 was published on 2026-10-12 from
`a3115622ce8252a45ffff9d752e3cc161a481035`, tagged `rust-v0.1.0`. Downloaded
archive and fresh default/no-default consumers passed, docs.rs serves the API
docs, and the exact GitHub trusted publisher is configured.
[Tag workflow 38359125471](https://github.com/lushly-dev/afd/actions/runs/38359125471)
passed and skipped the existing upload; a future new version still needs an
actual OIDC exchange/upload receipt. See
[the native release receipt](../../../docs/operations/native-first-releases.md).
Do not repeat this successful first upload. The following records its bootstrap
procedure for reference.

crates.io offers trusted publishing only for a crate that already exists, so the maintainer publishes 0.1.0 by hand, once. The name `afd` was free on crates.io on 2026-09-27.

1. **In the release pull request**, also:
   - include exact-version registry instructions in `packages/rust/README.md`,
     explicitly conditional on publication. The README is packaged into the crate.
   - keep usable git/path instructions and truthful unpublished status in the
     README, `afd-rust` skill and language parity until registry verification.
2. **Maintainer**, on the merge commit, with a crates.io API token that can publish new crates:
   ```bash
   cargo login
   cd packages/rust && cargo publish
   ```
3. **Maintainer**, on crates.io under the crate's Settings → Trusted Publishing, adds a GitHub publisher: owner `lushly-dev`, repository `afd`, workflow `publish-rust.yml`, environment `crates-io`. Then revoke the API token.
4. **Maintainer** pushes `rust-v0.1.0` for the same commit. `publish-rust.yml` runs its checks and skips the upload, because 0.1.0 is already on crates.io. Later versions publish through the workflow.
5. Download the published crate and verify fresh consumers. Then change the default
   installation to `cargo add afd` and the Distribution row to crates.io.

## C++ (CMake)

afd-cpp is on no registry. A release is a tag and a GitHub Release, and consumers use `FetchContent` with `GIT_TAG cpp-vX.Y.Z`, `find_package(afd X.Y CONFIG)` after installing, or `add_subdirectory`.

The first release, `cpp-v0.1.0`, was published on 2026-10-12 from
`a3115622ce8252a45ffff9d752e3cc161a481035` with explicit maintainer authorization.
All post-merge gates and fresh tagged FetchContent/install/find_package consumers
passed. See `docs/operations/native-first-releases.md` for the receipt and limits.

1. Set `project(afd VERSION X.Y.Z)` in `packages/cpp/CMakeLists.txt`. It generates `afd/version.hpp`, and the CMake package uses `SameMinorVersion` compatibility.
2. In `packages/cpp/CHANGELOG.md`, move `Unreleased` under the new version with the date, and add an empty `Unreleased` above it.
3. Run `node scripts/check-versions.mjs --write` to update the C++ column of the Version row in `docs/language-parity.md`. Keep installation pinned to the previous published tag until the new tag exists; distinguish candidate versions from published versions.
4. Merge after `cpp.yml` and `conformance.yml` pass on `main`.
5. **Maintainer:** tag the merge commit `cpp-vX.Y.Z`, push the tag, and create a GitHub Release from the changelog section.
6. Verify fresh tagged FetchContent and installed find_package consumers. Then pin
   package/skill/site snippets to the tag and update distribution/status wording.
   The first-release proposal is already in `docs/features/complete/cpp-support/`.
   See `docs/operations/native-first-releases.md`.

## Unblocking npm

The 2026-10-11 recovery is complete. All nine fixed-group packages are published
at **2.1.0**, following the accepted historical **2.0.0** release:

- 2.0.0: historical `b4a94e6974e534c57758eb00b8823bb0f370406d`, published by
  [35950563235, attempt 3](https://github.com/lushly-dev/afd/actions/runs/35950563235/attempts/3).
- 2.1.0: #338 merge `0148d2290ccf06769fd33c2b6484d3a8e4940669`, published by
  [38198328413](https://github.com/lushly-dev/afd/actions/runs/38198328413).

The original 2.0.0 attempt selected OIDC but all nine uploads were rejected with
E404. Signed-in inspection found no trusted publisher connections. After scoped
approval, all nine were configured for GitHub owner `lushly-dev`, repository
`afd`, workflow `release.yml`, no environment name, with **Allow npm publish**
enabled and dist-tag management disabled. Both subsequent uploads used OIDC and
succeeded. Existing credentials and publishing-access settings were preserved.

All 18 published tarballs passed integrity checks and matched their reviewed
payloads file-for-file; all 18 annotated Git tags resolve to the intended source.
Fresh ordinary npm installations passed at each version, with zero production
advisories. Installed 2.1.0 passed real MCP/CLI operations and strict view-state
root/commands declarations with the optional local-db peer absent and present.
#369 is closed. See `docs/operations/stabilization-release.md` for scope and
Python publication receipts. Do not rerun the historical release as routine work.

For a future publishing failure:

1. Distinguish version-PR creation from upload. A successful Changesets refresh
   does not establish npm authentication or package availability.
2. Inspect the exact failed run, source candidate, npm executable/version and
   actual error before changing access or retrying. `pnpm publish` delegates to
   npm. [Trusted publishing](https://docs.npmjs.com/trusted-publishers/) requires
   npm 11.5.1 or later, Node 22.14.0 or later, a supported hosted runner and
   `id-token: write`. Check the configured repository, workflow, environment and
   direct-publish action against the executing job. Preserve existing credentials
   and access settings during diagnosis; credential cleanup is separate work.
3. Recheck all applicable workflows on the exact release PR head and inspect
   actual packed dependencies and optional-peer consumers before a release merge.
4. After upload, verify every fixed-group version, exact tag target and fresh
   installed consumer. Initial metadata can lag uploads: inspect response freshness
   and downloaded registry artifacts, then prove ordinary installation. Do not
   retry a successful publication because a cached response is stale.

## Reference

See [release-checklist.md](references/release-checklist.md) for the expanded checklist.
