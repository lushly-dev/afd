# Feature Proposal: Plugin Discovery via Entry Points

## Summary

Enable opt-in plugin discovery so installed packages can contribute commands at server startup without modifying host registration code.

## Problem

Explicit command registration scales poorly for ecosystems with many independently versioned command packages.

## Scope

In scope:
- Package metadata convention for plugin entrypoint.
- Startup discovery and plugin loading.
- Collision policy and diagnostics.
- Opt-in configuration in server options.

Out of scope:
- Remote plugin marketplace.
- Runtime hot-reload of plugins.

## Requirements

- Discovery MUST be opt-in and disabled by default.
- Explicitly registered commands MUST remain supported.
- Plugin load failures MUST not crash server startup; failures are reported and skipped.
- Command name collisions MUST follow configured conflict policy.
- Plugin protocol version mismatch MUST return actionable diagnostics.
- Plugin config SHOULD be schema-validated before registration.
- Startup diagnostics SHOULD expose loaded, failed, and excluded plugins.

## Architecture / Dataflow

1. Read host dependencies and apply include/exclude rules.
2. Resolve package metadata for plugin entry.
3. Load plugin module and validate protocol contract.
4. Register plugin contributions via constrained registry API.
5. Merge with host commands using conflict policy.
6. Emit diagnostics.

## Edge Cases and Rollback

- Invalid plugin export shape: skip plugin and report reason.
- Duplicate command names across plugins: resolve per policy or fail fast.
- Unsupported plugin protocol version: skip with upgrade suggestion.
- Startup regression after enabling discovery: rollback by disabling plugin discovery option.

## Acceptance Criteria

- Host starts with discovery enabled and loads at least one plugin command.
- Plugin failure does not block non-failing plugins.
- Conflict policy is enforced and test-covered.
- Diagnostics output lists plugin status and contributed command count.

## Specification

See [plugin-discovery.spec.md](./plugin-discovery.spec.md) for full design.
