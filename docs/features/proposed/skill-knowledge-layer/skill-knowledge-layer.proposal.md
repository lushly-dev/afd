# Feature Proposal: Command Skill / Knowledge Layer

> **Spec:** [skill-knowledge-layer.spec.md](./skill-knowledge-layer.spec.md)

## 1. Summary
Introduce an optional command skill layer to bundle agent-facing documentation alongside commands, providing richer context than schemas alone.

## 2. Motivation
As command sets grow, agents need more than input schemas—they need guidance on when and why to use a command, what patterns work well, and what to avoid. Currently, AFD lacks a dedicated knowledge layer for this prose-based guidance.

## 3. Proposed Solution
- Allow commands to have associated command skill documents (`.skill.md` files with YAML frontmatter).
- Co-locate skill docs with commands in the source tree (not `.claude/skills/`, which serves a different purpose — see spec for details).
- Make command skills discoverable alongside command definitions via the `skill-docs` bootstrap command.
- Implement a validation pass to check quality (no orphans, no missing skills, naming, description completeness).
- Focus content strictly on *agent guidance* — when/why/how to call commands.

*Note: The three-tier ownership model from Botcore is deferred to avoid unnecessary complexity at this stage.*

## 4. Breaking Changes
**Low.** This is additive unless `ZodCommandDefinition` grows a required `skill` field. The `skill` field should remain optional. If a strict mode is introduced in the linter that requires skill docs, it must be opt-in to avoid breaking existing projects.

## 5. Alternatives Considered
- Relying solely on command descriptions. This is insufficient for complex workflows that require strategic guidance.
- Maintaining separate documentation repositories, which often drift from the actual implementation.
- Using the existing Claude Code skills system (`.claude/skills/`). Rejected because it serves a different audience (IDE developers vs runtime MCP agents) and mixing the two would bloat Claude Code's context.
