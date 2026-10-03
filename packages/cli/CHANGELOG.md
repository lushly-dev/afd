# @lushly-dev/afd-cli

## 2.1.0

### Minor Changes

- [#308](https://github.com/lushly-dev/afd/pull/308) [`b38a9b8`](https://github.com/lushly-dev/afd/commit/b38a9b880058fa5f310005c96593e8ecab107e95) Thanks [@Falkicon](https://github.com/Falkicon)! - Commands carry `destructive`, `confirmPrompt` and `undoable` in both definitions, and every surface reports them consistently ([#275](https://github.com/lushly-dev/afd/issues/275)). The canonical field list is in `spec/command-metadata.md`.

  - `@lushly-dev/afd-core`: `CommandDefinition` gains `destructive` and `confirmPrompt`, which only the Zod definitions had. `McpToolCommandMeta` gains `undoable`.
  - `@lushly-dev/afd-server`: `defineCommand` accepts `undoable`, and `toCommandDefinition()` now keeps `destructive`, `confirmPrompt` and `undoable` instead of dropping the first two. `undoable` is reported in the tool `_meta` (and in each grouped `_meta.actions` entry) when set, like `destructive`. It is also reported by `afd-detail`, `afd-help` with `format: 'full'` and `DirectRegistry.listCommands()`. `afd-help` full also reports `destructive`. `afd-docs` documents all three.
  - `@lushly-dev/afd-cli`: `afd tools` marks tools whose `_meta` sets `destructive` or `undoable`, for example `todo-delete (destructive, undoable)`.
  - `@lushly-dev/afd-client`: `createReconnectingHandoff` falls back to core's `defaultReconnectPolicy` (3 attempts, 1000 ms) when neither the options nor the handoff's `metadata.reconnect` set `maxAttempts` or `backoffMs`. It used to fall back to 5 attempts.

### Patch Changes

- [#292](https://github.com/lushly-dev/afd/pull/292) [`e136261`](https://github.com/lushly-dev/afd/commit/e1362612f12648a0ec6ab0793075f694a0b3e422) Thanks [@Falkicon](https://github.com/Falkicon)! - `afd validate --surface` now validates the server's commands whatever its `toolStrategy`. Against the default `grouped` strategy it used to validate the grouped tools themselves, so a two-command `todo` server failed with a `naming-convention` error for the tool `todo` and reported schema-complexity and missing-category findings for `todo`, `afd-batch`, `afd-pipe`, `afd-call` and `afd-detail`. Now:

  - grouped tools are expanded into one command per `_meta.actions` entry, with that command's name, description, input schema and metadata;
  - lazy servers, which list no command tools, are enumerated with `afd-discover` and `afd-detail`; so are grouped tools that do not list their actions;
  - the tools AFD provides itself (`afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`, `afd-detail`, `afd-help`, `afd-docs`, `afd-schema`, `afd-context-*`) are skipped in every strategy.

  The output says which grouped tools were expanded and which built-in tools were skipped. If discovery fails, the listed tools are validated as before and a warning says why.

  `@lushly-dev/afd-core` exports the built-in names as `AFD_META_TOOL_NAMES`, `AFD_BOOTSTRAP_COMMAND_NAMES`, `AFD_CONTEXT_COMMAND_NAMES`, `AFD_BUILTIN_TOOL_NAMES` and `isAfdBuiltinName()`, which the server now uses for its reserved names. `McpTool['_meta']` now types a grouped tool's `actions`.

- Updated dependencies [[`7277d79`](https://github.com/lushly-dev/afd/commit/7277d79b9c5c999fb0411b1f58909a3e4d721eb3), [`b38a9b8`](https://github.com/lushly-dev/afd/commit/b38a9b880058fa5f310005c96593e8ecab107e95), [`7e56bd0`](https://github.com/lushly-dev/afd/commit/7e56bd09a8ee50ec4e1a72f5a8d337eddb4d9b98), [`e136261`](https://github.com/lushly-dev/afd/commit/e1362612f12648a0ec6ab0793075f694a0b3e422)]:
  - @lushly-dev/afd-core@2.1.0
  - @lushly-dev/afd-client@2.1.0
  - @lushly-dev/afd-testing@2.1.0

## 2.0.0

### Minor Changes

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - Harden CLI output and credentials, and fix the shell, scenario runner and tool listing.

  - **Security:** text output no longer passes server escape sequences to the terminal. Error messages, suggestions, warnings, reasoning, sources, data strings, tool names and descriptions, stream data, validation and scenario output go through a new `sanitizeForTerminal()`, which strips C0/C1 control characters and ESC sequences (OSC title/hyperlink/clipboard, CSI cursor movement, DCS/APC strings) but keeps newlines and tabs. JSON output is unchanged.
  - **Security:** the config file is written with mode `0600` (an older, wider file is narrowed on the next run). Printed URLs have their userinfo and token-like query parameters (`token`, `key`, `secret`, `auth`, `password`, ...) replaced with `***`, and `afd connect` warns when it saves a URL that carries credentials.
  - **New:** `-H, --header "Name: value"` (repeatable) on `connect`, `status`, `tools`, `call`, `batch`, `stream`, `validate`, `shell` and `scenario run`, plus the `AFD_HEADERS` environment variable (one header per line). Headers are sent on every request, including SSE and `/stream`, and are never saved. A failed connection now names the (redacted) URL and the reason, and suggests `--header`/`AFD_HEADERS`.
  - **New:** `afd scenario run --no-stop-on-failure` runs every scenario; stopping at the first failure stays the default and now also stops on a `partial` scenario. Step progress is attributed to the running scenario instead of the first one that uses the same command name, and scenario files run in sorted path order.
  - **New:** `afd shell --transport`, `--timeout` and `--no-reconnect`. The shell uses the saved transport and timeout (it used the client defaults), infers SSE/HTTP from a `--url`/`connect <url> [sse|http]`, and saves the URL together with its transport, timeout and reconnect choice. `afd connect --no-reconnect` is saved for the shell instead of being ignored.
  - **Behaviour change:** tool arguments (`call`, `stream`, shell) are parsed by one shared parser. The shell splits off only the command name, so whitespace inside JSON strings survives; `key="quoted value"` and `key=["json", "array"]` keep their spaces; and a word without `=` is now an error instead of being dropped silently.
  - **Behaviour change:** shell shorthand (`todo-create {...}`) works for kebab-case names that are in the tool list or look like AFD command names, not only dotted names. `exit` closes the input, lets queued commands finish and disconnects, instead of calling `process.exit`; lines after `exit` are ignored.
  - **Behaviour change:** `afd tools` groups by `_meta.category`, falling back to the kebab-case prefix before the first `-`, and shows full tool names. `--category` matches the same grouping.
  - `--transport` values are validated (`sse`, `http`). The CLI e2e tests rebuild `dist` in a Vitest global setup when it is older than `src`, and fail with a clear message if a workspace package they run on is stale.

### Patch Changes

- [#232](https://github.com/lushly-dev/afd/pull/232) [`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1) Thanks [@Falkicon](https://github.com/Falkicon)! - Make `afd validate` safe by default and stop CLI commands hanging over SSE.

  - **Behaviour change:** `afd validate` no longer executes tools. By default it checks only the `tools/list` entries: names, descriptions, input schemas, and `_meta.examples`. Pass `--execute` to call tools as before. Even then, tools marked `_meta.mutation: true` or `_meta.destructive: true` are skipped and reported per tool. Each call uses `_meta.examples[0].input` when the server provides one, otherwise `{}`.
  - `connect`, `call`, `status`, `tools`, `batch`, `stream` and `validate` now exit after printing their result over SSE. The CLI disconnects its client when a command finishes, and one-shot commands no longer auto-reconnect. `shell` finishes queued input before it disconnects.
  - `--category` on `validate` and `tools` (and `tools <category>` in `shell`) now matches `_meta.category`. Tools without a category match on the kebab-case `<category>-` name prefix instead of `<category>.`.
  - Confidence and progress bars no longer throw `RangeError` for values outside 0–1.

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - `afd scenario init` writes a sample that the stricter scenario parser accepts: `todo-toggle` instead of the nonexistent `todo-complete`, a numeric `gte` check on `total`, and no unsupported `verify` block.

- Updated dependencies [[`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`77a829c`](https://github.com/lushly-dev/afd/commit/77a829c531edf4ba352bd570da8ea12bed0cb92b), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`d091ef3`](https://github.com/lushly-dev/afd/commit/d091ef386cbbf141022b805f5382e47fcf94c95c), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`77a829c`](https://github.com/lushly-dev/afd/commit/77a829c531edf4ba352bd570da8ea12bed0cb92b), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f943a5c`](https://github.com/lushly-dev/afd/commit/f943a5c55edfe16cc5b5e66ef1ec4948cd8cbdcc), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f8a9d85`](https://github.com/lushly-dev/afd/commit/f8a9d851531bf2c2edea7284f031c68d7b22a455), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1)]:
  - @lushly-dev/afd-core@2.0.0
  - @lushly-dev/afd-client@2.0.0
  - @lushly-dev/afd-testing@2.0.0

## 1.0.0

### Patch Changes

- Updated dependencies []:
  - @lushly-dev/afd-client@1.0.0
  - @lushly-dev/afd-core@1.0.0
  - @lushly-dev/afd-testing@1.0.0

## 1.0.0

### Minor Changes

- ### Breaking Changes

  - **Node.js 22+ required** — dropped Node 20 support, CI tests on 22.x and 24.x
  - **Zod 4** — upgraded from Zod 3. `zod-to-json-schema` replaced with built-in `z.toJSONSchema()`. `ZodEffects` replaced by `ZodPipe` for transforms. Schema introspection uses `.unwrap()`/`.removeDefault()` instead of `._def.innerType`.
  - **eventsource 4** — named import (`{ EventSource }` instead of default), custom `fetch` option for headers instead of `EventSourceInitDict`. `@types/eventsource` removed (types now bundled).

  ### Other Updates

  - TypeScript target bumped to ES2024
  - All dependencies updated to latest: commander 14, conf 15, glob 13, ora 9, jsdom 28, dotenv 17, vite 8, commitlint 20
  - Replaced custom `scripts/release.mjs` with `@changesets/cli` for versioning and changelogs
  - Removed redundant eslint from React example (biome covers React hooks rules)
  - Refactored `direct.ts` — extracted `unknown-tool.ts` and `direct-validation.ts`
  - Refactored `executor.ts` — extracted `validator.ts`
  - CI now runs `pnpm check` (lefthook quality gate) to prevent local/CI desync

### Patch Changes

- Updated dependencies []:
  - @lushly-dev/afd-core@1.0.0
  - @lushly-dev/afd-client@1.0.0
  - @lushly-dev/afd-testing@1.0.0
