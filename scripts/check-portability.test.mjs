import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(rootDir, 'scripts', 'check-portability.mjs');
const lefthookPath = join(rootDir, 'lefthook.yml');

const temps = [];
after(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function makeFixture(files) {
	const dir = mkdtempSync(join(tmpdir(), 'afd-portability-'));
	temps.push(dir);
	for (const [rel, content] of Object.entries(files)) {
		const target = join(dir, rel);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content, 'utf8');
	}
	return dir;
}

function runCheck(cwd, args = []) {
	return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
}

/** Build a spawn call string without embedding a raw shim launch literal in this test file. */
const launch = (fn, cmd, rest) => `${fn}('${cmd}', ${rest})`;

/** Extract `pre-commit -> commands -> portability -> glob` from lefthook.yml. */
function readPreCommitPortabilityGlob() {
	const lines = readFileSync(lefthookPath, 'utf8').split(/\r?\n/);
	let section = '';
	let command = '';
	for (const line of lines) {
		if (/^\S/.test(line) && !line.startsWith('#')) {
			section = line.replace(/:.*$/, '').trim();
			command = '';
			continue;
		}
		if (section !== 'pre-commit') continue;
		const cmdMatch = line.match(/^ {4}([a-z0-9-]+):/);
		if (cmdMatch) {
			command = cmdMatch[1];
			continue;
		}
		if (command === 'portability') {
			const globMatch = line.match(/^ {6}glob:\s*["']?([^"'\r\n]+)["']?/);
			if (globMatch) return globMatch[1].trim();
		}
	}
	assert.fail('pre-commit.commands.portability.glob not found in lefthook.yml');
}

/** Match a `*.{a,b,c}` lefthook extension glob against a filename. */
function matchesExtensionGlob(glob, filename) {
	const m = glob.match(/^\*\.\{([^}]+)\}$/);
	assert.ok(m, `unexpected glob format: ${glob}`);
	const exts = new Set(m[1].split(',').map((ext) => `.${ext.trim()}`));
	return [...exts].some((ext) => filename.endsWith(ext));
}

test('passes a clean fixture with no portability errors (no-op control)', () => {
	const dir = makeFixture({
		'scripts/clean.mjs':
			"import { execFileSync } from 'node:child_process';\nexecFileSync('git', ['status']);\n",
		'endpoints/app/src/ok.ts': 'export const ok = true;\n',
		'foundations/lib/scripts/ok.mjs': `${launch('spawn', 'pnpm', "['--version'], { shell: process.platform === 'win32' }")};\n`,
	});
	const result = runCheck(dir);
	assert.equal(result.status, 0, result.stderr);
});

test('flags bare shim spawns with no shell and with explicit shell: false', () => {
	const dir = makeFixture({
		'scripts/no-shell.mjs': `${launch('execFileSync', 'npx', "['vitest', 'run']")};\n`,
		'scripts/shell-false.mjs': `${launch('spawnSync', 'pnpm', "['--version'], { stdio: 'inherit', shell: false }")};\n`,
		'scripts/shell-falsy-and-chained.mjs': [
			`const out = ${launch('execFileSync', 'npm', "['--version'], { shell: undefined }")}.toString();`,
			`${launch('spawnSync', 'yarn', "['--version'], { shell: true }")};`,
		].join('\n'),
		'scripts/shell-in-string-and-comment.mjs': [
			`${launch('execFileSync', 'pnpm', "['--note', 'shell: true']")};`,
			`${launch('spawnSync', 'npx', "['tsc'], { /* shell: true */ stdio: 'inherit' }")};`,
		].join('\n'),
		'scripts/shell-other-falsy.mjs': [
			`${launch('spawnSync', 'pnpm', "['a'], { shell: null }")};`,
			`${launch('spawnSync', 'pnpm', "['b'], { shell: 0 }")};`,
			`${launch('spawnSync', 'pnpm', "['c'], { shell: '' }")};`,
			`${launch('spawnSync', 'pnpm', "['d'], { shell: !1 }")};`,
			`${launch('spawnSync', 'pnpm', "['e'], { shell: (false) }")};`,
			`${launch('spawnSync', 'pnpm', "['f'], { shell: ((undefined)) }")};`,
			`${launch('spawnSync', 'pnpm', "['g'], { shell: !true }")};`,
		].join('\n'),
		'scripts/shell-nested-object.mjs': [
			`${launch('spawnSync', 'pnpm', "['a'], { env: { ...process.env, shell: '/bin/sh' } }")};`,
			`${launch('spawnSync', 'pnpm', "['b'], { shell: false, env: { shell: '1' } }")};`,
		].join('\n'),
		'scripts/shell-ok.mjs': [
			`${launch('execFileSync', 'pnpm', "['--version'], { shell: process.platform === 'win32' }")};`,
			`${launch('execFileSync', 'pnpm', "['--version'], { shell: (process.platform === 'win32') }")};`,
			`${launch('spawn', 'npx', "['biome'], { shell: true }")};`,
			`${launch('spawnSync', 'pnpm', "['--version'], { shell: true, env: { shell: false } }")};`,
			`${launch('spawnSync', 'npm', "['--version'], { shell: 'cmd.exe' }")};`,
			'// portability-ok: intentional test fixture',
			`${launch('execFileSync', 'pnpm', "['--version'], { shell: false }")};`,
		].join('\n'),
	});

	for (const [bad, expectedCount] of [
		['scripts/no-shell.mjs', 1],
		['scripts/shell-false.mjs', 1],
		['scripts/shell-falsy-and-chained.mjs', 1],
		['scripts/shell-in-string-and-comment.mjs', 2],
		['scripts/shell-other-falsy.mjs', 7],
		['scripts/shell-nested-object.mjs', 2],
	]) {
		const res = runCheck(dir, [bad]);
		assert.equal(res.status, 1, `expected ${bad} to fail`);
		assert.match(res.stderr, /Package manager started without a shell/, `${bad}: ${res.stderr}`);
		assert.match(
			res.stderr,
			new RegExp(`${expectedCount} portability error\\(s\\)`),
			`${bad}: ${res.stderr}`
		);
	}

	const ok = runCheck(dir, ['scripts/shell-ok.mjs']);
	assert.equal(ok.status, 0, ok.stderr);
});

test('default scan includes endpoints/, foundations/, and integrations/ and skips target/', () => {
	const winPath = ['C:', 'Users', 'dev', 'repo'].join('\\\\');
	const dir = makeFixture({
		'endpoints/demo/scripts/run.mjs': `${launch('execFileSync', 'pnpm', "['build']")};\n`,
		'foundations/fast-af/packages/demo/scripts/run.mjs': `${launch('spawnSync', 'npx', "['tsc']")};\n`,
		'integrations/demo/scripts/run.mjs': `${launch('spawn', 'npm', "['test'], { shell: false }")};\n`,
		'foundations/specimen/host/target/debug/out.json': `{"path":"${winPath}"}\n`,
	});

	const result = runCheck(dir);
	assert.equal(
		result.status,
		1,
		'expected violations in endpoints/, foundations/, integrations/ to fail'
	);
	assert.match(result.stderr, /endpoints[\\/]demo[\\/]scripts[\\/]run\.mjs/);
	assert.match(
		result.stderr,
		/foundations[\\/]fast-af[\\/]packages[\\/]demo[\\/]scripts[\\/]run\.mjs/
	);
	assert.match(result.stderr, /integrations[\\/]demo[\\/]scripts[\\/]run\.mjs/);
	assert.doesNotMatch(result.stderr, /target[\\/]debug[\\/]out\.json/);
	assert.match(result.stderr, /3 portability error\(s\)/);
});

test('pre-commit portability glob in lefthook.yml covers .mjs, .cjs, and .tsx scripts', () => {
	const glob = readPreCommitPortabilityGlob();
	for (const sample of [
		'scripts/tool.mjs',
		'scripts/tool.cjs',
		'packages/web/App.tsx',
		'packages/core/index.ts',
		'scripts/run.js',
		'package.json',
		'README.md',
		'lefthook.yml',
		'config.yaml',
	]) {
		assert.ok(
			matchesExtensionGlob(glob, sample),
			`lefthook.yml pre-commit portability glob "${glob}" does not match ${sample}`
		);
	}
});

// The converged script (#2834): one source for AFD and Lushly, each repository's scope in a config.

const backslash = String.fromCharCode(92);
const winHome = ['C:', 'Users', 'dev', 'repo'].join(backslash);

test('a config scopes the scan: include, exclude and skipped segments', () => {
	const dir = makeFixture({
		'scripts/policy/portability.json': JSON.stringify({
			include: ['src/', 'README.md'],
			exclude: ['src/vendor/'],
			skipSegments: ['generated'],
		}),
		'src/a.ts': `export const a = '${winHome}';\n`,
		'src/vendor/b.ts': `export const b = '${winHome}';\n`,
		'src/generated/c.ts': `export const c = '${winHome}';\n`,
		'other/d.ts': `export const d = '${winHome}';\n`,
	});
	const result = runCheck(dir);
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /src\/a\.ts:1 {2}Windows user-home absolute path detected/);
	assert.doesNotMatch(result.stderr, /vendor|generated|other\//);
	// The drive-path and user-home patterns both match it.
	assert.match(result.stderr, /2 portability error\(s\) across 1 file\(s\)/);
	// Explicit files take the same filters, so a hook's staged files outside the scope pass.
	assert.equal(runCheck(dir, ['other/d.ts', 'src/vendor/b.ts']).status, 0);
});

test('Markdown is skipped by default and checked with markdown: "scan"', () => {
	const files = { 'docs/setup.md': `* Clone into ${winHome}\n` };
	assert.equal(runCheck(makeFixture(files), ['docs/setup.md']).status, 0);
	const scanned = makeFixture({
		...files,
		'scripts/policy/portability.json': JSON.stringify({ markdown: 'scan' }),
	});
	const result = runCheck(scanned, ['docs/setup.md']);
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /docs\/setup\.md:1/);
});

test('comment lines are skipped by default and checked with comments: "scan"', () => {
	const files = {
		'src/a.ts': `// cloned into ${winHome}
export const a = 1;
`,
	};
	assert.equal(runCheck(makeFixture(files), ['src/a.ts']).status, 0);
	const scanned = makeFixture({
		...files,
		'scripts/policy/portability.json': JSON.stringify({ comments: 'scan' }),
	});
	const result = runCheck(scanned, ['src/a.ts']);
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /src\/a\.ts:1 {2}Windows/);
});

test('names the configured spawn suggestion, and a --config path wins over the default', () => {
	const dir = makeFixture({
		'tools/run.mjs': `${launch('execFileSync', 'pnpm', "['build']")};\n`,
		'portability.json': JSON.stringify({ spawnSuggestion: 'Use the house helper.' }),
	});
	const result = runCheck(dir, ['--config', 'portability.json', 'tools/run.mjs']);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Use the house helper\./);
});

test('refuses a full scan that finds no file, but not a hook call whose files are all skipped', () => {
	const dir = makeFixture({ 'notes.txt': `${winHome}\n` });
	const result = runCheck(dir);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /refusing a vacuous pass/);
	assert.equal(runCheck(dir, ['notes.txt']).status, 0);
});

test('lists files from git, so an ignored file is never scanned', () => {
	const dir = makeFixture({
		'.gitignore': 'build/\n',
		'build/out.json': JSON.stringify({ path: winHome }),
		'src/ok.ts': 'export const ok = true;\n',
	});
	spawnSync('git', ['init', '-q'], { cwd: dir });
	const result = runCheck(dir);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /across 1 file\(s\)/);
});

test('refuses an unknown config key or a bad value with exit 2', () => {
	for (const config of [
		{ includes: [] },
		{ markdown: 'yes' },
		{ comments: 'no' },
		{ include: 'src/' },
	]) {
		const dir = makeFixture({ 'portability.json': JSON.stringify(config), 'a.ts': '' });
		const result = runCheck(dir, ['--config', 'portability.json']);
		assert.equal(result.status, 2, JSON.stringify(config));
	}
});

test('a copy of the script, such as the seeded skill mirror, is never scanned as a violation', () => {
	const dir = makeFixture({
		'skills/gate-discipline/scripts/check-portability.mjs': readFileSync(script, 'utf8'),
		'src/ok.ts': 'export const ok = true;\n',
	});
	assert.equal(runCheck(dir).status, 0);
});
