/**
 * @fileoverview Shared MCP tool call routing — dispatches tool calls to the
 * appropriate execution function (batch, pipeline, grouped, or individual).
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
import { isBatchRequest, isPipelineRequest } from '@lushly-dev/afd-core';
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
	toolStrategy: 'individual' | 'grouped';
	groupByFn?: (command: ZodCommandDefinition) => string | undefined;
	devMode: boolean;
	contextState?: { getActive(): string | null };
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

function resultContent(data: unknown, isError: boolean): ToolCallResult {
	return {
		content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
		isError,
	};
}

/**
 * Check if a command is accessible in the current context.
 * A command is accessible if:
 * - No active context (everything visible)
 * - Command has no contexts array (universal / backward compat)
 * - Command's contexts include the active context
 */
function isCommandAccessible(
	cmd: ZodCommandDefinition | undefined,
	activeContext: string | null
): boolean {
	if (!activeContext) return true;
	if (!cmd) return true; // Let execution handle not-found
	if (!cmd.contexts?.length) return true;
	return cmd.contexts.includes(activeContext);
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
		contextState,
	} = deps;

	return async function routeToolCall(toolName: string, args: unknown): Promise<ToolCallResult> {
		// Handle built-in afd-batch tool
		if (toolName === 'afd-batch') {
			if (!isBatchRequest(args)) {
				return resultContent(
					{
						success: false,
						error: {
							code: 'INVALID_BATCH_REQUEST',
							message: 'Invalid batch request format',
							suggestion: 'Provide { commands: [...] } with command objects',
						},
					},
					true
				);
			}
			const result = await executeBatch(args, {
				traceId: `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			});
			return resultContent(result, !result.success);
		}

		// Handle built-in afd-pipe tool
		if (toolName === 'afd-pipe') {
			if (!isPipelineRequest(args)) {
				return resultContent(emptyPipelineResult, true);
			}
			const result = await executePipeline(args, {
				traceId: `pipeline-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			});
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
				const actualCommandName = `${toolName}-${action}`;
				const result = await executeCommand(actualCommandName, commandParams, {
					traceId: `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`,
				});
				return resultContent(result, !result.success);
			}

			// In grouped mode, if tool is a known group but action is missing/invalid,
			// return a helpful error instead of falling through
			const defaultGroupFn = (c: ZodCommandDefinition): string =>
				c.category || c.name.split('-')[0] || 'general';
			const getGroup = groupByFn || defaultGroupFn;

			const groupNames = new Set(commands.map((cmd) => getGroup(cmd)));

			if (groupNames.has(toolName)) {
				const groupCommands = commands.filter((cmd) => getGroup(cmd) === toolName);
				const availableActions = groupCommands.map((cmd) => {
					const parts = cmd.name.split('-');
					return parts.length > 1 ? parts.slice(1).join('-') : cmd.name;
				});

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
		if (contextState) {
			const activeContext = contextState.getActive();
			const cmd = commands.find((c) => c.name === toolName);
			if (!isCommandAccessible(cmd, activeContext)) {
				return resultContent(
					{
						success: false,
						error: {
							code: 'COMMAND_NOT_IN_CONTEXT',
							message: `Command '${toolName}' is not available in context '${activeContext}'`,
							suggestion:
								'Use afd-context-list to see available contexts, or afd-context-enter to switch.',
						},
					},
					true
				);
			}
		}

		const result = await executeCommand(toolName, args ?? {}, {
			traceId: `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		});
		return resultContent(result, !result.success);
	};
}
