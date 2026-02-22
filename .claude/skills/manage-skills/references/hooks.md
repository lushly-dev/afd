# Hook Integration

Hooks are scripts that run automatically before or after specific agent actions. They enable skills to enforce rules (guardrails) and clean up (janitors) without relying on the LLM to remember or comply. Hooks are deterministic — they always run, regardless of prompt quality or model behavior.

---

## Hook Events

Hooks fire on specific events during the agent's execution lifecycle. There are 17 supported events across two categories.

### Lifecycle Events

These fire broadly and do not support a `matcher` field.

| Event | Fires when | Can block? |
|-------|-----------|------------|
| `PreToolUse` | Before any tool call | Yes |
| `PostToolUse` | After any tool call completes | No |
| `Notification` | On status messages from the agent | No |
| `Stop` | When the agent finishes a turn | No |
| `SubagentStop` | When a subagent finishes | No |

### Tool-Specific Matchers

`PreToolUse` and `PostToolUse` support a `matcher` field to narrow which tool calls trigger the hook. Without a matcher, the hook fires on every tool call of that event type.

| Matcher | Targets |
|---------|---------|
| `Write` | File creation and editing |
| `Edit` | File editing only |
| `Bash` / `Terminal` | Shell command execution |
| `WebFetch` | HTTP requests |
| `Read` | File reads |
| `Glob` | File search by pattern |
| `Grep` | Text search in files |
| `ListDir` | Directory listing |

Use the most specific matcher possible. A hook with no matcher runs on every tool call and adds latency to every action.

---

## Hooks in Skill Frontmatter

Declare hooks in the SKILL.md YAML frontmatter:

```yaml
---
name: my-skill
description: Enforces code style on writes
hooks:
  - event: PreToolUse
    matcher: Write
    command: "${CLAUDE_PLUGIN_ROOT}/hooks/check-style.sh"
  - event: PostToolUse
    matcher: Write
    command: "${CLAUDE_PLUGIN_ROOT}/hooks/auto-format.sh"
---
```

### Key Variables

| Variable | Resolves to |
|----------|-------------|
| `${CLAUDE_PLUGIN_ROOT}` | Absolute path to the skill's root directory (the folder containing SKILL.md) |
| `$CLAUDE_PROJECT_DIR` | Absolute path to the project root |

Always use `${CLAUDE_PLUGIN_ROOT}` for hook paths — it makes the skill portable across machines and users.

---

## Handler Types

Hook commands run as shell commands:

```yaml
command: "${CLAUDE_PLUGIN_ROOT}/hooks/guard.sh"
```

The command receives context about the tool call via environment variables and arguments. The hook script inspects these and decides whether to allow, block, or modify the action.

---

## Exit Code Semantics

The hook's exit code determines what happens next.

| Exit code | Meaning | Effect |
|-----------|---------|--------|
| `0` | Allow | Action proceeds normally |
| `2` | Block | Action is prevented; stderr message is shown to the agent |
| Other | Non-blocking error | Action proceeds; error is logged but doesn't stop execution |

Exit code `2` is the only way to block an action. Any other non-zero exit is treated as a hook failure, not a policy decision.

---

## Blocking Patterns

### Claude Code — Exit Code Convention

In Claude Code, `PreToolUse` hooks block actions by exiting with code `2` and writing the reason to stderr:

```bash
#!/usr/bin/env bash
# hooks/no-force-push.sh — Block git push --force
if echo "$@" | grep -q "git push --force"; then
    echo "Force push blocked by skill policy" >&2
    exit 2
fi
exit 0
```

### VS Code Copilot — JSON Stdout Convention

VS Code Copilot hooks communicate decisions via JSON on stdout, always exiting `0`:

```bash
#!/usr/bin/env bash
# hooks/no-force-push.sh — Block git push --force (Copilot format)
if echo "$@" | grep -q "git push --force"; then
    echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"Force push not allowed"}}'
    exit 0
fi
echo '{"hookSpecificOutput":{"permissionDecision":"allow"}}'
exit 0
```

> **Platform difference:** Claude Code uses exit code `2` + stderr. VS Code Copilot uses exit `0` + JSON stdout. If your skill targets both, you need separate hook scripts or a wrapper that detects the environment.

---

## Hook Locations

Hooks can be defined in three places. When the same event+matcher is defined at multiple levels, higher-priority locations win.

| Priority | Location | Scope |
|----------|----------|-------|
| 1 (highest) | **Settings-level** — User's global Claude settings | All projects for this user |
| 2 | **Project-level** — `.claude/settings.json` in project root | This project only |
| 3 | **Skill-level** — Bundled in the skill's `hooks/` directory, declared in frontmatter | Wherever the skill is installed |

Skill-bundled hooks are the most portable. They travel with the skill and use `${CLAUDE_PLUGIN_ROOT}` for path resolution.

---

## Common Patterns

### PreToolUse Guardrails

Guardrails block dangerous operations before they happen.

**Block destructive commands:**

```bash
#!/usr/bin/env bash
# hooks/no-destructive.sh
COMMAND="$*"
if echo "$COMMAND" | grep -qE "rm -rf|drop table|truncate|--force|--hard"; then
    echo "Destructive command blocked: $COMMAND" >&2
    exit 2
fi
exit 0
```

**Protect specific files from edits:**

```bash
#!/usr/bin/env bash
# hooks/protect-lockfiles.sh
FILE_PATH="${1:-}"
case "$FILE_PATH" in
    */pnpm-lock.yaml|*/package-lock.json|*/yarn.lock)
        echo "Lockfile edits blocked — run the package manager instead" >&2
        exit 2
        ;;
esac
exit 0
```

**Block API calls to production:**

```bash
#!/usr/bin/env bash
# hooks/no-prod-api.sh
URL="${1:-}"
if echo "$URL" | grep -qE "api\.production\.|prod\.internal\."; then
    echo "Production API calls blocked by skill policy" >&2
    exit 2
fi
exit 0
```

**Validate file size before writes:**

```bash
#!/usr/bin/env bash
# hooks/check-file-size.sh
CONTENT="${1:-}"
LINE_COUNT=$(echo "$CONTENT" | wc -l)
if [ "$LINE_COUNT" -gt 500 ]; then
    echo "File too large ($LINE_COUNT lines). Max 500 lines per file." >&2
    exit 2
fi
exit 0
```

### PostToolUse Janitors

Janitors clean up after actions complete. They cannot block — the action already happened.

**Auto-format after file edits:**

```bash
#!/usr/bin/env bash
# hooks/auto-format.sh
FILE_PATH="${1:-}"
case "$FILE_PATH" in
    *.py) ruff format "$FILE_PATH" 2>/dev/null ;;
    *.ts|*.js) npx biome format --write "$FILE_PATH" 2>/dev/null ;;
    *.json) python3 -m json.tool "$FILE_PATH" > /tmp/fmt.json && mv /tmp/fmt.json "$FILE_PATH" 2>/dev/null ;;
esac
exit 0
```

**Validate JSON/YAML after writes:**

```bash
#!/usr/bin/env bash
# hooks/validate-data.sh
FILE_PATH="${1:-}"
case "$FILE_PATH" in
    *.json)
        python3 -c "import json; json.load(open('$FILE_PATH'))" 2>/dev/null
        if [ $? -ne 0 ]; then
            echo "Warning: Invalid JSON in $FILE_PATH" >&2
        fi
        ;;
    *.yaml|*.yml)
        python3 -c "import yaml; yaml.safe_load(open('$FILE_PATH'))" 2>/dev/null
        if [ $? -ne 0 ]; then
            echo "Warning: Invalid YAML in $FILE_PATH" >&2
        fi
        ;;
esac
exit 0
```

---

## Skill-as-Package Pattern

A skill can bundle its own hooks alongside its documentation and references:

```
my-skill/
├── SKILL.md
├── hooks/
│   ├── pre-write-check.sh
│   └── post-write-format.sh
└── references/
    └── api.md
```

The frontmatter declares the hooks:

```yaml
---
name: my-skill
description: Enforces style and auto-formats
hooks:
  - event: PreToolUse
    matcher: Write
    command: "${CLAUDE_PLUGIN_ROOT}/hooks/pre-write-check.sh"
  - event: PostToolUse
    matcher: Write
    command: "${CLAUDE_PLUGIN_ROOT}/hooks/post-write-format.sh"
---
```

When the skill is installed, `${CLAUDE_PLUGIN_ROOT}` resolves to the skill's directory, and the hooks activate automatically. No manual configuration needed by the user.

---

## Best Practices

1. **Keep hooks fast** — they run synchronously and block the agent. Target < 2 seconds per hook.
2. **Always handle the no-match case** — end every hook with `exit 0` as the default path.
3. **Quote all variables** — `"$FILE_PATH"` not `$FILE_PATH`. Unquoted variables break on paths with spaces.
4. **Test hooks independently** — run them from the command line before wiring into a skill.
5. **Log decisions to stderr** — the agent sees stderr output, which helps it understand why something was blocked.
6. **Use `matcher` to narrow scope** — a hook without a matcher fires on every tool call and slows everything down.
7. **Prefer simple bash scripts** — avoid complex programs or dependencies. Hooks should be self-contained.
8. **Make blocking hooks explain WHY** — a bare `exit 2` gives the agent no guidance. Always write a reason to stderr.
9. **Idempotent janitors** — PostToolUse hooks may run on partial or failed writes. Handle missing or malformed files gracefully.
10. **Version your hooks** — track hook scripts in source control alongside the skill.

---

## Security Considerations

- **Validate all inputs** — hook arguments come from the agent's tool calls. Treat them as untrusted.
- **Never use `eval`** — don't pass hook arguments to `eval`, `source`, or shell expansion.
- **Block path traversal** — check that file paths don't contain `..` segments escaping the project root.
- **Hooks run with user permissions** — they can do anything the user can. Don't escalate privileges.
- **Review third-party hooks** — before installing a skill with hooks, read the hook scripts. They execute arbitrary code on your machine.
- **Limit network access** — hooks that make HTTP calls should validate URLs and avoid sending project data to external services.

---

## Cross-Platform Notes

| Concern | Recommendation |
|---------|---------------|
| Shebang line | Use `#!/usr/bin/env bash` for portability |
| Testing | Verify on both Windows (Git Bash / WSL) and macOS/Linux |
| Paths | Use `${CLAUDE_PLUGIN_ROOT}` — never hardcode absolute paths |
| File extensions | Windows may need `.sh` extension association or explicit `bash` invocation |
| Line endings | Use LF (`\n`), not CRLF. Configure `.gitattributes` for hook scripts |
| Tool availability | Check that commands (`ruff`, `npx`, `python3`) exist before calling them |

For Windows compatibility, consider wrapping hooks:

```bash
#!/usr/bin/env bash
# Ensure we're in bash even on Windows
if ! command -v bash &> /dev/null; then
    echo "bash required for hooks" >&2
    exit 0  # Don't block if bash isn't available
fi
```
