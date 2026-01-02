# 01 - AFD Schema Layer

> **Goal**: Extend AFD's MCP server with schema discovery tools that enable external systems (Figma, documentation generators) to understand available commands.

## Current State

AFD's MCP server currently exposes commands as **callable tools**:

```typescript
// Current: Commands can be invoked
server.tool("todo.create", { ... });
server.tool("todo.list", { ... });
```

This enables **execution** but not **discovery**. External systems can call commands but can't introspect them programmatically.

## Required: Schema Discovery Layer

### New MCP Tools

Add these meta-tools to `@afd/server`:

#### 1. `schema.list` — List all available commands

```typescript
server.tool("schema.list", {
  description: "List all registered commands with basic metadata",
  schema: z.object({
    category: z.string().optional().describe("Filter by category prefix (e.g., 'todo')"),
    includeDeprecated: z.boolean().default(false),
  }),
  handler: async ({ category, includeDeprecated }) => {
    const commands = registry.list({ category, includeDeprecated });
    
    return {
      success: true,
      data: {
        commands: commands.map(cmd => ({
          name: cmd.name,
          category: cmd.name.split('.')[0],
          description: cmd.description,
          deprecated: cmd.deprecated ?? false,
          tags: cmd.tags ?? [],
        })),
        total: commands.length,
      },
    };
  },
});
```

**Example Response**:
```json
{
  "success": true,
  "data": {
    "commands": [
      { "name": "todo.create", "category": "todo", "description": "Creates a new todo item", "deprecated": false, "tags": ["mutation", "core"] },
      { "name": "todo.list", "category": "todo", "description": "Lists all todos", "deprecated": false, "tags": ["query", "core"] },
      { "name": "todo.delete", "category": "todo", "description": "Deletes a todo by ID", "deprecated": false, "tags": ["mutation", "destructive"] }
    ],
    "total": 3
  }
}
```

#### 2. `schema.describe` — Get detailed schema for a command

```typescript
server.tool("schema.describe", {
  description: "Get full schema details for a specific command",
  schema: z.object({
    name: z.string().describe("Command name (e.g., 'todo.create')"),
    format: z.enum(["json-schema", "typescript", "openapi"]).default("json-schema"),
  }),
  handler: async ({ name, format }) => {
    const command = registry.get(name);
    if (!command) {
      return {
        success: false,
        error: { code: "COMMAND_NOT_FOUND", message: `Command '${name}' not found` },
      };
    }
    
    const inputSchema = zodToFormat(command.inputSchema, format);
    const outputSchema = zodToFormat(command.outputSchema, format);
    
    return {
      success: true,
      data: {
        name: command.name,
        description: command.description,
        category: command.name.split('.')[0],
        input: {
          schema: inputSchema,
          required: getRequiredFields(command.inputSchema),
          defaults: getDefaultValues(command.inputSchema),
        },
        output: {
          schema: outputSchema,
          uxFields: command.uxFields ?? ["confidence", "reasoning", "sources", "warnings"],
        },
        examples: command.examples ?? [],
        sideEffects: command.sideEffects ?? [],
        tags: command.tags ?? [],
      },
    };
  },
});
```

**Example Response**:
```json
{
  "success": true,
  "data": {
    "name": "todo.create",
    "description": "Creates a new todo item",
    "category": "todo",
    "input": {
      "schema": {
        "type": "object",
        "properties": {
          "title": { "type": "string", "minLength": 1, "description": "The todo title" },
          "priority": { "type": "string", "enum": ["high", "medium", "low"], "default": "medium" }
        },
        "required": ["title"]
      },
      "required": ["title"],
      "defaults": { "priority": "medium" }
    },
    "output": {
      "schema": { "$ref": "#/definitions/Todo" },
      "uxFields": ["confidence", "warnings"]
    },
    "examples": [
      { "input": { "title": "Buy groceries" }, "description": "Simple todo" },
      { "input": { "title": "Urgent task", "priority": "high" }, "description": "High priority" }
    ],
    "sideEffects": ["Creates database record", "May trigger notifications"],
    "tags": ["mutation", "core"]
  }
}
```

#### 3. `schema.export` — Bulk export for documentation/tooling

```typescript
server.tool("schema.export", {
  description: "Export all schemas in a format suitable for tooling",
  schema: z.object({
    format: z.enum(["openapi", "json-schema", "figma"]).default("openapi"),
    category: z.string().optional(),
  }),
  handler: async ({ format, category }) => {
    const commands = registry.list({ category });
    
    if (format === "openapi") {
      return { success: true, data: generateOpenAPISpec(commands) };
    }
    
    if (format === "figma") {
      // Figma-optimized format with UI hints
      return {
        success: true,
        data: {
          version: "1.0",
          commands: commands.map(cmd => ({
            name: cmd.name,
            description: cmd.description,
            inputs: generateFigmaInputSpec(cmd.inputSchema),
            outputs: generateFigmaOutputSpec(cmd.outputSchema),
            uiHints: {
              formType: inferFormType(cmd), // "simple" | "wizard" | "modal"
              primaryAction: cmd.name.includes("create") ? "Create" : 
                            cmd.name.includes("delete") ? "Delete" : "Submit",
              destructive: cmd.tags?.includes("destructive") ?? false,
              requiresConfirmation: cmd.sideEffects?.length > 0,
            },
          })),
        },
      };
    }
    
    // Default: JSON Schema bundle
    return {
      success: true,
      data: {
        $schema: "http://json-schema.org/draft-07/schema#",
        definitions: Object.fromEntries(
          commands.map(cmd => [cmd.name, zodToJsonSchema(cmd.inputSchema)])
        ),
      },
    };
  },
});
```

#### 4. `schema.uxPatterns` — UX field definitions

```typescript
server.tool("schema.uxPatterns", {
  description: "Get UX pattern definitions for CommandResult fields",
  schema: z.object({}),
  handler: async () => {
    return {
      success: true,
      data: {
        patterns: {
          confidence: {
            type: "number",
            range: [0, 1],
            uiGuidance: {
              "0.9-1.0": { display: "high-confidence", autoApplySafe: true },
              "0.7-0.9": { display: "medium-confidence", showAsRecommendation: true },
              "0.5-0.7": { display: "low-confidence", requireConfirmation: true },
              "0-0.5": { display: "uncertain", showAlternatives: true },
            },
          },
          reasoning: {
            type: "string",
            uiGuidance: { display: "expandable", label: "Why this result?" },
          },
          sources: {
            type: "array",
            uiGuidance: { display: "citation-list", verifiable: true },
          },
          warnings: {
            type: "array",
            uiGuidance: {
              info: { display: "subtle-banner", color: "blue" },
              warning: { display: "alert-banner", color: "yellow" },
              caution: { display: "alert-banner", color: "orange" },
            },
          },
          alternatives: {
            type: "array",
            uiGuidance: { display: "option-cards", selectable: true },
          },
          plan: {
            type: "array",
            uiGuidance: { display: "stepper", showProgress: true },
          },
        },
        designTokens: {
          confidence: {
            high: "var(--color-success)",
            medium: "var(--color-warning)",
            low: "var(--color-caution)",
          },
        },
      },
    };
  },
});
```

## Implementation Details

### File: `packages/server/src/schema-tools.ts`

```typescript
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { CommandRegistry } from "./registry";

export function registerSchemaTools(server: McpServer, registry: CommandRegistry) {
  // schema.list
  server.tool("schema.list", { /* ... */ });
  
  // schema.describe  
  server.tool("schema.describe", { /* ... */ });
  
  // schema.export
  server.tool("schema.export", { /* ... */ });
  
  // schema.uxPatterns
  server.tool("schema.uxPatterns", { /* ... */ });
}
```

### File: `packages/server/src/schema-utils.ts`

```typescript
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export function zodToFormat(schema: z.ZodType, format: string) {
  switch (format) {
    case "json-schema":
      return zodToJsonSchema(schema);
    case "typescript":
      return zodToTypeScript(schema);
    case "openapi":
      return zodToOpenAPI(schema);
    default:
      return zodToJsonSchema(schema);
  }
}

export function getRequiredFields(schema: z.ZodObject<any>): string[] {
  // Extract required fields from Zod schema
}

export function getDefaultValues(schema: z.ZodObject<any>): Record<string, unknown> {
  // Extract default values from Zod schema
}

export function inferFormType(command: CommandDefinition): "simple" | "wizard" | "modal" {
  const fieldCount = Object.keys(command.inputSchema.shape).length;
  if (fieldCount <= 3) return "simple";
  if (fieldCount <= 6) return "modal";
  return "wizard";
}

export function generateFigmaInputSpec(schema: z.ZodType) {
  // Convert Zod schema to Figma-friendly format with UI hints
  // - string → TextInput
  // - enum → Select/RadioGroup
  // - boolean → Toggle
  // - number → NumberInput
  // - array → List/MultiSelect
  // - object → Nested form group
}
```

## Command Metadata Extensions

Extend `CommandDefinition` to include Figma-relevant metadata:

```typescript
interface CommandDefinition<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
  handler: (input: TInput) => Promise<CommandResult<TOutput>>;
  
  // Existing optional fields
  tags?: string[];
  deprecated?: boolean;
  
  // New: UX-enabling metadata
  uxFields?: Array<"confidence" | "reasoning" | "sources" | "warnings" | "alternatives" | "plan">;
  examples?: Array<{ input: TInput; description: string }>;
  sideEffects?: string[];
  
  // New: Figma integration hints
  figma?: {
    suggestedComponent?: string; // "Form" | "Card" | "Modal" | "Inline"
    primaryActionLabel?: string;
    successMessage?: string;
    icon?: string; // Figma icon name
  };
}
```

## CLI Integration

Add schema commands to `afd` CLI:

```bash
# List all commands
afd schema list
afd schema list --category todo

# Describe a command
afd schema describe todo.create
afd schema describe todo.create --format typescript

# Export schemas
afd schema export --format openapi > openapi.json
afd schema export --format figma > figma-commands.json

# Validate schemas
afd schema validate
```

## Testing

```typescript
// packages/server/src/__tests__/schema-tools.test.ts

describe("schema.list", () => {
  it("returns all registered commands", async () => {
    const result = await client.call("schema.list", {});
    expect(result.success).toBe(true);
    expect(result.data.commands).toHaveLength(expectedCount);
  });
  
  it("filters by category", async () => {
    const result = await client.call("schema.list", { category: "todo" });
    expect(result.data.commands.every(c => c.category === "todo")).toBe(true);
  });
});

describe("schema.describe", () => {
  it("returns full schema for valid command", async () => {
    const result = await client.call("schema.describe", { name: "todo.create" });
    expect(result.success).toBe(true);
    expect(result.data.input.schema).toBeDefined();
    expect(result.data.output.uxFields).toContain("confidence");
  });
  
  it("returns error for unknown command", async () => {
    const result = await client.call("schema.describe", { name: "fake.command" });
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("COMMAND_NOT_FOUND");
  });
});
```

## Dependencies

```json
{
  "dependencies": {
    "zod-to-json-schema": "^3.22.0",
    "openapi3-ts": "^4.2.0"
  }
}
```

## Success Criteria

- [ ] `schema.list` returns all commands with metadata
- [ ] `schema.describe` returns full schema with examples
- [ ] `schema.export` generates valid OpenAPI 3.0 spec
- [ ] `schema.export --format figma` generates Figma-optimized format
- [ ] `schema.uxPatterns` returns UX guidance for all CommandResult fields
- [ ] CLI commands work for all schema operations
- [ ] 100% test coverage on schema tools

---

**Next**: [02-figma-plugin.md](./02-figma-plugin.md) — Bringing schemas into Figma
