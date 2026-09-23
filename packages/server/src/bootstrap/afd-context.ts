/**
 * @fileoverview afd-context bootstrap commands
 *
 * Context management commands for dynamic tool scoping.
 * Always available regardless of active context (universal tools).
 */

import type { CommandDefinition, CommandResult } from '@lushly-dev/afd-core';
import { failure, success } from '@lushly-dev/afd-core';
import { z } from 'zod';
import { resolveContextState } from '../context-scope.js';
import type { ContextConfig } from '../server-types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT STATE
// ═══════════════════════════════════════════════════════════════════════════════

/** Default maximum depth of a context stack. */
export const DEFAULT_CONTEXT_MAX_DEPTH = 16;

export interface ContextState {
	stack: string[];
	/** Maximum stack depth (default: 16). `afd-context-enter` fails once it is reached. */
	maxDepth?: number;
	getActive(): string | null;
	enter(name: string): void;
	exit(): string | null;
}

/**
 * Create a context state manager: one stack of entered contexts.
 *
 * The MCP server keeps one for stdio and one per HTTP session. Re-entering the active context
 * is a no-op, and `enter` throws once `maxDepth` contexts are stacked.
 */
export function createContextState(options: { maxDepth?: number } = {}): ContextState {
	const maxDepth = options.maxDepth ?? DEFAULT_CONTEXT_MAX_DEPTH;
	if (!Number.isSafeInteger(maxDepth) || maxDepth <= 0) {
		throw new Error('Context maxDepth must be a positive integer');
	}
	const stack: string[] = [];

	return {
		stack,
		maxDepth,
		getActive() {
			return stack.length > 0 ? (stack[stack.length - 1] ?? null) : null;
		},
		enter(name: string) {
			if (stack[stack.length - 1] === name) return;
			if (stack.length >= maxDepth) {
				throw new Error(`Context stack is limited to ${maxDepth} levels`);
			}
			stack.push(name);
		},
		exit() {
			return stack.pop() ?? null;
		},
	};
}

/** Failure for context changes requested by a caller that has no session to hold them. */
function sessionRequired(): CommandResult<never> {
	return failure({
		code: 'SESSION_REQUIRED',
		message: 'Entering or exiting a context needs an MCP session, and this request has none',
		suggestion:
			'Send an MCP initialize request to /message and repeat its Mcp-Session-Id response header on later requests',
	});
}

// ═══════════════════════════════════════════════════════════════════════════════
// afd-context-list
// ═══════════════════════════════════════════════════════════════════════════════

const listInputSchema = z.object({});

interface ContextInfo {
	name: string;
	description?: string;
	triggers?: string[];
	priority?: number;
}

interface ContextListOutput {
	contexts: ContextInfo[];
	activeContext: string | null;
}

/**
 * Create the afd-context-list bootstrap command.
 */
export function createAfdContextListCommand(
	getContexts: () => ContextConfig[],
	contextState: ContextState
): CommandDefinition<z.infer<typeof listInputSchema>, ContextListOutput> {
	return {
		name: 'afd-context-list',
		description: 'List all configured contexts with descriptions, priorities, and triggers',
		category: 'bootstrap',
		tags: ['bootstrap', 'read', 'safe', 'context'],
		mutation: false,
		version: '1.0.0',
		parameters: [],

		async handler(_input, context) {
			const activeContext = resolveContextState(context, contextState)?.getActive() ?? null;
			const configs = getContexts();
			const contexts: ContextInfo[] = configs
				.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
				.map((c) => ({
					name: c.name,
					...(c.description && { description: c.description }),
					...(c.triggers?.length && { triggers: c.triggers }),
					...(c.priority != null && { priority: c.priority }),
				}));

			return success(
				{
					contexts,
					activeContext,
				},
				{
					reasoning: `Found ${contexts.length} configured contexts. Active: ${activeContext ?? 'none'}`,
					confidence: 1.0,
				}
			);
		},
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// afd-context-enter
// ═══════════════════════════════════════════════════════════════════════════════

const enterInputSchema = z.object({
	context: z.string().min(1).describe('Context name to enter'),
});

interface ContextEnterOutput {
	entered: string;
	previous: string | null;
}

/**
 * Create the afd-context-enter bootstrap command.
 */
export function createAfdContextEnterCommand(
	getContexts: () => ContextConfig[],
	contextState: ContextState
): CommandDefinition<z.infer<typeof enterInputSchema>, ContextEnterOutput> {
	return {
		name: 'afd-context-enter',
		description: 'Enter a context to scope available tools',
		category: 'bootstrap',
		tags: ['bootstrap', 'write', 'context'],
		mutation: true,
		version: '1.0.0',
		parameters: [
			{ name: 'context', type: 'string', required: true, description: 'Context name to enter' },
		],

		async handler(input: z.infer<typeof enterInputSchema>, context) {
			const state = resolveContextState(context, contextState);
			if (!state) return sessionRequired();
			const configs = getContexts();
			const contextName = input.context;

			const exists = configs.some((c) => c.name === contextName);
			if (!exists) {
				const available = configs.map((c) => c.name).join(', ');
				return failure({
					code: 'CONTEXT_NOT_FOUND',
					message: `Context '${contextName}' is not configured`,
					suggestion: `Available contexts: ${available}. Use afd-context-list to see all contexts.`,
				});
			}

			const previous = state.getActive();
			if (previous === contextName) {
				return success(
					{ entered: contextName, previous },
					{ reasoning: `Already in context '${contextName}'; nothing changed`, confidence: 1.0 }
				);
			}
			const maxDepth = state.maxDepth ?? DEFAULT_CONTEXT_MAX_DEPTH;
			if (state.stack.length >= maxDepth) {
				return failure({
					code: 'CONTEXT_DEPTH_EXCEEDED',
					message: `Context stack is limited to ${maxDepth} levels`,
					suggestion: 'Call afd-context-exit to leave a context before entering another',
				});
			}
			state.enter(contextName);

			return success(
				{ entered: contextName, previous },
				{
					reasoning: `Entered context '${contextName}'${previous ? ` (was '${previous}')` : ''}`,
					confidence: 1.0,
				}
			);
		},
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// afd-context-exit
// ═══════════════════════════════════════════════════════════════════════════════

const exitInputSchema = z.object({});

interface ContextExitOutput {
	exited: string | null;
	current: string | null;
}

/**
 * Create the afd-context-exit bootstrap command.
 */
export function createAfdContextExitCommand(
	contextState: ContextState
): CommandDefinition<z.infer<typeof exitInputSchema>, ContextExitOutput> {
	return {
		name: 'afd-context-exit',
		description: 'Exit the current context, popping back to the previous one',
		category: 'bootstrap',
		tags: ['bootstrap', 'write', 'context'],
		mutation: true,
		version: '1.0.0',
		parameters: [],

		async handler(_input, context) {
			const state = resolveContextState(context, contextState);
			if (!state) return sessionRequired();
			const exited = state.exit();
			const current = state.getActive();

			return success(
				{ exited, current },
				{
					reasoning: exited
						? `Exited context '${exited}'${current ? `, now in '${current}'` : ', no active context'}`
						: 'No active context to exit',
					confidence: 1.0,
				}
			);
		},
	};
}
