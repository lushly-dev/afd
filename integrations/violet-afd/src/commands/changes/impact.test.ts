import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { OverlayDatabase, OverlayWriteError } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { setCommand as constraintsSetCommand } from '../constraints/set.js';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { tokenCopyCommand } from '../token/copy.js';
import { tokenOverrideCommand } from '../token/override.js';
import { tokenSubtractCommand } from '../token/subtract.js';
import { changesImpactCommand } from './impact.js';

describe('changes.impact command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	const create = (
		name: string,
		parentId: string | null,
		type: 'root' | 'product' | 'theme' | 'shared' | 'custom' = 'custom',
		includes: string[] = [],
	) => nodeCreateCommand.handler({ name, parentId, type, includes }, context);

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// global -> { vscode, xbox -> xbox-dark, office }; a11y is a shared set that office mixes in;
		// teams is a separate tree that borrows the accent from vscode
		await create('global', null, 'root');
		await create('vscode', 'global', 'product');
		await create('xbox', 'global', 'product');
		await create('xbox-dark', 'xbox', 'theme');
		await create('a11y', null, 'shared');
		await create('office', 'global', 'product', ['a11y']);
		await create('teams', null, 'root');

		for (const [nodeId, tokenId, value] of [
			['global', 'color.accent.primary', '#0078D4'],
			['global', 'color.accent.hover', { ref: 'color.accent.primary' }],
			['global', 'color.surface.base', '#FFFFFF'],
			['global', 'color.text.primary', '#1E2024'],
			['global', 'spacing.md', '16px'],
			['a11y', 'focus.ring.width', '3px'],
		] as const) {
			await tokenAddCommand.handler({ nodeId, tokenId, value }, context);
		}
		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.accent.primary', value: '#107C10' },
			context,
		);
		await tokenCopyCommand.handler(
			{ nodeId: 'teams', tokenId: 'color.accent.primary', fromNode: 'vscode' },
			context,
		);
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
				],
			},
			context,
		);
	});

	const run = async (input: Parameters<typeof changesImpactCommand.handler>[0]) => {
		const result = await changesImpactCommand.handler(input, context);
		if (!result.success || !result.data) {
			throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
		}
		return result.data;
	};

	const effectsOf = (data: Awaited<ReturnType<typeof run>>, tokenId: string) =>
		Object.fromEntries(
			data.nodes.map((node) => [
				node.id,
				node.tokens.find((token) => token.tokenId === tokenId)?.effect,
			]),
		);

	it('overrides at the root change descendants and shield customized ones', async () => {
		const data = await run({
			nodeId: 'global',
			changes: [{ type: 'override', tokenId: 'color.accent.primary', value: '#C50F1F' }],
		});

		expect(effectsOf(data, 'color.accent.primary')).toEqual({
			global: 'changes',
			vscode: 'changes',
			xbox: 'shielded',
			'xbox-dark': 'shielded',
			office: 'changes',
			teams: 'changes',
		});
		const xboxDark = data.nodes.find((node) => node.id === 'xbox-dark');
		expect(xboxDark?.via).toBe('inheritance');
		expect(xboxDark?.tokens[0]).toMatchObject({
			shieldedBy: 'xbox',
			before: { resolvedValue: '#107C10' },
			after: { resolvedValue: '#107C10' },
		});
		const vscode = data.nodes.find((node) => node.id === 'vscode')?.tokens[0];
		expect(vscode?.before.resolvedValue).toBe('#0078D4');
		expect(vscode?.after.resolvedValue).toBe('#C50F1F');
		expect(data.summary.effects).toMatchObject({ changes: 4, shielded: 2 });
	});

	it('lists tokens that refer to a changed token', async () => {
		const data = await run({
			nodeId: 'global',
			changes: [{ type: 'override', tokenId: 'color.accent.primary', value: '#C50F1F' }],
		});
		const hover = data.nodes
			.find((node) => node.id === 'vscode')
			?.tokens.find((token) => token.tokenId === 'color.accent.hover');
		expect(hover).toMatchObject({
			effect: 'changes',
			direct: false,
			before: { resolvedValue: '#0078D4', aliasOf: 'color.accent.primary' },
			after: { resolvedValue: '#C50F1F' },
		});
	});

	it('reaches nodes through mix-ins and borrows', async () => {
		const mixin = await run({
			nodeId: 'a11y',
			changes: [{ type: 'override', tokenId: 'focus.ring.width', value: '4px' }],
		});
		expect(mixin.nodes.map((node) => [node.id, node.via, node.through, node.effect])).toEqual([
			['a11y', 'direct', undefined, 'changes'],
			['office', 'include', 'a11y', 'changes'],
		]);

		const borrow = await run({
			nodeId: 'vscode',
			changes: [{ type: 'override', tokenId: 'color.accent.primary', value: '#7B2CBF' }],
		});
		expect(borrow.nodes.map((node) => [node.id, node.via, node.through, node.effect])).toEqual([
			['vscode', 'direct', undefined, 'changes'],
			['teams', 'copy', 'vscode', 'changes'],
		]);
		expect(borrow.nodes[1].tokens[0].after).toMatchObject({
			state: 'copy',
			fromNode: 'vscode',
			resolvedValue: '#7B2CBF',
		});
	});

	it('reports removals, and borrows whose source is gone', async () => {
		const data = await run({
			nodeId: 'vscode',
			changes: [{ type: 'subtract', tokenId: 'color.accent.primary' }],
		});
		const [vscode, teams] = data.nodes;
		expect(vscode.tokens[0]).toMatchObject({ effect: 'removed', after: { state: 'subtracted' } });
		expect(teams.tokens[0]).toMatchObject({
			effect: 'removed',
			copySourceRemoved: 'vscode',
			before: { state: 'copy' },
			after: { state: 'absent' },
		});
		expect(data.summary.effects.removed).toBe(2);
	});

	it('shields descendants that already removed the token', async () => {
		await tokenSubtractCommand.handler({ nodeId: 'xbox', tokenId: 'spacing.md' }, context);
		const data = await run({
			nodeId: 'global',
			changes: [{ type: 'override', tokenId: 'spacing.md', value: '12px' }],
		});
		expect(effectsOf(data, 'spacing.md')).toMatchObject({
			vscode: 'changes',
			xbox: 'shielded',
			'xbox-dark': 'shielded',
		});
		expect(data.nodes.find((node) => node.id === 'xbox-dark')?.tokens[0].shieldedBy).toBe('xbox');
	});

	it('previews a reset back to an ancestor value', async () => {
		const data = await run({
			nodeId: 'xbox',
			changes: [{ type: 'reset', tokenId: 'color.accent.primary' }],
		});
		expect(data.changes).toEqual([
			{ type: 'reset', tokenId: 'color.accent.primary', toAncestor: 'global' },
		]);
		expect(effectsOf(data, 'color.accent.primary')).toEqual({
			xbox: 'changes',
			'xbox-dark': 'changes',
		});
		expect(data.nodes[1].tokens[0].after.resolvedValue).toBe('#0078D4');
		expect(data.apply[0].cli).toBe(
			'violet token reset --node xbox --token color.accent.primary --ancestor global',
		);
	});

	it('applies several changes in order', async () => {
		const data = await run({
			nodeId: 'xbox',
			changes: [
				{ type: 'add', tokenId: 'color.brand.glow', value: '#9BF00B' },
				{ type: 'override', tokenId: 'color.brand.glow', value: '#B4FF39' },
			],
		});
		const glow = data.nodes.find((node) => node.id === 'xbox-dark')?.tokens[0];
		expect(glow).toMatchObject({ effect: 'added', after: { resolvedValue: '#B4FF39' } });
		expect(data.apply.map((step) => step.cli)).toEqual([
			"violet token add --node xbox --token color.brand.glow --value '#9BF00B'",
			"violet token override --node xbox --token color.brand.glow --value '#B4FF39'",
		]);
	});

	it('quotes values the CLI would otherwise misread', async () => {
		const data = await run({
			nodeId: 'global',
			changes: [
				{ type: 'override', tokenId: 'spacing.md', value: '12' },
				{ type: 'override', tokenId: 'color.accent.hover', value: { ref: 'color.text.primary' } },
			],
			includeViolations: false,
		});
		expect(data.apply.map((step) => step.cli)).toEqual([
			`violet token override --node global --token spacing.md --value '"12"'`,
			`violet token override --node global --token color.accent.hover --value '{"ref":"color.text.primary"}'`,
		]);
		expect(data.apply[0].input).toEqual({ nodeId: 'global', tokenId: 'spacing.md', value: '12' });
	});

	it('reports violations introduced and resolved', async () => {
		const failing = await run({
			nodeId: 'xbox',
			changes: [{ type: 'override', tokenId: 'color.text.primary', value: '#EEEEEE' }],
		});
		expect(failing.nodes.map((node) => node.violations.introduced.length)).toEqual([1, 1]);
		expect(failing.nodes[1].violations.introduced[0]).toMatchObject({
			nodeId: 'xbox-dark',
			tokenId: 'color.text.primary',
			constraintId: 'text-contrast',
			source: 'xbox',
			inherited: true,
		});
		expect(failing.summary).toMatchObject({
			violationsIntroduced: 2,
			violationsResolved: 0,
			breakingNodes: 2,
		});

		await tokenOverrideCommand.handler(
			{ nodeId: 'xbox', tokenId: 'color.text.primary', value: '#EEEEEE' },
			context,
		);
		const fixing = await run({
			nodeId: 'xbox',
			changes: [{ type: 'reset', tokenId: 'color.text.primary' }],
		});
		expect(fixing.summary).toMatchObject({ violationsIntroduced: 0, violationsResolved: 2 });
		expect(fixing.nodes[0].violations.resolved[0].constraintId).toBe('text-contrast');
	});

	it('skips the violation check when asked', async () => {
		const data = await run({
			nodeId: 'xbox',
			changes: [{ type: 'override', tokenId: 'color.text.primary', value: '#EEEEEE' }],
			includeViolations: false,
		});
		expect(data.summary).toMatchObject({ violationsIntroduced: 0, violationsChecked: false });
	});

	it('never writes to the database', async () => {
		const operationsBefore = db.getStats();
		const auditBefore = (await db.getAuditEvents({})).length;
		const opsBefore = await Promise.all(
			['global', 'xbox', 'vscode'].map(async (id) => (await db.getOperations(id)).length),
		);

		await run({
			nodeId: 'global',
			changes: [
				{ type: 'override', tokenId: 'color.accent.primary', value: '#C50F1F' },
				{ type: 'subtract', tokenId: 'spacing.md' },
				{ type: 'add', tokenId: 'color.new', value: '#000000' },
			],
		});

		expect(db.getStats()).toEqual(operationsBefore);
		expect((await db.getAuditEvents({})).length).toBe(auditBefore);
		expect(
			await Promise.all(
				['global', 'xbox', 'vscode'].map(async (id) => (await db.getOperations(id)).length),
			),
		).toEqual(opsBefore);
	});

	it('rejects changes the mutation commands would reject', async () => {
		const unknown = await changesImpactCommand.handler(
			{ nodeId: 'xbox', changes: [{ type: 'override', tokenId: 'color.missing', value: '#000' }] },
			context,
		);
		expect(unknown.success).toBe(false);
		expect(unknown.error?.code).toBe('TOKEN_NOT_FOUND');
		expect(unknown.error?.message).toContain("Cannot preview override 'color.missing'");

		const duplicate = await changesImpactCommand.handler(
			{ nodeId: 'xbox', changes: [{ type: 'add', tokenId: 'spacing.md', value: '8px' }] },
			context,
		);
		expect(duplicate.error?.code).toBe('TOKEN_ALREADY_EXISTS');

		const badAncestor = await changesImpactCommand.handler(
			{
				nodeId: 'xbox',
				changes: [{ type: 'reset', tokenId: 'spacing.md', toAncestor: 'vscode' }],
			},
			context,
		);
		expect(badAncestor.error?.code).toBe('INVALID_PARENT');

		const missingNode = await changesImpactCommand.handler(
			{ nodeId: 'nope', changes: [{ type: 'subtract', tokenId: 'spacing.md' }] },
			context,
		);
		expect(missingNode.error?.code).toBe('NODE_NOT_FOUND');
	});

	it('reports nodes in a cycle as unresolved', async () => {
		// a and b mix each other in; the commands refuse to create this, so write it directly
		await create('loop-a', 'global');
		await create('loop-b', 'global');
		await db.updateNode('loop-a', { includes: ['loop-b'] });
		await db.updateNode('loop-b', { includes: ['loop-a'] });

		const data = await run({
			nodeId: 'global',
			changes: [{ type: 'override', tokenId: 'color.accent.primary', value: '#C50F1F' }],
		});
		const loops = data.nodes.filter((node) => node.id.startsWith('loop-'));
		expect(loops.map((node) => [node.id, node.effect])).toEqual([
			['loop-a', 'unresolved'],
			['loop-b', 'unresolved'],
		]);
		expect(loops[0].error).toContain('Circular reference');
		expect(data.summary.effects.unresolved).toBe(2);
	});
});

describe('OverlayDatabase', () => {
	it('layers staged operations over stored ones and rejects every write', async () => {
		const db = createMemoryDatabase();
		const context = { db, actor: 'test' };
		await nodeCreateCommand.handler({ name: 'global', parentId: null, type: 'root' }, context);
		await tokenAddCommand.handler(
			{ nodeId: 'global', tokenId: 'spacing.md', value: '16px' },
			context,
		);

		const overlay = new OverlayDatabase(db);
		await tokenOverrideCommand.handler(
			{ nodeId: 'global', tokenId: 'spacing.md', value: '12px' },
			{ db: overlay.stagingView(), actor: 'test' },
		);

		expect((await overlay.getOperations('global')).map((op) => op.type)).toEqual([
			'add',
			'override',
		]);
		expect((await db.getOperations('global')).map((op) => op.type)).toEqual(['add']);
		expect(overlay.stagedOperations()).toHaveLength(1);

		const node = await db.getNode('global');
		const writes: Array<() => Promise<unknown>> = [
			() => overlay.addOperation(overlay.stagedOperations()[0]),
			() => overlay.removeOperation('x'),
			() => overlay.createNode(node as NonNullable<typeof node>),
			() => overlay.updateNode('global', { name: 'x' }),
			() => overlay.deleteNode('global'),
			() => overlay.setConstraints('global', []),
			() => overlay.removeConstraint('global', 'x'),
			() =>
				overlay.addAuditEvent({
					id: 'x',
					timestamp: new Date().toISOString(),
					eventType: 'token_updated',
					actor: 'test',
					targetNode: 'global',
					targetToken: null,
					oldValue: null,
					newValue: null,
					metadata: null,
				}),
			() => overlay.deleteWebhook('x'),
		];
		for (const write of writes) {
			await expect(write()).rejects.toBeInstanceOf(OverlayWriteError);
		}
		// The staging view still refuses anything but staging an operation
		await expect(overlay.stagingView().deleteNode('global')).rejects.toBeInstanceOf(
			OverlayWriteError,
		);
	});
});
