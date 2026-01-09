# 05 - Validation & Sync

> **Goal**: Ensure design and code remain aligned through continuous validation, preventing drift between schemas, designs, and implementations.

## The Drift Problem

Without active validation, systems drift:

```
Day 1:   Schema ──────── Design ──────── Code     ✓ Aligned
Day 30:  Schema ──┐      Design ──┐      Code     ✗ Drifted
                  │               │
                  └── Different ──┘
```

**Common drift scenarios:**
- Developer adds field to schema, designer doesn't know
- Designer removes element, code still expects it
- Schema changes type, generated code uses old type
- Figma component renamed, binding breaks

## Validation Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        VALIDATION PIPELINE                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  SOURCES                    VALIDATORS                    OUTPUTS       │
│                                                                         │
│  ┌──────────┐              ┌──────────────┐              ┌──────────┐  │
│  │  Schema  │─────────────►│ Schema       │─────────────►│ Errors   │  │
│  │  (Zod)   │              │ Validator    │              │ Warnings │  │
│  └──────────┘              └──────────────┘              └──────────┘  │
│       │                           │                                     │
│       │                           ▼                                     │
│       │                    ┌──────────────┐                            │
│       └───────────────────►│ Binding      │                            │
│                            │ Validator    │                            │
│       ┌───────────────────►│              │                            │
│       │                    └──────────────┘                            │
│       │                           │                                     │
│  ┌──────────┐                     ▼                                     │
│  │  Figma   │              ┌──────────────┐              ┌──────────┐  │
│  │ Bindings │─────────────►│ Coverage     │─────────────►│ Report   │  │
│  └──────────┘              │ Analyzer     │              │ Actions  │  │
│       │                    └──────────────┘              └──────────┘  │
│       │                           │                                     │
│       │                           ▼                                     │
│       │                    ┌──────────────┐                            │
│       └───────────────────►│ Code         │                            │
│                            │ Validator    │                            │
│       ┌───────────────────►│              │                            │
│       │                    └──────────────┘                            │
│  ┌──────────┐                                                          │
│  │Generated │                                                          │
│  │  Code    │                                                          │
│  └──────────┘                                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Validation Types

### 1. Schema Validation

Ensure command schemas are valid and consistent:

```typescript
// validators/schema-validator.ts

interface SchemaValidationResult {
  valid: boolean;
  errors: SchemaError[];
  warnings: SchemaWarning[];
}

interface SchemaError {
  command: string;
  type: 'invalid-schema' | 'missing-required' | 'type-error' | 'circular-ref';
  message: string;
  path?: string;
}

interface SchemaWarning {
  command: string;
  type: 'missing-description' | 'missing-example' | 'deprecated-type';
  message: string;
  suggestion: string;
}

export async function validateSchemas(registry: CommandRegistry): Promise<SchemaValidationResult> {
  const errors: SchemaError[] = [];
  const warnings: SchemaWarning[] = [];
  
  for (const command of registry.list()) {
    // Check schema parses
    try {
      zodToJsonSchema(command.inputSchema);
    } catch (e) {
      errors.push({
        command: command.name,
        type: 'invalid-schema',
        message: `Input schema is invalid: ${e.message}`,
      });
    }
    
    // Check has description
    if (!command.description) {
      warnings.push({
        command: command.name,
        type: 'missing-description',
        message: 'Command has no description',
        suggestion: 'Add a description to improve documentation',
      });
    }
    
    // Check has examples
    if (!command.examples || command.examples.length === 0) {
      warnings.push({
        command: command.name,
        type: 'missing-example',
        message: 'Command has no examples',
        suggestion: 'Add examples to improve usability',
      });
    }
    
    // Validate UX fields are declared
    if (command.uxFields) {
      const validUxFields = ['confidence', 'reasoning', 'sources', 'warnings', 'alternatives', 'plan'];
      for (const field of command.uxFields) {
        if (!validUxFields.includes(field)) {
          errors.push({
            command: command.name,
            type: 'type-error',
            message: `Unknown UX field: ${field}`,
            path: 'uxFields',
          });
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
```

### 2. Binding Validation

Ensure Figma bindings match schemas:

```typescript
// validators/binding-validator.ts

interface BindingValidationResult {
  valid: boolean;
  errors: BindingError[];
  warnings: BindingWarning[];
  coverage: BindingCoverage;
}

interface BindingError {
  component: string;
  command: string;
  type: 'command-not-found' | 'field-not-found' | 'type-mismatch' | 'missing-required';
  message: string;
  field?: string;
}

interface BindingWarning {
  component: string;
  type: 'missing-error-state' | 'missing-loading-state' | 'missing-ux-field' | 'unbound-layer';
  message: string;
  suggestion: string;
}

interface BindingCoverage {
  commandsCovered: number;
  commandsTotal: number;
  fieldsCovered: number;
  fieldsTotal: number;
  uxFieldsCovered: number;
  uxFieldsTotal: number;
}

export async function validateBindings(
  bindings: ComponentBinding[],
  registry: CommandRegistry
): Promise<BindingValidationResult> {
  const errors: BindingError[] = [];
  const warnings: BindingWarning[] = [];
  
  const commandsCovered = new Set<string>();
  let fieldsCovered = 0;
  let fieldsTotal = 0;
  let uxFieldsCovered = 0;
  let uxFieldsTotal = 0;
  
  for (const binding of bindings) {
    // Check command exists
    const command = registry.get(binding.commandName);
    if (!command) {
      errors.push({
        component: binding.componentName,
        command: binding.commandName,
        type: 'command-not-found',
        message: `Command '${binding.commandName}' does not exist`,
      });
      continue;
    }
    
    commandsCovered.add(binding.commandName);
    
    // Check all required fields are bound
    const schema = zodToJsonSchema(command.inputSchema) as any;
    const requiredFields = schema.required || [];
    
    for (const field of requiredFields) {
      fieldsTotal++;
      const mapping = binding.inputMappings.find(m => m.schemaField === field);
      
      if (!mapping || mapping.status === 'missing') {
        errors.push({
          component: binding.componentName,
          command: binding.commandName,
          type: 'missing-required',
          message: `Required field '${field}' has no UI binding`,
          field,
        });
      } else {
        fieldsCovered++;
      }
    }
    
    // Check bound fields exist in schema
    for (const mapping of binding.inputMappings) {
      if (mapping.schemaField && !schema.properties[mapping.schemaField]) {
        errors.push({
          component: binding.componentName,
          command: binding.commandName,
          type: 'field-not-found',
          message: `Bound field '${mapping.schemaField}' does not exist in schema`,
          field: mapping.schemaField,
        });
      }
    }
    
    // Check UX field coverage
    const uxFields = command.uxFields || [];
    uxFieldsTotal += uxFields.length;
    
    for (const uxField of uxFields) {
      const hasMapping = binding.outputMappings.some(m => m.uxField === uxField);
      if (hasMapping) {
        uxFieldsCovered++;
      } else {
        warnings.push({
          component: binding.componentName,
          type: 'missing-ux-field',
          message: `No UI element for '${uxField}' feedback`,
          suggestion: `Add a layer to display ${uxField} from command result`,
        });
      }
    }
    
    // Check for error/loading states
    if (!hasErrorState(binding)) {
      warnings.push({
        component: binding.componentName,
        type: 'missing-error-state',
        message: 'No error state UI found',
        suggestion: 'Add an error variant or error banner layer',
      });
    }
    
    if (!hasLoadingState(binding)) {
      warnings.push({
        component: binding.componentName,
        type: 'missing-loading-state',
        message: 'No loading state UI found',
        suggestion: 'Add a loading variant or spinner layer',
      });
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    coverage: {
      commandsCovered: commandsCovered.size,
      commandsTotal: registry.list().length,
      fieldsCovered,
      fieldsTotal,
      uxFieldsCovered,
      uxFieldsTotal,
    },
  };
}
```

### 3. Code Validation

Ensure generated code matches schemas:

```typescript
// validators/code-validator.ts

interface CodeValidationResult {
  valid: boolean;
  errors: CodeError[];
  warnings: CodeWarning[];
}

interface CodeError {
  file: string;
  command: string;
  type: 'type-mismatch' | 'missing-handler' | 'outdated-schema';
  message: string;
  line?: number;
}

export async function validateGeneratedCode(
  codeDir: string,
  registry: CommandRegistry
): Promise<CodeValidationResult> {
  const errors: CodeError[] = [];
  const warnings: CodeWarning[] = [];
  
  // Find all generated component files
  const files = await glob(`${codeDir}/**/*.tsx`);
  
  for (const file of files) {
    const content = await fs.readFile(file, 'utf-8');
    
    // Extract AFD command calls
    const commandCalls = extractCommandCalls(content);
    
    for (const call of commandCalls) {
      const command = registry.get(call.commandName);
      
      if (!command) {
        errors.push({
          file,
          command: call.commandName,
          type: 'missing-handler',
          message: `Code calls unknown command '${call.commandName}'`,
          line: call.line,
        });
        continue;
      }
      
      // Validate input types match schema
      const schemaFields = Object.keys(zodToJsonSchema(command.inputSchema).properties || {});
      const codeFields = call.inputFields;
      
      for (const field of codeFields) {
        if (!schemaFields.includes(field)) {
          errors.push({
            file,
            command: call.commandName,
            type: 'type-mismatch',
            message: `Code passes unknown field '${field}' to command`,
            line: call.line,
          });
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function extractCommandCalls(content: string): CommandCall[] {
  const calls: CommandCall[] = [];
  const regex = /afd\.call\(['"]([^'"]+)['"],\s*(\{[^}]+\})/g;
  
  let match;
  while ((match = regex.exec(content)) !== null) {
    const line = content.slice(0, match.index).split('\n').length;
    const inputFields = extractObjectKeys(match[2]);
    
    calls.push({
      commandName: match[1],
      inputFields,
      line,
    });
  }
  
  return calls;
}
```

### 4. Cross-System Sync Validation

Ensure all systems are aligned:

```typescript
// validators/sync-validator.ts

interface SyncValidationResult {
  inSync: boolean;
  schemaVersion: string;
  figmaVersion: string;
  codeVersion: string;
  drift: DriftReport[];
}

interface DriftReport {
  system: 'schema' | 'figma' | 'code';
  entity: string;
  issue: string;
  lastUpdated: string;
  suggestedAction: string;
}

export async function validateSync(
  registry: CommandRegistry,
  figmaBindings: ComponentBinding[],
  codeDir: string
): Promise<SyncValidationResult> {
  const drift: DriftReport[] = [];
  
  // Check each command has corresponding Figma and code
  for (const command of registry.list()) {
    const hasBinding = figmaBindings.some(b => b.commandName === command.name);
    const hasCode = await codeExistsForCommand(codeDir, command.name);
    
    if (!hasBinding) {
      drift.push({
        system: 'figma',
        entity: command.name,
        issue: 'Command has no Figma component binding',
        lastUpdated: command.updatedAt,
        suggestedAction: 'Create Figma component and bind to command',
      });
    }
    
    if (!hasCode) {
      drift.push({
        system: 'code',
        entity: command.name,
        issue: 'Command has no generated code',
        lastUpdated: command.updatedAt,
        suggestedAction: 'Run afd docs generate to create code',
      });
    }
  }
  
  // Check Figma bindings reference valid commands
  for (const binding of figmaBindings) {
    if (!registry.get(binding.commandName)) {
      drift.push({
        system: 'figma',
        entity: binding.componentName,
        issue: `References non-existent command: ${binding.commandName}`,
        lastUpdated: binding.boundAt,
        suggestedAction: 'Update binding to valid command or remove',
      });
    }
  }
  
  // Check schema hashes match
  const schemaHash = await computeSchemaHash(registry);
  const figmaSchemaHash = await getFigmaSchemaHash(figmaBindings);
  const codeSchemaHash = await getCodeSchemaHash(codeDir);
  
  if (schemaHash !== figmaSchemaHash) {
    drift.push({
      system: 'figma',
      entity: 'schema-cache',
      issue: 'Figma schema cache is outdated',
      lastUpdated: figmaBindings[0]?.boundAt || 'unknown',
      suggestedAction: 'Re-sync Figma plugin with latest schemas',
    });
  }
  
  if (schemaHash !== codeSchemaHash) {
    drift.push({
      system: 'code',
      entity: 'generated-types',
      issue: 'Generated types are outdated',
      lastUpdated: 'unknown',
      suggestedAction: 'Run afd docs generate --only types',
    });
  }
  
  return {
    inSync: drift.length === 0,
    schemaVersion: schemaHash,
    figmaVersion: figmaSchemaHash,
    codeVersion: codeSchemaHash,
    drift,
  };
}
```

## CLI Commands

### `afd validate`

Run all validations:

```bash
afd validate

# Output:
# 
# Schema Validation
# ─────────────────
# ✓ 12 commands validated
# ⚠ 2 warnings (missing examples)
# 
# Binding Validation  
# ──────────────────
# ✓ 8 components validated
# ✓ 24/24 required fields bound
# ⚠ 3 warnings (missing UX fields)
# 
# Code Validation
# ───────────────
# ✓ 8 generated files validated
# ✓ All command calls match schemas
# 
# Sync Status
# ───────────
# ✓ Schema → Figma: In sync
# ✓ Schema → Code: In sync
# 
# Overall: PASS (5 warnings)
```

### `afd validate --strict`

Fail on warnings:

```bash
afd validate --strict

# Exits with code 1 if any warnings
```

### `afd validate --fix`

Auto-fix where possible:

```bash
afd validate --fix

# Attempting auto-fixes...
# ✓ Regenerated outdated types
# ✓ Updated 2 Figma schema caches
# ⚠ Cannot auto-fix: missing Figma bindings (manual action required)
```

## Sync Mechanisms

### 1. Schema Version Tracking

Every schema gets a version hash:

```typescript
interface SchemaVersion {
  hash: string;
  timestamp: string;
  commands: {
    [name: string]: {
      hash: string;
      version: string;
    };
  };
}

// Stored in: .afd/schema-version.json
```

### 2. Figma Webhook Integration

Receive notifications when designs change:

```typescript
// webhook/figma-webhook.ts

app.post('/webhooks/figma', async (req, res) => {
  const { event, file_key, timestamp } = req.body;
  
  if (event === 'FILE_UPDATE') {
    // Fetch updated bindings
    const bindings = await fetchFigmaBindings(file_key);
    
    // Run binding validation
    const result = await validateBindings(bindings, registry);
    
    if (!result.valid) {
      // Notify team of drift
      await notifySlack({
        channel: '#design-dev',
        message: `⚠️ Figma update caused ${result.errors.length} binding errors`,
        details: result.errors,
      });
    }
    
    // Store updated bindings
    await saveBindings(bindings);
  }
  
  res.sendStatus(200);
});
```

### 3. Git Hooks

Validate before commit:

```bash
# .husky/pre-commit

#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Validate schemas
pnpm afd validate --only schema
if [ $? -ne 0 ]; then
  echo "Schema validation failed. Fix errors before committing."
  exit 1
fi

# Check for drift
pnpm afd validate --only sync
if [ $? -ne 0 ]; then
  echo "Documentation drift detected. Run 'afd docs generate' and commit changes."
  exit 1
fi
```

### 4. CI Pipeline

Full validation in CI:

```yaml
# .github/workflows/validate.yml

name: Validation

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup
        uses: actions/setup-node@v4
        
      - run: pnpm install
      
      - name: Validate schemas
        run: pnpm afd validate --only schema --strict
        
      - name: Fetch Figma bindings
        run: pnpm afd docs sync --figma ${{ secrets.FIGMA_FILE_URL }}
        env:
          FIGMA_TOKEN: ${{ secrets.FIGMA_TOKEN }}
          
      - name: Validate bindings
        run: pnpm afd validate --only bindings
        
      - name: Validate generated code
        run: pnpm afd validate --only code
        
      - name: Check sync status
        run: pnpm afd validate --only sync --strict
        
      - name: Upload validation report
        uses: actions/upload-artifact@v4
        with:
          name: validation-report
          path: .afd/validation-report.json
```

## Validation Report

JSON report for dashboards/automation:

```json
{
  "timestamp": "2025-12-31T10:00:00Z",
  "overall": {
    "status": "pass",
    "errors": 0,
    "warnings": 5
  },
  "schema": {
    "status": "pass",
    "commandsValidated": 12,
    "errors": [],
    "warnings": [
      { "command": "todo.stats", "type": "missing-example", "message": "..." }
    ]
  },
  "bindings": {
    "status": "pass",
    "componentsValidated": 8,
    "coverage": {
      "commands": "8/12",
      "fields": "24/24",
      "uxFields": "15/18"
    },
    "errors": [],
    "warnings": []
  },
  "code": {
    "status": "pass",
    "filesValidated": 8,
    "errors": [],
    "warnings": []
  },
  "sync": {
    "status": "pass",
    "schemaVersion": "abc123",
    "figmaVersion": "abc123",
    "codeVersion": "abc123",
    "drift": []
  }
}
```

## Success Criteria

- [ ] Schema validation catches invalid Zod schemas
- [ ] Binding validation catches missing required fields
- [ ] Code validation catches schema mismatches
- [ ] Sync validation detects version drift
- [ ] CLI provides clear, actionable output
- [ ] CI integration blocks on validation failures
- [ ] Auto-fix resolves simple drift issues
- [ ] Reports are JSON-exportable for dashboards

---

**Next**: [06-implementation-roadmap.md](./06-implementation-roadmap.md) — Phased implementation plan
