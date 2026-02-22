---
name: {skill-name}  # Must match parent directory name
description: >
  {What this skill does}. {What content it covers}.
  Use when {scenarios}.
version: "1.0.0"
triggers:
  - {keyword1}
  - {keyword2}
  - {keyword3}
# portable: true                   # Uncomment if this skill is used across multiple projects
# license: MIT                     # SPDX identifier (open standard)
# compatibility: >                 # Platform/version notes (open standard)
#   Claude Code 2.x, VS Code Copilot
# metadata:                        # Custom key-value pairs (open standard)
#   author: team-name
# allowed-tools:                   # Restrict tool access (experimental)
#   - Read
#   - Grep
# context: fork                    # Run in isolated subagent
# user-invocable: true             # Show in slash-command menu
# disable-model-invocation: false  # Set true for user-only skills
# agent: general-purpose           # Agent type (Explore, Plan, custom)
# model: claude-sonnet             # Override model
# argument-hint: "file path"       # Argument placeholder hint
# hooks:                           # Guardrail/janitor hooks
#   - event: PreToolUse
#     matcher: Write
#     command: "${CLAUDE_PLUGIN_ROOT}/hooks/check.sh"
---

# {Skill Title}

{One-line description of the skill's purpose.}

<!-- Optional: Use XML tags for better LLM parsing
<context>
Background information the AI needs to understand this skill's domain.
</context>

<rules>
Hard rules that must always be followed.
</rules>
-->

## Capabilities

1. **{Capability 1}** — {Brief description}
2. **{Capability 2}** — {Brief description}

<!-- ============================================================
     OPTIONAL SECTIONS BELOW
     Delete sections that don't apply to your skill.
     See guidance at end of template for when to include each.
     ============================================================ -->

## Routing Logic

| Request type | Load reference |
|--------------|----------------|
| {Topic 1} | [references/{topic1}.md](references/{topic1}.md) |
| {Topic 2} | [references/{topic2}.md](references/{topic2}.md) |

## Core Principles

### 1. {Principle Name}

{Description of the principle and why it matters.}

### 2. {Principle Name}

{Description of the principle and why it matters.}

## Quick Reference

```{language}
// Example code or commands
```

## Workflow

<!-- Freedom level guidance:
     - Narrow Bridge: For deterministic tasks (linting, formatting, validation)
       — provide exact steps, specific commands, no ambiguity
     - Open Field: For judgment-based tasks (code review, design, analysis)
       — provide heuristics, priorities, and decision frameworks
     Choose one approach and be consistent throughout. -->

1. **{Step 1}**: {What to do}
2. **{Step 2}**: {What to do}
3. **{Step 3}**: {What to do}

## Verification

Before completing, run:
```bash
{verification-command}
```
Confirm zero errors before finishing.

## Checklist

- [ ] {Check item 1}
- [ ] {Check item 2}
- [ ] {Check item 3}

## Hooks

<!-- Remove this section if your skill doesn't use hooks -->
This skill includes automatic guardrails:
- **Pre-write check**: {description}
- **Post-write format**: {description}

## Automated Checks

<!-- Remove this section if your skill doesn't use scripts -->
Do NOT perform {task} manually. Use the provided script:
```bash
python ${CLAUDE_PLUGIN_ROOT}/scripts/{script-name}.py {args}
```
The script outputs JSON with {description of output}. Interpret results and suggest fixes.

## When to Escalate

- {Situation requiring human review}
- {Edge case not covered by this skill}

<!-- ============================================================
     SECTION GUIDANCE

     Required:
     - Frontmatter (name, description, version, triggers)
     - H1 title + one-line description
     - Capabilities (at least one)

     Include XML tags (<context>, <rules>) when:
     - Skill has important background that must always be loaded
     - Hard rules exist that the AI must never violate

     Include Routing Logic when:
     - Skill has reference files in references/ folder
     - Skill covers multiple distinct topics

     Include Core Principles when:
     - Skill has non-obvious patterns or philosophy
     - There are important "why" explanations

     Include Quick Reference when:
     - Skill has common commands, syntax, or patterns
     - Users need fast lookup of key information

     Include Workflow when:
     - Skill involves multi-step processes
     - Order of operations matters
     - Choose Narrow Bridge (exact steps) for deterministic tasks
       or Open Field (heuristics) for judgment tasks

     Include Verification when:
     - Skill produces output that can be machine-checked
     - A CLI command or script can confirm correctness

     Include Checklist when:
     - Skill has verification steps
     - Quality gates need checking

     Include Hooks when:
     - Skill needs automatic guardrails (PreToolUse, PostToolUse)
     - Pre/post processing should run on tool calls

     Include Automated Checks when:
     - Skill has resource scripts in scripts/ folder
     - Deterministic work should be offloaded to scripts

     Include When to Escalate when:
     - Skill involves judgment calls
     - There are edge cases not covered
     - Human review may be needed

     Include portable: true when:
     - Skill is used across multiple projects
     - Skill is distributed via shared skills directory
     ============================================================ -->
