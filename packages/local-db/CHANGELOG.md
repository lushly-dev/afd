# @lushly-dev/local-db

## 1.0.0

### Minor Changes

- ### Breaking Changes

  - **Node.js 22+ required** — dropped Node 20 support, CI tests on 22.x and 24.x
  - **Zod 4** — upgraded from Zod 3. `zod-to-json-schema` replaced with built-in `z.toJSONSchema()`. `ZodEffects` replaced by `ZodPipe` for transforms. Schema introspection uses `.unwrap()`/`.removeDefault()` instead of `._def.innerType`.
  - **eventsource 4** — named import (`{ EventSource }` instead of default), custom `fetch` option for headers instead of `EventSourceInitDict`. `@types/eventsource` removed (types now bundled).

  ### Other Updates

  - TypeScript target bumped to ES2024
  - All dependencies updated to latest: commander 14, conf 15, glob 13, ora 9, jsdom 28, dotenv 17, vite 8, commitlint 20
  - Replaced custom `scripts/release.mjs` with `@changesets/cli` for versioning and changelogs
  - Removed redundant eslint from React example (biome covers React hooks rules)
  - Refactored `direct.ts` — extracted `unknown-tool.ts` and `direct-validation.ts`
  - Refactored `executor.ts` — extracted `validator.ts`
  - CI now runs `pnpm check` (lefthook quality gate) to prevent local/CI desync
