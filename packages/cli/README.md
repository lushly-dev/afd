# @lushly-dev/afd-cli

Command-line interface for Agent-First Development.

## Installation

```bash
npm install -g @lushly-dev/afd-cli
# or
pnpm add -g @lushly-dev/afd-cli
```

## Usage

### Connect to a Server

```bash
# Connect to an MCP server via SSE
afd connect http://localhost:3100/sse

# Connect via HTTP
afd connect http://localhost:3100/message --transport http

# Check connection status
afd status
```

### List Tools

```bash
# List all available tools
afd tools

# Filter by category
afd tools --category document

# Output as JSON
afd tools --format json
```

### Call Commands

```bash
# Call with JSON arguments
afd call document.create '{"title": "My Document"}'

# Call with key=value pairs
afd call document.get id=doc-123

# Verbose output (shows reasoning, sources, etc.)
afd call document.analyze id=doc-123 --verbose

# Output as JSON
afd call document.list --format json

# Use another server for one call without replacing the saved connection
afd call document.list --connect http://localhost:3200/mcp --transport http --format json
```

### Validate Commands

```bash
# Check the connected server's tool listing (executes nothing)
afd validate

# Also call read-only tools and validate their CommandResult envelopes
afd validate --execute

# Validate specific category
afd validate --category document

# Strict mode (warnings become errors)
afd validate --strict

# Verbose output
afd validate --verbose
```

By default, `afd validate` never calls a tool. It checks what `tools/list`
advertises: names, descriptions, input schemas, and `_meta.examples`.

`--execute` also calls each tool and validates the returned `CommandResult`:

- Tools whose `_meta` sets `mutation: true` or `destructive: true` are never
  called. Each one is listed as `skipped` with the reason.
- Each call uses `_meta.examples[0].input` when the server advertises an
  example, and `{}` otherwise.
- Tools without metadata are treated as safe to call. Only use `--execute`
  against servers that mark their side-effecting commands.

`--category <name>` matches the tool's `_meta.category`. Tools without a
category match when their name starts with `<name>-` (for example, `todo`
matches `todo-create`).

### Interactive Shell

```bash
# Start interactive mode
afd shell

# Start with auto-connect
afd shell --url http://localhost:3100/sse
```

In the shell:

```
afd:connected> tools
afd:connected> document.create {"title": "Test"}
afd:connected> document.get id=doc-123
afd:connected> help
afd:connected> exit
```

## Commands

| Command | Description |
|---------|-------------|
| `connect <url>` | Connect to an MCP server |
| `disconnect` | Disconnect from server |
| `status` | Show connection status |
| `tools` | List available tools |
| `call <name> [args]` | Call a tool with arguments |
| `validate` | Validate the tool listing (and, with `--execute`, command results) |
| `shell` | Start interactive mode |

## Options

### Global Options

| Option | Description |
|--------|-------------|
| `-V, --version` | Output version number |
| `-h, --help` | Display help |

### connect

| Option | Description |
|--------|-------------|
| `-t, --transport <type>` | Transport type (sse, http). Default: sse |
| `--timeout <ms>` | Connection timeout. Default: 30000 |
| `--no-reconnect` | Disable auto-reconnection |

### tools

| Option | Description |
|--------|-------------|
| `-c, --category <name>` | Filter by `_meta.category` (or `<name>-` name prefix) |
| `-f, --format <format>` | Output format (json, text). Default: text |
| `--refresh` | Force refresh from server |

### call

| Option | Description |
|--------|-------------|
| `--connect <url>` | Use a server URL for this call only |
| `--transport <type>` | Transport for `--connect` (sse, http). Default: http |
| `--timeout <ms>` | Connection timeout for this call |
| `-f, --format <format>` | Output format (json, text). Default: text |
| `-v, --verbose` | Show detailed output |

### validate

| Option | Description |
|--------|-------------|
| `-c, --category <name>` | Validate only tools whose `_meta.category` (or `<name>-` name prefix) matches |
| `--execute` | Also call each tool and validate its result. Skips `mutation`/`destructive` tools |
| `--strict` | Treat warnings as errors |
| `-v, --verbose` | Show detailed results |

### shell

| Option | Description |
|--------|-------------|
| `-u, --url <url>` | Server URL to auto-connect |

## Configuration

The CLI stores configuration in `~/.config/afd-cli/config.json` (Linux/Mac) or `%APPDATA%\afd-cli\Config\config.json` (Windows).

Stored settings:
- `serverUrl`: Last connected server URL
- `transport`: Last selected transport (`sse` or `http`)
- `timeout`: Default timeout
- `autoReconnect`: The `--no-reconnect` choice from the last `connect`
- `format`: Default output format
- `debug`: Debug mode

`tools`, `call`, `batch`, `stream`, `validate`, and `status` recreate this
connection when they run in a later process. `disconnect` removes the saved
connection.

Every command except `shell` is one-shot: it connects without auto-reconnect
and disconnects when it finishes, so it exits after printing its result over
either transport. `shell` keeps its connection until you type `exit` or close
its input.

## Output Formats

### Text (Default)

Human-readable output with colors and formatting:

```
✓ Success

Data:
{
  "id": "doc-123",
  "title": "My Document"
}

Confidence: ████████░░ 80%

Reasoning: Document created with default template
```

### JSON

Machine-readable JSON output:

```json
{
  "success": true,
  "data": {
    "id": "doc-123",
    "title": "My Document"
  },
  "confidence": 0.8,
  "reasoning": "Document created with default template"
}
```

## Error Handling

Errors include helpful suggestions:

```
✗ Failed

Error: [VALIDATION_ERROR] Title is required

Suggestion: Provide a title in the arguments
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Command failed or error occurred |

## Examples

### Complete Workflow

```bash
# Connect
afd connect http://localhost:3100/sse

# List what's available
afd tools

# Create something
afd call document.create '{"title": "Test Doc"}'

# Validate the server's tool listing (add --execute to call read-only tools)
afd validate

# Interactive exploration
afd shell
```

### CI/CD Integration

```bash
# JSON output for parsing
afd connect http://localhost:3100/sse
afd call document.list --format json | jq '.data'
afd validate --strict || exit 1
```

## License

MIT
