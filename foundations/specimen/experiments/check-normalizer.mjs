#!/usr/bin/env node
/**
 * T06's check of the DOM normalizer against the parse5 reference it replaced, on a consumer's real
 * captures: every story of the bench's config runs through `runSuite`, keeping its capture, and
 * the two normalizations of each raw DOM must agree. A story the reference repairs, where the
 * capture's DOM is not what a parser would build, is reported with the first place they differ.
 *
 * node experiments/check-normalizer.mjs --root DIR --config FILE --out FILE [--workers 2]
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse5Normalize } from './inputs/parse5-normalize.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	return index === -1 ? fallback : args[index + 1];
};
const { createSpecimenBench, normalizeDom } = await import(
	new URL('../dist/index.js', import.meta.url).href
);
const bench = await createSpecimenBench({
	root: resolve(option('--root')),
	configFile: resolve(option('--config')),
});

const firstDifference = (left, right) => {
	let at = 0;
	while (at < left.length && left[at] === right[at]) at++;
	return at;
};

try {
	const suite = await bench.runSuite({
		workers: Number(option('--workers', '2')),
		capture: 'all',
	});
	const stories = [];
	let bytes = 0;
	let withShadow = 0;
	for (const story of suite.stories) {
		const observation = story.observation;
		if (!observation) {
			stories.push({ id: story.id, status: story.status, captured: false });
			continue;
		}
		const raw = observation.channels.dom.raw;
		const scanned = normalizeDom(raw);
		const reference = parse5Normalize(raw);
		bytes += raw.length;
		if (raw.includes('shadowrootmode')) withShadow++;
		const at = scanned === reference ? -1 : firstDifference(scanned, reference);
		stories.push({
			id: story.id,
			status: story.status,
			captured: true,
			pageAgrees: observation.channels.dom.normalized === scanned,
			agrees: at === -1,
			...(at === -1
				? {}
				: {
						at,
						scanned: scanned.slice(Math.max(0, at - 60), at + 100),
						reference: reference.slice(Math.max(0, at - 60), at + 100),
					}),
		});
	}
	const captured = stories.filter((story) => story.captured);
	const summary = {
		stories: stories.length,
		captured: captured.length,
		bytes,
		withShadow,
		agree: captured.filter((story) => story.agrees).length,
		differ: captured.filter((story) => !story.agrees).length,
		pageDisagrees: captured.filter((story) => !story.pageAgrees).length,
	};
	await writeFile(resolve(option('--out')), `${JSON.stringify({ summary, stories }, null, 2)}\n`);
	console.log(JSON.stringify(summary));
} finally {
	await bench.close();
}
