#!/usr/bin/env node
/**
 * The home page's social preview image, site/og.png (1200 by 630).
 *
 * It is drawn as a page and captured in Chromium: the hero's statement over
 * the red field, the /AFD wordmark from site/svg/wordmark.svg, and the hero's
 * slashes at the wordmark's 20 degree lean. Every colour is read by name from
 * site/css/tokens-m2.css.
 *
 *   node scripts/build-site-og.mjs
 *
 * Needs the network for the site's typefaces (Google Fonts, as the site loads
 * them) and Specimen's Playwright Chromium:
 *
 *   pnpm -F @lushly-dev/specimen exec playwright install --only-shell chromium
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site');
const { chromium } = createRequire(join(root, 'foundations/specimen/package.json'))('playwright');

const tokens = readFileSync(join(site, 'css/tokens-m2.css'), 'utf8');
function token(name) {
	const match = tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})\\s*;`, 'i'));
	if (!match) throw new Error(`site/css/tokens-m2.css has no --${name} hex value`);
	return match[1];
}
const red = token('afd-red');
const redDeep = token('afd-red-700');
const redInk = token('afd-red-ink');
const ink = token('afd-ink');
const paper = token('afd-paper');

// On the red field the wordmark's slash is paper, not red.
const wordmark = readFileSync(join(site, 'svg/wordmark.svg'), 'utf8')
	.replace(/ role="img" aria-label="AFD"/, ' aria-hidden="true"')
	.replace(/<path fill="#[0-9a-f]{6}"/i, '<path class="slash"');
if (!wordmark.includes('class="slash"'))
	throw new Error('site/svg/wordmark.svg: the slash path was not found');

const W = 1200;
const H = 630;
const LEAN = Math.tan((20 * Math.PI) / 180); // the wordmark's "/" and the hero's slashes
/** A band leaning like the wordmark's slash: its left edge meets the top at x, w wide. */
function band(x, w) {
	const d = H * LEAN;
	return `polygon(${x}px 0, ${x + w}px 0, ${x + w - d}px ${H}px, ${x - d}px ${H}px)`;
}

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=IBM+Plex+Mono:wght@500;600&display=block" rel="stylesheet">
<style>
* { margin: 0; box-sizing: border-box; }
body { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: ${red}; color: ${ink}; font-family: 'IBM Plex Mono', monospace; }
.band { position: absolute; inset: 0; }
.wide { background: ${redDeep}; clip-path: ${band(860, 320)}; }
.thin { background: ${redInk}; clip-path: ${band(1270, 14)}; }
.crop { position: absolute; width: 22px; height: 22px; border: 0 solid ${ink}; }
.tl { top: 18px; left: 18px; border-top-width: 3px; border-left-width: 3px; }
.tr { top: 18px; right: 18px; border-top-width: 3px; border-right-width: 3px; }
.bl { bottom: 18px; left: 18px; border-bottom-width: 3px; border-left-width: 3px; }
.br { bottom: 18px; right: 18px; border-bottom-width: 3px; border-right-width: 3px; }
.mark { position: absolute; left: 64px; top: 62px; height: 38px; }
.mark svg { display: block; width: auto; height: 100%; }
.mark .slash { fill: ${paper}; }
.label { position: absolute; right: 64px; top: 70px; font-weight: 600; font-size: 19px; letter-spacing: 0.06em; text-transform: uppercase; }
h1 { position: absolute; left: 60px; top: 318px; font: 400 112px/0.86 'Archivo Black', sans-serif; letter-spacing: -0.01em; text-transform: uppercase; }
h1 em { font-style: normal; color: ${paper}; }
.foot { position: absolute; left: 64px; bottom: 56px; font-weight: 500; font-size: 21px; }
</style></head><body>
<div class="band wide"></div><div class="band thin"></div>
<span class="crop tl"></span><span class="crop tr"></span><span class="crop bl"></span><span class="crop br"></span>
<div class="mark">${wordmark}</div>
<p class="label">Agent-first development</p>
<h1>Commands are<br>the <em>product.</em></h1>
<p class="foot">Libraries for TypeScript, Python, Rust and C++.</p>
</body></html>`;

const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: { width: W, height: H } });
	await page.setContent(html, { waitUntil: 'networkidle' });
	await page.evaluate(() => document.fonts.ready);
	const loaded = await page.evaluate(() =>
		[...document.fonts]
			.filter((face) => face.status === 'loaded')
			.map((face) => face.family.replace(/"/g, ''))
	);
	for (const family of ['Archivo Black', 'IBM Plex Mono']) {
		if (!loaded.includes(family))
			throw new Error(
				`${family} did not load; the image needs the network for the site's typefaces`
			);
	}
	await page.screenshot({ path: join(site, 'og.png') });
	console.log(`site/og.png, ${W} by ${H}`);
} finally {
	await browser.close();
}
