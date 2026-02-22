# Data Ingestion for Personas

How to gather, organize, and synthesize user data into persona traits.

## Data Sources

| Source              | What to extract                                    | Signal strength |
| ------------------- | -------------------------------------------------- | --------------- |
| Support tickets     | Recurring complaints, workflow blockers, vocabulary | High            |
| Forum posts (Reddit, Stack Overflow) | Frustrations, workarounds, feature requests | High            |
| App store / product reviews | Satisfaction drivers, deal-breakers            | Medium          |
| User interviews     | Goals, mental models, daily workflows              | High            |
| Analytics / telemetry | Feature usage frequency, drop-off points          | High            |
| Sales call notes    | Objections, competitor comparisons                 | Medium          |
| NPS / CSAT surveys  | Satisfaction trends, open-ended feedback            | Medium          |
| Social media        | Sentiment, emerging frustrations                   | Low             |

## Ingestion Workflow

### Step 1: Define the Target Segment

Before gathering data, specify who you are building the persona for:

- **Role** -- What job title or function?
- **Context** -- What product area or feature do they interact with?
- **Goal** -- What decision will this persona inform?

### Step 2: Collect Raw Data

Gather 20-50 data points from at least 2-3 different source types. Single-source personas are fragile.

```
research "Top 10 pain points from [source] for [role]"
research "Common vocabulary used by [role] when discussing [product area]"
research "Daily workflow patterns for [role] in [industry]"
```

### Step 3: Tag and Cluster

Organize raw data points into clusters:

- **Demographics** -- Role, experience level, team structure
- **Psychographics** -- Patience level, preferences, priorities, decision style
- **Frustrations** -- Concrete pain points with workflow impact
- **Goals** -- What they are trying to accomplish
- **Vocabulary** -- Domain terms they use naturally
- **Workflow** -- Daily tasks, tools, and patterns

### Step 4: Synthesize Traits

For each cluster, extract the 3-5 strongest signals:

- **Frequency** -- How often does this theme appear across sources?
- **Intensity** -- How strongly do users feel about this?
- **Specificity** -- Is this a concrete scenario or a vague preference?

Prioritize traits that are frequent, intense, and specific. Discard traits that appear in only one source or are too generic to produce actionable feedback.

### Step 5: Write the Persona YAML

Map synthesized traits to the persona template fields. See [persona-template.md](persona-template.md) for the full schema.

## Data Quality Checklist

- [ ] Data comes from at least 2-3 different source types
- [ ] At least 20 data points collected before synthesis
- [ ] Each frustration maps to a specific scenario, not a generic preference
- [ ] Vocabulary terms are extracted from actual user language, not assumed
- [ ] No conflicting traits in the final synthesis (split personas if needed)
- [ ] Data is recent enough to reflect current user behavior (< 12 months old)
- [ ] Gaps in data are flagged, not filled with assumptions

## Anti-Patterns

| Anti-pattern                        | Why it fails                                          |
| ----------------------------------- | ----------------------------------------------------- |
| Inventing traits without data       | Creates fictional users that mislead product decisions |
| Using only one data source          | Produces a fragile persona biased by source type       |
| Generic frustrations ("I want it faster") | Does not produce actionable feedback             |
| Copying competitor personas         | Does not reflect your actual user base                 |
| Stale data (> 12 months)           | Users evolve; outdated personas give outdated feedback |
