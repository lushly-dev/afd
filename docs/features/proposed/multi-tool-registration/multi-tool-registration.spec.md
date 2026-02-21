# Multi-Tool Registration Specification

> Automatically detect installed AI tools and write MCP server configuration files.

## Summary

Add an `afd register` command to the CLI that detects installed AI tools (VS Code, Claude Code, Claude Desktop, Cursor, Windsurf) and writes the correct MCP server configuration for each. The command is idempotent, transport-aware, and respects existing user config.

## User Value

- **Zero-friction setup** — One command replaces per-tool manual JSON editing
- **Format-aware** — Each tool has a distinct config schema; `afd register` writes the right one
- **Idempotent** — Safe to re-run after config changes or version bumps
- **Transport-correct** — Defaults to stdio for IDE tools, HTTP for web-based tools
- **Auth-ready** — Handles environment variables, bearer tokens, and secret prompts per tool

## User Stories

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-1 | Developer | Run `afd register` and have all my AI tools configured | I don't manually edit JSON config in 3+ locations |
| US-2 | Developer | Register only a specific tool | I can target just Cursor or just VS Code |
| US-3 | Developer | See what would change before writing | I can review config before applying it |
| US-4 | Developer | Re-run register after updating my server | Updated config is written without losing other entries |
| US-5 | Team lead | Commit a `.afd/register.json` manifest | My team gets correct MCP config without guessing |
| US-6 | Developer | Pass env vars or auth tokens at registration time | My server can authenticate without hardcoded secrets |
| US-7 | Developer | Remove my server's config from all tools | Stale entries don't cause errors after I remove a server |
| US-8 | Developer | Limit registration to specific AI tools via the manifest | I only target the tools my team actually uses |

---

## Functional Requirements

### FR-1: Tool Detection

The CLI must detect which AI tools are installed on the current machine.

```typescript
interface DetectedTool {
  /** Tool identifier */
  id: ToolId;

  /** Human-readable name */
  name: string;

  /** Path to the tool's MCP config file */
  configPath: string;

  /** Whether the config file already exists */
  configExists: boolean;

  /** Whether an AFD entry already exists in the config */
  afdEntryExists: boolean;

  /** Preferred transport for this tool */
  defaultTransport: 'stdio' | 'http';

  /** Whether this is a workspace-scoped or global config */
  scope: 'workspace' | 'global';

  /** How confident we are the tool is actually installed */
  detectionConfidence: 'high' | 'medium' | 'low';
}

type ToolId =
  | 'vscode'
  | 'claude-code'
  | 'claude-desktop'
  | 'cursor'
  | 'windsurf';
```

**Detection strategies:**

Each tool uses a layered detection approach. Methods are tried in order; the first match determines `detectionConfidence`.

| Tool | Scope | High Confidence | Medium Confidence | Low Confidence |
|------|-------|----------------|-------------------|----------------|
| VS Code | workspace | `code` on PATH | Registry key (Windows) / `mdfind` (macOS) | `.vscode/` dir exists in workspace |
| Claude Code | workspace | `.claude/` dir with existing config | `.mcp.json` exists in project | — |
| Claude Desktop | global | Config file exists at known path | App binary found in known install dirs | — |
| Cursor | workspace | `cursor` on PATH | Registry key (Windows) / `mdfind` (macOS) | `.cursor/` dir exists in workspace |
| Windsurf | workspace | `windsurf` on PATH | Registry key (Windows) / `mdfind` (macOS) | `.windsurf/` dir exists in workspace |

> **Important:** A directory like `.cursor/` existing in the workspace only proves the tool was *used once*, not that it's currently installed. Low-confidence detections are shown to the user but not auto-configured without `--force`. Medium and high-confidence detections are auto-configured by default.

**Config paths:**

| Tool | Scope | Config Path (Windows) | Config Path (macOS/Linux) |
|------|-------|----------------------|--------------------------|
| VS Code | workspace | `.vscode/mcp.json` | `.vscode/mcp.json` |
| VS Code | global | `%APPDATA%\Code\User\settings.json` | `~/.config/Code/User/settings.json` |
| Claude Code | workspace | `.mcp.json` (preferred) or `.claude/mcp.json` | `.mcp.json` (preferred) or `.claude/mcp.json` |
| Claude Desktop | global | `%APPDATA%\Claude\claude_desktop_config.json` | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | workspace | `.cursor/mcp.json` | `.cursor/mcp.json` |
| Windsurf | workspace | `.windsurf/mcp.json` | `.windsurf/mcp.json` |

Config paths can be overridden via `--config-path <path>` for non-standard installations (e.g., portable VS Code via `VSCODE_PORTABLE`, Flatpak/Snap on Linux).

**Claude Code config path resolution:** When reading, check `.mcp.json` first, then `.claude/mcp.json`. When writing, prefer `.mcp.json` at project root unless `.claude/mcp.json` already contains MCP entries and `.mcp.json` does not exist — in that case, write to `.claude/mcp.json` to respect the user's existing layout.

**Distinction: "not installed" vs "no config yet":**

- **Not installed**: Detection methods all fail. Tool is reported as `✗ not installed` and skipped.
- **No config yet**: Tool is installed (detection succeeded) but the config file doesn't exist. The file is created with the AFD entry as its first content.

### FR-2: Server Manifest

A `.afd/register.json` manifest defines what should be registered. Auto-generated on first run from the current project, or manually authored for team sharing.

```typescript
interface RegisterManifest {
  /** Manifest schema version (for future migration support) */
  version: 1;

  /** Server name (from McpServerOptions.name or package.json) */
  name: string;

  /** Server description */
  description?: string;

  /** How to start the server via stdio */
  stdio?: StdioConfig;

  /** How to connect via HTTP/SSE (for already-running servers) */
  http?: HttpConfig;

  /** Environment variables the server needs */
  env?: Record<string, EnvVarConfig>;

  /** Restrict which AI tools to target (default: all detected) */
  targetTools?: TargetToolsConfig;
}

interface StdioConfig {
  /** Command to run */
  command: string;

  /** Arguments to pass */
  args?: string[];

  /** Working directory (default: project root) */
  cwd?: string;
}

interface HttpConfig {
  /** Server URL (SSE or Streamable HTTP endpoint) */
  url: string;
}

interface EnvVarConfig {
  /** Description shown to user when prompting */
  description: string;

  /** Whether this is a secret (masks input) */
  secret?: boolean;

  /** Default value if not set */
  default?: string;

  /** Required for server to function */
  required?: boolean;
}

interface TargetToolsConfig {
  /** Only register for these AI tools (whitelist). Values are ToolId strings. Mutually exclusive with `exclude`. */
  include?: ToolId[];

  /** Skip these AI tools during registration. Mutually exclusive with `include`. */
  exclude?: ToolId[];
}
```

> **Validation rule:** `include` and `exclude` are mutually exclusive. If both are specified, reject with `MANIFEST_INVALID` and suggest using only one.

**Manifest validation:** The manifest MUST be validated at load time using a Zod schema (consistent with AFD's schema-first convention). Invalid manifests produce a `MANIFEST_INVALID` error with field-level details and a `suggestion` for each violation.

**Version migration:** When a future `version: 2` manifest is encountered by a CLI that only supports `version: 1`, return `MANIFEST_VERSION_UNSUPPORTED` with a suggestion to update the `afd` CLI. The CLI should never silently downgrade or ignore unknown fields.

**Example `.afd/register.json`:**
```json
{
  "version": 1,
  "name": "my-afd-server",
  "description": "Product domain commands",
  "stdio": {
    "command": "node",
    "args": ["dist/server.js"],
    "cwd": "."
  },
  "http": {
    "url": "http://localhost:3100/sse"
  },
  "env": {
    "DATABASE_URL": {
      "description": "PostgreSQL connection string",
      "secret": true,
      "required": true
    },
    "LOG_LEVEL": {
      "description": "Logging verbosity",
      "default": "info"
    }
  }
}
```

### FR-3: Config Writing

Each tool requires a different JSON structure. The writer must produce the correct format.

```typescript
interface ConfigWriter {
  /** Tool this writer targets */
  toolId: ToolId;

  /** Read existing config from disk. Uses JSONC parser for comment support. */
  read(configPath: string): Promise<ToolConfig | null>;

  /** Merge AFD server entry into existing config */
  merge(existing: ToolConfig | null, manifest: RegisterManifest, options: WriteOptions): ToolConfig;

  /** Write config to disk. All path separators MUST use forward slashes, even on Windows. */
  write(configPath: string, config: ToolConfig): Promise<void>;

  /** Remove the AFD server entry from existing config. Returns null if config is now empty. */
  remove(existing: ToolConfig, entryName: string): ToolConfig | null;
}

interface WriteOptions {
  /** Transport to use for this tool */
  transport: 'stdio' | 'http';

  /** Whether this is a workspace or global config */
  scope: 'workspace' | 'global';

  /** Server entry name/key in the config (default: manifest.name) */
  entryName?: string;

  /** Whether to overwrite an existing entry for this server */
  overwrite?: boolean;
}
```

**Output format per tool:**

| Tool | Default Scope | Root Key | Type Field | Stdio Shape | HTTP Shape |
|------|--------------|----------|------------|-------------|------------|
| VS Code | workspace | `"servers"` | Required (`"stdio"` / `"http"`) | `{ type, command, args, cwd?, env? }` | `{ type: "http", url }` |
| Claude Code | workspace | `"mcpServers"` | Optional (inferred) | `{ command, args, cwd?, disabled?, disabledTools? }` | `{ type: "http", url }` |
| Claude Desktop | global | `"mcpServers"` | Optional (inferred) | `{ command, args, cwd? }` | `{ url }` |
| Cursor | workspace | `"mcpServers"` | Optional (inferred) | `{ command, args, cwd? }` | `{ url }` |
| Windsurf | workspace | `"mcpServers"` | Optional (inferred) | `{ command, args, cwd? }` | `{ url }` |

**Scope support per tool:**

| Tool | Workspace | Global |
|------|-----------|--------|
| VS Code | `.vscode/mcp.json` | `%APPDATA%\Code\User\settings.json` |
| Claude Code | `.mcp.json` | Not supported |
| Claude Desktop | Not supported | `claude_desktop_config.json` |
| Cursor | `.cursor/mcp.json` | Not supported |
| Windsurf | `.windsurf/mcp.json` | Not supported |

If `--scope` is set to a scope not supported by the target tool, return `SCOPE_NOT_SUPPORTED` error with the available scopes for that tool.

**Scope behavior:**
- **Workspace** configs use relative paths and `${workspaceFolder}` (VS Code). The config file lives inside the project directory.
- **Global** configs use absolute paths. The config file lives in the user's app data directory.
- `--scope` can override the default (e.g., `--scope global --tool vscode` writes to the user-level VS Code settings).

> **VS Code global config caution:** The global VS Code config path is `settings.json`, which contains all VS Code settings and is frequently hundreds of lines. The JSONC `modify()` approach is essential here — never parse-modify-serialize this file. Prefer workspace scope (the default) unless the user explicitly requests global.

**VS Code-specific features:**
- Supports `${workspaceFolder}` variable in paths
- Supports `"inputs"` array for secret prompting at runtime
- Secret env vars generate both an input entry and an `${input:id}` reference

**Secret env var handling per tool:**

| Tool | Secret Env Var Behavior |
|------|------------------------|
| VS Code | Generates `${input:id}` reference + `"inputs"` array entry with `"password": true` |
| Claude Code | Writes key in `"env"` block (value read from shell environment at launch) |
| Claude Desktop | Writes key in `"env"` block (value read from shell environment at launch) |
| Cursor | Writes key in `"env"` block (value read from shell environment at launch) |
| Windsurf | Writes key in `"env"` block (value read from shell environment at launch) |

For non-VS Code tools, if a `required: true` secret env var is not currently set in the environment, emit a warning: `"⚠ API_KEY is required but not set in your environment. The server will fail to start until it is exported."`

### FR-4: CLI Interface

```
afd register [options]

Options:
  --tool <id>           Register for a specific tool only (vscode, cursor, claude-code, claude-desktop, windsurf)
  --transport <type>    Override transport (stdio, http). Default: per-tool preference
  --scope <type>        Override config scope (workspace, global). Default: per-tool preference
  --config-path <path>  Override config file path for the target tool (for non-standard installs)
  --dry-run             Show what would be written without modifying files
  --name <name>         Override server entry name in config
  --manifest <path>     Path to register.json manifest (default: .afd/register.json)
  --init                Create a .afd/register.json from the current project
  --force               Overwrite existing AFD entries without prompting
  --yes, -y             Skip confirmation prompts (for CI/scripting)
  --env <KEY=VALUE>     Set an environment variable value for config writing (repeatable)
```

The `--env` flag writes the value into the appropriate env reference format per tool (e.g., VS Code `"inputs"` default value, or shell `env` block for others). It does NOT write secrets as plaintext into config — it only populates default values for non-secret env vars and suppresses the "not set in your environment" warning for secret vars that are confirmed present.

**Subcommands:**

```
afd register detect        Detect installed tools and show status (includes confidence level)
afd register init          Generate .afd/register.json from project
afd register apply         Write config to detected/specified tools (default action)
afd register status        Show current AFD registration state across all detected tools
                           Reads each tool's config and reports the AFD entry (if any)
afd register remove        Remove AFD server entry from all detected tool configs
                           Accepts --tool <id> and --name <name> to target specific entries
```

> **Note:** The previous `show <tool>` subcommand has been merged into `--dry-run --tool <id>`, which produces identical output. Use `afd register --dry-run --tool vscode` to preview what would be written for VS Code.

### FR-5: Init Command (Manifest Generation)

`afd register init` inspects the current project to auto-generate a manifest:

```typescript
interface InitStrategy {
  /** Detect server entry point */
  detectEntryPoint(): Promise<StdioConfig | null>;

  /** Detect required env vars from code */
  detectEnvVars(): Promise<Record<string, EnvVarConfig>>;

  /** Detect server name */
  detectName(): Promise<string>;
}
```

**Detection order for entry point:**
1. `package.json` → `"bin"` field (e.g., `afd` → `./dist/bin.js`)
2. `package.json` → `scripts.mcp` or `scripts.serve`
3. `pyproject.toml` → `[project.scripts]` entry
4. `Cargo.toml` → `[[bin]]` target (Rust servers)
5. Prompt the user

Guessing entry points from common filenames (`dist/server.js`, `src/server.ts`) was considered and rejected — too fragile. If steps 1-4 fail, prompt immediately.

> **Monorepo note:** In monorepos, `afd register init` operates on the current working directory. Use `--manifest <path>` or `cd` into the target package before running.

### FR-6: Idempotency and Safety

- **Read-modify-write**: Always reads existing config, merges the AFD entry, writes back. Never clobbers other MCP server entries.
- **Backup**: Before modifying an existing config file, create a `.bak` copy (e.g., `mcp.json.bak`). Only the most recent `.bak` is kept (overwrite previous). Delete the `.bak` file after successful post-write validation to avoid accumulation.
- **Conflict detection**: If an entry with the same name already exists, prompt the user unless `--force` is set.
- **JSON formatting**: Preserve indentation style of the existing file using `detect-indent`. Default to 2-space indent for new files.
- **JSONC support**: All config reads MUST use `jsonc-parser` (not `JSON.parse`), since VS Code configs regularly contain comments. For writes, use `jsonc-parser`'s `modify()` API to insert/update only the AFD entry key path, preserving comments and formatting in the rest of the file.
- **Post-write validation**: After writing, re-read and parse the file to verify it produces valid JSON/JSONC. If validation fails, restore the `.bak` backup and report the error.
- **Concurrent write caveat**: The read-modify-write cycle is not atomic. If another process (e.g., an IDE) writes to the same config file between read and write, changes may be lost. This is a known limitation — advisory file locking may be added in a future version. For now, the `.bak` backup provides recovery.

### FR-7: CommandResult Integration

All CLI output follows AFD `CommandResult` patterns:

```typescript
interface RegisterResult {
  /** Tools that were configured */
  configured: ConfiguredTool[];

  /** Tools that were skipped (already configured, not detected, etc.) */
  skipped: SkippedTool[];

  /** Warnings about potential issues */
  warnings: string[];
}

interface ConfiguredTool {
  toolId: ToolId;
  configPath: string;
  transport: 'stdio' | 'http';
  action: 'created' | 'updated' | 'removed';
}

interface SkippedTool {
  toolId: ToolId;
  reason: string;
  suggestion?: string;
}
```

---

## API Design

### Public API (from `@lushly-dev/afd-cli`)

```typescript
// Programmatic usage (for other CLIs to call)
export function detectTools(projectPath?: string): Promise<DetectedTool[]>;
export function generateManifest(projectPath?: string): Promise<RegisterManifest>;
export function registerServer(
  manifest: RegisterManifest,
  options?: RegisterOptions
): Promise<CommandResult<RegisterResult>>;
export function unregisterServer(
  entryName: string,
  options?: UnregisterOptions
): Promise<CommandResult<RegisterResult>>;

interface RegisterOptions {
  /** Specific tools to target */
  tools?: ToolId[];

  /** Transport override */
  transport?: 'stdio' | 'http';

  /** Scope override */
  scope?: 'workspace' | 'global';

  /** Override config file path for the target tool */
  configPath?: string;

  /** Preview mode */
  dryRun?: boolean;

  /** Overwrite existing entries */
  force?: boolean;

  /** Skip confirmation prompts */
  yes?: boolean;

  /** Server entry name override */
  entryName?: string;

  /** Environment variable values (KEY=VALUE pairs) */
  env?: Record<string, string>;
}

interface UnregisterOptions {
  /** Specific tools to target */
  tools?: ToolId[];

  /** Server entry name to remove (default: manifest name) */
  entryName?: string;

  /** Preview mode */
  dryRun?: boolean;

  /** Skip confirmation prompts */
  yes?: boolean;
}
```

### Internal Architecture

```
afd register apply (default)
     │
     ├── detectTools()        → Find installed AI tools (with confidence)
     ├── loadManifest()       → Read .afd/register.json (or init)
     │
     └── for each target tool:
         ├── ConfigWriter.read()     → Parse existing config (JSONC-aware)
         ├── ConfigWriter.merge()    → Add/update AFD entry
         ├── ConfigWriter.write()    → Write back to disk
         └── ConfigWriter.read()     → Re-read to validate (post-write check)

afd register remove
     │
     ├── detectTools()        → Find installed AI tools
     │
     └── for each target tool:
         ├── ConfigWriter.read()     → Parse existing config
         ├── ConfigWriter.remove()   → Remove AFD entry
         └── ConfigWriter.write()    → Write back to disk
```

---

## Examples

### Example 1: First-Time Setup

```bash
$ afd register init
✓ Detected entry point: node dist/bin.js
✓ Detected server name: my-todo-server
✓ Created .afd/register.json

$ afd register
Detecting installed AI tools...
  ✓ VS Code      — .vscode/mcp.json
  ✓ Claude Code   — .mcp.json
  ✓ Cursor        — .cursor/mcp.json
  ✗ Claude Desktop — not installed
  ✗ Windsurf      — not installed

Registering my-todo-server...
  ✓ VS Code       — wrote stdio config to .vscode/mcp.json
  ✓ Claude Code    — wrote stdio config to .mcp.json
  ✓ Cursor         — wrote stdio config to .cursor/mcp.json

3 tools configured. Run `afd register detect` to verify.
```

### Example 2: Dry Run

```bash
$ afd register --dry-run --tool vscode
Would write to .vscode/mcp.json:

{
  "servers": {
    "my-todo-server": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/bin.js"],
      "cwd": "${workspaceFolder}"
    }
  }
}

No files modified (dry run).
```

### Example 3: HTTP Transport for Remote Server

```bash
$ afd register --tool cursor --transport http
✓ Cursor — wrote http config to .cursor/mcp.json

# Resulting .cursor/mcp.json entry:
{
  "mcpServers": {
    "my-todo-server": {
      "url": "http://localhost:3100/sse"
    }
  }
}
```

### Example 4: Re-Registration After Config Change

```bash
$ afd register
Detecting installed AI tools...
  ✓ VS Code       — .vscode/mcp.json (existing entry: my-todo-server)
  ✓ Cursor         — .cursor/mcp.json (existing entry: my-todo-server)

Existing entries found. Overwrite? [y/N/diff] diff

--- .vscode/mcp.json (current)
+++ .vscode/mcp.json (proposed)
@@ -3,3 +3,3 @@
-      "args": ["dist/old-server.js"],
+      "args": ["dist/bin.js"],

Apply changes? [y/N] y
  ✓ VS Code       — updated stdio config
  ✓ Cursor         — updated stdio config
```

> Diff output uses standard unified diff format for familiarity with `git diff`.

### Example 5: Team Manifest with Env Vars

`.afd/register.json` (committed to repo):
```json
{
  "version": 1,
  "name": "product-api",
  "stdio": {
    "command": "node",
    "args": ["dist/server.js"]
  },
  "env": {
    "API_KEY": {
      "description": "Product API key",
      "secret": true,
      "required": true
    }
  }
}
```

```bash
# Team member runs:
$ afd register --tool vscode

# VS Code config includes input prompting:
{
  "servers": {
    "product-api": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/server.js"],
      "env": {
        "API_KEY": "${input:product-api-API_KEY}"
      }
    }
  },
  "inputs": [
    {
      "id": "product-api-API_KEY",
      "type": "promptString",
      "description": "Product API key",
      "password": true
    }
  ]
}
```

### Example 6: Removing a Server

```bash
$ afd register remove
Detecting installed AI tools...
  ✓ VS Code       — .vscode/mcp.json (entry: product-api)
  ✓ Cursor         — .cursor/mcp.json (entry: product-api)
  ✗ Claude Desktop — no entry found

Remove product-api from 2 tools? [y/N] y
  ✓ VS Code       — removed product-api from .vscode/mcp.json
  ✓ Cursor         — removed product-api from .cursor/mcp.json

2 tools updated.
```

```bash
# Non-interactive usage (CI/scripting):
$ afd register remove --yes

# Remove a custom-named entry:
$ afd register remove --name my-custom-server --tool vscode
```

---

## Error Handling

The following failure modes must produce clear, actionable errors:

| Scenario | Error Code | Behavior |
|----------|-----------|----------|
| Config file is read-only | `CONFIG_PERMISSION_DENIED` | Report path + suggestion (`chmod` or run as admin) |
| Config file locked by IDE | `CONFIG_FILE_LOCKED` | Report which process holds the lock; suggest closing the tool or retrying |
| Config file contains malformed JSON/JSONC | `CONFIG_PARSE_ERROR` | Report parse error location; do NOT overwrite the file |
| Post-write validation fails | `CONFIG_WRITE_CORRUPT` | Restore `.bak` backup automatically; report what went wrong |
| Manifest file not found | `MANIFEST_NOT_FOUND` | Suggest `afd register init` to generate one |
| Manifest has unknown `version` | `MANIFEST_VERSION_UNSUPPORTED` | Report expected vs actual version; suggest updating `afd` CLI |
| Manifest fails Zod validation | `MANIFEST_INVALID` | Report field-level validation errors with suggestions |
| `include` and `exclude` both set | `MANIFEST_INVALID` | Report that `include` and `exclude` are mutually exclusive |
| `--scope` unsupported by tool | `SCOPE_NOT_SUPPORTED` | Report which scopes the tool supports |
| Disk full / write fails | `CONFIG_WRITE_FAILED` | Restore `.bak` backup if possible; report OS error |
| User cancels confirmation prompt | — | Exit cleanly with no changes; report `0 tools configured` |
| `--config-path` points outside project | `PATH_TRAVERSAL_REJECTED` | Reject with error; never write outside project root for workspace scope |

All error results use `CommandResult` with appropriate `error.code`, `error.message`, and `error.suggestion`.

---

## Implementation Notes

### Config Writer Registry

Use a registry pattern so new tools can be added without modifying existing code:

```typescript
// ToolId uses a string-based registry rather than a closed union type,
// allowing third-party tools (Zed, JetBrains, etc.) to be added at runtime.
const writers = new Map<string, ConfigWriter>();

function registerWriter(toolId: string, writer: ConfigWriter): void {
  writers.set(toolId, writer);
}

// Built-in writers
registerWriter('vscode', new VsCodeConfigWriter());
registerWriter('claude-code', new ClaudeCodeConfigWriter());
registerWriter('claude-desktop', new ClaudeDesktopConfigWriter());
registerWriter('cursor', new CursorConfigWriter());
registerWriter('windsurf', new WindsurfConfigWriter());
```

> **Extensibility note:** The `ToolId` type in user-facing APIs remains a union of known tool strings for autocomplete and validation. Internally, the registry accepts any string to allow future tools to be registered without a library update.

### Path Handling

- Use `node:path` and `node:os` for cross-platform paths
- Normalize `cwd` to relative paths in workspace-scoped configs (VS Code, Claude Code, Cursor)
- Use absolute paths for global configs (Claude Desktop)
- VS Code configs should use `${workspaceFolder}` variable where appropriate
- All path separators must use forward slashes in JSON config (even on Windows)

### JSON Parsing Robustness

All config file reads MUST use `jsonc-parser` (required dependency, not optional). VS Code configs routinely contain `//` comments; using `JSON.parse` as primary parser will corrupt user configs. The approach:

1. **Read**: Always parse with `jsonc-parser`'s `parse()` (handles both JSON and JSONC).
2. **Modify**: Use `jsonc-parser`'s `modify()` to produce text edits for only the AFD entry path. This preserves comments, formatting, and whitespace outside the modified key.
3. **Apply**: Apply the text edits to the original file content and write back.

This avoids the lossy `parse → modify object → serialize` cycle entirely.

### Security Considerations

- **Never write secrets to config files.** Use environment variable references (`${env:VAR}` for VS Code, `env` field for Claude/Cursor).
- **Validate manifest paths.** Reject paths that traverse outside the project (e.g., `../../etc/passwd`). Use `node:path.resolve()` and verify the resolved path starts with the project root.
- **File permissions.** On Unix systems, ensure created config files are not world-readable when they contain env var keys (`chmod 600`).

### Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | Already used by CLI for command parsing |
| `conf` | Already used by CLI for user config |
| `chalk` | Already used by CLI for colored output |
| `ora` | Already used by CLI for spinners |
| `jsonc-parser` | New (required) — JSONC read/modify for all config files |
| `detect-indent` | New — detect existing file indentation style for format preservation |

---

## Relationship to Existing Types

| Existing | Registration Equivalent |
|----------|------------------------|
| `McpServerOptions.name` | Source for `RegisterManifest.name` |
| `McpServerOptions.transport` | Maps to `StdioConfig` or `HttpConfig` |
| `McpServerOptions.port` | Used in `HttpConfig.url` construction |
| `McpServerOptions.toolStrategy` | Not directly used — registration writes server-level config, not per-tool strategy |
| `ZodCommandDefinition.expose` | Could filter which commands appear in tool descriptions (future enhancement) |
| `CommandDefinition.category/tags` | Could inform server description in generated config (future enhancement) |
| `StoredConfig` (cli config.ts) | Stores last-registered server info |
| `CommandResult` | All register operations return `CommandResult<RegisterResult>` |
| `ZodCommandOptions.mutation` / `.destructive` | Not used for registration. These flow to MCP SDK `ToolAnnotations` (`readOnlyHint`, `destructiveHint`) at the tool-listing level, not server config level. |

---

## Out of Scope

- [ ] Executing `afd register` as part of `npm postinstall` (convenience wrapper for Phase 2)
- [ ] Registering non-AFD MCP servers (this is AFD-specific)
- [ ] GUI/TUI for config editing (text-mode diff is sufficient)
- [ ] Remote tool detection over SSH (local machine only)
- [ ] npm/pypi package distribution of the manifest (Phase 2)
- [ ] Filtering exposed commands per tool based on `expose` options (future enhancement)

---

## Success Criteria

### Functional
- [ ] `afd register detect` lists installed AI tools with config paths and detection confidence
- [ ] `afd register init` generates `.afd/register.json` (with `version: 1`) from project inspection
- [ ] `afd register` writes correct config for VS Code, Claude Code, Claude Desktop, Cursor, and Windsurf
- [ ] `afd register status` reads and reports current AFD registration state across all tools
- [ ] `afd register remove` removes AFD entries from tool configs without affecting other entries
- [ ] `afd register remove --name <name>` removes a specific named entry
- [ ] `--dry-run` shows proposed changes without writing (replaces `show <tool>` subcommand)
- [ ] `--scope` overrides default workspace/global behavior per tool; unsupported scope returns `SCOPE_NOT_SUPPORTED`
- [ ] `--yes` skips confirmation prompts for CI/scripting
- [ ] `--env KEY=VALUE` passes environment variable values at registration time
- [ ] Manifest is validated with Zod schema at load time; invalid manifests return `MANIFEST_INVALID`
- [ ] Existing config entries for other servers are preserved (read-modify-write via `jsonc-parser`)
- [ ] Idempotent re-runs update entries without duplication
- [ ] VS Code configs use `${workspaceFolder}` and `inputs` for secrets
- [ ] Claude Code config path resolution prefers `.mcp.json`, falls back to `.claude/mcp.json`
- [ ] Claude/Cursor configs use the `mcpServers` root key
- [ ] HTTP transport writes URL-only entries
- [ ] Stdio transport writes command/args entries
- [ ] Env var configs generate tool-appropriate env references (see per-tool table)
- [ ] Low-confidence detections are shown but not auto-configured without `--force`; medium/high are auto-configured
- [ ] Post-write validation re-reads the config to ensure it's valid; `.bak` deleted on success
- [ ] JSONC comments in existing configs are preserved after merge

### Testing
- [ ] Unit tests for each ConfigWriter (VS Code, Claude Code, Claude Desktop, Cursor, Windsurf)
- [ ] Unit tests for `ConfigWriter.remove()` for each tool
- [ ] Snapshot tests for generated config output per tool/transport/scope combination
- [ ] Integration test: roundtrip write → read → verify for each format
- [ ] Integration test: write → remove → verify original config restored (minus AFD entry)
- [ ] Mock filesystem tests (no real config files written during CI)
- [ ] Cross-platform path handling (Windows + macOS + Linux) — tested via path normalization unit tests
- [ ] Error scenario tests: read-only file, malformed JSON, post-write validation failure with backup restore
- [ ] Manifest Zod validation tests: missing fields, invalid types, `include`+`exclude` conflict, unknown version
- [ ] Claude Code config path resolution tests: `.mcp.json` only, `.claude/mcp.json` only, both present
- [ ] Scope support tests: `--scope global` with workspace-only tools returns `SCOPE_NOT_SUPPORTED`
