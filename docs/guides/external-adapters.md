# AFD External Adapters

> Connect external APIs and CLIs to the CommandResult interface

---

## Overview

External systems (APIs, CLIs, files) don't speak `CommandResult`. Adapters bridge the gap, converting vendor-specific formats into the unified command interface—and vice versa.

---

## The Adapter Pattern

The command layer is the universal core. Adapters work **both directions**:

```
                    ┌─────────────────────────┐
                    │     COMMAND LAYER       │
                    │    (Clean Business      │
                    │       Logic)            │
                    └───────────┬─────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
   ┌─────────┐            ┌─────────┐            ┌─────────┐
   │ Expose  │            │ Expose  │            │ Consume │
   │ as API  │            │ as CLI  │            │ from API│
   └─────────┘            └─────────┘            └─────────┘
   REST/MCP               Terminal               External
```

Same core, different surfaces, adapters both directions.

---

## Adapter Types

| Adapter | Direction | Purpose |
|---------|-----------|---------|
| **API Adapter** | External → Command | Convert API responses to CommandResult |
| **CLI Adapter** | External → Command | Convert CLI output to CommandResult |
| **REST Adapter** | Command → External | Expose commands as REST endpoints |
| **MCP Adapter** | Command → External | Expose commands via MCP protocol |
| **HTML Adapter** | Command → External | Render CommandResult as HTML |

---

## API Adapter Interface

```typescript
interface APIAdapter<TConfig = unknown> {
  /** Adapter metadata */
  name: string;
  version: string;
  
  /** Configure the adapter */
  configure(config: TConfig): void;
  
  /** Convert API response to CommandResult */
  toCommand<T>(
    endpoint: string,
    response: unknown,
    options?: AdapterOptions
  ): CommandResult<T>;
  
  /** Convert CommandResult to API request (reverse) */
  fromCommand<T>(
    command: CommandInput,
    target: string
  ): APIRequest;
  
  /** Schema for what this adapter produces */
  outputSchema(endpoint: string): JSONSchema;
  
  /** Handle API errors uniformly */
  handleError(error: unknown): CommandResult<never>;
}
```

---

## CLI Adapter Interface

```typescript
interface CLIAdapter<TConfig = unknown> {
  /** Adapter metadata */
  name: string;
  executable: string;  // e.g., 'gh', 'git', 'docker'
  
  /** Run command and adapt output */
  run<T>(
    args: string[],
    options?: RunOptions
  ): Promise<CommandResult<T>>;
  
  /** Parse existing output */
  parse<T>(
    args: string[],
    stdout: string,
    stderr: string,
    exitCode: number
  ): CommandResult<T>;
  
  /** Schema for what this adapter produces */
  outputSchema(command: string): JSONSchema;
}
```

---

## Example: GitHub CLI Adapter

```typescript
import { CLIAdapter, CommandResult } from '@lushly-dev/afd-core';

class GitHubCLIAdapter implements CLIAdapter {
  name = 'github-cli';
  executable = 'gh';
  
  async run<T>(args: string[]): Promise<CommandResult<T>> {
    const result = await exec(`gh ${args.join(' ')}`);
    return this.parse(args, result.stdout, result.stderr, result.exitCode);
  }
  
  parse<T>(args: string[], stdout: string, stderr: string, exitCode: number): CommandResult<T> {
    if (exitCode !== 0) {
      return {
        success: false,
        error: { code: 'CLI_ERROR', message: stderr || stdout }
      };
    }
    
    const subcommand = args[0];
    
    switch (subcommand) {
      case 'issue':
        return this.parseIssue(args.slice(1), stdout);
      case 'pr':
        return this.parsePR(args.slice(1), stdout);
      case 'repo':
        return this.parseRepo(args.slice(1), stdout);
      default:
        return this.parseGeneric(stdout);
    }
  }
  
  private parseIssue(args: string[], stdout: string): CommandResult<Issue> {
    // Handle --json flag for structured output
    if (args.includes('--json')) {
      const data = JSON.parse(stdout);
      return {
        success: true,
        data: {
          id: data.number,
          title: data.title,
          state: data.state,
          author: data.author?.login,
          labels: data.labels?.map((l: any) => l.name) || []
        },
        confidence: 1.0,
        sources: [{ type: 'cli', executable: 'gh', args: ['issue', ...args] }]
      };
    }
    
    // Parse human-readable output
    return this.parseHumanReadable(stdout);
  }
}
```

---

## Example: Git CLI Adapter

```typescript
class GitCLIAdapter implements CLIAdapter {
  name = 'git';
  executable = 'git';
  
  parse<T>(args: string[], stdout: string, stderr: string, exitCode: number): CommandResult<T> {
    const command = args[0];
    
    switch (command) {
      case 'status':
        return this.parseStatus(args, stdout);
      case 'log':
        return this.parseLog(args, stdout);
      case 'diff':
        return this.parseDiff(stdout);
      case 'branch':
        return this.parseBranch(stdout);
      default:
        return {
          success: exitCode === 0,
          data: { output: stdout } as T,
          confidence: 1.0
        };
    }
  }
  
  private parseStatus(args: string[], stdout: string): CommandResult<GitStatus> {
    const lines = stdout.trim().split('\n').filter(Boolean);
    
    // --porcelain format
    if (args.includes('--porcelain')) {
      const staged: string[] = [];
      const modified: string[] = [];
      const untracked: string[] = [];
      
      for (const line of lines) {
        const status = line.substring(0, 2);
        const file = line.substring(3);
        
        if (status.startsWith('A') || status.startsWith('M')) staged.push(file);
        if (status.endsWith('M')) modified.push(file);
        if (status === '??') untracked.push(file);
      }
      
      return {
        success: true,
        data: {
          staged,
          modified,
          untracked,
          isClean: lines.length === 0
        },
        confidence: 1.0,
        sources: [{ type: 'cli', executable: 'git', args }]
      };
    }
    
    // Human-readable format
    return this.parseHumanReadableStatus(stdout);
  }
}
```

---

## Example: GitHub API Adapter

```typescript
class GitHubAPIAdapter implements APIAdapter {
  name = 'github-api';
  version = '1.0.0';
  
  private baseUrl = 'https://api.github.com';
  private token: string;
  
  configure(config: { token: string }) {
    this.token = config.token;
  }
  
  toCommand<T>(endpoint: string, response: unknown): CommandResult<T> {
    // Route by endpoint pattern
    if (endpoint.match(/\/repos\/[^/]+\/[^/]+\/issues\/\d+/)) {
      return this.adaptIssue(response as GitHubIssueResponse);
    }
    if (endpoint.match(/\/repos\/[^/]+\/[^/]+\/pulls\/\d+/)) {
      return this.adaptPullRequest(response as GitHubPRResponse);
    }
    
    // Generic passthrough
    return {
      success: true,
      data: response as T,
      confidence: 1.0,
      sources: [{ type: 'api', provider: 'github', endpoint }]
    };
  }
  
  private adaptIssue(raw: GitHubIssueResponse): CommandResult<Issue> {
    return {
      success: true,
      data: {
        id: raw.number,
        title: raw.title,
        state: raw.state,
        url: raw.html_url,
        author: raw.user.login,
        labels: raw.labels.map(l => l.name),
        createdAt: raw.created_at,
        updatedAt: raw.updated_at
      },
      confidence: 1.0,
      sources: [{ type: 'api', provider: 'github', endpoint: `/issues/${raw.number}` }]
    };
  }
  
  handleError(error: unknown): CommandResult<never> {
    if (error instanceof Response) {
      return {
        success: false,
        error: {
          code: `HTTP_${error.status}`,
          message: error.statusText
        }
      };
    }
    
    return {
      success: false,
      error: { code: 'UNKNOWN', message: String(error) }
    };
  }
}
```

---

## Usage: AWI with Adapters

```typescript
class AWIMechanicalLayer {
  private gh = new GitHubCLIAdapter();
  private git = new GitCLIAdapter();
  
  async updateIssueStatus(issue: string, status: 'in_progress' | 'done') {
    return this.gh.run([
      'issue', 'edit', issue,
      '--add-label', status === 'in_progress' ? 'in-progress' : 'done',
      '--remove-label', status === 'in_progress' ? 'todo' : 'in-progress'
    ]);
  }
  
  async commitAndPush(message: string) {
    const status = await this.git.run(['status', '--porcelain']);
    
    if (!status.success) return status;
    if (status.data.isClean) {
      return { success: true, data: { message: 'Nothing to commit' } };
    }
    
    await this.git.run(['add', '-A']);
    await this.git.run(['commit', '-m', message]);
    return this.git.run(['push']);
  }
  
  async createPR(title: string, body: string) {
    return this.gh.run([
      'pr', 'create',
      '--title', title,
      '--body', body,
      '--json', 'number,url'
    ]);
  }
}
```

---

## Pre-Built Adapters

| Adapter | Type | Source |
|---------|------|--------|
| `GitHubCLIAdapter` | CLI | `gh` |
| `GitHubAPIAdapter` | API | GitHub REST API |
| `GitCLIAdapter` | CLI | `git` |
| `DockerCLIAdapter` | CLI | `docker` |
| `NPMCLIAdapter` | CLI | `npm`, `pnpm` |
| `OpenAIAPIAdapter` | API | OpenAI API |
| `SlackAPIAdapter` | API | Slack API |

---

## The Swappable Surface Pattern

The same command logic can be exposed or consumed through different surfaces:

```typescript
// Core command logic
const todoCommands = createTodoCommands(db);

// Expose as MCP (for agents)
const mcpServer = createMCPServer(todoCommands);

// Expose as REST (for web apps)  
const restServer = createRESTServer(todoCommands);

// Expose as CLI (for terminals)
const cli = createCLI(todoCommands);

// Consume external API and bridge to local commands
const externalAdapter = new ExternalTodoAPIAdapter();
const bridged = createBridge(externalAdapter, todoCommands);
```

All these share the same command layer—adapters just swap the interface.

---

## Package Structure

```
@lushly-dev/afd-adapters/
├── api/
│   ├── github.ts
│   ├── openai.ts
│   ├── slack.ts
│   └── generic.ts
├── cli/
│   ├── github.ts
│   ├── git.ts
│   ├── docker.ts
│   └── npm.ts
└── index.ts
```
