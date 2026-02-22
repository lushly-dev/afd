/**
 * @fileoverview Validate command
 */

import {
	type SurfaceFinding,
	type ValidationResult,
	validateCommandSurface,
	validateResult,
} from '@lushly-dev/afd-testing';
import chalk from 'chalk';
import type { Command } from 'commander';
import ora from 'ora';
import { printError, printInfo, printSuccess, printWarning } from '../output.js';
import { getClient } from './connect.js';

/**
 * Register the validate command.
 */
export function registerValidateCommand(program: Command): void {
	program
		.command('validate')
		.description('Validate command results against AFD standards')
		.option('-c, --category <name>', 'Validate only commands in this category')
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
		.action(async (options) => {
			if (options.surface) {
				await runSurfaceValidation(options);
			} else {
				await runPerCommandValidation(options);
			}
		});
}

/**
 * Commander helper: collect repeatable option values into an array.
 */
function collectValues(value: string, previous: string[]): string[] {
	return [...previous, value];
}

// ═══════════════════════════════════════════════════════════════════════════════
// SURFACE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

interface SurfaceOptions {
	strict?: boolean;
	verbose?: boolean;
	similarityThreshold: string;
	skipCategory: string[];
	suppress: string[];
}

async function runSurfaceValidation(options: SurfaceOptions): Promise<void> {
	const client = getClient();

	if (!client || !client.isConnected()) {
		printError('Not connected. Run "afd connect <url>" first.');
		process.exit(1);
	}

	const spinner = ora('Fetching tools for surface validation...').start();

	try {
		const tools = await client.refreshTools();
		spinner.text = `Analyzing ${tools.length} commands...`;

		// Map MCP tool definitions to SurfaceCommand shape
		const commands = tools.map((tool) => ({
			name: tool.name,
			description: tool.description ?? '',
			jsonSchema: tool.inputSchema as Record<string, unknown>,
		}));

		const result = validateCommandSurface(commands, {
			similarityThreshold: Number.parseFloat(options.similarityThreshold),
			strict: options.strict,
			skipCategories: options.skipCategory,
			suppressions: options.suppress,
		});

		spinner.stop();

		// Print findings grouped by severity
		console.log();
		console.log(chalk.bold('Surface Validation Results:'));
		console.log();

		const bySeverity: Record<string, SurfaceFinding[]> = {
			error: [],
			warning: [],
			info: [],
		};

		for (const finding of result.findings) {
			if (finding.suppressed) continue;
			bySeverity[finding.severity]?.push(finding);
		}

		for (const [severity, findings] of Object.entries(bySeverity)) {
			if (findings.length === 0) continue;

			const color =
				severity === 'error' ? chalk.red : severity === 'warning' ? chalk.yellow : chalk.blue;
			const icon = severity === 'error' ? '✗' : severity === 'warning' ? '△' : 'ℹ';

			console.log(color.bold(`${icon} ${severity.toUpperCase()} (${findings.length}):`));

			for (const f of findings) {
				console.log(color(`  ${f.rule}: ${f.message}`));
				console.log(chalk.dim(`    Commands: ${f.commands.join(', ')}`));
				if (options.verbose) {
					console.log(chalk.dim(`    Fix: ${f.suggestion}`));
					if (f.evidence) {
						console.log(chalk.dim(`    Evidence: ${JSON.stringify(f.evidence)}`));
					}
				}
			}
			console.log();
		}

		// Suppressed count
		if (result.summary.suppressedCount > 0) {
			console.log(chalk.dim(`  ${result.summary.suppressedCount} finding(s) suppressed`));
		}

		// Summary
		console.log(chalk.bold('Summary:'));
		console.log(`  ${result.summary.commandCount} commands analyzed`);
		console.log(
			`  ${result.summary.rulesEvaluated.length} rules evaluated in ${result.summary.durationMs}ms`
		);
		console.log(`  ${chalk.red(result.summary.errorCount)} errors`);
		console.log(`  ${chalk.yellow(result.summary.warningCount)} warnings`);
		console.log(`  ${chalk.blue(result.summary.infoCount)} info`);

		if (!result.valid) {
			console.log();
			printWarning('Surface validation failed. Fix the issues above.');
			process.exit(1);
		} else if (result.summary.warningCount > 0) {
			console.log();
			printInfo('Surface validation passed with warnings. Consider addressing them.');
		} else {
			console.log();
			printSuccess('Surface validation passed!');
		}
	} catch (error) {
		spinner.fail('Surface validation failed');
		printError('Could not complete surface validation', error instanceof Error ? error : undefined);
		process.exit(1);
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// PER-COMMAND VALIDATION (existing)
// ═══════════════════════════════════════════════════════════════════════════════

interface PerCommandOptions {
	category?: string;
	strict?: boolean;
	verbose?: boolean;
}

async function runPerCommandValidation(options: PerCommandOptions): Promise<void> {
	const client = getClient();

	if (!client || !client.isConnected()) {
		printError('Not connected. Run "afd connect <url>" first.');
		process.exit(1);
	}

	const spinner = ora('Fetching tools...').start();

	try {
		let tools = await client.refreshTools();

		// Filter by category
		if (options.category) {
			tools = tools.filter((t) => t.name.startsWith(`${options.category}.`));
		}

		spinner.text = `Validating ${tools.length} commands...`;

		const results: Array<{
			name: string;
			validation: ValidationResult;
			callResult?: unknown;
			error?: string;
		}> = [];

		for (const tool of tools) {
			spinner.text = `Validating ${tool.name}...`;

			try {
				// Call the command with empty/minimal args to test response structure
				// Note: This is a basic validation - real validation would need proper test data
				const result = await client.call(tool.name, {});

				const validation = validateResult(result, {
					requireData: false, // Don't require data since we're calling with no args
				});

				results.push({
					name: tool.name,
					validation,
					callResult: result,
				});
			} catch (error) {
				results.push({
					name: tool.name,
					validation: { valid: false, errors: [], warnings: [] },
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		spinner.stop();

		// Print results
		console.log();
		console.log(chalk.bold('Validation Results:'));
		console.log();

		let passCount = 0;
		let warnCount = 0;
		let failCount = 0;

		for (const result of results) {
			if (result.error) {
				failCount++;
				console.log(chalk.red('✗'), result.name);
				if (options.verbose) {
					console.log(chalk.dim(`  Error: ${result.error}`));
				}
			} else if (!result.validation.valid) {
				failCount++;
				console.log(chalk.red('✗'), result.name);
				if (options.verbose) {
					for (const err of result.validation.errors) {
						console.log(chalk.red(`  - ${err.path}: ${err.message}`));
					}
				}
			} else if (result.validation.warnings.length > 0) {
				if (options.strict) {
					failCount++;
					console.log(chalk.red('✗'), result.name);
				} else {
					warnCount++;
					console.log(chalk.yellow('△'), result.name);
				}
				if (options.verbose) {
					for (const warn of result.validation.warnings) {
						console.log(chalk.yellow(`  - ${warn.path}: ${warn.message}`));
					}
				}
			} else {
				passCount++;
				console.log(chalk.green('✓'), result.name);
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
