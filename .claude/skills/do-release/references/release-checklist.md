# Release Checklist

Expanded reference for the release procedure. The steps for each implementation are in [SKILL.md](../SKILL.md).

---

## Pre-Release Verification

- [ ] On `main`, up to date with the remote, working tree clean
- [ ] No open blockers or release-blocking issues for this implementation
- [ ] CI green on the latest commit:
  - TypeScript: `ci.yml` (`pnpm check` locally)
  - Python: `python.yml` (`cd python && uv run pytest -q`)
  - Rust: `rust.yml` (`cd packages/rust && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`)
  - C++: `cpp.yml` (`cd packages/cpp && cmake --preset dev && cmake --build --preset dev && ctest --preset dev`)
  - All: `conformance.yml`
- [ ] npm only: pending changesets exist (`pnpm changeset status`)

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
- [ ] Contract row and the contract constant, once `spec/VERSION` exists
- [ ] Install instructions match the new release (README, skills)

## Publish (maintainer)

- [ ] TypeScript: merge the Changesets release PR; `release.yml` publishes and tags
- [ ] Python: push `python-vX.Y.Z`; `publish-python.yml` publishes
- [ ] Rust: push `rust-vX.Y.Z`; `publish-rust.yml` publishes
- [ ] C++: push `cpp-vX.Y.Z` and create the GitHub Release

## After Release

- [ ] Installable: `npm view @lushly-dev/afd-core version`, `pip index versions afd`, crates.io, or the tag on GitHub
- [ ] The tag exists and matches the version
- [ ] Release notes accurate and formatted
