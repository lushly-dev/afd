# Orchestrator Workflow

Post-review workflow for orchestrating agents that consume review feedback.

## After Receiving a Review

1. **Fix all BLOCKERS** -- Non-negotiable, required for approval
2. **Evaluate IMPROVEMENTS** with project context:
   - Default: Implement all improvements (context reload is expensive)
   - Skip only if improvement does not fit project direction
   - If skipping, note rationale briefly
3. **Delete the prior review file** before re-submitting
   - Old reviews anchor the new reviewer on prior findings
   - Fresh reviewers should judge artifacts on current merits, not verify prior fixes
4. **Re-submit for review** if blockers existed
5. **Proceed to implementation** if approved

## Orchestrator Decision Rules

- BLOCKERS must be fixed (non-negotiable)
- IMPROVEMENTS should be evaluated with project context
- Default to implementing improvements -- context reload is expensive
- Only skip improvements if they genuinely do not fit project direction

## Spawning Review Agents

When launching a review agent from a multi-repo workspace, always use explicit paths:

**Option 1: Full path from workspace root (preferred)**
```bash
agent spawn review --repo <name> --prompt "...Review <repo>/docs/features/active/<feature>/spec.md..."
```

**Option 2: Specify repo + relative path**
```bash
agent spawn review --repo <name> --prompt "...Review the spec at (repo: <name>) docs/features/active/<feature>/spec.md..."
```

Why this matters: Spawned agents launch from the workspace root folder. Relative paths like `docs/features/active/...` are ambiguous when multiple repos exist. The agent may fail to locate the file or read the wrong one.

Tip: Also specify the full output path for co-located reviews:
```bash
--prompt "...Save output to <repo>/docs/features/active/<feature>/review.md"
```
