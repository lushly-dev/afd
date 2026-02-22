# Resource Scripts

Deterministic offloading — using scripts inside skills for work the LLM shouldn't do.

## The Golden Rule

> Never rely on the LLM for deterministic work.

If a task has a single correct answer computable by code (regex matching, parsing, math, API pagination, data transformation), offload it to a script. The LLM's job is to decide **when** to run the script and interpret the results.

## When to Use Scripts

| Task | Approach |
|------|----------|
| Regex matching / string parsing | Script |
| Math calculations | Script |
| API pagination / data fetching | Script |
| Data transformation (CSV→JSON) | Script |
| File system scanning | Script |
| Linting / validation | Script |
| Judgment calls / analysis | LLM |
| Creative writing | LLM |
| Code generation | LLM |

## Directory Structure

Scripts live in the `scripts/` directory inside the skill:

```
my-skill/
├── SKILL.md
├── scripts/
│   ├── lint.py
│   ├── parse-config.sh
│   └── fetch-api.py
└── references/
```

## AI-Native I/O Rules

### stdout: Clean output only

- Markdown or JSON — nothing else
- No ANSI escape codes, no colors, no spinners, no progress bars
- No interactive prompts
- Structure output so the LLM can parse it immediately

```python
# Good
import json
print(json.dumps({"issues": findings, "count": len(findings)}))

# Bad
from rich import print as rprint  # ANSI codes!
spinner = Halo(text='Scanning...')  # Interactive!
```

### stderr: Recovery instructions for the AI

- Don't just say "Error: file not found"
- Say "Error: config.json not found. Try: 1) Check the path exists, 2) Look for config.yaml as alternative"
- stderr is for the AI to read, not humans

```python
import sys

def error_with_recovery(msg, suggestions):
    print(f"Error: {msg}", file=sys.stderr)
    for i, s in enumerate(suggestions, 1):
        print(f"  {i}. {s}", file=sys.stderr)
    sys.exit(1)

# Usage
error_with_recovery(
    "No package.json found",
    ["Verify you're in the project root", "Check if this is a Python project (look for pyproject.toml)"]
)
```

## The Handoff Pattern

In SKILL.md, explicitly instruct the LLM to use the script:

```markdown
## Lint Check

Do NOT attempt to parse files yourself. Run the lint script and read its output:

\`\`\`bash
python ${CLAUDE_PLUGIN_ROOT}/scripts/lint.py <target-path>
\`\`\`

The script outputs JSON with `issues` array and `summary` object.
Interpret the results and suggest fixes.
```

Key elements:
- Explicit "Do NOT attempt X yourself"
- Exact command to run
- Description of output format
- What the LLM should do with the results

## Script Portability

- Use `${CLAUDE_PLUGIN_ROOT}` for paths to scripts within the skill
- Use `$CLAUDE_PROJECT_DIR` for paths to the user's project
- Avoid hardcoded absolute paths
- Use `#!/usr/bin/env python3` or `#!/usr/bin/env bash`
- Test on both Windows and macOS/Linux
- Use `pathlib.Path` (Python) or portable shell commands

## Example: Linter Script

```python
#!/usr/bin/env python3
"""Skill linter — validates SKILL.md files against rules."""
import json
import sys
from pathlib import Path

def lint_skill(skill_path: Path) -> dict:
    issues = []

    content = skill_path.read_text(encoding="utf-8")

    # Check frontmatter exists
    if not content.startswith("---"):
        issues.append({"rule": "SK001", "severity": "error", "message": "Missing frontmatter"})

    # Check file size
    lines = content.splitlines()
    if len(lines) > 500:
        issues.append({"rule": "SK009", "severity": "warning", "message": f"Body too long ({len(lines)} lines, max 500)"})

    return {"path": str(skill_path), "issues": issues, "total": len(issues)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Error: No path provided", file=sys.stderr)
        print("  Usage: lint.py <skill-path>", file=sys.stderr)
        sys.exit(1)

    result = lint_skill(Path(sys.argv[1]))
    print(json.dumps(result, indent=2))
```

## Example: API Wrapper Script

```python
#!/usr/bin/env python3
"""Paginated API fetcher — streams all results to stdout as JSON."""
import json
import sys
import urllib.request

def fetch_all(base_url, endpoint):
    results = []
    page = 1
    while True:
        url = f"{base_url}/{endpoint}?page={page}&per_page=100"
        try:
            with urllib.request.urlopen(url) as response:
                data = json.loads(response.read())
                if not data:
                    break
                results.extend(data)
                page += 1
        except Exception as e:
            print(f"Error fetching page {page}: {e}", file=sys.stderr)
            print(f"  1. Check if {base_url} is reachable", file=sys.stderr)
            print(f"  2. Verify the endpoint '{endpoint}' exists", file=sys.stderr)
            sys.exit(1)

    print(json.dumps({"results": results, "total": len(results)}))

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Error: Missing arguments", file=sys.stderr)
        print("  Usage: fetch-api.py <base-url> <endpoint>", file=sys.stderr)
        sys.exit(1)
    fetch_all(sys.argv[1], sys.argv[2])
```

## Best Practices

- Keep scripts focused — one script per task
- Always handle errors with recovery suggestions to stderr
- Output structured data (JSON preferred) to stdout
- Include usage instructions in stderr when args are wrong
- Test scripts independently before referencing in SKILL.md
- Use standard library only when possible (avoid dependencies)
- Document expected output format in SKILL.md near the handoff instruction

## Anti-Patterns

| Anti-pattern | Why it's bad | Fix |
|-------------|-------------|-----|
| Printing colors/spinners | LLM can't parse ANSI | Use `--no-color` or strip ANSI |
| Interactive prompts | LLM can't respond to stdin | Use CLI arguments instead |
| Large stdout dumps | Consumes context tokens | Summarize or paginate output |
| No error handling | LLM gets cryptic errors | Add recovery suggestions to stderr |
| Hardcoded paths | Breaks portability | Use `${CLAUDE_PLUGIN_ROOT}` |
