import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fontPreamble } from '../consumer-project.mjs';
import { incumbents, writeWrapperConfig } from '../incumbent.mjs';
import { rewriteHtml, startFontServer, stylesheetUrls } from './remote-fonts.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sheetUrl = 'https://fonts.googleapis.com/css2?family=Bitter:wght@400;600&display=swap';
const fontUrl = 'https://fonts.gstatic.com/s/bitter/v42/a.woff2';
const head = `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="${sheetUrl.replaceAll('&', '&amp;')}" rel="stylesheet" />`;

describe('recorded fonts', () => {
	let store;
	let record;
	beforeAll(async () => {
		store = await mkdtemp(join(tmpdir(), 'specimen-fonts-'));
		const font = Buffer.from('woff2-bytes');
		const css = `@font-face { src: url(${fontUrl}) format('woff2'); }`;
		await writeFile(join(store, sha256(font)), font);
		await writeFile(join(store, sha256(css)), css);
		record = {
			stylesheets: [
				{
					url: sheetUrl,
					sha256: sha256(css),
					contentType: 'text/css',
					fonts: [{ url: fontUrl, sha256: sha256(font), contentType: 'font/woff2' }],
				},
			],
		};
	});
	afterAll(() => rm(store, { recursive: true, force: true }));

	it('finds stylesheet links and points them at the local server', () => {
		expect(stylesheetUrls(head)).toEqual([sheetUrl]);
		const rewritten = rewriteHtml(head, record, 'http://127.0.0.1:1');
		expect(rewritten).not.toMatch(/googleapis|gstatic/);
		expect(rewritten).toContain(`http://127.0.0.1:1/css/${record.stylesheets[0].sha256}`);
	});

	it('serves only recorded bytes and separates runner misses from other requests', async () => {
		const server = await startFontServer(record, store);
		try {
			const css = await (await fetch(`${server.url}/css/${record.stylesheets[0].sha256}`)).text();
			// The stylesheet now names the local font, so nothing loads live.
			expect(css).toContain(`${server.url}/font/${record.stylesheets[0].fonts[0].sha256}`);
			expect(css).not.toContain('gstatic');
			const font = await fetch(`${server.url}/font/${record.stylesheets[0].fonts[0].sha256}`);
			expect(font.headers.get('access-control-allow-origin')).toBe('*');
			expect(await font.text()).toBe('woff2-bytes');
			expect((await fetch(`${server.url}/font/${'0'.repeat(64)}`)).status).toBe(404);
			await fetch(`${server.url}/`);
			const stats = server.stats();
			expect(stats).toMatchObject({ stylesheets: 1, fonts: 1 });
			expect(stats.missing).toHaveLength(1);
			expect(stats.other).toHaveLength(1);
		} finally {
			await server.close();
		}
	});

	it('links the same stylesheets ahead of the candidate wrapper and waits for them', () => {
		expect(fontPreamble([])).toBe('');
		const preamble = fontPreamble(['http://127.0.0.1:1/css/abc']);
		expect(preamble).toContain('await Promise.all(["http://127.0.0.1:1/css/abc"]');
		expect(preamble).toContain("link.rel = 'stylesheet'");
		expect(() => fontPreamble([1])).toThrow(/JSON array/);
	});

	it('wraps the consumer config without editing the snapshot', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'specimen-wrapper-'));
		try {
			const file = await writeWrapperConfig({
				snapshot: '/snapshot',
				consumer: 'lushly',
				directory,
			});
			const source = await readFile(file, 'utf8');
			expect(source).toContain(`import base from "/snapshot/${incumbents.lushly.config}"`);
			expect(source).toContain('transformIndexHtml');
			expect(source).toContain('SPECIMEN_FONT_BASE');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
