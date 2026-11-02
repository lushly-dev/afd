#!/usr/bin/env node
/**
 * T06's check of the declared baseline on a consumer's real stories: every Nth story is rendered
 * twice, each in a fresh page, and the two captures must compare as unchanged. What still differs
 * is reported with its channel, for the record of what the baseline does not yet hold still.
 *
 * node experiments/check-repeat.mjs --root DIR --config FILE --out FILE [--every 10]
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	return index === -1 ? fallback : args[index + 1];
};
const every = Number(option('--every', '10'));
const { createSpecimenBench, diffObservations } = await import(
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
	const stories = [];
	for (const [position, entry] of bench.list().entries()) {
		if (position % every !== 0) continue;
		const left = await bench.render({ id: entry.id, timeoutMs: 15_000 });
		const right = await bench.render({ id: entry.id, timeoutMs: 15_000 });
		const diff = diffObservations(left, right);
		const raw = [left.channels.dom.normalized, right.channels.dom.normalized];
		const at = raw[0] === raw[1] ? -1 : firstDifference(raw[0], raw[1]);
		stories.push({
			id: entry.id,
			status: diff.status,
			channels: [...new Set(diff.differences.map((difference) => difference.channel))],
			...(at === -1
				? {}
				: {
						left: raw[0].slice(Math.max(0, at - 50), at + 70),
						right: raw[1].slice(Math.max(0, at - 50), at + 70),
					}),
		});
	}
	const summary = {
		stories: stories.length,
		unchanged: stories.filter((story) => story.status === 'no-change-observed').length,
		changed: stories.filter((story) => story.status === 'changed').length,
		other: stories.filter((story) => !['no-change-observed', 'changed'].includes(story.status))
			.length,
		channels: Object.fromEntries(
			[...new Set(stories.flatMap((story) => story.channels))].map((channel) => [
				channel,
				stories.filter((story) => story.channels.includes(channel)).length,
			])
		),
	};
	await writeFile(resolve(option('--out')), `${JSON.stringify({ summary, stories }, null, 2)}\n`);
	console.log(JSON.stringify(summary));
} finally {
	await bench.close();
}
