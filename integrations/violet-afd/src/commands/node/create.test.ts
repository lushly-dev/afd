import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../registry.js';
import { nodeCreateCommand } from './create.js';

describe('node.create command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(() => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };
	});

	it('should create a root node', async () => {
		const result = await nodeCreateCommand.handler(
			{
				name: 'global-base',
				type: 'root',
				parentId: null,
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.node.name).toBe('global-base');
		expect(result.data?.node.type).toBe('root');
		expect(result.data?.node.parentId).toBeNull();
	});

	it('should create a child node', async () => {
		// First create parent
		await nodeCreateCommand.handler({ name: 'global-base', type: 'root', parentId: null }, context);

		// Then create child
		const result = await nodeCreateCommand.handler(
			{
				name: 'xbox',
				type: 'product',
				parentId: 'global-base',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.node.parentId).toBe('global-base');
	});

	it('should fail if parent does not exist', async () => {
		const result = await nodeCreateCommand.handler(
			{
				name: 'orphan',
				type: 'product',
				parentId: 'nonexistent',
			},
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('INVALID_PARENT');
	});

	it('should fail if node already exists', async () => {
		await nodeCreateCommand.handler({ name: 'global-base', type: 'root', parentId: null }, context);

		const result = await nodeCreateCommand.handler(
			{ name: 'global-base', type: 'root', parentId: null },
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NODE_ALREADY_EXISTS');
	});

	it('should generate ID from name', async () => {
		const result = await nodeCreateCommand.handler(
			{
				name: 'My Cool Product',
				type: 'product',
				parentId: null,
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.node.id).toBe('my-cool-product');
	});

	it('should use provided ID', async () => {
		const result = await nodeCreateCommand.handler(
			{
				id: 'custom-id',
				name: 'My Product',
				type: 'product',
				parentId: null,
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.node.id).toBe('custom-id');
	});

	it('should support includes', async () => {
		// Create include targets first
		await nodeCreateCommand.handler(
			{ name: 'accessibility', type: 'shared', parentId: null },
			context,
		);

		const result = await nodeCreateCommand.handler(
			{
				name: 'my-app',
				type: 'product',
				parentId: null,
				includes: ['accessibility'],
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.node.includes).toContain('accessibility');
	});

	it('should fail if include does not exist', async () => {
		const result = await nodeCreateCommand.handler(
			{
				name: 'my-app',
				type: 'product',
				parentId: null,
				includes: ['nonexistent'],
			},
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
	});
});
