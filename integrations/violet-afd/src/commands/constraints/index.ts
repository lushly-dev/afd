/**
 * Constraint Commands
 */

import { registry } from '../registry.js';
import { listCommand } from './list.js';
import { setCommand } from './set.js';
import { validateCommand } from './validate.js';

export * from './set.js';
export * from './list.js';
export * from './validate.js';

/**
 * Register all constraint commands
 */
export function registerConstraintCommands(): void {
	registry.register(setCommand);
	registry.register(listCommand);
	registry.register(validateCommand);
}
