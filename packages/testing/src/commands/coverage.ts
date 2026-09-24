/**
 * @lushly-dev/afd-testing - scenario-coverage command
 *
 * Generate coverage metrics for scenarios across multiple dimensions:
 * - Commands: Which commands are being tested
 * - Errors: Which error codes are being tested
 * - Jobs: What user jobs are covered
 */

import * as fs from 'node:fs';
import { type CommandResult, failure, success } from '@lushly-dev/afd-core';
import { parseScenarioFile } from '../parsers/yaml.js';
import type { Scenario, Step } from '../types/scenario.js';
import { formatCoverageMarkdown, formatCoverageTerminal } from './coverage-format.js';
import { scenarioList } from './list.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Input for scenario-coverage command.
 */
export interface ScenarioCoverageInput {
	/** Base directory for scenarios */
	directory?: string;

	/** Specific scenario files to analyze */
	scenarios?: string[];

	/** Filter by job name */
	job?: string;

	/** Filter by tags */
	tags?: string[];

	/** Known commands to measure coverage against */
	knownCommands?: string[];

	/** Known error codes to measure coverage against */
	knownErrors?: string[];

	/** Output format */
	format?: 'terminal' | 'json' | 'markdown';

	/** Write the formatted report to this file path */
	output?: string;
}

/**
 * Coverage metrics for a single command.
 */
export interface CommandCoverage {
	/** Command name */
	command: string;

	/** Number of scenarios that test this command */
	scenarioCount: number;

	/** Number of steps that invoke this command */
	stepCount: number;

	/** Scenarios that use this command */
	usedIn: string[];

	/** Whether this command has error handling tests */
	hasErrorTests: boolean;
}

/**
 * Coverage metrics for a single error code.
 */
export interface ErrorCoverage {
	/** Error code */
	errorCode: string;

	/** Number of scenarios that test this error */
	scenarioCount: number;

	/** Scenarios that test this error */
	testedIn: string[];
}

/**
 * Coverage metrics for a job (user goal).
 */
export interface JobCoverage {
	/** Job name */
	job: string;

	/** Number of scenarios for this job */
	scenarioCount: number;

	/** Tags associated with this job */
	tags: string[];

	/** Average steps per scenario */
	avgSteps: number;
}

/**
 * Overall coverage summary.
 */
export interface CoverageSummary {
	/** Total scenarios analyzed */
	totalScenarios: number;

	/** Total steps analyzed */
	totalSteps: number;

	/** Command coverage */
	commands: {
		/** Number of unique commands tested */
		tested: number;
		/** Number of known commands (if provided) */
		known?: number;
		/** Coverage percentage */
		coverage?: number;
		/** Commands not tested */
		untested?: string[];
	};

	/** Error coverage */
	errors: {
		/** Number of unique error codes tested */
		tested: number;
		/** Number of known error codes (if provided) */
		known?: number;
		/** Coverage percentage */
		coverage?: number;
		/** Error codes not tested */
		untested?: string[];
	};

	/** Job coverage */
	jobs: {
		/** Number of unique jobs */
		count: number;
		/** Jobs tested */
		names: string[];
	};
}

/**
 * Output for scenario-coverage command.
 */
export interface ScenarioCoverageOutput {
	/** Overall summary */
	summary: CoverageSummary;

	/** Per-command coverage */
	commandCoverage: CommandCoverage[];

	/** Per-error coverage */
	errorCoverage: ErrorCoverage[];

	/** Per-job coverage */
	jobCoverage: JobCoverage[];

	/** Formatted output (if format specified) */
	formattedOutput?: string;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Extract command names from steps.
 */
function extractCommands(steps: Step[]): string[] {
	return steps.map((step) => step.command);
}

/**
 * Extract expected error codes from steps.
 */
function extractExpectedErrors(steps: Step[]): string[] {
	const errors: string[] = [];
	for (const step of steps) {
		if (step.expect?.error?.code) {
			errors.push(step.expect.error.code);
		}
	}
	return errors;
}

/**
 * Calculate coverage metrics for scenarios.
 *
 * @example
 * ```typescript
 * // Basic coverage analysis
 * const result = await scenarioCoverage({
 *   directory: './scenarios'
 * });
 *
 * // Coverage against known commands
 * const result = await scenarioCoverage({
 *   directory: './scenarios',
 *   knownCommands: ['todo-create', 'todo-list', 'todo-update', 'todo-delete']
 * });
 * ```
 */
export async function scenarioCoverage(
	input: ScenarioCoverageInput
): Promise<CommandResult<ScenarioCoverageOutput>> {
	try {
		// Collect scenarios to analyze; unparseable files become warnings
		const scenariosToAnalyze: Array<{ scenario: Scenario; path: string }> = [];
		const parseErrors: string[] = [];

		if (input.scenarios && input.scenarios.length > 0) {
			// Analyze specific scenarios
			for (const scenarioPath of input.scenarios) {
				const result = await parseScenarioFile(scenarioPath);
				if (result.success) {
					scenariosToAnalyze.push({ scenario: result.scenario, path: scenarioPath });
				} else {
					parseErrors.push(`${scenarioPath}: ${result.error}`);
				}
			}
		} else {
			// List and filter scenarios
			const listResult = await scenarioList({
				directory: input.directory,
				job: input.job,
				tags: input.tags,
			});

			if (!listResult.success || !listResult.data) {
				return failure({
					code: 'LIST_ERROR',
					message: listResult.error?.message ?? 'Failed to list scenarios',
					suggestion: 'Check that the directory exists and contains .scenario.yaml files',
				});
			}

			for (const parseFailure of listResult.data.parseErrors) {
				parseErrors.push(`${parseFailure.path}: ${parseFailure.error}`);
			}

			// Parse each scenario
			for (const summary of listResult.data.scenarios) {
				const result = await parseScenarioFile(summary.path);
				if (result.success) {
					scenariosToAnalyze.push({ scenario: result.scenario, path: summary.path });
				} else {
					parseErrors.push(`${summary.path}: ${result.error}`);
				}
			}
		}

		// Build coverage data
		const commandMap = new Map<string, CommandCoverage>();
		const errorMap = new Map<string, ErrorCoverage>();
		const jobMap = new Map<string, JobCoverage>();

		let totalSteps = 0;

		for (const { scenario, path } of scenariosToAnalyze) {
			const steps = scenario.steps ?? [];
			totalSteps += steps.length;

			// Track commands
			const scenarioCommands = extractCommands(steps);
			const uniqueScenarioCommands = new Set(scenarioCommands);
			const scenarioErrors = extractExpectedErrors(steps);

			for (const cmd of uniqueScenarioCommands) {
				if (!commandMap.has(cmd)) {
					commandMap.set(cmd, {
						command: cmd,
						scenarioCount: 0,
						stepCount: 0,
						usedIn: [],
						hasErrorTests: false,
					});
				}
				const coverage = commandMap.get(cmd);
				if (!coverage) continue;
				coverage.scenarioCount++;
				coverage.usedIn.push(path);
			}

			// Count step occurrences
			for (const cmd of scenarioCommands) {
				const coverage = commandMap.get(cmd);
				if (coverage) {
					coverage.stepCount++;
				}
			}

			// Track error handling tests
			for (const step of steps) {
				if (step.expect?.success === false) {
					const cmd = step.command;
					const coverage = commandMap.get(cmd);
					if (coverage) {
						coverage.hasErrorTests = true;
					}
				}
			}

			// Track errors
			for (const errorCode of scenarioErrors) {
				if (!errorMap.has(errorCode)) {
					errorMap.set(errorCode, {
						errorCode,
						scenarioCount: 0,
						testedIn: [],
					});
				}
				const coverage = errorMap.get(errorCode);
				if (!coverage) continue;
				coverage.scenarioCount++;
				coverage.testedIn.push(path);
			}

			// Track jobs
			const job = scenario.job;
			if (!jobMap.has(job)) {
				jobMap.set(job, {
					job,
					scenarioCount: 0,
					tags: [],
					avgSteps: 0,
				});
			}
			const jobCoverage = jobMap.get(job);
			if (!jobCoverage) continue;
			jobCoverage.scenarioCount++;
			// Merge tags
			const scenarioTags = scenario.tags ?? [];
			for (const tag of scenarioTags) {
				if (!jobCoverage.tags.includes(tag)) {
					jobCoverage.tags.push(tag);
				}
			}
		}

		// Calculate average steps per job
		for (const { scenario } of scenariosToAnalyze) {
			const job = scenario.job;
			const jobCoverage = jobMap.get(job);
			if (jobCoverage) {
				const scenariosForJob = scenariosToAnalyze.filter((s) => s.scenario.job === job);
				const totalJobSteps = scenariosForJob.reduce(
					(sum, s) => sum + (s.scenario.steps?.length ?? 0),
					0
				);
				jobCoverage.avgSteps = Math.round(totalJobSteps / scenariosForJob.length);
			}
		}

		// Build arrays
		const commandCoverage = Array.from(commandMap.values()).sort(
			(a, b) => b.stepCount - a.stepCount
		);
		const errorCoverage = Array.from(errorMap.values()).sort(
			(a, b) => b.scenarioCount - a.scenarioCount
		);
		const jobCoverage = Array.from(jobMap.values()).sort(
			(a, b) => b.scenarioCount - a.scenarioCount
		);

		// Calculate summary
		const testedCommands = new Set(commandMap.keys());
		const testedErrors = new Set(errorMap.keys());

		const summary: CoverageSummary = {
			totalScenarios: scenariosToAnalyze.length,
			totalSteps,
			commands: {
				tested: testedCommands.size,
			},
			errors: {
				tested: testedErrors.size,
			},
			jobs: {
				count: jobMap.size,
				names: Array.from(jobMap.keys()),
			},
		};

		// Calculate coverage against known values
		if (input.knownCommands && input.knownCommands.length > 0) {
			summary.commands.known = input.knownCommands.length;
			summary.commands.untested = input.knownCommands.filter((cmd) => !testedCommands.has(cmd));
			summary.commands.coverage =
				((summary.commands.known - summary.commands.untested.length) / summary.commands.known) *
				100;
		}

		if (input.knownErrors && input.knownErrors.length > 0) {
			summary.errors.known = input.knownErrors.length;
			summary.errors.untested = input.knownErrors.filter((err) => !testedErrors.has(err));
			summary.errors.coverage =
				((summary.errors.known - summary.errors.untested.length) / summary.errors.known) * 100;
		}

		// Format output
		let formattedOutput: string | undefined;
		const output: ScenarioCoverageOutput = {
			summary,
			commandCoverage,
			errorCoverage,
			jobCoverage,
		};

		switch (input.format) {
			case 'json':
				formattedOutput = JSON.stringify(output, null, 2);
				break;
			case 'markdown':
				formattedOutput = formatCoverageMarkdown(output);
				break;
			default:
				formattedOutput = formatCoverageTerminal(output);
				break;
		}

		output.formattedOutput = formattedOutput;
		if (input.output) {
			await fs.promises.writeFile(input.output, formattedOutput);
		}

		return success(output, {
			reasoning: `Analyzed ${summary.totalScenarios} scenarios covering ${summary.commands.tested} commands and ${summary.jobs.count} jobs`,
			confidence:
				summary.commands.coverage !== undefined ? summary.commands.coverage / 100 : undefined,
			warnings:
				parseErrors.length > 0
					? parseErrors.map((message) => ({ code: 'PARSE_ERROR', message }))
					: undefined,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return failure({
			code: 'COVERAGE_ERROR',
			message: `Failed to calculate coverage: ${message}`,
			suggestion: 'Check the scenario paths and the output path, then run again',
		});
	}
}
