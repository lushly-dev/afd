/**
 * Export Commands
 */

import { registry } from '../registry.js';
import { exportCommand } from './export.js';
import { exportTreeCommand } from './tree.js';

export { exportCommand } from './export.js';
export { exportTreeCommand } from './tree.js';

/**
 * Register all export commands
 */
export function registerExportCommands(): void {
	registry.register(exportCommand);
	registry.register(exportTreeCommand);
}
