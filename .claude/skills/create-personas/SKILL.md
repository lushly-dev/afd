---
name: create-personas
source: botcore
description: >
  Creates and manages agentic personas for role-based review and synthetic user testing. Covers persona YAML structure, data ingestion, LLM simulation, validation loops, and CI/CD integration. Use when creating user personas, simulating user feedback, conducting role-based reviews, validating features with synthetic users, or generating persona-driven critiques. Triggers: create persona, user persona, agentic persona, user simulation, persona review, role-based review, persona feedback, synthetic user.

version: 1.0.0
triggers:
  - create persona
  - user persona
  - agentic persona
  - user simulation
  - persona review
  - role-based review
  - persona feedback
  - synthetic user
  - persona template
  - persona YAML
portable: true
---

# Creating Agentic Personas

Create and manage **active personas** -- LLM agents that react to specs, code, and UI in real-time for role-based review and synthetic user testing.

## Capabilities

1. **Ingest** -- Gather user data from support tickets, forums, reviews, and domain research
2. **Profile** -- Synthesize data into structured persona YAML with demographics, psychographics, frustrations, and vocabulary
3. **Simulate** -- Instantiate personas as LLM agents for role-specific feedback on features and UX decisions
4. **Validate** -- Compare synthetic persona responses against real user data to calibrate accuracy
5. **Review** -- Conduct role-based reviews producing concrete friction points and actionable recommendations
6. **Integrate** -- Embed persona-driven checks into CI/CD pipelines for continuous user-perspective validation

## Routing Logic

| Request type                                  | Load reference                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| Persona YAML template, field schema           | [references/persona-template.md](references/persona-template.md)         |
| Data ingestion, research sources, synthesis   | [references/ingestion.md](references/ingestion.md)                       |
| Instantiation, LLM simulation, role reviews   | [references/simulation.md](references/simulation.md)                     |
| Validation loop, calibration, drift detection | [references/validation.md](references/validation.md)                     |
| CI/CD integration, automation                 | [references/cicd.md](references/cicd.md)                                 |

## Core Principles

### 1. Active Over Passive

| Type                 | Description                                                          |
| -------------------- | -------------------------------------------------------------------- |
| **Passive Persona**  | Read the persona to *guess* how they might react                     |
| **Active Persona**   | Instantiate the persona as an LLM agent and *ask* it to react       |

Active personas produce testable, reproducible feedback. Passive personas collect dust in PDF files.

### 2. Data-Grounded Profiles

Every persona trait must trace back to real user data -- support tickets, forum posts, analytics, interviews. Invented traits create fictional users that mislead product decisions. When data is insufficient, flag the gap rather than fabricate.

### 3. Concrete Friction, Not Generic Preferences

Persona feedback should surface specific friction points in the workflow under review, not vague preferences. Good: "This three-step export flow adds 40 seconds to my hourly report cycle." Bad: "I prefer simpler interfaces."

### 4. Role-Aligned Vocabulary

Each persona speaks in the language of their role. A data engineer says "pipeline orchestration" not "data processing workflow." Vocabulary fields ground the LLM agent in authentic domain language that produces realistic critiques.

### 5. Validate Against Reality

Persona responses must be periodically compared to real user feedback. If synthetic responses diverge from actual user behavior, the persona needs recalibration. Track drift metrics and set thresholds for mandatory review.

### 6. One Persona, One Perspective

Each persona represents a single coherent viewpoint. Do not overload a persona with conflicting traits. If user research reveals contradictory preferences within a segment, split into separate personas.

## Workflow -- Creating a New Persona

1. **Research** -- Gather data from support tickets, forums, reviews, analytics, and interviews for the target user segment
2. **Synthesize** -- Extract demographics, psychographics, frustrations, vocabulary, and workflow patterns from the data
3. **Template** -- Create a persona YAML file using the standard schema (see [references/persona-template.md](references/persona-template.md))
4. **System prompt** -- Write the system prompt that instructs the LLM to embody this persona authentically
5. **Instantiate** -- Load the persona as an LLM agent and run initial test prompts against known scenarios
6. **Validate** -- Compare persona responses to real user feedback for the same scenarios
7. **Calibrate** -- Adjust traits, frustrations, and system prompt until synthetic output aligns with real data
8. **Store** -- Save the persona YAML in `.personas/` (or project-designated location) and commit

## Workflow -- Using Personas for Review

1. **Select** -- Choose a persona aligned with the feature area under review
2. **Context** -- Provide the persona agent with the spec, code, or UI flow to review
3. **Simulate** -- Ask the persona to walk through the workflow from their daily perspective
4. **Capture** -- Collect concrete friction points, not generic preferences
5. **Recommend** -- Translate persona feedback into product-language improvements
6. **Aggregate** -- Run multiple personas against the same feature to surface cross-role conflicts

## Quick Reference

### Persona file location

```
.personas/senior-dev-sarah.yml    # Project personas (shared via git)
.personas/data-engineer-dev.yml   # Each file = one persona
```

### Minimal persona YAML

```yaml
name: "Data Engineer Dev"
id: data-engineer-dev
role: "Data Engineer"
experience: "5+ years with Spark, Airflow, dbt"
frustrations:
  - "UI-only config with no code export"
  - "No version control for pipeline definitions"
vocabulary:
  - "DAG"
  - "lineage"
  - "idempotent"
system_prompt: |
  You are "Data Engineer Dev." You value reproducibility,
  version control, and code-first workflows...
```

### Quick commands

```bash
# Research user data for a persona
research "Top 10 pain points from support tickets for [role]"

# Create persona from research
persona create --from-data ./research.md --name "Primary User"

# Ask persona to review a spec
persona ask "data-engineer-dev" --context ./spec.md \
  "Walk through this feature from your daily workflow. What friction do you see?"

# Run all personas against a feature
persona review-all --context ./feature-spec.md
```

## Checklist -- Persona Quality

- [ ] Persona traces to real user data (not invented traits)
- [ ] YAML includes all required fields: name, id, role, experience, frustrations, vocabulary, system_prompt
- [ ] System prompt instructs the LLM to stay in character and produce role-specific feedback
- [ ] Frustrations are concrete and scenario-based, not generic
- [ ] Vocabulary reflects authentic domain language for the role
- [ ] Persona has been validated against real user feedback for at least two scenarios
- [ ] No conflicting traits within a single persona (split if needed)
- [ ] Persona file is stored in `.personas/` and committed to version control
- [ ] Persona version is incremented when traits are updated

## When to Escalate

- **Insufficient data** -- Not enough user feedback to build a credible persona for the target segment
- **Persona drift** -- Synthetic responses are diverging from real user behavior beyond acceptable thresholds
- **Conflicting traits** -- User data suggests contradictory preferences that cannot be resolved into a single persona
- **Cross-domain coverage** -- Feature spans multiple user segments with no existing personas; need a persona creation sprint
- **Validation failure** -- Persona consistently produces feedback that real users disagree with after recalibration attempts
