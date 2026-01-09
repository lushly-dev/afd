# Command Pipeline Specification

> Chain commands where the output of one becomes the input of the next.

## Summary

Add first-class support for command pipelines to AFD, enabling declarative composition of commands without manual result threading.

## User Value

- **Reduce boilerplate** — No manual result extraction between commands
- **Declarative chains** — Express workflows as data, not imperative code
- **Error propagation** — Chain breaks on first failure with actionable suggestions
- **Agent-friendly** — Pipelines are self-describing, easy for AI to reason about
- **Trust signals preserved** — Confidence, reasoning, sources flow through entire pipeline
- **Transport agnostic** — Works identically over Direct, stdio, HTTP/SSE transports

## User Stories

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-1 | Developer | Chain multiple commands declaratively | I don't write boilerplate result threading |
| US-2 | Agent | Define multi-step workflows as data | I can reason about the entire pipeline |
| US-3 | API consumer | Get aggregated confidence scores | I know overall reliability of the chain |
| US-4 | Developer | Short-circuit on failure with suggestions | I know how to fix errors |
| US-5 | Agent | See reasoning from each step | I understand the logic of the entire flow |

---

## Functional Requirements

### FR-1: PipelineRequest Type

```typescript
interface PipelineRequest {
  /** Unique identifier for the pipeline execution */
  id?: string;
  
  /** Ordered list of pipeline steps */
  steps: PipelineStep[];
  
  /** Pipeline-level options */
  options?: PipelineOptions;
}

interface PipelineStep {
  /** Command name to execute */
  command: string;
  
  /** Input for this step. Can reference $prev, $first, or $steps[n] */
  input?: Record<string, unknown>;
  
  /** Optional alias for referencing this step's output */
  as?: string;
  
  /** Condition for running this step */
  when?: PipelineCondition;
  
  /** Enable streaming for this step */
  stream?: boolean;
}

interface PipelineOptions {
  /** Continue on failure or stop immediately */
  continueOnFailure?: boolean;
  
  /** Timeout for entire pipeline */
  timeoutMs?: number;
  
  /** Execute steps in parallel where dependencies allow */
  parallel?: boolean;
  
  /** Callback for streaming progress */
  onProgress?: (chunk: StreamChunk, stepIndex: number) => void;
}
```

### FR-2: Variable Resolution

Pipeline steps can reference outputs from previous steps:

| Variable | Resolves to |
|----------|------------|
| `$prev` | Output of immediately previous step |
| `$prev.field` | Specific field from previous output |
| `$first` | Output of first step |
| `$steps[n]` | Output of step at index n |
| `$steps.alias` | Output of step with matching `as` alias |
| `$input` | Original pipeline input |

**Example:**
```typescript
const pipeline: PipelineRequest = {
  steps: [
    { command: 'user-get', input: { id: 123 }, as: 'user' },
    { command: 'order-list', input: { userId: '$prev.id' } },
    { command: 'order-summarize', input: { 
      orders: '$prev', 
      userName: '$steps.user.name' 
    }}
  ]
};
```

### FR-3: PipelineResult Type

```typescript
interface PipelineResult<T = unknown> {
  /** Final output (last successful step) */
  data: T;
  
  /** Aggregated metadata */
  metadata: PipelineMetadata;
  
  /** Results from each step */
  steps: StepResult[];
}

interface PipelineMetadata extends ResultMetadata {
  /** Minimum confidence across all steps (weakest link) */
  confidence: number;
  
  /** Per-step confidence breakdown */
  confidenceBreakdown: StepConfidence[];
  
  /** Aggregated reasoning from all steps */
  reasoning: StepReasoning[];
  
  /** Warnings from ALL steps, tagged with step index */
  warnings: PipelineWarning[];
  
  /** Sources from ALL steps */
  sources: PipelineSource[];
  
  /** Alternatives from ANY step that suggested them */
  alternatives: PipelineAlternative[];
  
  /** Total execution time (sum of all steps) */
  executionTimeMs: number;
  
  /** Number of steps completed */
  completedSteps: number;
  
  /** Number of steps total */
  totalSteps: number;
}
```

### FR-3b: Metadata Propagation (Trust Signals)

All AFD UX-enabling fields propagate through the pipeline:

| Field | Propagation Rule |
|-------|------------------|
| `confidence` | Minimum across all steps (weakest link) |
| `reasoning` | Collected from all steps with attribution |
| `warnings` | Collected from all steps |
| `sources` | Collected from all steps |
| `alternatives` | Collected from all steps |
| `executionTimeMs` | Sum of all steps |
| `plan` | Steps from final command only |

```typescript
interface StepConfidence {
  step: number;
  alias?: string;
  command: string;
  confidence: number;
  reasoning?: string;  // Why this confidence level
}

interface StepReasoning {
  /** Which step provided this reasoning */
  stepIndex: number;
  command: string;
  /** Explanation of WHY this step made its decisions */
  reasoning: string;
}

interface PipelineWarning extends Warning {
  /** Which step generated this warning */
  stepIndex: number;
  stepAlias?: string;
}

interface PipelineSource extends Source {
  /** Which step used this source */
  stepIndex: number;
}

interface PipelineAlternative extends Alternative {
  /** Which step suggested this alternative */
  stepIndex: number;
}
```

**Example: Confidence Breakdown**
```typescript
const result = await client.pipe([
  { command: 'data-fetch', input: { source: 'api' } },      // 0.95 confidence
  { command: 'data-transform', input: { data: '$prev' } },  // 0.99 confidence
  { command: 'data-validate', input: { data: '$prev' } }    // 0.87 confidence
]);

result.metadata.confidence === 0.87;  // Minimum (weakest link)
result.metadata.confidenceBreakdown === [
  { step: 0, command: 'data-fetch', confidence: 0.95 },
  { step: 1, command: 'data-transform', confidence: 0.99 },
  { step: 2, command: 'data-validate', confidence: 0.87, reasoning: 'Schema mismatch in 2 fields' }
];
```

**Example: Reasoning Aggregation**
```typescript
result.metadata.reasoning === [
  { stepIndex: 0, command: 'data-fetch', reasoning: 'Using cached API response (3min old)' },
  { stepIndex: 1, command: 'data-transform', reasoning: 'Applied UTC timezone normalization' },
  { stepIndex: 2, command: 'data-validate', reasoning: 'Flagged 2 fields with type mismatches' }
];
```

### FR-3c: StepResult Type

```typescript
interface StepResult {
  /** Step index */
  index: number;
  
  /** Step alias if provided */
  alias?: string;
  
  /** Command that was executed */
  command: string;
  
  /** Step status */
  status: 'success' | 'failure' | 'skipped';
  
  /** Step output (if successful) */
  data?: unknown;
  
  /** Step error (if failed) - includes suggestion per AFD patterns */
  error?: CommandError;
  
  /** Step execution time */
  executionTimeMs: number;
  
  /** Full step metadata (confidence, reasoning, sources, etc.) */
  metadata?: ResultMetadata;
}
```

### FR-4: Error Behavior (with Actionable Suggestions)

Errors include suggestions following AFD error patterns:

- **Default:** Pipeline stops on first failure, returns partial result with suggestion
- **`continueOnFailure: true`:** Continue executing, collect all errors
- **Skipped steps:** Steps with unmet conditions marked as `skipped`

```typescript
// Default: stop on failure with actionable suggestion
const result = await client.pipe([
  { command: 'user-get', input: { id: 999 } },  // Fails: not found
  { command: 'order-list', input: { userId: '$prev.id' } }  // Never runs
]);

result.steps[0].status === 'failure';
result.steps[0].error === {
  code: 'NOT_FOUND',
  message: 'User 999 not found',
  suggestion: 'Check if user ID is correct, or create user first via user-create'
};
result.steps[1].status === 'skipped';
```

### FR-5: Conditional Steps

```typescript
type PipelineCondition = 
  | { $exists: string }           // Field exists in context
  | { $eq: [string, unknown] }    // Field equals value
  | { $gt: [string, number] }     // Field greater than
  | { $and: PipelineCondition[] } // All conditions true
  | { $or: PipelineCondition[] }; // Any condition true

// Example: Only run discount step if user is premium
{
  command: 'order-applyDiscount',
  input: { orderId: '$prev.id' },
  when: { $eq: ['$steps.user.tier', 'premium'] }
}
```

### FR-6: Fluent API (Optional Enhancement)

```typescript
// Builder pattern for type-safe pipelines
const result = await client
  .pipe()
  .step('user-get', { id: 123 }).as('user')
  .step('order-list', { userId: '$user.id' })
  .step('order-total', { orders: '$prev' })
  .execute();
```

---

## API Design

### Execute Pipeline

```typescript
// Using PipelineRequest
const result = await client.pipe(pipelineRequest);

// Inline shorthand
const result = await client.pipe([
  { command: 'a', input: {} },
  { command: 'b', input: { data: '$prev' } }
]);
```

### Type Guards

```typescript
function isPipelineRequest(obj: unknown): obj is PipelineRequest;
function isPipelineResult(obj: unknown): obj is PipelineResult;
```

### Helper Functions

```typescript
// Create a reusable pipeline template
function createPipeline(steps: PipelineStep[]): PipelineRequest;

// Resolve variable references in step input
function resolveVariables(
  input: Record<string, unknown>,
  context: PipelineContext
): Record<string, unknown>;

// Calculate aggregated confidence
function aggregatePipelineConfidence(steps: StepResult[]): number;

// Aggregate reasoning from all steps
function aggregatePipelineReasoning(steps: StepResult[]): StepReasoning[];
```

---

## Examples

### Example 1: Simple Chain

```typescript
const result = await client.pipe([
  { command: 'todo-list', input: { filter: 'active' } },
  { command: 'todo-sort', input: { items: '$prev', by: 'priority' } },
  { command: 'todo-format', input: { items: '$prev', format: 'markdown' } }
]);

console.log(result.data);  // Formatted markdown string
console.log(result.metadata.reasoning);  // Decisions from each step
```

### Example 2: Multi-Source Aggregation

```typescript
const result = await client.pipe([
  { command: 'user-get', input: { id: 123 }, as: 'user' },
  { command: 'user-preferences', input: { userId: 123 }, as: 'prefs' },
  { command: 'user-aggregate', input: {
    user: '$steps.user',
    preferences: '$steps.prefs'
  }}
]);
```

### Example 3: Conditional Execution

```typescript
const result = await client.pipe([
  { command: 'order-get', input: { id: 456 }, as: 'order' },
  { 
    command: 'shipping-calculate',
    input: { weight: '$order.weight' },
    when: { $exists: '$order.weight' }
  },
  {
    command: 'shipping-default',
    input: { orderId: '$order.id' },
    when: { $not: { $exists: '$order.weight' } }
  }
]);
```

### Example 4: Error Recovery with Suggestions

```typescript
const result = await client.pipe({
  steps: [
    { command: 'cache-get', input: { key: 'data' }, as: 'cached' },
    { 
      command: 'api-fetch',
      input: { url: '/data' },
      when: { $eq: ['$cached.status', 'failure'] }
    }
  ],
  options: { continueOnFailure: true }
});

// If cache fails, error includes suggestion
if (result.steps[0].error) {
  console.log(result.steps[0].error.suggestion);
  // → "Check Redis connection or use api-fetch as fallback"
}
```

---

## Streaming Support

Pipeline steps that use streaming commands emit `StreamChunk` events:

```typescript
// Pipeline with a streaming step
const result = await client.pipe({
  steps: [
    { command: 'data-fetchLarge', input: { size: 'huge' }, stream: true },
    { command: 'data-process', input: { data: '$prev' } }
  ],
  options: {
    onProgress: (chunk: StreamChunk, stepIndex: number) => {
      console.log(`Step ${stepIndex}: ${chunk.progress}% complete`);
    }
  }
});
```

Streaming steps emit progress through the pipeline's `onProgress` callback, enabling real-time UI updates even in multi-step workflows.

---

## Transport Agnostic

Pipelines work identically across all AFD transports:

| Transport | Latency | Pipeline Support |
|-----------|---------|------------------|
| **Direct** | ~0.01ms | ✅ Full support |
| **stdio** | ~10-50ms | ✅ Full support |
| **HTTP/SSE** | ~20-100ms | ✅ Full support (streaming via SSE) |

```typescript
// Same pipeline, any transport
const directResult = await directClient.pipe(steps);
const mcpResult = await mcpClient.pipe(steps);  // Same result
```

---

## Implementation Notes

### Variable Resolution Algorithm

```typescript
function resolveVariables(input: unknown, context: PipelineContext): unknown {
  if (typeof input === 'string' && input.startsWith('$')) {
    return resolveReference(input, context);
  }
  if (Array.isArray(input)) {
    return input.map(item => resolveVariables(item, context));
  }
  if (typeof input === 'object' && input !== null) {
    return Object.fromEntries(
      Object.entries(input).map(([k, v]) => [k, resolveVariables(v, context)])
    );
  }
  return input;
}

function resolveReference(ref: string, context: PipelineContext): unknown {
  if (ref === '$prev') return context.previousResult?.data;
  if (ref === '$first') return context.steps[0]?.data;
  if (ref === '$input') return context.pipelineInput;
  if (ref.startsWith('$steps[')) {
    const index = parseInt(ref.match(/\d+/)?.[0] ?? '0');
    return context.steps[index]?.data;
  }
  if (ref.startsWith('$steps.')) {
    const alias = ref.slice(7).split('.')[0];
    const step = context.steps.find(s => s.alias === alias);
    return getNestedValue(step?.data, ref.slice(8 + alias.length));
  }
  // Handle dot notation: $prev.field.subfield
  const parts = ref.slice(1).split('.');
  let value: unknown = context;
  for (const part of parts) {
    value = (value as Record<string, unknown>)?.[part];
  }
  return value;
}
```

### Confidence Aggregation

Pipeline confidence is the **minimum** of all step confidences (weakest link principle):

```typescript
function aggregatePipelineConfidence(steps: StepResult[]): number {
  const confidences = steps
    .filter(s => s.status === 'success')
    .map(s => s.metadata?.confidence ?? 1.0);
  
  return confidences.length > 0 
    ? Math.min(...confidences) 
    : 0;
}
```

### Reasoning Aggregation

```typescript
function aggregatePipelineReasoning(steps: StepResult[]): StepReasoning[] {
  return steps
    .filter(s => s.status === 'success' && s.metadata?.reasoning)
    .map(s => ({
      stepIndex: s.index,
      command: s.command,
      reasoning: s.metadata!.reasoning!
    }));
}
```

---

## Relationship to Existing Types

| Existing | Pipeline Equivalent |
|----------|---------------------|
| `BatchRequest` | Parallel execution (unrelated commands) |
| `PipelineRequest` | Sequential execution (chained commands) |
| `StreamChunk` | Used within pipeline steps for progress |
| `CommandResult` | Each step returns a full CommandResult |

Pipelines and batches can be combined:
```typescript
// Pipeline with a batch step
const result = await client.pipe([
  { command: 'user-get', input: { id: 123 } },
  { command: 'afd-batch', input: {
    commands: [
      { name: 'order-list', input: { userId: '$prev.id' } },
      { name: 'payment-list', input: { userId: '$prev.id' } }
    ]
  }},
  { command: 'user-enrich', input: { 
    user: '$first',
    orders: '$prev.results[0]',
    payments: '$prev.results[1]'
  }}
]);
```

---

## Out of Scope

- [ ] Parallel step execution (Phase 2)
- [ ] Pipeline persistence/resume (Phase 2)
- [ ] Visual pipeline builder UI (Phase 3)
- [ ] Pipeline templates library (Phase 3)

---

## Success Criteria

- [ ] `PipelineRequest` and `PipelineResult` types in `@afd/core`
- [ ] `client.pipe()` method in DirectClient
- [ ] Variable resolution for `$prev`, `$first`, `$steps[n]`, `$steps.alias`
- [ ] Conditional steps with `when` clause
- [ ] Error propagation with `continueOnFailure` option
- [ ] Aggregated confidence in pipeline metadata (weakest link)
- [ ] Aggregated reasoning with step attribution
- [ ] Error suggestions following AFD patterns
- [ ] Streaming support with `onProgress` callback
- [ ] Transport parity (Direct, stdio, HTTP/SSE)
- [ ] Unit tests for variable resolution
- [ ] Integration tests for multi-step pipelines
