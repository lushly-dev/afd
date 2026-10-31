import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { SourceMap } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
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

type MapPayload = ConstructorParameters<typeof SourceMap>[0] & { sourcesContent: string[] };
function responseMap(body: string): MapPayload {
	const comments = [
		...body.matchAll(/sourceMappingURL=data:application\/json[^,]*,([A-Za-z0-9+/=]+)/g),
	];
	const encoded = comments.at(-1)?.[1];
	if (!encoded) throw new Error('Response has no inline source map');
	return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as MapPayload;
}
async function mapFixture(module: string, source: string): Promise<string> {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'specimen-maps-')));
	await writeFile(join(root, module), source);
	await writeFile(
		join(root, 'specimen.config.json'),
		JSON.stringify({
			specimens: [
				{ id: 'probe', title: 'Source maps', module: `./${module}`, exportName: 'Probe' },
			],
		})
	);
	return root;
}
async function readModule(url: string): Promise<string> {
	const response = await fetch(url);
	expect(response.status).toBe(200);
	return response.text();
}
async function answerFrom(body: string): Promise<number> {
	const module = await import(
		`data:text/javascript;base64,${Buffer.from(body).toString('base64')}`
	);
	return module.answer as number;
}

it.each([false, true])(
	'caches fallback maps and invalidates code, maps and provenance with automation=%s',
	async (automation) => {
		const source = `export const answer = 21 * 2;
export const Probe = { render() {
 const element = document.createElement('p'); element.textContent = String(answer); return element;
} };
// terminal line comment`;
		const root = await mapFixture('probe.js', source);
		const file = join(root, 'probe.js');
		const path = `/@fs${file}`;
		const server = await startBenchServer(await loadConfig({ root }), { automation });
		const transforms = vi.spyOn(server.server.environments.client.pluginContainer, 'transform');
		try {
			const response = await fetch(`${server.url}${path}`);
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toMatch(/^text\/javascript(?:;|$)/);
			expect(response.headers.get('cache-control')).toBe('no-cache');
			const etag = response.headers.get('etag');
			if (!etag) throw new Error('Module response has no ETag');
			const first = await response.text();
			const map = responseMap(first);
			expect(map.sourcesContent).toEqual([source]);
			expect(new SourceMap(map).findEntry(0, source.indexOf('answer'))).toMatchObject({
				originalLine: 0,
				originalColumn: source.indexOf('answer'),
			});
			expect(await answerFrom(first)).toBe(42);
			const cached = await server.server.transformRequest(path);
			expect(cached?.code).toBe(`${source}\n`);
			expect(cached?.map).toMatchObject({ sourcesContent: [source], mappings: map.mappings });
			for (let repeat = 0; repeat < 3; repeat++) {
				expect(await readModule(`${server.url}${path}`)).toBe(first);
				expect(await server.server.transformRequest(path)).toBe(cached);
			}
			const conditional = await fetch(`${server.url}${path}`, {
				headers: { 'If-None-Match': etag },
			});
			expect(conditional.status).toBe(304);
			expect(await conditional.text()).toBe('');
			expect(transforms.mock.calls.filter((call) => call[1] === file)).toHaveLength(1);
			let beforeDigest: string | undefined;
			if (automation) {
				const bench = await createSpecimenBench({ root });
				try {
					beforeDigest = (await bench.render({ id: 'probe' })).manifest.source.digest;
				} finally {
					await bench.close();
				}
			}
			const edited = source.replace('21 * 2', '42 * 2');
			await writeFile(file, edited);
			let changed = '';
			await vi.waitFor(
				async () => {
					changed = await readModule(`${server.url}${path}`);
					expect(responseMap(changed).sourcesContent).toEqual([edited]);
				},
				{ timeout: 3000 }
			);
			expect(changed).not.toBe(first);
			expect(await answerFrom(changed)).toBe(84);
			const revalidated = await fetch(`${server.url}${path}`, {
				headers: { 'If-None-Match': etag },
			});
			expect(revalidated.status).toBe(200);
			expect(revalidated.headers.get('etag')).toBeTruthy();
			expect(revalidated.headers.get('etag')).not.toBe(etag);
			expect(await revalidated.text()).toBe(changed);
			const editedMap = responseMap(changed);
			expect(new SourceMap(editedMap).findEntry(0, edited.indexOf('answer'))).toMatchObject({
				originalLine: 0,
				originalColumn: edited.indexOf('answer'),
			});
			const updated = await server.server.transformRequest(path);
			expect(updated).not.toBe(cached);
			expect(updated?.map).toMatchObject({ sourcesContent: [edited] });
			expect(transforms.mock.calls.filter((call) => call[1] === file)).toHaveLength(2);
			if (automation) {
				const bench = await createSpecimenBench({ root });
				try {
					const captured = await bench.render({ id: 'probe' });
					expect(captured.channels.dom.raw).toContain('84');
					expect(captured.manifest.source.digest).not.toBe(beforeDigest);
				} finally {
					await bench.close();
				}
			}
		} finally {
			transforms.mockRestore();
			await server.close();
			await rm(root, { recursive: true, force: true });
		}
	}
);

it.each(['typescript', 'external', 'inline'] as const)(
	'preserves the original %s source map',
	async (kind) => {
		const original = 'export const answer: number = 42;';
		const generated = 'export const answer = 42;';
		const provided = {
			version: 3,
			file: 'probe.js',
			sources: ['original.ts'],
			sourcesContent: [original],
			names: [],
			mappings: 'AAAA',
		};
		const module = kind === 'typescript' ? 'probe.ts' : 'probe.js';
		const source =
			kind === 'typescript'
				? original
				: `${generated}\n//# sourceMappingURL=${kind === 'external' ? 'probe.js.map' : `data:application/json;base64,${Buffer.from(JSON.stringify(provided)).toString('base64')}`}`;
		const root = await mapFixture(module, source);
		await writeFile(join(root, 'original.ts'), original);
		if (kind === 'external') await writeFile(join(root, 'probe.js.map'), JSON.stringify(provided));
		const server = await startBenchServer(await loadConfig({ root }), { automation: true });
		try {
			const path = `/@fs${join(root, module)}`;
			const body = await readModule(`${server.url}${path}`);
			const map = responseMap(body);
			expect(map.sourcesContent).toEqual([original]);
			expect(await answerFrom(body)).toBe(42);
			if (kind === 'typescript') {
				const generatedLine = body.slice(0, body.indexOf('\n'));
				expect(new SourceMap(map).findEntry(0, generatedLine.indexOf('answer'))).toMatchObject({
					originalLine: 0,
					originalColumn: original.indexOf('answer'),
				});
			} else {
				expect(map.mappings).toBe(provided.mappings);
				expect(map.sources[0]).toMatch(/original\.ts$/);
			}
			expect(await readModule(`${server.url}${path}`)).toBe(body);
			expect((await server.server.transformRequest(path))?.map).toMatchObject({
				sourcesContent: [original],
			});
		} finally {
			await server.close();
			await rm(root, { recursive: true, force: true });
		}
	}
);
