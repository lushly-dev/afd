# CodeClient: Code Generation vs Tool Calling

> Proposal: Alternative transport where LLMs generate code instead of tool calls

---
status: research
created: 2026-01-09
origin: Interview discussion about CodeMCP
---

## The Insight

> "LLMs will never be as good at tool calling as they are at writing code."

Models are trained on billions of lines of code. They're better at generating executable code than navigating tool call schemas.

## Problem with Tool Calling

Each tool call + result consumes context:

```
LLM → tool call → result (tokens) → LLM → tool call → result (more tokens)...
```

Context grows with each step. Anthropic reports **98.7% token reduction** with code generation approach.

## Code Generation Approach

```
LLM → generate code → execute in sandbox → single result
```

The model generates a Python/TS script that:
1. Imports AFD client
2. Calls commands with typed parameters
3. Handles control flow (loops, conditionals)
4. Returns final result

## Example

**Tool calling (current):**
```json
[
  {"tool": "task-list", "input": {"status": "pending"}},
  {"tool": "task-complete", "input": {"id": "$result[0].id"}},
  {"tool": "task-list", "input": {"status": "pending"}}
]
```

**Code generation:**
```python
from afd import client

tasks = await client.execute("task-list", {"status": "pending"})
if tasks:
    await client.execute("task-complete", {"id": tasks[0]["id"]})
remaining = await client.execute("task-list", {"status": "pending"})
return {"completed": 1, "remaining": len(remaining)}
```

## Benefits

| Aspect | Tool Calling | Code Generation |
|--------|--------------|-----------------|
| Context usage | High (grows per call) | Low (single result) |
| Control flow | Limited | Full (loops, conditionals) |
| Error handling | Per-call | try/catch blocks |
| Training data | Tool schemas | Billions of code lines |
| Determinism | Model-dependent | Code is predictable |

## AFD Fit

AFD's schemas enable both approaches:

1. **Typed tool calls** (current DirectClient)
2. **Typed code generation** (future CodeClient)

The Zod schemas generate TypeScript types that models can use to write valid code:

```typescript
// Generated from schema
interface TaskCreateInput {
  title: string;
  dueDate?: Date;
  priority?: 0 | 1 | 2 | 3;
}
```

Model generates code using these types → fewer errors.

## Implementation Sketch

```typescript
class CodeClient {
  async executeCode(code: string): Promise<Result> {
    // 1. Validate code in sandbox
    // 2. Inject AFD client
    // 3. Execute
    // 4. Return result with trust signals
  }
}

// Usage
const code = await llm.generate(`
  Using the AFD client, list all pending tasks
  and mark the oldest one complete.
`);
const result = await codeClient.executeCode(code);
```

## Security Considerations

- Sandboxed execution (VM2, isolated-vm, or Deno)
- No file system access
- Network limited to AFD server
- Resource limits (CPU, memory, time)

## Related Work

- **CodeMCP** — Anthropic's code-first MCP approach
- **E2B** — Code execution sandbox for agents
- **Modal** — Serverless Python execution

## Next Steps

1. Research CodeMCP implementation details
2. Prototype sandbox execution
3. Compare token usage vs DirectClient
4. Evaluate security model

---

*Status: Research note. Explore if code generation approach benefits AFD.*
