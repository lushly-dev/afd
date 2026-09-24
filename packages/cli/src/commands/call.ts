/**
 * @fileoverview Call command
 */

import type { Command } from 'commander';
import ora from 'ora';
import { describeArgsError, parseToolArgs } from '../args.js';
import type { CliTransport } from '../config.js';
import { type ConnectFlags, requireClient } from '../connection.js';
import { type OutputFormat, printError, printResult } from '../output.js';
import { terminalText } from '../terminal.js';
import { headerOption, transportOption } from './options.js';

interface CallOptions extends ConnectFlags {
	connect?: string;
	transport?: CliTransport;
	timeout?: string;
	format: OutputFormat;
	verbose?: boolean;
}

/**
 * Register the call command.
 */
export function registerCallCommand(program: Command): void {
	program
		.command('call')
		.description('Call a tool/command')
		.argument('<name>', 'Tool name (e.g., document-create)')
		.argument('[args]', 'JSON object or key=value pairs (quote values with spaces)')
		.option('--connect <url>', 'Use an MCP server URL for this call without changing saved config')
		.addOption(
			transportOption(
				'Transport type for --connect (default: http)',
				undefined,
				'--transport <type>'
			)
		)
		.option('--timeout <ms>', 'Connection timeout in milliseconds')
		.addOption(headerOption())
		.option('-f, --format <format>', 'Output format (json, text)', 'text')
		.option('-v, --verbose', 'Show detailed output including reasoning and sources')
		.action(async (name: string, args: string | undefined, options: CallOptions) => {
			let parsedArgs: Record<string, unknown>;
			try {
				parsedArgs = parseToolArgs(args);
			} catch (error) {
				printError(describeArgsError(error));
				return process.exit(1);
			}

			const client = await requireClient(options, {
				url: options.connect,
				transport: options.transport,
				timeout: options.timeout ? Number.parseInt(options.timeout, 10) : undefined,
			});

			const spinner = ora(`Calling ${terminalText(name)}...`).start();

			try {
				const result = await client.call(name, parsedArgs);
				spinner.stop();

				printResult(result, {
					format: options.format,
					verbose: options.verbose,
				});

				// Exit with error code if command failed
				if (!result.success) {
					process.exit(1);
				}
			} catch (error) {
				spinner.fail(`Failed to call ${terminalText(name)}`);
				printError('Command execution failed', error instanceof Error ? error : undefined);
				process.exit(1);
			}
		});
}
