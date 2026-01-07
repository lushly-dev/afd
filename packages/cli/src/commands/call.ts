/**
 * @fileoverview Call command
 */

import type { Command } from 'commander';
import ora from 'ora';
import { createClient } from '@lushly-dev/afd-client';
import { getClient, setClient } from './connect.js';
import { getConfig } from '../config.js';
import { printError, printResult, type OutputFormat } from '../output.js';

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
 * Register the call command.
 */
export function registerCallCommand(program: Command): void {
	program
		.command('call')
		.description('Call a tool/command')
		.argument('<name>', 'Tool name (e.g., document.create)')
		.argument('[args]', 'JSON arguments or key=value pairs')
		.option('-f, --format <format>', 'Output format (json, text)', 'text')
		.option('-v, --verbose', 'Show detailed output including reasoning and sources')
		.action(async (name: string, args: string | undefined, options) => {
			const client = await ensureConnected();

			if (!client) {
				printError('Not connected. Run "afd connect <url>" first.');
				process.exit(1);
			}

			// Parse arguments
			let parsedArgs: Record<string, unknown> = {};

			if (args) {
				try {
					// Try JSON first
					if (args.startsWith('{')) {
						parsedArgs = JSON.parse(args);
					} else {
						// Parse key=value pairs
						parsedArgs = parseKeyValuePairs(args);
					}
				} catch (error) {
					printError('Invalid arguments format. Use JSON or key=value pairs.');
					process.exit(1);
				}
			}

			const spinner = ora(`Calling ${name}...`).start();

			try {
				const result = await client.call(name, parsedArgs);
				spinner.stop();

				printResult(result, {
					format: options.format as OutputFormat,
					verbose: options.verbose,
				});

				// Exit with error code if command failed
				if (!result.success) {
					process.exit(1);
				}
			} catch (error) {
				spinner.fail(`Failed to call ${name}`);
				printError(
					'Command execution failed',
					error instanceof Error ? error : undefined
				);
				process.exit(1);
			}
		});
}

/**
 * Parse key=value pairs into an object.
 */
function parseKeyValuePairs(input: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const pairs = input.split(/\s+/);

	for (const pair of pairs) {
		const [key, ...valueParts] = pair.split('=');
		if (key && valueParts.length > 0) {
			const value = valueParts.join('=');
			// Try to parse as JSON for complex values
			try {
				result[key] = JSON.parse(value);
			} catch {
				result[key] = value;
			}
		}
	}

	return result;
}
