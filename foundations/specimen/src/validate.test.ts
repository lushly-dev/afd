import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defaultContext } from './config.js';
import { parseDesignStatesRequest } from './design-validate.js';
import { packIdentifier } from './pack-schema.js';
import { parsePanelWalkRequest } from './panel-validate.js';
import { implementationContextsSchema, patternSetupBindingSchema } from './pattern-schema.js';
import {
	a11yRequestSchema,
	baselineRequestSchema,
	captureRequestSchema,
	captureSetRequestSchema,
	checkpointsRequestSchema,
	compareRequestSchema,
	contextSchema,
	contractRequestSchema,
	coverageRequestSchema,
	decisionCheckRequestSchema,
	decisionGetRequestSchema,
	decisionListRequestSchema,
	decisionRecordRequestSchema,
	designStatesRequestSchema,
	jobConfigSchema,
	jobCreateRequestSchema,
	jobRunRequestSchema,
	matrixRequestSchema,
	noteAddRequestSchema,
	noteCheckRequestSchema,
	noteListRequestSchema,
	noteMoveRequestSchema,
	noteReopenRequestSchema,
	noteResolveRequestSchema,
	panelConfigSchema,
	panelWalkRequestSchema,
	pointCheckRequestSchema,
	pointMoveRequestSchema,
	pointRequestSchema,
	profileRequestSchema,
	runRequestSchema,
	suggestRequestSchema,
	suiteRequestSchema,
	themesRequestSchema,
} from './schema.js';
import {
	parseA11yRequest,
	parseBaselineRequest,
	parseCaptureRequest,
	parseCaptureSetRequest,
	parseCheckpointsRequest,
	parseCompareRequest,
	parseConfig,
	parseContext,
	parseContractRequest,
	parseCoverageRequest,
	parseDecisionCheckRequest,
	parseDecisionGetRequest,
	parseDecisionListRequest,
	parseDecisionRecordRequest,
	parseJobCreateRequest,
	parseJobRunRequest,
	parseMatrixRequest,
	parseNoteAddRequest,
	parseNoteCheckRequest,
	parseNoteListRequest,
	parseNoteMoveRequest,
	parseNoteReopenRequest,
	parseNoteResolveRequest,
	parsePointCheckRequest,
	parsePointMoveRequest,
	parsePointRequest,
	parseProfileRequest,
	parseRunRequest,
	parseSuggestRequest,
	parseSuiteRequest,
	parseThemesRequest,
} from './validate.js';
import { copyStaticTree, staticDestination } from './vite.js';

// The configuration rules as Zod expresses them; validation itself does not load Zod.
const configSchema = z
	.strictObject({
		specimens: z
			.array(
				z.strictObject({
					id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
					title: z.string().min(1),
					module: z.string().min(1),
					exportName: z.string().min(1),
					component: z
						.string()
						.regex(/^[a-z][a-z0-9]*-[a-z0-9-]+$/)
						.optional(),
					themes: z
						.strictObject({
							supported: z
								.array(z.enum(['light', 'dark', 'high-contrast']))
								.min(1)
								.refine((themes) => new Set(themes).size === themes.length),
							reason: z.string().min(1).optional(),
						})
						.transform(({ supported, reason }) => ({
							supported: (['light', 'dark', 'high-contrast'] as const).filter((theme) =>
								supported.includes(theme)
							),
							basis: 'declared' as const,
							...(reason === undefined ? {} : { reason }),
						}))
						.optional(),
					patternSetup: patternSetupBindingSchema.optional(),
					contexts: implementationContextsSchema.optional(),
					job: jobConfigSchema.optional(),
				})
			)
			.min(1)
			.optional(),
		jobSources: z.array(z.string().min(1)).optional(),
		stories: z
			.array(
				z.union([
					z.string().min(1),
					z.strictObject({
						directory: z.string().min(1),
						files: z.string().min(1).optional(),
						titlePrefix: z.string().optional(),
					}),
				])
			)
			.min(1)
			.optional(),
		preview: z.string().min(1).optional(),
		test: z
			.strictObject({
				include: z.array(z.string().min(1)).optional(),
				exclude: z.array(z.string().min(1)).optional(),
				skip: z.array(z.string().min(1)).optional(),
				workers: z.number().int().min(1).max(32).optional(),
				timeoutMs: z.number().int().min(1).max(60_000).optional(),
				settledAccessibility: z.boolean().optional(),
			})
			.optional(),
		coverage: z
			.strictObject({
				waivers: z
					.strictObject({
						version: z.string().min(1),
						entries: z.array(
							z.strictObject({
								component: z.string().min(1),
								obligation: z.string().min(1),
								reason: z.string().min(1),
							})
						),
					})
					.optional(),
			})
			.optional(),
		staticDirs: z
			.array(
				z.union([
					z.string().min(1),
					z
						.object({
							from: z.string().min(1),
							to: z.string().refine((value) => {
								if (value === '/') return true;
								if (!/^\/[^\\/]+(?:\/[^\\/]+)*\/?$/.test(value)) return false;
								for (let i = 0; i < value.length; i++) {
									const code = value.charCodeAt(i);
									if (code <= 0x1f || code === 0x7f) return false;
								}
								const parts = value.slice(1).replace(/\/$/, '').split('/');
								return (
									parts.every((p) => p !== '.' && p !== '..') && !/^[a-zA-Z]:/.test(parts[0] ?? '')
								);
							}),
						})
						.strict(),
				])
			)
			.optional(),
		network: z
			.strictObject({
				allow: z
					.array(
						z
							.string()
							.refine(
								(value) =>
									/^https?:\/\/[^/?#@*\s]+\/?$/i.test(value) &&
									URL.canParse(value) &&
									!new URL(value).hostname.startsWith('.')
							)
							// The effective port is kept, never dropped for being the default.
							.transform((value) => {
								const url = new URL(value);
								const implied = url.protocol === 'https:' ? ':443' : ':80';
								return `${url.protocol}//${url.host}${url.port ? '' : implied}`;
							})
					)
					.optional(),
			})
			.optional(),
		plugins: z.array(z.string().min(1)).optional(),
		manifest: z.string().min(1).optional(),
		profile: z.strictObject({ baselines: z.string().min(1).optional() }).optional(),
		guides: z.array(z.string().min(1)).optional(),
		patterns: z.array(z.string().min(1)).optional(),
		patternSources: z.array(z.string().min(1)).optional(),
		defaults: z.string().min(1).optional(),
		commandManifest: z.string().min(1).optional(),
		pack: z
			.strictObject({
				library: packIdentifier('library'),
				title: z
					.string()
					.min(1)
					.refine((value) => [...value].length <= 80),
				prefix: packIdentifier('prefix'),
				directory: z.string().min(1),
				package: z.string().min(1),
				import: z.string().min(1).optional(),
				examples: z.number().int().min(0).max(16).optional(),
				dependencies: z.array(z.string().min(1)).optional(),
				localElements: z
					.strictObject({
						manifest: z.string().min(1).optional(),
						tags: z
							.array(packIdentifier('tag'))
							.min(1)
							.max(256)
							.refine((tags) => new Set(tags).size === tags.length)
							.optional(),
					})
					.refine((value) => value.manifest !== undefined || value.tags !== undefined)
					.optional(),
				themeStylesheet: z.string().min(1).optional(),
			})
			.optional(),
		panel: panelConfigSchema.optional(),
	})
	.refine(
		(config) =>
			config.specimens !== undefined ||
			config.stories !== undefined ||
			config.commandManifest !== undefined ||
			config.panel !== undefined
	)
	.refine((config) => config.preview === undefined || config.stories !== undefined)
	.refine((config) => config.test === undefined || config.stories !== undefined)
	.refine((config) => config.guides === undefined || config.manifest !== undefined)
	.refine((config) => {
		if (config.pack === undefined || config.manifest !== undefined) return true;
		const hasAppElements =
			(config.pack.dependencies !== undefined && config.pack.dependencies.length > 0) ||
			config.pack.localElements !== undefined;
		return config.patterns !== undefined && config.patterns.length > 0 && hasAppElements;
	});

const verdict = (parse: () => unknown) => {
	try {
		return { ok: true, value: parse() };
	} catch {
		return { ok: false };
	}
};
function agrees(schema: z.ZodType, parse: (value: unknown) => unknown, value: unknown) {
	const expected = schema.safeParse(value);
	const actual = verdict(() => parse(value));
	expect(actual.ok, JSON.stringify(value)).toBe(expected.success);
	if (expected.success) expect(actual.value).toEqual(expected.data);
}

const numbers = [0, 1, 2.5, 8192, 8193, -1, Number.NaN, Number.POSITIVE_INFINITY, '20', null];
const sizes = [
	{ width: 1280, height: 720 },
	{ width: 375 },
	{},
	{ width: 1, height: 1, depth: 1 },
	[],
	null,
	'1280x720',
	...numbers.flatMap((width) => [
		{ width, height: 720 },
		{ width: 1280, height: width },
	]),
];
const contextValues: Record<string, unknown[]> = {
	viewport: sizes,
	container: [undefined, ...sizes],
	theme: ['light', 'dark', 'high-contrast', 'sepia', 'High-Contrast', '', 1],
	locale: ['en-US', 'fr-FR', 'zh-Hant-TW', 'en_US', 'not a locale', '', 'en-US,fr', 7],
	reducedMotion: ['reduce', 'no-preference', 'none'],
	motion: ['natural', 'settled', 'paused'],
};
function contexts(): unknown[] {
	const cases: unknown[] = [defaultContext, { ...defaultContext, extra: true }, null, [], 'light'];
	for (const [key, values] of Object.entries(contextValues))
		for (const value of values) cases.push({ ...defaultContext, [key]: value });
	for (const key of Object.keys(contextValues)) {
		const { [key]: _omitted, ...rest } = defaultContext as unknown as Record<string, unknown>;
		cases.push(rest);
	}
	return cases;
}

describe('bench validation matches the Zod schemas', () => {
	it('accepts and rejects contexts as contextSchema does', () => {
		for (const value of contexts()) agrees(contextSchema, (input) => parseContext(input), value);
	});

	it('accepts and rejects capture requests as captureRequestSchema does', () => {
		const requests: unknown[] = [
			{ id: 'probe' },
			{ id: '' },
			{ id: 1 },
			{},
			null,
			{ id: 'probe', extra: 1 },
			...['set-0123456789ab', 'main', '', 3].map((set) => ({ id: 'probe', set })),
			...['mount', '', 3].map((checkpoint) => ({ id: 'probe', checkpoint })),
			...['out.png', '', null].map((screenshot) => ({ id: 'probe', screenshot })),
			...[1, 60_000, 0, 60_001, 2.5, '10'].map((timeoutMs) => ({ id: 'probe', timeoutMs })),
			{ id: 'probe', context: {} },
			{ id: 'probe', context: { theme: 'dark' } },
			{ id: 'probe', context: { theme: 'high-contrast' } },
			{ id: 'probe', context: { theme: 'sepia' } },
			{ id: 'probe', context: { viewport: { width: 375 } } },
			{ id: 'probe', context: { container: { width: 320, height: 600 } } },
			{ id: 'probe', context: { locale: 'nope nope' } },
			{ id: 'probe', context: { unknown: true } },
			{ id: 'probe', context: null },
			...contexts().map((context) => ({ id: 'probe', context })),
		];
		for (const value of requests) agrees(captureRequestSchema, parseCaptureRequest, value);
	});

	it('accepts and rejects configurations as the configuration schema did', () => {
		const entry = {
			id: 'button-primary',
			title: 'Button',
			module: './b.ts',
			exportName: 'Primary',
		};
		const entries: unknown[] = [
			entry,
			{ ...entry, component: 'my-button' },
			{ ...entry, component: 'button' },
			{ ...entry, component: 'My-button' },
			{ ...entry, id: '-leading' },
			{ ...entry, id: 'a_b-c1' },
			{ ...entry, id: '' },
			{ ...entry, title: '' },
			{ ...entry, module: '' },
			{ ...entry, exportName: 1 },
			{ ...entry, extra: true },
			{ ...entry, themes: { supported: ['light'] } },
			{ ...entry, themes: { supported: ['dark', 'light'], reason: 'brand' } },
			{ ...entry, themes: { supported: [] } },
			{ ...entry, themes: { supported: ['light', 'light'] } },
			{ ...entry, themes: { supported: ['sepia'] } },
			{ ...entry, themes: { supported: ['light'], reason: '' } },
			{ ...entry, themes: { supported: ['light'], basis: 'declared' } },
			{ ...entry, themes: 'light' },
			null,
		];
		const configs: unknown[] = [
			{ specimens: [] },
			{},
			null,
			{ specimens: [entry], extra: 1 },
			{ specimens: entry },
			...entries.map((item) => ({ specimens: [item] })),
			{ specimens: [entry, { ...entry, id: 'second' }] },
			{ stories: ['src/**/*.stories.ts'] },
			{ stories: [] },
			{ stories: [''] },
			{ stories: [{ directory: 'src' }] },
			{ stories: [{ directory: 'src', files: '*.stories.ts', titlePrefix: '' }] },
			{ stories: [{ directory: 'src', titlePrefix: 1 }] },
			{ stories: [{ files: '*.ts' }] },
			{ stories: [{ directory: 'src', extra: 1 }] },
			{ stories: ['src'], preview: '.storybook/preview.ts' },
			{ stories: ['src'], preview: '' },
			{ specimens: [entry], preview: '.storybook/preview.ts' },
			{ specimens: [entry], stories: ['src'] },
			{ preview: 'x.ts' },
			{ stories: ['src'], test: { skip: ['skip-me'] } },
			{ stories: ['src'], test: { include: ['test'], exclude: [], skip: [] } },
			{ stories: ['src'], test: { include: [''] } },
			{ stories: ['src'], test: { skip: 'x' } },
			{ stories: ['src'], test: { other: [] } },
			{ stories: ['src'], test: { workers: 2 } },
			{ stories: ['src'], test: { workers: 0 } },
			{ stories: ['src'], test: { workers: 1.5 } },
			{ stories: ['src'], test: { timeoutMs: 20_000 } },
			{ stories: ['src'], test: { timeoutMs: 0 } },
			{ stories: ['src'], test: { settledAccessibility: true } },
			{ stories: ['src'], test: { settledAccessibility: 'yes' } },
			{ specimens: [entry], test: {} },
			{ specimens: [entry], plugins: ['./plugins.ts'], manifest: 'custom-elements.json' },
			{ specimens: [entry], staticDirs: ['./public', { from: './site', to: '/site' }] },
			{ specimens: [entry], coverage: {} },
			{ specimens: [entry], coverage: { waivers: { version: '1', entries: [] } } },
			{
				specimens: [entry],
				coverage: {
					waivers: { version: '1', entries: [{ component: 'a', obligation: 'b', reason: 'c' }] },
				},
			},
			{
				specimens: [entry],
				coverage: { waivers: { version: '1', entries: [{ component: 'a' }] } },
			},
			{ specimens: [entry], coverage: { waivers: { entries: [] } } },
			{ specimens: [entry], coverage: { other: 1 } },
			{ specimens: [entry], staticDirs: './public' },
			{ specimens: [entry], staticDirs: [{ from: './site', to: 'site' }] },
			{ specimens: [entry], staticDirs: [{ from: './site', to: '/' }] },
			{ specimens: [entry], staticDirs: [{ from: './site', to: '/assets/v1/' }] },
			{ specimens: [entry], staticDirs: [{ from: './site', to: '/../evil' }] },
			{ specimens: [entry], staticDirs: [{ from: './site', to: '/a/../../evil' }] },
			{ specimens: [entry], staticDirs: [{ from: './site', to: '/a/./b' }] },
			{ specimens: [entry], staticDirs: [{ from: './site', to: '/a\\b' }] },
			{ specimens: [entry], staticDirs: [{ from: './site', to: '//evil' }] },
			{ specimens: [entry], staticDirs: [{ from: './site', to: '/C:/evil' }] },
			{ specimens: [entry], staticDirs: [{ from: './site', to: '/a\0b' }] },
			{ specimens: [entry], staticDirs: [{ from: './site' }] },
			{ specimens: [entry], network: {} },
			{ specimens: [entry], network: { allow: [] } },
			{
				specimens: [entry],
				network: {
					allow: [
						'https://fonts.example.com',
						'HTTP://Example.COM:80/',
						'http://127.0.0.1:4000',
						'http://[::1]:8080',
					],
				},
			},
			{ specimens: [entry], network: { allow: 'https://fonts.example.com' } },
			{ specimens: [entry], network: { allow: [''] } },
			{ specimens: [entry], network: { allow: ['fonts.example.com'] } },
			{ specimens: [entry], network: { allow: ['https:fonts.example.com'] } },
			{ specimens: [entry], network: { allow: ['ws://example.com'] } },
			{ specimens: [entry], network: { allow: ['file:///tmp'] } },
			{ specimens: [entry], network: { allow: ['https://*.example.com'] } },
			{ specimens: [entry], network: { allow: ['https://example.com/fonts'] } },
			{ specimens: [entry], network: { allow: ['https://example.com?a'] } },
			{ specimens: [entry], network: { allow: ['https://user@example.com'] } },
			{ specimens: [entry], network: { allow: ['https://example.com:99999'] } },
			{ specimens: [entry], network: { allow: ['http://.localhost:4000'] } },
			{ specimens: [entry], network: { allow: ['https://.example.com'] } },
			{ specimens: [entry], network: { block: [] } },
			{ specimens: [entry], plugins: [] },
			{ specimens: [entry], plugins: [''] },
			{ specimens: [entry], plugins: './plugins.ts' },
			{ specimens: [entry], manifest: '' },
			{ specimens: [entry], profile: { baselines: './baselines.jsonc' } },
			{ specimens: [entry], profile: {} },
			{ specimens: [entry], profile: { baselines: '' } },
			{ specimens: [entry], profile: { other: 'x' } },
			{ specimens: [entry], manifest: 'm.json', guides: ['src/**/*.guide.json'] },
			{ specimens: [entry], manifest: 'm.json', guides: [] },
			{ specimens: [entry], manifest: 'm.json', guides: [''] },
			{ specimens: [entry], manifest: 'm.json', guides: 'src/*.json' },
			{ specimens: [entry], guides: ['src/**/*.guide.json'] },
			{ specimens: [entry], patterns: ['specimens/patterns/*/pattern.json'] },
			{ specimens: [entry], patterns: [] },
			{ specimens: [entry], patterns: [''] },
			{ specimens: [entry], patterns: 'specimens/*.json' },
			{ specimens: [entry], patternSources: ['../violet/pack', '@lushly-dev/violet-elements'] },
			{ specimens: [entry], patternSources: [''] },
			{ specimens: [entry], patternSources: '../violet/pack' },
		];
		for (const value of configs) agrees(configSchema, parseConfig, value);
	});

	it('keeps each allowed origin’s effective port, so no rule matches every port', () => {
		const entry = { id: 'probe', title: 'Probe', module: './p.ts', exportName: 'Probe' };
		const parsed = parseConfig({
			specimens: [entry],
			network: {
				allow: [
					'https://fonts.example.com',
					'HTTP://Example.COM:80/',
					'https://example.com:443',
					'http://[::1]',
					'http://localhost:4000',
				],
			},
		});
		expect(parsed.network?.allow).toEqual([
			'https://fonts.example.com:443',
			'http://example.com:80',
			'https://example.com:443',
			'http://[::1]:80',
			'http://localhost:4000',
		]);
		expect(() =>
			parseConfig({ specimens: [entry], network: { allow: ['http://.localhost:4000'] } })
		).toThrow('every subdomain');
	});

	it('validates manifest-less app packs, localElements, patternSetup, and contexts in parity with Zod', () => {
		const entry = {
			id: 'loam-shell',
			title: 'Loam shell',
			module: './shell.ts',
			exportName: 'Default',
		};
		const basePack = {
			library: 'loam',
			title: 'Loam',
			prefix: 'loam-',
			directory: './pack',
			package: './package.json',
		};
		const cases: unknown[] = [
			{
				specimens: [entry],
				patterns: ['specimens/patterns/*/pattern.json'],
				pack: {
					...basePack,
					dependencies: ['../violet/custom-elements.json'],
					localElements: { tags: ['loam-shell', 'loam-panel'] },
					themeStylesheet: '@lushly-dev/loam-theme/tokens.css',
				},
			},
			{
				specimens: [entry],
				patterns: ['specimens/patterns/*/pattern.json'],
				pack: { ...basePack, localElements: { manifest: './local-cem.json' } },
			},
			{ specimens: [entry], pack: basePack },
			{ specimens: [entry], patterns: ['specimens/patterns/*/pattern.json'], pack: basePack },
			{
				specimens: [entry],
				patterns: [],
				pack: { ...basePack, localElements: { tags: ['loam-shell'] } },
			},
			{
				specimens: [entry],
				patterns: ['specimens/patterns/*/pattern.json'],
				pack: { ...basePack, dependencies: [] },
			},
			{ specimens: [entry], manifest: 'm.json', pack: { ...basePack, localElements: {} } },
			{
				specimens: [entry],
				manifest: 'm.json',
				pack: { ...basePack, localElements: { tags: ['loam-shell', 'loam-shell'] } },
			},
			{
				specimens: [entry],
				manifest: 'm.json',
				pack: { ...basePack, localElements: { tags: ['notatag'] } },
			},
			{
				specimens: [
					{
						...entry,
						patternSetup: { library: 'violet', pattern: 'dialog.modal', setup: 'default' },
						contexts: {
							viewport: { minWidth: 640, maxWidth: 1440 },
							themes: ['dark', 'light'],
							reason: 'Desktop dialog layout only.',
						},
					},
				],
			},
			{
				specimens: [
					{
						...entry,
						contexts: { viewport: { minWidth: 900, maxWidth: 600 }, reason: 'Invalid range.' },
					},
				],
			},
			{
				specimens: [
					{
						...entry,
						contexts: { themes: ['light', 'dark'], reason: 'Wrong order.' },
					},
				],
			},
			{
				specimens: [{ ...entry, contexts: { reason: 'Missing viewport and themes.' } }],
			},
			{
				panel: {
					jobs: ['publish-post'],
					personas: [{ id: 'p-sr', modality: 'screen-reader', name: 'Sam' }],
				},
			},
			{
				panel: {
					personas: [{ id: 'p-bad', modality: 'invalid' }],
				},
			},
		];
		for (const value of cases) agrees(configSchema, parseConfig, value);
	});

	it('accepts the three themes and nothing else', () => {
		for (const theme of ['light', 'dark', 'high-contrast'] as const)
			expect(parseContext({ ...defaultContext, theme })).toEqual({ ...defaultContext, theme });
		expect(() => parseContext({ ...defaultContext, theme: 'contrast' })).toThrow('theme');
	});

	it('names the field that failed', () => {
		expect(() => parseCaptureRequest({ id: 'probe', timeoutMs: 0 })).toThrow(
			'capture request.timeoutMs'
		);
		expect(() => parseContext({ ...defaultContext, locale: 'not a locale' })).toThrow('BCP 47');
	});

	it('confines staticDestination to the build output directory (#1877)', () => {
		expect(staticDestination('/tmp/out', '/')).toMatch(/out$/);
		expect(staticDestination('/tmp/out', '/site')).toMatch(/site$/);
		for (const bad of ['/../escape', '/a/../../escape', '/a\\b', '/C:/escape', '//escape']) {
			expect(() => staticDestination('/tmp/out', bad)).toThrow(/escapes/);
		}
	});

	it('rejects escaping symlinks and materializes in-root links in copyStaticTree (#1877)', async () => {
		const root = await mkdtemp(join(tmpdir(), 'specimen-static-copy-'));
		const outside = join(root, 'outside.txt');
		const src = join(root, 'src');
		const out = join(root, 'out');
		await writeFile(outside, 'secret');
		const { mkdir } = await import('node:fs/promises');
		await mkdir(src, { recursive: true });
		await mkdir(out, { recursive: true });
		await writeFile(join(src, 'ok.txt'), 'hello');
		// Overlapping source and destination trees must be rejected before recursion
		const nestedOut = join(src, 'nested-out');
		await mkdir(nestedOut, { recursive: true });
		await expect(copyStaticTree(src, nestedOut, '/assets')).rejects.toThrow(/overlap/);
		await rm(nestedOut, { recursive: true, force: true });
		try {
			await symlink(join(src, 'ok.txt'), join(src, 'alias.txt'));
			await copyStaticTree(src, out, '/assets');
			expect(await readFile(join(out, 'assets', 'alias.txt'), 'utf8')).toBe('hello');

			await symlink(outside, join(src, 'escape.txt'));
			await expect(copyStaticTree(src, out, '/assets2')).rejects.toThrow(/escapes/);
		} catch (error) {
			// On unprivileged Windows environments where file symlinks require developer mode
			if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('request parsing agrees with the public schemas', () => {
	const filters = [
		{},
		{ ids: ['a'] },
		{ ids: [] },
		{ ids: [''] },
		{ ids: 'a' },
		{ file: 'a.ts' },
		{ file: '' },
		{ tags: ['smoke'] },
		{ tags: 'smoke' },
		{ match: 'x' },
		{ match: '' },
		{ other: 'x' },
		'x',
		null,
	];
	const contexts = [
		{},
		{ theme: 'dark' },
		{ theme: 'sepia' },
		{ viewport: { width: 0 } },
		{ other: 1 },
	];
	const timeouts = [1, 60_000, 60_001, 0, 1.5, '5'];

	it('agrees on suite requests', () => {
		const values = [
			{},
			...filters.map((filter) => ({ filter })),
			...contexts.map((context) => ({ context })),
			...timeouts.map((timeoutMs) => ({ timeoutMs })),
			...[1, 32, 33, 0, 1.5, '2'].map((workers) => ({ workers })),
			...[true, false, 'yes', 1].map((retry) => ({ retry })),
			...[0, 1000, 1001, -1, 1.5].map((flakeCap) => ({ flakeCap })),
			...['all', 'failed', 'none', 'some', 1].map((capture) => ({ capture })),
			{ other: 1 },
			null,
			[],
		];
		for (const value of values) agrees(suiteRequestSchema, parseSuiteRequest, value);
	});

	it('agrees on accessibility requests', () => {
		const values = [
			{},
			{ id: 'a' },
			{ id: '' },
			{ id: 1 },
			...filters.map((filter) => ({ filter })),
			{ checkpoint: 'mount' },
			{ checkpoint: '' },
			...contexts.map((context) => ({ context })),
			...timeouts.map((timeoutMs) => ({ timeoutMs })),
			...[1, 32, 33, 0].map((workers) => ({ workers })),
			{ other: 1 },
			null,
		];
		for (const value of values) agrees(a11yRequestSchema, parseA11yRequest, value);
		expect(() => parseA11yRequest({ id: 'a', filter: {} })).toThrow('not both');
	});

	it('agrees on themes requests', () => {
		const values = [
			{},
			{ id: 'a' },
			{ id: '' },
			...filters.map((filter) => ({ filter })),
			...[
				['light', 'dark'],
				['light', 'dark', 'high-contrast'],
				['light'],
				['light', 'light'],
				['light', 'sepia'],
				[],
				'light',
			].map((themes) => ({ themes })),
			{ checkpoint: 'mount' },
			{ checkpoint: '' },
			...contexts.map((context) => ({ context })),
			...[0, 0.02, 1, -0.1, 1.1, Number.NaN, '0.02'].map((threshold) => ({ threshold })),
			...timeouts.map((timeoutMs) => ({ timeoutMs })),
			...[1, 32, 33, 0].map((workers) => ({ workers })),
			{ other: 1 },
			null,
		];
		for (const value of values) agrees(themesRequestSchema, parseThemesRequest, value);
		expect(() => parseThemesRequest({ id: 'a', filter: {} })).toThrow('not both');
	});

	it('agrees on profile and baseline requests', () => {
		const values = [
			{},
			{ id: 'a' },
			{ id: '' },
			...filters.map((filter) => ({ filter })),
			...[1, 7, 8, 0, 1.5, '3'].map((runs) => ({ runs })),
			{ checkpoint: 'mount' },
			{ checkpoint: '' },
			...contexts.map((context) => ({ context })),
			...timeouts.map((timeoutMs) => ({ timeoutMs })),
			{ other: 1 },
			null,
		];
		for (const value of values) agrees(profileRequestSchema, parseProfileRequest, value);
		for (const value of [
			...values,
			{ notes: ['after cutover'] },
			{ notes: [] },
			{ notes: [''] },
			{ notes: 'x' },
		])
			agrees(baselineRequestSchema, parseBaselineRequest, value);
		expect(() => parseProfileRequest({ id: 'a', filter: {} })).toThrow('not both');
		expect(() => parseBaselineRequest({ id: 'a', filter: {} })).toThrow('not both');
	});

	it('agrees on matrix requests', () => {
		const axes = [
			{ theme: ['light', 'dark'] },
			{ theme: ['sepia'] },
			{ theme: [] },
			{ theme: 'light' },
			{ viewport: [{ width: 375, height: 812 }] },
			{ viewport: [{ width: 0, height: 812 }] },
			{ viewport: [{ width: 375 }] },
			{ container: [{ width: 375 }] },
			{ container: [{ width: 375, height: 200 }] },
			{ container: [{ height: 200 }] },
			{ locale: ['en-US', 'de'] },
			{ locale: ['not a locale'] },
			{ locale: [''] },
			{ reducedMotion: ['reduce', 'no-preference'] },
			{ reducedMotion: ['sometimes'] },
			{ motion: ['natural', 'settled'] },
			{ motion: ['fast'] },
			{ other: ['x'] },
			{},
			null,
		];
		const values = [
			...axes.map((value) => ({ id: 'a', axes: value })),
			{ axes: { theme: ['light'] } },
			{ id: '', axes: { theme: ['light'] } },
			{ id: 'a' },
			{ id: 'a', axes: { theme: ['light'] }, checkpoint: 'mount' },
			{ id: 'a', axes: { theme: ['light'] }, checkpoint: '' },
			...contexts.map((context) => ({ id: 'a', axes: { theme: ['light'] }, context })),
			...timeouts.map((timeoutMs) => ({ id: 'a', axes: { theme: ['light'] }, timeoutMs })),
			...[1, 32, 33, 0].map((workers) => ({ id: 'a', axes: { theme: ['light'] }, workers })),
			{ id: 'a', axes: { theme: ['light'] }, observations: true },
			{ id: 'a', axes: { theme: ['light'] }, observations: false },
			{ id: 'a', axes: { theme: ['light'] }, observations: 'yes' },
			{ id: 'a', axes: { theme: ['light'] }, other: 1 },
			null,
		];
		for (const value of values) agrees(matrixRequestSchema, parseMatrixRequest, value);
	});

	it('agrees on suggest requests', () => {
		const values = [
			{ component: 'x-a' },
			{ component: '' },
			{},
			{ component: 'x-a', gaps: ['default'] },
			{ component: 'x-a', gaps: [] },
			{ component: 'x-a', gaps: [''] },
			{ component: 'x-a', gaps: 'default' },
			{ component: 'x-a', pattern: 'select', gaps: ['pattern:select.keep.named'] },
			{ pattern: 'select', gaps: ['pattern:select.keep.named'] },
			{ pattern: 'example/select', gaps: ['pattern:example/select.keep.shows-choice'] },
			{ pattern: 'select' },
			{ pattern: 'select', gaps: [] },
			{ pattern: '', gaps: ['pattern:select.keep.named'] },
			{ component: 'x-a', timeoutMs: 1 },
			{ component: 'x-a', timeoutMs: 60_001 },
			{ component: 'x-a', workers: 1 },
			{ component: 'x-a', workers: 0 },
			{ component: 'x-a', other: 1 },
			null,
		];
		for (const value of values) agrees(suggestRequestSchema, parseSuggestRequest, value);
	});

	it('agrees on run requests and suite filter pattern/kind options', () => {
		const runValues: unknown[] = [
			{ id: 'story-a' },
			{ id: 'select--gate--named', capture: 'none' },
			{ id: 'select--gate--named', capture: 'failed' },
			{ id: 'select--gate--named', capture: 'all' },
			{ id: 'select--gate--named', capture: 'always' },
			{ id: 'select--gate--named', checkpoint: 'mount' },
			{ id: 'select--gate--named', set: 'main' },
			{ id: 'select--gate--named', context: { theme: 'dark' }, timeoutMs: 5000 },
			{ id: '' },
			{},
			null,
		];
		for (const value of runValues) agrees(runRequestSchema, parseRunRequest, value);

		const suiteValues: unknown[] = [
			{ filter: { kind: ['gate'] } },
			{ filter: { kind: ['story', 'gate'], pattern: 'example/select' } },
			{ filter: { kind: [] } },
			{ filter: { kind: ['job'] } },
			{ filter: { pattern: 'select' } },
			{ filter: { pattern: '' } },
		];
		for (const value of suiteValues) agrees(suiteRequestSchema, parseSuiteRequest, value);
	});

	it('agrees on coverage requests', () => {
		const values = [
			{},
			{ component: 'x-a' },
			{ component: '' },
			{ component: 1 },
			{ filter: { file: './a.ts' } },
			{ filter: { other: 1 } },
			{ timeoutMs: 1 },
			{ timeoutMs: 60_001 },
			...[1, 32, 33, 0].map((workers) => ({ workers })),
			{ other: 1 },
			null,
		];
		for (const value of values) {
			agrees(coverageRequestSchema, parseCoverageRequest, value);
			agrees(contractRequestSchema, parseContractRequest, value);
		}
		const patternValues = [
			{ pattern: 'select' },
			{ pattern: 'example/select', component: 'example-select' },
			{ pattern: '' },
			{ pattern: 123 },
		];
		for (const value of patternValues) {
			agrees(coverageRequestSchema, parseCoverageRequest, value);
		}
		const jobsValues = [
			{ obligations: 'schema-partitions@1' },
			{ obligations: 'jobs@1', captures: 'main' },
			{ component: 'example-notice', obligations: 'jobs@1', captures: 'set-0123456789ab' },
			{ obligations: 'jobs@1' },
			{ obligations: 'jobs@1', captures: '' },
			{ obligations: 'jobs@1', captures: 123 },
			{ captures: 'main' },
			{ obligations: 'schema-partitions@1', captures: 'main' },
			{ obligations: 'guides@1' },
			{ obligations: 'jobs@2', captures: 'main' },
			{ obligations: 42 },
		];
		for (const value of jobsValues) {
			agrees(coverageRequestSchema, parseCoverageRequest, value);
		}
	});

	it('agrees on point, point-move, and point-check requests', () => {
		const pointValues: unknown[] = [
			{ pointer: 'specimen:toolbar#ref=root/div:1' },
			{ pointer: '' },
			{ pointer: 'specimen:toolbar#ref=root/div:1', timeoutMs: 5000 },
			{ pointer: 'specimen:toolbar#ref=root/div:1', id: 'toolbar' },
			{ pointer: 'specimen:toolbar#ref=root/div:1', target: { role: 'button' } },
			{ pointer: 'specimen:toolbar#ref=root/div:1', context: { theme: 'dark' } },
			{ pointer: 'specimen:toolbar#ref=root/div:1', checkpoint: 'mount' },
			{ pointer: 123 },
			{ id: 'toolbar', target: { role: 'button', name: 'Share' } },
			{ id: 'toolbar', target: { role: 'button' } },
			{ id: 'toolbar', target: { selector: 'button.primary' } },
			{
				id: 'toolbar',
				context: { theme: 'dark', viewport: '1280x800' },
				checkpoint: 'mount',
				target: { role: 'button', name: 'Share' },
			},
			{
				id: 'toolbar',
				context: { theme: 'light', viewport: { width: 800, height: 600 }, container: '320' },
				target: { selector: 'button' },
			},
			{
				id: 'toolbar',
				context: {
					container: '320x480',
					locale: 'en-US',
					reducedMotion: 'reduce',
					motion: 'settled',
				},
				target: { role: 'button' },
			},
			{ id: 'toolbar', context: { viewport: '0x800' }, target: { role: 'button' } },
			{ id: 'toolbar', context: { viewport: '9000x800' }, target: { role: 'button' } },
			{ id: 'toolbar', context: { viewport: 'wide' }, target: { role: 'button' } },
			{ id: 'toolbar', context: { container: '0' }, target: { role: 'button' } },
			{ id: 'toolbar', context: { theme: 'sepia' }, target: { role: 'button' } },
			{ id: 'toolbar', context: { unknown: 'x' }, target: { role: 'button' } },
			{ id: 'toolbar', target: { role: '' } },
			{ id: 'toolbar', target: { selector: '' } },
			{ id: 'toolbar', target: { selector: 'button', role: 'button' } },
			{ id: 'toolbar', target: { role: 'button', name: 42 } },
			{ id: 'toolbar' },
			{ target: { role: 'button' } },
			{},
			{ id: '', target: { role: 'button' } },
			{ id: 'toolbar', target: { role: 'button' }, timeoutMs: 0 },
			{ id: 'toolbar', target: { role: 'button' }, extra: true },
			null,
		];
		for (const value of pointValues) agrees(pointRequestSchema, parsePointRequest, value);

		const moveValues: unknown[] = [
			{ id: 'pt-5r8k2w9m4c1x', to: 'parent' },
			{ id: 'pt-5r8k2w9m4c1x', to: 'child' },
			{ id: 'pt-5r8k2w9m4c1x', to: 'child', index: 0 },
			{ id: 'pt-5r8k2w9m4c1x', to: 'child', index: 3 },
			{ id: 'pt-5r8k2w9m4c1x', to: 'next' },
			{ id: 'pt-5r8k2w9m4c1x', to: 'previous' },
			{ id: 'pt-5r8k2w9m4c1x', to: 'component' },
			{ id: 'pt-5r8k2w9m4c1x', to: 'parent', index: 0 },
			{ id: 'pt-5r8k2w9m4c1x', to: 'child', index: -1 },
			{ id: 'pt-5r8k2w9m4c1x', to: 'child', index: 1.5 },
			{ id: 'pt-5r8k2w9m4c1x', to: 'up' },
			{ id: '', to: 'parent' },
			{ to: 'parent' },
			{ id: 'pt-5r8k2w9m4c1x', to: 'next', timeoutMs: 1000 },
			{ id: 'pt-5r8k2w9m4c1x', to: 'next', timeoutMs: 0 },
			{ id: 'pt-5r8k2w9m4c1x', to: 'next', extra: true },
			null,
		];
		for (const value of moveValues) agrees(pointMoveRequestSchema, parsePointMoveRequest, value);

		const checkValues: unknown[] = [
			{ id: 'pt-5r8k2w9m4c1x' },
			{ id: 'pt-5r8k2w9m4c1x', timeoutMs: 2000 },
			{ id: '' },
			{ id: 123 },
			{ id: 'pt-5r8k2w9m4c1x', timeoutMs: 0 },
			{ id: 'pt-5r8k2w9m4c1x', extra: true },
			{},
			null,
		];
		for (const value of checkValues) agrees(pointCheckRequestSchema, parsePointCheckRequest, value);
	});

	it('agrees on capture set requests', () => {
		const values = [
			{},
			{ label: 'main' },
			{ label: 'feature/v1.0_dark' },
			{ label: 'set-0123456789ab' },
			{ label: '' },
			{ label: '../escape' },
			{ label: 'bad/../path' },
			{ label: 'bad//path' },
			{ ids: ['toolbar--dense', 'toolbar--airy'] },
			{ ids: [] },
			{ ids: [''] },
			{ ids: 'toolbar--dense' },
			{ filter: { file: './a.ts', kind: ['component', 'gate'] } },
			{ filter: { kind: [] } },
			{ filter: { kind: ['unknown'] } },
			{ filter: { other: 1 } },
			{ ids: ['a'], filter: { match: 'a' } },
			{ checkpoint: 'mount' },
			{ checkpoint: '' },
			{ axe: true },
			{ axe: false },
			{ axe: 'yes' },
			...contexts.map((context) => ({ context })),
			...timeouts.map((timeoutMs) => ({ timeoutMs })),
			...[1, 32, 33, 0].map((workers) => ({ workers })),
			{ other: 1 },
			null,
		];
		for (const value of values) agrees(captureSetRequestSchema, parseCaptureSetRequest, value);
	});

	it('agrees on checkpoints and job run requests and validates job config entries', () => {
		const cpValues = [
			{ id: 'counter' },
			{ id: 'counter', checkpoints: ['initial', 'after-click'], label: 'main', axe: false },
			{ id: 'counter', checkpoints: ['initial', 'initial'] },
			{ id: 'counter', pin: { clock: '2026-03-02T09:00:00Z' } },
			{ id: 'counter', pin: { clock: '2026-02-30T09:00:00Z' } },
			{ id: 'counter', pin: { clock: 'not-a-timestamp' } },
			{ id: 'counter', label: 'set-0123456789ab' },
			{ id: 'counter', checkpoints: [] },
			{ id: '' },
			{ id: 'counter', extra: 1 },
			null,
		];
		for (const value of cpValues) agrees(checkpointsRequestSchema, parseCheckpointsRequest, value);

		const jobValues = [
			{ id: 'example-keep-a-draft' },
			{
				id: 'example-keep-a-draft',
				label: 'branch',
				axe: true,
				pin: { clock: '2026-03-02T09:00:00Z' },
				scenario: {
					job: 'keep-a-draft',
					steps: [
						{ step: 1, command: 'document-create', description: 'A note is created' },
						{ step: 2, command: 'document-open', description: 'The note opens' },
					],
				},
			},
			{
				id: 'example-keep-a-draft',
				scenario: {
					job: 'dup-steps',
					steps: [
						{ step: 1, command: 'a' },
						{ step: 1, command: 'b' },
					],
				},
			},
			{
				id: 'example-keep-a-draft',
				scenario: {
					job: 'gap-steps',
					steps: [{ step: 2, command: 'a' }],
				},
			},
			{ id: 'example-keep-a-draft', pin: { clock: '2026-02-30T09:00:00Z' } },
			{ id: 'example-keep-a-draft', pin: { clock: '2026-03-02' } },
			{ id: 'example-keep-a-draft', scenario: { job: 'x', steps: [] } },
			{ id: 'example-keep-a-draft', extra: true },
			null,
		];
		for (const value of jobValues) agrees(jobRunRequestSchema, parseJobRunRequest, value);

		const jobCreateValues: unknown[] = [
			{
				id: 'example-keep-a-draft',
				scenario: '../scenarios/keep-a-draft.scenario.yaml',
				module: './app.specimens.ts',
				exportName: 'NotesApp',
				target: 'app',
				captures: [
					3,
					{
						step: 4,
						name: 'conflict-notice',
						before: [{ action: { fill: 'second-editor', value: ' draft' } }],
					},
				],
			},
			{
				id: 'example-keep-a-draft',
				title: 'Example/Notes/Keep a draft',
				scenario: './s.yaml',
				module: './app.ts',
				exportName: 'App',
				target: 'app',
				runner: 'afd',
				pin: { clock: '2026-03-02T09:00:00Z' },
				captures: [{ step: 1 }],
			},
			{
				id: 'bad id',
				scenario: './s.yaml',
				module: './app.ts',
				exportName: 'App',
				target: 'app',
				captures: [1],
			},
			{
				id: 'empty-captures',
				scenario: './s.yaml',
				module: './app.ts',
				exportName: 'App',
				target: 'app',
				captures: [],
			},
			{
				id: 'zero-step',
				scenario: './s.yaml',
				module: './app.ts',
				exportName: 'App',
				target: 'app',
				captures: [0],
			},
			{
				id: 'bad-clock',
				scenario: './s.yaml',
				module: './app.ts',
				exportName: 'App',
				target: 'app',
				pin: { clock: '2026-02-30T09:00:00Z' },
				captures: [1],
			},
			{
				id: 'extra-field',
				scenario: './s.yaml',
				module: './app.ts',
				exportName: 'App',
				target: 'app',
				captures: [1],
				extra: true,
			},
			null,
		];
		for (const value of jobCreateValues)
			agrees(jobCreateRequestSchema, parseJobCreateRequest, value);

		const a11ySetValues: unknown[] = [
			{ set: 'set-0123456789ab' },
			{ set: 'main', id: 'example-keep-a-draft', checkpoint: 'two-editors' },
			{ set: 'main', id: 'example-keep-a-draft', filter: { match: 'two' } },
			{ id: 'example-keep-a-draft', filter: { match: 'two' } },
			{ set: '' },
			{ set: 42 },
		];
		for (const value of a11ySetValues) agrees(a11yRequestSchema, parseA11yRequest, value);

		const jobConfigs = [
			{
				jobSources: ['./job-source.mjs'],
				specimens: [
					{
						id: 'example-keep-a-draft',
						title: 'Notes/Keep a draft',
						module: './notes.ts',
						exportName: 'NotesApp',
						job: {
							scenario: '../scenarios/keep-a-draft.scenario.yaml',
							target: 'app',
							pin: { clock: '2026-03-02T09:00:00Z' },
							captures: [
								{ after: 'The note opens beside itself', name: 'two-editors' },
								{
									after: 'Another writer saves the note',
									name: 'conflict-notice',
									before: [{ action: { fill: 'second-editor', value: ' draft' } }],
								},
							],
						},
					},
				],
			},
			{
				specimens: [
					{
						id: 'dup-capture',
						title: 'Dup',
						module: './a.ts',
						exportName: 'A',
						job: {
							scenario: './s.yaml',
							target: 'app',
							captures: [
								{ after: 'Step 1', name: 'same' },
								{ after: 'Step 2', name: 'same' },
							],
						},
					},
				],
			},
			{
				specimens: [
					{
						id: 'rollover-clock',
						title: 'Rollover',
						module: './a.ts',
						exportName: 'A',
						job: {
							scenario: './s.yaml',
							target: 'app',
							pin: { clock: '2026-02-30T09:00:00Z' },
							captures: [{ after: 'Step 1', name: 'one' }],
						},
					},
				],
			},
			{
				jobSources: [''],
				specimens: [
					{
						id: 'bad-source',
						title: 'Bad source',
						module: './a.ts',
						exportName: 'A',
					},
				],
			},
		];
		for (const value of jobConfigs) agrees(configSchema, parseConfig, value);
	});

	it('accepts and rejects compare requests as compareRequestSchema does', () => {
		const values: unknown[] = [
			{ ids: ['a', 'b'] },
			{
				ids: ['a', 'b', 'c'],
				context: { theme: 'light', viewport: { width: 1280, height: 800 } },
				checkpoint: 'mount',
				timeoutMs: 10_000,
				workers: 2,
			},
			{ ids: ['1', '2', '3', '4', '5', '6', '7', '8'] },
			{ ids: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] },
			{ ids: ['only-one'] },
			{ ids: [] },
			{ ids: ['dup', 'dup'] },
			{ ids: ['a', ''] },
			{ ids: ['a', 'b'], context: { theme: 'sepia' } },
			{ ids: ['a', 'b'], checkpoint: '' },
			{ ids: ['a', 'b'], timeoutMs: 0 },
			{ ids: ['a', 'b'], workers: 0 },
			{ ids: ['a', 'b'], extra: true },
			{},
			null,
		];
		for (const value of values) agrees(compareRequestSchema, parseCompareRequest, value);
	});

	it('accepts and rejects note requests as the note Zod schemas do', () => {
		const addValues: unknown[] = [
			{ point: 'pt-5r8k2w9m4c1x', text: 'Check contrast' },
			{
				pointer: 'specimen:example-toolbar#ref=root/div:1',
				text: 'Check contrast',
				assignee: 'agent',
				timeoutMs: 5000,
			},
			{ pointer: 'specimen:example-toolbar#ref=root/div:1', text: '' },
			{ pointer: '', text: 'Bad pointer passed to handler' },
			{ point: 'pt-5r8k2w9m4c1x', pointer: 'specimen:a#ref=root/div:1', text: 'Both' },
			{ text: 'Neither' },
			{ point: '', text: 'Empty point id' },
			{ point: 'pt-5r8k2w9m4c1x', text: 'Ok', assignee: '' },
			{ point: 'pt-5r8k2w9m4c1x', text: 'a'.repeat(4_001) },
			{ point: 'pt-5r8k2w9m4c1x', text: 'Ok', assignee: 'a'.repeat(201) },
			{ point: 'pt-5r8k2w9m4c1x', text: 'Ok', timeoutMs: 0 },
			{ point: 'pt-5r8k2w9m4c1x', text: 'Ok', extra: true },
			null,
		];
		for (const value of addValues) agrees(noteAddRequestSchema, parseNoteAddRequest, value);

		const listValues: unknown[] = [
			{},
			{
				specimen: 'example-toolbar',
				state: 'open',
				assignee: 'agent',
				orphaned: false,
				limit: 20,
				after: 'note-111111111111',
			},
			{ state: 'resolved' },
			{ state: 'all', limit: 100 },
			{ state: 'closed' },
			{ limit: 0 },
			{ limit: 101 },
			{ limit: 1.5 },
			{ orphaned: 'true' },
			{ specimen: '' },
			{ after: '' },
			{ extra: true },
			null,
		];
		for (const value of listValues) agrees(noteListRequestSchema, parseNoteListRequest, value);

		const checkValues: unknown[] = [
			{},
			{ specimen: 'example-toolbar' },
			{ specimen: 'example-toolbar', timeoutMs: 15_000 },
			{ specimen: '' },
			{ timeoutMs: 0 },
			{ extra: true },
			null,
		];
		for (const value of checkValues) agrees(noteCheckRequestSchema, parseNoteCheckRequest, value);

		const moveValues: unknown[] = [
			{ id: 'note-7k2m9q4x1r8t', point: 'pt-5r8k2w9m4c1x', reason: 'Moved' },
			{
				id: 'note-7k2m9q4x1r8t',
				pointer: 'specimen:a#ref=root/div:1',
				reason: 'Moved',
				timeoutMs: 5000,
			},
			{ id: 'note-7k2m9q4x1r8t', point: 'pt-5r8k2w9m4c1x' },
			{ id: 'note-7k2m9q4x1r8t', point: 'pt-5r8k2w9m4c1x', reason: '' },
			{
				id: 'note-7k2m9q4x1r8t',
				point: 'pt-5r8k2w9m4c1x',
				pointer: 'specimen:a#ref=root/div:1',
				reason: 'Both',
			},
			{ id: 'note-7k2m9q4x1r8t', reason: 'Neither' },
			{ id: '', point: 'pt-5r8k2w9m4c1x', reason: 'Empty id' },
			{ id: 'note-7k2m9q4x1r8t', point: 'pt-5r8k2w9m4c1x', reason: 123 },
			{ id: 'note-7k2m9q4x1r8t', point: 'pt-5r8k2w9m4c1x', extra: true },
			null,
		];
		for (const value of moveValues) agrees(noteMoveRequestSchema, parseNoteMoveRequest, value);

		const resolveValues: unknown[] = [
			{
				id: 'note-9v4b7n2k5m1c',
				outcome: 'fixed',
				reason: 'Done',
				evidence: { revision: '4f2c9a1' },
			},
			{ ids: ['note-111111111111', 'note-222222222222'], outcome: 'obsolete', reason: 'Removed' },
			{ id: 'note-9v4b7n2k5m1c', outcome: 'withdrawn' },
			{ id: 'note-9v4b7n2k5m1c', outcome: 'declined', reason: '' },
			{ id: 'note-9v4b7n2k5m1c', ids: ['note-9v4b7n2k5m1c'], outcome: 'fixed', reason: 'Both' },
			{ outcome: 'fixed', reason: 'Neither' },
			{ ids: [], outcome: 'fixed', reason: 'Empty ids' },
			{
				ids: Array.from({ length: 101 }, (_, i) => `note-${String(i).padStart(12, '0')}`),
				outcome: 'fixed',
				reason: 'Too many',
			},
			{ id: 'note-9v4b7n2k5m1c', outcome: 'fixed', reason: 'r'.repeat(2_001) },
			{ ids: [''], outcome: 'fixed', reason: 'Empty id in array' },
			{ id: 'note-9v4b7n2k5m1c', outcome: 'unknown', reason: 'Bad outcome' },
			{ id: 'note-9v4b7n2k5m1c', outcome: 'fixed', reason: 'Ok', evidence: { revision: '' } },
			{ id: 'note-9v4b7n2k5m1c', outcome: 'fixed', reason: 'Ok', evidence: { extra: 'x' } },
			{ id: 'note-9v4b7n2k5m1c', outcome: 'fixed', reason: 'Ok', extra: true },
			null,
		];
		for (const value of resolveValues)
			agrees(noteResolveRequestSchema, parseNoteResolveRequest, value);

		const reopenValues: unknown[] = [
			{ id: 'note-9v4b7n2k5m1c', reason: 'PDF fails' },
			{ id: 'note-9v4b7n2k5m1c' },
			{ id: 'note-9v4b7n2k5m1c', reason: '' },
			{ id: '', reason: 'Empty id' },
			{ id: 'note-9v4b7n2k5m1c', reason: 42 },
			{ id: 'note-9v4b7n2k5m1c', reason: 'Ok', extra: true },
			null,
		];
		for (const value of reopenValues)
			agrees(noteReopenRequestSchema, parseNoteReopenRequest, value);
	});

	it('accepts and rejects decision requests as decision*RequestSchema do', () => {
		const recordValues: unknown[] = [
			// Mode 1: new choice
			{
				slug: 'toolbar-density',
				question: 'How dense?',
				set: 'set-9c03e1d27a55',
				chosen: 'toolbar--dense',
				reason: 'Fits twelve commands.',
			},
			{
				slug: 'toolbar-density',
				question: 'How dense?',
				set: 'set-9c03e1d27a55',
				chosen: 'toolbar--dense',
				reason: '',
				subjects: { files: ['src/toolbar/**'], tokens: ['space.toolbar.gap'] },
			},
			{
				slug: 'toolbar-density',
				question: 'How dense?',
				set: 'set-9c03e1d27a55',
				chosen: 'toolbar--dense',
			},
			// Mode 1 missing slug or question
			{ question: 'How dense?', set: 'set-9c03e1d27a55', chosen: 'toolbar--dense', reason: 'r' },
			{ slug: 'toolbar-density', set: 'set-9c03e1d27a55', chosen: 'toolbar--dense', reason: 'r' },
			// Mode 2: supersede single & multi (with or without items)
			{ supersedes: 'dec-q7k2m4xab3na', chosen: 'toolbar--airy', reason: 'Calmer.' },
			{
				supersedes: ['dec-q7k2m4xab3na'],
				chosen: 'toolbar--airy',
				reason: 'Calmer.',
			},
			{
				supersedes: ['dec-q7k2m4xab3na', 'dec-h3np6wz5c2rf'],
				chosen: 'toolbar--airy',
				reason: 'Direct multi-choice supersede.',
			},
			{
				supersedes: ['dec-q7k2m4xab3na', 'dec-h3np6wz5c2rf'],
				items: ['changed:a:b:set-4f1c0a9e2b7d..set-7e2a90c4d311'],
				chosen: 'accept',
				reason: 'Both adopt 8px.',
			},
			// Mode 2 invalid combos
			{
				supersedes: ['dec-q7k2m4xab3na', 'dec-h3np6wz5c2rf'],
				items: ['changed:a:b:set-4f1c0a9e2b7d..set-7e2a90c4d311'],
				chosen: 'accept',
				slug: 'override-not-allowed',
				reason: 'Slug override on multi supersede.',
			},
			{
				supersedes: 'dec-q7k2m4xab3na',
				items: ['changed:a:b:set-4f1c0a9e2b7d..set-7e2a90c4d311'],
				set: 'set-7e2a90c4d311',
				chosen: 'accept',
				reason: 'Conflicting set with items.',
			},
			{
				supersedes: 'dec-q7k2m4xab3na',
				items: ['changed:a:b:set-4f1c0a9e2b7d..set-7e2a90c4d311'],
				chosen: 'accept',
				subjects: { specimens: ['toolbar--dense'] },
				reason: 'Cannot replace subjects when accepting review item.',
			},
			// Invalid file glob syntax
			{
				slug: 'bad-glob',
				question: 'Bad glob?',
				set: 'set-9c03e1d27a55',
				chosen: 'toolbar--dense',
				reason: 'r',
				subjects: { files: ['src/[z-a]/a.ts'] },
			},
			{
				supersedes: 'dec-q7k2m4xab3na',
				items: ['changed:a:b:set-4f1c0a9e2b7d..set-7e2a90c4d311'],
				chosen: 'reject',
				reason: 'Cannot reject when superseding.',
			},
			{
				supersedes: ['dec-q7k2m4xab3na', 'dec-q7k2m4xab3na'],
				items: ['changed:a:b:set-4f1c0a9e2b7d..set-7e2a90c4d311'],
				chosen: 'accept',
				reason: 'Duplicate ids.',
			},
			{ supersedes: [], chosen: 'a', reason: 'Empty.' },
			// Mode 3: review answer
			{
				items: ['check:list--empty:color-contrast:set-4f1c0a9e2b7d..set-7e2a90c4d311'],
				chosen: 'accept',
				reason: 'Measured 7.1:1.',
			},
			{
				items: ['changed:a:b:set-4f1c0a9e2b7d..set-7e2a90c4d311'],
				chosen: 'reject',
				reason: 'Still wraps.',
				slug: 'gap-reject',
				question: 'Keep 4px?',
			},
			// Mode 3 invalid combos
			{
				items: ['changed:a:b:set-4f1c0a9e2b7d..set-7e2a90c4d311'],
				chosen: 'toolbar--dense',
				reason: 'Invalid chosen for answer.',
			},
			{
				items: ['changed:a:b:set-4f1c0a9e2b7d..set-7e2a90c4d311'],
				chosen: 'accept',
				reason: 'Has subjects.',
				subjects: { specimens: ['toolbar--dense'] },
			},
			{
				items: ['changed:a:b:set-4f1c0a9e2b7d..set-7e2a90c4d311'],
				set: 'set-7e2a90c4d311',
				chosen: 'accept',
				reason: 'Set with items without supersedes.',
			},
			{ items: ['dup', 'dup'], chosen: 'accept', reason: 'Dup items.' },
			{ items: [], chosen: 'accept', reason: 'Empty items.' },
			// Missing mode / bad types
			{ chosen: 'toolbar--dense', reason: 'No mode.' },
			{ chosen: '', set: 's', slug: 'a', question: 'q', reason: 'r' },
			{ set: 's', slug: 'a', question: 'q', chosen: 'x', reason: 123 },
			{ set: 's', slug: 'a', question: 'q', chosen: 'x', extra: true },
			{},
			null,
		];
		for (const value of recordValues)
			agrees(decisionRecordRequestSchema, parseDecisionRecordRequest, value);

		for (const value of [
			{ decision: 'dec-q7k2m4xab3na' },
			{ decision: '' },
			{ decision: 'dec-q7k2m4xab3na', extra: true },
			{},
			null,
		]) {
			agrees(decisionGetRequestSchema, parseDecisionGetRequest, value);
		}

		for (const value of [{}, { extra: true }, null, []]) {
			agrees(decisionListRequestSchema, parseDecisionListRequest, value);
		}

		for (const value of [
			{},
			{ files: ['src/toolbar/toolbar.css'] },
			{ specimens: ['toolbar--dense'], tokens: ['space.toolbar.gap'] },
			{ files: [] },
			{ files: [''] },
			{ specimens: 'toolbar--dense' },
			{ extra: true },
			null,
		]) {
			agrees(decisionCheckRequestSchema, parseDecisionCheckRequest, value);
		}
	});

	it('agrees with designStatesRequestSchema and defaults/commandManifest config fields', () => {
		for (const value of [
			{},
			{ commands: ['order-create', 'stock-list'] },
			{ scenario: 'scenarios/01.scenario.yaml', consumer: 'bookshop-ui', includeProposed: true },
			{ commands: ['order-create'], limit: 10, after: 'order-create:error-recovery' },
			{ commands: [] },
			{ commands: [''] },
			{ commands: 'order-create' },
			{ scenario: '' },
			{ includeProposed: 'yes' },
			{ limit: 0 },
			{ limit: 501 },
			{ limit: 1.5 },
			{ after: '' },
			{ extra: true },
			null,
		]) {
			agrees(designStatesRequestSchema, parseDesignStatesRequest, value);
		}
		for (const config of [
			{ commandManifest: './commands.json' },
			{ commandManifest: './commands.json', defaults: 'afd-defaults@1.0.0' },
			{ commandManifest: '' },
			{ defaults: 'afd-defaults@1.0.0' },
		]) {
			agrees(configSchema, parseConfig, config);
		}
	});

	it('agrees on panel-walk requests', () => {
		const values: unknown[] = [
			{
				job: 'publish-post',
				persona: 'screen-reader-user',
				modality: 'screen-reader',
				target: 'http://127.0.0.1:4173',
			},
			{
				job: 'publish-post',
				persona: 'keyboard-user',
				modality: 'keyboard',
				target: 'http://127.0.0.1:4173',
				appDate: '2030-05-01',
				maxActions: 25,
				baselineWalk: 'walk-1234567890ab',
				requestedTools: ['key_press', 'type'],
			},
			{
				job: 'publish-post',
				persona: 'pointer-user',
				modality: 'pointer',
				target: 'http://127.0.0.1:4173',
				appDate: '2030-02-29',
			},
			{
				job: 'publish-post',
				persona: 'low-vision-user',
				modality: 'low-vision',
				target: 'http://127.0.0.1:4173',
				appDate: '2030-02-30',
			},
			{
				job: 'publish-post',
				persona: 'pointer-user',
				modality: 'pointer',
				target: 'http://127.0.0.1:4173',
				appDate: '2024-02-29',
			},
			{
				job: 'publish-post',
				persona: 'pointer-user',
				modality: 'pointer',
				target: 'http://127.0.0.1:4173',
				appDate: 'not-a-date',
			},
			{
				job: 'publish-post',
				persona: 'agent',
				modality: 'pointer',
				target: 'http://127.0.0.1:4173',
				maxActions: 0,
			},
			{
				job: 'publish-post',
				persona: 'agent',
				modality: 'pointer',
				target: 'http://127.0.0.1:4173',
				maxActions: 501,
			},
			{
				job: 'publish-post',
				persona: 'agent',
				modality: 'pointer',
				target: 'http://127.0.0.1:4173',
				maxActions: 1.5,
			},
			{
				job: 'publish-post',
				persona: 'agent',
				modality: 'invalid',
				target: 'http://127.0.0.1:4173',
			},
			{
				job: 'publish-post',
				persona: 'agent',
				modality: 'pointer',
				target: 'http://127.0.0.1:4173',
				baselineWalk: 'bad-id',
			},
			{
				job: 'publish-post',
				persona: 'agent',
				modality: 'pointer',
				target: 'http://127.0.0.1:4173',
				requestedTools: [''],
			},
			{
				job: 'publish-post',
				persona: 'agent',
				modality: 'pointer',
				target: 'http://127.0.0.1:4173',
				requestedTools: [],
			},
			{ job: 'publish-post', persona: 'agent', modality: 'pointer', target: 'local://checkout' },
			{ job: 'publish-post', persona: 'agent', modality: 'pointer', target: 'file:///etc/passwd' },
			{ job: 'publish-post', persona: 'agent', modality: 'pointer', target: 'not-a-url' },
			{ job: '', persona: 'agent', modality: 'pointer', target: 'http://127.0.0.1:4173' },
			{ job: 'publish-post', persona: '', modality: 'pointer', target: 'http://127.0.0.1:4173' },
			{
				job: 'publish-post',
				persona: 'agent',
				modality: 'pointer',
				target: 'http://127.0.0.1:4173',
				extra: true,
			},
			{ job: 'publish-post', persona: 'agent', modality: 'pointer' },
			{},
			null,
		];
		for (const value of values) {
			agrees(panelWalkRequestSchema, parsePanelWalkRequest, value);
		}
	});
});
