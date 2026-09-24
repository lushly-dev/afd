/**
 * @lushly-dev/afd-testing - scenario-list command
 *
 * Lists available scenarios with filtering by job, tags, and status.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type CommandResult, failure, success } from '@lushly-dev/afd-core';
import { parseScenarioFile } from '../parsers/yaml.js';
import type { Scenario } from '../types/scenario.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Input for scenario-list command.
 */
export interface ScenarioListInput {
	/** Base directory to search for scenarios (default: current directory) */
	directory?: string;

	/** Filter by job name */
	job?: string;

	/** Filter by tags (scenarios must have ALL specified tags) */
	tags?: string[];

	/**
	 * Filter by last run status.
	 *
	 * @deprecated scenario-list keeps no run history, so every scenario's status
	 * is `unknown`. `'unknown'` matches every scenario; `'passed'` and `'failed'`
	 * return an `UNSUPPORTED_FILTER` failure instead of an empty list.
	 */
	status?: 'passed' | 'failed' | 'unknown';

	/** Search subdirectories (default: true) */
	recursive?: boolean;

	/** Search in name/description */
	search?: string;

	/** Sort by field */
	sortBy?: 'name' | 'job' | 'stepCount' | 'lastRun';

	/** Sort order */
	sortOrder?: 'asc' | 'desc';

	/** Also return `formattedOutput` in this format */
	format?: 'table' | 'json' | 'names';

	/**
	 * File name pattern for scenario files, matched against the file name
	 * (`*` and `?` wildcards; a leading `**\/` is ignored). Default: `*.scenario.yaml`
	 */
	pattern?: string;
}

/**
 * A scenario file that could not be parsed.
 */
export interface ScenarioParseFailure {
	/** File path */
	path: string;

	/** Parse error (never includes file contents) */
	error: string;
}

/**
 * Summary of a scenario for listing.
 */
export interface ScenarioSummary {
	/** Scenario name */
	name: string;

	/** Job identifier */
	job: string;

	/** Description */
	description?: string;

	/** File path */
	path: string;

	/** Tags */
	tags: string[];

	/** Number of steps */
	stepCount: number;

	/** Has fixture */
	hasFixture: boolean;

	/** Last run status (if available) */
	lastRunStatus?: 'passed' | 'failed' | 'unknown';

	/** Last run time (if available) */
	lastRunAt?: Date;
}

/**
 * Output for scenario-list command.
 */
export interface ScenarioListOutput {
	/** Total count of matching scenarios */
	total: number;

	/** Filtered count after applying filters */
	filtered: number;

	/** Scenario summaries */
	scenarios: ScenarioSummary[];

	/** Filter applied */
	filters: {
		job?: string;
		tags?: string[];
		status?: string;
		search?: string;
	};

	/** Scenario files that could not be parsed (not included in `scenarios`) */
	parseErrors: ScenarioParseFailure[];

	/** Scenarios formatted as requested by `format` */
	formattedOutput?: string;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Convert a file-name pattern (`*` and `?` wildcards) to a regular expression.
 */
function patternToRegex(pattern: string): RegExp {
	const fileName = pattern.replace(/^(\*\*\/)+/, '');
	const source = fileName
		.split('')
		.map((char) => {
			if (char === '*') return '[^/]*';
			if (char === '?') return '[^/]';
			return char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
		})
		.join('');
	return new RegExp(`^${source}$`);
}

/**
 * Find scenario files in a directory. Symlinks are not followed.
 */
async function findScenarioFiles(
	directory: string,
	pattern: string | undefined,
	recursive: boolean
): Promise<string[]> {
	const scenarioFiles: string[] = [];
	const matcher = patternToRegex(pattern ?? '*.scenario.yaml');

	async function searchDir(dir: string): Promise<void> {
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(dir, { withFileTypes: true });
		} catch {
			// Ignore directories we can't read
			return;
		}

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				if (recursive && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
					await searchDir(fullPath);
				}
			} else if (entry.isFile() && matcher.test(entry.name)) {
				scenarioFiles.push(fullPath);
			}
		}
	}

	await searchDir(directory);
	return scenarioFiles.sort();
}

/**
 * Convert a parsed scenario to a summary.
 */
function scenarioToSummary(scenario: Scenario, filePath: string): ScenarioSummary {
	return {
		name: scenario.name,
		job: scenario.job,
		description: scenario.description,
		path: filePath,
		tags: scenario.tags ?? [],
		stepCount: scenario.steps?.length ?? 0,
		hasFixture: !!scenario.fixture,
		lastRunStatus: 'unknown', // TODO: Load from history file
	};
}

/**
 * Apply filters to scenarios.
 */
function applyFilters(scenarios: ScenarioSummary[], input: ScenarioListInput): ScenarioSummary[] {
	let filtered = scenarios;

	// Filter by job
	if (input.job) {
		const jobLower = input.job.toLowerCase();
		filtered = filtered.filter((s) => s.job.toLowerCase().includes(jobLower));
	}

	// Filter by tags (must have ALL specified tags)
	if (input.tags && input.tags.length > 0) {
		filtered = filtered.filter((s) => input.tags?.every((tag) => s.tags.includes(tag)));
	}

	// Filter by search term
	if (input.search) {
		const searchLower = input.search.toLowerCase();
		filtered = filtered.filter(
			(s) =>
				s.name.toLowerCase().includes(searchLower) ||
				(s.description?.toLowerCase().includes(searchLower) ?? false) ||
				s.job.toLowerCase().includes(searchLower)
		);
	}

	return filtered;
}

/**
 * Sort scenarios.
 */
function sortScenarios(
	scenarios: ScenarioSummary[],
	sortBy?: string,
	sortOrder?: string
): ScenarioSummary[] {
	const order = sortOrder === 'desc' ? -1 : 1;

	return [...scenarios].sort((a, b) => {
		switch (sortBy) {
			case 'job':
				return a.job.localeCompare(b.job) * order;
			case 'stepCount':
				return (a.stepCount - b.stepCount) * order;
			case 'lastRun':
				// TODO: Implement when we have history
				return 0;
			default:
				return a.name.localeCompare(b.name) * order;
		}
	});
}

/**
 * List available scenarios with filtering.
 *
 * @example
 * ```typescript
 * // List all scenarios
 * const result = await scenarioList({ directory: './scenarios' });
 *
 * // Filter by job
 * const result = await scenarioList({
 *   directory: './scenarios',
 *   job: 'token-management'
 * });
 *
 * // Filter by tags
 * const result = await scenarioList({
 *   directory: './scenarios',
 *   tags: ['smoke', 'p0']
 * });
 * ```
 */
export async function scenarioList(
	input: ScenarioListInput = {}
): Promise<CommandResult<ScenarioListOutput>> {
	if (input.status === 'passed' || input.status === 'failed') {
		return failure({
			code: 'UNSUPPORTED_FILTER',
			message: `Cannot filter by status '${input.status}': scenario-list keeps no run history`,
			suggestion:
				'Run scenario-evaluate and read the outcome of each scenario in its report instead',
		});
	}

	try {
		const directory = input.directory ?? process.cwd();
		const filters = {
			job: input.job,
			tags: input.tags,
			status: input.status,
			search: input.search,
		};

		// Find scenario files
		const files = await findScenarioFiles(directory, input.pattern, input.recursive ?? true);

		// Parse all scenario files
		const scenarios: ScenarioSummary[] = [];
		const parseErrors: ScenarioParseFailure[] = [];

		for (const file of files) {
			const result = await parseScenarioFile(file);
			if (result.success) {
				scenarios.push(scenarioToSummary(result.scenario, file));
			} else {
				parseErrors.push({ path: file, error: result.error });
			}
		}

		// Apply filters, then sort
		const sorted = sortScenarios(applyFilters(scenarios, input), input.sortBy, input.sortOrder);

		const output: ScenarioListOutput = {
			total: scenarios.length,
			filtered: sorted.length,
			scenarios: sorted,
			filters,
			parseErrors,
		};
		if (input.format) {
			output.formattedOutput = formatScenarios(sorted, input.format);
		}

		let reasoning: string;
		if (files.length === 0) {
			reasoning = `No scenario files found in ${directory}`;
		} else if (sorted.length === scenarios.length) {
			reasoning = `Found ${sorted.length} scenarios`;
		} else {
			reasoning = `Found ${sorted.length} of ${scenarios.length} scenarios matching filters`;
		}
		if (parseErrors.length > 0) {
			reasoning += `; ${parseErrors.length} file(s) could not be parsed`;
		}

		return success(output, {
			reasoning,
			warnings:
				parseErrors.length > 0
					? parseErrors.map((e) => ({ code: 'PARSE_ERROR', message: `${e.path}: ${e.error}` }))
					: undefined,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return failure({
			code: 'LIST_ERROR',
			message: `Failed to list scenarios: ${message}`,
			suggestion: 'Check that the directory exists and contains .scenario.yaml files',
		});
	}
}

function formatScenarios(scenarios: ScenarioSummary[], format: 'table' | 'json' | 'names'): string {
	switch (format) {
		case 'json':
			return JSON.stringify(scenarios, null, 2);
		case 'names':
			return scenarios.map((s) => s.name).join('\n');
		default:
			return formatScenarioTable(scenarios);
	}
}

/**
 * Format scenarios for terminal output.
 */
export function formatScenarioTable(scenarios: ScenarioSummary[]): string {
	if (scenarios.length === 0) {
		return 'No scenarios found.';
	}

	const lines: string[] = [];

	// Header
	lines.push('┌─────────────────────────────────────────────────────────────────┐');
	lines.push('│ Scenario List                                                   │');
	lines.push('├───────────────────────────────────┬─────────────────┬───────────┤');
	lines.push('│ Name                              │ Job             │ Steps     │');
	lines.push('├───────────────────────────────────┼─────────────────┼───────────┤');

	for (const s of scenarios) {
		const name = s.name.padEnd(33).slice(0, 33);
		const job = s.job.padEnd(15).slice(0, 15);
		const steps = String(s.stepCount).padStart(7);
		lines.push(`│ ${name} │ ${job} │ ${steps}   │`);
	}

	lines.push('└───────────────────────────────────┴─────────────────┴───────────┘');
	lines.push(`\nTotal: ${scenarios.length} scenarios`);

	return lines.join('\n');
}
