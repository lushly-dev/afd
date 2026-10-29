/**
 * Specimen Commands
 */

import { registry } from '../registry.js';
import { specimenGetCommand } from './get.js';
import { specimenSetCommand } from './set.js';

export * from './get.js';
export * from './set.js';

/**
 * Register all specimen commands
 */
export function registerSpecimenCommands(): void {
	registry.register(specimenGetCommand);
	registry.register(specimenSetCommand);
}
