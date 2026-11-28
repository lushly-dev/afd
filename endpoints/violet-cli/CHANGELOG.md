# @lushly-dev/violet-cli

## 0.3.0-preview.8

### Patch Changes

- Updated dependencies [[`7b529fb`](https://github.com/lushly-dev/afd/commit/7b529fb09d15fd60e79a40e0baf9158f6f4f8383)]:
  - @lushly-dev/violet-afd@0.3.0-preview.8
  - @lushly-dev/violet-server@0.3.0-preview.8
  - @lushly-dev/violet-core@0.3.0-preview.8

## 0.3.0-preview.7

### Patch Changes

- Updated dependencies [[`6ef7e7d`](https://github.com/lushly-dev/afd/commit/6ef7e7d9cc3747e909421c19ad988250be6a16b4), [`57a092f`](https://github.com/lushly-dev/afd/commit/57a092f5db41aefa8027447717b1caa7d9138040), [`3f584d4`](https://github.com/lushly-dev/afd/commit/3f584d456193c14c46f2fb3fa30845a7e450d24a), [`6ef7e7d`](https://github.com/lushly-dev/afd/commit/6ef7e7d9cc3747e909421c19ad988250be6a16b4), [`15a4e44`](https://github.com/lushly-dev/afd/commit/15a4e44296dc2a9358b054d265f5331babc39725)]:
  - @lushly-dev/violet-afd@0.3.0-preview.7
  - @lushly-dev/violet-core@0.3.0-preview.7
  - @lushly-dev/violet-server@0.3.0-preview.7

## 0.3.0-preview.6

### Patch Changes

- [#2439](https://github.com/lushly-dev/afd/pull/2439) [`dffb249`](https://github.com/lushly-dev/afd/commit/dffb2491e854746da7f05f0c4ddd04e00c145cc9) Thanks [@Falkicon](https://github.com/Falkicon)! - Specimens take their component model from the components' token interface ([#1786](https://github.com/lushly-dev/afd/issues/1786)). `@lushly-dev/violet-afd` exports `SPECIMEN_INTERFACE_MAP`, which maps each role of the seven specimens (button, input, card, text, link, checkbox, focus) to the token id its `@lushly-dev/violet-elements` component reads in `tokens/interface.json` (`color.action.primary.background` for the button's background, `radius.lg` for the card's radius), with `SPECIMEN_INTERFACE`, `specimenRolesOf`, `specimenTakesRole` and `specimenInterfaceToken`. A tree that defines the interface ids now draws its specimens with no stored map. Roles whose value the component computes or hard-codes, or for which the interface has no token (among them the button's border and font weight, the button's and input's vertical padding, the checkbox's size, the link's underline and the focus ring's offset), have no interface id and are drawn only through a map. A test reads the interface and fails when a mapped id leaves it, changes to a type its role cannot draw, or the interface's `contractVersion` changes.

  - **Breaking (preview minor), `specimen.get`:** a role the stored map leaves out now draws from the interface id, not the `<component>.<role>` naming convention, which is gone: a tree that relied on tokens such as `button.background` must map them with `specimen.set`. Each role's `source` is `map`, `interface` or `unmapped` (no longer `convention`), its `tokenId` is null when neither the map nor the interface names one, and it gains `interfaceTokenId`. Each component gains `element` (the violet-elements tag it samples, or null for the link and focus ring), and the result gains `interface` (`{ package, contractVersion }`).
  - `specimen.set` checks components and roles against the same map; which components and roles it accepts is unchanged.
  - `@lushly-dev/violet-core` keeps the role validators (`SPECIMEN_ROLES`, `specimenRoleDeclaration`, `SPECIMEN_CHECK_PROPERTY`). `SPECIMEN_COMPONENTS`, `SpecimenComponent`, `SPECIMEN_REQUIRED_ROLE`, `conventionToken` and `specimenComponentHasRole` are deprecated in favour of violet-afd's map and helpers, are no longer read by the commands, and will be removed in a later release. The OpenAPI description of the specimen route says where unmapped roles draw from.
  - The demo tree (`violet demo`) names its component tokens `<component>.<role>`, so it now stores a specimen map on `global` and its specimens draw as before.
  - `violet specimen get` says that a tree with no map draws from the interface ids, and the MCP server's instructions describe the same.

- Updated dependencies [[`b868f8c`](https://github.com/lushly-dev/afd/commit/b868f8c19b4ac46ad7f90102164bf44fdd2bd59d)]:
  - @lushly-dev/violet-core@0.3.0-preview.6
  - @lushly-dev/violet-afd@0.3.0-preview.6
  - @lushly-dev/violet-server@0.3.0-preview.6

## 0.3.0-preview.5

### Patch Changes

- Updated dependencies [[`56681d5`](https://github.com/lushly-dev/afd/commit/56681d57aa645402fad648d615f4111ec189cdeb)]:
  - @lushly-dev/violet-afd@0.3.0-preview.5
  - @lushly-dev/violet-server@0.3.0-preview.5
  - @lushly-dev/violet-core@0.3.0-preview.5

## 0.3.0-preview.4

### Patch Changes

- Updated dependencies [[`4873305`](https://github.com/lushly-dev/afd/commit/4873305c76634295031b109ceefa7a3c017c77e5)]:
  - @lushly-dev/violet-core@0.3.0-preview.4
  - @lushly-dev/violet-afd@0.3.0-preview.4
  - @lushly-dev/violet-server@0.3.0-preview.4

## 0.3.0-preview.3

### Patch Changes

- Updated dependencies [[`b536522`](https://github.com/lushly-dev/afd/commit/b5365226a83c75125878a19d4f38e9e973285f7b)]:
  - @lushly-dev/violet-afd@0.3.0-preview.3
  - @lushly-dev/violet-core@0.3.0-preview.3
  - @lushly-dev/violet-server@0.3.0-preview.3

## 0.3.0-preview.2

### Patch Changes

- Updated dependencies [[`5d5febd`](https://github.com/lushly-dev/afd/commit/5d5febdf2330ec95f9b3b270d577ea0f71776963), [`96f4346`](https://github.com/lushly-dev/afd/commit/96f4346531cc2d4cd83764ba4521c21cb8cebf04)]:
  - @lushly-dev/violet-core@0.3.0-preview.2
  - @lushly-dev/violet-server@0.3.0-preview.2
  - @lushly-dev/violet-afd@0.3.0-preview.2

## 0.3.0-preview.1

### Minor Changes

- [#1422](https://github.com/lushly-dev/afd/pull/1422) [`1e2f231`](https://github.com/lushly-dev/afd/commit/1e2f2312ec4049fce354f1077d151a0cdbf56b50) Thanks [@Falkicon](https://github.com/Falkicon)! - Add a daily snapshot workflow template for a self-hosted runner's persistent SQLite database. Reject file-driven snapshot recording with an actionable error and document setup, verification and indefinite snapshot retention.

### Patch Changes

- [#1423](https://github.com/lushly-dev/afd/pull/1423) [`599be24`](https://github.com/lushly-dev/afd/commit/599be24536a5bb87c60264bd187cd698991fbc39) Thanks [@Falkicon](https://github.com/Falkicon)! - Deprecate `compare.nodes` in favour of `tokens.compare` ([#500](https://github.com/lushly-dev/afd/issues/500)), which compares two to four nodes and also counts absent and subtracted tokens; `violet compare` already runs it. `compare.nodes` will be removed in `@lushly-dev/violet-afd` 0.5.0. Until then it still works: its description starts with "Deprecated", a successful result carries a `DEPRECATED_COMMAND` warning, a `deprecated` metadata flag and a note in `reasoning`, and the HTTP API answers it with `Deprecation: true` and a `Link: </api/v1/tokens/compare>; rel="successor-version"` header, and lists it with `deprecated: true` in `GET /api/commands`. `CommandDefinition` gains an optional `deprecated` field (`{ replacement, removal }`) for other commands to use. The hosted OpenAPI document never described `compare.nodes`, so it has nothing to mark.
- Updated dependencies [[`599be24`](https://github.com/lushly-dev/afd/commit/599be24536a5bb87c60264bd187cd698991fbc39), [`8b54f66`](https://github.com/lushly-dev/afd/commit/8b54f6664d478695eb368236c48f5d740d5ee31d)]:
  - @lushly-dev/violet-afd@0.3.0-preview.1
  - @lushly-dev/violet-server@0.3.0-preview.1
  - @lushly-dev/violet-core@0.3.0-preview.1

## 0.3.0-preview.0

### Minor Changes

- [#488](https://github.com/lushly-dev/afd/pull/488) [`0a35249`](https://github.com/lushly-dev/afd/commit/0a352499b6f7417ab6a9a0a9493686b49a013776) Thanks [@Falkicon](https://github.com/Falkicon)! - Deprecation plans, rule-check history and specimen role maps. Nodes carry `sunsetAt` and `replacedBy` (`node.create` / `node.update`, `violet node create|update --sunset --replaced-by`), checked on write, with warnings for a date without a replacement and a deprecated replacement; `analyze.health` reports each plan with its usage and flags `sunset-without-replacement`, `replacement-deprecated` and `past-sunset`, and `nodes.graph` carries both fields. New `analyze.snapshot` (`violet snapshot`) stores rule check results, which `analyze.trends` reads back as `recorded` per day and `summary.history`. New `specimen.get` and `specimen.set` (`violet specimen get|set`) store which tokens draw each component specimen role, on the root of each tree; the component and role lists and each role's validated declaration are in `@lushly-dev/violet-core/css`. The `Database` interface gains `addCheckSnapshot`, `listCheckSnapshots`, `getSpecimenMap` and `setSpecimenMap`; SQLite and Postgres add the columns and tables on open, safely on existing data. The demo seed plans its deprecated branch and records checks along its history. The MCP server instructions describe the new commands.

- [#488](https://github.com/lushly-dev/afd/pull/488) [`0a35249`](https://github.com/lushly-dev/afd/commit/0a352499b6f7417ab6a9a0a9493686b49a013776) Thanks [@Falkicon](https://github.com/Falkicon)! - Engine and store follow-ups:

  - `tokens.matrix` builds cells only for the rows it returns, takes `around` (with `limit`: the page holding a token) and returns `page.offset` and `page.prevCursor`. `violet matrix --around <token>`.
  - `nodes.graph` lists each node's `subtractedTokens` and traces a token without describing every other token; its reads share the resolution cache.
  - `node.get` takes `includeOperations` (`violet node get <id> --ops`).
  - Cached include, copy and reset results keep `MAX_RESOLUTION_DEPTH`, so a deep include chain fails the same way whichever node was resolved first.
  - `Database.getAuditEvents` returns events newest first and matches the same fields on memory, SQLite and Postgres.

- [#488](https://github.com/lushly-dev/afd/pull/488) [`0a35249`](https://github.com/lushly-dev/afd/commit/0a352499b6f7417ab6a9a0a9493686b49a013776) Thanks [@Falkicon](https://github.com/Falkicon)! - First release from the AFD monorepo, with Violet split into foundations, an integration and endpoints. `@lushly-dev/violet-core` is now the native token engine and no longer contains AFD commands; they moved to the new `@lushly-dev/violet-afd`, which depends on `@lushly-dev/afd-core` 2.x. The CLI and server depend on `@lushly-dev/violet-afd`. Command, registry and `CommandResult` users add `@lushly-dev/violet-afd` and import from it instead of `@lushly-dev/violet-core`, keeping the same subpath. Its re-exported `isSuccess` and `isFailure` follow afd-core 2.x and check `success` alone. `violet --version`, the server version `violet mcp start` reports, the MCP server's default version and `system.doctor`'s `packageVersion` now report the installed package version instead of `0.1.0`. See docs/features/complete/platform-monorepo/violet-transition.md.

- [#931](https://github.com/lushly-dev/afd/pull/931) [`c61365d`](https://github.com/lushly-dev/afd/commit/c61365d8908b127cd24d43a53dffaf1868eb83a7) Thanks [@Falkicon](https://github.com/Falkicon)! - Violet moves to Zod 4, commander 15 and nanoid 6. `@lushly-dev/violet-core` and `@lushly-dev/violet-afd` export Zod 4 schemas, so code that composes them needs Zod 4 too; the inferred types are unchanged. Commands accept and reject the same input as before, but a validation error's issues use Zod 4's default wording (for example "Invalid input: expected string, received undefined" instead of "Required"); custom messages, the `VALIDATION_ERROR` code and the suggestion are unchanged. Command JSON Schemas now come from Zod's `z.toJSONSchema` instead of `zod-to-json-schema` and describe the same input, with some constructs spelled differently (`oneOf` for discriminated unions, `propertyNames` on records, safe-integer bounds on integers and a pattern beside `format: "date-time"`). The `violet` CLI rejects extra command arguments ("too many arguments") instead of ignoring them; its options and help text are unchanged. nanoid 6 supports Node 22, 24 and 26 or later.

### Patch Changes

- [#1130](https://github.com/lushly-dev/afd/pull/1130) [`9298052`](https://github.com/lushly-dev/afd/commit/9298052861aa917fa858cedd8f6f782cb20e6381) Thanks [@Falkicon](https://github.com/Falkicon)! - Each command now closes the SQLite database it opened when it finishes, so the database file and its `-wal` and `-shm` files are released and can be moved or deleted, which Windows refuses while a process holds them open. `closeDatabases()` is exported for a host that embeds the CLI, or a test that stubs `process.exit`: a command that exits through `process.exit` skips the automatic close.

- [#488](https://github.com/lushly-dev/afd/pull/488) [`0a35249`](https://github.com/lushly-dev/afd/commit/0a352499b6f7417ab6a9a0a9493686b49a013776) Thanks [@Falkicon](https://github.com/Falkicon)! - `violet call <command> --schema` prints the command's input as JSON Schema instead of a serialized Zod object, and `violet --json commands` lists every command with its input schema. Core adds `toJsonSchema` and `registry.getInputJsonSchema`, which the MCP tool generator and `docs.generate` now use too, so every surface shows the same schema.

  `violet api spec` prints the hosted API's OpenAPI document (every documented `/api/v1` path), built by core's new `buildOpenApiSpec`. `--yaml` emits valid YAML, and the servers are the `--server` / `VIOLET_API_URL` deployment and the local `vercel dev` server on port 3000, which `violet api start` now uses by default. `HOSTED_EXPORT_FORMATS` moves to core.

- Updated dependencies [[`0a35249`](https://github.com/lushly-dev/afd/commit/0a352499b6f7417ab6a9a0a9493686b49a013776), [`0a35249`](https://github.com/lushly-dev/afd/commit/0a352499b6f7417ab6a9a0a9493686b49a013776), [`0a35249`](https://github.com/lushly-dev/afd/commit/0a352499b6f7417ab6a9a0a9493686b49a013776), [`0cfca07`](https://github.com/lushly-dev/afd/commit/0cfca07a93b7f4a2d1b32a87b10cb5871d8c57f8), [`3151f58`](https://github.com/lushly-dev/afd/commit/3151f5815cc3b7a9154396b01e2d4475644bea7e), [`0a35249`](https://github.com/lushly-dev/afd/commit/0a352499b6f7417ab6a9a0a9493686b49a013776), [`c61365d`](https://github.com/lushly-dev/afd/commit/c61365d8908b127cd24d43a53dffaf1868eb83a7)]:
  - @lushly-dev/violet-core@0.3.0-preview.0
  - @lushly-dev/violet-server@0.3.0-preview.0
  - @lushly-dev/violet-afd@0.3.0-preview.0

## 0.2.0

### Minor Changes

- [#32](https://github.com/lushly-dev/violet/pull/32) [`1ed0dbb`](https://github.com/lushly-dev/violet/commit/1ed0dbb9d54e737d5f74fe26bf631e5ff3d37c79) Thanks [@Falkicon](https://github.com/Falkicon)! - Resolve token aliases on export: `{ ref }` values and DTCG `"{a.b}"` aliases are followed to their final values in the exported node, and missing or circular references fail with `TOKEN_REFERENCE_NOT_FOUND` / `CIRCULAR_REFERENCE`. `tokens.resolve` exposes `finalValue`, `aliasOf` and `referenceError`; `violet export css --references` keeps aliases as `var(--target)`.

- [#119](https://github.com/lushly-dev/violet/pull/119) [`d29994f`](https://github.com/lushly-dev/violet/commit/d29994f2d94be79339e51a4b25d75afe36888135) Thanks [@Falkicon](https://github.com/Falkicon)! - Add `analyze.trends` (CLI: `violet trends [--root id] [--since 90d] [--until time] [--no-violations]`): changes per UTC day from the audit log for a node and its descendants, and the rule issues open now by the day their failing value was last set, with a running count. The demo seed dates its audit events over the 12 weeks before it runs (`history: false` turns that off), so trends have history. The MCP server instructions mention the command.

- [#59](https://github.com/lushly-dev/violet/pull/59) [`6f2e253`](https://github.com/lushly-dev/violet/commit/6f2e2530688a29f20dec12ab93c4231d56cb8407) Thanks [@Falkicon](https://github.com/Falkicon)! - Add the `analyze.violations` command (CLI: `violet violations`, `GET /api/v1/analyze/violations`) to list every constraint violation across a subtree, errors first, with the node, token, rule, measured and required values, where the failing value is set, and the node's owner. `tokens.matrix` gains `onlyViolating` (`violet matrix --only-violations`, `?issues=true`) to keep only tokens with a violation.

- [#72](https://github.com/lushly-dev/violet/pull/72) [`1f4f5b5`](https://github.com/lushly-dev/violet/commit/1f4f5b5ee800f4f29f745bc5d9be392be623eb45) Thanks [@Falkicon](https://github.com/Falkicon)! - Add offline helpers for hosted API keys. `apikeys.create` (`violet apikeys create --id <id> --name <name> --scopes tokens:read,export:read [--rate-limit n]`) generates a 64-character token and returns its SHA-256 hash, a `VIOLET_API_KEYS_JSON` seed entry, and `INSERT` and revoke SQL. `apikeys.check` (`violet apikeys check [file|-]`, or `VIOLET_API_KEYS_JSON` when no file is given) checks a seed value before it is saved and exits 1 on errors: invalid JSON, missing `id`, `name` or `createdAt`, repeated tokens or ids, unknown scopes, and bad rate limits. Any one of these makes every key fail while seeding. It warns about broad scopes and about a `revokedAt` that seeding will ignore, and it never echoes tokens. Neither command connects to a database. The API now takes its scopes, dev key, and token hashing from core. `violet cicd setup` workflows run `npx --no violet` instead of `npx violet`, which in CI could install and run the unrelated npm package named `violet`.

- [#69](https://github.com/lushly-dev/violet/pull/69) [`2964478`](https://github.com/lushly-dev/violet/commit/2964478d7478100e218443679923a495603d8d78) Thanks [@Falkicon](https://github.com/Falkicon)! - Add the `changes.impact` command (CLI: `violet impact --node <id> --override token=value [--add …] [--reset token[=ancestor]] [--subtract token]`, `POST /api/v1/analyze/impact`) to preview token changes without writing them. Changes run in order through the same checks as `token.add`, `token.override`, `token.subtract` and `token.reset`, staged on a read-only `OverlayDatabase` whose writes throw. The result lists every node the change reaches (`via` inheritance, include or copy) with before → after cells and an effect (`changes`, `added`, `removed`, `shielded`, `unaffected`, `unresolved`), the constraint violations introduced and resolved, and the `violet token …` commands that apply it. The MCP server instructions mention it.

- [#74](https://github.com/lushly-dev/violet/pull/74) [`37c9e32`](https://github.com/lushly-dev/violet/commit/37c9e322b040dc597ad108fa2cdd18e89bc9857d) Thanks [@Falkicon](https://github.com/Falkicon)! - Rebuild the `violet cicd setup` workflows. `tokens-validate.yml` and `tokens-release.yml` run `npx --no -- violet --from tokens cicd validate|export` against the repo's DTCG node files instead of an empty local database. `tokens-sync.yml` runs `curl --fail` on a hosted `/api/v1/export/:nodeId/<format>` with a required `VIOLET_API_URL` variable and a `VIOLET_API_KEY` secret, creates the output folder first, and opens a pull request. Workflows use Node 24 and SHA-pinned actions, need no npm scripts, and say that `@lushly-dev/violet-cli` must be installable. New `--node` and `--tokens-dir` options; unknown templates and platforms exit 1; `--json` returns the next steps. Setup no longer writes `style-dictionary.config.js`. `violet init` now honours `--json` and `--agent`.

- [#106](https://github.com/lushly-dev/violet/pull/106) [`6c6cf14`](https://github.com/lushly-dev/violet/commit/6c6cf1420247f0b058535bfb4bae745a0050ef27) Thanks [@Falkicon](https://github.com/Falkicon)! - `violet api spec` no longer lists the `api.violet.design` placeholder as a server: it lists the local server, plus the deployment from the new `--server <url>` option or `VIOLET_API_URL`. The `tokens-sync.yml` template from `violet cicd setup` can now fetch `swift`, `kotlin` and `dart` from the hosted API, and names Kotlin files `.kt`.

- [#22](https://github.com/lushly-dev/violet/pull/22) [`b2c681b`](https://github.com/lushly-dev/violet/commit/b2c681ba1cab2afe209faa75225f67541cca01e8) Thanks [@Falkicon](https://github.com/Falkicon)! - Add realistic demo data: `seedRealisticSystem` in core and `violet demo seed` in the CLI build a multi-product design system into an empty database. The local API server can serve a SQLite database via `VIOLET_DB_PATH`.

- [#31](https://github.com/lushly-dev/violet/pull/31) [`fc013ea`](https://github.com/lushly-dev/violet/commit/fc013ea33e1901e848a7d9354f424a4a3e0b731d) Thanks [@Falkicon](https://github.com/Falkicon)! - Export from in-repo DTCG node files without a database (`violet --from <dir>`, `import.tree`), read DTCG `$value`/`$type`/`$description` on import, add a Lua (FenUI) exporter, and load `better-sqlite3` and `violet-server` only when needed. Importing into a child node now overrides inherited tokens instead of being ignored.

- [#84](https://github.com/lushly-dev/violet/pull/84) [`32d8675`](https://github.com/lushly-dev/violet/commit/32d8675c9ab0ee670a25d276ed408a5a0b4898e3) Thanks [@Falkicon](https://github.com/Falkicon)! - Add `analyze.health` (CLI: `violet health [--root id] [--baseline parent|root|<id>] [--sort drift|violations|customizations] [--no-violations]`, `GET /api/v1/analyze/health`) and `audit.list` (CLI: `violet audit [--node id] [--subtree] [--token id] [--type a,b] [--actor name] [--since 30d] [--until time] [--limit n] [--offset n]`, `GET /api/v1/audit`). `analyze.health` reports per node its own customizations by category, drift against a baseline, violations by severity, owner, status, coupling (mix-ins, borrows, borrowers) and subtree totals, and flags redundant overrides, sibling borrows and deprecated nodes with children. `audit.list` queries the audit log newest first with paging and counts per UTC day. The `Database` interface gains `queryAuditEvents`, implemented by the memory, SQLite, Postgres/Neon and overlay stores. The hosted audit route needs the new `audit:read` scope. The MCP server instructions mention both commands.

- [#33](https://github.com/lushly-dev/violet/pull/33) [`16736df`](https://github.com/lushly-dev/violet/commit/16736dffc1d555b8800499593c90e9a6475bb484) Thanks [@Falkicon](https://github.com/Falkicon)! - Read top-level `global` / `semantic` / `component` groups as token tiers on import (opt-in: `tiers` on `import.json` / `import.validate`, `--tiers` in the CLI, or `tiers: true` in an `import.tree` node file). The tier is stored as `metadata.tier` and left out of the token ID. Duplicate IDs across tiers are an error.

- [#61](https://github.com/lushly-dev/violet/pull/61) [`117c354`](https://github.com/lushly-dev/violet/commit/117c354db74e3ac07a8a6ff1135111d6e1c67db4) Thanks [@Falkicon](https://github.com/Falkicon)! - `token.lineage` steps for copies, includes and resets name the node the value comes from (`fromNode`, `fromOwner`, `fromToken` for a renamed copy) and report `tracksSource: true`, since those values are re-resolved from the source on every read. Steps replaced by a later change on the same node are marked `superseded`. `nodes.graph` operations add `supersededBy` (and `tracksSource` on copies), and `tokens.matrix` cells add `fromNode`.

- [#81](https://github.com/lushly-dev/violet/pull/81) [`17fb650`](https://github.com/lushly-dev/violet/commit/17fb650f7042a8c6542dce198982f14a1d915ca2) Thanks [@Falkicon](https://github.com/Falkicon)! - Scale the matrix to real design systems ([#36](https://github.com/lushly-dev/violet/issues/36)). Read-only commands that resolve many nodes (`tokens.matrix`, `nodes.graph --token`, `changes.impact`, `analyze.violations`) share a per-run `ResolutionCache`: each node is read once and a child starts from its parent's resolved tokens, with the same results. On the demo system, `tokens.matrix` for all nodes drops from 129 to 40 ms. `tokens.matrix` gains `groupBy` (`category` or `tier`, with per-group counts), `summaryOnly`, and `limit`/`cursor` paging: CLI `violet matrix --group --summary --limit --cursor`, API `?group`, `?summary`, `?limit`, `?cursor`.

- [#108](https://github.com/lushly-dev/violet/pull/108) [`7480f9b`](https://github.com/lushly-dev/violet/commit/7480f9bc624a720d920e8c4d8f8fc5fb2795e5dc) Thanks [@Falkicon](https://github.com/Falkicon)! - `tokens.matrix` takes `sort` (`token-asc`, the default, or `token-desc`), applied within each group when grouping; page cursors carry it, and a cursor from the other order is rejected ([#83](https://github.com/lushly-dev/violet/issues/83)). CLI: `violet matrix --sort token-desc`.

- [#22](https://github.com/lushly-dev/violet/pull/22) [`1f54ec7`](https://github.com/lushly-dev/violet/commit/1f54ec7f1ebff1f613003b129a7027c2c283119e) Thanks [@Falkicon](https://github.com/Falkicon)! - Add the `nodes.graph` command (CLI: `violet tree`). It returns the node hierarchy as a graph with parent, include and copy edges, per-node change counts, optional per-node operations, and an optional token trace. The MCP server instructions list the new command.

- [#23](https://github.com/lushly-dev/violet/pull/23) [`0ddbffb`](https://github.com/lushly-dev/violet/commit/0ddbffb8a0997a31a98f3cf56fe93f635a48db0c) Thanks [@Falkicon](https://github.com/Falkicon)! - Add the `tokens.catalog` command (CLI: `violet catalog`) to find tokens by words, category, tier or status and see where each is customized or removed. `tokens.matrix` gains a `category` filter (`violet matrix --category`), and `nodes.graph` adds per-category change counts (`changes.byCategory`) and node owners.

- [#120](https://github.com/lushly-dev/violet/pull/120) [`a283750`](https://github.com/lushly-dev/violet/commit/a283750b6942d43970e20c9fa48d0d1dba356ea0) Thanks [@Falkicon](https://github.com/Falkicon)! - Add `tokens.compare` ([#37](https://github.com/lushly-dev/violet/issues/37)): two to four nodes token by token, each cell flagged when it differs from the first node, with counts per category and a similarity per pair. `violet compare a b [c d]` now runs it (`--all`, `--category`, `--filter`); `compare.nodes` stays for existing callers. The MCP server instructions describe it. Core also exports allow-list CSS validators from `@lushly-dev/violet-core/css`: `safeCssColor`, `safeCssLength`, `safeFontFamily`, `safeShadow`, `safeDuration`, `safeEasing` and `safeCssNumber`.

- [#20](https://github.com/lushly-dev/violet/pull/20) [`f72a360`](https://github.com/lushly-dev/violet/commit/f72a360bba189e0270b8b9532f0e693583a183a9) Thanks [@Falkicon](https://github.com/Falkicon)! - Add the `tokens.matrix` command (CLI: `violet matrix`). It resolves tokens across a subtree, explicit nodes, or the whole tree and reports each token × node cell's value, how it got there, its source node, and optional constraint violations. The MCP server instructions list the new command.

### Patch Changes

- [#63](https://github.com/lushly-dev/violet/pull/63) [`5fa2394`](https://github.com/lushly-dev/violet/commit/5fa239447142385a847d51e8d743499fda306e8c) Thanks [@Falkicon](https://github.com/Falkicon)! - `tokens.matrix` and `nodes.graph` trace cells carry `aliasOf` and `referenceError` next to the followed `resolvedValue`. `onlyVarying` (`violet matrix --varying`) compares a token within each hierarchy and leaves out hierarchies that never had it, such as a shared set's own root; removals still count as differences, and references are compared by the values they resolve to.

- [#64](https://github.com/lushly-dev/violet/pull/64) [`ee58bfa`](https://github.com/lushly-dev/violet/commit/ee58bfa5d22dac99ed8f7f2284d81f81a840ca02) Thanks [@Falkicon](https://github.com/Falkicon)! - Relicense under MIT and publish publicly to npm. Each package now ships a README and full npm metadata (repository, homepage, bugs, keywords, engines).

- [#107](https://github.com/lushly-dev/violet/pull/107) [`da3ad78`](https://github.com/lushly-dev/violet/commit/da3ad78dbdff0c784090cc128c37296f623b5a7a) Thanks [@Falkicon](https://github.com/Falkicon)! - Fix four store and resolver correctness issues. Audit events keep the order they were written in on every store (a `seq` column, added to existing SQLite and Postgres tables on open), so `audit.list` pages are stable. `token.override`, `token.subtract`, `token.reset` and `token.copy` record the value the node resolved before the change as `oldValue`, inherited or not, with `oldValueFrom` and `inherited` in the event metadata. A stored reset is resolved from the node that stores it, so it lands the same way for that node and its descendants; `token.reset` refuses a root, and `analyze.health` flags resets that do nothing as `inert-reset` (`violet health` labels them "inert reset"). The store contract tests now run on Postgres too.

- Updated dependencies [[`1ed0dbb`](https://github.com/lushly-dev/violet/commit/1ed0dbb9d54e737d5f74fe26bf631e5ff3d37c79), [`d29994f`](https://github.com/lushly-dev/violet/commit/d29994f2d94be79339e51a4b25d75afe36888135), [`6f2e253`](https://github.com/lushly-dev/violet/commit/6f2e2530688a29f20dec12ab93c4231d56cb8407), [`e8b3a4d`](https://github.com/lushly-dev/violet/commit/e8b3a4d846b7c2883e89efc94a54f5984b9033c4), [`1b59072`](https://github.com/lushly-dev/violet/commit/1b590726eb6372a910c570db7109c6cbb0a5db60), [`1f4f5b5`](https://github.com/lushly-dev/violet/commit/1f4f5b5ee800f4f29f745bc5d9be392be623eb45), [`2964478`](https://github.com/lushly-dev/violet/commit/2964478d7478100e218443679923a495603d8d78), [`b2c681b`](https://github.com/lushly-dev/violet/commit/b2c681ba1cab2afe209faa75225f67541cca01e8), [`fc013ea`](https://github.com/lushly-dev/violet/commit/fc013ea33e1901e848a7d9354f424a4a3e0b731d), [`32d8675`](https://github.com/lushly-dev/violet/commit/32d8675c9ab0ee670a25d276ed408a5a0b4898e3), [`16736df`](https://github.com/lushly-dev/violet/commit/16736dffc1d555b8800499593c90e9a6475bb484), [`117c354`](https://github.com/lushly-dev/violet/commit/117c354db74e3ac07a8a6ff1135111d6e1c67db4), [`17fb650`](https://github.com/lushly-dev/violet/commit/17fb650f7042a8c6542dce198982f14a1d915ca2), [`7480f9b`](https://github.com/lushly-dev/violet/commit/7480f9bc624a720d920e8c4d8f8fc5fb2795e5dc), [`5fa2394`](https://github.com/lushly-dev/violet/commit/5fa239447142385a847d51e8d743499fda306e8c), [`ee58bfa`](https://github.com/lushly-dev/violet/commit/ee58bfa5d22dac99ed8f7f2284d81f81a840ca02), [`1f54ec7`](https://github.com/lushly-dev/violet/commit/1f54ec7f1ebff1f613003b129a7027c2c283119e), [`da3ad78`](https://github.com/lushly-dev/violet/commit/da3ad78dbdff0c784090cc128c37296f623b5a7a), [`0ddbffb`](https://github.com/lushly-dev/violet/commit/0ddbffb8a0997a31a98f3cf56fe93f635a48db0c), [`a283750`](https://github.com/lushly-dev/violet/commit/a283750b6942d43970e20c9fa48d0d1dba356ea0), [`f72a360`](https://github.com/lushly-dev/violet/commit/f72a360bba189e0270b8b9532f0e693583a183a9)]:
  - @lushly-dev/violet-core@0.2.0
  - @lushly-dev/violet-server@0.2.0
