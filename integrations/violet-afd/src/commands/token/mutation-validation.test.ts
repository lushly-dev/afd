/**
 * @fileoverview Regression tests for token mutation validation (add/override/subtract)
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokenOverrideCommand } from './override.js';
import { tokensResolveCommand } from './resolve.js';
import { tokenSubtractCommand } from './subtract.js';

describe('token mutation validation', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		await nodeCreateCommand.handler({ name: 'root', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler({ name: 'child', type: 'product', parentId: 'root' }, context);
		await tokenAddCommand.handler(
			{ nodeId: 'root', tokenId: 'color.accent', value: '#111111' },
			context,
		);
	});

	describe('token.override', () => {
		it('fails for a token that does not exist and creates nothing', async () => {
			const result = await tokenOverrideCommand.handler(
				{ nodeId: 'child', tokenId: 'color.typo', value: '#222222' },
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('TOKEN_NOT_FOUND');
			expect(await db.getOperations('child')).toEqual([]);

			const resolved = await tokensResolveCommand.handler({ nodeId: 'child' }, context);
			expect(resolved.data?.tokens.map((t) => t.id)).toEqual(['color.accent']);
		});

		it('allows overriding an inherited token', async () => {
			const result = await tokenOverrideCommand.handler(
				{ nodeId: 'child', tokenId: 'color.accent', value: '#222222' },
				context,
			);
			expect(result.success).toBe(true);
		});

		it('allows overriding a token added on the same node', async () => {
			await tokenAddCommand.handler(
				{ nodeId: 'child', tokenId: 'color.local', value: '#333333' },
				context,
			);
			const result = await tokenOverrideCommand.handler(
				{ nodeId: 'child', tokenId: 'color.local', value: '#444444' },
				context,
			);
			expect(result.success).toBe(true);
		});

		it('reports the value the node resolved before as oldValue', async () => {
			await tokenOverrideCommand.handler(
				{ nodeId: 'child', tokenId: 'color.accent', value: '#aaaaaa' },
				context,
			);
			await tokenOverrideCommand.handler(
				{ nodeId: 'child', tokenId: 'color.accent', value: '#bbbbbb' },
				context,
			);
			const third = await tokenOverrideCommand.handler(
				{ nodeId: 'child', tokenId: 'color.accent', value: '#cccccc' },
				context,
			);

			expect(third.success).toBe(true);
			expect(third.data?.oldValue).toBe('#bbbbbb');

			const audit = await db.getAuditEvents({
				targetToken: 'color.accent',
				eventType: 'token_updated',
			});
			// Newest first; the first override replaced the inherited value (#90)
			expect(audit.map((e) => e.oldValue)).toEqual(['"#bbbbbb"', '"#aaaaaa"', '"#111111"']);
		});
	});

	describe('token.subtract', () => {
		it('fails for a token that does not exist and logs nothing', async () => {
			const result = await tokenSubtractCommand.handler(
				{ nodeId: 'child', tokenId: 'color.nope' },
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('TOKEN_NOT_FOUND');
			expect(await db.getOperations('child')).toEqual([]);
			expect(await db.getAuditEvents({ eventType: 'token_deleted' })).toEqual([]);
		});

		it('fails when the token was already subtracted', async () => {
			const first = await tokenSubtractCommand.handler(
				{ nodeId: 'child', tokenId: 'color.accent' },
				context,
			);
			expect(first.success).toBe(true);

			const second = await tokenSubtractCommand.handler(
				{ nodeId: 'child', tokenId: 'color.accent' },
				context,
			);
			expect(second.success).toBe(false);
			expect(second.error?.code).toBe('TOKEN_NOT_FOUND');
		});

		it('subtracts an inherited token', async () => {
			const result = await tokenSubtractCommand.handler(
				{ nodeId: 'child', tokenId: 'color.accent' },
				context,
			);
			expect(result.success).toBe(true);
			expect(await db.getAuditEvents({ eventType: 'token_deleted' })).toHaveLength(1);
		});
	});

	describe('token.add', () => {
		it('fails when the token already exists in an ancestor', async () => {
			const result = await tokenAddCommand.handler(
				{ nodeId: 'child', tokenId: 'color.accent', value: '#999999' },
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('TOKEN_ALREADY_EXISTS');
			expect(await db.getOperations('child')).toEqual([]);
		});

		it('fails when the token exists in a grandparent', async () => {
			await nodeCreateCommand.handler(
				{ name: 'grandchild', type: 'platform', parentId: 'child' },
				context,
			);
			const result = await tokenAddCommand.handler(
				{ nodeId: 'grandchild', tokenId: 'color.accent', value: '#999999' },
				context,
			);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('TOKEN_ALREADY_EXISTS');
		});

		it('allows adding a brand new token and re-adding after an ancestor subtraction', async () => {
			const fresh = await tokenAddCommand.handler(
				{ nodeId: 'child', tokenId: 'color.fresh', value: '#999999' },
				context,
			);
			expect(fresh.success).toBe(true);

			// mid subtracts the token, so a grandchild may define it again
			await nodeCreateCommand.handler(
				{ name: 'grandchild', type: 'platform', parentId: 'child' },
				context,
			);
			await tokenSubtractCommand.handler({ nodeId: 'child', tokenId: 'color.accent' }, context);
			const readd = await tokenAddCommand.handler(
				{ nodeId: 'grandchild', tokenId: 'color.accent', value: '#777777' },
				context,
			);
			expect(readd.success).toBe(true);
		});
	});
});
