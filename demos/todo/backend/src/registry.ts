/**
 * @fileoverview Command Registry - Exportable without starting a server
 *
 * This is the KEY INNOVATION for in-process binding:
 * - Registry can be imported directly by co-located agents
 * - No server startup required for direct execution
 * - Same registry powers both MCP server and direct calls
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import { allCommands } from './commands/index.js';

/**
 * Command metadata for trust/safety checks.
 */
export interface CommandMetadata {
	name: string;
	description: string;
	category?: string;
	tags?: string[];
	mutation?: boolean;
}

/**
 * Command definition with execute capability.
 */
interface ExecutableCommand {
	name: string;
	description: string;
	handler: (input: unknown) => Promise<CommandResult<unknown>>;
	metadata: CommandMetadata;
}

/**
 * Command registry that can execute commands directly.
 *
 * This is exported as a library so agents can:
 * 1. Import the registry directly (no server needed)
 * 2. Call commands with zero transport overhead
 * 3. Get full type safety on inputs/outputs
 */
export class CommandRegistry {
	private commands: Map<string, ExecutableCommand> = new Map();

	constructor() {
		// Register all commands with metadata
		for (const cmd of allCommands) {
			this.commands.set(cmd.name, {
				name: cmd.name,
				description: cmd.description,
				handler: cmd.handler as (input: unknown) => Promise<CommandResult<unknown>>,
				metadata: {
					name: cmd.name,
					description: cmd.description,
					category: cmd.category,
					tags: cmd.tags,
					mutation: cmd.mutation,
				},
			});
		}
	}

	/**
	 * Execute a command directly.
	 * This is the zero-overhead path for co-located agents.
	 */
	async execute<T>(name: string, input: unknown = {}): Promise<CommandResult<T>> {
		const command = this.commands.get(name);

		if (!command) {
			return {
				success: false,
				error: {
					code: 'COMMAND_NOT_FOUND',
					message: `Unknown command: ${name}`,
					suggestion: `Available commands: ${this.listCommandNames().join(', ')}`,
				},
			};
		}

		try {
			const result = await command.handler(input);
			return result as CommandResult<T>;
		} catch (err) {
			return {
				success: false,
				error: {
					code: 'EXECUTION_ERROR',
					message: err instanceof Error ? err.message : 'Command execution failed',
				},
			};
		}
	}

	/**
	 * List all available command names.
	 */
	listCommandNames(): string[] {
		return Array.from(this.commands.keys());
	}

	/**
	 * List all commands with metadata.
	 */
	listCommands(): Array<{ name: string; description: string }> {
		return Array.from(this.commands.values()).map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
		}));
	}

	/**
	 * Check if a command exists.
	 */
	hasCommand(name: string): boolean {
		return this.commands.has(name);
	}

	/**
	 * Get command metadata for trust/safety checks.
	 * Used by streaming layer to include metadata in tool_end events.
	 */
	getCommandMetadata(name: string): CommandMetadata | undefined {
		const command = this.commands.get(name);
		return command?.metadata;
	}
}

/**
 * Singleton registry instance.
 * Import this for direct command execution.
 *
 * @example
 * ```typescript
 * import { registry } from './registry.js';
 *
 * // Direct execution - no server, no transport overhead
 * const result = await registry.execute('todo-create', { title: 'Fast!' });
 * ```
 */
export const registry = new CommandRegistry();
