/**
 * @fileoverview Unit tests for token.override command
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokenOverrideCommand } from './override.js';
import { tokensResolveCommand } from './resolve.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

describe('token.override command', () => {
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

		// Add base token
		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.primary',
				value: '#0066CC',
			},
			context,
		);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// SUCCESS CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('overrides an inherited token value', async () => {
		const result = await tokenOverrideCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'color.primary',
				value: '#107C10',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.nodeId).toBe('xbox');
		expect(result.data?.tokenId).toBe('color.primary');
		expect(result.data?.newValue).toBe('#107C10');
		expect(result.data?.operationId).toBeDefined();
	});

	it('override affects resolved token', async () => {
		await tokenOverrideCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'color.primary',
				value: '#107C10',
			},
			context,
		);

		const resolveResult = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);

		expect(resolveResult.success).toBe(true);
		const token = resolveResult.data?.tokens.find((t) => t.id === 'color.primary');
		expect(token?.value).toBe('#107C10');
		expect(token?.resolvedAt).toBe('xbox');
	});

	it('override cascades to child nodes', async () => {
		await tokenOverrideCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'color.primary',
				value: '#107C10',
			},
			context,
		);

		const resolveResult = await tokensResolveCommand.handler({ nodeId: 'xbox-ios' }, context);

		expect(resolveResult.success).toBe(true);
		const token = resolveResult.data?.tokens.find((t) => t.id === 'color.primary');
		expect(token?.value).toBe('#107C10');
		expect(token?.resolvedAt).toBe('xbox');
	});

	it('child override takes precedence', async () => {
		await tokenOverrideCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'color.primary',
				value: '#107C10',
			},
			context,
		);
		await tokenOverrideCommand.handler(
			{
				nodeId: 'xbox-ios',
				tokenId: 'color.primary',
				value: '#FF5500',
			},
			context,
		);

		const resolveResult = await tokensResolveCommand.handler({ nodeId: 'xbox-ios' }, context);

		expect(resolveResult.success).toBe(true);
		const token = resolveResult.data?.tokens.find((t) => t.id === 'color.primary');
		expect(token?.value).toBe('#FF5500');
		expect(token?.resolvedAt).toBe('xbox-ios');
	});

	it('overrides with reason', async () => {
		const result = await tokenOverrideCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'color.primary',
				value: '#107C10',
				reason: 'Xbox brand green override',
			},
			context,
		);

		expect(result.success).toBe(true);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// ERROR CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('fails if node does not exist', async () => {
		const result = await tokenOverrideCommand.handler(
			{
				nodeId: 'nonexistent',
				tokenId: 'color.primary',
				value: '#FF0000',
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
		const result = await tokenOverrideCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'color.primary',
				value: '#107C10',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.reasoning).toBeDefined();
	});

	it.each(['__proto__.polluted', 'constructor.prototype.x'])(
		"rejects token id '%s' with a validation error and stores nothing",
		async (tokenId) => {
			const result = await tokenOverrideCommand.handler(
				{ nodeId: 'xbox', tokenId, value: 'yes' },
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('VALIDATION_ERROR');
			expect(await db.getOperations('xbox')).toHaveLength(0);
		},
	);
});
