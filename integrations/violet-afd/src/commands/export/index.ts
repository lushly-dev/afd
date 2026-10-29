/**
 * Export Commands
 */

import { registry } from '../registry.js';
import { exportCommand } from './export.js';

export { exportCommand } from './export.js';

/**
 * Register all export commands
 */
export function registerExportCommands(): void {
	registry.register(exportCommand);
}
