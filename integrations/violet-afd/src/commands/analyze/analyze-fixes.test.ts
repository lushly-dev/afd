/**
 * @fileoverview Regression tests: shared glob dialect and deviation baseline/values
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { tokenOverrideCommand } from '../token/override.js';
import { tokenSubtractCommand } from '../token/subtract.js';
import { compareNodesCommand } from './compare.js';
import { analyzeDeviationsCommand } from './deviations.js';

describe('analyze fixes', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		await nodeCreateCommand.handler({ name: 'root', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler({ name: 'mid', type: 'product', parentId: 'root' }, context);
		await nodeCreateCommand.handler({ name: 'leaf', type: 'platform', parentId: 'mid' }, context);
		await nodeCreateCommand.handler({ name: 'other', type: 'product', parentId: 'root' }, context);

		await tokenAddCommand.handler(
			{ nodeId: 'root', tokenId: 'color.brand.primary', value: '#root' },
			context,
		);
		await tokenAddCommand.handler({ nodeId: 'root', tokenId: 'spacing.base', value: '8' }, context);
	});

	describe('glob dialect', () => {
		it('compare.nodes: color.* matches nested ids', async () => {
			await tokenOverrideCommand.handler(
				{ nodeId: 'mid', tokenId: 'color.brand.primary', value: '#mid' },
				context,
			);
			const result = await compareNodesCommand.handler(
				{ nodeA: 'mid', nodeB: 'other', filter: 'color.*' },
				context,
			);
			expect(result.success).toBe(true);
			expect(result.data?.differences.map((d) => d.tokenId)).toEqual(['color.brand.primary']);
		});

		it('compare.nodes: regex metacharacters in filters do not throw', async () => {
			for (const filter of ['(', '[', 'color.(', '*[a-', '\\']) {
				const result = await compareNodesCommand.handler(
					{ nodeA: 'mid', nodeB: 'other', filter },
					context,
				);
				expect(result.success).toBe(true);
				expect(result.data?.differences).toEqual([]);
			}
		});

		it('analyze.deviations: color.* matches nested ids and metacharacters do not throw', async () => {
			await tokenOverrideCommand.handler(
				{ nodeId: 'mid', tokenId: 'color.brand.primary', value: '#mid' },
				context,
			);
			const matching = await analyzeDeviationsCommand.handler(
				{ nodeId: 'mid', filter: 'color.*' },
				context,
			);
			expect(matching.success).toBe(true);
			expect(matching.data?.totalDeviations).toBe(1);

			const weird = await analyzeDeviationsCommand.handler(
				{ nodeId: 'mid', filter: 'color.(' },
				context,
			);
			expect(weird.success).toBe(true);
			expect(weird.data?.totalDeviations).toBe(0);
		});
	});

	describe('analyze.deviations values and baseline', () => {
		it('reports parsed values, not JSON-encoded strings', async () => {
			await tokenOverrideCommand.handler(
				{ nodeId: 'mid', tokenId: 'color.brand.primary', value: '#mid' },
				context,
			);
			const result = await analyzeDeviationsCommand.handler({ nodeId: 'mid' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.deviations).toEqual([
				{
					tokenId: 'color.brand.primary',
					ancestorValue: '#root',
					localValue: '#mid',
					operation: 'override',
					deviatedAt: 'mid',
				},
			]);
		});

		it('with fromAncestor=mid the baseline is mid own value, not root', async () => {
			await tokenOverrideCommand.handler(
				{ nodeId: 'mid', tokenId: 'color.brand.primary', value: '#mid' },
				context,
			);
			await tokenOverrideCommand.handler(
				{ nodeId: 'leaf', tokenId: 'color.brand.primary', value: '#leaf' },
				context,
			);

			const result = await analyzeDeviationsCommand.handler(
				{ nodeId: 'leaf', fromAncestor: 'mid' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.comparedTo).toBe('mid');
			expect(result.data?.deviations).toHaveLength(1);
			expect(result.data?.deviations[0]).toMatchObject({
				ancestorValue: '#mid',
				localValue: '#leaf',
				deviatedAt: 'leaf',
			});
		});

		it('baseline respects subtractions made between root and fromAncestor', async () => {
			await tokenSubtractCommand.handler({ nodeId: 'mid', tokenId: 'spacing.base' }, context);
			await tokenAddCommand.handler(
				{ nodeId: 'leaf', tokenId: 'spacing.base', value: '4' },
				context,
			);
			await tokenOverrideCommand.handler(
				{ nodeId: 'leaf', tokenId: 'spacing.base', value: '2' },
				context,
			);

			const result = await analyzeDeviationsCommand.handler(
				{ nodeId: 'leaf', fromAncestor: 'mid' },
				context,
			);
			expect(result.success).toBe(true);
			// spacing.base was subtracted at mid, so it is not part of mid's baseline
			expect(result.data?.deviations.find((d) => d.tokenId === 'spacing.base')).toBeUndefined();
		});
	});
});
