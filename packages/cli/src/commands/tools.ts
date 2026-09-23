/**
 * @fileoverview Tools command
 */

import type { McpTool } from '@lushly-dev/afd-core';
import type { Command } from 'commander';
import ora from 'ora';
import { ensureConnected } from '../connection.js';
import { type OutputFormat, printError, printTools } from '../output.js';

/**
 * Whether a tool belongs to a category.
 *
 * AFD servers advertise `_meta.category`; tools without one fall back to the
 * kebab-case `domain-` name prefix (e.g. `todo` matches `todo-create`).
 */
export function matchesCategory(tool: McpTool, category: string): boolean {
	const advertised = tool._meta?.category;
	return advertised !== undefined ? advertised === category : tool.name.startsWith(`${category}-`);
}

/**
 * Register the tools command.
 */
export function registerToolsCommand(program: Command): void {
	program
		.command('tools')
		.description('List available tools from the connected server')
		.option('-c, --category <name>', 'Filter by _meta.category (or "<name>-" name prefix)')
		.option('-f, --format <format>', 'Output format (json, text)', 'text')
		.option('--refresh', 'Force refresh from server')
		.action(async (options) => {
			const client = await ensureConnected();

			if (!client) {
				printError('Not connected. Run "afd connect <url>" first.');
				process.exit(1);
			}

			const spinner = ora('Fetching tools...').start();

			try {
				let tools = options.refresh ? await client.refreshTools() : client.getTools();

				// Refresh if empty (first time)
				if (tools.length === 0) {
					tools = await client.refreshTools();
				}

				// Filter by category if specified
				if (options.category) {
					tools = tools.filter((t) => matchesCategory(t, options.category));
				}

				spinner.stop();
				printTools(tools, { format: options.format as OutputFormat });
			} catch (error) {
				spinner.fail('Failed to fetch tools');
				printError('Could not retrieve tools', error instanceof Error ? error : undefined);
				process.exit(1);
			}
		});
}
