/**
 * @fileoverview Unit tests for import commands
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { tokensResolveCommand } from '../token/resolve.js';
import { importJsonCommand } from './json.js';
import { importValidateCommand } from './validate.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST DATA
// ═══════════════════════════════════════════════════════════════════════════════

const validStyleDictionaryJson = JSON.stringify({
	color: {
		brand: {
			primary: { value: '#0078D4' },
			secondary: { value: '#00A4EF' },
		},
	},
	spacing: {
		small: { value: '8px' },
		medium: { value: '16px' },
	},
});

const invalidJson = '{ invalid json }';

const missingValueJson = JSON.stringify({
	color: {
		brand: {
			primary: '#0078D4', // Missing { value: ... } wrapper
		},
	},
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

describe('import commands', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// Create a test node
		await nodeCreateCommand.handler({ name: 'test-root', type: 'root', parentId: null }, context);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// IMPORT.VALIDATE
	// ═══════════════════════════════════════════════════════════════════════════

	describe('import.validate command', () => {
		it('validates a valid Style Dictionary JSON', async () => {
			const result = await importValidateCommand.handler(
				{ content: validStyleDictionaryJson, targetNode: 'test-root' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.valid).toBe(true);
			expect(result.data?.tokenCount).toBe(4);
			expect(result.data?.errors).toHaveLength(0);
		});

		it('returns error for invalid JSON syntax', async () => {
			const result = await importValidateCommand.handler(
				{ content: invalidJson, targetNode: 'test-root' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.valid).toBe(false);
			expect(result.data?.errors.length).toBeGreaterThan(0);
		});

		it('validates tokens and extracts them correctly', async () => {
			const result = await importValidateCommand.handler(
				{ content: validStyleDictionaryJson, targetNode: 'test-root' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.tokens).toBeDefined();
			expect(result.data?.tokens?.some((t) => t.id === 'color.brand.primary')).toBe(true);
			expect(result.data?.tokens?.some((t) => t.id === 'spacing.small')).toBe(true);
		});

		it('applies prefix to token IDs', async () => {
			const result = await importValidateCommand.handler(
				{
					content: validStyleDictionaryJson,
					prefix: 'ds',
					targetNode: 'test-root',
				},
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.tokens?.some((t) => t.id === 'ds.color.brand.primary')).toBe(true);
		});

		it('shows diff for new tokens', async () => {
			const result = await importValidateCommand.handler(
				{ content: validStyleDictionaryJson, targetNode: 'test-root' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.diff?.add).toBe(4);
			expect(result.data?.diff?.update).toBe(0);
		});

		it('detects tokens that would be updated', async () => {
			// First add a token
			await tokenAddCommand.handler(
				{
					nodeId: 'test-root',
					tokenId: 'color.brand.primary',
					value: '#FF0000',
				},
				context,
			);

			const result = await importValidateCommand.handler(
				{ content: validStyleDictionaryJson, targetNode: 'test-root' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.diff?.update).toBe(1);
			expect(result.data?.diff?.add).toBe(3);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// IMPORT.JSON
	// ═══════════════════════════════════════════════════════════════════════════

	describe('import.json command', () => {
		it('skips tokens with reserved path segments and reports them as errors', async () => {
			// JSON.parse creates an own '__proto__' property, so this reaches the importer
			const content =
				'{"__proto__": {"polluted": {"value": "yes"}}, "color": {"ok": {"value": "#000000"}}}';

			const result = await importJsonCommand.handler({ targetNode: 'test-root', content }, context);

			expect(result.success).toBe(true);
			expect(result.data?.tokensImported).toBe(1);
			expect(result.data?.errors.map((e) => e.tokenId)).toEqual(['__proto__.polluted']);
			const ops = await db.getOperations('test-root');
			expect(ops.map((op) => op.tokenId)).toEqual(['color.ok']);
		});

		it('imports tokens from Style Dictionary JSON', async () => {
			const result = await importJsonCommand.handler(
				{
					targetNode: 'test-root',
					content: validStyleDictionaryJson,
				},
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.tokensImported).toBe(4);
			expect(result.data?.errors).toHaveLength(0);

			// Verify tokens were imported
			const resolved = await tokensResolveCommand.handler({ nodeId: 'test-root' }, context);
			expect(resolved.data?.tokens.length).toBe(4);
		});

		it('handles dry-run mode', async () => {
			const result = await importJsonCommand.handler(
				{
					targetNode: 'test-root',
					content: validStyleDictionaryJson,
					dryRun: true,
				},
				context,
			);

			expect(result.success).toBe(true);
			// In dry-run, tokensImported is 0 and tokensSkipped shows what would be imported
			expect(result.data?.tokensImported).toBe(0);
			expect(result.data?.tokensSkipped).toBe(4);
			expect(result.data?.dryRun).toBe(true);

			// Verify no tokens were actually imported
			const resolved = await tokensResolveCommand.handler({ nodeId: 'test-root' }, context);
			expect(resolved.data?.tokens.length).toBe(0);
		});

		it('applies prefix to imported tokens', async () => {
			const result = await importJsonCommand.handler(
				{
					targetNode: 'test-root',
					content: validStyleDictionaryJson,
					prefix: 'ds',
				},
				context,
			);

			expect(result.success).toBe(true);

			const resolved = await tokensResolveCommand.handler(
				{ nodeId: 'test-root', filter: 'ds.*' },
				context,
			);
			expect(resolved.data?.tokens.length).toBe(4);
		});

		it('returns error for non-existent target node', async () => {
			const result = await importJsonCommand.handler(
				{
					targetNode: 'nonexistent',
					content: validStyleDictionaryJson,
				},
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('NODE_NOT_FOUND');
		});

		it('returns error for invalid JSON', async () => {
			const result = await importJsonCommand.handler(
				{
					targetNode: 'test-root',
					content: invalidJson,
				},
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('handles merge mode with existing tokens', async () => {
			// First add a token
			await tokenAddCommand.handler(
				{
					nodeId: 'test-root',
					tokenId: 'color.brand.primary',
					value: '#FF0000',
				},
				context,
			);

			const result = await importJsonCommand.handler(
				{
					targetNode: 'test-root',
					content: validStyleDictionaryJson,
					merge: true,
				},
				context,
			);

			expect(result.success).toBe(true);
			// Should import 4 tokens (1 override + 3 new)
			expect(result.data?.tokensImported).toBe(4);

			// Verify the token was updated
			const resolved = await tokensResolveCommand.handler(
				{ nodeId: 'test-root', filter: 'color.brand.primary' },
				context,
			);
			expect(resolved.data?.tokens[0]?.resolvedValue).toBe('#0078D4');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// ROUND-TRIP VALIDATION
	// ═══════════════════════════════════════════════════════════════════════════

	describe('round-trip validation', () => {
		it('import then export produces equivalent JSON', async () => {
			// Import tokens
			await importJsonCommand.handler(
				{
					targetNode: 'test-root',
					content: validStyleDictionaryJson,
				},
				context,
			);

			// Resolve tokens
			const resolved = await tokensResolveCommand.handler({ nodeId: 'test-root' }, context);

			// Verify all 4 tokens exist
			expect(resolved.data?.tokens.length).toBe(4);

			// Verify specific values - use 'id' not 'tokenId'
			const primaryToken = resolved.data?.tokens.find((t) => t.id === 'color.brand.primary');
			expect(primaryToken?.resolvedValue).toBe('#0078D4');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// DTCG
	// ═══════════════════════════════════════════════════════════════════════════

	describe('DTCG input', () => {
		const dtcgJson = JSON.stringify({
			$schema: 'https://design-tokens.github.io/community-group/format/',
			color: {
				$type: 'color',
				$description: 'Brand colors',
				primary: { $value: '#0078D4', $description: 'Primary brand color' },
				muted: { $value: '#888888', $type: 'string' },
			},
			shadow: {
				card: { $type: 'shadow', $value: { offsetX: '0', offsetY: '1px', blur: '2px' } },
			},
		});

		it('reads $value, $type (including group-level) and $description', async () => {
			const result = await importJsonCommand.handler(
				{ targetNode: 'test-root', content: dtcgJson },
				context,
			);
			expect(result.success).toBe(true);
			expect(result.data?.tokensImported).toBe(3);

			const resolved = await tokensResolveCommand.handler({ nodeId: 'test-root' }, context);
			const byId = new Map(resolved.data?.tokens.map((t) => [t.id, t]));

			expect(byId.get('color.primary')?.resolvedValue).toBe('#0078D4');
			expect(byId.get('color.primary')?.metadata).toMatchObject({
				type: 'color',
				category: 'color',
				description: 'Primary brand color',
			});
			// Token-level $type wins over the group's
			expect(byId.get('color.muted')?.metadata).toMatchObject({ type: 'string' });
			// Composite $value objects are tokens, not groups
			expect(byId.get('shadow.card')?.value).toEqual({ offsetX: '0', offsetY: '1px', blur: '2px' });
			expect(byId.get('shadow.card')?.metadata).toMatchObject({ category: 'shadow' });
		});

		it('validates DTCG content', async () => {
			const result = await importValidateCommand.handler(
				{ content: dtcgJson, targetNode: 'test-root' },
				context,
			);
			expect(result.data?.valid).toBe(true);
			expect(result.data?.tokenCount).toBe(3);
		});
	});

	describe('importing into a child node', () => {
		it('overrides inherited tokens so the child value wins', async () => {
			await importJsonCommand.handler(
				{ targetNode: 'test-root', content: validStyleDictionaryJson },
				context,
			);
			await nodeCreateCommand.handler(
				{ name: 'test-child', type: 'theme', parentId: 'test-root' },
				context,
			);

			const result = await importJsonCommand.handler(
				{
					targetNode: 'test-child',
					content: JSON.stringify({ color: { brand: { primary: { $value: '#FF0000' } } } }),
				},
				context,
			);
			expect(result.success).toBe(true);

			const resolved = await tokensResolveCommand.handler({ nodeId: 'test-child' }, context);
			const primary = resolved.data?.tokens.find((t) => t.id === 'color.brand.primary');
			expect(primary?.resolvedValue).toBe('#FF0000');
			expect(primary?.resolvedAt).toBe('test-child');
		});
	});

	describe('tiers option', () => {
		const tiered = JSON.stringify({
			global: { $type: 'color', gold: { $value: '#d4af37' } },
			semantic: { accent: { $value: '{gold}' } },
			spacing: { sm: { value: '8px' } },
		});

		it('reads tier groups, inherits tier-level $type, and leaves other groups alone', async () => {
			const result = await importJsonCommand.handler(
				{ targetNode: 'test-root', content: tiered, tiers: true },
				context,
			);
			expect(result.success).toBe(true);

			const resolved = await tokensResolveCommand.handler({ nodeId: 'test-root' }, context);
			const byId = new Map(resolved.data?.tokens.map((t) => [t.id, t]));
			expect(byId.get('gold')?.metadata).toMatchObject({ tier: 'global', category: 'color' });
			expect(byId.get('accent')?.metadata.tier).toBe('semantic');
			expect(byId.has('spacing.sm')).toBe(true);
		});

		it('reports duplicate IDs across tiers in validation', async () => {
			const result = await importValidateCommand.handler(
				{
					targetNode: 'test-root',
					content: JSON.stringify({
						global: { gold: { $value: '#d4af37' } },
						component: { gold: { $value: '#000000' } },
					}),
					tiers: true,
				},
				context,
			);
			expect(result.data?.valid).toBe(false);
			expect(result.data?.errors).toContainEqual({
				tokenId: 'gold',
				error: 'Token ID is defined more than once',
			});
		});
	});
});
