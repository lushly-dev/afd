# Phase 4: Multi-App Support

> **Goal**: Extend JTBD testing framework to support Noisett and future AFD projects via an extensible adapter system.

---

## Overview

Phase 4 makes the framework reusable across different AFD applications:

- App adapter system for different CLIs and fixture formats
- Shared scenario patterns
- Cross-app test orchestration
- App-agnostic coverage metrics

**Success Criteria**: Can run scenarios for Violet and Noisett from one unified framework, with clear extensibility for future apps.

---

## App Adapter System

Each AFD application has different:

- CLI command syntax
- Fixture data structures
- Error codes
- Job definitions

The adapter pattern abstracts these differences.

### Adapter Interface

```typescript
// src/adapters/types.ts

export interface AppAdapter {
  /** Unique app identifier */
  name: string;

  /** App version */
  version: string;

  /** CLI command configuration */
  cli: CliConfig;

  /** Fixture configuration */
  fixture: FixtureConfig;

  /** Commands configuration */
  commands: CommandsConfig;

  /** Error codes configuration */
  errors: ErrorsConfig;

  /** Jobs configuration */
  jobs: JobsConfig;
}

interface CliConfig {
  /** CLI executable */
  command: string;

  /** Default args */
  defaultArgs?: string[];

  /** How to pass JSON input */
  inputFormat: "json-arg" | "json-stdin" | "flags";

  /** Output format */
  outputFormat: "json" | "text";
}

interface FixtureConfig {
  /** JSON Schema for fixture validation */
  schema: object;

  /** How to apply fixture */
  applicator: (fixture: unknown, cli: string) => Promise<void>;

  /** How to reset state */
  reset: (cli: string) => Promise<void>;
}

interface CommandsConfig {
  /** List of available commands */
  list: () => Promise<string[]>;

  /** Get command schema */
  getSchema: (command: string) => Promise<object>;
}

interface ErrorsConfig {
  /** List of error codes */
  list: () => Promise<string[]>;

  /** Get error description */
  getDescription: (code: string) => string;
}

interface JobsConfig {
  /** List of defined jobs */
  list: () => Promise<string[]>;

  /** Get job description */
  getDescription: (job: string) => string;
}
```

---

## Violet Adapter

```typescript
// src/adapters/violet.ts

import { AppAdapter } from "./types";

export const violetAdapter: AppAdapter = {
  name: "violet",
  version: "1.0.0",

  cli: {
    command: "violet",
    defaultArgs: ["--memory"],
    inputFormat: "flags",
    outputFormat: "json",
  },

  fixture: {
    schema: VioletFixtureSchema,

    async applicator(fixture: VioletFixture, cli: string) {
      // Create nodes
      for (const node of fixture.nodes) {
        await runCommand(
          `${cli} node create --name ${node.name} --type ${node.type} ${
            node.parentId ? `--parent ${node.parentId}` : ""
          }`
        );
      }

      // Apply operations
      for (const op of fixture.operations ?? []) {
        switch (op.type) {
          case "add":
            await runCommand(
              `${cli} token add --node ${op.nodeId} --token ${op.token} --value "${op.value}"`
            );
            break;
          case "override":
            await runCommand(
              `${cli} token override --node ${op.nodeId} --token ${op.token} --value "${op.value}"`
            );
            break;
          // ... other operations
        }
      }

      // Apply constraints
      for (const constraint of fixture.constraints ?? []) {
        await runCommand(
          `${cli} constraints set ${constraint.nodeId} --constraint ${
            constraint.id
          } --type ${constraint.type} --tokens "${constraint.tokens.join(",")}"`
        );
      }
    },

    async reset(cli: string) {
      // Violet with --memory flag auto-resets, but for persistent:
      await runCommand(`${cli} node delete-all --confirm`);
    },
  },

  commands: {
    async list() {
      return [
        "node.create",
        "node.get",
        "node.list",
        "node.update",
        "node.delete",
        "token.add",
        "token.override",
        "token.subtract",
        "token.reset",
        "token.copy",
        "token.lineage",
        "tokens.resolve",
        "export",
        "import.json",
        "import.validate",
        "constraints.set",
        "constraints.list",
        "constraints.validate",
        "analyze.deviations",
        "analyze.compliance",
        "compare.nodes",
        "cicd.setup",
        "cicd.validate",
        "cicd.export",
        "cicd.diff",
        "webhooks.register",
        "webhooks.list",
        "webhooks.get",
        "webhooks.update",
        "webhooks.delete",
        "webhooks.test",
        "webhooks.logs",
        "doctor",
        "validate",
        "docs.generate",
      ];
    },

    async getSchema(command: string) {
      // Load from Violet's command registry
      const result = await runCommand(`violet call ${command} --schema`);
      return JSON.parse(result.stdout);
    },
  },

  errors: {
    async list() {
      return [
        "NODE_NOT_FOUND",
        "NODE_ALREADY_EXISTS",
        "NODE_HAS_CHILDREN",
        "INVALID_PARENT",
        "CIRCULAR_REFERENCE",
        "TOKEN_NOT_FOUND",
        "TOKEN_ALREADY_EXISTS",
        "VALIDATION_ERROR",
        "CONSTRAINT_NOT_FOUND",
        "DUPLICATE_CONSTRAINT_ID",
        "INVALID_CONSTRAINT_TYPE",
      ];
    },

    getDescription(code: string) {
      const descriptions: Record<string, string> = {
        NODE_NOT_FOUND: "Node does not exist",
        NODE_ALREADY_EXISTS: "Duplicate node ID",
        // ...
      };
      return descriptions[code] ?? "Unknown error";
    },
  },

  jobs: {
    async list() {
      return [
        "onboard-product-line",
        "platform-theming",
        "token-management",
        "constraint-compliance",
        "export-tokens",
        "import-tokens",
        "webhook-integration",
      ];
    },

    getDescription(job: string) {
      const descriptions: Record<string, string> = {
        "onboard-product-line": "Add a new product line to the token hierarchy",
        "platform-theming": "Configure tokens for a specific platform",
        // ...
      };
      return descriptions[job] ?? "Unknown job";
    },
  },
};
```

---

## Noisett Adapter

```typescript
// src/adapters/noisett.ts

import { AppAdapter } from "./types";

export const noisettAdapter: AppAdapter = {
  name: "noisett",
  version: "1.0.0",

  cli: {
    command: "noisett",
    inputFormat: "json-arg",
    outputFormat: "json",
  },

  fixture: {
    schema: NoisettFixtureSchema,

    async applicator(fixture: NoisettFixture, cli: string) {
      // Create LoRAs
      for (const lora of fixture.loras ?? []) {
        await runCommand(`${cli} lora.create '${JSON.stringify(lora)}'`);
      }

      // Set up mock jobs
      for (const job of fixture.mockJobs ?? []) {
        await runCommand(`${cli} job.mock '${JSON.stringify(job)}'`);
      }
    },

    async reset(cli: string) {
      await runCommand(`${cli} test.reset '{}'`);
    },
  },

  commands: {
    async list() {
      return [
        "asset.generate",
        "asset.types",
        "job.status",
        "job.cancel",
        "job.list",
        "model.list",
        "model.info",
        "lora.create",
        "lora.upload-images",
        "lora.train",
        "lora.status",
        "lora.list",
        "lora.activate",
        "lora.delete",
        "quality.presets",
        "refine",
        "upscale",
        "variations",
        "post-process",
        "history.list",
        "history.get",
        "history.delete",
        "favorites.add",
        "favorites.list",
        "favorites.remove",
      ];
    },

    async getSchema(command: string) {
      const result = await runCommand(`noisett --schema ${command}`);
      return JSON.parse(result.stdout);
    },
  },

  errors: {
    async list() {
      return [
        "JOB_NOT_FOUND",
        "JOB_ALREADY_COMPLETE",
        "MODEL_NOT_FOUND",
        "MODEL_UNAVAILABLE",
        "LORA_NOT_FOUND",
        "LORA_TRAINING_IN_PROGRESS",
        "INVALID_PROMPT",
        "RATE_LIMITED",
      ];
    },

    getDescription(code: string) {
      const descriptions: Record<string, string> = {
        JOB_NOT_FOUND: "Generation job does not exist",
        // ...
      };
      return descriptions[code] ?? "Unknown error";
    },
  },

  jobs: {
    async list() {
      return [
        "generate-brand-asset",
        "train-lora-model",
        "upscale-image",
        "manage-history",
      ];
    },

    getDescription(job: string) {
      const descriptions: Record<string, string> = {
        "generate-brand-asset": "Generate on-brand images from prompts",
        // ...
      };
      return descriptions[job] ?? "Unknown job";
    },
  },
};
```

---

## Adapter Registry

```typescript
// src/adapters/registry.ts

import { AppAdapter } from "./types";
import { violetAdapter } from "./violet";
import { noisettAdapter } from "./noisett";

class AdapterRegistry {
  private adapters = new Map<string, AppAdapter>();

  constructor() {
    // Register built-in adapters
    this.register(violetAdapter);
    this.register(noisettAdapter);
    // Future adapters registered here or via adapter.register command
  }

  register(adapter: AppAdapter) {
    this.adapters.set(adapter.name, adapter);
  }

  get(name: string): AppAdapter | undefined {
    return this.adapters.get(name);
  }

  list(): AppAdapter[] {
    return Array.from(this.adapters.values());
  }

  detect(cwd: string): AppAdapter | undefined {
    // Auto-detect based on package.json, pyproject.toml, etc.
    // ...
  }
}

export const adapterRegistry = new AdapterRegistry();
```

---

## Cross-App Scenarios

Some scenarios might span multiple apps:

```yaml
# scenarios/cross-app/design-to-deploy.scenario.yaml
name: Design Token to Brand Asset
description: Create design tokens, then generate brand assets using them
version: "1.0"
job: cross-app-workflow
tags: [cross-app, integration]

apps:
  - violet
  - noisett

# Failure handling for cross-app workflows
on_failure: stop  # stop | continue | rollback (default: stop)

fixture:
  violet:
    file: fixtures/brand-tokens.yaml
  noisett:
    file: fixtures/mock-generation.yaml

steps:
  # Step 1: Create token in Violet
  - app: violet
    command: token add --node brand --token color.primary --value "#0078D4"
    expect:
      success: true

  # Step 2: Export tokens
  - app: violet
    command: export json brand --output /tmp/tokens.json
    expect:
      success: true

  # Step 3: Generate brand asset with Noisett using color
  - app: noisett
    command: asset.generate '{"prompt": "abstract logo, primary color #0078D4", "asset_type": "logo"}'
    expect:
      success: true
      data:
        job_id: exists

verify:
  assertions:
    - "Violet exported tokens containing primary color"
    - "Noisett generated logo with specified color"
```

### on_failure Configuration

| Value | Behavior | Use Case |
|-------|----------|----------|
| `stop` | Stop immediately, leave state as-is | Debugging (default) |
| `continue` | Continue remaining steps, report partial results | CI with independent steps |
| `rollback` | Attempt to reset all apps to pre-scenario state | Clean state after failure |

**Rollback behavior:**
- Calls `adapter.fixture.reset()` for each app in reverse order
- Logs any rollback failures but continues
- Final status is still "failed"

### Cross-App Executor

```typescript
// src/runner/cross-app-executor.ts

export async function executeCrossAppScenario(
  scenario: CrossAppScenario,
  options: ExecutorOptions
): Promise<ScenarioResult> {
  const startTime = Date.now();
  const stepResults: StepResult[] = [];
  const onFailure = scenario.onFailure ?? 'stop';

  // Initialize all required apps
  const adapters = new Map<string, AppAdapter>();
  for (const appName of scenario.apps) {
    const adapter = adapterRegistry.get(appName);
    if (!adapter) {
      throw new Error(`Unknown app: ${appName}`);
    }
    adapters.set(appName, adapter);
  }

  // Apply fixtures per app
  for (const [appName, fixtureConfig] of Object.entries(scenario.fixture)) {
    const adapter = adapters.get(appName)!;
    const fixture = await loadFixture(fixtureConfig.file);
    await adapter.fixture.applicator(fixture, buildCli(adapter));
  }

  // Execute steps with on_failure handling
  let failed = false;
  let failedAtStep: number | undefined;

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const adapter = adapters.get(step.app)!;
    const cli = buildCli(adapter);

    // Skip if failed and on_failure is 'stop'
    if (failed && onFailure === 'stop') {
      stepResults.push({
        index: i,
        command: `[${step.app}] ${step.command}`,
        status: 'skipped',
        duration: 0,
      });
      continue;
    }

    const result = await runCommand(step.command, { cli });
    const evaluation = evaluateStep(step, result);

    stepResults.push({
      index: i,
      command: `[${step.app}] ${step.command}`,
      status: evaluation.passed ? 'passed' : 'failed',
      duration: result.duration,
      actual: result.output,
      expected: step.expect,
      confidence: (result.output as any)?.confidence,
      reasoning: (result.output as any)?.reasoning,
    });

    if (!evaluation.passed && !failed) {
      failed = true;
      failedAtStep = i;
    }
  }

  // Handle rollback if configured and failed
  if (failed && onFailure === 'rollback') {
    console.log('  Rolling back all apps...');
    // Rollback in reverse order
    const appList = Array.from(adapters.values()).reverse();
    for (const adapter of appList) {
      try {
        await adapter.fixture.reset(buildCli(adapter));
        console.log(`    ✓ Reset ${adapter.name}`);
      } catch (e) {
        console.log(`    ✗ Failed to reset ${adapter.name}: ${e}`);
      }
    }
  }

  // Always reset on success
  if (!failed) {
    for (const adapter of adapters.values()) {
      await adapter.fixture.reset(buildCli(adapter));
    }
  }

  return {
    scenario: scenario.name,
    status: failed ? 'failed' : 'passed',
    duration: Date.now() - startTime,
    steps: stepResults,
    error: failed ? { step: failedAtStep!, /* ... */ } : undefined,
  };
}
```

---

## Unified Coverage

Cross-app coverage aggregation:

```typescript
// src/analyzers/unified-coverage.ts

interface UnifiedCoverageReport {
  /** Per-app coverage */
  apps: Record<string, AppCoverage>;

  /** Cross-app scenario coverage */
  crossApp: CrossAppCoverage;

  /** Overall metrics */
  overall: {
    commands: number;
    errors: number;
    jobs: number;
  };
}

async function calculateUnifiedCoverage(): Promise<UnifiedCoverageReport> {
  const apps: Record<string, AppCoverage> = {};

  for (const adapter of adapterRegistry.list()) {
    const scenarios = await loadScenariosForApp(adapter.name);
    apps[adapter.name] = await calculateAppCoverage(adapter, scenarios);
  }

  const crossAppScenarios = await loadCrossAppScenarios();
  const crossApp = calculateCrossAppCoverage(crossAppScenarios);

  // Aggregate
  const allCommands = Object.values(apps).reduce(
    (acc, a) => acc + a.commands.total,
    0
  );
  const coveredCommands = Object.values(apps).reduce(
    (acc, a) => acc + a.commands.covered,
    0
  );

  return {
    apps,
    crossApp,
    overall: {
      commands: (coveredCommands / allCommands) * 100,
      errors: calculateOverallErrorCoverage(apps),
      jobs: calculateOverallJobCoverage(apps),
    },
  };
}
```

---

## CLI Updates

```bash
# Specify app explicitly
afd scenario run --app violet --scenario add-token

# Auto-detect app from cwd
afd scenario run --scenario add-token

# Run cross-app scenario
afd scenario run --scenario design-to-deploy

# Coverage for specific app
afd scenario coverage --app noisett

# Unified coverage across all apps
afd scenario coverage --all-apps

# List adapters
afd adapter list

# Adapter info
afd adapter info violet
```

---

## Test Cases

| Test                         | Description                           |
| ---------------------------- | ------------------------------------- |
| `adapter-registry.test.ts`   | Registration, lookup, detection       |
| `violet-adapter.test.ts`     | Violet-specific fixture and commands  |
| `noisett-adapter.test.ts`    | Noisett-specific fixture and commands |
| `cross-app-executor.test.ts` | Multi-app scenario execution          |
| `unified-coverage.test.ts`   | Cross-app coverage calculation        |

---

## Files to Create/Update

```
packages/testing/src/
├── adapters/
│   ├── types.ts           # NEW
│   ├── registry.ts        # NEW
│   ├── violet.ts          # NEW
│   ├── noisett.ts         # NEW
│   └── index.ts           # NEW
├── runner/
│   └── cross-app-executor.ts  # NEW
├── analyzers/
│   └── unified-coverage.ts    # NEW
└── commands/
    ├── adapter-list.ts    # NEW
    └── adapter-info.ts    # NEW
```

---

## Dependencies

**Blocks**: Nothing (final phase)

**Blocked by**: Phase 3 (Agent Integration)

**No new dependencies** - uses existing infrastructure

---

## Estimated Effort

| Task                | Estimate      |
| ------------------- | ------------- |
| Adapter interface   | 2 hours       |
| Violet adapter      | 3 hours       |
| Noisett adapter     | 3 hours       |
| Adapter registry    | 2 hours       |
| Cross-app executor  | 4 hours       |
| on_failure handling | 2 hours       |
| Unified coverage    | 3 hours       |
| CLI updates         | 2 hours       |
| Tests               | 4 hours       |
| **Total**           | **~25 hours** |

---

## Future Considerations

### Custom Adapter Registration

```bash
# Register adapter from JSON config
afd adapter register --config my-app-adapter.json

# Register adapter from npm package
afd adapter register --package @my-org/my-app-testing
```

### Adapter Validation

```bash
# Validate adapter is correctly configured
afd adapter validate violet

# Expected output:
# ✓ CLI command works
# ✓ Fixture applicator runs
# ✓ Commands list returns 35 items
# ✓ Error codes defined
# ✓ Jobs defined
```

### Adapter Generator

```bash
# Generate adapter skeleton for new app
afd adapter generate --name my-app --cli my-app

# Creates:
# - src/adapters/my-app.ts
# - fixtures/my-app/empty.yaml
# - scenarios/my-app/.gitkeep
```

### Future App Adapters

When ready, adapters can be added for:

| App | When to Add | Notes |
|-----|-------------|-------|
| **Violas** | When command layer is stable | Writing/skill management workflows |
| **Other AFD projects** | As they adopt AFD patterns | Use `adapter.generate` scaffold |

Adding a new adapter requires:
1. Implement `AppAdapter` interface
2. Define fixture schema
3. Map commands/errors/jobs
4. Add to registry

### scenario.debug Command (Future)

Interactive step-through for failed scenarios:

```bash
afd scenario debug --scenario failed-scenario

# Interactive mode:
# > Step 1: node create --name xbox (PASSED)
# > Step 2: token add --node xbox (FAILED)
#   
#   Expected: success=true
#   Actual:   success=false, error=TOKEN_NOT_FOUND
#   
#   Commands: [r]etry, [s]kip, [i]nspect, [q]uit
```

---

## Summary

Phase 4 completes the JTBD testing framework by making it truly reusable:

1. **App Adapter System** - Clean abstraction for different CLI tools
2. **Built-in Adapters** - Ready for Violet and Noisett
3. **Cross-App Scenarios** - Test workflows spanning multiple apps with configurable failure handling
4. **Unified Coverage** - Single view across all AFD projects
5. **Extensibility** - Easy to add new apps via adapter pattern

This enables the framework to be the standard testing approach for all AFD projects.
