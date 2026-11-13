import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-file-size.mjs');

function fixture(lines, head = '') {
	return `${head}${Array.from({ length: lines }, (_, index) => `export const value${index} = ${index};`).join('\n')}\n`;
}

test('no-argument mode discovers and rejects oversized source files', () => {
	const root = mkdtempSync(join(tmpdir(), 'afd-file-size-'));
	mkdirSync(join(root, 'packages', 'demo', 'src'), { recursive: true });
	writeFileSync(join(root, 'packages', 'demo', 'src', 'large.ts'), fixture(1501));

	const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /large\.ts/);
	assert.match(result.stderr, /exceeds 1500 lines/);
	assert.match(result.stderr, /1 file size violation/);
});

test('a file up to 1,500 lines only warns: the bloat sweep, not the commit, splits it', () => {
	const root = mkdtempSync(join(tmpdir(), 'afd-file-size-'));
	const source = join(root, 'packages', 'demo', 'src');
	mkdirSync(source, { recursive: true });
	writeFileSync(join(source, 'busy.ts'), fixture(1499));

	const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stderr, /busy\.ts/);
	assert.match(result.stderr, /the sweep-bloat skill ranks it/);
});

test('discovery skips tests and generated output, and an override comment changes nothing', () => {
	const root = mkdtempSync(join(tmpdir(), 'afd-file-size-'));
	const source = join(root, 'packages', 'demo', 'src');
	mkdirSync(join(source, '_generated'), { recursive: true });
	writeFileSync(join(source, 'large.test.ts'), fixture(1600));
	writeFileSync(join(source, '_generated', 'types.ts'), fixture(1600));
	writeFileSync(join(source, 'old.ts'), fixture(1600, '// afd-override: max-lines=1700\n'));

	const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /old\.ts/);
	assert.doesNotMatch(result.stderr, /large\.test\.ts|types\.ts/);
	assert.match(result.stderr, /1 file size violation/);
});

test('a file between the thresholds warns without failing', () => {
	const root = mkdtempSync(join(tmpdir(), 'afd-file-size-'));
	const source = join(root, 'packages', 'demo', 'src');
	mkdirSync(source, { recursive: true });
	writeFileSync(join(source, 'growing.ts'), fixture(600));

	const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stderr, /growing\.ts/);
	assert.match(result.stderr, /Over the 500-line review threshold/);
	assert.match(result.stderr, /1 file size warning/);
});

test('explicit staged-file mode still checks only supplied paths', () => {
	const root = mkdtempSync(join(tmpdir(), 'afd-file-size-'));
	const source = join(root, 'packages', 'demo', 'src');
	mkdirSync(source, { recursive: true });
	writeFileSync(join(source, 'large.ts'), fixture(1501));
	writeFileSync(join(source, 'small.ts'), fixture(20));

	const result = spawnSync(process.execPath, [script, join(source, 'small.ts')], {
		cwd: root,
		encoding: 'utf8',
	});
	assert.equal(result.status, 0);
	assert.doesNotMatch(result.stderr, /large\.ts/);
});

test('staged imported FAST-AF and Violet source is skipped while other staged source is checked', () => {
	const root = mkdtempSync(join(tmpdir(), 'afd-file-size-'));
	const imported = join('foundations', 'fast-af', 'packages', 'demo', 'src', 'large.ts');
	const violet = [
		join('foundations', 'violet', 'packages', 'core', 'src', 'large.ts'),
		join('integrations', 'violet-afd', 'src', 'large.ts'),
		join('endpoints', 'violet-cli', 'src', 'large.ts'),
		join('endpoints', 'violet-server', 'src', 'large.ts'),
	];
	const owned = join('foundations', 'specimen', 'src', 'large.ts');
	for (const path of [imported, ...violet, owned]) {
		mkdirSync(join(root, dirname(path)), { recursive: true });
		writeFileSync(join(root, path), fixture(1501));
	}

	const skipped = spawnSync(process.execPath, [script, imported, ...violet], {
		cwd: root,
		encoding: 'utf8',
	});
	assert.equal(skipped.status, 0, skipped.stderr);
	const checked = spawnSync(process.execPath, [script, imported, ...violet, owned], {
		cwd: root,
		encoding: 'utf8',
	});
	assert.equal(checked.status, 1);
	assert.match(checked.stderr, /1 file size violation/);
});
