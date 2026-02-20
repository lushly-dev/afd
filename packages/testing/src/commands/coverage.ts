/**
 * @lushly-dev/afd-testing - scenario.coverage command
 *
 * Generate coverage metrics for scenarios across multiple dimensions:
 * - Commands: Which commands are being tested
 * - Errors: Which error codes are being tested
 * - Jobs: What user jobs are covered
 */

import { type CommandResult, failure, success } from '@lushly-dev/afd-core';
import { parseScenarioFile } from '../parsers/yaml.js';
import type { Scenario, Step } from '../types/scenario.js';
import { scenarioList } from './list.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Input for scenario.coverage command.
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
 * Output for scenario.coverage command.
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
		// Also check if success: false is expected
		if (step.expect?.success === false && step.expect?.error?.code) {
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
 *   knownCommands: ['todo.create', 'todo.list', 'todo.update', 'todo.delete']
 * });
 * ```
 */
export async function scenarioCoverage(
	input: ScenarioCoverageInput
): Promise<CommandResult<ScenarioCoverageOutput>> {
	try {
		// Collect scenarios to analyze
		const scenariosToAnalyze: Array<{ scenario: Scenario; path: string }> = [];

		if (input.scenarios && input.scenarios.length > 0) {
			// Analyze specific scenarios
			for (const scenarioPath of input.scenarios) {
				const result = await parseScenarioFile(scenarioPath);
				if (result.success) {
					scenariosToAnalyze.push({ scenario: result.scenario, path: scenarioPath });
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
					message: 'Failed to list scenarios',
				});
			}

			// Parse each scenario
			for (const summary of listResult.data.scenarios) {
				const result = await parseScenarioFile(summary.path);
				if (result.success) {
					scenariosToAnalyze.push({ scenario: result.scenario, path: summary.path });
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
			summary.commands.coverage = (summary.commands.tested / summary.commands.known) * 100;
		}

		if (input.knownErrors && input.knownErrors.length > 0) {
			summary.errors.known = input.knownErrors.length;
			summary.errors.untested = input.knownErrors.filter((err) => !testedErrors.has(err));
			summary.errors.coverage = (summary.errors.tested / summary.errors.known) * 100;
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

		return success(output, {
			reasoning: `Analyzed ${summary.totalScenarios} scenarios covering ${summary.commands.tested} commands and ${summary.jobs.count} jobs`,
			confidence: summary.commands.coverage ? summary.commands.coverage / 100 : undefined,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return failure({
			code: 'COVERAGE_ERROR',
			message: `Failed to calculate coverage: ${message}`,
		});
	}
}

// ============================================================================
// Output Formatters
// ============================================================================

/**
 * Format coverage for terminal output.
 */
export function formatCoverageTerminal(output: ScenarioCoverageOutput): string {
	const lines: string[] = [];
	const { summary, commandCoverage, jobCoverage } = output;

	lines.push('');
	lines.push('JTBD Scenario Coverage');
	lines.push('━'.repeat(60));
	lines.push('');

	// Summary
	lines.push(`Scenarios: ${summary.totalScenarios}`);
	lines.push(`Steps: ${summary.totalSteps}`);
	lines.push(
		`Commands tested: ${summary.commands.tested}${summary.commands.known ? ` / ${summary.commands.known}` : ''}`
	);
	if (summary.commands.coverage !== undefined) {
		lines.push(`Command coverage: ${summary.commands.coverage.toFixed(1)}%`);
	}
	lines.push(`Error codes tested: ${summary.errors.tested}`);
	lines.push(`Jobs covered: ${summary.jobs.count}`);
	lines.push('');

	// Untested commands
	if (summary.commands.untested && summary.commands.untested.length > 0) {
		lines.push('⚠️  Untested commands:');
		for (const cmd of summary.commands.untested) {
			lines.push(`   - ${cmd}`);
		}
		lines.push('');
	}

	// Top commands by usage
	lines.push('Top commands by usage:');
	const topCommands = commandCoverage.slice(0, 5);
	for (const cmd of topCommands) {
		const errorFlag = cmd.hasErrorTests ? ' ✓errors' : '';
		lines.push(
			`  ${cmd.command}: ${cmd.stepCount} steps in ${cmd.scenarioCount} scenarios${errorFlag}`
		);
	}
	lines.push('');

	// Jobs
	lines.push('Jobs:');
	for (const job of jobCoverage) {
		const tags = job.tags.length > 0 ? ` [${job.tags.join(', ')}]` : '';
		lines.push(`  ${job.job}: ${job.scenarioCount} scenarios (~${job.avgSteps} steps)${tags}`);
	}
	lines.push('');

	return lines.join('\n');
}

/**
 * Format coverage as Markdown.
 */
export function formatCoverageMarkdown(output: ScenarioCoverageOutput): string {
	const lines: string[] = [];
	const { summary, commandCoverage, errorCoverage, jobCoverage } = output;

	lines.push('# JTBD Scenario Coverage Report');
	lines.push('');

	// Summary
	lines.push('## Summary');
	lines.push('');
	lines.push('| Metric | Value |');
	lines.push('|--------|-------|');
	lines.push(`| Scenarios | ${summary.totalScenarios} |`);
	lines.push(`| Total Steps | ${summary.totalSteps} |`);
	lines.push(
		`| Commands Tested | ${summary.commands.tested}${summary.commands.known ? ` / ${summary.commands.known}` : ''} |`
	);
	if (summary.commands.coverage !== undefined) {
		lines.push(`| Command Coverage | ${summary.commands.coverage.toFixed(1)}% |`);
	}
	lines.push(`| Error Codes Tested | ${summary.errors.tested} |`);
	lines.push(`| Jobs Covered | ${summary.jobs.count} |`);
	lines.push('');

	// Untested
	if (summary.commands.untested && summary.commands.untested.length > 0) {
		lines.push('### ⚠️ Untested Commands');
		lines.push('');
		for (const cmd of summary.commands.untested) {
			lines.push(`- \`${cmd}\``);
		}
		lines.push('');
	}

	// Command coverage table
	lines.push('## Command Coverage');
	lines.push('');
	lines.push('| Command | Scenarios | Steps | Error Tests |');
	lines.push('|---------|-----------|-------|-------------|');
	for (const cmd of commandCoverage) {
		lines.push(
			`| \`${cmd.command}\` | ${cmd.scenarioCount} | ${cmd.stepCount} | ${cmd.hasErrorTests ? '✅' : '❌'} |`
		);
	}
	lines.push('');

	// Error coverage table
	if (errorCoverage.length > 0) {
		lines.push('## Error Coverage');
		lines.push('');
		lines.push('| Error Code | Scenarios |');
		lines.push('|------------|-----------|');
		for (const err of errorCoverage) {
			lines.push(`| \`${err.errorCode}\` | ${err.scenarioCount} |`);
		}
		lines.push('');
	}

	// Job coverage table
	lines.push('## Job Coverage');
	lines.push('');
	lines.push('| Job | Scenarios | Avg Steps | Tags |');
	lines.push('|-----|-----------|-----------|------|');
	for (const job of jobCoverage) {
		const tags = job.tags.join(', ') || '-';
		lines.push(`| ${job.job} | ${job.scenarioCount} | ${job.avgSteps} | ${tags} |`);
	}
	lines.push('');

	return lines.join('\n');
}
