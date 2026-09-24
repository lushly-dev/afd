/**
 * @fileoverview Scenario command - run JTBD test scenarios
 */

import { relative, resolve } from 'node:path';
import type { McpClient } from '@lushly-dev/afd-client';
import type { CommandResult } from '@lushly-dev/afd-core';
import type { Scenario, Step } from '@lushly-dev/afd-testing';
import {
	calculateSummary,
	InProcessExecutor,
	parseScenarioFile,
	type ScenarioResult,
	TerminalReporter,
	type TestReport,
} from '@lushly-dev/afd-testing';
import chalk from 'chalk';
import type { Command } from 'commander';
import ora, { type Ora } from 'ora';
import type { CliTransport } from '../config.js';
import { type ConnectFlags, createCliClient, headersOrExit, setClient } from '../connection.js';
import { printError, printInfo, printSuccess, printWarning } from '../output.js';
import { sanitizeDeep, terminalText } from '../terminal.js';
import { CLI_VERSION } from '../version.js';
import { headerOption, transportOption } from './options.js';
import { findScenarioFiles, SAMPLE_SCENARIO } from './scenario-files.js';

interface RunOptions extends ConnectFlags {
	server?: string;
	transport: CliTransport;
	verbose?: boolean;
	json?: boolean;
	color: boolean;
	stopOnFailure: boolean;
	timeout: string;
}

/**
 * Register the scenario command.
 */
export function registerScenarioCommand(program: Command): void {
	const scenarioCmd = program.command('scenario').description('Run JTBD test scenarios');

	// afd scenario run <path>
	scenarioCmd
		.command('run <path>')
		.description('Run scenario file(s)')
		.option('-s, --server <url>', 'MCP server URL to test against')
		.addOption(transportOption('Transport type', 'sse'))
		.option('-v, --verbose', 'Show detailed output including all assertions')
		.option('--json', 'Output results as JSON')
		.option('--no-color', 'Disable colored output')
		.option('--stop-on-failure', 'Stop after the first failing scenario', true)
		.option('--no-stop-on-failure', 'Run every scenario, even after one fails')
		.option('--timeout <ms>', 'Default timeout per command in milliseconds', '30000')
		.addOption(headerOption())
		.action(async (path: string, options: RunOptions) => {
			await runScenarios(path, options);
		});

	// afd scenario validate <path>
	scenarioCmd
		.command('validate <path>')
		.description('Validate scenario files without running them')
		.action(async (path: string) => {
			const cwd = process.cwd();
			const spinner = ora('Finding scenarios...').start();

			try {
				const files = await findScenarioFiles(resolve(cwd, path));

				if (files.length === 0) {
					spinner.fail('No scenario files found');
					process.exit(1);
				}

				spinner.text = `Validating ${files.length} scenario(s)...`;

				let validCount = 0;
				let invalidCount = 0;

				for (const file of files) {
					const result = await parseScenarioFile(file);
					const relativePath = terminalText(relative(cwd, file));

					if (result.success) {
						validCount++;
						console.log(chalk.green('✓'), relativePath);
					} else {
						invalidCount++;
						console.log(chalk.red('✗'), relativePath);
						console.log(chalk.dim(`  ${terminalText(result.error)}`));
					}
				}

				spinner.stop();
				console.log();

				if (invalidCount > 0) {
					printWarning(`${invalidCount} scenario(s) failed validation`);
					process.exit(1);
				} else {
					printSuccess(`All ${validCount} scenario(s) are valid!`);
				}
			} catch (error) {
				spinner.fail('Validation failed');
				printError(
					'Unexpected error during validation',
					error instanceof Error ? error : undefined
				);
				process.exit(1);
			}
		});

	// afd scenario init
	scenarioCmd
		.command('init')
		.description('Create a sample scenario file')
		.option('-o, --output <path>', 'Output file path', 'scenarios/example.scenario.yaml')
		.action(async (options) => {
			const { writeFile, mkdir } = await import('node:fs/promises');
			const { dirname } = await import('node:path');

			const outputPath = resolve(process.cwd(), options.output);

			try {
				await mkdir(dirname(outputPath), { recursive: true });
				await writeFile(outputPath, SAMPLE_SCENARIO, 'utf-8');
				printSuccess(`Created sample scenario: ${options.output}`);
				printInfo('Edit the file to match your API commands, then run:');
				console.log(chalk.cyan(`  afd scenario run ${options.output}`));
			} catch (error) {
				printError('Failed to create scenario file', error instanceof Error ? error : undefined);
				process.exit(1);
			}
		});
}

/** Parse every scenario file matching `path`; exits when none is usable. */
async function loadScenarios(
	path: string,
	cwd: string,
	spinner: Ora
): Promise<Array<{ path: string; scenario: Scenario }>> {
	const files = await findScenarioFiles(resolve(cwd, path));

	if (files.length === 0) {
		spinner.fail('No scenario files found');
		printError(`No .scenario.yaml files found matching: ${path}`);
		return process.exit(1);
	}

	spinner.text = `Loading ${files.length} scenario(s)...`;

	const scenarios: Array<{ path: string; scenario: Scenario }> = [];
	const parseErrors: string[] = [];

	for (const file of files) {
		const result = await parseScenarioFile(file);
		if (result.success) {
			scenarios.push({ path: file, scenario: result.scenario });
		} else {
			parseErrors.push(`${relative(cwd, file)}: ${result.error}`);
		}
	}

	if (parseErrors.length > 0) {
		spinner.warn(`${parseErrors.length} scenario(s) failed to parse`);
		for (const err of parseErrors) {
			printWarning(err);
		}
	}

	if (scenarios.length === 0) {
		spinner.fail('No valid scenarios to run');
		return process.exit(1);
	}

	spinner.succeed(`Found ${scenarios.length} scenario(s)`);
	return scenarios;
}

async function runScenarios(path: string, options: RunOptions): Promise<void> {
	const startTime = Date.now();
	const cwd = process.cwd();
	const spinner = ora('Finding scenarios...').start();

	try {
		const scenarios = await loadScenarios(path, cwd, spinner);

		// Human output prints server text (error messages, assertion details), so
		// the reporter gets sanitized copies. JSON output is already safe.
		const human = !options.json;
		const reporter = new TerminalReporter({
			format: options.json ? 'json' : 'human',
			verbose: options.verbose,
			colors: options.color !== false,
		});

		if (!options.server) {
			printError('Server URL required. Use --server <url> option.');
			return process.exit(1);
		}

		const connectSpinner = ora('Connecting to server...').start();
		let client: McpClient;

		try {
			client = createCliClient({
				url: options.server,
				transport: options.transport,
				timeout: Number.parseInt(options.timeout, 10),
				autoReconnect: false,
				headers: headersOrExit(options.header),
			});
			// Registered so the CLI entry point disconnects it on every exit path.
			setClient(client);
			await client.connect();
			connectSpinner.succeed('Connected to server');
		} catch (error) {
			connectSpinner.fail('Failed to connect to server');
			printError('Could not connect to MCP server', error instanceof Error ? error : undefined);
			return process.exit(1);
		}

		// The scenario whose steps are running. Steps are attributed to it
		// directly: several scenarios can share a command name.
		let current: { scenario: Scenario; stepIndex: number } | null = null;

		// Create in-process executor that uses the client. It always skips the
		// rest of a scenario after a failed step; --no-stop-on-failure only
		// decides whether later scenarios still run.
		const executor = new InProcessExecutor({
			handler: async (
				command: string,
				input?: Record<string, unknown>
			): Promise<CommandResult<unknown>> => {
				try {
					return await client.call(command, input ?? {});
				} catch (err) {
					return {
						success: false,
						error: {
							code: 'execution_error',
							message: err instanceof Error ? err.message : String(err),
						},
					};
				}
			},
			onScenarioStart: (scenario: Scenario) => {
				current = { scenario, stepIndex: 0 };
				if (human) {
					reporter.reportScenarioStart(
						terminalText(scenario.job),
						terminalText(scenario.description)
					);
				}
			},
			onStepComplete: (step: Step, result) => {
				if (!current) return;
				const stepIndex = current.stepIndex++;
				if (human) {
					reporter.reportStepProgress(
						sanitizeDeep(step),
						sanitizeDeep(result),
						stepIndex,
						current.scenario.steps.length
					);
				}
			},
		});

		// Run scenarios
		const results: ScenarioResult[] = [];

		for (const { path: scenarioPath, scenario } of scenarios) {
			const result = await executor.execute(scenario);
			result.scenarioPath = relative(cwd, scenarioPath);
			results.push(result);

			// `partial` (some steps failed) counts as failed, as in the summary.
			if (result.outcome !== 'pass' && options.stopOnFailure !== false) break;
		}

		// Calculate summary
		const summary = calculateSummary(results);
		const totalDuration = Date.now() - startTime;

		// Output final report
		if (options.json) {
			const report: TestReport = {
				title: `Scenario Run: ${path}`,
				durationMs: totalDuration,
				scenarios: results,
				summary,
				generatedAt: new Date(),
				environment: {
					nodeVersion: process.version,
					platform: process.platform,
					cwd,
					afdVersion: CLI_VERSION,
				},
			};
			reporter.reportTestReport(report);
		} else {
			console.log();
			reporter.reportAll(sanitizeDeep(results));
		}

		await client.disconnect();
		setClient(null);

		if (summary.failedScenarios > 0 || summary.errorScenarios > 0) {
			process.exit(1);
		}
	} catch (error) {
		spinner.fail('Scenario execution failed');
		printError(
			'Unexpected error during scenario execution',
			error instanceof Error ? error : undefined
		);
		process.exit(1);
	}
}
