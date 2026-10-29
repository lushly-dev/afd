# CI/CD Integration for Personas

How to embed persona-driven checks into continuous integration and delivery pipelines.

## Overview

Persona reviews can run automatically on pull requests, feature branches, or scheduled intervals. This catches user-experience regressions before they reach production.

## Integration Patterns

### Pattern 1: PR Review Gate

Run persona reviews on every pull request that modifies user-facing specs or UI components.

```yaml
# .github/workflows/persona-review.yml
name: Persona Review
on:
  pull_request:
    paths:
      - 'specs/**'
      - 'src/components/**'
      - 'docs/features/**'

jobs:
  persona-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run persona reviews
        run: |
          for persona in .personas/*.yml; do
            persona ask "$(basename $persona .yml)" \
              --context ./changed-specs/ \
              --output ./reviews/
          done

      - name: Post review summary
        run: |
          persona summarize ./reviews/ --format github-comment \
            | gh pr comment ${{ github.event.number }} --body-file -
```

### Pattern 2: Scheduled Sweep

Run all personas against the full feature surface on a weekly schedule to detect drift.

```yaml
name: Weekly Persona Sweep
on:
  schedule:
    - cron: '0 9 * * 1'  # Monday 9am

jobs:
  sweep:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Full persona sweep
        run: |
          persona review-all \
            --context ./specs/ \
            --output ./sweep-results/ \
            --compare-previous ./last-sweep/

      - name: Check for drift
        run: |
          persona drift-check ./sweep-results/ ./last-sweep/ \
            --threshold 0.3 \
            --fail-on-drift
```

### Pattern 3: Feature Flag Validation

Before enabling a feature flag for a broader audience, run persona reviews against the new feature.

```bash
# Pre-rollout persona check
persona review-all \
  --context ./features/new-export-dialog.md \
  --severity-threshold high \
  --fail-on-high
```

## Output Formats

### GitHub PR Comment

```markdown
## Persona Review Summary

| Persona | Concerns | Severity | Key Friction |
|---------|----------|----------|--------------|
| Senior Dev Sarah | 2 | High | No CLI equivalent |
| Data Engineer Dev | 1 | Medium | Format not version-controllable |
| Admin Annie | 0 | -- | No concerns |

### High-Severity Items
1. **Senior Dev Sarah**: Export flow requires 3 clicks with no keyboard shortcut or CLI command
2. **Senior Dev Sarah**: No way to script recurring exports

> Run `persona detail "senior-dev-sarah" --review latest` for full friction report.
```

### JSON (for programmatic consumption)

```json
{
  "feature": "new-export-dialog",
  "timestamp": "2025-01-15T09:00:00Z",
  "personas": [
    {
      "id": "senior-dev-sarah",
      "concerns": 2,
      "max_severity": "high",
      "friction_points": [
        {
          "element": "export-flow",
          "impact": "40 seconds per export cycle",
          "severity": "high",
          "suggestion": "Add CLI command and keyboard shortcut"
        }
      ]
    }
  ]
}
```

## Configuration

### Persona selection

Not every persona needs to review every change. Configure which personas run on which paths:

```yaml
# .personas/config.yml
review_rules:
  - paths: ['specs/data-pipeline/**']
    personas: ['data-engineer-dev', 'platform-lead-pat']
  - paths: ['specs/admin/**']
    personas: ['admin-annie', 'platform-lead-pat']
  - paths: ['specs/reports/**']
    personas: ['report-builder-robin']
  - paths: ['src/components/**']
    personas: ['*']  # All personas review UI changes
```

### Severity thresholds

Configure when persona reviews should block a PR:

```yaml
# .personas/config.yml
thresholds:
  block_pr: high        # Block PR if any persona reports high-severity concern
  warn_pr: medium       # Add warning comment for medium-severity concerns
  ignore: low           # Log but do not comment on low-severity concerns
```

## Best Practices

1. **Start small** -- Begin with PR comments, not blocking gates. Let the team build trust in persona feedback quality before making it a gate.
2. **Scope personas to paths** -- Not every persona needs to review every file. Use path-based rules to keep reviews relevant.
3. **Cache persona results** -- If specs have not changed, skip re-running the same persona review.
4. **Compare over time** -- Store sweep results and compare week-over-week to detect both persona drift and feature regression.
5. **Human override** -- Always allow a human to override persona-flagged concerns with a rationale comment.
