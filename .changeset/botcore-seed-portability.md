---
"lushly-botcore": minor
---

### Added

- The seeded `gate-discipline` skill (1.2.0) carries `scripts/check-portability.mjs`, converged with Lushly's copy (lushly-dev/afd#2834): it fails on Windows drive and user-home paths and on a package manager started by bare name without a shell, warns on localhost URLs, lists files from git and refuses a full scan that finds none. A repository's scope (`include`, `exclude`, `skipSegments`, `extensions`, whether Markdown and comment lines are scanned, the localhost allowlist and the spawn helper it names) goes in `scripts/policy/portability.json` or `--config <path>`.
