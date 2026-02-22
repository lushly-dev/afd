# Flag Schema Reference

## FlagDefinition Interface

```typescript
interface FlagDefinition {
  name: string;          // Required -- unique identifier in 'category/feature-name' format
  description: string;   // Required -- human-readable explanation of what the flag controls
  enabled: boolean;      // Required -- current on/off state
  type?: FlagType;       // Optional -- defaults to 'release'
  owner?: string;        // Optional -- person or team responsible for the flag
  createdAt?: string;    // Optional -- ISO 8601 date when the flag was added
  expiresAt?: string;    // Optional -- ISO 8601 date after which hygiene scripts warn
  requires?: string[];   // Optional -- flags that must be enabled for this flag to function
  excludes?: string[];   // Optional -- flags that are mutually exclusive with this one
}
```

## Flag Types (Fowler's Taxonomy)

| Type | Longevity | Use case | Default enabled | Cleanup expectation |
|---|---|---|---|---|
| `release` | Days to weeks | Hide unfinished features behind a gate until ready for users | Yes (default) | Remove after feature ships and stabilizes |
| `experiment` | Hours to weeks | A/B test alternative UX layouts or logic paths | No | Remove after experiment concludes |
| `ops` | Short to permanent | Kill switches, disable animations, circuit breakers | No | May remain permanently; review periodically |
| `permission` | Long-lived | Persona-gated or role-gated access to features | No | Remove only when the permission model changes |

When `type` is omitted, it defaults to `'release'`.

## Naming Conventions

### Format

```
category/feature-name
```

- **category**: One of `release`, `experiment`, `ops`, `permission`
- **feature-name**: Kebab-case descriptor of the feature or behavior
- The category prefix should match the flag's `type` field

### Examples

| Flag name | Type | Purpose |
|---|---|---|
| `release/home-v2` | release | Swap home page to v2 layout |
| `release/new-onboarding` | release | Enable redesigned onboarding flow |
| `experiment/compact-sidebar` | experiment | Test narrower sidebar layout |
| `experiment/search-ranking-v3` | experiment | Evaluate new search ranking algorithm |
| `ops/disable-animations` | ops | Kill switch for all CSS animations |
| `ops/maintenance-banner` | ops | Show maintenance notification |
| `permission/admin-tools` | permission | Expose admin-only tooling |
| `permission/beta-features` | permission | Gate beta features to opted-in users |

### Anti-patterns

| Bad name | Problem | Better name |
|---|---|---|
| `homeV2` | No category prefix, camelCase | `release/home-v2` |
| `release/Home_V2` | Not kebab-case | `release/home-v2` |
| `new-feature` | No category prefix | `release/new-feature` |
| `flag1` | Non-descriptive | `release/compact-nav` |

## Typed Constants

Define flag names as typed constants in a centralized module to prevent magic strings:

```typescript
export const FlagType = {
  Release: "release",
  Experiment: "experiment",
  Ops: "ops",
  Permission: "permission",
} as const;

export type FlagTypeValue = (typeof FlagType)[keyof typeof FlagType];

export const Flags = {
  HomeV2: "release/home-v2",
  CompactSidebar: "experiment/compact-sidebar",
  DisableAnimations: "ops/disable-animations",
  AdminTools: "permission/admin-tools",
} as const;

export type FlagName = (typeof Flags)[keyof typeof Flags];
```

Benefits:
- **Autocomplete** -- IDE suggests available flag names
- **Find all references** -- Locate every usage of a flag in one search
- **Compile-time safety** -- Typos caught before runtime
- **Refactoring** -- Rename propagates automatically

## Seed Data Format

Flags are typically stored in a JSON seed file that provides the initial catalog:

```json
{
  "flags": {
    "release/home-v2": {
      "name": "release/home-v2",
      "description": "Enable the redesigned home page layout",
      "enabled": false,
      "type": "release",
      "owner": "frontend-team",
      "createdAt": "2026-01-15T00:00:00Z",
      "expiresAt": "2026-04-01T00:00:00Z"
    },
    "ops/disable-animations": {
      "name": "ops/disable-animations",
      "description": "Kill switch to disable all CSS animations for performance",
      "enabled": false,
      "type": "ops",
      "owner": "platform-team",
      "createdAt": "2026-01-20T00:00:00Z"
    }
  }
}
```

## Dependencies and Exclusions

### requires (Dependencies)

A flag can declare that other flags must be enabled for it to function:

```json
{
  "name": "release/enhanced-dashboard",
  "requires": ["release/new-data-layer"],
  "enabled": false
}
```

When enabling `release/enhanced-dashboard`, validation warns if `release/new-data-layer` is off.

### excludes (Mutual Exclusions)

A flag can declare flags that conflict with it:

```json
{
  "name": "experiment/layout-a",
  "excludes": ["experiment/layout-b"],
  "enabled": false
}
```

When enabling `experiment/layout-a`, validation warns if `experiment/layout-b` is already on.

### Validation Behavior

| Scenario | Validation result |
|---|---|
| Enable A, A requires B, B is on | Pass |
| Enable A, A requires B, B is off | Warning: "Flag A requires B which is currently disabled" |
| Enable A, A excludes C, C is off | Pass |
| Enable A, A excludes C, C is on | Warning: "Flag A conflicts with C which is currently enabled" |
| Enable A, A has expired | Warning: "Flag A expired on [date], consider cleanup" |

Validation produces warnings, not hard failures, so operators can override when necessary.

## Expiry and Hygiene

### Expiry Dates

Release flags should always have an `expiresAt` date. This creates a forcing function for cleanup:

- **Set at creation** -- Choose a date 2-8 weeks after expected launch
- **Hygiene scripts check** -- Automated checks flag entries past their expiry
- **Does not auto-disable** -- Expiry is advisory; the flag remains functional

### Hygiene Script Checks

A hygiene compliance script should verify:

1. **Expired flags** -- Flags past their `expiresAt` date
2. **Orphaned references** -- Flags used in code but missing from the seed catalog
3. **Undefined flags** -- Flags in the seed catalog but never referenced in code
4. **Missing descriptions** -- Flags without a `description` field
5. **Missing owners** -- Flags without an `owner` field
6. **Release flags without expiry** -- Release-type flags missing `expiresAt`

Run the hygiene script as part of CI or pre-commit checks to maintain flag discipline.
