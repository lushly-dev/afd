#!/usr/bin/env node
/**
 * T06's check of a static build as a reviewer meets it, over a plain HTTP server with no Vite and
 * no host. The index lists every entry of the build's manifest and loads no story module, and each
 * link opens its story, loading no other story's module and no local URL that fails. Every 20th
 * entry is also reopened, opened in another context, and, with a play, run.
 *
 * node experiments/check-index.mjs --dir BUILD --out FILE [--concurrency 3]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { serveStatic } from '../fixtures/serve-static.ts';

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	return index === -1 ? fallback : args[index + 1];
};
const directory = resolve(option('--dir'));
const concurrency = Number(option('--concurrency', '3'));
const read = async (file) => JSON.parse(await readFile(join(directory, file), 'utf8'));
const build = await read('specimen-build.json');
const manifest = await read('.vite/manifest.json');

/** Each emitted chunk that is a story module's, by file. */
const storyChunks = new Map(
	Object.values(manifest)
		.filter((chunk) => /\.stories\.[cm]?[jt]sx?$/.test(chunk.src ?? ''))
		.map((chunk) => [chunk.file, chunk.src])
);
const moduleOf = (entry) => entry.module.replace(/^\.\//, '');

const server = await serveStatic(directory);
const browser = await chromium.launch({ headless: true });

/** Open a URL in a fresh context, recording what it loaded and what went wrong. */
async function visit(url, reading = () => null) {
	const context = await browser.newContext();
	const page = await context.newPage();
	const seen = { chunks: [], failed: [], errors: [] };
	await context.route(
		(target) => target.origin !== server.url,
		(route) => route.abort()
	);
	page.on('pageerror', (error) => seen.errors.push(error.message.split('\n')[0]));
	page.on('response', (response) => {
		const target = new URL(response.url());
		if (target.origin !== server.url) return;
		if (response.status() >= 400) seen.failed.push(`${response.status()} ${target.pathname}`);
		else if (target.pathname.endsWith('.js')) seen.chunks.push(target.pathname.slice(1));
	});
	try {
		await page.goto(url);
		return { ...seen, ...(await reading(page)) };
	} catch (error) {
		return { ...seen, timeout: String(error).split('\n')[0] };
	} finally {
		await context.close();
	}
}

/** The story in the page's frame, once its preview says it is ready or shows why it is not. */
async function preview(page) {
	const handle = await page.waitForSelector('iframe', { timeout: 30_000 });
	const frame = await handle.contentFrame();
	await frame.waitForSelector('html[data-specimen-preview], #specimen-page-error', {
		state: 'attached',
		timeout: 30_000,
	});
	return frame.evaluate(async () => {
		const alert = document.querySelector('#specimen-page-error');
		if (alert) return { alert: alert.textContent };
		const captured = window.__specimen.capture();
		return {
			dom: await window.__specimen.normalize(captured.dom),
			width: innerWidth,
			scheme: getComputedStyle(document.documentElement).colorScheme,
			notice: parent.document.querySelector('#specimen-page-context-notice') !== null,
		};
	});
}

const index = await visit(`${server.url}/`, async (page) => {
	await page.waitForSelector('main ul a', { timeout: 30_000 });
	return {
		links: await page.$$eval('main ul a', (anchors) => anchors.map((anchor) => anchor.href)),
		controls: await page.locator('form[aria-label="Specimen context"] select, form input').count(),
	};
});
const linked = new Map(
	(index.links ?? []).map((link) => [new URL(link).searchParams.get('id'), link])
);

const stories = [];
let next = 0;
async function worker() {
	while (next < build.entries.length) {
		const position = next++;
		const entry = build.entries[position];
		const link = linked.get(entry.id);
		if (!link) {
			stories.push({ id: entry.id, linked: false });
			continue;
		}
		const opened = await visit(link, preview);
		const others = opened.chunks
			.filter((chunk) => storyChunks.has(chunk))
			.filter((chunk) => !storyChunks.get(chunk).endsWith(moduleOf(entry)));
		const result = {
			id: entry.id,
			linked: true,
			requestsFailed: opened.failed,
			pageErrors: opened.errors,
			otherStoryModules: others,
			...(opened.alert ? { alert: opened.alert } : {}),
			...(opened.timeout ? { timeout: opened.timeout } : {}),
			bytes: opened.dom?.length ?? 0,
		};
		if (position % 20 === 0) {
			const reopened = await visit(link, preview);
			result.reopensAlike = reopened.dom === opened.dom;
			const sized = new URL(link);
			sized.searchParams.set('viewport', '375x812');
			sized.searchParams.set('theme', 'dark');
			const changed = await visit(sized.href, preview);
			result.context = {
				width: changed.width,
				scheme: changed.scheme,
				notice: changed.notice,
			};
			if (entry.story?.play === 'present') {
				const run = new URL(link);
				run.searchParams.set('checkpoint', 'after-run');
				const ran = await visit(run.href, preview);
				result.afterRun = ran.alert ?? ran.timeout ?? 'passed';
			}
		}
		stories.push(result);
	}
}
try {
	await Promise.all(Array.from({ length: concurrency }, worker));
} finally {
	await browser.close();
	await server.close();
}

const count = (test) => stories.filter(test).length;
const sampled = stories.filter((story) => story.context);
const ran = stories.filter((story) => story.afterRun);
const summary = {
	entries: build.entries.length,
	links: linked.size,
	indexStoryModules: (index.chunks ?? []).filter((chunk) => storyChunks.has(chunk)).length,
	indexFailed: index.failed ?? [],
	indexErrors: index.errors ?? [],
	controls: index.controls,
	opened: count((story) => story.bytes > 0),
	empty: count((story) => story.linked && !story.bytes && !story.alert && !story.timeout),
	alerts: count((story) => story.alert),
	timeouts: count((story) => story.timeout),
	withFailedRequests: count((story) => story.requestsFailed?.length),
	withPageErrors: count((story) => story.pageErrors?.length),
	withOtherStoryModules: count((story) => story.otherStoryModules?.length),
	reopened: sampled.length,
	reopenedAlike: sampled.filter((story) => story.reopensAlike).length,
	viewportApplied: sampled.filter((story) => story.context.width === 375).length,
	// Either the scheme followed, or the page says the browser's preference could not.
	schemeHonest: sampled.filter((story) => story.context.scheme === 'dark' || story.context.notice)
		.length,
	afterRun: ran.length,
	afterRunPassed: ran.filter((story) => story.afterRun === 'passed').length,
};
await writeFile(resolve(option('--out')), `${JSON.stringify({ summary, stories }, null, 2)}\n`);
console.log(JSON.stringify(summary));
