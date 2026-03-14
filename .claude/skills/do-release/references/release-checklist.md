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
- [ ] Pending changesets exist (`pnpm changeset status`)

## Version Bump

- [ ] Run `pnpm version-packages` to consume changesets
- [ ] All `@lushly-dev/*` packages bumped to same version (fixed versioning)
- [ ] Lock file updated (`pnpm install` if needed)

## Changelog

- [ ] CHANGELOG.md entries generated from changesets
- [ ] Breaking changes prominently noted
- [ ] Migration instructions included for breaking changes

## Build & Test

- [ ] Clean build succeeds: `pnpm build`
- [ ] Full test suite passes: `pnpm test`
- [ ] Quality gate passes: `pnpm check`
- [ ] No new warnings introduced

## Publish

- [ ] Push to main triggers CI Release workflow
- [ ] Or manually: `pnpm publish:npm`
- [ ] Published version is installable: `npm info @lushly-dev/afd-core`

## Git & GitHub

- [ ] Version bump committed: `chore: release packages`
- [ ] Pushed to remote: `git push origin main`
- [ ] GitHub Release created (automatic via changesets action)
- [ ] Release notes accurate and formatted
