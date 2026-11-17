# @lushly-dev/violet-cli

Command-line interface for Violet Design, a hierarchical design token platform.

```bash
npm install --save-dev @lushly-dev/violet-cli@preview
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

`violet cicd setup -n <node>` writes GitHub workflows that run these steps in CI: `tokens-validate.yml` on pull requests, `tokens-release.yml` on `tokens-v*` tags, and `tokens-sync.yml`, which fetches exports from a hosted Violet API instead (`--templates sync,validate,release,snapshot`, `--tokens-dir`, `--output`, `--force`; `--json` lists the next steps).

`--theme-map` is a JSON object mapping FenUI semantic names to color token IDs, e.g. `{ "surfacePanel": "color.bg" }`.

Without `--from`, the CLI keeps nodes in a SQLite database (`~/.violet/violet.db`, or `--db <path>`), which needs the optional `better-sqlite3` package. `violet call <command>` runs any registered command by name, and `violet mcp start` starts the MCP server. `violet compare <a> <b> [c] [d]` puts two to four nodes side by side and prints the tokens that differ from the first, with how alike each pair is (`--all` for every token, `--category`, `--filter`). It runs `tokens.compare`; the older two-node `compare.nodes` is deprecated and will be removed in `@lushly-dev/violet-afd` 0.5.0.

## Daily rule-check snapshots

Generate the opt-in schedule for a node and its descendants:

```bash
violet cicd setup --templates snapshot --node global-base
```

This writes `.github/workflows/tokens-snapshot.yml`. It runs `violet --db "$VIOLET_DB_PATH" --json snapshot --root global-base` daily at **03:17 UTC**, and supports **Run workflow** in GitHub Actions. The default `cicd setup` templates remain `sync,validate`.

1. Provision a dedicated **Linux self-hosted runner** with the `violet` label and Node 24 or later. Install the CLI version containing this template and its optional `better-sqlite3` driver in a stable location; put `violet` on the runner service's `PATH`. For a workspace build, install dependencies and build `@lushly-dev/violet-cli` and its dependencies, then expose `endpoints/violet-cli/dist/bin.js` as `violet`. Run `violet --version` as the service user to confirm it is reachable.
2. Use the existing live SQLite database containing the nodes to check. Set the repository variable **VIOLET_DB_PATH** (Settings → Secrets and variables → Actions → Variables) to its absolute path on that runner, for example `/srv/violet/violet.db`. Keep the database outside the runner workspace, on durable storage, readable and writable by the runner service user. The job refuses a relative path or a missing file instead of creating an empty database. It checks the live database on each run; it does not import token files from Git.
3. Commit the workflow to the repository's default branch and enable Actions. The job uses no checkout, download, API key or repository permissions. It serializes snapshot jobs with the `violet-snapshot` concurrency group. Use a trusted repository and a dedicated runner with access to this database.
4. In Actions, open **Snapshot Design Token Rules → Run workflow**. Check the **Record rule-check snapshot** log for `success: true`, the expected `data.snapshot.rootId`, and its `takenAt` timestamp. A rule violation is recorded as history; it does not itself fail the job. A missing node or failed command does fail it.
5. On that runner, check the same database and subtree:

   ```bash
   violet --db /srv/violet/violet.db --json trends --root global-base --since 7d
   ```

   `data.summary.history.days` counts days with recorded checks, `first` and `last` give their timestamps, and each day's `recorded` field contains its check counts. Check Actions again after the next scheduled run. GitHub may delay scheduled jobs; they run from the default branch and public repositories can have schedules disabled after inactivity. A green manual run verifies setup; a scheduled run with a new `takenAt` verifies automation.

### File-driven persistence

`violet --from <dir> snapshot` and `violet --from <dir> call analyze.snapshot` fail with `SNAPSHOT_REQUIRES_PERSISTENT_DATABASE`, including when `--db` is also supplied: `--from` takes precedence and creates a disposable in-memory database. File-driven snapshot recording is unsupported. Explicit `--memory` remains for testing and is not durable.

To seed a persistent database from files, build the `import.tree` input with one `{ name, content }` entry per DTCG file (`content` is the file's JSON text), then call it **without `--from`**. For example, in a fresh database:

```bash
violet --db /srv/violet/violet.db call import.tree -i '{"files":[{"name":"global-base.tokens.json","content":"{\"color\":{\"bg\":{\"$type\":\"color\",\"$value\":\"#FFFFFF\"}}}"}]}'
violet --db /srv/violet/violet.db snapshot --root global-base
```

The database becomes the source for scheduled checks. Keep it current through normal Violet commands; changing the original files alone does not update it. `import.tree` creates nodes and is not a recurring sync operation.

### Retention decision (#497)

SQLite and Postgres snapshots are retained **indefinitely**; the memory store also has no pruning, but lasts only as long as its database instance. Automatic pruning is intentionally omitted: these records preserve historical checks, including issues fixed since, and there is no established retention duration or archive/restore interface. Silent deletion would remove evidence from `trends`. Query limits and date ranges restrict reads; they do not delete stored snapshots.

At daily cadence, each scheduled subtree adds about 365 snapshots per year, with size depending on its issue count. Monitor database and backup sizes and keep database-consistent backups (for SQLite, use its backup API or stop writers and checkpoint before copying). Storage is unbounded under this policy; deployments needing a limit should agree on retention and archival requirements before adding deletion.

## License

MIT
