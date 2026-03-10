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
});
