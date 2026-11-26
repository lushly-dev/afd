#!/usr/bin/env node
/**
 * Writes the theme of Umbel's person page from AFD's theme export.
 *
 * The person page (endpoints/umbel/src/person/page.rs) is served with a CSP of
 * `default-src 'none'; style-src 'self'` and no scripts, so it cannot load the
 * shared components. It takes their look instead: its one style sheet,
 * endpoints/umbel/src/person/style.css, opens with the `--violet-*` custom
 * properties of the light, dark and high-contrast presets in
 * foundations/fast-af/packages/violet-elements/tokens/violet-theme.export.json,
 * and its hand-written rules below them use nothing else for colour, radius,
 * shadow or type (#1490).
 *
 *   node scripts/build-umbel-person-style.mjs
 *   node scripts/build-umbel-person-style.mjs --check
 *
 * Rewrites only the part between the two GENERATED markers. Nothing is written
 * when a rule names a `--violet-*` property the export has no token for, and only
 * the properties the rules name are written. With
 * --check, verifies that the committed sheet matches without writing;
 * scripts/build-umbel-person-style.test.mjs runs it in `pnpm test:tooling`.
 * biome.json leaves the sheet out, since its formatter would respell the export's values;
 * the generated part is checked here instead, and the rules are kept in Biome's format by hand.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const EXPORT_PATH =
	'foundations/fast-af/packages/violet-elements/tokens/violet-theme.export.json';
export const SHEET_PATH = 'endpoints/umbel/src/person/style.css';
export const BEGIN =
	'/* GENERATED from violet-theme.export.json by scripts/build-umbel-person-style.mjs: do not edit. */';
export const END = '/* END GENERATED */';

/** The custom property a token id becomes, as the shared components name it. */
export const property = (id) => `--violet-${id.replaceAll('.', '-')}`;

const block = (selector, tokens, extra = []) =>
	[
		`${selector} {`,
		...extra.map((line) => `\t${line}`),
		...tokens.map(([id, value]) => `\t${property(id)}: ${value};`),
		'}',
	].join('\n');

const indent = (text) =>
	text
		.split('\n')
		.map((line) => `\t${line}`)
		.join('\n');

/**
 * The generated part of the sheet, from the export's presets: the tokens whose property is in
 * `used`, or every token when `used` is not given.
 */
export function generate(theme, used) {
	const presets = theme?.presets ?? {};
	for (const name of ['light', 'dark', 'high-contrast']) {
		if (!Array.isArray(presets[name])) throw new Error(`${EXPORT_PATH} has no "${name}" preset`);
	}
	const light = new Map(presets.light.map(({ id, value }) => [id, value]));
	const dark = new Map(presets.dark.map(({ id, value }) => [id, value]));
	const high = new Map(presets['high-contrast'].map(({ id, value }) => [id, value]));
	for (const [name, map] of [
		['dark', dark],
		['high-contrast', high],
	]) {
		for (const id of map.keys()) {
			if (!light.has(id))
				throw new Error(`the "${name}" preset has ${id}, which the light preset lacks`);
		}
	}
	const wanted = (id) => used === undefined || used.has(property(id));
	const lightTokens = [...light].filter(([id]) => wanted(id));
	const darkTokens = [...dark].filter(([id, value]) => wanted(id) && light.get(id) !== value);
	// High contrast is drawn on light. It overrides every token that the light or the dark
	// preset differs from it in, so it wins over the dark block when both media queries match.
	const highTokens = [...light.keys()]
		.filter(
			(id) =>
				wanted(id) &&
				((high.get(id) ?? light.get(id)) !== light.get(id) ||
					(dark.has(id) && dark.get(id) !== light.get(id)))
		)
		.map((id) => [id, high.get(id) ?? light.get(id)]);
	return [
		BEGIN,
		block(':root', lightTokens, ['color-scheme: light dark;']),
		'',
		`@media (prefers-color-scheme: dark) {\n${indent(block(':root', darkTokens, ['color-scheme: dark;']))}\n}`,
		'',
		`@media (prefers-contrast: more) {\n${indent(block(':root', highTokens, ['color-scheme: light;']))}\n}`,
		END,
	].join('\n');
}

/** The sheet with its generated part replaced, or an error naming what is wrong. */
export function render(sheet, theme) {
	const begin = sheet.indexOf(BEGIN);
	const end = sheet.indexOf(END);
	if (begin < 0 || end < begin)
		throw new Error(
			`${SHEET_PATH} must hold the GENERATED and END GENERATED markers, in that order`
		);
	// Only the properties the hand-written rules name are written: the sheet is fetched on every
	// page view (`cache-control: no-store`).
	const rules = sheet.slice(0, begin) + sheet.slice(end + END.length);
	const used = new Set(rules.match(/--violet-[A-Za-z0-9_-]+/g) ?? []);
	const next = sheet.slice(0, begin) + generate(theme, used) + sheet.slice(end + END.length);
	const known = new Set(theme.presets.light.map(({ id }) => property(id)));
	const unknown = [...used].filter((name) => !known.has(name));
	if (unknown.length > 0)
		throw new Error(
			`${SHEET_PATH} names properties the export has no token for: ${unknown.join(', ')}`
		);
	return next;
}

export function buildUmbelPersonStyle({ root = defaultRoot, check = false } = {}) {
	const sheetFile = join(root, SHEET_PATH);
	const theme = JSON.parse(readFileSync(join(root, EXPORT_PATH), 'utf8'));
	const sheet = readFileSync(sheetFile, 'utf8');
	const next = render(sheet, theme);
	const stale = next !== sheet;
	if (stale && !check) writeFileSync(sheetFile, next);
	return { ok: !(check && stale), stale, file: SHEET_PATH };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const extra = process.argv.slice(2).filter((arg) => arg !== '--check');
	if (extra.length > 0) {
		console.error(`unknown argument ${extra[0]}: the only option is --check`);
		process.exit(2);
	}
	const check = process.argv.includes('--check');
	try {
		const result = buildUmbelPersonStyle({ check });
		if (!result.ok) {
			console.error(`${result.file} is stale: run node scripts/build-umbel-person-style.mjs`);
			process.exit(1);
		}
		console.log(
			check
				? `${result.file} matches the export`
				: `${result.stale ? 'wrote' : 'unchanged'} ${result.file}`
		);
	} catch (error) {
		console.error(error.message);
		process.exit(1);
	}
}
