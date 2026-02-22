# Prompt File Format

Complete reference for VS Code `.prompt.md` file format.

## File Structure

```markdown
---
[YAML frontmatter]
---

[Markdown body -- the prompt instructions]
```

Only `description` is required in the frontmatter. All other fields are optional.

## Frontmatter Fields

### description (recommended)

The most important field. Shown to the user in the VS Code `/` slash command picker. Keep it under one sentence. Use an action verb.

- **Purpose:** Shown in the VS Code `/` slash command menu
- **Format:** Short, specific, action-oriented
- **Repo prefix:** When prompts from multiple repos may appear together, prefix with a repo identifier in brackets for disambiguation

```yaml
# Good -- specific, action-oriented
description: Review the current file for accessibility compliance
description: "[my-repo] Initialize a KB review session with tools and skills"

# Bad -- too vague
description: Help with components
description: Accessibility stuff
```

### agent

Controls which agent mode runs the prompt.

| Value      | Behavior                                                                 |
| ---------- | ------------------------------------------------------------------------ |
| `ask`      | Answer-only mode -- no file edits, no terminal commands                  |
| `agent`    | Full agent mode -- can edit files, run commands, use tools               |
| `plan`     | Planning mode -- explores codebase, proposes approach before implementing|
| `{custom}` | Delegates to a custom agent (`.agent.md` file)                           |

- **Default:** Current agent mode. If `tools` is specified, defaults to `agent`.
- **Deprecated:** `mode` was the old field name. Use `agent` instead.

```yaml
agent: ask     # For review/analysis prompts (read-only)
agent: agent   # For generation/modification prompts
agent: plan    # For complex multi-file tasks
```

### tools

Restrict or expand the tools available to the prompt. Accepts built-in tools, MCP tool names, and wildcards.

```yaml
tools:
  - create_file
  - read_file
  - run_in_terminal
  - proto/*              # All tools from the proto MCP server
  - mcp_nexus_execute    # Specific MCP tool
```

When `tools` is specified without `agent`, the agent defaults to `agent` mode (not `ask`).

- **Behavior:** If a listed tool is unavailable at runtime, it is silently ignored
- **Empty array:** No tools available
- **No field:** All default tools available
- **Priority:** Prompt tools override custom agent tools, which override default agent tools

### model

Override the language model for this specific prompt. Useful when a task benefits from a specific model's strengths.

```yaml
model: claude-sonnet-4
model: gpt-4o
```

### name

Override the slash command name. Rarely needed -- the filename is usually best.

```yaml
name: a11y-review  # User types /a11y-review instead of /review-accessibility
```

### argument-hint

Shown as placeholder text in the chat input after selecting the prompt. Guides the user on what context to provide.

```yaml
argument-hint: paste or describe the content to review
argument-hint: component name (e.g., data-grid, side-panel)
```

## File Naming

| Rule                           | Example                             |
| ------------------------------ | ----------------------------------- |
| Extension must be `.prompt.md` | `review-kb.prompt.md`               |
| Name becomes slash command     | `/review-kb`                        |
| Use kebab-case                 | `init-kb-review` not `initKBReview` |
| Be descriptive but concise     | `create-profile` not `cp`           |
| Action-first naming            | `review-*`, `create-*`, `init-*`    |

## Path Resolution

Markdown links in prompt files resolve **relative to the prompt file's location** (`.github/prompts/`), not the workspace root.

| Target              | Path from `.github/prompts/`          |
| ------------------- | ------------------------------------- |
| Workspace root file | `../../README.md`                     |
| Skill file          | `../../.claude/skills/name/SKILL.md`  |
| Another prompt      | `./other-prompt.prompt.md`            |

### Linking to files

Use Markdown links with relative paths to reference workspace files. The linked file's content is included as context:

```markdown
Follow the patterns in [sample component](../../src/components/sample-card/sample-card.ts).
```

### Referencing tools

Use `#tool:name` syntax to reference tools in the body:

```markdown
Use #tool:create_file to create the component files.
```

## File Location and Discovery

### Workspace prompts (team-shared)

```
.github/prompts/*.prompt.md
```

Configurable via `chat.promptFilesLocations` setting. Committed to git, shared with the team.

### User prompts (personal)

Stored in the VS Code user profile `prompts/` folder. Available across all workspaces. Synced via Settings Sync (enable "Prompts and Instructions").

### Recommended prompts

Configure prompts to appear as recommendations when starting a new chat:

```json
{
  "chat.promptFilesRecommendations": [
    ".github/prompts/review-content.prompt.md",
    ".github/prompts/create-component.prompt.md"
  ]
}
```

## Invocation Methods

| Method              | How                                                   |
| ------------------- | ----------------------------------------------------- |
| **Slash command**   | Type `/` in Copilot chat, select prompt from list     |
| **Command palette** | `Chat: Run Prompt`, pick from Quick Pick              |
| **Play button**     | Open `.prompt.md` file, click play in editor toolbar  |
| **Reference**       | `#prompt:name` in chat or from another prompt         |

## Interaction with Other Customization Layers

| Layer                             | How it interacts                                               |
| --------------------------------- | -------------------------------------------------------------- |
| `.github/copilot-instructions.md` | Always-on baseline -- applied alongside prompt instructions    |
| `AGENTS.md`                       | Always-on baseline -- same as above                            |
| `*.instructions.md`               | Applied when working on matching files (by `applyTo` glob)     |
| `.agent.md` (Custom Agents)       | Prompt can delegate via `agent: <name>`                        |
| `SKILL.md` (Skills)               | Loaded on-demand when relevant; prompt body can reference them |

## Constraints

| Element         | Limit                                                |
| --------------- | ---------------------------------------------------- |
| File extension  | Must be `.prompt.md`                                 |
| Location        | `.github/prompts/` (workspace) or profile `prompts/` |
| Description     | Keep concise -- one-liner in the UI                  |
| Tool references | Silently ignored if unavailable at runtime           |
| Path resolution | Relative to the prompt file, not workspace root      |
