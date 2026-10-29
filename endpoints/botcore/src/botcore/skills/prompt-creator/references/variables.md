# Variables in Prompt Files

Dynamic content using built-in variables and user input.

## Built-in Variables

### Workspace Variables

| Variable                     | Value                       |
| ---------------------------- | --------------------------- |
| `${workspaceFolder}`         | Full path to workspace root |
| `${workspaceFolderBasename}` | Workspace folder name only  |

### File Variables

| Variable                     | Value                           | Example                 |
| ---------------------------- | ------------------------------- | ----------------------- |
| `${file}`                    | Full path of the current file   | `/workspace/src/app.ts` |
| `${fileBasename}`            | File name with extension        | `app.ts`                |
| `${fileBasenameNoExtension}` | File name without extension     | `app`                   |
| `${fileDirname}`             | Directory of the current file   | `/workspace/src`        |

### Editor Variables

| Variable          | Value                    |
| ----------------- | ------------------------ |
| `${selection}`    | Currently selected text  |
| `${selectedText}` | Alias for `${selection}` |

## User Input Variables

Prompt the user for input at runtime:

```markdown
Generate a ${input:componentType} component named ${input:name}.
```

With placeholder text:

```markdown
Review the ${input:topic:Enter the topic to review} documentation.
```

### Syntax

| Format                         | Behavior                               |
| ------------------------------ | -------------------------------------- |
| `${input:varName}`             | Text input with variable name as label |
| `${input:varName:placeholder}` | Text input with custom placeholder     |

## Usage Examples

### Template with selection

```markdown
---
description: "Explain the selected code"
---

Explain the following code in detail:

${selection}
```

### Component generator with input

```markdown
---
description: "Generate a React component"
agent: agent
tools: ["editFiles"]
---

# Generate Component

Create a new React component:

- **Name:** ${input:name:ComponentName}
- **Type:** ${input:type:functional or class}

Place the file at `src/components/${input:name}/${input:name}.tsx`.
```

### File-aware review

```markdown
---
description: "Review the current file"
---

Review ${fileBasename} for:

1. Code quality
2. Error handling
3. Performance
```

## Best Practices

- Use `${selection}` for prompts that act on highlighted code
- Use `${file}` when the prompt operates on the entire current file
- Use `${input:...}` variables to make prompts reusable across different contexts
- Provide placeholder text to guide users on expected input format
- Combine variables: `${fileDirname}/${input:name}.test.ts`
