import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	COMPARE_DATA_FILE,
	COMPARE_PAGE_FILE,
	readComparePageData,
	runCompare,
	selectCompareEntries,
} from './compare.js';
import { renderComparePageHtml } from './compare-page.js';
import { resolveContext } from './config.js';
import { compareRunSchema } from './schema.js';
import { captureSetsDir, readCaptureSetManifest, SET_ID_PATTERN, specimenDataDir } from './sets.js';
import {
	CAPTURE_VERSION,
	type ElementObservation,
	NORMALIZATION_VERSION,
	type Observation,
	type SpecimenEntry,
} from './types.js';

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratchDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'specimen-compare-'));
	directories.push(dir);
	return dir;
}

function makeElement(overrides: Partial<ElementObservation> = {}): ElementObservation {
	return {
		ref: 'root/div:1',
		tag: 'div',
		attributes: { role: 'toolbar' },
		box: { x: 0, y: 0, width: 320, height: 36 },
		scroll: { width: 320, height: 36, clientWidth: 320, clientHeight: 36 },
		styles: { padding: '4px', gap: '4px' },
		state: { focused: false, value: '' },
		accessibility: { role: 'toolbar', name: 'Actions' },
		...overrides,
	};
}

function makeObservation(id: string, overrides: Partial<Observation> = {}): Observation {
	const complete = { status: 'complete' as const, scope: 'structured', reasons: [] };
	const base: Observation = {
		manifest: {
			captureVersion: CAPTURE_VERSION,
			normalizationVersion: NORMALIZATION_VERSION,
			specimenId: id,
			capturedUtc: '2026-11-23T00:00:00.000Z',
			bench: { name: '@lushly-dev/specimen', version: '2.2.0', plugins: [] },
			driver: { name: 'host', emulates: ['viewport', 'color-scheme'] },
			checkpoint: {
				name: 'mount',
				actionMode: 'none',
				ready: { steps: ['upgrade', 'fonts', 'frame'], outcome: 'ready', deadlineMs: 10_000 },
				baseline: {
					clock: 'real',
					random: { source: 'seeded', seed: 1 },
					storage: 'empty',
				},
			},
			source: { revision: 'a1b2c3d', digest: 'src-digest', dirty: false },
			dependencies: 'lock-1',
			browser: { name: 'chromium', version: '151.0', platform: 'win32-x64', build: null },
			context: {
				viewport: { width: 1280, height: 800 },
				theme: 'light',
				locale: 'en-US',
				reducedMotion: 'no-preference',
				motion: 'natural',
				pixelRatio: 1,
				observed: {
					width: 1280,
					height: 800,
					media: true,
					colorScheme: 'light',
					contrast: 'no-preference',
					reducedMotion: 'no-preference',
					language: 'en-US',
					devicePixelRatio: 1,
				},
				resources: { fonts: [], remote: [] },
			},
		},
		channels: {
			dom: {
				raw: `<div role="toolbar" data-variant="${id}"><button>Save</button></div>`,
				normalized: `<div role="toolbar" data-variant="${id}"><button>Save</button></div>`,
			},
			a11y: {
				snapshot: '- toolbar "Actions"\n  - button "Save"',
				axe: {
					status: 'passed',
					policy: 'error',
					violations: [],
					incomplete: 0,
					incompleteChecks: [],
					exceptions: [],
					engine: '4.14.0',
				},
			},
			events: { declared: [], history: [] },
			evidence: {
				expectations: [],
				claims: [],
				commands: [],
				formData: [],
				validity: [],
				attributesSet: [],
			},
			elements: [makeElement()],
			console: { errors: [], warnings: [] },
			visual: { path: null },
		},
		completeness: {
			dom: complete,
			a11y: complete,
			layout: complete,
			styles: complete,
			tokens: { status: 'unsupported', scope: 'tokens', reasons: [] },
			events: { status: 'not-requested', scope: 'events', reasons: [] },
			visual: { status: 'partial', scope: 'appearance', reasons: [] },
		},
	};
	return { ...base, ...overrides };
}

const toolbarEntries: SpecimenEntry[] = [
	{ id: 'toolbar--dense', title: 'Toolbar/Dense', module: './t.ts', exportName: 'Dense' },
	{
		id: 'toolbar--airy',
		title: 'Toolbar/Airy',
		module: './t.ts',
		exportName: 'Airy',
		themes: {
			supported: ['light'],
			basis: 'declared',
			reason: 'Dark styles not written yet',
		},
	},
	{
		id: 'toolbar--grouped',
		title: 'Toolbar/Grouped',
		module: './t.ts',
		exportName: 'Grouped',
	},
	{
		id: 'toolbar--ctx-light',
		title: 'Toolbar/ContextLight',
		module: './t.ts',
		exportName: 'ContextLight',
		contexts: {
			themes: ['light'],
			reason: 'Light surface only',
		},
	},
	{
		id: 'toolbar--narrowed',
		title: 'Toolbar/Narrowed',
		module: './t.ts',
		exportName: 'Narrowed',
		themes: {
			supported: ['light', 'dark'],
			basis: 'declared',
		},
		contexts: {
			themes: ['light'],
			reason: 'Narrowed to light in this context',
		},
	},
];

describe('selectCompareEntries', () => {
	it('refuses unknown ids with SPECIMEN_NOT_FOUND naming nearest ids before capturing', () => {
		const context = resolveContext({ theme: 'light' });
		expect(() =>
			selectCompareEntries(toolbarEntries, { ids: ['toolbar--dense', 'toolbar--dence'] }, context)
		).toThrowError(
			expect.objectContaining({
				code: 'SPECIMEN_NOT_FOUND',
				message: expect.stringContaining('toolbar--dence'),
				suggestion: expect.stringContaining('toolbar--dense'),
			})
		);
	});

	it('refuses theme-excluded variants with VARIANT_UNAVAILABLE naming declared themes', () => {
		const dark = resolveContext({ theme: 'dark' });
		expect(() =>
			selectCompareEntries(toolbarEntries, { ids: ['toolbar--dense', 'toolbar--airy'] }, dark)
		).toThrowError(
			expect.objectContaining({
				code: 'VARIANT_UNAVAILABLE',
				message: expect.stringContaining('toolbar--airy'),
				suggestion: expect.stringContaining('light'),
			})
		);
		expect(() =>
			selectCompareEntries(toolbarEntries, { ids: ['toolbar--dense', 'toolbar--ctx-light'] }, dark)
		).toThrowError(
			expect.objectContaining({
				code: 'VARIANT_UNAVAILABLE',
				message: expect.stringContaining('toolbar--ctx-light'),
				suggestion: expect.stringContaining('light'),
			})
		);
		try {
			selectCompareEntries(toolbarEntries, { ids: ['toolbar--dense', 'toolbar--narrowed'] }, dark);
			expect.unreachable('expected VARIANT_UNAVAILABLE');
		} catch (err) {
			const error = err as { code?: string; message?: string; suggestion?: string };
			expect(error.code).toBe('VARIANT_UNAVAILABLE');
			expect(error.message).toContain('toolbar--narrowed');
			expect(error.suggestion).toContain('light');
			expect(error.suggestion).not.toContain('dark');
		}
	});

	it('preserves caller variant order', () => {
		const light = resolveContext({ theme: 'light' });
		const selected = selectCompareEntries(
			toolbarEntries,
			{ ids: ['toolbar--grouped', 'toolbar--dense', 'toolbar--airy'] },
			light
		);
		expect(selected.map((e) => e.id)).toEqual([
			'toolbar--grouped',
			'toolbar--dense',
			'toolbar--airy',
		]);
	});
});

describe('runCompare', () => {
	it('captures variants with axe, diffs each against the first, writes compare artifacts, and returns no observations', async () => {
		const root = await scratchDir();
		const prepare = vi.fn(async () => {});
		const render = vi.fn(
			async ({
				entry,
				context,
				screenshot,
			}: {
				entry: SpecimenEntry;
				context: ReturnType<typeof resolveContext>;
				checkpoint: string;
				axe: boolean;
				screenshot: string;
			}) => {
				await writeFile(screenshot, 'png-bytes');
				const obs = makeObservation(entry.id);
				obs.manifest.context.theme = context.theme;
				obs.manifest.context.viewport = context.viewport;
				obs.channels.visual.path = screenshot;
				if (entry.id === 'toolbar--airy') {
					obs.channels.elements = [
						makeElement({
							box: { x: 0, y: 0, width: 320, height: 52 },
							styles: { padding: '12px', gap: '12px' },
						}),
					];
				} else if (entry.id === 'toolbar--grouped') {
					obs.channels.dom.raw =
						'<div role="toolbar"><span class="group-label">Edit</span><button>Save</button></div>';
					obs.channels.a11y.axe = {
						status: 'failed',
						policy: 'error',
						violations: [
							{
								id: 'color-contrast',
								impact: 'serious',
								help: 'Elements must meet minimum color contrast ratio thresholds',
								targets: ['span.group-label'],
								details: [],
							},
						],
						incomplete: 0,
						incompleteChecks: [],
						exceptions: [],
						engine: '4.14.0',
					};
				}
				return obs;
			}
		);

		const run = await runCompare(
			{
				root,
				entries: toolbarEntries,
				workers: 2,
				prepare,
				sourceState: async () => ({ revision: 'a1b2c3d', dirty: false }),
				render,
			},
			{
				ids: ['toolbar--dense', 'toolbar--airy', 'toolbar--grouped'],
				context: { theme: 'light', viewport: { width: 1280, height: 800 } },
			}
		);

		expect(prepare).toHaveBeenCalledTimes(1);
		expect(render).toHaveBeenCalledTimes(3);
		expect(run.set).toMatch(SET_ID_PATTERN);
		expect(run.context.theme).toBe('light');
		expect(run.context.viewport).toEqual({ width: 1280, height: 800 });
		expect(run.checkpoint).toBe('mount');
		expect(run.page).toBe(`compare.html?set=${run.set}`);

		expect(run.captures).toHaveLength(3);
		expect(run.captures[0]).toMatchObject({
			id: 'toolbar--dense',
			status: 'captured',
			axe: 'passed',
			violations: [],
			screenshot: expect.stringMatching(
				/^\.specimen\/sets\/set-[0-9a-f]{12}\/screenshots\/toolbar--dense--[0-9a-f]{12}\.png$/
			),
		});
		expect(run.captures[1]).toMatchObject({
			id: 'toolbar--airy',
			status: 'captured',
			axe: 'passed',
			violations: [],
		});
		expect(run.captures[2]).toMatchObject({
			id: 'toolbar--grouped',
			status: 'captured',
			axe: 'failed',
			violations: ['color-contrast'],
		});

		expect(run.differences).toEqual([
			{
				id: 'toolbar--airy',
				against: 'toolbar--dense',
				status: 'changed',
				channels: expect.arrayContaining(['layout', 'styles']),
			},
			{
				id: 'toolbar--grouped',
				against: 'toolbar--dense',
				status: 'changed',
				channels: expect.arrayContaining(['a11y', 'dom']),
			},
		]);

		// Exit criterion 1: no Observation keys in the returned compare result.
		const serialized = JSON.stringify(run);
		expect(serialized).not.toContain('"channels":{');
		expect(serialized).not.toContain('"manifest"');
		expect(serialized).not.toContain('"completeness"');

		// Persisted set has kind 'compare', compare.json, and compare.html.
		const manifest = await readCaptureSetManifest(root, run.set);
		expect(manifest.kind).toBe('compare');

		const pageData = await readComparePageData(root, run.set);
		expect(pageData.set).toBe(run.set);
		expect(pageData.captures.map((c) => c.id)).toEqual([
			'toolbar--dense',
			'toolbar--airy',
			'toolbar--grouped',
		]);
		expect(pageData.differences[0]?.items.some((item) => item.channel === 'layout')).toBe(true);
		expect(pageData.differences[1]?.against).toBe('toolbar--dense');
		expect(JSON.stringify(pageData)).not.toContain('"manifest"');

		const html = await readFile(join(specimenDataDir(root), COMPARE_PAGE_FILE), 'utf8');
		expect(html).toContain('specimen-compare-root');
		expect(html).toContain(COMPARE_DATA_FILE);
	});

	it('refuses unknown ids and theme-excluded variants before calling prepare or render', async () => {
		const root = await scratchDir();
		const prepare = vi.fn(async () => {});
		const render = vi.fn(async () => makeObservation('toolbar--dense'));

		await expect(
			runCompare(
				{
					root,
					entries: toolbarEntries,
					workers: 2,
					prepare,
					sourceState: async () => ({ revision: null, dirty: null }),
					render,
				},
				{ ids: ['toolbar--dense', 'toolbar--dence'] }
			)
		).rejects.toMatchObject({
			code: 'SPECIMEN_NOT_FOUND',
			message: expect.stringContaining('toolbar--dence'),
			suggestion: expect.stringContaining('toolbar--dense'),
		});

		await expect(
			runCompare(
				{
					root,
					entries: toolbarEntries,
					workers: 2,
					prepare,
					sourceState: async () => ({ revision: null, dirty: null }),
					render,
				},
				{ ids: ['toolbar--dense', 'toolbar--airy'], context: { theme: 'dark' } }
			)
		).rejects.toMatchObject({
			code: 'VARIANT_UNAVAILABLE',
			message: expect.stringContaining('toolbar--airy'),
			suggestion: expect.stringContaining('light'),
		});

		expect(prepare).not.toHaveBeenCalled();
		expect(render).not.toHaveBeenCalled();
	});

	it('refuses with VARIANT_UNAVAILABLE when a variant renders in a pinned theme instead of the requested theme', async () => {
		const root = await scratchDir();
		await expect(
			runCompare(
				{
					root,
					entries: toolbarEntries,
					workers: 2,
					prepare: async () => {},
					sourceState: async () => ({ revision: null, dirty: null }),
					render: async ({ entry, context }) => {
						const obs = makeObservation(entry.id);
						obs.manifest.context.theme = entry.id === 'toolbar--grouped' ? 'dark' : context.theme;
						return obs;
					},
				},
				{ ids: ['toolbar--dense', 'toolbar--grouped'], context: { theme: 'light' } }
			)
		).rejects.toMatchObject({
			code: 'VARIANT_UNAVAILABLE',
			message: expect.stringContaining('toolbar--grouped'),
			suggestion: expect.stringContaining('dark'),
		});
		// Refused comparison writes no capture set directory.
		await expect(readdir(captureSetsDir(root))).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('gives reversed variant order distinct set ids and preserves each comparison baseline', async () => {
		const root = await scratchDir();
		const host = {
			root,
			entries: toolbarEntries,
			workers: 2,
			prepare: async () => {},
			sourceState: async () => ({ revision: 'a1b2c3d', dirty: false }),
			render: async ({
				entry,
				context,
			}: {
				entry: SpecimenEntry;
				context: ReturnType<typeof resolveContext>;
			}) => {
				const obs = makeObservation(entry.id);
				obs.manifest.context.theme = context.theme;
				return obs;
			},
		};
		const ab = await runCompare(host, {
			ids: ['toolbar--dense', 'toolbar--grouped'],
			context: { theme: 'light' },
		});
		const ba = await runCompare(host, {
			ids: ['toolbar--grouped', 'toolbar--dense'],
			context: { theme: 'light' },
		});
		expect(ab.set).not.toBe(ba.set);
		expect(ab.page).not.toBe(ba.page);
		const abPage = await readComparePageData(root, ab.set);
		const baPage = await readComparePageData(root, ba.set);
		expect(abPage.captures.map((c) => c.id)).toEqual(['toolbar--dense', 'toolbar--grouped']);
		expect(abPage.differences[0]?.against).toBe('toolbar--dense');
		expect(baPage.captures.map((c) => c.id)).toEqual(['toolbar--grouped', 'toolbar--dense']);
		expect(baPage.differences[0]?.against).toBe('toolbar--grouped');
	});

	it('validates 2 to 8 unique ids at direct runCompare entry before calling the host', async () => {
		const root = await scratchDir();
		const prepare = vi.fn(async () => {});
		const render = vi.fn(async () => makeObservation('toolbar--dense'));
		const host = {
			root,
			entries: toolbarEntries,
			workers: 2,
			prepare,
			sourceState: async () => ({ revision: null, dirty: null }),
			render,
		};
		await expect(runCompare(host, { ids: ['toolbar--dense'] })).rejects.toThrow(TypeError);
		await expect(runCompare(host, { ids: ['toolbar--dense', 'toolbar--dense'] })).rejects.toThrow(
			TypeError
		);
		expect(prepare).not.toHaveBeenCalled();
		expect(render).not.toHaveBeenCalled();
	});

	it('records a failing render as unavailable with a schema-valid non-empty reason even for empty errors', async () => {
		const root = await scratchDir();
		const run = await runCompare(
			{
				root,
				entries: toolbarEntries,
				workers: 2,
				prepare: async () => {},
				sourceState: async () => ({ revision: null, dirty: null }),
				render: async ({ entry, context }) => {
					if (entry.id === 'toolbar--grouped') throw new Error('');
					const obs = makeObservation(entry.id);
					obs.manifest.context.theme = context.theme;
					return obs;
				},
			},
			{ ids: ['toolbar--dense', 'toolbar--grouped'], context: { theme: 'light' } }
		);
		expect(compareRunSchema.safeParse(run).success).toBe(true);
		expect(run.captures[1]).toEqual({
			id: 'toolbar--grouped',
			status: 'unavailable',
			axe: 'not-run',
			violations: [],
			screenshot: null,
			reason: 'Variant toolbar--grouped failed to render.',
		});
		expect(run.differences[0]).toEqual({
			id: 'toolbar--grouped',
			against: 'toolbar--dense',
			status: 'insufficient-evidence',
			channels: [],
		});
	});

	it('generates self-contained compare.html markup within a compact size bound and without inline HTML injection sinks', () => {
		const html = renderComparePageHtml();
		expect(html).toContain('<!doctype html>');
		expect(html).toContain('specimen-compare-root');
		expect(html).toContain('compare.json');
		expect(html).not.toContain('innerHTML');
		expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(20_000);
	});
});
