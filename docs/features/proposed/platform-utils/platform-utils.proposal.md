# Platform Utils: Cross-Platform Utilities for AFD Applications

> Proposal: Standard utilities for cross-platform subprocess, path, and environment handling

---
status: approved-with-changes
created: 2026-01-09
reviewed: 2026-01-09
origin: Cross-platform audit of lushbot showing repeated patterns
effort: M (1-3 days)
---

## Review History

| Date | Verdict | Key Changes Applied |
|------|---------|---------------------|
| 2026-01-09 | ✅ Approved | Added debug logging, token protection, JSDoc requirements, error codes |

## Problem

AFD applications (lushbot, others) repeat platform-specific patterns:

```python
# Repeated in 3+ files
IS_WINDOWS = sys.platform == "win32"
subprocess.run(cmd, shell=IS_WINDOWS, ...)
```

This violates DRY and creates maintenance burden.

## Proposed Solution

Add cross-platform utilities to `@lushly-dev/afd-core`:

### Core Utilities

```typescript
// @lushly-dev/afd-core/src/platform.ts

export const isWindows = process.platform === 'win32';
export const isMac = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';

/** Error codes for exec() failures */
export enum ExecErrorCode {
  TIMEOUT = 'TIMEOUT',
  SIGNAL = 'SIGNAL',
  EXIT_CODE = 'EXIT_CODE',
  SPAWN_FAILED = 'SPAWN_FAILED',
}

/** Options for cross-platform exec */
export interface ExecOptions {
  cwd?: string;
  timeout?: number;
  /** Enable debug logging of commands (default: false) */
  debug?: boolean;
  env?: Record<string, string>;
}

/** Result from exec() with error codes for observability */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Error code if failed, undefined if success */
  errorCode?: ExecErrorCode;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Cross-platform subprocess execution.
 * 
 * @param cmd - Command as array of strings (prevents shell injection)
 * @param options - Execution options including debug mode
 * @returns Promise resolving to ExecResult with stdout, stderr, and error codes
 * 
 * @example
 * const result = await exec(['git', 'status'], { debug: true });
 * if (result.errorCode) {
 *   console.error(`Failed: ${result.errorCode}`);
 * }
 */
export async function exec(
  cmd: string[],
  options?: ExecOptions
): Promise<ExecResult>;

/**
 * Find file walking up directory tree.
 * 
 * @remarks Uses `find-up` package internally for battle-tested implementation.
 * 
 * @param filename - File to search for
 * @param cwd - Starting directory (default: process.cwd())
 * @returns Absolute path if found, null otherwise
 */
export function findUp(filename: string, cwd?: string): string | null;

/**
 * Get platform-appropriate temp directory.
 * @returns Path to system temp directory
 */
export function getTempDir(): string;

/**
 * Normalize path separators to current platform.
 * @param path - Path with mixed separators
 * @returns Path with platform-appropriate separators
 */
export function normalizePath(path: string): string;
```

### Connector Pattern

For CLI tools that need abstraction:

```typescript
/**
 * GitHub CLI connector for issue/PR operations.
 * 
 * @remarks
 * - Uses `gh` CLI internally
 * - NEVER logs stdout (may contain tokens)
 * - All inputs are validated before shell execution
 */
export class GitHubConnector {
  /**
   * Create a GitHub issue.
   * @throws {ExecError} If gh command fails
   */
  async issueCreate(opts: IssueCreateOptions): Promise<number>;
  
  async issueList(repo: string, filters?: IssueFilters): Promise<Issue[]>;
  async prCreate(opts: PrCreateOptions): Promise<number>;
}

export class PackageManagerConnector {
  async install(pkg?: string, dev?: boolean): Promise<void>;
  async run(script: string): Promise<ExecResult>;
}
```

## Benefits

| Aspect | Current | With Utils |
|--------|---------|------------|
| Code duplication | 3+ files with same pattern | Single import |
| Testing | Mock subprocess directly | Mock connector |
| Platform bugs | Easy to miss edge cases | Centralized handling |
| Type safety | Manual | Full TypeScript types |
| Debugging | No visibility | `debug: true` logs commands |
| Error handling | Exit code only | Error codes for observability |

## Design Decisions

### findUp() Implementation

**Decision:** Use `find-up` npm package internally.

**Rationale:**
- 5M+ weekly downloads, battle-tested
- Handles edge cases (symlinks, permissions)
- Avoids reimplementing solved problem

### Debug Logging

All utilities support a `debug` option that logs commands before execution:

```typescript
await exec(['git', 'status'], { debug: true });
// Console: [exec] git status
```

This addresses the "debugging at 3 AM" concern without cluttering normal output.

## Package Location

**Decision:** Add to `@lushly-dev/afd-core`, extract later if it grows.

## Python Support (lushbot)

For Python apps, create equivalent in `lushbot`:

```python
# lushbot/connectors/base.py
class ShellConnector:
    """Cross-platform shell execution with debug logging."""
    
    @staticmethod
    def run(cmd: list[str], debug: bool = False, **kwargs) -> CompletedProcess:
        if debug:
            print(f"[exec] {' '.join(cmd)}")
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            shell=sys.platform == "win32",
            **kwargs
        )

# lushbot/connectors/github.py
class GitHubConnector(ShellConnector):
    """GitHub CLI connector. NEVER logs stdout (may contain tokens)."""
    
    def issue_create(self, title: str, body: str, ...) -> int: ...
    def issue_list(self, repo: str, ...) -> list[dict]: ...
```

## Implementation Plan

### Wave 1: TypeScript Core (Effort: S)
- [ ] **exec()** — Cross-platform subprocess with debug option
- [ ] **ExecErrorCode** — Error codes for observability
- [ ] **findUp()** — Wrap `find-up` package
- [ ] **Platform constants** — `isWindows`, `isMac`, `isLinux`
- [ ] **JSDoc** — All exports fully documented

### Wave 2: Connectors (Effort: M)
- [ ] **GitHubConnector** — Issue/PR operations (no stdout logging)
- [ ] **PackageManagerConnector** — npm/pnpm wrapper

### Wave 3: Python Port (Effort: S)
- [ ] **lushbot.connectors.shell** — Base connector with debug
- [ ] **lushbot.connectors.github** — GitHub CLI wrapper
- [ ] Migrate existing code to use connectors

## Security Considerations

### Shell Injection Prevention
- All commands use **array format** (`['git', 'status']`), never string interpolation
- Never pass unsanitized user input to shell
- Connectors validate inputs before execution

### Token/Secret Protection
> ⚠️ **Critical:** `GitHubConnector` MUST NOT log stdout.

The `gh` CLI may output tokens or sensitive URLs. Connectors must:
- Never log raw stdout/stderr from authenticated commands
- Redact URLs containing tokens before any logging
- Use `debug` mode only for command names, not outputs

### Auditability
- `debug: true` logs command **before** execution (not output)
- Failed commands include error codes for monitoring
- Duration tracking enables performance observability

## Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| DRY reduction | 3+ files → 1 import | `rg "IS_WINDOWS"` returns 0 |
| Test coverage | 90%+ on new code | `npm test -- --coverage` |
| Debug incidents | Faster resolution | Mean time to debug reduction |

---

*Status: Approved with changes. Ready for implementation.*
