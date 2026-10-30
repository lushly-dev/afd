# Violet foundation split and compatibility transition

Source: [lushly-dev/violet](https://github.com/lushly-dev/violet) main at `59b4bfa64a8cf423322b857c5c697e110201e0f2` (2026-10-29T07:13Z, #139). Imported in platform migration Phase 3 as five quarantined distributions of one fixed `violet-npm` release unit. File-level hashes and adaptation reasons are in [`foundations/violet/provenance`](../../../../foundations/violet/provenance/provenance.json). Versions are the freeze-point versions, all 0.2.0; none was reset.

| Unit | Layer | Path | Contract |
| --- | --- | --- | --- |
| `@lushly-dev/violet-core` | foundation | [`foundations/violet/packages/core`](../../../../foundations/violet/packages/core/README.md) | Native token engine. Depends on `zod` only; `better-sqlite3`, `@neondatabase/serverless` and `ws` are optional. No AFD dependency, peer, type reference or install hook. |
| `@lushly-dev/violet-runtime` | foundation | [`foundations/violet/packages/runtime`](../../../../foundations/violet/packages/runtime/README.md) | Unchanged. |
| `@lushly-dev/violet-afd` | integration | [`integrations/violet-afd`](../../../../integrations/violet-afd/README.md) | New. The command registry, 46 commands, `CommandResult` helpers and demo seed. Peer `@lushly-dev/violet-core` `^0.2.0`; depends on `@lushly-dev/afd-core` `^0.1.1`. |
| `@lushly-dev/violet-cli` | endpoint | [`endpoints/violet-cli`](../../../../endpoints/violet-cli/README.md) | `violet` binary. Depends on `@lushly-dev/violet-afd` instead of core. |
| `@lushly-dev/violet-server` | endpoint | [`endpoints/violet-server`](../../../../endpoints/violet-server/README.md) | `violet-mcp` binary, `.`, `./server`, `./api`. Depends on `@lushly-dev/violet-afd` instead of core. |

The endpoints keep the package name `violet-server` as their directory; the proposal's `violet-service` directory is left for the Phase 4 API and web applications.

## Public contract changes

`@lushly-dev/violet-afd` exposes the five entry points the 0.2.0 core had (`.`, `./commands`, `./worker`, `./types`, `./css`), each a superset of the earlier core entry point: every runtime name is still there, and the packed consumers type-check `CommandResult`, `CommandContext`, `CommandDefinition` and `Database` from it.

| 0.2.0 core contract (Violet repository) | After the split | Change |
| --- | --- | --- |
| Root: 116 command exports (`registry`, `CommandRegistry`, `CommandDefinition`, `CommandContext`, every `*Command`, `register*Commands`, `toJsonSchema`, …) | `@lushly-dev/violet-afd` root and `./commands` | Moved |
| Root and `./types`: `CommandResult`, `CommandError`, `Alternative`, `PlanStep`, `Source`, `Warning`, `ResultMetadata`, `success`, `failure`, `isSuccess`, `isFailure` (AFD re-exports) | `@lushly-dev/violet-afd` root and `./types` | Moved; no AFD type remains in core |
| Root: `initializeCore`; demo seed `seedRealisticSystem`, `buildTokenCatalog`, `hsl`, `COMPONENTS`, `REALISTIC_NODES` | `@lushly-dev/violet-afd` root | Moved: the seed writes through commands |
| Root: `NeonPostgresClient`, `createNeonPostgresClient` | `@lushly-dev/violet-core/neon` (and `@lushly-dev/violet-afd` root) | Moved to a subpath so the root import never loads the optional Neon driver |
| `./commands` | `@lushly-dev/violet-afd/commands` | Removed from core: `ERR_PACKAGE_PATH_NOT_EXPORTED` |
| `./worker`: `registry`, `CommandContext`, `initializeWorkerCore` | `@lushly-dev/violet-afd/worker` | Moved; core `./worker` keeps `createMemoryDatabase`, `Database` and the OpenAPI document |
| Root, `./types`: data contracts and `ErrorCodes`/`ErrorCode`; `Database`; memory, overlay, SQLite and Postgres stores; transformers; OpenAPI document; CSS validators; `ResolutionCache`, `withResolutionCache` | Same paths in core | Unchanged names. `ErrorCodes` moved from `types/command-result.ts` to `types/error-codes.ts` internally |
| — | Core root and `./worker`: `resolveTokens`, `exportTokens`, `TokenDomainError`, `EXPORT_FORMATS` and their option/result types | Added: native resolution and export without a registry |
| — | Core `./engine`: resolver, resolution cache, dependency graph, glob and constraint validators, token ids, transformers, memory and overlay stores | Added, worker-safe; the integration builds on it |
| `withResolutionCache(context: CommandContext)` | `withResolutionCache<T extends ResolutionScope>(context: T): T & { resolutionCache }` | Generic over the native `ResolutionScope` (`{ db, resolutionCache? }`); a `CommandContext` argument returns a `CommandContext` as before |
| Engine functions typed `db: CommandContext['db']` | `db: Database` | Same structural type |
| Core dependencies `@lushly-dev/afd-core`, `zod-to-json-schema`, `nanoid`, `@neondatabase/serverless`, `ws` | Core: `zod`; optional dependency `better-sqlite3`; optional peers `@neondatabase/serverless`, `ws` | `npm install --omit=optional` gives memory storage, resolution and export with no driver |

Errors: command envelopes are unchanged. The native functions throw `TokenDomainError` (`code`, `message`, `suggestion`) with what `tokens.resolve` and `export` report once input has validated. Two pre-validation cases differ: an unknown format, which the command's schema rejects as invalid input, throws `VALIDATION_ERROR` ("Unknown export format") natively, and an empty `nodeId`, a command validation error, throws `NODE_NOT_FOUND`; cycles become `CIRCULAR_REFERENCE` with the `InheritanceResolutionError` as `cause`. The integration's handlers are the upstream handlers, composing the same native resolver and transformers; `src/native-parity.test.ts` checks every node of the demo system and all nine formats agree with `resolveTokens`/`exportTokens`, failures included.

Binaries and serialized output are unchanged: on the same inputs the packed `violet` binary printed byte-identical output to the upstream 0.2.0 build for eight invocations (version, command list, `--from` resolve/export/validate, a failure, the OpenAPI document), apart from timings, trace ids and clock times. `violet --version` prints `0.1.0`, hard-coded upstream. `violet-mcp` lists the same 46 tools.

## Upgrade steps for existing consumers (Lushly included)

1. Command, registry, `CommandResult`, `initializeCore` or demo-seed users: add `@lushly-dev/violet-afd` beside `@lushly-dev/violet-core` and replace `@lushly-dev/violet-core` with `@lushly-dev/violet-afd` in those imports, keeping the subpath (`/commands`, `/worker`, `/types`, `/css`). Nothing else changes; the root of the integration re-exports the native root.
2. Neon users: import `NeonPostgresClient`/`createNeonPostgresClient` from `@lushly-dev/violet-core/neon` (or the integration root) and keep `@neondatabase/serverless` and `ws` installed; they are optional peer dependencies of core now, so package managers do not install them for you (the integration declares them).
3. Native-only users (tokens, stores, transformers, CSS validators, OpenAPI document): no change. To drop the command layer, call `resolveTokens`/`exportTokens` and catch `TokenDomainError` instead of reading `result.error`.
4. CLI and MCP users: no change. Both endpoints depend on core directly, so strict peer settings need nothing extra; install `@lushly-dev/violet-cli` or `@lushly-dev/violet-server` as before.

This is a breaking change for direct importers of the moved names, so it ships as a breaking pre-1.0 minor. No Violet package has been published to npm, and by the owner's decision (2026-10-30) the first publication is 0.3.0 from AFD with the split layout; the Violet repository's release PR #135 is not merged. Four pending fragments in `.changeset/` bind the `violet-npm` unit to that minor: this split, plus Violet's three pending upstream changesets carried over verbatim with `@lushly-dev/violet-afd` added where their commands now live. A dry run with the inventory's fixed group versions all five packages to 0.3.0. They stay pending while the unit is quarantined; publication stays with the Violet repository until a recorded handoff.

Pre-1.0, a minor bump of `@lushly-dev/violet-core` leaves the integration's `^0.x` peer range, and Changesets then major-bumps the integration and, through the fixed group, every package. The integration therefore peers on `^0.2.0 || ^0.3.0`; widen it to the next minor in the same change as each later minor's fragments.

## AFD requirement

The integration depends on the workspace `@lushly-dev/afd-core` (`workspace:^2.2.0`, published as `^2.2.0`). The source's `^0.1.1` range was replaced on 2026-10-30; the `CommandResult` helpers and types it re-exports are unchanged in 2.x, and the full integration, CLI and server suites pass against it. A consumer that also installs AFD 2.x shares one copy with the integration; the packed consumers check that the integration's `success` is the consumer's. It stays a regular dependency, so the CLI and server need no new dependency. AFD releases cannot bump it: the version step narrows the workspace to the selected unit's packages.

## Validation routes

- `pnpm check` builds all five packages and runs their store-free suites.
- [`violet.yml`](../../../../.github/workflows/violet.yml) runs the full upstream suites with the SQLite legs (`test:db`), the upstream Biome 1.9 lint and the packed-artifact consumers in [`tests/consumers/violet`](../../../../tests/consumers/violet/verify-artifacts.mjs): Violet only (no AFD, no storage driver, Chromium HTML and runtime), integration absent/present/incompatible/unavailable, AFD 2.x beside it, and the two binaries.

## Limits and in-flight source changes

The Postgres and Neon store legs need `VIOLET_TEST_POSTGRES_URL`/`VIOLET_NEON_DATABASE_URL` and the two hosted-migration cases read `packages/api/migrations`, which arrives with the API in Phase 4; none ran. The CLI's CI-pin and skill-catalog checks read frozen copies of Violet's `ci.yml` and `violet-usage` skill. At the freeze point Violet had three pending changesets (`cli-contract-110-112`, `deprecation-plans-history-specimen-maps`, `engine-and-stores`: minor core/CLI, patch server) and open PRs #135 "chore: release packages" (head `b54b9f3b5c`: consumes those changesets and moves all four packages to 0.3.0) and #80 (head `3559d4b7e9`: Biome 1.9.4 to 2.6.2); none is imported, and each must be reconciled before any source or publisher cutover. All five distributions are quarantined, the consumers use local tarballs, and nothing was published.
