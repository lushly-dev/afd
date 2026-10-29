/**
 * Violet Design Core
 *
 * Token management engine with hierarchical inheritance: data contracts, storage, inheritance
 * resolution, export and CSS validators, with no AFD dependency. AFD command bindings, the
 * command registry and CommandResult types are in @lushly-dev/violet-afd.
 */

// Types and error codes
export * from './types/index.js';

// Storage contract and stores (the Neon store is @lushly-dev/violet-core/neon)
export type { Database } from './storage.js';
export * from './db/index.js';

// Export module
export * from './export/index.js';

// Resolution cache (the full engine is @lushly-dev/violet-core/engine)
export {
	ResolutionCache,
	type ResolutionScope,
	withResolutionCache,
} from './engine/resolution-cache.js';

// Native resolution and export
export * from './tokens.js';

// Hosted API OpenAPI document (also in `@lushly-dev/violet-core/worker`)
export * from './openapi/index.js';

// CSS-safe value validators (also `@lushly-dev/violet-core/css`)
export * from './css/index.js';
