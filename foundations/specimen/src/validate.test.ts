import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defaultContext } from './config.js';
import { captureRequestSchema, contextSchema } from './schema.js';
import { parseCaptureRequest, parseConfig, parseContext } from './validate.js';

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
	})
	.refine((config) => config.specimens !== undefined || config.stories !== undefined)
	.refine((config) => config.preview === undefined || config.stories !== undefined);

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
