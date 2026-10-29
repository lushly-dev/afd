# Wave Orchestration

Parallel agent development using wave-based execution with Windows Terminal panes.

## Critical Rules

**File Isolation Required:** Parallel agents MUST NOT work on the same files. If multiple tasks modify the same file, they MUST be sequenced, not parallelized. Agents will overwrite each other's changes at the working copy level, not just at PR merge time.

**Delegate to Claude Code Agents:** Prefer spawning Claude Code agents over doing implementation work directly. Claude Code has full skills support (`.claude/skills/`) and access to `AGENTS.md` context. The orchestrating agent should plan, coordinate, and merge -- not implement.

## Concept

Analyze dependencies between issues and group into waves:

- **Wave 0:** Infrastructure setup (test frameworks, tooling)
- **Wave 1:** Issues with no dependencies (can start immediately)
- **Wave 2:** Issues depending on Wave 1
- **Wave 3:** Issues depending on Wave 2

**Additional constraint:** Group by file, not just by issue dependency. If two issues touch the same file, they cannot be in the same wave.

## Control Center Launch Commands

**Prerequisite:** Start Control Center before spawning agents:

```bash
d:\Github\lushly-dev\lushbot\control-center\src-tauri\target\release\lushx-control-center.exe
```

**Launch from lushly-dev context:** Always spawn agents from the monorepo root (`d:\Github\lushly-dev\`) rather than from individual repo directories. This gives agents access to all repos, cross-repo skills, and the unified `AGENTS.md` context.

### Single Agent (Issue-Based)

```bash
lushx agent spawn feature --repo {repo} --issue {issue-number}
```

### Single Agent (Prompt-Based)

```bash
lushx agent spawn feature --repo {repo} --prompt "{prompt}"
```

### Parallel Agents (Wave)

```bash
# ONLY use when agents target DIFFERENT files
lushx agent wave --repo {repo} --issues {issue1},{issue2}
```

### Review Agent

```bash
lushx agent spawn review --repo {repo} --prompt "Review proposal at docs/features/proposed/{name}/proposal.md"
```

**Key flags:**

- `--repo` -- Target repository name (afd, lushbot, violet, etc.)
- `--issue` -- GitHub issue number to implement
- `--prompt` -- Custom prompt for agent
- Agents appear as terminal panes in Control Center UI
- Review workflow uses Opus; feature workflow uses Sonnet

## Wave Process

### 1. Plan Waves (File-Aware)

| Wave | Issues | Target Files | Safe to Parallel? |
|------|--------|--------------|-------------------|
| Wave 0 | Test infra | New files | Yes |
| Wave 1.1 | Multi-line | ChatSidebar.tsx | No -- Sequential |
| Wave 1.2 | Stop button | ChatSidebar.tsx | No -- Sequential |
| Wave 1.3 | Markdown | MarkdownMessage.tsx (new) | Yes (different file) |

### 2. Launch Wave

```bash
# Sequential example (features touching same file)
lushx agent spawn feature --repo afd --prompt "Implement Wave 1.1... Create PR when done."
# Wait for completion in Control Center, then launch 1.2
```

### 3. Monitor and Merge

Watch panes for completion. When agents create PRs:

```bash
gh pr merge 193 -R lushly-dev/afd --squash --delete-branch
gh pr merge 194 -R lushly-dev/afd --squash --delete-branch
```

### 4. Launch Next Agent

```bash
git pull origin main
# Then launch next sequential task
```

## Prompt Template

```
You are implementing Task {X.Y} for issue #{parent-issue} ({feature-name}).

Prerequisites: {Previous tasks are merged} - DO GIT PULL FIRST.

{Task description and requirements}

IMPORTANT:
- Target folder is {folder} NOT {other-folder}
- When done, commit directly to main (or create PR if specified)
```

## Anti-Patterns

- **Don't:** Launch 4 agents all modifying the same file
- **Do:** Sequence them: 1.1, wait, 1.2, wait, 1.3

- **Don't:** Implement features directly from orchestrator
- **Do:** Spawn Claude Code agent with detailed prompt

- **Don't:** Assume agents will figure out conflicts
- **Do:** Explicitly tell agents to `git pull` before starting

## Conflict Resolution

If PRs conflict after merge:

```bash
git checkout feat/issue-XXX
git rebase origin/main
git push --force-with-lease origin feat/issue-XXX
```
