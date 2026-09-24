/**
 * @fileoverview Batch command
 *
 * Execute multiple commands in a single request with partial success semantics.
 */

import type { BatchCommand, BatchOptions, BatchResult } from '@lushly-dev/afd-core';
import chalk from 'chalk';
import type { Command } from 'commander';
import ora from 'ora';
import { type ConnectFlags, requireClient } from '../connection.js';
import { formatConfidence, formatErrorSummary, type OutputFormat, printError } from '../output.js';
import { terminalText } from '../terminal.js';
import { headerOption } from './options.js';

interface BatchCliOptions extends ConnectFlags {
	stopOnError: boolean;
	timeout: string;
	parallel: string;
	format: OutputFormat;
	verbose?: boolean;
}

/** Read and normalize the batch argument: a JSON array or a path to a `.json` file. */
async function parseBatchCommands(commandsArg: string): Promise<BatchCommand[]> {
	let commands: unknown;
	if (commandsArg.endsWith('.json')) {
		const fs = await import('node:fs/promises');
		commands = JSON.parse(await fs.readFile(commandsArg, 'utf-8'));
	} else {
		commands = JSON.parse(commandsArg);
	}

	if (!Array.isArray(commands)) {
		throw new Error('Commands must be an array');
	}

	// Accept `name`/`args` as aliases of `command`/`input`.
	return commands.map((entry: unknown, index): BatchCommand => {
		const cmd = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<
			string,
			unknown
		>;
		const command = cmd.command ?? cmd.name;
		if (typeof command !== 'string' || command === '') {
			throw new Error(`Command at index ${index} is missing 'command' field`);
		}
		return {
			id: typeof cmd.id === 'string' ? cmd.id : `cmd-${index}`,
			command,
			input: (cmd.input ?? cmd.args ?? {}) as BatchCommand['input'],
		};
	});
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
		.addOption(headerOption())
		.action(async (commandsArg: string, options: BatchCliOptions) => {
			let commands: BatchCommand[];
			try {
				commands = await parseBatchCommands(commandsArg);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				printError(`Invalid commands format: ${msg}`);
				console.log();
				console.log(chalk.dim('Expected format:'));
				console.log(chalk.dim('  [{"command":"todo-create","input":{"title":"Task 1"}},...]'));
				console.log();
				console.log(chalk.dim('Or provide a JSON file path:'));
				console.log(chalk.dim('  afd batch ./commands.json'));
				return process.exit(1);
			}

			const client = await requireClient(options);

			const batchOptions: BatchOptions = {
				stopOnError: options.stopOnError,
				timeout: Number.parseInt(options.timeout, 10),
				parallelism: Number.parseInt(options.parallel, 10),
			};

			const spinner = ora(`Executing batch of ${commands.length} command(s)...`).start();

			try {
				const result = await client.batch(commands, batchOptions);
				spinner.stop();

				// Output result
				printBatchResult(result, {
					format: options.format,
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
 * Print batch result in the appropriate format. Every server-provided value is
 * passed through `terminalText` in text mode.
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
	console.log(`  Total:    ${terminalText(summary.total)}`);
	console.log(`  Success:  ${chalk.green(terminalText(summary.successCount))}`);
	if (summary.failureCount > 0) {
		console.log(`  Failed:   ${chalk.red(terminalText(summary.failureCount))}`);
	}
	if (summary.skippedCount > 0) {
		console.log(`  Skipped:  ${chalk.dim(terminalText(summary.skippedCount))}`);
	}

	// Timing
	console.log();
	console.log(chalk.bold('Timing:'));
	console.log(`  Total:    ${terminalText(timing.totalMs)}ms`);
	console.log(`  Average:  ${Number(timing.averageMs).toFixed(1)}ms/command`);

	// Confidence
	console.log();
	console.log(chalk.bold('Confidence:'), formatConfidence(result.confidence));

	// Reasoning
	if (result.reasoning) {
		console.log(chalk.dim(`  ${terminalText(result.reasoning)}`));
	}

	// Individual results (verbose mode)
	if (verbose && result.results.length > 0) {
		console.log();
		console.log(chalk.bold('Command Results:'));

		for (const cmdResult of result.results) {
			const status = cmdResult.result.success ? chalk.green('✓') : chalk.red('✗');
			const id = terminalText(cmdResult.id || `#${cmdResult.index}`);
			const command = terminalText(cmdResult.command);
			const duration = terminalText(cmdResult.durationMs);

			console.log();
			console.log(`  ${status} ${chalk.cyan(command)} ${chalk.dim(`(${id}, ${duration}ms)`)}`);

			if (cmdResult.result.success && cmdResult.result.data !== undefined) {
				const dataPreview = JSON.stringify(cmdResult.result.data);
				const truncated =
					dataPreview.length > 100 ? `${dataPreview.slice(0, 100)}...` : dataPreview;
				console.log(`    ${chalk.dim('Data:')} ${terminalText(truncated)}`);
			}

			if (!cmdResult.result.success && cmdResult.result.error) {
				console.log(`    ${chalk.red('Error:')} ${formatErrorSummary(cmdResult.result.error)}`);
				if (cmdResult.result.error.suggestion) {
					console.log(
						`    ${chalk.dim('Suggestion:')} ${terminalText(cmdResult.result.error.suggestion)}`
					);
				}
			}
		}
	}

	// Warnings
	if (result.warnings && result.warnings.length > 0) {
		console.log();
		console.log(chalk.yellow('Warnings:'));
		for (const warning of result.warnings) {
			console.log(
				`  ⚠ ${terminalText(`[${warning.code}] ${warning.message} (${warning.commandId})`)}`
			);
		}
	}

	// Error (batch-level failure)
	if (result.error) {
		console.log();
		console.log(chalk.red('Error:'), formatErrorSummary(result.error));
		if (result.error.suggestion) {
			console.log(chalk.dim('Suggestion:'), terminalText(result.error.suggestion));
		}
	}
}
