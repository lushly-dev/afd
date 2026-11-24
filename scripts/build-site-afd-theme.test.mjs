import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSiteAfdThemes } from './build-site-afd-theme.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function copyFixtureRepo() {
	const root = mkdtempSync(join(tmpdir(), 'afd-site-theme-'));
	mkdirSync(join(root, 'foundations/fast-af/packages/violet-elements/tokens'), { recursive: true });
	mkdirSync(join(root, 'site/css'), { recursive: true });
	cpSync(
		join(repoRoot, 'foundations/fast-af/packages/violet-elements/tokens/violet-theme.export.json'),
		join(root, 'foundations/fast-af/packages/violet-elements/tokens/violet-theme.export.json')
	);
	cpSync(
		join(repoRoot, 'foundations/fast-af/packages/violet-elements/tokens/interface.json'),
		join(root, 'foundations/fast-af/packages/violet-elements/tokens/interface.json')
	);
	cpSync(join(repoRoot, 'site/css/tokens-m2.css'), join(root, 'site/css/tokens-m2.css'));
	cpSync(join(repoRoot, 'site/fast-af'), join(root, 'site/fast-af'), { recursive: true });
	return root;
}

test('committed site/fast-af themes build cleanly and match build-site-afd-theme.mjs', () => {
	const result = buildSiteAfdThemes({ root: repoRoot, check: true });
	assert.equal(result.ok, true, result.errors.join('\n'));
	assert.ok(result.summaries.length >= 2, 'must check the base theme and candidates');
});

test('buildSiteAfdThemes refuses an unthemed built-in brand token without corrupting afd-themes.json', () => {
	const root = copyFixtureRepo();
	try {
		const exportPath = join(
			root,
			'foundations/fast-af/packages/violet-elements/tokens/violet-theme.export.json'
		);
		const beforeIndex = readFileSync(join(root, 'site/fast-af/afd-themes.json'), 'utf8');
		const data = JSON.parse(readFileSync(exportPath, 'utf8'));
		data.presets.light.push({ id: 'color.brand.unthemed', value: '#ff00ff' });
		writeFileSync(exportPath, `${JSON.stringify(data, null, '\t')}\n`);

		const result = buildSiteAfdThemes({ root, check: false });
		assert.equal(result.ok, false);
		assert.match(result.errors.join('\n'), /light keeps the built-in color\.brand\.unthemed/);
		assert.equal(
			readFileSync(join(root, 'site/fast-af/afd-themes.json'), 'utf8'),
			beforeIndex,
			'failed build must not overwrite afd-themes.json'
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('buildSiteAfdThemes --check detects drifted committed output and ignores built date', () => {
	const root = copyFixtureRepo();
	try {
		// Changing only the built date is a no-op control: check must still pass.
		const themePath = join(root, 'site/fast-af/afd-theme.json');
		const committed = JSON.parse(readFileSync(themePath, 'utf8'));
		committed.built = '2026-01-01';
		writeFileSync(themePath, `${JSON.stringify(committed, null, '\t')}\n`);

		const sameContent = buildSiteAfdThemes({ root, check: true, today: '2026-12-31' });
		assert.equal(sameContent.ok, true, sameContent.errors.join('\n'));

		// Changing a token value must fail --check and name the stale file.
		committed.set.presets.light[0].value = '#000000';
		writeFileSync(themePath, `${JSON.stringify(committed, null, '\t')}\n`);

		const drifted = buildSiteAfdThemes({ root, check: true });
		assert.equal(drifted.ok, false);
		assert.match(drifted.errors.join('\n'), /site\/fast-af\/afd-theme\.json is out of date/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('buildSiteAfdThemes --check rejects orphaned outputs and write mode preserves built date', () => {
	const root = copyFixtureRepo();
	try {
		// Write mode preserves the existing built date when generated content is unchanged.
		const themePath = join(root, 'site/fast-af/afd-theme.json');
		const committed = JSON.parse(readFileSync(themePath, 'utf8'));
		committed.built = '2026-01-01';
		writeFileSync(themePath, `${JSON.stringify(committed, null, '\t')}\n`);

		const rewritten = buildSiteAfdThemes({ root, check: false, today: '2026-12-31' });
		assert.equal(rewritten.ok, true, rewritten.errors.join('\n'));
		assert.equal(JSON.parse(readFileSync(themePath, 'utf8')).built, '2026-01-01');

		// An orphaned afd-theme.*.json with no candidate in site/fast-af/themes/ fails --check.
		writeFileSync(join(root, 'site/fast-af/afd-theme.stale.json'), '{}\n');
		const orphaned = buildSiteAfdThemes({ root, check: true });
		assert.equal(orphaned.ok, false);
		assert.match(
			orphaned.errors.join('\n'),
			/site\/fast-af\/afd-theme\.stale\.json has no matching candidate/
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
