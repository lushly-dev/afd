/**
 * @fileoverview Unit tests for token.copy command
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokenCopyCommand } from './copy.js';
import { tokensResolveCommand } from './resolve.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

describe('token.copy command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// Set up test hierarchy with two products
		await nodeCreateCommand.handler({ name: 'global-base', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler(
			{ name: 'vscode', type: 'product', parentId: 'global-base' },
			context,
		);
		await nodeCreateCommand.handler(
			{ name: 'azure', type: 'product', parentId: 'global-base' },
			context,
		);

		// Add a unique token to vscode
		await tokenAddCommand.handler(
			{
				nodeId: 'vscode',
				tokenId: 'color.accent.primary',
				value: '#007ACC',
			},
			context,
		);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// SUCCESS CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('copies a token from another node', async () => {
		const result = await tokenCopyCommand.handler(
			{
				nodeId: 'azure',
				tokenId: 'color.accent.primary',
				fromNode: 'vscode',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.nodeId).toBe('azure');
		expect(result.data?.tokenId).toBe('color.accent.primary');
		expect(result.data?.fromNode).toBe('vscode');
		expect(result.data?.operationId).toBeDefined();
	});

	it('copied token has the source value', async () => {
		await tokenCopyCommand.handler(
			{
				nodeId: 'azure',
				tokenId: 'color.accent.primary',
				fromNode: 'vscode',
			},
			context,
		);

		const resolveResult = await tokensResolveCommand.handler({ nodeId: 'azure' }, context);

		expect(resolveResult.success).toBe(true);
		const token = resolveResult.data?.tokens.find((t) => t.id === 'color.accent.primary');
		expect(token?.value).toBe('#007ACC');
	});

	it('copies with a different token name', async () => {
		const result = await tokenCopyCommand.handler(
			{
				nodeId: 'azure',
				tokenId: 'color.accent.primary',
				fromNode: 'vscode',
				asTokenId: 'color.azure.primary',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.tokenId).toBe('color.azure.primary');
		expect(result.data?.fromTokenId).toBe('color.accent.primary');

		// The renamed copy must resolve to the source token's value
		const resolveResult = await tokensResolveCommand.handler({ nodeId: 'azure' }, context);
		expect(resolveResult.success).toBe(true);
		const renamed = resolveResult.data?.tokens.find((t) => t.id === 'color.azure.primary');
		expect(renamed?.value).toBe('#007ACC');
		// The source id is not created on the target under its old name
		expect(resolveResult.data?.tokens.find((t) => t.id === 'color.accent.primary')?.value).not.toBe(
			'#007ACC',
		);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// ERROR CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('fails if target node does not exist', async () => {
		const result = await tokenCopyCommand.handler(
			{
				nodeId: 'nonexistent',
				tokenId: 'color.accent.primary',
				fromNode: 'vscode',
			},
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
	});

	it('fails if source node does not exist', async () => {
		const result = await tokenCopyCommand.handler(
			{
				nodeId: 'azure',
				tokenId: 'color.accent.primary',
				fromNode: 'nonexistent',
			},
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
	});

	it('rejects reserved path segments in the target token id', async () => {
		const result = await tokenCopyCommand.handler(
			{
				nodeId: 'azure',
				tokenId: 'color.accent.primary',
				fromNode: 'vscode',
				asTokenId: '__proto__.polluted',
			},
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(await db.getOperations('azure')).toHaveLength(0);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// CYCLE PREVENTION
	// ═══════════════════════════════════════════════════════════════════════════

	describe('cycle prevention', () => {
		it('rejects copying from the same node, even under a different token id', async () => {
			const result = await tokenCopyCommand.handler(
				{
					nodeId: 'vscode',
					tokenId: 'color.accent.primary',
					fromNode: 'vscode',
					asTokenId: 'color.accent.secondary',
				},
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('VALIDATION_ERROR');

			// Nothing was stored, so resolving the node still works
			const resolved = await tokensResolveCommand.handler({ nodeId: 'vscode' }, context);
			expect(resolved.success).toBe(true);
			expect(resolved.data?.tokens.map((t) => t.id)).toEqual(['color.accent.primary']);
		});

		it('rejects mutual copies (A <- B, then B <- A)', async () => {
			await tokenAddCommand.handler(
				{ nodeId: 'azure', tokenId: 'color.azure.primary', value: '#0078D4' },
				context,
			);

			const first = await tokenCopyCommand.handler(
				{ nodeId: 'azure', tokenId: 'color.accent.primary', fromNode: 'vscode' },
				context,
			);
			expect(first.success).toBe(true);

			const second = await tokenCopyCommand.handler(
				{ nodeId: 'vscode', tokenId: 'color.azure.primary', fromNode: 'azure' },
				context,
			);
			expect(second.success).toBe(false);
			expect(second.error?.code).toBe('CIRCULAR_REFERENCE');

			const resolved = await tokensResolveCommand.handler({ nodeId: 'azure' }, context);
			expect(resolved.success).toBe(true);
		});

		it('rejects copying from a descendant of the target node', async () => {
			await nodeCreateCommand.handler(
				{ name: 'vscode-web', type: 'platform', parentId: 'vscode' },
				context,
			);

			// vscode-web inherits from vscode, so vscode copying from vscode-web is a cycle
			const result = await tokenCopyCommand.handler(
				{
					nodeId: 'vscode',
					tokenId: 'color.accent.primary',
					fromNode: 'vscode-web',
					asTokenId: 'color.x',
				},
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('CIRCULAR_REFERENCE');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// REASONING TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	it('includes reasoning in response', async () => {
		const result = await tokenCopyCommand.handler(
			{
				nodeId: 'azure',
				tokenId: 'color.accent.primary',
				fromNode: 'vscode',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.reasoning).toBeDefined();
	});
});
