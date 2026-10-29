/**
 * @fileoverview Unit tests for analyze commands
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { setCommand as constraintsSetCommand } from '../constraints/set.js';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { tokenOverrideCommand } from '../token/override.js';
import { tokenSubtractCommand } from '../token/subtract.js';
import { compareNodesCommand } from './compare.js';
import { analyzeComplianceCommand } from './compliance.js';
import { analyzeDeviationsCommand } from './deviations.js';

describe('analyze commands', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// Set up test hierarchy: global -> product -> platform
		await nodeCreateCommand.handler({ name: 'global', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler({ name: 'xbox', type: 'product', parentId: 'global' }, context);
		await nodeCreateCommand.handler(
			{ name: 'xbox-web', type: 'platform', parentId: 'xbox' },
			context,
		);

		// Add base tokens at global
		await tokenAddCommand.handler(
			{ nodeId: 'global', tokenId: 'color.primary', value: '#0078D4' },
			context,
		);
		await tokenAddCommand.handler(
			{ nodeId: 'global', tokenId: 'color.secondary', value: '#106EBE' },
			context,
		);
		await tokenAddCommand.handler(
			{ nodeId: 'global', tokenId: 'spacing.base', value: '8' },
			context,
		);
		await tokenAddCommand.handler(
			{ nodeId: 'global', tokenId: 'font.size.body', value: '16' },
			context,
		);

		// Override at xbox level
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.primary', value: '#107C10' },
			context,
		);

		// Override and add at xbox-web level
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox-web', tokenId: 'color.secondary', value: '#2DA562' },
			context,
		);
		await tokenAddCommand.handler(
			{ nodeId: 'xbox-web', tokenId: 'color.accent', value: '#FFB900' },
			context,
		);
	});

	describe('analyze.deviations', () => {
		it('should detect deviations from parent', async () => {
			const result = await analyzeDeviationsCommand.handler({ nodeId: 'xbox' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.nodeId).toBe('xbox');
			expect(result.data?.deviations).toBeDefined();
			expect(result.data?.totalDeviations).toBe(1);
			expect(result.data?.breakdown.overrides).toBe(1);
		});

		it('should detect deviations from specific ancestor', async () => {
			const result = await analyzeDeviationsCommand.handler(
				{ nodeId: 'xbox-web', fromAncestor: 'global' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.comparedTo).toBe('global');
			// Should find: color.primary override (at xbox), color.secondary override (at xbox-web), color.accent add (at xbox-web)
			expect(result.data?.totalDeviations).toBeGreaterThanOrEqual(2);
		});

		it('should filter deviations by token pattern', async () => {
			const result = await analyzeDeviationsCommand.handler(
				{ nodeId: 'xbox-web', fromAncestor: 'global', filter: 'color.*' },
				context,
			);

			expect(result.success).toBe(true);
			// All deviations should be color tokens
			const tokenIds = result.data?.deviations.map((d) => d.tokenId) as string[];
			expect(tokenIds.every((id: string) => id.startsWith('color.'))).toBe(true);
		});

		it('should detect subtraction deviations', async () => {
			// Subtract a token at xbox-web
			await tokenSubtractCommand.handler(
				{ nodeId: 'xbox-web', tokenId: 'font.size.body' },
				context,
			);

			const result = await analyzeDeviationsCommand.handler(
				{ nodeId: 'xbox-web', fromAncestor: 'global' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.breakdown.subtractions).toBe(1);
		});

		it('should fail for non-existent node', async () => {
			const result = await analyzeDeviationsCommand.handler({ nodeId: 'nonexistent' }, context);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('NODE_NOT_FOUND');
		});

		it('should fail for invalid ancestor', async () => {
			const result = await analyzeDeviationsCommand.handler(
				{ nodeId: 'xbox', fromAncestor: 'nonexistent' },
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('NODE_NOT_FOUND');
		});
	});

	describe('analyze.compliance', () => {
		beforeEach(async () => {
			// Set up constraints
			await constraintsSetCommand.handler(
				{
					nodeId: 'global',
					constraints: [
						{
							id: 'brand-colors',
							name: 'Brand Colors',
							config: {
								type: 'enum',
								values: ['#0078D4', '#106EBE', '#107C10', '#2DA562', '#FFB900'],
							},
							severity: 'error',
							applyTo: 'color.*',
						},
						{
							id: 'spacing-grid',
							name: 'Spacing Grid',
							config: { type: 'scale', base: 8 },
							severity: 'warning',
							applyTo: 'spacing.*',
						},
					],
				},
				context,
			);
		});

		it('should generate compliance report for valid node', async () => {
			const result = await analyzeComplianceCommand.handler({ nodeId: 'global' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.nodeId).toBe('global');
			expect(result.data?.compliant).toBe(true);
			expect(result.data?.score).toBe(100);
			expect(result.data?.issues).toHaveLength(0);
		});

		it('should calculate compliance score with violations', async () => {
			// Add invalid token
			await tokenAddCommand.handler(
				{ nodeId: 'global', tokenId: 'color.error', value: '#FF0000' },
				context,
			);

			const result = await analyzeComplianceCommand.handler({ nodeId: 'global' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.compliant).toBe(false);
			expect(result.data?.score).toBeLessThan(100);
			expect(result.data?.issues.length).toBeGreaterThan(0);
		});

		it('should provide recommendations for issues', async () => {
			// Add invalid token
			await tokenAddCommand.handler(
				{ nodeId: 'global', tokenId: 'color.error', value: '#FF0000' },
				context,
			);

			const result = await analyzeComplianceCommand.handler({ nodeId: 'global' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.recommendations).toBeDefined();
			expect(result.data?.recommendations.length).toBeGreaterThan(0);
		});

		it('should filter compliance to specific tokens', async () => {
			// Add invalid color and spacing
			await tokenAddCommand.handler(
				{ nodeId: 'global', tokenId: 'color.error', value: '#FF0000' },
				context,
			);
			await tokenAddCommand.handler(
				{ nodeId: 'global', tokenId: 'spacing.invalid', value: '5' },
				context,
			);

			// Only check color compliance
			const result = await analyzeComplianceCommand.handler(
				{ nodeId: 'global', filter: 'color.*' },
				context,
			);

			expect(result.success).toBe(true);
			// Issues should only be for color tokens
			const tokenIds = result.data?.issues.map((i) => i.tokenId) as string[];
			expect(tokenIds.every((id: string) => id.startsWith('color.'))).toBe(true);
		});

		it('should generate report for child nodes with inherited constraints', async () => {
			const result = await analyzeComplianceCommand.handler({ nodeId: 'xbox-web' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.compliant).toBe(true);
		});

		it('should output JSON format when requested', async () => {
			const result = await analyzeComplianceCommand.handler(
				{ nodeId: 'global', format: 'json' },
				context,
			);

			expect(result.success).toBe(true);
			// Result should be JSON serializable
			expect(() => JSON.stringify(result.data)).not.toThrow();
		});
	});

	describe('compare.nodes', () => {
		it('should compare two nodes', async () => {
			const result = await compareNodesCommand.handler({ nodeA: 'global', nodeB: 'xbox' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.nodeA).toBe('global');
			expect(result.data?.nodeB).toBe('xbox');
			expect(result.data?.differences).toBeDefined();
			expect(result.data?.summary).toBeDefined();
		});

		it('should detect changed tokens', async () => {
			const result = await compareNodesCommand.handler({ nodeA: 'global', nodeB: 'xbox' }, context);

			expect(result.success).toBe(true);
			// color.primary was overridden at xbox
			const changed = result.data?.differences?.filter((d) => d.status === 'changed') || [];
			expect(changed.length).toBeGreaterThan(0);
			expect(changed.some((d) => d.tokenId === 'color.primary')).toBe(true);
		});

		it('should detect added tokens', async () => {
			const result = await compareNodesCommand.handler(
				{ nodeA: 'xbox', nodeB: 'xbox-web' },
				context,
			);

			expect(result.success).toBe(true);
			// color.accent was added at xbox-web
			const added = result.data?.differences?.filter((d) => d.status === 'added') || [];
			expect(added.length).toBeGreaterThan(0);
			expect(added.some((d) => d.tokenId === 'color.accent')).toBe(true);
		});

		it('should detect removed tokens', async () => {
			// Subtract a token at xbox-web
			await tokenSubtractCommand.handler(
				{ nodeId: 'xbox-web', tokenId: 'font.size.body' },
				context,
			);

			const result = await compareNodesCommand.handler(
				{ nodeA: 'xbox', nodeB: 'xbox-web' },
				context,
			);

			expect(result.success).toBe(true);
			const removed = result.data?.differences?.filter((d) => d.status === 'removed') || [];
			expect(removed.length).toBeGreaterThan(0);
			expect(removed.some((d) => d.tokenId === 'font.size.body')).toBe(true);
		});

		it('should identify identical tokens', async () => {
			const result = await compareNodesCommand.handler({ nodeA: 'global', nodeB: 'xbox' }, context);

			expect(result.success).toBe(true);
			// Most tokens should be identical
			const identical = result.data?.differences?.filter((d) => d.status === 'identical') || [];
			expect(identical.length).toBeGreaterThan(0);
		});

		it('should calculate similarity percentage', async () => {
			const result = await compareNodesCommand.handler({ nodeA: 'global', nodeB: 'xbox' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.similarity).toBeDefined();
			expect(result.data?.similarity).toBeGreaterThan(0);
			expect(result.data?.similarity).toBeLessThanOrEqual(100);
		});

		it('should filter comparison to specific tokens', async () => {
			const result = await compareNodesCommand.handler(
				{ nodeA: 'global', nodeB: 'xbox', filter: 'color.*' },
				context,
			);

			expect(result.success).toBe(true);
			// All differences should be color tokens
			const tokenIds = result.data?.differences.map((d) => d.tokenId) as string[];
			expect(tokenIds.every((id: string) => id.startsWith('color.'))).toBe(true);
		});

		it('should provide summary statistics', async () => {
			const result = await compareNodesCommand.handler({ nodeA: 'global', nodeB: 'xbox' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.summary).toHaveProperty('total');
			expect(result.data?.summary).toHaveProperty('identical');
			expect(result.data?.summary).toHaveProperty('changed');
			expect(result.data?.summary).toHaveProperty('added');
			expect(result.data?.summary).toHaveProperty('removed');
		});

		it('should fail for non-existent nodeA', async () => {
			const result = await compareNodesCommand.handler(
				{ nodeA: 'nonexistent', nodeB: 'xbox' },
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('NODE_NOT_FOUND');
		});

		it('should fail for non-existent nodeB', async () => {
			const result = await compareNodesCommand.handler(
				{ nodeA: 'global', nodeB: 'nonexistent' },
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('NODE_NOT_FOUND');
		});

		it('should compare same node (100% similarity)', async () => {
			const result = await compareNodesCommand.handler(
				{ nodeA: 'global', nodeB: 'global' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.similarity).toBe(100);
			expect(result.data?.differences.every((d) => d.status === 'identical')).toBe(true);
		});
	});
});
