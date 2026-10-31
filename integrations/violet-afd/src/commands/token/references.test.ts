import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { parseReference } from '@lushly-dev/violet-core/engine';
import type { TokenValue } from '@lushly-dev/violet-core/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokenOverrideCommand } from './override.js';
import { tokensResolveCommand } from './resolve.js';

describe('token references', () => {
	let context: CommandContext;

	const add = (nodeId: string, tokenId: string, value: TokenValue) =>
		tokenAddCommand.handler({ nodeId, tokenId, value }, context);

	const resolve = async (nodeId: string) => {
		const result = await tokensResolveCommand.handler({ nodeId }, context);
		expect(result.success).toBe(true);
		return { result, byId: new Map(result.data?.tokens.map((t) => [t.id, t])) };
	};

	beforeEach(async () => {
		context = { db: createMemoryDatabase(), actor: 'test', traceId: 'test-trace' };
		await nodeCreateCommand.handler({ name: 'base', type: 'root', parentId: null }, context);
		await nodeCreateCommand.handler({ name: 'dark', type: 'theme', parentId: 'base' }, context);
	});

	it('follows { ref } objects and DTCG aliases', async () => {
		await add('base', 'color.blue.500', '#0078D4');
		await add('base', 'color.primary', { ref: 'color.blue.500' });
		await add('base', 'color.link', '{color.primary}');

		const { byId } = await resolve('base');
		expect(byId.get('color.primary')).toMatchObject({
			value: { ref: 'color.blue.500' },
			resolvedValue: '#0078D4',
			aliasOf: 'color.blue.500',
		});
		expect(byId.get('color.link')).toMatchObject({
			value: '{color.primary}',
			resolvedValue: '#0078D4',
			aliasOf: 'color.primary',
		});
		expect(byId.get('color.blue.500')?.aliasOf).toBeUndefined();
	});

	it("resolves aliases in the resolved node's context", async () => {
		await add('base', 'color.blue.500', '#0078D4');
		await add('base', 'color.primary', '{color.blue.500}');
		await tokenOverrideCommand.handler(
			{ nodeId: 'dark', tokenId: 'color.blue.500', value: '#4DA3FF' },
			context,
		);

		expect((await resolve('base')).byId.get('color.primary')?.resolvedValue).toBe('#0078D4');
		expect((await resolve('dark')).byId.get('color.primary')?.resolvedValue).toBe('#4DA3FF');
	});

	it('follows references nested in composite values', async () => {
		await add('base', 'color.shadow', '#00000033');
		await add('base', 'shadow.card', { x: 0, y: 2, blur: 4, color: '{color.shadow}' });

		const { byId } = await resolve('base');
		expect(byId.get('shadow.card')?.finalValue).toEqual({
			x: 0,
			y: 2,
			blur: 4,
			color: '#00000033',
		});
		expect(byId.get('shadow.card')?.aliasOf).toBeUndefined();
	});

	it('leaves strings that only contain braces alone', async () => {
		await add('base', 'font.family', 'Fira {Code}, monospace');
		expect((await resolve('base')).byId.get('font.family')?.resolvedValue).toBe(
			'Fira {Code}, monospace',
		);
	});

	it('flags a missing reference without failing resolve', async () => {
		await add('base', 'color.primary', '{color.nope}');

		const { result, byId } = await resolve('base');
		expect(byId.get('color.primary')).toMatchObject({
			resolvedValue: '{color.nope}',
			referenceError: {
				code: 'TOKEN_REFERENCE_NOT_FOUND',
				path: ['color.primary', 'color.nope'],
			},
		});
		expect(result.warnings?.[0]?.code).toBe('TOKEN_REFERENCE_NOT_FOUND');
	});

	it('flags circular references', async () => {
		await add('base', 'a', '{b}');
		await add('base', 'b', { ref: 'c' });
		await add('base', 'c', '{a}');
		await add('base', 'd', '{a}');

		const { byId } = await resolve('base');
		expect(byId.get('a')?.referenceError).toMatchObject({
			code: 'CIRCULAR_REFERENCE',
			path: ['a', 'b', 'c', 'a'],
		});
		expect(byId.get('d')?.referenceError?.code).toBe('CIRCULAR_REFERENCE');
	});

	it('flags reference transforms as not implemented', async () => {
		await add('base', 'space.1', 4);
		await add('base', 'space.2', { ref: 'space.1', transform: 'multiply(2)' });

		const { byId } = await resolve('base');
		expect(byId.get('space.2')?.referenceError?.code).toBe('NOT_IMPLEMENTED');
	});

	it('parses only whole-value references', () => {
		expect(parseReference('{a.b}')).toEqual({ ref: 'a.b' });
		expect(parseReference({ ref: 'a.b' })).toEqual({ ref: 'a.b' });
		expect(parseReference({ ref: 'a', transform: 'add(1)' })).toEqual({
			ref: 'a',
			transform: 'add(1)',
		});
		expect(parseReference('1px solid {a.b}')).toBeNull();
		expect(parseReference({ ref: 'a', extra: 1 })).toBeNull();
		expect(parseReference(4)).toBeNull();
	});
});
