/**
 * @fileoverview interface.check: every id of a component interface resolves in each theme node (#1323)
 */

import { existsSync, readFileSync } from 'node:fs';
import { type ResolvedToken, cssTransformer } from '@lushly-dev/violet-core';
import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import { type CommandContext, CommandRegistry } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { tokenOverrideCommand } from '../token/override.js';
import { interfaceCheckCommand } from './interface.js';

const INTERFACE = {
	contractVersion: 2,
	package: '@lushly-dev/violet-elements',
	tokens: {
		'color.surface.page': { property: '--color-surface-page', type: 'color' },
		'color.text.primary': { property: '--color-text-primary', type: 'color' },
		'size.focus.width': { property: '--size-focus-width', type: 'dimension' },
	},
};

describe('interface.check command', () => {
	let context: CommandContext;

	const check = async (input: Record<string, unknown> = {}) => {
		const result = await interfaceCheckCommand.handler(
			{ interface: INTERFACE, ...input } as never,
			context,
		);
		if (!result.success || !result.data) throw new Error(result.error?.message);
		return result.data;
	};

	beforeEach(async () => {
		context = { db: createMemoryDatabase(), actor: 'test' };
		await nodeCreateCommand.handler(
			{ id: 'example', name: 'example', type: 'product', parentId: null },
			context,
		);
		for (const theme of ['light', 'dark']) {
			await nodeCreateCommand.handler(
				{ id: `example-${theme}`, name: `example-${theme}`, type: 'theme', parentId: 'example' },
				context,
			);
		}
		await tokenAddCommand.handler(
			{ nodeId: 'example', tokenId: 'color.surface.page', value: '#ffffff' },
			context,
		);
		await tokenAddCommand.handler(
			{ nodeId: 'example', tokenId: 'size.focus.width', value: '2px' },
			context,
		);
	});

	it('lists each id a theme node does not resolve', async () => {
		const data = await check();
		expect(data.interface).toEqual({ version: 2, package: '@lushly-dev/violet-elements' });
		expect(data.complete).toBe(false);
		expect(data.nodes).toEqual(['example-dark', 'example-light']);
		expect(data.missing).toEqual([
			{ node: 'example-dark', token: 'color.text.primary', reason: 'absent' },
			{ node: 'example-light', token: 'color.text.primary', reason: 'absent' },
		]);
		expect(data.invalid).toEqual([]);
	});

	it('is complete once every id resolves in every theme', async () => {
		await tokenAddCommand.handler(
			{ nodeId: 'example', tokenId: 'color.text.primary', value: '#1b1b1f' },
			context,
		);
		const data = await check();
		expect(data.complete).toBe(true);
		expect(data.missing).toEqual([]);
	});

	it('counts an id that resolves only through a broken reference as missing', async () => {
		await tokenAddCommand.handler(
			{ nodeId: 'example-dark', tokenId: 'color.text.primary', value: { ref: 'color.gone' } },
			context,
		);
		const data = await check({ nodes: ['example-dark'] });
		expect(data.missing).toEqual([
			{ node: 'example-dark', token: 'color.text.primary', reason: 'broken-reference' },
		]);
	});

	it('reports a value the interface type cannot hold', async () => {
		await tokenAddCommand.handler(
			{ nodeId: 'example', tokenId: 'color.text.primary', value: '#1b1b1f' },
			context,
		);
		// An untyped token takes any safe value; the interface says it must be a length
		await tokenOverrideCommand.handler(
			{ nodeId: 'example-dark', tokenId: 'size.focus.width', value: 'thick' },
			context,
		);
		const data = await check();
		expect(data.complete).toBe(false);
		expect(data.invalid).toEqual([
			{
				node: 'example-dark',
				token: 'size.focus.width',
				type: 'dimension',
				problem: expect.stringContaining('is not one length'),
			},
		]);
	});

	it('checks every node when the tree has no theme node', async () => {
		const bare: CommandContext = { db: createMemoryDatabase(), actor: 'test' };
		await nodeCreateCommand.handler({ name: 'solo', type: 'root', parentId: null }, bare);
		const result = await interfaceCheckCommand.handler({ interface: INTERFACE }, bare);
		expect(result.data?.nodes).toEqual(['solo']);
		expect(result.data?.missing).toHaveLength(3);
	});

	it('refuses an unknown node', async () => {
		const result = await interfaceCheckCommand.handler(
			{ interface: INTERFACE, nodes: ['nope'] },
			context,
		);
		expect(result.error?.code).toBe('NODE_NOT_FOUND');
	});

	it('refuses an input that is not an interface', async () => {
		const registry = new CommandRegistry();
		registry.register(interfaceCheckCommand);
		const result = await registry.execute(
			'interface.check',
			{ interface: { tokens: {} } },
			context,
		);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
	});

	// The interface violet-elements publishes, read as it is
	const published = new URL(
		'../../../../../foundations/fast-af/packages/violet-elements/tokens/interface.json',
		import.meta.url,
	);
	it.skipIf(!existsSync(published))('reads violet-elements’ published interface', async () => {
		const tokenInterface = JSON.parse(readFileSync(published, 'utf8'));
		const result = await interfaceCheckCommand.handler({ interface: tokenInterface }, context);
		expect(result.success).toBe(true);
		const ids = Object.keys(tokenInterface.tokens);
		expect(result.data?.interface.version).toBe(tokenInterface.contractVersion);
		// Two theme nodes, each missing every id but the two the product adds
		const present = ids.filter((id) => id === 'color.surface.page' || id === 'size.focus.width');
		expect(result.data?.missing).toHaveLength(2 * (ids.length - present.length));
	});

	// Target item 3: Violet's own output drives the components with no remapping
	it.skipIf(!existsSync(published))(
		'is what violet-core’s CSS exporter writes under the interface’s cssPrefix',
		() => {
			const tokenInterface: {
				cssPrefix: string;
				tokens: Record<string, { property: string }>;
			} = JSON.parse(readFileSync(published, 'utf8'));
			expect(tokenInterface.cssPrefix).toBe('violet');
			const ids = Object.keys(tokenInterface.tokens);
			const css = cssTransformer.transform(
				ids.map(
					(id) =>
						({
							id,
							value: '1px',
							resolvedValue: '1px',
							metadata: {
								category: 'custom',
								tier: 'semantic',
								status: 'stable',
								platforms: [],
								tags: [],
							},
							resolvedAt: 'test',
							inheritanceChain: ['test'],
						}) as unknown as ResolvedToken,
				),
				{ prefix: tokenInterface.cssPrefix },
			);
			const written = [...css.matchAll(/^\s*(--[A-Za-z0-9_-]+):/gm)].map((match) => match[1]);
			expect(written.sort()).toEqual(ids.map((id) => tokenInterface.tokens[id]?.property).sort());
		},
	);
});
