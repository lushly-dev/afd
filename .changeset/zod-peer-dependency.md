---
"@lushly-dev/afd-server": major
"@lushly-dev/afd-testing": major
"@lushly-dev/afd-view-state": major
"@lushly-dev/afd-cli": major
"@lushly-dev/afd-auth": major
---

`zod` is now a peer dependency (`^4.6.6`) of `@lushly-dev/afd-server`, `@lushly-dev/afd-testing` and `@lushly-dev/afd-view-state` instead of a dependency, so an application's command schemas and the server use one copy of Zod. With two copies the schemas still validated, but TypeScript can reject an application's schema passed to `defineCommand`, because the two copies' types do not unify. `@lushly-dev/afd-cli` now depends on `zod` itself, since it runs the server, and `@lushly-dev/afd-auth`'s optional `zod` peer rises from `^4.0.0` to `^4.6.6` to match the server it runs on. Shape detection for a `VALIDATION_ERROR`'s `expectedFields`, `unexpectedFields` and `missingFields`, and `isObjectSchema()`, now read a schema's `_zod.def.type` instead of using `instanceof` against afd-server's own Zod classes, so they do not depend on which copy of Zod built the schema.

This is a breaking install change, so it is a major. npm 7 or later, pnpm and Bun install a missing peer themselves, but these applications need a change:

- One that depends on a `zod` outside `^4.6.6`, such as 3.25 (whose `zod/v4` entry it may have used for its commands): npm stops with `ERESOLVE` where it used to nest a second copy, and pnpm warns and then links the server to that `zod`, which it cannot run on. Upgrade the application to `zod@^4.6.6`.
- One that never depended on `zod`, for example one that uses only `@lushly-dev/afd-view-state` or `@lushly-dev/afd-testing`, where peers are not installed automatically (Yarn, npm's `legacy-peer-deps`, or pnpm with `auto-install-peers=false`): the install warns, and the server may fail to import `zod` or find another package's copy. Add `zod@^4.6.6` to its dependencies.
