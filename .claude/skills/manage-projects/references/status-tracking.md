# STATUS.md Tracking

Track agent progress with STATUS-{issue}.md files.

## File Naming

One file per issue: `STATUS-{issue_number}.md`

Example: `STATUS-188.md`, `STATUS-189.md`

## Location

In the feature folder:

```
docs/features/active/feature-name/
  proposal.md
  spec.md
  STATUS-188.md
  STATUS-189.md
```

## Template

Template at: `.agent/templates/STATUS.md`

```yaml
---
id: feature-name-NNN
feature: feature-name
issue: NNN
repo: lushbot
phase: in-progress
updated: YYYY-MM-DDTHH:MM:SS
agent: issue-NNN
---

# Status: Feature Name - Component

**Last Updated:** YYYY-MM-DD HH:MM
**Current Phase:** In Progress
**Assigned Agent:** issue-NNN

---

## Progress

- [x] Task 1
- [ ] Task 2
- [ ] Task 3

---

## Activity Log

| Time | Agent | Action |
|------|-------|--------|
| HH:MM | issue-NNN | Started work |
| HH:MM | issue-NNN | Created component |

---

## Notes and Risks

- Warning note
- Success note
- Error note

---

## Handoff

- **Branch:** feat/issue-NNN
- **PR:** [#NNN](url)
- **Tests:** Passing
- **Ready for Review:** Yes
```

## Phases

| Phase | Meaning |
|-------|---------|
| `not-started` | Issue created, awaiting assignment |
| `in-progress` | Agent actively working |
| `blocked` | Waiting on dependency |
| `complete` | PR created, ready for review |

## Scanning

Files are scannable by YAML frontmatter:

```bash
# Find all in-progress features
grep -l "phase: in-progress" docs/features/*/STATUS-*.md
```
