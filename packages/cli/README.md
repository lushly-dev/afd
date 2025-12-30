# @afd/cli

Command-line interface for Agent-First Development.

## Installation

```bash
npm install -g @afd/cli
# or
pnpm add -g @afd/cli
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
```

### Validate Commands

```bash
# Validate all commands on the connected server
afd validate

# Validate specific category
afd validate --category document

# Strict mode (warnings become errors)
afd validate --strict

# Verbose output
afd validate --verbose
```

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
| `validate` | Validate command results |
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
| `-c, --category <name>` | Filter by category |
| `-f, --format <format>` | Output format (json, text). Default: text |
| `--refresh` | Force refresh from server |

### call

| Option | Description |
|--------|-------------|
| `-f, --format <format>` | Output format (json, text). Default: text |
| `-v, --verbose` | Show detailed output |

### validate

| Option | Description |
|--------|-------------|
| `-c, --category <name>` | Validate only this category |
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
- `timeout`: Default timeout
- `format`: Default output format
- `debug`: Debug mode

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

# Validate the server's command implementations
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
