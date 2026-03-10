import { success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { createContextState } from './bootstrap/afd-context.js';
import { defineCommand } from './schema.js';
import { createToolRouter } from './tool-router.js';
import { getToolsList } from './tools.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

const docCreate = defineCommand({
	name: 'doc-create',
	description: 'Create a document',
	input: z.object({ title: z.string() }),
	contexts: ['document-editing'],
	async handler() {
		return success({ id: '1' });
	},
});

const docPrint = defineCommand({
	name: 'doc-print',
	description: 'Print a document',
	input: z.object({ id: z.string() }),
	contexts: ['print'],
	async handler() {
		return success({ printed: true });
	},
});

const universalHelp = defineCommand({
	name: 'app-help',
	description: 'Show help information for the application',
	input: z.object({}),
	async handler() {
		return success({ help: 'available' });
	},
});

const multiContextCmd = defineCommand({
	name: 'doc-view',
	description: 'View a document in any context',
	input: z.object({ id: z.string() }),
	contexts: ['document-editing', 'print'],
	async handler() {
		return success({ viewed: true });
	},
});

const allCommands = [docCreate, docPrint, universalHelp, multiContextCmd];

// ═══════════════════════════════════════════════════════════════════════════════
// Tool List Filtering
// ═══════════════════════════════════════════════════════════════════════════════

describe('getToolsList with context filtering', () => {
	it('returns all commands when no active context', () => {
		const tools = getToolsList(allCommands, 'individual', undefined, null);
		const toolNames = tools.map((t) => t.name);
		expect(toolNames).toContain('doc-create');
		expect(toolNames).toContain('doc-print');
		expect(toolNames).toContain('app-help');
		expect(toolNames).toContain('doc-view');
	});

	it('filters commands by active context', () => {
		const tools = getToolsList(allCommands, 'individual', undefined, 'document-editing');
		const toolNames = tools.map((t) => t.name);
		expect(toolNames).toContain('doc-create');
		expect(toolNames).toContain('doc-view');
		expect(toolNames).toContain('app-help'); // universal
		expect(toolNames).not.toContain('doc-print'); // wrong context
	});

	it('commands without contexts are always visible', () => {
		const tools = getToolsList(allCommands, 'individual', undefined, 'print');
		const toolNames = tools.map((t) => t.name);
		expect(toolNames).toContain('app-help');
		expect(toolNames).toContain('doc-print');
		expect(toolNames).toContain('doc-view');
		expect(toolNames).not.toContain('doc-create');
	});

	it('emits contexts in _meta for individual strategy', () => {
		const tools = getToolsList(allCommands, 'individual');
		const docCreateTool = tools.find((t) => t.name === 'doc-create');
		expect((docCreateTool as Record<string, unknown>)._meta).toEqual(
			expect.objectContaining({ contexts: ['document-editing'] })
		);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool Router Context Enforcement
// ═══════════════════════════════════════════════════════════════════════════════

describe('createToolRouter with context state', () => {
	function createRouter(contextState: ReturnType<typeof createContextState>) {
		const commandMap = new Map(allCommands.map((c) => [c.name, c]));
		return createToolRouter({
			executeCommand: async (name, input) => {
				const cmd = commandMap.get(name);
				if (!cmd) {
					return {
						success: false as const,
						error: { code: 'COMMAND_NOT_FOUND', message: `Command '${name}' not found` },
					};
				}
				return cmd.handler(input, {});
			},
			executeBatch: async () => ({
				success: true,
				results: [],
				timing: { totalMs: 0, averageMs: 0, startedAt: '', completedAt: '' },
				metadata: { successCount: 0, failureCount: 0, totalCount: 0, confidence: 1 },
				steps: [],
			}),
			executePipeline: async () => ({
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
			}),
			commands: allCommands,
			toolStrategy: 'individual',
			devMode: false,
			contextState,
		});
	}

	it('allows commands in the active context', async () => {
		const state = createContextState();
		state.enter('document-editing');
		const router = createRouter(state);

		const result = await router('doc-create', { title: 'Test' });
		expect(result.isError).toBe(false);
		const parsed = JSON.parse(result.content[0]?.text ?? '{}');
		expect(parsed.success).toBe(true);
	});

	it('rejects commands not in the active context', async () => {
		const state = createContextState();
		state.enter('print');
		const router = createRouter(state);

		const result = await router('doc-create', { title: 'Test' });
		expect(result.isError).toBe(true);
		const parsed = JSON.parse(result.content[0]?.text ?? '{}');
		expect(parsed.error.code).toBe('COMMAND_NOT_IN_CONTEXT');
		expect(parsed.error.message).toContain('doc-create');
		expect(parsed.error.message).toContain('print');
	});

	it('allows commands without contexts regardless of active context', async () => {
		const state = createContextState();
		state.enter('print');
		const router = createRouter(state);

		const result = await router('app-help', {});
		expect(result.isError).toBe(false);
		const parsed = JSON.parse(result.content[0]?.text ?? '{}');
		expect(parsed.success).toBe(true);
	});

	it('allows all commands when no context is active', async () => {
		const state = createContextState();
		const router = createRouter(state);

		const result = await router('doc-create', { title: 'Test' });
		expect(result.isError).toBe(false);
	});

	it('allows multi-context commands in any matching context', async () => {
		const state = createContextState();
		state.enter('print');
		const router = createRouter(state);

		const result = await router('doc-view', { id: '1' });
		expect(result.isError).toBe(false);
	});

	it('enforces context on afd-call', async () => {
		const state = createContextState();
		state.enter('print');
		const router = createRouter(state);

		const result = await router('afd-call', { command: 'doc-create', input: { title: 'Test' } });
		expect(result.isError).toBe(true);
		const parsed = JSON.parse(result.content[0]?.text ?? '{}');
		expect(parsed.error.code).toBe('COMMAND_NOT_IN_CONTEXT');
	});

	it('allows afd-call for commands in active context', async () => {
		const state = createContextState();
		state.enter('document-editing');
		const router = createRouter(state);

		const result = await router('afd-call', { command: 'doc-create', input: { title: 'Test' } });
		expect(result.isError).toBe(false);
		const parsed = JSON.parse(result.content[0]?.text ?? '{}');
		expect(parsed.success).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// afd-detail Context Filtering
// ═══════════════════════════════════════════════════════════════════════════════

describe('afd-detail with context filtering', () => {
	function createDetailRouter(contextState: ReturnType<typeof createContextState>) {
		const commandMap = new Map(allCommands.map((c) => [c.name, c]));
		return createToolRouter({
			executeCommand: async (name, input) => {
				const cmd = commandMap.get(name);
				if (!cmd) {
					return {
						success: false as const,
						error: { code: 'COMMAND_NOT_FOUND', message: `Command '${name}' not found` },
					};
				}
				return cmd.handler(input, {});
			},
			executeBatch: async () => ({
				success: true,
				results: [],
				timing: { totalMs: 0, averageMs: 0, startedAt: '', completedAt: '' },
				metadata: { successCount: 0, failureCount: 0, totalCount: 0, confidence: 1 },
				steps: [],
			}),
			executePipeline: async () => ({
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
			}),
			commands: allCommands,
			toolStrategy: 'lazy',
			devMode: false,
			allCommands,
			exposedCommandNames: new Set(allCommands.map((c) => c.name)),
			contextState,
		});
	}

	it('filters out-of-context commands from afd-detail results', async () => {
		const state = createContextState();
		state.enter('document-editing');
		const router = createDetailRouter(state);

		// Request detail for a command NOT in the active context
		const result = await router('afd-detail', { command: 'doc-print' });
		const parsed = JSON.parse(result.content[0]?.text ?? '{}');
		// doc-print is in 'print' context only — should be not-found from filtered perspective
		const entry = parsed.data?.[0];
		expect(entry?.found).toBe(false);
		expect(entry?.error?.code).toBe('COMMAND_NOT_FOUND');
	});

	it('shows in-context commands in afd-detail', async () => {
		const state = createContextState();
		state.enter('document-editing');
		const router = createDetailRouter(state);

		const result = await router('afd-detail', { command: 'doc-create' });
		const parsed = JSON.parse(result.content[0]?.text ?? '{}');
		expect(parsed.data?.[0]?.found).toBe(true);
		expect(parsed.data?.[0]?.name).toBe('doc-create');
	});

	it('shows universal commands in afd-detail regardless of context', async () => {
		const state = createContextState();
		state.enter('print');
		const router = createDetailRouter(state);

		const result = await router('afd-detail', { command: 'app-help' });
		const parsed = JSON.parse(result.content[0]?.text ?? '{}');
		expect(parsed.data?.[0]?.found).toBe(true);
	});

	it('shows all commands in afd-detail when no context active', async () => {
		const state = createContextState();
		const router = createDetailRouter(state);

		const result = await router('afd-detail', {
			command: ['doc-create', 'doc-print', 'app-help'],
		});
		const parsed = JSON.parse(result.content[0]?.text ?? '{}');
		expect(parsed.data).toHaveLength(3);
		expect(parsed.data?.every((e: { found: boolean }) => e.found)).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Grouped Strategy Context Enforcement
// ═══════════════════════════════════════════════════════════════════════════════

describe('grouped strategy with context enforcement', () => {
	function createGroupedRouter(contextState: ReturnType<typeof createContextState>) {
		const commandMap = new Map(allCommands.map((c) => [c.name, c]));
		return createToolRouter({
			executeCommand: async (name, input) => {
				const cmd = commandMap.get(name);
				if (!cmd) {
					return {
						success: false as const,
						error: { code: 'COMMAND_NOT_FOUND', message: `Command '${name}' not found` },
					};
				}
				return cmd.handler(input, {});
			},
			executeBatch: async () => ({
				success: true,
				results: [],
				timing: { totalMs: 0, averageMs: 0, startedAt: '', completedAt: '' },
				metadata: { successCount: 0, failureCount: 0, totalCount: 0, confidence: 1 },
				steps: [],
			}),
			executePipeline: async () => ({
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
			}),
			commands: allCommands,
			toolStrategy: 'grouped',
			devMode: false,
			contextState,
		});
	}

	it('rejects grouped commands not in the active context', async () => {
		const state = createContextState();
		state.enter('print');
		const router = createGroupedRouter(state);

		// doc-create is in document-editing context, calling from 'print' should fail
		const result = await router('doc', { action: 'create', params: { title: 'Test' } });
		expect(result.isError).toBe(true);
		const parsed = JSON.parse(result.content[0]?.text ?? '{}');
		expect(parsed.error.code).toBe('COMMAND_NOT_IN_CONTEXT');
	});

	it('allows grouped commands in the active context', async () => {
		const state = createContextState();
		state.enter('document-editing');
		const router = createGroupedRouter(state);

		const result = await router('doc', { action: 'create', params: { title: 'Test' } });
		expect(result.isError).toBe(false);
	});
});
