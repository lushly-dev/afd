/**
 * API Key Commands
 *
 * Offline helpers for the hosted API's keys: generate a key with its seed
 * entry and SQL, and check a VIOLET_API_KEYS_JSON value before saving it.
 * Neither command connects to a database.
 */

import { registry } from '../registry.js';
import { apiKeysCheckCommand } from './check.js';
import { apiKeysCreateCommand } from './create.js';

export * from './keys.js';
export { apiKeysCreateCommand } from './create.js';
export { apiKeysCheckCommand } from './check.js';

/**
 * Register all API key commands
 */
export function registerApiKeyCommands(): void {
	registry.register(apiKeysCreateCommand);
	registry.register(apiKeysCheckCommand);
}
