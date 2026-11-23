#!/usr/bin/env node
/**
 * Generates or verifies the `afd-default` template block inside `loam-app.toml` from
 * `endpoints/loam/packages/theme/tree/*.tokens.json` (spec §4.2, F18, Q11).
 *
 * Usage:
 *   node templates/write.mjs          # update loam-app.toml in place
 *   node templates/write.mjs --check  # exit 1 if loam-app.toml is out of date
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(APP_DIR, 'loam-app.toml');
const TREE_DIR = resolve(APP_DIR, '../../../packages/theme/tree');
const BEGIN =
	'# BEGIN GENERATED afd-default (run `pnpm -F @lushly-dev/loam-app-violet templates:write`)';
const END = '# END GENERATED afd-default';

const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function tomlString(value) {
	return JSON.stringify(value);
}

export function buildAfdDefaultBlock() {
	const names = readdirSync(TREE_DIR)
		.filter((name) => name.endsWith('.tokens.json'))
		.sort(byCodePoint);
	const files = names.map((name) => {
		const raw = readFileSync(join(TREE_DIR, name), 'utf8').replaceAll('\r\n', '\n');
		return `{ name = ${tomlString(name)}, content = ${tomlString(raw)} }`;
	});
	return [
		BEGIN,
		'[[ui.documents.templates]]',
		'id = "afd-default"',
		'title = "AFD default tree"',
		'[ui.documents.templates.content]',
		'format = "violet-tree"',
		'version = 1',
		'rev = 0',
		'syncedRev = 0',
		'[ui.documents.templates.content.seed]',
		'files = [',
		...files.map((entry) => `  ${entry},`),
		']',
		END,
	].join('\n');
}

const current = readFileSync(MANIFEST_PATH, 'utf8').replaceAll('\r\n', '\n');
const start = current.indexOf(BEGIN);
const finish = current.indexOf(END);
if (start === -1 || finish === -1 || finish < start) {
	console.error(`Missing ${BEGIN} ... ${END} markers in ${MANIFEST_PATH}`);
	process.exit(1);
}

const generated = buildAfdDefaultBlock();
const updated = `${current.slice(0, start)}${generated}${current.slice(finish + END.length)}`;

if (process.argv.includes('--check')) {
	if (current !== updated) {
		console.error(
			'afd-default template in loam-app.toml is out of sync with endpoints/loam/packages/theme/tree/*.tokens.json. Run `pnpm -F @lushly-dev/loam-app-violet templates:write`.'
		);
		process.exit(1);
	}
	console.log('✓ afd-default template matches endpoints/loam/packages/theme/tree/*.tokens.json');
} else {
	writeFileSync(MANIFEST_PATH, updated, 'utf8');
	console.log('Updated afd-default template in loam-app.toml');
}
