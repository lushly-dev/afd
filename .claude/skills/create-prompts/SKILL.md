---
name: create-prompts
source: botcore
description: >
  Provides expert guidance for creating VS Code Copilot prompt files (.prompt.md) used as reusable slash commands. Covers frontmatter schema, agent modes, tool scoping, variables, prompt patterns (review, generate, summarize, delegate, transform, multi-step, session init), naming conventions, and best practices. Use when creating new prompt files, reviewing prompt quality, designing prompt architecture, or improving existing prompts. Triggers: prompt file, .prompt.md, slash command, create prompt, prompt template, agent prompt, copilot prompt, reusable prompt, /command.

version: 1.0.0
triggers:
  - prompt file
  - .prompt.md
  - slash command
  - create prompt
  - prompt template
  - agent prompt
  - copilot prompt
  - reusable prompt
  - /command
  - prompt patterns
portable: true
---

# Creating VS Code Copilot Prompt Files

Expert guidance for creating effective VS Code prompt files (`.prompt.md`) -- reusable slash commands for GitHub Copilot chat.

## Capabilities

1. **Create prompts** -- Generate new `.prompt.md` files with proper frontmatter and body structure
2. **Review prompts** -- Evaluate existing prompts for clarity, structure, tool scoping, and effectiveness
3. **Pattern guidance** -- Apply proven prompt patterns (review, generate, summarize, delegate, transform, multi-step, session init)
4. **Improve prompts** -- Refactor prompts to use variables, explicit output formats, tool restrictions, and better structure
5. **Architecture advice** -- Design prompt sets for teams, including naming conventions, file organization, and layering with instructions and agents

## Routing Logic

| Request type                                | Load reference                                                       |
| ------------------------------------------- | -------------------------------------------------------------------- |
| Frontmatter fields, schema, file format     | [references/format.md](references/format.md)                         |
| Prompt patterns and examples                | [references/patterns.md](references/patterns.md)                     |
| Tool scoping, MCP tools, built-in tools     | [references/tools.md](references/tools.md)                           |
| Variables, input, dynamic content           | [references/variables.md](references/variables.md)                   |
| Best practices, anti-patterns, naming       | [references/best-practices.md](references/best-practices.md)         |

## Core Principles

### 1. One Purpose Per Prompt

Each prompt file should do one thing well. A prompt that reviews content should not also generate new content. If a task has sub-steps, decompose into multiple prompts or delegate to a skill/custom agent.

### 2. Description Is Discovery

The `description` field is the only UI-visible context in the `/` slash command menu. Make it specific and action-oriented so users know exactly when to invoke it. Prefix with a repo identifier (e.g., `[my-repo]`) when prompts from multiple repos may appear together.

### 3. Structure Drives Quality

Use Markdown headings to organize prompts into clear sections. Structured prompts consistently outperform wall-of-text instructions. Minimum viable structure: frontmatter with `description`, a title heading, a task section, and an output section.

### 4. Define Output Format Explicitly

The single biggest improvement to any prompt is specifying the exact output format. Use Markdown templates, tables, or code blocks to show the desired structure. Agents follow concrete output templates far more reliably than prose descriptions.

### 5. Scope Tools Explicitly

Use the `tools` frontmatter field to restrict which tools the prompt can use. This prevents unintended side effects and communicates intent. If a tool listed in `tools` is unavailable at runtime, it is silently ignored.

### 6. Agent Mode for Tool Use

Prompts that need to read files, run terminal commands, or call MCP tools must set `agent: agent`. Without it, the prompt produces text output only. Use `agent: ask` for read-only analysis and `agent: plan` for complex exploration.

### 7. Reference, Don't Duplicate

Use Markdown links to reference instructions, skills, and docs rather than copying content into each prompt. Links resolve relative to the prompt file's location (`.github/prompts/`), so workspace root references need `../../`.

### 8. Prompts vs. Instructions

| Type                                               | Invocation                  | Purpose                       |
| -------------------------------------------------- | --------------------------- | ----------------------------- |
| **Prompt files** (`.prompt.md`)                    | Manual -- user types `/name` | Repeatable tasks              |
| **Instructions** (`.instructions.md`, `AGENTS.md`) | Automatic -- always loaded   | Coding standards, conventions |

Do not put always-on rules in prompt files. Do not put task-specific workflows in instructions.

## Quick Reference

### File location

```
.github/prompts/my-prompt.prompt.md    # Workspace (shared via git)
~/prompts/my-prompt.prompt.md          # User profile (personal)
```

The file name (minus `.prompt.md`) becomes the `/slash-command`.

### Minimal prompt

```markdown
---
description: Review the current file for accessibility issues
---

Review ${file} for WCAG 2.2 AA compliance. Report issues in a table with
severity, location, WCAG criterion, and fix.
```

### Full-featured prompt

```markdown
---
description: Generate a new component
argument-hint: component name (e.g., data-grid)
agent: agent
model: claude-sonnet-4
tools:
  - create_file
  - read_file
  - list_dir
---

# Create component

Generate a new component named ${input:componentName}.

## Requirements

- Follow the pattern in src/components/sample-card/
- Create three files: component, template, styles
- Register in src/main.ts

## Output

Create the files directly. Do not ask for confirmation.
```

### Frontmatter fields

| Field           | Required    | Default       | Description                                                      |
| --------------- | ----------- | ------------- | ---------------------------------------------------------------- |
| `description`   | Recommended | --            | Shown in `/` menu. Include repo prefix for multi-repo setups.    |
| `agent`         | No          | current       | `agent`, `ask`, `plan`, or custom agent name.                    |
| `tools`         | No          | agent default | Array of tool/tool-set names. Scopes available tools.            |
| `model`         | No          | current       | Pin to a specific LLM model for consistent results.              |
| `name`          | No          | filename      | Override the slash command name (defaults to filename).           |
| `argument-hint` | No          | --            | Placeholder text shown after the slash command in chat input.    |

> **Deprecated:** `mode` has been renamed to `agent`. Migrate any `mode: "agent"` to `agent: agent`.

## Workflow -- Creating a New Prompt

1. **Identify the task** -- What repeatable action do you perform via Copilot chat?
2. **Choose a pattern** -- Review, generate, summarize, delegate, transform, or multi-step (see [references/patterns.md](references/patterns.md))
3. **Write the prompt** -- Start with description + task + output format
4. **Scope tools** -- Add `tools` array if the prompt should only use specific tools
5. **Add variables** -- Use `${file}`, `${selection}`, or `${input:name}` for context-awareness
6. **Test via play button** -- Open the `.prompt.md` file, click the play button in the editor toolbar
7. **Iterate** -- Refine based on results, adjust tool restrictions or output format
8. **Commit** -- Place in `.github/prompts/` for team use

## Checklist -- Prompt Quality

- [ ] Description is concise and action-oriented (shown in slash command picker)
- [ ] Task section clearly states what the agent should do
- [ ] Output format is explicitly defined (template, table, or example)
- [ ] Uses variables (`${file}`, `${selection}`, `${input:...}`) instead of requiring manual context
- [ ] Tools are scoped to only what the prompt needs
- [ ] Agent mode is set appropriately (`ask` for read-only, `agent` for actions, `plan` for exploration)
- [ ] Filename is kebab-case and descriptive: `review-content.prompt.md`
- [ ] No always-on rules that belong in instructions files instead
- [ ] Important/guardrails section included for agent-mode prompts
- [ ] Prompt is under ~200 lines (extract to skill with references if longer)

## When to Escalate

- Prompt requires persistent state across multiple invocations -- use a skill instead
- Prompt needs to modify agent behavior globally -- use instructions instead
- Prompt requires more than ~200 lines -- decompose into prompt + skill with references
- Prompt involves complex multi-role scenarios -- use custom agents (`.agent.md`)
- Prompt needs always-on rules -- use `.instructions.md` or `AGENTS.md` instead
