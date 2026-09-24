/**
 * @fileoverview Output formatting utilities
 *
 * Text output passes every server-provided string through
 * `sanitizeForTerminal`, so a server cannot send escape sequences to the
 * user's terminal. JSON output is printed with `JSON.stringify`, which escapes
 * control characters.
 */

import type { McpClient } from '@lushly-dev/afd-client';
import type { CommandError, CommandResult, McpTool } from '@lushly-dev/afd-core';
import { isFailure, isSuccess } from '@lushly-dev/afd-core';
import chalk from 'chalk';
import { redactUrl } from './credentials.js';
import { sanitizeForTerminal, terminalText } from './terminal.js';
import { toolCategory } from './tool-category.js';

export type OutputFormat = 'json' | 'text' | 'table';

/**
 * Output options.
 */
export interface OutputOptions {
	format?: OutputFormat;
	verbose?: boolean;
	color?: boolean;
}

/**
 * Format and print a CommandResult.
 */
export function printResult<T>(result: CommandResult<T>, options: OutputOptions = {}): void {
	const { format = 'text', verbose = false } = options;

	if (format === 'json') {
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	// Text format
	if (isSuccess(result)) {
		console.log(chalk.green('✓ Success'));

		if (result.data !== undefined) {
			console.log();
			console.log(chalk.bold('Data:'));
			console.log(formatValue(result.data));
		}

		// Show UX fields if present
		if (result.confidence !== undefined) {
			console.log();
			console.log(chalk.dim('Confidence:'), formatConfidence(result.confidence));
		}

		if (result.reasoning && verbose) {
			console.log();
			console.log(chalk.dim('Reasoning:'), terminalText(result.reasoning));
		}

		if (result.sources && result.sources.length > 0 && verbose) {
			console.log();
			console.log(chalk.dim('Sources:'));
			for (const source of result.sources) {
				const location = source.location ? ` (${source.location})` : '';
				console.log(`  - ${terminalText(`${source.title || source.type}${location}`)}`);
			}
		}

		if (result.warnings && result.warnings.length > 0) {
			console.log();
			for (const warning of result.warnings) {
				console.log(chalk.yellow(`⚠ ${terminalText(warning.message)}`));
			}
		}
	} else if (isFailure(result)) {
		console.log(chalk.red('✗ Failed'));
		console.log();
		console.log(chalk.bold('Error:'), formatErrorSummary(result.error));

		if (result.error.suggestion) {
			console.log();
			console.log(chalk.dim('Suggestion:'), terminalText(result.error.suggestion));
		}

		if (result.error.retryable) {
			console.log(chalk.dim('(This error may be resolved by retrying)'));
		}

		if (verbose && result.error.details) {
			console.log();
			console.log(chalk.dim('Details:'));
			console.log(formatValue(result.error.details));
		}
	}
}

/**
 * Format a list of tools, grouped by `_meta.category` (else the kebab-case
 * `domain-` prefix of the name).
 */
export function printTools(tools: McpTool[], options: OutputOptions = {}): void {
	const { format = 'text' } = options;

	if (format === 'json') {
		console.log(JSON.stringify(tools, null, 2));
		return;
	}

	if (tools.length === 0) {
		console.log(chalk.dim('No tools available'));
		return;
	}

	console.log(chalk.bold(`Available Tools (${tools.length}):`));
	console.log();

	const grouped = new Map<string, McpTool[]>();
	for (const tool of tools) {
		const category = toolCategory(tool);
		const group = grouped.get(category) ?? [];
		group.push(tool);
		grouped.set(category, group);
	}

	for (const [category, categoryTools] of grouped) {
		console.log(chalk.cyan(`  ${terminalText(category)}/`));
		for (const tool of categoryTools) {
			console.log(`    ${chalk.white(terminalText(tool.name))}`);
			if (tool.description) {
				console.log(`      ${chalk.dim(terminalText(tool.description))}`);
			}
		}
		console.log();
	}
}

/**
 * Print connection status. Credentials in the URL are redacted.
 */
export function printStatus(status: {
	connected: boolean;
	url?: string | null;
	serverName?: string;
	serverVersion?: string;
}): void {
	if (status.connected) {
		console.log(chalk.green('● Connected'));
		if (status.url) {
			console.log(chalk.dim('  URL:'), terminalText(redactUrl(status.url)));
		}
		if (status.serverName) {
			console.log(
				chalk.dim('  Server:'),
				terminalText(`${status.serverName} v${status.serverVersion || '?'}`)
			);
		}
	} else {
		console.log(chalk.dim('○ Not connected'));
	}
}

/** Print the status of a client, or "Not connected" without one. */
export function printClientStatus(client: Pick<McpClient, 'getStatus'> | null): void {
	if (!client) {
		printStatus({ connected: false });
		return;
	}
	const status = client.getStatus();
	printStatus({
		connected: status.state === 'connected',
		url: status.url,
		serverName: status.serverInfo?.name,
		serverVersion: status.serverInfo?.version,
	});
}

/**
 * Print an error message. Both the message and the error's own message may
 * carry server text, so both are sanitized.
 */
export function printError(message: string, error?: Error): void {
	console.error(chalk.red('Error:'), sanitizeForTerminal(message));
	if (error?.message && error.message !== message) {
		console.error(chalk.dim(terminalText(error.message)));
	}
}

/**
 * Print a success message.
 */
export function printSuccess(message: string): void {
	console.log(chalk.green('✓'), sanitizeForTerminal(message));
}

/**
 * Print an info message.
 */
export function printInfo(message: string): void {
	console.log(chalk.blue('ℹ'), sanitizeForTerminal(message));
}

/**
 * Print a warning message.
 */
export function printWarning(message: string): void {
	console.log(chalk.yellow('⚠'), sanitizeForTerminal(message));
}

/**
 * Format a value for display. Strings print as they are; anything else as
 * indented JSON. Either way the result is safe for the terminal.
 */
export function formatValue(value: unknown, indent = 2): string {
	return terminalText(typeof value === 'string' ? value : JSON.stringify(value, null, indent));
}

/** `[CODE] message` for a command error, safe for the terminal. */
export function formatErrorSummary(error: Pick<CommandError, 'code' | 'message'>): string {
	return terminalText(`[${error.code}] ${error.message}`);
}

/**
 * Render a fixed-width bar for a 0-1 ratio.
 *
 * Servers are not trusted to stay in range: values above 1, below 0 or NaN are
 * clamped, because `String.prototype.repeat` throws on a negative count.
 */
export function renderBar(ratio: number, width: number, color: (text: string) => string): string {
	const clamped = Number.isNaN(ratio) ? 0 : Math.min(1, Math.max(0, ratio));
	const filled = Math.round(clamped * width);
	return color('█'.repeat(filled)) + chalk.dim('░'.repeat(width - filled));
}

/**
 * Create a visual confidence bar, colored by confidence level.
 */
export function getConfidenceBar(confidence: number): string {
	const color = confidence >= 0.8 ? chalk.green : confidence >= 0.5 ? chalk.yellow : chalk.red;
	return renderBar(confidence, 10, color);
}

/** Confidence bar followed by the percentage, e.g. `████████░░ 80%`. */
export function formatConfidence(confidence: number): string {
	return `${getConfidenceBar(Number(confidence))} ${Math.round(Number(confidence) * 100)}%`;
}

/**
 * Create a visual progress bar.
 */
export function getProgressBar(progress: number): string {
	return chalk.cyan('[') + renderBar(progress, 20, chalk.cyan) + chalk.cyan(']');
}
