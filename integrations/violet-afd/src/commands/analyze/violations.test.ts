import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { setCommand as constraintsSetCommand } from '../constraints/set.js';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { tokenOverrideCommand } from '../token/override.js';
import { analyzeViolationsCommand } from './violations.js';

describe('analyze.violations command', () => {
	let context: CommandContext;

	beforeEach(async () => {
		context = { db: createMemoryDatabase(), actor: 'test', traceId: 'test-trace' };
		const create = (name: string, parentId: string | null, owner?: string) =>
			nodeCreateCommand.handler({ name, parentId, type: 'custom', owner }, context);

		// global -> { azure -> azure-mobile, xbox }
		await create('global', null, 'design-system');
		await create('azure', 'global', 'azure-design');
		await create('azure-mobile', 'azure', 'azure-design');
		await create('xbox', 'global', 'xbox-design');

		for (const [tokenId, value] of [
			['color.surface.base', '#FFFFFF'],
			['color.text.primary', '#1E2024'],
			['spacing.md', '16px'],
		]) {
			await tokenAddCommand.handler({ nodeId: 'global', tokenId, value }, context);
		}
		await constraintsSetCommand.handler(
			{
				nodeId: 'global',
				constraints: [
					{
						id: 'text-contrast',
						name: 'Body text contrast',
						config: { type: 'contrast', against: 'color.surface.base', min: 4.5 },
						severity: 'error',
						applyTo: 'color.text.primary',
					},
					{
						id: 'spacing-scale',
						name: 'Spacing on the 4px scale',
						config: { type: 'scale', base: 4, tolerance: 0 },
						severity: 'warning',
						applyTo: 'spacing.*',
					},
				],
			},
			context,
		);

		// azure sets a failing text color that azure-mobile inherits; xbox breaks the scale
		await tokenOverrideCommand.handler(
			{ nodeId: 'azure', tokenId: 'color.text.primary', value: '#C8C6C4' },
			context,
		);
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'spacing.md', value: '18px' },
			context,
		);
	});

	const run = async (input: Parameters<typeof analyzeViolationsCommand.handler>[0] = {}) => {
		const result = await analyzeViolationsCommand.handler(input, context);
		expect(result.success).toBe(true);
		if (!result.data) throw new Error('expected data');
		return result.data;
	};

	it('lists violations across the tree, errors first, with where the value is set', async () => {
		const data = await run();

		expect(
			data.violations.map((v) => [v.severity, v.nodeId, v.tokenId, v.source, v.inherited]),
		).toEqual([
			['error', 'azure', 'color.text.primary', 'azure', false],
			['error', 'azure-mobile', 'color.text.primary', 'azure', true],
			['warning', 'xbox', 'spacing.md', 'xbox', false],
		]);
		expect(data.violations[0]).toMatchObject({
			owner: 'azure-design',
			value: '#C8C6C4',
			constraintId: 'text-contrast',
			constraintName: 'Body text contrast',
		});
		expect(data.violations[0].message).toMatch(/contrast/i);
	});

	it('summarizes by severity and node', async () => {
		const data = await run();

		expect(data.summary).toEqual({
			total: 3,
			errors: 2,
			warnings: 1,
			infos: 0,
			nodes: 3,
			byNode: { azure: 1, 'azure-mobile': 1, xbox: 1 },
			unresolved: [],
		});
	});

	it('filters by subtree and severity', async () => {
		const azure = await run({ rootId: 'azure' });
		expect(azure.violations.map((v) => v.nodeId)).toEqual(['azure', 'azure-mobile']);

		const warnings = await run({ severity: 'warning' });
		expect(warnings.violations.map((v) => v.tokenId)).toEqual(['spacing.md']);
	});

	it('reports no violations for a clean subtree', async () => {
		const global = await run({ rootId: 'global', severity: 'info' });
		expect(global.summary.total).toBe(0);
	});

	it('fails for an unknown root', async () => {
		const result = await analyzeViolationsCommand.handler({ rootId: 'nope' }, context);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
	});
});
