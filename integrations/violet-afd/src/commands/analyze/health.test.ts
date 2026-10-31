import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedRealisticSystem } from '../../demo/realistic-system.js';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { tokenCopyCommand } from '../token/copy.js';
import { tokenOverrideCommand } from '../token/override.js';
import { tokenSubtractCommand } from '../token/subtract.js';
import { type HealthNode, analyzeHealthCommand } from './health.js';
import { analyzeViolationsCommand } from './violations.js';

async function health(context: CommandContext, input = {}) {
	const result = await analyzeHealthCommand.handler(input, context);
	if (!result.success || !result.data) throw new Error(result.error?.message);
	return result.data;
}

const byId = (nodes: HealthNode[], id: string) => {
	const node = nodes.find((entry) => entry.id === id);
	if (!node) throw new Error(`no node ${id}`);
	return node;
};

describe('analyze.health command', () => {
	let context: CommandContext;

	beforeEach(async () => {
		context = { db: createMemoryDatabase(), actor: 'test', traceId: 'test-trace' };
		const create = (name: string, parentId: string | null, status?: 'deprecated') =>
			nodeCreateCommand.handler({ name, parentId, type: 'custom', status }, context);

		// root -> { a -> a-child, b (deprecated) -> b-child }
		await create('root', null);
		await create('a', 'root');
		await create('a-child', 'a');
		await create('b', 'root', 'deprecated');
		await create('b-child', 'b');

		for (const [tokenId, value, category] of [
			['color.primary', '#0066CC', 'color'],
			['color.secondary', '#444444', 'color'],
			['spacing.md', '16px', 'spacing'],
			['radius.md', '4px', 'radius'],
		] as const) {
			await tokenAddCommand.handler(
				{ nodeId: 'root', tokenId, value, metadata: { category } },
				context,
			);
		}
		// a changes one value, removes one; a-child repeats its parent's value
		await tokenOverrideCommand.handler(
			{ nodeId: 'a', tokenId: 'color.primary', value: '#107C10' },
			context,
		);
		await tokenSubtractCommand.handler({ nodeId: 'a', tokenId: 'radius.md' }, context);
		await tokenOverrideCommand.handler(
			{ nodeId: 'a-child', tokenId: 'color.primary', value: '#107C10' },
			context,
		);
		// b-child copies from a (a sibling of its parent) and from root (an ancestor)
		await tokenOverrideCommand.handler(
			{ nodeId: 'a', tokenId: 'spacing.md', value: '20px' },
			context,
		);
		await tokenCopyCommand.handler(
			{ nodeId: 'b-child', tokenId: 'spacing.md', fromNode: 'a' },
			context,
		);
		await tokenCopyCommand.handler(
			{ nodeId: 'b-child', tokenId: 'color.secondary', fromNode: 'root' },
			context,
		);
	});

	it('measures drift against each parent by default', async () => {
		const data = await health(context, { includeViolations: false });

		expect(data.baseline).toBe('parent');
		expect(byId(data.nodes, 'root').drift).toEqual({
			baseline: null,
			compared: 0,
			changed: 0,
			added: 0,
			removed: 0,
			ratio: 0,
		});
		// a: color.primary and spacing.md changed, radius.md removed, of 4 tokens
		expect(byId(data.nodes, 'a').drift).toEqual({
			baseline: 'root',
			compared: 4,
			changed: 2,
			added: 0,
			removed: 1,
			ratio: 0.75,
		});
		// a-child repeats a's values, so it does not drift from its parent
		expect(byId(data.nodes, 'a-child').drift.ratio).toBe(0);
	});

	it('measures drift against the root or a chosen node', async () => {
		const fromRoot = await health(context, { baseline: 'root', includeViolations: false });
		expect(byId(fromRoot.nodes, 'a-child').drift).toMatchObject({
			baseline: 'root',
			changed: 2,
			removed: 1,
			ratio: 0.75,
		});
		expect(byId(fromRoot.nodes, 'root').drift).toMatchObject({ baseline: 'root', ratio: 0 });

		const fromA = await health(context, { baseline: 'a', includeViolations: false });
		expect(byId(fromA.nodes, 'a').drift.ratio).toBe(0);
		// root has radius.md that a removed, and differs on two values
		expect(byId(fromA.nodes, 'root').drift).toMatchObject({
			baseline: 'a',
			changed: 2,
			added: 1,
			removed: 0,
		});
	});

	it('counts each node’s effective customizations by type and category', async () => {
		const data = await health(context, { includeViolations: false });
		expect(byId(data.nodes, 'a').customizations).toEqual({
			total: 3,
			add: 0,
			override: 2,
			subtract: 1,
			reset: 0,
			copy: 0,
			byCategory: { color: 1, radius: 1, spacing: 1 },
		});
		expect(byId(data.nodes, 'root').customizations).toMatchObject({ total: 4, add: 4 });
		expect(byId(data.nodes, 'root').subtree).toMatchObject({ nodes: 5, customizations: 10 });
	});

	it('flags redundant overrides, sibling borrows and deprecated nodes with children', async () => {
		const data = await health(context, { includeViolations: false });

		expect(byId(data.nodes, 'a-child').flags).toEqual([
			expect.objectContaining({
				kind: 'redundant-override',
				tokenId: 'color.primary',
				value: '#107C10',
				inheritedFrom: 'a',
			}),
		]);
		expect(byId(data.nodes, 'b-child').flags).toEqual([
			expect.objectContaining({ kind: 'sibling-borrow', tokenId: 'spacing.md', fromNode: 'a' }),
		]);
		expect(byId(data.nodes, 'b').flags).toEqual([
			expect.objectContaining({ kind: 'deprecated-with-children', children: ['b-child'] }),
		]);
		expect(byId(data.nodes, 'b-child').coupling.borrows).toEqual([
			{ fromNode: 'a', relation: 'sibling', tokens: ['spacing.md'] },
			{ fromNode: 'root', relation: 'ancestor', tokens: ['color.secondary'] },
		]);
		expect(byId(data.nodes, 'a').coupling.borrowedBy).toEqual(['b-child']);
		expect(data.summary.flags).toEqual({
			redundantOverrides: 1,
			siblingBorrows: 1,
			inertResets: 0,
			deprecatedWithChildren: 1,
			sunsetWithoutReplacement: 0,
			replacementDeprecated: 0,
			pastSunset: 0,
		});
		expect(data.summary.flagged).toBe(3);
	});

	it('sorts by drift, highest first, keeping tree order for ties', async () => {
		const data = await health(context, { sort: 'drift', includeViolations: false });
		expect(data.nodes.map((node) => node.id)).toEqual(['a', 'b-child', 'root', 'a-child', 'b']);
	});

	it('fails for an unknown subtree or baseline', async () => {
		const missingRoot = await analyzeHealthCommand.handler({ rootId: 'nope' }, context);
		expect(missingRoot.error?.code).toBe('NODE_NOT_FOUND');

		const missingBaseline = await analyzeHealthCommand.handler({ baseline: 'nope' }, context);
		expect(missingBaseline.error?.code).toBe('NODE_NOT_FOUND');
		expect(missingBaseline.error?.message).toContain("Baseline node 'nope'");
	});
});

describe('analyze.health on the realistic demo system', () => {
	let context: CommandContext;
	let data: Awaited<ReturnType<typeof health>>;

	beforeAll(async () => {
		context = { db: createMemoryDatabase(), actor: 'demo', traceId: 'demo' };
		await seedRealisticSystem(context);
		data = await health(context);
	}, 120_000);

	it('finds the planted redundant overrides', () => {
		const redundant = data.nodes.flatMap((node) =>
			node.flags
				.filter((flag) => flag.kind === 'redundant-override')
				.map((flag) => `${node.id} ${flag.tokenId} ← ${flag.inheritedFrom}`),
		);
		expect(redundant).toEqual(
			expect.arrayContaining([
				'teams typography.family.sans ← global',
				'office-web radius.md ← office',
			]),
		);
	});

	it('finds the planted sibling borrows', () => {
		const borrows = data.nodes.flatMap((node) =>
			node.flags
				.filter((flag) => flag.kind === 'sibling-borrow')
				.map((flag) => `${node.id} ${flag.tokenId} ← ${flag.fromNode}`),
		);
		expect(borrows.sort()).toEqual([
			'office-ios button.min.height ← xbox-ios',
			'teams-dark color.surface.base ← office-dark',
			'vscode-dark color.text.primary ← xbox-dark',
		]);
		expect(byId(data.nodes, 'xbox-dark').coupling.borrowedBy).toEqual(['vscode-dark']);
	});

	it('flags the deprecated azure-classic branch', () => {
		const deprecated = data.nodes.filter((node) =>
			node.flags.some((flag) => flag.kind === 'deprecated-with-children'),
		);
		expect(deprecated.map((node) => node.id)).toEqual(['azure-classic']);
		expect(byId(data.nodes, 'azure-classic').status).toBe('deprecated');
	});

	it('agrees with analyze.violations', async () => {
		const result = await analyzeViolationsCommand.handler({}, context);
		const summary = result.data?.summary;
		expect(data.summary.violations).toEqual({
			total: summary?.total,
			error: summary?.errors,
			warning: summary?.warnings,
			info: summary?.infos,
		});
		for (const [nodeId, count] of Object.entries(summary?.byNode ?? {})) {
			expect(byId(data.nodes, nodeId).violations?.total).toBe(count);
		}
		expect(byId(data.nodes, 'azure-mobile').violations?.error).toBeGreaterThan(0);
	});

	it('rolls up products with their themes and platforms, and lists owners', () => {
		const xbox = byId(data.nodes, 'xbox');
		expect(xbox.subtree.nodes).toBe(7);
		expect(xbox.subtree.customizations).toBeGreaterThan(xbox.customizations.total);
		expect(xbox.coupling.includes).toEqual([]);
		expect(byId(data.nodes, 'vscode-high-contrast').coupling.includes).toEqual([
			'a11y-high-contrast',
		]);
		expect(data.summary.owners.length).toBeGreaterThan(1);
		expect(data.summary.owners.reduce((total, owner) => total + owner.nodes, 0)).toBe(37);
		expect(data.summary.unresolved).toEqual([]);
	});
});

describe('analyze.health deprecation plans (#117)', () => {
	let context: CommandContext;
	const day = (offset: number) =>
		new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

	beforeEach(async () => {
		context = { db: createMemoryDatabase(), actor: 'test' };
		const create = (input: Parameters<typeof nodeCreateCommand.handler>[0]) =>
			nodeCreateCommand.handler(input, context);
		// root -> { next, retired (deprecated), legacy (deprecated, past sunset) -> legacy-child,
		//           planned (deprecated, replaced by next), dated (sunset, no replacement),
		//           chained (replaced by retired), borrower (copies from legacy) }
		await create({ name: 'root', parentId: null });
		await create({ name: 'next', parentId: 'root' });
		await create({ name: 'retired', parentId: 'root', status: 'deprecated' });
		await create({
			name: 'legacy',
			parentId: 'root',
			status: 'deprecated',
			sunsetAt: day(-3),
			replacedBy: 'next',
		});
		await create({ name: 'legacy-child', parentId: 'legacy' });
		await create({
			name: 'planned',
			parentId: 'root',
			status: 'deprecated',
			sunsetAt: day(30),
			replacedBy: 'next',
		});
		await create({ name: 'dated', parentId: 'root', status: 'deprecated', sunsetAt: day(10) });
		await create({
			name: 'chained',
			parentId: 'root',
			status: 'deprecated',
			replacedBy: 'retired',
		});
		await create({ name: 'borrower', parentId: 'root' });
		await tokenAddCommand.handler(
			{
				nodeId: 'root',
				tokenId: 'color.primary',
				value: '#0066CC',
				metadata: { category: 'color' },
			},
			context,
		);
		await tokenOverrideCommand.handler(
			{ nodeId: 'legacy', tokenId: 'color.primary', value: '#107C10' },
			context,
		);
		await tokenCopyCommand.handler(
			{ nodeId: 'borrower', tokenId: 'color.primary', fromNode: 'legacy' },
			context,
		);
	});

	it('reports each plan with days left and usage', async () => {
		const data = await health(context, { includeViolations: false });
		expect(byId(data.nodes, 'legacy').deprecation).toEqual({
			sunsetAt: day(-3),
			daysLeft: -3,
			replacedBy: 'next',
			replacementStatus: 'active',
			usage: { descendants: 1, borrowers: 1 },
		});
		expect(byId(data.nodes, 'retired').deprecation).toEqual({
			sunsetAt: null,
			daysLeft: null,
			replacedBy: null,
			replacementStatus: null,
			usage: { descendants: 0, borrowers: 0 },
		});
		expect(byId(data.nodes, 'next').deprecation).toBeUndefined();
		expect(data.summary.sunsets.map((entry) => [entry.id, entry.daysLeft])).toEqual([
			['legacy', -3],
			['dated', 10],
			['planned', 30],
		]);
	});

	it('flags a date without a replacement, a deprecated replacement and a passed sunset', async () => {
		const data = await health(context, { includeViolations: false });
		const kinds = (id: string) => byId(data.nodes, id).flags.map((flag) => flag.kind);
		expect(kinds('dated')).toEqual(['sunset-without-replacement']);
		expect(kinds('chained')).toEqual(['replacement-deprecated']);
		expect(kinds('legacy')).toEqual(['deprecated-with-children', 'past-sunset']);
		expect(kinds('planned')).toEqual([]);
		expect(byId(data.nodes, 'legacy').flags[1].message).toContain(
			'still has 1 descendant(s) and 1 borrower(s)',
		);
		expect(data.summary.flags).toMatchObject({
			sunsetWithoutReplacement: 1,
			replacementDeprecated: 1,
			pastSunset: 1,
		});
	});

	it('flags a replacement that no longer exists', async () => {
		await context.db.updateNode('next', { deletedAt: new Date().toISOString() });
		const data = await health(context, { rootId: 'planned', includeViolations: false });
		expect(byId(data.nodes, 'planned').flags).toEqual([
			{
				kind: 'replacement-deprecated',
				message: 'Replaced by next, which no longer exists',
				replacedBy: 'next',
			},
		]);
	});
});
