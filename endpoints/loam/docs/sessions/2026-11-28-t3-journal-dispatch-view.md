# Each dispatch's own journal sources in afd-server

- Date: 2026-11-28
- Area: every other area
- Pull request: [#2978](https://github.com/lushly-dev/afd/pull/2978), on `t3/journal-dispatch-view`, for [#2890](https://github.com/lushly-dev/afd/issues/2890)

`createJournalMiddleware` now gives each call its own view of the context's clock and random
source (`journal-view.ts` in `@lushly-dev/afd-server`), so concurrent calls on one context keep
their own tapes. The kernel's journal bundles it, so first paint and the kernel grow.

Under D115, `budget.mjs` raises first paint's JavaScript from 353,000 to 355,500 (355,073 on
`a6c86277e`, against 352,966 on `main`), its gzip from 105,700 to 106,600 (106,217 against
105,311), and `@lushly-dev/loam-kernel` alone from 165,300 to 168,200 (167,808), each with its
reason beside it.

Verified on 2026-11-28 with `pnpm -F @lushly-dev/loam-web budget` after a Loam build, on
`a6c86277e` and again on `557941d8a` with `main` at `96bb3d6a9` merged, with the same figures.

With #2786's sign-on URL cut merged (`main` at `815296823`, which raised first paint to 354,000
and the kernel to 166,000), the combined build measures 355,499 and 168,380 minified and 106,389
gzip: first paint is set to 355,900 and the kernel to 168,800, and gzip stays within 106,600.
