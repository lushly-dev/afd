# Feature Proposal: Multi-Tool Registration Automation

## Summary

Create an `afd register` CLI command to detect installed AI tools and write the required MCP server configuration in each tool-specific format.

## Problem

Manual per-tool JSON editing causes setup friction, onboarding failures, and inconsistent configurations.

## Scope

In scope:
- Detect supported tools and config locations.
- Generate and merge MCP config entries.
- Dry-run preview and idempotent apply.
- Optional remove/unregister flow.

Out of scope:
- Managing third-party credential stores.
- Unsupported tools without documented config formats.

## Requirements

- The command MUST detect supported tools and report confidence.
- The command MUST generate valid tool-specific configuration structures.
- The command MUST be idempotent when run repeatedly.
- The command MUST support dry-run with a human-readable diff/preview.
- Existing non-AFD entries MUST be preserved during merge.
- The command SHOULD support manifest-driven team defaults.
- The command SHOULD return explicit error codes and recovery suggestions.

## Architecture / Dataflow

1. Detect tools and config locations.
2. Load manifest or infer defaults.
3. Read existing config.
4. Merge or remove AFD entry.
5. Validate output and write atomically with backup/restore.

## Edge Cases and Safety

- Unsupported scope for a tool: fail with explicit scope-not-supported error.
- Conflicting existing entry: prompt unless `--force` is set.
- Invalid JSON/JSONC: fail safely and preserve original file unchanged.
- Partial write failure: restore backup and report rollback performed.

## Acceptance Criteria

- Dry-run shows intended changes for each detected tool.
- Apply writes valid config for at least VS Code and one additional tool.
- Re-running apply does not duplicate entries.
- Remove deletes only target AFD entry and preserves all others.
- Error paths provide actionable suggestions.

## Task Breakdown

1. Detection layer.
2. Manifest schema and validation.
3. Per-tool writer/merger adapters.
4. CLI command and subcommands.
5. Tests for idempotency, merge safety, and rollback.

## Specification

See [multi-tool-registration.spec.md](./multi-tool-registration.spec.md) for the full technical specification.
