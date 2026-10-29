/**
 * @fileoverview Unit tests for node.delete command
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../registry.js';
import { nodeCreateCommand } from './create.js';
import { nodeDeleteCommand } from './delete.js';
import { nodeListCommand } from './list.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

describe('node.delete command', () => {
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
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// SUCCESS CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('soft deletes a node without children', async () => {
		const result = await nodeDeleteCommand.handler(
			{ id: 'xbox-ios', reason: 'No longer needed' },
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.id).toBe('xbox-ios');
		expect(result.data?.deletedAt).toBeDefined();
	});

	it('excludes deleted nodes from list by default', async () => {
		await nodeDeleteCommand.handler({ id: 'xbox-ios', reason: 'Test' }, context);

		const listResult = await nodeListCommand.handler({}, context);

		expect(listResult.success).toBe(true);
		expect(listResult.data?.nodes?.find((n) => n.id === 'xbox-ios')).toBeUndefined();
	});

	it('includes deleted nodes when requested', async () => {
		await nodeDeleteCommand.handler({ id: 'xbox-ios', reason: 'Test' }, context);

		const listResult = await nodeListCommand.handler({ includeDeleted: true }, context);

		expect(listResult.success).toBe(true);
		expect(listResult.data?.nodes?.find((n) => n.id === 'xbox-ios')).toBeDefined();
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// ERROR CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('fails if node does not exist', async () => {
		const result = await nodeDeleteCommand.handler({ id: 'nonexistent', reason: 'Test' }, context);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
	});

	it('fails if node has children', async () => {
		const result = await nodeDeleteCommand.handler({ id: 'xbox', reason: 'Test' }, context);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NODE_HAS_CHILDREN');
	});

	it('cascade deletes with force flag', async () => {
		const result = await nodeDeleteCommand.handler(
			{ id: 'xbox', force: true, reason: 'Cascade delete' },
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.cascade).toBe(true);
		expect(result.data?.affectedNodes).toContain('xbox');
		expect(result.data?.affectedNodes).toContain('xbox-ios');
	});

	it('fails if node is already deleted', async () => {
		await nodeDeleteCommand.handler({ id: 'xbox-ios', reason: 'First delete' }, context);

		const result = await nodeDeleteCommand.handler(
			{ id: 'xbox-ios', reason: 'Second delete' },
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// REASONING & WARNINGS TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	it('includes reasoning in response', async () => {
		const result = await nodeDeleteCommand.handler({ id: 'xbox-ios', reason: 'Test' }, context);

		expect(result.success).toBe(true);
		expect(result.reasoning).toBeDefined();
	});
});
