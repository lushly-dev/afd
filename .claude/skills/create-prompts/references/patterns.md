# Prompt Patterns

Proven patterns for VS Code prompt files, with complete examples. Choose based on the task.

## Pattern 1: Review

**Use when:** Evaluating code, content, designs, or specs against standards.

**Structure:** Task + checklist + output table.

**Key trait:** Set `agent: ask` since reviews are read-only.

```markdown
---
description: Review the current file for accessibility compliance
agent: ask
---

# Review accessibility

Evaluate ${file} against WCAG 2.2 AA requirements.

## Checklist

- [ ] Keyboard navigation for all interactive elements
- [ ] ARIA roles and labels properly applied
- [ ] Focus indicators visible
- [ ] Color not the only means of conveying information
- [ ] Form inputs have associated labels

## Output

| Severity     | Issue       | Location     | WCAG      | Fix        |
| ------------ | ----------- | ------------ | --------- | ---------- |
| High/Med/Low | Description | Line/element | Criterion | How to fix |
```

## Pattern 2: Generate

**Use when:** Creating new files, components, or content from a template.

**Structure:** Requirements + constraints + file output instructions.

**Key trait:** Set `agent: agent` and use `${input:name}` for parameterization.

```markdown
---
description: Generate a new FAST Element v2 component
argument-hint: component name (e.g., data-grid)
agent: agent
tools:
  - create_file
  - read_file
---

# Create component

Create a new FAST Element v2 component named ${input:componentName}.

## Requirements

- Follow the pattern in src/components/sample-card/
- Create three files: component.ts, template.ts, styles.ts
- Use design tokens for all colors and spacing
- Register the component in src/main.ts

## Constraints

- No inline styles -- use css tagged template
- No hardcoded colors -- use design tokens
- Export the component class
```

## Pattern 3: Summarize

**Use when:** Condensing meeting notes, research, discussions, or long documents.

**Structure:** Input description + output template with placeholder sections.

**Key trait:** Provide the exact Markdown template the response should fill in.

```markdown
---
description: Create a structured summary from meeting notes or transcript
agent: ask
---

# Summarize meeting

Convert the provided meeting notes into a structured summary.

## Output Format

## [Meeting Title]

**Date:** [Date]
**Attendees:** [Names]

### Summary

[2-3 sentence overview]

### Key Decisions

- [Decision 1]
- [Decision 2]

### Action Items

| Action | Owner    | Due Date |
| ------ | -------- | -------- |
| [Task] | [Person] | [Date]   |

### Open Questions

- [Unresolved items]
```

## Pattern 4: Delegate to Skill

**Use when:** The prompt is a thin entry point that invokes a Claude skill for deep expertise.

**Structure:** Minimal prompt body that loads a skill file.

**Key trait:** Keeps the prompt short -- the skill has the real logic and references.

```markdown
---
description: Apply content design patterns to review content
---

# Review content

**Skill:** Load the `content-design` skill for comprehensive guidance.

Review the provided content for voice, tone, clarity, and UX writing patterns.
Apply the appropriate patterns from the skill for the content type (error message,
label, tooltip, empty state, etc.).

Provide: analysis, revised content, and rationale for each change.
```

## Pattern 5: Transform

**Use when:** Converting content from one format to another.

**Structure:** Input format + output format + transformation rules.

**Key trait:** Use `${selection}` to operate on selected text.

```markdown
---
description: Convert selected TypeScript interfaces to Zod schemas
agent: ask
---

# Convert to Zod

Transform the selected TypeScript interfaces into Zod schemas.

## Input

${selection}

## Rules

- `string` -> `z.string()`
- `number` -> `z.number()`
- `boolean` -> `z.boolean()`
- Optional fields (`?:`) -> `.optional()`
- Arrays -> `z.array()`
- Nested objects -> nested `z.object()`
- Add `.describe()` with the original field comment if present

## Output

Return only the Zod schema code. No explanation needed.
```

## Pattern 6: Multi-step Workflow

**Use when:** The task requires sequential steps with decision points.

**Structure:** Numbered steps with conditions and branching.

**Key trait:** Use `agent: plan` for complex tasks that benefit from exploration first.

```markdown
---
description: Scaffold a complete command with tests
argument-hint: command name (e.g., list-items)
agent: plan
tools:
  - create_file
  - read_file
  - grep_search
  - run_in_terminal
---

# Create command

Create a new command named ${input:commandName}.

## Steps

1. **Research** -- Read src/commands/ to understand existing patterns
2. **Define schema** -- Create input/output schemas
3. **Implement handler** -- Write the command handler
4. **Register** -- Add to src/commands/index.ts
5. **Test** -- Create a test file in tests/
6. **Verify** -- Run `npm test` to confirm
```

## Pattern 7: Session Init / Bootstrap

For preparing an agent with domain knowledge before a working session. The user runs the prompt, the agent loads context, and then the user starts asking questions or assigning tasks.

**When to use:** The task requires deep domain knowledge from skills, docs, or tools that the agent would not have by default. The user expects the agent to be an informed collaborator.

**Key traits:**

- `agent: agent` in frontmatter (needs to read files and call tools)
- `tools` scoped to what is needed for initialization (e.g., MCP status checks)
- Instructions load skills via `read_file` references (not just mention them)
- Verify tool connectivity before claiming readiness
- Structured readiness report showing what was loaded and what is available
- The agent does NOT start working on tasks -- it reports readiness and waits

```markdown
---
description: "[repo-prefix] Initialize a session for [purpose]"
agent: agent
tools: ['mcp_server/*']
---

# [Purpose] Session Init

Bootstrap your agent with the knowledge and tools needed for [purpose].

## Context

Explain what this session type involves and why initialization matters.

## Instructions

1. Read the [skill-name] skill at [path](...)
2. Read key reference docs
3. Verify tool connectivity (call status check, note CLI availability)
4. Present the readiness report

## Readiness Report

[Purpose] session ready:
Skills loaded: skill-a, skill-b
Docs: key-doc.md loaded
Tools: MCP {status}, CLI {status}

I can help with:
- Capability 1
- Capability 2

## Important

- Read skills fully -- load content into working memory, don't just acknowledge
- Verify connectivity before claiming readiness
- Don't start working on tasks -- report readiness and wait for the user
```

## Agent Task Prompts

For interactive, multi-step workflows that require tool execution. This is a variant of Multi-step Workflow that emphasizes decision points and structured output.

**Key traits:**

- `agent: agent` in frontmatter
- Numbered step-by-step instructions
- Decision points (ask user, check conditions)
- References to specific tools and commands
- Structured output template
- An Important section with guardrails

```markdown
---
description: "[repo-prefix] Check content for contradictions"
agent: agent
tools: ["mcp_server/*"]
---

# Coherence Check

Cross-reference content for contradictions and drift.

## Instructions

1. Ask which path to check
2. Read all `.md` files in the target path
3. Analyze for contradictions, stale references, temporal inconsistency
4. For each finding, report the sources, statements, and suggested resolution

## Output Format

| #   | Entry A | Entry B | Issue | Resolution |
| --- | ------- | ------- | ----- | ---------- |

## Important

- Read-only analysis -- do not modify files unless asked
- Flag items for author review
```

## Choosing a Pattern

| Signal                                     | Pattern         |
| ------------------------------------------ | --------------- |
| Evaluating against standards               | Review          |
| Creating new files or content              | Generate        |
| Condensing long content                    | Summarize       |
| Entry point into a skill                   | Delegate        |
| Converting between formats                 | Transform       |
| Sequential steps with conditions           | Multi-step      |
| Preparing agent for a session              | Session Init    |
| Needs to run commands or call tools        | Agent Task      |
| User provides input, gets formatted result | Generate        |
| Modifies files                             | Agent Task      |

## Combining Patterns

A prompt can blend patterns -- for example, a Session Init prompt that also produces a template (the readiness report). The primary pattern determines the frontmatter; secondary elements go in the body.

## Naming Convention

| Pattern               | Example                                                       |
| --------------------- | ------------------------------------------------------------- |
| `review-{topic}`      | `review-content.prompt.md`, `review-accessibility.prompt.md`  |
| `create-{thing}`      | `create-component.prompt.md`, `create-command.prompt.md`      |
| `generate-{output}`   | `generate-alt-text.prompt.md`, `generate-spec.prompt.md`      |
| `summarize-{input}`   | `summarize-meeting.prompt.md`, `summarize-research.prompt.md` |
| `convert-{transform}` | `convert-to-zod.prompt.md`, `convert-to-markdown.prompt.md`   |
| `init-{purpose}`      | `init-kb-review.prompt.md`, `init-session.prompt.md`          |

## Anti-patterns

### Too vague

```markdown
# Bad -- no structure, no output format
Help me with my code.
```

### Too long

If a prompt exceeds ~200 lines, extract the deep content into a skill with references. The prompt should be a thin entry point.

### Duplicating instructions

```markdown
# Bad -- these rules belong in AGENTS.md or .instructions.md, not a prompt
Always use Biome for formatting.
Always use design tokens.
Never use inline styles.
```

### Multiple unrelated tasks

```markdown
# Bad -- do one thing well
Review accessibility AND generate documentation AND fix lint errors.
```
