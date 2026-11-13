#!/usr/bin/env node
// Step C5: what each rerun session did with the plugin and what its page used of the briefs it got.
// The counterpart of ../prototype/sessions.mjs, reading the real answers from the sessions'
// streams instead of a hand-built pack.
//
//   node sessions.mjs collect <results dir>     one compact record per run, as JSON (not committed)
//   node sessions.mjs report <sessions.json>    the derived numbers, from the committed records
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [mode, first] = process.argv.slice(2);
const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));

/** Each tag's manifest declaration, as step 0.1's baseline.mjs counts declarations. */
const declarations = new Map(
	readJson(
		join(
			import.meta.dirname,
			'../../../../../foundations/fast-af/packages/violet-elements/custom-elements.json'
		)
	)
		.modules.flatMap((module) => module.declarations ?? [])
		.filter((declaration) => declaration.tagName)
		.map((declaration) => [declaration.tagName, declaration])
);
const declarationBytes = (tags) =>
	Buffer.byteLength(
		JSON.stringify(tags.filter((t) => declarations.has(t)).map((t) => declarations.get(t)))
	);

/** Bytes of each section across a brief's entries, and of its shared rules. */
function sectionBytes(brief) {
	const out = {};
	for (const component of brief.data?.content?.components ?? [])
		for (const [key, value] of Object.entries(component))
			out[key] = (out[key] ?? 0) + Buffer.byteLength(JSON.stringify(value));
	out['rule text'] = Buffer.byteLength(JSON.stringify(brief.data?.content?.rules ?? []));
	return out;
}

/** The shedding order (proposal section 9; plugin specification 6.4), with what this script counts. */
export const ORDER = [
	'examples',
	'cssProperties',
	'event detail',
	'declared-only attributes with no finite values',
	'usage',
	'events',
	'form and roles',
	'slots',
	'rule text',
	'a11y',
	'remaining attributes',
];

/** Every tool call of a session with its answer's text, from its stream. */
function toolCalls(streamPath) {
	const calls = [];
	const byId = new Map();
	for (const line of readFileSync(streamPath, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		const event = JSON.parse(line);
		for (const block of event.message?.content ?? []) {
			if (event.type === 'assistant' && block.type === 'tool_use') {
				const call = { id: block.id, name: block.name, input: block.input ?? {}, answer: '' };
				calls.push(call);
				byId.set(block.id, call);
			}
			if (event.type === 'user' && block.type === 'tool_result') {
				const call = byId.get(block.tool_use_id);
				if (!call) continue;
				call.answer =
					typeof block.content === 'string'
						? block.content
						: (block.content ?? []).map((part) => part.text ?? '').join('');
			}
		}
	}
	return calls;
}

/** Which component command a call ran, if any: `components-brief`, `-list`, `-open`, or none. */
function componentCommand({ name, input }) {
	if (!name.startsWith('mcp__umbel__')) return undefined;
	const tool = name.slice('mcp__umbel__'.length);
	if (tool === 'afd-call') return String(input.command ?? '');
	return tool;
}

const parse = (text) => {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
};

/** What a session read of the library instead of, or as well as, the briefs. */
function reading(calls) {
	const out = { sourceReads: 0, storyReads: 0, packReads: 0, manifestReads: 0 };
	for (const { name, input } of calls) {
		const text =
			name === 'Bash'
				? String(input.command ?? '')
				: String(input.file_path ?? input.path ?? input.pattern ?? '');
		if (!/violet-elements|violet-/.test(text) && !/custom-elements/.test(text)) continue;
		if (/custom-elements\.json/.test(text)) out.manifestReads += 1;
		else if (/\/pack\//.test(text)) out.packReads += 1;
		else if (/\.stories\.ts/.test(text) && !/phase0/.test(text)) out.storyReads += 1;
		else if (/src\//.test(text) && !/phase0/.test(text)) out.sourceReads += 1;
	}
	return out;
}

/** Attribute, slot and event names a page sets on each tag, by pattern (as phase 0 counted them). */
function pageFacts(source) {
	const attributes = new Map();
	const add = (tag, name, value) => {
		if (!attributes.has(tag)) attributes.set(tag, new Map());
		attributes.get(tag).set(name, value);
	};
	for (const [, tag, body] of source.matchAll(/<(violet-[a-z0-9-]+)((?:[^>`]|\$\{[^}]*\})*)>/g))
		for (const [, name, value] of body.matchAll(/\s[?.@]?([a-z][a-z0-9-]*)(?:="([^"$]*)")?/g))
			add(tag, name, value);
	const bound = new Map();
	for (const [, variable, tag] of source.matchAll(
		/(?:const|let)\s+(\w+)\s*=\s*document\.createElement\(\s*["'](violet-[a-z0-9-]+)["']/g
	))
		bound.set(variable, tag);
	for (const [, variable, name, value] of source.matchAll(
		/(\w+)\.(?:set|toggle)Attribute\(\s*["']([a-z][a-z0-9-]*)["'](?:\s*,\s*["']([^"']*)["'])?/g
	))
		if (bound.has(variable)) add(bound.get(variable), name, value);
	for (const [, variable, property, value] of source.matchAll(
		/(\w+)\.([a-z][A-Za-z]*)\s*=(?!=)\s*(?:["']([^"']*)["'])?/g
	))
		if (bound.has(variable))
			add(
				bound.get(variable),
				property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
				value
			);
	const slots = new Set(
		[...source.matchAll(/\sslot[=:]\s*["']([a-z0-9-]+)["']/g)].map((m) => m[1])
	);
	const events = new Set(
		[...source.matchAll(/(?:addEventListener\(\s*["'`]|@)([a-z][a-z0-9-]*)/g)].map((m) => m[1])
	);
	const properties = new Set([...source.matchAll(/(--[a-z][a-z0-9-]*)/g)].map((m) => m[1]));
	return { attributes, slots, events, properties };
}

/** For one brief answer and one page: per section, what was offered and what the page names. */
function used(brief, source, onPage) {
	const facts = pageFacts(source);
	const count = () => ({ offered: 0, named: 0 });
	const out = {
		'declared-only attributes with no finite values': count(),
		'remaining attributes': count(),
		'finite values': count(),
		slots: count(),
		events: count(),
		cssProperties: count(),
		examples: count(),
		usage: count(),
		a11y: count(),
		roles: count(),
		form: count(),
	};
	for (const component of brief.data?.content?.components ?? []) {
		if (!onPage.includes(component.tag)) continue;
		const set = facts.attributes.get(component.tag) ?? new Map();
		const sectionBasis = component.attributes?.basis;
		for (const attribute of component.attributes?.items ?? []) {
			const basis = attribute.basis ?? sectionBasis;
			const key =
				basis === 'declared' && !attribute.values
					? 'declared-only attributes with no finite values'
					: 'remaining attributes';
			out[key].offered += 1;
			if (set.has(attribute.name)) out[key].named += 1;
			if (attribute.values) {
				out['finite values'].offered += 1;
				const values = attribute.values.map((entry) => entry?.value ?? entry);
				if (values.includes(set.get(attribute.name))) out['finite values'].named += 1;
			}
		}
		for (const slot of component.slots?.items ?? []) {
			if (!slot.name) continue;
			out.slots.offered += 1;
			if (facts.slots.has(slot.name)) out.slots.named += 1;
		}
		for (const event of component.events?.items ?? []) {
			out.events.offered += 1;
			if (facts.events.has(event.name)) out.events.named += 1;
		}
		for (const property of component.cssProperties?.items ?? []) {
			out.cssProperties.offered += 1;
			if (facts.properties.has(property.name)) out.cssProperties.named += 1;
		}
		for (const key of ['examples', 'usage', 'a11y', 'roles', 'form'])
			out[key].offered += component[key]?.items?.length ?? 0;
	}
	return out;
}

function collect(results) {
	const rows = [];
	for (const task of readdirSync(results).sort())
		for (const arm of readdirSync(join(results, task)).sort())
			for (const run of readdirSync(join(results, task, arm)).sort()) {
				const directory = join(results, task, arm, run);
				if (!existsSync(join(directory, 'meta.json'))) continue;
				const meta = readJson(join(directory, 'meta.json'));
				const evaluation = existsSync(join(directory, 'eval.json'))
					? readJson(join(directory, 'eval.json'))
					: {};
				const stories = Object.entries(evaluation.stories ?? {});
				const tags = [...new Set(stories.flatMap(([, story]) => story.tags ?? []))].sort();
				const source = existsSync(join(directory, 'page.stories.ts'))
					? readFileSync(join(directory, 'page.stories.ts'), 'utf8')
					: '';
				const calls = toolCalls(join(directory, 'stream.jsonl'));
				const commands = { 'components-brief': [], 'components-list': [], 'components-open': [] };
				const otherUmbel = [];
				for (const call of calls) {
					const command = componentCommand(call);
					if (command === undefined) continue;
					if (commands[command])
						commands[command].push({
							bytes: Buffer.byteLength(call.answer),
							input: call.name.endsWith('afd-call') ? call.input.input : call.input,
							answer: parse(call.answer),
						});
					else otherUmbel.push(command);
				}
				const briefs = commands['components-brief'].filter(
					(brief) => brief.answer?.success && brief.answer.data?.content
				);
				const textBriefs = commands['components-brief'].filter(
					(brief) => brief.answer?.success && typeof brief.answer.data?.text === 'string'
				).length;
				const refusedBriefs = commands['components-brief']
					.filter((brief) => brief.answer && !brief.answer.success)
					.map((brief) => brief.answer.error?.code);
				const asked = [
					...new Set(
						briefs.flatMap((brief) => brief.answer.data.content.components.map((c) => c.tag))
					),
				].sort();
				const last = briefs.at(-1);
				rows.push({
					task,
					arm,
					run: Number(run),
					model: meta.model,
					...reading(calls),
					calls: Object.fromEntries(
						Object.entries(commands).map(([name, list]) => [
							name,
							{ count: list.length, bytes: list.map((item) => item.bytes) },
						])
					),
					otherUmbel,
					textBriefs,
					refusedBriefs,
					briefSizes: briefs.map((brief) => {
						const answered = brief.answer.data.content.components.map((c) => c.tag);
						return {
							bytes: brief.bytes,
							tags: answered.length,
							declarations: declarationBytes(answered),
							sections: sectionBytes(brief.answer),
						};
					}),
					briefInputs: briefs.map((brief) =>
						brief.input?.source !== undefined
							? { source: Buffer.byteLength(String(brief.input.source)) }
							: { tags: brief.input?.tags?.length }
					),
					unknown: briefs.flatMap((brief) => (brief.answer.data.unknown ?? []).map((u) => u.tag)),
					shed: last
						? (last.answer.data.omitted ?? []).flatMap((entry) => [
								...(entry.sections ?? []),
								...(entry.pieces ?? []).map((piece) => `piece:${piece}`),
							])
						: [],
					asked,
					tags,
					...(last
						? {
								used: used(
									last.answer,
									source,
									asked.filter((tag) => tags.includes(tag))
								),
							}
						: {}),
				});
			}
	return rows;
}

const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function report(rows) {
	const of = (list, test) => `${list.filter(test).length} of ${list.length}`;
	for (const arm of [...new Set(rows.map((row) => row.arm))]) {
		const mine = rows.filter((row) => row.arm === arm);
		const sum = (pick) => mine.reduce((total, row) => total + pick(row), 0);
		console.log(
			`Arm ${arm} (${mine.length} runs, models ${[...new Set(mine.map((r) => r.model))].join(', ')}):`
		);
		console.log(
			`  read component source ${sum((r) => r.sourceReads)} times (in ${of(mine, (r) => r.sourceReads > 0)} runs), stories ${sum((r) => r.storyReads)}, the manifest ${sum((r) => r.manifestReads)}, the committed pack ${sum((r) => r.packReads)}`
		);
		if (arm !== 'c') continue;
		for (const name of ['components-brief', 'components-list', 'components-open']) {
			const bytes = mine.flatMap((row) => row.calls[name].bytes);
			console.log(
				`  ${name}: ${bytes.length} calls in ${of(mine, (r) => r.calls[name].count > 0)} runs${bytes.length ? `, bytes median ${median(bytes)} (${Math.min(...bytes)} to ${Math.max(...bytes)})` : ''}`
			);
		}
		const others = mine.flatMap((row) => row.otherUmbel);
		console.log(`  other Umbel tools: ${others.length ? others.join(', ') : 'none'}`);
		console.log(
			`  briefs by source: ${sum((r) => r.briefInputs.filter((i) => i.source !== undefined).length)}; as text: ${sum((r) => r.textBriefs)}; refused: ${mine.flatMap((r) => r.refusedBriefs).join(', ') || 'none'}`
		);
		const sizes = mine.flatMap((row) => row.briefSizes);
		const ratios = sizes.map((size) => size.bytes / size.declarations);
		console.log(
			`  JSON brief bytes against the same components' declarations: median ${Math.round(median(ratios) * 100)} % (${Math.round(Math.min(...ratios) * 100)} % to ${Math.round(Math.max(...ratios) * 100)} %), at most half in ${ratios.filter((r) => r <= 0.5).length} of ${ratios.length}`
		);
		const totals = {};
		for (const size of sizes)
			for (const [key, value] of Object.entries(size.sections))
				totals[key] = (totals[key] ?? 0) + value;
		const all = Object.values(totals).reduce((a, b) => a + b, 0);
		console.log(
			`  where those briefs' bytes went: ${Object.entries(totals)
				.sort((a, b) => b[1] - a[1])
				.map(([key, value]) => `${key} ${Math.round((value / all) * 100)} %`)
				.join(', ')}`
		);
		console.log(`  tags in unknown: ${mine.flatMap((r) => r.unknown).join(', ') || 'none'}`);
		const shed = new Map();
		for (const row of mine)
			for (const section of row.shed) shed.set(section, (shed.get(section) ?? 0) + 1);
		console.log(
			`  last brief shed: ${[...shed].map(([section, n]) => `${section} ${n}`).join(', ') || 'nothing'}`
		);
		const briefed = mine.filter((row) => row.used);
		console.log(
			`  what the ${briefed.length} briefed pages name of the last brief, by shedding order:`
		);
		for (const key of Object.keys(briefed[0]?.used ?? {})) {
			const offered = briefed.reduce((total, row) => total + row.used[key].offered, 0);
			const named = briefed.reduce((total, row) => total + row.used[key].named, 0);
			const counted = !['examples', 'usage', 'a11y', 'roles', 'form'].includes(key);
			console.log(
				`    ${key}: offered ${offered}${counted ? `, named ${named} (${offered ? Math.round((named / offered) * 100) : 0} %) on ${of(briefed, (r) => r.used[key].named > 0)} pages` : ', not visible in a page'}`
			);
		}
		console.log(
			`  components asked for: median ${median(briefed.map((r) => r.asked.length))}, on the page: median ${median(briefed.map((r) => r.asked.filter((t) => r.tags.includes(t)).length))}`
		);
	}
}

if (mode === 'collect' && first) console.log(JSON.stringify(collect(resolve(first)), null, '\t'));
else if (mode === 'report' && first) report(readJson(first));
else {
	console.error('Usage: node sessions.mjs collect <results dir> | report <sessions.json>');
	process.exit(2);
}
