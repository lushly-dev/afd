# Focused rereview: AFD platform monorepo

| Field | Value |
| --- | --- |
| Date | 2026-10-28 |
| Scope | Revisions addressing B1–B2 and I1–I7 from the [initial review](./review.md), plus consistency with the foundation/endpoint model |
| Artifacts | [Revised proposal](./proposal.md) and [proposed decision](./decision.md) |
| Method | Two fresh, read-only reviewers with separate release and foundation/Alfred scopes; primary-agent reconciliation and documentation checks |
| Status | Proposal review passed. Architecture remains proposed; migration is not authorized or started. |

## BLOCKERS

None remaining in the reviewed proposal contracts. B1 and B2 are resolved by explicit requirements and phase exits. Their implementation and execution evidence remain future work.

## IMPROVEMENTS

All seven original improvements are addressed. No additional actionable gaps or contradictions remain in this focused rereview.

| Finding | Resolution in the revised proposal | Future acceptance / sequencing |
| --- | --- | --- |
| **B1 — Publication before cutover** | [Publication admission](./proposal.md#publication-admission-before-source-imports) separates source imports from publishing. Imported/split/unknown distributions are quarantined across automatic, tag, prerelease, and manual routes; actual manifests and artifacts must match an approved selection. Existing AFD releases retain eligibility. | Phase 1 must exclude an imported version absent from the registry while selecting an existing approved AFD release. Controls must precede Phase 2 imports and apply to added language routes. |
| **B2 — Conflicting release-fragment protocols** | [Release-command ownership](./proposal.md#release-command-ownership) requires protocol and release-unit resolution, owned storage or a validated adapter, and rejection before mutation for unknown formats or partial coordinated selections. Botcore's generic commands cannot operate unchanged on npm fragments. | Phase 1 mixed-format create/status/consume/delete fixtures; routing required before Alfred exposes release commands. |
| **I1 — Quality verdict preservation** | [Quality verdicts](./proposal.md#quality-verdicts-and-command-effects) distinguish execution success from check outcome, preserve legacy result interpretations, and define required/optional aggregation without vacuous passes. | Phase 2 equivalent failing lint/parity/quality results through CLI, MCP, workers, and aggregates; required skips, unavailable tools, errors, and empty plans cannot pass. |
| **I2 — Effects and invocation policy** | [Command effects](./proposal.md#quality-verdicts-and-command-effects) declare writes and capabilities, explicitly select mutations, and apply common dispatch policy. Retained raw Python is trusted-local, unavailable in restricted profiles, and not described as a sandbox. | Phase 2 discovery and dispatch fixtures cover every supported route, worktree context, effect-free rejection, and scoped output exceptions. |
| **I3 — Distribution and export coverage** | [Consumer evidence](./proposal.md#required-consumer-evidence) maps all admitted public distributions and supported entry points/conditions to applicable installation, import/type, peer, hook/configuration, and dependency checks. Uncovered supported exports hold acceptance. | Phase 0 inventory drives Phase 3 coverage; representative behavior fixtures supplement the map. Foundation restrictions do not prohibit allowed integration/endpoint dependencies. |
| **I4 — Negative integration cases** | [Consumer matrix](./proposal.md#required-consumer-evidence) covers integrations present, absent, incompatible, and explicitly requested but unavailable. Diagnostics match the installation/type/runtime boundary. | Phase 3 native operation with integrations absent and actionable rejection of unsupported compositions, including root-export/declaration checks. |
| **I5 — C++ distribution continuity** | [Artifact rules](./proposal.md#artifact-and-compatibility-rules) include immutable tags, source paths, CMake identity/target, and vendoring. Relocation requires a compatibility path or an explicit breaking transition. | External FetchContent and installed find_package consumers, historical tags, and vendoring acceptance before any C++ relocation in Phase 5. |
| **I6 — Publisher transfer recovery** | [Handoff and recovery](./proposal.md#publisher-handoff-and-recovery) require a prewritten record, queued/in-flight reconciliation, sole authority, and hold/reconcile/restore decisions. Uncertain or partial publication prevents automatic fallback. | Phase 1 simulated authentication failure is non-publishing; Phase 5 records actual transfer and registry evidence separately. |
| **I7 — Independent release batches** | [Release-batch policy](./proposal.md#version-families-and-independently-releasable-batches) allows unrelated approved families to proceed while another is held. AFD's fixed group, new prerequisite releases, and deliberately shared fragments preserve their coordination boundaries. | Phase 1 exercises all four selection examples without publication. Shared required quality gates remain binding; selecting a subset cannot consume or alter held release intent. |

## Cross-contract consistency

- AFD, Specimen, Violet, and FAST-AF remain independently adoptable foundations, including runtime, peers, types, hooks, and configuration. Native APIs do not acquire AFD envelopes through consolidation.
- Botcore and Health may use AFD, and Health's optional dashboard may use FAST-AF/Violet, without adding those dependencies to the audited application. Lushly remains external.
- Alfred remains one host and catalog with area-specific commands. Verdicts, effects, release-protocol ownership, targeting, and worktree policy strengthen that composition without requiring separate area bots.
- Shared publishing infrastructure does not imply universal eligibility, one version, one approval batch, atomic registry publication, or automatic deployment. A publication hold alone does not waive or replace required quality gates.
- The decision record matches the proposal. Source moves, runtime/configuration changes, new checks, publication, deployment, and archival remain outside this documentation task.

## PRAISE

- The revised phases require publication exclusion and release-protocol ownership before imports, closing the sequencing gaps rather than deferring them until cutover.
- Acceptance evidence now tests absence, failure, and partial outcomes as well as successful composition.
- The proposal states behavioral requirements without assuming an unsupported Changesets option or claiming that current Botcore middleware governs raw MCP execution.

## Evidence and limits

Each fresh reviewer received the revised proposal, decision, original findings, user requirements, and read-only codebase access without the drafting conversation. The release pass covered B1, B2, I5, I6, and I7. The foundation/Alfred pass covered I1–I4 and B2's interaction with effects policy. Both returned **APPROVE** for their scopes. A final delta check covered the explicit foundation/endpoint qualifier and preservation of shared quality gates.

Read-only checks confirmed the motivating source behavior: AFD's [root publisher](../../../../package.json) still invokes `changeset publish`, its [release workflow](../../../../.github/workflows/release.yml) has a shared version/publish pair, [Alfred lint](../../../../alfred/src/alfred/commands/lint.py) and [CLI](../../../../alfred/src/alfred/cli.py) separate execution from verdict, and [C++ consumption](../../../../packages/cpp/README.md#using-the-package) includes source-path and CMake contracts. Botcore's [fragment parser/consumer](https://github.com/lushly-dev/botcore/blob/40f829cc254ae243fde6cb3852afec1b84b74647/src/botcore/commands/changeset.py), [MCP runner](https://github.com/lushly-dev/botcore/blob/40f829cc254ae243fde6cb3852afec1b84b74647/src/botcore/server.py), and [registry](https://github.com/lushly-dev/botcore/blob/40f829cc254ae243fde6cb3852afec1b84b74647/src/botcore/registry.py) support the protocol and dispatch requirements.

Primary documentation was rechecked for [Changesets 2.31.1 publication semantics](https://raw.githubusercontent.com/changesets/changesets/@changesets/cli@2.31.1/docs/command-line-options.md), the [Changesets action's aggregate release PR](https://github.com/changesets/action/blob/maintenance/v1/README.md), and [npm](https://docs.npmjs.com/trusted-publishers/) / [PyPI](https://docs.pypi.org/trusted-publishers/adding-a-publisher/) publisher identity and verification requirements. No new CLI API is prescribed. Publisher validity must be refreshed at actual cutover; this review does not verify live registry settings.

| Reviewed identity | Value |
| --- | --- |
| AFD checkout base | `bc43019a4acd237e5ef3a2bf65f21564900143aa` |
| Revised proposal SHA-256 | `771a0a13a5bf5ef538879192ce8d09d7bc5014fd8b239ce67e61eaaf75d4866d` |
| Revised decision SHA-256 | `96f02f7161e9f7641635dd89b0d75019cfb154729710567e57dcbb7f49794a1a` |
| Preserved initial review SHA-256 | `c9553b805e601f5a41e8a8e02ae575446a97e3e8dd82ac98e4ebd89274c26c46` |

The initial review remains unchanged and describes the earlier draft identified by its own hashes. This rereview records the current disposition. Documentation checks cover local links/anchors, balanced fences, whitespace, and the documentation-only change scope. No application tests, consumer acceptance fixtures, release rehearsal, or registry mutations ran. The listed future gates are requirements, not passed implementation checks.

## Verdict

**APPROVE — proposal revisions only.** Both blockers and all seven improvements are addressed; no remaining findings were identified within this focused scope. Exact package identities, compatibility transitions, permissions, coverage implementation, performance budgets, and per-unit cutover records remain the stated Phase 0 and migration deliverables. This review neither accepts the architecture on the owner's behalf nor authorizes migration.
