/**
 * @fileoverview Batch command
 *
 * Execute multiple commands in a single request with partial success semantics.
 */

import { createClient } from '@afd/client';
import type { BatchCommand, BatchOptions, BatchResult } from '@afd/core';
import chalk from 'chalk';
import type { Command } from 'commander';
import ora from 'ora';
import { getConfig } from '../config.js';
import { type OutputFormat, printError } from '../output.js';
import { getClient, setClient } from './connect.js';

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
		transport: 'http',
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
 * Register the batch command.
 */
export function registerBatchCommand(program: Command): void {
	program
		.command('batch')
		.description('Execute multiple commands in a single batch request')
		.argument(
			'<commands>',
			'JSON array of commands: [{"command":"name","input":{}},...] or file path'
		)
		.option('-s, --stop-on-error', 'Stop execution on first error', false)
		.option('-t, --timeout <ms>', 'Timeout for entire batch in milliseconds', '30000')
		.option('-p, --parallel <n>', 'Maximum parallel commands (1 = sequential)', '1')
		.option('-f, --format <format>', 'Output format (json, text)', 'text')
		.option('-v, --verbose', 'Show detailed output for each command')
		.action(async (commandsArg: string, options) => {
			const client = await ensureConnected();

			if (!client) {
				printError('Not connected. Run "afd connect <url>" first.');
				process.exit(1);
			}

			// Parse commands
			let commands: BatchCommand[];

			try {
				// Check if it's a file path
				if (commandsArg.endsWith('.json')) {
					const fs = await import('node:fs/promises');
					const content = await fs.readFile(commandsArg, 'utf-8');
					commands = JSON.parse(content);
				} else {
					// Parse as JSON array
					commands = JSON.parse(commandsArg);
				}

				// Validate structure
				if (!Array.isArray(commands)) {
					throw new Error('Commands must be an array');
				}

				// Normalize command format
				commands = commands.map((cmd, i) => {
					// Support alternative input formats
					const cmdAny = cmd as unknown as Record<string, unknown>;
					return {
						id: cmd.id ?? `cmd-${i}`,
						command: cmd.command ?? (cmdAny.name as string) ?? '',
						input: cmd.input ?? (cmdAny.args as unknown) ?? {},
					};
				});

				// Validate each command has a command name
				for (const cmd of commands) {
					if (!cmd.command) {
						throw new Error(`Command at index ${commands.indexOf(cmd)} is missing 'command' field`);
					}
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				printError(`Invalid commands format: ${msg}`);
				console.log();
				console.log(chalk.dim('Expected format:'));
				console.log(chalk.dim('  [{"command":"todo.create","input":{"title":"Task 1"}},...]'));
				console.log();
				console.log(chalk.dim('Or provide a JSON file path:'));
				console.log(chalk.dim('  afd batch ./commands.json'));
				process.exit(1);
			}

			const batchOptions: BatchOptions = {
				stopOnError: options.stopOnError,
				timeout: Number.parseInt(options.timeout, 10),
				parallelism: Number.parseInt(options.parallel, 10),
			};

			const spinner = ora(`Executing batch of ${commands.length} command(s)...`).start();
			const startTime = Date.now();

			try {
				const result = await client.batch(commands, batchOptions);
				spinner.stop();

				// Output result
				printBatchResult(result, {
					format: options.format as OutputFormat,
					verbose: options.verbose,
				});

				// Exit with appropriate code
				if (!result.success) {
					process.exit(1);
				} else if (result.summary.failureCount > 0) {
					// Partial success - exit code 2
					process.exit(2);
				}
			} catch (error) {
				spinner.fail('Batch execution failed');
				printError('Batch execution error', error instanceof Error ? error : undefined);
				process.exit(1);
			}
		});
}

/**
 * Print batch result in the appropriate format.
 */
function printBatchResult<T>(
	result: BatchResult<T>,
	options: {
		format?: OutputFormat;
		verbose?: boolean;
	}
): void {
	const { format = 'text', verbose = false } = options;

	if (format === 'json') {
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	// Text format
	const { summary, timing } = result;

	// Header with overall status
	if (result.success && summary.failureCount === 0) {
		console.log(chalk.green('✓ Batch completed successfully'));
	} else if (result.success && summary.failureCount > 0) {
		console.log(chalk.yellow('⚠ Batch completed with partial failures'));
	} else {
		console.log(chalk.red('✗ Batch failed'));
	}

	// Summary stats
	console.log();
	console.log(chalk.bold('Summary:'));
	console.log(`  Total:    ${summary.total}`);
	console.log(`  Success:  ${chalk.green(summary.successCount.toString())}`);
	if (summary.failureCount > 0) {
		console.log(`  Failed:   ${chalk.red(summary.failureCount.toString())}`);
	}
	if (summary.skippedCount > 0) {
		console.log(`  Skipped:  ${chalk.dim(summary.skippedCount.toString())}`);
	}

	// Timing
	console.log();
	console.log(chalk.bold('Timing:'));
	console.log(`  Total:    ${timing.totalMs}ms`);
	console.log(`  Average:  ${timing.averageMs.toFixed(1)}ms/command`);

	// Confidence
	console.log();
	const confidenceBar = getConfidenceBar(result.confidence);
	console.log(chalk.bold('Confidence:'), confidenceBar, `${Math.round(result.confidence * 100)}%`);

	// Reasoning
	if (result.reasoning) {
		console.log(chalk.dim(`  ${result.reasoning}`));
	}

	// Individual results (verbose mode)
	if (verbose && result.results.length > 0) {
		console.log();
		console.log(chalk.bold('Command Results:'));

		for (const cmdResult of result.results) {
			const status = cmdResult.result.success ? chalk.green('✓') : chalk.red('✗');
			const id = cmdResult.id || `#${cmdResult.index}`;

			console.log();
			console.log(
				`  ${status} ${chalk.cyan(cmdResult.command)} ${chalk.dim(`(${id}, ${cmdResult.durationMs}ms)`)}`
			);

			if (cmdResult.result.success && cmdResult.result.data !== undefined) {
				const dataPreview = JSON.stringify(cmdResult.result.data);
				const truncated =
					dataPreview.length > 100 ? `${dataPreview.slice(0, 100)}...` : dataPreview;
				console.log(`    ${chalk.dim('Data:')} ${truncated}`);
			}

			if (!cmdResult.result.success && cmdResult.result.error) {
				console.log(
					`    ${chalk.red('Error:')} [${cmdResult.result.error.code}] ${cmdResult.result.error.message}`
				);
				if (cmdResult.result.error.suggestion) {
					console.log(`    ${chalk.dim('Suggestion:')} ${cmdResult.result.error.suggestion}`);
				}
			}
		}
	}

	// Warnings
	if (result.warnings && result.warnings.length > 0) {
		console.log();
		console.log(chalk.yellow('Warnings:'));
		for (const warning of result.warnings) {
			console.log(`  ⚠ [${warning.code}] ${warning.message} (${warning.commandId})`);
		}
	}

	// Error (batch-level failure)
	if (result.error) {
		console.log();
		console.log(chalk.red('Error:'), `[${result.error.code}]`, result.error.message);
		if (result.error.suggestion) {
			console.log(chalk.dim('Suggestion:'), result.error.suggestion);
		}
	}
}

/**
 * Create a visual confidence bar.
 */
function getConfidenceBar(confidence: number): string {
	const filled = Math.round(confidence * 10);
	const empty = 10 - filled;

	let color: typeof chalk.green;
	if (confidence >= 0.8) {
		color = chalk.green;
	} else if (confidence >= 0.5) {
		color = chalk.yellow;
	} else {
		color = chalk.red;
	}

	return color('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
}
