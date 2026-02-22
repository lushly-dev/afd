# Staleness Detection and Review Protocol

How to detect stale documentation and run a documentation audit.

## Pre-Review: Gather Context

```bash
# Get recent commit history for verification
git log --oneline -20

# Find recently modified files
git diff --stat HEAD~10

# Check for TODO/FIXME in docs
grep -r "TODO\|FIXME\|WIP" docs/ README.md AGENTS.md

# Get commits since last tag for changelog verification
git log $(git describe --tags --abbrev=0)..HEAD --oneline --no-merges
```

## Staleness Detection Checklist

### Version and Count Alignment

- [ ] Version in `package.json` matches badge in README.md
- [ ] Skill count in AGENTS.md matches actual `.claude/skills/` directories
- [ ] Component count matches actual `src/components/` directories
- [ ] Prompt count matches actual `.github/prompts/` files
- [ ] `[Unreleased]` in CHANGELOG captures all merged work since last version
- [ ] ROADMAP shipped items link to CHANGELOG versions
- [ ] CLAUDE.md content matches AGENTS.md (auto-generated header present)

### Content Freshness

| Symptom | Detection | Fix |
|---------|-----------|-----|
| Old file paths | `grep -r "src/old/"` | Update paths |
| Deprecated APIs | Search for removed functions | Update examples |
| Wrong version | Check `package.json` vs docs | Sync versions |
| Missing features | Compare AGENTS.md to code | Add documentation |
| Phantom changelog entries | Cross-ref with git log | Remove entries without commits |

## README.md Review Checklist

- [ ] **Project description** -- accurate, matches current state
- [ ] **Installation** -- commands work, dependencies listed
- [ ] **Quick start** -- example runs without errors
- [ ] **Usage examples** -- code snippets are current
- [ ] **Contributing** -- instructions reflect actual workflow
- [ ] **License** -- present and correct
- [ ] **Badges** -- links work, statuses accurate

## AGENTS.md Review Checklist

- [ ] **Tool list** -- all current MCP tools documented
- [ ] **Commands** -- all CLI commands listed
- [ ] **Conventions** -- naming patterns accurate
- [ ] **Workflows** -- step-by-step instructions work
- [ ] **Permissions** -- any restrictions documented
- [ ] **Skills** -- lists available skills and triggers

## CHANGELOG.md Review Checklist

**Use git log to verify accuracy:**

```bash
# Compare CHANGELOG entries against actual commits
git log --oneline --since="2025-01-01" --grep="feat\|fix\|breaking"

# Check if version tags exist
git tag -l "v*"

# Get commit count between versions
git rev-list v1.0.0..v1.1.0 --count
```

**Verify:**
- [ ] **Version numbers** -- match git tags
- [ ] **Dates** -- match release commits
- [ ] **Breaking changes** -- all marked clearly
- [ ] **New features** -- all `feat:` commits included
- [ ] **Bug fixes** -- all `fix:` commits included
- [ ] **No phantom entries** -- no changelog entries without commits

## Code Examples Checklist

- [ ] **File paths** -- all referenced files exist
- [ ] **Import statements** -- packages/modules exist
- [ ] **Function signatures** -- match actual code
- [ ] **Configuration** -- environment variables documented
- [ ] **Output examples** -- reflect actual command output

## Cross-Reference Checklist

- [ ] **Internal links** -- all `[link](path)` references resolve
- [ ] **External links** -- no 404 errors (spot check)
- [ ] **Code references** -- function names, file paths exist
- [ ] **Version references** -- no stale version numbers

## Audit Output Format

```markdown
# Documentation Audit: [Project Name]

## CRITICAL (Must Fix)
1. [Broken installation instructions, missing required docs]

## WARNINGS (Should Fix)
1. [Stale examples, outdated references]

## SUGGESTIONS (Nice to Have)
1. [Formatting improvements, additional examples]

## Changelog Sync Status
- Last documented version: v1.2.0
- Latest git tag: v1.2.0
- Undocumented commits since tag: 5
  - feat: Add new tool
  - fix: Handle edge case

## Summary
[Overall documentation health assessment]
```

## Automation

### Find Undocumented Tools

```python
import re

# Extract documented tools from AGENTS.md
with open("AGENTS.md") as f:
    doc_tools = set(re.findall(r'`(tool-\w+)`', f.read()))

# Extract actual tools from server code
with open("src/mcp_server.py") as f:
    code_tools = set(re.findall(r'name="(tool-\w+)"', f.read()))

# Find gaps
undocumented = code_tools - doc_tools
print(f"Undocumented tools: {undocumented}")
```

### Verify Links

```bash
# Check for broken internal links (requires markdown-link-check)
npx markdown-link-check README.md AGENTS.md
```

### Test Installation Instructions

```bash
# Test installation in a clean environment
docker run --rm -it node:20 bash -c "npm install && npm run dev"
```

## Changelog Drift Detection

```bash
# Find commits not in CHANGELOG since last release
git log --oneline $(git describe --tags --abbrev=0)..HEAD --no-merges
# Compare against CHANGELOG [Unreleased] entries
```
