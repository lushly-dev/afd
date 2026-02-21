# Plugin Discovery Specification

> Discover and load third-party command packages at startup via a declared plugin protocol, without modifying the host application.

## Summary

Add a plugin discovery system to `@lushly-dev/afd-server` that allows npm packages to contribute commands by declaring an entry point. The server factory discovers installed plugins at startup, calls their registration function, and merges contributed commands into the server's command set. Explicit registration remains the primary path; plugin discovery is opt-in.

## User Value

- **Zero-config extensibility** — Install a package, restart the server, commands appear automatically
- **Ecosystem growth** — Third parties can ship AFD command packages without coordinating with the host app
- **Debuggability preserved** — Explicit registration stays primary; plugins are additive, never silent overrides
- **Familiar pattern** — Mirrors Python's entry points (`importlib.metadata`) and botcore's `BotCorePlugin` protocol, proven in this workspace
- **Isolation** — Plugin loading failures are logged and skipped, never crash the host server

## User Stories

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-1 | Server author | Opt in to plugin discovery at startup | I get automatic namespace growth when ecosystem packages are installed |
| US-2 | Plugin author | Ship an npm package that contributes commands | Users get my commands by installing my package — no code changes needed |
| US-3 | Plugin author | Declare a config schema | My plugin's options are validated at startup, not at first use |
| US-4 | Server author | See which plugins were loaded and which failed | I can debug namespace collisions and load errors |
| US-5 | Server author | Override or exclude plugin-contributed commands | I keep control of my namespace even with discovery enabled |
| US-6 | Agent | Discover all available commands regardless of source | I can reason about the full capability set |

---

## Functional Requirements

### FR-1: Plugin Protocol

A plugin is a plain object that satisfies the `AfdPlugin` interface:

```typescript
/**
 * Protocol that npm packages implement to contribute commands
 * to an AFD server via plugin discovery.
 *
 * The generic TConfig parameter enables typed access to validated
 * plugin configuration via registry.config inside register().
 */
interface AfdPlugin<TConfig = unknown> {
  /**
   * Protocol version. The server checks this at load time and
   * skips plugins whose version it does not support.
   * Current version: 1.
   */
  readonly protocolVersion: 1;

  /** Human-readable plugin name (used in logs and diagnostics) */
  readonly name: string;

  /**
   * Called once during server.start(). The plugin adds commands,
   * middleware, and metadata to the provided registry.
   */
  register(registry: PluginRegistry<TConfig>): void | Promise<void>;

  /**
   * Optional Zod schema for plugin-specific configuration.
   * When provided, the server validates config before calling register().
   * The validated result is available as registry.config with full type safety.
   */
  configSchema?(): ZodType<TConfig> | undefined;
}
```

Plugins may be synchronous or async. The server awaits all `register()` calls inside `start()` before starting the transport. `createMcpServer()` remains synchronous — all async plugin work (discovery, config validation, registration) runs during `start()`, after construction but before accepting connections.

### FR-2: PluginRegistry API

The registry is the plugin's only interaction surface — it cannot reach into the server internals.

```typescript
/**
 * Registry object passed to AfdPlugin.register().
 * Plugins call its methods to contribute resources.
 */
interface PluginRegistry<TConfig = unknown> {
  /**
   * Add commands to the server namespace.
   * Commands must have unique names. Duplicates throw at startup.
   */
  addCommands(commands: ZodCommandDefinition[]): void;

  /**
   * Add middleware that applies to all commands (plugin + host).
   *
   * **Ordering:** Plugin middleware is appended after host-defined middleware
   * in the middleware array. Because the server applies middleware in reverse
   * order (onion model), plugin middleware runs **inside** the host onion —
   * host middleware (logging, timing, tracing) wraps plugin middleware.
   *
   * This means plugin middleware is appropriate for command-level concerns
   * (caching, input transformation, domain validation). Cross-cutting concerns
   * like auth, observability, and rate limiting should be added to the host
   * middleware directly to ensure they wrap everything.
   */
  addMiddleware(middleware: CommandMiddleware[]): void;

  /**
   * Register metadata about the plugin (for diagnostics and afd-help).
   */
  setMetadata(meta: PluginMetadata): void;

  /** The validated config for this plugin (set by the server before register()) */
  readonly config: TConfig | undefined;
}

interface PluginMetadata {
  /** Plugin description (shown in afd-help) */
  description?: string;

  /** Plugin version */
  version?: string;

  /** Plugin homepage or repo URL */
  homepage?: string;
}
```

### FR-3: Entry Point Declaration

Plugins declare themselves via `package.json` metadata. The convention uses a well-known key:

```jsonc
// node_modules/@acme/afd-analytics/package.json
{
  "name": "@acme/afd-analytics",
  "version": "1.0.0",
  "afd": {
    "plugin": "./dist/plugin.js"
  }
}
```

The `afd.plugin` field points to a module whose **default export** is either:

1. An `AfdPlugin` instance (plain object with `name`, `protocolVersion`, and `register`), or
2. A factory function `() => AfdPlugin | Promise<AfdPlugin>` (called once during startup).

```typescript
// @acme/afd-analytics/src/plugin.ts
import { defineCommand, success } from '@lushly-dev/afd-server';
import type { AfdPlugin, PluginRegistry } from '@lushly-dev/afd-server';
import { z } from 'zod';

const trackEvent = defineCommand({
  name: 'analytics-track',
  description: 'Track an analytics event',
  category: 'analytics',
  input: z.object({ event: z.string(), properties: z.record(z.unknown()).optional() }),
  async handler(input) {
    return success({ tracked: true }, { reasoning: `Tracked event: ${input.event}` });
  },
});

const plugin: AfdPlugin = {
  protocolVersion: 1,
  name: 'analytics',
  register(registry) {
    registry.addCommands([trackEvent]);
    registry.setMetadata({
      description: 'Analytics tracking commands',
      version: '1.0.0',
    });
  },
};

export default plugin;
```

### FR-4: Discovery Mechanism

Discovery reads the host application's `package.json` dependencies and uses Node.js module resolution to find packages that declare the `afd.plugin` field. This approach works across all package managers (npm, pnpm, Yarn, Yarn PnP) without relying on `node_modules` filesystem layout.

```typescript
/**
 * Discover AFD plugins from installed npm packages.
 * Reads host package.json dependencies, resolves each via Node.js
 * module resolution, and loads packages with an `afd.plugin` field.
 */
async function discoverPlugins(options?: DiscoveryOptions): Promise<DiscoveryResult> {
  // ...implementation
}

interface DiscoveryOptions {
  /**
   * Path to the host application's package.json.
   * Defaults to the nearest package.json found by walking up from cwd.
   * The dependency list from this file determines which packages are
   * scanned for the `afd.plugin` field.
   */
  packageJsonPath?: string;

  /**
   * Package name patterns to include (glob).
   * Applied against the host's dependency names before resolution.
   * @default ['afd-plugin-*', '@*\/afd-*', '@*\/afd-plugin-*']
   * @example ['@acme/afd-*', 'afd-plugin-*']
   */
  include?: string[];

  /**
   * Package names to exclude from discovery.
   * Takes precedence over include.
   * @example ['@acme/afd-deprecated']
   */
  exclude?: string[];

  /**
   * Plugin-specific configuration, keyed by plugin name.
   * Validated against the plugin's configSchema() if provided.
   */
  config?: Record<string, Record<string, unknown>>;
}

interface DiscoveryResult {
  /** Successfully loaded plugins, keyed by plugin name */
  plugins: Map<string, LoadedPlugin>;

  /** Plugins that failed to load (logged, not fatal) */
  errors: PluginLoadError[];
}

interface LoadedPlugin {
  /** The plugin instance */
  plugin: AfdPlugin;

  /** The npm package name that contributed this plugin */
  packageName: string;

  /** The npm package version */
  packageVersion: string;

  /** Commands contributed by this plugin */
  commands: ZodCommandDefinition[];

  /** Middleware contributed by this plugin */
  middleware: CommandMiddleware[];

  /** Plugin metadata */
  metadata?: PluginMetadata;
}

interface PluginLoadError {
  /** The npm package that failed */
  packageName: string;

  /** Why it failed */
  reason: string;

  /** Original error */
  cause?: Error;
}
```

**Discovery algorithm:**

1. Read the host's `package.json` (from `packageJsonPath` or nearest ancestor).
2. Collect all dependency names from `dependencies`, `devDependencies`, and `optionalDependencies`.
3. Apply `include` / `exclude` glob filters against the dependency names.
4. For each matching dependency, resolve its `package.json` via Node.js module resolution (`import.meta.resolve()`).
5. Read each resolved `package.json` and filter to those with an `afd.plugin` field.
6. Dynamically `import()` the module path from `afd.plugin`.
7. Validate the default export satisfies `AfdPlugin` (has `name`, `protocolVersion`, and `register`).
8. If the export is a factory function (not an object with `name`), call it to obtain the plugin instance.
9. Check `protocolVersion` is supported by this server version. Skip with a warning if unsupported.
10. If the plugin declares `configSchema()`, validate the provided config.
11. Create a `PluginRegistry`, call `plugin.register(registry)`.
12. Collect commands and middleware from the registry.
13. Return `DiscoveryResult` with loaded plugins and any errors.

### FR-5: Server Factory Integration

The `McpServerOptions` gains an optional `plugins` field that enables discovery:

```typescript
interface McpServerOptions {
  // ... existing fields ...

  /**
   * Plugin discovery configuration.
   * When provided, the server discovers and loads plugins during start().
   * Omit to use explicit registration only (current behavior, remains the default).
   */
  plugins?: PluginOptions | boolean;
}

/**
 * Plugin discovery options.
 * Pass `true` to enable with defaults, or an object for fine control.
 */
type PluginOptions = {
  /**
   * Enable automatic discovery of installed afd.plugin packages.
   * @default true
   */
  discover?: boolean;

  /**
   * Package name patterns to include in discovery (glob).
   * Applied against the host's dependency names before resolution.
   * @default ['afd-plugin-*', '@*\/afd-*', '@*\/afd-plugin-*']
   * @example ['@acme/afd-*']
   */
  include?: string[];

  /**
   * Package names to exclude from discovery.
   */
  exclude?: string[];

  /**
   * Plugin-specific configuration, keyed by plugin name.
   */
  config?: Record<string, Record<string, unknown>>;

  /**
   * Manually registered plugins (bypass discovery).
   * Useful for testing or when plugins aren't installed as npm packages.
   */
  manual?: AfdPlugin[];

  /**
   * How to handle command name collisions between plugins and explicit commands.
   * - 'explicit-wins': Explicit commands take precedence (default, safest)
   * - 'error': Throw at startup on any collision
   * - 'plugin-wins': Plugin commands override explicit ones (use with caution)
   * @default 'explicit-wins'
   */
  onConflict?: 'explicit-wins' | 'error' | 'plugin-wins';
};
```

**Usage:**

```typescript
// Enable discovery with defaults
const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands: [myCommand],              // Explicit commands (primary)
  plugins: true,                       // Discover installed plugins
});

// Fine-grained control
const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands: [myCommand],
  plugins: {
    discover: true,
    include: ['@acme/afd-*'],
    config: {
      analytics: { trackingId: 'UA-123' },
    },
    onConflict: 'error',
  },
});

// Manual plugins only (no discovery scan)
const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands: [],
  plugins: {
    discover: false,
    manual: [analyticsPlugin, loggingPlugin],
  },
});
```

### FR-6: Command Namespace Isolation

Commands from different sources are tracked by origin:

```typescript
interface CommandOrigin {
  /** Where this command came from */
  source: 'explicit' | 'plugin' | 'bootstrap';

  /** For plugin-sourced commands, the plugin name */
  pluginName?: string;

  /** For plugin-sourced commands, the npm package */
  packageName?: string;
}
```

The `afd-help` bootstrap command is augmented to include origin information so agents and developers can see which commands came from which plugins (this is an additive change to the existing `afd-help` output):

```typescript
// Example afd-help output (augmented)
{
  commands: [
    { name: 'todo-create', category: 'todo', origin: { source: 'explicit' } },
    { name: 'analytics-track', category: 'analytics', origin: { source: 'plugin', pluginName: 'analytics', packageName: '@acme/afd-analytics' } },
    { name: 'afd-help', category: 'system', origin: { source: 'bootstrap' } },
  ]
}
```

### FR-7: Startup Diagnostics

When plugins are enabled, the server emits structured diagnostics at startup:

```typescript
interface PluginDiagnostics {
  /** Total plugins discovered */
  discovered: number;

  /** Successfully loaded */
  loaded: number;

  /** Failed to load (details in errors) */
  failed: number;

  /** Total commands contributed by plugins */
  commandsAdded: number;

  /** Total middleware contributed by plugins */
  middlewareAdded: number;

  /** Name collisions resolved */
  conflictsResolved: number;

  /** Details per plugin */
  plugins: Array<{
    name: string;
    packageName: string;
    version: string;
    commandCount: number;
    status: 'loaded' | 'error' | 'excluded';
  }>;

  /** Load failures */
  errors: PluginLoadError[];
}
```

Diagnostics are:
- Logged via `onCommand`/`onError` callbacks (existing pattern)
- Available via a new `afd-plugins` bootstrap command
- Returned from `server.getPluginDiagnostics()` for programmatic access

### FR-8: Integration with Existing Server Features

#### Tool Strategy

Plugin-contributed commands follow the same `toolStrategy` rules as explicit commands. In `'grouped'` mode (default), a plugin contributing `weather-current` and `weather-forecast` produces a `weather` tool group automatically — the category derivation logic (`cmd.category || cmd.name.split('-')[0]`) applies uniformly regardless of command origin.

#### ExposeOptions

Plugin commands use the same `ExposeOptions` defaults as explicit commands. Notably, `expose.mcp` defaults to `false` (opt-in for MCP visibility). Plugin authors must explicitly set `expose: { mcp: true }` on commands they intend to be visible as MCP tools, or the server author can override exposure via the existing `exposeDefaults` mechanism.

#### Middleware Chain Construction

The server builds the middleware chain during `start()`, after all plugins have registered. The final middleware array is:

```
[...hostMiddleware, ...plugin1Middleware, ...plugin2Middleware, ...]
```

Because the server applies middleware in reverse array order (onion model), the effective execution order is: host middleware (outermost) wraps plugin middleware (innermost), which wraps the handler.

### FR-9: DirectClient Integration

Plugin-contributed commands are available through `DirectClient` when the server's registry is used as the `DirectRegistry`:

```typescript
// After start(), the server exposes all commands (explicit + plugin)
const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands: [todoCreate],
  plugins: true,
});
await server.start();

// DirectClient uses the server as its registry
const client = new DirectClient(server);
// Plugin commands are callable
const weather = await client.call('weather-current', { location: 'NYC' });
```

For this to work, `McpServer` must implement the `DirectRegistry` interface, and `getCommands()` / `listCommands()` must return the full command set (explicit + plugin + bootstrap) after `start()` completes. Before `start()`, only explicit commands are available.

---

## API Design

### Public Exports

```typescript
// New exports from @lushly-dev/afd-server
export type { AfdPlugin, PluginRegistry, PluginMetadata } from './plugin.js';
export type { DiscoveryOptions, DiscoveryResult, LoadedPlugin, PluginLoadError } from './discovery.js';
export { discoverPlugins } from './discovery.js';
```

### Bootstrap Command: `afd-plugins`

A new bootstrap command lists loaded plugins and their contributed commands:

```typescript
const afdPluginsCommand = defineCommand({
  name: 'afd-plugins',
  description: 'List loaded plugins and their contributed commands',
  category: 'system',
  input: z.object({
    verbose: z.boolean().optional().describe('Include full command schemas'),
  }),
  async handler(input, context) {
    return success(diagnostics, {
      reasoning: `${diagnostics.loaded} plugins loaded, contributing ${diagnostics.commandsAdded} commands`,
    });
  },
});
```

---

## Examples

### Example 1: Publishing a Plugin Package

```typescript
// @acme/afd-weather/src/plugin.ts
import { defineCommand, success, failure } from '@lushly-dev/afd-server';
import type { AfdPlugin, PluginRegistry } from '@lushly-dev/afd-server';
import { z } from 'zod';

// Typed config schema — inferred type flows to registry.config
const weatherConfig = z.object({
  apiKey: z.string().describe('Weather API key'),
  units: z.enum(['metric', 'imperial']).default('metric'),
});
type WeatherConfig = z.infer<typeof weatherConfig>;

const plugin: AfdPlugin<WeatherConfig> = {
  protocolVersion: 1,
  name: 'weather',

  configSchema() {
    return weatherConfig;
  },

  register(registry) {
    // registry.config is typed as WeatherConfig — no casting needed
    const { apiKey, units } = registry.config!;

    const weatherCurrent = defineCommand({
      name: 'weather-current',
      description: 'Get current weather for a location',
      category: 'weather',
      input: z.object({ location: z.string() }),
      async handler(input) {
        const data = await fetchWeather(input.location, apiKey, units);
        return success(data, { confidence: 0.9, reasoning: 'Live API data' });
      },
    });

    const weatherForecast = defineCommand({
      name: 'weather-forecast',
      description: 'Get 7-day weather forecast',
      category: 'weather',
      input: z.object({
        location: z.string(),
        days: z.number().min(1).max(14).default(7),
      }),
      async handler(input) {
        const data = await fetchForecast(input.location, input.days, apiKey, units);
        return success(data, { reasoning: `${input.days}-day forecast` });
      },
    });

    registry.addCommands([weatherCurrent, weatherForecast]);
    registry.setMetadata({
      description: 'Weather data commands powered by OpenWeather',
      version: '1.0.0',
      homepage: 'https://github.com/acme/afd-weather',
    });
  },
};

export default plugin;
```

```jsonc
// @acme/afd-weather/package.json
{
  "name": "@acme/afd-weather",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "afd": {
    "plugin": "./dist/plugin.js"
  },
  "peerDependencies": {
    "@lushly-dev/afd-server": "^0.1.0"
  }
}
```

### Example 2: Server with Plugin Discovery

```typescript
import { createMcpServer, defineCommand, success } from '@lushly-dev/afd-server';
import { z } from 'zod';

const todoCreate = defineCommand({
  name: 'todo-create',
  description: 'Create a todo',
  input: z.object({ title: z.string() }),
  async handler(input) {
    return success({ id: '1', title: input.title });
  },
});

const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands: [todoCreate],
  plugins: {
    discover: true,
    config: {
      weather: { apiKey: process.env.WEATHER_API_KEY, units: 'metric' },
    },
    onConflict: 'error',
  },
});

await server.start();
// Logs:
// [afd] Plugin discovery: 2 found, 2 loaded, 0 failed
// [afd]   ✓ weather (@acme/afd-weather@1.0.0) — 2 commands
// [afd]   ✓ analytics (@acme/afd-analytics@1.0.0) — 1 command
// [afd] Total commands: 8 (1 explicit + 3 plugin + 4 bootstrap)
```

### Example 3: Manual Plugin Registration (Testing)

```typescript
import { createMcpServer } from '@lushly-dev/afd-server';
import { weatherPlugin } from '@acme/afd-weather';

const server = createMcpServer({
  name: 'test-server',
  version: '0.0.1',
  commands: [],
  plugins: {
    discover: false,
    manual: [weatherPlugin],
  },
});

// Only weather commands registered — no filesystem scanning
```

---

## Implementation Notes

### Startup Lifecycle

When `plugins` is configured, `server.start()` follows this sequence:

1. **Discovery** — Read host `package.json`, resolve matching dependencies, load `afd.plugin` modules.
2. **Validation** — Check `protocolVersion`, validate configs against `configSchema()`.
3. **Registration** — Call `plugin.register(registry)` for each plugin sequentially.
4. **Merge** — Combine explicit commands, plugin commands, and bootstrap commands into a single `commandMap`. Apply `onConflict` rules. Build the merged middleware chain.
5. **Transport** — Start stdio/HTTP transport and begin accepting connections.

Steps 1–4 are async. `createMcpServer()` remains synchronous and stores the `plugins` config for later. This means `getCommands()` returns only explicit commands before `start()`, and the full set after.

### Discovery Performance

Plugin discovery runs once during `server.start()`. To keep startup fast:

- **Dependency-scoped:** Only packages listed in the host's `package.json` dependencies are candidates — no filesystem scanning of `node_modules`.
- **Pre-filtered:** The default `include` patterns (`afd-plugin-*`, `@*/afd-*`) narrow candidates before any resolution, so most dependencies are skipped immediately.
- **Lazy imports:** Plugin modules are `import()`-ed only after the `afd.plugin` field is confirmed in the dependency's resolved `package.json`.
- **Parallel resolution:** Dependency `package.json` files are resolved concurrently. Plugin `register()` calls run sequentially to avoid race conditions.
- **Caching:** The discovery result is memoized for the server lifetime. Re-running discovery requires a server restart.

### Security Considerations

- **Plugin code runs in-process.** There is no sandbox. Plugin discovery should only be enabled in trusted environments (same security model as `node_modules` in general).
- **Config validation** via `configSchema()` prevents plugins from receiving invalid configuration.
- **Namespace protection:** The `onConflict: 'explicit-wins'` default ensures plugins cannot silently override host commands. The `'error'` mode is recommended for production to catch collisions early.
- **`afd.plugin`** is deliberately a `package.json` field (not an arbitrary file path) so only installed packages can participate — no remote code loading.
- **Direct dependencies only:** Discovery scans the host's `package.json` dependency list, not transitive dependencies. A plugin must be explicitly installed by the server author to be discovered.

### Relationship to Python botcore Plugin System

This design is deliberately parallel to botcore's `BotCorePlugin` protocol:

| Concept | Python (botcore) | TypeScript (afd-server) |
|---------|------------------|-------------------------|
| Plugin interface | `BotCorePlugin` protocol | `AfdPlugin` interface |
| Registration surface | `PluginRegistry` (add_commands, add_docs, etc.) | `PluginRegistry` (addCommands, addMiddleware, etc.) |
| Entry point declaration | `pyproject.toml` `[project.entry-points."botcore.plugins"]` | `package.json` `"afd": { "plugin": "..." }` |
| Discovery mechanism | `importlib.metadata.entry_points()` | Host `package.json` dependency resolution |
| Error handling | Logged warning, plugin skipped | Logged warning, plugin skipped |
| Namespace building | `build_namespace()` | `discoverPlugins()` |

---

## Relationship to Existing Types

| Existing | Plugin Equivalent |
|----------|-------------------|
| `McpServerOptions.commands` | Explicit registration (unchanged, remains primary) |
| `ZodCommandDefinition` | Same type — plugins contribute standard commands |
| `CommandMiddleware` | Plugins can contribute middleware via `addMiddleware()` |
| `McpServer.getCommands()` | Returns all commands (explicit + plugin + bootstrap) after `start()` |
| Bootstrap commands (`afd-help`, `afd-schema`, `afd-docs`) | `afd-plugins` joins the bootstrap set |

---

## Out of Scope

- [ ] Hot-reloading plugins without server restart (Phase 2)
- [ ] Plugin dependency ordering / inter-plugin dependencies (Phase 2)
- [ ] Plugin middleware priority / explicit ordering control (Phase 2)
- [ ] Remote plugin registries or download-on-demand (Phase 3)
- [ ] Plugin sandboxing or permission boundaries (Phase 3)
- [ ] UI for plugin management (Phase 3)
- [ ] Plugin lifecycle hooks beyond `register()` (e.g., `onShutdown`) (Phase 2)

---

## Success Criteria

- [ ] `AfdPlugin` interface (with `protocolVersion` and generic `TConfig`) exported from `@lushly-dev/afd-server`
- [ ] `PluginRegistry` with `addCommands()`, `addMiddleware()`, `setMetadata()`, typed `config`
- [ ] `discoverPlugins()` resolves host `package.json` dependencies for `afd.plugin` packages
- [ ] `McpServerOptions.plugins` enables opt-in discovery
- [ ] Discovery and registration run during `start()`, not `createMcpServer()`
- [ ] Explicit commands take precedence over plugin commands by default
- [ ] Failed plugin loads are logged, not fatal
- [ ] Unsupported `protocolVersion` logged and skipped
- [ ] Config validation via plugin `configSchema()` with typed access
- [ ] `afd-plugins` bootstrap command lists loaded plugins
- [ ] `CommandOrigin` tracks source of each command
- [ ] Plugin commands respect `ExposeOptions` and `toolStrategy`
- [ ] `McpServer` implements `DirectRegistry` with full command set after `start()`
- [ ] Manual registration path for testing (bypass discovery)
- [ ] Factory function default exports supported (in addition to plain objects)
- [ ] Unit tests for discovery, registration, conflict resolution, protocolVersion check
- [ ] Integration test: install mock plugin package, verify commands appear via MCP and DirectClient
