import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diffObservations } from './diff.js';
import { createSpecimenBench } from './index.js';
import type { ElementObservation, Observation } from './types.js';

const root = resolve(import.meta.dirname, '../fixtures');
let bench: Awaited<ReturnType<typeof createSpecimenBench>>;
let artifacts: string;

function element(capture: Observation, tag: string): ElementObservation {
	const found = capture.channels.elements.find((entry) => entry.tag === tag);
	if (!found) throw new Error(`No ${tag} observation in ${capture.manifest.specimenId}`);
	return found;
}

async function serveStatic(directory: string): Promise<{ url: string; close(): Promise<void> }> {
	const mime: Record<string, string> = {
		'.html': 'text/html',
		'.js': 'text/javascript',
		'.css': 'text/css',
		'.json': 'application/json',
		'.png': 'image/png',
	};
	const server = createServer((request, response) => {
		void (async () => {
			try {
				const pathname = decodeURIComponent(
					new URL(request.url ?? '/', 'http://localhost').pathname
				);
				const file = resolve(directory, `.${pathname === '/' ? '/index.html' : pathname}`);
				if (relative(directory, file).startsWith('..')) {
					response.writeHead(403).end();
					return;
				}
				const body = await readFile(file);
				response.writeHead(200, {
					'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
				});
				response.end(body);
			} catch {
				response.writeHead(404).end();
			}
		})();
	});
	await new Promise<void>((resolveListen, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolveListen);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('No static server address');
	return {
		url: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise<void>((resolveClose, reject) => {
				server.close((error) => (error ? reject(error) : resolveClose()));
			}),
	};
}

async function serveEventStream(): Promise<{ url: string; close(): Promise<void> }> {
	const server = createServer((_request, response) => {
		response.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': 'no-cache',
		});
		response.write('data: ready\n\n');
	});
	await new Promise<void>((resolveListen, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolveListen);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('No stream server address');
	return {
		url: `http://127.0.0.1:${address.port}/events`,
		close: () =>
			new Promise<void>((resolveClose, reject) => {
				server.closeAllConnections();
				server.close((error) => (error ? reject(error) : resolveClose()));
			}),
	};
}

describe('native specimen feasibility in Chromium', () => {
	beforeAll(async () => {
		artifacts = await mkdtemp(join(tmpdir(), 'specimen-feasibility-'));
		bench = await createSpecimenBench({ root });
	});

	afterAll(async () => {
		await bench?.close();
		if (artifacts) await rm(artifacts, { recursive: true, force: true });
	});

	it('lists metadata and renders a selected case without executing unrelated modules', async () => {
		expect(bench.list().map((entry) => entry.id)).toContain('unrelated');
		const baseline = await bench.render({ id: 'baseline' });
		expect(baseline.channels.dom.raw).toContain('Save');
		expect(baseline.channels.console.errors).toEqual([]);
		await expect(bench.render({ id: 'unrelated' })).rejects.toThrow('unrelated-module-executed');
	});

	it('detects an adopted-stylesheet layout change with identical markup and ARIA', async () => {
		const baseline = await bench.render({ id: 'baseline' });
		const changed = await bench.render({ id: 'padded' });
		expect(changed.channels.dom.normalized).toBe(baseline.channels.dom.normalized);
		expect(changed.channels.a11y.snapshot).toBe(baseline.channels.a11y.snapshot);
		const before = element(baseline, 'button');
		const after = element(changed, 'button');
		expect(before.styles['padding-top']).toBe('8px');
		expect(after.styles['padding-top']).toBe('40px');
		expect(after.box.width).toBeGreaterThan(before.box.width + 60);
		expect(after.box.height).toBeGreaterThan(before.box.height + 60);
		const diff = diffObservations(baseline, changed);
		expect(diff.status).toBe('changed');
		expect(diff.differences.some((entry) => entry.channel === 'layout')).toBe(true);
		expect(diff.differences.some((entry) => entry.channel === 'styles')).toBe(true);
	});

	it('records overflow geometry and the clipping style', async () => {
		const capture = await bench.render({ id: 'clipped' });
		const clip = capture.channels.elements.find(
			(entry) => entry.attributes['data-probe'] === 'clip'
		);
		expect(clip).toBeDefined();
		expect(clip?.scroll.width).toBeGreaterThan(clip?.scroll.clientWidth ?? 0);
		expect(clip?.styles['overflow-x']).toBe('hidden');
	});

	it('observes native live state which is absent from markup attributes', async () => {
		const unchecked = await bench.render({ id: 'unchecked' });
		const checked = await bench.render({ id: 'checked' });
		expect(checked.channels.dom.normalized).toBe(unchecked.channels.dom.normalized);
		expect(element(unchecked, 'input').state.checked).toBe(false);
		expect(element(checked, 'input').state.checked).toBe(true);
		expect(
			diffObservations(unchecked, checked).differences.some((entry) => entry.channel === 'state')
		).toBe(true);
		const activated = await bench.render({ id: 'activated', checkpoint: 'checked' });
		expect(element(activated, 'input').state.checked).toBe(true);
		expect(activated.manifest.checkpoint).toBe('checked');
	});

	it('includes next-frame click and fill updates at action checkpoints', async () => {
		const clicked = await bench.render({ id: 'frame-updated', checkpoint: 'clicked' });
		expect(element(clicked, 'button').attributes['aria-pressed']).toBe('true');
		expect(clicked.channels.a11y.snapshot).toContain('[pressed]');
		for (const checkpoint of ['filled', 'after-run']) {
			const filled = await bench.render({ id: 'frame-updated', checkpoint });
			expect(element(filled, 'input').state.value).toBe('frame-value');
			expect(filled.channels.dom.raw).toContain('data-submitted="frame-value"');
			expect(filled.channels.dom.raw).toContain('data-clicked-before-input="true"');
		}
	});

	it('reports accessible-name and label-relationship changes', async () => {
		const named = await bench.render({ id: 'named' });
		const renamed = await bench.render({ id: 'renamed' });
		expect(named.channels.a11y.snapshot).toContain('Save');
		expect(renamed.channels.a11y.snapshot).toContain('Delete');
		expect(
			diffObservations(named, renamed).differences.some((entry) => entry.channel === 'a11y')
		).toBe(true);
		const labeled = await bench.render({ id: 'generated-one' });
		const broken = await bench.render({ id: 'broken-relationship' });
		expect(labeled.channels.a11y.snapshot).toContain('textbox "Account"');
		expect(broken.channels.a11y.snapshot).not.toContain('textbox "Account"');
		expect(
			diffObservations(labeled, broken).differences.some((entry) => entry.channel === 'a11y')
		).toBe(true);
		expect(diffObservations(labeled, broken).status).toBe('changed');
		expect(broken.channels.dom.normalized).toContain('missing-target');
	});

	it('canonicalizes generated identifiers while retaining relationship meaning', async () => {
		const first = await bench.render({ id: 'generated-one' });
		const second = await bench.render({ id: 'generated-two' });
		expect(first.channels.dom.raw).not.toBe(second.channels.dom.raw);
		expect(first.channels.dom.normalized).toBe(second.channels.dom.normalized);
		expect(diffObservations(first, second).status).toBe('no-change-observed');
	});

	it('captures hover and focus at explicit interaction checkpoints', async () => {
		const mounted = await bench.render({ id: 'interactive' });
		const hovered = await bench.render({ id: 'interactive', checkpoint: 'hovered' });
		const focused = await bench.render({ id: 'interactive', checkpoint: 'focused' });
		expect(element(mounted, 'button').styles.color).toBe('rgb(0, 0, 0)');
		expect(element(hovered, 'button').styles.color).toBe('rgb(255, 0, 0)');
		expect(element(focused, 'button').state.focused).toBe(true);
		expect(element(focused, 'button').styles['outline-width']).toBe('4px');
		await expect(bench.render({ id: 'interactive', checkpoint: 'missing' })).rejects.toThrow(
			/checkpoint/i
		);
	});

	it('distinguishes a narrow container from an actual mobile viewport', async () => {
		const framed = await bench.render({
			id: 'viewport',
			context: { viewport: { width: 1200, height: 900 }, container: { width: 375 } },
		});
		const mobile = await bench.render({
			id: 'viewport',
			context: { viewport: { width: 375, height: 812 }, container: { width: 375 } },
		});
		const desktopButton = element(framed, 'button');
		const mobileButton = element(mobile, 'button');
		expect(desktopButton.attributes['data-window-width']).toBe('1200');
		expect(desktopButton.attributes['data-mobile']).toBe('false');
		expect(desktopButton.box.width).toBe(600);
		expect(desktopButton.styles.color).toBe('rgb(0, 0, 0)');
		expect(mobileButton.attributes['data-window-width']).toBe('375');
		expect(mobileButton.attributes['data-mobile']).toBe('true');
		expect(mobileButton.box.width).toBe(187.5);
		expect(mobileButton.styles.color).toBe('rgb(255, 0, 0)');
	});

	it('waits for declared readiness and can render a fresh registration repeatedly', async () => {
		const ready = await bench.render({ id: 'async-ready' });
		expect(ready.channels.dom.raw).toContain('Ready');
		expect(ready.channels.dom.raw).not.toContain('Loading');
		const first = await bench.render({ id: 'baseline' });
		const second = await bench.render({ id: 'baseline' });
		expect(diffObservations(first, second).status).toBe('no-change-observed');
	});

	it('fails readiness, deadline and disposal errors and remains usable afterward', async () => {
		await expect(bench.render({ id: 'readiness-failure' })).rejects.toThrow('readiness-marker');
		await expect(bench.render({ id: 'readiness-timeout', timeoutMs: 100 })).rejects.toThrow(
			/timeout|timed out|deadline/i
		);
		await expect(bench.render({ id: 'disposal-failure' })).rejects.toThrow('disposal-marker');
		const recovered = await bench.render({ id: 'baseline' });
		expect(recovered.channels.dom.raw).toContain('Save');
	});

	it('writes a screenshot and exposes unsupported visual evidence', async () => {
		const path = join(artifacts, 'button.png');
		const captured = await bench.render({ id: 'baseline', screenshot: path });
		expect(captured.channels.visual.path).toBe(path);
		expect((await stat(path)).size).toBeGreaterThan(0);
		expect((await readFile(path)).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
		const canvas = await bench.render({ id: 'canvas' });
		expect(diffObservations(canvas, canvas, { requireVisual: true }).status).toBe(
			'insufficient-evidence'
		);
		const closed = await bench.render({ id: 'closed' });
		expect(closed.completeness.dom.status).toBe('partial');
		expect(closed.completeness.dom.reasons.join(' ')).toMatch(/closed|inaccessible/i);
		expect(closed.completeness.tokens.status).toBe('unsupported');
		expect(closed.channels.a11y.axe).toBe('not-run');
	});

	it('rejects unsupported play and slots instead of ignoring their behavior', async () => {
		for (const id of ['unsupported-play', 'unsupported-slots']) {
			await expect(bench.render({ id })).rejects.toThrow(/unsupported|play|slots/i);
		}
		const recovered = await bench.render({ id: 'baseline' });
		expect(recovered.channels.dom.raw).toContain('Save');
	});

	it('rejects unsupported scenario steps before executing earlier target actions', async () => {
		for (const id of ['unsupported-expectation', 'unsupported-command']) {
			const failure = await bench.render({ id, checkpoint: 'after-run' }).then(
				() => {
					throw new Error(`Unexpected successful render: ${id}`);
				},
				(error: unknown) => error
			);
			expect(failure).toBeInstanceOf(Error);
			if (!(failure instanceof Error)) throw new Error('Expected an Error rejection');
			expect(failure.message).toMatch(/unsupported|expect|command/i);
			expect(failure.message).not.toContain('action-executed-before-validation');
		}
		const recovered = await bench.render({ id: 'baseline' });
		expect(recovered.channels.dom.raw).toContain('Save');
	});

	it('marks natural animation observations partial and settles explicit captures', async () => {
		const natural = await bench.render({ id: 'animated', context: { motion: 'natural' } });
		expect(natural.completeness.layout.status).toBe('partial');
		expect(natural.completeness.styles.status).toBe('partial');
		expect(natural.completeness.layout.reasons.join(' ')).toMatch(/time-dependent/i);
		expect(diffObservations(natural, natural).status).toBe('insufficient-evidence');
		const settled = await bench.render({ id: 'animated', context: { motion: 'settled' } });
		const repeated = await bench.render({ id: 'animated', context: { motion: 'settled' } });
		expect(settled.completeness.layout.status).toBe('complete');
		expect(settled.completeness.styles.status).toBe('complete');
		expect(diffObservations(settled, repeated).status).toBe('no-change-observed');
	});

	it('marks ancestor transform animation partial and settles it explicitly', async () => {
		for (const id of ['body-animated', 'html-animated']) {
			const natural = await bench.render({ id, context: { motion: 'natural' } });
			expect(natural.completeness.layout.status).toBe('partial');
			expect(natural.completeness.styles.status).toBe('partial');
			expect(diffObservations(natural, natural).status).toBe('insufficient-evidence');
			const settled = await bench.render({ id, context: { motion: 'settled' } });
			const repeated = await bench.render({ id, context: { motion: 'settled' } });
			expect(settled.completeness.layout.status).toBe('complete');
			expect(settled.completeness.styles.status).toBe('complete');
			expect(diffObservations(settled, repeated).status).toBe('no-change-observed');
		}
	});

	it('marks a native declarative closed shadow root inaccessible', async () => {
		const capture = await bench.render({ id: 'declarative-closed' });
		expect(capture.completeness.dom.status).toBe('partial');
		expect(capture.completeness.dom.reasons.join(' ')).toMatch(/closed|inaccessible/i);
		expect(capture.channels.dom.raw).not.toContain('Opaque declarative internals');
		expect(element(capture, 'section').box.height).toBeGreaterThan(0);
		expect(diffObservations(capture, capture).status).toBe('insufficient-evidence');
	});

	it('captures a ready specimen without awaiting an application event stream to end', async () => {
		const server = await serveEventStream();
		const project = await realpath(await mkdtemp(join(tmpdir(), 'specimen-stream-')));
		let streamingBench: Awaited<ReturnType<typeof createSpecimenBench>> | undefined;
		try {
			await writeFile(
				join(project, 'stream.js'),
				`
export const Stream = {
 render() {
  const element = document.createElement('p');
  element.textContent = 'Waiting for first event';
  const source = new EventSource(${JSON.stringify(server.url)});
  return {
   element,
   ready: new Promise((resolve, reject) => {
    source.onmessage = () => { element.textContent = 'Stream ready'; resolve(); };
    source.onerror = () => reject(new Error('stream connection failed'));
   }),
   dispose: () => source.close()
  };
 }
};
`
			);
			await writeFile(
				join(project, 'specimen.config.json'),
				JSON.stringify({
					specimens: [
						{ id: 'stream', title: 'Streaming', module: './stream.js', exportName: 'Stream' },
					],
				})
			);
			streamingBench = await createSpecimenBench({ root: project });
			const capture = await streamingBench.render({ id: 'stream', timeoutMs: 3000 });
			expect(capture.channels.dom.raw).toContain('Stream ready');
			expect(capture.manifest.source.digest.length).toBeGreaterThan(0);
		} finally {
			try {
				await streamingBench?.close();
			} finally {
				await server.close();
				await rm(project, { recursive: true, force: true });
			}
		}
	});

	it('builds an independently loadable static bench within the shell budget', async () => {
		const output = join(artifacts, 'static');
		const result = await bench.build(output);
		expect(result.directory).toBe(output);
		expect(result.shellBytes).toBeGreaterThan(0);
		expect(result.shellBytes).toBeLessThanOrEqual(result.budget);
		expect(result.budget).toBe(50_000);
		expect(result.files.some((file) => file.endsWith('.js'))).toBe(true);
		expect((await readFile(join(output, 'specimen.html'), 'utf8')).length).toBeGreaterThan(0);
		const server = await serveStatic(output);
		let browser: Browser | undefined;
		try {
			browser = await chromium.launch({ headless: true });
			const page = await browser.newPage();
			const errors: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			await page.goto(server.url);
			expect(await page.getByRole('heading', { name: 'Specimens' }).count()).toBe(1);
			expect(await page.getByRole('link', { name: /Feasibility\/Baseline/ }).count()).toBe(1);
			await page.goto(`${server.url}/specimen.html?id=baseline`);
			await page.frameLocator('iframe').getByRole('button', { name: 'Save' }).waitFor();
			expect(errors).toEqual([]);
			await page.goto(`${server.url}/specimen.html?id=viewport&viewport=375x812&theme=dark`);
			await page.frameLocator('iframe').locator('.viewport-button').waitFor();
			const frame = page.frames().find((candidate) => candidate.parentFrame());
			if (!frame) throw new Error('No built specimen iframe');
			const captured = await frame.evaluate(() => window.__specimen.capture());
			expect(captured.viewport.width).toBe(375);
			expect(captured.viewport.media).toBe(true);
			expect(captured.elements.find((entry) => entry.tag === 'button')?.box.width).toBe(187.5);
			expect(
				await frame.evaluate(() => getComputedStyle(document.documentElement).colorScheme)
			).toBe('dark');
			await page.getByRole('combobox', { name: 'Theme' }).selectOption('light');
			await Promise.all([
				page.waitForURL(/[?&]theme=light(?:&|$)/),
				page.getByRole('button', { name: 'Apply context' }).click(),
			]);
			await page.frameLocator('iframe').locator('.viewport-button').waitFor();
			const lightFrame = page.frames().find((candidate) => candidate.parentFrame());
			if (!lightFrame) throw new Error('No specimen iframe after context change');
			expect(await lightFrame.evaluate(() => window.innerWidth)).toBe(375);
			expect(
				await lightFrame.evaluate(() => getComputedStyle(document.documentElement).colorScheme)
			).toBe('light');
			expect(errors).toEqual([]);
		} finally {
			try {
				await browser?.close();
			} finally {
				await server.close();
			}
		}
	});
});
