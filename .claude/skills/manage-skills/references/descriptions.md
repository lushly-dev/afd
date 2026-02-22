# Writing Skill Descriptions

How to write effective skill descriptions that make AI agents load and use your skill at the right time.

## Description as Semantic Embedding Target

The `description` field is **the single most important field** for skill activation. AI tools — Claude Code, VS Code Copilot, Cursor, and any Agent Skills-compatible tool — read it to decide whether to load the full SKILL.md. The body of the skill is never seen until the description triggers a match.

Think of the description like **SEO for AI agents**. It functions as a semantic embedding target: the closer its language matches what a user is likely to say, the more reliably the skill activates. A brilliant skill with a vague description will never fire.

**Cross-platform note:** The description field is universal. It works the same way across Claude Code, VS Code Copilot, Cursor, and other Agent Skills-compatible tools. It's the one field you can count on being used everywhere.

## Rules

1. **Max 1024 characters** — hard limit from the [Agent Skills open standard](https://agentskills.io). Not a guideline; tools may truncate or reject longer descriptions.
2. **3rd-person voice** — write as if someone else is describing the skill's capabilities.
3. **Lead with function** — the first sentence states what the skill does.
4. **Include "Use when..." clauses** — these are the strongest activation signals.
5. **End with trigger keywords** — explicit keyword lists improve matching.

### 3rd-Person Voice

The description should read as a neutral capability statement, not a self-introduction.

```
✓ "Validates component accessibility against WCAG 2.1 AA. Use when building interactive UI."
✓ "Audits code for security vulnerabilities and implements secure patterns."

✗ "I help with accessibility."
✗ "This skill validates components."
✗ "Use this to validate your components."
```

## Description Formula

```
[What it does — 3rd person]. [What content it covers].
Use when [scenarios]. Triggers: [keywords].
```

## Components

### 1. What It Does

Lead with the primary function in 3rd person:

```
✓ "Content design expertise for Microsoft Fabric products."
✓ "API design guidance for REST and GraphQL APIs."
✓ "Component specification templates and patterns."

✗ "This skill helps with content."
✗ "A useful tool for various tasks."
✗ "I review content for style issues."
```

### 2. What Content It Covers

Specify the scope:

```
✓ "Reviews and generates UI text, error messages, notifications, 
   empty states, and documentation following Microsoft Writing Style Guide."

✓ "Covers naming conventions, versioning strategies, error handling, 
   and documentation standards."
```

### 3. When to Use (Trigger Conditions)

"Use when..." clauses are the strongest activation signals. Include:

- **Positive conditions** — scenarios where the skill applies:
  ```
  ✓ "Use when writing, reviewing, or improving any user-facing content."
  ✓ "Use when designing new APIs or reviewing existing endpoint definitions."
  ```

- **Observable symptoms** — what the user might say or do:
  ```
  ✓ "Trigger if the user mentions error messages, empty states, or button labels."
  ✓ "Trigger if the user asks about keyboard navigation or screen readers."
  ```

- **Negative conditions** (when helpful to prevent false matches):
  ```
  ✓ "Do NOT use for API-level documentation or developer guides."
  ✓ "Not for general code review — only accessibility-specific audits."
  ```

### 4. Trigger Keywords

Explicit keywords improve matching:

```
✓ "Triggers: content review, style guide, UX writing, error messages, 
   empty states, notifications, terminology."

✓ "Triggers: API design, REST, GraphQL, endpoint, schema, versioning."
```

## Examples

### Good Description

```yaml
description: >
  Content design expertise for Microsoft Fabric products. Reviews and generates
  UI text, error messages, notifications, empty states, and documentation
  following Microsoft Writing Style Guide. Use when writing, reviewing, or
  improving any user-facing content for Fabric workloads. Triggers: content
  review, style guide, UX writing, error messages, empty states, notifications,
  terminology, button labels, tooltips, Microsoft style.
```

**Why it works:**
- 3rd-person voice throughout
- Clear primary function
- Specific content types listed
- Explicit "Use when" scenarios
- Rich trigger keywords

### Poor Description

```yaml
description: >
  Helps with content for Fabric.
```

**Problems:**
- Too vague — matches nothing specific
- No trigger keywords
- Doesn't explain scope
- Won't match specific requests
- No "Use when" clause

## Trigger Keyword Selection

### Include

- Primary concepts (content, API, component)
- Specific items (error messages, endpoints, props)
- Actions (review, generate, validate)
- Synonyms (UI text, UX writing, copy)
- Product names (Fabric, Power BI)

### Avoid

- Generic words alone (help, guide, tool)
- Internal jargon users won't type
- Overly broad terms that match everything

## Length Optimization

With the 1024 character hard limit:

```
~200 chars: What it does + content scope
~150 chars: Use when scenarios
~200 chars: Trigger keywords
~400 chars: Buffer for details
```

Measure before committing. Descriptions over 1024 characters will be truncated or rejected by compliant tools.

## Testing Your Description

Ask yourself:

1. If a user asks "[request]", will this description match?
2. Are all the skill's capabilities mentioned or hinted at?
3. Would another skill's description also match? (overlap problem)
4. Are common synonyms included in triggers?
5. Is the voice consistently 3rd person?
6. Is it under 1024 characters?

## Multi-Skill Differentiation

When you have multiple skills, descriptions must differentiate:

```yaml
# Skill 1: .claude/skills/content-design/SKILL.md
description: >
  Content design for UI text and documentation...
  Triggers: content, writing, copy, UX text...

# Skill 2: .claude/skills/component-specs/SKILL.md
description: >
  Component specifications and API documentation...
  Triggers: component spec, props, API, interface...
```

Not:

```yaml
# Skill 1
description: >
  Helps with Fabric documentation...

# Skill 2
description: >
  Documentation assistance for Fabric...
```

Overlapping descriptions cause unpredictable activation. If two skills match equally, the agent picks one arbitrarily — or loads both, wasting context.
