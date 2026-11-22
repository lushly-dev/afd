/**
 * @fileoverview Operation sequences are allocated atomically with the insert on
 * every store (MemoryDatabase, SQLiteDatabase and PostgresDatabase), so
 * concurrent token writes never share a sequence (#1958).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importJsonCommand } from '../commands/import/json.js';
import { nodeCreateCommand } from '../commands/node/create.js';
import type { CommandContext, Database } from '../commands/registry.js';
import { tokenAddCommand } from '../commands/token/add.js';
import { tokenOverrideCommand } from '../commands/token/override.js';
import { tokenRemoveCommand } from '../commands/token/remove.js';
import { isolatedStoreAdapters } from './store-adapters.test-support.js';

for (const { name, create, skip } of isolatedStoreAdapters) {
	describe.skipIf(skip)(`atomic operation sequence contract (#1958): ${name}`, () => {
		let db: Database;
		let close: () => Promise<void> = async () => {};
		let context: CommandContext;

		beforeEach(async () => {
			({ db, close } = await create());
			context = { db, actor: 'test', traceId: 'seq-contract' };
			await nodeCreateCommand.handler({ name: 'root', type: 'root', parentId: null }, context);
		});

		afterEach(async () => {
			await close();
		});

		it('gives concurrent token.add calls distinct monotonic sequences after a removal', async () => {
			const first = await tokenAddCommand.handler(
				{ nodeId: 'root', tokenId: 'color.a', value: '#111111' },
				context,
			);
			await tokenAddCommand.handler(
				{ nodeId: 'root', tokenId: 'color.b', value: '#222222' },
				context,
			);
			await tokenRemoveCommand.handler(
				{ nodeId: 'root', operationId: first.data?.operationId },
				context,
			);

			const [c, d] = await Promise.all([
				tokenAddCommand.handler({ nodeId: 'root', tokenId: 'color.c', value: '#333333' }, context),
				tokenAddCommand.handler({ nodeId: 'root', tokenId: 'color.d', value: '#444444' }, context),
			]);

			expect(c.success).toBe(true);
			expect(d.success).toBe(true);

			const sequences = (await db.getOperations('root')).map((op) => op.sequence);
			expect(sequences).toEqual([2, 3, 4]);
		});

		it('gives concurrent token.override calls distinct sequences', async () => {
			await tokenAddCommand.handler(
				{ nodeId: 'root', tokenId: 'color.a', value: '#111111' },
				context,
			);

			const results = await Promise.all([
				tokenOverrideCommand.handler(
					{ nodeId: 'root', tokenId: 'color.a', value: '#222222' },
					context,
				),
				tokenOverrideCommand.handler(
					{ nodeId: 'root', tokenId: 'color.a', value: '#333333' },
					context,
				),
				tokenOverrideCommand.handler(
					{ nodeId: 'root', tokenId: 'color.a', value: '#444444' },
					context,
				),
			]);
			expect(results.every((r) => r.success)).toBe(true);

			const sequences = (await db.getOperations('root')).map((op) => op.sequence);
			expect(sequences).toEqual([1, 2, 3, 4]);
		});

		it('gives concurrent import.json calls distinct sequences', async () => {
			const [a, b] = await Promise.all([
				importJsonCommand.handler(
					{
						targetNode: 'root',
						content: JSON.stringify({
							color: { a1: { $value: '#111111' }, a2: { $value: '#222222' } },
						}),
					},
					context,
				),
				importJsonCommand.handler(
					{
						targetNode: 'root',
						content: JSON.stringify({
							color: { b1: { $value: '#333333' }, b2: { $value: '#444444' } },
						}),
					},
					context,
				),
			]);
			expect(a.success).toBe(true);
			expect(b.success).toBe(true);

			const sequences = (await db.getOperations('root')).map((op) => op.sequence);
			expect(sequences).toEqual([1, 2, 3, 4]);
		});

		it('allocates distinct sequences for concurrent db.appendOperation calls', async () => {
			const makeRecord = (id: string, tokenId: string) => ({
				id,
				nodeId: 'root',
				type: 'add' as const,
				tokenId,
				value: JSON.stringify('#000000'),
				metadata: null,
				fromNode: null,
				asTokenId: null,
				toAncestor: null,
				reason: null,
				author: 'test',
				createdAt: '2026-01-01T00:00:00.000Z',
			});

			const appended = await Promise.all([
				db.appendOperation(makeRecord('op-1', 'color.one')),
				db.appendOperation(makeRecord('op-2', 'color.two')),
				db.appendOperation(makeRecord('op-3', 'color.three')),
			]);

			expect(appended.map((op) => op.sequence).sort((a, b) => a - b)).toEqual([1, 2, 3]);
			expect((await db.getOperations('root')).map((op) => op.sequence)).toEqual([1, 2, 3]);
		});
	});
}
