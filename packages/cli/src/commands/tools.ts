/**
 * @fileoverview Tools command
 */

import type { Command } from 'commander';
import ora from 'ora';
import { type ConnectFlags, requireClient } from '../connection.js';
import { type OutputFormat, printError, printTools } from '../output.js';
import { matchesCategory } from '../tool-category.js';
import { headerOption } from './options.js';

interface ToolsOptions extends ConnectFlags {
	category?: string;
	format: OutputFormat;
	refresh?: boolean;
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
		.addOption(headerOption())
		.action(async (options: ToolsOptions) => {
			const client = await requireClient(options);

			const spinner = ora('Fetching tools...').start();

			try {
				let tools = options.refresh ? await client.refreshTools() : client.getTools();

				// Refresh if empty (first time)
				if (tools.length === 0) {
					tools = await client.refreshTools();
				}

				// Filter by category if specified
				const { category } = options;
				if (category) {
					tools = tools.filter((t) => matchesCategory(t, category));
				}

				spinner.stop();
				printTools(tools, { format: options.format });
			} catch (error) {
				spinner.fail('Failed to fetch tools');
				printError('Could not retrieve tools', error instanceof Error ? error : undefined);
				process.exit(1);
			}
		});
}
