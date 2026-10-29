import { specimenRoleDeclaration } from '@lushly-dev/violet-core/css';
import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { tokenOverrideCommand } from '../token/override.js';
import { specimenGetCommand } from './get.js';
import { specimenSetCommand } from './set.js';

describe('specimen.get and specimen.set (#118)', () => {
	let context: CommandContext;

	const get = async (nodeId: string) => {
		const result = await specimenGetCommand.handler({ nodeId }, context);
		if (!result.success || !result.data) throw new Error(result.error?.message);
		return result.data;
	};
	const role = (data: Awaited<ReturnType<typeof get>>, component: string, name: string) =>
		data.components
			.find((entry) => entry.component === component)
			?.roles.find((r) => r.role === name);

	beforeEach(async () => {
		context = { db: createMemoryDatabase(), actor: 'designer' };
		// global -> product -> theme; a mixin root other trees can include; a second tree
		await nodeCreateCommand.handler({ name: 'mixin', parentId: null }, context);
		await nodeCreateCommand.handler({ name: 'global', parentId: null }, context);
		await nodeCreateCommand.handler(
			{ name: 'product', parentId: 'global', includes: ['mixin'] },
			context,
		);
		await nodeCreateCommand.handler({ name: 'theme', parentId: 'product' }, context);
		await nodeCreateCommand.handler({ name: 'other', parentId: null }, context);
		for (const [nodeId, tokenId, value] of [
			['global', 'btn.bg', '#0F6CBD'],
			['global', 'btn.fg', '#FFFFFF'],
			['global', 'btn.corner', '4px'],
			['global', 'card.background', '#FAFAFA'],
			['product', 'btn.pad', '12px'],
			['mixin', 'focus.ring', '#000000'],
			['other', 'other.bg', '#000000'],
		]) {
			await tokenAddCommand.handler({ nodeId, tokenId, value }, context);
		}
		// A value no colour validator accepts
		await tokenOverrideCommand.handler(
			{ nodeId: 'theme', tokenId: 'btn.bg', value: 'url(javascript:alert(1))' },
			context,
		);
	});

	it('falls back to the naming convention without a stored map', async () => {
		const data = await get('product');
		expect(data).toMatchObject({ rootId: 'global', map: {}, stored: false, updatedAt: null });
		expect(data.components.map((entry) => [entry.component, entry.drawn])).toEqual([
			['button', false],
			['input', false],
			['card', true],
		]);
		expect(role(data, 'card', 'background')).toEqual({
			role: 'background',
			tokenId: 'card.background',
			source: 'convention',
			resolves: true,
			valid: true,
			value: '#FAFAFA',
		});
	});

	it('stores a map on the tree root and draws from it on every node', async () => {
		const set = await specimenSetCommand.handler(
			{
				nodeId: 'theme',
				map: { button: { background: 'btn.bg', foreground: 'btn.fg', 'padding.x': 'btn.pad' } },
			},
			context,
		);
		expect(set.success).toBe(true);
		expect(set.data).toMatchObject({
			rootId: 'global',
			changed: ['button.background', 'button.foreground', 'button.padding.x'],
		});

		const product = await get('product');
		expect(product).toMatchObject({ stored: true, updatedBy: 'designer' });
		expect(product.components[0].drawn).toBe(true);
		expect(role(product, 'button', 'background')).toMatchObject({
			tokenId: 'btn.bg',
			source: 'map',
			valid: true,
		});
		// Unmapped roles keep the convention
		expect(role(product, 'button', 'radius')).toMatchObject({
			tokenId: 'button.radius',
			source: 'convention',
			resolves: false,
			valid: false,
		});
		// btn.pad is defined on product, so it does not resolve on the root
		expect(role(await get('global'), 'button', 'padding.x')).toMatchObject({ resolves: false });

		// The theme's background fails the colour validator, so the button is not drawn there
		const theme = await get('theme');
		expect(role(theme, 'button', 'background')).toMatchObject({ resolves: true, valid: false });
		expect(theme.components[0].drawn).toBe(false);
		expect(specimenRoleDeclaration('background', 'url(javascript:alert(1))')).toBeNull();

		const audit = await context.db.getAuditEvents({ targetNode: 'global' });
		const event = audit.find((entry) => entry.eventType === 'specimen_map_updated');
		expect(event?.actor).toBe('designer');
		expect(JSON.parse(event?.metadata ?? '{}').changed).toHaveLength(3);
	});

	it('merges by default, removes roles with null and replaces on request', async () => {
		await specimenSetCommand.handler(
			{ nodeId: 'global', map: { button: { background: 'btn.bg', radius: 'btn.corner' } } },
			context,
		);
		const merged = await specimenSetCommand.handler(
			{ nodeId: 'global', map: { button: { radius: null }, card: { background: 'btn.fg' } } },
			context,
		);
		expect(merged.data?.map).toEqual({
			button: { background: 'btn.bg' },
			card: { background: 'btn.fg' },
		});
		expect(merged.data?.changed).toEqual(['button.radius', 'card.background']);

		const same = await specimenSetCommand.handler(
			{ nodeId: 'global', map: { button: { background: 'btn.bg' } } },
			context,
		);
		expect(same.data?.changed).toEqual([]);

		const replaced = await specimenSetCommand.handler(
			{ nodeId: 'global', map: { input: { border: 'btn.fg' } }, replace: true },
			context,
		);
		expect(replaced.data?.map).toEqual({ input: { border: 'btn.fg' } });

		const removed = await specimenSetCommand.handler(
			{ nodeId: 'global', map: {}, replace: true },
			context,
		);
		expect(removed.data).toMatchObject({ map: {}, updatedAt: null });
		expect(await context.db.getSpecimenMap('global')).toBeNull();
	});

	it('maps only known components, roles and tokens defined in the tree or its mix-ins', async () => {
		const code = async (map: Record<string, Record<string, string | null>>) =>
			(await specimenSetCommand.handler({ nodeId: 'product', map }, context)).error?.code;

		expect(await code({ toggle: { background: 'btn.bg' } })).toBe('VALIDATION_ERROR');
		expect(await code({ button: { glow: 'btn.bg' } })).toBe('VALIDATION_ERROR');
		expect(await code({ button: { background: 'btn.missing' } })).toBe('TOKEN_NOT_FOUND');
		// Another tree's token is not known here
		expect(await code({ button: { background: 'other.bg' } })).toBe('TOKEN_NOT_FOUND');
		// A mixed-in node's token is
		expect(await code({ button: { border: 'focus.ring' } })).toBeUndefined();
		// Prototype keys are not roles
		expect(await code({ button: { constructor: 'btn.bg' } })).toBe('VALIDATION_ERROR');
		expect(await context.db.getSpecimenMap('other')).toBeNull();
	});

	it('warns when a mapped value fails its role on the root', async () => {
		const result = await specimenSetCommand.handler(
			{ nodeId: 'global', map: { button: { radius: 'btn.bg' } } },
			context,
		);
		expect(result.success).toBe(true);
		expect(result.warnings?.map((warning) => warning.code)).toEqual(['ROLE_VALUE_INVALID']);
	});

	it('fails for an unknown node', async () => {
		expect((await specimenGetCommand.handler({ nodeId: 'nope' }, context)).error?.code).toBe(
			'NODE_NOT_FOUND',
		);
		expect(
			(await specimenSetCommand.handler({ nodeId: 'nope', map: {} }, context)).error?.code,
		).toBe('NODE_NOT_FOUND');
	});
});
