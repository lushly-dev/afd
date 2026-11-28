/** The gate-discipline scripts, canonical in scripts/ and mirrored into Botcore's seeded skill. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findings, relativeImports } from './check-test-configs.mjs';
import { globToRegExp, parseVitestConfig } from './check-test-discovery.mjs';
import { findSuppressions, maskSource } from './check-test-quarantine.mjs';
import { compareTestFile, LANGUAGES } from './report-test-changes.mjs';

const scripts = dirname(fileURLToPath(import.meta.url));
const GATE_SCRIPTS = [
	'check-portability.mjs',
	'check-test-configs.mjs',
	'check-test-discovery.mjs',
	'check-test-quarantine.mjs',
	'discovery-parsers.mjs',
	'report-test-changes.mjs',
];
const roots = [];
after(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A git repository holding `files`, none of them committed. */
function fixture(files) {
	const root = mkdtempSync(join(tmpdir(), 'gate-discipline-'));
	roots.push(root);
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
	);
	execFileSync('git', ['init', '-q'], { cwd: root, env });
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	}
	return root;
}

function run(script, root, ...args) {
	return spawnSync(process.execPath, [join(scripts, script), '--root', root, ...args], {
		encoding: 'utf8',
	});
}

// check-test-configs.mjs

const config = (body) => `export default defineConfig({\n\ttest: {\n${body}\n\t},\n});\n`;

test('test configs: passes when no config allows an empty run', () => {
	const result = run(
		'check-test-configs.mjs',
		fixture({
			'packages/a/vitest.config.ts': config("\t\tinclude: ['src/**/*.test.ts'],"),
			'packages/a/package.json': '{"scripts":{"test":"vitest run"}}',
		})
	);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /passed \(2 configs and launchers\)/);
});

test('test configs: fails on the option in a config, naming the file and line', () => {
	const result = run(
		'check-test-configs.mjs',
		fixture({ 'endpoints/x/packages/web/vitest.config.ts': config('\t\tpassWithNoTests: true,') })
	);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /endpoints\/x\/packages\/web\/vitest\.config\.ts:3: passWithNoTests/);
});

test('test configs: fails on the CLI flag in a test script and a workflow', () => {
	const result = run(
		'check-test-configs.mjs',
		fixture({
			'packages/a/package.json': '{"scripts":{"test":"vitest run --passWithNoTests"}}',
			'.github/workflows/web.yml': 'steps:\n  - run: pnpm exec vitest run --passWithNoTests\n',
		})
	);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /package\.json:1: --passWithNoTests/);
	assert.match(result.stderr, /\.github\/workflows\/web\.yml:2: --passWithNoTests/);
});

test('test configs: reads the flag in a path the caller adds, and only there', () => {
	const files = { 'tools/run-suites.mjs': "spawn('vitest', ['run', '--passWithNoTests']);\n" };
	assert.equal(run('check-test-configs.mjs', fixture(files)).status, 0);
	const result = run('check-test-configs.mjs', fixture(files), 'tools/');
	assert.equal(result.status, 1);
	assert.match(result.stderr, /tools\/run-suites\.mjs:1: --passWithNoTests/);
	// Normalised as git prints paths, and a path that lists nothing fails rather than scanning less.
	assert.equal(run('check-test-configs.mjs', fixture(files), './tools').status, 1);
	const typo = run('check-test-configs.mjs', fixture(files), 'tool/');
	assert.equal(typo.status, 1);
	assert.match(typo.stderr, /tool: git lists no file there/);
});

test('all check scripts run their check when started through a symlinked folder', () => {
	const root = fixture({
		'scripts/policy/test-quarantine.json': register([]),
		'scripts/policy/test-discovery.json': JSON.stringify({ unrun: [] }),
		'src/a.test.ts': "it.only('a', () => {});\n",
		'vitest.config.ts': config("\t\tpassWithNoTests: true,\n\t\tinclude: ['other/**/*.test.ts'],"),
		'src/home.ts': `export const home = '${['C:', 'Users', 'dev'].join(String.fromCharCode(92))}';\n`,
	});
	const copy = join(root, 'skill-scripts');
	mkdirSync(copy, { recursive: true });
	for (const file of GATE_SCRIPTS) cpSync(join(scripts, file), join(copy, file));
	const link = join(root, 'linked-scripts');
	symlinkSync(copy, link, 'junction');
	for (const script of [
		'check-portability.mjs',
		'check-test-quarantine.mjs',
		'check-test-configs.mjs',
		'check-test-discovery.mjs',
	]) {
		const result = spawnSync(process.execPath, [join(link, script), '--root', root], {
			encoding: 'utf8',
		});
		assert.equal(result.status, 1, `${script} passed through the link: ${result.stdout}`);
	}
});

test('test configs: ignores files git ignores', () => {
	const result = run(
		'check-test-configs.mjs',
		fixture({
			'.gitignore': 'node_modules/\n',
			'node_modules/dep/vitest.config.ts': config('\t\tpassWithNoTests: true,'),
		})
	);
	assert.equal(result.status, 0, result.stderr);
});

test('test configs: reads the option in every config form, and allows only a literal false', () => {
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
	// lushly-dev/afd#2942: an expression that starts with `false`, and a computed key.
	assert.equal(findings('vitest.config.ts', 'passWithNoTests: false === Boolean(ci),').length, 1);
	assert.equal(findings('vitest.config.ts', 'passWithNoTests: false || allowEmpty,').length, 1);
	assert.equal(findings('vitest.config.ts', "['passWithNoTests']: true,").length, 1);
	assert.equal(findings('vitest.config.ts', '[`passWithNoTests`]: true,').length, 1);
	assert.equal(findings('vitest.config.ts', "['passWithNoTests']: false,").length, 0);
	assert.equal(findings('vitest.config.ts', 'test: { passWithNoTests: false }').length, 0);
	assert.equal(findings('vitest.config.ts', 'passWithNoTests: false // never').length, 0);
	assert.equal(findings('vitest.config.ts', 'passWithNoTests: false').length, 0);
	assert.equal(findings('vitest.config.ts', 'passWithNoTests: false /* c */,').length, 0);
	assert.equal(findings('vitest.config.ts', 'passWithNoTests: false /* c */ || true,').length, 1);
	assert.equal(findings('vitest.config.ts', 'config.test.passWithNoTests = true;').length, 1);
	assert.equal(findings('vitest.config.ts', 'config.test.passWithNoTests = false;').length, 0);
	assert.equal(findings('vitest.config.ts', 'if (o.passWithNoTests === true) {}').length, 0);
	assert.equal(findings('vitest.config.ts', 'o.passWithNoTests ||= true;').length, 1);
	assert.equal(findings('vitest.config.ts', 'o.passWithNoTests ??= true;').length, 1);
	assert.equal(findings('vitest.config.ts', 'opts.map(passWithNoTests => 1);').length, 0);
	// A root Vitest module that is not a config by name, such as a shared factory.
	assert.equal(findings('vitest.package-config.ts', 'passWithNoTests: true').length, 1);
	assert.equal(findings('packages/a/vitest.shared.ts', 'passWithNoTests: true').length, 0);
});

// lushly-dev/afd#2942: a shared factory every package config calls sets the option for all.
const factory = (value) =>
	`export function createPackageVitestConfig() {\n\treturn defineConfig({\n\t\ttest: { passWithNoTests: ${value} },\n\t});\n}\n`;
const packageConfig = (specifier) =>
	`import { createPackageVitestConfig } from '${specifier}';\nexport default createPackageVitestConfig();\n`;

test('test configs: reads the option in a shared module a config imports, naming its line', () => {
	const root = (value) =>
		fixture({
			'vitest.package-config.ts': factory(value),
			'packages/a/vitest.config.ts': packageConfig('../../vitest.package-config'),
		});
	const result = run('check-test-configs.mjs', root('true'));
	assert.equal(result.status, 1, result.stdout);
	assert.match(result.stderr, /vitest\.package-config\.ts:3: passWithNoTests/);
	assert.equal(run('check-test-configs.mjs', root('false')).status, 0);

	// Not a root Vitest module by name: found only by following the configs' imports, through
	// a `.js` specifier for a TypeScript file, an index module and a helper the factory imports.
	const nested = (value) =>
		fixture({
			'tools/test/shared.ts': `import { base } from './base/index.js';\nexport { base };\n`,
			'tools/test/base/index.ts': "export * from '../options';\n",
			'tools/test/options.ts': `export const options = { passWithNoTests: ${value} };\n`,
			'packages/a/vitest.config.ts': packageConfig('../../tools/test/shared.js'),
			'src/unrelated.ts': 'export const options = { passWithNoTests: true };\n',
		});
	const deep = run('check-test-configs.mjs', nested('true'));
	assert.equal(deep.status, 1, deep.stdout);
	assert.match(deep.stderr, /tools\/test\/options\.ts:1: passWithNoTests/);
	assert.doesNotMatch(deep.stderr, /src\/unrelated\.ts/);
	assert.equal(run('check-test-configs.mjs', nested('false')).status, 0);
	// An added path that a config imports is still followed, not only read.
	const viaAdded = run('check-test-configs.mjs', nested('true'), 'tools/test/shared.ts');
	assert.equal(viaAdded.status, 1, viaAdded.stdout);
	assert.match(viaAdded.stderr, /tools\/test\/options\.ts:1: passWithNoTests/);
});

test('test configs: resolves a directory import, survives a cycle and stays inside the root', () => {
	const listed = new Set(['tools/base/index.ts', 'tools/x.mts', 'tools/x.ts', 'a.ts']);
	assert.deepEqual(relativeImports('tools/s.ts', "import './base/';", listed), [
		'tools/base/index.ts',
	]);
	assert.deepEqual(relativeImports('tools/s.ts', "import './base';", listed), [
		'tools/base/index.ts',
	]);
	assert.deepEqual(relativeImports('tools/s.ts', "import './x.mjs';", listed), ['tools/x.mts']);
	assert.deepEqual(relativeImports('vitest.config.ts', "import './';", new Set(['index.ts'])), [
		'index.ts',
	]);
	assert.deepEqual(relativeImports('vitest.config.ts', "import '../a';", listed), []);
	assert.deepEqual(relativeImports('vitest.config.ts', "import '../foo/..';", listed), []);
	const cycle = fixture({
		'vitest.config.ts': "import './tools/a';\nexport default {};\n",
		'tools/a.ts': "import './b';\n",
		'tools/b.ts': "import './a';\nexport const o = { passWithNoTests: true };\n",
	});
	const result = run('check-test-configs.mjs', cycle);
	assert.equal(result.status, 1, result.stdout);
	assert.match(result.stderr, /tools\/b\.ts:2: passWithNoTests/);
});

test('test configs: reads the option, as well as the flag, in a path the caller adds', () => {
	const files = { 'config/test-options.ts': factory('true') };
	assert.equal(run('check-test-configs.mjs', fixture(files)).status, 0);
	const result = run('check-test-configs.mjs', fixture(files), 'config/');
	assert.equal(result.status, 1, result.stdout);
	assert.match(result.stderr, /config\/test-options\.ts:3: passWithNoTests/);
});

// check-test-quarantine.mjs

const register = (entries) => JSON.stringify({ quarantined: entries });
const ENTRY = {
	file: 'src/a.test.ts',
	owner: 'maintainer',
	reason: 'Waits on the upstream parser fix before it can pass',
	issue: '#1',
};
const kinds = (text) => findSuppressions(text).map(({ line, kind }) => `${line}:${kind}`);

test('quarantine: finds .only and unconditional skips, and allows conditional ones', () => {
	assert.deepEqual(kinds("it.only('a', () => {});"), ['1:only']);
	assert.deepEqual(kinds("describe.only.each([1])('a %s', () => {});"), ['1:only']);
	assert.deepEqual(kinds("test.describe.only('a', () => {});"), ['1:only']);
	assert.deepEqual(kinds("it.skip('a', () => {});"), ['1:skip']);
	assert.deepEqual(kinds('it.skip(`case ${n}`, async () => {});'), ['1:skip']);
	assert.deepEqual(kinds('it.skip(title, () => {});'), ['1:skip']);
	assert.deepEqual(kinds('it.skip(title, async function () {});'), ['1:skip']);
	assert.deepEqual(kinds("describe.skip.each([1])('a %s', () => {});"), ['1:skip']);
	assert.deepEqual(kinds("it.todo('later');"), ['1:todo']);
	// Playwright: `test.skip()` skips the running test whatever happens.
	assert.deepEqual(kinds('test("a", () => {\n\ttest.skip();\n});'), ['2:skip']);
	assert.deepEqual(kinds("it\n\t.skip('a', () => {});"), ['2:skip']);
	// Playwright's fixme skips as surely as skip does.
	assert.deepEqual(kinds("test.fixme('a', async () => {});"), ['1:fixme']);
	assert.deepEqual(kinds("test.describe.fixme('a', () => {});"), ['1:fixme']);
	assert.deepEqual(kinds('test("a", () => {\n\ttest.fixme();\n});'), ['2:fixme']);
	// A condition that always holds is no condition; type arguments still make a call.
	assert.deepEqual(kinds("test.skip(true, 'flaky');"), ['1:skip']);
	assert.deepEqual(kinds('test.skip(true);'), ['1:skip']);
	assert.deepEqual(kinds('test.skip(!0, "x");'), ['1:skip']);
	assert.deepEqual(kinds("test.skip<Fixtures>('a', async () => {});"), ['1:skip']);
	assert.deepEqual(kinds("test.skip((true), 'x');"), ['1:skip']);
	assert.deepEqual(kinds("it.skipIf(true)('a', () => {});"), ['1:skip']);
	assert.deepEqual(kinds("describe.runIf(false)('a', () => {});"), ['1:skip']);
	assert.deepEqual(kinds("it.runIf(true)('a', () => {});"), []);

	assert.deepEqual(kinds("it.skipIf(process.platform === 'win32')('a', () => {});"), []);
	assert.deepEqual(kinds("describe.runIf(url)('a', () => {});"), []);
	assert.deepEqual(kinds('test.skip(!supported, "Not supported here");'), []);
	assert.deepEqual(kinds('test.skip(\n\t!!process.env.CI,\n\t"Local only",\n);'), []);
	assert.deepEqual(kinds('test.skip(({ browserName }) => browserName === "webkit");'), []);
	assert.deepEqual(kinds('const d = url ? describe : describe.skip;'), []);
	assert.deepEqual(kinds('suite.skipped = true; await test.step("a", fn);'), []);
	assert.deepEqual(kinds('foo.it.only(); myit.only();'), []);
});

// The chain cases below are adapted from Lushly's scripts/check-test-quarantine-chains.test.mjs
// (MIT, lushly-dev/lushly#3105), as lushly-dev/afd#1387's decisions allow (lushly-dev/afd#2927).
test('quarantine: reads a chain on past a condition, so a later .only or .skip still counts', () => {
	assert.deepEqual(kinds("it.runIf(key).only('focused', () => {});"), ['1:only']);
	assert.deepEqual(kinds("test.runIf(key).only.each([1])('focused conditional run', () => {});"), [
		'1:only',
	]);
	assert.deepEqual(
		kinds("it.skipIf(!key).concurrent.skip('unconditional skip after condition', () => {});"),
		['1:skip']
	);
	assert.deepEqual(kinds("describe.skipIf(f(a, [b]))\n\t.todo('later');"), ['2:todo']);
	assert.deepEqual(kinds("it.skipIf(a).runIf(b).only('x', () => {});"), ['1:only']);
	assert.deepEqual(kinds("it.runIf(key)?.only('a', () => {});"), ['1:only']);
	assert.deepEqual(kinds("test.skipIf(!key).each([1])('conditional skip', () => {});"), []);
	assert.deepEqual(kinds("test.runIf(key).each([1])('conditional run', () => {});"), []);
	assert.deepEqual(kinds("it.skipIf(!key).concurrent('conditional', () => {});"), []);
	// Not a chain: a parameterizer's call ends it, and `.only` after it is not Vitest's.
	assert.deepEqual(kinds("it.each([1]).only('unsupported terminal order', () => {});"), []);
});

test('quarantine: finds suppressions anywhere in concurrent and parameterized chains', () => {
	const text = [
		"it.only.each([1, 2])('focused %s', () => {});",
		"describe.only.each([1, 2])('focused suite %s', () => {});",
		"test.skip.each([1, 2])('skipped %s', () => {});",
		"it.concurrent.skip('skipped concurrent test', () => {});",
		"test.skip.concurrent('skipped concurrent test', () => {});",
		"describe.concurrent.todo('todo concurrent suite', () => {});",
		"test.fails.skip.each([1])('skipped expected failure', () => {});",
		"it.only.each`value`('focused tagged case', () => {});",
		"test.skip.for([1])('skipped %s', () => {});",
		"describe.shuffle.skip.each([1])('skipped shuffled suite %s', () => {});",
		'const fixture = <div data-test="test.skip" />;',
		"helpers.test.skip('not a Vitest root', () => {});",
	].join('\n');
	assert.deepEqual(findSuppressions(text), [
		{ line: 1, kind: 'only' },
		{ line: 2, kind: 'only' },
		{ line: 3, kind: 'skip' },
		{ line: 4, kind: 'skip' },
		{ line: 5, kind: 'skip' },
		{ line: 6, kind: 'todo' },
		{ line: 7, kind: 'skip' },
		{ line: 8, kind: 'only' },
		{ line: 9, kind: 'skip' },
		{ line: 10, kind: 'skip' },
	]);
});

test('quarantine: never reads a comment, a string, a template or a regular expression as code', () => {
	assert.deepEqual(kinds("// it.only('a', fn)\n/* it.skip('b', fn) */"), []);
	assert.deepEqual(kinds("const s = \"it.only('a')\"; const t = 'test.skip()';"), []);
	assert.deepEqual(kinds('const t = `it.only(${"it.skip()"})`;'), []);
	assert.deepEqual(kinds("expect(src).toMatch(/it\\.only\\('/);\nit.only('real', fn);"), [
		'2:only',
	]);
	assert.deepEqual(kinds('const ratio = a / b; it.todo("x"); const c = d / e;'), ['1:todo']);
	// A regular expression after a keyword, and a division after a postfix operator.
	assert.deepEqual(kinds("function f(s) { return /x'/.test(s); } it.only('a', fn);"), ['1:only']);
	assert.deepEqual(kinds("const k = typeof /`/;\nit.only('a', fn);"), ['2:only']);
	assert.deepEqual(kinds("let n = a++ / b; it.only('a', fn);"), ['1:only']);
	// A property named like a keyword is an operand, and so is a non-ASCII identifier.
	assert.deepEqual(kinds("const n = x.in / 2; it.only('a', fn);"), ['1:only']);
	assert.deepEqual(kinds("const n = obj.return / 2; it.only('a', fn);"), ['1:only']);
	assert.deepEqual(kinds("const n = ñ / 2; it.only('a', fn);"), ['1:only']);
	const masked = maskSource('const a = "x"; // c\nit.only(`y`);');
	assert.equal(masked.length, 'const a = "x"; // c\nit.only(`y`);'.length);
	assert.equal(masked.split('\n')[1], 'it.only(` `);');
});

test('quarantine: passes a clean suite, and fails a .only and an unregistered skip by file and line', () => {
	const clean = fixture({
		'scripts/policy/test-quarantine.json': register([]),
		'src/a.test.ts': "it.skipIf(!url)('a', () => {});\n",
	});
	const passed = run('check-test-quarantine.mjs', clean);
	assert.equal(passed.status, 0, passed.stderr);
	assert.match(passed.stdout, /passed: 1 test files, 0 quarantined/);

	const failed = run(
		'check-test-quarantine.mjs',
		fixture({
			'scripts/policy/test-quarantine.json': register([]),
			'src/a.test.ts': "\nit.only('a', () => {});\n",
			'src/b.spec.mjs': "describe.skip('b', () => {});\n",
		})
	);
	assert.equal(failed.status, 1);
	assert.match(failed.stderr, /src\/a\.test\.ts:2 uses \.only/);
	assert.match(failed.stderr, /src\/b\.spec\.mjs:1 uses \.skip with no quarantine entry/);
});

test('quarantine: a registered skip passes, a recovered entry fails, and a malformed one fails', () => {
	const files = (skip) => ({
		'scripts/policy/test-quarantine.json': register([ENTRY]),
		'src/a.test.ts': skip ? "it.skip('a', () => {});\n" : "it('a', () => {});\n",
	});
	assert.equal(run('check-test-quarantine.mjs', fixture(files(true))).status, 0);

	const recovered = run('check-test-quarantine.mjs', fixture(files(false)));
	assert.equal(recovered.status, 1);
	assert.match(
		recovered.stderr,
		/src\/a\.test\.ts has no unconditional \.skip or \.todo left; it recovered/
	);

	const malformed = run(
		'check-test-quarantine.mjs',
		fixture({
			'scripts/policy/test-quarantine.json': register([{ ...ENTRY, reason: 'flaky' }]),
			'src/a.test.ts': "it('a', () => {});\n",
		})
	);
	assert.equal(malformed.status, 1);
	assert.match(malformed.stderr, /malformed entry/);

	const notText = run(
		'check-test-quarantine.mjs',
		fixture({
			'scripts/policy/test-quarantine.json': register([{ ...ENTRY, reason: { length: 30 } }]),
			'src/a.test.ts': "it.skip('a', () => {});\n",
		})
	);
	assert.equal(notText.status, 1);
	assert.match(notText.stderr, /malformed entry/);
});

test('quarantine: reads paths as git prints them, so a scoped run still reports a recovered entry', () => {
	const root = fixture({
		'scripts/policy/test-quarantine.json': register([ENTRY]),
		'src/a.test.ts': "it('a', () => {});\n",
	});
	for (const path of ['src', './src', 'src/', 'src\\']) {
		const result = run('check-test-quarantine.mjs', root, path);
		assert.equal(result.status, 1, path);
		assert.match(result.stderr, /it recovered/, path);
	}
});

test('quarantine: fails with no register, with no test file, and takes another register path', () => {
	const noRegister = run(
		'check-test-quarantine.mjs',
		fixture({ 'src/a.test.ts': "it('a', () => {});\n" })
	);
	assert.equal(noRegister.status, 1);
	assert.match(noRegister.stderr, /scripts\/policy\/test-quarantine\.json is missing/);

	const empty = run(
		'check-test-quarantine.mjs',
		fixture({ 'scripts/policy/test-quarantine.json': register([]), 'src/a.ts': '' })
	);
	assert.equal(empty.status, 1);
	assert.match(empty.stderr, /found no test file/);

	const elsewhere = run(
		'check-test-quarantine.mjs',
		fixture({ 'quarantine.json': register([ENTRY]), 'src/a.test.ts': "it.todo('a');\n" }),
		'--register',
		'quarantine.json'
	);
	assert.equal(elsewhere.status, 0, elsewhere.stderr);
});

// report-test-changes.mjs

const language = (name) => LANGUAGES.find((candidate) => candidate.name === name);
const findingKinds = (result) => result.findings.map((finding) => finding.kind);

test('test changes: counts JavaScript tests, assertions, skips and matchers in code only', () => {
	const js = language('JavaScript');
	const before = [
		"describe('s', () => {",
		"\tit('a', () => { expect(a).toBe(1); expect(b).toEqual({}); });",
		"\tit.each([1])('b', (n) => { assert.equal(n, 1); });",
		"\ttest('c', () => { expect(c).toStrictEqual([]); });",
		'});',
		"// it('commented', () => { expect(x).toBe(1); });",
		`const title = "it('in a string', () => expect(y))";`,
	].join('\n');
	assert.deepEqual(js.measure(before), {
		tests: 3,
		assertions: 4,
		skips: 0,
		unconditional: 0,
		exact: 3,
		loose: 0,
	});
	const after = [
		"describe('s', () => {",
		"\tit('a', () => { expect(a).toBeDefined(); });",
		"\tit.skip('b', () => {});",
		'});',
	].join('\n');
	const result = compareTestFile('a.test.ts', js, before, after);
	assert.deepEqual(findingKinds(result), [
		'fewer-tests',
		'fewer-assertions',
		'skip-added',
		'matchers-loosened',
	]);
	assert.match(result.findings[2].detail, /skips 0 → 1, 1 more unconditional/);
	assert.deepEqual(compareTestFile('a.test.ts', js, before, before).findings, []);
	// Asymmetric matchers are values inside an assertion, so tightening one loses nothing.
	assert.equal(
		js.measure('expect(a).toEqual(expect.objectContaining({ n: expect.any(Number) }));').assertions,
		1
	);
	assert.equal(js.measure('expect.soft(a).toBe(1); assert.ok(b); assert(c);').assertions, 3);
});

test('test changes: reports a changed assertion line, but not one only moved or re-wrapped', () => {
	const js = language('JavaScript');
	const before = "it('a', () => { expect(sum(2, 2)).toBe(4); });\n";
	const changed = "it('a', () => { expect(sum(2, 2)).toBe(5); });\n";
	const diff = (removed, added) => ({
		removed: [{ line: 1, text: removed.trim() }],
		added: [{ line: 1, text: added.trim() }],
	});
	const rewritten = compareTestFile('a.test.ts', js, before, changed, diff(before, changed));
	assert.deepEqual(findingKinds(rewritten), ['assertions-rewritten']);
	assert.match(rewritten.findings[0].lines[0].text, /toBe\(4\)/);
	const skipped = before.replace("it('a'", "it.skip('a'");
	assert.deepEqual(
		findingKinds(compareTestFile('a.test.ts', js, before, skipped, diff(before, skipped))),
		['skip-added']
	);
	const wrapped = "it('a', () => {\n\texpect(sum(2, 2)).toBe(4);\n});\n";
	const rewrap = {
		removed: [{ line: 1, text: before.trim() }],
		added: wrapped.split('\n').map((text, index) => ({ line: index + 1, text: text.trim() })),
	};
	assert.deepEqual(compareTestFile('a.test.ts', js, before, wrapped, rewrap).findings, []);
});

test('test changes: sees a whole file or suite skipped', () => {
	const js = language('JavaScript');
	for (const text of [
		"test.describe.skip('s', () => { test('a', () => {}); });",
		"test.describe.only('s', () => { test('a', () => {}); });",
		"describe.skip('s', () => { it('a', () => {}); });",
	])
		assert.equal(js.measure(text).skips, 1, text);
	const python = language('Python');
	for (const text of [
		'pytestmark = pytest.mark.skip(reason="later")\n',
		'pytestmark = [pytest.mark.skipif(sys.platform == "win32", reason="r")]\n',
		'class T(TestCase):\n    def setUp(self):\n        self.skipTest("later")\n',
		'@skip("later")\ndef test_a():\n    pass\n',
		'raise unittest.SkipTest("later")\n',
		'yaml = pytest.importorskip("yaml")\n',
	])
		assert.equal(python.measure(text).skips, 1, text);
	assert.equal(
		language('Rust').measure('#[cfg_attr(windows, ignore)]\n#[test]\nfn a() {}\n').skips,
		1
	);
	assert.equal(language('C++').measure('TEST_CASE("a", "[.slow]") { CHECK(x); }\n').skips, 1);
});

test('test changes: a bare skipIf is an alias, not a test, and a called one is both', () => {
	const js = language('JavaScript');
	const measured = [
		"const linux = it.skipIf(win);\nlinux('a', () => {});",
		"it.skipIf(win)('a', () => {});",
	].map((text) => {
		const { tests, skips } = js.measure(text);
		return [tests, skips];
	});
	assert.deepEqual(measured, [
		[0, 1],
		[1, 1],
	]);
	assert.equal(js.measure("describe.skip('s', () => { it('a', () => {}); });").skips, 1);
	// A conditional skip made unconditional keeps the count but is reported.
	const made = compareTestFile(
		'a.test.ts',
		js,
		"it.skipIf(win)('a', () => {});",
		"it.skip('a', () => {});"
	);
	assert.deepEqual(findingKinds(made), ['skip-added']);
	assert.match(made.findings[0].detail, /skips 1 → 1, 1 more unconditional/);
	for (const [name, from, to] of [
		['Python', '@pytest.mark.skipif(win, reason="r")\n', '@pytest.mark.skip(reason="r")\n'],
		['Rust', '#[cfg_attr(windows, ignore)]\n#[test]\n', '#[ignore]\n#[test]\n'],
	])
		assert.deepEqual(
			findingKinds(compareTestFile('t', language(name), from, to)),
			['skip-added'],
			name
		);
	// Jasmine-style prefixes skip or focus with no condition.
	for (const text of ["xit('a', () => {});", "xdescribe('s', () => {});", "fit('a', () => {});"]) {
		const { skips, unconditional } = js.measure(text);
		assert.deepEqual([skips, unconditional], [1, 1], text);
	}
	assert.equal(js.measure("xit('a', () => {});").tests, 1);
});

test('test changes: counts tests and assertions in Python, Rust, C++ and scenarios', () => {
	const cases = [
		[
			'Python',
			'def test_a():\n    assert x == 1  # pytest.raises(E)\n\n@pytest.mark.skip(reason="r")\ndef test_b():\n    with pytest.raises(E):\n        f()\n',
			{ tests: 2, assertions: 2, skips: 1, unconditional: 1 },
		],
		[
			'Rust',
			'#[test]\nfn a() { assert_eq!(1, 1); } // assert!(x)\n#[tokio::test]\n#[ignore]\nasync fn b() { assert!(ok); }\n',
			{ tests: 2, assertions: 2, skips: 1, unconditional: 1 },
		],
		[
			'C++',
			'TEST_CASE("a") { CHECK(x); REQUIRE_FALSE(y); }\nTEST_CASE("b" * doctest::skip()) { CHECK_EQ(1, 1); } // CHECK(z)\n',
			{ tests: 2, assertions: 3, skips: 1 },
		],
		[
			'Scenario',
			'steps:\n  - command: todo-create\n    expect:\n      success: true\n  - description: x\n    command: todo-list\n# command: not-a-step\n',
			{ tests: 2, assertions: 1, skips: 0 },
		],
	];
	for (const [name, text, expected] of cases)
		assert.deepEqual(language(name).measure(text), expected, name);
	assert.ok(language('Python').owns('tests/test_lane.py', []));
	assert.ok(language('C++').owns('packages/cpp/tests/batch_test.cpp', []));
	assert.ok(!language('C++').owns('packages/cpp/src/batch.cpp', []));
	assert.ok(language('Rust').holds(['#[cfg(test)]\nmod t { #[test] fn a() {} }']));
	assert.ok(!language('Rust').holds(['fn a() {}']));
	assert.ok(language('Scenario').owns('docs/x/scenarios/01-a.scenario.yaml', []));
});

/** A repository with `files` committed on main, then `branch` applied (null deletes) uncommitted. */
function history(files, branch) {
	const root = fixture(files);
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
	);
	const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' });
	const commit = (message) =>
		git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', message);
	git('add', '-A');
	commit('base');
	git('branch', '-M', 'main');
	git('switch', '-qc', 'work');
	for (const [path, text] of Object.entries(branch)) {
		if (text === null) rmSync(join(root, path));
		else {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), text);
		}
	}
	return { root, git, commit };
}

const SUITE = "it('a', () => { expect(1).toBe(1); });\nit('b', () => { expect(2).toBe(2); });\n";

test('test changes: reports a branch against its merge base, uncommitted edits included', () => {
	const { root } = history(
		{
			'src/gone.test.ts': SUITE,
			'src/shrunk.test.ts': SUITE,
			'src/kept.test.ts': SUITE,
			'src/__snapshots__/kept.test.ts.snap': 'exports[`a`] = `1`;\n',
			'vitest.config.ts': 'export default { test: { coverage: { thresholds: { lines: 90 } } } };\n',
			'src/app.ts': 'export const a = 1;\n',
		},
		{
			'src/gone.test.ts': null,
			'src/shrunk.test.ts': "it('a', () => { expect(1).toBe(1); });\n",
			'src/kept.test.ts': `${SUITE}it('c', () => { expect(3).toBe(3); });\n`,
			'src/__snapshots__/kept.test.ts.snap': 'exports[`a`] = `2`;\n',
			'vitest.config.ts': 'export default { test: { coverage: { thresholds: { lines: 60 } } } };\n',
			'src/app.ts': 'export const a = 2;\n',
			'src/new.test.ts': "it.skip('new', () => {});\n",
		}
	);
	const result = run('report-test-changes.mjs', root, '--base', 'main', '--json');
	assert.equal(result.status, 0, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.equal(report.head, 'working tree');
	assert.deepEqual(report.findings.map(({ file, kind }) => `${kind} ${file}`).sort(), [
		'config-changed vitest.config.ts',
		'deleted-file src/gone.test.ts',
		'fewer-assertions src/shrunk.test.ts',
		'fewer-tests src/shrunk.test.ts',
		'snapshot-changed src/__snapshots__/kept.test.ts.snap',
	]);
	const changed = report.findings.find((finding) => finding.kind === 'config-changed');
	assert.match(changed.lines[0].text, /lines: 90/);
	assert.deepEqual(report.totals.JavaScript, {
		files: 3,
		before: { tests: 6, assertions: 6, skips: 0 },
		after: { tests: 4, assertions: 4, skips: 0 },
	});
	const markdown = run('report-test-changes.mjs', root, '--base', 'main');
	assert.match(
		markdown.stdout,
		/\*\*Fewer tests\*\* `src\/shrunk\.test\.ts`: tests 2 → 1\n {2}- 2: `it\('b'/
	);
});

test('test changes: compares a renamed file with its old self, and a commit range with --head', () => {
	const big = `${SUITE}it('c', () => { expect(3).toBe(3); });\nit('d', () => { expect(4).toBe(4); });\n`;
	const { root, git, commit } = history({ 'src/old.test.ts': big }, {});
	git('mv', 'src/old.test.ts', 'src/new.test.ts');
	writeFileSync(join(root, 'src/new.test.ts'), big.replace("it('d'", "it.skip('d'"));
	writeFileSync(join(root, 'src/added.test.ts'), SUITE); // a new file only adds
	git('add', '-A');
	commit('rename');
	writeFileSync(join(root, 'src/new.test.ts'), ''); // uncommitted, so --head must ignore it
	const result = run('report-test-changes.mjs', root, '--base', 'main', '--head', 'work', '--json');
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(
		JSON.parse(result.stdout).findings.map(({ file, kind }) => `${kind} ${file}`),
		['skip-added src/old.test.ts → src/new.test.ts']
	);
});

test('test changes: says so when nothing was lost, and fails clearly on a missing base', () => {
	const { root } = history(
		{ 'src/a.test.ts': SUITE },
		{ 'src/a.test.ts': `${SUITE}it('c', () => {});\n` }
	);
	const clean = run('report-test-changes.mjs', root, '--base', 'main');
	assert.equal(clean.status, 0, clean.stderr);
	assert.match(clean.stdout, /Nothing found: no test file deleted, .* \(1 test file compared\)/);
	const missing = run('report-test-changes.mjs', root, '--base', 'origin/nowhere');
	assert.equal(missing.status, 2);
	assert.match(missing.stderr, /Cannot find a merge base .* Fetch the base/);
});

test('test changes: reads from the merge base, nets a move into a new file, and takes literal paths', () => {
	const { root, git, commit } = history(
		{
			'src/both.test.ts': SUITE,
			'app/[id]/page.test.ts': SUITE,
			'app/i/page.test.ts': SUITE,
			'src/__snapshots__/a.snap': 'exports[`a`] = `1`;\n',
			'playwright.config.ts': 'export default { retries: 0 };\n',
			'src/__snapshots__/b.snap': 'exports[`b`] = `\n---\nkept\n`;\n',
		},
		{}
	);
	// Main adds a test after the branch starts: diffed from main itself, it would read as
	// the branch deleting it.
	git('switch', '-q', 'main');
	writeFileSync(join(root, 'src/main-new.test.ts'), SUITE);
	git('add', '-A');
	commit('main moves on');
	git('switch', '-q', 'work');
	// The branch moves test 'b' into a new file and edits only the bracketed path's file.
	writeFileSync(join(root, 'src/both.test.ts'), "it('a', () => { expect(1).toBe(1); });\n");
	writeFileSync(join(root, 'src/moved.test.ts'), "it('b', () => { expect(2).toBe(2); });\n");
	writeFileSync(join(root, 'src/born-skipped.test.ts'), "it.skip('c', () => {});\n");
	// A new file with only a conditional skip runs where it can; a new conftest can drop tests.
	mkdirSync(join(root, 'py'));
	writeFileSync(
		join(root, 'py/test_opt.py'),
		'yaml = pytest.importorskip("yaml")\n\ndef test_a():\n    assert yaml\n'
	);
	writeFileSync(join(root, 'py/conftest.py'), 'collect_ignore_glob = ["test_*.py"]\n');
	writeFileSync(join(root, 'app/[id]/page.test.ts'), "it('a', () => { expect(1).toBe(1); });\n");
	// Read as a glob, `app/[id]` would also match this file and quote its removed line.
	writeFileSync(join(root, 'app/i/page.test.ts'), SUITE.replace("it('b'", "it('b2'"));
	writeFileSync(
		join(root, 'src/__snapshots__/a.snap'),
		'exports[`a`] = `1`;\nexports[`b`] = `2`;\n'
	);
	writeFileSync(join(root, 'playwright.config.ts'), 'export default { retries: 3 };\n');
	// A removed `---` line is content, not a diff header.
	writeFileSync(join(root, 'src/__snapshots__/b.snap'), 'exports[`b`] = `\nkept\n`;\n');
	git('add', '-A');
	commit('work');
	const result = run('report-test-changes.mjs', root, '--base', 'main', '--head', 'work', '--json');
	assert.equal(result.status, 0, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.deepEqual(report.findings.map(({ file, kind }) => `${kind} ${file}`).sort(), [
		'config-changed playwright.config.ts',
		'config-changed py/conftest.py',
		'fewer-assertions app/[id]/page.test.ts',
		'fewer-assertions src/both.test.ts',
		'fewer-tests app/[id]/page.test.ts',
		'fewer-tests src/both.test.ts',
		'skip-added src/born-skipped.test.ts',
		'snapshot-changed src/__snapshots__/b.snap',
	]);
	// Only the bracketed file's own line is quoted, not app/i's.
	const bracket = report.findings.find((finding) => finding.file === 'app/[id]/page.test.ts');
	assert.deepEqual(bracket.lines, [{ line: 2, text: "it('b', () => { expect(2).toBe(2); });" }]);
	// The new file enters the totals, so the move nets out: only app/[id]'s test is gone.
	assert.deepEqual(report.totals.JavaScript, {
		files: 5,
		before: { tests: 6, assertions: 6, skips: 0 },
		after: { tests: 6, assertions: 5, skips: 1 },
	});
	const snapshot = report.findings.find((finding) => finding.kind === 'snapshot-changed');
	assert.equal(snapshot.detail, '1 lines removed, 0 added');
	const configs = report.findings.filter((finding) => finding.kind === 'config-changed');
	assert.deepEqual(
		configs.map(({ detail, lines }) => [detail, lines[0].text]),
		[
			['1 lines removed, 1 added', 'export default { retries: 0 };'],
			['new, 1 lines', 'collect_ignore_glob = ["test_*.py"]'],
		]
	);
});

// check-test-discovery.mjs

const discoveryPolicy = (body = {}) => JSON.stringify({ unrun: [], ...body });

test('test discovery: parses arrow-function vitest configs, arrow properties inside defineConfig, projects, coverage nesting and globs', () => {
	const arrow = parseVitestConfig(`
		export default defineConfig(({ mode }) => ({
			test: {
				include: ['src/**/*.test.ts'],
				coverage: { include: ['src/**/*.ts'], exclude: ['src/**/*.test.ts'] },
			},
		}));
	`);
	assert.deepEqual(arrow.include, ['src/**/*.test.ts']);
	assert.deepEqual(arrow.exclude, []);

	// An arrow callback inside a config property must not derail findDefaultObject.
	const withInnerArrow = parseVitestConfig(`
		export default defineConfig({
			test: {
				include: ['src/**/*.test.ts'],
				exclude: ['src/e2e/**'],
				onConsoleLog: () => false,
			},
		});
	`);
	assert.deepEqual(withInnerArrow.include, ['src/**/*.test.ts']);
	assert.deepEqual(withInnerArrow.exclude, ['src/e2e/**']);

	const withProjects = parseVitestConfig(`
		export default defineConfig({
			test: {
				projects: [
					{ test: { root: 'web', include: ['tests/**/*.spec.ts'] } },
				],
			},
		});
	`);
	assert.equal(withProjects.projects.length, 1);
	assert.deepEqual(withProjects.projects[0].include, ['tests/**/*.spec.ts']);

	assert.ok(globToRegExp('src/**/*.test.?(c|m)[jt]s').test('src/a/b.test.mts'));
	assert.ok(!globToRegExp('src/**/*.test.ts').test('src/a/b.spec.ts'));
});

test('test discovery: passes a clean polyglot fixture and catches planted orphans across all four languages', () => {
	const baseFiles = {
		'scripts/policy/test-discovery.json': discoveryPolicy(),
		'pnpm-workspace.yaml': 'packages:\n  - "packages/*"\n',
		'package.json': '{"name":"root","scripts":{"test:tooling":"node scripts/run.mjs"}}\n',
		'lefthook.yml':
			'check:\n  commands:\n    test:\n      run: pnpm -r test\n    tooling:\n      run: pnpm test:tooling\n',
		'.github/workflows/ci.yml': [
			'on: pull_request',
			'jobs:',
			'  test:',
			'    steps:',
			'      - run: pnpm check',
			'      - working-directory: py',
			'        run: uv run pytest -q',
			'      - working-directory: cpp',
			'        run: ctest --preset dev',
			'      - working-directory: rust',
			'        run: cargo test',
		].join('\n'),
		'packages/a/package.json': '{"name":"pkg-a","scripts":{"test":"vitest run"}}\n',
		'packages/a/vitest.config.ts': config("\t\tinclude: ['src/**/*.test.ts'],"),
		'packages/a/src/ok.test.ts': "it('ok', () => {});\n",
		'scripts/run.mjs': "spawn('node', ['--test', 'scripts/tool.test.mjs']);\n",
		'scripts/tool.test.mjs': `${'import'} './helper.test.mjs';\n`,
		'scripts/helper.test.mjs': "test('h', () => {});\n",
		'py/pyproject.toml': '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
		'py/tests/test_ok.py': 'def test_ok():\n    assert True\n',
		'cpp/CMakeLists.txt': 'add_executable(t tests/ok_test.cpp)\nadd_test(NAME t COMMAND t)\n',
		'cpp/tests/ok_test.cpp': 'TEST_CASE("ok") {}\n',
		'rust/Cargo.toml': '[package]\nname = "demo"\n',
		'rust/src/lib.rs': '#[test]\nfn unit() {}\n',
		'rust/tests/int.rs': 'mod common;\n#[test]\nfn ok() {}\n',
		'rust/tests/common/mod.rs': 'pub fn helper() {}\n',
	};

	// Clean control passes.
	const clean = run('check-test-discovery.mjs', fixture(baseFiles));
	assert.equal(clean.status, 0, clean.stderr);
	assert.match(clean.stdout, /Test discovery check passed: 8 test files \(8 claimed/);

	// Plant one orphan in every language (including one level deeper).
	const planted = run(
		'check-test-discovery.mjs',
		fixture({
			...baseFiles,
			'packages/a/src/nested/deep/orphan.spec.ts': "it('lost', () => {});\n",
			'scripts/unlisted.test.mjs': "test('lost', () => {});\n",
			'py/extra/test_orphan.py': 'def test_lost():\n    assert True\n',
			'cpp/tests/orphan_test.cpp': 'TEST_CASE("lost") {}\n',
			'rust/tests/nested/orphan.rs': '#[test]\nfn lost() {}\n',
		})
	);
	assert.equal(planted.status, 1);
	assert.match(
		planted.stderr,
		/packages\/a\/src\/nested\/deep\/orphan\.spec\.ts \(JavaScript\): not claimed/
	);
	assert.match(planted.stderr, /scripts\/unlisted\.test\.mjs \(JavaScript\): not claimed/);
	assert.match(planted.stderr, /py\/extra\/test_orphan\.py \(Python\): not claimed/);
	assert.match(planted.stderr, /cpp\/tests\/orphan_test\.cpp \(C\+\+\): not claimed/);
	assert.match(planted.stderr, /rust\/tests\/nested\/orphan\.rs \(Rust\): not claimed/);
});

test('test discovery: catches packages and crates not started by CI, --ignore exclusions, and --lib-only cargo', () => {
	const result = run(
		'check-test-discovery.mjs',
		fixture({
			'scripts/policy/test-discovery.json': discoveryPolicy(),
			'.github/workflows/ci.yml': [
				'on: pull_request',
				'jobs:',
				'  test:',
				'    steps:',
				'      - working-directory: py-run',
				'        run: pytest tests/ --ignore=tests/integration',
				'      - working-directory: crate-lib',
				'        run: cargo test --lib',
			].join('\n'),
			'py-run/tests/test_core.py': 'def test_ok(): pass\n',
			'py-run/tests/integration/test_ignored.py': 'def test_ig(): pass\n',
			// Exact #1359 / #1793 class: package has pyproject.toml + tests, but no workflow runs it.
			'py-unrun/pyproject.toml': '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
			'py-unrun/tests/test_never_run.py': 'def test_x(): pass\n',
			// Cargo --lib runs src/ unit tests, NOT tests/*.rs integration tests.
			'crate-lib/Cargo.toml': '[package]\nname = "crate-lib"\n',
			'crate-lib/src/lib.rs': '#[test]\nfn u() {}\n',
			'crate-lib/tests/int_unrun.rs': '#[test]\nfn i() {}\n',
			// JS package outside workspace with no workflow running it.
			'unwired/package.json': '{"name":"unwired","scripts":{"test":"vitest run"}}\n',
			'unwired/vitest.config.ts': config("\t\tinclude: ['src/**/*.test.ts'],"),
			'unwired/src/never.test.ts': "it('x', () => {});\n",
		})
	);
	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/py-run\/tests\/integration\/test_ignored\.py \(Python\): not claimed/
	);
	assert.match(result.stderr, /py-unrun\/tests\/test_never_run\.py \(Python\): not claimed/);
	assert.match(result.stderr, /crate-lib\/tests\/int_unrun\.rs \(Rust\): not claimed/);
	assert.match(result.stderr, /unwired\/src\/never\.test\.ts \(JavaScript\): not claimed/);
});

test('test discovery: reconciles both ways — fails on dead runners, unwired custom drivers, and stale or recovered exemptions', () => {
	// 1. Active runner matching 0 test files fails (reverse reconciliation).
	const deadRunner = run(
		'check-test-discovery.mjs',
		fixture({
			'scripts/policy/test-discovery.json': discoveryPolicy(),
			'vitest.config.ts': config("\t\tinclude: ['src/**/*.test.ts'],"),
			'vitest.dead.config.ts': config("\t\tinclude: ['missing/**/*.test.ts'],"),
			'src/a.test.ts': "it('a', () => {});\n",
		})
	);
	assert.equal(deadRunner.status, 1);
	assert.match(
		deadRunner.stderr,
		/vitest\.dead\.config\.ts: active test runner matched no tracked test file/
	);

	// 2. Valid `unrun` exemption passes; recovered exemption fails; stale exemption fails.
	const entry = {
		path: 'orphan/lost.test.ts',
		owner: 'maintainer',
		reason: 'Tracked for wiring into the browser suite once runner lands',
		issue: '#99',
	};
	const exempted = run(
		'check-test-discovery.mjs',
		fixture({
			'scripts/policy/test-discovery.json': discoveryPolicy({ unrun: [entry] }),
			'vitest.config.ts': config("\t\tinclude: ['src/**/*.test.ts'],"),
			'src/a.test.ts': "it('a', () => {});\n",
			'orphan/lost.test.ts': "it('lost', () => {});\n",
		})
	);
	assert.equal(exempted.status, 0, exempted.stderr);
	assert.match(exempted.stdout, /1 registered unrun/);

	const recovered = run(
		'check-test-discovery.mjs',
		fixture({
			'scripts/policy/test-discovery.json': discoveryPolicy({
				unrun: [{ ...entry, path: 'src/a.test.ts' }],
			}),
			'vitest.config.ts': config("\t\tinclude: ['src/**/*.test.ts'],"),
			'src/a.test.ts': "it('a', () => {});\n",
		})
	);
	assert.equal(recovered.status, 1);
	assert.match(recovered.stderr, /already claimed by vitest\.config\.ts/);

	const stale = run(
		'check-test-discovery.mjs',
		fixture({
			'scripts/policy/test-discovery.json': discoveryPolicy({ unrun: [entry] }),
			'vitest.config.ts': config("\t\tinclude: ['src/**/*.test.ts'],"),
			'src/a.test.ts': "it('a', () => {});\n",
		})
	);
	assert.equal(stale.status, 1);
	assert.match(stale.stderr, /matches no tracked test file/);

	// 3. Custom runner script in policy must be invoked by CI when workflows exist.
	const unwiredDriver = run(
		'check-test-discovery.mjs',
		fixture({
			'scripts/policy/test-discovery.json': discoveryPolicy({
				runners: [{ script: 'scripts/driver.py', include: ['pkg/tests/**'] }],
			}),
			'.github/workflows/ci.yml':
				'on: pull_request\njobs:\n  ci:\n    steps:\n      - run: vitest run\n',
			'vitest.config.ts': config("\t\tinclude: ['src/**/*.test.ts'],"),
			'src/a.test.ts': "it('a', () => {});\n",
			'scripts/driver.py': 'print("run")\n',
			'pkg/tests/test_a.py': 'def test_a(): pass\n',
		})
	);
	assert.equal(unwiredDriver.status, 1);
	assert.match(
		unwiredDriver.stderr,
		/runner script scripts\/driver\.py is not invoked by any workflow or hook/
	);
});

test('test discovery: fails on missing register, empty suite, malformed entries, and respects excludes and Playwright', () => {
	const missing = run(
		'check-test-discovery.mjs',
		fixture({ 'vitest.config.ts': config(''), 'src/a.test.ts': "it('a', () => {});\n" })
	);
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /scripts\/policy\/test-discovery\.json is missing/);

	const empty = run(
		'check-test-discovery.mjs',
		fixture({ 'scripts/policy/test-discovery.json': discoveryPolicy(), 'src/app.ts': '' })
	);
	assert.equal(empty.status, 1);
	assert.match(empty.stderr, /found no test file/);

	// Vitest exclude via const spread hides a test unless another runner claims it.
	const excluded = run(
		'check-test-discovery.mjs',
		fixture({
			'scripts/policy/test-discovery.json': discoveryPolicy(),
			'vitest.config.ts': [
				"const browser = ['src/b.test.ts'];",
				"export default defineConfig({ test: { include: ['src/**/*.test.ts'], exclude: [...browser] } });",
			].join('\n'),
			'src/a.test.ts': "it('a', () => {});\n",
			'src/b.test.ts': "it('b', () => {});\n",
		})
	);
	assert.equal(excluded.status, 1);
	assert.match(excluded.stderr, /src\/b\.test\.ts \(JavaScript\): not claimed/);

	// Playwright testDir + testMatch catches files outside testMatch.
	const pw = run(
		'check-test-discovery.mjs',
		fixture({
			'scripts/policy/test-discovery.json': discoveryPolicy(),
			'playwright.config.ts':
				'export default defineConfig({ testDir: ".", testMatch: "**/*.pw.spec.ts" });\n',
			'src/a.pw.spec.ts': "test('a', () => {});\n",
			'src/orphan.spec.ts': "test('b', () => {});\n",
		})
	);
	assert.equal(pw.status, 1);
	assert.match(pw.stderr, /src\/orphan\.spec\.ts \(JavaScript\): not claimed/);
	assert.doesNotMatch(pw.stderr, /src\/a\.pw\.spec\.ts/);

	// Malformed unrun and runner entries (short reason, root path ".", missing include) fail loudly.
	const malformed = run(
		'check-test-discovery.mjs',
		fixture({
			'scripts/policy/test-discovery.json': JSON.stringify({
				runners: [{ script: 'scripts/run.py', include: [] }],
				unrun: [
					{ path: 'src/a.test.ts', owner: 'm', reason: 'too short', issue: '#1' },
					{
						path: './',
						owner: 'maintainer',
						reason: 'Root path must be rejected so it cannot exempt everything',
						issue: '#2',
					},
				],
			}),
			'vitest.config.ts': config("\t\tinclude: ['src/**/*.test.ts'],"),
			'src/a.test.ts': "it('a', () => {});\n",
		})
	);
	assert.equal(malformed.status, 1);
	assert.match(malformed.stderr, /malformed runner entry/);
	assert.match(malformed.stderr, /malformed unrun entry/);
	assert.match(malformed.stderr, /normalizes to the repository root/);
});

test('test discovery: enforces explicit --config, portable Lefthook hooks, Jest, node --test, custom runners and report-test-changes', () => {
	// 1. Missing explicit --config fails instead of falling back to catch-all defaults.
	const badConfig = run(
		'check-test-discovery.mjs',
		fixture({
			'scripts/policy/test-discovery.json': discoveryPolicy(),
			'package.json':
				'{"name":"app","scripts":{"test":"vitest run --config vitest.typo.config.ts"}}\n',
			'src/a.test.ts': "it('a', () => {});\n",
		})
	);
	assert.equal(badConfig.status, 1);
	assert.match(
		badConfig.stderr,
		/vitest\.typo\.config\.ts: explicit vitest --config file is not listed by git/
	);

	// 2. Portable Lefthook `pre-push:` hook activates tests; removing test from `check:` makes `pnpm check` fail.
	const prePushHook = run(
		'check-test-discovery.mjs',
		fixture({
			'scripts/policy/test-discovery.json': discoveryPolicy(),
			'lefthook.yml':
				'pre-push:\n  commands:\n    unit:\n      root: web/\n      run: pnpm vitest run\n',
			'web/vitest.config.ts': config("\t\tinclude: ['src/**/*.test.ts'],"),
			'web/src/a.test.ts': "it('a', () => {});\n",
		})
	);
	assert.equal(prePushHook.status, 0, prePushHook.stderr);

	const checkWithoutTest = run(
		'check-test-discovery.mjs',
		fixture({
			'scripts/policy/test-discovery.json': discoveryPolicy(),
			'pnpm-workspace.yaml': 'packages:\n  - "packages/*"\n',
			'package.json': '{"name":"root","scripts":{"check":"lefthook run check"}}\n',
			'lefthook.yml': 'check:\n  commands:\n    lint:\n      run: biome check .\n',
			'.github/workflows/ci.yml':
				'on: pull_request\njobs:\n  ci:\n    steps:\n      - run: pnpm check\n',
			'packages/a/package.json': '{"name":"a","scripts":{"test":"vitest run"}}\n',
			'packages/a/vitest.config.ts': config("\t\tinclude: ['src/**/*.test.ts'],"),
			'packages/a/src/a.test.ts': "it('a', () => {});\n",
		})
	);
	assert.equal(checkWithoutTest.status, 1);
	assert.match(
		checkWithoutTest.stderr,
		/packages\/a\/src\/a\.test\.ts \(JavaScript\): not claimed/
	);

	// 3. Jest config + direct `node --test` (directory, exact file, and dead target) + wired/dead custom driver.
	const jestAndNode = run(
		'check-test-discovery.mjs',
		fixture({
			'scripts/policy/test-discovery.json': discoveryPolicy({
				runners: [{ script: 'scripts/py_driver.py', include: ['py/pkg/*/tests/**'] }],
			}),
			'.github/workflows/ci.yml': [
				'on: pull_request',
				'jobs:',
				'  all:',
				'    steps:',
				'      - run: jest',
				'        working-directory: web',
				'      - run: node --test tools/',
				'      - run: python scripts/py_driver.py',
			].join('\n'),
			'web/jest.config.js': 'module.exports = { testMatch: ["**/__tests__/**/*.test.ts"] };\n',
			'web/__tests__/ok.test.ts': "test('ok', () => {});\n",
			'tools/a.test.mjs': "test('t', () => {});\n",
			'scripts/py_driver.py': 'print("ok")\n',
			'py/pkg/one/tests/test_one.py': 'def test_one(): pass\n',
		})
	);
	assert.equal(jestAndNode.status, 0, jestAndNode.stderr);

	const deadNodeTest = run(
		'check-test-discovery.mjs',
		fixture({
			'scripts/policy/test-discovery.json': discoveryPolicy({
				runners: [{ script: 'scripts/dead_driver.py', include: ['py/missing/**'] }],
			}),
			'.github/workflows/ci.yml': [
				'on: pull_request',
				'jobs:',
				'  all:',
				'    steps:',
				'      - run: node --test tools/ok.test.mjs',
				'      - run: node --test tools/deleted.test.mjs',
				'      - run: python scripts/dead_driver.py',
			].join('\n'),
			'tools/ok.test.mjs': "test('t', () => {});\n",
			'scripts/dead_driver.py': 'print("dead")\n',
		})
	);
	assert.equal(deadNodeTest.status, 1);
	assert.match(
		deadNodeTest.stderr,
		/node --test \(\. tools\/deleted\.test\.mjs\): active test runner matched no tracked test file/
	);
	assert.match(
		deadNodeTest.stderr,
		/scripts\/dead_driver\.py: active test runner matched no tracked test file/
	);

	// 4. report-test-changes.mjs flags edits to scripts/policy/test-discovery.json.
	const { root } = history(
		{ 'scripts/policy/test-discovery.json': discoveryPolicy() },
		{
			'scripts/policy/test-discovery.json': discoveryPolicy({
				unrun: [
					{
						path: 'orphan/x.test.ts',
						owner: 'maintainer',
						reason: 'Temporary exemption while runner is being wired up',
						issue: '#10',
					},
				],
			}),
		}
	);
	const reportRes = run('report-test-changes.mjs', root, '--base', 'main', '--json');
	assert.equal(reportRes.status, 0, reportRes.stderr);
	assert.deepEqual(
		JSON.parse(reportRes.stdout).findings.map(({ file, kind }) => `${kind} ${file}`),
		['config-changed scripts/policy/test-discovery.json']
	);
});
