import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { setCommand as constraintsSetCommand } from '../constraints/set.js';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { tokenOverrideCommand } from '../token/override.js';
import { analyzeSnapshotCommand, recordCheckSnapshot } from './snapshot.js';
import { analyzeTrendsCommand } from './trends.js';

const at = (day: string) => `2026-10-${day}T12:00:00.000Z`;

describe('rule check history: analyze.snapshot and analyze.trends (#117)', () => {
	let context: CommandContext;

	const record = async (rootId: string | undefined, day: string) => {
		const result = await recordCheckSnapshot(context, rootId, at(day));
		if (!result.success || !result.data) throw new Error(result.error?.message);
		return result.data;
	};
	const override = (nodeId: string, tokenId: string, value: string) =>
		tokenOverrideCommand.handler({ nodeId, tokenId, value }, context);

	beforeEach(async () => {
		context = { db: createMemoryDatabase(), actor: 'ci' };
		// global -> { azure -> azure-mobile, xbox }
		for (const [name, parentId] of [
			['global', null],
			['azure', 'global'],
			['azure-mobile', 'azure'],
			['xbox', 'global'],
		] as const) {
			await nodeCreateCommand.handler({ name, parentId }, context);
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
	});

	it('stores the open issues and compares them with the previous snapshot', async () => {
		const first = await record(undefined, '01');
		expect(first.snapshot).toMatchObject({
			rootId: null,
			takenAt: at('01'),
			nodes: 4,
			counts: { total: 0, error: 0, warning: 0, info: 0 },
			actor: 'ci',
		});
		expect(first.change).toBeNull();

		await override('azure', 'color.text.primary', '#C8C6C4');
		await override('xbox', 'spacing.md', '18px');
		const second = await record(undefined, '02');
		expect(second.snapshot.counts).toEqual({ total: 3, error: 2, warning: 1, info: 0 });
		expect(second.change).toEqual({
			previousAt: at('01'),
			previous: { total: 0, error: 0, warning: 0, info: 0 },
			introduced: 3,
			fixed: 0,
		});

		await override('azure', 'color.text.primary', '#1E2024');
		const third = await record(undefined, '03');
		expect(third.change).toMatchObject({ introduced: 0, fixed: 2 });

		const stored = await context.db.listCheckSnapshots();
		expect(stored.map((snapshot) => snapshot.counts.total)).toEqual([0, 3, 1]);
		expect(stored[2].issues).toEqual([
			{ nodeId: 'xbox', tokenId: 'spacing.md', constraintId: 'spacing-scale', severity: 'warning' },
		]);
	});

	it('compares a subtree only with earlier snapshots of the same subtree', async () => {
		await override('azure', 'color.text.primary', '#C8C6C4');
		await record(undefined, '01');
		const azure = await record('azure', '02');
		expect(azure.snapshot).toMatchObject({ rootId: 'azure', nodes: 2 });
		expect(azure.snapshot.counts.total).toBe(2);
		expect(azure.change).toBeNull();
	});

	it('records now through the command, and fails for an unknown subtree', async () => {
		const result = await analyzeSnapshotCommand.handler({ rootId: 'xbox' }, context);
		expect(result.success).toBe(true);
		expect(Date.now() - Date.parse(result.data?.snapshot.takenAt ?? '')).toBeLessThan(60_000);
		expect(result.data?.snapshot).not.toHaveProperty('issues');

		const missing = await analyzeSnapshotCommand.handler({ rootId: 'nope' }, context);
		expect(missing.error?.code).toBe('NODE_NOT_FOUND');
		expect(await context.db.listCheckSnapshots()).toHaveLength(1);
	});

	it('shows recorded checks in analyze.trends, fixed issues included', async () => {
		await override('azure', 'color.text.primary', '#C8C6C4');
		await record(undefined, '02');
		await override('xbox', 'spacing.md', '18px');
		await record(undefined, '03');
		// Two checks on Oct 4: the day's last one counts
		await record(undefined, '04');
		await override('azure', 'color.text.primary', '#1E2024');
		await context.db.addCheckSnapshot({
			...(await context.db.listCheckSnapshots({ limit: 1 }))[0],
			id: 'late',
			takenAt: '2026-10-04T20:00:00.000Z',
			counts: { total: 1, error: 0, warning: 1, info: 0 },
			issues: [
				{
					nodeId: 'xbox',
					tokenId: 'spacing.md',
					constraintId: 'spacing-scale',
					severity: 'warning',
				},
			],
		});

		const result = await analyzeTrendsCommand.handler(
			{ since: '2026-10-01', until: '2026-10-06', includeViolations: false },
			context,
		);
		const data = result.data;
		expect(data?.days.map((day) => [day.date, day.recorded?.total])).toEqual([
			['2026-10-01', undefined],
			['2026-10-02', 2],
			['2026-10-03', 3],
			['2026-10-04', 1],
			['2026-10-05', undefined],
		]);
		expect(data?.days[3].recorded).toEqual({
			total: 1,
			error: 0,
			warning: 1,
			info: 0,
			takenAt: '2026-10-04T20:00:00.000Z',
		});
		expect(data?.summary.history).toEqual({
			days: 3,
			first: at('02'),
			last: '2026-10-04T20:00:00.000Z',
			firstOpen: 2,
			lastOpen: 1,
			introduced: 1,
			fixed: 2,
		});
		expect(result.reasoning).toContain('3 day(s) of recorded checks, 2 → 1 open');
	});

	it('cuts snapshots of a wider scope to the subtree, and skips other subtrees', async () => {
		await override('azure', 'color.text.primary', '#C8C6C4');
		await override('xbox', 'spacing.md', '18px');
		await record(undefined, '02');
		await record('xbox', '03');

		const azure = await analyzeTrendsCommand.handler(
			{ rootId: 'azure', since: '2026-10-01', until: '2026-10-05', includeViolations: false },
			context,
		);
		expect(azure.data?.days.map((day) => day.recorded?.total)).toEqual([
			undefined,
			2,
			undefined,
			undefined,
		]);

		const xbox = await analyzeTrendsCommand.handler(
			{ rootId: 'xbox', since: '2026-10-01', until: '2026-10-05', includeViolations: false },
			context,
		);
		expect(xbox.data?.days.map((day) => day.recorded?.total)).toEqual([undefined, 1, 1, undefined]);

		const off = await analyzeTrendsCommand.handler(
			{ since: '2026-10-01', until: '2026-10-05', includeHistory: false },
			context,
		);
		expect(off.data?.summary.history).toBeUndefined();
	});
});
