/**
 * @fileoverview Unit tests for token.add command
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokensResolveCommand } from './resolve.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

describe('token.add command', () => {
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
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// SUCCESS CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('adds a new token to a node', async () => {
		const result = await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.primary',
				value: '#0066CC',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.nodeId).toBe('global-base');
		expect(result.data?.tokenId).toBe('color.primary');
		expect(result.data?.value).toBe('#0066CC');
		expect(result.data?.operationId).toBeDefined();
	});

	it('adds token with complex value (object)', async () => {
		const result = await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'typography.heading',
				value: {
					fontFamily: 'Segoe UI',
					fontSize: '24px',
					fontWeight: 700,
				},
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.value).toEqual({
			fontFamily: 'Segoe UI',
			fontSize: '24px',
			fontWeight: 700,
		});
	});

	it('adds token with reason', async () => {
		const result = await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.brand',
				value: '#107C10',
				reason: 'Xbox brand green',
			},
			context,
		);

		expect(result.success).toBe(true);
	});

	it('token is resolvable after adding', async () => {
		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.primary',
				value: '#0066CC',
			},
			context,
		);

		const resolveResult = await tokensResolveCommand.handler({ nodeId: 'global-base' }, context);

		expect(resolveResult.success).toBe(true);
		const token = resolveResult.data?.tokens.find((t) => t.id === 'color.primary');
		expect(token).toBeDefined();
		expect(token?.value).toBe('#0066CC');
	});

	it('token is inherited by child nodes', async () => {
		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.primary',
				value: '#0066CC',
			},
			context,
		);

		const resolveResult = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);

		expect(resolveResult.success).toBe(true);
		const token = resolveResult.data?.tokens.find((t) => t.id === 'color.primary');
		expect(token?.value).toBe('#0066CC');
		expect(token?.resolvedAt).toBe('global-base');
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// ERROR CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('fails if node does not exist', async () => {
		const result = await tokenAddCommand.handler(
			{
				nodeId: 'nonexistent',
				tokenId: 'color.primary',
				value: '#0066CC',
			},
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
	});

	it('fails if token already exists at node', async () => {
		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.primary',
				value: '#0066CC',
			},
			context,
		);

		const result = await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.primary',
				value: '#FF0000',
			},
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('TOKEN_ALREADY_EXISTS');
		expect(result.error?.suggestion).toContain('token.override');
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// REASONING TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	it('includes reasoning in response', async () => {
		const result = await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.primary',
				value: '#0066CC',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.reasoning).toBeDefined();
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// RESERVED PATH SEGMENTS (prototype pollution)
	// ═══════════════════════════════════════════════════════════════════════════

	it.each(['__proto__.polluted', 'color.__proto__', 'constructor.prototype.x', 'a.prototype'])(
		"rejects token id '%s' with a validation error and stores nothing",
		async (tokenId) => {
			const result = await tokenAddCommand.handler(
				{ nodeId: 'global-base', tokenId, value: 'yes' },
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('VALIDATION_ERROR');
			expect(await db.getOperations('global-base')).toHaveLength(0);
		},
	);

	it('allows ids that merely contain a reserved word inside a segment', async () => {
		const result = await tokenAddCommand.handler(
			{ nodeId: 'global-base', tokenId: 'color.constructor-blue', value: '#0000FF' },
			context,
		);

		expect(result.success).toBe(true);
	});
});
