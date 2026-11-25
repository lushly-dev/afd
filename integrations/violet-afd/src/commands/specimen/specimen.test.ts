import { specimenRoleDeclaration } from '@lushly-dev/violet-core/css';
import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { specimenGetCommand } from './get.js';
import { specimenSetCommand } from './set.js';

describe('specimen.get and specimen.set (#118)', () => {
	let context: CommandContext;

	/** Write an operation straight to the store, past the commands' value checks */
	const storeUnchecked = async (
		nodeId: string,
		type: 'add' | 'override',
		tokenId: string,
		value: string,
	) => {
		const ops = await context.db.getOperations(nodeId);
		await context.db.addOperation({
			id: `unchecked-${nodeId}-${tokenId}`,
			nodeId,
			sequence: ops.length + 1,
			type,
			tokenId,
			value: JSON.stringify(value),
			metadata: null,
			fromNode: null,
			asTokenId: null,
			toAncestor: null,
			reason: null,
			author: null,
			createdAt: '2026-01-01T00:00:00.000Z',
		});
	};

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
			['global', 'color.surface.card', '#FAFAFA'],
			['product', 'btn.pad', '12px'],
			['mixin', 'color.focus.ring', '#000000'],
			['other', 'other.bg', '#000000'],
		]) {
			await tokenAddCommand.handler({ nodeId, tokenId, value }, context);
		}
		// A value no colour validator accepts, stored as a database made before writes
		// refused it (#1325) would hold it
		await storeUnchecked('theme', 'override', 'btn.bg', 'url(javascript:alert(1))');
	});

	it('draws from the components interface ids without a stored map (#1786)', async () => {
		const data = await get('product');
		expect(data).toMatchObject({
			rootId: 'global',
			map: {},
			stored: false,
			updatedAt: null,
			interface: { package: '@lushly-dev/violet-elements', contractVersion: 5 },
		});
		expect(data.components.map((entry) => [entry.component, entry.drawn])).toEqual([
			['button', false],
			['input', false],
			['card', true],
			['text', false],
			['link', false],
			['checkbox', false],
			// color.focus.ring comes from the mixin product includes
			['focus', true],
		]);
		expect(data.components.map((entry) => entry.element)).toEqual([
			'violet-button',
			'violet-text-field',
			'violet-card',
			'violet-text',
			null,
			'violet-checkbox',
			null,
		]);
		expect(role(data, 'card', 'background')).toEqual({
			role: 'background',
			tokenId: 'color.surface.card',
			source: 'interface',
			interfaceTokenId: 'color.surface.card',
			resolves: true,
			valid: true,
			value: '#FAFAFA',
		});
		// No interface id carries the button's border, so it is drawn only through a map
		expect(role(data, 'button', 'border')).toEqual({
			role: 'border',
			tokenId: null,
			source: 'unmapped',
			interfaceTokenId: null,
			resolves: false,
			valid: false,
		});
		// The old <component>.<role> convention is gone: card.radius is not read
		await tokenAddCommand.handler(
			{ nodeId: 'global', tokenId: 'card.radius', value: '4px' },
			context,
		);
		expect(role(await get('product'), 'card', 'radius')).toMatchObject({
			tokenId: 'radius.floating',
			resolves: false,
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
		// Roles the map leaves out keep the interface id
		expect(role(product, 'button', 'radius')).toMatchObject({
			tokenId: 'radius.control',
			source: 'interface',
			interfaceTokenId: 'radius.control',
			resolves: false,
			valid: false,
		});
		expect(role(product, 'button', 'background')).toMatchObject({
			interfaceTokenId: 'color.action.primary.background',
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
		expect(await code({ button: { border: 'color.focus.ring' } })).toBeUndefined();
		// Prototype keys are not roles
		expect(await code({ button: { constructor: 'btn.bg' } })).toBe('VALIDATION_ERROR');
		expect(await context.db.getSpecimenMap('other')).toBeNull();
	});

	it('draws the text block, link, checkbox and focus ring from the interface (#498, #1786)', async () => {
		for (const [tokenId, value] of [
			['color.text.primary', '#242424'],
			['font.family.body', 'Segoe UI, sans-serif'],
			['type.body.line', '1.5'],
			['color.accent.text', '#0F6CBD'],
			['link.underline', 'underline dotted 1px'],
			['link.offset', '0.2em'],
			['color.control.selected.background', '#FFFFFF'],
			['checkbox.box', '16px'],
			['size.focus-ring.width', '-2px'],
			['focus.offset', '-2px'],
		]) {
			await tokenAddCommand.handler({ nodeId: 'global', tokenId, value }, context);
		}
		await storeUnchecked(
			'global',
			'add',
			'color.control.selected.foreground',
			'url(javascript:alert(1))',
		);
		// Roles no interface id carries are drawn through the map
		await specimenSetCommand.handler(
			{
				nodeId: 'global',
				map: {
					link: { underline: 'link.underline', 'underline.offset': 'link.offset' },
					checkbox: { size: 'checkbox.box' },
					focus: { 'ring.offset': 'focus.offset' },
				},
			},
			context,
		);
		const data = await get('product');
		const component = (name: string) => data.components.find((entry) => entry.component === name);

		expect(component('text')).toMatchObject({ label: 'Text block', required: 'foreground' });
		expect(component('text')?.roles.map((entry) => entry.role)).toEqual([
			'background',
			'foreground',
			'padding.x',
			'padding.y',
			'font.size',
			'font.weight',
			'font.family',
			'line.height',
		]);
		expect(component('link')?.roles.map((entry) => entry.role)).toEqual([
			'foreground',
			'font.size',
			'font.weight',
			'underline',
			'underline.offset',
		]);
		expect(component('checkbox')?.roles.map((entry) => entry.role)).toEqual([
			'background',
			'border',
			'radius',
			'size',
			'check',
		]);
		expect(component('focus')).toMatchObject({ label: 'Focus ring', required: 'ring' });
		expect(component('focus')?.roles.map((entry) => entry.role)).toEqual([
			'background',
			'radius',
			'ring',
			'ring.width',
			'ring.offset',
		]);
		// The original components keep their ten roles
		expect(component('button')?.roles).toHaveLength(10);

		for (const name of ['text', 'link', 'checkbox', 'focus']) {
			expect(component(name)?.drawn, name).toBe(true);
		}
		for (const [name, roleName, source] of [
			['text', 'font.family', 'interface'],
			['text', 'line.height', 'interface'],
			['link', 'underline', 'map'],
			['link', 'underline.offset', 'map'],
			['checkbox', 'size', 'map'],
		]) {
			expect(role(data, name, roleName), `${name}.${roleName}`).toMatchObject({
				source,
				valid: true,
			});
		}
		// Resolves but fails the role's validator, so it is not drawn
		expect(role(data, 'checkbox', 'check')).toMatchObject({ resolves: true, valid: false });
		expect(role(data, 'focus', 'ring.width')).toMatchObject({ resolves: true, valid: false });
		// An outline offset may be negative; a width may not
		expect(role(data, 'focus', 'ring.offset')).toMatchObject({ resolves: true, valid: true });
		expect(role(data, 'focus', 'ring')).toMatchObject({
			tokenId: 'color.focus.ring',
			valid: true,
		});

		// Without the mixin, the root has no focus ring to draw
		const root = await get('global');
		expect(root.components.find((entry) => entry.component === 'focus')?.drawn).toBe(false);
	});

	it('maps the new components and their roles, and refuses roles they do not take (#498)', async () => {
		const set = await specimenSetCommand.handler(
			{
				nodeId: 'global',
				map: {
					text: { foreground: 'btn.fg', 'line.height': 'btn.corner' },
					link: { foreground: 'btn.bg', underline: 'btn.fg' },
					checkbox: { background: 'btn.fg', check: 'btn.bg', size: 'btn.corner' },
					focus: { ring: 'btn.bg', 'ring.width': 'btn.corner', 'ring.offset': 'btn.corner' },
				},
			},
			context,
		);
		expect(set.success).toBe(true);
		expect(set.data?.changed).toEqual([
			'checkbox.background',
			'checkbox.check',
			'checkbox.size',
			'focus.ring',
			'focus.ring.offset',
			'focus.ring.width',
			'link.foreground',
			'link.underline',
			'text.foreground',
			'text.line.height',
		]);
		// btn.fg (#FFFFFF) is not an underline
		expect(set.warnings?.map((warning) => warning.details)).toEqual([
			{ component: 'link', role: 'underline', tokenId: 'btn.fg' },
		]);

		const data = await get('global');
		expect(role(data, 'focus', 'ring.width')).toMatchObject({
			tokenId: 'btn.corner',
			source: 'map',
			valid: true,
		});
		expect(role(data, 'link', 'underline')).toMatchObject({ source: 'map', valid: false });
		expect(data.components.find((entry) => entry.component === 'focus')?.drawn).toBe(true);

		// A role another component takes is refused, with the component's roles as the suggestion
		const wrong = await specimenSetCommand.handler(
			{ nodeId: 'global', map: { button: { ring: 'btn.bg' }, link: { check: 'btn.bg' } } },
			context,
		);
		expect(wrong.error).toMatchObject({
			code: 'VALIDATION_ERROR',
			message: 'Role(s) the component does not take: button.ring, link.check',
		});
		expect(wrong.error?.suggestion).toContain('link roles are: foreground, font.size');
		expect(wrong.error?.suggestion).toContain('button roles are: background, foreground');
		const unknown = await specimenSetCommand.handler(
			{ nodeId: 'global', map: { checkbox: { glow: 'btn.bg' } } },
			context,
		);
		expect(unknown.error?.code).toBe('VALIDATION_ERROR');
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
