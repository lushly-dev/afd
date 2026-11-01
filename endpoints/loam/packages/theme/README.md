# @lushly-dev/loam-theme

Loam's Violet tree, its exports, the token contract and the token-only lint.
Private and quarantined. The design is in the
[phase 0 specification](../../docs/phases/0-kernel-chrome/spec.md), sections
2.1 to 2.3 and 2.7.

## Layout

| Path | What |
| --- | --- |
| `src/tree/` | The tree, built with `@lushly-dev/violet-core` in a memory database (Node only): `loam` (product) holds the primitives under `ref.*` and every contract id with its light value; `loam/light`, `loam/dark` and `loam/high-contrast` (themes) hold overrides; `loam/<theme>/compact` (custom) holds compact density |
| `src/pairs.ts` | The color pairs and their contrast floors per theme, checked by the tests |
| `src/outputs.ts` | Renders the contract, `loam-theme.css` and `loam-theme.json` |
| `src/check.ts`, `src/cli.ts` | `theme:build` and `theme:check` |
| `contract/tokens.json` | The committed token contract: per id, its custom property, type and kind (`component` or `shell`) |
| `scripts/lint-tokens.mjs` | The token-only lint, the `loam-lint-tokens` bin |
| `fixtures/lint-tokens/` | The lint's corpus, one passing and one failing case per rule |

## Scripts

```sh
pnpm -F @lushly-dev/loam-theme build          # tsc, then the files below into dist/
pnpm -F @lushly-dev/loam-theme theme:build    # the same
pnpm -F @lushly-dev/loam-theme theme:check    # contract/tokens.json and the kernel's layout defaults against the tree
pnpm -F @lushly-dev/loam-theme theme:check --write   # regenerate contract/tokens.json after adding, removing or retyping an id
pnpm -F @lushly-dev/loam-theme test           # contrast floors, references, contract, compact targets, the lint corpus
pnpm -F @lushly-dev/loam-theme lint:tokens    # the lint over this package's sources
```

`theme:build` writes, to `dist/` (gitignored):

- `loam-theme.css`: `:root, [data-loam-theme="light"]` with every token, then
  `[data-loam-theme="dark"]` and `[data-loam-theme="high-contrast"]` with only
  what differs from light, then `[data-loam-theme="<theme>"][data-loam-density="compact"]`
  with what compact changes. Exported as `@lushly-dev/loam-theme/loam-theme.css`.
- `loam-theme.json`: `{ "contractVersion": 1, "nodes": { "<nodeId>": Token[] } }`
  with resolved `{ id, value }` tokens for every node. Exported as
  `@lushly-dev/loam-theme/loam-theme.json`.
- `contract.json`: a copy of the contract, which the lint reads.

No output contains a `ref.*` primitive.

## The lint

A package runs `loam-lint-tokens <glob>...` from its directory, after
`theme:build`. Shell tokens (`shell.*`) are allowed only when that package is
`@lushly-dev/loam-chrome`, and private aliases set from layout state are listed
in its `package.json` under `loamLintTokens.stateProperties`.
