/**
 * MCP Tool Generator
 *
 * Auto-generates MCP tool definitions from the Violet command registry.
 * This ensures all commands are automatically exposed to AI agents.
 */

import { registry, toJsonSchema } from '@lushly-dev/violet-afd';

/**
 * MCP Tool definition
 */
export interface McpTool {
	/** Tool name (matches command name) */
	name: string;

	/** Human-readable description */
	description: string;

	/** JSON Schema for input validation */
	inputSchema: Record<string, unknown>;
}

/**
 * Generate MCP tools from the command registry
 *
 * @returns Array of MCP tool definitions
 */
export function generateTools(): McpTool[] {
	const commands = registry.list();

	return commands.map((cmd) => {
		return {
			name: cmd.name,
			description: cmd.description,
			inputSchema: registry.getInputJsonSchema(cmd.name) ?? { type: 'object', properties: {} },
		};
	});
}

/**
 * Get a single tool definition by name
 */
export function getTool(name: string): McpTool | undefined {
	const command = registry.get(name);
	if (!command) return undefined;

	return {
		name: command.name,
		description: command.description,
		inputSchema: toJsonSchema(command.inputSchema),
	};
}
