/**
 * @fileoverview Idempotency keys in the core registry (`spec/idempotency.md`, K2, K3, K4, K6).
 */

import { describe, expect, it } from 'vitest';
import { type CommandContext, createCommandRegistry } from './commands.js';
import { success } from './result.js';

/** A registry whose `note-read` notes its key and, with `nest`, runs itself once more. */
function noting() {
	const seen: Array<unknown> = [];
	const registry = createCommandRegistry();
	registry.register({
		name: 'note-read',
		description: 'Reads a note',
		parameters: [],
		handler: async (input: unknown, context?: CommandContext) => {
			seen.push(context?.idempotencyKey ?? null);
			if ((input as { nest?: boolean }).nest) await registry.execute('note-read', {}, context);
			return success({});
		},
	});
	return { registry, seen };
}

describe('the core registry and idempotency keys', () => {
	it('delivers a valid key, and none to a nested call (K3, K6)', async () => {
		const { registry, seen } = noting();
		await registry.execute('note-read', { nest: true }, { idempotencyKey: 'k1' });
		expect(seen).toEqual(['k1', null]);
	});

	it('keeps the dispatch id and the key apart on a shared context (I2, K6)', async () => {
		const seen: Array<{ id: unknown; key: unknown }> = [];
		const registry = createCommandRegistry();
		registry.register({
			name: 'note-read',
			description: 'Reads a note',
			parameters: [],
			handler: async (input: unknown, context?: CommandContext) => {
				const own = { id: context?.dispatchId, key: context?.idempotencyKey ?? null };
				if ((input as { nest?: boolean }).nest) {
					await registry.execute('note-read', {}, context);
					// After the nested call returns, the handler still reads its own id and key.
					expect(context?.dispatchId).toBe(own.id);
					expect(context?.idempotencyKey).toBe('k1');
				}
				seen.push(own);
				return success({});
			},
		});
		await registry.execute('note-read', { nest: true }, { idempotencyKey: 'k1' });
		const [nested, outer] = seen;
		expect(outer?.key).toBe('k1');
		expect(nested?.key).toBeNull();
		expect(typeof outer?.id).toBe('string');
		expect(nested?.id).not.toBe(outer?.id);
	});

	it('refuses a malformed key before the handler (K2)', async () => {
		const { registry, seen } = noting();
		const result = await registry.execute('note-read', {}, { idempotencyKey: 'k:1' });
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.details?.meta).toBe('dev.afd/idempotencyKey');
		expect(seen).toEqual([]);
	});

	it('runs batch items under derived keys (K4)', async () => {
		const { registry, seen } = noting();
		await registry.executeBatch(
			{
				commands: [
					{ command: 'note-read', input: {} },
					{ command: 'note-read', input: {} },
				],
			},
			{ idempotencyKey: 'b1' }
		);
		expect(seen).toEqual(['b1:0', 'b1:1']);
	});
});
