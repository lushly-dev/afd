import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import { nodeUpdateCommand } from '../node/update.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokenOverrideCommand } from './override.js';
import { tokensResolveCommand } from './resolve.js';

/**
 * Tests for token composition via includes (mixins)
 *
 * Phase 1.3: Composition & Tags
 *
 * The includes system allows nodes to inherit tokens from other nodes
 * that are NOT in their ancestry chain. This enables:
 * - Shared accessibility presets
 * - Platform-specific defaults
 * - Theme mixins
 */
describe('token composition (includes/mixins)', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// Set up base hierarchy
		await nodeCreateCommand.handler({ name: 'global-base', type: 'root', parentId: null }, context);

		// Add base tokens
		await tokenAddCommand.handler(
			{
				nodeId: 'global-base',
				tokenId: 'color.brand.primary',
				value: '#0078D4',
			},
			context,
		);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// BASIC INCLUDES TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	describe('basic includes', () => {
		it('should resolve tokens from included node', async () => {
			// Create a shared accessibility node (not in hierarchy)
			await nodeCreateCommand.handler(
				{ name: 'shared-a11y', type: 'shared', parentId: null },
				context,
			);
			await tokenAddCommand.handler(
				{
					nodeId: 'shared-a11y',
					tokenId: 'motion.reduce.enabled',
					value: 'true',
				},
				context,
			);

			// Create product node that includes the shared node
			await nodeCreateCommand.handler(
				{
					name: 'xbox',
					type: 'product',
					parentId: 'global-base',
					includes: ['shared-a11y'],
				},
				context,
			);

			// Resolve tokens for xbox
			const result = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);

			expect(result.success).toBe(true);
			// Should have inherited brand color + included motion token
			expect(result.data?.tokens).toHaveLength(2);
			expect(result.data?.tokens.find((t) => t.id === 'motion.reduce.enabled')).toBeDefined();
			expect(result.data?.tokens.find((t) => t.id === 'color.brand.primary')).toBeDefined();
		});

		it('should resolve tokens from multiple includes in order', async () => {
			// Create two shared nodes
			await nodeCreateCommand.handler(
				{ name: 'shared-motion', type: 'shared', parentId: null },
				context,
			);
			await tokenAddCommand.handler(
				{
					nodeId: 'shared-motion',
					tokenId: 'motion.duration.fast',
					value: '100ms',
				},
				context,
			);

			await nodeCreateCommand.handler(
				{ name: 'shared-sizing', type: 'shared', parentId: null },
				context,
			);
			await tokenAddCommand.handler(
				{
					nodeId: 'shared-sizing',
					tokenId: 'sizing.icon.small',
					value: '16px',
				},
				context,
			);

			// Create node with multiple includes
			await nodeCreateCommand.handler(
				{
					name: 'xbox',
					type: 'product',
					parentId: 'global-base',
					includes: ['shared-motion', 'shared-sizing'],
				},
				context,
			);

			const result = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);

			expect(result.success).toBe(true);
			// Base (1) + motion (1) + sizing (1) = 3 tokens
			expect(result.data?.tokens).toHaveLength(3);
		});

		it('should cascade includes to descendants', async () => {
			// Create shared node
			await nodeCreateCommand.handler(
				{ name: 'shared-a11y', type: 'shared', parentId: null },
				context,
			);
			await tokenAddCommand.handler(
				{ nodeId: 'shared-a11y', tokenId: 'focus.outline.width', value: '2px' },
				context,
			);

			// Parent includes the shared node
			await nodeCreateCommand.handler(
				{
					name: 'xbox',
					type: 'product',
					parentId: 'global-base',
					includes: ['shared-a11y'],
				},
				context,
			);

			// Child doesn't directly include anything
			await nodeCreateCommand.handler(
				{ name: 'xbox-ios', type: 'platform', parentId: 'xbox' },
				context,
			);

			// Child should still get the included tokens
			const result = await tokensResolveCommand.handler({ nodeId: 'xbox-ios' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.tokens.find((t) => t.id === 'focus.outline.width')).toBeDefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// INCLUDE POLICY TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	describe('include policy', () => {
		it('should merge tokens by default (policy: merge)', async () => {
			// Create shared node with conflicting token
			await nodeCreateCommand.handler(
				{ name: 'shared-theme', type: 'shared', parentId: null },
				context,
			);
			await tokenAddCommand.handler(
				{
					nodeId: 'shared-theme',
					tokenId: 'color.brand.primary',
					value: '#FF0000',
				},
				context,
			);

			// Create node with merge policy (default) that includes shared
			await nodeCreateCommand.handler(
				{
					name: 'xbox',
					type: 'product',
					parentId: 'global-base',
					includes: ['shared-theme'],
					includePolicy: 'merge',
				},
				context,
			);

			const result = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);

			expect(result.success).toBe(true);
			// Merge policy: inherited value wins over included
			// global-base sets color.brand.primary = #0078D4
			// shared-theme also has it but should NOT override
			expect(result.data?.tokens.find((t) => t.id === 'color.brand.primary')?.value).toBe(
				'#0078D4',
			);
		});

		it('should override with included tokens (policy: override)', async () => {
			// Create shared node with conflicting token
			await nodeCreateCommand.handler(
				{ name: 'shared-theme', type: 'shared', parentId: null },
				context,
			);
			await tokenAddCommand.handler(
				{
					nodeId: 'shared-theme',
					tokenId: 'color.brand.primary',
					value: '#FF0000',
				},
				context,
			);

			// Create node with override policy
			await nodeCreateCommand.handler(
				{
					name: 'xbox',
					type: 'product',
					parentId: 'global-base',
					includes: ['shared-theme'],
					includePolicy: 'override',
				},
				context,
			);

			const result = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);

			expect(result.success).toBe(true);
			// Override policy: included value wins
			expect(result.data?.tokens.find((t) => t.id === 'color.brand.primary')?.value).toBe(
				'#FF0000',
			);
		});

		it('should allow local operations to override included tokens', async () => {
			// Create shared node
			await nodeCreateCommand.handler(
				{ name: 'shared-colors', type: 'shared', parentId: null },
				context,
			);
			await tokenAddCommand.handler(
				{ nodeId: 'shared-colors', tokenId: 'color.accent', value: '#00FF00' },
				context,
			);

			// Create node that includes shared and then overrides
			await nodeCreateCommand.handler(
				{
					name: 'xbox',
					type: 'product',
					parentId: 'global-base',
					includes: ['shared-colors'],
				},
				context,
			);
			await tokenOverrideCommand.handler(
				{ nodeId: 'xbox', tokenId: 'color.accent', value: '#107C10' },
				context,
			);

			const result = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);

			expect(result.success).toBe(true);
			// Local override should win over included
			expect(result.data?.tokens.find((t) => t.id === 'color.accent')?.value).toBe('#107C10');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// INCLUDE ORDER TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	describe('include order', () => {
		it('later includes should override earlier includes (with override policy)', async () => {
			// Create two shared nodes with same token
			await nodeCreateCommand.handler(
				{ name: 'theme-light', type: 'shared', parentId: null },
				context,
			);
			await tokenAddCommand.handler(
				{
					nodeId: 'theme-light',
					tokenId: 'color.background',
					value: '#FFFFFF',
				},
				context,
			);

			await nodeCreateCommand.handler(
				{ name: 'theme-dark', type: 'shared', parentId: null },
				context,
			);
			await tokenAddCommand.handler(
				{ nodeId: 'theme-dark', tokenId: 'color.background', value: '#1E1E1E' },
				context,
			);

			// Include light first, then dark (dark wins with override)
			await nodeCreateCommand.handler(
				{
					name: 'xbox',
					type: 'product',
					parentId: 'global-base',
					includes: ['theme-light', 'theme-dark'],
					includePolicy: 'override',
				},
				context,
			);

			const result = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);

			expect(result.success).toBe(true);
			// Last include wins
			expect(result.data?.tokens.find((t) => t.id === 'color.background')?.value).toBe('#1E1E1E');
		});

		it('should respect order: ancestry -> includes -> local', async () => {
			// Create shared node
			await nodeCreateCommand.handler(
				{ name: 'shared-brand', type: 'shared', parentId: null },
				context,
			);
			// shared has different value for same token
			await tokenAddCommand.handler(
				{
					nodeId: 'shared-brand',
					tokenId: 'color.brand.primary',
					value: '#shared',
				},
				context,
			);

			// Create node with includes
			await nodeCreateCommand.handler(
				{
					name: 'xbox',
					type: 'product',
					parentId: 'global-base',
					includes: ['shared-brand'],
				},
				context,
			);

			// Add local override
			await tokenOverrideCommand.handler(
				{ nodeId: 'xbox', tokenId: 'color.brand.primary', value: '#local' },
				context,
			);

			const result = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);

			expect(result.success).toBe(true);
			// Order: global-base (#0078D4) -> shared-brand (#shared, merge=skip) -> local (#local)
			// Local wins
			expect(result.data?.tokens.find((t) => t.id === 'color.brand.primary')?.value).toBe('#local');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// UPDATE INCLUDES TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	describe('dynamic includes updates', () => {
		it('should reflect updated includes in resolution', async () => {
			// Create shared node
			await nodeCreateCommand.handler(
				{ name: 'shared-a11y', type: 'shared', parentId: null },
				context,
			);
			await tokenAddCommand.handler(
				{
					nodeId: 'shared-a11y',
					tokenId: 'motion.reduce.enabled',
					value: 'true',
				},
				context,
			);

			// Create node without includes
			await nodeCreateCommand.handler(
				{ name: 'xbox', type: 'product', parentId: 'global-base' },
				context,
			);

			// Initial resolve - no motion token
			let result = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);
			expect(result.data?.tokens.find((t) => t.id === 'motion.reduce.enabled')).toBeUndefined();

			// Update to include shared node
			await nodeUpdateCommand.handler(
				{ id: 'xbox', updates: { includes: ['shared-a11y'] } },
				context,
			);

			// Now resolve should include motion token
			result = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);
			expect(result.data?.tokens.find((t) => t.id === 'motion.reduce.enabled')).toBeDefined();
		});

		it('should handle removing includes', async () => {
			// Create shared and include it
			await nodeCreateCommand.handler(
				{ name: 'shared-a11y', type: 'shared', parentId: null },
				context,
			);
			await tokenAddCommand.handler(
				{
					nodeId: 'shared-a11y',
					tokenId: 'motion.reduce.enabled',
					value: 'true',
				},
				context,
			);
			await nodeCreateCommand.handler(
				{
					name: 'xbox',
					type: 'product',
					parentId: 'global-base',
					includes: ['shared-a11y'],
				},
				context,
			);

			// Has motion token initially
			let result = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);
			expect(result.data?.tokens.find((t) => t.id === 'motion.reduce.enabled')).toBeDefined();

			// Remove the include
			await nodeUpdateCommand.handler({ id: 'xbox', updates: { includes: [] } }, context);

			// Motion token should be gone
			result = await tokensResolveCommand.handler({ nodeId: 'xbox' }, context);
			expect(result.data?.tokens.find((t) => t.id === 'motion.reduce.enabled')).toBeUndefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// LINEAGE WITH INCLUDES TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	describe('lineage with includes', () => {
		it('should track include operations in lineage', async () => {
			// Create shared node
			await nodeCreateCommand.handler(
				{ name: 'shared-sizing', type: 'shared', parentId: null },
				context,
			);
			await tokenAddCommand.handler(
				{ nodeId: 'shared-sizing', tokenId: 'sizing.base', value: '8px' },
				context,
			);

			// Include it
			await nodeCreateCommand.handler(
				{
					name: 'xbox',
					type: 'product',
					parentId: 'global-base',
					includes: ['shared-sizing'],
				},
				context,
			);

			const result = await tokensResolveCommand.handler(
				{ nodeId: 'xbox', includeLineage: true },
				context,
			);

			expect(result.success).toBe(true);
			const sizingToken = result.data?.tokens.find((t) => t.id === 'sizing.base');
			expect(sizingToken?.operationHistory).toBeDefined();
			// Should show include operation
			const includeOp = sizingToken?.operationHistory?.find((h) => h.operation === 'include');
			expect(includeOp).toBeDefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// CIRCULAR INCLUDES TESTS
	// ═══════════════════════════════════════════════════════════════════════════

	describe('circular includes prevention', () => {
		it('should prevent node from including itself', async () => {
			// Create a node
			await nodeCreateCommand.handler(
				{ name: 'xbox', type: 'product', parentId: 'global-base' },
				context,
			);

			// Try to make it include itself
			const result = await nodeUpdateCommand.handler(
				{ id: 'xbox', updates: { includes: ['xbox'] } },
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('CIRCULAR_REFERENCE');
		});

		it('should prevent direct circular includes (A includes B, B includes A)', async () => {
			// Create two nodes
			await nodeCreateCommand.handler({ name: 'node-a', type: 'shared', parentId: null }, context);
			await nodeCreateCommand.handler({ name: 'node-b', type: 'shared', parentId: null }, context);

			// A includes B
			await nodeUpdateCommand.handler({ id: 'node-a', updates: { includes: ['node-b'] } }, context);

			// B tries to include A - should fail
			const result = await nodeUpdateCommand.handler(
				{ id: 'node-b', updates: { includes: ['node-a'] } },
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('CIRCULAR_REFERENCE');
		});

		it('should prevent indirect circular includes (A->B->C->A)', async () => {
			// Create three nodes
			await nodeCreateCommand.handler({ name: 'node-a', type: 'shared', parentId: null }, context);
			await nodeCreateCommand.handler({ name: 'node-b', type: 'shared', parentId: null }, context);
			await nodeCreateCommand.handler({ name: 'node-c', type: 'shared', parentId: null }, context);

			// A includes B
			await nodeUpdateCommand.handler({ id: 'node-a', updates: { includes: ['node-b'] } }, context);

			// B includes C
			await nodeUpdateCommand.handler({ id: 'node-b', updates: { includes: ['node-c'] } }, context);

			// C tries to include A - should fail
			const result = await nodeUpdateCommand.handler(
				{ id: 'node-c', updates: { includes: ['node-a'] } },
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('CIRCULAR_REFERENCE');
		});

		it('should handle resolution without infinite loops (defensive)', async () => {
			// Even if circular detection is bypassed somehow, resolution shouldn't hang
			// This tests the resolve function's robustness

			// Create shared nodes with tokens
			await nodeCreateCommand.handler(
				{ name: 'shared-a', type: 'shared', parentId: null },
				context,
			);
			await tokenAddCommand.handler(
				{ nodeId: 'shared-a', tokenId: 'token.from.a', value: 'value-a' },
				context,
			);

			await nodeCreateCommand.handler(
				{ name: 'shared-b', type: 'shared', parentId: null },
				context,
			);
			await tokenAddCommand.handler(
				{ nodeId: 'shared-b', tokenId: 'token.from.b', value: 'value-b' },
				context,
			);

			// Set up includes (non-circular)
			await nodeUpdateCommand.handler(
				{ id: 'shared-a', updates: { includes: ['shared-b'] } },
				context,
			);

			// Create node that includes shared-a
			await nodeCreateCommand.handler(
				{
					name: 'consumer',
					type: 'product',
					parentId: 'global-base',
					includes: ['shared-a'],
				},
				context,
			);

			// Should resolve successfully with tokens from entire include chain
			const result = await tokensResolveCommand.handler({ nodeId: 'consumer' }, context);

			expect(result.success).toBe(true);
			// Should have: brand.primary (from global-base) + token.from.a + token.from.b
			expect(result.data?.tokens.find((t) => t.id === 'token.from.a')).toBeDefined();
			expect(result.data?.tokens.find((t) => t.id === 'token.from.b')).toBeDefined();
		});
	});
});
