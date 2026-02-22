# Feature Lifecycle

Features move through three stages: proposed, active, complete.

## Directory Structure

```
docs/features/
  proposed/                 # Draft proposals awaiting review
    feature-name/
      proposal.md
  active/                   # Approved features in implementation
    feature-name/
      proposal.md
      spec.md
      STATUS-{issue}.md
  complete/                 # Shipped features (reference archive)
    feature-name/
      proposal.md
      spec.md
```

## Feature Folder Contents

```
feature-name/
  proposal.md               # The what/why (required)
  spec.md                   # The how (after approval)
  STATUS-{issue}.md         # Agent activity log (per issue)
  review.md                 # Review feedback (optional)
  assets/                   # Diagrams, screenshots (optional)
```

## Lifecycle Transitions

### Approve a Proposal (proposed to active)

```bash
# Move feature folder
mv docs/features/proposed/feature-name docs/features/active/feature-name

# Commit
git add -A && git commit -m "docs: approve feature-name proposal"
```

### Complete a Feature (active to complete)

```bash
# Move to complete
mv docs/features/active/feature-name docs/features/complete/feature-name

# Update README tables
# Close all related GitHub issues

# Commit
git add -A && git commit -m "docs: complete feature-name (shipped)"
```

## Linking Issues to Specs

GitHub issue body should reference the spec:

```markdown
## Specification

See [docs/features/active/feature-name/](docs/features/active/feature-name/):
- [proposal.md](docs/features/active/feature-name/proposal.md) - Goals
- [spec.md](docs/features/active/feature-name/spec.md) - Implementation
```
