/**
 * @afd/testing - Fixture Loader
 *
 * Loads fixture files and applies them to set up initial test state.
 * Supports:
 * - JSON fixture files
 * - Base fixture inheritance
 * - Inline overrides
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { FixtureConfig } from "../types/scenario.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Generic fixture data structure.
 * App-specific fixtures extend this with their own fields.
 */
export interface FixtureData {
  /** Schema identifier */
  $schema?: string;

  /** Target application */
  app?: string;

  /** Fixture format version */
  version?: string;

  /** Human-readable description */
  description?: string;

  /** App-specific data */
  [key: string]: unknown;
}

/**
 * Result from loading a fixture.
 */
export type LoadFixtureResult =
  | { success: true; data: FixtureData; path: string }
  | { success: false; error: string; path?: string };

/**
 * Options for fixture loading.
 */
export interface LoadFixtureOptions {
  /** Base directory for resolving relative paths */
  basePath?: string;

  /** Validate fixture structure */
  validate?: boolean;
}

// ============================================================================
// Fixture Loader
// ============================================================================

/**
 * Load a fixture from configuration.
 *
 * @param config - Fixture configuration from scenario
 * @param options - Loading options
 * @returns Loaded and merged fixture data
 *
 * @example
 * ```typescript
 * const result = await loadFixture({
 *   file: "./fixtures/seeded-todos.json",
 *   overrides: { todos: [{ id: "custom", title: "Custom todo" }] }
 * });
 * if (result.success) {
 *   console.log(result.data);
 * }
 * ```
 */
export async function loadFixture(
  config: FixtureConfig,
  options: LoadFixtureOptions = {}
): Promise<LoadFixtureResult> {
  const basePath = options.basePath ?? process.cwd();

  try {
    // 1. Load the main fixture file
    const fixturePath = resolve(basePath, config.file);
    const mainData = await loadJsonFile(fixturePath);

    if (!mainData.success) {
      return mainData;
    }

    let mergedData = mainData.data;

    // 2. If there's a base fixture, load and merge it
    if (config.base) {
      const baseFixturePath = resolve(dirname(fixturePath), config.base);
      const baseData = await loadJsonFile(baseFixturePath);

      if (!baseData.success) {
        return {
          success: false,
          error: `Failed to load base fixture: ${baseData.error}`,
          path: baseFixturePath,
        };
      }

      // Base is applied first, then main fixture overrides
      mergedData = deepMerge(baseData.data, mergedData);
    }

    // 3. Apply inline overrides
    if (config.overrides) {
      mergedData = deepMerge(mergedData, config.overrides as FixtureData);
    }

    return {
      success: true,
      data: mergedData,
      path: fixturePath,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Load a JSON file and parse it.
 */
async function loadJsonFile(filePath: string): Promise<LoadFixtureResult> {
  try {
    const content = await readFile(filePath, "utf-8");
    const data = JSON.parse(content) as FixtureData;

    return {
      success: true,
      data,
      path: filePath,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        success: false,
        error: `Fixture file not found: ${filePath}`,
        path: filePath,
      };
    }

    if (err instanceof SyntaxError) {
      return {
        success: false,
        error: `Invalid JSON in fixture file: ${err.message}`,
        path: filePath,
      };
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      path: filePath,
    };
  }
}

/**
 * Deep merge two objects. Source values override target values.
 * Arrays are replaced, not concatenated.
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: T): T {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (
      isPlainObject(sourceValue) &&
      isPlainObject(targetValue)
    ) {
      // Recursively merge nested objects
      result[key as keyof T] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else {
      // Override with source value (including arrays)
      result[key as keyof T] = sourceValue as T[keyof T];
    }
  }

  return result;
}

/**
 * Check if value is a plain object (not array, null, etc.)
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

// ============================================================================
// Fixture Application
// ============================================================================

/**
 * Apply fixture data to a system via commands.
 *
 * This function takes loaded fixture data and a command handler,
 * then executes the appropriate commands to set up initial state.
 *
 * @param data - Loaded fixture data
 * @param handler - Command execution function
 * @returns Result of fixture application
 */
export async function applyFixture(
  data: FixtureData,
  handler: (command: string, input?: Record<string, unknown>) => Promise<unknown>
): Promise<{ success: boolean; error?: string; appliedCommands: string[] }> {
  const appliedCommands: string[] = [];

  try {
    // Check for app-specific fixture format
    const app = data.app ?? "generic";

    switch (app) {
      case "todo":
        return await applyTodoFixture(data, handler, appliedCommands);

      case "violet":
        return await applyVioletFixture(data, handler, appliedCommands);

      default:
        // Generic fixture: look for 'setup' commands array
        if (Array.isArray(data.setup)) {
          for (const cmd of data.setup) {
            if (typeof cmd === "object" && cmd.command) {
              await handler(cmd.command as string, cmd.input as Record<string, unknown>);
              appliedCommands.push(cmd.command as string);
            }
          }
        }
        return { success: true, appliedCommands };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      appliedCommands,
    };
  }
}

/**
 * Apply todo app fixture.
 */
async function applyTodoFixture(
  data: FixtureData,
  handler: (command: string, input?: Record<string, unknown>) => Promise<unknown>,
  appliedCommands: string[]
): Promise<{ success: boolean; error?: string; appliedCommands: string[] }> {
  // Clear existing todos first
  if (data.clearFirst !== false) {
    await handler("todo.clear", { all: true });
    appliedCommands.push("todo.clear");
  }

  // Create todos from fixture
  const todos = data.todos as Array<Record<string, unknown>> | undefined;
  if (todos && Array.isArray(todos)) {
    for (const todo of todos) {
      await handler("todo.create", {
        title: todo.title,
        description: todo.description,
        priority: todo.priority ?? "medium",
      });
      appliedCommands.push("todo.create");

      // If todo is completed, toggle it
      if (todo.completed) {
        // Note: We can't easily toggle by ID here without tracking created IDs
        // This is a limitation - fixtures work best with predictable state
      }
    }
  }

  return { success: true, appliedCommands };
}

/**
 * Apply Violet (design token) app fixture.
 */
async function applyVioletFixture(
  data: FixtureData,
  handler: (command: string, input?: Record<string, unknown>) => Promise<unknown>,
  appliedCommands: string[]
): Promise<{ success: boolean; error?: string; appliedCommands: string[] }> {
  // Create nodes first
  const nodes = data.nodes as Array<Record<string, unknown>> | undefined;
  if (nodes && Array.isArray(nodes)) {
    for (const node of nodes) {
      await handler("node.create", {
        id: node.id,
        name: node.name,
        type: node.type,
        parentId: node.parentId,
        includes: node.includes,
        tags: node.tags,
      });
      appliedCommands.push("node.create");
    }
  }

  // Apply operations (token add/override/subtract)
  const operations = data.operations as Array<Record<string, unknown>> | undefined;
  if (operations && Array.isArray(operations)) {
    for (const op of operations) {
      const opType = op.type as string;
      const command = `token.${opType}`;

      await handler(command, {
        node: op.nodeId,
        token: op.token,
        value: op.value,
        from: op.sourceNodeId,
        ancestor: op.ancestorId,
      });
      appliedCommands.push(command);
    }
  }

  // Set constraints
  const constraints = data.constraints as Array<Record<string, unknown>> | undefined;
  if (constraints && Array.isArray(constraints)) {
    for (const constraint of constraints) {
      await handler("constraints.set", {
        node: constraint.nodeId,
        id: constraint.id,
        type: constraint.type,
        tokens: constraint.tokens,
        ...constraint, // Pass through other constraint-specific fields
      });
      appliedCommands.push("constraints.set");
    }
  }

  return { success: true, appliedCommands };
}
