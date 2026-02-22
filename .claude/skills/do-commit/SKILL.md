---
name: do-commit
source: botcore
description: >
  Run quality gates, clean up temp files, update docs, and commit changes. Two modes: quick (automated checks + commit) and full (checks + cleanup + docs gate + self-review + commit). Delegates to write-commits for message generation. Use when ready to finalize and commit changes.

version: 1.0.0
triggers:
  - do commit
  - finalize
  - commit changes
  - pre-commit
  - cleanup
  - ready to commit
  - finalize changes
argument-hint: quick | full
portable: true
user-invocable: true
---

# Do Commit

Finalize changes for commit — quality gates, cleanup, docs, and commit message generation.

## Modes

| Mode | What runs | When to use |
|------|-----------|-------------|
| **quick** (default) | Quality gate → commit | Small changes, confident in state |
| **full** | Quality gate → cleanup → docs gate → self-review → commit | Feature work, before PR |

## Quick Mode

1. **Quality gate** — run `scripts/quality_gate.py` from this skill directory
   - Detects project language(s) and runs: lint, test, typecheck, build, check-size, check-paths, circular-imports
   - Review the JSON report — if any checks fail, fix them before proceeding
2. **Commit** — delegate to the `write-commits` skill for message generation, then `git add` + `git commit`

## Full Mode

### Step 1: Quality Gate

Run `scripts/quality_gate.py` and review the JSON output. Fix any failures before continuing.

### Step 2: Temp File Cleanup

Scan the repo root and working directories for artifacts that shouldn't be committed:

| Pattern | What it is |
|---------|-----------|
| `*.plan.md`, `*.review.md` | Agent work artifacts at repo root |
| `nul` | Windows null device artifact |
| `*.tmp`, `*.log` | Temporary/debug files |
| `*.pyc`, `__pycache__/` in source dirs | Python bytecode (should be .gitignored) |
| Stray `coverage/` dirs | Test coverage output (if not .gitignored) |

**Important**: Confirm with the user before deleting anything unexpected. Only remove files that are clearly artifacts, not in-progress work.

### Step 3: Documentation Gate

Run staleness detection first, then evaluate each:

1. Run `docs_check_changelog` — if stale, update CHANGELOG.md to reflect the changes
2. Run `docs_check_agents` — if structural changes detected, update AGENTS.md
3. Check README.md — any new commands, features, or setup steps that need documenting?
4. If skill files were modified, run `skill_lint` to validate

These are judgment calls — use the staleness detection results to guide whether updates are needed, but evaluate the actual content.

### Step 4: Self-Review

Review the full diff (`git diff --cached` or `git diff`) for common issues:

| Check | Look for |
|-------|----------|
| Leftover markers | Unresolved fix-me, hack, or warning markers |
| Debug statements | `console.log`, `print(`, `dbg!`, `debugger` |
| Commented-out code | Blocks of commented code that should be removed |
| Secrets | Hardcoded API keys, tokens, passwords |
| Unintended files | Generated files, editor configs, OS artifacts |

If issues are found, fix them before proceeding.

### Step 5: Commit

Delegate to the `write-commits` skill for commit message generation. The skill handles:
- Conventional Commits format
- Scope selection based on changed files
- Breaking change detection
- Multi-package commit handling

Then run `git add` (stage relevant files) and `git commit`.

## Quality Gate Script

The `scripts/quality_gate.py` script automates deterministic checks. Run it from the repo root:

```bash
python {skill-dir}/scripts/quality_gate.py
```

It reads `botcore.toml` for per-repo thresholds and detects languages from config files. Output is JSON:

```json
{
  "passed": true,
  "checks": [
    {"name": "lint", "passed": true, "duration_ms": 1200},
    {"name": "test", "passed": true, "duration_ms": 3400}
  ],
  "summary": "6/6 checks passed."
}
```

On failure, recovery suggestions are printed to stderr.

## Full Checklist

See [checklist.md](references/checklist.md) for the expanded reference covering all checks in detail.
