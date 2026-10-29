# Platform monorepo implementation specification

| Field | Value |
| --- | --- |
| Status | Active; authorized 2026-10-28 |
| Owner | Jason |
| Tracking | [#463](https://github.com/lushly-dev/afd/issues/463) |
| Architecture | [Accepted proposal](./proposal.md), [decision](./decision.md), [focused review](./rereview.md) |
| Starting AFD source | `2243f4fc07bab3ad800313366b2de16673e996fc` |

## Scope decisions

- Preserve AFD's existing nine-package npm fixed unit, package names, versions, language routes, and current paths during infrastructure preparation.
- Admit maintained FAST-AF runtime/components with their upstream notices. Exclude reference sites, obsolete packages, and Creator. Defer the upstream-named router from publication until its identity is resolved; no package may publish into an upstream namespace by inference.
- Separate Specimen and Violet native APIs from AFD integrations. Existing tool envelopes and aliases receive explicit compatibility transitions; moving source must not silently upgrade an old AFD API requirement.
- Include Violet applications after dependency/vendor and source review. Preserve its patched FAST archives until equivalent behavior and export contracts are verified.
- Extract reviewed generic Health code under MIT. Private source history, inventories, reports, access configuration, and organization-specific operations stay outside the public tree.
- Creator is excluded by Jason's explicit direction on 2026-10-28. Lushly remains an external released-package consumer.
- Keep existing required gates. Baseline measurements are observations, not promises of speed. No selective-gate replacement or scheduler is authorized by an inferred performance benefit.

## Phase 1 contracts

The release inventory identifies each distribution by registry, name, manifest, family/unit, protocol, authority, route, state, and gates. Unknown, quarantined, or held distributions cannot publish. Source admission and publisher admission are separate. Each execution validates actual candidate metadata and selected prerequisite closure.

The npm fixed unit explicitly lists the current nine AFD packages. Independent families can hold/release separately when dependencies and release intent permit. A fragment spanning units cannot be partially consumed. npm semver fragments and Botcore category fragments have distinct ownership and storage; malformed/foreign input fails before mutation.

Changesets 2.31.1 has no safe publish filter. The operational controller must version a selected batch in a disposable workspace, validate its resulting write set, and copy only authorized release metadata back. Publication uses explicitly selected, hash-bound artifacts. An unrelated held fragment must not suppress an approved publication through the Changesets action's version/publish branch decision.

Release plans bind selected units, source/manifest and fragment content, versions, registry prerequisites, artifact metadata and hashes. A changed input invalidates the plan. Publication validates every artifact before uploading, then revalidates each selected upload. Missing registry versions alone never authorize publication. Registry outcomes and immutable versions are recorded; uncertain or partial results hold dependent releases.

Automatic publication requires a durable per-intent GitHub status claim before uploads, checked before registry fulfillment can skip work. Pending/failed claims require explicit reconciliation across runs, including failed finalization after successful uploads. Success is recorded only after verified finalization. Reintroduced identical intent bytes retain their original claim; temporary evidence cannot authorize a retry by disappearing.

Python and Rust publisher jobs must check exact admission/route before authentication and upload, including tag/release-event routes. New routes default to unavailable. Existing C++ immutable tags, FetchContent source path, installed CMake identity, and vendoring remain unchanged until separate relocation acceptance.

Publisher handoff is a recorded sole-authority transition: freeze submissions, reconcile queued/in-flight work, disable the old route, admit/enable the new route, verify its actual operation. Simulated authentication failure must enter held state. Restoration requires proof no conflicting/uncertain publication exists and a compatible original authority; no dual-publisher fallback.

## Acceptance and sequencing

| Checkpoint | Required evidence before advancement |
| --- | --- |
| Phase 0 inventory | Immutable source selection, package/export/license/visibility and publisher inventory; explicit unresolved items; setup/check baselines; accepted scope above. |
| Phase 1 safeguards | Existing AFD releases selectable; missing-registry unknown imports excluded; all four release-batch cases; protocol ownership and effect-free rejection; simulated handoff recovery; family-aware versions; existing quality gates; independent code review. |
| Phase 2 Botcore/Alfred | Preserved Python artifact identities/assets, local-source bootstrap, deterministic catalog and host identity, collision/target/worktree checks, equivalent verdict/effects policy across supported routes, release-protocol routing, isolated non-AFD consumer. |
| Phase 3 foundations | Every supported public artifact/export mapped to installation/import/type/dependency coverage; standalone behaviors; present/absent/incompatible/unavailable integrations; native APIs independent; compatibility transitions reviewed. |
| Phase 4 Health/Violet endpoints | Reviewed source allowlists, MIT Health notices, external target/policy/history settings, versioned report contract, optional FAST-AF dashboard, private-data-free artifacts, endpoint checks. Creator remains excluded. |
| Phase 5 handoffs | Per-distribution authority/recovery records, all gates, approved release plans, immutable registry/source readback and isolated consumers before redirects or archival. |

Performance policy: preserve current gates and record timings with toolchain, scope, warm/cold conditions, and limitations. A repeatable regression must be investigated before it becomes a new baseline. Numeric speed budgets for changing required gates require measured comparable samples; this implementation does not change those gates.

## Verification limits

An architectural review is not an artifact receipt. A local gate is not hosted CI. Registry reads are not publisher permission checks. Simulated handoff recovery is not authentication evidence. Each checkpoint records these separately in STATUS.md. Existing source publishers remain authoritative until their verified handoff.
