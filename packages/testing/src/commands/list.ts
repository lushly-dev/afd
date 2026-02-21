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

	/** Filter by last run status */
	status?: 'passed' | 'failed' | 'unknown';

	/** Search in name/description */
	search?: string;

	/** Sort by field */
	sortBy?: 'name' | 'job' | 'stepCount' | 'lastRun';

	/** Sort order */
	sortOrder?: 'asc' | 'desc';

	/** Output format */
	format?: 'table' | 'json' | 'names';

	/** Glob pattern for scenario files (default: **\/*.scenario.yaml) */
	pattern?: string;
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
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Find scenario files in a directory.
 */
async function findScenarioFiles(directory: string, pattern?: string): Promise<string[]> {
	const scenarioFiles: string[] = [];
	const _globPattern = pattern ?? '**/*.scenario.yaml';

	// Simple recursive search (no glob library needed for basic case)
	async function searchDir(dir: string): Promise<void> {
		try {
			const entries = await fs.promises.readdir(dir, { withFileTypes: true });

			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);

				if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
					await searchDir(fullPath);
				} else if (entry.isFile() && entry.name.endsWith('.scenario.yaml')) {
					scenarioFiles.push(fullPath);
				}
			}
		} catch {
			// Ignore directories we can't read
		}
	}

	await searchDir(directory);
	return scenarioFiles;
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

	// Filter by status
	if (input.status) {
		filtered = filtered.filter((s) => s.lastRunStatus === input.status);
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
	try {
		const directory = input.directory ?? process.cwd();

		// Find scenario files
		const files = await findScenarioFiles(directory, input.pattern);

		if (files.length === 0) {
			return success(
				{
					total: 0,
					filtered: 0,
					scenarios: [],
					filters: {
						job: input.job,
						tags: input.tags,
						status: input.status,
						search: input.search,
					},
				},
				{
					reasoning: `No scenario files found in ${directory}`,
				}
			);
		}

		// Parse all scenario files
		const scenarios: ScenarioSummary[] = [];
		const parseErrors: string[] = [];

		for (const file of files) {
			const result = await parseScenarioFile(file);
			if (result.success) {
				scenarios.push(scenarioToSummary(result.scenario, file));
			} else {
				parseErrors.push(`${file}: ${result.error}`);
			}
		}

		// Apply filters
		const filtered = applyFilters(scenarios, input);

		// Sort results
		const sorted = sortScenarios(filtered, input.sortBy, input.sortOrder);

		const output: ScenarioListOutput = {
			total: scenarios.length,
			filtered: sorted.length,
			scenarios: sorted,
			filters: {
				job: input.job,
				tags: input.tags,
				status: input.status,
				search: input.search,
			},
		};

		const reasoning =
			sorted.length === scenarios.length
				? `Found ${sorted.length} scenarios`
				: `Found ${sorted.length} of ${scenarios.length} scenarios matching filters`;

		return success(output, {
			reasoning,
			warnings:
				parseErrors.length > 0
					? parseErrors.map((e) => ({ code: 'PARSE_ERROR', message: e }))
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
