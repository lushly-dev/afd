# Command Prerequisites

> Proposal: Declarative dependency graph between commands so agents and surface validation can reason about ordering

---
status: reviewed
created: 2026-02-22
origin: Playground testing — auth middleware *enforced* that sign-in must precede protected commands, but nothing *told* the agent this upfront. Agent discovered the dependency only after hitting UNAUTHORIZED errors.
effort: M (3-5 days)
package: "@lushly-dev/afd-server", "@lushly-dev/afd-testing"
---

## Problem

Commands have implicit ordering dependencies that agents discover through trial and error:

```
Agent: calls secret-data
Server: UNAUTHORIZED — "Authentication required"
Agent: calls auth-sign-in
Agent: calls secret-data again
Server: SUCCESS
```

The middleware correctly enforced the dependency. But the agent wasted a round trip and had to *interpret an error message* to figure out what to do. That works for auth (well-known pattern), but consider:

- `report-export` requires `report-generate` first (stateful)
- `deploy-production` requires `deploy-staging` + `test-run` (pipeline)
- `order-submit` requires `cart-validate` (business rule)

Agents can't infer these from schemas or descriptions. Today, the only signal is a failure + suggestion string — which requires natural language comprehension per error.

## Proposed Solution

A `requires` field on command definitions that declares prerequisites:

```typescript
const secretData = defineCommand({
  name: 'secret-data',
  description: 'Return sensitive data for the authenticated user',
  requires: ['auth-sign-in'],  // NEW
  input: z.object({}),
  handler: async (input, context) => { /* ... */ },
});
```

### Semantic Contract

`requires` declares **planning-order dependencies** — commands that an agent should ensure have been successfully executed in the current session before invoking this command.

**What this means for agents:**

1. **Check before calling, don't blindly re-execute.** If `secret-data` requires `auth-sign-in`, the agent should verify it has already signed in during this session — not call `auth-sign-in` before every invocation.
2. **Prerequisites create state this command consumes.** `report-export` requires `report-generate` because the report entity must exist. The prerequisite produces state; the dependent command reads it.
3. **Order, not coupling.** Prerequisites describe sequencing for planning. The agent decides *when* and *whether* to call each prerequisite — `requires` is not an auto-execution trigger.

| Aspect | Behavior |
|--------|----------|
| **Compile-time** | Surface validation checks that required commands exist in the surface |
| **Runtime** | No enforcement (middleware handles that). `requires` is metadata only |
| **Agent-facing** | Listed in MCP tool `_meta` so agents can plan execution order before calling |
| **Human-facing** | Shown in `afd-help` output as prerequisites |

This is explicitly **not** an execution engine. It's a dependency *declaration* that agents and tools can read.

### Schema Changes

```typescript
// ZodCommandOptions (server/src/schema.ts)
interface ZodCommandOptions<TInput, TOutput> {
  // ...existing fields...

  /** Commands that should be called before this one. Metadata only — not enforced at runtime. */
  requires?: string[];
}

// ZodCommandDefinition
interface ZodCommandDefinition<TInput, TOutput> {
  // ...existing fields...
  requires?: string[];
}

// CommandDefinition (core)
interface CommandDefinition {
  // ...existing fields...
  requires?: string[];
}
```

### Surface Validation Rule

New rule: **`unresolved-prerequisites`** — flags commands whose `requires` reference commands that don't exist in the surface.

```typescript
export function checkUnresolvedPrerequisites(
  commands: SurfaceCommand[],
): SurfaceFinding[] {
  const findings: SurfaceFinding[] = [];
  const names = new Set(commands.map(c => c.name));

  for (const cmd of commands) {
    if (!cmd.requires) continue;
    for (const req of cmd.requires) {
      if (!names.has(req)) {
        findings.push({
          rule: 'unresolved-prerequisite',
          severity: 'error',
          message: `Command "${cmd.name}" requires "${req}" but it is not registered`,
          commands: [cmd.name],
          suggestion: `Register the "${req}" command or remove it from requires.`,
          evidence: { missingPrerequisite: req },
        });
      }
    }
  }

  return findings;
}
```

Second rule: **`circular-prerequisites`** — detects cycles in the dependency graph.

```typescript
// A requires B, B requires A → error
{
  rule: 'circular-prerequisite',
  severity: 'error',
  message: 'Circular prerequisite chain: deploy-production → test-run → deploy-production',
  commands: ['deploy-production', 'test-run'],
}
```

### MCP Exposure via `_meta`

The MCP SDK's `Tool` interface includes a `_meta` field (`{ [key: string]: unknown }`) designed for custom extension metadata. This is the standards-compliant path — compliant clients preserve `_meta`, and agents can read it without special handling.

When `createMcpServer()` builds the tools list, `requires` is included in `_meta`:

```typescript
// In getToolsList() — individual strategy
commands.map((cmd) => {
  const { type: _type, ...restSchema } = cmd.jsonSchema;
  return {
    name: cmd.name,
    description: cmd.description,
    inputSchema: {
      type: 'object' as const,
      ...restSchema,
    },
    // NEW: Expose AFD metadata via MCP _meta
    _meta: {
      ...(cmd.requires?.length && { requires: cmd.requires }),
      ...(cmd.mutation != null && { mutation: cmd.mutation }),
    },
  };
});
```

**Agent sees this in `tools/list` response:**

```json
{
  "name": "secret-data",
  "description": "Return sensitive data for the authenticated user",
  "inputSchema": { "type": "object", "properties": {} },
  "_meta": {
    "requires": ["auth-sign-in"],
    "mutation": false
  }
}
```

The agent now knows *before calling* that it needs to sign in first. No wasted round trip, no error-message parsing.

**Why `_meta` over alternatives:**

| Approach | Problem |
|----------|---------|
| Top-level `requires` field | Non-standard — MCP clients may strip unknown fields |
| Append to `description` text | Mixes machine-readable data into prose — agents must parse natural language |
| Only via `afd-help` | Invisible to agents that read tool listings directly without calling help first |
| **`_meta` (chosen)** | **Standards-compliant, preserved by clients, structured, extensible** |

> **Note:** `_meta` also provides a natural home for other AFD metadata (`mutation`, `executionTime`, `tags`) that is currently lost in MCP serialization. This proposal opens that door but only adds `requires` and `mutation` initially.

### Grouped Strategy Interaction

When using the `grouped` tool strategy (commands consolidated by category), `requires` metadata is not surfaced on the group tool — it applies to individual commands. If an agent needs prerequisite information while using grouped tools, it should call `afd-help` with `format: 'full'`.

This is acceptable because:
- Grouped strategy is an optimization for reducing tool count, not a metadata layer
- `afd-help` is always available as the canonical command discovery path
- Individual strategy (default) preserves full `_meta`

### `afd-help` Integration

The `afd-help` command exposes `requires` in its `full` format output:

```typescript
// In createAfdHelpCommand — full format mapping
const info: CommandInfo = {
  name: cmd.name,
  description: cmd.description,
  category: cmd.category,
  tags: cmd.tags,
  mutation: cmd.mutation,
  requires: cmd.requires,  // NEW
};
```

**Agent output (full format):**

```json
{
  "commands": [
    {
      "name": "secret-data",
      "description": "Return sensitive data for the authenticated user",
      "category": "data",
      "mutation": false,
      "requires": ["auth-sign-in"]
    }
  ]
}
```

**Human-readable output (brief format):**

```
secret-data — Return sensitive data for the authenticated user
  Requires: auth-sign-in
```

## Benefits

| Without | With |
|---------|------|
| Agent discovers dependencies by failing | Agent reads `requires` upfront |
| Error messages must encode dependency info | Structured `requires` field is machine-readable |
| No validation of dependency consistency | Surface validation catches missing/circular prerequisites |
| Documentation is manual | Auto-generated from `requires` field |

## Implementation Plan

### Phase 1: Schema + Passthrough
- [ ] Add `requires?: string[]` to `ZodCommandOptions`, `ZodCommandDefinition`, `CommandDefinition`
- [ ] Pass through in `defineCommand()` and `toCommandDefinition()`
- [ ] Add `requires?: string[]` to `SurfaceCommand` type (first non-schema metadata field on this type — acceptable since `SurfaceCommand` is internal to the validation system)

### Phase 2: Surface Validation Rules
- [ ] Add `'unresolved-prerequisite' | 'circular-prerequisite'` to `SurfaceRule` union type
- [ ] Implement `checkUnresolvedPrerequisites` rule
- [ ] Implement `checkCircularPrerequisites` rule (topological sort / DFS cycle detection)
- [ ] Wire both into `validateCommandSurface()` orchestrator
- [ ] Tests for both rules (positive and negative cases, multi-hop cycles)

### Phase 3: MCP + Help Exposure
- [ ] Emit `_meta.requires` on MCP tools in `getToolsList()` individual strategy
- [ ] Also emit `_meta.mutation` alongside (opens the door for richer `_meta` later)
- [ ] Add `requires` to `CommandInfo` type in `afd-help`
- [ ] Include `requires` in full-format output
- [ ] Show prerequisite line in brief-format output

### Phase 4: Demo
- [ ] Add `requires` to auth-gated commands in playground experiment
- [ ] Show surface validation catching a missing prerequisite
- [ ] Show surface validation catching a circular prerequisite

### Phase 5: Documentation
- [ ] All updates listed in the [Documentation Updates](#documentation-updates) section below

## Documentation Updates

Every artifact that references command definitions, surface validation, or MCP tool schemas needs updating. Listed by file with the specific change required.

### CHANGELOG.md

Add entry under the next release's `### Added` section:

```markdown
- **Command prerequisites** (`@lushly-dev/afd-server`, `@lushly-dev/afd-testing`) — Declarative `requires` field on command definitions for planning-order dependencies
  - **`requires?: string[]`** on `defineCommand()` — declares commands that should be called before this one (metadata only, not enforced at runtime)
  - **MCP `_meta` exposure** — `requires` and `mutation` emitted in MCP tool `_meta` field for agent consumption via `tools/list`
  - **`afd-help` integration** — prerequisites shown in full-format output and brief-format prerequisite line
  - **Surface validation: `unresolved-prerequisite`** (error) — flags commands whose `requires` reference commands not registered in the surface
  - **Surface validation: `circular-prerequisite`** (error) — detects cycles in the prerequisite dependency graph
```

### packages/server/README.md

**1. Features list** — Add bullet:

```markdown
- **Command Prerequisites** - Declare `requires` dependencies so agents can plan execution order
```

**2. Defining Commands section** — Add example after "Command with Error Handling":

```markdown
### Command with Prerequisites

```typescript
const secretData = defineCommand({
  name: 'secret-data',
  description: 'Return sensitive data for the authenticated user',
  requires: ['auth-sign-in'],  // Agent sees this before calling
  input: z.object({}),

  async handler(input, context) {
    return success({ secret: '...' });
  },
});
```

Prerequisites are metadata — they tell agents what to call first but are not enforced at runtime (middleware handles enforcement). They appear in MCP tool `_meta` and `afd-help` output.
```

**3. API Reference > defineCommand(options) table** — Add row:

```markdown
| `requires` | string[] | No | Commands that should be called before this one |
```

### packages/testing/README.md

**1. Surface Validation > Validation Rules table** — Add two rows:

```markdown
| `unresolved-prerequisite` | Error | Command `requires` references a command not registered in the surface |
| `circular-prerequisite` | Error | Circular chain in prerequisite dependency graph |
```

**2. Bottom Validation Rules > Surface Validation Rules table** — Add same two rows to match.

### Skill: `.claude/skills/afd/references/command-schema.md`

**1. The CommandResult Interface section** — No changes (prerequisites are on definitions, not results).

**2. Add new subsection** after "Command Tags":

```markdown
## Command Prerequisites

Declare planning-order dependencies so agents know what to call first:

```typescript
const reportExport = defineCommand({
  name: 'report-export',
  description: 'Export a generated report as PDF',
  requires: ['report-generate'],
  // ...
});
```

**Semantic contract for agents:**

1. **Check before calling, don't blindly re-execute.** Verify the prerequisite has been satisfied in the current session.
2. **Prerequisites create state this command consumes.** `report-generate` produces the report; `report-export` reads it.
3. **Order, not coupling.** The agent decides when/whether to call prerequisites.

`requires` is metadata only — runtime enforcement is handled by middleware (e.g., auth middleware). Surface validation catches missing (`unresolved-prerequisite`) and circular (`circular-prerequisite`) references at analysis time.

**MCP exposure:** Prerequisites appear in the tool's `_meta` field:

```json
{
  "name": "report-export",
  "_meta": { "requires": ["report-generate"] }
}
```
```

### Skill: `.claude/skills/afd/references/surface-validation.md`

**Add to the rules section** (after existing 8 rules):

```markdown
#### 9. Unresolved Prerequisite (`unresolved-prerequisite`)

- **Severity:** `error`
- **Condition:** `cmd.requires` references a command name not registered in the surface
- **Evidence:** `{ missingPrerequisite: string }`
- **Suggestion:** Register the missing command or remove it from `requires`

#### 10. Circular Prerequisite (`circular-prerequisite`)

- **Severity:** `error`
- **Condition:** Cycle detected in the prerequisite dependency graph (A requires B, B requires A)
- **Evidence:** `{ chain: string[] }` — the cycle path
- **Suggestion:** Break the cycle by removing one direction of the dependency
```

### Skill: `.claude/skills/afd/references/mcp-integration.md`

**Add new section** after "Registering Commands":

```markdown
## Tool Metadata (`_meta`)

AFD emits structured metadata on MCP tools via the standard `_meta` field. This gives agents machine-readable context beyond `name`, `description`, and `inputSchema`.

**Currently emitted fields:**

| Field | Type | Source | Purpose |
|-------|------|--------|---------|
| `requires` | `string[]` | `defineCommand({ requires })` | Planning-order dependencies |
| `mutation` | `boolean` | `defineCommand({ mutation })` | Whether command has side effects |

```json
{
  "name": "secret-data",
  "description": "Return sensitive data for the authenticated user",
  "inputSchema": { "type": "object", "properties": {} },
  "_meta": {
    "requires": ["auth-sign-in"],
    "mutation": false
  }
}
```

Fields are only emitted when present (no empty `_meta: {}` on commands without metadata).

**Governance:** Future `_meta` fields require their own proposal review. `_meta` is not a dumping ground — each field must justify its value to consuming agents.

**Note:** `_meta` applies to the `individual` tool strategy (default). The `grouped` strategy does not surface per-command `_meta`. Agents using grouped tools should call `afd-help` for prerequisite information.
```

### Skill: `.claude/skills/afd/SKILL.md`

**Update routing table** — Add row:

```markdown
| Prerequisites, requires, command ordering | [references/command-schema.md](references/command-schema.md) |
```

### CLAUDE.md

**Update Core Types > CommandResult section** — No changes needed (prerequisites are on definitions, not results).

**Update Key Conventions section** — Add under "CommandResult Fields":

```markdown
### Command Prerequisites
- Declare with `requires: ['command-name']` on `defineCommand()`
- Metadata only — not enforced at runtime (middleware handles that)
- Exposed to agents via MCP `_meta.requires` and `afd-help`
```

## Decisions (Closed)

1. **Soft vs hard prerequisites** — **Deferred.** Ship with `requires` only. A `suggests` field adds API surface, documentation burden, and agent interpretation complexity for a use case that `description` already handles ("Consider running report-configure first for custom formatting"). If demand emerges after adoption, add `suggests` in a follow-up proposal.

2. **Conditional prerequisites** — **Out of scope.** Conditional dependencies like "requires `test-run` unless `skipTests` is set" introduce structural complexity that agents must interpret programmatically. The description field handles this better: `"Deploy to production. Requires test-run to have passed (skippable via skipTests flag)"`. Modeling conditionals would also complicate the cycle-detection algorithm without proportional benefit.

3. **Pipeline auto-resolution** — **Out of scope.** `DirectClient.pipe()` is explicit orchestration — the caller defines every step. Auto-injecting prerequisites would make pipelines unpredictable ("I defined 3 steps but 5 executed") and violate the principle of least surprise. Pipelines and prerequisites serve different purposes: pipelines are execution plans, prerequisites are planning hints.
