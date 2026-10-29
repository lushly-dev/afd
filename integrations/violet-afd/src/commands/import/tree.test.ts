import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { initializeExport } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { exportCommand } from '../export/export.js';
import type { CommandContext } from '../registry.js';
import { tokensResolveCommand } from '../token/resolve.js';
import { importTreeCommand, nodeIdFromFileName } from './tree.js';

const file = (name: string, tokens: Record<string, unknown>, violet?: Record<string, unknown>) => ({
	name,
	content: JSON.stringify(
		violet ? { $extensions: { 'dev.lushly.violet': violet }, ...tokens } : tokens,
	),
});

// afd-site -> vintage -> vintage-dark / vintage-parchment, listed out of order
const vintageFiles = [
	file(
		'themes/vintage-dark.tokens.json',
		{ color: { bg: { $value: '#1A1612' } } },
		{ parent: 'vintage', type: 'theme' },
	),
	file(
		'afd-site.tokens.json',
		{
			color: {
				$type: 'color',
				bg: { $value: '#FFFFFF' },
				fg: { $value: '#000000', $description: 'Body text' },
			},
		},
		{ type: 'root' },
	),
	file(
		'themes/vintage-parchment.tokens.json',
		{ color: { bg: { $value: '#F4ECD8' } } },
		{ parent: 'vintage', type: 'theme' },
	),
	file(
		'vintage.json',
		{ color: { accent: { $type: 'color', $value: '#8B4513' } } },
		{ parent: 'afd-site', type: 'product' },
	),
];

describe('import.tree command', () => {
	let context: CommandContext;

	beforeEach(() => {
		initializeExport();
		context = { db: createMemoryDatabase(), actor: 'test', traceId: 'test-trace' };
	});

	it('builds the tree parent-first regardless of file order', async () => {
		const result = await importTreeCommand.handler({ files: vintageFiles }, context);

		expect(result.success).toBe(true);
		const ids = result.data?.nodes.map((n) => n.id) ?? [];
		expect(ids.indexOf('afd-site')).toBeLessThan(ids.indexOf('vintage'));
		expect(ids.indexOf('vintage')).toBeLessThan(ids.indexOf('vintage-dark'));
		expect(ids.indexOf('vintage')).toBeLessThan(ids.indexOf('vintage-parchment'));
		expect(await context.db.getNode('vintage-dark')).toMatchObject({
			parentId: 'vintage',
			type: 'theme',
		});
	});

	it('resolves inherited and overridden tokens per theme', async () => {
		await importTreeCommand.handler({ files: vintageFiles }, context);

		const resolved = await tokensResolveCommand.handler({ nodeId: 'vintage-dark' }, context);
		const byId = new Map(resolved.data?.tokens.map((t) => [t.id, t]));
		expect(byId.get('color.bg')?.resolvedValue).toBe('#1A1612');
		expect(byId.get('color.fg')?.resolvedValue).toBe('#000000');
		expect(byId.get('color.fg')?.metadata.description).toBe('Body text');
		expect(byId.get('color.accent')?.resolvedValue).toBe('#8B4513');
	});

	it('exports a theme to CSS with a custom selector', async () => {
		await importTreeCommand.handler({ files: vintageFiles }, context);

		const result = await exportCommand.handler(
			{ nodeId: 'vintage-parchment', format: 'css', selector: '[data-theme="vintage-parchment"]' },
			context,
		);
		expect(result.data?.content).toContain('[data-theme="vintage-parchment"] {');
		expect(result.data?.content).toContain('--color-bg: #F4ECD8;');
		expect(result.data?.content).toContain('--color-accent: #8B4513;');
	});

	it('resolves a semantic alias against the primitive a theme overrides', async () => {
		const files = [
			file(
				'afd-site.tokens.json',
				{
					color: {
						$type: 'color',
						brown: { 500: { $value: '#8B4513' } },
						accent: { $value: '{color.brown.500}' },
						button: { bg: { $value: '{color.accent}' } },
					},
				},
				{ type: 'root' },
			),
			file('vintage.json', {}, { parent: 'afd-site', type: 'product' }),
			file(
				'vintage-dark.json',
				{ color: { brown: { 500: { $value: '#C4824A' } } } },
				{ parent: 'vintage', type: 'theme' },
			),
		];
		await importTreeCommand.handler({ files }, context);

		const base = await exportCommand.handler({ nodeId: 'vintage', format: 'css' }, context);
		expect(base.data?.content).toContain('--color-accent: #8B4513;');
		expect(base.data?.content).toContain('--color-button-bg: #8B4513;');

		const dark = await exportCommand.handler({ nodeId: 'vintage-dark', format: 'css' }, context);
		expect(dark.data?.content).toContain('--color-accent: #C4824A;');
		expect(dark.data?.content).toContain('--color-button-bg: #C4824A;');
		expect(dark.data?.content).not.toContain('{color');

		const lua = await exportCommand.handler(
			{ nodeId: 'vintage-dark', format: 'lua', themeMap: { accent: 'color.accent' } },
			context,
		);
		expect(lua.success).toBe(true);
		expect(lua.data?.content).toMatch(/accent = \{ 0\.7/);
	});

	it('fails when a parent is missing', async () => {
		const result = await importTreeCommand.handler(
			{ files: [file('dark.json', {}, { parent: 'nope' })] },
			context,
		);
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('INVALID_PARENT');
	});

	it('fails on a parent cycle', async () => {
		const result = await importTreeCommand.handler(
			{ files: [file('a.json', {}, { parent: 'b' }), file('b.json', {}, { parent: 'a' })] },
			context,
		);
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('CIRCULAR_REFERENCE');
	});

	it('fails when two files define the same node', async () => {
		const result = await importTreeCommand.handler(
			{ files: [file('a/base.json', {}), file('b/base.tokens.json', {})] },
			context,
		);
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('NODE_ALREADY_EXISTS');
	});

	it('derives node IDs from file names', () => {
		expect(nodeIdFromFileName('themes/vintage-dark.tokens.json')).toBe('vintage-dark');
		expect(nodeIdFromFileName('C:\\tokens\\base.json')).toBe('base');
	});

	describe('tier groups', () => {
		// Vintage's layout: tokens grouped by tier, IDs and aliases without the tier
		const tieredTokens = {
			global: { color: { gold: { 300: { $type: 'color', $value: '#d4af37' } } } },
			semantic: { color: { accent: { primary: { $value: '{color.gold.300}' } } } },
			component: { button: { primary: { bg: { $value: '{color.accent.primary}' } } } },
		};

		it('drops the tier from IDs, stores it as metadata, and resolves aliases across tiers', async () => {
			const result = await importTreeCommand.handler(
				{ files: [file('vintage.tokens.json', tieredTokens, { tiers: true })] },
				context,
			);
			expect(result.success).toBe(true);

			const resolved = await tokensResolveCommand.handler({ nodeId: 'vintage' }, context);
			const byId = new Map(resolved.data?.tokens.map((t) => [t.id, t]));
			expect([...byId.keys()].sort()).toEqual([
				'button.primary.bg',
				'color.accent.primary',
				'color.gold.300',
			]);
			expect(byId.get('color.gold.300')?.metadata).toMatchObject({ tier: 'global', type: 'color' });
			expect(byId.get('color.accent.primary')?.metadata.tier).toBe('semantic');
			expect(byId.get('button.primary.bg')?.metadata.tier).toBe('component');

			const css = await exportCommand.handler({ nodeId: 'vintage', format: 'css' }, context);
			expect(css.success).toBe(true);
			expect(css.data?.content).toContain('--button-primary-bg: #d4af37;');
			expect(css.data?.content).not.toContain('--semantic-');
		});

		it('keeps tier names as ID segments without the opt-in', async () => {
			await importTreeCommand.handler(
				{
					files: [
						file('vintage.tokens.json', {
							global: { color: { gold: { $value: '#d4af37' } } },
						}),
					],
				},
				context,
			);
			const resolved = await tokensResolveCommand.handler({ nodeId: 'vintage' }, context);
			expect(resolved.data?.tokens.map((t) => t.id)).toEqual(['global.color.gold']);
		});

		it('fails when the same ID is in two tiers', async () => {
			const result = await importTreeCommand.handler(
				{
					files: [
						file(
							'vintage.tokens.json',
							{
								global: { color: { accent: { $value: '#d4af37' } } },
								semantic: { color: { accent: { $value: '#000000' } } },
							},
							{ tiers: true },
						),
					],
				},
				context,
			);
			expect(result.success).toBe(false);
			expect(result.error?.message).toContain('color.accent');
		});
	});
});
