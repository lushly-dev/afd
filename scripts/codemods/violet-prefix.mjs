#!/usr/bin/env node
/**
 * Moves hand-written reads and writes of Violet's semantic custom properties onto the prefixed
 * names of token interface version 4 (#1786, phase 4): `--color-surface-page` becomes
 * `--violet-color-surface-page`, the name `@lushly-dev/violet-runtime/property`'s
 * `tokenCustomProperty(id, 'violet')` gives and violet-core's CSS exporter writes with
 * `prefix: 'violet'`.
 *
 * Each scope of the plan below pairs paths with the ids whose names move there, so a name a scope
 * owns itself is left alone: the AFD site's own stylesheets define `--color-text-muted` and
 * `--weight-medium` for themselves, so only the FAST-AF review pages, which style the components,
 * move, and only the components' interface ids.
 *  - `interface`: the ids of violet-elements' `tokens/interface.json`, the properties the
 *    components read.
 *  - `export`: the ids of `tokens/violet-theme.export.json`'s default preset, every property the
 *    generated theme sheet sets (the interface and the rest of Loam's component ids).
 *  - `loam`: the ids of Loam's contract (`endpoints/loam/packages/theme/contract/tokens.json`),
 *    shell and density among them.
 *
 * It is text, not syntax: a name appears in CSS files, `css` template literals, HTML, JSON,
 * Markdown and strings alike. A name is replaced only as a whole custom property name: the
 * character before `--` (unless it ends a `\t` or `\n` escape) and the one after the name may not
 * be a letter, digit, `_` or `-`, so
 * `--violet-color-x`, `--_color-x` and `--color-x-extra` are not touched. A line carrying
 * `violet-prefix: keep` is left as it is (the alias block's tests and migration notes name the old
 * properties on purpose). Generated files are not edited: their generators are run instead.
 * Running it again changes nothing.
 *
 * Usage: node scripts/codemods/violet-prefix.mjs [--check]
 *   --check  report what would change and exit 1 if anything would, writing nothing.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const checkOnly = process.argv.includes('--check');
const PREFIX = 'violet';
const KEEP = 'violet-prefix: keep';

const json = (path) => JSON.parse(readFileSync(join(repository, path), 'utf8'));
const elements = 'foundations/fast-af/packages/violet-elements';
const ID_SETS = {
	interface: () => Object.keys(json(`${elements}/tokens/interface.json`).tokens),
	export: () => {
		const themeExport = json(`${elements}/tokens/violet-theme.export.json`);
		return themeExport.presets.light.map((token) => token.id);
	},
	loam: () => Object.keys(json('endpoints/loam/packages/theme/contract/tokens.json').tokens),
};

/** Paths (files or folders, from the repository root) and the id set whose names move in them. */
const PLAN = [
	{
		ids: 'export',
		paths: [
			`${elements}/src`,
			`${elements}/scripts`,
			`${elements}/specimen`,
			`${elements}/README.md`,
			`${elements}/THEME_ROADMAP.md`,
			'endpoints/health-dashboard/src',
			'endpoints/health-dashboard/README.md',
			'packages/examples',
		],
	},
	{
		ids: 'loam',
		paths: [
			'endpoints/loam/packages',
			'endpoints/loam/apps',
			'endpoints/loam/plugins',
			'endpoints/loam/docs/design.md',
			'.claude/skills/loam-design',
		],
	},
	{
		ids: 'interface',
		paths: [
			'site/fast-af/themes',
			// Written by scripts/build-site-afd-theme.mjs, which carries each themes/<name>.css patch
			// verbatim; it refuses to write while the site's themes leave the accent and well ids at
			// the built-in values, so its output is moved here with its sources.
			'site/fast-af/afd-theme.json',
			'site/fast-af/afd-theme.calm.json',
			'site/fast-af/afd-theme.refined.json',
			'site/fast-af/afd-theme.refined-grotesk.json',
			'site/fast-af/afd-theme.refined-plex.json',
			'site/fast-af/afd-theme.refined-ported.json',
			'site/fast-af/afd-theme.ruled.json',
			'site/fast-af/afd-theme.touch.json',
			'site/js/fast-af-page.js',
			'site/js/fast-af-review.js',
			'site/js/fast-af-stage.js',
		],
	},
];

/** Never edited: history, and output its generator writes from the moved sources. */
const SKIP_NAMES = new Set([
	'node_modules',
	'dist',
	'coverage',
	'.turbo',
	'CHANGELOG.md',
	'generated',
]);
const SKIP_PATHS = new Set([
	// The naming rule and the alias block name the unprefixed form on purpose.
	`${elements}/src/theme/violet-theme-css.ts`,
	// History: what was true when it was written.
	'.claude/skills/loam-design/references/history.md',
	// Written by `theme:build` from Loam's tree.
	'endpoints/loam/packages/theme/loam-theme.css',
	'endpoints/loam/packages/theme/loam-theme.json',
	'endpoints/loam/packages/theme/contract',
]);
const TEXT = /\.(?:ts|mts|cts|tsx|js|mjs|cjs|css|html|md|json|jsonc|svg)$/;

function* files(path) {
	const absolute = join(repository, path);
	if (!existsSync(absolute) || SKIP_PATHS.has(path)) return;
	if (statSync(absolute).isDirectory()) {
		for (const entry of readdirSync(absolute).sort()) {
			if (!SKIP_NAMES.has(entry)) yield* files(`${path}/${entry}`);
		}
	} else if (TEXT.test(path) && !SKIP_NAMES.has(path.split('/').at(-1))) {
		yield path;
	}
}

const kebab = (id) => id.replaceAll('.', '-');
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One pattern per id set: the old names, longest first, as whole custom property names. */
export function patternFor(ids) {
	const names = [...new Set(ids.map(kebab))].sort((a, b) => b.length - a.length).map(escapeRegExp);
	// A `\t` or `\n` escape in a string literal ends in a letter yet is a boundary.
	return new RegExp(
		`(?:(?<![A-Za-z0-9_-])|(?<=\\\\[nt]))--(${names.join('|')})(?![A-Za-z0-9_-])`,
		'g'
	);
}

/** `text` with every old name `pattern` matches prefixed, except on lines marked to keep. */
export function migrate(text, pattern) {
	let count = 0;
	const lines = text.split('\n').map((line) => {
		if (line.includes(KEEP)) return line;
		return line.replace(pattern, (_, name) => {
			count += 1;
			return `--${PREFIX}-${name}`;
		});
	});
	return { text: lines.join('\n'), count };
}

function main() {
	const changed = [];
	let total = 0;
	for (const scope of PLAN) {
		const pattern = patternFor(ID_SETS[scope.ids]());
		for (const root of scope.paths) {
			for (const file of files(root)) {
				const absolute = join(repository, file);
				const before = readFileSync(absolute, 'utf8');
				const { text, count } = migrate(before, pattern);
				if (count === 0) continue;
				total += count;
				changed.push(`${relative(repository, absolute)} (${count})`);
				if (!checkOnly) writeFileSync(absolute, text);
			}
		}
	}
	for (const line of changed) console.log(line);
	console.log(
		`${checkOnly ? 'Would rename' : 'Renamed'} ${total} properties in ${changed.length} files.`
	);
	if (checkOnly && changed.length > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
