/**
 * @fileoverview Shared MCP tool call routing — dispatches tool calls to the
 * appropriate execution function (batch, pipeline, call, lazy discovery, grouped, or individual).
 *
 * Used by both stdio and HTTP transports to eliminate routing duplication.
 */

import type {
	BatchRequest,
	BatchResult,
	CommandContext,
	CommandResult,
	PipelineRequest,
	PipelineResult,
} from '@lushly-dev/afd-core';
import { failure, isBatchRequest, isPipelineRequest, truncateName } from '@lushly-dev/afd-core';
import type { ContextState } from './bootstrap/afd-context.js';
import {
	commandAction,
	commandGroup,
	filterByContext,
	type GroupByFn,
	isAccessibleInContext,
	notFoundSuggestion,
	notInContextError,
} from './command-routing.js';
import { resolveContextState } from './context-scope.js';
import { executeDetail, executeDiscover } from './lazy-tools.js';
import {
	batchArgsSchema,
	callArgsSchema,
	checkMetaArgs,
	detailArgsSchema,
	discoverArgsSchema,
	parseMetaArgs,
	pipeArgsSchema,
} from './meta-tools.js';
import type { ZodCommandDefinition } from './schema.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ToolCallResult {
	content: Array<{ type: string; text: string }>;
	isError: boolean;
}

export interface ToolRouterDeps {
	executeCommand: (
		name: string,
		input: unknown,
		context?: CommandContext
	) => Promise<CommandResult>;
	executeBatch: (request: BatchRequest, context?: CommandContext) => Promise<BatchResult>;
	executePipeline: (request: PipelineRequest, context?: CommandContext) => Promise<PipelineResult>;
	commands: ZodCommandDefinition[];
	toolStrategy: 'individual' | 'grouped' | 'lazy';
	groupByFn?: GroupByFn;
	devMode: boolean;
	/** All registered commands, including those outside the commands array */
	allCommands?: ZodCommandDefinition[];
	/** Set of command names exposed via the server's commands array */
	exposedCommandNames?: Set<string>;
	/** Context state used when the call context carries none (stdio and tests). */
	contextState?: ContextState;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMPTY PIPELINE RESULT (for invalid pipeline requests)
// ═══════════════════════════════════════════════════════════════════════════════

const emptyPipelineResult = {
	data: undefined,
	metadata: {
		confidence: 0,
		confidenceBreakdown: [],
		reasoning: [],
		warnings: [],
		sources: [],
		alternatives: [],
		executionTimeMs: 0,
		completedSteps: 0,
		totalSteps: 0,
	},
	steps: [],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Wrap a result as MCP tool content. The JSON is compact: the text is read by an
 * agent, and indentation only adds tokens.
 */
function resultContent(data: unknown, isError: boolean): ToolCallResult {
	return {
		content: [{ type: 'text', text: JSON.stringify(data) }],
		isError,
	};
}

/**
 * The `COMMAND_NOT_IN_CONTEXT` tool result when `cmd` exists but is outside the
 * active context; undefined otherwise (a missing command is left to execution).
 */
function contextDenial(
	cmd: ZodCommandDefinition | undefined,
	commandName: string,
	contextState: ContextState | null | undefined
): ToolCallResult | undefined {
	const activeContext = contextState?.getActive();
	if (!cmd || !activeContext || isAccessibleInContext(cmd, activeContext)) return undefined;
	return resultContent(
		{ success: false, error: notInContextError(commandName, activeContext) },
		true
	);
}

/**
 * Create a tool call router that dispatches to the appropriate execution function.
 */
export function createToolRouter(deps: ToolRouterDeps) {
	const {
		executeCommand,
		executeBatch,
		executePipeline,
		commands,
		toolStrategy,
		groupByFn,
		devMode,
		allCommands,
		exposedCommandNames,
	} = deps;

	/**
	 * Route one tool call.
	 *
	 * @param callContext - Base `CommandContext` for commands this call runs (request values,
	 *   `signal`, and the caller's context state); each execution adds its own `traceId`.
	 */
	return async function routeToolCall(
		toolName: string,
		args: unknown,
		callContext: CommandContext = {}
	): Promise<ToolCallResult> {
		const contextState = resolveContextState(callContext, deps.contextState);
		const traced = (prefix: string): CommandContext => ({
			...callContext,
			traceId: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		});

		// Handle afd-call (available in all strategies)
		if (toolName === 'afd-call') {
			const parsed = parseMetaArgs(
				toolName,
				callArgsSchema,
				args,
				'Provide { command: "command-name", input: {...} }'
			);
			if (!parsed.success) return resultContent(parsed.result, true);
			const { command: commandName, input } = parsed.data;

			// Check if command exists in the exposed commands
			const cmd = commands.find((c) => c.name === commandName);
			if (!cmd) {
				// Check if it exists but isn't exposed
				const allCmd = allCommands?.find((c) => c.name === commandName);
				if (allCmd) {
					return resultContent(
						{
							success: false,
							error: {
								code: 'COMMAND_NOT_EXPOSED',
								message: `Command '${commandName}' exists but is not exposed via this server`,
								suggestion:
									"This command is registered but not included in the server's commands array.",
							},
						},
						true
					);
				}
				// Not found at all — suggest a few close matches the caller can use
				const callable = filterByContext(commands, contextState?.getActive());
				return resultContent(
					{
						success: false,
						error: {
							code: 'COMMAND_NOT_FOUND',
							message: `Command '${truncateName(commandName)}' not found`,
							suggestion: notFoundSuggestion(
								commandName,
								callable.map((c) => c.name)
							),
						},
					},
					true
				);
			}

			// Context check: validate the command is accessible in current context
			const denied = contextDenial(cmd, commandName, contextState);
			if (denied) return denied;

			// Execute through the execution engine (full middleware chain)
			const result = await executeCommand(commandName, input ?? {}, traced('afd-call'));
			return resultContent(result, !result.success);
		}

		// Handle afd-discover (listed by the lazy strategy, routable in all)
		if (toolName === 'afd-discover') {
			const parsed = parseMetaArgs(
				toolName,
				discoverArgsSchema,
				args,
				'Provide optional { category, tag, tagMode, search, includeMutation, limit, offset }'
			);
			if (!parsed.success) return resultContent(parsed.result, true);
			// Filter by active context when context state is available
			const discoverCommands = filterByContext(commands, contextState?.getActive());
			const result = executeDiscover(discoverCommands, parsed.data);
			return resultContent(result, false);
		}

		// Handle afd-detail (listed by the lazy and grouped strategies, routable in all)
		if (toolName === 'afd-detail') {
			const parsed = parseMetaArgs(
				toolName,
				detailArgsSchema,
				args,
				'Provide { command: "command-name" } or { command: ["name-1", "name-2"] } (max 10)'
			);
			if (!parsed.success) return resultContent(parsed.result, true);
			const exposedNames = exposedCommandNames ?? new Set(commands.map((c) => c.name));
			// Filter by active context so agents cannot inspect commands outside their context
			const contextFilteredCmds = filterByContext(
				allCommands ?? commands,
				contextState?.getActive()
			);
			const result = executeDetail(contextFilteredCmds, exposedNames, parsed.data);
			return resultContent(result, false);
		}

		// Handle built-in afd-batch tool
		if (toolName === 'afd-batch') {
			// The Zod schema pinpoints shape errors; isBatchRequest is the envelope check
			// shared with POST /batch. Both report INVALID_BATCH_REQUEST.
			const check = checkMetaArgs(batchArgsSchema, args);
			if (!check.success || !isBatchRequest(args)) {
				const usage = 'Provide { commands: [...] } with command objects';
				return resultContent(
					{
						success: false,
						error: {
							code: 'INVALID_BATCH_REQUEST',
							message: 'Invalid batch request format',
							suggestion: check.success ? usage : `${check.suggestion}. ${usage}`,
							...(!check.success && { details: { errors: check.errors } }),
						},
					},
					true
				);
			}
			const result = await executeBatch(args, traced('batch'));
			return resultContent(result, !result.success);
		}

		// Handle built-in afd-pipe tool
		if (toolName === 'afd-pipe') {
			// As for afd-batch: Zod pinpoints shape errors, and isPipelineRequest checks the
			// whole envelope (including `when` conditions). Both report INVALID_PIPELINE_REQUEST.
			const check = checkMetaArgs(pipeArgsSchema, args);
			if (!check.success || !isPipelineRequest(args)) {
				const usage =
					'Provide steps with nonempty command names, object inputs, valid conditions, and correctly typed options; input must be JSON';
				return resultContent(
					{
						...emptyPipelineResult,
						steps: [
							{
								index: -1,
								command: '',
								status: 'failure',
								executionTimeMs: 0,
								error: {
									code: 'INVALID_PIPELINE_REQUEST',
									message: 'Invalid pipeline request envelope',
									suggestion: check.success ? usage : `${check.suggestion}. ${usage}`,
									...(!check.success && { details: { errors: check.errors } }),
								},
							},
						],
					},
					true
				);
			}
			const result = await executePipeline(args, traced('pipeline'));
			const hasFailed = result.steps.some((s) => s.status === 'failure');
			return resultContent(result, hasFailed);
		}

		// Handle grouped tool calls (when toolStrategy === "grouped")
		if (toolStrategy === 'grouped') {
			const typedArgs = args as { action?: string; params?: unknown } | undefined;
			const action = typedArgs?.action;
			const commandParams = typedArgs?.params ?? {};

			if (devMode) {
				console.error(
					`[MCP Debug] Grouped tool call: toolName=${toolName}, action=${action}, args=${JSON.stringify(args)}`
				);
			}

			if (action && typeof action === 'string') {
				const candidates = commands.filter(
					(command) =>
						commandGroup(command, groupByFn) === toolName && commandAction(command) === action
				);
				if (candidates.length !== 1) {
					return resultContent(
						failure({
							code: candidates.length ? 'AMBIGUOUS_ACTION' : 'COMMAND_NOT_FOUND',
							message: `Action '${truncateName(action)}' does not identify one command in group '${truncateName(toolName)}'`,
							suggestion:
								'Use afd-call with the full command name, or list tools to find a valid action.',
						}),
						true
					);
				}
				const actualCommandName = candidates[0]?.name as string;

				// Context check for grouped strategy
				const denied = contextDenial(candidates[0], actualCommandName, contextState);
				if (denied) return denied;

				const result = await executeCommand(actualCommandName, commandParams, traced('trace'));
				return resultContent(result, !result.success);
			}

			// In grouped mode, if tool is a known group but action is missing/invalid,
			// return a helpful error instead of falling through
			const groupCommands = commands.filter((cmd) => commandGroup(cmd, groupByFn) === toolName);

			if (groupCommands.length > 0) {
				const availableActions = groupCommands.map(commandAction);

				return resultContent(
					{
						success: false,
						error: {
							code: 'INVALID_GROUPED_CALL',
							message: `Grouped tool '${toolName}' requires an 'action' parameter`,
							suggestion: `Provide { action: "<action>", params: {...} }. Available actions: ${availableActions.join(', ')}`,
						},
						_debug: devMode ? { receivedArgs: args } : undefined,
					},
					true
				);
			}
		}

		// Handle user-defined commands (individual mode or direct command calls)
		// Context check: validate the command is accessible in current context
		const denied = contextDenial(
			commands.find((c) => c.name === toolName),
			toolName,
			contextState
		);
		if (denied) return denied;

		const result = await executeCommand(toolName, args ?? {}, traced('trace'));
		return resultContent(result, !result.success);
	};
}
