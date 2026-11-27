---
"@lushly-dev/violet-core": minor
"@lushly-dev/violet-afd": minor
"@lushly-dev/violet-cli": patch
---

`zod` is now a peer dependency (`^4.6.7`) of `@lushly-dev/violet-core` and `@lushly-dev/violet-afd` instead of a dependency, so violet-core's schemas, the violet-afd command schemas that compose them and an application's own schemas share one copy of Zod, whose types do not unify across copies. Install `zod` beside them: `npm install @lushly-dev/violet-core@preview @lushly-dev/violet-afd@preview zod`. npm 7 or later, pnpm and Bun install a missing peer themselves; Yarn, npm's `legacy-peer-deps` and pnpm with `auto-install-peers=false` do not. `@lushly-dev/violet-server` keeps `zod` as a dependency, and `@lushly-dev/violet-cli` now depends on it too: they are the applications that supply it.
