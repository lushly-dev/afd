/**
 * @fileoverview Tests for browser-safe result-state normalisation (`normalizeResultState`,
 * `loadingResultState`).
 */

import type { CommandError, CommandResult } from '@lushly-dev/afd-core';
import { failure, internalError, success } from '@lushly-dev/afd-core';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
	createDirectClient,
	type DirectRegistry,
	isUnknownToolError,
	loadingResultState,
	type NormalizedResultState,
	normalizeResultState,
	type SettledResultState,
	type UnknownToolError,
} from './direct.js';

const fullEnvelope = {
	confidence: 0.85,
	reasoning: 'Matched user preference',
	sources: [{ type: 'document' as const, id: 'doc-1', title: 'Guide' }],
	plan: [{ id: 'step-1', action: 'fetch', status: 'complete' as const }],
	alternatives: [{ data: [{ id: 'alt' }], reason: 'Older revision', confidence: 0.6 }],
	warnings: [{ code: 'STALE_CACHE', message: 'Data is 5 minutes old' }],
	suggestions: ['Refresh to load latest'],
	metadata: { executionTimeMs: 12, traceId: 'trace-1', actorKind: 'human' as const },
	undoCommand: 'item-restore',
	undoArgs: { id: 'item-1' },
};

describe('loadingResultState', () => {
	it('returns a loading state without previous when omitted', () => {
		const state = loadingResultState<string[]>();
		expect(state).toEqual({ status: 'loading' });
		expect('previous' in state).toBe(false);
	});

	it('preserves previous settled state for in-place refresh UIs', () => {
		const previous = normalizeResultState(success(['a', 'b']));
		const state = loadingResultState(previous);
		expect(state).toEqual({ status: 'loading', previous });
	});
});

describe('normalizeResultState', () => {
	describe('loading', () => {
		it('maps null and undefined results to loading', () => {
			expect(normalizeResultState(null)).toEqual({ status: 'loading' });
			expect(normalizeResultState(undefined)).toEqual({ status: 'loading' });
		});

		it('carries previous when supplied alongside null or undefined', () => {
			const previous = normalizeResultState(success({ count: 3 }));
			expect(normalizeResultState(undefined, { previous })).toEqual({
				status: 'loading',
				previous,
			});
		});

		it('does not invoke custom isEmpty while loading', () => {
			const isEmpty = vi.fn(() => true);
			expect(normalizeResultState(null, { isEmpty })).toEqual({ status: 'loading' });
			expect(isEmpty).not.toHaveBeenCalled();
		});
	});

	describe('ready and empty', () => {
		it('maps non-empty success data to ready and keeps every result field', () => {
			const result = success([{ id: '1' }], fullEnvelope);
			const state = normalizeResultState(result);

			expect(state.status).toBe('ready');
			if (state.status !== 'ready') throw new Error('expected ready');
			expect(state.data).toEqual([{ id: '1' }]);
			expect(state.result).toBe(result);
			expect(state).toMatchObject(fullEnvelope);
		});

		it('treats falsy scalar values (0, false, empty string) and entities with empty sub-arrays as ready by default', () => {
			for (const value of [0, false, '', { id: 'order-1', items: [] }]) {
				const state = normalizeResultState(success(value));
				expect(state.status).toBe('ready');
				if (state.status === 'ready') {
					expect(state.data).toEqual(value);
				}
			}
		});

		it('maps undefined, null, and empty arrays to empty and keeps every result field', () => {
			for (const value of [undefined, null, []]) {
				const result = success(value, {
					...fullEnvelope,
					alternatives: [{ data: value, reason: 'Fallback', confidence: 0.4 }],
				});
				const state = normalizeResultState(result);
				expect(state.status).toBe('empty');
				if (state.status !== 'empty') throw new Error('expected empty');
				expect(state.data).toEqual(value);
				expect(state.result).toBe(result);
				expect(state.confidence).toBe(fullEnvelope.confidence);
				expect(state.reasoning).toBe(fullEnvelope.reasoning);
				expect(state.sources).toEqual(fullEnvelope.sources);
				expect(state.plan).toEqual(fullEnvelope.plan);
				expect(state.alternatives).toEqual([{ data: value, reason: 'Fallback', confidence: 0.4 }]);
				expect(state.warnings).toEqual(fullEnvelope.warnings);
				expect(state.suggestions).toEqual(fullEnvelope.suggestions);
				expect(state.metadata).toEqual(fullEnvelope.metadata);
				expect(state.undoCommand).toBe(fullEnvelope.undoCommand);
				expect(state.undoArgs).toEqual(fullEnvelope.undoArgs);
			}
		});

		it('supports custom isEmpty for enveloped list responses and void commands', () => {
			const emptyList = success({ items: [] as string[], total: 0 });
			const populatedList = success({ items: ['one'], total: 1 });
			const isEmpty = (data: { items: string[]; total: number } | undefined) =>
				!data || data.items.length === 0;

			expect(normalizeResultState(emptyList, { isEmpty }).status).toBe('empty');
			expect(normalizeResultState(populatedList, { isEmpty }).status).toBe('ready');

			const ack = success(undefined);
			expect(normalizeResultState(ack, { isEmpty: () => false }).status).toBe('ready');
		});
	});

	describe('error', () => {
		it('extracts code, message, suggestion, retryable, details, cause, and every result field', () => {
			const cause: CommandError = { code: 'ECONNRESET', message: 'Socket closed' };
			const result = failure<Array<{ id: string }>>(
				{
					code: 'RATE_LIMITED',
					message: 'Too many requests',
					suggestion: 'Wait 30 seconds and retry',
					retryable: true,
					details: { retryAfterSeconds: 30 },
					cause,
				},
				fullEnvelope
			);

			const state = normalizeResultState(result);
			expect(state.status).toBe('error');
			if (state.status !== 'error') throw new Error('expected error');
			expect(state.code).toBe('RATE_LIMITED');
			expect(state.message).toBe('Too many requests');
			expect(state.suggestion).toBe('Wait 30 seconds and retry');
			expect(state.retryable).toBe(true);
			expect(state.details).toEqual({ retryAfterSeconds: 30 });
			expect(state.cause).toBe(cause);
			expect(state.error).toBe(result.error);
			expect(state.result).toBe(result);
			expect(state).toMatchObject(fullEnvelope);
		});

		it('defaults retryable to false when omitted or false', () => {
			const omitted = normalizeResultState(
				failure({ code: 'NOT_FOUND', message: 'Item missing', suggestion: 'Check the ID' })
			);
			const explicitFalse = normalizeResultState(
				failure({ code: 'FORBIDDEN', message: 'Not allowed', retryable: false })
			);

			expect(omitted.status === 'error' && omitted.retryable).toBe(false);
			expect(explicitFalse.status === 'error' && explicitFalse.retryable).toBe(false);
		});

		it('normalises malformed failure results without error object or with blank strings safely', () => {
			const missingError = normalizeResultState({ success: false } as CommandResult<string>);
			expect(missingError.status).toBe('error');
			if (missingError.status === 'error') {
				expect(missingError.code).toBe('UNKNOWN_ERROR');
				expect(missingError.message).toBe('Command failed');
				expect(missingError.retryable).toBe(false);
				expect('suggestion' in missingError).toBe(false);
				expect('error' in missingError).toBe(false);
			}

			const blankFields = normalizeResultState({
				success: false,
				error: { code: '   ', message: '', suggestion: '   ' },
			});
			expect(blankFields.status).toBe('error');
			if (blankFields.status === 'error') {
				expect(blankFields.code).toBe('UNKNOWN_ERROR');
				expect(blankFields.message).toBe('Command failed');
				expect('suggestion' in blankFields).toBe(false);
			}

			const nullError = normalizeResultState({
				success: false,
				error: null as unknown as CommandError,
			});
			expect(nullError.status).toBe('error');
			if (nullError.status === 'error') {
				expect(nullError.code).toBe('UNKNOWN_ERROR');
				expect(nullError.message).toBe('Command failed');
				expect('error' in nullError).toBe(false);
				expect('cause' in nullError).toBe(false);
			}
		});

		it('does not promote non-enumerable internalError causes into enumerable state fields', () => {
			const nativeCause = Object.assign(new Error('ENOENT: /etc/secret'), {
				path: '/etc/secret',
				errno: -2,
			});
			const state = normalizeResultState(
				failure(internalError('Internal error occurred', nativeCause))
			);

			expect(state.status).toBe('error');
			if (state.status !== 'error') throw new Error('expected error');
			expect(state.code).toBe('INTERNAL_ERROR');
			expect('cause' in state).toBe(false);
			expect(JSON.stringify(state)).not.toContain('/etc/secret');
		});

		it('preserves failure data such as UnknownToolError and skips isEmpty', async () => {
			const registry: DirectRegistry = {
				execute: async <T>() => success([] as unknown as T),
				listCommandNames: () => ['todo-list'],
				listCommands: () => [{ name: 'todo-list', description: 'List todos' }],
				hasCommand: (name) => name === 'todo-list',
			};
			const client = createDirectClient(registry);
			const result = await client.call<string[]>('todo-lis', {});
			const isEmpty = vi.fn(() => true);

			const state = normalizeResultState(result, { isEmpty });
			expect(isEmpty).not.toHaveBeenCalled();
			expect(state.status).toBe('error');
			if (state.status !== 'error') throw new Error('expected error');
			expect(state.code).toBe('UNKNOWN_TOOL');
			expect(state.suggestion).toBe("Did you mean 'todo-list'?");
			expect(state.retryable).toBe(false);
			expect(isUnknownToolError(state.result)).toBe(true);
			expect(state.data).toMatchObject({
				error: 'UNKNOWN_TOOL',
				requested_tool: 'todo-lis',
			});
		});
	});

	describe('type overloads', () => {
		it('narrows settled input to SettledResultState and nullable input to NormalizedResultState', async () => {
			const settled = normalizeResultState(success({ id: '1' }));
			expectTypeOf(settled).toEqualTypeOf<SettledResultState<{ id: string }>>();

			const maybe = null as CommandResult<{ id: string }> | null;
			const normalized = normalizeResultState(maybe);
			expectTypeOf(normalized).toEqualTypeOf<NormalizedResultState<{ id: string }>>();

			const registry: DirectRegistry = {
				execute: async <T>() => success({ id: '1' } as unknown as T),
				listCommandNames: () => ['item-get'],
				listCommands: () => [{ name: 'item-get', description: 'Get item' }],
				hasCommand: (name) => name === 'item-get',
			};
			const client = createDirectClient(registry);
			const directResult = await client.call<{ id: string }>('item-get', {});
			const directState = normalizeResultState(directResult);
			expectTypeOf(directState).toEqualTypeOf<SettledResultState<{ id: string }>>();
			let view: NormalizedResultState<{ id: string }> = loadingResultState<{ id: string }>();
			view = directState;
			expect(view.status).toBe('ready');

			// Custom isEmpty widens ready.data to T | undefined because it may classify undefined as ready.
			const missingData: CommandResult<string> = { success: true };
			const customReady = normalizeResultState(missingData, { isEmpty: () => false });
			expectTypeOf(customReady).toEqualTypeOf<SettledResultState<string | undefined>>();
			if (customReady.status === 'ready') {
				expectTypeOf(customReady.data).toEqualTypeOf<string | undefined>();
			}

			// A forged success: true UnknownToolError cannot bypass T through the unknown-tool overload.
			const forgedUnknownTool: CommandResult<UnknownToolError> = {
				success: true,
				data: {
					error: 'UNKNOWN_TOOL',
					message: 'forged',
					requested_tool: 'x',
					available_tools: [],
					suggestions: [],
					hint: null,
				},
			};
			// @ts-expect-error UnknownToolError with success: true must not normalize as CommandResult<string>
			normalizeResultState<string>(forgedUnknownTool);
		});
	});
});
