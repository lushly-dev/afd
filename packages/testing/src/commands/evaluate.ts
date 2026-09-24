/**
 * @lushly-dev/afd-testing - scenario-evaluate command
 *
 * Batch execution of scenarios with parallel support, fail-fast, and multiple output formats.
 */

import * as fs from 'node:fs';
import { type CommandResult, failure, success } from '@lushly-dev/afd-core';
import { parseScenarioFile } from '../parsers/yaml.js';
import { type CommandHandler, InProcessExecutor } from '../runner/executor.js';
import { createTimeoutReason } from '../runner/scenario-runner.js';
import type {
	EnvironmentInfo,
	ScenarioError,
	ScenarioResult,
	StepResult,
	TestReport,
} from '../types/report.js';
import { calculateSummary } from '../types/report.js';
import type { Scenario } from '../types/scenario.js';
import { formatJunit, formatMarkdown, formatTerminal } from './evaluate-format.js';
import { scenarioList } from './list.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Input for scenario-evaluate command.
 */
export interface ScenarioEvaluateInput {
	/** Command handler for in-process execution */
	handler: CommandHandler;

	/** Base directory for scenarios */
	directory?: string;

	/** Specific scenario files to run */
	scenarios?: string[];

	/** Filter by job name */
	job?: string;

	/** Filter by tags */
	tags?: string[];

	/** Stop after the first scenario that fails or errors; the rest are reported as `skip` */
	failFast?: boolean;

	/** Number of parallel executions (default: 1, sequential) */
	concurrency?: number;

	/** Output format */
	format?: 'terminal' | 'json' | 'junit' | 'markdown';

	/** Output file path (optional) */
	output?: string;

	/**
	 * Base path for fixture resolution of scenarios not loaded from a file.
	 * Scenario files resolve fixtures against their own directory.
	 */
	basePath?: string;

	/** Reject fixture files that resolve outside this directory */
	fixtureRoot?: string;

	/**
	 * Timeout per scenario in ms. When it passes, the running step is
	 * abandoned (its handler receives an aborted signal), the remaining steps
	 * are skipped, and the scenario is reported as an `error` with the message.
	 */
	timeout?: number;

	/** Report title */
	title?: string;
}

/**
 * Output for scenario-evaluate command.
 */
export interface ScenarioEvaluateOutput {
	/** Test report */
	report: TestReport;

	/** Exit code (0 = all passed, 1 = failures, errors, or unparseable scenarios) */
	exitCode: number;

	/** Formatted output (if format specified) */
	formattedOutput?: string;
}

/** A scenario to evaluate, or a file that failed to parse. */
interface EvaluationEntry {
	path: string;
	scenario?: Scenario;
	parseError?: string;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Execute a single scenario, cancelling it when the timeout passes.
 */
async function executeWithTimeout(
	executor: InProcessExecutor,
	scenario: Scenario,
	timeout?: number
): Promise<ScenarioResult> {
	if (!timeout) {
		return executor.execute(scenario);
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(createTimeoutReason(timeout)), timeout);
	try {
		return await executor.execute(scenario, { signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

function createErrorResult(path: string, jobName: string, error: ScenarioError): ScenarioResult {
	const now = new Date();
	return {
		scenarioPath: path,
		jobName,
		outcome: 'error',
		durationMs: 0,
		stepResults: [],
		passedSteps: 0,
		failedSteps: 0,
		skippedSteps: 0,
		startedAt: now,
		completedAt: now,
		error,
	};
}

/**
 * Report a scenario that never ran because `failFast` stopped the evaluation.
 */
function createSkipResult(entry: EvaluationEntry, reason: string): ScenarioResult {
	const now = new Date();
	const steps = entry.scenario?.steps ?? [];
	const stepResults: StepResult[] = steps.map((step, index) => ({
		stepId: `step-${index + 1}`,
		command: step.command,
		outcome: 'skip',
		durationMs: 0,
		assertions: [],
		skippedReason: reason,
	}));
	return {
		scenarioPath: entry.path,
		jobName: entry.scenario?.job ?? '',
		jobDescription: entry.scenario?.description,
		outcome: 'skip',
		durationMs: 0,
		stepResults,
		passedSteps: 0,
		failedSteps: 0,
		skippedSteps: stepResults.length,
		startedAt: now,
		completedAt: now,
	};
}

async function runEntry(
	executor: InProcessExecutor,
	entry: EvaluationEntry,
	timeout?: number
): Promise<ScenarioResult> {
	if (!entry.scenario) {
		return createErrorResult(entry.path, '', {
			type: 'parse_error',
			message: entry.parseError ?? 'Scenario could not be parsed',
		});
	}
	try {
		const result = await executeWithTimeout(executor, entry.scenario, timeout);
		result.scenarioPath = entry.path;
		return result;
	} catch (err) {
		return createErrorResult(entry.path, entry.scenario.job, {
			type: 'aborted',
			message: err instanceof Error ? err.message : String(err),
		});
	}
}

/**
 * Execute scenarios with at most `concurrency` running at once. With
 * `failFast`, scenarios not yet started when one fails are reported as
 * `skip`; results keep the input order.
 */
async function executeAll(
	executor: InProcessExecutor,
	entries: EvaluationEntry[],
	concurrency: number,
	timeout?: number,
	failFast?: boolean
): Promise<ScenarioResult[]> {
	const results: ScenarioResult[] = [];
	let next = 0;
	let stopReason: string | undefined;

	const worker = async (): Promise<void> => {
		while (next < entries.length) {
			const index = next++;
			const entry = entries[index];
			if (!entry) continue;
			if (stopReason) {
				results[index] = createSkipResult(entry, stopReason);
				continue;
			}
			const result = await runEntry(executor, entry, timeout);
			results[index] = result;
			if (failFast && !stopReason && ['fail', 'partial', 'error'].includes(result.outcome)) {
				stopReason = `Skipped: failFast stopped the evaluation after ${entry.path} did not pass`;
			}
		}
	};

	const workers = Math.min(concurrency, entries.length);
	await Promise.all(Array.from({ length: workers }, worker));
	return results;
}

/**
 * Build environment info for the report.
 */
function buildEnvironmentInfo(): EnvironmentInfo {
	return {
		nodeVersion: process.version,
		platform: process.platform,
		cwd: process.cwd(),
	};
}

/**
 * Collect the scenarios to evaluate. Files that fail to parse are kept as
 * entries so they are reported as `error` scenarios, never silently skipped.
 */
async function collectEntries(
	input: ScenarioEvaluateInput
): Promise<EvaluationEntry[] | CommandResult<never>> {
	const entries: EvaluationEntry[] = [];

	let paths: string[];
	if (input.scenarios && input.scenarios.length > 0) {
		paths = input.scenarios;
	} else {
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
			entries.push({ path: parseFailure.path, parseError: parseFailure.error });
		}
		paths = listResult.data.scenarios.map((summary) => summary.path);
	}

	for (const path of paths) {
		const result = await parseScenarioFile(path);
		entries.push(
			result.success ? { path, scenario: result.scenario } : { path, parseError: result.error }
		);
	}
	return entries;
}

function formatReport(report: TestReport, format: ScenarioEvaluateInput['format']): string {
	switch (format) {
		case 'json':
			return JSON.stringify(report, null, 2);
		case 'junit':
			return formatJunit(report);
		case 'markdown':
			return formatMarkdown(report);
		default:
			return formatTerminal(report);
	}
}

/**
 * Evaluate multiple scenarios.
 *
 * @example
 * ```typescript
 * // Run all scenarios in a directory
 * const result = await scenarioEvaluate({
 *   handler: commandHandler,
 *   directory: './scenarios'
 * });
 *
 * // Run specific scenarios with fail-fast
 * const result = await scenarioEvaluate({
 *   handler: commandHandler,
 *   scenarios: ['./scenarios/create.scenario.yaml'],
 *   failFast: true
 * });
 *
 * // Run in parallel
 * const result = await scenarioEvaluate({
 *   handler: commandHandler,
 *   directory: './scenarios',
 *   concurrency: 4
 * });
 * ```
 */
export async function scenarioEvaluate(
	input: ScenarioEvaluateInput
): Promise<CommandResult<ScenarioEvaluateOutput>> {
	const startTime = Date.now();
	const concurrency = input.concurrency ?? 1;
	if (!Number.isInteger(concurrency) || concurrency < 1) {
		return failure({
			code: 'INVALID_INPUT',
			message: `concurrency must be a positive integer, got ${concurrency}`,
			suggestion: 'Pass concurrency: 1 to run scenarios one at a time',
		});
	}
	if (input.timeout !== undefined && !(Number.isFinite(input.timeout) && input.timeout > 0)) {
		return failure({
			code: 'INVALID_INPUT',
			message: `timeout must be a positive number of milliseconds, got ${input.timeout}`,
			suggestion: 'Omit timeout to let scenarios run without a deadline',
		});
	}

	try {
		const entries = await collectEntries(input);
		if (!Array.isArray(entries)) {
			return entries;
		}

		const executor = new InProcessExecutor({
			handler: input.handler,
			basePath: input.basePath ?? input.directory,
			fixtureRoot: input.fixtureRoot,
			stopOnFailure: true,
		});
		const results = await executeAll(executor, entries, concurrency, input.timeout, input.failFast);

		const summary = calculateSummary(results);
		const report: TestReport = {
			title: input.title ?? 'JTBD Scenario Evaluation',
			durationMs: Date.now() - startTime,
			scenarios: results,
			summary,
			generatedAt: new Date(),
			environment: buildEnvironmentInfo(),
		};

		const formattedOutput = formatReport(report, input.format);
		if (input.output) {
			await fs.promises.writeFile(input.output, formattedOutput);
		}

		const exitCode = summary.failedScenarios === 0 && summary.errorScenarios === 0 ? 0 : 1;
		const reasoning =
			results.length === 0
				? 'No scenarios to run'
				: `Evaluated ${summary.totalScenarios} scenarios: ${summary.passedScenarios} passed, ${summary.failedScenarios} failed, ${summary.errorScenarios} errors, ${summary.skippedScenarios} skipped`;

		return success(
			{ report, exitCode, formattedOutput },
			{ reasoning, confidence: results.length === 0 ? undefined : summary.passRate }
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return failure({
			code: 'EVALUATE_ERROR',
			message: `Failed to evaluate scenarios: ${message}`,
			suggestion: 'Check the scenario paths and the output path, then run again',
		});
	}
}
