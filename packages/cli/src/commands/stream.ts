/**
 * @fileoverview Stream command
 *
 * Execute a command with streaming results and real-time progress.
 */

import { type McpClient, createClient } from '@lushly-dev/afd-client';
import type { StreamChunk } from '@lushly-dev/afd-core';
import { isCompleteChunk, isDataChunk, isErrorChunk, isProgressChunk } from '@lushly-dev/afd-core';
import chalk from 'chalk';
import type { Command } from 'commander';
import { getConfig } from '../config.js';
import { type OutputFormat, printError } from '../output.js';
import { getClient, setClient } from './connect.js';

/**
 * Ensure we have a connected client, auto-connecting if needed.
 */
async function ensureConnected(): Promise<McpClient | null> {
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
 * Register the stream command.
 */
export function registerStreamCommand(program: Command): void {
	program
		.command('stream')
		.description('Execute a command with streaming results (Ctrl+C to cancel)')
		.argument('<name>', 'Command name (e.g., export.run)')
		.argument('[args]', 'JSON arguments or key=value pairs')
		.option('-t, --timeout <ms>', 'Timeout in milliseconds', '60000')
		.option('-f, --format <format>', 'Output format (json, text)', 'text')
		.option('--no-progress', 'Hide progress updates')
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
					if (args.startsWith('{')) {
						parsedArgs = JSON.parse(args);
					} else {
						parsedArgs = parseKeyValuePairs(args);
					}
				} catch (_error) {
					printError('Invalid arguments format. Use JSON or key=value pairs.');
					process.exit(1);
				}
			}

			const timeout = Number.parseInt(options.timeout, 10);
			const format = options.format as OutputFormat;
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
					console.log(chalk.dim(`Streaming ${name}... (Ctrl+C to cancel)`));
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
						lastProgressLine,
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
 * Handle a stream chunk in text format.
 */
function handleTextChunk<T>(
	chunk: StreamChunk<T>,
	options: {
		showProgress: boolean;
		lastProgressLine: string;
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
		const message = chunk.message || '';
		const items =
			chunk.itemsProcessed !== undefined && chunk.itemsTotal !== undefined
				? ` (${chunk.itemsProcessed}/${chunk.itemsTotal})`
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
			process.stdout.write(data);
		} else {
			console.log(JSON.stringify(data, null, 2));
		}

		if (chunk.isLast) {
			console.log();
		}
	} else if (isCompleteChunk(chunk)) {
		clearProgress();
		console.log();
		console.log(chalk.green('✓ Stream complete'));

		if (chunk.totalChunks > 0) {
			console.log(chalk.dim(`  Chunks: ${chunk.totalChunks}`));
		}
		console.log(chalk.dim(`  Duration: ${chunk.totalDurationMs}ms`));

		if (chunk.confidence !== undefined) {
			const bar = getConfidenceBar(chunk.confidence);
			console.log(chalk.dim('  Confidence:'), bar, `${Math.round(chunk.confidence * 100)}%`);
		}

		if (chunk.reasoning) {
			console.log(chalk.dim(`  ${chunk.reasoning}`));
		}

		if (chunk.data !== undefined) {
			console.log();
			console.log(chalk.bold('Final Result:'));
			console.log(JSON.stringify(chunk.data, null, 2));
		}
	} else if (isErrorChunk(chunk)) {
		clearProgress();
		console.log();
		console.log(chalk.red('✗ Stream error'));
		console.log(`  ${chalk.red('Error:')} [${chunk.error.code}] ${chunk.error.message}`);

		if (chunk.error.suggestion) {
			console.log(`  ${chalk.dim('Suggestion:')} ${chunk.error.suggestion}`);
		}

		if (chunk.chunksBeforeError > 0) {
			console.log(chalk.dim(`  Chunks before error: ${chunk.chunksBeforeError}`));
		}

		if (chunk.recoverable) {
			console.log(chalk.dim('  This error may be recoverable'));
			if (chunk.resumeFrom !== undefined) {
				console.log(chalk.dim(`  Resume from: ${chunk.resumeFrom}`));
			}
		}

		process.exit(1);
	}
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
			try {
				result[key] = JSON.parse(value);
			} catch {
				result[key] = value;
			}
		}
	}

	return result;
}

/**
 * Create a visual progress bar.
 */
function getProgressBar(progress: number): string {
	const width = 20;
	const filled = Math.round(progress * width);
	const empty = width - filled;

	return (
		chalk.cyan('[') +
		chalk.cyan('█'.repeat(filled)) +
		chalk.dim('░'.repeat(empty)) +
		chalk.cyan(']')
	);
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
