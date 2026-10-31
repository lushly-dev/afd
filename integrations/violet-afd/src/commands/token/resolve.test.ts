import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokenOverrideCommand } from './override.js';
import { tokensResolveCommand } from './resolve.js';
import { tokenSubtractCommand } from './subtract.js';

describe('tokens.resolve command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// Set up a basic hierarchy: global-base -> xbox -> xbox-ios
		await nodeCreateCommand.handler({ name: 'global-base', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler(
			{ name: 'xbox', type: 'product', parentId: 'global-base' },
			context,
		);
		await nodeCreateCommand.handler(
			{ name: 'xbox-ios', type: 'platform', parentId: 'xbox' },
			context,
		);
	});

	it('should resolve tokens with inheritance', async () => {
		// Add token at root
		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.brand.primary',
				value: '#0078D4',
			},
			context,
		);

		// Resolve at leaf node
		const result = await tokensResolveCommand.handler({ nodeId: 'xbox-ios' }, context);

		expect(result.success).toBe(true);
		expect(result.data?.tokens).toHaveLength(1);
		expect(result.data?.tokens[0].id).toBe('color.brand.primary');
		expect(result.data?.tokens[0].value).toBe('#0078D4');
		expect(result.data?.tokens[0].resolvedAt).toBe('global-base');
	});

	it('should apply overrides', async () => {
		// Add token at root
		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.accent.primary',
				value: '#0078D4',
			},
			context,
		);

		// Override at xbox
		await tokenOverrideCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'color.accent.primary',
				value: '#107C10',
			},
			context,
		);

		// Resolve at xbox-ios - should get xbox's value
		const result = await tokensResolveCommand.handler({ nodeId: 'xbox-ios' }, context);

		expect(result.success).toBe(true);
		expect(result.data?.tokens[0].value).toBe('#107C10');
		expect(result.data?.tokens[0].resolvedAt).toBe('xbox');
	});

	it('should handle subtractions', async () => {
		// Add token at root
		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'typography.code.monospace',
				value: 'Consolas',
			},
			context,
		);

		// Subtract at xbox
		await tokenSubtractCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'typography.code.monospace',
			},
			context,
		);

		// Resolve at xbox-ios - token should be gone
		const result = await tokensResolveCommand.handler({ nodeId: 'xbox-ios' }, context);

		expect(result.success).toBe(true);
		expect(result.data?.tokens).toHaveLength(0);
	});

	it('should filter tokens by pattern', async () => {
		// Add multiple tokens
		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.brand.primary',
				value: '#0078D4',
			},
			context,
		);
		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.brand.secondary',
				value: '#106EBE',
			},
			context,
		);
		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'spacing.base',
				value: '8px',
			},
			context,
		);

		// Filter for color tokens only
		const result = await tokensResolveCommand.handler(
			{ nodeId: 'global-base', filter: 'color.*' },
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.tokens).toHaveLength(2);
		expect(result.data?.tokens.every((t) => t.id.startsWith('color.'))).toBe(true);
	});

	it('should include ancestry chain', async () => {
		const result = await tokensResolveCommand.handler({ nodeId: 'xbox-ios' }, context);

		expect(result.success).toBe(true);
		expect(result.data?.ancestryChain).toEqual(['global-base', 'xbox']);
	});

	it('should fail for nonexistent node', async () => {
		const result = await tokensResolveCommand.handler({ nodeId: 'nonexistent' }, context);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
	});

	describe('inheritance cycles', () => {
		/** Store a copy operation directly, bypassing token.copy's validation */
		const storeCopy = async (
			nodeId: string,
			fromNode: string,
			tokenId: string,
			asTokenId?: string,
		) => {
			const ops = await db.getOperations(nodeId);
			await db.addOperation({
				id: `op-${nodeId}-${ops.length + 1}`,
				nodeId,
				sequence: ops.length + 1,
				type: 'copy',
				tokenId: asTokenId ?? tokenId,
				value: null,
				metadata: null,
				fromNode,
				asTokenId: asTokenId ?? null,
				toAncestor: null,
				reason: null,
				author: 'test',
				createdAt: new Date().toISOString(),
			});
		};

		it('returns a structured failure for a node that copies from itself', async () => {
			await tokenAddCommand.handler(
				{ nodeId: 'xbox', tokenId: 'color.x', value: '#111111' },
				context,
			);
			await storeCopy('xbox', 'xbox', 'color.x', 'color.y');

			const result = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('CIRCULAR_REFERENCE');
			expect(result.error?.message).toContain('xbox');
		});

		it('returns a structured failure for mutual copies (A <- B, B <- A)', async () => {
			await tokenAddCommand.handler(
				{ nodeId: 'xbox', tokenId: 'color.x', value: '#111111' },
				context,
			);
			await tokenAddCommand.handler(
				{ nodeId: 'xbox-ios', tokenId: 'color.z', value: '#222222' },
				context,
			);
			await storeCopy('xbox', 'xbox-ios', 'color.z');
			await storeCopy('xbox-ios', 'xbox', 'color.x');

			const result = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('CIRCULAR_REFERENCE');
		});

		it('returns a structured failure when a parent includes its own descendant', async () => {
			await db.updateNode('xbox', { includes: ['xbox-ios'] });

			const result = await tokensResolveCommand.handler({ nodeId: 'xbox-ios' }, context);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('CIRCULAR_REFERENCE');
		});

		it('fails with a depth error instead of recursing without bound', async () => {
			const count = 100;
			for (let i = 0; i < count; i++) {
				await nodeCreateCommand.handler(
					{ name: `chain-${i}`, type: 'shared', parentId: null },
					context,
				);
			}
			for (let i = 0; i < count - 1; i++) {
				await db.updateNode(`chain-${i}`, { includes: [`chain-${i + 1}`] });
			}

			const result = await tokensResolveCommand.handler({ nodeId: 'chain-0' }, context);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('CIRCULAR_REFERENCE');
			expect(result.error?.message).toMatch(/depth/i);
		});

		it('still resolves a node reached through two include paths (diamond)', async () => {
			for (const name of ['shared-base', 'mixin-a', 'mixin-b', 'consumer']) {
				await nodeCreateCommand.handler({ name, type: 'shared', parentId: null }, context);
			}
			await tokenAddCommand.handler(
				{ nodeId: 'shared-base', tokenId: 'color.shared', value: '#333333' },
				context,
			);
			await db.updateNode('mixin-a', { includes: ['shared-base'] });
			await db.updateNode('mixin-b', { includes: ['shared-base'] });
			await db.updateNode('consumer', { includes: ['mixin-a', 'mixin-b'] });

			const result = await tokensResolveCommand.handler({ nodeId: 'consumer' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.tokens.map((t) => t.id)).toEqual(['color.shared']);
		});
	});
});
