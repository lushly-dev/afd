/**
 * @fileoverview JTBD tests for contextual tool loading.
 *
 * Jobs-to-be-done scenarios validating end-to-end context navigation.
 */

import { success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	createAfdContextEnterCommand,
	createAfdContextExitCommand,
	createAfdContextListCommand,
	createContextState,
} from './bootstrap/afd-context.js';
import { defineCommand } from './schema.js';
import type { ContextConfig } from './server-types.js';
import { getToolsList } from './tools.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════════

const contexts: ContextConfig[] = [
	{ name: 'document-editing', description: 'Document editing tools', priority: 10 },
	{ name: 'print', description: 'Printing tools', priority: 5 },
	{ name: 'settings', description: 'Application settings', priority: 1 },
];

const docCreate = defineCommand({
	name: 'doc-create',
	description: 'Create a new document in the editor',
	input: z.object({ title: z.string() }),
	contexts: ['document-editing'],
	async handler() {
		return success({ id: '1' });
	},
});

const docFormat = defineCommand({
	name: 'doc-format',
	description: 'Format the current document selection',
	input: z.object({ style: z.string() }),
	contexts: ['document-editing'],
	async handler() {
		return success({ formatted: true });
	},
});

const printPreview = defineCommand({
	name: 'print-preview',
	description: 'Preview the document for printing',
	input: z.object({ pageSize: z.string().default('A4') }),
	contexts: ['print'],
	async handler() {
		return success({ preview: true });
	},
});

const printSend = defineCommand({
	name: 'print-send',
	description: 'Send the document to a printer',
	input: z.object({ printer: z.string() }),
	contexts: ['print'],
	async handler() {
		return success({ sent: true });
	},
});

const appHelp = defineCommand({
	name: 'app-help',
	description: 'Show general help for the application',
	input: z.object({}),
	async handler() {
		return success({ help: true });
	},
});

const allCommands = [docCreate, docFormat, printPreview, printSend, appHelp];

// ═══════════════════════════════════════════════════════════════════════════════
// JTBD: Agent navigates contexts in a Word-class app
// ═══════════════════════════════════════════════════════════════════════════════

describe('JTBD: Agent navigates contexts in a Word-class app', () => {
	it('lists contexts, enters document-editing, uses tools, exits, enters print', async () => {
		const state = createContextState();
		const getContexts = () => contexts;

		// Step 1: List available contexts
		const listCmd = createAfdContextListCommand(getContexts, state);
		const listResult = await listCmd.handler({});
		expect(listResult.success).toBe(true);
		expect(listResult.data?.contexts).toHaveLength(3);
		expect(listResult.data?.activeContext).toBeNull();

		// Step 2: Enter document-editing context
		const enterCmd = createAfdContextEnterCommand(getContexts, state);
		const enterResult = await enterCmd.handler({ context: 'document-editing' });
		expect(enterResult.success).toBe(true);
		expect(enterResult.data?.entered).toBe('document-editing');

		// Step 3: Verify only document-editing tools are visible
		const docTools = getToolsList(allCommands, 'individual', undefined, state.getActive());
		const docToolNames = docTools.map((t) => t.name);
		expect(docToolNames).toContain('doc-create');
		expect(docToolNames).toContain('doc-format');
		expect(docToolNames).toContain('app-help'); // universal
		expect(docToolNames).not.toContain('print-preview');
		expect(docToolNames).not.toContain('print-send');

		// Step 4: Exit document-editing
		const exitCmd = createAfdContextExitCommand(state);
		const exitResult = await exitCmd.handler({});
		expect(exitResult.success).toBe(true);
		expect(exitResult.data?.exited).toBe('document-editing');
		expect(exitResult.data?.current).toBeNull();

		// Step 5: Enter print context
		const enterPrint = await enterCmd.handler({ context: 'print' });
		expect(enterPrint.success).toBe(true);
		expect(enterPrint.data?.entered).toBe('print');

		// Step 6: Verify only print tools are visible
		const printTools = getToolsList(allCommands, 'individual', undefined, state.getActive());
		const printToolNames = printTools.map((t) => t.name);
		expect(printToolNames).toContain('print-preview');
		expect(printToolNames).toContain('print-send');
		expect(printToolNames).toContain('app-help'); // universal
		expect(printToolNames).not.toContain('doc-create');
		expect(printToolNames).not.toContain('doc-format');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// JTBD: Agent uses universal commands without context
// ═══════════════════════════════════════════════════════════════════════════════

describe('JTBD: Agent uses universal commands without context', () => {
	it('commands without contexts are accessible regardless of active context', () => {
		// No context active — all visible
		const noCtxTools = getToolsList(allCommands, 'individual', undefined, null);
		expect(noCtxTools.map((t) => t.name)).toContain('app-help');

		// With a specific context — universal still visible
		const withCtxTools = getToolsList(allCommands, 'individual', undefined, 'settings');
		const toolNames = withCtxTools.map((t) => t.name);
		expect(toolNames).toContain('app-help');
		// Only universal commands should be visible in 'settings' context (no commands declared it)
		expect(toolNames).not.toContain('doc-create');
		expect(toolNames).not.toContain('print-preview');
	});
});
