# Command Skill / Knowledge Layer Specification

> An optional system for bundling agent-facing prose documentation alongside AFD commands, providing strategic guidance that schemas alone cannot convey.

## Summary

Add a `CommandSkill` type and co-location convention to `@lushly-dev/afd-server`, a `skill` field to `ZodCommandOptions`, a `validateCommandSkills()` function to `@lushly-dev/afd-testing`, and a `skill-docs` bootstrap command to `@lushly-dev/afd-server`. Together these let server authors ship Markdown guidance files alongside commands so agents understand *when*, *why*, and *how* to use a command — not just *what* its inputs are.

This is a pure additive feature. No existing APIs change. All new fields are optional.

## User Value

- **Agent accuracy** — Agents choose the right command more often when descriptions are supplemented with strategic context (patterns, anti-patterns, sequencing advice)
- **Onboarding velocity** — New agents or IDE extensions can read command skills to bootstrap domain understanding without human instruction
- **Drift prevention** — Co-locating guidance with command source means docs evolve alongside code, unlike external wikis
- **Gradualism** — Servers without command skills work exactly as before; command skills are opt-in per command or per category
- **Lint-enforced quality** — A validation pass catches orphaned skills, missing references, and naming issues before deployment
- **Complements existing tools** — Works alongside `afd-help` (command listing), `afd-docs` (schema docs), and `afd-schema` (JSON Schema) to complete the knowledge surface

## User Stories

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-1 | Server author | Write a Markdown file next to my command that explains when to use it | Agents have strategic context beyond the schema |
| US-2 | Server author | Reference the command skill from my `defineCommand()` call | The doc is discoverable at build-time and runtime |
| US-3 | Agent | Query a server for all command skill documents | I understand the full domain guidance before acting |
| US-4 | Agent | Get the command skill for a specific command | I have strategic guidance for my current task |
| US-5 | CI pipeline | Fail the build when a skill file has broken references or missing frontmatter | Documentation quality is enforced automatically |
| US-6 | Server author | Opt out of command skills entirely | My existing server still works with zero changes |
| US-7 | Team lead | See which commands have skill docs and which don't | I can plan documentation efforts |

---

## Functional Requirements

### FR-1: Command Skill Format

A command skill is a Markdown file with YAML frontmatter. The format mirrors the existing skills specification used across the Lushly workspace (`.claude/skills/`), but serves a different audience and lifecycle (see [Relationship to Claude Code Skills](#relationship-to-claude-code-skills)).

```typescript
/**
 * Parsed representation of a .skill.md file that provides agent-facing
 * guidance for one or more commands.
 *
 * Defined in @lushly-dev/afd-server (not afd-core — see API Design).
 */
interface CommandSkill {
  /** Unique skill name, kebab-case (must match filename minus extension) */
  name: string;

  /** Human-readable summary for routing (what the skill covers and when to use it) */
  description: string;

  /** Semver version string */
  version?: string;

  /** Grouping category (should align with command categories where applicable) */
  category?: string;

  /** Keywords that trigger this skill during agent routing */
  triggers?: string[];

  /** The full Markdown body (everything below the frontmatter) */
  body: string;

  /** Relative paths to reference files (resolved from skill file location) */
  references?: string[];
}
```

**File format example:**

```markdown
---
name: garden-planning
description: >
  Strategic guidance for garden planning commands. Covers seasonal timing,
  companion planting patterns, and bed layout optimization.
  Use when: planning gardens, creating beds, or scheduling plantings.
  Triggers: garden, bed, planting, companion, season.
version: "1.0.0"
category: garden
triggers:
  - garden planning
  - bed layout
  - companion planting
---

# Garden Planning

Guidance for using the garden planning commands effectively.

## When to Use

- `garden-create` — Start here when a user mentions a new garden...
- `bed-create` — Use after garden exists, when user wants planting areas...

## Patterns

### Companion Planting Sequence

Always run `plant-companions` before `bed-create` to validate...

## Anti-Patterns

- Don't call `garden-create` if a garden already exists — use `garden-get` first...
```

### FR-2: Co-location Convention

Command skill documents live alongside command source files using a predictable naming convention:

```
src/commands/
├── garden/
│   ├── create.ts              # defineCommand({ name: 'garden-create', ... })
│   ├── create.skill.md        # command skill for garden-create
│   ├── list.ts
│   └── list.skill.md
├── plant/
│   ├── search.ts
│   ├── search.skill.md
│   └── taxonomy.ts            # no skill doc — that's fine
└── garden.skill.md            # category-level skill (covers all garden-* commands)
```

**Naming rules:**

| Pattern | Scope | Example |
|---------|-------|---------|
| `{command-stem}.skill.md` | Single command | `create.skill.md` for `garden-create` |
| `{category}.skill.md` | All commands in category | `garden.skill.md` for `garden-*` |

Category-level skills provide shared context (domain model, glossary, sequencing) while command-level skills provide specific how-to guidance.

**Important:** Skill files live in the **source tree** (e.g., `src/commands/`), not alongside compiled output in `dist/`. The `basePath` option on discovery and resolution functions should point to the source root. See [Path Resolution](#path-resolution) for details.

### FR-3: Command Definition Integration

Add an optional `skill` field to `ZodCommandOptions` and `ZodCommandDefinition` in `@lushly-dev/afd-server`:

```typescript
// Addition to ZodCommandOptions (schema.ts)
export interface ZodCommandOptions<TInput, TOutput> {
  // ... existing fields ...

  /**
   * Inline skill content or path to a .skill.md file.
   *
   * - String ending in ".skill.md": treated as a file path, resolved
   *   relative to the `basePath` passed to `resolveCommandSkills()`.
   * - Other strings: treated as inline Markdown content.
   * - CommandSkill object: pre-parsed command skill.
   *
   * @example
   * // File reference (resolved relative to basePath, not this file)
   * skill: 'garden/create.skill.md',
   *
   * // Inline content for small guidance
   * skill: 'Always check garden exists before creating beds.',
   *
   * // Pre-parsed document
   * skill: { name: 'garden-create', description: '...', body: '...' },
   */
  skill?: string | CommandSkill;
}

// Addition to ZodCommandDefinition
export interface ZodCommandDefinition<TInput, TOutput> {
  // ... existing fields ...

  /** Command skill for this command (parsed or path) */
  skill?: string | CommandSkill;
}
```

The skill field is purely optional. Commands without skills behave exactly as they do today.

### FR-4: Command Skill Loader

A utility module in `@lushly-dev/afd-server` that resolves skill paths to parsed `CommandSkill` objects:

```typescript
/**
 * Options for loading command skill documents.
 */
interface CommandSkillLoaderOptions {
  /**
   * Base directory for resolving skill paths. Defaults to process.cwd().
   *
   * This should point to the **source tree** (e.g., './src/commands'),
   * not the compiled output directory. Skill .md files are not compiled
   * and must be read from their original location.
   */
  basePath?: string;

  /** Glob patterns for discovering skill files (default: ['**/*.skill.md']) */
  patterns?: string[];

  /** Directories to exclude (default: ['node_modules', 'dist', '.git']) */
  exclude?: string[];
}

/**
 * Load and parse a single command skill from a Markdown file.
 *
 * @param filePath - Absolute or relative path to a .skill.md file
 * @returns Parsed CommandSkill or null if file not found
 */
function loadCommandSkill(filePath: string): CommandSkill | null;

/**
 * Discover and load all command skills in a directory tree.
 *
 * Results are cached for the lifetime of the process. Subsequent calls
 * with the same basePath return the cached Map. Pass `cache: false` to
 * force a re-scan (useful in watch mode or tests).
 *
 * @param options - Loader options
 * @returns Map of skill name → CommandSkill
 */
function discoverCommandSkills(
  options?: CommandSkillLoaderOptions & { cache?: boolean }
): Map<string, CommandSkill>;

/**
 * Resolve skill references on a set of ZodCommandDefinitions.
 *
 * For each command with a string `skill` field ending in `.skill.md`,
 * resolves the path relative to `basePath`, loads and parses the file,
 * and replaces the string with a CommandSkill object.
 *
 * For inline strings (not ending in `.skill.md`), wraps them in a
 * minimal CommandSkill with `name` derived from the command name.
 *
 * Commands with pre-parsed CommandSkill objects are left as-is.
 *
 * @param commands - Commands to resolve
 * @param basePath - Base directory for resolving relative paths
 * @returns Commands with resolved command skill documents
 */
function resolveCommandSkills(
  commands: ZodCommandDefinition[],
  basePath?: string
): ZodCommandDefinition[];
```

**Frontmatter parsing** uses a minimal built-in parser (split on `---` delimiters, parse key-value pairs and YAML arrays). Command skill frontmatter only uses flat string fields and string arrays, so a full YAML parser is not needed. No new dependencies are required.

### FR-5: Bootstrap Command — `skill-docs`

A new bootstrap command in `@lushly-dev/afd-server` that returns command skill documents to agents:

```typescript
const inputSchema = z.object({
  /**
   * Specific command name, category name, or omit for all.
   * When omitted, returns a summary of all command skills.
   */
  query: z.string().optional().describe(
    'Command name, category, or skill name to look up'
  ),
  /** Return format */
  format: z.enum(['full', 'summary']).default('summary').describe(
    'full = complete Markdown body, summary = frontmatter only'
  ),
});

interface SkillDocsOutput {
  /** Matched command skill documents */
  skills: CommandSkillSummary[];
  /** Total count */
  total: number;
  /** Commands without any skill coverage */
  uncovered: string[];
}

interface CommandSkillSummary {
  /** Skill name */
  name: string;
  /** Skill description */
  description: string;
  /** Category */
  category?: string;
  /** Triggers */
  triggers?: string[];
  /**
   * Commands this skill covers.
   *
   * Populated by combining two sources:
   * 1. Commands that reference this skill via their `skill` field
   *    (either by path or by matching CommandSkill name).
   * 2. Commands whose `category` matches this skill's `category`
   *    (for category-level skills only).
   *
   * Command-level skills list only their specific command.
   * Category-level skills list all commands in the category.
   */
  commands: string[];
  /** Full Markdown body (only in 'full' format) */
  body?: string;
}
```

**Behavior:**

- `skill-docs` with no query → returns summary of all skills + uncovered commands
- `skill-docs { query: "garden-create" }` → returns the skill covering that command
- `skill-docs { query: "garden", format: "full" }` → returns the category-level skill with full body
- `skill-docs { query: "garden-create", format: "full" }` → returns full body for the command-level skill

This command is added to the bootstrap registry alongside `afd-help`, `afd-docs`, and `afd-schema`.

### FR-6: Command Skill Validation

A `validateCommandSkills()` function in `@lushly-dev/afd-testing` that performs static analysis on command skill documents:

```typescript
interface CommandSkillValidationOptions {
  /** Commands to check coverage against */
  commands: Array<{ name: string; category?: string }>;

  /** Command skill documents to validate */
  skills: CommandSkill[];

  /** Require every command to have a skill doc */
  requireCoverage?: boolean;

  /** Maximum allowed body length in characters (default: 10000) */
  maxBodyLength?: number;

  /** Require version field in frontmatter */
  requireVersion?: boolean;

  /** Require triggers in frontmatter */
  requireTriggers?: boolean;

  /**
   * Minimum description length in characters (default: 20).
   * Set to 0 to disable the length check.
   */
  minDescriptionLength?: number;

  /**
   * Patterns to check for in description text (default: []).
   * When non-empty, descriptions must contain at least one of these
   * substrings (case-insensitive) or the description-quality rule fires.
   * Example: ['use when', 'triggers:']
   */
  descriptionPatterns?: string[];
}

interface CommandSkillValidationResult {
  /** Overall pass/fail */
  valid: boolean;

  /** Findings */
  findings: CommandSkillFinding[];

  /** Coverage summary */
  coverage: CommandSkillCoverage;
}

interface CommandSkillFinding {
  /** Rule that generated this finding */
  rule: CommandSkillRule;

  /** Severity */
  severity: 'error' | 'warning';

  /** Affected skill or command name */
  target: string;

  /** Human-readable message */
  message: string;

  /** Actionable fix */
  suggestion: string;
}

type CommandSkillRule =
  | 'orphaned-skill'        // Skill not referenced by any command
  | 'missing-frontmatter'   // Required YAML fields absent
  | 'broken-reference'      // Reference file path doesn't resolve
  | 'name-mismatch'         // Skill name doesn't match filename
  | 'description-quality'   // Description too short or missing expected patterns
  | 'body-too-long'         // Body exceeds max length
  | 'duplicate-coverage'    // Two skills claim the same command
  | 'missing-coverage';     // Command without any skill doc (when requireCoverage)

interface CommandSkillCoverage {
  /** Total commands checked */
  totalCommands: number;
  /** Commands with at least one skill doc */
  coveredCommands: number;
  /** Coverage percentage (0–100) */
  coveragePercent: number;
  /** Commands without coverage */
  uncoveredCommands: string[];
}
```

**Validation rules:**

| Rule | Severity | What it checks |
|------|----------|----------------|
| `orphaned-skill` | warning | A `.skill.md` file exists but no command references it and it doesn't match any category |
| `missing-frontmatter` | error | Required `name` or `description` fields missing from YAML frontmatter |
| `broken-reference` | error | A `references/` path listed in the skill doesn't resolve to a file |
| `name-mismatch` | error | The `name` field in frontmatter doesn't match the filename stem |
| `description-quality` | warning | Description is under `minDescriptionLength` characters (default: 20), or when `descriptionPatterns` is configured, lacks any of the expected substrings |
| `body-too-long` | warning | Body exceeds configured max length (default 10,000 chars) |
| `duplicate-coverage` | warning | Two command-level skills claim the same command |
| `missing-coverage` | warning/error | A command has no skill doc (error when `requireCoverage: true`) |

### FR-7: CLI Integration

Extend the existing `afd validate` CLI command with a `--skills` flag:

```bash
# Validate all command skills in the project
afd validate --skills

# Validate skills with full coverage requirement
afd validate --skills --strict

# Show skill coverage report
afd validate --skills --verbose
```

**Output format matches existing validate output:**

```
Command Skill Validation
═══════════════════════════════════════════
✓ garden-planning: valid (covers garden-create, garden-get, garden-list)
✓ plant-search: valid
✗ bed-layout: broken-reference — references/diagrams.md not found
  → Create the file or remove the reference from frontmatter

Coverage: 8/12 commands (67%)
  Uncovered: weather-current, weather-forecast, calendar-frost-dates, calendar-season

Findings: 1 error, 0 warnings
```

---

## API Design

### Package placement

| Component | Package | Rationale |
|-----------|---------|-----------|
| `CommandSkill` type | `@lushly-dev/afd-server` | Used by server and testing; not needed by lightweight clients. Testing already depends on server. Keeps core lightweight. |
| `skill` field on `ZodCommandOptions` | `@lushly-dev/afd-server` | Server-side command definition |
| `loadCommandSkill`, `discoverCommandSkills`, `resolveCommandSkills` | `@lushly-dev/afd-server` | File I/O belongs in server package |
| `createSkillDocsCommand` | `@lushly-dev/afd-server` (bootstrap) | Joins existing bootstrap commands |
| `validateCommandSkills` | `@lushly-dev/afd-testing` | Joins existing validators |
| `--skills` flag | `@lushly-dev/afd-cli` | Extends existing validate command |

### Exports

**`@lushly-dev/afd-server` additions:**

```typescript
// command-skill.ts — new type
export interface CommandSkill { ... }

// schema.ts — skill field added to ZodCommandOptions & ZodCommandDefinition
// command-skill-loader.ts — new module
export {
  loadCommandSkill,
  discoverCommandSkills,
  resolveCommandSkills,
} from './command-skill-loader.js';

// bootstrap/skill-docs.ts — new bootstrap command
export { createSkillDocsCommand } from './bootstrap/skill-docs.js';
```

**`@lushly-dev/afd-testing` additions:**

```typescript
// command-skill-validators.ts — new module
export {
  validateCommandSkills,
  type CommandSkillValidationOptions,
  type CommandSkillValidationResult,
  type CommandSkillFinding,
  type CommandSkillRule,
  type CommandSkillCoverage,
} from './command-skill-validators.js';
```

---

## Examples

### Basic: Single command with inline skill

```typescript
const createGarden = defineCommand({
  name: 'garden-create',
  description: 'Create a new garden with location and zone info',
  category: 'garden',
  mutation: true,
  input: z.object({
    name: z.string().min(1),
    zone: z.string().describe('USDA hardiness zone'),
  }),
  // Inline skill — just a string of guidance
  skill: 'Check for existing gardens first with garden-list. ' +
         'Zone is required — use calendar-frost-dates to look it up if the user doesn\'t know.',
  async handler(input) {
    // ...
    return success(garden, { reasoning: `Created garden "${garden.name}" in zone ${garden.zone}` });
  },
});
```

### Intermediate: File-referenced skill

```typescript
// src/commands/garden/create.ts
const createGarden = defineCommand({
  name: 'garden-create',
  description: 'Create a new garden with location and zone info',
  category: 'garden',
  mutation: true,
  input: z.object({ ... }),
  skill: 'garden/create.skill.md',  // resolved relative to basePath
  async handler(input) { ... },
});
```

```markdown
<!-- src/commands/garden/create.skill.md -->
---
name: garden-create
description: >
  When and how to create gardens. Covers zone lookup, naming, and
  prerequisite checks.
  Use when: user wants a new garden.
  Triggers: garden, create, new garden, start garden.
version: "1.0.0"
category: garden
triggers:
  - new garden
  - create garden
  - start garden
---

# Garden Creation

## Prerequisites

Before calling `garden-create`:
1. Call `garden-list` to check if a garden with this name already exists
2. If the user doesn't know their USDA zone, call `calendar-frost-dates` with their zip code

## Input Guidance

- **name**: Use the name the user provides. Default to "{City} Garden" if none given.
- **zone**: Must be a valid USDA zone (e.g., "7b"). Reject free-form text.

## After Creation

- Suggest `bed-create` as the next step
- If the user mentioned specific plants, queue a `plant-search` call
```

### Advanced: Category-level skill with reference files

```markdown
<!-- src/commands/garden/garden.skill.md -->
---
name: garden-planning
description: >
  Shared context for all garden-* commands: domain model, seasonal
  considerations, and companion planting rules.
  Use when: any garden planning task.
  Triggers: garden, bed, planting, companion, season.
version: "1.0.0"
category: garden
triggers:
  - garden planning
  - bed layout
  - companion planting
references:
  - references/companion-matrix.md
  - references/zone-calendar.md
---

# Garden Planning Domain

## Domain Model

- **Garden** → has many **Beds** → has many **Plantings**
- Each garden has a USDA zone that drives frost dates
- Beds have dimensions and soil type

## Command Sequencing

Typical workflow:
1. `garden-create` → establish the garden
2. `bed-create` (repeat) → define planting areas
3. `plant-search` → find suitable plants for the zone
4. `calendar-planting-window` → check timing

## Companion Planting

See [references/companion-matrix.md](references/companion-matrix.md) for the full matrix.
Quick rules: tomatoes + basil = good, tomatoes + fennel = bad.
```

### End-to-end server wiring

This example shows how `createMcpServer()` integrates command skills from discovery through to the bootstrap command:

```typescript
import { createMcpServer, discoverCommandSkills, resolveCommandSkills } from '@lushly-dev/afd-server';
import { createGarden, listGardens, getGarden } from './commands/garden/index.js';
import { searchPlants } from './commands/plant/index.js';

// 1. Define commands as usual
const commands = [createGarden, listGardens, getGarden, searchPlants];

// 2. Discover all .skill.md files in the source tree
const skills = discoverCommandSkills({ basePath: './src/commands' });

// 3. Resolve file-path skill references on commands
const resolvedCommands = resolveCommandSkills(commands, './src/commands');

// 4. Pass both to createMcpServer — it wires up skill-docs automatically
const server = createMcpServer({
  name: 'garden-server',
  version: '1.0.0',
  commands: resolvedCommands,
  skills,  // enables the skill-docs bootstrap command
});

await server.start();
```

Inside `createMcpServer()`, when `skills` is provided:

```typescript
// server.ts (internal wiring)
export function createMcpServer(options: McpServerOptions) {
  // ... existing setup ...

  const bootstrapCommands = getBootstrapCommands(
    () => registry.list(),
    {
      getJsonSchema: (cmd) => /* ... */,
      skills: options.skills,  // passed through to bootstrap registry
    }
  );

  // skill-docs command is conditionally added inside getBootstrapCommands()
  // only when skills Map is non-empty
}
```

### Validation in CI

```typescript
import { validateCommandSkills } from '@lushly-dev/afd-testing';
import { discoverCommandSkills } from '@lushly-dev/afd-server';
import { describe, it, expect } from 'vitest';

describe('command skill quality', () => {
  it('all command skills pass validation', () => {
    const commands = server.getCommands().map(c => ({
      name: c.name,
      category: c.category,
    }));

    const skills = Array.from(
      discoverCommandSkills({ basePath: './src/commands' }).values()
    );

    const result = validateCommandSkills({
      commands,
      skills,
      requireCoverage: false,  // not yet — ramp up gradually
      requireVersion: true,
    });

    expect(result.valid).toBe(true);
    if (!result.valid) {
      console.log('Findings:', result.findings);
    }

    // Optional: track coverage metric
    console.log(`Skill coverage: ${result.coverage.coveragePercent}%`);
  });
});
```

---

## Implementation Notes

### Frontmatter Parsing

Command skill frontmatter uses only flat string fields and string arrays. A minimal built-in parser is sufficient — no external `yaml` dependency is needed:

```typescript
function parseCommandSkillFile(content: string): CommandSkill | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = parseSimpleFrontmatter(match[1]);
  const body = match[2].trim();

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    version: frontmatter.version,
    category: frontmatter.category,
    triggers: frontmatter.triggers,   // parsed as string[]
    references: frontmatter.references, // parsed as string[]
    body,
  };
}

/**
 * Minimal frontmatter parser for flat key-value pairs and string arrays.
 * Handles: `key: value`, `key: >` (folded block), and `- item` arrays.
 *
 * Does NOT handle nested objects, anchors, or other advanced YAML features.
 * This is intentional — command skill frontmatter is kept simple.
 */
function parseSimpleFrontmatter(raw: string): Record<string, string | string[]> {
  // Implementation: split lines, parse key-value pairs,
  // detect array items (lines starting with "  - "),
  // handle folded block scalars (key: >)
}
```

If a project needs advanced YAML features in frontmatter (unlikely), they can add the `yaml` package and provide a custom parser. The default built-in parser covers all cases shown in this spec.

### Path Resolution

All `.skill.md` file paths are resolved relative to a **`basePath`** parameter, not relative to the importing TypeScript file. This avoids issues with compiled output directories:

```
Project root
├── src/commands/              ← basePath points here
│   ├── garden/
│   │   ├── create.ts          ← skill: 'garden/create.skill.md'
│   │   └── create.skill.md   ← resolved as: basePath + 'garden/create.skill.md'
│   └── plant/
│       └── search.skill.md
├── dist/commands/             ← compiled JS lives here (no .skill.md files)
│   ├── garden/
│   │   └── create.js
│   └── plant/
│       └── search.js
```

**Resolution rules for `resolveCommandSkills()`:**

1. **Pre-parsed `CommandSkill` object** → use as-is
2. **String ending in `.skill.md`** → resolve as `path.resolve(basePath, skillPath)`, call `loadCommandSkill()`
3. **Other string** → wrap in a minimal `CommandSkill` with `name` derived from the command name and the string as `body`

Note: the `./` prefix is **not required** for file paths. The `.skill.md` extension alone is the discriminator. This avoids confusion with Node.js import resolution semantics.

### Discovery Matching

`discoverCommandSkills()` maps files to commands using the following rules, in priority order:

#### 1. Frontmatter `name` field (highest priority)

The `name` field in YAML frontmatter is the authoritative identifier. When present, it takes precedence over any filename-based convention.

```yaml
# In: src/commands/garden/create.skill.md
name: garden-create   # ← this is the skill's identity
```

#### 2. Filename + directory convention (fallback)

When frontmatter `name` is absent, the skill name is derived from the file's location:

```
{parent-directory}-{filename-stem}
```

Only the **immediate parent directory** is used as a prefix. Deeper nesting is not automatically included:

| File path | Derived name |
|-----------|-------------|
| `garden/create.skill.md` | `garden-create` |
| `plant/search.skill.md` | `plant-search` |
| `garden/beds/create.skill.md` | `beds-create` (not `garden-beds-create`) |

If deeper nesting is needed, use the frontmatter `name` field to set the correct name explicitly.

#### 3. Category-level skills

Files named `{category}.skill.md` (where the filename stem matches a command category) are treated as category-level skills. They cover **all commands** with that category:

| File | Matches |
|------|---------|
| `garden.skill.md` with `category: garden` | All commands with `category: 'garden'` |

A category-level skill must have a `category` field in frontmatter that matches its filename stem.

#### 4. Query resolution precedence (for `skill-docs` command)

When an agent queries `skill-docs { query: "garden-create" }`:

1. **Exact command match**: Find a command-level skill named `garden-create` → return it
2. **Category fallback**: If no exact match, find a category-level skill whose category matches the command's category → return it
3. **Both exist**: Return **both** — the command-level skill first (most specific), then the category-level skill. The agent gets both specific and contextual guidance.

When querying by category name (`skill-docs { query: "garden" }`):

1. Return the category-level skill if one exists
2. Also return all command-level skills in that category

#### 5. Directory name normalization

Directory names containing underscores or camelCase are normalized to kebab-case when deriving skill names:

| Directory | Normalized prefix |
|-----------|------------------|
| `garden_planning/` | `garden-planning` |
| `gardenPlanning/` | `garden-planning` |
| `garden-planning/` | `garden-planning` (already kebab-case) |

### Bootstrap Registration

The `skill-docs` command is added to `getBootstrapCommands()` conditionally — only when command skills are provided:

```typescript
export function getBootstrapCommands(
  getCommands: () => CommandDefinition[],
  options?: {
    getJsonSchema?: (cmd: CommandDefinition) => Record<string, unknown>;
    skills?: Map<string, CommandSkill>;
  }
): CommandDefinition[] {
  const commands = [
    createAfdHelpCommand(getCommands),
    createAfdDocsCommand(getCommands),
    createAfdSchemaCommand(getCommands, options?.getJsonSchema),
  ];

  if (options?.skills && options.skills.size > 0) {
    commands.push(createSkillDocsCommand(getCommands, options.skills));
  }

  return commands;
}
```

### Performance

- **Skill loading** happens once at server startup, not per-request. The `discoverCommandSkills()` function uses `node:fs/promises` with glob matching and caches results by `basePath`. Subsequent calls return the cached Map unless `cache: false` is passed.
- **Skill validation** is a build-time / CI-time operation. No runtime cost.
- **`skill-docs` queries** are Map lookups — O(1) for name/command queries, O(n) for category scans where n = number of skills.
- **Memory overhead** is minimal: a typical skill doc is 1–5 KB. A server with 50 skills adds ~250 KB.

---

## Relationship to Existing Types

### Existing validation hierarchy

| Tier | Function | Scope | Package |
|------|----------|-------|---------|
| 1 | `validateCommandDefinition()` | Per-command structure | `@lushly-dev/afd-testing` |
| 2 | `validateResult()` | Per-response contract | `@lushly-dev/afd-testing` |
| 3 | `validateCommandSurface()` | Cross-command analysis | `@lushly-dev/afd-testing` (proposed) |
| **4** | **`validateCommandSkills()`** | **Skill quality + coverage** | **`@lushly-dev/afd-testing`** |

### Existing bootstrap commands

| Command | Returns | Scope |
|---------|---------|-------|
| `afd-help` | Command list with categories | What's available |
| `afd-docs` | Parameter tables, mutation flags | How to call it |
| `afd-schema` | JSON Schema for inputs | What's accepted |
| **`skill-docs`** | **Strategic guidance Markdown** | **When/why/how to use it** |

### Relationship to `CommandDefinition`

`CommandSkill` is intentionally **not** a field on `CommandDefinition` (the core type). It's only on `ZodCommandDefinition` (the server-side type). This keeps the core package lightweight and avoids forcing every consumer to handle command skill docs.

### Relationship to Claude Code Skills

The AFD repository uses Claude Code's skill system (`.claude/skills/`) for IDE-time developer guidance. These are **distinct from command skills**:

| | Claude Code Skills (`.claude/skills/`) | Command Skills (`.skill.md`) |
|---|---|---|
| **Audience** | Claude Code — the IDE assistant helping *developers* | MCP agents — runtime callers of your *server* |
| **Lifecycle** | Read during development, in the IDE context | Loaded at server startup, served over MCP |
| **Location** | `.claude/skills/` at the repository root | Co-located with command source files in `src/` |
| **Purpose** | "How do I work with this codebase?" | "When should I call this command?" |
| **Served how** | Claude Code reads from disk | Returned via `skill-docs` bootstrap command |
| **Format** | SKILL.md with YAML frontmatter | .skill.md with YAML frontmatter (same format) |

The file format is intentionally compatible. The YAML frontmatter fields (`name`, `description`, `version`, `category`, `triggers`) are the same. This means tooling that parses one format can parse the other. However, the two systems serve different audiences and should not be mixed — command skills belong next to commands, not in `.claude/skills/`.

### Relationship to botcore skills

The botcore ecosystem has a mature skill system with three-tier ownership (`source: botcore | plugin | local`), seed/adopt workflows, and skill indexing. This spec intentionally **does not** replicate that complexity:

- No ownership tiers — skills are co-located with their commands
- No seed/adopt workflow — skills are authored directly
- No plugin discovery — skills are found by convention, not entry points

If a project later needs botcore-level skill management, the `CommandSkill` type is compatible — botcore can extend it with additional frontmatter fields.

---

## Out of Scope

- **Three-tier ownership model** (botcore/plugin/local) — deferred as noted in the proposal
- **Skill generation from schemas** — auto-generating skill docs from Zod schemas is a future enhancement
- **Runtime skill routing** — this spec covers static skill docs; dynamic routing (which skill to show based on agent context) is a separate concern
- **Skill versioning and migration** — semver in frontmatter is supported but version comparison logic is not implemented
- **MCP resource exposure** — exposing skills as MCP Resources (rather than via a tool) is a possible future optimization. Resources would avoid tool-call overhead for read-only content, but tools provide better discoverability since agents already introspect the tool list.
- **Embedding/vector search** — semantic search over skill content is out of scope; the `skill-docs` command uses exact matching

---

## Success Criteria

- [ ] `CommandSkill` type exported from `@lushly-dev/afd-server`
- [ ] `defineCommand()` accepts an optional `skill` field (string or `CommandSkill`)
- [ ] `loadCommandSkill()` and `discoverCommandSkills()` exported from `@lushly-dev/afd-server`
- [ ] `skill-docs` bootstrap command returns command skill content to agents
- [ ] `validateCommandSkills()` exported from `@lushly-dev/afd-testing` with all 8 rules implemented
- [ ] `afd validate --skills` CLI flag works end-to-end
- [ ] Existing servers without skills continue to work with zero changes
- [ ] At least one example in `packages/examples/` demonstrates command skill documents
- [ ] Tests cover: skill loading, frontmatter parsing, validation rules, bootstrap command queries
