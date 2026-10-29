/**
 * @fileoverview Unit tests for node.get command
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { tokenOverrideCommand } from '../token/override.js';
import { nodeCreateCommand } from './create.js';
import { nodeGetCommand } from './get.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

describe('node.get command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// Set up a test hierarchy: global-base → xbox → xbox-ios → xbox-ios-dark
		await nodeCreateCommand.handler({ name: 'global-base', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler(
			{ name: 'xbox', type: 'product', parentId: 'global-base' },
			context,
		);
		await nodeCreateCommand.handler(
			{ name: 'xbox-ios', type: 'platform', parentId: 'xbox' },
			context,
		);
		await nodeCreateCommand.handler(
			{ name: 'xbox-ios-dark', type: 'theme', parentId: 'xbox-ios' },
			context,
		);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// SUCCESS CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('gets a node by ID', async () => {
		const result = await nodeGetCommand.handler({ id: 'xbox' }, context);

		expect(result.success).toBe(true);
		expect(result.data?.node.id).toBe('xbox');
		expect(result.data?.node.name).toBe('xbox');
		expect(result.data?.node.type).toBe('product');
	});

	it('returns full node properties', async () => {
		const result = await nodeGetCommand.handler({ id: 'xbox' }, context);

		expect(result.success).toBe(true);
		expect(result.data?.node).toHaveProperty('id');
		expect(result.data?.node).toHaveProperty('name');
		expect(result.data?.node).toHaveProperty('type');
		expect(result.data?.node).toHaveProperty('parentId');
		expect(result.data?.node).toHaveProperty('createdAt');
	});

	it('includes ancestry chain when requested', async () => {
		const result = await nodeGetCommand.handler(
			{ id: 'xbox-ios-dark', includeAncestry: true },
			context,
		);

		expect(result.success).toBe(true);
		// Ancestry chain includes ancestors (not self)
		expect(result.data?.ancestryChain).toEqual(['global-base', 'xbox', 'xbox-ios']);
		expect(result.data?.depth).toBe(3);
	});

	it('includes the node’s own operations when requested (#115)', async () => {
		await tokenAddCommand.handler(
			{ nodeId: 'global-base', tokenId: 'color.bg', value: '#FFFFFF' },
			context,
		);
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.bg', value: '#000000', reason: 'dark brand' },
			context,
		);
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.bg', value: '#111111' },
			context,
		);

		const without = await nodeGetCommand.handler({ id: 'xbox' }, context);
		expect(without.data?.operations).toBeUndefined();

		const result = await nodeGetCommand.handler({ id: 'xbox', includeOperations: true }, context);
		expect(result.data?.operations).toMatchObject([
			{
				sequence: 1,
				type: 'override',
				tokenId: 'color.bg',
				value: '#000000',
				reason: 'dark brand',
				supersededBy: 2,
			},
			{ sequence: 2, type: 'override', tokenId: 'color.bg', value: '#111111' },
		]);
		expect(result.data?.operations?.[1].supersededBy).toBeUndefined();
	});

	it('returns confidence of 1.0 on success', async () => {
		const result = await nodeGetCommand.handler({ id: 'xbox' }, context);

		expect(result.success).toBe(true);
		expect(result.confidence).toBe(1.0);
	});

	it('includes sources', async () => {
		const result = await nodeGetCommand.handler({ id: 'xbox' }, context);

		expect(result.success).toBe(true);
		expect(result.sources).toHaveLength(1);
		expect(result.sources?.[0].id).toBe('xbox');
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// ERROR CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('fails if node does not exist', async () => {
		const result = await nodeGetCommand.handler({ id: 'nonexistent' }, context);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
		expect(result.error?.message).toContain('nonexistent');
	});

	it('suggests similar nodes when not found', async () => {
		const result = await nodeGetCommand.handler({ id: 'xbo' }, context);

		expect(result.success).toBe(false);
		expect(result.error?.suggestion).toContain('xbox');
	});

	it('provides alternatives when similar nodes exist', async () => {
		const result = await nodeGetCommand.handler({ id: 'xbo' }, context);

		expect(result.success).toBe(false);
		expect(result.alternatives).toBeDefined();
		expect(result.alternatives?.length).toBeGreaterThan(0);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// ANCESTRY TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	it('does not include ancestry by default', async () => {
		const result = await nodeGetCommand.handler({ id: 'xbox-ios-dark' }, context);

		expect(result.success).toBe(true);
		expect(result.data?.ancestryChain).toBeUndefined();
		expect(result.data?.depth).toBeUndefined();
	});

	it('handles root node ancestry', async () => {
		const result = await nodeGetCommand.handler(
			{ id: 'global-base', includeAncestry: true },
			context,
		);

		expect(result.success).toBe(true);
		// Root has no ancestors
		expect(result.data?.ancestryChain).toEqual([]);
		expect(result.data?.depth).toBe(0);
	});
});
