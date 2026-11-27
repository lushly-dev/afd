# AFD general bug sweep (#2444, #2760)

- Date: 2026-11-27
- Area: every other area
- Pull request: [#2868](https://github.com/lushly-dev/afd/pull/2868), on `t3/bug-sweep-afd-general-fixes`, for [#2444](https://github.com/lushly-dev/afd/issues/2444), [#2760](https://github.com/lushly-dev/afd/issues/2760), [#2816](https://github.com/lushly-dev/afd/issues/2816), and [#2584](https://github.com/lushly-dev/afd/issues/2584)

**#2444 (`notes-conflict` intermittent `$fastController` failure):** Deferred `loam-shell`'s
stage-B `kernel.appsReady.then(...)` hook until after first render (`booted = true; this.#present();
await Updates.next();`) with disconnect/kernel guards in `elements/shell.ts`. Hardened
`AppSurfaces.#start()` (`apps/surfaces.ts`) to await `shell.ready`, guard `#stopped()` (disposal or
disconnect) before touching `loam-main` or attaching overlays/styles, and throw a clear diagnostic
when `loam-main` is absent on a connected shell; added unit tests in `apps/surfaces.test.ts`.
Updated `first-paint.test.ts` to read `CEILINGS.jsMinified` from `scripts/budget.mjs` (combined
first paint fits within `main`'s `349,700` minified / `104,500` gzip ceilings after `#2846`).

**#2760 (Windows load-timeout gates):** Raised timeouts on kernel 200-call burst tests (`limits.test.ts`),
`loam-host` (`vitest.config.ts` 60 s / 30 s hook + `createTeardownTracker()` in `provider.test.ts`
draining in-flight locks and refusing post-teardown continuations + `EBUSY` retry in `test-support.ts`),
and `vitest.engines.config.ts` / Playwright non-Chromium contexts (`newEngineContext()` in `harness.ts`,
used by `openPage()`, `view.test.ts`, and `native.test.ts`, plus 60 s on `VIEW_READY_TIMEOUT`).
Aligned P6-H1 off-CI cold start to warn past `3,000 ms` while keeping CI section 14 ceilings
(`405 ms`, `117 MB`) and local resident memory (`300 MB`) enforced
([phase 6 spec section 14](../phases/6-hosts/spec.md#14-budgets)).

Verified on 2026-11-27: 20/20 consecutive solo runs of `specimen.test.ts -t notes-conflict`,
`loam.yml` (Chromium 50/50, walk, Firefox, WebKit, budget, mounted, `loam-host`, hosted),
`loam-desktop.yml`, `python.yml`, `umbel.yml`, `conformance.yml`, and `ci.yml` (`pre-push` 20/20).
