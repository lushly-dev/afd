/**
 * @fileoverview afd-context bootstrap commands
 *
 * Context management commands for dynamic tool scoping.
 * Always available regardless of active context (universal tools).
 */

import type { CommandDefinition, CommandResult } from '@lushly-dev/afd-core';
import { failure, success } from '@lushly-dev/afd-core';
import { z } from 'zod';
import {
	type ContextState,
	DEFAULT_CONTEXT_MAX_DEPTH,
	resolveContextState,
} from '../context-scope.js';
import type { ContextConfig } from '../server-types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT STATE
// ═══════════════════════════════════════════════════════════════════════════════

// The state lives in `context-scope.ts`, beside its binding, so that `createDirectRegistry` can
// scope calls without loading these commands.
export {
	type ContextState,
	createContextState,
	DEFAULT_CONTEXT_MAX_DEPTH,
} from '../context-scope.js';

/** Failure for context changes requested by a caller that has no session to hold them. */
function sessionRequired(): CommandResult<never> {
	return failure({
		code: 'SESSION_REQUIRED',
		message: 'Entering or exiting a context needs an MCP session, and this request has none',
		suggestion:
			'Send an MCP initialize request to /message and repeat its Mcp-Session-Id response header on later requests, or use the stateless /mcp endpoint and send _meta["dev.afd/context"] on each request',
	});
}

/** `_meta` key that selects the active context of one MCP 2026-07-28 request. */
export const AFD_CONTEXT_META_KEY = 'dev.afd/context';

const STATELESS_CONTEXT_HINT = `Context changes do not persist between stateless MCP requests. Send _meta["${AFD_CONTEXT_META_KEY}"] with the context name on each tools/list and tools/call request instead.`;

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
			// A copy: getContexts may return the host's own array, which must keep its order.
			const configs = [...getContexts()];
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
	/** `false` on a stateless request: nothing was stored, see the reasoning. */
	persisted?: false;
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
			if (state.persistent === false) {
				return success(
					{ entered: contextName, previous, persisted: false },
					{ reasoning: STATELESS_CONTEXT_HINT, confidence: 1.0 }
				);
			}
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
	/** `false` on a stateless request: nothing was changed, see the reasoning. */
	persisted?: false;
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
			if (state.persistent === false) {
				const current = state.getActive();
				return success(
					{ exited: null, current, persisted: false },
					{ reasoning: STATELESS_CONTEXT_HINT, confidence: 1.0 }
				);
			}
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
