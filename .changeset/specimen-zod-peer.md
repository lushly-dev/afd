---
"@lushly-dev/specimen": minor
"@lushly-dev/specimen-afd": minor
---

`zod` is now a peer dependency (`^4.6.6`) of `@lushly-dev/specimen` and `@lushly-dev/specimen-afd` instead of a dependency, so Specimen's schemas, the `specimen-*` commands built from them and `@lushly-dev/afd-server`, which also peers `zod`, share the application's one copy of Zod. With two copies the schemas still validate, but TypeScript can reject a schema passed to afd-server's `defineCommand`, because the copies' types do not unify. Install `zod` beside them: `npm install @lushly-dev/specimen@preview @lushly-dev/specimen-afd@preview @lushly-dev/afd-core @lushly-dev/afd-server zod`. npm 7 or later, pnpm and Bun install a missing peer themselves; Yarn, npm's `legacy-peer-deps` and pnpm with `auto-install-peers=false` do not, and an application on a `zod` outside `^4.6.6` must upgrade it. `@lushly-dev/specimen-cli` keeps `zod` as a dependency: it is the application that supplies it.

Both packages stay on the `preview` track, where a minor advances the next `2.2.0-preview` build; no stable release of either has been published.
