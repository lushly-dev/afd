# Platform monorepo implementation

Status: active. Tracking issue: [#463](https://github.com/lushly-dev/afd/issues/463).

Jason authorized implementation, sub-agents, fixes, commits, and verified phase merges on 2026-10-28 after [proposal PR #462](https://github.com/lushly-dev/afd/pull/462) merged. The proposal, decision, initial review, and rereview in this folder are preserved historical snapshots; their documentation-only status describes their original authorization. The [implementation specification](./spec.md) and [status](./STATUS.md) record the current scope and evidence.

The four foundations remain independently adoptable. Botcore, Alfred, and Health may compose them as tooling. Lushly stays separate. Creator is excluded from this migration. Reviewed reusable Health code may be extracted under MIT, with private inventories, history, reports, and access settings excluded. Violet's applications may join AFD following source and artifact review.

Source import does not transfer publishing authority. New or split distributions remain quarantined until their explicit cutover. A phase advances only after its technical acceptance checks pass.
