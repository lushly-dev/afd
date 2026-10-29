/**
 * @fileoverview Unit tests for token.subtract command
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokensResolveCommand } from './resolve.js';
import { tokenSubtractCommand } from './subtract.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

describe('token.subtract command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// Set up test hierarchy
		await nodeCreateCommand.handler({ name: 'global-base', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler(
			{ name: 'xbox', type: 'product', parentId: 'global-base' },
			context,
		);
		await nodeCreateCommand.handler(
			{ name: 'xbox-ios', type: 'platform', parentId: 'xbox' },
			context,
		);

		// Add base tokens
		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.primary',
				value: '#0066CC',
			},
			context,
		);
		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'typography.monospace',
				value: 'Consolas',
			},
			context,
		);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// SUCCESS CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('subtracts an inherited token', async () => {
		const result = await tokenSubtractCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'typography.monospace',
				reason: 'Xbox UI has no code display',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.nodeId).toBe('xbox');
		expect(result.data?.tokenId).toBe('typography.monospace');
		expect(result.data?.operationId).toBeDefined();
	});

	it('subtracted token is removed from resolved tokens', async () => {
		await tokenSubtractCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'typography.monospace',
			},
			context,
		);

		const resolveResult = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);

		expect(resolveResult.success).toBe(true);
		const token = resolveResult.data?.tokens.find((t) => t.id === 'typography.monospace');
		expect(token).toBeUndefined();
	});

	it('subtract cascades to child nodes', async () => {
		await tokenSubtractCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'typography.monospace',
			},
			context,
		);

		const resolveResult = await tokensResolveCommand.handler({ nodeId: 'xbox-ios' }, context);

		expect(resolveResult.success).toBe(true);
		const token = resolveResult.data?.tokens.find((t) => t.id === 'typography.monospace');
		expect(token).toBeUndefined();
	});

	it('other tokens are not affected', async () => {
		await tokenSubtractCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'typography.monospace',
			},
			context,
		);

		const resolveResult = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);

		expect(resolveResult.success).toBe(true);
		const primaryToken = resolveResult.data?.tokens.find((t) => t.id === 'color.primary');
		expect(primaryToken).toBeDefined();
		expect(primaryToken?.value).toBe('#0066CC');
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// ERROR CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('fails if node does not exist', async () => {
		const result = await tokenSubtractCommand.handler(
			{
				nodeId: 'nonexistent',
				tokenId: 'color.primary',
			},
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// REASONING TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	it('includes reasoning in response', async () => {
		const result = await tokenSubtractCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'typography.monospace',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.reasoning).toBeDefined();
	});
});
