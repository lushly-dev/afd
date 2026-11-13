#!/usr/bin/env node
// Component Briefs, step 0.1: what an agent reads today to learn FAST-AF's components, in bytes
// and calls, for a fixed set of pages. Reads the repository and writes nothing.
//
//   node docs/features/active/component-briefs/baseline.mjs          Markdown tables
//   node docs/features/active/component-briefs/baseline.mjs --json   the same numbers as JSON
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../../..');
const LIBRARY = join(ROOT, 'foundations/fast-af/packages/violet-elements');
const LOAM = join(ROOT, 'endpoints/loam');

/** A page that no package holds: twenty components across form, overlay and layout. */
const TWENTY = [
	...['text-field', 'text-area', 'select', 'option', 'combobox'],
	...['checkbox', 'radio-group', 'radio', 'switch', 'button'],
	...['dialog', 'popover', 'menu', 'menu-item', 'tooltip'],
	...['tabs', 'tab', 'tab-panel', 'card', 'divider'],
].map((name) => `violet-${name}`);

const bytes = (value) =>
	Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const manifestPath = join(LIBRARY, 'custom-elements.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const declarations = new Map(
	manifest.modules
		.flatMap((module) => module.declarations ?? [])
		.filter((declaration) => declaration.tagName)
		.map((declaration) => [declaration.tagName, declaration])
);

const isPublic = (member) =>
	member.name && !member.name.startsWith('#') && (member.privacy ?? 'public') === 'public';

/** The public surface of a declaration, with its prose: what `specimen-inspect` answers from. */
function publicApi(declaration) {
	return {
		tag: declaration.tagName,
		description: declaration.description ?? '',
		attributes: (declaration.attributes ?? []).map(
			({ name, type, default: initial, description }) => ({
				name,
				type: type?.text,
				default: initial,
				description,
			})
		),
		events: (declaration.events ?? []).map(({ name, type, description }) => ({
			name,
			type: type?.text,
			description,
		})),
		slots: declaration.slots ?? [],
		cssProperties: declaration.cssProperties ?? [],
		fields: (declaration.members ?? [])
			.filter((member) => member.kind === 'field' && isPublic(member))
			.map(({ name, type }) => ({ name, type: type?.text })),
	};
}

/**
 * The least a brief could say about a component from the manifest alone: a summary capped at 160
 * characters, each attribute's name, type and default, and slot and event names. No guidance.
 */
function briefFloor(declaration) {
	return {
		tag: declaration.tagName,
		summary: (declaration.description ?? '').split(/(?<=\.)\s/)[0].slice(0, 160),
		attributes: (declaration.attributes ?? []).map(({ name, type, default: initial }) => ({
			name,
			type: type?.text,
			default: initial,
		})),
		slots: (declaration.slots ?? []).map(({ name }) => name),
		events: (declaration.events ?? []).map(({ name }) => name),
	};
}

function walk(directory, keep, found = []) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === 'dist') continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) walk(path, keep, found);
		else if (keep(entry.name)) found.push(path);
	}
	return found;
}

const isSource = (name) => /\.(ts|html|css)$/.test(name) && !/\.(test|spec|d)\.ts$/.test(name);

/**
 * The library's tags a directory names, as whole names (`violet-option-group` is not also
 * `violet-option`, and `--violet-dialog-width` is no tag), and how each is used: written as
 * markup, created in code, or only named (a selector, a string, a comment).
 */
function tagsIn(directory) {
	const uses = new Map();
	const files = walk(directory, isSource);
	for (const file of files) {
		const text = readFileSync(file, 'utf8');
		for (const tag of declarations.keys()) {
			const whole = new RegExp(`(?<![A-Za-z0-9_-])${tag}(?![A-Za-z0-9_-])`);
			if (!whole.test(text)) continue;
			const use = uses.get(tag) ?? { files: 0, markup: false, created: false };
			use.files += 1;
			use.markup ||= new RegExp(`<${tag}(?![A-Za-z0-9_-])`).test(text);
			use.created ||= new RegExp(`createElement\\(\\s*['"\`]${tag}['"\`]`).test(text);
			uses.set(tag, use);
		}
	}
	return { files: files.length, uses };
}

/** A component's own source and stories: everything beside it but its tests. */
function sourcesOf(tag) {
	const directory = join(LIBRARY, 'src', tag.replace(/^violet-/, ''));
	try {
		return walk(directory, (name) => /\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name));
	} catch {
		return [];
	}
}

function routes(tags) {
	const known = tags.filter((tag) => declarations.has(tag));
	const each = known.map((tag) => declarations.get(tag));
	const sources = known.flatMap(sourcesOf);
	return {
		components: known.length,
		declarations: bytes(each),
		publicApi: bytes(each.map(publicApi)),
		briefFloor: bytes(each.map(briefFloor)),
		sources: {
			bytes: sources.reduce((sum, file) => sum + statSync(file).size, 0),
			files: sources.length,
		},
	};
}

for (const tag of TWENTY)
	if (!declarations.has(tag)) throw new Error(`Not in the manifest: ${tag}`);

const all = [...declarations.values()];
const sized = (project) => all.map((declaration) => bytes(project(declaration)));
const library = {
	manifestFile: statSync(manifestPath).size,
	elements: all.length,
	described: all.filter((declaration) => declaration.description).length,
	declarations: {
		total: bytes(all),
		median: median(sized((d) => d)),
		largest: Math.max(...sized((d) => d)),
	},
	publicApi: {
		total: bytes(all.map(publicApi)),
		median: median(sized(publicApi)),
		largest: Math.max(...sized(publicApi)),
	},
	briefFloor: {
		total: bytes(all.map(briefFloor)),
		median: median(sized(briefFloor)),
		largest: Math.max(...sized(briefFloor)),
	},
};

const scanned = {
	'Loam chrome': tagsIn(join(LOAM, 'packages/chrome/src')),
	'Loam console': tagsIn(join(LOAM, 'packages/console/src')),
	'Loam, every package and app': tagsIn(LOAM),
};
const pages = Object.fromEntries([
	...Object.entries(scanned).map(([name, { files, uses }]) => {
		const tags = [...uses.keys()].sort();
		const used = (test) => tags.filter((tag) => test(uses.get(tag)));
		return [
			name,
			{
				filesScanned: files,
				tags,
				markup: used((use) => use.markup).length,
				createdOnly: used((use) => !use.markup && use.created),
				namedOnly: used((use) => !use.markup && !use.created),
				...routes(tags),
			},
		];
	}),
	['Twenty-component page', { tags: TWENTY, ...routes(TWENTY) }],
]);

const result = { manifest: relative(ROOT, manifestPath), library, pages };

if (process.argv.includes('--json')) {
	console.log(JSON.stringify(result, null, '\t'));
} else {
	const n = (value) => value.toLocaleString('en-US').replaceAll(',', ' ');
	const line = (cells) => `| ${cells.join(' | ')} |`;
	console.log(line(['The whole library', 'Bytes', 'Median per element', 'Largest']));
	console.log(line(['---', '---', '---', '---']));
	console.log(
		line([
			`\`custom-elements.json\`, ${library.elements} elements`,
			n(library.manifestFile),
			'',
			'',
		])
	);
	for (const [label, key] of [
		['Declarations, compact JSON', 'declarations'],
		['Public API with prose', 'publicApi'],
		['Brief floor: API with no prose or guidance', 'briefFloor'],
	])
		console.log(
			line([label, n(library[key].total), n(library[key].median), n(library[key].largest)])
		);
	console.log();
	console.log(
		line([
			'Page',
			'Components',
			'Declarations',
			'Public API',
			'Brief floor',
			'Source and stories',
			'Files',
		])
	);
	console.log(line(['---', '---', '---', '---', '---', '---', '---']));
	for (const [name, page] of Object.entries(pages))
		console.log(
			line([
				name,
				page.components,
				n(page.declarations),
				n(page.publicApi),
				n(page.briefFloor),
				n(page.sources.bytes),
				page.sources.files,
			])
		);
	console.log();
	for (const [name, page] of Object.entries(pages)) {
		if (!page.filesScanned) continue;
		console.log(
			`${name}: ${page.tags.length} tags in ${page.filesScanned} files; ${page.markup} written as markup;`
		);
		console.log(`  created in code only: ${page.createdOnly.join(', ') || 'none'}`);
		console.log(`  named only: ${page.namedOnly.join(', ') || 'none'}`);
		console.log(`  ${page.tags.join(', ')}`);
	}
}
