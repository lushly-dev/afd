/**
 * @fileoverview Output formatting utilities
 */

import chalk from 'chalk';
import type { CommandResult, McpTool } from '@afd/core';
import { isFailure, isSuccess } from '@afd/core';

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
export function printResult<T>(
	result: CommandResult<T>,
	options: OutputOptions = {}
): void {
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
			const confidenceBar = getConfidenceBar(result.confidence);
			console.log();
			console.log(chalk.dim('Confidence:'), confidenceBar, `${Math.round(result.confidence * 100)}%`);
		}

		if (result.reasoning && verbose) {
			console.log();
			console.log(chalk.dim('Reasoning:'), result.reasoning);
		}

		if (result.sources && result.sources.length > 0 && verbose) {
			console.log();
			console.log(chalk.dim('Sources:'));
			for (const source of result.sources) {
				console.log(`  - ${source.title || source.type}${source.location ? ` (${source.location})` : ''}`);
			}
		}

		if (result.warnings && result.warnings.length > 0) {
			console.log();
			for (const warning of result.warnings) {
				console.log(chalk.yellow(`⚠ ${warning.message}`));
			}
		}
	} else if (isFailure(result)) {
		console.log(chalk.red('✗ Failed'));
		console.log();
		console.log(chalk.bold('Error:'), `[${result.error.code}]`, result.error.message);

		if (result.error.suggestion) {
			console.log();
			console.log(chalk.dim('Suggestion:'), result.error.suggestion);
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
 * Format a list of tools.
 */
export function printTools(
	tools: McpTool[],
	options: OutputOptions = {}
): void {
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

	// Group by category (extracted from name)
	const grouped = new Map<string, McpTool[]>();
	for (const tool of tools) {
		const category = tool.name.split('.')[0] || 'other';
		if (!grouped.has(category)) {
			grouped.set(category, []);
		}
		grouped.get(category)?.push(tool);
	}

	for (const [category, categoryTools] of grouped) {
		console.log(chalk.cyan(`  ${category}/`));
		for (const tool of categoryTools) {
			const shortName = tool.name.split('.').slice(1).join('.') || tool.name;
			console.log(`    ${chalk.white(shortName)}`);
			if (tool.description) {
				console.log(`      ${chalk.dim(tool.description)}`);
			}
		}
		console.log();
	}
}

/**
 * Print connection status.
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
			console.log(chalk.dim('  URL:'), status.url);
		}
		if (status.serverName) {
			console.log(chalk.dim('  Server:'), `${status.serverName} v${status.serverVersion || '?'}`);
		}
	} else {
		console.log(chalk.dim('○ Not connected'));
	}
}

/**
 * Print an error message.
 */
export function printError(message: string, error?: Error): void {
	console.error(chalk.red('Error:'), message);
	if (error?.message && error.message !== message) {
		console.error(chalk.dim(error.message));
	}
}

/**
 * Print a success message.
 */
export function printSuccess(message: string): void {
	console.log(chalk.green('✓'), message);
}

/**
 * Print an info message.
 */
export function printInfo(message: string): void {
	console.log(chalk.blue('ℹ'), message);
}

/**
 * Print a warning message.
 */
export function printWarning(message: string): void {
	console.log(chalk.yellow('⚠'), message);
}

/**
 * Format a value for display.
 */
function formatValue(value: unknown, indent = 2): string {
	if (typeof value === 'string') {
		return value;
	}
	return JSON.stringify(value, null, indent);
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
