import { describe, expect, it } from 'vitest';
import type { ContextConfig } from '../server-types.js';
import {
	createAfdContextEnterCommand,
	createAfdContextExitCommand,
	createAfdContextListCommand,
	createContextState,
} from './afd-context.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════════

function makeContexts(): ContextConfig[] {
	return [
		{
			name: 'document-editing',
			description: 'Document editing tools',
			triggers: ['edit', 'write'],
			priority: 10,
		},
		{
			name: 'print',
			description: 'Printing tools',
			triggers: ['print', 'export'],
			priority: 5,
		},
		{
			name: 'settings',
			description: 'Application settings',
			priority: 1,
		},
	];
}

// ═══════════════════════════════════════════════════════════════════════════════
// createContextState
// ═══════════════════════════════════════════════════════════════════════════════

describe('createContextState', () => {
	it('starts with no active context', () => {
		const state = createContextState();
		expect(state.getActive()).toBeNull();
		expect(state.stack).toHaveLength(0);
	});

	it('enter pushes to stack', () => {
		const state = createContextState();
		state.enter('document-editing');
		expect(state.getActive()).toBe('document-editing');
		expect(state.stack).toHaveLength(1);
	});

	it('enter stacks multiple contexts', () => {
		const state = createContextState();
		state.enter('document-editing');
		state.enter('print');
		expect(state.getActive()).toBe('print');
		expect(state.stack).toHaveLength(2);
	});

	it('exit pops the stack', () => {
		const state = createContextState();
		state.enter('document-editing');
		state.enter('print');
		const exited = state.exit();
		expect(exited).toBe('print');
		expect(state.getActive()).toBe('document-editing');
	});

	it('exit returns null when stack is empty', () => {
		const state = createContextState();
		const exited = state.exit();
		expect(exited).toBeNull();
		expect(state.getActive()).toBeNull();
	});

	it('exit restores to null after all exits', () => {
		const state = createContextState();
		state.enter('document-editing');
		state.exit();
		expect(state.getActive()).toBeNull();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// afd-context-list
// ═══════════════════════════════════════════════════════════════════════════════

describe('createAfdContextListCommand', () => {
	it('creates command with correct metadata', () => {
		const state = createContextState();
		const cmd = createAfdContextListCommand(() => [], state);
		expect(cmd.name).toBe('afd-context-list');
		expect(cmd.category).toBe('bootstrap');
		expect(cmd.mutation).toBe(false);
	});

	it('returns all configured contexts sorted by priority', async () => {
		const contexts = makeContexts();
		const state = createContextState();
		const cmd = createAfdContextListCommand(() => contexts, state);
		const result = await cmd.handler({});

		expect(result.success).toBe(true);
		expect(result.data?.contexts).toHaveLength(3);
		expect(result.data?.contexts[0]?.name).toBe('document-editing');
		expect(result.data?.contexts[1]?.name).toBe('print');
		expect(result.data?.contexts[2]?.name).toBe('settings');
	});

	it('shows active context as null when none active', async () => {
		const contexts = makeContexts();
		const state = createContextState();
		const cmd = createAfdContextListCommand(() => contexts, state);
		const result = await cmd.handler({});

		expect(result.data?.activeContext).toBeNull();
	});

	it('shows active context when one is entered', async () => {
		const contexts = makeContexts();
		const state = createContextState();
		state.enter('print');
		const cmd = createAfdContextListCommand(() => contexts, state);
		const result = await cmd.handler({});

		expect(result.data?.activeContext).toBe('print');
	});

	it('includes descriptions and triggers in output', async () => {
		const contexts = makeContexts();
		const state = createContextState();
		const cmd = createAfdContextListCommand(() => contexts, state);
		const result = await cmd.handler({});

		const docContext = result.data?.contexts.find((c) => c.name === 'document-editing');
		expect(docContext?.description).toBe('Document editing tools');
		expect(docContext?.triggers).toEqual(['edit', 'write']);
		expect(docContext?.priority).toBe(10);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// afd-context-enter
// ═══════════════════════════════════════════════════════════════════════════════

describe('createAfdContextEnterCommand', () => {
	it('creates command with correct metadata', () => {
		const state = createContextState();
		const cmd = createAfdContextEnterCommand(() => [], state);
		expect(cmd.name).toBe('afd-context-enter');
		expect(cmd.mutation).toBe(true);
	});

	it('enters a valid context', async () => {
		const contexts = makeContexts();
		const state = createContextState();
		const cmd = createAfdContextEnterCommand(() => contexts, state);
		const result = await cmd.handler({ context: 'print' });

		expect(result.success).toBe(true);
		expect(result.data?.entered).toBe('print');
		expect(result.data?.previous).toBeNull();
		expect(state.getActive()).toBe('print');
	});

	it('tracks previous context', async () => {
		const contexts = makeContexts();
		const state = createContextState();
		state.enter('document-editing');
		const cmd = createAfdContextEnterCommand(() => contexts, state);
		const result = await cmd.handler({ context: 'print' });

		expect(result.success).toBe(true);
		expect(result.data?.entered).toBe('print');
		expect(result.data?.previous).toBe('document-editing');
	});

	it('rejects unknown context', async () => {
		const contexts = makeContexts();
		const state = createContextState();
		const cmd = createAfdContextEnterCommand(() => contexts, state);
		const result = await cmd.handler({ context: 'nonexistent' });

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('CONTEXT_NOT_FOUND');
		expect(result.error?.suggestion).toContain('afd-context-list');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// afd-context-exit
// ═══════════════════════════════════════════════════════════════════════════════

describe('createAfdContextExitCommand', () => {
	it('creates command with correct metadata', () => {
		const state = createContextState();
		const cmd = createAfdContextExitCommand(state);
		expect(cmd.name).toBe('afd-context-exit');
		expect(cmd.mutation).toBe(true);
	});

	it('exits current context', async () => {
		const state = createContextState();
		state.enter('document-editing');
		state.enter('print');
		const cmd = createAfdContextExitCommand(state);
		const result = await cmd.handler({});

		expect(result.success).toBe(true);
		expect(result.data?.exited).toBe('print');
		expect(result.data?.current).toBe('document-editing');
	});

	it('returns null when stack is empty', async () => {
		const state = createContextState();
		const cmd = createAfdContextExitCommand(state);
		const result = await cmd.handler({});

		expect(result.success).toBe(true);
		expect(result.data?.exited).toBeNull();
		expect(result.data?.current).toBeNull();
	});

	it('pops back to null after last exit', async () => {
		const state = createContextState();
		state.enter('document-editing');
		const cmd = createAfdContextExitCommand(state);
		const result = await cmd.handler({});

		expect(result.success).toBe(true);
		expect(result.data?.exited).toBe('document-editing');
		expect(result.data?.current).toBeNull();
	});
});
