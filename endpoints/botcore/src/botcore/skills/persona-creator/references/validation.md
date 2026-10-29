# Persona Validation

How to verify that persona agents produce feedback that aligns with real user behavior.

## Why Validate

Personas are models of real users. Like any model, they can drift from reality. Validation ensures that the feedback personas produce is trustworthy enough to inform product decisions.

## Validation Workflow

### Step 1: Select Benchmark Scenarios

Choose 3-5 scenarios where you have both:

- **Real user feedback** -- Actual complaints, requests, or reactions from the target segment
- **A feature or flow to review** -- The context you would give to the persona

### Step 2: Run Persona Against Benchmarks

Ask the persona to review each benchmark scenario without seeing the real feedback.

```bash
persona ask "senior-dev-sarah" --context ./benchmark-scenario-1.md \
  "What is your reaction to this feature? What would you change?"
```

### Step 3: Compare Outputs

For each scenario, compare the persona's response to real user feedback:

| Dimension          | Real User Feedback             | Persona Response               | Aligned? |
| ------------------ | ------------------------------ | ------------------------------ | -------- |
| Top concern        | "Too many clicks"              | "Three-step flow wastes time"  | Yes      |
| Vocabulary         | "DX", "ergonomics"             | "developer experience"         | Partial  |
| Severity           | High (5 support tickets/week)  | High                           | Yes      |
| Suggested fix      | "Add keyboard shortcut"        | "Add CLI command"              | Partial  |

### Step 4: Score Alignment

Use a simple scoring rubric:

| Score | Meaning                                                       |
| ----- | ------------------------------------------------------------- |
| 3     | Persona response closely matches real feedback in substance    |
| 2     | Persona captures the right concern but with different framing  |
| 1     | Persona identifies a related concern but misses the core issue |
| 0     | Persona response contradicts real feedback                     |

**Target:** Average score of 2.0+ across all benchmark scenarios.

### Step 5: Calibrate

If the average score is below 2.0, adjust the persona:

- **Frustrations** -- Are they specific enough? Do they match real complaints?
- **Vocabulary** -- Does the persona speak like real users?
- **System prompt** -- Is the behavioral instruction producing the right perspective?
- **Psychographics** -- Are priorities and preferences accurate?

Re-run benchmarks after each adjustment until the score threshold is met.

## Drift Detection

Personas should be revalidated when:

- **New feature area** -- Persona has not been validated against this type of feature
- **Time elapsed** -- More than 6 months since last validation
- **User base shift** -- Product has onboarded a new user segment
- **Contradictory feedback** -- Persona output is contradicted by recent real feedback
- **Version bump** -- Persona traits have been significantly updated

## Drift Metrics

Track these metrics per persona over time:

| Metric                    | Description                                             | Threshold      |
| ------------------------- | ------------------------------------------------------- | -------------- |
| Alignment score           | Average benchmark score (0-3)                           | >= 2.0         |
| Vocabulary overlap        | % of persona terms found in real user language           | >= 60%         |
| Concern coverage          | % of real top concerns surfaced by persona               | >= 70%         |
| False positive rate       | % of persona concerns not reflected in real feedback     | <= 30%         |

## Validation Checklist

- [ ] At least 3 benchmark scenarios selected with real user feedback available
- [ ] Persona reviewed each scenario independently (no priming with real data)
- [ ] Alignment scored using the standard rubric (0-3 scale)
- [ ] Average alignment score meets threshold (>= 2.0)
- [ ] Vocabulary overlap checked against real user language
- [ ] Any score-0 scenarios investigated and persona adjusted
- [ ] Validation results documented with date for drift tracking
- [ ] Next validation scheduled (within 6 months or at next major feature area)
