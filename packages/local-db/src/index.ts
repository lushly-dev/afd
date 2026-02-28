/**
 * @lushly-dev/local-db — Async data adapter with swappable backends.
 *
 * @example
 * ```ts
 * import { createMemoryAdapter, createHttpAdapter } from '@lushly-dev/local-db';
 *
 * // Tests — no server needed
 * const testDb = createMemoryAdapter();
 *
 * // Production — talks to REST server
 * const prodDb = createHttpAdapter('/api/v1');
 * ```
 *
 * @module @lushly-dev/local-db
 */

// HTTP adapter
export type { HttpAdapterOptions } from './http-adapter.js';
export { createHttpAdapter, HttpAdapter } from './http-adapter.js';
// Memory adapter
export { createMemoryAdapter, MemoryAdapter } from './memory-adapter.js';
// Types
export type {
	BatchOperation,
	BatchOperationResult,
	BatchResult,
	DataAdapter,
	HealthStatus,
	ListResult,
	QueryParams,
} from './types.js';
