# Trust Through Validation

This document explains why CLI validation is central to AFD, and how it builds the foundation for user trust in agent-powered applications.

## The Trust Problem

Users interacting with AI agents face a fundamental question: **"Can I trust this agent to do what I need?"**

This isn't about whether users *like* the agent—it's about whether they'll *delegate* meaningful tasks to it. Without trust, users:
- Manually verify every agent action (defeating the purpose)
- Limit the agent to trivial tasks
- Abandon agent features entirely

## Competence Trust

In agentic UX research, **Competence Trust** is defined as:

> User confidence in the agent's ability to perform tasks effectively and reliably.

Competence Trust has four components:

| Component | Definition | How AFD Addresses It |
|-----------|------------|---------------------|
| **Capability Transparency** | Clear communication of what the agent can/cannot do | Commands have explicit schemas |
| **Performance Consistency** | Reliable execution within stated parameters | CLI-tested commands work the same every time |
| **Error Handling** | Graceful management of mistakes | Standardized error schemas with suggestions |
| **Expertise Boundaries** | Honest acknowledgment of limits | Commands fail clearly rather than hallucinate |

## The AFD Trust Chain

AFD builds Competence Trust through a chain of validation:

```
┌─────────────────────────────────────────────────────────────────┐
│                     THE AFD TRUST CHAIN                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. DEFINE                                                      │
│     Command schema explicitly declares capabilities             │
│     ↓                                                           │
│  2. VALIDATE (CLI)                                              │
│     Developer proves command works via CLI                      │
│     ↓                                                           │
│  3. TEST                                                        │
│     Automated tests verify consistent behavior                  │
│     ↓                                                           │
│  4. SURFACE                                                     │
│     UI invokes the proven command                               │
│     ↓                                                           │
│  5. TRUST                                                       │
│     User experiences reliable behavior                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Each step in this chain reinforces trust:

### Step 1: Define → Capability Transparency

When you define a command schema, you explicitly declare:
- What the command does
- What inputs it accepts
- What outputs it returns
- What errors it can produce

This schema IS the source of truth. There's no gap between "what the agent claims it can do" and "what it actually does"—the schema is both.

```typescript
// The schema IS the capability declaration
const reviewContent = {
  name: 'content.review',
  description: 'Reviews content against style guidelines',
  input: {
    content: { type: 'string', required: true },
    guidelines: { type: 'string[]', required: false }
  },
  output: {
    issues: { type: 'Issue[]' },
    suggestions: { type: 'Suggestion[]' },
    confidence: { type: 'number' }
  },
  errors: ['CONTENT_TOO_LONG', 'INVALID_GUIDELINES', 'SERVICE_UNAVAILABLE']
};
```

### Step 2: Validate → Performance Consistency

The "Honesty Check" principle:

> **If it can't be done via CLI, it's not properly abstracted.**

CLI validation proves the command works:

```bash
# This either works or it doesn't—no UI tricks, no magic
$ afd call content.review --content "Check this text for issues"

{
  "success": true,
  "data": {
    "issues": [],
    "suggestions": [
      { "type": "clarity", "message": "Consider more specific language" }
    ]
  },
  "confidence": 0.82
}
```

If the command works via CLI:
- It will work when the UI calls it
- It will work when an agent calls it via MCP
- It will work in automated tests
- It will work in CI/CD pipelines

**The CLI is the great equalizer.** It strips away UI affordances, network abstractions, and user interface helpers. What remains is the raw capability.

### Step 3: Test → Reliability Proof

Automated tests formalize the validation:

```typescript
describe('content.review', () => {
  it('returns issues for problematic content', async () => {
    const result = await call('content.review', {
      content: 'This is very very redundant redundant text'
    });
    
    expect(result.success).toBe(true);
    expect(result.data.issues.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
  });
  
  it('handles empty content gracefully', async () => {
    const result = await call('content.review', { content: '' });
    
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('EMPTY_CONTENT');
    expect(result.error.suggestion).toBeDefined();
  });
});
```

These tests run on every commit, ensuring the command's behavior doesn't regress.

### Step 4: Surface → Consistent Experience

When the UI invokes the command, it gets the exact same behavior:

```typescript
// UI component
async function handleReviewClick() {
  setLoading(true);
  
  // Same command, same behavior, same result structure
  const result = await client.call('content.review', {
    content: editor.getValue()
  });
  
  if (result.success) {
    showResults(result.data);
    showConfidence(result.confidence); // UI can trust this field exists
  } else {
    showError(result.error); // Error structure is predictable
  }
}
```

The UI developer doesn't have to wonder:
- "Will this work?" → Yes, it's CLI-validated
- "What's the response shape?" → Defined in schema
- "How do errors look?" → Standardized format

### Step 5: Trust → User Confidence

The end user experiences:
- Commands that work reliably
- Predictable behavior across contexts
- Clear error messages when things fail
- Confidence indicators they can trust

This reliability compounds into Competence Trust.

## The Anti-Pattern: UI-Only Features

Consider what happens without AFD:

```
┌─────────────────────────────────────────────────────────────────┐
│                     UI-ONLY DEVELOPMENT                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Build UI feature                                            │
│     ↓                                                           │
│  2. It works! (in the browser, with the right clicks)           │
│     ↓                                                           │
│  3. Agent tries to use it... how?                               │
│     ↓                                                           │
│  4. Reverse-engineer UI into API                                │
│     ↓                                                           │
│  5. API doesn't quite match UI behavior                         │
│     ↓                                                           │
│  6. User trust erodes                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Problems with UI-only features:
- **No validation path**: Can't prove it works outside the UI
- **Behavior drift**: UI and API diverge over time
- **Agent exclusion**: Agents can't access UI-only features
- **Testing difficulty**: Hard to test without simulating UI interactions

## Trust Signals in Command Results

Beyond reliability, commands can actively build trust by returning trust-enabling data:

### Confidence Scores

```typescript
{
  data: { recommendation: "Use active voice" },
  confidence: 0.73
}
```

A well-calibrated confidence score tells users:
- How much to trust this specific result
- Whether to verify manually
- Whether to explore alternatives

### Reasoning

```typescript
{
  data: { recommendation: "Use active voice" },
  confidence: 0.73,
  reasoning: "The passive construction 'was completed by the team' obscures the actor. Active voice ('the team completed') is clearer per Microsoft Style Guide section 3.2."
}
```

Reasoning enables:
- **Transparency**: Users understand *why*
- **Verification**: Users can check the logic
- **Learning**: Users learn the agent's decision process

### Sources

```typescript
{
  data: { recommendation: "Use active voice" },
  sources: [
    { type: 'document', title: 'Microsoft Style Guide', location: '3.2' }
  ]
}
```

Sources enable:
- **Attribution**: Where did this come from?
- **Verification**: Users can check the source
- **Trust calibration**: Authoritative sources increase confidence

## Measuring Trust

Track these metrics to assess whether your commands are building trust:

| Metric | What It Measures | Target |
|--------|------------------|--------|
| **Command success rate** | Do commands work? | > 99% |
| **Error clarity score** | Are errors actionable? | User survey |
| **Retry rate** | Do users retry failed commands? | Lower is better |
| **Override rate** | How often do users override agent suggestions? | Contextual |
| **Delegation expansion** | Do users delegate more tasks over time? | Increasing |

> **Tip**: Segment these metrics by **surface** (UI vs agent vs automation) and **command type** (query vs mutation) for actionable insights. A 99% aggregate success rate can hide a problematic 92% mutation rate. See [Production Considerations](./production-considerations.md#trust-metrics-segmentation) for guidance.

## The Honesty Check in Practice

Before shipping any feature, apply the Honesty Check:

```bash
# Can I do this via CLI?
$ afd call feature.action --input "test"

# If yes: Ship it
# If no: Fix the abstraction first
```

Examples:

| Feature | Honesty Check | Result |
|---------|---------------|--------|
| "Review document" | `afd call content.review --file doc.md` | ✅ Pass |
| "Drag to reorder" | `afd call items.reorder --ids [1,3,2]` | ✅ Pass |
| "Hover to preview" | Uses `afd call document.getSummary --id doc-1` | ✅ Pass (UI triggers existing query) |
| "Auto-save on blur" | `afd call document.save --id doc-1` | ✅ Pass (event triggers command) |

> **Note**: "Hover to preview" passes because hover is **ephemeral UI state** that triggers an existing command (`document.getSummary`), not a distinct action. The command exists and is CLI-testable; hover is just one of many ways to invoke it. See [What is NOT a Command](./command-schema-guide.md#what-is-not-a-command) for guidance on UI state vs commands.

## Summary

CLI validation isn't just a testing technique—it's a trust-building strategy:

1. **Schema** declares capabilities honestly
2. **CLI validation** proves capabilities work
3. **Tests** ensure capabilities stay working
4. **UI** surfaces proven capabilities
5. **Users** experience reliable behavior → **Trust**

The more you validate via CLI, the more users can trust your agent.

## Related

- [Command Schema Guide](./command-schema-guide.md) - How to design trustworthy command schemas
- [Implementation Phases](./implementation-phases.md) - When to focus on trust-building
- [Production Considerations](./production-considerations.md) - Metrics segmentation, observability, audit
- [Agentic AI UX Design Principles](/Agentic%20AI%20UX%20Design%20Principles/06-Agentic-AI-Trust-and-Safety.md) - Full trust framework
