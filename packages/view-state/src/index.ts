/**
 * @lushly-dev/afd-view-state — UI view state management via AFD commands.
 *
 * @example
 * ```ts
 * import { ViewStateRegistry, createViewStateCommands } from '@lushly-dev/afd-view-state';
 *
 * const registry = new ViewStateRegistry();
 * registry.register('panel', { get: () => ({ open: true }), set: (s) => {} });
 *
 * const commands = createViewStateCommands(registry);
 * ```
 *
 * @module @lushly-dev/afd-view-state
 */

// Commands
export { createViewStateCommands } from './commands.js';
// Registry
export { ViewStateRegistry } from './registry.js';
// Types
export type {
	PersistedViewState,
	ViewStateEntry,
	ViewStateHandler,
	ViewStateRegistryOptions,
} from './types.js';
