/**
 * @fileoverview Unit tests for node.update command
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../registry.js';
import { nodeCreateCommand } from './create.js';
import { nodeGetCommand } from './get.js';
import { nodeUpdateCommand } from './update.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

describe('node.update command', () => {
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
			{ name: 'shared-accessibility', type: 'shared', parentId: null },
			context,
		);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// SUCCESS CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('updates node name', async () => {
		const result = await nodeUpdateCommand.handler(
			{ id: 'xbox', updates: { name: 'Xbox Gaming' } },
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.node.name).toBe('Xbox Gaming');
		expect(result.data?.changedFields).toContain('name');
	});

	it('updates node status', async () => {
		const result = await nodeUpdateCommand.handler(
			{ id: 'xbox', updates: { status: 'deprecated' } },
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.node.status).toBe('deprecated');
		expect(result.data?.changedFields).toContain('status');
	});

	it('updates node tags', async () => {
		const result = await nodeUpdateCommand.handler(
			{ id: 'xbox', updates: { tags: ['gaming', 'console'] } },
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.node.tags).toEqual(['gaming', 'console']);
		expect(result.data?.changedFields).toContain('tags');
	});

	it('updates node includes', async () => {
		const result = await nodeUpdateCommand.handler(
			{ id: 'xbox', updates: { includes: ['shared-accessibility'] } },
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.node.includes).toContain('shared-accessibility');
		expect(result.data?.changedFields).toContain('includes');
	});

	it('tracks all changed fields', async () => {
		const result = await nodeUpdateCommand.handler(
			{
				id: 'xbox',
				updates: {
					name: 'Xbox Updated',
					status: 'experimental',
					tags: ['test'],
				},
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.changedFields).toContain('name');
		expect(result.data?.changedFields).toContain('status');
		expect(result.data?.changedFields).toContain('tags');
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// ERROR CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('fails if node does not exist', async () => {
		const result = await nodeUpdateCommand.handler(
			{ id: 'nonexistent', updates: { name: 'Test' } },
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
	});

	it('fails if include node does not exist', async () => {
		const result = await nodeUpdateCommand.handler(
			{ id: 'xbox', updates: { includes: ['nonexistent'] } },
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
	});

	it('fails if node tries to include itself', async () => {
		const result = await nodeUpdateCommand.handler(
			{ id: 'xbox', updates: { includes: ['xbox'] } },
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('CIRCULAR_REFERENCE');
	});

	it('fails if a parent tries to include its own descendant (parent edge cycle)', async () => {
		// xbox's parent is global-base; including xbox from global-base closes the loop
		const result = await nodeUpdateCommand.handler(
			{ id: 'global-base', updates: { includes: ['xbox'] } },
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('CIRCULAR_REFERENCE');

		const stored = await db.getNode('global-base');
		expect(stored?.includes ?? []).toEqual([]);
	});

	it('fails if an include is a deeper descendant of the node', async () => {
		await nodeCreateCommand.handler(
			{ name: 'xbox-ios', type: 'platform', parentId: 'xbox' },
			context,
		);

		const result = await nodeUpdateCommand.handler(
			{ id: 'global-base', updates: { includes: ['xbox-ios'] } },
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('CIRCULAR_REFERENCE');
	});

	it('fails if an include reaches the node through include and parent edges', async () => {
		// shared-accessibility includes xbox (child of global-base)
		await nodeUpdateCommand.handler(
			{ id: 'shared-accessibility', updates: { includes: ['xbox'] } },
			context,
		);

		// global-base including shared-accessibility -> xbox -> parent global-base
		const result = await nodeUpdateCommand.handler(
			{ id: 'global-base', updates: { includes: ['shared-accessibility'] } },
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('CIRCULAR_REFERENCE');
	});

	it('still allows including an ancestor or an unrelated node', async () => {
		const ancestor = await nodeUpdateCommand.handler(
			{ id: 'xbox', updates: { includes: ['global-base'] } },
			context,
		);
		expect(ancestor.success).toBe(true);

		const unrelated = await nodeUpdateCommand.handler(
			{ id: 'xbox', updates: { includes: ['shared-accessibility'] } },
			context,
		);
		expect(unrelated.success).toBe(true);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// PERSISTENCE TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	it('persists changes to database', async () => {
		await nodeUpdateCommand.handler({ id: 'xbox', updates: { name: 'Xbox Persisted' } }, context);

		const getResult = await nodeGetCommand.handler({ id: 'xbox', includeAncestry: false }, context);

		expect(getResult.success).toBe(true);
		expect(getResult.data?.node.name).toBe('Xbox Persisted');
	});
});
