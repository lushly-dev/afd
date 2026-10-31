#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeStoryModule } from './csf.mjs';

// Retained-story inventory: Storybook's own `storybook index` output supplies discovered
// identities and effective tags; the static CSF reading supplies the annotations the index omits.
// Project-level policy is passed in explicitly because preview files execute code.

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// An annotation level that is missing, unreadable or has an unreadable spread may set any field
// it does not show, so an outer level must not be used as its effective value.
const hidden = (annotations) => !annotations?.fields || annotations.opaque;

/** Story-over-meta precedence for replaced fields such as play and render. */
function effective(story, meta, field) {
	if (story?.fields?.[field]) return { source: 'story', value: story.fields[field] };
	if (hidden(story)) return { source: 'unresolved' };
	if (meta?.fields?.[field]) return { source: 'meta', value: meta.fields[field] };
	if (hidden(meta)) return { source: 'unresolved' };
	return undefined;
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function merge(base, override) {
	if (override === undefined) return base;
	if (!isObject(base) || !isObject(override)) return override;
	const result = { ...base };
	for (const [key, value] of Object.entries(override)) result[key] = merge(base[key], value);
	return result;
}

/**
 * Key-merged project → meta → story value, as Storybook merges parameters and globals.
 * `read` returns the level's readValue result or undefined when the level does not set it.
 */
function merged(story, meta, base, read) {
	let value = base;
	const sources = base === undefined ? [] : ['project'];
	for (const [source, annotations] of [
		['meta', meta],
		['story', story],
	]) {
		if (hidden(annotations)) return { source: 'unresolved' };
		const level = read(annotations);
		if (level === undefined) continue;
		if (level === null || !('static' in level)) return { source: 'unresolved' };
		value = merge(value, level.static);
		sources.push(source);
	}
	return { source: sources.at(-1) ?? 'none', sources, value };
}

function readPolicy(name) {
	return (annotations) => {
		const parameters = annotations.fields.parameters;
		if (!parameters) return undefined;
		// A wholly dynamic or partly unreadable parameters object may set this policy.
		if (!parameters.policies || parameters.opaque) return null;
		return parameters.policies[name];
	};
}

const present = (value) =>
	value && value.kind !== 'absent' && !(value.kind === 'array' && value.count === 0);

/** Combine an index with per-file analyses into story records and counts. */
export function buildInventory({ consumer, index, files, project }) {
	const entries = Object.values(index.entries);
	const stories = entries.filter((entry) => entry.type === 'story');
	const docs = entries.filter((entry) => entry.type === 'docs');
	const records = [];
	const mismatches = [];
	const unresolved = [];
	const byFile = new Map();
	for (const story of stories)
		byFile.set(story.importPath, [...(byFile.get(story.importPath) ?? []), story]);
	for (const [importPath, indexed] of byFile) {
		const file = files[importPath];
		const indexedNames = new Set(indexed.map((story) => story.exportName));
		for (const name of Object.keys(file.analysis.stories))
			if (!indexedNames.has(name))
				mismatches.push({ importPath, exportName: name, kind: 'export-not-indexed' });
		for (const problem of file.analysis.problems) mismatches.push({ importPath, ...problem });
		const meta = file.analysis.meta;
		for (const item of meta?.unresolved ?? [
			{ field: '<meta>', text: meta?.text ?? '<missing default export>' },
		])
			unresolved.push({ importPath, exportName: 'default', ...item });
		for (const entry of indexed) {
			const story = file.analysis.stories[entry.exportName];
			if (!story)
				mismatches.push({
					importPath,
					exportName: entry.exportName,
					kind: 'indexed-export-not-read',
				});
			else if (!story.resolved)
				for (const item of story.unresolved ?? [{ field: '<story>', text: story.text }])
					unresolved.push({ importPath, exportName: entry.exportName, ...item });
			const play = effective(story, meta, 'play');
			const render = effective(story, meta, 'render');
			const a11y = merged(story, meta, project.a11y, readPolicy('a11y'));
			const globals = merged(story, meta, undefined, (annotations) => annotations.fields.globals);
			const accumulated = (field) => {
				const levels = [];
				for (const [level, annotations] of [
					['meta', meta],
					['story', story],
				]) {
					if (present(annotations?.fields?.[field])) levels.push(level);
					else if (hidden(annotations)) levels.push('unresolved');
				}
				return levels;
			};
			records.push({
				id: entry.id,
				title: entry.title,
				name: entry.name,
				exportName: entry.exportName,
				importPath,
				fileSha256: file.sha256,
				tags: entry.tags,
				tested:
					project.includeTags.some((tag) => entry.tags.includes(tag)) &&
					!project.excludeTags.some((tag) => entry.tags.includes(tag)),
				skipped: project.skipTags.some((tag) => entry.tags.includes(tag)),
				// null: no play runs. `unresolved`: an unreadable level may contribute one.
				play:
					play?.source === 'unresolved'
						? { source: 'unresolved' }
						: present(play?.value)
							? { source: play.source, kind: play.value.kind, contextKeys: play.value.contextKeys }
							: null,
				render:
					render?.source === 'unresolved'
						? 'unresolved'
						: present(render?.value)
							? render.source
							: 'framework-default',
				a11y,
				// Meta/story overrides only; preview initialGlobals are not modelled.
				globals: globals.source === 'none' ? null : globals,
				explicitName: story?.fields?.name !== undefined || story?.fields?.storyName !== undefined,
				explicitId: story?.fields?.id !== undefined || meta?.fields?.id !== undefined,
				decorators: accumulated('decorators'),
				lifecycle: ['loaders', 'beforeEach', 'afterEach', 'mount'].flatMap((field) =>
					accumulated(field).map((level) => `${field}:${level}`)
				),
				resolved: Boolean(story?.resolved && meta?.resolved),
			});
		}
	}
	const count = (predicate) => records.filter(predicate).length;
	const tally = (values) => {
		const totals = {};
		for (const value of values) totals[value] = (totals[value] ?? 0) + 1;
		return totals;
	};
	const helperImports = {};
	const jestDomFiles = [];
	for (const [importPath, file] of Object.entries(files)) {
		for (const [specifier, names] of Object.entries(file.analysis.imports))
			for (const name of names)
				helperImports[`${specifier}:${name}`] = (helperImports[`${specifier}:${name}`] ?? 0) + 1;
		if (file.analysis.jestDomMatchers.length)
			jestDomFiles.push({ importPath, matchers: file.analysis.jestDomMatchers });
	}
	const playContext = {};
	for (const record of records)
		for (const key of record.play?.contextKeys ?? [])
			playContext[key] = (playContext[key] ?? 0) + 1;
	return {
		schema: 'specimen-story-inventory/1',
		consumer,
		indexVersion: index.v,
		project,
		summary: {
			files: byFile.size,
			docsEntries: docs.length,
			stories: records.length,
			tested: count((record) => record.tested),
			skipped: count((record) => record.skipped),
			excluded: count((record) => !record.tested),
			withPlay: count((record) => record.play && record.play.source !== 'unresolved'),
			playUnknown: count((record) => record.play?.source === 'unresolved'),
			playFromStory: count((record) => record.play?.source === 'story'),
			playFromMeta: count((record) => record.play?.source === 'meta'),
			smokeOnly: count((record) => record.tested && !record.skipped && record.play === null),
			filesWithoutAnyPlay: [...byFile.keys()].filter((path) =>
				records.every((r) => r.importPath !== path || r.play === null)
			).length,
			playTagWithoutReadPlay: count(
				(record) => record.tags.includes('play-fn') && record.play === null
			),
			readPlayWithoutPlayTag: count(
				(record) =>
					record.play && record.play.source !== 'unresolved' && !record.tags.includes('play-fn')
			),
			customRender: tally(records.map((record) => record.render)),
			a11ySource: tally(records.map((record) => record.a11y.source)),
			a11yOverrides: records
				.filter((record) => !['project', 'unresolved'].includes(record.a11y.source))
				.map((r) => ({ id: r.id, ...r.a11y })),
			a11yUnresolved: count((record) => record.a11y.source === 'unresolved'),
			globalsOverrides: records
				.filter((record) => record.globals && record.globals.source !== 'unresolved')
				.map((r) => ({ id: r.id, ...r.globals })),
			globalsUnresolved: count((record) => record.globals?.source === 'unresolved'),
			explicitNames: count((record) => record.explicitName),
			explicitIds: count((record) => record.explicitId),
			decorators: tally(records.flatMap((record) => record.decorators)),
			lifecycle: tally(records.flatMap((record) => record.lifecycle)),
			playContext,
			tags: tally(records.flatMap((record) => record.tags)),
			helperImports,
			jestDomFiles,
			unresolvedAnnotations: unresolved.length,
			unresolvedStories: count((record) => !record.resolved),
			mismatches: mismatches.length,
		},
		unresolved,
		mismatches,
		stories: records,
	};
}

async function main() {
	const args = process.argv.slice(2);
	const option = (name) => {
		const index = args.indexOf(name);
		if (index < 0 || !args[index + 1]) throw new Error(`${name} is required`);
		return args[index + 1];
	};
	const root = resolve(option('--root'));
	const indexPath = resolve(option('--index'));
	const project = JSON.parse(option('--project'));
	for (const key of ['a11y', 'includeTags', 'excludeTags', 'skipTags'])
		if (!(key in project)) throw new Error(`--project must declare ${key}`);
	const indexText = await readFile(indexPath, 'utf8');
	const index = JSON.parse(indexText);
	const files = {};
	for (const entry of Object.values(index.entries)) {
		if (entry.type !== 'story' || files[entry.importPath]) continue;
		const text = await readFile(join(root, entry.importPath), 'utf8');
		files[entry.importPath] = {
			sha256: sha256(text),
			analysis: analyzeStoryModule(text, entry.importPath),
		};
	}
	const inventory = buildInventory({ consumer: option('--consumer'), index, files, project });
	inventory.indexSha256 = sha256(indexText);
	await writeFile(resolve(option('--out')), `${JSON.stringify(inventory, null, '\t')}\n`);
	process.stdout.write(
		`${JSON.stringify({ consumer: inventory.consumer, ...inventory.summary, a11yOverrides: inventory.summary.a11yOverrides.length, globalsOverrides: inventory.summary.globalsOverrides.length }, null, 2)}\n`
	);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
