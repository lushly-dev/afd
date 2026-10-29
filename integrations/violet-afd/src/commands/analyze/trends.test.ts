import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import type { AuditEvent } from '@lushly-dev/violet-core/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { setCommand as constraintsSetCommand } from '../constraints/set.js';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { tokenOverrideCommand } from '../token/override.js';
import { analyzeTrendsCommand, daysBetween } from './trends.js';

const DAY = '2026-10-';

async function trends(context: CommandContext, input: Record<string, unknown>) {
	const result = await analyzeTrendsCommand.handler(input, context);
	if (!result.success || !result.data) throw new Error(result.error?.message);
	return result.data;
}

describe('analyze.trends command', () => {
	let context: CommandContext;
	let stamp: string;

	beforeEach(async () => {
		const db = createMemoryDatabase();
		// Stamp each event with the day the test sets, so changes land on known days
		stamp = `${DAY}01T09:00:00.000Z`;
		const dated = new Proxy(db, {
			get(target, key) {
				if (key === 'addAuditEvent') {
					return (event: AuditEvent) => target.addAuditEvent({ ...event, timestamp: stamp });
				}
				const value = Reflect.get(target, key, target);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
		context = { db: dated, actor: 'test', traceId: 'test-trace' };

		// global -> { azure -> azure-mobile, xbox } on Oct 1
		for (const [name, parentId] of [
			['global', null],
			['azure', 'global'],
			['azure-mobile', 'azure'],
			['xbox', 'global'],
		] as const) {
			await nodeCreateCommand.handler({ name, parentId, type: 'custom' }, context);
		}
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

		// Oct 3: azure sets a failing text color, which azure-mobile inherits
		stamp = `${DAY}03T10:00:00.000Z`;
		await tokenOverrideCommand.handler(
			{ nodeId: 'azure', tokenId: 'color.text.primary', value: '#C8C6C4' },
			context,
		);
		// Oct 4: xbox breaks the scale
		stamp = `${DAY}04T11:00:00.000Z`;
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'spacing.md', value: '18px' },
			context,
		);
	});

	it('counts changes per day, quiet days included', async () => {
		const data = await trends(context, {
			since: `${DAY}01`,
			until: `${DAY}06`,
			includeViolations: false,
		});

		expect(data.days.map((day) => [day.date, day.changes, day.tokenChanges])).toEqual([
			[`${DAY}01`, 7, 3],
			[`${DAY}02`, 0, 0],
			[`${DAY}03`, 1, 1],
			[`${DAY}04`, 1, 1],
			[`${DAY}05`, 0, 0],
		]);
		expect(data.summary).toMatchObject({ nodes: 4, changes: 9, tokenChanges: 5 });
		expect(data.summary.byType).toEqual({ node_created: 4, token_created: 3, token_updated: 2 });
		expect(data.summary.violations).toBeUndefined();
		expect(data.days[0].open).toBeUndefined();
	});

	it('spreads the open issues over the days their failing values were set', async () => {
		const data = await trends(context, { since: `${DAY}02`, until: `${DAY}06` });

		// azure and azure-mobile fail contrast from Oct 3; xbox fails the scale from Oct 4
		expect(data.days.map((day) => [day.date, day.introduced?.total, day.open])).toEqual([
			[`${DAY}02`, 0, 0],
			[`${DAY}03`, 2, 2],
			[`${DAY}04`, 1, 3],
			[`${DAY}05`, 0, 3],
		]);
		expect(data.days[1].introduced).toEqual({ total: 2, error: 2, warning: 0, info: 0 });
		expect(data.summary.violations).toEqual({
			open: { total: 3, error: 2, warning: 1, info: 0 },
			before: 0,
			during: 3,
			undated: 0,
		});
	});

	it('starts from the issues set before the range', async () => {
		const data = await trends(context, { since: `${DAY}04`, until: `${DAY}05` });

		expect(data.days).toEqual([
			{
				date: `${DAY}04`,
				changes: 1,
				tokenChanges: 1,
				introduced: { total: 1, error: 0, warning: 1, info: 0 },
				open: 3,
			},
		]);
		expect(data.summary.violations).toMatchObject({ before: 2, during: 1 });
	});

	it('scopes changes and issues to a subtree', async () => {
		const data = await trends(context, { rootId: 'azure', since: `${DAY}01`, until: `${DAY}05` });

		expect(data.summary).toMatchObject({ nodes: 2, changes: 3, tokenChanges: 1 });
		expect(data.summary.violations?.open.total).toBe(2);
	});

	it('rejects unreadable times, backwards or overlong ranges and unknown roots', async () => {
		const bad = async (input: Record<string, unknown>) =>
			(await analyzeTrendsCommand.handler(input, context)).error?.code;

		expect(await bad({ since: 'yesterday' })).toBe('VALIDATION_ERROR');
		expect(await bad({ since: `${DAY}05`, until: `${DAY}01` })).toBe('VALIDATION_ERROR');
		expect(await bad({ since: '2020-01-01', until: '2026-01-01' })).toBe('VALIDATION_ERROR');
		expect(await bad({ rootId: 'nope' })).toBe('NODE_NOT_FOUND');
	});

	it('lists every UTC day in a range', () => {
		expect(daysBetween('2026-10-30T12:00:00.000Z', '2026-11-02T00:00:00.000Z')).toEqual([
			'2026-10-30',
			'2026-10-31',
			'2026-11-01',
		]);
		expect(daysBetween('2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')).toEqual([]);
	});
});
