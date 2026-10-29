/**
 * @fileoverview Unit tests for token.lineage command
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import { nodeUpdateCommand } from '../node/update.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokenCopyCommand } from './copy.js';
import { tokenLineageCommand } from './lineage.js';
import { tokenOverrideCommand } from './override.js';
import { tokenResetCommand } from './reset.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

describe('token.lineage command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// Set up test hierarchy: global-base → xbox → xbox-ios
		await nodeCreateCommand.handler({ name: 'global-base', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler(
			{ name: 'xbox', type: 'product', parentId: 'global-base' },
			context,
		);
		await nodeCreateCommand.handler(
			{ name: 'xbox-ios', type: 'platform', parentId: 'xbox' },
			context,
		);

		// Add token at root
		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.accent.primary',
				value: '#0066CC',
			},
			context,
		);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// SUCCESS CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('returns lineage for a token', async () => {
		const result = await tokenLineageCommand.handler(
			{
				nodeId: 'xbox-ios',
				tokenId: 'color.accent.primary',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.tokenId).toBe('color.accent.primary');
		expect(result.data?.currentValue).toBe('#0066CC');
		expect(result.data?.chain).toBeDefined();
	});

	it('shows add operation in chain', async () => {
		const result = await tokenLineageCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.accent.primary',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.chain).toBeDefined();
		// Chain should include at least the origin add operation
		const hasAddOp = result.data?.chain.some((c) => c.operation === 'add');
		expect(hasAddOp).toBe(true);
	});

	it('shows override operation in chain', async () => {
		// Override at xbox level
		await tokenOverrideCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'color.accent.primary',
				value: '#107C10',
			},
			context,
		);

		const result = await tokenLineageCommand.handler(
			{
				nodeId: 'xbox-ios',
				tokenId: 'color.accent.primary',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.currentValue).toBe('#107C10');
		// Chain should include override
		const hasOverride = result.data?.chain.some((c) => c.operation === 'override');
		expect(hasOverride).toBe(true);
	});

	it('traces through multiple levels', async () => {
		const result = await tokenLineageCommand.handler(
			{
				nodeId: 'xbox-ios',
				tokenId: 'color.accent.primary',
			},
			context,
		);

		expect(result.success).toBe(true);
		// Chain should have entries showing inheritance path
		expect(result.data?.chain.length).toBeGreaterThanOrEqual(1);
	});

	it('names the copy source and its owner, and follows later changes there', async () => {
		await nodeCreateCommand.handler(
			{ name: 'vscode', type: 'product', parentId: 'global-base', owner: 'vscode-design' },
			context,
		);
		await tokenOverrideCommand.handler(
			{ nodeId: 'vscode', tokenId: 'color.accent.primary', value: '#007ACC' },
			context,
		);
		// Customized, then replaced by a copy from vscode on the same node
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.accent.primary', value: '#107C10' },
			context,
		);
		await tokenCopyCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.accent.primary', fromNode: 'vscode' },
			context,
		);

		const trace = async () => {
			const result = await tokenLineageCommand.handler(
				{ nodeId: 'xbox-ios', tokenId: 'color.accent.primary' },
				context,
			);
			expect(result.success).toBe(true);
			return result.data;
		};

		const data = await trace();
		expect(data?.chain.filter((step) => step.nodeId === 'xbox')).toEqual([
			{ nodeId: 'xbox', operation: 'override', value: '#107C10', superseded: true },
			{
				nodeId: 'xbox',
				operation: 'copy',
				value: '#007ACC',
				fromNode: 'vscode',
				fromOwner: 'vscode-design',
				tracksSource: true,
			},
		]);
		expect(data?.chain.at(-1)).toEqual({ nodeId: 'xbox-ios', operation: 'inherit' });

		// A later change at the source shows up on the copier
		await tokenOverrideCommand.handler(
			{ nodeId: 'vscode', tokenId: 'color.accent.primary', value: '#3794FF' },
			context,
		);
		expect((await trace())?.currentValue).toBe('#3794FF');
	});

	it('names the renamed source token of a copy', async () => {
		await tokenCopyCommand.handler(
			{
				nodeId: 'xbox',
				tokenId: 'color.accent.primary',
				fromNode: 'global-base',
				asTokenId: 'color.ring',
			},
			context,
		);
		const result = await tokenLineageCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.ring' },
			context,
		);
		expect(result.data?.chain).toEqual([
			{
				nodeId: 'xbox',
				operation: 'copy',
				value: '#0066CC',
				fromNode: 'global-base',
				fromToken: 'color.accent.primary',
				tracksSource: true,
			},
		]);
	});

	it('names the node a reset goes back to, and the shared set an include comes from', async () => {
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.accent.primary', value: '#107C10' },
			context,
		);
		await tokenResetCommand.handler(
			{ nodeId: 'xbox-ios', tokenId: 'color.accent.primary', toAncestor: 'global-base' },
			context,
		);
		const reset = await tokenLineageCommand.handler(
			{ nodeId: 'xbox-ios', tokenId: 'color.accent.primary' },
			context,
		);
		expect(reset.data?.chain.at(-1)).toEqual({
			nodeId: 'xbox-ios',
			operation: 'reset',
			value: '#0066CC',
			fromNode: 'global-base',
			tracksSource: true,
		});

		await nodeCreateCommand.handler(
			{ name: 'a11y', type: 'shared', parentId: null, owner: 'accessibility' },
			context,
		);
		await tokenAddCommand.handler(
			{ nodeId: 'a11y', tokenId: 'focus.ring.width', value: '3px' },
			context,
		);
		await nodeUpdateCommand.handler({ id: 'xbox', updates: { includes: ['a11y'] } }, context);
		const include = await tokenLineageCommand.handler(
			{ nodeId: 'xbox', tokenId: 'focus.ring.width' },
			context,
		);
		expect(include.data?.chain).toEqual([
			{
				nodeId: 'xbox',
				operation: 'include',
				value: '3px',
				fromNode: 'a11y',
				fromOwner: 'accessibility',
				tracksSource: true,
			},
		]);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// ERROR CASES
	// ═══════════════════════════════════════════════════════════════════════════

	it('fails if node does not exist', async () => {
		const result = await tokenLineageCommand.handler(
			{
				nodeId: 'nonexistent',
				tokenId: 'color.accent.primary',
			},
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
	});

	it('fails if token is not found on node', async () => {
		const result = await tokenLineageCommand.handler(
			{
				nodeId: 'xbox-ios',
				tokenId: 'nonexistent.token',
			},
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('TOKEN_NOT_FOUND');
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// REASONING TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	it('includes reasoning in response', async () => {
		const result = await tokenLineageCommand.handler(
			{
				nodeId: 'xbox-ios',
				tokenId: 'color.accent.primary',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.reasoning).toBeDefined();
	});
});
