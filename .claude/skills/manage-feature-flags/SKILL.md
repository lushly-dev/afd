---
name: manage-feature-flags
source: botcore
description: >
  Guides implementation and lifecycle management of feature flag systems with reactive stores, declarative gating elements, and handler delegation patterns. Covers flag definition schemas (types, expiry, dependencies, exclusions), flag store singletons, declarative frontend gating via custom elements, backend handler delegation for command variants, naming conventions, lifecycle management (creation, validation, cleanup), and hygiene compliance checks. Use when adding feature flags, gating UI components, swapping backend implementations behind flags, managing flag lifecycle, or auditing stale flags. Triggers: flag, feature flag, toggle, gate, feature toggle, variant, flag store, flag hygiene, kill switch.

version: 1.0.0
triggers:
  - flag
  - feature flag
  - toggle
  - gate
  - feature toggle
  - variant
  - flag store
  - flag hygiene
  - kill switch
  - gating
  - flag lifecycle
portable: true
---

# Managing Feature Flags

Design, implement, and maintain feature flag systems with reactive state, declarative gating, and disciplined lifecycle management.

## Capabilities

1. **Define flags** -- Model flags with typed schemas covering state, type classification, ownership, expiry, dependencies, and mutual exclusions
2. **Implement flag stores** -- Build reactive singleton stores that persist flag state and notify consumers of changes
3. **Gate frontend rendering** -- Use declarative custom elements or conditional templates to swap UI based on flag state
4. **Delegate backend handlers** -- Route command or request handling to different implementations behind a stable API contract
5. **Manage flag lifecycle** -- Add, validate, expire, and clean up flags through deterministic workflows
6. **Enforce hygiene** -- Detect orphaned references, expired flags, undefined usages, and missing metadata via automated checks

## Routing Logic

| Request type | Load reference |
|---|---|
| Flag schema, types, naming conventions | [references/flag-schema.md](references/flag-schema.md) |
| Gating patterns (frontend and backend) | [references/gating-patterns.md](references/gating-patterns.md) |

## Core Principles

### 1. Categorize by Longevity and Purpose

Flags serve different purposes and have different lifespans. Use a type taxonomy to set expectations for cleanup:

| Type | Longevity | Use case | Default enabled |
|---|---|---|---|
| `release` | Days to weeks | Hide unfinished features until ready | Yes |
| `experiment` | Hours to weeks | A/B test alternative UX or logic paths | No |
| `ops` | Short to permanent | Kill switches, disable animations, circuit breakers | No |
| `permission` | Long-lived | Persona-gated or role-gated features | No |

### 2. Stable API Surface

Feature flags change internal behavior, never external contracts. A flag should swap the implementation behind an endpoint, command, or component -- not create parallel APIs.

```
CORRECT:  One command, internal delegation based on flag state
WRONG:    Separate command-v1 and command-v2 exposed to consumers
```

### 3. Declarative over Imperative

Prefer declarative gating (custom elements, template directives) over scattered `if/else` checks. Declarative gates are easier to find, audit, and remove during cleanup.

### 4. Reactive State

Flag stores should be observable. When a flag changes at runtime, all gated UI and logic should react automatically without manual refresh or propagation.

### 5. Naming Convention

Use `category/feature-name` in kebab-case. The category prefix matches the flag type, making it easy to filter and audit.

```
release/home-v2
experiment/compact-sidebar
ops/disable-animations
permission/admin-tools
```

### 6. Typed Constants over Magic Strings

Define flag names as typed constants in a central module. This enables autocomplete, find-all-references, and compile-time safety.

```typescript
// Centralized constants
export const Flags = {
  HomeV2: "release/home-v2",
  CompactSidebar: "experiment/compact-sidebar",
} as const;

// Usage -- typed, searchable, refactorable
flagStore.isEnabled(Flags.HomeV2);
```

## Workflow: Add a New Flag

1. **Choose the flag type** -- Determine if it is a release, experiment, ops, or permission flag
2. **Name the flag** -- Use `category/feature-name` format in kebab-case
3. **Register in seed data** -- Add the flag definition to the seed catalog with description, type, owner, and expiry (if release)
4. **Add default state** -- Mirror the entry in default data so new environments pick it up
5. **Create a typed constant** -- Add an entry to the shared `Flags` constants object
6. **Gate the frontend** -- Use a declarative gate element or conditional rendering
7. **Gate the backend** -- Use handler delegation inside existing commands if needed
8. **Bump schema version** -- Increment the data schema version so existing clients merge the new flag
9. **Run hygiene checks** -- Execute the flag hygiene script to verify consistency
10. **Test both paths** -- Write tests covering flag-on and flag-off behavior

## Workflow: Remove a Stale Flag

1. **Remove from seed catalog** -- Delete the flag entry from the seed data file
2. **Remove typed constant** -- Delete from the centralized `Flags` object
3. **Remove all gate elements** -- Strip declarative gates and keep the winning variant inline
4. **Remove handler delegation** -- Collapse backend logic to the winning path
5. **Remove from default data** -- Delete from the defaults object
6. **Run hygiene checks** -- Verify no orphaned references remain
7. **Bump schema version** -- Increment so existing clients sync the removal

## Quick Reference

### Flag Definition Schema

```typescript
interface FlagDefinition {
  name: string;          // 'category/feature-name' format
  description: string;   // Human-readable purpose
  enabled: boolean;      // Current state
  type?: FlagType;       // 'release' | 'experiment' | 'ops' | 'permission'
  owner?: string;        // Responsible person or team
  createdAt?: string;    // ISO 8601 date
  expiresAt?: string;    // ISO 8601 date -- triggers hygiene warnings
  requires?: string[];   // Dependency flags that must be enabled
  excludes?: string[];   // Mutually exclusive flags
}
```

### Declarative Frontend Gating

```html
<!-- Swap between enabled/disabled content -->
<flag-gate flag="release/home-v2">
  <home-v2 slot="enabled"></home-v2>
  <home-v1 slot="disabled"></home-v1>
</flag-gate>

<!-- Show-only: no fallback when flag is off -->
<flag-gate flag="ops/copilot-panel">
  <copilot-panel slot="enabled"></copilot-panel>
</flag-gate>

<!-- Inverted: show content when flag is OFF -->
<flag-gate flag="ops/disable-animations" invert>
  <div slot="enabled" class="animated-intro">...</div>
</flag-gate>
```

### Backend Handler Delegation

```typescript
// Correct: single command, internal delegation
export const myCommand = defineCommand({
  name: "my-command",
  async handler(input) {
    return flagStore.isEnabled(Flags.MyFeatureV2)
      ? handleV2(input)
      : handleDefault(input);
  },
});

// Wrong: separate commands for variants
export const myCommandV1 = defineCommand({ name: "my-command-v1" });
export const myCommandV2 = defineCommand({ name: "my-command-v2" });
```

### Validation Rules

| Rule | Behavior |
|---|---|
| Dependency check | If flag A `requires` flag B, warn when enabling A while B is off |
| Exclusion check | If flag A `excludes` flag B, warn when enabling A while B is on |
| Expiry check | Warn when a flag is past its `expiresAt` date |
| Orphan check | Flag referenced in code but missing from seed catalog |
| Undefined check | Flag in seed catalog but never referenced in code |

## Checklist

- [ ] Flag name follows `category/feature-name` convention in kebab-case
- [ ] Flag added to seed data catalog with all required fields
- [ ] Flag mirrored in default data for new environment bootstrapping
- [ ] Typed constant created in centralized `Flags` object
- [ ] `description` clearly explains what the flag controls
- [ ] `expiresAt` set for release flags
- [ ] `owner` field identifies the responsible person or team
- [ ] Frontend gated with declarative gate element or conditional template
- [ ] Backend gated with handler delegation (if applicable)
- [ ] Tests cover both flag-on and flag-off paths
- [ ] Hygiene script passes with no warnings
- [ ] Schema version bumped so existing clients pick up the new flag

## When to Escalate

- **Cross-service flags** -- If a flag must be synchronized across multiple services or deployments, consider a centralized flag management platform (LaunchDarkly, Split, Unleash) rather than local stores
- **Percentage rollouts** -- If a flag needs gradual rollout by percentage or cohort, the simple boolean model is insufficient; evaluate a feature management service
- **Audit requirements** -- If regulatory or compliance needs require a full audit trail of flag changes, implement server-side logging beyond local storage
- **Flag explosion** -- If the flag count exceeds 30-50 active flags, schedule a cleanup sprint and enforce stricter expiry policies
- **Runtime conflicts** -- If dependency/exclusion validation produces cascading warnings, revisit the flag dependency graph for simplification
