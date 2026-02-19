# Platform Utils

Cross-platform utilities in `@lushly-dev/afd-core` for subprocess execution, path handling, and CLI tool abstraction.

## Core API

### Platform Constants

```typescript
import { isWindows, isMac, isLinux } from '@lushly-dev/afd-core';
```

### exec()

Cross-platform subprocess execution. Uses array format to prevent shell injection.

```typescript
import { exec, ExecErrorCode } from '@lushly-dev/afd-core';
import type { ExecOptions, ExecResult } from '@lushly-dev/afd-core';

const result = await exec(['git', 'status'], { debug: true });
// Console: [exec] git status

if (result.errorCode) {
  console.error(`Failed: ${result.errorCode}, exit: ${result.exitCode}`);
}
```

**ExecResult**:

```typescript
interface ExecResult {
  stdout: string;       // Trimmed
  stderr: string;       // Trimmed
  exitCode: number;
  errorCode?: ExecErrorCode;  // TIMEOUT | SIGNAL | EXIT_CODE | SPAWN_FAILED
  durationMs: number;
}
```

**ExecOptions**:

```typescript
interface ExecOptions {
  cwd?: string;
  timeout?: number;           // Milliseconds
  debug?: boolean;            // Log command before execution (default: false)
  env?: Record<string, string>;  // Merged with process.env
}
```

**Helpers**:

```typescript
// Factory function
createExecResult(stdout, stderr, exitCode, durationMs, errorCode?)

// Type guard
isExecError(result)  // true if errorCode is set
```

### findUp()

Find file walking up directory tree. Wraps `find-up` package.

```typescript
import { findUp } from '@lushly-dev/afd-core';

const pkgPath = findUp('package.json');
// → '/path/to/project/package.json' or null
```

### Path & Temp

```typescript
import { normalizePath, getTempDir } from '@lushly-dev/afd-core';

normalizePath('foo\\bar/baz');  // Platform-appropriate separators
getTempDir();                    // System temp directory
```

## Connectors

Typed wrappers around CLI tools. Follow a common pattern: array-based commands, debug logging, no stdout leaking for auth tools.

### GitHubConnector

```typescript
import { GitHubConnector } from '@lushly-dev/afd-core';

const gh = new GitHubConnector({ debug: true });

// Create issue
const issueNum = await gh.issueCreate({
  title: 'Bug report',
  body: 'Description...',
  repo: 'org/repo',
  labels: ['bug'],
});

// List issues
const issues = await gh.issueList('org/repo', {
  state: 'open',
  label: 'bug',
  limit: 10,
});
```

**Security**: GitHubConnector NEVER logs stdout (may contain tokens). Debug mode only logs command names.

### PackageManagerConnector

```typescript
import { PackageManagerConnector } from '@lushly-dev/afd-core';

const pm = new PackageManagerConnector('pnpm', { debug: true });

await pm.install('zod', true);       // pnpm install zod --save-dev
const result = await pm.run('test');  // pnpm run test
```

## Security Rules

1. **Array format only** — Commands use `['git', 'status']`, never string interpolation
2. **No stdout logging for auth tools** — GitHubConnector never logs output
3. **Debug = command names only** — `debug: true` logs what runs, not what it outputs
4. **Input validation** — Connectors validate before execution

## Internals

- `exec()` uses `child_process.spawn` with `shell: isWindows` for Windows compat
- Timeout handling kills process and returns `TIMEOUT` error code
- Signal kills return `SIGNAL` error code
- Non-zero exit returns `EXIT_CODE`
