import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	createAfdContextEnterCommand,
	createAfdContextExitCommand,
	createAfdContextListCommand,
	createContextState,
	DEFAULT_CONTEXT_MAX_DEPTH,
} from './bootstrap/afd-context.js';
import { bindContextState, resolveContextState } from './context-scope.js';
import { createExecutionEngine } from './execution.js';
import { defineCommand } from './schema.js';

const contexts = () => [{ name: 'edit' }, { name: 'print' }, { name: 'review' }];

describe('context scope binding', () => {
	it('falls back to the default state when nothing is bound', () => {
		const fallback = createContextState();
		expect(resolveContextState(undefined, fallback)).toBe(fallback);
		expect(resolveContextState({ traceId: 't' }, fallback)).toBe(fallback);
		expect(resolveContextState({})).toBeUndefined();
	});

	it('returns the bound state, including null for stateless callers', () => {
		const fallback = createContextState();
		const session = createContextState();
		expect(resolveContextState(bindContextState({}, session), fallback)).toBe(session);
		expect(resolveContextState(bindContextState({}, null), fallback)).toBeNull();
	});

	it('survives context copies and never serializes', () => {
		const session = createContextState();
		const bound = bindContextState({ userId: 'u1' }, session);
		const copy = { ...bound, traceId: 'step-1' };
		expect(resolveContextState(copy)).toBe(session);
		expect(JSON.stringify(copy)).toBe('{"userId":"u1","traceId":"step-1"}');
	});
});

describe('context stack limits', () => {
	it('treats re-entering the active context as a no-op', () => {
		const state = createContextState();
		state.enter('edit');
		state.enter('edit');
		expect(state.stack).toEqual(['edit']);
		state.enter('print');
		state.enter('edit');
		expect(state.stack).toEqual(['edit', 'print', 'edit']);
	});

	it('caps the stack depth', () => {
		const state = createContextState({ maxDepth: 2 });
		state.enter('edit');
		state.enter('print');
		expect(() => state.enter('review')).toThrow('limited to 2 levels');
		expect(createContextState().maxDepth).toBe(DEFAULT_CONTEXT_MAX_DEPTH);
	});

	it('rejects an invalid maxDepth', () => {
		expect(() => createContextState({ maxDepth: 0 })).toThrow('positive integer');
		expect(() => createContextState({ maxDepth: 1.5 })).toThrow('positive integer');
	});
});

describe('context commands with a bound state', () => {
	it('enter reports a no-op when the context is already active', async () => {
		const state = createContextState();
		const enter = createAfdContextEnterCommand(contexts, state);
		await enter.handler({ context: 'edit' });
		const again = await enter.handler({ context: 'edit' });
		expect(again.success).toBe(true);
		expect(again.data).toEqual({ entered: 'edit', previous: 'edit' });
		expect(again.reasoning).toContain('nothing changed');
		expect(state.stack).toEqual(['edit']);
	});

	it('enter fails with guidance once the stack is full', async () => {
		const state = createContextState({ maxDepth: 1 });
		const enter = createAfdContextEnterCommand(contexts, state);
		await enter.handler({ context: 'edit' });
		const result = await enter.handler({ context: 'print' });
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('CONTEXT_DEPTH_EXCEEDED');
		expect(result.error?.suggestion).toContain('afd-context-exit');
		expect(state.stack).toEqual(['edit']);
	});

	it('uses the state bound to the command context instead of the default', async () => {
		const shared = createContextState();
		const session = createContextState();
		const enter = createAfdContextEnterCommand(contexts, shared);
		const exit = createAfdContextExitCommand(shared);
		const list = createAfdContextListCommand(contexts, shared);
		const bound = bindContextState({}, session);

		await enter.handler({ context: 'print' }, bound);
		expect(session.getActive()).toBe('print');
		expect(shared.getActive()).toBeNull();
		expect((await list.handler({}, bound)).data?.activeContext).toBe('print');
		expect((await list.handler({})).data?.activeContext).toBeNull();
		expect((await exit.handler({}, bound)).data?.exited).toBe('print');
	});

	it('requires a session for enter and exit, and lists no active context without one', async () => {
		const shared = createContextState();
		shared.enter('edit');
		const stateless = bindContextState({}, null);
		const entered = await createAfdContextEnterCommand(contexts, shared).handler(
			{ context: 'print' },
			stateless
		);
		const exited = await createAfdContextExitCommand(shared).handler({}, stateless);
		for (const result of [entered, exited]) {
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('SESSION_REQUIRED');
			expect(result.error?.suggestion).toContain('Mcp-Session-Id');
		}
		const listed = await createAfdContextListCommand(contexts, shared).handler({}, stateless);
		expect(listed.data?.activeContext).toBeNull();
		expect(shared.stack).toEqual(['edit']);
	});
});

describe('execution engine context resolution', () => {
	const printOnly = defineCommand({
		name: 'print-run',
		description: 'Print',
		contexts: ['print'],
		input: z.object({}),
		handler: async () => ({ success: true }),
	});

	it('checks the bound state rather than the default one', async () => {
		const fallback = createContextState();
		fallback.enter('edit');
		const engine = createExecutionEngine({
			commandMap: new Map([[printOnly.name, printOnly]]),
			middleware: [],
			devMode: false,
			contextState: fallback,
		});
		expect((await engine.executeCommand('print-run', {})).error?.code).toBe(
			'COMMAND_NOT_IN_CONTEXT'
		);
		expect((await engine.executeCommand('print-run', {}, bindContextState({}, null))).success).toBe(
			true
		);
		const session = createContextState();
		session.enter('print');
		expect(
			(await engine.executeCommand('print-run', {}, bindContextState({}, session))).success
		).toBe(true);
	});
});
