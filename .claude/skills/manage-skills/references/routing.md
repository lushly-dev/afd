# Routing Tables

How to design effective routing tables for skills.

> **Progressive Loading:** Routing tables enable Stage 3 of progressive disclosure — references are only loaded when the routing table directs the agent to them. Without a routing table, all content must live in SKILL.md itself, bloating context on every invocation.

## Purpose

Routing tables tell Copilot which reference files to load for different request types. This enables:

- **Efficient context use** — Only load what's needed
- **Deep content** — Rich references without bloating SKILL.md
- **Clear organization** — Logical content structure

## Basic Format

```markdown
## Routing Logic

| Request type | Load reference |
|--------------|----------------|
| [Topic/trigger] | [references/file.md](references/file.md) |
```

## Column Definitions

### Request type

Keywords or topics that trigger loading:
- Use natural language
- Include synonyms
- Be specific enough to differentiate

### Load reference

Relative path to the reference file:
- Always use relative paths from SKILL.md
- Include `.md` extension
- Use Markdown link format

## Routing Patterns

### Single-Level Routing

Simple topic-to-file mapping:

```markdown
| Request type | Load reference |
|--------------|----------------|
| Grammar rules | [references/grammar.md](references/grammar.md) |
| Punctuation | [references/punctuation.md](references/punctuation.md) |
```

### Categorized Routing

Group by category with separate tables:

```markdown
### Style References

| Request type | Load reference |
|--------------|----------------|
| Grammar | [references/style/grammar.md](references/style/grammar.md) |
| Punctuation | [references/style/punctuation.md](references/style/punctuation.md) |

### Pattern References

| Request type | Load reference |
|--------------|----------------|
| Error messages | [references/patterns/errors.md](references/patterns/errors.md) |
| Empty states | [references/patterns/empty-states.md](references/patterns/empty-states.md) |
```

### Multi-Trigger Routing

Multiple triggers for same file:

```markdown
| Request type | Load reference |
|--------------|----------------|
| Errors, validation, form errors | [references/errors.md](references/errors.md) |
```

## Trigger Design

### Good Triggers

```
| Request type | Load reference |
|--------------|----------------|
| Button labels, action text, CTAs | [references/buttons.md] |
| Error messages, validation errors | [references/errors.md] |
| Power BI terms, semantic model | [references/power-bi.md] |
```

- Specific and descriptive
- Include common synonyms
- Match how users ask questions

### Poor Triggers

```
| Request type | Load reference |
|--------------|----------------|
| Buttons | [references/buttons.md] |
| Errors | [references/errors.md] |
| Terms | [references/terms.md] |
```

- Too vague
- Missing synonyms
- Could match unintended requests

## Organization Strategies

### By Content Type

```
references/
├── style/          # Writing style rules
├── patterns/       # UI patterns
├── terminology/    # Product terms
└── strategy/       # Planning/process
```

### By Feature Area

```
references/
├── data-engineering/
├── power-bi/
├── real-time/
└── shared/
```

### By Task

```
references/
├── review/         # Content review
├── generate/       # Content creation
├── validate/       # Validation rules
└── examples/       # Sample content
```

### Beyond References: scripts/ and hooks/

Routing tables typically point to `references/` files (documentation), but skills can also include executable directories:

```
.claude/skills/my-skill/
├── SKILL.md            # Routing table here
├── references/         # Documentation loaded on-demand
├── scripts/            # Deterministic helpers (linters, parsers, API wrappers)
└── hooks/              # Guardrail/janitor scripts (before/after tool calls)
```

- **`scripts/`** — Tasks the agent runs via terminal. Output clean Markdown/JSON to stdout.
- **`hooks/`** — Automatic checks that enforce constraints without agent reasoning.

The routing table can direct agents to run scripts just like it directs them to read references.

## Best Practices

1. **One topic per file** — Don't combine unrelated content
2. **Descriptive triggers** — Help Copilot match correctly
3. **Logical grouping** — Use folders for categories
4. **Avoid overlap** — Each request should map to one primary file
5. **Include examples** — Show what "good" looks like in each reference

## Common Mistakes

### Too Many Files

```
❌ 50+ tiny reference files
✓ 10-20 substantial reference files
```

### Overlapping Triggers

```
❌ "errors" → errors.md AND "validation" → errors.md AND "messages" → errors.md
✓ "error messages, validation errors, form errors" → errors.md
```

### Missing Triggers

```
❌ "capitalization" (but users say "title case", "sentence case")
✓ "capitalization, title case, sentence case, casing"
```
