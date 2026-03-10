# Lazy-Loading Discovery Specification

> A third tool strategy for AFD MCP servers that defers schema loading until the agent requests it, keeping enumeration cost constant regardless of command count.

## Summary

Add a `'lazy'` tool strategy to `createMcpServer` that exposes two lightweight meta-tools (`afd-discover` and `afd-detail`) instead of enumerating every command as an individual MCP tool. Agents browse the catalog with `afd-discover`, drill into specific commands with `afd-detail`, then invoke them via `afd-call`. This keeps context consumption flat as the command set scales.

`afd-call` is a **universal dispatcher** available in all strategies — agents get a consistent calling convention regardless of how the server is configured.

## User Value

- **Constant context cost** — Lazy enumeration returns 5 tools (3 strategy-specific + `afd-batch` + `afd-pipe`) regardless of whether the server has 5 or 500 commands
- **Agent autonomy** — Agents choose their own depth: browse → inspect → call
- **Portable agent code** — `afd-call` works in all strategies, so agents never break when a server migrates between strategies
- **No degradation for simple cases** — The existing `individual` and `grouped` strategies remain fully supported
- **Backward compatible** — No changes to `ZodCommandDefinition`, `CommandResult`, or `createMcpServer`'s required fields
- **Self-describing** — Discovery and detail responses are `CommandResult` objects with reasoning, confidence, and metadata

## User Stories

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-1 | Server author | Choose `toolStrategy: 'lazy'` | My 80-command server doesn't flood the agent's context |
| US-2 | Agent | List available commands with one-line summaries | I can decide which command to inspect further |
| US-3 | Agent | Get the full schema for one or more commands | I have the exact input shape before calling them |
| US-4 | Agent | Invoke a command by name without pre-loading its schema | I can act on `afd-detail` output immediately |
| US-5 | Server author | Mix lazy discovery with the existing bootstrap tools | `afd-help`, `afd-docs`, `afd-schema` still work |
| US-6 | Agent | Filter the catalog by category or tag | I can narrow the list before inspecting individual commands |
| US-7 | Agent | Use `afd-call` regardless of server strategy | My dispatch code doesn't change when the server switches strategies |

---

## Functional Requirements

### FR-1: New Tool Strategy — `'lazy'`

Extend the `toolStrategy` option in `McpServerOptions`:

```typescript
interface McpServerOptions {
  // ... existing fields unchanged
  toolStrategy?: 'individual' | 'grouped' | 'lazy'; // default: 'grouped'
}
```

When `toolStrategy: 'lazy'`, the server registers exactly five MCP tools:

| Tool | MCP description | Present in lazy | Present in all strategies |
|------|---------|:---:|:---:|
| `afd-discover` | List available commands with optional filtering by category, tag, or search text. Returns compact summaries. | Yes | — |
| `afd-detail` | Get the full input schema and metadata for one or more commands by name. | Yes | — |
| `afd-call` | Invoke any command by name with runtime input validation. Works in all server strategies. | Yes | Yes |
| `afd-batch` | Execute multiple commands in a single request with partial-success semantics. | Yes | Yes |
| `afd-pipe` | Execute a pipeline of chained commands where output flows between steps. | Yes | Yes |

`afd-call` is registered in **all** strategies. It provides a uniform dispatch API that decouples agent code from the server's tool strategy. In `individual` and `grouped` modes, agents can use either the strategy-native tools or `afd-call` — both paths execute through the same middleware chain.

### FR-2: `afd-discover` Command

Returns a lightweight catalog of registered commands with pagination.

**Input schema:**

```typescript
const discoverInput = z.object({
  /** Filter commands by category */
  category: z.string().optional(),

  /** Filter commands by tag(s). String for single tag, array for multiple. */
  tag: z.union([z.string(), z.array(z.string())]).optional(),

  /** Tag matching mode when multiple tags are provided */
  tagMode: z.enum(['all', 'any']).optional().default('any'),

  /** Text search across command names and descriptions */
  search: z.string().optional(),

  /** Include mutation/read-only classification */
  includeMutation: z.boolean().optional().default(false),

  /** Maximum number of results to return */
  limit: z.number().int().min(1).max(200).optional().default(50),

  /** Number of results to skip (for pagination) */
  offset: z.number().int().min(0).optional().default(0),
});
```

**Output type:**

```typescript
interface DiscoverResult {
  commands: CommandSummary[];
  total: number;
  filtered: number;
  returned: number;
  hasMore: boolean;
  /** All categories across all commands (not just filtered results) */
  availableCategories: string[];
  /** All tags across all commands (not just filtered results) */
  availableTags: string[];
}

interface CommandSummary {
  /** Command name (kebab-case) */
  name: string;

  /** One-line description */
  description: string;

  /** Category for grouping */
  category?: string;

  /** Whether this command mutates state */
  mutation?: boolean; // only present when includeMutation: true
}
```

**CommandResult wrapping:**

```typescript
return success<DiscoverResult>(
  { commands, total, filtered, returned, hasMore, availableCategories, availableTags },
  {
    reasoning: `Returned ${returned} of ${filtered} matching commands (${total} total)${
      category ? ` in category '${category}'` : ''
    }${hasMore ? `. Use offset: ${offset + limit} to see more.` : ''}`,
    confidence: 1.0,
    metadata: { executionTimeMs },
  },
);
```

**Design decisions:**
- Descriptions are capped at the first sentence (or 120 characters) to keep the response compact. The full description is available via `afd-detail`.
- Tags are omitted from individual summaries to reduce payload. The top-level `availableTags` array exposes the full taxonomy so agents can discover available tag values for filtering.
- Categories are included as a top-level `availableCategories` array so agents can discover the taxonomy without a separate call. Both `availableTags` and `availableCategories` reflect all commands (not just filtered results), so agents always see the full taxonomy.
- Default limit of 50 prevents unbounded payloads. At ~30 tokens per summary, this caps `afd-discover` responses at ~1,500 tokens for the command list.
- Tag filtering uses `tagMode: 'any'` by default, matching the semantics of `CommandRegistry.listByTags()` in `@lushly-dev/afd-core`.

**Category derivation:** Commands without an explicit `category` use the first segment of the command name (e.g., `todo-create` → `todo`), consistent with the grouped strategy's `defaultGroupFn`. Commands with no hyphen and no category use the full command name as the category (e.g., `analytics` → `analytics`). The `'general'` fallback only applies to the edge case of an empty-string name.

**Expose filtering:** All commands in the server's `commands` array are included in `afd-discover` results. Commands registered via the `CommandRegistry` directly (outside `createMcpServer`) are not included. See FR-7 for the full expose model.

### FR-3: `afd-detail` Command

Returns the full definition and schema for one or more commands.

**Input schema:**

```typescript
const detailInput = z.object({
  /** Command name or names (exact match, kebab-case) */
  command: z.union([
    z.string().min(1),
    z.array(z.string().min(1)).min(1).max(10),
  ]),
});
```

The response is always an array of `DetailEntry` objects (preserving input order), even when `command` is a single string. This keeps the output schema consistent and simplifies agent parsing. Agents batch schema retrieval after a filtered `afd-discover` call, reducing round-trips.

**Output type:**

```typescript
/** Union type: resolved commands return DetailResult, unknown names return DetailError */
type DetailEntry = DetailResult | DetailError;

interface DetailResult {
  name: string;
  found: true;
  description: string;
  category?: string;
  tags?: string[];
  mutation: boolean;
  executionTime?: 'instant' | 'fast' | 'slow' | 'long-running';
  errors?: string[];
  inputSchema: JsonSchema;
  destructive?: boolean;
  confirmPrompt?: string;
  handoff?: boolean;
  handoffProtocol?: string;
  version?: string;
  /** Whether this command is invocable via afd-call (present in server's commands array) */
  callable: boolean;
}

interface DetailError {
  name: string;
  found: false;
  error: CommandError; // code: 'COMMAND_NOT_FOUND', with suggestion
}
```

**Error behavior:**

If a command name doesn't match any registered command, the entry includes a `COMMAND_NOT_FOUND` error with fuzzy-match suggestions:

```typescript
// Entry in the results array for an unknown command
{
  name: input.command,
  found: false,
  error: {
    code: 'COMMAND_NOT_FOUND',
    message: `No command named '${input.command}'`,
    suggestion: `Did you mean '${closestMatch}'? Use afd-discover to list all commands.`,
  },
}
```

Each unresolved name produces a `DetailError` entry in the response array (the batch does not fail entirely). Resolved commands return their `DetailResult` normally. The `found` discriminant lets agents distinguish results without type-checking the full shape.

**Expose filtering:** `afd-detail` works for any registered command regardless of whether it was included in the server's `commands` array. Schema introspection is always read-only and safe to expose. A `callable` field in the response indicates whether the command is invocable via `afd-call` (i.e., present in the server's `commands` array).

### FR-4: `afd-call` Command

A universal dispatcher that invokes any registered command by name. Available in **all** tool strategies.

**Input schema:**

```typescript
const callInput = z.object({
  /** Command name to invoke */
  command: z.string().min(1),

  /** Command input (validated against the command's own schema at runtime) */
  input: z.record(z.unknown()).optional().default({}),
});
```

> **Naming:** Uses `input` (not `params`) to match `afd-batch` and `afd-pipe` conventions. (`DirectClient.call()` uses `args` internally, but `input` is the MCP-facing convention.)

**Behavior:**

1. Look up the command by name in the registry.
2. Validate `input` against the command's Zod input schema.
3. Execute the handler with the current `CommandContext`.
4. Return the handler's `CommandResult` directly (no wrapping).

**Error behavior:**

- Unknown command → `COMMAND_NOT_FOUND` with fuzzy suggestions (same as `afd-detail`).
- Validation failure → `VALIDATION_ERROR` with the Zod error details and a suggestion to call `afd-detail` for the correct schema.
- Exposure violation → `COMMAND_NOT_EXPOSED` when the command exists in the registry but was not included in the server's `commands` array.

```typescript
return failure({
  code: 'VALIDATION_ERROR',
  message: `Invalid input for '${input.command}': ${zodError.message}`,
  suggestion: `Call afd-detail with command '${input.command}' to see the expected input schema.`,
});
```

**Middleware:** `afd-call` runs the command through the full middleware chain, identical to how individual tools execute. Timing, logging, tracing, and rate-limiting all apply.

**Relationship to `afd-batch`:** `afd-call` is the single-command entry point. `afd-batch` handles multiple commands with partial-success semantics. An agent can use either for a single command — `afd-call` has a simpler schema and clearer intent. There is no functional difference in execution; both paths dispatch through the same registry and middleware.

### FR-5: Interaction with Existing Strategies

| Strategy | `afd-discover` | `afd-detail` | `afd-call` | Individual tools | Grouped tools |
|----------|:-:|:-:|:-:|:-:|:-:|
| `'individual'` | — | — | ✅ | ✅ | — |
| `'grouped'` | — | — | ✅ | — | ✅ |
| `'lazy'` | ✅ | ✅ | ✅ | — | — |

- `afd-call` is present in **all** strategies. It adds one tool (~100 tokens) to `individual` and `grouped` — negligible cost for the benefit of a uniform dispatch API.
- `afd-batch` and `afd-pipe` remain available in all strategies.
- Bootstrap commands (`afd-help`, `afd-docs`, `afd-schema`) are orthogonal. They are added by the consumer, not by the strategy, so they work alongside any strategy.

### FR-6: Interaction with Contextual Tool Loading

The proposed [contextual-tool-loading](../contextual-tool-loading/contextual-tool-loading.proposal.md) feature scopes commands by runtime context. If both features are active:

- `afd-discover` respects the active context. Only commands in the current context are listed.
- `afd-detail` works for any command regardless of context (read-only introspection).
- `afd-call` only dispatches commands in the active context. Attempting to call an out-of-context command returns `CONTEXT_MISMATCH` with a suggestion to enter the correct context.

This interaction is not required for the initial implementation. It is documented here for forward compatibility.

### FR-7: Expose Filtering

**Implicit MCP exposure:** Commands passed to `createMcpServer` via the `commands` array are implicitly MCP-exposed, regardless of their `ExposeOptions.mcp` setting. The server author already chose to expose them by including them. This matches the existing behavior of the `individual` and `grouped` strategies, which register all commands as MCP tools without checking `expose`.

This means switching from `toolStrategy: 'grouped'` to `'lazy'` never silently hides commands. The `ExposeOptions` system remains available for commands registered via the `CommandRegistry` directly (outside `createMcpServer`), where the registry's `listByExposure('mcp')` filtering applies.

If a server author wants to exclude specific commands from MCP discovery, they should omit them from the `commands` array rather than relying on `expose.mcp: false`.

| Tool | Filtering behavior |
|------|-------------------|
| `afd-discover` | Lists all commands in the `commands` array |
| `afd-detail` | Returns schema for **any** registered command (read-only introspection is always safe). Includes a `callable` field indicating whether the command is invocable via `afd-call`. |
| `afd-call` | Dispatches any command in the `commands` array. Returns `COMMAND_NOT_EXPOSED` if a command exists in the registry but was not included in the server's `commands` array. |

---

## API Design

### Server Configuration

```typescript
import { createMcpServer, defineCommand } from '@lushly-dev/afd-server';

const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands: [cmd1, cmd2, /* ...80 more */],
  toolStrategy: 'lazy',
});
```

No other configuration is needed. The lazy strategy auto-registers `afd-discover`, `afd-detail`, and `afd-call`. (Non-lazy strategies auto-register only `afd-call`.)

### Agent Workflow (Typical)

```
Agent receives a user request
  │
  ├─ 1. afd-discover { search: "user" }
  │     → { commands: [{ name: "user-create", ... }, { name: "user-get", ... }], ... }
  │
  ├─ 2. afd-detail { command: ["user-create", "user-get"] }
  │     → [{ name: "user-create", found: true, callable: true, inputSchema: { ... } }, ...]
  │
  └─ 3. afd-call { command: "user-create", input: { name: "Alice", email: "a@b.com" } }
        → { success: true, data: { id: 1, name: "Alice" }, reasoning: "Created user" }
```

An experienced agent that already knows the schema can skip steps 1-2 and call directly.

---

## Examples

### Example 1: Browsing by Category

```typescript
// Agent: "What can this server do?"
const catalog = await call('afd-discover', {});
// → { commands: [...first 50...], availableCategories: ['user', 'order', 'payment'],
//     availableTags: ['crud', 'admin', 'billing'], total: 83, filtered: 83, returned: 50, hasMore: true }

// Agent: "Show me order-related commands"
const orders = await call('afd-discover', { category: 'order' });
// → { commands: [
//      { name: 'order-create', description: 'Create a new order' },
//      { name: 'order-list', description: 'List orders with filters' },
//      { name: 'order-cancel', description: 'Cancel a pending order' },
//    ], total: 83, filtered: 3, returned: 3, hasMore: false,
//    availableCategories: ['user', 'order', 'payment'], availableTags: ['crud', 'admin', 'billing'] }
```

### Example 2: Search Then Batch Inspect

```typescript
// Agent: "How do I cancel something?"
const results = await call('afd-discover', { search: 'cancel' });
// → { commands: [
//      { name: 'order-cancel', description: 'Cancel a pending order' },
//      { name: 'subscription-cancel', description: 'Cancel a subscription' },
//    ], filtered: 2, returned: 2, hasMore: false }

// Batch detail for both results in one call
const details = await call('afd-detail', {
  command: ['order-cancel', 'subscription-cancel'],
});
// → [
//   { name: 'order-cancel', found: true, callable: true, mutation: true, destructive: true,
//     confirmPrompt: 'This will cancel order {orderId}. Continue?',
//     inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] } },
//   { name: 'subscription-cancel', found: true, callable: true, mutation: true, destructive: false,
//     inputSchema: { type: 'object', properties: { subscriptionId: { type: 'string' } }, required: ['subscriptionId'] } },
// ]
```

### Example 3: Typo Recovery

```typescript
const detail = await call('afd-detail', { command: 'order-cancle' });
// → { success: true, data: [
//      { name: 'order-cancle', found: false, error: {
//          code: 'COMMAND_NOT_FOUND',
//          message: "No command named 'order-cancle'",
//          suggestion: "Did you mean 'order-cancel'? Use afd-discover to list all commands."
//      } }
//    ] }
```

### Example 4: Direct Call Without Inspect

```typescript
// Agent already knows the schema from a previous session
const result = await call('afd-call', {
  command: 'user-get',
  input: { id: 42 },
});
// → { success: true, data: { id: 42, name: 'Alice', ... }, confidence: 0.99 }
```

### Example 5: Validation Error with Guidance

```typescript
const result = await call('afd-call', {
  command: 'user-create',
  input: { name: 'Alice' }, // missing required 'email'
});
// → { success: false, error: {
//      code: 'VALIDATION_ERROR',
//      message: "Invalid input for 'user-create': Required field 'email' is missing",
//      suggestion: "Call afd-detail with command 'user-create' to see the expected input schema."
//    } }
```

### Example 6: Tag Filtering

```typescript
// Agent: "Show me commands tagged as admin"
const admin = await call('afd-discover', { tag: 'admin', includeMutation: true });
// → { commands: [
//      { name: 'user-delete', description: 'Delete a user account', mutation: true },
//      { name: 'config-reset', description: 'Reset server configuration', mutation: true },
//    ], filtered: 2, returned: 2, hasMore: false,
//    availableCategories: ['user', 'config'], availableTags: ['admin', 'crud', 'billing', ...] }

// Agent: "Show me commands tagged both 'admin' AND 'billing'"
const adminBilling = await call('afd-discover', {
  tag: ['admin', 'billing'],
  tagMode: 'all',
});
```

### Example 7: Universal `afd-call` (Non-Lazy Strategy)

```typescript
// Server uses 'individual' strategy — each command has its own MCP tool.
// The agent can still use afd-call for a consistent dispatch API:
const result = await call('afd-call', {
  command: 'todo-create',
  input: { title: 'Buy milk' },
});
// → { success: true, data: { id: '...', title: 'Buy milk' }, confidence: 1.0 }

// Equivalent to calling the individual tool directly:
const result2 = await call('todo-create', { title: 'Buy milk' });
// → same result
```

---

## Latency Tradeoffs

The lazy strategy optimizes for **token cost** at the expense of **round-trips**. A typical lazy interaction requires 3 sequential calls (discover → detail → call) versus 1 call with the `individual` strategy.

| Strategy | Round-trips (typical) | Enumeration tokens | Total interaction tokens |
|----------|:---:|:---:|:---:|
| `individual` | 1 | ~12,000 (80 cmds) | ~12,300 |
| `grouped` | 1 | ~4,000 (80 cmds) | ~4,300 |
| `lazy` | 2-3 | ~1,000 (fixed) | ~4,000 |

**Mitigations:**

- **Experienced agents skip `afd-detail`:** Once an agent has seen a schema (even in a prior session), it can call `afd-call` directly. The validation error path is self-correcting — if the schema changed, the error message tells the agent exactly what to do.
- **Batch `afd-detail` reduces calls:** After a filtered discover returns 3 results, the agent fetches all 3 schemas in one call (not three).
- **`afd-call` is available in all strategies:** If an agent knows the command name and schema, it can skip discovery entirely. This makes the lazy flow a **progressive disclosure** pattern — agents pay for discovery only when they need it.
- **Latency is typically dominated by command execution**, not discovery overhead. An `afd-detail` call completes in <1ms (pure schema lookup).

---

## Context Cost Analysis

Comparison across strategies for a server with 80 commands:

| Strategy | Tools enumerated | Approximate tokens per tool | Total context cost |
|----------|:---:|:---:|:---:|
| `individual` | 80 + `afd-call` | ~150 (name + schema) | ~12,100 |
| `grouped` (10 groups) | 10 + `afd-call` | ~400 (action enum + merged schema) | ~4,100 |
| `lazy` | 5 (3 lazy + 2 built-in) | ~200 (fixed schemas) | ~1,000 |

The lazy strategy has a **constant** enumeration cost. The cost scales linearly only when the agent calls `afd-discover` (which returns compact summaries at ~30 tokens per command, capped by `limit`) and `afd-detail` (which loads one or more full schemas on demand).

**Effective cost for a typical interaction (80-command server):**

| Agent action | Tokens consumed |
|---|---:|
| Enumeration (5 tools) | ~1,000 |
| `afd-discover` response (50 of 80 commands, default limit) | ~1,500 |
| `afd-detail` for 2 commands (batched) | ~600 |
| **Total** | **~3,100** |

This beats the grouped strategy at 80 commands and scales much better — at 500 commands, lazy enumeration stays at ~1,000 tokens while individual would consume ~75,000. The `afd-discover` payload grows linearly but is capped by `limit`.

---

## Implementation Notes

### Fuzzy Matching for Command Lookup

Both `afd-detail` and `afd-call` use fuzzy matching when a command name isn't found. The normalized Levenshtein similarity functions are currently implemented as module-local functions in `DirectClient` (`packages/client/src/direct.ts:86-137`) — `calculateSimilarity` and `findSimilarTools` are not exported.

**Prerequisite:** Extract `calculateSimilarity` and `findSimilarTools` to a shared module in `@lushly-dev/afd-core` (e.g., `packages/core/src/similarity.ts`) and re-export from the package. Both `DirectClient` and the lazy strategy tools import from core.

```typescript
// @lushly-dev/afd-core/src/similarity.ts (new shared module)
export { calculateSimilarity, findSimilarTools };

// Usage in lazy tools
import { findSimilarTools } from '@lushly-dev/afd-core';

function findClosestCommands(
  name: string,
  commands: ZodCommandDefinition[],
  maxSuggestions = 3,
): string[] {
  const commandNames = commands.map((cmd) => cmd.name);
  return findSimilarTools(name, commandNames, maxSuggestions);
}
```

The existing implementation uses normalized similarity (1 - distance/maxLen) with a >= 0.4 threshold, which produces better suggestions than raw Levenshtein distance for varying-length command names.

### Description Truncation

`afd-discover` truncates descriptions to the first sentence or 120 characters:

```typescript
function truncateDescription(desc: string, max = 120): string {
  const firstSentence = desc.split(/\.\s/)[0];
  if (firstSentence.length <= max) return firstSentence;
  return desc.slice(0, max - 1) + '…';
}
```

### Category Derivation

Commands without an explicit `category` field use the same fallback as the grouped strategy:

```typescript
function deriveCategory(cmd: ZodCommandDefinition): string {
  return cmd.category || cmd.name.split('-')[0] || 'general';
}
```

This ensures consistent category assignment across strategies. A command named `todo-create` with no explicit category is placed in the `todo` category in both grouped and lazy modes.

### Search Implementation

The `search` filter on `afd-discover` tokenizes the query and requires all tokens to match somewhere in the command name or description (case-insensitive). This handles multi-word queries like `"create user"` matching `"user-create: Create a new user account"` without adding relevance-ranking complexity.

```typescript
function matchesSearch(cmd: ZodCommandDefinition, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const target = `${cmd.name} ${cmd.description}`.toLowerCase();
  return tokens.every((token) => target.includes(token));
}
```

### Registration in the Server Factory

In all strategies, `afd-call` is registered as a built-in tool (alongside `afd-batch` and `afd-pipe`). In the `lazy` strategy, `afd-discover` and `afd-detail` are additionally registered.

```typescript
// Inside createMcpServer
function getToolsList(): MCP.Tool[] {
  const builtInTools = [batchTool, pipeTool, callTool]; // afd-call in all strategies

  if (toolStrategy === 'lazy') {
    const lazyTools = createLazyTools(() => options.commands);
    return [
      ...lazyTools.map(toMcpTool),  // afd-discover, afd-detail
      ...builtInTools.map(toMcpTool),
    ];
  }

  // individual or grouped: strategy-specific tools + built-ins
  return [...strategyTools, ...builtInTools.map(toMcpTool)];
}
```

### Middleware Application

`afd-call` dispatches through the full middleware chain, identical to how individual/grouped tools execute. Timing, logging, tracing, and rate-limiting all apply.

The meta-tools (`afd-discover` and `afd-detail`) are read-only introspection and do **not** run through user-configured middleware. They do record timing in their own `metadata.executionTimeMs`. This is a deliberate choice — introspection should not be blocked by rate-limiting or affected by retry logic. If a server author needs to observe introspection calls, they can use the server's event emitter (e.g., `server.on('tool:call', ...)`) rather than the command middleware chain.

---

## Relationship to Existing Types

| Existing | Lazy-Loading Equivalent |
|----------|------------------------|
| `toolStrategy: 'individual'` | Each command = 1 MCP tool (still supported) |
| `toolStrategy: 'grouped'` | Commands collapsed by category (still supported) |
| `toolStrategy: 'lazy'` | 2 meta-tools + agent drives discovery |
| `afd-call` | Universal dispatcher, available in **all** strategies |
| `afd-help` (bootstrap) | `afd-discover` (strategy-native, always present in lazy) |
| `afd-schema` (bootstrap) | `afd-detail` (per-command, on-demand, always returns array) |
| `afd-batch` | Unchanged, available in all strategies |
| `afd-pipe` | Unchanged, available in all strategies |

### Why not reuse `afd-help` and `afd-schema`?

The bootstrap commands are opt-in extras designed for human-friendly output. The lazy tools are strategy-native, always present, and optimized for agent consumption:

- `afd-help` returns grouped output with optional formatting — richer but heavier.
- `afd-discover` returns a flat list of `CommandSummary` objects — minimal and parseable.
- `afd-schema` returns all schemas at once — the opposite of lazy.
- `afd-detail` returns one or more schemas on demand — lazy by design.

If a server author includes bootstrap commands alongside the lazy strategy, both work fine. There is no conflict.

---

## Out of Scope

- **Hybrid strategy** (lazy + selected individual tools) — A future enhancement could allow marking specific high-frequency commands for individual registration while keeping the rest lazy. Deferred to avoid complexity.
- **Schema caching hints** — Telling agents "this schema hasn't changed since last session" via ETags or version hashes. Interesting but depends on MCP protocol extensions.
- **Streaming discover** — Streaming very large catalogs beyond what `limit`/`offset` pagination handles. Unnecessary until command counts exceed ~1000.
- **Contextual scoping** — Filtering `afd-discover` by active context is documented for forward compatibility (FR-6) but not implemented in this phase.

---

## Success Criteria

- [ ] `toolStrategy: 'lazy'` option accepted by `createMcpServer`
- [ ] `afd-call` registered as a built-in tool in **all** strategies
- [ ] `afd-discover` command implemented with category, tag (single and array), search (tokenized), and pagination filters
- [ ] `afd-discover` returns top-level `availableCategories` and `availableTags` arrays for taxonomy discovery
- [ ] `afd-discover` lists all commands in the server's `commands` array (implicit MCP exposure)
- [ ] `afd-detail` always returns an array of `DetailEntry` objects (even for single command input)
- [ ] `afd-detail` includes `found` discriminant and `callable` field in results
- [ ] `afd-detail` returns fuzzy-match suggestions for unknown command names
- [ ] `afd-call` command implemented with runtime Zod validation, middleware dispatch, and exposure checking
- [ ] `afd-call` returns `COMMAND_NOT_EXPOSED` for registry commands not in the server's `commands` array
- [ ] All three commands return `CommandResult` with reasoning, confidence, and metadata
- [ ] `afd-batch` and `afd-pipe` remain functional alongside the lazy strategy
- [ ] Context cost stays constant at enumeration time (5 tools in lazy mode)
- [ ] `calculateSimilarity` and `findSimilarTools` extracted to `@lushly-dev/afd-core`
- [ ] Unit tests for `afd-discover` filtering (category, tag, tagMode, search, pagination)
- [ ] Unit tests for `afd-detail` with valid name, invalid name, batch input, and mixed batch (found + not-found)
- [ ] Unit tests for `afd-call` with valid input, invalid input, unknown command, and exposure violation
- [ ] Unit test for `afd-call` in non-lazy strategies (individual, grouped)
- [ ] Unit test confirming all commands are discoverable without explicit `expose.mcp` setting
- [ ] Integration test: full discover → detail → call workflow
- [ ] Integration test: `afd-call` works identically across all three strategies
- [ ] Documentation updated in `afd-help` output and README
