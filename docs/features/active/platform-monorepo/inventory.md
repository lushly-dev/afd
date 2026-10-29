# Migration source inventory

Snapshot: 2026-10-28. Source checkouts were inspected read-only; no source repository was reset, stashed, or overwritten. Selected live GitHub identities supersede stale local main checkouts. Refresh before each import or authority transfer.

| Source | Selected observation | Scope and ownership |
| --- | --- | --- |
| AFD | `2243f4fc07bab3ad800313366b2de16673e996fc` merged main | Existing nine npm distributions at 2.2.0; independent Python/Rust/C++ distribution routes. MIT, public repository. |
| Botcore | Local clean `40f829cc254ae243fde6cb3852afec1b84b74647`; cached main `7d5c54cae8aae90e145374467456af619cf54e41` is 11 commits newer | Refresh live main before import. MIT public tooling; preserve `lushly-botcore`, Python `botcore`, console alias and optional extras. Original publisher remains authoritative. |
| Violet | Live main `a283750b6942d43970e20c9fa48d0d1dba356ea0`; local checkout older | Private repository; Jason authorized inclusion. MIT core/runtime/server/CLI at 0.1.0. API/web/Figma are private UNLICENSED application packages; review source and explicit licensing before public artifact release. |
| FAST-AF | Live main `dc3a2b98edb2d60a1162b142523e839d2b686e57`; local checkout older | Private standalone fork; maintained MIT runtime/components with Microsoft/Jane Chu provenance. Exclude Creator and reference sites. |
| Specimen | Clean feature branch `ceaa5156ae0461c2b076168ea4949535f8fcf176`, five committed changes absent from main | Preserve committed feature work. No PR was found for that head. Select source explicitly and coordinate before extraction. MIT, combined native API/AFD commands/CLI currently coupled. |
| Health | Private source reviewed for reusable responsibilities only | Generic extraction under MIT authorized. No private history or operational records may be imported. Original source remains authoritative. |
| Creator | Excluded | Jason directed that Creator remain outside AFD for this migration. |

## Distribution and export coverage map

This inventory defines future acceptance coverage; it does not report tests as passed.

| Unit | Distribution / public contract | Independence or migration work |
| --- | --- | --- |
| AFD TypeScript | `afd-core`, `afd-server`, `afd-client`, `afd-auth`, `afd-cli`, `afd-testing`, `afd-view-state`, `afd-adapters`, `local-db`, all under `@lushly-dev` | Retain one fixed unit. Record each package's export/subpath/condition, peers, hooks, binary, declaration and required closure. CLI remains coordinated initially. |
| AFD native languages | PyPI `afd`; crates.io `afd`; C++ immutable `cpp-v*`, `packages/cpp`, CMake `afd::afd` | Preserve language versions, wire contracts and current source paths. Python extras/wheels, Rust feature configurations and C++ source/install/vendoring need distinct consumers. |
| Specimen | `@lushly-dev/specimen` 2.2.0; `.` and `./types`; `specimen` binary | Native types are independent, but root exports/commands/CLI require AFD. Separate integration and native distribution with explicit import/envelope transition; preserve observation completeness limits. |
| Violet core | `@lushly-dev/violet-core` 0.1.0; `.`, `./commands`, `./css`, `./types`, `./worker` | Required old AFD dependency and AFD result reexports must leave native contracts. Native storage/export and optional service behavior receive separate coverage. |
| Violet runtime | `@lushly-dev/violet-runtime` 0.1.0; ESM/types root | No declared runtime dependencies; verify clean artifact/root types and actual browser behavior. |
| Violet tooling | `@lushly-dev/violet-cli` and `violet-server` 0.1.0; CLI `violet`, MCP `violet-mcp`; server `.`, `./api`, `./server` | Endpoints may compose AFD/Violet; preserve binaries, serialized results and compatible ranges. |
| Violet applications | API, web, Figma and test workspace | Admission authorized; private-data/license and deployment review required. No automatic deployment. Web currently relies on patched FAST archives with additional export paths. |
| FAST runtime | `@lushly-dev/fast-element` 3.0.1; 38 exports with types/development/production/default conditions | Standalone native runtime. Cover every export, declarations, scoped-registry peer/runtime requirements and browser conditions. Preserve copyright/notices. |
| FAST components | `@lushly-dev/violet-elements` 0.1.0, currently private; root, CEM, package metadata and token wildcard | Same-family FAST dependency permitted. Local theme registries are not a Violet-engine dependency. Preserve generated theme/icons/CEM and registration effects. |
| FAST tools | `@lushly-dev/fast-cli` 0.1.0; `fast-dev` binary; Fastbot specialist plugin | Endpoints; retain specialist policy while composing one Alfred catalog. No publish workflow found; manual nested routes must remain quarantined. |
| FAST deferred/reference | Upstream-named router, legacy Fluent components, sites, obsolete packages and Creator | No implicit upstream-scope publication or default import. Creator excluded; router identity remains a future explicit decision if retained. |
| Botcore tooling | `lushly-botcore` 0.5.0, optional MIT agents/LLM/memory/connectors/teams distributions | Preserve registry identities, extras, bundled skills and entry points. Validate actual published plugin names, discovery allowlist, source bootstrap and normal wheel metadata before admission. |
| Alfred | Existing `alfred` 0.1.0 tooling endpoint | Main monorepo host. Retain lint/parity/quality semantics; shared catalog needs target/worktree, duplicate/identity, verdict and effects contracts. |
| Health | Reusable checks/report/onboarding surfaces | Separate explicit targets/policy/output from private storage; inspect/audit and opt-in mutation differ. No current public release route or license assumed from old metadata. |

## Publishing and compatibility observations

- Anonymous npm reads returned 404 for Specimen, Violet core/runtime/server/CLI, FAST Element, Violet Elements and FAST CLI. This does not prove lack of private packages or publishing rights. Imported versions start quarantined regardless.
- Violet has a main-branch Changesets publisher; Botcore has a tag-driven PyPI route. Neither transfers authority through source import. FAST-AF has nested manual release scripts but no root publishing workflow. Capture exact routes again before each handoff.
- Violet web vendors patched FAST archives from `a989bfb` with patch digest `49e69e2`: inherited host fonts, segment spacing, and `./dist/*` exports. Preserve/reconcile those contracts before replacing archives with workspace dependencies.
- FAST-AF is a standalone fork; do not upstream-sync or publish under Microsoft identities. Preserve MIT notices for Microsoft FAST/Fluent and Jane Chu design-to-code lineage where selected source requires them.
- Specimen's AFD envelopes, observation schema and evidence limits are public compatibility surfaces. Screenshots and structural comparisons do not establish pixel equivalence; Storybook removal remains outside scope.

## Measured starting evidence

On AFD `2243f4fc`, Node 24.21.0 and pnpm 10.30.1, a frozen install reused existing local dependencies in 0.853 seconds. `pnpm check` passed in 92.97 seconds (build 11.49, coverage tests 47.37, typecheck 17.66, tooling tests 14.67 seconds). These are one warm local sample under concurrent inventory work; no cold-install, browser/native suite, hosted CI duration, or performance improvement is established. Current mandatory gates remain unchanged.
