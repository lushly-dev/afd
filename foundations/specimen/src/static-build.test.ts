import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveStatic } from '../fixtures/serve-static.js';
import { createSpecimenBench } from './bench.js';

// The static build as a reviewer meets it, on the retained fixtures: its accounting, its manifest
// and its links, over a plain server with no Vite and no host.
const compat = resolve(import.meta.dirname, '../compat');

interface BuildReport {
	shellBytes: number;
	budget: number;
	total: { bytes: number; budget: number };
	categories: Record<string, { bytes: number; budget: number }>;
	reported: { catalog: number; incumbent: number; consumer: number };
	entries: { id: string; url: string; story?: { play: string } }[];
	chunks: { file: string; category: string; bytes: number }[];
}

let scratch: string;

async function built(
	name: string,
	stories?: string[]
): Promise<{ dir: string; report: BuildReport }> {
	const configFile = join(scratch, `${name}.config.json`);
	const config = JSON.parse(await readFile(join(compat, 'specimen.config.json'), 'utf8'));
	await writeFile(
		configFile,
		JSON.stringify({
			...config,
			stories: (stories ?? config.stories).map((path: string) => resolve(compat, path)),
			preview: config.preview && resolve(compat, config.preview),
			manifest: config.manifest && resolve(compat, config.manifest),
			staticDirs: config.staticDirs?.map((entry: { from: string; to: string } | string) =>
				typeof entry === 'string'
					? resolve(compat, entry)
					: { from: resolve(compat, entry.from), to: entry.to }
			),
		})
	);
	const bench = await createSpecimenBench({ root: compat, configFile });
	try {
		const dir = join(scratch, name);
		await bench.build(dir);
		return { dir, report: JSON.parse(await readFile(join(dir, 'specimen-build.json'), 'utf8')) };
	} finally {
		await bench.close();
	}
}

beforeAll(async () => {
	scratch = await mkdtemp(join(tmpdir(), 'specimen-static-build-'));
});
afterAll(async () => {
	await rm(scratch, { recursive: true, force: true });
});

describe('the build accounting', () => {
	let whole: Awaited<ReturnType<typeof built>>;
	beforeAll(async () => {
		whole = await built('whole');
	}, 120_000);

	it('counts a play’s helpers as interaction support, and capture code as the shell', () => {
		const { report } = whole;
		expect(Object.keys(report.categories).sort()).toEqual([
			'accessibility',
			'interaction',
			'shell',
		]);
		const helpers = report.chunks.filter((chunk) => chunk.file.includes('interaction-support'));
		expect(helpers.length).toBeGreaterThan(0);
		for (const chunk of helpers) expect(chunk.category).toBe('interaction');
		// `storybook/test` is far larger than the bench's own story runtime.
		expect(report.categories.interaction?.bytes).toBeGreaterThan(200_000);
		expect(report.shellBytes).toBe(report.categories.shell?.bytes);
		expect(report.shellBytes).toBeLessThanOrEqual(report.budget);
		// Capture code is in the shell's own chunk, not a lazy one beside it.
		expect(report.chunks.some((chunk) => chunk.file.includes('normalize'))).toBe(false);
	});

	it('sums every budgeted category once, and reports the rest with no ceiling', () => {
		const { report } = whole;
		const sum = (categories: string[]) =>
			report.chunks
				.filter((chunk) => categories.includes(chunk.category))
				.reduce((bytes, chunk) => bytes + chunk.bytes, 0);
		expect(report.total.bytes).toBe(sum(['shell', 'interaction', 'accessibility']));
		expect(report.total.bytes).toBeLessThanOrEqual(report.total.budget);
		expect(report.reported).toEqual({
			catalog: sum(['catalog']),
			incumbent: sum(['incumbent']),
			consumer: sum(['consumer']),
		});
		expect(new Set(report.chunks.map((chunk) => chunk.category))).not.toContain(undefined);
	});

	it('counts Specimen’s own helpers and all they bring, and brings no Storybook', async () => {
		const native = await built('native', ['native/native.stories.ts']);
		expect(native.report.reported.incumbent).toBe(0);
		expect(native.report.categories.interaction?.bytes).toBeGreaterThan(200_000);
		// Only the fixture's own code: nothing the helpers import is left to look like a consumer's.
		expect(native.report.reported.consumer).toBeLessThan(5_000);
	}, 120_000);

	it('keeps the shell constant as stories grow: the catalog is what grows', async () => {
		const one = await built('one', ['stories/ordered.stories.ts']);
		expect(one.report.entries.length).toBeLessThan(whole.report.entries.length);
		expect(one.report.shellBytes).toBe(whole.report.shellBytes);
		expect(one.report.reported.catalog).toBeLessThan(whole.report.reported.catalog);
	}, 120_000);

	it('lists each case with its link in the manifest', () => {
		const { report } = whole;
		expect(report.entries.length).toBeGreaterThan(5);
		for (const entry of report.entries)
			expect(entry.url).toBe(`specimen.html?id=${encodeURIComponent(entry.id)}`);
	});

	describe('over a plain server', () => {
		let server: Awaited<ReturnType<typeof serveStatic>>;
		let browser: Browser;
		beforeAll(async () => {
			server = await serveStatic(whole.dir);
			browser = await chromium.launch({ headless: true });
		});
		afterAll(async () => {
			await browser.close();
			await server.close();
		});

		/** A fresh page, recording the story chunks and failed URLs it asks for. */
		async function open(
			path: string
		): Promise<{ page: Page; requests: string[]; failed: string[] }> {
			const context = await browser.newContext();
			const page = await context.newPage();
			const requests: string[] = [];
			const failed: string[] = [];
			page.on('response', (response) => {
				requests.push(new URL(response.url()).pathname);
				if (response.status() >= 400) failed.push(response.url());
			});
			await page.goto(`${server.url}/${path}`);
			return { page, requests, failed };
		}

		async function settledFrame(page: Page) {
			const handle = await page.waitForSelector('iframe');
			const frame = await handle.contentFrame();
			if (!frame) throw new Error('No preview frame');
			await frame.waitForSelector('html[data-specimen-preview], #specimen-page-error', {
				state: 'attached',
			});
			return frame;
		}

		it('links every case from an index that loads no story module', async () => {
			const { page, requests, failed } = await open('');
			await page.waitForSelector('main ul a');
			const links = await page.$$eval('main ul a', (anchors) =>
				anchors.map((anchor) => (anchor as HTMLAnchorElement).href)
			);
			expect(links.map((link) => new URL(link).searchParams.get('id')).sort()).toEqual(
				whole.report.entries.map((entry) => entry.id).sort()
			);
			for (const link of links) expect(new URL(link).searchParams.get('theme')).toBe('light');
			expect(requests.filter((path) => /stories/.test(path))).toEqual([]);
			expect(failed).toEqual([]);
			await page.context().close();
		});

		it('opens a case at mount, and at after-run when its play can run here', async () => {
			const id = 'fixtures-cases--precedence';
			const mounted = await open(`specimen.html?id=${id}`);
			const frame = await settledFrame(mounted.page);
			expect(await frame.locator('#specimen-page-error').count()).toBe(0);
			await mounted.page.context().close();

			const after = await open(`specimen.html?id=${id}&checkpoint=after-run`);
			const ran = await settledFrame(after.page);
			expect(new URL(ran.url()).searchParams.get('checkpoint')).toBe('after-run');
			expect(await ran.locator('#specimen-page-error').count()).toBe(0);
			await after.page.context().close();
		});

		it('says what it cannot reach, rather than showing mount as a named checkpoint', async () => {
			const entry = whole.report.entries[0];
			if (!entry) throw new Error('The fixtures have no entries');
			const { page } = await open(
				`specimen.html?id=${encodeURIComponent(entry.id)}&checkpoint=after-click`
			);
			expect(await page.locator('#specimen-page-checkpoint-notice').textContent()).toContain(
				`specimen render ${entry.id} --checkpoint after-click`
			);
			await settledFrame(page);
			await page.context().close();
		});

		it('shows a failing play in its frame: without the host, a real keyboard is undefined', async () => {
			const { page } = await open(
				'specimen.html?id=fixtures-cases--real-keyboard&checkpoint=after-run'
			);
			const frame = await settledFrame(page);
			// The stand-in, not the real module, which refuses to load outside Vitest.
			const message = await frame.locator('#specimen-page-error').textContent();
			expect(message).not.toContain('Browser Mode');
			expect(message).toContain('keyboard');
			await page.context().close();
		});

		it('serves what staticDirs copied', async () => {
			const response = await fetch(`${server.url}/fixture-static/note.txt`);
			expect(response.status).toBe(200);
			expect((await response.text()).length).toBeGreaterThan(0);
		});
	});
});
