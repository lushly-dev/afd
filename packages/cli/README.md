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

### Authenticate

Pass credentials as request headers, not in the URL. `-H, --header "Name: value"`
is accepted by every command that connects (`connect`, `status`, `tools`,
`call`, `batch`, `stream`, `validate`, `shell`, `scenario run`) and can be
repeated. The `AFD_HEADERS` environment variable supplies the same headers, one
`Name: value` per line; a `--header` with the same name wins.

```bash
# One command
afd call todo-list --header "Authorization: Bearer $TOKEN"

# Every command in this shell session
export AFD_HEADERS="Authorization: Bearer $TOKEN"
afd connect https://api.example.com/sse
afd call todo-list
```

Headers are sent with every request, including the SSE stream and `stream`
requests, and are **never saved**: `afd connect --header ...` checks the
connection, but later commands need the header again (or `AFD_HEADERS`).

When the CLI prints a server URL, it replaces credentials with `***`: the
userinfo (`https://user:pass@...`) and the values of query parameters whose
names contain `token`, `key`, `secret`, `auth`, `password`, `signature` or
`credential`. `afd connect` warns when the URL it saves contains credentials.

### List Tools

```bash
# List all available tools
afd tools

# Filter by category
afd tools --category document

# Output as JSON
afd tools --format json
```

Text output groups tools by `_meta.category`. A tool without a category is
grouped by its kebab-case domain, the part of the name before the first `-`
(`todo-create` → `todo`), which is also what `--category` matches.

### Call Commands

```bash
# Call with JSON arguments
afd call document-create '{"title": "My Document"}'

# Call with key=value pairs
afd call document-get id=doc-123

# Quote values that contain spaces
afd call document-create 'title="Quarterly report" tags=["q3", "finance"]'

# Verbose output (shows reasoning, sources, etc.)
afd call document-analyze id=doc-123 --verbose

# Output as JSON
afd call document-list --format json

# Use another server for one call without replacing the saved connection
afd call document-list --connect http://localhost:3200/mcp --transport http --format json
```

Arguments are one JSON object, or whitespace-separated `key=value` pairs. A
value is read as JSON when it parses (`count=2`, `done=true`,
`tags=["a", "b"]`, `title="Two words"`) and as a string otherwise
(`id=doc-123`, `note='single-quoted text'`). A word without `=` is an error.
`stream` and the shell parse arguments the same way.

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
# Start interactive mode (reopens the saved connection, if any)
afd shell

# Connect to another server and save it as the default connection
afd shell --url http://localhost:3100/sse

# Choose the transport and timeout, send a header, and never reconnect
afd shell --url http://localhost:3100/message --transport http --timeout 10000 \
  --header "Authorization: Bearer $TOKEN" --no-reconnect
```

In the shell:

```
afd:connected> tools
afd:connected> tools todo
afd:connected> todo-create {"title": "Buy  oat milk"}
afd:connected> call todo-get id=todo-123
afd:connected> todo-update id=todo-123 title="Buy oat milk"
afd:connected> connect http://localhost:3200/message http
afd:connected> help
afd:connected> exit
```

- Only the first word is split off a line. Tool arguments are parsed from the
  rest of the line as it was typed, so spaces inside JSON strings and quoted
  values are kept.
- `<name> [args]` calls a tool without `call` when the name is in the server's
  tool list, or when it looks like an AFD command name (`domain-action`, or a
  legacy dotted name). Grouped and lazy servers do not list every command.
  Shell commands (`status`, `tools`, ...) take precedence; use `call <name>`
  for a tool with the same name.
- `--url` and `connect <url> [sse|http]` pick SSE for a URL ending in `/sse`
  and HTTP otherwise, and save the URL together with its transport and
  timeout. Without `--url`, the shell reopens the saved connection with its
  saved transport and timeout.
- The shell reconnects when its connection drops, unless you pass
  `--no-reconnect` or the saved connection was made with
  `afd connect --no-reconnect`.
- `exit` (or closing piped input) finishes every command already entered, then
  disconnects. Lines after `exit` are ignored.

### Batch and Stream

```bash
# Several commands in one request (exit code 2 on partial failure)
afd batch '[{"command":"todo-create","input":{"title":"A"}},{"command":"todo-list"}]'

# Stream a command's results with progress
afd stream export-run format=csv
```

### Scenarios

```bash
# Run JTBD scenario files against a server
afd scenario run ./scenarios --server http://localhost:3100/message --transport http

# Keep going after a scenario fails
afd scenario run ./scenarios --server http://localhost:3100/sse --no-stop-on-failure
```

Scenario files run in path order. By default the run stops after the first
scenario that does not pass (including a `partial` one, where some steps
failed); `--no-stop-on-failure` runs them all. Within a scenario, a failed step
always skips the remaining steps unless that step sets `continueOnFailure`.

## Commands

| Command | Description |
|---------|-------------|
| `connect <url>` | Connect to an MCP server |
| `disconnect` | Disconnect from server |
| `status` | Show connection status |
| `tools` | List available tools |
| `call <name> [args]` | Call a tool with arguments |
| `batch <commands>` | Run several commands in one request |
| `stream <name> [args]` | Stream a command's results |
| `validate` | Validate the tool listing (and, with `--execute`, command results) |
| `shell` | Start interactive mode |
| `scenario run\|validate\|init` | Run, check or create JTBD scenario files |

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
| `--no-reconnect` | Save the connection with auto-reconnect off, so `afd shell` does not reconnect it when it drops. One-shot commands never reconnect |
| `-H, --header <header>` | Request header `"Name: value"`, repeatable. Not saved |

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
| `-H, --header <header>` | Request header `"Name: value"`, repeatable |
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
| `-u, --url <url>` | Server URL to connect to and save. Default: the saved connection |
| `-t, --transport <type>` | Transport (sse, http). Default: the saved one, or inferred from the URL |
| `--timeout <ms>` | Request timeout. Default: the saved timeout, or 30000 |
| `--no-reconnect` | Do not reconnect when the connection drops |
| `-H, --header <header>` | Request header `"Name: value"`, repeatable. Not saved |

### scenario run

| Option | Description |
|--------|-------------|
| `-s, --server <url>` | Server to test against (required) |
| `-t, --transport <type>` | Transport (sse, http). Default: sse |
| `--stop-on-failure` / `--no-stop-on-failure` | Stop after the first failing scenario (default), or run them all |
| `--timeout <ms>` | Timeout per command. Default: 30000 |
| `-H, --header <header>` | Request header `"Name: value"`, repeatable |
| `--json`, `-v, --verbose`, `--no-color` | Output format and detail |

## Configuration

The CLI stores configuration in `~/.config/afd-cli-nodejs/config.json` (Linux),
`~/Library/Preferences/afd-cli-nodejs/config.json` (macOS) or
`%APPDATA%\afd-cli-nodejs\Config\config.json` (Windows). `afd connect` prints a
warning with the path when it saves a URL that contains credentials.

The file is created readable only by you (mode `0600`); a file saved by an
older version with a wider mode is narrowed the next time the CLI runs.

Stored settings:
- `serverUrl`: Last connected server URL
- `transport`: The transport used with that URL (`sse` or `http`), saved with it
- `timeout`: Default timeout
- `autoReconnect`: The `--no-reconnect` choice from the last `connect`, used by `afd shell`
- `format`: Default output format
- `debug`: Debug mode

Request headers (`--header`, `AFD_HEADERS`) are never stored.

`tools`, `call`, `batch`, `stream`, `validate`, and `status` recreate this
connection when they run in a later process. `disconnect` removes the saved
connection.

Every command except `shell` is one-shot: it connects without auto-reconnect
and disconnects when it finishes, so it exits after printing its result over
either transport. `shell` keeps its connection until you type `exit` or close
its input.

## Output Formats

### Text (Default)

Human-readable output with colors and formatting. Text that comes from the
server (data strings, reasoning, warnings, error messages and suggestions, tool
names and descriptions, stream data) is printed with control characters and
escape sequences removed, so a server cannot retitle your terminal, plant
hyperlinks or move the cursor to overwrite earlier output. Newlines and tabs are
kept.

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

Machine-readable JSON output. Values are printed exactly as the server sent
them; `JSON.stringify` escapes control characters.

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
| 2 | `batch` completed with some failed commands |
| 130 | `stream` cancelled with Ctrl+C |

## Examples

### Complete Workflow

```bash
# Connect
afd connect http://localhost:3100/sse

# List what's available
afd tools

# Create something
afd call document-create '{"title": "Test Doc"}'

# Validate the server's tool listing (add --execute to call read-only tools)
afd validate

# Interactive exploration
afd shell
```

### CI/CD Integration

```bash
# JSON output for parsing
afd connect http://localhost:3100/sse
afd call document-list --format json | jq '.data'
afd validate --strict || exit 1
```

## License

MIT
