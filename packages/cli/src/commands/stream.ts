/**
 * @fileoverview Stream command
 *
 * Execute a command with streaming results and real-time progress.
 */

import type { StreamChunk } from '@lushly-dev/afd-core';
import { isCompleteChunk, isDataChunk, isErrorChunk, isProgressChunk } from '@lushly-dev/afd-core';
import chalk from 'chalk';
import type { Command } from 'commander';
import { describeArgsError, parseToolArgs } from '../args.js';
import { type ConnectFlags, requireClient } from '../connection.js';
import {
	formatConfidence,
	formatErrorSummary,
	formatValue,
	getProgressBar,
	type OutputFormat,
	printError,
} from '../output.js';
import { terminalText } from '../terminal.js';
import { headerOption } from './options.js';

interface StreamOptions extends ConnectFlags {
	timeout: string;
	format: OutputFormat;
	progress: boolean;
}

/**
 * Register the stream command.
 */
export function registerStreamCommand(program: Command): void {
	program
		.command('stream')
		.description('Execute a command with streaming results (Ctrl+C to cancel)')
		.argument('<name>', 'Command name (e.g., export-run)')
		.argument('[args]', 'JSON object or key=value pairs (quote values with spaces)')
		.option('-t, --timeout <ms>', 'Timeout in milliseconds', '60000')
		.option('-f, --format <format>', 'Output format (json, text)', 'text')
		.option('--no-progress', 'Hide progress updates')
		.addOption(headerOption())
		.action(async (name: string, args: string | undefined, options: StreamOptions) => {
			let parsedArgs: Record<string, unknown>;
			try {
				parsedArgs = parseToolArgs(args);
			} catch (error) {
				printError(describeArgsError(error));
				return process.exit(1);
			}

			const client = await requireClient(options);

			const timeout = Number.parseInt(options.timeout, 10);
			const format = options.format;
			const showProgress = options.progress !== false;

			// Setup abort controller for Ctrl+C
			const controller = new AbortController();
			let cancelled = false;

			const cleanup = () => {
				cancelled = true;
				controller.abort();
			};

			process.on('SIGINT', cleanup);
			process.on('SIGTERM', cleanup);

			let lastProgressLine = '';

			try {
				if (format === 'text' && showProgress) {
					console.log(chalk.dim(`Streaming ${terminalText(name)}... (Ctrl+C to cancel)`));
					console.log();
				}

				for await (const chunk of client.stream(name, parsedArgs, {
					signal: controller.signal,
					timeout,
				})) {
					if (format === 'json') {
						console.log(JSON.stringify(chunk));
						continue;
					}

					// Text format
					handleTextChunk(chunk, {
						showProgress,
						setLastProgressLine: (line) => {
							lastProgressLine = line;
						},
						clearProgress: () => {
							if (lastProgressLine) {
								process.stdout.write(`\r${' '.repeat(lastProgressLine.length)}\r`);
								lastProgressLine = '';
							}
						},
					});
				}

				// Cleanup
				process.off('SIGINT', cleanup);
				process.off('SIGTERM', cleanup);

				if (cancelled) {
					console.log();
					console.log(chalk.yellow('⚠ Stream cancelled by user'));
					process.exit(130); // Standard Ctrl+C exit code
				}
			} catch (error) {
				process.off('SIGINT', cleanup);
				process.off('SIGTERM', cleanup);

				if (cancelled) {
					console.log();
					console.log(chalk.yellow('⚠ Stream cancelled by user'));
					process.exit(130);
				}

				printError('Stream failed', error instanceof Error ? error : undefined);
				process.exit(1);
			}
		});
}

/**
 * Handle a stream chunk in text format. Every server-provided value, including
 * string data, is passed through `terminalText`.
 */
function handleTextChunk<T>(
	chunk: StreamChunk<T>,
	options: {
		showProgress: boolean;
		setLastProgressLine: (line: string) => void;
		clearProgress: () => void;
	}
): void {
	const { showProgress, clearProgress, setLastProgressLine } = options;

	if (isProgressChunk(chunk)) {
		if (!showProgress) return;

		// Clear previous progress line
		clearProgress();

		const percent = Math.round(chunk.progress * 100);
		const bar = getProgressBar(chunk.progress);
		const message = terminalText(chunk.message || '');
		const items =
			chunk.itemsProcessed !== undefined && chunk.itemsTotal !== undefined
				? terminalText(` (${chunk.itemsProcessed}/${chunk.itemsTotal})`)
				: '';

		const line = `${bar} ${percent}%${items} ${chalk.dim(message)}`;
		process.stdout.write(line);
		setLastProgressLine(line);
	} else if (isDataChunk(chunk)) {
		// Clear any progress line
		clearProgress();

		// Print the data
		const data = chunk.data;
		if (typeof data === 'string') {
			process.stdout.write(terminalText(data));
		} else {
			console.log(formatValue(data));
		}

		if (chunk.isLast) {
			console.log();
		}
	} else if (isCompleteChunk(chunk)) {
		clearProgress();
		console.log();
		console.log(chalk.green('✓ Stream complete'));

		if (chunk.totalChunks > 0) {
			console.log(chalk.dim(`  Chunks: ${terminalText(chunk.totalChunks)}`));
		}
		console.log(chalk.dim(`  Duration: ${terminalText(chunk.totalDurationMs)}ms`));

		if (chunk.confidence !== undefined) {
			console.log(chalk.dim('  Confidence:'), formatConfidence(chunk.confidence));
		}

		if (chunk.reasoning) {
			console.log(chalk.dim(`  ${terminalText(chunk.reasoning)}`));
		}

		if (chunk.data !== undefined) {
			console.log();
			console.log(chalk.bold('Final Result:'));
			console.log(terminalText(JSON.stringify(chunk.data, null, 2)));
		}
	} else if (isErrorChunk(chunk)) {
		clearProgress();
		console.log();
		console.log(chalk.red('✗ Stream error'));
		console.log(`  ${chalk.red('Error:')} ${formatErrorSummary(chunk.error)}`);

		if (chunk.error.suggestion) {
			console.log(`  ${chalk.dim('Suggestion:')} ${terminalText(chunk.error.suggestion)}`);
		}

		if (chunk.chunksBeforeError > 0) {
			console.log(chalk.dim(`  Chunks before error: ${terminalText(chunk.chunksBeforeError)}`));
		}

		if (chunk.recoverable) {
			console.log(chalk.dim('  This error may be recoverable'));
			if (chunk.resumeFrom !== undefined) {
				console.log(chalk.dim(`  Resume from: ${terminalText(chunk.resumeFrom)}`));
			}
		}

		process.exit(1);
	}
}
