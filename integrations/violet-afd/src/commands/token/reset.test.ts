/**
 * @fileoverview Unit tests for token.reset command
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokenOverrideCommand } from './override.js';
import { tokenResetCommand } from './reset.js';
import { tokensResolveCommand } from './resolve.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

describe('token.reset command', () => {
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

		// Add base token and override it
		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.primary',
				value: '#0066CC',
			},
			context,
		);
		await tokenOverrideCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'color.primary',
				value: '#107C10',
			},
			context,
		);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// SUCCESS CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('resets a token to parent value', async () => {
		const result = await tokenResetCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'color.primary',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.nodeId).toBe('xbox');
		expect(result.data?.tokenId).toBe('color.primary');
		expect(result.data?.operationId).toBeDefined();
	});

	it('resets to specific ancestor', async () => {
		await tokenOverrideCommand.handler(
			{
				nodeId: 'xbox-ios',
				tokenId: 'color.primary',
				value: '#FF5500',
			},
			context,
		);

		const result = await tokenResetCommand.handler(
			{
				nodeId: 'xbox-ios',
				tokenId: 'color.primary',
				toAncestor: 'global-base',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.toAncestor).toBe('global-base');
	});

	it('reset affects resolved token', async () => {
		await tokenResetCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'color.primary',
			},
			context,
		);

		const resolveResult = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);

		expect(resolveResult.success).toBe(true);
		const token = resolveResult.data?.tokens.find((t) => t.id === 'color.primary');
		// After reset, should inherit from parent (global-base)
		expect(token?.value).toBe('#0066CC');
		expect(token?.resolvedAt).toBe('global-base');
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// ERROR CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('fails if node does not exist', async () => {
		const result = await tokenResetCommand.handler(
			{
				nodeId: 'nonexistent',
				tokenId: 'color.primary',
			},
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
	});

	it('fails if toAncestor is not an ancestor', async () => {
		const result = await tokenResetCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'color.primary',
				toAncestor: 'xbox-ios',
			},
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('INVALID_PARENT');
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// REASONING TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	it('includes reasoning in response', async () => {
		const result = await tokenResetCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'color.primary',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.reasoning).toBeDefined();
	});
});
