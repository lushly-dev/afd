# Surface Validation (Semantic Quality)

Cross-command analysis that detects semantic collisions, naming ambiguities, schema overlaps, and prompt injection risks. Designed for command sets where agents struggle to pick the right tool.

## When to Use

- Command set has grown to 20+ commands
- Agents are calling the wrong tool due to similar descriptions
- Multiple commands accept the same input fields
- Naming conventions are inconsistent across domains

## API

```typescript
import { validateCommandSurface } from '@lushly-dev/afd-testing';

const result = validateCommandSurface(commands, {
  similarityThreshold: 0.7,        // Description similarity warning threshold
  schemaOverlapThreshold: 0.8,     // Schema overlap warning threshold
  detectInjection: true,           // Scan for prompt injection patterns
  checkDescriptionQuality: true,   // Check description length + verb presence
  minDescriptionLength: 20,        // Minimum description character count
  enforceNaming: true,             // Enforce kebab-case naming pattern
  namingPattern: /^[a-z][a-z0-9]*-[a-z][a-z0-9-]*$/,
  skipCategories: ['internal'],    // Exclude categories from analysis
  strict: false,                   // true = warnings count as errors
  suppressions: [],                // Suppress specific findings
  additionalInjectionPatterns: [], // Custom injection patterns
  checkSchemaComplexity: true,     // Score input schema complexity
  schemaComplexityThreshold: 13,   // Score threshold for warnings
});
```

## Result Shape

```typescript
interface SurfaceValidationResult {
  valid: boolean;                  // true if no errors (+ no warnings if strict)
  findings: SurfaceFinding[];     // All findings (including suppressed)
  summary: {
    commandCount: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    suppressedCount: number;
    rulesEvaluated: SurfaceRule[];
    durationMs: number;
  };
}

interface SurfaceFinding {
  rule: SurfaceRule;
  severity: 'error' | 'warning' | 'info';
  message: string;
  commands: string[];
  suggestion: string;
  evidence?: Record<string, unknown>;
  suppressed?: boolean;
}
```

## 9 Validation Rules

### 1. Similar Descriptions (`similar-descriptions`)
**Severity:** Warning

Detects command pairs with highly similar descriptions using token-based cosine similarity. Similar descriptions confuse agents when selecting tools.

```typescript
// These would trigger:
// "Retrieves a user by their unique identifier"
// "Fetches a user by their unique identifier"
```

### 2. Schema Overlap (`schema-overlap`)
**Severity:** Warning

Detects command pairs sharing a high percentage of top-level input fields. High overlap suggests commands should be merged or differentiated.

### 3. Naming Convention (`naming-convention`)
**Severity:** Error

Validates command names match the kebab-case `domain-action` pattern (e.g., `user-create`, `order-list`). Default pattern: `/^[a-z][a-z0-9]*-[a-z][a-z0-9-]*$/`.

### 4. Naming Collision (`naming-collision`)
**Severity:** Error

Detects command names that collide when separators are normalized (e.g., `user-create` vs `userCreate` vs `user_create`).

### 5. Missing Category (`missing-category`)
**Severity:** Info

Flags commands without a `category` field. Categories help agents organize and filter commands.

### 6. Description Injection (`description-injection`)
**Severity:** Error

Scans descriptions for prompt injection patterns:
- **Imperative override** — "you must", "always do", "ignore previous"
- **Role assignment** — "you are a", "act as"
- **System prompt fragment** — "system prompt", "system message"
- **Hidden instruction** — invisible characters, zero-width spaces

### 7. Description Quality (`description-quality`)
**Severity:** Warning

Checks that descriptions are:
- At least 20 characters (configurable)
- Contain an action verb (from built-in verb list: get, create, update, delete, list, search, etc.)

### 8. Orphaned Category (`orphaned-category`)
**Severity:** Info

Flags categories with only one command, which may indicate misclassification.

### 9. Schema Complexity (`schema-complexity`)
**Severity:** Warning (high/critical) or Info (medium)

Scores each command's input schema complexity and flags schemas likely to cause agent input errors. Dimensions scored: field count, nesting depth, unions (oneOf/anyOf), intersections (allOf), enum/pattern/bound constraints, and optional field ratio.

Weighted formula: `fields(×1) + depth(×3) + unions(×5) + intersections(×2) + enums(×1) + patterns(×2) + bounds(×1) + optionalRatio`

| Tier | Score | Finding |
|------|-------|---------|
| Low | 0-5 | No finding |
| Medium | 6-12 | Info |
| High | 13-20 | Warning |
| Critical | 21+ | Warning |

Never produces `error` severity. Nullable wrappers (`anyOf: [T, { type: 'null' }]`) are excluded from union counting. `const` (from `z.literal()`) is not counted as enum.

```typescript
// Use computeComplexity() directly for schema analysis
import { computeComplexity } from '@lushly-dev/afd-testing';

const result = computeComplexity(jsonSchema);
// { score: 15, tier: 'high', breakdown: { fields: 6, depth: 1, unions: 1, ... } }
```

## Suppression System

Suppress findings at the rule level or for specific command pairs:

```typescript
const result = validateCommandSurface(commands, {
  suppressions: [
    'missing-category',                          // All missing-category findings
    'schema-complexity:auth-sign-in',            // Single command suppression
    'similar-descriptions:user-get:user-fetch',  // Only this pair (order-independent)
  ],
});
```

Suppressed findings are still included in `result.findings` with `suppressed: true` but don't affect `result.valid` or severity counts.

## Input Normalization

`validateCommandSurface()` accepts both input types:

- **`ZodCommandDefinition[]`** (from `@lushly-dev/afd-server`) — detected by `jsonSchema` property
- **`CommandDefinition[]`** (from `@lushly-dev/afd-core`) — detected by `parameters` array, auto-converted to JSON Schema

Both are normalized to an internal `SurfaceCommand` type before analysis.

## CLI Integration

```bash
# Run against connected MCP server
afd validate --surface

# Custom thresholds
afd validate --surface --similarity-threshold 0.8

# Skip categories and suppress rules
afd validate --surface --skip-category internal --suppress missing-category

# Strict mode (warnings = errors) with details
afd validate --surface --strict --verbose
```

## Similarity Algorithm

Uses token-based cosine similarity (dependency-free):
1. Tokenize descriptions (lowercase, remove punctuation)
2. Remove English stop words
3. Build term-frequency vectors
4. Compute cosine similarity (0 = unrelated, 1 = identical)

Sufficient for short command descriptions (1-2 sentences). For longer text or cross-language comparison, consider embedding models.
