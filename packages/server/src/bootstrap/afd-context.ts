/**
 * @fileoverview afd-context bootstrap commands
 *
 * Context management commands for dynamic tool scoping.
 * Always available regardless of active context (universal tools).
 */

import type { CommandDefinition } from '@lushly-dev/afd-core';
import { failure, success } from '@lushly-dev/afd-core';
import { z } from 'zod';
import type { ContextConfig } from '../server-types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT STATE
// ═══════════════════════════════════════════════════════════════════════════════

export interface ContextState {
	stack: string[];
	getActive(): string | null;
	enter(name: string): void;
	exit(): string | null;
}

/**
 * Create a shared context state manager.
 */
export function createContextState(): ContextState {
	const stack: string[] = [];

	return {
		stack,
		getActive() {
			return stack.length > 0 ? (stack[stack.length - 1] ?? null) : null;
		},
		enter(name: string) {
			stack.push(name);
		},
		exit() {
			return stack.pop() ?? null;
		},
	};
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

		async handler() {
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
					activeContext: contextState.getActive(),
				},
				{
					reasoning: `Found ${contexts.length} configured contexts. Active: ${contextState.getActive() ?? 'none'}`,
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

		async handler(input: z.infer<typeof enterInputSchema>) {
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

			const previous = contextState.getActive();
			contextState.enter(contextName);

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

		async handler() {
			const exited = contextState.exit();
			const current = contextState.getActive();

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
