# 02 - Figma Plugin

> **Goal**: Build a Figma plugin that connects to AFD's MCP server, enabling designers to browse commands, bind UI elements, and validate designs against the API contract.

## Plugin Overview

The **AFD Design Bridge** plugin gives designers direct access to the application's capabilities, transforming API schemas from developer documentation into design materials.

### Core Features

1. **Command Browser** — Browse and search available commands
2. **Schema Viewer** — See input/output requirements for each command
3. **Component Binding** — Link Figma components to commands
4. **Validation** — Real-time feedback on design-API alignment
5. **Scaffolding** — Generate starter frames from command schemas

## User Interface

### Main Panel Layout

```
┌─────────────────────────────────────────────────────────────┐
│  AFD Design Bridge                              [⚙️] [🔄]   │
├─────────────────────────────────────────────────────────────┤
│  🔍 Search commands...                                      │
├─────────────────────────────────────────────────────────────┤
│  ▼ Connected: localhost:3100                    [Disconnect]│
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📁 todo (4 commands)                                       │
│  ├─ ✨ create       "Creates a new todo item"              │
│  │   └─ [+ Scaffold] [📋 Copy Schema]                      │
│  ├─ 📄 list         "Lists all todos"                      │
│  ├─ 🗑️ delete       "Deletes a todo by ID"                 │
│  └─ ✓ toggle        "Toggles todo completion"              │
│                                                             │
│  📁 user (2 commands)                                       │
│  ├─ 🔐 login        "Authenticates user"                   │
│  └─ 👤 profile      "Gets user profile"                    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  SELECTED COMPONENT                                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ TaskForm (Frame)                                        ││
│  │ Bound to: todo.create ✓                                 ││
│  │                                                         ││
│  │ Input Mappings:                                         ││
│  │   titleInput → title (string) ✓                        ││
│  │   prioritySelect → priority (enum) ✓                   ││
│  │   ⚠️ Missing: submitButton (action)                     ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  [Validate All] [Export Bindings]                           │
└─────────────────────────────────────────────────────────────┘
```

### Command Detail View

```
┌─────────────────────────────────────────────────────────────┐
│  ← Back                                    todo.create      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Creates a new todo item                                    │
│  Tags: mutation, core                                       │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│  INPUTS                                                     │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  title (string) *required                                   │
│  └─ The todo title                                          │
│  └─ Min length: 1                                           │
│                                                             │
│  priority (enum)                                            │
│  └─ Task priority level                                     │
│  └─ Options: high | medium | low                            │
│  └─ Default: medium                                         │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│  OUTPUTS                                                    │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Returns: Todo object                                       │
│  UX Fields: confidence, warnings                            │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│  EXAMPLES                                                   │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Simple todo:                                               │
│  { "title": "Buy groceries" }                               │
│                                                             │
│  High priority:                                             │
│  { "title": "Urgent task", "priority": "high" }             │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  [+ Scaffold Form] [+ Scaffold Card] [Bind to Selection]    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Technical Architecture

### Plugin Structure

```
figma-afd-bridge/
├── manifest.json           # Figma plugin manifest
├── package.json
├── tsconfig.json
├── src/
│   ├── main.ts             # Plugin main thread (Figma API)
│   ├── ui.tsx              # UI thread (React)
│   ├── components/
│   │   ├── App.tsx
│   │   ├── CommandBrowser.tsx
│   │   ├── CommandDetail.tsx
│   │   ├── BindingPanel.tsx
│   │   ├── ValidationResults.tsx
│   │   └── ScaffoldPreview.tsx
│   ├── services/
│   │   ├── mcp-client.ts   # MCP connection
│   │   ├── schema-service.ts
│   │   └── binding-service.ts
│   ├── generators/
│   │   ├── form-generator.ts
│   │   ├── card-generator.ts
│   │   └── scaffold-utils.ts
│   └── types/
│       ├── afd.ts
│       └── bindings.ts
└── ui.html                 # UI entry point
```

### Manifest Configuration

```json
{
  "name": "AFD Design Bridge",
  "id": "afd-design-bridge",
  "api": "1.0.0",
  "main": "dist/main.js",
  "ui": "dist/ui.html",
  "capabilities": [],
  "enableProposedApi": false,
  "editorType": ["figma"],
  "networkAccess": {
    "allowedDomains": ["localhost", "*.afd.dev"],
    "reasoning": "Connect to AFD MCP server for schema discovery"
  },
  "permissions": ["currentuser"]
}
```

## Core Implementation

### MCP Client Service

```typescript
// src/services/mcp-client.ts

import { Client } from "@modelcontextprotocol/sdk/client";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse";

export class AFDClient {
  private client: Client | null = null;
  private serverUrl: string = "";
  
  async connect(url: string): Promise<void> {
    this.serverUrl = url;
    const transport = new SSEClientTransport(new URL(`${url}/sse`));
    
    this.client = new Client({
      name: "figma-afd-bridge",
      version: "1.0.0",
    });
    
    await this.client.connect(transport);
  }
  
  async disconnect(): Promise<void> {
    await this.client?.close();
    this.client = null;
  }
  
  async listCommands(category?: string): Promise<CommandSummary[]> {
    const result = await this.client?.callTool("schema.list", { category });
    if (!result?.success) throw new Error(result?.error?.message);
    return result.data.commands;
  }
  
  async describeCommand(name: string): Promise<CommandSchema> {
    const result = await this.client?.callTool("schema.describe", { name });
    if (!result?.success) throw new Error(result?.error?.message);
    return result.data;
  }
  
  async getUXPatterns(): Promise<UXPatterns> {
    const result = await this.client?.callTool("schema.uxPatterns", {});
    if (!result?.success) throw new Error(result?.error?.message);
    return result.data;
  }
  
  async exportSchemas(format: "figma" | "openapi"): Promise<SchemaExport> {
    const result = await this.client?.callTool("schema.export", { format });
    if (!result?.success) throw new Error(result?.error?.message);
    return result.data;
  }
  
  get isConnected(): boolean {
    return this.client !== null;
  }
}

export const afdClient = new AFDClient();
```

### Binding System

```typescript
// src/services/binding-service.ts

export interface ComponentBinding {
  componentId: string;
  componentName: string;
  commandName: string;
  inputMappings: InputMapping[];
  outputMappings: OutputMapping[];
  validated: boolean;
  errors: BindingError[];
}

export interface InputMapping {
  figmaLayerName: string;
  figmaLayerId: string;
  schemaField: string;
  schemaType: string;
  status: "mapped" | "missing" | "type-mismatch";
}

export interface OutputMapping {
  figmaLayerName: string;
  figmaLayerId: string;
  uxField: string;
  status: "mapped" | "missing";
}

export class BindingService {
  private bindings: Map<string, ComponentBinding> = new Map();
  
  async bindComponent(
    componentId: string,
    commandName: string,
    schema: CommandSchema
  ): Promise<ComponentBinding> {
    const component = figma.getNodeById(componentId);
    if (!component || component.type !== "COMPONENT") {
      throw new Error("Invalid component");
    }
    
    // Auto-detect mappings based on layer names
    const inputMappings = this.detectInputMappings(component, schema.input);
    const outputMappings = this.detectOutputMappings(component, schema.output);
    
    const binding: ComponentBinding = {
      componentId,
      componentName: component.name,
      commandName,
      inputMappings,
      outputMappings,
      validated: false,
      errors: [],
    };
    
    // Validate and store
    binding.errors = this.validateBinding(binding, schema);
    binding.validated = binding.errors.length === 0;
    
    // Store in plugin data
    component.setPluginData("afd-binding", JSON.stringify(binding));
    this.bindings.set(componentId, binding);
    
    return binding;
  }
  
  private detectInputMappings(
    component: ComponentNode,
    inputSchema: SchemaDefinition
  ): InputMapping[] {
    const mappings: InputMapping[] = [];
    const children = this.getAllChildren(component);
    
    for (const [fieldName, fieldDef] of Object.entries(inputSchema.schema.properties)) {
      // Look for matching layer names
      const matchingLayer = children.find(child => 
        this.nameMatches(child.name, fieldName)
      );
      
      if (matchingLayer) {
        mappings.push({
          figmaLayerName: matchingLayer.name,
          figmaLayerId: matchingLayer.id,
          schemaField: fieldName,
          schemaType: fieldDef.type,
          status: this.validateTypeMatch(matchingLayer, fieldDef) ? "mapped" : "type-mismatch",
        });
      } else if (inputSchema.required.includes(fieldName)) {
        mappings.push({
          figmaLayerName: "",
          figmaLayerId: "",
          schemaField: fieldName,
          schemaType: fieldDef.type,
          status: "missing",
        });
      }
    }
    
    return mappings;
  }
  
  private nameMatches(layerName: string, fieldName: string): boolean {
    const normalized = layerName.toLowerCase().replace(/[-_\s]/g, "");
    const fieldNormalized = fieldName.toLowerCase();
    return normalized.includes(fieldNormalized) || 
           fieldNormalized.includes(normalized);
  }
  
  getAllBindings(): ComponentBinding[] {
    return Array.from(this.bindings.values());
  }
  
  exportBindings(): string {
    const bindings = this.getAllBindings();
    return JSON.stringify({
      version: "1.0",
      exported: new Date().toISOString(),
      bindings: bindings.map(b => ({
        component: b.componentName,
        command: b.commandName,
        inputs: b.inputMappings,
        outputs: b.outputMappings,
      })),
    }, null, 2);
  }
}

export const bindingService = new BindingService();
```

### Scaffold Generator

```typescript
// src/generators/form-generator.ts

export interface ScaffoldOptions {
  style: "simple" | "card" | "modal";
  includeLabels: boolean;
  includeValidation: boolean;
  includeUXFields: boolean;
}

export async function generateFormScaffold(
  schema: CommandSchema,
  options: ScaffoldOptions
): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = `[AFD] ${schema.name}`;
  frame.layoutMode = "VERTICAL";
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "AUTO";
  frame.paddingTop = 24;
  frame.paddingBottom = 24;
  frame.paddingLeft = 24;
  frame.paddingRight = 24;
  frame.itemSpacing = 16;
  
  // Store binding metadata
  frame.setPluginData("afd-command", schema.name);
  frame.setPluginData("afd-schema", JSON.stringify(schema));
  
  // Generate input fields
  for (const [fieldName, fieldDef] of Object.entries(schema.input.schema.properties)) {
    const fieldGroup = await generateInputField(fieldName, fieldDef, options);
    frame.appendChild(fieldGroup);
  }
  
  // Generate submit button
  const submitButton = await generateSubmitButton(schema);
  frame.appendChild(submitButton);
  
  // Generate UX field placeholders
  if (options.includeUXFields && schema.output.uxFields) {
    const uxSection = await generateUXFieldsSection(schema.output.uxFields);
    frame.appendChild(uxSection);
  }
  
  // Position on canvas
  const viewport = figma.viewport.center;
  frame.x = viewport.x - frame.width / 2;
  frame.y = viewport.y - frame.height / 2;
  
  // Select the new frame
  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
  
  return frame;
}

async function generateInputField(
  name: string,
  definition: any,
  options: ScaffoldOptions
): Promise<FrameNode> {
  const group = figma.createFrame();
  group.name = `field_${name}`;
  group.layoutMode = "VERTICAL";
  group.primaryAxisSizingMode = "AUTO";
  group.counterAxisSizingMode = "FIXED";
  group.resize(320, group.height);
  group.itemSpacing = 4;
  group.fills = [];
  
  // Label
  if (options.includeLabels) {
    const label = figma.createText();
    await figma.loadFontAsync({ family: "Inter", style: "Medium" });
    label.fontName = { family: "Inter", style: "Medium" };
    label.characters = formatLabel(name) + (definition.required ? " *" : "");
    label.fontSize = 14;
    label.name = `label_${name}`;
    group.appendChild(label);
  }
  
  // Input based on type
  const input = await generateInputByType(name, definition);
  group.appendChild(input);
  
  // Description/hint
  if (definition.description) {
    const hint = figma.createText();
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    hint.fontName = { family: "Inter", style: "Regular" };
    hint.characters = definition.description;
    hint.fontSize = 12;
    hint.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }];
    hint.name = `hint_${name}`;
    group.appendChild(hint);
  }
  
  return group;
}

function formatLabel(fieldName: string): string {
  return fieldName
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, str => str.toUpperCase())
    .trim();
}
```

### Validation Engine

```typescript
// src/services/validation-service.ts

export interface ValidationResult {
  valid: boolean;
  componentId: string;
  commandName: string;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  type: "missing-input" | "type-mismatch" | "missing-action" | "unbound-component";
  message: string;
  field?: string;
  layerId?: string;
}

export interface ValidationWarning {
  type: "missing-ux-field" | "missing-error-state" | "missing-loading-state";
  message: string;
  suggestion: string;
}

export class ValidationService {
  async validateComponent(componentId: string): Promise<ValidationResult> {
    const component = figma.getNodeById(componentId);
    if (!component) {
      return {
        valid: false,
        componentId,
        commandName: "",
        errors: [{ type: "unbound-component", message: "Component not found" }],
        warnings: [],
      };
    }
    
    const bindingData = component.getPluginData("afd-binding");
    if (!bindingData) {
      return {
        valid: false,
        componentId,
        commandName: "",
        errors: [{ type: "unbound-component", message: "Component not bound to any command" }],
        warnings: [],
      };
    }
    
    const binding: ComponentBinding = JSON.parse(bindingData);
    const schema = await afdClient.describeCommand(binding.commandName);
    
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    
    // Check required inputs
    for (const field of schema.input.required) {
      const mapping = binding.inputMappings.find(m => m.schemaField === field);
      if (!mapping || mapping.status === "missing") {
        errors.push({
          type: "missing-input",
          message: `Required input '${field}' has no corresponding UI element`,
          field,
        });
      }
    }
    
    // Check for action trigger (button/submit)
    const hasAction = binding.inputMappings.some(m => 
      m.figmaLayerName.toLowerCase().includes("button") ||
      m.figmaLayerName.toLowerCase().includes("submit")
    );
    if (!hasAction) {
      errors.push({
        type: "missing-action",
        message: "No submit button found for form",
      });
    }
    
    // Check UX field coverage
    for (const uxField of schema.output.uxFields || []) {
      const hasMapping = binding.outputMappings.some(m => m.uxField === uxField);
      if (!hasMapping) {
        warnings.push({
          type: "missing-ux-field",
          message: `No UI element for '${uxField}' feedback`,
          suggestion: `Add a layer for displaying ${uxField} when command returns`,
        });
      }
    }
    
    return {
      valid: errors.length === 0,
      componentId,
      commandName: binding.commandName,
      errors,
      warnings,
    };
  }
  
  async validateAll(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    const bindings = bindingService.getAllBindings();
    
    for (const binding of bindings) {
      const result = await this.validateComponent(binding.componentId);
      results.push(result);
    }
    
    return results;
  }
}

export const validationService = new ValidationService();
```

## User Workflows

### Workflow 1: Discover and Design

1. Designer opens AFD Design Bridge plugin
2. Connects to development server (`localhost:3100`)
3. Browses available commands by category
4. Clicks "todo.create" to see requirements
5. Notes: needs title (required), priority (optional)
6. Designs form with appropriate inputs
7. Returns to plugin, binds component to command
8. Validates - sees green checkmarks

### Workflow 2: Scaffold First

1. Designer browses commands
2. Finds "user.register" - complex form with many fields
3. Clicks "+ Scaffold Form"
4. Plugin generates starter frame with all inputs
5. Designer customizes visuals while maintaining structure
6. Binding is automatic (from scaffold)

### Workflow 3: Validate Existing Design

1. Designer has existing design created without plugin
2. Opens plugin, selects frame
3. Clicks "Bind to Command" → selects "todo.create"
4. Plugin auto-detects mappings based on layer names
5. Shows warnings: "Missing error state variant"
6. Designer adds missing elements
7. Re-validates → all green

## Configuration

### Plugin Settings

```typescript
interface PluginSettings {
  // Connection
  serverUrl: string;
  autoConnect: boolean;
  
  // Scaffold defaults
  defaultStyle: "simple" | "card" | "modal";
  includeLabels: boolean;
  includeHints: boolean;
  includeUXFields: boolean;
  
  // Validation
  validateOnSelection: boolean;
  showWarnings: boolean;
  
  // Naming conventions
  inputSuffix: string; // e.g., "Input", "Field"
  buttonSuffix: string; // e.g., "Button", "Btn"
}
```

### Stored Plugin Data

Each bound component stores:

```json
{
  "afd-binding": {
    "commandName": "todo.create",
    "version": "1.0",
    "boundAt": "2025-12-31T10:00:00Z",
    "inputMappings": [],
    "outputMappings": []
  },
  "afd-schema": {},
  "afd-generated": true
}
```

## Success Criteria

- [ ] Plugin connects to AFD MCP server
- [ ] Command browser shows all commands with search/filter
- [ ] Command detail shows full schema with examples
- [ ] Component binding with auto-detection works
- [ ] Validation catches missing inputs/actions
- [ ] Scaffold generator creates usable starter frames
- [ ] Bindings export as JSON for code generation
- [ ] Settings persist across sessions

## Future Enhancements

1. **Real-time preview** — See command output shape as you design
2. **Design system integration** — Use team's existing components for scaffolds
3. **Collaborative bindings** — Sync bindings across team via Figma
4. **Version tracking** — Warn when schema changes break existing bindings
5. **Code preview** — Show generated code snippet in plugin

---

**Next**: [03-figma-make-generation.md](./03-figma-make-generation.md) — Generating production code
