/**
 * @fileoverview DirectClient's `idempotencyKey` call option (`spec/idempotency.md`, K1, K4).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { McpClient } from './client.js';
import { createDirectClient, type DirectRegistry } from './direct.js';

/** A registry that records the key each call's context carries. */
function recordingRegistry() {
	const keys: unknown[] = [];
	const registry: DirectRegistry = {
		async execute<T>(_name: string, _input?: unknown, context?: CommandContext) {
			keys.push(context?.idempotencyKey);
			return success({}) as CommandResult<T>;
		},
		listCommandNames: () => ['order-place'],
		listCommands: () => [{ name: 'order-place', description: 'Places an order' }],
		hasCommand: (name) => name === 'order-place',
	};
	return { registry, keys };
}

describe('DirectClient idempotencyKey', () => {
	it('sets the key on the call context', async () => {
		const { registry, keys } = recordingRegistry();
		await createDirectClient(registry).call('order-place', {}, { idempotencyKey: 'k1' });
		expect(keys).toEqual(['k1']);
	});

	it('sets no key without the option', async () => {
		const { registry, keys } = recordingRegistry();
		await createDirectClient(registry).call('order-place', {});
		expect(keys).toEqual([undefined]);
	});

	it('runs each pipe step under its derived key', async () => {
		const { registry, keys } = recordingRegistry();
		await createDirectClient(registry).pipe(
			[
				{ command: 'order-place', input: {} },
				{ command: 'order-place', input: {} },
			],
			{ idempotencyKey: 'p1' }
		);
		expect(keys).toEqual(['p1:step:0', 'p1:step:1']);
	});
});

describe("McpClient's idempotencyKey over the direct transport", () => {
	it('reaches the registry for a call and as the base of a batch', async () => {
		const { registry, keys } = recordingRegistry();
		const client = new McpClient({ transport: 'direct', registry });
		await client.connect();
		try {
			await client.call('order-place', {}, { idempotencyKey: 'k1' });
			await client.callTool(
				'afd-batch',
				{ commands: [{ command: 'order-place', input: {} }] },
				{ idempotencyKey: 'b1' }
			);
			await client.call('order-place', {});
			expect(keys).toEqual(['k1', 'b1:0', undefined]);
		} finally {
			await client.disconnect();
		}
	});
});
