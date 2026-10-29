# Phase 0/1 implementation review

Base: AFD `2243f4fc07bab3ad800313366b2de16673e996fc`. Review date: 2026-10-28. Scope: release admission, version selection, artifact publication/finalization, durable claims, native publication guards, static boundaries, tooling gates, and active-project records. No foundation or endpoint source import is part of this checkpoint.

## Disposition

**APPROVE.** A fresh independent reviewer inspected the full implementation without editing or running validation. A broad pass identified the findings below, a focused pass checked corrections, and one final readback verified the remaining prerequisite-traversal blocker. Local checks are reported separately from this source review.

| Finding | Verified correction |
| --- | --- |
| Explicit units bypassed reviewed release intent | Every supported planning/publication API requires committed intent. Selected unit equality, exact intent digest, source revision, manifests and artifacts are bound and revalidated. |
| Temporary receipts allowed uncertain reruns/finalization skips | Durable per-intent GitHub status claims precede uploads and are inspected before registry fulfillment. Pending/failed claims hold subsequent runs; success follows verified finalization. Plans, receipts and exact tarballs are retained separately. |
| Restored identical intent reopened publication | Full-history lookup anchors identical intent bytes to their earliest occurrence, preserving prior claims after deletion/restoration. |
| Workflow claim arguments/order were incomplete | Every claim invocation has an output path; acquire precedes upload, completion follows finalization, failure preserves the hold. Required permissions/history are explicit. |
| Native admission ignored candidate holds/prerequisites | Python/Rust exact held versions and initial-version floors are enforced. Declared native prerequisite graphs fail closed until a supported read-only evidence adapter exists; current AFD units remain eligible. |
| Automatic prerequisite queries missed aliases and explicit edges | Normalized selected requirements and inventory prerequisites are queried. Unselected candidate source is never used to infer dependencies of an already-published compatible prerequisite. |
| Required peers uploaded in the wrong order | Required peers and explicit prerequisites participate in ordering. Registry name/version/integrity readback must match the approved archive before dependent uploads; uncertain outcomes hold the receipt. |
| Changesets instructions retained scope-wide assumptions | Root scripts and documentation use explicit AFD fixed membership, selected batches, protocol-owned fragments and guarded publication. |
| Genuine push hooks leaked repository routing into Git fixtures | A tooling launcher removes inherited `GIT_*` and nested Node-test routing before spawning fixtures. Its regression proves the child actually executes and preserves a protected disposable parent's config, index and HEAD. Independent narrow review approved this correction. |

The reviewer found no additional blockers in the Changesets add/status wrapper, static boundary/coverage framework or preservation of existing quality gates. Static checks explicitly defer complete external/dynamic/native type evidence to artifact consumers.

## Validation and limits

The implementation agent ran the full local `pnpm check`, focused regression suites, all four 34-case todo conformance lanes, and applicable backend checks. See [status](./STATUS.md) for receipts and the PR for exact-head hosted checks. An early full-gate failure was a stale assertion naming the old Python publishing step; the corrected repository contract test passed.

The first genuine pre-push attempt exposed the inherited-Git-environment issue above. It was stopped by the hook. The known shared settings were restored from the pre-hook commit/global identity; HEAD, branch, index and origin were verified. The fix requires a fresh full gate and successful genuine hook before publication of this branch.

All registry interactions during preparation were read-only. Publication/finalization/claim mutations were exercised with injected transports and disposable fixtures. Live npm/PyPI/crates.io permissions, actual upload behavior, production deployment, publisher transfers, new-source consumers, and the complete migration remain unverified. The new main workflow has no release intent to publish at this checkpoint.
