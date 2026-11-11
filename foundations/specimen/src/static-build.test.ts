import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
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
	styles: { file: string; bytes: number; budget: number };
	categories: Record<string, { bytes: number; budget: number }>;
	reported: { catalog: number; incumbent: number; consumer: number };
	entries: { id: string; title: string; url: string; story?: { play: string } }[];
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

	it('reports the pages’ own stylesheet against its own ceiling, apart from the JavaScript', async () => {
		const { report, dir } = whole;
		expect(report.styles.file).toMatch(/^assets\/page-.+\.css$/);
		expect(report.styles.budget).toBe(8_000);
		expect(report.styles.bytes).toBeGreaterThan(1_000);
		expect(report.styles.bytes).toBeLessThanOrEqual(report.styles.budget);
		expect((await readFile(join(dir, report.styles.file))).byteLength).toBe(report.styles.bytes);
		expect(report.chunks.some((chunk) => chunk.file === report.styles.file)).toBe(false);
	});

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

		it('groups the index by component, and filters it with counts it keeps in the URL', async () => {
			const { page } = await open('');
			const status = page.getByRole('status');
			const groups = new Set(whole.report.entries.map((entry) => entry.title));
			await expect
				.poll(() => status.textContent())
				.toBe(`${whole.report.entries.length} specimens in ${groups.size} groups`);
			const card = page.getByRole('region', { name: 'Fixtures / Cases' });
			expect(await card.getByRole('link', { name: 'Precedence' }).count()).toBe(1);
			const filter = page.getByRole('searchbox', { name: 'Filter' });
			await filter.fill('fixtures-cases--precedence');
			expect(await status.textContent()).toBe(
				`1 of ${whole.report.entries.length} specimens in 1 groups`
			);
			expect(await page.locator('main li:not([hidden]) a').allTextContents()).toEqual([
				'Precedence',
			]);
			expect(await card.locator('h3 span').textContent()).toBe('1');
			expect(new URL(page.url()).searchParams.get('q')).toBe('fixtures-cases--precedence');
			await page.reload();
			expect(await filter.inputValue()).toBe('fixtures-cases--precedence');
			expect(await page.locator('main li:not([hidden])').count()).toBe(1);
			await filter.fill('');
			expect(await page.locator('main li[hidden], main section[hidden]').count()).toBe(0);
			await page.context().close();
		});

		it('styles the index and preview, and never a story’s frame or an automated page', async () => {
			const stylesheet = `/${whole.report.styles.file}`;
			const loaded = (page: Page | import('playwright').Frame) =>
				page.evaluate(
					(href) =>
						[...document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')].some(
							(link) => new URL(link.href).pathname === href && link.sheet !== null
						),
					stylesheet
				);
			const index = await open('');
			await index.page.waitForSelector('main ul a');
			expect(await loaded(index.page)).toBe(true);
			expect(index.failed).toEqual([]);
			await index.page.context().close();
			const preview = await open('specimen.html?id=fixtures-cases--precedence');
			const frame = await settledFrame(preview.page);
			expect(await loaded(preview.page)).toBe(true);
			expect(await loaded(frame)).toBe(false);
			expect(preview.requests.filter((path) => path === stylesheet)).toHaveLength(1);
			await preview.page.context().close();
			const automated = await open('specimen.html?automation=1');
			expect(await loaded(automated.page)).toBe(false);
			expect(automated.requests).not.toContain(stylesheet);
			await automated.page.context().close();
		});

		it('applies a preset viewport when picked, and a custom size on submit', async () => {
			const { page } = await open('specimen.html?id=fixtures-cases--precedence');
			await settledFrame(page);
			const size = page.getByRole('combobox', { name: 'Viewport' });
			const width = page.getByRole('spinbutton', { name: 'Width' });
			const apply = page.getByRole('button', { name: 'Apply' });
			expect(await size.inputValue()).toBe('1280x720');
			expect(await width.isVisible()).toBe(false);
			// Apply is only for typed dimensions; a preset applies as it is picked.
			expect(await apply.isVisible()).toBe(false);
			await Promise.all([
				page.waitForURL(/[?&]viewport=375x812(?:&|$)/),
				size.selectOption('375x812'),
			]);
			expect(await (await settledFrame(page)).evaluate(() => innerWidth)).toBe(375);
			const before = page.url();
			await size.selectOption('custom');
			// Choosing Custom changes nothing until the typed size is applied.
			expect(page.url()).toBe(before);
			expect(await apply.isVisible()).toBe(true);
			await width.fill('500');
			await page.getByRole('spinbutton', { name: 'Height' }).fill('400');
			await Promise.all([page.waitForURL(/[?&]viewport=500x400(?:&|$)/), apply.click()]);
			const frame = await settledFrame(page);
			expect(await frame.evaluate(() => [innerWidth, innerHeight])).toEqual([500, 400]);
			expect(await size.inputValue()).toBe('custom');
			expect(await width.inputValue()).toBe('500');
			await page.context().close();
		});

		it('resizes the frame by dragging its corner, and keeps the size it was dragged to', async () => {
			const { page } = await open('specimen.html?id=fixtures-cases--precedence&viewport=600x400');
			const frame = await settledFrame(page);
			const box = await page.locator('.specimen-viewport').boundingBox();
			if (!box) throw new Error('No resizable frame');
			await page.mouse.move(box.x + box.width - 3, box.y + box.height - 3);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width - 203, box.y + box.height + 97, { steps: 10 });
			await page.mouse.up();
			await expect.poll(() => frame.evaluate(() => innerWidth)).toBeLessThan(450);
			const [w, hgt] = await frame.evaluate(() => [innerWidth, innerHeight]);
			expect(hgt).toBeGreaterThan(450);
			await expect.poll(() => new URL(page.url()).searchParams.get('viewport')).toBe(`${w}x${hgt}`);
			expect(await page.locator('figcaption').textContent()).toContain(`${w} × ${hgt}`);
			expect(await page.getByRole('combobox', { name: 'Viewport' }).inputValue()).toBe('custom');
			expect(await page.getByRole('spinbutton', { name: 'Width' }).inputValue()).toBe(String(w));
			await page.reload();
			expect(await (await settledFrame(page)).evaluate(() => [innerWidth, innerHeight])).toEqual([
				w,
				hgt,
			]);
			await page.context().close();
		});

		it('passes axe on the index and the preview, in the light and dark themes', async () => {
			const axe = await readFile(
				createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
				'utf8'
			);
			for (const theme of ['light', 'dark'])
				for (const path of [
					`?theme=${theme}`,
					`specimen.html?id=fixtures-cases--precedence&theme=${theme}`,
				]) {
					const { page } = await open(path);
					await page.waitForSelector(path.startsWith('?') ? 'main ul a' : 'iframe');
					await page.addScriptTag({ content: axe });
					// The page's own markup: a story is checked by its own run, not here.
					const violations = await page.evaluate(async () => {
						const run = await (
							window as unknown as {
								axe: {
									run(
										context: unknown
									): Promise<{ violations: { id: string; nodes: unknown[] }[] }>;
								};
							}
						).axe.run({ exclude: [['iframe']] });
						return run.violations.map((violation) => `${violation.id} (${violation.nodes.length})`);
					});
					expect(violations, `${path}`).toEqual([]);
					await page.context().close();
				}
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
