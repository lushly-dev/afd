# Violet foundation

Violet's native token engine and web runtime, imported from [lushly-dev/violet](https://github.com/lushly-dev/violet) main `59b4bfa6` in platform migration Phase 3. File-level hashes and the reason for every adaptation are in [`provenance`](./provenance/provenance.json); the public contract changes are in the [transition notes](../../docs/features/active/platform-monorepo/violet-transition.md).

| Unit | Layer | Path | Contract |
| --- | --- | --- | --- |
| `@lushly-dev/violet-core` 0.2.0 | foundation | [`packages/core`](./packages/core/README.md) | Data contracts, storage, inheritance resolution, export, CSS validators. Requires only `zod`; SQLite and Neon drivers are optional. No AFD dependency, peer or type reference. |
| `@lushly-dev/violet-runtime` 0.2.0 | foundation | [`packages/runtime`](./packages/runtime/README.md) | Browser SDK for token loading and theme switching. Unchanged. |
| `@lushly-dev/violet-afd` 0.2.0 | integration | [`integrations/violet-afd`](../../integrations/violet-afd/README.md) | The command registry, commands, `CommandResult` types and demo seed. Peer `@lushly-dev/violet-core`; depends on `@lushly-dev/afd-core` `^2.2.0` (the workspace AFD core). |
| `@lushly-dev/violet-cli` 0.2.0 | endpoint | [`endpoints/violet-cli`](../../endpoints/violet-cli/README.md) | `violet` binary. |
| `@lushly-dev/violet-server` 0.2.0 | endpoint | [`endpoints/violet-server`](../../endpoints/violet-server/README.md) | `violet-mcp` binary, MCP server and local REST API (`.`, `./server`, `./api`). |

The Violet API, web, Figma applications, the test workspace and the patched FAST archives stay in the Violet repository until Phase 4.

## Configuration

`tsconfig.json` and `biome.json` here are the upstream root configurations, unchanged; the five packages extend them. Violet keeps its own toolchain: Biome 1.9, Vitest 3, Zod 3 and TypeScript bundler resolution. The root Biome configuration does not lint these directories.

## Gates

- `pnpm check` builds all five packages and runs their store-free suites (`test`).
- [`violet.yml`](../../.github/workflows/violet.yml) builds the SQLite driver and runs the full upstream suites (`test:db`), the upstream Biome lint, and the packed-artifact consumers in [`tests/consumers/violet`](../../tests/consumers/violet/verify-artifacts.mjs).
- Its `stores` job runs the core and integration suites on a `postgres:17` service with the Postgres leg required (`VIOLET_TEST_POSTGRES=required`). With `VIOLET_NEON_LOCAL_PROXY=1`, `src/db/neon-local.test-support.ts` bridges Neon's WebSocket protocol to that server in-process, so the Neon leg runs the real `@neondatabase/serverless` driver path; hosted Neon is not exercised. Locally: `VIOLET_TEST_POSTGRES_URL=postgres://… VIOLET_NEON_LOCAL_PROXY=1 pnpm -F @lushly-dev/violet-core -F @lushly-dev/violet-afd test:db`.
- The two hosted-migration cases read `packages/api/migrations`, which ships with the Violet API app; they skip until it is imported.

## Release

All five distributions are one quarantined `violet-npm` unit in [`scripts/release/inventory.json`](../../scripts/release/inventory.json), fixed like the upstream Changesets group. Violet's own repository keeps sole publishing authority; nothing here publishes.
