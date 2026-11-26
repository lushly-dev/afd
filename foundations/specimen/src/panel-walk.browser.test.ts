/**
 * Real Chromium Playwright browser tests for `panel-walk` (Agent-First Design Phase C1).
 *
 * Exercises the default browser modality host against live local HTTP pages with ZERO
 * `data-fault` markers and ZERO seed-library string shortcuts across all 12 Phase 0 fault
 * classes (F1–F12), cross-modality isolation, HTTP error handling, and `appDate` clock pinning.
 */

import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench } from './bench.js';
import type { Modality } from './panel-types.js';

const PAGES: Record<string, string> = {
	clean: `<!doctype html><html><head><style>
		body { font-family: sans-serif; margin: 16px; }
		button:focus-visible, input:focus-visible { outline: 2px solid #005fcc; outline-offset: 2px; }
	</style></head><body><main>
		<h1>Clean screen</h1>
		<input aria-label="Search term" />
		<button id="go" type="button">Submit</button>
		<div id="status" role="status"></div>
		<script>
			document.getElementById('go').addEventListener('click', () => {
				document.getElementById('status').textContent = 'Submitted cleanly.';
			});
		</script>
	</main></body></html>`,
	clock: `<!doctype html><html><body><main>
		<p id="today"></p>
		<button id="check" type="button">Check date</button>
		<div id="out" role="status"></div>
		<script>
			document.getElementById('today').textContent = new Date().toISOString().slice(0, 10);
			document.getElementById('check').addEventListener('click', () => {
				document.getElementById('out').textContent = 'Date is ' + new Date().toISOString().slice(0, 10);
			});
		</script>
	</main></body></html>`,
	// F1: Pointer hit intercepted by transparent overlay cover
	F1: `<!doctype html><html><head><style>
		.wrap { position: relative; display: inline-block; }
		.cover { position: absolute; inset: 0; z-index: 10; background: transparent; }
	</style></head><body><main>
		<div class="wrap">
			<button id="btn" type="button">Continue</button>
			<div class="cover" aria-hidden="true"></div>
		</div>
	</main></body></html>`,
	// F2: Control pushed outside an overflow:hidden container
	F2: `<!doctype html><html><head><style>
		.box { width: 200px; height: 40px; overflow: hidden; border: 1px solid #888; }
		.pushed { position: relative; top: 96px; }
	</style></head><body><main>
		<div class="box"><button class="pushed" type="button">Archive item</button></div>
	</main></body></html>`,
	// F3: Button wired ONLY to JS addEventListener('dblclick'), ignores single click
	F3: `<!doctype html><html><body><main>
		<button id="dbl" type="button">Open editor</button>
		<div id="msg" role="status"></div>
		<script>
			document.getElementById('dbl').addEventListener('dblclick', () => {
				document.getElementById('msg').textContent = 'Editor opened.';
			});
		</script>
	</main></body></html>`,
	// F4: Focused button becomes visually transparent
	F4: `<!doctype html><html><head><style>
		button:focus, button:focus-visible {
			color: transparent;
			background-color: transparent;
			border-color: transparent;
			outline: none;
		}
	</style></head><body><main>
		<button type="button">Join queue</button>
	</main></body></html>`,
	// F5: Input removes focus outline with no alternative visible focus change
	F5: `<!doctype html><html><head><style>
		input { border: 1px solid #999; background: #fff; }
		input:focus, input:focus-visible { outline: none; border-color: #999; background: #fff; box-shadow: none; }
	</style></head><body><main>
		<input aria-label="Year" />
	</main></body></html>`,
	// F6: Visual CSS flex order reverses keyboard tab order
	F6: `<!doctype html><html><head><style>
		.row { display: flex; gap: 12px; }
		.first-dom { order: 2; }
		.second-dom { order: 1; }
		input:focus-visible { outline: 2px solid #005fcc; }
	</style></head><body><main>
		<div class="row">
			<input class="first-dom" aria-label="Quantity" />
			<input class="second-dom" aria-label="Year" />
		</div>
	</main></body></html>`,
	// F7: Fixed 640px panel overflows 320px low-vision reflow viewport
	F7: `<!doctype html><html><head><style>
		.panel { width: 640px; border: 1px solid #666; padding: 8px; }
	</style></head><body><main>
		<div class="panel"><button type="button">Confirm action</button></div>
	</main></body></html>`,
	// F8: Validation message hidden via CSS display:none at <= 400px narrow viewport
	F8: `<!doctype html><html><head><style>
		@media (max-width: 400px) { .err { display: none; } }
	</style></head><body><main>
		<p class="err" role="alert">Invalid year entered.</p>
		<button type="button">Save</button>
	</main></body></html>`,
	// F9: Form height clips submit button vertically at <= 400px narrow viewport
	F9: `<!doctype html><html><head><style>
		@media (max-width: 400px) { form { height: 40px; overflow-y: clip; } }
		.spacer { height: 80px; }
	</style></head><body><main>
		<form><div class="spacer">Fields</div><button type="button">Save record</button></form>
	</main></body></html>`,
	// F10: Duplicate identical accessible names on interactive checkboxes
	F10: `<!doctype html><html><body><main>
		<label><input type="checkbox" aria-label="Select" /></label>
		<label><input type="checkbox" aria-label="Select" /></label>
	</main></body></html>`,
	// F11: Button click writes visible status text with NO live region (no data-fault marker!)
	F11: `<!doctype html><html><body><main>
		<button id="run" type="button">Approve batch</button>
		<div id="silent"></div>
		<script>
			document.getElementById('run').addEventListener('click', () => {
				document.getElementById('silent').textContent = '2 of 3 items approved.';
			});
		</script>
	</main></body></html>`,
	// F12: Visible status text hidden from assistive tech via aria-hidden="true"
	F12: `<!doctype html><html><body><main>
		<p aria-hidden="true">Item unavailable: out of stock.</p>
		<button type="button">Retry</button>
	</main></body></html>`,
};

describe('panel-walk real Chromium browser host (F1–F12 + cross-modality)', () => {
	let root: string;
	let server: Server;
	let baseUrl: string;

	beforeAll(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), 'specimen-panel-browser-')));
		server = createServer((req, res) => {
			const url = new URL(req.url ?? '/', 'http://127.0.0.1');
			const statusParam = url.searchParams.get('status');
			if (statusParam) {
				res.writeHead(Number(statusParam), { 'content-type': 'text/plain; charset=utf-8' });
				res.end(`HTTP ${statusParam}`);
				return;
			}
			const key = url.searchParams.get('page') ?? 'clean';
			const html = PAGES[key] ?? PAGES.clean;
			res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
			res.end(html);
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const addr = server.address();
		if (!addr || typeof addr === 'string') throw new Error('Failed to bind local server');
		baseUrl = `http://127.0.0.1:${addr.port}`;

		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({
				panel: {
					jobs: ['screen-check'],
					personas: [
						{ id: 'p-pointer', modality: 'pointer' },
						{ id: 'p-keyboard', modality: 'keyboard' },
						{ id: 'p-sr', modality: 'screen-reader' },
						{ id: 'p-lowvision', modality: 'low-vision' },
					],
				},
			})
		);
	});

	afterAll(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(root, { recursive: true, force: true });
	});

	it('passes clean page in all 4 modalities, stops on HTTP 404/500, and supports valid requestedTools subsets', async () => {
		const bench = await createSpecimenBench({ root });
		try {
			const modalities: Array<[Modality, string]> = [
				['pointer', 'p-pointer'],
				['keyboard', 'p-keyboard'],
				['screen-reader', 'p-sr'],
				['low-vision', 'p-lowvision'],
			];
			for (const [modality, persona] of modalities) {
				const res = await bench.panelWalk({
					job: 'screen-check',
					persona,
					modality,
					target: `${baseUrl}/?page=clean`,
					appDate: '2030-05-12',
				});
				expect(res.ending, modality).toBe('done');
				expect(res.findings, modality).toEqual([]);
			}

			// Valid subset omitting screenshot does NOT crash
			const subset = await bench.panelWalk({
				job: 'screen-check',
				persona: 'p-pointer',
				modality: 'pointer',
				target: `${baseUrl}/?page=clean`,
				requestedTools: ['click'],
			});
			expect(subset.ending).toBe('done');

			// HTTP 404 returns Stopped with observed finding (never Done)
			const notFound = await bench.panelWalk({
				job: 'screen-check',
				persona: 'p-pointer',
				modality: 'pointer',
				target: `${baseUrl}/?status=404`,
			});
			expect(notFound.ending).toBe('stopped');
			expect(notFound.findings[0]?.summary).toContain('HTTP 404');

			// appDate clock injection works in Chromium without fault
			const clocked = await bench.panelWalk({
				job: 'screen-check',
				persona: 'p-sr',
				modality: 'screen-reader',
				target: `${baseUrl}/?page=clock`,
				appDate: '2030-05-12',
			});
			expect(clocked.ending).toBe('done');
		} finally {
			await bench.close();
		}
	}, 60_000);

	it('genuinely detects all 12 Phase 0 fault classes (F1–F12) in Chromium with cross-modality isolation', async () => {
		const bench = await createSpecimenBench({ root });
		try {
			const cases: Array<{
				fault: string;
				expectedModality: Modality;
				expectedPersona: string;
				cleanModalities: Array<[Modality, string]>;
			}> = [
				{
					fault: 'F1',
					expectedModality: 'pointer',
					expectedPersona: 'p-pointer',
					cleanModalities: [
						['keyboard', 'p-keyboard'],
						['screen-reader', 'p-sr'],
					],
				},
				{
					fault: 'F2',
					expectedModality: 'pointer',
					expectedPersona: 'p-pointer',
					cleanModalities: [['screen-reader', 'p-sr']],
				},
				{
					fault: 'F3',
					expectedModality: 'pointer',
					expectedPersona: 'p-pointer',
					cleanModalities: [['screen-reader', 'p-sr']],
				},
				{
					fault: 'F4',
					expectedModality: 'keyboard',
					expectedPersona: 'p-keyboard',
					cleanModalities: [['pointer', 'p-pointer']],
				},
				{
					fault: 'F5',
					expectedModality: 'keyboard',
					expectedPersona: 'p-keyboard',
					cleanModalities: [['pointer', 'p-pointer']],
				},
				{
					fault: 'F6',
					expectedModality: 'keyboard',
					expectedPersona: 'p-keyboard',
					cleanModalities: [['pointer', 'p-pointer']],
				},
				{
					fault: 'F7',
					expectedModality: 'low-vision',
					expectedPersona: 'p-lowvision',
					cleanModalities: [
						['pointer', 'p-pointer'],
						['screen-reader', 'p-sr'],
					],
				},
				{
					fault: 'F8',
					expectedModality: 'low-vision',
					expectedPersona: 'p-lowvision',
					cleanModalities: [['pointer', 'p-pointer']],
				},
				{
					fault: 'F9',
					expectedModality: 'low-vision',
					expectedPersona: 'p-lowvision',
					cleanModalities: [['pointer', 'p-pointer']],
				},
				{
					fault: 'F10',
					expectedModality: 'screen-reader',
					expectedPersona: 'p-sr',
					cleanModalities: [['pointer', 'p-pointer']],
				},
				{
					fault: 'F11',
					expectedModality: 'screen-reader',
					expectedPersona: 'p-sr',
					cleanModalities: [['pointer', 'p-pointer']],
				},
				{
					fault: 'F12',
					expectedModality: 'screen-reader',
					expectedPersona: 'p-sr',
					cleanModalities: [['pointer', 'p-pointer']],
				},
			];

			for (const entry of cases) {
				const hit = await bench.panelWalk({
					job: 'screen-check',
					persona: entry.expectedPersona,
					modality: entry.expectedModality,
					target: `${baseUrl}/?page=${entry.fault}`,
					appDate: '2030-05-12',
				});
				expect(hit.ending, `${entry.fault} (${entry.expectedModality})`).toBe('stopped');
				expect(hit.findings.length, `${entry.fault} findings`).toBeGreaterThan(0);
				expect(hit.findings.some((f) => f.evidence === 'observed')).toBe(true);

				for (const [cleanMod, cleanPersona] of entry.cleanModalities) {
					const isolated = await bench.panelWalk({
						job: 'screen-check',
						persona: cleanPersona,
						modality: cleanMod,
						target: `${baseUrl}/?page=${entry.fault}`,
						appDate: '2030-05-12',
					});
					expect(isolated.ending, `${entry.fault} isolated from ${cleanMod}`).toBe('done');
					expect(isolated.findings, `${entry.fault} findings in ${cleanMod}`).toEqual([]);
				}
			}
		} finally {
			await bench.close();
		}
	}, 120_000);
});
