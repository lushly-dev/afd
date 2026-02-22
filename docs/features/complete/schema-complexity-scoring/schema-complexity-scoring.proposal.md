# Schema Complexity Scoring

> Proposal: Surface validation rule that scores how hard a command's input schema is for an agent to use correctly

---
status: captured
created: 2026-02-22
updated: 2026-02-22
origin: Playground testing — agent hit runtime crash on discriminated union schemas, realized surface validation checks what commands *look like* but not whether an agent can *use them correctly*
effort: M (3-5 days)
package: "@lushly-dev/afd-testing"
prerequisites: "JsonSchema composition keywords (resolved — see below)"
---

## Problem

Surface validation currently checks naming, descriptions, categories, and injection — all metadata about command *identity*. It says nothing about whether the input schema is actually usable by an agent.

In practice, agents make input errors at rates that correlate with schema complexity:

| Schema Pattern | Agent Error Rate | Example |
|----------------|-----------------|---------|
| Flat required fields | Low | `{ title: string }` |
| Optional fields | Medium | `{ title: string, priority?: number }` |
| Discriminated unions (`oneOf`) | High | `{ method: "credentials", email, password } \| { method: "oauth", provider }` |
| Nested objects | High | `{ filter: { status: "active", tags: ["a"] } }` |
| Mixed constraints | Very High | Min/max, patterns, dependent fields |

The `auth-sign-in` command in this repo uses a discriminated union — it took a playground crash to discover the Zod schema's `oneOf` structure was invisible to surface validation. An agent calling this command must know to set `method` first, then provide the right sibling fields. No current rule flags this as complex.

## Prerequisite: JsonSchema Composition Keywords (Resolved)

The `JsonSchema` interface in `@lushly-dev/afd-core` previously lacked JSON Schema 7 composition keywords, making it impossible to detect unions and intersections. The following optional fields have been added to `JsonSchema`:

```typescript
export interface JsonSchema {
  // ...existing fields...

  /** Exactly one schema must match — used for discriminated unions (`z.discriminatedUnion()`) */
  oneOf?: JsonSchema[];
  /** At least one schema must match — used for unions (`z.union()`) and nullable types */
  anyOf?: JsonSchema[];
  /** All schemas must match — used for intersections (`z.intersection()`) */
  allOf?: JsonSchema[];
  /** Schema must not match */
  not?: JsonSchema;
  /** Exact value match — used for discriminator literals (`z.literal()`) */
  const?: unknown;
}
```

These fields were already produced at runtime by `zodToJsonSchema()` (via `zod-to-json-schema` with `target: 'jsonSchema7'`) but were silently dropped by the `as unknown as JsonSchema` cast. This change makes the existing runtime data type-safe. It is fully backward-compatible — all new fields are optional.

## Proposed Solution

A new surface validation rule: **`schema-complexity`** — scores each command's input schema and flags commands that exceed a complexity threshold.

### Complexity Factors

| Factor | Weight | Rationale |
|--------|--------|-----------|
| **Total field count** | 1 per field | More fields = more to get right |
| **Nesting depth** | 3 per level (max depth) | `input.filter.range.start` — agents flatten mentally |
| **Schema unions (`oneOf`/`anyOf`)** | 5 per union | Must pick correct variant AND provide its fields |
| **Schema intersections (`allOf`)** | 2 per intersection | Must satisfy multiple schemas simultaneously |
| **Enum constraints** | 1 per enum | Must know valid values |
| **Pattern/format constraints** | 2 per constraint | Regex patterns and string formats agents can't infer |
| **Numeric bounds** | 1 per bound | Silent validation failures |
| **Optional field ratio** | `floor(ratio * 4)` | Graduated: 0 at 0%, 2 at 50%, 4 at 100% |

**Dropped factor — Cross-field dependencies.** The original proposal included a "cross-field dependencies" factor (weight 4). This has been removed because:

1. Zod `.refine()` constraints — the primary way to express "field B required if field A is set" — are lost during JSON Schema conversion and cannot be detected from the schema.
2. The most common cross-field dependency pattern (discriminated unions where the discriminator value determines required siblings) is already captured by the schema unions factor at weight 5.

### Traversal Algorithm

The scorer walks the JSON Schema tree using **max-depth** semantics:

1. **Depth tracking**: Each `properties` -> nested object or `items` -> object increments depth by 1. Arrays of primitives do not increment depth. Arrays of objects are transparent — the array wrapper itself does not add depth, only the nested object inside `items` does. The max depth across all paths is used.
2. **Union handling**: `oneOf`/`anyOf` variants are walked at the same depth as the parent. Fields are collected across all variants (union of unique names). **Nullable wrappers** (`anyOf`/`oneOf` where all variants except one are `{ type: 'null' }`) are not counted as unions — they represent `z.nullable()`, not a genuine branching choice.
3. **Intersection handling**: `allOf` sub-schemas are walked at the same depth. Fields accumulate.
4. **Field counting**: Unique field names across the entire schema tree (including all variants). A field appearing in multiple variants is counted once.
5. **Optional ratio**: A field is optional if it does not appear in any variant's `required` array that contains it. Computed as `optionalCount / totalUniqueFields`.

### Scoring Formula

```
complexity = sum(factor * weight)

Low:      0-5   (no finding)
Medium:   6-12  (info: "Consider simplifying or adding schema examples")
High:     13-20 (warning: "Complex schema — agents may produce invalid input")
Critical: 21+   (warning: "Schema likely too complex for reliable agent use")
```

Schema complexity never produces `error` severity — it is advisory, not a hard constraint. In `strict` mode, warnings block validation, which teams can use to enforce complexity budgets.

### Rule Output

```typescript
{
  rule: 'schema-complexity',
  severity: 'warning',
  message: 'Command "auth-sign-in" has high schema complexity (score: 15)',
  commands: ['auth-sign-in'],
  suggestion: 'Consider splitting into simpler commands (e.g., "auth-sign-in-credentials", "auth-sign-in-oauth") or add input examples to the description.',
  evidence: {
    score: 15,
    breakdown: {
      fields: 6,
      nestingDepth: 0,
      unions: 1,
      intersections: 0,
      enums: 0,
      patterns: 1,
      numericBounds: 0,
      optionalFieldRatio: 2,
    },
    tier: 'high',
  },
}
```

**Score derivation for `auth-sign-in`:**

| Factor | Detail | Count | Weight | Points |
|--------|--------|-------|--------|--------|
| Fields | method, email, password, provider, scopes, redirectTo | 6 | x1 | 6 |
| Unions | 1 `oneOf` with credentials/oauth variants | 1 | x5 | 5 |
| Patterns | `email` field has `format: 'email'` | 1 | x2 | 2 |
| Optional ratio | password, scopes, redirectTo = 3/6 = 50% | `floor(0.5 * 4)` | - | 2 |
| **Total** | | | | **15** |

### API Surface

```typescript
// New options on SurfaceValidationOptions
interface SurfaceValidationOptions {
  // ...existing options...

  /** Enable schema complexity scoring. Default: true */
  checkSchemaComplexity?: boolean;

  /** Complexity score threshold for warnings. Default: 13 */
  schemaComplexityThreshold?: number;
}

// Updated rule type
type SurfaceRule =
  | /* ...existing rules... */
  | 'schema-complexity';
```

Findings from this rule integrate with the existing suppression system — teams can suppress known-complex commands they've intentionally designed:

```typescript
suppressions: ['schema-complexity:auth-sign-in']
```

### Implementation Sketch

The rule works on `JsonSchema` (already available on `SurfaceCommand`), not Zod types — so it works with both `ZodCommandDefinition` and `CommandDefinition` inputs.

```typescript
interface ComplexityBreakdown {
  fields: number;
  nestingDepth: number;
  unions: number;
  intersections: number;
  enums: number;
  patterns: number;
  numericBounds: number;
  optionalFieldRatio: number;
}

interface ComplexityResult {
  score: number;
  breakdown: ComplexityBreakdown;
}

export function checkSchemaComplexity(
  commands: SurfaceCommand[],
  threshold: number,
): SurfaceFinding[] {
  const findings: SurfaceFinding[] = [];

  for (const cmd of commands) {
    if (!cmd.jsonSchema) continue;
    const { score, breakdown } = computeComplexity(cmd.jsonSchema);
    const tier = score <= 5 ? 'low' : score <= 12 ? 'medium' : score <= 20 ? 'high' : 'critical';

    if (score >= threshold) {
      findings.push({
        rule: 'schema-complexity',
        severity: score >= 13 ? 'warning' : 'info',
        message: `Command "${cmd.name}" has ${tier} schema complexity (score: ${score})`,
        commands: [cmd.name],
        suggestion: score >= 21
          ? 'Split into simpler commands or provide a builder/wizard pattern.'
          : 'Add input examples to the description to guide agent usage.',
        evidence: { score, breakdown, tier },
      });
    }
  }

  return findings;
}

function computeComplexity(schema: JsonSchema): ComplexityResult {
  const breakdown: ComplexityBreakdown = {
    fields: 0, nestingDepth: 0, unions: 0, intersections: 0,
    enums: 0, patterns: 0, numericBounds: 0, optionalFieldRatio: 0,
  };

  const allFields = new Set<string>();
  const optionalFields = new Set<string>();

  function walk(s: JsonSchema, depth: number) {
    breakdown.nestingDepth = Math.max(breakdown.nestingDepth, depth);

    // Unions (oneOf / anyOf) — skip nullable wrappers
    const variants = s.oneOf ?? s.anyOf;
    if (variants) {
      const nonNull = variants.filter(v => v.type !== 'null');
      if (nonNull.length > 1) {
        breakdown.unions += 1;
        for (const variant of nonNull) walk(variant, depth);
      }
    }

    // Intersections
    if (s.allOf && s.allOf.length > 0) {
      breakdown.intersections += 1;
      for (const sub of s.allOf) walk(sub, depth);
    }

    // Properties
    if (s.properties) {
      const required = Array.isArray(s.required) ? s.required : [];
      for (const [name, prop] of Object.entries(s.properties)) {
        allFields.add(name);
        if (!required.includes(name)) optionalFields.add(name);

        if (prop.enum && prop.enum.length > 0) breakdown.enums += 1;
        if (prop.pattern || prop.format) breakdown.patterns += 1;
        if (prop.minimum !== undefined) breakdown.numericBounds += 1;
        if (prop.maximum !== undefined) breakdown.numericBounds += 1;

        // Recurse into nested objects (not primitive arrays)
        if (prop.type === 'object' && prop.properties) walk(prop, depth + 1);
        if (prop.type === 'array' && prop.items?.type === 'object' && prop.items?.properties) {
          walk(prop.items, depth + 1);
        }
      }
    }
  }

  walk(schema, 0);

  breakdown.fields = allFields.size;
  const ratio = allFields.size > 0 ? optionalFields.size / allFields.size : 0;
  breakdown.optionalFieldRatio = Math.floor(ratio * 4);

  const score =
    breakdown.fields * 1 +
    breakdown.nestingDepth * 3 +
    breakdown.unions * 5 +
    breakdown.intersections * 2 +
    breakdown.enums * 1 +
    breakdown.patterns * 2 +
    breakdown.numericBounds * 1 +
    breakdown.optionalFieldRatio;

  return { score, breakdown };
}
```

## Benefits

| Without | With |
|---------|------|
| Agent hits validation errors at runtime | Flagged at design time |
| Complex schemas discovered by crash | Scored and surfaced proactively |
| No guidance on when to split commands | Quantitative threshold for "too complex" |
| Schema overlap catches *duplicate* commands | Complexity catches *unusable* commands |

## Implementation Plan

- [x] Extend `JsonSchema` in `@lushly-dev/afd-core` with `oneOf`, `anyOf`, `allOf`, `not`, `const`
- [ ] Add `ComplexityBreakdown`, `ComplexityResult` types in `surface/types.ts`
- [ ] Add `computeComplexity(schema: JsonSchema)` utility in `surface/`
- [ ] Add `checkSchemaComplexity` rule function in `rules.ts`
- [ ] Add `schema-complexity` to `SurfaceRule` union type
- [ ] Add `checkSchemaComplexity`, `schemaComplexityThreshold` to `SurfaceValidationOptions`
- [ ] Wire into `validateCommandSurface()` with configurable toggle
- [ ] Add tests covering each complexity factor:
  - Flat schema (low score)
  - Discriminated union via `oneOf` (high score)
  - Nullable type via `anyOf` with `null` variant (should not count as union)
  - Nested objects (depth scoring)
  - Enum and pattern constraints
  - Graduated optional field ratio at multiple thresholds
  - Schema with `allOf` intersection
  - Deep nesting (3+ levels) to verify depth dominance and max-depth semantics
  - Array of objects (depth increments for nested object, not for the array wrapper)
- [ ] Add `auth-sign-in` as a real-world integration test (expected score: 15)
- [ ] Update surface-demo experiment to show a complex schema example

## Design Decisions

1. **Composition keywords on `JsonSchema` (resolved)**: Extended the core type with `oneOf`, `anyOf`, `allOf`, `not`, and `const`. These were already present at runtime from `zod-to-json-schema`; the type now matches reality. Fully backward-compatible (all fields optional).

2. **Cross-field dependencies dropped (resolved)**: Zod `.refine()` constraints are lost during JSON Schema conversion, making them undetectable from the schema. The most common cross-field dependency — discriminated unions where the discriminator determines required siblings — is already captured by the schema unions factor (weight 5). Attempting to detect other cross-field patterns would require operating on the Zod schema directly, which would break language-agnosticism.

3. **Graduated optional field ratio (resolved)**: Changed from binary "2 if >50% optional" to `floor(ratio * 4)`, giving 0-4 points on a smooth gradient. This avoids cliff effects where 49% and 51% optional produce drastically different scores.

4. **Nullable union filtering (resolved)**: `anyOf: [T, { type: 'null' }]` patterns (from `z.nullable()`) are not counted as schema unions. Only compositions with 2+ non-null variants score 5 points. Without this, every nullable field would inflate complexity scores.

5. **Advisory severity only (resolved)**: Schema complexity produces `info` (medium tier) or `warning` (high/critical tier), never `error`. This is an intentional design choice — complexity is heuristic and advisory. Teams that want to enforce hard limits can use `strict` mode, which promotes warnings to validation failures.

6. **Weight calibration (open)**: Current weights are heuristic. After the initial release, calibrate against real agent error rates by logging complexity scores alongside command execution failures. The `evidence.breakdown` field enables this analysis without changing the rule output format.

7. **`examples` field on `ZodCommandDefinition` (deferred)**: Out of scope for this proposal. A natural follow-up that would pair well — the rule could reduce severity when examples are provided, since agents can reference them to construct valid input.
