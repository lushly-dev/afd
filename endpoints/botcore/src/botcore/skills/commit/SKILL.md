---
name: commit
source: botcore
description: >
  Run quality gates, clean up temp files, update docs, and commit changes.
  Two modes: quick (automated checks + commit) and full (checks + cleanup +
  docs gate + self-review + commit). Delegates to commit-writer for message
  generation. Use when ready to finalize and commit changes.
version: "1.0.0"
triggers:
  - do commit
  - finalize
  - commit changes
  - pre-commit
  - cleanup
  - ready to commit
  - finalize changes
portable: true
user-invocable: true
argument-hint: "quick | full"
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
2. **Commit** — delegate to the `commit-writer` skill for message generation, then `git add` + `git commit`

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

Delegate to the `docs-update` skill. It runs a full documentation pass:

1. Gather context (recent commits, changed files)
2. Update CHANGELOG.md — add entries under `[Unreleased]` using Keep a Changelog format
3. Update AGENTS.md — if structural changes detected
4. Update README.md — if new commands, features, or setup steps
5. Close out specs — mark backing specs/proposals complete, update feature indexes
6. Update ROADMAP.md — move shipped items, link to changelog versions
7. Lint skill files — if any were modified
8. Verify links — fix broken or stale internal links across touched docs
9. Keep AGENTS.md the only instruction file — never create or regenerate a CLAUDE.md

**Do not skip this step.** Documentation updates are part of the deliverable, not an afterthought.

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

Delegate to the `commit-writer` skill for commit message generation. The skill handles:
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

It reads `botcore.toml` for per-repo thresholds and detects languages from config files. The gate includes a lockfile-drift check (`dev_check_lockfile`) that warns when a lockfile is staged without its corresponding manifest. Output is JSON:

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
