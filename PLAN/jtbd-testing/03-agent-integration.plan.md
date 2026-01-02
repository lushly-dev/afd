# Phase 3: Agent Integration

> **Goal**: Enable AI agents to discover, run, and suggest scenarios via MCP.

---

## Overview

Phase 3 exposes the JTBD testing framework to AI agents:

- MCP tools for all scenario commands
- Smart suggestion system based on code changes
- Natural language scenario queries
- Agent-friendly output formats

**Success Criteria**: AI agent can run tests, analyze failures, and suggest new scenarios.

---

## Commands to Implement

| Command               | Description               | Priority | Status      |
| --------------------- | ------------------------- | -------- | ----------- |
| `scenario.suggest`    | AI-powered suggestions    | P2       | Not Started |
| MCP tool registration | All commands as MCP tools | P2       | Not Started |

---

## MCP Tool Registration

All scenario commands become MCP tools.

### Tool Definitions

```typescript
// src/mcp/tools.ts

import { z } from "zod";
import { registry } from "../commands";

export function generateMcpTools() {
  const tools = [];

  for (const command of registry.list()) {
    tools.push({
      name: command.name.replace(".", "_"),
      description: command.description,
      inputSchema: zodToJsonSchema(command.inputSchema),
      handler: async (input: unknown) => {
        const result = await command.handler(input);
        return formatForAgent(result);
      },
    });
  }

  return tools;
}

function formatForAgent(result: CommandResult<unknown>) {
  // Include reasoning prominently for AI interpretation
  return {
    ...result,
    _agentHints: {
      shouldRetry: result.error?.suggestion?.includes("try again"),
      relatedCommands: getRelatedCommands(result),
      nextSteps: suggestNextSteps(result),
    },
  };
}
```

### MCP Server Integration

```typescript
// src/mcp/server.ts

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { generateMcpTools } from "./tools";

export async function createMcpServer() {
  const server = new Server(
    {
      name: "afd-testing",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const tools = generateMcpTools();

  server.setRequestHandler("tools/list", async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler("tools/call", async (request) => {
    const tool = tools.find((t) => t.name === request.params.name);
    if (!tool) {
      throw new Error(`Tool not found: ${request.params.name}`);
    }

    const result = await tool.handler(request.params.arguments);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  });

  return server;
}

// Start server
const server = await createMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
```

### MCP Configuration

```json
// .cursor/mcp.json (example)
{
  "mcpServers": {
    "afd-testing": {
      "command": "node",
      "args": ["node_modules/@afd/testing/dist/mcp/server.js"],
      "env": {
        "AFD_CLI": "violet --memory"
      }
    }
  }
}
```

---

## scenario.suggest Command

AI-powered scenario suggestions based on context.

### Input Schema

```typescript
interface ScenarioSuggestInput {
  /** Context type for suggestions */
  context: "changed-files" | "uncovered" | "failed" | "command" | "natural";

  /** Changed files (for changed-files context) */
  files?: string[];

  /** Specific command to suggest scenarios for */
  command?: string;

  /** Natural language query */
  query?: string;

  /** Maximum suggestions */
  limit?: number;

  /** Include scenario skeletons */
  includeSkeleton?: boolean;
}
```

### Output Schema

```typescript
interface ScenarioSuggestOutput {
  /** Suggestions */
  suggestions: ScenarioSuggestion[];

  /** Reasoning for suggestions */
  reasoning: string;
}

interface ScenarioSuggestion {
  /** Suggested scenario name */
  name: string;

  /** Job this would test */
  job: string;

  /** Why this is suggested */
  reason: string;

  /** Confidence (0-1) */
  confidence: number;

  /** Priority */
  priority: "high" | "medium" | "low";

  /** Skeleton scenario (if requested) */
  skeleton?: Scenario;
}
```

### CLI Usage

```bash
# Suggest based on changed files
afd scenario suggest --context changed-files --files "src/commands/token/add.ts"

# Suggest for uncovered areas
afd scenario suggest --context uncovered

# Suggest for failed scenarios
afd scenario suggest --context failed

# Suggest for a specific command
afd scenario suggest --context command --command "token.add"

# Natural language query
afd scenario suggest --context natural --query "What scenarios should I add for error handling?"

# Include skeleton scenarios
afd scenario suggest --context uncovered --include-skeleton
```

### Implementation

```typescript
// src/commands/suggest.ts

export const scenarioSuggestCommand: CommandDefinition<
  ScenarioSuggestInput,
  ScenarioSuggestOutput
> = {
  name: "scenario.suggest",
  description: "Get AI-powered scenario suggestions",
  category: "testing",

  inputSchema: z.object({
    context: z.enum([
      "changed-files",
      "uncovered",
      "failed",
      "command",
      "natural",
    ]),
    files: z.array(z.string()).optional(),
    command: z.string().optional(),
    query: z.string().optional(),
    limit: z.number().min(1).max(20).default(5),
    includeSkeleton: z.boolean().default(false),
  }),

  async handler(input) {
    const suggestions: ScenarioSuggestion[] = [];

    switch (input.context) {
      case "changed-files":
        suggestions.push(...(await suggestFromChangedFiles(input.files ?? [])));
        break;

      case "uncovered":
        suggestions.push(...(await suggestFromCoverageGaps()));
        break;

      case "failed":
        suggestions.push(...(await suggestFromFailedScenarios()));
        break;

      case "command":
        suggestions.push(...(await suggestForCommand(input.command!)));
        break;

      case "natural":
        suggestions.push(...(await suggestFromQuery(input.query!)));
        break;
    }

    // Sort by priority and confidence
    suggestions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const priorityDiff =
        priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.confidence - a.confidence;
    });

    const limited = suggestions.slice(0, input.limit);

    // Generate skeletons if requested
    if (input.includeSkeleton) {
      for (const suggestion of limited) {
        suggestion.skeleton = generateSkeleton(suggestion);
      }
    }

    return {
      success: true,
      data: {
        suggestions: limited,
        reasoning: generateReasoning(input.context, limited),
      },
    };
  },
};
```

### Suggestion Strategies

#### Changed Files Strategy

```typescript
async function suggestFromChangedFiles(
  files: string[]
): Promise<ScenarioSuggestion[]> {
  const suggestions: ScenarioSuggestion[] = [];

  for (const file of files) {
    // Map file to commands
    const commands = mapFileToCommands(file);

    for (const command of commands) {
      // Check if command has scenarios
      const existingScenarios = await findScenariosForCommand(command);

      if (existingScenarios.length === 0) {
        suggestions.push({
          name: `test-${command.replace(".", "-")}`,
          job: inferJob(command),
          reason: `Command "${command}" modified but has no scenario coverage`,
          confidence: 0.9,
          priority: "high",
        });
      } else {
        // Suggest additional edge case scenarios
        const edges = identifyUncoveredEdgeCases(command, existingScenarios);
        for (const edge of edges) {
          suggestions.push({
            name: `${command.replace(".", "-")}-${edge.name}`,
            job: inferJob(command),
            reason: `Edge case "${edge.name}" not covered for "${command}"`,
            confidence: 0.7,
            priority: "medium",
          });
        }
      }
    }
  }

  return suggestions;
}

function mapFileToCommands(file: string): string[] {
  // src/commands/token/add.ts -> token.add
  // src/commands/node/create.ts -> node.create
  const match = file.match(/src\/commands\/(\w+)\/(\w+)\.ts$/);
  if (match) {
    return [`${match[1]}.${match[2]}`];
  }

  // Check for multi-command files
  // src/commands/token/index.ts -> token.*
  if (file.includes("/commands/") && file.endsWith("index.ts")) {
    const category = file.match(/commands\/(\w+)/)?.[1];
    if (category) {
      return getCommandsInCategory(category);
    }
  }

  return [];
}
```

#### Coverage Gap Strategy

```typescript
async function suggestFromCoverageGaps(): Promise<ScenarioSuggestion[]> {
  const coverage = await calculateCoverage();
  const suggestions: ScenarioSuggestion[] = [];

  // Uncovered commands (high priority)
  for (const command of coverage.uncoveredCommands) {
    suggestions.push({
      name: `test-${command.replace(".", "-")}`,
      job: inferJob(command),
      reason: `Command "${command}" has 0% coverage`,
      confidence: 0.95,
      priority: "high",
    });
  }

  // Untested error codes (medium priority)
  for (const errorCode of coverage.untestedErrors) {
    suggestions.push({
      name: `error-${errorCode.toLowerCase().replace(/_/g, "-")}`,
      job: "error-handling",
      reason: `Error code "${errorCode}" never triggered in tests`,
      confidence: 0.8,
      priority: "medium",
    });
  }

  // Uncovered jobs (low priority - might be intentional)
  for (const job of coverage.uncoveredJobs) {
    suggestions.push({
      name: `job-${job}`,
      job: job,
      reason: `Job "${job}" has no scenarios`,
      confidence: 0.6,
      priority: "low",
    });
  }

  return suggestions;
}
```

#### Failed Scenario Strategy

```typescript
async function suggestFromFailedScenarios(): Promise<ScenarioSuggestion[]> {
  const history = await loadRunHistory();
  const failed = history.filter((r) => r.status === "failed");
  const suggestions: ScenarioSuggestion[] = [];

  for (const result of failed) {
    // Suggest regression scenario
    suggestions.push({
      name: `regression-${result.scenario}`,
      job: "regression",
      reason: `"${result.scenario}" failed - create focused regression test`,
      confidence: 0.85,
      priority: "high",
    });

    // Suggest related scenarios
    const related = findRelatedCommands(result.failedStep?.command);
    for (const command of related) {
      suggestions.push({
        name: `related-${command.replace(".", "-")}`,
        job: inferJob(command),
        reason: `Related to failed step in "${result.scenario}"`,
        confidence: 0.6,
        priority: "medium",
      });
    }
  }

  return suggestions;
}
```

---

## Agent Workflow Integration

### Example: AI Agent Test Workflow

```
User: "Run tests for my recent changes"

Agent thinking:
1. Get changed files
2. Suggest relevant scenarios
3. Run those scenarios
4. Report results

Agent actions:
1. scenario.suggest --context changed-files --files [changed files]
2. scenario.evaluate --scenarios [suggested] --cli "violet --memory"
3. scenario.report --format terminal
```

### Example: AI Agent Gap Analysis

```
User: "What tests am I missing?"

Agent thinking:
1. Check coverage
2. Identify gaps
3. Suggest scenarios with skeletons

Agent actions:
1. scenario.coverage --cli "violet --memory"
2. scenario.suggest --context uncovered --include-skeleton
3. Present suggestions with skeletons
```

### Example: AI Agent Debug Workflow

```
User: "Why did my tests fail?"

Agent thinking:
1. Get failed scenarios
2. Analyze failure details
3. Suggest fixes or new scenarios

Agent actions:
1. scenario.list --status failed
2. scenario.run --scenario [failed] --verbose
3. scenario.suggest --context failed
```

---

## Agent-Friendly Output

### Step-Level Confidence

Each step result includes `confidence` and `reasoning` propagated from the command output:

```typescript
interface StepResult {
  // ... other fields
  confidence?: number;  // 0-1, from command output
  reasoning?: string;   // Explains what command did
}
```

**Agent use cases:**

| Scenario | Agent Action |
|----------|--------------|
| Step has `confidence < 0.7` | Flag for human review |
| Multiple low-confidence steps | Suggest scenario refinement |
| AI-generated command failed | Use reasoning to diagnose |

**Example step result with confidence:**

```json
{
  "index": 2,
  "command": "token override --node xbox --token color.accent.primary --value \"#107C10\"",
  "status": "passed",
  "duration": 45,
  "confidence": 0.95,
  "reasoning": "Overrode color.accent.primary from ancestor 'global-base' value '#0078D4' to '#107C10'"
}
```

### \_agentHints Field

Every command result includes hints for AI agents:

```typescript
interface AgentHints {
  /** Should the agent retry this command? */
  shouldRetry: boolean;

  /** Related commands to consider */
  relatedCommands: string[];

  /** Suggested next actions */
  nextSteps: string[];

  /** Confidence in result interpretation */
  interpretationConfidence: number;

  /** Steps with low confidence that may need review */
  lowConfidenceSteps?: number[];
}
```

### Example Output

```json
{
  "success": true,
  "data": {
    "report": {
      "passed": 8,
      "failed": 1,
      "total": 9
    }
  },
  "reasoning": "8/9 scenarios passed. 1 failure in error-handling.",
  "_agentHints": {
    "shouldRetry": false,
    "relatedCommands": ["scenario.suggest --context failed"],
    "nextSteps": [
      "Review failed scenario: invalid-parent",
      "Run with --verbose for details",
      "Consider scenario.suggest for improvement ideas"
    ],
    "interpretationConfidence": 0.95
  }
}
```

---

## Test Cases

| Test                       | Description                           |
| -------------------------- | ------------------------------------- |
| `mcp-tools.test.ts`        | Tool registration, handler invocation |
| `suggest-changed.test.ts`  | Changed files strategy                |
| `suggest-coverage.test.ts` | Coverage gap strategy                 |
| `suggest-failed.test.ts`   | Failed scenario strategy              |
| `agent-hints.test.ts`      | Agent hint generation                 |

---

## Files to Create/Update

```
packages/testing/src/
├── mcp/
│   ├── server.ts          # NEW
│   ├── tools.ts           # NEW
│   └── hints.ts           # NEW (agent hints)
├── commands/
│   ├── suggest.ts         # NEW
│   └── index.ts           # UPDATE
├── strategies/
│   ├── changed-files.ts   # NEW
│   ├── coverage-gaps.ts   # NEW
│   ├── failed-scenarios.ts # NEW
│   └── command-mapping.ts # NEW
└── utils/
    └── file-to-command.ts # NEW
```

---

## Dependencies

**Blocks**: Phase 4 (Multi-App Support)

**Blocked by**: Phase 2 (Full Command Suite)

**New dependencies**:

- `@modelcontextprotocol/sdk` - MCP SDK

---

## Estimated Effort

| Task                   | Estimate      |
| ---------------------- | ------------- |
| MCP server integration | 3 hours       |
| MCP tool generation    | 2 hours       |
| scenario.suggest       | 4 hours       |
| Suggestion strategies  | 4 hours       |
| Agent hints system     | 2 hours       |
| Tests                  | 3 hours       |
| **Total**              | **~18 hours** |

---

## Next Phase

After Phase 3:

- [Phase 4: Multi-App Support](./04-multi-app.plan.md)
