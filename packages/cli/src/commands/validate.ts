/**
 * @fileoverview Validate command
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getClient } from './connect.js';
import { printError, printInfo, printSuccess, printWarning } from '../output.js';
import { validateResult, type ValidationResult } from '@afd/testing';

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
		.action(async (options) => {
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
				printError(
					'Could not complete validation',
					error instanceof Error ? error : undefined
				);
				process.exit(1);
			}
		});
}
