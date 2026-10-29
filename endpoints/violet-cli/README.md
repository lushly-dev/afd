# @lushly-dev/violet-cli

Command-line interface for Violet Design, a hierarchical design token platform.

```bash
npm install --save-dev @lushly-dev/violet-cli
npx --no -- violet --help
```

Not on npm yet ([#42](https://github.com/lushly-dev/violet/issues/42)): until the first release, link a local build. `--no` stops npx downloading `violet`, an unrelated npm package, and `--` passes flags such as `--from` and `--json` to Violet instead of npx.

Export a node tree kept as DTCG files in your repo, with no database (one node per file, each naming its parent under `$extensions["dev.lushly.violet"]`):

```bash
npx --no -- violet --from ./tokens export css vintage-dark --selector '[data-theme="vintage-dark"]' -o dist/vintage-dark.css
npx --no -- violet --from ./tokens export ts vintage-dark -o dist/vintage-dark.ts
npx --no -- violet --from ./tokens export lua vintage-dark --prefix vintageDark --theme-map fenui-map.json
```

A node file is DTCG JSON. The node ID defaults to the file name without `.tokens.json`:

```json
{
  "$extensions": { "dev.lushly.violet": { "parent": "vintage", "type": "theme" } },
  "color": { "$type": "color", "bg": { "$value": "#1A1612" }, "fg": { "$value": "{color.ink}" } }
}
```

Settings: `node`, `parent`, `type`, `includes`, and `tiers: true` to read top-level `global` / `semantic` / `component` groups as token tiers (left out of IDs and aliases). Every `*.json` under the directory is read, and aliases resolve in the context of the exported node.

`violet cicd setup -n <node>` writes GitHub workflows that run these steps in CI: `tokens-validate.yml` on pull requests, `tokens-release.yml` on `tokens-v*` tags, and `tokens-sync.yml`, which fetches exports from a hosted Violet API instead (`--templates sync,validate,release`, `--tokens-dir`, `--output`, `--force`; `--json` lists the next steps).

`--theme-map` is a JSON object mapping FenUI semantic names to color token IDs, e.g. `{ "surfacePanel": "color.bg" }`.

Without `--from`, the CLI keeps nodes in a SQLite database (`~/.violet/violet.db`, or `--db <path>`), which needs the optional `better-sqlite3` package. `violet call <command>` runs any registered command by name, and `violet mcp start` starts the MCP server. `violet compare <a> <b> [c] [d]` puts two to four nodes side by side and prints the tokens that differ from the first, with how alike each pair is (`--all` for every token, `--category`, `--filter`).

## License

MIT
