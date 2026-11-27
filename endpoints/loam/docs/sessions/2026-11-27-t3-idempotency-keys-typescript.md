# Idempotency keys in afd-core and afd-server

- Date: 2026-11-27
- Area: every other area
- Pull request: [#2864](https://github.com/lushly-dev/afd/pull/2864), on `t3/idempotency-keys-typescript`, for [#2675](https://github.com/lushly-dev/afd/issues/2675) under epic [#2672](https://github.com/lushly-dev/afd/issues/2672)

TypeScript's engines now validate and deliver `context.idempotencyKey` on every call and derive
batch and pipeline keys ([idempotency](../../../../spec/idempotency.md)). The step that answers
repeats is opt-in (`createIdempotencyStep`) and stays out of the kernel's bundle.

Under D115, with `main` at `7f994c7e4` (#2846's journal seams) merged, `budget.mjs` raises first
paint's JavaScript from 349,700 to 353,000 (352,572 against #2846's 349,276, also in
`first-paint.test.ts`), its gzip from 104,500 to 105,700 (105,362 against 104,223), and
`@lushly-dev/loam-kernel` alone from 161,600 to 165,300 (164,943), each with its reason beside it.
The desktop's `inbound` chunk rises from 43,500 to 44,300 (43,977).

Verified on 2026-11-27 with `pnpm -F @lushly-dev/loam-web budget` after a clean Loam build, and
again on `main` at `871c97dcf` with no change to the figures beyond 4 bytes of gzip.
