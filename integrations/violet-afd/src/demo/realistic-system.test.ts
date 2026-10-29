import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeTrendsCommand } from '../commands/analyze/trends.js';
import { nodesGraphCommand } from '../commands/node/graph.js';
import type { CommandContext } from '../commands/registry.js';
import { tokensMatrixCommand } from '../commands/token/matrix.js';
import { buildTokenCatalog, hsl, seedRealisticSystem } from './realistic-system.js';

async function seeded(seed?: number, checks?: boolean) {
	const context: CommandContext = { db: createMemoryDatabase(), actor: 'demo', traceId: 'demo' };
	const summary = await seedRealisticSystem(context, { seed, checks });
	return { context, summary };
}

async function graph(context: CommandContext, input = {}) {
	const result = await nodesGraphCommand.handler(input, context);
	if (!result.success || !result.data) throw new Error(result.error?.message);
	return result.data;
}

describe('realistic demo system', () => {
	let context: CommandContext;
	let summary: Awaited<ReturnType<typeof seedRealisticSystem>>;
	let timerTicks = 0;

	beforeAll(async () => {
		const timer = setInterval(() => {
			timerTicks += 1;
		}, 0);
		try {
			({ context, summary } = await seeded());
		} finally {
			clearInterval(timer);
		}
	}, 60_000);

	it('lets timers run while it seeds', () => {
		// A seed that never yields starves the host, and vitest's worker RPC with it
		expect(timerTicks).toBeGreaterThan(0);
	});

	it('has the size the plan calls for', async () => {
		expect(summary.nodes).toBe(37);
		expect(summary.tokens).toBeGreaterThanOrEqual(1000);
		expect(summary.tokens).toBeLessThanOrEqual(1300);
		expect(summary.operations).toBeGreaterThan(summary.tokens + 500);

		const data = await graph(context);
		expect(data.roots).toEqual(['a11y-high-contrast', 'global', 'motion-reduced']);
		expect(data.summary.edges).toEqual({ parent: 34, include: 2, copy: 3 });
		expect(data.summary.maxDepth).toBe(3);
	});

	it('covers every category and tier with unique ids', () => {
		const catalog = buildTokenCatalog();
		expect(new Set(catalog.map((token) => token.id)).size).toBe(catalog.length);
		expect(new Set(catalog.map((token) => token.category))).toEqual(
			new Set([
				'color',
				'spacing',
				'typography',
				'radius',
				'shadow',
				'motion',
				'opacity',
				'z-index',
			]),
		);
		expect(new Set(catalog.map((token) => token.tier))).toEqual(
			new Set(['global', 'semantic', 'component']),
		);
		expect(catalog.filter((token) => token.status === 'deprecated').length).toBeGreaterThan(0);
	});

	it('includes every kind of relationship and status', async () => {
		const data = await graph(context, { includeOperations: true });
		const node = (id: string) => {
			const found = data.nodes.find((entry) => entry.id === id);
			if (!found) throw new Error(`missing ${id}`);
			return found;
		};

		expect(node('azure-classic').status).toBe('deprecated');
		expect(node('azure-classic').childCount).toBe(1);
		expect(node('teams-experiment-compact').status).toBe('experimental');
		expect(node('xbox').changes.override).toBeGreaterThan(20);
		expect(node('xbox-ios').changes.subtract).toBeGreaterThan(20);
		expect(node('azure-dark').changes.reset).toBe(1);
		expect(node('vscode-high-contrast').includes).toEqual(['a11y-high-contrast']);
		expect(data.edges).toContainEqual({
			kind: 'copy',
			from: 'xbox-dark',
			to: 'vscode-dark',
			tokens: [{ tokenId: 'color.text.primary' }],
		});
	});

	it('plants constraint violations on the intended nodes only', async () => {
		const result = await tokensMatrixCommand.handler(
			{
				nodeIds: ['global', 'azure-mobile', 'office-ios', 'xbox-dark'],
				includeViolations: true,
			},
			context,
		);
		const rows = result.data?.tokens ?? [];
		const violation = (tokenId: string, nodeId: string) =>
			rows.find((row) => row.id === tokenId)?.cells[nodeId]?.violations?.[0]?.constraintId;

		expect(violation('color.text.primary', 'azure-mobile')).toBe('text-contrast');
		expect(violation('spacing.inset.md', 'office-ios')).toBe('spacing-scale');
		expect(violation('button.foreground', 'xbox-dark')).toBe('button-contrast');
		const rootViolations = rows.flatMap((row) => row.cells.global?.violations ?? []);
		expect(rootViolations).toEqual([]);
	});

	it('contains redundant overrides for health checks to find', async () => {
		const result = await tokensMatrixCommand.handler(
			{ nodeIds: ['global', 'teams'], filter: 'typography.family.sans' },
			context,
		);
		const cells = result.data?.tokens[0]?.cells;

		expect(cells?.teams.state).toBe('override');
		expect(cells?.teams.value).toBe(cells?.global.value);
	});

	it('is deterministic for a seed and varies across seeds', async () => {
		// Seeds change which components each node customizes, not how many
		const customized = async (seed: number) => {
			// Rule check snapshots don't change operations, so skip them for speed
			const { context: seededContext } = await seeded(seed, false);
			const data = await graph(seededContext, { includeOperations: true });
			return data.nodes.map((entry) => [
				entry.id,
				(entry.operations ?? []).map((op) => `${op.type}:${op.tokenId}`),
			]);
		};

		const first = await customized(7);
		expect(await customized(7)).toEqual(first);
		expect(await customized(8)).not.toEqual(first);
	}, 120_000);

	it('dates its history over the 12 weeks before it ran', async () => {
		const audit = await context.db.queryAuditEvents({ limit: 1, offset: 0 });
		const dates = audit.days.map((day) => day.date).sort();
		const today = new Date().toISOString().slice(0, 10);
		const twelveWeeks = new Date(Date.now() - 84 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

		expect(new Set(dates).size).toBeGreaterThan(15);
		expect(dates[0] >= twelveWeeks).toBe(true);
		expect(dates[dates.length - 1] <= today).toBe(true);

		// The planted problems land in the last 10 days, so the open issues climb late.
		// xbox-ios-dark fails with the root's text colour, which dates from the catalog.
		const result = await analyzeTrendsCommand.handler({ since: '12w' }, context);
		const days = result.data?.days ?? [];
		expect(result.data?.summary.violations).toMatchObject({ during: 4, undated: 0 });
		expect(days.slice(-10).reduce((sum, day) => sum + (day.introduced?.total ?? 0), 0)).toBe(3);
		expect(days.at(-1)?.open).toBe(4);
	});

	it('plans the deprecated branch and records rule checks as the history unfolds', async () => {
		const azureClassic = await context.db.getNode('azure-classic');
		expect(azureClassic).toMatchObject({ status: 'deprecated', replacedBy: 'azure-portal' });
		expect(azureClassic?.sunsetAt).toBe(
			new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
		);
		expect((await context.db.getNode('azure-classic-dark'))?.replacedBy).toBeUndefined();

		const result = await analyzeTrendsCommand.handler({ since: '12w' }, context);
		const recorded = (result.data?.days ?? []).flatMap((day) =>
			day.recorded ? [day.recorded.total] : [],
		);
		expect(recorded).toEqual([0, 2, 1, 3, 4]);
		// The Android text trial opens an issue that is fixed before the planted problems land
		expect(result.data?.summary.history).toMatchObject({ lastOpen: 4, introduced: 5, fixed: 1 });
	});

	it('converts HSL to hex', () => {
		expect(hsl(0, 100, 50)).toBe('#FF0000');
		expect(hsl(120, 100, 25)).toBe('#008000');
		expect(hsl(0, 0, 100)).toBe('#FFFFFF');
	});
});
