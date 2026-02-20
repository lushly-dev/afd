/**
 * @fileoverview MCP tool definitions for @lushly-dev/afd-testing
 *
 * Generates MCP tool specifications from the scenario commands,
 * allowing AI agents to discover and invoke JTBD testing capabilities.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import { type ScenarioCoverageInput, scenarioCoverage } from '../commands/coverage.js';
import { type ScenarioCreateInput, scenarioCreate } from '../commands/create.js';
import { type ScenarioEvaluateInput, scenarioEvaluate } from '../commands/evaluate.js';
// Import commands directly from their modules
import { type ScenarioListInput, scenarioList } from '../commands/list.js';
import { type ScenarioSuggestInput, scenarioSuggest } from '../commands/suggest.js';
import { type AgentEnhancedResult, enhanceWithAgentHints } from './hints.js';

// ============================================================================
// Types
// ============================================================================

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

/**
 * Handler function type for executing tools.
 */
export type ToolHandler<TInput, TOutput> = (input: TInput) => Promise<AgentEnhancedResult<TOutput>>;

/**
 * Registered tool with handler.
 */
export interface RegisteredTool<TInput = unknown, TOutput = unknown> {
	tool: McpTool;
	handler: ToolHandler<TInput, TOutput>;
}

/**
 * Options for tool execution.
 */
export interface ToolExecutionContext {
	/** Command handler for scenario.evaluate */
	commandHandler?: (name: string, input: unknown) => Promise<CommandResult<unknown>>;

	/** Working directory for file operations */
	cwd?: string;
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Generate MCP tool definitions for all scenario commands.
 */
export function generateTools(): McpTool[] {
	return [
		{
			name: 'scenario.list',
			description:
				'List JTBD (Jobs-to-be-Done) scenario files. Returns scenario names, jobs, tags, and metadata. Use to discover available test scenarios before running them.',
			inputSchema: {
				type: 'object',
				properties: {
					directory: {
						type: 'string',
						description: 'Directory to search for scenarios (default: ./scenarios)',
					},
					tags: {
						type: 'array',
						items: { type: 'string' },
						description: 'Filter scenarios by tags (e.g., ["smoke", "crud"])',
					},
					job: {
						type: 'string',
						description: 'Filter scenarios by job name pattern',
					},
					recursive: {
						type: 'boolean',
						description: 'Search subdirectories recursively (default: true)',
					},
				},
				additionalProperties: false,
			},
		},
		{
			name: 'scenario.evaluate',
			description:
				'Execute JTBD scenarios and return detailed test results. Runs scenarios against a command handler, supports parallel execution, and outputs in multiple formats (json, junit, markdown).',
			inputSchema: {
				type: 'object',
				properties: {
					directory: {
						type: 'string',
						description: 'Directory containing scenarios',
					},
					scenarios: {
						type: 'array',
						items: { type: 'string' },
						description: 'Specific scenario files to run',
					},
					tags: {
						type: 'array',
						items: { type: 'string' },
						description: 'Run scenarios matching these tags',
					},
					job: {
						type: 'string',
						description: 'Run scenarios matching this job pattern',
					},
					concurrency: {
						type: 'number',
						description: 'Number of scenarios to run in parallel (default: 1)',
					},
					stopOnFailure: {
						type: 'boolean',
						description: 'Stop execution on first failure (default: false)',
					},
					format: {
						type: 'string',
						enum: ['json', 'junit', 'markdown'],
						description: 'Output format (default: json)',
					},
					output: {
						type: 'string',
						description: 'Write results to this file path',
					},
					verbose: {
						type: 'boolean',
						description: 'Include detailed step-by-step output',
					},
				},
				required: [],
				additionalProperties: false,
			},
		},
		{
			name: 'scenario.coverage',
			description:
				'Analyze test coverage of JTBD scenarios against known commands. Shows which commands are tested, untested, and calculates coverage percentage.',
			inputSchema: {
				type: 'object',
				properties: {
					directory: {
						type: 'string',
						description: 'Directory containing scenarios',
					},
					knownCommands: {
						type: 'array',
						items: { type: 'string' },
						description: 'List of all commands that should be tested',
					},
					format: {
						type: 'string',
						enum: ['json', 'markdown'],
						description: 'Output format (default: json)',
					},
					output: {
						type: 'string',
						description: 'Write coverage report to this file',
					},
				},
				required: ['knownCommands'],
				additionalProperties: false,
			},
		},
		{
			name: 'scenario.create',
			description:
				'Generate a new JTBD scenario file from a template. Creates properly structured YAML with job definition, setup, and steps.',
			inputSchema: {
				type: 'object',
				properties: {
					name: {
						type: 'string',
						description: 'Scenario name (becomes filename)',
					},
					job: {
						type: 'string',
						description: 'Job-to-be-done description',
					},
					template: {
						type: 'string',
						enum: ['basic', 'crud', 'workflow', 'validation'],
						description: 'Template type (default: basic)',
					},
					directory: {
						type: 'string',
						description: 'Output directory (default: ./scenarios)',
					},
					commands: {
						type: 'array',
						items: { type: 'string' },
						description: 'Commands to include in the scenario',
					},
					tags: {
						type: 'array',
						items: { type: 'string' },
						description: 'Tags to apply to the scenario',
					},
				},
				required: ['name', 'job'],
				additionalProperties: false,
			},
		},
		{
			name: 'scenario.suggest',
			description:
				'Get AI-powered scenario suggestions based on context. Supports multiple strategies: changed-files (suggest based on modified code), uncovered (suggest for untested commands), failed (suggest based on recent failures), command (suggest for a specific command), natural (natural language query).',
			inputSchema: {
				type: 'object',
				properties: {
					context: {
						type: 'string',
						enum: ['changed-files', 'uncovered', 'failed', 'command', 'natural'],
						description: 'Context type for suggestions',
					},
					files: {
						type: 'array',
						items: { type: 'string' },
						description: 'Changed files (for changed-files context)',
					},
					command: {
						type: 'string',
						description: 'Specific command to suggest scenarios for (for command context)',
					},
					query: {
						type: 'string',
						description: 'Natural language query (for natural context)',
					},
					directory: {
						type: 'string',
						description: 'Directory containing scenarios',
					},
					knownCommands: {
						type: 'array',
						items: { type: 'string' },
						description: 'Known commands for coverage analysis',
					},
					limit: {
						type: 'number',
						description: 'Maximum suggestions to return (default: 5)',
					},
					includeSkeleton: {
						type: 'boolean',
						description: 'Include skeleton scenario in suggestions',
					},
				},
				required: ['context'],
				additionalProperties: false,
			},
		},
	];
}

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Validate input against expected types (simple runtime validation).
 */
function validateInput<T>(input: unknown, requiredFields: string[] = []): T {
	if (input === null || input === undefined) {
		return {} as T;
	}
	if (typeof input !== 'object') {
		throw new Error('Input must be an object');
	}
	const obj = input as Record<string, unknown>;
	for (const field of requiredFields) {
		if (!(field in obj) || obj[field] === undefined) {
			throw new Error(`Missing required field: ${field}`);
		}
	}
	return input as T;
}

/**
 * Create a tool registry with handlers.
 */
export function createToolRegistry(
	context: ToolExecutionContext = {}
): Map<string, RegisteredTool> {
	const registry = new Map<string, RegisteredTool>();
	const tools = generateTools();

	// scenario.list
	const listTool = tools.find((t) => t.name === 'scenario.list');
	if (!listTool) throw new Error('Expected scenario.list tool');
	registry.set('scenario.list', {
		tool: listTool,
		handler: async (input: unknown) => {
			const parsed = validateInput<ScenarioListInput>(input);
			const result = await scenarioList(parsed);
			return enhanceWithAgentHints('scenario.list', result);
		},
	});

	// scenario.evaluate
	const evaluateTool = tools.find((t) => t.name === 'scenario.evaluate');
	if (!evaluateTool) throw new Error('Expected scenario.evaluate tool');
	registry.set('scenario.evaluate', {
		tool: evaluateTool,
		handler: async (input: unknown) => {
			const parsed = validateInput<ScenarioEvaluateInput>(input);

			// If no handler provided, return error with helpful message
			if (!context.commandHandler) {
				const errorResult: CommandResult<never> = {
					success: false,
					error: {
						code: 'HANDLER_NOT_CONFIGURED',
						message: 'No command handler configured for scenario evaluation',
						suggestion: 'Provide a commandHandler in the MCP server context',
					},
				};
				return enhanceWithAgentHints('scenario.evaluate', errorResult);
			}

			const result = await scenarioEvaluate({
				...parsed,
				handler: context.commandHandler,
			});
			return enhanceWithAgentHints('scenario.evaluate', result);
		},
	});

	// scenario.coverage
	const coverageTool = tools.find((t) => t.name === 'scenario.coverage');
	if (!coverageTool) throw new Error('Expected scenario.coverage tool');
	registry.set('scenario.coverage', {
		tool: coverageTool,
		handler: async (input: unknown) => {
			const parsed = validateInput<ScenarioCoverageInput>(input, ['knownCommands']);
			const result = await scenarioCoverage(parsed);
			return enhanceWithAgentHints('scenario.coverage', result);
		},
	});

	// scenario.create
	const createTool = tools.find((t) => t.name === 'scenario.create');
	if (!createTool) throw new Error('Expected scenario.create tool');
	registry.set('scenario.create', {
		tool: createTool,
		handler: async (input: unknown) => {
			const parsed = validateInput<ScenarioCreateInput>(input, ['name', 'job']);
			const result = await scenarioCreate(parsed);
			return enhanceWithAgentHints('scenario.create', result);
		},
	});

	// scenario.suggest
	const suggestTool = tools.find((t) => t.name === 'scenario.suggest');
	if (!suggestTool) throw new Error('Expected scenario.suggest tool');
	registry.set('scenario.suggest', {
		tool: suggestTool,
		handler: async (input: unknown) => {
			const parsed = validateInput<ScenarioSuggestInput>(input, ['context']);
			const result = await scenarioSuggest(parsed);
			return enhanceWithAgentHints('scenario.suggest', result);
		},
	});

	return registry;
}

/**
 * Get a tool definition by name.
 */
export function getTool(name: string): McpTool | undefined {
	return generateTools().find((t) => t.name === name);
}

/**
 * Execute a tool by name with the given input.
 */
export async function executeTool<T>(
	registry: Map<string, RegisteredTool>,
	name: string,
	input: unknown
): Promise<AgentEnhancedResult<T>> {
	const registered = registry.get(name);

	if (!registered) {
		const errorResult: CommandResult<never> = {
			success: false,
			error: {
				code: 'UNKNOWN_TOOL',
				message: `Tool '${name}' not found`,
				suggestion: `Available tools: ${Array.from(registry.keys()).join(', ')}`,
			},
		};
		return enhanceWithAgentHints(name, errorResult) as AgentEnhancedResult<T>;
	}

	return registered.handler(input) as Promise<AgentEnhancedResult<T>>;
}
