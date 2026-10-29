# Variable Injection

Reference for dynamic variables in command files.

## Variable Types

### $ARGUMENTS

Captures all text after the command name as a single string.

```markdown
---
description: Search codebase for pattern
argument-hint: [search-pattern]
---

Search for: $ARGUMENTS
```

**Usage:** `/search login validation` results in `$ARGUMENTS` = "login validation"

### Positional Variables ($1, $2, ...)

Arguments are tokenized by spaces.

```markdown
---
description: Create ticket
argument-hint: [project] [priority]
---

Project: $1
Priority: $2
```

**Usage:** `/ticket FRONTEND HIGH` results in `$1`="FRONTEND", `$2`="HIGH"

### Quoted Arguments

Quotes preserve spaces within a single positional argument.

```
/ticket "Login Bug" HIGH
```
- `$1` = "Login Bug" (with space preserved)
- `$2` = "HIGH"

## Best Practices

| Do | Don't |
|----|-------|
| Provide `argument-hint` | Leave users guessing |
| Document expected format | Assume users know the syntax |
| Handle missing args gracefully | Crash on empty input |
| Use `$ARGUMENTS` for free-text | Force positional args unnecessarily |

## Examples

### Single Required Argument

```markdown
---
description: Explain a file
argument-hint: [filepath]
---

Explain the code in: $ARGUMENTS
```

### Multiple Arguments

```markdown
---
description: Compare files
argument-hint: [file1] [file2]
---

Compare:
- File 1: $1
- File 2: $2

Show differences and suggest improvements.
```

### Optional Arguments

```markdown
---
description: Run tests
argument-hint: [test-pattern?]
---

Run tests matching: $ARGUMENTS

If no pattern provided, run all tests.
```

### Mixed Positional and Free-Text

```markdown
---
description: Log issue
argument-hint: [severity] [description...]
---

Severity: $1
Details: $ARGUMENTS
```

Note: `$ARGUMENTS` contains the full string including the severity token. Parse accordingly or use only positional variables.
