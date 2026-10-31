# Versioning and release status

**State:** Active, close to complete. All four tracks publish independently versioned releases (V1–V6 implemented). Open: contract 1.0 (owned by parity closure) and the site exit criterion.
**Last updated:** 2026-10-31, against `origin/main` `5875e301`.

The [plan](./versioning.plan.md) holds decisions V1–V6 and the dated September snapshot. Release receipts live in [stabilization release](../../../operations/stabilization-release.md) and [native first releases](../../../operations/native-first-releases.md).

## Current versions (2026-10-31)

| Track | On `main` | Published | Tag |
| --- | --- | --- | --- |
| npm (9 packages, fixed group) | 2.2.1 | npm 2.2.1 (2026-10-29) | `@lushly-dev/afd-core@2.2.1` |
| Python `afd` | 0.10.0 | PyPI 0.10.0 | `python-v0.10.0` |
| Rust `afd` | 0.2.1 | crates.io 0.2.1 | `rust-v0.2.1` |
| C++ `afd-cpp` | 0.2.0 | — (CMake) | `cpp-v0.2.0` |
| Contract | `spec/VERSION` `1.0-rc` | — | — |

## Done / merged

| Item | Evidence |
| --- | --- |
| Contract version: `spec/VERSION`, constants in all four languages, `alfred parity` check | #313 |
| Per-implementation changelogs, Rust publish workflow, `cpp-v` tags, release docs | #309 |
| `scripts/check-versions.mjs` (with tests), run by the `versions` step of `pnpm check` | #313; `scripts/check-versions.test.mjs` |
| README implementation table with live shields.io badges and contract column | `README.md` on `5875e301` |
| `do-release` skill covers all four paths | Plan step 7 |
| First and follow-up releases: npm 2.0.0/2.1.0/2.2.0/2.2.1, Python 0.9.0/0.10.0, Rust 0.1.0/0.2.0/0.2.1, C++ 0.1.0/0.2.0 | #338, #375, #377, #379, #454, #456; registry and tag reads on 2026-10-31 |
| Trusted publishing on npm, PyPI and crates.io (Rust 0.2.0 first OIDC upload) | Plan header, 2026-10-27 |

## Not done

- **Contract 1.0** (V2): still `1.0-rc`. The trigger is parity Wave 1, tracked in [parity closure](../parity-closure/STATUS.md) item 1.7.
- **Site exit criterion:** the hardcoded "Beta v0.6.0" badge is gone, but `site/index.html` does not list the four implementations with live versions, and `deploy-pages.yml` stamps only the npm version into `llms.txt`.
- **Policy row "Python 0.10.0 for the D5 server defaults":** 0.10.0 shipped without D5 (see parity closure).

## Verification evidence

- npm, PyPI and crates.io versions read from the registries on 2026-10-31; tags from `git tag`.
- Release workflow on `main`: `success` for `03815e26` and `9a35907f` (2026-10-31); the run for `5875e301` was in progress at audit time.

## Observed issues

- The plan's "Current delivery" line (2026-10-27) predated npm 2.2.1 and Rust 0.2.1; a dated 2026-10-31 update was added above it.
- Release mechanics have since moved to the guarded flow in `scripts/release/inventory.json` and `pnpm release:plan` / `publish:npm` (see `AGENTS.md`), so the plan's section 4 sequence is historical.

## Follow-ups

- Recommend moving this folder to `complete/` once the owner accepts that contract 1.0 is tracked by parity closure and the site item is either done or dropped.
