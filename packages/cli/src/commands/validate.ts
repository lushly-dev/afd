/**
 * @fileoverview Validate command
 */

import type { McpClient } from '@lushly-dev/afd-client';
import type { McpTool } from '@lushly-dev/afd-core';
import {
	type ValidationError,
	type ValidationResult,
	type ValidationWarning,
	validateResult,
} from '@lushly-dev/afd-testing';
import chalk from 'chalk';
import type { Command } from 'commander';
import ora from 'ora';
import { type ConnectFlags, requireClient } from '../connection.js';
import { printError, printInfo, printSuccess, printWarning } from '../output.js';
import { terminalText } from '../terminal.js';
import { matchesCategory } from '../tool-category.js';
import { collectValues, headerOption } from './options.js';
import { runSurfaceValidation } from './validate-surface.js';

/**
 * Register the validate command.
 */
export function registerValidateCommand(program: Command): void {
	program
		.command('validate')
		.description(
			"Validate the server's tool listing against AFD standards (calls tools only with --execute)"
		)
		.option(
			'-c, --category <name>',
			'Validate only tools in this category (_meta.category, or "<name>-" name prefix)'
		)
		.option(
			'--execute',
			'Also call each tool and validate its CommandResult; skips mutation/destructive tools'
		)
		.option('--strict', 'Treat warnings as errors')
		.option('-v, --verbose', 'Show detailed validation results')
		.option('--surface', 'Run surface (cross-command) validation')
		.option(
			'--similarity-threshold <n>',
			'Similarity threshold for surface validation (0-1)',
			'0.7'
		)
		.option(
			'--skip-category <name>',
			'Skip category during surface validation (repeatable)',
			collectValues,
			[]
		)
		.option(
			'--suppress <rule>',
			'Suppress a surface validation rule or rule:cmdA:cmdB pair (repeatable)',
			collectValues,
			[]
		)
		.addOption(headerOption())
		.addHelpText(
			'after',
			`
By default, validate only inspects tools/list: names, descriptions, input
schemas and _meta.examples. No tool is executed.

With --execute, each tool is also called and its CommandResult validated.
Tools whose _meta marks them mutation: true or destructive: true are never
called; they are reported as skipped. Each call uses _meta.examples[0].input
when the server advertises one, otherwise {}.`
		)
		.action(async (options) => {
			if (options.surface) {
				await runSurfaceValidation(options);
			} else {
				await runPerCommandValidation(options);
			}
		});
}

// ═══════════════════════════════════════════════════════════════════════════════
// PER-COMMAND VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

interface PerCommandOptions extends ConnectFlags {
	category?: string;
	execute?: boolean;
	strict?: boolean;
	verbose?: boolean;
}

/** `_meta` as servers may emit it; `destructive` is not part of the core type. */
type ToolMeta = NonNullable<McpTool['_meta']> & { destructive?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Why `--execute` must not call a tool, or undefined when calling it is safe. */
export function getExecutionSkipReason(tool: McpTool): string | undefined {
	const meta = tool._meta as ToolMeta | undefined;
	if (meta?.mutation === true) return 'mutation: true';
	if (meta?.destructive === true) return 'destructive: true';
	return undefined;
}

/** Input for an executed tool: its first advertised example, otherwise `{}`. */
export function getExecutionInput(tool: McpTool): Record<string, unknown> {
	const input = tool._meta?.examples?.[0]?.input;
	return isRecord(input) ? input : {};
}

/** Validate one tools/list entry without calling it. */
export function validateToolListing(tool: McpTool): ValidationResult {
	const errors: ValidationError[] = [];
	const warnings: ValidationWarning[] = [];

	if (typeof tool.name !== 'string' || !tool.name.trim()) {
		errors.push({ path: 'name', message: 'Tool must have a name', code: 'MISSING_NAME' });
	}

	const description = typeof tool.description === 'string' ? tool.description.trim() : '';
	if (!description) {
		errors.push({
			path: 'description',
			message: 'Tool must have a description',
			code: 'MISSING_DESCRIPTION',
		});
	} else if (description.length < 10) {
		warnings.push({
			path: 'description',
			message: 'Description should be more detailed',
			code: 'SHORT_DESCRIPTION',
		});
	}

	if (!isRecord(tool.inputSchema) || tool.inputSchema.type !== 'object') {
		errors.push({
			path: 'inputSchema',
			message: 'inputSchema must be a JSON Schema with type "object"',
			code: 'INVALID_INPUT_SCHEMA',
		});
	}

	const examples: unknown = tool._meta?.examples;
	if (examples !== undefined && !Array.isArray(examples)) {
		errors.push({
			path: '_meta.examples',
			message: '_meta.examples must be an array',
			code: 'INVALID_EXAMPLES',
		});
	} else if (Array.isArray(examples)) {
		examples.forEach((example: unknown, index) => {
			if (!isRecord(example) || !isRecord(example.input)) {
				errors.push({
					path: `_meta.examples[${index}].input`,
					message: 'Example input must be an object',
					code: 'INVALID_EXAMPLE_INPUT',
				});
			}
		});
	}

	return { valid: errors.length === 0, errors, warnings };
}

interface ToolValidation {
	name: string;
	validation: ValidationResult;
	/** Why --execute deliberately did not call this tool. */
	skipped?: string;
	error?: string;
}

async function validateTool(
	client: McpClient,
	tool: McpTool,
	execute: boolean
): Promise<ToolValidation> {
	const listing = validateToolListing(tool);
	if (!execute) return { name: tool.name, validation: listing };

	const skipped = getExecutionSkipReason(tool);
	if (skipped) return { name: tool.name, validation: listing, skipped };

	try {
		const result = await client.call(tool.name, getExecutionInput(tool));
		// Example inputs can be minimal, so a success without data is acceptable.
		const called = validateResult(result, { requireData: false });
		return {
			name: tool.name,
			validation: {
				valid: listing.valid && called.valid,
				errors: [...listing.errors, ...called.errors],
				warnings: [...listing.warnings, ...called.warnings],
			},
		};
	} catch (error) {
		return {
			name: tool.name,
			validation: listing,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function runPerCommandValidation(options: PerCommandOptions): Promise<void> {
	const client = await requireClient(options);

	const spinner = ora('Fetching tools...').start();
	const execute = options.execute === true;

	try {
		let tools = await client.refreshTools();

		// Filter by category
		const { category } = options;
		if (category) {
			tools = tools.filter((t) => matchesCategory(t, category));
		}

		spinner.text = `Validating ${tools.length} commands...`;

		const results: ToolValidation[] = [];
		for (const tool of tools) {
			spinner.text = `Validating ${terminalText(tool.name)}...`;
			results.push(await validateTool(client, tool, execute));
		}

		spinner.stop();

		// Print results
		console.log();
		console.log(chalk.bold('Validation Results:'));
		console.log();

		let passCount = 0;
		let warnCount = 0;
		let failCount = 0;
		const skipCount = results.filter((result) => result.skipped).length;

		for (const result of results) {
			// Report every skip on the tool's own line, whatever its listing status.
			// Tool names and error text come from the server.
			const name = terminalText(result.name);
			const label = result.skipped ? `${name} ${chalk.dim(`skipped (${result.skipped})`)}` : name;
			if (result.error) {
				failCount++;
				console.log(chalk.red('✗'), label);
				if (options.verbose) {
					console.log(chalk.dim(`  Error: ${terminalText(result.error)}`));
				}
			} else if (!result.validation.valid) {
				failCount++;
				console.log(chalk.red('✗'), label);
				if (options.verbose) {
					for (const err of result.validation.errors) {
						console.log(chalk.red(`  - ${terminalText(`${err.path}: ${err.message}`)}`));
					}
				}
			} else if (result.validation.warnings.length > 0) {
				if (options.strict) {
					failCount++;
					console.log(chalk.red('✗'), label);
				} else {
					warnCount++;
					console.log(chalk.yellow('△'), label);
				}
				if (options.verbose) {
					for (const warn of result.validation.warnings) {
						console.log(chalk.yellow(`  - ${terminalText(`${warn.path}: ${warn.message}`)}`));
					}
				}
			} else if (result.skipped) {
				console.log(chalk.dim('○'), label);
			} else {
				passCount++;
				console.log(chalk.green('✓'), label);
			}
		}

		// Summary
		console.log();
		console.log(chalk.bold('Summary:'));
		console.log(`  ${chalk.green(passCount)} passed`);
		if (warnCount > 0) {
			console.log(`  ${chalk.yellow(warnCount)} warnings`);
		}
		if (failCount > 0) {
			console.log(`  ${chalk.red(failCount)} failed`);
		}
		if (skipCount > 0) {
			console.log(`  ${chalk.dim(skipCount)} not executed (mutation or destructive)`);
		}
		console.log();
		printInfo(
			execute
				? 'Called read-only tools with _meta.examples[0].input, or {} when none is advertised.'
				: 'Checked the tool listing only; no tools were executed. Use --execute to call them.'
		);

		if (failCount > 0 || (options.strict && warnCount > 0)) {
			console.log();
			printWarning('Validation failed. Fix the issues above.');
			process.exit(1);
		} else if (warnCount > 0) {
			console.log();
			printInfo('Validation passed with warnings. Consider addressing them.');
		} else {
			console.log();
			printSuccess('All commands validated successfully!');
		}
	} catch (error) {
		spinner.fail('Validation failed');
		printError('Could not complete validation', error instanceof Error ? error : undefined);
		process.exit(1);
	}
}
