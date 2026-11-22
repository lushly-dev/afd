# Versioning and release: status

Read this before the [accepted plan](versioning.plan.md). Last reconciled 2026-11-13 against
`main` at `1024546b`, using release receipts, source and GitHub issue state. The plan's September
tables are historical; current publishing rules belong to the `cut-release` skill and
[platform releases](../../../operations/platform-releases.md).

## Exit criteria

| Criterion | State | Evidence / remaining gate |
| --- | --- | --- |
| Independent releases on npm, PyPI, crates.io and C++ tags | Initial releases done | [npm/Python receipts](../../../operations/stabilization-release.md), [Rust/C++ receipts](../../../operations/native-first-releases.md). Later manifest changes do not prove a new publication |
| README and site show every implementation's live version | Partial | The blanket badge was removed; site/deploy-time versions remain [#551](https://github.com/lushly-dev/afd/issues/551), open |
| Contract version file, four constants and drift checks | Done at `1.0-rc`; core 1.0 decided 2026-11-21, declaration open | `spec/VERSION`, `scripts/check-versions.mjs`, Alfred's contract check; decided in [#541](https://github.com/lushly-dev/afd/issues/541), declared by [#1926](https://github.com/lushly-dev/afd/issues/1926), open |
| Version check runs in the TypeScript gate | Done | `lefthook.yml`, `scripts/check-versions.mjs` |
| Four release paths documented | Done | `.claude/skills/cut-release/SKILL.md` |

## Closure

Closed as complete on 2026-11-14. The two open criteria continue as issues: declaring contract 1.0 was the owner's decision in [#541](https://github.com/lushly-dev/afd/issues/541), made on 2026-11-21 (core 1.0 now: [the record](../../active/architecture-review/decisions.md), AR2) and carried out by [#1926](https://github.com/lushly-dev/afd/issues/1926), and live per-language versions on the site are [#551](https://github.com/lushly-dev/afd/issues/551). Independent version policy is ongoing maintenance; it is not by itself an unfinished
implementation phase. This audit made no publication or registry checks.
