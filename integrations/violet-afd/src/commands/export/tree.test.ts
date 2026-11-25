/**
 * @fileoverview export.tree: a tree written back as files, the inverse of import.tree (#1322)
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { listCommand as constraintsListCommand } from '../constraints/list.js';
import { setCommand as constraintsSetCommand } from '../constraints/set.js';
import { validateCommand as constraintsValidateCommand } from '../constraints/validate.js';
import { importTreeCommand } from '../import/tree.js';
import { nodeCreateCommand } from '../node/create.js';
import { nodeUpdateCommand } from '../node/update.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { tokensCatalogCommand } from '../token/catalog.js';
import { tokenCopyCommand } from '../token/copy.js';
import { tokenOverrideCommand } from '../token/override.js';
import { tokensResolveCommand } from '../token/resolve.js';
import { tokenSubtractCommand } from '../token/subtract.js';
import { exportTreeCommand } from './tree.js';

type Files = Array<{ name: string; content: string }>;

async function exportFiles(context: CommandContext, rootId?: string) {
	const result = await exportTreeCommand.handler(rootId ? { rootId } : {}, context);
	if (!result.success || !result.data) throw new Error(result.error?.message);
	return result.data;
}

async function importFiles(files: Files): Promise<CommandContext> {
	const context: CommandContext = { db: createMemoryDatabase(), actor: 'test' };
	const result = await importTreeCommand.handler({ files }, context);
	if (!result.success) throw new Error(result.error?.message);
	return context;
}

/** Every node's resolved values, by node */
async function resolvedTree(context: CommandContext) {
	const nodes = (await context.db.listNodes()).map((node) => node.id).sort();
	const tree: Record<string, Record<string, unknown>> = {};
	for (const nodeId of nodes) {
		const result = await tokensResolveCommand.handler({ nodeId }, context);
		tree[nodeId] = Object.fromEntries(
			(result.data?.tokens ?? []).map((token) => [token.id, token.resolvedValue]),
		);
	}
	return tree;
}

const files = (data: { files: Array<{ name: string; content: string }> }): Files =>
	data.files.map(({ name, content }) => ({ name, content }));

describe('export.tree command', () => {
	let context: CommandContext;

	beforeEach(async () => {
		context = { db: createMemoryDatabase(), actor: 'test' };
		const create = (name: string, type: string, parentId: string | null, includes?: string[]) =>
			nodeCreateCommand.handler({ name, type, parentId, includes }, context);
		await create('focus', 'shared', null);
		await create('example', 'product', null, ['focus']);
		await create('example-dark', 'theme', 'example');
		await create('example-dark-compact', 'theme', 'example-dark');

		const add = (
			nodeId: string,
			tokenId: string,
			value: unknown,
			type?: string,
			description?: string,
		) =>
			tokenAddCommand.handler(
				{
					nodeId,
					tokenId,
					value: value as string,
					...(type || description ? { metadata: { type, description } } : {}),
				},
				context,
			);
		await add('focus', 'size.focus.width', '2px', 'dimension');
		await add('example', 'color.surface.page', '#ffffff', 'color', 'The page');
		await add('example', 'color.text.primary', '#1b1b1f', 'color');
		await add('example', 'color.text.link', { ref: 'color.text.primary' });
		await add('example', 'size.gap', '8px');
		await add('example-dark', 'color.brand', '#5b3fd1', 'color');
		await tokenOverrideCommand.handler(
			{ nodeId: 'example-dark', tokenId: 'color.surface.page', value: '#121214' },
			context,
		);
		await tokenOverrideCommand.handler(
			{ nodeId: 'example-dark', tokenId: 'color.surface.page', value: '#101012' },
			context,
		);
		await tokenOverrideCommand.handler(
			{ nodeId: 'example-dark-compact', tokenId: 'size.gap', value: '4px' },
			context,
		);
	});

	it("writes one file per node holding only that node's own tokens", async () => {
		const data = await exportFiles(context);
		// In code-point order of the file names, the same on every machine
		expect(data.files.map((file) => file.name)).toEqual([
			'example-dark-compact.tokens.json',
			'example-dark.tokens.json',
			'example.tokens.json',
			'focus.tokens.json',
		]);
		const byNode = Object.fromEntries(
			data.files.map((file) => [file.node, JSON.parse(file.content)]),
		);

		expect(byNode.example).toEqual({
			$extensions: { 'dev.lushly.violet': { type: 'product', includes: ['focus'] } },
			color: {
				surface: { page: { $type: 'color', $value: '#ffffff', $description: 'The page' } },
				text: {
					link: { $value: { ref: 'color.text.primary' } },
					primary: { $type: 'color', $value: '#1b1b1f' },
				},
			},
			size: { gap: { $value: '8px' } },
		});
		// Two overrides of one token read back as its last value; the add on the same node keeps its type
		expect(byNode['example-dark']).toEqual({
			$extensions: { 'dev.lushly.violet': { parent: 'example', type: 'theme' } },
			color: {
				brand: { $type: 'color', $value: '#5b3fd1' },
				surface: { page: { $value: '#101012' } },
			},
		});
		expect(byNode['example-dark-compact'].size).toEqual({ gap: { $value: '4px' } });
		expect(data.files.every((file) => file.content.endsWith('}\n'))).toBe(true);
		expect(data.dropped).toEqual([]);
	});

	it('round-trips through import.tree: the same values, and the same files again', async () => {
		const first = await exportFiles(context);
		const imported = await importFiles(files(first));

		expect(await resolvedTree(imported)).toEqual(await resolvedTree(context));
		const second = await exportFiles(imported);
		expect(second.files).toEqual(first.files);
	});

	it('is a fixed point for a tree that started as files', async () => {
		const source: Files = [
			{
				name: 'base.tokens.json',
				content: JSON.stringify({
					color: { $type: 'color', bg: { $value: '#FFFFFF' }, fg: { $value: '#000000' } },
				}),
			},
			{
				name: 'themes/dark.tokens.json',
				content: JSON.stringify({
					$extensions: { 'dev.lushly.violet': { parent: 'base', type: 'theme' } },
					color: { bg: { $value: '#111111' } },
				}),
			},
		];
		const built = await importFiles(source);
		const once = await exportFiles(built);
		const twice = await exportFiles(await importFiles(files(once)));
		expect(twice.files).toEqual(once.files);
		expect(JSON.parse(once.files.find((file) => file.node === 'dark')?.content ?? '')).toEqual({
			$extensions: { 'dev.lushly.violet': { parent: 'base', type: 'theme' } },
			color: { bg: { $value: '#111111' } },
		});
	});

	it('writes tier groups for tokens imported with tiers', async () => {
		const built = await importFiles([
			{
				name: 'tiered.tokens.json',
				content: JSON.stringify({
					$extensions: { 'dev.lushly.violet': { tiers: true } },
					global: { color: { $type: 'color', gold: { $value: '#c9a227' } } },
					semantic: { color: { accent: { $value: '{color.gold}' } } },
				}),
			},
		]);
		const once = await exportFiles(built);
		const content = JSON.parse(once.files[0]?.content ?? '');
		expect(content.$extensions['dev.lushly.violet'].tiers).toBe(true);
		expect(content.global.color.gold).toEqual({ $type: 'color', $value: '#c9a227' });
		expect(content.color.accent).toEqual({ $value: '{color.gold}' });
		const twice = await exportFiles(await importFiles(files(once)));
		expect(twice.files).toEqual(once.files);
	});

	it('writes one subtree, its root naming the parent outside it', async () => {
		const data = await exportFiles(context, 'example-dark');
		expect(data.files.map((file) => file.node)).toEqual(['example-dark-compact', 'example-dark']);
	});

	it('names the node in the file when the file name cannot', async () => {
		await nodeCreateCommand.handler(
			{ id: 'brand/one', name: 'brand/one', type: 'product', parentId: null },
			context,
		);
		const data = await exportFiles(context);
		const file = data.files.find((entry) => entry.node === 'brand/one');
		expect(file?.name).toBe('brand_one.tokens.json');
		expect(JSON.parse(file?.content ?? '').$extensions['dev.lushly.violet'].node).toBe('brand/one');
	});

	it('lists the settings the files cannot carry', async () => {
		await nodeUpdateCommand.handler(
			{ id: 'example', updates: { owner: 'design@example.com', tags: ['brand'] } },
			context,
		);
		await tokenAddCommand.handler(
			{
				nodeId: 'example',
				tokenId: 'color.legacy',
				value: '#777777',
				metadata: { type: 'color', status: 'deprecated', owner: 'design' },
			},
			context,
		);
		const data = await exportFiles(context);
		expect(data.dropped).toEqual(
			expect.arrayContaining([
				{ node: 'example', fields: ['owner', 'tags'] },
				{ node: 'example', token: 'color.legacy', fields: ['status', 'owner'] },
			]),
		);
	});

	it('refuses operations a token file cannot hold, naming each', async () => {
		await tokenSubtractCommand.handler({ nodeId: 'example-dark', tokenId: 'size.gap' }, context);
		await tokenCopyCommand.handler(
			{
				nodeId: 'example-dark-compact',
				fromNode: 'focus',
				tokenId: 'size.focus.width',
				asTokenId: 'size.ring',
			},
			context,
		);
		const result = await exportTreeCommand.handler({}, context);
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('OPERATION_NOT_ALLOWED');
		expect(result.error?.message).toContain("example-dark: a subtract of 'size.gap'");
		expect(result.error?.message).toContain('example-dark-compact: a copy');
		expect(result.error?.suggestion).toContain('token.remove');
	});

	it('writes an id that is also a group as a dotted key, and reads it back', async () => {
		await tokenAddCommand.handler(
			{ nodeId: 'example', tokenId: 'color.text', value: '#000000' },
			context,
		);
		await tokenAddCommand.handler(
			{ nodeId: 'example', tokenId: 'color.text.primary.strong', value: '#000001' },
			context,
		);
		const first = await exportFiles(context);
		const example = JSON.parse(first.files.find((file) => file.node === 'example')?.content ?? '');
		expect(example.color.text).toEqual({ $value: '#000000' });
		expect(example.color['text.primary']).toEqual({ $type: 'color', $value: '#1b1b1f' });
		expect(example.color['text.primary.strong']).toEqual({ $value: '#000001' });
		expect(example.color['text.link']).toEqual({ $value: { ref: 'color.text.primary' } });

		const imported = await importFiles(files(first));
		expect(await resolvedTree(imported)).toEqual(await resolvedTree(context));
		expect((await exportFiles(imported)).files).toEqual(first.files);
	});

	it('keeps the include policy, so included values win the same way', async () => {
		await nodeUpdateCommand.handler(
			{ id: 'example', updates: { includePolicy: 'override' } },
			context,
		);
		await tokenAddCommand.handler({ nodeId: 'focus', tokenId: 'size.gap', value: '6px' }, context);
		const first = await exportFiles(context);
		const example = JSON.parse(first.files.find((file) => file.node === 'example')?.content ?? '');
		expect(example.$extensions['dev.lushly.violet'].includePolicy).toBe('override');
		const imported = await importFiles(files(first));
		expect(await resolvedTree(imported)).toEqual(await resolvedTree(context));
		expect((await exportFiles(imported)).files).toEqual(first.files);
	});

	it('leaves out an add an ancestor now provides, which does nothing', async () => {
		await tokenAddCommand.handler(
			{ nodeId: 'example-dark-compact', tokenId: 'color.x', value: '#111111' },
			context,
		);
		await tokenAddCommand.handler(
			{ nodeId: 'example', tokenId: 'color.x', value: '#eeeeee', metadata: { type: 'color' } },
			context,
		);
		const first = await exportFiles(context);
		const compact = JSON.parse(
			first.files.find((file) => file.node === 'example-dark-compact')?.content ?? '',
		);
		expect(compact.color).toBeUndefined();
		expect(first.dropped).toContainEqual({
			node: 'example-dark-compact',
			token: 'color.x',
			fields: ['add shadowed by an ancestor'],
		});
		const imported = await importFiles(files(first));
		expect(await resolvedTree(imported)).toEqual(await resolvedTree(context));
		expect((await exportFiles(imported)).files).toEqual(first.files);
	});

	it('gives the same file names whatever the nodes are called', async () => {
		for (const id of ['a/b', 'a_b']) {
			await nodeCreateCommand.handler(
				{ id, name: id === 'a/b' ? 'zzz' : 'aaa', type: 'product', parentId: null },
				context,
			);
		}
		const first = await exportFiles(context);
		const named = Object.fromEntries(first.files.map((file) => [file.node, file.name]));
		expect(named['a/b']).toBe('a_b.tokens.json');
		expect(named.a_b).toBe('a_b-2.tokens.json');
		const second = await exportFiles(await importFiles(files(first)));
		expect(second.files).toEqual(first.files);
	});

	it('refuses a value stored before values were checked', async () => {
		const ops = await context.db.getOperations('example-dark');
		await context.db.addOperation({
			...(ops[0] as (typeof ops)[number]),
			id: 'unchecked',
			sequence: 99,
			value: JSON.stringify('#fff; x: y'),
		});
		const result = await exportTreeCommand.handler({}, context);
		expect(result.error?.code).toBe('INVALID_TOKEN_VALUE');
		expect(result.error?.suggestion).toContain('token.override');
	});

	it('refuses an unknown root', async () => {
		const result = await exportTreeCommand.handler({ rootId: 'nope' }, context);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
	});

	it('preserves non-derivable token categories through export.tree and import.tree (#1974)', async () => {
		const addCategorized = (
			tokenId: string,
			value: string,
			type: string,
			category: 'spacing' | 'radius' | 'z-index' | 'typography' | 'color',
		) =>
			tokenAddCommand.handler(
				{ nodeId: 'example', tokenId, value, metadata: { type, category } },
				context,
			);
		await addCategorized('space.inline.md', '8px', 'dimension', 'spacing');
		await addCategorized('radius.md', '8px', 'dimension', 'radius');
		await addCategorized('z-index.modal', '300', 'number', 'z-index');
		await addCategorized('size.font.md', '14px', 'dimension', 'typography');

		const first = await exportFiles(context);
		expect(first.dropped).toEqual([]);
		const example = JSON.parse(first.files.find((file) => file.node === 'example')?.content ?? '');
		expect(example.space.inline.md).toEqual({
			$type: 'dimension',
			$value: '8px',
			$extensions: { 'dev.lushly.violet': { category: 'spacing' } },
		});
		expect(example.radius.md).toEqual({
			$type: 'dimension',
			$value: '8px',
			$extensions: { 'dev.lushly.violet': { category: 'radius' } },
		});
		expect(example['z-index'].modal).toEqual({
			$type: 'number',
			$value: '300',
			$extensions: { 'dev.lushly.violet': { category: 'z-index' } },
		});
		expect(example.size.font.md).toEqual({
			$type: 'dimension',
			$value: '14px',
			$extensions: { 'dev.lushly.violet': { category: 'typography' } },
		});
		// Derivable categories omit $extensions
		expect(example.color.text.primary.$extensions).toBeUndefined();

		const imported = await importFiles(files(first));
		const second = await exportFiles(imported);
		expect(second.dropped).toEqual([]);
		expect(second.files).toEqual(first.files);

		for (const [category, expectedId] of [
			['spacing', 'space.inline.md'],
			['radius', 'radius.md'],
			['z-index', 'z-index.modal'],
			['typography', 'size.font.md'],
		] as const) {
			const catalog = await tokensCatalogCommand.handler({ category }, imported);
			expect(catalog.success).toBe(true);
			expect(catalog.data?.tokens.map((token) => token.id)).toContain(expectedId);
		}
	});

	it('round-trips node constraints (contrast, ramp, disabledReason, severity, applyTo) with dropped: [] (#2330)', async () => {
		const rootConstraints = [
			{
				id: 'space-ramp',
				name: 'Spacing ramp',
				description: 'Two-stage spacing scale',
				config: {
					type: 'ramp' as const,
					ramp: 'ref.space.*',
					requireOffRampReason: true,
					repeatThreshold: 3,
					pairWith: {
						fromSuffix: '.size',
						toSuffix: '.line',
						rampTarget: 'ref.type.*.line',
					},
				},
				severity: 'warning' as const,
				applyTo: 'size.*',
				enabled: true,
			},
			{
				id: 'contrast-page',
				name: 'Text contrast on page',
				config: {
					type: 'contrast' as const,
					against: 'color.surface.page',
					min: 4.5,
					backdrop: 'color.surface.page',
				},
				severity: 'error' as const,
				applyTo: 'color.text.*',
				enabled: true,
			},
		];
		const darkConstraints = [
			{
				id: 'legacy-brand-disabled',
				name: 'Brand hex rule',
				config: {
					type: 'pattern' as const,
					pattern: '^#[0-9a-fA-F]{6}$',
					flags: 'i',
					target: 'value' as const,
				},
				severity: 'info' as const,
				applyTo: 'color.brand',
				enabled: false,
				disabledReason: 'Relaxed during palette migration',
			},
		];

		// Set in unsorted ID order on example to verify canonical code-point sorting on export
		expect(
			(
				await constraintsSetCommand.handler(
					{ nodeId: 'example', constraints: rootConstraints },
					context,
				)
			).success,
		).toBe(true);
		expect(
			(
				await constraintsSetCommand.handler(
					{ nodeId: 'example-dark', constraints: darkConstraints },
					context,
				)
			).success,
		).toBe(true);

		const first = await exportFiles(context);
		expect(first.dropped).toEqual([]);

		const exampleDoc = JSON.parse(
			first.files.find((entry) => entry.node === 'example')?.content ?? '',
		);
		const darkDoc = JSON.parse(
			first.files.find((entry) => entry.node === 'example-dark')?.content ?? '',
		);
		const compactDoc = JSON.parse(
			first.files.find((entry) => entry.node === 'example-dark-compact')?.content ?? '',
		);

		// Sorted by id (contrast-page before space-ramp), omitted when empty (example-dark-compact)
		expect(
			exampleDoc.$extensions['dev.lushly.violet'].constraints.map((c: { id: string }) => c.id),
		).toEqual(['contrast-page', 'space-ramp']);
		expect(darkDoc.$extensions['dev.lushly.violet'].constraints).toEqual(darkConstraints);
		expect(compactDoc.$extensions['dev.lushly.violet'].constraints).toBeUndefined();

		// Import into a fresh database and verify exact constraint preservation and validation parity
		const imported = await importFiles(files(first));
		const listedExample = await constraintsListCommand.handler(
			{ nodeId: 'example', includeInherited: false },
			imported,
		);
		expect(listedExample.success).toBe(true);
		expect(listedExample.data?.constraints).toEqual([
			{ ...rootConstraints[1], source: 'example' },
			{ ...rootConstraints[0], source: 'example' },
		]);

		const listedDark = await constraintsListCommand.handler(
			{ nodeId: 'example-dark', includeInherited: false },
			imported,
		);
		expect(listedDark.success).toBe(true);
		expect(listedDark.data?.constraints).toEqual([
			{ ...darkConstraints[0], source: 'example-dark' },
		]);

		const beforeValidate = await constraintsValidateCommand.handler(
			{ nodeId: 'example-dark' },
			context,
		);
		const afterValidate = await constraintsValidateCommand.handler(
			{ nodeId: 'example-dark' },
			imported,
		);
		const byTokenId = <T extends { tokenId: string }>(items: T[] | undefined) =>
			[...(items ?? [])].sort((a, b) =>
				a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0,
			);
		expect(afterValidate.data?.valid).toBe(beforeValidate.data?.valid);
		expect(afterValidate.data?.summary).toEqual(beforeValidate.data?.summary);
		expect(afterValidate.data?.disabled).toEqual(beforeValidate.data?.disabled);
		expect(byTokenId(afterValidate.data?.results)).toEqual(byTokenId(beforeValidate.data?.results));

		// Second export is byte-identical with dropped: []
		const second = await exportFiles(imported);
		expect(second.dropped).toEqual([]);
		expect(second.files).toEqual(first.files);
	});

	it('refuses stored constraints that import.tree would reject (#2330)', async () => {
		await context.db.setConstraints('example', [
			{
				id: 'bad-stored',
				name: 'Invalid stored rule',
				config: { type: 'pattern', pattern: '^(a+)+$' },
				severity: 'error',
				applyTo: 'color.*',
				enabled: true,
			},
		]);

		const result = await exportTreeCommand.handler({}, context);
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toContain('bad-stored');
		expect(result.error?.suggestion).toContain('constraints.set');
	});
});
