#!/usr/bin/env node
// Phase 0 stand-in for `components-brief`. Throwaway.
//
//   node brief.mjs <tag> [<tag> ...]     one answer for all the tags named
//   node brief.mjs --list                every tag with its one-line summary
//
// The answer is JSON: an entry per component, each shared rule once, and the tags it does not know.
import { gunzipSync } from 'node:zlib';

const pack = JSON.parse(gunzipSync(Buffer.from('__PACK__', 'base64')).toString('utf8'));
const BUDGET = 24000;
const args = process.argv.slice(2);

if (!args.length) {
	console.error('Usage: node brief.mjs <tag> [<tag> ...]   or   node brief.mjs --list');
	process.exit(2);
}

if (args.includes('--list')) {
	const lines = Object.entries(pack.components).map(([tag, { summary }]) => `${tag}: ${summary}`);
	console.log(lines.join('\n'));
	process.exit(0);
}

const asked = [...new Set(args.map((tag) => tag.replace(/[<>,]/g, '').trim()).filter(Boolean))];
const known = asked.filter((tag) => pack.components[tag]);

/** Shared letters in order, as a cheap measure of which known tag a wrong one meant. */
function nearest(wrong) {
	const score = (tag) => {
		let hits = 0;
		for (const part of wrong.split('-')) if (part && tag.includes(part)) hits += part.length;
		return hits;
	};
	return Object.keys(pack.components)
		.map((tag) => [tag, score(tag)])
		.filter(([, hits]) => hits > 'violet'.length)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([tag]) => tag);
}
const unknown = asked
	.filter((tag) => !pack.components[tag])
	.map((tag) => ({ tag, nearest: nearest(tag) }));

/** Sections leave in this order, for every component at once, until the answer fits. */
const SHED = ['events', 'usage', 'slots', 'ruleText', 'a11y', 'attributes'];

function answer(dropped) {
	const components = {};
	const ruleIds = new Set();
	for (const tag of known) {
		const { rules = [], ...entry } = pack.components[tag];
		for (const section of dropped) delete entry[section];
		for (const id of rules) ruleIds.add(id);
		components[tag] = { ...entry, ...(rules.length ? { rules } : {}) };
	}
	return {
		trust: 'content',
		library: pack.library,
		basis: pack.note,
		components,
		rules: dropped.includes('ruleText')
			? [...ruleIds].sort()
			: Object.fromEntries([...ruleIds].sort().map((id) => [id, pack.rules[id]])),
		unknown,
		omitted: dropped.map((section) => ({
			section,
			reason: 'the answer would not fit its budget',
		})),
	};
}

let dropped = [];
let text = JSON.stringify(answer(dropped));
while (Buffer.byteLength(text) > BUDGET && dropped.length < SHED.length) {
	dropped = SHED.slice(0, dropped.length + 1);
	text = JSON.stringify(answer(dropped));
}
if (Buffer.byteLength(text) > BUDGET) {
	console.error(
		`OUTPUT_BUDGET_EXCEEDED: ${known.length} components do not fit ${BUDGET} bytes. Ask for fewer.`
	);
	process.exit(1);
}
console.log(text);
