/**
 * Node Commands
 *
 * Commands for managing nodes in the design system tree.
 */

export * from './create.js';
export * from './get.js';
export * from './list.js';
export * from './update.js';
export * from './delete.js';
export * from './graph.js';
export * from './scope.js';

import { registry } from '../registry.js';
import { nodeCreateCommand } from './create.js';
import { nodeDeleteCommand } from './delete.js';
import { nodeGetCommand } from './get.js';
import { nodesGraphCommand } from './graph.js';
import { nodeListCommand } from './list.js';
import { nodeUpdateCommand } from './update.js';

/**
 * Register all node commands
 */
export function registerNodeCommands(): void {
	registry.register(nodeCreateCommand);
	registry.register(nodeGetCommand);
	registry.register(nodeListCommand);
	registry.register(nodeUpdateCommand);
	registry.register(nodeDeleteCommand);
	registry.register(nodesGraphCommand);
}
