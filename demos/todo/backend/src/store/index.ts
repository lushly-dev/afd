/**
 * @fileoverview Store factory - selects the appropriate store based on configuration
 *
 * Environment variables:
 *   TODO_STORE_TYPE - "memory" or "file" (default: "file")
 *   TODO_STORE_PATH - Path to the JSON file (default: ./data/todos.json)
 *
 * The default is "file" to enable MCP (stdio) and HTTP servers to share data.
 * Use "memory" for testing or isolated instances.
 */

import { TodoStore, memoryStore } from "./memory.js";
import { FileStore } from "./file.js";

// Store type from environment (default: file for shared storage)
const STORE_TYPE = process.env.TODO_STORE_TYPE ?? "file";
const STORE_PATH = process.env.TODO_STORE_PATH;

/**
 * Store interface - common API for both memory and file stores.
 */
export type Store = TodoStore | FileStore;

/**
 * Create a store instance based on environment configuration.
 *
 * @returns A TodoStore (memory) or FileStore (file) instance
 */
export function createStore(): Store {
  if (STORE_TYPE === "memory") {
    console.error("[Store] Using in-memory storage (isolated per process)");
    // Use the singleton from memory.ts to ensure tests and commands share the same store
    return memoryStore;
  }

  const store = new FileStore(STORE_PATH);
  console.error(`[Store] Using file storage (shared across processes)`);
  return store;
}

/**
 * Singleton store instance.
 *
 * This ensures all commands within a single process share the same store.
 * For file-based storage, multiple processes will share the same JSON file.
 */
export const store = createStore();

// Re-export types for convenience
export { TodoStore } from "./memory.js";
export { FileStore } from "./file.js";
