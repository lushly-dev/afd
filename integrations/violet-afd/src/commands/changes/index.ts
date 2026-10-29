/**
 * Change Commands
 *
 * Commands that preview token changes before they are applied.
 */

import { registry } from '../registry.js';
import { changesImpactCommand } from './impact.js';

export * from './impact.js';

/**
 * Register all change commands
 */
export function registerChangesCommands(): void {
	registry.register(changesImpactCommand);
}
