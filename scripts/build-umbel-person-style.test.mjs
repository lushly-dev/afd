import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	BEGIN,
	buildUmbelPersonStyle,
	END,
	EXPORT_PATH,
	generate,
	property,
	SHEET_PATH,
} from './build-umbel-person-style.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'umbel-person-style-'));
	for (const path of [EXPORT_PATH, SHEET_PATH]) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		cpSync(join(repoRoot, path), join(root, path));
	}
	return root;
}

test('the committed person page sheet matches the theme export', () => {
	const result = buildUmbelPersonStyle({ root: repoRoot, check: true });
	assert.equal(
		result.ok,
		true,
		`${SHEET_PATH} is stale: run node scripts/build-umbel-person-style.mjs`
	);
});

test('--check fails when the export changes, and a write brings the sheet back in step', () => {
	const root = fixture();
	try {
		const exportFile = join(root, EXPORT_PATH);
		const theme = JSON.parse(readFileSync(exportFile, 'utf8'));
		theme.presets.dark.find((token) => token.id === 'color.surface.page').value = '#000001';
		writeFileSync(exportFile, JSON.stringify(theme));
		assert.equal(buildUmbelPersonStyle({ root, check: true }).ok, false);
		const written = buildUmbelPersonStyle({ root });
		assert.equal(written.stale, true);
		assert.match(
			readFileSync(join(root, SHEET_PATH), 'utf8'),
			/--violet-color-surface-page: #000001;/
		);
		assert.equal(buildUmbelPersonStyle({ root, check: true }).ok, true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('--check fails on a hand edit inside the generated part', () => {
	const root = fixture();
	try {
		const sheetFile = join(root, SHEET_PATH);
		const sheet = readFileSync(sheetFile, 'utf8');
		writeFileSync(
			sheetFile,
			sheet.replace(/--violet-color-text-primary: [^;]+;/, '--violet-color-text-primary: #1b1b1f;')
		);
		assert.equal(buildUmbelPersonStyle({ root, check: true }).ok, false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a rule naming a property the export lacks is refused, and nothing is written', () => {
	const root = fixture();
	try {
		const sheetFile = join(root, SHEET_PATH);
		const sheet = `${readFileSync(sheetFile, 'utf8')}\np { color: var(--violet-color-text-nonesuch); }\n`;
		writeFileSync(sheetFile, sheet);
		assert.throws(() => buildUmbelPersonStyle({ root }), /--violet-color-text-nonesuch/);
		assert.equal(readFileSync(sheetFile, 'utf8'), sheet);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('only the properties the rules name are written', () => {
	const sheet = readFileSync(join(repoRoot, SHEET_PATH), 'utf8');
	const generated = sheet.slice(sheet.indexOf(BEGIN), sheet.indexOf(END));
	const rules = sheet.replace(generated, '');
	const written = new Set(generated.match(/--violet-[a-z0-9-]+/g));
	const named = new Set(rules.match(/--violet-[a-z0-9-]+/g));
	assert.deepEqual([...written].sort(), [...named].sort());
	assert.ok(!written.has('--violet-z-index-toast'), 'an unused token was written');
});

test('a sheet without the markers is refused', () => {
	const root = fixture();
	try {
		writeFileSync(join(root, SHEET_PATH), 'body { margin: 0; }\n');
		assert.throws(() => buildUmbelPersonStyle({ root, check: true }), /GENERATED/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('high contrast overrides everything dark sets, so it wins when both media queries match', () => {
	const theme = {
		presets: {
			light: [
				{ id: 'color.surface.page', value: '#fff' },
				{ id: 'color.text.primary', value: '#111' },
				{ id: 'radius.control', value: '8px' },
			],
			dark: [
				{ id: 'color.surface.page', value: '#000' },
				{ id: 'color.text.primary', value: '#eee' },
				{ id: 'radius.control', value: '8px' },
			],
			'high-contrast': [
				{ id: 'color.surface.page', value: '#fff' },
				{ id: 'color.text.primary', value: '#000' },
				{ id: 'radius.control', value: '8px' },
			],
		},
	};
	const out = generate(theme);
	assert.ok(out.startsWith(BEGIN) && out.endsWith(END));
	const high = out.slice(out.indexOf('@media (prefers-contrast: more)'));
	// The page colour is light's in high contrast, but dark changed it, so high contrast restates it.
	assert.match(high, /--violet-color-surface-page: #fff;/);
	assert.match(high, /--violet-color-text-primary: #000;/);
	assert.doesNotMatch(high, /--violet-radius-control/);
	const dark = out.slice(
		out.indexOf('@media (prefers-color-scheme: dark)'),
		out.indexOf('@media (prefers-contrast: more)')
	);
	assert.doesNotMatch(dark, /--violet-radius-control/);
	assert.equal(property('size.focus-ring.width'), '--violet-size-focus-ring-width');
});

test('an unknown argument is refused, and nothing is written', () => {
	const sheet = readFileSync(join(repoRoot, SHEET_PATH), 'utf8');
	const run = spawnSync(
		process.execPath,
		[join(repoRoot, 'scripts/build-umbel-person-style.mjs'), '--chek'],
		{
			encoding: 'utf8',
		}
	);
	assert.equal(run.status, 2);
	assert.match(run.stderr, /unknown argument --chek/);
	assert.equal(readFileSync(join(repoRoot, SHEET_PATH), 'utf8'), sheet);
});

test('a misspelt property with an uppercase letter is still caught', () => {
	const root = fixture();
	try {
		const sheetFile = join(root, SHEET_PATH);
		writeFileSync(
			sheetFile,
			`${readFileSync(sheetFile, 'utf8')}\np { color: var(--violet-color-text-primaryX); }\n`
		);
		assert.throws(() => buildUmbelPersonStyle({ root }), /--violet-color-text-primaryX/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
