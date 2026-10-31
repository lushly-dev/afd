#!/usr/bin/env node
/**
 * Recorded Google Fonts for comparison pairs (T04). `record` fetches each stylesheet a consumer's
 * preview head links, and every font file it names, stores the bytes by SHA-256 and checks them
 * against the digests T01 froze. `startFontServer` serves only those bytes from 127.0.0.1, with
 * stylesheet URLs rewritten to itself, so both runners load identical fonts and nothing live.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stylesheetUrls } from './font-rewrite.mjs';
import { CHROMIUM_UA } from './freeze.mjs';

export { rewriteHtml, stylesheetUrls } from './font-rewrite.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const FONT = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g;

async function fetchStored(url, store) {
	const response = await fetch(url, { headers: { 'user-agent': CHROMIUM_UA } });
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	const digest = sha256(bytes);
	await writeFile(join(store, digest), bytes);
	return {
		url,
		sha256: digest,
		bytes: bytes.length,
		contentType: response.headers.get('content-type'),
	};
}

/**
 * Record a consumer's fonts into `store` and compare with the freeze manifest's remote assets.
 * A digest that differs from T01's is reported, not silently accepted.
 */
export async function recordRemoteFonts({ html, store, frozen = [] }) {
	await mkdir(store, { recursive: true });
	const stylesheets = [];
	for (const url of stylesheetUrls(html)) {
		const sheet = await fetchStored(url, store);
		const css = await readFile(join(store, sheet.sha256), 'utf8');
		sheet.fonts = [];
		// Variable fonts repeat one file across weights; fetch and count each file once.
		for (const font of new Set([...css.matchAll(FONT)].map(([, url]) => url)))
			sheet.fonts.push(await fetchStored(font, store));
		const expected = frozen.find((asset) => asset.url === url);
		const expectedFonts = new Map((expected?.fonts ?? []).map((font) => [font.url, font.sha256]));
		sheet.matchesFreeze = {
			stylesheet: expected?.sha256 === sheet.sha256,
			fonts: sheet.fonts.filter((font) => expectedFonts.get(font.url) === font.sha256).length,
			fontsRecordedByFreeze: expectedFonts.size,
		};
		stylesheets.push(sheet);
	}
	return { userAgent: CHROMIUM_UA, recordedUtc: new Date().toISOString(), stylesheets };
}

/** Serve the recorded bytes; anything unrecorded is a 404 that the stats report. */
export async function startFontServer(record, store) {
	const fonts = new Map(
		record.stylesheets.flatMap((sheet) => sheet.fonts.map((font) => [font.url, font]))
	);
	const stats = { stylesheets: 0, fonts: 0, bytes: 0, missing: [] };
	let base = '';
	const server = createServer((request, response) => {
		void (async () => {
			const [, kind, digest] = /^\/(css|font)\/([0-9a-f]{64})$/.exec(request.url ?? '') ?? [];
			const known =
				kind === 'css'
					? record.stylesheets.find((sheet) => sheet.sha256 === digest)
					: [...fonts.values()].find((font) => font.sha256 === digest);
			if (!known) {
				stats.missing.push(request.url ?? '');
				response.writeHead(404, { 'access-control-allow-origin': '*' }).end();
				return;
			}
			let body = await readFile(join(store, digest));
			if (kind === 'css')
				body = Buffer.from(
					body
						.toString('utf8')
						.replace(FONT, (match, url) =>
							fonts.has(url) ? `url(${base}/font/${fonts.get(url).sha256})` : match
						)
				);
			stats[kind === 'css' ? 'stylesheets' : 'fonts']++;
			stats.bytes += body.length;
			response.writeHead(200, {
				'access-control-allow-origin': '*',
				'content-type': known.contentType ?? (kind === 'css' ? 'text/css' : 'font/woff2'),
				'cache-control': 'no-store',
			});
			response.end(body);
		})();
	});
	await new Promise((resolveListen, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolveListen);
	});
	const address = server.address();
	base = `http://127.0.0.1:${address.port}`;
	return {
		url: base,
		stats: () => structuredClone(stats),
		close: () =>
			new Promise((resolveClose) => {
				server.closeAllConnections();
				server.close(() => resolveClose());
			}),
	};
}

async function main(args) {
	const option = (name) => args[args.indexOf(name) + 1];
	if (args[0] !== 'record')
		throw new Error(
			'Usage: remote-fonts.mjs record --snapshot DIR --inputs FREEZE.json --out STORE'
		);
	const snapshot = resolve(option('--snapshot'));
	const store = resolve(option('--out'));
	const inputs = JSON.parse(await readFile(resolve(option('--inputs')), 'utf8'));
	const html = await readFile(join(snapshot, '.storybook/preview-head.html'), 'utf8');
	const record = await recordRemoteFonts({ html, store, frozen: inputs.remoteAssets ?? [] });
	record.snapshot = snapshot;
	await writeFile(join(store, 'remote-fonts.json'), `${JSON.stringify(record, null, 2)}\n`);
	for (const sheet of record.stylesheets)
		process.stdout.write(
			`${sheet.sha256.slice(0, 12)} stylesheet ${sheet.matchesFreeze.stylesheet ? 'matches' : 'DIFFERS from'} T01; fonts ${sheet.matchesFreeze.fonts}/${sheet.matchesFreeze.fontsRecordedByFreeze} match (${sheet.fonts.length} fetched)\n`
		);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
	await main(process.argv.slice(2));
