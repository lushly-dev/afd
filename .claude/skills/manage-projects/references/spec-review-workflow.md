# Spec Review Workflow

Detailed reference for agent-driven proposal and spec reviews.

## Proposal Status Lifecycle

```yaml
---
status: captured  # captured -> draft -> ready -> approved
author: Author Name
created: 2026-01-11
updated: 2026-01-11
---
```

| Status | Meaning | Next Action |
|--------|---------|-------------|
| `captured` | Idea captured | Refine scope, add details |
| `draft` | Being refined | Polish, get feedback |
| `ready` | Ready for Opus review | Run review workflow |
| `approved` | Passed review | Move to `active/`, create spec |

## Review Triggers

| Trigger | Model | Output Location |
|---------|-------|-----------------|
| Proposal ready for review | Opus | `docs/audits/proposals/` |
| Spec ready for implementation | Opus | `docs/audits/reviewer/` |
| Code/PR ready for merge | Sonnet | PR comments or `docs/audits/reviewer/` |
| Security audit | Opus | `docs/audits/security/` |
| Documentation audit | Sonnet | `docs/audits/documentation/` |
| Duplicates scan | Flash | `docs/audits/duplicates/` |

## CLI Handoff Templates

**Prerequisite:** Start Control Center before spawning agents:

```bash
d:\Github\lushly-dev\lushbot\control-center\src-tauri\target\release\lushx-control-center.exe
```

### Proposal Review

```bash
lushx agent spawn review --repo {repo} --prompt "Load the reviewer skill from .claude/skills/reviewer/SKILL.md. Review the PROPOSAL at docs/features/proposed/{name}/proposal.md. Track your tasks. Use BLOCKERS/IMPROVEMENTS format. Save output to docs/audits/proposals/{name}.review.md"
```

### Spec Review

```bash
lushx agent spawn review --repo {repo} --prompt "Load the reviewer skill from .claude/skills/reviewer/SKILL.md. Review the SPEC at docs/features/proposed/{name}/{name}.spec.md. Focus on: implementation readiness, task breakdown, testing plan. Use BLOCKERS/IMPROVEMENTS format. Save output to docs/audits/reviewer/{name}-spec-review.md"
```

### Security Audit

```bash
lushx agent spawn security --repo {repo} --prompt "Load the security skill from .claude/skills/security/SKILL.md. Perform a comprehensive security audit. Save output to docs/audits/security/{project}-audit-{date}.md"
```

## Action Notes Pattern

After review, orchestrator annotates findings for tracking:

```markdown
## ACTION NOTES

| Finding | Disposition | Notes |
|---------|-------------|-------|
| B1 | Fixed | Resolved in commit abc123 |
| B2 | Fixed | Added error handling |
| I1 | Implemented | Reused existing utility |
| I2 | Skipped | Doesn't fit project direction -- [reason] |
| I3 | Issue | Created #45 for future |
```

### Orchestrator Post-Review Workflow

1. Fix all BLOCKERS (required for approval)
2. Evaluate IMPROVEMENTS with project context
   - Default: implement all (context reload is expensive)
   - Skip only if doesn't fit project direction
3. Re-submit for review if blockers existed
4. Update ACTION NOTES with resolution status

## Folder Conventions

```
docs/
  features/
    proposed/           # captured, draft, ready proposals
    active/             # approved, in implementation
    complete/           # shipped, archived
  audits/
    proposals/          # Proposal review output
    reviewer/           # Spec and code review output
    security/           # Security audit output
    documentation/      # Doc audit output
    duplicates/         # jscpd reports
```

## Model Tier Recommendations

| Task | Model | Reasoning |
|------|-------|-----------|
| Proposal review | Opus | Deep contextual thinking, architecture |
| Spec review | Opus | Catches implementation gaps |
| Code review | Sonnet | Balance of speed and quality |
| Security audit | Opus | Security is too important for speed |
| Duplicates scan | Flash | Algorithmic, less reasoning needed |
| Documentation audit | Sonnet | Straightforward checks |
