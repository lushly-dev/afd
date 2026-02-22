# Persona Simulation

How to instantiate personas as LLM agents and conduct role-based reviews.

## Instantiation

### Loading a Persona

The persona YAML is converted into an LLM system prompt plus structured context. The `system_prompt` field is the primary instruction. Other fields provide grounding context.

```
Effective system message = system_prompt + structured traits (frustrations, vocabulary, workflow)
```

### Prompt Construction

When asking a persona to review something, structure the prompt in three parts:

1. **System** -- The persona's `system_prompt` plus key traits
2. **Context** -- The spec, code, or UI flow being reviewed
3. **Task** -- A specific question or review instruction

### Example Review Prompt

```
[System: persona system_prompt + traits]

[Context]
Here is the feature specification for the new export dialog:
{spec content}

[Task]
Walk through this export flow from your daily workflow perspective.
Identify specific friction points, estimate time impact, and suggest
improvements using your own vocabulary.
```

## Review Patterns

### Single Persona Review

Use when you need depth on a specific user segment's perspective.

```bash
persona ask "senior-dev-sarah" --context ./spec.md \
  "What concerns do you have about this feature from your daily workflow?"
```

### Multi-Persona Sweep

Use when you need breadth across different user segments. Run all relevant personas against the same feature to surface cross-role conflicts.

```bash
persona review-all --context ./feature-spec.md
```

This produces a summary matrix:

| Persona              | Top Concern                          | Severity |
| -------------------- | ------------------------------------ | -------- |
| Senior Dev Sarah     | No CLI equivalent for export         | High     |
| Data Engineer Dev    | Export format not version-controllable| High     |
| Admin Annie          | No audit trail for exports           | Medium   |
| Report Builder Robin | Cannot schedule recurring exports    | High     |

### Comparative Review

Use when comparing two design options. Ask each persona to evaluate both options and state their preference with reasoning.

```
Given Option A (modal dialog) and Option B (inline panel),
which approach works better for your daily workflow? Explain
the specific time and friction impact of each.
```

## Simulation Guidelines

### Stay in Character

The persona agent should maintain the persona's perspective throughout the review. It should not:

- Offer balanced "on the other hand" analysis
- Suggest it is an AI playing a role
- Provide feedback outside its role's expertise

### Produce Concrete Output

Every piece of feedback should include:

- **What** -- The specific element causing friction
- **Why** -- How it impacts the persona's workflow
- **Impact** -- Time, effort, or frustration estimate
- **Suggestion** -- An improvement in the persona's own vocabulary

### Bad vs. Good Feedback

**Bad (generic):**
> "The export dialog could be simpler."

**Good (concrete):**
> "The three-step export flow adds about 40 seconds each time I run my
> hourly pipeline check. I'd want a one-click 'export as YAML' option
> or, better, a CLI command I can alias."

## Output Formats

### Friction Report

```markdown
## Persona: [Name]
### Feature: [Feature under review]

#### Friction Points
1. **[Element]** -- [Impact on workflow]. Severity: [High/Medium/Low]
2. **[Element]** -- [Impact on workflow]. Severity: [High/Medium/Low]

#### Recommendations
1. [Specific improvement in persona vocabulary]
2. [Specific improvement in persona vocabulary]

#### Overall Assessment
[1-2 sentence summary from persona's perspective]
```

### Comparison Matrix

```markdown
| Dimension        | Option A          | Option B          | Persona Preference |
| ---------------- | ----------------- | ----------------- | ------------------ |
| Speed            | [assessment]      | [assessment]      | [A or B]           |
| Learnability     | [assessment]      | [assessment]      | [A or B]           |
| Automation       | [assessment]      | [assessment]      | [A or B]           |
| **Overall**      |                   |                   | **[A or B]**       |
```
