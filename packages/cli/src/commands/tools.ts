/**
 * @fileoverview Tools command
 */

import type { Command } from 'commander';
import ora from 'ora';
import { createClient } from '@afd/client';
import { getClient, setClient } from './connect.js';
import { getConfig } from '../config.js';
import { printError, printTools, type OutputFormat } from '../output.js';

/**
 * Ensure we have a connected client, auto-connecting if needed.
 */
async function ensureConnected() {
	let client = getClient();
	
	if (client?.isConnected()) {
		return client;
	}

	// Try to auto-connect using saved URL
	const config = getConfig();
	if (!config.serverUrl) {
		return null;
	}

	client = createClient({
		url: config.serverUrl,
		transport: 'http', // Use HTTP for CLI (more reliable)
		timeout: config.timeout ?? 30000,
	});

	try {
		await client.connect();
		setClient(client);
		return client;
	} catch {
		return null;
	}
}

/**
 * Register the tools command.
 */
export function registerToolsCommand(program: Command): void {
	program
		.command('tools')
		.description('List available tools from the connected server')
		.option('-c, --category <name>', 'Filter by category')
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
				let tools = options.refresh
					? await client.refreshTools()
					: client.getTools();

				// Refresh if empty (first time)
				if (tools.length === 0) {
					tools = await client.refreshTools();
				}

				// Filter by category if specified
				if (options.category) {
					tools = tools.filter((t) =>
						t.name.startsWith(`${options.category}.`)
					);
				}

				spinner.stop();
				printTools(tools, { format: options.format as OutputFormat });
			} catch (error) {
				spinner.fail('Failed to fetch tools');
				printError(
					'Could not retrieve tools',
					error instanceof Error ? error : undefined
				);
				process.exit(1);
			}
		});
}
