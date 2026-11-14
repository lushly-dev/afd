# Violet foundation

Violet's native token engine and web runtime, imported from [lushly-dev/violet](https://github.com/lushly-dev/violet) main `59b4bfa6` in platform migration Phase 3. File-level hashes and the reason for every adaptation are in [`provenance`](./provenance/provenance.json); the public contract changes are in the [transition notes](../../docs/features/active/platform-monorepo/violet-transition.md).

| Unit | Layer | Path | Contract |
| --- | --- | --- | --- |
| `@lushly-dev/violet-core` 0.3.0-preview | foundation | [`packages/core`](./packages/core/README.md) | Data contracts, storage, inheritance resolution, export, CSS validators. Requires only `zod`; SQLite and Neon drivers are optional. No AFD dependency, peer or type reference. |
| `@lushly-dev/violet-runtime` 0.3.0-preview | foundation | [`packages/runtime`](./packages/runtime/README.md) | Browser SDK for token loading and theme switching. Adapted for Loam (D50): a preloaded token source in place of a token server, and a high-contrast theme for `ThemeManager.useSystemPreference`. |
| `@lushly-dev/violet-afd` 0.3.0-preview | integration | [`integrations/violet-afd`](../../integrations/violet-afd/README.md) | The command registry, commands, `CommandResult` types and demo seed. Peer `@lushly-dev/violet-core`; depends on `@lushly-dev/afd-core` `^2.2.0` (the workspace AFD core). |
| `@lushly-dev/violet-cli` 0.3.0-preview | endpoint | [`endpoints/violet-cli`](../../endpoints/violet-cli/README.md) | `violet` binary. |
| `@lushly-dev/violet-server` 0.3.0-preview | endpoint | [`endpoints/violet-server`](../../endpoints/violet-server/README.md) | `violet-mcp` binary, MCP server and local REST API (`.`, `./server`, `./api`). |

The Violet API, web, Figma applications, the test workspace and the patched FAST archives stay in the Violet repository until Phase 4.

## Configuration

`tsconfig.json` and `biome.json` here are the upstream root configurations, adapted as `provenance/adaptations.json` records; the five packages extend them. Violet's tool versions match the workspace (Biome 2, Vitest 5, Zod 4, TypeScript 7), but it keeps TypeScript bundler resolution and its own Biome configuration, which the root Biome configuration does not lint: the root's formatter (`trailingCommas: "es5"`) and stricter rules would rewrite most imported files before the upstream reconcile. Biome sorts imports, not the export lists of `index.ts` barrels. `violet-runtime` targets browsers and names `types: []`; the other four units use Node's types.

## Gates

- `pnpm check` builds all five packages and runs their store-free suites (`test`).
- [`violet.yml`](../../.github/workflows/violet.yml) builds the SQLite driver and runs the full upstream suites (`test:db`), the upstream Biome lint, and the packed-artifact consumers in [`tests/consumers/violet`](../../tests/consumers/violet/verify-artifacts.mjs).
- Its `stores` job runs the core and integration suites on a `postgres:17` service with the Postgres leg required (`VIOLET_TEST_POSTGRES=required`). With `VIOLET_NEON_LOCAL_PROXY=1`, `src/db/neon-local.test-support.ts` bridges Neon's WebSocket protocol to that server in-process, so the Neon leg runs the real `@neondatabase/serverless` driver path; hosted Neon is not exercised. Locally: `VIOLET_TEST_POSTGRES_URL=postgres://… VIOLET_NEON_LOCAL_PROXY=1 pnpm -F @lushly-dev/violet-core -F @lushly-dev/violet-afd test:db`.
- The two hosted-migration cases read `packages/api/migrations`, which ships with the Violet API app; they skip until it is imported.

## Release

All five distributions are one `violet-npm` unit in [`scripts/release/inventory.json`](../../scripts/release/inventory.json), fixed like the upstream Changesets group. Since the owner's approval on 2026-11-14 it is admitted on the `npm-prerelease` route: AFD's `release.yml` publishes it under the npm tag `preview` (`npm install @lushly-dev/violet-core@preview`); once the maintainer has created each name with its `0.0.0-bootstrap.0` placeholder, `latest` stays on that placeholder. The manifests are at the seed `0.3.0-preview`, so the first preview is `0.3.0-preview.0`. The [handoff record](../../docs/features/active/platform-monorepo/violet-handoff.md) moves publishing from the Violet repository, which never published, and lists the owner's steps.
