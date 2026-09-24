/**
 * @fileoverview MCP tool definitions for @lushly-dev/afd-testing
 *
 * The input schemas describe exactly what each tool implements: every
 * parameter listed here is honoured, defaults match the implementation, and
 * unknown parameters are rejected. Paths are resolved against the server's
 * working directory and may not leave it.
 */

/**
 * MCP Tool definition following JSON-RPC 2.0 / MCP spec.
 */
export interface McpTool {
	/** Unique tool name */
	name: string;

	/** Human-readable description */
	description: string;

	/** JSON Schema for input parameters */
	inputSchema: {
		type: 'object';
		properties: Record<string, unknown>;
		required?: string[];
		additionalProperties?: boolean;
	};
}

const PATH_NOTE = "relative to the server's working directory, which it may not leave";

const stringList = (description: string) => ({
	type: 'array',
	items: { type: 'string' },
	description,
});

/**
 * Generate MCP tool definitions for all scenario commands.
 */
export function generateTools(): McpTool[] {
	return [
		{
			name: 'scenario-list',
			description:
				'List JTBD (Jobs-to-be-Done) scenario files. Returns scenario names, jobs, tags, and metadata, plus any files that failed to parse. Use to discover available test scenarios before running them.',
			inputSchema: {
				type: 'object',
				properties: {
					directory: {
						type: 'string',
						description: `Directory to search, ${PATH_NOTE} (default: the working directory)`,
					},
					tags: stringList('Only scenarios that have all of these tags (e.g., ["smoke", "crud"])'),
					job: {
						type: 'string',
						description: 'Only scenarios whose job contains this text (case-insensitive)',
					},
					search: {
						type: 'string',
						description: 'Only scenarios whose name, description or job contains this text',
					},
					recursive: {
						type: 'boolean',
						description: 'Search subdirectories (default: true)',
						default: true,
					},
					sortBy: {
						type: 'string',
						enum: ['name', 'job', 'stepCount'],
						description: 'Sort field (default: name)',
					},
					sortOrder: {
						type: 'string',
						enum: ['asc', 'desc'],
						description: 'Sort order (default: asc)',
					},
				},
				additionalProperties: false,
			},
		},
		{
			name: 'scenario-evaluate',
			description:
				'Execute JTBD scenarios against the configured command handler and return a test report. Supports parallel execution, fail-fast, per-scenario timeouts, and json, junit, markdown or terminal output. Files that fail to parse are reported as error scenarios.',
			inputSchema: {
				type: 'object',
				properties: {
					directory: {
						type: 'string',
						description: `Directory containing scenarios, ${PATH_NOTE} (default: the working directory)`,
					},
					scenarios: stringList(`Specific scenario files to run, ${PATH_NOTE}`),
					tags: stringList('Run only scenarios that have all of these tags'),
					job: {
						type: 'string',
						description: 'Run only scenarios whose job contains this text',
					},
					concurrency: {
						type: 'integer',
						minimum: 1,
						description: 'Number of scenarios to run in parallel (default: 1)',
						default: 1,
					},
					failFast: {
						type: 'boolean',
						description:
							'Stop after the first scenario that fails; the rest are reported as skipped (default: false)',
						default: false,
					},
					stopOnFailure: {
						type: 'boolean',
						description: 'Deprecated alias for failFast',
					},
					timeout: {
						type: 'integer',
						minimum: 1,
						description:
							'Timeout per scenario in milliseconds; a timed-out scenario is cancelled and reported as an error',
					},
					format: {
						type: 'string',
						enum: ['json', 'junit', 'markdown', 'terminal'],
						description: 'Format of formattedOutput and of the output file (default: json)',
						default: 'json',
					},
					output: {
						type: 'string',
						description: `Also write the formatted report to this file, ${PATH_NOTE}`,
					},
				},
				additionalProperties: false,
			},
		},
		{
			name: 'scenario-coverage',
			description:
				'Analyze test coverage of JTBD scenarios against known commands and error codes. Shows which commands are tested and untested, and calculates coverage percentages.',
			inputSchema: {
				type: 'object',
				properties: {
					directory: {
						type: 'string',
						description: `Directory containing scenarios, ${PATH_NOTE} (default: the working directory)`,
					},
					scenarios: stringList(`Specific scenario files to analyze, ${PATH_NOTE}`),
					tags: stringList('Analyze only scenarios that have all of these tags'),
					job: {
						type: 'string',
						description: 'Analyze only scenarios whose job contains this text',
					},
					knownCommands: stringList(
						'All commands that should be tested; enables command coverage percentages'
					),
					knownErrors: stringList(
						'All error codes that should be tested; enables error coverage percentages'
					),
					format: {
						type: 'string',
						enum: ['json', 'markdown', 'terminal'],
						description: 'Format of formattedOutput and of the output file (default: json)',
						default: 'json',
					},
					output: {
						type: 'string',
						description: `Also write the formatted report to this file, ${PATH_NOTE}`,
					},
				},
				additionalProperties: false,
			},
		},
		{
			name: 'scenario-create',
			description:
				'Generate a new JTBD scenario file from a template. Writes <name>.scenario.yaml with the job definition and steps; the generated file always parses.',
			inputSchema: {
				type: 'object',
				properties: {
					name: {
						type: 'string',
						description: 'Scenario name; also the file name. No path separators.',
					},
					job: {
						type: 'string',
						description: 'Job-to-be-done identifier or description',
					},
					description: {
						type: 'string',
						description: 'Scenario description (default: derived from the job)',
					},
					template: {
						type: 'string',
						enum: ['blank', 'crud', 'error-handling', 'workflow'],
						description:
							'Template type (default: blank, one placeholder step to replace with the command under test)',
						default: 'blank',
					},
					directory: {
						type: 'string',
						description: `Output directory, ${PATH_NOTE} (default: the working directory)`,
					},
					filename: {
						type: 'string',
						description: 'File name without extension (default: name). No path separators.',
					},
					commands: stringList(
						'Commands to include, one step each expecting success (replaces the template steps)'
					),
					tags: stringList('Tags to apply to the scenario'),
					fixture: {
						type: 'string',
						description: 'Fixture file to reference, relative to the scenario file',
					},
					overwrite: {
						type: 'boolean',
						description: 'Replace an existing file (default: false)',
						default: false,
					},
				},
				required: ['name', 'job'],
				additionalProperties: false,
			},
		},
		{
			name: 'scenario-suggest',
			description:
				'Get heuristic scenario suggestions: keyword and file-name rules, not an AI model; confidence values are fixed per rule. Strategies: changed-files (commands behind modified files), uncovered (known commands without scenarios), failed (scenarios tagged flaky or failing), command (variations for one command), natural (keywords in a query).',
			inputSchema: {
				type: 'object',
				properties: {
					context: {
						type: 'string',
						enum: ['changed-files', 'uncovered', 'failed', 'command', 'natural'],
						description: 'Suggestion strategy',
					},
					files: stringList('Changed files (for changed-files context)'),
					command: {
						type: 'string',
						description: 'Command to suggest scenarios for (for command context)',
					},
					query: {
						type: 'string',
						description: 'Query whose keywords select suggestions (for natural context)',
					},
					directory: {
						type: 'string',
						description: `Directory containing scenarios, ${PATH_NOTE} (default: the working directory)`,
					},
					knownCommands: stringList('Known commands (for uncovered and natural contexts)'),
					limit: {
						type: 'integer',
						minimum: 1,
						description: 'Maximum suggestions to return (default: 5)',
						default: 5,
					},
					includeSkeleton: {
						type: 'boolean',
						description: 'Include a skeleton scenario with each suggestion (default: false)',
						default: false,
					},
				},
				required: ['context'],
				additionalProperties: false,
			},
		},
	];
}

/**
 * Get a tool definition by name.
 */
export function getTool(name: string): McpTool | undefined {
	return generateTools().find((t) => t.name === name);
}
