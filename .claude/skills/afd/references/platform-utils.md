# Platform utilities and connectors

Node-only helpers in `@lushly-dev/afd-core`, on subpaths. The main barrel does not re-export them,
so they never pull Node builtins into a browser bundle:

```typescript
import { exec, findUp, getTempDir, isWindows, normalizePath } from '@lushly-dev/afd-core/platform';
import { GitHubConnector, PackageManagerConnector } from '@lushly-dev/afd-core/connectors';
```

Source: `packages/core/src/platform.ts` and `packages/core/src/connectors/`.

## exec()

```typescript
const result = await exec(['git', 'status'], { cwd, timeout: 10_000, debug: true });
if (isExecError(result)) console.error(result.errorCode, result.exitCode, result.stderr);
```

- The command is an array, never a string: `exec()` never uses `shell: true`. On Windows,
  `.cmd`/`.bat` commands such as `npm` run through cmd.exe with every argument escaped
  (`prepareSpawn`).
- `ExecOptions`: `cwd`, `timeout` (ms), `debug` (logs the command, not its output), `env` (merged
  with `process.env`), `maxOutputBytes` (per stream, default 10 MiB).
- `ExecResult`: `stdout` and `stderr` (trimmed), `exitCode`, `durationMs` and `errorCode` when it
  failed: `TIMEOUT`, `SIGNAL`, `EXIT_CODE`, `SPAWN_FAILED` or `OUTPUT_LIMIT_EXCEEDED` (the process
  was killed and the output kept up to the limit).
- `exec()` resolves on every failure rather than rejecting, so check `errorCode` (or
  `isExecError(result)`).

## Other helpers

- `findUp(filename, cwd?)` walks up from `cwd` (default `process.cwd()`) and returns the path or
  `null`.
- `normalizePath(path)` converts both separators to the platform's; `getTempDir()` is the system
  temp directory; `isWindows`, `isMac` and `isLinux` are constants.

## Connectors

```typescript
const gh = new GitHubConnector({ debug: true });
const issue = await gh.issueCreate({ title: 'Bug report', body: '...', repo: 'org/repo', labels: ['bug'] });
const open = await gh.issueList('org/repo', { state: 'open', limit: 10 });
// also prCreate(options) and prList(repo, filters)

const pm = new PackageManagerConnector('pnpm');
await pm.install('vitest', true); // pnpm install vitest --save-dev
await pm.run('test');             // also add(pkg, dev?) and remove(pkg)
```

- `GitHubConnector` wraps the `gh` CLI. It never logs stdout, which can hold tokens; `debug` logs
  command names only. Values are passed as `--name=value`, so a title such as `--web` cannot be read
  as a flag.
- `PackageManagerConnector` validates package and script names before running anything. An invalid
  name returns an `ExecResult` with `errorCode: SPAWN_FAILED` and the reason in `stderr`.
