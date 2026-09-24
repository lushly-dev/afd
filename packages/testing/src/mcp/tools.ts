/**
 * @fileoverview MCP tool registry for @lushly-dev/afd-testing
 *
 * Binds the tool definitions to the scenario commands. Every call is
 * validated against the tool's input schema, and every path argument is
 * resolved against the context's working directory and rejected if it
 * leaves it (lexically or through a symlinked parent).
 */

import { type CommandResult, failure } from '@lushly-dev/afd-core';
import { scenarioCoverage } from '../commands/coverage.js';
import { scenarioCreate } from '../commands/create.js';
import { scenarioEvaluate } from '../commands/evaluate.js';
import { scenarioList } from '../commands/list.js';
import { type SuggestionContext, scenarioSuggest } from '../commands/suggest.js';
import { PathOutsideRootError, resolveInsideRoot } from '../runner/sandbox.js';
import { type AgentEnhancedResult, enhanceWithAgentHints } from './hints.js';
import { validateToolInput } from './input-validation.js';
import { generateTools, type McpTool } from './tool-schemas.js';

// ============================================================================
// Types
// ============================================================================

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
	/** Command handler for scenario-evaluate */
	commandHandler?: (name: string, input: unknown) => Promise<CommandResult<unknown>>;

	/**
	 * Working directory for file operations (default: process.cwd()). Every
	 * path argument resolves against it, and paths that leave it are rejected.
	 */
	cwd?: string;
}

// ============================================================================
// Argument helpers (arguments are already schema-validated)
// ============================================================================

type Args = Record<string, unknown>;

function str(args: Args, key: string): string | undefined {
	const value = args[key];
	return typeof value === 'string' ? value : undefined;
}

function strs(args: Args, key: string): string[] | undefined {
	const value = args[key];
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: undefined;
}

function bool(args: Args, key: string): boolean | undefined {
	const value = args[key];
	return typeof value === 'boolean' ? value : undefined;
}

function num(args: Args, key: string): number | undefined {
	const value = args[key];
	return typeof value === 'number' ? value : undefined;
}

function oneOf<const T extends string>(
	args: Args,
	key: string,
	values: readonly T[]
): T | undefined {
	const value = args[key];
	return values.find((allowed) => allowed === value);
}

// ============================================================================
// Tool Registry
// ============================================================================

const SUGGESTION_CONTEXTS: readonly SuggestionContext[] = [
	'changed-files',
	'uncovered',
	'failed',
	'command',
	'natural',
];

function toolFailure(name: string, code: string, message: string, suggestion: string) {
	return enhanceWithAgentHints(name, failure({ code, message, suggestion }));
}

/**
 * Wrap a tool implementation with input validation, path containment and
 * agent hints.
 */
function defineTool(
	tool: McpTool,
	run: (
		args: Args,
		inside: (value: string | undefined, label: string) => string | undefined
	) => Promise<CommandResult<unknown>>,
	root: string
): RegisteredTool {
	const inside = (value: string | undefined, label: string) =>
		value === undefined ? undefined : resolveInsideRoot(root, value, label);

	return {
		tool,
		handler: async (input: unknown) => {
			const checked = validateToolInput(tool.inputSchema, input);
			if (!checked.ok) {
				return toolFailure(
					tool.name,
					'VALIDATION_ERROR',
					`Invalid input for ${tool.name}: ${checked.errors.join('; ')}`,
					`Check the ${tool.name} inputSchema from tools/list`
				);
			}
			try {
				return enhanceWithAgentHints(tool.name, await run(checked.value, inside));
			} catch (err) {
				if (err instanceof PathOutsideRootError) {
					return toolFailure(
						tool.name,
						'PATH_OUTSIDE_WORKSPACE',
						err.message,
						"Use a path inside the server's working directory, without '..' segments or symlinks that leave it"
					);
				}
				throw err;
			}
		},
	};
}

/**
 * Create a tool registry with handlers.
 */
export function createToolRegistry(
	context: ToolExecutionContext = {}
): Map<string, RegisteredTool> {
	const root = context.cwd ?? process.cwd();
	const tools = new Map(generateTools().map((tool) => [tool.name, tool]));
	const registry = new Map<string, RegisteredTool>();

	const register = (name: string, run: Parameters<typeof defineTool>[1]) => {
		const tool = tools.get(name);
		if (!tool) throw new Error(`Expected ${name} tool`);
		registry.set(name, defineTool(tool, run, root));
	};

	register('scenario-list', async (args, inside) =>
		scenarioList({
			directory: inside(str(args, 'directory'), 'directory') ?? root,
			tags: strs(args, 'tags'),
			job: str(args, 'job'),
			search: str(args, 'search'),
			recursive: bool(args, 'recursive'),
			sortBy: oneOf(args, 'sortBy', ['name', 'job', 'stepCount']),
			sortOrder: oneOf(args, 'sortOrder', ['asc', 'desc']),
		})
	);

	register('scenario-evaluate', async (args, inside) => {
		if (!context.commandHandler) {
			return failure({
				code: 'HANDLER_NOT_CONFIGURED',
				message: 'No command handler configured for scenario evaluation',
				suggestion: 'Provide a commandHandler in the MCP server context',
			});
		}
		return scenarioEvaluate({
			handler: context.commandHandler,
			directory: inside(str(args, 'directory'), 'directory') ?? root,
			scenarios: strs(args, 'scenarios')?.map((path) => resolveInsideRoot(root, path, 'scenario')),
			tags: strs(args, 'tags'),
			job: str(args, 'job'),
			concurrency: num(args, 'concurrency'),
			failFast: bool(args, 'failFast') ?? bool(args, 'stopOnFailure'),
			timeout: num(args, 'timeout'),
			format: oneOf(args, 'format', ['json', 'junit', 'markdown', 'terminal']) ?? 'json',
			output: inside(str(args, 'output'), 'output'),
			fixtureRoot: root,
		});
	});

	register('scenario-coverage', async (args, inside) =>
		scenarioCoverage({
			directory: inside(str(args, 'directory'), 'directory') ?? root,
			scenarios: strs(args, 'scenarios')?.map((path) => resolveInsideRoot(root, path, 'scenario')),
			tags: strs(args, 'tags'),
			job: str(args, 'job'),
			knownCommands: strs(args, 'knownCommands'),
			knownErrors: strs(args, 'knownErrors'),
			format: oneOf(args, 'format', ['json', 'markdown', 'terminal']) ?? 'json',
			output: inside(str(args, 'output'), 'output'),
		})
	);

	register('scenario-create', async (args, inside) =>
		scenarioCreate({
			name: str(args, 'name') ?? '',
			job: str(args, 'job') ?? '',
			description: str(args, 'description'),
			template: oneOf(args, 'template', ['blank', 'crud', 'error-handling', 'workflow']),
			directory: inside(str(args, 'directory'), 'directory') ?? root,
			filename: str(args, 'filename'),
			commands: strs(args, 'commands'),
			tags: strs(args, 'tags'),
			fixture: str(args, 'fixture'),
			overwrite: bool(args, 'overwrite'),
		})
	);

	register('scenario-suggest', async (args, inside) => {
		const suggestionContext = oneOf<SuggestionContext>(args, 'context', SUGGESTION_CONTEXTS);
		if (!suggestionContext) {
			return failure({
				code: 'VALIDATION_ERROR',
				message: `context must be one of: ${SUGGESTION_CONTEXTS.join(', ')}`,
				suggestion: 'Pass a context from the scenario-suggest inputSchema',
			});
		}
		return scenarioSuggest({
			context: suggestionContext,
			files: strs(args, 'files'),
			command: str(args, 'command'),
			query: str(args, 'query'),
			directory: inside(str(args, 'directory'), 'directory') ?? root,
			knownCommands: strs(args, 'knownCommands'),
			limit: num(args, 'limit'),
			includeSkeleton: bool(args, 'includeSkeleton'),
		});
	});

	return registry;
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
