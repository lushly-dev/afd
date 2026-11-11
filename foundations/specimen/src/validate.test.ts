import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defaultContext } from './config.js';
import {
	a11yRequestSchema,
	baselineRequestSchema,
	captureRequestSchema,
	contextSchema,
	contractRequestSchema,
	coverageRequestSchema,
	matrixRequestSchema,
	profileRequestSchema,
	suggestRequestSchema,
	suiteRequestSchema,
} from './schema.js';
import {
	parseA11yRequest,
	parseBaselineRequest,
	parseCaptureRequest,
	parseConfig,
	parseContext,
	parseContractRequest,
	parseCoverageRequest,
	parseMatrixRequest,
	parseProfileRequest,
	parseSuggestRequest,
	parseSuiteRequest,
} from './validate.js';

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
				})
			)
			.min(1)
			.optional(),
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
					z.object({ from: z.string().min(1), to: z.string().regex(/^\//) }).strict(),
				])
			)
			.optional(),
		plugins: z.array(z.string().min(1)).optional(),
		manifest: z.string().min(1).optional(),
		profile: z.strictObject({ baselines: z.string().min(1).optional() }).optional(),
		guides: z.array(z.string().min(1)).optional(),
	})
	.refine((config) => config.specimens !== undefined || config.stories !== undefined)
	.refine((config) => config.preview === undefined || config.stories !== undefined)
	.refine((config) => config.test === undefined || config.stories !== undefined)
	.refine((config) => config.guides === undefined || config.manifest !== undefined);

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
			{ specimens: [entry], staticDirs: [{ from: './site' }] },
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
		];
		for (const value of configs) agrees(configSchema, parseConfig, value);
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
			{ component: 'x-a', timeoutMs: 1 },
			{ component: 'x-a', timeoutMs: 60_001 },
			{ component: 'x-a', workers: 1 },
			{ component: 'x-a', workers: 0 },
			{ component: 'x-a', other: 1 },
			null,
		];
		for (const value of values) agrees(suggestRequestSchema, parseSuggestRequest, value);
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
	});
});
