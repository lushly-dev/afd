# Issue Templates

Templates for creating GitHub issues with proper structure.

## Parent Issue Template

For larger features with multiple sub-issues:

```markdown
## Summary

Brief description of the feature.

**This is the parent issue for [Feature Name].**

## Project Board

[Feature Name Project #N](https://github.com/orgs/lushly-dev/projects/N)

## Sub-Issues

| Issue | Task | Status | Assignable |
|-------|------|--------|------------|
| #XX | [Core Types](url) | Ready | Start here |
| #XX | [Server Support](url) | Blocked on #XX | After #XX |
| #XX | [Client Support](url) | Blocked on #XX | After #XX |

## Dependency Graph

\`\`\`
#XX (Core) --+-- #XX (Server) ---+-- #XX (Example)
             |                   |
             +-- #XX (Client) ---+
\`\`\`

## Specification

See [docs/features/active/feature-name/](docs/features/active/feature-name/)

## Acceptance Criteria (Feature Complete)

- [ ] Core types shipped (#XX)
- [ ] Server integration complete (#XX)
- [ ] Example demonstrates feature (#XX)
```

## Sub-Issue Template

Each sub-issue should be completable by one Claude agent:

```markdown
## Summary

What this specific task accomplishes.

## Specification

See [docs/features/active/feature-name/spec.md](docs/features/active/feature-name/spec.md)

## Tasks

- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

## Acceptance Criteria

- Specific, testable criteria

## Do NOT

- Scope creep item 1
- Scope creep item 2

## Depends On

- #XX (if any dependencies)
```

## CLI Commands

```bash
# Create parent issue
gh issue create -R lushly-dev/repo --title "[Feature] Parent Issue" --body-file parent-issue.md

# Create sub-issue
gh issue create -R lushly-dev/repo --title "[Feature] Component Name" \
  --label "type:feature,priority:high" \
  --body-file sub-issue.md

# Add to project
gh project item-add PROJECT_NUMBER --owner lushly-dev --url ISSUE_URL
```
