#!/usr/bin/env node
// Phase 0: the numbers in prototype.md that summarize.mjs does not print. Throwaway.
//
//   node sessions.mjs collect <results dir> <pack.json>     one compact record per run, as JSON,
//                                                           from the raw sessions (not committed)
//   node sessions.mjs report <results.json> <sessions.json> the derived numbers, from committed data
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [mode, first, second] = process.argv.slice(2);
const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Every tool call of a session, from its stream. */
function toolCalls(streamPath) {
	const calls = [];
	for (const line of readFileSync(streamPath, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		const event = JSON.parse(line);
		if (event.type !== 'assistant') continue;
		for (const block of event.message?.content ?? [])
			if (block.type === 'tool_use') calls.push({ name: block.name, input: block.input ?? {} });
	}
	return calls;
}

/** What a session did with the material its arm was given. */
function material(calls) {
	const out = { packReads: 0, briefLists: 0, briefCalls: 0, checkRuns: 0, asked: [] };
	for (const { name, input } of calls) {
		const text = name === 'Bash' ? String(input.command ?? '') : String(input.file_path ?? '');
		if (/pack\.json/.test(text)) out.packReads += 1;
		for (const part of text.split(/&&|;|\|/)) {
			if (/check\.mjs/.test(part)) out.checkRuns += 1;
			if (!/brief\.mjs/.test(part)) continue;
			if (/--list/.test(part)) out.briefLists += 1;
			else {
				out.briefCalls += 1;
				out.asked.push(...(part.match(/violet-[a-z0-9-]+/g) ?? []));
			}
		}
	}
	out.asked = [...new Set(out.asked)].sort();
	return out;
}

/**
 * Which of the pack's facts a page names, by pattern: a rough count. It reads markup
 * (`<violet-x name="value">`) and elements created in code and bound to a variable
 * (`x.setAttribute('name', 'value')`, `x.name = …`). A fact set any other way is not seen. Only
 * the tags given are counted, so that what is used is counted over what was offered.
 */
function used(source, pack, tags) {
	const counted = new Set(tags);
	const out = { attributes: 0, finiteValues: 0, slots: 0, events: 0, imports: 0 };
	const seen = new Set();
	const slotNames = new Set();
	const note = (tag, name, value) => {
		if (name === 'slot' && value) slotNames.add(value);
		if (!counted.has(tag)) return;
		const attribute = (pack.components[tag]?.attributes ?? []).find((entry) => entry.name === name);
		if (!attribute || seen.has(`${tag} ${name}`)) return;
		seen.add(`${tag} ${name}`);
		out.attributes += 1;
		if (attribute.values && value !== undefined && attribute.values.includes(value))
			out.finiteValues += 1;
	};
	for (const [, tag, body] of source.matchAll(/<(violet-[a-z0-9-]+)((?:[^>`]|\$\{[^}]*\})*)>/g))
		for (const [, name, value] of body.matchAll(/\s([a-z][a-z0-9-]*)(?:="([^"$]*)")?/g))
			note(tag, name, value);
	for (const [, value] of source.matchAll(/\sslot="([a-z0-9-]+)"/g)) slotNames.add(value);
	const bound = new Map();
	for (const [, name, tag] of source.matchAll(
		/(?:const|let)\s+(\w+)\s*=\s*document\.createElement\(\s*["'](violet-[a-z0-9-]+)["']/g
	))
		bound.set(name, tag);
	for (const [, name, attribute, value] of source.matchAll(
		/(\w+)\.(?:set|toggle)Attribute\(\s*["']([a-z][a-z0-9-]*)["'](?:\s*,\s*["']([^"']*)["'])?/g
	)) {
		if (attribute === 'slot' && value) slotNames.add(value);
		if (bound.has(name)) note(bound.get(name), attribute, value);
	}
	for (const [, name, property, value] of source.matchAll(
		/(\w+)\.([a-z][A-Za-z]*)\s*=(?!=)\s*(?:["']([^"']*)["'])?/g
	))
		if (bound.has(name))
			note(
				bound.get(name),
				property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
				value
			);
	const slots = new Set(tags.flatMap((tag) => pack.components[tag]?.slots ?? []));
	const events = new Set(tags.flatMap((tag) => pack.components[tag]?.events ?? []));
	out.slots = [...slotNames].filter((name) => slots.has(name)).length;
	out.events = new Set(
		[...source.matchAll(/(?:addEventListener\(\s*["'`]|@)([a-z][a-z0-9-]*)/g)]
			.map(([, name]) => name)
			.filter((name) => events.has(name))
	).size;
	for (const tag of tags) {
		const path = pack.components[tag]?.import;
		if (path && source.includes(path)) out.imports += 1;
	}
	return out;
}

/** What a brief for these tags offers, counted the same way. */
function offered(pack, tags) {
	const entries = tags.map((tag) => pack.components[tag]).filter(Boolean);
	const count = (pick) => entries.reduce((sum, entry) => sum + pick(entry), 0);
	return {
		attributes: count((entry) => entry.attributes.length),
		finiteValues: count((entry) => entry.attributes.filter((a) => a.values).length),
		slots: count((entry) => entry.slots.length),
		events: count((entry) => entry.events.length),
		imports: count((entry) => (entry.import ? 1 : 0)),
		usage: count((entry) => entry.usage?.length ?? 0),
		a11y: count((entry) => entry.a11y?.length ?? 0),
		rules: new Set(entries.flatMap((entry) => entry.rules ?? [])).size,
	};
}

function collect(results, pack) {
	const rows = [];
	for (const task of readdirSync(results).sort())
		for (const arm of readdirSync(join(results, task)).sort())
			for (const run of readdirSync(join(results, task, arm)).sort()) {
				const directory = join(results, task, arm, run);
				if (!existsSync(join(directory, 'meta.json'))) continue;
				const evaluation = readJson(join(directory, 'eval.json'));
				const stories = Object.entries(evaluation.stories ?? {});
				const tags = [...new Set(stories.flatMap(([, story]) => story.tags ?? []))].sort();
				const source = readFileSync(join(directory, 'page.stories.ts'), 'utf8');
				const given = material(toolCalls(join(directory, 'stream.jsonl')));
				rows.push({
					task,
					arm,
					run: Number(run),
					...given,
					tags,
					failures: stories.flatMap(([story, { failures = [] }]) =>
						failures.map((failure) => ({
							story,
							kind: failure.split(':')[0],
							text: failure.split('\n')[0].slice(0, 120),
						}))
					),
					consoleErrors: [
						...new Set(
							stories.flatMap(([, story]) =>
								(story.consoleErrors ?? []).map((error) => error.split('\n')[0].slice(0, 120))
							)
						),
					],
					axe: [...new Set(stories.flatMap(([, story]) => story.violations ?? []))].sort(),
					...(given.asked.length
						? {
								used: used(
									source,
									pack,
									given.asked.filter((tag) => tags.includes(tag))
								),
								offered: offered(pack, given.asked),
							}
						: {}),
				});
			}
	return rows;
}

/** A seeded generator, so the permutation test prints the same value every time. */
function random(seed) {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Two-sided permutation test on the difference of medians. */
function permutation(x, y, rounds = 100000) {
	const observed = Math.abs(median(x) - median(y));
	const pool = [...x, ...y];
	const next = random(20261109);
	let hits = 0;
	for (let round = 0; round < rounds; round += 1) {
		for (let i = pool.length - 1; i > 0; i -= 1) {
			const j = Math.floor(next() * (i + 1));
			[pool[i], pool[j]] = [pool[j], pool[i]];
		}
		if (Math.abs(median(pool.slice(0, x.length)) - median(pool.slice(x.length))) >= observed)
			hits += 1;
	}
	return hits / rounds;
}

function report(results, sessions) {
	const rows = results.rows;
	const n = (value) => Math.round(value).toLocaleString('en-US').replaceAll(',', ' ');
	const tokens = (arm, task) =>
		rows.filter((row) => row.arm === arm && (!task || row.task === task)).map((row) => row.tokens);
	console.log('Median tokens, one arm against another:');
	for (const [x, y] of [
		['c', 'a'],
		['b', 'a'],
		['c', 'b'],
		['d', 'a'],
		['e', 'a'],
	]) {
		const change = (median(tokens(x)) / median(tokens(y)) - 1) * 100;
		const p = permutation(tokens(x), tokens(y));
		console.log(
			`  ${x} against ${y}: ${change >= 0 ? '+' : ''}${change.toFixed(1)} %, p ${p < 0.001 ? '< 0.001' : `= ${p.toFixed(2)}`}`
		);
	}
	console.log('Median tokens by task:');
	for (const task of ['t1', 't2', 't3'])
		console.log(
			`  ${task}: ${['a', 'b', 'c', 'd', 'e'].map((arm) => `${arm} ${n(median(tokens(arm, task)))}`).join(', ')}`
		);
	console.log(`Total cost: $${rows.reduce((sum, row) => sum + row.cost, 0).toFixed(2)}`);

	const of = (list, test) => `${list.filter(test).length} of ${list.length}`;
	const where = (test) => sessions.filter(test);
	console.log('Material used:');
	console.log(
		`  b read the pack: ${of(
			where((s) => s.arm === 'b'),
			(s) => s.packReads > 0
		)}`
	);
	for (const arm of ['c', 'e'])
		console.log(
			`  ${arm} called the brief: ${of(
				where((s) => s.arm === arm),
				(s) => s.briefCalls > 0
			)}`
		);
	for (const arm of ['d', 'e'])
		console.log(
			`  ${arm} ran the check: ${of(
				where((s) => s.arm === arm),
				(s) => s.checkRuns > 0
			)}`
		);
	for (const arm of ['c', 'e']) {
		const mine = where((s) => s.arm === arm);
		const sum = (key) => mine.reduce((total, s) => total + s[key], 0);
		console.log(
			`  ${arm}: ${sum('briefLists')} list calls and ${sum('briefCalls')} brief calls in ${mine.length} runs`
		);
	}
	console.log('Faults seen in every arm:');
	console.log(
		`  t2, colour contrast with the dialog open: ${of(
			where((s) => s.task === 't2'),
			(s) => s.axe.includes('color-contrast')
		)}`
	);
	console.log(
		`  t3, tab.syncPresentation: ${of(
			where((s) => s.task === 't3'),
			(s) => s.consoleErrors.some((error) => error.includes('syncPresentation'))
		)}`
	);
	console.log('t1, a play assertion of the page failed:');
	for (const arm of ['a', 'b', 'c', 'd', 'e'])
		console.log(
			`  ${arm}: ${of(
				where((s) => s.task === 't1' && s.arm === arm),
				(s) => s.failures.some((failure) => failure.kind === 'play')
			)}`
		);

	const briefed = where((s) => s.offered);
	console.log(`What the ${briefed.length} pages written from a brief name, of what it offered:`);
	for (const key of ['attributes', 'finiteValues', 'slots', 'events', 'imports']) {
		const offeredTotal = briefed.reduce((sum, s) => sum + s.offered[key], 0);
		const usedTotal = briefed.reduce((sum, s) => sum + s.used[key], 0);
		console.log(
			`  ${key}: ${usedTotal} of ${offeredTotal} offered; at least one on ${of(briefed, (s) => s.used[key] > 0)} pages`
		);
	}
	const asked = briefed.map((s) => s.asked.length);
	const onPage = briefed.map((s) => s.asked.filter((tag) => s.tags.includes(tag)).length);
	console.log(
		`  components asked for: median ${median(asked)}, of which on the page: median ${median(onPage)}`
	);
}

if (mode === 'collect' && first && second) {
	console.log(JSON.stringify(collect(resolve(first), readJson(second)), null, '\t'));
} else if (mode === 'report' && first && second) {
	report(readJson(first), readJson(second));
} else {
	console.error(
		'Usage: node sessions.mjs collect <results dir> <pack.json> | report <results.json> <sessions.json>'
	);
	process.exit(2);
}
