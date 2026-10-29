/**
 * Import Commands
 */

import { registry } from '../registry.js';
import { importJsonCommand } from './json.js';
import { importTreeCommand } from './tree.js';
import { importValidateCommand } from './validate.js';

export { importJsonCommand } from './json.js';
export { importTreeCommand, nodeIdFromFileName, VIOLET_EXTENSION_KEY } from './tree.js';
export { importValidateCommand } from './validate.js';

/**
 * Register all import commands
 */
export function registerImportCommands(): void {
	registry.register(importJsonCommand);
	registry.register(importValidateCommand);
	registry.register(importTreeCommand);
}
