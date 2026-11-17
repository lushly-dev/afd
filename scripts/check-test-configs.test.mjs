import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findings } from './check-test-configs.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-test-configs.mjs');
const roots = [];
after(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A git repository holding `files`, none of them committed. */
function fixture(files) {
	const root = mkdtempSync(join(tmpdir(), 'test-configs-'));
	roots.push(root);
	execFileSync('git', ['init', '-q'], { cwd: root });
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	}
	return root;
}

function run(root) {
	return spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' });
}

const config = (body) => `export default defineConfig({\n\ttest: {\n${body}\n\t},\n});\n`;

test('passes when no config allows an empty run', () => {
	const result = run(
		fixture({
			'packages/a/vitest.config.ts': config("\t\tinclude: ['src/**/*.test.ts'],"),
			'packages/a/package.json': '{"scripts":{"test":"vitest run"}}',
		})
	);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /passed \(2 configs and launchers\)/);
});

test('fails on the option in a config, naming the file and line', () => {
	const result = run(
		fixture({ 'endpoints/x/packages/web/vitest.config.ts': config('\t\tpassWithNoTests: true,') })
	);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /endpoints\/x\/packages\/web\/vitest\.config\.ts:3: passWithNoTests/);
});

test('fails on the CLI flag in a test script', () => {
	const result = run(
		fixture({ 'packages/a/package.json': '{"scripts":{"test":"vitest run --passWithNoTests"}}' })
	);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /package\.json:1: --passWithNoTests/);
});

test('fails on the CLI flag where a workflow starts a runner', () => {
	const result = run(
		fixture({
			'.github/workflows/web.yml': 'steps:\n  - run: pnpm exec vitest run --passWithNoTests\n',
		})
	);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /\.github\/workflows\/web\.yml:2: --passWithNoTests/);
});

test('ignores files git ignores', () => {
	const result = run(
		fixture({
			'.gitignore': 'node_modules/\n',
			'node_modules/dep/vitest.config.ts': config('\t\tpassWithNoTests: true,'),
		})
	);
	assert.equal(result.status, 0, result.stderr);
});

test('reads the option in every config form, and allows only a literal false', () => {
	for (const file of [
		'vitest.config.mts',
		'vite.config.js',
		'vitest.browser.config.ts',
		'vitest.workspace.ts',
		'vitest.config.e2e.ts',
	]) {
		assert.equal(findings(file, 'passWithNoTests: true').length, 1, file);
	}
	assert.equal(findings('vitest.config.ts', "'passWithNoTests': true,").length, 1);
	assert.equal(findings('vitest.config.ts', '"passWithNoTests":true').length, 1);
	assert.equal(findings('vitest.config.ts', 'test: { passWithNoTests, include },').length, 1);
	assert.equal(findings('vitest.config.ts', 'test: { include, passWithNoTests }').length, 1);
	assert.equal(findings('vitest.config.ts', 'passWithNoTests: !0').length, 1);
	assert.equal(findings('vitest.config.ts', 'passWithNoTests: allowEmpty,').length, 1);
	assert.equal(findings('vitest.config.ts', 'passWithNoTests: false,').length, 0);
	assert.equal(findings('vitest.config.ts', 'vitest run --pass-with-no-tests').length, 1);
	assert.equal(findings('src/notes.ts', 'passWithNoTests: true').length, 0);
});
