# External Adapters

Connect external APIs and CLIs to the CommandResult interface.

## Overview

External systems (APIs, CLIs, files) don't speak `CommandResult`. Adapters bridge the gap, converting vendor-specific formats into the unified command interface and vice versa.

```
                    COMMAND LAYER
                  (Clean Business Logic)
                         |
        +----------------+----------------+
        |                |                |
     Expose           Expose           Consume
     as API           as CLI           from API
     REST/MCP         Terminal         External
```

Same core, different surfaces, adapters in both directions.

## Adapter Types

| Adapter | Direction | Purpose |
|---------|-----------|---------|
| **API Adapter** | External -> Command | Convert API responses to CommandResult |
| **CLI Adapter** | External -> Command | Convert CLI output to CommandResult |
| **REST Adapter** | Command -> External | Expose commands as REST endpoints |
| **MCP Adapter** | Command -> External | Expose commands via MCP protocol |
| **HTML Adapter** | Command -> External | Render CommandResult as HTML |

## API Adapter Interface

```typescript
interface APIAdapter<TConfig = unknown> {
  name: string;
  version: string;
  configure(config: TConfig): void;
  toCommand<T>(endpoint: string, response: unknown, options?: AdapterOptions): CommandResult<T>;
  fromCommand<T>(command: CommandInput, target: string): APIRequest;
  outputSchema(endpoint: string): JSONSchema;
  handleError(error: unknown): CommandResult<never>;
}
```

## CLI Adapter Interface

```typescript
interface CLIAdapter<TConfig = unknown> {
  name: string;
  executable: string;  // e.g., 'gh', 'git', 'docker'
  run<T>(args: string[], options?: RunOptions): Promise<CommandResult<T>>;
  parse<T>(args: string[], stdout: string, stderr: string, exitCode: number): CommandResult<T>;
  outputSchema(command: string): JSONSchema;
}
```

## Example: GitHub CLI Adapter

```typescript
class GitHubCLIAdapter implements CLIAdapter {
  name = 'github-cli';
  executable = 'gh';

  async run<T>(args: string[]): Promise<CommandResult<T>> {
    const result = await exec(`gh ${args.join(' ')}`);
    return this.parse(args, result.stdout, result.stderr, result.exitCode);
  }

  parse<T>(args: string[], stdout: string, stderr: string, exitCode: number): CommandResult<T> {
    if (exitCode !== 0) {
      return { success: false, error: { code: 'CLI_ERROR', message: stderr || stdout } };
    }
    const subcommand = args[0];
    switch (subcommand) {
      case 'issue': return this.parseIssue(args.slice(1), stdout);
      case 'pr': return this.parsePR(args.slice(1), stdout);
      default: return this.parseGeneric(stdout);
    }
  }
}
```

## The Swappable Surface Pattern

The same command logic can be exposed or consumed through different surfaces:

```typescript
const todoCommands = createTodoCommands(db);

const mcpServer = createMCPServer(todoCommands);   // For agents
const restServer = createRESTServer(todoCommands);  // For web apps
const cli = createCLI(todoCommands);                // For terminals
```

All share the same command layer -- adapters just swap the interface.

## Pre-Built Adapters

| Adapter | Type | Source |
|---------|------|--------|
| `GitHubCLIAdapter` | CLI | `gh` |
| `GitHubAPIAdapter` | API | GitHub REST API |
| `GitCLIAdapter` | CLI | `git` |
| `DockerCLIAdapter` | CLI | `docker` |
| `NPMCLIAdapter` | CLI | `npm`, `pnpm` |
