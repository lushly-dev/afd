# @lushly-dev/violet-server

## 0.3.0-preview.8

### Patch Changes

- Updated dependencies [[`7b529fb`](https://github.com/lushly-dev/afd/commit/7b529fb09d15fd60e79a40e0baf9158f6f4f8383)]:
  - @lushly-dev/violet-afd@0.3.0-preview.8
  - @lushly-dev/violet-core@0.3.0-preview.8

## 0.3.0-preview.7

### Patch Changes

- Updated dependencies [[`6ef7e7d`](https://github.com/lushly-dev/afd/commit/6ef7e7d9cc3747e909421c19ad988250be6a16b4), [`57a092f`](https://github.com/lushly-dev/afd/commit/57a092f5db41aefa8027447717b1caa7d9138040), [`3f584d4`](https://github.com/lushly-dev/afd/commit/3f584d456193c14c46f2fb3fa30845a7e450d24a), [`6ef7e7d`](https://github.com/lushly-dev/afd/commit/6ef7e7d9cc3747e909421c19ad988250be6a16b4), [`15a4e44`](https://github.com/lushly-dev/afd/commit/15a4e44296dc2a9358b054d265f5331babc39725)]:
  - @lushly-dev/violet-afd@0.3.0-preview.7
  - @lushly-dev/violet-core@0.3.0-preview.7

## 0.3.0-preview.6

### Minor Changes

- [#2295](https://github.com/lushly-dev/afd/pull/2295) [`b868f8c`](https://github.com/lushly-dev/afd/commit/b868f8c19b4ac46ad7f90102164bf44fdd2bd59d) Thanks [@Falkicon](https://github.com/Falkicon)! - Implement Scales Phase 1 (two-stage ramps, governed off-ramp exceptions, and Slice 1 scenarios, [#2195](https://github.com/lushly-dev/afd/issues/2195), epic [#1111](https://github.com/lushly-dev/afd/issues/1111)):

  - **`@lushly-dev/violet-core`:** Expose `reason?: string` on `ResolvedToken` with exact propagation across `add`, `override` (clearing any prior ancestor reason when omitted/blank), `reset`, `copy`, and `include`; add `type: 'ramp'` (`RampConfigSchema`) and `pattern.target?: 'value' | 'id'` to `ConstraintConfigSchema`; add multi-violation registry evaluation (`validateValues` / `validateConstraintForToken`) with optional stable sub-check `code` (`ramp:broken-ref`, `ramp:wrong-family`, `ramp:unreasoned`, `ramp:pair`, `ramp:repeat`) and preserved advisory `'warning'` severity; persist optional `code` on `CheckIssueSchema`; export `validateConstraints(db, nodeId, options?)` and add `excludePrefixes?: string[]` to `resolveTokens` and `exportTokens`.
  - **`@lushly-dev/violet-afd`:** Extend `constraints.set` (handler-level validation for `ramp` and `repeatThreshold >= 2` with field-specific suggestions), `constraints.validate` (core `validateConstraints` delegation and `onlyViolating`), `analyze.violations` (core delegation and violation `code`), `analyze.snapshot` (`code` + `severity` in `issueKey`), `tokens.resolve` (`reason` output and `excludePrefixes`), `export` (`excludePrefixes`), `interface.check` (`privatePrefixes` default `['ref.']` and sorted/deduped `leaked` reporting), `changes.impact` (`reason` on `add`/`override`, reason-only `diffViolations` including `reset`, `code`+`severity` violation keying), and `import.json`/`import.tree` (`reason: null` default unless `$extensions['dev.lushly.violet'].reason` is set on DTCG or Style Dictionary leaves). Add the `app: 'violet'` JTBD scenario fixture adapter and run Slice 1 scenarios 01–07 in Vitest.
  - **`@lushly-dev/violet-server`:** Document `type: 'ramp'`, `merge: true`, `excludePrefixes: ['ref.']`, and `analyze.violations` in MCP server instructions.

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

## 0.3.0-preview.5

### Patch Changes

- Updated dependencies [[`56681d5`](https://github.com/lushly-dev/afd/commit/56681d57aa645402fad648d615f4111ec189cdeb)]:
  - @lushly-dev/violet-afd@0.3.0-preview.5
  - @lushly-dev/violet-core@0.3.0-preview.5

## 0.3.0-preview.4

### Patch Changes

- Updated dependencies [[`4873305`](https://github.com/lushly-dev/afd/commit/4873305c76634295031b109ceefa7a3c017c77e5)]:
  - @lushly-dev/violet-core@0.3.0-preview.4
  - @lushly-dev/violet-afd@0.3.0-preview.4

## 0.3.0-preview.3

### Patch Changes

- Updated dependencies [[`b536522`](https://github.com/lushly-dev/afd/commit/b5365226a83c75125878a19d4f38e9e973285f7b)]:
  - @lushly-dev/violet-afd@0.3.0-preview.3
  - @lushly-dev/violet-core@0.3.0-preview.3

## 0.3.0-preview.2

### Minor Changes

- [#1837](https://github.com/lushly-dev/afd/pull/1837) [`96f4346`](https://github.com/lushly-dev/afd/commit/96f4346531cc2d4cd83764ba4521c21cb8cebf04) Thanks [@Falkicon](https://github.com/Falkicon)! - The MCP server no longer lists or runs `validate` and `doctor`, as the HTTP API already did: `validate` runs `pnpm test` on the server host and `doctor` inspects its environment. The CLI keeps both.

### Patch Changes

- Updated dependencies [[`5d5febd`](https://github.com/lushly-dev/afd/commit/5d5febdf2330ec95f9b3b270d577ea0f71776963)]:
  - @lushly-dev/violet-core@0.3.0-preview.2
  - @lushly-dev/violet-afd@0.3.0-preview.2

## 0.3.0-preview.1

### Minor Changes

- [#1423](https://github.com/lushly-dev/afd/pull/1423) [`599be24`](https://github.com/lushly-dev/afd/commit/599be24536a5bb87c60264bd187cd698991fbc39) Thanks [@Falkicon](https://github.com/Falkicon)! - Deprecate `compare.nodes` in favour of `tokens.compare` ([#500](https://github.com/lushly-dev/afd/issues/500)), which compares two to four nodes and also counts absent and subtracted tokens; `violet compare` already runs it. `compare.nodes` will be removed in `@lushly-dev/violet-afd` 0.5.0. Until then it still works: its description starts with "Deprecated", a successful result carries a `DEPRECATED_COMMAND` warning, a `deprecated` metadata flag and a note in `reasoning`, and the HTTP API answers it with `Deprecation: true` and a `Link: </api/v1/tokens/compare>; rel="successor-version"` header, and lists it with `deprecated: true` in `GET /api/commands`. `CommandDefinition` gains an optional `deprecated` field (`{ replacement, removal }`) for other commands to use. The hosted OpenAPI document never described `compare.nodes`, so it has nothing to mark.

### Patch Changes

- Updated dependencies [[`599be24`](https://github.com/lushly-dev/afd/commit/599be24536a5bb87c60264bd187cd698991fbc39), [`8b54f66`](https://github.com/lushly-dev/afd/commit/8b54f6664d478695eb368236c48f5d740d5ee31d)]:
  - @lushly-dev/violet-afd@0.3.0-preview.1
  - @lushly-dev/violet-core@0.3.0-preview.1

## 0.3.0-preview.0

### Minor Changes

- [#488](https://github.com/lushly-dev/afd/pull/488) [`0a35249`](https://github.com/lushly-dev/afd/commit/0a352499b6f7417ab6a9a0a9493686b49a013776) Thanks [@Falkicon](https://github.com/Falkicon)! - First release from the AFD monorepo, with Violet split into foundations, an integration and endpoints. `@lushly-dev/violet-core` is now the native token engine and no longer contains AFD commands; they moved to the new `@lushly-dev/violet-afd`, which depends on `@lushly-dev/afd-core` 2.x. The CLI and server depend on `@lushly-dev/violet-afd`. Command, registry and `CommandResult` users add `@lushly-dev/violet-afd` and import from it instead of `@lushly-dev/violet-core`, keeping the same subpath. Its re-exported `isSuccess` and `isFailure` follow afd-core 2.x and check `success` alone. `violet --version`, the server version `violet mcp start` reports, the MCP server's default version and `system.doctor`'s `packageVersion` now report the installed package version instead of `0.1.0`. See docs/features/complete/platform-monorepo/violet-transition.md.

### Patch Changes

- [#488](https://github.com/lushly-dev/afd/pull/488) [`0a35249`](https://github.com/lushly-dev/afd/commit/0a352499b6f7417ab6a9a0a9493686b49a013776) Thanks [@Falkicon](https://github.com/Falkicon)! - `violet call <command> --schema` prints the command's input as JSON Schema instead of a serialized Zod object, and `violet --json commands` lists every command with its input schema. Core adds `toJsonSchema` and `registry.getInputJsonSchema`, which the MCP tool generator and `docs.generate` now use too, so every surface shows the same schema.

  `violet api spec` prints the hosted API's OpenAPI document (every documented `/api/v1` path), built by core's new `buildOpenApiSpec`. `--yaml` emits valid YAML, and the servers are the `--server` / `VIOLET_API_URL` deployment and the local `vercel dev` server on port 3000, which `violet api start` now uses by default. `HOSTED_EXPORT_FORMATS` moves to core.

- [#488](https://github.com/lushly-dev/afd/pull/488) [`0a35249`](https://github.com/lushly-dev/afd/commit/0a352499b6f7417ab6a9a0a9493686b49a013776) Thanks [@Falkicon](https://github.com/Falkicon)! - Deprecation plans, rule-check history and specimen role maps. Nodes carry `sunsetAt` and `replacedBy` (`node.create` / `node.update`, `violet node create|update --sunset --replaced-by`), checked on write, with warnings for a date without a replacement and a deprecated replacement; `analyze.health` reports each plan with its usage and flags `sunset-without-replacement`, `replacement-deprecated` and `past-sunset`, and `nodes.graph` carries both fields. New `analyze.snapshot` (`violet snapshot`) stores rule check results, which `analyze.trends` reads back as `recorded` per day and `summary.history`. New `specimen.get` and `specimen.set` (`violet specimen get|set`) store which tokens draw each component specimen role, on the root of each tree; the component and role lists and each role's validated declaration are in `@lushly-dev/violet-core/css`. The `Database` interface gains `addCheckSnapshot`, `listCheckSnapshots`, `getSpecimenMap` and `setSpecimenMap`; SQLite and Postgres add the columns and tables on open, safely on existing data. The demo seed plans its deprecated branch and records checks along its history. The MCP server instructions describe the new commands.

- [#931](https://github.com/lushly-dev/afd/pull/931) [`c61365d`](https://github.com/lushly-dev/afd/commit/c61365d8908b127cd24d43a53dffaf1868eb83a7) Thanks [@Falkicon](https://github.com/Falkicon)! - Violet moves to Zod 4, commander 15 and nanoid 6. `@lushly-dev/violet-core` and `@lushly-dev/violet-afd` export Zod 4 schemas, so code that composes them needs Zod 4 too; the inferred types are unchanged. Commands accept and reject the same input as before, but a validation error's issues use Zod 4's default wording (for example "Invalid input: expected string, received undefined" instead of "Required"); custom messages, the `VALIDATION_ERROR` code and the suggestion are unchanged. Command JSON Schemas now come from Zod's `z.toJSONSchema` instead of `zod-to-json-schema` and describe the same input, with some constructs spelled differently (`oneOf` for discriminated unions, `propertyNames` on records, safe-integer bounds on integers and a pattern beside `format: "date-time"`). The `violet` CLI rejects extra command arguments ("too many arguments") instead of ignoring them; its options and help text are unchanged. nanoid 6 supports Node 22, 24 and 26 or later.
- Updated dependencies [[`0a35249`](https://github.com/lushly-dev/afd/commit/0a352499b6f7417ab6a9a0a9493686b49a013776), [`0a35249`](https://github.com/lushly-dev/afd/commit/0a352499b6f7417ab6a9a0a9493686b49a013776), [`0a35249`](https://github.com/lushly-dev/afd/commit/0a352499b6f7417ab6a9a0a9493686b49a013776), [`0cfca07`](https://github.com/lushly-dev/afd/commit/0cfca07a93b7f4a2d1b32a87b10cb5871d8c57f8), [`3151f58`](https://github.com/lushly-dev/afd/commit/3151f5815cc3b7a9154396b01e2d4475644bea7e), [`0a35249`](https://github.com/lushly-dev/afd/commit/0a352499b6f7417ab6a9a0a9493686b49a013776), [`c61365d`](https://github.com/lushly-dev/afd/commit/c61365d8908b127cd24d43a53dffaf1868eb83a7)]:
  - @lushly-dev/violet-core@0.3.0-preview.0
  - @lushly-dev/violet-afd@0.3.0-preview.0

## 0.2.0

### Patch Changes

- [#119](https://github.com/lushly-dev/violet/pull/119) [`d29994f`](https://github.com/lushly-dev/violet/commit/d29994f2d94be79339e51a4b25d75afe36888135) Thanks [@Falkicon](https://github.com/Falkicon)! - Add `analyze.trends` (CLI: `violet trends [--root id] [--since 90d] [--until time] [--no-violations]`): changes per UTC day from the audit log for a node and its descendants, and the rule issues open now by the day their failing value was last set, with a running count. The demo seed dates its audit events over the 12 weeks before it runs (`history: false` turns that off), so trends have history. The MCP server instructions mention the command.

- [#59](https://github.com/lushly-dev/violet/pull/59) [`6f2e253`](https://github.com/lushly-dev/violet/commit/6f2e2530688a29f20dec12ab93c4231d56cb8407) Thanks [@Falkicon](https://github.com/Falkicon)! - Add the `analyze.violations` command (CLI: `violet violations`, `GET /api/v1/analyze/violations`) to list every constraint violation across a subtree, errors first, with the node, token, rule, measured and required values, where the failing value is set, and the node's owner. `tokens.matrix` gains `onlyViolating` (`violet matrix --only-violations`, `?issues=true`) to keep only tokens with a violation.

- [#60](https://github.com/lushly-dev/violet/pull/60) [`1b59072`](https://github.com/lushly-dev/violet/commit/1b590726eb6372a910c570db7109c6cbb0a5db60) Thanks [@Falkicon](https://github.com/Falkicon)! - The local API server entry point reads `VIOLET_API_PORT` to listen on a port other than 3001.

- [#69](https://github.com/lushly-dev/violet/pull/69) [`2964478`](https://github.com/lushly-dev/violet/commit/2964478d7478100e218443679923a495603d8d78) Thanks [@Falkicon](https://github.com/Falkicon)! - Add the `changes.impact` command (CLI: `violet impact --node <id> --override token=value [--add …] [--reset token[=ancestor]] [--subtract token]`, `POST /api/v1/analyze/impact`) to preview token changes without writing them. Changes run in order through the same checks as `token.add`, `token.override`, `token.subtract` and `token.reset`, staged on a read-only `OverlayDatabase` whose writes throw. The result lists every node the change reaches (`via` inheritance, include or copy) with before → after cells and an effect (`changes`, `added`, `removed`, `shielded`, `unaffected`, `unresolved`), the constraint violations introduced and resolved, and the `violet token …` commands that apply it. The MCP server instructions mention it.

- [#22](https://github.com/lushly-dev/violet/pull/22) [`b2c681b`](https://github.com/lushly-dev/violet/commit/b2c681ba1cab2afe209faa75225f67541cca01e8) Thanks [@Falkicon](https://github.com/Falkicon)! - Add realistic demo data: `seedRealisticSystem` in core and `violet demo seed` in the CLI build a multi-product design system into an empty database. The local API server can serve a SQLite database via `VIOLET_DB_PATH`.

- [#84](https://github.com/lushly-dev/violet/pull/84) [`32d8675`](https://github.com/lushly-dev/violet/commit/32d8675c9ab0ee670a25d276ed408a5a0b4898e3) Thanks [@Falkicon](https://github.com/Falkicon)! - Add `analyze.health` (CLI: `violet health [--root id] [--baseline parent|root|<id>] [--sort drift|violations|customizations] [--no-violations]`, `GET /api/v1/analyze/health`) and `audit.list` (CLI: `violet audit [--node id] [--subtree] [--token id] [--type a,b] [--actor name] [--since 30d] [--until time] [--limit n] [--offset n]`, `GET /api/v1/audit`). `analyze.health` reports per node its own customizations by category, drift against a baseline, violations by severity, owner, status, coupling (mix-ins, borrows, borrowers) and subtree totals, and flags redundant overrides, sibling borrows and deprecated nodes with children. `audit.list` queries the audit log newest first with paging and counts per UTC day. The `Database` interface gains `queryAuditEvents`, implemented by the memory, SQLite, Postgres/Neon and overlay stores. The hosted audit route needs the new `audit:read` scope. The MCP server instructions mention both commands.

- [#64](https://github.com/lushly-dev/violet/pull/64) [`ee58bfa`](https://github.com/lushly-dev/violet/commit/ee58bfa5d22dac99ed8f7f2284d81f81a840ca02) Thanks [@Falkicon](https://github.com/Falkicon)! - Relicense under MIT and publish publicly to npm. Each package now ships a README and full npm metadata (repository, homepage, bugs, keywords, engines).

- [#22](https://github.com/lushly-dev/violet/pull/22) [`1f54ec7`](https://github.com/lushly-dev/violet/commit/1f54ec7f1ebff1f613003b129a7027c2c283119e) Thanks [@Falkicon](https://github.com/Falkicon)! - Add the `nodes.graph` command (CLI: `violet tree`). It returns the node hierarchy as a graph with parent, include and copy edges, per-node change counts, optional per-node operations, and an optional token trace. The MCP server instructions list the new command.

- [#23](https://github.com/lushly-dev/violet/pull/23) [`0ddbffb`](https://github.com/lushly-dev/violet/commit/0ddbffb8a0997a31a98f3cf56fe93f635a48db0c) Thanks [@Falkicon](https://github.com/Falkicon)! - Add the `tokens.catalog` command (CLI: `violet catalog`) to find tokens by words, category, tier or status and see where each is customized or removed. `tokens.matrix` gains a `category` filter (`violet matrix --category`), and `nodes.graph` adds per-category change counts (`changes.byCategory`) and node owners.

- [#120](https://github.com/lushly-dev/violet/pull/120) [`a283750`](https://github.com/lushly-dev/violet/commit/a283750b6942d43970e20c9fa48d0d1dba356ea0) Thanks [@Falkicon](https://github.com/Falkicon)! - Add `tokens.compare` ([#37](https://github.com/lushly-dev/violet/issues/37)): two to four nodes token by token, each cell flagged when it differs from the first node, with counts per category and a similarity per pair. `violet compare a b [c d]` now runs it (`--all`, `--category`, `--filter`); `compare.nodes` stays for existing callers. The MCP server instructions describe it. Core also exports allow-list CSS validators from `@lushly-dev/violet-core/css`: `safeCssColor`, `safeCssLength`, `safeFontFamily`, `safeShadow`, `safeDuration`, `safeEasing` and `safeCssNumber`.

- [#20](https://github.com/lushly-dev/violet/pull/20) [`f72a360`](https://github.com/lushly-dev/violet/commit/f72a360bba189e0270b8b9532f0e693583a183a9) Thanks [@Falkicon](https://github.com/Falkicon)! - Add the `tokens.matrix` command (CLI: `violet matrix`). It resolves tokens across a subtree, explicit nodes, or the whole tree and reports each token × node cell's value, how it got there, its source node, and optional constraint violations. The MCP server instructions list the new command.

- Updated dependencies [[`1ed0dbb`](https://github.com/lushly-dev/violet/commit/1ed0dbb9d54e737d5f74fe26bf631e5ff3d37c79), [`d29994f`](https://github.com/lushly-dev/violet/commit/d29994f2d94be79339e51a4b25d75afe36888135), [`6f2e253`](https://github.com/lushly-dev/violet/commit/6f2e2530688a29f20dec12ab93c4231d56cb8407), [`e8b3a4d`](https://github.com/lushly-dev/violet/commit/e8b3a4d846b7c2883e89efc94a54f5984b9033c4), [`1f4f5b5`](https://github.com/lushly-dev/violet/commit/1f4f5b5ee800f4f29f745bc5d9be392be623eb45), [`2964478`](https://github.com/lushly-dev/violet/commit/2964478d7478100e218443679923a495603d8d78), [`b2c681b`](https://github.com/lushly-dev/violet/commit/b2c681ba1cab2afe209faa75225f67541cca01e8), [`fc013ea`](https://github.com/lushly-dev/violet/commit/fc013ea33e1901e848a7d9354f424a4a3e0b731d), [`32d8675`](https://github.com/lushly-dev/violet/commit/32d8675c9ab0ee670a25d276ed408a5a0b4898e3), [`16736df`](https://github.com/lushly-dev/violet/commit/16736dffc1d555b8800499593c90e9a6475bb484), [`117c354`](https://github.com/lushly-dev/violet/commit/117c354db74e3ac07a8a6ff1135111d6e1c67db4), [`17fb650`](https://github.com/lushly-dev/violet/commit/17fb650f7042a8c6542dce198982f14a1d915ca2), [`7480f9b`](https://github.com/lushly-dev/violet/commit/7480f9bc624a720d920e8c4d8f8fc5fb2795e5dc), [`5fa2394`](https://github.com/lushly-dev/violet/commit/5fa239447142385a847d51e8d743499fda306e8c), [`ee58bfa`](https://github.com/lushly-dev/violet/commit/ee58bfa5d22dac99ed8f7f2284d81f81a840ca02), [`1f54ec7`](https://github.com/lushly-dev/violet/commit/1f54ec7f1ebff1f613003b129a7027c2c283119e), [`da3ad78`](https://github.com/lushly-dev/violet/commit/da3ad78dbdff0c784090cc128c37296f623b5a7a), [`0ddbffb`](https://github.com/lushly-dev/violet/commit/0ddbffb8a0997a31a98f3cf56fe93f635a48db0c), [`a283750`](https://github.com/lushly-dev/violet/commit/a283750b6942d43970e20c9fa48d0d1dba356ea0), [`f72a360`](https://github.com/lushly-dev/violet/commit/f72a360bba189e0270b8b9532f0e693583a183a9)]:
  - @lushly-dev/violet-core@0.2.0
