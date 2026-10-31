import type { OperationRecord } from '@lushly-dev/violet-core/types';
/**
 * Command behaviour that depends on the store, run on MemoryDatabase,
 * SQLiteDatabase(':memory:') and, when VIOLET_TEST_POSTGRES_URL is set,
 * Postgres (see store-adapters.test-support.ts): audit order (#89), the old
 * values token changes record (#90) and how stored resets resolve (#88).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyzeHealthCommand } from '../commands/analyze/health.js';
import { auditListCommand } from '../commands/audit/list.js';
import { nodeCreateCommand } from '../commands/node/create.js';
import type { CommandContext, Database } from '../commands/registry.js';
import { tokenAddCommand } from '../commands/token/add.js';
import { tokenCopyCommand } from '../commands/token/copy.js';
import { tokenOverrideCommand } from '../commands/token/override.js';
import { tokenResetCommand } from '../commands/token/reset.js';
import { tokensResolveCommand } from '../commands/token/resolve.js';
import { tokenSubtractCommand } from '../commands/token/subtract.js';
import { isolatedStoreAdapters } from './store-adapters.test-support.js';

for (const { name, create, skip } of isolatedStoreAdapters) {
	describe.skipIf(skip)(`command store contract: ${name}`, () => {
		let db: Database;
		let close: () => Promise<void> = async () => {};
		let context: CommandContext;

		beforeEach(async () => {
			({ db, close } = await create());
			context = { db, actor: 'test', traceId: 'contract' };
			await nodeCreateCommand.handler({ name: 'root', type: 'root', parentId: null }, context);
			await nodeCreateCommand.handler(
				{ name: 'product', type: 'product', parentId: 'root' },
				context,
			);
			await nodeCreateCommand.handler(
				{ name: 'theme', type: 'theme', parentId: 'product' },
				context,
			);
			await tokenAddCommand.handler(
				{ nodeId: 'root', tokenId: 'color.primary', value: '#0066CC' },
				context,
			);
			await tokenAddCommand.handler(
				{ nodeId: 'root', tokenId: 'spacing.md', value: '8px' },
				context,
			);
		});

		afterEach(async () => {
			await close();
		});

		const audit = async (input: Record<string, unknown> = {}) => {
			const result = await auditListCommand.handler(input, context);
			if (!result.success || !result.data) throw new Error(result.error?.message);
			return result.data.events;
		};

		const resolve = async (nodeId: string, tokenId: string) => {
			const result = await tokensResolveCommand.handler({ nodeId, includeLineage: true }, context);
			return result.data?.tokens.find((token) => token.id === tokenId);
		};

		/** Store an operation directly, bypassing the commands' validation */
		const store = async (record: Partial<OperationRecord> & Pick<OperationRecord, 'nodeId'>) => {
			const ops = await db.getOperations(record.nodeId);
			await db.addOperation({
				id: `op-${record.nodeId}-${ops.length + 1}`,
				sequence: ops.length + 1,
				type: 'reset',
				tokenId: 'color.primary',
				value: null,
				metadata: null,
				fromNode: null,
				asTokenId: null,
				toAncestor: null,
				reason: null,
				author: 'test',
				createdAt: new Date().toISOString(),
				...record,
			});
		};

		it('lists events newest first in the order they were written (#89)', async () => {
			await tokenOverrideCommand.handler(
				{ nodeId: 'product', tokenId: 'color.primary', value: '#107C10' },
				context,
			);
			await tokenSubtractCommand.handler({ nodeId: 'theme', tokenId: 'spacing.md' }, context);

			expect((await audit()).map((event) => `${event.eventType} ${event.targetNode}`)).toEqual([
				'token_deleted theme',
				'token_updated product',
				'token_created root',
				'token_created root',
				'node_created theme',
				'node_created product',
				'node_created root',
			]);
		});

		it('reads the same order through getAuditEvents (#111)', async () => {
			await tokenOverrideCommand.handler(
				{ nodeId: 'product', tokenId: 'color.primary', value: '#107C10' },
				context,
			);
			await tokenOverrideCommand.handler(
				{ nodeId: 'product', tokenId: 'color.primary', value: '#0E7A0D' },
				context,
			);
			await tokenSubtractCommand.handler({ nodeId: 'theme', tokenId: 'spacing.md' }, context);

			const all = await db.getAuditEvents({});
			expect(all.map((event) => event.id)).toEqual((await audit()).map((event) => event.id));
			const updates = await db.getAuditEvents({
				targetNode: 'product',
				targetToken: 'color.primary',
				eventType: 'token_updated',
			});
			expect(updates.map((event) => event.newValue)).toEqual(['"#0E7A0D"', '"#107C10"']);
		});

		it('records the inherited value a first override replaces (#90)', async () => {
			await tokenOverrideCommand.handler(
				{ nodeId: 'product', tokenId: 'color.primary', value: '#107C10', reason: 'brand' },
				context,
			);
			await tokenOverrideCommand.handler(
				{ nodeId: 'product', tokenId: 'color.primary', value: '#0E7A0D' },
				context,
			);

			const [second, first] = await audit({ eventTypes: ['token_updated'] });
			expect(first).toMatchObject({
				oldValue: '#0066CC',
				newValue: '#107C10',
				metadata: { reason: 'brand', oldValueFrom: 'root', inherited: true },
			});
			expect(second).toMatchObject({
				oldValue: '#107C10',
				newValue: '#0E7A0D',
				metadata: { oldValueFrom: 'product', inherited: false },
			});
		});

		it('records the old value of a subtract, a reset and a copy (#90)', async () => {
			await tokenOverrideCommand.handler(
				{ nodeId: 'product', tokenId: 'color.primary', value: '#107C10' },
				context,
			);
			await tokenSubtractCommand.handler({ nodeId: 'theme', tokenId: 'spacing.md' }, context);
			await tokenOverrideCommand.handler(
				{ nodeId: 'theme', tokenId: 'color.primary', value: '#52B043' },
				context,
			);
			await tokenResetCommand.handler({ nodeId: 'theme', tokenId: 'color.primary' }, context);
			await tokenCopyCommand.handler(
				{ nodeId: 'theme', tokenId: 'color.primary', fromNode: 'root' },
				context,
			);

			const [copy, reset] = await audit({ nodeId: 'theme', tokenId: 'color.primary' });
			const [subtract] = await audit({ eventTypes: ['token_deleted'] });
			expect(subtract).toMatchObject({
				oldValue: '8px',
				metadata: { oldValueFrom: 'root', inherited: true },
			});
			expect(reset).toMatchObject({
				oldValue: '#52B043',
				newValue: { reset: true, toAncestor: 'product' },
				metadata: { oldValueFrom: 'theme', inherited: false },
			});
			// After the reset, theme resolves product's value again
			expect(copy).toMatchObject({
				oldValue: '#107C10',
				metadata: { oldValueFrom: 'product', inherited: true },
			});
		});

		it('resolves a reset with no target to the root of the node storing it (#88)', async () => {
			await tokenOverrideCommand.handler(
				{ nodeId: 'product', tokenId: 'color.primary', value: '#107C10' },
				context,
			);
			await store({ nodeId: 'product' });

			const atProduct = await resolve('product', 'color.primary');
			const atTheme = await resolve('theme', 'color.primary');
			expect(atProduct).toMatchObject({ value: '#0066CC', resolvedAt: 'root' });
			expect(atTheme).toMatchObject({ value: '#0066CC', resolvedAt: 'root' });
			expect(atTheme?.operationHistory).toEqual(atProduct?.operationHistory);
		});

		it('ignores a reset on a root or to a non-ancestor, for every node (#88)', async () => {
			await store({ nodeId: 'root' });
			await store({ nodeId: 'root', toAncestor: 'theme' });
			await store({ nodeId: 'product', toAncestor: 'theme' });
			await tokenOverrideCommand.handler(
				{ nodeId: 'root', tokenId: 'color.primary', value: '#333333' },
				context,
			);

			const lineage = [
				{ nodeId: 'root', operation: 'add', value: '#0066CC' },
				{ nodeId: 'root', operation: 'override', value: '#333333' },
			];
			for (const nodeId of ['root', 'product', 'theme']) {
				expect(await resolve(nodeId, 'color.primary')).toMatchObject({
					value: '#333333',
					resolvedAt: 'root',
					operationHistory: lineage,
				});
			}

			const health = await analyzeHealthCommand.handler({}, context);
			const flags = health.data?.nodes.flatMap((node) =>
				node.flags
					.filter((flag) => flag.kind === 'inert-reset')
					.map((flag) => `${node.id} ${flag.toAncestor ?? '-'}`),
			);
			expect(flags).toEqual(['root -', 'root theme', 'product theme']);
			expect(health.data?.summary.flags.inertResets).toBe(3);
		});

		it('refuses token.reset on a root, which has no ancestor (#88)', async () => {
			const result = await tokenResetCommand.handler(
				{ nodeId: 'root', tokenId: 'color.primary' },
				context,
			);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('INVALID_PARENT');
			expect(await db.getOperations('root')).toHaveLength(2);
		});
	});
}
