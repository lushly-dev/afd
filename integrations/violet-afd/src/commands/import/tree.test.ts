import { createMemoryDatabase, initializeExport } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { listCommand as constraintsListCommand } from '../constraints/list.js';
import { validateCommand as constraintsValidateCommand } from '../constraints/validate.js';
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
		// portability-ok: Synthetic Windows path verifies cross-platform file-name parsing.
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

	describe('node constraints (#2330)', () => {
		it('restores constraints from $extensions["dev.lushly.violet"].constraints onto each node', async () => {
			const files = [
				file(
					'base.tokens.json',
					{
						color: {
							$type: 'color',
							bg: { $value: '#FFFFFF' },
							text: { $value: '#CCCCCC' },
						},
					},
					{
						type: 'root',
						constraints: [
							{
								id: 'text-contrast',
								name: 'Text contrast',
								applyTo: 'color.text',
								severity: 'error',
								enabled: true,
								config: { type: 'contrast', against: 'color.bg', min: 4.5 },
							},
						],
					},
				),
				file(
					'dark.tokens.json',
					{ color: { bg: { $value: '#111111' } } },
					{
						parent: 'base',
						type: 'theme',
						constraints: [
							{
								id: 'space-ramp',
								name: 'Space ramp',
								applyTo: 'space.*',
								severity: 'warning',
								enabled: false,
								disabledReason: 'Waiting on scale audit',
								config: {
									type: 'ramp',
									ramp: 'ref.space.*',
									requireOffRampReason: true,
									repeatThreshold: 2,
								},
							},
						],
					},
				),
			];

			const result = await importTreeCommand.handler({ files }, context);
			expect(result.success, JSON.stringify(result.error)).toBe(true);

			const listed = await constraintsListCommand.handler({ nodeId: 'dark' }, context);
			expect(listed.success).toBe(true);
			expect(listed.data?.constraints).toEqual([
				expect.objectContaining({
					id: 'text-contrast',
					source: 'base',
					applyTo: 'color.text',
					severity: 'error',
					enabled: true,
					config: { type: 'contrast', against: 'color.bg', min: 4.5 },
				}),
				expect.objectContaining({
					id: 'space-ramp',
					source: 'dark',
					applyTo: 'space.*',
					severity: 'warning',
					enabled: false,
					disabledReason: 'Waiting on scale audit',
					config: {
						type: 'ramp',
						ramp: 'ref.space.*',
						requireOffRampReason: true,
						repeatThreshold: 2,
					},
				}),
			]);

			const validated = await constraintsValidateCommand.handler({ nodeId: 'base' }, context);
			expect(validated.success).toBe(true);
			expect(validated.data?.valid).toBe(false);
			expect(validated.data?.summary.errors).toBe(1);
		});

		it('fails closed with VALIDATION_ERROR on invalid constraints before creating any node', async () => {
			const invalidCases: Array<{ name: string; constraints: unknown }> = [
				{ name: 'non-array', constraints: 'not-an-array' },
				{
					name: 'missing applyTo',
					constraints: [
						{ id: 'c1', name: 'Bad', config: { type: 'contrast', against: 'color.bg', min: 4.5 } },
					],
				},
				{
					name: 'unknown config type',
					constraints: [{ id: 'c1', name: 'Bad', applyTo: 'color.*', config: { type: 'unknown' } }],
				},
				{
					name: 'duplicate ids',
					constraints: [
						{
							id: 'dup',
							name: 'One',
							applyTo: 'color.*',
							config: { type: 'enum', values: ['#fff'] },
						},
						{
							id: 'dup',
							name: 'Two',
							applyTo: 'color.*',
							config: { type: 'enum', values: ['#000'] },
						},
					],
				},
				{
					name: 'disabledReason on enabled rule',
					constraints: [
						{
							id: 'c1',
							name: 'Enabled with reason',
							applyTo: 'color.*',
							enabled: true,
							disabledReason: 'Should fail',
							config: { type: 'enum', values: ['#fff'] },
						},
					],
				},
				{
					name: 'catastrophic regex pattern',
					constraints: [
						{
							id: 'redos',
							name: 'Nested quantifier',
							applyTo: 'color.*',
							config: { type: 'pattern', pattern: '^(a+)+$' },
						},
					],
				},
				{
					name: 'empty ramp glob',
					constraints: [
						{
							id: 'empty-ramp',
							name: 'Empty ramp',
							applyTo: 'space.*',
							config: { type: 'ramp', ramp: '   ' },
						},
					],
				},
				{
					name: 'repeatThreshold below 2',
					constraints: [
						{
							id: 'low-threshold',
							name: 'Low threshold',
							applyTo: 'space.*',
							config: { type: 'ramp', ramp: 'ref.space.*', repeatThreshold: 1 },
						},
					],
				},
				{
					name: 'unknown nested config field (minimum instead of min)',
					constraints: [
						{
							id: 'typo-min',
							name: 'Contrast typo',
							applyTo: 'color.text.*',
							config: { type: 'contrast', against: 'color.bg', minimum: 7 },
						},
					],
				},
				{
					name: 'unknown top-level constraint field',
					constraints: [
						{
							id: 'extra-top',
							name: 'Extra field',
							applyTo: 'color.*',
							unknownField: true,
							config: { type: 'enum', values: ['#fff'] },
						},
					],
				},
				{
					name: 'unknown nested ramp pairWith field',
					constraints: [
						{
							id: 'extra-pair',
							name: 'Extra pairWith',
							applyTo: 'type.*',
							config: {
								type: 'ramp',
								ramp: 'ref.type.*',
								pairWith: {
									fromSuffix: '.size',
									toSuffix: '.line',
									rampTarget: 'ref.type.*.line',
									extra: 'nope',
								},
							},
						},
					],
				},
				{
					name: 'unknown nested ramp warnUneven field',
					constraints: [
						{
							id: 'extra-uneven',
							name: 'Extra warnUneven',
							applyTo: 'radius.*',
							config: {
								type: 'ramp',
								ramp: 'ref.radius.*',
								warnUneven: {
									maxRatioSpread: 1.5,
									ignoreOver: 1000,
								},
							},
						},
					],
				},
				{
					name: 'invalid ramp warnUneven maxRatioSpread <= 1',
					constraints: [
						{
							id: 'bad-uneven',
							name: 'Bad warnUneven spread',
							applyTo: 'radius.*',
							config: {
								type: 'ramp',
								ramp: 'ref.radius.*',
								warnUneven: {
									maxRatioSpread: 1,
								},
							},
						},
					],
				},
			];

			for (const testCase of invalidCases) {
				const fresh: CommandContext = { db: createMemoryDatabase(), actor: 'test' };
				const res = await importTreeCommand.handler(
					{
						files: [
							file('valid.tokens.json', { color: { $type: 'color', bg: { $value: '#ffffff' } } }),
							file(
								'invalid.tokens.json',
								{ color: { bg: { $value: '#111111' } } },
								{ parent: 'valid', type: 'theme', constraints: testCase.constraints },
							),
						],
					},
					fresh,
				);
				expect(res.success, testCase.name).toBe(false);
				expect(res.error?.code, testCase.name).toBe('VALIDATION_ERROR');
				expect(res.error?.suggestion, testCase.name).toBeTruthy();
				// All-or-nothing: valid.tokens.json must not have been created either
				expect(await fresh.db.listNodes(), testCase.name).toEqual([]);
			}
		});
	});
});
