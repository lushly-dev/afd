# Specimen MCP server

A local stdio MCP endpoint over the 32 AFD commands in `@lushly-dev/specimen-afd`.
It advertises each MCP-exposed command's JSON input schema and AFD mutation/destructive
annotations, validates through the CLI's execution path, and returns its complete
`CommandResult` as JSON text, with `isError` set when `success` is false.
Because the server keeps one browser bench warm across calls, agents should prefer it
over the one-shot CLI for interactive pointing, staleness checks, and note checks (`specimen-point`,
`specimen-point-move`, `specimen-point-check`, `specimen-note-add`, `specimen-note-check`,
`specimen-note-move`).

This package is private and quarantined, with no release route. Build and run it
from this checkout on Node 26:

```sh
pnpm install --frozen-lockfile
pnpm -F @lushly-dev/specimen-server... build
node endpoints/specimen-server/dist/bin.js --root /absolute/project
```

For a desktop stdio mount, use an absolute Node executable and built entry point:

```json
{
  "command": "/absolute/path/to/node",
  "args": [
    "/absolute/afd/endpoints/specimen-server/dist/bin.js",
    "--root", "/absolute/project",
    "--config", "specimen.config.json"
  ]
}
```

`--root` defaults to the working directory. `--config` is optional and resolves
relative to that root, as in the CLI. Use paths appropriate to the desktop's OS.
Stdout carries only MCP messages; diagnostics go to stderr. The bench closes on
stdin EOF or a termination signal.

Use trusted local projects: render, run, inspect and other bench operations can
launch Chromium and execute project code. Writes retain the shared command
metadata, including baseline, migration, static build and pack operations. No new
command policy or browser permission layer is introduced by this transport.
Listing native specimens needs neither Chromium nor a native host. Rendering and
retained-story discovery need the same host/browser setup as the CLI; see the
[Specimen README](../../foundations/specimen/README.md#install).

Loam phase 6 can mount this process over stdio (D106); this change does not configure
Loam or publish an npm binary. The SDK integration tests list all tools, compare
their schemas and annotations with the shared definitions, and call `specimen-list`
over stdio against the real CLI's result.
