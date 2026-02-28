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

// Memory adapter
export { MemoryAdapter, createMemoryAdapter } from './memory-adapter.js';

// HTTP adapter
export type { HttpAdapterOptions } from './http-adapter.js';
export { HttpAdapter, createHttpAdapter } from './http-adapter.js';
