# Skill File Format

Reference for the SKILL.md file structure, frontmatter schema, and body conventions. Based on the [Agent Skills open standard](https://agentskills.io) with Claude Code extension fields.

---

## Required Structure

Every skill is a single `SKILL.md` file inside a named directory:

```
.claude/skills/[skill-name]/SKILL.md
```

The file starts with YAML frontmatter delimited by `---`, followed by a Markdown body:

```markdown
---
name: skill-name
description: >
  What the skill does. What it covers. Use when [scenarios].
  Triggers: keyword1, keyword2.
---

# Skill Name

[Body content — instructions, routing tables, principles, examples]
```

> **Path:** Skills live under `.claude/skills/`, not `.github/skills/`. VS Code and Claude Code both discover skills from this location.

---

## Frontmatter Fields

Frontmatter is split into two groups: the **open standard** (portable across tools) and **Claude Code extensions** (may not work in all environments).

### Open Standard Fields (agentskills.io)

These fields are defined by the Agent Skills open standard and work across any compatible tool.

| Field | Required | Type | Max | Description |
|-------|----------|------|-----|-------------|
| `name` | **Yes** | string | 64 chars | Skill identifier. Must match parent directory name. |
| `description` | **Yes** | string | 1024 chars | Semantic embedding target — the AI reads this to decide activation. |
| `license` | No | string | 128 chars | SPDX identifier (e.g., `MIT`, `Apache-2.0`). |
| `compatibility` | No | string | 500 chars | Version or platform constraints. |
| `metadata` | No | map | 10 keys | Custom key-value pairs. Key max 64 chars, value max 256 chars. |
| `allowed-tools` | No | array | — | Restrict which tools the skill can access. Experimental. |

#### `name` rules

- Lowercase letters, digits, and single hyphens only
- Must start with a letter
- No consecutive hyphens (`--`)
- Regex: `^[a-z][a-z0-9](-?[a-z0-9])*$`
- Must exactly match the parent directory name

```yaml
# ✅ Valid
name: api-design
name: content-design
name: fast-element

# ❌ Invalid
name: API-Design       # uppercase
name: api--design      # consecutive hyphens
name: 3d-viewer        # starts with digit
```

#### `description` — the semantic embedding target

The description is what the AI reads to decide whether to activate the skill. It is the single most important field for routing accuracy. Write in 3rd person and include explicit trigger conditions.

**Formula:**

```
[What it does]. [What content it covers]. Use when [scenarios]. Triggers: [keywords].
```

**Example:**

```yaml
description: >
  Content design expertise for Microsoft Fabric products. Reviews and generates
  UI text, error messages, notifications, empty states, and documentation
  following Microsoft Writing Style Guide. Use when writing, reviewing, or
  improving any user-facing content for Fabric workloads. Triggers: content
  review, style guide, UX writing, error messages, empty states, notifications,
  terminology, button labels, tooltips, Microsoft style.
```

**Tips:**
- Front-load the most distinctive terms — embedding models weight early tokens higher.
- Include the domain, the actions, and the trigger keywords.
- Avoid filler phrases like "This skill helps you..." — state what it does directly.

### Claude Code Extension Fields

These fields extend the open standard with Claude Code-specific behavior. They may be ignored by other tools.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `version` | string | — | Semantic version (e.g., `"1.0.0"`). |
| `triggers` | array | — | Keywords for routing. Supplements `description`. |
| `portable` | boolean | `false` | If true, skill is used across projects (not repo-specific). |
| `context` | string | — | Set to `fork` to isolate execution in a subagent. |
| `user-invocable` | boolean | `true` | If true, appears in the `/` slash-command menu. If false, model-only "background skill" hidden from the menu. |
| `disable-model-invocation` | boolean | `false` | If true, user-only skill removed from model context entirely. Only invocable via `/` command. |
| `agent` | string | — | Agent type: `Explore`, `Plan`, `general-purpose`, or a custom name. |
| `model` | string | — | Override the model for this skill (e.g., `claude-sonnet`). |
| `argument-hint` | string | — | Placeholder text for the argument input (e.g., `"file path"`). |
| `hooks` | array | — | Inline hook definitions. See hooks reference for schema. |

**Interaction between `user-invocable` and `disable-model-invocation`:**

| `user-invocable` | `disable-model-invocation` | Behavior |
|---|---|---|
| `true` (default) | `false` (default) | Normal skill — user can invoke via `/`, model can auto-activate |
| `false` | `false` | Background skill — hidden from `/` menu, model auto-activates |
| `true` | `true` | User-only — appears in `/` menu, but model never loads it autonomously |
| `false` | `true` | Effectively disabled — neither user nor model can invoke |

---

## String Substitutions

Use these variables in the skill body. They are replaced at runtime:

| Variable | Resolves to |
|----------|-------------|
| `$ARGUMENTS` | Full argument string passed to the skill |
| `$ARGUMENTS[N]` or `$N` | Nth argument (0-indexed) |
| `${CLAUDE_SESSION_ID}` | Current session ID |

Example:

```markdown
Review the file at `$ARGUMENTS[0]` for accessibility compliance.
Focus on: $ARGUMENTS[1]
```

---

## Dynamic Context Injection

Use `` !`command` `` syntax in the skill body to inject command output as context at runtime. The command runs when the skill activates, and its stdout is inlined.

```markdown
Current git status:
!`git status --short`

Changed files:
!`git diff --name-only HEAD~1`
```

This keeps skills dynamic without hardcoding volatile data.

---

## Body Content

After the frontmatter, the Markdown body contains the actual instructions. Structure it for progressive disclosure — the AI loads the full body into context, so brevity matters.

### Recommended sections

1. **H1 title** — Matches the skill name
2. **Brief intro** — One sentence on what the skill does
3. **Capabilities** — Numbered list of what it can do
4. **Routing table** — Maps request types to reference files
5. **Core principles** — Always-apply rules (keep to 5–7)
6. **Output format** — How responses should be structured
7. **Escalation criteria** — When to flag for human review

### XML tags for LLM parsing

Wrap structured sections in XML tags for cleaner LLM consumption:

```markdown
<context>
This skill operates on the Violet design token platform.
Tokens use a hierarchical node tree with inheritance.
</context>

<rules>
- Always return CommandResult from handlers
- Errors must include a `suggestion` field
- Command names use kebab-case
</rules>

<workflow>
1. Define command with Zod schema
2. Validate via CLI
3. Surface in UI
</workflow>

<examples>
```typescript
const cmd = defineCommand({
  name: 'token-create',
  description: 'Create a design token',
  input: z.object({ name: z.string() }),
  handler: async (input) => success({ id: '1', name: input.name }),
});
```
</examples>
```

### Keep it concise

- Target < 500 lines for the body
- Move detailed reference material into `references/` subdirectory files
- Use a routing table to point to references on demand
- The body is always loaded; references are loaded only when needed

---

## File Location

```
.claude/skills/[skill-name]/SKILL.md
.claude/skills/[skill-name]/references/    ← optional deep-dive files
.claude/skills/[skill-name]/scripts/       ← optional automation scripts
.claude/skills/[skill-name]/assets/        ← optional templates, configs
```

The directory name must match the `name` field in frontmatter exactly.

---

## Example: Minimal Skill

```markdown
---
name: example-skill
description: >
  Example skill demonstrating minimal structure. Shows required fields
  and basic body layout. Use for reference when creating new skills.
  Triggers: example, demo, template, skeleton.
---

# Example Skill

Demonstrates the minimal viable skill structure.

## Capabilities

1. **Demo** — Shows the required SKILL.md format

## Core Principles

- Keep it simple
- Be specific about triggers
- Front-load distinctive terms in the description
```

## Example: Full Skill

```markdown
---
name: api-design
description: >
  API design guidance for REST and GraphQL services. Covers naming conventions,
  versioning strategies, error handling, pagination, and documentation standards.
  Use when designing, reviewing, or documenting APIs. Triggers: API design, REST,
  GraphQL, endpoint, schema, versioning, error response, pagination.
version: "2.0.0"
triggers:
  - api design
  - REST
  - GraphQL
  - endpoint
  - schema
portable: true
agent: general-purpose
argument-hint: "API endpoint or schema file"
metadata:
  domain: backend
  standard: openapi-3.1
---

# API Design

Expert guidance for designing consistent, usable APIs.

## Capabilities

1. **Design review** — Check APIs against standards
2. **Pattern guidance** — Apply REST/GraphQL best practices
3. **Documentation** — Generate OpenAPI specs and usage docs
4. **Error design** — Structured error response schemas

## Routing Table

| Request type | Load reference |
|---|---|
| REST conventions | [references/rest.md](references/rest.md) |
| GraphQL patterns | [references/graphql.md](references/graphql.md) |
| Error responses | [references/errors.md](references/errors.md) |
| Versioning | [references/versioning.md](references/versioning.md) |
| Pagination | [references/pagination.md](references/pagination.md) |

## Core Principles

<rules>
- Consistent naming: camelCase for JSON fields, kebab-case for URL paths
- Meaningful HTTP status codes — never return 200 for errors
- Every error includes a machine-readable `code` and a human-readable `message`
- Version in URL path (`/v1/`) for breaking changes
- Pagination via cursor, not offset, for large collections
</rules>

## Output Format

### For reviews
- List of issues with severity, location, and fix
- Revised API definition with changes highlighted

### For generation
- Complete endpoint definition (method, path, params, body, response)
- Request/response examples with realistic data

## When to Escalate

- Breaking changes to published APIs
- Security-sensitive endpoints (auth, PII)
- New authentication or authorization patterns
```

---

## Quick Reference: All Frontmatter Fields

```yaml
---
# ── Open Standard (agentskills.io) ──────────────────────────
name: skill-name                    # required, max 64, must match directory
description: >                      # required, max 1024, semantic target
  What it does. What it covers.
  Use when [scenarios]. Triggers: [keywords].
license: MIT                        # optional, SPDX identifier
compatibility: "Claude Code 1.x+"  # optional, version/platform notes
metadata:                           # optional, max 10 keys
  domain: frontend
  framework: fast-element
allowed-tools:                      # optional, experimental
  - read_file
  - grep_search

# ── Claude Code Extensions ──────────────────────────────────
version: "1.0.0"                    # semantic version
triggers:                           # routing keywords
  - keyword1
  - keyword2
portable: false                     # true = cross-project
context: fork                       # isolate in subagent
user-invocable: true                # show in / menu
disable-model-invocation: false     # hide from model context
agent: general-purpose              # Explore | Plan | custom
model: claude-sonnet                # model override
argument-hint: "file path"          # input placeholder
hooks:                              # inline hook definitions
  - event: on-activate
    run: echo "skill loaded"
---
```
