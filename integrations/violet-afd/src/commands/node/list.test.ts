/**
 * @fileoverview Unit tests for node.list command
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../registry.js';
import { nodeCreateCommand } from './create.js';
import { nodeListCommand } from './list.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

describe('node.list command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// Set up test hierarchy
		await nodeCreateCommand.handler({ name: 'global-base', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler(
			{
				name: 'xbox',
				type: 'product',
				parentId: 'global-base',
				tags: ['gaming'],
			},
			context,
		);
		await nodeCreateCommand.handler(
			{
				name: 'vscode',
				type: 'product',
				parentId: 'global-base',
				tags: ['development'],
			},
			context,
		);
		await nodeCreateCommand.handler(
			{ name: 'xbox-ios', type: 'platform', parentId: 'xbox' },
			context,
		);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// FLAT VIEW TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	it('lists all nodes in flat view by default', async () => {
		const result = await nodeListCommand.handler({}, context);

		expect(result.success).toBe(true);
		expect(result.data?.nodes).toHaveLength(4);
		expect(result.data?.total).toBe(4);
	});

	it('lists children of a specific parent', async () => {
		const result = await nodeListCommand.handler({ parentId: 'global-base' }, context);

		expect(result.success).toBe(true);
		expect(result.data?.nodes).toHaveLength(2);
		expect(result.data?.nodes?.map((n) => n.id)).toContain('xbox');
		expect(result.data?.nodes?.map((n) => n.id)).toContain('vscode');
	});

	it('lists root nodes when parentId is null', async () => {
		const result = await nodeListCommand.handler({ parentId: null }, context);

		expect(result.success).toBe(true);
		expect(result.data?.nodes).toHaveLength(1);
		expect(result.data?.nodes?.[0].id).toBe('global-base');
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// FILTERING TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	it('filters by type', async () => {
		const result = await nodeListCommand.handler({ filter: { type: 'product' } }, context);

		expect(result.success).toBe(true);
		expect(result.data?.nodes).toHaveLength(2);
		expect(result.data?.nodes?.every((n) => n.type === 'product')).toBe(true);
	});

	it('filters by tags', async () => {
		const result = await nodeListCommand.handler({ filter: { tags: ['gaming'] } }, context);

		expect(result.success).toBe(true);
		expect(result.data?.nodes).toHaveLength(1);
		expect(result.data?.nodes?.[0].id).toBe('xbox');
	});

	it('filters by status', async () => {
		// All nodes are active by default
		const result = await nodeListCommand.handler({ filter: { status: 'active' } }, context);

		expect(result.success).toBe(true);
		expect(result.data?.nodes).toHaveLength(4);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// TREE VIEW TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	it('returns tree view when requested', async () => {
		const result = await nodeListCommand.handler({ view: 'tree' }, context);

		expect(result.success).toBe(true);
		expect(result.data?.tree).toBeDefined();
		expect(result.data?.nodes).toBeUndefined();
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// REASONING TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	it('includes reasoning in response', async () => {
		const result = await nodeListCommand.handler({}, context);

		expect(result.success).toBe(true);
		expect(result.reasoning).toContain('4 nodes');
	});
});
