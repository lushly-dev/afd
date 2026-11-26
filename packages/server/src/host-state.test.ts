/**
 * @fileoverview Trusted host state (#1743): one opaque token on the context, which copies carry,
 * which a handler cannot read or forge, and which never serializes.
 */
import { success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createContextState } from './bootstrap/afd-context.js';
import { bindCommandAllow, isCommandAllowed } from './command-allow.js';
import { bindContextState, resolveContextState } from './context-scope.js';
import { createExecutionEngine } from './execution.js';
import { hostState, patchHostStateInPlace, withHostState } from './host-state.js';
import { defineCommand } from './schema.js';
import { bindTaskDispatch, taskDispatchOf, withoutTaskDispatch } from './task-dispatch.js';

describe('host state', () => {
	it('is one frozen, empty token under one symbol, whatever is bound', () => {
		const state = createContextState();
		const context = bindCommandAllow(bindContextState({ traceId: 't' }, state), () => true);
		expect(Object.keys(context)).toEqual(['traceId']);
		expect(JSON.stringify(context)).toBe('{"traceId":"t"}');
		const symbols = Object.getOwnPropertySymbols(context);
		expect(symbols).toHaveLength(1);
		const token = (context as Record<symbol, unknown>)[symbols[0] as symbol];
		expect(token).toEqual({});
		expect(Object.isFrozen(token)).toBe(true);
		expect(resolveContextState(context)).toBe(state);
	});

	it('is carried by copies, and a binding on a copy leaves the original alone', () => {
		const state = createContextState();
		const original = bindContextState({}, state);
		const copy = { ...original, traceId: 'copy' };
		expect(resolveContextState(copy)).toBe(state);
		const narrowed = bindCommandAllow(copy, (name) => name === 'a');
		expect(isCommandAllowed(narrowed, 'b')).toBe(false);
		expect(isCommandAllowed(original, 'b')).toBe(true);
		expect(resolveContextState(narrowed)).toBe(state);
	});

	it('tells a bound null state from none', () => {
		expect(resolveContextState(bindContextState({}, null), createContextState())).toBeNull();
		const fallback = createContextState();
		expect(resolveContextState({}, fallback)).toBe(fallback);
	});

	it('treats a token it did not mint as forged: no state, and every command refused', () => {
		const bound = bindContextState({}, createContextState());
		const [key] = Object.getOwnPropertySymbols(bound);
		if (!key) throw new Error('expected a token');
		for (const forged of [{}, Object.freeze({}), undefined, null, 'token']) {
			const context = { [key]: forged };
			expect(hostState(context).forged).toBe(true);
			expect(resolveContextState(context)).toBeUndefined();
			expect(isCommandAllowed(context, 'anything')).toBe(false);
			// Binding on top of a forged token keeps it forged: it never widens.
			expect(isCommandAllowed(withHostState(context, {}), 'anything')).toBe(false);
		}
	});

	it('removes an entry set to undefined, on a copy or in place', () => {
		const dispatch = {
			dispatch: async () => undefined,
			refuseComposite: () => ({ code: 'X', message: 'x', suggestion: 'x' }),
		};
		const bound = bindTaskDispatch({}, dispatch);
		expect(taskDispatchOf(bound)).toBe(dispatch);
		expect(taskDispatchOf(withoutTaskDispatch(bound))).toBeUndefined();
		expect(taskDispatchOf(bound)).toBe(dispatch);
		patchHostStateInPlace(bound, { taskDispatch: undefined });
		expect(taskDispatchOf(bound)).toBeUndefined();
		const plain = {};
		patchHostStateInPlace(plain, { taskDispatch: dispatch });
		expect(Object.getOwnPropertySymbols(plain)).toEqual([]);
	});

	it('reaches a handler only as the opaque token, and a nested call it makes stays in context', async () => {
		const seen: unknown[] = [];
		const state = createContextState();
		state.enter('notes');
		const commands = [
			defineCommand({
				name: 'outer',
				description: 'Calls inner with its own context',
				contexts: ['notes'],
				input: z.object({}),
				handler: async (_input, context) => {
					seen.push(
						Object.getOwnPropertySymbols(context ?? {}).map((key) => (context as never)[key])
					);
					return engine.executeCommand('inner', {}, context);
				},
			}),
			defineCommand({
				name: 'inner',
				description: 'Only in billing',
				contexts: ['billing'],
				input: z.object({}),
				handler: async () => success('ran'),
			}),
		];
		const engine = createExecutionEngine({
			commandMap: new Map(commands.map((command) => [command.name, command])),
			middleware: [],
			devMode: false,
		});
		const result = await engine.executeCommand('outer', {}, bindContextState({}, state));
		expect(result).toMatchObject({ success: false, error: { code: 'COMMAND_NOT_IN_CONTEXT' } });
		expect(seen).toEqual([[{}]]);
	});
});
