# Feature Proposal: Command Skill / Knowledge Layer

> **Spec:** [skill-knowledge-layer.spec.md](./skill-knowledge-layer.spec.md)

## Summary

Add optional command skill documents co-located with commands to provide agent-facing usage guidance beyond schemas.

## Problem

Command schemas describe structure but not strategy, sequencing, and anti-patterns.

## Scope

In scope:
- Skill document format with frontmatter.
- Command-to-skill linkage.
- Discovery command for skill retrieval.
- Validation pass for quality and coverage.

Out of scope:
- Mandatory skill docs for all commands.
- Replacing existing editor-focused skill systems.

## Requirements

- Command skill support MUST be optional and non-breaking.
- Skill docs MUST have parseable frontmatter with at least `name` and `description`.
- The system MUST resolve skill references from source-tree paths.
- Validation MUST detect missing frontmatter, broken refs, and orphaned docs.
- Discovery output SHOULD support summary and full-body formats.
- Teams MAY enforce coverage in strict mode.

## Architecture / Dataflow

1. Command definitions include optional skill reference.
2. Loader discovers and parses skill documents.
3. Resolver maps skills to commands/categories.
4. Bootstrap command returns skill summaries/full content.
5. Validation reports findings for CI gating.

## Edge Cases and Error States

- Missing skill file path: report broken reference.
- Invalid frontmatter: report parse error with file target.
- Duplicate coverage: warning with conflicting skill names.
- Large skill body: warning based on configurable length threshold.

## Acceptance Criteria

- Commands without skills continue working unchanged.
- At least one command-level and one category-level skill are discoverable.
- Validation catches malformed and orphaned skills.
- Discovery command returns both summary and full formats.

## Task Breakdown

1. Skill type and parser.
2. Resolver and discovery utilities.
3. Bootstrap command.
4. Validator rules.
5. CLI validation integration.
