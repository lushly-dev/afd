# Release Checklist

Expanded reference for the release procedure. The steps for each implementation are in [SKILL.md](../SKILL.md).

---

## Pre-Release Verification

- [ ] On `main`, up to date with the remote, working tree clean
- [ ] No open blockers or release-blocking issues for this implementation
- [ ] Record the immutable candidate SHA; independent review and all applicable CI pass on that exact head and the selected post-merge release commit:
  - TypeScript: `ci.yml` (`pnpm check` locally)
  - Python: `python.yml` (`cd python && uv run pytest -q`)
  - Rust: `rust.yml` (`cd packages/rust && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`)
  - C++: `cpp.yml` (`cd packages/cpp && cmake --preset dev && cmake --build --preset dev && ctest --preset dev`)
  - All: `conformance.yml`
- [ ] npm runtime release only: pending changesets exist (`pnpm changeset status`); no no-op changeset for fixture/docs-only work
- [ ] npm: inspect all nine packed manifests, internal/optional peers and fresh consumers before accepting the release PR

## Version Bump

- [ ] TypeScript: the Changesets release PR bumps all nine `@lushly-dev/*` packages to one version
- [ ] Python: `python/pyproject.toml`, `__version__` in `python/src/afd/__init__.py`, and `uv lock` in `python/`, `alfred/` and `packages/examples/todo/backends/python/`
- [ ] Rust: `packages/rust/Cargo.toml`, then `cargo publish --dry-run`
- [ ] C++: `project(afd VERSION …)` in `packages/cpp/CMakeLists.txt`

## Changelog

- [ ] The implementation's own changelog, never the root `CHANGELOG.md` (an index)
- [ ] Dated section for the version, with an empty `Unreleased` section above it
- [ ] Breaking changes listed first, each with migration instructions

## Docs

- [ ] `docs/language-parity.md`: Version row, Distribution row if it changed, Updated date
- [ ] Contract row and all implementation constants match existing `spec/VERSION`
- [ ] Candidate docs distinguish the last published release from preparation; after verification, update README/skills/site install snippets to the new release

## Publish (maintainer)

- [ ] TypeScript: merge the Changesets release PR; `release.yml` publishes and tags
- [ ] Python: push `python-vX.Y.Z`; `publish-python.yml` publishes
- [ ] Rust: push `rust-vX.Y.Z`; `publish-rust.yml` uses the existing `crates-io` trusted publisher. A new version must demonstrate OIDC exchange/upload; no bootstrap token is needed
- [ ] C++: push `cpp-vX.Y.Z` and create the GitHub Release

## After Release

- [ ] npm: all nine downloaded tarballs match expected integrity/payloads, tags target the intended source, and fresh ordinary/exact-version consumers pass with relevant optional peers absent/present
- [ ] Python: downloaded wheel digest/payload and fresh supported-interpreter base/client/server/CLI installs pass
- [ ] Rust: downloaded crate checksum/payload/source identity and fresh default/no-default consumers pass; docs.rs is available
- [ ] C++: fresh public-tag FetchContent and installed find_package consumers pass exact version/contract checks
- [ ] Every release tag exists, matches the version and resolves to the intended reviewed source
- [ ] Never repeat a successful publication for stale metadata; verify artifacts and fresh installs first
- [ ] Main/remote parity, post-merge checks, issue disposition and live documentation are verified
- [ ] Release notes accurate and formatted
