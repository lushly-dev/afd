# Release Checklist

Expanded reference for the full release procedure.

---

## Pre-Release Verification

- [ ] On `main` or designated release branch
- [ ] Working tree clean (`git status` shows nothing)
- [ ] Up-to-date with remote (`git pull origin main`)
- [ ] All CI checks passing on latest commit
- [ ] No open blockers or release-blocking issues
- [ ] Dependencies are current (no major version drift)

## Version Bump

- [ ] Determine increment: patch / minor / major
- [ ] Bump version in `package.json` / `pyproject.toml` / `Cargo.toml`
- [ ] For monorepos: bump each changed package
- [ ] Version string is consistent across all config files
- [ ] Lock files updated if needed (`pnpm install` / `cargo update`)

## Changelog

- [ ] `[Unreleased]` entries moved to version heading `[X.Y.Z] - YYYY-MM-DD`
- [ ] Fresh `[Unreleased]` section added at top
- [ ] Entries match actual changes (compare with `git log`)
- [ ] Breaking changes prominently noted
- [ ] Migration instructions included for breaking changes

## Build & Test

- [ ] Clean build succeeds (all languages)
- [ ] Full test suite passes (all languages)
- [ ] No new warnings introduced
- [ ] Package artifacts generated correctly

## Publish

- [ ] Authentication verified for all registries
- [ ] npm: `npm publish` (or `pnpm publish`)
- [ ] PyPI: `hatch publish` (or `twine upload dist/*`)
- [ ] crates.io: `cargo publish`
- [ ] Published version is installable

## Git & GitHub

- [ ] Release commit: `chore: release vX.Y.Z`
- [ ] Annotated tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
- [ ] Pushed to remote with tags: `git push origin main --tags`
- [ ] GitHub Release created with changelog excerpt
- [ ] Release notes accurate and formatted
