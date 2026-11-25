# @lushly-dev/loam-theme

Loam's Violet tree, its exports, the token contract and the token-only lint.
Private and quarantined. The design is in the
[phase 0 specification](../../docs/phases/0-kernel-chrome/spec.md), sections
2.1 to 2.4 and 2.7.

## Layout

| Path | What |
| --- | --- |
| `tree/` | The DTCG token files (one per node, carrying `$type` and non-derivable Violet categories under `$extensions["dev.lushly.violet"].category`): `loam.tokens.json` (`loam`, product) holds the primitives under `global.ref.*` and every contract id with its light value; `loam_light.tokens.json`, `loam_dark.tokens.json` and `loam_high-contrast.tokens.json` (themes) hold overrides; `loam_<theme>_compact.tokens.json` (custom) holds compact density |
| `src/tree/` | Loads `tree/*.tokens.json` into a Violet memory database via `@lushly-dev/violet-afd`'s `import.tree` (Node only, at build time). Exports `TREE_DIR`, `readLoamTreeFiles()` and `buildLoamTree()` in place of the retired TypeScript token arrays (`PRIMITIVES`, `COMPONENT_TOKENS`, `SHELL_TOKENS`, `DARK_OVERRIDES`, `HIGH_CONTRAST_OVERRIDES`, `COMPACT_OVERRIDES`, `ref`, `TreeToken`, `TreeValue`) |
| `src/pairs.ts` | The color pairs and their contrast floors per theme, checked by the tests |
| `src/outputs.ts` | Renders the contract, `loam-theme.css` and `loam-theme.json` |
| `src/components.ts` | The shared components' token export and the fallback scan (2.4) |
| `src/check.ts`, `scripts/theme.mjs` | `theme:check`, and the script behind `theme:build`, `theme:check` and `theme:export-components`, which reads the kernel's `LAYOUT_DEFAULTS_V0` (a development dependency) |
| `contract/tokens.json` | The committed token contract, version 3 (123 ids: 104 component, 19 shell): per id, its custom property, type and kind (`component` or `shell`). Every property, `shell.*` included, is violet-runtime's `tokenCustomProperty(id, 'violet')`: `--violet-` and the id with `.` replaced by `-` (`--violet-color-surface-page`, `--violet-shell-size-rail`), the names `violet-elements`' interface (version 5) and Violet's CSS exporter with `prefix: 'violet'` use. Version 1 had the pre-prefix ids unprefixed; version 2 added `--violet-`; version 3 (Scales #1111, #2197) retired 16 positional ladder ids, added `space.inline.hairline` and renamed 25 semantic ids to purpose names |
| `scripts/lint-tokens.mjs` | The token-only lint, the `loam-lint-tokens` bin |
| `fixtures/lint-tokens/` | The lint's corpus, one passing and one failing case per rule |

## Scripts

```sh
pnpm -F @lushly-dev/loam-theme build          # tsc, then the files below into dist/
pnpm -F @lushly-dev/loam-theme theme:build    # the same
pnpm -F @lushly-dev/loam-theme theme:check    # contract/tokens.json, the kernel's layout defaults, violet-elements' token interface, the component export and the fallbacks against the tree
pnpm -F @lushly-dev/loam-theme theme:check --write   # regenerate contract/tokens.json after adding, removing or retyping an id
pnpm -F @lushly-dev/loam-theme theme:export-components              # write violet-elements' tokens/violet-theme.export.json
pnpm -F @lushly-dev/loam-theme theme:export-components --fallbacks  # also rewrite the fallbacks in violet-elements/src that differ from light
pnpm -F @lushly-dev/loam-theme test           # contrast floors, references, contract, compact targets, the lint corpus
pnpm -F @lushly-dev/loam-theme lint:tokens    # the lint over this package's sources
```

`theme:build` writes, to `dist/` (gitignored):

- `loam-theme.css`: `:root, [data-loam-theme="light"]` with every token, then
  `[data-loam-theme="dark"]` and `[data-loam-theme="high-contrast"]` with only
  what differs from light, then `[data-loam-theme="<theme>"][data-loam-density="compact"]`
  with what compact changes. Exported as `@lushly-dev/loam-theme/loam-theme.css`.
- `loam-theme.json`: `{ "contractVersion": 3, "nodes": { "<nodeId>": Token[] } }`
  with resolved `{ id, value }` tokens for every node. Exported as
  `@lushly-dev/loam-theme/loam-theme.json`.
  A `VioletRuntime` that applies these nodes passes `cssPrefix: VIOLET_CSS_PREFIX`
  (`@lushly-dev/violet-runtime`), so it writes the contract's `--violet-*` names.
- `contract.json`: a copy of the contract, which the lint reads.

No output contains a `ref.*` primitive.

## The shared components (2.4, D50)

`violet-elements` may not depend on Violet, so it takes Loam's themes as data,
and copies violet-runtime's naming rule into its generated sources rather than
importing it.
It owns the list of custom properties its components read,
`foundations/fast-af/packages/violet-elements/tokens/interface.json`; Loam's tree
supplies a value for each, and `theme:check` fails when the contract lacks an
interface id as a `component` id with the same property and type. To add one:
write its value in `tree/loam.tokens.json`, run `theme:check --write` and
`theme:export-components`, then `violet-elements`' `theme:build`. Loam's other
shared ids (the type ramp, for example) are exported too.

`theme:export-components` writes
`foundations/fast-af/packages/violet-elements/tokens/violet-theme.export.json`,
`{ "contractVersion": 2, "source": "loam", "presets": { "light", "dark", "high-contrast" } }`
(its own format version, `COMPONENT_EXPORT_VERSION`, which lists ids, not properties),
each preset the theme's component ids (no `shell.*`) as resolved `{ id, value }`
tokens at comfortable density. That package's `theme:build` generates its runtime
presets from the file.

`theme:check` also fails when the committed export differs from the tree, or when a
literal fallback `var(--<component id>, <literal>)` in `violet-elements/src`
differs from the light value after normalization (lowercase hex, trimmed and
collapsed whitespace). After changing a value:

1. `pnpm -F @lushly-dev/loam-theme theme:export-components --fallbacks`;
2. `pnpm -F @lushly-dev/violet-elements theme:build` and `cem:analyze`, since the
   manifest records the style defaults;
3. record every edited file under `foundations/fast-af` with
   `node scripts/release/provenance.mjs fast-af "<reason>"`, which writes its row
   in `foundations/fast-af/provenance/adaptations.json`. FAST-AF's
   `provenance.json` holds no hash of `adaptations.json`, and its test refuses one.

## The lint

A package runs `loam-lint-tokens <glob>...` from its directory, after
`theme:build`. Shell tokens (`shell.*`) are allowed only when that package is
`@lushly-dev/loam-chrome`, and private aliases set from layout state are listed
in its `package.json` under `loamLintTokens.stateProperties`.
