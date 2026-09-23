/**
 * @lushly-dev/afd-view-state — UI view state management via AFD commands.
 *
 * @example
 * ```ts
 * import { ViewStateRegistry } from '@lushly-dev/afd-view-state';
 * import { createViewStateCommands } from '@lushly-dev/afd-view-state/commands';
 *
 * const registry = new ViewStateRegistry();
 * registry.register('panel', { get: () => ({ open: true }), set: (s) => {} });
 *
 * const commands = createViewStateCommands(registry, { expose: { mcp: true } });
 * ```
 *
 * @module @lushly-dev/afd-view-state
 */

// Commands
export {
	/**
	 * @deprecated Import from `@lushly-dev/afd-view-state/commands`. The root
	 * entry stops re-exporting the command factory in the next major version, so
	 * that using the registry alone no longer depends on `@lushly-dev/afd-server`.
	 */
	createViewStateCommands,
} from './commands.js';
// Registry
export { ViewStateRegistry } from './registry.js';
// Types
export type {
	PersistedViewState,
	ViewStateEntry,
	ViewStateHandler,
	ViewStateRegistryOptions,
} from './types.js';
