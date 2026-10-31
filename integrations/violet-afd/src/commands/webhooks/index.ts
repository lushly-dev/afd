/**
 * Webhook Commands
 *
 * Commands for managing webhook endpoints and delivery logs.
 */

export { webhooksRegisterCommand } from './register.js';
export { webhooksListCommand } from './list.js';
export { webhooksGetCommand } from './get.js';
export { webhooksUpdateCommand } from './update.js';
export { webhooksDeleteCommand } from './delete.js';
export { webhooksTestCommand } from './test.js';
export { webhooksLogsCommand } from './logs.js';

// Re-export input schemas for CLI/API validation
export { RegisterWebhookInputSchema } from './register.js';
export { ListWebhooksInputSchema } from './list.js';
export { GetWebhookInputSchema } from './get.js';
export { UpdateWebhookInputSchema } from './update.js';
export { DeleteWebhookInputSchema } from './delete.js';
export { TestWebhookInputSchema } from './test.js';
export { WebhookLogsInputSchema } from './logs.js';

import { registry } from '../registry.js';
import { webhooksDeleteCommand } from './delete.js';
import { webhooksGetCommand } from './get.js';
import { webhooksListCommand } from './list.js';
import { webhooksLogsCommand } from './logs.js';
import { webhooksRegisterCommand } from './register.js';
import { webhooksTestCommand } from './test.js';
import { webhooksUpdateCommand } from './update.js';

/**
 * Register all webhook commands
 */
export function registerWebhookCommands(): void {
	registry.register(webhooksRegisterCommand);
	registry.register(webhooksListCommand);
	registry.register(webhooksGetCommand);
	registry.register(webhooksUpdateCommand);
	registry.register(webhooksDeleteCommand);
	registry.register(webhooksTestCommand);
	registry.register(webhooksLogsCommand);
}
