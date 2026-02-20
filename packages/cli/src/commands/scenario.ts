/**
 * @fileoverview Scenario command - run JTBD test scenarios
 */

import { relative, resolve } from 'node:path';
import { createClient, type McpClient } from '@lushly-dev/afd-client';
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
import { glob } from 'glob';
import ora from 'ora';
import { printError, printInfo, printSuccess, printWarning } from '../output.js';

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
		.option('-t, --transport <type>', 'Transport type (sse, http)', 'sse')
		.option('-v, --verbose', 'Show detailed output including all assertions')
		.option('--json', 'Output results as JSON')
		.option('--no-color', 'Disable colored output')
		.option('--stop-on-failure', 'Stop execution after first scenario failure', true)
		.option('--timeout <ms>', 'Default timeout per command in milliseconds', '30000')
		.action(async (path: string, options) => {
			const startTime = Date.now();

			// Resolve glob pattern
			const cwd = process.cwd();
			const pattern = resolve(cwd, path);

			const spinner = ora('Finding scenarios...').start();

			try {
				// Find scenario files
				let files: string[] = [];
				if (pattern.includes('*')) {
					files = await glob(pattern, { absolute: true });
				} else if (pattern.endsWith('.yaml') || pattern.endsWith('.yml')) {
					files = [pattern];
				} else {
					// Assume directory, look for .scenario.yaml files
					files = await glob(`${pattern}/**/*.scenario.yaml`, { absolute: true });
				}

				if (files.length === 0) {
					spinner.fail('No scenario files found');
					printError(`No .scenario.yaml files found matching: ${path}`);
					process.exit(1);
				}

				spinner.text = `Loading ${files.length} scenario(s)...`;

				// Parse all scenarios
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
					process.exit(1);
				}

				spinner.succeed(`Found ${scenarios.length} scenario(s)`);

				// Create reporter
				const reporter = new TerminalReporter({
					format: options.json ? 'json' : 'human',
					verbose: options.verbose,
					colors: options.color !== false,
				});

				// Connect to MCP server
				if (!options.server) {
					printError('Server URL required. Use --server <url> option.');
					process.exit(1);
				}

				const connectSpinner = ora('Connecting to server...').start();
				let client: McpClient | null = null;

				try {
					client = createClient({
						url: options.server,
						transport: options.transport as 'sse' | 'http',
						timeout: parseInt(options.timeout, 10),
					});
					await client.connect();
					connectSpinner.succeed('Connected to server');
				} catch (error) {
					connectSpinner.fail('Failed to connect to server');
					printError('Could not connect to MCP server', error instanceof Error ? error : undefined);
					process.exit(1);
				}

				// Create in-process executor that uses the client
				const executor = new InProcessExecutor({
					handler: async (
						command: string,
						input?: Record<string, unknown>
					): Promise<CommandResult<unknown>> => {
						if (!client) {
							return {
								success: false,
								error: { code: 'not_connected', message: 'Client not connected' },
							};
						}
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
					stopOnFailure: options.stopOnFailure,
					onScenarioStart: (scenario: Scenario) => {
						if (!options.json) {
							reporter.reportScenarioStart(scenario.job, scenario.description);
						}
					},
					onStepComplete: (step: Step, result) => {
						if (!options.json) {
							const currentScenario = scenarios.find((s) =>
								s.scenario.steps.some((st) => st.command === step.command)
							);
							if (currentScenario) {
								const stepIndex = currentScenario.scenario.steps.indexOf(step);
								reporter.reportStepProgress(
									step,
									result,
									stepIndex,
									currentScenario.scenario.steps.length
								);
							}
						}
					},
				});

				// Run scenarios
				const results: ScenarioResult[] = [];
				let stopExecution = false;

				for (const { path: scenarioPath, scenario } of scenarios) {
					if (stopExecution) break;

					const result = await executor.execute(scenario);
					result.scenarioPath = relative(cwd, scenarioPath);
					results.push(result);

					if (options.stopOnFailure && (result.outcome === 'fail' || result.outcome === 'error')) {
						stopExecution = true;
					}
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
							afdVersion: '0.1.0',
						},
					};
					reporter.reportTestReport(report);
				} else {
					console.log();
					reporter.reportAll(results);
				}

				// Exit code
				if (summary.failedScenarios > 0 || summary.errorScenarios > 0) {
					await client?.disconnect();
					process.exit(1);
				}

				// Disconnect from server
				await client?.disconnect();
			} catch (error) {
				spinner.fail('Scenario execution failed');
				printError(
					'Unexpected error during scenario execution',
					error instanceof Error ? error : undefined
				);
				process.exit(1);
			}
		});

	// afd scenario validate <path>
	scenarioCmd
		.command('validate <path>')
		.description('Validate scenario files without running them')
		.action(async (path: string) => {
			const cwd = process.cwd();
			const pattern = resolve(cwd, path);

			const spinner = ora('Finding scenarios...').start();

			try {
				let files: string[] = [];
				if (pattern.includes('*')) {
					files = await glob(pattern, { absolute: true });
				} else if (pattern.endsWith('.yaml') || pattern.endsWith('.yml')) {
					files = [pattern];
				} else {
					files = await glob(`${pattern}/**/*.scenario.yaml`, { absolute: true });
				}

				if (files.length === 0) {
					spinner.fail('No scenario files found');
					process.exit(1);
				}

				spinner.text = `Validating ${files.length} scenario(s)...`;

				let validCount = 0;
				let invalidCount = 0;

				for (const file of files) {
					const result = await parseScenarioFile(file);
					const relativePath = relative(cwd, file);

					if (result.success) {
						validCount++;
						console.log(chalk.green('✓'), relativePath);
					} else {
						invalidCount++;
						console.log(chalk.red('✗'), relativePath);
						console.log(chalk.dim(`  ${result.error}`));
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

			const sampleScenario = `# JTBD Scenario: Example workflow
# This file defines a Jobs-to-Be-Done test scenario

name: Example Todo Workflow
description: As a user, I want to create and complete a todo item
job: create-and-complete-todo
tags: [smoke, example]

# Optional: Load fixture data before running
# fixture:
#   file: ./fixtures/empty-state.json

steps:
  - command: todo.create
    description: Create a new todo item
    input:
      title: Buy groceries
    expect:
      success: true
      data:
        title: Buy groceries
        completed: { equals: false }
        id: { exists: true }

  - command: todo.complete
    description: Mark the todo as completed
    input:
      id: \${{ steps[0].data.id }}  # Reference previous step output
    expect:
      success: true
      data:
        completed: true

  - command: todo.list
    description: Verify the todo appears in the list
    expect:
      success: true
      data:
        items:
          length: { gte: 1 }

# Optional: Final state verification
# verify:
#   snapshot: ./snapshots/expected-final-state.json
#   assertions:
#     - "All todos should be completed"
`;

			const outputPath = resolve(process.cwd(), options.output);

			try {
				await mkdir(dirname(outputPath), { recursive: true });
				await writeFile(outputPath, sampleScenario, 'utf-8');
				printSuccess(`Created sample scenario: ${options.output}`);
				printInfo('Edit the file to match your API commands, then run:');
				console.log(chalk.cyan(`  afd scenario run ${options.output}`));
			} catch (error) {
				printError('Failed to create scenario file', error instanceof Error ? error : undefined);
				process.exit(1);
			}
		});
}
