import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { createSpecimenBench } from './bench.js';
import { loadConfig, resolveContext } from './config.js';
import { startBenchServer } from './vite.js';

it('keeps a cold automated document mounted when Vite requests a reload', async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'specimen-cold-')));
	try {
		const dependency = join(root, 'node_modules/frame-dependency');
		await mkdir(dependency, { recursive: true });
		await writeFile(
			join(dependency, 'package.json'),
			JSON.stringify({
				name: 'frame-dependency',
				version: '1.0.0',
				type: 'module',
				main: 'index.js',
			})
		);
		await writeFile(join(dependency, 'index.js'), "export const token = 'dependency ready';");
		await writeFile(
			join(root, 'probe.js'),
			`import { token } from 'frame-dependency';
export const Probe = { render() {
 const element = document.createElement('p');
 element.textContent = token;
 return element;
} };`
		);
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({
				specimens: [
					{ id: 'probe', title: 'Cold dependency', module: './probe.js', exportName: 'Probe' },
				],
			})
		);
		const config = await loadConfig({ root });
		const entry = config.config.specimens[0];
		if (!entry) throw new Error('Missing cold fixture');
		const browser = await chromium.launch({ headless: true });
		try {
			for (let cold = 0; cold < 3; cold++) {
				const server = await startBenchServer(config, { automation: true });
				const page = await browser.newPage();
				let navigations = 0;
				page.on('framenavigated', (frame) => {
					if (frame === page.mainFrame()) navigations++;
				});
				try {
					await page.goto(`${server.url}/specimen.html?automation=1`);
					await page.waitForFunction(() => Boolean(window.__specimen));
					await page.evaluate(({ entry, context }) => window.__specimen.mount(entry, context), {
						entry,
						context: resolveContext(),
					});
					// Deterministically reproduce the reload message seen during dependency discovery.
					server.server.ws.send({ type: 'full-reload', path: '/specimen.html' });
					await page.evaluate(() => new Promise((done) => setTimeout(done, 100)));
					const capture = await page.evaluate(() => window.__specimen.capture());
					expect(capture.dom).toContain('dependency ready');
					expect(navigations).toBe(1);
					await page.evaluate(() => window.__specimen.dispose());
				} finally {
					await page.close();
					await server.close();
				}
			}
		} finally {
			await browser.close();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it('preserves a render failure when disposal also fails', async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'specimen-cleanup-')));
	let bench: Awaited<ReturnType<typeof createSpecimenBench>> | undefined;
	try {
		await writeFile(
			join(root, 'probe.js'),
			`export const Probe = {
 render() { return document.createElement('button'); },
 targets: { missing: { selector: '.missing' } },
 scenario: [{ action: { click: 'missing' } }],
 dispose() { throw new Error('cleanup-marker'); }
};`
		);
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({
				specimens: [
					{ id: 'probe', title: 'Cleanup failure', module: './probe.js', exportName: 'Probe' },
				],
			})
		);
		bench = await createSpecimenBench({ root });
		const error = await bench
			.render({ id: 'probe', checkpoint: 'after-run' })
			.catch((value: unknown) => value);
		expect(error).toBeInstanceOf(AggregateError);
		if (!(error instanceof AggregateError)) throw new Error('Expected both failures');
		expect(String(error.errors[0])).toContain('Target must identify exactly one element: missing');
		expect(String(error.errors[1])).toContain('cleanup-marker');
	} finally {
		await bench?.close();
		await rm(root, { recursive: true, force: true });
	}
});
