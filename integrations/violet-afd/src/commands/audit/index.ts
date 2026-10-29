/**
 * Audit Commands
 *
 * Read the audit log that write commands record.
 */

import { registry } from '../registry.js';
import { auditListCommand } from './list.js';

export * from './list.js';

/**
 * Register all audit commands
 */
export function registerAuditCommands(): void {
	registry.register(auditListCommand);
}
